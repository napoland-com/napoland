/**
 * The game rules for the players who are online. No I/O, no clock and no dice of its own: every call
 * that depends on time gets `now` (ms), randomness comes from `rng`, everything the players should
 * hear is queued as Outgoing messages for the network layer to drain and send, and what storage must
 * hear at once (piles, marks, the Old Stone) is queued for it the same way (takeWrites).
 *
 * The world is several maps joined by exits (a house's door is one, into the house). A map can have
 * several copies, each a zone of its own (Zone): its main copy is the world everyone shares, and any
 * other copy has a key of its own. Players see and hear only the players in their own zone, and what
 * lies there to pick up, its fires, creatures, flares and flashes, piles and marks are each zone's own;
 * the sky, the surge and storm clocks and the day's conditions belong to the map, so every copy of it
 * shares them, and the Old Stone is the whole world's. Which copy an exit leads into is decided in one
 * place (copyFor). Everyone online has energy, which drains in the wilds,
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
 * glowcap; they last a day (longer for a good neighbor). The Old Stone in town wakes when enough shards are fed to it, and while
 * awake it calms every surge. Strange objects found deep in turn into something when looked at in
 * town. Feats, earned rank by rank by what you do out there, make it a little easier for good (feats.ts).
 *
 * Gear is kept piece by piece (gear.ts): what a player wears wears down while they are out in the
 * wilds, protects less and less when nearly worn out, and is mended at the workbench, where a piece
 * worn or in the stash can also be upgraded a level at a time (from +7 by the dice); anomalous
 * pieces have a quirk, which everyone on the map knows (some show in the world). A piece can travel
 * in the bag, one to a slot, and keeps its piece wherever it goes (the bag, a pile, someone else's
 * half of it); it goes on and comes off at the chest, and anywhere from and into the bag. The bag
 * you wear changes only at the chest. Over it all, a player signed in may wear an outfit (outfits.ts),
 * which changes how they look and nothing else; past level 20, merits buy a pattern for their jacket and
 * a badge for their name tag (merits.ts), looks too.
 *
 * At home, a chest is each player's stash: what they put in earns XP (once: what they took out and bring
 * back earns nothing again), and XP brings levels, each a bigger energy bar (progress.ts). Time away fills
 * a cup of rest, counted as they arrive; while it holds any, stashing earns double out of it. On a server
 * with sign-in, whoever plays signed in finds a parcel in it the first time they play on each calendar
 * day, a welcome parcel the very first time (parcels.ts): gifts, which earn no XP. A NAPO lockbox, which
 * Sunday's parcel holds for whoever came back all week, is opened at the chest.
 *
 * Finds lie on the maps for everyone: whoever picks one up first gets it, and a new one of the same
 * rule grows a while later on another tile that fits the rule; some grow only while a region is
 * restless, or on aurora nights. What a player picks up goes in their bag. When they collapse, the
 * bag falls out as a pile where they fell (one per player), with the last steps they walked: its owner
 * gets it all back, anyone else a random half (the rest is lost), and it fades an hour after the
 * collapse. The rules for items and bags are in shared/items.ts. Tools are each player's own for good,
 * apart from the bag (giveTool): made at the workbench or found, and never in a pile.
 *
 * Thanks (shared/thanks.ts): a fire out there remembers who fed it last, an arrow who painted it, and
 * whoever warms at the one or follows the other can thank them, once a UTC day each. The helper hears it
 * at once if online (a little energy out in the wilds, a line anywhere else), or in a letter when they
 * next walk into their home room. Who thanked whom is kept THANKS_KEPT_DAYS, in memory and in storage.
 *
 * Crates for whoever comes next (shared/caches.ts): where people rest by a fire out there, a crate holds
 * a few things anyone left. Each visit (in its room, or near one in the open) a player may leave one
 * thing from their bag and take one out; taking thanks whoever left it, and counts as taken out of the
 * taker's stash, so it earns no XP at home. What lies in each crate is kept across restarts.
 */
import {
  AFTERGLOW_NEAR,
  AFTERGLOW_S,
  CACHE_NEAR,
  CACHE_SIZE,
  DIR_VEC,
  MARK_LIFETIME_MS,
  QUIRKS,
  SLOTS,
  STARTER_GEAR,
  STARTER_TOOLS,
  DROP_LIFETIME_MS,
  ENERGY_SYNC_MS,
  STATS,
  STEP_STATS,
  STEP_MS,
  SURGE_DRAIN,
  THANKS_ENERGY,
  THANKS_KEPT_MS,
  THANKS_PER_TRIP,
  THANKS_REACH,
  UTC_CALENDAR,
  WEEKDAYS,
  WHOLE_WEEK,
  FLASH_BURST_S,
  FLASH_GLOW_S,
  activeConditions,
  addAllToBag,
  addToBag,
  amount,
  bagLoad,
  bagSlotsOf,
  cacheTakes,
  calendarDay,
  canMake,
  cleanNotebook,
  cleanRested,
  conditionsAt,
  dayIndex,
  daysThisWeek,
  emptyNotebook,
  everyDaySoFar,
  notebookIndex,
  noted,
  readableAt,
  readEvents,
  weekIndex,
  seeded,
  charmsIn,
  chapterOf,
  energyRate,
  featOf,
  fitPieces,
  gather,
  gift,
  mendCost,
  newPiece,
  nextUpgrade,
  takePiece,
  upgradable,
  upgradeChance,
  wearSeconds,
  UPGRADE_MAX,
  flashHits,
  findTiles,
  gearEnergy,
  hidden,
  halfOf,
  inSurge,
  emptyStash,
  itemIndex,
  levelOf,
  liveEnds,
  liveXp,
  markLifetime,
  maxEnergy,
  merge,
  mayWear,
  mayWearLook,
  meritLookOf,
  meritsLeft,
  modsOf,
  nextParcel,
  openInStash,
  openSealed,
  outfitOf,
  progressOf,
  rankOf,
  reachedBy,
  resistOf,
  restAfter,
  restFor,
  spendRest,
  stashList,
  store,
  storeLive,
  takeOut,
  usedUp,
  reveal,
  stepCounts,
  stepTarget,
  stormAt,
  surgeAt,
  surgeFront,
  takeFromBag,
  takeItem,
  thanksKey,
  toldAfter,
  turnedInto,
  toolsOf,
  untilSurge,
  utcDay,
  weatherAt,
  weekdayOf,
  wetRate,
  whyNotBuy,
  keptOffer,
  offerFrom,
  swapOffers,
  traded,
  type OfferPick,
  type Arrival,
  type BagSlot,
  type BodyView,
  type CacheItemView,
  type Calendar,
  type ConditionsData,
  type ConditionsView,
  type CreatureView,
  type Did,
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
  type LookKind,
  type MeritsView,
  type NotebookData,
  type NotebookEvent,
  type NotebookIndex,
  type NotebookView,
  type Piece,
  type Quirk,
  type Sight,
  type Worn,
  type MapRef,
  type MarkView,
  type Mods,
  type ParcelState,
  type ParcelsData,
  type PersonView,
  type PieceAt,
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
  type ThanksFor,
  type ThanksGroup,
  type TileMap,
  type Weather,
} from '@napoland/shared';
import { FIRE_LOW_S, Fires, type Fire } from './fires';
import type { CacheItemRecord, DropRecord, MarkRecord, PlayerRecord, StoneRecord, ThanksRecord } from './storage';

export { MARK_LIFETIME_MS };

/** A step may start this much early: messages sent at a steady pace arrive bunched up. */
export const STEP_TOLERANCE_MS = 40;
/** Early steps wait here, in order; one more than this is rejected. */
export const STEP_QUEUE_MAX = 2;
/**
 * A player hears their energy again as soon as its rate moves this share away from the rate they
 * last heard. Smaller changes (one more step into the woods) wait for the regular repeat.
 */
export const ENERGY_RATE_CHANGE = 0.1;
/** Each player has at most this many marks (they fade MARK_LIFETIME_MS after they are painted, longer for a good neighbor). */
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
/** A skulker hears someone whose gear has the hush quirk (gear.ts) walking only this close. */
export const SKULKER_HEAR_HUSHED = 4;
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
/**
 * For the field notes (notebook.ts), what counts as seen or heard: a watcher within sight (the camera
 * shows about this much around you), a flash near you, the ferns' rustle (as far as a client plays a
 * skulker's chase) and the dead wires humming by a pole, center to center.
 */
export const SEEN_TILES = 6;
export const FLASH_NEAR = 3;
export const RUSTLE_HEARD = 8;
export const HUM_NEAR = 2;

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
 * A message for one player (by id), or for everyone in a zone ('*': `map` is the zone's key, the map's
 * id for its main copy), optionally leaving one player out, or for everyone online ('all'). '*' means
 * everyone in the zone when the message was queued: the network layer sends the messages in order and
 * moves a player over to the new zone's audience at their `zone` message, which names the zone's key
 * beside it when that is a copy other than the main one (`zone`). The client never hears a copy's key:
 * to it, every copy of a map is that map.
 */
export type Outgoing =
  | { to: string; msg: ServerMsg; zone?: string }
  | { to: '*'; map: string; except?: string; msg: ServerMsg }
  | { to: 'all'; msg: ServerMsg };

/**
 * A zone's key: a map's id for its main copy (the world everyone shares), else the id and the copy's
 * key. Map ids are lowercase words joined by hyphens (validateMap), so no two zones share a key.
 */
export const zoneKey = (map: string, copy: string): string => (copy ? `${map}:${copy}` : map);

/** What a zone holds besides players, as its welcome or zone lists it. */
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
  /** The map of the player's zone: whichever copy of it they are in, the client knows only the map. */
  map: MapRef;
  /** Everyone in the player's zone, the player included. */
  players: PlayerView[];
  energy: EnergyView;
  body: BodyView;
  bag: BagSlot[];
  /** What the stash holds, as the chest lists it: after the parcel the player may have found in it now. */
  stash: BagSlot[];
  stone: StoneView;
  conditions: ConditionsView;
  stats: Stats;
  progress: ProgressView;
  /** The rest their time away was worth, since they were last seen (restFor): whether the cup had room for it or not. */
  restedAway: number;
  /** What they spent of their merits, and the looks they bought (those this release has). */
  merits: MeritsView;
  /** Every tool the player owns, in the order they got them (toolsOf): the starter tools until they got one of their own. */
  tools: string[];
  story: StoryView;
  /** Whom the player thanked today (UTC), by id. */
  thanked: string[];
  notebook: NotebookView;
}

/** How a trade's swap went (World.swap): what each side gave, or why nothing moved and whose bag it was about. */
export type Swap = { ok: true; aGave: BagSlot[]; bGave: BagSlot[] } | { ok: false; why: 'gone' | 'room'; who: string };

/** What storage must hear: piles and marks to write (or remove: undefined), players to save now, and the Old Stone if it changed. */
export interface Writes {
  drops: Array<{ owner: string; drop: DropRecord | undefined }>;
  /** Players whose bag changed along with a pile, as they are now: saved with it, so a crash cannot leave items in both. */
  players: PlayerRecord[];
  marks: Array<{ id: number; mark: MarkRecord | undefined }>;
  stone?: StoneRecord;
  /** Thanks given, or told since (thanks.ts), as they are now. */
  thanks: ThanksRecord[];
  /** The helpers of the thanks given since, one entry for each: their count of thanks received grows by one each (Storage.creditThanks). */
  credits: string[];
  /** Things left in crates (or taken out of them: undefined), by id. */
  caches: Array<{ id: number; item: CacheItemRecord | undefined }>;
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
  /** The pages of the field notes (content/notebook.json, checked with validateNotebook); none if unset. */
  notebook?: NotebookData;
  /** Where finds grow, when and which half of a pile someone else gets, what a strange object is. Math.random unless a test sets its own. */
  rng?: () => number;
  /** Piles saved before a restart; they lie where they were until they fade. */
  drops?: DropRecord[];
  /** Marks saved before a restart. */
  marks?: MarkRecord[];
  /** Thanks given in the last THANKS_KEPT_DAYS, as saved before a restart. */
  thanks?: ThanksRecord[];
  /** What lay in the crates before a restart. */
  cacheItems?: CacheItemRecord[];
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
  /**
   * Players sign in on this server (dev or supabase), so one nobody signed in with (authSub null)
   * plays as a guest, and everyone sees it (PlayerView.guest): no friends with them until they sign in,
   * no parcels and no outfits.
   */
  guests?: boolean;
  /** The days the parcels follow (parcels.ts): calendar days in UTC, unless a play-test shortens them (PARCEL_DAY_MS). */
  calendar?: Calendar;
  /** Development only (XP_MULTIPLIER): stashing earns this many times the XP, to play-test the levels without the trips. 1 unless set. */
  xpTimes?: number;
  /** Development only (RESTED_EVERY_MS): the time away that fills one XP of rest, to play-test it without the days away. RESTED_EVERY_MS unless set. */
  restedEveryMs?: number;
}

interface Online {
  rec: PlayerRecord;
  /** The zone the player is in, and its map (zone.map, at hand). */
  zone: Zone;
  map: TileMap;
  /** When the current step is over and the next one may start. */
  readyAt: number;
  queue: Array<{ dir: Dir; seq: number }>;
  /**
   * A talk, or a look at the notice board, the chest, the workbench or a crate, that came in while steps
   * sent before it still waited in the queue: done once they are walked (talk, board, chest, bench, openCache).
   */
  after?: { t: 'talk' | 'board' | 'chest' | 'bench' | 'cache'; x: number; y: number };
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
  /** Thanks that gave them energy this trip (THANKS_PER_TRIP at most): a trip ends at home, or with a collapse. */
  gifts: number;
  /** The last surge that caught them out in the wilds (map and round), so each is counted once. */
  surgedIn?: string;
  /** The crate they visit (its key: in its room, or near it in the open), and whether they left one thing and took one this visit. */
  visit: { cache: string; left: boolean; took: boolean } | null;
  /** When they last collapsed: a chase they were in then was no chase they got out of. */
  fellAt?: number;
  /** Their afterglow (a quirk, gear.ts) lasts until then (game time): they glow faintly, and watchers keep off them. */
  afterglowUntil?: number;
}

/** A crate for whoever comes next (caches.ts) on its map and tile, and what lies in it, oldest first. */
interface Crate {
  /** crateKey: its zone's key and its tile. */
  key: string;
  /** The key of the zone it stands in, and that zone's copy (none for the main copy): each copy of a map has crates of its own. */
  zone: string;
  copy: string;
  map: TileMap;
  x: number;
  y: number;
  /** In a room, the whole room is the visit; in the open, CACHE_NEAR around it. */
  inside: boolean;
  items: CacheItemRecord[];
}

/**
 * A find rule of items.json, ready to use. Whether it is open follows the map's clocks and conditions,
 * which every copy of the map shares; each copy grows its own finds of it.
 */
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
  /** The zone it lies in (a copy of the rule's map). */
  zone: Zone;
  /** y * width + x on the rule's map. */
  tile: number;
}

/** A find that grows in `zone` at `at`, on another tile than `not` (where the last one was taken) if it can. */
interface Growing {
  rule: Rule;
  zone: Zone;
  at: number;
  not: number | undefined;
}

/**
 * A copy of a map, and what happens in it: who is in it (who hears whom), what lies there to pick up,
 * its fires, creatures, flares and flashes. Piles and marks are kept by the zone's key instead, apart
 * from its players, since they outlive a copy nobody is in. Each map's main copy is the world everyone
 * shares and stays open as long as the World runs; any other copy opens when someone walks into it and
 * closes on the tick after its last player left, so an empty copy costs nothing.
 */
interface Zone {
  /** zoneKey(map, copy): messages for everyone in it go by it. */
  readonly key: string;
  readonly map: TileMap;
  /** '' for the map's main copy; any other copy has a key of its own (copyFor). */
  readonly copy: string;
  readonly players: Set<Online>;
  /** The finds lying in it, by tile: never two on one tile. */
  readonly finds: Map<number, Find>;
  readonly fires: Fires;
  readonly watchers: Watcher[];
  readonly skulkers: Skulker[];
  flares: Flare[];
  flashes: Flash[];
  /** When its next flash starts (game time); unset until its first tick. */
  nextFlash?: number;
}

interface Watcher {
  id: number;
  kind: CreatureView['kind'];
  /** The zone it roams, and its map (zone.map, at hand). */
  zone: Zone;
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

/** A flash in a zone (Zone.flashes). */
interface Flash {
  x: number;
  y: number;
  kind: FlashKind;
  /** Game time when it is over; it discharges in its last FLASH_BURST_S. */
  until: number;
  /** Who its discharge left glowing (an afterglow): each once. */
  glowed?: Set<string>;
}

/** A flare burning in a zone (Zone.flares). */
interface Flare {
  x: number;
  y: number;
  /** Game time when it burns out. */
  until: number;
}

const quirksOf = (w: Worn | undefined): Quirk[] => SLOTS.flatMap(s => (w?.[s]?.quirk ? [w[s]!.quirk!] : []));
const view = (r: PlayerRecord, live = false, guest = false, afterglow = 0): PlayerView => ({
  id: r.id, name: r.name, x: r.x, y: r.y, dir: r.dir, color: r.color, gear: { ...r.gear }, quirks: quirksOf(r.worn), ...(live ? { live: true as const } : {}),
  ...(guest ? { guest: true as const } : {}), ...(r.outfit ? { outfit: r.outfit } : {}), ...(r.pattern ? { pattern: r.pattern } : {}), ...(r.badge ? { badge: r.badge } : {}),
  ...(afterglow > 0 ? { afterglow } : {}),
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
/** When a mark fades: its own time, or a day after it was painted for one saved without (by an older release). */
const markUntil = (m: MarkRecord): number => m.until ?? m.placedAt + MARK_LIFETIME_MS;
const markView = (m: MarkRecord): MarkView => ({ id: m.id, x: m.x, y: m.y, dir: m.dir, color: m.color, owner: m.owner, name: m.name, until: markUntil(m) });
/** One thanks a day from a giver to a helper: its key. */
const thanksDay = (giver: string, helper: string, day: number) => `${giver} ${helper} ${day}`;
/** A crate by the key of its zone (each copy of a map has its own crates) and its tile. */
const crateKey = (zone: string, x: number, y: number) => `${zone} ${x},${y}`;
const NOBODY: ReadonlySet<string> = new Set();
/** The key of the zone a pile, a mark or a thing in a crate lies in: one saved without a copy lies in the map's main copy. */
const recordZone = (r: { map: string; zone?: string }): string => zoneKey(r.map, typeof r.zone === 'string' ? r.zone : '');
/** What a pile, a mark or a thing in a crate made in copy `copy` remembers of it: nothing for the main copy, as before copies existed. */
const copyField = (copy: string): { zone?: string } => (copy ? { zone: copy } : {});
/** The tiles of zone `key` in an index kept by zone key, made when first needed. */
function tilesOf<T>(index: Map<string, Map<number, T>>, key: string): Map<number, T> {
  let tiles = index.get(key);
  if (!tiles) index.set(key, (tiles = new Map()));
  return tiles;
}
const creatureView = (w: Watcher): CreatureView => ({ id: w.id, kind: w.kind, x: w.x, y: w.y, dir: w.dir, ...(w.chasing !== undefined && { chasing: w.chasing }) });
const copyBag = (bag: readonly BagSlot[]): BagSlot[] =>
  bag.map(s => ({ item: s.item, count: s.count, ...(s.since !== undefined ? { since: s.since } : {}), ...(s.piece ? { piece: { ...s.piece } } : {}) }));
/** The bag as its owner hears it: a live item's `since` (the server's wall clock) as its age in seconds, and each carried piece of gear as it is. */
const bagView = (bag: readonly BagSlot[], wall: number): BagSlot[] =>
  bag.map(s => ({
    item: s.item, count: s.count, ...(s.since !== undefined ? { age: round(Math.max(0, wall - s.since) / 1000, 1) } : {}), ...(s.piece ? { piece: { ...s.piece, cond: round(s.piece.cond, 3) } } : {}),
  }));
const copyStash = (s: Stash): Stash => ({
  items: { ...s.items }, out: { ...s.out }, ...(s.pieces ? { pieces: Object.fromEntries(Object.entries(s.pieces).map(([id, l]) => [id, l.map(p => ({ ...p }))])) } : {}),
});
const copyRecord = (r: PlayerRecord): PlayerRecord => ({
  ...r, bag: copyBag(r.bag), ...(r.kept ? { kept: { bag: structuredClone(r.kept.bag) } } : {}), stats: { ...r.stats }, ...(r.stash ? { stash: copyStash(r.stash) } : {}), ...(r.gear ? { gear: { ...r.gear } } : {}),
  ...(r.worn ? { worn: copyWorn(r.worn) } : {}), ...(r.tools ? { tools: [...r.tools] } : {}), ...(r.parcels ? { parcels: { ...r.parcels } } : {}),
  ...(r.looks ? { looks: [...r.looks] } : {}),
  ...(r.notebook ? { notebook: { pages: [...r.notebook.pages], blanks: [...r.notebook.blanks] } } : {}),
});
/** A saved piece as the server writes them: a condition from 0 to 1, a quirk the game knows (or none), a level up to UPGRADE_MAX (or none). */
const isPiece = (p: unknown): p is Piece => {
  const { cond, quirk, level } = (typeof p === 'object' && p !== null ? p : {}) as Partial<Piece>;
  return typeof cond === 'number' && cond >= 0 && cond <= 1 && (quirk === undefined || QUIRKS.includes(quirk))
    && (level === undefined || (Number.isInteger(level) && level >= 0 && level <= UPGRADE_MAX));
};
/** A saved piece with only what a piece holds: its condition, and its quirk and level when it has them. */
const cleanPiece = (p: Piece): Piece => ({ cond: p.cond, ...(p.quirk !== undefined ? { quirk: p.quirk } : {}), ...(p.level ? { level: p.level } : {}) });
/**
 * A bag slot as the server writes them; saved data is checked with this before it is trusted. Its
 * piece is checked apart (World.pieced): a bad piece is replaced, the slot kept.
 */
const isSlot = (s: unknown): s is BagSlot => {
  const { item, count, since } = (typeof s === 'object' && s !== null ? s : {}) as Partial<BagSlot>;
  return typeof item === 'string' && Number.isInteger(count) && count! > 0 && (since === undefined || Number.isFinite(since));
};
/** Saved tools: item ids, each once, in the order they came. Anything but a list was never set (the starter tools). */
const cleanTools = (t: unknown): string[] | undefined => (Array.isArray(t) ? [...new Set(t.filter((id): id is string => typeof id === 'string' && id !== ''))] : undefined);
/**
 * Saved counts, trusted only where they are whole numbers from 0. One this release does not count (a
 * newer release's) is kept as saved, like its tools: a save writes it back, and the newer release,
 * back after a rollback to this one, finds it as it left it.
 */
const cleanStats = (s: unknown): Stats => {
  const out: Stats = {};
  const raw = (typeof s === 'object' && s !== null && !Array.isArray(s) ? s : {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(raw)) {
    if (!(STATS as readonly string[]).includes(k)) (out as Record<string, unknown>)[k] = structuredClone(v);
    else if (Number.isInteger(v) && (v as number) > 0) out[k as (typeof STATS)[number]] = v as number;
  }
  return out;
};
/** Saved parcels as the server writes them: anything else counts as none given. */
const cleanParcels = (s: unknown): ParcelState | undefined => {
  if (typeof s !== 'object' || s === null) return undefined;
  const { welcome, day, days } = s as Partial<Record<keyof ParcelState, unknown>>;
  return {
    welcome: welcome === true,
    day: Number.isSafeInteger(day) ? (day as number) : null,
    days: Number.isInteger(days) && (days as number) > 0 ? (days as number) & WHOLE_WEEK : 0,
  };
};
/**
 * A saved stash as today's items fit it: counts that are whole numbers above 0. An item this release
 * does not know (a newer release's, rolled back) is kept as saved, its pieces as they were, like the
 * tools: never listed or used here, and written back with every save, so the newer release finds it.
 */
const cleanStash = (s: unknown, items: Map<string, ItemDef>): Stash => {
  const out = emptyStash();
  const raw = (typeof s === 'object' && s !== null ? s : {}) as Partial<Record<keyof Stash, unknown>>;
  for (const k of ['items', 'out'] as const) {
    const part = (typeof raw[k] === 'object' && raw[k] !== null ? raw[k] : {}) as Record<string, unknown>;
    for (const [id, n] of Object.entries(part)) if (Number.isInteger(n) && (n as number) > 0) out[k][id] = n as number;
  }
  const pieces = (typeof raw.pieces === 'object' && raw.pieces !== null ? raw.pieces : {}) as Record<string, unknown>;
  for (const [id, list] of Object.entries(pieces)) {
    if (Array.isArray(list)) (out.pieces ??= {})[id] = items.has(id) ? list.filter(isPiece).map(cleanPiece) : structuredClone(list);
  }
  return out;
};
const manhattan = (ax: number, ay: number, bx: number, by: number) => Math.abs(ax - bx) + Math.abs(ay - by);

export class World {
  readonly stepMs: number;
  /** The home town: where the home is, and the roads out start. */
  readonly home: TileMap;
  /**
   * Where new players start and collapsed players wake up: the wake point of the home off the home town
   * (in their own copy of it, when it is private: their cabin), or the town's spawn if it has none.
   */
  readonly wakeUp: { map: TileMap; x: number; y: number; dir: Dir };
  /** The version of the items (content/items.json): a client with another one reloads. */
  readonly itemsVersion: number;
  /** The story's chapters (story.ts): where each player is in it is theirs (PlayerRecord.story). */
  private readonly story: StoryData;
  private readonly maps = new Map<string, TileMap>();
  /** For each inside, the kind of map its door opens onto: a shelter in the wilds, or a house in town. */
  private readonly outside = new Map<string, TileMap['data']['kind']>();
  private readonly players = new Map<string, Online>();
  /** Every zone that is open, by key (zoneKey): each map's main copy always, any other copy while someone is in it. */
  private readonly zones = new Map<string, Zone>();
  /** The same zones by map id, the main copy first: what happens to a whole map (its clocks, its conditions) reaches every copy of it. */
  private readonly copies = new Map<string, Set<Zone>>();
  /** Copies whose last player left: they close at the next tick, unless someone came back meanwhile. */
  private readonly emptied = new Set<Zone>();
  /** readyAt of players who left mid-step, so leaving and joining again cannot skip the wait. */
  private readonly resting = new Map<string, number>();
  private outbox: Outgoing[] = [];
  private sky: Weather;
  private readonly cycle: boolean;
  /** Players sign in here: one nobody signed in with is a guest (WorldOptions.guests). */
  private readonly guests: boolean;
  /** Stashing earns this many times an item's XP: 1, but for play-tests (WorldOptions.xpTimes). */
  private readonly xpTimes: number;
  /** The time away that fills one XP of rest (WorldOptions.restedEveryMs). */
  private readonly restedEvery: number | undefined;
  private readonly onCollapse: WorldOptions['onCollapse'];
  private readonly items: Map<string, ItemDef>;
  /** The items in the order of content/items.json: a stash lists them so. */
  private readonly itemOrder: ItemDef[];
  /** What the workbench makes, by recipe id. */
  private readonly recipes: Map<string, Recipe>;
  /** How gear wears out, and what mending and upgrading it cost (content/items.json). */
  private readonly wearTimes: ItemsData['wear'];
  private readonly mendCosts: ItemsData['mend'];
  private readonly upgrades: ItemsData['upgrades'];
  private readonly rng: () => number;
  private readonly epochOffset: number;
  private readonly rules: Rule[] = [];
  private growing: Growing[] = [];
  /** The earliest time in `growing`, so tick() only looks through it when something is due. */
  private growAt = Infinity;
  private nextFindId = 1;
  /** Piles by owner: each player has at most one. */
  private readonly piles = new Map<string, DropRecord>();
  /**
   * The same piles by zone key and tile (several players may fall on one tile). Kept whether the zone is
   * open or not: a pile in a copy nobody is in waits for the copy to open again, until it fades.
   */
  private readonly pileTiles = new Map<string, Map<number, DropRecord[]>>();
  /** The game time when the next pile fades (or later), so tick() only looks when one is due. */
  private fadeAt = Infinity;
  private readonly pileWrites = new Map<string, DropRecord | undefined>();
  /** By id: the record itself, which stays whole after a player leaves (their collapse on the way out counts too). */
  private readonly saveNow = new Map<string, PlayerRecord>();
  /** Marks by id, and by zone key and tile (one per tile), whether the zone is open or not, like piles. */
  private readonly marks = new Map<number, MarkRecord>();
  private readonly markTiles = new Map<string, Map<number, MarkRecord>>();
  private readonly markWrites = new Map<number, MarkRecord | undefined>();
  private nextMarkId = 1;
  private markFadeAt = Infinity;
  /** Each surging map's phase as its players last heard it (every copy of the map hears it together). */
  private readonly surgePhase = new Map<string, SurgePhase>();
  /** The map each inside's door opens onto: its storm is the one heard drumming on the roof. */
  private readonly around = new Map<string, TileMap>();
  /** Each storming map's phase (an inside's: the one around it) as its players last heard it. */
  private readonly stormPhase = new Map<string, StormPhase>();
  private nextCreatureId = 1;
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
  /** Where each map's watchers wake today (the rule's, or a condition's): a copy opening later wakes its own there too. */
  private readonly lairsNow = new Map<string, number[]>();
  /** Where each map's skulkers may lie in wait (fern tiles in their range). */
  private readonly skulkerLairs = new Map<string, number[]>();
  /** Maps whose watchers sleep (a condition), in every copy. */
  private readonly asleep = new Set<string>();
  /** The fireplaces a condition put out today (a copy that opens later finds them out too). */
  private doused: Array<{ map: string; x: number; y: number }> = [];
  /** Collapses in the last hour, for the notice board. */
  private collapses: Array<{ map: string; at: number }> = [];
  /** The parcels (content/items.json), and the calendar whose days they follow. */
  private readonly parcels: ParcelsData | undefined;
  private readonly calendar: Calendar;
  /** The calendar day as the last tick saw it: when it turns, whoever plays signed in gets the new day's parcel. */
  private calendarAt: number | undefined;
  /** The rooms that are someone's home: an inside with the chest, where each player's stash is. Walking into one ends a trip. */
  private readonly homes = new Set<string>();
  /** Who thanked whom in the last THANKS_KEPT_DAYS, by giver, helper and UTC day (thanksDay): one each. */
  private readonly thanks = new Map<string, ThanksRecord>();
  private readonly thanksWrites = new Map<string, ThanksRecord>();
  private credits: string[] = [];
  /** The wall time when the oldest thanks is to be forgotten (or later), so tick() only looks when one is due. */
  private thanksForgetAt = Infinity;
  /**
   * Whom each player online blocks (net.ts sets it from social.ts): someone who blocks a player hears
   * nothing from them, thanks included. Nobody, until it is set.
   */
  blocks: (id: string) => ReadonlySet<string> = () => NOBODY;
  /**
   * The crates, by key (crateKey), and the same by zone key: every main copy's from the start, another
   * copy's from when it opens, kept while the copy is closed only if something lies in them.
   */
  private readonly crates = new Map<string, Crate>();
  private readonly cratesOn = new Map<string, Crate[]>();
  private readonly cacheWrites = new Map<number, CacheItemRecord | undefined>();
  private nextCacheId = 1;
  /** The field notes' pages, by what opens them and fills in their blanks (notebook.ts). */
  private readonly notebook: NotebookIndex;
  /** Each map's poles, once asked for: on an aurora night the wires hum beside them. */
  private readonly poles = new Map<string, Array<[number, number]>>();
  /** The game time of the last tick: what everyone sees of an afterglow is counted from it. */
  private tickAt = 0;

  /** `maps` must fit together (validateWorld) and `items` must fit the maps (validateItems); `homeId` is a town. */
  constructor(maps: Iterable<TileMap>, homeId: string, weather: Weather, options: WorldOptions = {}) {
    for (const m of maps) {
      if (this.maps.has(m.data.id)) throw new Error(`two maps have the id ${m.data.id}`);
      this.maps.set(m.data.id, m);
    }
    // loadMaps checks this and more; a world without it would lose players walking through an exit.
    for (const m of this.maps.values()) {
      for (const e of m.data.exits) if (!this.maps.has(e.to)) throw new Error(`map ${m.data.id} has an exit to ${e.to}, which does not exist`);
    }
    for (const m of this.maps.values()) {
      if (m.data.kind === 'inside') continue;
      for (const e of m.data.exits) if (this.maps.get(e.to)!.data.kind === 'inside') { this.outside.set(e.to, m.data.kind); this.around.set(e.to, m); }
    }
    for (const m of this.maps.values()) if (m.data.kind === 'inside' && m.data.objects.some(o => o.kind === 'chest')) this.homes.add(m.data.id);
    const home = this.maps.get(homeId);
    if (!home) throw new Error(`the home map ${homeId} does not exist`);
    this.home = home;
    // validateWorld keeps it to one home, whose door opens onto the home town.
    const room = [...this.maps.values()].find(m => m.data.wake && this.around.get(m.data.id) === home);
    this.wakeUp = room ? { map: room, ...room.data.wake! } : { map: home, ...home.data.spawn };
    this.sky = weather;
    this.cycle = options.cycle ?? false;
    this.guests = options.guests ?? false;
    this.xpTimes = options.xpTimes ?? 1;
    this.restedEvery = options.restedEveryMs;
    this.stepMs = options.stepMs ?? STEP_MS;
    this.onCollapse = options.onCollapse;
    this.rng = options.rng ?? Math.random;
    this.epochOffset = options.epochOffset ?? 0;
    // Every map's main copy, the world everyone shares: its fires start burning now.
    for (const m of this.maps.values()) this.newZone(m, '', options.now ?? 0);

    const items = options.items ?? { version: 0, items: [], finds: [] };
    this.items = itemIndex(items);
    this.itemOrder = items.items;
    this.recipes = new Map((items.recipes ?? []).map(rc => [rc.id, rc]));
    this.wearTimes = items.wear;
    this.mendCosts = items.mend;
    this.upgrades = items.upgrades;
    this.itemsVersion = items.version;
    this.parcels = items.parcels;
    this.calendar = options.calendar ?? UTC_CALENDAR;
    this.story = options.story ?? { version: 0, chapters: [] };
    this.notebook = notebookIndex(options.notebook ?? { version: 0, pages: [] });
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
    for (const rule of this.rules) if (rule.open) this.sow(rule, this.main(rule.map));
    for (const m of options.marks ?? []) this.restoreMark(m);
    for (const t of options.thanks ?? []) {
      this.thanks.set(thanksDay(t.giver, t.helper, t.day), { ...t, what: { ...t.what } });
      this.thanksForgetAt = Math.min(this.thanksForgetAt, t.at + THANKS_KEPT_MS);
    }
    for (const m of this.maps.values()) this.cratesIn(m, '');
    for (const c of options.cacheItems ?? []) this.restoreCacheItem(c);

    // Where each map's creatures may wake is the same in every copy of it: worked out once.
    for (const m of this.maps.values()) {
      const w = m.data.watchers;
      if (m.data.kind !== 'wilds' || !w) continue;
      const lairs = m.lairs(w.steps);
      if (!lairs.length) continue;
      this.baseLairs.set(m.data.id, lairs);
      this.lairsNow.set(m.data.id, lairs);
    }
    for (const m of this.maps.values()) {
      const rule = m.data.skulkers;
      if (m.data.kind !== 'wilds' || !rule) continue;
      const lairs: number[] = [];
      for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (m.kind(x, y) === 'ferns' && this.skulkerMayStand(m, rule, x, y)) lairs.push(y * m.width + x);
      if (lairs.length) this.skulkerLairs.set(m.data.id, lairs);
    }
    // They all wake on the first tick, each where nobody is: every watcher first, then every skulker.
    for (const m of this.maps.values()) this.addWatchers(this.main(m));
    for (const m of this.maps.values()) this.addSkulkers(this.main(m));

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

  /** The key of the zone an online player is in (zoneKey): whom they hear, and who hears them. */
  zoneOf(id: string): string | undefined {
    return this.players.get(id)?.zone.key;
  }

  /** The keys of the zones open now: every map's main copy, and each other copy someone is in. */
  zoneKeys(): string[] {
    return [...this.zones.keys()];
  }

  /** Everyone in a zone (by its key: a map's id is its main copy). */
  views(zone: string): PlayerView[] {
    return [...(this.zones.get(zone)?.players ?? [])].map(p => this.viewOf(p));
  }

  /** A player as everyone sees them (an afterglow's seconds left as of the last tick). */
  private viewOf(p: Online): PlayerView {
    const glow = p.afterglowUntil === undefined ? 0 : round(Math.max(0, p.afterglowUntil - this.tickAt) / 1000, 1);
    return view(p.rec, p.live > 0, this.guest(p.rec), glow);
  }

  /** Nobody signed in with this character, on a server with sign-in: no friends and no outfits until someone does. */
  private guest(r: PlayerRecord): boolean {
    return this.guests && r.authSub === null;
  }

  /** What lies in a zone to pick up. */
  findViews(zone: string): FindView[] {
    return [...(this.zones.get(zone)?.finds.values() ?? [])].map(findView);
  }

  /** The piles lying in a zone, open or not. */
  dropViews(zone: string): DropView[] {
    return [...(this.pileTiles.get(zone)?.values() ?? [])].flat().map(dropView);
  }

  /** Everything a zone holds besides players, as of `now`. */
  scene(key: string, now: number): Scene {
    const zone = this.zones.get(key);
    return {
      finds: this.findViews(key),
      drops: this.dropViews(key),
      fires: zone?.fires.views(now) ?? [],
      marks: [...(this.markTiles.get(key)?.values() ?? [])].map(markView),
      creatures: zone ? [...zone.watchers, ...zone.skulkers].filter(w => w.awake).map(creatureView) : [],
      flares: (zone?.flares ?? []).filter(f => f.until > now).map(f => ({ x: f.x, y: f.y, left: round((f.until - now) / 1000, 1) })),
      flashes: (zone?.flashes ?? []).filter(f => f.until > now).map(f => flashView(f, now)),
      surge: zone ? this.surgeOf(zone.map, now) : null,
      storm: zone ? this.stormOf(zone.map, now) : null,
    };
  }

  /** The Old Stone as everyone sees it. */
  stoneView(now: number): StoneView {
    this.burnStone(now);
    return { charge: Math.ceil(this.stoneCharge), need: STONE_NEED, awake: this.stoneAwake, left: this.stoneAwake ? Math.round(this.stoneCharge * STONE_SHARD_S) : 0 };
  }

  /** Puts a player in the world, tells everyone in their zone and returns what goes in the welcome. */
  join(rec: PlayerRecord, now: number): Joined {
    if (this.players.has(rec.id)) throw new Error(`player ${rec.id} is already online`);
    const gear = this.cleanGear(rec.gear);
    // Time away since they were last seen fills the cup of rest (progress.ts), a guest's too.
    const away = now + this.epochOffset - rec.lastSeenAt;
    // Slots of items this release does not know (a newer one's): set aside as saved, and written back with every save.
    const kept = [...(rec.kept?.bag ?? []), ...(Array.isArray(rec.bag) ? rec.bag : []).filter(s => isSlot(s) && !this.items.has(s.item))];
    const r: PlayerRecord = {
      ...rec, gear, worn: this.cleanWorn(rec.worn, gear), bag: this.fitBag(rec.bag, bagSlotsOf(gear, this.items)), stats: cleanStats(rec.stats),
      kept: kept.length ? { bag: structuredClone(kept) } : undefined,
      // Gear counted in the stash gets its pieces (all of it, for a stash saved before pieces existed).
      stash: fitPieces(cleanStash(rec.stash, this.items), this.items, this.rng),
      xp: Number.isInteger(rec.xp) && rec.xp! > 0 ? rec.xp : 0,
      rested: restAfter(cleanRested(rec.rested), away, this.restedEvery),
      // Kept as saved, ids this release does not know included (toolsOf).
      tools: cleanTools(rec.tools),
      // Merits spent stay spent, and every look bought stays theirs, a newer release's too (a list of ids, as the tools are).
      meritsSpent: Number.isInteger(rec.meritsSpent) && rec.meritsSpent! > 0 ? rec.meritsSpent : 0,
      looks: cleanTools(rec.looks) ?? [],
      ...(rec.parcels !== undefined ? { parcels: cleanParcels(rec.parcels) } : {}),
      // Pages and blanks a newer notebook wrote stay too: the client shows the ones it knows.
      ...(rec.notebook !== undefined ? { notebook: cleanNotebook(rec.notebook) } : {}),
    };
    // Maps change between visits: a map may be gone (start over at home, where you wake up), or the
    // saved tile may be inside something new or part of an exit now (start at that map's spawn). Never
    // start inside a wall, or on an exit that would move you the moment you step.
    let map = this.maps.get(r.map), copy: string;
    if (!map) {
      ({ map, x: r.x, y: r.y, dir: r.dir } = this.wakeUp);
      copy = this.copyFor(r, map);
    } else {
      if (!map.walkable(r.x, r.y) || map.exitAt(r.x, r.y)) toSpawn(r, map);
      copy = this.rejoin(r, map);
    }
    const zone = this.zoneFor(map, copy, now);
    r.map = map.data.id;
    if (zone.copy) r.zone = zone.copy;
    else delete r.zone;
    // What they wear counts as taken out of the stash (equip), which the releases before gear went on the
    // road never counted: counted now, once, so a piece put on back then (stashed first, for its XP) earns
    // nothing again when it comes off at the chest. Only what earns XP: for the rest, out never matters.
    if (!r.wornOut) {
      const stash = r.stash ?? emptyStash(), out = { ...stash.out };
      for (const slot of SLOTS) {
        const item = r.gear?.[slot];
        if (item && (this.items.get(item)?.xp ?? 0) > 0) out[item] = (out[item] ?? 0) + 1;
      }
      r.stash = { ...stash, out };
      r.wornOut = true;
    }
    // An outfit shows only while they may wear it (signed in, the level reached). One they may not (it
    // is from a newer release, or they play as a guest now) shows as none, and stays saved for when they may.
    if (r.outfit && !mayWear(r.outfit, levelOf(r.xp ?? 0), !this.guest(r))) delete r.outfit;
    // A pattern and a badge likewise: only one of theirs, only signed in.
    for (const kind of ['pattern', 'badge'] as const) if (r[kind] && !mayWearLook(r[kind], kind, r.looks!, !this.guest(r))) delete r[kind];
    r.energy = Number.isFinite(r.energy) ? Math.min(this.maxOf(r), Math.max(0, r.energy)) : this.maxOf(r);
    r.wet = Number.isFinite(r.wet) ? clamp01(r.wet!) : 0;
    const readyAt = this.resting.get(r.id) ?? -Infinity;
    this.resting.delete(r.id);
    const p: Online = {
      rec: r, zone, map, readyAt, queue: [], rate: 0, wetRate: 0, energyAt: now, load: 0, mods: modsOf(r.stats!), max: this.maxOf(r), slots: bagSlotsOf(gear, this.items), hitched: false,
      hitchAt: now, trail: [], heardRate: 0, heardWetRate: 0, heardLoad: 0, heardAt: now, live: this.liveIn(r.bag), gifts: 0, visit: null,
    };
    this.refresh(p, now);
    this.revisit(p);
    this.players.set(r.id, p);
    zone.players.add(p);
    const player = this.viewOf(p);
    this.toZone(zone.key, { t: 'join', player }, r.id);
    // The welcome has the energy too; the message after it is what a client listens to from then on.
    this.tell(p, now);
    // Their first time today, signed in: the day's parcel waits in the chest (the welcome parcel, the very first time).
    this.giveParcel(p, now);
    const here = zone.key, today = utcDay(now + this.epochOffset);
    return {
      player, map: mapRef(map), players: this.views(here), ...this.scene(here, now), energy: energyView(p), body: bodyView(p), bag: bagView(r.bag, now + this.epochOffset),
      stash: stashList(p.rec.stash ?? emptyStash(), this.itemOrder), stone: this.stoneView(now), conditions: this.conditionsNow(now), stats: { ...r.stats },
      progress: progressOf(r.xp ?? 0, r.rested), restedAway: restFor(away, this.restedEvery), merits: this.meritsOf(r), tools: toolsOf(r.tools, this.items),
      // The chapter they are in, which is the first for someone who never started (story.ts).
      story: { version: this.story.version, chapter: chapterOf(this.story, r.story)?.id ?? '' },
      thanked: [...this.thanks.values()].filter(t => t.giver === r.id && t.day === today).map(t => t.helper),
      notebook: { version: this.notebook.data.version, ...(r.notebook ?? emptyNotebook()) },
    };
  }

  /**
   * A player who joined is settled in: whom they block is known (net.ts calls it once social.ts has read
   * it). Back in the game at home (they left it there), they read their letter now, as if they had
   * walked in: it leaves out thanks from whoever they block.
   */
  returned(id: string, now: number): void {
    const p = this.players.get(id);
    if (p && this.homes.has(p.map.data.id)) this.homecoming(p, now);
  }

  /** Takes a player out of the world, tells everyone in their zone and returns the record to save (with the copy they were in). */
  leave(id: string, now: number): PlayerRecord | undefined {
    const p = this.players.get(id);
    if (!p) return undefined;
    const from = p.zone;
    // Energy that runs out on the way out still counts: the bag drops, and the player wakes up at home next time.
    if (this.advance(p, now) <= 0) this.fall(p, now);
    // Seen until now: coming straight back (another tab, the same record) is no time away to rest in.
    p.rec.lastSeenAt = Math.floor(now + this.epochOffset);
    this.players.delete(id);
    this.quit(p);
    if (p.readyAt > -Infinity) this.resting.set(id, p.readyAt);
    this.toZone(from.key, { t: 'leave', id }, id);
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
    this.toZone(p.zone.key, { t: 'face', id, dir }, id);
  }

  /**
   * Picks up what lies on tile x,y of the player's zone: their own tile or one of the four next to it.
   * A pile there comes first, then a find. The player hears what they got and their bag, or why not;
   * everyone in the zone hears what went.
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
    const pile = this.pileAt(p.zone, x, y, id);
    if (pile) return this.pickPile(p, pile, now);
    const find = p.map.inside(x, y) ? p.zone.finds.get(y * p.map.width + x) : undefined;
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
    const { x, y } = p.rec;
    // Everything that can fail is checked before the item is spent.
    if (use.mark && (p.map.data.kind === 'inside' || p.map.exitAt(x, y))) return this.refuse(p, 'use', 'not_here');
    if (use.mark && this.markTiles.get(p.zone.key)?.has(y * p.map.width + x)) return this.refuse(p, 'use', 'marked');
    if (use.identify && !this.inTown(p.map)) return this.refuse(p, 'use', 'not_here');
    let bag = takeFromBag(p.rec.bag, slot, 1);
    let into: BagSlot | undefined;
    if (use.identify) {
      const r = reveal(def.reveals ?? [], this.rng);
      const it = r && this.items.get(r.item);
      if (it) {
        // Gear is a piece the moment it lands in the bag: its quirk is rolled now, and it can be worn at once.
        const put = this.addNew(bag, it, r.count, p.slots);
        if (put.left) return this.refuse(p, 'use', 'bag_full');
        bag = put.bag;
        const piece = it.kind === 'gear' && r.count === 1 ? bag.at(-1)?.piece : undefined;
        into = { item: it.id, count: r.count, ...(piece ? { piece: { ...piece } } : {}) };
      }
    }
    p.rec.bag = bag;
    // Used up: if it came out of the stash, it will never go back. What a strange object from the stash
    // turns into is owed in its place, so it earns no XP brought back (turnedInto): no double dip.
    const stash = p.rec.stash ?? emptyStash();
    p.rec.stash = into ? turnedInto(stash, def.id, into) : usedUp(stash, def.id, 1);
    const before = p.rec.energy;
    if (use.energy) {
      p.rec.energy = Math.min(p.max, Math.max(0, p.rec.energy + use.energy));
    }
    if (use.mark) this.paint(p, now);
    // A charm may give energy back as a mark is painted (a pale moth): as much as the bar has room for.
    const was = p.rec.energy;
    if (use.mark && p.mods.markEnergy > 0) p.rec.energy = Math.min(p.max, p.rec.energy + p.mods.markEnergy);
    const gave = Math.round(p.rec.energy - was), charm = gave > 0 ? p.rec.bag.map(b => this.items.get(b.item)).find(d => d?.kind === 'charm' && (d.charm?.markEnergy ?? 0) > 0) : undefined;
    const lift = charm ? { item: charm.id, energy: gave } : undefined;
    if (use.flare) this.light(p, use.flare, now);
    // The bar may have jumped, the bag got lighter: the client counts on from the new values.
    this.refresh(p, now);
    this.tell(p, now);
    this.sendBag(p, now);
    // What it did, as far as the bar had room for it.
    this.did(p, {
      kind: 'used', item: def.id,
      ...(use.energy ? { energy: Math.round(p.rec.energy - before) } : {}),
      ...(use.flare ? { flare: use.flare } : {}),
      ...(use.mark ? { mark: { dir: p.rec.dir, left: markLifetime(p.mods) / 1000 } } : {}),
      ...(into ? { into } : {}),
      ...(lift ? { lift } : {}),
    });
    // Seen in the light, for the field notes: what it turned out to be comes into your hands like a find.
    if (into) {
      this.saw(p, 'looked');
      this.note(p, { find: into.item });
    }
    // Something that takes energy could empty the bar.
    if (p.rec.energy <= 0) this.collapse(p, now);
  }

  /** Throws away `count` of what is in bag slot `slot`, or all of it. */
  discard(id: string, slot: number, now: number, count = Infinity): void {
    const p = this.players.get(id);
    if (!p) return;
    if (this.advance(p, now) <= 0) {
      // Too late: the player collapses, and the bag falls out.
      this.collapse(p, now);
      return this.refuse(p, 'discard', 'empty_slot');
    }
    const thrown = p.rec.bag[slot];
    if (!thrown) return this.refuse(p, 'discard', 'empty_slot');
    const n = Math.min(thrown.count, Math.max(1, Math.floor(count)));
    p.rec.stash = usedUp(p.rec.stash ?? emptyStash(), thrown.item, n);
    p.rec.bag = takeFromBag(p.rec.bag, slot, n);
    this.sendBag(p, now);
    this.rerate(p, now);
    this.did(p, { kind: 'thrown', item: thrown.item, count: n, ...(thrown.piece?.level ? { level: thrown.piece.level } : {}) });
  }

  /**
   * Feeds `count` of what is in bag slot `slot` (then of the same item in other slots) to the fire on
   * tile x,y (next to the player, diagonals too: a fire warms the tiles around it) or to the Old Stone.
   * A fire takes them one by one while it is not full, so it takes as many as fit; the Old Stone takes
   * them all. Everyone in the zone sees the fire burn higher (the fire of that copy: each copy's fires
   * are its own); everyone online hears about the Stone, which is one for the whole world.
   */
  feed(id: string, x: number, y: number, slot: number, now: number, count = 1): void {
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
      const r = takeItem(p.rec.bag, slot, count);
      p.rec.bag = r.bag;
      p.rec.stash = usedUp(p.rec.stash ?? emptyStash(), def.id, r.taken);
      const woke = this.chargeStone(def.charge * r.taken, now);
      this.sendBag(p, now);
      this.saveNow.set(id, p.rec);
      this.moveStory(p, { feed: 'stone' });
      this.rerate(p, now);
      return this.did(p, { kind: 'stone', item: def.id, count: r.taken, stone: this.stoneView(now), ...(woke ? { woke: true as const } : {}) });
    }
    const fires = p.zone.fires, fire = fires.at(x, y);
    if (!fire) return this.refuse(p, 'feed', 'gone');
    if (fire.tended) return this.refuse(p, 'feed', 'tended');
    if (!def?.fuel) return this.refuse(p, 'feed', 'not_fuel');
    const lit = fires.left(fire, now) <= 0;
    const have = p.rec.bag.reduce((n, b) => n + (b.item === def.id ? b.count : 0), 0);
    let fed = 0;
    while (fed < Math.min(count, have) && fires.feed(fire, def.fuel, now)) fed++;
    if (!fed) return this.refuse(p, 'feed', 'fire_full');
    p.rec.bag = takeItem(p.rec.bag, slot, fed).bag;
    p.rec.stash = usedUp(p.rec.stash ?? emptyStash(), def.id, fed);
    this.sendBag(p, now);
    // Whoever warms at it later may thank them (thanks.ts): at this copy's fire, the one they fed.
    fires.fedBy(fire, { id, name: p.rec.name });
    const burning = fires.view(fire, now);
    this.toZone(p.zone.key, { t: 'fire', fire: burning });
    // Each one counts for the fire keeper, as when they went in one press at a time.
    for (let i = 0; i < fed; i++) this.count(p, 'fed', now);
    // The story waits for a fire out in the wilds ("Whoever comes next"), never one in town.
    if (this.wild(p.map)) this.moveStory(p, { feed: 'fire' });
    // A dead fire lit again warms whoever stands by it.
    for (const q of p.zone.players) this.rerate(q, now);
    this.did(p, { kind: 'fire', item: def.id, count: fed, left: burning.left ?? 0, ...(lit ? { lit: true as const } : {}) });
  }

  /**
   * Opens the chest on tile x,y (next to the player): they hear what is in their stash. Like a talk, it
   * can come in while the steps sent before it still wait in the queue (a slow network bunched them up):
   * then it opens once they are walked, from where they took the player.
   */
  chest(id: string, x: number, y: number, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    if (p.queue.length) p.after = { t: 'chest', x, y };
    else this.openChest(p, x, y);
  }

  private openChest(p: Online, x: number, y: number): void {
    if (this.chestNextTo(p, x, y)) this.sendStash(p);
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
    // Live finds apart: gathering them would forget when each was picked, and each is worth what its age says.
    const wall = now + this.epochOffset;
    const r = store(p.rec.stash ?? emptyStash(), gather(going.filter(s => !this.items.get(s.item)?.live)), this.items);
    for (const s of going) {
      const l = this.liveNow(s, wall);
      if (!l?.into) continue;
      const lr = storeLive(r.stash, l.into.id, liveXp(l.def, l.age, l.into));
      r.stash = lr.stash;
      r.xp += lr.xp;
    }
    // Carried gear goes in as it is, piece by piece; fitPieces keeps the stash's pieces and its counts one.
    p.rec.stash = fitPieces(r.stash, this.items, this.rng);
    p.rec.bag = slot === undefined ? [] : takeFromBag(p.rec.bag, slot);
    const before = levelOf(p.rec.xp ?? 0);
    this.saveNow.set(id, p.rec);
    this.sendBag(p, now);
    this.sendStash(p);
    this.earn(p, r.xp, true);
    // A bigger bar: the player hears it (and at home, by the fire, it fills up).
    if (levelOf(p.rec.xp ?? 0) !== before) this.refresh(p, now);
    this.tell(p, now);
    this.moveStory(p, { store: true });
  }

  /**
   * Puts on a piece of gear from the player's stash, at the chest on tile x,y next to them: what they
   * wore in its slot goes into the stash. A smaller bag has to hold what they carry. Everyone on the
   * map sees the change; the player hears their new bar (gear can add energy) and rates.
   *
   * What you wear counts as taken out of the stash (progress.ts): a piece could go on here, come off
   * into the bag out there and be stored again, and it must not earn its XP twice. What comes back in
   * pays that off first, like anything stored, and earns XP only beyond it (a piece that never was home).
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
    const took = takePiece(stash, item, n);
    const back = old ? store(took.stash, [{ item: old, count: 1, piece: worn[def.slot] ?? { cond: 1 } }], this.items) : { stash: took.stash, xp: 0 };
    gear[def.slot] = item;
    worn[def.slot] = took.piece ?? newPiece(def, this.rng);
    p.rec.stash = fitPieces(back.stash, this.items, this.rng);
    this.earn(p, back.xp);
    this.wearGear(p, gear, worn, now);
  }

  /**
   * Takes off what the player wears in `slot`, at the chest on tile x,y next to them: it goes into the
   * stash, as stored (equip says why). Not the bag.
   */
  unequip(id: string, x: number, y: number, slot: Slot, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    this.advance(p, now);
    if (!this.chestNextTo(p, x, y)) return this.refuse(p, 'unequip', 'too_far');
    if (slot === 'bag') return this.refuse(p, 'unequip', 'keep_bag');
    const gear = { ...p.rec.gear }, old = gear[slot], worn = { ...p.rec.worn };
    if (!old) return this.refuse(p, 'unequip', 'empty_slot');
    const back = store(p.rec.stash ?? emptyStash(), [{ item: old, count: 1, piece: worn[slot] ?? { cond: 1 } }], this.items);
    delete gear[slot];
    delete worn[slot];
    p.rec.stash = fitPieces(back.stash, this.items, this.rng);
    this.earn(p, back.xp);
    this.wearGear(p, gear, worn, now);
  }

  /**
   * Puts on the piece of gear in bag slot `slot`, anywhere: what the player wore in its slot takes its
   * place in the bag, so there is always room. Never a bag: the bag you wear changes only at the chest,
   * where what you carry can be checked against it. Nothing is used up, so nothing asks first.
   */
  wear(id: string, slot: number, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    if (this.advance(p, now) <= 0) {
      this.collapse(p, now);
      return this.refuse(p, 'wear', 'empty_slot');
    }
    const s = p.rec.bag[slot], def = s && this.items.get(s.item);
    if (!s || !def) return this.refuse(p, 'wear', 'empty_slot');
    if (def.kind !== 'gear' || !def.slot) return this.refuse(p, 'wear', 'not_gear');
    if (def.slot === 'bag') return this.refuse(p, 'wear', 'bag_at_home');
    const gear = { ...p.rec.gear }, worn = { ...p.rec.worn }, old = gear[def.slot];
    const bag = copyBag(p.rec.bag);
    if (old) bag[slot] = { item: old, count: 1, piece: { ...(worn[def.slot] ?? { cond: 1 }) } };
    else bag.splice(slot, 1);
    gear[def.slot] = def.id;
    worn[def.slot] = s.piece ? { ...s.piece } : newPiece(def, this.rng);
    p.rec.bag = bag;
    this.sendBag(p, now);
    this.wearGear(p, gear, worn, now, false);
  }

  /** Takes off what the player wears in `slot`, anywhere: it goes into the bag, if there is a slot free. Not the bag itself. */
  doff(id: string, slot: Slot, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    if (this.advance(p, now) <= 0) {
      this.collapse(p, now);
      return this.refuse(p, 'doff', 'empty_slot');
    }
    if (slot === 'bag') return this.refuse(p, 'doff', 'keep_bag');
    const gear = { ...p.rec.gear }, worn = { ...p.rec.worn }, old = gear[slot];
    if (!old) return this.refuse(p, 'doff', 'empty_slot');
    // A piece takes a slot of its own.
    if (p.rec.bag.length >= p.slots) return this.refuse(p, 'doff', 'bag_full');
    p.rec.bag = [...copyBag(p.rec.bag), { item: old, count: 1, piece: { ...(worn[slot] ?? { cond: 1 }) } }];
    delete gear[slot];
    delete worn[slot];
    this.sendBag(p, now);
    this.wearGear(p, gear, worn, now, false);
  }

  /**
   * Puts on an outfit from the wardrobe at the chest on tile x,y next to the player, or takes it off
   * (null): how they look, whatever gear they wear. Only signed in, and only one their level has
   * reached. Nothing is used up and nothing else changes; it is saved, and everyone on the map sees it.
   */
  outfit(id: string, x: number, y: number, outfit: string | null, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    if (this.guest(p.rec)) return this.refuse(p, 'outfit', 'sign_in_first');
    if (!this.chestNextTo(p, x, y)) return this.refuse(p, 'outfit', 'too_far');
    const def = outfit === null ? undefined : outfitOf(outfit);
    if (outfit !== null && !def) return this.refuse(p, 'outfit', 'gone');
    if (def && !mayWear(def, levelOf(p.rec.xp ?? 0), true)) return this.refuse(p, 'outfit', 'locked');
    if ((p.rec.outfit ?? null) === outfit) return;
    // Taken off is null, not left out: a save without an outfit keeps the one saved.
    p.rec.outfit = def ? def.id : null;
    this.saveNow.set(id, p.rec);
    this.toZone(p.zone.key, { t: 'outfit', id, outfit: def?.id ?? null });
  }

  /**
   * Spends merits on a look (merits.ts), a jacket pattern or a name tag badge, at the chest on tile x,y
   * next to the player: it is theirs for good. Only signed in (a guest earns merits, and spends them once
   * signed in), only a look the game has, once, and with merits enough to spend; the client asks first,
   * and says what it did from `did`. Saved at once.
   */
  buy(id: string, x: number, y: number, lookId: string, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    if (this.guest(p.rec)) return this.refuse(p, 'buy', 'sign_in_first');
    if (!this.chestNextTo(p, x, y)) return this.refuse(p, 'buy', 'too_far');
    const look = meritLookOf(lookId);
    if (!look) return this.refuse(p, 'buy', 'gone');
    const xp = p.rec.xp ?? 0, why = whyNotBuy(look, xp, { spent: p.rec.meritsSpent ?? 0, owned: p.rec.looks ?? [] }, true);
    if (why) return this.refuse(p, 'buy', why);
    p.rec.meritsSpent = (p.rec.meritsSpent ?? 0) + look.cost;
    p.rec.looks = [...(p.rec.looks ?? []), look.id];
    this.saveNow.set(id, p.rec);
    this.outbox.push({ to: id, msg: { t: 'merits', merits: this.meritsOf(p.rec) } });
    this.did(p, { kind: 'bought', look: look.id, left: meritsLeft(xp, p.rec.meritsSpent) });
  }

  /** Wears a jacket pattern of the player's, or none (null), at the chest on tile x,y next to them (adorn). */
  pattern(id: string, x: number, y: number, pattern: string | null, now: number): void {
    this.adorn(id, x, y, 'pattern', pattern, now);
  }

  /** Wears a name tag badge of the player's, or none (null), at the chest on tile x,y next to them (adorn). */
  badge(id: string, x: number, y: number, badge: string | null, now: number): void {
    this.adorn(id, x, y, 'badge', badge, now);
  }

  /**
   * Puts on a look the player bought (a pattern or a badge: one of each at a time), or takes it off (null),
   * at the chest: like an outfit, how they look and nothing else, so nothing asks first. Only signed in,
   * and only one of theirs. It is saved, and everyone in their zone sees it: in their own cabin nobody
   * else is, so the others see it as they walk out (their view has it).
   */
  private adorn(id: string, x: number, y: number, kind: LookKind, lookId: string | null, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    if (this.guest(p.rec)) return this.refuse(p, kind, 'sign_in_first');
    if (!this.chestNextTo(p, x, y)) return this.refuse(p, kind, 'too_far');
    const look = lookId === null ? undefined : meritLookOf(lookId, kind);
    if (lookId !== null && !look) return this.refuse(p, kind, 'gone');
    if (look && !(p.rec.looks ?? []).includes(look.id)) return this.refuse(p, kind, 'not_owned');
    const wears = look?.id ?? null;
    if ((p.rec[kind] ?? null) === wears) return;
    // Taken off is null, not left out: a save without one keeps the one saved.
    p.rec[kind] = wears;
    this.saveNow.set(id, p.rec);
    this.toZone(p.zone.key, kind === 'pattern' ? { t: 'pattern', id, pattern: wears } : { t: 'badge', id, badge: wears });
  }

  /** What the player hears of their merits: what they spent, and the looks they bought that this release has. */
  private meritsOf(r: PlayerRecord): MeritsView {
    return { spent: r.meritsSpent ?? 0, owned: (r.looks ?? []).filter(l => meritLookOf(l)) };
  }

  /** Opens the workbench on tile x,y (next to the player): they hear what their stash holds. Behind steps still waiting, like the chest. */
  bench(id: string, x: number, y: number, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    if (p.queue.length) p.after = { t: 'bench', x, y };
    else this.openBench(p, x, y);
  }

  private openBench(p: Online, x: number, y: number): void {
    if (this.benchNextTo(p, x, y)) this.outbox.push({ to: p.rec.id, msg: { t: 'bench', stash: stashList(p.rec.stash ?? emptyStash(), this.itemOrder) } });
  }

  /** Makes recipe `recipeId` at the workbench on tile x,y next to the player, from their stash, into their stash. */
  craft(id: string, x: number, y: number, recipeId: string, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    if (!this.benchNextTo(p, x, y)) return this.refuse(p, 'craft', 'too_far');
    const recipe = this.recipes.get(recipeId);
    if (!recipe) return this.refuse(p, 'craft', 'gone');
    // A tool made is the player's for good (giveTool), never the stash's: one of each, so a second is refused before anything is paid.
    const tool = this.items.get(recipe.make)?.kind === 'tool';
    if (tool && this.owns(p, recipe.make)) return this.refuse(p, 'craft', 'have_tool');
    const stash = p.rec.stash ?? emptyStash();
    if (!canMake(recipe, stash.items)) return this.refuse(p, 'craft', 'missing');
    const items = { ...stash.items }, count = tool ? 1 : recipe.count ?? 1;
    for (const n of recipe.needs) {
      items[n.item] = items[n.item]! - n.count;
      if (!items[n.item]) delete items[n.item];
    }
    if (!tool) items[recipe.make] = (items[recipe.make] ?? 0) + count;
    // Gear made comes new, piece by piece.
    p.rec.stash = fitPieces({ items, out: { ...stash.out }, pieces: stash.pieces }, this.items, this.rng);
    this.saveNow.set(id, p.rec);
    if (tool) this.giveTool(id, recipe.make);
    // Walt has a word for the first thing someone makes (story.ts, remarks): gear, each piece; a tool is no piece of gear.
    if (this.items.get(recipe.make)?.kind === 'gear') this.count(p, 'made', now, count);
    this.outbox.push({ to: id, msg: { t: 'bench', stash: stashList(p.rec.stash, this.itemOrder) } });
    // The text box says where it went: a tool (its kind tells the client) is the player's for good.
    this.did(p, { kind: 'made', item: recipe.make, count });
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
    p.rec.stash = fitPieces(payFrom(stash, cost), this.items, this.rng);
    p.rec.worn = { ...p.rec.worn, [slot]: { ...piece, cond: 1 } };
    this.saveNow.set(id, p.rec);
    // Once for every piece mended, toward the mender's ranks.
    this.count(p, 'mended', now);
    // Its condition (in the body) before the bench, so the bench's mend row is gone when it redraws.
    this.refresh(p, now);
    this.tell(p, now);
    this.outbox.push({ to: id, msg: { t: 'bench', stash: stashList(p.rec.stash, this.itemOrder) } });
    this.did(p, { kind: 'mended', item, ...(piece.level ? { level: piece.level } : {}) });
  }

  /**
   * Upgrades a piece the player wears, or keeps in the stash, one level, at the workbench on tile x,y
   * next to them, paying from their stash (`upgrades`, gear.ts). From +7 it may not take: the dice are
   * the World's (`rng`), the materials are spent either way, and the piece keeps its level; it never
   * breaks and never goes down. Nothing else about it changes: its condition, its quirk, what mending it costs.
   */
  upgrade(id: string, x: number, y: number, of: PieceAt, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    this.advance(p, now);
    if (!this.benchNextTo(p, x, y)) return this.refuse(p, 'upgrade', 'too_far');
    const stash = p.rec.stash ?? emptyStash();
    const item = of.from === 'worn' ? p.rec.gear?.[of.slot] : of.item;
    const piece = of.from === 'worn' ? p.rec.worn?.[of.slot] : stash.pieces?.[of.item]?.[of.n];
    const def = item ? this.items.get(item) : undefined;
    if (!item || !def || !piece) return this.refuse(p, 'upgrade', 'gone');
    if (!upgradable(def)) return this.refuse(p, 'upgrade', 'not_upgradable');
    const level = piece.level ?? 0, step = nextUpgrade(level, this.upgrades);
    if (!step) return this.refuse(p, 'upgrade', 'top_level');
    if (!canMake({ id: 'upgrade', make: item, needs: step.needs }, stash.items)) return this.refuse(p, 'upgrade', 'missing');
    // Rolled only where it can fail: what always works never draws on the dice.
    const chance = upgradeChance(step), took = chance >= 1 || this.rng() < chance;
    const paid = payFrom(stash, step.needs);
    if (took) {
      const up = { ...piece, level: level + 1 };
      if (of.from === 'worn') p.rec.worn = { ...p.rec.worn, [of.slot]: up };
      else paid.pieces = { ...paid.pieces, [of.item]: paid.pieces![of.item]!.map((q, i) => (i === of.n ? up : q)) };
    }
    p.rec.stash = fitPieces(paid, this.items, this.rng);
    this.saveNow.set(id, p.rec);
    // A piece worn resists more now: its rates and its level (in the body) first, so the bench redraws on them.
    if (took && of.from === 'worn') {
      this.refresh(p, now);
      this.tell(p, now);
    }
    this.outbox.push({ to: id, msg: { t: 'bench', stash: stashList(p.rec.stash, this.itemOrder) } });
    this.did(p, { kind: 'upgraded', item, level: took ? level + 1 : level, ...(took ? {} : { failed: true as const }) });
  }

  /**
   * Takes up to `count` of an item out of the player's stash, in the chest on tile x,y, as much as fits
   * in the bag. Gear comes out one piece at a time, the `n`th of its kind, as it is (condition, quirk,
   * level), into a slot of its own.
   */
  take(id: string, x: number, y: number, item: string, count: number, now: number, n = 0): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    if (!this.chestNextTo(p, x, y)) return this.refuse(p, 'take', 'too_far');
    const stash = p.rec.stash ?? emptyStash(), have = stash.items[item] ?? 0, def = this.items.get(item);
    if (!def || !have) return this.refuse(p, 'take', 'not_stashed');
    // A lockbox is opened at the chest, and never leaves it: it is never lost in a pile or carried off.
    if (def.kind === 'sealed') return this.refuse(p, 'take', 'sealed_stays');
    if (def.kind === 'gear') {
      if (p.rec.bag.length >= p.slots) return this.refuse(p, 'take', 'bag_full');
      const took = takePiece(stash, item, n);
      p.rec.bag = [...copyBag(p.rec.bag), { item, count: 1, piece: took.piece ?? newPiece(def, this.rng) }];
      p.rec.stash = fitPieces(took.stash, this.items, this.rng);
    } else {
      const want = Math.min(have, count);
      const r = addToBag(p.rec.bag, def, want, p.slots);
      const taken = want - r.left;
      if (!taken) return this.refuse(p, 'take', 'bag_full');
      p.rec.bag = r.bag;
      p.rec.stash = takeOut(stash, item, taken).stash;
    }
    this.saveNow.set(id, p.rec);
    this.sendBag(p, now);
    this.sendStash(p);
    this.rerate(p, now);
  }

  /**
   * Opens a sealed thing from the player's stash (a NAPO lockbox), at the chest on tile x,y next to them:
   * one of what it may hold, by weight, goes into the stash as a gift, which earns no XP (it came in a
   * parcel). The player hears their stash, then what was inside.
   */
  open(id: string, x: number, y: number, item: string, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    if (!this.chestNextTo(p, x, y)) return this.refuse(p, 'open', 'too_far');
    const def = this.items.get(item), stash = p.rec.stash ?? emptyStash();
    if (!def || !(stash.items[item] ?? 0)) return this.refuse(p, 'open', 'not_stashed');
    if (def.kind !== 'sealed') return this.refuse(p, 'open', 'not_usable');
    const got = merge(openSealed(def, this.itemOrder, this.rng));
    // Gear it held gets its piece, as anything else that lands in the stash.
    p.rec.stash = fitPieces(openInStash(stash, item, got, this.items)!, this.items, this.rng);
    this.saveNow.set(id, p.rec);
    this.sendStash(p);
    this.did(p, { kind: 'opened', item, got });
  }

  /**
   * Gives a player who is online a tool for good: the one way a tool comes (made at the workbench,
   * found, and later a parcel or a chapter). It joins their tools, never the bag: no slot, no weight,
   * never in a pile, the stash or a trade, and nothing takes it away, so it is saved at once. They hear
   * their tools; how it came is for the caller to say (a find floats with `got`, the workbench says it
   * in the text box with `did`). False, and nothing happens, when it is no tool or theirs already.
   */
  giveTool(id: string, item: string): boolean {
    const p = this.players.get(id);
    if (!p || this.items.get(item)?.kind !== 'tool' || this.owns(p, item)) return false;
    // The first of their own writes down the starter tools they carried until now.
    p.rec.tools = [...(p.rec.tools ?? STARTER_TOOLS), item];
    this.saveNow.set(id, p.rec);
    this.outbox.push({ to: id, msg: { t: 'tools', tools: toolsOf(p.rec.tools, this.items) } });
    return true;
  }

  /** Does the player own this tool? One who never got one of their own owns the starter tools. */
  private owns(p: Online, item: string): boolean {
    return (p.rec.tools ?? STARTER_TOOLS).includes(item);
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
    if (o?.kind === 'npc') {
      this.remarked(p, o.id);
      this.moveStory(p, { talk: o.id });
    } else if (o?.kind === 'console') this.moveStory(p, { read: o.id });
    // Anything read like a sign may open a page of the field notes.
    const read = readableAt(p.map.data, x, y);
    if (read) for (const e of readEvents(p.map.data.id, read)) this.note(p, e);
  }

  /**
   * Talking to someone, the player heard what they had to say about something done for the first time
   * (story.ts, remarksDue): said once, so it is kept at once. The client, which says it, keeps it too.
   */
  private remarked(p: Online, npc: string): void {
    const stats = (p.rec.stats ??= {});
    const told = toldAfter(this.story, npc, stats);
    if (told === (stats.told ?? 0)) return;
    stats.told = told;
    this.saveNow.set(p.rec.id, p.rec);
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
    this.outbox.push({ to: p.rec.id, msg: { t: 'board', lines: [...this.news(now), ...this.parcelLines(p, now)] } });
  }

  /**
   * `id` thanks `who` (thanks.ts): one of the last players who fed the fire on tile x,y of their map (they
   * warm at it), or the painter of the arrow `id` (they stand where it points), from within THANKS_REACH.
   * Once a UTC day for each helper, never oneself. The thanker hears what it did (`did`); the helper, at
   * once if online, or in the letter when they come home.
   */
  thank(id: string, who: string, what: { kind: 'fire'; x: number; y: number } | { kind: 'mark'; id: number }, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    // Steps whose time has come first: the thanks comes from where the player really is.
    this.runQueue(p, now);
    if (this.advance(p, now) <= 0) {
      this.collapse(p, now);
      return this.refuse(p, 'thank', 'too_far');
    }
    const found = who === id ? undefined : this.thankable(p, who, what);
    if (!found) return this.refuse(p, 'thank', 'gone');
    const [nx, ny] = found.near;
    if (Math.max(Math.abs(nx - p.rec.x), Math.abs(ny - p.rec.y)) > THANKS_REACH) return this.refuse(p, 'thank', 'too_far');
    if (!this.giveThanks(p, found.helper, found.what, now)) return this.refuse(p, 'thank', 'thanked');
    this.did(p, { kind: 'thanked', who, name: found.helper.name, what: found.what.kind });
  }

  /** Who a thanks is for (one of the fire's last feeders, or the arrow's painter), what for, and the tile it is given from; undefined when that no longer holds. */
  private thankable(p: Online, who: string, what: { kind: 'fire'; x: number; y: number } | { kind: 'mark'; id: number }): { helper: PersonView; what: Extract<ThanksFor, { kind: 'fire' | 'mark' }>; near: [number, number] } | undefined {
    const map = p.map.data.id;
    if (what.kind === 'fire') {
      const fire = p.zone.fires.at(what.x, what.y), helper = fire?.fed.find(f => f.id === who);
      if (!fire || !helper) return undefined;
      return { helper: { ...helper }, what: { kind: 'fire', map, x: fire.x, y: fire.y }, near: [fire.x, fire.y] };
    }
    const m = this.marks.get(what.id);
    if (!m || recordZone(m) !== p.zone.key || m.owner !== who) return undefined;
    // Thanked by whoever followed it: from the tile it points to.
    const [dx, dy] = DIR_VEC[m.dir];
    return { helper: { id: m.owner, name: m.name }, what: { kind: 'mark', map, x: m.x, y: m.y }, near: [m.x + dx, m.y + dy] };
  }

  /**
   * Records `from`'s thanks to `helper` for `what`, and tells the helper if they are online (deliver);
   * otherwise it waits for their letter home. It counts toward their Good neighbor wherever they are.
   * False, and nothing happens, for oneself or a helper `from` thanked today already.
   */
  private giveThanks(from: Online, helper: PersonView, what: ThanksFor, now: number): boolean {
    const wall = now + this.epochOffset, day = utcDay(wall), key = thanksDay(from.rec.id, helper.id, day);
    if (helper.id === from.rec.id || this.thanks.has(key)) return false;
    const h = this.players.get(helper.id);
    // Someone who blocks the giver hears nothing from them, thanks included, and the giver is not told
    // (nobody learns who blocks them). Blocks are known for players online; the letter leaves out the rest.
    if (h && this.blocks(helper.id).has(from.rec.id)) return true;
    const t: ThanksRecord = { giver: from.rec.id, helper: helper.id, day, at: Math.floor(wall), what: { ...what }, told: false, name: from.rec.name };
    if (h) this.deliver(h, t, now);
    this.thanks.set(key, t);
    this.thanksWrites.set(key, t);
    this.credits.push(helper.id);
    this.thanksForgetAt = Math.min(this.thanksForgetAt, t.at + THANKS_KEPT_MS);
    return true;
  }

  /**
   * A thanks reaches a helper online. Out in the wilds (or a shelter out there) it warms them by
   * THANKS_ENERGY, THANKS_PER_TRIP times a trip at most, and floats over their head; the letter home says
   * what it was for. Anywhere else a line in the text box says it all, and the letter leaves it out.
   */
  private deliver(h: Online, t: ThanksRecord, now: number): void {
    let energy = 0;
    if (!this.wild(h.map)) t.told = true;
    else if (h.gifts < THANKS_PER_TRIP && this.advance(h, now) > 0) {
      // A bar with no room to speak of takes nothing, and the gift is not spent on it.
      const room = Math.min(THANKS_ENERGY, h.max - h.rec.energy);
      if (room >= 0.5) {
        h.rec.energy += room;
        h.gifts++;
        energy = Math.round(room);
      }
    }
    this.outbox.push({ to: h.rec.id, msg: { t: 'thanked', name: t.name, what: { ...t.what }, ...(energy ? { energy } : {}), ...(t.told ? { line: true as const } : {}) } });
    this.count(h, 'thanked', now);
    if (energy) this.tell(h, now);
  }

  /**
   * The player walked into their home room (or is back in the game there): a new trip starts from here,
   * and a letter says who thanked them while they were away, and for what, the most thanked first. What
   * the text box already said, and thanks from someone they block, are left out.
   */
  private homecoming(p: Online, now: number): void {
    p.gifts = 0;
    // Only what is still kept: one older than THANKS_KEPT_DAYS may wait for the tick that forgets it.
    const kept = now + this.epochOffset - THANKS_KEPT_MS;
    const unread = [...this.thanks.values()].filter(t => t.helper === p.rec.id && !t.told && t.at > kept).sort((a, b) => b.at - a.at);
    if (!unread.length) return;
    const blocks = this.blocks(p.rec.id);
    const groups = new Map<string, { group: ThanksGroup; givers: Set<string>; at: number }>();
    for (const t of unread) {
      t.told = true;
      this.thanksWrites.set(thanksDay(t.giver, t.helper, t.day), t);
      if (blocks.has(t.giver)) continue;
      const k = thanksKey(t.what);
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { group: { what: { ...t.what }, count: 0, people: 0, names: [] }, givers: new Set(), at: t.at }));
      g.group.count++;
      if (g.givers.has(t.giver)) continue;
      g.givers.add(t.giver);
      g.group.people++;
      // The latest first: the list is newest first.
      if (g.group.names.length < 2) g.group.names.push(t.name);
    }
    if (!groups.size) return;
    const thanks = [...groups.values()].sort((a, b) => b.group.count - a.group.count || b.at - a.at).map(g => g.group);
    this.outbox.push({ to: p.rec.id, msg: { t: 'letter', thanks } });
  }

  /** Thanks older than THANKS_KEPT_DAYS are forgotten (storage deletes its own: Storage.forgetThanks). */
  private forgetThanks(now: number): void {
    const wall = now + this.epochOffset;
    if (wall < this.thanksForgetAt) return;
    let next = Infinity;
    for (const [k, t] of this.thanks) {
      if (t.at + THANKS_KEPT_MS <= wall) this.thanks.delete(k);
      else next = Math.min(next, t.at + THANKS_KEPT_MS);
    }
    this.thanksForgetAt = next;
  }

  /** Opens the crate on tile x,y (next to the player): they hear what is in it, and what they did at it this visit. Behind steps still waiting, like the chest. */
  openCache(id: string, x: number, y: number, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    if (p.queue.length) p.after = { t: 'cache', x, y };
    else this.lookInCrate(p, x, y, now);
  }

  private lookInCrate(p: Online, x: number, y: number, now: number): void {
    const c = this.crateNextTo(p, x, y);
    if (c) this.sendCache(p, c, now);
  }

  /**
   * Leaves one of what is in bag slot `slot` in the crate on tile x,y next to the player, for whoever comes
   * next: once a visit, never gear (or a tool), and only while the crate has room. A live find put down
   * goes dim, as in a pile. It leaves the player for good: if it came out of their stash, it no longer
   * counts as out. Everyone visiting the crate sees it.
   */
  cacheLeave(id: string, x: number, y: number, slot: number, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    if (this.advance(p, now) <= 0) {
      this.collapse(p, now);
      return this.refuse(p, 'cacheLeave', 'too_far');
    }
    const c = this.crateNextTo(p, x, y);
    if (!c) return this.refuse(p, 'cacheLeave', 'too_far');
    const s = p.rec.bag[slot], def = s && this.items.get(s.item);
    if (!s || !def) return this.refuse(p, 'cacheLeave', 'empty_slot');
    if (!cacheTakes(def)) return this.refuse(p, 'cacheLeave', 'no_gear');
    const visit = this.visitAt(p, c);
    if (visit.left) return this.refuse(p, 'cacheLeave', 'left_one');
    if (c.items.length >= CACHE_SIZE) return this.refuse(p, 'cacheLeave', 'crate_full');
    const item = (def.live && this.items.get(def.live.into)?.id) || def.id;
    p.rec.bag = takeFromBag(p.rec.bag, slot, 1);
    p.rec.stash = usedUp(p.rec.stash ?? emptyStash(), def.id, 1);
    const left: CacheItemRecord = { id: this.nextCacheId++, map: c.map.data.id, ...copyField(c.copy), x: c.x, y: c.y, item, owner: id, name: p.rec.name, at: Math.floor(now + this.epochOffset) };
    c.items.push(left);
    this.cacheWrites.set(left.id, left);
    visit.left = true;
    // Saved now, with the crate's write, not at the next periodic save: a restart in between would
    // otherwise find the thing both in the crate and still in the bag.
    this.saveNow.set(id, p.rec);
    this.sendBag(p, now);
    this.rerate(p, now);
    this.tellVisitors(c, now);
    this.did(p, { kind: 'left', item });
  }

  /**
   * Takes the thing `thing` out of the crate on tile x,y next to the player: once a visit, as far as the
   * bag has room. It counts as taken out of their stash (out), so it earns no XP at home: crates cannot
   * be farmed. It thanks whoever left it (thanks.ts), unless that is the player or they thanked them today.
   */
  cacheTake(id: string, x: number, y: number, thing: number, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    if (this.advance(p, now) <= 0) {
      this.collapse(p, now);
      return this.refuse(p, 'cacheTake', 'too_far');
    }
    const c = this.crateNextTo(p, x, y);
    if (!c) return this.refuse(p, 'cacheTake', 'too_far');
    const visit = this.visitAt(p, c);
    if (visit.took) return this.refuse(p, 'cacheTake', 'took_one');
    const i = c.items.findIndex(e => e.id === thing), e = c.items[i], def = e && this.items.get(e.item);
    if (!e || !def) return this.refuse(p, 'cacheTake', 'gone');
    const r = addToBag(p.rec.bag, def, 1, p.slots);
    if (r.left) return this.refuse(p, 'cacheTake', 'bag_full');
    p.rec.bag = r.bag;
    const stash = p.rec.stash ?? emptyStash();
    p.rec.stash = { ...stash, out: { ...stash.out, [def.id]: (stash.out[def.id] ?? 0) + 1 } };
    c.items.splice(i, 1);
    this.cacheWrites.set(e.id, undefined);
    visit.took = true;
    const mine = e.owner === id;
    const thanked = !mine && this.giveThanks(p, { id: e.owner, name: e.name }, { kind: 'cache', map: c.map.data.id, x: c.x, y: c.y, item: def.id }, now);
    this.saveNow.set(id, p.rec);
    this.sendBag(p, now);
    this.rerate(p, now);
    this.tellVisitors(c, now);
    this.did(p, { kind: 'took', item: def.id, name: e.name, ...(mine ? { mine: true as const } : {}), ...(thanked ? { thanked: true as const } : {}) });
  }

  /** The player's counts toward feats as they are now: the status panel asks when it opens. */
  stats(id: string): void {
    const p = this.players.get(id);
    if (p) this.outbox.push({ to: id, msg: { t: 'stats', stats: { ...p.rec.stats } } });
  }

  // ---------- trades (trade.ts keeps them; this is only what they do to the bags) ----------

  /**
   * Where an online player is: their zone (a copy of a map: two players in two copies of one map, two
   * cabins say, never meet, so they never trade) and their tile.
   */
  where(id: string): { zone: string; x: number; y: number } | undefined {
    const p = this.players.get(id);
    return p && { zone: p.zone.key, x: p.rec.x, y: p.rec.y };
  }

  /** What these picks of an online player's bag offer in a trade (offerFrom): only ever what the bag holds. */
  offerOf(id: string, picks: readonly OfferPick[]): BagSlot[] {
    const p = this.players.get(id);
    return p ? offerFrom(p.rec.bag, picks, this.items) : [];
  }

  /** What of an offer an online player's bag still holds (keptOffer), after it changed. */
  keptOf(id: string, offer: readonly BagSlot[]): BagSlot[] {
    const p = this.players.get(id);
    return p ? keptOffer(p.rec.bag, offer) : [];
  }

  /**
   * Two players trade: what each offers leaves their bag and goes into the other's, in one step, or nothing
   * moves (a bag no longer holds all it offered, or has no room for what it gets after what it gives:
   * swapOffers). What either had taken out of their stash is out for whoever gets it now (traded), so no
   * trade earns XP twice. Both hear their bags and rates; saving them, together, is the caller's.
   */
  swap(aId: string, bId: string, aGives: readonly BagSlot[], bGives: readonly BagSlot[], now: number): Swap {
    const a = this.players.get(aId), b = this.players.get(bId);
    if (!a || !b) return { ok: false, why: 'gone', who: a ? bId : aId };
    // A bar that ran out collapses on this tick: with its bag, so nothing is handed over by someone who is falling.
    for (const p of [a, b]) if (this.advance(p, now) <= 0) return { ok: false, why: 'gone', who: p.rec.id };
    const r = swapOffers(a.rec.bag, b.rec.bag, aGives, bGives, a.slots, b.slots, this.items);
    if (!r.ok) return { ok: false, why: r.why, who: r.side === 'a' ? aId : bId };
    a.rec.bag = r.a;
    b.rec.bag = r.b;
    [a.rec.stash, b.rec.stash] = traded(a.rec.stash ?? emptyStash(), b.rec.stash ?? emptyStash(), r.aGave, r.bGave);
    for (const p of [a, b]) {
      this.sendBag(p, now);
      this.rerate(p, now);
    }
    return { ok: true, aGave: r.aGave, bGave: r.bGave };
  }

  /**
   * Brings everyone's energy up to `now` (whoever ran out collapses), starts queued steps whose time
   * has come and repeats the energy of players whose bar is moving; the sky, the surges and the Old
   * Stone move on, watchers walk, piles and marks whose time is over fade and finds whose time has
   * come grow. Call it often (every TICK_MS).
   */
  tick(now: number): void {
    const wall = now + this.epochOffset;
    this.tickAt = now;
    // A copy nobody is in costs nothing from here on (its piles and marks stay, and so does storage's copy of them).
    this.closeEmptied();
    if (this.cycle) this.setWeather(weatherAt(wall).weather, now);
    this.moveSurges(now);
    this.moveStorms(now);
    this.moveConditions(now);
    this.moveCalendar(now);
    this.startFlashes(now);
    this.afterglows(now);
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
      this.surged(p, now);
      this.hitch(p, now);
      this.notice(p, now);
      this.rerate(p, now);
      // The client counts on with the rates it heard; repeating the values keeps it from drifting.
      if (now - p.heardAt >= ENERGY_SYNC_MS && changing(p)) this.tell(p, now);
    }
    this.walkWatchers(now);
    this.walkSkulkers(now);
    for (const z of this.zones.values()) {
      if (z.flares.length) z.flares = z.flares.filter(f => f.until > now);
      if (z.flashes.length) z.flashes = z.flashes.filter(f => f.until > now);
    }
    for (const [id, readyAt] of this.resting) if (readyAt <= now) this.resting.delete(id);
    this.fadePiles(now);
    this.fadeMarks(now);
    this.forgetThanks(now);
    this.growFinds(now);
  }

  /** Changes the weather everywhere. Energy rates follow: bad weather drains faster, and rain soaks. */
  setWeather(weather: Weather, now: number): void {
    if (weather === this.sky) return;
    const aurora = weather === 'aurora' || this.sky === 'aurora';
    this.sky = weather;
    for (const z of this.zones.values()) if (z.players.size) this.outbox.push({ to: '*', map: z.key, msg: { t: 'weather', weather } });
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
      thanks: [...this.thanksWrites.values()].map(t => ({ ...t, what: { ...t.what } })),
      credits: this.credits,
      caches: [...this.cacheWrites].map(([id, c]) => ({ id, item: c && { ...c } })),
    };
    this.pileWrites.clear();
    this.saveNow.clear();
    this.markWrites.clear();
    this.stoneWrite = undefined;
    this.thanksWrites.clear();
    this.credits = [];
    this.cacheWrites.clear();
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
      else if (t === 'board') this.readBoard(p, x, y, now);
      else if (t === 'chest') this.openChest(p, x, y);
      else if (t === 'bench') this.openBench(p, x, y);
      else this.lookInCrate(p, x, y, now);
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
    this.toZone(p.zone.key, { t: 'step', id, x, y, dir }, id);
    if (p.map.data.kind === 'wilds') {
      p.trail.push([x, y]);
      if (p.trail.length > TRAIL_STEPS) p.trail.shift();
      // The pack mule counts what the bag really weighs: a feel made lighter by its own ranks or a charm
      // must not slow the count toward its next rank.
      const real = bagLoad(p.rec.bag, this.items);
      for (const stat of STEP_STATS) if (stepCounts(stat, p.map, x, y, this.sky, real)) this.count(p, stat, now);
    }
    const exit = p.map.exitAt(x, y);
    if (exit) this.cross(p, exit, now);
    else {
      this.rerate(p, now);
      this.revisit(p);
    }
  }

  /** Refuses step `seq`, telling the mover where they really are. */
  private reject(p: Online, seq: number): void {
    const { id, x, y, dir } = p.rec;
    this.outbox.push({ to: id, msg: { t: 'reject', seq, x, y, dir } });
  }

  /**
   * The player stepped onto an exit and goes on to the other map at once, into the copy of it copyFor
   * decides. readyAt stays as it is, so changing maps never lets anyone walk faster.
   */
  private cross(p: Online, to: Arrival, now: number): void {
    const from = p.zone, map = this.maps.get(to.to)!;
    this.place(p, this.zoneFor(map, this.copyFor(p.rec, map), now), to.x, to.y, to.dir);
    this.arrive(p, from, 'exit', now);
    this.moveStory(p, { reach: map.data.id });
    // Home, whichever copy of it (their own cabin): the letter waits there.
    if (this.homes.has(map.data.id)) this.homecoming(p, now);
  }

  /**
   * The copy of `map` a player walks into (an exit, or waking up at home): the one place that decides
   * it, so what comes (crowded places splitting into copies, streets) changes only this. `player` is as
   * they are before they go: where they come from. A private room (the home) is each player's own copy of
   * it, keyed by them, where nobody else ever is; every other map has only its main copy, the world
   * everyone shares.
   */
  protected copyFor(player: PlayerRecord, map: TileMap): string {
    return map.data.private ? player.id : '';
  }

  /**
   * The copy of `map` a player comes back into when they join: their own, always, in a private room;
   * elsewhere the one they were saved in if it still makes sense (it is open: someone is in it), else
   * the main copy.
   */
  private rejoin(r: PlayerRecord, map: TileMap): string {
    if (map.data.private) return this.copyFor(r, map);
    const copy = typeof r.zone === 'string' ? r.zone : '';
    return copy && this.zones.has(zoneKey(map.data.id, copy)) ? copy : '';
  }

  /** Out of energy while online: the player wakes up at home, and both zones see it. */
  private collapse(p: Online, now: number): void {
    const from = p.zone;
    this.fall(p, now);
    this.arrive(p, from, 'collapse', now);
    // Woken up in the home (their cabin), they are home as if they had walked in: the letter is there.
    if (this.homes.has(p.map.data.id)) this.homecoming(p, now);
  }

  /**
   * Out of energy: what the player carries falls out where they are, and they wake up at home (by the
   * fire in their own cabin, where the home is theirs) with a full bar, dry and alone.
   */
  private fall(p: Online, now: number): void {
    const { id, map, x, y } = p.rec;
    this.dropBag(p, now);
    const w = this.wakeUp;
    this.place(p, this.zoneFor(w.map, this.copyFor(p.rec, w.map), now), w.x, w.y, w.dir);
    p.rec.energy = this.maxOf(p.rec);
    p.rec.wet = 0;
    p.hitched = false;
    p.afterglowUntil = undefined;
    // They wake up at home: the next time out is a new trip.
    p.gifts = 0;
    p.fellAt = now;
    this.collapses = this.collapses.filter(c => now - c.at < COLLAPSES_MS);
    this.collapses.push({ map, at: now });
    // Mira has a word for the first one (story.ts, remarks); the zone that follows carries the count too.
    this.count(p, 'collapsed', now);
    this.onCollapse?.(id, { map, x, y });
  }

  /**
   * The player's bag (or only its slot `slot`, when a skulker catches them) becomes their pile on the
   * tile where they stand, in the zone they are in, and their old pile is gone: each player has at most
   * one. With nothing in the bag, only the old pile goes. Only a collapse leaves an echo.
   */
  private dropBag(p: Online, now: number, slot?: number): void {
    const { id, name, map, x, y, bag } = p.rec;
    const old = this.piles.get(id);
    if (old) this.removePile(old);
    if (!bag.length) return;
    const trail = p.map.data.kind === 'wilds' && slot === undefined ? p.trail.map(([tx, ty]) => [tx, ty] as [number, number]) : [];
    const falls = slot === undefined ? bag : [bag[slot]!];
    // Put down, a live find goes dim for good. A carried piece of gear falls in as it is.
    const items = gather(falls.map(s => {
      const into = this.items.get(s.item)?.live?.into;
      return into ? { item: into, count: s.count } : s;
    }));
    const pile: DropRecord = { owner: id, name, map, ...copyField(p.zone.copy), x, y, items, droppedAt: Math.floor(now + this.epochOffset), trail };
    this.addPile(pile);
    this.pileWrites.set(id, pile);
    this.toZone(p.zone.key, { t: 'drop', drop: dropView(pile) });
    p.rec.bag = slot === undefined ? [] : bag.filter((_, i) => i !== slot);
    this.sendBag(p, now);
    this.saveNow.set(id, p.rec);
  }

  /**
   * Puts a player on a tile of a zone. Queued steps go: they were planned on the old map, and so do the
   * talk or look waiting behind them (it was about something there) and the trail. The record says the
   * copy they are in (none for a main copy), so they come back into it if it still makes sense (rejoin).
   */
  private place(p: Online, zone: Zone, x: number, y: number, dir: Dir): void {
    this.quit(p);
    zone.players.add(p);
    p.zone = zone;
    p.map = zone.map;
    p.rec.map = zone.map.data.id;
    if (zone.copy) p.rec.zone = zone.copy;
    else delete p.rec.zone;
    p.rec.x = x;
    p.rec.y = y;
    p.rec.dir = dir;
    p.queue.length = 0;
    p.after = undefined;
    p.trail = [];
    this.revisit(p);
  }

  /**
   * Tells everyone about a zone change that just happened: the old zone sees the player leave, the new
   * one sees them join, and the player hears where they are, who and what is there, and their energy.
   * Their `zone` message names the map alone, whichever copy of it they are in.
   */
  private arrive(p: Online, from: Zone, reason: 'exit' | 'collapse', now: number): void {
    const { id, x, y, dir } = p.rec;
    const here = p.zone.key;
    this.toZone(from.key, { t: 'leave', id }, id);
    this.toZone(here, { t: 'join', player: this.viewOf(p) }, id);
    this.outbox.push({
      to: id,
      msg: { t: 'zone', map: mapRef(p.map), x, y, dir, players: this.views(here), ...this.scene(here, now), stats: { ...p.rec.stats }, reason },
      // Where the network hears them from now on, when it is not the map's main copy (its key is the map's id).
      ...(p.zone.copy ? { zone: here } : {}),
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
    const warmth = p.map.warm(x, y) ? p.zone.fires.warmth(x, y, now) : 0;
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
      flash: p.zone.flashes.find(f => flashHits(flashView(f, now), x, y))?.kind,
      resist,
      farDrain: p.mods.farDrain,
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

  /** Out in the wilds, what the player wears wears down: `dt` seconds of it, slower for a mender. The rates follow on the next refresh. */
  private wearDown(p: Online, dt: number): void {
    const worn = p.rec.worn;
    if (!worn) return;
    for (const slot of SLOTS) {
      const piece = worn[slot], s = wearSeconds(p.rec.gear?.[slot] ? this.items.get(p.rec.gear[slot]!) : undefined, this.wearTimes, piece?.level);
      if (piece && s && piece.cond > 0) piece.cond = Math.max(0, piece.cond - (dt * p.mods.wear) / s);
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

  /**
   * Something the player picked up, read or lived through, for their field notes (notebook.ts): a page
   * may open, a blank on an open page fill in. Theirs for good: they hear it, and it is saved at once.
   */
  private note(p: Online, event: NotebookEvent): void {
    const r = noted(this.notebook, p.rec.notebook ?? emptyNotebook(), event);
    if (!r) return;
    p.rec.notebook = r.state;
    this.saveNow.set(p.rec.id, p.rec);
    for (const page of r.pages) this.outbox.push({ to: p.rec.id, msg: { t: 'page', id: page.id } });
    for (const blank of r.blanks) this.outbox.push({ to: p.rec.id, msg: { t: 'blank', id: blank.id } });
  }

  private saw(p: Online, sight: Sight): void {
    this.note(p, { saw: sight });
  }

  /** A find picked up, for the field notes: its kind, and when it was picked up, on an aurora night or in a storm. */
  private found(p: Online, item: string, now: number): void {
    this.note(p, { find: item });
    if (this.sky === 'aurora') this.note(p, { find: item, during: 'aurora' });
    if (this.stormOf(p.map, now)?.phase === 'storm') this.note(p, { find: item, during: 'storm' });
  }

  /**
   * What the player lives through where they stand, for their field notes: a surge they sheltered from
   * (and a street light that stopped its drain), a storm out in it or under a roof, a flash bursting under
   * them, an aurora night out there and the wires humming by a pole, a watcher within sight (and frozen by
   * their look), and something hunting near while they hide in tall grass.
   */
  private notice(p: Online, now: number): void {
    const { x, y } = p.rec, map = p.map, inside = map.data.kind === 'inside';
    const region = inside ? this.around.get(map.data.id) : map;
    if (region?.data.kind === 'wilds') {
      const front = this.frontOf(region, now), door = inside ? map.data.exits[0] : undefined;
      // Under a roof the surge has reached the door; under a street light, the tile.
      if (front !== undefined && (door ? region.homeSteps(door.tx, door.ty) : map.homeSteps(x, y)) >= front && (inside || map.lit(x, y))) {
        this.saw(p, 'surge');
        if (!inside && p.surgedIn === this.surgeRound(map, now)) this.saw(p, 'lit');
      }
      if (this.stormOf(map, now)?.phase === 'storm') this.saw(p, inside ? 'roof' : 'storm');
    }
    if (inside) return;
    if (this.sky === 'aurora') {
      if (map.data.kind === 'wilds') this.saw(p, 'aurora');
      if (this.polesOf(map).some(([px, py]) => Math.hypot(px - x, py - y) <= HUM_NEAR)) this.saw(p, 'hum');
    }
    if (map.data.kind !== 'wilds') return;
    if (p.zone.flashes.some(f => flashHits(flashView(f, now), x, y))) this.saw(p, 'burst');
    for (const w of p.zone.watchers) {
      if (!w.awake || Math.hypot(w.x - x, w.y - y) > SEEN_TILES) continue;
      this.saw(p, 'watcher');
      if (faces(x, y, p.rec.dir, w.x, w.y)) this.saw(p, 'froze');
    }
    if (hidden(map, x, y) && this.exposed(p, now) && this.hunted(p)) this.saw(p, 'hidden');
  }

  /** Something awake in the player's zone that would come for them were they not hidden: a watcher within its reach, a skulker within earshot. */
  private hunted(p: Online): boolean {
    const { x, y } = p.rec;
    return p.zone.watchers.some(w => w.awake && manhattan(w.x, w.y, x, y) <= (p.live ? WATCHER_HUNT_LIVE : WATCHER_HUNT))
      || p.zone.skulkers.some(s => s.awake && manhattan(s.x, s.y, x, y) <= SKULKER_HEAR);
  }

  /** A map's poles (their tiles), found once. */
  private polesOf(map: TileMap): Array<[number, number]> {
    let at = this.poles.get(map.data.id);
    if (!at) this.poles.set(map.data.id, (at = map.data.objects.flatMap(o => (o.kind === 'pole' ? [[o.x, o.y] as [number, number]] : []))));
    return at;
  }

  /**
   * A skulker's chase ended without a catch: its prey got out of it, unless they collapsed meanwhile. At
   * the edge of the tall grass they reached, the chase ended there.
   */
  private escaped(s: Skulker): void {
    const p = s.chasing === undefined ? undefined : this.players.get(s.chasing);
    if (!p || (p.fellAt ?? -Infinity) >= s.chaseUntil - SKULKER_CHASE_MS) return;
    this.saw(p, 'escaped');
    if (p.zone === s.zone && hidden(p.map, p.rec.x, p.rec.y)) this.saw(p, 'grass');
  }

  /**
   * `by` more (one, unless said) of what counts toward a feat, or toward what people say once (a
   * collapse, a surge, gear made). A new rank is the player's for good: they hear it (once: counts only
   * go up), and it is saved at once.
   */
  private count(p: Online, stat: Exclude<(typeof STATS)[number], 'told'>, now: number, by = 1): void {
    const stats = (p.rec.stats ??= {});
    const n = (stats[stat] ?? 0) + by;
    stats[stat] = n;
    const feat = featOf(stat);
    // A count no feat has (a collapse, a surge, gear made) comes seldom, and what people say waits on it: saved
    // at once, and the player hears it at once. The text box shows a remark by what the client knows, and the
    // server keeps it said by what it knows: a count still on its way would lose a remark heard on the same map.
    if (!feat) {
      this.outbox.push({ to: p.rec.id, msg: { t: 'stats', stats: { ...stats } } });
      return void this.saveNow.set(p.rec.id, p.rec);
    }
    const rank = rankOf(feat, n);
    if (rank === rankOf(feat, n - by)) return;
    this.outbox.push({ to: p.rec.id, msg: { t: 'feat', id: feat.id, rank, stats: { ...stats } } });
    this.saveNow.set(p.rec.id, p.rec);
    // The rank changes the rates right away, however little: the player hears them.
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

  /**
   * Caught by a surge out in the wilds (its front has passed their tile, and no street light shelters
   * them): counted once for each surge, for what Mira says after the first (story.ts, remarks).
   */
  private surged(p: Online, now: number): void {
    const round = this.surgeRound(p.map, now);
    if (!round || !inSurge(p.map, p.rec.x, p.rec.y, this.frontOf(p.map, now))) return;
    if (p.surgedIn === round) return;
    p.surgedIn = round;
    this.count(p, 'surged', now);
  }

  /** Which of a region's surges it is now, by map and round (none for a map that never surges). */
  private surgeRound(map: TileMap, now: number): string | undefined {
    const rule = map.data.kind === 'wilds' ? map.data.surge : undefined;
    return rule && `${map.data.id}:${Math.floor(((now + this.epochOffset) / 1000 + (rule.offset ?? 0)) / rule.every)}`;
  }

  /** Tells each surging map (every copy of it) when its phase changes, and grows (or clears away) the finds of restless times. */
  private moveSurges(now: number): void {
    for (const map of this.maps.values()) {
      const s = this.surgeOf(map, now);
      if (!s || this.surgePhase.get(map.data.id) === s.phase) continue;
      const first = !this.surgePhase.has(map.data.id);
      this.surgePhase.set(map.data.id, s.phase);
      if (!first) this.toCopies(map.data.id, { t: 'surge', surge: s });
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

  /** Tells each storming map (every copy of it) when its phase changes, and grows (or clears away) the finds a storm leaves. */
  private moveStorms(now: number): void {
    for (const map of this.maps.values()) {
      const s = this.stormOf(map, now);
      if (!s || this.stormPhase.get(map.data.id) === s.phase) continue;
      const first = !this.stormPhase.has(map.data.id);
      this.stormPhase.set(map.data.id, s.phase);
      if (!first) this.toCopies(map.data.id, { t: 'storm', storm: s });
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
    for (const [mapId, base] of this.baseLairs) {
      const here = on.filter(c => c.map === mapId && c.watchers);
      const asleep = here.some(c => c.watchers!.asleep);
      const moved = here.find(c => this.conditionLairs.has(c.id));
      const lairs = moved ? this.conditionLairs.get(moved.id)! : base;
      if (asleep) this.asleep.add(mapId);
      else this.asleep.delete(mapId);
      this.lairsNow.set(mapId, lairs);
      const allowed = new Set(lairs);
      for (const zone of this.copiesOf(mapId)) for (const w of zone.watchers) {
        w.lairs = lairs;
        if (w.awake && (asleep || !allowed.has(w.y * w.map.width + w.x))) this.sendAway(w, now);
      }
    }
    if (!newDay) return;
    this.doused = [];
    for (const c of on) if (c.fireOut && daily.has(c.id)) this.fireOut(c.map, day, now);
  }

  /**
   * When the calendar day turns (midnight UTC), whoever plays signed in gets the new day's parcel at
   * once, and hears their stash: the chest or the workbench may be open.
   */
  private moveCalendar(now: number): void {
    if (!this.parcels) return;
    const day = calendarDay(now + this.epochOffset, this.calendar);
    if (day === this.calendarAt) return;
    this.calendarAt = day;
    for (const p of this.players.values()) {
      if (!this.giveParcel(p, now)) continue;
      this.sendStash(p);
      this.outbox.push({ to: p.rec.id, msg: { t: 'bench', stash: stashList(p.rec.stash ?? emptyStash(), this.itemOrder) } });
    }
  }

  /**
   * The parcel due to a player who plays signed in, if one is (parcels.ts): into their stash, never the
   * bag, as a gift that earns no XP (it was not brought home). Saved at once, and they hear what came.
   * True when one did.
   */
  private giveParcel(p: Online, now: number): boolean {
    if (!this.parcels || !this.signedIn(p)) return false;
    const next = nextParcel(this.parcels, p.rec.parcels, calendarDay(now + this.epochOffset, this.calendar));
    if (!next) return false;
    const { parcel } = next;
    p.rec.parcels = next.state;
    p.rec.stash = fitPieces(gift(p.rec.stash ?? emptyStash(), [...parcel.items, ...(parcel.allWeek ?? [])], this.items), this.items, this.rng);
    this.saveNow.set(p.rec.id, p.rec);
    this.outbox.push({ to: p.rec.id, msg: { t: 'parcel', parcel } });
    return true;
  }

  /** Signed in, on a server with sign-in: the parcels are for them. A guest's wait for sign-in, and without sign-in nobody has any. */
  private signedIn(p: Online): boolean {
    return this.guests && p.rec.authSub !== null;
  }

  /**
   * One untended fire on the map (or in its shelters) goes out, the same one for everyone that day: in
   * every copy of its map, and in a copy that opens later that day too (openZone).
   */
  private fireOut(mapId: string, day: number, now: number): void {
    const fires = [...this.maps.values()].flatMap(m => this.main(m).fires.all())
      .filter(f => !f.tended && (f.map.data.id === mapId || this.around.get(f.map.data.id)?.data.id === mapId))
      .sort((a, b) => a.map.data.id.localeCompare(b.map.data.id) || a.x - b.x || a.y - b.y);
    const f = fires[Math.floor(seeded(day)() * fires.length)];
    if (!f) return;
    this.doused.push({ map: f.map.data.id, x: f.x, y: f.y });
    for (const zone of this.copiesOf(f.map.data.id)) {
      const here = zone.fires.at(f.x, f.y)!;
      zone.fires.douse(here, now);
      this.toZone(zone.key, { t: 'fire', fire: zone.fires.view(here, now) });
    }
  }

  /**
   * Every so often in each zone of a map with flashes, a patch of ground starts to glow near someone out
   * in the open there at the rule's distance from home, often right under them: they have FLASH_GLOW_S to step out.
   */
  private startFlashes(now: number): void {
    for (const zone of this.zones.values()) {
      const map = zone.map, rule = map.data.kind === 'wilds' ? map.data.flashes : undefined;
      if (!rule) continue;
      const at = zone.nextFlash;
      if (at === undefined || now < at) {
        if (at === undefined) zone.nextFlash = now + rule.every * 1000;
        continue;
      }
      zone.nextFlash = now + rule.every * 1000;
      const out = [...zone.players].filter(p => {
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
      const flash: Flash = { x, y, kind: this.rng() < 0.5 ? 'spark' : 'fire', until: now + (FLASH_GLOW_S + FLASH_BURST_S) * 1000 };
      zone.flashes.push(flash);
      this.toZone(zone.key, { t: 'flash', flash: flashView(flash, now) });
      for (const q of zone.players) if (Math.hypot(q.rec.x - x, q.rec.y - y) <= FLASH_NEAR) this.saw(q, 'flash');
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

  /** Adds `charge` shards to the Old Stone; true when that woke it. */
  private chargeStone(charge: number, now: number): boolean {
    this.burnStone(now);
    this.stoneCharge += charge;
    const woke = !this.stoneAwake && this.stoneCharge >= STONE_NEED;
    if (woke) this.stoneAwake = true;
    this.stoneWrite = { charge: this.stoneCharge, awake: this.stoneAwake, at: now + this.epochOffset };
    this.outbox.push({ to: 'all', msg: { t: 'stone', stone: this.stoneView(now) } });
    if (woke) for (const p of this.players.values()) {
      this.rerate(p, now);
      this.saw(p, 'woke');
    }
    return woke;
  }

  // ---------- hitchhikers, flares, marks ----------

  /** In the dark, deep in and away from light, something may cling to you; light, a fire or a roof shakes it off. */
  private hitch(p: Online, now: number): void {
    const dt = Math.max(0, now - p.hitchAt) / 1000;
    p.hitchAt = now;
    const { x, y } = p.rec;
    const safe = p.map.data.kind !== 'wilds' || p.map.lit(x, y) || (p.map.warm(x, y) && p.zone.fires.warmth(x, y, now) > 0);
    if (p.hitched) {
      if (safe || this.nearFlare(p.zone, x, y, now)) this.unhitch(p);
      return;
    }
    const dark = this.sky === 'night' || this.sky === 'aurora';
    if (safe || !dark || p.map.homeSteps(x, y) < HITCH_STEPS || this.nearFlare(p.zone, x, y, now)) return;
    if (this.rng() < 1 - Math.exp((-dt / HITCH_EVERY_S) * p.mods.hitch)) {
      p.hitched = true;
      this.outbox.push({ to: p.rec.id, msg: { t: 'hitch', on: true } });
      this.saw(p, 'hitched');
    }
  }

  /** What clings to the player lets go: a street light, a fire, a roof or a flare (a collapse takes it off without a word). */
  private unhitch(p: Online): void {
    p.hitched = false;
    this.outbox.push({ to: p.rec.id, msg: { t: 'hitch', on: false } });
    this.saw(p, 'let-go');
  }

  /** Is a flare burning in `zone` within reach of tile x,y? */
  private nearFlare(zone: Zone, x: number, y: number, now: number): boolean {
    return zone.flares.some(f => f.until > now && Math.hypot(f.x - x, f.y - y) <= FLARE_RADIUS);
  }

  /** A flare where the player stands, in their zone: whatever clings to them lets go, and creatures nearby slink off. */
  private light(p: Online, seconds: number, now: number): void {
    const { x, y } = p.rec, zone = p.zone;
    zone.flares.push({ x, y, until: now + seconds * 1000 });
    this.toZone(zone.key, { t: 'flare', flare: { x, y, left: seconds } });
    if (p.hitched) this.unhitch(p);
    for (const w of [...zone.watchers, ...zone.skulkers]) if (w.awake && Math.hypot(w.x - x, w.y - y) <= FLARE_RADIUS + 3) this.sendAway(w, now);
  }

  /**
   * An arrow on the player's tile, in their zone, pointing where they face, for a day (longer for a good
   * neighbor: markLifetime). Their oldest goes when they have too many.
   */
  private paint(p: Online, now: number): void {
    const { id, name, color, map, x, y, dir } = p.rec;
    const mine = [...this.marks.values()].filter(m => m.owner === id).sort((a, b) => a.placedAt - b.placedAt);
    for (const m of mine.slice(0, Math.max(0, mine.length - MARKS_PER_PLAYER + 1))) this.removeMark(m);
    const placedAt = Math.floor(now + this.epochOffset);
    const mark: MarkRecord = { id: this.nextMarkId++, owner: id, name, color, map, ...copyField(p.zone.copy), x, y, dir, placedAt, until: placedAt + markLifetime(p.mods) };
    this.addMark(mark);
    this.markWrites.set(mark.id, mark);
    this.toZone(p.zone.key, { t: 'mark', mark: markView(mark) });
  }

  private restoreMark(m: MarkRecord): void {
    const map = this.maps.get(m.map);
    if (!map || !map.inside(m.x, m.y) || this.markTiles.get(recordZone(m))?.has(m.y * map.width + m.x)) return;
    this.addMark({ ...m });
    this.nextMarkId = Math.max(this.nextMarkId, m.id + 1);
  }

  private addMark(m: MarkRecord): void {
    this.marks.set(m.id, m);
    tilesOf(this.markTiles, recordZone(m)).set(m.y * this.maps.get(m.map)!.width + m.x, m);
    this.markFadeAt = Math.min(this.markFadeAt, markUntil(m) - this.epochOffset);
  }

  /** A mark goes (faded, or its painter's oldest): everyone in its zone hears it, and storage forgets it. */
  private removeMark(m: MarkRecord): void {
    const key = recordZone(m), tiles = this.markTiles.get(key)!;
    this.marks.delete(m.id);
    tiles.delete(m.y * this.maps.get(m.map)!.width + m.x);
    if (!tiles.size) this.markTiles.delete(key);
    this.markWrites.set(m.id, undefined);
    this.toZone(key, { t: 'markGone', id: m.id });
  }

  private fadeMarks(now: number): void {
    if (now < this.markFadeAt) return;
    const wall = now + this.epochOffset;
    for (const m of [...this.marks.values()]) if (wall >= markUntil(m)) this.removeMark(m);
    this.markFadeAt = [...this.marks.values()].reduce((at, m) => Math.min(at, markUntil(m) - this.epochOffset), Infinity);
  }

  // ---------- watchers ----------

  /** Where a watcher may stand: what the map allows any creature (open ground out of the light, away from fires and exits, never in tall grass). */
  private watcherMayStand(map: TileMap, x: number, y: number): boolean {
    return map.creatureMayStand(x, y);
  }

  /**
   * Each watcher that may step, zone by zone: wakes up where nobody is, or freezes while someone in its
   * zone faces it, or takes one step toward the nearest player out of the light; reaching one, it takes
   * energy and something they carry, and goes away for a while. Players in other copies of its map are
   * nothing to it.
   */
  private walkWatchers(now: number): void {
    const every = this.sky === 'aurora' ? AURORA_WATCHER_STEP_MS : WATCHER_STEP_MS;
    for (const zone of this.zones.values()) {
      if (!zone.watchers.length || this.asleep.has(zone.map.data.id)) continue;
      for (const w of zone.watchers) {
        // Asked again for each watcher: another one's touch may have just sent someone home.
        const here = [...zone.players];
        if (!w.awake) {
          if (now >= w.wakeAt) this.wake(w, here, now);
          continue;
        }
        if (now < w.readyAt) continue;
        w.readyAt = now + every;
        const map = w.map;
        if (this.nearFlare(zone, w.x, w.y, now)) {
          this.sendAway(w, now);
          continue;
        }
        // Anyone who faces it holds it still, prey or not: a friend can keep watch.
        if (here.some(p => manhattan(p.rec.x, p.rec.y, w.x, w.y) <= WATCHER_SEE && faces(p.rec.x, p.rec.y, p.rec.dir, w.x, w.y))) continue;
        // An afterglow keeps them off: whoever glows with it is nobody's prey.
        const prey = here
          .filter(p => p.rec.energy > 0 && this.noticeable(p, now) && !this.glowing(p, now) && manhattan(p.rec.x, p.rec.y, w.x, w.y) <= (p.live ? WATCHER_HUNT_LIVE : WATCHER_HUNT))
          .sort((a, b) => manhattan(a.rec.x, a.rec.y, w.x, w.y) - manhattan(b.rec.x, b.rec.y, w.x, w.y))[0];
        if (!prey) continue;
        const next = pathStep(map, w.x, w.y, prey.rec.x, prey.rec.y, (x, y) => this.watcherMayStand(map, x, y) && !this.nearFlare(zone, x, y, now) && !this.creatureAt(zone, x, y));
        if (next) {
          w.dir = dirTo(next.x - w.x, next.y - w.y) ?? w.dir;
          w.x = next.x;
          w.y = next.y;
          this.toZone(zone.key, { t: 'creature', creature: creatureView(w) });
        }
        if (manhattan(prey.rec.x, prey.rec.y, w.x, w.y) <= 1) this.touch(w, prey, now);
      }
    }
  }

  /** How far a skulker hears someone walking: less far when their gear hushes their steps. */
  private heardFrom(p: Online): number {
    return quirksOf(p.rec.worn).includes('hush') ? SKULKER_HEAR_HUSHED : SKULKER_HEAR;
  }

  /** Their afterglow is on: they glow faintly, and watchers keep off them. */
  private glowing(p: Online, now: number): boolean {
    return p.afterglowUntil !== undefined && now < p.afterglowUntil;
  }

  /**
   * Afterglows (a quirk, gear.ts): a flash discharging within AFTERGLOW_NEAR tiles of someone whose gear has
   * it leaves them glowing for AFTERGLOW_S, once for each flash (a second flash starts it again). Everyone in
   * their zone hears it start and end.
   */
  private afterglows(now: number): void {
    for (const zone of this.zones.values()) {
      for (const f of zone.flashes) {
        if (f.until <= now || (f.until - now) / 1000 > FLASH_BURST_S) continue;
        for (const p of zone.players) {
          if (f.glowed?.has(p.rec.id) || Math.hypot(f.x - p.rec.x, f.y - p.rec.y) > AFTERGLOW_NEAR || !quirksOf(p.rec.worn).includes('afterglow')) continue;
          (f.glowed ??= new Set()).add(p.rec.id);
          p.afterglowUntil = now + AFTERGLOW_S * 1000;
          this.toZone(zone.key, { t: 'afterglow', id: p.rec.id, left: AFTERGLOW_S });
        }
      }
    }
    for (const p of this.players.values()) {
      if (p.afterglowUntil === undefined || now < p.afterglowUntil) continue;
      p.afterglowUntil = undefined;
      this.toZone(p.zone.key, { t: 'afterglow', id: p.rec.id, left: 0 });
    }
  }

  /** Out in the open: not by a burning fire, not in a street light, not near a flare. A flash still finds you in tall grass. */
  private exposed(p: Online, now: number): boolean {
    const { x, y } = p.rec;
    if (p.map.lit(x, y) || this.nearFlare(p.zone, x, y, now)) return false;
    return !(p.map.warm(x, y) && p.zone.fires.warmth(x, y, now) > 0);
  }

  /** Whom creatures notice and go after: someone out in the open, and not hidden in tall grass. */
  private noticeable(p: Online, now: number): boolean {
    return this.exposed(p, now) && !hidden(p.map, p.rec.x, p.rec.y);
  }

  private wake(w: Watcher, here: Online[], now: number): void {
    const W = w.map.width;
    const far = w.lairs.filter(t => !this.creatureAt(w.zone, t % W, Math.floor(t / W)) && here.every(p => manhattan(p.rec.x, p.rec.y, t % W, Math.floor(t / W)) >= WATCHER_WAKE_AWAY));
    if (!far.length) {
      w.wakeAt = now + 10_000;
      return;
    }
    const t = far[this.roll(far.length)]!;
    w.x = t % w.map.width;
    w.y = Math.floor(t / w.map.width);
    w.awake = true;
    w.readyAt = now + WATCHER_STEP_MS;
    this.toZone(w.zone.key, { t: 'creature', creature: creatureView(w) });
  }

  /** A creature goes away for a while; a skulker that chased someone and did not catch them (`caught`) lets them get away. */
  private sendAway(w: Watcher, now: number, caught = false): void {
    if (w.kind === 'skulker' && w.chasing !== undefined && !caught) this.escaped(w as Skulker);
    const [soonest, latest] = WATCHER_AWAY_S;
    w.awake = false;
    w.chasing = undefined;
    w.wakeAt = now + (soonest + this.rng() * (latest - soonest)) * 1000;
    this.toZone(w.zone.key, { t: 'creatureGone', id: w.id });
  }

  /** A watcher reached a player: energy lost, one thing they carried taken (at random), and it goes away. */
  private touch(w: Watcher, p: Online, now: number): void {
    this.sendAway(w, now);
    const units = p.rec.bag.flatMap((s, slot) => Array.from({ length: s.count }, () => slot));
    let lost: string | null = null, level = 0;
    if (units.length) {
      const slot = units[this.roll(units.length)]!;
      lost = p.rec.bag[slot]!.item;
      level = p.rec.bag[slot]!.piece?.level ?? 0;
      p.rec.bag = takeFromBag(p.rec.bag, slot, 1);
      p.rec.stash = usedUp(p.rec.stash ?? emptyStash(), lost, 1);
      this.sendBag(p, now);
      this.saveNow.set(p.rec.id, p.rec);
    }
    this.advance(p, now);
    p.rec.energy = Math.max(0, p.rec.energy - WATCHER_TOUCH);
    this.outbox.push({ to: p.rec.id, msg: { t: 'touched', by: 'watcher', lost, ...(level ? { level } : {}) } });
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
   * Each skulker that may step, zone by zone: out of its time it sinks into the ferns; awake, it lies
   * still in its lair until it hears someone walking or sees someone standing near, out in the open in its
   * zone; then it chases them until it catches them or gives up (the time is over, they reached light, a
   * fire or tall grass, they left the zone, or its range ends), and goes back to its lair.
   */
  private walkSkulkers(now: number): void {
    for (const zone of this.zones.values()) {
      for (const s of zone.skulkers) {
        const map = s.map;
        if (!this.skulkersOut(map, s.rule, now)) {
          if (s.awake) this.sendAway(s, now);
          continue;
        }
        // Asked again for each skulker: another one's catch may have just sent someone home.
        const here = [...zone.players];
        if (!s.awake) {
          if (now >= s.wakeAt) this.wake(s, here, now);
          if (s.awake) s.lair = s.y * map.width + s.x;
          continue;
        }
        if (now < s.readyAt) continue;
        s.readyAt = now + SKULKER_STEP_MS;
        if (this.nearFlare(zone, s.x, s.y, now)) {
          this.sendAway(s, now);
          continue;
        }
        const may = (x: number, y: number) => this.skulkerMayStand(map, s.rule, x, y) && !this.nearFlare(zone, x, y, now) && !this.creatureAt(zone, x, y);
        let prey = s.chasing === undefined ? undefined : here.find(p => p.rec.id === s.chasing);
        if (s.chasing !== undefined && (!prey || prey.rec.energy <= 0 || now >= s.chaseUntil || !this.noticeable(prey, now))) {
          this.giveUp(s, now);
          prey = undefined;
        }
        if (s.chasing === undefined && now >= s.calmUntil) {
          prey = here
            .filter(p => p.rec.energy > 0 && this.noticeable(p, now) && manhattan(p.rec.x, p.rec.y, s.x, s.y) <= (now - p.readyAt < SKULKER_HEAR_MS ? this.heardFrom(p) : SKULKER_SEE))
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
            // The ferns rustle as it comes, for whoever is near enough to hear it.
            for (const q of here) if (Math.hypot(q.rec.x - s.x, q.rec.y - s.y) <= RUSTLE_HEARD) this.saw(q, 'rustle');
          }
          if (next) this.creatureTo(s, next.x, next.y);
          else this.toZone(zone.key, { t: 'creature', creature: creatureView(s) });
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

  /** Is an awake creature on this tile of the zone? */
  private creatureAt(zone: Zone, x: number, y: number): boolean {
    return zone.watchers.some(c => c.awake && c.x === x && c.y === y) || zone.skulkers.some(c => c.awake && c.x === x && c.y === y);
  }

  /** A creature moves to x,y (a step, or a jump the clients show at once). */
  private creatureTo(c: Watcher, x: number, y: number): void {
    c.dir = dirTo(x - c.x, y - c.y) ?? c.dir;
    c.x = x;
    c.y = y;
    this.toZone(c.zone.key, { t: 'creature', creature: creatureView(c) });
  }

  private giveUp(s: Skulker, now: number): void {
    this.escaped(s);
    s.chasing = undefined;
    s.calmUntil = now + SKULKER_CALM_MS;
    this.toZone(s.zone.key, { t: 'creature', creature: creatureView(s) });
  }

  /**
   * A skulker caught a player: energy lost, and one bag slot (at random) falls out as their pile where
   * they stand, to be picked up again; it goes away for a while. Emptied, they collapse as ever.
   */
  private caught(s: Skulker, p: Online, now: number): void {
    this.sendAway(s, now, true);
    this.advance(p, now);
    p.rec.energy = Math.max(0, p.rec.energy - SKULKER_CATCH);
    if (p.rec.energy <= 0) {
      this.outbox.push({ to: p.rec.id, msg: { t: 'touched', by: 'skulker', lost: null } });
      return this.collapse(p, now);
    }
    let lost: string | null = null, level = 0;
    if (p.rec.bag.length) {
      const slot = this.roll(p.rec.bag.length);
      lost = p.rec.bag[slot]!.item;
      level = p.rec.bag[slot]!.piece?.level ?? 0;
      this.dropBag(p, now, slot);
    }
    this.outbox.push({ to: p.rec.id, msg: { t: 'touched', by: 'skulker', lost, ...(level ? { level } : {}) } });
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
    // The fires of the world everyone shares: each map's main copy.
    const low: string[] = [], out: string[] = [], fires = [...this.maps.values()].map(m => this.main(m).fires);
    for (const zone of fires) for (const f of zone.all()) {
      if (f.tended) continue;
      const left = zone.left(f, now);
      if (left <= 0) out.push(fireName(f));
      else if (left < FIRE_LOW_S * 2) low.push(fireName(f));
    }
    if (out.length) lines.push(`Gone out: ${listOf(out)}. Bring something that burns.`);
    if (low.length) lines.push(`Burning low: ${listOf(low)}.`);
    if (!out.length && !low.length && fires.some(zone => zone.all().some(f => !f.tended))) lines.push('Every shelter fire is burning.');
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

  /**
   * The notice board on the parcels: this week's calendar with today marked, then to whoever reads it the
   * days they came back this week (to a guest, that signing in brings them). None without sign-in.
   */
  private parcelLines(p: Online, now: number): string[] {
    const data = this.parcels;
    if (!data || !this.guests) return [];
    const day = calendarDay(now + this.epochOffset, this.calendar), today = weekdayOf(day), last = WEEKDAYS.length - 1;
    const short = (i: number) => WEEKDAYS[i]!.slice(0, 3);
    const list = (slots: readonly BagSlot[] | undefined) => (slots ?? []).flatMap(s => { const d = this.items.get(s.item); return d ? [amount(d, s.count)] : []; }).join(', ');
    const extra = list(data.allWeek);
    const entry = (i: number) =>
      `${short(i)}${i === today ? ' (today)' : ''}: ${list(data.week[i])}${i === last && extra ? `, and ${extra} for whoever came back on all seven days` : ''}`;
    const lines = [`Parcels this week, from the town's stores. ${[0, 1, 2, 3].map(entry).join('. ')}.`, `${[4, 5, 6].map(entry).join('. ')}.`];
    if (!this.signedIn(p)) return [...lines, 'Sign in to get the parcels.'];
    const days = daysThisWeek(p.rec.parcels, day), sunday = WEEKDAYS[last];
    if (days === WHOLE_WEEK) return [...lines, `You came back every day this week${extra ? `, and ${sunday}'s parcel held ${extra}` : ''}.`];
    const came = WEEKDAYS.flatMap((_, i) => (days & (1 << i) ? [short(i)] : []));
    // Today alone, on the first day they play this week or on their very first (the welcome parcel's): not "You came back Wed.".
    const you = days === 1 << today ? 'You came home today.' : came.length ? `You came back ${came.join(', ')}.` : '';
    const next = !extra ? '' : everyDaySoFar(days, day)
      ? `Play every day this week and ${sunday}'s parcel holds ${extra}.`
      : `A new week starts fresh on Monday: play every day and ${sunday}'s parcel holds ${extra}.`;
    const said = [you, next].filter(Boolean).join(' ');
    return said ? [...lines, said] : lines;
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
   * A saved bag as it fits today's items: items that no longer exist are gone, gear is a piece to a slot
   * (gear saved before pieces travelled, a strange object's, gets a new one), and a bag that no longer
   * fits (a stack size went down) is packed again; whatever does not fit then is lost.
   */
  private fitBag(bag: unknown, slots: number): BagSlot[] {
    // Only a live item keeps when it was picked.
    const known = this.pieced((Array.isArray(bag) ? bag : []).filter((s): s is BagSlot => isSlot(s) && this.items.has(s.item))
      .map(s => (s.since === undefined || this.items.get(s.item)!.live ? s : { item: s.item, count: s.count, ...(s.piece ? { piece: s.piece } : {}) })));
    const fine = known.length <= slots && known.every(s => s.count <= this.items.get(s.item)!.stack);
    return fine ? copyBag(known) : addAllToBag([], known, this.items, slots).bag;
  }

  /**
   * Slots as today's items fit them: each unit of gear in a slot of its own with its piece (kept when it
   * is one, else new, an anomalous one with its quirk), and no piece on anything that is not gear.
   */
  private pieced(slots: readonly BagSlot[]): BagSlot[] {
    return slots.flatMap(s => {
      const def = this.items.get(s.item);
      if (def?.kind !== 'gear') {
        const { piece: _piece, ...rest } = s;
        return [rest];
      }
      return Array.from({ length: s.count }, (_, i) => ({ item: s.item, count: 1, piece: this.pieceOf(def, i === 0 ? s.piece : undefined) }));
    });
  }

  /** A saved piece of `def` if it is one (an anomalous piece has its quirk), with only what a piece holds; else a new one. */
  private pieceOf(def: ItemDef, saved: unknown): Piece {
    return isPiece(saved) && (saved.quirk !== undefined || def.tier !== 'anomalous') ? cleanPiece(saved) : newPiece(def, this.rng);
  }

  /** Puts `count` new ones of `def` into a bag: gear a piece to a slot, each new (an anomalous one with its quirk). */
  private addNew(bag: readonly BagSlot[], def: ItemDef, count: number, slots: number): { bag: BagSlot[]; left: number } {
    if (def.kind !== 'gear') return addToBag(bag, def, count, slots);
    const room = Math.max(0, Math.min(count, slots - bag.length));
    return { bag: [...copyBag(bag), ...Array.from({ length: room }, () => ({ item: def.id, count: 1, piece: newPiece(def, this.rng) }))], left: count - room };
  }

  /** Can one more of `item` go in this bag? */
  private fits(bag: readonly BagSlot[], item: string, slots: number): boolean {
    const def = this.items.get(item);
    return def !== undefined && addToBag(bag, def, 1, slots).left === 0;
  }

  /**
   * One find, one unit of its item: into the bag if it fits, and a new one grows later somewhere else.
   * Out in the wilds it counts for the forager, whose find may come up double.
   */
  private pickFind(p: Online, find: Find, now: number): void {
    const { rule } = find;
    if (rule.item.kind === 'tool') return this.pickTool(p, find, now);
    const r = this.addNew(p.rec.bag, rule.item, 1, p.slots);
    if (r.left) return this.refuse(p, 'pick', 'bag_full');
    // A live find starts fading now: it stacks one to a slot, so the new one is the last slot.
    if (rule.item.live) r.bag.at(-1)!.since = Math.floor(now + this.epochOffset);
    // Never a live find: those are few on purpose, the prize of a restless region. The second goes in only if it fits.
    const wild = this.wild(p.map);
    const again = wild && !rule.item.live && p.mods.double > 0 && this.rng() < p.mods.double ? this.addNew(r.bag, rule.item, 1, p.slots) : undefined;
    const double = again !== undefined && again.left === 0;
    p.rec.bag = again && double ? again.bag : r.bag;
    find.zone.finds.delete(find.tile);
    const [soonest, latest] = rule.respawn;
    this.later(rule, find.zone, now + (soonest + this.rng() * (latest - soonest)) * 1000, find.tile);
    this.got(p, [{ item: rule.item.id, count: double ? 2 : 1 }], 'find', now, double);
    this.toZone(find.zone.key, { t: 'findGone', id: find.id });
    if (wild) this.count(p, 'found', now);
    this.rerate(p, now);
    this.moveStory(p, { pick: rule.item.id });
    this.found(p, rule.item.id, now);
  }

  /**
   * A find that is a tool: the player's for good (giveTool), never the bag's, and never double. It is
   * gone for everyone like any find and grows back by its rule; one they own already stays where it
   * lies, for someone else. Picked up, it floats like any find (`got`), and it counts like any find,
   * for the forager and the story.
   */
  private pickTool(p: Online, find: Find, now: number): void {
    const { rule } = find;
    if (this.owns(p, rule.item.id)) return this.refuse(p, 'pick', 'have_tool');
    find.zone.finds.delete(find.tile);
    const [soonest, latest] = rule.respawn;
    this.later(rule, find.zone, now + (soonest + this.rng() * (latest - soonest)) * 1000, find.tile);
    this.outbox.push({ to: p.rec.id, msg: { t: 'got', items: [{ item: rule.item.id, count: 1 }], from: 'tool' } });
    this.giveTool(p.rec.id, rule.item.id);
    this.toZone(find.zone.key, { t: 'findGone', id: find.id });
    if (this.wild(p.map)) this.count(p, 'found', now);
    this.moveStory(p, { pick: rule.item.id });
    this.found(p, rule.item.id, now);
  }

  /**
   * The owner gets all of their pile that fits in the bag, and the rest stays; anyone else gets a
   * random half as far as it fits, and the rest is lost with the pile. When nothing of the pile would
   * fit, it stays as it is: the half is only drawn once the picker can carry something of it, so
   * asking again and again never draws a better half. A piece of gear comes out as it went in.
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
      d.items = gather(r.left);
      this.pileWrites.set(d.owner, d);
      this.toZone(recordZone(d), { t: 'drop', drop: dropView(d) });
    } else {
      this.removePile(d);
    }
    this.rerate(p, now);
  }

  /** The pile on a tile of the zone, the picker's own first (that one they get all of). */
  private pileAt(zone: Zone, x: number, y: number, picker: string): DropRecord | undefined {
    if (!zone.map.inside(x, y)) return undefined;
    const here = this.pileTiles.get(zone.key)?.get(y * zone.map.width + x);
    return here?.find(d => d.owner === picker) ?? here?.[0];
  }

  /**
   * A pile saved before a restart, in the copy it was dropped in (none: the main copy). Items that no
   * longer exist are gone; so is a pile with nothing left or on a map that is gone. Gear in it is a piece
   * each (gear that fell before pieces travelled gets a new one).
   */
  private restore(d: DropRecord): void {
    const map = this.maps.get(d.map);
    const items = gather(this.pieced((Array.isArray(d.items) ? d.items : []).filter(s => isSlot(s) && this.items.has(s.item))));
    if (!map || !map.inside(d.x, d.y) || !items.length || this.piles.has(d.owner)) return;
    const trail = (Array.isArray(d.trail) ? d.trail : []).filter(([x, y]) => map.inside(x, y)).slice(-TRAIL_STEPS);
    const { zone: _zone, ...rest } = d;
    this.addPile({ ...rest, ...(typeof d.zone === 'string' && d.zone ? { zone: d.zone } : {}), items, trail });
  }

  private addPile(d: DropRecord): void {
    this.piles.set(d.owner, d);
    const tiles = tilesOf(this.pileTiles, recordZone(d));
    const tile = d.y * this.maps.get(d.map)!.width + d.x;
    const here = tiles.get(tile);
    if (here) here.push(d);
    else tiles.set(tile, [d]);
    this.fadeAt = Math.min(this.fadeAt, d.droppedAt + DROP_LIFETIME_MS - this.epochOffset);
  }

  /** A pile goes (taken, faded or replaced): everyone in its zone hears it, and storage forgets it. */
  private removePile(d: DropRecord): void {
    this.piles.delete(d.owner);
    const key = recordZone(d), tiles = this.pileTiles.get(key)!;
    const tile = d.y * this.maps.get(d.map)!.width + d.x;
    const rest = tiles.get(tile)!.filter(o => o !== d);
    if (rest.length) tiles.set(tile, rest);
    else tiles.delete(tile);
    if (!tiles.size) this.pileTiles.delete(key);
    this.pileWrites.set(d.owner, undefined);
    this.toZone(key, { t: 'dropGone', id: d.owner });
  }

  /** Piles whose hour is over fade. */
  private fadePiles(now: number): void {
    if (now < this.fadeAt) return;
    const wall = now + this.epochOffset;
    for (const d of [...this.piles.values()]) if (wall >= d.droppedAt + DROP_LIFETIME_MS) this.removePile(d);
    this.fadeAt = [...this.piles.values()].reduce((at, d) => Math.min(at, d.droppedAt + DROP_LIFETIME_MS - this.epochOffset), Infinity);
  }

  /** All of a rule's finds in a zone, on free tiles; those with no free tile grow as soon as there is one. With `now`, the zone hears them. */
  private sow(rule: Rule, zone: Zone, now?: number): void {
    for (let i = 0; i < rule.count; i++) {
      const find = this.put(rule, zone, undefined);
      if (!find) this.later(rule, zone, -Infinity, undefined);
      else if (now !== undefined) this.toZone(zone.key, { t: 'find', find: findView(find) });
    }
  }

  /**
   * A rule's time has come (its finds grow in every copy of its map, and everyone there sees them) or
   * is over (its finds go from every copy).
   */
  private openRule(rule: Rule, open: boolean, now: number): void {
    if (rule.open === open) return;
    rule.open = open;
    if (open) {
      for (const zone of this.copiesOf(rule.map.data.id)) this.sow(rule, zone, now);
      return;
    }
    this.growing = this.growing.filter(g => g.rule !== rule);
    for (const zone of this.copiesOf(rule.map.data.id)) {
      for (const [tile, f] of [...zone.finds]) {
        if (f.rule !== rule) continue;
        zone.finds.delete(tile);
        this.toZone(zone.key, { t: 'findGone', id: f.id });
      }
    }
  }

  /** Finds whose time has come grow, and everyone in their zone hears it. */
  private growFinds(now: number): void {
    if (now < this.growAt) return;
    const due = this.growing.filter(g => g.at <= now).sort((a, b) => a.at - b.at);
    this.growing = this.growing.filter(g => g.at > now);
    this.growAt = this.growing.reduce((at, g) => Math.min(at, g.at), Infinity);
    for (const g of due) {
      if (!g.rule.open) continue;
      const find = this.put(g.rule, g.zone, g.not);
      // Every tile it may grow on is taken (by other finds and by piles): it tries again a while later.
      if (!find) this.later(g.rule, g.zone, now + g.rule.respawn[0] * 1000, g.not);
      else this.toZone(g.zone.key, { t: 'find', find: findView(find) });
    }
  }

  private later(rule: Rule, zone: Zone, at: number, not: number | undefined): void {
    this.growing.push({ rule, zone, at, not });
    this.growAt = Math.min(this.growAt, at);
  }

  /** A find of the rule on a free tile of the zone (freeTile); undefined if none is free. Nobody is told here. */
  private put(rule: Rule, zone: Zone, not: number | undefined): Find | undefined {
    const tile = this.freeTile(rule, zone, not);
    if (tile === undefined) return undefined;
    const find: Find = { id: this.nextFindId++, rule, zone, tile };
    zone.finds.set(tile, find);
    return find;
  }

  /**
   * A random tile of the zone the rule's finds may grow on, with no find and no pile on it. `not` (where
   * the last one was taken) only when no other tile is free, so that a find moves on whenever it can.
   */
  private freeTile(rule: Rule, zone: Zone, not: number | undefined): number | undefined {
    const { tiles } = rule;
    const finds = zone.finds;
    const piles = this.pileTiles.get(zone.key);
    const empty = (t: number) => !finds.has(t) && !piles?.has(t);
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

  /** Tells the player what they got (and whether a find came up double), then their whole bag. */
  private got(p: Online, items: BagSlot[], from: 'find' | 'drop', now: number, double = false): void {
    this.outbox.push({ to: p.rec.id, msg: { t: 'got', items, from, ...(double && { double: true as const }) } });
    this.sendBag(p, now);
  }

  /**
   * The player wears `gear` (piece by piece: `worn`) now: saved, everyone on the map sees it, and the
   * player hears their bar, rates and load, and their stash when it changed too (at the chest).
   */
  private wearGear(p: Online, gear: Gear, worn: Worn, now: number, stash = true): void {
    p.rec.gear = gear;
    p.rec.worn = worn;
    this.saveNow.set(p.rec.id, p.rec);
    this.toZone(p.zone.key, { t: 'gear', id: p.rec.id, gear: { ...gear }, quirks: quirksOf(worn) });
    if (stash) this.sendStash(p);
    this.refresh(p, now);
    // A bar that shrank (a piece with extra energy came off) cannot hold more than it can.
    p.rec.energy = Math.min(p.rec.energy, p.max);
    this.tell(p, now);
  }

  /**
   * XP earned by bringing something home: stashing it, or a piece that never was home coming off the
   * player's back at the chest (the first time it ever does). A play-test's multiple of it, and while the
   * cup of rest holds any, as much again out of it (spendRest); what earns nothing touches neither. They
   * hear it, after a store even when it earned nothing (`always`). The bar follows on the next refresh.
   */
  private earn(p: Online, xp: number, always = false): void {
    const r = spendRest(xp * this.xpTimes, p.rec.rested ?? 0);
    if (r.gained <= 0 && !always) return;
    p.rec.xp = (p.rec.xp ?? 0) + r.gained;
    p.rec.rested = r.cup;
    this.outbox.push({ to: p.rec.id, msg: { t: 'progress', progress: progressOf(p.rec.xp, r.cup), gained: r.gained, ...(r.fromRest ? { fromRest: r.fromRest } : {}) } });
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
      if (def) out[slot] = this.pieceOf(def, raw[slot]);
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
    if ((live > 0) !== (p.live > 0)) this.toZone(p.zone.key, { t: 'glow', id: p.rec.id, on: live > 0 });
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
    this.saw(p, 'faded');
  }

  // ---------- crates for whoever comes next ----------

  /**
   * The crates of copy `copy` of `map` (its zone, open or not), made empty the first time they are
   * needed. None are kept for a map without crates.
   */
  private cratesIn(map: TileMap, copy: string): Crate[] {
    const zone = zoneKey(map.data.id, copy), made = this.cratesOn.get(zone);
    if (made) return made;
    const list = map.data.objects.flatMap((o): Crate[] => (o.kind === 'cache'
      ? [{ key: crateKey(zone, o.x, o.y), zone, copy, map, x: o.x, y: o.y, inside: map.data.kind === 'inside', items: [] }]
      : []));
    if (!list.length) return list;
    this.cratesOn.set(zone, list);
    for (const c of list) this.crates.set(c.key, c);
    return list;
  }

  /**
   * A thing left in a crate before a restart, back in it (in the copy it was left in) if the crate still
   * stands, it is still something a crate takes and there is room (else it is forgotten).
   */
  private restoreCacheItem(e: CacheItemRecord): void {
    const map = this.maps.get(e.map);
    if (map) this.cratesIn(map, typeof e.zone === 'string' ? e.zone : '');
    const c = this.crates.get(crateKey(recordZone(e), e.x, e.y));
    this.nextCacheId = Math.max(this.nextCacheId, e.id + 1);
    if (!c || !cacheTakes(this.items.get(e.item)) || c.items.length >= CACHE_SIZE) {
      this.cacheWrites.set(e.id, undefined);
      return;
    }
    const { zone: _zone, ...rest } = e;
    c.items.push({ ...rest, ...copyField(c.copy) });
  }

  /** The crate on tile x,y of the player's zone, right next to them. */
  private crateNextTo(p: Online, x: number, y: number): Crate | undefined {
    const c = this.crates.get(crateKey(p.zone.key, x, y));
    return c && manhattan(x, y, p.rec.x, p.rec.y) === 1 ? c : undefined;
  }

  /** The crate the player visits where they are now: the one in their room, or the nearest in the open within CACHE_NEAR. */
  private crateHere(p: Online): Crate | undefined {
    let best: Crate | undefined, far = Infinity;
    for (const c of this.cratesOn.get(p.zone.key) ?? []) {
      const d = Math.max(Math.abs(c.x - p.rec.x), Math.abs(c.y - p.rec.y));
      if ((c.inside || d <= CACHE_NEAR) && d < far) [best, far] = [c, d];
    }
    return best;
  }

  /** A visit to a crate starts as the player comes to it (into its room, or near it in the open), and ends as they leave. */
  private revisit(p: Online): void {
    const c = this.crateHere(p);
    if (!c) p.visit = null;
    else if (p.visit?.cache !== c.key) p.visit = { cache: c.key, left: false, took: false };
  }

  /** The player's visit to this crate (they stand next to it, so they are visiting it). */
  private visitAt(p: Online, c: Crate): NonNullable<Online['visit']> {
    if (p.visit?.cache !== c.key) p.visit = { cache: c.key, left: false, took: false };
    return p.visit;
  }

  /** What is in a crate, the newest first, and what the player did at it this visit, for them. */
  private sendCache(p: Online, c: Crate, now: number): void {
    const wall = now + this.epochOffset, v = p.visit?.cache === c.key ? p.visit : null;
    const items: CacheItemView[] = c.items.map(e => ({ id: e.id, item: e.item, owner: e.owner, name: e.name, age: Math.max(0, Math.round((wall - e.at) / 1000)) })).reverse();
    this.outbox.push({ to: p.rec.id, msg: { t: 'cache', x: c.x, y: c.y, items, left: !!v?.left, took: !!v?.took } });
  }

  /** A crate changed: everyone visiting it (in its zone) sees it as it is now (whoever has it open follows it). */
  private tellVisitors(c: Crate, now: number): void {
    for (const q of this.zones.get(c.zone)?.players ?? []) if (q.visit?.cache === c.key) this.sendCache(q, c, now);
  }

  private refuse(
    p: Online,
    action: 'pick' | 'use' | 'discard' | 'feed' | 'store' | 'take' | 'equip' | 'unequip' | 'wear' | 'doff' | 'craft' | 'mend' | 'upgrade' | 'open' | 'outfit' | 'buy' | LookKind
      | 'thank' | 'cacheLeave' | 'cacheTake',
    reason: Refusal,
  ): void {
    this.outbox.push({ to: p.rec.id, msg: { t: 'refused', action, reason } });
  }

  /** What an action the player asked for did, for their text box: queued after everything the action changed. */
  private did(p: Online, did: Did): void {
    this.outbox.push({ to: p.rec.id, msg: { t: 'did', did } });
  }

  /** A message for everyone in a zone (by its key), but `except`. */
  private toZone(zone: string, msg: ServerMsg, except?: string): void {
    this.outbox.push(except === undefined ? { to: '*', map: zone, msg } : { to: '*', map: zone, except, msg });
  }

  /** A message for everyone on a map, whichever copy of it they are in: news of what the copies share (the map's clocks). */
  private toCopies(mapId: string, msg: ServerMsg): void {
    for (const zone of this.copiesOf(mapId)) this.toZone(zone.key, msg);
  }

  // ---------- zones ----------

  /** A map's main copy, the world everyone shares: open as long as the World runs. */
  private main(map: TileMap): Zone {
    return this.zones.get(map.data.id)!;
  }

  /** Every open copy of a map, the main copy first. */
  private copiesOf(mapId: string): Iterable<Zone> {
    return this.copies.get(mapId) ?? [];
  }

  /** Copy `copy` of `map`: the open one, or it opens now. */
  private zoneFor(map: TileMap, copy: string, now: number): Zone {
    return this.zones.get(zoneKey(map.data.id, copy)) ?? this.openZone(map, copy, now);
  }

  /** A zone with its fires, burning from `now`, and nothing else yet: nobody in it, nothing to pick up, no creatures. */
  private newZone(map: TileMap, copy: string, now: number): Zone {
    const zone: Zone = {
      key: zoneKey(map.data.id, copy), map, copy, players: new Set(), finds: new Map(), fires: new Fires(map, this.wild(map), this.rng, now),
      watchers: [], skulkers: [], flares: [], flashes: [],
    };
    this.zones.set(zone.key, zone);
    let all = this.copies.get(map.data.id);
    if (!all) this.copies.set(map.data.id, (all = new Set()));
    all.add(zone);
    return zone;
  }

  /**
   * A copy of `map` other than its main one opens as the main copy did when the World started: its
   * wild fires burn from now at a random level (one a condition put out today is out here too), the
   * finds of its map's open rules lie there, and its creatures wake on the next tick where nobody is.
   * Its piles and marks were kept all along. Nobody hears of it: whoever walks in hears it all in their
   * `zone` message.
   */
  private openZone(map: TileMap, copy: string, now: number): Zone {
    const zone = this.newZone(map, copy, now);
    for (const d of this.doused) {
      const f = d.map === map.data.id ? zone.fires.at(d.x, d.y) : undefined;
      if (f) zone.fires.douse(f, now);
    }
    for (const rule of this.rules) if (rule.open && rule.map === map) this.sow(rule, zone);
    this.cratesIn(map, copy);
    this.addWatchers(zone);
    this.addSkulkers(zone);
    return zone;
  }

  /** Takes the player out of their zone's players; a copy left empty closes at the next tick (closeEmptied). */
  private quit(p: Online): void {
    const zone = p.zone;
    zone.players.delete(p);
    if (zone.copy && !zone.players.size) this.emptied.add(zone);
  }

  /**
   * Closes the copies whose last player left, unless someone came back meanwhile: nothing in them is
   * looked at again, and the finds waiting to grow in them are forgotten. A main copy never closes. Their
   * piles and marks stay, in memory and in storage, until they fade: they lie there again if the copy
   * opens again.
   */
  private closeEmptied(): void {
    if (!this.emptied.size) return;
    for (const zone of this.emptied) {
      if (zone.players.size || this.zones.get(zone.key) !== zone) continue;
      this.zones.delete(zone.key);
      this.copies.get(zone.map.data.id)!.delete(zone);
      this.growing = this.growing.filter(g => g.zone !== zone);
      const crates = this.cratesOn.get(zone.key);
      if (crates?.every(c => !c.items.length)) {
        this.cratesOn.delete(zone.key);
        for (const c of crates) this.crates.delete(c.key);
      }
    }
    this.emptied.clear();
  }

  /** The watchers of a zone whose map has them, away until the next tick: they wake where nobody is. */
  private addWatchers(zone: Zone): void {
    const rule = zone.map.data.watchers, lairs = this.lairsNow.get(zone.map.data.id);
    if (!rule || !lairs) return;
    for (let i = 0; i < rule.count; i++) {
      zone.watchers.push({ id: this.nextCreatureId++, kind: 'watcher', zone, map: zone.map, x: 0, y: 0, dir: 'down', awake: false, wakeAt: -Infinity, readyAt: 0, lairs });
    }
  }

  /** The skulkers of a zone whose map has them, away until their time comes. */
  private addSkulkers(zone: Zone): void {
    const rule = zone.map.data.skulkers, lairs = this.skulkerLairs.get(zone.map.data.id);
    if (!rule || !lairs) return;
    for (let i = 0; i < rule.count; i++) {
      zone.skulkers.push({
        id: this.nextCreatureId++, kind: 'skulker', rule, zone, map: zone.map, x: 0, y: 0, dir: 'down', awake: false, wakeAt: -Infinity, readyAt: 0, lairs, lair: 0, chaseUntil: 0,
        calmUntil: 0,
      });
    }
  }
}

/** The stash with `needs` paid out of it at the workbench (the stash can pay: canMake). Used up at home, it pays nothing off `out`; its pieces stay as they are. */
function payFrom(s: Stash, needs: readonly BagSlot[]): Stash {
  const items = { ...s.items };
  for (const n of needs) {
    items[n.item] = (items[n.item] ?? 0) - n.count;
    if (items[n.item]! <= 0) delete items[n.item];
  }
  return { items, out: { ...s.out }, ...(s.pieces ? { pieces: s.pieces } : {}) };
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
