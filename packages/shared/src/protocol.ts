/**
 * Messages between the client and the server, sent as JSON text over one WebSocket.
 * Everything the client sends is validated with these schemas; the server never trusts it.
 */
import { z } from 'zod';
import type { BoardView } from './board';
import type { CacheItemView } from './caches';
import { CALL_KINDS, type CallKind } from './calls';
import { MAX_SAY_CHARS, type ChatTo } from './chat';
import type { EffectView } from './effects';
import type { EnergyView } from './energy';
import type { Stats } from './feats';
import type { FirstView } from './firsts';
import type { Gear, Quirk, Worn } from './gear';
import type { GlimpseView, PrintView } from './glimpses';
import type { BagSlot } from './items';
import type { MeritsView } from './merits';
import type { NotebookView } from './notebook';
import type { ParcelView } from './parcels';
import type { ProgressView } from './progress';
import type { ShopView } from './shop';
import type { ConditionsView, FlashView, SeasonView, StormView, SurgeView } from './sky';
import type { ThanksFor, ThanksGroup } from './thanks';
import type { TownView } from './town';
import { OFFER_MAX } from './trade';
import type { WorksView } from './works';

/**
 * Bump when a change breaks older clients; they reload to get the new version. 30: the weather is each
 * region's (a `zone` says the new map's), and effects run for a while (BodyView.effects). 31: seasons,
 * whose winter freezes water that is then walked on (a client that did not know would never step on it).
 * 32: the Long Night (`longNight`, in the welcome too), whose lodge fire is fed like a shelter's.
 * 33: how the trip went (`trip`), when you come home or wake up there.
 * 34: visits (a neighbor's door lets you in: `visit` in the welcome and `zone`, whose furniture is theirs),
 * the road to your street, and NAPO's teleport (`teleport`), which a client that did not know would never use.
 * 35: the teleport in town takes you home, and a new player's first steps (`firstSteps`, in the welcome too).
 * 36: the shop for looks (`checkout`, and `shop` in the welcome and when what you bought changes), and the window to be saved, someone down out in the wilds, whom an older page could not show or get up.
 * 37: the lost and found, whose bundles, questions and letters an older page could not show.
 * 38: the slab that needs two, which an older page could not put its hands to.
 * 39: the town waking up: its milestones and ledger (`town`), townspeople's scenes, swaps and gifts, which an older page could not show.
 * 40: the fire lookout: climbing it and feeding its lamp (`climb`, `lamp`, `up`), and in the same release the woods mended
 *     together, the footbridge and the street light by the pond (`bring`, `works`), which an older page could not show or do.
 * 41: the notice board as a panel: `board` carries how the world stands as data (board.ts), where an older page read lines.
 * 42: homes in gardens of their own instead of a street (no `street`, `lot`, `door`, knocking or moving), visits
 *     from the friends list (`visit`), and houses built up (`build`, `house`), which an older page could not draw or do.
 */
export const PROTOCOL_VERSION = 42;

/**
 * How many first steps a new player is shown (roadmap/first-steps.md): to town by NAPO's teleport, out of town
 * to pick something up, and home again to put it in the chest.
 */
export const FIRST_STEPS = 3;

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

/** A piece of gear at the workbench: one you wear (by its slot), or the `n`th of an item in your stash (the stash's order). */
export const PieceAt = z.discriminatedUnion('from', [
  z.object({ from: z.literal('worn'), slot: z.enum(['cap', 'shirt', 'gloves', 'pants', 'shoes', 'bag']) }),
  z.object({ from: z.literal('stash'), item: z.string().min(1).max(40), n: z.number().int().nonnegative().max(999) }),
]);
export type PieceAt = z.infer<typeof PieceAt>;

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
  /**
   * Cook `recipe` (meals.ts, `cooking` in content/items.json) at the fire on tile x,y, next to you, while it
   * burns: from what you carry, into a meal in your bag.
   */
  z.object({ t: z.literal('cook'), x: z.number().int(), y: z.number().int(), recipe: z.string().min(1).max(40) }),
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
  /**
   * Put on the piece of gear in bag slot `slot`, anywhere: what you wore in its slot goes into the bag in
   * its place. Never a bag: the bag you wear changes only at home, at the chest.
   */
  z.object({ t: z.literal('wear'), slot: z.number().int().nonnegative().max(63) }),
  /** Take off what you wear in `slot`, anywhere: it goes into the bag, if there is room. Never the bag. */
  z.object({ t: z.literal('doff'), slot: z.enum(['cap', 'shirt', 'gloves', 'pants', 'shoes', 'bag']) }),
  /** Open the workbench on tile x,y, next to you: the server answers with what your stash holds. */
  z.object({ t: z.literal('bench'), x: z.number().int(), y: z.number().int() }),
  /** Make recipe `recipe` at the workbench on tile x,y, from your stash, into your stash. */
  z.object({ t: z.literal('craft'), x: z.number().int(), y: z.number().int(), recipe: z.string().min(1).max(40) }),
  /** Mend the piece you wear in `slot` at the workbench on tile x,y, paying from your stash (`mend` in content/items.json). */
  z.object({ t: z.literal('mend'), x: z.number().int(), y: z.number().int(), slot: z.enum(['cap', 'shirt', 'gloves', 'pants', 'shoes', 'bag']) }),
  /**
   * Upgrade a piece you wear or keep in the stash one level, at the workbench on tile x,y, paying from your
   * stash (`upgrades` in content/items.json). From +7 it may not take: the materials are spent either way.
   */
  z.object({ t: z.literal('upgrade'), x: z.number().int(), y: z.number().int(), of: PieceAt }),
  /**
   * Take up to `count` of an item out of the chest on tile x,y, as much as fits in your bag. Gear comes
   * out one piece at a time: the `n`th of that item in the stash (the first when left out).
   */
  z.object({
    t: z.literal('take'), x: z.number().int(), y: z.number().int(), item: z.string().min(1).max(40), count: z.number().int().positive().max(9999),
    n: z.number().int().nonnegative().max(999).optional(),
  }),
  /** Open a sealed item (a NAPO lockbox) in your stash, at the chest on tile x,y: what it holds goes into the stash. */
  z.object({ t: z.literal('open'), x: z.number().int(), y: z.number().int(), item: z.string().min(1).max(40) }),
  /** Wear an outfit (outfits.ts) from the wardrobe at the chest on tile x,y, or none (null): your gear shows again. */
  z.object({ t: z.literal('outfit'), x: z.number().int(), y: z.number().int(), outfit: z.string().min(1).max(40).nullable() }),
  /** Spend merits on a look (merits.ts: a jacket pattern or a name tag badge), at the chest on tile x,y: it is yours for good. */
  z.object({ t: z.literal('buy'), x: z.number().int(), y: z.number().int(), look: z.string().min(1).max(40) }),
  /** Wear a jacket pattern of yours from the wardrobe at the chest on tile x,y, or none (null). */
  z.object({ t: z.literal('pattern'), x: z.number().int(), y: z.number().int(), pattern: z.string().min(1).max(40).nullable() }),
  /** Wear a name tag badge of yours from the wardrobe at the chest on tile x,y, or none (null). */
  z.object({ t: z.literal('badge'), x: z.number().int(), y: z.number().int(), badge: z.string().min(1).max(40).nullable() }),
  /**
   * Buy a look in the shop (shop.ts) from the wardrobe at the chest on tile x,y: the server opens a payment
   * for it on Stripe's page and says where (`checkout`). Only with `waiver`: the player said yes to getting
   * it at once, and so to giving up the 14 days to change their mind. The look is theirs only once Stripe
   * tells the server it is paid.
   */
  z.object({ t: z.literal('checkout'), x: z.number().int(), y: z.number().int(), look: z.string().min(1).max(40), waiver: z.literal(true) }),
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
  /** Settings: turn trade requests from friends off, or back on. */
  z.object({ t: z.literal('tradeRequests'), off: z.boolean() }),
  /** Send me my friends list again: who is online now, and where. */
  z.object({ t: z.literal('friends') }),
  /**
   * Ask a friend to trade (trade.ts): on your map, within TRADE_REACH. They are asked; if they asked you
   * already, the trade opens at once.
   */
  z.object({ t: z.literal('tradeOpen'), id: z.uuid() }),
  /** Answer a friend's ask to trade: yes opens it for both, no drops it. */
  z.object({ t: z.literal('tradeAnswer'), id: z.uuid(), yes: z.boolean() }),
  /**
   * What you give in your trade, whole: how many of what each bag slot holds (a piece of gear or a live
   * find is one). The server keeps what your bag really holds; any change takes both Readys back.
   */
  z.object({
    t: z.literal('tradeOffer'),
    items: z.array(z.object({ slot: z.number().int().nonnegative().max(63), count: z.number().int().positive().max(999) })).max(OFFER_MAX),
  }),
  /** Ready (on) with what both sides give, or not any more. */
  z.object({ t: z.literal('tradeReady'), on: z.boolean() }),
  /** Trade: once both are ready and both press it, the server swaps both sides in one step. */
  z.object({ t: z.literal('tradeConfirm') }),
  /** Call off your trade (or your ask to trade): for both. */
  z.object({ t: z.literal('tradeCancel') }),
  /**
   * You talked to the person, or read the desk, sign, paper, tag or stencil, on tile x,y next to you: the
   * story may move on (story.ts), and a page of your field notes may open (notebook.ts). Never what it says.
   */
  z.object({ t: z.literal('talk'), x: z.number().int(), y: z.number().int() }),
  /** Send me my counts toward feats as they are now (the status panel opened): the answer is `stats`. */
  z.object({ t: z.literal('stats') }),
  /** Say something to everyone online (world) or to whoever is near you (local). Only signed-in players can. */
  z.object({ t: z.literal('say'), to: z.enum(['world', 'local']), text: z.string().trim().min(1).max(MAX_SAY_CHARS) }),
  /**
   * Thank `who` (thanks.ts), who fed the fire on tile x,y of your map (you warm at it) or painted the
   * arrow `id` (you stand where it points). Once a UTC day for each helper; guests too: it carries no words.
   */
  z.object({
    t: z.literal('thank'), who: z.uuid(),
    what: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('fire'), x: z.number().int(), y: z.number().int() }),
      z.object({ kind: z.literal('mark'), id: z.number().int().nonnegative() }),
    ]),
  }),
  /** Sing a call (calls.ts): everyone on your map within CALL_REACH hears it, you too. Anyone may, guests included. */
  z.object({ t: z.literal('call'), kind: z.enum(CALL_KINDS) }),
  /**
   * Climb the fire lookout whose corner is tile x,y (lookout.ts), from the foot of its ladder, where you
   * stand: up there you see far, for up to LOOKOUT_UP_S. `climbDown` comes down sooner.
   */
  z.object({ t: z.literal('climb'), x: z.number().int(), y: z.number().int() }),
  z.object({ t: z.literal('climbDown') }),
  /**
   * Give `count` (1 unless said) of what is in bag slot `slot` to the place being mended on tile x,y, next
   * to you (works.ts: a footbridge's tile, or its street light): from that slot first, then from others
   * holding the same, as many as it takes.
   */
  z.object({ t: z.literal('bring'), x: z.number().int(), y: z.number().int(), slot: z.number().int().nonnegative().max(63), count: z.number().int().positive().max(FEED_MAX).optional() }),
  /** Open the crate on tile x,y, next to you (caches.ts): the server answers with what is in it. */
  z.object({ t: z.literal('cache'), x: z.number().int(), y: z.number().int() }),
  /** Leave one of what is in bag slot `slot` in the crate on tile x,y: once a visit, never gear. */
  z.object({ t: z.literal('cacheLeave'), x: z.number().int(), y: z.number().int(), slot: z.number().int().nonnegative().max(63) }),
  /** Take the thing `id` out of the crate on tile x,y: once a visit; it thanks whoever left it. */
  z.object({ t: z.literal('cacheTake'), x: z.number().int(), y: z.number().int(), id: z.number().int().nonnegative() }),
  /** Make the swap `swap` (town.ts) with the person on tile x,y, next to you, `count` times over (1 when left out). */
  z.object({ t: z.literal('swap'), x: z.number().int(), y: z.number().int(), swap: z.string().min(1).max(40), count: z.number().int().positive().max(99).optional() }),
  /** Give `count` (1 when left out) of `item` from your bag to the work `work` of the town's ledger on tile x,y, next to you (town.ts). */
  z.object({
    t: z.literal('give'), x: z.number().int(), y: z.number().int(), work: z.string().min(1).max(40), item: z.string().min(1).max(40),
    count: z.number().int().positive().max(999).optional(),
  }),
  /**
   * Get `who` back up (rescue.ts): they lie slumped on your tile or the one next to it, and you give them
   * RESCUE_ENERGY of your own energy, which you need more than. Their thanks comes with it.
   */
  z.object({ t: z.literal('rescue'), who: z.uuid() }),
  /**
   * Carry `owner`'s pile on tile x,y (yours, or one of the four next to it) to the lodge for them
   * (lostfound.ts): all of it, tied up into a bundle that takes one bag slot. Someone else's pile only;
   * `pick` still takes half of it.
   */
  z.object({ t: z.literal('carry'), x: z.number().int(), y: z.number().int(), owner: z.uuid() }),
  /** Leave every bundle you carry in the lost and found box on tile x,y, next to you: each goes back to whoever lost it. */
  z.object({ t: z.literal('handIn'), x: z.number().int(), y: z.number().int() }),
  /**
   * Visit friend `id`'s home (the friends list; the client asks first): NAPO's teleport sets you down by the
   * one in their house, whether they are in or not. From town or a home only, never out in the wilds
   * (`too_far`), and only while they let friends visit (`closed`).
   */
  z.object({ t: z.literal('visit'), id: z.uuid() }),
  /** The setting in the menu: keep every visitor out of your home (`off`), or let your friends visit (as everyone does until they choose). */
  z.object({ t: z.literal('visitsOff'), off: z.boolean() }),
  /** A at NAPO's teleport on tile x,y next to you (the client asks first): in a home (anyone's) it sets you down in town, in front of its twin; in town, at home in front of the one in your own house. */
  z.object({ t: z.literal('teleport'), x: z.number().int(), y: z.number().int() }),
  /** Build your house up to its next level at the workbench on tile x,y, next to you, in your own home (house.ts): paid from the stash. */
  z.object({ t: z.literal('build'), x: z.number().int(), y: z.number().int() }),
  /**
   * Put your hands to the slab on tile x,y, next to you and facing it (slab.ts): while it glows, it opens
   * for two within SLAB_PAIR_MS of each other, each taking what it holds.
   */
  z.object({ t: z.literal('slab'), x: z.number().int(), y: z.number().int() }),
]);
export type ClientMsg = z.infer<typeof ClientMsg>;

/** Something to pick up, lying on a tile of your map. */
export interface FindView {
  id: number;
  item: string;
  x: number;
  y: number;
  /** A piece of a torn map (`item` is the map): the quarter of it this piece covers (items.ts, quarterOf). */
  piece?: number;
}

/**
 * What you lost, carried back to the lodge (lostfound.ts): by whom (null: someone you block, who is not
 * named), and where you lost it (a map and tile, which the letter says by landmark).
 */
export interface ReturnedView {
  by: string | null;
  map: string;
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

/**
 * A fire on your map. `left`: seconds of fuel when sent (it counts down), or null for a tended fire that
 * never goes out. `fed`: the last players who fed it, the most recent first (none until someone has).
 */
export interface FireView {
  x: number;
  y: number;
  left: number | null;
  fed?: PersonView[];
}

/**
 * An arrow someone painted on the ground, pointing `dir`, in their jacket color; it fades at `until` (ms
 * since the epoch). `owner` and `name`: who painted it.
 */
export interface MarkView {
  id: number;
  x: number;
  y: number;
  dir: Dir;
  color: string;
  owner: string;
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

/**
 * A fire lookout's lamp on your map (lookout.ts), by the lookout's corner x,y: it burns `left` more seconds
 * (0: out). While it burns, its beam sweeps the woods, where the wall clock says (beamAngle).
 */
export interface LampView {
  x: number;
  y: number;
  left: number;
}

/** A flare burning on tile x,y for `left` more seconds. */
export interface FlareView {
  x: number;
  y: number;
  left: number;
}

/**
 * The Long Night (sky.ts, longNightAt), as the server keeps it: whether it is on; whether it has its
 * bonus, the faster regrowth (the one on, or else the next one: the lodge's fire lasted through the one
 * before it); and while it is on, whether the lodge's fire went out, which loses the next one its bonus.
 */
export interface LongNightView {
  on: boolean;
  bonus: boolean;
  out: boolean;
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
 * in its own words, from these facts (never guessed). One of these follows every feed, cook, use, discard,
 * craft, mend, upgrade, open and thanks that went through (an upgrade that did not take went through:
 * its materials are spent), after everything else the action changed; a refusal is `refused`.
 */
export type Did =
  /** A fire took `count` of `item`, and has `left` seconds of fuel now; `lit`: it was out. */
  | { kind: 'fire'; item: string; count: number; left: number; lit?: true }
  /** A fire lookout's lamp took `count` of `item`, and burns `left` seconds now; `lit`: it was out. */
  | { kind: 'lamp'; item: string; count: number; left: number; lit?: true }
  /** A place being mended (works.ts) took `count` of `item`, and stands so now; `built`: this made it stand again. */
  | { kind: 'brought'; works: string; item: string; count: number; view: WorksView; built?: true }
  /** The Old Stone took `count` of `item`, and stands so now; `woke`: this woke it. */
  | { kind: 'stone'; item: string; count: number; stone: StoneView; woke?: true }
  /**
   * One `item` from your bag was used up: the energy it gave you (as much as your bar had room for), the
   * seconds a flare burns, the arrow painted (which way it points, and for how many seconds everyone sees
   * it), what a strange object turned out to be (a piece of gear with its piece: its quirk is rolled), the
   * energy a charm in your bag gave on top (`lift`: which charm, and how much; a pale moth, as a glowcap is
   * crushed), and the effect it started for `lasts` seconds (effects.ts; `again`: one of the same still
   * worked, and its time started over instead of adding up).
   */
  | {
      kind: 'used'; item: string; energy?: number; flare?: number; mark?: { dir: Dir; left: number }; into?: BagSlot; lift?: { item: string; energy: number };
      effect?: { lasts: number; again?: true };
    }
  /** You cooked `count` of the meal `item` at a fire, or in your kitchen at home (`chest`: some of what went in came from the chest): it is in your bag. */
  | { kind: 'cooked'; item: string; count: number; chest?: true }
  /** You ate (or drank) the meal `item` (meals.ts): it works until you come home or collapse; `energy`, what it gave the bar at once. */
  | { kind: 'ate'; item: string; energy?: number }
  /**
   * The workbench made `count` of `item`, into your stash. A tool (its kind says so) went to your tools
   * instead, yours for good: your tools came before this in a `tools` message. Furniture went into its
   * place in your cabin (a `furniture` message came before this): `comfort` is how comfortable it is now.
   */
  | { kind: 'made'; item: string; count: number; comfort?: number }
  /** The `item` you wear (at `level`, when upgraded) is mended: whole again. */
  | { kind: 'mended'; item: string; level?: number }
  /** A piece of `item` is `level` now; `failed`: the upgrade did not take, the piece stays at `level` and the materials are spent. */
  | { kind: 'upgraded'; item: string; level: number; failed?: true }
  /** You threw away `count` of `item` (a piece at `level`, when upgraded). */
  | { kind: 'thrown'; item: string; count: number; level?: number }
  /** You opened a sealed `item` (a NAPO lockbox) at the chest: what it held (`got`) is in your stash now. */
  | { kind: 'opened'; item: string; got: BagSlot[] }
  /** You thanked `who` (their `name`) for feeding the fire or painting the arrow. */
  | { kind: 'thanked'; who: string; name: string; what: 'fire' | 'mark' }
  /** You left one `item` in a crate, for whoever comes next. */
  | { kind: 'left'; item: string }
  /**
   * You took one `item` out of a crate, left there by `name`: `mine`, you had left it yourself; `thanked`,
   * it thanked them (not when you had thanked them today already).
   */
  | { kind: 'took'; item: string; name: string; mine?: true; thanked?: true }
  /** You spent merits on `look` (merits.ts): it is yours for good, and `left` merits are still to spend. */
  | { kind: 'bought'; look: string; left: number }
  /** The workbench built your house up to `level` (house.ts), paid from your stash: it stands so now (a `house` message came before this). */
  | { kind: 'built'; level: number }
  /** You gave `who` (their `name`) RESCUE_ENERGY of your energy, and they got up (rescue.ts). */
  | { kind: 'rescued'; who: string; name: string }
  /**
   * You tied up a pile to carry to the lodge (lostfound.ts): `names`, whose things you carry now, the
   * pile's owner first (another bundle that lay in it stays its owner's).
   */
  | { kind: 'carried'; names: string[] }
  /** You left what you carried for `names` in the lost and found box: it is back in their chests, and you earned `xp`. */
  | { kind: 'handedIn'; names: string[]; xp: number }
  /** You and `with` (their name) lifted the slab together (slab.ts): `got` is in your bag now. */
  | { kind: 'slab'; with: string; got: BagSlot[] }
  /** A townsperson made the swap `swap` with you `count` times over (town.ts): what it gives went, what it gets came into your bag. */
  | { kind: 'swapped'; swap: string; count: number }
  /** You gave `count` of `item` to the work `work` of the town's ledger (town.ts); `done`: that was the last of what it needed. */
  | { kind: 'gave'; work: string; item: string; count: number; done?: true };

/** What else weighs on you out there, besides energy: how wet you are (counted on at `wetRate` a second), your bag's load, a hitchhiker. */
export interface BodyView {
  wet: number;
  wetRate: number;
  load: number;
  hitched: boolean;
  /** What you wear, piece by piece: its condition (it wears down out in the wilds) and quirk. */
  worn: Worn;
  /** Effects working on you (effects.ts), with the seconds left of each as sent; none: nothing works on you. */
  effects?: EffectView[];
  /**
   * Cozy (comfort.ts): seconds of it left, as of this message. None: you are not. It holds while you stand
   * by your own fire long enough, and counts down from when you leave it.
   */
  cozy?: number;
  /** Seconds you have stood by your own fire, in your own cabin, as of this message (counting on while you stay). None: you are not by it. */
  fireside?: number;
  /** The meals you ate this trip (meals.ts), in the order you ate them: they work until you come home or collapse. None: no meal. */
  meals?: string[];
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
  /** Too many messages at once, or another call too soon after the last. */
  | 'slow_down'
  /** That needs sign-in: talking, and everything among friends (a guest has neither until they sign in). */
  | 'sign_in_first'
  /** Someone else's: the chest and the workbench of a friend's home you visit are theirs alone. */
  | 'not_yours'
  /** They play as a guest: friends need both players signed in. */
  | 'guest'
  /** The bag you wear changes only at home, at the chest: not from the bag. */
  | 'bag_at_home'
  /** That is as good as new already, or cannot be mended. */
  | 'whole'
  /** You have that tool already: each is yours once, for good (a find of it stays for someone else). */
  | 'have_tool'
  /** Worn clothes and bags are not upgraded (nor is what is not gear). */
  | 'not_upgradable'
  /** It is as high as a piece goes. */
  | 'top_level'
  /** A sealed thing stays in the chest: it is opened there. */
  | 'sealed_stays'
  /** Your level has not reached that outfit yet. */
  | 'locked'
  /** You thanked them today already: each helper once a UTC day. */
  | 'thanked'
  /** The crate holds as many things as it can. */
  | 'crate_full'
  /** Gear (and tools) stay out of a crate. */
  | 'no_gear'
  /** A keepsake stays with you until you bring it home. */
  | 'keepsake'
  /** You left one thing in this crate this visit already, or took one. */
  | 'left_one'
  | 'took_one'
  /** You have that look already: each is bought once, and kept. */
  | 'owned'
  /** You have no merit to spend on it (past level 20, every MERIT_XP earns one). */
  | 'no_merits'
  /** That look is not yours: buy it first. */
  | 'not_owned'
  /** They take no trade requests. */
  | 'trades_off'
  /** They are trading with someone else, or being asked to. */
  | 'busy'
  /** You are in a trade already: one at a time. */
  | 'trading'
  /** The bag of whoever you trade with has no room for what they would get (yours has: `bag_full` is yours). */
  | 'their_bag_full'
  /** Neither side gives anything. */
  | 'nothing_to_trade'
  /** That furniture stands in its place in your cabin already. */
  | 'placed'
  /** Their home keeps visitors out (the setting in their menu). */
  | 'closed'
  /** The house is built as far as it goes (house.ts). */
  | 'built'
  /** It is not built yet: the house is built up to it at the workbench (house.ts: the kitchen, the map table). */
  | 'not_built'
  /** The shop is closed: the owner has not set up payments (or turned them off). */
  | 'shop_closed'
  /** The shop could not open a payment just now (Stripe did not answer): try again in a moment. */
  | 'shop_down'
  /** You are down (rescue.ts): you cannot walk or act until someone gets you up, or you collapse. */
  | 'down'
  /** Getting someone up takes more energy than you have: more than RESCUE_ENERGY. */
  | 'too_tired'
  /** A padlocked door (MapExit.lock): it takes a tool you do not have. */
  | 'padlocked'
  /** It is someone else's things, in a bundle (lostfound.ts): carried to the lodge, never opened, stashed, thrown away or left. */
  | 'not_yours'
  /** Cold: the slab (it opens only while the woods are restless: slab.ts), or a hearth in town that nobody keeps yet (town.ts). */
  | 'cold'
  /** Nobody else put their hands to the slab with yours: it will not move for one pair. */
  | 'one_pair'
  /** You opened the slab this restless time already: once each. */
  | 'opened'
  /** The fire is out: nothing cooks on it until someone lights it again. */
  | 'fire_out'
  /** You ate that meal this trip already: the same one twice does nothing more. */
  | 'ate_it'
  /** You ate two meals this trip already: a third waits for the next trip. */
  | 'two_meals'
  /** The town's ledger wants no more of that for this work (it has all it needs of it, or it is done). */
  | 'not_needed'
  /** The lookout's lamp holds as much as it can. */
  | 'lamp_full'
  /** You are up the lookout: come down first. */
  | 'up'
  /** A place being mended takes something else. */
  | 'not_wanted'
  /** A place being mended has all it keeps put by for now. */
  | 'works_full';

/** Someone, by id and name. */
export interface PersonView {
  id: string;
  name: string;
}

/** A friend: online on map `map` (an id), or offline (null). `closed`: their home keeps visitors out (the setting in their menu). */
export interface FriendView extends PersonView {
  map: string | null;
  closed?: true;
}

/**
 * A friend's home you visit (its house, or its garden): whose it is, how far its house is built (house.ts),
 * and what their trophy shelf shows (the charms and anomalous gear their stash holds, one of each, item ids;
 * none while no shelf is made). The furniture beside it (`furniture`) is theirs then.
 */
export interface VisitView {
  name: string;
  house: number;
  trophies: string[];
}

/** A private message to you, kept until you read it; `at` is ms since the epoch. */
export interface TellView {
  from: string;
  name: string;
  text: string;
  at: number;
}

/**
 * Your trade as it stands (trade.ts), from your side: whom with; `asking` while they have not answered
 * your ask yet, `asked` while you have not answered theirs, `open` once both are in. What each side gives
 * (a piece of gear with its piece, one entry each; the rest by item), and whether each pressed Ready and
 * then Trade.
 */
export interface TradeView {
  with: PersonView;
  state: 'asking' | 'asked' | 'open';
  mine: BagSlot[];
  theirs: BagSlot[];
  ready: boolean;
  theyReady: boolean;
  confirmed: boolean;
  theyConfirmed: boolean;
}

/**
 * Why a trade is off: called off, the ask said no to or not answered, too far apart, one left the map,
 * went down out of energy (rescue.ts), collapsed or went offline, or they are friends no more.
 */
export type TradeOff = 'cancel' | 'no' | 'timeout' | 'far' | 'left' | 'down' | 'collapsed' | 'offline' | 'unfriended';

/**
 * How a trade ended: it went through (what you gave, and what you got), or it is off, and why, and who
 * did it (you or them; none when it was nobody's doing, like walking too far apart).
 */
export type TradeEnd =
  | { kind: 'done'; gave: BagSlot[]; got: BagSlot[] }
  | { kind: 'off'; why: TradeOff; by?: 'you' | 'them' };

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
  /** The pattern on their jacket (merits.ts), over an outfit too; none: their jacket as it is. */
  pattern?: string;
  /** The badge beside their name on their name tag (merits.ts); none: their name alone. */
  badge?: string;
  /** They carry a live find (items.ts): a column of light over them that everyone on the map sees. */
  live?: true;
  /** Seconds left of their afterglow (a quirk, gear.ts): they glow faintly, and watchers keep off them. */
  afterglow?: number;
  /** They play as a guest (only on a server with sign-in): no friends until they sign in. */
  guest?: true;
  /** They lie slumped out in the wilds, out of energy, until someone gets them up or they collapse (rescue.ts). */
  down?: true;
  /** They are up the fire lookout whose ladder they stand at the foot of (lookout.ts). */
  up?: true;
  /** They own a lantern (energy.ts, LANTERN): in a deep region it lights the ground around them, and the others there tire slower in it. */
  lantern?: true;
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

/** A best a trip can beat: the farthest out, the longest out, the most XP brought back. */
export type TripBest = 'deepest' | 'longest' | 'xp';

/**
 * How a trip went, for its owner alone: numbers and ids only, the client words them (trip.ts). A trip
 * starts at the first step out into the wilds and ends at home, walked into or woken up in.
 */
export interface TripView {
  /** Rounded, at least 1. */
  minutes: number;
  /** Steps taken out there. */
  steps: number;
  /** The farthest place reached: the deepest region, then the most steps from home in it. Null: never past the edge. */
  deepest: { map: string; steps: number } | null;
  /** What the bag would earn stored now (0 after a collapse: the bag is on the ground). */
  xp: number;
  /** The lowest the energy got, in whole points. */
  lowest: number;
  caught: { storms: number; flashes: number; surges: number };
  /** Where they fell, after a collapse only (they know it already: their pile lies there). */
  fell: { map: string; x: number; y: number } | null;
  /** The bests this trip beat. */
  best: TripBest[];
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
      /** The weather over your map now (each region has its own rain; a room, the one of the map outside its door). */
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
      /** Your map's fire lookouts' lamps (lookout.ts): how long each burns. None on a map without a lookout. */
      lamps?: LampView[];
      marks: MarkView[];
      creatures: CreatureView[];
      flares: FlareView[];
      flashes: FlashView[];
      surge: SurgeView | null;
      storm: StormView | null;
      /** Every place being mended in the world (works.ts), on any map: one state for everyone. None where nothing is. */
      works?: WorksView[];
      body: BodyView;
      stone: StoneView;
      /** What the woods are like today, this week and next week (sky.ts, conditionsAt). */
      conditions: ConditionsView;
      /** The season, and the seconds left of it (sky.ts): what freezes, how it rains, how the world looks. */
      season: SeasonView;
      /** The Long Night, on or coming. */
      longNight: LongNightView;
      /** What you did so far that counts toward feats: each feat's rank follows from its count (feats.ts, rankOf). */
      stats: Stats;
      /** Your XP and level, and the rest saved up while you were away (progress.ts). */
      progress: ProgressView;
      /**
       * The rest your time away was worth, since you were last seen (progress.ts, restFor), whether or not
       * the cup had room for all of it: an arrival worth a word says so. None: no time worth any.
       */
      restedAway?: number;
      /** What you spent of your merits and the looks you bought (merits.ts); what you earned follows from your XP. */
      merits: MeritsView;
      /** The shop for looks (shop.ts): its catalog's version, the looks you bought in it, and whether it is open now. */
      shop: ShopView;
      /** Your tools (item ids, items.ts, toolsOf), in the order you got them: kept for good, apart from the bag. */
      tools: string[];
      /** Of the torn maps among them, the pieces you found (quarters, items.ts): a map not listed here is whole. */
      charts?: Record<string, number[]>;
      /** The version of content/items.json the server runs; a client with another version reloads. */
      items: number;
      /** Where you are in the story. */
      story: StoryView;
      /** Whom you thanked today (UTC), by id: nobody is thanked twice in a day, so none of them is offered again. */
      thanked: string[];
      /** Your field notes (notebook.ts): the pages opened and the blanks filled, with the version of content/notebook.json the server runs; a client with another version reloads. */
      notebook: NotebookView;
      /** The notes people left that you read (notes.ts), by id, in the order you read them: the journal keeps them. */
      notes: string[];
      /** The keepsakes you brought home (notes.ts), by item id, in the order they came: theirs for good. */
      keepsakes: string[];
      /** Who was the first on the server to find each secret found so far (firsts.ts), and on which day. */
      firsts: FirstView[];
      /** What the town has come to (town.ts): the milestones reached, the works of its ledger done, what was given to the rest. */
      town: TownView;
      /**
       * The world's clock (ms since the epoch, as the sky follows it: a play-test's CLOCK_SHIFT_MS in it),
       * as this was sent: from it the client works out what follows the wall clock without being told,
       * the storms over other regions and the echoes' walks.
       */
      clock: number;
      /** In a home: the furniture made and set in its places (item ids), yours in your own, the owner's in a friend's (`visit`). */
      furniture?: string[];
      /** In a friend's home (its house or its garden): whose it is, how far its house is built, and what their trophy shelf shows. */
      visit?: VisitView;
      /** In the snow (MapData.forest 'snow'): the footprints of the last hour there (glimpses.ts), oldest first. */
      prints?: PrintView[];
      /** How far your own house is built (house.ts): 1, the garage it starts as, and up. */
      house: number;
      /** You keep every visitor out of your home (the setting in the menu). */
      visitsOff?: true;
      /** A new player's first step to take now, 1 to FIRST_STEPS; none once they are done, or for anyone older. */
      firstSteps?: number;
      serverTime: number;
    }
  /**
   * You are on another map now, at x,y: you walked through an exit, or you collapsed and woke up at
   * home. Forget the old map's players, finds, piles and pending steps; the lists are the new map's, and
   * so is the weather (each region has its own rain; a room, the one of the map outside its door).
   */
  | {
      t: 'zone'; map: MapRef; x: number; y: number; dir: Dir; players: PlayerView[]; finds: FindView[]; drops: DropView[]; reason: 'exit' | 'collapse';
      fires: FireView[]; lamps?: LampView[]; marks: MarkView[]; creatures: CreatureView[]; flares: FlareView[]; flashes: FlashView[]; surge: SurgeView | null; storm: StormView | null; stats: Stats;
      weather: Weather;
      /** In a home: the furniture made and set in its places (item ids), yours in your own, the owner's in a friend's (`visit`). */
      furniture?: string[];
      /** In a friend's home (its house or its garden): whose it is, how far its house is built, and what their trophy shelf shows. */
      visit?: VisitView;
      /** In the snow (MapData.forest 'snow'): the footprints of the last hour there (glimpses.ts), oldest first. */
      prints?: PrintView[];
    }
  /** Your energy and body, sent when a rate changes and every few seconds (ENERGY_SYNC_MS). */
  | { t: 'energy'; energy: EnergyView; body: BodyView }
  /** Your bag, whole, after any change. A live item's slot has its `age` as of now. */
  | { t: 'bag'; bag: BagSlot[] }
  /** Your tools, whole (item ids, in the order you got them), after you got one, or a piece of a torn map (`charts`, as in the welcome). */
  | { t: 'tools'; tools: string[]; charts?: Record<string, number[]> }
  /** The furniture in the home you are in, whole (item ids), after its owner made one: it stands in its place now. */
  | { t: 'furniture'; furniture: string[] }
  /**
   * The house of the home you are in (yours, or the friend's you visit) was built up to `level` (house.ts): it
   * stands so now, outside and in. Its owner built it at the workbench; a `did` follows for them.
   */
  | { t: 'house'; level: number }
  /** A friend (`name`) came to visit your home while you were in it. */
  | { t: 'visited'; name: string }
  /** Who may visit your home, as it stands now that you changed it (`off`: nobody). */
  | { t: 'visitsOff'; off: boolean }
  /** You took a first step: the next one to take (null: you are done). */
  | { t: 'firstSteps'; step: number | null }
  /** The first time you come home since homes stood in gardens of their own: a letter saying how home works now. Once. */
  | { t: 'homeLetter' }
  /** How the trip that just ended went: after the `zone` that brings you home, walking in or waking up there. */
  | { t: 'trip'; trip: TripView }
  /**
   * You picked these up (for a "+2 Glowcap" over your head); your new bag follows in a `bag` message.
   * A find that is a `tool` is yours for good instead, and your tools follow in a `tools` message.
   * `double`: the find came up double (the forager's ranks, feats.ts). What a strange object turns
   * out to be comes in `did` instead.
   */
  | { t: 'got'; items: BagSlot[]; from: 'find' | 'drop' | 'tool' | 'piece'; double?: true }
  /** What a feed, cook, use, discard, craft, mend, upgrade, open or thanks you asked for did (for the text box). */
  | { t: 'did'; did: Did }
  /**
   * Someone (by `name`) thanked you, for `what` (thanks.ts). Out in the wilds it gave you `energy` (none:
   * no more gifts this trip, or a full bar), a float over your head; `line`: you are not out there, so the
   * text box says it, and it will not be in your letter.
   */
  | { t: 'thanked'; name: string; what: ThanksFor; energy?: number; line?: true }
  /**
   * You came home: who thanked you while you were away, and for what, the most thanked first; and who
   * carried what you lost back to the lodge (lostfound.ts), the latest first.
   */
  | { t: 'letter'; thanks: ThanksGroup[]; returned?: ReturnedView[] }
  /** What you lost came back to your chest while you play (lostfound.ts): who carried it, and where you lost it. */
  | { t: 'returned'; returned: ReturnedView }
  /**
   * The crate on tile x,y of your map, as you opened it, or since it changed while you visit it: what is
   * in it, the newest first, and whether you left one and took one this visit.
   */
  | { t: 'cache'; x: number; y: number; items: CacheItemView[]; left: boolean; took: boolean }
  /** Something asked for that did not happen, and why. */
  | { t: 'refused'; action: RefusedAction; reason: Refusal }
  /** Someone said something you can hear: to everyone online, or near them on your map (a bubble over their head). You hear your own too. */
  | { t: 'said'; to: ChatTo; id: string; name: string; text: string }
  /** Someone on your map within CALL_REACH sang a call, from tile x,y (calls.ts). You hear your own too. */
  | { t: 'called'; id: string; kind: CallKind; x: number; y: number }
  /** Your friends (with who is online, and where), requests to you and from you, who you block and your settings: whole, after any change and when asked. */
  | { t: 'friends'; friends: FriendView[]; incoming: PersonView[]; outgoing: PersonView[]; blocked: PersonView[]; requestsOff: boolean; tradesOff: boolean }
  /** Private messages to you: every unread one after the welcome, then each new one as it comes. */
  | { t: 'tells'; tells: TellView[] }
  /** Your trade, whole, after any change: you asked, you are asked (the text box asks you), or it is open. */
  | { t: 'trade'; trade: TradeView }
  /** Your trade is over: it went through, or it is off (and why). */
  | { t: 'tradeOver'; with: PersonView; end: TradeEnd }
  /** On your map: a fire was fed (or lit again). */
  | { t: 'fire'; fire: FireView }
  /** On your map: a fire lookout's lamp was fed (or lit again), or went out. */
  | { t: 'lamp'; lamp: LampView }
  /** Anywhere: a place being mended (works.ts) was given something, stood again, wore down at midnight or broke. */
  | { t: 'works'; works: WorksView }
  /**
   * On your map: someone climbed the fire lookout at whose ladder they stand (on), or came down. To the one
   * who climbed, `left`: the seconds they may stay up there.
   */
  | { t: 'up'; id: string; on: boolean; left?: number }
  /** On your map: a mark was painted, or faded. */
  | { t: 'mark'; mark: MarkView }
  | { t: 'markGone'; id: number }
  /** On your map: a creature appeared or moved, or went. */
  | { t: 'creature'; creature: CreatureView }
  | { t: 'creatureGone'; id: number }
  /**
   * You are down (rescue.ts): out of energy out in the wilds, you collapse in `left` seconds unless someone
   * gets you up. Said again whenever that changes (a flare burning by you gives you longer).
   */
  | { t: 'slump'; left: number }
  /** On your map: someone lies slumped, out of energy (on), or got back up (off). */
  | { t: 'down'; id: string; on: boolean }
  /** On your map: someone is down, `where` in words (landmarks.ts: "by the pond"), never where exactly. For local chat. */
  | { t: 'slumped'; id: string; name: string; where: string }
  /** Someone gave you RESCUE_ENERGY of theirs, and you are back up; `thanked`: you thanked them for it (not twice in a UTC day). */
  | { t: 'raised'; by: PersonView; thanked?: true }
  /**
   * A creature reached you: you lost energy, and one of what you carried (if anything) went: a watcher
   * takes it, a skulker makes you drop a whole bag slot of it into your pile where you stand. `level`: it
   * was a piece upgraded that far.
   */
  | { t: 'touched'; by: CreatureView['kind']; lost: string | null; level?: number }
  /** Something clung to your back, or let go of it. */
  | { t: 'hitch'; on: boolean }
  /**
   * How uneasy you are now (unease.ts): 0, not at all, to UNEASE_LEVELS, full (hitchhikers find you twice
   * as often). Told only when the level changes; it is 0 whenever you come into the game.
   */
  | { t: 'unease'; level: number }
  /**
   * You are alone out in the wilds: someone's steps from the last day, on this map, to walk as a see-through
   * figure in their jacket color (glimpses.ts). Only the color and the tiles: never whose they were.
   */
  | { t: 'glimpse'; glimpse: GlimpseView }
  /** On your map: someone lit a flare. */
  | { t: 'flare'; flare: FlareView }
  /** Your map's surge clock moved to another phase. */
  | { t: 'surge'; surge: SurgeView }
  /** Your map's storm clock moved to another phase. */
  | { t: 'storm'; storm: StormView }
  /** On your map: someone started (on) or stopped carrying a live find. */
  | { t: 'glow'; id: string; on: boolean }
  /** On your map: someone glows faintly for `left` more seconds (an afterglow, gear.ts), or no longer (0). */
  | { t: 'afterglow'; id: string; left: number }
  /** On your map: a patch of ground started to glow. */
  | { t: 'flash'; flash: FlashView }
  /** The Old Stone changed (everyone hears it). */
  | { t: 'stone'; stone: StoneView }
  /** A new day's conditions (everyone hears them at dawn, and when the week turns). */
  | { t: 'conditions'; conditions: ConditionsView }
  /** The season turned (everyone hears it, as the week turns): the new one, and the seconds left of it. */
  | { t: 'season'; season: SeasonView }
  /** The Long Night began, the lodge's fire went out in it, or it ended at dawn (everyone hears it): how it stands now. */
  | { t: 'longNight'; night: LongNightView }
  /** The notice board, read: how the world stands (board.ts), which the client shows as a panel. */
  | { t: 'board'; board: BoardView }
  /** You reached rank `rank` (1 to RANKS) of a feat (feats.ts), told once; `stats` is where your counts stand now. */
  | { t: 'feat'; id: string; rank: number; stats: Stats }
  /**
   * Your counts toward feats, as you asked (`stats`): the ranks follow from them (feats.ts, rankOf). Also
   * sent unasked when a count that people remark on goes up (gear made, a collapse, a surge: story.ts).
   */
  | { t: 'stats'; stats: Stats }
  /** You reached this chapter of the story (story.ts): it goes into your journal. */
  | { t: 'chapter'; id: string }
  /** A page of your field notes opened (notebook.ts): you picked up, read or lived through what it is about. */
  | { t: 'page'; id: string }
  /** A blank on a page of your field notes filled in: you saw its answer happen. */
  | { t: 'blank'; id: string }
  /** You read this note someone left (notes.ts) for the first time: the journal keeps it now, and its XP comes in `progress`. */
  | { t: 'noteRead'; id: string }
  /** This keepsake is home now, yours for good (notes.ts); with the whole set home your bar is bigger, in the next `energy`. */
  | { t: 'keepsake'; item: string }
  /** To everyone online: someone (you too) is the first on the server to find a secret (firsts.ts). */
  | { t: 'first'; first: FirstView }
  /** To everyone online: the town changed (town.ts): a milestone reached, something given at the ledger, a work done. Whole. */
  | { t: 'town'; town: TownView }
  /** What is in your stash, whole, after you opened the chest or anything went in or out. */
  | { t: 'chest'; stash: BagSlot[] }
  /** A parcel came into your chest (parcels.ts): when you arrived signed in, or at midnight UTC while you played. */
  | { t: 'parcel'; parcel: ParcelView }
  /**
   * Your XP and level, after stashing earned some (`gained`: how much, 0 when nothing did), and the rest
   * left: `fromRest` is the part of `gained` the cup of rest paid, doubling what stashing earned (progress.ts).
   */
  | { t: 'progress'; progress: ProgressView; gained: number; fromRest?: number }
  /** On your map: what someone wears now (you too, after you changed it). */
  | { t: 'gear'; id: string; gear: Gear; quirks: Quirk[] }
  /** On your map: the outfit someone wears now (you too, after you chose it); null: none, their gear shows. */
  | { t: 'outfit'; id: string; outfit: string | null }
  /** On your map: the pattern on someone's jacket now (you too, after you chose it); null: none. */
  | { t: 'pattern'; id: string; pattern: string | null }
  /** On your map: the badge on someone's name tag now (you too, after you chose it); null: none. */
  | { t: 'badge'; id: string; badge: string | null }
  /** Your merits, whole, after you spent some: what you spent, and every look you bought. */
  | { t: 'merits'; merits: MeritsView }
  /** The looks you bought in the shop, whole, after Stripe said one is paid or refunded: paid ones only, in the order you bought them. */
  | { t: 'shop'; owned: string[] }
  /** The payment you asked for (`checkout`) is open on Stripe's page, at `url`: the game takes you there. */
  | { t: 'checkout'; look: string; url: string }
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
  /** The weather over your map turned (the night comes everywhere at once; rain, region by region). */
  | { t: 'weather'; weather: Weather }
  /** `players`: how many are in the game on this server right now, everyone counted once (the status card shows it). */
  | { t: 'pong'; at: number; serverTime: number; players?: number }
  /** The hello (or the game here) ended; `name` comes with has_character: the account's own character. */
  | { t: 'error'; code: ErrorCode; message: string; name?: string };

/** What a `refused` answers: the message's `t`. Everything among friends can be refused to a guest. */
export type RefusedAction =
  | 'pick' | 'use' | 'discard' | 'feed' | 'store' | 'take' | 'equip' | 'unequip' | 'wear' | 'doff' | 'craft' | 'mend' | 'upgrade' | 'open' | 'outfit' | 'buy' | 'pattern' | 'badge' | 'say' | 'call'
  | 'checkout' | 'thank' | 'cacheLeave' | 'cacheTake' | 'visit' | 'build' | 'board' | 'teleport' | 'rescue' | 'step' | 'carry' | 'handIn' | 'slab' | 'cook' | 'swap' | 'give' | 'climb' | 'climbDown' | 'bring'
  | 'befriend' | 'answer' | 'unfriend' | 'tell' | 'read' | 'block' | 'report' | 'requests' | 'tradeRequests' | 'friends' | 'tradeOpen' | 'tradeAnswer' | 'tradeOffer' | 'tradeReady' | 'tradeConfirm'
  | 'tradeCancel';

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
