/**
 * The world is a grid of tiles. A map is plain data (content/maps/*.json) so it can be diffed,
 * reviewed and validated; TileMap turns it into fast lookups for the server and the client.
 *
 * The world is several maps joined by exits, like the towns and routes of FireRed: walking onto an
 * exit tile takes you to another map. A map is a town, part of the wilds (energy drains there, more
 * the deeper you are) or the inside of a building. Every house can be entered: its door is an exit
 * to a small map of its own. Energy only comes back near a fireplace. See energy.ts.
 */
import { comfortSize, underfootComfort, type Comfort } from './comfort';
import { STEP_MS } from './movement';
import type { Dir } from './protocol';
import type { FlashRule, RainWindow, StormRule, SurgeRule } from './sky';

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
  /** A rock; with `hum`, one of the rocks deep in the woods that hum back: it glows faintly, the same day and night. */
  | { kind: 'rock'; x: number; y: number; s: number; v: number; hum?: boolean }
  /**
   * A building you can enter: a wooden cabin (3 by 2, a gabled roof in `roof`), with style 'napo' one
   * of NAPO's concrete buildings (3 by 2 or bigger, a flat roof in `roof`), or with style 'mill' the
   * old sawmill, long and low, timber under a sawtooth roof (`roof` its rusted metal). Lit: someone is
   * home. `curtains`: a cabin whose people left and drew the curtains behind them; its windows never light.
   * `plate`: a cabin on a street, a lot (MapData.street), with a name plate by its door where its owner's
   * name shows; its window lights while its owner is at home, whatever `lit` says.
   */
  | { kind: 'house'; x: number; y: number; w: number; h: number; roof: string; lit: 0 | 1; style?: 'napo' | 'mill'; curtains?: boolean; plate?: true }
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
  /** A tall radio mast, like the NAPO Tower's, with a red light blinking at the top; `broken`: snapped halfway, its light long dead. */
  | { kind: 'antenna'; x: number; y: number; broken?: boolean }
  /** What is left of a logging camp's bunkhouse, w by h tiles: log walls fallen to a few rounds, no roof. Not a way in: it stands in the way. */
  | { kind: 'ruin'; x: number; y: number; w: number; h: number }
  /** The loggers' yarder, rusted where it stood: a boiler and a drum of steel cable on a sled of logs, two tiles by two. */
  | { kind: 'yarder'; x: number; y: number }
  /** A wooden cable spool on its side, the yarder's steel cable still wound on it. */
  | { kind: 'spool'; x: number; y: number }
  /** An old timber bridge over a creek, laid on the ford beneath it and walked over. `dir`: which way it runs, across the water. */
  | { kind: 'bridge'; x: number; y: number; dir: 'h' | 'v' }
  /** A trapper's things against a wall: steel traps on pegs, a pair of snowshoes, a coil of snare wire. */
  | { kind: 'traps'; x: number; y: number }
  /** One of NAPO's desks with a screen, a radio or a log on it: you read it like a sign, under its `name`. `id` names it for the story. */
  | { kind: 'console'; x: number; y: number; id: string; name: string; text: string[] }
  /**
   * Stand on a tile next to it to recover energy while it burns. In town it is always tended; out in
   * the wilds (and in their shelters) it burns down unless someone feeds it, or `tended` says someone
   * out there keeps it going. `name`: what people call a fire in the open (the notice board says it),
   * for example "the leavers' camp"; a fire in a room goes by the room's name. `longNight`: the lodge's
   * fire, which nobody tends on the Long Night (sky.ts): it burns down like a shelter's until dawn, and
   * the town keeps it going.
   */
  | { kind: 'fireplace'; x: number; y: number; tended?: boolean; name?: string; longNight?: boolean }
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
   * A place in a home of one's own where furniture stands (comfort.ts): spoiled by years of damp until
   * its owner makes new furniture for it at the workbench. Each player sees their own (their cabin is
   * theirs alone). `what` says which: a bed two tiles long, the rug three by two (walked over), the rest one.
   */
  | { kind: 'comfort'; x: number; y: number; what: Comfort }
  /**
   * One of NAPO's teleports: one in every cabin (a home of one's own) and its twin in the home town.
   * A at the cabin's takes you to town, onto the tile in front of the town's (teleportArrival); the
   * town's only receives. Faced like a desk, from the tile in front of it.
   */
  | { kind: 'teleport'; x: number; y: number }
  /**
   * A handwritten note someone left (notes.ts): on a table, a shelf, a crate or a bed, in a car, on the
   * luggage, nailed to a pole. It lies on the tile of what it is on, so it blocks nothing itself, and you
   * read it like a sign, facing that. `id` names it for good (what players read is kept by it), `by`
   * says who wrote it, `name` what the text box calls it ("Nailed to the pole"). A note with `when`
   * only shows at night, in the rain or on an aurora night; the rest of the time the box says `faint`.
   */
  | { kind: 'note'; x: number; y: number; id: string; by: NoteAuthor; name: string; text: string[]; when?: NoteWhen; faint?: string };

/** Who left notes behind: the ranger, Walt Pruitt when he walked the line, and the Barlows from the cabin at the end. */
export const NOTE_AUTHORS = ['ranger', 'walt', 'barlows'] as const;
export type NoteAuthor = (typeof NOTE_AUTHORS)[number];
/** When a note shows (notes.ts, noteShows): written in something that glows, in wax that only water shows, or scratched with a shard. */
export const NOTE_WHEN = ['night', 'rain', 'aurora'] as const;
export type NoteWhen = (typeof NOTE_WHEN)[number];
/** What a note may lie on: its tile is one of these things' tiles. */
export const NOTE_ON = ['table', 'shelf', 'crate', 'bed', 'pole', 'car', 'truck', 'luggage'] as const;

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
  /**
   * Outdoors only (a town or the wilds): when it rains over this region, windows counted from dawn
   * (sky.ts). None: the usual rain (DEFAULT_RAIN); an empty list: it never rains. A room hears the rain
   * of the map its door opens onto.
   */
  rain?: RainWindow[];
  /** The wilds only: how this region surges (sky.ts). None: it never does. */
  surge?: SurgeRule;
  /** The wilds only: how often a storm rolls over this region (sky.ts). None: it never storms. */
  storm?: StormRule;
  /** The wilds only: how often a flash starts near someone out here (sky.ts). None: no flashes. */
  flashes?: FlashRule;
  /** The wilds only: watchers, creatures that come closer while nobody looks at them. */
  watchers?: WatcherRule;
  /**
   * Insides only: the inside of one of NAPO's buildings (napo: concrete, not logs), or the sawmill's
   * floor (mill: boards, not logs). Its door is a building of the same style.
   */
  style?: 'napo' | 'mill';
  /**
   * A room with a chest only: a home that is each player's own. Whoever walks in through their own door is
   * in a copy of the room of their own (their cabin, the server's zones), where only the neighbors they let
   * in join them, to look round (world.ts, visits).
   */
  private?: true;
  /**
   * A private room only, the one whose door opens onto the home town: where you wake up in it (as a new
   * player, and after a collapse), on a walkable tile by its fire, facing `dir`.
   */
  wake?: { x: number; y: number; dir: Dir };
  /** Places on this map people call by name; the paper map writes them in. */
  places?: MapPlace[];
  /**
   * A town only: a street of cabins (Residents' Lane), where each player's cabin stands. The server keeps a
   * copy of it for each street of neighbors, each of its houses a lot (in the order they are listed),
   * whose door leads into its owner's own cabin (the private home).
   */
  street?: true;
  /** The wilds only: skulkers, creatures that lie in the ferns and chase whoever they hear or see. */
  skulkers?: SkulkerRule;
  /**
   * The wilds only: how the forest grows. 'old': old growth, as deep in as the Far Woods, the firs older
   * and taller with cedars among them, the ferns deep and the light under them dimmer. Left out: the
   * younger woods nearer town.
   */
  forest?: 'old';
  /**
   * Outdoors only: the water that freezes in winter (sky.ts, SEASONS: `frozen`), each by what people call
   * it and its tiles as [x, y]: while it is frozen it is ice, walked on like ground (TileMap.freeze). The
   * pond in the Near Woods, the brook in Stonebrook. None: nothing here freezes.
   */
  ice?: FrozenWater[];
}

/** Water that freezes in winter: what people call it ("the pond"), and its tiles. */
export interface FrozenWater {
  name: string;
  tiles: Array<[number, number]>;
}

/** A watcher takes a step this often, unless its region's rule says otherwise (WatcherRule.stepMs); players are faster. */
export const WATCHER_STEP_MS = 520;
/** ...and this often on aurora nights: watchers are restless then, everywhere by the same share (watcherStepMs). */
export const AURORA_WATCHER_STEP_MS = 400;
/** A skulker takes a step this often, unless its region's rule says otherwise: a quarter slower than a walking player, so moving away in time escapes it. */
export const SKULKER_STEP_MS = 250;
/**
 * No creature is ever as quick as you: its pace (a step every so many ms, a watcher's on an aurora night
 * too) is at least a tenth slower than a walking player's. Moving away in time escapes any of them.
 */
export const CREATURE_STEP_MIN_MS = Math.round(STEP_MS * 1.1);

/** How many watchers roam a region at once, how far from home (in steps) they wake up, and how fast they are there. */
export interface WatcherRule {
  count: number;
  steps: [number, number];
  /** A step every this many ms (WATCHER_STEP_MS when left out): deeper regions keep quicker ones. */
  stepMs?: number;
}

/**
 * How many skulkers lie in a region's ferns, how far from home (in steps) they wake and may go, and
 * when they are out: 'night' (night and aurora nights) and 'storm' (while a storm blows over the region).
 */
export interface SkulkerRule {
  count: number;
  steps: [number, number];
  when: Array<'night' | 'storm'>;
  /** A step every this many ms while it chases (SKULKER_STEP_MS when left out): deeper regions keep quicker ones. */
  stepMs?: number;
}

/** How often a region's watchers step: its rule's pace, quicker on an aurora night by the share every watcher is. */
export function watcherStepMs(rule: WatcherRule | undefined, aurora: boolean): number {
  const pace = rule?.stepMs ?? WATCHER_STEP_MS;
  return aurora ? Math.round((pace * AURORA_WATCHER_STEP_MS) / WATCHER_STEP_MS) : pace;
}

/** How often a region's skulkers step while they chase. */
export function skulkerStepMs(rule: SkulkerRule | undefined): number {
  return rule?.stepMs ?? SKULKER_STEP_MS;
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
  'hearth', 'sheeted', 'crib', 'clock', 'paper', 'saw', 'carriage', 'cache', 'teleport',
  'ruin', 'yarder', 'spool', 'traps',
]);
/**
 * Objects that are only drawn: you walk over or through them. A note is drawn on what it lies on,
 * which blocks the way itself.
 */
export const DECOR = new Set<MapObject['kind']>(['shrooms', 'rug', 'skid', 'stake', 'sawdust', 'bridge', 'note']);

/** Does this object stop anyone from walking onto its tiles? A comfort place does, but for the rug. */
export function blocks(o: MapObject): boolean {
  return o.kind === 'comfort' ? !underfootComfort(o.what) : BLOCKING.has(o.kind);
}

/** Is this object only drawn, walked over or through (DECOR, and the rug of a comfort place)? */
export function underfoot(o: MapObject): boolean {
  return o.kind === 'comfort' ? underfootComfort(o.what) : DECOR.has(o.kind);
}
/**
 * What you face to read or talk to, standing in front of it: the tile below it must stay open
 * ground (a jeep, bigger, is read from any side of it).
 */
export const FRONTED = new Set<MapObject['kind']>(['sign', 'npc', 'board', 'chest', 'workbench', 'console', 'paper', 'cage', 'cache', 'teleport']);

/** Where a teleport sets you down: on the tile in front of it (below), facing away from it. */
export function teleportArrival(t: { x: number; y: number }): { x: number; y: number; dir: Dir } {
  return { x: t.x, y: t.y + 1, dir: 'down' };
}

/** How many tiles an object covers, across and down: houses, vehicles, log decks, beds, rugs and a few more are bigger than one. */
export function footprint(o: MapObject): [number, number] {
  switch (o.kind) {
    case 'house': case 'rug': case 'truck': case 'jeep': case 'logs': case 'ruin': return [o.w, o.h];
    case 'car': return [o.w, o.h ?? 1];
    case 'carriage': return [o.w, 1];
    case 'bed': return [1, 2];
    case 'piano': return [2, 1];
    case 'yarder': return [2, 2];
    case 'comfort': return comfortSize(o.what);
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

/** The doors of a street's lots (MapData.street), lot by lot: its houses' doors, in the order the map lists them. None on any other map. */
export function lotDoors(data: MapData): Array<{ x: number; y: number }> {
  if (!data.street) return [];
  return data.objects.flatMap(o => (o.kind === 'house' ? [doorOf(o)] : []));
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
  /** The same with the ice walked on (null: nothing here freezes): the ways home in winter, which may be shorter. */
  private readonly stepsHomeFrozen: Int32Array | null;
  /** 1 on the water that freezes in winter (data.ice). */
  private readonly iceTiles: Uint8Array;
  /** Water here freezes in winter (data.ice lists some). */
  readonly hasIce: boolean;
  /** Frozen now: the ice is walked on. The server and the client set it as the season turns (freeze). */
  private frozen = false;
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
    for (const o of data.objects) if (blocks(o)) for (const [x, y] of objectTiles(o)) if (this.inside(x, y)) this.blocked[y * W + x] = 1;
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

    this.iceTiles = new Uint8Array(W * H);
    for (const water of data.ice ?? []) for (const [x, y] of water.tiles ?? []) if (this.inside(x, y) && this.kinds[y * W + x] === 'water') this.iceTiles[y * W + x] = 1;
    this.hasIce = this.iceTiles.includes(1);

    // Distance home, walking, the year round; and in winter, with the ice walked on too.
    this.stepsHome = this.stepsFromHome();
    this.frozen = this.hasIce;
    this.stepsHomeFrozen = this.hasIce ? this.stepsFromHome() : null;
    this.frozen = false;
    let deepest = 0;
    for (const v of this.stepsHome) if (v > deepest) deepest = v;
    this.deepest = deepest;
  }

  /**
   * Distance home, walking, as the map is walkable now: breadth-first from every home exit tile at
   * once. Only the wilds measure it; towns and the insides of buildings are safe, so every tile there
   * counts as 0.
   */
  private stepsFromHome(): Int32Array {
    const W = this.width, data = this.data;
    const steps = new Int32Array(W * this.height).fill(data.kind === 'wilds' ? -1 : 0);
    if (data.kind !== 'wilds') return steps;
    const queue: number[] = [];
    (data.exits ?? []).forEach(e => {
      if (!e.home) return;
      for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) {
        if (this.walkable(x, y) && steps[y * W + x] === -1) { steps[y * W + x] = 0; queue.push(y * W + x); }
      }
    });
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head]!, x = i % W, y = (i / W) | 0, d = steps[i]! + 1;
      for (const [nx, ny] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]] as const) {
        if (!this.walkable(nx, ny) || steps[ny * W + nx] !== -1) continue;
        steps[ny * W + nx] = d;
        queue.push(ny * W + nx);
      }
    }
    return steps;
  }

  /**
   * Winter comes (true) or goes: the water marked as ice is walked on while frozen, and the ways home
   * across it count. The same rule on the server and the client, which each set it as the season turns.
   * True when that changed what can be walked on here.
   */
  freeze(on: boolean): boolean {
    const frozen = on && this.hasIce;
    if (frozen === this.frozen) return false;
    this.frozen = frozen;
    return true;
  }

  /** Is the water here ice now (frozen, and marked to freeze)? */
  frozenAt(x: number, y: number): boolean {
    return this.frozen && this.iceAt(x, y);
  }

  /** Is this water that freezes in winter, frozen now or not? */
  iceAt(x: number, y: number): boolean {
    return this.inside(x, y) && this.iceTiles[y * this.width + x] === 1;
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

  /** Walking steps from this tile to the nearest home exit (across the ice while it is frozen); 0 in towns and insides, -1 if there is no way. */
  homeSteps(x: number, y: number): number {
    if (!this.inside(x, y)) return -1;
    return (this.frozen && this.stepsHomeFrozen ? this.stepsHomeFrozen : this.stepsHome)[y * this.width + x]!;
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

  /** Where a watcher may wake, as y * width + x: where a creature may stand (creatureMayStand), `steps` from home, and never on ice, which thaws. */
  lairs(steps: readonly [number, number]): number[] {
    const out: number[] = [];
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      const s = this.homeSteps(x, y);
      if (this.creatureMayStand(x, y) && !this.iceAt(x, y) && s >= steps[0] && s <= steps[1]) out.push(y * this.width + x);
    }
    return out;
  }

  /** Where a creature may stand, step or wake: open ground out of the light, away from fires and exits, and never in tall grass (hidden). */
  creatureMayStand(x: number, y: number): boolean {
    return this.walkable(x, y) && !this.exitAt(x, y) && !this.lit(x, y) && !this.warm(x, y) && !hidden(this, x, y);
  }

  /** Can a character stand on this tile? Water, only where it is frozen now (winter's ice). */
  walkable(x: number, y: number): boolean {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !this.inside(x, y)) return false;
    const i = y * this.width + x;
    const kind = this.kinds[i];
    return this.blocked[i] === 0 && (kind !== 'water' || (this.frozen && this.iceTiles[i] === 1)) && kind !== 'forest' && kind !== 'wall' && this.levels[i] === 0;
  }
}
