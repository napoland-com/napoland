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
import { DROP_LIFETIME_MS, utcDay } from '@napoland/shared';
import { setLogLevel } from '../src/log';
import { PgStorage, type CacheItemRecord, type DropRecord, type MarkRecord, type PlayerRecord, type ThanksRecord } from '../src/storage';
import {
  forgetsGuestsWhoStayedAway, keepsFirsts, keepsFriendsAndMessages, keepsMerits, keepsBests, keepsNotebook, keepsNotes, keepsParcels, keepsPurchases, keepsRested,
  keepsToolsParcelsAndOutfit, keepsTheWornOutMark, keepsWhatANewerReleaseSaved, keepsWholeRow, meritsKeptThroughARestart, outfitsKeptThroughARestart, parcelsThroughRestarts,
  playFirstThenSignIn, restKeptThroughARestart, restartKeepsBagsAndPiles, savesATradeTogether, shopKeptThroughARestart, signInAndClaim,
} from './helpers';
import { itemsData } from './fixtures';

const url = process.env.DATABASE_URL_TEST;
const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));
const DAY = 86_400_000;

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
    x: 8, y: 21, dir: 'down', color: '#3a86ff', energy: 100, bag: [], wet: 0, stats: {}, xp: 0, stash: { items: {}, out: {} }, createdAt: 1_700_000_000_123, lastSeenAt: 1_700_000_000_456,
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
    const all = [
      '001_players.sql', '002_maps_energy.sql', '003_bag_drops.sql', '004_sign_in.sql', '005_survival.sql', '006_stash_xp.sql', '007_gear.sql', '008_friends.sql', '009_worn.sql', '010_story.sql',
      '011_guests.sql', '012_tools.sql', '013_parcels.sql', '014_outfits.sql', '015_thanks.sql', '016_caches.sql', '017_zones.sql', '018_rested.sql', '019_merits.sql',
      '020_trades_off.sql', '021_notebook.sql', '022_notes.sql', '023_firsts.sql', '024_furniture.sql', '025_streets.sql', '026_door.sql',
      '027_bests.sql', '028_visits.sql', '029_first_steps.sql', '035_purchases.sql',
    ];
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
    expect(await storage.findByTokenHash(old.tokenHash)).toEqual({ ...old, map: 'stonebrook', energy: 100, bag: [], wet: 0, stats: {}, xp: 0, stash: { items: {}, out: {} } });
    const before = { ...player('Pg Before'), map: 'near-woods', energy: 55 };
    await admin.query(
      `INSERT INTO ${schema}.players (id, name, token_hash, map, x, y, dir, color, energy, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [before.id, before.name, before.tokenHash, before.map, before.x, before.y, before.dir, before.color, before.energy, new Date(before.createdAt), new Date(before.lastSeenAt)],
    );
    expect(await storage.findByTokenHash(before.tokenHash)).toEqual({ ...before, bag: [], wet: 0, stats: {}, xp: 0, stash: { items: {}, out: {} } });
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
    const pile: DropRecord = {
      owner: owner.id, name: owner.name, map: 'near-woods', x: 31, y: 70, items: [{ item: 'glowcap', count: 5 }, { item: 'scrap', count: 2 }], droppedAt: now - 1000,
      trail: [[31, 72], [31, 71], [31, 70]],
    };
    await storage.saveDrop(pile);
    const mine = async () => (await storage.loadDrops(now - DROP_LIFETIME_MS)).filter(d => d.owner === owner.id);
    expect(await mine()).toEqual([pile]);
    // A new collapse replaces it.
    const again = { ...pile, map: 'stonebrook-lodge', x: 2, y: 3, items: [{ item: 'thermos', count: 1 }], droppedAt: now, trail: [] };
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

  it('keeps the copy of its map a player is in, and the copy a pile, a mark and a thing in a crate lie in; the main copy reads as none', async () => {
    const rec = { ...player('Pg Copier'), map: 'field', zone: 'copy-1' };
    expect(await storage.create(rec)).toBe(true);
    expect(await storage.findByTokenHash(rec.tokenHash)).toEqual(rec);
    // Back in the main copy: every save says where they are.
    const { zone: _zone, ...back } = { ...rec, map: 'stonebrook', lastSeenAt: 1_800_000_000_003 };
    await storage.save(back);
    expect(await storage.findByTokenHash(rec.tokenHash)).toEqual(back);
    await storage.save({ ...back, map: 'field', zone: 'copy-2' });
    expect((await storage.findByTokenHash(rec.tokenHash))!.zone).toBe('copy-2');
    // The release before zones saves without the column: after a rollback, it leaves the copy as it was (the World follows it only where it still makes sense).
    await admin.query(`UPDATE ${schema}.players SET map = $2, x = $3, y = $4, last_seen_at = $5 WHERE id = $1`, [rec.id, 'stonebrook', 8, 21, new Date(rec.lastSeenAt)]);
    expect(await storage.findByTokenHash(rec.tokenHash)).toMatchObject({ map: 'stonebrook', zone: 'copy-2' });

    const now = Date.now();
    const pile: DropRecord = { owner: rec.id, name: rec.name, map: 'field', zone: 'copy-2', x: 4, y: 10, items: [{ item: 'glowcap', count: 1 }], droppedAt: now - 1000, trail: [] };
    const mine = async () => (await storage.loadDrops(now - DROP_LIFETIME_MS)).filter(d => d.owner === rec.id);
    await storage.saveDrop(pile);
    expect(await mine()).toEqual([pile]);
    const { zone: _copy, ...inMain } = pile;
    await storage.saveDrop(inMain);
    expect(await mine()).toEqual([inMain]);
    const row = await admin.query(`SELECT zone FROM ${schema}.drops WHERE owner = $1`, [rec.id]);
    expect(row.rows).toEqual([{ zone: '' }]);
    const mark: MarkRecord = { id: 71, owner: rec.id, name: rec.name, color: rec.color, map: 'field', zone: 'copy-2', x: 4, y: 9, dir: 'up', placedAt: now - 1000 };
    await storage.saveMark(mark);
    expect((await storage.loadMarks(now, 86_400_000)).filter(m => m.owner === rec.id)).toEqual([mark]);
    const thing: CacheItemRecord = { id: 7101, map: 'near-woods-old-cabin', zone: 'copy-2', x: 1, y: 1, item: 'resin', owner: rec.id, name: rec.name, at: now - 1000 };
    const crated = async () => (await storage.loadCacheItems()).filter(c => c.owner === rec.id);
    await storage.saveCacheItem(thing);
    expect(await crated()).toEqual([thing]);
    const { zone: _crate, ...inMainCrate } = thing;
    await storage.saveCacheItem(inMainCrate);
    expect(await crated()).toEqual([inMainCrate]);
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

  it('keeps what a player wears, and none for one who never chose', async () => {
    const plain = player('Pg Plain');
    expect(await storage.create(plain)).toBe(true);
    expect((await storage.findByTokenHash(plain.tokenHash!))!.gear).toBeUndefined();
    const dressed = { ...plain, gear: { shirt: 'raincoat', bag: 'hiking-pack' } };
    await storage.save(dressed);
    expect(await storage.findByTokenHash(plain.tokenHash!)).toEqual(dressed);
  });

  it('keeps each piece: how worn what they wear is, its quirk, and the pieces in the stash', async () => {
    const rec = player('Pg Worn');
    expect(await storage.create(rec)).toBe(true);
    const worn = {
      ...rec, gear: { shirt: 'raincoat', cap: 'shard-cap' }, worn: { shirt: { cond: 0.35 }, cap: { cond: 1, quirk: 'hum' as const } },
      stash: { items: { raincoat: 2 }, out: {}, pieces: { raincoat: [{ cond: 1 }, { cond: 0.2 }] } },
    };
    await storage.save(worn);
    expect(await storage.findByTokenHash(rec.tokenHash!)).toEqual(worn);
  });

  it('keeps the latest chapter of the story reached, none for a player who never started, and never loses one to a save without it', async () => {
    const rec = player('Pg Reader');
    expect(await storage.create(rec)).toBe(true);
    expect((await storage.findByTokenHash(rec.tokenHash!))!.story).toBeUndefined();
    const reader = { ...rec, story: 'the-lineman' };
    await storage.save(reader);
    expect(await storage.findByTokenHash(rec.tokenHash!)).toEqual(reader);
    await storage.save(rec);
    expect((await storage.findByTokenHash(rec.tokenHash!))!.story).toBe('the-lineman');
  });

  it('keeps the outfit a player wears, none for one who wears none, none once it is taken off, and never loses it to a save without it', async () => {
    const rec = player('Pg Dresser');
    expect(await storage.create(rec)).toBe(true);
    const outfit = async () => (await storage.findByTokenHash(rec.tokenHash))!.outfit;
    expect(await outfit()).toBeUndefined();
    const caped = { ...rec, outfit: 'rain-cape' };
    await storage.save(caped);
    expect(await storage.findByTokenHash(rec.tokenHash)).toEqual(caped);
    // A save without one keeps it, like the tools and the parcels; taken off (null), it is none.
    await storage.save(rec);
    expect(await outfit()).toBe('rain-cape');
    await storage.save({ ...rec, outfit: null });
    expect(await outfit()).toBeUndefined();
    const born = { ...player('Pg Born Dressed'), outfit: 'napo-suit' };
    expect(await storage.create(born)).toBe(true);
    expect(await storage.findByTokenHash(born.tokenHash)).toEqual(born);
    // The previous release's saves never touch it.
    await admin.query(`UPDATE ${schema}.players SET x = 1 WHERE id = $1`, [born.id]);
    expect((await storage.findByTokenHash(born.tokenHash))!.outfit).toBe('napo-suit');
  });

  it('keeps outfits through a restart of the server, over the network', async () => {
    const fresh = await freshSchema();
    const first = new PgStorage(fresh.url, MIGRATIONS);
    const second = new PgStorage(fresh.url, MIGRATIONS);
    try {
      await first.init();
      await second.init();
      await outfitsKeptThroughARestart(first, second);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it('keeps the cup of rest: none for a new player, what a save writes, none once spent; and the previous release\'s saves leave it alone', async () => {
    await keepsRested(storage);
    const rec = { ...player('Pg Rested'), rested: 140 };
    expect(await storage.create(rec)).toBe(true);
    expect(await storage.findByTokenHash(rec.tokenHash)).toEqual(rec);
    const row = await admin.query(`SELECT rested FROM ${schema}.players WHERE id = $1`, [rec.id]);
    expect(row.rows).toEqual([{ rested: 140 }]);
    // The release before 018 (the zones') saves with the statement it knows: the cup stays as it is.
    await admin.query(
      `UPDATE ${schema}.players SET map = $2, x = $3, y = $4, dir = $5, color = $6, energy = $7, bag = $8::jsonb, wet = $9, stats = $10::jsonb, xp = $11, stash = $12::jsonb,
       gear = $14::jsonb, worn = $15::jsonb, story = COALESCE($16::text, story), tools = COALESCE($17::jsonb, tools),
       parcel_welcome = COALESCE($18::boolean, parcel_welcome), parcel_day = CASE WHEN $18::boolean IS NULL THEN parcel_day ELSE $19::integer END,
       parcel_days = COALESCE($20::smallint, parcel_days), outfit = CASE WHEN $21::boolean THEN $22::text ELSE outfit END, zone = $23, last_seen_at = $13 WHERE id = $1`,
      [rec.id, 'stonebrook', 8, 21, 'down', rec.color, 90, '[]', 0, '{}', 60, '{"items": {}, "out": {}}', new Date(rec.lastSeenAt), null, null, null, null, null, null, null, false, null, ''],
    );
    expect(await storage.findByTokenHash(rec.tokenHash)).toMatchObject({ xp: 60, rested: 140 });
    // And its players, made without the column, start with an empty cup.
    const old = player('Pg Before Rest');
    await admin.query(
      `INSERT INTO ${schema}.players (id, name, token_hash, x, y, dir, color, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [old.id, old.name, old.tokenHash, old.x, old.y, old.dir, old.color, new Date(old.createdAt), new Date(old.lastSeenAt)],
    );
    expect((await storage.findByTokenHash(old.tokenHash))!.rested).toBeUndefined();
  });

  it('keeps merits: what was spent, the looks bought in order, the pattern and badge worn; never lost to a save without them, and the previous release\'s saves leave them alone', async () => {
    await keepsMerits(storage);
    const rec = { ...player('Pg Merits'), meritsSpent: 2, looks: ['chevron', 'old-stone'], pattern: 'chevron', badge: 'old-stone' };
    expect(await storage.create(rec)).toBe(true);
    expect(await storage.findByTokenHash(rec.tokenHash)).toEqual(rec);
    const row = await admin.query(`SELECT merits_spent, looks, pattern, badge FROM ${schema}.players WHERE id = $1`, [rec.id]);
    expect(row.rows).toEqual([{ merits_spent: 2, looks: ['chevron', 'old-stone'], pattern: 'chevron', badge: 'old-stone' }]);
    // The release before 019 (the rest's) saves with the statement it knows: what was bought and worn stays as it is.
    await admin.query(
      `UPDATE ${schema}.players SET map = $2, x = $3, y = $4, dir = $5, color = $6, energy = $7, bag = $8::jsonb, wet = $9, stats = $10::jsonb, xp = $11, stash = $12::jsonb,
       gear = $14::jsonb, worn = $15::jsonb, story = COALESCE($16::text, story), tools = COALESCE($17::jsonb, tools),
       parcel_welcome = COALESCE($18::boolean, parcel_welcome), parcel_day = CASE WHEN $18::boolean IS NULL THEN parcel_day ELSE $19::integer END,
       parcel_days = COALESCE($20::smallint, parcel_days), outfit = CASE WHEN $21::boolean THEN $22::text ELSE outfit END, zone = $23, rested = $24,
       last_seen_at = $13 WHERE id = $1`,
      [rec.id, 'stonebrook', 8, 21, 'down', rec.color, 90, '[]', 0, '{}', 13_000, '{"items": {}, "out": {}}', new Date(rec.lastSeenAt), null, null, null, null, null, null, null, false, null, '', 0],
    );
    expect(await storage.findByTokenHash(rec.tokenHash)).toMatchObject({ xp: 13_000, meritsSpent: 2, looks: ['chevron', 'old-stone'], pattern: 'chevron', badge: 'old-stone' });
    // Whatever else the looks column holds reads as none bought (the World checks every id too).
    await admin.query(`UPDATE ${schema}.players SET looks = '{"not": "a list"}' WHERE id = $1`, [rec.id]);
    expect((await storage.findByTokenHash(rec.tokenHash))!.looks).toBeUndefined();
  });

  it('keeps purchases once, reads what each player bought with them, never writes it in a save, and takes a look back by a refund', async () => {
    const { id, sessions } = await keepsPurchases(storage);
    const rows = await admin.query(
      `SELECT session, player, look, amount, currency, status, refunded IS NOT NULL AS refunded FROM ${schema}.purchases WHERE session = ANY($1) ORDER BY created`,
      [sessions],
    );
    expect(rows.rows).toEqual([
      { session: sessions[0], player: id, look: 'winter-parka', amount: 299, currency: 'eur', status: 'refunded', refunded: true },
      { session: sessions[1], player: id, look: 'heart', amount: 99, currency: 'eur', status: 'paid', refunded: false },
      { session: sessions[2], player: id, look: 'winter-parka', amount: 299, currency: 'eur', status: 'refunded', refunded: true },
    ]);
    // A purchase for a player who was gone when Stripe's word came is kept, whose-less.
    const orphans = await admin.query(`SELECT count(*)::int AS n FROM ${schema}.purchases WHERE player IS NULL`);
    expect(orphans.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it('keeps the purchases of a deleted player, whose-less, for the accounts', async () => {
    const { id, sessions } = await keepsPurchases(storage);
    await admin.query(`DELETE FROM ${schema}.players WHERE id = $1`, [id]);
    const rows = await admin.query(`SELECT player FROM ${schema}.purchases WHERE session = ANY($1)`, [sessions]);
    expect(rows.rows).toEqual([{ player: null }, { player: null }, { player: null }]);
  });

  it('keeps what the shop sold through a restart of the server, over the network', async () => {
    const fresh = await freshSchema();
    const first = new PgStorage(fresh.url, MIGRATIONS);
    const second = new PgStorage(fresh.url, MIGRATIONS);
    try {
      await first.init();
      await second.init();
      await shopKeptThroughARestart(first, second);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it('keeps merits through a restart of the server, over the network', async () => {
    const fresh = await freshSchema();
    const first = new PgStorage(fresh.url, MIGRATIONS);
    const second = new PgStorage(fresh.url, MIGRATIONS);
    try {
      await first.init();
      await second.init();
      await meritsKeptThroughARestart(first, second);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it('keeps the cup of rest through a restart of the server, over the network', async () => {
    const fresh = await freshSchema();
    const first = new PgStorage(fresh.url, MIGRATIONS);
    const second = new PgStorage(fresh.url, MIGRATIONS);
    try {
      await first.init();
      await second.init();
      await restKeptThroughARestart(first, second);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it('keeps the tools a player owns, in order, none for one who never got one, and never loses them to a save without them', async () => {
    const rec = player('Pg Tinker');
    expect(await storage.create(rec)).toBe(true);
    expect((await storage.findByTokenHash(rec.tokenHash))!.tools).toBeUndefined();
    const tinker = { ...rec, tools: ['stonebrook-map', 'near-woods-map', 'south-road-map', 'radio'] };
    await storage.save(tinker);
    expect(await storage.findByTokenHash(rec.tokenHash)).toEqual(tinker);
    await storage.save(rec);
    expect((await storage.findByTokenHash(rec.tokenHash))!.tools).toEqual(tinker.tools);
    // Made with tools of their own (a test, or a later way in), they are kept too.
    const made = { ...player('Pg Maker'), tools: ['radio', 'near-woods-map'] };
    expect(await storage.create(made)).toBe(true);
    expect(await storage.findByTokenHash(made.tokenHash)).toEqual(made);
    // Whatever else the column holds reads as never set: the starter tools (the World checks every id too).
    await admin.query(`UPDATE ${schema}.players SET tools = '{"not": "a list"}' WHERE id = $1`, [made.id]);
    expect((await storage.findByTokenHash(made.tokenHash))!.tools).toBeUndefined();
  });

  it('reads a player of the release before tools as never having got one, and that release\'s saves leave the tools alone', async () => {
    // The release before 012 inserts and updates players without the column: after a rollback, it runs on it.
    const old = player('Pg Before Tools');
    await admin.query(
      `INSERT INTO ${schema}.players (id, name, token_hash, x, y, dir, color, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [old.id, old.name, old.tokenHash, old.x, old.y, old.dir, old.color, new Date(old.createdAt), new Date(old.lastSeenAt)],
    );
    expect((await storage.findByTokenHash(old.tokenHash))!.tools).toBeUndefined();
    await storage.save({ ...old, tools: ['radio'] });
    await admin.query(`UPDATE ${schema}.players SET map = $2, x = $3, y = $4, energy = $5, bag = $6::jsonb, stash = $7::jsonb, last_seen_at = $8 WHERE id = $1`, [
      old.id, 'stonebrook', 8, 21, 90, '[]', '{"items": {}, "out": {}}', new Date(old.lastSeenAt),
    ]);
    expect((await storage.findByTokenHash(old.tokenHash))!.tools).toEqual(['radio']);
  });

  it('keeps the mark of what was worn counted as taken out, with the counts but not among them, never lost to a save without it', async () => {
    await keepsTheWornOutMark(storage);
  });

  it('keeps what a newer release saved that this one does not know, written back as it was saved', async () => {
    await keepsWhatANewerReleaseSaved(storage, itemsData());
  });

  it('keeps the daily parcels: whether the welcome came, the day of the last one and the days of its week, never lost to a save without them', async () => {
    await keepsParcels(storage);
    // What the columns hold, as the migration made them.
    const sub = `dev:${randomUUID()}@example.test`;
    const rec = { ...player('Pg Parcels'), tokenHash: null, authSub: sub, parcels: { welcome: true, day: 20_724, days: 0b1011 } };
    expect(await storage.create(rec)).toBe(true);
    const row = await admin.query(`SELECT parcel_welcome, parcel_day, parcel_days FROM ${schema}.players WHERE id = $1`, [rec.id]);
    expect(row.rows).toEqual([{ parcel_welcome: true, parcel_day: 20_724, parcel_days: 0b1011 }]);
    expect(await storage.findByAuthSub(sub)).toEqual(rec);
  });

  it('keeps the field notes: the pages opened and the blanks filled in, never lost to a save without them', async () => {
    await keepsNotebook(storage);
    // What the column holds, as the migration made it.
    const rec = { ...player('Pg Notebook'), notebook: { pages: ['pop-23', 'glowcaps'], blanks: ['wire-green'] } };
    expect(await storage.create(rec)).toBe(true);
    const row = await admin.query(`SELECT notebook FROM ${schema}.players WHERE id = $1`, [rec.id]);
    expect(row.rows).toEqual([{ notebook: { pages: ['pop-23', 'glowcaps'], blanks: ['wire-green'] } }]);
    expect(await storage.findByTokenHash(rec.tokenHash)).toEqual(rec);
    // The release before saves without the column: after a rollback, the pages stay.
    await admin.query(`UPDATE ${schema}.players SET map = $2, x = $3, y = $4, energy = $5, bag = $6::jsonb, stash = $7::jsonb, last_seen_at = $8 WHERE id = $1`, [
      rec.id, 'stonebrook', 8, 21, 90, '[]', '{"items": {}, "out": {}}', new Date(rec.lastSeenAt),
    ]);
    expect((await storage.findByTokenHash(rec.tokenHash))!.notebook).toEqual({ pages: ['pop-23', 'glowcaps'], blanks: ['wire-green'] });
    // A player from before it reads as nothing yet.
    const old = player('Pg Before Notes');
    await admin.query(
      `INSERT INTO ${schema}.players (id, name, token_hash, x, y, dir, color, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [old.id, old.name, old.tokenHash, old.x, old.y, old.dir, old.color, new Date(old.createdAt), new Date(old.lastSeenAt)],
    );
    expect((await storage.findByTokenHash(old.tokenHash))!.notebook).toBeUndefined();
  });

  it('keeps the first finders, never written over, and lets a guest who stayed away take theirs', async () => {
    await keepsFirsts(storage);
    // What the table holds: the finder by id, and a name only through them.
    const p = player('Pg First');
    expect(await storage.create(p)).toBe(true);
    await storage.saveFirst({ secret: 'note:pg-first', player: p.id, name: 'ignored', day: 3052, at: 7_000 });
    const row = await admin.query(`SELECT secret, player, day FROM ${schema}.firsts WHERE secret = 'note:pg-first'`);
    expect(row.rows).toEqual([{ secret: 'note:pg-first', player: p.id, day: 3052 }]);
    expect((await storage.loadFirsts()).find(f => f.secret === 'note:pg-first')?.name).toBe(p.name);
  });

  it('keeps the best trips, never lost to a save without them', async () => {
    await keepsBests(storage);
    // A player from before them reads as none yet.
    const old = player('Pg Before Bests');
    expect(await storage.create(old)).toBe(true);
    expect((await storage.findByTokenHash(old.tokenHash))!.bests).toBeUndefined();
  });

  it('keeps the notes read and the keepsakes home, never lost to a save without them', async () => {
    await keepsNotes(storage);
    // What the columns hold, as the migration made them.
    const rec = { ...player('Pg Notes'), notes: ['walt-n8', 'ranger-fires'], keepsakes: ['pole-tag'] };
    expect(await storage.create(rec)).toBe(true);
    const row = await admin.query(`SELECT notes, keepsakes FROM ${schema}.players WHERE id = $1`, [rec.id]);
    expect(row.rows).toEqual([{ notes: ['walt-n8', 'ranger-fires'], keepsakes: ['pole-tag'] }]);
    expect(await storage.findByTokenHash(rec.tokenHash)).toEqual(rec);
    // The release before saves without the columns: after a rollback, they stay.
    await admin.query(`UPDATE ${schema}.players SET map = $2, x = $3, y = $4, energy = $5, bag = $6::jsonb, stash = $7::jsonb, last_seen_at = $8 WHERE id = $1`, [
      rec.id, 'stonebrook', 8, 21, 90, '[]', '{"items": {}, "out": {}}', new Date(rec.lastSeenAt),
    ]);
    expect(await storage.findByTokenHash(rec.tokenHash)).toMatchObject({ notes: ['walt-n8', 'ranger-fires'], keepsakes: ['pole-tag'] });
    // A player from before them reads as nothing yet.
    const old = player('Pg Before Keepsakes');
    await admin.query(
      `INSERT INTO ${schema}.players (id, name, token_hash, x, y, dir, color, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [old.id, old.name, old.tokenHash, old.x, old.y, old.dir, old.color, new Date(old.createdAt), new Date(old.lastSeenAt)],
    );
    const before = (await storage.findByTokenHash(old.tokenHash))!;
    expect(before.notes).toBeUndefined();
    expect(before.keepsakes).toBeUndefined();
  });

  it('gives the parcels through restarts of the server, on the database', async () => {
    const fresh = await freshSchema();
    const pgStorage = new PgStorage(fresh.url, MIGRATIONS);
    try {
      await pgStorage.init();
      await parcelsThroughRestarts(pgStorage);
    } finally {
      await pgStorage.close();
    }
  });

  it('keeps tools, parcels and the outfit side by side in one row: made with all three, saved with all three, and a save with none of them loses none', async () => {
    const { sub, kept } = await keepsToolsParcelsAndOutfit(storage);
    const row = await admin.query(`SELECT tools, parcel_welcome, parcel_day, parcel_days, outfit FROM ${schema}.players WHERE auth_sub = $1`, [sub]);
    expect(row.rows).toEqual([{ tools: ['stonebrook-map', 'radio', 'near-woods-map'], parcel_welcome: true, parcel_day: 20_725, parcel_days: 0b11, outfit: 'rain-cape' }]);
    // The releases before save with the statements they know: after a rollback, what is newer stays. The one
    // before parcels (tools, no parcel columns, no outfit), then the one before outfits (tools and parcels).
    const before = { parcels: 'tools = COALESCE($17::jsonb, tools)', outfits: `tools = COALESCE($17::jsonb, tools),
       parcel_welcome = COALESCE($18::boolean, parcel_welcome), parcel_day = CASE WHEN $18::boolean IS NULL THEN parcel_day ELSE $19::integer END,
       parcel_days = COALESCE($20::smallint, parcel_days)` };
    const saved = [kept.id, 'stonebrook', 8, 21, 'down', kept.color, 90, '[]', 0, '{}', 0, '{"items": {}, "out": {}}', new Date(kept.lastSeenAt), null, null, null, null];
    for (const [release, set] of Object.entries(before)) {
      await admin.query(
        `UPDATE ${schema}.players SET map = $2, x = $3, y = $4, dir = $5, color = $6, energy = $7, bag = $8::jsonb, wet = $9, stats = $10::jsonb, xp = $11, stash = $12::jsonb,
         gear = $14::jsonb, worn = $15::jsonb, story = COALESCE($16::text, story), ${set}, last_seen_at = $13 WHERE id = $1`,
        release === 'outfits' ? [...saved, null, null, null] : saved,
      );
      expect(await storage.findByAuthSub(sub), release).toMatchObject({ tools: kept.tools, parcels: kept.parcels, outfit: kept.outfit });
    }
  });

  it('keeps a whole player in one row: tools, parcels, the outfit, the field notes and the thanks received together, every column round trips, and no save writes the thanks received', async () => {
    const { sub, kept } = await keepsWholeRow(storage);
    const row = await admin.query(
      `SELECT map, x, y, dir, energy, bag, wet, stats, xp, stash, gear, worn, story, tools, parcel_welcome, parcel_day, parcel_days, outfit, thanked, notebook, furniture, cozy_until, street, lot,
         door_off, street_told, first_steps
       FROM ${schema}.players WHERE auth_sub = $1`,
      [sub],
    );
    // The thanks received live in their own column, never among the counts a save writes.
    const { thanked: _thanked, ...counts } = kept.stats!;
    expect(row.rows).toEqual([{
      map: kept.map, x: kept.x, y: kept.y, dir: kept.dir, energy: kept.energy, bag: kept.bag, wet: kept.wet, stats: counts, xp: kept.xp, stash: kept.stash, gear: kept.gear,
      worn: kept.worn, story: kept.story, tools: kept.tools, parcel_welcome: true, parcel_day: 20_725, parcel_days: 0b11, outfit: 'rain-cape', thanked: 8, notebook: kept.notebook,
      furniture: ['iron-stove', 'bed'], cozy_until: new Date(1_700_000_400_000), street: 3, lot: 0, door_off: false, street_told: true, first_steps: 3,
    }]);
  });

  it('keeps which of the first steps a new player takes next, said by every save, and a player from before them past them', async () => {
    const rec = { ...player('Pg First Steps'), firstSteps: 1 };
    expect(await storage.create(rec)).toBe(true);
    expect(await storage.findByTokenHash(rec.tokenHash)).toEqual(rec);
    await storage.save({ ...rec, firstSteps: 3 });
    const row = await admin.query(`SELECT first_steps FROM ${schema}.players WHERE id = $1`, [rec.id]);
    expect(row.rows).toEqual([{ first_steps: 3 }]);
    // The last one taken: a save without it.
    const { firstSteps: _steps, ...done } = rec;
    await storage.save(done);
    expect(await storage.findByTokenHash(rec.tokenHash)).toEqual(done);
    // A player from before them has no first steps to take.
    const old = player('Pg Before First Steps');
    await admin.query(
      `INSERT INTO ${schema}.players (id, name, token_hash, x, y, dir, color, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [old.id, old.name, old.tokenHash, old.x, old.y, old.dir, old.color, new Date(old.createdAt), new Date(old.lastSeenAt)],
    );
    expect((await storage.findByTokenHash(old.tokenHash))!.firstSteps).toBeUndefined();
  });

  it('keeps XP and the stash, with what was taken out of it', async () => {
    const rec = { ...player('Pg Hoarder'), xp: 340, stash: { items: { shard: 7, glowcap: 40 }, out: { thermos: 1 } } };
    expect(await storage.create(rec)).toBe(true);
    expect(await storage.findByTokenHash(rec.tokenHash!)).toEqual(rec);
    const more = { ...rec, xp: 352, stash: { items: { shard: 8, glowcap: 40 }, out: {} } };
    await storage.save(more);
    expect(await storage.findByTokenHash(rec.tokenHash!)).toEqual(more);
    // Whatever else the column holds reads as an empty stash (the World checks every count too).
    await admin.query(`UPDATE ${schema}.players SET stash = '[1]' WHERE id = $1`, [rec.id]);
    expect((await storage.findByTokenHash(rec.tokenHash!))!.stash).toEqual({ items: {}, out: {} });
  });

  it('keeps how wet a player is and what counts toward their feats', async () => {
    const rec = { ...player('Pg Soaked'), wet: 0.75, stats: { rainSteps: 120, fed: 3 } };
    expect(await storage.create(rec)).toBe(true);
    expect(await storage.findByTokenHash(rec.tokenHash)).toEqual(rec);
    const drier = { ...rec, wet: 0.25, stats: { rainSteps: 121, fed: 3, nightSteps: 9 } };
    await storage.save(drier);
    expect(await storage.findByTokenHash(rec.tokenHash)).toEqual(drier);
    // Whatever else the column holds reads as no counts (the World checks each one too).
    await admin.query(`UPDATE ${schema}.players SET stats = '[1, 2]' WHERE id = $1`, [rec.id]);
    expect((await storage.findByTokenHash(rec.tokenHash))!.stats).toEqual({});
  });

  it('keeps marks with their painter\'s name and color and when each fades, and forgets the ones that faded', async () => {
    const painter = player('Pg Painter');
    await storage.create(painter);
    const now = Date.now();
    // A good neighbor's arrow, for two days; and one for a day.
    const mark: MarkRecord = { id: 7, owner: painter.id, name: 'ignored', color: 'ignored', map: 'near-woods', x: 30, y: 60, dir: 'up', placedAt: now - 1000, until: now - 1000 + 2 * DAY };
    await storage.saveMark(mark);
    await storage.saveMark({ ...mark, id: 8, x: 31, placedAt: now - 10_000, until: now - 10_000 + DAY });
    const mine = async (at: number) => (await storage.loadMarks(at, DAY)).filter(m => m.owner === painter.id);
    expect(await mine(now)).toEqual([
      { ...mark, id: 8, x: 31, placedAt: now - 10_000, until: now - 10_000 + DAY, name: painter.name, color: painter.color },
      { ...mark, name: painter.name, color: painter.color },
    ]);
    // Faded by then: not loaded, and gone from the table. The two days' one stays.
    expect((await mine(now - 10_000 + DAY)).map(m => m.id)).toEqual([7]);
    expect((await mine(now)).map(m => m.id)).toEqual([7]);
    await storage.removeMark(7);
    expect(await mine(0)).toEqual([]);
    await expect(storage.saveMark({ ...mark, id: 9, owner: randomUUID() })).rejects.toThrow(/foreign key/);
  });

  it('fades the marks of the release before 015, which keep no time to fade, a day after they were painted', async () => {
    const painter = player('Pg Old Painter');
    await storage.create(painter);
    const now = Date.now();
    const insert = `INSERT INTO ${schema}.marks (id, owner, map, x, y, dir, placed_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`;
    await admin.query(insert, [11, painter.id, 'near-woods', 3, 4, 'left', new Date(now - 1000)]);
    await admin.query(insert, [12, painter.id, 'near-woods', 5, 4, 'left', new Date(now - DAY - 1000)]);
    expect((await storage.loadMarks(now, DAY)).filter(m => m.owner === painter.id)).toEqual([
      { id: 11, owner: painter.id, name: painter.name, color: painter.color, map: 'near-woods', x: 3, y: 4, dir: 'left', placedAt: now - 1000 },
    ]);
  });

  it('keeps who thanked whom, once a day each, and whether the helper was told, and forgets thanks older than asked', async () => {
    const giver = player('Pg Giver'), helper = player('Pg Helper');
    await storage.create(giver);
    await storage.create(helper);
    const now = Date.now(), day = utcDay(now);
    const t: ThanksRecord = { giver: giver.id, helper: helper.id, day, at: now - 1000, what: { kind: 'fire', map: 'near-woods-ranger-hut', x: 3, y: 1 }, told: false, name: 'ignored' };
    await storage.saveThanks(t);
    // One a day: the same day again only says whether the helper was told.
    await storage.saveThanks({ ...t, at: now, what: { kind: 'mark', map: 'near-woods', x: 1, y: 1 }, told: true });
    const mine = async (after: number) => (await storage.loadThanks(after)).filter(x => x.giver === giver.id);
    expect(await mine(now - 60_000)).toEqual([{ ...t, told: true, name: giver.name }]);
    await storage.saveThanks({ ...t, day: day - 8, at: now - 8 * DAY });
    expect((await mine(now - 9 * DAY)).map(x => x.day)).toEqual([day - 8, day]);
    // Older than asked: not loaded, and gone from the table.
    expect((await mine(now - 7 * DAY)).map(x => x.day)).toEqual([day]);
    const left = async () => (await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${schema}.thanks WHERE giver = $1`, [giver.id])).rows[0]!.n;
    expect(await left()).toBe(1);
    expect(await storage.forgetThanks(now + 1)).toBeGreaterThanOrEqual(1);
    expect(await left()).toBe(0);
    await expect(storage.saveThanks({ ...t, helper: randomUUID() })).rejects.toThrow(/foreign key/);
  });

  it('keeps what lies in the crates, with who left it and when, until someone takes it', async () => {
    const a = player('Pg Leaver'), b = player('Pg Other Leaver');
    await storage.create(a);
    await storage.create(b);
    const at = 1_800_000_000_000;
    const resin = { id: 51, map: 'near-woods-old-cabin', x: 2, y: 1, item: 'resin', owner: a.id, name: 'ignored', at };
    await storage.saveCacheItem(resin);
    await storage.saveCacheItem({ ...resin, id: 52, item: 'thermos', owner: b.id, at: at + 1000 });
    await storage.saveCacheItem({ ...resin, id: 53, map: 'south-road', x: 19, y: 19, at: at - 1000 });
    const mine = async () => (await storage.loadCacheItems()).filter(c => c.owner === a.id || c.owner === b.id);
    expect(await mine()).toEqual([
      { ...resin, id: 53, map: 'south-road', x: 19, y: 19, at: at - 1000, name: a.name },
      { ...resin, name: a.name },
      { ...resin, id: 52, item: 'thermos', owner: b.id, at: at + 1000, name: b.name },
    ]);
    await storage.removeCacheItem(51);
    await storage.removeCacheItem(51);
    expect((await mine()).map(c => c.id)).toEqual([53, 52]);
    await expect(storage.saveCacheItem({ ...resin, id: 54, owner: randomUUID() })).rejects.toThrow(/foreign key/);
    for (const id of [52, 53]) await storage.removeCacheItem(id);
  });

  it('counts the thanks a player received on their own: a save of the player never undoes one', async () => {
    const rec = { ...player('Pg Neighbor'), stats: { fed: 3, thanked: 24 } };
    expect(await storage.create(rec)).toBe(true);
    expect((await storage.findByTokenHash(rec.tokenHash))!.stats).toEqual({ fed: 3, thanked: 24 });
    await storage.creditThanks(rec.id);
    // A save of what the player was before the thanks came (they were online meanwhile) leaves it as it is.
    await storage.save({ ...rec, stats: { fed: 4, thanked: 24 } });
    expect((await storage.findByTokenHash(rec.tokenHash))!.stats).toEqual({ fed: 4, thanked: 25 });
    const row = await admin.query(`SELECT stats, thanked FROM ${schema}.players WHERE id = $1`, [rec.id]);
    expect(row.rows[0]).toEqual({ stats: { fed: 4 }, thanked: 25 });
    // A player of the release before 015 has received none.
    const old = player('Pg Before Thanks');
    await admin.query(
      `INSERT INTO ${schema}.players (id, name, token_hash, x, y, dir, color, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [old.id, old.name, old.tokenHash, old.x, old.y, old.dir, old.color, new Date(old.createdAt), new Date(old.lastSeenAt)],
    );
    expect((await storage.findByTokenHash(old.tokenHash))!.stats).toEqual({});
  });

  it('keeps the Old Stone', async () => {
    const fresh = await freshSchema();
    const s = new PgStorage(fresh.url, MIGRATIONS);
    try {
      await s.init();
      expect(await s.loadStone()).toBeNull();
      await s.saveStone({ charge: 12.5, awake: true, at: 1_800_000_000_000 });
      await s.saveStone({ charge: 11.25, awake: true, at: 1_800_000_060_000 });
      expect(await s.loadStone()).toEqual({ charge: 11.25, awake: true, at: 1_800_000_060_000 });
    } finally {
      await s.close();
    }
  });

  it('keeps the Long Night beside the Old Stone, and reads back nothing it did not write', async () => {
    const fresh = await freshSchema();
    const s = new PgStorage(fresh.url, MIGRATIONS);
    try {
      await s.init();
      expect(await s.loadLongNight()).toBeNull();
      await s.saveStone({ charge: 3, awake: false, at: 1_800_000_000_000 });
      await s.saveLongNight({ week: 2961, bonus: true, outAt: 1_791_055_620_000, out: false, over: false });
      await s.saveLongNight({ week: 2961, bonus: true, outAt: 1_791_055_920_000, out: true, over: true });
      expect(await s.loadLongNight()).toEqual({ week: 2961, bonus: true, outAt: 1_791_055_920_000, out: true, over: true });
      expect(await s.loadStone()).toEqual({ charge: 3, awake: false, at: 1_800_000_000_000 });
      await admin.query(`UPDATE ${fresh.schema}.world_state SET value = '{"week":"soon"}'::jsonb WHERE key = 'long_night'`);
      expect(await s.loadLongNight()).toBeNull();
    } finally {
      await s.close();
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

  it('plays first as a guest and keeps it on sign-in, over the network', async () => {
    const fresh = await freshSchema();
    const pgStorage = new PgStorage(fresh.url, MIGRATIONS);
    try {
      await pgStorage.init();
      await playFirstThenSignIn(pgStorage);
    } finally {
      await pgStorage.close();
    }
  });

  it('deletes guests who stayed away, with their pile, marks, links and messages, never anyone signed in', async () => {
    // A schema of its own: every other player in these tests is a guest who has not played since 2023.
    const fresh = await freshSchema();
    const pgStorage = new PgStorage(fresh.url, MIGRATIONS);
    try {
      await pgStorage.init();
      const index = await admin.query<{ indexdef: string }>('SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = $2', [fresh.schema, 'players_guests_last_seen']);
      expect(index.rows[0]?.indexdef).toMatch(/WHERE \(auth_sub IS NULL\)/);
      const { reporter } = await forgetsGuestsWhoStayedAway(pgStorage);
      // A report about a guest who went stays for the maintainers, without them.
      const reports = await admin.query<{ reporter: string | null; reported: string | null; reason: string }>(`SELECT reporter, reported, reason FROM ${fresh.schema}.reports`);
      expect(reports.rows).toEqual([{ reporter, reported: null, reason: 'spam' }]);
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

  it('keeps friends, requests, blocks, unread messages, the requests settings and reports', async () => {
    await keepsFriendsAndMessages(storage);
    const r = await admin.query<{ reason: string; quote: string | null }>(`SELECT reason, quote FROM ${schema}.reports`);
    expect(r.rows).toEqual([{ reason: 'spam', quote: null }]);
  });

  it('saves two players who traded together, or neither of them', async () => {
    await savesATradeTogether(storage);
    const [a, b] = [player('Pg Trader'), player('Pg Taker')];
    expect(await storage.create(a)).toBe(true);
    expect(await storage.create(b)).toBe(true);
    // The second write breaks a rule of the table: the first goes back with it, so no swap lands in one bag only.
    const broken = { ...b, dir: 'sideways' } as unknown as PlayerRecord;
    await expect(storage.saveTogether([{ ...a, bag: [{ item: 'resin', count: 9 }] }, broken])).rejects.toThrow();
    expect((await storage.findByTokenHash(a.tokenHash))!.bag).toEqual([]);
  });
});
