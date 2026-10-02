/**
 * The Ridge as it ships (roadmap/the-ridge.md, docs/DESIGN.md): the region at depth 4, up the trappers' fixed
 * rope north of the Burn's scar, which holds only with three on it. Where it is and how it joins the Burn,
 * what it costs, the high hut on the way, the icefall and the crampons that climb it, its clock and its snow,
 * what it gives, and its map, found there.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GATE_PULLERS, STARTER_TOOLS, TILE_NEEDS, TileMap, energyRate, findTiles, itemIndex, maxEnergy, stormAt, surgeAt, type ItemsData, type MapData, type MapObject, type Season,
} from '@napoland/shared';

const content = resolve(import.meta.dirname, '../../content');
const items = JSON.parse(readFileSync(resolve(content, 'items.json'), 'utf8')) as ItemsData;
const maps = new Map(readdirSync(resolve(content, 'maps')).filter(f => f.endsWith('.json')).map(f => {
  const data = JSON.parse(readFileSync(resolve(content, 'maps', f), 'utf8')) as MapData;
  return [data.id, new TileMap(data)] as const;
}));
const ridge = maps.get('ridge')!, burn = maps.get('burn')!, far = maps.get('far-woods')!, near = maps.get('near-woods')!, hut = maps.get('ridge-high-hut')!;
const byId = itemIndex(items);
const rope = burn.data.objects.find((o): o is Extract<MapObject, { kind: 'gate' }> => o.kind === 'gate')!;
const CRAMPONS = new Set(['crampons']);
/** Steps from home to the tile in front of the door into room `id` on `map`. */
const frontOf = (map: TileMap, id: string) => {
  const e = map.data.exits.find(x => x.to === id)!;
  return map.homeSteps(e.x, e.y + 1);
};
/** A tile `steps` from home, out of a fire's reach. */
const tileAt = (map: TileMap, steps: number): [number, number] => {
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.homeSteps(x, y) === steps && map.walkable(x, y) && !map.warm(x, y)) return [x, y];
  throw new Error(`no tile ${steps} steps from home in ${map.data.id}`);
};
/** Energy for a walk from `from` steps to `to` steps from a map's way home, without a stop, a step every 0.2 s. */
const walkCost = (map: TileMap, from: number, to: number) => {
  let e = 0;
  for (let s = from + 1; s <= to; s++) e += -energyRate(map, ...tileAt(map, Math.min(s, map.deepest)), 'night') * 0.2;
  return e;
};
/** Walking steps between two tiles on a map, with what `pass` opens (-1: no way). */
function between(map: TileMap, a: readonly [number, number], b: readonly [number, number], pass?: ReadonlySet<string>): number {
  const W = map.width, d = new Int32Array(W * map.height).fill(-1), q = [a[1] * W + a[0]];
  d[q[0]!] = 0;
  for (let h = 0; h < q.length; h++) {
    const i = q[h]!, x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = x + dx, ny = y + dy;
      if (map.walkable(nx, ny, pass) && d[ny * W + nx]! < 0) { d[ny * W + nx] = d[i]! + 1; q.push(ny * W + nx); }
    }
  }
  return d[b[1] * W + b[0]]!;
}
const place = (name: string) => { const p = ridge.data.places!.find(q => q.name === name)!; return [p.x, p.y] as const; };
const icefall = (): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let y = 0; y < ridge.height; y++) for (let x = 0; x < ridge.width; x++) if (ridge.kind(x, y) === 'icefall') out.push([x, y]);
  return out;
};

describe('the Ridge, where it is', () => {
  it('is the region at depth 4: snow, in the wilds, smaller than the Burn', () => {
    expect(ridge.data).toMatchObject({ name: 'The Ridge', kind: 'wilds', depth: 4, forest: 'snow' });
    // Above it only the Quiet, up its own rope (roadmap/the-quiet.md).
    expect([...maps.values()].filter(m => m.data.depth >= 4).map(m => [m.data.id, m.data.depth]).sort()).toEqual([['quiet', 5], ['ridge', 4]]);
    expect(ridge.width * ridge.height).toBeLessThan(burn.width * burn.height);
  });

  it('is reached only up the trappers\' rope north of the Burn\'s scar, which holds only with three on it', () => {
    // Nothing leads up onto it but the rope: only the way home down from the Quiet, above it, comes back to it.
    expect([...maps.values()].filter(m => m.data.kind !== 'inside' && m.data.exits.some(e => e.to === 'ridge' && !(e.home && m.data.depth > 4))).map(m => m.data.id)).toEqual([]);
    expect(rope).toMatchObject({ to: 'ridge', look: 'rope', pullers: 3, w: 3 });
    expect(rope.pullers!).toBeGreaterThan(GATE_PULLERS);
    // Deeper in than the scar: past it, at the head of the cut through its lip.
    expect(burn.homeSteps(rope.x + 1, rope.y + 1)).toBeGreaterThan(burn.homeSteps(...[burn.data.places!.find(p => p.name === 'the scar')!].map(p => [p.x, p.y] as const)[0]!));
    expect(rope.text.join(' ')).toMatch(/Three on the rope/);
    expect(rope.text.length).toBeLessThanOrEqual(3);
  });

  it('comes out on open ground at its bottom, and its way home comes back under the rope, so nobody is shut in', () => {
    for (let k = 0; k < rope.w; k++) expect(ridge.walkable(rope.tx + k, rope.ty), `${k}`).toBe(true);
    const home = ridge.data.exits.find(e => e.home)!;
    expect(home).toMatchObject({ to: 'burn', tx: rope.x, ty: rope.y + 1, w: rope.w });
    expect(home.y).toBe(rope.ty + 1);
  });
});

describe('the Ridge, what it costs', () => {
  it('tires you four times as fast as the Near Woods at the same distance in', () => {
    for (const s of [1, 30, 60]) expect(energyRate(ridge, ...tileAt(ridge, s), 'night')).toBeCloseTo(4 * energyRate(near, ...tileAt(near, s), 'night'), 9);
  });

  it('has one shelter, the high hut, whose fire nobody keeps, and a crate for whoever comes next', () => {
    const shelters = ridge.data.exits.map(e => maps.get(e.to)!).filter(m => m.data.kind === 'inside' && m.data.objects.some(o => o.kind === 'fireplace'));
    expect(shelters.map(m => m.data.id)).toEqual(['ridge-high-hut']);
    expect(hut.data.objects.find(o => o.kind === 'fireplace')).not.toMatchObject({ tended: true });
    expect(hut.data.objects.filter(o => o.kind === 'cache')).toHaveLength(1);
  });

  it('is hard but fair with the hut\'s fire fed: from it to the deepest spot and back at night is within two thirds of a new player\'s bar, and without it, from the line cabin\'s fire in the Burn, more than a level 5 bar', () => {
    const fire = frontOf(ridge, 'ridge-high-hut');
    expect(fire).toBeLessThan(ridge.deepest / 2);
    expect(2 * walkCost(ridge, fire, ridge.deepest)).toBeLessThan(maxEnergy(1) * 0.67);
    // Harder than the Burn's own loop from its fire to the scar.
    expect(2 * walkCost(ridge, fire, ridge.deepest)).toBeGreaterThan(2 * walkCost(burn, frontOf(burn, 'burn-line-cabin'), burn.deepest));
    const line = frontOf(burn, 'burn-line-cabin'), under = burn.homeSteps(rope.x, rope.y + 1);
    expect(2 * (walkCost(burn, line, under) + walkCost(ridge, 0, ridge.deepest))).toBeGreaterThan(maxEnergy(5));
  });
});

describe('the icefall', () => {
  it('opens only in crampons, a tool made at the workbench from rime quartz found only on the Ridge', () => {
    expect(TILE_NEEDS.icefall).toBe('crampons');
    expect(byId.get('crampons')).toMatchObject({ kind: 'tool', icon: 'crampons' });
    expect(STARTER_TOOLS).not.toContain('crampons');
    const recipe = items.recipes!.find(r => r.make === 'crampons')!;
    expect(recipe.needs.map(n => n.item)).toContain('rime-quartz');
    expect(items.finds.filter(f => f.item === 'rime-quartz').map(f => f.map)).toEqual(['ridge']);
    expect([...maps.values()].filter(m => m.data.id !== 'ridge' && [...Array(m.height).keys()].some(y => [...Array(m.width).keys()].some(x => m.kind(x, y) === 'icefall'))).map(m => m.data.id)).toEqual([]);
  });

  it('is nobody\'s ground without crampons, not even the way home\'s: how deep a tile is goes as if nobody climbs it', () => {
    const ice = icefall();
    expect(ice.length).toBeGreaterThanOrEqual(20);
    for (const [x, y] of ice) {
      expect(ridge.walkable(x, y), `${x},${y}`).toBe(false);
      expect(ridge.walkable(x, y, CRAMPONS), `${x},${y}`).toBe(true);
    }
  });

  it('is the short way from the high hut to the crest, joined at both ends to ground anyone walks', () => {
    const door = ridge.data.exits.find(e => e.to === 'ridge-high-hut')!, front = [door.x, door.y + 1] as const, crest = place('the crest');
    const long = between(ridge, front, crest), short = between(ridge, front, crest, CRAMPONS);
    expect(long).toBeGreaterThan(0);
    expect(short).toBeLessThanOrEqual(long - 25);
  });
});

describe('the Ridge\'s weather and clock', () => {
  it('snows once a day while nothing else falls lower down, and never storms, but surges and flashes', () => {
    expect(ridge.data.rain!.length).toBe(1);
    expect(ridge.data.storm).toBeUndefined();
    expect(ridge.data.surge).toBeDefined();
    expect(ridge.data.flashes).toBeDefined();
    const falls = (m: MapData, s: number) => (m.rain ?? []).some(r => s >= r.from && s < r.from + r.length);
    for (let s = 0; s < 2880; s++) if (falls(ridge.data, s)) {
      expect(falls(far.data, s), `${s}`).toBe(false);
      expect(falls(near.data, s), `${s}`).toBe(false);
    }
  });

  it('surges while neither the Burn, the Far Woods nor the Near Woods are restless, surging or storming, in any season', () => {
    const busy = (m: MapData, s: number, season: Season) => (m.surge ? surgeAt(m.surge, s * 1000).phase !== 'calm' : false) || (m.storm ? stormAt(m.storm, s * 1000, season).phase !== 'clear' : false);
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) for (let s = 0; s < 2400; s++) {
      if (!busy(ridge.data, s, season)) continue;
      for (const m of [burn, far, near]) expect(busy(m.data, s, season), `${m.data.id} ${season} ${s}`).toBe(false);
    }
  });

  it('keeps quicker watchers than the Burn\'s, and nothing lying in wait: no ferns grow in the snow', () => {
    expect(ridge.data.watchers!.stepMs).toBeLessThan(burn.data.watchers!.stepMs!);
    expect(ridge.data.skulkers).toBeUndefined();
  });
});

describe('the Ridge, what it gives', () => {
  it('gives rime quartz, found only on the crest\'s bare rock, and worth more than fused glass', () => {
    const quartz = byId.get('rime-quartz')!;
    expect(quartz).toMatchObject({ kind: 'resource' });
    expect(quartz.xp!).toBeGreaterThan(byId.get('fused-glass')!.xp!);
    for (const f of items.finds.filter(f => f.item === 'rime-quartz')) expect(findTiles(ridge, f).length).toBeGreaterThanOrEqual(3 * f.count);
  });

  it('has its paper map torn in four pieces across it, one in each quarter, found and not given, growing back for the next', () => {
    expect(byId.get('ridge-map')).toMatchObject({ kind: 'tool', chart: 'ridge', icon: 'map' });
    expect(STARTER_TOOLS).not.toContain('ridge-map');
    const rules = items.finds.filter(f => f.item === 'ridge-map');
    expect(rules.map(r => r.piece).sort()).toEqual([0, 1, 2, 3]);
    for (const rule of rules) {
      expect(rule.map).toBe('ridge');
      expect(rule.count).toBe(1);
      expect(rule.respawn[1]).toBeLessThanOrEqual(180);
    }
  });
});
