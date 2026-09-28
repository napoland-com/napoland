/**
 * Rested while away, over the real HTTP + WebSocket stack: the time since a player was last seen fills
 * their cup of rest as they arrive (a guest's too), one XP every 20 minutes and three days' worth at most;
 * stashing then earns double, the extra out of the cup, never more than it holds; a parcel, and what comes
 * back after being taken out, touch none of it; the cup is saved, and coming straight back fills nothing.
 */
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, RESTED_MAX, type ClientMsg, type ItemsData } from '@napoland/shared';
import { devAuth } from '../src/auth';
import { MemoryStorage } from '../src/storage';
import { chestMaps, itemsData } from './fixtures';
import { keepsRested, restKeptThroughARestart, savedPlayer, setup, waitFor, type Client } from './helpers';

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
/** The fixture items, each worth some XP at home: moss 2, a nail 3, tea 1; and a welcome parcel of two nails. */
const items = (): ItemsData => ({
  ...itemsData(),
  items: itemsData().items.map(i => ({ ...i, xp: ({ moss: 2, nail: 3, tea: 1 } as Record<string, number>)[i.id] })),
  parcels: { welcome: [{ item: 'nail', count: 2 }], week: Array.from({ length: 7 }, () => [{ item: 'tea', count: 1 }]) },
});
const hello = (more: Partial<Extract<ClientMsg, { t: 'hello' }>>): ClientMsg => ({ t: 'hello', v: PROTOCOL_VERSION, ...more });
/** By the chest in the house (it stands at 3,1). */
const BY_THE_CHEST = { map: 'house', x: 3, y: 2, dir: 'up' } as const;
/** What the client heard of its XP, from now until it is answered, taken out. */
const progress = async (c: Client) => (await c.settle()).flatMap(m => (m.t === 'progress' ? [m] : []));

describe('rest while away, over WebSockets', () => {
  const { ctx, enter, open, welcomed } = setup({ maps: chestMaps(), items: items() });

  it('fills with the time away since they were last seen, one XP every 20 minutes, and the welcome says what it was worth', async () => {
    const back = await enter({ lastSeenAt: Date.now() - 2 * HOUR - MINUTE });
    expect(back.welcome.progress.rested).toBe(6);
    expect(back.welcome.restedAway).toBe(6);
    // Twenty minutes is one; less than that is none yet.
    const short = await enter({ lastSeenAt: Date.now() - 19 * MINUTE });
    expect(short.welcome.progress.rested).toBeUndefined();
    expect(short.welcome.restedAway).toBeUndefined();
    // On top of what the cup held.
    const kept = await enter({ rested: 100, lastSeenAt: Date.now() - 5 * HOUR - MINUTE });
    expect(kept.welcome.progress.rested).toBe(115);
    expect(kept.welcome.restedAway).toBe(15);
    expect(ctx.server.world.get(kept.id)!.rested).toBe(115);
  });

  it('holds three days\' worth at most, 216 XP, and still says what a long time away was worth', async () => {
    const gone = await enter({ lastSeenAt: Date.now() - 10 * DAY });
    expect(gone.welcome.progress.rested).toBe(RESTED_MAX);
    expect(gone.welcome.restedAway).toBe(RESTED_MAX);
    const nearly = await enter({ rested: 210, lastSeenAt: Date.now() - DAY - MINUTE });
    expect(nearly.welcome.progress.rested).toBe(RESTED_MAX);
    expect(nearly.welcome.restedAway).toBe(72);
    // A full cup stays full, and a long time away is still worth a word.
    const full = await enter({ rested: RESTED_MAX, lastSeenAt: Date.now() - 4 * HOUR - MINUTE });
    expect(full.welcome.progress.rested).toBe(RESTED_MAX);
    expect(full.welcome.restedAway).toBe(12);
  });

  it('doubles what stashing earns, the extra out of the cup, until it is empty; then stashing earns as it always did', async () => {
    const a = await enter({ ...BY_THE_CHEST, lastSeenAt: Date.now() - 6 * HOUR - MINUTE, bag: [{ item: 'nail', count: 5 }, { item: 'moss', count: 3 }, { item: 'tea', count: 2 }] });
    expect(a.welcome.progress.rested).toBe(18);
    await a.c.settle();
    // Five nails: 15 XP, and 15 more out of the cup.
    a.c.send({ t: 'store', x: 3, y: 1, slot: 0 });
    expect(await progress(a.c)).toEqual([{ t: 'progress', progress: expect.objectContaining({ xp: 30, rested: 3 }), gained: 30, fromRest: 15 }]);
    // Three moss: 6 XP, and only the 3 the cup has left.
    a.c.send({ t: 'store', x: 3, y: 1, slot: 0 });
    const [moss] = await progress(a.c);
    expect(moss).toEqual({ t: 'progress', progress: expect.objectContaining({ xp: 39 }), gained: 9, fromRest: 3 });
    expect(moss!.progress.rested).toBeUndefined();
    // The cup is empty: the tea earns its 2 XP and nothing more.
    a.c.send({ t: 'store', x: 3, y: 1 });
    expect(await progress(a.c)).toEqual([{ t: 'progress', progress: expect.objectContaining({ xp: 41 }), gained: 2 }]);
    // Saved at once, with the stash: an empty cup.
    await waitFor(() => ctx.storage.get(a.id)?.xp === 41, 'the XP to be saved');
    expect(ctx.storage.get(a.id)!.rested).toBeUndefined();
  });

  it('spends none of it on what earns nothing: what comes back after being taken out', async () => {
    const a = await enter({ ...BY_THE_CHEST, lastSeenAt: Date.now() - 2 * HOUR - MINUTE, xp: 50, stash: { items: { nail: 4 }, out: {} } });
    await a.c.settle();
    a.c.send({ t: 'take', x: 3, y: 1, item: 'nail', count: 4 });
    a.c.send({ t: 'store', x: 3, y: 1 });
    expect(await progress(a.c)).toEqual([{ t: 'progress', progress: expect.objectContaining({ xp: 50, rested: 6 }), gained: 0 }]);
    expect(ctx.server.world.get(a.id)).toMatchObject({ xp: 50, rested: 6 });
  });

  it('is saved with the player, and coming straight back, or from another tab, fills nothing more', async () => {
    const saved = await savedPlayer(ctx.storage, { ...BY_THE_CHEST, lastSeenAt: Date.now() - 10 * HOUR - MINUTE, bag: [{ item: 'nail', count: 3 }] });
    const first = await open();
    expect((await welcomed(first, hello({ token: saved.token }))).progress.rested).toBe(30);
    first.send({ t: 'store', x: 3, y: 1 });
    expect(await progress(first)).toEqual([{ t: 'progress', progress: expect.objectContaining({ xp: 18, rested: 21 }), gained: 18, fromRest: 9 }]);
    // Another tab takes over: the player is the one who was online, with the cup as it stood.
    const second = await open();
    const again = await welcomed(second, hello({ token: saved.token }));
    expect(again.progress).toMatchObject({ xp: 18, rested: 21 });
    expect(again.restedAway).toBeUndefined();
    second.ws.terminate();
    await waitFor(() => !ctx.server.world.has(saved.id), 'the player to leave');
    await waitFor(() => ctx.storage.get(saved.id)?.rested === 21, 'the cup to be saved');
    // And back a moment later: nothing more.
    const third = await open();
    const back = await welcomed(third, hello({ token: saved.token }));
    expect(back.progress).toMatchObject({ xp: 18, rested: 21 });
    expect(back.restedAway).toBeUndefined();
  });
});

describe('rest with sign-in', () => {
  const { ctx, open, welcomed } = setup({ maps: chestMaps(), items: items(), auth: devAuth() });
  let people = 0;

  it('fills a guest\'s cup too', async () => {
    const guest = await savedPlayer(ctx.storage, { lastSeenAt: Date.now() - 3 * HOUR - MINUTE });
    const welcome = await welcomed(await open(), hello({ token: guest.token }));
    expect(welcome).toMatchObject({ guest: true, restedAway: 9, progress: expect.objectContaining({ rested: 9 }) });
  });

  it('spends none of it on a parcel, nor on the parcel taken out and brought back', async () => {
    const mail = `rested-${++people}@example.test`;
    const saved = await savedPlayer(ctx.storage, { ...BY_THE_CHEST, tokenHash: null, authSub: `dev:${mail}`, lastSeenAt: Date.now() - 2 * HOUR - MINUTE, xp: 7 });
    const c = await open();
    const welcome = await welcomed(c, hello({ auth: mail }));
    expect(welcome.progress).toMatchObject({ xp: 7, rested: 6 });
    // The welcome parcel came into the chest as they arrived, and earned nothing: no word of XP.
    const arrived = await c.settle();
    expect(arrived.filter(m => m.t === 'parcel')).toEqual([{ t: 'parcel', parcel: { weekday: null, items: [{ item: 'nail', count: 2 }] } }]);
    expect(arrived.filter(m => m.t === 'progress')).toEqual([]);
    expect(ctx.server.world.get(saved.id)!.stash!.items).toEqual({ nail: 2 });
    c.send({ t: 'take', x: 3, y: 1, item: 'nail', count: 2 });
    c.send({ t: 'store', x: 3, y: 1 });
    expect(await progress(c)).toEqual([{ t: 'progress', progress: expect.objectContaining({ xp: 7, rested: 6 }), gained: 0 }]);
  });
});

describe('rest kept in memory', () => {
  it('is saved with the player: none for a new one, what a save writes, none once spent', async () => {
    await keepsRested(new MemoryStorage());
  });

  it('comes back with the player through a restart', async () => {
    const storage = new MemoryStorage();
    await restKeptThroughARestart(storage, storage);
  });
});
