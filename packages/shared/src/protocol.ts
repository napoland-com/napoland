/**
 * Messages between the client and the server, sent as JSON text over one WebSocket.
 * Everything the client sends is validated with these schemas; the server never trusts it.
 */
import { z } from 'zod';
import type { EnergyView } from './energy';
import type { Stats } from './feats';
import type { Gear, Quirk, Worn } from './gear';
import type { BagSlot } from './items';
import type { ProgressView } from './progress';
import type { FlashView, StormView, SurgeView } from './sky';

/** Bump when a change breaks older clients; they reload to get the new version. */
export const PROTOCOL_VERSION = 11;

export const Dir = z.enum(['up', 'down', 'left', 'right']);
export type Dir = z.infer<typeof Dir>;

/** An aurora is a night with lights in the sky (sky.ts). */
export const Weather = z.enum(['overcast', 'rain', 'night', 'aurora']);
export type Weather = z.infer<typeof Weather>;

/** Player names: 2 to 16 letters, digits, spaces, - or _. */
export const NAME_RE = /^[A-Za-z0-9 _-]{2,16}$/;
export const PlayerName = z.string().trim().regex(NAME_RE);

/**
 * How the server wants players to sign in, as GET /auth-config tells the client:
 * - legacy: no sign-in. A name makes a character, and a token saved in the browser logs back in.
 * - dev: an email, believed without any code. Only for development and tests: anyone can be anyone.
 * - supabase: Supabase Auth proves who you are (an email and a 6-digit code, later Google and Apple).
 *   `url` and `publishableKey` are the project's public values the client needs to talk to it.
 */
export const AuthConfig = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('legacy') }),
  z.object({ mode: z.literal('dev') }),
  z.object({ mode: z.literal('supabase'), url: z.url({ protocol: /^https?$/ }), publishableKey: z.string().min(1) }),
]);
export type AuthConfig = z.infer<typeof AuthConfig>;
export type AuthMode = AuthConfig['mode'];
export const AUTH_MODES: readonly AuthMode[] = ['legacy', 'dev', 'supabase'];

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
   * the email in dev mode): you get your character; a `token` saved before sign-in claims its
   * character if nobody has yet; `name` makes a new one.
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
  /** Throw away everything in bag slot `slot`. */
  z.object({ t: z.literal('discard'), slot: z.number().int().nonnegative().max(63) }),
  /** Put what is in bag slot `slot` into the fire (or the Old Stone) on tile x,y, next to you. */
  z.object({ t: z.literal('feed'), x: z.number().int(), y: z.number().int(), slot: z.number().int().nonnegative().max(63) }),
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

/** A creature on your map. Watchers only come closer while nobody looks their way. */
export interface CreatureView {
  id: number;
  kind: 'watcher';
  x: number;
  y: number;
  dir: Dir;
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
  /** Gear stays in the chest: it is put on from there. */
  | 'gear_stays'
  /** That is as good as new already, or cannot be mended. */
  | 'whole';

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
}

/** A map by id and version; a client whose copy has another version reloads. */
export interface MapRef {
  id: string;
  version: number;
}

export type ServerMsg =
  | {
      t: 'welcome';
      v: number;
      you: string;
      name: string;
      /** Only without sign-in (legacy): keep it to log in again later, it is the only credential. */
      token?: string;
      /** Set when this sign-in just claimed the character of the hello's token (made before sign-in). */
      claimed?: true;
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
      /** What you did so far that counts toward feats, and the feats earned (feats.ts). */
      stats: Stats;
      /** Your XP and level (progress.ts). */
      progress: ProgressView;
      /** Your tools (item ids, items.ts): kept for good, apart from the bag. */
      tools: string[];
      /** The version of content/items.json the server runs; a client with another version reloads. */
      items: number;
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
  /** Your bag, whole, after any change. */
  | { t: 'bag'; bag: BagSlot[] }
  /** You got these (for a "+2 Glowcap" over your head); your new bag follows in a `bag` message. */
  | { t: 'got'; items: BagSlot[]; from: 'find' | 'drop' | 'identify' }
  /** A pick, use, discard or feed that did not happen, and why. */
  | { t: 'refused'; action: 'pick' | 'use' | 'discard' | 'feed' | 'store' | 'take' | 'equip' | 'unequip' | 'craft' | 'mend' | 'befriend' | 'tell'; reason: Refusal }
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
  /** A creature reached you: you lost energy, and it took one of what you carried (if anything). */
  | { t: 'touched'; by: 'watcher'; lost: string | null }
  /** Something clung to your back, or let go of it. */
  | { t: 'hitch'; on: boolean }
  /** On your map: someone lit a flare. */
  | { t: 'flare'; flare: FlareView }
  /** Your map's surge clock moved to another phase. */
  | { t: 'surge'; surge: SurgeView }
  /** Your map's storm clock moved to another phase. */
  | { t: 'storm'; storm: StormView }
  /** On your map: a patch of ground started to glow. */
  | { t: 'flash'; flash: FlashView }
  /** The Old Stone changed (everyone hears it). */
  | { t: 'stone'; stone: StoneView }
  /** The notice board, read: one line per thing worth knowing. */
  | { t: 'board'; lines: string[] }
  /** You earned a feat (feats.ts); `stats` is where your counts stand now. */
  | { t: 'feat'; id: string; stats: Stats }
  /** What is in your stash, whole, after you opened the chest or anything went in or out. */
  | { t: 'chest'; stash: BagSlot[] }
  /** Your XP and level, after stashing earned some (`gained`: how much, 0 when nothing did). */
  | { t: 'progress'; progress: ProgressView; gained: number }
  /** On your map: what someone wears now (you too, after you changed it). */
  | { t: 'gear'; id: string; gear: Gear; quirks: Quirk[] }
  /** You mended the piece you wear in `slot` at the workbench: it is whole again. */
  | { t: 'mended'; item: string }
  /** The workbench you opened: what your stash holds, whole, after opening it or making something. */
  | { t: 'bench'; stash: BagSlot[] }
  /** You made this at the workbench; it lies in your stash. */
  | { t: 'crafted'; item: string; count: number }
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
  | { t: 'error'; code: ErrorCode; message: string };

/**
 * need_name: signed in, but there is no character yet; say hello again with a name.
 * sign_in_required: the server wants sign-in, and the hello proved nobody (no auth, or it is
 * malformed, expired or not from our Supabase project).
 */
export type ErrorCode =
  | 'bad_message' | 'bad_version' | 'bad_name' | 'unknown_token' | 'too_fast' | 'replaced' | 'server_full' | 'need_name' | 'sign_in_required';

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
