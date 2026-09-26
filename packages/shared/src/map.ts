/**
 * The world is a grid of tiles. A map is plain data (content/maps/*.json) so it can be diffed,
 * reviewed and validated; TileMap turns it into fast lookups for the server and the client.
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
} as const;
export type TileChar = keyof typeof TILE_CHARS;
export type TileKind = (typeof TILE_CHARS)[TileChar];

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
  name: string;
  version: number;
  width: number;
  height: number;
  /** Rows of TileChar, top (north, y = 0) to bottom. */
  tiles: string[];
  /** Rows of digits: ground height steps. Only level 0 is walkable for now. */
  levels: string[];
  spawn: { x: number; y: number; dir: Dir };
  objects: MapObject[];
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

  constructor(readonly data: MapData) {
    this.width = data.width;
    this.height = data.height;
    this.kinds = new Array<TileKind>(data.width * data.height);
    this.levels = new Uint8Array(data.width * data.height);
    this.blocked = new Uint8Array(data.width * data.height);
    for (let y = 0; y < data.height; y++) {
      const row = data.tiles[y] ?? '';
      const lv = data.levels[y] ?? '';
      for (let x = 0; x < data.width; x++) {
        const c = row[x] as TileChar;
        const kind = TILE_CHARS[c];
        if (!kind) throw new Error(`map ${data.id}: unknown tile '${row[x]}' at ${x},${y}`);
        this.kinds[y * data.width + x] = kind;
        this.levels[y * data.width + x] = Number(lv[x] ?? '0') || 0;
      }
    }
    for (const o of data.objects) if (BLOCKING.has(o.kind)) for (const [x, y] of objectTiles(o)) if (this.inside(x, y)) this.blocked[y * data.width + x] = 1;
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
    return this.blocked[i] === 0 && this.kinds[i] !== 'water' && this.levels[i] === 0;
  }
}
