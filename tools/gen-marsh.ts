/**
 * Generates content/maps/marsh.json, the Marsh: a region at depth 3 east of the Far Woods, along the loggers'
 * corduroy road out of their old camp (docs/DESIGN.md, World structure). No gate: one player can go, which
 * makes it the step between the Far Woods and the Burn. Built from a fixed seed like the Burn (gen-burn.ts,
 * whose helpers these are), and every random choice hashes the tile position, so the Marsh never reshuffles.
 * Re-running it overwrites hand edits to the JSON. Run it after gen:far-woods (it checks its clock against
 * the Far Woods' and the Near Woods') and before gen:interiors. Usage: npm run gen:marsh
 *
 * West to east: the corduroy road comes in over the bog to the peat cutters' hut, the one shelter (its fire
 * burns down); past it the reeds, the first channel, the peat cuttings, the second channel, and the black
 * pool, the heart, where the stones in the reeds hum back. Each channel runs a long way round its end, and
 * across each stands a boardwalk the whole server mends together (works.ts): broken, you go round.
 *
 * It is marsh (`forest: 'marsh'`), drawn so by the client: drowned trees standing grey in the water, and the
 * mist never lifts (you see a few tiles less), and lights drift over the water that lead nowhere. You tire
 * three times as fast here as at the same distance into the Near Woods (energy.ts, the depth).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DECOR, ENERGY_MAX, TileMap, doorOf, energyRate, maxEnergy, objectTiles, stormAt, surgeAt, validateMap, type MapData, type MapExit, type MapObject, type SurgeRule,
} from '../packages/shared/src';
import { doorInto } from './gen-interiors';
import { FAR_WOODS_ROAD, MARSH_WAY_HOME } from './marsh-road';

const W = 54, H = 40, SEED = 20261018;
type P = readonly [number, number];
/** The way home, on the west edge: back along the corduroy road into the Far Woods. */
const EXIT: MapExit = { x: MARSH_WAY_HOME.x, y: MARSH_WAY_HOME.y, w: 1, h: 1, to: 'far-woods', tx: FAR_WOODS_ROAD.x - 1, ty: FAR_WOODS_ROAD.y, dir: 'left', home: true };

// Every random choice hashes the tile position (with the seed), as in gen-burn.ts.
function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(salt + SEED, 0x61c88647);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
/** Smooth value noise in [0, 1), changing over about `scale` tiles. */
function noise(x: number, y: number, scale: number, salt: number): number {
  const fx = x / scale, fy = y / scale, ix = Math.floor(fx), iy = Math.floor(fy);
  const u = fx - ix, v = fy - iy, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = hash(ix, iy, salt), b = hash(ix + 1, iy, salt), c = hash(ix, iy + 1, salt), d = hash(ix + 1, iy + 1, salt);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}
const round = (v: number) => Math.round(v * 1000) / 1000;
const SIDES: readonly P[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

const tile: string[][] = Array.from({ length: H }, () => Array<string>(W).fill('t'));
const level: number[][] = Array.from({ length: H }, () => Array<number>(W).fill(0));
const inner = (x: number, y: number) => x >= 1 && y >= 1 && x < W - 1 && y < H - 1;
const at = (x: number, y: number) => (inner(x, y) ? tile[y]![x]! : 't');
/** Cuts ground out of the drowned woods. The map edge stays forest: the way home is the only way out. */
function set(x: number, y: number, c: string) { if (inner(x, y)) tile[y]![x] = c; }
/** Calls fn on the tiles of a rough ellipse; `rough` frays the edge so clearings do not look drawn. */
function ellipse(cx: number, cy: number, rx: number, ry: number, rough: number, salt: number, fn: (x: number, y: number, e: number) => void) {
  for (let y = Math.floor(cy - ry * 1.4); y <= Math.ceil(cy + ry * 1.4); y++) for (let x = Math.floor(cx - rx * 1.4); x <= Math.ceil(cx + rx * 1.4); x++) {
    const e = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
    if (inner(x, y) && e <= 1 + (noise(x, y, 2.5, salt) - 0.5) * 2 * rough) fn(x, y, e);
  }
}
/** Open bog: grass, and mud where it is wetter. */
const bog = (cx: number, cy: number, rx: number, ry: number, salt: number) => ellipse(cx, cy, rx, ry, 0.35, salt, (x, y) => { if (at(x, y) === 't') set(x, y, noise(x, y, 2.2, salt + 1) < 0.35 ? 'm' : 'g'); });

/** Tiles from a to b in four-direction steps, hugging the straight line, so a trail never breaks. */
function line4(a: P, b: P): P[] {
  const out: P[] = [a];
  const [bx, by] = b, lx = bx - a[0], ly = by - a[1], len = Math.hypot(lx, ly) || 1;
  const off = (px: number, py: number) => Math.abs((px - a[0]) * ly - (py - a[1]) * lx) / len;
  let [x, y] = a;
  while (x !== bx || y !== by) {
    const sx = Math.sign(bx - x), sy = Math.sign(by - y);
    if (sy === 0 || (sx !== 0 && off(x + sx, y) <= off(x, y + sy))) x += sx; else y += sy;
    out.push([x, y]);
  }
  return out;
}
const polyline = (pts: P[]) => pts.slice(1).flatMap((p, i) => line4(pts[i]!, p));

// The ways: water never cuts them, and the reeds keep off them.
const way = new Uint8Array(W * H);
/** A trail of trodden mud through the waypoints, one tile wide. */
function trail(pts: P[]) {
  for (const [x, y] of polyline([...pts])) {
    if (!inner(x, y) || at(x, y) === 'w') continue;
    set(x, y, 'm');
    way[y * W + x] = 1;
  }
}
function water(x: number, y: number) { if (inner(x, y) && !way[y * W + x]) tile[y]![x] = 'w'; }

// ---- The ground ----

// The corduroy road comes in from the west over the bog: logs laid side by side, grassed over, sinking.
const ENTRY: P = [MARSH_WAY_HOME.x + 1, MARSH_WAY_HOME.y];
tile[EXIT.y]![EXIT.x] = 'm';
trail([ENTRY, [6, 20], [10, 19], [13, 20]]);
// The peat cutters' hut in its clearing, north of the road.
const HUT = { x: 11, y: 15 } as const;
bog(13, 18.5, 4.6, 3, 11);

// The first channel, north to south down the west of the marsh, its head short of the north edge: the long way
// goes round its head, the boardwalk straight across.
const CH1 = { x: 20, top: 11, bottom: H - 2 } as const;
// The second channel, down from the north edge, its foot short of the south: round its foot, or across.
const CH2 = { x: 34, top: 1, bottom: 27 } as const;
// The bog between and around: open ground to walk.
bog(27, 19, 6, 12, 12);
bog(20.5, 8.5, 5, 3, 13);
bog(35.5, 30.5, 6, 3, 14);
bog(15.5, 26, 3.4, 5, 15);
// The black pool, the heart: dark water in a ring of reeds and stones that hum back.
const POOL = { x: 46.5, y: 19.5 } as const;
bog(POOL.x, POOL.y, 6.5, 7.5, 16);
// The peat cuttings: long banks where the town cut peat, before, between the channels.
const CUTTINGS = { x: 27.5, y: 26.5 } as const;
bog(CUTTINGS.x, CUTTINGS.y, 4, 2.6, 17);

// The ways: from the hut round the first channel's head, down the bog to the cuttings, round the second
// channel's foot and up to the pool; and the short ways straight across where the boardwalks stand.
trail([[13, 20], [16, 18], [17, 14], [18, 9], [23, 9], [24, 14], [26, 20], [27, 24], [29, 28], [33, 30], [37, 30], [40, 26], [42, 23], [44, 21]]);
trail([[16, 20], [CH1.x - 1, 20]]);
trail([[CH1.x + 2, 20], [26, 19], [CH2.x - 1, 19]]);
trail([[CH2.x + 2, 19], [40, 20], [43, 20]]);

// Water: the channels (two tiles wide), and the black pool.
for (let y = CH1.top; y <= CH1.bottom; y++) for (let x = CH1.x; x < CH1.x + 2; x++) water(x, y);
for (let y = CH2.top; y <= CH2.bottom; y++) for (let x = CH2.x; x < CH2.x + 2; x++) water(x, y);
ellipse(POOL.x + 1, POOL.y - 1, 2.6, 2.2, 0.2, 40, water);
// Pools off the ways, and the flooded peat cuttings.
ellipse(23.5, 30.5, 1.6, 1.1, 0.3, 41, water);
ellipse(30.5, 23.5, 1.4, 1, 0.3, 42, water);
ellipse(41.5, 11.5, 2, 1.4, 0.3, 43, water);
ellipse(9.5, 25.5, 1.6, 1.2, 0.3, 44, water);
// Banks: mud where the water meets the ground.
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  if (at(x, y) !== 'g') continue;
  if (SIDES.some(([dx, dy]) => at(x + dx, y + dy) === 'w')) set(x, y, 'm');
}

// Reeds, tall and thick by the water, where the skulkers lie (ferns): along the channels and round the pool.
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  const i = y * W + x;
  if (way[i] || (at(x, y) !== 'g' && at(x, y) !== 'm')) continue;
  const byWater = SIDES.some(([dx, dy]) => at(x + dx, y + dy) === 'w') || [[1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dx, dy]) => at(x + dx, y + dy) === 'w');
  if (byWater && hash(x, y, 50) < 0.42) set(x, y, 'f');
}

// ---- Things ----

const objects: MapObject[] = [];
const blocked = new Uint8Array(W * H);
/** Adds an object. Things stand on cleared ground: a forest or water tile under one becomes grass. What is only drawn blocks nothing. */
function place(o: MapObject) {
  for (const [x, y] of objectTiles(o)) {
    if (!inner(x, y)) throw new Error(`${o.kind} at ${o.x},${o.y} is on the map edge`);
    if (DECOR.has(o.kind)) continue;
    if (blocked[y * W + x]) throw new Error(`${o.kind} at ${o.x},${o.y} overlaps something on ${x},${y}`);
    blocked[y * W + x] = 1;
    if (at(x, y) === 't' || at(x, y) === 'w') set(x, y, 'g');
  }
  objects.push(o);
}
const walkable = (x: number, y: number) => inner(x, y) && !blocked[y * W + x] && level[y]![x] === 0 && at(x, y) !== 't' && at(x, y) !== 'w';

/** Walking steps from the way home to every tile (-1: no way there). The boardwalks count only if `bridges`. */
const bridged = new Set<number>();
function stepsHome(bridges = false): Int32Array {
  const d = new Int32Array(W * H).fill(-1);
  const queue: number[] = [ENTRY[1] * W + ENTRY[0]];
  d[queue[0]!] = 1;
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h]!, x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of SIDES) {
      const nx = x + dx, ny = y + dy, j = ny * W + nx;
      if (!(walkable(nx, ny) || (bridges && bridged.has(j))) || d[j]! >= 0) continue;
      d[j] = d[i]! + 1;
      queue.push(j);
    }
  }
  return d;
}
const reached = (d: Int32Array) => d.reduce((n, v) => n + (v >= 0 ? 1 : 0), 0);
/** Places an object unless it would cut somebody off: every tile it does not cover must stay reachable. */
function tryPlace(o: MapObject): boolean {
  const tiles = objectTiles(o);
  if (tiles.some(([x, y]) => !inner(x, y) || blocked[y * W + x])) return false;
  const d = stepsHome();
  const covered = tiles.filter(([x, y]) => d[y * W + x]! >= 0).length;
  if (covered) {
    const before = reached(d);
    for (const [x, y] of tiles) blocked[y * W + x] = 1;
    const cut = reached(stepsHome()) !== before - covered;
    for (const [x, y] of tiles) blocked[y * W + x] = 0;
    if (cut) return false;
  }
  place(o);
  return true;
}
/** Places a hand-placed thing, or stops: it would cut somebody off, so the layout needs a look. */
function must(o: MapObject) { if (!tryPlace(o)) throw new Error(`the ${o.kind} at ${o.x},${o.y} would block the way`); }

// The boardwalks across the channels and onto the pool's shore, mended by everyone (content/items.json, works):
// broken, the water is water and you go round.
const BOARDWALKS: Array<Extract<MapObject, { kind: 'footbridge' }>> = [
  { kind: 'footbridge', id: 'marsh-boardwalk-west', x: CH1.x, y: 20, w: 2, h: 1 },
  { kind: 'footbridge', id: 'marsh-boardwalk-east', x: CH2.x, y: 19, w: 2, h: 1 },
];
for (const b of BOARDWALKS) { place(b); for (const [x, y] of objectTiles(b)) bridged.add(y * W + x); }

// The peat cutters' hut, the one shelter: its fire burns down (gen-interiors.ts), so whoever passes feeds it.
const hut = { kind: 'house', x: HUT.x, y: HUT.y, w: 3, h: 2, roof: '#4a4a3c', lit: 1 } as const;
must(hut);
// The peat they stacked to dry, and never carried home, beside the hut: wherever it cuts nobody off.
[HUT.x + 3, HUT.x - 1, HUT.x + 4].some(x => tryPlace({ kind: 'woodpile', x, y: HUT.y + 1 }));
const doors = [doorInto('marsh-cutters-hut', 'marsh', hut)];
const front = ((d): P => [d.x, d.y + 1])(doorOf(hut));

/** A sign beside the way near `p`: the nearest open ground off the ways with room in front of it to read it from, and cutting nobody off. */
const signs: Array<{ x: number; y: number }> = [];
function signNear(p: P, text: string[]) {
  const spots: Array<[number, number, number]> = [];
  for (let y = p[1] - 3; y <= p[1] + 3; y++) for (let x = p[0] - 3; x <= p[0] + 3; x++) {
    if (walkable(x, y) && !way[y * W + x] && walkable(x, y + 1) && at(x, y) !== 'f' && !signs.some(s => Math.abs(s.x - x) + Math.abs(s.y - y) < 2)) spots.push([Math.hypot(x - p[0], y - p[1]), x, y]);
  }
  spots.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const spot = spots.find(([, x, y]) => tryPlace({ kind: 'sign', x, y, text }));
  if (!spot) throw new Error(`no room for a sign near ${p.join(',')}`);
  signs.push({ x: spot[1], y: spot[2] });
}
signNear([6, 18], ['A board nailed to a drowned post: "Stonebrook peat. Cutters\' hut east."', 'Under it, in another hand: "Keep to the road. The lights are not lanterns."']);
signNear([17, 22], ['A tin plate on a post at the water\'s edge: "Channel boards. Mend them, or go round by the head."']);
signNear([22, 8], ['Cut into a post at the channel\'s head: "Round by here, or wait for the boards."']);
signNear([28, 29], ['A peat spade driven into the bank, a tag on its handle: "Cut in May, dried by August. Burns all night."']);
signNear([36, 31], ['Cut into a post at the channel\'s foot: "Round by here. The pool is north."']);
signNear([43, 23], ['A board on a stake in the reeds: "The black pool. Nobody fishes it."', '"The stones hum back when the lights are out on the water. Go home before they come to you."']);

// The stones in the reeds: round the black pool, faintly aglow, humming back to the Old Stone.
for (let k = 0; k < 8; k++) {
  const a = (k / 8) * Math.PI * 2 + 0.3, x = Math.round(POOL.x + 1 + Math.cos(a) * 4.2), y = Math.round(POOL.y - 1 + Math.sin(a) * 3.6);
  if (walkable(x, y) && !way[y * W + x]) tryPlace({ kind: 'rock', x, y, s: round(0.8 + hash(x, y, 71) * 0.4), v: round(hash(x, y, 72)), hum: true });
}

// Drowned trees standing alone in the bog, grey and bare (the client draws a marsh's trees so), and stumps:
// never in front of a sign or a door, or next to another thing, so the spots people gather at stay open.
const keepOpen = new Set<number>([front[1] * W + front[0]]);
for (const s of signs) keepOpen.add((s.y + 1) * W + s.x);
function open(x: number, y: number): boolean {
  if (!walkable(x, y) || way[y * W + x] || keepOpen.has(y * W + x) || at(x, y) === 'f') return false;
  for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (blocked[yy * W + xx]) return false;
  return true;
}
for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
  if (!open(x, y)) continue;
  const edge = SIDES.some(([dx, dy]) => at(x + dx, y + dy) === 't');
  if (!edge && hash(x, y, 90) < 0.05) tryPlace({ kind: 'tree', x, y, s: round(0.9 + hash(x, y, 91) * 0.4), v: round(hash(x, y, 92)) });
  else if (hash(x, y, 93) < 0.04) tryPlace({ kind: 'stump', x, y, s: round(0.8 + hash(x, y, 94) * 0.4), v: round(hash(x, y, 95)) });
}

// The places worth walking to. Each must be reachable, or the clean-up below would quietly turn it back into forest.
const PLACES: Array<[string, P]> = [
  ['the corduroy road', [6, 20]], ['the cutters\' hut', front], ['the channel\'s head', [22, 9]], ['the peat cuttings', [Math.floor(CUTTINGS.x), Math.floor(CUTTINGS.y)]],
  ['the channel\'s foot', [36, 30]], ['the black pool', [43, 21]],
];
const stepsTo = (d: Int32Array, [x, y]: P) => Math.min(...[[0, 0] as P, ...SIDES].map(([dx, dy]) => d[(y + dy) * W + x + dx]!).filter(v => v >= 0));
{
  const d = stepsHome();
  const lost = PLACES.filter(([, p]) => stepsTo(d, p) === Infinity).map(([name]) => name);
  if (lost.length) throw new Error(`cut off from the way home: ${lost.join(', ')}`);
}
// Walkable ground nobody can reach from the way in (a stray tile the noise opened) goes back to forest.
{
  const d = stepsHome();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (walkable(x, y) && d[y * W + x]! < 0) { tile[y]![x] = 't'; level[y]![x] = 0; }
  for (let i = objects.length - 1; i >= 0; i--) { const o = objects[i]!; if ((o.kind === 'stump' || o.kind === 'tree') && at(o.x, o.y) === 't') objects.splice(i, 1); }
}

// ---- Tall grass ----

// Cattails, head-high in the shallows' edge: a few patches beside the ways a chased player runs along.
const fromHome = stepsHome();
function tallMay(x: number, y: number): boolean {
  const i = y * W + x;
  if (at(x, y) !== 'g' || way[i] || !walkable(x, y) || keepOpen.has(i) || fromHome[i]! < 0) return false;
  return !PLACES.some(([, [px, py]]) => Math.hypot(px - x, py - y) <= 1.5);
}
const TALL: Array<{ near: P; size: number }> = [
  { near: [25, 14], size: 5 },
  { near: [30, 21], size: 5 },
  { near: [41, 28], size: 4 },
];
function seedNear(near: P): P {
  let best: [number, number, number] | undefined;
  for (let y = near[1] - 4; y <= near[1] + 4; y++) for (let x = near[0] - 4; x <= near[0] + 4; x++) {
    if (!tallMay(x, y) || SIDES.filter(([dx, dy]) => tallMay(x + dx, y + dy)).length < 2) continue;
    const d = Math.hypot(x - near[0], y - near[1]) + hash(x, y, 99) * 0.01;
    if (!best || d < best[0]) best = [d, x, y];
  }
  if (!best) throw new Error(`no room for tall grass near ${near.join(',')}`);
  return [best[1], best[2]];
}
const tall = new Uint8Array(W * H);
function sow(from: P, size: number, salt: number): number[] {
  const apart = (x: number, y: number) => { for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (tall[yy * W + xx]) return false; return true; };
  const ok = (x: number, y: number) => tallMay(x, y) && apart(x, y);
  const patch: number[] = [], seen = new Set([from[1] * W + from[0]]);
  const edge: Array<[number, number]> = [[0, from[1] * W + from[0]]];
  while (patch.length < size && edge.length) {
    edge.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const i = edge.shift()![1], x = i % W, y = (i / W) | 0;
    patch.push(i);
    for (const [dx, dy] of SIDES) {
      const nx = x + dx, ny = y + dy, j = ny * W + nx;
      if (seen.has(j) || !ok(nx, ny)) continue;
      seen.add(j);
      edge.push([Math.hypot(nx - from[0], ny - from[1]) * 0.6 + hash(nx, ny, salt), j]);
    }
  }
  if (patch.length < size) throw new Error(`the tall grass at ${from.join(',')} has room for ${patch.length} tiles, not ${size}`);
  return patch;
}
const patches = TALL.map((p, k) => {
  const patch = sow(seedNear(p.near), p.size, 100 + k);
  for (const i of patch) { tall[i] = 1; tile[(i / W) | 0]![i % W] = 'h'; }
  return patch;
});

// ---- Output ----

// Every 40 minutes like every region the woods answer from: restless 2:30 from the top of the Tower's round, a
// surge until 5:00, the one time the Far Woods and the Near Woods both leave clear (the Burn's too, but no trip
// passes both). No storm: none fits.
const SURGE: SurgeRule = { every: 2400, unstable: 150, surge: 150, sweep: 90, offset: 2100 };

const map: MapData = {
  id: 'marsh', name: 'The Marsh', version: 1, kind: 'wilds', depth: 3, width: W, height: H,
  tiles: tile.map(r => r.join('')),
  levels: level.map(r => r.join('')),
  spawn: { x: ENTRY[0] + 1, y: ENTRY[1], dir: 'right' },
  exits: [EXIT, ...doors],
  objects,
  // The wettest place out there: rain from 8 minutes after dawn for 4, when neither the Far Woods' nor the Near
  // Woods' falls, and the mist never lifts (the client).
  rain: [{ from: 480, length: 240 }],
  surge: SURGE,
  // Every 50 seconds, a flash near someone 15 steps or more in.
  flashes: { every: 50, steps: [15, 999] },
  // Three watchers in the mist past the first channel, a little quicker than the Far Woods'.
  watchers: { count: 3, steps: [30, 999], stepMs: 440 },
  // Five skulkers in the reeds, at night, quicker than the Far Woods'.
  skulkers: { count: 5, steps: [20, 999], when: ['night'], stepMs: 226 },
  places: PLACES.filter(([name]) => name !== 'the cutters\' hut').map(([name, [x, y]]) => ({ name, x, y })),
  forest: 'marsh',
};

// One row or object per line, so map changes show up as small, readable diffs.
const json = [
  '{',
  `  "id": ${JSON.stringify(map.id)},`, `  "name": ${JSON.stringify(map.name)},`, `  "version": ${map.version},`,
  `  "kind": ${JSON.stringify(map.kind)},`, `  "depth": ${map.depth},`,
  `  "width": ${map.width},`, `  "height": ${map.height},`,
  `  "forest": ${JSON.stringify(map.forest)},`,
  '  "tiles": [', map.tiles.map(r => `    ${JSON.stringify(r)}`).join(',\n'), '  ],',
  '  "levels": [', map.levels.map(r => `    ${JSON.stringify(r)}`).join(',\n'), '  ],',
  `  "spawn": ${JSON.stringify(map.spawn)},`,
  '  "exits": [', map.exits.map(e => `    ${JSON.stringify(e)}`).join(',\n'), '  ],',
  '  "objects": [', map.objects.map(o => `    ${JSON.stringify(o)}`).join(',\n'), '  ],',
  `  "rain": ${JSON.stringify(map.rain)},`,
  `  "surge": ${JSON.stringify(map.surge)},`,
  `  "flashes": ${JSON.stringify(map.flashes)},`,
  `  "watchers": ${JSON.stringify(map.watchers)},`,
  `  "skulkers": ${JSON.stringify(map.skulkers)},`,
  '  "places": [', map.places!.map(p => `    ${JSON.stringify(p)}`).join(',\n'), '  ]',
  '}',
  '',
].join('\n');
const out = resolve(import.meta.dirname, '../content/maps/marsh.json');
writeFileSync(out, json);

// A glance at the result, two map rows per line (a terminal character is about twice as tall as wide).
const GLYPH: Partial<Record<MapObject['kind'], string>> = { sign: '!', house: 'H', tree: 'T', rock: 'o', woodpile: 'b', stump: 'x', footbridge: '=' };
const TILE_GLYPH: Record<string, string> = { t: ' ', w: '~', h: ';', m: '.', g: '.', l: '_', f: '"' };
const objGlyph = new Map<number, string>();
for (const o of objects) for (const [x, y] of objectTiles(o)) objGlyph.set(y * W + x, o.kind === 'rock' && o.hum ? '*' : GLYPH[o.kind] ?? '?');
const glyph = (x: number, y: number) => (y === EXIT.y && x === EXIT.x ? '<' : objGlyph.get(y * W + x) ?? TILE_GLYPH[tile[y]![x]!]!);
const rows = [`+${'-'.repeat(W)}+`];
for (let y = 0; y < H; y += 2) rows.push(`|${Array.from({ length: W }, (_, x) => { const a = glyph(x, y), b = glyph(x, y + 1); return a === ' ' || a === '.' ? b : a; }).join('')}|`);
console.log([...rows, rows[0]].join('\n'));
console.log(' . bog  " reeds  ; cattails  ~ water  = boardwalk  H hut  * humming stone  T drowned tree  x stump  ! sign  < way home');

// How deep it goes, measured like the game does (TileMap.homeSteps drives the energy drain).
const tm = new TileMap(map);
const steps = new Int32Array(W * H).map((_, i) => tm.homeSteps(i % W, (i / W) | 0));
const deepest = Math.max(...steps);
const count = (k: MapObject['kind']) => objects.filter(o => o.kind === k).length;
console.log(`wrote ${out}: ${W}x${H} tiles, ${objects.length} objects (${count('rock')} stones, ${count('tree')} drowned trees, ${count('stump')} stumps, ${count('sign')} signs)`);
const withBoards = stepsHome(true);
console.log(`steps from the way home: ${PLACES.map(([name, p]) => `${name} ${stepsTo(steps, p)} (boardwalks up: ${stepsTo(withBoards, p)})`).join(', ')}; deepest ${deepest}`);
console.log(`cattails, ${patches.length} patches: ${patches.map((p, k) => `near ${TALL[k]!.near.join(',')} ${Math.min(...p.map(i => steps[i]!))}-${Math.max(...p.map(i => steps[i]!))} steps`).join(', ')}`);
const lairs = steps.filter((v, i) => tile[(i / W) | 0]![i % W] === 'f' && v >= map.skulkers!.steps[0]).length;
console.log(`reeds ${map.skulkers!.steps[0]} steps or more in: ${lairs} tiles; watchers wake on ${tm.lairs(map.watchers!.steps).length}`);
const lasts = (x: number, y: number, lvl = 1) => (maxEnergy(lvl) / -energyRate(tm, x, y, 'night')).toFixed(0);
const deep = steps.indexOf(deepest);
console.log(`a full bar at night lasts ${lasts(ENTRY[0], ENTRY[1])} s at the edge (level 10: ${lasts(ENTRY[0], ENTRY[1], 10)} s), ${lasts(deep % W, (deep / W) | 0)} s at the deepest spot (level 10: ${lasts(deep % W, (deep / W) | 0, 10)} s); a level 1 bar is ${ENERGY_MAX}`);

// Its clock never runs together with the Far Woods' or the Near Woods', in any season: a trip meets one at a time.
{
  const load = (id: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, `../content/maps/${id}.json`), 'utf8')) as MapData;
  const busy = (m: Pick<MapData, 'surge' | 'storm'>, wall: number, season: 'spring' | 'autumn') => (m.surge ? surgeAt(m.surge, wall).phase !== 'calm' : false) || (m.storm ? stormAt(m.storm, wall, season).phase !== 'clear' : false);
  for (const other of [load('far-woods'), load('near-woods')]) for (const season of ['spring', 'autumn'] as const) for (let s = 0; s < 2400; s++) {
    if (busy(map, s * 1000, season) && busy(other, s * 1000, season)) throw new Error(`the Marsh's surge runs into ${other.name}' clocks ${s} s into a round in ${season}`);
  }
}
const problems = validateMap(map);
for (const p of problems) console.log(`${p.level}: ${p.message}`);
if (problems.some(p => p.level === 'error')) process.exit(1);
