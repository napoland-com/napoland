/**
 * The Reservoir as it ships (roadmap/the-reservoir.md, docs/DESIGN.md): a region at depth 1 up the brook from
 * Stonebrook, behind the Timber Co.'s dam. Where it is and how it joins the town, the lake that draws down on a
 * clock and the water by the dam that never does, the Sister at the deepest of the drowned valley, Jon's knoll
 * and its boat, the keeper's house and its fire, the Brandts' notes, and what a trip out to the Sister costs.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DIRS, STEP_MS, TileMap, drawdownAt, energyRate, itemIndex, maxEnergy, notesOf, objectTiles, stepTarget, surgeAt, type ItemsData, type MapData, type MapObject, type StoryData,
} from '@napoland/shared';

const content = resolve(import.meta.dirname, '../../content');
const items = JSON.parse(readFileSync(resolve(content, 'items.json'), 'utf8')) as ItemsData;
const story = JSON.parse(readFileSync(resolve(content, 'story.json'), 'utf8')) as StoryData;
const load = () => new Map(readdirSync(resolve(content, 'maps')).filter(f => f.endsWith('.json')).map(f => {
  const data = JSON.parse(readFileSync(resolve(content, 'maps', f), 'utf8')) as MapData;
  return [data.id, new TileMap(data)] as const;
}));
const maps = load();
const res = maps.get('reservoir')!, town = maps.get('stonebrook')!, near = maps.get('near-woods')!;
const keepers = maps.get('reservoir-keepers-house')!, boathouse = maps.get('reservoir-boathouse')!;
const lake = res.data.drawdown!;
/** A fresh copy of the Reservoir with the lake drawn down (drain() changes the map it is called on). */
const lowWater = () => { const m = new TileMap(res.data); m.drain(true); return m; };
const objectsOf = <K extends MapObject['kind']>(kind: K) => res.data.objects.filter((o): o is Extract<MapObject, { kind: K }> => o.kind === kind);
const sister = objectsOf('sister')[0]!;
const fire = objectsOf('fireplace')[0]!;
const jon = objectsOf('npc').find(o => o.id === 'jon')!;
const dam = (x: number, y: number) => res.data.tiles[y]?.[x] === 'l';
/** The knoll: ground in the lake, Jon's fire on it, and every walkable tile joined to it without crossing the bed. */
const knoll = (() => {
  const seen = new Set([`${fire.x},${fire.y + 1}`]), queue: Array<[number, number]> = [[fire.x, fire.y + 1]];
  for (let h = 0; h < queue.length; h++) for (const d of DIRS) {
    const n = stepTarget(queue[h]![0], queue[h]![1], d);
    if (res.walkable(n.x, n.y) && !seen.has(`${n.x},${n.y}`)) { seen.add(`${n.x},${n.y}`); queue.push([n.x, n.y]); }
  }
  return [...seen].map(k => k.split(',').map(Number) as [number, number]);
})();
/** Steps from home to the nearest tile beside x,y on map m (-1: none). */
const beside = (m: TileMap, x: number, y: number) => Math.min(Infinity, ...DIRS.map(d => stepTarget(x, y, d)).map(n => m.homeSteps(n.x, n.y)).filter(s => s >= 0));

describe('the Reservoir, where it is', () => {
  it('is a region at depth 1, in the wilds', () => {
    expect(res.data).toMatchObject({ name: 'The Reservoir', kind: 'wilds', depth: 1 });
  });

  it('is reached up the east road out of Stonebrook, off its east edge, and its way home goes back down it', () => {
    const road = town.data.exits.find(e => e.to === 'reservoir')!;
    expect(road).toMatchObject({ x: town.width - 1, dir: 'right' });
    expect([...maps.values()].filter(m => m.data.kind !== 'inside' && m.data.exits.some(e => e.to === 'reservoir')).map(m => m.data.id)).toEqual(['stonebrook']);
    const home = res.data.exits.find(e => e.home)!;
    expect(res.data.exits[0]).toBe(home);
    expect(home).toMatchObject({ x: 0, to: 'stonebrook', tx: road.x - 1, ty: road.y, dir: 'left' });
    expect(road).toMatchObject({ tx: home.x + 1, ty: home.y });
    expect(town.walkable(home.tx, home.ty)).toBe(true);
    expect(res.walkable(road.tx, road.ty)).toBe(true);
  });

  it('is calm: no surge, storm, flash, watcher or skulker (the surges come down the woods and die at town), and rains once a day', () => {
    for (const k of ['surge', 'storm', 'flashes', 'watchers', 'skulkers'] as const) expect(res.data[k], k).toBeUndefined();
    expect(res.data.rain).toHaveLength(1);
  });

  it('crosses the valley\'s mouth on a dam: a paved crest, railed on its downstream side but where the way home comes up onto it', () => {
    const crestX = Math.min(...res.data.tiles.flatMap(r => [...r].flatMap((c, x) => (c === 'l' ? [x] : []))));
    const rail = objectsOf('fence').filter(f => f.x === crestX - 1);
    expect(rail.length).toBeGreaterThan(8);
    for (const f of rail) expect(dam(crestX, f.y), `${f.x},${f.y}`).toBe(true);
    const home = res.data.exits.find(e => e.home)!;
    expect(res.homeSteps(crestX, home.y)).toBe(res.homeSteps(crestX - 1, home.y) + 1);
  });
});

describe('the Reservoir, what it costs', () => {
  it('tires you as the Near Woods do at the same distance in', () => {
    const tileAt = (m: TileMap, steps: number): [number, number] => {
      for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (m.homeSteps(x, y) === steps && m.walkable(x, y) && !m.warm(x, y)) return [x, y];
      throw new Error(`no tile ${steps} steps in`);
    };
    for (const s of [1, 20, 40]) expect(energyRate(res, ...tileAt(res, s), 'night')).toBeCloseTo(energyRate(near, ...tileAt(near, s), 'night'), 9);
  });

  it('has its safe fire in the keeper\'s house by the way home, which Agnes keeps, with a crate for whoever comes next', () => {
    const shelters = res.data.exits.map(e => maps.get(e.to)!).filter(m => m.data.kind === 'inside' && m.data.objects.some(o => o.kind === 'fireplace'));
    expect(shelters.map(m => m.data.id)).toEqual(['reservoir-keepers-house']);
    expect(keepers.data.objects.find(o => o.kind === 'fireplace')).toMatchObject({ tended: true });
    expect(keepers.data.objects.filter(o => o.kind === 'cache')).toHaveLength(1);
    expect(keepers.data.objects.find(o => o.kind === 'npc')).toMatchObject({ id: 'agnes' });
    const door = res.data.exits.find(e => e.to === 'reservoir-keepers-house')!;
    expect(res.homeSteps(door.x, door.y + 1)).toBeLessThan(10);
  });

  it('lets a level 1 player with nothing but the starter gear walk from the way home to the Sister and back in one low water, at night, with most of the bar to spare', () => {
    const m = lowWater();
    const steps = beside(m, sister.x, sister.y);
    expect(steps).toBeGreaterThan(30);
    const { down, warn } = lake;
    // There and back before the water even starts back.
    expect((2 * steps * STEP_MS) / 1000).toBeLessThan(down - warn);
    const tileAt = (s: number): [number, number] => {
      for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (m.homeSteps(x, y) === s && m.walkable(x, y) && !m.warm(x, y)) return [x, y];
      throw new Error(`no tile ${s} steps in`);
    };
    let cost = 0;
    for (let s = 1; s <= steps; s++) cost += -energyRate(m, ...tileAt(s), 'night') * (STEP_MS / 1000);
    expect(2 * cost).toBeLessThan(maxEnergy(1) / 4);
  });
});

describe('the lake', () => {
  const bed = new Set(lake.tiles.map(([x, y]) => `${x},${y}`));
  const water: Array<[number, number]> = [];
  for (let y = 0; y < res.height; y++) for (let x = 0; x < res.width; x++) if (res.data.tiles[y]![x] === 'w') water.push([x, y]);
  const damX = Math.max(...res.data.tiles.flatMap(r => [...r].flatMap((c, x) => (c === 'l' ? [x] : []))));
  const lakeWater = water.filter(([x]) => x > damX);

  it('draws down on its bed, most of the lake, the drowned valley: water tiles, walked on only while it is down', () => {
    expect(lake.name).toBe('the reservoir');
    expect(bed.size).toBeGreaterThan(lakeWater.length * 0.8);
    for (const [x, y] of lake.tiles) expect(res.kind(x, y), `${x},${y}`).toBe('water');
    const m = lowWater();
    expect(lake.tiles.filter(([x, y]) => m.walkable(x, y)).length).toBeGreaterThan(bed.size * 0.9);
    expect(lake.tiles.some(([x, y]) => res.walkable(x, y))).toBe(false);
  });

  it('never drains next to the dam: a band of water along it stays, so the lake never empties and the bed never meets the dam', () => {
    const stays = lakeWater.filter(([x, y]) => !bed.has(`${x},${y}`));
    expect(stays.length).toBeGreaterThan(40);
    for (const [x, y] of stays) expect(x - damX, `${x},${y}`).toBeLessThanOrEqual(4);
    for (const [x, y] of lakeWater.filter(([x]) => x === damX + 1)) expect(bed.has(`${x},${y}`), `${x},${y}`).toBe(false);
    for (const [x, y] of lake.tiles) for (const d of DIRS) { const n = stepTarget(x, y, d); expect(dam(n.x, n.y), `${x},${y}`).toBe(false); }
  });

  it('draws down twice for every pulse of the Tower, for five minutes, the last of them a warning, just as the Near Woods\' surge breaks', () => {
    expect(lake).toMatchObject({ every: 1200, down: 300, warn: 60 });
    const surge = near.data.surge!;
    expect(surge.every).toBe(2 * lake.every);
    let breaks = 0;
    for (let s = 0; s < surge.every; s++) {
      const broke = surgeAt(surge, s * 1000).phase === 'surge' && surgeAt(surge, (s - 1) * 1000).phase !== 'surge';
      const drew = drawdownAt(lake, s * 1000).phase === 'down' && drawdownAt(lake, (s - 1) * 1000).phase === 'full';
      if (broke) { breaks++; expect(drew, `${s}`).toBe(true); }
    }
    expect(breaks).toBe(1);
  });
});

describe('the drowned valley and the Sister', () => {
  it('holds the farm (its house and byre fallen in, its table), the lane with the farm\'s car on it, fences and stumps, all on the bed', () => {
    const bed = new Set(lake.tiles.map(([x, y]) => `${x},${y}`));
    const onBed = (o: MapObject) => objectTiles(o).every(([x, y]) => bed.has(`${x},${y}`));
    expect(objectsOf('ruin').filter(onBed)).toHaveLength(2);
    expect(objectsOf('car').filter(onBed)).toHaveLength(1);
    expect(objectsOf('table').filter(onBed)).toHaveLength(1);
    expect(objectsOf('fence').filter(onBed).length).toBeGreaterThan(10);
    expect(objectsOf('stump').filter(onBed).length).toBeGreaterThan(10);
    // Only what the water hides stands on the bed.
    const hidden = new Set(['ruin', 'car', 'table', 'fence', 'stump', 'sister', 'note']);
    expect(res.data.objects.filter(o => !hidden.has(o.kind) && objectTiles(o).some(([x, y]) => bed.has(`${x},${y}`))).map(o => o.kind)).toEqual([]);
  });

  it('stands the Sister at the deepest of the bed, the farthest from any ground, read from beside her only at low water', () => {
    const W = res.width, deep = new Int32Array(W * res.height).fill(-1), queue: number[] = [];
    for (let i = 0; i < deep.length; i++) if (res.data.tiles[(i / W) | 0]![i % W] !== 'w') { deep[i] = 0; queue.push(i); }
    for (let h = 0; h < queue.length; h++) for (const d of DIRS) {
      const n = stepTarget(queue[h]! % W, (queue[h]! / W) | 0, d), j = n.y * W + n.x;
      if (res.inside(n.x, n.y) && deep[j]! < 0) { deep[j] = deep[queue[h]!]! + 1; queue.push(j); }
    }
    expect(objectsOf('sister')).toHaveLength(1);
    expect(lake.tiles).toContainEqual([sister.x, sister.y]);
    expect(deep[sister.y * W + sister.x]).toBe(Math.max(...lake.tiles.map(([x, y]) => deep[y * W + x]!)));
    expect(sister.text.length).toBeGreaterThan(0);
    expect(beside(res, sister.x, sister.y)).toBe(Infinity);
    expect(beside(lowWater(), sister.x, sister.y)).toBeLessThan(Infinity);
    expect(res.data.places).toContainEqual({ name: 'the Sister', x: sister.x, y: sister.y });
  });
});

describe('Jon\'s knoll', () => {
  it('is ground in the lake, ringed by the bed, reached only across it at low water', () => {
    expect(knoll.length).toBeGreaterThan(12);
    const m = lowWater();
    for (const [x, y] of knoll) {
      expect(res.homeSteps(x, y), `${x},${y}`).toBe(-1);
      expect(m.homeSteps(x, y), `${x},${y}`).toBeGreaterThan(0);
    }
    // Nothing leads onto it: no exit anywhere arrives there.
    const on = new Set(knoll.map(([x, y]) => `${x},${y}`));
    for (const other of maps.values()) for (const e of other.data.exits) if (e.to === 'reservoir') expect(on.has(`${e.tx},${e.ty}`), `${other.data.id}`).toBe(false);
  });

  it('keeps Jon by his fire in the open, which he keeps, his upturned boat and a crate for whoever comes next by it', () => {
    const on = new Set(knoll.map(([x, y]) => `${x},${y}`));
    const nextTo = (o: MapObject) => DIRS.some(d => { const n = stepTarget(o.x, o.y, d); return on.has(`${n.x},${n.y}`); });
    expect(fire).toMatchObject({ tended: true });
    expect(objectsOf('fireplace')).toHaveLength(1);
    expect(nextTo(fire) && nextTo(jon)).toBe(true);
    expect(objectsOf('boat').filter(nextTo)).toHaveLength(1);
    const cache = objectsOf('cache')[0]!;
    expect(Math.max(Math.abs(cache.x - fire.x), Math.abs(cache.y - fire.y))).toBeLessThanOrEqual(3);
  });

  it('has one way off at high water, the landing, where Jon rows you into the boathouse, whose door gives onto the dam', () => {
    const on = new Set(knoll.map(([x, y]) => `${x},${y}`));
    const off = res.data.exits.filter(e => on.has(`${e.x},${e.y}`));
    expect(off).toHaveLength(1);
    const door = res.data.exits.find(e => e.to === 'reservoir-boathouse' && !on.has(`${e.x},${e.y}`))!;
    expect(off[0]).toMatchObject({ to: 'reservoir-boathouse', tx: door.tx, ty: door.ty });
    const out = boathouse.data.exits[0]!;
    expect(out.to).toBe('reservoir');
    expect(res.homeSteps(out.tx, out.ty)).toBeGreaterThanOrEqual(0);
    expect([-2, -1, 0, 1, 2].some(dx => [-2, -1, 0, 1, 2].some(dy => dam(out.tx + dx, out.ty + dy)))).toBe(true);
  });
});

describe('the Brandts\' notes', () => {
  const notes = [...notesOf([...maps.values()].map(m => m.data)).values()].filter(n => n.note.by === 'brandts');
  const on = (n: (typeof notes)[number]) => n.map.objects.find(o => o.kind !== 'note' && objectTiles(o).some(([x, y]) => x === n.note.x && y === n.note.y))!;

  it('are eight: Agnes\'s keeper\'s log in her house and on the dam, Jon\'s slates on the drowned farm\'s car and table, at his camp and in his boathouse', () => {
    expect(notes.map(n => n.note.id).sort()).toEqual([
      'brandts-log-dam', 'brandts-log-hum', 'brandts-log-letter', 'brandts-log-night', 'brandts-slate-camp', 'brandts-slate-car', 'brandts-slate-sluice', 'brandts-slate-table',
    ]);
    const where = Object.fromEntries(notes.map(n => [n.note.id, `${n.map.id} ${on(n).kind}`]));
    expect(where).toEqual({
      'brandts-log-dam': 'reservoir crate', 'brandts-log-letter': 'reservoir-keepers-house table', 'brandts-log-night': 'reservoir-keepers-house shelf',
      'brandts-log-hum': 'reservoir-keepers-house table', 'brandts-slate-car': 'reservoir car', 'brandts-slate-table': 'reservoir table',
      'brandts-slate-camp': 'reservoir crate', 'brandts-slate-sluice': 'reservoir-boathouse shelf',
    });
  });

  it('lie on the bed where the farm\'s car and table are read only from the knoll, and the log on the dam\'s crate by the way home', () => {
    const m = lowWater();
    for (const id of ['brandts-slate-car', 'brandts-slate-table']) {
      const n = notes.find(x => x.note.id === id)!;
      expect(lake.tiles, id).toContainEqual([n.note.x, n.note.y]);
      expect(beside(res, n.note.x, n.note.y), id).toBe(Infinity);
      expect(beside(m, n.note.x, n.note.y), id).toBeLessThan(Infinity);
    }
    const dam = notes.find(x => x.note.id === 'brandts-log-dam')!;
    expect(beside(res, dam.note.x, dam.note.y)).toBeLessThan(Infinity);
  });

  it('open each side\'s scene with the other: Agnes tells "Jon" once his slates on the bed are read, Jon "Agnes" once her log is, and each a last one once both sides are', () => {
    const scenes = story.scenes!.filter(s => s.who === 'agnes' || s.who === 'jon');
    expect(scenes.map(s => [s.who, s.title])).toEqual([['agnes', 'Jon'], ['jon', 'Agnes'], ['agnes', 'The kettle'], ['jon', 'Tell her']]);
    const by = (id: string) => notes.find(n => n.note.id === id)!.note.id.split('-')[1];
    expect(scenes[0]!.when.notes!.every(id => by(id) === 'slate')).toBe(true);
    expect(scenes[1]!.when.notes!.every(id => by(id) === 'log')).toBe(true);
    for (const s of scenes.slice(2)) expect([...s.when.notes!].sort()).toEqual(notes.map(n => n.note.id).sort());
    for (const s of scenes) expect(s.when.level, s.id).toBeLessThanOrEqual(3);
  });

  it('leave open what Agnes\'s last page says: the Sister hums before the Tower pulses, not after', () => {
    expect(notes.find(n => n.note.id === 'brandts-log-hum')!.note.text.join(' ')).toMatch(/Before it\. She doesn't answer\. She starts it\./);
  });
});

describe('the Reservoir, what it gives', () => {
  it('gives what the shore gives, nothing new: glowcaps, resin, scrap by the dam\'s gear, a thermos by Agnes\'s fire', () => {
    const byId = itemIndex(items);
    const rules = items.finds.filter(f => f.map === 'reservoir' || f.map === 'reservoir-keepers-house');
    expect(rules.map(f => f.item).sort()).toEqual(['glowcap', 'resin', 'scrap', 'thermos']);
    for (const f of rules) expect(byId.get(f.item)?.kind, f.item).not.toBe('tool');
  });

  it('has a paper map of its own, the keeper\'s, charting it', () => {
    expect(itemIndex(items).get('reservoir-map')).toMatchObject({ kind: 'tool', chart: 'reservoir', icon: 'map' });
  });
});
