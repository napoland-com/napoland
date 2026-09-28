/**
 * The game rules for the players who are online. No I/O, no clock and no dice of its own: every call
 * that depends on time gets `now` (ms), randomness comes from `rng`, everything the players should
 * hear is queued as Outgoing messages for the network layer to drain and send, and what storage must
 * hear at once (piles, marks, the Old Stone) is queued for it the same way (takeWrites).
 *
 * The world is several maps joined by exits (a house's door is one, into the house); players see
 * and hear only the players on their own map. Everyone online has energy, which drains in the wilds,
 * holds in town and inside buildings, and only comes back next to a burning fire (the rules and
 * numbers are in shared/energy.ts). At zero a player collapses and wakes up at home.
 *
 * Out there more wears you down (energy.ts): a heavy bag, rain soaking you, a surge sweeping the
 * region (its clock is the wall clock's, sky.ts), a storm blowing over it (a clock like a surge's), a
 * flash discharging where you stand (started near someone out there, glowing first so they can step
 * out of it), a hitchhiker clinging to you at night. Fires in the
 * wilds burn down unless fed (fires.ts). Watchers roam some regions: they come closer only while
 * nobody on the map looks their way, and one that reaches you takes energy and something you carry.
 * Skulkers lie in the deep ferns at night and in storms: one that hears or sees you chases you, a
 * little slower than you walk, and one that catches you costs energy and a bag slot, dropped where
 * you stand. Tall grass hides you from them all (shared hidden()): no creature steps into it or notices
 * anyone in it, and a chase ends there; nothing else out there cares. A flare keeps them all off and
 * shakes off a hitchhiker. Anyone can paint arrows on the ground with a
 * glowcap; they last a day. The Old Stone in town wakes when enough shards are fed to it, and while
 * awake it calms every surge. Strange objects found deep in turn into something when looked at in
 * town. Feats, earned by what you do out there, make it a little easier for good (feats.ts).
 *
 * Gear is kept piece by piece (gear.ts): what a player wears wears down while they are out in the
 * wilds, protects less and less when nearly worn out, and is mended at the workbench; anomalous
 * pieces have a quirk, which everyone on the map knows (some show in the world).
 *
 * At home, a chest is each player's stash: what they put in earns XP (once: what they took out and bring
 * back earns nothing again), and XP brings levels, each a bigger energy bar (progress.ts).
 *
 * Finds lie on the maps for everyone: whoever picks one up first gets it, and a new one of the same
 * rule grows a while later on another tile that fits the rule; some grow only while a region is
 * restless, or on aurora nights. What a player picks up goes in their bag. When they collapse, the
 * bag falls out as a pile where they fell (one per player), with the last steps they walked: its owner
 * gets it all back, anyone else a random half (the rest is lost), and it fades an hour after the
 * collapse. The rules for items and bags are in shared/items.ts.
 */
import {
  QUIRKS,
  SLOTS,
  STARTER_GEAR,
  STARTER_TOOLS,
  DROP_LIFETIME_MS,
  ENERGY_SYNC_MS,
  FEATS,
  HEAVY_LOAD,
  STATS,
  STEP_MS,
  SURGE_DRAIN,
  FLASH_BURST_S,
  FLASH_GLOW_S,
  activeConditions,
  addAllToBag,
  addToBag,
  bagLoad,
  bagSlotsOf,
  canMake,
  conditionsAt,
  dayIndex,
  weekIndex,
  seeded,
  charmsIn,
  chapterOf,
  energyRate,
  featsOf,
  fitPieces,
  mendCost,
  newPiece,
  wearSeconds,
  flashHits,
  findTiles,
  gearEnergy,
  hidden,
  halfOf,
  emptyStash,
  itemIndex,
  levelOf,
  liveEnds,
  liveXp,
  maxEnergy,
  merge,
  modsOf,
  progressOf,
  reachedBy,
  resistOf,
  stashList,
  store,
  storeLive,
  takeOut,
  usedUp,
  reveal,
  stepTarget,
  stormAt,
  surgeAt,
  surgeFront,
  takeFromBag,
  untilSurge,
  weatherAt,
  wetRate,
  type Arrival,
  type BagSlot,
  type BodyView,
  type ConditionsData,
  type ConditionsView,
  type CreatureView,
  type Dir,
  type DropView,
  type EnergyView,
  type FindView,
  type FindWhen,
  type FireView,
  type FlareView,
  type FlashKind,
  type FlashView,
  type Gear,
  type ItemDef,
  type ItemsData,
  type Piece,
  type Quirk,
  type Worn,
  type MapRef,
  type MarkView,
  type Mods,
  type PlayerView,
  type ProgressView,
  type Recipe,
  type Refusal,
  type Stash,
  type ServerMsg,
  type Stats,
  type StoneView,
  type StoryData,
  type StoryEvent,
  type StoryView,
  type StormPhase,
  type StormView,
  type SurgePhase,
  type SurgeView,
  type Slot,
  type SkulkerRule,
  type TileMap,
  type Weather,
} from '@napoland/shared';
import { FIRE_LOW_S, Fires, type Fire } from './fires';
import type { DropRecord, MarkRecord, PlayerRecord, StoneRecord } from './storage';

/** A step may start this much early: messages sent at a steady pace arrive bunched up. */
export const STEP_TOLERANCE_MS = 40;
/** Early steps wait here, in order; one more than this is rejected. */
export const STEP_QUEUE_MAX = 2;
/**
 * A player hears their energy again as soon as its rate moves this share away from the rate they
 * last heard. Smaller changes (one more step into the woods) wait for the regular repeat.
 */
export const ENERGY_RATE_CHANGE = 0.1;
/** Marks fade this long after they are painted, and each player has at most this many. */
export const MARK_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const MARKS_PER_PLAYER = 6;
/** A pile keeps this many of the last steps its owner walked out there: their echo. */
export const TRAIL_STEPS = 16;
/** A watcher takes a step this often (on aurora nights, AURORA_WATCHER_STEP_MS); players are faster. */
export const WATCHER_STEP_MS = 520;
export const AURORA_WATCHER_STEP_MS = 400;
/** A watcher goes after players at most this many steps away (as the crow walks), and freezes while any player this close faces it. */
export const WATCHER_HUNT = 9;
/** Someone carrying a live find glows: watchers come for them from this far. */
export const WATCHER_HUNT_LIVE = 12;
export const WATCHER_SEE = 12;
/** What a watcher's touch costs, and how long it stays away after (seconds, a random time in the range). */
export const WATCHER_TOUCH = 15;
export const WATCHER_AWAY_S: [number, number] = [60, 150];
/** A watcher wakes up at least this far (as the crow walks) from every player on its map. */
export const WATCHER_WAKE_AWAY = 8;
/** Watchers look this many tiles ahead for a way to you. */
const WATCHER_PATH_NODES = 600;
/** A skulker takes a step this often: a quarter slower than a walking player (STEP_MS), so moving away in time escapes it. */
export const SKULKER_STEP_MS = 250;
/** A skulker notices a player out in the open this close (as the crow walks): farther if they are walking (it hears them). */
export const SKULKER_HEAR = 6;
export const SKULKER_SEE = 3;
/** A player whose last step ended less than this long ago is walking, as far as a skulker can hear. */
export const SKULKER_HEAR_MS = 300;
/** A skulker gives up a chase after this long, then notices nobody for SKULKER_CALM_MS while it goes back to its lair. */
export const SKULKER_CHASE_MS = 20_000;
export const SKULKER_CALM_MS = 15_000;
/** What a skulker's catch costs (and a bag slot, dropped where you stand). */
export const SKULKER_CATCH = 20;
/** In the dark, this many steps or more from home, something may cling to your back: on average once in HITCH_EVERY_S. */
export const HITCH_STEPS = 25;
export const HITCH_EVERY_S = 150;
/** A flare keeps creatures this far away (tiles, center to center) while it burns. */
export const FLARE_RADIUS = 5;
/** The Old Stone wakes with this many shards in it; awake, one burns away every STONE_SHARD_S. */
export const STONE_NEED = 20;
export const STONE_SHARD_S = 30 * 60;
/** The notice board counts collapses this far back. */
const COLLAPSES_MS = 60 * 60 * 1000;

/** Jacket colors, all easy to tell apart in the rain and at night. */
export const JACKET_COLORS = [
  '#e4572e', // red
  '#f29e4c', // orange
  '#f1c40f', // yellow
  '#7bc950', // green
  '#2ec4b6', // teal
  '#3a86ff', // blue
  '#9b5de5', // purple
  '#f15bb5', // pink
  '#f4f1de', // white
  '#c08552', // tan
] as const;

/** The same id always gets the same color (FNV-1a hash of the id). */
export function colorFor(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return JACKET_COLORS[(h >>> 0) % JACKET_COLORS.length]!;
}

/**
 * A message for one player (by id), or for everyone on a map ('*'), optionally leaving one player
 * out, or for everyone online ('all'). '*' means everyone on the map when the message was queued: the
 * network layer sends the messages in order and moves a player over to the new map's audience at
 * their `zone` message.
 */
export type Outgoing = { to: string; msg: ServerMsg } | { to: '*'; map: string; except?: string; msg: ServerMsg } | { to: 'all'; msg: ServerMsg };

/** What a map holds besides players, as its welcome or zone lists it. */
export interface Scene {
  finds: FindView[];
  drops: DropView[];
  fires: FireView[];
  marks: MarkView[];
  creatures: CreatureView[];
  flares: FlareView[];
  flashes: FlashView[];
  surge: SurgeView | null;
  storm: StormView | null;
}

/** What a player who joins is told in the welcome: where they are, who and what is there, their energy, body and bag. */
export interface Joined extends Scene {
  player: PlayerView;
  map: MapRef;
  /** Everyone on the player's map, the player included. */
  players: PlayerView[];
  energy: EnergyView;
  body: BodyView;
  bag: BagSlot[];
  stone: StoneView;
  conditions: ConditionsView;
  stats: Stats;
  progress: ProgressView;
  /** Every tool the player carries (for now, the starter tools that exist). */
  tools: string[];
  story: StoryView;
}

/** What storage must hear: piles and marks to write (or remove: undefined), players to save now, and the Old Stone if it changed. */
export interface Writes {
  drops: Array<{ owner: string; drop: DropRecord | undefined }>;
  /** Players whose bag changed along with a pile, as they are now: saved with it, so a crash cannot leave items in both. */
  players: PlayerRecord[];
  marks: Array<{ id: number; mark: MarkRecord | undefined }>;
  stone?: StoneRecord;
}

export interface WorldOptions {
  /** Time to walk one tile. */
  stepMs?: number;
  /** Hears about every collapse, with where the player fell (for the log). */
  onCollapse?: (id: string, where: { map: string; x: number; y: number }) => void;
  /** Items and where finds grow (content/items.json, checked with validateItems); none if unset. */
  items?: ItemsData;
  /** The story's chapters (content/story.json, checked with validateStory); none if unset. */
  story?: StoryData;
  /** Where finds grow, when and which half of a pile someone else gets, what a strange object is. Math.random unless a test sets its own. */
  rng?: () => number;
  /** Piles saved before a restart; they lie where they were until they fade. */
  drops?: DropRecord[];
  /** Marks saved before a restart. */
  marks?: MarkRecord[];
  /** The Old Stone as it was saved. */
  stone?: StoneRecord | null;
  /**
   * Add to `now` for ms since the epoch. Piles and marks fade by the wall clock, which clients and the
   * database see, and the weather and the surges follow it, while `now` is game time, which must never
   * go backwards. 0 (the default): `now` is the wall clock.
   */
  epochOffset?: number;
  /** The weather follows the day (sky.ts) instead of staying as it was given. */
  cycle?: boolean;
  /** Game time now, when the world starts: the fires out there start burning from here. */
  now?: number;
}

interface Online {
  rec: PlayerRecord;
  map: TileMap;
  /** When the current step is over and the next one may start. */
  readyAt: number;
  queue: Array<{ dir: Dir; seq: number }>;
  /** A talk, or a look at the notice board, that came in while steps sent before it still waited in the queue: done once they are walked (talk, board). */
  after?: { t: 'talk' | 'board'; x: number; y: number };
  /** Energy and wetness per second on the player's tile. rec.energy and rec.wet are up to date as of energyAt. */
  rate: number;
  wetRate: number;
  energyAt: number;
  /** What the bag weighs now (bagLoad), with feats and charms. */
  load: number;
  /** Feats and charms, as factors. */
  mods: Mods;
  /** A full bar (level and gear), and the bag's slots (the bag worn). */
  max: number;
  slots: number;
  /** Something clings to their back, and when that was last checked. */
  hitched: boolean;
  hitchAt: number;
  /** The last tiles walked on this map, out in the wilds. */
  trail: Array<[number, number]>;
  /** What the player last heard, and when: the client counts on from there. */
  heardRate: number;
  heardWetRate: number;
  heardLoad: number;
  heardAt: number;
  /** Live finds in the bag (sendBag keeps it up to date), so only their carriers are looked at for fading. */
  live: number;
}

/** A find rule of items.json, ready to use. */
interface Rule {
  item: ItemDef;
  map: TileMap;
  /** Every tile its finds may grow on (findTiles), as y * width + x. */
  tiles: number[];
  count: number;
  /** Seconds, shortest and longest. */
  respawn: [number, number];
  /** Only then; and whether it is now. Rules without `when` are always open. */
  when?: FindWhen;
  /** Only while this condition is on (sky.ts). */
  condition?: string;
  open: boolean;
}

interface Find {
  id: number;
  rule: Rule;
  /** y * width + x on the rule's map. */
  tile: number;
}

/** A find that grows at `at`, on another tile than `not` (where the last one was taken) if it can. */
interface Growing {
  rule: Rule;
  at: number;
  not: number | undefined;
}

interface Watcher {
  id: number;
  kind: CreatureView['kind'];
  map: TileMap;
  x: number;
  y: number;
  dir: Dir;
  /** Out and about, or away until wakeAt. */
  awake: boolean;
  wakeAt: number;
  /** When it may take its next step. */
  readyAt: number;
  /** Where it may wake up (y * width + x). */
  lairs: number[];
  /** The id of the player it chases (skulkers only). */
  chasing?: string;
}

/** A skulker: a creature that wakes like a watcher, but lies still in the ferns until it hears or sees someone. */
interface Skulker extends Watcher {
  rule: SkulkerRule;
  /** Where it woke up, and goes back to after a chase (y * width + x). */
  lair: number;
  /** When it gives up the chase; until calmUntil after one, it notices nobody. */
  chaseUntil: number;
  calmUntil: number;
}

interface Flash {
  map: string;
  x: number;
  y: number;
  kind: FlashKind;
  /** Game time when it is over; it discharges in its last FLASH_BURST_S. */
  until: number;
}

interface Flare {
  map: string;
  x: number;
  y: number;
  /** Game time when it burns out. */
  until: number;
}

const quirksOf = (w: Worn | undefined): Quirk[] => SLOTS.flatMap(s => (w?.[s]?.quirk ? [w[s]!.quirk!] : []));
const view = (r: PlayerRecord, live = false): PlayerView => ({
  id: r.id, name: r.name, x: r.x, y: r.y, dir: r.dir, color: r.color, gear: { ...r.gear }, quirks: quirksOf(r.worn), ...(live ? { live: true as const } : {}),
});
const mapRef = (m: TileMap): MapRef => ({ id: m.data.id, version: m.data.version });
const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const flashView = (f: Flash, now: number): FlashView => ({ x: f.x, y: f.y, kind: f.kind, left: round((f.until - now) / 1000, 1) });
const energyView = (p: Online): EnergyView => ({ value: round(p.rec.energy, 1), max: p.max, rate: round(p.rate, 3) });
const copyWorn = (w: Worn | undefined): Worn => Object.fromEntries(Object.entries(w ?? {}).map(([s, p]) => [s, { ...p, cond: round(p.cond, 3) }]));
const bodyView = (p: Online): BodyView => ({ wet: round(p.rec.wet ?? 0, 3), wetRate: round(p.wetRate, 5), load: p.load, hitched: p.hitched, worn: copyWorn(p.rec.worn) });
/**
 * Draining and not empty yet, or refilling and not full yet. Holding (rate 0) changes nothing.
 * Wetness is left out: it moves at a steady rate the client counts on, and is told when that turns.
 */
const changing = (p: Online): boolean => (p.rate < 0 && p.rec.energy > 0) || (p.rate > 0 && p.rec.energy < p.max);
const findView = (f: Find): FindView => ({ id: f.id, item: f.rule.item.id, x: f.tile % f.rule.map.width, y: Math.floor(f.tile / f.rule.map.width) });
const dropView = (d: DropRecord): DropView => ({
  id: d.owner, x: d.x, y: d.y, owner: d.owner, name: d.name, until: d.droppedAt + DROP_LIFETIME_MS, trail: (d.trail ?? []).map(([x, y]) => [x, y]),
});
const markView = (m: MarkRecord): MarkView => ({ id: m.id, x: m.x, y: m.y, dir: m.dir, color: m.color, name: m.name, until: m.placedAt + MARK_LIFETIME_MS });
const creatureView = (w: Watcher): CreatureView => ({ id: w.id, kind: w.kind, x: w.x, y: w.y, dir: w.dir, ...(w.chasing !== undefined && { chasing: w.chasing }) });
const copyBag = (bag: readonly BagSlot[]): BagSlot[] => bag.map(s => ({ item: s.item, count: s.count, ...(s.since !== undefined ? { since: s.since } : {}) }));
/** The bag as its owner hears it: a live item's `since` (the server's wall clock) as its age in seconds. */
const bagView = (bag: readonly BagSlot[], wall: number): BagSlot[] =>
  bag.map(s => ({ item: s.item, count: s.count, ...(s.since !== undefined ? { age: round(Math.max(0, wall - s.since) / 1000, 1) } : {}) }));
const copyStash = (s: Stash): Stash => ({
  items: { ...s.items }, out: { ...s.out }, ...(s.pieces ? { pieces: Object.fromEntries(Object.entries(s.pieces).map(([id, l]) => [id, l.map(p => ({ ...p }))])) } : {}),
});
const copyRecord = (r: PlayerRecord): PlayerRecord => ({
  ...r, bag: copyBag(r.bag), stats: { ...r.stats }, ...(r.stash ? { stash: copyStash(r.stash) } : {}), ...(r.gear ? { gear: { ...r.gear } } : {}),
  ...(r.worn ? { worn: copyWorn(r.worn) } : {}),
});
/** A saved piece as the server writes them: a condition from 0 to 1, and a quirk the game knows (or none). */
const isPiece = (p: unknown): p is Piece => {
  const { cond, quirk } = (typeof p === 'object' && p !== null ? p : {}) as Partial<Piece>;
  return typeof cond === 'number' && cond >= 0 && cond <= 1 && (quirk === undefined || QUIRKS.includes(quirk));
};
/** A bag slot as the server writes them; saved data is checked with this before it is trusted. */
const isSlot = (s: unknown): s is BagSlot => {
  const { item, count, since } = (typeof s === 'object' && s !== null ? s : {}) as Partial<BagSlot>;
  return typeof item === 'string' && Number.isInteger(count) && count! > 0 && (since === undefined || Number.isFinite(since));
};
/** Saved counts, trusted only where they are whole numbers from 0. */
const cleanStats = (s: unknown): Stats => {
  const out: Stats = {};
  const raw = (typeof s === 'object' && s !== null ? s : {}) as Record<string, unknown>;
  for (const k of STATS) if (Number.isInteger(raw[k]) && (raw[k] as number) > 0) out[k] = raw[k] as number;
  return out;
};
/** A saved stash as today's items fit it: counts that are whole numbers above 0, of items that still exist. */
const cleanStash = (s: unknown, items: Map<string, ItemDef>): Stash => {
  const out = emptyStash();
  const raw = (typeof s === 'object' && s !== null ? s : {}) as Partial<Record<keyof Stash, unknown>>;
  for (const k of ['items', 'out'] as const) {
    const part = (typeof raw[k] === 'object' && raw[k] !== null ? raw[k] : {}) as Record<string, unknown>;
    for (const [id, n] of Object.entries(part)) if (items.has(id) && Number.isInteger(n) && (n as number) > 0) out[k][id] = n as number;
  }
  const pieces = (typeof raw.pieces === 'object' && raw.pieces !== null ? raw.pieces : {}) as Record<string, unknown>;
  for (const [id, list] of Object.entries(pieces)) if (Array.isArray(list)) (out.pieces ??= {})[id] = list.filter(isPiece).map(p => ({ ...p }));
  return out;
};
const manhattan = (ax: number, ay: number, bx: number, by: number) => Math.abs(ax - bx) + Math.abs(ay - by);

export class World {
  readonly stepMs: number;
  /** Where new players start and collapsed players wake up. */
  readonly home: TileMap;
  /** The version of the items (content/items.json): a client with another one reloads. */
  readonly itemsVersion: number;
  /** The story's chapters (story.ts): where each player is in it is theirs (PlayerRecord.story). */
  private readonly story: StoryData;
  private readonly maps = new Map<string, TileMap>();
  /** For each inside, the kind of map its door opens onto: a shelter in the wilds, or a house in town. */
  private readonly outside = new Map<string, TileMap['data']['kind']>();
  private readonly players = new Map<string, Online>();
  /** Who is on each map, by map id. */
  private readonly onMap = new Map<string, Set<Online>>();
  /** readyAt of players who left mid-step, so leaving and joining again cannot skip the wait. */
  private readonly resting = new Map<string, number>();
  private outbox: Outgoing[] = [];
  private sky: Weather;
  private readonly cycle: boolean;
  private readonly onCollapse: WorldOptions['onCollapse'];
  private readonly items: Map<string, ItemDef>;
  /** The items in the order of content/items.json: a stash lists them so. */
  private readonly itemOrder: ItemDef[];
  /** What the workbench makes, by recipe id. */
  private readonly recipes: Map<string, Recipe>;
  /** How gear wears out, and what mending it costs (content/items.json). */
  private readonly wear: ItemsData['wear'];
  private readonly mendCosts: ItemsData['mend'];
  private readonly rng: () => number;
  private readonly epochOffset: number;
  private readonly rules: Rule[] = [];
  /** The finds lying on each map, by map id and tile: never two on one tile. */
  private readonly finds = new Map<string, Map<number, Find>>();
  private growing: Growing[] = [];
  /** The earliest time in `growing`, so tick() only looks through it when something is due. */
  private growAt = Infinity;
  private nextFindId = 1;
  /** Piles by owner: each player has at most one. */
  private readonly piles = new Map<string, DropRecord>();
  /** The same piles by map id and tile (several players may fall on one tile). */
  private readonly pileTiles = new Map<string, Map<number, DropRecord[]>>();
  /** The game time when the next pile fades (or later), so tick() only looks when one is due. */
  private fadeAt = Infinity;
  private readonly pileWrites = new Map<string, DropRecord | undefined>();
  /** By id: the record itself, which stays whole after a player leaves (their collapse on the way out counts too). */
  private readonly saveNow = new Map<string, PlayerRecord>();
  private readonly fires: Fires;
  /** Marks by id, and by map id and tile (one per tile). */
  private readonly marks = new Map<number, MarkRecord>();
  private readonly markTiles = new Map<string, Map<number, MarkRecord>>();
  private readonly markWrites = new Map<number, MarkRecord | undefined>();
  private nextMarkId = 1;
  private markFadeAt = Infinity;
  /** Each surging map's phase as its players last heard it. */
  private readonly surgePhase = new Map<string, SurgePhase>();
  /** The map each inside's door opens onto: its storm is the one heard drumming on the roof. */
  private readonly around = new Map<string, TileMap>();
  /** Each storming map's phase (an inside's: the one around it) as its players last heard it. */
  private readonly stormPhase = new Map<string, StormPhase>();
  private flashes: Flash[] = [];
  /** When each map with flashes starts its next one (game time). */
  private readonly nextFlash = new Map<string, number>();
  private readonly watchers = new Map<string, Watcher[]>();
  private readonly skulkers = new Map<string, Skulker[]>();
  private nextCreatureId = 1;
  private flares: Flare[] = [];
  /** The Old Stone: where it stands (if anywhere), its charge in shards, and when that charge was so (game time). */
  private readonly stone: { map: TileMap; x: number; y: number } | undefined;
  private stoneCharge = 0;
  private stoneAwake = false;
  private stoneAt = 0;
  private stoneWrite: StoneRecord | undefined;
  /** What the woods are like today and this week (sky.ts), and the day and week drawn; both undefined until the first tick. */
  private readonly conditionsData: ConditionsData | undefined;
  private conditions: ConditionsView = { today: [], week: null, next: null };
  private day: number | undefined;
  private week: number | undefined;
  /** Where each map's watchers wake as a rule, and where while a condition moves them (by condition id). */
  private readonly baseLairs = new Map<string, number[]>();
  private readonly conditionLairs = new Map<string, number[]>();
  /** Maps whose watchers sleep (a condition). */
  private readonly asleep = new Set<string>();
  /** Collapses in the last hour, for the notice board. */
  private collapses: Array<{ map: string; at: number }> = [];

  /** `maps` must fit together (validateWorld) and `items` must fit the maps (validateItems); `homeId` is a town. */
  constructor(maps: Iterable<TileMap>, homeId: string, weather: Weather, options: WorldOptions = {}) {
    for (const m of maps) {
      if (this.maps.has(m.data.id)) throw new Error(`two maps have the id ${m.data.id}`);
      this.maps.set(m.data.id, m);
      this.onMap.set(m.data.id, new Set());
      this.finds.set(m.data.id, new Map());
      this.pileTiles.set(m.data.id, new Map());
      this.markTiles.set(m.data.id, new Map());
    }
    // loadMaps checks this and more; a world without it would lose players walking through an exit.
    for (const m of this.maps.values()) {
      for (const e of m.data.exits) if (!this.maps.has(e.to)) throw new Error(`map ${m.data.id} has an exit to ${e.to}, which does not exist`);
    }
    for (const m of this.maps.values()) {
      if (m.data.kind === 'inside') continue;
      for (const e of m.data.exits) if (this.maps.get(e.to)!.data.kind === 'inside') { this.outside.set(e.to, m.data.kind); this.around.set(e.to, m); }
    }
    const home = this.maps.get(homeId);
    if (!home) throw new Error(`the home map ${homeId} does not exist`);
    this.home = home;
    this.sky = weather;
    this.cycle = options.cycle ?? false;
    this.stepMs = options.stepMs ?? STEP_MS;
    this.onCollapse = options.onCollapse;
    this.rng = options.rng ?? Math.random;
    this.epochOffset = options.epochOffset ?? 0;
    this.fires = new Fires(this.maps.values(), m => this.wild(m), this.rng, options.now ?? 0);

    const items = options.items ?? { version: 0, items: [], finds: [] };
    this.items = itemIndex(items);
    this.itemOrder = items.items;
    this.recipes = new Map((items.recipes ?? []).map(rc => [rc.id, rc]));
    this.wear = items.wear;
    this.mendCosts = items.mend;
    this.itemsVersion = items.version;
    this.story = options.story ?? { version: 0, chapters: [] };
    for (const f of items.finds) {
      // loadItems checks this and more (validateItems).
      const map = this.maps.get(f.map);
      if (!map) throw new Error(`a find rule grows ${f.item} on map ${f.map}, which does not exist`);
      const item = this.items.get(f.item);
      if (!item) throw new Error(`a find rule on map ${f.map} grows ${f.item}, which is not an item`);
      const tiles = findTiles(map, f).map(t => t.y * map.width + t.x);
      // Finds that only grow at certain times wait for the first tick to tell whether it is one.
      this.rules.push({ item, map, tiles, count: f.count, respawn: f.respawn, when: f.when, condition: f.condition, open: !f.when && !f.condition });
    }
    // The piles first: finds never grow on a tile that has one.
    for (const d of options.drops ?? []) this.restore(d);
    for (const rule of this.rules) if (rule.open) this.sow(rule);
    for (const m of options.marks ?? []) this.restoreMark(m);

    for (const m of this.maps.values()) {
      const w = m.data.watchers;
      if (m.data.kind !== 'wilds' || !w) continue;
      const lairs = m.lairs(w.steps);
      if (!lairs.length) continue;
      this.baseLairs.set(m.data.id, lairs);
      // They all wake on the first tick, each where nobody is.
      this.watchers.set(m.data.id, Array.from({ length: w.count }, () => ({ id: this.nextCreatureId++, kind: 'watcher', map: m, x: 0, y: 0, dir: 'down', awake: false, wakeAt: -Infinity, readyAt: 0, lairs })));
    }
    for (const m of this.maps.values()) {
      const rule = m.data.skulkers;
      if (m.data.kind !== 'wilds' || !rule) continue;
      const lairs: number[] = [];
      for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (m.kind(x, y) === 'ferns' && this.skulkerMayStand(m, rule, x, y)) lairs.push(y * m.width + x);
      if (!lairs.length) continue;
      this.skulkers.set(m.data.id, Array.from({ length: rule.count }, () => ({
        id: this.nextCreatureId++, kind: 'skulker', rule, map: m, x: 0, y: 0, dir: 'down', awake: false, wakeAt: -Infinity, readyAt: 0, lairs, lair: 0, chaseUntil: 0, calmUntil: 0,
      })));
    }

    this.conditionsData = items.conditions;
    for (const c of [...items.conditions?.daily ?? [], ...items.conditions?.weekly ?? []]) {
      const steps = c.watchers?.steps;
      const m = this.maps.get(c.map);
      if (steps && m && this.baseLairs.has(c.map)) this.conditionLairs.set(c.id, m.lairs(steps));
    }

    const stone = [...this.maps.values()].flatMap(m => m.data.objects.filter(o => o.kind === 'stone').map(o => ({ map: m, x: o.x, y: o.y })))[0];
    this.stone = stone;
    const saved = options.stone;
    if (saved && Number.isFinite(saved.charge) && Number.isFinite(saved.at)) {
      this.stoneCharge = Math.max(0, saved.charge);
      this.stoneAwake = saved.awake;
      // Awake, it kept burning while the server was down.
      this.stoneAt = saved.at - this.epochOffset;
    }
  }

  get weather(): Weather {
    return this.sky;
  }

  get size(): number {
    return this.players.size;
  }

  has(id: string): boolean {
    return this.players.has(id);
  }

  /** A copy of an online player's record, as it should be saved (energy as of the last tick). */
  get(id: string): PlayerRecord | undefined {
    const p = this.players.get(id);
    return p && copyRecord(p.rec);
  }

  records(): PlayerRecord[] {
    return [...this.players.values()].map(p => copyRecord(p.rec));
  }

  /** Everyone on a map. */
  views(mapId: string): PlayerView[] {
    return [...(this.onMap.get(mapId) ?? [])].map(p => view(p.rec, p.live > 0));
  }

  /** What lies on a map to pick up. */
  findViews(mapId: string): FindView[] {
    return [...(this.finds.get(mapId)?.values() ?? [])].map(findView);
  }

  /** The piles lying on a map. */
  dropViews(mapId: string): DropView[] {
    return [...(this.pileTiles.get(mapId)?.values() ?? [])].flat().map(dropView);
  }

  /** Everything a map holds besides players, as of `now`. */
  scene(mapId: string, now: number): Scene {
    const map = this.maps.get(mapId);
    return {
      finds: this.findViews(mapId),
      drops: this.dropViews(mapId),
      fires: this.fires.views(mapId, now),
      marks: [...(this.markTiles.get(mapId)?.values() ?? [])].map(markView),
      creatures: [...(this.watchers.get(mapId) ?? []), ...(this.skulkers.get(mapId) ?? [])].filter(w => w.awake).map(creatureView),
      flares: this.flares.filter(f => f.map === mapId && f.until > now).map(f => ({ x: f.x, y: f.y, left: round((f.until - now) / 1000, 1) })),
      flashes: this.flashes.filter(f => f.map === mapId && f.until > now).map(f => flashView(f, now)),
      surge: map ? this.surgeOf(map, now) : null,
      storm: map ? this.stormOf(map, now) : null,
    };
  }

  /** The Old Stone as everyone sees it. */
  stoneView(now: number): StoneView {
    this.burnStone(now);
    return { charge: Math.ceil(this.stoneCharge), need: STONE_NEED, awake: this.stoneAwake, left: this.stoneAwake ? Math.round(this.stoneCharge * STONE_SHARD_S) : 0 };
  }

  /** Puts a player in the world, tells everyone on their map and returns what goes in the welcome. */
  join(rec: PlayerRecord, now: number): Joined {
    if (this.players.has(rec.id)) throw new Error(`player ${rec.id} is already online`);
    const gear = this.cleanGear(rec.gear);
    const r: PlayerRecord = {
      ...rec, gear, worn: this.cleanWorn(rec.worn, gear), bag: this.fitBag(rec.bag, bagSlotsOf(gear, this.items)), stats: cleanStats(rec.stats),
      // Gear counted in the stash gets its pieces (all of it, for a stash saved before pieces existed).
      stash: fitPieces(cleanStash(rec.stash, this.items), this.items, this.rng),
      xp: Number.isInteger(rec.xp) && rec.xp! > 0 ? rec.xp : 0,
    };
    // Maps change between visits: a map may be gone (start over at home), or the saved tile may be
    // inside something new or part of an exit now (start at that map's spawn). Never start inside
    // a wall, or on an exit that would move you the moment you step.
    let map = this.maps.get(r.map);
    if (!map) {
      map = this.home;
      toSpawn(r, map);
    } else if (!map.walkable(r.x, r.y) || map.exitAt(r.x, r.y)) {
      toSpawn(r, map);
    }
    r.map = map.data.id;
    r.energy = Number.isFinite(r.energy) ? Math.min(this.maxOf(r), Math.max(0, r.energy)) : this.maxOf(r);
    r.wet = Number.isFinite(r.wet) ? clamp01(r.wet!) : 0;
    const readyAt = this.resting.get(r.id) ?? -Infinity;
    this.resting.delete(r.id);
    const p: Online = {
      rec: r, map, readyAt, queue: [], rate: 0, wetRate: 0, energyAt: now, load: 0, mods: modsOf(r.stats!), max: this.maxOf(r), slots: bagSlotsOf(gear, this.items), hitched: false, hitchAt: now, trail: [],
      heardRate: 0, heardWetRate: 0, heardLoad: 0, heardAt: now, live: this.liveIn(r.bag),
    };
    this.refresh(p, now);
    this.players.set(r.id, p);
    this.onMap.get(map.data.id)!.add(p);
    const player = view(r, p.live > 0);
    this.toMap(map.data.id, { t: 'join', player }, r.id);
    // The welcome has the energy too; the message after it is what a client listens to from then on.
    this.tell(p, now);
    const here = map.data.id;
    return {
      player, map: mapRef(map), players: this.views(here), ...this.scene(here, now), energy: energyView(p), body: bodyView(p), bag: bagView(r.bag, now + this.epochOffset),
      stone: this.stoneView(now), conditions: this.conditionsNow(now), stats: { ...r.stats }, progress: progressOf(r.xp ?? 0),
      tools: STARTER_TOOLS.filter(t => this.items.get(t)?.kind === 'tool'),
      // The chapter they are in, which is the first for someone who never started (story.ts).
      story: { version: this.story.version, chapter: chapterOf(this.story, r.story)?.id ?? '' },
    };
  }

  /** Takes a player out of the world, tells everyone on their map and returns the record to save. */
  leave(id: string, now: number): PlayerRecord | undefined {
    const p = this.players.get(id);
    if (!p) return undefined;
    const from = p.map;
    // Energy that runs out on the way out still counts: the bag drops, and the player wakes up at home next time.
    if (this.advance(p, now) <= 0) this.fall(p, now);
    this.players.delete(id);
    this.onMap.get(p.map.data.id)!.delete(p);
    if (p.readyAt > -Infinity) this.resting.set(id, p.readyAt);
    this.toMap(from.data.id, { t: 'leave', id }, id);
    return copyRecord(p.rec);
  }

  /**
   * Walk one tile. A step starts when the previous one is (almost) over; readyAt then moves on by
   * stepMs from whichever is later, now or readyAt, so arriving early never adds up to walking
   * faster. Steps that arrive too early wait in a short queue that tick() works through; when
   * it is full the new step is refused and the queued ones still run.
   */
  step(id: string, dir: Dir, seq: number, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    if (p.queue.length === 0 && this.ready(p, now)) this.move(p, dir, seq, now);
    else if (p.queue.length < STEP_QUEUE_MAX) p.queue.push({ dir, seq });
    else this.reject(p, seq);
  }

  /** Turn in place. Only a real change is worth telling the others about. */
  face(id: string, dir: Dir): void {
    const p = this.players.get(id);
    if (!p || p.rec.dir === dir) return;
    p.rec.dir = dir;
    this.toMap(p.map.data.id, { t: 'face', id, dir }, id);
  }

  /**
   * Picks up what lies on tile x,y of the player's map: their own tile or one of the four next to it.
   * A pile there comes first, then a find. The player hears what they got and their bag, or why not;
   * everyone on the map hears what went.
   */
  pick(id: string, x: number, y: number, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    // Steps whose time has come first: the player reaches from where they really are.
    this.runQueue(p, now);
    if (this.advance(p, now) <= 0) {
      // Out of energy before reaching for it: the player collapses, far away from it now.
      this.collapse(p, now);
      return this.refuse(p, 'pick', 'too_far');
    }
    if (manhattan(x, y, p.rec.x, p.rec.y) > 1) return this.refuse(p, 'pick', 'too_far');
    const pile = this.pileAt(p.map, x, y, id);
    if (pile) return this.pickPile(p, pile, now);
    const find = p.map.inside(x, y) ? this.finds.get(p.map.data.id)!.get(y * p.map.width + x) : undefined;
    if (find) return this.pickFind(p, find, now);
    this.refuse(p, 'pick', 'gone');
  }

  /**
   * Uses one of what is in bag slot `slot`: a thermos gives energy, a glowcap paints a mark where you
   * stand, a flare keeps creatures off, a strange object turns into what it really is (in town only).
   */
  use(id: string, slot: number, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    if (this.advance(p, now) <= 0) {
      // Too late: the player collapses, and the bag falls out.
      this.collapse(p, now);
      return this.refuse(p, 'use', 'empty_slot');
    }
    const s = p.rec.bag[slot];
    if (!s) return this.refuse(p, 'use', 'empty_slot');
    const def = this.items.get(s.item);
    const use = def?.use;
    if (!def || !use) return this.refuse(p, 'use', 'not_usable');
    const { x, y, map: mapId } = p.rec;
    // Everything that can fail is checked before the item is spent.
    if (use.mark && (p.map.data.kind === 'inside' || p.map.exitAt(x, y))) return this.refuse(p, 'use', 'not_here');
    if (use.mark && this.markTiles.get(mapId)!.has(y * p.map.width + x)) return this.refuse(p, 'use', 'marked');
    if (use.identify && !this.inTown(p.map)) return this.refuse(p, 'use', 'not_here');
    let bag = takeFromBag(p.rec.bag, slot, 1);
    let got: BagSlot | undefined;
    if (use.identify) {
      const r = reveal(def.reveals ?? [], this.rng);
      const into = r && this.items.get(r.item);
      if (into) {
        const put = addToBag(bag, into, r.count, p.slots);
        if (put.left) return this.refuse(p, 'use', 'bag_full');
        bag = put.bag;
        got = { item: into.id, count: r.count };
      }
    }
    p.rec.bag = bag;
    // Used up: if it came out of the stash, it will never go back.
    p.rec.stash = usedUp(p.rec.stash ?? emptyStash(), def.id, 1);
    if (use.energy) {
      p.rec.energy = Math.min(p.max, Math.max(0, p.rec.energy + use.energy));
    }
    if (use.mark) this.paint(p, now);
    if (use.flare) this.light(p, use.flare, now);
    // The bar may have jumped, the bag got lighter: the client counts on from the new values.
    this.refresh(p, now);
    this.tell(p, now);
    if (got) this.outbox.push({ to: id, msg: { t: 'got', items: [got], from: 'identify' } });
    this.sendBag(p, now);
    // Something that takes energy could empty the bar.
    if (p.rec.energy <= 0) this.collapse(p, now);
  }

  /** Throws away everything in bag slot `slot`. */
  discard(id: string, slot: number, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    if (this.advance(p, now) <= 0) {
      // Too late: the player collapses, and the bag falls out.
      this.collapse(p, now);
      return this.refuse(p, 'discard', 'empty_slot');
    }
    const thrown = p.rec.bag[slot];
    if (!thrown) return this.refuse(p, 'discard', 'empty_slot');
    p.rec.stash = usedUp(p.rec.stash ?? emptyStash(), thrown.item, thrown.count);
    p.rec.bag = takeFromBag(p.rec.bag, slot);
    this.sendBag(p, now);
    this.rerate(p, now);
  }

  /**
   * Feeds one of what is in bag slot `slot` to the fire on tile x,y (next to the player, diagonals
   * too: a fire warms the tiles around it) or to the Old Stone. Everyone on the map sees the fire
   * burn higher; everyone online hears about the Stone.
   */
  feed(id: string, x: number, y: number, slot: number, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    if (this.advance(p, now) <= 0) {
      this.collapse(p, now);
      return this.refuse(p, 'feed', 'too_far');
    }
    if (Math.max(Math.abs(x - p.rec.x), Math.abs(y - p.rec.y)) > 1) return this.refuse(p, 'feed', 'too_far');
    const s = p.rec.bag[slot];
    if (!s) return this.refuse(p, 'feed', 'empty_slot');
    const def = this.items.get(s.item);
    const stone = this.stone;
    if (stone && stone.map === p.map && stone.x === x && stone.y === y) {
      if (!def?.charge) return this.refuse(p, 'feed', 'not_fuel');
      p.rec.bag = takeFromBag(p.rec.bag, slot, 1);
      p.rec.stash = usedUp(p.rec.stash ?? emptyStash(), def.id, 1);
      this.chargeStone(def.charge, now);
      this.sendBag(p, now);
      this.saveNow.set(id, p.rec);
      this.moveStory(p, { feed: 'stone' });
      return this.rerate(p, now);
    }
    const fire = this.fires.at(p.map, x, y);
    if (!fire) return this.refuse(p, 'feed', 'gone');
    if (fire.tended) return this.refuse(p, 'feed', 'tended');
    if (!def?.fuel) return this.refuse(p, 'feed', 'not_fuel');
    if (!this.fires.feed(fire, def.fuel, now)) return this.refuse(p, 'feed', 'fire_full');
    p.rec.bag = takeFromBag(p.rec.bag, slot, 1);
    p.rec.stash = usedUp(p.rec.stash ?? emptyStash(), def.id, 1);
    this.sendBag(p, now);
    this.toMap(p.map.data.id, { t: 'fire', fire: this.fires.view(fire, now) });
    this.count(p, 'fed', now);
    // The story waits for a fire out in the wilds ("Whoever comes next"), never one in town.
    if (this.wild(p.map)) this.moveStory(p, { feed: 'fire' });
    // A dead fire lit again warms whoever stands by it.
    for (const q of this.onMap.get(p.map.data.id)!) this.rerate(q, now);
  }

  /** Opens the chest on tile x,y (next to the player): they hear what is in their stash. */
  chest(id: string, x: number, y: number): void {
    const p = this.players.get(id);
    if (!p || !this.chestNextTo(p, x, y)) return;
    this.sendStash(p);
  }

  /**
   * Puts bag slot `slot` (or, left out, everything in the bag) into the player's stash, in the chest on
   * tile x,y next to them. What goes in earns XP, except what they took out before and bring back;
   * a new level raises their energy bar at once.
   */
  store(id: string, x: number, y: number, slot: number | undefined, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    this.advance(p, now);
    if (!this.chestNextTo(p, x, y)) return this.refuse(p, 'store', 'too_far');
    const going = slot === undefined ? p.rec.bag : p.rec.bag[slot] ? [p.rec.bag[slot]!] : [];
    if (!going.length) return this.refuse(p, 'store', 'empty_slot');
    // Live finds apart: merge would forget when each was picked, and each is worth what its age says.
    const wall = now + this.epochOffset;
    const r = store(p.rec.stash ?? emptyStash(), merge(going.filter(s => !this.items.get(s.item)?.live)), this.items);
    for (const s of going) {
      const l = this.liveNow(s, wall);
      if (!l?.into) continue;
      const lr = storeLive(r.stash, l.into.id, liveXp(l.def, l.age, l.into));
      r.stash = lr.stash;
      r.xp += lr.xp;
    }
    // Gear brought home (an identified strange object) gets its piece, and its quirk if anomalous.
    p.rec.stash = fitPieces(r.stash, this.items, this.rng);
    p.rec.bag = slot === undefined ? [] : takeFromBag(p.rec.bag, slot);
    const before = levelOf(p.rec.xp ?? 0);
    p.rec.xp = (p.rec.xp ?? 0) + r.xp;
    this.saveNow.set(id, p.rec);
    this.sendBag(p, now);
    this.sendStash(p);
    this.outbox.push({ to: id, msg: { t: 'progress', progress: progressOf(p.rec.xp), gained: r.xp } });
    // A bigger bar: the player hears it (and at home, by the fire, it fills up).
    if (levelOf(p.rec.xp) !== before) this.refresh(p, now);
    this.tell(p, now);
    this.moveStory(p, { store: true });
  }

  /**
   * Puts on a piece of gear from the player's stash, at the chest on tile x,y next to them: what they
   * wore in its slot goes into the stash. A smaller bag has to hold what they carry. Everyone on the
   * map sees the change; the player hears their new bar (gear can add energy) and rates.
   */
  equip(id: string, x: number, y: number, item: string, now: number, n = 0): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    this.advance(p, now);
    if (!this.chestNextTo(p, x, y)) return this.refuse(p, 'equip', 'too_far');
    const def = this.items.get(item), stash = p.rec.stash ?? emptyStash();
    if (!def || !(stash.items[item] ?? 0)) return this.refuse(p, 'equip', 'not_stashed');
    if (def.kind !== 'gear' || !def.slot) return this.refuse(p, 'equip', 'not_gear');
    if (def.slot === 'bag' && p.rec.bag.length > (def.bag ?? 0)) return this.refuse(p, 'equip', 'bag_too_full');
    const gear = { ...p.rec.gear }, old = gear[def.slot], worn = { ...p.rec.worn };
    const pieces = { ...stash.pieces, [item]: [...(stash.pieces?.[item] ?? [])] };
    const [piece] = pieces[item]!.splice(Math.min(n, Math.max(0, pieces[item]!.length - 1)), 1);
    if (old) pieces[old] = [...(pieces[old] ?? []), worn[def.slot] ?? { cond: 1 }];
    gear[def.slot] = item;
    worn[def.slot] = piece ?? newPiece(def, this.rng);
    p.rec.stash = fitPieces({ ...moveStash(stash, item, -1, old), pieces }, this.items, this.rng);
    this.wearGear(p, gear, worn, now);
  }

  /** Takes off what the player wears in `slot`, at the chest on tile x,y next to them: it goes into the stash. Not the bag. */
  unequip(id: string, x: number, y: number, slot: Slot, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    this.advance(p, now);
    if (!this.chestNextTo(p, x, y)) return this.refuse(p, 'unequip', 'too_far');
    if (slot === 'bag') return this.refuse(p, 'unequip', 'keep_bag');
    const gear = { ...p.rec.gear }, old = gear[slot], worn = { ...p.rec.worn }, stash = p.rec.stash ?? emptyStash();
    if (!old) return this.refuse(p, 'unequip', 'empty_slot');
    const pieces = { ...stash.pieces, [old]: [...(stash.pieces?.[old] ?? []), worn[slot] ?? { cond: 1 }] };
    delete gear[slot];
    delete worn[slot];
    p.rec.stash = fitPieces({ ...moveStash(stash, undefined, 0, old), pieces }, this.items, this.rng);
    this.wearGear(p, gear, worn, now);
  }

  /** Opens the workbench on tile x,y (next to the player): they hear what their stash holds. */
  bench(id: string, x: number, y: number): void {
    const p = this.players.get(id);
    if (!p || !this.benchNextTo(p, x, y)) return;
    this.outbox.push({ to: id, msg: { t: 'bench', stash: stashList(p.rec.stash ?? emptyStash(), this.itemOrder) } });
  }

  /** Makes recipe `recipeId` at the workbench on tile x,y next to the player, from their stash, into their stash. */
  craft(id: string, x: number, y: number, recipeId: string, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    if (!this.benchNextTo(p, x, y)) return this.refuse(p, 'craft', 'too_far');
    const recipe = this.recipes.get(recipeId);
    if (!recipe) return this.refuse(p, 'craft', 'gone');
    const stash = p.rec.stash ?? emptyStash();
    if (!canMake(recipe, stash.items)) return this.refuse(p, 'craft', 'missing');
    const items = { ...stash.items }, count = recipe.count ?? 1;
    for (const n of recipe.needs) {
      items[n.item] = items[n.item]! - n.count;
      if (!items[n.item]) delete items[n.item];
    }
    items[recipe.make] = (items[recipe.make] ?? 0) + count;
    // Gear made comes new, piece by piece.
    p.rec.stash = fitPieces({ items, out: { ...stash.out }, pieces: stash.pieces }, this.items, this.rng);
    this.saveNow.set(id, p.rec);
    this.outbox.push({ to: id, msg: { t: 'crafted', item: recipe.make, count } });
    this.outbox.push({ to: id, msg: { t: 'bench', stash: stashList(p.rec.stash, this.itemOrder) } });
  }

  /** Mends the piece the player wears in `slot`, at the workbench on tile x,y next to them, paying from their stash: it is whole again. */
  mend(id: string, x: number, y: number, slot: Slot, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    this.advance(p, now);
    if (!this.benchNextTo(p, x, y)) return this.refuse(p, 'mend', 'too_far');
    const item = p.rec.gear?.[slot], piece = p.rec.worn?.[slot], cost = mendCost(item ? this.items.get(item) : undefined, this.mendCosts);
    if (!item || !cost || !piece || piece.cond >= 1) return this.refuse(p, 'mend', 'whole');
    const stash = p.rec.stash ?? emptyStash();
    if (!canMake({ id: 'mend', make: item, needs: cost }, stash.items)) return this.refuse(p, 'mend', 'missing');
    const items = { ...stash.items };
    for (const n of cost) {
      items[n.item] = items[n.item]! - n.count;
      if (!items[n.item]) delete items[n.item];
    }
    p.rec.stash = fitPieces({ items, out: { ...stash.out }, pieces: stash.pieces }, this.items, this.rng);
    p.rec.worn = { ...p.rec.worn, [slot]: { ...piece, cond: 1 } };
    this.saveNow.set(id, p.rec);
    this.outbox.push({ to: id, msg: { t: 'mended', item } });
    // Its condition (in the body) before the bench, so the bench's mend row is gone when it redraws.
    this.refresh(p, now);
    this.tell(p, now);
    this.outbox.push({ to: id, msg: { t: 'bench', stash: stashList(p.rec.stash, this.itemOrder) } });
  }

  /** Takes up to `count` of an item out of the player's stash, in the chest on tile x,y, as much as fits in the bag. */
  take(id: string, x: number, y: number, item: string, count: number, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    if (!this.chestNextTo(p, x, y)) return this.refuse(p, 'take', 'too_far');
    const stash = p.rec.stash ?? emptyStash(), have = stash.items[item] ?? 0, def = this.items.get(item);
    if (!def || !have) return this.refuse(p, 'take', 'not_stashed');
    // A piece in the bag would forget how worn it is: gear is put on from the chest instead.
    if (def.kind === 'gear') return this.refuse(p, 'take', 'gear_stays');
    const want = Math.min(have, count);
    const r = addToBag(p.rec.bag, def, want, p.slots);
    const taken = want - r.left;
    if (!taken) return this.refuse(p, 'take', 'bag_full');
    p.rec.bag = r.bag;
    p.rec.stash = takeOut(stash, item, taken).stash;
    this.saveNow.set(id, p.rec);
    this.sendBag(p, now);
    this.sendStash(p);
    this.rerate(p, now);
  }

  /**
   * The player talked to the person, or read the desk, on tile x,y next to them (the client talks and
   * reads by itself; this only tells the story): their story may move on. The client sends it the moment
   * its own last step is over, so on a slow network the steps before it can arrive bunched up and still
   * wait in the queue: then it is heard once they are walked, or the player would hear what comes next
   * while the story stays where it was.
   */
  talk(id: string, x: number, y: number, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    if (p.queue.length) p.after = { t: 'talk', x, y };
    else this.heard(p, x, y);
  }

  /** Whom the player talked to, or what they read, on tile x,y: only from next to it. */
  private heard(p: Online, x: number, y: number): void {
    if (manhattan(x, y, p.rec.x, p.rec.y) > 1) return;
    const o = p.map.data.objects.find(o => o.x === x && o.y === y && (o.kind === 'npc' || o.kind === 'console'));
    if (o?.kind === 'npc') this.moveStory(p, { talk: o.id });
    else if (o?.kind === 'console') this.moveStory(p, { read: o.id });
  }

  /**
   * Reads the notice board on tile x,y (next to the player): how things stand out there, in plain words.
   * Like a talk, it can come in while the steps sent before it still wait in the queue: then it is read
   * once they are walked, or the player would press A and see nothing.
   */
  board(id: string, x: number, y: number, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    if (p.queue.length) p.after = { t: 'board', x, y };
    else this.readBoard(p, x, y, now);
  }

  private readBoard(p: Online, x: number, y: number, now: number): void {
    const here = p.map.data.objects.some(o => o.kind === 'board' && o.x === x && o.y === y);
    if (!here || manhattan(x, y, p.rec.x, p.rec.y) > 1) return;
    this.outbox.push({ to: p.rec.id, msg: { t: 'board', lines: this.news(now) } });
  }

  /**
   * Brings everyone's energy up to `now` (whoever ran out collapses), starts queued steps whose time
   * has come and repeats the energy of players whose bar is moving; the sky, the surges and the Old
   * Stone move on, watchers walk, piles and marks whose time is over fade and finds whose time has
   * come grow. Call it often (every TICK_MS).
   */
  tick(now: number): void {
    const wall = now + this.epochOffset;
    if (this.cycle) this.setWeather(weatherAt(wall).weather, now);
    this.moveSurges(now);
    this.moveStorms(now);
    this.moveConditions(now);
    this.startFlashes(now);
    const wasAwake = this.stoneAwake;
    this.burnStone(now);
    if (wasAwake && !this.stoneAwake) this.outbox.push({ to: 'all', msg: { t: 'stone', stone: this.stoneView(now) } });
    for (const p of this.players.values()) {
      if (this.advance(p, now) <= 0) {
        this.collapse(p, now);
        continue;
      }
      if (p.queue.length) this.runQueue(p, now);
      if (p.live) this.fadeLive(p, now);
      this.hitch(p, now);
      this.rerate(p, now);
      // The client counts on with the rates it heard; repeating the values keeps it from drifting.
      if (now - p.heardAt >= ENERGY_SYNC_MS && changing(p)) this.tell(p, now);
    }
    this.walkWatchers(now);
    this.walkSkulkers(now);
    if (this.flares.length) this.flares = this.flares.filter(f => f.until > now);
    if (this.flashes.length) this.flashes = this.flashes.filter(f => f.until > now);
    for (const [id, readyAt] of this.resting) if (readyAt <= now) this.resting.delete(id);
    this.fadePiles(now);
    this.fadeMarks(now);
    this.growFinds(now);
  }

  /** Changes the weather everywhere. Energy rates follow: bad weather drains faster, and rain soaks. */
  setWeather(weather: Weather, now: number): void {
    if (weather === this.sky) return;
    const aurora = weather === 'aurora' || this.sky === 'aurora';
    this.sky = weather;
    for (const [map, here] of this.onMap) if (here.size) this.outbox.push({ to: '*', map, msg: { t: 'weather', weather } });
    if (aurora) for (const rule of this.rules) if (rule.when === 'aurora') this.openRule(rule, weather === 'aurora', now);
    for (const p of this.players.values()) {
      // Up to now at the rate of the old weather, which the player still has.
      if (this.advance(p, now) <= 0) this.collapse(p, now);
      else this.rerate(p, now);
    }
  }

  /** Everything queued since the last drain, in order. */
  drain(): Outgoing[] {
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  /** What storage must hear since the last call: each pile and mark as it is now (or gone), players to save now, the Old Stone. */
  takeWrites(): Writes {
    const out: Writes = {
      drops: [...this.pileWrites].map(([owner, d]) => ({ owner, drop: d && { ...d, items: copyBag(d.items), trail: [...(d.trail ?? [])] } })),
      players: [...this.saveNow.values()].map(copyRecord),
      marks: [...this.markWrites].map(([id, m]) => ({ id, mark: m && { ...m } })),
      ...(this.stoneWrite ? { stone: { ...this.stoneWrite } } : {}),
    };
    this.pileWrites.clear();
    this.saveNow.clear();
    this.markWrites.clear();
    this.stoneWrite = undefined;
    return out;
  }

  private ready(p: Online, now: number): boolean {
    return now >= p.readyAt - STEP_TOLERANCE_MS;
  }

  private runQueue(p: Online, now: number): void {
    while (p.queue.length && this.ready(p, now)) {
      const s = p.queue.shift()!;
      this.move(p, s.dir, s.seq, now);
    }
    // Walked (or refused, which empties the queue too): the talk or look behind the steps is done from where they left the player.
    if (p.after && !p.queue.length) {
      const { t, x, y } = p.after;
      p.after = undefined;
      if (t === 'talk') this.heard(p, x, y);
      else this.readBoard(p, x, y, now);
    }
  }

  private move(p: Online, dir: Dir, seq: number, now: number): void {
    // Energy that ran out before this step could start: the player collapses instead of walking.
    if (this.advance(p, now) <= 0) return this.collapse(p, now);
    const { x, y } = stepTarget(p.rec.x, p.rec.y, dir);
    if (!p.map.walkable(x, y)) {
      // Steps queued behind this one were planned from a tile the player never reached.
      p.queue.length = 0;
      return this.reject(p, seq);
    }
    const { id } = p.rec;
    p.rec.x = x;
    p.rec.y = y;
    p.rec.dir = dir;
    p.readyAt = Math.max(now, p.readyAt) + this.stepMs;
    this.outbox.push({ to: id, msg: { t: 'step', id, x, y, dir, seq } });
    this.toMap(p.map.data.id, { t: 'step', id, x, y, dir }, id);
    if (p.map.data.kind === 'wilds') {
      p.trail.push([x, y]);
      if (p.trail.length > TRAIL_STEPS) p.trail.shift();
      if (this.sky === 'rain') this.count(p, 'rainSteps', now);
      if (this.sky === 'night' || this.sky === 'aurora') this.count(p, 'nightSteps', now);
      if (p.load >= HEAVY_LOAD) this.count(p, 'heavySteps', now);
    }
    const exit = p.map.exitAt(x, y);
    if (exit) this.cross(p, exit, now);
    else this.rerate(p, now);
  }

  /** Refuses step `seq`, telling the mover where they really are. */
  private reject(p: Online, seq: number): void {
    const { id, x, y, dir } = p.rec;
    this.outbox.push({ to: id, msg: { t: 'reject', seq, x, y, dir } });
  }

  /**
   * The player stepped onto an exit and goes on to the other map at once. readyAt stays as it is,
   * so changing maps never lets anyone walk faster.
   */
  private cross(p: Online, to: Arrival, now: number): void {
    const from = p.map;
    this.place(p, this.maps.get(to.to)!, to.x, to.y, to.dir);
    this.arrive(p, from, 'exit', now);
    this.moveStory(p, { reach: p.map.data.id });
  }

  /** Out of energy while online: the player wakes up at home, and both maps see it. */
  private collapse(p: Online, now: number): void {
    const from = p.map;
    this.fall(p, now);
    this.arrive(p, from, 'collapse', now);
  }

  /** Out of energy: what the player carries falls out where they are, and they go home to the spawn with a full bar, dry and alone. */
  private fall(p: Online, now: number): void {
    const { id, map, x, y } = p.rec;
    this.dropBag(p, now);
    const { spawn } = this.home.data;
    this.place(p, this.home, spawn.x, spawn.y, spawn.dir);
    p.rec.energy = this.maxOf(p.rec);
    p.rec.wet = 0;
    p.hitched = false;
    this.collapses = this.collapses.filter(c => now - c.at < COLLAPSES_MS);
    this.collapses.push({ map, at: now });
    this.onCollapse?.(id, { map, x, y });
  }

  /**
   * The player's bag (or only its slot `slot`, when a skulker catches them) becomes their pile on the
   * tile where they stand, and their old pile is gone: each player has at most one. With nothing in
   * the bag, only the old pile goes. Only a collapse leaves an echo.
   */
  private dropBag(p: Online, now: number, slot?: number): void {
    const { id, name, map, x, y, bag } = p.rec;
    const old = this.piles.get(id);
    if (old) this.removePile(old);
    if (!bag.length) return;
    const trail = p.map.data.kind === 'wilds' && slot === undefined ? p.trail.map(([tx, ty]) => [tx, ty] as [number, number]) : [];
    const falls = slot === undefined ? bag : [bag[slot]!];
    // Put down, a live find goes dim for good.
    const items = merge(falls.map(s => ({ item: this.items.get(s.item)?.live?.into ?? s.item, count: s.count })));
    const pile: DropRecord = { owner: id, name, map, x, y, items, droppedAt: Math.floor(now + this.epochOffset), trail };
    this.addPile(pile);
    this.pileWrites.set(id, pile);
    this.toMap(map, { t: 'drop', drop: dropView(pile) });
    p.rec.bag = slot === undefined ? [] : bag.filter((_, i) => i !== slot);
    this.sendBag(p, now);
    this.saveNow.set(id, p.rec);
  }

  /**
   * Puts a player on a tile of a map. Queued steps go: they were planned on the old map, and so do the
   * talk or look waiting behind them (it was about something there) and the trail.
   */
  private place(p: Online, map: TileMap, x: number, y: number, dir: Dir): void {
    this.onMap.get(p.map.data.id)!.delete(p);
    this.onMap.get(map.data.id)!.add(p);
    p.map = map;
    p.rec.map = map.data.id;
    p.rec.x = x;
    p.rec.y = y;
    p.rec.dir = dir;
    p.queue.length = 0;
    p.after = undefined;
    p.trail = [];
  }

  /**
   * Tells everyone about a map change that just happened: the old map sees the player leave, the
   * new one sees them join, and the player hears where they are, who and what is there, and their energy.
   */
  private arrive(p: Online, from: TileMap, reason: 'exit' | 'collapse', now: number): void {
    const { id, x, y, dir } = p.rec;
    const here = p.map.data.id;
    this.toMap(from.data.id, { t: 'leave', id }, id);
    this.toMap(here, { t: 'join', player: view(p.rec, p.live > 0) }, id);
    this.outbox.push({
      to: id,
      msg: { t: 'zone', map: mapRef(p.map), x, y, dir, players: this.views(here), ...this.scene(here, now), stats: { ...p.rec.stats }, reason },
    });
    // A roof or town shakes off whatever clung to you.
    if (p.hitched && p.map.data.kind !== 'wilds') this.unhitch(p);
    this.refresh(p, now);
    this.tell(p, now);
  }

  /** The rates and load for where the player stands now, and their mods. Nobody is told. */
  private refresh(p: Online, now: number): void {
    const { x, y } = p.rec;
    p.mods = modsOf(p.rec.stats ?? {}, charmsIn(p.rec.bag, this.items));
    p.load = bagLoad(p.rec.bag, this.items, p.mods.load);
    p.max = this.maxOf(p.rec);
    p.slots = bagSlotsOf(p.rec.gear ?? {}, this.items);
    const resist = resistOf(p.rec.gear ?? {}, this.items, p.rec.worn);
    const warmth = p.map.warm(x, y) ? this.fires.warmth(p.map, x, y, now) : 0;
    const storm = this.stormOf(p.map, now)?.phase === 'storm';
    p.rate = energyRate(p.map, x, y, this.sky, {
      warmth: warmth * p.mods.warmth,
      wet: p.rec.wet,
      load: p.load,
      surgeFront: this.frontOf(p.map, now),
      // An awake Old Stone takes half the edge off every surge.
      surgeDrain: this.stoneAwake ? 1 + (SURGE_DRAIN - 1) / 2 : SURGE_DRAIN,
      hitched: p.hitched,
      storm,
      flash: this.flashes.find(f => f.map === p.map.data.id && flashHits(flashView(f, now), x, y))?.kind,
      resist,
    });
    // Wind resistance (a raincoat) keeps the rain out.
    p.wetRate = wetRate(p.map.data.kind, this.sky, warmth > 0, p.mods.wetting * (1 - resist.wind), storm);
  }

  /**
   * New rates for where the player stands now. They hear them when energy turns between draining,
   * holding and refilling or moves far from the rate they last heard, when they start drying or
   * getting wet, or when their load changes; small changes wait for tick().
   */
  private rerate(p: Online, now: number): void {
    this.refresh(p, now);
    const turned = Math.sign(p.rate) !== Math.sign(p.heardRate);
    const moved = Math.abs(p.rate - p.heardRate) > ENERGY_RATE_CHANGE * Math.abs(p.heardRate);
    const wet = Math.sign(p.wetRate) !== Math.sign(p.heardWetRate);
    if (turned || moved || wet || p.load !== p.heardLoad) this.tell(p, now);
  }

  /** Brings the player's energy and wetness up to `now` at their current rates, and returns the energy. */
  private advance(p: Online, now: number): number {
    if (now > p.energyAt) {
      const dt = (now - p.energyAt) / 1000;
      p.rec.energy = Math.min(p.max, Math.max(0, p.rec.energy + p.rate * dt));
      p.rec.wet = clamp01((p.rec.wet ?? 0) + p.wetRate * dt);
      if (p.map.data.kind === 'wilds') this.wearDown(p, dt);
      p.energyAt = now;
    }
    return p.rec.energy;
  }

  /** Out in the wilds, what the player wears wears down: `dt` seconds of it. The rates follow on the next refresh. */
  private wearDown(p: Online, dt: number): void {
    const worn = p.rec.worn;
    if (!worn) return;
    for (const slot of SLOTS) {
      const piece = worn[slot], s = wearSeconds(p.rec.gear?.[slot] ? this.items.get(p.rec.gear[slot]!) : undefined, this.wear);
      if (piece && s && piece.cond > 0) piece.cond = Math.max(0, piece.cond - dt / s);
    }
  }

  /** Sends the player their energy and body; call advance() first so the values are current. */
  private tell(p: Online, now: number): void {
    p.heardRate = p.rate;
    p.heardWetRate = p.wetRate;
    p.heardLoad = p.load;
    p.heardAt = now;
    this.outbox.push({ to: p.rec.id, msg: { t: 'energy', energy: energyView(p), body: bodyView(p) } });
  }

  /**
   * Something the player did that the story may wait for: the next chapter, if this is what reaches
   * it (story.ts). A chapter reached is theirs for good: they hear it, and it is saved at once.
   */
  private moveStory(p: Online, event: StoryEvent): void {
    const next = reachedBy(this.story, p.rec.story, event);
    if (!next) return;
    p.rec.story = next.id;
    this.saveNow.set(p.rec.id, p.rec);
    this.outbox.push({ to: p.rec.id, msg: { t: 'chapter', id: next.id } });
  }

  /** One more of what counts toward a feat; a feat reached is the player's for good, and they hear it. */
  private count(p: Online, stat: (typeof STATS)[number], now: number): void {
    const stats = (p.rec.stats ??= {});
    const had = featsOf(stats).length;
    stats[stat] = (stats[stat] ?? 0) + 1;
    const earned = featsOf(stats);
    if (earned.length === had) return;
    const feat = FEATS.find(f => f.stat === stat && (stats[stat] ?? 0) === f.need);
    if (feat) this.outbox.push({ to: p.rec.id, msg: { t: 'feat', id: feat.id, stats: { ...stats } } });
    this.saveNow.set(p.rec.id, p.rec);
    // The feat changes the rates right away, however little: the player hears them.
    this.refresh(p, now);
    this.tell(p, now);
  }

  // ---------- the sky, surges and the Old Stone ----------

  /** A region's surge clock now, or null for a map that never surges. */
  private surgeOf(map: TileMap, now: number): SurgeView | null {
    const rule = map.data.kind === 'wilds' ? map.data.surge : undefined;
    if (!rule) return null;
    const s = surgeAt(rule, now + this.epochOffset);
    return { phase: s.phase, left: round(s.left, 1), into: round(s.into, 1) };
  }

  /** Where a surge's front is on this map now (steps from home), or undefined when none is on. */
  private frontOf(map: TileMap, now: number): number | undefined {
    const rule = map.data.kind === 'wilds' ? map.data.surge : undefined;
    return rule && surgeFront(rule, map.deepest, surgeAt(rule, now + this.epochOffset));
  }

  /** Tells each surging map when its phase changes, and grows (or clears away) the finds of restless times. */
  private moveSurges(now: number): void {
    for (const map of this.maps.values()) {
      const s = this.surgeOf(map, now);
      if (!s || this.surgePhase.get(map.data.id) === s.phase) continue;
      const first = !this.surgePhase.has(map.data.id);
      this.surgePhase.set(map.data.id, s.phase);
      if (!first) this.toMap(map.data.id, { t: 'surge', surge: s });
      for (const rule of this.rules) if (rule.when === 'unstable' && rule.map === map) this.openRule(rule, s.phase !== 'calm', now);
    }
    // The first tick also opens aurora finds if the world starts on an aurora night.
    for (const rule of this.rules) if (rule.when === 'aurora' && rule.open !== (this.sky === 'aurora')) this.openRule(rule, this.sky === 'aurora', now);
  }

  /** A region's storm clock now (for an inside, the region around it), or null for a map that never storms. */
  private stormOf(map: TileMap, now: number): StormView | null {
    const out = map.data.kind === 'inside' ? this.around.get(map.data.id) : map;
    const rule = out?.data.kind === 'wilds' ? out.data.storm : undefined;
    if (!rule) return null;
    const s = stormAt(rule, now + this.epochOffset);
    return { phase: s.phase, left: round(s.left, 1) };
  }

  /** Tells each storming map when its phase changes, and grows (or clears away) the finds a storm leaves. */
  private moveStorms(now: number): void {
    for (const map of this.maps.values()) {
      const s = this.stormOf(map, now);
      if (!s || this.stormPhase.get(map.data.id) === s.phase) continue;
      const first = !this.stormPhase.has(map.data.id);
      this.stormPhase.set(map.data.id, s.phase);
      if (!first) this.toMap(map.data.id, { t: 'storm', storm: s });
      for (const rule of this.rules) if (rule.when === 'storm' && rule.map === map) this.openRule(rule, s.phase === 'storm', now);
    }
  }

  /** Today's and this week's conditions, as drawn at the last dawn (or for now, before the first tick). */
  private conditionsNow(now: number): ConditionsView {
    const c = this.day === undefined ? conditionsAt(this.conditionsData, now + this.epochOffset) : this.conditions;
    return { today: [...c.today], week: c.week, next: c.next };
  }

  /**
   * At dawn, and when the week turns, the conditions change: everyone online hears them, their finds
   * grow (or go), the watchers move or sleep, and a fire may go out overnight. The first tick after
   * start-up sets it all up, the day's fire out included: fires are not kept across a restart, so
   * without it that fire would burn again while the notice board and Mira say it went out.
   */
  private moveConditions(now: number): void {
    const data = this.conditionsData;
    if (!data) return;
    const wall = now + this.epochOffset, day = dayIndex(wall), week = weekIndex(wall);
    if (day === this.day && week === this.week) return;
    const first = this.day === undefined, newDay = day !== this.day;
    this.day = day;
    this.week = week;
    this.conditions = conditionsAt(data, wall);
    if (!first) this.outbox.push({ to: 'all', msg: { t: 'conditions', conditions: this.conditionsNow(now) } });
    const on = activeConditions(data, this.conditions);
    const ids = new Set(on.map(c => c.id));
    const daily = new Set(data.daily.map(c => c.id));
    for (const rule of this.rules) {
      if (rule.condition === undefined) continue;
      // Each day is drawn afresh: a daily condition on two days running brings a fresh lot.
      if (newDay && daily.has(rule.condition)) this.openRule(rule, false, now);
      this.openRule(rule, ids.has(rule.condition), now);
    }
    for (const [mapId, list] of this.watchers) {
      const here = on.filter(c => c.map === mapId && c.watchers);
      const asleep = here.some(c => c.watchers!.asleep);
      const moved = here.find(c => this.conditionLairs.has(c.id));
      const lairs = moved ? this.conditionLairs.get(moved.id)! : this.baseLairs.get(mapId)!;
      if (asleep) this.asleep.add(mapId);
      else this.asleep.delete(mapId);
      const allowed = new Set(lairs);
      for (const w of list) {
        w.lairs = lairs;
        if (w.awake && (asleep || !allowed.has(w.y * w.map.width + w.x))) this.sendAway(w, now);
      }
    }
    if (newDay) for (const c of on) if (c.fireOut && daily.has(c.id)) this.fireOut(c.map, day, now);
  }

  /** One untended fire on the map (or in its shelters) goes out, the same one for everyone that day. */
  private fireOut(mapId: string, day: number, now: number): void {
    const fires = this.fires.all()
      .filter(f => !f.tended && (f.map.data.id === mapId || this.around.get(f.map.data.id)?.data.id === mapId))
      .sort((a, b) => a.map.data.id.localeCompare(b.map.data.id) || a.x - b.x || a.y - b.y);
    const f = fires[Math.floor(seeded(day)() * fires.length)];
    if (!f) return;
    this.fires.douse(f, now);
    this.toMap(f.map.data.id, { t: 'fire', fire: this.fires.view(f, now) });
  }

  /**
   * Every so often on each map with flashes, a patch of ground starts to glow near someone out in the
   * open at the rule's distance from home, often right under them: they have FLASH_GLOW_S to step out.
   */
  private startFlashes(now: number): void {
    for (const map of this.maps.values()) {
      const rule = map.data.kind === 'wilds' ? map.data.flashes : undefined;
      if (!rule) continue;
      const id = map.data.id, at = this.nextFlash.get(id);
      if (at === undefined || now < at) {
        if (at === undefined) this.nextFlash.set(id, now + rule.every * 1000);
        continue;
      }
      this.nextFlash.set(id, now + rule.every * 1000);
      const out = [...this.onMap.get(id)!].filter(p => {
        const steps = p.map.homeSteps(p.rec.x, p.rec.y);
        return steps >= rule.steps[0] && steps <= rule.steps[1] && this.exposed(p, now);
      });
      const who = out[Math.floor(this.rng() * out.length)];
      if (!who) continue;
      const near: Array<[number, number]> = [];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = who.rec.x + dx, y = who.rec.y + dy;
        if (map.walkable(x, y) && !map.lit(x, y) && !map.warm(x, y) && map.homeSteps(x, y) >= 0) near.push([x, y]);
      }
      const [x, y] = near[Math.floor(this.rng() * near.length)] ?? [who.rec.x, who.rec.y];
      const flash: Flash = { map: id, x, y, kind: this.rng() < 0.5 ? 'spark' : 'fire', until: now + (FLASH_GLOW_S + FLASH_BURST_S) * 1000 };
      this.flashes.push(flash);
      this.toMap(id, { t: 'flash', flash: flashView(flash, now) });
    }
  }

  /** Awake, the Old Stone burns one shard every STONE_SHARD_S; at none left it sleeps. */
  private burnStone(now: number): void {
    if (!this.stoneAwake) {
      this.stoneAt = now;
      return;
    }
    if (now <= this.stoneAt) return;
    this.stoneCharge = Math.max(0, this.stoneCharge - (now - this.stoneAt) / 1000 / STONE_SHARD_S);
    this.stoneAt = now;
    // Burning away in many small bites leaves crumbs a float cannot count to zero: a few ms' worth is nothing.
    if (this.stoneCharge <= 1e-6) {
      this.stoneCharge = 0;
      this.stoneAwake = false;
      this.stoneWrite = { charge: 0, awake: false, at: now + this.epochOffset };
      for (const p of this.players.values()) this.rerate(p, now);
    }
  }

  private chargeStone(charge: number, now: number): void {
    this.burnStone(now);
    this.stoneCharge += charge;
    const woke = !this.stoneAwake && this.stoneCharge >= STONE_NEED;
    if (woke) this.stoneAwake = true;
    this.stoneWrite = { charge: this.stoneCharge, awake: this.stoneAwake, at: now + this.epochOffset };
    this.outbox.push({ to: 'all', msg: { t: 'stone', stone: this.stoneView(now) } });
    if (woke) for (const p of this.players.values()) this.rerate(p, now);
  }

  // ---------- hitchhikers, flares, marks ----------

  /** In the dark, deep in and away from light, something may cling to you; light, a fire or a roof shakes it off. */
  private hitch(p: Online, now: number): void {
    const dt = Math.max(0, now - p.hitchAt) / 1000;
    p.hitchAt = now;
    const { x, y } = p.rec;
    const safe = p.map.data.kind !== 'wilds' || p.map.lit(x, y) || (p.map.warm(x, y) && this.fires.warmth(p.map, x, y, now) > 0);
    if (p.hitched) {
      if (safe || this.nearFlare(p.map.data.id, x, y, now)) this.unhitch(p);
      return;
    }
    const dark = this.sky === 'night' || this.sky === 'aurora';
    if (safe || !dark || p.map.homeSteps(x, y) < HITCH_STEPS || this.nearFlare(p.map.data.id, x, y, now)) return;
    if (this.rng() < 1 - Math.exp((-dt / HITCH_EVERY_S) * p.mods.hitch)) {
      p.hitched = true;
      this.outbox.push({ to: p.rec.id, msg: { t: 'hitch', on: true } });
    }
  }

  private unhitch(p: Online): void {
    p.hitched = false;
    this.outbox.push({ to: p.rec.id, msg: { t: 'hitch', on: false } });
  }

  private nearFlare(map: string, x: number, y: number, now: number): boolean {
    return this.flares.some(f => f.map === map && f.until > now && Math.hypot(f.x - x, f.y - y) <= FLARE_RADIUS);
  }

  /** A flare where the player stands: whatever clings to them lets go, and watchers nearby slink off. */
  private light(p: Online, seconds: number, now: number): void {
    const { x, y } = p.rec, map = p.map.data.id;
    this.flares.push({ map, x, y, until: now + seconds * 1000 });
    this.toMap(map, { t: 'flare', flare: { x, y, left: seconds } });
    if (p.hitched) this.unhitch(p);
    for (const w of [...(this.watchers.get(map) ?? []), ...(this.skulkers.get(map) ?? [])]) if (w.awake && Math.hypot(w.x - x, w.y - y) <= FLARE_RADIUS + 3) this.sendAway(w, now);
  }

  /** An arrow on the player's tile, pointing where they face. Their oldest goes when they have too many. */
  private paint(p: Online, now: number): void {
    const { id, name, color, map, x, y, dir } = p.rec;
    const mine = [...this.marks.values()].filter(m => m.owner === id).sort((a, b) => a.placedAt - b.placedAt);
    for (const m of mine.slice(0, Math.max(0, mine.length - MARKS_PER_PLAYER + 1))) this.removeMark(m);
    const mark: MarkRecord = { id: this.nextMarkId++, owner: id, name, color, map, x, y, dir, placedAt: Math.floor(now + this.epochOffset) };
    this.addMark(mark);
    this.markWrites.set(mark.id, mark);
    this.toMap(map, { t: 'mark', mark: markView(mark) });
  }

  private restoreMark(m: MarkRecord): void {
    const map = this.maps.get(m.map);
    if (!map || !map.inside(m.x, m.y) || this.markTiles.get(m.map)!.has(m.y * map.width + m.x)) return;
    this.addMark({ ...m });
    this.nextMarkId = Math.max(this.nextMarkId, m.id + 1);
  }

  private addMark(m: MarkRecord): void {
    this.marks.set(m.id, m);
    this.markTiles.get(m.map)!.set(m.y * this.maps.get(m.map)!.width + m.x, m);
    this.markFadeAt = Math.min(this.markFadeAt, m.placedAt + MARK_LIFETIME_MS - this.epochOffset);
  }

  private removeMark(m: MarkRecord): void {
    this.marks.delete(m.id);
    this.markTiles.get(m.map)!.delete(m.y * this.maps.get(m.map)!.width + m.x);
    this.markWrites.set(m.id, undefined);
    this.toMap(m.map, { t: 'markGone', id: m.id });
  }

  private fadeMarks(now: number): void {
    if (now < this.markFadeAt) return;
    const wall = now + this.epochOffset;
    for (const m of [...this.marks.values()]) if (wall >= m.placedAt + MARK_LIFETIME_MS) this.removeMark(m);
    this.markFadeAt = [...this.marks.values()].reduce((at, m) => Math.min(at, m.placedAt + MARK_LIFETIME_MS - this.epochOffset), Infinity);
  }

  // ---------- watchers ----------

  /** Where a watcher may stand: what the map allows any creature (open ground out of the light, away from fires and exits, never in tall grass). */
  private watcherMayStand(map: TileMap, x: number, y: number): boolean {
    return map.creatureMayStand(x, y);
  }

  /**
   * Each watcher that may step: wakes up where nobody is, or freezes while someone on its map faces
   * it, or takes one step toward the nearest player out of the light; reaching one, it takes energy
   * and something they carry, and goes away for a while.
   */
  private walkWatchers(now: number): void {
    const every = this.sky === 'aurora' ? AURORA_WATCHER_STEP_MS : WATCHER_STEP_MS;
    for (const [mapId, list] of this.watchers) {
      if (this.asleep.has(mapId)) continue;
      for (const w of list) {
        // Asked again for each watcher: another one's touch may have just sent someone home.
        const here = [...this.onMap.get(mapId)!];
        if (!w.awake) {
          if (now >= w.wakeAt) this.wake(w, here, now);
          continue;
        }
        if (now < w.readyAt) continue;
        w.readyAt = now + every;
        const map = w.map;
        if (this.nearFlare(mapId, w.x, w.y, now)) {
          this.sendAway(w, now);
          continue;
        }
        // Anyone who faces it holds it still, prey or not: a friend can keep watch.
        if (here.some(p => manhattan(p.rec.x, p.rec.y, w.x, w.y) <= WATCHER_SEE && faces(p.rec.x, p.rec.y, p.rec.dir, w.x, w.y))) continue;
        const prey = here
          .filter(p => p.rec.energy > 0 && this.noticeable(p, now) && manhattan(p.rec.x, p.rec.y, w.x, w.y) <= (p.live ? WATCHER_HUNT_LIVE : WATCHER_HUNT))
          .sort((a, b) => manhattan(a.rec.x, a.rec.y, w.x, w.y) - manhattan(b.rec.x, b.rec.y, w.x, w.y))[0];
        if (!prey) continue;
        const next = pathStep(map, w.x, w.y, prey.rec.x, prey.rec.y, (x, y) => this.watcherMayStand(map, x, y) && !this.nearFlare(mapId, x, y, now) && !this.creatureAt(mapId, x, y));
        if (next) {
          w.dir = dirTo(next.x - w.x, next.y - w.y) ?? w.dir;
          w.x = next.x;
          w.y = next.y;
          this.toMap(mapId, { t: 'creature', creature: creatureView(w) });
        }
        if (manhattan(prey.rec.x, prey.rec.y, w.x, w.y) <= 1) this.touch(w, prey, now);
      }
    }
  }

  /** Out in the open: not by a burning fire, not in a street light, not near a flare. A flash still finds you in tall grass. */
  private exposed(p: Online, now: number): boolean {
    const { x, y } = p.rec;
    if (p.map.lit(x, y) || this.nearFlare(p.map.data.id, x, y, now)) return false;
    return !(p.map.warm(x, y) && this.fires.warmth(p.map, x, y, now) > 0);
  }

  /** Whom creatures notice and go after: someone out in the open, and not hidden in tall grass. */
  private noticeable(p: Online, now: number): boolean {
    return this.exposed(p, now) && !hidden(p.map, p.rec.x, p.rec.y);
  }

  private wake(w: Watcher, here: Online[], now: number): void {
    const W = w.map.width;
    const far = w.lairs.filter(t => !this.creatureAt(w.map.data.id, t % W, Math.floor(t / W)) && here.every(p => manhattan(p.rec.x, p.rec.y, t % W, Math.floor(t / W)) >= WATCHER_WAKE_AWAY));
    if (!far.length) {
      w.wakeAt = now + 10_000;
      return;
    }
    const t = far[this.roll(far.length)]!;
    w.x = t % w.map.width;
    w.y = Math.floor(t / w.map.width);
    w.awake = true;
    w.readyAt = now + WATCHER_STEP_MS;
    this.toMap(w.map.data.id, { t: 'creature', creature: creatureView(w) });
  }

  private sendAway(w: Watcher, now: number): void {
    const [soonest, latest] = WATCHER_AWAY_S;
    w.awake = false;
    w.chasing = undefined;
    w.wakeAt = now + (soonest + this.rng() * (latest - soonest)) * 1000;
    this.toMap(w.map.data.id, { t: 'creatureGone', id: w.id });
  }

  /** A watcher reached a player: energy lost, one thing they carried taken (at random), and it goes away. */
  private touch(w: Watcher, p: Online, now: number): void {
    this.sendAway(w, now);
    const units = p.rec.bag.flatMap((s, slot) => Array.from({ length: s.count }, () => slot));
    let lost: string | null = null;
    if (units.length) {
      const slot = units[this.roll(units.length)]!;
      lost = p.rec.bag[slot]!.item;
      p.rec.bag = takeFromBag(p.rec.bag, slot, 1);
      p.rec.stash = usedUp(p.rec.stash ?? emptyStash(), lost, 1);
      this.sendBag(p, now);
      this.saveNow.set(p.rec.id, p.rec);
    }
    this.advance(p, now);
    p.rec.energy = Math.max(0, p.rec.energy - WATCHER_TOUCH);
    this.outbox.push({ to: p.rec.id, msg: { t: 'touched', by: 'watcher', lost } });
    if (p.rec.energy <= 0) return this.collapse(p, now);
    this.refresh(p, now);
    this.tell(p, now);
  }

  // ---------- skulkers ----------

  /** Where a skulker may go: like a watcher, and only as far from home as its rule says. */
  private skulkerMayStand(map: TileMap, rule: SkulkerRule, x: number, y: number): boolean {
    const d = map.homeSteps(x, y);
    return this.watcherMayStand(map, x, y) && d >= rule.steps[0] && d <= rule.steps[1];
  }

  /** Skulkers are out at night (aurora nights too) or in a storm, as their region's rule says. */
  private skulkersOut(map: TileMap, rule: SkulkerRule, now: number): boolean {
    if (rule.when.includes('night') && (this.sky === 'night' || this.sky === 'aurora')) return true;
    return rule.when.includes('storm') && this.stormOf(map, now)?.phase === 'storm';
  }

  /**
   * Each skulker that may step: out of its time it sinks into the ferns; awake, it lies still in its
   * lair until it hears someone walking or sees someone standing near, out in the open; then it chases
   * them until it catches them or gives up (the time is over, they reached light, a fire or tall grass,
   * or its range ends), and goes back to its lair.
   */
  private walkSkulkers(now: number): void {
    for (const [mapId, list] of this.skulkers) {
      for (const s of list) {
        const map = s.map;
        if (!this.skulkersOut(map, s.rule, now)) {
          if (s.awake) this.sendAway(s, now);
          continue;
        }
        // Asked again for each skulker: another one's catch may have just sent someone home.
        const here = [...this.onMap.get(mapId)!];
        if (!s.awake) {
          if (now >= s.wakeAt) this.wake(s, here, now);
          if (s.awake) s.lair = s.y * map.width + s.x;
          continue;
        }
        if (now < s.readyAt) continue;
        s.readyAt = now + SKULKER_STEP_MS;
        if (this.nearFlare(mapId, s.x, s.y, now)) {
          this.sendAway(s, now);
          continue;
        }
        const may = (x: number, y: number) => this.skulkerMayStand(map, s.rule, x, y) && !this.nearFlare(mapId, x, y, now) && !this.creatureAt(mapId, x, y);
        let prey = s.chasing === undefined ? undefined : here.find(p => p.rec.id === s.chasing);
        if (s.chasing !== undefined && (!prey || prey.rec.energy <= 0 || now >= s.chaseUntil || !this.noticeable(prey, now))) {
          this.giveUp(s, now);
          prey = undefined;
        }
        if (s.chasing === undefined && now >= s.calmUntil) {
          prey = here
            .filter(p => p.rec.energy > 0 && this.noticeable(p, now) && manhattan(p.rec.x, p.rec.y, s.x, s.y) <= (now - p.readyAt < SKULKER_HEAR_MS ? SKULKER_HEAR : SKULKER_SEE))
            .sort((a, b) => manhattan(a.rec.x, a.rec.y, s.x, s.y) - manhattan(b.rec.x, b.rec.y, s.x, s.y))[0];
        }
        if (prey) {
          const next = pathStep(map, s.x, s.y, prey.rec.x, prey.rec.y, may);
          // No way to them inside its range: it never starts, or it gives up.
          if (!next && manhattan(prey.rec.x, prey.rec.y, s.x, s.y) > 1) {
            if (s.chasing !== undefined) this.giveUp(s, now);
            continue;
          }
          if (s.chasing === undefined) {
            s.chasing = prey.rec.id;
            s.chaseUntil = now + SKULKER_CHASE_MS;
          }
          if (next) this.creatureTo(s, next.x, next.y);
          else this.toMap(mapId, { t: 'creature', creature: creatureView(s) });
          if (manhattan(prey.rec.x, prey.rec.y, s.x, s.y) <= 1) this.caught(s, prey, now);
          continue;
        }
        // Back to its lair, and still there.
        const lx = s.lair % map.width, ly = Math.floor(s.lair / map.width);
        if (s.x === lx && s.y === ly) continue;
        if (manhattan(s.x, s.y, lx, ly) === 1) {
          if (may(lx, ly)) this.creatureTo(s, lx, ly);
          continue;
        }
        // However far the chase took it, it finds its way back.
        const next = pathStep(map, s.x, s.y, lx, ly, may, map.width * map.height);
        // No way back (someone lies in its lair, a flare burns there): it slips through the ferns out of sight.
        this.creatureTo(s, next?.x ?? lx, next?.y ?? ly);
      }
    }
  }

  /** Is an awake creature on this tile? */
  private creatureAt(mapId: string, x: number, y: number): boolean {
    return [...(this.watchers.get(mapId) ?? []), ...(this.skulkers.get(mapId) ?? [])].some(c => c.awake && c.x === x && c.y === y);
  }

  /** A creature moves to x,y (a step, or a jump the clients show at once). */
  private creatureTo(c: Watcher, x: number, y: number): void {
    c.dir = dirTo(x - c.x, y - c.y) ?? c.dir;
    c.x = x;
    c.y = y;
    this.toMap(c.map.data.id, { t: 'creature', creature: creatureView(c) });
  }

  private giveUp(s: Skulker, now: number): void {
    s.chasing = undefined;
    s.calmUntil = now + SKULKER_CALM_MS;
    this.toMap(s.map.data.id, { t: 'creature', creature: creatureView(s) });
  }

  /**
   * A skulker caught a player: energy lost, and one bag slot (at random) falls out as their pile where
   * they stand, to be picked up again; it goes away for a while. Emptied, they collapse as ever.
   */
  private caught(s: Skulker, p: Online, now: number): void {
    this.sendAway(s, now);
    this.advance(p, now);
    p.rec.energy = Math.max(0, p.rec.energy - SKULKER_CATCH);
    if (p.rec.energy <= 0) {
      this.outbox.push({ to: p.rec.id, msg: { t: 'touched', by: 'skulker', lost: null } });
      return this.collapse(p, now);
    }
    let lost: string | null = null;
    if (p.rec.bag.length) {
      const slot = this.roll(p.rec.bag.length);
      lost = p.rec.bag[slot]!.item;
      this.dropBag(p, now, slot);
    }
    this.outbox.push({ to: p.rec.id, msg: { t: 'touched', by: 'skulker', lost } });
    this.refresh(p, now);
    this.tell(p, now);
  }

  // ---------- where things are ----------

  /** Fires out there burn down: on the wilds and in the shelters whose door opens onto them. */
  private wild(map: TileMap): boolean {
    return map.data.kind === 'wilds' || (map.data.kind === 'inside' && this.outside.get(map.data.id) === 'wilds');
  }

  /** In town, or in one of its houses: where there is light and a table to look at things closely. */
  private inTown(map: TileMap): boolean {
    return map.data.kind === 'town' || (map.data.kind === 'inside' && this.outside.get(map.data.id) === 'town');
  }

  /** The notice board: the weather, each region's surge clock, the fires that need feeding, recent collapses, the Old Stone. */
  private news(now: number): string[] {
    const lines: string[] = [];
    const wall = now + this.epochOffset;
    if (this.cycle) {
      const w = weatherAt(wall);
      const next = weatherAt(wall + w.left * 1000 + 1000).weather;
      lines.push(`${WEATHER_WORDS[this.sky]} now. ${capital(WEATHER_WORDS[next])} ${about(w.left)}.`);
    } else lines.push(`${WEATHER_WORDS[this.sky]}.`);
    lines.push(...this.conditionLines(now));
    for (const map of this.maps.values()) {
      const s = this.surgeOf(map, now), rule = map.data.surge;
      if (!s || !rule) continue;
      if (s.phase === 'surge') lines.push(`${map.data.name}: a surge is on, ${about(s.left)} more. Get to a light.`);
      else if (s.phase === 'unstable') lines.push(`${map.data.name}: restless. A surge comes ${about(s.left)}.`);
      else lines.push(`${map.data.name}: calm. The next surge comes ${about(untilSurge(rule, s))}.`);
    }
    for (const map of this.maps.values()) {
      const s = this.stormOf(map, now), rule = map.data.storm;
      if (!s || !rule) continue;
      if (s.phase === 'storm') lines.push(`${map.data.name}: a storm is on, ${about(s.left, true)} more. Get under a roof.`);
      else if (s.phase === 'coming') lines.push(`${map.data.name}: a storm is coming ${about(s.left)}.`);
      else lines.push(`${map.data.name}: clear. The next storm comes ${about(s.left + rule.warn)}.`);
    }
    const low: string[] = [], out: string[] = [];
    for (const f of this.fires.all()) {
      if (f.tended) continue;
      const left = this.fires.left(f, now);
      if (left <= 0) out.push(fireName(f));
      else if (left < FIRE_LOW_S * 2) low.push(fireName(f));
    }
    if (out.length) lines.push(`Gone out: ${listOf(out)}. Bring something that burns.`);
    if (low.length) lines.push(`Burning low: ${listOf(low)}.`);
    if (!out.length && !low.length && this.fires.all().some(f => !f.tended)) lines.push('Every shelter fire is burning.');
    const recent = this.collapses.filter(c => now - c.at < COLLAPSES_MS);
    if (recent.length) {
      const by = new Map<string, number>();
      for (const c of recent) by.set(c.map, (by.get(c.map) ?? 0) + 1);
      lines.push(`Collapsed in the last hour: ${[...by].map(([m, n]) => `${n} in ${this.maps.get(m)?.data.name ?? m}`).join(', ')}.`);
    } else lines.push('Nobody collapsed in the last hour.');
    if (this.stone) {
      const st = this.stoneView(now);
      lines.push(st.awake ? `The Old Stone is awake: surges are gentler for ${about(st.left, true)}.` : `The Old Stone sleeps. ${st.charge} of ${st.need} shards fed.`);
    }
    return lines;
  }

  /** The notice board on the conditions: "Today in the Near Woods: thick fog.", what each means, and the weeks. */
  private conditionLines(now: number): string[] {
    const data = this.conditionsData;
    if (!data) return [];
    const view = this.conditionsNow(now);
    const byId = new Map([...data.daily, ...data.weekly].map(c => [c.id, c]));
    const today = view.today.flatMap(id => byId.get(id) ?? []);
    const lines: string[] = [];
    for (const map of new Set(today.map(c => c.map))) {
      const here = today.filter(c => c.map === map);
      lines.push(`Today in ${(this.maps.get(map)?.data.name ?? map).replace(/^The /, 'the ')}: ${listOf(here.map(c => lower(c.name)))}.`, ...here.map(c => c.text));
    }
    const week = view.week ? byId.get(view.week) : undefined, next = view.next ? byId.get(view.next) : undefined;
    if (week) lines.push(`This week: ${lower(week.name)}. ${week.text}${next && next !== week ? ` Next week: ${lower(next.name)}.` : ''}`);
    return lines;
  }

  // ---------- bags, piles and finds ----------

  /**
   * A saved bag as it fits today's items: items that no longer exist are gone, and a bag that no
   * longer fits (a stack size went down) is packed again; whatever does not fit then is lost.
   */
  private fitBag(bag: unknown, slots: number): BagSlot[] {
    // Only a live item keeps when it was picked.
    const known = (Array.isArray(bag) ? bag : []).filter((s): s is BagSlot => isSlot(s) && this.items.has(s.item))
      .map(s => (s.since === undefined || this.items.get(s.item)!.live ? s : { item: s.item, count: s.count }));
    const fine = known.length <= slots && known.every(s => s.count <= this.items.get(s.item)!.stack);
    return fine ? copyBag(known) : addAllToBag([], known, this.items, slots).bag;
  }

  /** Can one more of `item` go in this bag? */
  private fits(bag: readonly BagSlot[], item: string, slots: number): boolean {
    const def = this.items.get(item);
    return def !== undefined && addToBag(bag, def, 1, slots).left === 0;
  }

  /** One find, one unit of its item: into the bag if it fits, and a new one grows later somewhere else. */
  private pickFind(p: Online, find: Find, now: number): void {
    const { rule } = find;
    const r = addToBag(p.rec.bag, rule.item, 1, p.slots);
    if (r.left) return this.refuse(p, 'pick', 'bag_full');
    // A live find starts fading now: it stacks one to a slot, so the new one is the last slot.
    if (rule.item.live) r.bag.at(-1)!.since = Math.floor(now + this.epochOffset);
    p.rec.bag = r.bag;
    this.finds.get(rule.map.data.id)!.delete(find.tile);
    const [soonest, latest] = rule.respawn;
    this.later(rule, now + (soonest + this.rng() * (latest - soonest)) * 1000, find.tile);
    this.got(p, [{ item: rule.item.id, count: 1 }], 'find', now);
    this.toMap(rule.map.data.id, { t: 'findGone', id: find.id });
    this.rerate(p, now);
    this.moveStory(p, { pick: rule.item.id });
  }

  /**
   * The owner gets all of their pile that fits in the bag, and the rest stays; anyone else gets a
   * random half as far as it fits, and the rest is lost with the pile. When nothing of the pile would
   * fit, it stays as it is: the half is only drawn once the picker can carry something of it, so
   * asking again and again never draws a better half.
   */
  private pickPile(p: Online, d: DropRecord, now: number): void {
    if (!d.items.some(s => this.fits(p.rec.bag, s.item, p.slots))) return this.refuse(p, 'pick', 'bag_full');
    const mine = d.owner === p.rec.id;
    const offered = mine ? d.items : halfOf(d.items, this.rng);
    const r = addAllToBag(p.rec.bag, offered, this.items, p.slots);
    p.rec.bag = r.bag;
    this.saveNow.set(p.rec.id, p.rec);
    this.got(p, less(offered, r.left), 'drop', now);
    if (mine && r.left.length) {
      d.items = merge(r.left);
      this.pileWrites.set(d.owner, d);
      this.toMap(d.map, { t: 'drop', drop: dropView(d) });
    } else {
      this.removePile(d);
    }
    this.rerate(p, now);
  }

  /** The pile on a tile, the picker's own first (that one they get all of). */
  private pileAt(map: TileMap, x: number, y: number, picker: string): DropRecord | undefined {
    if (!map.inside(x, y)) return undefined;
    const here = this.pileTiles.get(map.data.id)!.get(y * map.width + x);
    return here?.find(d => d.owner === picker) ?? here?.[0];
  }

  /** A pile saved before a restart. Items that no longer exist are gone; so is a pile with nothing left or on a map that is gone. */
  private restore(d: DropRecord): void {
    const map = this.maps.get(d.map);
    const items = merge((Array.isArray(d.items) ? d.items : []).filter(s => isSlot(s) && this.items.has(s.item)));
    if (!map || !map.inside(d.x, d.y) || !items.length || this.piles.has(d.owner)) return;
    const trail = (Array.isArray(d.trail) ? d.trail : []).filter(([x, y]) => map.inside(x, y)).slice(-TRAIL_STEPS);
    this.addPile({ ...d, items, trail });
  }

  private addPile(d: DropRecord): void {
    this.piles.set(d.owner, d);
    const tiles = this.pileTiles.get(d.map)!;
    const tile = d.y * this.maps.get(d.map)!.width + d.x;
    const here = tiles.get(tile);
    if (here) here.push(d);
    else tiles.set(tile, [d]);
    this.fadeAt = Math.min(this.fadeAt, d.droppedAt + DROP_LIFETIME_MS - this.epochOffset);
  }

  /** A pile goes (taken, faded or replaced): everyone on its map hears it, and storage forgets it. */
  private removePile(d: DropRecord): void {
    this.piles.delete(d.owner);
    const tiles = this.pileTiles.get(d.map)!;
    const tile = d.y * this.maps.get(d.map)!.width + d.x;
    const rest = tiles.get(tile)!.filter(o => o !== d);
    if (rest.length) tiles.set(tile, rest);
    else tiles.delete(tile);
    this.pileWrites.set(d.owner, undefined);
    this.toMap(d.map, { t: 'dropGone', id: d.owner });
  }

  /** Piles whose hour is over fade. */
  private fadePiles(now: number): void {
    if (now < this.fadeAt) return;
    const wall = now + this.epochOffset;
    for (const d of [...this.piles.values()]) if (wall >= d.droppedAt + DROP_LIFETIME_MS) this.removePile(d);
    this.fadeAt = [...this.piles.values()].reduce((at, d) => Math.min(at, d.droppedAt + DROP_LIFETIME_MS - this.epochOffset), Infinity);
  }

  /** All of a rule's finds, on free tiles; those with no free tile grow as soon as there is one. */
  private sow(rule: Rule, now?: number): void {
    for (let i = 0; i < rule.count; i++) {
      const find = this.put(rule, undefined);
      if (!find) this.later(rule, -Infinity, undefined);
      else if (now !== undefined) this.toMap(rule.map.data.id, { t: 'find', find: findView(find) });
    }
  }

  /** A rule's time has come (its finds grow, and everyone on its map sees them) or is over (its finds go). */
  private openRule(rule: Rule, open: boolean, now: number): void {
    if (rule.open === open) return;
    rule.open = open;
    if (open) return this.sow(rule, now);
    this.growing = this.growing.filter(g => g.rule !== rule);
    const finds = this.finds.get(rule.map.data.id)!;
    for (const [tile, f] of [...finds]) {
      if (f.rule !== rule) continue;
      finds.delete(tile);
      this.toMap(rule.map.data.id, { t: 'findGone', id: f.id });
    }
  }

  /** Finds whose time has come grow, and everyone on their map hears it. */
  private growFinds(now: number): void {
    if (now < this.growAt) return;
    const due = this.growing.filter(g => g.at <= now).sort((a, b) => a.at - b.at);
    this.growing = this.growing.filter(g => g.at > now);
    this.growAt = this.growing.reduce((at, g) => Math.min(at, g.at), Infinity);
    for (const g of due) {
      if (!g.rule.open) continue;
      const find = this.put(g.rule, g.not);
      // Every tile it may grow on is taken (by other finds and by piles): it tries again a while later.
      if (!find) this.later(g.rule, now + g.rule.respawn[0] * 1000, g.not);
      else this.toMap(g.rule.map.data.id, { t: 'find', find: findView(find) });
    }
  }

  private later(rule: Rule, at: number, not: number | undefined): void {
    this.growing.push({ rule, at, not });
    this.growAt = Math.min(this.growAt, at);
  }

  /** A find of the rule on a free tile (freeTile); undefined if none is free. Nobody is told here. */
  private put(rule: Rule, not: number | undefined): Find | undefined {
    const tile = this.freeTile(rule, not);
    if (tile === undefined) return undefined;
    const find: Find = { id: this.nextFindId++, rule, tile };
    this.finds.get(rule.map.data.id)!.set(tile, find);
    return find;
  }

  /**
   * A random tile the rule's finds may grow on, with no find and no pile on it. `not` (where the last
   * one was taken) only when no other tile is free, so that a find moves on whenever it can.
   */
  private freeTile(rule: Rule, not: number | undefined): number | undefined {
    const { tiles } = rule;
    const finds = this.finds.get(rule.map.data.id)!;
    const piles = this.pileTiles.get(rule.map.data.id)!;
    const empty = (t: number) => !finds.has(t) && !piles.has(t);
    // Finds are few next to the tiles they may grow on, so a few random tries nearly always hit a free one.
    for (let i = 0; i < 8 && tiles.length; i++) {
      const t = tiles[this.roll(tiles.length)]!;
      if (t !== not && empty(t)) return t;
    }
    const free = tiles.filter(t => t !== not && empty(t));
    if (free.length) return free[this.roll(free.length)];
    return not !== undefined && empty(not) ? not : undefined;
  }

  /** A random whole number from 0 to n - 1. */
  private roll(n: number): number {
    return Math.min(n - 1, Math.floor(this.rng() * n));
  }

  /** Tells the player what they got, then their whole bag. */
  private got(p: Online, items: BagSlot[], from: 'find' | 'drop', now: number): void {
    this.outbox.push({ to: p.rec.id, msg: { t: 'got', items, from } });
    this.sendBag(p, now);
  }

  /** The player wears `gear` (piece by piece: `worn`) now: saved, everyone on the map sees it, and the player hears their bar and stash. */
  private wearGear(p: Online, gear: Gear, worn: Worn, now: number): void {
    p.rec.gear = gear;
    p.rec.worn = worn;
    this.saveNow.set(p.rec.id, p.rec);
    this.toMap(p.map.data.id, { t: 'gear', id: p.rec.id, gear: { ...gear }, quirks: quirksOf(worn) });
    this.sendStash(p);
    this.refresh(p, now);
    // A bar that shrank (a piece with extra energy came off) cannot hold more than it can.
    p.rec.energy = Math.min(p.rec.energy, p.max);
    this.tell(p, now);
  }

  /** A full bar: the level's, plus what the gear worn gives. */
  private maxOf(r: PlayerRecord): number {
    return maxEnergy(levelOf(r.xp ?? 0)) + gearEnergy(r.gear ?? {}, this.items, r.worn);
  }

  /**
   * Saved gear as today's items fit it: pieces that are still gear for their slot. A player who never
   * chose (none saved) wears the starter gear; nobody is ever without a bag.
   */
  private cleanGear(saved: unknown): Gear {
    const raw = (typeof saved === 'object' && saved !== null && !Array.isArray(saved) ? saved : undefined) as Record<string, unknown> | undefined;
    const out: Gear = {};
    for (const slot of SLOTS) {
      const id = raw ? raw[slot] : STARTER_GEAR[slot];
      const def = typeof id === 'string' ? this.items.get(id) : undefined;
      if (def?.kind === 'gear' && def.slot === slot) out[slot] = def.id;
    }
    const bag = STARTER_GEAR.bag!;
    if (!out.bag && this.items.get(bag)?.kind === 'gear') out.bag = bag;
    return out;
  }

  /** Saved pieces for what the player wears: each kept if it is a piece, else a new one (an anomalous one with its quirk). */
  private cleanWorn(saved: unknown, gear: Gear): Worn {
    const raw = (typeof saved === 'object' && saved !== null && !Array.isArray(saved) ? saved : {}) as Record<string, unknown>;
    const out: Worn = {};
    for (const slot of SLOTS) {
      const def = gear[slot] ? this.items.get(gear[slot]!) : undefined;
      if (!def) continue;
      const had = raw[slot];
      out[slot] = isPiece(had) && (had.quirk !== undefined || def.tier !== 'anomalous') ? { ...had } : newPiece(def, this.rng);
    }
    return out;
  }

  /** Is there a workbench on tile x,y of the player's map, right next to them? */
  private benchNextTo(p: Online, x: number, y: number): boolean {
    return manhattan(x, y, p.rec.x, p.rec.y) === 1 && p.map.data.objects.some(o => o.kind === 'workbench' && o.x === x && o.y === y);
  }

  /** Is there a chest on tile x,y of the player's map, right next to them? */
  private chestNextTo(p: Online, x: number, y: number): boolean {
    return manhattan(x, y, p.rec.x, p.rec.y) === 1 && p.map.data.objects.some(o => o.kind === 'chest' && o.x === x && o.y === y);
  }

  private sendStash(p: Online): void {
    this.outbox.push({ to: p.rec.id, msg: { t: 'chest', stash: stashList(p.rec.stash ?? emptyStash(), this.itemOrder) } });
  }

  /** Sends the player their bag; everyone on the map sees them start or stop glowing with a live find. */
  private sendBag(p: Online, now: number): void {
    this.outbox.push({ to: p.rec.id, msg: { t: 'bag', bag: bagView(p.rec.bag, now + this.epochOffset) } });
    const live = this.liveIn(p.rec.bag);
    if ((live > 0) !== (p.live > 0)) this.toMap(p.map.data.id, { t: 'glow', id: p.rec.id, on: live > 0 });
    p.live = live;
  }

  /** How many live finds a bag holds. */
  private liveIn(bag: readonly BagSlot[]): number {
    return bag.filter(s => this.items.get(s.item)?.live).length;
  }

  /** What a live find in the bag has turned into, and is worth, `wall` ms since the epoch (a slot saved without `since` has faded). */
  private liveNow(s: BagSlot, wall: number): { def: ItemDef; into: ItemDef | undefined; age: number } | undefined {
    const def = this.items.get(s.item);
    if (!def?.live) return undefined;
    return { def, into: this.items.get(def.live.into), age: s.since === undefined ? Infinity : Math.max(0, wall - s.since) / 1000 };
  }

  /** Live finds past liveEnds become the plain item they faded into. */
  private fadeLive(p: Online, now: number): void {
    const wall = now + this.epochOffset;
    let bag = p.rec.bag, changed = false;
    for (let i = bag.length - 1; i >= 0; i--) {
      const l = this.liveNow(bag[i]!, wall);
      if (!l || l.age < liveEnds(l.def, l.into)) continue;
      bag = takeFromBag(bag, i);
      // Always fits: it takes the slot the live one left (or tops up a stack).
      if (l.into) bag = addToBag(bag, l.into, 1, Infinity).bag;
      changed = true;
    }
    if (!changed) return;
    p.rec.bag = bag;
    this.sendBag(p, now);
    this.saveNow.set(p.rec.id, p.rec);
  }

  private refuse(p: Online, action: 'pick' | 'use' | 'discard' | 'feed' | 'store' | 'take' | 'equip' | 'unequip' | 'craft' | 'mend', reason: Refusal): void {
    this.outbox.push({ to: p.rec.id, msg: { t: 'refused', action, reason } });
  }

  /** A message for everyone on a map, but `except`. */
  private toMap(map: string, msg: ServerMsg, except?: string): void {
    this.outbox.push(except === undefined ? { to: '*', map, msg } : { to: '*', map, except, msg });
  }
}

/**
 * The stash with `delta` of `item` (none: nothing taken) and one `back` returned (gear taken off).
 * Wearing and taking off is neither bringing home nor using up: it touches neither XP nor `out`.
 */
function moveStash(s: Stash, item: string | undefined, delta: number, back: string | undefined): Stash {
  const items = { ...s.items };
  if (item) {
    items[item] = (items[item] ?? 0) + delta;
    if (items[item]! <= 0) delete items[item];
  }
  if (back) items[back] = (items[back] ?? 0) + 1;
  return { items, out: { ...s.out } };
}

function toSpawn(r: PlayerRecord, map: TileMap): void {
  const { spawn } = map.data;
  r.x = spawn.x;
  r.y = spawn.y;
  r.dir = spawn.dir;
}

/** The units of `all` that are not among `left`, equal items joined. */
function less(all: readonly BagSlot[], left: readonly BagSlot[]): BagSlot[] {
  const rest = new Map(merge(left).map(s => [s.item, s.count]));
  return merge(all).flatMap(s => {
    const n = s.count - (rest.get(s.item) ?? 0);
    return n > 0 ? [{ item: s.item, count: n }] : [];
  });
}

/** Does someone at x,y facing `dir` look toward tile tx,ty? Anything on the side they face counts. */
export function faces(x: number, y: number, dir: Dir, tx: number, ty: number): boolean {
  switch (dir) {
    case 'up': return ty < y;
    case 'down': return ty > y;
    case 'left': return tx < x;
    case 'right': return tx > x;
  }
}

function dirTo(dx: number, dy: number): Dir | undefined {
  if (dx === 0 && dy === -1) return 'up';
  if (dx === 0 && dy === 1) return 'down';
  if (dx === -1 && dy === 0) return 'left';
  if (dx === 1 && dy === 0) return 'right';
  return undefined;
}

/**
 * The first step from x,y on a shortest way next to tx,ty over tiles where `may` allows standing (the
 * target's own tile excepted: it is where the prey stands). Null if there is no way within `nodes` tiles (a few hundred unless asked).
 */
export function pathStep(
  map: TileMap, x: number, y: number, tx: number, ty: number, may: (x: number, y: number) => boolean, nodes = WATCHER_PATH_NODES,
): { x: number; y: number } | null {
  if (manhattan(x, y, tx, ty) <= 1) return null;
  const W = map.width, start = y * W + x;
  const prev = new Map<number, number>([[start, -1]]);
  const queue = [start];
  for (let head = 0; head < queue.length && head < nodes; head++) {
    const i = queue[head]!, cx = i % W, cy = Math.floor(i / W);
    if (manhattan(cx, cy, tx, ty) <= 1 && i !== start) {
      let at = i;
      while (prev.get(at) !== start) at = prev.get(at)!;
      return { x: at % W, y: Math.floor(at / W) };
    }
    for (const [nx, ny] of [[cx, cy - 1], [cx + 1, cy], [cx, cy + 1], [cx - 1, cy]] as const) {
      const j = ny * W + nx;
      if (prev.has(j) || (nx === tx && ny === ty) || !may(nx, ny)) continue;
      prev.set(j, i);
      queue.push(j);
    }
  }
  return null;
}

const WEATHER_WORDS: Record<Weather, string> = { overcast: 'Overcast', rain: 'Rain', night: 'Night', aurora: 'An aurora night' };
const capital = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const lower = (s: string) => s[0]!.toLowerCase() + s.slice(1);

/** "in about 6 minutes", or "in under a minute"; `plain` drops the "in" ("for about 6 hours"). */
function about(seconds: number, plain = false): string {
  const pre = plain ? '' : 'in ';
  if (seconds < 60) return plain ? 'under a minute' : 'in under a minute';
  if (seconds < 90 * 60) {
    const m = Math.round(seconds / 60);
    return `${pre}about ${m} minute${m === 1 ? '' : 's'}`;
  }
  const h = Math.round(seconds / 3600);
  return `${pre}about ${h} hour${h === 1 ? '' : 's'}`;
}

function listOf(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** A shelter's fire is called after its shelter; a campfire after its region. */
function fireName(f: Fire): string {
  if (f.name) return f.name;
  const name = f.map.data.name;
  // Names read "The old cabin"; in the middle of a sentence it is "the old cabin".
  return f.map.data.kind === 'inside' ? name.replace(/^The /, 'the ') : `the campfire in ${name.replace(/^The /, 'the ')}`;
}
