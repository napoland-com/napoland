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
import { DROP_LIFETIME_MS } from '@napoland/shared';
import { setLogLevel } from '../src/log';
import { PgStorage, type DropRecord, type PlayerRecord } from '../src/storage';
import { restartKeepsBagsAndPiles, signInAndClaim } from './helpers';

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

  const player = (name: string): PlayerRecord & { tokenHash: string } => ({
    id: randomUUID(), name, tokenHash: randomBytes(32).toString('hex'), authSub: null, map: 'stonebrook',
    x: 8, y: 21, dir: 'down', color: '#3a86ff', energy: 100, bag: [], createdAt: 1_700_000_000_123, lastSeenAt: 1_700_000_000_456,
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
    const all = ['001_players.sql', '002_maps_energy.sql', '003_bag_drops.sql', '004_sign_in.sql'];
    const names = async () => (await admin.query<{ name: string }>(`SELECT name FROM ${schema}.schema_migrations ORDER BY name`)).rows.map(r => r.name);
    expect(await names()).toEqual(all);
    await storage.init();
    expect(await names()).toEqual(all);
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

  it('still takes players from the previous releases, which know nothing of maps, energy or bags', async () => {
    // The inserts of the releases before these schemas: after a rollback, they run on the new columns.
    const old = player('Pg Old');
    await admin.query(
      `INSERT INTO ${schema}.players (id, name, token_hash, x, y, dir, color, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [old.id, old.name, old.tokenHash, old.x, old.y, old.dir, old.color, new Date(old.createdAt), new Date(old.lastSeenAt)],
    );
    expect(await storage.findByTokenHash(old.tokenHash)).toEqual({ ...old, map: 'stonebrook', energy: 100, bag: [] });
    const before = { ...player('Pg Before'), map: 'near-woods', energy: 55 };
    await admin.query(
      `INSERT INTO ${schema}.players (id, name, token_hash, map, x, y, dir, color, energy, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [before.id, before.name, before.tokenHash, before.map, before.x, before.y, before.dir, before.color, before.energy, new Date(before.createdAt), new Date(before.lastSeenAt)],
    );
    expect(await storage.findByTokenHash(before.tokenHash)).toEqual({ ...before, bag: [] });
    // Its save leaves the bag alone.
    await storage.save({ ...before, bag: [{ item: 'resin', count: 4 }] });
    await admin.query(`UPDATE ${schema}.players SET map = $2, x = $3, y = $4, dir = $5, color = $6, energy = $7, last_seen_at = $8 WHERE id = $1`, [
      before.id, 'stonebrook', 8, 21, 'down', before.color, 90, new Date(before.lastSeenAt),
    ]);
    expect((await storage.findByTokenHash(before.tokenHash))!.bag).toEqual([{ item: 'resin', count: 4 }]);
  });

  it('keeps the bag, slot by slot, through create and save', async () => {
    const bag = [{ item: 'glowcap', count: 20 }, { item: 'thermos', count: 1 }, { item: 'glowcap', count: 3 }];
    const rec = { ...player('Pg Carrier'), bag };
    expect(await storage.create(rec)).toBe(true);
    expect((await storage.findByTokenHash(rec.tokenHash))!.bag).toEqual(bag);
    await storage.save({ ...rec, bag: [{ item: 'shard', count: 2 }] });
    expect((await storage.findByTokenHash(rec.tokenHash))!.bag).toEqual([{ item: 'shard', count: 2 }]);
    await storage.save({ ...rec, bag: [] });
    expect((await storage.findByTokenHash(rec.tokenHash))!.bag).toEqual([]);
    // Whatever else the column holds reads as an empty bag (the World checks each slot too).
    await admin.query(`UPDATE ${schema}.players SET bag = '{"not": "a list"}' WHERE id = $1`, [rec.id]);
    expect((await storage.findByTokenHash(rec.tokenHash))!.bag).toEqual([]);
  });

  it('keeps one pile per player, with the owner\'s name, and forgets piles older than asked', async () => {
    const owner = player('Pg Faller');
    const other = player('Pg Other');
    await storage.create(owner);
    await storage.create(other);
    const now = Date.now();
    const pile: DropRecord = { owner: owner.id, name: owner.name, map: 'near-woods', x: 31, y: 70, items: [{ item: 'glowcap', count: 5 }, { item: 'scrap', count: 2 }], droppedAt: now - 1000 };
    await storage.saveDrop(pile);
    const mine = async () => (await storage.loadDrops(now - DROP_LIFETIME_MS)).filter(d => d.owner === owner.id);
    expect(await mine()).toEqual([pile]);
    // A new collapse replaces it.
    const again = { ...pile, map: 'stonebrook-lodge', x: 2, y: 3, items: [{ item: 'thermos', count: 1 }], droppedAt: now };
    await storage.saveDrop(again);
    expect(await mine()).toEqual([again]);
    // The name comes from the player, whatever the pile says.
    await storage.saveDrop({ ...pile, owner: other.id, name: 'Somebody Else', droppedAt: now - DROP_LIFETIME_MS - 1 });
    const count = async () => (await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${schema}.drops WHERE owner = $1`, [other.id])).rows[0]!.n;
    expect(await count()).toBe(1);
    expect((await storage.loadDrops(now - DROP_LIFETIME_MS - 10)).find(d => d.owner === other.id)).toMatchObject({ name: other.name });
    // Older than an hour: not loaded, and gone from the table.
    expect((await storage.loadDrops(now - DROP_LIFETIME_MS)).map(d => d.owner)).not.toContain(other.id);
    expect(await count()).toBe(0);
    await storage.removeDrop(owner.id);
    expect(await mine()).toEqual([]);
    await storage.removeDrop(owner.id); // already gone: nothing happens
  });

  it('refuses a pile of a player who does not exist', async () => {
    await expect(storage.saveDrop({ owner: randomUUID(), name: 'Nobody', map: 'stonebrook', x: 1, y: 1, items: [], droppedAt: Date.now() })).rejects.toThrow(/foreign key/);
  });

  it('keeps bags and piles through a restart of the server', async () => {
    const fresh = await freshSchema();
    const first = new PgStorage(fresh.url, MIGRATIONS);
    const second = new PgStorage(fresh.url, MIGRATIONS);
    try {
      await first.init();
      await second.init();
      const stored = async (owner: string) => ((await admin.query(`SELECT 1 FROM ${fresh.schema}.drops WHERE owner = $1`, [owner])).rowCount ?? 0) > 0;
      await restartKeepsBagsAndPiles(first, second, stored);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it('finds a character by who signed in with it, and lets each be claimed once, by an identity without one', async () => {
    const old = player('Pg Before Sign-in');
    const other = player('Pg Also Before');
    expect(await storage.create(old)).toBe(true);
    expect(await storage.create(other)).toBe(true);
    expect(await storage.findByAuthSub('user-a')).toBeNull();

    expect(await storage.claim(old.id, 'user-a')).toBe(true);
    expect(await storage.findByAuthSub('user-a')).toEqual({ ...old, authSub: 'user-a' });
    expect(await storage.findByTokenHash(old.tokenHash)).toEqual({ ...old, authSub: 'user-a' });
    // Claimed already: not again, by anyone.
    expect(await storage.claim(old.id, 'user-b')).toBe(false);
    expect(await storage.claim(old.id, 'user-a')).toBe(false);
    // user-a has a character: not a second one, claimed or new.
    expect(await storage.claim(other.id, 'user-a')).toBe(false);
    expect(await storage.create({ ...player('Pg Second'), tokenHash: null, authSub: 'user-a' })).toBe(false);
    expect((await storage.findByTokenHash(other.tokenHash))!.authSub).toBeNull();
    expect(await storage.claim(randomUUID(), 'user-c')).toBe(false);
  });

  it('makes characters after sign-in without a token, as many as there are identities', async () => {
    const one = { ...player('Pg Signed One'), tokenHash: null, authSub: 'user-one' };
    const two = { ...player('Pg Signed Two'), tokenHash: null, authSub: 'user-two' };
    expect(await storage.create(one)).toBe(true);
    expect(await storage.create(two)).toBe(true);
    expect(await storage.findByAuthSub('user-one')).toEqual(one);
    expect(await storage.findByAuthSub('user-two')).toEqual(two);
    const moved = { ...two, x: 3, y: 4, lastSeenAt: 1_800_000_000_002 };
    await storage.save(moved);
    expect(await storage.findByAuthSub('user-two')).toEqual(moved);
  });

  it('signs in and claims over the network', async () => {
    const fresh = await freshSchema();
    const pgStorage = new PgStorage(fresh.url, MIGRATIONS);
    try {
      await pgStorage.init();
      await signInAndClaim(pgStorage);
    } finally {
      await pgStorage.close();
    }
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
