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
import type { FlashRule, StormRule, SurgeRule } from './sky';

/** One character per tile in MapData.tiles. */
export const TILE_CHARS = {
  g: 'grass',
  r: 'road',
  w: 'water',
  m: 'mud',
  l: 'lot',
  f: 'ferns',
  /** Knee-high grass: walked through like grass, and whoever stands in it is hidden from creatures (hidden). */
  h: 'tallgrass',
  /** Dense trees: nobody walks through. Drawn as one tree per tile, varied by position. */
  t: 'forest',
  /** Wooden floor, inside buildings. */
  p: 'floor',
  /** A building's wall, inside: nobody walks through. */
  x: 'wall',
  /**
   * A flooded culvert: water to everyone but whoever wades it in waders (TILE_NEEDS). Drawn as water,
   * heard as water, and nothing else ever walks it: creatures, finds and how far home a tile is go by
   * the map as nobody's pass opens it.
   */
  c: 'culvert',
} as const;
export type TileChar = keyof typeof TILE_CHARS;
export type TileKind = (typeof TILE_CHARS)[TileChar];

/**
 * What a walker brings to the tiles that open only for some (TileMap.walkable): the ids of the tools
 * they own (waders through the culvert, bolt cutters through a padlocked door). The server checks every
 * step with the mover's; the client paths and predicts with its own player's.
 */
export type Pass = ReadonlySet<string>;

/** The tile kinds that open only for whoever holds a tool, and which: the flooded culvert, to waders. */
export const TILE_NEEDS: Readonly<Partial<Record<TileKind, string>>> = { culvert: 'waders' };

/** Water in all but name: a flooded culvert is water to whoever is not wading it. */
export const watery = (kind: TileKind | undefined): boolean => kind === 'water' || kind === 'culvert';

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
  /**
   * The tool it takes to go through (a padlocked door: bolt cutters, an item id). Without it the door
   * stays shut: the server refuses the step, and a player's own game neither paths nor steps through it.
   */
  lock?: string;
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
   * A building you can enter: a wooden cabin (3 by 2, a gabled roof in `roof`), with style 'napo' one
   * of NAPO's concrete buildings (3 by 2 or bigger, a flat roof in `roof`), with style 'mill' the old
   * sawmill, long and low, timber under a sawtooth roof (`roof` its rusted metal), or with style 'shed'
   * a board shed, 2 by 2, under a lean-to roof (`roof`), whose door is padlocked when its exit has a
   * `lock`. Lit: someone is home. `curtains`: a cabin whose people left and drew the curtains behind
   * them; its windows never light.
   */
  | { kind: 'house'; x: number; y: number; w: number; h: number; roof: string; lit: 0 | 1; style?: 'napo' | 'mill' | 'shed'; curtains?: boolean }
  | { kind: 'lamp'; x: number; y: number }
  /**
   * A wooden signpost; with style 'napo' one of NAPO's yellow warning signs, 'cardboard' a piece of
   * cardboard someone wrote on, 'mailbox' the mailbox by a door with the family's name on it.
   */
  | { kind: 'sign'; x: number; y: number; text: string[]; style?: 'napo' | 'cardboard' | 'mailbox' }
  | { kind: 'pole'; x: number; y: number }
  | { kind: 'fence'; x: number; y: number; dir: 'h' | 'v' }
  | { kind: 'barrel'; x: number; y: number }
  /**
   * A car left where it stopped: w by h tiles (2 by 1, or 1 by 2 along a road that runs north), its nose
   * toward `dir` (east when left out), in `paint` (#rrggbb; the town's old teal when left out), with a
   * `door` left open or the `trunk` left up.
   */
  | { kind: 'car'; x: number; y: number; w: number; h?: number; dir?: Dir; paint?: string; door?: boolean; trunk?: boolean }
  /**
   * A truck left where it stood: a logging truck, rusted, its last load still chained on, or with style
   * 'napo' one of NAPO's box trucks. w by h tiles, one wide, its nose toward `dir`.
   */
  | { kind: 'truck'; x: number; y: number; w: number; h: number; dir: Dir; style?: 'napo' }
  /** One of NAPO's field jeeps, burned out, a door hanging open: you read what is stenciled on it like a sign, from beside it. */
  | { kind: 'jeep'; x: number; y: number; w: number; h: number; dir: Dir; text: string[] }
  /** A deck of felled logs on its w by h tiles: lying east to west on a deck one tile deep, north to south (their cut ends to the camera) on any other. */
  | { kind: 'logs'; x: number; y: number; w: number; h: number }
  /** What is left of a fir the loggers cut, or, `burned`, one a fire took. */
  | { kind: 'stump'; x: number; y: number; s: number; v: number; burned?: boolean }
  /** A log laid across a skid road and half sunk in the mud: walked over. `dir`: which way the road runs. */
  | { kind: 'skid'; x: number; y: number; dir: 'h' | 'v' }
  /** One of NAPO's survey stakes, with orange flagging: only drawn, walked past. */
  | { kind: 'stake'; x: number; y: number }
  /** Suitcases and bags as they were left, when they would not fit in the car. */
  | { kind: 'luggage'; x: number; y: number }
  /** Cardboard boxes, some taped shut, some half packed. */
  | { kind: 'boxes'; x: number; y: number }
  | { kind: 'rocker'; x: number; y: number }
  /** An upright piano under a tarp: two tiles wide. */
  | { kind: 'piano'; x: number; y: number }
  /** A child's bike, lying on its side. */
  | { kind: 'bike'; x: number; y: number }
  /** An empty birdcage, its door open. */
  | { kind: 'birdcage'; x: number; y: number }
  /** NAPO's fuel pump, in its motor pool. */
  | { kind: 'pump'; x: number; y: number }
  /** One of NAPO's sample cages: a rock from deep in the woods behind steel mesh; you read its tag like a sign. */
  | { kind: 'cage'; x: number; y: number; text: string[] }
  | { kind: 'stone'; x: number; y: number }
  | { kind: 'npc'; x: number; y: number; id: string; name: string; dir: Dir; lines: string[]; look?: NpcLook }
  | { kind: 'shrooms'; x: number; y: number }
  /** A tall radio mast, like the NAPO Tower's, with a red light blinking at the top. */
  | { kind: 'antenna'; x: number; y: number }
  /** One of NAPO's desks with a screen, a radio or a log on it: you read it like a sign, under its `name`. `id` names it for the story. */
  | { kind: 'console'; x: number; y: number; id: string; name: string; text: string[] }
  /**
   * Stand on a tile next to it to recover energy while it burns. In town it is always tended; out in
   * the wilds (and in their shelters) it burns down unless someone feeds it, or `tended` says someone
   * out there keeps it going. `name`: what people call a fire in the open (the notice board says it),
   * for example "the leavers' camp"; a fire in a room goes by the room's name.
   */
  | { kind: 'fireplace'; x: number; y: number; tended?: boolean; name?: string }
  /** A notice board: reading it tells how things stand out there (the server writes it). */
  | { kind: 'board'; x: number; y: number }
  /** Your stash: a chest at home. Everyone who opens it sees only their own things in it. */
  | { kind: 'chest'; x: number; y: number }
  /** The workbench, beside the chest at home: it makes gear from what your stash holds (recipes in content/items.json). */
  | { kind: 'workbench'; x: number; y: number }
  /**
   * A crate for whoever comes next (caches.ts), where people rest by a fire out there: anyone opens it,
   * leaves a thing and takes one. `name`: what people call it, as a letter says it ("the old cabin's crate").
   */
  | { kind: 'cache'; x: number; y: number; name: string }
  /** Furniture, inside buildings. A bed is one tile wide and two long (head at y); a rug is only drawn. */
  | { kind: 'bed'; x: number; y: number }
  | { kind: 'table'; x: number; y: number }
  | { kind: 'shelf'; x: number; y: number }
  | { kind: 'crate'; x: number; y: number }
  /** Split firewood stacked against the nearest wall. Nothing to do with it: it only stands in the way. */
  | { kind: 'woodpile'; x: number; y: number }
  | { kind: 'rug'; x: number; y: number; w: number; h: number }
  /** A hearth nobody lights any more, against the top wall like a fireplace: cold, it gives nothing. */
  | { kind: 'hearth'; x: number; y: number }
  /** Furniture under a dust sheet, as it was covered when the house was shut. */
  | { kind: 'sheeted'; x: number; y: number }
  | { kind: 'crib'; x: number; y: number }
  /** A tall clock against the wall, stopped. */
  | { kind: 'clock'; x: number; y: number }
  /**
   * Something left to read, like a sign, under its `name`: a note or a list lying on a table (on a
   * floor tile), or a calendar or a child's drawing hung on the wall (on a wall tile, read from the
   * floor below it).
   */
  | { kind: 'paper'; x: number; y: number; name: string; text: string[]; look: 'note' | 'list' | 'calendar' | 'drawing' }
  /** The sawmill's head saw: its two big wheels and the band between them, and the belts up to the line shaft. */
  | { kind: 'saw'; x: number; y: number }
  /** The saw carriage on its rails, w tiles long east to west, a log still dogged on it. */
  | { kind: 'carriage'; x: number; y: number; w: number }
  /** A drift of sawdust on the mill floor: walked through. */
  | { kind: 'sawdust'; x: number; y: number }
  /**
   * A fire lookout from the logging days (lookout.ts): a timber tower on four legs, 2 by 2, a cab on top
   * with a lamp in it, its ladder up the south face of its east column. Climbed from the tile in front
   * of the ladder (footOf); its lamp burns what someone feeds it there, and sweeps a beam round the woods.
   */
  | { kind: 'lookout'; x: number; y: number };

/** The ways a paper to read can look (MapObject 'paper'); the first two lie on a table, the others hang on a wall. */
export const PAPER_LOOKS = ['note', 'list', 'calendar', 'drawing'] as const;
/** A paper that hangs on the wall: it stands on a wall tile and is read from the floor below it. */
export const hangs = (look: (typeof PAPER_LOOKS)[number]) => look === 'calendar' || look === 'drawing';

/** A place people call by name: the ring of stones, the sinks, the quarantine line. */
export interface MapPlace {
  name: string;
  x: number;
  y: number;
}

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
  /** The wilds only: how often a storm rolls over this region (sky.ts). None: it never storms. */
  storm?: StormRule;
  /** The wilds only: how often a flash starts near someone out here (sky.ts). None: no flashes. */
  flashes?: FlashRule;
  /** The wilds only: watchers, creatures that come closer while nobody looks at them. */
  watchers?: WatcherRule;
  /**
   * Insides only: the inside of one of NAPO's buildings (napo: concrete, not logs), the sawmill's floor
   * (mill: boards, not logs) or a board shed's (shed: rough boards, small). Its door is a building of
   * the same style.
   */
  style?: 'napo' | 'mill' | 'shed';
  /**
   * A room with a chest only: a home that is each player's own. Whoever walks in through its door is in a
   * copy of the room of their own (their cabin, the server's zones), where nobody else ever is.
   */
  private?: true;
  /**
   * A private room only, the one whose door opens onto the home town: where you wake up in it (as a new
   * player, and after a collapse), on a walkable tile by its fire, facing `dir`.
   */
  wake?: { x: number; y: number; dir: Dir };
  /** Places on this map people call by name; the paper map writes them in. */
  places?: MapPlace[];
  /** The wilds only: skulkers, creatures that lie in the ferns and chase whoever they hear or see. */
  skulkers?: SkulkerRule;
}

/** How many watchers roam a region at once, and how far from home (in steps) they wake up. */
export interface WatcherRule {
  count: number;
  steps: [number, number];
}

/**
 * How many skulkers lie in a region's ferns, how far from home (in steps) they wake and may go, and
 * when they are out: 'night' (night and aurora nights) and 'storm' (while a storm blows over the region).
 */
export interface SkulkerRule {
  count: number;
  steps: [number, number];
  when: Array<'night' | 'storm'>;
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
  'antenna', 'console', 'woodpile',
  'truck', 'jeep', 'logs', 'stump', 'luggage', 'boxes', 'rocker', 'piano', 'bike', 'birdcage', 'pump', 'cage',
  'hearth', 'sheeted', 'crib', 'clock', 'paper', 'saw', 'carriage', 'cache', 'lookout',
]);
/** Objects that are only drawn: you walk over or through them. */
export const DECOR = new Set<MapObject['kind']>(['shrooms', 'rug', 'skid', 'stake', 'sawdust']);
/**
 * What you face to read or talk to, standing in front of it: the tile below it must stay open
 * ground (a jeep, bigger, is read from any side of it).
 */
export const FRONTED = new Set<MapObject['kind']>(['sign', 'npc', 'board', 'chest', 'workbench', 'console', 'paper', 'cage', 'cache']);

/** How many tiles an object covers, across and down: houses, vehicles, log decks, beds, rugs and a few more are bigger than one. */
export function footprint(o: MapObject): [number, number] {
  switch (o.kind) {
    case 'house': case 'rug': case 'truck': case 'jeep': case 'logs': return [o.w, o.h];
    case 'car': return [o.w, o.h ?? 1];
    case 'carriage': return [o.w, 1];
    case 'bed': return [1, 2];
    case 'piano': return [2, 1];
    case 'lookout': return [2, 2];
    default: return [1, 1];
  }
}

/** Tiles covered by an object (houses, cars, beds and rugs are bigger than one tile). */
export function objectTiles(o: MapObject): Array<[number, number]> {
  const [w, h] = footprint(o);
  const out: Array<[number, number]> = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push([o.x + dx, o.y + dy]);
  return out;
}

/**
 * Tall grass hides whoever stands in it from creatures, and only from them (DESIGN.md, Creatures):
 * creatures never step into it, a chase ends when the prey reaches it, and nothing notices anyone in
 * it. The drain, the rain, hitchhikers, surges, storms and flashes find you there as anywhere else.
 * The one place the rule lives: the server's creatures and creatureMayStand ask it, and the client
 * asks it too, to crouch whoever stands in tall grass.
 */
export function hidden(map: TileMap, x: number, y: number): boolean {
  return map.kind(x, y) === 'tallgrass';
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
  /** On each tile that opens only for some, the index in `keys` of what it takes (TILE_NEEDS, MapExit.lock); -1 elsewhere. */
  private readonly gate: Int16Array;
  /** What this map's gated tiles take, each once: every tool (or later, anything else) a pass may hold here. */
  readonly keys: readonly string[];
  /** Every key there is here: validators and generators ask what is walkable for someone who holds all of them. */
  private readonly all: Pass;

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

    // Tiles that open only for whoever holds something: a kind of ground (the culvert, to waders) or a
    // locked exit (a padlocked door, to bolt cutters).
    this.gate = new Int16Array(W * H).fill(-1);
    const keys: string[] = [];
    const gateAt = (i: number, key: string) => {
      let k = keys.indexOf(key);
      if (k < 0) k = keys.push(key) - 1;
      this.gate[i] = k;
    };
    for (let i = 0; i < W * H; i++) {
      const need = TILE_NEEDS[this.kinds[i]!];
      if (need) gateAt(i, need);
    }
    for (const e of data.exits ?? []) {
      if (!e.lock) continue;
      for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) if (this.inside(x, y)) gateAt(y * W + x, e.lock);
    }
    this.keys = keys;
    this.all = new Set(keys);

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
    // Measured before the gated tiles: where a surge starts never depends on who wades or cuts through.
    let deepest = 0;
    for (const v of this.stepsHome) if (v > deepest) deepest = v;
    this.deepest = deepest;
    // A tile that opens only for some is as far from home as the way to it through the tiles that open
    // for everyone, then along the gated ones: the drain, a surge's front and the hitchhikers treat it
    // like the ground it joins, and no other tile's distance changes by it (a shortcut through the
    // culvert makes the bog no shallower). Few tiles, so they are relaxed until they settle.
    if (data.kind === 'wilds' && keys.length) {
      const gated: number[] = [];
      for (let i = 0; i < W * H; i++) if (this.gate[i]! >= 0 && this.blocked[i] === 0 && this.levels[i] === 0) gated.push(i);
      for (let changed = true; changed;) {
        changed = false;
        for (const i of gated) {
          const x = i % W, y = (i / W) | 0;
          let best = this.stepsHome[i]! < 0 ? Infinity : this.stepsHome[i]!;
          for (const [nx, ny] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]] as const) {
            if (!this.inside(nx, ny)) continue;
            const j = ny * W + nx, s = this.stepsHome[j]!;
            // Its neighbors that anyone walks, and the gated ones measured so far.
            if (s >= 0 && (this.gate[j]! >= 0 || this.walkable(nx, ny)) && s + 1 < best) best = s + 1;
          }
          if (best < Infinity && best !== this.stepsHome[i]) {
            this.stepsHome[i] = best;
            changed = true;
          }
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

  /** Where a watcher may wake, as y * width + x: where a creature may stand (creatureMayStand), `steps` from home. */
  lairs(steps: readonly [number, number]): number[] {
    const out: number[] = [];
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      const s = this.homeSteps(x, y);
      if (this.creatureMayStand(x, y) && s >= steps[0] && s <= steps[1]) out.push(y * this.width + x);
    }
    return out;
  }

  /** Where a creature may stand, step or wake: open ground out of the light, away from fires and exits, and never in tall grass (hidden). */
  creatureMayStand(x: number, y: number): boolean {
    return this.walkable(x, y) && !this.exitAt(x, y) && !this.lit(x, y) && !this.warm(x, y) && !hidden(this, x, y);
  }

  /**
   * Can a character stand on this tile? A tile that opens only for some (the culvert, a padlocked door)
   * is walkable for whoever's `pass` holds what it takes, and for nobody else: without a pass, never.
   */
  walkable(x: number, y: number, pass?: Pass): boolean {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !this.inside(x, y)) return false;
    const i = y * this.width + x;
    if (this.blocked[i] !== 0 || this.levels[i] !== 0) return false;
    const g = this.gate[i]!;
    if (g >= 0) return pass?.has(this.keys[g]!) === true;
    const kind = this.kinds[i];
    return kind !== 'water' && kind !== 'forest' && kind !== 'wall';
  }

  /** What it takes to walk this tile, when only some may (a tool's id): undefined for a tile that is open, or shut, to everyone alike. */
  needs(x: number, y: number): string | undefined {
    const g = this.inside(x, y) ? this.gate[y * this.width + x]! : -1;
    return g >= 0 ? this.keys[g] : undefined;
  }

  /** Walkable for someone who holds everything this map's gated tiles take: what content checks ask (every door leads in, for someone). */
  passable(x: number, y: number): boolean {
    return this.walkable(x, y, this.all);
  }
}
