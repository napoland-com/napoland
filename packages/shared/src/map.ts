/**
 * The world is a grid of tiles. A map is plain data (content/maps/*.json) so it can be diffed,
 * reviewed and validated; TileMap turns it into fast lookups for the server and the client.
 *
 * The world is several maps joined by exits, like the towns and routes of FireRed: walking onto an
 * exit tile takes you to another map. A map is a town, part of the wilds (energy drains there, more
 * the deeper you are) or the inside of a building. Every house can be entered: its door is an exit
 * to a small map of its own. Energy only comes back near a fireplace. See energy.ts.
 */
import type { Dir } from './protocol';
import type { SurgeRule } from './sky';

/** One character per tile in MapData.tiles. */
export const TILE_CHARS = {
  g: 'grass',
  r: 'road',
  w: 'water',
  m: 'mud',
  l: 'lot',
  f: 'ferns',
  /** Dense trees: nobody walks through. Drawn as one tree per tile, varied by position. */
  t: 'forest',
  /** Wooden floor, inside buildings. */
  p: 'floor',
  /** A building's wall, inside: nobody walks through. */
  x: 'wall',
} as const;
export type TileChar = keyof typeof TILE_CHARS;
export type TileKind = (typeof TILE_CHARS)[TileChar];

/** The wilds drain energy; towns and the insides of buildings do not. */
export type MapKind = 'town' | 'wilds' | 'inside';

/**
 * Walking onto any tile of this rectangle takes you to map `to`. The rectangle's top-left tile
 * arrives at (tx, ty) and the others keep their offset, so a two-lane road stays two lanes.
 */
export interface MapExit {
  x: number;
  y: number;
  w: number;
  h: number;
  to: string;
  tx: number;
  ty: number;
  /** Facing on arrival. */
  dir: Dir;
  /** This exit leads back toward town: in the wilds, danger is measured as the distance from it. */
  home?: boolean;
}

/** How far a street light reaches, from the lamp's tile center to a tile's center. Light is for seeing, not energy. */
export const LAMP_RADIUS = 2.5;
/** How close to a fireplace you must be to recover energy, center to center: the tiles around it. */
export const FIRE_RADIUS = 1.5;

/** How a townsperson looks: colors (#rrggbb), each optional; `hat` puts a hard hat on over the hair. */
export interface NpcLook {
  coat?: string;
  scarf?: string;
  hair?: string;
  skin?: string;
  hat?: string;
}

export type MapObject =
  | { kind: 'tree'; x: number; y: number; s: number; v: number }
  | { kind: 'rock'; x: number; y: number; s: number; v: number }
  /**
   * A building you can enter: a wooden cabin (3 by 2, a gabled roof in `roof`), or with style 'napo'
   * one of NAPO's concrete buildings (3 by 2 or bigger, a flat roof in `roof`). Lit: someone is home.
   */
  | { kind: 'house'; x: number; y: number; w: number; h: number; roof: string; lit: 0 | 1; style?: 'napo' }
  | { kind: 'lamp'; x: number; y: number }
  /** A wooden signpost, or with style 'napo' one of NAPO's yellow warning signs. */
  | { kind: 'sign'; x: number; y: number; text: string[]; style?: 'napo' }
  | { kind: 'pole'; x: number; y: number }
  | { kind: 'fence'; x: number; y: number; dir: 'h' | 'v' }
  | { kind: 'barrel'; x: number; y: number }
  | { kind: 'car'; x: number; y: number; w: number }
  | { kind: 'stone'; x: number; y: number }
  | { kind: 'npc'; x: number; y: number; id: string; name: string; dir: Dir; lines: string[]; look?: NpcLook }
  | { kind: 'shrooms'; x: number; y: number }
  /** A tall radio mast, like the NAPO Tower's, with a red light blinking at the top. */
  | { kind: 'antenna'; x: number; y: number }
  /** One of NAPO's desks with a screen, a radio or a log on it: you read it like a sign, under its `name`. */
  | { kind: 'console'; x: number; y: number; name: string; text: string[] }
  /**
   * Stand on a tile next to it to recover energy while it burns. In town it is always tended; out in
   * the wilds (and in their shelters) it burns down unless someone feeds it, or `tended` says someone
   * out there keeps it going.
   */
  | { kind: 'fireplace'; x: number; y: number; tended?: boolean }
  /** A notice board: reading it tells how things stand out there (the server writes it). */
  | { kind: 'board'; x: number; y: number }
  /** Your stash: a chest at home. Everyone who opens it sees only their own things in it. */
  | { kind: 'chest'; x: number; y: number }
  /** The workbench: it makes gear from what your stash holds (recipes in content/items.json). */
  | { kind: 'workbench'; x: number; y: number }
  /** Furniture, inside buildings. A bed is one tile wide and two long (head at y); a rug is only drawn. */
  | { kind: 'bed'; x: number; y: number }
  | { kind: 'table'; x: number; y: number }
  | { kind: 'shelf'; x: number; y: number }
  | { kind: 'crate'; x: number; y: number }
  | { kind: 'rug'; x: number; y: number; w: number; h: number };

export interface MapData {
  id: string;
  /** Shown when you arrive, e.g. "The Near Woods". */
  name: string;
  /** Bump when the map changes; a client with another version reloads. */
  version: number;
  kind: MapKind;
  /** 0 for towns; 1 for the wilds next to town, more for regions farther out. Scales energy drain. */
  depth: number;
  width: number;
  height: number;
  /** Rows of TileChar, top (north, y = 0) to bottom. */
  tiles: string[];
  /** Rows of digits: ground height steps. Only level 0 is walkable for now. */
  levels: string[];
  /** Where new players start and collapsed players wake up (in the home town). */
  spawn: { x: number; y: number; dir: Dir };
  exits: MapExit[];
  objects: MapObject[];
  /** The wilds only: how this region surges (sky.ts). None: it never does. */
  surge?: SurgeRule;
  /** The wilds only: watchers, creatures that come closer while nobody looks at them. */
  watchers?: WatcherRule;
  /** Insides only: the inside of one of NAPO's buildings (concrete, not logs). Its door is a NAPO building's. */
  style?: 'napo';
}

/** How many watchers roam a region at once, and how far from home (in steps) they wake up. */
export interface WatcherRule {
  count: number;
  steps: [number, number];
}

/** Where an exit tile leads: the map, the tile you arrive on and your facing. */
export interface Arrival {
  to: string;
  x: number;
  y: number;
  dir: Dir;
}

/** Objects that stand on a tile and stop anyone from walking onto it (a house's door tile excepted). */
const BLOCKING = new Set<MapObject['kind']>([
  'tree', 'rock', 'house', 'lamp', 'sign', 'pole', 'fence', 'barrel', 'car', 'stone', 'npc', 'fireplace', 'bed', 'table', 'shelf', 'crate', 'board', 'chest', 'workbench',
  'antenna', 'console',
]);
/** Objects that are only drawn: you walk over or through them. */
export const DECOR = new Set<MapObject['kind']>(['shrooms', 'rug']);

/** Tiles covered by an object (houses, cars, beds and rugs are bigger than one tile). */
export function objectTiles(o: MapObject): Array<[number, number]> {
  const w = o.kind === 'house' || o.kind === 'car' || o.kind === 'rug' ? o.w : 1;
  const h = o.kind === 'house' || o.kind === 'rug' ? o.h : o.kind === 'bed' ? 2 : 1;
  const out: Array<[number, number]> = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push([o.x + dx, o.y + dy]);
  return out;
}

/**
 * A house's door: the middle of its front (bottom) row. The door tile is open, and it must be an
 * exit to the house's inside (the validator checks), so every building can be entered.
 */
export function doorOf(house: Extract<MapObject, { kind: 'house' }>): { x: number; y: number } {
  return { x: house.x + Math.floor(house.w / 2), y: house.y + house.h - 1 };
}

export class TileMap {
  readonly width: number;
  readonly height: number;
  readonly kinds: TileKind[];
  readonly levels: Uint8Array;
  readonly blocked: Uint8Array;
  /** Index into data.exits of the exit on each tile, or -1. */
  private readonly exitIndex: Int16Array;
  /** 1 where a street light reaches. */
  private readonly litTiles: Uint8Array;
  /** 1 next to a fireplace, where energy comes back. */
  private readonly warmTiles: Uint8Array;
  /** Steps from each tile to the nearest home exit (-1: no way there); all 0 in towns. */
  private readonly stepsHome: Int32Array;
  /** The most steps any tile is from home: where a surge starts. 0 in towns and insides. */
  readonly deepest: number;

  constructor(readonly data: MapData) {
    const W = data.width, H = data.height;
    this.width = W;
    this.height = H;
    this.kinds = new Array<TileKind>(W * H);
    this.levels = new Uint8Array(W * H);
    this.blocked = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const row = data.tiles[y] ?? '';
      const lv = data.levels[y] ?? '';
      for (let x = 0; x < W; x++) {
        const c = row[x] as TileChar;
        const kind = TILE_CHARS[c];
        if (!kind) throw new Error(`map ${data.id}: unknown tile '${row[x]}' at ${x},${y}`);
        this.kinds[y * W + x] = kind;
        this.levels[y * W + x] = Number(lv[x] ?? '0') || 0;
      }
    }
    for (const o of data.objects) if (BLOCKING.has(o.kind)) for (const [x, y] of objectTiles(o)) if (this.inside(x, y)) this.blocked[y * W + x] = 1;
    // Every house can be entered: its door tile stays open (it is an exit to the house's inside).
    for (const o of data.objects) {
      if (o.kind !== 'house') continue;
      const d = doorOf(o);
      if (this.inside(d.x, d.y)) this.blocked[d.y * W + d.x] = 0;
    }

    this.exitIndex = new Int16Array(W * H).fill(-1);
    (data.exits ?? []).forEach((e, i) => {
      for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) if (this.inside(x, y)) this.exitIndex[y * W + x] = i;
    });

    this.litTiles = this.around('lamp', LAMP_RADIUS);
    this.warmTiles = this.around('fireplace', FIRE_RADIUS);

    // Distance home, walking: breadth-first from every home exit tile at once. Only the wilds
    // measure it; towns and the insides of buildings are safe, so every tile there counts as 0.
    this.stepsHome = new Int32Array(W * H).fill(data.kind === 'wilds' ? -1 : 0);
    if (data.kind === 'wilds') {
      const queue: number[] = [];
      (data.exits ?? []).forEach(e => {
        if (!e.home) return;
        for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) {
          if (this.walkable(x, y) && this.stepsHome[y * W + x] === -1) { this.stepsHome[y * W + x] = 0; queue.push(y * W + x); }
        }
      });
      for (let head = 0; head < queue.length; head++) {
        const i = queue[head]!, x = i % W, y = (i / W) | 0, d = this.stepsHome[i]! + 1;
        for (const [nx, ny] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]] as const) {
          if (!this.walkable(nx, ny) || this.stepsHome[ny * W + nx] !== -1) continue;
          this.stepsHome[ny * W + nx] = d;
          queue.push(ny * W + nx);
        }
      }
    }
    let deepest = 0;
    for (const v of this.stepsHome) if (v > deepest) deepest = v;
    this.deepest = deepest;
  }

  /** Where walking onto this tile takes you, if it is an exit. */
  exitAt(x: number, y: number): Arrival | undefined {
    const i = this.inside(x, y) ? this.exitIndex[y * this.width + x]! : -1;
    if (i < 0) return undefined;
    const e = this.data.exits[i]!;
    return { to: e.to, x: e.tx + (x - e.x), y: e.ty + (y - e.y), dir: e.dir };
  }

  /** Is this tile in the light of a street lamp? (Light is for seeing; it does not give energy.) */
  lit(x: number, y: number): boolean {
    return this.inside(x, y) && this.litTiles[y * this.width + x] === 1;
  }

  /** Is this tile next to a fireplace, where energy comes back? */
  warm(x: number, y: number): boolean {
    return this.inside(x, y) && this.warmTiles[y * this.width + x] === 1;
  }

  /** The tiles within `radius` of any object of `kind`, center to center. */
  private around(kind: MapObject['kind'], radius: number): Uint8Array {
    const out = new Uint8Array(this.width * this.height), r = Math.ceil(radius);
    for (const o of this.data.objects) {
      if (o.kind !== kind) continue;
      for (let y = o.y - r; y <= o.y + r; y++) for (let x = o.x - r; x <= o.x + r; x++) {
        if (this.inside(x, y) && Math.hypot(x - o.x, y - o.y) <= radius) out[y * this.width + x] = 1;
      }
    }
    return out;
  }

  /** Walking steps from this tile to the nearest home exit; 0 in towns and insides, -1 if there is no way. */
  homeSteps(x: number, y: number): number {
    return this.inside(x, y) ? this.stepsHome[y * this.width + x]! : -1;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  kind(x: number, y: number): TileKind | undefined {
    return this.inside(x, y) ? this.kinds[y * this.width + x] : undefined;
  }

  level(x: number, y: number): number {
    return this.inside(x, y) ? this.levels[y * this.width + x]! : 0;
  }

  /** Can a character stand on this tile? */
  walkable(x: number, y: number): boolean {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !this.inside(x, y)) return false;
    const i = y * this.width + x;
    const kind = this.kinds[i];
    return this.blocked[i] === 0 && kind !== 'water' && kind !== 'forest' && kind !== 'wall' && this.levels[i] === 0;
  }
}
