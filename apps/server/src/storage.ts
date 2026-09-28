/**
 * Where players are kept between sessions, with what they carry, and the piles dropped when someone
 * collapsed. Postgres in production; memory for tests and for running without a database
 * (everything is forgotten on restart).
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import type { BagSlot, Dir, Gear, NotebookState, ParcelState, Piece, ReportReason, Stash, Stats, ThanksFor, Worn } from '@napoland/shared';
import { log } from './log';

export interface PlayerRecord {
  /** A random UUID. */
  id: string;
  name: string;
  /**
   * SHA-256 of the login token of a character made without sign-in (a guest, or one from before
   * sign-in), hex. The token itself is never stored. Null for characters made signed in: they have no token.
   */
  tokenHash: string | null;
  /**
   * Who signed in with this character (auth.ts): Supabase's user id, or "dev:" and an email. Null
   * for a character nobody has signed in with yet: a guest, or one made before sign-in, until
   * someone claims it. One character per identity.
   */
  authSub: string | null;
  /** The id of the map the player is on. */
  map: string;
  /**
   * The copy of that map they are in (world.ts, zones), so they come back into it if it still makes
   * sense. None (or ''): the map's main copy, the world everyone shares.
   */
  zone?: string;
  x: number;
  y: number;
  dir: Dir;
  color: string;
  /** 0 to ENERGY_MAX. It only changes while playing: offline, a player's energy waits for them. */
  energy: number;
  /** What the player carries, slot by slot (at most BAG_SLOTS). */
  bag: BagSlot[];
  /** 0 dry to 1 soaked through. None: dry. */
  wet?: number;
  /**
   * What counts toward feats (feats.ts). None: nothing yet. `thanked` (thanks received) is kept apart
   * from the rest: others add to it, often while its owner is offline (creditThanks), so a save of the
   * whole player never writes it, and so never undoes one.
   */
  stats?: Stats;
  /** XP in all (progress.ts): the level follows from it. None: 0. */
  xp?: number;
  /**
   * Rested XP (progress.ts): the cup of rest, which time away fills and stashing spends, as much again as
   * it earns. None: empty. Filled when the player arrives, from lastSeenAt.
   */
  rested?: number;
  /** What lies in the player's stash at home, and what they took out of it. None: empty. */
  stash?: Stash;
  /** What the player wears, by slot. None: they never chose, and wear the starter gear. */
  gear?: Gear;
  /** The condition and quirk of each piece worn, by slot. None: as good as new. */
  worn?: Worn;
  /** The id of the latest chapter of the story the player reached (story.ts). None: they never started. */
  story?: string;
  /**
   * The tools the player owns (item ids), in the order they got them. None: they never got one of their
   * own, and carry the starter tools (items.ts, STARTER_TOOLS). A save without it keeps what was saved.
   */
  tools?: string[];
  /**
   * The daily parcels (parcels.ts): whether they had their welcome parcel, the calendar day of their last
   * parcel and the days of that week they came back on. None: they never had a parcel. A save without
   * it keeps what was saved.
   */
  parcels?: ParcelState;
  /**
   * The outfit the player wears over their gear (outfits.ts); null: none, their gear shows (saved as
   * none). Loaded only when they wear one. A save without it keeps what was saved.
   */
  outfit?: string | null;
  /**
   * Merits (merits.ts): how many the player spent, and the looks they bought with them (ids, in the order
   * they bought them). How many they earned follows from their XP. None: none spent, none bought. A save
   * without them keeps what was saved, so nothing bought is ever lost.
   */
  meritsSpent?: number;
  looks?: string[];
  /**
   * The jacket pattern and the name tag badge the player wears (merits.ts); null: none (saved as none).
   * Loaded only when they wear one. A save without one keeps what was saved, like the outfit.
   */
  pattern?: string | null;
  badge?: string | null;
  /**
   * What a newer release saved that this one does not know, set aside when the player joins (World.join)
   * and written back as it was with every save, so that coming back to the newer release (after a
   * rollback to this one) finds it again: the bag's slots of items this release has no definition of.
   * (Such items in the stash, and counts it does not know, stay where they are, as saved.) Never stored
   * apart: a read has them back in the bag.
   */
  kept?: Kept;
  /**
   * What the player wears was counted as taken out of the stash, once (World.join): the releases before
   * gear went on the road put pieces on without counting them. Kept with the counts (`wornOut` in the
   * stats' jsonb, no migration), and never forgotten by a save without it.
   */
  wornOut?: true;
  /**
   * The player's field notes (notebook.ts): the pages opened and the blanks filled, in the order they
   * came. None: nothing yet. It only grows, and a save without it keeps what was saved.
   */
  notebook?: NotebookState;
  /** Milliseconds since the epoch. Every save sets lastSeenAt: a guest last seen GUEST_DAYS ago is deleted. */
  createdAt: number;
  lastSeenAt: number;
}

/** What a newer release saved that this one does not know (PlayerRecord.kept), as it was. */
export interface Kept {
  bag: unknown[];
}

/** What a player carried when they last collapsed, lying where they fell. One per player. */
export interface DropRecord {
  /** The player who collapsed; their id is the pile's id too. */
  owner: string;
  /** The owner's name, shown with the pile. Not stored with it: it comes from the player. */
  name: string;
  map: string;
  /** The copy of the map it lies in: none (or ''), the main copy. It is only ever found there. */
  zone?: string;
  x: number;
  y: number;
  items: BagSlot[];
  /** When they collapsed, ms since the epoch. The pile fades DROP_LIFETIME_MS later. */
  droppedAt: number;
  /** The last tiles they walked out there, oldest first: their echo walks them. None: no echo. */
  trail?: Array<[number, number]>;
}

/** An arrow someone painted on the ground. Each player has a few; they fade a day after, or longer for a good neighbor. */
export interface MarkRecord {
  id: number;
  owner: string;
  /** The owner's name and jacket color, shown with it. Not stored with it: they come from the player. */
  name: string;
  color: string;
  map: string;
  /** The copy of the map it is painted in: none (or ''), the main copy. */
  zone?: string;
  x: number;
  y: number;
  dir: Dir;
  /** ms since the epoch. */
  placedAt: number;
  /** When it fades, ms since the epoch. None: a day after placedAt (painted by a release that kept no such time). */
  until?: number;
}

/**
 * Someone thanked someone (thanks.ts): the giver, the helper, the UTC day (one thanks from a giver to a
 * helper each day), when, for what, and whether the helper was told (in their text box, or in the
 * letter when they came home). Kept THANKS_KEPT_DAYS.
 */
export interface ThanksRecord {
  giver: string;
  helper: string;
  day: number;
  /** ms since the epoch. */
  at: number;
  what: ThanksFor;
  told: boolean;
  /** The giver's name, for the letter. Not stored with it: it comes from the player. */
  name: string;
}

/**
 * A thing left in a crate for whoever comes next (caches.ts): which crate (its map and tile), what, who
 * left it and when. One unit each; a crate holds CACHE_SIZE at most. The server hands out the ids.
 */
export interface CacheItemRecord {
  id: number;
  map: string;
  /** The copy of the map the crate is in: none (or ''), the main copy. Each copy's crates hold their own. */
  zone?: string;
  x: number;
  y: number;
  item: string;
  owner: string;
  /** The owner's name, shown with it. Not stored with it: it comes from the player. */
  name: string;
  /** When it was left, ms since the epoch. */
  at: number;
}

/** The Old Stone: shards in it, whether it is awake, and when (ms since the epoch) that charge was so. */
export interface StoneRecord {
  charge: number;
  awake: boolean;
  at: number;
}

/**
 * A link between two players: `friend` (stored both ways), a friend `request` from who asked to
 * who was asked, or a `block` from who blocks to who is blocked. With both players' names.
 */
export type LinkKind = 'friend' | 'request' | 'block';
export interface LinkRecord {
  from: string;
  to: string;
  kind: LinkKind;
  fromName: string;
  toName: string;
}

/**
 * Someone as a friend request (or a friend's ask to trade) finds them: who, whether they take friend
 * requests and trade requests, and whether anyone signed in with them (a guest has not).
 */
export interface PersonRecord {
  id: string;
  name: string;
  requestsOff: boolean;
  tradesOff: boolean;
  signedIn: boolean;
}

/** A private message nobody has read yet (ms since the epoch), with the sender's name. */
export interface TellRecord {
  from: string;
  fromName: string;
  to: string;
  text: string;
  at: number;
}

export interface ReportRecord {
  reporter: string;
  reported: string;
  reason: ReportReason;
  quote: string | null;
  at: number;
}

export interface Storage {
  init(): Promise<void>;
  findByTokenHash(hash: string): Promise<PlayerRecord | null>;
  /** The character of a signed-in identity. */
  findByAuthSub(sub: string): Promise<PlayerRecord | null>;
  /**
   * Makes the character `id` (made before sign-in) belong to identity `sub`. False if someone has
   * claimed it already, or `sub` has a character already (two tabs racing).
   */
  claim(id: string, sub: string): Promise<boolean>;
  /** Names are unique regardless of case. */
  nameTaken(name: string): Promise<boolean>;
  /** False if the name was taken in the meantime (two players racing for it), or the identity has a character already. */
  create(rec: PlayerRecord): Promise<boolean>;
  /** Stores what changes while playing: map and the copy of it, position, direction, energy, bag, color and lastSeenAt. */
  save(rec: PlayerRecord): Promise<void>;
  /** Saves several players in one step, or none of them: two players who traded, so a swap never lands in one bag only. */
  saveTogether(recs: readonly PlayerRecord[]): Promise<void>;
  /**
   * A guest is back (lastSeenAt is `at`, ms since the epoch). False, and nothing written, if they no
   * longer exist or someone signed in with them since (they are no guest any more).
   */
  seen(id: string, at: number): Promise<boolean>;
  /**
   * Deletes every character nobody signed in with (authSub null: a guest, on a server with sign-in)
   * last seen before `seenBefore` (ms since the epoch), with their pile, marks, links and unread
   * messages. Never one someone signed in with. Returns how many went.
   */
  forgetGuests(seenBefore: number): Promise<number>;
  /**
   * When this server began to delete guests who stay away (ms since the epoch): the first call stores
   * `now`, every later one returns it. No guest goes before GUEST_DAYS after it, so every player can
   * read the rule in the game (a guest's status panel) before it takes anything.
   */
  guestsSince(now: number): Promise<number>;
  /** How many players exist. */
  count(): Promise<number>;
  /** Every pile dropped after `after` (ms since the epoch), oldest first. Older ones have faded: they are forgotten. */
  loadDrops(after: number): Promise<DropRecord[]>;
  /** Stores a player's pile, in place of the one they had. */
  saveDrop(drop: DropRecord): Promise<void>;
  removeDrop(owner: string): Promise<void>;
  /**
   * Every mark that has not faded by `now` (ms since the epoch); the others are forgotten. A mark saved
   * without its time to fade fades `lifetimeMs` after it was placed.
   */
  loadMarks(now: number, lifetimeMs: number): Promise<MarkRecord[]>;
  saveMark(mark: MarkRecord): Promise<void>;
  removeMark(id: number): Promise<void>;
  /** Every thanks given after `after` (ms since the epoch), oldest first; older ones are forgotten. */
  loadThanks(after: number): Promise<ThanksRecord[]>;
  /** Stores a thanks, or what changed about it (told): one per giver, helper and day. */
  saveThanks(t: ThanksRecord): Promise<void>;
  /** Forgets every thanks given before `before` (ms since the epoch). Returns how many went. */
  forgetThanks(before: number): Promise<number>;
  /** One more thanks received by `helper`, online or not: their `thanked` count grows by one, on its own. */
  creditThanks(helper: string): Promise<void>;
  /** Every thing lying in a crate, oldest first, with its owner's name. */
  loadCacheItems(): Promise<CacheItemRecord[]>;
  saveCacheItem(c: CacheItemRecord): Promise<void>;
  removeCacheItem(id: number): Promise<void>;
  /** The Old Stone as it was last saved, or null. */
  loadStone(): Promise<StoneRecord | null>;
  saveStone(stone: StoneRecord): Promise<void>;
  /** A player by id, or by name regardless of case. */
  findPerson(by: { id: string } | { name: string }): Promise<PersonRecord | null>;
  setRequestsOff(id: string, off: boolean): Promise<void>;
  setTradesOff(id: string, off: boolean): Promise<void>;
  /** Every link from or to a player. */
  linksOf(id: string): Promise<LinkRecord[]>;
  /** Adds (on) or removes a link; adding one that exists, or removing one that does not, changes nothing. */
  setLink(from: string, to: string, kind: LinkKind, on: boolean): Promise<void>;
  addTell(tell: Omit<TellRecord, 'fromName'>): Promise<void>;
  /** Unread messages to a player, oldest first. */
  tellsTo(id: string): Promise<TellRecord[]>;
  /** Forgets every message from `from` to `to`: they have been read. */
  deleteTells(to: string, from: string): Promise<void>;
  addReport(report: ReportRecord): Promise<void>;
  close(): Promise<void>;
}

// A live find keeps when it was picked (`since`), so it goes on fading across a restart; a carried piece of gear keeps its piece;
// and a slot of what a newer release saved keeps whatever it has (PlayerRecord.kept).
const copyBag = (bag: readonly BagSlot[]): BagSlot[] => bag.map(s => structuredClone(s));
/** The bag as storage keeps it: with the slots set aside as a newer release saved them (PlayerRecord.kept) back at its end. */
const savedBag = (rec: PlayerRecord): BagSlot[] => [...rec.bag, ...((rec.kept?.bag ?? []) as BagSlot[])];
const copyPieces = (p: Record<string, Piece[]>): Record<string, Piece[]> => Object.fromEntries(Object.entries(p).map(([id, list]) => [id, list.map(x => ({ ...x }))]));
const copyStash = (s: Stash): Stash => ({ items: { ...s.items }, out: { ...s.out }, ...(s.pieces ? { pieces: copyPieces(s.pieces) } : {}) });
const copyWorn = (w: Worn): Worn => Object.fromEntries(Object.entries(w).map(([slot, p]) => [slot, { ...p }]));
const copyNotebook = (n: NotebookState): NotebookState => ({ pages: [...n.pages], blanks: [...n.blanks] });
const copyRecord = (rec: PlayerRecord): PlayerRecord => ({
  ...rec, bag: copyBag(rec.bag), ...(rec.kept ? { kept: { bag: structuredClone(rec.kept.bag) } } : {}), ...(rec.stats ? { stats: { ...rec.stats } } : {}),
  ...(rec.stash ? { stash: copyStash(rec.stash) } : {}),
  ...(rec.gear ? { gear: { ...rec.gear } } : {}), ...(rec.worn ? { worn: copyWorn(rec.worn) } : {}), ...(rec.tools ? { tools: [...rec.tools] } : {}),
  ...(rec.parcels ? { parcels: { ...rec.parcels } } : {}), ...(rec.looks ? { looks: [...rec.looks] } : {}), ...(rec.notebook ? { notebook: copyNotebook(rec.notebook) } : {}),
});
/** A record as storage keeps it: the copy it names, if any (like the database, which keeps '' for the main copy and reads it back as none). */
function withZone<T extends { zone?: string }>(r: T, zone: string | undefined): T {
  const { zone: _zone, ...rest } = r;
  return (zone ? { ...rest, zone } : rest) as T;
}
/**
 * As the database keeps a player: no outfit, pattern or badge at all when they wear none, no rest when the
 * cup is empty, no merits when none were spent, and no copy in the main copy, so both storages read back the same.
 */
const stored = (rec: PlayerRecord): PlayerRecord => tidy(withZone(copyRecord(rec), rec.zone));
const tidy = (out: PlayerRecord): PlayerRecord => {
  for (const k of ['outfit', 'pattern', 'badge', 'rested', 'meritsSpent'] as const) if (!out[k]) delete out[k];
  if (!out.looks?.length) delete out.looks;
  // What a newer release saved goes back where it was saved: in the bag.
  if (out.kept) {
    out.bag = savedBag(out);
    delete out.kept;
  }
  return out;
};
/** The counts' jsonb as a save writes it: the counts, and the mark of what was worn counted as taken out (PlayerRecord.wornOut). */
const savedCounts = (rec: PlayerRecord): Record<string, unknown> => ({ ...savedStats(rec.stats), ...(rec.wornOut ? { wornOut: 1 } : {}) });
/** The counts a save writes: all but the thanks received, which only creditThanks adds to. */
const savedStats = (stats: Stats | undefined): Stats => {
  const { thanked: _thanked, ...rest } = stats ?? {};
  return rest;
};
const thanksKey = (t: Pick<ThanksRecord, 'giver' | 'helper' | 'day'>) => `${t.giver} ${t.helper} ${t.day}`;

export class MemoryStorage implements Storage {
  private readonly byId = new Map<string, PlayerRecord>();
  private readonly idByToken = new Map<string, string>();
  private readonly idBySub = new Map<string, string>();
  private readonly idByName = new Map<string, string>();
  private readonly drops = new Map<string, Omit<DropRecord, 'name'>>();
  private readonly marks = new Map<number, Omit<MarkRecord, 'name' | 'color'>>();
  private readonly thanks = new Map<string, Omit<ThanksRecord, 'name'>>();
  private readonly cacheItems = new Map<number, Omit<CacheItemRecord, 'name'>>();
  private stone: StoneRecord | null = null;
  private since: number | undefined;
  private readonly off = new Set<string>();
  private readonly tradesOff = new Set<string>();
  private links: Array<{ from: string; to: string; kind: LinkKind }> = [];
  private tells: Array<Omit<TellRecord, 'fromName'>> = [];
  /** Reports made, for tests. */
  readonly reports: ReportRecord[] = [];

  async init(): Promise<void> {}

  async findByTokenHash(hash: string): Promise<PlayerRecord | null> {
    const id = this.idByToken.get(hash);
    return id === undefined ? null : copyRecord(this.byId.get(id)!);
  }

  async findByAuthSub(sub: string): Promise<PlayerRecord | null> {
    const id = this.idBySub.get(sub);
    return id === undefined ? null : copyRecord(this.byId.get(id)!);
  }

  async claim(id: string, sub: string): Promise<boolean> {
    const rec = this.byId.get(id);
    if (!rec || rec.authSub !== null || this.idBySub.has(sub)) return false;
    rec.authSub = sub;
    this.idBySub.set(sub, id);
    return true;
  }

  async nameTaken(name: string): Promise<boolean> {
    return this.idByName.has(name.toLowerCase());
  }

  async create(rec: PlayerRecord): Promise<boolean> {
    const name = rec.name.toLowerCase();
    // Like the database's unique columns (nulls never collide).
    const taken = (key: string | null, index: Map<string, string>) => key !== null && index.has(key);
    if (this.byId.has(rec.id) || taken(rec.tokenHash, this.idByToken) || taken(rec.authSub, this.idBySub) || this.idByName.has(name)) return false;
    const thanked = Math.max(0, Math.floor(rec.stats?.thanked ?? 0));
    this.byId.set(rec.id, { ...stored(rec), stats: { ...savedStats(rec.stats), ...(thanked ? { thanked } : {}) }, ...(rec.wornOut ? { wornOut: true as const } : {}) });
    if (rec.tokenHash !== null) this.idByToken.set(rec.tokenHash, rec.id);
    if (rec.authSub !== null) this.idBySub.set(rec.authSub, rec.id);
    this.idByName.set(name, rec.id);
    return true;
  }

  async save(rec: PlayerRecord): Promise<void> {
    const cur = this.byId.get(rec.id);
    if (cur) {
      // Like the database: the thanks received are only ever added to (creditThanks), never saved over.
      const thanked = cur.stats?.thanked;
      Object.assign(cur, {
        map: rec.map, x: rec.x, y: rec.y, dir: rec.dir, color: rec.color, energy: rec.energy, bag: copyBag(savedBag(rec)), wet: rec.wet ?? 0,
        stats: { ...savedStats(rec.stats), ...(thanked ? { thanked } : {}) }, ...(rec.wornOut || cur.wornOut ? { wornOut: true as const } : {}),
        xp: rec.xp ?? 0, rested: rec.rested ?? 0, stash: rec.stash ? copyStash(rec.stash) : { items: {}, out: {} }, ...(rec.gear ? { gear: { ...rec.gear } } : {}),
        ...(rec.worn ? { worn: copyWorn(rec.worn) } : {}), ...(rec.story ? { story: rec.story } : {}), ...(rec.tools ? { tools: [...rec.tools] } : {}),
        ...(rec.parcels ? { parcels: { ...rec.parcels } } : {}), ...(rec.notebook ? { notebook: copyNotebook(rec.notebook) } : {}), lastSeenAt: rec.lastSeenAt,
        ...(rec.meritsSpent !== undefined ? { meritsSpent: rec.meritsSpent } : {}), ...(rec.looks ? { looks: [...rec.looks] } : {}),
      });
      // Every save says where they are: back in the main copy, the copy they were in is forgotten.
      if (rec.zone) cur.zone = rec.zone;
      else delete cur.zone;
      // Taken off (null) is none; a record without an outfit (or a pattern, or a badge) keeps what was saved, like the tools and parcels.
      for (const k of ['outfit', 'pattern', 'badge'] as const) {
        if (rec[k]) cur[k] = rec[k];
        else if (rec[k] === null) delete cur[k];
      }
      tidy(cur);
    }
  }

  async saveTogether(recs: readonly PlayerRecord[]): Promise<void> {
    // Nothing can come between two writes in memory: one after the other is one step.
    for (const rec of recs) await this.save(rec);
  }

  async seen(id: string, at: number): Promise<boolean> {
    const rec = this.byId.get(id);
    if (!rec || rec.authSub !== null) return false;
    rec.lastSeenAt = at;
    return true;
  }

  async forgetGuests(seenBefore: number): Promise<number> {
    let gone = 0;
    for (const rec of [...this.byId.values()]) {
      if (rec.authSub !== null || rec.lastSeenAt >= seenBefore) continue;
      gone++;
      // Like the database's foreign keys: what belongs to them goes with them. (Reports stay, as there.)
      this.byId.delete(rec.id);
      if (rec.tokenHash !== null) this.idByToken.delete(rec.tokenHash);
      this.idByName.delete(rec.name.toLowerCase());
      this.drops.delete(rec.id);
      for (const [id, m] of this.marks) if (m.owner === rec.id) this.marks.delete(id);
      for (const [key, t] of this.thanks) if (t.giver === rec.id || t.helper === rec.id) this.thanks.delete(key);
      for (const [id, c] of this.cacheItems) if (c.owner === rec.id) this.cacheItems.delete(id);
      this.off.delete(rec.id);
      this.tradesOff.delete(rec.id);
      this.links = this.links.filter(l => l.from !== rec.id && l.to !== rec.id);
      this.tells = this.tells.filter(t => t.from !== rec.id && t.to !== rec.id);
    }
    return gone;
  }

  async guestsSince(now: number): Promise<number> {
    return (this.since ??= now);
  }

  async count(): Promise<number> {
    return this.byId.size;
  }

  async loadDrops(after: number): Promise<DropRecord[]> {
    const out: DropRecord[] = [];
    for (const [owner, d] of this.drops) {
      if (d.droppedAt <= after) this.drops.delete(owner);
      else out.push({ ...d, name: this.byId.get(owner)!.name, items: copyBag(d.items), trail: (d.trail ?? []).map(([x, y]) => [x, y] as [number, number]) });
    }
    return out.sort((a, b) => a.droppedAt - b.droppedAt);
  }

  async saveDrop(drop: DropRecord): Promise<void> {
    // Like the database's foreign key: a pile belongs to a player who exists.
    if (!this.byId.has(drop.owner)) throw new Error(`there is no player ${drop.owner}`);
    const { name: _name, ...stored } = drop;
    this.drops.set(drop.owner, withZone({ ...stored, items: copyBag(drop.items) }, drop.zone));
  }

  async removeDrop(owner: string): Promise<void> {
    this.drops.delete(owner);
  }

  async loadMarks(now: number, lifetimeMs: number): Promise<MarkRecord[]> {
    const out: MarkRecord[] = [];
    for (const [id, m] of this.marks) {
      const owner = this.byId.get(m.owner);
      if ((m.until ?? m.placedAt + lifetimeMs) <= now || !owner) this.marks.delete(id);
      else out.push({ ...m, name: owner.name, color: owner.color });
    }
    return out.sort((a, b) => a.placedAt - b.placedAt);
  }

  async saveMark(mark: MarkRecord): Promise<void> {
    if (!this.byId.has(mark.owner)) throw new Error(`there is no player ${mark.owner}`);
    const { name: _name, color: _color, ...stored } = mark;
    this.marks.set(mark.id, withZone(stored, mark.zone));
  }

  async removeMark(id: number): Promise<void> {
    this.marks.delete(id);
  }

  async loadThanks(after: number): Promise<ThanksRecord[]> {
    await this.forgetThanks(after + 1);
    return [...this.thanks.values()].map(t => ({ ...t, what: { ...t.what }, name: this.byId.get(t.giver)!.name })).sort((a, b) => a.at - b.at);
  }

  async saveThanks(t: ThanksRecord): Promise<void> {
    // Like the database's foreign keys: both are players who exist.
    if (!this.byId.has(t.giver) || !this.byId.has(t.helper)) throw new Error('a thanks joins two players who exist');
    const { name: _name, ...stored } = t;
    this.thanks.set(thanksKey(t), { ...stored, what: { ...t.what } });
  }

  async forgetThanks(before: number): Promise<number> {
    let gone = 0;
    for (const [key, t] of this.thanks) {
      if (t.at >= before) continue;
      this.thanks.delete(key);
      gone++;
    }
    return gone;
  }

  async creditThanks(helper: string): Promise<void> {
    const rec = this.byId.get(helper);
    if (rec) rec.stats = { ...rec.stats, thanked: (rec.stats?.thanked ?? 0) + 1 };
  }

  /** The stored thanks, for tests. */
  storedThanks(): Array<Omit<ThanksRecord, 'name'>> {
    return [...this.thanks.values()].map(t => ({ ...t, what: { ...t.what } }));
  }

  async loadCacheItems(): Promise<CacheItemRecord[]> {
    return [...this.cacheItems.values()].map(c => ({ ...c, name: this.byId.get(c.owner)!.name })).sort((a, b) => a.at - b.at || a.id - b.id);
  }

  async saveCacheItem(c: CacheItemRecord): Promise<void> {
    // Like the database's foreign key: whoever left it is a player who exists.
    if (!this.byId.has(c.owner)) throw new Error(`there is no player ${c.owner}`);
    const { name: _name, ...stored } = c;
    this.cacheItems.set(c.id, withZone(stored, c.zone));
  }

  async removeCacheItem(id: number): Promise<void> {
    this.cacheItems.delete(id);
  }

  async loadStone(): Promise<StoneRecord | null> {
    return this.stone && { ...this.stone };
  }

  async saveStone(stone: StoneRecord): Promise<void> {
    this.stone = { ...stone };
  }

  async findPerson(by: { id: string } | { name: string }): Promise<PersonRecord | null> {
    const id = 'id' in by ? by.id : this.idByName.get(by.name.toLowerCase());
    const rec = id === undefined ? undefined : this.byId.get(id);
    return rec ? { id: rec.id, name: rec.name, requestsOff: this.off.has(rec.id), tradesOff: this.tradesOff.has(rec.id), signedIn: rec.authSub !== null } : null;
  }

  async setRequestsOff(id: string, off: boolean): Promise<void> {
    if (off) this.off.add(id);
    else this.off.delete(id);
  }

  async setTradesOff(id: string, off: boolean): Promise<void> {
    if (off) this.tradesOff.add(id);
    else this.tradesOff.delete(id);
  }

  async linksOf(id: string): Promise<LinkRecord[]> {
    return this.links.filter(l => l.from === id || l.to === id).map(l => ({ ...l, fromName: this.byId.get(l.from)!.name, toName: this.byId.get(l.to)!.name }));
  }

  async setLink(from: string, to: string, kind: LinkKind, on: boolean): Promise<void> {
    const has = this.links.some(l => l.from === from && l.to === to && l.kind === kind);
    if (on && !has) {
      if (!this.byId.has(from) || !this.byId.has(to)) throw new Error('a link joins two players who exist');
      this.links.push({ from, to, kind });
    }
    if (!on && has) this.links = this.links.filter(l => !(l.from === from && l.to === to && l.kind === kind));
  }

  async addTell(tell: Omit<TellRecord, 'fromName'>): Promise<void> {
    this.tells.push({ ...tell });
  }

  async tellsTo(id: string): Promise<TellRecord[]> {
    return this.tells.filter(t => t.to === id).map(t => ({ ...t, fromName: this.byId.get(t.from)!.name }));
  }

  async deleteTells(to: string, from: string): Promise<void> {
    this.tells = this.tells.filter(t => !(t.to === to && t.from === from));
  }

  async addReport(report: ReportRecord): Promise<void> {
    this.reports.push({ ...report });
  }

  async close(): Promise<void> {}

  /** The stored copy of a player, for tests. */
  get(id: string): PlayerRecord | undefined {
    const rec = this.byId.get(id);
    return rec && copyRecord(rec);
  }

  /** The stored pile of a player, for tests. */
  drop(owner: string): Omit<DropRecord, 'name'> | undefined {
    const d = this.drops.get(owner);
    return d && { ...d, items: copyBag(d.items) };
  }
}

interface PlayerRow {
  id: string;
  name: string;
  token_hash: string | null;
  auth_sub: string | null;
  map: string;
  /** The copy of the map (017_zones.sql): '' for the main copy. */
  zone: string;
  x: number;
  y: number;
  dir: Dir;
  color: string;
  energy: number;
  /** jsonb: node-postgres hands it over parsed. */
  bag: unknown;
  wet: number;
  stats: unknown;
  xp: number;
  /** The cup of rest, in XP (018_rested.sql); 0 when it is empty. */
  rested: number;
  stash: unknown;
  /** Null for a player who never chose their gear. */
  gear: unknown;
  /** Null for a player whose pieces were never worn down. */
  worn: unknown;
  /** Null for a player who never started the story. */
  story: string | null;
  /** Null for a player who never got a tool of their own. */
  tools: unknown;
  /** The daily parcels (013_parcels.sql); parcel_day is null until the first one. */
  parcel_welcome: boolean;
  parcel_day: number | null;
  parcel_days: number;
  /** Null for a player who wears no outfit (014_outfits.sql). */
  outfit: string | null;
  /** Thanks received (migration 015): only creditThanks adds to it. */
  thanked: number;
  /** Merits spent, the looks bought (null: none) and the pattern and badge worn (null: none) (019_merits.sql). */
  merits_spent: number;
  looks: unknown;
  pattern: string | null;
  badge: string | null;
  /** Null for a player whose field notes never opened a page (021_notebook.sql). */
  notebook: unknown;
  created_at: Date;
  last_seen_at: Date;
}

interface DropRow {
  owner: string;
  name: string;
  map: string;
  zone: string;
  x: number;
  y: number;
  items: unknown;
  dropped_at: Date;
  trail: unknown;
}

interface MarkRow {
  id: string;
  owner: string;
  name: string;
  color: string;
  map: string;
  zone: string;
  x: number;
  y: number;
  dir: Dir;
  placed_at: Date;
  /** Null for a mark painted by a release before 015: it fades a day after it was placed. */
  fades_at: Date | null;
}

interface CacheItemRow {
  id: string;
  map: string;
  zone: string;
  x: number;
  y: number;
  item: string;
  owner: string;
  name: string;
  left_at: Date;
}

interface ThanksRow {
  giver: string;
  helper: string;
  day: number;
  at: Date;
  what: unknown;
  told: boolean;
  name: string;
}

/** A jsonb list of slots as the server wrote it; anything else reads as empty (the World checks each slot again). */
const slots = (json: unknown): BagSlot[] => (Array.isArray(json) ? (json as BagSlot[]) : []);
/** A jsonb trail of [x, y] tiles as the server wrote it; anything else reads as none. */
const trail = (json: unknown): Array<[number, number]> =>
  Array.isArray(json) ? json.filter((t): t is [number, number] => Array.isArray(t) && t.length === 2 && t.every(Number.isInteger)) : [];
/** A jsonb object of counts as the server wrote it; anything else reads as none (the World checks it again). */
const stats = (json: unknown): Stats => (typeof json === 'object' && json !== null && !Array.isArray(json) ? (json as Stats) : {});
/** Saved counts without the mark of what was worn counted as taken out (PlayerRecord.wornOut). */
const withoutMark = (s: Stats): Stats => {
  const { wornOut: _mark, ...counts } = s as Stats & { wornOut?: unknown };
  return counts;
};
/** A jsonb stash as the server wrote it; anything else reads as empty (the World checks every count too). */
const stash = (json: unknown): Stash => {
  const o = (typeof json === 'object' && json !== null && !Array.isArray(json) ? json : {}) as Partial<Stash>;
  const rec = (v: unknown) => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, number>) : {});
  return { items: rec(o.items), out: rec(o.out), ...(o.pieces && typeof o.pieces === 'object' ? { pieces: o.pieces as Record<string, Piece[]> } : {}) };
};

/** A jsonb notebook as the server wrote it, lists of ids, for the record; anything else reads as never set (the World checks it again). */
const notebookOf = (json: unknown): { notebook?: NotebookState } => {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return {};
  const { pages, blanks } = json as Partial<Record<keyof NotebookState, unknown>>;
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((id): id is string => typeof id === 'string') : []);
  return { notebook: { pages: ids(pages), blanks: ids(blanks) } };
};

const fromRow = (r: PlayerRow): PlayerRecord => ({
  id: r.id,
  name: r.name,
  tokenHash: r.token_hash,
  authSub: r.auth_sub,
  map: r.map,
  // '' is the main copy, which a record names by naming none.
  ...(r.zone ? { zone: r.zone } : {}),
  x: r.x,
  y: r.y,
  dir: r.dir,
  color: r.color,
  energy: r.energy,
  bag: slots(r.bag),
  wet: r.wet,
  // The thanks received live in a column of their own; one among the other counts (it never is) is left out,
  // and so is the mark of what was worn counted as taken out, which the record has apart (wornOut).
  stats: { ...savedStats(withoutMark(stats(r.stats))), ...(Number.isInteger(r.thanked) && r.thanked > 0 ? { thanked: r.thanked } : {}) },
  ...((stats(r.stats) as Record<string, unknown>).wornOut ? { wornOut: true as const } : {}),
  xp: r.xp,
  // An empty cup reads as none, as a new player's record has it.
  ...(r.rested > 0 ? { rested: r.rested } : {}),
  stash: stash(r.stash),
  ...(r.gear && typeof r.gear === 'object' && !Array.isArray(r.gear) ? { gear: r.gear as Gear } : {}),
  // What the World checks again when the player joins.
  ...(r.worn && typeof r.worn === 'object' && !Array.isArray(r.worn) ? { worn: r.worn as Worn } : {}),
  ...(r.story ? { story: r.story } : {}),
  // A list of ids as the server wrote it; anything else reads as never set (the World checks it again).
  ...(Array.isArray(r.tools) ? { tools: r.tools.filter((t): t is string => typeof t === 'string') } : {}),
  // Only for a player who ever had a parcel, as the World fills in none for everyone else.
  ...(r.parcel_welcome || r.parcel_day !== null ? { parcels: { welcome: r.parcel_welcome, day: r.parcel_day, days: r.parcel_days } } : {}),
  // What the World checks again when the player joins: an outfit they may not wear (or that no longer exists) shows as none.
  ...(r.outfit ? { outfit: r.outfit } : {}),
  // What the World checks again when the player joins, as for the outfit.
  ...(r.merits_spent > 0 ? { meritsSpent: r.merits_spent } : {}),
  ...(Array.isArray(r.looks) && r.looks.some(l => typeof l === 'string') ? { looks: r.looks.filter((l): l is string => typeof l === 'string') } : {}),
  ...(r.pattern ? { pattern: r.pattern } : {}),
  ...(r.badge ? { badge: r.badge } : {}),
  ...notebookOf(r.notebook),
  createdAt: r.created_at.getTime(),
  lastSeenAt: r.last_seen_at.getTime(),
});

/** A jsonb thanks' `what` as the server wrote it, or null for anything else (such a thanks is left out). */
const thanksFor = (json: unknown): ThanksFor | null => {
  const w = (typeof json === 'object' && json !== null ? json : {}) as Partial<Record<string, unknown>>;
  if ((w.kind !== 'fire' && w.kind !== 'mark' && w.kind !== 'cache') || typeof w.map !== 'string' || !Number.isInteger(w.x) || !Number.isInteger(w.y)) return null;
  const at = { map: w.map, x: w.x as number, y: w.y as number };
  if (w.kind !== 'cache') return { kind: w.kind, ...at };
  return typeof w.item === 'string' ? { kind: 'cache', ...at, item: w.item } : null;
};

/**
 * What a save writes of a player. A record without parcels (never had one) leaves the parcel columns as
 * they are, as a save without a chapter leaves the story; so does one without an outfit, a pattern or a
 * badge, while null (taken off) saves none; and one without merits or looks leaves them, so nothing bought
 * is ever lost. The copy is always said, as the map is: a record without one is in the main copy. So is the
 * cup of rest: none is empty.
 */
// A record without parcels (never had one) leaves the parcel columns as they are, as a save without a chapter
// leaves the story; so does one without an outfit, a pattern or a badge, while null (taken off) saves none; and
// one without merits or looks leaves them, so nothing bought is ever lost. The copy is always said, as the map
// is: a record without one is in the main copy. So is the cup of rest: none is empty. The mark of what was worn
// counted as taken out (PlayerRecord.wornOut), once written with the counts, stays, and a save without field
// notes (the previous release's, which never writes them) leaves those.
const SAVE_PLAYER = `UPDATE players SET map = $2, x = $3, y = $4, dir = $5, color = $6, energy = $7, bag = $8::jsonb, wet = $9,
  stats = $10::jsonb || CASE WHEN players.stats ? 'wornOut' THEN '{"wornOut": 1}'::jsonb ELSE '{}'::jsonb END, xp = $11, stash = $12::jsonb,
  gear = $14::jsonb, worn = $15::jsonb, story = COALESCE($16::text, story), tools = COALESCE($17::jsonb, tools),
  parcel_welcome = COALESCE($18::boolean, parcel_welcome), parcel_day = CASE WHEN $18::boolean IS NULL THEN parcel_day ELSE $19::integer END,
  parcel_days = COALESCE($20::smallint, parcel_days), outfit = CASE WHEN $21::boolean THEN $22::text ELSE outfit END, zone = $23, rested = $24,
  merits_spent = COALESCE($25::integer, merits_spent), looks = COALESCE($26::jsonb, looks), pattern = CASE WHEN $27::boolean THEN $28::text ELSE pattern END,
  badge = CASE WHEN $29::boolean THEN $30::text ELSE badge END, notebook = COALESCE($31::jsonb, notebook), last_seen_at = $13 WHERE id = $1`;

// jsonb parameters go in as JSON text: node-postgres would send a JS array as a Postgres array.
function saveParams(rec: PlayerRecord): unknown[] {
  const p = rec.parcels;
  return [
    rec.id, rec.map, rec.x, rec.y, rec.dir, rec.color, rec.energy, JSON.stringify(savedBag(rec)), rec.wet ?? 0, JSON.stringify(savedCounts(rec)), rec.xp ?? 0,
    JSON.stringify(rec.stash ?? { items: {}, out: {} }), new Date(rec.lastSeenAt), rec.gear ? JSON.stringify(rec.gear) : null, rec.worn ? JSON.stringify(rec.worn) : null,
    rec.story ?? null, rec.tools ? JSON.stringify(rec.tools) : null, p ? p.welcome : null, p ? p.day : null, p ? p.days : null,
    rec.outfit !== undefined, rec.outfit ?? null, rec.zone ?? '', rec.rested ?? 0, rec.meritsSpent ?? null, rec.looks ? JSON.stringify(rec.looks) : null,
    rec.pattern !== undefined, rec.pattern ?? null, rec.badge !== undefined, rec.badge ?? null, rec.notebook ? JSON.stringify(rec.notebook) : null,
  ];
}

/** Held while migrating, so two servers starting together do not both apply the same file. */
const MIGRATION_LOCK = 4_815_162_342;
/** Postgres' error code for a broken unique constraint. */
const UNIQUE_VIOLATION = '23505';

export class PgStorage implements Storage {
  private readonly pool: pg.Pool;

  constructor(connectionString: string, private readonly migrationsDir: string) {
    this.pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 10_000 });
    // An idle connection that dies (database restart) must not crash the server; the pool replaces it.
    this.pool.on('error', err => log.error('postgres connection lost', { err: err.message }));
  }

  async init(): Promise<void> {
    await migrate(this.pool, this.migrationsDir);
  }

  async findByTokenHash(hash: string): Promise<PlayerRecord | null> {
    const r = await this.pool.query<PlayerRow>('SELECT * FROM players WHERE token_hash = $1', [hash]);
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  }

  async findByAuthSub(sub: string): Promise<PlayerRecord | null> {
    const r = await this.pool.query<PlayerRow>('SELECT * FROM players WHERE auth_sub = $1', [sub]);
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  }

  async claim(id: string, sub: string): Promise<boolean> {
    try {
      const r = await this.pool.query('UPDATE players SET auth_sub = $2 WHERE id = $1 AND auth_sub IS NULL', [id, sub]);
      return r.rowCount === 1;
    } catch (err) {
      // auth_sub is unique: this identity has a character already.
      if ((err as { code?: unknown }).code === UNIQUE_VIOLATION) return false;
      throw err;
    }
  }

  async nameTaken(name: string): Promise<boolean> {
    const r = await this.pool.query('SELECT 1 FROM players WHERE lower(name) = lower($1)', [name]);
    return (r.rowCount ?? 0) > 0;
  }

  // jsonb parameters go in as JSON text: node-postgres would send a JS array as a Postgres array.
  async create(rec: PlayerRecord): Promise<boolean> {
    const r = await this.pool.query(
      `INSERT INTO players (id, name, token_hash, auth_sub, map, x, y, dir, color, energy, bag, wet, stats, xp, stash, gear, created_at, last_seen_at, tools,
         parcel_welcome, parcel_day, parcel_days, outfit, thanked, zone, rested, merits_spent, looks, pattern, badge, notebook)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13::jsonb, $14, $15::jsonb, $16::jsonb, $17, $18, $19::jsonb, $20, $21, $22, $23, $24, $25, $26, $27,
         $28::jsonb, $29, $30, $31::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        rec.id, rec.name, rec.tokenHash, rec.authSub, rec.map, rec.x, rec.y, rec.dir, rec.color, rec.energy, JSON.stringify(savedBag(rec)), rec.wet ?? 0, JSON.stringify(savedCounts(rec)),
        rec.xp ?? 0, JSON.stringify(rec.stash ?? { items: {}, out: {} }), rec.gear ? JSON.stringify(rec.gear) : null, new Date(rec.createdAt), new Date(rec.lastSeenAt),
        rec.tools ? JSON.stringify(rec.tools) : null, rec.parcels?.welcome ?? false, rec.parcels?.day ?? null, rec.parcels?.days ?? 0, rec.outfit ?? null,
        Math.max(0, Math.floor(rec.stats?.thanked ?? 0)), rec.zone ?? '', rec.rested ?? 0, rec.meritsSpent ?? 0, rec.looks?.length ? JSON.stringify(rec.looks) : null,
        rec.pattern ?? null, rec.badge ?? null, rec.notebook ? JSON.stringify(rec.notebook) : null,
      ],
    );
    return r.rowCount === 1;
  }

  async save(rec: PlayerRecord): Promise<void> {
    await this.pool.query(SAVE_PLAYER, saveParams(rec));
  }

  async saveTogether(recs: readonly PlayerRecord[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const rec of recs) await client.query(SAVE_PLAYER, saveParams(rec));
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async seen(id: string, at: number): Promise<boolean> {
    const r = await this.pool.query('UPDATE players SET last_seen_at = $2 WHERE id = $1 AND auth_sub IS NULL', [id, new Date(at)]);
    return r.rowCount === 1;
  }

  async forgetGuests(seenBefore: number): Promise<number> {
    // Their pile, marks, links, unread messages and thanks go with the row (ON DELETE CASCADE); a
    // report about them stays, without them (ON DELETE SET NULL). An index covers exactly these rows (011).
    const r = await this.pool.query('DELETE FROM players WHERE auth_sub IS NULL AND last_seen_at < $1', [new Date(seenBefore)]);
    return r.rowCount ?? 0;
  }

  async guestsSince(now: number): Promise<number> {
    await this.pool.query(`INSERT INTO world_state (key, value) VALUES ('guests_since', $1::jsonb) ON CONFLICT (key) DO NOTHING`, [JSON.stringify(now)]);
    const r = await this.pool.query<{ value: unknown }>("SELECT value FROM world_state WHERE key = 'guests_since'");
    const v = r.rows[0]?.value;
    return typeof v === 'number' && Number.isFinite(v) ? v : now;
  }

  async count(): Promise<number> {
    const r = await this.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM players');
    return r.rows[0]!.n;
  }

  async loadDrops(after: number): Promise<DropRecord[]> {
    await this.pool.query('DELETE FROM drops WHERE dropped_at <= $1', [new Date(after)]);
    const r = await this.pool.query<DropRow>(
      `SELECT d.owner, p.name, d.map, d.zone, d.x, d.y, d.items, d.dropped_at, d.trail
       FROM drops d JOIN players p ON p.id = d.owner
       ORDER BY d.dropped_at`,
    );
    return r.rows.map(d => ({
      owner: d.owner, name: d.name, map: d.map, ...(d.zone ? { zone: d.zone } : {}), x: d.x, y: d.y, items: slots(d.items), droppedAt: d.dropped_at.getTime(), trail: trail(d.trail),
    }));
  }

  async saveDrop(drop: DropRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO drops (owner, map, zone, x, y, items, dropped_at, trail) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb)
       ON CONFLICT (owner) DO UPDATE SET map = EXCLUDED.map, zone = EXCLUDED.zone, x = EXCLUDED.x, y = EXCLUDED.y, items = EXCLUDED.items, dropped_at = EXCLUDED.dropped_at,
         trail = EXCLUDED.trail`,
      [drop.owner, drop.map, drop.zone ?? '', drop.x, drop.y, JSON.stringify(drop.items), new Date(drop.droppedAt), JSON.stringify(drop.trail ?? [])],
    );
  }

  async removeDrop(owner: string): Promise<void> {
    await this.pool.query('DELETE FROM drops WHERE owner = $1', [owner]);
  }

  async loadMarks(now: number, lifetimeMs: number): Promise<MarkRecord[]> {
    await this.pool.query(`DELETE FROM marks WHERE COALESCE(fades_at, placed_at + $2 * interval '1 millisecond') <= $1`, [new Date(now), lifetimeMs]);
    const r = await this.pool.query<MarkRow>(
      `SELECT m.id, m.owner, p.name, p.color, m.map, m.zone, m.x, m.y, m.dir, m.placed_at, m.fades_at
       FROM marks m JOIN players p ON p.id = m.owner
       ORDER BY m.placed_at`,
    );
    return r.rows.map(m => ({
      id: Number(m.id), owner: m.owner, name: m.name, color: m.color, map: m.map, ...(m.zone ? { zone: m.zone } : {}), x: m.x, y: m.y, dir: m.dir, placedAt: m.placed_at.getTime(),
      ...(m.fades_at ? { until: m.fades_at.getTime() } : {}),
    }));
  }

  async saveMark(m: MarkRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO marks (id, owner, map, zone, x, y, dir, placed_at, fades_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET owner = EXCLUDED.owner, map = EXCLUDED.map, zone = EXCLUDED.zone, x = EXCLUDED.x, y = EXCLUDED.y, dir = EXCLUDED.dir,
         placed_at = EXCLUDED.placed_at, fades_at = EXCLUDED.fades_at`,
      [m.id, m.owner, m.map, m.zone ?? '', m.x, m.y, m.dir, new Date(m.placedAt), m.until === undefined ? null : new Date(m.until)],
    );
  }

  async removeMark(id: number): Promise<void> {
    await this.pool.query('DELETE FROM marks WHERE id = $1', [id]);
  }

  async loadThanks(after: number): Promise<ThanksRecord[]> {
    await this.forgetThanks(after + 1);
    const r = await this.pool.query<ThanksRow>(
      `SELECT t.giver, t.helper, t.day, t.at, t.what, t.told, p.name
       FROM thanks t JOIN players p ON p.id = t.giver
       ORDER BY t.at`,
    );
    return r.rows.flatMap(t => {
      const what = thanksFor(t.what);
      return what ? [{ giver: t.giver, helper: t.helper, day: t.day, at: t.at.getTime(), what, told: t.told, name: t.name }] : [];
    });
  }

  async saveThanks(t: ThanksRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO thanks (giver, helper, day, at, what, told) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (giver, helper, day) DO UPDATE SET told = EXCLUDED.told`,
      [t.giver, t.helper, t.day, new Date(t.at), JSON.stringify(t.what), t.told],
    );
  }

  async forgetThanks(before: number): Promise<number> {
    const r = await this.pool.query('DELETE FROM thanks WHERE at < $1', [new Date(before)]);
    return r.rowCount ?? 0;
  }

  async creditThanks(helper: string): Promise<void> {
    // One statement, on its own column: whatever else changes the player meanwhile, no thanks is lost.
    await this.pool.query('UPDATE players SET thanked = thanked + 1 WHERE id = $1', [helper]);
  }

  async loadCacheItems(): Promise<CacheItemRecord[]> {
    const r = await this.pool.query<CacheItemRow>(
      `SELECT c.id, c.map, c.zone, c.x, c.y, c.item, c.owner, p.name, c.left_at
       FROM cache_items c JOIN players p ON p.id = c.owner
       ORDER BY c.left_at, c.id`,
    );
    return r.rows.map(c => ({ id: Number(c.id), map: c.map, ...(c.zone ? { zone: c.zone } : {}), x: c.x, y: c.y, item: c.item, owner: c.owner, name: c.name, at: c.left_at.getTime() }));
  }

  async saveCacheItem(c: CacheItemRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO cache_items (id, map, zone, x, y, item, owner, left_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET map = EXCLUDED.map, zone = EXCLUDED.zone, x = EXCLUDED.x, y = EXCLUDED.y, item = EXCLUDED.item, owner = EXCLUDED.owner,
         left_at = EXCLUDED.left_at`,
      [c.id, c.map, c.zone ?? '', c.x, c.y, c.item, c.owner, new Date(c.at)],
    );
  }

  async removeCacheItem(id: number): Promise<void> {
    await this.pool.query('DELETE FROM cache_items WHERE id = $1', [id]);
  }

  async loadStone(): Promise<StoneRecord | null> {
    const r = await this.pool.query<{ value: unknown }>("SELECT value FROM world_state WHERE key = 'stone'");
    const v = r.rows[0]?.value as Partial<StoneRecord> | undefined;
    return v && typeof v.charge === 'number' && typeof v.awake === 'boolean' && typeof v.at === 'number' ? { charge: v.charge, awake: v.awake, at: v.at } : null;
  }

  async saveStone(stone: StoneRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO world_state (key, value) VALUES ('stone', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(stone)],
    );
  }

  async findPerson(by: { id: string } | { name: string }): Promise<PersonRecord | null> {
    type Row = { id: string; name: string; requests_off: boolean; trades_off: boolean; signed_in: boolean };
    const columns = 'id, name, requests_off, trades_off, auth_sub IS NOT NULL AS signed_in';
    const r = 'id' in by
      ? await this.pool.query<Row>(`SELECT ${columns} FROM players WHERE id = $1`, [by.id])
      : await this.pool.query<Row>(`SELECT ${columns} FROM players WHERE lower(name) = lower($1)`, [by.name]);
    const p = r.rows[0];
    return p ? { id: p.id, name: p.name, requestsOff: p.requests_off, tradesOff: p.trades_off, signedIn: p.signed_in } : null;
  }

  async setRequestsOff(id: string, off: boolean): Promise<void> {
    await this.pool.query('UPDATE players SET requests_off = $2 WHERE id = $1', [id, off]);
  }

  async setTradesOff(id: string, off: boolean): Promise<void> {
    await this.pool.query('UPDATE players SET trades_off = $2 WHERE id = $1', [id, off]);
  }

  async linksOf(id: string): Promise<LinkRecord[]> {
    const r = await this.pool.query<{ player: string; other: string; kind: LinkKind; from_name: string; to_name: string }>(
      `SELECT l.player, l.other, l.kind, a.name AS from_name, b.name AS to_name
       FROM links l JOIN players a ON a.id = l.player JOIN players b ON b.id = l.other
       WHERE l.player = $1 OR l.other = $1 ORDER BY l.since`,
      [id],
    );
    return r.rows.map(l => ({ from: l.player, to: l.other, kind: l.kind, fromName: l.from_name, toName: l.to_name }));
  }

  async setLink(from: string, to: string, kind: LinkKind, on: boolean): Promise<void> {
    if (on) await this.pool.query('INSERT INTO links (player, other, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [from, to, kind]);
    else await this.pool.query('DELETE FROM links WHERE player = $1 AND other = $2 AND kind = $3', [from, to, kind]);
  }

  async addTell(t: Omit<TellRecord, 'fromName'>): Promise<void> {
    await this.pool.query('INSERT INTO tells (sender, recipient, body, sent_at) VALUES ($1, $2, $3, $4)', [t.from, t.to, t.text, new Date(t.at)]);
  }

  async tellsTo(id: string): Promise<TellRecord[]> {
    const r = await this.pool.query<{ sender: string; name: string; body: string; sent_at: Date }>(
      'SELECT t.sender, p.name, t.body, t.sent_at FROM tells t JOIN players p ON p.id = t.sender WHERE t.recipient = $1 ORDER BY t.id',
      [id],
    );
    return r.rows.map(t => ({ from: t.sender, fromName: t.name, to: id, text: t.body, at: t.sent_at.getTime() }));
  }

  async deleteTells(to: string, from: string): Promise<void> {
    await this.pool.query('DELETE FROM tells WHERE recipient = $1 AND sender = $2', [to, from]);
  }

  async addReport(r: ReportRecord): Promise<void> {
    await this.pool.query('INSERT INTO reports (reporter, reported, reason, quote, made_at) VALUES ($1, $2, $3, $4, $5)', [r.reporter, r.reported, r.reason, r.quote, new Date(r.at)]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Applies every *.sql file in `dir` that has not run yet, in name order, each in its own
 * transaction (so a file must not contain BEGIN or COMMIT itself). Applied files are recorded
 * in schema_migrations and never run again: fix mistakes with a new file, not by editing an old one.
 */
async function migrate(pool: pg.Pool, dir: string): Promise<void> {
  const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [MIGRATION_LOCK]);
    try {
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
      const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(r => r.name));
      for (const file of files) {
        if (done.has(file)) continue;
        const sql = await readFile(join(dir, file), 'utf8');
        try {
          await client.query('BEGIN');
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw new Error(`migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        log.info('migration applied', { file });
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK]).catch(() => {});
    }
  } finally {
    client.release();
  }
}
