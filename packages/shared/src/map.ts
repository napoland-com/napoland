/**
 * The world is a grid of tiles. A map is plain data (content/maps/*.json) so it can be diffed,
 * reviewed and validated; TileMap turns it into fast lookups for the server and the client.
 *
 * The world is several maps joined by exits, like the towns and routes of FireRed: walking onto an
 * exit tile takes you to another map. A map is either a town (safe: energy refills) or part of the
 * wilds (energy drains, more the deeper you are). See energy.ts.
 */
import type { Dir } from './protocol';

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
} as const;
export type TileChar = keyof typeof TILE_CHARS;
export type TileKind = (typeof TILE_CHARS)[TileChar];

/** Towns are safe and refill energy; the wilds drain it. */
export type MapKind = 'town' | 'wilds';

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

/** How far a street light reaches, from the lamp's tile center to a tile's center. */
export const LAMP_RADIUS = 2.5;

export type MapObject =
  | { kind: 'tree'; x: number; y: number; s: number; v: number }
  | { kind: 'rock'; x: number; y: number; s: number; v: number }
  | { kind: 'house'; x: number; y: number; w: number; h: number; roof: string; lit: 0 | 1 }
  | { kind: 'lamp'; x: number; y: number }
  | { kind: 'sign'; x: number; y: number; text: string[] }
  | { kind: 'pole'; x: number; y: number }
  | { kind: 'fence'; x: number; y: number; dir: 'h' | 'v' }
  | { kind: 'barrel'; x: number; y: number }
  | { kind: 'car'; x: number; y: number; w: number }
  | { kind: 'stone'; x: number; y: number }
  | { kind: 'npc'; x: number; y: number; id: string; name: string; dir: Dir; lines: string[] }
  | { kind: 'shrooms'; x: number; y: number };

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
}

/** Where an exit tile leads: the map, the tile you arrive on and your facing. */
export interface Arrival {
  to: string;
  x: number;
  y: number;
  dir: Dir;
}

/** Objects that stand on a tile and stop anyone from walking onto it. */
const BLOCKING = new Set<MapObject['kind']>(['tree', 'rock', 'house', 'lamp', 'sign', 'pole', 'fence', 'barrel', 'car', 'stone', 'npc']);

/** Tiles covered by an object (houses and cars are bigger than one tile). */
export function objectTiles(o: MapObject): Array<[number, number]> {
  const w = o.kind === 'house' || o.kind === 'car' ? o.w : 1;
  const h = o.kind === 'house' ? o.h : 1;
  const out: Array<[number, number]> = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push([o.x + dx, o.y + dy]);
  return out;
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
  /** Steps from each tile to the nearest home exit (-1: no way there); all 0 in towns. */
  private readonly stepsHome: Int32Array;

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

    this.exitIndex = new Int16Array(W * H).fill(-1);
    (data.exits ?? []).forEach((e, i) => {
      for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) if (this.inside(x, y)) this.exitIndex[y * W + x] = i;
    });

    this.litTiles = new Uint8Array(W * H);
    const r = Math.ceil(LAMP_RADIUS);
    for (const o of data.objects) {
      if (o.kind !== 'lamp') continue;
      for (let y = o.y - r; y <= o.y + r; y++) for (let x = o.x - r; x <= o.x + r; x++) {
        if (this.inside(x, y) && Math.hypot(x - o.x, y - o.y) <= LAMP_RADIUS) this.litTiles[y * W + x] = 1;
      }
    }

    // Distance home, walking: breadth-first from every home exit tile at once.
    this.stepsHome = new Int32Array(W * H).fill(data.kind === 'town' ? 0 : -1);
    if (data.kind !== 'town') {
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
  }

  /** Where walking onto this tile takes you, if it is an exit. */
  exitAt(x: number, y: number): Arrival | undefined {
    const i = this.inside(x, y) ? this.exitIndex[y * this.width + x]! : -1;
    if (i < 0) return undefined;
    const e = this.data.exits[i]!;
    return { to: e.to, x: e.tx + (x - e.x), y: e.ty + (y - e.y), dir: e.dir };
  }

  /** Is this tile in the light of a street lamp? */
  lit(x: number, y: number): boolean {
    return this.inside(x, y) && this.litTiles[y * this.width + x] === 1;
  }

  /** Walking steps from this tile to the nearest home exit; 0 in towns, -1 if there is no way. */
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
    return this.blocked[i] === 0 && kind !== 'water' && kind !== 'forest' && this.levels[i] === 0;
  }
}
