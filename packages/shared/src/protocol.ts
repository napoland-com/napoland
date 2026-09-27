/**
 * Messages between the client and the server, sent as JSON text over one WebSocket.
 * Everything the client sends is validated with these schemas; the server never trusts it.
 */
import { z } from 'zod';
import type { EnergyView } from './energy';
import type { Stats } from './feats';
import type { BagSlot } from './items';
import type { SurgeView } from './sky';

/** Bump when a change breaks older clients; they reload to get the new version. */
export const PROTOCOL_VERSION = 4;

export const Dir = z.enum(['up', 'down', 'left', 'right']);
export type Dir = z.infer<typeof Dir>;

/** An aurora is a night with lights in the sky (sky.ts). */
export const Weather = z.enum(['overcast', 'rain', 'night', 'aurora']);
export type Weather = z.infer<typeof Weather>;

/** Player names: 2 to 16 letters, digits, spaces, - or _. */
export const NAME_RE = /^[A-Za-z0-9 _-]{2,16}$/;
export const PlayerName = z.string().trim().regex(NAME_RE);

export const ClientMsg = z.discriminatedUnion('t', [
  /** First message on a connection. A saved token logs back in; otherwise a name creates a new player. */
  z.object({ t: z.literal('hello'), v: z.number().int(), token: z.string().min(16).max(128).optional(), name: PlayerName.optional() }),
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
  | 'marked';

/** What every client knows about a player it can see. x and y are tile coordinates. */
export interface PlayerView {
  id: string;
  name: string;
  x: number;
  y: number;
  dir: Dir;
  color: string;
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
      /** Keep this to log in again later (it is the only credential for now). */
      token: string;
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
      /** Your map's fires, marks, creatures, flares and surge clock (null: a map that never surges). */
      fires: FireView[];
      marks: MarkView[];
      creatures: CreatureView[];
      flares: FlareView[];
      surge: SurgeView | null;
      body: BodyView;
      stone: StoneView;
      /** What you did so far that counts toward feats, and the feats earned (feats.ts). */
      stats: Stats;
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
      fires: FireView[]; marks: MarkView[]; creatures: CreatureView[]; flares: FlareView[]; surge: SurgeView | null; stats: Stats;
    }
  /** Your energy and body, sent when a rate changes and every few seconds (ENERGY_SYNC_MS). */
  | { t: 'energy'; energy: EnergyView; body: BodyView }
  /** Your bag, whole, after any change. */
  | { t: 'bag'; bag: BagSlot[] }
  /** You got these (for a "+2 Glowcap" over your head); your new bag follows in a `bag` message. */
  | { t: 'got'; items: BagSlot[]; from: 'find' | 'drop' | 'identify' }
  /** A pick, use, discard or feed that did not happen, and why. */
  | { t: 'refused'; action: 'pick' | 'use' | 'discard' | 'feed'; reason: Refusal }
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
  /** The Old Stone changed (everyone hears it). */
  | { t: 'stone'; stone: StoneView }
  /** The notice board, read: one line per thing worth knowing. */
  | { t: 'board'; lines: string[] }
  /** You earned a feat (feats.ts); `stats` is where your counts stand now. */
  | { t: 'feat'; id: string; stats: Stats }
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

export type ErrorCode = 'bad_message' | 'bad_version' | 'bad_name' | 'unknown_token' | 'too_fast' | 'replaced' | 'server_full';

export const MAX_MESSAGE_BYTES = 1024;

/** Parse and validate one message from a client; null if it is not valid. */
export function parseClientMsg(raw: string): ClientMsg | null {
  if (raw.length > MAX_MESSAGE_BYTES) return null;
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
