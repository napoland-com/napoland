/**
 * What the town and the people who left it left behind (roadmap/richer-places.md): the cars of the jam
 * and the town's old logging truck, the sawmill, the log decks, stumps and skids of the logging days,
 * and what the leavers could not fit in the cars (suitcases, boxes, a rocking chair, a piano under its
 * tarp, a child's bike, a birdcage), with the mailboxes that still carry their names, the cardboard sign
 * someone wrote and the curtains they drew. Plain builders of toon boxes for world.ts, which bakes them
 * with the other props: nothing here moves or glows (the cars' lamps excepted), so it all joins the few
 * meshes a map's props already are. NAPO's own things are in napo.ts.
 *
 * Where a thing stands and how it turns are plain functions of its data (tested without a page), and
 * every variation comes from its tile, so a place looks the same on every visit.
 */
import * as THREE from 'three';
import type { Dir, MapObject } from '@napoland/shared';
import { box, flat, hash2, part, pivot, toon } from './toon';

type House = Extract<MapObject, { kind: 'house' }>;
type Car = Extract<MapObject, { kind: 'car' }>;
type Truck = Extract<MapObject, { kind: 'truck' }>;
type Logs = Extract<MapObject, { kind: 'logs' }>;
type Sign = Extract<MapObject, { kind: 'sign' }>;

/** The town's cars were mostly this teal once; a car without paint of its own still is. */
export const CAR_TEAL = '#5f7470';
const RUST = '#6b4a2e';
const TIRE = '#18181b';
const GLASS = '#1a252c';
const DARK = '#101418';
const BARK = ['#5b4130', '#4e3726', '#664a33'];
/** Split wood's face (the end grain), and the heart of it. */
const GRAIN = '#c99d64';
const HEART = '#8f6238';
const CARDBOARD = ['#a07a4a', '#b08a58', '#94704a'];
/** The curtains the people who left drew behind them: faded, a different cloth in each house. */
export const CURTAINS = ['#8c6a4a', '#6e3a3a', '#4a5f6e', '#6b6a3a', '#7d6a5a', '#5a4a6a'];

/** The curtains of a house, the same outside and in its room: they come from where the house stands. */
export function curtainColor(house: Pick<House, 'x' | 'y'>): string {
  return CURTAINS[Math.floor(hash2(house.x * 7 + 3, house.y * 13 + 5) * CURTAINS.length) % CURTAINS.length]!;
}

/** How a vehicle's model is turned for where its nose points: models are built nose toward +z (south). */
const TURN: Record<Dir, number> = { down: 0, up: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 };

/**
 * Where a vehicle stands: the middle of its tiles, turned so its nose points `dir` (a car without one
 * faces east, as the town's cars always have).
 */
export function vehiclePlace(v: { x: number; y: number; w: number; h?: number; dir?: Dir }): { x: number; z: number; turn: number } {
  const h = v.h ?? 1;
  return { x: v.x + v.w / 2, z: v.y + h / 2, turn: TURN[v.dir ?? 'right'] };
}

/**
 * Which car keeps the one headlight a map has (world.ts moves a single spotlight onto it, so the
 * number of lights never changes): the one farthest from where you arrive, which is the old car at the
 * end of the Near Woods' road and the truck behind the South Road's barrier. -1 when there is none.
 */
export function headlightCar(cars: ReadonlyArray<{ x: number; y: number }>, spawn: { x: number; y: number }): number {
  let best = -1, far = -1;
  cars.forEach((c, i) => {
    const d = Math.hypot(c.x - spawn.x, c.y - spawn.y);
    if (d >= far) { far = d; best = i; }
  });
  return best;
}

/**
 * A car left where it stopped, luggage still tied on the roof: in its paint, with the driver's door
 * open or the hatch up when the map says so. `lights` are the head and tail lamps' materials (they
 * light up at night); the car at the end of a road carries the real headlight (world.ts).
 */
export function carModel(c: Car, lights: { head: THREE.Material; tail: THREE.Material }): THREE.Group {
  const at = vehiclePlace(c), paint = c.paint ?? CAR_TEAL;
  const car = pivot(at.x, 0, at.z);
  car.rotation.y = at.turn;
  car.add(box(0.9, 0.36, 1.9, paint, 0, 0.34, 0), box(0.92, 0.12, 1.5, RUST, 0, 0.34, -0.05, false));
  car.add(box(0.84, 0.34, 1.15, paint, 0, 0.68, -0.22));
  car.add(box(0.86, 0.22, 0.95, GLASS, 0, 0.7, -0.22, false), box(0.76, 0.2, 0.02, '#23313a', 0, 0.7, 0.36, false));
  car.add(box(0.7, 0.04, 0.9, '#2b2b2e', 0, 0.88, -0.22), box(0.5, 0.14, 0.6, '#3d3a34', 0, 0.97, -0.25));
  for (const [x, z] of [[-0.44, 0.6], [0.44, 0.6], [-0.44, -0.62], [0.44, -0.62]] as const) {
    const w = part(flat(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 10)), TIRE, x, 0.17, z, 0.02);
    w.rotation.z = Math.PI / 2;
    car.add(w);
  }
  for (const x of [-0.28, 0.28]) car.add(part(new THREE.BoxGeometry(0.14, 0.08, 0.03), lights.head, x, 0.4, 0.955, false), part(new THREE.BoxGeometry(0.12, 0.08, 0.03), lights.tail, x, 0.42, -0.955, false));
  if (c.door) {
    // The driver's side (left of the nose, +x here): dark where the door was, the door swung wide.
    car.add(box(0.012, 0.36, 0.5, DARK, 0.452, 0.55, 0.07, false));
    const hinge = pivot(0.46, 0, 0.33);
    hinge.rotation.y = -0.7;
    hinge.add(box(0.05, 0.4, 0.53, paint, 0.025, 0.41, -0.265, 0.015), box(0.02, 0.2, 0.42, GLASS, 0.05, 0.72, -0.25, false));
    car.add(hinge);
  }
  if (c.trunk) {
    // The hatch up, and the dark of the back behind it.
    car.add(box(0.74, 0.28, 0.012, DARK, 0, 0.66, -0.802, false));
    const hinge = pivot(0, 0.86, -0.79);
    hinge.rotation.x = 0.55;
    hinge.add(box(0.8, 0.03, 0.46, paint, 0, 0, -0.23, 0.015), box(0.66, 0.012, 0.3, GLASS, 0, -0.02, -0.22, false));
    car.add(hinge);
  }
  return car;
}

/** A log lying along z, `len` long: bark round it and split wood at both ends. */
function logAlongZ(g: THREE.Object3D, r: number, len: number, bark: string, x: number, y: number, z: number) {
  g.add(part(flat(new THREE.CylinderGeometry(r, r, len, 7).rotateX(Math.PI / 2)), bark, x, y, z, 0.014));
  for (const s of [-1, 1]) {
    g.add(part(new THREE.CylinderGeometry(r * 0.84, r * 0.84, 0.012, 7).rotateX(Math.PI / 2), GRAIN, x, y, z + s * (len / 2 + 0.004), false));
    g.add(part(new THREE.CylinderGeometry(r * 0.3, r * 0.3, 0.014, 6).rotateX(Math.PI / 2), HEART, x, y, z + s * (len / 2 + 0.007), false));
  }
}

/**
 * The town's old logging truck: a rusted cab and hood, and on its bunks the last three logs it brought
 * down, still chained. Three tiles long.
 */
export function logTruck(t: Truck): THREE.Group {
  const at = vehiclePlace(t), len = Math.max(t.w, t.h) - 0.2;
  const g = pivot(at.x, 0, at.z);
  g.rotation.y = at.turn;
  const paint = '#8a4a2a', worn = '#6e3a22', front = len / 2;
  g.add(box(0.7, 0.14, len - 0.1, '#2a2724', 0, 0.3, -0.05));
  g.add(box(0.8, 0.42, 0.46, paint, 0, 0.55, front - 0.25), box(0.62, 0.28, 0.02, '#2a2622', 0, 0.55, front - 0.01, false));
  g.add(box(0.95, 0.72, 0.52, paint, 0, 0.72, front - 0.75), box(0.97, 0.22, 0.3, GLASS, 0, 0.9, front - 0.72, false), box(0.82, 0.22, 0.02, GLASS, 0, 0.9, front - 0.48, false));
  // Rust has the better of the paint now.
  g.add(box(0.012, 0.18, 0.22, worn, 0.405, 0.5, front - 0.22, false), box(0.012, 0.24, 0.2, worn, -0.48, 0.62, front - 0.8, false));
  g.add(box(0.3, 0.012, 0.22, worn, 0.2, 1.085, front - 0.8, false));
  for (const z of [front - 1.2, -0.3, -front + 0.25]) {
    for (const x of [-0.42, 0.42]) g.add(box(0.06, 0.78, 0.06, '#2a2724', x, 0.72, z, false));
    g.add(box(0.9, 0.08, 0.1, '#2a2724', 0, 0.38, z, false));
  }
  const logLen = len - 1.0, logZ = -0.5 + 0.05;
  for (const [x, y, k] of [[-0.21, 0.6, 0], [0.21, 0.6, 1], [0, 0.95, 2]] as const) logAlongZ(g, 0.2, logLen, BARK[k]!, x, y, logZ);
  for (const z of [logZ - 0.45, logZ + 0.45]) g.add(box(0.72, 0.03, 0.03, '#3a3a3c', 0, 1.16, z, false));
  for (const [x, z] of [[-0.44, front - 0.3], [0.44, front - 0.3], [-0.44, -0.55], [0.44, -0.55], [-0.44, -1.0], [0.44, -1.0]] as const) {
    const w = part(flat(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 10)), TIRE, x, 0.2, z, 0.02);
    w.rotation.z = Math.PI / 2;
    g.add(w);
  }
  return g;
}

/** One log of a deck: where its middle lies (world units), how thick it is, and which way it runs. */
export interface DeckLog { x: number; y: number; z: number; r: number; len: number; along: 'x' | 'z' }

/**
 * The logs of a deck, stacked in rows that narrow as they go up. They lie east to west on a deck one
 * tile deep, and north to south otherwise, their cut ends toward the camera; they stay inside its tiles.
 */
export function deckLogs(o: Pick<Logs, 'x' | 'y' | 'w' | 'h'>): DeckLog[] {
  const along = o.h === 1 && o.w > 1 ? 'x' : 'z', span = along === 'x' ? o.h : o.w, len = (along === 'x' ? o.w : o.h) - 0.15;
  const r = 0.19, cx = o.x + o.w / 2, cz = o.y + o.h / 2, first = Math.max(2, Math.floor(span / (2 * r) - 0.2));
  const out: DeckLog[] = [];
  for (let row = 0; row < 4; row++) {
    const n = first - row;
    if (n < 1) break;
    for (let i = 0; i < n; i++) {
      const across = (i - (n - 1) / 2) * 2 * r * 1.02 + (hash2(o.x * 5 + i, o.y * 3 + row) - 0.5) * 0.03;
      const y = r + row * r * 1.72;
      out.push(along === 'x' ? { x: cx, y, z: cz + across, r, len, along } : { x: cx + across, y, z: cz, r, len, along });
    }
  }
  return out;
}

/** A deck of felled logs (deckLogs), with a pair of posts at each side that keep it from rolling. */
export function logDeck(o: Logs): THREE.Group {
  const g = pivot(0, 0, 0);
  const logs = deckLogs(o);
  logs.forEach((l, i) => {
    const bark = BARK[Math.floor(hash2(o.x + i * 3, o.y * 7 + i) * BARK.length) % BARK.length]!;
    const lg = pivot(l.x, l.y, l.z);
    if (l.along === 'x') lg.rotation.y = Math.PI / 2;
    logAlongZ(lg, l.r, l.len, bark, 0, 0, 0);
    g.add(lg);
  });
  const along = logs[0]!.along, ends = along === 'x' ? [o.y + 0.08, o.y + o.h - 0.08] : [o.x + 0.08, o.x + o.w - 0.08];
  for (const e of ends) for (const k of [0.25, 0.75]) {
    const [px, pz] = along === 'x' ? [o.x + o.w * k, e] : [e, o.y + o.h * k];
    g.add(box(0.08, 0.62, 0.08, '#3f2a1d', px, 0.31, pz, false));
  }
  return g;
}

/** A stump: a short trunk cut level (its rings to the sky) and its roots; charred black where a fire took the tree. */
export function stumpModel(o: Extract<MapObject, { kind: 'stump' }>): THREE.Group {
  const g = pivot(o.x + 0.5, 0, o.y + 0.5);
  g.rotation.y = o.v * 6;
  const r = 0.2 * o.s, h = (o.burned ? 0.46 : 0.26) * o.s;
  const bark = o.burned ? '#211d1a' : BARK[Math.floor(o.v * BARK.length) % BARK.length]!;
  g.add(part(flat(new THREE.CylinderGeometry(r * 0.92, r * 1.08, h, 7)), bark, 0, h / 2, 0, 0.016));
  g.add(part(new THREE.CylinderGeometry(r * 0.8, r * 0.8, 0.012, 7), o.burned ? '#2d2724' : GRAIN, 0, h + 0.004, 0, false));
  g.add(part(new THREE.CylinderGeometry(r * 0.28, r * 0.28, 0.014, 6), o.burned ? '#151311' : HEART, 0, h + 0.008, 0, false));
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + o.v, root = box(0.1 * o.s, 0.07, 0.2 * o.s, bark, Math.cos(a) * r * 1.05, 0.035, Math.sin(a) * r * 1.05, false);
    root.rotation.y = -a + Math.PI / 2;
    g.add(root);
  }
  if (o.burned) g.add(box(r * 0.6, h * 0.5, r * 0.5, '#161412', r * 0.3, h + h * 0.2, 0, 0.012));
  return g;
}

/** A skid: a log laid across the old skid road and half sunk in its mud. */
export function skidModel(o: Extract<MapObject, { kind: 'skid' }>): THREE.Mesh {
  const geo = flat(new THREE.CylinderGeometry(0.11, 0.12, 0.94, 6).rotateZ(Math.PI / 2));
  if (o.dir === 'h') geo.rotateY(Math.PI / 2);
  // Grey with the years in the mud, lighter than a fresh log.
  return part(geo, ['#6e6152', '#62574a', '#75685a'][Math.floor(hash2(o.x, o.y) * 3) % 3]!, o.x + 0.5, 0.05, o.y + 0.5, 0.01);
}

/** Suitcases as they were left on the verge: a stack of two, a steamer trunk with a hatbox, or a case and a duffel bag. */
export function luggageModel(o: { x: number; y: number }): THREE.Group {
  const v = hash2(o.x * 3 + 1, o.y * 5 + 2), g = pivot(o.x + 0.5, 0, o.y + 0.5);
  g.rotation.y = (v - 0.5) * 0.8;
  const handle = (w: number, x: number, y: number, z: number) => g.add(box(w, 0.04, 0.03, '#2a2420', x, y, z, false));
  if (v < 0.34) {
    g.add(box(0.64, 0.2, 0.42, '#6b4a2e', 0, 0.1, 0), box(0.66, 0.03, 0.44, '#4a3223', 0, 0.12, 0, false));
    const top = pivot(0.04, 0.2, -0.02);
    top.rotation.y = 0.3;
    top.add(box(0.46, 0.17, 0.32, '#35505c', 0, 0.085, 0));
    g.add(top);
    handle(0.14, 0, 0.13, 0.23);
  } else if (v < 0.67) {
    g.add(box(0.7, 0.4, 0.42, '#3f4a3a', 0, 0.2, 0));
    for (const x of [-0.33, 0.33]) g.add(box(0.05, 0.42, 0.44, '#b8943e', x, 0.21, 0, false));
    for (const x of [-0.15, 0.15]) g.add(box(0.06, 0.41, 0.43, '#5a3a24', x, 0.205, 0, false));
    g.add(part(flat(new THREE.CylinderGeometry(0.15, 0.15, 0.16, 10)), '#b86a5a', -0.1, 0.48, 0.02, 0.014));
  } else {
    g.add(box(0.44, 0.54, 0.17, '#7b2f2a', -0.12, 0.27, -0.08));
    handle(0.13, -0.12, 0.56, -0.08);
    const bag = part(flat(new THREE.CylinderGeometry(0.13, 0.13, 0.5, 8).rotateZ(Math.PI / 2)), '#4e5a34', 0.1, 0.13, 0.16, 0.014);
    bag.rotation.y = 0.4;
    g.add(bag);
  }
  return g;
}

/** Cardboard boxes: one taped shut, one on it turned a little, and now and then one left open with a blanket spilling out. */
export function boxesModel(o: { x: number; y: number }): THREE.Group {
  const v = hash2(o.x * 5 + 7, o.y * 3 + 11), g = pivot(o.x + 0.5, 0, o.y + 0.5);
  g.rotation.y = (v - 0.5) * 0.6;
  const carton = (w: number, h: number, d: number, x: number, y: number, z: number, turn: number, k: number, open = false) => {
    const b = pivot(x, y, z);
    b.rotation.y = turn;
    b.add(box(w, h, d, CARDBOARD[k % CARDBOARD.length]!, 0, h / 2, 0));
    if (!open) b.add(box(w + 0.005, 0.005, 0.07, '#cbb98a', 0, h + 0.003, 0, false));
    else {
      // Flaps folded out, and what was going in half in.
      for (const [fx, fz, rx, rz] of [[0, d / 2, 0.9, 0], [0, -d / 2, -0.9, 0], [w / 2, 0, 0, -0.9], [-w / 2, 0, 0, 0.9]] as const) {
        const f = box(fx ? 0.012 : w, 0.14, fz ? 0.012 : d, CARDBOARD[(k + 1) % CARDBOARD.length]!, fx, h, fz, false);
        f.rotation.set(rx, 0, rz);
        f.position.y = h + 0.05;
        b.add(f);
      }
      b.add(box(w * 0.8, 0.1, d * 0.7, '#7a3b35', 0, h - 0.02, 0, false));
    }
    g.add(b);
  };
  carton(0.5, 0.36, 0.44, -0.04, 0, 0.03, 0, 0);
  if (v < 0.6) carton(0.38, 0.28, 0.34, 0, 0.36, 0.04, 0.35, 1, v < 0.3);
  else carton(0.3, 0.26, 0.28, 0.24, 0, -0.2, -0.25, 2, true);
  return g;
}

/** A rocking chair, turned a little toward the road. */
export function rockerModel(o: { x: number; y: number }): THREE.Group {
  const g = pivot(o.x + 0.5, 0, o.y + 0.55);
  g.rotation.y = (hash2(o.x, o.y * 3) - 0.5) * 0.9;
  const wood = '#6b4a31', dark = '#4a3223';
  for (const x of [-0.2, 0.2]) {
    // The rocker: three short pieces bent into an arc.
    for (const [z, y, tilt] of [[-0.24, 0.07, -0.35], [0, 0.035, 0], [0.24, 0.07, 0.35]] as const) {
      const p = box(0.04, 0.035, 0.26, dark, x, y, z, false);
      p.rotation.x = tilt;
      g.add(p);
    }
    for (const z of [-0.14, 0.14]) g.add(box(0.035, 0.34, 0.035, wood, x, 0.23, z, false));
    g.add(box(0.035, 0.035, 0.36, wood, x, 0.56, 0.0, false));
  }
  g.add(box(0.46, 0.05, 0.4, wood, 0, 0.4, 0));
  const back = pivot(0, 0.42, -0.19);
  back.rotation.x = -0.22;
  for (const x of [-0.21, -0.07, 0.07, 0.21]) back.add(box(0.03, 0.56, 0.03, wood, x, 0.28, 0, false));
  back.add(box(0.5, 0.08, 0.04, dark, 0, 0.58, 0));
  g.add(back);
  return g;
}

/** An upright piano under a blue tarp tied with rope, two tiles wide; one corner of the tarp has slipped off the keys. */
export function pianoModel(o: { x: number; y: number }): THREE.Group {
  const g = pivot(o.x + 1, 0, o.y + 0.5);
  const tarp = '#3f5a6b', fold = '#34495a', rope = '#2e2a24';
  g.add(box(1.5, 1.08, 0.58, tarp, 0.04, 0.54, -0.02));
  g.add(box(1.6, 0.1, 0.66, fold, 0.04, 0.05, -0.02, false));
  g.add(box(1.52, 0.06, 0.6, fold, 0.04, 1.1, -0.02, false));
  for (const x of [-0.38, 0.46]) g.add(box(0.03, 1.12, 0.62, rope, x, 0.56, -0.02, false));
  g.add(box(1.54, 0.03, 0.62, rope, 0.04, 0.72, -0.02, false));
  // The slipped corner: the dark wood, the keyboard lid up, a hand of keys.
  g.add(box(0.4, 0.3, 0.32, '#3a2418', -0.52, 0.72, 0.14));
  g.add(box(0.36, 0.03, 0.14, '#ece6d6', -0.52, 0.88, 0.23, false));
  for (const k of [-0.64, -0.56, -0.46, -0.38]) g.add(box(0.025, 0.02, 0.08, '#141210', k, 0.9, 0.2, false));
  const flap = box(0.46, 0.03, 0.36, tarp, -0.55, 0.62, 0.34, 0.012);
  flap.rotation.x = 1.1;
  g.add(flap);
  return g;
}

/** A child's bike lying on its side in the grass: two small wheels, a red frame, the bars turned. */
export function bikeModel(o: { x: number; y: number }): THREE.Group {
  const g = pivot(o.x + 0.5, 0, o.y + 0.5);
  g.rotation.y = hash2(o.x * 9, o.y) * Math.PI * 2;
  const frame = '#b33a2a';
  for (const x of [-0.25, 0.25]) {
    g.add(part(new THREE.TorusGeometry(0.16, 0.024, 4, 12).rotateX(Math.PI / 2), TIRE, x, 0.03, 0, false));
    g.add(part(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 6), '#9aa0a6', x, 0.03, 0, false));
  }
  for (const [x, z, len, turn] of [[0, -0.02, 0.5, 0], [-0.1, 0.07, 0.3, 0.9], [0.1, 0.06, 0.28, -0.8]] as const) {
    const t = box(len, 0.035, 0.035, frame, x, 0.05, z, false);
    t.rotation.y = turn;
    g.add(t);
  }
  g.add(box(0.12, 0.04, 0.06, '#1c1c1e', -0.14, 0.06, 0.16, false), box(0.04, 0.04, 0.3, '#3a3a3c', 0.24, 0.06, 0.1, false));
  g.add(box(0.04, 0.03, 0.08, '#e0c040', 0.24, 0.07, 0.26, false), box(0.04, 0.03, 0.08, '#e0c040', 0.24, 0.07, -0.06, false));
  return g;
}

/** An empty brass birdcage on a carton, its little door open. */
export function birdcageModel(o: { x: number; y: number }): THREE.Group {
  const g = pivot(o.x + 0.5, 0, o.y + 0.5);
  g.rotation.y = hash2(o.x, o.y * 7) * 1.2;
  const brass = '#b8943e';
  g.add(box(0.4, 0.34, 0.36, CARDBOARD[1]!, 0, 0.17, 0), box(0.405, 0.005, 0.07, '#cbb98a', 0, 0.343, 0, false));
  g.add(part(flat(new THREE.CylinderGeometry(0.16, 0.17, 0.035, 12)), brass, 0, 0.36, 0, 0.012));
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    g.add(box(0.012, 0.3, 0.012, brass, Math.cos(a) * 0.15, 0.53, Math.sin(a) * 0.15, false));
  }
  g.add(part(flat(new THREE.CylinderGeometry(0.03, 0.155, 0.12, 10)), brass, 0, 0.74, 0, 0.012));
  g.add(part(new THREE.TorusGeometry(0.035, 0.008, 4, 8), brass, 0, 0.83, 0, false));
  const door = pivot(0.15, 0.44, 0);
  door.rotation.y = -1.2;
  door.add(box(0.012, 0.12, 0.1, brass, 0, 0.06, 0.05, false));
  g.add(door);
  return g;
}

/** A mailbox on a post by a door: the family's own color, its flag, and a pale strip where the name is painted. */
export function mailboxModel(s: Sign): THREE.Group {
  const g = pivot(s.x + 0.5, 0, s.y + 0.5);
  const color = ['#3b4a5a', '#6d6f70', '#7b2f2a', '#3f5a3a'][Math.floor(hash2(s.x * 3, s.y * 5) * 4) % 4]!;
  g.add(box(0.07, 0.72, 0.07, '#4a3a2c', 0, 0.36, 0));
  g.add(box(0.3, 0.03, 0.44, '#4a3a2c', 0, 0.735, 0, false));
  g.add(box(0.22, 0.14, 0.4, color, 0, 0.82, 0));
  const lid = part(flat(new THREE.CylinderGeometry(0.11, 0.11, 0.4, 8, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2)), color, 0, 0.89, 0, 0.016);
  g.add(lid);
  g.add(box(0.012, 0.05, 0.26, '#e6dfcc', 0.117, 0.83, 0, false));
  // Its flag: up at the house whose letter never went, down at the others.
  const up = /flag is still up/i.test(s.text.join(' '));
  const flag = box(0.02, up ? 0.2 : 0.05, up ? 0.05 : 0.18, '#c8281c', -0.125, up ? 0.96 : 0.86, up ? -0.1 : 0, false);
  g.add(flag);
  return g;
}

/** A flap of cardboard someone wrote on in marker, propped on a stake against what it is about (to its north). */
export function cardboardModel(s: Sign): THREE.Group {
  const g = pivot(s.x + 0.5, 0, s.y + 0.3);
  g.add(box(0.04, 0.42, 0.04, '#6b5334', 0, 0.21, 0.06, false));
  const sheet = pivot(0, 0.02, 0);
  sheet.rotation.x = -0.32;
  sheet.add(box(0.5, 0.36, 0.015, CARDBOARD[1]!, 0, 0.2, 0));
  for (const [y, w] of [[0.3, 0.38], [0.22, 0.32], [0.14, 0.36]] as const) sheet.add(box(w, 0.03, 0.005, '#1c1a18', 0, y, 0.011, false));
  g.add(sheet);
  return g;
}

/** A tooth of a sawtooth roof: a triangle (a slope up to the east, then straight down) drawn out north to south. */
function toothGeometry(w: number, rise: number, depth: number): THREE.BufferGeometry {
  const x0 = -w / 2, x1 = w / 2, zb = -depth / 2, zf = depth / 2;
  const A = [x0, 0, zf], B = [x1, 0, zf], C = [x1, rise, zf], D = [x0, 0, zb], E = [x1, 0, zb], F = [x1, rise, zb];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([A, B, C, E, D, F, A, C, F, A, F, D, B, E, F, B, F, C].flat(), 3));
  g.computeVertexNormals();
  return g;
}

/** How tall the mill's walls stand, under its roof (a cabin's are 1.15). */
export const MILL_WALL_H = 1.2;

/**
 * The old sawmill on its tiles: long and low, weathered boards with battens over the joints, a
 * sawtooth roof of rusted metal with its glass dark, the big door slid aside, the company's board over
 * it, small windows, and the stack of its burner at the back. The doorway is open, like every door,
 * and black: nothing burns in there any more.
 */
export function millBuilding(h: House, doorX: number, door: { w: number; h: number; back: number }): THREE.Group {
  const cx = h.x + h.w / 2, cz = h.y + h.h / 2;
  const g = pivot(cx, 0, cz);
  const wall = '#5e5246', batten = '#473d34', H = MILL_WALL_H;
  const W = h.w - 0.2, front = h.h / 2 - 0.15, back = -front;
  const fd = 0.85 - door.back, dx = doorX + 0.5 - cx, fz = front - fd / 2, solid = front - fd - back;
  g.add(box(W, H, solid, wall, 0, H / 2, back + solid / 2));
  const left = dx - door.w / 2 + W / 2, right = W / 2 - dx - door.w / 2;
  g.add(box(left, H, fd, wall, -W / 2 + left / 2, H / 2, fz), box(right, H, fd, wall, W / 2 - right / 2, H / 2, fz));
  g.add(box(door.w, H - door.h, fd, wall, dx, (H + door.h) / 2, fz));
  // Battens over the joints of the boards, on the front and both ends; none across the doorway.
  for (let x = -W / 2 + 0.2; x < W / 2 - 0.1; x += 0.34) {
    if (Math.abs(x - dx) < door.w / 2 + 0.05) continue;
    g.add(box(0.035, H - 0.04, 0.02, batten, x, H / 2, front + 0.01, false));
  }
  for (const s of [-1, 1]) for (let z = back + 0.2; z < front - 0.1; z += 0.34) g.add(box(0.02, H - 0.04, 0.035, batten, s * (W / 2 + 0.01), H / 2, z, false));
  g.add(box(W + 0.06, 0.08, front - back + 0.06, '#3f362e', 0, H + 0.04, 0));
  // The sawtooth roof: its teeth rise to the east and drop straight down, with dark glass on the drop.
  const teeth = Math.max(2, Math.round(W / 1.9)), tw = W / teeth, rise = 0.62, depth = front - back + 0.14;
  for (let k = 0; k < teeth; k++) {
    const tx = -W / 2 + tw * (k + 0.5);
    g.add(part(toothGeometry(tw, rise, depth), toon(wall), tx, H + 0.08, 0, 0.02));
    const slope = Math.hypot(tw, rise), tilt = Math.atan2(rise, tw);
    const roof = box(slope + 0.04, 0.04, depth + 0.04, h.roof, tx, H + 0.08 + rise / 2 + 0.02, 0, false);
    roof.rotation.z = tilt;
    g.add(roof);
    for (let r = -1; r <= 1; r++) {
      const rib = box(slope, 0.018, 0.035, '#5a321e', tx, H + 0.08 + rise / 2 + 0.045, r * depth * 0.3, false);
      rib.rotation.z = tilt;
      g.add(rib);
    }
    g.add(box(0.03, rise - 0.08, depth - 0.2, '#20282c', tx + tw / 2 + 0.016, H + 0.08 + rise / 2 - 0.02, 0, false));
  }
  // The burner's stack at the back, taller than anything in town but the trees.
  g.add(part(flat(new THREE.CylinderGeometry(0.16, 0.19, 3.1, 8)), '#6b3a22', W / 2 - 0.45, 1.55, back + 0.3, 0.02));
  g.add(part(flat(new THREE.CylinderGeometry(0.22, 0.2, 0.12, 8)), '#4a2a18', W / 2 - 0.45, 3.1, back + 0.3, 0.015));
  // The doorway, black inside; its frame; the big door slid aside on its rail; the company's board over it.
  g.add(part(new THREE.BoxGeometry(door.w - 0.02, door.h - 0.02, fd), toon('#0a0807', { side: THREE.BackSide }), dx, door.h / 2, fz + 0.005, false));
  for (const s of [-1, 1]) g.add(box(0.07, door.h + 0.05, 0.08, '#2e241c', dx + s * (door.w / 2 + 0.035), (door.h + 0.05) / 2, front + 0.01, 0.015));
  g.add(box(door.w + 1.3, 0.05, 0.05, '#2a2724', dx + 0.5, door.h + 0.12, front + 0.04, false));
  g.add(box(0.9, door.h + 0.06, 0.05, '#51463c', dx + door.w / 2 + 0.5, (door.h + 0.06) / 2, front + 0.06, 0.015));
  for (const y of [0.25, 0.6]) g.add(box(0.86, 0.03, 0.012, batten, dx + door.w / 2 + 0.5, y, front + 0.09, false));
  g.add(box(1.5, 0.2, 0.03, '#b9ad94', dx - 0.1, H - 0.14, front + 0.03, 0.012));
  for (let k = 0; k < 9; k++) g.add(box(0.07, 0.09, 0.005, '#2a2420', dx - 0.72 + k * 0.155, H - 0.14, front + 0.05, false));
  // Small windows either side, dark; one boarded.
  const spots = [dx - 1.1, dx - 2.0, dx + 2.05].filter(x => Math.abs(x) < W / 2 - 0.3);
  spots.forEach((wx, k) => {
    g.add(box(0.42, 0.34, 0.03, '#2a221b', wx, 0.78, front + 0.02, false), box(0.34, 0.26, 0.035, '#1c1f24', wx, 0.78, front + 0.03, false));
    if (k === 1) { const p = box(0.44, 0.07, 0.02, '#6b5a44', wx, 0.8, front + 0.06, false); p.rotation.z = 0.3; g.add(p); }
  });
  return g;
}

/** Curtains drawn across a dark window (world.ts's cabins, interior.ts's rooms): two panels nearly meeting, and a valance. */
export function curtainPanels(g: THREE.Object3D, color: string, x: number, y: number, z: number, w: number, h: number) {
  const fold = new THREE.Color(color).offsetHSL(0, 0, -0.06).getStyle();
  for (const s of [-1, 1]) {
    g.add(box(w * 0.46, h, 0.012, color, x + s * w * 0.26, y, z, false));
    g.add(box(0.02, h, 0.014, fold, x + s * w * 0.16, y, z + 0.002, false), box(0.02, h, 0.014, fold, x + s * w * 0.38, y, z + 0.002, false));
  }
  g.add(box(w + 0.02, h * 0.18, 0.02, fold, x, y + h * 0.45, z + 0.004, false));
}

/**
 * The things that stand on a tile anywhere, in town, out there or in a room, and are not furniture
 * (interior.ts) or NAPO's (napo.ts): null for anything else.
 */
export function leftModel(o: MapObject): THREE.Object3D | null {
  switch (o.kind) {
    case 'truck': return o.style ? null : logTruck(o);
    case 'logs': return logDeck(o);
    case 'stump': return stumpModel(o);
    case 'skid': return skidModel(o);
    case 'luggage': return luggageModel(o);
    case 'boxes': return boxesModel(o);
    case 'rocker': return rockerModel(o);
    case 'piano': return pianoModel(o);
    case 'bike': return bikeModel(o);
    case 'birdcage': return birdcageModel(o);
    default: return null;
  }
}
