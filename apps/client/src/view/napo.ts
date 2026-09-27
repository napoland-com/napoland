/**
 * What NAPO left behind, as the South Road shows it: its concrete buildings (any size, a flat roof
 * with a rim of NAPO yellow), its yellow warning signs, and the Tower, a red and white mast with
 * a dish turned toward the woods and a light blinking on top. Plain builders of toon boxes for
 * world.ts, which bakes them with the other props; only the Tower's light keeps a material of its
 * own, which world.ts blinks.
 */
import * as THREE from 'three';
import type { MapObject } from '@napoland/shared';
import { box, flat, part, pivot, toon } from './toon';

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

/**
 * The Tower: a lattice mast in red and white bands on a concrete pad, a dish on the north side turned
 * toward the woods, a small deck, and the light on top in `beacon`. It stands on one tile, like a pole.
 */
export function towerModel(x: number, y: number, beacon: THREE.Material): THREE.Group {
  const g = pivot(x + 0.5, 0, y + 0.5);
  g.add(box(0.96, 0.12, 0.96, '#6b6f70', 0, 0.06, 0));
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
