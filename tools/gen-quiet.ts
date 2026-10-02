/**
 * Generates content/maps/quiet.json, the Quiet (docs/DESIGN.md, World structure): the region at depth 5, above
 * the Ridge's crest, up the trappers' last rope, which holds only with four on it (gen-ridge.ts,
 * tools/quiet-rope.ts). The deepest place yet, toward the stones that hum back. Laid out by hand; the few random
 * choices hash the tile position, so it never reshuffles. Run it after gen:ridge. Usage: npm run gen:quiet
 *
 * A bare plateau of old snow inside walls of rock, still and windless: it never snows up here, and words do not
 * carry (MapData.hush). At its heart a ring of standing stones on bare rock, the Old Stone's kin, each with
 * something pecked into it, and on its far side a gap where one stood: a socket in the rock the Old Stone's shape.
 * Round the ring, tall pale figures stand and never move, every one of them facing the gap; the way in from the
 * rope is the one side they leave open. No shelter, no fire: the climb down is the way back.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STEP_MS, TileMap, energyRate, maxEnergy, objectTiles, validateMap, type MapData, type MapObject } from '../packages/shared/src';
import { QUIET_ROPE_WIDTH, QUIET_WAY_HOME, RIDGE_ROPE } from './quiet-rope';

const W = 36, H = 34, SEED = 20261003;
type P = readonly [number, number];
if (QUIET_WAY_HOME.y !== H - 1) throw new Error('the Quiet\'s way home is not on its bottom row');

function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(salt + SEED, 0x61c88647);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
const round = (v: number) => Math.round(v * 1000) / 1000;

// Walls of bare rock all round, raised: nobody walks them. The plateau is cut out of them.
const tile: string[][] = Array.from({ length: H }, () => Array<string>(W).fill('l'));
const level: number[][] = Array.from({ length: H }, () => Array<number>(W).fill(2));
const inner = (x: number, y: number) => x >= 1 && y >= 1 && x < W - 1 && y < H - 1;
function ground(x: number, y: number, c: string) { tile[y]![x] = c; level[y]![x] = 0; }

/** The plateau: old snow, frayed at its edge against the rock. */
const PLATEAU = { x: 18, y: 16.5, rx: 15.5, ry: 14 } as const;
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  const e = ((x + 0.5 - PLATEAU.x) / PLATEAU.rx) ** 2 + ((y + 0.5 - PLATEAU.y) / PLATEAU.ry) ** 2;
  if (e <= 1 + (hash(x, y, 1) - 0.5) * 0.25) ground(x, y, 'g');
}
// The way down: the rope's head on the bottom row, and the snow up to it.
for (let x = QUIET_WAY_HOME.x; x < QUIET_WAY_HOME.x + QUIET_ROPE_WIDTH; x++) for (let y = H - 4; y < H; y++) ground(x, y, 'g');

/** The ring, on rock the snow never settles on. */
const RING = { x: 18, y: 13, rx: 5.2, ry: 4.6 } as const;
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  if (((x + 0.5 - RING.x) / (RING.rx + 1.2)) ** 2 + ((y + 0.5 - RING.y) / (RING.ry + 1.2)) ** 2 <= 1) ground(x, y, 'l');
}

// ---- Things ----

const objects: MapObject[] = [];
const blocked = new Set<string>();
function place(o: MapObject) {
  for (const [x, y] of objectTiles(o)) {
    if (!inner(x, y) || level[y]![x] !== 0 || blocked.has(`${x},${y}`)) throw new Error(`${o.kind} at ${x},${y} has no open ground`);
    blocked.add(`${x},${y}`);
  }
  objects.push(o);
}

/** What is pecked into each stone, from the gap round: the first is the gap itself. */
const STONES: string[][] = [
  [
    'Where a stone stood: a socket in the rock, its edges sharp, no frost in it and no snow.',
    'It is the Old Stone\'s shape, to a hand\'s breadth. Down one side of it runs a crack.',
  ],
  ['Pecked into it, worn almost smooth: a ring of little stones, inside a ring of trees.'],
  ['Pecked into it: a stone standing in water, and the water drawn as lines that come and go.'],
  ['Pecked into it: a stone by a stream, and little square houses round it.'],
  ['Pecked into it, as worn as the rest: something tall and thin with a round top, and lines going out of the top, all one way.'],
  ['Pecked into it: four small people on a line, one above the other.'],
  ['Pecked into it: a row of crosses, one of them leaning.'],
  ['Pecked into it: the same small circle three times, one under the other, and an arrow turning back.'],
  ['Pecked into it: two of the same tree, facing each other.'],
  ['Pecked into it: tall thin shapes standing round a ring, every one turned the same way.'],
  ['Worn smooth. Whatever was on it, the wind took long ago.'],
  ['Pecked into it, and fresh, the stone dust still in the cuts: a hand laid flat on a stone.'],
];
/** Each stone's tile, round the ring from the gap at the top. */
const ringAt = (k: number): P => {
  const a = -Math.PI / 2 + (k / STONES.length) * Math.PI * 2;
  return [Math.round(RING.x + Math.cos(a) * RING.rx - 0.5), Math.round(RING.y + Math.sin(a) * RING.ry - 0.5)];
};
STONES.forEach((text, k) => {
  const [x, y] = ringAt(k);
  place({ kind: 'standing', x, y, text, ...(k === 0 ? { gap: true as const } : {}) });
});
const GAP = ringAt(0);

// The figures, round the ring, all facing the gap, but for the way in from the rope.
const FIGURES = 16;
for (let k = 0; k < FIGURES; k++) {
  const a = -Math.PI / 2 + ((k + 0.5) / FIGURES) * Math.PI * 2;
  if (Math.abs(a - Math.PI / 2) < 0.5) continue;
  const x = Math.round(RING.x + Math.cos(a) * 10 - 0.5), y = Math.round(RING.y + Math.sin(a) * 9.2 - 0.5);
  if (inner(x, y) && level[y]![x] === 0 && !blocked.has(`${x},${y}`)) place({ kind: 'figure', x, y });
}
// Boulders the ice brought down, out in the snow.
for (let y = 2; y < H - 5; y++) for (let x = 2; x < W - 2; x++) {
  if (tile[y]![x] !== 'g' || level[y]![x] !== 0 || blocked.has(`${x},${y}`)) continue;
  if (hash(x, y, 4) < 0.03) place({ kind: 'rock', x, y, s: round(0.8 + hash(x, y, 5) * 0.6), v: round(hash(x, y, 6)) });
}

const map: MapData = {
  id: 'quiet', name: 'The Quiet', version: 1, kind: 'wilds', depth: 5, width: W, height: H,
  tiles: tile.map(r => r.join('')), levels: level.map(r => r.join('')),
  spawn: { x: QUIET_WAY_HOME.x + 1, y: QUIET_WAY_HOME.y - 1, dir: 'up' },
  exits: [{ x: QUIET_WAY_HOME.x, y: QUIET_WAY_HOME.y, w: QUIET_ROPE_WIDTH, h: 1, to: 'ridge', tx: RIDGE_ROPE.x, ty: RIDGE_ROPE.y + 1, dir: 'down', home: true }],
  objects,
  // Always winter, and still: it never snows up here.
  rain: [],
  places: [{ name: 'the ring', x: RING.x, y: RING.y }, { name: 'the gap', x: GAP[0], y: GAP[1] - 1 }],
  forest: 'snow',
  hush: true,
};

// ---- Output ----

const KEYS = ['id', 'name', 'version', 'kind', 'depth', 'width', 'height', 'forest', 'tiles', 'levels', 'spawn', 'exits', 'objects', 'rain', 'places', 'hush'] as const;
const json = `{\n${KEYS.filter(k => map[k] !== undefined).map(k => {
  const v = map[k];
  return Array.isArray(v) && ['tiles', 'levels', 'exits', 'objects', 'places'].includes(k)
    ? `  "${k}": [\n${(v as unknown[]).map(e => `    ${JSON.stringify(e)}`).join(',\n')}\n  ]`
    : `  "${k}": ${JSON.stringify(v)}`;
}).join(',\n')}\n}\n`;
const problems = validateMap(map);
for (const p of problems) console.log(`${p.level}: ${p.message}`);
if (problems.some(p => p.level === 'error')) process.exit(1);
const out = resolve(import.meta.dirname, '../content/maps/quiet.json');
writeFileSync(out, json);

const tm = new TileMap(map);
let deepest = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) deepest = Math.max(deepest, tm.homeSteps(x, y));
const gapFront = Math.min(...[[0, -1], [-1, 0], [1, 0], [0, 1]].map(([dx, dy]) => tm.homeSteps(GAP[0] + dx!, GAP[1] + dy!)).filter(s => s >= 0));
const lasts = (x: number, y: number, lvl: number, w: 'overcast' | 'night' = 'overcast') => (maxEnergy(lvl) / -energyRate(tm, x, y, w)).toFixed(0);
console.log(`wrote ${out}: ${W}x${H}, ${objects.length} objects (${objects.filter(o => o.kind === 'figure').length} figures); the gap ${gapFront} steps up, the deepest ${deepest} (${(deepest * STEP_MS / 1000).toFixed(0)} s walking)`);
console.log(`a full bar by the gap lasts ${lasts(GAP[0], GAP[1] - 1, 10)} s at level 10, ${lasts(GAP[0], GAP[1] - 1, 20)} s at level 20 by day (${lasts(GAP[0], GAP[1] - 1, 20, 'night')} s at night)`);
