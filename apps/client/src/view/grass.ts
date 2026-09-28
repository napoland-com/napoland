/**
 * The ground outdoors and the grass on it (DESIGN.md, Look and feel). The ground's color drifts across
 * a map the way a meadow's does: paler and drier here, deep and damp there, dark and olive where the
 * trees shade it, a touch different from tile to tile; roads, paths and mud vary the same way. Low tufts
 * grow on grass tiles, and on tall grass (shared hidden()) knee-high blades that sway, and part around
 * whoever wades in. Everything follows from the map's id and the tiles' positions, so a place looks the
 * same on every visit; and the season grades it all a little (spring greener, summer warmer, autumn
 * rust, winter a light frost), in the colors themselves, so a map built in a season costs nothing more.
 *
 * The colors and where each clump grows are plain logic, tested without a page. world.ts puts the
 * clumps into its blocks of tiles: in each block, one instanced mesh for its tufts and one for its
 * tall grass, all with the one material that sways them.
 */
import * as THREE from 'three';
import { hidden, type Season, type TileKind, type TileMap, type Weather } from '@napoland/shared';
import { ownToon, share } from './toon';

/** The same number for the same map id (FNV-1a): each map has its own ground, the same on every visit. */
export function mapSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** A number from 0 to 1, always the same for a tile and a salt. */
function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x61c88647);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Smooth value noise from 0 to 1 at x, y (tile units), changing over about `scale` tiles. */
export function noise(x: number, y: number, scale: number, salt: number): number {
  const fx = x / scale, fy = y / scale, ix = Math.floor(fx), iy = Math.floor(fy);
  const u = fx - ix, v = fy - iy, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = hash(ix, iy, salt), b = hash(ix + 1, iy, salt), c = hash(ix, iy + 1, salt), d = hash(ix + 1, iy + 1, salt);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

const smooth = (from: number, to: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

const color = (hex: string) => new THREE.Color(hex);
/** Grass, and what it turns toward where it is damp, dry, on a rise, or in the shade of the trees. */
const GRASS = color('#3f5c3a'), LUSH = color('#2d5636'), DRY = color('#6a6a41'), RAISED = color('#34503a'), SHADE = color('#25321e');
/** The ground under tall grass: the color of its lower blades, so the gaps between them read as depth, not holes. */
const TALL_GROUND = color('#374628');
const FERNS = color('#2b4330'), FOREST = color('#1f2c21'), WATER = color('#152229');
const MUD = color('#554b3c'), WET_MUD = color('#453b2f'), DRY_MUD = color('#655940'), MUD_SHADE = color('#3a3227');
/** Asphalt, and the darker patches where it was mended or stays wet. */
const ROAD = color('#4b4e53'), PATCH = color('#3c3f44');
const LOT = color('#5c5b57'), STAIN = color('#4b4a46');
/** Floors and walls are drawn by interior.ts; these only keep the table whole. */
const FLOOR = color('#6b4a31'), WALL = color('#1d1510');
/** Tufts: a little lighter than the ground they grow on, so they read as texture in any light. */
const TUFT = color('#5f7e44'), TUFT_LUSH = color('#4a7845'), TUFT_DRY = color('#8f8a4c'), TUFT_SHADE = color('#3a4d2e');
/** Tall grass: pale sage and straw, so a patch stands out from the grass around it, day and night. */
const TALL = color('#8e9b5b'), TALL_DRY = color('#b3a867'), TALL_GREEN = color('#6d8a4d');
/** Ice, winter's on the water that freezes: pale and bluish, clouded here and there. */
const ICE = color('#c4dae2'), ICE_CLOUD = color('#9dbcc8');

/**
 * What a season does to the colors: toward `tint`, the open ground that far, the plants (tufts, tall grass,
 * ferns) that far, and roads and lots only in a frost. Kept gentle: the same place, another time of year.
 */
export interface Grade {
  tint: THREE.Color;
  ground: number;
  plants: number;
  paved: number;
}
export const GRADES: Readonly<Record<Season, Grade>> = {
  spring: { tint: color('#4f8a3c'), ground: 0.16, plants: 0.2, paved: 0 },
  summer: { tint: color('#8d8446'), ground: 0.14, plants: 0.16, paved: 0 },
  autumn: { tint: color('#8a5a2c'), ground: 0.24, plants: 0.34, paved: 0 },
  winter: { tint: color('#cbd6db'), ground: 0.5, plants: 0.42, paved: 0.3 },
};

/** How far a season takes a kind of ground toward its tint: the forest floor and mud less than grass, paved ground only a frost, never water, floors or walls. */
function gradeOf(g: Grade, kind: TileKind): number {
  switch (kind) {
    case 'road': case 'lot': return g.paved;
    case 'mud': case 'forest': return g.ground * 0.6;
    case 'water': case 'floor': case 'wall': return 0;
    default: return g.ground;
  }
}

/**
 * A map's ground colors. Worked out once per map: how much the trees shade the ground and how damp it
 * lies near water, both reaching a couple of tiles out, measured at every corner of the tiles. The
 * terrain colors each corner, so the color flows across a clearing instead of stepping tile by tile.
 */
export class Ground {
  readonly seed: number;
  private readonly W: number;
  private readonly H: number;
  /** At each tile corner, (W + 1) by (H + 1), from 0 to 1. */
  private readonly shade: Float32Array;
  private readonly wet: Float32Array;
  /** What fields() last read, so reading costs nothing. */
  private readonly f = { shade: 0, damp: 0, dry: 0 };
  /** The season's grade on every color (none: the colors as they are). */
  private readonly grade: Grade | undefined;

  constructor(map: TileMap, season?: Season) {
    const W = (this.W = map.width), H = (this.H = map.height);
    this.seed = mapSeed(map.data.id);
    this.grade = season && GRADES[season];
    // What shades the ground: the forest (past the map's edge too, where the woods go on) and the lone
    // trees; what makes it damp: water, and a little the mud of the banks.
    const shadeOf = new Float32Array(W * H), wetOf = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const kind = map.kind(x, y);
      shadeOf[y * W + x] = kind === 'forest' ? 1 : 0;
      wetOf[y * W + x] = kind === 'water' ? 1 : kind === 'mud' ? 0.35 : 0;
    }
    for (const o of map.data.objects) if (o.kind === 'tree' && map.inside(o.x, o.y)) shadeOf[o.y * W + o.x] = 0.7;
    this.shade = new Float32Array((W + 1) * (H + 1));
    this.wet = new Float32Array((W + 1) * (H + 1));
    const R = 2.5;
    for (let cy = 0; cy <= H; cy++) for (let cx = 0; cx <= W; cx++) {
      let all = 0, shade = 0, wet = 0;
      for (let ty = cy - 3; ty < cy + 3; ty++) for (let tx = cx - 3; tx < cx + 3; tx++) {
        const d = Math.hypot(tx + 0.5 - cx, ty + 0.5 - cy);
        if (d > R) continue;
        const w = 1 - d / R, inside = tx >= 0 && ty >= 0 && tx < W && ty < H;
        all += w;
        shade += w * (inside ? shadeOf[ty * W + tx]! : 1);
        if (inside) wet = Math.max(wet, wetOf[ty * W + tx]! * w * 1.6);
      }
      // A corner at a straight forest edge has about half its ground under trees: fully shaded there,
      // fading out over two tiles into the clearing.
      this.shade[cy * (W + 1) + cx] = smooth(0.05, 0.5, shade / all);
      this.wet[cy * (W + 1) + cx] = Math.min(1, wet);
    }
  }

  /** The shade, the damp and the dryness at x, y (tile units): the shade and the water's damp from the nearest corner. */
  private fields(x: number, y: number): { shade: number; damp: number; dry: number } {
    const cx = Math.min(this.W, Math.max(0, Math.round(x))), cy = Math.min(this.H, Math.max(0, Math.round(y)));
    const i = cy * (this.W + 1) + cx, s = this.seed, f = this.f;
    f.shade = this.shade[i]!;
    f.damp = Math.max(this.wet[i]!, smooth(0.6, 0.86, noise(x, y, 8.5, s + 4)));
    // Dry patches are open ground: the shade under the trees keeps it from drying.
    f.dry = smooth(0.52, 0.8, noise(x, y, 12, s + 3)) * (1 - f.shade);
    return f;
  }

  /**
   * The color of a tile of `kind` at one of its corners, cx, cy (tile tx, ty's), into `out`. The
   * corners two tiles share get the same color but for each tile's own slight jitter.
   */
  color(kind: TileKind, cx: number, cy: number, tx: number, ty: number, raised: boolean, out: THREE.Color): THREE.Color {
    const s = this.seed, { shade, damp, dry } = this.fields(cx, cy);
    const broad = noise(cx, cy, 6.5, s) - 0.5, fine = noise(cx, cy, 2.3, s + 1) - 0.5;
    let light = 1 + (hash(tx, ty, s + 2) - 0.5) * 0.045;
    switch (kind) {
      case 'grass':
        out.copy(GRASS).lerp(LUSH, damp * 0.7).lerp(DRY, dry * 0.72);
        if (raised) out.lerp(RAISED, 0.5);
        out.lerp(SHADE, shade * 0.72);
        light += broad * 0.18 + fine * 0.08;
        break;
      case 'tallgrass':
        out.copy(TALL_GROUND).lerp(SHADE, shade * 0.5);
        light += broad * 0.12;
        break;
      case 'ferns':
        out.copy(FERNS).lerp(SHADE, shade * 0.5);
        light += broad * 0.12 + fine * 0.06;
        break;
      case 'forest':
        out.copy(FOREST);
        light += broad * 0.1;
        break;
      case 'mud':
        out.copy(MUD).lerp(WET_MUD, damp * 0.6).lerp(DRY_MUD, dry * 0.5).lerp(MUD_SHADE, shade * 0.4);
        light += broad * 0.14 + fine * 0.08;
        break;
      case 'road':
        // Old asphalt: a little uneven, mended or still wet in darker patches.
        out.copy(ROAD).lerp(PATCH, smooth(0.64, 0.8, noise(cx, cy, 3.2, s + 5)) * 0.85);
        light += broad * 0.08 + fine * 0.05;
        break;
      case 'lot':
        out.copy(LOT).lerp(STAIN, smooth(0.66, 0.84, noise(cx, cy, 2.6, s + 6)) * 0.7);
        light += broad * 0.1 + fine * 0.08;
        break;
      case 'water':
        out.copy(WATER);
        break;
      case 'floor':
        out.copy(FLOOR);
        break;
      case 'wall':
        out.copy(WALL);
        break;
    }
    const k = this.grade ? gradeOf(this.grade, kind) : 0;
    if (k) out.lerp(this.grade!.tint, k);
    return out.multiplyScalar(light);
  }

  /** Ice at a corner of a frozen tile: pale, clouded where the noise says, a touch different from tile to tile. */
  iceColor(cx: number, cy: number, tx: number, ty: number, out: THREE.Color): THREE.Color {
    const s = this.seed;
    out.copy(ICE).lerp(ICE_CLOUD, smooth(0.45, 0.8, noise(cx, cy, 2.4, s + 40)) * 0.7);
    return out.multiplyScalar(1 + (hash(tx, ty, s + 41) - 0.5) * 0.05);
  }

  /** A plant's color (a fern, a tuft) as the season has it. */
  plant(out: THREE.Color): THREE.Color {
    return this.grade ? out.lerp(this.grade.tint, this.grade.plants) : out;
  }

  /** A tuft growing at x, y: greener where it is damp, straw where it is dry, darker under the trees; `r` (0 to 1) varies it. */
  tuftColor(x: number, y: number, r: number, out: THREE.Color): THREE.Color {
    const { shade, damp, dry } = this.fields(x, y);
    out.copy(TUFT).lerp(TUFT_LUSH, damp * 0.6).lerp(TUFT_DRY, Math.min(1, dry * 0.75 + r * 0.25)).lerp(TUFT_SHADE, shade * 0.6);
    return this.plant(out).multiplyScalar(0.9 + r * 0.2);
  }

  /** A clump of tall grass at x, y, from sage to straw; `r` and `g` (0 to 1) vary it. */
  tallColor(x: number, y: number, r: number, g: number, out: THREE.Color): THREE.Color {
    const { shade, dry } = this.fields(x, y);
    out.copy(TALL).lerp(TALL_DRY, Math.min(1, dry * 0.5 + r * 0.35)).lerp(TALL_GREEN, g * 0.4).lerp(SHADE, shade * 0.35);
    return this.plant(out).multiplyScalar(0.9 + g * 0.2);
  }
}

/** A clump of grass as world.ts draws it: where (tile units, and `h` the ground's height), turned, sized (world units) and colored. */
export interface Clump {
  x: number;
  y: number;
  h: number;
  rot: number;
  /** How far its blades reach out from its middle, and how high they stand. */
  spread: number;
  height: number;
  color: THREE.Color;
  /** Tall grass, where you hide; the rest are tufts. */
  tall: boolean;
}

/**
 * Tufts stand at most this high, tall grass at least this high (world units). A character is about 1
 * high; crouched in tall grass (CROUCH_DROP), only its head and shoulders are above it.
 */
export const TUFT_MAX = 0.28;
export const TALL_MIN = 0.38;
/** Tall grass grows on a grid of this many clumps a side on each of its tiles. */
const TALL_GRID = 4;

/**
 * Every clump of grass on a map: one to three low tufts on each grass tile, and about fourteen tall clumps
 * on each tile of tall grass, where nothing stands (a tree, a house, a sign), off the exits and away
 * from the glowcaps. Where each grows, how it is turned and sized all come from its tile's position.
 */
export function grassClumps(map: TileMap, ground: Ground): Clump[] {
  const out: Clump[] = [];
  const s = ground.seed, W = map.width;
  const shrooms = new Set(map.data.objects.filter(o => o.kind === 'shrooms').map(o => o.y * W + o.x));
  for (let ty = 0; ty < map.height; ty++) for (let tx = 0; tx < W; tx++) {
    const kind = map.kind(tx, ty), i = ty * W + tx;
    if ((kind !== 'grass' && kind !== 'tallgrass') || map.blocked[i] || map.exitAt(tx, ty) || shrooms.has(i)) continue;
    const h = map.level(tx, ty) * 0.55;
    if (kind === 'grass') {
      // Lush grass grows more and taller tufts than dry.
      const lush = 1 - smooth(0.52, 0.8, noise(tx + 0.5, ty + 0.5, 12, s + 3));
      const n = 1 + Math.floor(hash(tx, ty, s + 20) * 1.9 + lush * 1.1);
      for (let k = 0; k < n; k++) {
        const x = tx + 0.14 + hash(tx * 4 + k, ty, s + 21) * 0.72, y = ty + 0.14 + hash(tx, ty * 4 + k, s + 22) * 0.72;
        const r = hash(tx + k * 17, ty, s + 23);
        out.push({
          x, y, h, rot: r * Math.PI * 2, spread: 0.12 + hash(tx, ty + k * 13, s + 24) * 0.05,
          height: Math.min(TUFT_MAX, (0.16 + hash(tx + k * 7, ty, s + 25) * 0.08) * (0.85 + lush * 0.3)),
          color: ground.tuftColor(x, y, r, new THREE.Color()), tall: false,
        });
      }
      continue;
    }
    // Tall grass: a grid of clumps close enough to read as one mass, a few left out and each nudged,
    // so no rows show.
    for (let gy = 0; gy < TALL_GRID; gy++) for (let gx = 0; gx < TALL_GRID; gx++) {
      const hx = tx * TALL_GRID + gx, hy = ty * TALL_GRID + gy, last = TALL_GRID - 1;
      if (hash(hx, hy, s + 30) < 0.1) continue;
      const x = tx + (gx + 0.5) / TALL_GRID + (hash(hx, hy, s + 31) - 0.5) * 0.16, y = ty + (gy + 0.5) / TALL_GRID + (hash(hx, hy, s + 32) - 0.5) * 0.16;
      // The rim of a patch stands a little lower: its edge reads as grass thinning out, not a wall.
      const rim = (gx === 0 && !hidden(map, tx - 1, ty)) || (gx === last && !hidden(map, tx + 1, ty)) || (gy === 0 && !hidden(map, tx, ty - 1)) || (gy === last && !hidden(map, tx, ty + 1));
      const r = hash(hx, hy, s + 33), g = hash(hx, hy, s + 34);
      out.push({
        x, y, h, rot: r * Math.PI * 2, spread: 0.13 + g * 0.05,
        height: (0.47 + hash(hx, hy, s + 35) * 0.15) * (rim ? 0.84 : 1),
        color: ground.tallColor(x, y, r, g, new THREE.Color()), tall: true,
      });
    }
  }
  return out;
}

/** How a clump's blades grow: how many, how wide at the root, how far out their tips lean (from, to), all as shares of the clump's spread. */
export interface Blades {
  count: number;
  width: number;
  reach: [number, number];
}
/** A tuft: a few blades splayed out, so it reads from above as a small star of grass. */
export const TUFT_BLADES: Blades = { count: 5, width: 0.17, reach: [0.6, 1] };
/** Tall grass: more blades, wider and more upright, so a patch reads as one dense mass. */
export const TALL_BLADES: Blades = { count: 8, width: 0.24, reach: [0.3, 0.75] };
/** Triangles in a clump: each blade has three sides. */
export const trianglesOf = (b: Blades) => b.count * 3;

/**
 * One clump of grass: thin three-sided blades leaning out from its middle, dark at the root and light
 * at the tip (vertex colors), faceted for the toon look. It is 1 high and reaches 1 out; each clump
 * scales it to its size. Every side faces out, so the blades look solid from any side with their back
 * faces left undrawn; and their normals lean toward the sky, so grass is lit like the ground it grows
 * from and reads by its color, keeping only a hint of its facets.
 */
export function clumpGeometry(blades: Blades): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), tip = new THREE.Vector3(), mid = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
  const ROOT = 0.45, TIP = 1, [near, far] = blades.reach;
  for (let i = 0; i < blades.count; i++) {
    const turn = (i / blades.count) * Math.PI * 2 + ((i * 7) % 3) * 0.3, dx = Math.cos(turn), dz = Math.sin(turn);
    const reach = near + (((i * 7) % 5) / 4) * (far - near), high = 0.72 + ((i * 5) % 7) * 0.045, root = 0.22, w = blades.width;
    tip.set(dx * reach, high, dz * reach);
    const base = [
      new THREE.Vector3(dx * root - dz * w, 0, dz * root + dx * w),
      new THREE.Vector3(dx * root + dz * w, 0, dz * root - dx * w),
      new THREE.Vector3(dx * (root - w), 0, dz * (root - w)),
    ];
    const centre = new THREE.Vector3().add(base[0]!).add(base[1]!).add(base[2]!).add(tip).multiplyScalar(0.25);
    for (const [p, q] of [[0, 1], [1, 2], [2, 0]] as const) {
      a.copy(base[p]!);
      b.copy(base[q]!);
      n.subVectors(b, a).cross(e.subVectors(tip, a));
      mid.copy(a).add(b).add(tip).multiplyScalar(1 / 3).sub(centre);
      if (n.dot(mid) < 0) {
        e.copy(a);
        a.copy(b);
        b.copy(e);
      }
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, tip.x, tip.y, tip.z);
      col.push(ROOT, ROOT, ROOT, ROOT, ROOT, ROOT, TIP, TIP, TIP);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // Not indexed: every triangle gets its own normal (the facets), then each leans most of the way up.
  g.computeVertexNormals();
  const normal = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < normal.count; i++) {
    n.fromBufferAttribute(normal, i);
    n.y += 1.6;
    n.normalize();
    normal.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

/** How many players part the grass around them at once: the ones nearest you. */
export const PARTERS = 4;

/** Swaying: the uniforms, and the vertex shader's placing of a vertex with the sway and the parting added. */
const SWAY_PARS = /* glsl */ `
uniform float grassTime;
uniform float grassWind;
uniform vec4 grassPart[ ${PARTERS} ];
`;
const SWAY_PROJECT = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  // The grass sits at the world's origin, unturned: from here on this is world space.
  vec3 grassRoot = instanceMatrix[ 3 ].xyz;
  float grassH = max( mvPosition.y - grassRoot.y, 0.0 );
  // A gust rolling across the map and a quicker flutter; the higher up a blade, the more it bends.
  float grassGust = sin( grassTime * 1.3 + grassRoot.x * 0.45 + grassRoot.z * 0.3 ) * 0.65 + sin( grassTime * 3.1 + grassRoot.x * 1.7 - grassRoot.z * 1.3 ) * 0.35;
  vec2 grassBend = vec2( 0.8, 0.45 ) * grassGust * grassWind * 0.22 * grassH * grassH;
  float grassPress = 0.0;
  // Around each parter the blades lean away and their tips sink: a hollow where someone crouches.
  for ( int i = 0; i < ${PARTERS}; i ++ ) {
    vec2 away = grassRoot.xz - grassPart[ i ].xy;
    float d = length( away );
    float k = grassPart[ i ].z * ( 1.0 - smoothstep( 0.2, 0.85, d ) );
    grassBend += away / max( d, 0.05 ) * k * 0.55 * grassH;
    grassPress = max( grassPress, k );
  }
  mvPosition.xz += grassBend;
  mvPosition.y -= grassPress * 0.3 * grassH * grassH;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

/** How hard the wind bends the grass in each weather, and in a storm. */
export const WIND: Readonly<Record<Weather, number>> = { overcast: 0.8, rain: 1.1, night: 0.6, aurora: 0.8 };
export const STORM_WIND = 2.4;

/**
 * The grass's material: the toon look, and in the vertex shader a sway (a gust rolling across the map,
 * harder in a storm) and a parting around the players nearest you, both growing with a blade's height,
 * so tufts barely stir and tall grass moves. Time, wind and who parts it are uniforms: they change every
 * frame and the shader never does, and every view's grass shares one compiled program.
 */
export class GrassMaterial {
  readonly material = ownToon(0xffffff, { vertexColors: true });
  private readonly time = { value: 0 };
  private readonly wind = { value: 1 };
  private readonly parters = { value: Array.from({ length: PARTERS }, () => new THREE.Vector4()) };

  constructor() {
    this.material.onBeforeCompile = shader => {
      shader.uniforms.grassTime = this.time;
      shader.uniforms.grassWind = this.wind;
      shader.uniforms.grassPart = this.parters;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${SWAY_PARS}`).replace('#include <project_vertex>', SWAY_PROJECT);
    };
    // What onBeforeCompile does is the same for every view: one program for all of them.
    this.material.customProgramCacheKey = () => 'napoland-grass-1';
  }

  /** Seconds, for the sway. */
  update(t: number) {
    this.time.value = t;
  }

  setWind(k: number) {
    this.wind.value = k;
  }

  /** Parter `i` stands at x, z (world units) and parts the grass with strength k (0: nobody there). */
  part(i: number, x: number, z: number, k: number) {
    this.parters.value[i]!.set(x, z, k, 0);
  }
}

let sessionGrassMaterial: GrassMaterial | undefined;

/**
 * The one grass material of the session, which every view draws its grass with: kept (share), so a
 * view that goes never frees it, and its program stays compiled from one map to the next.
 */
export function sessionGrass(): GrassMaterial {
  if (!sessionGrassMaterial) {
    sessionGrassMaterial = new GrassMaterial();
    share(sessionGrassMaterial.material);
  }
  return sessionGrassMaterial;
}

/** Crouched in tall grass: how far down (world units), how far forward (radians), and how quickly it eases in and out (per second). */
export const CROUCH_DROP = 0.16;
export const CROUCH_LEAN = 0.22;
const CROUCH_RATE = 9;

/** How crouched someone is after `dt` seconds more, easing toward all the way in tall grass and not at all out of it. */
export function crouchToward(crouch: number, inTallGrass: boolean, dt: number): number {
  return crouch + ((inTallGrass ? 1 : 0) - crouch) * Math.min(1, Math.max(0, dt) * CROUCH_RATE);
}
