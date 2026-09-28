/**
 * The old paper map of an area: a hand drawing made from the map's data, simplified and a little
 * off on purpose, so it reads as drawn by someone who walked it. It never shows where you are, which
 * way you face or anything that moves: finding yourself on it is the game (DESIGN.md, Movement).
 * The one map button opens the map of the area you are in (mapFor), if you carry it.
 *
 * sketchOf turns a map into what to draw (plain data, so it can be tested); paperMap draws it on a
 * canvas once per map version and keeps it.
 */
import { doorOf, footprint, type MapData, type TileMap } from '@napoland/shared';

/** Tiles, center to center, apart from which two poles are not on one line (as in the 3D world). */
const MAX_WIRE = 10;
/** How far (tiles) things drift from where they really are. */
const DRIFT = 0.35;
/** A pond is at least this many water tiles; smaller puddles get no name. */
const POND_TILES = 6;
/** How much room a word takes on the paper, in tiles: a letter's width, and a line's height. */
const LETTER = 0.95;
const LINE = 1.9;
/**
 * How far from its point a landmark the words keep clear of is drawn (tiles): a mast from this far
 * above down to this far below, this wide each side; a sign's board up top, and its post.
 */
const MAST_TOP = 2.2;
const MAST_FOOT = 0.5;
const MAST_HALF = 0.45;
const SIGN_TOP = 0.75;
const SIGN_HALF = 5 / 12;

type Pt = [number, number];
/** What a drawing covers on the paper, in tiles. */
interface Box { x0: number; x1: number; y0: number; y1: number }
const mastBox = ([x, y]: Pt): Box => ({ x0: x - MAST_HALF, x1: x + MAST_HALF, y0: y - MAST_TOP, y1: y + MAST_FOOT });
const signBox = ([x, y]: Pt): Box => ({ x0: x - SIGN_HALF, x1: x + SIGN_HALF, y0: y - SIGN_TOP, y1: y + SIGN_HALF });

export interface Sketch {
  title: string;
  /** Size in tiles. */
  width: number;
  height: number;
  /** Every forest tile, shaded, so paths and clearings stand out as bare paper. */
  forest: Pt[];
  /** Tree scribbles over the forest: only some trees, and not quite where they stand. */
  trees: Pt[];
  /** A dot here and there on open ground, so clearings and trails show against the forest. */
  ground: Pt[];
  /** Tall grass, where you hide from creatures: a hatch of short strokes on each of its tiles, so a route can run from patch to patch. */
  grass: Pt[];
  water: Pt[];
  /** Road tiles, drawn as one band. */
  roads: Pt[];
  /** Cabins, NAPO's concrete buildings (`flat`: a flat roof, no gable), the sawmill (`mill`: a sawtooth roof) and sheds (`shed`: a lean-to's one slope). */
  houses: Array<{ x: number; y: number; w: number; h: number; flat: boolean; mill: boolean; shed?: boolean }>;
  poles: Pt[];
  wires: Array<[Pt, Pt]>;
  /** Radio masts, like the NAPO Tower: tall enough to steer by. */
  masts: Pt[];
  /** Fences, along the middle of their tiles: a yard, a barrier across a road. */
  fences: Array<[Pt, Pt]>;
  /** Cars, trucks and jeeps, by the middle of their tiles and their size (w by h tiles); a jeep burned out. */
  cars: Array<{ at: Pt; w: number; h: number; kind: 'car' | 'truck' | 'jeep' }>;
  signs: Pt[];
  /** Log decks, on their tiles: drawn as the ends of their logs. */
  logs: Array<{ x: number; y: number; w: number; h: number }>;
  /** Stumps where the firs were cut, and NAPO's survey stakes with their flags. */
  stumps: Pt[];
  stakes: Pt[];
  /** The logs across a skid road, each a short line across it. */
  skids: Array<[Pt, Pt]>;
  /** Small things left in the places, each with a mark of its own. */
  things: Array<{ at: Pt; kind: Thing }>;
  /** Flooded culverts, each the middles of its tiles from one mouth to the other: a dashed line, and "flooded" beside it. */
  culverts: Pt[][];
  labels: Array<{ x: number; y: number; text: string }>;
}

/** The small things the paper map marks, each its own way. */
type Thing = 'luggage' | 'boxes' | 'rocker' | 'piano' | 'bike' | 'birdcage' | 'pump' | 'cage' | 'mailbox';
const THINGS = new Set<string>(['luggage', 'boxes', 'rocker', 'piano', 'bike', 'birdcage', 'pump', 'cage']);

/** The area a map belongs to: the map itself, or for a room the place its door opens onto. */
export function areaOf(id: string, find: (id: string) => MapData | undefined): string {
  const here = find(id);
  if (here?.kind !== 'inside') return id;
  return here.exits.map(e => e.to).find(to => find(to)?.kind !== 'inside') ?? id;
}

/** Which of your tools is the map of the area you are in: the one that charts it, if you carry it (some areas have none). */
export function mapFor(here: string, tools: readonly string[], chartOf: (item: string) => string | undefined, find: (id: string) => MapData | undefined): string | undefined {
  const area = areaOf(here, find);
  return tools.find(t => chartOf(t) === area);
}

/** A number from 0 to 1 that is always the same for a tile (and a salt). */
function hash(x: number, y: number, k = 0): number {
  let n = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(k + 1, 2147483647);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Tile x,y's center, moved a little: a hand is never exact. */
const drift = (x: number, y: number, k = 0): Pt => [x + 0.5 + (hash(x, y, k) - 0.5) * 2 * DRIFT, y + 0.5 + (hash(x, y, k + 7) - 0.5) * 2 * DRIFT];

/** What to draw for a map; `nameOf` names the maps its exits lead to (the cabins, the way home). */
export function sketchOf(map: TileMap, nameOf: (id: string) => string | undefined): Sketch {
  const { width: W, height: H } = map;
  const s: Sketch = {
    title: map.data.name, width: W, height: H, forest: [], trees: [], ground: [], grass: [], water: [], roads: [], houses: [], poles: [], wires: [], masts: [], fences: [], cars: [], signs: [],
    logs: [], stumps: [], stakes: [], skids: [], things: [], culverts: [], labels: [],
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const kind = map.kind(x, y), r = hash(x, y, 1);
    if (kind === 'forest') {
      s.forest.push([x, y]);
      if (r < 0.2) s.trees.push(drift(x, y, 2));
    } else if (kind === 'water') s.water.push([x, y]);
    else if (kind === 'road') s.roads.push(drift(x, y, 3));
    // Every tile of it, a little off: a patch keeps its shape, which is what a route is planned by.
    else if (kind === 'tallgrass') s.grass.push(drift(x, y, 15));
    else if (map.walkable(x, y) && r < 0.12) s.ground.push(drift(x, y, 4));
  }
  for (const o of map.data.objects) {
    if (o.kind === 'house') {
      s.houses.push({ x: o.x + (hash(o.x, o.y, 5) - 0.5) * 0.6, y: o.y + (hash(o.x, o.y, 6) - 0.5) * 0.6, w: o.w, h: o.h, flat: o.style === 'napo', mill: o.style === 'mill', ...(o.style === 'shed' ? { shed: true } : {}) });
    }
    else if (o.kind === 'pole') s.poles.push(drift(o.x, o.y, 8));
    else if (o.kind === 'antenna') s.masts.push(drift(o.x, o.y, 14));
    // Along the middle of its tile, like the fence in the world; drawn with a steady hand, so a yard stays closed.
    else if (o.kind === 'fence') s.fences.push(o.dir === 'h' ? [[o.x, o.y + 0.5], [o.x + 1, o.y + 0.5]] : [[o.x + 0.5, o.y], [o.x + 0.5, o.y + 1]]);
    else if (o.kind === 'car' || o.kind === 'truck' || o.kind === 'jeep') {
      const [w, h] = footprint(o), [dx, dy] = drift(o.x, o.y, 9);
      s.cars.push({ at: [dx - 0.5 + w / 2, dy - 0.5 + h / 2], w, h, kind: o.kind });
    } else if (o.kind === 'sign' && o.style === 'mailbox') s.things.push({ at: drift(o.x, o.y, 16), kind: 'mailbox' });
    else if (o.kind === 'sign') s.signs.push(drift(o.x, o.y, 10));
    else if (o.kind === 'logs') s.logs.push({ x: o.x, y: o.y, w: o.w, h: o.h });
    else if (o.kind === 'stump') s.stumps.push(drift(o.x, o.y, 17));
    else if (o.kind === 'stake') s.stakes.push(drift(o.x, o.y, 18));
    // Across the road, as the skid lies.
    else if (o.kind === 'skid') s.skids.push(o.dir === 'h' ? [[o.x + 0.5, o.y + 0.15], [o.x + 0.5, o.y + 0.85]] : [[o.x + 0.15, o.y + 0.5], [o.x + 0.85, o.y + 0.5]]);
    else if (THINGS.has(o.kind)) s.things.push({ at: o.kind === 'piano' ? [o.x + 1, o.y + 0.5] : drift(o.x, o.y, 19), kind: o.kind as Thing });
  }
  s.poles.forEach((a, i) => s.poles.slice(i + 1).forEach(b => { if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= MAX_WIRE) s.wires.push([a, b]); }));
  s.culverts = culvertRuns(map);
  // The ways out first, then the places people call by name, then the buildings by their doors: a name
  // people steer by keeps its spot, and a door's name finds room around it (a street of houses has many).
  // A name is written once: where the map names a place as its door does, the place's name stands.
  const placed = new Set((map.data.places ?? []).map(p => p.name.toLowerCase()));
  const doors = new Set(map.data.objects.flatMap(o => (o.kind === 'house' ? [`${doorOf(o).x},${doorOf(o).y}`] : [])));
  const exits = map.data.exits.filter(e => !doors.has(`${e.x},${e.y}`)), rooms = map.data.exits.filter(e => doors.has(`${e.x},${e.y}`));
  const labels: Array<Sketch['labels'][number] & { below?: number }> = [];
  const exitLabel = (e: MapData['exits'][number]) => {
    const name = nameOf(e.to);
    // Beside the way home (not on the road), above a cabin's roof (or, where the roofs of a street are
    // taken, in front of its door).
    if (name && !placed.has(name.toLowerCase())) labels.push(e.home ? { x: e.x + e.w + 4, y: e.y - 1, text: `to ${name}` } : { x: e.x + 0.5, y: e.y - 3.4, text: name, below: e.y + 3 });
  };
  exits.forEach(exitLabel);
  // The places people call by name. A map that names none still gets its pond.
  for (const p of map.data.places ?? []) labels.push({ x: p.x + 0.5, y: p.y + 0.5, text: p.name });
  rooms.forEach(exitLabel);
  const pond = biggest(map, 'water');
  if (!map.data.places && pond.length >= POND_TILES) labels.push({ x: pond.reduce((n, [x]) => n + x, 0) / pond.length + 0.5, y: pond.reduce((n, [, y]) => n + y, 0) / pond.length + 0.5, text: 'pond' });
  // Last, so every name written before keeps its spot: "flooded" beside the middle of each culvert.
  for (const run of s.culverts) {
    const [x, y] = run[Math.floor(run.length / 2)]!;
    labels.push({ x: x + 3.5, y, text: 'flooded' });
  }
  s.labels = apart(labels, W, H, [...s.masts.map(mastBox), ...s.signs.map(signBox)]);
  return s;
}

/**
 * Labels where they are drawn (kept off the paper's edge), each on the nearest line (a line up first,
 * then down, then two up...) where it covers no name written before it, no mast and no sign: two doors
 * side by side get one name above the other, and a place named at its mast gets its name clear of it.
 * A door's name that finds no room a line from its roof goes in front of the door (`below`) before
 * it goes farther up or down.
 */
function apart(labels: ReadonlyArray<Sketch['labels'][number] & { below?: number }>, width: number, height: number, marks: Box[]): Sketch['labels'] {
  type Label = Sketch['labels'][number];
  const done: Sketch['labels'] = [];
  const half = (l: Label) => (l.text.length * LETTER) / 2;
  const clash = (a: Label, b: Label) => Math.abs(a.x - b.x) < half(a) + half(b) && Math.abs(a.y - b.y) < LINE;
  const covers = (a: Label) => marks.some(m => a.x + half(a) > m.x0 && a.x - half(a) < m.x1 && a.y + LINE / 2 > m.y0 && a.y - LINE / 2 < m.y1);
  const free = (a: Label) => !done.some(d => clash(a, d)) && !covers(a);
  for (const { below, ...l } of labels) {
    const at = { ...l, x: Math.min(width - 3, Math.max(3, l.x)), y: Math.max(0.5, l.y) };
    const near = [0, -1, 1].map(n => at.y + n * LINE), far = [-2, 2, -3, 3, -4, 4].map(n => at.y + n * LINE);
    const lines = [...near, ...(below === undefined ? [] : [below]), ...far].filter(y => y >= 0.5 && y <= height - 0.5);
    done.push({ ...at, y: lines.find(y => free({ ...at, y })) ?? at.y });
  }
  return done;
}

/**
 * Each flooded culvert as a line through its tiles, from one mouth to the other: it starts at a tile with
 * one culvert tile beside it (an end), and goes on to the one beside it it has not been on.
 */
export function culvertRuns(map: TileMap): Pt[][] {
  const W = map.width, seen = new Set<number>(), runs: Pt[][] = [];
  const culvert = (x: number, y: number) => map.kind(x, y) === 'culvert';
  const next = (x: number, y: number): Pt[] => ([[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]] as Pt[]).filter(([nx, ny]) => culvert(nx, ny) && !seen.has(ny * W + nx));
  for (const loose of [true, false]) for (let y = 0; y < map.height; y++) for (let x = 0; x < W; x++) {
    // Ends first; a culvert with no end (a ring) from anywhere on it.
    if (!culvert(x, y) || seen.has(y * W + x) || (loose && next(x, y).length !== 1)) continue;
    const run: Pt[] = [];
    for (let at: Pt | undefined = [x, y]; at; at = next(at[0], at[1])[0]) {
      seen.add(at[1] * W + at[0]);
      run.push([at[0] + 0.5, at[1] + 0.5]);
    }
    runs.push(run);
  }
  return runs;
}

/** The biggest patch of joined tiles of one kind. */
function biggest(map: TileMap, kind: string): Pt[] {
  const seen = new Set<number>();
  let best: Pt[] = [];
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    if (map.kind(x, y) !== kind || seen.has(y * map.width + x)) continue;
    const patch: Pt[] = [], todo: Pt[] = [[x, y]];
    seen.add(y * map.width + x);
    while (todo.length) {
      const [px, py] = todo.pop()!;
      patch.push([px, py]);
      for (const [nx, ny] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]] as Pt[]) {
        if (map.kind(nx, ny) !== kind || seen.has(ny * map.width + nx)) continue;
        seen.add(ny * map.width + nx);
        todo.push([nx, ny]);
      }
    }
    if (patch.length > best.length) best = patch;
  }
  return best;
}

/**
 * A small thing, drawn the way a hand would mark it at px, py: a suitcase with its handle, a pair of
 * boxes, a rocking chair from the side, a piano with its keys, a bike's two wheels, a birdcage's dome,
 * NAPO's pump with its hose and its cages crosshatched, a mailbox on its post.
 */
function thing(g: CanvasRenderingContext2D, kind: Thing, px: number, py: number) {
  g.beginPath();
  switch (kind) {
    case 'luggage': g.rect(px - 3.5, py - 2, 7, 5); g.moveTo(px - 1.5, py - 2); g.lineTo(px - 1.5, py - 3.5); g.lineTo(px + 1.5, py - 3.5); g.lineTo(px + 1.5, py - 2); break;
    case 'boxes': g.rect(px - 4, py - 1, 5, 5); g.rect(px - 1, py - 4, 4.5, 4); break;
    case 'rocker': g.moveTo(px - 4, py + 3); g.quadraticCurveTo(px, py + 5, px + 4, py + 3); g.moveTo(px - 2, py + 3.5); g.lineTo(px - 2, py - 1); g.lineTo(px + 2, py - 1); g.lineTo(px + 2, py + 3.5); g.moveTo(px + 2, py - 1); g.lineTo(px + 3, py - 5); break;
    case 'piano': g.rect(px - 9, py - 3, 18, 6); for (const k of [-5, -1, 3]) { g.moveTo(px + k, py + 3); g.lineTo(px + k, py + 1); } break;
    case 'bike': g.moveTo(px - 0.5, py); g.arc(px - 3, py, 2.5, 0, Math.PI * 2); g.moveTo(px + 5.5, py); g.arc(px + 3, py, 2.5, 0, Math.PI * 2); g.moveTo(px - 3, py); g.lineTo(px, py - 3); g.lineTo(px + 3, py); break;
    case 'birdcage': g.moveTo(px - 3, py + 3); g.lineTo(px - 3, py - 1); g.quadraticCurveTo(px, py - 6, px + 3, py - 1); g.lineTo(px + 3, py + 3); g.lineTo(px - 3, py + 3); break;
    case 'pump': g.rect(px - 2, py - 4, 4, 8); g.moveTo(px + 2, py - 2); g.quadraticCurveTo(px + 5, py, px + 3, py + 3); break;
    case 'cage': g.rect(px - 4, py - 4, 8, 8); g.moveTo(px - 4, py); g.lineTo(px + 4, py); g.moveTo(px, py - 4); g.lineTo(px, py + 4); break;
    case 'mailbox': g.rect(px - 2.5, py - 4, 5, 3); g.moveTo(px, py - 1); g.lineTo(px, py + 4); break;
  }
  g.stroke();
}

/** Pixels per tile, and the paper's margin in tiles. */
const PX = 12;
const MARGIN = 4;
const INK = '#3b2e22';
const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive';

const drawn = new Map<string, HTMLCanvasElement>();

/** The drawing of a map, made once per map version. */
export function paperMap(map: TileMap, nameOf: (id: string) => string | undefined): HTMLCanvasElement {
  const key = `${map.data.id}@${map.data.version}`;
  let c = drawn.get(key);
  if (!c) drawn.set(key, (c = draw(sketchOf(map, nameOf))));
  return c;
}

function draw(s: Sketch): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = (s.width + MARGIN * 2) * PX;
  c.height = (s.height + MARGIN * 2 + 3) * PX;
  const g = c.getContext('2d')!;
  // Tile coordinates to pixels, below the title.
  const X = (x: number) => (x + MARGIN) * PX, Y = (y: number) => (y + MARGIN + 3) * PX;

  // Old paper: a warm sheet, flecks, darker toward the edges, and the folds.
  g.fillStyle = '#e6d6b3';
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = hash(i, 0, 11) < 0.5 ? 'rgba(120,90,50,.08)' : 'rgba(255,250,235,.12)';
    g.fillRect(hash(i, 1, 11) * c.width, hash(i, 2, 11) * c.height, 1 + hash(i, 3, 11) * 2, 1 + hash(i, 4, 11) * 2);
  }
  const edge = g.createRadialGradient(c.width / 2, c.height / 2, Math.min(c.width, c.height) * 0.3, c.width / 2, c.height / 2, Math.max(c.width, c.height) * 0.7);
  edge.addColorStop(0, 'rgba(90,60,30,0)');
  edge.addColorStop(1, 'rgba(90,60,30,.35)');
  g.fillStyle = edge;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(90,60,30,.15)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(c.width / 2, 0); g.lineTo(c.width / 2, c.height);
  g.moveTo(0, c.height / 2); g.lineTo(c.width, c.height / 2);
  g.stroke();

  g.lineCap = 'round';
  g.lineJoin = 'round';
  // The forest: a soft pencil shade, paths left bare. One pixel a tile, scaled up smoothly, so its edges blur like pencil.
  const shade = document.createElement('canvas');
  shade.width = s.width;
  shade.height = s.height;
  const sg = shade.getContext('2d')!;
  sg.fillStyle = 'rgb(95,105,70)';
  for (const [x, y] of s.forest) sg.fillRect(x, y, 1, 1);
  g.globalAlpha = 0.18;
  g.imageSmoothingEnabled = true;
  g.drawImage(shade, X(0), Y(0), s.width * PX, s.height * PX);
  g.globalAlpha = 1;
  // Water: a wash of blue, then a few ripples.
  g.fillStyle = 'rgba(80,125,150,.45)';
  for (const [x, y] of s.water) { g.beginPath(); g.arc(X(x + 0.5), Y(y + 0.5), PX * 0.8, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = 'rgba(40,70,90,.6)';
  g.lineWidth = 1;
  for (const [x, y] of s.water) {
    if (hash(x, y, 12) > 0.25) continue;
    g.beginPath(); g.moveTo(X(x + 0.1), Y(y + 0.5)); g.quadraticCurveTo(X(x + 0.5), Y(y + 0.2), X(x + 0.9), Y(y + 0.5)); g.stroke();
  }
  // A flooded culvert: a dashed line in the water's ink, a ring at each mouth.
  g.strokeStyle = 'rgba(40,70,90,.8)';
  g.lineWidth = 1.6;
  g.setLineDash([5, 3]);
  for (const run of s.culverts) {
    g.beginPath();
    run.forEach(([x, y], k) => (k ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
    g.stroke();
  }
  g.setLineDash([]);
  for (const run of s.culverts) for (const [x, y] of [run[0]!, run.at(-1)!]) { g.beginPath(); g.arc(X(x), Y(y), PX * 0.3, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = 'rgba(59,46,34,.35)';
  for (const [x, y] of s.ground) g.fillRect(X(x), Y(y), 1.5, 1.5);
  // Tall grass: three short strokes a tile, splayed like a tuft, in a green-grey pencil.
  const tuft = (px: number, py: number) => {
    for (const [dx, lean, len] of [[-0.24, -0.28, 0.42], [0, 0, 0.55], [0.24, 0.28, 0.42]] as const) {
      g.moveTo(px + dx * PX, py);
      g.lineTo(px + (dx + lean * len) * PX, py - len * PX);
    }
  };
  g.strokeStyle = 'rgba(66,84,44,.85)';
  g.lineWidth = 1.1;
  g.beginPath();
  for (const [x, y] of s.grass) tuft(X(x), Y(y) + PX * 0.25);
  g.stroke();
  // Trees: a trunk and a little pointed crown.
  g.strokeStyle = 'rgba(59,46,34,.75)';
  g.lineWidth = 1.2;
  for (const [x, y] of s.trees) {
    g.beginPath();
    g.moveTo(X(x), Y(y) + PX * 0.45); g.lineTo(X(x), Y(y) + PX * 0.15);
    g.moveTo(X(x) - PX * 0.35, Y(y) + PX * 0.2); g.lineTo(X(x), Y(y) - PX * 0.5); g.lineTo(X(x) + PX * 0.35, Y(y) + PX * 0.2);
    g.stroke();
  }
  // The road: a band of brown, dabbed on.
  g.fillStyle = 'rgba(130,95,55,.45)';
  for (const [x, y] of s.roads) { g.beginPath(); g.arc(X(x), Y(y), PX * 0.62, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = INK;
  // The power line: poles as little crosses, the wire dashed between them.
  g.lineWidth = 1;
  g.setLineDash([4, 4]);
  g.beginPath();
  for (const [a, b] of s.wires) { g.moveTo(X(a[0]), Y(a[1])); g.lineTo(X(b[0]), Y(b[1])); }
  g.stroke();
  g.setLineDash([]);
  g.lineWidth = 1.6;
  g.beginPath();
  for (const [x, y] of s.poles) { g.moveTo(X(x), Y(y) - 5); g.lineTo(X(x), Y(y) + 5); g.moveTo(X(x) - 4, Y(y) - 3); g.lineTo(X(x) + 4, Y(y) - 3); }
  g.stroke();
  // Fences: a line, with a post where each piece of it starts.
  g.lineWidth = 1;
  g.beginPath();
  for (const [a, b] of s.fences) { g.moveTo(X(a[0]), Y(a[1])); g.lineTo(X(b[0]), Y(b[1])); }
  g.stroke();
  g.fillStyle = INK;
  for (const [a] of s.fences) g.fillRect(X(a[0]) - 1, Y(a[1]) - 1, 2, 2);
  g.lineWidth = 1.6;
  // Cabins: a box with a roof. NAPO's buildings: a flat roof, drawn heavier. The mill: its sawtooth.
  // Cars: a small box, a truck a long one with its cab marked, a burned jeep crossed out. Signs: a post with a board.
  g.fillStyle = '#c9b48a';
  for (const h of s.houses) {
    g.beginPath(); g.rect(X(h.x), Y(h.y + 0.4), h.w * PX, (h.h - 0.4) * PX); g.fill(); g.stroke();
    if (h.flat) { g.lineWidth = 3; g.beginPath(); g.moveTo(X(h.x - 0.1), Y(h.y + 0.4)); g.lineTo(X(h.x + h.w + 0.1), Y(h.y + 0.4)); g.stroke(); g.lineWidth = 1.6; }
    else if (h.mill) {
      const teeth = Math.max(2, Math.round(h.w / 2)), tw = h.w / teeth;
      g.beginPath(); g.moveTo(X(h.x), Y(h.y + 0.4));
      for (let k = 0; k < teeth; k++) { g.lineTo(X(h.x + tw * (k + 1)), Y(h.y - 0.4)); g.lineTo(X(h.x + tw * (k + 1)), Y(h.y + 0.4)); }
      g.stroke();
    } else if (h.shed) { g.beginPath(); g.moveTo(X(h.x - 0.15), Y(h.y + 0.4)); g.lineTo(X(h.x + h.w + 0.15), Y(h.y - 0.2)); g.stroke(); }
    else { g.beginPath(); g.moveTo(X(h.x - 0.2), Y(h.y + 0.4)); g.lineTo(X(h.x + h.w / 2), Y(h.y - 0.6)); g.lineTo(X(h.x + h.w + 0.2), Y(h.y + 0.4)); g.stroke(); }
  }
  // Masts: a tall narrow A with its cross braces, and a dot at the top for the light.
  g.fillStyle = INK;
  for (const [x, y] of s.masts) {
    const top = Y(y) - PX * MAST_TOP, foot = Y(y) + PX * MAST_FOOT, half = PX * MAST_HALF;
    g.beginPath();
    g.moveTo(X(x) - half, foot); g.lineTo(X(x), top); g.lineTo(X(x) + half, foot);
    for (const f of [0.3, 0.6]) { const yy = foot + (top - foot) * f, w = half * (1 - f); g.moveTo(X(x) - w, yy); g.lineTo(X(x) + w, yy); }
    g.stroke();
    g.beginPath(); g.arc(X(x), top, 2, 0, Math.PI * 2); g.fill();
  }
  for (const c of s.cars) {
    const long = Math.max(c.w, c.h) * 7, across = 8, wide = c.w >= c.h;
    const [w, h] = wide ? [long, across] : [across, long], x0 = X(c.at[0]) - w / 2, y0 = Y(c.at[1]) - h / 2;
    g.strokeRect(x0, y0, w, h);
    g.beginPath();
    if (c.kind === 'truck') { if (wide) { g.moveTo(x0 + w * 0.7, y0); g.lineTo(x0 + w * 0.7, y0 + h); } else { g.moveTo(x0, y0 + h * 0.7); g.lineTo(x0 + w, y0 + h * 0.7); } }
    if (c.kind === 'jeep') { g.moveTo(x0, y0); g.lineTo(x0 + w, y0 + h); g.moveTo(x0 + w, y0); g.lineTo(x0, y0 + h); }
    g.stroke();
  }
  g.beginPath();
  for (const [x, y] of s.signs) { g.moveTo(X(x), Y(y) + PX * SIGN_HALF); g.lineTo(X(x), Y(y) - PX * SIGN_HALF); g.rect(X(x) - PX * SIGN_HALF, Y(y) - PX * SIGN_TOP, PX * SIGN_HALF * 2, PX * SIGN_HALF); }
  g.stroke();
  // Log decks: the ends of their logs, a pile of little rings (seen from the side when they lie east to west).
  g.lineWidth = 1;
  for (const l of s.logs) {
    const along = l.h === 1 && l.w > 1 ? 'x' : 'z', n = Math.max(2, Math.round((along === 'x' ? l.h : l.w) * 2.4));
    g.beginPath();
    if (along === 'x') for (let k = 0; k < 3; k++) { const y = Y(l.y + 0.3 + k * 0.2); g.moveTo(X(l.x + 0.1), y); g.lineTo(X(l.x + l.w - 0.1), y); }
    else for (let row = 0; row < 2; row++) for (let i = 0; i < n - row; i++) {
      const cx = X(l.x + (i + 0.5 + row / 2) * ((l.w - 0.2) / n) + 0.1), cy = Y(l.y + l.h * 0.5 - row * 0.35);
      g.moveTo(cx + PX * 0.18, cy); g.arc(cx, cy, PX * 0.18, 0, Math.PI * 2);
    }
    g.stroke();
  }
  // Stumps: a ring with its heart. Stakes: a post with a little flag. Skids: a short line across the road.
  g.beginPath();
  for (const [x, y] of s.stumps) { g.moveTo(X(x) + 3, Y(y)); g.arc(X(x), Y(y), 3, 0, Math.PI * 2); }
  for (const [a, b] of s.skids) { g.moveTo(X(a[0]), Y(a[1])); g.lineTo(X(b[0]), Y(b[1])); }
  g.stroke();
  for (const [x, y] of s.stumps) g.fillRect(X(x) - 0.75, Y(y) - 0.75, 1.5, 1.5);
  g.beginPath();
  for (const [x, y] of s.stakes) { g.moveTo(X(x), Y(y) + 4); g.lineTo(X(x), Y(y) - 5); g.lineTo(X(x) + 5, Y(y) - 3); g.lineTo(X(x), Y(y) - 1); }
  g.stroke();
  for (const t of s.things) thing(g, t.kind, X(t.at[0]), Y(t.at[1]));
  g.lineWidth = 1.6;

  // Words in handwriting, each a little tilted.
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `italic 700 ${PX * 2.4}px ${HAND}`;
  g.fillText(s.title, c.width / 2, PX * 3);
  g.font = `italic ${PX * 1.8}px ${HAND}`;
  s.labels.forEach((l, i) => {
    g.save();
    g.translate(X(l.x), Y(l.y));
    g.rotate((hash(i, 0, 13) - 0.5) * 0.15);
    g.fillText(l.text, 0, 0);
    g.restore();
  });
  // A key in the margin for the one mark that is not a picture of its thing.
  if (s.grass.length) {
    const kx = X(0.5), ky = Y(s.height + 2.2);
    g.strokeStyle = 'rgba(66,84,44,.85)';
    g.lineWidth = 1.1;
    g.beginPath();
    tuft(kx, ky);
    g.stroke();
    g.textAlign = 'left';
    g.font = `italic ${PX * 1.4}px ${HAND}`;
    g.fillText('tall grass: nothing follows you in', kx + PX * 1.1, ky - PX * 0.3);
    g.textAlign = 'center';
  }
  // North is up, as it is on screen.
  const nx = c.width - PX * 3, ny = PX * 3;
  g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(nx, ny + PX * 1.4); g.lineTo(nx, ny - PX * 0.6); g.moveTo(nx - 4, ny - PX * 0.1); g.lineTo(nx, ny - PX * 0.6); g.lineTo(nx + 4, ny - PX * 0.1); g.stroke();
  g.font = `italic 700 ${PX * 1.2}px ${HAND}`;
  g.fillText('N', nx, ny - PX * 1.3);
  return c;
}
