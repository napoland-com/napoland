/**
 * Generates content/maps/near-woods.json, the Near Woods: the first region of the wilds, north of
 * Stonebrook. Built from a fixed seed like the town (gen-map.ts), so the woods never reshuffle and
 * players can share routes. Re-running it overwrites hand edits to the JSON. Usage: npm run gen:woods
 *
 * South to north: the old road comes in from town past the last street light and gives out at a
 * rusted car; a dirt track fords the creek to a lit crossroads, where the power line turns off to the
 * old cabin. West lies the pond, north the rocks. Past them there is one lonely lamp nobody wired,
 * with a ranger's hut behind it, and beyond it the deepest spots: a ring of stones (west) and the
 * cabin at the end (east). NAPO was here too: its Zone warning where the road comes in, and a
 * listening post by the ring, the rocks that hum back to the Old Stone. From the cabin at the end the
 * trappers' trail climbs north off the map, into the Far Woods (gen-far-woods.ts).
 *
 * Energy only comes back by a fire, so the three buildings are shelters that keep one burning (their
 * rooms are in gen-interiors.ts): the old cabin, the hut and the cabin at the end, each a stage deeper.
 * The street lights only help you see.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENERGY_MAX, LAMP_RADIUS, TileMap, doorOf, energyRate, objectTiles, underfoot, validateMap, type MapData, type MapExit, type MapObject } from '../packages/shared/src';
import { doorInto } from './gen-interiors';
import { noteAt, type NoteId } from './notes-left';
import { FAR_WOODS_END, NEAR_WOODS_END } from './trappers-trail';

const W = 64, H = 80, SEED = 20260927;
type P = readonly [number, number];
/** The town's north road arrives on 31,78 and 32,78; the bottom row leads back to it. */
const EXIT: MapExit = { x: 31, y: 79, w: 2, h: 1, to: 'stonebrook', tx: 29, ty: 1, dir: 'down', home: true };

// Every random choice hashes the tile position (with the seed) instead of drawing from one running
// sequence, so moving one clearing does not reshuffle the rest of the woods.
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
/** Cuts ground out of the forest. The map edge stays forest: the road home is the only way out. */
function set(x: number, y: number, c: string) { if (inner(x, y)) tile[y]![x] = c; }
/** Calls fn on the tiles of a rough ellipse; `rough` frays the edge so clearings do not look drawn. */
function ellipse(cx: number, cy: number, rx: number, ry: number, rough: number, salt: number, fn: (x: number, y: number) => void) {
  for (let y = Math.floor(cy - ry * 1.4); y <= Math.ceil(cy + ry * 1.4); y++) for (let x = Math.floor(cx - rx * 1.4); x <= Math.ceil(cx + rx * 1.4); x++) {
    const e = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
    if (inner(x, y) && e <= 1 + (noise(x, y, 2.5, salt) - 0.5) * 2 * rough) fn(x, y);
  }
}
const clearing = (cx: number, cy: number, rx: number, ry: number, salt: number) => ellipse(cx, cy, rx, ry, 0.35, salt, (x, y) => set(x, y, 'g'));
/** Fern patches (where creatures will live) grow on open grass. */
const ferns = (cx: number, cy: number, rx: number, ry: number, salt: number) => ellipse(cx, cy, rx, ry, 0.5, salt, (x, y) => { if (at(x, y) === 'g') set(x, y, 'f'); });

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
/**
 * Corners of a way from a to b in straight runs of about `run` tiles, turning like a staircase: a long
 * diagonal zigzag is tiring with a four-way joystick, runs of a few tiles are not. Where each step
 * falls varies a little, so the stairs do not look machine-made.
 */
function stairs(a: P, b: P, run: number, salt: number): P[] {
  const [ax, ay] = a, dx = b[0] - ax, dy = b[1] - ay, alongX = Math.abs(dx) >= Math.abs(dy);
  const n = Math.max(1, Math.round(Math.max(Math.abs(dx), Math.abs(dy)) / run));
  const out: P[] = [];
  let [x, y] = a;
  for (let k = 1; k <= n; k++) {
    const t = k === n ? 1 : (k + (hash(ax, ay, salt + k) - 0.5) * 0.6) / n;
    const nx = Math.round(ax + dx * t), ny = Math.round(ay + dy * t);
    out.push(alongX ? [nx, y] : [x, ny], [nx, ny]);
    [x, y] = [nx, ny];
  }
  return out;
}

// The ways (road, track and trails): water never cuts them, so where the creek meets one there is a
// ford, and poles stand beside them.
const way = new Uint8Array(W * H);
const BRUSH: Record<number, P[]> = {
  1: [[0, 0]],
  2: [[0, 0], [1, 0], [0, 1], [1, 1]],
  3: [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]],
};
/**
 * A trail of mud with tufts of grass through the waypoints `pts`, in straight runs of about `run`
 * tiles; `width` tiles wide and a tile wider here and there.
 */
function trail(pts: P[], width: 1 | 2, grass: number, salt: number, run = 3) {
  const corners = [pts[0]!, ...pts.slice(1).flatMap((p, i) => stairs(pts[i]!, p, run, salt * 16 + i))];
  for (const [x, y] of polyline(corners)) {
    const w = noise(x, y, 3, salt) > 0.68 ? width + 1 : width;
    for (const [dx, dy] of BRUSH[w]!) {
      const tx = x + dx, ty = y + dy;
      if (!inner(tx, ty)) continue;
      if (at(tx, ty) !== 'r') set(tx, ty, noise(tx, ty, 2, salt + 1) < grass ? 'g' : 'm');
      way[ty * W + tx] = 1;
    }
  }
}
function water(x: number, y: number) { if (inner(x, y) && !way[y * W + x]) tile[y]![x] = 'w'; }

// ---- The ground ----

// The old road from town: two lanes of asphalt between the firs, grass shoulders, and a gravel
// turnout under the last street light.
for (let y = 57; y <= 79; y++) for (const x of [31, 32]) { tile[y]![x] = 'r'; way[y * W + x] = 1; }
for (let y = 64; y <= 77; y++) set(30, y, 'g');
for (let y = 62; y <= 77; y++) set(33, y, 'g');
ellipse(35.5, 70.5, 2.2, 2.6, 0.3, 11, (x, y) => { if (at(x, y) === 't') set(x, y, 'l'); });
// Where the car was left, the road widens into a broken pull-off.
ellipse(32, 60.5, 3.1, 2.3, 0.25, 12, (x, y) => { set(x, y, noise(x, y, 1.6, 13) < 0.5 ? 'r' : 'm'); way[y * W + x] = 1; });
// North of the turnout the asphalt breaks up, and past the car it is gone.
for (let y = 57; y <= 67; y++) for (const x of [31, 32]) {
  if (hash(x, y, 14) < (67 - y) / 11) tile[y]![x] = noise(x, y, 2, 15) < 0.3 ? 'g' : 'm';
}

// A short trail west of the road to a glade, the first find close to the light, and on from it the
// back way to the old campsite behind the pond (the south-west loop).
trail([[29, 67], [26, 67], [24, 65]], 1, 0.5, 20);
clearing(21.5, 64.5, 2.8, 2.3, 21);
trail([[20, 63], [17, 62], [14, 59], [12, 57]], 1, 0.4, 22);

// The dirt track: from the car, across the creek, to the crossroads, an open junction under a light.
trail([[30, 57], [28, 53], [28, 49], [30, 46], [30, 43]], 2, 0.15, 30);
ellipse(31, 41.5, 3.6, 2.9, 0.3, 31, (x, y) => { set(x, y, noise(x, y, 2, 32) < 0.55 ? 'm' : 'g'); way[y * W + x] = 1; });

// Along the car's headlights (they come on at night), a trail east to a clearing by the creek.
trail([[34, 60], [38, 60], [41, 59]], 1, 0.4, 40);
clearing(45.5, 59.5, 4.6, 3.4, 41);
ferns(48, 60.5, 2.4, 2.2, 42);

// West: the pond, and past it an old campsite at the end of a thin trail.
trail([[28, 43], [24, 43], [21, 41], [19, 41]], 1, 0.3, 50);
clearing(14, 41, 7.5, 6.5, 51);
ferns(8.5, 40, 2.2, 4.2, 52);
trail([[9, 46], [8, 51], [10, 55]], 1, 0.4, 53);
clearing(11.5, 57, 3, 2.4, 54);

// East: the old cabin. From it a trail climbs north to the rocks (the east loop), and a thin one
// wanders off east to the bog.
trail([[32, 43], [37, 44], [41, 43], [44, 41]], 1, 0.3, 60);
clearing(48, 40.5, 6, 5, 61);
ferns(53, 42.5, 1.8, 2.6, 62);
trail([[50, 36], [47, 31], [44, 28], [42, 26]], 1, 0.35, 63);
trail([[52, 38], [56, 34], [58, 30], [57, 26]], 1, 0.4, 64);
clearing(57, 26, 3.8, 3.4, 65);
ferns(59.5, 24, 1.8, 2, 66);

// North: the track snakes past a fern meadow to the rocks, then climbs to the lonely lamp.
trail([[30, 39], [31, 35], [28, 31], [30, 27], [32, 24]], 2, 0.2, 70);
clearing(26.5, 31, 2.2, 3, 71);
ferns(26, 31, 2, 3, 72);
clearing(37.5, 23.5, 5, 4.2, 73);
trail([[33, 20], [34, 16], [31, 13], [29, 11]], 1, 0.3, 74);

// The west trail: from the pond up through the fern hollow to the lonely lamp (the big west loop).
trail([[12, 35], [11, 31], [13, 27], [16, 23], [19, 19], [22, 16], [26, 12]], 1, 0.35, 80);
clearing(13, 26, 3.6, 3, 81);
ferns(13, 26, 3.4, 2.8, 82);

// Deep in: the lonely lamp's clearing, the ranger's hut in a yard behind the lamp, and the far trails
// out of it to the deepest spots.
clearing(29, 10, 3.4, 2.8, 90);
clearing(30.5, 6.3, 3.3, 2.2, 96);
trail([[26, 9], [22, 7], [18, 8], [14, 6], [10, 5]], 1, 0.35, 91);
clearing(6, 5, 4, 3.4, 92);
trail([[32, 9], [36, 6], [40, 4], [44, 6], [48, 8], [51, 7]], 1, 0.35, 93);
clearing(55, 6, 4, 3, 94);
ferns(58.5, 7.5, 1.8, 1.6, 95);

// Water: the pond; the creek that runs out of it, under the track (a ford) and away east; bog pools.
// The pond freezes in winter, hard enough to cross (its `ice`); the creek, running water, never does.
const pond: P[] = [];
ellipse(13.5, 41.5, 3.8, 2.6, 0.12, 100, (x, y) => { water(x, y); pond.push([x, y]); });
for (const [x, y] of polyline([[16, 43], [22, 47], [26, 49], [29, 51], [33, 53], [38, 55], [43, 56], [49, 55], [55, 57], [62, 58]])) water(x, y);
ellipse(55, 24.5, 1.5, 1, 0.3, 102, water);
ellipse(59.5, 27.5, 1, 0.9, 0.3, 103, water);
// Banks are mud: the tiles next to water, and a ragged band a little farther out.
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  if (at(x, y) !== 'g' && at(x, y) !== 'f') continue;
  let d = 9;
  for (let yy = y - 2; yy <= y + 2; yy++) for (let xx = x - 2; xx <= x + 2; xx++) if (at(xx, yy) === 'w') d = Math.min(d, Math.max(Math.abs(xx - x), Math.abs(yy - y)));
  if (d === 1 || (d === 2 && noise(x, y, 1.5, 101) < 0.45)) set(x, y, 'm');
}

// The rocks: a two-step outcrop of bare stone east of the track.
ellipse(38.5, 23, 3, 2.4, 0.3, 110, (x, y) => { level[y]![x] = 1; set(x, y, 'l'); });
ellipse(39, 22.5, 1.5, 1.2, 0.2, 111, (x, y) => { level[y]![x] = 2; });

// ---- Things ----

const objects: MapObject[] = [];
const blocked = new Uint8Array(W * H);
/** Adds an object. Things stand on cleared ground: a forest or water tile under one becomes grass. What is only drawn (glowcaps, stakes) blocks nothing. */
function place(o: MapObject) {
  for (const [x, y] of objectTiles(o)) {
    if (!inner(x, y)) throw new Error(`${o.kind} at ${o.x},${o.y} is on the map edge`);
    if (underfoot(o)) continue;
    if (blocked[y * W + x]) throw new Error(`${o.kind} at ${o.x},${o.y} overlaps something on ${x},${y}`);
    blocked[y * W + x] = 1;
    if (at(x, y) === 't' || at(x, y) === 'w') set(x, y, 'g');
  }
  objects.push(o);
}
const walkable = (x: number, y: number) => inner(x, y) && !blocked[y * W + x] && level[y]![x] === 0 && at(x, y) !== 't' && at(x, y) !== 'w';

/** Walking steps from the home exit to every tile (-1: no way there). */
function stepsHome(): Int32Array {
  const d = new Int32Array(W * H).fill(-1);
  const queue: number[] = [];
  for (let x = EXIT.x; x < EXIT.x + EXIT.w; x++) { d[EXIT.y * W + x] = 0; queue.push(EXIT.y * W + x); }
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h]!, x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of SIDES) {
      const nx = x + dx, ny = y + dy;
      if (!walkable(nx, ny) || d[ny * W + nx]! >= 0) continue;
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

// Street lights: the last one before the dark, the crossroads, and one deep in that nobody wired.
const lamps: P[] = [[33, 70], [32, 41], [29, 9]];
for (const [x, y] of lamps) must({ kind: 'lamp', x, y });

// The power line follows the road to the crossroads, then turns east to the old cabin. The poles are
// listed in order along the line (the renderer strings wires between consecutive poles); each one
// goes on the free tile nearest its mark that stands beside a way, never on it.
for (const [px, py] of [[33, 77], [33, 72], [33, 65], [34, 58], [31, 53], [31, 48], [34, 44], [38, 45], [42, 44], [45, 42]] as const) {
  const spots: Array<[number, number, number]> = [];
  for (let y = py - 2; y <= py + 2; y++) for (let x = px - 2; x <= px + 2; x++) {
    if (!inner(x, y) || way[y * W + x] || blocked[y * W + x] || level[y]![x] || at(x, y) === 'w') continue;
    if (SIDES.some(([dx, dy]) => way[(y + dy) * W + x + dx])) spots.push([Math.hypot(x - px, y - py), x, y]);
  }
  spots.sort((a, b) => a[0] - b[0] || b[1] - a[1] || a[2] - b[2]);
  if (!spots.some(([, x, y]) => tryPlace({ kind: 'pole', x, y }))) throw new Error(`no room for a pole near ${px},${py}`);
}

place({ kind: 'car', x: 32, y: 60, w: 2 });
// The shelters, each a stage deeper: the old cabin past the crossroads, the ranger's hut behind the
// lonely lamp (the west loop's refuge, and the last fire before the deepest spots) and the cabin at the
// end of the east trail. Each has a fire; the old cabin's never goes out (somebody tends it, so a new
// player always has one), the other two burn down unless someone feeds them. Their windows are lit.
const cabins = [
  { x: 46, y: 37, roof: '#5a4a3f', inside: 'near-woods-old-cabin' },
  { x: 29, y: 5, roof: '#6b5b3e', inside: 'near-woods-ranger-hut' },
  { x: 54, y: 3, roof: '#4a5347', inside: 'near-woods-end-cabin' },
] as const;
const shelters = cabins.map(c => ({ kind: 'house', x: c.x, y: c.y, w: 3, h: 2, roof: c.roof, lit: 1 }) as const);
for (const s of shelters) place(s);
const doors = shelters.map((s, i) => doorInto(cabins[i]!.inside, 'near-woods', s));
/** The tile in front of each shelter's door, where you come out. */
const fronts = shelters.map((s): P => { const d = doorOf(s); return [d.x, d.y + 1]; });
for (const [x, y] of [[50, 38], [50, 39], [44, 37], [13, 56]] as const) must({ kind: 'barrel', x, y });
// What is left of a fence in front of the old cabin.
for (let x = 44; x <= 52; x++) if (x !== 47 && x !== 48 && x !== 50) must({ kind: 'fence', x, y: 43, dir: 'h' });

const signs: Array<{ x: number; y: number; text: string[] }> = [
  { x: 30, y: 74, text: ['The Near Woods', 'The deeper you go, the faster you tire. The lights only help you see.', 'The old cabin\'s fire never goes out. The others burn down: bring something to feed them.'] },
  { x: 28, y: 40, text: ['West: the pond. East: the old cabin.', 'North of here the lights stop. Mostly.'] },
  { x: 27, y: 9, text: ['No wires run to this light.', 'It was on when we found it. It gives no warmth.', 'The hut behind it has a fire. Rest there, and feed it before you go on.'] },
];
for (const s of signs) place({ kind: 'sign', ...s });
// What NAPO left in these woods (docs/DESIGN.md, the story): its warning where the road comes in, across
// from the residents' sign, and the listening post by the ring of stones, the rocks deep in that hum
// back: a mast on the glade's north edge, and a notice where the trail comes in.
must({ kind: 'sign', x: 33, y: 74, style: 'napo', text: ['NAPO: Napoland Zone', 'Observation area. Keep to the road after dark.', 'Do not touch the instruments.'] });
must({ kind: 'antenna', x: 5, y: 1 });
must({ kind: 'sign', x: 9, y: 4, style: 'napo', text: ['NAPO listening post', 'These stones hum back to the Old Stone. Instruments in use.', 'Do not move the stones.'] });

// Rocks on and around the outcrop.
for (let y = 18; y <= 28; y++) for (let x = 33; x <= 45; x++) {
  const raised = level[y]![x]! > 0;
  const foot = !raised && walkable(x, y) && SIDES.some(([dx, dy]) => level[y + dy]![x + dx]! > 0);
  if ((raised && hash(x, y, 120) < 0.3) || (foot && hash(x, y, 121) < 0.35)) tryPlace({ kind: 'rock', x, y, s: round(0.75 + hash(x, y, 122) * 0.5), v: round(hash(x, y, 123)) });
}
// The ring of stones in the far west glade, open on two sides, glowcaps in the middle.
const RING = { x: 6.5, y: 5.5 };
for (let k = 0; k < 10; k++) {
  if (k === 2 || k === 7) continue;
  const a = (k / 10) * Math.PI * 2, x = Math.floor(RING.x + Math.cos(a) * 2.6), y = Math.floor(RING.y + Math.sin(a) * 2.2);
  if (walkable(x, y)) tryPlace({ kind: 'rock', x, y, s: round(1 + hash(x, y, 124) * 0.35), v: round(hash(x, y, 125)) });
}

// Glowcaps grow in damp spots away from the lights: pond, creek and bog banks, the camp, the ring,
// shady corners. A patch takes some of the open ground around its center, two tiles or more where
// there is room.
const SHROOMS: Array<[number, number, number]> = [
  [21, 63, 1.2], [12, 37, 1.6], [16, 45, 1.2], [44, 57, 1.6], [10, 57, 1.2], [44, 39, 1.2], [57, 23.5, 1.4],
  [6, 5, 1], [11, 24, 1.2], [42, 20, 1.2], [58.5, 4.5, 1.2],
];
const shroomAt = new Set<number>();
for (const [cx, cy, r] of SHROOMS) {
  const spots: Array<[number, number, number]> = [];
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    if (Math.hypot(x - cx, y - cy) <= r && walkable(x, y) && !way[y * W + x]) spots.push([hash(x, y, 130), x, y]);
  }
  if (!spots.length) throw new Error(`no open ground for glowcaps around ${cx},${cy}`);
  spots.sort((a, b) => a[0] - b[0]);
  const n = Math.max(2, spots.filter(s => s[0] < 0.6).length);
  for (const [, x, y] of spots.slice(0, n)) { place({ kind: 'shrooms', x, y }); shroomAt.add(y * W + x); }
}

// Lone firs in the clearings and loose rocks along their edges, but never in a lamp's light, in front
// of a sign or a door, or right next to another thing: the spots people gather at stay open.
const keepOpen = new Set<number>();
for (const [lx, ly] of lamps) for (let y = ly - 3; y <= ly + 3; y++) for (let x = lx - 3; x <= lx + 3; x++) if (Math.hypot(x - lx, y - ly) <= LAMP_RADIUS + 0.5) keepOpen.add(y * W + x);
for (const s of signs) keepOpen.add((s.y + 1) * W + s.x);
for (const [x, y] of fronts) keepOpen.add(y * W + x);
function open(x: number, y: number): boolean {
  if (!walkable(x, y) || way[y * W + x] || keepOpen.has(y * W + x) || shroomAt.has(y * W + x)) return false;
  for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (blocked[yy * W + xx]) return false;
  return true;
}
for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
  if (!open(x, y)) continue;
  const edge = SIDES.some(([dx, dy]) => at(x + dx, y + dy) === 't');
  if (!edge && (at(x, y) === 'g' || at(x, y) === 'f') && hash(x, y, 140) < 0.07) tryPlace({ kind: 'tree', x, y, s: round(0.95 + hash(x, y, 141) * 0.5), v: round(hash(x, y, 142)) });
  else if (edge && hash(x, y, 143) < 0.035) tryPlace({ kind: 'rock', x, y, s: round(0.55 + hash(x, y, 144) * 0.45), v: round(hash(x, y, 145)) });
}

// The places worth walking to. Each must be reachable, or the clean-up below would quietly turn it
// back into forest.
const PLACES: Array<[string, P]> = [
  ['last light', lamps[0]!], ['first glade', [21, 64]], ['car', [32, 60]], ['headlight clearing', [45, 59]],
  ['crossroads light', lamps[1]!], ['pond', [20, 41]], ['campsite', [11, 57]], ['old cabin door', fronts[0]!],
  ['fern meadow', [26, 31]], ['rocks', [35, 23]], ['bog', [57, 26]], ['fern hollow', [13, 26]], ['lonely light', lamps[2]!],
  ['ranger hut door', fronts[1]!], ['ring of stones', [Math.floor(RING.x), Math.floor(RING.y)]], ['end cabin door', fronts[2]!],
];
const stepsTo = (d: Int32Array, [x, y]: P) => Math.min(...[[0, 0] as P, ...SIDES].map(([dx, dy]) => d[(y + dy) * W + x + dx]!).filter(v => v >= 0));
{
  const d = stepsHome();
  const lost = PLACES.filter(([, p]) => stepsTo(d, p) === Infinity).map(([name]) => name);
  if (lost.length) throw new Error(`cut off from the way home: ${lost.join(', ')}`);
}

// Walkable ground nobody can reach from the road (a stray tile the noise opened) goes back to forest.
{
  const d = stepsHome();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (walkable(x, y) && d[y * W + x]! < 0) tile[y]![x] = 't';
  for (let i = objects.length - 1; i >= 0; i--) { const o = objects[i]!; if (o.kind === 'shrooms' && at(o.x, o.y) === 't') objects.splice(i, 1); }
}

/** The places the paper map names, besides the cabins and the way home. */
const NAMED: Array<{ name: string; x: number; y: number }> = [
  { name: 'pond', x: 20, y: 41 }, { name: 'the crossroads', x: 32, y: 41 }, { name: 'the rocks', x: 35, y: 23 },
  { name: 'the bog', x: 57, y: 26 }, { name: 'ring of stones', x: Math.floor(RING.x), y: Math.floor(RING.y) },
];

// ---- Tall grass ----

// Knee-high grass hides whoever stands in it from creatures (shared/map.ts, hidden): they never step
// into it, and a chase ends there. It is sown last, and only on grass nothing else uses, so it moves
// nothing: every road, trail, shelter, pole, lamp, object and named place stays where it was, since
// players' routes depend on them. Most patches lie in the deeper half, where the watchers and the
// skulkers roam, beside the trails a chased player runs along.
const fromHome = stepsHome();
const poles = objects.filter(o => o.kind === 'pole');
/**
 * Tiles a patch may take: open grass off the ways, out of the lights, clear of doors, signs and poles,
 * and away from the places the paper map names (and a little from the other places worth walking to).
 */
function tallMay(x: number, y: number): boolean {
  const i = y * W + x;
  if (at(x, y) !== 'g' || way[i] || !walkable(x, y) || shroomAt.has(i) || keepOpen.has(i) || fromHome[i]! < 0) return false;
  if (poles.some(p => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) <= 1)) return false;
  return !NAMED.some(p => Math.hypot(p.x - x, p.y - y) <= 2.5) && !PLACES.some(([, [px, py]]) => Math.hypot(px - x, py - y) <= 1.5);
}
/**
 * The patches: the tile each grows from, how many tiles it takes, and what people call it, if anything.
 * Seven lie in the deeper half: north of the pond where the west trail comes down from the fern hollow
 * (the long grass) and south of it on the back way to the campsite; on the old cabin's west side; at
 * both feet of the rocks, where the trails from the old cabin and to the lonely light meet them (the
 * deer beds, north); on the rim of the ring of stones' glade; and west of the cabin at the end, where
 * the east trail comes in. One lies shallow, in the headlight clearing, where a new player finds out
 * what tall grass is before it matters.
 */
const TALL: Array<{ at: P; size: number; name?: string }> = [
  { at: [17, 36], size: 14, name: 'the long grass' },
  { at: [13, 46], size: 9 },
  { at: [43, 40], size: 9 },
  { at: [38, 26], size: 10 },
  { at: [37, 19], size: 10, name: 'the deer beds' },
  { at: [3, 4], size: 12 },
  { at: [52, 5], size: 8 },
  { at: [43, 60], size: 6 },
];
if (TALL.length < 6 || TALL.length > 9 || TALL.some(p => p.size < 6 || p.size > 16)) throw new Error('the Near Woods has 6 to 9 patches of tall grass, each 6 to 16 tiles');
const tall = new Uint8Array(W * H);
/** Grows a patch from its first tile into a rough blob, only onto tiles it may take, never touching another patch. */
function sow(from: P, size: number, salt: number): number[] {
  const apart = (x: number, y: number) => {
    for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (tall[yy * W + xx]) return false;
    return true;
  };
  const ok = (x: number, y: number) => tallMay(x, y) && apart(x, y);
  if (!ok(from[0], from[1])) throw new Error(`tall grass cannot grow from ${from.join(',')}`);
  const patch: number[] = [], seen = new Set([from[1] * W + from[0]]);
  const edge: Array<[number, number]> = [[0, from[1] * W + from[0]]];
  while (patch.length < size && edge.length) {
    // Nearer tiles first, with a little noise, so the edge is ragged rather than a drawn diamond.
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
  const patch = sow(p.at, p.size, 150 + k);
  for (const i of patch) {
    tall[i] = 1;
    tile[(i / W) | 0]![i % W] = 'h';
  }
  return patch;
});
if (patches.filter(p => fromHome[p[0]!]! >= 50).length * 2 <= patches.length) throw new Error('most of the tall grass belongs in the deeper half');

// ---- What the loggers and NAPO left (roadmap/richer-places.md) ----

// Added last, so nothing that was here moves: every road, trail, shelter, pole, lamp, sign, patch of
// tall grass and named place stays where it was, and every tile anyone could walk on stays walkable
// and just as far from home (the checks below stop the script otherwise). New ground is only cut out of
// the forest, in dead ends off the ways, so it makes no shortcut; what blocks stands only on it (or on
// forest it clears); NAPO's stakes, which block nothing, stand on open ground by the rocks.
const beforeTiles = tile.map(r => r.join('')), beforeSteps = stepsHome();
/** Cuts one tile of new ground out of the forest, or stops: it would change ground that was there. */
function clear(x: number, y: number, c: 'g' | 'm') {
  if (at(x, y) !== 't' || !inner(x, y)) throw new Error(`new ground at ${x},${y} is not forest`);
  set(x, y, c);
}
/** Places something on forest it clears (with ground `c` under it), or stops. */
function onForest(o: MapObject, c: 'g' | 'm' = 'g') {
  for (const [x, y] of objectTiles(o)) clear(x, y, c);
  must(o);
}

// The log landing, from the logging days: the gravel turnout under the last light was where the trucks
// turned and loaded, and beside it, east, the landing: a clearing of stumps and the log deck the last
// crew stacked and nobody hauled. An old skid road climbs out of it north-east into the cut, and gives
// out among the stumps.
const LANDING = { x: 44.5, y: 69.5 };
/** The log deck, at the back of the landing; the row in front of it stays open, as a truck would need it. */
const DECK = { x: 42, y: 67, w: 3, h: 2 };
ellipse(LANDING.x, LANDING.y, 4.6, 3.2, 0.15, 160, (x, y) => { if (at(x, y) === 't') set(x, y, noise(x, y, 1.7, 161) < 0.5 ? 'm' : 'g'); });
// The skid road: in from the turnout, across the landing in front of the deck, and on up into the cut.
const skidRoad: P[] = polyline([[38, 70], [41, 70], ...stairs([41, 70], [48, 69], 3, 162), ...stairs([48, 69], [53, 64], 2, 163)])
  .filter(([x, y], k, all) => all.findIndex(([ax, ay]) => ax === x && ay === y) === k);
for (const [x, y] of skidRoad) {
  if (beforeTiles[y]![x] !== 't') throw new Error(`the skid road at ${x},${y} runs onto ground that was there`);
  set(x, y, 'm');
}
must({ kind: 'logs', ...DECK });
// Stumps where the firs were cut: over the landing, never two side by side, never on the skid road or
// in front of the deck, nor where one would cut a tile off (tryPlace); and in the forest along the
// skid road and around the landing's edge, where they stand on the ground they cleared.
const onRoad = new Set(skidRoad.map(([x, y]) => y * W + x));
const stumpAt = new Set<number>();
const lonely = (x: number, y: number) => { for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (stumpAt.has(yy * W + xx)) return false; return true; };
const stump = (x: number, y: number, salt: number): MapObject => ({ kind: 'stump', x, y, s: round(0.8 + hash(x, y, salt) * 0.45), v: round(hash(x, y, salt + 1)) });
for (let y = 62; y <= 75; y++) for (let x = 38; x <= 55; x++) {
  const i = y * W + x;
  const front = y === DECK.y + DECK.h && x >= DECK.x - 1 && x <= DECK.x + DECK.w;
  if (beforeTiles[y]![x] !== 't' || at(x, y) === 't' || onRoad.has(i) || blocked[i] || front || !lonely(x, y)) continue;
  if (hash(x, y, 163) < 0.38 && tryPlace(stump(x, y, 164))) stumpAt.add(i);
}
for (let y = 62; y <= 75; y++) for (let x = 37; x <= 55; x++) {
  const i = y * W + x;
  if (at(x, y) !== 't' || !lonely(x, y) || !SIDES.some(([dx, dy]) => beforeTiles[y + dy]![x + dx] === 't' && at(x + dx, y + dy) !== 't')) continue;
  const byRoad = SIDES.some(([dx, dy]) => onRoad.has((y + dy) * W + x + dx));
  if (hash(x, y, 166) < (byRoad ? 0.45 : 0.22)) { onForest(stump(x, y, 167)); stumpAt.add(i); }
}
// The skids: logs laid across the road and half sunk, every other tile of it.
skidRoad.forEach(([x, y], k) => {
  if (k % 2 || blocked[y * W + x]) return;
  const [nx] = skidRoad[k + 1] ?? skidRoad[k - 1]!;
  place({ kind: 'skid', x, y, dir: nx !== x ? 'h' : 'v' });
});

// NAPO's survey stakes by the rocks, orange flagging on each: around the outcrop's foot, on open grass
// off the trails and out of the tall grass, a few tiles apart.
{
  const foot: Array<[number, number, number]> = [];
  for (let y = 17; y <= 29; y++) for (let x = 31; x <= 46; x++) {
    const i = y * W + x;
    if (at(x, y) !== 'g' || way[i] || blocked[i] || tall[i] || !walkable(x, y) || PLACES.some(([, [px, py]]) => px === x && py === y)) continue;
    let rock = false;
    for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (level[yy]![xx]! > 0) rock = true;
    if (rock) foot.push([hash(x, y, 171), x, y]);
  }
  foot.sort((a, b) => a[0] - b[0]);
  const stakes: P[] = [];
  for (const [, x, y] of foot) if (stakes.length < 5 && stakes.every(([sx, sy]) => Math.abs(sx - x) + Math.abs(sy - y) >= 3)) stakes.push([x, y]);
  if (stakes.length < 4) throw new Error(`room for only ${stakes.length} of NAPO's stakes by the rocks`);
  for (const [x, y] of stakes) place({ kind: 'stake', x, y });
}

// A burned-out NAPO jeep off the road in, west of it across from the last light: it went off the
// asphalt nose first into the firs, and burned, and took the nearest of them with it. Its door hangs
// open; its stencil is read from beside it.
for (const [x, y] of [[29, 70], [29, 71], [29, 72], [29, 73], [29, 74], [28, 71], [28, 73]] as const) clear(x, y, 'm');
onForest({ kind: 'jeep', x: 27, y: 72, w: 2, h: 1, dir: 'left', text: ['Stenciled on the door: NAPO · FIELD SURVEY · UNIT 7.', 'Burned out to the frame, and the firs beside it with it.', 'The door hangs open, and the keys are still in it.'] }, 'm');
for (const [x, y] of [[27, 71], [28, 70], [27, 73], [28, 74]] as const) onForest({ kind: 'stump', x, y, s: round(0.85 + hash(x, y, 169) * 0.3), v: round(hash(x, y, 170)), burned: true }, 'm');

// The checks: only forest changed, every tile anyone could walk on is still walkable and as far from
// home as it was, and the new ground is reached from the road.
{
  const d = stepsHome();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, was = beforeTiles[y]![x]!;
    if (was !== 't' && tile[y]![x] !== was) throw new Error(`the tile at ${x},${y} was ${was} and is now ${tile[y]![x]}: only forest may change`);
    if (beforeSteps[i]! >= 0 && d[i] !== beforeSteps[i]) throw new Error(`the tile at ${x},${y} was ${beforeSteps[i]} steps from home and is now ${d[i]}`);
    if (was === 't' && at(x, y) !== 't' && walkable(x, y) && d[i]! < 0) throw new Error(`new ground at ${x},${y} cannot be reached`);
  }
}

// ---- The way on to the Far Woods (roadmap/far-woods.md) ----

// The trappers' trail climbs north out of the clearing of the cabin at the end, on the cabin's west side,
// and leaves the map on its top row for the Far Woods. It comes last, like what the loggers and NAPO
// left: only forest is cut for it, as a dead end off the clearing, so every tile that was walkable stays
// as far from home; and it goes no deeper than the ring of stones already was, so a surge still starts
// there and rolls home as it always did. At its foot a sign says what lies up it.
const beforeWay = tile.map(r => r.join('')), stepsBeforeWay = stepsHome();
const DEEPEST = Math.max(...stepsBeforeWay);
const FOOT: P = [NEAR_WOODS_END.x, 3];
if (!walkable(...FOOT)) throw new Error(`the trappers' trail has no clearing to start from at ${FOOT.join(',')}`);
for (let y = NEAR_WOODS_END.y; y < FOOT[1]; y++) {
  if (beforeWay[y]![NEAR_WOODS_END.x] !== 't') throw new Error(`the trappers' trail at ${NEAR_WOODS_END.x},${y} runs onto ground that was there`);
  // The top row is the map's edge, which set() keeps forest: the way out is cut there by hand.
  tile[y]![NEAR_WOODS_END.x] = y === FOOT[1] - 1 ? 'g' : 'm';
}
/** The way on: the trail's end on the top row, into the Far Woods where they come in from the south. */
const FAR_WAY: MapExit = { x: NEAR_WOODS_END.x, y: NEAR_WOODS_END.y, w: 1, h: 1, to: 'far-woods', tx: FAR_WOODS_END.x, ty: FAR_WOODS_END.y - 1, dir: 'up' };
onForest({
  kind: 'sign', x: FOOT[0] - 1, y: FOOT[1] - 1,
  text: [
    'The Far Woods, up the trappers\' trail.',
    'Past here the old trappers went in pairs. Up there you tire twice as fast as down here.',
    'Feed the fire in the trapper\'s cabin on the way in, so it still burns on your way out.',
  ],
});
{
  const d = stepsHome();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, was = beforeWay[y]![x]!;
    if (was !== 't' && tile[y]![x] !== was) throw new Error(`the tile at ${x},${y} was ${was} and is now ${tile[y]![x]}: only forest may change`);
    if (stepsBeforeWay[i]! >= 0 && d[i] !== stepsBeforeWay[i]) throw new Error(`the tile at ${x},${y} was ${stepsBeforeWay[i]} steps from home and is now ${d[i]}`);
  }
}

// ---- Notes people left (notes-left.ts) ----

// Laid last, on what already stands here, so nothing moves: a note blocks nothing and changes no ground.
// Walt's are nailed to the poles of the north line by their tags (the woods' poles are N-7 to N-16, in
// the order they are strung), with the ranger's to him among them; in the old car where the north road
// gives out, Walt's truck, his log lies in the glove box (its front, east) and Wren's secret under the
// wiper (its back).
{
  const byTag = (n: number) => { const p = poles[n - 7]; if (!p) throw new Error(`the north line has no pole N-${n}`); return p; };
  const car = objects.find(o => o.kind === 'car');
  if (!car) throw new Error('the old car is gone: Walt\'s log and Wren\'s note lie in it');
  const nailed: Array<[NoteId, number]> = [['walt-n8', 8], ['walt-n10', 10], ['walt-n11', 11], ['walt-n12', 12], ['ranger-walt', 13], ['walt-n14', 14], ['walt-n16', 16]];
  for (const [id, tag] of nailed) place(noteAt(id, byTag(tag).x, byTag(tag).y));
  place(noteAt('walt-truck', car.x + 1, car.y));
  place(noteAt('barlow-wiper', car.x, car.y));
}

// ---- Output ----

const map: MapData = {
  id: 'near-woods', name: 'The Near Woods', version: 13, kind: 'wilds', depth: 1, width: W, height: H,
  tiles: tile.map(r => r.join('')),
  levels: level.map(r => r.join('')),
  spawn: { x: 31, y: 76, dir: 'up' },
  exits: [EXIT, ...doors, FAR_WAY],
  objects,
  // Rain from 12 minutes after dawn, for 12: the wettest part of the day, while the South Road is dry.
  rain: [{ from: 12 * 60, length: 12 * 60 }],
  // Every 40 minutes: 6 restless, then a surge of 2.5 minutes whose front takes 1.5 to sweep home.
  surge: { every: 2400, unstable: 360, surge: 150, sweep: 90 },
  // Every 40 minutes too, halfway between two surges: a minute's warning, then 3 minutes of storm.
  storm: { every: 2400, warn: 60, length: 180, offset: 1200 },
  // Every minute and a quarter, a flash near someone 30 steps or more out.
  flashes: { every: 75, steps: [30, 999] },
  // Three watchers in the deeper half, past the old cabin.
  watchers: { count: 3, steps: [55, 999] },
  // Three skulkers in the deep ferns, 50 steps or more out, at night and in a storm.
  skulkers: { count: 3, steps: [50, 999], when: ['night', 'storm'] },
  // The pond, frozen in winter: what of it is still water, row by row.
  ice: [{ name: 'the pond', tiles: pond.filter(([x, y]) => at(x, y) === 'w').sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([x, y]) => [x, y]) }],
  // What the paper map names, besides the cabins and the way home. The names of tall grass come after
  // the older ones, and what the loggers and NAPO left after those, so the paper map writes the older
  // names where it always did.
  places: [
    ...NAMED, ...TALL.flatMap(p => (p.name ? [{ name: p.name, x: p.at[0], y: p.at[1] }] : [])),
    { name: 'the log landing', x: Math.floor(LANDING.x), y: Math.floor(LANDING.y) }, { name: 'the burned jeep', x: 28, y: 72 },
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
  `  "rain": ${JSON.stringify(map.rain)},`,
  `  "surge": ${JSON.stringify(map.surge)},`,
  `  "storm": ${JSON.stringify(map.storm)},`,
  `  "flashes": ${JSON.stringify(map.flashes)},`,
  `  "watchers": ${JSON.stringify(map.watchers)},`,
  `  "skulkers": ${JSON.stringify(map.skulkers)},`,
  `  "ice": ${JSON.stringify(map.ice)},`,
  '  "places": [', map.places!.map(p => `    ${JSON.stringify(p)}`).join(',\n'), '  ]',
  '}',
  '',
].join('\n');
const out = resolve(import.meta.dirname, '../content/maps/near-woods.json');
writeFileSync(out, json);

// A glance at the result, two map rows per line because a terminal character is about twice as tall
// as it is wide. Of the two tiles in a character, the one listed first in ORDER wins.
const ORDER = '*!HCJ@SFvibBnLc#-T^ox~=";,_. ';
const pick = (a: string, b: string) => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b);
const GLYPH: Record<MapObject['kind'], string> = {
  lamp: '*', sign: '!', board: '!', chest: 'c', workbench: 'n', house: 'H', car: 'C', npc: '@', stone: 'S', pole: 'i', barrel: 'b', fence: '-', tree: 'T', rock: 'o', shrooms: ',',
  // Furniture belongs inside (gen-interiors.ts), but a campfire could stand out here one day.
  fireplace: 'F', bed: 'B', table: 'n', shelf: 'L', crate: 'c', rug: '_', woodpile: 'b', cache: 'c',
  // NAPO's listening post has a mast here, by the ring of stones; its desks stand on the South Road (gen-south-road.ts).
  antenna: 'i', console: 'n',
  // What the loggers left (the log deck, stumps, the skids across the skid road) and NAPO (its stakes, the jeep).
  logs: '#', stump: 'x', skid: '_', stake: '!', jeep: 'J',
  // The rest of what people left stands in town, on the South Road and in the rooms.
  truck: 'C', luggage: 'b', boxes: 'c', rocker: 'n', piano: 'n', bike: 'n', birdcage: 'n', pump: 'i', cage: 'c',
  hearth: 'F', sheeted: 'n', crib: 'B', clock: 'L', paper: 'n', saw: 'n', carriage: 'n', sawdust: '_',
  // The loggers' camp, the gorge's bridge and the trapper's things are the Far Woods' (gen-far-woods.ts).
  ruin: 'H', yarder: '#', spool: 'o', bridge: '=', traps: 'L',
  // A note lies on something else, which shows.
  note: ' ',
  // The furniture of your own cabin stands there alone (gen-interiors.ts).
  comfort: 'n',
  // NAPO's teleport stands in every cabin and by the notice board in town (gen-interiors.ts, gen-map.ts).
  teleport: 'N',
};
const TILE_GLYPH: Record<string, string> = { t: ' ', w: '~', r: '=', f: '"', h: ';', m: '.', g: '.', l: '.' };
const objGlyph = new Map<number, string>();
for (const o of objects) for (const [x, y] of objectTiles(o)) objGlyph.set(y * W + x, pick(GLYPH[o.kind], objGlyph.get(y * W + x) ?? ' '));
function glyph(x: number, y: number): string {
  let g = level[y]![x]! > 0 ? '^' : TILE_GLYPH[tile[y]![x]!]!;
  if (y === EXIT.y && x >= EXIT.x && x < EXIT.x + EXIT.w) g = 'v';
  return pick(objGlyph.get(y * W + x) ?? ' ', g);
}
const frame = '+' + '-'.repeat(W) + '+';
const rows = [frame];
for (let y = 0; y < H; y += 2) rows.push('|' + Array.from({ length: W }, (_, x) => pick(glyph(x, y), glyph(x, y + 1))).join('') + '|');
console.log([...rows, frame].join('\n'));
console.log(' . ground  " ferns  ; tall grass  = old road  ~ water  ^ rocks  * street light  ! sign or stake  H cabin  C car  J jeep  i pole  o rock  x stump  # log deck  T fir  , shrooms  v way home');

// How deep it goes, measured like the game does (TileMap.homeSteps drives the energy drain).
const tm = new TileMap(map);
const steps = new Int32Array(W * H).map((_, i) => tm.homeSteps(i % W, (i / W) | 0));
const deepest = Math.max(...steps);
// The way on to the Far Woods goes no deeper than the woods already went: the surge starts where it did.
if (deepest !== DEEPEST) throw new Error(`the deepest place is ${deepest} steps from home now, not ${DEEPEST}: the trappers' trail went too deep`);
const deepTiles: string[] = [];
steps.forEach((v, i) => { if (v === deepest) deepTiles.push(`${i % W},${(i / W) | 0}`); });
const count = (k: MapObject['kind']) => objects.filter(o => o.kind === k).length;
const lairs = steps.filter((v, i) => tile[(i / W) | 0]![i % W] === 'f' && v >= map.skulkers!.steps[0]).length;
console.log(`wrote ${out}: ${W}x${H} tiles, ${objects.length} objects (${count('rock')} rocks, ${count('tree')} firs, ${count('pole')} poles, ${count('shrooms')} shrooms)`);
console.log(`steps from the way home: ${PLACES.map(([name, p]) => `${name} ${stepsTo(steps, p)}`).join(', ')}`);
console.log(`deepest: ${deepest} steps, at ${deepTiles.join(' ')}`);
console.log(`ferns ${map.skulkers!.steps[0]} steps or more out, where skulkers lie: ${lairs} tiles`);
console.log(`tall grass, ${patches.length} patches: ${patches.map((p, k) => {
  const s = p.map(i => steps[i]!);
  return `${TALL[k]!.name ?? `at ${TALL[k]!.at.join(',')}`} ${p.length} tiles ${Math.min(...s)}-${Math.max(...s)} steps`;
}).join(', ')}`);
console.log(`shelter doors: ${shelters.map((s, i) => { const d = doorOf(s); return `${cabins[i]!.inside} ${tm.homeSteps(d.x, d.y)} steps`; }).join(', ')}`);
// The tuning targets in energy.ts: how long a full bar lasts standing still in the rain.
const lasts = (x: number, y: number) => (ENERGY_MAX / -energyRate(tm, x, y, 'rain') / 60).toFixed(1);
const deep = steps.indexOf(deepest);
console.log(`a full bar in the rain lasts ${lasts(EXIT.x, EXIT.y - 1)} minutes at the edge, ${lasts(deep % W, (deep / W) | 0)} at the deepest spot`);
const problems = validateMap(map);
for (const p of problems) console.log(`${p.level}: ${p.message}`);
if (problems.some(p => p.level === 'error')) process.exit(1);
