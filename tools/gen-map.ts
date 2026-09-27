/**
 * Generates content/maps/stonebrook.json, the starting town, from a fixed seed.
 * This script is the source of the map: change it, not the JSON (CI regenerates the JSON and
 * fails if it differs, so hand edits would be caught). Usage: npm run gen:map, or npm run gen for all.
 * Every house's door leads inside; the rooms are drawn in gen-interiors.ts.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MapData, MapExit, MapObject } from '../packages/shared/src';
import { doorInto } from './gen-interiors';

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
  const w = o.kind === 'house' || o.kind === 'car' ? o.w : 1, h = o.kind === 'house' ? o.h : 1;
  if (o.kind !== 'shrooms') for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) block(o.x + dx, o.y + dy);
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

// Town. Every house can be entered: home (the spawn is at its door), the empty house next door, and
// the lodge, where the town sits by the fire.
const houses = [
  { x: 7, y: 19, roof: '#6b7075', lit: 1, inside: 'stonebrook-home' },
  { x: 14, y: 19, roof: '#7a4b33', lit: 0, inside: 'stonebrook-empty-house' },
  { x: 7, y: 30, roof: '#4a5a44', lit: 1, inside: 'stonebrook-lodge' },
] as const;
const doors: MapExit[] = [];
for (const h of houses) {
  const house = { kind: 'house', x: h.x, y: h.y, w: 3, h: 2, roof: h.roof, lit: h.lit } as const;
  place(house);
  doors.push(doorInto(h.inside, 'stonebrook', house));
}
place({ kind: 'car', x: 13, y: 24, w: 2 });
for (const [x, y] of [[15, 23], [15, 27], [9, 27]] as const) place({ kind: 'barrel', x, y });
place({
  kind: 'npc', id: 'mira', name: 'Mira', x: 10, y: 24, dir: 'down',
  lines: [
    'Heading out? The woods pay better the farther you go.',
    'Bring home what you find and put it in the chest by your fire. That is how you get stronger.',
    'Watch your energy. If it runs out, you wake up at home and your backpack stays where you fell.',
    'Only a fire brings your energy back. Somebody keeps the old cabin\'s going; the other shelters\' fires burn down. Carry resin to feed them.',
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

const map: MapData = {
  id: 'stonebrook', name: 'Stonebrook', version: 7, kind: 'town', depth: 0, width: N, height: N,
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
  '  "objects": [', map.objects.map(o => `    ${JSON.stringify(o)}`).join(',\n'), '  ]',
  '}',
  '',
].join('\n');
const out = resolve(import.meta.dirname, '../content/maps/stonebrook.json');
writeFileSync(out, json);
const count = (k: string) => objects.filter(o => o.kind === k).length;
console.log(`wrote ${out}: ${N}x${N} tiles, ${objects.length} objects (${count('tree')} trees, ${count('rock')} rocks, ${count('house')} houses)`);
