/**
 * The fire lookout (roadmap/lookout-tower.md) as your game has it: the view pulling back as you climb
 * (plain logic), the distant lights you see from up there, where they really are, and what drawing it
 * costs: the real WorldView and three.js's real renderer over a WebGL context that only counts
 * (fakegl.ts), in the Near Woods, on the ground and up the lookout, upright and sideways.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOOKOUT_UP_S, LOOKOUT_ZOOM, TileMap, beamAngle, footOf, inBeam, type ClientMsg, type MapData, type PlayerView } from '@napoland/shared';
import { Game } from '../src/game';
import { Items } from '../src/items';
import { easeZoom, farGlow, farLights, mapOffsets, placeFar, upness } from '../src/lookout';
import { Maps } from '../src/maps';
import { fakePage, fakeRenderer } from './fakegl';
import { welcome } from './fixtures';

fakePage();
const { WorldView } = await import('../src/view/world');

const content = (id: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/maps', `${id}.json`), 'utf8')) as MapData;
const woods = content('near-woods'), town = content('stonebrook'), road = content('south-road');
const peek = (id: string) => [woods, town, road].find(m => m.id === id);
const lookout = woods.objects.find((o): o is Extract<MapData['objects'][number], { kind: 'lookout' }> => o.kind === 'lookout')!;
const foot = footOf(lookout);

describe('the view from up a lookout', () => {
  it('pulls back to three times as far, smoothly, and comes in again', () => {
    let z = 1;
    const seen: number[] = [];
    for (let i = 0; i < 60; i++) { z = easeZoom(z, true, 1 / 30); seen.push(z); }
    // Always farther, never past three times, never a jump.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
      expect(seen[i]! - seen[i - 1]!).toBeLessThan(0.2);
    }
    expect(seen[14]!).toBeGreaterThan(2);
    expect(z).toBeLessThanOrEqual(LOOKOUT_ZOOM);
    for (let i = 0; i < 120; i++) z = easeZoom(z, true, 1 / 30);
    expect(z).toBe(LOOKOUT_ZOOM);
    expect(upness(z)).toBe(1);
    for (let i = 0; i < 120; i++) z = easeZoom(z, false, 1 / 30);
    expect(z).toBe(1);
    expect(upness(z)).toBe(0);
  });

  it('knows where the maps around lie: Stonebrook south of the Near Woods, the South Road farther south again', () => {
    const at = mapOffsets(woods, peek);
    expect(at.get('near-woods')).toEqual({ dx: 0, dy: 0 });
    expect(at.get('stonebrook')).toEqual({ dx: 2, dy: 78 });
    expect(at.get('south-road')).toEqual({ dx: -22, dy: 120 });
    // Rooms are no place to see lights in from out here.
    expect([...at.keys()].every(id => peek(id)?.kind !== 'inside')).toBe(true);
  });

  it('sees the lamp with no wires, the lit shelters, the masts and, far to the south, the Old Stone and the Tower', () => {
    const lights = farLights(woods, peek);
    const at = (x: number, z: number) => lights.find(l => Math.abs(l.x - x) < 1 && Math.abs(l.z - z) < 1);
    const lonely = woods.objects.find(o => o.kind === 'lamp' && o.y < 20)!;
    expect(at(lonely.x + 0.84, lonely.y + 0.5)).toMatchObject({ kind: 'steady' });
    expect(lights.filter(l => l.color === '#ffc070')).toHaveLength(3);
    const stone = town.objects.find(o => o.kind === 'stone')!, tower = road.objects.find(o => o.kind === 'antenna')!;
    expect(at(stone.x + 2.5, stone.y + 78.5)).toMatchObject({ kind: 'breathe' });
    expect(at(tower.x - 21.5, tower.y + 120.5)).toMatchObject({ kind: 'blink' });
    // Both far to the south of the lookout.
    expect(stone.y + 78 - lookout.y).toBeGreaterThan(50);
    expect(tower.y + 120 - lookout.y).toBeGreaterThan(130);
  });

  it('draws a light where it is if the view reaches it, else on the view\'s edge in its real direction, above the trees', () => {
    const out = { x: 0, y: 0, z: 0, far: false };
    expect(placeFar({ x: 10, z: 5, y: 1.3 }, 5, 5, 18, out)).toEqual({ x: 10, y: 1.3, z: 5, far: false });
    const far = placeFar({ x: 5, z: 205, y: 1.6 }, 5, 5, 18, { ...out });
    expect(far).toMatchObject({ x: 5, z: 23, far: true });
    expect(far.y).toBeGreaterThan(4);
    // A mast's light blinks with the masts in the world; the Old Stone breathes; a lamp stays.
    expect(farGlow('blink', 0.1)).toBe(1);
    expect(farGlow('blink', 1)).toBeLessThan(0.2);
    expect(farGlow('steady', 7)).toBe(1);
  });
});

describe('climbing it, as your game has it', () => {
  const items = new Items({ version: 1, finds: [], items: [{ id: 'resin', name: 'Fir resin', noun: 'resin', plural: 'resin', kind: 'resource', stack: 20, text: 'Sap.', fuel: 300 }] });
  const maps = new Maps([woods]);
  const me: PlayerView = { id: 'me', name: 'Aldo', x: foot.x, y: foot.y, dir: 'up', color: '#d9a53a', gear: {}, quirks: [] };
  const play = (bag: Array<{ item: string; count: number }> = [], lamp = 0) => {
    const sent: ClientMsg[] = [];
    const g = new Game(maps, m => sent.push(m), items);
    g.handle({ ...welcome(woods, [me], undefined, { bag, items: 1 }), lamps: [{ x: lookout.x, y: lookout.y, left: lamp }] }, 1000);
    return { g, sent };
  };

  it('climbs with A at the ladder, pulls the view back while up, and B climbs down', () => {
    const { g, sent } = play();
    g.pressA();
    expect(sent).toEqual([{ t: 'climb', x: lookout.x, y: lookout.y }]);
    g.handle({ t: 'up', id: 'me', on: true, left: LOOKOUT_UP_S }, 1000);
    expect(g.up).toMatchObject({ x: lookout.x, y: lookout.y });
    expect(g.noteView(1000)?.text).toMatch(/You climb up to the lookout/);
    expect(g.avatars()[0]!.up).toBe(true);
    for (let t = 1000; t < 4000; t += 50) g.update(0.05, t);
    expect(g.zoom).toBe(LOOKOUT_ZOOM);
    // Up there nobody walks: the stick only turns you.
    g.padChange('left', 4000);
    g.update(0.05, 4050);
    expect(sent.filter(m => m.t === 'step')).toEqual([]);
    expect(g.me!.dir).toBe('left');
    expect(g.pressB()).toBe(true);
    expect(sent.at(-1)).toEqual({ t: 'climbDown' });
    g.handle({ t: 'up', id: 'me', on: false }, 4100);
    expect(g.up).toBeNull();
    for (let t = 4100; t < 8000; t += 50) g.update(0.05, t);
    expect(g.zoom).toBe(1);
  });

  it('asks first to feed the lamp what it burns when you carry some and it has room; no leaves it be, and A climbs', () => {
    const { g, sent } = play([{ item: 'resin', count: 4 }], 0);
    g.pressA();
    expect(g.askView()).toMatchObject({ text: 'Feed the lookout\'s lamp resin?', count: expect.objectContaining({ n: 1, max: 4 }) });
    g.answer('yes');
    expect(sent).toEqual([{ t: 'feed', x: lookout.x, y: lookout.y, slot: 0 }]);
    g.handle({ t: 'did', did: { kind: 'lamp', item: 'resin', count: 1, left: 600, lit: true } }, 1100);
    expect(g.noteView(1100)?.text).toBe('The lamp takes 1 resin and lights up. It will burn 10 more minutes, its beam sweeping the woods.');

    const again = play([{ item: 'resin', count: 4 }], 600);
    again.g.pressA();
    again.g.answer('no');
    again.g.pressA();
    expect(again.sent).toEqual([{ t: 'climb', x: lookout.x, y: lookout.y }]);
  });

  it('climbs at once with a full lamp, or nothing that burns', () => {
    const full = play([{ item: 'resin', count: 4 }], 3600);
    full.g.pressA();
    expect(full.sent).toEqual([{ t: 'climb', x: lookout.x, y: lookout.y }]);
  });

  it('knows you are out of a surge while its beam is on you, as the server counts it, and only while its lamp burns', () => {
    const g = new Game(maps, () => {}, items);
    // Five tiles east of its lamp: at 5,000,000 ms (a whole number of turns) the beam points east, onto you.
    const at = { ...me, x: lookout.x + 5, y: lookout.y + 1 };
    const surge = { phase: 'surge' as const, left: 50, into: 100 };
    g.handle({ ...welcome(woods, [at], undefined, { items: 1 }), serverTime: 5_000_000, surge, lamps: [{ x: lookout.x, y: lookout.y, left: 600 }] }, 1000);
    expect(inBeam(lookout, at.x, at.y, 5_000_000)).toBe(true);
    expect(g.caught(1000)).toBe(false);
    // Half a turn on, it points the other way.
    expect(g.caught(11_000)).toBe(true);
    // A whole turn on it is back, but out, it shelters nobody.
    g.handle({ t: 'lamp', lamp: { x: lookout.x, y: lookout.y, left: 0 } }, 20_000);
    expect(g.caught(21_000)).toBe(true);
  });

  it('turns the beam by the server\'s clock, the same for everyone', () => {
    const { g } = play([], 600);
    g.handle({ ...welcome(woods, [me], undefined, { items: 1 }), serverTime: 5_000_000, lamps: [{ x: lookout.x, y: lookout.y, left: 600 }] }, 1000);
    expect(g.wallNow(3000)).toBe(5_002_000);
    expect(beamAngle(g.wallNow(3000))).toBeCloseTo(beamAngle(5_002_000), 9);
    expect(g.lampLeft(lookout.x, lookout.y, 61_000)).toBeCloseTo(540, 5);
  });
});

describe('what the view from up there costs', () => {
  /** Draw calls and triangles, and the programs linked, after a few frames on the ground or up the lookout. */
  function measure(width: number, height: number) {
    const { renderer, counts } = fakeRenderer();
    const view = new WorldView(renderer, new TileMap(woods), peek);
    view.resize(width, height);
    const avatar = (up: boolean) => [{ id: 'me', x: foot.x, y: foot.y, dir: 'up' as const, moving: false, phase: 0, color: '#d9a53a', turnT: 0, up }];
    const frames = (up: boolean) => { for (let i = 0; i < 8; i++) view.render(i * 0.3, 0.3, foot, avatar(up), 'me', null); };
    const info = () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
    view.setLamps(() => 600, 1_000_000);
    frames(false);
    const down = info(), programs = counts.programs;
    // Up, but every block drawn as on the ground: what the far look saves.
    const lod = (view as unknown as { applyLod: (x: number, z: number) => void }).applyLod;
    (view as unknown as { applyLod: () => void }).applyLod = () => {};
    view.setZoom(LOOKOUT_ZOOM);
    frames(true);
    const whole = info();
    (view as unknown as { applyLod: typeof lod }).applyLod = lod;
    frames(true);
    const up = info();
    view.setZoom(1);
    frames(false);
    const back = info();
    const compiled = counts.programs - programs;
    view.dispose();
    return { down, whole, up, back, compiled };
  }

  // As measured when the far look came in (draw calls and triangles): at 390x844, 99 and 98,208 on the ground,
  // 344 and 380,460 up there drawn whole, 100 and 160,550 with the far look; at 844x390, 116 and 132,414,
  // 346 and 424,230, 94 and 156,220.
  for (const [shape, w, h] of [['portrait', 390, 844], ['landscape', 844, 390]] as const) {
    it(`up the lookout, ${shape}: the far look keeps it near what it costs on the ground, and nothing is compiled`, () => {
      const m = measure(w, h);
      expect(m.compiled).toBe(0);
      expect(m.up.calls).toBeLessThan(m.whole.calls);
      expect(m.up.triangles).toBeLessThan(m.whole.triangles);
      // Coming down draws what it drew before.
      expect(m.back).toEqual(m.down);
      // About what the ground costs: a phone that draws the woods draws the view from up there.
      expect(m.up.calls).toBeLessThanOrEqual(m.down.calls * 1.3);
      expect(m.up.triangles).toBeLessThanOrEqual(m.down.triangles * 2);
    });
  }

  it('lights the tiles its beam passes over, out to its reach, and nowhere else', () => {
    const wall = 1_000_000, angle = beamAngle(wall), c = { x: lookout.x + 1, y: lookout.y + 1 };
    const at = (d: number) => [Math.floor(c.x + Math.cos(angle) * d), Math.floor(c.y + Math.sin(angle) * d)] as const;
    expect(inBeam(lookout, ...at(10), wall)).toBe(true);
    expect(inBeam(lookout, ...at(30), wall)).toBe(false);
    // Half a turn later it lights the other side.
    expect(inBeam(lookout, ...at(10), wall + 10_000)).toBe(false);
  });
});
