/**
 * Glimpses of other people's steps over real WebSockets (glimpses.ts): walks of 20 to 40 steps out in the
 * wilds that end at a find picked, a fire fed or the way home are kept, a few to a map and a day at most,
 * and whoever is alone out there glimpses somebody else's now and then, as its color and its tiles, never
 * whose. The clock is the test's, so minutes pass at once.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { GLIMPSES_PER_MAP, GLIMPSE_KEPT_MS, GLIMPSE_NEAR, GLIMPSE_SEEN, GLIMPSE_STEPS, STEP_MS, TileMap, type Dir, type MapData } from '@napoland/shared';
import type { PlayerRecord } from '../src/storage';
import { fixtureMaps, houseData, itemsData } from './fixtures';
import { setup, waitFor, type Client } from './helpers';

/**
 * A moor out in the wilds, 7 tiles across and 29 deep, walled in by forest, the way home at 4,30: steps from
 * home are |x - 4| + (30 - y). A campfire nobody tends at 4,1 (fed from 4,2); a nail always grows at 2,1; a
 * hut at 5,3 whose door, 6,4, leads into a room with a fire of its own.
 */
function moorData(): MapData {
  const tiles = Array.from({ length: 31 }, (_, y) => (y === 0 ? 'ttttttttt' : y === 30 ? 'ttttgtttt' : 'tgggggggt'));
  return {
    id: 'moor', name: 'Moor', version: 1, kind: 'wilds', depth: 1, width: 9, height: 31,
    tiles, levels: Array<string>(31).fill('000000000'),
    spawn: { x: 4, y: 28, dir: 'up' },
    exits: [
      { x: 4, y: 30, w: 1, h: 1, to: 'town', tx: 4, ty: 1, dir: 'down', home: true },
      { x: 6, y: 4, w: 1, h: 1, to: 'hut', tx: 2, ty: 3, dir: 'up' },
    ],
    objects: [{ kind: 'fireplace', x: 4, y: 1 }, { kind: 'house', x: 5, y: 3, w: 3, h: 2, roof: '#6b7075', lit: 0 }],
  };
}

/** The fixture house's room, as the hut on the moor: its fire at 2,1, its door back out at 2,4. */
function hutData(): MapData {
  const h = houseData();
  return { ...h, id: 'hut', name: 'Hut', exits: [{ x: 2, y: 4, w: 1, h: 1, to: 'moor', tx: 6, ty: 5, dir: 'down' }] };
}

const on = (x: number, y: number, more: Partial<PlayerRecord> = {}): Partial<PlayerRecord> => ({ map: 'moor', x, y, dir: 'up', ...more });
const glimpses = (msgs: Array<{ t: string }>) => msgs.filter(m => m.t === 'glimpse');
/** `n` steps one way. */
const steps = (dir: Dir, n: number): Dir[] => Array<Dir>(n).fill(dir);
/** The tiles walked from x,y going straight `dir` for `n` steps (the start left out). */
const line = (x: number, y: number, dir: Dir, n: number): Array<[number, number]> =>
  Array.from({ length: n }, (_, i): [number, number] => (dir === 'up' ? [x, y - i - 1] : dir === 'down' ? [x, y + i + 1] : dir === 'left' ? [x - i - 1, y] : [x + i + 1, y]));

describe('glimpses', () => {
  let now = 1_000_000;
  let seq = 0;
  const items = itemsData();
  items.items.push({ id: 'twig', name: 'Twig', kind: 'resource', stack: 50, text: 'Dry.', fuel: 60 });
  items.finds.push({ item: 'nail', map: 'moor', around: { x: 2, y: 1, r: 0 }, count: 1, respawn: [30, 60] });
  // With these dice each wait for a glimpse is halfway through its range: 90 seconds.
  const { ctx, enter } = setup({ clock: () => now, rng: () => 0.5, weather: 'overcast', maps: [...fixtureMaps(), new TileMap(moorData()), new TileMap(hutData())], items });
  // A day between tests: what an earlier one walked is forgotten.
  beforeEach(() => {
    now += GLIMPSE_KEPT_MS;
  });

  /** Walks `dirs`, a step's time apart, each heard confirmed. */
  const walk = async (c: Client, dirs: readonly Dir[]) => {
    for (const dir of dirs) {
      now += STEP_MS;
      const n = ++seq;
      c.send({ t: 'step', dir, seq: n });
      await c.next('step', m => m.seq === n);
    }
  };
  /**
   * Seconds pass at once, and `c` hears the tick that saw them: out in the wilds its bar is moving, so it hears
   * its energy then. What it heard before is let go first, so that energy is the new tick's.
   */
  const pass = async (seconds: number, ...c: Client[]) => {
    for (const x of c) await x.settle();
    now += seconds * 1000;
    for (const x of c) await x.next('energy');
  };
  /** Someone who walked 24 steps up the moor to its campfire and fed it, then went home: their walk, as it is kept. */
  const walker = async () => {
    const w = await enter(on(4, 26, { bag: [{ item: 'twig', count: 5 }] }));
    await walk(w.c, steps('up', 24));
    w.c.send({ t: 'feed', x: 4, y: 1, slot: 0 });
    expect(await w.c.next('did')).toMatchObject({ did: { kind: 'fire', item: 'twig' } });
    const color = w.welcome.players.find(p => p.id === w.id)!.color;
    return { ...w, kept: { color, steps: line(4, 26, 'up', 24) } };
  };
  const leave = async (c: Client, id: string) => {
    c.ws.terminate();
    await waitFor(() => !ctx.server.world.has(id), 'them to leave');
  };

  it('keeps a walk that ended at a fire fed, and shows it to someone alone out there: its color and its tiles, never whose', async () => {
    const w = await walker();
    expect(ctx.server.world.walksOn('moor', now)).toEqual([w.kept]);
    await leave(w.c, w.id);
    const o = await enter(on(4, 29));
    // Never before the shortest wait; by the longest.
    await pass(2, o.c);
    await pass(57, o.c);
    expect(glimpses(await o.c.settle())).toEqual([]);
    await pass(62, o.c);
    const [g] = glimpses(await o.c.settle()) as Array<{ t: 'glimpse'; glimpse: unknown }>;
    expect(g).toEqual({ t: 'glimpse', glimpse: w.kept });
    const said = JSON.stringify(g);
    expect(said).not.toContain(w.id);
    expect(said).not.toContain(w.welcome.name);
    // And again, a while later.
    await pass(59, o.c);
    expect(glimpses(await o.c.settle())).toEqual([]);
    await pass(62, o.c);
    expect(glimpses(await o.c.settle())).toEqual([{ t: 'glimpse', glimpse: w.kept }]);
  });

  it('keeps walks that ended at a find picked, on the way home and at the fire in a room off the wilds', async () => {
    // Up to the nail at 2,1, 22 steps, and picks it.
    const a = await enter(on(2, 24));
    expect(ctx.server.world.findViews('moor')).toEqual([expect.objectContaining({ item: 'nail', x: 2, y: 1 })]);
    await walk(a.c, steps('up', 22));
    a.c.send({ t: 'pick', x: 2, y: 1 });
    await a.c.next('got');
    // Down the moor and onto the way home, 21 steps.
    const b = await enter(on(4, 9, { dir: 'down' }));
    await walk(b.c, steps('down', 21));
    expect(ctx.server.world.get(b.id)!.map).toBe('town');
    // Up to the hut's door, 23 steps, in, and feeds its fire.
    const c = await enter(on(6, 27, { bag: [{ item: 'twig', count: 1 }] }));
    await walk(c.c, steps('up', 23));
    expect(ctx.server.world.get(c.id)!.map).toBe('hut');
    await walk(c.c, ['up']);
    c.c.send({ t: 'feed', x: 2, y: 1, slot: 0 });
    await c.c.next('did');
    const color = (p: { id: string; welcome: { players: Array<{ id: string; color: string }> } }) => p.welcome.players.find(q => q.id === p.id)!.color;
    expect(ctx.server.world.walksOn('moor', now)).toEqual([
      { color: color(a), steps: line(2, 24, 'up', 22) },
      { color: color(b), steps: line(4, 9, 'down', 21) },
      { color: color(c), steps: line(6, 27, 'up', 23) },
    ]);
  });

  it('keeps no walk shorter than 20 steps, and only the last 40 of a longer one', async () => {
    const w = await enter(on(4, 21, { bag: [{ item: 'twig', count: 5 }] }));
    await walk(w.c, steps('up', GLIMPSE_STEPS[0] - 1));
    w.c.send({ t: 'feed', x: 4, y: 1, slot: 0 });
    await w.c.next('did');
    expect(ctx.server.world.walksOn('moor', now)).toEqual([]);
    // Down and up again, 44 steps, and fed again: a walk starts where the last one ended.
    await walk(w.c, [...steps('down', 22), ...steps('up', 22)]);
    w.c.send({ t: 'feed', x: 4, y: 1, slot: 0 });
    await w.c.next('did');
    const [kept] = ctx.server.world.walksOn('moor', now);
    expect(kept!.steps).toEqual([...line(4, 2, 'down', 22), ...line(4, 24, 'up', 22)].slice(-GLIMPSE_STEPS[1]));
  });

  it(`keeps ${GLIMPSES_PER_MAP} walks a map at most, the oldest going first, and forgets them after a day`, async () => {
    // The first comes down the second column, and across to the way home at its foot.
    const first = await enter(on(2, 9, { dir: 'down' }));
    await walk(first.c, [...steps('down', 20), ...steps('right', 2), 'down']);
    first.c.ws.terminate();
    for (let i = 0; i < GLIMPSES_PER_MAP; i++) {
      const w = await enter(on(4, 9, { dir: 'down' }));
      await walk(w.c, steps('down', 21));
      w.c.ws.terminate();
    }
    const kept = ctx.server.world.walksOn('moor', now);
    expect(kept).toHaveLength(GLIMPSES_PER_MAP);
    expect(kept.every(k => k.steps[0]![0] === 4)).toBe(true);
    // A day on, they are all forgotten, and nobody glimpses them.
    await waitFor(() => ctx.server.world.size === 0, 'everyone to leave');
    now += GLIMPSE_KEPT_MS;
    const o = await enter(on(4, 28));
    await pass(2, o.c);
    // Gone from the server's memory too: not even as of back then is any there.
    expect(ctx.server.world.walksOn('moor', 0)).toEqual([]);
    await pass(150, o.c);
    expect(glimpses(await o.c.settle())).toEqual([]);
  });

  it(`shows only a walk that passes within ${GLIMPSE_SEEN} tiles, and none that begins within ${GLIMPSE_NEAR}`, async () => {
    // Down the first column, across its foot and onto the way home: its nearest tile, 1,11, is 11.7 tiles from 7,1.
    const w = await enter(on(1, 10, { dir: 'down' }));
    await walk(w.c, [...steps('down', 19), ...steps('right', 3), 'down']);
    const kept = ctx.server.world.walksOn('moor', now);
    expect(kept).toHaveLength(1);
    await leave(w.c, w.id);
    const o = await enter(on(7, 1, { dir: 'down' }));
    await pass(2, o.c);
    await pass(150, o.c);
    expect(glimpses(await o.c.settle())).toEqual([]);
    // Round the hut and down the middle to 4,20: 1,20 is 3 tiles away now, and the walk begins 9.5 tiles off.
    await walk(o.c, ['down', ...steps('left', 3), ...steps('down', 18)]);
    await pass(2, o.c);
    await pass(120, o.c);
    expect(glimpses(await o.c.settle())).toEqual([{ t: 'glimpse', glimpse: kept[0] }]);
    // Where it begins (1,11), it would fade at once: none.
    const n = await enter(on(1, 13));
    await leave(o.c, o.id);
    await pass(2, n.c);
    await pass(150, n.c);
    expect(glimpses(await n.c.settle())).toEqual([]);
  });

  it('never shows anyone their own walk', async () => {
    const w = await walker();
    // Away from the fire's warmth, alone out there.
    await walk(w.c, steps('down', 3));
    await pass(2, w.c);
    await pass(150, w.c);
    expect(glimpses(await w.c.settle())).toEqual([]);
  });

  it('comes only to someone alone out there, never in a room, and no longer once someone else arrives', async () => {
    const w = await walker();
    await leave(w.c, w.id);
    // Two out on the moor, far apart: neither is alone.
    const a = await enter(on(4, 29)), b = await enter(on(2, 20));
    await pass(2, a.c, b.c);
    await pass(100, a.c, b.c);
    expect(glimpses([...await a.c.settle(), ...await b.c.settle()])).toEqual([]);
    // b goes into the hut: a is alone out there, and b, in a room, is not out there.
    await leave(b.c, b.id);
    const inside = await enter({ map: 'hut', x: 2, y: 2 });
    await pass(2, a.c);
    await pass(92, a.c);
    expect(glimpses(await a.c.settle())).toEqual([{ t: 'glimpse', glimpse: w.kept }]);
    expect(glimpses(await inside.c.settle())).toEqual([]);
    // Someone comes out onto the moor: no more.
    const c = await enter(on(6, 12));
    await pass(2, a.c, c.c);
    await pass(100, a.c, c.c);
    expect(glimpses([...await a.c.settle(), ...await c.c.settle()])).toEqual([]);
  });
});
