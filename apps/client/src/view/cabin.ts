/**
 * Your own cabin's furniture (comfort.ts): each place drawn as what stands there, the spoiled old thing
 * years of damp left (a cold rusted stove, a bare bed frame, a rotted rug, a cracked lamp, a broken rack,
 * an empty warped shelf) until you make it again, then the new one. The trophy shelf shows the charms and
 * anomalous gear your stash holds, one of each.
 *
 * Plain builders of low-poly models on their tiles, like interior.ts's furniture: world.ts bakes them
 * into a few meshes of their own, and builds them again when what stands there changes.
 */
import * as THREE from 'three';
import type { Comfort, ItemDef, MapObject, TileMap } from '@napoland/shared';
import { againstWall, tableModel } from './interior';
import { box, flat, hash2, part, pivot, toon } from './toon';

type Place = Extract<MapObject, { kind: 'comfort' }>;

/** What glows in the made furniture: the stove's grate, the lamp's flame and its glass. Shared, so baking keeps each a mesh of its own. */
const GRATE = toon('#5a1c08', { emissive: 0xff5a14 });
const FLAME = toon('#ffe6a0', { emissive: 0xffb347 });
const GLASS = toon('#fff4d0', { emissive: 0x8a6a2a });
/** A humming bead in the stash glows on the shelf, as it does in the bag's drawing. */
const BEAD = toon('#7ff3e6', { emissive: 0x1f8a80 });
const EMBER = toon('#2c2623', { emissive: 0x4a1c06 });

const RUST = '#6e3b24', RUST_DARK = '#4a2818', IRON = '#2c3134', IRON_EDGE = '#1c2023';
const WOOD = '#6b4a31', WOOD_ROT = '#4e4538', WOOD_ROT_DARK = '#3a332a';

/**
 * The model of a comfort place: the new furniture once `made`, else the spoiled old thing. `trophies`
 * (made trophy shelf only): what stands on it, in the order the stash lists them.
 */
export function comfortModel(o: Place, made: boolean, map: TileMap, trophies: readonly ItemDef[] = []): THREE.Object3D {
  switch (o.what) {
    case 'stove': return made ? stove(o, map) : oldStove(o, map);
    case 'bed': return made ? bed(o) : bedFrame(o);
    case 'rug': return made ? ragRug(o) : rottenRug(o);
    case 'lamp': return made ? lamp(o) : crackedLamp(o);
    case 'rack': return made ? rack(o, map) : brokenRack(o, map);
    case 'shelf': return made ? trophyShelf(o, map, trophies) : warpedShelf(o, map);
  }
}

/** A soft shadow under each place, spoiled or made: [x, z, radius x, radius z], as interior.ts's furnitureShadows. None under the rug. */
export function comfortShadow(o: Place): [number, number, number, number] | null {
  switch (o.what) {
    case 'bed': return [o.x + 0.5, o.y + 1, 0.5, 1.0];
    case 'lamp': return [o.x + 0.5, o.y + 0.5, 0.5, 0.44];
    case 'stove': return [o.x + 0.5, o.y + 0.44, 0.44, 0.34];
    case 'rack': return [o.x + 0.5, o.y + 0.5, 0.44, 0.3];
    case 'shelf': return [o.x + 0.5, o.y + 0.28, 0.52, 0.26];
    case 'rug': return null;
  }
}

/** Where a made lamp hangs its light over the table, for the room's real lights (lighting.ts). */
export function lampLight(o: Place): { x: number; y: number; z: number } {
  return { x: o.x + 0.62, y: 0.95, z: o.y + 0.5 };
}

// ---------- the stove ----------

/** An iron stove against the wall, on four short legs, its pipe up into the wall, a kettle on top and the fire glowing through its grate. */
function stove(o: Place, map: TileMap): THREE.Group {
  const g = pivot(o.x + 0.5, 0, o.y + 0.5);
  g.rotation.y = againstWall(map, o.x, o.y);
  for (const [lx, lz] of [[-0.24, -0.26], [0.24, -0.26], [-0.24, 0.08], [0.24, 0.08]] as const) g.add(box(0.07, 0.12, 0.07, IRON_EDGE, lx, 0.06, lz, false));
  g.add(box(0.62, 0.5, 0.46, IRON, 0, 0.37, -0.09));
  g.add(box(0.68, 0.05, 0.52, IRON_EDGE, 0, 0.645, -0.09, 0.014));
  // The door, and the fire behind its grate.
  g.add(box(0.36, 0.26, 0.02, IRON_EDGE, 0, 0.36, 0.14, false));
  g.add(part(new THREE.BoxGeometry(0.28, 0.16, 0.012), GRATE, 0, 0.35, 0.152, false));
  for (const bx of [-0.07, 0, 0.07]) g.add(box(0.018, 0.17, 0.012, IRON_EDGE, bx, 0.35, 0.16, false));
  g.add(box(0.05, 0.03, 0.03, '#b8943e', 0.15, 0.36, 0.165, false));
  // The pipe, up and through the wall behind.
  g.add(part(flat(new THREE.CylinderGeometry(0.07, 0.07, 1.36, 8)), IRON, 0.14, 1.38, -0.2, 0.014));
  const elbow = part(flat(new THREE.CylinderGeometry(0.07, 0.07, 0.34, 8)), IRON, 0.14, 2.06, -0.34, 0.014);
  elbow.rotation.x = Math.PI / 2;
  g.add(elbow);
  g.add(part(flat(new THREE.CylinderGeometry(0.085, 0.085, 0.05, 8)), IRON_EDGE, 0.14, 0.7, -0.2, false));
  // A kettle, its spout toward the room.
  g.add(part(flat(new THREE.CylinderGeometry(0.1, 0.12, 0.12, 8)), '#8f969c', -0.12, 0.73, -0.02, 0.012));
  g.add(part(flat(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 6)), '#5a6268', -0.12, 0.805, -0.02, false));
  const spout = box(0.03, 0.03, 0.1, '#8f969c', -0.12, 0.74, 0.1, false);
  spout.rotation.x = -0.5;
  g.add(spout);
  return g;
}

/** The same stove, cold and rusted: its door hanging open on one hinge, the pipe broken off short, flakes of rust on the floor. */
function oldStove(o: Place, map: TileMap): THREE.Group {
  const v = hash2(o.x * 7 + 3, o.y * 5 + 1);
  const g = pivot(o.x + 0.5, 0, o.y + 0.5);
  g.rotation.y = againstWall(map, o.x, o.y);
  for (const [lx, lz, h] of [[-0.24, -0.26, 0.12], [0.24, -0.26, 0.12], [-0.24, 0.08, 0.12], [0.24, 0.08, 0.08]] as const) g.add(box(0.07, h, 0.07, RUST_DARK, lx, h / 2, lz, false));
  const body = pivot(0, 0, -0.09);
  // One leg rotted short: it leans.
  body.rotation.z = -0.05;
  body.add(box(0.62, 0.5, 0.46, RUST, 0, 0.37, 0));
  body.add(box(0.66, 0.05, 0.5, RUST_DARK, 0, 0.64, 0, 0.014));
  body.add(box(0.28, 0.16, 0.012, '#141110', 0, 0.35, 0.236, false));
  g.add(body);
  const door = pivot(-0.18, 0.36, 0.15);
  door.rotation.y = -1.1 - v * 0.3;
  door.add(box(0.36, 0.26, 0.02, RUST_DARK, 0.18, 0, 0, 0.012));
  g.add(door);
  g.add(part(flat(new THREE.CylinderGeometry(0.07, 0.07, 0.34, 8)), RUST_DARK, 0.14, 0.84, -0.2, 0.014));
  for (let k = 0; k < 4; k++) g.add(box(0.05, 0.008, 0.04, RUST, Math.cos(k * 2.1 + v) * 0.3, 0.004, 0.24 + Math.sin(k * 1.7) * 0.06, false));
  return g;
}

// ---------- the bed ----------

/** A proper bed again: its frame, a thick mattress, clean sheets, a wool blanket and a pillow. */
function bed(o: Place): THREE.Group {
  const g = pivot(o.x + 0.5, 0, o.y + 1);
  g.add(box(0.84, 0.22, 1.84, '#5a3d2a', 0, 0.17, 0));
  g.add(box(0.92, 0.66, 0.1, '#3f2a1d', 0, 0.33, -0.92), box(0.92, 0.4, 0.08, '#3f2a1d', 0, 0.2, 0.93));
  g.add(box(0.8, 0.14, 1.74, '#d6cdb9', 0, 0.35, -0.02, false));
  g.add(box(0.88, 0.1, 1.12, '#7a3b35', 0, 0.44, 0.33));
  g.add(box(0.9, 0.04, 0.12, '#e6dcc4', 0, 0.48, -0.2, false));
  g.add(box(0.6, 0.12, 0.3, '#ece5d4', 0, 0.47, -0.64, 0.018));
  return g;
}

/** A bare bed frame: head and foot boards and the rails, a few slats across, one of them broken, and no mattress on it. */
function bedFrame(o: Place): THREE.Group {
  const g = pivot(o.x + 0.5, 0, o.y + 1);
  g.add(box(0.92, 0.6, 0.1, WOOD_ROT_DARK, 0, 0.3, -0.92), box(0.92, 0.36, 0.08, WOOD_ROT_DARK, 0, 0.18, 0.93));
  for (const sx of [-0.4, 0.4]) g.add(box(0.06, 0.12, 1.8, WOOD_ROT, sx, 0.2, 0, 0.012));
  for (const z of [-0.6, -0.2, 0.2, 0.6]) g.add(box(0.76, 0.03, 0.1, WOOD_ROT, 0, 0.25, z, false));
  const broken = box(0.36, 0.03, 0.1, WOOD_ROT, -0.2, 0.12, 0.42, false);
  broken.rotation.z = 0.5;
  g.add(broken);
  return g;
}

// ---------- the rug ----------

/** A braided rag rug on its tiles: ring on ring of cloth, a hundredth apart so nothing flickers through. */
function ragRug(o: Place): THREE.Group {
  const [w, h] = [3, 2];
  const g = pivot(o.x + w / 2, 0, o.y + h / 2);
  const rings = ['#6b2f2a', '#b08a58', '#3d4e5c', '#8a5a3a', '#c2a36a'];
  rings.forEach((c, i) => {
    const k = 1 - i * 0.18;
    g.add(box((w - 0.18) * k, 0.008 + i * 0.004, (h - 0.18) * k, c, 0, 0.004 + i * 0.002, 0, false));
  });
  return g;
}

/** What is left of the old rug: a dull, stained mat with holes rotted through where the roof leaked. */
function rottenRug(o: Place): THREE.Group {
  const [w, h] = [3, 2];
  const g = pivot(o.x + w / 2, 0, o.y + h / 2);
  g.add(box(w - 0.3, 0.008, h - 0.28, '#4d463a', 0, 0.004, 0, false));
  g.add(box((w - 0.3) * 0.7, 0.012, (h - 0.28) * 0.6, '#3f3a30', -0.1, 0.006, 0.05, false));
  // Holes down to the boards, and a stain where the water pooled.
  for (const [hx, hz, s] of [[0.7, -0.35, 0.28], [-0.9, 0.3, 0.2], [0.2, 0.45, 0.16]] as const) g.add(box(s, 0.014, s * 0.8, '#2a231c', hx, 0.007, hz, false));
  g.add(box(0.5, 0.016, 0.34, '#35302a', -0.35, 0.008, -0.3, false));
  return g;
}

// ---------- the lamp ----------

/** The table, with a new oil lamp on it lit: a brass foot, a glowing glass chimney and its flame. */
function lamp(o: Place): THREE.Group {
  const g = tableModel(o.x, o.y);
  g.add(part(flat(new THREE.CylinderGeometry(0.1, 0.12, 0.05, 8)), '#b8943e', 0.12, 0.625, 0, 0.012));
  g.add(part(flat(new THREE.CylinderGeometry(0.075, 0.09, 0.1, 8)), '#c9a24a', 0.12, 0.7, 0, 0.012));
  g.add(part(new THREE.CylinderGeometry(0.06, 0.075, 0.2, 10), GLASS, 0.12, 0.85, 0, false));
  g.add(part(new THREE.ConeGeometry(0.03, 0.08, 6), FLAME, 0.12, 0.82, 0, false));
  g.add(box(0.2, 0.035, 0.26, '#35505c', -0.18, 0.605, -0.06, 0.01));
  return g;
}

/** The table, with the old lamp on it: tarnished, its glass chimney cracked and a piece of it lying beside, and no wick. */
function crackedLamp(o: Place): THREE.Group {
  const g = tableModel(o.x, o.y);
  g.add(part(flat(new THREE.CylinderGeometry(0.1, 0.12, 0.05, 8)), '#5c5238', 0.12, 0.625, 0, 0.012));
  g.add(part(flat(new THREE.CylinderGeometry(0.075, 0.09, 0.1, 8)), '#6a5e40', 0.12, 0.7, 0, 0.012));
  const chimney = part(new THREE.CylinderGeometry(0.06, 0.075, 0.13, 7, 1, true), '#5d6660', 0.12, 0.82, 0, false);
  chimney.rotation.z = 0.12;
  g.add(chimney);
  const shard = box(0.07, 0.008, 0.05, '#5d6660', -0.05, 0.61, 0.16, false);
  shard.rotation.y = 0.7;
  g.add(shard);
  return g;
}

// ---------- the drying rack ----------

/** A wooden drying rack by the fire, its rails hung with a shirt and a pair of socks. */
function rack(o: Place, map: TileMap): THREE.Group {
  const g = pivot(o.x + 0.5, 0, o.y + 0.5);
  g.rotation.y = againstWall(map, o.x, o.y);
  for (const sx of [-0.36, 0.36]) {
    for (const lean of [-0.18, 0.18]) {
      const leg = box(0.05, 1.02, 0.05, WOOD, sx, 0.5, lean * 0.6 - 0.05, false);
      leg.rotation.x = lean;
      g.add(leg);
    }
  }
  for (const y of [0.55, 0.85]) g.add(box(0.8, 0.035, 0.035, WOOD, 0, y, -0.05, 0.01));
  // A shirt over the top rail, socks on the lower.
  g.add(box(0.36, 0.34, 0.02, '#3d6a8a', -0.12, 0.7, -0.03, 0.012), box(0.36, 0.34, 0.02, '#3d6a8a', -0.12, 0.7, -0.08, false));
  for (const sx of [0.18, 0.28]) g.add(box(0.06, 0.18, 0.02, '#c9c2b0', sx, 0.47, -0.03, 0.01));
  return g;
}

/** The old rack, broken: one side fallen in, its rails snapped, a piece of one on the floor. */
function brokenRack(o: Place, map: TileMap): THREE.Group {
  const g = pivot(o.x + 0.5, 0, o.y + 0.5);
  g.rotation.y = againstWall(map, o.x, o.y);
  for (const lean of [-0.18, 0.18]) {
    const leg = box(0.05, 1.0, 0.05, WOOD_ROT, -0.36, 0.49, lean * 0.6 - 0.05, false);
    leg.rotation.x = lean;
    g.add(leg);
  }
  // The other side lies against it, fallen.
  const fallen = box(0.05, 0.9, 0.05, WOOD_ROT_DARK, 0.1, 0.25, 0.05, false);
  fallen.rotation.z = 1.2;
  g.add(fallen);
  const rail = box(0.42, 0.035, 0.035, WOOD_ROT, -0.2, 0.85, -0.05, 0.01);
  rail.rotation.z = 0.35;
  g.add(rail);
  g.add(box(0.3, 0.035, 0.035, WOOD_ROT, 0.22, 0.02, 0.25, false).rotateY(0.6));
  return g;
}

// ---------- the shelf ----------

/** Where a trophy stands on the shelf: three to a board, two boards, the lower one first. */
const TROPHY_SPOTS: ReadonlyArray<readonly [number, number]> = [[-0.27, 0.49], [0, 0.49], [0.27, 0.49], [-0.27, 0.9], [0, 0.9], [0.27, 0.9]];

/** A sturdy new shelf against the wall, and on it the charms and anomalous gear in your stash, one of each (the first six). */
function trophyShelf(o: Place, map: TileMap, trophies: readonly ItemDef[]): THREE.Group {
  const g = pivot(o.x + 0.5, 0, o.y + 0.5);
  g.rotation.y = againstWall(map, o.x, o.y);
  g.add(box(0.92, 1.3, 0.05, '#4a3223', 0, 0.65, -0.43, false));
  for (const sx of [-0.44, 0.44]) g.add(box(0.05, 1.32, 0.38, WOOD, sx, 0.66, -0.26));
  for (const sy of [0.05, 0.46, 0.87, 1.3]) g.add(box(0.84, 0.04, 0.36, WOOD, 0, sy, -0.26, false));
  trophies.slice(0, TROPHY_SPOTS.length).forEach((def, i) => {
    const [tx, ty] = TROPHY_SPOTS[i]!;
    const t = trophyModel(def);
    t.position.set(tx, ty, -0.26);
    g.add(t);
  });
  return g;
}

/** The old shelf: warped with damp, its boards sagging, one of them fallen, and nothing on it. */
function warpedShelf(o: Place, map: TileMap): THREE.Group {
  const g = pivot(o.x + 0.5, 0, o.y + 0.5);
  g.rotation.y = againstWall(map, o.x, o.y);
  g.add(box(0.92, 1.3, 0.05, WOOD_ROT_DARK, 0, 0.65, -0.43, false));
  const left = box(0.05, 1.32, 0.38, WOOD_ROT, -0.44, 0.66, -0.26);
  left.rotation.z = 0.04;
  g.add(left, box(0.05, 1.32, 0.38, WOOD_ROT, 0.44, 0.66, -0.26));
  for (const [sy, tilt] of [[0.05, 0], [0.46, 0.07], [1.3, -0.04]] as const) {
    const board = box(0.84, 0.04, 0.36, WOOD_ROT, 0, sy, -0.26, false);
    board.rotation.z = tilt;
    g.add(board);
  }
  const fallen = box(0.84, 0.04, 0.3, WOOD_ROT, 0.05, 0.05, 0.1, false);
  fallen.rotation.set(0, 0.25, 0.1);
  g.add(fallen);
  return g;
}

/**
 * A trophy on the shelf, standing on the board at its origin: the charms by what they are (a warm
 * pebble, a hollow feather, a humming bead), anomalous gear by its slot in its color; anything else a
 * small dark stone with a glow in it.
 */
export function trophyModel(def: ItemDef): THREE.Group {
  const g = new THREE.Group();
  switch (def.id) {
    case 'warm-pebble':
      g.add(part(flat(new THREE.SphereGeometry(0.08, 7, 5)).scale(1.2, 0.6, 1), EMBER, 0, 0.05, 0, 0.01));
      return g;
    case 'hollow-feather': {
      const quill = box(0.03, 0.26, 0.008, '#a9a6a0', 0, 0.13, 0, 0.008);
      quill.rotation.z = -0.45;
      g.add(quill);
      return g;
    }
    case 'humming-bead':
      g.add(part(flat(new THREE.IcosahedronGeometry(0.06, 0)), BEAD, 0, 0.07, 0, 0.01));
      return g;
  }
  const c = def.color ?? '#9a6cf0';
  switch (def.kind === 'gear' ? def.slot : undefined) {
    case 'cap':
      g.add(part(flat(new THREE.SphereGeometry(0.09, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2)), c, 0, 0.02, 0, 0.01), box(0.22, 0.02, 0.1, c, 0, 0.025, 0.07, false));
      return g;
    case 'shirt': case 'pants':
      g.add(box(0.2, 0.08, 0.16, c, 0, 0.04, 0, 0.01), box(0.2, 0.02, 0.16, new THREE.Color(c).multiplyScalar(0.8).getStyle(), 0, 0.09, 0, false));
      return g;
    case 'gloves': case 'shoes':
      g.add(box(0.08, 0.1, 0.14, c, -0.05, 0.05, 0, 0.01), box(0.08, 0.1, 0.14, c, 0.05, 0.05, 0, 0.01));
      return g;
    case 'bag':
      g.add(box(0.16, 0.2, 0.1, c, 0, 0.1, 0, 0.01));
      return g;
  }
  g.add(part(flat(new THREE.DodecahedronGeometry(0.07, 0)), EMBER, 0, 0.06, 0, 0.01));
  return g;
}

/** Which places are made, from the furniture set in the cabin (item ids). */
export function madePlaces(furniture: readonly string[], get: (id: string) => ItemDef): Set<Comfort> {
  const out = new Set<Comfort>();
  for (const id of furniture) {
    const def = get(id);
    if (def.kind === 'furniture' && def.furnishes) out.add(def.furnishes);
  }
  return out;
}
