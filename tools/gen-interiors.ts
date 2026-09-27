/**
 * Generates the inside of every building, like the houses of FireRed: one small room per house door,
 * each a map of its own (content/maps/<id>.json). The rooms are drawn by hand below, as rows of wall
 * (x) and floor (p) plus the furniture, so they only change when this file does; re-running it
 * overwrites hand edits to their JSON. Usage: npm run gen:interiors
 *
 * Every room follows one plan, so going in and out always feels the same: walls all around; the way
 * out is the floor tile in the middle of the bottom wall, and it leads to the tile in front of the
 * house's door, facing down; you come in on the tile above it, facing up (also the room's spawn). A
 * fireplace stands against the top wall with floor in front: the tiles around it are where energy
 * comes back. A room without one is cold and dark. Rooms stay small so the camera shows all of one.
 *
 * The outside generators (gen-map.ts, gen-woods.ts) put the exit on each house's door with doorInto,
 * which fails if the room expects its house somewhere else. This script checks the other direction, so
 * run it after them: each door on the outside maps must lead to its room's way in.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DECOR, TileMap, doorOf, objectTiles, validateMap, type MapData, type MapExit, type MapObject } from '../packages/shared/src';

type House = Extract<MapObject, { kind: 'house' }>;

interface Room {
  /** Also the file name. */
  id: string;
  /** Shown as a banner when you walk in. */
  name: string;
  /** Bump when the room changes; a client with another version reloads. */
  version: number;
  /** The map the house stands on, and the house's door there (doorOf). */
  outside: string;
  door: readonly [number, number];
  rows: readonly string[];
  things: readonly MapObject[];
}

/** The camera shows about six tiles around you: a room this size fits on any screen. */
const MAX_W = 11, MAX_H = 8;

const ROOMS: readonly Room[] = [
  {
    // Where you wake up: the spawn is at its door. A small warm room, and the fire never goes out.
    id: 'stonebrook-home', name: 'Home', version: 1, outside: 'stonebrook', door: [8, 20],
    rows: [
      'xxxxxxxxx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xxxxpxxxx',
    ],
    things: [
      { kind: 'fireplace', x: 4, y: 1 },
      { kind: 'rug', x: 3, y: 2, w: 3, h: 2 },
      { kind: 'shelf', x: 1, y: 1 },
      { kind: 'shelf', x: 2, y: 1 },
      { kind: 'bed', x: 7, y: 1 },
      { kind: 'table', x: 2, y: 4 },
    ],
  },
  {
    // Whoever lived next door left with the others and never came back: no fire, dust, what they
    // could not carry. The only dark room in town.
    id: 'stonebrook-empty-house', name: 'The empty house', version: 1, outside: 'stonebrook', door: [15, 20],
    rows: [
      'xxxxxxxxx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xxxxpxxxx',
    ],
    things: [
      { kind: 'shelf', x: 2, y: 1 },
      { kind: 'crate', x: 6, y: 1 },
      { kind: 'crate', x: 7, y: 1 },
      { kind: 'crate', x: 7, y: 2 },
      { kind: 'crate', x: 3, y: 3 },
      { kind: 'table', x: 1, y: 4 },
      { kind: 'crate', x: 6, y: 5 },
    ],
  },
  {
    // Where the town gathers: the biggest room, long tables, and the fire in the middle of the back wall.
    id: 'stonebrook-lodge', name: 'Stonebrook Lodge', version: 1, outside: 'stonebrook', door: [8, 31],
    rows: [
      'xxxxxxxxxxx',
      'xpppppppppx',
      'xpppppppppx',
      'xpppppppppx',
      'xpppppppppx',
      'xpppppppppx',
      'xpppppppppx',
      'xxxxxpxxxxx',
    ],
    things: [
      { kind: 'fireplace', x: 5, y: 1 },
      { kind: 'rug', x: 4, y: 2, w: 3, h: 2 },
      { kind: 'shelf', x: 1, y: 1 },
      { kind: 'shelf', x: 2, y: 1 },
      { kind: 'shelf', x: 8, y: 1 },
      { kind: 'shelf', x: 9, y: 1 },
      { kind: 'table', x: 2, y: 4 },
      { kind: 'table', x: 3, y: 4 },
      { kind: 'table', x: 7, y: 4 },
      { kind: 'table', x: 8, y: 4 },
      { kind: 'barrel', x: 1, y: 6 },
      { kind: 'barrel', x: 9, y: 6 },
    ],
  },
  {
    // The Near Woods' first shelter, past the crossroads. Abandoned once; now somebody keeps the fire
    // going. A bunk, crates, not much else.
    id: 'near-woods-old-cabin', name: 'The old cabin', version: 1, outside: 'near-woods', door: [47, 38],
    rows: [
      'xxxxxxxxx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xxxxpxxxx',
    ],
    things: [
      { kind: 'fireplace', x: 4, y: 1 },
      { kind: 'bed', x: 1, y: 1 },
      { kind: 'shelf', x: 6, y: 1 },
      { kind: 'crate', x: 7, y: 1 },
      { kind: 'crate', x: 1, y: 3 },
      { kind: 'crate', x: 6, y: 3 },
      { kind: 'crate', x: 7, y: 3 },
    ],
  },
  {
    // Behind the lonely lamp, the refuge of the west loop: one room, a bunk, the fire, a ranger's things.
    id: 'near-woods-ranger-hut', name: 'The ranger\'s hut', version: 1, outside: 'near-woods', door: [30, 6],
    rows: [
      'xxxxxxx',
      'xpppppx',
      'xpppppx',
      'xpppppx',
      'xpppppx',
      'xxxpxxx',
    ],
    things: [
      { kind: 'fireplace', x: 3, y: 1 },
      { kind: 'shelf', x: 1, y: 1 },
      { kind: 'bed', x: 5, y: 1 },
      { kind: 'table', x: 1, y: 3 },
      { kind: 'crate', x: 5, y: 4 },
    ],
  },
  {
    // The deepest shelter, at the end of the east trail: the cabin whose light was always on. Somebody
    // lived here longer than anywhere else in the woods.
    id: 'near-woods-end-cabin', name: 'The cabin at the end', version: 1, outside: 'near-woods', door: [55, 4],
    rows: [
      'xxxxxxxxx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xxxxpxxxx',
    ],
    things: [
      { kind: 'fireplace', x: 3, y: 1 },
      { kind: 'rug', x: 2, y: 2, w: 3, h: 2 },
      { kind: 'shelf', x: 6, y: 1 },
      { kind: 'shelf', x: 7, y: 1 },
      { kind: 'table', x: 6, y: 3 },
      { kind: 'bed', x: 1, y: 4 },
      { kind: 'crate', x: 7, y: 5 },
    ],
  },
];

/** The way out: the middle of the bottom wall. You come in on the tile above it. */
function wayOut(room: Room): { x: number; y: number } {
  return { x: Math.floor(room.rows[0]!.length / 2), y: room.rows.length - 1 };
}

/**
 * The exit on a house's door into room `id`, for the generator of the map the house stands on. Fails
 * if the room expects its house somewhere else, so a house cannot move without its room following.
 */
export function doorInto(id: string, outside: string, house: House): MapExit {
  const room = ROOMS.find(r => r.id === id);
  if (!room) throw new Error(`there is no room ${id} in tools/gen-interiors.ts`);
  const d = doorOf(house);
  if (room.outside !== outside || room.door[0] !== d.x || room.door[1] !== d.y) {
    throw new Error(`the room ${id} expects its door at ${room.door.join(',')} in ${room.outside}, but this house's door is at ${d.x},${d.y} in ${outside}`);
  }
  const way = wayOut(room);
  return { x: d.x, y: d.y, w: 1, h: 1, to: id, tx: way.x, ty: way.y - 1, dir: 'up' };
}

function build(room: Room): MapData {
  const way = wayOut(room);
  return {
    id: room.id, name: room.name, version: room.version, kind: 'inside', depth: 0,
    width: room.rows[0]!.length, height: room.rows.length,
    tiles: [...room.rows],
    levels: room.rows.map(r => '0'.repeat(r.length)),
    spawn: { x: way.x, y: way.y - 1, dir: 'up' },
    exits: [{ x: way.x, y: way.y, w: 1, h: 1, to: room.outside, tx: room.door[0], ty: room.door[1] + 1, dir: 'down' }],
    objects: [...room.things],
  };
}

/** The plan every room follows, beyond what validateMap checks for any map. */
function planProblems(room: Room, map: MapData): string[] {
  const out: string[] = [];
  const W = map.width, H = map.height, way = wayOut(room);
  if (W % 2 === 0) out.push(`it is ${W} tiles wide: an odd width puts the way out in the middle`);
  if (W > MAX_W || H > MAX_H) out.push(`it is ${W}x${H}, bigger than ${MAX_W}x${MAX_H}: the camera would not show all of it`);
  room.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const outer = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      if (row[x] !== 'x' && row[x] !== 'p') out.push(`tile ${x},${y} is '${row[x]}': rooms are wall (x) and floor (p)`);
      else if (outer && row[x] !== 'x' && !(x === way.x && y === way.y)) out.push(`the outer wall has a gap at ${x},${y}`);
    }
  });
  const tm = new TileMap(map);
  for (const o of room.things) {
    if (objectTiles(o).some(([x, y]) => room.rows[y]?.[x] !== 'p')) out.push(`the ${o.kind} at ${o.x},${o.y} is not on the floor`);
    if (o.kind === 'fireplace' && (o.y !== 1 || !tm.walkable(o.x, o.y + 1))) out.push(`the fireplace at ${o.x},${o.y} must stand against the top wall with floor in front`);
  }
  return out;
}

// One row or object per line, like the other maps, so changes show up as small, readable diffs.
function json(map: MapData): string {
  return [
    '{',
    `  "id": ${JSON.stringify(map.id)},`, `  "name": ${JSON.stringify(map.name)},`, `  "version": ${map.version},`,
    `  "kind": ${JSON.stringify(map.kind)},`, `  "depth": ${map.depth},`,
    `  "width": ${map.width},`, `  "height": ${map.height},`,
    '  "tiles": [', map.tiles.map(r => `    ${JSON.stringify(r)}`).join(',\n'), '  ],',
    '  "levels": [', map.levels.map(r => `    ${JSON.stringify(r)}`).join(',\n'), '  ],',
    `  "spawn": ${JSON.stringify(map.spawn)},`,
    '  "exits": [', map.exits.map(e => `    ${JSON.stringify(e)}`).join(',\n'), '  ],',
    '  "objects": [', map.objects.map(o => `    ${JSON.stringify(o)}`).join(',\n'), '  ]',
    '}',
    '',
  ].join('\n');
}

/** A glance at a room: # wall, . floor, + warm floor (next to the fire), v the way out, letters for furniture. */
const GLYPH: Partial<Record<MapObject['kind'], string>> = { fireplace: 'F', bed: 'B', table: 'T', shelf: 'L', crate: 'c', barrel: 'b', rug: '_' };
function glance(map: MapData): string[] {
  const tm = new TileMap(map);
  const things = new Map<string, string>();
  // Solid things first, so a rug under a table shows the table.
  for (const o of [...map.objects].sort((a, b) => Number(DECOR.has(b.kind)) - Number(DECOR.has(a.kind)))) {
    for (const [x, y] of objectTiles(o)) things.set(`${x},${y}`, GLYPH[o.kind] ?? '?');
  }
  const exit = map.exits[0]!;
  return map.tiles.map((row, y) => [...row].map((c, x) => {
    if (x === exit.x && y === exit.y) return 'v';
    const thing = things.get(`${x},${y}`);
    if (thing && thing !== '_') return thing;
    if (c === 'x') return '#';
    return tm.warm(x, y) ? '+' : thing ?? '.';
  }).join(''));
}

if (import.meta.main) {
  let failed = false;
  for (const room of ROOMS) {
    const map = build(room);
    const out = resolve(import.meta.dirname, `../content/maps/${map.id}.json`);
    writeFileSync(out, json(map));
    const kinds = [...new Set(map.objects.map(o => o.kind))].map(k => { const n = map.objects.filter(o => o.kind === k).length; return n > 1 ? `${k} x${n}` : k; });
    console.log(`wrote ${out}: "${map.name}", ${map.width}x${map.height}, ${kinds.join(', ')}; out to ${room.door[0]},${room.door[1] + 1} in ${room.outside}`);
    for (const row of glance(map)) console.log(`    ${row}`);
    const problems = [...planProblems(room, map).map(message => ({ level: 'error', message })), ...validateMap(map)];
    // Rooms are small and drawn by hand, so even a warning (floor nobody can reach) is a mistake here.
    for (const p of problems) console.log(`${p.level}: ${map.id}: ${p.message}`);
    if (problems.length) failed = true;
  }
  // The other direction of doorInto: the door on the outside map must lead to the room's way in. It is
  // written by the outside map's generator, so after changing a room's size, run that one again too.
  const GENERATOR: Record<string, string> = { stonebrook: 'npm run gen:map', 'near-woods': 'npm run gen:woods' };
  for (const room of ROOMS) {
    const outside = JSON.parse(readFileSync(resolve(import.meta.dirname, `../content/maps/${room.outside}.json`), 'utf8')) as MapData;
    const door = outside.exits.find(e => e.to === room.id), way = wayOut(room);
    if (door?.x === room.door[0] && door.y === room.door[1] && door.tx === way.x && door.ty === way.y - 1) continue;
    console.log(`error: ${room.outside}.json has no door at ${room.door.join(',')} into ${room.id}'s way in (${way.x},${way.y - 1}): run ${GENERATOR[room.outside] ?? `the generator of ${room.outside}`} again`);
    failed = true;
  }
  if (failed) process.exit(1);
}
