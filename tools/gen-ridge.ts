/**
 * Generates content/maps/ridge.json, the Ridge: the region at depth 4, up the trappers' fixed rope north of
 * the Burn's scar, which holds only with three on it (docs/DESIGN.md, World structure). Built from a fixed
 * seed like the Burn (gen-burn.ts, whose helpers these are), and every random choice hashes the tile
 * position, so the Ridge never reshuffles and players can share routes. Re-running it overwrites hand edits
 * to the JSON. Run it after gen:burn (it checks its clock against the Burn's, the Far Woods' and the Near
 * Woods') and before gen:interiors. Usage: npm run gen:ridge
 *
 * Above the Burn the land climbs out of the firs into snow. South to north: the rope head, where the rope
 * comes up the ice; west, the trappers' high hut, the one shelter (its fire burns down); from the rope head
 * the switchbacks zigzag up through the last of the firs, past the tarn, onto the snowfield, and up to the
 * crest, the heart, where the rime stones hum and the trappers' cairn says the needles spin. From the high
 * hut the icefall goes straight up to the snowfield: the short way, for whoever wears crampons.
 *
 * It is snow (`forest: 'snow'`), drawn so by the client: always winter up here, its cold too (the server),
 * its rain snow, and while it snows you see only a few tiles (a whiteout). Every step in its snow leaves a
 * footprint for the next hour, for everyone to see (glimpses.ts, PRINTS_KEPT_MS). You tire four times as
 * fast here as at the same distance into the Near Woods (energy.ts, the depth).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DECOR, ENERGY_MAX, TileMap, doorOf, energyRate, maxEnergy, objectTiles, stormAt, surgeAt, validateMap, type MapData, type MapExit, type MapObject, type SurgeRule,
} from '../packages/shared/src';
import { doorInto } from './gen-interiors';
import { BURN_ROPE, RIDGE_WAY_HOME, ROPE_WIDTH } from './ridge-rope';

const W = 44, H = RIDGE_WAY_HOME.y + 1, SEED = 20261011;
type P = readonly [number, number];
/** The way home, on the bottom row: back down the rope, which holds for anyone going down, onto the tiles below it in the Burn. */
const EXIT: MapExit = { x: RIDGE_WAY_HOME.x, y: RIDGE_WAY_HOME.y, w: ROPE_WIDTH, h: 1, to: 'burn', tx: BURN_ROPE.x, ty: BURN_ROPE.y + 1, dir: 'down', home: true };

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
/** Cuts ground out of the snowy firs. The map edge stays forest: the way home is the only way out. */
function set(x: number, y: number, c: string) { if (inner(x, y)) tile[y]![x] = c; }
/** Calls fn on the tiles of a rough ellipse; `rough` frays the edge so clearings do not look drawn. */
function ellipse(cx: number, cy: number, rx: number, ry: number, rough: number, salt: number, fn: (x: number, y: number, e: number) => void) {
  for (let y = Math.floor(cy - ry * 1.4); y <= Math.ceil(cy + ry * 1.4); y++) for (let x = Math.floor(cx - rx * 1.4); x <= Math.ceil(cx + rx * 1.4); x++) {
    const e = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
    if (inner(x, y) && e <= 1 + (noise(x, y, 2.5, salt) - 0.5) * 2 * rough) fn(x, y, e);
  }
}
const clearing = (cx: number, cy: number, rx: number, ry: number, salt: number) => ellipse(cx, cy, rx, ry, 0.35, salt, (x, y) => { if (at(x, y) === 't') set(x, y, 'g'); });

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

// The ways: rock stands back from them.
const way = new Uint8Array(W * H);
/** A trail of trodden snow through the waypoints, one tile wide and a tile wider here and there. */
function trail(pts: P[], salt: number) {
  for (const [x, y] of polyline([...pts])) {
    const brush: P[] = noise(x, y, 3, salt) > 0.72 ? [[0, 0], [1, 0], [0, 1], [1, 1]] : [[0, 0]];
    for (const [dx, dy] of brush) {
      const tx = x + dx, ty = y + dy;
      if (!inner(tx, ty) || at(tx, ty) === 'w' || at(tx, ty) === 'i') continue;
      set(tx, ty, 'm');
      way[ty * W + tx] = 1;
    }
  }
}
/** Raises bare rock on a tile off the ways: an outcrop, the crest, the icefall's walls. */
function rock(x: number, y: number, lv: number) {
  if (!inner(x, y) || way[y * W + x] || at(x, y) === 'w' || at(x, y) === 'i') return;
  tile[y]![x] = 'l';
  level[y]![x] = Math.max(level[y]![x]!, lv);
}

// ---- The ground ----

// The rope head: where the rope comes up over the lip of the ice, a shelf of open snow.
const ENTRY: P = [RIDGE_WAY_HOME.x, RIDGE_WAY_HOME.y - 1];
for (let x = EXIT.x; x < EXIT.x + EXIT.w; x++) { tile[EXIT.y]![x] = 'm'; tile[ENTRY[1]]![x] = 'm'; way[ENTRY[1] * W + x] = 1; }
const HEAD = { x: 21.5, y: 46.5 } as const;
clearing(HEAD.x, HEAD.y, 5, 2.8, 11);

// West from the rope head, the trappers' high hut in its clearing, under the icefall.
trail([[21, 49], [21, 46], [16, 45], [11, 43], [8, 42]], 12);
const HUT = { x: 5, y: 38 } as const;
clearing(7.5, 41.5, 4.2, 2.6, 13);

// The switchbacks: from the rope head the trail zigzags up through the last firs to the snowfield and the crest.
const ZIG: P[] = [[22, 46], [31, 44], [34, 40], [27, 37], [18, 35], [15, 31], [22, 28], [30, 25], [31, 20], [26, 16], [24, 12]];
trail(ZIG, 14);
// The tarn, off the second bend: still, dark water in a hollow of the snow.
const TARN = { x: 37.5, y: 34.5 } as const;
clearing(TARN.x - 1, TARN.y + 2, 3.4, 2.4, 15);
ellipse(TARN.x, TARN.y, 2.2, 1.5, 0.3, 16, (x, y) => { if (!way[y * W + x]) set(x, y, 'w'); });
trail([[34, 40], [36, 38]], 17);
// Banks: trodden snow where the water meets the ground.
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (at(x, y) === 'g' && SIDES.some(([dx, dy]) => at(x + dx, y + dy) === 'w')) set(x, y, 'm');

// Above the treeline, the snowfield: open snow up to the crest, the firs thinning out below it.
const FIELD = { x: 24.5, y: 17.5 } as const;
ellipse(FIELD.x, FIELD.y, 13.5, 8.5, 0.25, 18, (x, y) => { if (at(x, y) === 't') set(x, y, 'g'); });
// The switchbacks' middle bends, cut through the firs: a little open ground at each.
clearing(18, 34, 2.6, 1.8, 19);
clearing(22, 28, 2.4, 1.8, 20);

// The crest, the heart: a band of bare, wind-scoured rock under the ridge line, where the rime stones stand.
const CREST = { x: 24.5, y: 10 } as const;
ellipse(CREST.x, CREST.y, 10, 1.8, 0.15, 30, (x, y) => set(x, y, 'l'));
// The ridge line itself north of it, raised rock: the top of the world, as far as anyone has gone.
for (let y = 1; y < 9; y++) for (let x = 1; x < W - 1; x++) {
  const e = ((x + 0.5 - CREST.x) / 14) ** 2 + ((y + 0.5 - 7) / 3.4) ** 2;
  if (at(x, y) === 't' && e <= 1 + (noise(x, y, 2, 31) - 0.5) * 0.4) rock(x, y, e < 0.5 ? 2 : 1);
}

// The icefall: straight up from the high hut's clearing to the west end of the snowfield, two tiles wide, old
// ice between walls of rock. The short way, and only in crampons (TILE_NEEDS).
const ICEFALL = { x: 10, top: 17, bottom: 38 } as const;
clearing(ICEFALL.x + 0.5, ICEFALL.top - 1.5, 2, 1.6, 21);
clearing(ICEFALL.x - 0.5, ICEFALL.bottom + 1.5, 1.8, 1.4, 23);
for (let x = ICEFALL.x; x < ICEFALL.x + 2; x++) { set(x, ICEFALL.top - 1, 'g'); set(x, ICEFALL.bottom, 'g'); }
trail([[ICEFALL.x, ICEFALL.top - 2], [14, 14], [16, 13]], 22);
for (let y = ICEFALL.top; y < ICEFALL.bottom; y++) {
  for (let x = ICEFALL.x; x < ICEFALL.x + 2; x++) set(x, y, 'i');
  for (const x of [ICEFALL.x - 1, ICEFALL.x + 2]) if (at(x, y) === 't') rock(x, y, 2);
}

// Outcrops on the snowfield, and a few below it.
ellipse(33.5, 14.5, 1.6, 1.4, 0.3, 61, (x, y) => rock(x, y, 1));
ellipse(14.5, 21.5, 1.4, 1.6, 0.3, 62, (x, y) => rock(x, y, 1));
ellipse(28.5, 21.5, 1.2, 1, 0.2, 63, (x, y) => rock(x, y, 2));

// ---- Things ----

const objects: MapObject[] = [];
const blocked = new Uint8Array(W * H);
/** Adds an object. Things stand on cleared ground: a forest or water tile under one becomes snow. What is only drawn blocks nothing. */
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
/** Walkable for whoever wears crampons: the icefall is a way, only not everyone's. */
const walkable = (x: number, y: number, spikes = false) => inner(x, y) && !blocked[y * W + x] && level[y]![x] === 0 && at(x, y) !== 't' && at(x, y) !== 'w' && (spikes || at(x, y) !== 'i');

/** Walking steps from the way home to every tile (-1: no way there), without crampons or with them. */
function stepsHome(spikes = false): Int32Array {
  const d = new Int32Array(W * H).fill(-1);
  const queue: number[] = [];
  for (let x = EXIT.x; x < EXIT.x + EXIT.w; x++) { d[ENTRY[1] * W + x] = 1; queue.push(ENTRY[1] * W + x); }
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h]!, x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of SIDES) {
      const nx = x + dx, ny = y + dy;
      if (!walkable(nx, ny, spikes) || d[ny * W + nx]! >= 0) continue;
      d[ny * W + nx] = d[i]! + 1;
      queue.push(ny * W + nx);
    }
  }
  return d;
}
const reached = (d: Int32Array) => d.reduce((n, v) => n + (v >= 0 ? 1 : 0), 0);
/** Places an object unless it would cut somebody off: every tile it does not cover must stay reachable. */
function tryPlace(o: MapObject): boolean {
  const tiles = objectTiles(o);
  if (tiles.some(([x, y]) => !inner(x, y) || blocked[y * W + x] || at(x, y) === 'i')) return false;
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

// The high hut, the one shelter: stone, its fire burns down (gen-interiors.ts), so whoever passes feeds it.
const hut = { kind: 'house', x: HUT.x, y: HUT.y, w: 3, h: 2, roof: '#5b5f63', lit: 1 } as const;
must(hut);
must({ kind: 'woodpile', x: HUT.x + 3, y: HUT.y + 1 });
const doors = [doorInto('ridge-high-hut', 'ridge', hut)];
const front = ((d): P => [d.x, d.y + 1])(doorOf(hut));

/** A sign beside the way near `p`: the nearest open ground off the ways with room in front of it to read it from, and cutting nobody off. */
const signs: Array<{ x: number; y: number }> = [];
function signNear(p: P, text: string[]) {
  const spots: Array<[number, number, number]> = [];
  for (let y = p[1] - 3; y <= p[1] + 3; y++) for (let x = p[0] - 3; x <= p[0] + 3; x++) {
    if (walkable(x, y) && !way[y * W + x] && walkable(x, y + 1) && !signs.some(s => Math.abs(s.x - x) + Math.abs(s.y - y) < 2)) spots.push([Math.hypot(x - p[0], y - p[1]), x, y]);
  }
  spots.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const spot = spots.find(([, x, y]) => tryPlace({ kind: 'sign', x, y, text }));
  if (!spot) throw new Error(`no room for a sign near ${p.join(',')}`);
  signs.push({ x: spot[1], y: spot[2] });
}
// The trappers' blazes: at the rope head, the foot of the icefall, the halfway bend, the tarn and on a cairn at the crest.
signNear([24, 47], ['Cut into a post at the top of the rope: "High line. Hut west. Crest north, by the zigzag."', '"When it snows, keep to the tracks. You will not see your own hand."']);
signNear([9, 40], ['Scratched into the rock at the foot of the ice: "The short way up. Spikes, or do not try it."']);
signNear([16, 33], ['Cut into a stump at the bend: "Halfway. Rest in the lee of the rocks, never out in the open."']);
signNear([35, 38], ['Cut into a post above the water: "Tarn. It never thaws at the edges, and never freezes in the middle."']);
signNear([24, 12], ['A cairn of rime-white stones on the crest, a tin plate wired to it: "Past here the needles spin."', '"North, the snow glows at night, from underneath. We set nothing up there. We came back."']);

// The rime stones: along the crest, faintly aglow like the rocks that hum back, furred with rime that never melts.
for (let k = 0; k < 7; k++) {
  const x = Math.round(CREST.x - 8 + k * 2.6 + (hash(k, 0, 70) - 0.5) * 1.2), y = Math.round(CREST.y - 0.5 + (hash(k, 1, 70) - 0.5) * 1.2);
  if (walkable(x, y)) tryPlace({ kind: 'rock', x, y, s: round(0.95 + hash(x, y, 71) * 0.4), v: round(hash(x, y, 72)), hum: true });
}
// Loose rock at the foot of the crest and the outcrops.
for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
  const raised = level[y]![x]! > 0;
  const foot = !raised && walkable(x, y) && !way[y * W + x] && SIDES.some(([dx, dy]) => level[y + dy]![x + dx]! > 0);
  if ((raised && hash(x, y, 73) < 0.06) || (foot && hash(x, y, 74) < 0.14)) tryPlace({ kind: 'rock', x, y, s: round(0.7 + hash(x, y, 75) * 0.6), v: round(hash(x, y, 76)) });
}

// Lone firs in the clearings below the treeline, snow on their boughs: never in front of a sign or a door, or
// next to another thing, so the spots people gather at stay open. Nothing grows on the snowfield.
const keepOpen = new Set<number>([front[1] * W + front[0]]);
for (const s of signs) keepOpen.add((s.y + 1) * W + s.x);
function open(x: number, y: number): boolean {
  if (!walkable(x, y) || way[y * W + x] || keepOpen.has(y * W + x) || at(x, y) === 'l') return false;
  for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (blocked[yy * W + xx]) return false;
  return true;
}
for (let y = 26; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
  if (!open(x, y)) continue;
  const edge = SIDES.some(([dx, dy]) => at(x + dx, y + dy) === 't');
  if (!edge && hash(x, y, 90) < 0.06) tryPlace({ kind: 'tree', x, y, s: round(0.9 + hash(x, y, 91) * 0.4), v: round(hash(x, y, 92)) });
}

// The places worth walking to. Each must be reachable, or the clean-up below would quietly turn it back into forest.
const PLACES: Array<[string, P]> = [
  ['the rope head', [Math.floor(HEAD.x), Math.floor(HEAD.y)]], ['the high hut', front], ['the switchbacks', [18, 34]],
  ['the tarn', [Math.floor(TARN.x) - 2, Math.floor(TARN.y) + 3]], ['the snowfield', [Math.floor(FIELD.x) - 4, Math.floor(FIELD.y) + 2]], ['the crest', [Math.floor(CREST.x), Math.floor(CREST.y) + 1]],
];
const ICE_TOP: P = [ICEFALL.x, ICEFALL.top - 1], ICE_FOOT: P = [ICEFALL.x, ICEFALL.bottom];
const stepsTo = (d: Int32Array, [x, y]: P) => Math.min(...[[0, 0] as P, ...SIDES].map(([dx, dy]) => d[(y + dy) * W + x + dx]!).filter(v => v >= 0));
{
  const d = stepsHome();
  const lost = PLACES.filter(([, p]) => stepsTo(d, p) === Infinity).map(([name]) => name);
  if (lost.length) throw new Error(`cut off from the way home: ${lost.join(', ')}`);
  if (stepsTo(d, ICE_TOP) === Infinity || stepsTo(d, ICE_FOOT) === Infinity) throw new Error('an end of the icefall is cut off from the way home');
}
// Walkable ground nobody can reach from the way in (a stray tile the noise opened) goes back to forest.
{
  const d = stepsHome(true);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (walkable(x, y, true) && d[y * W + x]! < 0) { tile[y]![x] = 't'; level[y]![x] = 0; }
  for (let i = objects.length - 1; i >= 0; i--) { const o = objects[i]!; if (o.kind === 'tree' && at(o.x, o.y) === 't') objects.splice(i, 1); }
}

// ---- Tall grass ----

// Tussock grass, dry and pale, standing out of the snow where the wind keeps it thin: a few patches beside the
// ways a chased player runs along.
const fromHome = stepsHome();
function tallMay(x: number, y: number): boolean {
  const i = y * W + x;
  if (at(x, y) !== 'g' || way[i] || !walkable(x, y) || keepOpen.has(i) || fromHome[i]! < 0) return false;
  return !PLACES.some(([, [px, py]]) => Math.hypot(px - x, py - y) <= 1.5);
}
const TALL: Array<{ near: P; size: number }> = [
  { near: [19, 22], size: 5 },
  { near: [33, 18], size: 4 },
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

// Every 40 minutes like every region the woods answer from, and short: restless for 1:45 from 20:15 into the
// Tower's round, a surge until 23:45. The only time left clear by the Burn, the Far Woods and the Near Woods
// (surges and storms, every season): the way up through all four meets one at a time. No storm: none fits.
const SURGE: SurgeRule = { every: 2400, unstable: 105, surge: 105, sweep: 60, offset: 975 };

const map: MapData = {
  id: 'ridge', name: 'The Ridge', version: 1, kind: 'wilds', depth: 4, width: W, height: H,
  tiles: tile.map(r => r.join('')),
  levels: level.map(r => r.join('')),
  spawn: { x: ENTRY[0], y: ENTRY[1] - 1, dir: 'up' },
  exits: [EXIT, ...doors],
  objects,
  // It snows up here (always winter) once a day, between the Far Woods' morning shower and the Near Woods'
  // rain, when neither falls: a whiteout while it does.
  rain: [{ from: 480, length: 240 }],
  surge: SURGE,
  // Every 50 seconds, a flash near someone 15 steps or more in.
  flashes: { every: 50, steps: [15, 999] },
  // Four watchers above the rope head, quicker than the Burn's. Nothing lies in wait: no ferns grow up here.
  watchers: { count: 4, steps: [25, 999], stepMs: 410 },
  places: PLACES.filter(([name]) => name !== 'the high hut').map(([name, [x, y]]) => ({ name, x, y })),
  forest: 'snow',
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
  '  "places": [', map.places!.map(p => `    ${JSON.stringify(p)}`).join(',\n'), '  ]',
  '}',
  '',
].join('\n');
const out = resolve(import.meta.dirname, '../content/maps/ridge.json');
writeFileSync(out, json);

// A glance at the result, two map rows per line (a terminal character is about twice as tall as wide).
const GLYPH: Partial<Record<MapObject['kind'], string>> = { sign: '!', house: 'H', tree: 'T', rock: 'o', woodpile: 'b' };
const TILE_GLYPH: Record<string, string> = { t: ' ', w: '~', h: ';', m: '.', g: '.', l: '_', i: '#' };
const objGlyph = new Map<number, string>();
for (const o of objects) for (const [x, y] of objectTiles(o)) objGlyph.set(y * W + x, o.kind === 'rock' && o.hum ? '*' : GLYPH[o.kind] ?? '?');
const glyph = (x: number, y: number) => (y === EXIT.y && x >= EXIT.x && x < EXIT.x + EXIT.w ? 'v' : objGlyph.get(y * W + x) ?? (level[y]![x]! > 0 ? '^' : TILE_GLYPH[tile[y]![x]!]!));
const rows = [`+${'-'.repeat(W)}+`];
for (let y = 0; y < H; y += 2) rows.push(`|${Array.from({ length: W }, (_, x) => { const a = glyph(x, y), b = glyph(x, y + 1); return a === ' ' || a === '.' ? b : a; }).join('')}|`);
console.log([...rows, rows[0]].join('\n'));
console.log(' . snow  _ bare rock  ; tussock  ~ water  # icefall  ^ rock  H hut  o rock  * rime stone  T fir  ! sign  v way home');

// How deep it goes, measured like the game does (TileMap.homeSteps drives the energy drain).
const tm = new TileMap(map);
const steps = new Int32Array(W * H).map((_, i) => tm.homeSteps(i % W, (i / W) | 0));
const deepest = Math.max(...steps);
const count = (k: MapObject['kind']) => objects.filter(o => o.kind === k).length;
console.log(`wrote ${out}: ${W}x${H} tiles, ${objects.length} objects (${count('rock')} rocks, ${count('tree')} firs, ${count('sign')} signs)`);
console.log(`steps from the way home: ${PLACES.map(([name, p]) => `${name} ${stepsTo(steps, p)}`).join(', ')}; deepest ${deepest}`);
{
  // The icefall's shortcut, walked in crampons: from the hut's door to the crest.
  const spiked = stepsHome(true), plain = stepsHome();
  const crest = PLACES.find(([n]) => n === 'the crest')![1];
  const fromDoor = (spikes: boolean) => {
    const d = new Int32Array(W * H).fill(-1), q = [front[1] * W + front[0]];
    d[q[0]!] = 0;
    for (let h = 0; h < q.length; h++) {
      const i = q[h]!, x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of SIDES) { const nx = x + dx, ny = y + dy; if (walkable(nx, ny, spikes) && d[ny * W + nx]! < 0) { d[ny * W + nx] = d[i]! + 1; q.push(ny * W + nx); } }
    }
    return stepsTo(d, crest);
  };
  console.log(`the crest from the rope head: ${stepsTo(plain, crest)} steps by the switchbacks, ${stepsTo(spiked, crest)} in crampons; from the hut's door ${fromDoor(false)}, and up the icefall ${fromDoor(true)}`);
}
console.log(`tussock, ${patches.length} patches: ${patches.map((p, k) => `near ${TALL[k]!.near.join(',')} ${Math.min(...p.map(i => steps[i]!))}-${Math.max(...p.map(i => steps[i]!))} steps`).join(', ')}; watchers wake on ${tm.lairs(map.watchers!.steps).length}`);
const lasts = (x: number, y: number, lvl = 1) => (maxEnergy(lvl) / -energyRate(tm, x, y, 'night')).toFixed(0);
const deep = steps.indexOf(deepest);
console.log(`a full bar at night lasts ${lasts(ENTRY[0], ENTRY[1])} s at the edge (level 20: ${lasts(ENTRY[0], ENTRY[1], 20)} s), ${lasts(deep % W, (deep / W) | 0)} s at the deepest spot (level 20: ${lasts(deep % W, (deep / W) | 0, 20)} s); a level 1 bar is ${ENERGY_MAX}`);

// Its clock never runs together with the Burn's, the Far Woods' or the Near Woods', in any season: a trip meets one at a time.
{
  const load = (id: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, `../content/maps/${id}.json`), 'utf8')) as MapData;
  const busy = (m: Pick<MapData, 'surge' | 'storm'>, wall: number, season: 'spring' | 'autumn') => (m.surge ? surgeAt(m.surge, wall).phase !== 'calm' : false) || (m.storm ? stormAt(m.storm, wall, season).phase !== 'clear' : false);
  for (const other of [load('burn'), load('far-woods'), load('near-woods')]) for (const season of ['spring', 'autumn'] as const) for (let s = 0; s < 2400; s++) {
    if (busy(map, s * 1000, season) && busy(other, s * 1000, season)) throw new Error(`the Ridge's surge runs into ${other.name}' clocks ${s} s into a round in ${season}`);
  }
}
const problems = validateMap(map);
for (const p of problems) console.log(`${p.level}: ${p.message}`);
if (problems.some(p => p.level === 'error')) process.exit(1);
