/**
 * The old paper map of a region: a hand drawing made from the map's data, simplified and a little
 * off on purpose, so it reads as drawn by someone who walked it. It never shows where you are, which
 * way you face or anything that moves: finding yourself on it is the game (DESIGN.md, Movement).
 *
 * sketchOf turns a map into what to draw (plain data, so it can be tested); paperMap draws it on a
 * canvas once per map version and keeps it.
 */
import type { TileMap } from '@napoland/shared';

/** Tiles, center to center, apart from which two poles are not on one line (as in the 3D world). */
const MAX_WIRE = 10;
/** How far (tiles) things drift from where they really are. */
const DRIFT = 0.35;
/** A pond is at least this many water tiles; smaller puddles get no name. */
const POND_TILES = 6;
/** How much room a word takes on the paper, in tiles: a letter's width, and a line's height. */
const LETTER = 0.95;
const LINE = 1.9;

type Pt = [number, number];

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
  water: Pt[];
  /** Road tiles, drawn as one band. */
  roads: Pt[];
  /** Cabins, and NAPO's concrete buildings (`flat`: a flat roof, no gable). */
  houses: Array<{ x: number; y: number; w: number; h: number; flat: boolean }>;
  poles: Pt[];
  wires: Array<[Pt, Pt]>;
  /** Radio masts, like the NAPO Tower: tall enough to steer by. */
  masts: Pt[];
  /** Fences, along the middle of their tiles: a yard, a barrier across a road. */
  fences: Array<[Pt, Pt]>;
  cars: Pt[];
  signs: Pt[];
  labels: Array<{ x: number; y: number; text: string }>;
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
    title: map.data.name, width: W, height: H, forest: [], trees: [], ground: [], water: [], roads: [], houses: [], poles: [], wires: [], masts: [], fences: [], cars: [], signs: [], labels: [],
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const kind = map.kind(x, y), r = hash(x, y, 1);
    if (kind === 'forest') {
      s.forest.push([x, y]);
      if (r < 0.2) s.trees.push(drift(x, y, 2));
    } else if (kind === 'water') s.water.push([x, y]);
    else if (kind === 'road') s.roads.push(drift(x, y, 3));
    else if (map.walkable(x, y) && r < 0.12) s.ground.push(drift(x, y, 4));
  }
  for (const o of map.data.objects) {
    if (o.kind === 'house') s.houses.push({ x: o.x + (hash(o.x, o.y, 5) - 0.5) * 0.6, y: o.y + (hash(o.x, o.y, 6) - 0.5) * 0.6, w: o.w, h: o.h, flat: o.style === 'napo' });
    else if (o.kind === 'pole') s.poles.push(drift(o.x, o.y, 8));
    else if (o.kind === 'antenna') s.masts.push(drift(o.x, o.y, 14));
    // Along the middle of its tile, like the fence in the world; drawn with a steady hand, so a yard stays closed.
    else if (o.kind === 'fence') s.fences.push(o.dir === 'h' ? [[o.x, o.y + 0.5], [o.x + 1, o.y + 0.5]] : [[o.x + 0.5, o.y], [o.x + 0.5, o.y + 1]]);
    else if (o.kind === 'car') s.cars.push(drift(o.x, o.y, 9));
    else if (o.kind === 'sign') s.signs.push(drift(o.x, o.y, 10));
  }
  s.poles.forEach((a, i) => s.poles.slice(i + 1).forEach(b => { if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= MAX_WIRE) s.wires.push([a, b]); }));
  for (const e of map.data.exits) {
    const name = nameOf(e.to);
    // Beside the way home (not on the road), above a cabin's roof.
    if (name) s.labels.push(e.home ? { x: e.x + e.w + 4, y: e.y - 1, text: `to ${name}` } : { x: e.x + 0.5, y: e.y - 3.4, text: name });
  }
  // The places people call by name. A map that names none still gets its pond.
  for (const p of map.data.places ?? []) s.labels.push({ x: p.x + 0.5, y: p.y + 0.5, text: p.name });
  const pond = biggest(map, 'water');
  if (!map.data.places && pond.length >= POND_TILES) s.labels.push({ x: pond.reduce((n, [x]) => n + x, 0) / pond.length + 0.5, y: pond.reduce((n, [, y]) => n + y, 0) / pond.length + 0.5, text: 'pond' });
  s.labels = apart(s.labels, W);
  return s;
}

/**
 * Labels where they are drawn (kept off the paper's edge), each moved up a line, or down near the top,
 * until it covers none written before it: two doors side by side get one name above the other.
 */
function apart(labels: Sketch['labels'], width: number): Sketch['labels'] {
  const done: Sketch['labels'] = [];
  const clash = (a: Sketch['labels'][number], b: Sketch['labels'][number]) =>
    Math.abs(a.x - b.x) < ((a.text.length + b.text.length) * LETTER) / 2 && Math.abs(a.y - b.y) < LINE;
  for (const l of labels) {
    const at = { ...l, x: Math.min(width - 3, Math.max(3, l.x)), y: Math.max(0.5, l.y) };
    for (let tries = 0; tries < 8 && done.some(d => clash(at, d)); tries++) at.y = at.y - LINE < 0.5 ? at.y + LINE * (tries + 1) : at.y - LINE;
    done.push(at);
  }
  return done;
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
  g.fillStyle = 'rgba(59,46,34,.35)';
  for (const [x, y] of s.ground) g.fillRect(X(x), Y(y), 1.5, 1.5);
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
  // Cabins: a box with a roof. NAPO's buildings: a flat roof, drawn heavier. Cars: a small box. Signs: a post with a board.
  g.fillStyle = '#c9b48a';
  for (const h of s.houses) {
    g.beginPath(); g.rect(X(h.x), Y(h.y + 0.4), h.w * PX, (h.h - 0.4) * PX); g.fill(); g.stroke();
    if (h.flat) { g.lineWidth = 3; g.beginPath(); g.moveTo(X(h.x - 0.1), Y(h.y + 0.4)); g.lineTo(X(h.x + h.w + 0.1), Y(h.y + 0.4)); g.stroke(); g.lineWidth = 1.6; }
    else { g.beginPath(); g.moveTo(X(h.x - 0.2), Y(h.y + 0.4)); g.lineTo(X(h.x + h.w / 2), Y(h.y - 0.6)); g.lineTo(X(h.x + h.w + 0.2), Y(h.y + 0.4)); g.stroke(); }
  }
  // Masts: a tall narrow A with its cross braces, and a dot at the top for the light.
  g.fillStyle = INK;
  for (const [x, y] of s.masts) {
    const top = Y(y) - PX * 2.2, foot = Y(y) + PX * 0.5, half = PX * 0.45;
    g.beginPath();
    g.moveTo(X(x) - half, foot); g.lineTo(X(x), top); g.lineTo(X(x) + half, foot);
    for (const f of [0.3, 0.6]) { const yy = foot + (top - foot) * f, w = half * (1 - f); g.moveTo(X(x) - w, yy); g.lineTo(X(x) + w, yy); }
    g.stroke();
    g.beginPath(); g.arc(X(x), top, 2, 0, Math.PI * 2); g.fill();
  }
  for (const [x, y] of s.cars) g.strokeRect(X(x) - 7, Y(y) - 4, 14, 8);
  g.beginPath();
  for (const [x, y] of s.signs) { g.moveTo(X(x), Y(y) + 5); g.lineTo(X(x), Y(y) - 5); g.rect(X(x) - 5, Y(y) - 9, 10, 5); }
  g.stroke();

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
  // North is up, as it is on screen.
  const nx = c.width - PX * 3, ny = PX * 3;
  g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(nx, ny + PX * 1.4); g.lineTo(nx, ny - PX * 0.6); g.moveTo(nx - 4, ny - PX * 0.1); g.lineTo(nx, ny - PX * 0.6); g.lineTo(nx + 4, ny - PX * 0.1); g.stroke();
  g.font = `italic 700 ${PX * 1.2}px ${HAND}`;
  g.fillText('N', nx, ny - PX * 1.3);
  return c;
}
