/**
 * PgStorage against a real database. Runs only when DATABASE_URL_TEST is set, for example
 * DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/postgres npx vitest run apps/server
 * Each run works in a schema of its own and drops it at the end.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setLogLevel } from '../src/log';
import { PgStorage, type PlayerRecord } from '../src/storage';

const url = process.env.DATABASE_URL_TEST;
const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));

describe.skipIf(!url)('PgStorage', () => {
  const schemas: string[] = [];
  let admin: pg.Client;
  let storage: PgStorage;

  /** A connection URL whose tables live in a new, empty schema. */
  async function freshSchema(): Promise<{ schema: string; url: string }> {
    const schema = `napoland_test_${randomBytes(4).toString('hex')}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    schemas.push(schema);
    const u = new URL(url!);
    u.searchParams.set('options', `-c search_path=${schema}`);
    return { schema, url: u.toString() };
  }

  const player = (name: string): PlayerRecord => ({
    id: randomUUID(), name, tokenHash: randomBytes(32).toString('hex'), map: 'stonebrook',
    x: 8, y: 21, dir: 'down', color: '#3a86ff', energy: 100, createdAt: 1_700_000_000_123, lastSeenAt: 1_700_000_000_456,
  });

  let schema: string;
  beforeAll(async () => {
    setLogLevel('silent');
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    const fresh = await freshSchema();
    schema = fresh.schema;
    storage = new PgStorage(fresh.url, MIGRATIONS);
    await storage.init();
  });
  afterAll(async () => {
    await storage?.close();
    for (const s of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
    await admin?.end();
  });

  it('applies each migration once', async () => {
    const names = async () => (await admin.query<{ name: string }>(`SELECT name FROM ${schema}.schema_migrations ORDER BY name`)).rows.map(r => r.name);
    expect(await names()).toEqual(['001_players.sql', '002_maps_energy.sql']);
    await storage.init();
    expect(await names()).toEqual(['001_players.sql', '002_maps_energy.sql']);
  });

  it('rolls back a migration that fails, and does not record it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'napoland-migrations-'));
    try {
      copyFileSync(join(MIGRATIONS, '001_players.sql'), join(dir, '001_players.sql'));
      writeFileSync(join(dir, '002_broken.sql'), 'CREATE TABLE half_done (id int);\nSELECT * FROM no_such_table;\n');
      const fresh = await freshSchema();
      const broken = new PgStorage(fresh.url, dir);
      await expect(broken.init()).rejects.toThrow(/002_broken\.sql/);
      await broken.close();
      const applied = await admin.query<{ name: string }>(`SELECT name FROM ${fresh.schema}.schema_migrations`);
      expect(applied.rows.map(r => r.name)).toEqual(['001_players.sql']);
      const half = await admin.query<{ t: string | null }>(`SELECT to_regclass('${fresh.schema}.half_done')::text AS t`);
      expect(half.rows[0]!.t).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates, finds and saves players, times in ms', async () => {
    const rec = player('Pg Aldo');
    expect(await storage.create(rec)).toBe(true);
    expect(await storage.findByTokenHash(rec.tokenHash)).toEqual(rec);
    expect(await storage.findByTokenHash('0'.repeat(64))).toBeNull();
    const moved = { ...rec, x: 9, y: 22, dir: 'right' as const, lastSeenAt: 1_800_000_000_789 };
    await storage.save(moved);
    expect(await storage.findByTokenHash(rec.tokenHash)).toEqual(moved);
  });

  it('keeps the map and the energy', async () => {
    const rec = { ...player('Pg Wanderer'), map: 'near-woods', x: 31, y: 70, energy: 42.5 };
    expect(await storage.create(rec)).toBe(true);
    expect(await storage.findByTokenHash(rec.tokenHash)).toEqual(rec);
    // Energy comes and goes in fractions; a real column keeps plenty of them.
    const later = { ...rec, map: 'stonebrook', x: 8, y: 21, energy: 97.3, lastSeenAt: 1_800_000_000_001 };
    await storage.save(later);
    expect(await storage.findByTokenHash(rec.tokenHash)).toEqual(later);
    await storage.save({ ...later, energy: 12.345678 });
    expect((await storage.findByTokenHash(rec.tokenHash))!.energy).toBeCloseTo(12.345678, 4);
  });

  it('still takes players from the previous release, which knows nothing of maps and energy', async () => {
    // The insert of the release before this schema: after a rollback, it runs on the new columns.
    const old = player('Pg Old');
    await admin.query(
      `INSERT INTO ${schema}.players (id, name, token_hash, x, y, dir, color, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [old.id, old.name, old.tokenHash, old.x, old.y, old.dir, old.color, new Date(old.createdAt), new Date(old.lastSeenAt)],
    );
    expect(await storage.findByTokenHash(old.tokenHash)).toEqual({ ...old, map: 'stonebrook', energy: 100 });
  });

  it('keeps names unique regardless of case', async () => {
    const before = await storage.count();
    expect(await storage.create(player('Pg Bea'))).toBe(true);
    expect(await storage.nameTaken('pg bea')).toBe(true);
    expect(await storage.nameTaken('PG BEA')).toBe(true);
    expect(await storage.nameTaken('Pg Cid')).toBe(false);
    expect(await storage.create(player('PG BEA'))).toBe(false);
    expect(await storage.count()).toBe(before + 1);
  });
});
