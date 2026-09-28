import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TileMap, doorOf, findPath, findTiles, hidden, type ItemsData, type MapData } from '@napoland/shared';

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

describe('a crate for whoever comes next (roadmap/shelter-caches.md)', () => {
  const all = [...maps.values()];
  // Where people rest by a fire out there: every room off the wilds that keeps one, and every fire in the open.
  const shelters = all.filter(m => m.data.kind === 'wilds').flatMap(w => w.data.exits.map(e => maps.get(e.to)!))
    .filter(m => m.data.kind === 'inside' && m.data.objects.some(o => o.kind === 'fireplace'));
  const openFires = all.filter(m => m.data.kind === 'wilds').flatMap(m => m.data.objects.flatMap(o => (o.kind === 'fireplace' ? [{ map: m, x: o.x, y: o.y }] : [])));
  const crates = all.flatMap(m => m.data.objects.flatMap(o => (o.kind === 'cache' ? [{ map: m, o }] : [])));
  /** Every tile reachable from the map's spawn. */
  const reach = (m: TileMap) => {
    const seen = new Set<string>([`${m.data.spawn.x},${m.data.spawn.y}`]);
    const queue = [[m.data.spawn.x, m.data.spawn.y] as const];
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i]!;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (!m.walkable(nx, ny) || seen.has(`${nx},${ny}`)) continue;
        seen.add(`${nx},${ny}`);
        queue.push([nx, ny]);
      }
    }
    return seen;
  };

  it('stands in every place out there where people rest by a fire: the shelters, and by the fire in the open', () => {
    expect(shelters.map(m => m.data.id).sort()).toEqual([
      'near-woods-end-cabin', 'near-woods-old-cabin', 'near-woods-ranger-hut', 'south-road-bunker', 'south-road-checkpoint', 'south-road-dormitory', 'south-road-laboratory',
    ]);
    for (const m of shelters) expect(crates.filter(c => c.map === m), m.data.id).toHaveLength(1);
    expect(openFires.map(f => `${f.map.data.id} ${f.x},${f.y}`)).toEqual(['south-road 22,22']);
    for (const f of openFires) expect(crates.filter(c => c.map === f.map && Math.max(Math.abs(c.o.x - f.x), Math.abs(c.o.y - f.y)) === 1), 'by the fire').toHaveLength(1);
    // And nowhere else: not in town, not in a room without a fire.
    expect(crates).toHaveLength(shelters.length + openFires.length);
  });

  it('has a name each, for the letter of whoever left something in it', () => {
    expect(crates.map(c => c.o.kind === 'cache' && c.o.name).sort()).toEqual([
      'the bunker\'s crate', 'the checkpoint\'s crate', 'the crate at the leavers\' camp', 'the crate in the cabin at the end', 'the dormitory\'s crate',
      'the laboratory\'s crate', 'the old cabin\'s crate', 'the ranger\'s crate',
    ]);
  });

  it('moved nothing: each is the last thing on its map, on ground that was open, and cuts nobody off', () => {
    for (const { map, o } of crates) {
      expect(map.data.objects.at(-1), map.data.id).toBe(o);
      const before = new TileMap({ ...map.data, objects: map.data.objects.slice(0, -1) });
      expect(before.walkable(o.x, o.y), map.data.id).toBe(true);
      // Everywhere anyone could walk to before, they still can, but onto the crate itself.
      const was = reach(before), is = reach(map);
      was.delete(`${o.x},${o.y}`);
      expect([...is].sort(), map.data.id).toEqual([...was].sort());
      // You open it from the tile in front of it, as you do the chest.
      expect(map.walkable(o.x, o.y + 1), map.data.id).toBe(true);
    }
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
