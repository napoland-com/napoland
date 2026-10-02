/**
 * Generates the Turning (docs/DESIGN.md, World structure): content/maps/turning.json, turning-2.json and
 * turning-3.json, three clearings that look the same, and turning-camp.json, the ranger's camp past them. The
 * wood west of the Near Woods' ring of stones (gen-woods.ts), the one the ranger never drew. Laid out by hand;
 * the few random choices hash the tile position, so it never reshuffles, and all three clearings hash alike, so
 * their firs, ferns and trails are the same tile for tile. Re-running it overwrites hand edits to the JSON. Run it
 * after gen:woods (whose west edge it meets, tools/turning-mouth.ts) and before gen:interiors.
 * Usage: npm run gen:turning
 *
 * Each clearing has a way out on each side. Three of them put you back out by the ring of stones, facing it
 * (they are ways home: the drain counts from the nearest); one leads on, into the next clearing, where you come in
 * by its east side again, whichever side you left by. Only the thing in the middle tells them apart, with the
 * ranger's notches in a fir beside it (one, two, three), and each has its clue to the way on, which her
 * directions in the Near Woods name (notes-left.ts, ranger-turning): at the stump a spring whose brook runs out
 * one side, at the cairn a stone that hums by one trail, and at NAPO's stakes, which run out one side (NAPO went
 * that way, and came out by the ring), the way on is back where you came in. Past the third, her camp: a clearing
 * with her hut, its fire always burning (gen-interiors.ts), and a path on, west, that gives out in the firs.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STEP_MS, TileMap, energyRate, maxEnergy, objectTiles, validateMap, type MapData, type MapExit, type MapObject } from '../packages/shared/src';
import { doorInto } from './gen-interiors';
import { NEAR_WOODS_BACK, TURNING_ENTRY } from './turning-mouth';

const W = 31, H = 27, SEED = 20261002;
type P = readonly [number, number];
type Side = 'up' | 'left' | 'down' | 'right';
const C: P = [15, 13];
/** Each side's way out, on the map's edge, and the trail's last tile inside it. */
const EDGE: Readonly<Record<Side, P>> = { up: [C[0], 0], left: [0, C[1]], down: [C[0], H - 1], right: [W - 1, C[1]] };
if (EDGE.right[0] !== TURNING_ENTRY.x + 1 || EDGE.right[1] !== TURNING_ENTRY.y) throw new Error('the Turning\'s way in is not beside its east edge');

function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(salt + SEED, 0x61c88647);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
const round = (v: number) => Math.round(v * 1000) / 1000;
const SIDES: readonly P[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

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

/** One map's ground: forest, with clearings and trails cut out of it. */
class Ground {
  readonly tile: string[][];
  readonly way = new Uint8Array(W * H);
  readonly objects: MapObject[] = [];
  readonly blocked = new Uint8Array(W * H);
  constructor(readonly w: number, readonly h: number) {
    this.tile = Array.from({ length: h }, () => Array<string>(w).fill('t'));
  }
  inner(x: number, y: number) { return x >= 1 && y >= 1 && x < this.w - 1 && y < this.h - 1; }
  at(x: number, y: number) { return this.inner(x, y) ? this.tile[y]![x]! : 't'; }
  /** The map edge stays forest but for the ways out, cut by hand. */
  set(x: number, y: number, c: string) { if (this.inner(x, y)) this.tile[y]![x] = c; }
  clearing(cx: number, cy: number, rx: number, ry: number, salt: number) {
    for (let y = 1; y < this.h - 1; y++) for (let x = 1; x < this.w - 1; x++) {
      const e = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
      if (e <= 1 + (hash(x, y, salt) - 0.5) * 0.3) this.set(x, y, 'g');
    }
  }
  /** A trail of trodden mud through the waypoints, one tile wide; the last may be on the edge. */
  trail(pts: P[]) {
    for (const [x, y] of pts.slice(1).flatMap((p, i) => line4(pts[i]!, p))) {
      if (this.at(x, y) === 'w') continue;
      if (this.inner(x, y)) this.set(x, y, 'm'); else this.tile[y]![x] = 'm';
      this.way[y * this.w + x] = 1;
    }
  }
  walkable(x: number, y: number) {
    const c = this.tile[y]?.[x];
    return c !== undefined && c !== 't' && c !== 'w' && !this.blocked[y * this.w + x];
  }
  /** Ground nobody can walk to from (x, y) (cut off by the water) grows back over with firs. */
  closeOff(x: number, y: number) {
    const seen = new Uint8Array(this.w * this.h), q = [y * this.w + x];
    seen[q[0]!] = 1;
    for (let h = 0; h < q.length; h++) {
      const i = q[h]!, px = i % this.w, py = (i / this.w) | 0;
      for (const [dx, dy] of SIDES) {
        const nx = px + dx, ny = py + dy, j = ny * this.w + nx;
        if (nx >= 0 && ny >= 0 && nx < this.w && ny < this.h && !seen[j] && this.walkable(nx, ny)) { seen[j] = 1; q.push(j); }
      }
    }
    for (let j = 0; j < this.w * this.h; j++) {
      const c = this.tile[(j / this.w) | 0]![j % this.w]!;
      if (!seen[j] && c !== 't' && c !== 'w' && !this.blocked[j]) this.tile[(j / this.w) | 0]![j % this.w] = 't';
    }
  }
  place(o: MapObject) {
    for (const [x, y] of objectTiles(o)) {
      if (!this.inner(x, y) || this.at(x, y) === 't' || this.at(x, y) === 'w') throw new Error(`${o.kind} at ${x},${y} is not on open ground`);
      if (o.kind !== 'stake') this.blocked[y * this.w + x] = 1;
    }
    this.objects.push(o);
  }
}

// ---- The three clearings ----

/** Where each trail bends on its way out, the same in every clearing. */
const TRAILS: Readonly<Record<Side, P[]>> = {
  up: [C, [C[0], 8], [C[0] - 1, 5], [C[0] - 1, 3], [C[0], 2], EDGE.up],
  left: [C, [9, C[1]], [6, C[1] + 1], [3, C[1] + 1], [2, C[1]], EDGE.left],
  down: [C, [C[0], 18], [C[0] + 1, 21], [C[0] + 1, 23], [C[0], 24], EDGE.down],
  right: [C, [21, C[1]], [24, C[1] - 1], [27, C[1] - 1], [28, C[1]], EDGE.right],
};

/** One of the Turning's clearings: what stands in its middle, its notches, and the side that leads on. */
interface Stage { id: string; place: string; notches: string; on: Side; next: string; landmark: (g: Ground) => void; clue: (g: Ground) => void }

const STAGES: readonly Stage[] = [
  {
    // The stump, and the spring by it: its brook runs out the north side, beside the trail. Go with the water.
    id: 'turning', place: 'the stump', notches: 'One notch', on: 'up', next: 'turning-2',
    landmark: g => g.place({ kind: 'stump', x: C[0], y: C[1], s: 1.35, v: 0.42 }),
    clue: g => {
      for (const [x, y] of [[17, 10], [18, 10], [17, 11], [18, 11]] as P[]) g.set(x, y, 'w');
      for (let y = 1; y < 10; y++) g.set(17, y, 'w');
    },
  },
  {
    // The cairn, and a stone that hums beside the west trail where it leaves the clearing. Go to it.
    id: 'turning-2', place: 'the cairn', notches: 'Two notches', on: 'left', next: 'turning-3',
    landmark: g => {
      g.place({ kind: 'rock', x: C[0], y: C[1], s: 1.15, v: 0.31 });
      g.place({ kind: 'rock', x: C[0] - 1, y: C[1] - 1, s: 0.6, v: 0.77 });
      g.place({ kind: 'rock', x: C[0] + 1, y: C[1] + 1, s: 0.55, v: 0.18 });
    },
    clue: g => { g.set(8, C[1] - 1, 'g'); g.place({ kind: 'rock', x: 8, y: C[1] - 1, s: 1.05, v: 0.64, hum: true }); },
  },
  {
    // NAPO's stakes, from the middle out along the west trail: NAPO went that way, and came out by the ring. The
    // way on is back where you came in.
    id: 'turning-3', place: 'the stakes', notches: 'Three notches', on: 'right', next: 'turning-camp',
    landmark: g => g.place({ kind: 'stake', x: C[0] - 1, y: C[1] }),
    clue: g => {
      for (const x of [12, 9, 6, 3]) g.place({ kind: 'stake', x, y: x > 6 ? C[1] : C[1] + 1 });
      g.place({ kind: 'sign', x: 11, y: C[1] - 1, style: 'napo', text: ['NAPO · FIELD SURVEY · LINE T', 'Stake 41. Survey continues west.'] });
    },
  },
];

/** Where the camp's way home is, and where you come into it (turning round in the third clearing). */
const CW = 25, CH = 19;
const CAMP_HOME: P = [CW - 1, 9];
const CAMP_ENTRY: P = [CW - 2, 9];

/** The way back out by the ring, from any way that does not lead on. */
const backOut = (x: number, y: number, w = 1, h = 1): MapExit => ({ x, y, w, h, to: 'near-woods', tx: NEAR_WOODS_BACK.x, ty: NEAR_WOODS_BACK.y, dir: 'right', home: true });

/** The Near Woods' rain: the Turning lies off them, under the same sky. */
const RAIN = [{ from: 12 * 60, length: 12 * 60 }];

function stage(s: Stage): MapData {
  const g = new Ground(W, H);
  // The clearing, the same in all three: a round of grass, frayed by the same hash, ferns under its rim.
  g.clearing(C[0] + 0.5, C[1] + 0.5, 7.6, 5.6, 1);
  for (const side of ['up', 'left', 'down', 'right'] as const) g.trail(TRAILS[side]);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (g.at(x, y) !== 'g' || g.way[y * W + x]) continue;
    const r = Math.hypot((x - C[0]) / 7.6, (y - C[1]) / 5.6);
    if (r > 0.72 && hash(x, y, 2) < 0.55) g.set(x, y, 'f');
  }
  s.clue(g);
  s.landmark(g);
  g.closeOff(TURNING_ENTRY.x, TURNING_ENTRY.y);
  // A few firs standing in the clearing, off the trails, the same in all three.
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (g.at(x, y) !== 'g' || g.way[y * W + x] || g.blocked[y * W + x] || Math.hypot(x - C[0], y - C[1]) < 3) continue;
    if (SIDES.some(([dx, dy]) => g.way[(y + dy) * W + x + dx])) continue;
    if (hash(x, y, 3) < 0.08) g.place({ kind: 'tree', x, y, s: round(0.85 + hash(x, y, 4) * 0.4), v: round(hash(x, y, 5)) });
  }
  // The ranger's notches, in a fir beside the trail you come in by: read from the trail.
  g.place({ kind: 'sign', x: 20, y: C[1] - 1, text: [`${s.notches} cut in a fir at eye height, old, the bark grown over the edges.`] });

  const exits = (['up', 'left', 'down', 'right'] as const).map((side): MapExit => {
    const [x, y] = EDGE[side];
    if (side !== s.on) return backOut(x, y);
    const into: P = s.next === 'turning-camp' ? CAMP_ENTRY : [TURNING_ENTRY.x, TURNING_ENTRY.y];
    return { x, y, w: 1, h: 1, to: s.next, tx: into[0], ty: into[1], dir: 'left' };
  });
  return {
    id: s.id, name: 'The Turning', version: 1, kind: 'wilds', depth: 2, width: W, height: H,
    tiles: g.tile.map(r => r.join('')), levels: g.tile.map(r => '0'.repeat(r.length)),
    spawn: { x: TURNING_ENTRY.x, y: TURNING_ENTRY.y, dir: 'left' },
    exits, objects: g.objects, rain: RAIN,
    // One watcher in the firs round each clearing: the same tall shape, wherever you are.
    watchers: { count: 1, steps: [6, 999], stepMs: 460 },
    places: [{ name: s.place, x: C[0], y: C[1] + 1 }],
    forest: 'old',
  };
}

// ---- The ranger's camp ----

/** Her hut, its door on the front row's middle (gen-interiors.ts, turning-camp-hut). */
const HUT = { kind: 'house', x: 9, y: 5, w: 3, h: 2, roof: '#4f5a44', lit: 1 } as const;
/** Where the path on gives out, for now: the firs close in. */
const ON_END: P = [2, 10];

function camp(): MapData {
  const g = new Ground(CW, CH);
  g.clearing(12, 9.5, 8.5, 5.6, 7);
  g.trail([CAMP_HOME, [17, 9], [10, 9]]);
  g.trail([[10, 7], [10, 9], [6, 9], [4, 10], ON_END]);
  for (let y = 1; y < CH - 1; y++) for (let x = 1; x < CW - 1; x++) {
    if (g.at(x, y) === 'g' && !g.way[y * CW + x] && Math.hypot((x - 12) / 8.5, (y - 9.5) / 5.6) > 0.75 && hash(x, y, 8) < 0.5) g.set(x, y, 'f');
  }
  g.place({ ...HUT });
  g.place({ kind: 'woodpile', x: 12, y: 6 });
  g.place({ kind: 'stump', x: 14, y: 10, s: 0.8, v: 0.2 });
  g.set(ON_END[0], ON_END[1] - 1, 'g');
  g.place({
    kind: 'sign', x: ON_END[0], y: ON_END[1] - 1,
    text: [
      'An arrow cut in the bark, pointing on into the firs. Under it, in the ranger\'s hand: "On. Mornings."',
      'The firs close in past it, too thick to walk.',
    ],
  });
  return {
    id: 'turning-camp', name: 'The Turning', version: 1, kind: 'wilds', depth: 2, width: CW, height: CH,
    tiles: g.tile.map(r => r.join('')), levels: g.tile.map(r => '0'.repeat(r.length)),
    spawn: { x: CAMP_ENTRY[0], y: CAMP_ENTRY[1], dir: 'left' },
    exits: [backOut(CAMP_HOME[0], CAMP_HOME[1]), doorInto('turning-camp-hut', 'turning-camp', HUT)],
    objects: g.objects, rain: RAIN,
    places: [{ name: 'the ranger\'s camp', x: 12, y: 9 }],
    forest: 'old',
  };
}

// ---- Output ----

const KEYS = ['id', 'name', 'version', 'kind', 'depth', 'width', 'height', 'forest', 'tiles', 'levels', 'spawn', 'exits', 'objects', 'rain', 'watchers', 'places'] as const;
/** One row or object per line, so map changes show up as small, readable diffs. */
function json(map: MapData): string {
  const lines = KEYS.filter(k => map[k] !== undefined).map(k => {
    const v = map[k];
    return Array.isArray(v) && (k === 'tiles' || k === 'levels' || k === 'exits' || k === 'objects' || k === 'places')
      ? `  "${k}": [\n${(v as unknown[]).map(e => `    ${JSON.stringify(e)}`).join(',\n')}\n  ]`
      : `  "${k}": ${JSON.stringify(v)}`;
  });
  return `{\n${lines.join(',\n')}\n}\n`;
}

const maps = [...STAGES.map(stage), camp()];
for (const map of maps) {
  const problems = validateMap(map);
  for (const p of problems) console.log(`${map.id}: ${p.level}: ${p.message}`);
  if (problems.some(p => p.level === 'error')) process.exit(1);
  const out = resolve(import.meta.dirname, `../content/maps/${map.id}.json`);
  writeFileSync(out, json(map));
  const tm = new TileMap(map);
  // Every way out is reached from where you come in, so no clearing hides its way on.
  const from = (x: number, y: number) => {
    const d = new Int32Array(map.width * map.height).fill(-1), q = [y * map.width + x];
    d[q[0]!] = 0;
    for (let h = 0; h < q.length; h++) {
      const i = q[h]!, px = i % map.width, py = (i / map.width) | 0;
      for (const [dx, dy] of SIDES) {
        const nx = px + dx, ny = py + dy, j = ny * map.width + nx;
        if (tm.walkable(nx, ny) && d[j]! < 0) { d[j] = d[i]! + 1; if (!tm.exitAt(nx, ny)) q.push(j); }
      }
    }
    return d;
  };
  const d = from(map.spawn.x, map.spawn.y);
  for (const e of map.exits) if (d[e.y * map.width + e.x]! < 0) throw new Error(`${map.id}: its way out to ${e.to} at ${e.x},${e.y} cannot be walked to from where you come in`);
  let deepest = 0;
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) deepest = Math.max(deepest, tm.homeSteps(x, y));
  const lasts = (lvl: number) => (maxEnergy(lvl) / -energyRate(tm, C[0], C[1] + 1, 'night')).toFixed(0);
  console.log(`wrote ${out}: ${map.width}x${map.height}, ${map.objects.length} objects, ways out ${map.exits.map(e => `${e.to}${e.home ? ' (home)' : ''}`).join(', ')}; deepest ${deepest} steps (${(deepest * STEP_MS / 1000).toFixed(0)} s); a level 1 bar lasts ${lasts(1)} s at night in the middle`);
}

// All three clearings are the same but for what stands in the middle and its clue: the trees, ferns and trails.
const [a, ...rest] = maps.slice(0, 3).map(m => m.tiles);
const clueTiles = new Set<string>();
for (const t of rest) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (t[y]![x] !== a![y]![x]) clueTiles.add(`${x},${y}`);
console.log(`the clearings differ on ${clueTiles.size} tiles (the spring and its brook)`);
