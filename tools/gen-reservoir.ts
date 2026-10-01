/**
 * Generates content/maps/reservoir.json, the Reservoir: a region at depth 1 up the brook from Stonebrook's
 * millpond (docs/DESIGN.md, World structure), behind the dam Stonebrook Timber Co. built to run its mill. Laid
 * out by hand; the few random choices hash the tile position, so it never reshuffles. Re-running it overwrites
 * hand edits to the JSON. Run it after gen:map (whose east road it meets, tools/reservoir-road.ts) and before
 * gen:interiors. Usage: npm run gen:reservoir
 *
 * West to east: the way home comes up the brook to the foot of the dam and the keeper's house, where Agnes
 * keeps the fire (the region's safe fire); the dam runs across the valley's mouth, the boathouse at its north
 * end; behind it the lake fills the valley, with a shore path along its north side. Most of the lake draws down
 * on a clock (MapData.drawdown): its bed is the drowned valley of the first farms, the farm's walls, the stumps
 * of the forest they cut, the drowned lane with a car on it, and in the deepest of it the Sister. The water by
 * the dam never drains, so the lake never empties. Jon's knoll stands in the lake, reached only across the bed
 * at low water; at high water Jon rows you from its landing into the boathouse. Calm otherwise: the surges come
 * down the woods to the north and die at town, so no surges, storms, flashes or creatures here. Its danger is
 * the water.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DECOR, ENERGY_MAX, STEP_MS, TileMap, drawdownAt, energyRate, maxEnergy, objectTiles, surgeAt, validateMap, type Drawdown, type MapData, type MapExit, type MapObject,
} from '../packages/shared/src';
import { doorInto } from './gen-interiors';
import { noteAt } from './notes-left';
import { RESERVOIR_WAY_HOME, STONEBROOK_EAST } from './reservoir-road';

const W = 56, H = 44, SEED = 20261101;
type P = readonly [number, number];
/** The way home, on the west edge: down the brook to Stonebrook's millpond. */
const EXIT: MapExit = { x: RESERVOIR_WAY_HOME.x, y: RESERVOIR_WAY_HOME.y, w: 1, h: 1, to: 'stonebrook', tx: STONEBROOK_EAST.x - 1, ty: STONEBROOK_EAST.y, dir: 'left', home: true };

// Every random choice hashes the tile position (with the seed), as in gen-marsh.ts.
function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(salt + SEED, 0x61c88647);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
const round = (v: number) => Math.round(v * 1000) / 1000;
const SIDES: readonly P[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

const tile: string[][] = Array.from({ length: H }, () => Array<string>(W).fill('t'));
const inner = (x: number, y: number) => x >= 1 && y >= 1 && x < W - 1 && y < H - 1;
const at = (x: number, y: number) => (inner(x, y) ? tile[y]![x]! : 't');
/** The map edge stays forest: the way home is the only way out. */
function set(x: number, y: number, c: string) { if (inner(x, y)) tile[y]![x] = c; }
function ellipse(cx: number, cy: number, rx: number, ry: number, fn: (x: number, y: number) => void) {
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
    if (inner(x, y) && ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) fn(x, y);
  }
}
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
const way = new Uint8Array(W * H);
/** A trail of trodden mud through the waypoints, one tile wide, never on water or the dam's crest. */
function trail(pts: P[]) {
  for (const [x, y] of pts.slice(1).flatMap((p, i) => line4(pts[i]!, p))) {
    if (!inner(x, y) || at(x, y) === 'w' || at(x, y) === 'l') continue;
    set(x, y, 'm');
    way[y * W + x] = 1;
  }
}

// ---- The ground ----

// Below the dam: the valley's mouth, grass, the brook running out of the spillway down to town.
const ENTRY: P = [RESERVOIR_WAY_HOME.x + 1, RESERVOIR_WAY_HOME.y];
ellipse(5.5, 23.5, 5.4, 9.6, (x, y) => set(x, y, 'g'));
tile[EXIT.y]![EXIT.x] = 'm';
/** The dam: its crest is two tiles across, from the woods on one side of the valley to the woods on the other. */
const DAM = { x: 10, top: 8, bottom: 35 } as const;
for (let y = DAM.top; y <= DAM.bottom; y++) for (let x = DAM.x; x < DAM.x + 2; x++) set(x, y, 'l');
const SPILLWAY_Y = 29;

// The lake behind it: wide against the dam, then the old valley, rounding off where the brook came down.
const LAKE = { x: 33, y: 22, rx: 20, ry: 12.5 } as const;
const wet = new Uint8Array(W * H);
for (let y = 1; y < H - 1; y++) for (let x = DAM.x + 2; x < W - 1; x++) {
  const e = ((x + 0.5 - LAKE.x) / LAKE.rx) ** 2 + ((y + 0.5 - LAKE.y) / LAKE.ry) ** 2;
  const fray = x > 22 ? (hash(x, y, 1) - 0.5) * 0.12 : 0;
  if ((x <= 20 && y >= 10 && y <= 34) || e <= 1 + fray) wet[y * W + x] = 1;
}
/** The top of the lake in a column: the first wet row (H: none). */
const top = (x: number) => { for (let y = 1; y < H - 1; y++) if (wet[y * W + x]) return y; return H; };
// The north shore, a few tiles of grass between the woods and the water, from the dam to the lake's far end.
for (let x = DAM.x + 2; x <= 50; x++) {
  const t = top(x);
  if (t >= H) continue;
  const depth = 4 + Math.round(hash(x, 0, 2) * 1.4);
  for (let y = Math.max(2, t - depth); y < t; y++) set(x, y, 'g');
}
// Jon's knoll: a rise in the lake, the hill behind the old farm, ground at any water.
const KNOLL = { x: 43.5, y: 19.5, rx: 3.4, ry: 2.6 } as const;
const knoll = new Set<number>();
ellipse(KNOLL.x, KNOLL.y, KNOLL.rx, KNOLL.ry, (x, y) => { knoll.add(y * W + x); wet[y * W + x] = 0; set(x, y, 'g'); });
const knollRows = new Map<number, number[]>();
for (const i of knoll) { const y = (i / W) | 0; knollRows.set(y, [...(knollRows.get(y) ?? []), i % W].sort((a, b) => a - b)); }
const KNOLL_TOP = Math.min(...knollRows.keys()), KNOLL_MID = Math.round(KNOLL.y - 0.5);
/** Where Jon keeps the boat: the knoll's far tip, its way off at high water. */
const LANDING: P = [knollRows.get(KNOLL_MID)!.at(-1)!, KNOLL_MID];
for (let i = 0; i < W * H; i++) if (wet[i]) tile[(i / W) | 0]![i % W] = 'w';
// The brook out of the spillway, down to town.
for (let x = 1; x < DAM.x; x++) if (at(x, SPILLWAY_Y) !== 't') set(x, SPILLWAY_Y, 'w');
// Banks: mud where the water meets the ground (the knoll stays grass: Jon keeps it trodden flat).
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  if (at(x, y) === 'g' && !knoll.has(y * W + x) && SIDES.some(([dx, dy]) => at(x + dx, y + dy) === 'w')) set(x, y, 'm');
}

/** The water by the dam never drains: the lake never empties, and the boats float. */
const RING_X = DAM.x + 5;
/** The lakebed: every tile of the lake past the water by the dam (the brook is not the lake). */
const bed = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) if (wet[i] && i % W > RING_X) bed[i] = 1;

// The ways: up from the way home to the keeper's door and the foot of the dam, and along the north shore.
const KEEPER = { x: 3, y: 18 } as const;
trail([ENTRY, [DAM.x - 1, ENTRY[1]]]);
trail([[KEEPER.x + 1, ENTRY[1]], [KEEPER.x + 1, KEEPER.y + 2]]);
const shore = (x: number): P => [x, Math.max(2, top(x) - 2)];
trail([[DAM.x + 2, DAM.top + 1], shore(16), shore(22), shore(28), shore(34), shore(40), shore(46), shore(49)]);

// ---- Things ----

const objects: MapObject[] = [];
const blocked = new Uint8Array(W * H);
/** Walkable at high water, or (drained) with the lakebed walked on too. */
const walkable = (x: number, y: number, drained: boolean) => {
  if (!inner(x, y) || blocked[y * W + x]) return false;
  const c = at(x, y);
  return c !== 't' && (c !== 'w' || (drained && bed[y * W + x] === 1));
};
/** Walking steps from the way home to every tile (-1: no way there), at high water or low. */
function stepsHome(drained: boolean): Int32Array {
  const d = new Int32Array(W * H).fill(-1);
  const queue: number[] = [ENTRY[1] * W + ENTRY[0]];
  d[queue[0]!] = 1;
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h]!, x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of SIDES) {
      const nx = x + dx, ny = y + dy, j = ny * W + nx;
      if (!walkable(nx, ny, drained) || d[j]! >= 0) continue;
      d[j] = d[i]! + 1;
      queue.push(j);
    }
  }
  return d;
}
const reached = (d: Int32Array) => d.reduce((n, v) => n + (v >= 0 ? 1 : 0), 0);
/**
 * Places an object. Things on dry ground clear it (forest under one becomes grass); things on the lakebed stand
 * in its water, which is still water at high water. What is only drawn blocks nothing.
 */
function place(o: MapObject) {
  for (const [x, y] of objectTiles(o)) {
    if (!inner(x, y)) throw new Error(`${o.kind} at ${o.x},${o.y} is on the map edge`);
    if (DECOR.has(o.kind)) continue;
    if (blocked[y * W + x]) throw new Error(`${o.kind} at ${o.x},${o.y} overlaps something on ${x},${y}`);
    blocked[y * W + x] = 1;
    if (at(x, y) === 't' || (at(x, y) === 'w' && !bed[y * W + x])) set(x, y, 'g');
  }
  objects.push(o);
}
/** Places an object unless it would cut somebody off, at high water or at low: every tile it does not cover stays reachable. */
function tryPlace(o: MapObject): boolean {
  const tiles = objectTiles(o);
  if (tiles.some(([x, y]) => !inner(x, y) || blocked[y * W + x])) return false;
  for (const drained of [false, true]) {
    const d = stepsHome(drained);
    const covered = tiles.filter(([x, y]) => d[y * W + x]! >= 0).length;
    if (!covered) continue;
    const before = reached(d);
    for (const [x, y] of tiles) blocked[y * W + x] = 1;
    const cut = reached(stepsHome(drained)) !== before - covered;
    for (const [x, y] of tiles) blocked[y * W + x] = 0;
    if (cut) return false;
  }
  // The knoll holds together: from its landing, the way off at high water, every free tile of it is still walked to.
  if (tiles.some(([x, y]) => knoll.has(y * W + x))) {
    for (const [x, y] of tiles) blocked[y * W + x] = 1;
    const seen = new Set([LANDING[1] * W + LANDING[0]]), queue = [...seen];
    for (let h = 0; h < queue.length; h++) for (const [dx, dy] of SIDES) {
      const j = queue[h]! + dy * W + dx;
      if (knoll.has(j) && !blocked[j] && !seen.has(j)) { seen.add(j); queue.push(j); }
    }
    const split = [...knoll].some(i => !blocked[i] && !seen.has(i)) || blocked[LANDING[1] * W + LANDING[0]] === 1;
    for (const [x, y] of tiles) blocked[y * W + x] = 0;
    if (split) return false;
  }
  place(o);
  return true;
}
/** Places a hand-placed thing, or stops: it would cut somebody off, so the layout needs a look. */
function must(o: MapObject) { if (!tryPlace(o)) throw new Error(`the ${o.kind} at ${o.x},${o.y} would block the way`); }

// The keeper's house below the dam, Agnes's (gen-interiors.ts: she keeps its fire), and the boathouse on the
// shore at the dam's end, Jon's, whose door gives onto the dam.
const keepers = { kind: 'house', x: KEEPER.x, y: KEEPER.y, w: 3, h: 2, roof: '#5a4636', lit: 1 } as const;
must(keepers);
const BOATHOUSE = { x: DAM.x + 2, y: DAM.top - 2 } as const;
const boathouse = { kind: 'house', x: BOATHOUSE.x, y: BOATHOUSE.y, w: 3, h: 2, roof: '#4b5560', lit: 0 } as const;
place(boathouse); // any shore it walls off behind it goes back to forest below
const doors = [doorInto('reservoir-keepers-house', 'reservoir', keepers), doorInto('reservoir-boathouse', 'reservoir', boathouse)];
[KEEPER.x + 3, KEEPER.x - 1].some(x => tryPlace({ kind: 'woodpile', x, y: KEEPER.y + 1 }));
// The railing along the dam's downstream side, so the crest reads as a dam and not a road by the lake: open
// where the way home comes up onto it and beside the keeper's house; the woods and the brook close the rest.
const RAIL_GAPS = new Set([ENTRY[1], KEEPER.y + 1]);
for (let y = DAM.top; y <= DAM.bottom; y++) {
  const c = at(DAM.x - 1, y);
  if (c !== 't' && c !== 'w' && !RAIL_GAPS.has(y)) must({ kind: 'fence', x: DAM.x - 1, y, dir: 'v' });
}

/** A sign near `p`: the nearest open ground off the ways with room in front of it to read it from, cutting nobody off. */
const signs: Array<{ x: number; y: number }> = [];
function signNear(p: P, text: string[]) {
  const spots: Array<[number, number, number]> = [];
  for (let y = p[1] - 3; y <= p[1] + 3; y++) for (let x = p[0] - 3; x <= p[0] + 3; x++) {
    if (walkable(x, y, false) && !way[y * W + x] && at(x, y) !== 'l' && walkable(x, y + 1, false) && !signs.some(s => Math.abs(s.x - x) + Math.abs(s.y - y) < 2)) spots.push([Math.hypot(x - p[0], y - p[1]), x, y]);
  }
  spots.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const spot = spots.find(([, x, y]) => tryPlace({ kind: 'sign', x, y, text }));
  if (!spot) throw new Error(`no room for a sign near ${p.join(',')}`);
  signs.push({ x: spot[1], y: spot[2] });
  return { x: spot[1], y: spot[2] };
}
const WAY_IN_SIGN = signNear([3, ENTRY[1] - 1], ['A board by the brook: "Stonebrook Reservoir. Stonebrook Timber Co."', 'Under it, newer, in a careful hand: "The water goes out and comes back. Mind which. A. Brandt, keeper."']);
// The Timber Co.'s plate, set in the dam's crest where everyone crossing passes it.
const PLATE = { x: DAM.x, y: 20 } as const;
must({ kind: 'sign', ...PLATE, text: ['A brass plate set in the dam: "Stonebrook Timber Co. The brook held here to drive the mill."', 'Scratched under it, long ago: "And the farms under it. And her."'] });
signs.push(PLATE);
// Agnes's board where the shore path first meets the lakebed.
const BOARD = signNear(shore(RING_X + 3), ['Painted on a board, in a careful hand: "When she goes quiet, come back. The water is a minute behind. A. Brandt, keeper."']);
// The sluice gear on the crest above the spillway: a crate of it (the keeper's log under a stone on it) and a drum of grease.
const SLUICE = { kind: 'crate', x: DAM.x + 1, y: SPILLWAY_Y } as const;
must(SLUICE);
must({ kind: 'barrel', x: DAM.x + 1, y: SPILLWAY_Y + 1 });

// ---- The drowned valley, on the lakebed ----

/** Steps from each lake tile to the nearest ground (anything not water): how deep the valley lies there. */
const deep = new Int32Array(W * H).fill(-1);
{
  const queue: number[] = [];
  for (let i = 0; i < W * H; i++) if (at(i % W, (i / W) | 0) !== 'w') { deep[i] = 0; queue.push(i); }
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h]!, x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of SIDES) {
      const nx = x + dx, ny = y + dy, j = ny * W + nx;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || deep[j]! >= 0) continue;
      deep[j] = deep[i]! + 1;
      queue.push(j);
    }
  }
}
// The Sister, at the deepest of the bed: of the deepest tiles, the one nearest the middle of the old valley.
const deepest = Math.max(...[...bed.keys()].filter(i => bed[i]).map(i => deep[i]!));
const SISTER = (() => {
  const best = [...bed.keys()].filter(i => bed[i] && deep[i] === deepest)
    .map(i => [Math.hypot(i % W + 0.5 - LAKE.x, (i / W | 0) + 0.5 - LAKE.y), i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1])[0]![1];
  return { x: best % W, y: (best / W) | 0 };
})();
must({
  kind: 'sister', ...SISTER,
  text: [
    'A standing stone, taller than you, slick with weed and silt. It is the Old Stone\'s shape, and it is whole.',
    'Up close it hums, low, the way the Old Stone does on cold nights.',
    'Chalked at its foot, and smudged by the water: "SORRY."',
  ],
});
const nearSister = (x: number, y: number, r = 2) => Math.max(Math.abs(x - SISTER.x), Math.abs(y - SISTER.y)) <= r;

const isKnoll = (x: number, y: number) => knoll.has(y * W + x);
// The farm at the knoll's foot: what is left of the house, its kitchen table against the rise (Jon's slate on it).
const KL = knollRows.get(KNOLL_MID)![0]!;
const FARM = { x: KL - 5, y: KNOLL_MID - 1 } as const;
must({ kind: 'ruin', x: FARM.x, y: FARM.y, w: 3, h: 2 });
const TABLE = { kind: 'table', x: KL - 1, y: KNOLL_MID } as const;
if (!isKnoll(TABLE.x + 1, TABLE.y) || !bed[TABLE.y * W + TABLE.x]) throw new Error('the farm table stands on the bed against the knoll');
must(TABLE);
// The drowned lane up the valley to the farm, between what is left of its fences, and the farm's car at the
// end of it, nosed against the rise (Jon's slate under its wiper).
const LANE_Y = KNOLL_TOP - 1, KT = knollRows.get(KNOLL_TOP)![0]!;
const CAR = { kind: 'car', x: KT, y: LANE_Y, w: 2, dir: 'right', paint: '#6d7a6a', door: true } as const;
if (!isKnoll(CAR.x, KNOLL_TOP) || objectTiles(CAR).some(([x, y]) => !bed[y * W + x])) throw new Error('the farm\'s car stands on the bed against the knoll');
must(CAR);
// Only what the client hides under the water at high water stands on the bed: stumps, ruins, cars, fences, tables
// and the Sister (never rocks, trees or signs, which would stick out of the lake).
for (let x = RING_X + 3; x < FARM.x - 1; x += 2) for (const y of [LANE_Y - 1, LANE_Y + 1]) {
  if (bed[y * W + x] && !nearSister(x, y)) tryPlace({ kind: 'fence', x, y, dir: 'h' });
}
// The farm's byre below the house, fallen in like it.
must({ kind: 'ruin', x: FARM.x - 1, y: FARM.y + 3, w: 4, h: 2 });
// The walls of the farm's fields, across the meadow below the lane, with gaps where the gates were.
const WALL_Y = SISTER.y + 4;
for (let x = RING_X + 4; x <= FARM.x; x++) {
  if (x % 5 === 2 || !bed[WALL_Y * W + x] || nearSister(x, WALL_Y)) continue;
  tryPlace({ kind: 'fence', x, y: WALL_Y, dir: 'h' });
}
// The stumps of the forest the Timber Co. cut before the water came, standing in the bed: never by the Sister,
// the lane or the walls, nor next to another thing, so the ways across stay open.
const bedOpen = (x: number, y: number) => {
  if (!bed[y * W + x] || nearSister(x, y) || Math.abs(y - LANE_Y) <= 2 || Math.abs(y - WALL_Y) <= 1) return false;
  for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (blocked[yy * W + xx] || isKnoll(xx, yy)) return false;
  return true;
};
for (let y = 2; y < H - 2; y++) for (let x = RING_X + 2; x < W - 2; x++) {
  if (bedOpen(x, y) && hash(x, y, 40) < 0.07) tryPlace({ kind: 'stump', x, y, s: round(0.8 + hash(x, y, 41) * 0.4), v: round(hash(x, y, 42)) });
}

// ---- The shore ----

// Firs on the shore and in the valley's mouth, standing alone, and a few stumps: never on a way, by the water,
// in front of a sign or a door, or next to another thing.
const keepOpen = new Set<number>([(KEEPER.y + 2) * W + KEEPER.x + 1, (BOATHOUSE.y + 2) * W + BOATHOUSE.x + 1]);
for (const s of signs) keepOpen.add((s.y + 1) * W + s.x);
function open(x: number, y: number): boolean {
  if (!walkable(x, y, false) || way[y * W + x] || keepOpen.has(y * W + x) || isKnoll(x, y) || at(x, y) !== 'g') return false;
  for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (blocked[yy * W + xx] || at(xx, yy) === 'w' || at(xx, yy) === 'l') return false;
  return true;
}
for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
  if (!open(x, y)) continue;
  const edge = SIDES.some(([dx, dy]) => at(x + dx, y + dy) === 't');
  if (!edge && hash(x, y, 90) < 0.08) tryPlace({ kind: 'tree', x, y, s: round(0.9 + hash(x, y, 91) * 0.4), v: round(hash(x, y, 92)) });
  else if (hash(x, y, 93) < 0.04) tryPlace({ kind: 'stump', x, y, s: round(0.8 + hash(x, y, 94) * 0.4), v: round(hash(x, y, 95)) });
}

// ---- Jon's camp on the knoll ----

// His fire in the open, which he keeps (the region's other safe fire), Jon beside it looking out at the Sister,
// his boat upturned on the grass, a crate (his slate on it), and the landing where he rows you across to the
// boathouse at high water: the knoll's way off when the water is up (an exit, so nobody is stranded there).
const FIRE = { x: Math.floor(KNOLL.x), y: KNOLL_MID } as const;
const camp: Array<[MapObject, P]> = [
  [{ kind: 'fireplace', ...FIRE, tended: true, name: 'Jon\'s fire' }, [0, 0]],
  [{ kind: 'npc', id: 'jon', name: 'Jon', x: FIRE.x + 1, y: FIRE.y - 1, dir: 'down', look: { coat: '#6b5a3a', scarf: '#3d5566', hair: '#9a948a', skin: '#c99a78' }, lines: [
    'Jon Brandt. I ran the boat and the sluice for the dam, forty years. Now I sit here.',
    'That\'s her out there, under the water: the Sister. The old folks\' stone, from the farms. Twin to the one in town.',
    'When the water draws back you can walk out and stand by her. She hums. Mind the time: it comes back fast.',
    'When the water\'s up, step down to the landing and I\'ll row you over to the boathouse. Only away from here, mind. Never to it.',
    'Agnes? She\'s at the dam. She keeps the water. Don\'t tell her anything. Or do. I don\'t know.',
  ] }, [1, -1]],
  [{ kind: 'boat', x: FIRE.x - 1, y: FIRE.y + 1 }, [-1, 1]],
  [{ kind: 'crate', x: FIRE.x - 1, y: FIRE.y - 1 }, [-1, -1]],
];
for (const [o] of camp) {
  for (const [x, y] of objectTiles(o)) if (!isKnoll(x, y)) throw new Error(`the ${o.kind} at ${x},${y} is off the knoll`);
  must(o);
}
if (blocked[LANDING[1] * W + LANDING[0]]) throw new Error('the landing is taken');
// The tiles the farm's table and car are read from stay open.
const readFrom = new Set([TABLE.y * W + TABLE.x + 1, KNOLL_TOP * W + CAR.x, KNOLL_TOP * W + CAR.x + 1]);
// The farm's gate board, which Jon carried up out of the water and nailed to a post on the farm side of the knoll.
const GATE = (() => {
  const spots = [...knoll].map(i => [i % W, (i / W) | 0] as const)
    .filter(([x, y]) => isKnoll(x, y + 1) && !readFrom.has(y * W + x) && !blocked[y * W + x] && !blocked[(y + 1) * W + x] && !(x === LANDING[0] && (y === LANDING[1] || y + 1 === LANDING[1])))
    .sort((a, b) => Math.hypot(a[0] - KL, a[1] - KNOLL_MID) - Math.hypot(b[0] - KL, b[1] - KNOLL_MID) || a[0] - b[0] || a[1] - b[1]);
  const spot = spots.find(([x, y]) => tryPlace({ kind: 'sign', x, y, text: ['The farm\'s gate board, nailed to a post up here out of the water: "Upper farm. Milk at the gate."', 'Under it, in chalk: "They had to go too. J."'] }));
  if (!spot) throw new Error('no room on the knoll for the farm\'s gate board');
  return { x: spot[0], y: spot[1] };
})();
const BOAT: MapExit = { x: LANDING[0], y: LANDING[1], w: 1, h: 1, to: 'reservoir-boathouse', tx: doors[1]!.tx, ty: doors[1]!.ty, dir: 'up' };

// The places worth walking to, for the paper map and for the way the notes are named.
const PLACES: Array<[string, P]> = [
  ['the dam', [DAM.x, 22]], ['the shore', shore(30)], ['the drowned farm', [FARM.x + 1, FARM.y]], ['the Sister', [SISTER.x, SISTER.y]], ['the knoll', [FIRE.x, FIRE.y]],
];
// Walkable ground nobody can reach even at low water (a stray tile) goes back to forest.
{
  const d = stepsHome(true);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (walkable(x, y, true) && d[y * W + x]! < 0 && at(x, y) !== 'w') tile[y]![x] = 't';
  for (let i = objects.length - 1; i >= 0; i--) { const o = objects[i]!; if ((o.kind === 'stump' || o.kind === 'tree') && at(o.x, o.y) === 't') objects.splice(i, 1); }
}
// A crate for whoever comes next, by Jon's fire (caches.ts): last but the notes, so nothing before it moves.
{
  const spot = [[1, 1], [1, 0], [0, 1], [-1, 0], [0, -1], [2, 0], [2, 1]].map(([dx, dy]) => [FIRE.x + dx!, FIRE.y + dy!] as const)
    .find(([x, y]) => isKnoll(x, y) && isKnoll(x, y + 1) && !blocked[y * W + x] && !blocked[(y + 1) * W + x] && !(x === LANDING[0] && y === LANDING[1]) && tryPlace({ kind: 'cache', x, y, name: 'the crate at Jon\'s camp' }));
  if (!spot) throw new Error('no room for a crate by Jon\'s fire');
}
// The Brandts' notes, last of all (notes-left.ts): her log on the sluice crate; his slates on the farm's car and
// table, read from the knoll, and on his crate. The rest lie indoors (gen-interiors.ts).
objects.push(noteAt('brandts-log-dam', SLUICE.x, SLUICE.y));
objects.push(noteAt('brandts-slate-car', CAR.x, CAR.y));
objects.push(noteAt('brandts-slate-table', TABLE.x, TABLE.y));
objects.push(noteAt('brandts-slate-camp', FIRE.x - 1, FIRE.y - 1));

// ---- The clock ----

// Twice every forty minutes, twice for every pulse of the Tower: the water draws back for five minutes, the last
// of them on its way home. Shifted so it draws back just as the Near Woods' surge breaks (content/maps/near-woods.json):
// that surge starts 2250 s into its round, and 2250 + 150 is a whole round of the lake's.
const bedTiles: Array<[number, number]> = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (bed[y * W + x] && at(x, y) === 'w') bedTiles.push([x, y]);
const DRAWDOWN: Drawdown = { name: 'the reservoir', every: 1200, down: 300, warn: 60, offset: 150, tiles: bedTiles };
{
  const woods = JSON.parse(readFileSync(resolve(import.meta.dirname, '../content/maps/near-woods.json'), 'utf8')) as MapData;
  for (let s = 0; s < 2400; s++) {
    const breaks = surgeAt(woods.surge!, s * 1000).phase === 'surge' && surgeAt(woods.surge!, (s - 1) * 1000).phase !== 'surge';
    if (breaks && !(drawdownAt(DRAWDOWN, s * 1000).phase === 'down' && drawdownAt(DRAWDOWN, (s - 1) * 1000).phase === 'full')) {
      throw new Error(`the Near Woods' surge breaks ${s} s into the Tower's round, but the reservoir does not draw back then`);
    }
  }
}

// ---- Output ----

const map: MapData = {
  id: 'reservoir', name: 'The Reservoir', version: 2, kind: 'wilds', depth: 1, width: W, height: H,
  tiles: tile.map(r => r.join('')),
  levels: tile.map(r => '0'.repeat(r.length)),
  spawn: { x: ENTRY[0] + 1, y: ENTRY[1], dir: 'right' },
  exits: [EXIT, ...doors, BOAT],
  objects,
  // A shower from 15 minutes after dawn, for 8, up the brook while it rains in town.
  rain: [{ from: 900, length: 480 }],
  drawdown: DRAWDOWN,
  places: PLACES.map(([name, [x, y]]) => ({ name, x, y })),
};

// One row or object per line, so map changes show up as small, readable diffs; the lakebed a row of the map per line.
const rows = new Map<number, Array<[number, number]>>();
for (const t of bedTiles) rows.set(t[1], [...(rows.get(t[1]) ?? []), t]);
const { tiles: _tiles, ...clock } = DRAWDOWN;
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
  `  "drawdown": ${JSON.stringify(clock).slice(0, -1)}, "tiles": [`,
  [...rows.values()].map(r => `    ${r.map(t => JSON.stringify(t)).join(',')}`).join(',\n'),
  '  ]},',
  '  "places": [', map.places!.map(p => `    ${JSON.stringify(p)}`).join(',\n'), '  ]',
  '}',
  '',
].join('\n');
const out = resolve(import.meta.dirname, '../content/maps/reservoir.json');
writeFileSync(out, json);

// A glance at the result, two map rows per line (a terminal character is about twice as tall as wide).
const GLYPH: Partial<Record<MapObject['kind'], string>> = {
  sign: '!', house: 'H', tree: 'T', rock: 'o', woodpile: 'b', stump: 'x', fence: '-', ruin: 'R', table: 'n', car: 'C', sister: 'S', fireplace: 'F', npc: '@', boat: 'u', crate: 'c', barrel: 'c', cache: 'c', note: '?',
};
const TILE_GLYPH: Record<string, string> = { t: ' ', w: '~', m: '.', g: '.', l: '#' };
const objGlyph = new Map<number, string>();
for (const o of objects) if (o.kind !== 'note') for (const [x, y] of objectTiles(o)) objGlyph.set(y * W + x, GLYPH[o.kind] ?? '?');
const glyph = (x: number, y: number) => {
  if (y === EXIT.y && x === EXIT.x) return '<';
  if (y === BOAT.y && x === BOAT.x) return '>';
  const c = tile[y]![x]!;
  return objGlyph.get(y * W + x) ?? (c === 'w' && bed[y * W + x] ? ',' : TILE_GLYPH[c]!);
};
const lines = [`+${'-'.repeat(W)}+`];
for (let y = 0; y < H; y++) lines.push(`|${Array.from({ length: W }, (_, x) => glyph(x, y)).join('')}|`);
console.log([...lines, lines[0]].join('\n'));
console.log(' . ground  # dam  ~ water that stays  , lakebed  S the Sister  F fire  @ Jon  > the landing  R farm  n table  C car  - fence  o wall  x stump  ! sign  H house  < way home');

// How far it goes, measured like the game does (TileMap.homeSteps, at high water and at low).
const tm = new TileMap(map);
const near = (m: TileMap, x: number, y: number) => Math.min(...SIDES.map(([dx, dy]) => m.homeSteps(x + dx, y + dy)).filter(s => s >= 0));
tm.drain(true);
const toSister = near(tm, SISTER.x, SISTER.y), toKnoll = tm.homeSteps(FIRE.x, FIRE.y + 1);
const walk = (2 * toSister * STEP_MS) / 1000;
const cost = 2 * Array.from({ length: toSister }, (_, s) => s + 1).reduce((e, s) => e + 0.2 * DRAIN_AT(s), 0);
function DRAIN_AT(steps: number) { return -energyRate(tm, ...tileAt(steps), 'night'); }
function tileAt(steps: number): [number, number] {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (tm.homeSteps(x, y) === steps && tm.walkable(x, y) && !tm.warm(x, y)) return [x, y];
  throw new Error(`no tile ${steps} steps from home`);
}
console.log(`wrote ${out}: ${W}x${H} tiles, ${objects.length} objects, ${bedTiles.length} tiles of lakebed (the deepest ${deepest} from the shore); signs at ${[WAY_IN_SIGN, PLATE, BOARD, GATE].map(s => `${s.x},${s.y}`).join(' ')}`);
console.log(`at low water: the Sister ${toSister} steps from the way home (there and back ${walk.toFixed(0)} s of ${DRAWDOWN.down - DRAWDOWN.warn} s, ${cost.toFixed(1)} energy of a level 1 bar of ${maxEnergy(1)} at night; full bar ${ENERGY_MAX}), Jon's fire ${toKnoll}`);
const problems = validateMap(map);
for (const p of problems) console.log(`${p.level}: ${p.message}`);
if (problems.some(p => p.level === 'error')) process.exit(1);
