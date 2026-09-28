/**
 * The Long Night (roadmap/long-night.md): once a week, from Saturday 19:12 UTC, a whole game day of
 * aurora; wire grows back twice as fast while it keeps its bonus; the lodge's fire is nobody's to tend
 * that night, and whether it lasts until dawn decides the next one's bonus. The World's rules, then the
 * same over real WebSockets, through a restart.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DAY_S, ENERGY_MAX, FIRE_MAX_S, PROTOCOL_VERSION, TileMap, longNightFrom, weekIndex, type Dir, type ItemsData, type MapData, type ServerMsg } from '@napoland/shared';
import { setLogLevel } from '../src/log';
import { startServer, type RunningServer } from '../src/server';
import { MemoryStorage, cleanLongNight, type LongNightRecord, type PlayerRecord } from '../src/storage';
import { LODGE_FUEL_S, World, colorFor, type Outgoing } from '../src/world';
import { houseData, townData, woodsData } from './fixtures';
import { Client, eventually, savedPlayer, serverDefaults } from './helpers';

const DAY_MS = DAY_S * 1000, WEEK_MS = 7 * 86_400_000;
/** The week of Monday 28 September 2026, and its Long Night: Saturday 3 October, from 19:12 to 20:00 UTC. */
const WEEK = weekIndex(Date.UTC(2026, 8, 28)), NIGHT = longNightFrom(WEEK);
/** Game time 0 is a minute before it: it begins at BEGIN and dawn ends it at DAWN. */
const BEFORE = NIGHT - 60_000, BEGIN = 60_000, DAWN = BEGIN + DAY_MS;

/** The fixture town with a notice board at 0,4 (read from 0,5 facing up). */
const town = (): MapData => ({ ...townData(), objects: [...townData().objects, { kind: 'board', x: 0, y: 4 }] });
/** The fixture house as the lodge: its fireplace (2,1, fed from 2,2 facing up) is the one nobody tends on the Long Night. */
const lodge = (): MapData => ({ ...houseData(), objects: [{ kind: 'fireplace', x: 2, y: 1, longNight: true }] });
const maps = () => [new TileMap(town()), new TileMap(lodge()), new TileMap(woodsData())];
/** Wire and moss grow by the campfire in the woods (3,1 to 5,1, all reached from 4,1), back in 100 seconds; wire twice as fast on a Long Night with its bonus. */
const ITEMS: ItemsData = {
  version: 1,
  items: [
    { id: 'resin', name: 'Fir resin', noun: 'resin', plural: 'resin', kind: 'resource', stack: 20, fuel: 300, text: 'Sticky.' },
    { id: 'cloth', name: 'Cloth scraps', noun: 'cloth', plural: 'cloth', kind: 'resource', stack: 10, fuel: 90, text: 'Dry.' },
    { id: 'wire', name: 'Copper wire', noun: 'wire', plural: 'wire', kind: 'resource', stack: 10, text: 'It hums.' },
    { id: 'moss', name: 'Moss', kind: 'resource', stack: 3, text: 'Soft and damp.' },
  ],
  finds: [
    { item: 'wire', map: 'woods', near: { kinds: ['fireplace'], radius: 1.5 }, count: 1, respawn: [100, 100] },
    { item: 'moss', map: 'woods', near: { kinds: ['fireplace'], radius: 1.5 }, count: 1, respawn: [100, 100] },
  ],
  longNight: { items: ['wire'], regrow: 2 },
};

const rec = (id: string, map: string, x: number, y: number, dir: Dir = 'up', more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map, x, y, dir, color: colorFor(id), energy: ENERGY_MAX, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});
/** A world whose clock reads `wall` at game time 0, and whatever it saved of the Long Night before. */
const world = (wall = BEFORE, more: { cycle?: boolean; longNight?: LongNightRecord | null; now?: number } = {}) =>
  new World(maps(), 'town', 'overcast', { items: ITEMS, epochOffset: wall, rng: () => 0.5, ...more });
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id || o.to === 'all' ? [o.msg] : []));
const onMap = (out: Outgoing[], map: string) => out.flatMap(o => ('map' in o && o.map === map ? [o.msg] : []));
const of = <T extends ServerMsg['t']>(msgs: ServerMsg[], t: T) => msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
/** The notice board as `id` reads it (standing at 0,5 facing up). */
const board = (w: World, id: string, now: number) => {
  w.drain();
  w.board(id, 0, 4, now);
  return of(to(w.drain(), id), 'board')[0]!.lines;
};
const lodgeFire = (w: World, now: number) => w.scene('house', now).fires[0]!;

describe('when it is', () => {
  it('is an aurora from its dawn to the next, everywhere, where the day would have been overcast and rainy', () => {
    const w = world(BEFORE, { cycle: true });
    // The night before it is an aurora too (every third): the lights are on already.
    expect(w.join(rec('a', 'town', 0, 5), 0).weather).toBe('aurora');
    w.drain();
    for (let t = BEGIN; t <= BEGIN + 13 * 60_000; t += 60_000) w.tick(t);
    // Thirteen minutes after its dawn it would rain in the woods; it is the aurora there too, the watchers' pace with it.
    expect(w.join(rec('b', 'woods', 4, 1), BEGIN + 13 * 60_000).weather).toBe('aurora');
    for (let t = BEGIN + 14 * 60_000; t < DAWN; t += 60_000) w.tick(t);
    expect(of(w.drain().map(o => o.msg), 'weather')).toEqual([]);
    w.tick(DAWN);
    const dawn = w.drain();
    expect(of(onMap(dawn, 'town'), 'weather')).toEqual([{ t: 'weather', weather: 'overcast' }]);
    expect(of(onMap(dawn, 'woods'), 'weather')).toEqual([{ t: 'weather', weather: 'overcast' }]);
  });

  it('tells everyone as it begins and as it ends, and the welcome says how it stands', () => {
    const w = world();
    expect(w.join(rec('a', 'town', 0, 5), 0).longNight).toEqual({ on: false, bonus: true, out: false });
    w.drain();
    w.tick(BEGIN - 1);
    expect(of(to(w.drain(), 'a'), 'longNight')).toEqual([]);
    w.tick(BEGIN);
    expect(of(to(w.drain(), 'a'), 'longNight')).toEqual([{ t: 'longNight', night: { on: true, bonus: true, out: false } }]);
    expect(w.join(rec('b', 'town', 1, 5), BEGIN + 1000).longNight).toEqual({ on: true, bonus: true, out: false });
  });
});

describe('the bonus', () => {
  const wireAt = (w: World) => w.findViews('woods').find(f => f.item === 'wire');
  const mossAt = (w: World) => w.findViews('woods').find(f => f.item === 'moss');

  it('grows wire back twice as fast that night, and nothing else, and no faster after dawn', () => {
    const w = world();
    w.join(rec('a', 'woods', 4, 1), 0);
    w.tick(BEGIN);
    const wire = wireAt(w)!;
    w.pick('a', wire.x, wire.y, BEGIN + 1000);
    w.tick(BEGIN + 1000 + 49_999);
    expect(wireAt(w)).toBeUndefined();
    w.tick(BEGIN + 1000 + 50_000);
    expect(wireAt(w)).toBeDefined();
    const moss = mossAt(w)!;
    w.pick('a', moss.x, moss.y, BEGIN + 60_000);
    w.tick(BEGIN + 60_000 + 50_000);
    expect(mossAt(w)).toBeUndefined();
    w.tick(BEGIN + 60_000 + 100_000);
    expect(mossAt(w)).toBeDefined();
    // Dawn: as it always was.
    w.tick(DAWN);
    const after = wireAt(w)!;
    w.pick('a', after.x, after.y, DAWN + 1000);
    w.tick(DAWN + 1000 + 50_000);
    expect(wireAt(w)).toBeUndefined();
    w.tick(DAWN + 1000 + 100_000);
    expect(wireAt(w)).toBeDefined();
  });

  it('is lost for the next one when the lodge\'s fire went out, which is then only long and dark', () => {
    // Last week's: the fire went out, a quarter of an hour in.
    const w = world(BEFORE, { longNight: { week: WEEK - 1, bonus: true, outAt: NIGHT - WEEK_MS + 900_000, out: true, over: true } });
    expect(w.join(rec('a', 'woods', 4, 1), 0).longNight).toEqual({ on: false, bonus: false, out: false });
    w.join(rec('b', 'town', 0, 5), 0);
    expect(board(w, 'b', 0)).toContain('The Long Night comes in about 1 minute. The lodge\'s fire went out on the last one, so this one will only be long and dark.');
    w.tick(BEGIN);
    expect(of(to(w.drain(), 'a'), 'longNight')).toEqual([{ t: 'longNight', night: { on: true, bonus: false, out: false } }]);
    const wire = wireAt(w)!;
    w.pick('a', wire.x, wire.y, BEGIN + 1000);
    w.tick(BEGIN + 1000 + 50_000);
    expect(wireAt(w)).toBeUndefined();
    w.tick(BEGIN + 1000 + 100_000);
    expect(wireAt(w)).toBeDefined();
    const lines = board(w, 'b', BEGIN + 120_000);
    expect(lines).toContain('Tonight is only long and dark, since the lodge\'s fire went out last week. The watchers are restless.');
    // The fire lasting this time brings the bonus back.
    expect(lines).toContain('The lodge\'s fire needs feeding tonight: 13 minutes left. If it lasts until dawn, next week\'s Long Night has its bonus again.');
  });
});

describe('the lodge\'s fire', () => {
  it('is left untended that night only: it burns down, anyone feeds it, and at dawn it is tended again', () => {
    const w = world(BEFORE, { cycle: true });
    w.join(rec('a', 'house', 2, 2, 'up', { bag: [{ item: 'resin', count: 10 }] }), 0);
    w.join(rec('b', 'town', 0, 5), 0);
    w.drain();
    w.feed('a', 2, 1, 0, 1000);
    expect(of(to(w.drain(), 'a'), 'refused')).toEqual([{ t: 'refused', action: 'feed', reason: 'tended' }]);
    w.tick(BEGIN);
    const begun = w.drain();
    expect(onMap(begun, 'house')).toContainEqual({ t: 'fire', fire: { x: 2, y: 1, left: LODGE_FUEL_S } });
    // The campfire someone keeps out there (and every other tended fire) stays tended.
    expect(w.scene('woods', BEGIN).fires).toEqual([{ x: 4, y: 2, left: null }]);
    w.feed('a', 2, 1, 0, BEGIN + 1000, 2);
    expect(of(to(w.drain(), 'a'), 'did')).toEqual([{ t: 'did', did: { kind: 'fire', item: 'resin', count: 2, left: LODGE_FUEL_S - 1 + 600 } }]);
    expect(lodgeFire(w, BEGIN + 1000)).toEqual({ x: 2, y: 1, left: LODGE_FUEL_S - 1 + 600, fed: [{ id: 'a', name: 'A' }] });
    const lines = board(w, 'b', BEGIN + 2000);
    expect(lines[0]).toBe('The Long Night: no rain anywhere. Dawn in about 48 minutes.');
    expect(lines).toContain('The lodge\'s fire needs feeding tonight: 25 minutes left. If it lasts until dawn, next week\'s Long Night keeps its bonus.');
    // It is not among the shelter fires the board lists.
    expect(lines.some(l => l.startsWith('Burning low') || l.startsWith('Gone out'))).toBe(false);
    w.tick(DAWN);
    expect(onMap(w.drain(), 'house')).toContainEqual({ t: 'fire', fire: { x: 2, y: 1, left: null } });
    w.feed('a', 2, 1, 0, DAWN + 1000);
    expect(of(to(w.drain(), 'a'), 'refused')).toEqual([{ t: 'refused', action: 'feed', reason: 'tended' }]);
  });

  it('kept going until dawn, keeps next week\'s bonus', () => {
    const w = world();
    w.join(rec('a', 'house', 2, 2, 'up', { bag: [{ item: 'resin', count: 20 }] }), 0);
    w.tick(BEGIN);
    // A quarter of an hour in it: fed full at 14 minutes (to 44), and again at 40, it lasts the night.
    for (const at of [14, 40]) {
      w.tick(BEGIN + at * 60_000);
      w.feed('a', 2, 1, 0, BEGIN + at * 60_000, 20);
    }
    w.drain();
    w.tick(DAWN);
    expect(of(to(w.drain(), 'a'), 'longNight')).toEqual([{ t: 'longNight', night: { on: false, bonus: true, out: false } }]);
    w.tick(BEGIN + WEEK_MS);
    expect(of(to(w.drain(), 'a'), 'longNight')).toEqual([{ t: 'longNight', night: { on: true, bonus: true, out: false } }]);
  });

  it('went out: everyone hears it, the board says so, and lit again it warms but the next one is only long and dark', () => {
    const w = world();
    w.join(rec('a', 'house', 2, 2, 'up', { bag: [{ item: 'cloth', count: 5 }] }), 0);
    w.join(rec('b', 'town', 0, 5), 0);
    w.tick(BEGIN);
    w.drain();
    w.tick(BEGIN + LODGE_FUEL_S * 1000 - 1000);
    expect(of(to(w.drain(), 'b'), 'longNight')).toEqual([]);
    w.tick(BEGIN + LODGE_FUEL_S * 1000);
    expect(of(to(w.drain(), 'b'), 'longNight')).toEqual([{ t: 'longNight', night: { on: true, bonus: true, out: true } }]);
    expect(board(w, 'b', BEGIN + LODGE_FUEL_S * 1000 + 1000)).toContain('The lodge\'s fire went out tonight: next week\'s Long Night will only be long and dark.');
    w.feed('a', 2, 1, 0, BEGIN + LODGE_FUEL_S * 1000 + 2000, 5);
    expect(of(to(w.drain(), 'a'), 'did')[0]!.did).toMatchObject({ kind: 'fire', lit: true });
    w.tick(DAWN);
    expect(of(to(w.drain(), 'b'), 'longNight')).toEqual([{ t: 'longNight', night: { on: false, bonus: false, out: false } }]);
    expect(board(w, 'b', DAWN + 1000)).toContain('The Long Night comes in about 7 days. The lodge\'s fire went out on the last one, so this one will only be long and dark.');
  });

  it('is saved as it changes, and a restart in the night finds it as it was; one the server slept through went out if it had to', () => {
    const w = world();
    w.join(rec('a', 'house', 2, 2, 'up', { bag: [{ item: 'resin', count: 2 }] }), 0);
    w.takeWrites();
    w.tick(BEGIN);
    expect(w.takeWrites().longNight).toEqual({ week: WEEK, bonus: true, outAt: NIGHT + LODGE_FUEL_S * 1000, out: false, over: false });
    w.feed('a', 2, 1, 0, BEGIN + 60_000, 2);
    const fed = w.takeWrites().longNight!;
    expect(fed.outAt).toBe(NIGHT + (LODGE_FUEL_S + 600) * 1000);
    expect(w.takeWrites().longNight).toBeUndefined();
    // A restart five minutes later: the fire burns on from what it had.
    const again = world(BEFORE, { longNight: fed, now: BEGIN + 5 * 60_000 });
    expect(lodgeFire(again, BEGIN + 5 * 60_000).left).toBe(LODGE_FUEL_S + 600 - 5 * 60);
    expect(again.join(rec('b', 'town', 0, 5), BEGIN + 5 * 60_000).longNight).toEqual({ on: true, bonus: true, out: false });
    // Dawn is written too, with how it went.
    w.tick(DAWN);
    expect(w.takeWrites().longNight).toEqual({ ...fed, out: true, over: true });
    // Down through the dawn: what the fire had when the server stopped says whether it lasted.
    const slept = (outAt: number) => world(NIGHT + WEEK_MS / 2, { longNight: { ...fed, outAt } }).join(rec('c', 'town', 0, 5), 0).longNight;
    expect(slept(NIGHT + DAY_MS - 1000)).toEqual({ on: false, bonus: false, out: false });
    expect(slept(NIGHT + DAY_MS + 1000)).toEqual({ on: false, bonus: true, out: false });
    // Never more than a fire holds, whatever was saved.
    expect(lodgeFire(world(BEFORE, { longNight: { ...fed, outAt: NIGHT + 10 * DAY_MS }, now: BEGIN }), BEGIN).left).toBe(FIRE_MAX_S);
  });

  it('is one fire in every copy of the lodge a crowded town opens: the same fuel, fed in any, out in all', () => {
    // A town of one at a time (crowded copies): b and c are in copies of their own, and so is the lodge they walk into.
    const w = new World(maps(), 'town', 'overcast', { items: ITEMS, epochOffset: BEFORE, rng: () => 0.5, crowd: { town: 1 } });
    for (const id of ['a', 'b']) w.join(rec(id, 'town', 7, 3, 'up', { bag: [{ item: 'resin', count: 5 }] }), 0);
    for (const id of ['a', 'b']) {
      w.step(id, 'up', 1, 1000);
      w.step(id, 'up', 2, 2000);
    }
    expect([w.zoneOf('a'), w.zoneOf('b')]).toEqual(['house', 'house:2']);
    w.tick(BEGIN);
    const left = (key: string, now: number) => w.scene(key, now).fires[0]!.left;
    expect([left('house', BEGIN), left('house:2', BEGIN)]).toEqual([LODGE_FUEL_S, LODGE_FUEL_S]);
    w.drain();
    // Fed in the second copy, it burns as long in the first, and both rooms see it.
    w.feed('b', 2, 1, 0, BEGIN + 1000, 2);
    expect(left('house', BEGIN + 1000)).toBe(LODGE_FUEL_S - 1 + 600);
    expect(onMap(w.drain(), 'house')).toContainEqual({ t: 'fire', fire: { x: 2, y: 1, left: LODGE_FUEL_S - 1 + 600 } });
    // A copy that opens later in the night has it as it burns.
    w.join(rec('c', 'town', 7, 3, 'up'), BEGIN + 2000);
    w.step('c', 'up', 1, BEGIN + 2000);
    expect(w.zoneOf('c')).toBe('house:3');
    expect(left('house:3', BEGIN + 2000)).toBe(LODGE_FUEL_S - 2 + 600);
    // Out in all at once, heard once.
    const out = BEGIN + 1000 + (LODGE_FUEL_S - 1 + 600) * 1000;
    w.drain();
    w.tick(out);
    expect(of(to(w.drain(), 'a'), 'longNight')).toEqual([{ t: 'longNight', night: { on: true, bonus: true, out: true } }]);
    expect([left('house', out), left('house:2', out), left('house:3', out)]).toEqual([0, 0, 0]);
    // Dawn tends it in every copy.
    w.tick(DAWN);
    expect([left('house', DAWN), left('house:2', DAWN), left('house:3', DAWN)]).toEqual([null, null, null]);
  });

  it('reads back only a Long Night the server wrote', () => {
    const good: LongNightRecord = { week: WEEK, bonus: true, outAt: NIGHT, out: false, over: false };
    expect(cleanLongNight(good)).toEqual(good);
    expect(cleanLongNight({ ...good, extra: 1 })).toEqual(good);
    for (const bad of [null, 'x', { ...good, week: 1.5 }, { ...good, bonus: 'yes' }, { ...good, outAt: null }, { ...good, over: undefined }]) expect(cleanLongNight(bad)).toBeNull();
  });
});

describe('over the network', () => {
  let running: RunningServer[] = [];
  const clients: Client[] = [];
  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.terminate();
    for (const s of running) await s.stop();
    running = [];
  });

  it('tells a player in the lodge it began, saves the fire as it is fed, and a restart keeps it burning', async () => {
    setLogLevel('silent');
    const storage = new MemoryStorage();
    let now = 1_000_000;
    const start = async (at: number) => {
      const server = await startServer({ ...serverDefaults(), storage, maps: maps(), items: ITEMS, weather: 'overcast', clock: () => now, clockShiftMs: at - Date.now() });
      running.push(server);
      return server;
    };
    const one = await start(BEFORE);
    const { token } = await savedPlayer(storage, { map: 'house', x: 2, y: 2, dir: 'up', bag: [{ item: 'resin', count: 2 }] });
    const enter = async (port: number) => {
      const c = await Client.open(port);
      clients.push(c);
      c.send({ t: 'hello', v: PROTOCOL_VERSION, token });
      return { c, welcome: await c.next('welcome') };
    };
    const a = await enter(one.port);
    expect(a.welcome.longNight).toEqual({ on: false, bonus: true, out: false });
    expect(a.welcome.fires).toEqual([{ x: 2, y: 1, left: null }]);
    now += 60_000;
    expect(await a.c.next('longNight')).toEqual({ t: 'longNight', night: { on: true, bonus: true, out: false } });
    expect(await a.c.next('fire')).toEqual({ t: 'fire', fire: { x: 2, y: 1, left: LODGE_FUEL_S } });
    a.c.send({ t: 'feed', x: 2, y: 1, slot: 0, count: 2 });
    expect((await a.c.next('did')).did).toMatchObject({ kind: 'fire', item: 'resin', count: 2 });
    // Its clock is the wall clock shifted as the server started, a few ms after the test asked: within a second.
    const saved = await eventually(async () => {
      const r = (await storage.loadLongNight())!;
      expect(r).toMatchObject({ week: WEEK, bonus: true, out: false, over: false });
      expect(Math.abs(r.outAt - (NIGHT + (LODGE_FUEL_S + 600) * 1000))).toBeLessThan(1000);
      return r;
    }, 'the fed fire to be saved');
    a.c.ws.terminate();
    await one.stop();
    running = [];
    // Five minutes later, another server on the same storage: the fire burns on from what it had.
    now += 5 * 60_000;
    const two = await start(NIGHT + 5 * 60_000);
    const b = await enter(two.port);
    expect(b.welcome.longNight).toEqual({ on: true, bonus: true, out: false });
    expect(b.welcome.fires).toEqual([{ x: 2, y: 1, left: LODGE_FUEL_S + 600 - 5 * 60 }]);
    expect(saved.outAt).toBeGreaterThan(NIGHT);
  });
});
