import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TileMap, doorOf, findPath, findTiles, hidden, objectTiles, type ItemsData, type MapData, type MapObject } from '@napoland/shared';

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
