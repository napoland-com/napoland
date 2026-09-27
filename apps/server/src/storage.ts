/**
 * Where players are kept between sessions, with what they carry, and the piles dropped when someone
 * collapsed. Postgres in production; memory for tests and for running without a database
 * (everything is forgotten on restart).
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import type { BagSlot, Dir, Gear, Piece, ReportReason, Stash, Stats, Worn } from '@napoland/shared';
import { log } from './log';

export interface PlayerRecord {
  /** A random UUID. */
  id: string;
  name: string;
  /**
   * SHA-256 of the login token of a character made without sign-in, hex. The token itself is never
   * stored. Null for characters made after sign-in: they have no token.
   */
  tokenHash: string | null;
  /**
   * Who signed in with this character (auth.ts): Supabase's user id, or "dev:" and an email. Null
   * for a character made before sign-in that nobody has claimed yet. One character per identity.
   */
  authSub: string | null;
  /** The id of the map the player is on. */
  map: string;
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
  /** What counts toward feats (feats.ts). None: nothing yet. */
  stats?: Stats;
  /** XP in all (progress.ts): the level follows from it. None: 0. */
  xp?: number;
  /** What lies in the player's stash at home, and what they took out of it. None: empty. */
  stash?: Stash;
  /** What the player wears, by slot. None: they never chose, and wear the starter gear. */
  gear?: Gear;
  /** The condition and quirk of each piece worn, by slot. None: as good as new. */
  worn?: Worn;
  /** The id of the latest chapter of the story the player reached (story.ts). None: they never started. */
  story?: string;
  /** Milliseconds since the epoch. */
  createdAt: number;
  lastSeenAt: number;
}

/** What a player carried when they last collapsed, lying where they fell. One per player. */
export interface DropRecord {
  /** The player who collapsed; their id is the pile's id too. */
  owner: string;
  /** The owner's name, shown with the pile. Not stored with it: it comes from the player. */
  name: string;
  map: string;
  x: number;
  y: number;
  items: BagSlot[];
  /** When they collapsed, ms since the epoch. The pile fades DROP_LIFETIME_MS later. */
  droppedAt: number;
  /** The last tiles they walked out there, oldest first: their echo walks them. None: no echo. */
  trail?: Array<[number, number]>;
}

/** An arrow someone painted on the ground. Each player has a few; they fade a day after. */
export interface MarkRecord {
  id: number;
  owner: string;
  /** The owner's name and jacket color, shown with it. Not stored with it: they come from the player. */
  name: string;
  color: string;
  map: string;
  x: number;
  y: number;
  dir: Dir;
  /** ms since the epoch. */
  placedAt: number;
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

/** Someone as a friend request finds them: who, and whether they take requests. */
export interface PersonRecord {
  id: string;
  name: string;
  requestsOff: boolean;
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
  /** Stores what changes while playing: map, position, direction, energy, bag, color and lastSeenAt. */
  save(rec: PlayerRecord): Promise<void>;
  /** How many players exist. */
  count(): Promise<number>;
  /** Every pile dropped after `after` (ms since the epoch), oldest first. Older ones have faded: they are forgotten. */
  loadDrops(after: number): Promise<DropRecord[]>;
  /** Stores a player's pile, in place of the one they had. */
  saveDrop(drop: DropRecord): Promise<void>;
  removeDrop(owner: string): Promise<void>;
  /** Every mark placed after `after` (ms since the epoch); older ones have faded and are forgotten. */
  loadMarks(after: number): Promise<MarkRecord[]>;
  saveMark(mark: MarkRecord): Promise<void>;
  removeMark(id: number): Promise<void>;
  /** The Old Stone as it was last saved, or null. */
  loadStone(): Promise<StoneRecord | null>;
  saveStone(stone: StoneRecord): Promise<void>;
  /** A player by id, or by name regardless of case. */
  findPerson(by: { id: string } | { name: string }): Promise<PersonRecord | null>;
  setRequestsOff(id: string, off: boolean): Promise<void>;
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

// A live find keeps when it was picked (`since`), so it goes on fading across a restart.
const copyBag = (bag: readonly BagSlot[]): BagSlot[] => bag.map(s => ({ item: s.item, count: s.count, ...(s.since !== undefined ? { since: s.since } : {}) }));
const copyPieces = (p: Record<string, Piece[]>): Record<string, Piece[]> => Object.fromEntries(Object.entries(p).map(([id, list]) => [id, list.map(x => ({ ...x }))]));
const copyStash = (s: Stash): Stash => ({ items: { ...s.items }, out: { ...s.out }, ...(s.pieces ? { pieces: copyPieces(s.pieces) } : {}) });
const copyWorn = (w: Worn): Worn => Object.fromEntries(Object.entries(w).map(([slot, p]) => [slot, { ...p }]));
const copyRecord = (rec: PlayerRecord): PlayerRecord => ({
  ...rec, bag: copyBag(rec.bag), ...(rec.stats ? { stats: { ...rec.stats } } : {}), ...(rec.stash ? { stash: copyStash(rec.stash) } : {}),
  ...(rec.gear ? { gear: { ...rec.gear } } : {}), ...(rec.worn ? { worn: copyWorn(rec.worn) } : {}),
});

export class MemoryStorage implements Storage {
  private readonly byId = new Map<string, PlayerRecord>();
  private readonly idByToken = new Map<string, string>();
  private readonly idBySub = new Map<string, string>();
  private readonly idByName = new Map<string, string>();
  private readonly drops = new Map<string, Omit<DropRecord, 'name'>>();
  private readonly marks = new Map<number, Omit<MarkRecord, 'name' | 'color'>>();
  private stone: StoneRecord | null = null;
  private readonly off = new Set<string>();
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
    this.byId.set(rec.id, copyRecord(rec));
    if (rec.tokenHash !== null) this.idByToken.set(rec.tokenHash, rec.id);
    if (rec.authSub !== null) this.idBySub.set(rec.authSub, rec.id);
    this.idByName.set(name, rec.id);
    return true;
  }

  async save(rec: PlayerRecord): Promise<void> {
    const cur = this.byId.get(rec.id);
    if (cur) {
      Object.assign(cur, {
        map: rec.map, x: rec.x, y: rec.y, dir: rec.dir, color: rec.color, energy: rec.energy, bag: copyBag(rec.bag), wet: rec.wet ?? 0, stats: { ...rec.stats },
        xp: rec.xp ?? 0, stash: rec.stash ? copyStash(rec.stash) : { items: {}, out: {} }, ...(rec.gear ? { gear: { ...rec.gear } } : {}),
        ...(rec.worn ? { worn: copyWorn(rec.worn) } : {}), ...(rec.story ? { story: rec.story } : {}), lastSeenAt: rec.lastSeenAt,
      });
    }
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
    this.drops.set(drop.owner, { ...stored, items: copyBag(drop.items) });
  }

  async removeDrop(owner: string): Promise<void> {
    this.drops.delete(owner);
  }

  async loadMarks(after: number): Promise<MarkRecord[]> {
    const out: MarkRecord[] = [];
    for (const [id, m] of this.marks) {
      const owner = this.byId.get(m.owner);
      if (m.placedAt <= after || !owner) this.marks.delete(id);
      else out.push({ ...m, name: owner.name, color: owner.color });
    }
    return out.sort((a, b) => a.placedAt - b.placedAt);
  }

  async saveMark(mark: MarkRecord): Promise<void> {
    if (!this.byId.has(mark.owner)) throw new Error(`there is no player ${mark.owner}`);
    const { name: _name, color: _color, ...stored } = mark;
    this.marks.set(mark.id, stored);
  }

  async removeMark(id: number): Promise<void> {
    this.marks.delete(id);
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
    return rec ? { id: rec.id, name: rec.name, requestsOff: this.off.has(rec.id) } : null;
  }

  async setRequestsOff(id: string, off: boolean): Promise<void> {
    if (off) this.off.add(id);
    else this.off.delete(id);
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
  stash: unknown;
  /** Null for a player who never chose their gear. */
  gear: unknown;
  /** Null for a player whose pieces were never worn down. */
  worn: unknown;
  /** Null for a player who never started the story. */
  story: string | null;
  created_at: Date;
  last_seen_at: Date;
}

interface DropRow {
  owner: string;
  name: string;
  map: string;
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
  x: number;
  y: number;
  dir: Dir;
  placed_at: Date;
}

/** A jsonb list of slots as the server wrote it; anything else reads as empty (the World checks each slot again). */
const slots = (json: unknown): BagSlot[] => (Array.isArray(json) ? (json as BagSlot[]) : []);
/** A jsonb trail of [x, y] tiles as the server wrote it; anything else reads as none. */
const trail = (json: unknown): Array<[number, number]> =>
  Array.isArray(json) ? json.filter((t): t is [number, number] => Array.isArray(t) && t.length === 2 && t.every(Number.isInteger)) : [];
/** A jsonb object of counts as the server wrote it; anything else reads as none (the World checks it again). */
const stats = (json: unknown): Stats => (typeof json === 'object' && json !== null && !Array.isArray(json) ? (json as Stats) : {});
/** A jsonb stash as the server wrote it; anything else reads as empty (the World checks every count too). */
const stash = (json: unknown): Stash => {
  const o = (typeof json === 'object' && json !== null && !Array.isArray(json) ? json : {}) as Partial<Stash>;
  const rec = (v: unknown) => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, number>) : {});
  return { items: rec(o.items), out: rec(o.out), ...(o.pieces && typeof o.pieces === 'object' ? { pieces: o.pieces as Record<string, Piece[]> } : {}) };
};

const fromRow = (r: PlayerRow): PlayerRecord => ({
  id: r.id,
  name: r.name,
  tokenHash: r.token_hash,
  authSub: r.auth_sub,
  map: r.map,
  x: r.x,
  y: r.y,
  dir: r.dir,
  color: r.color,
  energy: r.energy,
  bag: slots(r.bag),
  wet: r.wet,
  stats: stats(r.stats),
  xp: r.xp,
  stash: stash(r.stash),
  ...(r.gear && typeof r.gear === 'object' && !Array.isArray(r.gear) ? { gear: r.gear as Gear } : {}),
  // What the World checks again when the player joins.
  ...(r.worn && typeof r.worn === 'object' && !Array.isArray(r.worn) ? { worn: r.worn as Worn } : {}),
  ...(r.story ? { story: r.story } : {}),
  createdAt: r.created_at.getTime(),
  lastSeenAt: r.last_seen_at.getTime(),
});

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
      `INSERT INTO players (id, name, token_hash, auth_sub, map, x, y, dir, color, energy, bag, wet, stats, xp, stash, gear, created_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13::jsonb, $14, $15::jsonb, $16::jsonb, $17, $18)
       ON CONFLICT DO NOTHING`,
      [
        rec.id, rec.name, rec.tokenHash, rec.authSub, rec.map, rec.x, rec.y, rec.dir, rec.color, rec.energy, JSON.stringify(rec.bag), rec.wet ?? 0, JSON.stringify(rec.stats ?? {}),
        rec.xp ?? 0, JSON.stringify(rec.stash ?? { items: {}, out: {} }), rec.gear ? JSON.stringify(rec.gear) : null, new Date(rec.createdAt), new Date(rec.lastSeenAt),
      ],
    );
    return r.rowCount === 1;
  }

  async save(rec: PlayerRecord): Promise<void> {
    await this.pool.query(
      `UPDATE players SET map = $2, x = $3, y = $4, dir = $5, color = $6, energy = $7, bag = $8::jsonb, wet = $9, stats = $10::jsonb, xp = $11, stash = $12::jsonb,
       gear = $14::jsonb, worn = $15::jsonb, story = COALESCE($16::text, story), last_seen_at = $13 WHERE id = $1`,
      [
        rec.id, rec.map, rec.x, rec.y, rec.dir, rec.color, rec.energy, JSON.stringify(rec.bag), rec.wet ?? 0, JSON.stringify(rec.stats ?? {}), rec.xp ?? 0,
        JSON.stringify(rec.stash ?? { items: {}, out: {} }), new Date(rec.lastSeenAt), rec.gear ? JSON.stringify(rec.gear) : null, rec.worn ? JSON.stringify(rec.worn) : null,
        rec.story ?? null,
      ],
    );
  }

  async count(): Promise<number> {
    const r = await this.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM players');
    return r.rows[0]!.n;
  }

  async loadDrops(after: number): Promise<DropRecord[]> {
    await this.pool.query('DELETE FROM drops WHERE dropped_at <= $1', [new Date(after)]);
    const r = await this.pool.query<DropRow>(
      `SELECT d.owner, p.name, d.map, d.x, d.y, d.items, d.dropped_at, d.trail
       FROM drops d JOIN players p ON p.id = d.owner
       ORDER BY d.dropped_at`,
    );
    return r.rows.map(d => ({ owner: d.owner, name: d.name, map: d.map, x: d.x, y: d.y, items: slots(d.items), droppedAt: d.dropped_at.getTime(), trail: trail(d.trail) }));
  }

  async saveDrop(drop: DropRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO drops (owner, map, x, y, items, dropped_at, trail) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb)
       ON CONFLICT (owner) DO UPDATE SET map = EXCLUDED.map, x = EXCLUDED.x, y = EXCLUDED.y, items = EXCLUDED.items, dropped_at = EXCLUDED.dropped_at, trail = EXCLUDED.trail`,
      [drop.owner, drop.map, drop.x, drop.y, JSON.stringify(drop.items), new Date(drop.droppedAt), JSON.stringify(drop.trail ?? [])],
    );
  }

  async removeDrop(owner: string): Promise<void> {
    await this.pool.query('DELETE FROM drops WHERE owner = $1', [owner]);
  }

  async loadMarks(after: number): Promise<MarkRecord[]> {
    await this.pool.query('DELETE FROM marks WHERE placed_at <= $1', [new Date(after)]);
    const r = await this.pool.query<MarkRow>(
      `SELECT m.id, m.owner, p.name, p.color, m.map, m.x, m.y, m.dir, m.placed_at
       FROM marks m JOIN players p ON p.id = m.owner
       ORDER BY m.placed_at`,
    );
    return r.rows.map(m => ({ id: Number(m.id), owner: m.owner, name: m.name, color: m.color, map: m.map, x: m.x, y: m.y, dir: m.dir, placedAt: m.placed_at.getTime() }));
  }

  async saveMark(m: MarkRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO marks (id, owner, map, x, y, dir, placed_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET owner = EXCLUDED.owner, map = EXCLUDED.map, x = EXCLUDED.x, y = EXCLUDED.y, dir = EXCLUDED.dir, placed_at = EXCLUDED.placed_at`,
      [m.id, m.owner, m.map, m.x, m.y, m.dir, new Date(m.placedAt)],
    );
  }

  async removeMark(id: number): Promise<void> {
    await this.pool.query('DELETE FROM marks WHERE id = $1', [id]);
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
    const r = 'id' in by
      ? await this.pool.query<{ id: string; name: string; requests_off: boolean }>('SELECT id, name, requests_off FROM players WHERE id = $1', [by.id])
      : await this.pool.query<{ id: string; name: string; requests_off: boolean }>('SELECT id, name, requests_off FROM players WHERE lower(name) = lower($1)', [by.name]);
    const p = r.rows[0];
    return p ? { id: p.id, name: p.name, requestsOff: p.requests_off } : null;
  }

  async setRequestsOff(id: string, off: boolean): Promise<void> {
    await this.pool.query('UPDATE players SET requests_off = $2 WHERE id = $1', [id, off]);
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
