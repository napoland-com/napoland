/**
 * Generates content/maps/stonebrook.json, the starting town, from a fixed seed.
 * This script is the source of the map: change it, not the JSON (CI regenerates the JSON and
 * fails if it differs, so hand edits would be caught). Usage: npm run gen:map, or npm run gen for all.
 * Every house's door leads inside; the rooms are drawn in gen-interiors.ts.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { objectTiles, type MapData, type MapExit, type MapObject } from '../packages/shared/src';
import { doorInto } from './gen-interiors';
import { ontoStreet } from './gen-street';

const N = 44;
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260926);

const tile: string[][] = Array.from({ length: N }, () => Array<string>(N).fill('g'));
const level: number[][] = Array.from({ length: N }, () => Array<number>(N).fill(0));
const blocked: boolean[][] = Array.from({ length: N }, () => Array<boolean>(N).fill(false));
const objects: MapObject[] = [];
const at = (x: number, y: number) => (x < 0 || y < 0 || x >= N || y >= N ? '' : tile[y]![x]!);
function rect(x0: number, y0: number, x1: number, y1: number, fn: (x: number, y: number) => void) {
  for (let y = Math.max(0, y0); y <= Math.min(N - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(N - 1, x1); x++) fn(x, y);
}
const paint = (c: string) => (x: number, y: number) => { tile[y]![x] = c; };
const block = (x: number, y: number) => { blocked[y]![x] = true; };
function place(o: MapObject) {
  objects.push(o);
  if (o.kind !== 'shrooms') for (const [x, y] of objectTiles(o)) block(x, y);
}

// Terrain: a raised plateau in the north-west, roads, the gravel lot, the pond and the fern patches.
rect(2, 2, 11, 8, (x, y) => { level[y]![x] = 1; });
rect(11, 17, 12, 43, paint('r')); rect(11, 17, 30, 18, paint('r')); rect(29, 0, 30, 18, paint('r'));
rect(15, 10, 16, 16, paint('r')); rect(13, 29, 26, 30, paint('r'));
rect(9, 23, 15, 27, paint('l'));
const POND = { x: 31.5, y: 33.5, rx: 5.2, ry: 3.6 };
rect(0, 0, N - 1, N - 1, (x, y) => {
  const e = ((x + 0.5 - POND.x) / POND.rx) ** 2 + ((y + 0.5 - POND.y) / POND.ry) ** 2;
  if (e <= 1) tile[y]![x] = 'w'; else if (e <= 1.55 && tile[y]![x] === 'g') tile[y]![x] = 'm';
});
for (const [x0, y0, x1, y1] of [[21, 4, 27, 10], [32, 5, 39, 11], [33, 19, 40, 25]] as const) rect(x0, y0, x1, y1, (x, y) => { if (tile[y]![x] === 'g' && !level[y]![x]) tile[y]![x] = 'f'; });

// Town. Every house can be entered: the house that was home, whose door is the way onto your street
// (Residents' Lane, gen-street.ts, where your own cabin stands; the spawn is at its door), the empty
// house next door, and the lodge, where the town sits by the fire.
const houses = [
  { x: 7, y: 19, roof: '#6b7075', lit: 1, inside: null },
  { x: 14, y: 19, roof: '#7a4b33', lit: 0, inside: 'stonebrook-empty-house' },
  { x: 7, y: 30, roof: '#4a5a44', lit: 1, inside: 'stonebrook-lodge' },
] as const;
const doors: MapExit[] = [];
for (const h of houses) {
  const house = { kind: 'house', x: h.x, y: h.y, w: 3, h: 2, roof: h.roof, lit: h.lit } as const;
  place(house);
  doors.push(h.inside ? doorInto(h.inside, 'stonebrook', house) : ontoStreet(house));
}
place({ kind: 'car', x: 13, y: 24, w: 2 });
for (const [x, y] of [[15, 23], [15, 27], [9, 27]] as const) place({ kind: 'barrel', x, y });
place({
  kind: 'npc', id: 'mira', name: 'Mira', x: 10, y: 24, dir: 'down',
  lines: [
    'Heading out? The woods pay better the farther you go.',
    'Bring home what you find and put it in the chest by your fire. That is how you get stronger.',
    'Watch your energy. If it runs out, you wake up at home, and what you carried lies where you fell.',
    'Only a fire brings your energy back. In the woods, somebody keeps the old cabin\'s going; the other shelters\' fires there burn down. Carry resin to feed them.',
    'The street lights won\'t warm you. But when a surge comes through the woods, stand in one.',
    'Found something strange out there? Bring it back to town and look at it in the light.',
    'The notice board by me says how things stand out there. Read it before you go.',
    'The south road goes down to NAPO\'s old grounds. Ruth keeps a fire in the bunker there; past it, you feed your own.',
  ],
});
const STONE = { x: 15, y: 8 };
place({ kind: 'stone', x: STONE.x, y: STONE.y });
const signs = [
  { x: 13, y: 37, text: ['Stonebrook. Pop. 23', 'Most people left after the lights started showing up in the woods.'] },
  { x: 28, y: 16, text: ['North: the Near Woods', 'Out there your energy drains, faster the deeper you go.', 'Only a fire brings it back. The old cabin\'s never goes out; feed the others.'] },
  { x: 17, y: 10, text: ['The Old Stone', 'It hums at night, and shards break off it. The stones deep in the woods pull them in.', 'Bring the shards back to it. When it has enough, it wakes, and the surges out there grow gentler.'] },
];
for (const s of signs) place({ kind: 'sign', ...s });
// The notice board, next to Mira: how things stand out there (the server writes it).
place({ kind: 'board', x: 12, y: 23 });
const lamps = [[10, 22], [16, 28], [18, 16]] as const;
for (const [x, y] of lamps) place({ kind: 'lamp', x, y });
for (const [x, y] of [[14, 16], [20, 16], [26, 16], [31, 13], [31, 7], [31, 1]] as const) place({ kind: 'pole', x, y });
for (let x = 4; x <= 19; x++) if (x < 10 || x > 13) place({ kind: 'fence', x, y: 35, dir: 'h' });
for (let y = 20; y <= 27; y++) place({ kind: 'fence', x: 19, y, dir: 'v' });
const shroomTile = new Set<string>();
for (const [x0, y0, x1, y1] of [[5, 21, 6, 22], [17, 21, 18, 22], [5, 32, 6, 33], [16, 24, 17, 25]] as const) rect(x0, y0, x1, y1, (x, y) => {
  if (tile[y]![x] === 'g' && !blocked[y]![x]) { place({ kind: 'shrooms', x, y }); shroomTile.add(`${x},${y}`); }
});

// Rocks around the Old Stone, then the forest, then scattered rocks.
const HOME = { x: 8.5, y: 21.5 };
const wolfHomes = [[23.5, 6.5], [25.5, 9.5], [35.5, 8.5], [36.5, 22.5]] as const;
const rockAt = new Set<string>();
for (const a of [3.5, 4.1, 4.7, 5.3, 5.9]) {
  const x = Math.floor(STONE.x + 0.5 + Math.cos(a) * 1.8), y = Math.floor(STONE.y + 0.5 + Math.sin(a) * 1.5);
  const s = 0.7 + rnd() * 0.3, v = rnd();
  if (rockAt.has(`${x},${y}`) || blocked[y]![x]) continue;
  rockAt.add(`${x},${y}`); place({ kind: 'rock', x, y, s: round(s), v: round(v) });
}
const nearType = (x: number, y: number, r: number, types: string) => {
  for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) if (types.includes(at(xx, yy)) && at(xx, yy) !== '') return true;
  return false;
};
const exitTile = (x: number, y: number) => (x >= 29 && x <= 30 && y <= 3) || (x >= 11 && x <= 12 && y >= 40);
const keepClear: Array<[number, number, number]> = [
  [HOME.x, HOME.y, 2.2], [10.5, 24.5, 1.8], [STONE.x + 0.5, STONE.y + 0.5, 2.6],
  ...wolfHomes.map(([x, y]) => [x, y, 1.5] as [number, number, number]),
  ...signs.map(s => [s.x + 0.5, s.y + 0.5, 1.6] as [number, number, number]),
  ...lamps.map(([x, y]) => [x + 0.5, y + 0.5, 1.2] as [number, number, number]),
];
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  if (blocked[y]![x] || tile[y]![x] !== 'g' || shroomTile.has(`${x},${y}`) || exitTile(x, y)) continue;
  const edge = Math.min(x, y, N - 1 - x, N - 1 - y), cx = x + 0.5, cy = y + 0.5;
  let p: number;
  if (level[y]![x]) p = 0.5;
  else if (edge <= 1) p = 1;
  else if (edge <= 3) p = 0.7;
  else if ((x === 3 || x === 4) && y >= 16 && y <= 37) p = 0.9;
  else if (x >= 4 && x <= 20 && y >= 15 && y <= 37) p = 0;
  else p = 0.14;
  if (edge > 1 && !level[y]![x] && nearType(x, y, 1, 'rlwmf')) p *= 0.08;
  for (const [kx, ky, kr] of keepClear) if (Math.hypot(cx - kx, cy - ky) < kr) p = 0;
  if (rnd() < p) place({ kind: 'tree', x, y, s: round(0.95 + rnd() * 0.45), v: round(rnd()) });
}
for (let tries = 0, n = 0; n < 8 && tries < 4000; tries++) {
  const x = 3 + Math.floor(rnd() * (N - 6)), y = 3 + Math.floor(rnd() * (N - 6));
  if (tile[y]![x] !== 'g' || blocked[y]![x] || level[y]![x] || shroomTile.has(`${x},${y}`) || nearType(x, y, 1, 'rl')) continue;
  if (x >= 4 && x <= 20 && y >= 15 && y <= 37) continue;
  if (keepClear.some(([kx, ky, kr]) => Math.hypot(x + 0.5 - kx, y + 0.5 - ky) < kr)) continue;
  place({ kind: 'rock', x, y, s: round(0.6 + rnd() * 0.4), v: round(rnd()) }); n++;
}
function round(v: number) { return Math.round(v * 1000) / 1000; }

// Grass walled in by the forest can be seen but never reached: plant trees there too. Last, and
// with a position hash instead of rnd(), so everything placed before stays exactly where it was.
{
  const SPAWN = { x: 8, y: 21 };
  const open = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && !blocked[y]![x] && tile[y]![x] !== 'w' && !level[y]![x];
  const seen = new Set([`${SPAWN.x},${SPAWN.y}`]);
  const queue: Array<[number, number]> = [[SPAWN.x, SPAWN.y]];
  for (let h = 0; h < queue.length; h++) {
    const [x, y] = queue[h]!;
    for (const [nx, ny] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]] as const) {
      if (open(nx, ny) && !seen.has(`${nx},${ny}`)) { seen.add(`${nx},${ny}`); queue.push([nx, ny]); }
    }
  }
  const hash = (x: number, y: number) => { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!open(x, y) || seen.has(`${x},${y}`) || shroomTile.has(`${x},${y}`)) continue;
    place({ kind: 'tree', x, y, s: round(0.95 + hash(x, y) * 0.45), v: round(hash(y, x)) });
  }
}

// The signpost for the South Road, on grass beside the south road. Placed last, so the trees drawn
// from rnd() above keep their places; it only needs its tile and the one in front free.
{
  const SOUTH = { x: 10, y: 38 };
  for (const [x, y] of [[SOUTH.x, SOUTH.y], [SOUTH.x, SOUTH.y + 1]] as const) {
    if (blocked[y]![x] || tile[y]![x] !== 'g') throw new Error(`the South Road's signpost needs open grass at ${x},${y}`);
  }
  place({ kind: 'sign', ...SOUTH, text: ['South: the South Road', 'NAPO\'s old grounds. Your energy drains out there too, faster the farther you go.', 'The bunker\'s fire never goes out; feed the others.'] });
}

// NAPO's evacuation notice, across the south road from the signpost: the way everyone left. Placed
// last too, on grass with room in front to read it.
{
  const NOTICE = { x: 15, y: 38 };
  for (const [x, y] of [[NOTICE.x, NOTICE.y], [NOTICE.x, NOTICE.y + 1]] as const) {
    if (blocked[y]![x] || tile[y]![x] !== 'g') throw new Error(`NAPO's notice needs open grass at ${x},${y}`);
  }
  place({
    kind: 'sign', ...NOTICE, style: 'napo',
    text: ['NAPO NOTICE', 'By order of the Observatory, Stonebrook lies inside the Napoland Zone. All residents leave by the south road.', 'Take only what you can carry. Back in two weeks.'],
  });
}

// ---- What the town left (roadmap/richer-places.md) ----
// Added after everything above, and without rnd(), so nothing placed before moves: the brook the town
// is named for, running out of the woods into the pond; the houses of four families who left, dark
// behind their curtains; the old sawmill by the brook, with its logs and its truck; and the verge by
// the south road where the town waited its turn to leave, with what would not fit in the cars. All of
// it stands on open grass, off the roads, the lot and the tiles in front of doors and of what you
// read, and nothing may cut anyone off from the rest of the town.
const leftBehind: MapObject[] = [];
{
  const SPAWN = { x: 8, y: 21 };
  /** Tiles that stay open: in front of every door and of everything you read or talk to. */
  const fronts = new Set<string>();
  for (const o of objects) {
    if (o.kind === 'house') fronts.add(`${o.x + Math.floor(o.w / 2)},${o.y + o.h}`);
    if (o.kind === 'sign' || o.kind === 'board' || o.kind === 'npc') fronts.add(`${o.x},${o.y + 1}`);
  }
  const walk = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && !blocked[y]![x] && tile[y]![x] !== 'w' && !level[y]![x];
  /** How many tiles someone could stand on can no longer be reached from the spawn. */
  const cutOff = () => {
    const seen = new Set([`${SPAWN.x},${SPAWN.y}`]), queue: Array<[number, number]> = [[SPAWN.x, SPAWN.y]];
    for (let h = 0; h < queue.length; h++) {
      const [x, y] = queue[h]!;
      for (const [nx, ny] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]] as const) {
        if (walk(nx, ny) && !seen.has(`${nx},${ny}`)) { seen.add(`${nx},${ny}`); queue.push([nx, ny]); }
      }
    }
    let cut = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (walk(x, y) && !seen.has(`${x},${y}`)) cut++;
    return cut;
  };
  /** Places a new thing on open grass, or stops: the layout needs a look. */
  const add = (o: MapObject) => {
    for (const [x, y] of objectTiles(o)) {
      if (tile[y]![x] !== 'g' || blocked[y]![x] || level[y]![x] || shroomTile.has(`${x},${y}`) || fronts.has(`${x},${y}`) || exitTile(x, y)) {
        throw new Error(`the ${o.kind} at ${o.x},${o.y} needs open grass at ${x},${y}`);
      }
    }
    place(o);
    leftBehind.push(o);
    if (o.kind === 'house') fronts.add(`${o.x + Math.floor(o.w / 2)},${o.y + o.h}`);
    if (o.kind === 'sign') fronts.add(`${o.x},${o.y + 1}`);
    const cut = cutOff();
    if (cut) throw new Error(`the ${o.kind} at ${o.x},${o.y} cuts ${cut} tiles off from the rest of the town`);
  };

  // The brook: out of the woods east of the pond and into it, just below where the mill stands. Its
  // banks are mud. Only open ground turns to water (the pond's own muddy rim among it).
  for (let x = 34; x <= 39; x++) {
    if (blocked[30]![x] || (tile[30]![x] !== 'g' && tile[30]![x] !== 'm')) throw new Error(`the brook needs open ground at ${x},30`);
    tile[30]![x] = 'w';
  }
  for (const [x, y] of [[34, 29], [35, 29], [36, 29], [37, 29], [38, 29], [37, 31], [38, 31], [39, 31]] as const) {
    if (tile[y]![x] === 'g' && !blocked[y]![x]) tile[y]![x] = 'm';
  }

  // The houses of four families who left, each with its room (gen-interiors.ts) and the family's name
  // on the mailbox by its door: two on the main street across from home (the Hales' under the street
  // light that still comes on), two on the old road to the mill. Their curtains are drawn and their
  // windows never light.
  const FAMILIES = [
    { x: 4, y: 14, box: [6, 16], roof: '#4f5b62', inside: 'stonebrook-okada-house', mailbox: ['OKADA, in neat black letters.', 'Empty. The mail stopped coming a long time ago.'] },
    { x: 18, y: 14, box: [21, 15], roof: '#6a4638', inside: 'stonebrook-hale-house', mailbox: ['THE HALES, in stick-on letters, one of them gone.'] },
    { x: 20, y: 26, box: [22, 28], roof: '#55603f', inside: 'stonebrook-dahl-house', mailbox: ['DAHL, painted in white.', 'The little flag is still up. Nobody came for the letter.'] },
    { x: 24, y: 26, box: [26, 28], roof: '#5d4a3b', inside: 'stonebrook-lindqvist-house', mailbox: ['LINDQVIST, in brass letters.', 'Stuffed with NAPO notices, all of them the same one.'] },
  ] as const;
  for (const f of FAMILIES) {
    const house = { kind: 'house', x: f.x, y: f.y, w: 3, h: 2, roof: f.roof, lit: 0, curtains: true } as const;
    add(house);
    doors.push(doorInto(f.inside, 'stonebrook', house));
    add({ kind: 'sign', x: f.box[0], y: f.box[1], style: 'mailbox', text: [...f.mailbox] });
  }

  // The old sawmill from the logging days, on the brook where it runs into the pond (the mill pond): a
  // long, low timber building you can walk into (gen-interiors.ts), the last logs stacked beside it,
  // the truck that brought them, and its sign where the old road ends.
  const mill = { kind: 'house', x: 33, y: 26, w: 6, h: 3, roof: '#7a4a2e', lit: 0, style: 'mill' } as const;
  add(mill);
  doors.push(doorInto('stonebrook-sawmill', 'stonebrook', mill));
  add({ kind: 'logs', x: 29, y: 26, w: 3, h: 1 });
  add({ kind: 'truck', x: 28, y: 28, w: 3, h: 1, dir: 'right' });
  add({ kind: 'sign', x: 31, y: 28, text: ['Stonebrook Timber Co.', 'Closed for the winter. Back to work in the spring.', 'Under it, in pencil: "Which spring?"'] });

  // The verge by the south road, beside NAPO's notice: where the town waited its turn to leave, and left
  // what would not fit in the cars. A cardboard sign propped against the piano asks that it all be left alone.
  add({ kind: 'luggage', x: 13, y: 36 });
  add({ kind: 'boxes', x: 14, y: 36 });
  add({ kind: 'piano', x: 16, y: 36 });
  add({ kind: 'sign', x: 16, y: 37, style: 'cardboard', text: ['In marker, on a flap of cardboard propped against the piano:', '"PLEASE LEAVE THESE. WE ARE COMING BACK FOR THEM."', 'The rain has run the ink.'] });
  add({ kind: 'rocker', x: 19, y: 36 });
  add({ kind: 'bike', x: 19, y: 37 });
  add({ kind: 'birdcage', x: 20, y: 37 });
  add({ kind: 'luggage', x: 21, y: 36 });
  add({ kind: 'luggage', x: 10, y: 36 });
  add({ kind: 'boxes', x: 9, y: 36 });
}

const map: MapData = {
  id: 'stonebrook', name: 'Stonebrook', version: 11, kind: 'town', depth: 0, width: N, height: N,
  tiles: tile.map(r => r.join('')),
  levels: level.map(r => r.join('')),
  spawn: { x: 8, y: 21, dir: 'down' },
  // The north road leads into the Near Woods (its road enters at x 31-32 on the bottom row), the south
  // road down the South Road (its road enters at x 35-36 on the top row).
  exits: [
    { x: 29, y: 0, w: 2, h: 1, to: 'near-woods', tx: 31, ty: 78, dir: 'up' },
    { x: 11, y: 43, w: 2, h: 1, to: 'south-road', tx: 35, ty: 1, dir: 'down' },
    ...doors,
  ],
  objects,
  // What the town calls these spots, for its paper map (Home, the lodge, the houses and the roads out
  // are named by their doors and exits). The newer names come after, so the paper map writes the older
  // ones where it always did.
  places: [
    { name: 'the Old Stone', x: STONE.x, y: STONE.y },
    { name: 'the notice board', x: 12, y: 23 },
    { name: 'the pond', x: Math.floor(POND.x), y: Math.floor(POND.y) },
    { name: 'the sawmill', x: 36, y: 27 },
    { name: 'the verge', x: 17, y: 37 },
  ],
};

// One row or object per line, so map changes show up as small, readable diffs.
const json = [
  '{',
  `  "id": ${JSON.stringify(map.id)},`, `  "name": ${JSON.stringify(map.name)},`, `  "version": ${map.version},`,
  `  "kind": ${JSON.stringify(map.kind)},`, `  "depth": ${map.depth},`,
  `  "width": ${map.width},`, `  "height": ${map.height},`,
  '  "tiles": [', map.tiles.map(r => `    ${JSON.stringify(r)}`).join(',\n'), '  ],',
  '  "levels": [', map.levels.map(r => `    ${JSON.stringify(r)}`).join(',\n'), '  ],',
  `  "spawn": ${JSON.stringify(map.spawn)},`,
  '  "exits": [', map.exits.map(e => `    ${JSON.stringify(e)}`).join(',\n'), '  ],',
  '  "objects": [', map.objects.map(o => `    ${JSON.stringify(o)}`).join(',\n'), '  ],',
  '  "places": [', map.places!.map(p => `    ${JSON.stringify(p)}`).join(',\n'), '  ]',
  '}',
  '',
].join('\n');
const out = resolve(import.meta.dirname, '../content/maps/stonebrook.json');
writeFileSync(out, json);
const count = (k: string) => objects.filter(o => o.kind === k).length;
console.log(`wrote ${out}: ${N}x${N} tiles, ${objects.length} objects (${count('tree')} trees, ${count('rock')} rocks, ${count('house')} houses)`);
console.log(`left behind: ${leftBehind.map(o => `${o.kind === 'sign' && o.style ? o.style : o.kind} ${o.x},${o.y}`).join(', ')}`);
