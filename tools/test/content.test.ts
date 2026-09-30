import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANYWHERE, BUNDLE, CACHE_NEAR, COMFORTS, DIRS, NOTE_AUTHORS, NOTE_ON, SIGHTS, TileMap, UPGRADE_MAX, comfortMax, doorOf, findPath, findTiles, footOf, hidden, ladderOf, itemIndex, notesOf, objectTiles,
  opensOn, secretKey, secretTitle, stepTarget, storyLines, teleportArrival, upgradable, upgradeChance,
  validateItems, validateNotebook, type ItemsData, type MapData, type MapExit, type MapNote, type MapObject, type NotebookData, type Sight, type StoryData,
} from '@napoland/shared';

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
    // the mean respawn, an hour. Only what grows every day: not on aurora nights, not on a condition's
    // day, and in the town as it starts (the empty house's cloth moves to the lodge's shelves once Edith
    // is home: the same cloth, somewhere else).
    const perHour = rules
      .filter(f => f.when === undefined && f.condition === undefined && !f.town?.from)
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
  // What grows every day: not at a time, on a condition's day or in a season only.
  const woods = items.finds.filter(f => f.map === 'near-woods' && f.when === undefined && f.condition === undefined && f.season === undefined);
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

  it('is private: everyone who walks in is in a home of their own, the one room anyone wakes up in, and the garden round it', () => {
    expect(home.data.private).toBe(true);
    expect([...maps.values()].filter(m => m.data.private).map(m => m.data.id).sort()).toEqual(['home-garden', 'stonebrook-home']);
    expect([...maps.values()].filter(m => m.data.wake).map(m => m.data.id)).toEqual(['stonebrook-home']);
  });

  it('wakes you right in front of the fire, facing the room, a step from the chest', () => {
    const { x, y, dir } = home.data.wake!;
    const fire = home.data.objects.find(o => o.kind === 'fireplace')!, chest = home.data.objects.find(o => o.kind === 'chest')!;
    expect([x, y, dir]).toEqual([fire.x, fire.y + 1, 'down']);
    expect(home.walkable(x, y) && home.warm(x, y) && !home.exitAt(x, y)).toBe(true);
    expect(findPath(home, x, y, chest.x, chest.y + 1)).toEqual([{ x: chest.x, y: chest.y + 1 }]);
  });

  // Since home-lots (roadmap/home-lots.md) the house stands in a garden of its own: its door lets you out there.
  it('lets you out into your garden, in front of the house\'s door, and nothing in town leads in', () => {
    const out = home.data.exits[0]!, garden = maps.get('home-garden')!;
    const house = garden.data.objects.find((o): o is Extract<MapObject, { kind: 'house' }> => o.kind === 'house')!, d = doorOf(house);
    expect([out.to, out.tx, out.ty, out.dir]).toEqual(['home-garden', d.x, d.y + 1, 'down']);
    expect(town.data.exits.some(e => e.to === 'stonebrook-home' || e.to === 'home-garden')).toBe(false);
  });
});

describe('a home in its own garden (roadmap/home-lots.md)', () => {
  const garden = maps.get('home-garden')!, home = maps.get('stonebrook-home')!, town = maps.get('stonebrook')!;
  const houses = garden.data.objects.flatMap(o => (o.kind === 'house' ? [o] : []));

  it('is a clearing with one house, plated, at the back: 5 by 3 whatever its owner builds it up to', () => {
    expect(garden.data).toMatchObject({ kind: 'town', private: true, depth: 0 });
    expect(houses).toHaveLength(1);
    expect(houses[0]).toMatchObject({ w: 5, h: 3, plate: true, lit: 0 });
    // A garden to walk in: a path, a bed of turned earth, a fence, a lamp, a few trees.
    expect(garden.data.objects.filter(o => o.kind === 'fence').length).toBeGreaterThan(20);
    expect(garden.data.objects.some(o => o.kind === 'lamp')).toBe(true);
    expect(garden.data.tiles.join('')).toMatch(/m/);
  });

  it('is closed all round: its one way out is its house\'s door, into the home, and nothing else leads into it', () => {
    const d = doorOf(houses[0]!);
    expect(garden.data.exits).toHaveLength(1);
    expect(garden.exitAt(d.x, d.y)?.to).toBe('stonebrook-home');
    expect([...maps.values()].filter(m => m.data.exits.some(e => e.to === 'home-garden')).map(m => m.data.id)).toEqual(['stonebrook-home']);
    expect([...maps.values()].filter(m => m.data.exits.some(e => e.to === 'stonebrook-home')).map(m => m.data.id)).toEqual(['home-garden']);
    // Every walkable tile of it is a walk from its door.
    for (let y = 0; y < garden.height; y++) for (let x = 0; x < garden.width; x++) {
      if (garden.walkable(x, y) && !garden.exitAt(x, y)) expect(findPath(garden, d.x, d.y + 1, x, y).length > 0 || (x === d.x && y === d.y + 1), `${x},${y}`).toBe(true);
    }
  });

  it('keeps no road out of Stonebrook to it any more, and no signpost: the teleport by the notice board is the way home', () => {
    expect(town.data.exits.map(e => e.to).sort()).toEqual([...town.data.exits.map(e => e.to)].sort());
    expect(town.data.exits.some(e => e.x === 0)).toBe(false);
    expect(town.data.objects.some(o => o.kind === 'sign' && o.text.join(' ').includes('Residents'))).toBe(false);
    expect(town.data.objects.filter(o => o.kind === 'teleport')).toHaveLength(1);
  });

  it('opens the kitchen from the cabin and the map table from the house, each faced from open floor, walling off no place', () => {
    const kitchen = home.data.objects.find(o => o.kind === 'kitchen'), table = home.data.objects.find(o => o.kind === 'board');
    expect(kitchen).toMatchObject({ house: 2 });
    expect(table).toMatchObject({ house: 3 });
    const { x: wx, y: wy } = home.data.wake!;
    const reached = (x: number, y: number) => (x === wx && y === wy) || findPath(home, wx, wy, x, y).length > 0;
    for (const o of [kitchen!, table!]) {
      expect(home.walkable(o.x, o.y + 1) && !home.exitAt(o.x, o.y + 1)).toBe(true);
      expect(reached(o.x, o.y + 1)).toBe(true);
    }
    // Every place for furniture is still walked up to from some side, and every open tile of the room is still walked to.
    for (const o of home.data.objects) {
      if (o.kind !== 'comfort') continue;
      const own = new Set(objectTiles(o).map(([x, y]) => `${x},${y}`));
      const sides = objectTiles(o).flatMap(([x, y]) => [[x, y - 1], [x - 1, y], [x + 1, y], [x, y + 1]] as const).filter(([x, y]) => !own.has(`${x},${y}`));
      expect(sides.some(([x, y]) => home.walkable(x, y) && reached(x, y)), o.what).toBe(true);
    }
    for (let y = 0; y < home.height; y++) for (let x = 0; x < home.width; x++) if (home.walkable(x, y)) expect(reached(x, y), `${x},${y}`).toBe(true);
  });

  it('builds up from a garage to a cabin and a house, each level paid from the stash with what farther regions give', () => {
    expect(items.house?.map(l => l.name)).toEqual(['Garage', 'Cabin', 'House']);
    expect(items.house?.[0]?.needs).toBeUndefined();
    // The house takes what only the Far Woods and the Burn give: cedar bark, batteries, fused glass.
    const house = new Set(items.house?.[2]?.needs?.map(n => n.item));
    for (const id of ['cedar-bark', 'battery', 'fused-glass']) expect(house.has(id), id).toBe(true);
  });
});

describe('the house that was Home, and NAPO\'s teleports (roadmap/street-visits.md)', () => {
  const town = maps.get('stonebrook')!, home = maps.get('stonebrook-home')!, old = maps.get('stonebrook-old-home')!;
  const was = town.data.objects.find((o): o is Extract<MapObject, { kind: 'house' }> => o.kind === 'house' && o.x === 7 && o.y === 19)!;

  it('leaves the house that was Home dark, its door into the old home: cold, what nobody came back for, and a note saying where everyone went', () => {
    expect(was.lit).toBe(0);
    expect(town.exitAt(doorOf(was).x, doorOf(was).y)?.to).toBe('stonebrook-old-home');
    expect(old.data.private).toBeUndefined();
    expect(old.data.objects.some(o => o.kind === 'fireplace' || o.kind === 'chest')).toBe(false);
    expect(old.data.objects.filter(o => o.kind === 'hearth')).toHaveLength(1);
    expect(old.data.objects.filter(o => o.kind === 'paper').map(o => (o.kind === 'paper' ? o.text.join(' ') : ''))[0]).toMatch(/teleport by the notice board/);
  });

  it('stands one in the house, a walk from the fire, and its twin by the notice board in town, where it sets you down', () => {
    expect([...maps.values()].filter(m => m.data.objects.some(o => o.kind === 'teleport' && !o.home)).map(m => m.data.id).sort()).toEqual(['stonebrook', 'stonebrook-home']);
    // The outposts far out only go home, and each is reached from the door on foot.
    const outposts = [...maps.values()].filter(m => m.data.objects.some(o => o.kind === 'teleport' && o.home));
    expect(outposts.map(m => m.data.id).sort()).toEqual(['far-woods-field-post', 'marsh-cutters-hut', 'ridge-high-hut', 'south-road-dormitory']);
    for (const m of outposts) {
      const t = m.data.objects.find(o => o.kind === 'teleport')!, door = m.data.exits[0]!;
      expect(findPath(m, door.x, door.y - 1, t.x, t.y + 1).length, m.data.id).toBeGreaterThan(0);
    }
    const [mine, ...more] = home.data.objects.filter(o => o.kind === 'teleport');
    expect(more).toEqual([]);
    // Used from the tile in front of it, a walk from where you wake up by the fire, and off the way from the door to it.
    const wake = home.data.wake!, door = home.data.exits[0]!;
    expect(home.walkable(mine!.x, mine!.y + 1) && !home.exitAt(mine!.x, mine!.y + 1)).toBe(true);
    expect(findPath(home, wake.x, wake.y, mine!.x, mine!.y + 1).length).toBeGreaterThan(0);
    expect(findPath(home, door.x, door.y - 1, wake.x, wake.y).some(t => t.x === mine!.x && t.y === mine!.y + 1)).toBe(false);
    // The one in town, a few steps from the notice board, sets you down on open ground, a walk from everywhere in town.
    const [twin, ...others] = town.data.objects.filter(o => o.kind === 'teleport');
    expect(others).toEqual([]);
    const board = town.data.objects.find(o => o.kind === 'board')!;
    expect(Math.abs(twin!.x - board.x) + Math.abs(twin!.y - board.y)).toBeLessThanOrEqual(4);
    const at = teleportArrival(twin!);
    expect(town.walkable(at.x, at.y) && !town.exitAt(at.x, at.y)).toBe(true);
    expect(findPath(town, at.x, at.y, town.data.spawn.x, town.data.spawn.y).length).toBeGreaterThan(0);
  });
});

describe('a cozy cabin (roadmap/cabin-comfort.md)', () => {
  const home = maps.get('stonebrook-home')!;
  const at = (kind: MapObject['kind']) => home.data.objects.filter(o => o.kind === kind).map(o => [o.x, o.y]);
  const furniture = items.items.filter(i => i.kind === 'furniture');

  it('has a place in the home for each thing years of damp spoiled, and the fire, the chest, the workbench and the door where they were', () => {
    expect(home.data.objects.flatMap(o => (o.kind === 'comfort' ? [o.what] : [])).sort()).toEqual([...COMFORTS].sort());
    expect([at('fireplace'), at('chest'), at('workbench')]).toEqual([[[4, 1]], [[5, 1]], [[6, 1]]]);
    expect(home.data.exits.map(e => [e.x, e.y])).toEqual([[4, 6]]);
    // Everything you walk to stays in reach: the chest and the workbench from the door, the wake point by the fire.
    for (const [x, y] of [[5, 2], [6, 2], [4, 2]] as const) expect(findPath(home, home.data.spawn.x, home.data.spawn.y, x, y).at(-1)).toEqual({ x, y });
  });

  it('makes each at the workbench from what you bring home, dearer the more comfort it adds: 10 in all', () => {
    expect(Object.fromEntries(furniture.map(f => [f.furnishes, f.comfort]))).toEqual({ stove: 3, bed: 2, rack: 2, rug: 1, lamp: 1, shelf: 1 });
    expect(comfortMax(items.items)).toBe(10);
    for (const f of furniture) {
      const r = items.recipes!.filter(x => x.make === f.id);
      expect(r, f.id).toHaveLength(1);
      // Six of scrap, cloth, wire and resin for each point of comfort.
      expect(r[0]!.needs.every(n => ['scrap', 'cloth', 'wire', 'resin'].includes(n.item)), f.id).toBe(true);
      expect(r[0]!.needs.reduce((n, x) => n + x.count, 0), f.id).toBe(6 * f.comfort!);
    }
    // Only the rack dries you.
    expect(furniture.filter(f => f.dries).map(f => f.furnishes)).toEqual(['rack']);
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
      'burn-line-cabin', 'far-woods-trapper-cabin', 'marsh-cutters-hut', 'near-woods-end-cabin', 'near-woods-old-cabin', 'near-woods-ranger-hut', 'ridge-high-hut', 'south-road-bunker',
      'south-road-checkpoint', 'south-road-dormitory', 'south-road-laboratory',
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
      'the bunker\'s crate', 'the checkpoint\'s crate', 'the crate at the leavers\' camp', 'the crate in the cabin at the end', 'the cutters\' crate', 'the dormitory\'s crate',
      'the high hut\'s crate', 'the laboratory\'s crate', 'the line cabin\'s crate', 'the old cabin\'s crate', 'the ranger\'s crate', 'the trapper\'s crate',
    ]);
  });

  it('moved nothing: each is the last thing on its map, on ground that was open, and cuts nobody off', () => {
    for (const { map, o } of crates) {
      // The last but the notes people left, laid after everything else on what stands there already (notes-left.ts).
      const things = map.data.objects.filter(t => t.kind !== 'note');
      expect(things.at(-1), map.data.id).toBe(o);
      const before = new TileMap({ ...map.data, objects: things.slice(0, -1) });
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

describe('the lost and found (roadmap/lost-and-found.md)', () => {
  const lodge = maps.get('stonebrook-lodge')!;
  const boxes = [...maps.values()].flatMap(m => m.data.objects.flatMap(o => (o.kind === 'lostfound' ? [{ map: m, o }] : [])));
  const walt = lodge.data.objects.find(o => o.kind === 'npc' && o.id === 'walt')!;

  it('is one box in the whole world, in Stonebrook Lodge at Walt\'s elbow, opened from the tile beside where you talk to him', () => {
    expect(boxes.map(b => b.map.data.id)).toEqual(['stonebrook-lodge']);
    const { o } = boxes[0]!;
    expect(Math.abs(o.x - walt.x) + Math.abs(o.y - walt.y)).toBe(1);
    expect(lodge.walkable(o.x, o.y)).toBe(false);
    // You stand below it, as at the chest, a step from where you stand to talk to Walt, and a few from the door.
    expect(lodge.walkable(o.x, o.y + 1)).toBe(true);
    expect(Math.abs(o.x - walt.x) + Math.abs(o.y + 1 - (walt.y + 1))).toBe(1);
    const path = findPath(lodge, lodge.data.spawn.x, lodge.data.spawn.y, o.x, o.y + 1);
    expect(path.at(-1)).toEqual({ x: o.x, y: o.y + 1 });
  });

  it('moved nothing in the lodge: the box is the last thing in it, on floor that was open', () => {
    expect(lodge.data.objects.at(-1)).toBe(boxes[0]!.o);
    const before = new TileMap({ ...lodge.data, objects: lodge.data.objects.slice(0, -1) });
    expect(before.walkable(boxes[0]!.o.x, boxes[0]!.o.y)).toBe(true);
  });

  it('has Walt say what it is for, last of what he always says, through the one place people\'s lines come from', () => {
    const lines = walt.kind === 'npc' ? walt.lines : [];
    expect(lines.at(-1)).toBe('Folks leave what they find here. Somebody\'s always glad of it.');
    const story = JSON.parse(readFileSync(resolve(content, 'story.json'), 'utf8')) as StoryData;
    expect(storyLines(story, story.chapters.at(-1)!.id, 'walt', lines).at(-1)).toBe(lines.at(-1));
  });

  it('knows the one bundle every carried pile is, and nothing in content gives one', () => {
    expect(items.items.filter(i => i.kind === 'bundle').map(i => i.id)).toEqual([BUNDLE]);
    expect(validateItems(items, [...maps.values()].map(m => m.data)).filter(p => p.level === 'error')).toEqual([]);
  });
});

describe('a crate that needs two (roadmap/sealed-crates.md)', () => {
  const woods = maps.get('near-woods')!;
  const slabs = [...maps.values()].flatMap(m => m.data.objects.flatMap(o => (o.kind === 'slab' ? [{ map: m, o }] : [])));
  const ring = woods.data.places!.find(p => p.name === 'ring of stones')!;

  it('is one slab, in the middle of the ring of stones, holding two strange objects and a shard, named for the notice board', () => {
    expect(slabs.map(s => s.map.data.id)).toEqual(['near-woods']);
    const { o } = slabs[0]!;
    expect([o.x, o.y]).toEqual([ring.x, ring.y]);
    if (o.kind !== 'slab') throw new Error('not a slab');
    expect(o.holds).toEqual([{ item: 'strange', count: 2 }, { item: 'shard', count: 1 }]);
    expect(o.name).toBe('the slab in the ring of stones');
    // The rocks of the ring stand around it, within a few steps each way.
    const rocks = woods.data.objects.filter(r => r.kind === 'rock' && Math.hypot(r.x - o.x, r.y - o.y) <= 3.5);
    expect(rocks.length).toBeGreaterThanOrEqual(6);
  });

  it('moved nothing: it came after everything before it, lying in open ground people walk, faced from all four sides', () => {
    const { o } = slabs[0]!;
    // Notes lie last on every map (notes-left-behind.md); before them, only what came later still (the places mended
    // together, roadmap/trail-works.md) comes after the slab.
    const things = woods.data.objects.filter(n => n.kind !== 'note');
    expect(things.slice(things.indexOf(o) + 1).map(t => (t.kind === 'lamp' && t.works ? 'works lamp' : t.kind))).toEqual(['footbridge', 'works lamp']);
    expect(woods.walkable(o.x, o.y)).toBe(true);
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) expect(woods.walkable(o.x + dx, o.y + dy), `${dx},${dy}`).toBe(true);
    // It opens while the woods are restless: they surge.
    expect(woods.data.surge).toBeDefined();
    // Nothing grows on it.
    for (const rule of items.finds.filter(f => f.map === 'near-woods')) expect(findTiles(woods, rule).some(t => t.x === o.x && t.y === o.y), rule.item).toBe(false);
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

describe('a field notebook (roadmap/field-notebook.md)', () => {
  const notebook = JSON.parse(readFileSync(resolve(content, 'notebook.json'), 'utf8')) as NotebookData;
  const all = [...maps.values()].map(m => m.data);
  const opening = (e: object) => notebook.pages.filter(p => opensOn(p).some(o => JSON.stringify(o) === JSON.stringify(e)));

  it('is sound: every page opened by something that exists, and none says where anything is', () => {
    expect(validateNotebook(notebook, all, items)).toEqual([]);
  });

  // The notebook grows as the world does: about ten pages for each area it has (the Marsh made it seven and anywhere).
  it('has about ten pages an area, across the seven areas and anywhere, each with a count worth filling', () => {
    const areas = new Map<string, number>();
    for (const p of notebook.pages) areas.set(p.area, (areas.get(p.area) ?? 0) + 1);
    expect([...areas.keys()]).toEqual(['stonebrook', 'near-woods', 'south-road', 'far-woods', 'burn', 'ridge', 'marsh', ANYWHERE]);
    expect(notebook.pages.length).toBeGreaterThanOrEqual(8 * areas.size);
    expect(notebook.pages.length).toBeLessThanOrEqual(12 * areas.size);
    for (const [area, n] of areas) expect(n, area).toBeGreaterThanOrEqual(8);
  });

  it('has a page for every kind of find, and for the charms a strange object turns out to be', () => {
    const kinds = new Set(items.finds.map(f => f.item).filter(id => items.items.find(i => i.id === id)?.kind !== 'tool'));
    for (const item of kinds) expect(opening({ find: item }).length, item).toBe(1);
    for (const charm of items.items.filter(i => i.kind === 'charm')) expect(opening({ find: charm.id }).length, charm.id).toBe(1);
  });

  it('has a page for every kind of strange thing out there, and fills in a blank on what each does', () => {
    const used = new Set(notebook.pages.flatMap(p => [...opensOn(p), ...(p.blanks ?? []).map(b => b.when)]).flatMap(e => ('saw' in e ? [e.saw] : [])));
    expect([...SIGHTS].filter(s => !used.has(s))).toEqual([]);
    const blank = (sight: Sight) => notebook.pages.flatMap(p => p.blanks ?? []).find(b => 'saw' in b.when && b.when.saw === sight)!;
    // The ones the design names: facing a watcher, a hitchhiker letting go, a surge's drain stopping under a light, the ferns before a skulker.
    expect([blank('froze').ask, blank('froze').fill]).toEqual(['It stops when... ?', 'It stops when someone looks at it.']);
    expect(blank('let-go').fill).toMatch(/street light, a fire, a roof or a flare/);
    expect(blank('lit').fill).toMatch(/street light/);
    expect(blank('rustle').fill).toMatch(/ferns rustle/);
  });

  it('has a page for the main landmarks\' signs, NAPO\'s desks that tell no chapter, and what each family left to read', () => {
    const read = (map: string, o: MapObject) => opening({ read: { map, x: o.x, y: o.y } }).length + (o.kind === 'console' ? opening({ read: o.id }).length : 0);
    for (const id of ['stonebrook', 'near-woods', 'south-road', 'far-woods']) {
      const napo = maps.get(id)!.data.objects.filter(o => o.kind === 'sign' && o.style === 'napo');
      expect(napo.length, id).toBeGreaterThan(0);
      for (const o of napo) expect(read(id, o), `${id} ${o.x},${o.y}`).toBe(1);
    }
    for (const [id, x, y] of [['stonebrook', 13, 37], ['stonebrook', 17, 10], ['near-woods', 30, 74], ['near-woods', 27, 9], ['south-road', 37, 5]] as const) {
      expect(opening({ read: { map: id, x, y } }).length, `${id} ${x},${y}`).toBe(1);
    }
    for (const room of ['stonebrook-okada-house', 'stonebrook-hale-house', 'stonebrook-dahl-house', 'stonebrook-lindqvist-house']) {
      const paper = maps.get(room)!.data.objects.find(o => o.kind === 'paper')!;
      expect(read(room, paper), room).toBe(1);
    }
    expect(opening({ read: 'station-radio' })).toHaveLength(1);
    expect(opening({ read: 'checkpoint-log' })).toHaveLength(1);
  });
});

describe('notes and keepsakes left behind (roadmap/notes-left-behind.md)', () => {
  const all = [...maps.values()];
  const notes = [...notesOf(all.map(m => m.data)).values()];
  /**
   * How deep a note lies: steps from home to the nearest tile it is read from, out in the wilds; in a room
   * off the wilds, the steps to its door; in town and its houses, none.
   */
  const depth = ({ map, note }: { map: MapData; note: MapNote }): number => {
    const m = maps.get(map.id)!;
    if (map.kind === 'wilds') return Math.min(...DIRS.map(d => stepTarget(note.x, note.y, d)).filter(t => m.walkable(t.x, t.y)).map(t => m.homeSteps(t.x, t.y)));
    const out = maps.get(map.exits[0]?.to ?? '');
    return map.kind === 'inside' && out?.data.kind === 'wilds' ? out.homeSteps(map.exits[0]!.tx, map.exits[0]!.ty) : 0;
  };
  const words = (n: { note: MapNote }) => n.note.text.join(' ').length;

  it('lays about thirty notes, ten by each of the ranger, Walt and the Barlows', () => {
    expect(notes.length).toBeGreaterThanOrEqual(25);
    expect(notes.length).toBeLessThanOrEqual(35);
    for (const by of NOTE_AUTHORS) expect(notes.filter(n => n.note.by === by).length, by).toBeGreaterThanOrEqual(8);
  });

  it('lays each on something it lies on, readable from beside it, and last on its map, after everything that was there', () => {
    for (const { map, note } of notes) {
      const where = `${note.id} in ${map.id}`;
      const under = map.objects.find(o => (NOTE_ON as readonly string[]).includes(o.kind) && objectTiles(o).some(([x, y]) => x === note.x && y === note.y));
      expect(under, where).toBeDefined();
      expect(DIRS.some(d => { const t = stepTarget(note.x, note.y, d); return maps.get(map.id)!.walkable(t.x, t.y); }), where).toBe(true);
      const first = map.objects.findIndex(o => o.kind === 'note');
      expect(map.objects.slice(first).every(o => o.kind === 'note'), where).toBe(true);
    }
  });

  it('puts them where the design says: the shelters\' tables and shelves, the old car, the poles, the empty house in town and where the leavers stopped', () => {
    const on = (n: { map: MapData; note: MapNote }) => n.map.objects.find(o => o.kind !== 'note' && objectTiles(o).some(([x, y]) => x === n.note.x && y === n.note.y))!.kind;
    const count = (pred: (n: { map: MapData; note: MapNote }) => boolean) => notes.filter(pred).length;
    expect(count(n => on(n) === 'pole')).toBeGreaterThanOrEqual(8);
    expect(count(n => n.map.id === 'near-woods' && on(n) === 'car')).toBe(2);
    expect(count(n => n.map.id === 'stonebrook-empty-house')).toBeGreaterThanOrEqual(1);
    expect(count(n => n.map.id === 'south-road' && (on(n) === 'car' || on(n) === 'luggage'))).toBeGreaterThanOrEqual(2);
    for (const shelter of ['near-woods-old-cabin', 'near-woods-ranger-hut', 'near-woods-end-cabin']) expect(count(n => n.map.id === shelter), shelter).toBeGreaterThanOrEqual(2);
    // Walt's are nailed to his poles, or lie where he went: his truck, the jam, the Tower's shed.
    for (const n of notes.filter(n => n.note.by === 'walt')) expect(['pole', 'car', 'shelf'], n.note.id).toContain(on(n));
  });

  it('says more the deeper a note lies: a line or two near town, three in the deepest shelters', () => {
    const near = notes.filter(n => depth(n) < 30), deep = notes.filter(n => depth(n) >= 80);
    expect(near.length).toBeGreaterThanOrEqual(5);
    expect(deep.length).toBeGreaterThanOrEqual(5);
    const mean = (list: typeof notes) => list.reduce((s, n) => s + words(n), 0) / list.length;
    expect(mean(deep)).toBeGreaterThan(mean(near) * 1.5);
    for (const n of near) expect(n.note.text.length, n.note.id).toBeLessThanOrEqual(2);
    expect(deep.filter(n => n.note.text.length === 3).length).toBeGreaterThanOrEqual(deep.length / 2);
  });

  it('keeps some for their time: glowing writing for the night, wax for the rain, a shard\'s scratches for a green night', () => {
    for (const when of ['night', 'rain', 'aurora'] as const) {
      const timed = notes.filter(n => n.note.when === when);
      expect(timed.length, when).toBeGreaterThanOrEqual(2);
      // What shows the rest of the time says so, in the note's own words.
      for (const n of timed) expect(n.note.faint, n.note.id).toBeTruthy();
    }
    // Rain only wets paper out of doors.
    for (const n of notes.filter(n => n.note.when === 'rain')) expect(n.map.kind, n.note.id).not.toBe('inside');
    expect(notes.filter(n => n.note.when).length).toBeLessThanOrEqual(notes.length / 3);
  });

  it('names every note and keepsake for the first to find it: whose note and where, or the keepsake (roadmap/first-finders.md)', () => {
    const byId = notesOf(all.map(m => m.data)), defs = itemIndex(items);
    for (const { note } of notes) expect(secretTitle(secretKey({ kind: 'note', id: note.id }), byId, defs), note.id).toMatch(/^(the ranger's|Walt's|the Barlows') note (by|in) the /);
    for (const p of items.keepsakes!.places) expect(secretTitle(secretKey({ kind: 'keepsake', item: p.item }), byId, defs), p.item).toMatch(/^the [a-zA-Z ]+$/);
  });

  it('lays five keepsakes, one of a kind each, where the notes lead: each on open ground somebody can walk to', () => {
    const k = items.keepsakes!;
    expect(k.energy).toBe(5);
    expect(k.places.map(p => p.item)).toEqual(['old-photograph', 'brass-compass', 'pole-tag', 'tin-whistle', 'staff-badge']);
    for (const p of k.places) {
      const def = items.items.find(i => i.id === p.item)!;
      expect(def.kind, p.item).toBe('keepsake');
      expect(def.text.length, p.item).toBeGreaterThan(20);
      const m = maps.get(p.map)!;
      expect(m.walkable(p.x, p.y), p.item).toBe(true);
      // Reached from the way in, as a find is.
      expect(m.data.kind !== 'wilds' || m.homeSteps(p.x, p.y) >= 0, p.item).toBe(true);
    }
    // One in town, three in the woods (deeper each), one on the South Road.
    expect(k.places.map(p => p.map)).toEqual(['stonebrook', 'near-woods', 'near-woods', 'near-woods', 'south-road']);
    const woods = maps.get('near-woods')!;
    const steps = k.places.filter(p => p.map === 'near-woods').map(p => woods.homeSteps(p.x, p.y));
    expect(steps.every(s => s >= 50)).toBe(true);
    expect(validateItems(items, all.map(m => m.data)).filter(p => p.level === 'error')).toEqual([]);
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
/** The road to your street in Stonebrook (roadmap/street-visits.md, tools/gen-map.ts): west off the main street, x 0 to 10 on rows 17 and 18. */
/** The house that was Home, dark since everyone who stayed moved out (roadmap/street-visits.md, then roadmap/home-lots.md). */
const darkSince = (o: MapObject): MapObject => (o.kind === 'house' && o.x === 7 && o.y === 19 ? { ...o, lit: 0 } : o);

describe('the pass that put more of the story in the places (roadmap/richer-places.md)', () => {
  const areas = ['stonebrook', 'near-woods', 'south-road'] as const;

  it('only added: every tile, exit, place and thing that was there still is, where it was and in its order', () => {
    for (const id of areas) {
      const b = before[id]!, now = maps.get(id)!.data;
      expect(now.version, id).toBeGreaterThan(b.version);
      expect(now.spawn, id).toEqual(b.spawn);
      // New exits (the doors of new houses) and new names come after the old ones. One door changed since, on
      // purpose: the house that was Home was the way onto your street (roadmap/streets.md), and since a road
      // is (roadmap/street-visits.md) it leads into the old home, where it was.
      const oldHome = maps.get('stonebrook-old-home')!.data.exits[0]!;
      const since = (e: MapExit): MapExit => (e.to === 'stonebrook-home' ? { ...e, to: 'stonebrook-old-home', tx: oldHome.x, ty: oldHome.y - 1 } : e);
      expect(now.exits.slice(0, b.exits.length), id).toEqual(b.exits.map(since));
      expect((now.places ?? []).slice(0, b.places.length), id).toEqual(b.places);
      // The old things first, in their order (which lamps flicker, and which poles the wires run between, go by it),
      // the house that was Home dark since. (The trees felled for the road to the street stand again: the road went
      // with the street, roadmap/home-lots.md.)
      const standing = b.nature;
      const things = b.things.map(o => JSON.stringify(id === 'stonebrook' ? darkSince(o) : o));
      const old = new Set([...standing, ...things]);
      const first = now.objects.slice(0, old.size).map(kept);
      expect(first.filter(k => !old.has(k)), id).toEqual([]);
      expect(new Set(first).size, id).toBe(old.size);
      expect(now.objects.slice(0, old.size).filter(o => !NATURE.has(o.kind)).map(o => JSON.stringify(o)), id).toEqual(things);
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
    // Only what was placed after it (the fire lookout and its sign, the slab in the ring of stones, the places mended
    // together) and the notes people left, laid last, come after the shed; its door is the last exit.
    const after = woods.data.objects.slice(woods.data.objects.indexOf(shed) + 1).filter(o => o.kind !== 'note');
    expect(after.map(o => (o.kind === 'lamp' && o.works ? 'works lamp' : o.kind))).toEqual(['lookout', 'sign', 'slab', 'footbridge', 'works lamp']);
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

describe('Stonebrook wakes up (roadmap/stonebrook-wakes.md)', () => {
  const town = items.town!;
  const story = JSON.parse(readFileSync(resolve(content, 'story.json'), 'utf8')) as StoryData;
  const stonebrook = maps.get('stonebrook')!;
  /** Where a person stands on any map as content has them, whatever the town has come to, with their gate. */
  const npcs = (id: string) => [...maps.values()].flatMap(m => m.source.objects.flatMap(o => (o.kind === 'npc' && o.id === id ? [{ map: m.source.id, town: o.town }] : [])));
  const as = (id: string, done: string[]) => new TileMap(maps.get(id)!.source, new Set(done));

  it('brings three people from before back for good, each when the whole server reaches a milestone: Edith first, the first time the Old Stone wakes', () => {
    expect(town.milestones.map(m => [m.id, m.when.count, m.back])).toEqual([['edith-home', 'woke', 'Edith'], ['mill-stove', 'fed', 'Arvid'], ['lodge-cook', 'thanks', 'Maud']]);
    expect(town.milestones[0]!.when.n).toBe(1);
    for (const m of town.milestones) {
      expect(m.title.length, m.id).toBeGreaterThan(5);
      // Somewhere in town from their milestone on, and only then.
      expect(npcs(m.back!.toLowerCase()).filter(p => p.town?.from === m.id), m.id).toHaveLength(1);
    }
  });

  it('keeps Edith in the NAPO Bunker with Ruth until she is home, then in the empty house next to yours by her own fire, and nowhere else', () => {
    expect(npcs('edith')).toEqual([{ map: 'south-road-bunker', town: { until: 'edith-home' } }, { map: 'stonebrook-empty-house', town: { from: 'edith-home' } }]);
    expect(npcs('ruth')).toEqual([{ map: 'south-road-bunker', town: undefined }]);
    const empty = maps.get('stonebrook-empty-house')!, home = as('stonebrook-empty-house', ['edith-home']);
    expect([empty.data.name, home.data.name]).toEqual(['The empty house', 'Edith\'s house']);
    // A cold hearth until she lights it: then a fire, warm beside it.
    const fire = empty.source.objects.find(o => o.kind === 'fireplace')!;
    expect(fire).toMatchObject({ town: { from: 'edith-home' } });
    expect(empty.data.objects.find(o => o.x === fire.x && o.y === fire.y)?.kind).toBe('hearth');
    expect([empty.warm(fire.x, fire.y + 1), home.warm(fire.x, fire.y + 1)]).toEqual([false, true]);
    // The Barlows' notes stay on her table.
    const notes = (m: TileMap) => m.data.objects.flatMap(o => (o.kind === 'note' ? [o.id] : []));
    expect(notes(home)).toEqual(notes(empty));
    expect(notes(empty)).toEqual(['barlow-tins', 'barlow-next-door']);
    // In town, the house the door opens into lights up, and her name is on the mailbox again.
    const door = stonebrook.source.exits.find(e => e.to === 'stonebrook-empty-house')!;
    const house = stonebrook.source.objects.find(o => o.kind === 'house' && objectTiles(o).some(([x, y]) => x === door.x && y === door.y))!;
    expect(house).toMatchObject({ lit: 0 });
    expect(as('stonebrook', ['edith-home']).data.objects.find(o => o.kind === 'house' && o.x === house.x && o.y === house.y)).toMatchObject({ lit: 1 });
    const mailbox = (m: TileMap) => m.data.objects.flatMap(o => (o.kind === 'sign' && o.style === 'mailbox' && Math.abs(o.x - door.x) <= 1 && o.y === door.y + 1 ? [o.text[0]] : []));
    expect(mailbox(stonebrook)).toEqual(['A mailbox. The name painted on it went with the weather.']);
    expect(mailbox(as('stonebrook', ['edith-home']))).toEqual(['LUND, freshly painted.']);
  });

  it('moves the cloth the empty house held to the lodge\'s shelves once Edith is home: the same cloth, never in both', () => {
    const [was, now] = ['stonebrook-empty-house', 'stonebrook-lodge'].map(id => items.finds.find(f => f.item === 'cloth' && f.map === id)!);
    expect([was!.town, now!.town]).toEqual([{ until: 'edith-home' }, { from: 'edith-home' }]);
    expect([now!.count, now!.respawn]).toEqual([was!.count, was!.respawn]);
    expect(findTiles(maps.get('stonebrook-lodge')!, now!).length).toBeGreaterThanOrEqual(3 * now!.count);
  });

  it('chalks everyone who came back over the number on the town\'s sign: people from before, never players', () => {
    expect(town.pop).toBe(23);
    const at = stonebrook.source.town!.sign!;
    const sign = (m: TileMap) => m.data.objects.find(o => o.kind === 'sign' && o.x === at.x && o.y === at.y)!;
    expect(sign(stonebrook)).toMatchObject({ text: ['Stonebrook. Pop. 23', expect.any(String)] });
    const all = new TileMap(stonebrook.source, new Set(town.milestones.map(m => m.id)), 26);
    expect(sign(all)).toMatchObject({ text: ['Stonebrook. Pop. 23', expect.any(String), 'The 23 is crossed out in chalk. Beside it, in the same chalk: 26.'] });
  });

  it('keeps a ledger in the lodge for the street lights on the south road, a roof over the notice board and the sawmill\'s roof, each mended for good', () => {
    expect(town.works.map(w => w.id)).toEqual(['south-lights', 'board-shelter', 'mill-roof']);
    expect(maps.get('stonebrook-lodge')!.source.objects.filter(o => o.kind === 'ledger')).toHaveLength(1);
    for (const w of town.works) for (const n of w.needs) expect(items.items.some(i => i.id === n.item && i.kind === 'resource'), `${w.id}: ${n.item}`).toBe(true);
    // The lights: dark on the south road until mended, lit for good after.
    const lamps = stonebrook.source.objects.filter(o => o.kind === 'lamp' && o.town?.from === 'south-lights');
    expect(lamps.length).toBeGreaterThanOrEqual(3);
    const lit = as('stonebrook', ['south-lights']);
    for (const l of lamps) expect([stonebrook.lit(l.x, l.y + 1), lit.lit(l.x, l.y + 1)], `${l.x},${l.y}`).toEqual([false, true]);
    // The roof: over the notice board and where it is read from.
    const board = stonebrook.source.objects.find(o => o.kind === 'board')!;
    expect([stonebrook.roofed(board.x, board.y + 1), as('stonebrook', ['board-shelter']).roofed(board.x, board.y + 1)]).toEqual([false, true]);
    // The mill's roof: more scrap turns up on its dry floor.
    expect(items.finds.filter(f => f.town?.from === 'mill-roof').map(f => [f.item, f.map])).toEqual([['scrap', 'stonebrook-sawmill']]);
  });

  it('has Walt swap what you carry spare: 10 glowcaps for a cloth, 5 scrap for a road flare', () => {
    expect(items.swaps).toEqual([
      { id: 'glowcaps-for-cloth', who: 'walt', give: { item: 'glowcap', count: 10 }, get: { item: 'cloth', count: 1 } },
      { id: 'scrap-for-flare', who: 'walt', give: { item: 'scrap', count: 5 }, get: { item: 'flare', count: 1 } },
    ]);
    expect(npcs('walt')).toEqual([{ map: 'stonebrook-lodge', town: undefined }]);
  });

  it('has Walt tell four scenes, each opening at a level once his notes are read, a fifth once the lamp has gone out, and Edith two once she is home', () => {
    const scenes = story.scenes!, byId = notesOf([...maps.values()].map(m => m.source));
    const all = scenes.filter(s => s.who === 'walt');
    // The last opens on a page of the field notes (the dead line, roadmap/the-dead-line.md), not on a note.
    expect(all.map(s => s.id)).toEqual(['walt-hum', 'walt-answer', 'walt-two-weeks', 'walt-stayed', 'walt-lamp']);
    expect(all[4]!.when.pages).toEqual(['lamp-out']);
    const walt = all.slice(0, 4);
    for (const s of walt) {
      expect(s.when.level, s.id).toBeGreaterThan(1);
      expect(s.when.notes?.length, s.id).toBeGreaterThan(0);
      for (const n of s.when.notes!) expect(byId.get(n)?.note.by, `${s.id}: ${n}`).toBe('walt');
    }
    const levels = all.map(s => s.when.level!);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(scenes.filter(s => s.who === 'edith').map(s => [s.id, s.when.town])).toEqual([['edith-kept', 'edith-home'], ['edith-kari', 'edith-home']]);
    for (const s of scenes) expect(s.lines.length, s.id).toBeGreaterThanOrEqual(4);
  });

  it('has people speak to the sky (a storm over the woods, an aurora night) and to everything the town comes to', () => {
    const says = story.says!;
    for (const sky of ['storm', 'aurora'] as const) expect(says.filter(s => s.when.sky === sky).length, sky).toBeGreaterThanOrEqual(2);
    for (const m of [...town.milestones, ...town.works]) expect(says.some(s => s.when.town === m.id), m.id).toBe(true);
    // Each person's words are their own: nobody says a line twice.
    expect(new Set(says.map(s => s.line)).size).toBe(says.length);
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

  it('moved nothing: it and its sign came after everything before them, on forest they cleared, and every tile anyone walks is as far from home as without them', () => {
    const at = woods.data.objects.indexOf(tower), sign = woods.data.objects[at + 1]!;
    expect(woods.data.objects.slice(at, at + 2).map(o => o.kind)).toEqual(['lookout', 'sign']);
    // Only what was placed after them (the slab in the ring of stones, walked over like the ground, and the places
    // mended together) and the notes people left, laid last.
    const later = woods.data.objects.slice(at + 2).filter(o => o.kind !== 'note');
    expect(later.map(o => (o.kind === 'lamp' && o.works ? 'works lamp' : o.kind))).toEqual(['slab', 'footbridge', 'works lamp']);
    const cleared = new Set([...objectTiles(tower), ...objectTiles(sign), [foot.x, foot.y] as const].map(([x, y]) => `${x},${y}`));
    const without = new TileMap({
      ...woods.data, tiles: woods.data.tiles.map((r, y) => [...r].map((c, x) => (cleared.has(`${x},${y}`) ? 't' : c)).join('')), objects: woods.data.objects.filter(o => o !== tower && o !== sign),
    });
    expect(woods.deepest).toBe(without.deepest);
    for (let y = 0; y < woods.height; y++) for (let x = 0; x < W; x++) {
      if (!without.walkable(x, y)) continue;
      expect(woods.walkable(x, y), `${x},${y}`).toBe(true);
      expect(woods.homeSteps(x, y), `${x},${y}`).toBe(without.homeSteps(x, y));
    }
  });
});

describe('mending the woods together (roadmap/trail-works.md)', () => {
  const woods = maps.get('near-woods')!, W = woods.width;
  const works = items.works ?? [];
  const bridge = woods.data.objects.find((o): o is Extract<MapObject, { kind: 'footbridge' }> => o.kind === 'footbridge')!;
  const light = woods.data.objects.find((o): o is Extract<MapObject, { kind: 'lamp' }> => o.kind === 'lamp' && o.works !== undefined)!;
  const pond = woods.data.places!.find(p => p.name === 'pond')!;
  const STANDS = new Set([bridge.id]);
  /** Walking steps from a tile to every other, as the game walks them, with what a pass opens. */
  const walk = (from: readonly [number, number], pass?: ReadonlySet<string>) => {
    const d = new Int32Array(W * woods.height).fill(-1), queue = [from[1] * W + from[0]];
    d[queue[0]!] = 0;
    for (let h = 0; h < queue.length; h++) {
      const i = queue[h]!, x = i % W, y = Math.floor(i / W);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (!woods.walkable(nx, ny, pass) || woods.exitAt(nx, ny) || d[ny * W + nx]! >= 0) continue;
        d[ny * W + nx] = d[i]! + 1;
        queue.push(ny * W + nx);
      }
    }
    return ([x, y]: readonly [number, number]) => d[y * W + x]!;
  };

  it('are a footbridge by the pond that takes scrap, 5 a day to keep up, and a street light in its clearing that takes copper wire, 2 a day (and the Marsh\'s boardwalks, roadmap/the-marsh.md)', () => {
    expect(works.map(w => [w.id, w.build, w.item, w.wear])).toEqual([
      ['pond-footbridge', 'footbridge', 'scrap', 5], ['pond-light', 'light', 'wire', 2], ['marsh-boardwalk-west', 'footbridge', 'scrap', 4], ['marsh-boardwalk-east', 'footbridge', 'wire', 2],
    ]);
    for (const w of works) {
      // More to stand again than a day's wear, and never more than a week of it put by ahead.
      expect(w.need).toBeGreaterThan(w.wear);
      expect(w.hold).toBeLessThanOrEqual(7 * w.wear);
      expect(w.hold).toBeGreaterThanOrEqual(w.wear);
    }
    expect(validateItems(items, [...maps.values()].map(m => m.data))).toEqual([]);
  });

  it('spans the creek where it leaves the pond, bank to bank, walkable only while it stands: 14 steps shorter on the way home from the far bank', () => {
    expect(bridge.id).toBe('pond-footbridge');
    for (const [x, y] of objectTiles(bridge)) {
      expect(woods.kind(x, y)).toBe('water');
      expect(woods.walkable(x, y)).toBe(false);
      expect(woods.walkable(x, y, STANDS)).toBe(true);
    }
    expect(Math.hypot(bridge.x - pond.x, bridge.y - pond.y)).toBeLessThan(6);
    const west = [bridge.x - 1, bridge.y] as const, home = [31, woods.height - 2] as const;
    expect(walk(west)(home) - walk(west, STANDS)(home)).toBe(14);
    // How deep the far bank is does not change by it: only the walk home.
    expect(woods.homeSteps(...west)).toBe(walk(west)(home) + 1);
  });

  it('lights the pond clearing only while it stands: what it lights keeps off surges and creatures then, like any street light', () => {
    expect(light.works).toBe('pond-light');
    expect(Math.hypot(light.x - pond.x, light.y - pond.y)).toBeLessThan(4);
    const lit = new Set(['pond-light']);
    for (const [x, y] of [[light.x - 1, light.y], [light.x - 2, light.y], [light.x - 1, light.y - 1], [light.x - 1, light.y + 1]] as const) {
      expect(woods.walkable(x, y), `${x},${y}`).toBe(true);
      expect(woods.lit(x, y), `${x},${y}`).toBe(false);
      expect(woods.lit(x, y, lit), `${x},${y}`).toBe(true);
      expect(woods.creatureMayStand(x, y, lit), `${x},${y}`).toBe(false);
    }
  });

  it('moved nothing: they came last but the notes people left, the footbridge over the creek and the light on forest it cleared, and every tile anyone walks is as far from home as without them', () => {
    const at = woods.data.objects.indexOf(bridge);
    // Notes lie last on every map (notes-left-behind.md); before them, nothing comes after these two.
    expect(woods.data.objects.slice(at).filter(o => o.kind !== 'note')).toEqual([bridge, light]);
    const without = new TileMap({
      ...woods.data, tiles: woods.data.tiles.map((r, y) => (y === light.y ? `${r.slice(0, light.x)}t${r.slice(light.x + 1)}` : r)),
      objects: woods.data.objects.filter(o => o !== bridge && o !== light),
    });
    expect(woods.deepest).toBe(without.deepest);
    for (let y = 0; y < woods.height; y++) for (let x = 0; x < W; x++) {
      if (!without.walkable(x, y)) continue;
      expect(woods.walkable(x, y), `${x},${y}`).toBe(true);
      expect(woods.homeSteps(x, y), `${x},${y}`).toBe(without.homeSteps(x, y));
    }
  });
});
