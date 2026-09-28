/**
 * The insides of buildings, FireRed style under the same steep camera: a wooden floor, walls as solid
 * blocks with a darker top edge, and black all around the room. The camera looks north, so the back
 * wall stands tall (with windows), the side walls too, and the front wall is cut down to a low
 * baseboard with a gap where the door is: drawn tall, it would hide the room and whoever is in it.
 *
 * The layout rules are plain functions of the map (tested without a browser); the builders make
 * geometry for world.ts. Floors and walls are quads added to the terrain mesh; windows, doormats and
 * furniture never move, so world.ts bakes them with the other props.
 */
import * as THREE from 'three';
import { doorOf, type Dir, type MapData, type MapObject, type TileMap } from '@napoland/shared';
import { box, flat, hash2, part, pivot, toon } from './toon';

/** Height of a wall that stands (the back and side walls), and of one cut down to a baseboard (the front). */
export const WALL_TALL = 2.4;
export const WALL_LOW = 0.2;
/** Width of the lighter rim along a wall top's edge on the room side. */
const RIM = 0.14;
/** Middle of a window, up the back wall. */
const WINDOW_Y = 1.45;

/** How a wall tile is drawn: standing, cut down low, or not at all (buried in other walls, never seen). */
export type WallShape = 'tall' | 'low' | 'none';

/** A tile anyone could be seen on: inside the map and not a wall. */
const open = (map: TileMap, x: number, y: number) => map.inside(x, y) && map.kind(x, y) !== 'wall';

/**
 * For every tile (index y * width + x): how its wall is drawn, 'none' for tiles that are not walls.
 * A wall with room just north of it is in front of that room as the camera sees it, so it is cut
 * low; so is a front corner (room diagonally north, wall beside it). Other walls next to the room
 * stand tall, and walls with no room around them are not drawn at all (black, like the void).
 */
export function wallShapes(map: TileMap): WallShape[] {
  const W = map.width, H = map.height, out = new Array<WallShape>(W * H).fill('none');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (map.kind(x, y) !== 'wall') continue;
    let seen = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (open(map, x + dx, y + dy)) seen = true;
    if (!seen) continue;
    const front = open(map, x, y - 1) || (open(map, x + 1, y - 1) && !open(map, x + 1, y)) || (open(map, x - 1, y - 1) && !open(map, x - 1, y));
    out[y * W + x] = front ? 'low' : 'tall';
  }
  return out;
}

const objectsOf = <K extends MapObject['kind']>(data: MapData, kind: K) => data.objects.filter((o): o is Extract<MapObject, { kind: K }> => o.kind === kind);

/** A fireplace built against a wall (a hearth), rather than standing free (a campfire). */
export function hearthAt(map: TileMap, x: number, y: number): boolean {
  return map.kind(x, y - 1) === 'wall';
}

/** Does this map keep a fire burning? (A room with one is warm; a house leading to one smokes.) */
export function hasFire(data: MapData | undefined): boolean {
  return !!data?.objects.some(o => o.kind === 'fireplace');
}

/**
 * Where windows go: in standing back walls with room in front, between two other wall tiles, and not
 * over a fireplace (its chimney is there), a shelf or a workbench (the board its tools hang on). One
 * in a narrow room; two in a wide one, a quarter of the way in from each side.
 */
export function windowSpots(map: TileMap, shapes: readonly WallShape[]): Array<{ x: number; y: number }> {
  const W = map.width, busy = new Set<string>();
  for (const f of objectsOf(map.data, 'fireplace')) for (const dx of [-1, 0, 1]) busy.add(`${f.x + dx},${f.y}`);
  for (const s of [...objectsOf(map.data, 'shelf'), ...objectsOf(map.data, 'workbench')]) busy.add(`${s.x},${s.y}`);
  const tall = (x: number, y: number) => map.inside(x, y) && shapes[y * W + x] === 'tall';
  const spots: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < map.height; y++) for (let x = 0; x < W; x++) {
    if (tall(x, y) && tall(x - 1, y) && tall(x + 1, y) && open(map, x, y + 1) && !busy.has(`${x},${y + 1}`)) spots.push({ x, y });
  }
  if (!spots.length) return [];
  const xs = spots.map(s => s.x), lo = Math.min(...xs), hi = Math.max(...xs);
  // The spot nearest x = t; on a tie the one farther out on its side, so a pair sits symmetric.
  const nearest = (t: number, east: boolean) => spots.reduce((best, s) => {
    const d = Math.abs(s.x - t) - Math.abs(best.x - t);
    return d < 0 || (d === 0 && east && s.x > best.x) ? s : best;
  });
  if (hi - lo < 4) return [nearest((lo + hi) / 2, false)];
  const a = nearest(lo + (hi - lo) * 0.25, false), b = nearest(lo + (hi - lo) * 0.75, true);
  return a === b ? [a] : [a, b];
}

/** Every exit tile, with the way out through it (the facing its exit gives on arrival: out the bottom door, down). */
export function doorways(map: TileMap): Array<{ x: number; y: number; dir: Dir }> {
  const out: Array<{ x: number; y: number; dir: Dir }> = [];
  for (const e of map.data.exits) for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) out.push({ x, y, dir: e.dir });
  return out;
}

/**
 * Every house on the map with its door (open: every building can be entered) and whether the room
 * behind it keeps a fire. `peek` finds another map's data by id; a house whose inside is unknown
 * has no fire.
 */
export function houseDoors(map: TileMap, peek: (id: string) => MapData | undefined): Array<{ house: Extract<MapObject, { kind: 'house' }>; x: number; y: number; fire: boolean }> {
  return objectsOf(map.data, 'house').map(house => {
    const d = doorOf(house), exit = map.exitAt(d.x, d.y);
    return { house, x: d.x, y: d.y, fire: !!exit && hasFire(peek(exit.to)) };
  });
}

// ---------- floors and walls, as quads of the terrain mesh ----------

type V3 = readonly [number, number, number];
/** Adds a quad to the terrain: one color, or one per corner (a, b, c, d). */
export type QuadFn = (a: V3, b: V3, c: V3, d: V3, ca: THREE.Color, cb?: THREE.Color, cc?: THREE.Color, cd?: THREE.Color) => void;

/** The colors of a room: warm and honey-toned where a fire burns, grey and weathered in an empty house. */
export interface RoomTone {
  plank: THREE.Color;
  gap: THREE.Color;
  log: THREE.Color;
  /** Between logs, the sill and the crown. */
  seam: THREE.Color;
  /** A wall top's rim on the room side, and the rest of it. */
  rim: THREE.Color;
  top: THREE.Color;
  /** Where a wall is cut (its end over a baseboard, the baseboard's outer face). */
  cut: THREE.Color;
  /** One of NAPO's rooms: slabs instead of boards, courses of block instead of logs. */
  concrete?: boolean;
}

/** A room's colors; `napo`: the inside of one of NAPO's buildings, concrete, warm grey by a fire. */
export function roomTone(warm: boolean, napo = false): RoomTone {
  const c = (s: string) => new THREE.Color(s);
  if (napo) {
    return warm
      ? { plank: c('#77716a'), gap: c('#34302c'), log: c('#7d786f'), seam: c('#3b3733'), rim: c('#55514b'), top: c('#1f1d1b'), cut: c('#1f1d1b'), concrete: true }
      : { plank: c('#5d6163'), gap: c('#232627'), log: c('#666a6d'), seam: c('#2a2d2f'), rim: c('#43474a'), top: c('#17191a'), cut: c('#17191a'), concrete: true };
  }
  return warm
    ? { plank: c('#7c5638'), gap: c('#2c1d13'), log: c('#735036'), seam: c('#2e2018'), rim: c('#4d3727'), top: c('#1e1510'), cut: c('#1e1510') }
    : { plank: c('#5f5043'), gap: c('#1f1915'), log: c('#584a3f'), seam: c('#221c17'), rim: c('#3d342c'), top: c('#18140f'), cut: c('#18140f') };
}

/** Floor boards per tile, running east to west. */
const BOARDS = 3;
/** A board is this many tiles long; each row's joints are shifted, as boards are laid. */
const BOARD_LEN = 2;

/** How wide the grout between two of NAPO's floor slabs is. */
const GROUT = 0.03;

/**
 * One tile of wooden floor: boards with a darker edge to the south (so their seams show), joints and
 * slight color changes. In a concrete room, one slab a tile, grout along its south and east edges.
 */
export function floorTile(quad: QuadFn, x: number, y: number, tone: RoomTone, h = 0) {
  if (tone.concrete) {
    const c = tone.plank.clone().offsetHSL(0, 0, (hash2(x * 5 + 3, y * 7 + 1) - 0.5) * 0.05), x1 = x + 1 - GROUT, z1 = y + 1 - GROUT;
    quad([x, h, y], [x, h, z1], [x1, h, z1], [x1, h, y], c.clone().multiplyScalar(1.04), c.clone().multiplyScalar(0.92), c.clone().multiplyScalar(0.92), c);
    quad([x, h, z1], [x, h, y + 1], [x + 1, h, y + 1], [x + 1, h, z1], tone.gap);
    quad([x1, h, y], [x1, h, z1], [x + 1, h, z1], [x + 1, h, y], tone.gap);
    return;
  }
  for (let k = 0; k < BOARDS; k++) {
    const row = y * BOARDS + k, z0 = y + k / BOARDS, z1 = y + (k + 1) / BOARDS;
    const shift = hash2(row, 71) * BOARD_LEN;
    const board = (px: number) => {
      const n = Math.floor((px - shift) / BOARD_LEN), h = hash2(row * 7 + n, n * 13 + 5);
      const c = tone.plank.clone().offsetHSL((h - 0.5) * 0.02, 0, (h - 0.5) * 0.07);
      return [c.clone().multiplyScalar(1.07), c.clone().multiplyScalar(0.74)] as const;
    };
    const piece = (a: number, b: number, colors: readonly [THREE.Color, THREE.Color]) =>
      quad([a, h, z0], [a, h, z1], [b, h, z1], [b, h, z0], colors[0], colors[1], colors[1], colors[0]);
    const joint = shift + BOARD_LEN * Math.ceil((x - shift) / BOARD_LEN);
    if (joint > x + 0.05 && joint < x + 0.95) {
      piece(x, joint - 0.018, board(x));
      piece(joint - 0.018, joint + 0.018, [tone.gap, tone.gap]);
      piece(joint + 0.018, x + 1, board(x + 1 - 1e-6));
    } else piece(x, x + 1, board(x + 0.5));
  }
}

/**
 * The bands of a standing wall's face, bottom to top: a sill, round logs (lighter in the middle, dark
 * where they meet) and a crown; in a concrete room, flat courses of block with a thin seam under each.
 * Each band is [bottom, top, color at the bottom, color at the top].
 */
function logBands(h: number, tone: RoomTone): Array<[number, number, THREE.Color, THREE.Color]> {
  if (tone.concrete) {
    const n = Math.max(1, Math.round(h / 0.4)), ch = h / n, seam = 0.025;
    const out: Array<[number, number, THREE.Color, THREE.Color]> = [];
    for (let i = 0; i < n; i++) {
      const y0 = i * ch, block = tone.log.clone().offsetHSL(0, 0, (hash2(i, 5) - 0.5) * 0.03);
      out.push([y0, y0 + seam, tone.seam, tone.seam], [y0 + seam, y0 + ch, block, block.clone().multiplyScalar(1.05)]);
    }
    return out;
  }
  const sill = 0.1, crown = 0.08, n = Math.max(1, Math.round((h - sill - crown) / 0.25)), lh = (h - sill - crown) / n;
  const out: Array<[number, number, THREE.Color, THREE.Color]> = [[0, sill, tone.seam, tone.seam]];
  for (let i = 0; i < n; i++) {
    const y0 = sill + i * lh, mid = y0 + lh / 2, light = tone.log.clone().offsetHSL(0, 0, (hash2(i, 3) - 0.5) * 0.03);
    const edge = light.clone().lerp(tone.seam, 0.7);
    out.push([y0, mid, edge, light], [mid, y0 + lh, light, edge]);
  }
  out.push([h - crown, h, tone.seam, tone.seam]);
  return out;
}

/**
 * One wall tile as a solid block: its top (a lighter rim along the room side, the rest dark) and the
 * faces that can be seen: logs toward the room, a dark cut where it rises above a lower wall, and a
 * dark outer face toward the camera.
 */
export function wallTile(quad: QuadFn, map: TileMap, shapes: readonly WallShape[], x: number, y: number, tone: RoomTone) {
  const W = map.width, shape = shapes[y * W + x];
  if (!shape || shape === 'none') return;
  const h = shape === 'tall' ? WALL_TALL : WALL_LOW;
  const cuts = [0, RIM, 1 - RIM, 1];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    const rim = (i === 0 && open(map, x - 1, y)) || (i === 2 && open(map, x + 1, y)) || (j === 0 && open(map, x, y - 1)) || (j === 2 && open(map, x, y + 1))
      || (i !== 1 && j !== 1 && open(map, x + i - 1, y + j - 1));
    const x0 = x + cuts[i]!, x1 = x + cuts[i + 1]!, z0 = y + cuts[j]!, z1 = y + cuts[j + 1]!;
    quad([x0, h, z0], [x0, h, z1], [x1, h, z1], [x1, h, z0], rim ? tone.rim : tone.top);
  }
  const heightOf = (s: WallShape | undefined) => (s === 'tall' ? WALL_TALL : s === 'low' ? WALL_LOW : 0);
  for (const [ox, oy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
    const nx = x + ox, ny = y + oy;
    // The same corners as the terrain's ledges: a to b along the face, seen from outside the block.
    let a: [number, number], b: [number, number];
    if (oy === -1) { a = [x, y]; b = [x + 1, y]; } else if (oy === 1) { a = [x + 1, y + 1]; b = [x, y + 1]; }
    else if (ox === -1) { a = [x, y + 1]; b = [x, y]; } else { a = [x + 1, y]; b = [x + 1, y + 1]; }
    const face = (y0: number, y1: number, c0: THREE.Color, c1: THREE.Color) =>
      quad([a[0], y1, a[1]], [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], c1, c0, c0, c1);
    if (open(map, nx, ny)) {
      if (shape === 'tall') for (const [y0, y1, c0, c1] of logBands(h, tone)) face(y0, y1, c0, c1);
      else face(0, h, tone.seam, tone.rim);
      continue;
    }
    const nh = map.inside(nx, ny) ? heightOf(shapes[ny * W + nx]) : 0;
    // Toward the void only the south face can ever be seen (the camera looks north).
    if (nh < h && (nh > 0 || oy === 1)) face(nh, h, tone.cut, tone.cut);
  }
}

// ---------- things that never move: windows, doormats, furniture (baked by world.ts) ----------

/**
 * A window in the back wall at tile x,y (its face is the tile's south side): a frame, a pane that
 * glows with the light outside (`pane`, which the weather changes) and a cross of bars. In an empty
 * house it is boarded up, as it is from the street.
 */
export function windowModel(x: number, y: number, pane: THREE.Material, boarded: boolean): THREE.Group {
  const g = pivot(x + 0.5, WINDOW_Y, y + 1);
  const wood = boarded ? '#3a3029' : '#3b2a1e';
  g.add(box(0.8, 0.74, 0.05, wood, 0, 0, 0.025, 0.018));
  g.add(part(new THREE.BoxGeometry(0.66, 0.6, 0.02), pane, 0, 0, 0.055, false));
  g.add(box(0.045, 0.6, 0.03, wood, 0, 0, 0.07, false), box(0.66, 0.045, 0.03, wood, 0, 0.03, 0.07, false));
  g.add(box(0.9, 0.06, 0.14, wood, 0, -0.4, 0.07, 0.015));
  if (boarded) {
    for (const [dy, r] of [[0.12, 0.3], [-0.14, -0.24]] as const) {
      const p = box(0.86, 0.1, 0.03, '#5d4c3b', 0, dy, 0.1, false);
      p.rotation.z = r;
      g.add(p);
    }
  }
  return g;
}

/** A doormat on the exit tile, with a worn sill across the doorway on the side it leads out of. */
export function doorwayModel(x: number, y: number, dir: Dir): THREE.Group {
  const g = pivot(x + 0.5, 0, y + 0.5);
  g.rotation.y = { down: 0, up: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 }[dir];
  g.add(box(0.74, 0.014, 0.5, '#6d4d35', 0, 0.007, -0.04, false), box(0.6, 0.022, 0.36, '#4a3024', 0, 0.011, -0.04, false));
  g.add(box(0.96, 0.035, 0.1, '#5a4331', 0, 0.018, 0.45, false));
  return g;
}

const BLANKETS = ['#7a3b35', '#3f5f6e', '#5d6b3a', '#6b4a6e'];
const BARK = ['#5b4130', '#4e3726', '#664a33'];
/** Split wood's face (the end grain a camera looking north sees), and the heart of it. */
const GRAIN = '#c99d64';
const HEART = '#8f6238';
const RUGS: Array<[string, string, string]> = [['#6b2f2a', '#b08a58', '#3d4e5c'], ['#35505c', '#c2a36a', '#7a3b35'], ['#4e5a34', '#a8894f', '#6b2f2a']];
const BOOKS = ['#7b2f2a', '#35505c', '#5d6b3a', '#a0763a', '#4b3a5c', '#8a8070'];
/** A NAPO screen, still on: it glows the same in any light, so it keeps a material of its own when baked. */
const SCREEN = toon('#16301f', { emissive: 0x2f9a5a });
/** A NAPO crate's stencil (its yellow and ink, as on NAPO's signs), and the chalk on a plain one. */
const NAPO_PLATE = '#d6ad2f';
const NAPO_INK = '#1a1b1c';
const CHALK = '#e8e3d3';

/** Which way a shelf's back goes: against a wall north, west or east of it (north if none). */
function againstWall(map: TileMap, x: number, y: number): number {
  if (map.kind(x, y - 1) === 'wall') return 0;
  if (map.kind(x - 1, y) === 'wall') return Math.PI / 2;
  if (map.kind(x + 1, y) === 'wall') return -Math.PI / 2;
  return 0;
}

/** A log lying along x, `len` long: bark round it and split wood at both ends. */
function log(g: THREE.Object3D, r: number, len: number, bark: string, x: number, y: number, z: number) {
  const side = flat(new THREE.CylinderGeometry(r, r, len, 7).rotateZ(Math.PI / 2));
  g.add(part(side, bark, x, y, z, 0.014));
  for (const s of [-1, 1]) {
    g.add(part(new THREE.CylinderGeometry(r * 0.84, r * 0.84, 0.012, 7).rotateZ(Math.PI / 2), GRAIN, x + s * (len / 2 + 0.004), y, z, false));
    g.add(part(new THREE.CylinderGeometry(r * 0.3, r * 0.3, 0.014, 6).rotateZ(Math.PI / 2), HEART, x + s * (len / 2 + 0.007), y, z, false));
  }
}

/**
 * Low-poly furniture with toon outlines, placed on its tiles: a bed (head north), a table with a mug
 * and a book, a shelf of books and jars (its back to the nearest wall), a crate (sometimes two), a
 * crate for whoever comes next (indoors and out), a rug, one of NAPO's desks (its back to the wall too)
 * and a woodpile (along its wall). Colors vary by position, the same on every visit. Null for anything else.
 */
export function furnitureModel(o: MapObject, map: TileMap): THREE.Object3D | null {
  const v = hash2(o.x * 3 + 1, o.y * 5 + 2);
  switch (o.kind) {
    case 'bed': {
      const g = pivot(o.x + 0.5, 0, o.y + 1);
      g.add(box(0.84, 0.22, 1.84, '#5a3d2a', 0, 0.17, 0));
      g.add(box(0.92, 0.66, 0.1, '#3f2a1d', 0, 0.33, -0.92), box(0.92, 0.4, 0.08, '#3f2a1d', 0, 0.2, 0.93));
      g.add(box(0.78, 0.1, 1.72, '#d6cdb9', 0, 0.33, -0.02, false));
      g.add(box(0.86, 0.09, 1.1, BLANKETS[Math.floor(v * BLANKETS.length)]!, 0, 0.395, 0.34));
      g.add(box(0.58, 0.11, 0.3, '#ece5d4', 0, 0.43, -0.64, 0.018));
      return g;
    }
    case 'workbench': {
      // The workbench: a thick top on sturdy legs, a vise, tools hung on a board behind it.
      const g = pivot(o.x + 0.5, 0, o.y + 0.5);
      g.rotation.y = againstWall(map, o.x, o.y);
      g.add(box(0.92, 0.08, 0.56, '#7a5634', 0, 0.62, -0.1));
      for (const [lx, lz] of [[-0.4, -0.33], [0.4, -0.33], [-0.4, 0.13], [0.4, 0.13]] as const) g.add(box(0.07, 0.58, 0.07, '#4a3223', lx, 0.29, lz, false));
      g.add(box(0.84, 0.05, 0.46, '#5a3d2a', 0, 0.2, -0.1, false));
      g.add(box(0.92, 0.6, 0.04, '#5a4430', 0, 1.05, -0.4, false));
      g.add(box(0.14, 0.12, 0.16, '#50565c', 0.3, 0.72, 0.05, 0.012), box(0.2, 0.03, 0.03, '#8f969c', 0.3, 0.7, 0.16, false));
      for (const [tx, ty, h, c] of [[-0.3, 1.1, 0.3, '#8f969c'], [-0.15, 1.12, 0.26, '#6b4a31'], [0.05, 1.08, 0.34, '#8f969c']] as const) g.add(box(0.04, h, 0.02, c, tx, ty, -0.37, false));
      g.add(box(0.26, 0.05, 0.12, '#b3643c', -0.18, 0.69, -0.02, 0.01));
      return g;
    }
    case 'chest': {
      // Your stash: a wooden chest with iron bands and a brass lock, its lid a little rounded.
      const g = pivot(o.x + 0.5, 0, o.y + 0.5);
      g.rotation.y = againstWall(map, o.x, o.y);
      g.add(box(0.74, 0.36, 0.46, '#6b4424', 0, 0.2, -0.04));
      const lid = part(flat(new THREE.CylinderGeometry(0.23, 0.23, 0.76, 8, 1, false, 0, Math.PI)), '#7a4e2a', 0, 0.38, -0.04, 0.016);
      lid.rotation.set(0, Math.PI / 2, Math.PI / 2);
      g.add(lid);
      for (const bx of [-0.26, 0.26]) g.add(box(0.05, 0.37, 0.47, '#3b3a3a', bx, 0.2, -0.04, false), box(0.05, 0.02, 0.47, '#3b3a3a', bx, 0.5, -0.04, false));
      g.add(box(0.1, 0.12, 0.03, '#c9a24a', 0, 0.33, 0.2, 0.01));
      return g;
    }
    case 'table': {
      const g = pivot(o.x + 0.5, 0, o.y + 0.5);
      g.add(box(0.86, 0.07, 0.72, '#6b4a31', 0, 0.57, 0));
      for (const [lx, lz] of [[-0.36, -0.29], [0.36, -0.29], [-0.36, 0.29], [0.36, 0.29]] as const) g.add(box(0.07, 0.54, 0.07, '#4a3223', lx, 0.27, lz, false));
      g.add(part(flat(new THREE.CylinderGeometry(0.06, 0.055, 0.12, 8)), '#c9c1b0', 0.2, 0.665, 0.1, 0.012));
      g.add(box(0.22, 0.035, 0.28, v > 0.5 ? '#7b2f2a' : '#35505c', -0.16, 0.62, -0.06, 0.01));
      return g;
    }
    case 'shelf': {
      const g = pivot(o.x + 0.5, 0, o.y + 0.5);
      g.rotation.y = againstWall(map, o.x, o.y);
      const wood = '#5a3d2a';
      g.add(box(0.92, 1.3, 0.05, '#3f2a1d', 0, 0.65, -0.43, false));
      for (const sx of [-0.44, 0.44]) g.add(box(0.05, 1.32, 0.38, wood, sx, 0.66, -0.26));
      for (const sy of [0.05, 0.46, 0.87, 1.3]) g.add(box(0.84, 0.04, 0.36, wood, 0, sy, -0.26, false));
      // Books on the two lower boards, jars and a box on the top one.
      for (const [row, by] of [[0, 0.07], [1, 0.48]] as const) {
        let bx = -0.38;
        for (let i = 0; bx < 0.3; i++) {
          const w = 0.06 + hash2(o.x * 11 + i, o.y * 7 + row) * 0.05, h = 0.22 + hash2(i, o.x + row) * 0.12;
          if (hash2(o.y + i, row * 5 + o.x) > 0.82) { bx += w + 0.05; continue; }
          g.add(box(w, h, 0.26, BOOKS[(i + row * 2 + o.x) % BOOKS.length]!, bx + w / 2, by + h / 2, -0.27, false));
          bx += w + 0.01;
        }
      }
      for (const [jx, c] of [[-0.25, '#7d8f80'], [0.02, '#a88a5a']] as const) g.add(part(flat(new THREE.CylinderGeometry(0.07, 0.07, 0.17, 7)), c, jx, 0.975, -0.26, 0.012));
      g.add(box(0.2, 0.12, 0.22, '#6b5a44', 0.26, 0.95, -0.26, 0.012));
      return g;
    }
    case 'crate': {
      const g = pivot(o.x + 0.5, 0, o.y + 0.5);
      g.rotation.y = (v - 0.5) * 0.5;
      const crate = (s: number, y: number, turn: number) => {
        const c = pivot(0, y, 0);
        c.rotation.y = turn;
        c.add(box(s, s * 0.9, s, '#7a5a3b', 0, s * 0.45, 0));
        for (const k of [0.13, 0.77]) c.add(box(s + 0.02, s * 0.1, s + 0.02, '#5b412a', 0, s * 0.9 * k, 0, false));
        g.add(c);
      };
      crate(0.62, 0, 0);
      if (v > 0.55) crate(0.42, 0.558, (v - 0.75) * 1.4);
      return g;
    }
    case 'cache': {
      // A crate for whoever comes next (caches.ts): a weathered supply crate, bigger and sturdier than
      // the room's other crates, its lid propped open a finger's width, rope handles at the ends. In
      // NAPO's rooms (and so under its roof) it is one of NAPO's, olive with a yellow stencil of its eye;
      // anywhere else plain boards with a chalk mark, the way people out here tell each other it is open.
      const napo = map.data.style === 'napo';
      const wood = napo ? '#5b6547' : '#7d6243', edge = napo ? '#3e4631' : '#54402b', rope = '#b39a6b';
      const g = pivot(o.x + 0.5, 0, o.y + 0.5);
      g.rotation.y = (v - 0.5) * 0.18;
      g.add(box(0.8, 0.5, 0.58, wood, 0, 0.25, 0));
      // Boards across the front and corner posts, darker with age.
      for (const by of [0.17, 0.34]) g.add(box(0.8, 0.025, 0.012, edge, 0, by, 0.296, false));
      for (const sx of [-0.385, 0.385]) g.add(box(0.06, 0.52, 0.6, edge, sx, 0.26, 0, false));
      // The lid, hinged at the back and propped up at the front.
      const lid = pivot(0, 0.5, -0.29);
      lid.rotation.x = -0.14;
      lid.add(box(0.84, 0.06, 0.62, wood, 0, 0.03, 0.31));
      lid.add(box(0.86, 0.03, 0.08, edge, 0, 0.065, 0.58, false));
      g.add(lid);
      for (const sx of [-0.43, 0.43]) g.add(box(0.03, 0.05, 0.22, rope, sx, 0.34, 0, false));
      if (napo) {
        // NAPO's yellow plate with its eye, as on its warning signs.
        g.add(box(0.36, 0.2, 0.012, NAPO_PLATE, 0, 0.26, 0.302, false));
        g.add(box(0.1, 0.1, 0.01, NAPO_INK, 0, 0.26, 0.31, false).rotateZ(Math.PI / 4));
        g.add(box(0.035, 0.035, 0.01, NAPO_PLATE, 0, 0.26, 0.316, false).rotateZ(Math.PI / 4));
      } else {
        // A chalk arrow pointing in: somebody left something here for you.
        g.add(box(0.2, 0.03, 0.01, CHALK, 0, 0.26, 0.302, false));
        for (const t of [-1, 1]) g.add(box(0.1, 0.03, 0.01, CHALK, -0.07, 0.26 + t * 0.03, 0.303, false).rotateZ(t * 0.7));
      }
      return g;
    }
    case 'console': {
      // One of NAPO's desks, its back to the wall: steel, a screen that still glows green, a radio
      // with its dials, and papers nobody filed.
      const g = pivot(o.x + 0.5, 0, o.y + 0.5);
      g.rotation.y = againstWall(map, o.x, o.y);
      g.add(box(0.9, 0.06, 0.5, '#5d6466', 0, 0.62, -0.16));
      g.add(box(0.34, 0.56, 0.44, '#4a5052', 0.24, 0.3, -0.16));
      for (const lz of [-0.36, 0.04]) g.add(box(0.05, 0.6, 0.05, '#3d4244', -0.4, 0.3, lz, false));
      g.add(box(0.34, 0.28, 0.28, '#3a3f41', -0.16, 0.8, -0.24));
      g.add(part(new THREE.BoxGeometry(0.26, 0.18, 0.01), SCREEN, -0.16, 0.81, -0.095, false));
      g.add(box(0.26, 0.13, 0.17, '#4a4f3f', 0.22, 0.715, -0.26, 0.012));
      for (const dx of [0.15, 0.25]) g.add(box(0.04, 0.04, 0.02, '#c9a24a', dx, 0.72, -0.17, false));
      g.add(box(0.2, 0.01, 0.26, '#e6dfcc', 0.12, 0.655, -0.02, false).rotateY(0.25 - v * 0.5));
      return g;
    }
    case 'woodpile': {
      // Split firewood stacked along the wall on two sleepers, one log short on top (it went on the
      // fire), and a chopping block in front with the hatchet left in it.
      const g = pivot(o.x + 0.5, 0, o.y + 0.5);
      g.rotation.y = againstWall(map, o.x, o.y);
      for (const sx of [-0.28, 0.28]) g.add(box(0.07, 0.05, 0.56, '#3f2a1d', sx, 0.025, -0.17, false));
      const rows = [[-0.36, -0.18, 0], [-0.36, -0.18, 0], [-0.36, -0.18, 0], [-0.36, -0.18]];
      rows.forEach((zs, row) => zs.forEach((z, i) => {
        const k = hash2(o.x * 13 + row * 3 + i, o.y * 7 + row), r = 0.082 + k * 0.012;
        log(g, r, 0.8, BARK[Math.floor(k * BARK.length) % BARK.length]!, (hash2(i + row, o.x + o.y) - 0.5) * 0.06, 0.138 + row * 0.172, z);
      }));
      g.add(part(flat(new THREE.CylinderGeometry(0.14, 0.16, 0.24, 8)), BARK[0]!, 0.16, 0.12, 0.3, 0.016));
      g.add(part(new THREE.CylinderGeometry(0.125, 0.125, 0.012, 8), GRAIN, 0.16, 0.246, 0.3, false));
      g.add(box(0.1, 0.06, 0.025, '#8f969c', 0.18, 0.275, 0.3, 0.01));
      const handle = box(0.28, 0.028, 0.028, '#8a6a44', 0.064, 0.385, 0.3, 0.01);
      handle.rotation.z = (130 * Math.PI) / 180;
      g.add(handle);
      return g;
    }
    case 'rug': {
      const [field, border, motif] = RUGS[Math.floor(v * RUGS.length)]!;
      const g = pivot(o.x + o.w / 2, 0, o.y + o.h / 2);
      // Layers a hundredth apart, so the floor, the rug and its pattern never flicker through each
      // other; shadows and pools of light lie above them all (0.036 and up).
      g.add(box(o.w - 0.14, 0.01, o.h - 0.14, border, 0, 0.005, 0, false));
      g.add(box(o.w - 0.34, 0.018, o.h - 0.34, field, 0, 0.009, 0, false));
      g.add(box(Math.min(o.w, o.h) * 0.36, 0.026, Math.min(o.w, o.h) * 0.36, motif, 0, 0.013, 0, false).rotateY(Math.PI / 4));
      return g;
    }
    default:
      return null;
  }
}

/** Soft dark ellipses under furniture (and a fireplace), so it stands on the floor: [x, z, radius x, radius z]. */
export function furnitureShadows(map: TileMap): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  for (const o of map.data.objects) {
    if (o.kind === 'bed') out.push([o.x + 0.5, o.y + 1, 0.5, 1.0]);
    else if (o.kind === 'table') out.push([o.x + 0.5, o.y + 0.5, 0.5, 0.44]);
    else if (o.kind === 'crate') out.push([o.x + 0.5, o.y + 0.5, 0.42, 0.42]);
    else if (o.kind === 'cache') out.push([o.x + 0.5, o.y + 0.5, 0.5, 0.4]);
    else if (o.kind === 'chest') out.push([o.x + 0.5, o.y + 0.46, 0.46, 0.32]);
    else if (o.kind === 'workbench') out.push([o.x + 0.5, o.y + 0.42, 0.52, 0.36]);
    else if (o.kind === 'console' && againstWall(map, o.x, o.y) === 0) out.push([o.x + 0.5, o.y + 0.36, 0.52, 0.32]);
    else if (o.kind === 'shelf' && againstWall(map, o.x, o.y) === 0) out.push([o.x + 0.5, o.y + 0.28, 0.52, 0.26]);
    else if (o.kind === 'woodpile') {
      // Long along its wall, and drawn a little toward it, where the stack is.
      const turn = againstWall(map, o.x, o.y), along = turn === 0;
      out.push([o.x + 0.5 - Math.sin(turn) * 0.12, o.y + 0.5 - Math.cos(turn) * 0.12, along ? 0.5 : 0.42, along ? 0.42 : 0.5]);
    }
  }
  return out;
}
