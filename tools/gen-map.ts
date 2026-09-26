/**
 * Generates content/maps/stonebrook.json, the starting town, from a fixed seed.
 * The output is the canonical map: after generating it once, hand edits to the JSON are fine,
 * but re-running this script overwrites them. Usage: npm run gen:map
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MapData, MapObject } from '../packages/shared/src';

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

// Town.
const houses = [{ x: 7, y: 19, roof: '#6b7075', lit: 1 }, { x: 14, y: 19, roof: '#7a4b33', lit: 0 }, { x: 7, y: 30, roof: '#4a5a44', lit: 1 }] as const;
for (const h of houses) place({ kind: 'house', x: h.x, y: h.y, w: 3, h: 2, roof: h.roof, lit: h.lit });
place({ kind: 'car', x: 13, y: 24, w: 2 });
for (const [x, y] of [[15, 23], [15, 27], [9, 27]] as const) place({ kind: 'barrel', x, y });
place({
  kind: 'npc', id: 'mira', name: 'Mira', x: 10, y: 24, dir: 'down',
  lines: ['Heading out? The woods pay better the farther you go.', 'Watch your energy. If it runs out, you wake up at home and your backpack stays where you fell.', 'Street lights are safe spots. The wolves hate the light.'],
});
const STONE = { x: 15, y: 8 };
place({ kind: 'stone', x: STONE.x, y: STONE.y });
const signs = [
  { x: 13, y: 37, text: ['Stonebrook. Pop. 23', 'Most people left after the lights started showing up in the woods.'] },
  { x: 28, y: 16, text: ['North: Wolf Meadow', 'If the wolves see you, keep moving. They hate the street lights.'] },
  { x: 17, y: 10, text: ['The Old Stone', 'It hums at night, and shards break off it. Do not touch.'] },
];
for (const s of signs) place({ kind: 'sign', ...s });
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

const map: MapData = {
  id: 'stonebrook', name: 'Stonebrook', version: 1, width: N, height: N,
  tiles: tile.map(r => r.join('')),
  levels: level.map(r => r.join('')),
  spawn: { x: 8, y: 21, dir: 'down' },
  objects,
};

// One row or object per line, so map changes show up as small, readable diffs.
const json = [
  '{',
  `  "id": ${JSON.stringify(map.id)},`, `  "name": ${JSON.stringify(map.name)},`, `  "version": ${map.version},`,
  `  "width": ${map.width},`, `  "height": ${map.height},`,
  '  "tiles": [', map.tiles.map(r => `    ${JSON.stringify(r)}`).join(',\n'), '  ],',
  '  "levels": [', map.levels.map(r => `    ${JSON.stringify(r)}`).join(',\n'), '  ],',
  `  "spawn": ${JSON.stringify(map.spawn)},`,
  '  "objects": [', map.objects.map(o => `    ${JSON.stringify(o)}`).join(',\n'), '  ]',
  '}',
  '',
].join('\n');
const out = resolve(import.meta.dirname, '../content/maps/stonebrook.json');
writeFileSync(out, json);
const count = (k: string) => objects.filter(o => o.kind === k).length;
console.log(`wrote ${out}: ${N}x${N} tiles, ${objects.length} objects (${count('tree')} trees, ${count('rock')} rocks, ${count('house')} houses)`);
