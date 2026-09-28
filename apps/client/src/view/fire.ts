/**
 * Fire and smoke. A fireplace burns day and night, whatever the weather, for as long as it has fuel
 * (a fire out in the wilds burns down; its flames shrink as it does, and a dead one is dark coals): a stone hearth
 * against the wall (or a ring of stones where no wall stands behind it) with flickering flames,
 * glowing embers, a soft glow over the flames and on the floor around it (the warm tiles, where
 * energy comes back), and a real light, which world.ts hands out like a lamp's. A house whose room
 * keeps a fire has smoke rising from its chimney.
 *
 * The stones, logs and embers never move, so world.ts bakes them with the other props; what moves
 * costs a few draw calls for all the fires of a map together.
 */
import * as THREE from 'three';
import { FIRE_LOW_S, FIRE_MAX_S } from '@napoland/shared';
import { WALL_TALL } from './interior';
import { box, flat, glowQuads, mulberry32, part, pivot, softTexture } from './toon';

const STONES = ['#6d6862', '#625d57', '#78726b', '#5a5550'];
const LOG = '#3a2618';
/** Pools of light on the floor lie above rugs (whose tops are at most 0.026) and shadows. */
export const GLOW_Y = 0.045;

/** Where a fire's flames stand, and a phase so no two fires flicker together. */
export interface FireSpot {
  x: number;
  y: number;
  z: number;
  ph: number;
  /** In a hearth against a wall (its glow leans into the room), or out in the open. */
  hearth: boolean;
}

/** Two logs crossed over a bed of embers (`embers` glows, and Fires makes it pulse). */
function logs(g: THREE.Object3D, z: number, embers: THREE.Material, seed: number) {
  for (const [yaw, dz] of [[0.38, -0.02], [-0.42, 0.02]] as const) {
    const l = part(flat(new THREE.CylinderGeometry(0.045, 0.05, 0.42, 6)), LOG, 0, 0.07, z + dz, 0.012);
    l.rotation.set(0, yaw, Math.PI / 2);
    g.add(l);
  }
  const rng = mulberry32(seed);
  for (let i = 0; i < 8; i++) {
    const e = part(new THREE.BoxGeometry(0.05, 0.03, 0.05), embers, (rng() - 0.5) * 0.4, 0.03, z + (rng() - 0.5) * 0.2, false);
    e.rotation.y = rng() * 3;
    g.add(e);
  }
}

/**
 * A stone hearth against the wall north of tile x,y: a chimney breast up to the top of the wall, a
 * sooty mouth with the fire in it, a mantel with a jar and a box, and a slab in front.
 */
export function hearthModel(x: number, y: number, embers: THREE.Material): { model: THREE.Group; spot: Omit<FireSpot, 'ph'> } {
  const g = hearthStones(x, y), fire = 0.34;
  logs(g, fire, embers, x * 7 + y);
  return { model: g, spot: { x: x + 0.5, y: 0.06, z: y + fire, hearth: true } };
}

/** A hearth nobody lights any more: the same stones, cold ash in the mouth and the charred ends of the last fire. */
export function coldHearthModel(x: number, y: number): THREE.Group {
  const g = hearthStones(x, y);
  g.add(box(0.44, 0.04, 0.2, '#57534e', 0, 0.02, 0.3, false), box(0.3, 0.05, 0.12, '#6b6762', -0.05, 0.03, 0.26, false));
  for (const [yaw, dz] of [[0.3, 0.28], [-0.5, 0.32]] as const) {
    const l = part(flat(new THREE.CylinderGeometry(0.04, 0.045, 0.3, 6)), '#1f1a17', 0, 0.06, dz, 0.012);
    l.rotation.set(0, yaw, Math.PI / 2);
    g.add(l);
  }
  return g;
}

/** A hearth's stones, mantel and slab, without its fire: what a lit hearth and a cold one share. */
function hearthStones(x: number, y: number): THREE.Group {
  const g = pivot(x + 0.5, 0, y);
  // The camera looks down steeply, so the mouth is tall, the mantel high and the fire at the front
  // of the mouth: otherwise the lintel and the mantel hide the flames.
  const width = 0.96, depth = 0.42, mouthW = 0.58, mouthH = 0.68, back = 0.14, jamb = (width - mouthW) / 2, stone = '#66615b';
  g.add(box(width, WALL_TALL - mouthH, depth, stone, 0, mouthH + (WALL_TALL - mouthH) / 2, depth / 2));
  for (const s of [-1, 1]) g.add(box(jamb, mouthH, depth, stone, s * (mouthW + jamb) / 2, mouthH / 2, depth / 2));
  g.add(box(mouthW, mouthH, back, '#15100d', 0, mouthH / 2, back / 2, false));
  g.add(box(mouthW, 0.03, depth - back, '#1f1813', 0, 0.015, (back + depth) / 2, false));
  // Stones set in the breast: flat, a few greys, the same on every visit.
  const rng = mulberry32(x * 131 + y * 17);
  for (let row = 0; row < 5; row++) {
    const sy = 1.22 + row * 0.24;
    if (sy > WALL_TALL - 0.12) break;
    for (let sx = -0.36 + (row % 2) * 0.12; sx < 0.4; sx += 0.26 + rng() * 0.06) {
      g.add(box(0.2 + rng() * 0.05, 0.15 + rng() * 0.04, 0.025, STONES[Math.floor(rng() * STONES.length)]!, sx, sy, depth + 0.01, false));
    }
  }
  g.add(box(mouthW + 0.16, 0.11, 0.05, '#7b756d', 0, mouthH + 0.055, depth + 0.015, 0.015));
  g.add(box(1.12, 0.07, 0.18, '#4a3222', 0, 1.0, depth + 0.03));
  g.add(part(flat(new THREE.CylinderGeometry(0.05, 0.05, 0.13, 7)), '#7f9383', -0.36, 1.1, depth + 0.03, 0.012));
  g.add(box(0.13, 0.16, 0.09, '#6e5a3e', 0.33, 1.115, depth + 0.03, 0.012));
  g.add(box(1.04, 0.05, 0.3, '#56514b', 0, 0.025, depth + 0.15, 0.015));
  return g;
}

/** A fire in the open on tile x,y: a ring of stones around crossed logs. */
export function campfireModel(x: number, y: number, embers: THREE.Material): { model: THREE.Group; spot: Omit<FireSpot, 'ph'> } {
  const g = pivot(x + 0.5, 0, y + 0.5);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const s = part(new THREE.DodecahedronGeometry(0.1, 0), STONES[i % STONES.length]!, Math.cos(a) * 0.36, 0.06, Math.sin(a) * 0.36, 0.015);
    s.rotation.set(i, i * 2, 0);
    g.add(s);
  }
  logs(g, 0, embers, x * 7 + y);
  return { model: g, spot: { x: x + 0.5, y: 0.05, z: y + 0.5, hearth: false } };
}

/** A fire's flames, back to front: offset x, offset z, radius, height, color. The small bright ones stand in front, so they show. */
const FLAMES: ReadonlyArray<readonly [number, number, number, number, string]> = [
  [0, -0.05, 0.13, 0.46, '#ff6a1c'],
  [-0.1, -0.02, 0.11, 0.36, '#ff5a14'],
  [0.1, -0.03, 0.11, 0.38, '#ff7420'],
  [-0.045, 0.04, 0.085, 0.29, '#ffa12e'],
  [0.055, 0.05, 0.08, 0.26, '#ffb53c'],
  [0, 0.08, 0.06, 0.18, '#ffe27a'],
];
const SPARKS = 5;
/** Seconds a spark takes to rise and go out. */
const SPARK_S = 1.3;

/**
 * Soft round puffs (smoke, sparks) drawn as one set of points, one draw call however many: each has
 * its own size (world units) and opacity. Call resize() with the pixels one world unit covers at a
 * distance of one unit, so a puff keeps its size on every screen.
 */
export class Puffs {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private readonly pos: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;

  constructor(readonly count: number, private readonly texture: THREE.Texture, additive: boolean) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute((this.pos = new Float32Array(count * 3)), 3));
    g.setAttribute('size', new THREE.BufferAttribute((this.size = new Float32Array(count)), 1));
    g.setAttribute('alpha', new THREE.BufferAttribute((this.alpha = new Float32Array(count)), 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), map: { value: texture }, color: { value: new THREE.Color() }, scale: { value: 1000 } },
      vertexShader: `
        attribute float size;
        attribute float alpha;
        uniform float scale;
        varying float vAlpha;
        #include <fog_pars_vertex>
        void main() {
          vAlpha = alpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mvPosition.z;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D map;
        uniform vec3 color;
        varying float vAlpha;
        #include <fog_pars_fragment>
        void main() {
          float a = texture2D(map, gl_PointCoord).a * vAlpha;
          if (a < 0.004) discard;
          gl_FragColor = vec4(color, a);
          #include <fog_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    // They move every frame, and there are few: cheaper to always draw than to keep bounds.
    this.points.frustumCulled = false;
  }

  get color(): THREE.Color {
    return this.material.uniforms.color!.value as THREE.Color;
  }

  resize(pixelsPerUnit: number) {
    this.material.uniforms.scale!.value = pixelsPerUnit;
  }

  set(i: number, x: number, y: number, z: number, size: number, alpha: number) {
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.size[i] = size;
    this.alpha[i] = alpha;
  }

  commit() {
    for (const name of ['position', 'size', 'alpha']) (this.points.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }

  /** disposeTree frees the points and their material, but cannot see a texture held in a uniform. */
  dispose() {
    this.texture.dispose();
  }
}

/** Gentle, never quite regular: the sum of a few waves, around 1. */
export function flicker(t: number, ph: number): number {
  return 1 + 0.07 * Math.sin(t * 7.3 + ph) + 0.05 * Math.sin(t * 12.9 + ph * 2.1) + 0.03 * Math.sin(t * 23.1 + ph * 0.7);
}

/**
 * The moving part of every fire on a map: the flames (one instanced mesh), a glow over each, the
 * warm glow on the floor around them, the embers' pulse and a few sparks.
 */
export class Fires {
  readonly objects: THREE.Object3D[] = [];
  readonly sparks: Puffs;
  private readonly flames: THREE.InstancedMesh;
  private readonly glowMat: THREE.SpriteMaterial;
  private readonly floorMat: THREE.MeshBasicMaterial;
  private readonly o = new THREE.Object3D();
  private readonly hot = new THREE.Color('#ffb347');
  private readonly cool = new THREE.Color('#e2481a');
  private readonly dead = new THREE.Color('#2a1710');
  private readonly glows: THREE.Sprite[] = [];

  constructor(private readonly spots: FireSpot[], private readonly embers: THREE.MeshBasicMaterial) {
    const cone = flat(new THREE.ConeGeometry(1, 1, 5, 1, true));
    cone.translate(0, 0.5, 0);
    this.flames = new THREE.InstancedMesh(cone, new THREE.MeshBasicMaterial({ color: 0xffffff }), spots.length * FLAMES.length);
    const c = new THREE.Color();
    for (let i = 0; i < this.flames.count; i++) this.flames.setColorAt(i, c.set(FLAMES[i % FLAMES.length]![4]));
    this.flames.frustumCulled = false;
    this.objects.push(this.flames);

    const glowTex = softTexture(0.3);
    this.glowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xff8a3a, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const s of spots) {
      const glow = new THREE.Sprite(this.glowMat);
      glow.position.set(s.x, s.y + 0.22, s.z + 0.06);
      glow.scale.set(1.25, 1.25, 1);
      this.objects.push(glow);
      this.glows.push(glow);
    }

    // The warm tiles: a soft light on the floor around each fire, leaning into the room from a hearth.
    const floor = glowQuads(spots.map(s => [s.x, s.z + (s.hearth ? 0.45 : 0), 4.6, 4.6] as const), GLOW_Y);
    this.floorMat = new THREE.MeshBasicMaterial({ map: softTexture(0.2), color: 0xff7a2a, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
    this.objects.push(new THREE.Mesh(floor, this.floorMat));

    this.sparks = new Puffs(spots.length * SPARKS, glowTex, true);
    this.sparks.color.set('#ffb44a');
    this.objects.push(this.sparks.points);
  }

  /**
   * `levels`: how big each fire burns, in the order of the spots (fireLevel): 1 well fed, more when
   * full, a little for embers, 0 out. Left out, every fire burns as it always did.
   */
  update(t: number, levels?: readonly number[]) {
    const { o } = this;
    let most = 0;
    this.spots.forEach((s, f) => {
      const level = levels?.[f] ?? 1;
      most = Math.max(most, level);
      FLAMES.forEach(([fx, fz, r, h], k) => {
        const w = t * (5.1 + k * 0.83) + s.ph + k * 1.7;
        const tall = 0.8 + 0.13 * Math.sin(w) + 0.08 * Math.sin(w * 2.3 + 1.1) + 0.05 * Math.sin(t * 17 + k + s.ph);
        o.position.set(s.x + fx + 0.012 * Math.sin(w * 1.3), s.y, s.z + fz);
        o.rotation.set(0.1 * Math.sin(w * 0.7), t * 0.9 + k, 0.13 * Math.sin(w * 0.9 + 0.5));
        // Low, the small bright flames in front go first; out, none stand at all.
        const size = level <= 0 ? 0 : Math.min(1.2, level * (k > 2 ? 1 : 1.15));
        o.scale.set(r * (0.92 + 0.08 * Math.sin(w * 1.7)) * Math.max(0.001, size), h * tall * Math.max(0.001, size), r * (0.92 + 0.08 * Math.cos(w * 1.5)) * Math.max(0.001, size));
        o.updateMatrix();
        this.flames.setMatrixAt(f * FLAMES.length + k, o.matrix);
      });
      const g = this.glows[f]!;
      g.scale.setScalar(1.25 * Math.min(1.2, level));
      g.visible = level > 0;
      for (let k = 0; k < SPARKS; k++) {
        const a = ((t + s.ph) / SPARK_S + k / SPARKS) % 1, seed = Math.floor((t + s.ph) / SPARK_S + k / SPARKS) * 7 + k;
        const drift = Math.sin(seed * 12.9898) * 0.12;
        this.sparks.set(f * SPARKS + k, s.x + drift * a + Math.sin(a * 9 + k) * 0.03, s.y + 0.15 + a * 0.85 * Math.min(1, level), s.z + Math.cos(seed) * 0.05 * a, 0.07 * (1 - a * 0.6), Math.min(1, a * 8) * (1 - a) ** 2 * Math.min(1, level));
      }
    });
    this.flames.instanceMatrix.needsUpdate = true;
    this.sparks.commit();
    const k = flicker(t, 0);
    this.glowMat.opacity = 0.42 * k;
    this.floorMat.opacity = 0.2 * (0.9 + 0.1 * k) * Math.min(1, most);
    this.embers.color.copy(this.cool).lerp(this.hot, 0.55 + 0.3 * Math.sin(t * 1.9) + 0.15 * Math.sin(t * 5.3));
    // Dead coals: the embers go dark, with the faintest pulse left.
    if (most <= 0) this.embers.color.copy(this.dead).lerp(this.cool, 0.08 + 0.05 * Math.sin(t * 0.7));
    else if (most < 0.5) this.embers.color.lerp(this.dead, 0.35);
  }
}

/** Puffs per chimney, and the seconds each takes to rise and fade. */
const PUFFS = 7;
const PUFF_S = 5.5;

/** A thin wisp of smoke from each chimney: grey puffs that rise, drift with the wind, grow and fade. */
export class Smoke {
  readonly puffs: Puffs;

  constructor(private readonly tops: THREE.Vector3[]) {
    this.puffs = new Puffs(tops.length * PUFFS, softTexture(0.5), false);
  }

  update(t: number) {
    this.tops.forEach((top, c) => {
      for (let k = 0; k < PUFFS; k++) {
        const a = (t / PUFF_S + k / PUFFS + c * 0.37) % 1;
        const sway = Math.sin(t * 0.8 + k * 2.1 + c) * 0.06 * a;
        this.puffs.set(c * PUFFS + k, top.x + a * 0.55 + sway, top.y + a * 1.5, top.z - a * 0.2, 0.16 + a * 0.6, Math.min(1, a * 7) * (1 - a) ** 1.5 * 0.4);
      }
    });
    this.puffs.commit();
  }
}

/**
 * How big a fire burns, from the seconds of fuel it has (null: tended): a well-fed one a little
 * bigger the fuller it is, a low one small, a dead one not at all.
 */
export function fireLevel(left: number | null | undefined): number {
  if (left === null || left === undefined) return 1;
  if (left <= 0) return 0;
  if (left < FIRE_LOW_S) return 0.35 + 0.2 * (left / FIRE_LOW_S);
  return 0.8 + 0.3 * Math.min(1, left / FIRE_MAX_S);
}
