/**
 * The Burn as it ships (roadmap/deeper-regions.md, docs/DESIGN.md): the first region at depth 3, behind NAPO's
 * gate north of the Far Woods' hollow, which only two pulling together open. Where it is and how it joins the
 * Far Woods, what it costs, the line cabin on the way, its clock, creatures and finds, and its map, found there.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GATE_PULLERS, STARTER_TOOLS, TileMap, energyRate, findTiles, itemIndex, maxEnergy, stormAt, surgeAt, type ItemsData, type MapData, type MapObject, type Season,
} from '@napoland/shared';

const content = resolve(import.meta.dirname, '../../content');
const items = JSON.parse(readFileSync(resolve(content, 'items.json'), 'utf8')) as ItemsData;
const maps = new Map(readdirSync(resolve(content, 'maps')).filter(f => f.endsWith('.json')).map(f => {
  const data = JSON.parse(readFileSync(resolve(content, 'maps', f), 'utf8')) as MapData;
  return [data.id, new TileMap(data)] as const;
}));
const burn = maps.get('burn')!, far = maps.get('far-woods')!, near = maps.get('near-woods')!, line = maps.get('burn-line-cabin')!;
const byId = itemIndex(items);
const gate = far.data.objects.find((o): o is Extract<MapObject, { kind: 'gate' }> => o.kind === 'gate')!;
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

describe('the Burn, where it is', () => {
  it('is the first region at depth 3: a burnt forest, in the wilds, smaller than the Far Woods', () => {
    expect(burn.data).toMatchObject({ name: 'The Burn', kind: 'wilds', depth: 3, forest: 'burnt' });
    // The Marsh, east of the Far Woods, is as deep, but open to anyone: the Burn is the one behind a gate.
    expect([...maps.values()].filter(m => m.data.depth === 3).map(m => m.data.id).sort()).toEqual(['burn', 'marsh']);
    expect(burn.width * burn.height).toBeLessThan(far.width * far.height);
  });

  it('is reached only through NAPO\'s gate north of the Far Woods\' hollow, as wide as the two who must pull it', () => {
    // No exit leads in from anywhere outdoors (its cabin's door only leads back out, the Ridge's way home only back down).
    expect([...maps.values()].filter(m => m.data.kind !== 'inside' && m.data.exits.some(e => e.to === 'burn' && !e.home)).map(m => m.data.id)).toEqual([]);
    expect(gate).toMatchObject({ to: 'burn', w: GATE_PULLERS });
    // Deeper than anything in the Far Woods but the cut up to it: north of the field post, past the hollow.
    const post = far.data.exits.find(e => e.to === 'far-woods-field-post')!;
    expect(gate.y).toBeLessThan(post.y);
    expect(far.homeSteps(gate.x, gate.y + 1)).toBeGreaterThan(far.homeSteps(post.x, post.y + 1));
    // Its plate says it takes two, in three lines: with what pulling alone says, one text box.
    expect(gate.text.join(' ')).toMatch(/Two-person rule/);
    expect(gate.text.length).toBeLessThanOrEqual(3);
  });

  it('comes out on open ground at its bottom, and its way home comes back under the gate, so nobody is shut in', () => {
    for (let x = gate.x; x < gate.x + gate.w; x++) expect(burn.walkable(gate.tx + x - gate.x, gate.ty), `${x}`).toBe(true);
    const home = burn.data.exits.find(e => e.home)!;
    expect(home).toMatchObject({ to: 'far-woods', tx: gate.x, ty: gate.y + 1, w: gate.w });
    expect(home.y).toBe(gate.ty + 1);
  });
});

describe('the Burn, what it costs', () => {
  it('tires you three times as fast as the Near Woods at the same distance in', () => {
    for (const s of [1, 30, 60]) expect(energyRate(burn, ...tileAt(burn, s), 'night')).toBeCloseTo(3 * energyRate(near, ...tileAt(near, s), 'night'), 9);
  });

  it('has one shelter, the line cabin, whose fire nobody keeps, and a crate for whoever comes next', () => {
    const shelters = burn.data.exits.map(e => maps.get(e.to)!).filter(m => m.data.kind === 'inside' && m.data.objects.some(o => o.kind === 'fireplace'));
    expect(shelters.map(m => m.data.id)).toEqual(['burn-line-cabin']);
    expect(line.data.objects.find(o => o.kind === 'fireplace')).not.toMatchObject({ tended: true });
    expect(line.data.objects.filter(o => o.kind === 'cache')).toHaveLength(1);
  });

  it('is hard but fair with the line cabin\'s fire fed: from it to the scar and back at night is within a new player\'s bar, and without it more than a level 8 bar', () => {
    const fire = frontOf(burn, 'burn-line-cabin');
    expect(fire).toBeLessThan(burn.deepest / 2);
    expect(2 * walkCost(burn, fire, burn.deepest)).toBeLessThan(maxEnergy(1) * 0.6);
    // From the trapper's fire in the Far Woods through the gate to the scar and back, with no fire between.
    const trapper = frontOf(far, 'far-woods-trapper-cabin'), under = far.homeSteps(gate.x, gate.y + 1);
    expect(2 * (walkCost(far, trapper, under) + walkCost(burn, 0, burn.deepest))).toBeGreaterThan(maxEnergy(8));
  });
});

describe('the Burn\'s weather and clock', () => {
  it('never rains and never storms, but surges and flashes', () => {
    expect(burn.data.rain).toEqual([]);
    expect(burn.data.storm).toBeUndefined();
    expect(burn.data.surge).toBeDefined();
    expect(burn.data.flashes!.every).toBeLessThan(far.data.flashes!.every);
    expect(burn.data.skulkers!.when).toEqual(['night']);
  });

  it('surges while neither the Far Woods nor the Near Woods are restless, surging or storming, in any season', () => {
    const busy = (m: MapData, s: number, season: Season) => (m.surge ? surgeAt(m.surge, s * 1000).phase !== 'calm' : false) || (m.storm ? stormAt(m.storm, s * 1000, season).phase !== 'clear' : false);
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) for (let s = 0; s < 2400; s++) {
      if (!busy(burn.data, s, season)) continue;
      expect(busy(far.data, s, season), `${season} ${s}`).toBe(false);
      expect(busy(near.data, s, season), `${season} ${s}`).toBe(false);
    }
  });

  it('keeps quicker creatures than the Far Woods\'', () => {
    expect(burn.data.watchers!.stepMs).toBeLessThan(far.data.watchers!.stepMs!);
    expect(burn.data.skulkers!.stepMs).toBeLessThan(far.data.skulkers!.stepMs!);
  });
});

describe('the Burn, what it gives', () => {
  const always = (map: string, item: string) => items.finds.filter(f => f.map === map && f.item === item && f.when === undefined).reduce((n, f) => n + f.count, 0);

  it('holds more shards and strange objects than the Far Woods, on less ground', () => {
    for (const item of ['shard', 'strange']) expect(always('burn', item), item).toBeGreaterThan(always('far-woods', item));
  });

  it('gives fused glass, found only on the scar\'s bare ground, and worth more than a shard', () => {
    const glass = byId.get('fused-glass')!;
    expect(glass).toMatchObject({ kind: 'resource' });
    expect(glass.xp!).toBeGreaterThan(byId.get('shard')!.xp!);
    const rules = items.finds.filter(f => f.item === 'fused-glass');
    expect(rules.map(f => f.map)).toEqual(['burn']);
    for (const f of rules) expect(findTiles(burn, f).length).toBeGreaterThanOrEqual(3 * f.count);
  });

  it('shows how far NAPO got: its survey stakes up the trail end at the ash flats, by its snapped mast, short of the scar', () => {
    const at = (kind: MapObject['kind']) => burn.data.objects.filter(o => o.kind === kind).map(o => burn.homeSteps(o.x, o.y));
    const flats = burn.data.places!.find(p => p.name === 'the ash flats')!, scar = burn.data.places!.find(p => p.name === 'the scar')!;
    const stakes = at('stake');
    expect(stakes.length).toBeGreaterThanOrEqual(5);
    // Every stake can be walked up to, and the last stands about as deep as the flats: nothing of NAPO's nearer the scar.
    for (const s of stakes) expect(s).toBeGreaterThan(0);
    expect(Math.max(...stakes, ...at('antenna'))).toBeLessThan(burn.homeSteps(scar.x, scar.y) - 10);
    expect(Math.abs(Math.max(...stakes) - burn.homeSteps(flats.x, flats.y))).toBeLessThanOrEqual(8);
    expect(burn.data.objects.filter(o => o.kind === 'antenna')).toEqual([expect.objectContaining({ broken: true })]);
    const notice = burn.data.objects.find(o => o.kind === 'sign' && o.style === 'napo')!;
    expect(notice.kind === 'sign' && notice.text.join(' ')).toMatch(/last stake/);
    // Its old batteries turn up by the mast, for the lantern the scar's glass goes into.
    const rule = items.finds.find(f => f.item === 'battery' && f.map === 'burn')!;
    expect(findTiles(burn, rule).length).toBeGreaterThanOrEqual(3 * rule.count);
  });

  it('keeps its paper map in the line cabin, found and not given, growing back for the next', () => {
    expect(byId.get('burn-map')).toMatchObject({ kind: 'tool', chart: 'burn', icon: 'map' });
    expect(STARTER_TOOLS).not.toContain('burn-map');
    const rule = items.finds.find(f => f.item === 'burn-map')!;
    expect(rule.map).toBe('burn-line-cabin');
    expect(rule.respawn[1]).toBeLessThanOrEqual(180);
  });
});
