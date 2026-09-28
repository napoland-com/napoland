/**
 * Messages between the client and the server, sent as JSON text over one WebSocket.
 * Everything the client sends is validated with these schemas; the server never trusts it.
 */
import { z } from 'zod';
import { MAX_SAY_CHARS, type ChatTo } from './chat';
import type { EnergyView } from './energy';
import type { Stats } from './feats';
import type { Gear, Quirk, Worn } from './gear';
import type { BagSlot } from './items';
import type { ParcelView } from './parcels';
import type { ProgressView } from './progress';
import type { ConditionsView, FlashView, StormView, SurgeView } from './sky';

/** Bump when a change breaks older clients; they reload to get the new version. */
export const PROTOCOL_VERSION = 20;

/** The most one `feed` puts in at once: more than a fire out there ever takes of anything that burns. */
export const FEED_MAX = 30;

export const Dir = z.enum(['up', 'down', 'left', 'right']);
export type Dir = z.infer<typeof Dir>;

/** An aurora is a night with lights in the sky (sky.ts). */
export const Weather = z.enum(['overcast', 'rain', 'night', 'aurora']);
export type Weather = z.infer<typeof Weather>;

/** Player names: 2 to 16 letters, digits, spaces, - or _. */
export const NAME_RE = /^[A-Za-z0-9 _-]{2,16}$/;
export const PlayerName = z.string().trim().regex(NAME_RE);

/** The accounts a player can sign in with besides an email code, through the same Supabase sign-in. */
export const OAUTH_PROVIDERS = ['google', 'apple'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];
export const isOAuthProvider = (name: string): name is OAuthProvider => (OAUTH_PROVIDERS as readonly string[]).includes(name);

/**
 * The providers the sign-in card offers, in this order: only those the Supabase project has set up
 * (AUTH_PROVIDERS). A name this client does not know is left out rather than refused, so a server
 * that offers one more never stops an older page from starting.
 */
const Providers = z.array(z.string()).optional().transform(names => [...new Set(names ?? [])].filter(isOAuthProvider));

/**
 * How the server wants players to sign in, as GET /auth-config tells the client:
 * - legacy: no sign-in. A name makes a character, and a token saved in the browser logs back in.
 * - dev: an email, believed without any code. Only for development and tests: anyone can be anyone.
 *   Its `providers` only show their buttons, which say they need a Supabase project.
 * - supabase: Supabase Auth proves who you are: an email and a 6-digit code, or the `providers`
 *   (Google, Apple). `url` and `publishableKey` are the project's public values the client needs to talk to it.
 * It comes over HTTP, not the game's socket, and zod leaves out fields it does not know, so a page
 * from before `providers` reads the answer as it always did: no new PROTOCOL_VERSION for them.
 */
export const AuthConfig = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('legacy') }),
  z.object({ mode: z.literal('dev'), providers: Providers }),
  z.object({ mode: z.literal('supabase'), url: z.url({ protocol: /^https?$/ }), publishableKey: z.string().min(1), providers: Providers }),
]);
export type AuthConfig = z.infer<typeof AuthConfig>;
export type AuthMode = AuthConfig['mode'];
export const AUTH_MODES: readonly AuthMode[] = ['legacy', 'dev', 'supabase'];

/**
 * With sign-in (dev and supabase), whoever has not signed in plays as a guest: a character that lives
 * in the browser that made it, like the characters made before sign-in. Chat and friends wait for sign-in.
 * A guest who has not played for this many days is deleted, with their pile and marks.
 */
export const GUEST_DAYS = 30;

/**
 * The longest sign-in a hello may carry: a Supabase access token (a JWT) grows with the profile a
 * provider such as Google puts in it, and is usually 1 to 2 KB.
 */
export const MAX_AUTH_CHARS = 8192;

/** The longest private message. */
export const MAX_TELL_CHARS = 200;
/** Why someone is reported (a report also keeps what they wrote, as the reporter saw it). */
export const ReportReason = z.enum(['rude', 'spam', 'cheating', 'other']);
export type ReportReason = z.infer<typeof ReportReason>;

export const ClientMsg = z.discriminatedUnion('t', [
  /**
   * First message on a connection. Without sign-in (legacy), a saved token logs back in; otherwise
   * a name creates a new player. With sign-in, `auth` says who you are (Supabase's access token, or
   * the email in dev mode): you get your character; the `token` of a guest (or of a character made
   * before sign-in) claims its character if nobody has yet, and if you have a character already you
   * are asked first (has_character); `name` makes a new one. Without `auth` on such a server you
   * play as a guest: the `token` this browser keeps, or a new guest with `name`.
   */
  z.object({
    t: z.literal('hello'),
    v: z.number().int(),
    auth: z.string().min(1).max(MAX_AUTH_CHARS).optional(),
    token: z.string().min(16).max(128).optional(),
    name: PlayerName.optional(),
  }),
  /** Walk one tile. seq lets the client match the server's answer to its prediction. */
  z.object({ t: z.literal('step'), dir: Dir, seq: z.number().int().nonnegative() }),
  /** Turn in place. */
  z.object({ t: z.literal('face'), dir: Dir }),
  z.object({ t: z.literal('ping'), at: z.number() }),
  /** Pick up the find or the pile on tile x,y: your own tile or the one next to you. */
  z.object({ t: z.literal('pick'), x: z.number().int(), y: z.number().int() }),
  /** Use what is in bag slot `slot` (a consumable, like a thermos). */
  z.object({ t: z.literal('use'), slot: z.number().int().nonnegative().max(63) }),
  /** Throw away `count` of what is in bag slot `slot`, or all of it when left out. */
  z.object({ t: z.literal('discard'), slot: z.number().int().nonnegative().max(63), count: z.number().int().positive().max(999).optional() }),
  /**
   * Put `count` (1 when left out) of what is in bag slot `slot` into the fire (or the Old Stone) on tile
   * x,y, next to you: from that slot first, then from others holding the same. A fire takes as many as fit.
   */
  z.object({ t: z.literal('feed'), x: z.number().int(), y: z.number().int(), slot: z.number().int().nonnegative().max(63), count: z.number().int().positive().max(FEED_MAX).optional() }),
  /** Read the notice board on tile x,y, next to you: how things stand out there. */
  z.object({ t: z.literal('board'), x: z.number().int(), y: z.number().int() }),
  /** Open the chest (your stash) on tile x,y, next to you: the server answers with what is in it. */
  z.object({ t: z.literal('chest'), x: z.number().int(), y: z.number().int() }),
  /** Put bag slot `slot` into the chest on tile x,y, or everything you carry when `slot` is left out. */
  z.object({ t: z.literal('store'), x: z.number().int(), y: z.number().int(), slot: z.number().int().nonnegative().max(63).optional() }),
  /** Put on a piece of gear from your stash (the `n`th of that item, first when left out), at the chest on tile x,y; what you wore in its slot goes into the stash. */
  z.object({ t: z.literal('equip'), x: z.number().int(), y: z.number().int(), item: z.string().min(1).max(40), n: z.number().int().nonnegative().max(999).optional() }),
  /** Take off what you wear in `slot`, at the chest on tile x,y: it goes into the stash. The bag cannot be taken off. */
  z.object({ t: z.literal('unequip'), x: z.number().int(), y: z.number().int(), slot: z.enum(['cap', 'shirt', 'gloves', 'pants', 'shoes', 'bag']) }),
  /** Open the workbench on tile x,y, next to you: the server answers with what your stash holds. */
  z.object({ t: z.literal('bench'), x: z.number().int(), y: z.number().int() }),
  /** Make recipe `recipe` at the workbench on tile x,y, from your stash, into your stash. */
  z.object({ t: z.literal('craft'), x: z.number().int(), y: z.number().int(), recipe: z.string().min(1).max(40) }),
  /** Mend the piece you wear in `slot` at the workbench on tile x,y, paying from your stash (`mend` in content/items.json). */
  z.object({ t: z.literal('mend'), x: z.number().int(), y: z.number().int(), slot: z.enum(['cap', 'shirt', 'gloves', 'pants', 'shoes', 'bag']) }),
  /** Take up to `count` of an item out of the chest on tile x,y, as much as fits in your bag. */
  z.object({ t: z.literal('take'), x: z.number().int(), y: z.number().int(), item: z.string().min(1).max(40), count: z.number().int().positive().max(9999) }),
  /** Open a sealed item (a NAPO lockbox) in your stash, at the chest on tile x,y: what it holds goes into the stash. */
  z.object({ t: z.literal('open'), x: z.number().int(), y: z.number().int(), item: z.string().min(1).max(40) }),
  /** Wear an outfit (outfits.ts) from the wardrobe at the chest on tile x,y, or none (null): your gear shows again. */
  z.object({ t: z.literal('outfit'), x: z.number().int(), y: z.number().int(), outfit: z.string().min(1).max(40).nullable() }),
  /** Ask someone to be your friend, by id (tapping their name tag) or by name. If they asked you already, you are friends. */
  z.object({ t: z.literal('befriend'), id: z.uuid().optional(), name: PlayerName.optional() }),
  /** Answer someone's friend request: yes makes you friends, no drops it. */
  z.object({ t: z.literal('answer'), id: z.uuid(), yes: z.boolean() }),
  /** Stop being friends, or take back a request you sent. */
  z.object({ t: z.literal('unfriend'), id: z.uuid() }),
  /** A private message to a friend, kept until they read it. */
  z.object({ t: z.literal('tell'), to: z.uuid(), text: z.string().trim().min(1).max(MAX_TELL_CHARS) }),
  /** You read what `from` sent you: the server forgets it. */
  z.object({ t: z.literal('read'), from: z.uuid() }),
  /** Block someone (on) or stop blocking them: a blocked player can send you no requests and no messages, and a friendship ends. */
  z.object({ t: z.literal('block'), id: z.uuid(), on: z.boolean() }),
  /** Report someone to the maintainers; `quote` is what they wrote, as you saw it. */
  z.object({ t: z.literal('report'), id: z.uuid(), reason: ReportReason, quote: z.string().max(MAX_TELL_CHARS).optional() }),
  /** Settings: turn friend requests from others off, or back on. */
  z.object({ t: z.literal('requests'), off: z.boolean() }),
  /** Send me my friends list again: who is online now, and where. */
  z.object({ t: z.literal('friends') }),
  /** You talked to the person, or read the desk, on tile x,y next to you: the story may move on (story.ts). */
  z.object({ t: z.literal('talk'), x: z.number().int(), y: z.number().int() }),
  /** Send me my counts toward feats as they are now (the status panel opened): the answer is `stats`. */
  z.object({ t: z.literal('stats') }),
  /** Say something to everyone online (world) or to whoever is near you (local). Only signed-in players can. */
  z.object({ t: z.literal('say'), to: z.enum(['world', 'local']), text: z.string().trim().min(1).max(MAX_SAY_CHARS) }),
]);
export type ClientMsg = z.infer<typeof ClientMsg>;

/** Something to pick up, lying on a tile of your map. */
export interface FindView {
  id: number;
  item: string;
  x: number;
  y: number;
}

/** What someone carried when they collapsed, lying where they fell until `until` (ms since the epoch). */
export interface DropView {
  id: string;
  x: number;
  y: number;
  /** The player who collapsed (their id) and their name: they get all of it back, anyone else half. */
  owner: string;
  name: string;
  until: number;
  /** The last tiles they walked before they fell, oldest first, ending on the pile: their echo walks it. */
  trail: Array<[number, number]>;
}

/** A fire on your map. `left`: seconds of fuel when sent (it counts down), or null for a tended fire that never goes out. */
export interface FireView {
  x: number;
  y: number;
  left: number | null;
}

/** An arrow someone painted on the ground, pointing `dir`, in their jacket color; it fades at `until` (ms since the epoch). */
export interface MarkView {
  id: number;
  x: number;
  y: number;
  dir: Dir;
  color: string;
  name: string;
  until: number;
}

/**
 * A creature on your map. Watchers only come closer while nobody looks their way; skulkers lie in the
 * ferns and chase whoever they hear or see (`chasing`: that player's id).
 */
export interface CreatureView {
  id: number;
  kind: 'watcher' | 'skulker';
  x: number;
  y: number;
  dir: Dir;
  chasing?: string;
}

/** A flare burning on tile x,y for `left` more seconds. */
export interface FlareView {
  x: number;
  y: number;
  left: number;
}

/** The Old Stone in town: fed shards wake it; awake, it calms every surge until its charge runs out. */
export interface StoneView {
  /** Shards in it now. */
  charge: number;
  /** Shards it needs to wake. */
  need: number;
  awake: boolean;
  /** Awake: seconds until it sleeps again, when nobody feeds it. */
  left: number;
}

/**
 * What something you asked for did, once the server carried it out: the client says it in the text box,
 * in its own words, from these facts (never guessed). One of these follows every feed, use, discard,
 * craft, mend and open that went through, after everything else the action changed; a refusal is `refused`.
 */
export type Did =
  /** A fire took `count` of `item`, and has `left` seconds of fuel now; `lit`: it was out. */
  | { kind: 'fire'; item: string; count: number; left: number; lit?: true }
  /** The Old Stone took `count` of `item`, and stands so now; `woke`: this woke it. */
  | { kind: 'stone'; item: string; count: number; stone: StoneView; woke?: true }
  /**
   * One `item` from your bag was used up: the energy it gave you (as much as your bar had room for), the
   * seconds a flare burns, the arrow painted (which way it points, and for how many seconds everyone sees
   * it), what a strange object turned out to be.
   */
  | { kind: 'used'; item: string; energy?: number; flare?: number; mark?: { dir: Dir; left: number }; into?: BagSlot }
  /**
   * The workbench made `count` of `item`, into your stash. A tool (its kind says so) went to your tools
   * instead, yours for good: your tools came before this in a `tools` message.
   */
  | { kind: 'made'; item: string; count: number }
  /** The `item` you wear is mended: whole again. */
  | { kind: 'mended'; item: string }
  /** You threw away `count` of `item`. */
  | { kind: 'thrown'; item: string; count: number }
  /** You opened a sealed `item` (a NAPO lockbox) at the chest: what it held (`got`) is in your stash now. */
  | { kind: 'opened'; item: string; got: BagSlot[] };

/** What else weighs on you out there, besides energy: how wet you are (counted on at `wetRate` a second), your bag's load, a hitchhiker. */
export interface BodyView {
  wet: number;
  wetRate: number;
  load: number;
  hitched: boolean;
  /** What you wear, piece by piece: its condition (it wears down out in the wilds) and quirk. */
  worn: Worn;
}

/** Why the server did not do what was asked. */
export type Refusal =
  | 'bag_full' | 'too_far' | 'gone' | 'not_usable' | 'empty_slot'
  /** A strange object needs a roof and light in town; a mark needs open ground outdoors. */
  | 'not_here'
  /** That does not burn (or the Old Stone does not want it). */
  | 'not_fuel'
  /** The fire is as full as it gets. */
  | 'fire_full'
  /** A tended fire, in town: it needs nothing. */
  | 'tended'
  /** A mark already lies here. */
  | 'marked'
  /** The chest holds none of that. */
  | 'not_stashed'
  /** That is not something you wear. */
  | 'not_gear'
  /** What you carry does not fit in that smaller bag. */
  | 'bag_too_full'
  /** You always carry a bag: it can be changed, not taken off. */
  | 'keep_bag'
  /** The stash lacks what the recipe needs. */
  | 'missing'
  /** Nobody has that name (or that is you). */
  | 'unknown_player'
  /** They take no friend requests (or they blocked you: the same answer, so nobody learns who blocked them). */
  | 'requests_off'
  /** Messages go to friends only. */
  | 'not_friends'
  /** You blocked them: unblock them first. */
  | 'you_blocked'
  /** Too many requests waiting, or messages they have not read. */
  | 'too_many'
  /** Too many messages at once. */
  | 'slow_down'
  /** That needs sign-in: talking, and everything among friends (a guest has neither until they sign in). */
  | 'sign_in_first'
  /** They play as a guest: friends need both players signed in. */
  | 'guest'
  /** Gear stays in the chest: it is put on from there. */
  | 'gear_stays'
  /** That is as good as new already, or cannot be mended. */
  | 'whole'
  /** You have that tool already: each is yours once, for good (a find of it stays for someone else). */
  | 'have_tool'
  /** A sealed thing stays in the chest: it is opened there. */
  | 'sealed_stays'
  /** Your level has not reached that outfit yet. */
  | 'locked';

/** Someone, by id and name. */
export interface PersonView {
  id: string;
  name: string;
}

/** A friend: online on map `map` (an id), or offline (null). */
export interface FriendView extends PersonView {
  map: string | null;
}

/** A private message to you, kept until you read it; `at` is ms since the epoch. */
export interface TellView {
  from: string;
  name: string;
  text: string;
  at: number;
}

/** What every client knows about a player it can see. x and y are tile coordinates. */
export interface PlayerView {
  id: string;
  name: string;
  x: number;
  y: number;
  dir: Dir;
  color: string;
  /** What they wear, so everyone sees it (gear.ts), and the quirks of what they wear (some show in the world). */
  gear: Gear;
  quirks: Quirk[];
  /** The outfit they wear over it (outfits.ts): how they look, whatever their gear. None: their gear shows. */
  outfit?: string;
  /** They carry a live find (items.ts): a column of light over them that everyone on the map sees. */
  live?: true;
  /** They play as a guest (only on a server with sign-in): no friends until they sign in. */
  guest?: true;
}

/** A map by id and version; a client whose copy has another version reloads. */
export interface MapRef {
  id: string;
  version: number;
}

/** Where you are in the story (story.ts): the latest chapter you reached, in the version of content/story.json the server runs. */
export interface StoryView {
  /** A client with another version of the story reloads. */
  version: number;
  chapter: string;
}

export type ServerMsg =
  | {
      t: 'welcome';
      v: number;
      you: string;
      name: string;
      /** Without sign-in (legacy), and for a guest: keep it to log in again later, it is the only credential. */
      token?: string;
      /** Set when this sign-in just claimed the character of the hello's token (a guest's, or made before sign-in). */
      claimed?: true;
      /** You play as a guest: nobody signed in with this character (only on a server with sign-in). */
      guest: boolean;
      /** The map you are on. */
      map: MapRef;
      /** Everyone on your map, you included. */
      players: PlayerView[];
      /** What lies on your map to pick up. */
      finds: FindView[];
      drops: DropView[];
      stepMs: number;
      weather: Weather;
      energy: EnergyView;
      bag: BagSlot[];
      /**
       * What your stash at home holds, as the chest lists it (after any parcel that came as you arrived):
       * the bag says from it what gear you could make next. Every `chest` and `bench` after says it again.
       */
      stash: BagSlot[];
      /** Your map's fires, marks, creatures, flares, flashes, and surge and storm clocks (null: a map that never surges, or never storms). */
      fires: FireView[];
      marks: MarkView[];
      creatures: CreatureView[];
      flares: FlareView[];
      flashes: FlashView[];
      surge: SurgeView | null;
      storm: StormView | null;
      body: BodyView;
      stone: StoneView;
      /** What the woods are like today, this week and next week (sky.ts, conditionsAt). */
      conditions: ConditionsView;
      /** What you did so far that counts toward feats: each feat's rank follows from its count (feats.ts, rankOf). */
      stats: Stats;
      /** Your XP and level (progress.ts). */
      progress: ProgressView;
      /** Your tools (item ids, items.ts, toolsOf), in the order you got them: kept for good, apart from the bag. */
      tools: string[];
      /** The version of content/items.json the server runs; a client with another version reloads. */
      items: number;
      /** Where you are in the story. */
      story: StoryView;
      serverTime: number;
    }
  /**
   * You are on another map now, at x,y: you walked through an exit, or you collapsed and woke up at
   * home. Forget the old map's players, finds, piles and pending steps; the lists are the new map's.
   */
  | {
      t: 'zone'; map: MapRef; x: number; y: number; dir: Dir; players: PlayerView[]; finds: FindView[]; drops: DropView[]; reason: 'exit' | 'collapse';
      fires: FireView[]; marks: MarkView[]; creatures: CreatureView[]; flares: FlareView[]; flashes: FlashView[]; surge: SurgeView | null; storm: StormView | null; stats: Stats;
    }
  /** Your energy and body, sent when a rate changes and every few seconds (ENERGY_SYNC_MS). */
  | { t: 'energy'; energy: EnergyView; body: BodyView }
  /** Your bag, whole, after any change. A live item's slot has its `age` as of now. */
  | { t: 'bag'; bag: BagSlot[] }
  /** Your tools, whole (item ids, in the order you got them), after you got one. */
  | { t: 'tools'; tools: string[] }
  /**
   * You picked these up (for a "+2 Glowcap" over your head); your new bag follows in a `bag` message.
   * A find that is a `tool` is yours for good instead, and your tools follow in a `tools` message.
   * `double`: the find came up double (the forager's ranks, feats.ts). What a strange object turns
   * out to be comes in `did` instead.
   */
  | { t: 'got'; items: BagSlot[]; from: 'find' | 'drop' | 'tool'; double?: true }
  /** What a feed, use, discard, craft, mend or open you asked for did (for the text box). */
  | { t: 'did'; did: Did }
  /** Something asked for that did not happen, and why. */
  | { t: 'refused'; action: RefusedAction; reason: Refusal }
  /** Someone said something you can hear: to everyone online, or near them on your map (a bubble over their head). You hear your own too. */
  | { t: 'said'; to: ChatTo; id: string; name: string; text: string }
  /** Your friends (with who is online, and where), requests to you and from you, who you block and your setting: whole, after any change and when asked. */
  | { t: 'friends'; friends: FriendView[]; incoming: PersonView[]; outgoing: PersonView[]; blocked: PersonView[]; requestsOff: boolean }
  /** Private messages to you: every unread one after the welcome, then each new one as it comes. */
  | { t: 'tells'; tells: TellView[] }
  /** On your map: a fire was fed (or lit again). */
  | { t: 'fire'; fire: FireView }
  /** On your map: a mark was painted, or faded. */
  | { t: 'mark'; mark: MarkView }
  | { t: 'markGone'; id: number }
  /** On your map: a creature appeared or moved, or went. */
  | { t: 'creature'; creature: CreatureView }
  | { t: 'creatureGone'; id: number }
  /**
   * A creature reached you: you lost energy, and one of what you carried (if anything) went: a watcher
   * takes it, a skulker makes you drop a whole bag slot of it into your pile where you stand.
   */
  | { t: 'touched'; by: CreatureView['kind']; lost: string | null }
  /** Something clung to your back, or let go of it. */
  | { t: 'hitch'; on: boolean }
  /** On your map: someone lit a flare. */
  | { t: 'flare'; flare: FlareView }
  /** Your map's surge clock moved to another phase. */
  | { t: 'surge'; surge: SurgeView }
  /** Your map's storm clock moved to another phase. */
  | { t: 'storm'; storm: StormView }
  /** On your map: someone started (on) or stopped carrying a live find. */
  | { t: 'glow'; id: string; on: boolean }
  /** On your map: a patch of ground started to glow. */
  | { t: 'flash'; flash: FlashView }
  /** The Old Stone changed (everyone hears it). */
  | { t: 'stone'; stone: StoneView }
  /** A new day's conditions (everyone hears them at dawn, and when the week turns). */
  | { t: 'conditions'; conditions: ConditionsView }
  /** The notice board, read: one line per thing worth knowing. */
  | { t: 'board'; lines: string[] }
  /** You reached rank `rank` (1 to RANKS) of a feat (feats.ts), told once; `stats` is where your counts stand now. */
  | { t: 'feat'; id: string; rank: number; stats: Stats }
  /** Your counts toward feats, as you asked (`stats`): the ranks follow from them (feats.ts, rankOf). */
  | { t: 'stats'; stats: Stats }
  /** You reached this chapter of the story (story.ts): it goes into your journal. */
  | { t: 'chapter'; id: string }
  /** What is in your stash, whole, after you opened the chest or anything went in or out. */
  | { t: 'chest'; stash: BagSlot[] }
  /** A parcel came into your chest (parcels.ts): when you arrived signed in, or at midnight UTC while you played. */
  | { t: 'parcel'; parcel: ParcelView }
  /** Your XP and level, after stashing earned some (`gained`: how much, 0 when nothing did). */
  | { t: 'progress'; progress: ProgressView; gained: number }
  /** On your map: what someone wears now (you too, after you changed it). */
  | { t: 'gear'; id: string; gear: Gear; quirks: Quirk[] }
  /** On your map: the outfit someone wears now (you too, after you chose it); null: none, their gear shows. */
  | { t: 'outfit'; id: string; outfit: string | null }
  /** The workbench you opened: what your stash holds, whole, after opening it, making or mending something, or a parcel came. */
  | { t: 'bench'; stash: BagSlot[] }
  /** On your map: a find grew here, or someone took one / it went. */
  | { t: 'find'; find: FindView }
  | { t: 'findGone'; id: number }
  /** On your map: someone collapsed and left a pile; or a pile was taken or faded. */
  | { t: 'drop'; drop: DropView }
  | { t: 'dropGone'; id: string }
  /** Someone arrived on your map (logged in, or walked in from another map). */
  | { t: 'join'; player: PlayerView }
  /** Someone left your map (logged out, or walked to another map). */
  | { t: 'leave'; id: string }
  /** A player started walking to tile x,y. seq is only sent to the player who asked. */
  | { t: 'step'; id: string; x: number; y: number; dir: Dir; seq?: number }
  | { t: 'face'; id: string; dir: Dir }
  /** The server refused step seq; the player is really at x,y facing dir. */
  | { t: 'reject'; seq: number; x: number; y: number; dir: Dir }
  | { t: 'weather'; weather: Weather }
  | { t: 'pong'; at: number; serverTime: number }
  /** The hello (or the game here) ended; `name` comes with has_character: the account's own character. */
  | { t: 'error'; code: ErrorCode; message: string; name?: string };

/** What a `refused` answers: the message's `t`. Everything among friends can be refused to a guest. */
export type RefusedAction =
  | 'pick' | 'use' | 'discard' | 'feed' | 'store' | 'take' | 'equip' | 'unequip' | 'craft' | 'mend' | 'open' | 'outfit' | 'say'
  | 'befriend' | 'answer' | 'unfriend' | 'tell' | 'read' | 'block' | 'report' | 'requests' | 'friends';

/**
 * need_name: signed in, but there is no character yet; say hello again with a name.
 * sign_in_required: the server wants sign-in, and the hello proved nobody (an auth that is
 * malformed, expired or not from our Supabase project, or neither a guest's token nor a name), or
 * the hello's token is of a character someone signed in with: only they play it, signed in.
 * has_character: signed in with the token of a guest, but the account has a character of its own
 * (the error's `name`): one character per account, so the client asks which to play, and says hello
 * again without the token to play the account's. The guest stays as it was.
 */
export type ErrorCode =
  | 'bad_message' | 'bad_version' | 'bad_name' | 'unknown_token' | 'too_fast' | 'replaced' | 'server_full' | 'need_name' | 'sign_in_required' | 'has_character';

/** Every message but the hello. */
export const MAX_MESSAGE_BYTES = 1024;
/** The hello may be longer: it carries the sign-in. */
export const MAX_HELLO_BYTES = MAX_AUTH_CHARS + 1024;

/** Parse and validate one message from a client; null if it is not valid (or longer than `maxBytes`). */
export function parseClientMsg(raw: string, maxBytes = MAX_MESSAGE_BYTES): ClientMsg | null {
  if (raw.length > maxBytes) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const r = ClientMsg.safeParse(json);
  return r.success ? r.data : null;
}

export const encode = (msg: ServerMsg | ClientMsg): string => JSON.stringify(msg);
