/**
 * Draws one map with three.js: tile terrain with ledges, forest, town props, weather and the
 * characters. Everything comes from the map data; this file only decides how it looks.
 *
 * The WebGL renderer lives for the whole visit (createRenderer); a WorldView is built for one map
 * and disposed when you leave it, which frees what it put on the GPU. Big maps stay fast on
 * phones: trees and ferns are drawn in blocks the camera skips when they are off screen, and only
 * the few lamps nearest you carry a real light.
 */
import * as THREE from 'three';
import { DIR_VEC, type Dir, type MapObject, type TileKind, type TileMap, type Weather } from '@napoland/shared';
import { makeNpc, makePlayer, type Rig } from './characters';
import { OUTLINE_INSTANCED, box, disposeTree, flat, hash2, mulberry32, ownToon, part, softTexture, toon } from './toon';

export interface Avatar {
  id: string;
  /** Tile coordinates; whole numbers when standing, fractions while walking. */
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  /** Walk cycle phase (radians). */
  phase: number;
  color: string;
  /** Seconds left of the turn-in-place shuffle. */
  turnT: number;
}

/** three.js lights are physically based; the preview's values were tuned for the old units. */
const L = Math.PI;
const FACE: Record<Dir, number> = { down: 0, up: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 };
/**
 * Trees and ferns are drawn in blocks of this many tiles a side. Each block is one mesh with its
 * own bounds, so the camera skips the blocks it cannot see (the woods hold thousands of trees).
 * Measured in the Near Woods: blocks of 16 draw up to 187K triangles in about 90 draw calls,
 * blocks of 8 at most 111K in about 125; the blocks share their materials, so the calls are cheap.
 */
const CHUNK = 8;
/**
 * How many lamps carry a real light at once: the ones nearest you. Every light costs on every
 * pixel, so the rest glow through their material alone. Keeping the number fixed also means
 * switching maps never recompiles the shaders.
 */
const LAMP_LIGHTS = 4;
/** Seconds a lamp's light takes to come on when it becomes one of the nearest. */
const LAMP_FADE_S = 0.35;
/** The forest goes on this many tiles outside the map, so its edge never shows. */
const RING = 4;
/** Poles farther apart than this belong to different lines: no wire between them. */
const MAX_WIRE = 10;
/** One patch of mist for about this many tiles. */
const MIST_TILES = 190;

/** The one WebGL context for the whole visit: phones allow few, and making one is slow. Views for each map share it. */
export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  return new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
}

/** A tree's three cones: radius, height, height of the center, color. */
const TREE_LAYERS = [
  [0.52, 0.72, 0.6, '#22372a'],
  [0.42, 0.64, 0.98, '#263d2e'],
  [0.3, 0.56, 1.34, '#2b4533'],
] as const;
const TREE_TRUNK = '#3b2c22';
/** Mean lightness of the cone colors; each tree is drawn lighter or darker around it. */
const TREE_L = TREE_LAYERS.reduce((sum, l) => sum + new THREE.Color(l[3]).getHSL({ h: 0, s: 0, l: 0 }).l, 0) / TREE_LAYERS.length;
/** A tree's color factor: its lightness moved by up to 0.025 either way, the spread trees always had. */
const treeShade = (v: number) => Math.max(0, (TREE_L + (v - 0.5) * 0.05) / TREE_L);

/**
 * A whole tree as one geometry (trunk and three cones, colored per vertex), so each tree is one
 * instance instead of four. Each cone is turned a little so the facets do not line up. With
 * `outline` it is the dark shell instead: the cones a little bigger, drawn from behind.
 * The body has no caps: from a camera that always looks down, a cone's bottom faces away and the
 * trunk's ends hide in the ground and the lowest cone, and thousands of trees add up. The shell
 * keeps its caps, which draw the dark line under each tier.
 */
function treeGeometry(outline: boolean): THREE.BufferGeometry {
  const parts: Array<[THREE.BufferGeometry, THREE.Color | null]> = [];
  if (!outline) {
    const trunk = flat(new THREE.CylinderGeometry(0.06, 0.1, 0.6, 6, 1, true));
    trunk.translate(0, 0.3, 0);
    parts.push([trunk, new THREE.Color(TREE_TRUNK)]);
  }
  TREE_LAYERS.forEach(([r, h, y, color], k) => {
    const g = flat(new THREE.ConeGeometry(r, h, 7, 1, !outline));
    if (outline) g.scale(1.07, 1.07, 1.07);
    g.rotateY(k);
    g.translate(0, y, 0);
    parts.push([g, outline ? null : new THREE.Color(color)]);
  });
  return merge(parts);
}

/** Joins non-indexed geometries into one, with one vertex color per part (or no colors). */
function merge(parts: Array<[THREE.BufferGeometry, THREE.Color | null]>): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  for (const [g, c] of parts) {
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      if (c) col.push(c.r, c.g, c.b);
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (col.length) out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

/** Groups things with a tile position into CHUNK x CHUNK blocks, keeping their order within a block. */
function blocks<T extends { x: number; y: number }>(items: T[]): T[][] {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const key = `${Math.floor(it.x / CHUNK)},${Math.floor(it.y / CHUNK)}`;
    let b = out.get(key);
    if (!b) out.set(key, (b = []));
    b.push(it);
  }
  return [...out.values()];
}

interface Lamp {
  /** Where its light hangs (world units). */
  x: number;
  z: number;
  flicker: boolean;
  ph: number;
}

export class WorldView {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
  private terrain!: THREE.Mesh;
  private width = 1;
  private height = 1;
  private dist = 24;
  private weather: Weather = 'rain';
  private readonly pitch = THREE.MathUtils.degToRad(62);
  private rigs = new Map<string, { rig: Rig; color: string; shadow: THREE.Mesh }>();
  private animate: Array<(t: number, dt: number) => void> = [];
  private hemi = new THREE.HemisphereLight(0xa3b3bb, 0x1d2620, 0.55 * L);
  private sun = new THREE.DirectionalLight(0xc9d4d8, 0.36 * L);
  private flash = new THREE.SpotLight(0xfff0d0, 0, 10, 0.5, 0.6, 1.3);
  private flashTarget = new THREE.Object3D();
  private lamps: Lamp[] = [];
  /** The real lamp lights, each on one of the nearest lamps (index into `lamps`, -1 for none). */
  private lampSlots = Array.from({ length: LAMP_LIGHTS }, () => ({ light: new THREE.PointLight(0xff9a3c, 0, 7, 2), lamp: -1, on: 0 }));
  /** The tile the lamp lights were last placed for. */
  private lampTile = NaN;
  private lampMat = ownToon('#ffcf8a', { emissive: 0x000000 });
  private warm = ownToon('#3a2f25', { emissive: 0x8a5524 });
  private capMat = ownToon('#8ee8da', { emissive: 0x0e3b37 });
  private headMat = ownToon('#fff1c4', { emissive: 0x000000 });
  private tailMat = ownToon('#7a1c16', { emissive: 0x000000 });
  private headLight = new THREE.SpotLight(0xfff1c4, 0, 11, 0.5, 0.55, 1.4);
  private hasCar = false;
  private stoneLight = new THREE.PointLight(0xa66cff, 0, 7, 2);
  private hasStone = false;
  private rain!: THREE.LineSegments;
  private rainMat = new THREE.LineBasicMaterial({ color: 0xaebfcc, transparent: true, opacity: 0.38, depthWrite: false });
  private mistMat = new THREE.MeshBasicMaterial({ map: softTexture(0.5), color: 0xc9d6dc, transparent: true, opacity: 0.12, depthWrite: false });
  private wispMat = new THREE.SpriteMaterial({ map: softTexture(0.25), color: 0x9ef6ff, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
  private wisps: Array<{ s: THREE.Sprite; core: THREE.Mesh; x: number; y: number; ph: number; r: number }> = [];
  private marker: THREE.Mesh;
  private shadowGeo = new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2);
  private shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  /** Tiles outside the map in front of an exit on its edge: no outer forest there, and the exit's ground goes on. */
  private openings = new Map<string, { kind: TileKind; k: number }>();
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private tmp = new THREE.Vector3();

  constructor(private readonly renderer: THREE.WebGLRenderer, readonly map: TileMap) {
    this.scene.background = new THREE.Color('#4c5961');
    this.scene.fog = new THREE.Fog('#4c5961', 30, 50);
    this.sun.position.set(-4, 10, 6);
    this.scene.add(this.hemi, this.sun, this.flash, this.flashTarget, this.headLight, this.stoneLight);
    for (const s of this.lampSlots) this.scene.add(s.light);
    this.flash.target = this.flashTarget;
    this.findOpenings();
    this.buildTerrain();
    this.buildNature();
    this.buildTown();
    this.buildEffects();
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.52, 0.66, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe9e6de, transparent: true, opacity: 0.9, depthWrite: false }));
    this.marker.visible = false;
    this.scene.add(this.marker);
    this.setWeather('rain');
    // Compile the shaders now (behind the black screen), not on the first frame you see.
    this.renderer.compile(this.scene, this.camera);
  }

  /** Frees everything this view put on the GPU. The renderer and the shared toon materials stay for the next map. */
  dispose() {
    disposeTree(this.scene);
    this.scene.clear();
    this.rigs.clear();
    this.animate = [];
    this.wisps = [];
  }

  /** Height of the ground a character stands on. */
  private topY(x: number, y: number): number {
    return this.map.level(x, y) * 0.55 + (this.map.kind(x, y) === 'water' ? -0.34 : 0);
  }
  private groundAt(x: number, y: number): number {
    return Math.max(0, this.topY(Math.floor(x), Math.floor(y)));
  }

  private findOpenings() {
    const { map } = this, W = map.width, H = map.height;
    for (const e of map.data.exits) for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) {
      const kind = map.kind(x, y);
      if (!kind) continue;
      const out: Array<[number, number]> = [];
      if (y === 0) out.push([0, -1]);
      if (y === H - 1) out.push([0, 1]);
      if (x === 0) out.push([-1, 0]);
      if (x === W - 1) out.push([1, 0]);
      for (const [dx, dy] of out) for (let k = 1; k <= RING; k++) this.openings.set(`${x + dx * k},${y + dy * k}`, { kind, k });
    }
  }

  private buildTerrain() {
    const { map } = this;
    const pos: number[] = [], col: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[], color: THREE.Color) => {
      for (const p of [a, b, c, a, c, d]) { pos.push(p[0]!, p[1]!, p[2]!); col.push(color.r, color.g, color.b); }
    };
    const colors: Record<TileKind, [string, string]> = {
      grass: ['#3f5b3a', '#3a5637'], ferns: ['#2c4430', '#29402d'], road: ['#4b4e53', '#46494e'],
      lot: ['#5c5b57', '#565551'], mud: ['#554b3c', '#554b3c'], water: ['#152229', '#152229'],
      // Dark ground under the trees: little light gets through.
      forest: ['#1f2c21', '#1c291e'],
    };
    const ground = (kind: TileKind, tx: number, ty: number, raised: boolean) => {
      const chk = (tx + ty) & 1;
      const c = new THREE.Color(kind === 'grass' && raised ? (chk ? '#34503a' : '#314b36') : colors[kind][chk]);
      return c.offsetHSL(0, 0, (hash2(tx * 5, ty * 3) - 0.5) * 0.025);
    };
    for (let ty = 0; ty < map.height; ty++) for (let tx = 0; tx < map.width; tx++) {
      const kind = map.kind(tx, ty)!, y0 = this.topY(tx, ty), raised = map.level(tx, ty) > 0;
      quad([tx, y0, ty], [tx, y0, ty + 1], [tx + 1, y0, ty + 1], [tx + 1, y0, ty], ground(kind, tx, ty, raised));
      for (const [ox, oy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        const ny = map.inside(tx + ox, ty + oy) ? this.topY(tx + ox, ty + oy) : 0;
        if (ny >= y0 - 0.001) continue;
        const w = new THREE.Color(raised ? '#4f4336' : kind === 'mud' ? '#4a4034' : '#3f3529');
        w.offsetHSL(0, 0, (hash2(tx + ox * 7, ty + oy * 11) - 0.5) * 0.05);
        let a: [number, number], b: [number, number];
        if (oy === -1) { a = [tx, ty]; b = [tx + 1, ty]; } else if (oy === 1) { a = [tx + 1, ty + 1]; b = [tx, ty + 1]; }
        else if (ox === -1) { a = [tx, ty + 1]; b = [tx, ty]; } else { a = [tx + 1, ty]; b = [tx + 1, ty + 1]; }
        quad([a[0], y0, a[1]], [a[0], ny, a[1]], [b[0], ny, b[1]], [b[0], y0, b[1]], w);
      }
    }
    const W = map.width, H = map.height, outerColor = '#1b271d';
    // Where an exit leaves the map, its road or trail goes on outside and fades into the dark, so you can see the way on.
    const outer = new THREE.Color(outerColor);
    for (const [key, o] of this.openings) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      quad([x, 0, y], [x, 0, y + 1], [x + 1, 0, y + 1], [x + 1, 0, y], ground(o.kind, x, y, false).lerp(outer, o.k / (RING + 1)));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    this.terrain = new THREE.Mesh(g, ownToon(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));
    this.scene.add(this.terrain);
    const outerMat = toon(outerColor);
    for (const [x, z, w, d] of [[W / 2, -60, W + 260, 120], [W / 2, H + 60, W + 260, 120], [-60, H / 2, 120, H], [W + 60, H / 2, 120, H]] as const) {
      this.scene.add(part(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), outerMat, x, -0.01, z, false));
    }
    // Center lines on two-lane roads.
    const road = (x: number, y: number) => map.kind(x, y) === 'road';
    const dashes: Array<[number, number, boolean]> = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (road(x, y) && road(x + 1, y) && !road(x - 1, y) && !road(x + 2, y) && y % 2 === 0) dashes.push([x + 1, y + 0.5, true]);
      if (road(x, y) && road(x, y + 1) && !road(x, y - 1) && !road(x, y + 2) && x % 2 === 0) dashes.push([x + 0.5, y + 1, false]);
    }
    this.instanced(new THREE.BoxGeometry(0.5, 0.01, 0.07), dashes, ([x, y, vertical], o, c) => { o.position.set(x, 0.006, y); o.rotation.y = vertical ? Math.PI / 2 : 0; c.set('#9c8a4a'); });
    // The pond surface, gently moving.
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (map.kind(x, y) === 'water') { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (x1 >= 0) {
      const wg = new THREE.PlaneGeometry(x1 - x0 + 2.2, y1 - y0 + 2.2, 16, 10).rotateX(-Math.PI / 2);
      this.scene.add(part(wg, ownToon('#1d3a48', { transparent: true, opacity: 0.9 }), (x0 + x1 + 1) / 2, -0.1, (y0 + y1 + 1) / 2, false));
      const wpos = wg.attributes.position as THREE.BufferAttribute;
      this.animate.push(t => {
        for (let i = 0; i < wpos.count; i++) wpos.setY(i, Math.sin(t * 1.8 + wpos.getX(i) * 1.4 + wpos.getZ(i)) * 0.03);
        wpos.needsUpdate = true;
      });
    }
  }

  /**
   * One mesh with a copy of geo for each item, placed (and colored) by fn. Colors are per copy
   * unless a material is given without `colors`. An empty list adds nothing to the scene.
   */
  private instanced<T>(geo: THREE.BufferGeometry, list: T[], fn: (it: T, o: THREE.Object3D, c: THREE.Color, i: number) => void, mat?: THREE.Material, colors = !mat): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geo, mat ?? ownToon(0xffffff), list.length);
    const o = new THREE.Object3D(), c = new THREE.Color();
    list.forEach((it, i) => {
      o.position.set(0, 0, 0); o.rotation.order = 'XYZ'; o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1);
      fn(it, o, c, i);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (colors) m.setColorAt(i, c);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    // The bounds of all the copies: frustum culling uses them to skip a mesh that is off screen.
    m.computeBoundingSphere();
    if (list.length) this.scene.add(m);
    return m;
  }

  private objects<K extends MapObject['kind']>(kind: K): Array<Extract<MapObject, { kind: K }>> {
    return this.map.data.objects.filter((o): o is Extract<MapObject, { kind: K }> => o.kind === kind);
  }

  private buildNature() {
    const { map } = this, W = map.width, H = map.height;
    type Tree = { x: number; y: number; z: number; s: number; v: number };
    const trees: Tree[] = this.objects('tree').map(t => ({ x: t.x + 0.5 + (hash2(t.x, t.y) - 0.5) * 0.2, y: t.y + 0.5, z: this.groundAt(t.x, t.y), s: t.s, v: t.v }));
    // Forest tiles: one tree each, sized, turned and nudged by its position, so the woods look the same on every visit.
    for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
      if (map.kind(tx, ty) !== 'forest') continue;
      trees.push({
        x: tx + 0.5 + (hash2(tx * 7 + 1, ty * 3) - 0.5) * 0.24,
        y: ty + 0.5 + (hash2(tx * 3, ty * 7 + 1) - 0.5) * 0.24,
        z: this.groundAt(tx, ty),
        s: 1 + hash2(tx * 13, ty * 5 + 3) * 0.5,
        v: hash2(tx * 5 + 11, ty * 11),
      });
    }
    const rng = mulberry32(99);
    for (let y = -RING; y < H + RING; y++) for (let x = -RING; x < W + RING; x++) {
      if (map.inside(x, y) || rng() >= 0.92) continue;
      const t = { x: x + 0.5 + (rng() - 0.5) * 0.3, y: y + 0.5, z: 0, s: 1.1 + rng() * 0.5, v: rng() };
      if (!this.openings.has(`${x},${y}`)) trees.push(t);
    }
    const body = treeGeometry(false), shell = treeGeometry(true), bodyMat = ownToon(0xffffff, { vertexColors: true });
    const place = (t: Tree, o: THREE.Object3D) => { o.position.set(t.x, t.z, t.y); o.rotation.y = t.v * 6; o.scale.setScalar(t.s); };
    for (const block of blocks(trees)) {
      this.instanced(body, block, (t, o, c) => { place(t, o); c.setScalar(treeShade(t.v)); }, bodyMat, true);
      this.instanced(shell, block, place, OUTLINE_INSTANCED);
      this.instanced(this.shadowGeo, block, (t, o) => { o.position.set(t.x, t.z + 0.012, t.y); o.scale.setScalar(0.46 * t.s); }, this.shadowMat);
    }

    const rocks = this.objects('rock');
    const rockGeo = new THREE.DodecahedronGeometry(0.3, 0);
    const placeRock = (r: (typeof rocks)[number], o: THREE.Object3D) => { o.position.set(r.x + 0.5, this.groundAt(r.x, r.y) + 0.16 * r.s, r.y + 0.5); o.rotation.set(r.v * 3, r.v * 7, 0); o.scale.set(r.s * 1.1, r.s * 0.78, r.s); };
    this.instanced(rockGeo, rocks, (r, o, c) => { placeRock(r, o); c.set('#6d6f70'); c.offsetHSL(0, 0, (r.v - 0.5) * 0.06); });
    this.instanced(rockGeo, rocks, (r, o) => { placeRock(r, o); o.scale.multiplyScalar(1.1); }, OUTLINE_INSTANCED);

    // Ferns: where the creatures will live. They rustle when something walks through.
    const frondGeo = flat(new THREE.ConeGeometry(0.15, 0.52, 3));
    frondGeo.translate(0, 0.26, 0);
    type Frond = { x: number; y: number; r: number; tilt: number; k: number };
    const PER = 6;
    const fernTiles: Array<{ x: number; y: number; fronds: Frond[] }> = [];
    for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
      if (map.kind(tx, ty) !== 'ferns') continue;
      const fronds: Frond[] = [];
      for (let k = 0; k < PER; k++) {
        const cx = k < 3 ? 0.3 : 0.7, cy = k < 3 ? 0.35 : 0.72;
        fronds.push({ x: tx + cx + (hash2(tx * 3 + k, ty) - 0.5) * 0.12, y: ty + cy + (hash2(tx, ty * 3 + k) - 0.5) * 0.12, r: (k % 3) * 2.09 + hash2(tx + k, ty) * 0.8, tilt: 0.55 + hash2(tx * 7, ty + k) * 0.3, k });
      }
      fernTiles.push({ x: tx, y: ty, fronds });
    }
    const placeFrond = (b: Frond, o: THREE.Object3D, wob = 0) => { o.rotation.order = 'YXZ'; o.position.set(b.x, 0, b.y); o.rotation.set(b.tilt + wob, b.r, 0); o.scale.set(1, 1 - Math.abs(wob) * 0.4, 1); };
    const frondMat = ownToon(0xffffff);
    /** For each fern tile: its block's mesh and where its fronds start in it. */
    const frondAt = new Map<number, { mesh: THREE.InstancedMesh; start: number; fronds: Frond[] }>();
    for (const block of blocks(fernTiles)) {
      const mesh = this.instanced(frondGeo, block.flatMap(t => t.fronds), (b, o, c) => { placeFrond(b, o); c.set(['#2f4f33', '#39603d', '#2a4a30'][b.k % 3]!); }, frondMat, true);
      block.forEach((t, i) => frondAt.set(t.y * W + t.x, { mesh, start: i * PER, fronds: t.fronds }));
    }
    const rustle = new Map<number, number>(), bo = new THREE.Object3D();
    this.rustleAt = (x: number, y: number) => { const k = Math.floor(y) * W + Math.floor(x); if (frondAt.has(k)) rustle.set(k, 0.4); };
    this.animate.push((t, dt) => {
      for (const [k, left] of rustle) {
        const f = frondAt.get(k)!, nl = left - dt;
        for (let j = 0; j < PER; j++) {
          const wob = nl > 0 ? Math.sin(t * 24 + j * 1.7) * 0.3 * (nl / 0.4) : 0;
          placeFrond(f.fronds[j]!, bo, wob);
          bo.updateMatrix();
          f.mesh.setMatrixAt(f.start + j, bo.matrix);
        }
        f.mesh.instanceMatrix.needsUpdate = true;
        if (nl > 0) rustle.set(k, nl); else rustle.delete(k);
      }
    });

    const shrooms: Array<{ x: number; y: number; s: number }> = [];
    for (const o of this.objects('shrooms')) for (const [sx, sy] of [[0.3, 0.3], [0.7, 0.36], [0.34, 0.72], [0.72, 0.7]] as const) shrooms.push({ x: o.x + sx, y: o.y + sy, s: 0.8 + hash2(o.x * 5 + sx * 10, o.y) * 0.5 });
    this.instanced(flat(new THREE.CylinderGeometry(0.022, 0.03, 0.12, 5)), shrooms, (f, o, c) => { o.position.set(f.x, 0.06 * f.s, f.y); o.scale.setScalar(f.s); c.set('#d9d2c0'); });
    this.instanced(new THREE.IcosahedronGeometry(0.075, 0), shrooms, (f, o) => { o.position.set(f.x, 0.13 * f.s, f.y); o.scale.set(f.s, f.s * 0.55, f.s); }, this.capMat);
  }

  /** Set by buildNature: makes the ferns on a tile rustle. */
  private rustleAt: (x: number, y: number) => void = () => {};

  private buildTown() {
    const posts: Array<[number, number, number]> = [], rails: Array<[number, number, boolean, number]> = [];
    for (const f of this.objects('fence')) {
      if (f.dir === 'h') { posts.push([f.x + 0.2, f.y + 0.5, hash2(f.x, f.y)], [f.x + 0.8, f.y + 0.5, hash2(f.y, f.x)]); rails.push([f.x + 0.5, f.y + 0.5, false, 0.14], [f.x + 0.5, f.y + 0.5, false, 0.3]); }
      else { posts.push([f.x + 0.5, f.y + 0.2, hash2(f.x, f.y)], [f.x + 0.5, f.y + 0.8, hash2(f.y, f.x)]); rails.push([f.x + 0.5, f.y + 0.5, true, 0.14], [f.x + 0.5, f.y + 0.5, true, 0.3]); }
    }
    this.instanced(new THREE.BoxGeometry(0.09, 0.4, 0.09), posts, (p, o, c) => { o.position.set(p[0], 0.2, p[1]); o.rotation.z = (p[2] - 0.5) * 0.12; c.set('#4a3a2c'); });
    this.instanced(new THREE.BoxGeometry(1, 0.06, 0.05), rails, (r, o, c) => { o.position.set(r[0], r[3], r[1]); o.rotation.y = r[2] ? Math.PI / 2 : 0; c.set('#5a4634'); });

    for (const h of this.objects('house')) {
      const g = new THREE.Group();
      g.position.set(h.x + h.w / 2, 0, h.y + h.h / 2);
      g.add(box(2.8, 1.15, 1.7, '#5b4838', 0, 0.575, 0));
      for (const y of [0.33, 0.6, 0.87]) g.add(box(2.82, 0.03, 1.72, '#46372b', 0, y, 0, false));
      for (const [px, pz] of [[-1.38, -0.83], [1.38, -0.83], [-1.38, 0.83], [1.38, 0.83]] as const) g.add(box(0.12, 1.2, 0.12, '#34281f', px, 0.6, pz, false));
      g.add(box(3.34, 0.09, 2.36, new THREE.Color(h.roof).offsetHSL(0, 0, -0.1).getStyle(), 0, 1.19, 0));
      g.add(part(prism(3.3, 1.0, 2.3), toon(h.roof, { side: THREE.DoubleSide }), 0, 1.23, 0, 0.03));
      g.add(box(0.5, 0.78, 0.06, '#2e241c', 0, 0.39, 0.86));
      g.add(box(0.72, 0.08, 0.32, '#4f4a44', 0, 0.04, 1.02, false));
      // Someone lives in a lit house: a lamp over the door and one warm window. An unlit one is
      // abandoned: dark, windows boarded up.
      if (h.lit) g.add(part(new THREE.BoxGeometry(0.14, 0.1, 0.08), this.warm, 0, 0.95, 0.88, false));
      [-0.85, 0.85].forEach((wx, k) => {
        g.add(box(0.58, 0.5, 0.04, '#2a221b', wx, 0.72, 0.855, false));
        const lit = !!h.lit && k === 0;
        g.add(part(new THREE.BoxGeometry(0.46, 0.38, 0.05), lit ? this.warm : toon('#1c1f24'), wx, 0.72, 0.87, false));
        if (!lit) {
          const p1 = box(0.56, 0.07, 0.03, '#6b5a44', wx, 0.76, 0.9, false); p1.rotation.z = 0.35; g.add(p1);
          const p2 = box(0.56, 0.07, 0.03, '#6b5a44', wx, 0.66, 0.9, false); p2.rotation.z = -0.3; g.add(p2);
        }
      });
      g.add(box(0.28, 0.55, 0.28, '#58554f', 0.9, 1.95, -0.35));
      this.scene.add(g);
    }

    const barrelGeo = flat(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 8));
    for (const b of this.objects('barrel')) {
      const m = part(barrelGeo, '#6e3a26', b.x + 0.5, 0.25, b.y + 0.5, 0.025);
      m.rotation.y = hash2(b.x, b.y) * 3;
      this.scene.add(m, box(0.42, 0.03, 0.42, '#4b2819', b.x + 0.5, 0.38, b.y + 0.5, false));
    }

    for (const c of this.objects('car')) {
      const car = new THREE.Group();
      car.position.set(c.x + c.w / 2, 0, c.y + 0.5);
      car.rotation.y = Math.PI / 2;
      car.add(box(0.9, 0.36, 1.9, '#5f7470', 0, 0.34, 0), box(0.92, 0.12, 1.5, '#6b4a2e', 0, 0.34, -0.05, false));
      car.add(box(0.84, 0.34, 1.15, '#5f7470', 0, 0.68, -0.22));
      car.add(box(0.86, 0.22, 0.95, '#1a252c', 0, 0.7, -0.22, false), box(0.76, 0.2, 0.02, '#23313a', 0, 0.7, 0.36, false));
      car.add(box(0.7, 0.04, 0.9, '#2b2b2e', 0, 0.88, -0.22), box(0.5, 0.14, 0.6, '#3d3a34', 0, 0.97, -0.25));
      for (const [x, z] of [[-0.44, 0.6], [0.44, 0.6], [-0.44, -0.62], [0.44, -0.62]] as const) {
        const w = part(flat(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 10)), '#18181b', x, 0.17, z, 0.02);
        w.rotation.z = Math.PI / 2;
        car.add(w);
      }
      for (const x of [-0.28, 0.28]) car.add(part(new THREE.BoxGeometry(0.14, 0.08, 0.03), this.headMat, x, 0.4, 0.955, false), part(new THREE.BoxGeometry(0.12, 0.08, 0.03), this.tailMat, x, 0.42, -0.955, false));
      // One headlight (the last car's): it is already in the scene, and moving it here keeps the light count fixed.
      const target = new THREE.Object3D();
      target.position.set(0, 0, 6);
      this.headLight.position.set(0, 0.45, 1);
      this.headLight.target = target;
      car.add(this.headLight, target);
      this.hasCar = true;
      this.scene.add(car);
    }

    for (const s of this.objects('sign')) {
      const g = new THREE.Group();
      g.position.set(s.x + 0.5, 0, s.y + 0.5);
      g.add(box(0.08, 0.46, 0.08, '#4a3a2c', 0, 0.23, 0), box(0.56, 0.32, 0.07, '#6b5334', 0, 0.5, 0));
      g.add(box(0.4, 0.04, 0.01, '#2e241c', 0, 0.54, 0.04, false), box(0.3, 0.04, 0.01, '#2e241c', 0, 0.46, 0.04, false));
      this.scene.add(g);
    }
    this.objects('lamp').forEach((l, i) => {
      const g = new THREE.Group();
      g.position.set(l.x + 0.5, 0, l.y + 0.5);
      g.add(part(flat(new THREE.CylinderGeometry(0.045, 0.06, 1.3, 6)), '#2f343c', 0, 0.65, 0, 0.02));
      g.add(box(0.42, 0.05, 0.08, '#2f343c', 0.18, 1.3, 0), part(new THREE.BoxGeometry(0.2, 0.1, 0.16), this.lampMat, 0.34, 1.24, 0, 0.02));
      this.scene.add(g);
      // Every third lamp flickers, like the one by the lot in town always has.
      this.lamps.push({ x: l.x + 0.84, z: l.y + 0.5, flicker: i % 3 === 1, ph: hash2(l.x, l.y) * 6 });
    });
    // Utility poles with sagging wires, in the order the map lists them.
    const poles = this.objects('pole');
    const within = (p: (typeof poles)[number], q?: (typeof poles)[number]) => (q && Math.hypot(q.x - p.x, q.y - p.y) <= MAX_WIRE ? q : undefined);
    const tops = poles.map((p, i) => {
      const next = within(p, poles[i + 1]) ?? within(p, poles[i - 1]);
      const g = new THREE.Group();
      g.position.set(p.x + 0.5, 0, p.y + 0.5);
      if (next) g.rotation.y = Math.atan2(next.x - p.x, next.y - p.y) + Math.PI / 2;
      g.add(part(flat(new THREE.CylinderGeometry(0.06, 0.08, 2.3, 6)), '#4a3a2c', 0, 1.15, 0, 0.02), box(0.9, 0.06, 0.06, '#4a3a2c', 0, 2.1, 0));
      for (const o of [-0.38, 0.38]) g.add(box(0.05, 0.08, 0.05, '#8fa3a8', o, 2.17, 0, false));
      this.scene.add(g);
      g.updateMatrixWorld();
      return g;
    });
    const wire: THREE.Vector3[] = [];
    for (let i = 0; i < tops.length - 1; i++) {
      if (!within(poles[i]!, poles[i + 1])) continue;
      for (const o of [-0.38, 0.38]) {
        const a = new THREE.Vector3(o, 2.2, 0).applyMatrix4(tops[i]!.matrixWorld), b = new THREE.Vector3(o, 2.2, 0).applyMatrix4(tops[i + 1]!.matrixWorld);
        const mid = a.clone().lerp(b, 0.5);
        mid.y -= 0.35;
        wire.push(a, mid, mid, b);
      }
    }
    if (wire.length) this.scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wire), new THREE.LineBasicMaterial({ color: 0x0e1115 })));

    for (const st of this.objects('stone')) {
      const cx = st.x + 0.5, cz = st.y + 0.5;
      this.scene.add(part(flat(new THREE.CylinderGeometry(0.62, 0.7, 0.2, 8)), '#5e5a54', cx, 0.1, cz, 0.03));
      const crystal = part(new THREE.OctahedronGeometry(0.42, 0), ownToon('#8b5bd9', { emissive: 0x4a1a9c }), cx, 1.2, cz, 0.03);
      crystal.scale.set(0.8, 2, 0.8);
      this.scene.add(crystal);
      this.stoneLight.position.set(cx, 1.4, cz);
      this.hasStone = true;
      const debris = new THREE.Group();
      debris.position.set(cx, 0, cz);
      const r = mulberry32(77);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2, rock = part(new THREE.DodecahedronGeometry(0.1 + r() * 0.06, 0), '#5e5a54', Math.cos(a) * 1.05, 1.0 + r() * 0.9, Math.sin(a) * 1.05, 0.02);
        rock.userData = { y: rock.position.y, ph: r() * 6 };
        debris.add(rock);
      }
      this.scene.add(debris);
      this.animate.push(t => {
        crystal.rotation.y = t * 0.6;
        crystal.position.y = 1.2 + Math.sin(t * 1.5) * 0.07;
        debris.rotation.y = t * 0.35;
        for (const d of debris.children) d.position.y = d.userData.y + Math.sin(t * 1.4 + d.userData.ph) * 0.12;
      });
    }

    for (const n of this.objects('npc')) {
      const { root, bang } = makeNpc();
      root.position.set(n.x + 0.5, this.groundAt(n.x, n.y), n.y + 0.5);
      root.rotation.y = FACE[n.dir];
      this.scene.add(root, this.blob(0.3, n.x + 0.5, n.y + 0.5));
      this.animate.push(t => { bang.position.y = 1.18 + Math.sin(t * 3) * 0.05; bang.rotation.y = t * 1.5; });
    }
  }

  private buildEffects() {
    const { map } = this;
    const rng = mulberry32(4242);
    const spots: Array<[number, number]> = [];
    for (const st of this.objects('stone')) spots.push([st.x - 1.3, st.y + 1.7], [st.x + 2.4, st.y - 0.1]);
    const spawn = map.data.spawn;
    for (let tries = 0; spots.length < 10 && tries < 2000; tries++) {
      const x = Math.floor(rng() * map.width), y = Math.floor(rng() * map.height);
      if (!map.walkable(x, y) || Math.hypot(x - spawn.x, y - spawn.y) < 12) continue;
      spots.push([x + 0.5, y + 0.5]);
    }
    const coreGeo = new THREE.IcosahedronGeometry(0.06, 0), coreMat = new THREE.MeshBasicMaterial({ color: 0xe8feff });
    for (const [x, y] of spots) {
      const s = new THREE.Sprite(this.wispMat);
      s.scale.set(0.9, 0.9, 1);
      const core = new THREE.Mesh(coreGeo, coreMat);
      this.scene.add(s, core);
      this.wisps.push({ s, core, x, y, ph: rng() * 6, r: 0.4 + rng() * 0.6 });
    }
    this.animate.push(t => {
      for (const w of this.wisps) {
        const a = t * 0.7 + w.ph, x = w.x + Math.cos(a) * w.r, z = w.y + Math.sin(a * 1.3) * w.r, y = 0.9 + Math.sin(t * 2 + w.ph) * 0.25;
        w.s.position.set(x, y, z);
        w.core.position.set(x, y, z);
      }
    });
    const mists: THREE.Mesh[] = [], mistGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mistCount = Math.max(4, Math.round((map.width * map.height) / MIST_TILES));
    for (let i = 0; i < mistCount; i++) {
      const m = new THREE.Mesh(mistGeo, this.mistMat);
      const sc = 4 + rng() * 4;
      m.scale.set(sc, 1, sc);
      m.position.set(rng() * map.width, 0.35 + rng() * 0.5, rng() * map.height);
      m.userData.v = (rng() - 0.5) * 0.3;
      this.scene.add(m);
      mists.push(m);
    }
    this.animate.push((_t, dt) => {
      for (const m of mists) {
        m.position.x += m.userData.v * dt;
        if (m.position.x > map.width + 6) m.position.x = -6;
        if (m.position.x < -6) m.position.x = map.width + 6;
      }
    });
    const RAIN = 700, rainPos = new Float32Array(RAIN * 6);
    const drops = Array.from({ length: RAIN }, () => ({ x: rng() * 30 - 15, y: rng() * 12, z: rng() * 30 - 15, s: 9 + rng() * 4 }));
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    this.rain = new THREE.LineSegments(rainGeo, this.rainMat);
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
    this.animateRain = (focus, dt) => {
      if (!this.rain.visible) return;
      for (let i = 0; i < RAIN; i++) {
        const d = drops[i]!;
        d.y -= d.s * dt;
        if (d.y < 0) { d.y += 12; d.x = rng() * 30 - 15; d.z = rng() * 30 - 15; }
        const X = focus.x + d.x, Z = focus.y + d.z, o = i * 6;
        rainPos[o] = X; rainPos[o + 1] = d.y + 0.45; rainPos[o + 2] = Z;
        rainPos[o + 3] = X + 0.07; rainPos[o + 4] = d.y; rainPos[o + 5] = Z + 0.03;
      }
      (rainGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    };
  }
  private animateRain: (focus: { x: number; y: number }, dt: number) => void = () => {};

  private blob(r: number, x: number, z: number): THREE.Mesh {
    const m = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    m.scale.setScalar(r);
    m.position.set(x, 0.012, z);
    return m;
  }

  setWeather(w: Weather) {
    this.weather = w;
    const night = w === 'night', wet = w !== 'overcast';
    this.hemi.color.set(night ? '#2c3a58' : wet ? '#8494a0' : '#a3b3bb');
    this.hemi.groundColor.set(night ? '#07090c' : '#1a221d');
    this.hemi.intensity = (night ? 0.34 : wet ? 0.5 : 0.58) * L;
    this.sun.color.set(night ? '#7088b8' : '#c9d4d8');
    this.sun.intensity = (night ? 0.18 : wet ? 0.26 : 0.36) * L;
    const fog = night ? '#0a0f15' : wet ? '#465259' : '#5a676d';
    (this.scene.background as THREE.Color).set(fog);
    (this.scene.fog as THREE.Fog).color.set(fog);
    this.lampMat.emissive.set(night ? '#ffb266' : wet ? '#b3702e' : '#7a4f24');
    this.warm.emissive.set(night ? '#ffb45a' : '#8a5524');
    this.flash.intensity = night ? 1.6 * L : 0;
    this.headLight.intensity = night && this.hasCar ? 1.3 * L : 0;
    this.headMat.emissive.set(night ? '#fff1c4' : '#000000');
    this.tailMat.emissive.set(night ? '#c8281c' : '#000000');
    this.capMat.emissive.set(night ? '#2fb8a8' : '#0e3b37');
    this.rain.visible = wet;
    this.rainMat.color.set(night ? '#5f7fa0' : '#aebfcc');
    this.rainMat.opacity = night ? 0.3 : 0.38;
    this.mistMat.color.set(night ? '#4b5a66' : '#c9d6dc');
    this.mistMat.opacity = night ? 0.1 : 0.13;
    this.wispMat.opacity = night ? 0.95 : 0.55;
    this.updateFog();
  }

  private updateFog() {
    const night = this.weather === 'night', wet = this.weather !== 'overcast', d = this.dist, fog = this.scene.fog as THREE.Fog;
    fog.near = Math.max(1, d - 1.5);
    fog.far = d + (night ? Math.max(7, d * 0.25) : wet ? Math.max(10, d * 0.35) : Math.max(14, d * 0.45));
  }

  /** Size in CSS pixels. The camera keeps the same circle of world around the player on every screen shape. */
  resize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    if (this.height >= this.width) this.camera.setViewOffset(this.width, this.height, 0, Math.round(this.height * 0.08), this.width, this.height);
    else this.camera.clearViewOffset();
    this.dist = Math.min(56, Math.max(12, 6.2 / (Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * Math.min(1, this.camera.aspect))));
    this.camera.updateProjectionMatrix();
    this.updateFog();
  }

  /** Screen position (CSS px) of a point `lift` units above tile x,y. */
  project(x: number, y: number, lift = 0): { x: number; y: number } {
    this.tmp.set(x + 0.5, this.groundAt(x + 0.5, y + 0.5) + lift, y + 0.5).project(this.camera);
    return { x: ((this.tmp.x + 1) / 2) * this.width, y: ((1 - this.tmp.y) / 2) * this.height };
  }

  /** The tile under a screen position (CSS px), or null if the ground is not there. */
  toWorld(px: number, py: number): { x: number; y: number } | null {
    this.ndc.set((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit = this.ray.intersectObject(this.terrain, false)[0];
    return hit ? { x: Math.floor(hit.point.x), y: Math.floor(hit.point.z) } : null;
  }

  render(t: number, dt: number, focus: { x: number; y: number }, avatars: Avatar[], meId: string | null, marker: { x: number; y: number; t: number } | null) {
    const fx = focus.x + 0.5, fz = focus.y + 0.5, gy = this.groundAt(fx, fz);
    this.camera.position.set(fx, gy + Math.sin(this.pitch) * this.dist, fz + Math.cos(this.pitch) * this.dist);
    this.camera.lookAt(fx, gy + 0.4, fz);
    for (const a of this.animate) a(t, dt);
    this.animateRain({ x: fx, y: fz }, dt);
    this.syncAvatars(avatars, meId);
    this.lightLamps(fx, fz, t, dt);
    this.stoneLight.intensity = this.hasStone ? (this.weather === 'night' ? 2.4 : 1.2) * L * (0.85 + 0.15 * Math.sin(t * 3.1)) : 0;
    this.marker.visible = !!marker;
    if (marker) {
      this.marker.position.set(marker.x + 0.5, this.groundAt(marker.x + 0.5, marker.y + 0.5) + 0.02, marker.y + 0.5);
      (this.marker.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - marker.t / 0.8);
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Puts the real lamp lights on the lamps nearest the player (again whenever the player reaches a new tile). */
  private lightLamps(fx: number, fz: number, t: number, dt: number) {
    const tile = Math.floor(fz) * 65536 + Math.floor(fx);
    if (tile !== this.lampTile) {
      this.lampTile = tile;
      const d2 = (i: number) => (this.lamps[i]!.x - fx) ** 2 + (this.lamps[i]!.z - fz) ** 2;
      const near = this.lamps.map((_, i) => i).sort((a, b) => d2(a) - d2(b)).slice(0, LAMP_LIGHTS);
      // A light already on a lamp that is still near stays where it is, so it does not blink.
      const free = this.lampSlots.filter(s => !near.includes(s.lamp));
      for (const i of near) {
        if (this.lampSlots.some(s => s.lamp === i)) continue;
        const s = free.pop()!;
        s.lamp = i;
        s.on = 0;
        s.light.position.set(this.lamps[i]!.x, 1.1, this.lamps[i]!.z);
      }
      for (const s of free) s.lamp = -1;
    }
    const base = (this.weather === 'night' ? 1.8 : this.weather === 'rain' ? 0.9 : 0.5) * L;
    for (const s of this.lampSlots) {
      const lamp = this.lamps[s.lamp];
      if (!lamp) { s.light.intensity = 0; continue; }
      s.on = Math.min(1, s.on + dt / LAMP_FADE_S);
      const flicker = lamp.flicker && (Math.sin(t * 13 + lamp.ph) > 0.92 || Math.sin(t * 2.3 + lamp.ph) > 0.97) ? 0.15 : 1;
      s.light.intensity = base * flicker * s.on;
    }
  }

  private syncAvatars(avatars: Avatar[], meId: string | null) {
    const seen = new Set<string>();
    for (const a of avatars) {
      seen.add(a.id);
      let e = this.rigs.get(a.id);
      if (!e || e.color !== a.color) {
        if (e) this.dropRig(e);
        e = { rig: makePlayer(a.color), color: a.color, shadow: this.blob(0.3, 0, 0) };
        this.scene.add(e.rig.root, e.shadow);
        this.rigs.set(a.id, e);
      }
      const x = a.x + 0.5, z = a.y + 0.5, gy = this.groundAt(x, z), { rig } = e;
      rig.root.position.set(x, gy + (a.moving ? Math.abs(Math.sin(a.phase)) * 0.045 : 0), z);
      rig.root.rotation.y = FACE[a.dir];
      e.shadow.position.set(x, gy + 0.012, z);
      const sw = a.moving ? Math.sin(a.phase) * 0.95 : a.turnT > 0 ? Math.sin((1 - a.turnT / 0.14) * Math.PI) * 0.45 : 0;
      rig.legL.rotation.x = sw; rig.legR.rotation.x = -sw;
      rig.armL.rotation.x = -sw * 0.7; rig.armR.rotation.x = sw * 0.7;
      if (a.moving) this.rustleAt(x, z);
      if (a.id === meId && this.weather === 'night') {
        const [dx, dy] = DIR_VEC[a.dir];
        this.flash.position.set(x + dx * 0.2, gy + 0.75, z + dy * 0.2);
        this.flashTarget.position.set(x + dx * 4, gy, z + dy * 4);
        this.flashTarget.updateMatrixWorld();
      }
    }
    for (const [id, e] of this.rigs) if (!seen.has(id)) { this.dropRig(e); this.rigs.delete(id); }
  }

  /** A player left: free their model. The blob shadow's geometry and material are shared by every blob, so they stay. */
  private dropRig(e: { rig: Rig; shadow: THREE.Mesh }) {
    this.scene.remove(e.rig.root, e.shadow);
    disposeTree(e.rig.root);
  }
}

/** A gable roof: a triangular prism, ridge along x. */
function prism(w: number, h: number, d: number): THREE.BufferGeometry {
  const hw = w / 2, hd = d / 2;
  const A = [-hw, 0, -hd], B = [-hw, 0, hd], C = [-hw, h, 0], D = [hw, 0, -hd], E = [hw, 0, hd], F = [hw, h, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([A, B, C, D, F, E, B, E, F, B, F, C, A, C, F, A, F, D].flat(), 3));
  g.computeVertexNormals();
  return g;
}
