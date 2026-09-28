import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TileMap, UPGRADE_MAX, doorOf, findPath, findTiles, hidden, upgradable, upgradeChance, validateItems, type ItemsData, type MapData, type StoryData } from '@napoland/shared';

/** The content as it ships: content/items.json and every map. */
const content = resolve(import.meta.dirname, '../../content');
const items = JSON.parse(readFileSync(resolve(content, 'items.json'), 'utf8')) as ItemsData;
const maps = new Map(readdirSync(resolve(content, 'maps')).filter(f => f.endsWith('.json')).map(f => {
  const data = JSON.parse(readFileSync(resolve(content, 'maps', f), 'utf8')) as MapData;
  return [data.id, new TileMap(data)] as const;
}));

describe('cloth (roadmap/cloth-supply.md)', () => {
  const rules = items.finds.filter(f => f.item === 'cloth');

  it('grows 35 to 45 an hour for the whole server, enough to craft and mend: a raincoat in two good trips', () => {
    // Every find picked up the moment it grows, which is right once a few people play: count × 3600 /
    // the mean respawn, an hour. Only what grows every day: not on aurora nights, not on a condition's day.
    const perHour = rules
      .filter(f => f.when === undefined && f.condition === undefined)
      .reduce((n, f) => n + (f.count * 3600) / ((f.respawn[0] + f.respawn[1]) / 2), 0);
    expect(perHour).toBeGreaterThanOrEqual(35);
    expect(perHour).toBeLessThanOrEqual(45);
  });

  it('has room to grow wherever a rule puts it: three tiles or more a find', () => {
    for (const f of rules) expect(findTiles(maps.get(f.map)!, f).length, f.map).toBeGreaterThanOrEqual(3 * f.count);
  });
});

describe('a parcel a day (roadmap/daily-parcels.md)', () => {
  const p = items.parcels!;
  const said = (list: Array<{ item: string; count: number }>) => list.map(s => `${s.count} ${s.item}`).join(', ');

  it('welcomes whoever signs in with 5 resin, 4 cloth, a thermos and 2 road flares', () => {
    expect(said(p.welcome)).toBe('5 resin, 4 cloth, 1 thermos, 2 flare');
  });

  it('shares out the town\'s stores on a calendar of seven days, Monday first', () => {
    expect(p.week.map(said)).toEqual([
      '3 resin, 2 cloth', '1 thermos, 2 scrap', '2 flare, 2 cloth', '3 resin, 2 wire', '1 thermos, 3 cloth', '2 scrap, 2 wire, 1 flare', '4 resin, 1 thermos',
    ]);
    // And Sunday's holds a NAPO lockbox for whoever came back on all seven days.
    expect(p.allWeek).toEqual([{ item: 'lockbox', count: 1 }]);
  });

  it('keeps the NAPO lockbox in the chest, holding 3 shards, a strange object, a charm or 6 cloth and 4 wire', () => {
    const box = items.items.find(i => i.id === 'lockbox')!;
    expect(box).toMatchObject({ name: 'NAPO lockbox', kind: 'sealed', seal: 'It has been sealed since the evacuation.' });
    expect(box.xp).toBeUndefined();
    expect(box.holds!.map(h => (h.any ? `any ${h.any}` : said(h.items!)))).toEqual(['3 shard', '1 strange', 'any charm', '6 cloth, 4 wire']);
    expect(items.finds.some(f => f.item === 'lockbox')).toBe(false);
  });
});

describe('a first goal on the first day (roadmap/first-day.md)', () => {
  const woods = items.finds.filter(f => f.map === 'near-woods' && f.when === undefined && f.condition === undefined);
  /** How many of an item lie out at once on rules that stay within the first 40 steps into the Near Woods, and on the rest. */
  const near = (item: string) => woods.filter(f => f.item === item && f.steps && f.steps[1] <= 40).reduce((n, f) => n + f.count, 0);
  const deeper = (item: string) => woods.filter(f => f.item === item && !(f.steps && f.steps[1] <= 40)).reduce((n, f) => n + f.count, 0);

  it('fills the first 40 steps into the Near Woods with resin and glowcaps, so a first trip never comes home empty', () => {
    expect(near('resin')).toBeGreaterThanOrEqual(5);
    expect(near('glowcap')).toBeGreaterThanOrEqual(4);
    // Each with room to move: three tiles or more a find.
    for (const f of woods.filter(f => f.steps && f.steps[1] <= 40)) expect(findTiles(maps.get(f.map)!, f).length, `${f.item} ${f.steps}`).toBeGreaterThanOrEqual(3 * f.count);
  });

  it('leaves the finds deeper in as they were', () => {
    expect(deeper('resin')).toBe(6);
    expect(deeper('glowcap')).toBe(12);
  });

  it('has Mira say something once after the first collapse and the first surge, and Walt after the first thing made', () => {
    const story = JSON.parse(readFileSync(resolve(content, 'story.json'), 'utf8')) as StoryData;
    expect((story.remarks ?? []).map(r => [r.who, r.after])).toEqual([['mira', 'collapsed'], ['mira', 'surged'], ['walt', 'made']]);
    // The collapse one says what the design says: what you carried lies where you fell for an hour.
    expect(story.remarks![0]!.line).toMatch(/where you fell for an hour/);
  });
});

describe('the workbench at home (roadmap/workbench-at-home.md)', () => {
  const home = maps.get('stonebrook-home')!, lodge = maps.get('stonebrook-lodge')!;
  const all = (map: TileMap, kind: 'chest' | 'workbench') => map.data.objects.filter(o => o.kind === kind);

  it('stands beside the chest by the fire, along the back wall of the home', () => {
    const chests = all(home, 'chest'), benches = all(home, 'workbench');
    expect(chests).toHaveLength(1);
    expect(benches).toHaveLength(1);
    const [chest, bench] = [chests[0]!, benches[0]!];
    expect(Math.abs(chest.x - bench.x) + Math.abs(chest.y - bench.y)).toBe(1);
    // The back wall is where this camera sees them whole, and nobody stands behind them.
    expect([chest.y, bench.y]).toEqual([1, 1]);
    // You put things away in the fire's warmth.
    expect(home.warm(chest.x, chest.y + 1)).toBe(true);
  });

  it('is a few steps from the door, like the chest, along an open floor', () => {
    const { x, y } = home.data.spawn;
    for (const o of [...all(home, 'chest'), ...all(home, 'workbench')]) {
      const path = findPath(home, x, y, o.x, o.y + 1);
      expect(path.at(-1), o.kind).toEqual({ x: o.x, y: o.y + 1 });
      expect(path.length, o.kind).toBeLessThanOrEqual(6);
    }
  });

  it('is gone from the lodge: Walt, the fire and the long tables stay, and firewood stands where it was', () => {
    expect(all(lodge, 'workbench')).toEqual([]);
    const kinds = lodge.data.objects.map(o => o.kind);
    expect(kinds).toContain('fireplace');
    expect(kinds.filter(k => k === 'table').length).toBeGreaterThanOrEqual(4);
    expect(lodge.data.objects.some(o => o.kind === 'npc' && o.id === 'walt')).toBe(true);
    const wood = lodge.data.objects.find(o => o.kind === 'woodpile')!;
    expect(lodge.walkable(wood.x, wood.y)).toBe(false);
  });
});

describe('tall grass in the Near Woods (roadmap/richer-places.md)', () => {
  const map = maps.get('near-woods')!;
  const W = map.width;
  /** Each patch: its tiles, as y * width + x. */
  const patches: number[][] = [];
  const seen = new Set<number>();
  for (let y = 0; y < map.height; y++) for (let x = 0; x < W; x++) {
    if (!hidden(map, x, y) || seen.has(y * W + x)) continue;
    const patch = [y * W + x];
    seen.add(y * W + x);
    for (let k = 0; k < patch.length; k++) {
      const px = patch[k]! % W, py = Math.floor(patch[k]! / W);
      for (const [nx, ny] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]] as const) {
        if (hidden(map, nx, ny) && !seen.has(ny * W + nx)) {
          seen.add(ny * W + nx);
          patch.push(ny * W + nx);
        }
      }
    }
    patches.push(patch);
  }
  const tiles = patches.flat().map(i => [i % W, Math.floor(i / W)] as const);

  it('lies in 6 to 9 patches of 6 to 16 tiles, most of them in the deeper half, where the watchers and skulkers roam', () => {
    expect(patches.length).toBeGreaterThanOrEqual(6);
    expect(patches.length).toBeLessThanOrEqual(9);
    for (const p of patches) expect(p.length).toBeGreaterThanOrEqual(6);
    for (const p of patches) expect(p.length).toBeLessThanOrEqual(16);
    const deep = patches.filter(p => p.every(i => map.homeSteps(i % W, Math.floor(i / W)) >= map.data.skulkers!.steps[0]));
    expect(deep.length * 2).toBeGreaterThan(patches.length);
  });

  it('keeps off the exits, the lights and fires, the tiles in front of doors and signs, the poles and the places named before it', () => {
    const fronts = new Set(map.data.objects.flatMap(o => (o.kind === 'house' ? [`${doorOf(o).x},${doorOf(o).y + 1}`] : o.kind === 'sign' ? [`${o.x},${o.y + 1}`] : [])));
    const poles = map.data.objects.filter(o => o.kind === 'pole');
    const named = (map.data.places ?? []).filter(p => !hidden(map, p.x, p.y));
    expect(named.length).toBeGreaterThanOrEqual(5);
    for (const [x, y] of tiles) {
      expect(map.walkable(x, y) && !map.exitAt(x, y) && !map.lit(x, y) && !map.warm(x, y), `${x},${y}`).toBe(true);
      expect(fronts.has(`${x},${y}`), `${x},${y}`).toBe(false);
      expect(poles.some(p => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) <= 1), `${x},${y}`).toBe(false);
      expect(named.some(p => Math.hypot(p.x - x, p.y - y) <= 2.5), `${x},${y}`).toBe(false);
    }
  });

  it('names the patches people talk about, sparingly, on the patches themselves', () => {
    expect((map.data.places ?? []).filter(p => hidden(map, p.x, p.y)).map(p => p.name)).toEqual(['the long grass', 'the deer beds']);
  });

  it('leaves the creatures their woods: watchers still wake all over the deeper half, never in it', () => {
    const lairs = map.lairs(map.data.watchers!.steps);
    expect(lairs.length).toBeGreaterThan(200);
    for (const i of lairs) expect(hidden(map, i % W, Math.floor(i / W))).toBe(false);
  });
});

describe('gear upgrades (roadmap/gear-upgrades.md)', () => {
  it('cost what the design sets, level by level: scrap, cloth and wire first, shards from +4, strange objects for the last three, which may not take', () => {
    const table = items.upgrades!.map(u => [Object.fromEntries(u.needs.map(n => [n.item, n.count])), upgradeChance(u)]);
    expect(table).toEqual([
      [{ scrap: 2, cloth: 2 }, 1],
      [{ scrap: 3, cloth: 2, wire: 1 }, 1],
      [{ scrap: 4, cloth: 3, wire: 2 }, 1],
      [{ scrap: 4, wire: 2, shard: 1 }, 1],
      [{ scrap: 5, wire: 3, shard: 2 }, 1],
      [{ scrap: 6, wire: 4, shard: 3 }, 1],
      [{ shard: 4, strange: 1 }, 0.7],
      [{ shard: 5, strange: 2 }, 0.5],
      [{ shard: 6, strange: 3 }, 0.3],
    ]);
    expect(items.upgrades).toHaveLength(UPGRADE_MAX);
    expect(validateItems(items, [...maps.values()].map(m => m.data)).filter(p => p.level === 'error')).toEqual([]);
  });

  it('are for every piece but worn clothes and bags, anomalous gear too', () => {
    const gear = items.items.filter(i => i.kind === 'gear');
    expect(gear.filter(upgradable).map(i => i.tier).sort()).toEqual(expect.arrayContaining(['anomalous', 'expedition', 'rugged', 'sturdy']));
    for (const i of gear) expect(upgradable(i), i.id).toBe(i.tier !== 'worn' && i.slot !== 'bag');
  });
});
