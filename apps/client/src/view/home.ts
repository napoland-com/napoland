/**
 * A home of one's own as its owner built it up (shared house.ts): the house in its garden, which looks
 * different at each level on the same 5 by 3 tiles (a concrete garage, a log cabin, a house with two floors
 * and a porch), the colors of the room inside at that level, and what stands in the room only from a level
 * on (the kitchen, the map table), with boxes in their places until then. Plain builders of toon boxes for
 * world.ts, which bakes them with the other props; the view is built again when the house changes.
 */
import * as THREE from 'three';
import type { MapObject, TileMap } from '@napoland/shared';
import { againstWall, tableModel, type RoomTone } from './interior';
import type { Doorway } from './napo';
import { box, flat, hash2, part, pivot } from './toon';

type House = Extract<MapObject, { kind: 'house' }>;

/** The levels a house is drawn at: the garage it starts as, the cabin, the house. Anything past the last is drawn as the last. */
export const HOME_LOOKS = 3;

/** A gable roof: a triangular prism, ridge along x, its open bottom on the walls. */
function gable(w: number, h: number, d: number): THREE.BufferGeometry {
  const hw = w / 2, hd = d / 2;
  const A = [-hw, 0, -hd], B = [-hw, 0, hd], C = [-hw, h, 0], D = [hw, 0, -hd], E = [hw, 0, hd], F = [hw, h, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([A, B, C, D, F, E, B, E, F, B, F, C, A, C, F, A, F, D].flat(), 3));
  g.computeVertexNormals();
  return g;
}

/**
 * The house in a garden of one's own, drawn at `level` (house.ts) on its tiles: walls with the doorway cut
 * into them where `doorX` says (open, like every door, and warm: the fire at home never goes out), the name
 * plate by it, and the rest of what that level is. `smoke`: where the smoke of its fire rises.
 */
export function homeModel(h: House, level: number, doorX: number, door: Doorway, mats: { warm: THREE.Material; doorGlow: THREE.Material }): { root: THREE.Group; smoke: THREE.Vector3 } {
  const cx = h.x + h.w / 2, cz = h.y + h.h / 2, g = pivot(cx, 0, cz);
  const look = Math.min(HOME_LOOKS, Math.max(1, Math.floor(level)));
  // The same margins as every building's (napo.ts), so the doorway sits as deep as a cabin's: you stand in it on the door tile.
  const W = h.w - 0.2, front = h.h / 2 - 0.15, back = -front, fd = 0.85 - door.back, dx = doorX + 0.5 - cx, fz = front - fd / 2;
  const H = look === 1 ? 1.2 : look === 2 ? 1.2 : 1.15;
  const wall = homeWall(look);
  const solid = front - fd - back, left = dx - door.w / 2 + W / 2, right = W / 2 - dx - door.w / 2;
  g.add(box(W, H, solid, wall, 0, H / 2, back + solid / 2));
  g.add(box(left, H, fd, wall, -W / 2 + left / 2, H / 2, fz), box(right, H, fd, wall, W / 2 - right / 2, H / 2, fz));
  g.add(box(door.w, H - door.h, fd, wall, dx, (H + door.h) / 2, fz));
  // The doorway, its inside seen from without: warm, since the fire behind it never goes out.
  g.add(part(new THREE.BoxGeometry(door.w - 0.02, door.h - 0.02, fd), mats.doorGlow, dx, door.h / 2, fz + 0.005, false));
  const trim = look === 1 ? '#3f4447' : look === 2 ? '#2e241c' : '#e9e3d4';
  for (const s of [-1, 1]) g.add(box(0.07, door.h + 0.05, 0.08, trim, dx + s * (door.w / 2 + 0.035), (door.h + 0.05) / 2, front + 0.01, 0.015));
  g.add(box(door.w + 0.2, 0.07, 0.09, trim, dx, door.h + 0.05, front + 0.01, 0.015));
  const hinge = pivot(dx - door.w / 2, 0, front + 0.02);
  hinge.rotation.y = -1.95;
  hinge.add(box(door.w - 0.04, door.h - 0.04, 0.05, look === 1 ? '#5b6568' : look === 2 ? '#4a3526' : '#6c3b2f', (door.w - 0.04) / 2, (door.h - 0.04) / 2 + 0.01, 0, 0.018));
  g.add(hinge);
  // The name plate by the door: whose home it is shows over it as you come near (the Hud's tag).
  g.add(box(0.44, 0.12, 0.03, '#8a6a45', dx, door.h + 0.17, front + 0.02, 0.012), box(0.3, 0.025, 0.01, '#3b2b1d', dx, door.h + 0.17, front + 0.038, false));
  // A mat in front, and a warm lamp over the door.
  g.add(box(0.66, 0.014, 0.36, '#6d4d35', dx, 0.007, front + 0.22, false));
  g.add(part(new THREE.BoxGeometry(0.14, 0.1, 0.08), mats.warm, dx, door.h + 0.36, front + 0.06, false));
  const window = (x: number, y: number, w: number, hh: number, frame: string) => {
    g.add(box(w + 0.1, hh + 0.1, 0.04, frame, x, y, front + 0.005, false));
    g.add(part(new THREE.BoxGeometry(w, hh, 0.05), mats.warm, x, y, front + 0.02, false));
    g.add(box(0.03, hh, 0.02, frame, x, y, front + 0.05, false), box(w, 0.03, 0.02, frame, x, y, front + 0.05, false));
  };
  let smoke: THREE.Vector3;
  if (look === 1) {
    // A concrete garage somebody lived in when the town emptied: courses of block, a roll-up door on one
    // side of the way in, a small barred window on the other, and a stovepipe through the tin roof.
    for (let y = 0.25; y < H; y += 0.25) g.add(box(W + 0.01, 0.018, front - back + 0.01, '#6f6e69', 0, y, 0, false));
    const rx = dx - door.w / 2 - 1.05;
    g.add(box(1.5, 0.98, 0.05, '#7d6a55', rx, 0.5, front + 0.01, 0.012));
    for (let y = 0.1; y < 0.98; y += 0.12) g.add(box(1.5, 0.018, 0.02, '#5d4d3c', rx, y, front + 0.04, false));
    g.add(box(1.62, 0.07, 0.07, '#3f4447', rx, 1.02, front + 0.02, false));
    g.add(box(0.5, 0.32, 0.04, '#3f4447', dx + door.w / 2 + 0.8, 0.82, front + 0.005, false));
    g.add(part(new THREE.BoxGeometry(0.4, 0.22, 0.05), mats.warm, dx + door.w / 2 + 0.8, 0.82, front + 0.02, false));
    for (const bx of [-0.12, 0, 0.12]) g.add(box(0.025, 0.24, 0.02, '#4a5052', dx + door.w / 2 + 0.8 + bx, 0.82, front + 0.05, false));
    // Corrugated tin, sloping to the back, a little over the walls.
    const roof = pivot(0, H + 0.06, 0);
    roof.rotation.x = -0.08;
    roof.add(box(W + 0.3, 0.07, front - back + 0.35, '#6a6f72', 0, 0, 0.05));
    for (let x = -W / 2; x <= W / 2 + 0.01; x += 0.3) roof.add(box(0.05, 0.03, front - back + 0.36, '#80868a', x, 0.045, 0.05, false));
    g.add(roof);
    const pipeX = W / 2 - 0.7, pipeZ = back + 0.5;
    g.add(part(flat(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 8)), '#3a3d3f', pipeX, H + 0.35, pipeZ, 0.015));
    g.add(part(flat(new THREE.ConeGeometry(0.13, 0.1, 8)), '#3a3d3f', pipeX, H + 0.75, pipeZ, 0.012));
    smoke = new THREE.Vector3(cx + pipeX, H + 0.85, cz + pipeZ);
  } else if (look === 2) {
    // A log cabin: round logs one over another, a pitched roof over the lot, windows either side of the door,
    // a stone chimney at the east end, and a little roof on two posts over the way in.
    for (let y = 0.12; y < H; y += 0.2) {
      g.add(box(W + 0.08, 0.05, front - back + 0.08, '#5a3d2a', 0, y, 0, false));
      for (const s of [-1, 1]) g.add(part(flat(new THREE.CylinderGeometry(0.07, 0.07, front - back + 0.2, 6).rotateX(Math.PI / 2)), '#7a5639', s * (W / 2 + 0.02), y, 0, false));
    }
    window(dx - door.w / 2 - 0.75, 0.72, 0.5, 0.36, '#2e241c');
    window(dx + door.w / 2 + 0.75, 0.72, 0.5, 0.36, '#2e241c');
    g.add(box(W + 0.5, 0.09, front - back + 0.6, '#3d2f25', 0, H + 0.02, 0));
    g.add(part(gable(W + 0.46, 1.1, front - back + 0.56), '#4a3a30', 0, H + 0.06, 0, 0.03));
    const chimX = W / 2 - 0.45, chimZ = back + 0.55;
    g.add(box(0.36, 1.25, 0.36, '#6f6a60', chimX, H + 0.35, chimZ));
    for (let y = H - 0.1; y < H + 0.9; y += 0.18) g.add(box(0.37, 0.02, 0.37, '#57534b', chimX, y, chimZ, false));
    for (const s of [-1, 1]) g.add(box(0.07, 1.05, 0.07, '#4a3526', dx + s * 0.55, 0.52, front + 0.5, 0.012));
    const porch = pivot(dx, 1.08, front + 0.3);
    porch.rotation.x = 0.25;
    porch.add(box(1.4, 0.06, 0.62, '#3d2f25'));
    g.add(porch);
    smoke = new THREE.Vector3(cx + chimX, H + 1.05, cz + chimZ);
  } else {
    // A house: painted boards and white trim on two floors under a steep slate roof, a porch across the
    // front on white posts, windows on both floors, and a brick chimney.
    for (let y = 0.16; y < H; y += 0.16) g.add(box(W + 0.01, 0.012, front - back + 0.01, '#9d937b', 0, y, 0, false));
    window(dx - door.w / 2 - 0.75, 0.66, 0.46, 0.4, '#e9e3d4');
    window(dx + door.w / 2 + 0.75, 0.66, 0.46, 0.4, '#e9e3d4');
    // The upper floor, a little in from the walls below, with its own windows.
    const U = 0.95, uw = W - 0.2, uf = front - 0.15;
    g.add(box(uw, U, uf - back + 0.05, '#b8ae95', 0, H + U / 2, (uf + back) / 2));
    for (let y = H + 0.16; y < H + U; y += 0.16) g.add(box(uw + 0.01, 0.012, uf - back + 0.06, '#9d937b', 0, y, (uf + back) / 2, false));
    g.add(box(W + 0.05, 0.08, front - back + 0.05, '#e9e3d4', 0, H + 0.02, 0, false));
    for (const ux of [-1.3, 0, 1.3]) {
      g.add(box(0.5, 0.46, 0.04, '#e9e3d4', ux, H + 0.5, uf + 0.03, false));
      g.add(part(new THREE.BoxGeometry(0.4, 0.36, 0.05), mats.warm, ux, H + 0.5, uf + 0.045, false));
      g.add(box(0.03, 0.36, 0.02, '#e9e3d4', ux, H + 0.5, uf + 0.075, false));
    }
    g.add(box(uw + 0.45, 0.09, uf - back + 0.5, '#2f363d', 0, H + U + 0.02, (uf + back) / 2));
    g.add(part(gable(uw + 0.42, 1.25, uf - back + 0.46), '#3d4650', 0, H + U + 0.06, (uf + back) / 2, 0.03));
    // The porch: a deck in front of the whole house, white posts and a railing, its roof sloping away.
    g.add(box(W + 0.1, 0.06, 0.6, '#8a6f55', 0, 0.03, front + 0.3, 0.012));
    for (const px of [-W / 2 + 0.05, -0.7, 0.7, W / 2 - 0.05]) g.add(box(0.07, 1.1, 0.07, '#e9e3d4', px, 0.58, front + 0.55, 0.012));
    for (const [x0, x1] of [[-W / 2 + 0.05, -0.7], [0.7, W / 2 - 0.05]] as const) g.add(box(x1 - x0, 0.05, 0.04, '#e9e3d4', (x0 + x1) / 2, 0.45, front + 0.55, false));
    const porch = pivot(0, 1.14, front + 0.33);
    porch.rotation.x = 0.22;
    porch.add(box(W + 0.2, 0.06, 0.72, '#2f363d'));
    g.add(porch);
    const chimX = -W / 2 + 0.55, chimZ = back + 0.45;
    g.add(box(0.36, 2.35, 0.36, '#7a4b3a', chimX, H + 0.95, chimZ));
    for (let y = 0.2; y < H + 2.1; y += 0.14) g.add(box(0.37, 0.015, 0.37, '#5f3a2d', chimX, y, chimZ, false));
    smoke = new THREE.Vector3(cx + chimX, H + 2.2, cz + chimZ);
  }
  return { root: g, smoke };
}

/**
 * The room of a home, in the colors of its level (interior.ts, RoomTone): the garage's courses of block and
 * concrete floor, the cabin's logs (as every cabin's), the house's painted boards over a dark floor. Warm:
 * the fire at home never goes out.
 */
export function homeTone(level: number): RoomTone {
  const c = (s: string) => new THREE.Color(s);
  const look = Math.min(HOME_LOOKS, Math.max(1, Math.floor(level)));
  if (look === 1) return { plank: c('#7a746c'), gap: c('#36322e'), log: c('#86817a'), seam: c('#3d3935'), rim: c('#5a5650'), top: c('#211f1d'), cut: c('#211f1d'), concrete: true };
  if (look === 2) return { plank: c('#7c5638'), gap: c('#2c1d13'), log: c('#735036'), seam: c('#2e2018'), rim: c('#4d3727'), top: c('#1e1510'), cut: c('#1e1510') };
  return { plank: c('#6b4a33'), gap: c('#24170f'), log: c('#b5a88a'), seam: c('#8e8266'), rim: c('#6d6552'), top: c('#1d1a15'), cut: c('#1d1a15'), boards: true };
}

/**
 * The kitchen (house.ts): a counter against its wall with an iron stove top, a kettle and a pot on it, and a
 * shelf of jars over it, the pantry's.
 */
export function kitchenModel(o: { x: number; y: number }, map: TileMap): THREE.Group {
  const g = pivot(o.x + 0.5, 0, o.y + 0.5);
  g.rotation.y = againstWall(map, o.x, o.y);
  g.add(box(0.92, 0.6, 0.58, '#6b4a31', 0, 0.3, -0.12));
  g.add(box(0.96, 0.05, 0.62, '#8f8a82', 0, 0.62, -0.12));
  for (const dx of [-0.22, 0.22]) g.add(box(0.36, 0.44, 0.02, '#5a3d2a', dx, 0.3, 0.18, false), box(0.05, 0.03, 0.02, '#b09a62', dx + (dx < 0 ? 0.12 : -0.12), 0.42, 0.2, false));
  // The stove top: two rings, a kettle on one, a pot on the other.
  g.add(box(0.5, 0.03, 0.4, '#2b2b2d', 0.18, 0.66, -0.14, false));
  for (const rx of [0.06, 0.3]) g.add(part(new THREE.CylinderGeometry(0.08, 0.08, 0.012, 10), '#3b3b3e', rx, 0.68, -0.14, false));
  g.add(part(flat(new THREE.CylinderGeometry(0.07, 0.09, 0.12, 8)), '#44484b', 0.06, 0.75, -0.14, 0.012));
  g.add(part(flat(new THREE.CylinderGeometry(0.1, 0.09, 0.1, 10)), '#6d4034', 0.3, 0.74, -0.14, 0.012));
  // The pantry's shelf on the wall behind, jars of what the woods gave.
  g.add(box(0.9, 0.04, 0.2, '#5a3d2a', 0, 1.25, -0.36, false));
  ['#c2a24a', '#7d8a3a', '#9b3b3b', '#d9c38a', '#5e7a8a'].forEach((col, i) => g.add(part(flat(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 7)), col, -0.34 + i * 0.17, 1.34, -0.36, 0.01)));
  return g;
}

/**
 * The map table (house.ts): a table with the woods drawn out on it, pins where the fires and the slabs are,
 * and a lamp to read it by. It tells what the notice board in town tells.
 */
export function mapTableModel(o: { x: number; y: number }): THREE.Group {
  const g = tableModel(o.x, o.y);
  g.add(box(0.74, 0.008, 0.58, '#d8cfb4', 0, 0.61, 0, false));
  const v = hash2(o.x, o.y);
  for (let k = 0; k < 5; k++) g.add(box(0.5 - k * 0.05, 0.004, 0.012, '#5f7a55', -0.05 + (k % 2) * 0.06, 0.616, -0.2 + k * 0.09, false));
  g.add(box(0.012, 0.004, 0.4, '#5a6f86', 0.18, 0.616, 0, false));
  for (const [px, pz, col] of [[-0.22, -0.12, '#b13a2c'], [0.1, 0.16, '#d6ad2f'], [0.26, -0.2, '#b13a2c']] as const) g.add(box(0.025, 0.05, 0.025, col, px + (v - 0.5) * 0.04, 0.64, pz, false));
  g.add(part(flat(new THREE.CylinderGeometry(0.05, 0.07, 0.16, 8)), '#8a7a5a', -0.28, 0.69, 0.2, 0.012));
  return g;
}

/** The color of the house's walls at `level`: block, logs or painted boards, what tells the looks apart from afar. */
export function homeWall(level: number): string {
  const look = Math.min(HOME_LOOKS, Math.max(1, Math.floor(level)));
  return look === 1 ? '#8b8a84' : look === 2 ? '#6e4c34' : '#b8ae95';
}
