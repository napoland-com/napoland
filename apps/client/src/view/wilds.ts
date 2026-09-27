/**
 * What the world does to you out there, drawn: arrows people painted on the ground, watchers, flares,
 * the echoes of people who collapsed walking their last steps again, the thing that clings to you at
 * night, and the notice board in town. Each is a small class or model that world.ts owns and
 * feeds from the game's lists; nothing here decides anything.
 */
import * as THREE from 'three';
import type { Dir, DropView, MarkView } from '@napoland/shared';
import { makePlayer } from './characters';
import { Puffs } from './fire';
import { OUTLINE, box, disposeTree, flat, ownToon, part, pivot, softTexture } from './toon';

const TURN: Record<Dir, number> = { up: 0, right: -Math.PI / 2, down: Math.PI, left: Math.PI / 2 };
const FACE: Record<Dir, number> = { down: 0, up: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 };
/** Marks lie just above the ground, under blob shadows (0.036) and above rugs. */
const MARK_Y = 0.03;

/** A chevron arrow lying flat, pointing north (-z), about half a tile long. */
function arrowGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.3);
  s.lineTo(0.24, 0.02);
  s.lineTo(0.09, 0.02);
  s.lineTo(0.09, -0.28);
  s.lineTo(-0.09, -0.28);
  s.lineTo(-0.09, 0.02);
  s.lineTo(-0.24, 0.02);
  s.closePath();
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
}

/**
 * The arrows painted on this map: each in its painter's jacket color, glowing a little, pulsing
 * slowly. One instanced mesh for the arrows and one for their glow, rebuilt when the list changes.
 */
export class Marks {
  readonly root = new THREE.Group();
  private arrows: THREE.InstancedMesh | null = null;
  private halos: THREE.InstancedMesh | null = null;
  private readonly arrowGeo = arrowGeometry();
  private readonly haloGeo = new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2);
  private readonly arrowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
  private readonly haloMat = new THREE.MeshBasicMaterial({ map: softTexture(0.3), color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });

  set(marks: Iterable<MarkView>, ground: (x: number, y: number) => number) {
    this.clear();
    const list = [...marks];
    if (!list.length) return;
    this.arrows = new THREE.InstancedMesh(this.arrowGeo, this.arrowMat, list.length);
    this.halos = new THREE.InstancedMesh(this.haloGeo, this.haloMat, list.length);
    const o = new THREE.Object3D(), c = new THREE.Color();
    list.forEach((m, i) => {
      o.position.set(m.x + 0.5, ground(m.x, m.y) + MARK_Y, m.y + 0.5);
      o.rotation.set(0, TURN[m.dir], 0);
      o.updateMatrix();
      c.set(m.color);
      this.arrows!.setMatrixAt(i, o.matrix);
      this.arrows!.setColorAt(i, c.clone().lerp(new THREE.Color('#ffffff'), 0.25));
      o.position.y += 0.002;
      o.updateMatrix();
      this.halos!.setMatrixAt(i, o.matrix);
      this.halos!.setColorAt(i, c);
    });
    for (const m of [this.arrows, this.halos]) {
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
      this.root.add(m);
    }
  }

  update(t: number) {
    this.arrowMat.opacity = 0.72 + 0.14 * Math.sin(t * 1.6);
    this.haloMat.opacity = 0.28 + 0.12 * Math.sin(t * 1.6);
  }

  private clear() {
    for (const m of [this.arrows, this.halos]) {
      if (!m) continue;
      this.root.remove(m);
      m.dispose();
    }
    this.arrows = this.halos = null;
  }

  dispose() {
    this.clear();
    this.arrowGeo.dispose();
    this.haloGeo.dispose();
    this.haloMat.map?.dispose();
    this.arrowMat.dispose();
    this.haloMat.dispose();
  }
}

/**
 * A watcher: a tall thin figure in a long dark coat, a pale face with nothing on it but two faint
 * eyes. It stands a head taller than you and drifts a little above the ground.
 */
function watcherModel(eyes: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const coat = part(flat(new THREE.CylinderGeometry(0.1, 0.24, 0.95, 6)), '#15141a', 0, 0.5, 0, 0.02);
  g.add(coat, box(0.34, 0.08, 0.2, '#1c1a22', 0, 0.96, 0));
  for (const x of [-0.19, 0.19]) {
    const arm = box(0.07, 0.62, 0.08, '#15141a', x, 0.66, 0.02);
    arm.rotation.z = x > 0 ? 0.08 : -0.08;
    g.add(arm, box(0.06, 0.1, 0.06, '#cfc8b8', x * 1.06, 0.32, 0.03, 0.01));
  }
  const head = part(new THREE.SphereGeometry(0.16, 8, 6), '#dcd6c6', 0, 1.18, 0, 0.018);
  head.scale.set(0.85, 1.25, 0.9);
  g.add(head);
  for (const x of [-0.055, 0.055]) g.add(part(new THREE.BoxGeometry(0.035, 0.02, 0.01), eyes, x, 1.2, 0.14, false));
  return g;
}

/** The watchers on this map, where the game draws them. They lean a little into each step. */
export class Watchers {
  readonly root = new THREE.Group();
  private readonly models = new Map<string, { g: THREE.Group; shadow: THREE.Mesh }>();
  private readonly eyes = new THREE.MeshBasicMaterial({ color: 0xb8f4ff });

  constructor(private readonly shadowGeo: THREE.BufferGeometry, private readonly shadowMat: THREE.Material) {}

  sync(list: ReadonlyArray<{ id: string; x: number; y: number; dir: Dir; moving: boolean }>, t: number, ground: (x: number, y: number) => number) {
    const seen = new Set<string>();
    for (const c of list) {
      seen.add(c.id);
      let m = this.models.get(c.id);
      if (!m) {
        m = { g: watcherModel(this.eyes), shadow: new THREE.Mesh(this.shadowGeo, this.shadowMat) };
        m.shadow.scale.setScalar(0.28);
        this.root.add(m.g, m.shadow);
        this.models.set(c.id, m);
      }
      const x = c.x + 0.5, z = c.y + 0.5, gy = ground(x, z);
      m.g.position.set(x, gy + 0.06 + Math.sin(t * 1.3 + Number(c.id)) * 0.03, z);
      m.g.rotation.set(c.moving ? 0.12 : 0, FACE[c.dir], 0, 'YXZ');
      m.shadow.position.set(x, gy + 0.036, z);
    }
    for (const [id, m] of this.models) {
      if (seen.has(id)) continue;
      this.root.remove(m.g, m.shadow);
      disposeTree(m.g);
      this.models.delete(id);
    }
    // The eyes catch the light now and then.
    this.eyes.color.setScalar(0.55 + 0.45 * Math.max(0, Math.sin(t * 0.9)));
  }

  dispose() {
    for (const m of this.models.values()) disposeTree(m.g);
    this.models.clear();
    this.eyes.dispose();
  }
}

/** Flares at once, at most; more are rare, and the nearest few are what matters. */
const FLARES = 4;
const FLARE_SPARKS = 10;

/**
 * Flares burning on this map: a red stick on the ground, a big red glow and sparks spitting up. The
 * world gives the nearest one a real light of its own (see world.ts).
 */
export class Flares {
  readonly root = new THREE.Group();
  readonly sparks: Puffs;
  private readonly glowMat = new THREE.SpriteMaterial({ map: softTexture(0.2), color: 0xff4a3a, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly glows: THREE.Sprite[] = [];
  private readonly sticks: THREE.Group[] = [];
  private list: Array<{ x: number; y: number; left: number; g: number }> = [];

  constructor() {
    this.sparks = new Puffs(FLARES * FLARE_SPARKS, softTexture(0.3), true);
    this.sparks.color.set('#ffb08a');
    this.root.add(this.sparks.points);
    for (let i = 0; i < FLARES; i++) {
      const glow = new THREE.Sprite(this.glowMat);
      glow.scale.set(2.2, 2.2, 1);
      const stick = pivot(0, 0, 0);
      const body = part(flat(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 6)), '#c8322a', 0, 0.04, 0, 0.01);
      body.rotation.z = Math.PI / 2 - 0.2;
      stick.add(body, part(new THREE.IcosahedronGeometry(0.05, 0), new THREE.MeshBasicMaterial({ color: 0xffe0c0 }), 0.15, 0.08, 0, false));
      glow.visible = stick.visible = false;
      this.glows.push(glow);
      this.sticks.push(stick);
      this.root.add(glow, stick);
    }
  }

  /** The flares burning now, nearest first (the caller sorts), and the ground under them. */
  set(list: Array<{ x: number; y: number; left: number }>, ground: (x: number, y: number) => number) {
    this.list = list.slice(0, FLARES).map(f => ({ ...f, g: ground(f.x + 0.5, f.y + 0.5) }));
  }

  update(t: number) {
    for (let i = 0; i < FLARES; i++) {
      const f = this.list[i];
      const glow = this.glows[i]!, stick = this.sticks[i]!;
      glow.visible = stick.visible = !!f;
      for (let k = 0; k < FLARE_SPARKS; k++) {
        if (!f) { this.sparks.set(i * FLARE_SPARKS + k, 0, -10, 0, 0, 0); continue; }
        const a = (t * 1.7 + k / FLARE_SPARKS) % 1, seed = Math.floor(t * 1.7 + k / FLARE_SPARKS) * 13 + k;
        this.sparks.set(i * FLARE_SPARKS + k, f.x + 0.65 + Math.sin(seed) * 0.25 * a, f.g + 0.1 + a * 0.9, f.y + 0.5 + Math.cos(seed * 1.7) * 0.25 * a, 0.08 * (1 - a), (1 - a) ** 2);
      }
      if (!f) continue;
      // It sputters, and the last seconds it dims.
      const k = (0.85 + 0.15 * Math.sin(t * 23 + i) * Math.sin(t * 7.1)) * Math.min(1, f.left / 4);
      glow.position.set(f.x + 0.6, f.g + 0.35, f.y + 0.5);
      glow.scale.setScalar(2.2 * k);
      stick.position.set(f.x + 0.5, f.g, f.y + 0.5);
    }
    this.sparks.commit();
  }

  /** How bright the flare nearest the player burns now, 0 to 1, and where: for the real light. */
  nearest(): { x: number; y: number; g: number; k: number } | null {
    const f = this.list[0];
    return f ? { x: f.x + 0.6, y: f.y + 0.5, g: f.g, k: Math.min(1, f.left / 4) } : null;
  }

  dispose() {
    this.sparks.dispose();
    this.glowMat.map?.dispose();
    this.glowMat.dispose();
  }
}

/** Echoes walk only near you, and only a couple at once. */
const ECHO_NEAR = 11;
const ECHOES = 2;
/** An echo walks a tile in this many seconds (slower than the living), and waits this long at the end. */
const ECHO_STEP_S = 0.34;
const ECHO_REST_S = 2.2;

/**
 * The echoes of people who collapsed: a pale see-through figure walking the last steps they took,
 * again and again, ending at their pile. You see how they got there, and where it went wrong.
 */
export class Echoes {
  readonly root = new THREE.Group();
  private readonly ghosts = new Map<string, { rig: ReturnType<typeof makePlayer>; trail: Array<[number, number]>; ph: number; mat: THREE.MeshBasicMaterial }>();

  /** The piles on the map; the ones near `focus` with a trail get an echo. */
  set(drops: Iterable<DropView>, focus: { x: number; y: number }) {
    const near = [...drops]
      .filter(d => d.trail.length >= 3 && Math.hypot(d.x - focus.x, d.y - focus.y) <= ECHO_NEAR)
      .sort((a, b) => Math.hypot(a.x - focus.x, a.y - focus.y) - Math.hypot(b.x - focus.x, b.y - focus.y))
      .slice(0, ECHOES);
    const keep = new Set(near.map(d => d.id));
    for (const [id, g] of this.ghosts) {
      if (keep.has(id)) continue;
      this.root.remove(g.rig.root);
      disposeTree(g.rig.root);
      this.ghosts.delete(id);
    }
    for (const d of near) {
      if (this.ghosts.has(d.id)) continue;
      const rig = makePlayer('#ffffff');
      // Every part in the pale see-through stuff (its own, so each fades on its own); the dark outlines would make it solid, so they go.
      const mat = new THREE.MeshBasicMaterial({ color: 0xcfeaff, transparent: true, opacity: 0.3, depthWrite: false });
      rig.root.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return;
        if (o.material === OUTLINE) o.visible = false;
        else o.material = mat;
      });
      this.root.add(rig.root);
      this.ghosts.set(d.id, { rig, trail: d.trail, ph: (d.x * 7 + d.y * 3) % 5, mat });
    }
  }

  update(t: number, ground: (x: number, y: number) => number) {
    for (const g of this.ghosts.values()) {
      const n = g.trail.length, walk = (n - 1) * ECHO_STEP_S, round = walk + ECHO_REST_S;
      const a = (t + g.ph) % round, k = Math.min(n - 1, a / ECHO_STEP_S), i = Math.floor(k), f = k - i;
      const [x0, y0] = g.trail[i]!, [x1, y1] = g.trail[Math.min(n - 1, i + 1)]!;
      const x = x0 + (x1 - x0) * f + 0.5, z = y0 + (y1 - y0) * f + 0.5;
      const { root, legL, legR, armL, armR } = g.rig;
      root.position.set(x, ground(x, z), z);
      if (x1 !== x0 || y1 !== y0) root.rotation.y = Math.atan2(x1 - x0, y1 - y0);
      const moving = a < walk, sw = moving ? Math.sin(a * 11) * 0.8 : 0;
      legL.rotation.x = sw; legR.rotation.x = -sw; armL.rotation.x = -sw * 0.7; armR.rotation.x = sw * 0.7;
      // At the end it sinks to the ground and fades, then starts over.
      const fall = moving ? 0 : Math.min(1, (a - walk) / 0.8);
      root.rotation.x = fall * 1.2;
      g.mat.opacity = 0.3 * (1 - fall * 0.8) * Math.min(1, a / 0.6);
    }
  }

  dispose() {
    for (const g of this.ghosts.values()) disposeTree(g.rig.root);
    this.ghosts.clear();
  }
}

/**
 * The thing that clings to you at night: a small dark hunched body over your shoulders, peeking over
 * the top of your head with two pale eyes, long arms hanging down both sides of your face. It sits
 * high on purpose: the camera looks down from the south, so anything lower on your back would only
 * show while you face north. Hung on your character (world.ts) and shown while it clings.
 */
export function hitchhikerModel(): THREE.Group {
  const g = new THREE.Group();
  // Your cap's top is about 1 above the ground; it squats on it, a little to the back.
  g.position.set(0, 0.98, -0.08);
  const body = part(new THREE.SphereGeometry(0.2, 8, 6), '#1a1722', 0, 0.1, -0.04, 0.02);
  body.scale.set(1.15, 0.8, 1);
  const head = part(new THREE.SphereGeometry(0.12, 7, 5), '#1a1722', 0, 0.2, 0.1, 0.018);
  g.add(body, head);
  // Arms over your shoulders, hanging beside your face; legs down your back.
  for (const x of [-1, 1]) {
    const arm = box(0.06, 0.42, 0.06, '#1a1722', x * 0.25, -0.16, 0.1, 0.012);
    arm.rotation.z = x * -0.25;
    const leg = box(0.07, 0.4, 0.07, '#1a1722', x * 0.13, -0.3, -0.22, 0.012);
    leg.rotation.x = 0.35;
    g.add(arm, leg);
  }
  const eyes = new THREE.MeshBasicMaterial({ color: 0xd8f4ff });
  for (const x of [-0.045, 0.045]) g.add(part(new THREE.BoxGeometry(0.04, 0.025, 0.02), eyes, x, 0.23, 0.21, false));
  return g;
}

/**
 * The notice board: two posts, a small roof over a wide board, and a few papers pinned on it. It
 * faces south, like a sign, so you read it from the tile below. Built from parts to be baked.
 */
export function boardModel(x: number, y: number): THREE.Group {
  const g = pivot(x + 0.5, 0, y + 0.5);
  for (const px of [-0.36, 0.36]) g.add(box(0.08, 0.95, 0.08, '#4a3a2c', px, 0.47, 0));
  g.add(box(0.86, 0.5, 0.06, '#6b5334', 0, 0.62, 0.02));
  g.add(box(0.96, 0.05, 0.22, '#3d3128', 0, 0.92, 0.02));
  const notes: Array<[number, number, number, string]> = [[-0.24, 0.7, 0.1, '#e8dfc8'], [0.02, 0.66, -0.06, '#d9cfb8'], [0.25, 0.72, 0.05, '#efe6cf'], [-0.1, 0.52, -0.1, '#e1d6bd'], [0.2, 0.5, 0.12, '#d4c7aa']];
  for (const [nx, ny, turn, color] of notes) {
    const n = box(0.17, 0.2, 0.01, color, nx, ny, 0.056, false);
    n.rotation.z = turn;
    g.add(n, box(0.025, 0.025, 0.012, '#b13a2c', nx, ny + 0.08, 0.063, false));
  }
  return g;
}

/** A toon material for the Old Stone's crystal whose glow can change (awake or asleep). */
export const stoneCrystal = () => ownToon('#8b5bd9', { emissive: 0x4a1a9c });
