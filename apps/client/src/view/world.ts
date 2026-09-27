/**
 * Draws one map with three.js: tile terrain with ledges, forest, town props, the insides of
 * buildings, fires, weather, the characters, and the finds and piles lying around (loot.ts).
 * Everything comes from the map data and the server's lists; this file only decides how it looks.
 *
 * The WebGL renderer lives for the whole visit (createRenderer); a WorldView is built for one map
 * and disposed when you leave it, which frees what it put on the GPU. Big maps stay fast on
 * phones: trees and ferns are drawn in blocks the camera skips when they are off screen, the
 * props that never move (houses and NAPO's buildings, cars, signs, lamps, poles, masts, barrels,
 * fences, furniture, hearths; napo.ts draws NAPO's) are joined into a few meshes, and only the few
 * lamps and fires nearest you carry a real light.
 * Inside a building (a map of kind 'inside') there is no weather and no world around the room, only
 * black: see interior.ts for the room, fire.ts for the fire and lighting.ts for the light.
 */
import * as THREE from 'three';
import { DIR_VEC, type Dir, type DropView, type FindView, type FlashView, type MapData, type MapObject, type MarkView, type TileKind, type TileMap, type Weather } from '@napoland/shared';
import { LiveGlows, makeNpc, makePlayer, type Look, type Rig } from './characters';
import { Fires, GLOW_Y, Smoke, campfireModel, flicker, hearthModel, type Puffs } from './fire';
import { Creatures, Echoes, Flares, Flashes, Marks, Prints, boardModel, hitchhikerModel, stoneCrystal } from './wilds';
import {
  doorwayModel, doorways, floorTile, furnitureModel, furnitureShadows, hasFire, hearthAt, houseDoors, roomTone, wallShapes, wallTile, windowModel, windowSpots,
  type QuadFn, type WallShape,
} from './interior';
import { ambience, assignLights, lightSources, type Ambience, type LightSource } from './lighting';
import { Loot, lootGlow } from './loot';
import { napoBuilding, napoSign, towerModel } from './napo';
import { OUTLINE_INSTANCED, bake, box, disposeTree, flat, glowQuads, hash2, merge, mulberry32, ownToon, part, softTexture, toon } from './toon';

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
  /** Something clings to their back (only ever told about yourself). */
  hitched?: boolean;
  /** They carry a live find: a column of light over them. */
  live?: boolean;
  /** What they wear (characters.ts). */
  look?: Look;
}

/** A creature as the game draws it: a watcher or a skulker, and whom it chases (if anyone). */
export interface CreatureAvatar {
  id: string;
  kind: 'watcher' | 'skulker';
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  chasing: string | undefined;
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
 * How many real point lights the lamps and fires share: the ones nearest you. Every light costs on
 * every pixel, so the rest glow through their material alone. Keeping the number fixed also means
 * switching maps never recompiles the shaders.
 */
const LIGHTS = 4;
/** Seconds a light takes to come on when its lamp or fire becomes one of the nearest. */
const LIGHT_FADE_S = 0.35;
const LAMP_COLOR = 0xff9a3c;
const LAMP_REACH = 7;
/** A fire's light is redder than a lamp's, and as strong whatever the weather: it is always burning. */
const FIRE_COLOR = 0xff8438;
const FIRE_REACH = 10;
const FIRE_LIGHT = 2.6;
/** A flare's light: red, and strong while it burns. It is a light of its own, always in the scene (off when no flare burns). */
const FLARE_COLOR = 0xff3a28;
const FLARE_LIGHT = 3.2;
/** Where a surge washes the sky and the light. */
const SURGE_SKY = new THREE.Color('#2b1152');
const SURGE_HEMI = new THREE.Color('#9a6ae0');
/** A storm darkens the sky, and its lightning lights everything for a blink now and then. */
const STORM_SKY = new THREE.Color('#1b2126');
/** Is the lightning blinking at `t` seconds? Every several seconds, never on a fixed beat; the thunder follows it (sound.ts). */
export const lightningAt = (t: number) => Math.sin(t * 0.71) * Math.sin(t * 1.93) > 0.93;
/** The forest goes on this many tiles outside the map, so its edge never shows. */
const RING = 4;
/** Poles farther apart than this belong to different lines: no wire between them. */
const MAX_WIRE = 10;
/** One patch of mist for about this many tiles. */
const MIST_TILES = 190;
/** Blob shadows and the tap marker lie just above rugs (whose tops are at most 0.026), which lie on the floor. */
const BLOB_Y = 0.036;
/** A house's doorway: its width and height, and how deep it goes in (the front wall's thickness). */
const DOOR_W = 0.6;
const DOOR_H = 0.84;
const DOOR_BACK = 0.2;

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

export class WorldView {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
  private terrain!: THREE.Mesh;
  private width = 1;
  private height = 1;
  private dist = 24;
  private weather: Weather = 'rain';
  /** A town or the wilds (weather, the forest around, mist); false inside a building. */
  private readonly outdoors: boolean;
  /** An inside with a fire: warm and dim. One without is dark and cold. */
  private readonly warmRoom: boolean;
  /** How this place looks in the current weather (lighting.ts). */
  private amb: Ambience;
  private readonly pitch = THREE.MathUtils.degToRad(62);
  private rigs = new Map<string, { rig: Rig; color: string; look: string; shadow: THREE.Mesh; hitch?: THREE.Group }>();
  private animate: Array<(t: number, dt: number) => void> = [];
  private hemi = new THREE.HemisphereLight(0xa3b3bb, 0x1d2620, 0.55 * L);
  private sun = new THREE.DirectionalLight(0xc9d4d8, 0.36 * L);
  private flash = new THREE.SpotLight(0xfff0d0, 0, 10, 0.5, 0.6, 1.3);
  private flashTarget = new THREE.Object3D();
  /** Lamps and fires: what may carry one of the real lights. */
  private sources: LightSource[] = [];
  /** The real lights, each on one of the nearest sources (index into `sources`, -1 for none). */
  private slots = Array.from({ length: LIGHTS }, () => ({ light: new THREE.PointLight(LAMP_COLOR, 0, LAMP_REACH, 2), source: -1, on: 0 }));
  /** The tile the lights were last handed out for. */
  private lightTile = NaN;
  private lampMat = ownToon('#ffcf8a', { emissive: 0x000000 });
  private warm = ownToon('#3a2f25', { emissive: 0x8a5524 });
  /** Seen through an open door: the inside of a house whose fire is burning (a dark house has a plain black one). */
  private doorGlow = ownToon('#3a2f25', { emissive: 0x8a5524, side: THREE.BackSide });
  /** Window panes seen from inside: the light outside. */
  private paneMat = ownToon('#1b2330', { emissive: 0x6a8393 });
  /** The light from the windows and the doorway on an inside's floor. */
  private skyLight: THREE.MeshBasicMaterial | null = null;
  private capMat = ownToon('#8ee8da', { emissive: 0x0e3b37 });
  private headMat = ownToon('#fff1c4', { emissive: 0x000000 });
  private tailMat = ownToon('#7a1c16', { emissive: 0x000000 });
  private headLight = new THREE.SpotLight(0xfff1c4, 0, 11, 0.5, 0.55, 1.4);
  /** The light on top of the Tower (and any mast like it): it blinks red, day and night. */
  private beaconMat = ownToon('#4a1410', { emissive: 0x000000 });
  private hasCar = false;
  private stoneLight = new THREE.PointLight(0xa66cff, 0, 7, 2);
  private hasStone = false;
  /** Rain, mist and wisps: only outdoors. */
  private rain: THREE.LineSegments | null = null;
  private rainMat = new THREE.LineBasicMaterial({ color: 0xaebfcc, transparent: true, opacity: 0.38, depthWrite: false });
  private mistMat = new THREE.MeshBasicMaterial({ map: softTexture(0.5), color: 0xc9d6dc, transparent: true, opacity: 0.12, depthWrite: false });
  private wispMat = new THREE.SpriteMaterial({ map: softTexture(0.25), color: 0x9ef6ff, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
  private wisps: Array<{ s: THREE.Sprite; core: THREE.Mesh; x: number; y: number; ph: number; r: number }> = [];
  /** Chimney smoke, and every set of puffs (smoke, sparks), which need the screen's scale. */
  private smoke: Smoke | null = null;
  private puffs: Puffs[] = [];
  /** Finds and piles: they come and go, so they are drawn apart from the map (loot.ts). */
  private loot = new Loot();
  /** What comes and goes out there (wilds.ts): marks, creatures, flares, echoes. */
  private marks = new Marks();
  private creatures: Creatures;
  private flares = new Flares();
  private liveGlows = new LiveGlows();
  private prints = new Prints();
  /** Where someone walks whose gear makes street lights flicker (tiles). */
  private flickerAt: Array<{ x: number; y: number }> = [];
  private flashes = new Flashes();
  private echoes = new Echoes();
  private creatureList: CreatureAvatar[] = [];
  private flareLight = new THREE.PointLight(FLARE_COLOR, 0, 9, 2);
  /** The fires of this map: their tiles in the order Fires draws them, how big each burns, and where the game says so. */
  private fireTiles: Array<[number, number]> = [];
  private fireLevels: number[] = [];
  private fireLevel: (x: number, y: number) => number = () => 1;
  /** The old power lines, which hum and glow on aurora nights. */
  private wireMat = new THREE.LineBasicMaterial({ color: 0x0e1115 });
  /** The Old Stone's crystal, brighter while it is awake. */
  private crystalMat = stoneCrystal();
  private stoneAwake = false;
  /** How much a surge washes this map now, 0 to 1. */
  private surgeK = 0;
  /** A storm blows over this map (outdoors). */
  private storm = false;
  /** A condition's fog: tiles you see past yourself. */
  private fogCap: number | undefined;
  private marker: THREE.Mesh;
  private shadowGeo = new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2);
  private shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  /** Tiles outside the map in front of an exit on its edge: no outer forest there, and the exit's ground goes on. */
  private openings = new Map<string, { kind: TileKind; k: number }>();
  /** How each wall tile is drawn (interior.ts). */
  private shapes: WallShape[] = [];
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector2();

  /** `peek` finds another map's data by id: a house smokes when the room behind its door keeps a fire. */
  constructor(private readonly renderer: THREE.WebGLRenderer, readonly map: TileMap, private readonly peek: (id: string) => MapData | undefined = () => undefined) {
    this.outdoors = map.data.kind !== 'inside';
    this.warmRoom = !this.outdoors && hasFire(map.data);
    this.amb = ambience(map.data.kind, this.weather, this.warmRoom);
    this.scene.background = new THREE.Color('#4c5961');
    // Inside too, only pushed out of reach: a scene with fog and one without would need different shaders.
    this.scene.fog = new THREE.Fog('#4c5961', 30, 50);
    this.sun.position.set(-4, 10, 6);
    this.scene.add(this.hemi, this.sun, this.flash, this.flashTarget, this.headLight, this.stoneLight, this.flareLight);
    this.creatures = new Creatures(this.shadowGeo, this.shadowMat);
    for (const s of this.slots) this.scene.add(s.light);
    this.flash.target = this.flashTarget;
    if (this.outdoors) this.findOpenings();
    // What never moves or changes is built from hundreds of little boxes; it is drawn as a few meshes (see bake).
    const still: THREE.Object3D[] = [];
    this.buildTerrain(still);
    this.buildNature();
    this.buildTown(still);
    this.buildRoom(still);
    for (const m of bake(still)) this.scene.add(m);
    if (this.outdoors) this.buildEffects();
    this.scene.add(this.liveGlows.root, this.loot.root, this.marks.root, this.creatures.root, this.flares.root, this.flashes.root, this.prints.root, this.echoes.root);
    this.puffs.push(this.flares.sparks);
    this.animate.push(t => this.loot.update(t));
    this.animate.push(t => { this.marks.update(t); this.flares.update(t); this.flashes.update(t); });
    // Before the fires draw: how big each burns now.
    this.animate.unshift(() => { this.fireTiles.forEach(([x, y], i) => { this.fireLevels[i] = this.fireLevel(x, y); }); });
    this.sources = lightSources(map);
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.52, 0.66, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe9e6de, transparent: true, opacity: 0.9, depthWrite: false }));
    this.marker.visible = false;
    this.scene.add(this.marker);
    this.setWeather('rain');
    // Compile the shaders now (behind the black screen), not on the first frame you see.
    this.renderer.compile(this.scene, this.camera);
  }

  /** Frees everything this view put on the GPU. The renderer and the shared toon materials stay for the next map. */
  dispose() {
    for (const p of this.puffs) p.dispose();
    this.loot.dispose();
    this.marks.dispose();
    this.creatures.dispose();
    this.flares.dispose();
    this.liveGlows.dispose();
    this.prints.dispose();
    this.flashes.dispose();
    this.echoes.dispose();
    disposeTree(this.scene);
    this.scene.clear();
    this.rigs.clear();
    this.animate = [];
    this.wisps = [];
    this.puffs = [];
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

  private buildTerrain(still: THREE.Object3D[]) {
    const { map } = this;
    const pos: number[] = [], col: number[] = [];
    const quad: QuadFn = (a, b, c, d, ca, cb = ca, cc = ca, cd = ca) => {
      const corners = [a, b, c, a, c, d], colors = [ca, cb, cc, ca, cc, cd];
      for (let i = 0; i < 6; i++) { const p = corners[i]!, k = colors[i]!; pos.push(p[0], p[1], p[2]); col.push(k.r, k.g, k.b); }
    };
    const colors: Record<TileKind, [string, string]> = {
      grass: ['#3f5b3a', '#3a5637'], ferns: ['#2c4430', '#29402d'], road: ['#4b4e53', '#46494e'],
      lot: ['#5c5b57', '#565551'], mud: ['#554b3c', '#554b3c'], water: ['#152229', '#152229'],
      // Dark ground under the trees: little light gets through.
      forest: ['#1f2c21', '#1c291e'],
      // Floors and walls have their own look (interior.ts); these are only their ground.
      floor: ['#6b4a31', '#6b4a31'], wall: ['#1d1510', '#1d1510'],
    };
    const ground = (kind: TileKind, tx: number, ty: number, raised: boolean) => {
      const chk = (tx + ty) & 1;
      const c = new THREE.Color(kind === 'grass' && raised ? (chk ? '#34503a' : '#314b36') : colors[kind][chk]);
      return c.offsetHSL(0, 0, (hash2(tx * 5, ty * 3) - 0.5) * 0.025);
    };
    // Outdoors, a building's timbers are weathered; indoors the room is warm if a fire burns in it, and
    // concrete if it is one of NAPO's.
    const tone = roomTone(this.warmRoom, map.data.style === 'napo');
    this.shapes = wallShapes(map);
    for (let ty = 0; ty < map.height; ty++) for (let tx = 0; tx < map.width; tx++) {
      const kind = map.kind(tx, ty)!, y0 = this.topY(tx, ty), raised = map.level(tx, ty) > 0;
      // A wall is a block of its own; one buried in other walls is not drawn at all (the void is black).
      if (kind === 'wall') { wallTile(quad, map, this.shapes, tx, ty, tone); continue; }
      if (kind === 'floor') floorTile(quad, tx, ty, tone, y0);
      else quad([tx, y0, ty], [tx, y0, ty + 1], [tx + 1, y0, ty + 1], [tx + 1, y0, ty], ground(kind, tx, ty, raised));
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
    // The ground goes on under the forest around the map. Not around a room: that is black.
    if (this.outdoors) {
      const outerMat = toon(outerColor);
      for (const [x, z, w, d] of [[W / 2, -60, W + 260, 120], [W / 2, H + 60, W + 260, 120], [-60, H / 2, 120, H], [W + 60, H / 2, 120, H]] as const) {
        still.push(part(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), outerMat, x, -0.01, z, false));
      }
    }
    // Center lines on two-lane roads. Not baked: they lie a hair above the road, and their own
    // material (made after the terrain's) keeps them drawn after it, so they win where the depth
    // buffer cannot tell the two apart.
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
    // The forest around the map, so its edge never shows. A room has none: it is black around.
    const rng = mulberry32(99);
    for (let y = -RING; y < H + RING && this.outdoors; y++) for (let x = -RING; x < W + RING; x++) {
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

    // Ferns: where skulkers lie. They rustle when something walks through: the warning one is coming.
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

  /** Props that never move go into `still` (to be baked); what moves (the Old Stone's crystal and debris, smoke, people) goes straight into the scene. */
  private buildTown(still: THREE.Object3D[]) {
    const postGeo = new THREE.BoxGeometry(0.09, 0.4, 0.09), railGeo = new THREE.BoxGeometry(1, 0.06, 0.05);
    const post = (x: number, z: number, v: number) => {
      const m = part(postGeo, '#4a3a2c', x, 0.2, z, false);
      m.rotation.z = (v - 0.5) * 0.12;
      still.push(m);
    };
    for (const f of this.objects('fence')) {
      const h = f.dir === 'h';
      if (h) { post(f.x + 0.2, f.y + 0.5, hash2(f.x, f.y)); post(f.x + 0.8, f.y + 0.5, hash2(f.y, f.x)); }
      else { post(f.x + 0.5, f.y + 0.2, hash2(f.x, f.y)); post(f.x + 0.5, f.y + 0.8, hash2(f.y, f.x)); }
      for (const y of [0.14, 0.3]) {
        const rail = part(railGeo, '#5a4634', f.x + 0.5, y, f.y + 0.5, false);
        rail.rotation.y = h ? 0 : Math.PI / 2;
        still.push(rail);
      }
    }

    // Every house can be entered: its door stands open. Behind a burning fire the doorway glows and the chimney smokes.
    const chimneys: THREE.Vector3[] = [];
    for (const { house: h, x: doorX, fire } of houseDoors(this.map, this.peek)) {
      if (h.style === 'napo') {
        // One of NAPO's buildings (napo.ts): the same doorway, concrete around it, smoke from a flue.
        const { root, flue } = napoBuilding(h, doorX, fire, { w: DOOR_W, h: DOOR_H, back: DOOR_BACK }, { warm: this.warm, doorGlow: this.doorGlow });
        if (fire) chimneys.push(flue);
        still.push(root);
        continue;
      }
      const g = new THREE.Group(), cx = h.x + h.w / 2, cz = h.y + h.h / 2;
      g.position.set(cx, 0, cz);
      // The door's middle across the front: 0 for the usual three-tile house, whose door is its middle tile.
      const dx = doorX + 0.5 - cx, wall = '#5b4838', board = '#46372b';
      // The walls, open where the door is: the back of the house whole, the front wall around a
      // doorway deep enough to walk into, since you stand on the door tile before going in.
      g.add(box(2.8, 1.15, 0.85 + DOOR_BACK, wall, 0, 0.575, (DOOR_BACK - 0.85) / 2));
      const fz = (DOOR_BACK + 0.85) / 2, fd = 0.85 - DOOR_BACK, left = dx - DOOR_W / 2 + 1.4, right = 1.4 - dx - DOOR_W / 2;
      g.add(box(left, 1.15, fd, wall, -1.4 + left / 2, 0.575, fz), box(right, 1.15, fd, wall, 1.4 - right / 2, 0.575, fz));
      g.add(box(DOOR_W, 1.15 - DOOR_H, fd, wall, dx, (1.15 + DOOR_H) / 2, fz));
      // Boards across the siding: on both sides, and on the front beside the doorway (or over it).
      for (const y of [0.33, 0.6, 0.87]) {
        for (const sx of [-1.405, 1.405]) g.add(box(0.012, 0.03, 1.72, board, sx, y, 0, false));
        if (y > DOOR_H) g.add(box(2.82, 0.03, 0.012, board, 0, y, 0.856, false));
        else g.add(box(left + 0.01, 0.03, 0.012, board, -1.405 + left / 2, y, 0.856, false), box(right + 0.01, 0.03, 0.012, board, 1.405 - right / 2, y, 0.856, false));
      }
      for (const [px, pz] of [[-1.38, -0.83], [1.38, -0.83], [-1.38, 0.83], [1.38, 0.83]] as const) g.add(box(0.12, 1.2, 0.12, '#34281f', px, 0.6, pz, false));
      g.add(box(3.34, 0.09, 2.36, new THREE.Color(h.roof).offsetHSL(0, 0, -0.1).getStyle(), 0, 1.19, 0));
      // One side is enough: the roof's open bottom rests on the slab, so its inside never shows.
      g.add(part(prism(3.3, 1.0, 2.3), h.roof, 0, 1.23, 0, 0.03));
      // The doorway: its inside seen from without (a box drawn from within), warm where a fire burns,
      // black in an empty house; a frame around it, the door swung out, and a mat in front.
      g.add(part(new THREE.BoxGeometry(DOOR_W - 0.02, DOOR_H - 0.02, fd), fire ? this.doorGlow : toon('#0a0807', { side: THREE.BackSide }), dx, DOOR_H / 2, fz + 0.005, false));
      for (const s of [-1, 1]) g.add(box(0.07, DOOR_H + 0.05, 0.08, '#2e241c', dx + s * (DOOR_W / 2 + 0.035), (DOOR_H + 0.05) / 2, 0.86, 0.015));
      g.add(box(DOOR_W + 0.2, 0.07, 0.09, '#2e241c', dx, DOOR_H + 0.05, 0.86, 0.015));
      const hinge = new THREE.Group();
      hinge.position.set(dx - DOOR_W / 2, 0, 0.87);
      // Wide open where someone lives; hanging off to one side in an empty house.
      hinge.rotation.y = h.lit ? -1.95 : -1.68;
      hinge.add(box(DOOR_W - 0.04, DOOR_H - 0.04, 0.05, h.lit ? '#4a3526' : '#3d352d', (DOOR_W - 0.04) / 2, (DOOR_H - 0.04) / 2 + 0.01, 0, 0.018));
      hinge.add(box(0.04, 0.04, 0.03, '#b09a62', DOOR_W - 0.12, 0.44, 0.04, false));
      g.add(hinge);
      g.add(box(0.66, 0.014, 0.36, '#6d4d35', dx, 0.007, 1.07, false), box(0.52, 0.02, 0.24, '#4a3024', dx, 0.01, 1.07, false));
      // Someone lives in a lit house: a lamp over the door and one warm window. An unlit one is
      // abandoned: dark, windows boarded up.
      if (h.lit) g.add(part(new THREE.BoxGeometry(0.14, 0.1, 0.08), this.warm, dx, 1.0, 0.9, false));
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
      if (fire) chimneys.push(new THREE.Vector3(cx + 0.9, 2.26, cz - 0.35));
      still.push(g);
    }
    if (chimneys.length) {
      const smoke = (this.smoke = new Smoke(chimneys));
      this.scene.add(smoke.puffs.points);
      this.puffs.push(smoke.puffs);
      this.animate.push(t => smoke.update(t));
    }

    const barrelGeo = flat(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 8));
    for (const b of this.objects('barrel')) {
      const m = part(barrelGeo, '#6e3a26', b.x + 0.5, 0.25, b.y + 0.5, 0.025);
      m.rotation.y = hash2(b.x, b.y) * 3;
      still.push(m, box(0.42, 0.03, 0.42, '#4b2819', b.x + 0.5, 0.38, b.y + 0.5, false));
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
      // Baking takes the car's meshes; the group stays for the headlight.
      this.scene.add(car);
      still.push(car);
    }

    for (const b of this.objects('board')) still.push(boardModel(b.x, b.y));
    for (const s of this.objects('sign')) {
      if (s.style === 'napo') { still.push(napoSign(s)); continue; }
      const g = new THREE.Group();
      g.position.set(s.x + 0.5, 0, s.y + 0.5);
      g.add(box(0.08, 0.46, 0.08, '#4a3a2c', 0, 0.23, 0), box(0.56, 0.32, 0.07, '#6b5334', 0, 0.5, 0));
      g.add(box(0.4, 0.04, 0.01, '#2e241c', 0, 0.54, 0.04, false), box(0.3, 0.04, 0.01, '#2e241c', 0, 0.46, 0.04, false));
      still.push(g);
    }
    for (const l of this.objects('lamp')) {
      const g = new THREE.Group();
      g.position.set(l.x + 0.5, 0, l.y + 0.5);
      g.add(part(flat(new THREE.CylinderGeometry(0.045, 0.06, 1.3, 6)), '#2f343c', 0, 0.65, 0, 0.02));
      // The head keeps its own glowing material: all the lamp heads become one mesh of their own.
      g.add(box(0.42, 0.05, 0.08, '#2f343c', 0.18, 1.3, 0), part(new THREE.BoxGeometry(0.2, 0.1, 0.16), this.lampMat, 0.34, 1.24, 0, 0.02));
      still.push(g);
    }
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
      still.push(g);
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
    if (wire.length) this.scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wire), this.wireMat));

    // Radio masts (napo.ts): their lights all blink together, a short flash every 1.6 seconds.
    const masts = this.objects('antenna');
    for (const a of masts) still.push(towerModel(a.x, a.y, this.beaconMat));
    if (masts.length) this.animate.push(t => { this.beaconMat.emissive.setHex(t % 1.6 < 0.3 ? 0xff3322 : 0x1a0604); });

    for (const st of this.objects('stone')) {
      const cx = st.x + 0.5, cz = st.y + 0.5;
      still.push(part(flat(new THREE.CylinderGeometry(0.62, 0.7, 0.2, 8)), '#5e5a54', cx, 0.1, cz, 0.03));
      const crystal = part(new THREE.OctahedronGeometry(0.42, 0), this.crystalMat, cx, 1.2, cz, 0.03);
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
        crystal.rotation.y = t * (this.stoneAwake ? 1.4 : 0.6);
        crystal.position.y = 1.2 + Math.sin(t * 1.5) * 0.07;
        debris.rotation.y = t * 0.35;
        for (const d of debris.children) d.position.y = d.userData.y + Math.sin(t * 1.4 + d.userData.ph) * 0.12;
      });
    }

    for (const n of this.objects('npc')) {
      const { root, bang } = makeNpc(n.look);
      root.position.set(n.x + 0.5, this.groundAt(n.x, n.y), n.y + 0.5);
      root.rotation.y = FACE[n.dir];
      this.scene.add(root, this.blob(0.3, n.x + 0.5, n.y + 0.5));
      this.animate.push(t => { bang.position.y = 1.18 + Math.sin(t * 3) * 0.05; bang.rotation.y = t * 1.5; });
    }
  }

  /**
   * What stands in a room: furniture, fireplaces (with their fire), soft shadows under the
   * furniture and, inside, the windows, the doorway's mat and the cold light both let in.
   * Fireplaces burn wherever a map has one, outdoors too.
   */
  private buildRoom(still: THREE.Object3D[]) {
    const { map } = this;
    for (const o of map.data.objects) {
      const m = furnitureModel(o, map);
      if (m) still.push(m);
    }
    const fireplaces = this.objects('fireplace');
    if (fireplaces.length) {
      const embers = new THREE.MeshBasicMaterial({ color: 0xff7a2a });
      const spots = fireplaces.map(f => {
        const { model, spot } = hearthAt(map, f.x, f.y) ? hearthModel(f.x, f.y, embers) : campfireModel(f.x, f.y, embers);
        still.push(model);
        return { ...spot, ph: hash2(f.x, f.y) * 6 };
      });
      const fires = new Fires(spots, embers);
      this.fireTiles = fireplaces.map(f => [f.x, f.y]);
      this.fireLevels = fireplaces.map(() => 1);
      this.scene.add(...fires.objects);
      this.puffs.push(fires.sparks);
      this.animate.push(t => fires.update(t, this.fireLevels));
    }
    this.instanced(this.shadowGeo, furnitureShadows(map), ([x, z, rx, rz], o) => { o.position.set(x, BLOB_Y, z); o.scale.set(rx, 1, rz); }, this.shadowMat);
    if (this.outdoors) return;
    const light: Array<readonly [number, number, number, number]> = [];
    for (const w of windowSpots(map, this.shapes)) {
      still.push(windowModel(w.x, w.y, this.paneMat, !this.warmRoom));
      light.push([w.x + 0.5, w.y + 1.95, 1.5, 2.1]);
    }
    for (const d of doorways(map)) {
      still.push(doorwayModel(d.x, d.y, d.dir));
      const [dx, dy] = DIR_VEC[d.dir];
      light.push([d.x + 0.5 - dx * 0.8, d.y + 0.5 - dy * 0.8, dx ? 2.4 : 1.6, dx ? 1.6 : 2.4]);
    }
    if (light.length) {
      this.skyLight = new THREE.MeshBasicMaterial({ map: softTexture(0.4), color: 0xa9c2d6, transparent: true, opacity: 0.15, depthWrite: false, blending: THREE.AdditiveBlending });
      this.scene.add(new THREE.Mesh(glowQuads(light, GLOW_Y), this.skyLight));
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
    const rain = (this.rain = new THREE.LineSegments(rainGeo, this.rainMat));
    rain.frustumCulled = false;
    this.scene.add(rain);
    this.animateRain = (focus, dt) => {
      if (!rain.visible) return;
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
    m.position.set(x, BLOB_Y, z);
    return m;
  }

  /** The weather everyone shares. Inside, only the windows (and the light they let in) show it. */
  setWeather(w: Weather) {
    this.weather = w;
    const a = (this.amb = ambience(this.map.data.kind, w, this.warmRoom));
    this.hemi.color.set(a.hemi.sky);
    this.hemi.groundColor.set(a.hemi.ground);
    this.hemi.intensity = a.hemi.intensity * L;
    this.sun.color.set(a.sun.color);
    this.sun.intensity = a.sun.intensity * L;
    (this.scene.background as THREE.Color).set(a.sky);
    (this.scene.fog as THREE.Fog).color.set(a.sky);
    this.lampMat.emissive.set(a.lampGlow);
    this.warm.emissive.set(a.warmGlow);
    this.doorGlow.emissive.set(a.warmGlow);
    this.flash.intensity = a.flashlight ? 1.6 * L : 0;
    this.headLight.intensity = a.carLights && this.hasCar ? 1.3 * L : 0;
    this.headMat.emissive.set(a.carLights ? '#fff1c4' : '#000000');
    this.tailMat.emissive.set(a.carLights ? '#c8281c' : '#000000');
    this.capMat.emissive.set(a.capGlow);
    if (this.rain) this.rain.visible = !!a.rain || this.storm;
    if (a.rain) { this.rainMat.color.set(a.rain.color); this.rainMat.opacity = a.rain.opacity; }
    if (a.mist) { this.mistMat.color.set(a.mist.color); this.mistMat.opacity = a.mist.opacity; }
    this.wispMat.opacity = a.wisps;
    this.smoke?.puffs.color.set(a.smoke);
    this.paneMat.emissive.set(a.window.glow);
    if (this.skyLight) this.skyLight.opacity = a.window.light;
    this.loot.setGlow(lootGlow(this.map.data.kind, w, this.warmRoom));
    // On aurora nights the dead power lines hum again: their wires glow.
    this.wireMat.color.set(w === 'aurora' ? '#62ffc8' : '#0e1115');
    this.applySurge();
    this.updateFog();
  }

  /** How big each fire burns (fire.ts, fireLevel), by its fireplace's tile: asked every frame. */
  setFires(level: (x: number, y: number) => number) {
    this.fireLevel = level;
  }

  /** The marks painted on this map, all of them (call it when they change). */
  setMarks(marks: Iterable<MarkView>) {
    this.marks.set(marks, (x, y) => this.groundAt(x + 0.5, y + 0.5));
  }

  /** The creatures on this map where the game draws them now, every frame. */
  setCreatures(list: CreatureAvatar[]) {
    this.creatureList = list;
  }

  /** The flares burning on this map, every frame; the nearest to `focus` gets the real light. */
  /** Glowing footprints (a quirk), newest last, with their age in seconds: every frame. */
  setPrints(list: ReadonlyArray<{ x: number; y: number; dir: Dir; age: number }>) {
    this.prints.set(list, (x, y) => this.groundAt(x, y));
  }

  /** Where players walk whose gear makes street lights flicker as they pass (a quirk): every frame. */
  setFlickerAt(list: Array<{ x: number; y: number }>) {
    this.flickerAt = list;
  }

  setFlares(list: Array<{ x: number; y: number; left: number }>, focus: { x: number; y: number }) {
    const near = [...list].sort((a, b) => Math.hypot(a.x - focus.x, a.y - focus.y) - Math.hypot(b.x - focus.x, b.y - focus.y));
    this.flares.set(near, (x, y) => this.groundAt(x, y));
  }

  /** The flashes on this map, every frame; the nearest to the player are drawn. */
  setFlashes(list: FlashView[]) {
    this.flashes.set(list, (x, y) => this.groundAt(x, y));
  }

  /** A storm over this map: a dark sky, closer fog, heavy rain and lightning (outdoors only). */
  setStorm(on: boolean) {
    if (on === this.storm) return;
    this.storm = on;
    if (this.outdoors) this.setWeather(this.weather);
  }

  /** The piles on this map, for the echoes that walk to them: call it when they change or you move to another tile. */
  setEchoes(drops: Iterable<DropView>, focus: { x: number; y: number }) {
    this.echoes.set(drops, focus);
  }

  /** The Old Stone awake: its crystal and light burn brighter, and it turns faster. */
  setStone(awake: boolean) {
    this.stoneAwake = awake;
    this.crystalMat.emissive.set(awake ? '#8a4dff' : '#4a1a9c');
  }

  /** How much a surge washes this map, 0 (none) to 1 (its front is over you): the sky and the light turn violet. */
  setSurge(k: number) {
    const v = Math.round(Math.min(1, Math.max(0, k)) * 50) / 50;
    if (v === this.surgeK) return;
    this.surgeK = v;
    this.applySurge();
  }

  private applySurge() {
    if (!this.outdoors) return;
    const a = this.amb, k = this.surgeK;
    const sky = new THREE.Color(a.sky).lerp(STORM_SKY, this.storm ? 0.6 : 0).lerp(SURGE_SKY, k * 0.7);
    (this.scene.background as THREE.Color).copy(sky);
    (this.scene.fog as THREE.Fog).color.copy(sky);
    this.hemi.color.set(a.hemi.sky).lerp(SURGE_HEMI, k * 0.55);
    this.wispMat.color.set(0x9ef6ff).lerp(new THREE.Color('#c79bff'), k);
    this.wispMat.opacity = a.wisps + (1 - a.wisps) * k;
  }

  /**
   * The finds and piles lying on this map, all of them (call it when they change). `me` and `color`:
   * your id and jacket color, for the ring around your own pile.
   */
  setLoot(finds: Iterable<FindView>, drops: Iterable<DropView>, me: string | null, color: string | null) {
    this.loot.set(finds, drops, me, color, (x, y) => this.groundAt(x + 0.5, y + 0.5));
  }

  /** Tiles you see past yourself while a condition brings fog to this map (undefined: none). */
  setFogCap(tiles: number | undefined) {
    if (tiles === this.fogCap) return;
    this.fogCap = tiles;
    this.updateFog();
  }

  private updateFog() {
    const fog = this.scene.fog as THREE.Fog, f = this.amb.fog, d = this.dist;
    if (!f) { fog.near = 1e4; fog.far = 2e4; return; }
    // A storm leaves less to see.
    const storm = this.storm && this.outdoors ? 0.6 : 1;
    fog.near = Math.max(1, d - 1.5);
    fog.far = d + Math.max(f.min, d * f.share) * storm;
    // Thick fog (a condition) closes in whatever the weather.
    if (this.fogCap !== undefined && this.outdoors) fog.far = Math.min(fog.far, d + this.fogCap);
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
    // Smoke and sparks are sized in world units: the pixels one unit covers, one unit from the camera.
    const perUnit = this.renderer.getDrawingBufferSize(this.tmp2).y / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    for (const p of this.puffs) p.resize(perUnit);
    this.loot.resize(perUnit);
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
    const carriers = avatars.filter(a => a.live).map(a => ({ x: a.x + 0.5, z: a.y + 0.5, d: Math.hypot(a.x - focus.x, a.y - focus.y) }));
    this.liveGlows.set(carriers.sort((a, b) => a.d - b.d).map(c => ({ x: c.x, y: this.groundAt(c.x, c.z), z: c.z })), t);
    this.creatures.sync(this.creatureList, t, (x, z) => this.groundAt(x, z));
    for (const c of this.creatureList) if (c.moving) this.rustleAt(c.x + 0.5, c.y + 0.5);
    this.echoes.update(t, (x, z) => this.groundAt(x, z));
    this.light(fx, fz, t, dt);
    const dark = this.weather === 'night' || this.weather === 'aurora';
    if (this.storm && this.outdoors) this.hemi.intensity = this.amb.hemi.intensity * L * (lightningAt(t) ? 2.6 : 0.8);
    this.stoneLight.intensity = this.hasStone ? (dark ? 2.4 : 1.2) * (this.stoneAwake ? 2 : 1) * L * (0.85 + 0.15 * Math.sin(t * 3.1)) : 0;
    const flare = this.flares.nearest();
    this.flareLight.intensity = flare ? FLARE_LIGHT * L * flare.k * (0.8 + 0.2 * Math.sin(t * 19)) : 0;
    if (flare) this.flareLight.position.set(flare.x, flare.g + 0.6, flare.y);
    this.marker.visible = !!marker;
    if (marker) {
      this.marker.position.set(marker.x + 0.5, this.groundAt(marker.x + 0.5, marker.y + 0.5) + BLOB_Y + 0.006, marker.y + 0.5);
      (this.marker.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - marker.t / 0.8);
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Puts the real lights on the lamps and fires nearest the player (again whenever the player reaches a new tile). */
  private light(fx: number, fz: number, t: number, dt: number) {
    const tile = Math.floor(fz) * 65536 + Math.floor(fx);
    if (tile !== this.lightTile) {
      this.lightTile = tile;
      const next = assignLights(this.slots.map(s => s.source), this.sources, fx, fz);
      this.slots.forEach((s, k) => {
        const i = next[k]!;
        if (i === s.source) return;
        s.source = i;
        s.on = 0;
        const src = this.sources[i];
        if (!src) return;
        // A light moved to another kind of source takes its color and reach (uniforms: no shader change).
        s.light.position.set(src.x, src.y, src.z);
        s.light.color.set(src.kind === 'fire' ? FIRE_COLOR : LAMP_COLOR);
        s.light.distance = src.kind === 'fire' ? FIRE_REACH : LAMP_REACH;
      });
    }
    const lamp = (this.weather === 'night' || this.weather === 'aurora' ? 1.8 : this.weather === 'rain' ? 0.9 : 0.5) * L;
    for (const s of this.slots) {
      const src = this.sources[s.source];
      if (!src) { s.light.intensity = 0; continue; }
      s.on = Math.min(1, s.on + dt / LIGHT_FADE_S);
      if (src.kind === 'fire') { s.light.intensity = FIRE_LIGHT * L * flicker(t, src.ph) * s.on * Math.min(1, this.fireLevel(src.tx, src.ty)); continue; }
      // Some lamps flicker now and then; any lamp flickers hard while someone with a flickering quirk passes under it.
      const restless = this.flickerAt.some(p => (p.x + 0.5 - src.x) ** 2 + (p.y + 0.5 - src.z) ** 2 < 9);
      const off = (src.flicker && (Math.sin(t * 13 + src.ph) > 0.92 || Math.sin(t * 2.3 + src.ph) > 0.97)) || (restless && Math.sin(t * 29 + src.ph) * Math.sin(t * 7.3) > 0.1) ? 0.15 : 1;
      s.light.intensity = lamp * off * s.on;
    }
  }

  private syncAvatars(avatars: Avatar[], meId: string | null) {
    const seen = new Set<string>();
    for (const a of avatars) {
      seen.add(a.id);
      let e = this.rigs.get(a.id);
      // A new jacket or new gear: the character is built again in it.
      const look = JSON.stringify(a.look ?? {});
      if (!e || e.color !== a.color || e.look !== look) {
        if (e) this.dropRig(e);
        e = { rig: makePlayer(a.color, a.look), color: a.color, look, shadow: this.blob(0.3, 0, 0) };
        this.scene.add(e.rig.root, e.shadow);
        this.rigs.set(a.id, e);
      }
      const x = a.x + 0.5, z = a.y + 0.5, gy = this.groundAt(x, z), { rig } = e;
      rig.root.position.set(x, gy + (a.moving ? Math.abs(Math.sin(a.phase)) * 0.045 : 0), z);
      rig.root.rotation.y = FACE[a.dir];
      e.shadow.position.set(x, gy + BLOB_Y, z);
      const sw = a.moving ? Math.sin(a.phase) * 0.95 : a.turnT > 0 ? Math.sin((1 - a.turnT / 0.14) * Math.PI) * 0.45 : 0;
      rig.legL.rotation.x = sw; rig.legR.rotation.x = -sw;
      rig.armL.rotation.x = -sw * 0.7; rig.armR.rotation.x = sw * 0.7;
      if (a.moving) this.rustleAt(x, z);
      // Whatever clings to your back rides along.
      if (a.hitched && !e.hitch) e.rig.root.add((e.hitch = hitchhikerModel()));
      if (e.hitch) e.hitch.visible = !!a.hitched;
      if (a.id === meId && this.amb.flashlight) {
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
