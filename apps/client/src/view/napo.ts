/**
 * What NAPO left behind, as the South Road shows it: its concrete buildings (any size, a flat roof
 * with a rim of NAPO yellow), its yellow warning signs, and the Tower, a red and white mast with
 * a dish turned toward the woods and a light blinking on top; and its things out in the places: a
 * burned-out jeep, its box trucks and fuel pump in the motor pool, the sample cages at the field site
 * with a humming rock in each, its survey stakes, and its teleports (one in every cabin, its twin in
 * town), whose rock hums too. Plain builders of toon boxes for world.ts, which
 * bakes them with the other props; only the Tower's light keeps a material of its own, which world.ts
 * blinks, and the rocks in the cages share one that glows faintly, the same day and night.
 */
import * as THREE from 'three';
import type { MapObject } from '@napoland/shared';
import { vehiclePlace } from './left';
import { box, flat, hash2, part, pivot, toon } from './toon';

type House = Extract<MapObject, { kind: 'house' }>;
type Sign = Extract<MapObject, { kind: 'sign' }>;

/** NAPO's yellow, on its signs and around its buildings. */
export const NAPO_YELLOW = '#d6ad2f';
const CONCRETE = '#7c8081';
const STEEL = '#6f777a';
const INK = '#1a1b1c';
/** How tall NAPO's buildings stand, to the top of the walls (a cabin's walls are 1.15). */
export const NAPO_WALL_H = 1.3;
/** How tall the Tower stands, to its light. */
export const TOWER_H = 3.7;

/** The doorway every building shares with the cabins (world.ts): its width, its height and how deep it goes in. */
export interface Doorway {
  w: number;
  h: number;
  back: number;
}

/**
 * One of NAPO's buildings on its tiles: concrete walls, the doorway (open, like every door) where
 * `doorX` says, small high windows, a NAPO plate over the door, and a flue and a vent on the roof;
 * a big one has a small dish too. `flue` is where its smoke starts, when the room behind the door
 * keeps a fire. Lit: someone is in, so a window glows and a lamp hangs over the door. Unlit, the
 * windows are dark behind bars.
 */
export function napoBuilding(h: House, doorX: number, fire: boolean, door: Doorway, mats: { warm: THREE.Material; doorGlow: THREE.Material }): { root: THREE.Group; flue: THREE.Vector3 } {
  const cx = h.x + h.w / 2, cz = h.y + h.h / 2;
  const g = pivot(cx, 0, cz);
  // The same margins as a cabin's (2.8 by 1.7 on 3 by 2 tiles), so a door sits the same in any building.
  const W = h.w - 0.2, front = h.h / 2 - 0.15, back = -front, H = NAPO_WALL_H;
  // The doorway goes as deep into the front wall as a cabin's: you stand in it on the door tile.
  const fd = 0.85 - door.back, dx = doorX + 0.5 - cx, fz = front - fd / 2;
  const solid = front - fd - back;
  g.add(box(W, H, solid, CONCRETE, 0, H / 2, back + solid / 2));
  const left = dx - door.w / 2 + W / 2, right = W / 2 - dx - door.w / 2;
  g.add(box(left, H, fd, CONCRETE, -W / 2 + left / 2, H / 2, fz), box(right, H, fd, CONCRETE, W / 2 - right / 2, H / 2, fz));
  g.add(box(door.w, H - door.h, fd, CONCRETE, dx, (H + door.h) / 2, fz));
  // A flat roof with a low rim of NAPO yellow (the camera looks down on it: it marks NAPO's buildings
  // from afar), a vent and a flue.
  const roofW = W + 0.12, roofD = front - back + 0.12;
  g.add(box(roofW, 0.1, roofD, h.roof, 0, H + 0.05, 0));
  for (const z of [-roofD / 2 + 0.035, roofD / 2 - 0.035]) g.add(box(roofW, 0.08, 0.07, NAPO_YELLOW, 0, H + 0.14, z, false));
  for (const x of [-roofW / 2 + 0.035, roofW / 2 - 0.035]) g.add(box(0.07, 0.08, roofD, NAPO_YELLOW, x, H + 0.14, 0, false));
  g.add(box(0.3, 0.18, 0.3, '#5e6466', -W / 2 + 0.45, H + 0.19, back + 0.4));
  const flueX = W / 2 - 0.4, flueZ = back + 0.35;
  g.add(part(flat(new THREE.CylinderGeometry(0.06, 0.07, 0.5, 8)), STEEL, flueX, H + 0.35, flueZ, 0.015));
  // A pipe down the side, and on a big building a small dish on the roof, turned north like the Tower's.
  g.add(box(0.05, H, 0.05, STEEL, W / 2 + 0.03, H / 2, back + 0.3, false));
  if (h.w >= 5) {
    g.add(box(0.04, 0.3, 0.04, STEEL, -W / 2 + 1.2, H + 0.25, 0, false));
    const dish = part(flat(new THREE.CylinderGeometry(0.22, 0.07, 0.08, 10)), '#d9d6cc', -W / 2 + 1.2, H + 0.42, -0.04, 0.012);
    dish.rotation.x = -Math.PI / 2 + 0.5;
    g.add(dish);
  }
  // The doorway: its inside seen from without, warm where a fire burns and black otherwise; a steel
  // frame, the door swung wide, a plate of NAPO yellow over it.
  g.add(part(new THREE.BoxGeometry(door.w - 0.02, door.h - 0.02, fd), fire ? mats.doorGlow : toon('#0a0807', { side: THREE.BackSide }), dx, door.h / 2, fz + 0.005, false));
  for (const s of [-1, 1]) g.add(box(0.07, door.h + 0.05, 0.08, '#2c3335', dx + s * (door.w / 2 + 0.035), (door.h + 0.05) / 2, front + 0.01, 0.015));
  g.add(box(door.w + 0.2, 0.07, 0.09, '#2c3335', dx, door.h + 0.05, front + 0.01, 0.015));
  const hinge = pivot(dx - door.w / 2, 0, front + 0.02);
  hinge.rotation.y = -1.9;
  hinge.add(box(door.w - 0.04, door.h - 0.04, 0.05, '#3e4b48', (door.w - 0.04) / 2, (door.h - 0.04) / 2 + 0.01, 0, 0.018));
  hinge.add(box(0.05, 0.03, 0.04, '#a8adb0', door.w - 0.13, 0.44, 0.04, false));
  g.add(hinge);
  g.add(box(0.46, 0.13, 0.03, NAPO_YELLOW, dx, door.h + 0.17, front + 0.02, 0.01), box(0.36, 0.035, 0.01, INK, dx, door.h + 0.17, front + 0.04, false));
  if (h.lit) g.add(part(new THREE.BoxGeometry(0.14, 0.07, 0.08), mats.warm, dx, door.h + 0.32, front + 0.06, false));
  // Small high windows either side of the door, as many as the front has room for.
  const spots: number[] = [];
  for (let x = dx - door.w / 2 - 0.5; x >= -W / 2 + 0.35; x -= 0.95) spots.push(x);
  for (let x = dx + door.w / 2 + 0.5; x <= W / 2 - 0.35; x += 0.95) spots.push(x);
  spots.forEach((wx, k) => {
    g.add(box(0.5, 0.3, 0.04, '#2a2e30', wx, 0.86, front + 0.005, false));
    const lit = !!h.lit && k === 0;
    g.add(part(new THREE.BoxGeometry(0.4, 0.2, 0.05), lit ? mats.warm : toon('#1c1f24'), wx, 0.86, front + 0.02, false));
    if (!lit) for (const bx of [-0.12, 0, 0.12]) g.add(box(0.025, 0.22, 0.02, '#4a5052', wx + bx, 0.86, front + 0.05, false));
  });
  return { root: g, flue: new THREE.Vector3(cx + flueX, H + 0.62, cz + flueZ) };
}

/** One of NAPO's warning signs: a yellow plate edged in black on a steel post, with NAPO's eye on it. */
export function napoSign(s: Sign): THREE.Group {
  const g = pivot(s.x + 0.5, 0, s.y + 0.5);
  g.add(box(0.06, 0.66, 0.06, STEEL, 0, 0.33, -0.03));
  g.add(box(0.56, 0.4, 0.03, INK, 0, 0.64, 0));
  g.add(box(0.5, 0.34, 0.035, NAPO_YELLOW, 0, 0.64, 0.005, false));
  g.add(box(0.5, 0.06, 0.01, INK, 0, 0.77, 0.026, false));
  // NAPO's eye: a black diamond with a yellow middle.
  g.add(box(0.13, 0.13, 0.01, INK, 0, 0.6, 0.026, false).rotateZ(Math.PI / 4));
  g.add(box(0.05, 0.05, 0.01, NAPO_YELLOW, 0, 0.6, 0.033, false).rotateZ(Math.PI / 4));
  return g;
}

/** How many of a mast's six sections still stand when it is broken: the rest lies at its foot. */
const BROKEN_SECTIONS = 3;

/**
 * The Tower: a lattice mast in red and white bands on a concrete pad, a dish on the north side turned
 * toward the woods, a small deck, and the light on top in `beacon`. It stands on one tile, like a pole.
 * A `broken` mast (NAPO's field post in the Far Woods) stands only half as high, snapped where rust ate
 * through its legs: its top lies across the ground beside it, the dish fallen on its back, and no light.
 */
export function towerModel(x: number, y: number, beacon: THREE.Material, broken = false): THREE.Group {
  const g = pivot(x + 0.5, 0, y + 0.5);
  g.add(box(0.96, 0.12, 0.96, '#6b6f70', 0, 0.06, 0));
  if (broken) return brokenMast(g, x, y);
  const SECTIONS = 6, BASE = 0.34, TIP = 0.08, Y0 = 0.12, TOP = TOWER_H - 0.1;
  const half = (k: number) => BASE + ((TIP - BASE) * k) / SECTIONS;
  const at = (k: number) => Y0 + ((TOP - Y0) * k) / SECTIONS;
  const up = new THREE.Vector3(0, 1, 0);
  /** A thin bar from a to b. */
  const bar = (a: THREE.Vector3, b: THREE.Vector3, color: string, t: number) => {
    const d = b.clone().sub(a), m = box(t, d.length(), t, color, 0, 0, 0, false);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(up, d.normalize());
    g.add(m);
  };
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
  for (let k = 0; k < SECTIONS; k++) {
    const color = k % 2 ? '#dcd8cc' : '#b4432f', h0 = at(k), h1 = at(k + 1), w0 = half(k), w1 = half(k + 1);
    corners.forEach(([sx, sz], i) => {
      const [nx, nz] = corners[(i + 1) % 4]!;
      // A leg, the ring at the top of the section, and one brace across each face, zigzagging up.
      bar(new THREE.Vector3(sx * w0, h0, sz * w0), new THREE.Vector3(sx * w1, h1, sz * w1), color, 0.05);
      bar(new THREE.Vector3(sx * w1, h1, sz * w1), new THREE.Vector3(nx * w1, h1, nz * w1), color, 0.035);
      const [ax, az, bx, bz] = k % 2 ? [sx, sz, nx, nz] : [nx, nz, sx, sz];
      bar(new THREE.Vector3(ax * w0, h0, az * w0), new THREE.Vector3(bx * w1, h1, bz * w1), color, 0.025);
    });
  }
  g.add(box(0.44, 0.03, 0.44, STEEL, 0, 3.05, 0, false));
  const dish = part(flat(new THREE.CylinderGeometry(0.3, 0.1, 0.1, 12)), '#d9d6cc', 0, 2.7, -0.22, 0.015);
  dish.rotation.x = -Math.PI / 2 + 0.35;
  g.add(dish, box(0.03, 0.03, 0.26, STEEL, 0, 2.78, -0.36, false));
  g.add(part(new THREE.BoxGeometry(0.12, 0.1, 0.12), beacon, 0, TOWER_H, 0, 0.015), box(0.16, 0.03, 0.16, STEEL, 0, TOWER_H - 0.065, 0, false));
  return g;
}

/**
 * The lower half of a mast (towerModel's `broken`), its bands gone to rust, bent stubs where the legs
 * snapped, the section above hanging folded down its side, and the dish fallen on its back at its foot.
 * All of it within its own tile, like a standing mast.
 */
function brokenMast(g: THREE.Group, x: number, y: number): THREE.Group {
  const SECTIONS = 6, BASE = 0.34, TIP = 0.08, Y0 = 0.12, TOP = TOWER_H - 0.1;
  const half = (k: number) => BASE + ((TIP - BASE) * k) / SECTIONS;
  const at = (k: number) => Y0 + ((TOP - Y0) * k) / SECTIONS;
  const up = new THREE.Vector3(0, 1, 0);
  const bar = (root: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, color: string, t: number) => {
    const d = b.clone().sub(a), m = box(t, d.length(), t, color, 0, 0, 0, false);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(up, d.normalize());
    root.add(m);
  };
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
  /** Sections from..to of the lattice into `root`, in faded bands with rust through them. */
  const lattice = (root: THREE.Object3D, from: number, to: number, lift: number) => {
    for (let k = from; k < to; k++) {
      const color = k % 2 ? '#b9ad98' : '#8a4632', h0 = at(k) - lift, h1 = at(k + 1) - lift, w0 = half(k), w1 = half(k + 1);
      corners.forEach(([sx, sz], i) => {
        const [nx, nz] = corners[(i + 1) % 4]!;
        bar(root, new THREE.Vector3(sx * w0, h0, sz * w0), new THREE.Vector3(sx * w1, h1, sz * w1), color, 0.05);
        bar(root, new THREE.Vector3(sx * w1, h1, sz * w1), new THREE.Vector3(nx * w1, h1, nz * w1), color, 0.035);
        const [ax, az, bx, bz] = k % 2 ? [sx, sz, nx, nz] : [nx, nz, sx, sz];
        bar(root, new THREE.Vector3(ax * w0, h0, az * w0), new THREE.Vector3(bx * w1, h1, bz * w1), color, 0.025);
      });
    }
  };
  lattice(g, 0, BROKEN_SECTIONS, 0);
  // Where it snapped: each leg a bent stub, leaning out.
  const snap = at(BROKEN_SECTIONS), w = half(BROKEN_SECTIONS);
  corners.forEach(([sx, sz], i) => bar(g, new THREE.Vector3(sx * w, snap, sz * w), new THREE.Vector3(sx * (w + 0.1 + i * 0.03), snap + 0.18, sz * (w + 0.06)), '#6b3a26', 0.05));
  // The next section still hangs by a leg, folded over and down the east side; the rest of it is gone.
  const fallen = pivot(w, snap, 0);
  fallen.rotation.set((hash2(x, y) - 0.5) * 0.4, 0, -2.0);
  lattice(fallen, BROKEN_SECTIONS, BROKEN_SECTIONS + 1, snap);
  g.add(fallen);
  // The dish, down on its back at the foot of the pad.
  const dish = part(flat(new THREE.CylinderGeometry(0.3, 0.1, 0.1, 12)), '#bdb8ac', -0.35, 0.08, 0.5, 0.015);
  dish.rotation.x = 0.25;
  g.add(dish);
  return g;
}

/** NAPO's off-white, on its trucks and jeeps; dirt has had years at it. */
export const NAPO_WHITE = '#d3cfc4';
const TIRE = '#18181b';
const CHAR = '#1f1c1a';

/** NAPO's eye, a black diamond with a yellow middle, facing +z at x, y, z of `g`. */
function eye(g: THREE.Object3D, x: number, y: number, z: number, size: number) {
  g.add(box(size, size, 0.01, INK, x, y, z, false).rotateZ(Math.PI / 4));
  g.add(box(size * 0.38, size * 0.38, 0.01, NAPO_YELLOW, x, y, z + 0.006, false).rotateZ(Math.PI / 4));
}

/**
 * One of NAPO's box trucks, three tiles long: a cab in NAPO's off-white with a yellow band, a tall box
 * behind it with the eye on its back and sides, dark glass, and the dirt of the years it stood.
 */
export function napoTruck(t: Extract<MapObject, { kind: 'truck' }>): THREE.Group {
  const at = vehiclePlace(t), len = Math.max(t.w, t.h) - 0.2, front = len / 2;
  const g = pivot(at.x, 0, at.z);
  g.rotation.y = at.turn;
  g.add(box(0.72, 0.14, len - 0.1, '#2a2d2e', 0, 0.3, 0));
  g.add(box(0.92, 0.7, 0.72, NAPO_WHITE, 0, 0.66, front - 0.38));
  g.add(box(0.86, 0.26, 0.02, '#1a252c', 0, 0.86, front - 0.01, false), box(0.94, 0.2, 0.44, '#1a252c', 0, 0.86, front - 0.42, false));
  g.add(box(0.7, 0.14, 0.02, '#2a2d2e', 0, 0.44, front + 0.005, false));
  g.add(box(0.94, 0.07, 0.74, NAPO_YELLOW, 0, 0.52, front - 0.38, false));
  const boxLen = len - 0.8, bz = front - 0.78 - boxLen / 2;
  g.add(box(0.98, 1.08, boxLen, '#cbc6ba', 0, 0.9, bz));
  g.add(box(1.0, 0.1, boxLen + 0.02, NAPO_YELLOW, 0, 0.5, bz, false));
  for (const s of [-1, 1]) {
    const side = pivot(s * 0.5, 0.95, bz);
    side.rotation.y = s * Math.PI / 2;
    eye(side, 0, 0.1, 0.006, 0.2);
    g.add(side);
    // Streaks where rain ran off the roof.
    g.add(box(0.012, 0.5, 0.05, '#a39e92', s * 0.495, 1.1, bz - boxLen * 0.3, false), box(0.012, 0.35, 0.05, '#a39e92', s * 0.495, 1.18, bz + boxLen * 0.25, false));
  }
  eye(g, 0, 1.0, bz - boxLen / 2 - 0.006, 0.2);
  g.add(box(0.99, 0.02, boxLen + 0.01, '#b0ab9f', 0, 1.445, bz, false));
  for (const [x, z] of [[-0.45, front - 0.4], [0.45, front - 0.4], [-0.45, bz - boxLen / 2 + 0.35], [0.45, bz - boxLen / 2 + 0.35], [-0.45, bz - boxLen / 2 + 0.8], [0.45, bz - boxLen / 2 + 0.8]] as const) {
    const w = part(flat(new THREE.CylinderGeometry(0.19, 0.19, 0.14, 10)), TIRE, x, 0.19, z, 0.02);
    w.rotation.z = Math.PI / 2;
    g.add(w);
  }
  return g;
}

/**
 * One of NAPO's field jeeps, burned out: the paint gone to char and rust, the canvas and the seats down
 * to their frames, the tires to the rims, a patch of NAPO yellow on the door with its stencil, and the
 * driver's door hanging open.
 */
export function jeepModel(j: Extract<MapObject, { kind: 'jeep' }>): THREE.Group {
  const at = vehiclePlace(j);
  const g = pivot(at.x, 0, at.z);
  g.rotation.y = at.turn;
  const rust = '#6b3a22', ash = '#4a4643';
  g.add(box(0.9, 0.38, 1.7, CHAR, 0, 0.36, 0));
  g.add(box(0.82, 0.12, 0.56, rust, 0, 0.6, 0.55));
  g.add(box(0.92, 0.1, 1.72, rust, 0, 0.2, 0, false));
  // Open behind the windshield: the frame of it, a roll bar, the springs of the seats.
  g.add(box(0.84, 0.04, 0.04, CHAR, 0, 0.95, 0.24, false), ...[-0.4, 0.4].map(x => box(0.04, 0.4, 0.04, CHAR, x, 0.76, 0.24, false)));
  for (const x of [-0.4, 0.4]) g.add(box(0.04, 0.5, 0.04, '#2c2926', x, 0.8, -0.45, false));
  g.add(box(0.84, 0.04, 0.04, '#2c2926', 0, 1.03, -0.45, false));
  for (const [x, z] of [[-0.2, -0.05], [0.2, -0.05], [0, -0.55]] as const) {
    g.add(box(0.3, 0.04, 0.34, ash, x, 0.58, z, false));
    for (const k of [-0.1, 0, 0.1]) g.add(box(0.26, 0.015, 0.015, '#8a8580', x, 0.6, z + k, false));
  }
  // What is left of NAPO on the door, and the door itself, hanging open on the driver's side.
  g.add(box(0.012, 0.18, 0.3, NAPO_YELLOW, -0.456, 0.4, -0.2, false), box(0.013, 0.05, 0.22, INK, -0.458, 0.41, -0.2, false));
  const hinge = pivot(0.46, 0, 0.3);
  hinge.rotation.y = -0.6;
  hinge.add(box(0.04, 0.34, 0.5, CHAR, 0.02, 0.4, -0.25, 0.015), box(0.012, 0.16, 0.28, NAPO_YELLOW, 0.045, 0.42, -0.25, false));
  g.add(hinge);
  for (const [x, z] of [[-0.46, 0.55], [0.46, 0.55], [-0.46, -0.58], [0.46, -0.58]] as const) {
    const rim = part(flat(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 8)), '#3e3a36', x, 0.12, z, 0.015);
    rim.rotation.z = Math.PI / 2;
    g.add(rim);
  }
  return g;
}

/** NAPO's fuel pump on its concrete island: a yellow body, a dark dial, the hose hung on its side. */
export function pumpModel(p: { x: number; y: number }): THREE.Group {
  const g = pivot(p.x + 0.5, 0, p.y + 0.5);
  g.add(box(0.8, 0.1, 0.5, '#7c8081', 0, 0.05, 0));
  g.add(box(0.36, 0.86, 0.26, NAPO_YELLOW, 0, 0.53, 0));
  g.add(box(0.38, 0.06, 0.28, STEEL, 0, 0.98, 0), box(0.24, 0.18, 0.012, '#1c1f24', 0, 0.78, 0.136, false));
  g.add(box(0.18, 0.05, 0.012, '#e6dfcc', 0, 0.62, 0.136, false));
  eye(g, 0, 0.42, 0.137, 0.1);
  for (const [y, z, h] of [[0.7, 0.2, 0.3], [0.5, 0.26, 0.24]] as const) g.add(box(0.035, h, 0.035, INK, 0.2, y, z - 0.1, false));
  g.add(box(0.05, 0.12, 0.05, '#3a3f41', 0.2, 0.86, 0.12, false));
  return g;
}

/** The glow of a rock that hums: faint, the same day and night. One material for all the cages of a map. */
export const HUM = toon('#5d5866', { emissive: 0x2a1745 });

/**
 * One of NAPO's sample cages: a steel frame and mesh on a concrete pad, a rock from deep in the woods
 * inside it (`rock`, the humming material), and the yellow tag wired to its front.
 */
export function cageModel(c: { x: number; y: number }, rock: THREE.Material): THREE.Group {
  const g = pivot(c.x + 0.5, 0, c.y + 0.5);
  const s = 0.36, h = 0.72;
  g.add(box(0.88, 0.08, 0.88, '#7c8081', 0, 0.04, 0));
  const r = part(new THREE.DodecahedronGeometry(0.2, 0), rock, 0, 0.26, 0, 0.015);
  r.rotation.set(hash2(c.x, c.y) * 3, hash2(c.y, c.x) * 3, 0);
  r.scale.set(1.1, 0.8, 1);
  g.add(r);
  for (const [x, z] of [[-s, -s], [s, -s], [-s, s], [s, s]] as const) g.add(box(0.05, h, 0.05, STEEL, x, 0.08 + h / 2, z, false));
  for (const y of [0.1, 0.08 + h]) for (const [x, z, w, d] of [[0, -s, 2 * s, 0.04], [0, s, 2 * s, 0.04], [-s, 0, 0.04, 2 * s], [s, 0, 0.04, 2 * s]] as const) {
    g.add(box(w, 0.04, d, STEEL, x, y, z, false));
  }
  // The mesh: thin wires each way on every side, and on the lid.
  for (let k = 1; k < 5; k++) {
    const t = -s + (2 * s * k) / 5;
    for (const z of [-s, s]) g.add(box(0.012, h, 0.012, '#8e979b', t, 0.08 + h / 2, z, false));
    for (const x of [-s, s]) g.add(box(0.012, h, 0.012, '#8e979b', x, 0.08 + h / 2, t, false));
    g.add(box(2 * s, 0.012, 0.012, '#8e979b', 0, 0.08 + h, t, false));
  }
  for (const y of [0.35, 0.6]) for (const [x, z, w, d] of [[0, -s, 2 * s, 0.012], [0, s, 2 * s, 0.012], [-s, 0, 0.012, 2 * s], [s, 0, 0.012, 2 * s]] as const) {
    g.add(box(w, 0.012, d, '#8e979b', x, y, z, false));
  }
  g.add(box(0.18, 0.12, 0.012, NAPO_YELLOW, 0.1, 0.55, s + 0.02, 0.008), box(0.12, 0.02, 0.005, INK, 0.1, 0.57, s + 0.03, false));
  return g;
}

/** One of NAPO's survey stakes: a wooden stake with its head painted NAPO yellow and orange flagging tied under it. */
export function stakeModel(s: { x: number; y: number }): THREE.Group {
  const v = hash2(s.x * 11, s.y * 7), g = pivot(s.x + 0.3 + v * 0.4, 0, s.y + 0.35 + hash2(s.y, s.x) * 0.3);
  g.rotation.y = v * 3;
  g.add(box(0.045, 0.56, 0.045, '#8a6a44', 0, 0.28, 0));
  g.add(box(0.05, 0.08, 0.05, NAPO_YELLOW, 0, 0.53, 0, false));
  for (const [dx, tilt, len] of [[0.05, -0.5, 0.2], [0.04, -0.9, 0.16]] as const) {
    const f = box(len, 0.025, 0.06, '#ff7a1a', dx + len / 2 - 0.02, 0.46, 0, false);
    f.rotation.z = tilt;
    g.add(f);
  }
  return g;
}

/**
 * One of NAPO's teleports (one in every cabin, its twin in town): a round concrete pad rimmed in NAPO yellow,
 * a steel gate over it with NAPO's plate and eye on the crossbar, and in the gate a rock from deep in the woods
 * that hums like the ones in its sample cages (`rock`, the humming material), held on a rod. Its control box,
 * on the right post, faces the tile in front, where you stand to use it and where it sets you down.
 */
export function teleportModel(t: { x: number; y: number }, rock: THREE.Material): THREE.Group {
  const g = pivot(t.x + 0.5, 0, t.y + 0.5);
  g.add(part(flat(new THREE.CylinderGeometry(0.44, 0.46, 0.08, 14)), CONCRETE, 0, 0.04, 0, 0.015));
  g.add(part(flat(new THREE.CylinderGeometry(0.42, 0.42, 0.02, 14)), NAPO_YELLOW, 0, 0.09, 0, false));
  g.add(part(flat(new THREE.CylinderGeometry(0.34, 0.34, 0.025, 14)), '#5e6466', 0, 0.095, 0, false));
  const H = 1.05, s = 0.36;
  for (const x of [-s, s]) g.add(box(0.07, H, 0.07, STEEL, x, H / 2, -0.04));
  g.add(box(2 * s + 0.12, 0.09, 0.1, STEEL, 0, H + 0.02, -0.04));
  g.add(box(0.34, 0.12, 0.02, NAPO_YELLOW, 0, H + 0.02, 0.02, 0.008));
  eye(g, 0, H + 0.02, 0.031, 0.07);
  g.add(box(0.025, H - 0.55, 0.025, STEEL, 0, (H + 0.55) / 2, -0.04, false));
  const r = part(new THREE.DodecahedronGeometry(0.15, 0), rock, 0, 0.5, -0.02, 0.015);
  r.rotation.set(hash2(t.x, t.y) * 3, hash2(t.y, t.x) * 3, 0);
  r.scale.set(1, 1.2, 0.9);
  g.add(r);
  g.add(box(0.14, 0.2, 0.08, '#2c3335', s, 0.62, 0.04, 0.012));
  g.add(box(0.05, 0.05, 0.01, NAPO_YELLOW, s, 0.66, 0.085, false), box(0.08, 0.03, 0.01, '#e6dfcc', s, 0.57, 0.085, false));
  return g;
}

/**
 * One of NAPO's gates, across its w tiles: a concrete post at each end, a heavy steel gate between them in
 * a frame braced corner to corner, its top rail striped NAPO yellow and black, a pull handle on its south
 * face over each tile (one for each who must pull), and its yellow plate in the middle.
 */
export function gateModel(o: { x: number; y: number; w: number }): THREE.Group {
  const g = pivot(o.x + o.w / 2, 0, o.y + 0.5), W = o.w, H = 1.15;
  for (const x of [-W / 2 + 0.08, W / 2 - 0.08]) g.add(box(0.2, H + 0.2, 0.26, CONCRETE, x, (H + 0.2) / 2, 0), box(0.24, 0.06, 0.3, '#5e6466', x, H + 0.23, 0, false));
  const span = W - 0.36;
  for (const y of [0.12, H / 2, H - 0.06]) g.add(box(span, 0.07, 0.07, STEEL, 0, y, 0));
  for (let k = 0; k <= W * 3; k++) g.add(box(0.03, H - 0.12, 0.03, '#8e979b', -span / 2 + (span * k) / (W * 3), H / 2, 0, false));
  const brace = box(Math.hypot(span, H - 0.18), 0.05, 0.05, STEEL, 0, H / 2, 0.02, false);
  brace.rotation.z = Math.atan2(H - 0.18, span);
  g.add(brace);
  for (let k = 0; k < W * 4; k++) g.add(box(span / (W * 4), 0.09, 0.09, k % 2 ? INK : NAPO_YELLOW, -span / 2 + (span * (k + 0.5)) / (W * 4), H - 0.02, 0.01, false));
  for (let t = 0; t < W; t++) g.add(box(0.05, 0.3, 0.05, INK, -W / 2 + t + 0.5, 0.62, 0.1, false), box(0.05, 0.05, 0.1, INK, -W / 2 + t + 0.5, 0.78, 0.06, false), box(0.05, 0.05, 0.1, INK, -W / 2 + t + 0.5, 0.46, 0.06, false));
  g.add(box(0.36, 0.2, 0.02, NAPO_YELLOW, 0, 0.86, 0.06, 0.01), box(0.26, 0.03, 0.01, INK, 0, 0.9, 0.075, false), box(0.2, 0.03, 0.01, INK, 0, 0.83, 0.075, false));
  return g;
}

/** NAPO's things that stand on a tile (its signs and buildings aside): null for anything else. */
export function napoProp(o: MapObject): THREE.Object3D | null {
  switch (o.kind) {
    case 'jeep': return jeepModel(o);
    case 'pump': return pumpModel(o);
    case 'cage': return cageModel(o, HUM);
    case 'teleport': return teleportModel(o, HUM);
    case 'stake': return stakeModel(o);
    case 'gate': return gateModel(o);
    case 'truck': return o.style === 'napo' ? napoTruck(o) : null;
    default: return null;
  }
}
