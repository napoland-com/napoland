/**
 * The Marsh as it ships (roadmap/the-marsh.md, docs/DESIGN.md): a region at depth 3 east of the Far Woods, along
 * the loggers' corduroy road out of their old camp, open to anyone. Where it is and how it joins the Far Woods,
 * what it costs, the cutters' hut, the boardwalks everyone mends and the long ways round them, its clock, what
 * lives in its reeds, and what it gives: peat, and its map.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  STARTER_TOOLS, TileMap, energyRate, findTiles, itemIndex, maxEnergy, objectTiles, stormAt, surgeAt, type ItemsData, type MapData, type MapObject, type Season,
} from '@napoland/shared';

const content = resolve(import.meta.dirname, '../../content');
const items = JSON.parse(readFileSync(resolve(content, 'items.json'), 'utf8')) as ItemsData;
const maps = new Map(readdirSync(resolve(content, 'maps')).filter(f => f.endsWith('.json')).map(f => {
  const data = JSON.parse(readFileSync(resolve(content, 'maps', f), 'utf8')) as MapData;
  return [data.id, new TileMap(data)] as const;
}));
const marsh = maps.get('marsh')!, far = maps.get('far-woods')!, near = maps.get('near-woods')!, burn = maps.get('burn')!, hut = maps.get('marsh-cutters-hut')!;
const byId = itemIndex(items);
const boardwalks = marsh.data.objects.filter((o): o is Extract<MapObject, { kind: 'footbridge' }> => o.kind === 'footbridge');
/** Steps from home to the tile in front of the door into room `id` on `map`. */
const frontOf = (map: TileMap, id: string) => {
  const e = map.data.exits.find(x => x.to === id)!;
  return map.homeSteps(e.x, e.y + 1);
};
const tileAt = (map: TileMap, steps: number): [number, number] => {
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.homeSteps(x, y) === steps && map.walkable(x, y) && !map.warm(x, y)) return [x, y];
  throw new Error(`no tile ${steps} steps from home in ${map.data.id}`);
};
const walkCost = (map: TileMap, from: number, to: number) => {
  let e = 0;
  for (let s = from + 1; s <= to; s++) e += -energyRate(map, ...tileAt(map, Math.min(s, map.deepest)), 'night') * 0.2;
  return e;
};
/** Walking steps from the way home to a tile, with what `pass` opens (the boardwalks that stand). */
function walk(map: TileMap, to: readonly [number, number], pass?: ReadonlySet<string>): number {
  const W = map.width, home = map.data.exits.find(e => e.home)!, d = new Int32Array(W * map.height).fill(-1);
  const start = [home.x + 1, home.y] as const, q = [start[1] * W + start[0]];
  d[q[0]!] = 0;
  for (let h = 0; h < q.length; h++) {
    const i = q[h]!, x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = x + dx, ny = y + dy;
      if (map.walkable(nx, ny, pass) && d[ny * W + nx]! < 0) { d[ny * W + nx] = d[i]! + 1; q.push(ny * W + nx); }
    }
  }
  return d[to[1] * W + to[0]]!;
}
const place = (name: string) => { const p = marsh.data.places!.find(q => q.name === name)!; return [p.x, p.y] as const; };

describe('the Marsh, where it is', () => {
  it('is a region at depth 3, marsh, in the wilds, open to anyone: no gate on the way', () => {
    expect(marsh.data).toMatchObject({ name: 'The Marsh', kind: 'wilds', depth: 3, forest: 'marsh' });
    expect([...maps.values()].filter(m => m.data.objects.some(o => o.kind === 'gate' && o.to === 'marsh'))).toEqual([]);
  });

  it('is reached along the corduroy road east out of the Far Woods\' old camp, and its way home goes back along it', () => {
    const road = far.data.exits.find(e => e.to === 'marsh')!;
    expect(road).toMatchObject({ x: far.width - 1, dir: 'right' });
    expect([...maps.values()].filter(m => m.data.kind !== 'inside' && m.data.exits.some(e => e.to === 'marsh')).map(m => m.data.id)).toEqual(['far-woods']);
    // Nearer the camp than the hollow: the Marsh is the way on for whoever cannot yet go up through the gate.
    const camp = far.data.places!.find(p => p.name === 'the old camp')!;
    const atCamp = Math.min(...[-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => far.homeSteps(camp.x + dx, camp.y + dy))).filter(s => s > 0));
    expect(far.homeSteps(road.x - 1, road.y) - atCamp).toBeLessThan(20);
    expect(marsh.walkable(road.tx, road.ty)).toBe(true);
    const home = marsh.data.exits.find(e => e.home)!;
    expect(home).toMatchObject({ to: 'far-woods', tx: road.x - 1, ty: road.y });
    expect(far.walkable(home.tx, home.ty)).toBe(true);
  });
});

describe('the Marsh, what it costs', () => {
  it('tires you three times as fast as the Near Woods at the same distance in', () => {
    for (const s of [1, 30, 60]) expect(energyRate(marsh, ...tileAt(marsh, s), 'night')).toBeCloseTo(3 * energyRate(near, ...tileAt(near, s), 'night'), 9);
  });

  it('has one shelter, the cutters\' hut, whose fire nobody keeps, and a crate for whoever comes next', () => {
    const shelters = marsh.data.exits.map(e => maps.get(e.to)!).filter(m => m.data.kind === 'inside' && m.data.objects.some(o => o.kind === 'fireplace'));
    expect(shelters.map(m => m.data.id)).toEqual(['marsh-cutters-hut']);
    expect(hut.data.objects.find(o => o.kind === 'fireplace')).not.toMatchObject({ tended: true });
    expect(hut.data.objects.filter(o => o.kind === 'cache')).toHaveLength(1);
  });

  it('is fair alone with the hut\'s fire fed: from it to the black pool and back at night, the long way, is within a level 10 bar', () => {
    const fire = frontOf(marsh, 'marsh-cutters-hut'), pool = marsh.homeSteps(...place('the black pool'));
    expect(fire).toBeLessThan(pool / 3);
    expect(2 * walkCost(marsh, fire, pool)).toBeLessThan(maxEnergy(10));
    // And it is no harder than the Burn's scar from its fire, which takes two to reach.
    expect(pool).toBeLessThanOrEqual(burn.homeSteps(...[burn.data.places!.find(p => p.name === 'the scar')!].map(p => [p.x, p.y] as const)[0]!) + 10);
  });
});

describe('the boardwalks', () => {
  it('are two, across the two channels, mended by everyone: one takes scrap, the other copper wire', () => {
    expect(boardwalks.map(b => b.id)).toEqual(['marsh-boardwalk-west', 'marsh-boardwalk-east']);
    for (const b of boardwalks) {
      for (const [x, y] of objectTiles(b)) expect(marsh.kind(x, y), `${b.id} ${x},${y}`).toBe('water');
      expect(items.works!.find(w => w.id === b.id)).toMatchObject({ build: 'footbridge' });
    }
    expect(items.works!.filter(w => w.id.startsWith('marsh-')).map(w => w.item)).toEqual(['scrap', 'wire']);
  });

  it('are shortcuts, never the only way: broken, the long way round goes by the channels\' head and foot, and standing, the pool is 20 steps nearer', () => {
    const pool = place('the black pool');
    const long = walk(marsh, pool), short = walk(marsh, pool, new Set(boardwalks.map(b => b.id)));
    expect(long).toBeGreaterThan(0);
    expect(short).toBeLessThanOrEqual(long - 20);
    // How far from home a tile is, which the drain goes by, never changes with them.
    for (const b of boardwalks) for (const [x, y] of objectTiles(b)) expect(marsh.walkable(x, y)).toBe(false);
  });
});

describe('the Marsh\'s weather and clock', () => {
  it('rains once a day when nothing else falls lower down, never storms, but surges and flashes', () => {
    expect(marsh.data.rain!.length).toBe(1);
    expect(marsh.data.storm).toBeUndefined();
    expect(marsh.data.surge).toBeDefined();
    expect(marsh.data.flashes).toBeDefined();
    const falls = (m: MapData, s: number) => (m.rain ?? []).some(r => s >= r.from && s < r.from + r.length);
    for (let s = 0; s < 2880; s++) if (falls(marsh.data, s)) {
      expect(falls(far.data, s), `${s}`).toBe(false);
      expect(falls(near.data, s), `${s}`).toBe(false);
    }
  });

  it('surges while neither the Far Woods nor the Near Woods are restless, surging or storming, in any season', () => {
    const busy = (m: MapData, s: number, season: Season) => (m.surge ? surgeAt(m.surge, s * 1000).phase !== 'calm' : false) || (m.storm ? stormAt(m.storm, s * 1000, season).phase !== 'clear' : false);
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) for (let s = 0; s < 2400; s++) {
      if (!busy(marsh.data, s, season)) continue;
      for (const m of [far, near]) expect(busy(m.data, s, season), `${m.data.id} ${season} ${s}`).toBe(false);
    }
  });

  it('keeps skulkers in its reeds at night, more of them than the Far Woods, and quicker', () => {
    expect(marsh.data.skulkers).toMatchObject({ when: ['night'] });
    expect(marsh.data.skulkers!.count).toBeGreaterThan(far.data.skulkers!.count);
    expect(marsh.data.skulkers!.stepMs).toBeLessThan(far.data.skulkers!.stepMs!);
    expect(marsh.lairs(marsh.data.skulkers!.steps).length).toBeGreaterThan(0);
  });
});

describe('the Marsh, what it gives', () => {
  it('gives peat, found only in the Marsh, which burns longer than anything else a fire takes', () => {
    const peat = byId.get('peat')!;
    expect(peat).toMatchObject({ kind: 'resource' });
    const fuels = items.items.filter(i => i.fuel && i.id !== 'peat').map(i => i.fuel!);
    expect(peat.fuel!).toBeGreaterThan(Math.max(...fuels));
    expect(new Set(items.finds.filter(f => f.item === 'peat').map(f => f.map))).toEqual(new Set(['marsh', 'marsh-cutters-hut']));
    for (const f of items.finds.filter(f => f.item === 'peat' && f.map === 'marsh')) expect(findTiles(marsh, f).length).toBeGreaterThanOrEqual(3 * f.count);
  });

  it('keeps its paper map in the cutters\' hut, found and not given, growing back for the next', () => {
    expect(byId.get('marsh-map')).toMatchObject({ kind: 'tool', chart: 'marsh', icon: 'map' });
    expect(STARTER_TOOLS).not.toContain('marsh-map');
    const rule = items.finds.find(f => f.item === 'marsh-map')!;
    expect(rule.map).toBe('marsh-cutters-hut');
    expect(rule.respawn[1]).toBeLessThanOrEqual(180);
  });
});
