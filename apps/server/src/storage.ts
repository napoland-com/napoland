/**
 * Where players are kept between sessions. Postgres in production; memory for tests and for
 * running without a database (everything is forgotten on restart).
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import type { Dir } from '@napoland/shared';
import { log } from './log';

export interface PlayerRecord {
  /** A random UUID. */
  id: string;
  name: string;
  /** SHA-256 of the login token, hex. The token itself is never stored. */
  tokenHash: string;
  x: number;
  y: number;
  dir: Dir;
  color: string;
  /** Milliseconds since the epoch. */
  createdAt: number;
  lastSeenAt: number;
}

export interface Storage {
  init(): Promise<void>;
  findByTokenHash(hash: string): Promise<PlayerRecord | null>;
  /** Names are unique regardless of case. */
  nameTaken(name: string): Promise<boolean>;
  /** False if the name was taken in the meantime (two players racing for it). */
  create(rec: PlayerRecord): Promise<boolean>;
  /** Stores what changes while playing: position, direction, color and lastSeenAt. */
  save(rec: PlayerRecord): Promise<void>;
  /** How many players exist. */
  count(): Promise<number>;
  close(): Promise<void>;
}

export class MemoryStorage implements Storage {
  private readonly byId = new Map<string, PlayerRecord>();
  private readonly idByToken = new Map<string, string>();
  private readonly idByName = new Map<string, string>();

  async init(): Promise<void> {}

  async findByTokenHash(hash: string): Promise<PlayerRecord | null> {
    const id = this.idByToken.get(hash);
    return id === undefined ? null : { ...this.byId.get(id)! };
  }

  async nameTaken(name: string): Promise<boolean> {
    return this.idByName.has(name.toLowerCase());
  }

  async create(rec: PlayerRecord): Promise<boolean> {
    const name = rec.name.toLowerCase();
    if (this.byId.has(rec.id) || this.idByToken.has(rec.tokenHash) || this.idByName.has(name)) return false;
    this.byId.set(rec.id, { ...rec });
    this.idByToken.set(rec.tokenHash, rec.id);
    this.idByName.set(name, rec.id);
    return true;
  }

  async save(rec: PlayerRecord): Promise<void> {
    const cur = this.byId.get(rec.id);
    if (cur) Object.assign(cur, { x: rec.x, y: rec.y, dir: rec.dir, color: rec.color, lastSeenAt: rec.lastSeenAt });
  }

  async count(): Promise<number> {
    return this.byId.size;
  }

  async close(): Promise<void> {}

  /** The stored copy of a player, for tests. */
  get(id: string): PlayerRecord | undefined {
    const rec = this.byId.get(id);
    return rec && { ...rec };
  }
}

interface PlayerRow {
  id: string;
  name: string;
  token_hash: string;
  x: number;
  y: number;
  dir: Dir;
  color: string;
  created_at: Date;
  last_seen_at: Date;
}

const fromRow = (r: PlayerRow): PlayerRecord => ({
  id: r.id,
  name: r.name,
  tokenHash: r.token_hash,
  x: r.x,
  y: r.y,
  dir: r.dir,
  color: r.color,
  createdAt: r.created_at.getTime(),
  lastSeenAt: r.last_seen_at.getTime(),
});

/** Held while migrating, so two servers starting together do not both apply the same file. */
const MIGRATION_LOCK = 4_815_162_342;

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

  async nameTaken(name: string): Promise<boolean> {
    const r = await this.pool.query('SELECT 1 FROM players WHERE lower(name) = lower($1)', [name]);
    return (r.rowCount ?? 0) > 0;
  }

  async create(rec: PlayerRecord): Promise<boolean> {
    const r = await this.pool.query(
      `INSERT INTO players (id, name, token_hash, x, y, dir, color, created_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT DO NOTHING`,
      [rec.id, rec.name, rec.tokenHash, rec.x, rec.y, rec.dir, rec.color, new Date(rec.createdAt), new Date(rec.lastSeenAt)],
    );
    return r.rowCount === 1;
  }

  async save(rec: PlayerRecord): Promise<void> {
    await this.pool.query('UPDATE players SET x = $2, y = $3, dir = $4, color = $5, last_seen_at = $6 WHERE id = $1', [
      rec.id,
      rec.x,
      rec.y,
      rec.dir,
      rec.color,
      new Date(rec.lastSeenAt),
    ]);
  }

  async count(): Promise<number> {
    const r = await this.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM players');
    return r.rows[0]!.n;
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
