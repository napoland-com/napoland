/**
 * Chibi characters built from boxes: big head, short legs, outlines. Players differ by jacket color.
 * Each model owns its geometries (freed with disposeTree when the player leaves or the map changes);
 * its materials come from toon(), which every model shares and nothing frees.
 */
import * as THREE from 'three';
import { box, flat, part, pivot, toon } from './toon';

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

/** A townsperson in a long coat and scarf, with a floating "!" above. */
export function makeNpc(): { root: THREE.Group; bang: THREE.Group } {
  const root = new THREE.Group();
  root.add(part(flat(new THREE.CylinderGeometry(0.15, 0.25, 0.4, 6)), '#4f7a70', 0, 0.2, 0));
  root.add(box(0.26, 0.14, 0.2, '#4f7a70', 0, 0.44, 0));
  root.add(box(0.3, 0.06, 0.24, '#d9703a', 0, 0.5, 0));
  for (const x of [-0.17, 0.17]) root.add(box(0.07, 0.16, 0.08, '#f2cda8', x, 0.36, 0));
  root.add(box(0.4, 0.36, 0.35, '#f2cda8', 0, 0.68, 0));
  root.add(box(0.43, 0.14, 0.38, '#6a3a24', 0, 0.83, 0));
  root.add(box(0.43, 0.32, 0.1, '#6a3a24', 0, 0.68, -0.14));
  for (const x of [-0.21, 0.21]) root.add(box(0.12, 0.12, 0.12, '#6a3a24', x, 0.86, -0.08));
  eyes(root, 0.68, 0.176, 0.085);
  const bangMat = toon('#ffcf3a', { emissive: 0x7a5a00 });
  const bang = new THREE.Group();
  bang.add(box(0.07, 0.2, 0.07, bangMat, 0, 0.16, 0, 0.018));
  bang.add(box(0.07, 0.07, 0.07, bangMat, 0, -0.03, 0, 0.018));
  root.add(bang);
  return { root, bang };
}
