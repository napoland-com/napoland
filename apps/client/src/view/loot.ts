/**
 * Finds and piles on the ground. A find is a small low-poly thing you can tell at a glance: a cluster
 * of glowing mushrooms, an amber lump on a stump, a bent metal sheet, a copper coil, a folded rag, a
 * crystal floating and turning, a steel thermos. A soft pool of colored light lies under each and a
 * glint shows now and then, so they can be spotted in the dark. A pile (what someone carried when
 * they collapsed) is a small heap with a warm glow; yours has a ring in your jacket color.
 *
 * They come and go while you watch (someone picks one up, a new one grows), so nothing here is
 * baked into the map. Each kind of thing is built once per map from outlined parts, joined into a
 * body (vertex colors), its outline and its glowing part, and drawn as instanced meshes placed from
 * the list whenever it changes: however many lie around, a kind costs two or three draw calls. The
 * pools are one mesh and the glints one set of points.
 */
import * as THREE from 'three';
import type { DropView, FindView, MapKind, Weather } from '@napoland/shared';
import { GLOW_Y, Puffs } from './fire';
import { OUTLINE, OUTLINE_INSTANCED, bake, box, flat, hash2, ownToon, part, pivot, softTexture, toon } from './toon';

/** Items with a look of their own; any other item is drawn as a sack. */
export const ITEM_LOOKS = [
  'glowcap', 'resin', 'scrap', 'wire', 'cloth', 'shard', 'live-shard', 'thermos', 'flare', 'strange', 'warm-pebble', 'hollow-feather', 'humming-bead', 'ember-coal', 'pale-moth',
  // What cooks at a fire, and the meals it cooks into (meals.ts): a meal lies on the ground only where someone dropped it.
  'huckleberries', 'fiddleheads', 'fir-tips', 'chanterelles', 'fir-tip-tea', 'chanterelle-stew', 'berry-pemmican',
  // The keepsakes people left (notes.ts): each lies for one player alone, in a soft gold light.
  'old-photograph', 'brass-compass', 'pole-tag', 'tin-whistle', 'staff-badge',
] as const;
export type Look = (typeof ITEM_LOOKS)[number] | 'sack' | 'pile';

export function lookOf(item: string): Look {
  return (ITEM_LOOKS as readonly string[]).includes(item) ? (item as Look) : 'sack';
}

interface Style {
  /** The pool of light under it: color and size (tiles across). */
  pool: string;
  size: number;
  /** Where its glint shows, above the ground. */
  top: number;
  /** Its glowing part, if it has one: color and the glow of it. */
  glow?: { color: string; emissive: string };
  /** It floats and turns (the shard). */
  floats?: boolean;
}

const STYLE: Record<Look, Style> = {
  glowcap: { pool: '#4fe0c4', size: 1.5, top: 0.36, glow: { color: '#8ff3df', emissive: '#27a893' } },
  resin: { pool: '#ffa33d', size: 1.35, top: 0.42, glow: { color: '#f5a23a', emissive: '#a8540c' } },
  scrap: { pool: '#aac4d4', size: 1.25, top: 0.26 },
  wire: { pool: '#ff9657', size: 1.25, top: 0.24 },
  cloth: { pool: '#ffc79c', size: 1.2, top: 0.16 },
  shard: { pool: '#a77dff', size: 1.55, top: 0.78, glow: { color: '#bf9cff', emissive: '#6a34d0' }, floats: true },
  'live-shard': { pool: '#e2d0ff', size: 1.9, top: 0.78, glow: { color: '#f1e6ff', emissive: '#a67cff' }, floats: true },
  thermos: { pool: '#c7dcff', size: 1.25, top: 0.22 },
  flare: { pool: '#ff5a4a', size: 1.25, top: 0.2, glow: { color: '#ff6a55', emissive: '#a31d12' } },
  strange: { pool: '#b8a0ff', size: 1.45, top: 0.36, glow: { color: '#d7c8ff', emissive: '#5a3fa8' } },
  'warm-pebble': { pool: '#ff9a4a', size: 1.2, top: 0.16, glow: { color: '#ff9447', emissive: '#8a3a0c' } },
  'hollow-feather': { pool: '#e8e2d6', size: 1.2, top: 0.12 },
  'humming-bead': { pool: '#5ff0e0', size: 1.3, top: 0.3, glow: { color: '#8ff7ee', emissive: '#1f8f86' }, floats: true },
  'ember-coal': { pool: '#ff6a3a', size: 1.25, top: 0.16, glow: { color: '#ff6a38', emissive: '#a3280c' } },
  'pale-moth': { pool: '#f2ecd8', size: 1.3, top: 0.34, glow: { color: '#efe8d2', emissive: '#6e6650' }, floats: true },
  huckleberries: { pool: '#7d8cff', size: 1.2, top: 0.14, glow: { color: '#5a6ad8', emissive: '#1f2a7a' } },
  fiddleheads: { pool: '#a8e07a', size: 1.15, top: 0.3 },
  'fir-tips': { pool: '#9fe68a', size: 1.15, top: 0.1 },
  chanterelles: { pool: '#ffbe55', size: 1.3, top: 0.2, glow: { color: '#f2ac3c', emissive: '#8a5510' } },
  'fir-tip-tea': { pool: '#c9f0b0', size: 1.15, top: 0.24 },
  'chanterelle-stew': { pool: '#ffcf87', size: 1.2, top: 0.16 },
  'berry-pemmican': { pool: '#c9a0a0', size: 1.15, top: 0.12 },
  'old-photograph': { pool: '#ffd98a', size: 1.35, top: 0.06 },
  'brass-compass': { pool: '#ffd98a', size: 1.35, top: 0.08, glow: { color: '#f3d27a', emissive: '#8a6a1a' } },
  'pole-tag': { pool: '#ffd98a', size: 1.35, top: 0.05 },
  'tin-whistle': { pool: '#ffd98a', size: 1.35, top: 0.06 },
  'staff-badge': { pool: '#ffd98a', size: 1.35, top: 0.05 },
  sack: { pool: '#ffeec4', size: 1.2, top: 0.34 },
  pile: { pool: '#ffcf87', size: 1.7, top: 0.3 },
};

/** A thing lying on its side along x: a thermos, a bedroll. */
function lying(geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, ol: number | false): THREE.Mesh {
  const m = part(flat(geo), color, x, y, z, ol);
  m.rotation.z = Math.PI / 2;
  return m;
}

/**
 * The model of a kind of thing, standing on the middle of a tile at the origin, within the tile.
 * `glow` is the material of its glowing part (the mushroom caps, the amber, the crystal).
 */
export function lootModel(look: Look, glow: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  switch (look) {
    case 'glowcap':
      // Three mushrooms of different sizes, their caps glowing.
      for (const [x, z, s] of [[-0.09, 0.04, 1], [0.13, -0.07, 0.78], [0.07, 0.15, 0.58]] as const) {
        g.add(part(flat(new THREE.CylinderGeometry(0.04 * s, 0.056 * s, 0.22 * s, 6)), '#e6dfcc', x, 0.11 * s, z, 0.015));
        const cap = part(flat(new THREE.SphereGeometry(0.15 * s, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2)), glow, x, 0.2 * s, z, 0.015);
        cap.scale.y = 0.75;
        g.add(cap);
      }
      break;
    case 'resin': {
      // A cut stump with an amber lump on it, and a drop running down its side.
      g.add(part(flat(new THREE.CylinderGeometry(0.19, 0.23, 0.17, 8)), '#5b3f2d', 0, 0.085, 0, 0.018));
      g.add(part(flat(new THREE.CylinderGeometry(0.175, 0.175, 0.012, 8)), '#9b7550', 0, 0.176, 0, false));
      g.add(part(flat(new THREE.CylinderGeometry(0.085, 0.085, 0.014, 8)), '#76553a', 0, 0.179, 0, false));
      const lump = part(new THREE.DodecahedronGeometry(0.12, 0), glow, 0.02, 0.27, 0.01, 0.016);
      lump.scale.set(1, 0.85, 0.95);
      g.add(lump, part(new THREE.IcosahedronGeometry(0.045, 0), glow, 0.175, 0.12, 0.07, 0.01));
      break;
    }
    case 'scrap': {
      // A torn piece of corrugated sheet metal: ridges (the toon light makes them stripes), rust on
      // some, and its end bent up.
      const sheet = pivot(-0.03, 0.03, 0);
      sheet.rotation.y = 0.35;
      const RIDGES = 6, w = 0.065;
      for (let i = 0; i < RIDGES; i++) {
        const z = (i - (RIDGES - 1) / 2) * w, rust = i === 1 || i === 4;
        const flatPart = box(0.3 - (i % 3) * 0.03, 0.016, w * 1.06, rust ? '#8f5a3c' : i % 2 ? '#8b999f' : '#a9b6bb', -0.04 + (i % 2) * 0.01, 0, z, 0.01);
        flatPart.rotation.x = (i % 2 ? 1 : -1) * 0.38;
        const bent = box(0.16, 0.016, w * 1.06, rust ? '#9c6242' : i % 2 ? '#9aa7ad' : '#b9c4c8', 0.17 + (i % 2) * 0.01, 0.05, z, 0.01);
        bent.rotation.set((i % 2 ? 1 : -1) * 0.38, 0, 0.62);
        sheet.add(flatPart, bent);
      }
      g.add(sheet);
      break;
    }
    case 'wire': {
      // A loose coil of copper wire: thin loops lying on each other askew, none quite round with the
      // next, so the eye sees wound wire and not a ring. Two shades, as bare copper catches the light.
      const loops = [[0, 0, 0.02, 0.15, 0, 0, '#c86c34'], [0.035, -0.02, 0.04, 0.13, 0.16, -0.1, '#dd8a4a'], [-0.03, 0.03, 0.058, 0.155, -0.12, 0.14, '#c86c34'], [0.01, 0.035, 0.078, 0.12, 0.08, 0.2, '#dd8a4a']] as const;
      for (const [x, z, y, r, tx, tz, color] of loops) {
        const loop = part(flat(new THREE.TorusGeometry(r, 0.016, 4, 14)), color, x, y, z, 0.009);
        loop.rotation.set(Math.PI / 2 + tx, 0, tz);
        g.add(loop);
      }
      break;
    }
    case 'cloth': {
      // Folded cloth: two layers, each folded over on one side (the rounded edge), with a pale stripe.
      const layer = (y: number, w: number, d: number, color: string, stripe: string, side: number, turn: number) => {
        const l = pivot(0, y, 0);
        l.rotation.y = turn;
        l.add(box(w, 0.04, d, color, 0, 0, 0, 0.012));
        const fold = part(flat(new THREE.CylinderGeometry(0.02, 0.02, d, 6)), color, side * w / 2, 0, 0, 0.012);
        fold.rotation.x = Math.PI / 2;
        l.add(fold, box(w * 0.98, 0.004, 0.035, stripe, 0, 0.021, -d * 0.22, false), box(w * 0.98, 0.004, 0.035, stripe, 0, 0.021, d * 0.22, false));
        g.add(l);
      };
      layer(0.02, 0.4, 0.3, '#7a3a33', '#caa27a', 1, 0);
      layer(0.06, 0.34, 0.26, '#b35a4b', '#ecd3a8', -1, 0.18);
      break;
    }
    case 'shard':
    case 'live-shard': {
      // A crystal floating over the ground with two chips around it; the whole of it turns (see Kind).
      const crystal = part(new THREE.OctahedronGeometry(0.12, 0), glow, 0, 0.5, 0, 0.018);
      crystal.scale.set(0.8, 1.9, 0.8);
      g.add(crystal);
      for (const [x, y, z, s] of [[0.17, 0.4, 0.04, 0.045], [-0.15, 0.46, -0.05, 0.035]] as const) g.add(part(new THREE.TetrahedronGeometry(s, 0), glow, x, y, z, 0.01));
      break;
    }
    case 'thermos':
      // A steel thermos lying on its side: dark cap, red band.
      g.add(lying(new THREE.CylinderGeometry(0.08, 0.08, 0.3, 8), '#9aabb4', -0.02, 0.085, 0, 0.015));
      g.add(lying(new THREE.CylinderGeometry(0.085, 0.085, 0.1, 8), '#434f59', 0.17, 0.085, 0, 0.015));
      g.add(lying(new THREE.CylinderGeometry(0.083, 0.083, 0.05, 8), '#c0443a', -0.06, 0.085, 0, false));
      break;
    case 'flare':
      // A road flare lying in the leaves: a red stick, its striker cap, and a glowing tip.
      g.add(lying(new THREE.CylinderGeometry(0.035, 0.035, 0.34, 7), '#c8322a', 0, 0.04, 0, 0.012));
      g.add(lying(new THREE.CylinderGeometry(0.038, 0.038, 0.06, 7), '#2a2a2e', -0.18, 0.04, 0, 0.012));
      g.add(part(new THREE.IcosahedronGeometry(0.04, 0), glow, 0.18, 0.04, 0, false));
      break;
    case 'strange': {
      // Something that should not be there: a knot of dark stone with a pale light in its seams.
      const knot = part(new THREE.TorusKnotGeometry(0.1, 0.035, 24, 5, 2, 3), '#2e2a3a', 0, 0.2, 0, 0.014);
      knot.rotation.set(0.6, 0.3, 0.2);
      g.add(knot, part(new THREE.OctahedronGeometry(0.06, 0), glow, 0, 0.2, 0, false));
      break;
    }
    case 'warm-pebble': {
      const pebble = part(new THREE.DodecahedronGeometry(0.09, 0), '#2a2522', 0, 0.06, 0, 0.012);
      pebble.scale.set(1.3, 0.6, 1);
      g.add(pebble, part(new THREE.IcosahedronGeometry(0.03, 0), glow, 0.03, 0.1, 0.02, false));
      break;
    }
    case 'hollow-feather': {
      // A long grey feather: a quill and a vane on either side, lying slightly curled.
      const f = pivot(0, 0.02, 0);
      f.rotation.y = 0.5;
      f.add(box(0.36, 0.01, 0.012, '#d9d2c2', 0, 0.01, 0, false));
      for (const side of [-1, 1]) {
        const vane = box(0.3, 0.008, 0.06, side > 0 ? '#9a9a96' : '#b7b4ab', 0.02, 0.012, side * 0.033, 0.008);
        vane.rotation.x = side * 0.18;
        f.add(vane);
      }
      g.add(f);
      break;
    }
    case 'humming-bead': {
      g.add(part(new THREE.IcosahedronGeometry(0.07, 1), glow, 0, 0.26, 0, 0.012));
      g.add(part(flat(new THREE.TorusGeometry(0.1, 0.008, 4, 16)), '#c9d6d4', 0, 0.26, 0, false));
      break;
    }
    case 'huckleberries': {
      // A sprig off a huckleberry bush lying in the grass: two leaves, and a cluster of dark-blue berries that catch the light.
      const leaf = (x: number, z: number, turn: number) => {
        const l = box(0.13, 0.012, 0.07, '#5d9c4c', x, 0.02, z, 0.008);
        l.rotation.y = turn;
        return l;
      };
      g.add(leaf(-0.12, -0.06, 0.5), leaf(0.1, -0.1, -0.4), box(0.26, 0.012, 0.014, '#6b4d33', 0, 0.015, -0.04, false));
      for (const [x, z, r] of [[-0.05, 0.03, 0.055], [0.05, 0.05, 0.05], [0, 0.12, 0.048], [0.1, 0.13, 0.042], [-0.1, 0.12, 0.04]] as const) g.add(part(new THREE.IcosahedronGeometry(r, 1), glow, x, r, z, 0.008));
      break;
    }
    case 'fiddleheads': {
      // Three fiddleheads standing up out of the ground: a green stem each, and its tight curl at the top.
      for (const [x, z, h, s] of [[-0.09, 0.02, 0.2, 1], [0.08, -0.05, 0.16, 0.85], [0.03, 0.1, 0.12, 0.7]] as const) {
        g.add(part(flat(new THREE.CylinderGeometry(0.014, 0.018, h, 5)), '#5f9e44', x, h / 2, z, 0.008));
        const curl = part(flat(new THREE.TorusGeometry(0.045 * s, 0.02 * s, 4, 8, Math.PI * 1.6)), '#7fc15a', x + 0.03 * s, h + 0.03 * s, z, 0.008);
        curl.rotation.y = x * 8;
        g.add(curl);
      }
      break;
    }
    case 'fir-tips': {
      // A handful of fir tips lying in the grass: a short woody stem, its new needles bright green along it.
      const b = pivot(0, 0.02, 0);
      b.rotation.y = 0.6;
      b.add(box(0.32, 0.018, 0.018, '#7a5a3a', 0, 0, 0, 0.006));
      for (let i = 0; i < 6; i++) {
        for (const side of [-1, 1]) {
          const n = box(0.012, 0.012, 0.09, i % 2 ? '#8ee06a' : '#6fc253', -0.13 + i * 0.05, 0.01, side * 0.045, false);
          n.rotation.y = side * 0.5;
          b.add(n);
        }
      }
      b.add(box(0.07, 0.03, 0.03, '#b6f08e', 0.17, 0.012, 0, 0.006));
      g.add(b);
      break;
    }
    case 'chanterelles': {
      // Three chanterelles pushing up through the moss: golden funnels, wider at the top, faintly lit.
      for (const [x, z, s] of [[-0.08, 0.02, 1], [0.1, -0.05, 0.8], [0.04, 0.12, 0.65]] as const) {
        g.add(part(flat(new THREE.CylinderGeometry(0.02 * s, 0.028 * s, 0.1 * s, 6)), '#e89a36', x, 0.05 * s, z, 0.01));
        const cap = part(flat(new THREE.CylinderGeometry(0.1 * s, 0.03 * s, 0.07 * s, 7)), glow, x, 0.13 * s, z, 0.01);
        g.add(cap);
      }
      break;
    }
    case 'fir-tip-tea':
      // A tin mug of fir-tip tea, still green on top.
      g.add(part(flat(new THREE.CylinderGeometry(0.075, 0.07, 0.16, 8)), '#9aabb4', 0, 0.08, 0, 0.012));
      g.add(part(flat(new THREE.CylinderGeometry(0.066, 0.066, 0.01, 8)), '#6fae52', 0, 0.162, 0, false));
      g.add(box(0.03, 0.08, 0.018, '#7d8b92', 0.095, 0.09, 0, 0.008));
      break;
    case 'chanterelle-stew':
      // A tin of stew: a low pot, golden inside.
      g.add(part(flat(new THREE.CylinderGeometry(0.13, 0.11, 0.1, 9)), '#6d7c85', 0, 0.05, 0, 0.012));
      g.add(part(flat(new THREE.CylinderGeometry(0.118, 0.118, 0.01, 9)), '#c99a4a', 0, 0.098, 0, false));
      for (const [x, z] of [[-0.04, 0.02], [0.05, -0.03], [0.01, 0.06]] as const) g.add(box(0.03, 0.012, 0.025, '#f7c35a', x, 0.106, z, false));
      break;
    case 'berry-pemmican': {
      // Two cakes of berry pemmican on a scrap of wax paper, dark and flecked with blue.
      g.add(box(0.3, 0.006, 0.22, '#e9dfc4', 0, 0.003, 0, 0.006));
      for (const [x, z, t] of [[-0.05, 0.02, 0.2], [0.07, -0.03, -0.3]] as const) {
        const cake = box(0.12, 0.05, 0.09, '#5a3b33', x, 0.031, z, 0.008);
        cake.rotation.y = t;
        g.add(cake, box(0.02, 0.006, 0.02, '#6f7fd6', x - 0.02, 0.058, z + 0.01, false), box(0.018, 0.006, 0.018, '#6f7fd6', x + 0.03, 0.058, z - 0.02, false));
      }
      break;
    }
    case 'old-photograph': {
      // A photograph face up in the grass: its white border, and the town before, dark and grey.
      const p = pivot(0, 0.012, 0);
      p.rotation.y = 0.4;
      p.add(box(0.26, 0.008, 0.2, '#efe6cf', 0, 0, 0, 0.006), box(0.21, 0.004, 0.15, '#6f6556', 0, 0.006, 0, false));
      p.add(box(0.21, 0.004, 0.05, '#9a8f7c', 0, 0.008, 0.035, false), box(0.03, 0.004, 0.06, '#cfc4ad', 0.05, 0.01, 0.01, false));
      g.add(p);
      break;
    }
    case 'brass-compass': {
      // The ranger's compass, open on the ground: a brass case and its ring, the face, the needle.
      g.add(part(flat(new THREE.CylinderGeometry(0.1, 0.105, 0.04, 12)), '#c9a24a', 0, 0.02, 0, 0.012));
      g.add(part(flat(new THREE.CylinderGeometry(0.082, 0.082, 0.006, 12)), '#efe6cf', 0, 0.042, 0, false));
      g.add(part(flat(new THREE.TorusGeometry(0.03, 0.008, 4, 10)), '#c9a24a', 0, 0.02, -0.12, false));
      const needle = box(0.012, 0.006, 0.12, '#b33a2a', 0, 0.048, 0, false);
      needle.rotation.y = 0.6;
      g.add(needle, part(new THREE.IcosahedronGeometry(0.012, 0), glow, 0, 0.05, 0, false));
      break;
    }
    case 'pole-tag': {
      // A small tin tag lying flat, stamped, two nail holes in it.
      const t = pivot(0, 0.006, 0);
      t.rotation.y = -0.5;
      t.add(box(0.2, 0.008, 0.1, '#aebbc1', 0, 0, 0, 0.006));
      for (const x of [-0.08, 0.08]) t.add(box(0.014, 0.004, 0.014, '#2f343c', x, 0.005, 0, false));
      for (const x of [-0.03, 0, 0.03]) t.add(box(0.016, 0.004, 0.04, '#6b7880', x, 0.005, 0, false));
      g.add(t);
      break;
    }
    case 'tin-whistle': {
      // A child's tin whistle lying in the grass: green paint, worn to the tin at the mouth.
      g.add(lying(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 7), '#6d8a5a', 0.02, 0.02, 0, 0.008));
      g.add(lying(new THREE.CylinderGeometry(0.02, 0.02, 0.07, 7), '#c9cfd2', -0.15, 0.02, 0, 0.008));
      break;
    }
    case 'staff-badge': {
      // A NAPO staff badge fallen on the gravel: its clip, NAPO's yellow band, the pale square of the photo.
      const b = pivot(0, 0.006, 0);
      b.rotation.y = 0.3;
      b.add(box(0.14, 0.008, 0.2, '#efe6cf', 0, 0, 0, 0.006), box(0.14, 0.004, 0.035, '#d6ad2f', 0, 0.005, -0.07, false));
      b.add(box(0.05, 0.004, 0.06, '#d8d2c2', -0.03, 0.005, 0.01, false), box(0.05, 0.012, 0.025, '#7d8b92', 0, 0.006, -0.11, false));
      g.add(b);
      break;
    }
    case 'ember-coal': {
      // A lump of coal that never went out: black, and red where it has cracked open.
      const coal = part(new THREE.DodecahedronGeometry(0.11, 0), '#231d1c', 0, 0.08, 0, 0.012);
      coal.scale.set(1.25, 0.75, 1.05);
      g.add(coal, part(new THREE.IcosahedronGeometry(0.045, 0), glow, 0.05, 0.12, 0.03, false), part(new THREE.IcosahedronGeometry(0.03, 0), glow, -0.06, 0.1, -0.02, false));
      break;
    }
    case 'pale-moth': {
      // A pale moth hovering over the ground (it turns as floating things do), its wings spread and faintly lit.
      const body = part(flat(new THREE.CylinderGeometry(0.018, 0.012, 0.12, 5)), '#cfc5a8', 0, 0.3, 0, 0.008);
      body.rotation.x = Math.PI / 2;
      g.add(body);
      for (const side of [-1, 1]) {
        const wing = part(new THREE.BoxGeometry(0.13, 0.008, 0.1), glow, side * 0.075, 0.3, 0.01, 0.008);
        wing.rotation.set(0, side * 0.25, side * 0.3);
        g.add(wing);
      }
      break;
    }
    case 'sack': {
      const sack = part(new THREE.DodecahedronGeometry(0.14, 0), '#9a8158', 0, 0.12, 0, 0.016);
      sack.scale.set(1, 0.9, 0.95);
      g.add(sack, box(0.08, 0.06, 0.08, '#6e5a3c', 0, 0.25, 0, 0.012));
      break;
    }
    case 'pile': {
      // What fell out of someone's bag: a bundle, a rolled blanket, a rag, a can and a strap.
      const heap = part(new THREE.DodecahedronGeometry(0.25, 0), '#56483a', 0, 0.07, 0, 0.02);
      heap.scale.set(1.25, 0.42, 1.05);
      const roll = lying(new THREE.CylinderGeometry(0.075, 0.075, 0.38, 7), '#4f6a52', -0.05, 0.16, -0.07, 0.015);
      roll.rotation.y = 0.35;
      const rag = box(0.22, 0.03, 0.17, '#a44f40', 0.13, 0.15, 0.09, 0.012);
      rag.rotation.set(0.2, 0.6, 0.18);
      const can = part(flat(new THREE.CylinderGeometry(0.055, 0.055, 0.18, 7)), '#9aabb4', -0.16, 0.1, 0.13, 0.012);
      can.rotation.set(0.4, 0, 1.2);
      const strap = box(0.34, 0.012, 0.035, '#3a2d22', 0.02, 0.19, -0.02, false);
      strap.rotation.y = -0.6;
      g.add(heap, roll, rag, can, strap);
      break;
    }
  }
  return g;
}

/**
 * How strongly things on the ground glow: most in the dark (at night, in a room without a fire),
 * least on a grey day, when they need it least.
 */
export function lootGlow(kind: MapKind, weather: Weather, warmRoom: boolean): number {
  if (kind === 'inside') return warmRoom ? 0.65 : 1;
  return weather === 'night' || weather === 'aurora' ? 1 : weather === 'rain' ? 0.72 : 0.55;
}

/** One thing placed on the ground: where, turned how far, how big, and its phase (for bobbing and glints). */
interface Placed {
  x: number;
  y: number;
  z: number;
  turn: number;
  scale: number;
  ph: number;
}

/** Where a thing's glint shows, and its phase; a floating thing's glint bobs with it. */
interface Spot {
  x: number;
  y: number;
  z: number;
  ph: number;
  floats: boolean;
}

/** A pool's opacity at full glow; the pools breathe a little around it. */
const POOL_OPACITY = 0.55;
/** A floating thing rises and sinks this far, and turns this fast (radians a second). */
const BOB = 0.05;
const SPIN = 0.9;

/** One kind of thing: its layers (body, outline, glow), each an instanced mesh with room for `capacity`. */
class Kind {
  private readonly layers: Array<{ geo: THREE.BufferGeometry; mat: THREE.Material; mesh: THREE.InstancedMesh | null }>;
  private capacity = 0;
  private list: Placed[] = [];
  private readonly o = new THREE.Object3D();

  constructor(model: THREE.Object3D, body: THREE.Material, private readonly root: THREE.Object3D, readonly floats: boolean) {
    // bake() joins the plain colors into this material and every outline into OUTLINE; instanced,
    // they draw with their own (instancing is another shader).
    const colored = toon(0xffffff, { vertexColors: true });
    this.layers = bake([model]).map(m => {
      const mat = m.material === OUTLINE ? OUTLINE_INSTANCED : m.material === colored ? body : (m.material as THREE.Material);
      return { geo: m.geometry, mat, mesh: null };
    });
    // Room for one from the start: the map's shaders are compiled before it is shown, finds or not.
    this.grow(1);
  }

  get count(): number {
    return this.list.length;
  }

  private grow(n: number) {
    const capacity = Math.max(n, this.capacity * 2);
    for (const l of this.layers) {
      // The old copies' buffers go; the shape stays, the new mesh uses it.
      if (l.mesh) { this.root.remove(l.mesh); l.mesh.dispose(); }
      l.mesh = new THREE.InstancedMesh(l.geo, l.mat, capacity);
      l.mesh.count = 0;
      l.mesh.visible = false;
      // A floating thing moves every frame; its bounds would always be behind. Drawn whole instead.
      l.mesh.frustumCulled = !this.floats;
      this.root.add(l.mesh);
    }
    this.capacity = capacity;
  }

  place(list: Placed[]) {
    this.list = list;
    if (list.length > this.capacity) this.grow(list.length);
    this.write(0);
    for (const l of this.layers) {
      const mesh = l.mesh!;
      mesh.count = list.length;
      mesh.visible = list.length > 0;
      // The bounds of all the copies, so a kind with none on screen is skipped.
      if (!this.floats && list.length) mesh.computeBoundingSphere();
    }
  }

  /** Every copy's place at time t: things that float bob and turn. */
  write(t: number) {
    const { o } = this, f = this.floats;
    this.list.forEach((p, i) => {
      o.position.set(p.x, p.y + (f ? Math.sin(t * 1.6 + p.ph) * BOB : 0), p.z);
      o.rotation.set(0, p.turn + (f ? t * SPIN : 0), 0);
      o.scale.setScalar(p.scale);
      o.updateMatrix();
      for (const l of this.layers) l.mesh!.setMatrixAt(i, o.matrix);
    });
    for (const l of this.layers) l.mesh!.instanceMatrix.needsUpdate = true;
  }
}

/** A stable number from a string id (a pile's id is its owner's), to vary how each pile lies. */
function seedOf(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return h;
}

/** Soft pools of colored light lying on the ground: [x, y, z, size, color] each, in one geometry. */
function poolGeometry(pools: ReadonlyArray<readonly [number, number, number, number, THREE.Color]>): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], col: number[] = [];
  for (const [cx, y, cz, s, c] of pools) {
    const x0 = cx - s / 2, x1 = cx + s / 2, z0 = cz - s / 2, z1 = cz + s / 2;
    pos.push(x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0);
    uv.push(0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1);
    for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  if (pools.length) g.computeBoundingSphere();
  return g;
}

/** Everything lying on the ground of one map. Lives in a WorldView and goes with it. */
export class Loot {
  readonly root = new THREE.Group();
  private readonly kinds = new Map<Look, Kind>();
  private readonly glowMats: THREE.MeshToonMaterial[] = [];
  private readonly poolMat = new THREE.MeshBasicMaterial({ map: softTexture(0.22), vertexColors: true, transparent: true, opacity: POOL_OPACITY, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly pools: THREE.Mesh;
  private glints: Puffs;
  private spots: Spot[] = [];
  /** Your own pile's ring: your jacket color over a dark edge, so it shows on any ground. */
  private readonly ring = new THREE.Group();
  private readonly ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
  private glow = 1;
  private perUnit = 1000;

  constructor() {
    const body = ownToon(0xffffff, { vertexColors: true });
    for (const look of [...ITEM_LOOKS, 'sack', 'pile'] as const) {
      const s = STYLE[look];
      const glow = ownToon(s.glow?.color ?? 0xffffff, { emissive: s.glow?.emissive ?? 0x000000 });
      if (s.glow) this.glowMats.push(glow);
      this.kinds.set(look, new Kind(lootModel(look, glow), body, this.root, !!s.floats));
      // A look without a glowing part never uses its material; it is not in the scene to be freed.
      if (!s.glow) glow.dispose();
    }
    this.pools = new THREE.Mesh(poolGeometry([]), this.poolMat);
    this.pools.visible = false;
    this.glints = this.makeGlints(16);
    const edge = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.58, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0b0d10, transparent: true, opacity: 0.55, depthWrite: false }));
    const band = new THREE.Mesh(new THREE.RingGeometry(0.43, 0.55, 32).rotateX(-Math.PI / 2), this.ringMat);
    band.position.y = 0.002;
    this.ring.add(edge, band);
    this.ring.visible = false;
    this.root.add(this.pools, this.ring);
  }

  private makeGlints(capacity: number): Puffs {
    const p = new Puffs(capacity, softTexture(0.18), true);
    p.color.set('#fff4d6');
    p.resize(this.perUnit);
    this.root.add(p.points);
    return p;
  }

  /**
   * Puts the map's finds and piles in place, all of them anew (it only happens when something
   * changed). `me` and `color`: your id and jacket color, for the ring around your own pile.
   * `ground` is the height of the ground on tile x,y.
   */
  set(finds: Iterable<FindView>, drops: Iterable<DropView>, me: string | null, color: string | null, ground: (x: number, y: number) => number) {
    const by = new Map<Look, Placed[]>();
    const pools: Array<[number, number, number, number, THREE.Color]> = [];
    const spots: Spot[] = [];
    const add = (look: Look, tx: number, ty: number, seed: number) => {
      const s = STYLE[look];
      const p: Placed = { x: tx + 0.5, y: ground(tx, ty), z: ty + 0.5, turn: hash2(seed, 7) * Math.PI * 2, scale: 0.92 + hash2(seed, 3) * 0.16, ph: hash2(seed, 11) * Math.PI * 2 };
      let list = by.get(look);
      if (!list) by.set(look, (list = []));
      list.push(p);
      pools.push([p.x, p.y + GLOW_Y, p.z, s.size, new THREE.Color(s.pool)]);
      spots.push({ x: p.x + (hash2(seed, 5) - 0.5) * 0.24, y: p.y + s.top * p.scale, z: p.z + (hash2(seed, 13) - 0.5) * 0.16, ph: p.ph, floats: !!s.floats });
    };
    for (const f of finds) add(lookOf(f.item), f.x, f.y, f.id);
    let mine: DropView | undefined;
    for (const d of drops) {
      add('pile', d.x, d.y, seedOf(d.id));
      if (me !== null && d.owner === me) mine = d;
    }
    for (const [look, kind] of this.kinds) kind.place(by.get(look) ?? []);

    this.pools.geometry.dispose();
    this.pools.geometry = poolGeometry(pools);
    this.pools.visible = pools.length > 0;

    if (spots.length > this.glints.count) {
      this.root.remove(this.glints.points);
      this.glints.points.geometry.dispose();
      (this.glints.points.material as THREE.Material).dispose();
      this.glints.dispose();
      this.glints = this.makeGlints(Math.max(spots.length, this.glints.count * 2));
    }
    this.spots = spots;
    // Only the glints in use are drawn; the rest of the buffer waits for more.
    this.glints.points.geometry.setDrawRange(0, spots.length);

    this.ring.visible = !!mine;
    if (mine) {
      this.ring.position.set(mine.x + 0.5, ground(mine.x, mine.y) + GLOW_Y + 0.008, mine.y + 0.5);
      this.ringMat.color.set(color ?? '#f1ece0');
    }
  }

  /** How many things of each look lie here (for checks and tests). */
  counts(): Record<Look, number> {
    return Object.fromEntries([...this.kinds].map(([look, k]) => [look, k.count])) as Record<Look, number>;
  }

  /** How strongly things glow (lootGlow). */
  setGlow(k: number) {
    this.glow = k;
    for (const m of this.glowMats) m.emissiveIntensity = 0.45 + 0.8 * k;
  }

  update(t: number) {
    for (const k of this.kinds.values()) if (k.floats && k.count) k.write(t);
    // A glint flashes briefly every few seconds, each on its own beat.
    this.spots.forEach((s, i) => {
      const w = Math.max(0, Math.sin(t * 1.7 + s.ph));
      const lift = s.floats ? Math.sin(t * 1.6 + s.ph) * BOB : 0;
      this.glints.set(i, s.x, s.y + lift, s.z, 0.13 + 0.12 * w, w ** 10 * (0.55 + 0.45 * this.glow));
    });
    if (this.spots.length) this.glints.commit();
    this.poolMat.opacity = POOL_OPACITY * this.glow * (0.86 + 0.14 * Math.sin(t * 1.3));
    if (this.ring.visible) this.ringMat.opacity = 0.7 + 0.25 * Math.sin(t * 2.6);
  }

  /** The glints are sized in world units: the pixels one unit covers, one unit from the camera. */
  resize(perUnit: number) {
    this.perUnit = perUnit;
    this.glints.resize(perUnit);
  }

  /** disposeTree frees the meshes with the view's scene; the glints' texture sits in a uniform it cannot see. */
  dispose() {
    this.glints.dispose();
  }
}
