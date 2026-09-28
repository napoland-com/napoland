/**
 * Chibi characters built from boxes: big head, short legs, outlines. Players differ by jacket color and
 * by what they wear: each piece of gear in its color, or an outfit over all of it (outfits.ts, or one
 * bought in the shop, shop.ts), which changes how they look and nothing else. Either way the pack they
 * carry shows, and how big it is. Past level 20 a pattern on the jacket (merits.ts, or the shop's) goes
 * over either, in a shade of the cloth it is on.
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
  /** The pattern on the jacket (merits.ts), by id: over the gear or the outfit. */
  pattern?: string;
}

/**
 * Something an outfit or a pattern adds, in its color, placed like the rest of the model (on the body, or
 * on an arm from its shoulder): a box, [width, height, depth], or a low cone, [top radius, bottom radius,
 * height, sides], turned so a face looks to the front. `line` false: no outline (patches, bands, trims).
 * A box may be turned in the plane of the front (`spin`) and leaned back (`tilt`), in radians: a bar of a
 * chevron, a patch on the slope of a cape.
 */
export type Part =
  | { box: readonly [number, number, number]; at: readonly [number, number, number]; color: string; line?: false; spin?: number; tilt?: number }
  | { cone: readonly [number, number, number, number]; at: readonly [number, number, number]; color: string; line?: false };

/**
 * Where a jacket pattern goes: the front of the jacket's body, a box (with the sleeves beside it), or the
 * bell of a cape, an eight-sided cone that hides the arms. Sizes are whole: width, height, depth.
 */
export type Torso =
  | { kind: 'box'; w: number; h: number; d: number; y: number }
  | { kind: 'bell'; top: number; bottom: number; h: number; y: number; sides: number };

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
  /** On each arm, and on one arm only (a pattern's patch on one sleeve, a shade of each sleeve's own cloth). */
  arm: readonly Part[];
  armL: readonly Part[];
  armR: readonly Part[];
  /** What a pattern goes on. */
  torso: Torso;
}

const SKIN = '#f2cda8';
/**
 * How thick a pattern's patch is, and how far a band stands out from what it goes round: far enough in
 * front of an outfit's own patches, belts and bands that no two faces share a depth from the camera's
 * distance (they would flicker). An outfit's own small patches are as thick.
 */
const PLATE = 0.016, PROUD = 0.009;
const HAIR = '#2b2421';
const PACK = '#6b5a3a';
const ROLL = '#4f6a52';

const b = (w: number, h: number, d: number, color: string, x: number, y: number, z: number, line = true): Part =>
  ({ box: [w, h, d], at: [x, y, z], color, ...(line ? {} : { line: false as const }) });
/** The jacket's body, as makePlayer builds it: what a pattern goes on, unless an outfit covers it. */
const JACKET_TORSO: Torso = { kind: 'box', w: 0.36, h: 0.28, d: 0.24, y: 0.36 };
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
// The shop's outfits (content/shop.json): never earned, each its own colors.
const OILSKIN = '#e5b53a', OILSKIN_DARK = '#b8892a', TOGGLE = '#6b4a24', RUBBER = '#1f2326';
const PARKA = '#2c4a63', PARKA_DARK = '#1f3547', FUR = '#e6d9c2', MITTEN = '#a33b3b';
const DRESS = '#26324a', DRESS_DARK = '#1b2436', GLOVE = '#ecebe6', VISOR = '#15181e';
const KNIT = '#b33a4a', KNIT_CREAM = '#e6d6ae', KNIT_GREEN = '#2f6b4a', KNIT_BAND = '#7a2a36';

/**
 * How each outfit looks, by id (outfits.ts); the pack is always the one worn. Whatever is on the front
 * of the body sits low: the camera looks down past the big head, which hides the chest above about 0.38.
 * A brim sits above 0.9, where the head's outline stops, or the outline shows through it; and no brim
 * reaches past 0.25 in front, or it hides the eyes from the camera.
 */
export const OUTFIT_LOOKS: Readonly<Record<string, Omit<Dress, 'bag' | 'bagSize' | 'armL' | 'armR' | 'torso'> & { torso?: Torso }>> = {
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
    // A pattern goes on the bell of the cape, which hides the jacket and the arms.
    torso: { kind: 'bell', top: 0.33, bottom: 0.37, h: 0.28, y: 0.345, sides: 8 },
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
  // From the shop, then. Yellow oilskin to the knees over oilskin trousers and black rubber boots, two
  // toggles down the front, and a sou'wester: a low crown, a brim all round, a flap down the back of the neck.
  'lighthouse-oilskin': {
    body: OILSKIN, sleeveL: OILSKIN, sleeveR: OILSKIN, front: OILSKIN_DARK, pants: OILSKIN, shoes: RUBBER, hands: SKIN, packBack: 0,
    parts: [
      skirt(OILSKIN), b(0.07, 0.022, 0.014, TOGGLE, 0, 0.27, 0.14, false), b(0.07, 0.022, 0.014, TOGGLE, 0, 0.33, 0.14, false),
      b(0.43, 0.1, 0.39, OILSKIN, 0, 0.935, -0.01), b(0.54, 0.025, 0.5, OILSKIN, 0, 0.9, -0.02), b(0.48, 0.14, 0.05, OILSKIN, 0, 0.83, -0.25),
    ],
    arm: [],
  },
  // A long navy parka, pockets low on the front, its hood up and lined in fur round the face (thick, so it
  // shows past the brow), fur at the cuffs, and red mittens.
  'winter-parka': {
    body: PARKA, sleeveL: PARKA, sleeveR: PARKA, front: PARKA_DARK, pants: '#3a3a40', shoes: '#4a3322', hands: MITTEN, packBack: 0,
    parts: [
      cone(0.2, 0.235, 0.1, 6, PARKA, 0, 0.19, 0), b(0.1, 0.03, 0.014, PARKA_DARK, -0.1, 0.27, 0.127, false), b(0.1, 0.03, 0.014, PARKA_DARK, 0.1, 0.27, 0.127, false),
      b(0.47, 0.13, 0.43, PARKA, 0, 0.9, -0.01), b(0.47, 0.3, 0.12, PARKA, 0, 0.75, -0.16), b(0.05, 0.3, 0.34, PARKA, -0.235, 0.74, -0.01), b(0.05, 0.3, 0.34, PARKA, 0.235, 0.74, -0.01),
      b(0.5, 0.06, 0.06, FUR, 0, 0.855, 0.2), b(0.06, 0.26, 0.06, FUR, -0.235, 0.72, 0.18), b(0.06, 0.26, 0.06, FUR, 0.235, 0.72, 0.18),
    ],
    arm: [b(0.106, 0.035, 0.126, FUR, 0, -0.175, 0, false)],
  },
  // NAPO's navy dress uniform: yellow buttons in two rows and a yellow hem, yellow boards on the shoulders,
  // white gloves, and a peaked cap with a yellow band, NAPO's badge on its front and a black visor.
  'napo-dress-uniform': {
    body: DRESS, sleeveL: DRESS, sleeveR: DRESS, front: DRESS_DARK, pants: '#1f2738', shoes: '#141414', hands: GLOVE, packBack: 0,
    parts: [
      ...[0.27, 0.33].flatMap(y => [-0.075, 0.075].map(x => b(0.03, 0.03, 0.014, NAPO_YELLOW, x, y, 0.127, false))), b(0.372, 0.02, 0.252, NAPO_YELLOW, 0, 0.232, 0, false),
      b(0.46, 0.12, 0.42, DRESS, 0, 0.93, 0), b(0.47, 0.035, 0.43, NAPO_YELLOW, 0, 0.885, 0, false), b(0.07, 0.05, 0.012, NAPO_YELLOW, 0, 0.945, 0.216, false),
      b(0.32, 0.035, 0.15, VISOR, 0, 0.87, 0.25),
    ],
    arm: [b(0.11, 0.022, 0.13, NAPO_YELLOW, 0, 0.012, 0, false)],
  },
  // A cranberry sweater knitted by hand: a cream band across it with cranberry diamonds, green at the hem and
  // the cuffs and a cream stripe up each sleeve, jeans, and cream earmuffs on a band over the hair. The band
  // stands clear of the strip down the front, which is the sweater's own cranberry: a sweater has no zip.
  'festival-sweater': {
    body: KNIT, sleeveL: KNIT, sleeveR: KNIT, front: KNIT, pants: '#3d4658', shoes: '#6b4a31', hands: SKIN, packBack: 0,
    parts: [
      b(0.366, 0.06, 0.28, KNIT_CREAM, 0, 0.31, 0, false),
      ...[-0.135, -0.045, 0.045, 0.135].map((x): Part => ({ box: [0.035, 0.035, PLATE], at: [x, 0.31, 0.14 + PLATE / 2], color: KNIT, line: false, spin: Math.PI / 4 })),
      b(0.372, 0.03, 0.252, KNIT_GREEN, 0, 0.235, 0, false),
      b(0.44, 0.03, 0.06, KNIT_BAND, 0, 0.885, 0), b(0.02, 0.1, 0.05, KNIT_BAND, -0.225, 0.83, 0), b(0.02, 0.1, 0.05, KNIT_BAND, 0.225, 0.83, 0),
      b(0.07, 0.12, 0.13, KNIT_CREAM, -0.225, 0.72, 0), b(0.07, 0.12, 0.13, KNIT_CREAM, 0.225, 0.72, 0),
    ],
    arm: [b(0.106, 0.03, 0.126, KNIT_GREEN, 0, -0.175, 0, false), b(0.106, 0.03, 0.126, KNIT_CREAM, 0, -0.1, 0, false)],
  },
};

/**
 * What a character in `jacket` (the player's color) and `look` is drawn in: an outfit this copy draws
 * shows instead of the gear, all but the pack; otherwise each piece of gear in its color, the jacket in
 * the player's color, and the look everyone started with where nothing says otherwise.
 */
export function dressOf(jacket: string, look: Look = {}): Dress {
  return withPattern(clothesOf(jacket, look), look.pattern);
}

/** What someone wears under any pattern: their gear, or an outfit this copy draws, and the pack either way. */
function clothesOf(jacket: string, look: Look): Dress {
  // A bigger bag stands taller and deeper on your back.
  const pack = { bag: look.bag ?? PACK, bagSize: Math.min(1.4, Math.max(0.8, look.bagSize ?? 1)) };
  const outfit = look.outfit && Object.hasOwn(OUTFIT_LOOKS, look.outfit) ? OUTFIT_LOOKS[look.outfit] : undefined;
  if (outfit) return { armL: [], armR: [], torso: JACKET_TORSO, ...outfit, ...pack };
  const c = look.cap === undefined ? '#d63b33' : look.cap;
  return {
    body: jacket, sleeveL: jacket, sleeveR: jacket, front: look.shirt ?? '#2f3440', pants: look.pants ?? '#2f3442', shoes: look.shoes ?? '#3a2a20', hands: look.gloves ?? SKIN,
    ...pack, packBack: 0,
    // No cap: the hair shows on top.
    parts: c ? cap(c, '#f0ece2') : [b(0.44, 0.08, 0.39, HAIR, 0, 0.89, 0)],
    arm: [], armL: [], armR: [], torso: JACKET_TORSO,
  };
}

/** A pattern this copy draws, over the clothes: its parts on the torso and the sleeves. One it does not have (a newer server's) adds nothing. */
function withPattern(d: Dress, pattern: string | undefined): Dress {
  const draw = pattern && Object.hasOwn(PATTERN_LOOKS, pattern) ? PATTERN_LOOKS[pattern] : undefined;
  if (!draw) return d;
  const p = draw(d);
  return { ...d, parts: [...d.parts, ...p.body], armL: [...d.armL, ...p.armL], armR: [...d.armR, ...p.armR] };
}

/** A shade of `hex` that stands out on it, for a pattern: darker on a light cloth, lighter on a dark one. */
export function shadeOf(hex: string): string {
  const n = parseInt(hex.slice(1, 7), 16), rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const light = 0.299 * rgb[0]! + 0.587 * rgb[1]! + 0.114 * rgb[2]! > 128;
  return `#${rgb.map(c => Math.round(light ? c * 0.62 : c + (255 - c) * 0.42).toString(16).padStart(2, '0')).join('')}`;
}

type Bell = Extract<Torso, { kind: 'bell' }>;
/** A bell's radius at height y (it widens toward the bottom), and the half-width of its front face there, and how far that face stands from the middle. */
function bellAt(t: Bell, y: number): { r: number; half: number; front: number } {
  const r = t.bottom + (t.top - t.bottom) * ((y - (t.y - t.h / 2)) / t.h);
  return { r, half: r * Math.sin(Math.PI / t.sides), front: r * Math.cos(Math.PI / t.sides) };
}
/** How far a bell's front face leans back from upright: it looks a little up, at the camera. */
const bellLean = (t: Bell) => Math.atan(((t.bottom - t.top) * Math.cos(Math.PI / t.sides)) / t.h);

/** Where u across (-1 to 1, left to right as you face them) and v up (-1 to 1, bottom to top) lie on the torso's front. */
function onFront(t: Torso, u: number, v: number): { x: number; y: number; z: number } {
  const y = t.y + (v * t.h) / 2;
  if (t.kind === 'box') return { x: (u * t.w) / 2, y, z: t.d / 2 };
  const at = bellAt(t, y);
  return { x: u * at.half, y, z: at.front };
}

/**
 * A straight bar on the torso's front from u0,v0 to u1,v1, `thick` across (measured on the face), lying flat
 * on it: turned in its plane where it slants, leaned back with a bell's face, `lift` more in front of it.
 */
function bar(t: Torso, u0: number, v0: number, u1: number, v1: number, thick: number, color: string, lift = 0): Part {
  const a = onFront(t, u0, v0), c = onFront(t, u1, v1), tilt = t.kind === 'bell' ? -bellLean(t) : 0;
  // Up the face, a bell's slope is a little longer than its height.
  const dx = c.x - a.x, dy = (c.y - a.y) / Math.cos(tilt), len = Math.hypot(dx, dy) || thick;
  const z = (a.z + c.z) / 2 + (PLATE / 2 + lift) / Math.cos(tilt);
  return { box: [len, thick, PLATE], at: [(a.x + c.x) / 2, (a.y + c.y) / 2, z], color, line: false, ...(dy ? { spin: Math.atan2(dy, dx) } : {}), ...(tilt ? { tilt } : {}) };
}

/** A patch on the torso's front, from u0,v0 to u1,v1. */
function patch(t: Torso, u0: number, v0: number, u1: number, v1: number, color: string, lift = 0): Part {
  const tall = (Math.abs(v1 - v0) * t.h) / 2 / Math.cos(t.kind === 'bell' ? bellLean(t) : 0);
  return bar(t, u0, (v0 + v1) / 2, u1, (v0 + v1) / 2, tall, color, lift);
}

/** A diamond, a square turned half a right angle, `size` along its sides, lying flat on the torso's front at u,v. */
function diamond(t: Torso, u: number, v: number, size: number, color: string): Part {
  const a = onFront(t, u, v), tilt = t.kind === 'bell' ? -bellLean(t) : 0;
  return { box: [size, size, PLATE], at: [a.x, a.y, a.z + PLATE / 2 / Math.cos(tilt)], color, line: false, spin: Math.PI / 4, ...(tilt ? { tilt } : {}) };
}

/** Halfway between two colors: a second shade, between a cloth and its shadeOf. */
function between(a: string, b: string): string {
  const rgb = (hex: string) => { const n = parseInt(hex.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const x = rgb(a), y = rgb(b);
  return `#${x.map((c, i) => Math.round((c + y[i]!) / 2).toString(16).padStart(2, '0')).join('')}`;
}

/** A band all the way round the torso, from v0 up to v1. */
function band(t: Torso, v0: number, v1: number, color: string): Part {
  const y0 = t.y + (v0 * t.h) / 2, y1 = t.y + (v1 * t.h) / 2;
  if (t.kind === 'box') return b(t.w + 2 * PROUD, y1 - y0, t.d + 2 * PROUD, color, 0, (y0 + y1) / 2, 0, false);
  return cone(bellAt(t, y1).r + PROUD, bellAt(t, y0).r + PROUD, y1 - y0, t.sides, color, 0, (y0 + y1) / 2, 0, false);
}

/** A sleeve as makePlayer builds it, from its shoulder: 0.1 across, 0.2 long, 0.12 deep, its middle 0.09 below the shoulder. */
const SLEEVE = { w: 0.1, h: 0.2, d: 0.12, y: -0.09 };
/** A band round a sleeve, from `y0` down to `y1` (below the shoulder). */
const cuff = (y0: number, y1: number, color: string): Part => b(SLEEVE.w + 2 * PROUD, y0 - y1, SLEEVE.d + 2 * PROUD, color, 0, (y0 + y1) / 2, 0, false);
/** A patch on the outer side of a sleeve (`side` -1 on the left arm, 1 on the right), `h` tall and `d` wide, its middle `y` below the shoulder. */
const sleevePatch = (side: -1 | 1, y: number, h: number, d: number, color: string): Part => b(PLATE, h, d, color, side * (SLEEVE.w / 2 + PLATE / 2), y, 0, false);

/** What a pattern adds: on the body, and on each sleeve where the sleeves show. */
export interface PatternParts { body: Part[]; armL: Part[]; armR: Part[] }
const TAPE = '#e2e6e2';
const RAG = { red: '#a8584a', mustard: '#c39a3e', teal: '#3e7c77', blue: '#4f6b95' } as const;
const AURORA = { green: '#5fd49a', violet: '#9b7be0' } as const, BOLT = '#f2c94c';

/**
 * How each jacket pattern looks, by id (merits.ts), from the clothes it goes on: in a shade of their cloth
 * (shadeOf), or in colors of its own (the pale tape, NAPO's yellow, the cloth of the squares). What is on
 * the front sits low, where the camera sees past the big head, and the sleeves carry some too, since they
 * are what shows from the side; a cape's bell takes it all on its front, and hides the sleeves.
 */
export const PATTERN_LOOKS: Readonly<Record<string, (d: Dress) => PatternParts>> = {
  // Four stripes down the front, clear of the zip, and one down each sleeve.
  stripes: d => {
    const t = d.torso, ink = shadeOf(d.body), sleeves = t.kind === 'box';
    const stripe = (cloth: string) => b(0.03, SLEEVE.h - 0.004, SLEEVE.d + 2 * PROUD, shadeOf(cloth), 0, SLEEVE.y, 0, false);
    return { body: [-0.8, -0.4, 0.4, 0.8].map(u => patch(t, u - 0.09, -1, u + 0.09, 1, ink)), armL: sleeves ? [stripe(d.sleeveL)] : [], armR: sleeves ? [stripe(d.sleeveR)] : [] };
  },
  // Big checks: every other square of four by four on the front, and of two by four on each sleeve.
  checks: d => {
    const t = d.torso, ink = shadeOf(d.body), sleeves = t.kind === 'box', body: Part[] = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) body.push(patch(t, -1 + i / 2, -1 + j / 2, -0.5 + i / 2, -0.5 + j / 2, ink));
    const squares = (cloth: string) => {
      const out: Part[] = [], w = SLEEVE.w / 2 + PROUD, h = SLEEVE.h / 4;
      for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) out.push(b(w, h - 0.002, SLEEVE.d + 2 * PROUD, shadeOf(cloth), (i - 0.5) * w, SLEEVE.y + SLEEVE.h / 2 - (j + 0.5) * h, 0, false));
      return out;
    };
    return { body, armL: sleeves ? squares(d.sleeveL) : [], armR: sleeves ? squares(d.sleeveR) : [] };
  },
  // Two chevrons, one over the other, pointing down low on the front; a cuff round each sleeve.
  chevron: d => {
    const t = d.torso, ink = shadeOf(d.body), sleeves = t.kind === 'box';
    const v = (top: number, tip: number) => [bar(t, -0.78, top, 0, tip, 0.034, ink), bar(t, 0, tip, 0.78, top, 0.034, ink)];
    return { body: [...v(0.2, -0.3), ...v(-0.3, -0.8)], armL: sleeves ? [cuff(-0.15, -0.18, shadeOf(d.sleeveL))] : [], armR: sleeves ? [cuff(-0.15, -0.18, shadeOf(d.sleeveR))] : [] };
  },
  // Two pale bands round the body and one round each sleeve, where the lineman's jacket has them.
  reflective: d => {
    const t = d.torso, sleeve = t.kind === 'box' ? [cuff(-0.125, -0.155, TAPE)] : [];
    return { body: [band(t, -0.75, -0.54, TAPE), band(t, -0.2, 0.01, TAPE)], armL: sleeve, armR: [...sleeve] };
  },
  // NAPO's yellow patch low on the front, its lettering a dark line across it, and another on the left sleeve.
  'napo-patch': d => {
    const t = d.torso;
    return {
      body: [patch(t, 0.34, -0.55, 0.8, -0.08, NAPO_YELLOW), patch(t, 0.42, -0.35, 0.72, -0.27, '#4a3d12', PLATE)],
      armL: t.kind === 'box' ? [sleevePatch(-1, -0.07, 0.06, 0.07, NAPO_YELLOW)] : [], armR: [],
    };
  },
  // Squares of other cloth sewn on: three on the front and one on each sleeve.
  squares: d => {
    const t = d.torso, sleeves = t.kind === 'box';
    return {
      body: [patch(t, -0.85, -0.85, -0.3, -0.2, RAG.mustard), patch(t, 0.3, -0.5, 0.8, 0.1, RAG.teal), patch(t, -0.15, -0.95, 0.3, -0.55, RAG.blue)],
      armL: sleeves ? [sleevePatch(-1, -0.1, 0.07, 0.075, RAG.red)] : [], armR: sleeves ? [sleevePatch(1, -0.06, 0.06, 0.08, RAG.blue)] : [],
    };
  },
  // From the shop, then. Argyle: diamonds in two rows low on the front, in two shades of the cloth, and a
  // diamond on each sleeve's side.
  argyle: d => {
    const t = d.torso, ink = shadeOf(d.body), mid = between(d.body, ink), sleeves = t.kind === 'box';
    const rows: Array<[number, number, string]> = [[-0.55, -0.35, ink], [0, -0.35, mid], [0.55, -0.35, ink], [-0.28, -0.8, mid], [0.28, -0.8, ink]];
    const side = (s: -1 | 1, cloth: string): Part => ({ box: [PLATE, 0.055, 0.055], at: [s * (SLEEVE.w / 2 + PLATE / 2), SLEEVE.y, 0], color: shadeOf(cloth), line: false, tilt: Math.PI / 4 });
    return { body: rows.map(([u, v, c]) => diamond(t, u, v, 0.07, c)), armL: sleeves ? [side(-1, d.sleeveL)] : [], armR: sleeves ? [side(1, d.sleeveR)] : [] };
  },
  // Aurora bands: a green band and a violet one round the body, low, and a green cuff on each sleeve.
  'aurora-bands': d => {
    const t = d.torso, sleeve = t.kind === 'box' ? [cuff(-0.125, -0.155, AURORA.green)] : [];
    return { body: [band(t, -0.8, -0.6, AURORA.green), band(t, -0.5, -0.3, AURORA.violet)], armL: sleeve, armR: [...sleeve] };
  },
  // Lightning: a yellow bolt down the front, a zigzag of three bars, and a small one on the right sleeve.
  lightning: d => {
    const t = d.torso;
    const bolt = [bar(t, 0.35, 0.1, -0.12, -0.35, 0.05, BOLT), bar(t, -0.2, -0.3, 0.22, -0.45, 0.05, BOLT), bar(t, 0.16, -0.42, -0.3, -0.95, 0.05, BOLT)];
    return { body: bolt, armL: [], armR: t.kind === 'box' ? [sleevePatch(1, -0.08, 0.08, 0.025, BOLT)] : [] };
  },
};

/** One part as a mesh, with its outline unless it has none. */
function partMesh(p: Part): THREE.Mesh {
  const [x, y, z] = p.at, line = p.line !== false;
  if ('box' in p) {
    const m = box(p.box[0], p.box[1], p.box[2], p.color, x, y, z, line);
    // Turned in its own plane first, then leaned back with it: three.js turns about z, then y, then x.
    m.rotation.set(p.tilt ?? 0, 0, p.spin ?? 0);
    return m;
  }
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
  for (const [a, sleeve, own] of [[armL, d.sleeveL, d.armL], [armR, d.sleeveR, d.armR]] as const) {
    a.add(...joined([box(SLEEVE.w, SLEEVE.h, SLEEVE.d, sleeve, 0, SLEEVE.y, 0), box(0.085, 0.07, 0.1, d.hands, 0, -0.22, 0), ...[...d.arm, ...own].map(partMesh)]));
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

/** Afterglows drawn at once, at most: a few players who all stood by a flash. */
const AFTERGLOWS = 6;

/**
 * An afterglow (a quirk, gear.ts): a faint warm light around whoever a flash left glowing, breathing
 * slowly, seen by everyone on the map. A few soft sprites, built once and always in the scene; each frame
 * shows as many as there are glowing players, nearest first, so nothing recompiles.
 */
export class Afterglows {
  readonly root = new THREE.Group();
  private readonly tex = softTexture(0.45);
  private readonly mat = new THREE.SpriteMaterial({ map: this.tex, color: 0xfff0c2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.4 });
  private readonly sprites: THREE.Sprite[] = [];

  constructor() {
    for (let i = 0; i < AFTERGLOWS; i++) {
      const s = new THREE.Sprite(this.mat);
      s.scale.set(1.5, 1.9, 1);
      s.visible = false;
      this.sprites.push(s);
      this.root.add(s);
    }
  }

  /** Where the glowing players stand now (world units, feet on the ground), nearest first; `t` makes them breathe. */
  set(list: ReadonlyArray<{ x: number; y: number; z: number }>, t: number) {
    this.mat.opacity = 0.3 + 0.1 * Math.sin(t * 1.7);
    this.sprites.forEach((s, i) => {
      const at = list[i];
      s.visible = !!at;
      if (at) s.position.set(at.x, at.y + 0.72, at.z);
    });
  }

  dispose() {
    this.tex.dispose();
    this.mat.dispose();
  }
}
