/**
 * Draws one map with three.js: tile terrain with ledges, forest, town props, the insides of
 * buildings, fires, weather, the characters, and the finds and piles lying around (loot.ts).
 * Everything comes from the map data and the server's lists; this file only decides how it looks.
 *
 * The WebGL renderer lives for the whole visit (createRenderer); a WorldView is built for one map
 * and disposed when you leave it, which frees what it put on the GPU. Big maps stay fast on
 * phones: trees, ferns and grass are drawn in blocks the camera skips when they are off screen, the
 * props that never move (houses and NAPO's buildings, cars, signs, lamps, poles, masts, barrels,
 * fences, furniture, hearths; napo.ts draws NAPO's, left.ts what the town and the leavers left) are
 * joined into a few meshes, and only the few lamps and fires nearest you carry a real light. grass.ts
 * decides how the ground and the grass look, and tall grass: players crouch in it, and it sways and
 * parts around them on the GPU.
 * Inside a building (a map of kind 'inside') there is no weather and no world around the room, only
 * black: see interior.ts for the room, fire.ts for the fire and lighting.ts for the light.
 * A view is built in a season (sky.ts): its colors graded into the ground, the plants and the firs as
 * they are built (grass.ts, GRADES), its light tinted, its rain snow in winter, and the water that
 * freezes drawn as ice. The season turns once a week; then the view is built again (main.ts).
 */
import * as THREE from 'three';
import {
  BEAM_HALF, BEAM_REACH, DIR_VEC, LAMP, LANTERN_REACH, PRINTS_PER_MAP, beamAngle, builtIn, dirToward, hidden, poleTag, watery, type Comfort, type Dir, type DropView, type FindView, type FlashView, type ItemDef, type MapData, type MapObject, type MarkView, type Pass, type Season, type TileKind,
  type TileMap, type Weather,
} from '@napoland/shared';
import { comfortModel, comfortShadow, lampLight } from './cabin';
import { Afterglows, Lanterns, LiveGlows, makeNpc, makePlayer, type Look, type Rig } from './characters';
import { Fires, GLOW_Y, Smoke, campfireModel, coldHearthModel, flicker, hearthModel, type Puffs } from './fire';
import { homeModel, homeTone, kitchenModel, mapTableModel } from './home';
import {
  CROUCH_DROP, CROUCH_LEAN, GRADES, Ground, PARTERS, STORM_WIND, TALL_BLADES, TUFT_BLADES, WIND, clumpGeometry, crouchToward, grassClumps, sessionGrass, type GrassMaterial,
} from './grass';
import { Creatures, Echoes, FAR_FIGURE_H, FarFigure, Flares, Flashes, MarshLights, Marks, Passer, Prints, SnowPrints, boardModel, hitchhikerModel, stoneCrystal } from './wilds';
import {
  doorwayModel, doorways, floorTile, furnitureModel, furnitureShadows, hasFire, hearthAt, houseDoors, noteModel, roomCurtains, roomTone, wallShapes, wallTile, windowModel, windowSpots,
  type QuadFn, type WallShape,
} from './interior';
import {
  LOOKOUT_DECK, LOOKOUT_LAMP_Y, LOOKOUT_STAND_Z, boxesModel, bridgeModel, bridgeRails, cardboardModel, carModel, culvertMouthModel, culvertMouths, curtainColor, curtainPanels, footbridgeModel, headlightCar, leftModel, lookoutModel, mailboxModel, millBuilding, porchModel, shedBuilding,
} from './left';
import { SNOW, ambience, assignBeams, assignLights, lightSources, onSnow, underOldGrowth, type Ambience, type LightSource } from './lighting';
import { Loot, lootGlow } from './loot';
import { poleLean } from './lean';
import { HUM, TELEPORT_RINGS, TELEPORT_ROCK_Y, napoBuilding, napoProp, napoSign, teleportCore, towerModel, type TeleportCore } from './napo';
import { OUTLINE_INSTANCED, bake, box, disposeTree, flat, glowQuads, hash2, keepPrograms, merge, mulberry32, ownToon, part, riseTexture, softTexture, toon } from './toon';
import { beamPose, type BeamPose } from '../beam';
import { farGlow, farLights, placeFar, upness, type FarLight } from '../lookout';

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
  /** A flash left them glowing faintly (the afterglow quirk). */
  afterglow?: boolean;
  /** What they wear (characters.ts). */
  look?: Look;
  /** They lie slumped, out of energy, until someone gets them up (rescue.ts): everyone sees them lie there. */
  down?: boolean;
  /** You, while NAPO's teleport takes you (beam.ts): going or coming, how many seconds into it, and its pad. */
  beam?: { phase: 'out' | 'in'; t: number; pad: { x: number; y: number } };
  /** Up a fire lookout (lookout.ts): standing on its platform, in front of the cab. */
  up?: boolean;
  /** Their lantern shines here, in a deep region (energy.ts, LANTERN): a warm pool of light around them. */
  lantern?: boolean;
}

/** A player as drawn: their model, what it was built in, and while a teleport takes you, the materials it had (clipRig). */
interface RigEntry {
  rig: Rig;
  color: string;
  look: string;
  shadow: THREE.Mesh;
  hitch?: THREE.Group;
  crouch: number;
  /** From 0 to 1 as they go down out of energy (rescue.ts), and back as they get up. */
  slump: number;
  /** From 0 to 1 as they wade into the culvert's water, waist-deep. */
  wade: number;
  clipped?: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
  /** From 0 to 1 as they climb a lookout, and back as they come down. */
  climb: number;
}

/** A flashlight someone holds at night: where the light is, and where on the ground it points (world units). */
interface Held {
  id: string;
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  /** They are up the fire lookout at whose ladder they stand: drawn on its platform (lookout.ts). */
  up?: boolean;
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
/**
 * How many other players' flashlights light the night around them, the nearest ones: real spotlights like your
 * own, so walking together lights more of the woods. Like the lamps' lights they are always in the scene, off by
 * day, so their number never changes and nothing recompiles; anyone farther walks unlit.
 */
const OTHER_FLASHLIGHTS = 3;
/** Seconds a pop at a teleport lasts (WorldView.pop). */
const POP_S = 0.6;
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
/**
 * The forest goes on this many tiles outside the map, so its edge never shows: standing on a map's
 * last row, an upright phone sees about 15 tiles past it. Its blocks are skipped like any off screen.
 */
const RING = 17;
/** Over this many tiles a road or trail leaving the map fades into the dark ground outside it. */
const FADE = 6;
/** The most drawing-buffer pixels to a CSS pixel: past two, a phone pays for sharpness nobody sees. */
const MAX_PIXEL_RATIO = 2;
/** Poles farther apart than this belong to different lines: no wire between them. */
const MAX_WIRE = 10;
/** One patch of mist for about this many tiles. */
const MIST_TILES = 190;
/** Blob shadows and the tap marker lie just above rugs (whose tops are at most 0.026), which lie on the floor. */
const BLOB_Y = 0.036;
/** Winter's ice lies this high: a little under the ground around it, over the water under it. */
export const ICE_Y = -0.05;
/** Snow on the roofs in winter: every roof's own color most of the way to this. */
const ROOF_SNOW = new THREE.Color('#dfe7ec');
/** How the firs take a season: their green toward this, that far (a frost in winter). */
const TREE_GRADE: Readonly<Record<Season, [string, number]>> = {
  spring: ['#2f6a3a', 0.18], summer: ['#4a5530', 0.1], autumn: ['#5c4a26', 0.14], winter: ['#b4c4c2', 0.32],
};
/**
 * Someone down lies face down on their tile, the pack up: leaned this far forward (radians), lifted so
 * the face rests on the ground rather than in it, drawn back so the body lies over their own tile, and
 * rolled a little to one side. SLUMP_S (seconds) is how long going down or getting up takes.
 */
const SLUMP_LEAN = 1.35, SLUMP_LIFT = 0.1, SLUMP_BACK = 0.42, SLUMP_ROLL = 0.22, SLUMP_TIME = 0.6;
/** The water's surface (the pond's, the creek's and the culvert's), and how deep someone wading the culvert sinks into it. */
const WATER_Y = -0.1;
const WADE_DROP = 0.3;
/**
 * Up a lookout the view reaches three times as far, and draws what lies far from you more cheaply (the
 * far look): the tree blocks whose middle is farther than this from where you stand up there keep only
 * every other tree, and lose their outlines and shadows, their ferns and their grass; the fog closes in
 * on the view's edge. Measured in the Near Woods (lookout.test.ts): drawn whole, the view from up there
 * is about 345 draw calls and 400K triangles; with the far look, about as many calls as on the ground
 * (100) and 160K triangles.
 */
const FAR_BLOCK = 10;
const FAR_TREES = 0.5;
/**
 * The far trees seen from a lookout are drawn as its far forest: joined, for each lookout, into pieces this
 * many tiles a side, a few draw calls for the whole far view instead of one for every block. Bigger pieces
 * are fewer calls but more trees drawn off screen (at 16: 131 calls, 147K triangles; at 32: 100, 160K).
 */
const FAR_PIECE = 32;
/** How much nearer the fog comes, all the way up: the far look fades out into it. */
const FAR_FOG = 0.45;
/** How quickly someone climbs up the ladder and down it again: all the way in well under a second. */
const CLIMB_RATE = 1.8;
/** The distant lights seen from up a lookout (lookout.ts, farLights): at most this many, and how big their glow is. */
const FAR_LIGHTS = 40;
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
 * Old growth (MapData.forest 'old', the Far Woods): about a third of the trees are cedars, the fir's
 * shape spread wider and lower in a warmer, yellower green, and the ferns grow taller and wider. All of
 * it is the same instanced meshes, scaled and tinted: old woods cost no more draw calls than young ones.
 */
export const CEDAR_SHARE = 0.34;
export const CEDAR_SPREAD = 1.3;
export const CEDAR_HEIGHT = 0.88;
const CEDAR_TINT = new THREE.Color(1.12, 1.18, 0.9);
/** Ferns under old growth: [wider, taller]. */
export const DEEP_FERNS: readonly [number, number] = [1.3, 1.5];
/**
 * A burnt forest (MapData.forest 'burnt', the Burn): the same firs, standing bare and black, narrower and a
 * little taller with their needles gone. Tinted and scaled like the cedars: no draw call of its own.
 */
export const SNAG_TINT = new THREE.Color(0.3, 0.26, 0.24);
/** Snow on the Ridge's firs (MapData.forest 'snow'): the same firs, their boughs whitened. */
export const FROST_TINT = new THREE.Color(1.5, 1.6, 1.7);
/** The Marsh's trees (MapData.forest 'marsh'): drowned, standing bare and grey in the water, shaped like the Burn's snags (their green taken out). */
export const DROWNED_TINT = new THREE.Color(0.85, 0.45, 0.8);
export const SNAG_SPREAD = 0.5;
export const SNAG_HEIGHT = 1.12;

/** Is the tree on this tile a cedar? The same on every visit. */
export const isCedar = (x: number, y: number) => hash2(x * 17 + 5, y * 23 + 9) < CEDAR_SHARE;

/**
 * How big a forest tile's tree is, from its hash `h` (0 to 1): 1 to 1.5 in young woods; in old growth
 * 1.2 to 1.8 beside open ground, and the old giants, 1.6 to 2.4, only deep in (`deep`: forest all
 * round the tile), where they stand in nobody's way and hide nobody from the camera.
 */
export function treeSize(h: number, old: boolean, deep: boolean): number {
  if (!old) return 1 + h * 0.5;
  return deep ? 1.6 + h * 0.8 : 1.2 + h * 0.6;
}

/** A forest tile with forest (or the map's edge) all round it: in old growth, where the giants stand. */
export function deepInForest(map: TileMap, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const k = map.kind(x + dx, y + dy);
    if (k !== undefined && k !== 'forest') return false;
  }
  return true;
}

/**
 * A whole tree as one geometry (trunk and three cones, colored per vertex), so each tree is one
 * instance instead of four. Each cone is turned a little so the facets do not line up; its green is the
 * season's (TREE_GRADE). With `outline` it is the dark shell instead: the cones a little bigger, drawn from behind.
 * The body has no caps: from a camera that always looks down, a cone's bottom faces away and the
 * trunk's ends hide in the ground and the lowest cone, and thousands of trees add up. The shell
 * keeps its caps, which draw the dark line under each tier.
 */
function treeGeometry(outline: boolean, season?: Season): THREE.BufferGeometry {
  const grade = season && TREE_GRADE[season];
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
    parts.push([g, outline ? null : grade ? new THREE.Color(color).lerp(new THREE.Color(grade[0]), grade[1]) : new THREE.Color(color)]);
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

/**
 * The home a view draws, in a home of one's own (its house and its garden): how far its house is built
 * (house.ts), and whose it is (a friend's name while you visit; null, your own). A view is built again when
 * either changes (main.ts). Anywhere else, the first level and nobody.
 */
export interface HomeLook {
  house: number;
  owner: string | null;
}

/**
 * The view of the map someone arrives on (or the same map as the season turns, `season`, or the same home as
 * its house is built up, `home`), in place of `old`: the new one is built (and its shaders compiled) before
 * the old one is freed, so every program both draw with stays compiled and only what the new map needs that
 * the old did not is compiled, behind the black screen of the arrival.
 */
export function nextView(renderer: THREE.WebGLRenderer, old: WorldView, map: TileMap, peek?: (id: string) => MapData | undefined, season?: Season, home?: HomeLook): WorldView {
  const view = new WorldView(renderer, map, peek, season, home);
  old.dispose();
  return view;
}

export class WorldView {
  /** The share of the full resolution to draw at (quality.ts); applied on the next resize. */
  pixelScale = 1;
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
  /** Each player's model; `crouch` goes from 0 to 1 as they wade into tall grass, `slump` as they go down, `wade` as they wade into the culvert's water,
   * `climb` as they climb a lookout (and back to 0 as they come down). */
  private rigs = new Map<string, RigEntry>();
  /** The ground's colors (grass.ts), and the grass's material: null where no grass grows. */
  private ground!: Ground;
  private grass: GrassMaterial | null = null;
  /** The players nearest you, who part the grass: where, and how far from you (squared), nearest first. Kept, so no frame allocates. */
  private partX = new Float64Array(PARTERS);
  private partZ = new Float64Array(PARTERS);
  private partD = new Float64Array(PARTERS);
  private animate: Array<(t: number, dt: number) => void> = [];
  private hemi = new THREE.HemisphereLight(0xa3b3bb, 0x1d2620, 0.55 * L);
  private sun = new THREE.DirectionalLight(0xc9d4d8, 0.36 * L);
  private flash = new THREE.SpotLight(0xfff0d0, 0, 10, 0.5, 0.6, 1.3);
  private flashTarget = new THREE.Object3D();
  /** The other players' flashlights (OTHER_FLASHLIGHTS): whose each follows ('' for nobody) and how far it has come on. */
  private beams = Array.from({ length: OTHER_FLASHLIGHTS }, () => ({ light: new THREE.SpotLight(0xfff0d0, 0, 10, 0.5, 0.6, 1.3), target: new THREE.Object3D(), id: '', on: 0 }));
  /** Lamps and fires: what may carry one of the real lights; the map's own, and a lamp made in your cabin besides. */
  private sources: LightSource[] = [];
  private baseSources: LightSource[] = [];
  /** Your cabin's furniture (cabin.ts), built again when what stands in its places changes: what was built last. */
  private comfortRoot = new THREE.Group();
  private comfortKey: string | null = null;
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
  /** The glow of NAPO's teleports (napo.ts, teleportCore): soft violet on the plate and in the arch, pulsing; and the ring that spreads over the plate. */
  private teleportGlow = new THREE.MeshBasicMaterial({ map: softTexture(0.3), color: 0xa98cff, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  private teleportRipple = new THREE.MeshBasicMaterial({ color: 0xc9b6ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  /** A trip's rings of light and sparks (each ring a copy, to fade on its own), and its column of light, bright at the foot. */
  private teleportLight = new THREE.MeshBasicMaterial({ color: 0xd8ccff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  private teleportColumn = new THREE.MeshBasicMaterial({ map: riseTexture(), color: 0xc9b6ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  /** The teleports on this map, what moves on each (teleportCore). */
  private teleports: TeleportCore[] = [];
  /** Cuts you away from your feet up, or gives you back from your head down, while a teleport takes you (clipRig). */
  private beamPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e3);
  /** Violet pops where someone else vanished or appeared at a teleport (pop), how far along each is. */
  private pops: Array<{ group: THREE.Group; mat: THREE.MeshBasicMaterial; t: number }> = [];
  private hasCar = false;
  private stoneLight = new THREE.PointLight(0xa66cff, 0, 7, 2);
  private hasStone = false;
  /** Rain, mist and wisps: only outdoors. */
  private rain: THREE.LineSegments | null = null;
  /** What falls is snow (winter): it drifts down slowly, in short flakes. */
  private snowing = false;
  /** Seconds the snow has drifted, for its sway. */
  private drift = 0;
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
  private afterglows = new Afterglows();
  private lanterns = new Lanterns(LANTERN_REACH);
  private prints = new Prints();
  /** Footprints in the snow (the Ridge): only on a map of snow. */
  private readonly snowPrints = new SnowPrints(PRINTS_PER_MAP);
  /** Where someone walks whose gear makes street lights flicker (tiles). */
  private flickerAt: Array<{ x: number; y: number }> = [];
  private flashes = new Flashes();
  private echoes = new Echoes();
  /** Roofs the town built over a few tiles (porches), and how solid each is drawn now: they fade over whoever stands under them. */
  private porches: Array<{ roof: THREE.Mesh; x0: number; y0: number; x1: number; y1: number; k: number }> = [];
  /** What stands at the edge of the fog when you are uneasy (unease.ts): only on a map where watchers roam. */
  private farFigure: FarFigure | null = null;
  /** Someone's steps, glimpsed while you are alone out there (glimpses.ts): only on a map of the wilds. */
  private passer: Passer | null = null;
  private creatureList: CreatureAvatar[] = [];
  private flareLight = new THREE.PointLight(FLARE_COLOR, 0, 9, 2);
  /** The fire lookouts on this map: their corners, and each one's beam, which turns round it while its lamp burns. */
  private lookouts: Array<{ x: number; y: number; beam: THREE.Mesh }> = [];
  /** The lamp in a lookout's cab: dark while it is out, bright while it burns. */
  private beamLampMat = ownToon('#e8e1c8', { emissive: 0x000000 });
  private beamMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  /** How far the view is pulled back (1: down on the ground; LOOKOUT_ZOOM up a lookout) and the far look's state. */
  private zoom = 1;
  private lodTile = NaN;
  private lodOn = false;
  /** Tree, fern and grass blocks, for the far look: each one's middle, its trees' mesh and how many, and what it drops when far. */
  private blockLod = new Map<string, { x: number; z: number; body: THREE.InstancedMesh | null; trees: number; extras: THREE.Object3D[] }>();
  /** For each lookout, where you stand up there and the far forest drawn from there: the far blocks' halves in a few big pieces. */
  private farForests: Array<{ x: number; z: number; meshes: THREE.InstancedMesh[] }> = [];
  /** The lights that never move seen from up a lookout, and the two sets of points they are drawn as (lights far off are bigger). */
  private farList: FarLight[] = [];
  private farSmall: THREE.Points | null = null;
  private farBig: THREE.Points | null = null;
  private farAt = { x: 0, y: 0, z: 0, far: false };
  /** Each distant light's color (r, g, b, in farList's order), read once, and where a flare's light is: nothing is made while they are drawn. */
  private farRgb = new Float32Array(0);
  private flareAt = { x: 0, y: 0, z: 0 };
  /** Where the camera looks, while you climb a lookout or stand up there: your climb, and where you are drawn. */
  private climbing = 0;
  private climbAt = new THREE.Vector3();
  /** The flares burning on this map, as last told (setFlares): up a lookout their red light goes up over the trees. */
  private flareList: Array<{ x: number; y: number; left: number }> = [];
  /**
   * The places mended together on this map (works.ts): each footbridge whole and broken (one shows), and
   * each street light of the works with its head's own material (it glows only while it stands); and the
   * ids of those that stand, as the game last said (setWorks).
   */
  private bridges: Array<{ id: string; whole: THREE.Group; broken: THREE.Group }> = [];
  private deadLamp?: THREE.MeshToonMaterial;
  private lampOut = false;
  private worksLamps: Array<{ id: string; mat: THREE.MeshToonMaterial; on: boolean }> = [];
  private standing: Pass | null = null;
  /** The fires of this map: their tiles in the order Fires draws them, how big each burns, and where the game says so. */
  private fireTiles: Array<[number, number]> = [];
  private fireLevels: number[] = [];
  private fireLevel: (x: number, y: number) => number = () => 1;
  /** The old power lines, which hum and glow on aurora nights. */
  private wireMat = new THREE.LineBasicMaterial({ color: 0x0e1115 });
  /** The Old Stone's crystal, brighter while it is awake. */
  private crystalMat = stoneCrystal();
  private stoneAwake = false;
  /** The seams of a slab (slab.ts): dark cracks in the stone, glowing violet like the Old Stone while the woods are restless. */
  private seamMat = ownToon('#2c2a33', { emissive: 0x000000 });
  private slabGlow = false;
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

  /**
   * `peek` finds another map's data by id: a house smokes when the room behind its door keeps a fire.
   * `season`: the one it is built in (its colors, its light, its snow, its ice: `map` frozen or not).
   */
  constructor(
    private readonly renderer: THREE.WebGLRenderer, readonly map: TileMap, private readonly peek: (id: string) => MapData | undefined = () => undefined, readonly season: Season = 'spring',
    readonly home: HomeLook = { house: 1, owner: null },
  ) {
    this.outdoors = map.data.kind !== 'inside';
    // Only your model while a teleport takes you has a plane that cuts it (clipRig); nothing else pays for it.
    renderer.localClippingEnabled = true;
    this.warmRoom = !this.outdoors && hasFire(map.data);
    this.amb = ambience(map.data.kind, this.weather, this.warmRoom, season);
    this.scene.background = new THREE.Color('#4c5961');
    // Inside too, only pushed out of reach: a scene with fog and one without would need different shaders.
    this.scene.fog = new THREE.Fog('#4c5961', 30, 50);
    this.sun.position.set(-4, 10, 6);
    this.scene.add(this.hemi, this.sun, this.flash, this.flashTarget, this.headLight, this.stoneLight, this.flareLight);
    this.creatures = new Creatures(this.shadowGeo, this.shadowMat);
    for (const s of this.slots) this.scene.add(s.light);
    this.flash.target = this.flashTarget;
    for (const b of this.beams) {
      b.light.target = b.target;
      this.scene.add(b.light, b.target);
    }
    if (this.outdoors) this.findOpenings();
    // What never moves or changes is built from hundreds of little boxes; it is drawn as a few meshes (see bake).
    const still: THREE.Object3D[] = [];
    this.buildTerrain(still);
    this.buildNature();
    this.buildTown(still);
    this.buildRoom(still);
    for (const m of bake(still)) this.scene.add(m);
    if (this.outdoors) this.buildEffects();
    this.scene.add(this.liveGlows.root, this.afterglows.root, this.lanterns.root, this.loot.root, this.marks.root, this.creatures.root, this.flares.root, this.flashes.root, this.prints.root, this.echoes.root, this.snowPrints.root);
    this.snowPrints.root.visible = map.data.forest === 'snow';
    // Lights on the Marsh's water, drifting where they drift for everyone.
    if (map.data.forest === 'marsh') {
      const water: Array<[number, number]> = [];
      for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.kind(x, y) === 'water') water.push([x, y]);
      const lights = new MarshLights(water);
      this.scene.add(lights.root);
      this.animate.push(t => lights.update(t));
    }
    if (map.data.kind === 'wilds' && map.data.watchers) this.scene.add((this.farFigure = new FarFigure()).root);
    if (map.data.kind === 'wilds') this.scene.add((this.passer = new Passer()).root);
    this.puffs.push(this.flares.sparks);
    this.animate.push(t => this.loot.update(t));
    this.animate.push(t => { this.marks.update(t); this.flares.update(t); this.flashes.update(t); });
    // Before the fires draw: how big each burns now.
    this.animate.unshift(() => { this.fireTiles.forEach(([x, y], i) => { this.fireLevels[i] = this.fireLevel(x, y); }); });
    this.sources = this.baseSources = lightSources(map);
    // Every place for furniture stands spoiled until the game says what you made (setComfort).
    this.scene.add(this.comfortRoot);
    this.setComfort(new Set(), []);
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.52, 0.66, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe9e6de, transparent: true, opacity: 0.9, depthWrite: false }));
    this.marker.visible = false;
    this.scene.add(this.marker);
    this.setWeather('rain');
    // Compile the shaders now (behind the black screen), not on the first frame you see. What stands at
    // the edge of the fog and the figure of a glimpse are compiled with the rest, showing nothing, and
    // hidden until they are there.
    this.renderer.compile(this.scene, this.camera);
    if (this.farFigure) this.farFigure.root.visible = false;
    if (this.passer) this.passer.root.visible = false;
  }

  /** Frees everything this view put on the GPU. The renderer and the shared toon materials stay for the next map. */
  dispose() {
    // Whatever it drew with stays compiled for the maps that come later (toon.ts, keepPrograms).
    keepPrograms(this.renderer, this.scene);
    for (const p of this.puffs) p.dispose();
    this.loot.dispose();
    this.marks.dispose();
    this.creatures.dispose();
    this.flares.dispose();
    this.liveGlows.dispose();
    this.afterglows.dispose();
    this.lanterns.dispose();
    this.prints.dispose();
    this.snowPrints.dispose();
    this.flashes.dispose();
    this.echoes.dispose();
    disposeTree(this.scene);
    this.scene.clear();
    this.rigs.clear();
    this.animate = [];
    this.wisps = [];
    this.puffs = [];
    this.porches = [];
  }

  /** Height of the ground a character stands on: on water frozen over, the ice. A flooded culvert lies as low as water, and is as full. */
  private topY(x: number, y: number): number {
    return this.map.level(x, y) * 0.55 + (watery(this.map.kind(x, y)) ? (this.map.frozenAt(x, y) ? ICE_Y : -0.34) : 0);
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
    // The ground's color flows from corner to corner (grass.ts): no checkerboard, the same on every visit,
    // and graded by the season it is built in.
    const ground = (this.ground = new Ground(map, this.season)), corner = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()] as const;
    /** A tile's top at height y0, each corner colored; `fade` takes it toward `toward` (the dark past the map's edge). Water frozen over is ice. */
    const top = (kind: TileKind, tx: number, ty: number, y0: number, raised: boolean, fade = 0, toward?: THREE.Color) => {
      if (kind === 'water' && map.frozenAt(tx, ty)) {
        ground.iceColor(tx, ty, tx, ty, corner[0]);
        ground.iceColor(tx, ty + 1, tx, ty, corner[1]);
        ground.iceColor(tx + 1, ty + 1, tx, ty, corner[2]);
        ground.iceColor(tx + 1, ty, tx, ty, corner[3]);
      } else {
        ground.color(kind, tx, ty, tx, ty, raised, corner[0]);
        ground.color(kind, tx, ty + 1, tx, ty, raised, corner[1]);
        ground.color(kind, tx + 1, ty + 1, tx, ty, raised, corner[2]);
        ground.color(kind, tx + 1, ty, tx, ty, raised, corner[3]);
      }
      if (toward) for (const c of corner) c.lerp(toward, fade);
      quad([tx, y0, ty], [tx, y0, ty + 1], [tx + 1, y0, ty + 1], [tx + 1, y0, ty], corner[0], corner[1], corner[2], corner[3]);
    };
    // Outdoors, a building's timbers are weathered; indoors the room is warm if a fire burns in it,
    // concrete if it is one of NAPO's, and boards if it is the mill's.
    const tone = map.data.private ? homeTone(this.home.house) : roomTone(this.warmRoom, map.data.style ?? false);
    this.shapes = wallShapes(map);
    for (let ty = 0; ty < map.height; ty++) for (let tx = 0; tx < map.width; tx++) {
      const kind = map.kind(tx, ty)!, y0 = this.topY(tx, ty), raised = map.level(tx, ty) > 0;
      // A wall is a block of its own; one buried in other walls is not drawn at all (the void is black).
      if (kind === 'wall') { wallTile(quad, map, this.shapes, tx, ty, tone); continue; }
      if (kind === 'floor') floorTile(quad, tx, ty, tone, y0);
      else top(kind, tx, ty, y0, raised);
      for (const [ox, oy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        const ny = map.inside(tx + ox, ty + oy) ? this.topY(tx + ox, ty + oy) : 0;
        if (ny >= y0 - 0.001) continue;
        // The edge of the ice over open water is ice too; the culvert the loggers dug is walled in stone
        // gone grey, where any other bank is earth.
        const w = new THREE.Color(map.frozenAt(tx, ty) ? '#8aa9b5' : map.kind(tx + ox, ty + oy) === 'culvert' ? '#5e5c55' : raised ? '#4f4336' : kind === 'mud' ? '#4a4034' : '#3f3529');
        w.offsetHSL(0, 0, (hash2(tx + ox * 7, ty + oy * 11) - 0.5) * 0.05);
        let a: [number, number], b: [number, number];
        if (oy === -1) { a = [tx, ty]; b = [tx + 1, ty]; } else if (oy === 1) { a = [tx + 1, ty + 1]; b = [tx, ty + 1]; }
        else if (ox === -1) { a = [tx, ty + 1]; b = [tx, ty]; } else { a = [tx + 1, ty]; b = [tx + 1, ty + 1]; }
        quad([a[0], y0, a[1]], [a[0], ny, a[1]], [b[0], ny, b[1]], [b[0], y0, b[1]], w);
      }
    }
    // Past a burnt forest's edge the ground is ash too, and past the Ridge's snow, so no line of green shows where the map ends.
    const W = map.width, H = map.height, outerColor = map.data.forest === 'burnt' ? '#2b2826' : map.data.forest === 'snow' ? '#8d979c' : map.data.forest === 'marsh' ? '#23261c' : '#1b271d';
    // Where an exit leaves the map, its road or trail goes on outside and fades into the dark, so you can see the way on.
    const outer = new THREE.Color(outerColor);
    for (const [key, o] of this.openings) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      top(o.kind, x, y, 0, false, Math.min(1, o.k / (FADE + 1)), outer);
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
    // The pond surface, gently moving; the culvert's water is part of it.
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (watery(map.kind(x, y))) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (x1 >= 0) {
      const wg = new THREE.PlaneGeometry(x1 - x0 + 2.2, y1 - y0 + 2.2, 16, 10).rotateX(-Math.PI / 2);
      this.scene.add(part(wg, ownToon('#1d3a48', { transparent: true, opacity: 0.9 }), (x0 + x1 + 1) / 2, WATER_Y, (y0 + y1 + 1) / 2, false));
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
    // Old growth (the Far Woods): taller firs with cedars among them, and deeper ferns.
    const old = map.data.forest === 'old', burnt = map.data.forest === 'burnt', drowned = map.data.forest === 'marsh';
    // `shade`: it casts a blob shadow. Deep in old growth nobody sees the ground under the crowns, so none
    // there: a block of only such trees costs one draw call less. Nor under the snowy firs of the Ridge, packed
    // as tight on a narrow slope.
    const snow = map.data.forest === 'snow';
    type Tree = { x: number; y: number; z: number; s: number; v: number; cedar: boolean; shade: boolean };
    const trees: Tree[] = this.objects('tree').map(t => ({ x: t.x + 0.5 + (hash2(t.x, t.y) - 0.5) * 0.2, y: t.y + 0.5, z: this.groundAt(t.x, t.y), s: t.s, v: t.v, cedar: old && isCedar(t.x, t.y), shade: true }));
    // Forest tiles: one tree each, sized, turned and nudged by its position, so the woods look the same on every visit.
    for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
      if (map.kind(tx, ty) !== 'forest') continue;
      const deep = old && deepInForest(map, tx, ty);
      trees.push({
        x: tx + 0.5 + (hash2(tx * 7 + 1, ty * 3) - 0.5) * 0.24,
        y: ty + 0.5 + (hash2(tx * 3, ty * 7 + 1) - 0.5) * 0.24,
        z: this.groundAt(tx, ty),
        s: treeSize(hash2(tx * 13, ty * 5 + 3), old, deep),
        v: hash2(tx * 5 + 11, ty * 11),
        cedar: old && isCedar(tx, ty),
        shade: !(deep || (snow && deepInForest(map, tx, ty))),
      });
    }
    // The forest around the map, so its edge never shows. A room has none: it is black around.
    const rng = mulberry32(99);
    for (let y = -RING; y < H + RING && this.outdoors; y++) for (let x = -RING; x < W + RING; x++) {
      if (map.inside(x, y) || rng() >= 0.92) continue;
      const t = { x: x + 0.5 + (rng() - 0.5) * 0.3, y: y + 0.5, z: 0, s: old ? treeSize(rng(), true, false) : 1.1 + rng() * 0.5, v: rng(), cedar: old && isCedar(x, y), shade: false };
      if (!this.openings.has(`${x},${y}`)) trees.push(t);
    }
    const body = treeGeometry(false, this.season), shell = treeGeometry(true), bodyMat = ownToon(0xffffff, { vertexColors: true });
    // A cedar is the fir's shape spread wider and lower, in a warmer green: no draw call of its own.
    const place = (t: Tree, o: THREE.Object3D) => {
      o.position.set(t.x, t.z, t.y);
      o.rotation.y = t.v * 6;
      if (t.cedar) o.scale.set(t.s * CEDAR_SPREAD, t.s * CEDAR_HEIGHT, t.s * CEDAR_SPREAD);
      else if (burnt || drowned) o.scale.set(t.s * SNAG_SPREAD, t.s * SNAG_HEIGHT, t.s * SNAG_SPREAD);
      else o.scale.setScalar(t.s);
    };
    const lookouts = this.objects('lookout').map(o => ({ x: o.x + 1, z: o.y + LOOKOUT_STAND_Z, far: [] as Tree[] }));
    for (const block of blocks(trees)) {
      // In an order of their own, so any first part of a block is trees from all over it: the far look draws only the first half.
      block.sort((a, b) => hash2(Math.floor(a.x * 7), Math.floor(a.y * 11)) - hash2(Math.floor(b.x * 7), Math.floor(b.y * 11)));
      const lod = this.lod(block[0]!.x, block[0]!.y);
      lod.body = this.instanced(body, block, (t, o, c) => { place(t, o); c.setScalar(treeShade(t.v)); if (t.cedar) c.multiply(CEDAR_TINT); if (burnt) c.multiply(SNAG_TINT); if (snow) c.multiply(FROST_TINT); if (drowned) c.multiply(DROWNED_TINT); }, bodyMat, true);
      lod.trees = block.length;
      lod.extras.push(this.instanced(shell, block, place, OUTLINE_INSTANCED));
      // Outside the map the forest is only a backdrop, too dense to see the ground under it: no shadows, one draw call less a block.
      const shaded = block.filter(t => t.shade && map.inside(Math.floor(t.x), Math.floor(t.y)));
      if (shaded.length) lod.extras.push(this.instanced(this.shadowGeo, shaded, (t, o) => { o.position.set(t.x, t.z + 0.012, t.y); o.scale.setScalar(0.46 * t.s); }, this.shadowMat));
      // Seen from up a lookout, a block this far off is half its trees, in the lookout's far forest below.
      for (const l of lookouts) if ((lod.x - l.x) ** 2 + (lod.z - l.z) ** 2 > FAR_BLOCK * FAR_BLOCK) l.far.push(...block.slice(0, Math.ceil(block.length * FAR_TREES)));
    }
    // Each lookout's far forest: the far blocks' halves joined into a few big pieces (FAR_PIECE tiles a side), so the
    // whole view from up there costs a few draw calls more than the view on the ground, not hundreds.
    for (const l of lookouts) {
      const pieces = new Map<string, Tree[]>();
      for (const t of l.far) {
        const key = `${Math.floor(t.x / FAR_PIECE)},${Math.floor(t.y / FAR_PIECE)}`;
        let list = pieces.get(key);
        if (!list) pieces.set(key, (list = []));
        list.push(t);
      }
      const meshes = [...pieces.values()].map(list => {
        const m = this.instanced(body, list, (t, o, c) => { place(t, o); c.setScalar(treeShade(t.v)); if (t.cedar) c.multiply(CEDAR_TINT); if (burnt) c.multiply(SNAG_TINT); if (snow) c.multiply(FROST_TINT); if (drowned) c.multiply(DROWNED_TINT); }, bodyMat, true);
        m.visible = false;
        return m;
      });
      this.farForests.push({ x: l.x, z: l.z, meshes });
    }

    const rocks = this.objects('rock');
    const rockGeo = new THREE.DodecahedronGeometry(0.3, 0);
    const placeRock = (r: (typeof rocks)[number], o: THREE.Object3D) => { o.position.set(r.x + 0.5, this.groundAt(r.x, r.y) + 0.16 * r.s, r.y + 0.5); o.rotation.set(r.v * 3, r.v * 7, 0); o.scale.set(r.s * 1.1, r.s * 0.78, r.s); };
    // Rocks take a frost in winter, like the ground (grass.ts, GRADES: the paved ground's share).
    const frost = GRADES[this.season];
    this.instanced(rockGeo, rocks.filter(r => !r.hum), (r, o, c) => { placeRock(r, o); c.set('#6d6f70').lerp(frost.tint, frost.paved); c.offsetHSL(0, 0, (r.v - 0.5) * 0.06); });
    // The rocks that hum back glow faintly, like the ones in NAPO's cages, the same day and night: one
    // more draw call, only where there are any.
    this.instanced(rockGeo, rocks.filter(r => r.hum), placeRock, HUM, false);
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
    // Deep ferns under old growth: taller and wider fronds, as high as a skulker lying in them.
    const [fw, fh] = old ? DEEP_FERNS : [1, 1];
    const placeFrond = (b: Frond, o: THREE.Object3D, wob = 0) => { o.rotation.order = 'YXZ'; o.position.set(b.x, 0, b.y); o.rotation.set(b.tilt + wob, b.r, 0); o.scale.set(fw, fh * (1 - Math.abs(wob) * 0.4), fw); };
    const frondMat = ownToon(0xffffff);
    /** For each fern tile: its block's mesh and where its fronds start in it. */
    const frondAt = new Map<number, { mesh: THREE.InstancedMesh; start: number; fronds: Frond[] }>();
    for (const block of blocks(fernTiles)) {
      const mesh = this.instanced(frondGeo, block.flatMap(t => t.fronds), (b, o, c) => { placeFrond(b, o); this.ground.plant(c.set(['#2f4f33', '#39603d', '#2a4a30'][b.k % 3]!)); }, frondMat, true);
      this.lod(block[0]!.x, block[0]!.y).extras.push(mesh);
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

    // Grass (grass.ts): low tufts on the grass and knee-high blades in tall grass, each an instanced mesh
    // per block of the trees' blocks, with one material that sways and parts them on the GPU.
    const clumps = this.outdoors ? grassClumps(map, this.ground) : [];
    if (clumps.length) {
      const grass = (this.grass = sessionGrass());
      for (const [blades, tall] of [[TUFT_BLADES, false], [TALL_BLADES, true]] as const) {
        const mine = clumps.filter(c => c.tall === tall);
        if (!mine.length) continue;
        const geo = clumpGeometry(blades);
        for (const block of blocks(mine)) {
          const m = this.instanced(geo, block, (c, o, col) => { o.position.set(c.x, c.h, c.y); o.rotation.y = c.rot; o.scale.set(c.spread, c.height, c.spread); col.copy(c.color); }, grass.material, true);
          // Swaying and parting move the blades a little past where they stand still.
          m.boundingSphere!.radius += 0.35;
          this.lod(block[0]!.x, block[0]!.y).extras.push(m);
        }
      }
    }

    const shrooms: Array<{ x: number; y: number; s: number }> = [];
    // Nothing grows on a slab's stone: the glowcaps drawn where it lies stay under it.
    const slabs = new Set(this.objects('slab').map(o => `${o.x},${o.y}`));
    for (const o of this.objects('shrooms')) if (!slabs.has(`${o.x},${o.y}`)) for (const [sx, sy] of [[0.3, 0.3], [0.7, 0.36], [0.34, 0.72], [0.72, 0.7]] as const) shrooms.push({ x: o.x + sx, y: o.y + sy, s: 0.8 + hash2(o.x * 5 + sx * 10, o.y) * 0.5 });
    this.instanced(flat(new THREE.CylinderGeometry(0.022, 0.03, 0.12, 5)), shrooms, (f, o, c) => { o.position.set(f.x, 0.06 * f.s, f.y); o.scale.setScalar(f.s); c.set('#d9d2c0'); });
    this.instanced(new THREE.IcosahedronGeometry(0.075, 0), shrooms, (f, o) => { o.position.set(f.x, 0.13 * f.s, f.y); o.scale.set(f.s, f.s * 0.55, f.s); }, this.capMat);
  }

  /** Set by buildNature: makes the ferns on a tile rustle. */
  private rustleAt: (x: number, y: number) => void = () => {};

  /** The lookout whose ladder's foot is tile x,y (footOf), if any: asked every frame for whoever climbs, so a plain loop. */
  private lookoutAtFoot(x: number, y: number): { x: number; y: number } | undefined {
    for (const l of this.lookouts) if (l.x + 1 === x && l.y + 2 === y) return l;
    return undefined;
  }

  /** The far look's record of the block the tile (in tile units) lies in, made the first time a block is asked for. */
  private lod(x: number, y: number) {
    const bx = Math.floor(x / CHUNK), by = Math.floor(y / CHUNK), key = `${bx},${by}`;
    let b = this.blockLod.get(key);
    if (!b) this.blockLod.set(key, (b = { x: (bx + 0.5) * CHUNK, z: (by + 0.5) * CHUNK, body: null, trees: 0, extras: [] }));
    return b;
  }

  /**
   * Up a lookout (the view pulled back), the blocks far from you get the cheap look: half their trees, no
   * outlines or shadows, no ferns or grass; down again, all of it. Only switches what is drawn, and how many
   * of a block's trees: no material changes, so nothing is compiled. Done again when you reach another tile.
   */
  private applyLod(fx: number, fz: number) {
    const on = this.zoom > 1.05, tile = Math.floor(fz) * 65536 + Math.floor(fx), fog = (this.scene.fog as THREE.Fog).far;
    if (on === this.lodOn && (!on || tile === this.lodTile)) return;
    this.lodOn = on;
    this.lodTile = tile;
    const cam = this.camera.position;
    // Up a lookout, its far forest stands in for every far block's trees, and near and far go by where you stand up there.
    const tower = on ? this.farForests.find(f => (f.x - fx) ** 2 + (f.z - fz) ** 2 < 16) : undefined;
    const cx = tower?.x ?? fx, cz = tower?.z ?? fz;
    // A piece or a block wholly past where the fog closes in would be drawn the fog's own color: it is not drawn at all.
    const lost = (m: THREE.InstancedMesh) => {
      const b = m.boundingSphere!;
      return Math.hypot(b.center.x - cam.x, b.center.y - cam.y, b.center.z - cam.z) - b.radius > fog;
    };
    for (const f of this.farForests) for (const m of f.meshes) m.visible = f === tower && !lost(m);
    for (const b of this.blockLod.values()) {
      const far = on && (b.x - cx) ** 2 + (b.z - cz) ** 2 > FAR_BLOCK * FAR_BLOCK;
      for (const m of b.extras) m.visible = !far;
      if (b.body) {
        b.body.visible = !far || (!tower && !lost(b.body));
        b.body.count = far ? Math.ceil(b.trees * FAR_TREES) : b.trees;
      }
    }
  }

  /** The distant lights up a lookout (lookout.ts): two sets of points, the small (lamps, masts, flares) and the big (the Old Stone, lit shelters), hidden on the ground. */
  private buildFarLights() {
    this.farList = farLights(this.map.data, this.peek);
    this.farRgb = new Float32Array(this.farList.length * 3);
    const c = new THREE.Color();
    this.farList.forEach((l, i) => { c.set(l.color); this.farRgb[i * 3] = c.r; this.farRgb[i * 3 + 1] = c.g; this.farRgb[i * 3 + 2] = c.b; });
    const make = (size: number) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FAR_LIGHTS * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(FAR_LIGHTS * 3), 3));
      geo.setDrawRange(0, 0);
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({
        size, map: softTexture(0.2), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0,
      }));
      // Each frame they move to where you see them from: their bounds would only be out of date.
      pts.frustumCulled = false;
      pts.visible = false;
      this.scene.add(pts);
      return pts;
    };
    this.farSmall = make(1.4);
    this.farBig = make(3.4);
  }

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
    // The house in a garden of one's own is drawn as its owner built it up (home.ts): a garage, a cabin or a house.
    const chimneys: THREE.Vector3[] = [];
    for (const { house: plain, x: doorX, fire: burning } of houseDoors(this.map, this.peek)) {
      // In winter snow lies on every roof.
      const h = this.season === 'winter' ? { ...plain, roof: new THREE.Color(plain.roof).lerp(ROOF_SNOW, 0.72).getStyle() } : plain;
      if (h.plate) {
        const { root, smoke } = homeModel(h, this.home.house, doorX, { w: DOOR_W, h: DOOR_H, back: DOOR_BACK }, { warm: this.warm, doorGlow: this.doorGlow });
        if (burning) chimneys.push(smoke);
        still.push(root);
        continue;
      }
      const fire = burning;
      if (h.style === 'napo') {
        // One of NAPO's buildings (napo.ts): the same doorway, concrete around it, smoke from a flue.
        const { root, flue } = napoBuilding(h, doorX, fire, { w: DOOR_W, h: DOOR_H, back: DOOR_BACK }, { warm: this.warm, doorGlow: this.doorGlow });
        if (fire) chimneys.push(flue);
        still.push(root);
        continue;
      }
      if (h.style === 'mill') {
        // The old sawmill (left.ts): the same doorway, dark until someone lights its stove again (town.ts);
        // then the doorway glows, its windows warm, and its burner's stack smokes.
        const { root, stack } = millBuilding(h, doorX, { w: DOOR_W, h: DOOR_H, back: DOOR_BACK }, fire ? { warm: this.warm, doorGlow: this.doorGlow } : undefined);
        if (fire) chimneys.push(stack);
        still.push(root);
        continue;
      }
      if (h.style === 'shed') {
        // A board shed (left.ts), its door shut on a padlock: whoever carries what opens it walks in all the same.
        still.push(shedBuilding(h, doorX, { w: DOOR_W, h: DOOR_H }));
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
      const kept = !!h.lit;
      hinge.rotation.y = kept ? -1.95 : -1.68;
      hinge.add(box(DOOR_W - 0.04, DOOR_H - 0.04, 0.05, kept ? '#4a3526' : '#3d352d', (DOOR_W - 0.04) / 2, (DOOR_H - 0.04) / 2 + 0.01, 0, 0.018));
      hinge.add(box(0.04, 0.04, 0.03, '#b09a62', DOOR_W - 0.12, 0.44, 0.04, false));
      g.add(hinge);
      g.add(box(0.66, 0.014, 0.36, '#6d4d35', dx, 0.007, 1.07, false), box(0.52, 0.02, 0.24, '#4a3024', dx, 0.01, 1.07, false));
      // Someone lives in a lit house: a lamp over the door and one warm window. An unlit one is
      // abandoned: dark, windows boarded up; or, where the people left for what they thought would be
      // two weeks, the curtains they drew, which never light.
      if (h.lit) g.add(part(new THREE.BoxGeometry(0.14, 0.1, 0.08), this.warm, dx, 1.0, 0.9, false));
      [-0.85, 0.85].forEach((wx, k) => {
        g.add(box(0.58, 0.5, 0.04, '#2a221b', wx, 0.72, 0.855, false));
        const lit = !!h.lit && k === 0;
        g.add(part(new THREE.BoxGeometry(0.46, 0.38, 0.05), lit ? this.warm : toon('#1c1f24'), wx, 0.72, 0.87, false));
        if (h.curtains) curtainPanels(g, curtainColor(h), wx, 0.72, 0.9, 0.46, 0.38);
        else if (!lit) {
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

    // Cars (left.ts). One of them keeps the headlight, the one farthest from where you arrive: the light
    // is already in the scene, and moving it onto that car keeps the number of lights fixed.
    const cars = this.objects('car'), lit = headlightCar(cars, this.map.data.spawn);
    cars.forEach((c, i) => {
      const car = carModel(c, { head: this.headMat, tail: this.tailMat });
      if (i === lit) {
        const target = new THREE.Object3D();
        target.position.set(0, 0, 6);
        this.headLight.position.set(0, 0.45, 1);
        this.headLight.target = target;
        car.add(this.headLight, target);
        this.hasCar = true;
        // Baking takes the car's meshes; the group stays for the headlight.
        this.scene.add(car);
      }
      still.push(car);
    });

    // The culvert's mouths (a rusted steel pipe half under the water, in its stone headwall), where it opens onto ground.
    for (const m of culvertMouths(this.map)) still.push(culvertMouthModel(m.x, m.y, m.dir));
    // The loggers' fire lookouts: the tower baked with the rest, its lamp glowing while it burns, and its beam.
    const lookouts = this.objects('lookout');
    if (lookouts.length) {
      const beamGeo = beamGeometry();
      for (const o of lookouts) {
        still.push(lookoutModel(o, this.beamLampMat));
        const beam = new THREE.Mesh(beamGeo, this.beamMat);
        beam.position.set(o.x + 1, LOOKOUT_LAMP_Y, o.y + 1);
        beam.visible = false;
        // It turns every frame: its bounds are the whole circle it sweeps.
        beam.frustumCulled = false;
        this.scene.add(beam);
        this.lookouts.push({ x: o.x, y: o.y, beam });
      }
      this.buildFarLights();
    }
    // In a home the board is the map table, drawn with the room (buildRoom).
    if (!this.map.data.private) for (const b of this.objects('board')) still.push(boardModel(b.x, b.y));
    for (const s of this.objects('sign')) {
      if (s.style === 'napo') { still.push(napoSign(s)); continue; }
      if (s.style === 'mailbox') { still.push(mailboxModel(s)); continue; }
      if (s.style === 'cardboard') { still.push(cardboardModel(s)); continue; }
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
      // The head keeps its own glowing material: all the lamp heads become one mesh of their own. One the
      // town has not mended yet (town.ts) stands dark, its glass broken grey. A lamp mended together has one
      // of its own, dark until it stands, and its plaque on the post.
      let head: THREE.Material | string = l.dark ? '#3a3f45' : this.lampMat;
      // The lamp with no wires has a head of its own, which goes dark when it goes out (setLampOut).
      if (!l.dark && this.map.data.id === LAMP.map && l.x === LAMP.x && l.y === LAMP.y) head = this.deadLamp = ownToon('#ffcf8a', { emissive: 0x000000 });
      if (l.works) {
        const mat = ownToon('#ffcf8a', { emissive: 0x000000 });
        this.worksLamps.push({ id: l.works, mat, on: false });
        head = mat;
        g.add(box(0.14, 0.1, 0.02, '#8a7a52', 0, 0.86, 0.07, 0.01));
      }
      g.add(box(0.42, 0.05, 0.08, '#2f343c', 0.18, 1.3, 0), part(new THREE.BoxGeometry(0.2, 0.1, 0.16), head, 0.34, 1.24, 0, 0.02));
      still.push(g);
    }
    // A roof on posts the town built (town.ts): over the notice board, where the rain keeps off. Its roof
    // fades while someone stands under it, whom this camera would otherwise not see.
    for (const p of this.objects('porch')) {
      const { posts, roof } = porchModel(p);
      still.push(posts);
      this.scene.add(roof);
      this.porches.push({ roof, x0: p.x, y0: p.y, x1: p.x + p.w, y1: p.y + p.h, k: 1 });
    }
    // The footbridges mended together: their sills always, the bridge whole or broken as it stands (setWorks),
    // each baked into its own few meshes so that showing one or the other is only a switch.
    for (const b of this.objects('footbridge')) {
      const m = footbridgeModel(b), whole = new THREE.Group(), broken = new THREE.Group();
      still.push(m.sills);
      for (const mesh of bake([m.whole])) whole.add(mesh);
      for (const mesh of bake([m.broken])) broken.add(mesh);
      whole.visible = false;
      this.scene.add(whole, broken);
      this.bridges.push({ id: b.id, whole, broken });
    }
    // Utility poles with sagging wires, in the order the map lists them.
    const poles = this.objects('pole');
    const within = (p: (typeof poles)[number], q?: (typeof poles)[number]) => (q && Math.hypot(q.x - p.x, q.y - p.y) <= MAX_WIRE ? q : undefined);
    const tops = poles.map((p, i) => {
      const next = within(p, poles[i + 1]) ?? within(p, poles[i - 1]);
      const g = new THREE.Group();
      g.position.set(p.x + 0.5, 0, p.y + 0.5);
      if (next) g.rotation.y = Math.atan2(next.x - p.x, next.y - p.y) + Math.PI / 2;
      // The woods' poles of the north line lean (the dead line puzzle): tilted about the foot, so the wires still meet the tops.
      const lean = poleLean(poleTag(this.map.data, p.x, p.y));
      if (lean) g.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...lean.axis), lean.angle));
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

    // Radio masts (napo.ts): their lights all blink together, a short flash every 1.6 seconds. A broken
    // one has no light left to blink.
    const masts = this.objects('antenna');
    for (const a of masts) still.push(towerModel(a.x, a.y, this.beaconMat, a.broken));
    if (masts.some(a => !a.broken)) this.animate.push(t => { this.beaconMat.emissive.setHex(t % 1.6 < 0.3 ? 0xff3322 : 0x1a0604); });

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

    // A slab in the middle of a ring of stones (slab.ts): flat stone set in the ground, cracked along its
    // seams, which glow violet like the Old Stone's crystal while the woods are restless, and pulse.
    const slabs = this.objects('slab');
    for (const sl of slabs) {
      const g = new THREE.Group();
      g.position.set(sl.x + 0.5, 0, sl.y + 0.5);
      g.rotation.y = (hash2(sl.x, sl.y) - 0.5) * 0.3;
      g.add(box(0.94, 0.08, 0.86, '#6f6b63', 0, 0.04, 0, 0.02), box(0.8, 0.02, 0.72, '#7b776e', 0, 0.085, 0, false));
      still.push(g);
      const seams = new THREE.Group();
      seams.position.copy(g.position);
      seams.rotation.y = g.rotation.y;
      for (const [x, z, len, turn] of [[-0.12, -0.05, 0.62, 0.35], [0.18, 0.12, 0.4, -0.9], [-0.25, 0.22, 0.3, 1.3], [0.2, -0.22, 0.34, 0.2]] as const) {
        const seam = part(new THREE.BoxGeometry(len, 0.012, 0.035), this.seamMat, x, 0.1, z, false);
        seam.rotation.y = turn;
        seams.add(seam);
      }
      this.scene.add(seams);
    }
    if (slabs.length) this.animate.push(t => { if (this.slabGlow) this.seamMat.emissive.setHex(0x8a4dff).multiplyScalar(0.55 + 0.45 * Math.sin(t * 2.2)); });

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
    // Furniture (interior.ts), what the town and the leavers left (left.ts) and NAPO's things (napo.ts):
    // wherever they stand, in a room or out of doors.
    // A bridge's rails run along its outer sides only: it looks at the bridge beside it (bridgeRails).
    const bridges = new Set(this.objects('bridge').map(b => `${b.x},${b.y}`));
    for (const o of map.data.objects) {
      // In a home, the kitchen and the map table once the house is built up to them (house.ts), boxes before.
      const later = map.data.private && (o.kind === 'kitchen' || o.kind === 'board');
      const m = later ? (!builtIn(o, this.home.house) ? boxesModel(o) : o.kind === 'kitchen' ? kitchenModel(o, map) : mapTableModel(o))
        : o.kind === 'hearth' ? coldHearthModel(o.x, o.y)
        : o.kind === 'bridge' ? bridgeModel(o, bridgeRails(o, (x, y) => bridges.has(`${x},${y}`)))
        : o.kind === 'note' ? noteModel(o, map)
        : furnitureModel(o, map) ?? leftModel(o) ?? napoProp(o);
      if (m) still.push(m);
    }
    // NAPO's teleports: the rock over each arch floats, turning slowly, over a glow that breathes, and a ring of
    // light spreads from the middle of the plate to its rim, fading, every two seconds.
    const cores = (this.teleports = this.objects('teleport').map(o =>
      teleportCore(o, { rock: HUM, glow: this.teleportGlow, ripple: this.teleportRipple, light: this.teleportLight, column: this.teleportColumn })));
    for (const c of cores) this.scene.add(c.root);
    if (cores.length) {
      this.animate.push(t => {
        const k = (t * 0.5) % 1;
        cores.forEach((c, i) => {
          c.rock.position.y = TELEPORT_ROCK_Y + Math.sin(t * 1.6 + i) * 0.035;
          c.rock.rotation.y = t * 0.7;
          c.ripple.scale.setScalar(0.2 + 0.8 * k);
        });
        this.teleportGlow.opacity = 0.42 + 0.14 * Math.sin(t * 2.1);
        this.teleportRipple.opacity = 0.6 * (1 - k) * Math.min(1, k * 6);
      });
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
    const comfortShadows = this.objects('comfort').flatMap(o => { const s = comfortShadow(o); return s ? [s] : []; });
    this.instanced(this.shadowGeo, [...furnitureShadows(map), ...comfortShadows], ([x, z, rx, rz], o) => { o.position.set(x, BLOB_Y, z); o.scale.set(rx, 1, rz); }, this.shadowMat);
    if (this.outdoors) return;
    const light: Array<readonly [number, number, number, number]> = [];
    // The house of people who left has its curtains drawn inside too, in the same cloth as from the street.
    const curtains = roomCurtains(map.data, this.peek);
    for (const w of windowSpots(map, this.shapes)) {
      still.push(windowModel(w.x, w.y, this.paneMat, !this.warmRoom, curtains));
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
      // Snow falls a sixth as fast as rain, in short flakes that sway as they come down.
      const snow = this.snowing, fall = snow ? 0.16 : 1, len = snow ? 0.06 : 0.45, lean = snow ? 0.02 : 0.07;
      this.drift += dt;
      for (let i = 0; i < RAIN; i++) {
        const d = drops[i]!;
        d.y -= d.s * fall * dt;
        if (d.y < 0) { d.y += 12; d.x = rng() * 30 - 15; d.z = rng() * 30 - 15; }
        const X = focus.x + d.x + (snow ? Math.sin(this.drift * 0.9 + i) * 0.35 : 0), Z = focus.y + d.z, o = i * 6;
        rainPos[o] = X; rainPos[o + 1] = d.y + len; rainPos[o + 2] = Z;
        rainPos[o + 3] = X + lean; rainPos[o + 4] = d.y; rainPos[o + 5] = Z + lean * 0.4;
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
    const plain = ambience(this.map.data.kind, w, this.warmRoom, this.season);
    const a = (this.amb = this.map.data.forest === 'old' ? underOldGrowth(plain) : this.map.data.forest === 'snow' ? onSnow(plain) : plain);
    this.hemi.color.set(a.hemi.sky);
    this.hemi.groundColor.set(a.hemi.ground);
    this.hemi.intensity = a.hemi.intensity * L;
    this.sun.color.set(a.sun.color);
    this.sun.intensity = a.sun.intensity * L;
    (this.scene.background as THREE.Color).set(a.sky);
    (this.scene.fog as THREE.Fog).color.set(a.sky);
    this.lampMat.emissive.set(a.lampGlow);
    this.deadLamp?.emissive.set(this.lampOut ? 0x000000 : a.lampGlow);
    for (const l of this.worksLamps) if (l.on) l.mat.emissive.set(a.lampGlow);
    this.warm.emissive.set(a.warmGlow);
    this.doorGlow.emissive.set(a.warmGlow);
    this.flash.intensity = a.flashlight ? 1.6 * L : 0;
    this.headLight.intensity = a.carLights && this.hasCar ? 1.3 * L : 0;
    this.headMat.emissive.set(a.carLights ? '#fff1c4' : '#000000');
    this.tailMat.emissive.set(a.carLights ? '#c8281c' : '#000000');
    this.capMat.emissive.set(a.capGlow);
    if (this.rain) this.rain.visible = !!a.rain || this.storm;
    // In winter it snows, and a storm drives snow too.
    const falls = a.snow ? SNOW : a.rain;
    if (falls) { this.rainMat.color.set(falls.color); this.rainMat.opacity = falls.opacity; }
    this.snowing = a.snow;
    if (a.mist) { this.mistMat.color.set(a.mist.color); this.mistMat.opacity = a.mist.opacity; }
    this.wispMat.opacity = a.wisps;
    this.smoke?.puffs.color.set(a.smoke);
    this.paneMat.emissive.set(a.window.glow);
    if (this.skyLight) this.skyLight.opacity = a.window.light;
    this.loot.setGlow(lootGlow(this.map.data.kind, w, this.warmRoom));
    // On aurora nights the dead power lines hum again: their wires glow.
    this.wireMat.color.set(w === 'aurora' ? '#62ffc8' : '#0e1115');
    this.grass?.setWind(this.storm && this.outdoors ? STORM_WIND : WIND[w]);
    this.applySurge();
    this.updateFog();
  }

  /**
   * What stands in your cabin's places for furniture (comfort.ts): `made`, the places whose furniture you
   * made (the rest stand spoiled), and on the trophy shelf the charms and anomalous gear of your stash.
   * Built again only when that changed; a map without such places ignores it. A lamp made lights the room.
   */
  setComfort(made: ReadonlySet<Comfort>, trophies: readonly ItemDef[]) {
    const places = this.objects('comfort');
    if (!places.length) return;
    const key = `${[...made].sort().join()}|${made.has('shelf') ? trophies.map(t => t.id).join() : ''}`;
    if (key === this.comfortKey) return;
    this.comfortKey = key;
    disposeTree(this.comfortRoot);
    this.comfortRoot.clear();
    const built = places.map(o => comfortModel(o, made.has(o.what), this.map, o.what === 'shelf' ? trophies : []));
    for (const m of bake(built)) this.comfortRoot.add(m);
    const lamp = places.find(o => o.what === 'lamp' && made.has('lamp'));
    this.sources = lamp ? [...this.baseSources, { kind: 'lamp', ...lampLight(lamp), flicker: false, ph: 0, tx: lamp.x, ty: lamp.y }] : this.baseSources;
    // The real lights are handed out again on the next frame, the lamp among them.
    this.lightTile = NaN;
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

  /** The footprints in the snow here, oldest first, each with how far it has faded: when they change. */
  setSnowPrints(list: ReadonlyArray<{ x: number; y: number; dir: Dir; faded: number }>) {
    this.snowPrints.set(list, (x, y) => this.groundAt(x, y));
  }

  /** Where players walk whose gear makes street lights flicker as they pass (a quirk): every frame. */
  setFlickerAt(list: Array<{ x: number; y: number }>) {
    this.flickerAt = list;
  }

  setFlares(list: Array<{ x: number; y: number; left: number }>, focus: { x: number; y: number }) {
    this.flareList = list;
    const near = [...list].sort((a, b) => Math.hypot(a.x - focus.x, a.y - focus.y) - Math.hypot(b.x - focus.x, b.y - focus.y));
    this.flares.set(near, (x, y) => this.groundAt(x, y));
  }

  /** The flashes on this map, every frame; the nearest to the player are drawn. */
  setFlashes(list: FlashView[]) {
    this.flashes.set(list, (x, y) => this.groundAt(x, y));
  }

  /**
   * The fire lookouts' lamps, every frame: `left(x, y)` how long the one of the lookout whose corner is x,y
   * burns on (0: out), and `wall` the server's clock (ms since the epoch), which turns every beam (beamAngle).
   * A lamp that burns glows in its cab, and its beam sweeps the woods, for everyone on the map to see.
   */
  setLamps(left: (x: number, y: number) => number, wall: number) {
    const angle = beamAngle(wall);
    let lit = false;
    for (const l of this.lookouts) {
      const burning = left(l.x, l.y) > 0;
      l.beam.visible = burning && this.outdoors;
      if (burning) { l.beam.rotation.y = -angle; lit = true; }
    }
    this.beamLampMat.emissive.setHex(lit ? 0xffe2a0 : 0x000000);
  }

  /** Is the tile x,y the lamp with no wires, while it is out (line.ts)? Its light, near and far, stays off. */
  private isDeadLamp(x: number, y: number): boolean {
    return this.lampOut && this.map.data.id === LAMP.map && x === LAMP.x && y === LAMP.y;
  }

  setLampOut(out: boolean) {
    if (out === this.lampOut) return;
    this.lampOut = out;
    this.deadLamp?.emissive.set(out ? 0x000000 : this.amb.lampGlow);
  }

  /**
   * The places mended together, every frame (works.ts): `standing` holds the ids of those that stand (the
   * game's pass does). A footbridge shows whole or broken, and a street light of the works glows, and
   * carries a real light, only while it stands. Only what shows and colors change: nothing is compiled.
   */
  setWorks(standing: Pass) {
    this.standing = standing;
    for (const b of this.bridges) {
      const on = standing.has(b.id);
      b.whole.visible = on;
      b.broken.visible = !on;
    }
    for (const l of this.worksLamps) {
      const on = standing.has(l.id);
      if (on === l.on) continue;
      l.on = on;
      l.mat.emissive.set(on ? this.amb.lampGlow : 0x000000);
    }
  }

  /** How far the view is pulled back, every frame (1 on the ground, LOOKOUT_ZOOM up a lookout): the camera's radius, the fog, the far look and the distant lights follow it. */
  setZoom(zoom: number) {
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    this.updateFog();
  }

  /** A storm over this map: a dark sky, closer fog, heavy rain and lightning (outdoors only). */
  setStorm(on: boolean) {
    if (on === this.storm) return;
    this.storm = on;
    if (this.outdoors) this.setWeather(this.weather);
  }

  /**
   * Something at the edge of the fog (unease.ts) standing on tile x,y, showing `k` of itself (0: nothing
   * there): every frame. A map where no watchers roam has none.
   */
  setApparition(x: number, y: number, k: number) {
    this.farFigure?.set(x, y, k, k > 0 ? this.groundAt(x + 0.5, y + 0.5) : 0);
  }

  /**
   * Someone's steps, glimpsed (glimpses.ts): their figure at x,y (tiles), heading `heading`, walking or not, in
   * their jacket `color`, showing `k` of itself (0: none): every frame. Only a map of the wilds has one.
   */
  setGlimpse(x: number, y: number, heading: number, walking: boolean, color: string, k: number) {
    this.passer?.set(x, y, k > 0 ? this.groundAt(x + 0.5, y + 0.5) : 0, heading, walking, color, k);
  }

  /**
   * How far out on the screen something standing on tile x,y is seen, from its feet to a head FAR_FIGURE_H
   * up: the larger of across and up, 0 in the middle to 1 at the edge (more: off it); null behind the camera.
   * As last drawn: for what stands at the edge of the fog (unease.ts, EdgeOf). `covered` says whether a
   * point of the canvas (CSS pixels from its top left) is hidden under the HUD: seen there it counts as not
   * seen at all (null), feet, middle or head.
   */
  edgeOf(x: number, y: number, covered?: (px: number, py: number) => boolean): number | null {
    let most = 0;
    for (const lift of [0, FAR_FIGURE_H / 2, FAR_FIGURE_H]) {
      const e = this.edgeAt(x, y, lift);
      if (e === null) return null;
      if (covered && covered((this.tmp.x + 1) / 2 * this.width, (1 - this.tmp.y) / 2 * this.height)) return null;
      most = Math.max(most, e);
    }
    return most;
  }

  private edgeAt(x: number, y: number, lift: number): number | null {
    this.tmp.set(x + 0.5, this.groundAt(x + 0.5, y + 0.5) + lift, y + 0.5).project(this.camera);
    return this.tmp.z > 1 ? null : Math.max(Math.abs(this.tmp.x), Math.abs(this.tmp.y));
  }

  /** The piles on this map, for the echoes that walk to them: call it when they change or you move to another tile. */
  setEchoes(drops: Iterable<DropView>, focus: { x: number; y: number }) {
    this.echoes.set(drops, focus);
  }

  /** The woods are restless: a slab's seams glow (slab.ts), pulsing; calm, they are dark cracks again. */
  setSlab(glow: boolean) {
    if (glow === this.slabGlow) return;
    this.slabGlow = glow;
    if (!glow) this.seamMat.emissive.setHex(0x000000);
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
    const fog = this.scene.fog as THREE.Fog, f = this.amb.fog, d = this.dist * this.zoom;
    if (!f) { fog.near = 1e4; fog.far = 2e4; return; }
    // A storm leaves less to see; up a lookout the far look fades into the fog at the view's edge.
    const storm = this.storm && this.outdoors ? 0.6 : 1, far = 1 - FAR_FOG * upness(this.zoom);
    fog.near = Math.max(1, d - 1.5);
    fog.far = d + Math.max(f.min, d * f.share) * storm * far;
    // Thick fog (a condition) closes in whatever the weather.
    if (this.fogCap !== undefined && this.outdoors) fog.far = Math.min(fog.far, d + this.fogCap);
  }

  /** Size in CSS pixels. The camera keeps the same circle of world around the player on every screen shape. */
  resize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    // Up to twice the screen's CSS pixels, a step fewer while a slow phone needs it, never fewer than one each.
    const top = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    this.renderer.setPixelRatio(Math.max(Math.min(1, top), top * this.pixelScale));
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
    let fx = focus.x + 0.5, fz = focus.y + 0.5, gy = this.groundAt(fx, fz);
    for (const a of this.animate) a(t, dt);
    this.animateRain({ x: fx, y: fz }, dt);
    this.grass?.update(t);
    this.syncAvatars(avatars, meId, fx, fz, dt);
    // Climbing a lookout, and up there, the view follows you up the ladder onto its platform.
    if (this.climbing > 0) {
      const k = this.climbing;
      fx += (this.climbAt.x - fx) * k; fz += (this.climbAt.z - fz) * k; gy += (this.climbAt.y - gy) * k;
    }
    const dist = this.dist * this.zoom;
    this.camera.position.set(fx, gy + Math.sin(this.pitch) * dist, fz + Math.cos(this.pitch) * dist);
    this.camera.lookAt(fx, gy + 0.4, fz);
    this.applyLod(fx, fz);
    this.drawFarLights(fx, fz, t);
    const carriers = avatars.filter(a => a.live).map(a => ({ x: a.x + 0.5, z: a.y + 0.5, d: Math.hypot(a.x - focus.x, a.y - focus.y) }));
    this.liveGlows.set(carriers.sort((a, b) => a.d - b.d).map(c => ({ x: c.x, y: this.groundAt(c.x, c.z), z: c.z })), t);
    const glowing = avatars.filter(a => a.afterglow).map(a => ({ x: a.x + 0.5, z: a.y + 0.5, d: Math.hypot(a.x - focus.x, a.y - focus.y) }));
    this.afterglows.set(glowing.sort((a, b) => a.d - b.d).map(c => ({ x: c.x, y: this.groundAt(c.x, c.z), z: c.z })), t);
    const lit = avatars.filter(a => a.lantern).map(a => ({ x: a.x + 0.5, z: a.y + 0.5, d: Math.hypot(a.x - focus.x, a.y - focus.y) }));
    this.lanterns.set(lit.sort((a, b) => a.d - b.d).map(c => ({ x: c.x, y: this.groundAt(c.x, c.z), z: c.z })), t);
    this.creatures.sync(this.creatureList, t, (x, z) => this.groundAt(x, z));
    for (const c of this.creatureList) if (c.moving) this.rustleAt(c.x + 0.5, c.y + 0.5);
    this.echoes.update(t, (x, z) => this.groundAt(x, z));
    for (const r of this.porches) {
      // Under it, or a row in front, where its roof comes between this camera and whoever stands there.
      const under = avatars.some(a => a.x + 0.5 >= r.x0 && a.x + 0.5 < r.x1 && a.y + 0.5 >= r.y0 && a.y + 0.5 < r.y1 + 1);
      r.k += ((under ? 0.22 : 1) - r.k) * Math.min(1, dt * 8);
      (r.roof.material as THREE.MeshToonMaterial).opacity = r.k;
    }
    this.farFigure?.update(t, fx, fz);
    this.passer?.update(t);
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
      if (this.isDeadLamp(src.tx, src.ty)) { s.light.intensity = 0; continue; }
      // A street light mended together shines only while it stands.
      if (src.works && !this.standing?.has(src.works)) { s.light.intensity = 0; continue; }
      // Some lamps flicker now and then; any lamp flickers hard while someone with a flickering quirk passes under it.
      const restless = this.flickerAt.some(p => (p.x + 0.5 - src.x) ** 2 + (p.y + 0.5 - src.z) ** 2 < 9);
      const off = (src.flicker && (Math.sin(t * 13 + src.ph) > 0.92 || Math.sin(t * 2.3 + src.ph) > 0.97)) || (restless && Math.sin(t * 29 + src.ph) * Math.sin(t * 7.3) > 0.1) ? 0.15 : 1;
      s.light.intensity = lamp * off * s.on;
    }
  }

  /**
   * The distant lights seen from up a lookout, fading in as the view pulls back: every one that never moves
   * where it is, or on the view's edge in its real direction (placeFar), and the flares burning, their red
   * light going up over the trees. Nothing is made: the points' buffers are filled in place.
   */
  private drawFarLights(fx: number, fz: number, t: number) {
    const small = this.farSmall, big = this.farBig, k = upness(this.zoom);
    if (!small || !big) return;
    small.visible = big.visible = k > 0.02;
    if (!small.visible) return;
    (small.material as THREE.PointsMaterial).opacity = k;
    (big.material as THREE.PointsMaterial).opacity = k;
    // Past this the view does not reach, up there: a light farther off shows on its edge.
    const reach = 6.2 * this.zoom * 0.92, at = this.farAt, rgb = this.farRgb, fl = this.flareAt;
    let ns = 0, nb = 0;
    for (let i = 0; i < this.farList.length; i++) {
      const l = this.farList[i]!;
      if (l.works && !this.standing?.has(l.works)) continue;
      if (l.tx !== undefined && this.isDeadLamp(l.tx, l.ty!)) continue;
      placeFar(l, fx, fz, reach, at);
      const glow = farGlow(l.kind, t);
      if (l.size > 2 || at.far) { if (nb < FAR_LIGHTS) putPoint(big, nb++, at, rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!, glow * (at.far ? 0.7 : 1)); }
      else if (ns < FAR_LIGHTS) putPoint(small, ns++, at, rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!, glow);
    }
    for (const f of this.flareList) {
      if (ns >= FAR_LIGHTS) break;
      fl.x = f.x + 0.5; fl.z = f.y + 0.5; fl.y = 1.4 + (1 - Math.min(1, f.left / 45)) * 2.6;
      placeFar(fl, fx, fz, reach, at);
      putPoint(small, ns++, at, FLARE_FAR.r, FLARE_FAR.g, FLARE_FAR.b, 0.8 + 0.2 * Math.sin(t * 17 + f.x));
    }
    endPoints(small, ns);
    endPoints(big, nb);
  }

  /** The players as the game has them now: their models, crouched in tall grass, and the nearest to (fx, fz) parting the grass. */
  private syncAvatars(avatars: Avatar[], meId: string | null, fx: number, fz: number, dt: number) {
    const seen = new Set<string>();
    const held: Held[] = [];
    let beam: { pose: BeamPose; pad: { x: number; y: number }; t: number } | null = null;
    this.partD.fill(Infinity);
    for (const a of avatars) {
      seen.add(a.id);
      let e = this.rigs.get(a.id);
      const x = a.x + 0.5, z = a.y + 0.5, gy = this.groundAt(x, z);
      // Everyone's tile is known, so everyone sees who crouches in tall grass (someone down lies there instead), and who wades the culvert.
      const inGrass = hidden(this.map, Math.floor(x), Math.floor(z)) && !a.down;
      const inWater = this.map.kind(Math.floor(x), Math.floor(z)) === 'culvert';
      // A new jacket or new gear: the character is built again in it (as crouched, as slumped and as deep in the water as it was).
      const look = JSON.stringify(a.look ?? {});
      if (!e || e.color !== a.color || e.look !== look) {
        const crouch = e ? e.crouch : inGrass ? 1 : 0, slump = e ? e.slump : a.down ? 1 : 0, wade = e ? e.wade : inWater ? 1 : 0, climb = e ? e.climb : a.up ? 1 : 0;
        if (e) this.dropRig(e);
        e = { rig: makePlayer(a.color, a.look), color: a.color, look, shadow: this.blob(0.3, 0, 0), crouch, slump, wade, climb };
        // Turned to face first, then leaned: a crouch leans forward whichever way they face.
        e.rig.root.rotation.order = 'YXZ';
        this.scene.add(e.rig.root, e.shadow);
        this.rigs.set(a.id, e);
      }
      const { rig } = e;
      const c = (e.crouch = crouchToward(e.crouch, inGrass, dt));
      const k = (e.slump = Math.min(1, Math.max(0, e.slump + (a.down ? dt : -dt) / SLUMP_TIME)));
      // Down, they lie over their own tile: drawn back against the way they face as they lean.
      const [bx, bz] = DIR_VEC[a.dir], back = SLUMP_BACK * k;
      // Wading, the water comes up to the waist: sinking in as they step down into it, as quick as a crouch.
      const wd = (e.wade = crouchToward(e.wade, inWater, dt));
      // Crouched, only the head and shoulders show over the grass, and the step is shorter.
      rig.root.position.set(x - bx * back, gy + (a.moving ? Math.abs(Math.sin(a.phase)) * 0.045 * (1 - c * 0.6) : 0) - CROUCH_DROP * c - WADE_DROP * wd + SLUMP_LIFT * k, z - bz * back);
      rig.root.rotation.set(CROUCH_LEAN * c + SLUMP_LEAN * k, FACE[a.dir], SLUMP_ROLL * k);
      // On the water, the shadow lies on its surface.
      e.shadow.position.set(x, wd > 0.5 ? WATER_Y + 0.01 : gy + BLOB_Y, z);
      // Up a lookout: up the ladder from its foot onto the platform, in front of the cab, and down again.
      const cl = (e.climb = climbToward(e.climb, !!a.up, dt));
      const tower = cl > 0 ? this.lookoutAtFoot(Math.round(a.x), Math.round(a.y)) : undefined;
      if (tower) {
        const k = cl * cl * (3 - 2 * cl), spread = (hash2(a.id.length * 31 + a.id.charCodeAt(0), a.id.charCodeAt(a.id.length - 1)) - 0.5) * 0.8;
        rig.root.position.set(x + (tower.x + 1 + spread - x) * k, gy + (LOOKOUT_DECK + 0.06 - gy) * k, z + (tower.y + LOOKOUT_STAND_Z - z) * k);
        e.shadow.visible = k < 0.5;
        if (a.id === meId) { this.climbing = k; this.climbAt.copy(rig.root.position); }
      } else {
        e.shadow.visible = true;
        if (a.id === meId) this.climbing = 0;
      }
      const sw = (a.moving ? Math.sin(a.phase) * 0.95 : a.turnT > 0 ? Math.sin((1 - a.turnT / 0.14) * Math.PI) * 0.45 : 0) * (1 - c * 0.45) * (1 - k);
      rig.legL.rotation.x = sw + 0.25 * k; rig.legR.rotation.x = -sw - 0.1 * k;
      // The arms come forward as if pushing the grass aside; down, they lie loose, one flung ahead.
      rig.armL.rotation.x = -sw * 0.7 - c * 0.55 - 0.5 * k; rig.armR.rotation.x = sw * 0.7 - c * 0.55 - 2.1 * k;
      // You, while NAPO's teleport takes you (beam.ts): onto the pad and round, then gone from your feet up; or
      // back from your head down on the pad and off it onto your tile. Only your own screen has it.
      const pose = a.beam ? beamPose(a.beam.phase, a.beam.t) : null;
      this.clipRig(e, !!pose);
      rig.root.visible = e.shadow.visible = !pose || pose.gone < 1;
      if (pose && a.beam) {
        const pad = a.beam.pad, px = pad.x + 0.5, pz = pad.y + 0.5;
        const bx = x + (px - x) * pose.onPad, bz = z + (pz - z) * pose.onPad, by = this.groundAt(bx, bz) + 0.1 * pose.onPad;
        rig.root.position.set(bx, by, bz);
        rig.root.rotation.set(0, FACE[dirToward(pad.x - Math.round(a.x), pad.y - Math.round(a.y))] + Math.PI * pose.turn, 0);
        const step = pose.walking ? Math.sin(a.beam.t * 30) * 0.95 : 0;
        rig.legL.rotation.x = step; rig.legR.rotation.x = -step;
        rig.armL.rotation.x = -step * 0.7; rig.armR.rotation.x = step * 0.7;
        this.beamPlane.constant = -(by - 0.02 + pose.gone);
        e.shadow.position.set(bx, by + BLOB_Y, bz);
        beam = { pose, pad, t: a.beam.t };
      }
      if (a.moving) this.rustleAt(x, z);
      this.parter(x, z, (x - fx) ** 2 + (z - fz) ** 2);
      // Whatever clings to your back rides along.
      if (a.hitched && !e.hitch) e.rig.root.add((e.hitch = hitchhikerModel()));
      if (e.hitch) e.hitch.visible = !!a.hitched;
      if (this.amb.flashlight) {
        const [dx, dy] = DIR_VEC[a.dir];
        // Held where the hands are: lower while crouched, or it would light the top of your own cap.
        const h = { id: a.id, x: x + dx * 0.2, y: gy + 0.75 - CROUCH_DROP * c - WADE_DROP * wd, z: z + dy * 0.2, tx: x + dx * 4, ty: gy, tz: z + dy * 4 };
        if (a.id !== meId) held.push(h);
        else {
          this.flash.position.set(h.x, h.y, h.z);
          this.flashTarget.position.set(h.tx, h.ty, h.tz);
          this.flashTarget.updateMatrixWorld();
        }
      }
    }
    this.lightBeams(held, fx, fz, dt);
    this.driveBeam(beam);
    this.popsOn(dt);
    for (const [id, e] of this.rigs) if (!seen.has(id)) { this.dropRig(e); this.rigs.delete(id); }
    if (this.grass) for (let i = 0; i < PARTERS; i++) this.grass.part(i, this.partX[i]!, this.partZ[i]!, this.partD[i]! < Infinity ? 1 : 0);
  }

  /**
   * Your model while a teleport takes you (beam.ts): its meshes drawn with copies of their materials that
   * beamPlane cuts, so you go from your feet up and come back from your head down; the materials are put back
   * after. Everyone else's model, and yours the rest of the time, keeps the materials all of them share.
   */
  private clipRig(e: RigEntry, on: boolean) {
    if (on === !!e.clipped) return;
    if (on) {
      const clipped = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
      const cut = (m: THREE.Material) => {
        const c = m.clone();
        c.clippingPlanes = [this.beamPlane];
        return c;
      };
      e.rig.root.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return;
        clipped.set(o, o.material);
        o.material = Array.isArray(o.material) ? o.material.map(cut) : cut(o.material);
      });
      e.clipped = clipped;
      return;
    }
    for (const [mesh, had] of e.clipped!) {
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
      mesh.material = had;
    }
    e.clipped = undefined;
  }

  /** The rings, column and sparks of the teleport taking you, `t` seconds into the trip (beam.ts); none without one. */
  private driveBeam(b: { pose: BeamPose; pad: { x: number; y: number }; t: number } | null) {
    const { low, high } = TELEPORT_RINGS, lerp = THREE.MathUtils.lerp;
    for (const c of this.teleports) {
      const p = b && c.root.position.x === b.pad.x + 0.5 && c.root.position.z === b.pad.y + 0.5 ? b.pose : null, t = b?.t ?? 0;
      c.column.visible = !!p && p.column + p.flash > 0.01;
      c.rings.forEach((r, i) => {
        const f = (t * 0.9 + i / c.rings.length) % 1;
        r.visible = !!p && p.rings > 0.01;
        r.position.y = p && !p.rising ? lerp(high, low, f) : lerp(low, high, f);
        ((r as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (p?.rings ?? 0) * Math.sin(Math.PI * f) * 0.9;
      });
      c.sparks.forEach((s, i) => {
        s.visible = !!p && p.sparks > 0.01;
        if (!p || !s.visible) return;
        const a = hash2(i, 3) * Math.PI * 2, r = 0.05 + hash2(i, 11) * 0.28, f = (hash2(i, 17) + t * (0.5 + hash2(i, 29) * 0.6)) % 1;
        s.position.set(Math.cos(a + t * 2) * r, p.rising ? lerp(0.12, 1.2, f) : lerp(1.2, 0.12, f), Math.sin(a + t * 2) * r);
        s.rotation.set(t * 3 + a, t * 2, 0);
      });
      if (!p) continue;
      this.teleportColumn.opacity = Math.min(1, p.column * 0.45 + p.flash * 0.8);
      this.teleportLight.opacity = p.sparks;
      this.teleportGlow.opacity = Math.min(1, this.teleportGlow.opacity + p.flash * 0.6);
    }
  }

  /** Someone else vanished from beside a teleport, or appeared in front of one (beam.ts, popAt): a small violet pop there. */
  pop(x: number, y: number) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xc9a8ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const group = new THREE.Group(), geo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
    group.position.set(x + 0.5, this.groundAt(x + 0.5, y + 0.5) + 0.45, y + 0.5);
    for (let i = 0; i < 12; i++) {
      const speck = new THREE.Mesh(geo, mat), a = (i / 12) * Math.PI * 2;
      speck.userData.dir = new THREE.Vector3(Math.cos(a), (hash2(i, 7) - 0.3) * 1.2, Math.sin(a)).normalize();
      group.add(speck);
    }
    this.scene.add(group);
    this.pops.push({ group, mat, t: 0 });
  }

  /** The pops fly apart and fade in POP_S, then go. */
  private popsOn(dt: number) {
    for (const p of this.pops) {
      p.t += dt;
      const k = Math.min(1, p.t / POP_S);
      p.mat.opacity = 1 - k;
      for (const s of p.group.children) s.position.copy(s.userData.dir as THREE.Vector3).multiplyScalar(0.1 + (1 - (1 - k) ** 2) * 0.55);
      if (k >= 1) { this.scene.remove(p.group); disposeTree(p.group); }
    }
    this.pops = this.pops.filter(p => p.t < POP_S);
  }

  /** Puts the other players' flashlights on those nearest you who hold one (assignBeams), each coming on as it is handed over. */
  private lightBeams(held: Held[], fx: number, fz: number, dt: number) {
    const next = assignBeams(this.beams.map(b => b.id), held, fx, fz);
    this.beams.forEach((b, k) => {
      const h = held.find(o => o.id === next[k]);
      if (!h) {
        b.id = ''; b.on = 0; b.light.intensity = 0;
        return;
      }
      if (h.id !== b.id) { b.id = h.id; b.on = 0; }
      b.on = Math.min(1, b.on + dt / LIGHT_FADE_S);
      b.light.position.set(h.x, h.y, h.z);
      b.target.position.set(h.tx, h.ty, h.tz);
      b.target.updateMatrixWorld();
      // As strong as your own (applyAmbience): together you light as much as each of you.
      b.light.intensity = 1.6 * L * b.on;
    });
  }

  /** Someone at x, z, `d` (squared) from you: kept among the parters if they are among the nearest. */
  private parter(x: number, z: number, d: number) {
    let k = PARTERS;
    while (k > 0 && d < this.partD[k - 1]!) k--;
    if (k === PARTERS) return;
    for (let i = PARTERS - 1; i > k; i--) {
      this.partX[i] = this.partX[i - 1]!;
      this.partZ[i] = this.partZ[i - 1]!;
      this.partD[i] = this.partD[i - 1]!;
    }
    this.partX[k] = x;
    this.partZ[k] = z;
    this.partD[k] = d;
  }

  /** A player left: free their model. The blob shadow's geometry and material are shared by every blob, so they stay. */
  private dropRig(e: { rig: Rig; shadow: THREE.Mesh }) {
    this.scene.remove(e.rig.root, e.shadow);
    disposeTree(e.rig.root);
  }
}

/**
 * A lookout's beam, from its lamp out along +x and down to the ground at its reach (lookout.ts): a cone of
 * light, brightest at the lamp, and the pool it throws on the ground as it goes, faint near the tower and
 * brightest out where it lands. One mesh, colored by vertex (the material adds it to what is behind).
 */
function beamGeometry(): THREE.BufferGeometry {
  const R = BEAM_REACH, wide = Math.tan(BEAM_HALF), drop = Math.atan2(LOOKOUT_LAMP_Y, R);
  const cone = new THREE.CylinderGeometry(R * wide, 0.14, R, 14, 1, true).toNonIndexed();
  cone.rotateZ(-Math.PI / 2).translate(R / 2, 0, 0).rotateZ(-drop);
  const pos: number[] = [], col: number[] = [];
  const cp = cone.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i), k = 0.2 * Math.max(0, 1 - x / R) ** 1.4;
    pos.push(x, cp.getY(i), cp.getZ(i));
    col.push(k, k * 0.95, k * 0.8);
  }
  // The pool on the ground: a strip down the middle of the beam's path, in rings, faint where it starts.
  const ground = -LOOKOUT_LAMP_Y + 0.05, rings = [3, 8, 14, R * 0.86, R];
  const light = (x: number) => 0.16 * Math.min(1, Math.max(0, (x - 3) / 10)) * (x >= R ? 0 : 1);
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i]!, b = rings[i + 1]!, wa = a * wide, wb = b * wide, ka = light(a), kb = light(b);
    for (const [x, z, k] of [[a, -wa, ka], [b, -wb, kb], [b, wb, kb], [a, -wa, ka], [b, wb, kb], [a, wa, ka]] as const) {
      pos.push(x, ground, z);
      col.push(k, k * 0.95, k * 0.8);
    }
  }
  cone.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** A flare's red light going up, seen from up a lookout. */
const FLARE_FAR = new THREE.Color('#ff4a2e');

/** Point `n` of a set of distant lights: where it is drawn, and its color at `glow` of its brightness. */
function putPoint(pts: THREE.Points, n: number, at: { x: number; y: number; z: number }, r: number, g: number, b: number, glow: number) {
  (pts.geometry.attributes.position as THREE.BufferAttribute).setXYZ(n, at.x, at.y, at.z);
  (pts.geometry.attributes.color as THREE.BufferAttribute).setXYZ(n, r * glow, g * glow, b * glow);
}

/** A set of distant lights filled with `n` points this frame: only those are drawn. */
function endPoints(pts: THREE.Points, n: number) {
  pts.geometry.setDrawRange(0, n);
  pts.geometry.attributes.position!.needsUpdate = true;
  pts.geometry.attributes.color!.needsUpdate = true;
}

/** Climbing a lookout: from 0 on the ground to 1 up on its platform (or back down), `dt` seconds on. */
export function climbToward(climb: number, up: boolean, dt: number): number {
  return Math.min(1, Math.max(0, climb + (up ? 1 : -1) * CLIMB_RATE * Math.max(0, dt)));
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
