/**
 * Chibi characters built from boxes: big head, short legs, outlines. Players differ by jacket color.
 * Each model owns its geometries (freed with disposeTree when the player leaves or the map changes);
 * its materials come from toon(), which every model shares and nothing frees.
 */
import * as THREE from 'three';
import type { NpcLook } from '@napoland/shared';
import { box, flat, part, pivot, softTexture, toon } from './toon';

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
 * left out keeps the look everyone started with.
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
}

/** The player character: a cap, a rain jacket in the player's color, a backpack, and what they wear. Faces +z. */
export function makePlayer(jacket: string, look: Look = {}): Rig {
  const root = new THREE.Group();
  const legL = pivot(-0.085, 0.24, 0), legR = pivot(0.085, 0.24, 0);
  for (const l of [legL, legR]) {
    l.add(box(0.11, 0.17, 0.13, look.pants ?? '#2f3442', 0, -0.085, 0));
    l.add(box(0.12, 0.07, 0.17, look.shoes ?? '#3a2a20', 0, -0.2, 0.02));
    root.add(l);
  }
  root.add(box(0.36, 0.28, 0.24, jacket, 0, 0.36, 0));
  root.add(box(0.1, 0.2, 0.02, look.shirt ?? '#2f3440', 0, 0.37, 0.121, false));
  // A bigger bag stands taller and deeper on your back.
  const k = Math.min(1.4, Math.max(0.8, look.bagSize ?? 1));
  root.add(box(0.3, 0.32 * k, 0.16 * k, look.bag ?? '#6b5a3a', 0, 0.4 + 0.08 * (k - 1), -0.12 - 0.07 * k));
  const roll = part(flat(new THREE.CylinderGeometry(0.07, 0.07, 0.34, 8)), '#4f6a52', 0, 0.6 + 0.16 * (k - 1), -0.12 - 0.07 * k);
  roll.rotation.z = Math.PI / 2;
  root.add(roll);
  const armL = pivot(-0.225, 0.47, 0), armR = pivot(0.225, 0.47, 0);
  for (const a of [armL, armR]) {
    a.add(box(0.1, 0.2, 0.12, jacket, 0, -0.09, 0));
    a.add(box(0.085, 0.07, 0.1, look.gloves ?? '#f2cda8', 0, -0.22, 0));
    root.add(a);
  }
  root.add(box(0.42, 0.37, 0.37, '#f2cda8', 0, 0.69, 0));
  root.add(box(0.44, 0.1, 0.39, '#2b2421', 0, 0.82, 0));
  root.add(box(0.44, 0.2, 0.1, '#2b2421', 0, 0.72, -0.15));
  const cap = look.cap === undefined ? '#d63b33' : look.cap;
  if (cap) {
    root.add(box(0.45, 0.13, 0.41, cap, 0, 0.92, 0));
    root.add(box(0.22, 0.09, 0.02, '#f0ece2', 0, 0.925, 0.21, false));
    root.add(box(0.32, 0.04, 0.17, cap, 0, 0.865, 0.26));
  } else root.add(box(0.44, 0.08, 0.39, '#2b2421', 0, 0.89, 0));
  eyes(root, 0.69, 0.186, 0.09);
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
