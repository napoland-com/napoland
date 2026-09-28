/**
 * A parcel a day, over real WebSockets: the welcome parcel the first time someone signs in (never for a
 * guest, and on the claim for one who signs in), a day's parcel the first time they play each calendar
 * day in UTC (and at midnight for whoever is online), Sunday's lockbox only for whoever came back all
 * week, no XP for any of it, the lockbox opened at the chest, and the notice board's calendar. The
 * world's clock reads a time the test picks (CLOCK_SHIFT_MS) and moves only when the test moves it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CALENDAR_DAY_MS, PROTOCOL_VERSION, TileMap, WEEKDAYS, type ClientMsg, type ItemsData, type ServerMsg } from '@napoland/shared';
import { devAuth } from '../src/auth';
import { setLogLevel } from '../src/log';
import { startServer, type RunningServer, type ServerOptions } from '../src/server';
import { MemoryStorage, type PlayerRecord } from '../src/storage';
import { houseData, itemsData, townData, woodsData } from './fixtures';
import { Client, boardText, keepsParcels, keepsToolsParcelsAndOutfit, newName, parcelsThroughRestarts, savedPlayer, serverDefaults, type Msg } from './helpers';

/** Monday 28 September 2026, 00:00 UTC, and the calendar day it is. */
const MONDAY = Date.UTC(2026, 8, 28);
const MON = MONDAY / CALENDAR_DAY_MS;
const DAY = CALENDAR_DAY_MS;

/** The notice board at 2,5 in town (read it from 2,6); a chest at 3,1 in the house (open it from 3,2). */
const maps = () => [
  new TileMap({ ...townData(), objects: [...townData().objects, { kind: 'board', x: 2, y: 5 }] }),
  new TileMap({ ...houseData(), objects: [...houseData().objects, { kind: 'chest', x: 3, y: 1 }] }),
  new TileMap(woodsData()),
];
/** Nails each day, as many as the day's place in the week, so a parcel says which day it is; a lockbox for all seven. */
const items = (): ItemsData => ({
  ...itemsData(),
  items: [
    ...itemsData().items.map(i => ({ ...i, xp: 2 })),
    { id: 'resin', name: 'Fir resin', noun: 'resin', plural: 'resin', kind: 'resource', stack: 20, xp: 2, text: 'Sticky.' },
    { id: 'shard', name: 'Anomaly shard', noun: 'shard', kind: 'resource', stack: 5, xp: 12, text: 'Warm.', about: 'The Old Stone wants it.' },
    { id: 'bead', name: 'Humming bead', kind: 'charm', stack: 1, xp: 25, text: 'It hums.', charm: { hitch: 0.4 }, about: 'Hitchhikers think twice.' },
    {
      id: 'lockbox', name: 'NAPO lockbox', noun: 'NAPO lockbox', plural: 'NAPO lockboxes', kind: 'sealed', stack: 1, text: 'Sealed.', seal: 'It has been sealed since the evacuation.',
      holds: [{ weight: 1, items: [{ item: 'shard', count: 3 }] }, { weight: 1, any: 'charm' }],
    },
  ],
  parcels: {
    welcome: [{ item: 'resin', count: 5 }, { item: 'tea', count: 1 }],
    week: WEEKDAYS.map((_, i) => [{ item: 'nail', count: i + 1 }]),
    allWeek: [{ item: 'lockbox', count: 1 }],
  },
});
const nails = (weekday: number) => [{ item: 'nail', count: weekday + 1 }];

type Hello = Extract<ClientMsg, { t: 'hello' }>;
let running: Array<{ server: RunningServer; clients: Client[] }> = [];
afterEach(async () => {
  for (const { server, clients } of running) {
    for (const c of clients) c.ws.terminate();
    await server.stop();
  }
  running = [];
});

/** A server whose world clock reads `at` now and moves only with `later`; sign-in is dev mode unless `more` says otherwise. */
async function serverAt(at: number, more: Partial<ServerOptions> = {}) {
  setLogLevel('silent');
  let now = 1_000_000;
  const storage = new MemoryStorage();
  const server = await startServer({
    ...serverDefaults(), storage, maps: maps(), items: items(), auth: devAuth(), weather: 'overcast', clock: () => now, clockShiftMs: at - Date.now(), rng: () => 0, ...more,
  });
  const clients: Client[] = [];
  running.push({ server, clients });
  const hello = async (h: Partial<Hello>) => {
    const c = await Client.open(server.port);
    clients.push(c);
    c.send({ t: 'hello', v: PROTOCOL_VERSION, ...h });
    return { c, welcome: await c.next('welcome') };
  };
  return {
    server, storage, hello,
    later: (ms: number) => { now += ms; },
    /** Signs in as `email` (a new character the first time), and takes the welcome. */
    signIn: (email: string, more: Partial<Hello> = {}) => hello({ auth: email, name: newName(), ...more }),
    /** Everyone this client heard so far of kind `t`, taken out. */
    heard: async <T extends ServerMsg['t']>(c: Client, t: T) => (await c.settle()).filter((m): m is Msg<T> => m.t === t),
    gone: async (id: string) => { for (let i = 0; i < 300 && server.world.has(id); i++) await new Promise(r => setTimeout(r, 10)); },
  };
}

describe('the welcome parcel', () => {
  it('waits in the chest the first time someone signs in, once, and earns no XP', async () => {
    const w = await serverAt(MONDAY + 1 * DAY + 10 * 3_600_000);
    const ann = await w.signIn('ann@example.test');
    expect(await ann.c.next('parcel')).toEqual({ t: 'parcel', parcel: { weekday: null, items: [{ item: 'resin', count: 5 }, { item: 'tea', count: 1 }] } });
    const rec = w.server.world.get(ann.welcome.you)!;
    // Into the chest, never the bag; no XP, and nothing counted as taken out.
    expect(rec).toMatchObject({ bag: [], xp: 0, stash: { items: { resin: 5, tea: 1 }, out: {} }, parcels: { welcome: true, day: MON + 1, days: 0b10 } });
    // Saved at once, and not again that day.
    expect(w.storage.get(ann.welcome.you)?.parcels).toEqual({ welcome: true, day: MON + 1, days: 0b10 });
    ann.c.ws.close();
    await w.gone(ann.welcome.you);
    const again = await w.signIn('ann@example.test');
    expect(again.welcome.you).toBe(ann.welcome.you);
    expect(await w.heard(again.c, 'parcel')).toEqual([]);
    expect(w.server.world.get(ann.welcome.you)!.stash).toEqual({ items: { resin: 5, tea: 1 }, out: {} });
  });

  it('never comes to a guest; signing in with the guest\'s character brings it then', async () => {
    const w = await serverAt(MONDAY + 2 * DAY + 3_600_000);
    const guest = await w.hello({ name: newName() });
    expect(guest.welcome.guest).toBe(true);
    expect(await w.heard(guest.c, 'parcel')).toEqual([]);
    expect(w.server.world.get(guest.welcome.you)).toMatchObject({ stash: { items: {}, out: {} } });
    expect(w.server.world.get(guest.welcome.you)!.parcels).toBeUndefined();
    const kept = await w.hello({ auth: 'wren@example.test', token: guest.welcome.token! });
    expect(kept.welcome).toMatchObject({ you: guest.welcome.you, claimed: true, guest: false });
    expect((await kept.c.next('parcel')).parcel).toEqual({ weekday: null, items: [{ item: 'resin', count: 5 }, { item: 'tea', count: 1 }] });
    expect(w.server.world.get(guest.welcome.you)!.stash!.items).toEqual({ resin: 5, tea: 1 });
  });

  it('never comes without sign-in (legacy): nobody has parcels there', async () => {
    const w = await serverAt(MONDAY + 3_600_000, { auth: undefined });
    const p = await w.hello({ name: newName() });
    expect(p.welcome.guest).toBe(false);
    expect(await w.heard(p.c, 'parcel')).toEqual([]);
    expect(w.server.world.get(p.welcome.you)!.parcels).toBeUndefined();
  });
});

describe('a parcel a day', () => {
  it('comes the first time someone plays on each calendar day, and at midnight UTC for whoever is online', async () => {
    // Tuesday, two seconds before midnight.
    const w = await serverAt(MONDAY + 2 * DAY - 2000);
    const bo = await w.signIn('bo@example.test');
    expect((await bo.c.next('parcel')).parcel.weekday).toBeNull();
    // Midnight passes while they play: Wednesday's parcel at once, and the chest and the workbench hear the stash.
    w.later(5000);
    expect(await bo.c.next('parcel')).toEqual({ t: 'parcel', parcel: { weekday: 2, items: nails(2) } });
    expect(await bo.c.next('chest')).toEqual({ t: 'chest', stash: [{ item: 'nail', count: 3 }, { item: 'tea', count: 1 }, { item: 'resin', count: 5 }] });
    expect((await bo.c.next('bench')).stash).toHaveLength(3);
    expect(w.storage.get(bo.welcome.you)?.parcels).toEqual({ welcome: true, day: MON + 2, days: 0b110 });
    // Nothing more that day, however often they come back.
    bo.c.ws.close();
    await w.gone(bo.welcome.you);
    const back = await w.signIn('bo@example.test');
    expect(await w.heard(back.c, 'parcel')).toEqual([]);
    back.c.ws.close();
    await w.gone(bo.welcome.you);
    // Away on Thursday; back on Friday: Friday's parcel, and no XP for any of it.
    w.later(2 * DAY);
    const friday = await w.signIn('bo@example.test');
    expect((await friday.c.next('parcel')).parcel).toEqual({ weekday: 4, items: nails(4) });
    expect(w.server.world.get(bo.welcome.you)).toMatchObject({ xp: 0, stash: { items: { resin: 5, tea: 1, nail: 8 }, out: {} }, parcels: { day: MON + 4, days: 0b10110 } });
  });

  it('holds a lockbox on Sunday for whoever came back on all seven days, from the welcome on Monday', async () => {
    const w = await serverAt(MONDAY + 5000);
    const cy = await w.signIn('cy@example.test');
    expect((await cy.c.next('parcel')).parcel.weekday).toBeNull();
    for (let d = 1; d < 7; d++) {
      w.later(DAY);
      const { parcel } = await cy.c.next('parcel');
      expect(parcel).toEqual(d < 6 ? { weekday: d, items: nails(d) } : { weekday: 6, items: nails(6), allWeek: [{ item: 'lockbox', count: 1 }] });
    }
    expect(w.server.world.get(cy.welcome.you)!.stash!.items).toMatchObject({ lockbox: 1 });
    expect(w.server.world.get(cy.welcome.you)!.parcels).toEqual({ welcome: true, day: MON + 6, days: 0b111_1111 });
    // A new week starts afresh.
    w.later(DAY);
    expect((await cy.c.next('parcel')).parcel).toEqual({ weekday: 0, items: nails(0) });
    expect(w.server.world.get(cy.welcome.you)!.parcels).toEqual({ welcome: true, day: MON + 7, days: 0b1 });
  });

  it('holds no lockbox on Sunday for whoever missed a day, and takes nothing away', async () => {
    const w = await serverAt(MONDAY + 6 * DAY + 3_600_000);
    const saved = (email: string, days: number) => savedPlayer(w.storage, {
      tokenHash: null, authSub: `dev:${email}`, stash: { items: { nail: 4 }, out: {} }, parcels: { welcome: true, day: MON + 5, days },
    });
    await saved('all@example.test', 0b011_1111);
    await saved('missed@example.test', 0b011_1011);
    const all = await w.signIn('all@example.test');
    expect((await all.c.next('parcel')).parcel).toEqual({ weekday: 6, items: nails(6), allWeek: [{ item: 'lockbox', count: 1 }] });
    const missed = await w.signIn('missed@example.test');
    expect((await missed.c.next('parcel')).parcel).toEqual({ weekday: 6, items: nails(6) });
    expect(w.server.world.get(missed.welcome.you)!.stash!.items).toEqual({ nail: 11 });
  });
});

describe('the NAPO lockbox', () => {
  /** Signed in, at the chest in the house, today's parcel already had: only the lockbox and what is asked of it. */
  async function atTheChest(stash: NonNullable<PlayerRecord['stash']>, rng: () => number) {
    const w = await serverAt(MONDAY + 6 * DAY + 3_600_000, { rng });
    await savedPlayer(w.storage, {
      tokenHash: null, authSub: 'dev:box@example.test', map: 'house', x: 3, y: 2, dir: 'up', xp: 40, stash, parcels: { welcome: true, day: MON + 6, days: 0b111_1111 },
    });
    const p = await w.signIn('box@example.test');
    await p.c.settle();
    return { w, ...p };
  }

  it('opens at the chest: what it held goes into the stash, for no XP, and the box says what was inside', async () => {
    const { w, c, welcome } = await atTheChest({ items: { lockbox: 2, resin: 1 }, out: {} }, () => 0);
    c.send({ t: 'open', x: 3, y: 1, item: 'lockbox' });
    const heard = (await c.settle()).filter(m => m.t !== 'energy');
    expect(heard).toEqual([
      { t: 'chest', stash: [{ item: 'resin', count: 1 }, { item: 'shard', count: 3 }, { item: 'lockbox', count: 1 }] },
      { t: 'did', did: { kind: 'opened', item: 'lockbox', got: [{ item: 'shard', count: 3 }] } },
    ]);
    expect(w.server.world.get(welcome.you)).toMatchObject({ xp: 40, stash: { items: { lockbox: 1, resin: 1, shard: 3 }, out: {} } });
    expect(w.storage.get(welcome.you)!.stash!.items).toEqual({ lockbox: 1, resin: 1, shard: 3 });
    // Taken out and brought back, what it held earns nothing either.
    c.send({ t: 'take', x: 3, y: 1, item: 'shard', count: 3 });
    c.send({ t: 'store', x: 3, y: 1 });
    expect((await w.heard(c, 'progress')).map(m => m.gained)).toEqual([0]);
  });

  it('holds any one charm by the dice', async () => {
    // The second holding (a charm), and the first charm there is.
    const { c } = await atTheChest({ items: { lockbox: 1 }, out: {} }, () => 0.75);
    c.send({ t: 'open', x: 3, y: 1, item: 'lockbox' });
    expect(await c.next('did')).toEqual({ t: 'did', did: { kind: 'opened', item: 'lockbox', got: [{ item: 'bead', count: 1 }] } });
  });

  it('stays in the chest, and opens only there, only what is sealed and only what the stash holds', async () => {
    const { w, c, welcome } = await atTheChest({ items: { lockbox: 1, resin: 2 }, out: {} }, () => 0);
    c.send({ t: 'take', x: 3, y: 1, item: 'lockbox', count: 1 });
    c.send({ t: 'open', x: 3, y: 1, item: 'resin' });
    c.send({ t: 'open', x: 3, y: 1, item: 'shard' });
    c.send({ t: 'open', x: 2, y: 1, item: 'lockbox' });
    expect((await c.settle()).filter(m => m.t === 'refused')).toEqual([
      { t: 'refused', action: 'take', reason: 'sealed_stays' },
      { t: 'refused', action: 'open', reason: 'not_usable' },
      { t: 'refused', action: 'open', reason: 'not_stashed' },
      { t: 'refused', action: 'open', reason: 'too_far' },
    ]);
    expect(w.server.world.get(welcome.you)).toMatchObject({ bag: [], stash: { items: { lockbox: 1, resin: 2 }, out: {} } });
  });
});

describe('the calendar on the notice board', () => {
  const read = async (c: Client) => {
    c.send({ t: 'board', x: 2, y: 5 });
    return boardText(await c.next('board'), items());
  };
  const CALENDAR = [
    "Parcels this week, from the town's stores. Mon: a nail. Tue: 2 nails. Wed (today): 3 nails. Thu: 4 nails.",
    'Fri: 5 nails. Sat: 6 nails. Sun: 7 nails, and a NAPO lockbox for whoever came back on all seven days.',
  ];

  it('lists this week\'s parcels with today marked, and the days you came back', async () => {
    const w = await serverAt(MONDAY + 2 * DAY + 3_600_000);
    const at = { map: 'town', x: 2, y: 6, dir: 'up' as const };
    await savedPlayer(w.storage, { ...at, tokenHash: null, authSub: 'dev:on@example.test', parcels: { welcome: true, day: MON + 1, days: 0b11 } });
    await savedPlayer(w.storage, { ...at, tokenHash: null, authSub: 'dev:off@example.test', parcels: { welcome: true, day: MON, days: 0b1 } });
    const on = await w.signIn('on@example.test');
    expect((await read(on.c)).slice(-3)).toEqual([...CALENDAR, 'You came back Mon, Tue, Wed. Play every day this week and Sunday\'s parcel holds a NAPO lockbox.']);
    const off = await w.signIn('off@example.test');
    expect((await read(off.c)).slice(-3)).toEqual([
      ...CALENDAR, 'You came back Mon, Wed. A new week starts fresh on Monday: play every day and Sunday\'s parcel holds a NAPO lockbox.',
    ]);
  });

  it('says to someone on their very first day, or their first this week, that they came home today', async () => {
    const w = await serverAt(MONDAY + 2 * DAY + 3_600_000);
    const at = { map: 'town', x: 2, y: 6, dir: 'up' as const };
    // Signing in for the first time brings the welcome parcel, today.
    await savedPlayer(w.storage, { ...at, tokenHash: null, authSub: 'dev:new@example.test' });
    await savedPlayer(w.storage, { ...at, tokenHash: null, authSub: 'dev:back@example.test', parcels: { welcome: true, day: MON - 3, days: 0b1 } });
    const fresh = await w.signIn('new@example.test');
    expect(await fresh.c.next('parcel')).toMatchObject({ parcel: { weekday: null } });
    const home = "You came home today. A new week starts fresh on Monday: play every day and Sunday's parcel holds a NAPO lockbox.";
    expect((await read(fresh.c)).slice(-3)).toEqual([...CALENDAR, home]);
    const back = await w.signIn('back@example.test');
    expect((await read(back.c)).slice(-3)).toEqual([...CALENDAR, home]);
    // On a Monday the whole week is still ahead.
    const monday = await serverAt(MONDAY + 3_600_000);
    await savedPlayer(monday.storage, { ...at, tokenHash: null, authSub: 'dev:new@example.test' });
    const first = await monday.signIn('new@example.test');
    expect((await read(first.c)).at(-1)).toBe("You came home today. Play every day this week and Sunday's parcel holds a NAPO lockbox.");
  });

  it('says so on Sunday to whoever came back every day', async () => {
    const w = await serverAt(MONDAY + 6 * DAY + 3_600_000);
    await savedPlayer(w.storage, { map: 'town', x: 2, y: 6, dir: 'up', tokenHash: null, authSub: 'dev:every@example.test', parcels: { welcome: true, day: MON + 5, days: 0b11_1111 } });
    const p = await w.signIn('every@example.test');
    expect((await read(p.c)).at(-1)).toBe('You came back every day this week, and Sunday\'s parcel held a NAPO lockbox.');
  });

  it('shows a guest the calendar, and that signing in brings the parcels; without sign-in it says nothing of them', async () => {
    const w = await serverAt(MONDAY + 2 * DAY + 3_600_000);
    const guest = await savedPlayer(w.storage, { map: 'town', x: 2, y: 6, dir: 'up' });
    const g = await w.hello({ token: guest.token });
    expect((await read(g.c)).slice(-3)).toEqual([...CALENDAR, 'Sign in to get the parcels.']);
    const legacy = await serverAt(MONDAY + 2 * DAY + 3_600_000, { auth: undefined });
    const old = await savedPlayer(legacy.storage, { map: 'town', x: 2, y: 6, dir: 'up' });
    const l = await legacy.hello({ token: old.token });
    expect((await read(l.c)).some(line => line.includes('arcel'))).toBe(false);
  });
});

describe('keeping the parcels', () => {
  it('keeps where each player stands with them, in memory as in the database (storage-pg.test.ts)', async () => {
    await keepsParcels(new MemoryStorage());
  });

  it('gives them through restarts: once a day, whatever the server did in between', async () => {
    await parcelsThroughRestarts(new MemoryStorage());
  });

  it('keeps them beside the tools a player owns and the outfit they wear, none lost to a save without it (storage-pg.test.ts)', async () => {
    await keepsToolsParcelsAndOutfit(new MemoryStorage());
  });
});
