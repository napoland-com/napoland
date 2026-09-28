/**
 * Generates content/maps/south-road.json, the South Road: the other way out of Stonebrook, down its
 * south road through what NAPO left behind (docs/DESIGN.md, the story). Built from a fixed seed like
 * the Near Woods (gen-woods.ts), and every random choice hashes the tile position, so the road never
 * reshuffles and players can share routes. Re-running it overwrites hand edits to the JSON. Usage:
 * npm run gen:south
 *
 * North to south: the road leaves town past NAPO's first warning sign. East of it stands the NAPO
 * Bunker, whose fire Ruth keeps going (so a new player has one safe fire on this road too); west, at
 * the end of a short trail, the camp the leavers made. Then the cars people left on the shoulders;
 * the NAPO Research Station in its fenced yard west of the road (the laboratory, where Vera is, the
 * dormitory and the stores); the NAPO Tower in its fence east of it, with its shed and a ridge behind;
 * a bog west (the sinks) and NAPO's field site east; and at the end the checkpoint on the quarantine
 * line, where a barrier and a truck close the road. No surges, storms or flashes (no surge, storm or
 * flashes rule), and nothing watches from its trees: the danger is how far it goes. Its rain is its own
 * (`rain`): later in the day than the Near Woods', and shorter.
 *
 * Energy only comes back by a fire: the bunker's (tended), the camp's, the laboratory's, the
 * dormitory's and the checkpoint's (these burn down unless someone feeds them). The rooms are in
 * gen-interiors.ts, each with a crate for whoever comes next; the camp keeps one by its fire in the
 * open, placed after everything else so that nothing on the road moves for it.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENERGY_MAX, LAMP_RADIUS, TileMap, doorOf, energyRate, objectTiles, validateMap, type MapData, type MapExit, type MapObject } from '../packages/shared/src';
import { doorInto } from './gen-interiors';

const W = 72, H = 96, SEED = 20260928;
type P = readonly [number, number];
/** Stonebrook's south road arrives on 35,1 and 36,1; the top row leads back to it. */
const EXIT: MapExit = { x: 35, y: 0, w: 2, h: 1, to: 'stonebrook', tx: 11, ty: 42, dir: 'up', home: true };

// Every random choice hashes the tile position (with the seed), as in gen-woods.ts, so moving one
// clearing does not reshuffle the rest of the road.
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
/** A clearing of grass; it never breaks up the road. */
const clearing = (cx: number, cy: number, rx: number, ry: number, salt: number) => ellipse(cx, cy, rx, ry, 0.35, salt, (x, y) => { if (at(x, y) !== 'r') set(x, y, 'g'); });
/** Fern patches grow on open grass. */
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

// The ways (road, tracks, trails, the lane across the station's yard): water never cuts them, and
// poles stand beside them.
const way = new Uint8Array(W * H);
const BRUSH: Record<number, P[]> = {
  1: [[0, 0]],
  2: [[0, 0], [1, 0], [0, 1], [1, 1]],
  3: [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]],
};
/** A trail of mud with tufts of grass through the waypoints, `width` tiles wide and a tile wider here and there. */
function trail(pts: P[], width: 1 | 2, grass: number, salt: number, run = 3) {
  const corners = [pts[0]!, ...pts.slice(1).flatMap((p, i) => stairs(pts[i]!, p, run, salt * 16 + i))];
  for (const [x, y] of polyline(corners)) {
    const w = noise(x, y, 3, salt) > 0.68 ? width + 1 : width;
    for (const [dx, dy] of BRUSH[w]!) {
      const tx = x + dx, ty = y + dy;
      if (!inner(tx, ty)) continue;
      if (at(tx, ty) !== 'r' && at(tx, ty) !== 'l') set(tx, ty, noise(tx, ty, 2, salt + 1) < grass ? 'g' : 'm');
      way[ty * W + tx] = 1;
    }
  }
}
function water(x: number, y: number) { if (inner(x, y) && !way[y * W + x]) tile[y]![x] = 'w'; }

// ---- The ground ----

// The road: two lanes of asphalt from the edge of town to the checkpoint, grass shoulders, the firs
// close on both sides. South of the station nobody has kept it, and it breaks up. Past the barrier it
// goes on a little, under what closes it.
const ROAD_END = 90;
for (let y = 0; y <= ROAD_END; y++) for (const x of [35, 36]) { tile[y]![x] = 'r'; way[y * W + x] = 1; }
for (let y = 1; y <= 87; y++) { set(34, y, 'g'); set(37, y, 'g'); }
for (let y = 60; y <= 86; y++) for (const x of [35, 36]) if (hash(x, y, 14) < 0.2) tile[y]![x] = noise(x, y, 2, 15) < 0.4 ? 'g' : 'm';

// The NAPO Bunker, east of the road, and the track to it.
clearing(42.5, 17.5, 4.2, 3.2, 20);
trail([[37, 18], [40, 18]], 2, 0.3, 21);

// West of the road, the camp the leavers made on their way out.
trail([[34, 22], [30, 22], [25, 21]], 1, 0.4, 22);
clearing(22.5, 22, 4, 3, 23);
ferns(19, 20.5, 1.8, 1.6, 24);

// Where the cars stopped: pull-offs of gravel and mud on both shoulders.
for (const [cx, cy, salt] of [[31.5, 28.5, 30], [39.5, 31.5, 31], [31.5, 35, 32]] as const) {
  ellipse(cx, cy, 2.8, 1.9, 0.25, salt, (x, y) => { if (at(x, y) === 'r') return; set(x, y, noise(x, y, 1.6, salt + 5) < 0.5 ? 'l' : 'm'); way[y * W + x] = 1; });
}

// The NAPO Research Station: a gravel yard west of the road inside a fence, a gate and a track onto
// the road, a lane across the yard, and a back gate to the sinks.
const YARD = { x0: 19, y0: 38, x1: 32, y1: 55 };
for (let y = YARD.y0; y <= YARD.y1; y++) for (let x = YARD.x0; x <= YARD.x1; x++) set(x, y, 'l');
for (let y = 45; y <= 47; y++) for (const x of [33, 34]) { set(x, y, 'l'); way[y * W + x] = 1; }
for (let x = 22; x <= 31; x++) way[45 * W + x] = 1;

// East: the NAPO Tower's clearing, a rocky ridge behind it, and the track out to it.
trail([[37, 49], [42, 49], [45, 47]], 2, 0.3, 40);
clearing(50.5, 48, 6.5, 5, 41);
ellipse(62, 46, 3.2, 5.2, 0.3, 42, (x, y) => { level[y]![x] = 1; set(x, y, 'l'); });
ellipse(62.5, 45.5, 1.6, 3, 0.2, 43, (x, y) => { level[y]![x] = 2; });

// West behind the station, the sinks: a bog of pools, mud and ferns, and a trail back to the road.
trail([[25, 56], [22, 60], [18, 63]], 1, 0.35, 50);
clearing(15, 65.5, 5.5, 4.6, 51);
ferns(11.5, 64, 2.2, 3, 52);
trail([[19, 68], [24, 70], [29, 70], [34, 71]], 1, 0.4, 53);

// East: NAPO's field site, a scorched gravel clearing at the end of a trail, and a trail north from it
// back to the Tower (the east loop).
trail([[37, 66], [42, 67], [48, 71]], 1, 0.3, 60);
ellipse(51.5, 71, 5, 4, 0.3, 61, (x, y) => set(x, y, noise(x, y, 1.8, 62) < 0.35 ? 'm' : 'l'));
trail([[53, 67], [54, 60], [51, 51]], 1, 0.35, 63);

// The checkpoint: the road widens into a gravel lot before the barrier.
ellipse(36, 84.5, 6.2, 3.8, 0.25, 70, (x, y) => { if (at(x, y) !== 'r') set(x, y, 'l'); way[y * W + x] = 1; });

// Water: the sinks' pools. Banks are mud: the tiles next to water, and a ragged band a little farther out.
ellipse(15, 66.5, 1.8, 1.2, 0.3, 100, water);
ellipse(18.5, 63.5, 1, 0.8, 0.3, 101, water);
ellipse(11.5, 68.5, 1.1, 0.9, 0.3, 102, water);
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  if (at(x, y) !== 'g' && at(x, y) !== 'f') continue;
  let d = 9;
  for (let yy = y - 2; yy <= y + 2; yy++) for (let xx = x - 2; xx <= x + 2; xx++) if (at(xx, yy) === 'w') d = Math.min(d, Math.max(Math.abs(xx - x), Math.abs(yy - y)));
  if (d === 1 || (d === 2 && noise(x, y, 1.5, 101) < 0.45)) set(x, y, 'm');
}

// ---- Things ----

const objects: MapObject[] = [];
const blocked = new Uint8Array(W * H);
/** Adds an object. Things stand on cleared ground: a forest or water tile under one becomes grass. */
function place(o: MapObject) {
  for (const [x, y] of objectTiles(o)) {
    if (!inner(x, y)) throw new Error(`${o.kind} at ${o.x},${o.y} is on the map edge`);
    if (o.kind === 'shrooms') continue;
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

// NAPO's buildings, each with a room of its own. The bunker and the laboratory are lit: Ruth and
// Vera are in. The dormitory and the checkpoint keep fires but nobody; the stores and the tower
// shed are dark and cold.
const BUILDINGS = [
  { x: 41, y: 14, w: 3, h: 2, lit: 1, inside: 'south-road-bunker' },
  { x: 21, y: 40, w: 5, h: 3, lit: 1, inside: 'south-road-laboratory' },
  { x: 27, y: 40, w: 3, h: 2, lit: 0, inside: 'south-road-dormitory' },
  { x: 21, y: 50, w: 3, h: 2, lit: 0, inside: 'south-road-stores' },
  { x: 45, y: 43, w: 3, h: 2, lit: 0, inside: 'south-road-tower-shed' },
  { x: 39, y: 82, w: 3, h: 2, lit: 0, inside: 'south-road-checkpoint' },
] as const;
const buildings = BUILDINGS.map(b => ({ kind: 'house', x: b.x, y: b.y, w: b.w, h: b.h, roof: '#4d5255', lit: b.lit, style: 'napo' }) as const);
for (const b of buildings) place(b);
const doors = buildings.map((b, i) => doorInto(BUILDINGS[i]!.inside, 'south-road', b));
/** The tile in front of each building's door, where you come out. */
const fronts = buildings.map((b): P => { const d = doorOf(b); return [d.x, d.y + 1]; });

// The station's fence, with its gate onto the road (x 32, y 45 to 47) and its back gate (x 25 and 26).
for (let x = YARD.x0; x <= YARD.x1; x++) {
  must({ kind: 'fence', x, y: YARD.y0, dir: 'h' });
  if (x !== 25 && x !== 26) must({ kind: 'fence', x, y: YARD.y1, dir: 'h' });
}
for (let y = YARD.y0 + 1; y < YARD.y1; y++) {
  must({ kind: 'fence', x: YARD.x0, y, dir: 'v' });
  if (y < 45 || y > 47) must({ kind: 'fence', x: YARD.x1, y, dir: 'v' });
}
// The Tower in its own fence, the gate on the south side.
const TOWER: P = [51, 47];
for (let x = 49; x <= 53; x++) for (let y = 45; y <= 49; y++) {
  const edge = x === 49 || x === 53 || y === 45 || y === 49;
  if (edge && !(x === 51 && y === 49)) must({ kind: 'fence', x, y, dir: y === 45 || y === 49 ? 'h' : 'v' });
}
must({ kind: 'antenna', x: TOWER[0], y: TOWER[1] });
// A smaller mast at the field site, where NAPO listened closest.
must({ kind: 'antenna', x: 54, y: 70 });

const signs: Array<Extract<MapObject, { kind: 'sign' }>> = [
  { kind: 'sign', x: 37, y: 5, text: ['The South Road', 'NAPO\'s old grounds. The farther you go, the faster you tire.', 'Ruth keeps the bunker\'s fire going. Feed the others.'] },
  { kind: 'sign', x: 34, y: 9, style: 'napo', text: ['NAPO · National Anomalous Phenomena Observatory', 'Restricted grounds. Staff only past this point.'] },
  { kind: 'sign', x: 44, y: 17, style: 'napo', text: ['NAPO Bunker', 'Shelter for staff during events.'] },
  { kind: 'sign', x: 37, y: 24, text: ['Everyone left down this road.', 'Some of them got as far as here.'] },
  { kind: 'sign', x: 31, y: 43, style: 'napo', text: ['NAPO Research Station', 'All visitors report to the front desk.'] },
  { kind: 'sign', x: 52, y: 50, style: 'napo', text: ['NAPO Tower', 'Danger: high voltage. Do not climb.'] },
  { kind: 'sign', x: 47, y: 69, style: 'napo', text: ['NAPO field site', 'Instruments in use. Keep out.'] },
  { kind: 'sign', x: 33, y: 86, style: 'napo', text: ['NAPO · Quarantine line', 'No one passes, in or out. By order of the Observatory.', 'Under it, in marker: "They said two weeks."'] },
];
for (const s of signs) must(s);

// Floodlights: the bunker's door, the station's yard, the checkpoint. The lights only help you see.
const lamps: P[] = [[39, 17], [30, 43], [26, 48], [38, 86]];
for (const [x, y] of lamps) must({ kind: 'lamp', x, y });

// The camp's fire, out in the open: it burns down unless someone feeds it.
const CAMP: P = [22, 22];
must({ kind: 'fireplace', x: CAMP[0], y: CAMP[1], name: 'the leavers\' camp' });

// What people left: the cars on the shoulders, NAPO's van in the yard, its trucks at the checkpoint,
// the one parked across the road behind the barrier; barrels and crates of NAPO equipment.
for (const [x, y] of [[30, 28], [39, 31], [30, 34], [28, 49], [31, 83]] as const) place({ kind: 'car', x, y, w: 2 });
// The barrier closes the road on purpose, so it is placed without the check that nothing is cut off;
// what it cuts off is covered (barrels, the truck) or goes back to forest in the clean-up.
for (let x = 33; x <= 38; x++) place({ kind: 'fence', x, y: 88, dir: 'h' });
for (const x of [35, 36]) place({ kind: 'barrel', x, y: 89 });
place({ kind: 'car', x: 35, y: 90, w: 2 });
for (const [x, y] of [[40, 15], [44, 15], [25, 20], [33, 29], [41, 32], [25, 53], [30, 53], [32, 87], [39, 87]] as const) must({ kind: 'barrel', x, y });
for (const [x, y] of [[19, 23], [26, 51], [27, 51], [27, 52], [30, 51], [29, 53], [47, 46], [50, 72], [52, 69], [42, 85]] as const) must({ kind: 'crate', x, y });

// Spots people gather at stay open: lamps' light, the fronts of signs and doors, around the fire.
const keepOpen = new Set<number>();
for (const [lx, ly] of lamps) for (let y = ly - 3; y <= ly + 3; y++) for (let x = lx - 3; x <= lx + 3; x++) if (Math.hypot(x - lx, y - ly) <= LAMP_RADIUS + 0.5) keepOpen.add(y * W + x);
for (const s of signs) keepOpen.add((s.y + 1) * W + s.x);
for (const [x, y] of fronts) keepOpen.add(y * W + x);
for (let y = CAMP[1] - 2; y <= CAMP[1] + 2; y++) for (let x = CAMP[0] - 2; x <= CAMP[0] + 2; x++) keepOpen.add(y * W + x);

// NAPO's power line runs down the road from town and out along the track to the Tower's shed; a
// second line crosses the station's yard to the laboratory. Each is listed in order along it (the
// renderer strings wires between poles next to each other in the list, and none between the two
// lines: they end more than 10 tiles apart). Each pole goes on the free tile nearest its mark that
// stands beside a way, never on it.
const LINES: P[][] = [
  [[38, 4], [38, 11], [38, 21], [38, 28], [38, 35], [38, 42], [39, 48], [43, 50], [46, 46]],
  [[33, 44], [28, 44], [24, 44]],
];
for (const [px, py] of LINES.flat()) {
  const spots: Array<[number, number, number]> = [];
  for (let y = py - 2; y <= py + 2; y++) for (let x = px - 2; x <= px + 2; x++) {
    if (!inner(x, y) || way[y * W + x] || blocked[y * W + x] || keepOpen.has(y * W + x) || level[y]![x] || at(x, y) === 'w') continue;
    if (SIDES.some(([dx, dy]) => way[(y + dy) * W + x + dx])) spots.push([Math.hypot(x - px, y - py), x, y]);
  }
  spots.sort((a, b) => a[0] - b[0] || b[1] - a[1] || a[2] - b[2]);
  if (!spots.some(([, x, y]) => tryPlace({ kind: 'pole', x, y }))) throw new Error(`no room for a pole near ${px},${py}`);
}

// Rocks on and around the ridge, and a ring of scorched stones at the field site.
for (let y = 38; y <= 54; y++) for (let x = 56; x <= 67; x++) {
  const raised = level[y]![x]! > 0;
  const foot = !raised && walkable(x, y) && SIDES.some(([dx, dy]) => level[y + dy]![x + dx]! > 0);
  if ((raised && hash(x, y, 120) < 0.3) || (foot && hash(x, y, 121) < 0.35)) tryPlace({ kind: 'rock', x, y, s: round(0.75 + hash(x, y, 122) * 0.5), v: round(hash(x, y, 123)) });
}
for (let k = 0; k < 9; k++) {
  const a = (k / 9) * Math.PI * 2, x = Math.floor(51.5 + Math.cos(a) * 3.4), y = Math.floor(71 + Math.sin(a) * 2.6);
  if (walkable(x, y) && !keepOpen.has(y * W + x) && !way[y * W + x]) tryPlace({ kind: 'rock', x, y, s: round(0.6 + hash(x, y, 124) * 0.3), v: round(hash(x, y, 125)) });
}

// Glowcaps grow in damp spots away from the lights: the camp, the sinks' banks, the foot of the
// ridge, the field site's edge. A patch takes some of the open ground around its center.
const SHROOMS: Array<[number, number, number]> = [
  [19, 21.5, 1.4], [45, 20, 1.2], [14, 62.5, 1.6], [17.5, 68.5, 1.4], [9.5, 66, 1.4], [55, 51, 1.4], [47.5, 74, 1.4],
];
const shroomAt = new Set<number>();
for (const [cx, cy, r] of SHROOMS) {
  const spots: Array<[number, number, number]> = [];
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    if (Math.hypot(x - cx, y - cy) <= r && walkable(x, y) && !way[y * W + x] && !keepOpen.has(y * W + x)) spots.push([hash(x, y, 130), x, y]);
  }
  if (!spots.length) throw new Error(`no open ground for glowcaps around ${cx},${cy}`);
  spots.sort((a, b) => a[0] - b[0]);
  const n = Math.max(2, spots.filter(s => s[0] < 0.6).length);
  for (const [, x, y] of spots.slice(0, n)) { place({ kind: 'shrooms', x, y }); shroomAt.add(y * W + x); }
}

// Lone firs in the clearings and loose rocks along their edges, never on a way, in a spot people
// gather at, or right next to another thing. The station's yard and the checkpoint stay gravel.
function open(x: number, y: number): boolean {
  if (!walkable(x, y) || way[y * W + x] || keepOpen.has(y * W + x) || shroomAt.has(y * W + x) || at(x, y) === 'l') return false;
  for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (blocked[yy * W + xx]) return false;
  return true;
}
for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
  if (!open(x, y)) continue;
  const edge = SIDES.some(([dx, dy]) => at(x + dx, y + dy) === 't');
  if (!edge && (at(x, y) === 'g' || at(x, y) === 'f') && x !== 34 && x !== 37 && hash(x, y, 140) < 0.07) tryPlace({ kind: 'tree', x, y, s: round(0.95 + hash(x, y, 141) * 0.5), v: round(hash(x, y, 142)) });
  else if (edge && hash(x, y, 143) < 0.035) tryPlace({ kind: 'rock', x, y, s: round(0.55 + hash(x, y, 144) * 0.45), v: round(hash(x, y, 145)) });
}

// The places worth walking to. Each must be reachable, or the clean-up below would quietly turn it
// back into forest.
const PLACES: Array<[string, P]> = [
  ['first sign', [37, 6]], ['bunker door', fronts[0]!], ['camp fire', CAMP], ['cars', [31, 28]], ['station gate', [33, 46]],
  ['laboratory door', fronts[1]!], ['dormitory door', fronts[2]!], ['stores door', fronts[3]!], ['tower shed door', fronts[4]!],
  ['tower gate', [51, 50]], ['sinks', [15, 64]], ['field site', [51, 71]], ['checkpoint door', fronts[5]!], ['barrier', [35, 87]],
];
const stepsTo = (d: Int32Array, [x, y]: P) => Math.min(...[[0, 0] as P, ...SIDES].map(([dx, dy]) => d[(y + dy) * W + x + dx]!).filter(v => v >= 0));
{
  const d = stepsHome();
  const lost = PLACES.filter(([, p]) => stepsTo(d, p) === Infinity).map(([name]) => name);
  if (lost.length) throw new Error(`cut off from the way home: ${lost.join(', ')}`);
}

// Walkable ground nobody can reach from the road (a stray tile the noise opened, the road past the
// barrier) goes back to forest.
{
  const d = stepsHome();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (walkable(x, y) && d[y * W + x]! < 0) tile[y]![x] = 't';
  for (let i = objects.length - 1; i >= 0; i--) { const o = objects[i]!; if (o.kind === 'shrooms' && at(o.x, o.y) === 't') objects.splice(i, 1); }
}

// ---- What the leavers and NAPO left (roadmap/richer-places.md) ----

// Added last, so nothing that was here moves: the road, the buildings, the poles, the lamps, the fire,
// the signs and the named places stay where they were, and every tile anyone could walk on stays
// walkable and just as far from home (the checks below stop the script otherwise). What blocks
// stands on forest it clears; new ground is a dead end off the road, so it makes no shortcut.
const beforeTiles = tile.map(r => r.join('')), beforeSteps = stepsHome();
/** Cuts one tile of new ground out of the forest, or stops: it would change ground that was there. */
function clear(x: number, y: number, c: 'g' | 'm' | 'l') {
  if (at(x, y) !== 't' || !inner(x, y)) throw new Error(`new ground at ${x},${y} is not forest`);
  set(x, y, c);
}
/** Places something on forest it clears, or stops. */
function onForest(o: MapObject, c: 'g' | 'm' | 'l' = 'g') {
  for (const [x, y] of objectTiles(o)) clear(x, y, c);
  must(o);
}

// The jam: where the line of leavers stopped and never moved again. Their cars stand nose to tail at the
// edge of the firs on both sides of the road, beside the three on the pull-offs, some with a door open
// or the trunk up, and between them what was unloaded and left. The road itself stays clear.
const JAM: Array<{ x: number; y: number; paint: string; door?: boolean; trunk?: boolean }> = [
  { x: 38, y: 21, paint: '#8a3b32', door: true },
  { x: 33, y: 24, paint: '#c2b38f' },
  { x: 38, y: 24, paint: '#3f5a73', trunk: true },
  { x: 38, y: 26, paint: '#6e5a44' },
  { x: 33, y: 30, paint: '#4f6b4a', door: true },
  { x: 38, y: 33, paint: '#7d7f82' },
  { x: 33, y: 36, paint: '#9a7a3a', door: true },
  { x: 38, y: 36, paint: '#2f3b45' },
];
for (const c of JAM) onForest({ kind: 'car', x: c.x, y: c.y, w: 1, h: 2, dir: 'down', paint: c.paint, ...(c.door && { door: true }), ...(c.trunk && { trunk: true }) });
for (const [x, y] of [[38, 23], [33, 26], [33, 32], [38, 35], [32, 30]] as const) onForest({ kind: 'luggage', x, y });

// NAPO's motor pool, across the road from the research station: a fenced gravel lot of its box trucks,
// parked in a row, and the pump they filled up at, reached by a short track off the road.
const POOL = { x0: 40, y0: 35, x1: 48, y1: 41 };
for (let y = POOL.y0; y <= POOL.y1; y++) for (let x = POOL.x0; x <= POOL.x1; x++) clear(x, y, 'l');
for (const [x, y] of [[38, 39], [39, 39]] as const) clear(x, y, 'm');
for (let x = POOL.x0; x <= POOL.x1; x++) for (const y of [POOL.y0, POOL.y1]) must({ kind: 'fence', x, y, dir: 'h' });
for (let y = POOL.y0 + 1; y < POOL.y1; y++) {
  if (y !== 39) must({ kind: 'fence', x: POOL.x0, y, dir: 'v' });
  must({ kind: 'fence', x: POOL.x1, y, dir: 'v' });
}
for (const x of [42, 44, 46]) must({ kind: 'truck', x, y: 36, w: 1, h: 3, dir: 'down', style: 'napo' });
must({ kind: 'pump', x: 42, y: 40 });
for (const [x, y] of [[46, 40], [47, 40]] as const) must({ kind: 'barrel', x, y });
must({ kind: 'crate', x: 47, y: 36 });
onForest({ kind: 'sign', x: 38, y: 38, style: 'napo', text: ['NAPO · Motor pool', 'Vehicles sign out at the front desk. Fuel for NAPO use only.'] });

// The field site's sample cages, in a row along its north edge: steel mesh around the rocks NAPO
// carried here from deep in the woods to listen to, each with its tag.
const CAGES: Array<[number, string[]]> = [
  [49, ['NAPO · Sample 3 · the ring of stones, Near Woods.', 'Keep caged. Log the hum at every pulse.']],
  [50, ['NAPO · Sample 7 · deep in the Near Woods.', 'Keep caged. Log the hum at every pulse.']],
  [51, ['NAPO · Sample 9 · the ring of stones, Near Woods.', 'Keep caged. Do not carry past the checkpoint.']],
  [52, ['NAPO · Sample 12. No place written.', 'Keep caged.']],
];
for (const [x, text] of CAGES) onForest({ kind: 'cage', x, y: 66, text }, 'l');

// The checks: only forest changed, every tile anyone could walk on is still walkable and as far from
// home as it was, and the new ground is reached from the road.
{
  const d = stepsHome();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, was = beforeTiles[y]![x]!;
    if (was !== 't' && tile[y]![x] !== was) throw new Error(`the tile at ${x},${y} was ${was} and is now ${tile[y]![x]}: only forest may change`);
    if (beforeSteps[i]! >= 0 && d[i] !== beforeSteps[i]) throw new Error(`the tile at ${x},${y} was ${beforeSteps[i]} steps from home and is now ${d[i]}`);
    if (was === 't' && tile[y]![x] !== 't' && walkable(x, y) && d[i]! < 0) throw new Error(`new ground at ${x},${y} cannot be reached`);
  }
}

// A crate for whoever comes next (caches.ts), at the edge of the leavers' camp, three steps from its fire.
// Placed after everything else, what the leavers and NAPO left included: every choice above hashes the
// tile or checks what stands around it, so anything placed earlier could move them. And like those, it
// stands on forest it clears, so every tile anyone could walk on stays walkable and as far from home:
// the one forest tile this near the fire with open ground in front of it, where you open it from.
onForest({ kind: 'cache', x: CAMP[0] - 3, y: CAMP[1] - 3, name: 'the crate at the leavers\' camp' });

// ---- Output ----

const map: MapData = {
  id: 'south-road', name: 'The South Road', version: 4, kind: 'wilds', depth: 1, width: W, height: H,
  tiles: tile.map(r => r.join('')),
  levels: level.map(r => r.join('')),
  spawn: { x: 35, y: 2, dir: 'down' },
  exits: [EXIT, ...doors],
  objects,
  // The calmer way is the drier one too: its rain comes as the Near Woods' stops, 24 minutes after dawn,
  // and lasts half as long, 6 minutes. So from 12 to 30 minutes after dawn one of the two is always dry.
  rain: [{ from: 24 * 60, length: 6 * 60 }],
  // What the paper map names, besides NAPO's buildings and the way home. The newer names come after,
  // so the paper map writes the older ones where it always did.
  places: [
    { name: 'the leavers\' camp', x: CAMP[0], y: CAMP[1] }, { name: 'the Tower', x: 51, y: 47 }, { name: 'the sinks', x: 15, y: 64 },
    { name: 'field site', x: 51, y: 71 }, { name: 'quarantine line', x: 35, y: 88 },
    { name: 'the jam', x: 35, y: 30 }, { name: 'the motor pool', x: 44, y: 38 },
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
  '  "places": [', map.places!.map(p => `    ${JSON.stringify(p)}`).join(',\n'), '  ]',
  '}',
  '',
].join('\n');
const out = resolve(import.meta.dirname, '../content/maps/south-road.json');
writeFileSync(out, json);

// A glance at the result, two map rows per line because a terminal character is about twice as tall
// as it is wide. Of the two tiles in a character, the one listed first in ORDER wins.
const ORDER = '*A!HFCK@kvibBnLc#-T^o~=",_. ';
const pick = (a: string, b: string) => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b);
const GLYPH: Record<MapObject['kind'], string> = {
  lamp: '*', antenna: 'A', sign: '!', board: '!', console: 'k', chest: 'c', workbench: 'n', house: 'H', car: 'C', npc: '@', stone: 'S', pole: 'i', barrel: 'b',
  fence: '-', tree: 'T', rock: 'o', shrooms: ',', fireplace: 'F', bed: 'B', table: 'n', shelf: 'L', crate: 'c', rug: '_', woodpile: 'b', cache: 'c',
  // What the leavers left at the jam, and NAPO in its motor pool and at the field site.
  luggage: 'b', truck: 'K', pump: 'i', cage: '#',
  // The rest stands in town, in the Near Woods and in the rooms.
  jeep: 'C', logs: '#', stump: 'o', skid: '_', stake: '!', boxes: 'c', rocker: 'n', piano: 'n', bike: 'n', birdcage: 'n',
  hearth: 'F', sheeted: 'n', crib: 'B', clock: 'L', paper: 'n', saw: 'n', carriage: 'n', sawdust: '_',
};
const TILE_GLYPH: Record<string, string> = { t: ' ', w: '~', r: '=', f: '"', m: '.', g: '.', l: '_' };
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
console.log(' . ground  _ gravel  " ferns  = road  ~ water  ^ ridge  * floodlight  A mast  ! sign  H NAPO building  F fire  C car  K truck  i pole or pump  - fence  b barrel or luggage  c crate  # sample cage  o rock  T fir  , shrooms  v way home');

// How deep it goes, measured like the game does (TileMap.homeSteps drives the energy drain).
const tm = new TileMap(map);
const steps = new Int32Array(W * H).map((_, i) => tm.homeSteps(i % W, (i / W) | 0));
const deepest = Math.max(...steps);
const deepTiles: string[] = [];
steps.forEach((v, i) => { if (v === deepest) deepTiles.push(`${i % W},${(i / W) | 0}`); });
const count = (k: MapObject['kind']) => objects.filter(o => o.kind === k).length;
console.log(`wrote ${out}: ${W}x${H} tiles, ${objects.length} objects (${count('house')} buildings, ${count('sign')} signs, ${count('pole')} poles, ${count('car')} cars, ${count('tree')} firs, ${count('rock')} rocks, ${count('shrooms')} shrooms)`);
console.log(`steps from the way home: ${PLACES.map(([name, p]) => `${name} ${stepsTo(steps, p)}`).join(', ')}`);
console.log(`deepest: ${deepest} steps, at ${deepTiles.join(' ')}`);
console.log(`building doors: ${buildings.map((b, i) => { const d = doorOf(b); return `${BUILDINGS[i]!.inside} ${tm.homeSteps(d.x, d.y)} steps`; }).join(', ')}`);
// The tuning targets in energy.ts: how long a full bar lasts standing still in the rain.
const lasts = (x: number, y: number) => (ENERGY_MAX / -energyRate(tm, x, y, 'rain') / 60).toFixed(1);
const deep = steps.indexOf(deepest);
console.log(`a full bar in the rain lasts ${lasts(EXIT.x, EXIT.y + 1)} minutes at the edge, ${lasts(deep % W, (deep / W) | 0)} at the deepest spot`);
const problems = validateMap(map);
for (const p of problems) console.log(`${p.level}: ${p.message}`);
if (problems.some(p => p.level === 'error')) process.exit(1);
