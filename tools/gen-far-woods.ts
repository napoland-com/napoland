/**
 * Generates content/maps/far-woods.json, the Far Woods: the first region at depth 2, up the trappers'
 * trail from the cabin at the end of the Near Woods (docs/DESIGN.md, World structure). Built from a fixed
 * seed like the Near Woods (gen-woods.ts), and every random choice hashes the tile position, so the woods
 * never reshuffle and players can share routes. Re-running it overwrites hand edits to the JSON. Run it
 * after gen:woods (it checks its clocks against the Near Woods') and before gen:interiors. Usage:
 * npm run gen:far-woods
 *
 * South to north: the trail comes up from the Near Woods through old firs to a fork. West, it fords the
 * creek in its gorge and climbs to the trapper's cabin, the one shelter (its fire burns down: feed it
 * going in, and it still burns coming out). East, the old logging road crosses the gorge on the loggers'
 * bridge to their last camp: the bunkhouse fallen in, the yarder rusting where it stood, cable spools,
 * the log deck nobody hauled; a skid road climbs on to the cut, and an old skid trail runs west from
 * the camp to the trapper's cabin. North of the cabin the trail goes through the cedar grove and past
 * the split rock to the dark hollow where the rocks hum back, the heart of the woods, and NAPO's field
 * post in it: a small concrete hut and a mast, further gone than the listening post in the Near Woods.
 *
 * It is old growth (`forest: 'old'`): taller firs with cedars among them and deeper ferns, drawn so by
 * the client. You tire twice as fast here as at the same distance into the Near Woods (energy.ts, the
 * depth), so the numbers printed at the end are the ones DESIGN.md gives.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DECOR, ENERGY_MAX, TileMap, doorOf, energyRate, maxEnergy, objectTiles, stormAt, surgeAt, validateMap, type MapData, type MapExit, type MapObject, type StormRule, type SurgeRule,
} from '../packages/shared/src';
import { doorInto } from './gen-interiors';
import { BURN_WAY_HOME, FAR_WOODS_GATE, GATE_WIDTH } from './burn-gate';
import { FAR_WOODS_END, NEAR_WOODS_END } from './trappers-trail';

const W = 80, H = 100, SEED = 20260929;
type P = readonly [number, number];
/** The trappers' trail from the Near Woods arrives on the bottom row; it leads back to the top of the Near Woods' trail. */
const EXIT: MapExit = { x: FAR_WOODS_END.x, y: FAR_WOODS_END.y, w: 1, h: 1, to: 'near-woods', tx: NEAR_WOODS_END.x, ty: NEAR_WOODS_END.y + 1, dir: 'down', home: true };

// Every random choice hashes the tile position (with the seed), as in gen-woods.ts, so moving one
// clearing does not reshuffle the rest of the woods.
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
/** Cuts ground out of the forest. The map edge stays forest: the trail home is the only way out. */
function set(x: number, y: number, c: string) { if (inner(x, y)) tile[y]![x] = c; }
/** Calls fn on the tiles of a rough ellipse; `rough` frays the edge so clearings do not look drawn. */
function ellipse(cx: number, cy: number, rx: number, ry: number, rough: number, salt: number, fn: (x: number, y: number, e: number) => void) {
  for (let y = Math.floor(cy - ry * 1.4); y <= Math.ceil(cy + ry * 1.4); y++) for (let x = Math.floor(cx - rx * 1.4); x <= Math.ceil(cx + rx * 1.4); x++) {
    const e = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
    if (inner(x, y) && e <= 1 + (noise(x, y, 2.5, salt) - 0.5) * 2 * rough) fn(x, y, e);
  }
}
const clearing = (cx: number, cy: number, rx: number, ry: number, salt: number) => ellipse(cx, cy, rx, ry, 0.35, salt, (x, y) => { if (at(x, y) === 't') set(x, y, 'g'); });
/** Fern patches (where the skulkers lie) grow on open grass; here, deep and wide. */
const ferns = (cx: number, cy: number, rx: number, ry: number, salt: number) => ellipse(cx, cy, rx, ry, 0.5, salt, (x, y) => { if (at(x, y) === 'g' && !way[y * W + x]) set(x, y, 'f'); });

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
/** Corners of a way from a to b in straight runs of about `run` tiles, like a staircase (see gen-woods.ts). */
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

// The ways (the trails, the logging road and the skid roads): water never cuts them, so where the creek
// meets one there is a ford, and the gorge's walls stand back from them.
const way = new Uint8Array(W * H);
/** Which way each way tile belongs to (1: the trappers' trail, 2: the logging road, 3: the rest). */
const wayOf = new Uint8Array(W * H);
const BRUSH: Record<number, P[]> = {
  1: [[0, 0]],
  2: [[0, 0], [1, 0], [0, 1], [1, 1]],
  3: [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]],
};
/** A trail of mud with tufts of grass through the waypoints, `width` tiles wide and a tile wider here and there. */
function trail(pts: P[], width: 1 | 2, grass: number, salt: number, kind: 1 | 2 | 3, run = 3) {
  const corners = [pts[0]!, ...pts.slice(1).flatMap((p, i) => stairs(pts[i]!, p, run, salt * 16 + i))];
  for (const [x, y] of polyline(corners)) {
    const w = noise(x, y, 3, salt) > 0.7 ? width + 1 : width;
    for (const [dx, dy] of BRUSH[w]!) {
      const tx = x + dx, ty = y + dy;
      if (!inner(tx, ty)) continue;
      set(tx, ty, noise(tx, ty, 2, salt + 1) < grass ? 'g' : 'm');
      way[ty * W + tx] = 1;
      wayOf[ty * W + tx] ||= kind;
    }
  }
}
function water(x: number, y: number) { if (inner(x, y) && !way[y * W + x]) tile[y]![x] = 'w'; }
/** Raises bare rock on a tile off the ways: a wall of the gorge, an outcrop, the rim of the hollow. */
function rock(x: number, y: number, lv: number) {
  if (!inner(x, y) || way[y * W + x] || at(x, y) === 'w') return;
  tile[y]![x] = 'l';
  level[y]![x] = Math.max(level[y]![x]!, lv);
}

// ---- The ground ----

// The trappers' trail: up from the Near Woods through the old firs to the fork, where the old logging road
// turns off east.
const ENTRY: P = [FAR_WOODS_END.x, FAR_WOODS_END.y - 1];
tile[FAR_WOODS_END.y]![FAR_WOODS_END.x] = 'm';
trail([ENTRY, [40, 94], [38, 90]], 1, 0.35, 10, 1);
const FORK: P = [38, 88];
clearing(FORK[0] + 0.5, FORK[1] + 0.5, 3.4, 2.6, 11);

// West from the fork the trail fords the creek and climbs to the trapper's cabin.
trail([[37, 88], [33, 86], [29, 84], [28, 82], [28, 76], [24, 74], [21, 71], [18, 68], [16, 65]], 1, 0.3, 12, 1);
/** Where the trail fords the creek. */
const FORD: P = [28, 79];
/** The trapper's cabin: its clearing, and the cabin on its north side (the room is in gen-interiors.ts). */
const CABIN = { x: 14, y: 61 } as const;
clearing(15.5, 64.5, 5.2, 3.8, 13);

// North of the cabin the trail goes old: through the cedar grove, past the split rock, up to the hollow.
trail([[12, 63], [12, 58], [13, 55], [13, 50], [14, 46], [17, 42], [20, 39], [24, 34], [28, 30], [33, 26], [37, 23], [40, 20], [43, 17], [45, 15]], 1, 0.3, 14, 1);
const GROVE = { x: 12.5, y: 47.5 } as const;
clearing(GROVE.x, GROVE.y, 4.6, 4, 15);
clearing(28.5, 29.5, 4.2, 3.2, 16);

// East from the fork, the old logging road: two ruts wide, grassed over, across the gorge on the
// loggers' bridge and up to their last camp.
trail([[39, 88], [44, 86], [49, 83], [51, 81], [51, 73], [55, 70], [58, 65], [61, 61]], 2, 0.55, 20, 2, 4);
/** Where the logging road crosses the gorge, on the loggers' bridge. */
const BRIDGE: P = [51, 77];
const CAMP = { x: 62.5, y: 57.5 } as const;
clearing(CAMP.x, CAMP.y, 8, 6, 21);
// A skid road climbs on from the camp to the cut, the last stand they logged, and stops there.
trail([[64, 52], [66, 47], [67, 42], [65, 37]], 1, 0.4, 22, 3);
const CUT = { x: 63.5, y: 34.5 } as const;
clearing(CUT.x, CUT.y, 5.4, 4, 23);
// And an old skid trail runs west from the camp through the middle of the woods to the trapper's cabin.
trail([[55, 58], [49, 57], [42, 59], [35, 58], [28, 60], [19, 63]], 1, 0.35, 24, 3);

// The dark hollow where the rocks hum back: a bowl of ground in a rim of rock, the trail its one way in.
const HOLLOW = { x: 46.5, y: 11.5 } as const;
ellipse(HOLLOW.x, HOLLOW.y, 6.4, 4.8, 0.2, 30, (x, y) => set(x, y, noise(x, y, 1.8, 31) < 0.55 ? 'm' : 'g'));
// Where the trail comes through the rim, a little open ground: NAPO's sign stands there.
clearing(38.5, 20.5, 2.6, 1.8, 32);
// A cut through the rim north out of the bowl, two tiles wide, up to NAPO's gate (placed with the things
// below), beyond which lies the Burn. A way, so the rim, the rocks and the grass keep off it.
for (let y = FAR_WOODS_GATE.y; y <= 9; y++) for (let x = FAR_WOODS_GATE.x; x < FAR_WOODS_GATE.x + GATE_WIDTH; x++) { set(x, y, 'm'); way[y * W + x] = 1; }

// Ferns, deep and wide: in the cedar grove, around the cut and the hollow, by the camp and along the
// old trail, where the skulkers lie.
ferns(GROVE.x - 1, GROVE.y + 0.5, 4.2, 3.4, 40);
ferns(29.5, 28.5, 2.6, 2, 41);
ferns(CUT.x + 2.5, CUT.y - 1, 3, 2.4, 42);
ferns(HOLLOW.x - 3, HOLLOW.y + 2, 2.4, 1.8, 43);
ferns(CAMP.x - 5, CAMP.y + 3.5, 2.6, 1.8, 44);
ferns(18, 65.5, 2, 1.6, 45);
// A glade of ferns halfway along the old skid trail.
clearing(33.5, 57.5, 3, 2.4, 46);
ferns(33.5, 57.5, 2.8, 2.2, 47);

// Water: the creek comes down out of the north-east hills and runs south-west across the woods in its
// gorge, under the logging road (the loggers' bridge) and the trappers' trail (a ford); a spring pool
// in the cedar grove, and one by the cut.
const CREEK: P[] = [[77, 62], [70, 66], [63, 70], [58, 74], [55, 77], [47, 77], [42, 79], [34, 79], [21, 79], [14, 82], [7, 85], [1, 87]];
for (const [x, y] of polyline(CREEK)) water(x, y);
// Under the bridge the gorge runs two wide, so the timbers span it; at the ford the creek spreads over the stones.
for (let x = BRIDGE[0] - 3; x <= BRIDGE[0] + 4; x++) water(x, BRIDGE[1] + 1);
for (let x = FORD[0] - 3; x <= FORD[0] + 3; x++) water(x, FORD[1] + 1);
ellipse(9.5, 45.5, 1.3, 1, 0.3, 50, water);
ellipse(68.5, 32.5, 1.2, 1, 0.3, 51, water);
// Open banks just south of the ford and of the bridge, where the ways come down to the water: glowcaps grow there.
clearing(FORD[0] + 1.5, FORD[1] + 3.5, 2.4, 1.3, 48);
clearing(BRIDGE[0] - 1, BRIDGE[1] + 3.5, 2.6, 1.3, 49);
// The gorge: walls of bare rock on both sides of the creek, highest at the water, and broken wherever a
// way comes down to cross it.
const nearWay = (x: number, y: number, r: number) => { for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) if (inner(xx, yy) && way[yy * W + xx]) return true; return false; };
const pool = (x: number, y: number) => Math.hypot(x - 9, y - 45) < 3 || Math.hypot(x - 68, y - 32) < 3;
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  if (at(x, y) === 'w' || way[y * W + x] || nearWay(x, y, 2) || pool(x, y)) continue;
  let d = 9;
  for (let yy = y - 2; yy <= y + 2; yy++) for (let xx = x - 2; xx <= x + 2; xx++) if (at(xx, yy) === 'w' && !pool(xx, yy)) d = Math.min(d, Math.max(Math.abs(xx - x), Math.abs(yy - y)));
  if (d === 1) rock(x, y, noise(x, y, 2, 52) < 0.35 ? 3 : 2);
  else if (d === 2 && noise(x, y, 1.6, 53) < 0.6) rock(x, y, 1);
}
// Banks: mud by the water where no wall stands, around the fords and the pools.
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  if (at(x, y) !== 'g' && at(x, y) !== 'f') continue;
  if (SIDES.some(([dx, dy]) => at(x + dx, y + dy) === 'w')) set(x, y, 'm');
}

// Rock outcrops: the split rock by the trail north of the grove, one by the trail below the grove, one above the cut.
ellipse(22.5, 36.5, 2.8, 2.2, 0.3, 60, (x, y) => rock(x, y, 1));
ellipse(22, 36, 1.4, 1.1, 0.2, 61, (x, y) => rock(x, y, 2));
ellipse(8.5, 54.5, 2.6, 2.4, 0.3, 62, (x, y) => rock(x, y, 1));
ellipse(8.5, 54, 1.4, 1.3, 0.2, 63, (x, y) => rock(x, y, 2));
ellipse(71.5, 40.5, 2.6, 2, 0.3, 64, (x, y) => rock(x, y, 1));
// The hollow's rim: rock all round the bowl, two and three steps high, open only where the trail comes in.
for (let y = 1; y < 24; y++) for (let x = 34; x < 60; x++) {
  const e = ((x + 0.5 - HOLLOW.x) / 8.6) ** 2 + ((y + 0.5 - HOLLOW.y) / 6.8) ** 2;
  if (at(x, y) !== 't' || e > 1 + (noise(x, y, 2.2, 65) - 0.5) * 0.5 || nearWay(x, y, 1)) continue;
  rock(x, y, e < 0.72 ? 3 : 2);
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

/** Walking steps from the way home to every tile (-1: no way there). */
function stepsHome(): Int32Array {
  const d = new Int32Array(W * H).fill(-1);
  const queue: number[] = [ENTRY[1] * W + ENTRY[0]];
  d[queue[0]!] = 1;
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

// The trapper's cabin, the one shelter: its fire burns down (gen-interiors.ts), so whoever passes feeds it.
// Its window glows while someone keeps it going; the woodpile the trapper split stands by its east wall.
const cabin = { kind: 'house', x: CABIN.x, y: CABIN.y, w: 3, h: 2, roof: '#4f4235', lit: 1 } as const;
must(cabin);
must({ kind: 'woodpile', x: CABIN.x + 3, y: CABIN.y });
must({ kind: 'barrel', x: CABIN.x - 1, y: CABIN.y + 1 });

// NAPO's field post in the hollow: a small concrete hut against the north of the bowl, dark (nobody keeps
// a fire in it), and its mast beside it, snapped halfway, the light at its top long dead.
const post = { kind: 'house', x: 45, y: 7, w: 3, h: 2, roof: '#6f7375', lit: 0, style: 'napo' } as const;
must(post);
must({ kind: 'antenna', x: 50, y: 8, broken: true });
// NAPO's gate across the cut, the farthest thing it built: too heavy for one, it swings open only for two
// pulling at once, and lets them through into the Burn (gen-burn.ts), whose way home opens it from that side.
must({
  kind: 'gate', x: FAR_WOODS_GATE.x, y: FAR_WOODS_GATE.y, w: GATE_WIDTH, to: 'burn', tx: BURN_WAY_HOME.x, ty: BURN_WAY_HOME.y - 1, dir: 'up',
  text: [
    'NAPO · Napoland Zone · Gate N-1. Past here: uncharted. Compasses unreliable.',
    'Two-person rule: both pull together, or it will not move.',
    'Crews in pairs only. The gate opens from the far side for the way back.',
  ],
});
const doors = [doorInto('far-woods-trapper-cabin', 'far-woods', cabin), doorInto('far-woods-field-post', 'far-woods', post)];
/** The tile in front of each door, where you come out. */
const fronts = [cabin, post].map((h): P => { const d = doorOf(h); return [d.x, d.y + 1]; });

// The loggers' last camp, from before NAPO: the bunkhouse fallen in, the yarder where it stood, cable
// spools, the deck of logs they cut and never hauled, a pair of rusted barrels, and the company's board.
must({ kind: 'ruin', x: 57, y: 54, w: 5, h: 3 });
must({ kind: 'yarder', x: 68, y: 54 });
for (const [x, y] of [[69, 57], [68, 60], [59, 60]] as const) must({ kind: 'spool', x, y });
must({ kind: 'logs', x: 65, y: 58, w: 2, h: 2 });
for (const [x, y] of [[63, 54], [70, 54]] as const) must({ kind: 'barrel', x, y });

/** A sign beside the way near `p`: the nearest open ground off the ways with room in front of it to read it from, and cutting nobody off. */
const signs: Array<{ x: number; y: number }> = [];
function signNear(p: P, text: string[], style?: 'napo') {
  const spots: Array<[number, number, number]> = [];
  for (let y = p[1] - 3; y <= p[1] + 3; y++) for (let x = p[0] - 3; x <= p[0] + 3; x++) {
    if (walkable(x, y) && !way[y * W + x] && walkable(x, y + 1) && !signs.some(s => Math.abs(s.x - x) + Math.abs(s.y - y) < 2)) spots.push([Math.hypot(x - p[0], y - p[1]), x, y]);
  }
  spots.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const spot = spots.find(([, x, y]) => tryPlace({ kind: 'sign', x, y, text, ...(style ? { style } : {}) }));
  if (!spot) throw new Error(`no room for a sign near ${p.join(',')}`);
  signs.push({ x: spot[1], y: spot[2] });
}
signNear([37, 87], ['West, over the ford: the trapper\'s cabin. Keep its fire fed.', 'East, over the loggers\' bridge: the old camp.', 'North of the cabin the trail is old. Mind the ferns.']);
signNear([62, 57], ['Stonebrook Timber Co. · Camp 4', 'No fires in the bunkhouse. Keep clear of the cables.', 'Chalked under it: "Mill shut for the winter. Back in the spring."']);
signNear([41, 18], ['NAPO field post · Napoland Zone', 'The rocks here hum back. Instruments in use.', 'Crews two at a time. Log every visit at the desk.'], 'napo');

// The humming rocks: a loose ring in the middle of the bowl, faintly aglow, open where the trail comes in.
for (let k = 0; k < 11; k++) {
  if (k === 3 || k === 4) continue;
  const a = (k / 11) * Math.PI * 2 + 0.3, x = Math.floor(HOLLOW.x + Math.cos(a) * 3.3), y = Math.floor(HOLLOW.y + 0.8 + Math.sin(a) * 2.2);
  if (walkable(x, y)) tryPlace({ kind: 'rock', x, y, s: round(1.05 + hash(x, y, 70) * 0.4), v: round(hash(x, y, 71)), hum: true });
}
// Loose rock on and around the outcrops, the gorge's walls and the hollow's rim.
for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
  const raised = level[y]![x]! > 0;
  const foot = !raised && walkable(x, y) && !way[y * W + x] && SIDES.some(([dx, dy]) => level[y + dy]![x + dx]! > 0);
  if ((raised && hash(x, y, 72) < 0.1) || (foot && hash(x, y, 73) < 0.2)) tryPlace({ kind: 'rock', x, y, s: round(0.75 + hash(x, y, 74) * 0.6), v: round(hash(x, y, 75)) });
}

// Glowcaps grow in the damp: the creek's banks at the fords, the grove's spring, the hollow, the cut's pool.
const SHROOMS: Array<[number, number, number]> = [[FORD[0] + 1, FORD[1] + 3, 1.5], [8, 47.5, 1.4], [12, 44, 1.2], [44, 13, 1.4], [49, 14, 1.2], [67, 34, 1.3], [BRIDGE[0] - 1.5, BRIDGE[1] + 3, 1.5], [30, 58, 1.2]];
const shroomAt = new Set<number>();
for (const [cx, cy, r] of SHROOMS) {
  const spots: Array<[number, number, number]> = [];
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    if (Math.hypot(x - cx, y - cy) <= r && walkable(x, y) && !way[y * W + x]) spots.push([hash(x, y, 80), x, y]);
  }
  if (!spots.length) throw new Error(`no open ground for glowcaps around ${cx},${cy}`);
  spots.sort((a, b) => a[0] - b[0]);
  for (const [, x, y] of spots.slice(0, Math.max(2, spots.filter(s => s[0] < 0.6).length))) { place({ kind: 'shrooms', x, y }); shroomAt.add(y * W + x); }
}

// Old firs and cedars standing alone in the clearings, bigger than the Near Woods' (the forest grows old
// here), and loose rocks along the clearings' edges: never in front of a sign or a door, or right next to
// another thing, so the spots people gather at stay open.
const keepOpen = new Set<number>();
for (const s of signs) keepOpen.add((s.y + 1) * W + s.x);
for (const [x, y] of fronts) keepOpen.add(y * W + x);
function open(x: number, y: number): boolean {
  if (!walkable(x, y) || way[y * W + x] || keepOpen.has(y * W + x) || shroomAt.has(y * W + x)) return false;
  for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (blocked[yy * W + xx]) return false;
  return true;
}
for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
  if (!open(x, y) || Math.hypot(x + 0.5 - HOLLOW.x, y + 0.5 - HOLLOW.y) < 7) continue;
  const edge = SIDES.some(([dx, dy]) => at(x + dx, y + dy) === 't');
  if (!edge && (at(x, y) === 'g' || at(x, y) === 'f') && hash(x, y, 90) < 0.06) tryPlace({ kind: 'tree', x, y, s: round(1.3 + hash(x, y, 91) * 0.6), v: round(hash(x, y, 92)) });
  else if (edge && hash(x, y, 93) < 0.03) tryPlace({ kind: 'rock', x, y, s: round(0.55 + hash(x, y, 94) * 0.45), v: round(hash(x, y, 95)) });
}

// The places worth walking to. Each must be reachable, or the clean-up below would quietly turn it back
// into forest.
const PLACES: Array<[string, P]> = [
  ['the fork', FORK], ['the ford', [FORD[0], FORD[1] + 3]], ['the trapper\'s cabin', fronts[0]!], ['the cedar grove', [Math.floor(GROVE.x), Math.floor(GROVE.y)]],
  ['the split rock', [21, 39]], ['the loggers\' bridge', [BRIDGE[0], BRIDGE[1] + 3]], ['the old camp', [Math.floor(CAMP.x), Math.floor(CAMP.y)]], ['the cut', [Math.floor(CUT.x), Math.floor(CUT.y)]],
  ['the hollow', [Math.floor(HOLLOW.x), Math.floor(HOLLOW.y) + 2]], ['the field post', fronts[1]!],
];
const stepsTo = (d: Int32Array, [x, y]: P) => Math.min(...[[0, 0] as P, ...SIDES].map(([dx, dy]) => d[(y + dy) * W + x + dx]!).filter(v => v >= 0));
{
  const d = stepsHome();
  const lost = PLACES.filter(([, p]) => stepsTo(d, p) === Infinity).map(([name]) => name);
  if (lost.length) throw new Error(`cut off from the way home: ${lost.join(', ')}`);
}

// Walkable ground nobody can reach from the trail (a stray tile the noise opened) goes back to forest.
{
  const d = stepsHome();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (walkable(x, y) && d[y * W + x]! < 0) tile[y]![x] = 't';
  for (let i = objects.length - 1; i >= 0; i--) { const o = objects[i]!; if (o.kind === 'shrooms' && at(o.x, o.y) === 't') objects.splice(i, 1); }
}

// ---- Tall grass ----

// A few patches of knee-high grass to hide in, fewer than in the Near Woods, beside the ways a chased
// player runs along in the deeper half, and one at the camp. Only on grass nothing else uses, off the
// ways, clear of doors and signs and away from the named places.
const fromHome = stepsHome();
function tallMay(x: number, y: number): boolean {
  const i = y * W + x;
  if (at(x, y) !== 'g' || way[i] || !walkable(x, y) || shroomAt.has(i) || keepOpen.has(i) || fromHome[i]! < 0) return false;
  return !PLACES.some(([, [px, py]]) => Math.hypot(px - x, py - y) <= 1.5);
}
const TALL: Array<{ near: P; size: number }> = [
  { near: [16, 47], size: 7 },
  { near: [27, 29], size: 6 },
  { near: [38, 20], size: 5 },
  { near: [60, 36], size: 8 },
  { near: [56, 62], size: 6 },
];
/** The tile a patch grows from: the one nearest `near` that it may take, with room around it. */
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
  if (!ok(from[0], from[1])) throw new Error(`tall grass cannot grow from ${from.join(',')}`);
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

// ---- What the loggers left along their ways ----

// The loggers' bridge: timbers over the creek where the logging road fords it in the gorge, on every tile
// of the ford with the water beside it.
for (let y = BRIDGE[1] - 2; y <= BRIDGE[1] + 3; y++) for (let x = BRIDGE[0] - 2; x <= BRIDGE[0] + 3; x++) {
  const i = y * W + x;
  if (wayOf[i] !== 2 || !walkable(x, y)) continue;
  if (at(x - 1, y) === 'w' || at(x + 1, y) === 'w') place({ kind: 'bridge', x, y, dir: 'v' });
  else if (at(x, y - 1) === 'w' || at(x, y + 1) === 'w') place({ kind: 'bridge', x, y, dir: 'h' });
}
// Skids across the skid road up to the cut, every other tile; stumps over the camp and the cut, where the
// firs were felled, never two side by side, never on a way or in front of what you read.
const skidRoad = [...way.keys()].filter(i => wayOf[i] === 3 && ((i / W) | 0) < 52 && i % W > 60);
skidRoad.forEach((i, k) => {
  const x = i % W, y = (i / W) | 0;
  if (k % 2 || blocked[i] || tall[i]) return;
  place({ kind: 'skid', x, y, dir: at(x, y - 1) !== 't' && at(x, y + 1) !== 't' ? 'v' : 'h' });
});
const stumpAt = new Set<number>();
const lonely = (x: number, y: number) => { for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (stumpAt.has(yy * W + xx)) return false; return true; };
for (const [c, r, share] of [[CAMP, 8.5, 0.3], [CUT, 6, 0.4]] as const) {
  for (let y = Math.floor(c.y - r); y <= Math.ceil(c.y + r); y++) for (let x = Math.floor(c.x - r); x <= Math.ceil(c.x + r); x++) {
    const i = y * W + x;
    if (!inner(x, y) || Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) > r || !open(x, y) || tall[i] || !lonely(x, y)) continue;
    if (hash(x, y, 110) < share && tryPlace({ kind: 'stump', x, y, s: round(1 + hash(x, y, 111) * 0.5), v: round(hash(x, y, 112)) })) stumpAt.add(i);
  }
}

// ---- Output ----

// Every 40 minutes, like every region the woods answer from, but at other minutes than the Near Woods:
// restless from 5 minutes into the Tower's round, a surge at 10, over at 12:30 (the Near Woods are
// restless from 31:30 and surge at 37:30). The front takes 2 minutes to roll from the hollow to the way home.
const SURGE: SurgeRule = { every: 2400, unstable: 300, surge: 150, sweep: 120, offset: 1650 };
// A storm every 40 minutes too, a minute's warning at 24:00 and 4 minutes of it from 25:00 (the Near
// Woods' is warned at 16:00 and blows from 17:00 to 20:00).
const STORM: StormRule = { every: 2400, warn: 60, length: 240, offset: 660 };

const map: MapData = {
  id: 'far-woods', name: 'The Far Woods', version: 3, kind: 'wilds', depth: 2, width: W, height: H,
  tiles: tile.map(r => r.join('')),
  levels: level.map(r => r.join('')),
  spawn: { x: ENTRY[0], y: ENTRY[1] - 1, dir: 'up' },
  exits: [EXIT, ...doors],
  objects,
  // Old growth holds the damp: the wettest region, two showers a day, from dawn to 8 minutes after it and
  // from 24 minutes until nightfall, and none while the Near Woods' rain falls (12 to 24), so the way up
  // through both meets one rain at a time.
  rain: [{ from: 0, length: 8 * 60 }, { from: 24 * 60, length: 8 * 60 }],
  surge: SURGE,
  storm: STORM,
  // Every minute, a flash near someone 20 steps or more in.
  flashes: { every: 60, steps: [20, 999] },
  // Four watchers in the deeper half, past the trapper's cabin and the camp, a step quicker than the Near Woods'.
  watchers: { count: 4, steps: [75, 999], stepMs: 460 },
  // Four skulkers in the deep ferns, 60 steps or more in, at night and in a storm, quicker than the Near Woods'.
  skulkers: { count: 4, steps: [60, 999], when: ['night', 'storm'], stepMs: 230 },
  places: PLACES.filter(([name]) => name !== 'the trapper\'s cabin' && name !== 'the field post').map(([name, [x, y]]) => ({ name, x, y })),
  forest: 'old',
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
  `  "storm": ${JSON.stringify(map.storm)},`,
  `  "flashes": ${JSON.stringify(map.flashes)},`,
  `  "watchers": ${JSON.stringify(map.watchers)},`,
  `  "skulkers": ${JSON.stringify(map.skulkers)},`,
  '  "places": [', map.places!.map(p => `    ${JSON.stringify(p)}`).join(',\n'), '  ]',
  '}',
  '',
].join('\n');
const out = resolve(import.meta.dirname, '../content/maps/far-woods.json');
writeFileSync(out, json);

// A glance at the result, two map rows per line because a terminal character is about twice as tall
// as it is wide. Of the two tiles in a character, the one listed first in ORDER wins.
const ORDER = '*!HAYRLFB@SCJvibnc#-T^ox=~";,_. ';
const pick = (a: string, b: string) => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b);
const GLYPH: Record<MapObject['kind'], string> = {
  lamp: '*', sign: '!', board: '!', chest: 'c', workbench: 'n', house: 'H', car: 'C', npc: '@', stone: 'S', pole: 'i', barrel: 'b', fence: '-', tree: 'T', rock: 'o', shrooms: ',',
  fireplace: 'F', bed: 'B', table: 'n', shelf: 'L', crate: 'c', rug: '_', woodpile: 'b', cache: 'c', antenna: 'A', console: 'n',
  logs: '#', stump: 'x', skid: '_', stake: '!', jeep: 'J', truck: 'C', luggage: 'b', boxes: 'c', rocker: 'n', piano: 'n', bike: 'n', birdcage: 'n', pump: 'i', cage: 'c',
  hearth: 'F', sheeted: 'n', crib: 'B', clock: 'L', paper: 'n', saw: 'n', carriage: 'n', sawdust: '_',
  // What the loggers left at their camp and over the creek, and the trapper's things (in the cabin's room).
  ruin: 'R', yarder: 'Y', spool: 'o', bridge: '=', traps: 'L', gate: 'G',
  // A note lies on something else, which shows.
  note: ' ',
  // The furniture of your own cabin stands there alone (gen-interiors.ts).
  comfort: 'n',
};
const TILE_GLYPH: Record<string, string> = { t: ' ', w: '~', r: '=', f: '"', h: ';', m: '.', g: '.', l: '.' };
const objGlyph = new Map<number, string>();
for (const o of objects) for (const [x, y] of objectTiles(o)) objGlyph.set(y * W + x, pick(o.kind === 'rock' && o.hum ? '*' : GLYPH[o.kind], objGlyph.get(y * W + x) ?? ' '));
function glyph(x: number, y: number): string {
  let g = level[y]![x]! > 0 ? '^' : TILE_GLYPH[tile[y]![x]!]!;
  if (y === EXIT.y && x >= EXIT.x && x < EXIT.x + EXIT.w) g = 'v';
  return pick(objGlyph.get(y * W + x) ?? ' ', g);
}
const frame = '+' + '-'.repeat(W) + '+';
const rows = [frame];
for (let y = 0; y < H; y += 2) rows.push('|' + Array.from({ length: W }, (_, x) => pick(glyph(x, y), glyph(x, y + 1))).join('') + '|');
console.log([...rows, frame].join('\n'));
console.log(' . ground  " ferns  ; tall grass  ~ water  ^ rock  H cabin, NAPO hut  A mast  R bunkhouse  Y yarder  o rock, spool  * humming rock  x stump  # log deck  = bridge  T old fir  , shrooms  v way home');

// How deep it goes, measured like the game does (TileMap.homeSteps drives the energy drain).
const tm = new TileMap(map);
const steps = new Int32Array(W * H).map((_, i) => tm.homeSteps(i % W, (i / W) | 0));
const deepest = Math.max(...steps);
const deepTiles: string[] = [];
steps.forEach((v, i) => { if (v === deepest) deepTiles.push(`${i % W},${(i / W) | 0}`); });
const count = (k: MapObject['kind']) => objects.filter(o => o.kind === k).length;
console.log(`wrote ${out}: ${W}x${H} tiles, ${objects.length} objects (${count('rock')} rocks, ${count('tree')} old trees, ${count('stump')} stumps, ${count('shrooms')} shrooms)`);
console.log(`steps from the way home: ${PLACES.map(([name, p]) => `${name} ${stepsTo(steps, p)}`).join(', ')}`);
console.log(`deepest: ${deepest} steps, at ${deepTiles.join(' ')}`);
const lairs = steps.filter((v, i) => tile[(i / W) | 0]![i % W] === 'f' && v >= map.skulkers!.steps[0]).length;
console.log(`ferns ${map.skulkers!.steps[0]} steps or more in, where skulkers lie: ${lairs} tiles; watchers wake on ${tm.lairs(map.watchers!.steps).length}`);
console.log(`tall grass, ${patches.length} patches: ${patches.map((p, k) => `near ${TALL[k]!.near.join(',')} ${p.length} tiles ${Math.min(...p.map(i => steps[i]!))}-${Math.max(...p.map(i => steps[i]!))} steps`).join(', ')}`);
// The tuning targets (energy.ts, DESIGN.md): how long a full bar lasts standing still in the rain, at level 1 and level 8.
const lasts = (x: number, y: number, level = 1) => (maxEnergy(level) / -energyRate(tm, x, y, 'rain')).toFixed(0);
const deep = steps.indexOf(deepest);
console.log(`a full bar in the rain lasts ${lasts(ENTRY[0], ENTRY[1])} s at the edge (level 8: ${lasts(ENTRY[0], ENTRY[1], 8)} s), ${lasts(deep % W, (deep / W) | 0)} s at the deepest spot (level 8: ${lasts(deep % W, (deep / W) | 0, 8)} s); a level 1 bar is ${ENERGY_MAX}`);

// Its clocks never run together with the Near Woods': no restless time, surge or storm (nor a storm's
// warning) of one while any of the other's is on, so a trip through both meets one at a time.
{
  const near = JSON.parse(readFileSync(resolve(import.meta.dirname, '../content/maps/near-woods.json'), 'utf8')) as MapData;
  const busy = (m: Pick<MapData, 'surge' | 'storm'>, wall: number) => (m.surge ? surgeAt(m.surge, wall).phase !== 'calm' : false) || (m.storm ? stormAt(m.storm, wall).phase !== 'clear' : false);
  const period = Math.max(SURGE.every, STORM.every, near.surge?.every ?? 0, near.storm?.every ?? 0);
  for (let s = 0; s < period * 3; s++) {
    if (busy(map, s * 1000) && busy(near, s * 1000)) throw new Error(`the Far Woods' clocks run into the Near Woods' ${s % period} s into a round`);
  }
}
const problems = validateMap(map);
for (const p of problems) console.log(`${p.level}: ${p.message}`);
if (problems.some(p => p.level === 'error')) process.exit(1);
