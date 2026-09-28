/**
 * Chibi characters built from boxes: big head, short legs, outlines. Players differ by jacket color and
 * by what they wear: each piece of gear in its color, or an outfit over all of it (outfits.ts), which
 * changes how they look and nothing else. Either way the pack they carry shows, and how big it is.
 *
 * What a character wears is plain data first (dressOf: a Dress), so which look shows can be tested
 * without drawing; makePlayer draws a Dress. Each moving part (the body, each leg, each arm) is baked
 * from its boxes into one mesh in the shared vertex-colored toon material and one outline (toon.ts,
 * bake): a player costs ten draw calls whatever they wear, and an outfit's hat, cape or patches cost
 * none. Each model owns its geometries (freed with disposeTree when the player leaves or the map
 * changes); its materials are shared, and nothing frees them.
 */
import * as THREE from 'three';
import type { NpcLook } from '@napoland/shared';
import { NAPO_YELLOW } from './napo';
import { bake, box, flat, part, pivot, softTexture, toon } from './toon';

export interface Rig {
  root: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
}

function eyes(g: THREE.Object3D, y: number, z: number, sp: number) {
  for (const x of [-sp, sp]) {
    g.add(box(0.055, 0.09, 0.02, '#15151c', x, y, z, false));
    g.add(box(0.02, 0.03, 0.01, '#ffffff', x - 0.012, y + 0.022, z + 0.011, false));
  }
}

/**
 * What a character wears, as colors (and the bag's size): each slot's gear shows (gear.ts). A slot
 * left out keeps the look everyone started with. An outfit shows instead of all of it but the bag.
 */
export interface Look {
  /** Null: no cap at all, the hair shows. */
  cap?: string | null;
  shirt?: string;
  gloves?: string;
  pants?: string;
  shoes?: string;
  bag?: string;
  /** How big the bag is next to the backpack (8 slots): 1 is the backpack. */
  bagSize?: number;
  /** The outfit worn over the gear (outfits.ts), by id. */
  outfit?: string;
}

/**
 * Something an outfit adds, in its color, placed like the rest of the model (on the body, or on an arm
 * from its shoulder): a box, [width, height, depth], or a low cone, [top radius, bottom radius, height,
 * sides], turned so a face looks to the front. `line` false: no outline (patches, bands, trims).
 */
export type Part =
  | { box: readonly [number, number, number]; at: readonly [number, number, number]; color: string; line?: false }
  | { cone: readonly [number, number, number, number]; at: readonly [number, number, number]; color: string; line?: false };

/** A character's clothes, part by part. */
export interface Dress {
  /** The jacket or coat: its body, and each sleeve (the patchwork's two are not the same). */
  body: string;
  sleeveL: string;
  sleeveR: string;
  /** The strip down the front: the shirt under the jacket, a zip, a seam. */
  front: string;
  pants: string;
  shoes: string;
  /** Gloves, or bare hands. */
  hands: string;
  /** The pack, how big it is (1: the backpack), and how far behind its usual place it sits (over a cape). */
  bag: string;
  bagSize: number;
  packBack: number;
  /** What the head wears (a cap, a hard hat, a hood), and anything else on the body. */
  parts: readonly Part[];
  /** On each arm. */
  arm: readonly Part[];
}

const SKIN = '#f2cda8';
const HAIR = '#2b2421';
const PACK = '#6b5a3a';
const ROLL = '#4f6a52';

const b = (w: number, h: number, d: number, color: string, x: number, y: number, z: number, line = true): Part =>
  ({ box: [w, h, d], at: [x, y, z], color, ...(line ? {} : { line: false as const }) });
const cone = (top: number, bottom: number, h: number, sides: number, color: string, x: number, y: number, z: number, line = true): Part =>
  ({ cone: [top, bottom, h, sides], at: [x, y, z], color, ...(line ? {} : { line: false as const }) });

/** A cap in `color` with a band of `band` on its front, and a brim. */
const cap = (color: string, band: string): Part[] => [b(0.45, 0.13, 0.41, color, 0, 0.92, 0), b(0.22, 0.09, 0.02, band, 0, 0.925, 0.21, false), b(0.32, 0.04, 0.17, color, 0, 0.865, 0.26)];
/** A coat that goes on below the waist, to the knees: the legs swing inside it, the feet show. */
const skirt = (color: string): Part => cone(0.2, 0.245, 0.18, 6, color, 0, 0.15, 0);

const SUIT = '#7b8288', SUIT_DARK = '#555b61';
const HIVIS = '#e0712c', HIVIS_DARK = '#b3531b', REFLECTIVE = '#e2e6e2', WALT_HAT = '#d9a82b';
const CAPE = '#2f5b3f', CAPE_DARK = '#244a33';
const WOOL = '#6e4a2e', WOOL_DARK = '#4b3120', FELT = '#8b6c40', BRASS = '#d6b24c';
const RAG_RED = '#a8584a', RAG_MUSTARD = '#c39a3e', RAG_TEAL = '#3e7c77', RAG_BLUE = '#4f6b95', STITCH = '#e6d6ae';

/**
 * How each outfit looks, by id (outfits.ts); the pack is always the one worn. Whatever is on the front
 * of the body sits low: the camera looks down past the big head, which hides the chest above about 0.38.
 * A brim sits above 0.9, where the head's outline stops, or the outline shows through it; and no brim
 * reaches past 0.25 in front, or it hides the eyes from the camera.
 */
export const OUTFIT_LOOKS: Readonly<Record<string, Omit<Dress, 'bag' | 'bagSize'>>> = {
  // A grey coverall top to toe, belted, with NAPO's yellow patch, and a darker grey cap with NAPO's yellow on its front.
  'napo-suit': {
    body: SUIT, sleeveL: SUIT, sleeveR: SUIT, front: SUIT_DARK, pants: SUIT, shoes: '#2b2724', hands: SKIN, packBack: 0,
    parts: [b(0.08, 0.065, 0.014, NAPO_YELLOW, 0.1, 0.33, 0.125, false), b(0.372, 0.035, 0.252, SUIT_DARK, 0, 0.255, 0, false), ...cap(SUIT_DARK, NAPO_YELLOW)],
    arm: [],
  },
  // Orange, with bands round the body and the sleeves, and Walt's yellow hard hat: a dome, a ridge, a brim all round.
  'lineman-jacket': {
    body: HIVIS, sleeveL: HIVIS, sleeveR: HIVIS, front: HIVIS_DARK, pants: '#3b4a63', shoes: '#4a3322', hands: '#b98d55', packBack: 0,
    parts: [
      b(0.366, 0.03, 0.246, REFLECTIVE, 0, 0.27, 0, false), b(0.366, 0.03, 0.246, REFLECTIVE, 0, 0.345, 0, false),
      b(0.44, 0.12, 0.4, WALT_HAT, 0, 0.925, 0), b(0.07, 0.04, 0.36, WALT_HAT, 0, 1.0, 0), b(0.52, 0.03, 0.47, WALT_HAT, 0, 0.9, 0.01),
    ],
    arm: [b(0.106, 0.03, 0.126, REFLECTIVE, 0, -0.14, 0, false)],
  },
  // A dark green cape from sloping shoulders past the waist, over the arms, hemmed in yellow, and its hood
  // up, edged in yellow over the brow. The pack goes on over it.
  'rain-cape': {
    body: CAPE, sleeveL: CAPE, sleeveR: CAPE, front: CAPE_DARK, pants: '#46483a', shoes: '#27332c', hands: SKIN, packBack: 0.19,
    parts: [
      cone(0.17, 0.33, 0.08, 8, CAPE, 0, 0.525, 0), cone(0.33, 0.37, 0.28, 8, CAPE, 0, 0.345, 0), cone(0.372, 0.378, 0.03, 8, NAPO_YELLOW, 0, 0.215, 0, false),
      b(0.47, 0.13, 0.43, CAPE, 0, 0.9, -0.01), b(0.47, 0.36, 0.12, CAPE, 0, 0.72, -0.16),
      b(0.05, 0.3, 0.34, CAPE, -0.235, 0.74, -0.01), b(0.05, 0.3, 0.34, CAPE, 0.235, 0.74, -0.01), b(0.48, 0.035, 0.03, NAPO_YELLOW, 0, 0.845, 0.205, false),
    ],
    arm: [],
  },
  // Brown wool to the knees, belted, the brass badge on the chest, and a campaign hat: a wide brim, a pinched crown.
  'ranger-coat': {
    body: WOOL, sleeveL: WOOL, sleeveR: WOOL, front: WOOL_DARK, pants: '#434d3e', shoes: '#3a2718', hands: SKIN, packBack: 0,
    parts: [
      skirt(WOOL), b(0.372, 0.035, 0.252, WOOL_DARK, 0, 0.245, 0, false),
      b(0.075, 0.08, 0.014, BRASS, 0.095, 0.33, 0.125, false), b(0.035, 0.035, 0.01, '#9c7a2a', 0.095, 0.33, 0.134, false),
      b(0.62, 0.025, 0.52, FELT, 0, 0.9, -0.01), cone(0.07, 0.2, 0.15, 4, FELT, 0, 0.985, 0), cone(0.205, 0.21, 0.03, 4, WOOL_DARK, 0, 0.927, 0, false),
    ],
    arm: [],
  },
  // A coat of four cloths, one for the body, one for each sleeve and one for the skirt, with patches of
  // them on the front; a knitted cap of two more of them, with a bobble.
  patchwork: {
    body: RAG_RED, sleeveL: RAG_TEAL, sleeveR: RAG_MUSTARD, front: STITCH, pants: '#3a3f4d', shoes: '#4a3322', hands: SKIN, packBack: 0,
    parts: [
      skirt(RAG_BLUE), b(0.12, 0.1, 0.014, RAG_MUSTARD, -0.1, 0.3, 0.125, false), b(0.1, 0.08, 0.014, RAG_BLUE, 0.1, 0.34, 0.125, false),
      b(0.45, 0.13, 0.41, RAG_MUSTARD, 0, 0.925, 0), b(0.46, 0.05, 0.42, RAG_TEAL, 0, 0.87, 0), b(0.1, 0.1, 0.1, STITCH, 0, 1.02, 0),
    ],
    arm: [],
  },
};

/**
 * What a character in `jacket` (the player's color) and `look` is drawn in: an outfit this copy draws
 * shows instead of the gear, all but the pack; otherwise each piece of gear in its color, the jacket in
 * the player's color, and the look everyone started with where nothing says otherwise.
 */
export function dressOf(jacket: string, look: Look = {}): Dress {
  // A bigger bag stands taller and deeper on your back.
  const pack = { bag: look.bag ?? PACK, bagSize: Math.min(1.4, Math.max(0.8, look.bagSize ?? 1)) };
  const outfit = look.outfit && Object.hasOwn(OUTFIT_LOOKS, look.outfit) ? OUTFIT_LOOKS[look.outfit] : undefined;
  if (outfit) return { ...outfit, ...pack };
  const c = look.cap === undefined ? '#d63b33' : look.cap;
  return {
    body: jacket, sleeveL: jacket, sleeveR: jacket, front: look.shirt ?? '#2f3440', pants: look.pants ?? '#2f3442', shoes: look.shoes ?? '#3a2a20', hands: look.gloves ?? SKIN,
    ...pack, packBack: 0,
    // No cap: the hair shows on top.
    parts: c ? cap(c, '#f0ece2') : [b(0.44, 0.08, 0.39, HAIR, 0, 0.89, 0)],
    arm: [],
  };
}

/** One part as a mesh, with its outline unless it has none. */
function partMesh(p: Part): THREE.Mesh {
  const [x, y, z] = p.at, line = p.line !== false;
  if ('box' in p) return box(p.box[0], p.box[1], p.box[2], p.color, x, y, z, line);
  const [top, bottom, h, sides] = p.cone;
  // Turned half a side, so a face looks to the front rather than a corner.
  return part(flat(new THREE.CylinderGeometry(top, bottom, h, sides, 1, false, Math.PI / sides)), p.color, x, y, z, line);
}

/** One moving part's meshes, joined: a mesh of their colors and one of their outlines, placed from its pivot. */
function joined(parts: THREE.Object3D[]): THREE.Mesh[] {
  const g = new THREE.Group();
  g.add(...parts);
  return bake([g]);
}

/** The player character in `jacket` (the player's color) and what they wear. Faces +z. */
export function makePlayer(jacket: string, look: Look = {}): Rig {
  const d = dressOf(jacket, look), root = new THREE.Group();
  const legL = pivot(-0.085, 0.24, 0), legR = pivot(0.085, 0.24, 0);
  for (const l of [legL, legR]) {
    l.add(...joined([box(0.11, 0.17, 0.13, d.pants, 0, -0.085, 0), box(0.12, 0.07, 0.17, d.shoes, 0, -0.2, 0.02)]));
    root.add(l);
  }
  const armL = pivot(-0.225, 0.47, 0), armR = pivot(0.225, 0.47, 0);
  for (const [a, sleeve] of [[armL, d.sleeveL], [armR, d.sleeveR]] as const) {
    a.add(...joined([box(0.1, 0.2, 0.12, sleeve, 0, -0.09, 0), box(0.085, 0.07, 0.1, d.hands, 0, -0.22, 0), ...d.arm.map(partMesh)]));
    root.add(a);
  }
  const k = d.bagSize, back = -0.12 - 0.07 * k - d.packBack;
  const roll = part(flat(new THREE.CylinderGeometry(0.07, 0.07, 0.34, 8)), ROLL, 0, 0.6 + 0.16 * (k - 1), back);
  roll.rotation.z = Math.PI / 2;
  const face = new THREE.Group();
  eyes(face, 0.69, 0.186, 0.09);
  root.add(...joined([
    box(0.36, 0.28, 0.24, d.body, 0, 0.36, 0),
    box(0.1, 0.2, 0.02, d.front, 0, 0.37, 0.121, false),
    box(0.3, 0.32 * k, 0.16 * k, d.bag, 0, 0.4 + 0.08 * (k - 1), back),
    roll,
    box(0.42, 0.37, 0.37, SKIN, 0, 0.69, 0),
    box(0.44, 0.1, 0.39, HAIR, 0, 0.82, 0),
    box(0.44, 0.2, 0.1, HAIR, 0, 0.72, -0.15),
    face,
    ...d.parts.map(partMesh),
  ]));
  return { root, legL, legR, armL, armR };
}

/**
 * A townsperson in a long coat and scarf, with a floating "!" above. `look` (from the map) changes
 * their colors, so each person is someone; with a `hat` they wear a hard hat, as NAPO's crews did.
 */
export function makeNpc(look: NpcLook = {}): { root: THREE.Group; bang: THREE.Group } {
  const coat = look.coat ?? '#4f7a70', scarf = look.scarf ?? '#d9703a', skin = look.skin ?? '#f2cda8', hair = look.hair ?? '#6a3a24';
  const root = new THREE.Group();
  root.add(part(flat(new THREE.CylinderGeometry(0.15, 0.25, 0.4, 6)), coat, 0, 0.2, 0));
  root.add(box(0.26, 0.14, 0.2, coat, 0, 0.44, 0));
  root.add(box(0.3, 0.06, 0.24, scarf, 0, 0.5, 0));
  for (const x of [-0.17, 0.17]) root.add(box(0.07, 0.16, 0.08, skin, x, 0.36, 0));
  root.add(box(0.4, 0.36, 0.35, skin, 0, 0.68, 0));
  root.add(box(0.43, 0.14, 0.38, hair, 0, 0.83, 0));
  root.add(box(0.43, 0.32, 0.1, hair, 0, 0.68, -0.14));
  for (const x of [-0.21, 0.21]) root.add(box(0.12, 0.12, 0.12, hair, x, 0.86, -0.08));
  if (look.hat) root.add(box(0.45, 0.1, 0.4, look.hat, 0, 0.94, 0), box(0.5, 0.03, 0.46, look.hat, 0, 0.885, 0.02));
  eyes(root, 0.68, 0.176, 0.085);
  const bangMat = toon('#ffcf3a', { emissive: 0x7a5a00 });
  const bang = new THREE.Group();
  bang.add(box(0.07, 0.2, 0.07, bangMat, 0, 0.16, 0, 0.018));
  bang.add(box(0.07, 0.07, 0.07, bangMat, 0, -0.03, 0, 0.018));
  root.add(bang);
  return { root, bang };
}

/** Columns of light drawn at once, at most: more carriers of live finds on one map are rare. */
const LIVE_GLOWS = 6;
const COLUMN_H = 9;

/**
 * Pale columns of light over whoever carries a live find, and a faint glow at their feet. They ignore
 * the fog, so they show from far beyond it. A few are built once and always in the scene; each frame
 * shows as many as there are carriers (like the flares in wilds.ts), so nothing recompiles.
 */
export class LiveGlows {
  readonly root = new THREE.Group();
  private readonly tex: THREE.CanvasTexture;
  private readonly foot: THREE.CanvasTexture;
  private readonly geo = new THREE.CylinderGeometry(0.28, 0.42, COLUMN_H, 14, 1, true).translate(0, COLUMN_H / 2, 0);
  private readonly footGeo = new THREE.PlaneGeometry(1.8, 1.8).rotateX(-Math.PI / 2);
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly footMat: THREE.MeshBasicMaterial;
  private readonly columns: THREE.Group[] = [];

  constructor() {
    // Bright at the feet, gone at the top.
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 64;
    const g = c.getContext('2d')!, gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.55, 'rgba(255,255,255,.35)');
    gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 64);
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.foot = softTexture(0.3);
    const glow = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, color: 0xd9c4ff } as const;
    this.mat = new THREE.MeshBasicMaterial({ ...glow, map: this.tex, opacity: 0.55, side: THREE.DoubleSide });
    this.footMat = new THREE.MeshBasicMaterial({ ...glow, map: this.foot, opacity: 0.7 });
    for (let i = 0; i < LIVE_GLOWS; i++) {
      const col = new THREE.Group();
      col.add(new THREE.Mesh(this.geo, this.mat), new THREE.Mesh(this.footGeo, this.footMat));
      col.children[1]!.position.y = 0.03;
      col.visible = false;
      this.columns.push(col);
      this.root.add(col);
    }
  }

  /** Where the carriers stand now (world units, feet on the ground), nearest first; `t` makes them breathe. */
  set(list: ReadonlyArray<{ x: number; y: number; z: number }>, t: number) {
    const k = 0.85 + 0.15 * Math.sin(t * 2.2);
    this.mat.opacity = 0.55 * k;
    this.columns.forEach((col, i) => {
      const at = list[i];
      col.visible = !!at;
      if (at) col.position.set(at.x, at.y, at.z);
    });
  }

  dispose() {
    this.geo.dispose();
    this.footGeo.dispose();
    this.tex.dispose();
    this.foot.dispose();
    this.mat.dispose();
    this.footMat.dispose();
  }
}
