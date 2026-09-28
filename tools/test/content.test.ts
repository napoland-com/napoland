import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CACHE_NEAR, TileMap, UPGRADE_MAX, doorOf, findPath, findTiles, footOf, hidden, ladderOf, objectTiles, upgradable, upgradeChance, validateItems, type ItemsData, type MapData, type MapObject, type StoryData } from '@napoland/shared';

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

describe('your own cabin (roadmap/own-cabin.md)', () => {
  const home = maps.get('stonebrook-home')!, town = maps.get('stonebrook')!;

  it('is private: everyone who walks in is in a cabin of their own, the one room anyone wakes up in', () => {
    expect(home.data.private).toBe(true);
    expect([...maps.values()].filter(m => m.data.private || m.data.wake).map(m => m.data.id)).toEqual(['stonebrook-home']);
  });

  it('wakes you right in front of the fire, facing the room, a step from the chest', () => {
    const { x, y, dir } = home.data.wake!;
    const fire = home.data.objects.find(o => o.kind === 'fireplace')!, chest = home.data.objects.find(o => o.kind === 'chest')!;
    expect([x, y, dir]).toEqual([fire.x, fire.y + 1, 'down']);
    expect(home.walkable(x, y) && home.warm(x, y) && !home.exitAt(x, y)).toBe(true);
    expect(findPath(home, x, y, chest.x, chest.y + 1)).toEqual([{ x: chest.x, y: chest.y + 1 }]);
  });

  it('lets you out in front of the house in Stonebrook', () => {
    const out = home.data.exits[0]!, door = town.data.exits.find(e => e.to === 'stonebrook-home')!;
    expect([out.to, out.tx, out.ty, out.dir]).toEqual(['stonebrook', door.x, door.y + 1, 'down']);
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
    // In the open, with the fire within a visit's reach of it (CACHE_NEAR), on forest cleared for it: the ground people walk stays as it was.
    for (const f of openFires) expect(crates.filter(c => c.map === f.map && Math.max(Math.abs(c.o.x - f.x), Math.abs(c.o.y - f.y)) <= CACHE_NEAR), 'by the fire').toHaveLength(1);
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

/** The three outdoor maps as they were before the richer-places pass (tools/test/fixtures). */
interface Before {
  version: number;
  tiles: string[];
  /** "x,y=level" for every raised tile. */
  raised: string[];
  spawn: MapData['spawn'];
  exits: MapData['exits'];
  places: NonNullable<MapData['places']>;
  /** Trees, rocks and glowcaps, as "kind x,y". */
  nature: string[];
  things: MapObject[];
}
const before = (JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/before-richer-places.json'), 'utf8')) as { maps: Record<string, Before> }).maps;
const NATURE = new Set<string>(['tree', 'rock', 'shrooms']);
/** The map as it was, for its tiles, what stood in the way and its distances home: nature needs no size or shade for that. */
function oldMap(id: string): TileMap {
  const b = before[id]!, now = maps.get(id)!.data;
  const levels = b.tiles.map(r => '0'.repeat(r.length).split(''));
  for (const r of b.raised) {
    const [xy, lv] = r.split('='), [x, y] = xy!.split(',').map(Number);
    levels[y!]![x!] = lv!;
  }
  const nature = b.nature.map((n): MapObject => {
    const [kind, xy] = n.split(' '), [x, y] = xy!.split(',').map(Number);
    return kind === 'shrooms' ? { kind, x: x!, y: y! } : { kind: kind as 'tree', x: x!, y: y!, s: 1, v: 0 };
  });
  return new TileMap({ ...now, version: b.version, tiles: b.tiles, levels: levels.map(r => r.join('')), spawn: b.spawn, exits: b.exits, places: b.places, objects: [...nature, ...b.things] });
}
/** An object as the fixture keeps it: nature by kind and tile, the rest whole. */
const kept = (o: MapObject) => (NATURE.has(o.kind) ? `${o.kind} ${o.x},${o.y}` : JSON.stringify(o));

describe('the pass that put more of the story in the places (roadmap/richer-places.md)', () => {
  const areas = ['stonebrook', 'near-woods', 'south-road'] as const;

  it('only added: every tile, exit, place and thing that was there still is, where it was and in its order', () => {
    for (const id of areas) {
      const b = before[id]!, now = maps.get(id)!.data;
      expect(now.version, id).toBeGreaterThan(b.version);
      expect(now.spawn, id).toEqual(b.spawn);
      // New exits (the doors of new houses) and new names come after the old ones.
      expect(now.exits.slice(0, b.exits.length), id).toEqual(b.exits);
      expect((now.places ?? []).slice(0, b.places.length), id).toEqual(b.places);
      // The old things first, in their order (which lamps flicker, and which poles the wires run between, go by it).
      const old = new Set([...b.nature, ...b.things.map(o => JSON.stringify(o))]);
      const first = now.objects.slice(0, old.size).map(kept);
      expect(first.filter(k => !old.has(k)), id).toEqual([]);
      expect(new Set(first).size, id).toBe(old.size);
      const things = now.objects.slice(0, old.size).filter(o => !NATURE.has(o.kind)).map(o => JSON.stringify(o));
      expect(things, id).toEqual(b.things.map(o => JSON.stringify(o)));
      const raised = now.levels.flatMap((row, y) => [...row].flatMap((c, x) => (c === '0' ? [] : [`${x},${y}=${c}`])));
      expect(raised, id).toEqual(b.raised);
    }
  });

  it('changed ground only where it was forest, or in town open ground for the brook and its banks', () => {
    for (const id of areas) {
      const b = before[id]!, now = maps.get(id)!;
      const standing = new Set(oldMap(id).data.objects.flatMap(o => objectTiles(o).map(([x, y]) => `${x},${y}`)));
      for (let y = 0; y < now.height; y++) for (let x = 0; x < now.width; x++) {
        const was = b.tiles[y]![x]!, is = now.data.tiles[y]![x]!;
        if (was === is) continue;
        if (id === 'stonebrook') expect('gm'.includes(was) && 'wm'.includes(is) && !standing.has(`${x},${y}`), `${id} ${x},${y}: ${was} to ${is}`).toBe(true);
        // The flooded culvert that came after (roadmap/locked-places.md) passes under the creek: water it stays, to all but waders.
        else if (was === 'w') expect(is, `${id} ${x},${y}: ${was} to ${is}`).toBe('c');
        else expect(was, `${id} ${x},${y}: ${was} to ${is}`).toBe('t');
      }
    }
  });

  it('left the wilds as they walk: every tile anyone could stand on still can, just as far from home', () => {
    for (const id of ['near-woods', 'south-road'] as const) {
      const was = oldMap(id), now = maps.get(id)!;
      expect(now.deepest, id).toBe(was.deepest);
      for (let y = 0; y < now.height; y++) for (let x = 0; x < now.width; x++) {
        if (!was.walkable(x, y)) continue;
        expect(now.walkable(x, y), `${id} ${x},${y}`).toBe(true);
        expect(now.homeSteps(x, y), `${id} ${x},${y}`).toBe(was.homeSteps(x, y));
      }
    }
  });

  const place = (id: string, name: string) => maps.get(id)!.data.places!.find(p => p.name === name)!;
  /** The objects of these kinds standing within r tiles of the named place. */
  const near = (id: string, name: string, kinds: ReadonlyArray<MapObject['kind']>, r: number) => {
    const p = place(id, name);
    return maps.get(id)!.data.objects.filter(o => kinds.includes(o.kind) && objectTiles(o).some(([x, y]) => Math.hypot(x - p.x, y - p.y) <= r));
  };

  it('names every new landmark where it stands, so the paper maps write it in', () => {
    expect(near('stonebrook', 'the sawmill', ['house'], 2).filter(o => o.kind === 'house' && o.style === 'mill')).toHaveLength(1);
    expect(near('stonebrook', 'the verge', ['luggage', 'boxes', 'piano', 'rocker', 'bike', 'birdcage'], 5).length).toBeGreaterThanOrEqual(6);
    expect(near('near-woods', 'the log landing', ['logs'], 4)).toHaveLength(1);
    expect(near('near-woods', 'the log landing', ['stump'], 5).length).toBeGreaterThanOrEqual(6);
    expect(near('near-woods', 'the burned jeep', ['jeep'], 1)).toHaveLength(1);
    expect(near('south-road', 'the jam', ['car'], 8).length).toBeGreaterThanOrEqual(10);
    expect(near('south-road', 'the motor pool', ['truck'], 3).filter(o => o.kind === 'truck' && o.style === 'napo').length).toBeGreaterThanOrEqual(2);
  });

  describe('in Stonebrook', () => {
    const town = maps.get('stonebrook')!;
    const houses = town.data.objects.filter((o): o is Extract<MapObject, { kind: 'house' }> => o.kind === 'house');
    const roomOf = (h: Extract<MapObject, { kind: 'house' }>) => maps.get(town.exitAt(doorOf(h).x, doorOf(h).y)!.to)!;
    const left = houses.filter(h => h.curtains);

    it('four families who left: dark behind drawn curtains, cold inside, their name on the mailbox by the door, one thing to read', () => {
      expect(left).toHaveLength(4);
      for (const h of left) {
        const room = roomOf(h), d = doorOf(h), family = room.data.name.replace(/^The (.+) house$/, '$1');
        expect(h.lit, room.data.id).toBe(0);
        expect(room.data.objects.some(o => o.kind === 'fireplace'), room.data.id).toBe(false);
        expect(room.data.objects.some(o => o.kind === 'sheeted'), room.data.id).toBe(true);
        expect(room.data.objects.filter(o => o.kind === 'paper'), room.data.id).toHaveLength(1);
        const box = town.data.objects.find(o => o.kind === 'sign' && o.style === 'mailbox' && Math.abs(o.x - d.x) + Math.abs(o.y - d.y) <= 3);
        expect(box?.kind === 'sign' && box.text[0]!.toUpperCase().includes(family.toUpperCase()), room.data.id).toBe(true);
      }
      // Plain names, and never the Barlows: they lived in the cabin at the end of the Near Woods.
      expect(left.map(h => roomOf(h).data.name).join(' ')).not.toMatch(/Barlow/);
    });

    it('in their rooms a crib, a stopped clock, cold hearths, boxes, and a calendar, a child\'s drawing, a note and a list', () => {
      const inside = left.flatMap(h => roomOf(h).data.objects);
      for (const kind of ['crib', 'clock', 'hearth', 'boxes'] as const) expect(inside.some(o => o.kind === kind), kind).toBe(true);
      expect(inside.flatMap(o => (o.kind === 'paper' ? [o.look] : [])).sort()).toEqual(['calendar', 'drawing', 'list', 'note']);
    });

    it('the old sawmill on the brook, its sign, its logs and its truck, and inside a dark mill floor', () => {
      const mill = houses.find(h => h.style === 'mill')!, floor = roomOf(mill);
      expect(floor.data.style).toBe('mill');
      for (const kind of ['saw', 'carriage', 'sawdust', 'logs'] as const) expect(floor.data.objects.some(o => o.kind === kind), kind).toBe(true);
      expect(floor.data.objects.some(o => o.kind === 'fireplace')).toBe(false);
      const by = (kind: MapObject['kind'], r: number) => town.data.objects.filter(o => o.kind === kind && Math.hypot(o.x - mill.x, o.y - mill.y) <= r);
      expect(by('logs', 6)).toHaveLength(1);
      expect(by('truck', 6)).toHaveLength(1);
      expect(by('sign', 4).some(o => o.kind === 'sign' && o.text[0] === 'Stonebrook Timber Co.')).toBe(true);
      // The brook runs into the pond just below it.
      let water = 0;
      for (let x = mill.x; x < mill.x + mill.w; x++) if (town.kind(x, mill.y + mill.h + 1) === 'water') water++;
      expect(water).toBeGreaterThanOrEqual(4);
    });

    it('the verge by the south road, beside NAPO\'s notice: what would not fit in the cars, and a cardboard sign', () => {
      const notice = town.data.objects.find(o => o.kind === 'sign' && o.style === 'napo')!;
      const verge = town.data.objects.filter(o => Math.hypot(o.x - notice.x, o.y - notice.y) <= 6);
      for (const kind of ['luggage', 'boxes', 'piano', 'rocker', 'bike', 'birdcage'] as const) expect(verge.some(o => o.kind === kind), kind).toBe(true);
      expect(verge.some(o => o.kind === 'sign' && o.style === 'cardboard')).toBe(true);
    });
  });

  describe('in the Near Woods', () => {
    const woods = maps.get('near-woods')!;
    it('NAPO\'s survey stakes at the foot of the rocks, on open ground', () => {
      const stakes = woods.data.objects.filter(o => o.kind === 'stake');
      expect(stakes.length).toBeGreaterThanOrEqual(4);
      for (const s of stakes) {
        let rock = false;
        for (let y = s.y - 1; y <= s.y + 1; y++) for (let x = s.x - 1; x <= s.x + 1; x++) if (woods.level(x, y) > 0) rock = true;
        expect(rock && woods.walkable(s.x, s.y) && !hidden(woods, s.x, s.y), `${s.x},${s.y}`).toBe(true);
      }
    });
    it('a burned NAPO jeep a few steps off the road in, its stencil read from beside it; a skid road into the log landing', () => {
      const jeep = woods.data.objects.find(o => o.kind === 'jeep')!;
      expect(jeep.kind === 'jeep' && jeep.text.length).toBeGreaterThan(0);
      const beside = objectTiles(jeep).flatMap(([x, y]) => [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const).filter(([x, y]) => woods.walkable(x, y));
      expect(Math.min(...beside.map(([x, y]) => woods.homeSteps(x, y)))).toBeLessThan(15);
      expect(woods.data.objects.filter(o => o.kind === 'skid').length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('on the South Road', () => {
    const road = maps.get('south-road')!;
    it('a jam of cars on both shoulders where the line of leavers stopped, some doors open and a trunk up, and luggage', () => {
      const jam = road.data.objects.filter((o): o is Extract<MapObject, { kind: 'car' }> => o.kind === 'car' && o.y >= 20 && o.y <= 38);
      expect(jam.length).toBeGreaterThanOrEqual(10);
      expect(jam.filter(c => c.x < 35).length).toBeGreaterThanOrEqual(3);
      expect(jam.filter(c => c.x > 36).length).toBeGreaterThanOrEqual(3);
      expect(jam.filter(c => c.door).length).toBeGreaterThanOrEqual(2);
      expect(jam.filter(c => c.trunk).length).toBeGreaterThanOrEqual(1);
      expect(road.data.objects.filter(o => o.kind === 'luggage' && o.y >= 20 && o.y <= 38).length).toBeGreaterThanOrEqual(3);
    });
    it('NAPO\'s fenced motor pool with its trucks and pump, and the field site\'s sample cages with their tags', () => {
      const pool = place('south-road', 'the motor pool');
      expect(road.data.objects.some(o => o.kind === 'pump' && Math.hypot(o.x - pool.x, o.y - pool.y) <= 4)).toBe(true);
      expect(road.data.objects.filter(o => o.kind === 'fence' && Math.hypot(o.x - pool.x, o.y - pool.y) <= 6).length).toBeGreaterThanOrEqual(20);
      const site = place('south-road', 'field site');
      const cages = road.data.objects.filter(o => o.kind === 'cage' && Math.hypot(o.x - site.x, o.y - site.y) <= 6);
      expect(cages.length).toBeGreaterThanOrEqual(3);
      for (const c of cages) expect(c.kind === 'cage' && c.text[0]!.startsWith('NAPO')).toBe(true);
    });
  });
});

describe('places you can see but not reach yet (roadmap/locked-places.md)', () => {
  const woods = maps.get('near-woods')!, W = woods.width;
  const bog = woods.data.places!.find(p => p.name === 'the bog')!;
  const shed = woods.data.objects.find((o): o is Extract<MapObject, { kind: 'house' }> => o.kind === 'house' && o.style === 'shed')!;
  const hut = woods.data.objects.find((o): o is Extract<MapObject, { kind: 'house' }> => o.kind === 'house' && woods.exitAt(doorOf(o).x, doorOf(o).y)?.to === 'near-woods-ranger-hut')!;
  const culvert: Array<[number, number]> = [];
  for (let y = 0; y < woods.height; y++) for (let x = 0; x < W; x++) if (woods.kind(x, y) === 'culvert') culvert.push([x, y]);
  const WADERS = new Set(['waders']);
  const sides = (x: number, y: number) => [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const;
  /** Walking steps from a tile to every other, as the game walks them, with what a pass opens. */
  const walk = (from: readonly [number, number], pass?: ReadonlySet<string>) => {
    const d = new Int32Array(W * woods.height).fill(-1), queue = [from[1] * W + from[0]];
    d[queue[0]!] = 0;
    for (let h = 0; h < queue.length; h++) {
      const i = queue[h]!, x = i % W, y = Math.floor(i / W);
      for (const [nx, ny] of sides(x, y)) {
        if (!woods.walkable(nx, ny, pass) || woods.exitAt(nx, ny) || d[ny * W + nx]! >= 0) continue;
        d[ny * W + nx] = d[i]! + 1;
        queue.push(ny * W + nx);
      }
    }
    return ([x, y]: readonly [number, number]) => d[y * W + x]!;
  };
  /** Where the culvert opens onto ground anyone walks (its mouths), and the ground each opens onto, the northern first. */
  const mouths = culvert.flatMap(([x, y]) => sides(x, y).filter(([nx, ny]) => woods.walkable(nx, ny)).map(g => ({ at: [x, y] as const, ground: g }))).sort((a, b) => a.at[1] - b.at[1]);

  it('a padlocked shed behind the ranger\'s hut, whose door only bolt cutters open, into a dark room of its own', () => {
    expect([shed.w, shed.h]).toEqual([2, 2]);
    // Behind the hut: north of it, and no farther off to either side than the hut is wide.
    expect(shed.y + shed.h).toBeLessThanOrEqual(hut.y);
    expect(hut.y - (shed.y + shed.h)).toBeLessThanOrEqual(2);
    expect(Math.abs(shed.x + 1 - (hut.x + 1.5))).toBeLessThanOrEqual(2);
    const door = doorOf(shed), exit = woods.data.exits.find(e => e.x === door.x && e.y === door.y)!;
    expect(exit).toMatchObject({ to: 'near-woods-shed', lock: 'bolt-cutters' });
    expect(woods.walkable(door.x, door.y)).toBe(false);
    expect(woods.walkable(door.x, door.y, new Set(['bolt-cutters']))).toBe(true);
    const room = maps.get('near-woods-shed')!;
    expect(room.data).toMatchObject({ kind: 'inside', style: 'shed' });
    expect(room.data.private).toBeUndefined();
    expect(room.data.objects.some(o => o.kind === 'fireplace')).toBe(false);
    expect(room.data.objects.some(o => o.kind === 'paper')).toBe(true);
  });

  it('where a strange object grows back every half hour, for everyone', () => {
    const rules = items.finds.filter(f => f.map === 'near-woods-shed');
    expect(rules).toEqual([expect.objectContaining({ item: 'strange', count: 1, respawn: [1800, 1800] })]);
    expect(rules[0]!.when).toBeUndefined();
    expect(findTiles(maps.get('near-woods-shed')!, rules[0]!).length).toBeGreaterThanOrEqual(3);
  });

  it('a flooded culvert from the bog that comes out south of the creek, in the headlight clearing, entered only at its ends', () => {
    expect(culvert.length).toBeGreaterThan(20);
    // One run, whose every tile is water to anyone without waders.
    const seen = new Set([culvert[0]![1] * W + culvert[0]![0]]), todo = [culvert[0]!];
    while (todo.length) {
      const [x, y] = todo.pop()!;
      for (const [nx, ny] of sides(x, y)) if (woods.kind(nx, ny) === 'culvert' && !seen.has(ny * W + nx)) { seen.add(ny * W + nx); todo.push([nx, ny]); }
    }
    expect(seen.size).toBe(culvert.length);
    for (const [x, y] of culvert) expect(!woods.walkable(x, y) && woods.walkable(x, y, WADERS), `${x},${y}`).toBe(true);
    // Its two mouths: one by the bog, one south of the creek, in the clearing; nowhere else does it touch ground.
    expect(new Set(mouths.map(m => `${m.at[0]},${m.at[1]}`)).size).toBe(2);
    const north = mouths[0]!, south = mouths.at(-1)!;
    expect(Math.hypot(north.ground[0] - bog.x, north.ground[1] - bog.y)).toBeLessThan(7);
    expect(woods.homeSteps(...north.ground)).toBeGreaterThan(75);
    // It passes under the creek, and what it comes out onto lies south of where it does.
    const under = culvert.filter(([x, y]) => woods.kind(x, y - 1) === 'water' || woods.kind(x, y + 1) === 'water');
    expect(under.length).toBeGreaterThan(0);
    expect(south.ground[1]).toBeGreaterThan(Math.min(...under.map(([, y]) => y)));
    expect(woods.homeSteps(...south.ground)).toBeLessThan(40);
  });

  it('saves about 44 steps from the bog to where it comes out, in waders, and a few on the whole way home', () => {
    const from = [bog.x, bog.y] as const, out = mouths.at(-1)!.ground;
    const round = walk(from)(out), through = walk(from, WADERS)(out);
    expect(round - through).toBeGreaterThanOrEqual(40);
    expect(round - through).toBeLessThanOrEqual(48);
    const home = [31, woods.height - 2] as const;
    expect(walk(from, WADERS)(home)).toBeLessThan(walk(from)(home));
  });

  it('moved nothing: the shed and its door came after everything before them, and every tile anyone walks is as far from home as without them', () => {
    // Only what came later still (the fire lookout, and its sign) stands after the shed; its door is the last exit.
    const after = woods.data.objects.slice(woods.data.objects.indexOf(shed) + 1);
    expect(after.every(o => o.kind === 'lookout' || o.kind === 'sign')).toBe(true);
    expect(woods.data.exits.at(-1)).toMatchObject({ to: 'near-woods-shed' });
    // The woods as they were: forest where the culvert runs and the shed stands (its ground was cut out of the firs).
    const under = new Set(objectTiles(shed).map(([x, y]) => `${x},${y}`));
    const without = new TileMap({
      ...woods.data, tiles: woods.data.tiles.map((r, y) => [...r.replaceAll('c', 't')].map((c, x) => (under.has(`${x},${y}`) ? 't' : c)).join('')),
      exits: woods.data.exits.filter(e => e.to !== 'near-woods-shed'), objects: woods.data.objects.filter(o => o !== shed),
    });
    expect(woods.deepest).toBe(without.deepest);
    for (let y = 0; y < woods.height; y++) for (let x = 0; x < W; x++) {
      if (!without.walkable(x, y)) continue;
      expect(woods.walkable(x, y), `${x},${y}`).toBe(true);
      expect(woods.homeSteps(x, y), `${x},${y}`).toBe(without.homeSteps(x, y));
    }
  });

  it('are opened by tools made at the workbench at home from what comes from deep in: shards, and wire', () => {
    for (const id of ['bolt-cutters', 'waders']) {
      const def = items.items.find(i => i.id === id)!, recipe = items.recipes!.find(r => r.make === id)!;
      expect(def).toMatchObject({ kind: 'tool', stack: 1 });
      expect(def.about?.length).toBeGreaterThan(0);
      expect(recipe.needs.find(n => n.item === 'shard')?.count).toBeGreaterThanOrEqual(1);
      expect(recipe.needs.find(n => n.item === 'wire')?.count).toBeGreaterThanOrEqual(1);
    }
    expect(items.items.find(i => i.id === 'bolt-cutters')!.icon).toBe('cutters');
    expect(items.items.find(i => i.id === 'waders')!.icon).toBe('waders');
  });
});

describe('the fire lookout (roadmap/lookout-tower.md)', () => {
  const woods = maps.get('near-woods')!, W = woods.width;
  const lookouts = [...maps.values()].flatMap(m => m.data.objects.filter((o): o is Extract<MapObject, { kind: 'lookout' }> => o.kind === 'lookout').map(o => ({ map: m.data.id, o })));
  const tower = lookouts[0]!.o, foot = footOf(tower);
  const rocks = woods.data.places!.find(p => p.name === 'the rocks')!;

  it('is one timber tower in the Near Woods, near the rocks, climbed from the foot of its ladder, which anyone walks to from home', () => {
    expect(lookouts.map(l => l.map)).toEqual(['near-woods']);
    expect(Math.hypot(foot.x - rocks.x, foot.y - rocks.y)).toBeLessThan(10);
    expect(woods.walkable(foot.x, foot.y)).toBe(true);
    expect(woods.exitAt(foot.x, foot.y)).toBeUndefined();
    expect(woods.homeSteps(foot.x, foot.y)).toBeGreaterThan(30);
    expect(woods.walkable(ladderOf(tower).x, ladderOf(tower).y)).toBe(false);
    // The paper map names it where you climb it.
    expect(woods.data.places).toContainEqual({ name: 'the fire lookout', x: foot.x, y: foot.y });
  });

  it('is the loggers\', older than NAPO: the timber company\'s sign beside it says so, and what keeps its lamp burning', () => {
    const sign = woods.data.objects.find(o => o.kind === 'sign' && o.y === foot.y && Math.abs(o.x - foot.x) === 1);
    const text = sign?.kind === 'sign' ? sign.text.join(' ') : '';
    expect(text).toMatch(/^Fire lookout\. Stonebrook Timber Co\./);
    expect(text).toMatch(/resin/);
    expect(text).not.toMatch(/NAPO/);
    // NAPO's Tower is no lookout: nobody climbs it.
    const road = maps.get('south-road')!;
    expect(road.data.objects.some(o => o.kind === 'sign' && o.text.join(' ').includes('Do not climb'))).toBe(true);
  });

  it('moved nothing: it and its sign came last, on forest they cleared, and every tile anyone walks is as far from home as without them', () => {
    const at = woods.data.objects.indexOf(tower);
    expect(woods.data.objects.slice(at).map(o => o.kind)).toEqual(['lookout', 'sign']);
    const cleared = new Set([...objectTiles(tower), ...objectTiles(woods.data.objects[at + 1]!), [foot.x, foot.y] as const].map(([x, y]) => `${x},${y}`));
    const without = new TileMap({
      ...woods.data, tiles: woods.data.tiles.map((r, y) => [...r].map((c, x) => (cleared.has(`${x},${y}`) ? 't' : c)).join('')), objects: woods.data.objects.slice(0, at),
    });
    expect(woods.deepest).toBe(without.deepest);
    for (let y = 0; y < woods.height; y++) for (let x = 0; x < W; x++) {
      if (!without.walkable(x, y)) continue;
      expect(woods.walkable(x, y), `${x},${y}`).toBe(true);
      expect(woods.homeSteps(x, y), `${x},${y}`).toBe(without.homeSteps(x, y));
    }
  });
});
