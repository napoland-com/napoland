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
import { box, flat, hash2, part, pivot } from './toon';

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
 * over a fireplace (its chimney is there) or a shelf. One in a narrow room; two in a wide one, a
 * quarter of the way in from each side.
 */
export function windowSpots(map: TileMap, shapes: readonly WallShape[]): Array<{ x: number; y: number }> {
  const W = map.width, busy = new Set<string>();
  for (const f of objectsOf(map.data, 'fireplace')) for (const dx of [-1, 0, 1]) busy.add(`${f.x + dx},${f.y}`);
  for (const s of objectsOf(map.data, 'shelf')) busy.add(`${s.x},${s.y}`);
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
}

export function roomTone(warm: boolean): RoomTone {
  const c = (s: string) => new THREE.Color(s);
  return warm
    ? { plank: c('#7c5638'), gap: c('#2c1d13'), log: c('#735036'), seam: c('#2e2018'), rim: c('#4d3727'), top: c('#1e1510'), cut: c('#1e1510') }
    : { plank: c('#5f5043'), gap: c('#1f1915'), log: c('#584a3f'), seam: c('#221c17'), rim: c('#3d342c'), top: c('#18140f'), cut: c('#18140f') };
}

/** Floor boards per tile, running east to west. */
const BOARDS = 3;
/** A board is this many tiles long; each row's joints are shifted, as boards are laid. */
const BOARD_LEN = 2;

/** One tile of wooden floor: boards with a darker edge to the south (so their seams show), joints and slight color changes. */
export function floorTile(quad: QuadFn, x: number, y: number, tone: RoomTone, h = 0) {
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
 * where they meet) and a crown. Each band is [bottom, top, color at the bottom, color at the top].
 */
function logBands(h: number, tone: RoomTone): Array<[number, number, THREE.Color, THREE.Color]> {
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
const RUGS: Array<[string, string, string]> = [['#6b2f2a', '#b08a58', '#3d4e5c'], ['#35505c', '#c2a36a', '#7a3b35'], ['#4e5a34', '#a8894f', '#6b2f2a']];
const BOOKS = ['#7b2f2a', '#35505c', '#5d6b3a', '#a0763a', '#4b3a5c', '#8a8070'];

/** Which way a shelf's back goes: against a wall north, west or east of it (north if none). */
function againstWall(map: TileMap, x: number, y: number): number {
  if (map.kind(x, y - 1) === 'wall') return 0;
  if (map.kind(x - 1, y) === 'wall') return Math.PI / 2;
  if (map.kind(x + 1, y) === 'wall') return -Math.PI / 2;
  return 0;
}

/**
 * Low-poly furniture with toon outlines, placed on its tiles: a bed (head north), a table with a mug
 * and a book, a shelf of books and jars (its back to the nearest wall), a crate (sometimes two) and a
 * rug. Colors vary by position, the same on every visit. Null for anything else.
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
    else if (o.kind === 'chest') out.push([o.x + 0.5, o.y + 0.46, 0.46, 0.32]);
    else if (o.kind === 'shelf' && againstWall(map, o.x, o.y) === 0) out.push([o.x + 0.5, o.y + 0.28, 0.52, 0.26]);
  }
  return out;
}
