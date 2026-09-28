/**
 * Generates content/maps/burn.json, the Burn: the first region at depth 3, through NAPO's gate north of the
 * Far Woods' hollow, which only opens for two pulling at once (docs/DESIGN.md, World structure). Built from a
 * fixed seed like the Far Woods (gen-far-woods.ts, whose helpers these are), and every random choice hashes
 * the tile position, so the Burn never reshuffles and players can share routes. Re-running it overwrites hand
 * edits to the JSON. Run it after gen:far-woods (it checks its clock against the Far Woods' and the Near
 * Woods') and before gen:interiors. Usage: npm run gen:burn
 *
 * The night of the answer the woods lit up to the north "like a town", and up here they burned. South to
 * north: the way in comes up from the gate among the snags, the firs the fire left standing black; west, the
 * trapper's line cabin, which the fire went round, the one shelter (its fire burns down); north, the trail
 * fords the black creek and crosses the ash flats, where it burned hottest; from the cabin an old trap line
 * climbs north through the windfall, where the burned firs came down across each other; both end at the
 * scar, the heart, a long trench of bare ground fused to glass where the light came up, and the rocks along
 * it ring. It never rains here and no storm finds anything to catch, but the ground still flashes.
 *
 * It is burnt forest (`forest: 'burnt'`), drawn so by the client: bare black firs over grey ground. You
 * tire three times as fast here as at the same distance into the Near Woods (energy.ts, the depth).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DECOR, ENERGY_MAX, TileMap, doorOf, energyRate, maxEnergy, objectTiles, stormAt, surgeAt, validateMap, type MapData, type MapExit, type MapObject, type SurgeRule,
} from '../packages/shared/src';
import { BURN_WAY_HOME, FAR_WOODS_GATE, GATE_WIDTH } from './burn-gate';
import { doorInto } from './gen-interiors';

const W = 56, H = 72, SEED = 20261004;
type P = readonly [number, number];
/** The way home, on the bottom row: back through the gate, which opens from this side for anyone, onto the tiles below it in the Far Woods. */
const EXIT: MapExit = { x: BURN_WAY_HOME.x, y: BURN_WAY_HOME.y, w: GATE_WIDTH, h: 1, to: 'far-woods', tx: FAR_WOODS_GATE.x, ty: FAR_WOODS_GATE.y + 1, dir: 'down', home: true };

// Every random choice hashes the tile position (with the seed), as in gen-far-woods.ts.
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
/** Cuts ground out of the burnt forest. The map edge stays forest: the way home is the only way out. */
function set(x: number, y: number, c: string) { if (inner(x, y)) tile[y]![x] = c; }
/** Calls fn on the tiles of a rough ellipse; `rough` frays the edge so clearings do not look drawn. */
function ellipse(cx: number, cy: number, rx: number, ry: number, rough: number, salt: number, fn: (x: number, y: number, e: number) => void) {
  for (let y = Math.floor(cy - ry * 1.4); y <= Math.ceil(cy + ry * 1.4); y++) for (let x = Math.floor(cx - rx * 1.4); x <= Math.ceil(cx + rx * 1.4); x++) {
    const e = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
    if (inner(x, y) && e <= 1 + (noise(x, y, 2.5, salt) - 0.5) * 2 * rough) fn(x, y, e);
  }
}
const clearing = (cx: number, cy: number, rx: number, ry: number, salt: number) => ellipse(cx, cy, rx, ry, 0.35, salt, (x, y) => { if (at(x, y) === 't') set(x, y, 'g'); });
/** Ferns came back first after the fire, in the damp: few, where the skulkers lie. */
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

// The ways: water never cuts them (a ford where the creek meets one), and rock stands back from them.
const way = new Uint8Array(W * H);
/** A trail of ash-grey mud with tufts through the waypoints, one tile wide and a tile wider here and there. */
function trail(pts: P[], grass: number, salt: number) {
  const corners = [pts[0]!, ...pts.slice(1).flatMap((p, i) => stairs(pts[i]!, p, 3, salt * 16 + i))];
  for (const [x, y] of polyline(corners)) {
    const brush: P[] = noise(x, y, 3, salt) > 0.7 ? [[0, 0], [1, 0], [0, 1], [1, 1]] : [[0, 0]];
    for (const [dx, dy] of brush) {
      const tx = x + dx, ty = y + dy;
      if (!inner(tx, ty)) continue;
      set(tx, ty, noise(tx, ty, 2, salt + 1) < grass ? 'g' : 'm');
      way[ty * W + tx] = 1;
    }
  }
}
function water(x: number, y: number) { if (inner(x, y) && !way[y * W + x]) tile[y]![x] = 'w'; }
/** Raises bare rock on a tile off the ways: an outcrop, the scar's lips. */
function rock(x: number, y: number, lv: number) {
  if (!inner(x, y) || way[y * W + x] || at(x, y) === 'w') return;
  tile[y]![x] = 'l';
  level[y]![x] = Math.max(level[y]![x]!, lv);
}

// ---- The ground ----

// The way in: up from the gate between the snags to where the trail forks.
const ENTRY: P = [BURN_WAY_HOME.x, BURN_WAY_HOME.y - 1];
for (let x = EXIT.x; x < EXIT.x + EXIT.w; x++) { tile[EXIT.y]![x] = 'm'; tile[ENTRY[1]]![x] = 'm'; way[ENTRY[1] * W + x] = 1; }
trail([ENTRY, [28, 66], [28, 62]], 0.3, 10);
const SNAGS = { x: 28.5, y: 61.5 } as const;
clearing(SNAGS.x, SNAGS.y, 5, 3.4, 11);

// West from the snags, the trapper's line cabin, which the fire went round.
trail([[27, 61], [22, 58], [17, 55], [14, 52]], 0.3, 12);
/** The line cabin: its clearing, and the cabin on its north side (the room is in gen-interiors.ts). */
const CABIN = { x: 12, y: 48 } as const;
clearing(13.5, 51.5, 4.6, 3.2, 13);

// North from the snags the trail fords the black creek and crosses the ash flats to the scar.
trail([[29, 60], [30, 54], [31, 48], [32, 42], [35, 37]], 0.25, 14);
const FORD: P = [31, 45];
const FLATS = { x: 37.5, y: 31.5 } as const;
ellipse(FLATS.x, FLATS.y, 9, 6, 0.35, 15, (x, y) => { if (at(x, y) === 't') set(x, y, noise(x, y, 2.2, 16) < 0.4 ? 'm' : 'g'); });
trail([[36, 28], [34, 22], [31, 17], [30, 13]], 0.25, 17);

// The old trap line, north from the cabin through the windfall to the scar's west end: the other way in.
trail([[10, 51], [10, 45], [11, 41], [13, 35], [16, 29], [18, 23], [20, 17], [22, 12]], 0.3, 18);
const WINDFALL = { x: 16.5, y: 27.5 } as const;
clearing(WINDFALL.x, WINDFALL.y, 4.4, 3.6, 19);

// The scar, the heart: a trench of bare ground fused to glass, east to west, where the light came up out of it.
const SCAR = { x: 29.5, y: 10.5 } as const;
ellipse(SCAR.x, SCAR.y, 10.5, 2.6, 0.15, 30, (x, y) => set(x, y, 'l'));
ellipse(SCAR.x, SCAR.y + 2.4, 11.5, 2.2, 0.3, 31, (x, y) => { if (at(x, y) === 't') set(x, y, noise(x, y, 1.8, 32) < 0.5 ? 'm' : 'g'); });

// Water: the black creek, running west across the middle of the Burn, ash in its bed; a ford where the trail crosses.
const CREEK: P[] = [[54, 40], [46, 42], [38, 45], [26, 46], [18, 44], [8, 45], [1, 47]];
for (const [x, y] of polyline(CREEK)) water(x, y);
for (let x = FORD[0] - 2; x <= FORD[0] + 2; x++) water(x, FORD[1]);
// Banks: open ground and mud where the trails come down to the water, and by the pool below the windfall.
clearing(FORD[0], FORD[1] + 2.5, 3, 1.4, 40);
clearing(FORD[0] + 0.5, FORD[1] - 2, 2.6, 1.2, 41);
clearing(11.5, 44.5, 2.6, 1.6, 42);
clearing(19.5, 31.5, 2.8, 2.2, 44);
ellipse(19.5, 31.5, 1.2, 1, 0.3, 43, water);
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  if (at(x, y) !== 'g' && at(x, y) !== 'f') continue;
  if (SIDES.some(([dx, dy]) => at(x + dx, y + dy) === 'w')) set(x, y, 'm');
}

// Ferns, few: by the creek and the pool, where it stayed damp, and in the windfall's shade.
ferns(FORD[0] + 2, FORD[1] + 3, 1.8, 1.2, 50);
ferns(10.5, 44, 2, 1.2, 51);
ferns(WINDFALL.x - 1.5, WINDFALL.y + 1, 2.4, 1.8, 52);
ferns(FLATS.x + 6, FLATS.y - 3, 2, 1.5, 53);

// Rock: the scar's lips, raised along both sides of the trench but where the two ways come in, and outcrops.
const nearWay = (x: number, y: number, r: number) => { for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) if (inner(xx, yy) && way[yy * W + xx]) return true; return false; };
for (let y = 1; y < 18; y++) for (let x = 12; x < 48; x++) {
  const e = ((x + 0.5 - SCAR.x) / 12.5) ** 2 + ((y + 0.5 - SCAR.y) / 4.4) ** 2;
  if (at(x, y) !== 't' || e > 1 + (noise(x, y, 2, 60) - 0.5) * 0.4 || nearWay(x, y, 1)) continue;
  rock(x, y, e < 0.6 ? 2 : 1);
}
ellipse(42.5, 50.5, 2.4, 2, 0.3, 61, (x, y) => rock(x, y, 1));
ellipse(42.5, 50, 1.2, 1, 0.2, 62, (x, y) => rock(x, y, 2));
ellipse(8.5, 36.5, 2, 2.4, 0.3, 63, (x, y) => rock(x, y, 1));

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
  const queue: number[] = [];
  for (let x = EXIT.x; x < EXIT.x + EXIT.w; x++) { d[ENTRY[1] * W + x] = 1; queue.push(ENTRY[1] * W + x); }
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

// The line cabin, the one shelter: its fire burns down (gen-interiors.ts), so whoever passes feeds it.
const cabin = { kind: 'house', x: CABIN.x, y: CABIN.y, w: 3, h: 2, roof: '#3d3530', lit: 1 } as const;
must(cabin);
must({ kind: 'woodpile', x: CABIN.x + 3, y: CABIN.y + 1 });
const doors = [doorInto('burn-line-cabin', 'burn', cabin)];
const front = ((d): P => [d.x, d.y + 1])(doorOf(cabin));

/** A sign beside the way near `p`: the nearest open ground off the ways with room in front of it to read it from, and cutting nobody off. */
const signs: Array<{ x: number; y: number }> = [];
function signNear(p: P, text: string[], style?: 'napo') {
  const spots: Array<[number, number, number]> = [];
  for (let y = p[1] - 3; y <= p[1] + 3; y++) for (let x = p[0] - 3; x <= p[0] + 3; x++) {
    if (walkable(x, y) && !way[y * W + x] && walkable(x, y + 1) && !signs.some(s => Math.abs(s.x - x) + Math.abs(s.y - y) < 2)) spots.push([Math.hypot(x - p[0], y - p[1]), x, y]);
  }
  spots.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const spot = spots.find(([, x, y]) => tryPlace({ kind: 'sign', x, y, text, ...(style && { style }) }));
  if (!spot) throw new Error(`no room for a sign near ${p.join(',')}`);
  signs.push({ x: spot[1], y: spot[2] });
}
// The trapper's blaze on a charred post: what his line was, before.
signNear([27, 60], ['Burned into the post: "North line. Cabin west."', 'Scratched under it, newer: "Two to a line. Nothing sets past the creek."']);
// And his blazes farther along, cut after the fire: at the ford, at the windfall, and on a cairn at the scar.
signNear([31, 42], ['Cut into a charred post: "Black creek. Ash in it. Boil it twice, or go thirsty."']);
signNear([17, 31], ['Cut into a stump: "The line is under all this now. Went round by the pool."']);
signNear([31, 14], ['A tin plate wired to a cairn of glassy stones, scratched: "Where it came up."', '"The ground rang for a week after. Do not sleep here. Do not come alone."']);

// What NAPO left: after the answer its crews came through the gate in pairs and surveyed up the trail, and
// stopped at the ash flats, where their needles went off the scale. Their stakes run up beside the trail from
// the snags and end there, and the relay mast they set up at the flats stands snapped halfway, its notice
// beside it. Past the last stake NAPO never went (Vera: "farther in than NAPO ever went").
const MAST: P = [42, 30];
must({ kind: 'antenna', x: MAST[0], y: MAST[1], broken: true });
signNear([40, 32], ['NAPO · Survey line N-1 · Relay mast N-1a', 'Needles off the scale north of the last stake. Crew withdrawn to the gate.', 'Nobody past the last stake. Two-person rule.'], 'napo');
/** Stakes block nothing, so they sit beside the trail: the nearest open tile off the way to each point, or a snag's tile beside the way, cleared. */
const stakes: P[] = [];
for (const p of [[28, 58], [30, 53], [31, 48], [32, 41], [34, 37], [36, 33], [36, 28]] as const) {
  let best: [number, number, number] | undefined;
  for (let y = p[1] - 2; y <= p[1] + 2; y++) for (let x = p[0] - 2; x <= p[0] + 2; x++) {
    if (!inner(x, y) || way[y * W + x] || blocked[y * W + x] || level[y]![x]! > 0) continue;
    if (!'gm'.includes(at(x, y)) && !(at(x, y) === 't' && SIDES.some(([dx, dy]) => way[(y + dy) * W + x + dx]))) continue;
    const d = Math.hypot(x - p[0], y - p[1]) + hash(x, y, 64) * 0.01;
    if (!best || d < best[0]) best = [d, x, y];
  }
  if (!best) throw new Error(`no room for NAPO's stake near ${p.join(',')}`);
  if (at(best[1], best[2]) === 't') set(best[1], best[2], 'g');
  place({ kind: 'stake', x: best[1], y: best[2] });
  stakes.push([best[1], best[2]]);
}

// The rocks that ring: in a line down the middle of the scar, faintly aglow, where the light came up.
for (let k = 0; k < 9; k++) {
  const x = Math.round(SCAR.x - 8 + k * 2 + (hash(k, 0, 70) - 0.5) * 1.2), y = Math.round(SCAR.y - 0.5 + (hash(k, 1, 70) - 0.5) * 1.6);
  if (walkable(x, y)) tryPlace({ kind: 'rock', x, y, s: round(0.95 + hash(x, y, 71) * 0.45), v: round(hash(x, y, 72)), hum: true });
}
// Loose rock along the scar's lips and the outcrops.
for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
  const raised = level[y]![x]! > 0;
  const foot = !raised && walkable(x, y) && !way[y * W + x] && SIDES.some(([dx, dy]) => level[y + dy]![x + dx]! > 0);
  if ((raised && hash(x, y, 73) < 0.08) || (foot && hash(x, y, 74) < 0.18)) tryPlace({ kind: 'rock', x, y, s: round(0.7 + hash(x, y, 75) * 0.6), v: round(hash(x, y, 76)) });
}

// Glowcaps, few: in the damp by the ford and the pool, and under the windfall.
const SHROOMS: Array<[number, number, number]> = [[FORD[0] + 1, FORD[1] + 2, 1.4], [19.5, 33.5, 1.5], [WINDFALL.x + 1, WINDFALL.y - 1, 1.2]];
const shroomAt = new Set<number>();
for (const [cx, cy, r] of SHROOMS) {
  const spots: Array<[number, number, number]> = [];
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    if (Math.hypot(x - cx, y - cy) <= r && walkable(x, y) && !way[y * W + x]) spots.push([hash(x, y, 80), x, y]);
  }
  if (!spots.length) throw new Error(`no open ground for glowcaps around ${cx},${cy}`);
  spots.sort((a, b) => a[0] - b[0]);
  for (const [, x, y] of spots.slice(0, 2)) { place({ kind: 'shrooms', x, y }); shroomAt.add(y * W + x); }
}

// The windfall: burned firs down across each other, in decks of fallen trunks.
for (const [x, y, w, h] of [[12, 25, 3, 1], [19, 28, 1, 3], [13, 30, 2, 1], [19, 24, 2, 1]] as const) {
  const o = { kind: 'logs', x, y, w, h } as const;
  if (!objectTiles(o).some(([tx, ty]) => way[ty * W + tx])) tryPlace(o);
}

// Snags standing alone in the clearings (the burnt firs, drawn black), and burned stumps where they fell: never
// in front of a sign or a door, or next to another thing, so the spots people gather at stay open.
const keepOpen = new Set<number>([front[1] * W + front[0]]);
for (const s of signs) keepOpen.add((s.y + 1) * W + s.x);
for (const [x, y] of stakes) keepOpen.add(y * W + x);
function open(x: number, y: number): boolean {
  if (!walkable(x, y) || way[y * W + x] || keepOpen.has(y * W + x) || shroomAt.has(y * W + x) || at(x, y) === 'l') return false;
  for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (blocked[yy * W + xx]) return false;
  return true;
}
for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
  if (!open(x, y)) continue;
  const edge = SIDES.some(([dx, dy]) => at(x + dx, y + dy) === 't');
  if (!edge && hash(x, y, 90) < 0.05) tryPlace({ kind: 'tree', x, y, s: round(1.1 + hash(x, y, 91) * 0.5), v: round(hash(x, y, 92)) });
  else if (hash(x, y, 93) < 0.09) tryPlace({ kind: 'stump', x, y, s: round(0.9 + hash(x, y, 94) * 0.5), v: round(hash(x, y, 95)), burned: true });
}

// The places worth walking to. Each must be reachable, or the clean-up below would quietly turn it back into forest.
const PLACES: Array<[string, P]> = [
  ['the snags', [Math.floor(SNAGS.x), Math.floor(SNAGS.y)]], ['the line cabin', front], ['the black creek', [FORD[0], FORD[1] + 2]],
  ['the ash flats', [Math.floor(FLATS.x), Math.floor(FLATS.y)]], ['the windfall', [Math.floor(WINDFALL.x), Math.floor(WINDFALL.y) + 2]], ['the scar', [Math.floor(SCAR.x), Math.floor(SCAR.y) + 2]],
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
  for (let i = objects.length - 1; i >= 0; i--) { const o = objects[i]!; if ((o.kind === 'shrooms' || o.kind === 'stump' || o.kind === 'tree') && at(o.x, o.y) === 't') objects.splice(i, 1); }
}

// ---- Tall grass ----

// Fireweed, knee-high, the first thing back after a fire: a few patches beside the ways a chased player runs along.
const fromHome = stepsHome();
function tallMay(x: number, y: number): boolean {
  const i = y * W + x;
  if (at(x, y) !== 'g' || way[i] || !walkable(x, y) || shroomAt.has(i) || keepOpen.has(i) || fromHome[i]! < 0) return false;
  return !PLACES.some(([, [px, py]]) => Math.hypot(px - x, py - y) <= 1.5);
}
const TALL: Array<{ near: P; size: number }> = [
  { near: [32, 30], size: 6 },
  { near: [42, 28], size: 5 },
  { near: [36, 13], size: 4 },
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

// Every 40 minutes like every region the woods answer from, and short, as the Burn is small: restless for 3
// minutes from the top of the Tower's round, a surge from 3:00 to 5:00. The only time left clear by both the
// Far Woods (restless from 5:00, a storm from 24:00, in autumn from 14:00 and 34:00) and the Near Woods (a
// surge until the round is over): the way up through all three meets one at a time. The front takes a minute
// and a half from the scar to the way home. No storm: nothing left standing up here for one to catch.
const SURGE: SurgeRule = { every: 2400, unstable: 180, surge: 120, sweep: 90, offset: 2100 };

const map: MapData = {
  id: 'burn', name: 'The Burn', version: 2, kind: 'wilds', depth: 3, width: W, height: H,
  tiles: tile.map(r => r.join('')),
  levels: level.map(r => r.join('')),
  spawn: { x: ENTRY[0], y: ENTRY[1] - 1, dir: 'up' },
  exits: [EXIT, ...doors],
  objects,
  // It never rains on the Burn: the fire took what held the damp.
  rain: [],
  surge: SURGE,
  // Every 40 seconds, a flash near someone 10 steps or more in: the ground still remembers the light.
  flashes: { every: 40, steps: [10, 999] },
  // Five watchers past the creek, quicker than the Far Woods'.
  watchers: { count: 5, steps: [40, 999], stepMs: 430 },
  // Three skulkers in the few ferns, from the creek on, at night only (no storm comes), quicker still.
  skulkers: { count: 3, steps: [25, 999], when: ['night'], stepMs: 224 },
  places: PLACES.filter(([name]) => name !== 'the line cabin').map(([name, [x, y]]) => ({ name, x, y })),
  forest: 'burnt',
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
const out = resolve(import.meta.dirname, '../content/maps/burn.json');
writeFileSync(out, json);

// A glance at the result, two map rows per line (a terminal character is about twice as tall as wide).
const GLYPH: Partial<Record<MapObject['kind'], string>> = { sign: '!', house: 'H', tree: 'T', rock: 'o', shrooms: ',', woodpile: 'b', logs: '#', stump: 'x', stake: '!', antenna: 'A' };
const TILE_GLYPH: Record<string, string> = { t: ' ', w: '~', f: '"', h: ';', m: '.', g: '.', l: '_' };
const objGlyph = new Map<number, string>();
for (const o of objects) for (const [x, y] of objectTiles(o)) objGlyph.set(y * W + x, o.kind === 'rock' && o.hum ? '*' : GLYPH[o.kind] ?? '?');
const glyph = (x: number, y: number) => (y === EXIT.y && x >= EXIT.x && x < EXIT.x + EXIT.w ? 'v' : objGlyph.get(y * W + x) ?? (level[y]![x]! > 0 ? '^' : TILE_GLYPH[tile[y]![x]!]!));
const rows = [`+${'-'.repeat(W)}+`];
for (let y = 0; y < H; y += 2) rows.push(`|${Array.from({ length: W }, (_, x) => { const a = glyph(x, y), b = glyph(x, y + 1); return a === ' ' || a === '.' ? b : a; }).join('')}|`);
console.log([...rows, rows[0]].join('\n'));
console.log(' . ground  _ fused ground  " ferns  ; fireweed  ~ water  ^ rock  H cabin  o rock  * ringing rock  x burned stump  ! NAPO stake  A NAPO mast  # windfall  T snag  , shrooms  v way home');

// How deep it goes, measured like the game does (TileMap.homeSteps drives the energy drain).
const tm = new TileMap(map);
const steps = new Int32Array(W * H).map((_, i) => tm.homeSteps(i % W, (i / W) | 0));
const deepest = Math.max(...steps);
const count = (k: MapObject['kind']) => objects.filter(o => o.kind === k).length;
console.log(`wrote ${out}: ${W}x${H} tiles, ${objects.length} objects (${count('rock')} rocks, ${count('tree')} snags, ${count('stump')} stumps, ${count('shrooms')} shrooms, ${count('stake')} of NAPO's stakes)`);
console.log(`steps from the way home: ${PLACES.map(([name, p]) => `${name} ${stepsTo(steps, p)}`).join(', ')}; deepest ${deepest}`);
const lairs = steps.filter((v, i) => tile[(i / W) | 0]![i % W] === 'f' && v >= map.skulkers!.steps[0]).length;
console.log(`ferns ${map.skulkers!.steps[0]} steps or more in: ${lairs} tiles; watchers wake on ${tm.lairs(map.watchers!.steps).length}`);
console.log(`fireweed, ${patches.length} patches: ${patches.map((p, k) => `near ${TALL[k]!.near.join(',')} ${Math.min(...p.map(i => steps[i]!))}-${Math.max(...p.map(i => steps[i]!))} steps`).join(', ')}`);
const lasts = (x: number, y: number, lvl = 1) => (maxEnergy(lvl) / -energyRate(tm, x, y, 'night')).toFixed(0);
const deep = steps.indexOf(deepest);
console.log(`a full bar at night lasts ${lasts(ENTRY[0], ENTRY[1])} s at the edge (level 15: ${lasts(ENTRY[0], ENTRY[1], 15)} s), ${lasts(deep % W, (deep / W) | 0)} s at the deepest spot (level 15: ${lasts(deep % W, (deep / W) | 0, 15)} s); a level 1 bar is ${ENERGY_MAX}`);

// Its clock never runs together with the Far Woods' or the Near Woods', in any season: a trip meets one at a time.
{
  const load = (id: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, `../content/maps/${id}.json`), 'utf8')) as MapData;
  const busy = (m: Pick<MapData, 'surge' | 'storm'>, wall: number, season: 'spring' | 'autumn') => (m.surge ? surgeAt(m.surge, wall).phase !== 'calm' : false) || (m.storm ? stormAt(m.storm, wall, season).phase !== 'clear' : false);
  for (const other of [load('far-woods'), load('near-woods')]) for (const season of ['spring', 'autumn'] as const) for (let s = 0; s < 2400; s++) {
    if (busy(map, s * 1000, season) && busy(other, s * 1000, season)) throw new Error(`the Burn's surge runs into ${other.name}' clocks ${s} s into a round in ${season}`);
  }
}
const problems = validateMap(map);
for (const p of problems) console.log(`${p.level}: ${p.message}`);
if (problems.some(p => p.level === 'error')) process.exit(1);
