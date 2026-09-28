/**
 * Thanks, and while you were away, over real WebSockets (thanks.ts): a fire remembers who fed it last and
 * an arrow who painted it; whoever warms at the one or stands where the other points thanks them, once a
 * UTC day each. The helper hears it at once when online (energy out in the wilds, five times a trip at
 * most; a line anywhere else), or in a letter when they walk into their home room. It counts toward Good
 * neighbor, whose arrows last longer, and who thanked whom is forgotten after 7 days.
 *
 * The fixture maps (fixtures.ts), with a chest in the house (so it is a home: walking into it ends a trip)
 * and a fire in the woods at 5,5 that burns down (it warms 4,4 to 6,6; 4,6 is one step from the way
 * home). A game clock that only moves when a test moves it; the wall clock follows it.
 */
import { describe, expect, it } from 'vitest';
import { MARK_LIFETIME_MS, PROTOCOL_VERSION, STEP_MS, THANKS_KEPT_MS, TileMap, utcDay, type Dir, type ItemsData, type ServerMsg } from '@napoland/shared';
import { devAuth } from '../src/auth';
import { setLogLevel } from '../src/log';
import { startServer } from '../src/server';
import { MemoryStorage } from '../src/storage';
import { houseData, itemsData, townData, woodsData } from './fixtures';
import { Client, keepsWholeRow, loginTo, savedPlayer, serverDefaults, setup, waitFor } from './helpers';

const DAY = 86_400_000;
/** Long enough for every fire out there to go out. */
const OUT = 40 * 60 * 1000;
const maps = () => [
  new TileMap(townData()),
  new TileMap({ ...houseData(), objects: [...houseData().objects, { kind: 'chest', x: 1, y: 1 }] }),
  new TileMap({ ...woodsData(), objects: [{ kind: 'lamp', x: 1, y: 4 }, { kind: 'fireplace', x: 5, y: 5 }] }),
];
const items = (): ItemsData => ({
  ...itemsData(),
  items: [
    ...itemsData().items,
    { id: 'resin', name: 'Fir resin', kind: 'resource', stack: 20, text: 'Sticky.', fuel: 300 },
    { id: 'cap', name: 'Glowcap', kind: 'resource', stack: 20, text: 'Glows.', use: { mark: true } },
  ],
});
const FIRE = { kind: 'fire' as const, x: 5, y: 5 };
const theFire = { kind: 'fire' as const, map: 'woods', x: 5, y: 5 };
/** From 5,6 by the fire, out of the woods and into the house: home. */
const HOME: Dir[] = ['left', 'down', 'down', 'down', 'right', 'right', 'up'];
/** From the house's way in, out to the town and back in. */
const OUT_AND_IN: Dir[] = ['down', 'up'];
/**
 * The wait from the server's wall clock `wall` (a welcome's `clock`) to a minute into the next UTC day. Never the
 * real clock: every test here moves the game clock on, and the server's wall with it, hours past the real one.
 */
const nextDay = (wall: number) => DAY - (wall % DAY) + 60_000;

describe('thanks over the network', () => {
  let now = 1_000_000;
  let seq = 0;
  // rng 0: a fire that goes out and is lit again starts from what it is fed.
  const { ctx, enter, login } = setup({ maps: maps(), items: items(), weather: 'overcast', clock: () => now, rng: () => 0 });
  const world = () => ctx.server.world;
  /** Steps along `dirs`, each a step's time on the game clock after the last. */
  async function walk(c: Client, dirs: Dir[]) {
    for (const dir of dirs) {
      const s = ++seq;
      c.send({ t: 'step', dir, seq: s });
      await c.next('step', m => m.seq === s);
      now += STEP_MS;
    }
  }
  /** A player by the fire who feeds it one resin: one of its feeders. */
  async function feeder(more: Parameters<typeof enter>[0] = {}) {
    const h = await enter({ map: 'woods', x: 5, y: 6, bag: [{ item: 'resin', count: 1 }], ...more });
    await h.c.settle();
    h.c.send({ t: 'feed', x: 5, y: 5, slot: 0 });
    await h.c.next('did');
    return h;
  }

  it('a fire remembers who fed it last; a thanks goes to one of them, from by the fire only, once a UTC day', async () => {
    now += OUT;
    const b = await enter({ map: 'woods', x: 4, y: 6 });
    const far = await enter({ map: 'woods', x: 1, y: 1 });
    await Promise.all([b.c.settle(), far.c.settle()]);
    const a = await feeder({ energy: 50 });
    expect((await b.c.next('fire')).fire).toEqual({ x: 5, y: 5, left: 300, fed: [{ id: a.id, name: a.welcome.name }] });

    // From afar it is too far; someone who never fed it, or oneself, is nobody to thank for it.
    far.c.send({ t: 'thank', who: a.id, what: FIRE });
    expect(await far.c.next('refused')).toEqual({ t: 'refused', action: 'thank', reason: 'too_far' });
    b.c.send({ t: 'thank', who: far.id, what: FIRE });
    expect(await b.c.next('refused')).toEqual({ t: 'refused', action: 'thank', reason: 'gone' });
    a.c.send({ t: 'thank', who: a.id, what: FIRE });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'thank', reason: 'gone' });

    b.c.send({ t: 'thank', who: a.id, what: FIRE });
    expect(await b.c.next('did')).toEqual({ t: 'did', did: { kind: 'thanked', who: a.id, name: a.welcome.name, what: 'fire' } });
    // Out in the wilds: 3 energy, and a float; what it was for waits for the letter.
    expect(await a.c.next('thanked')).toEqual({ t: 'thanked', name: b.welcome.name, what: theFire, energy: 3 });
    expect((await a.c.next('energy', m => m.energy.value > 50)).energy.value).toBe(53);
    expect(world().get(a.id)!.stats).toEqual({ fed: 1, thanked: 1 });
    // Once a day for each helper.
    b.c.send({ t: 'thank', who: a.id, what: FIRE });
    expect(await b.c.next('refused')).toEqual({ t: 'refused', action: 'thank', reason: 'thanked' });
    // Kept, and counted apart from the rest of the player.
    await waitFor(() => ctx.storage.storedThanks().some(t => t.giver === b.id && t.helper === a.id), 'the thanks to be stored');
    expect(ctx.storage.storedThanks().find(t => t.giver === b.id)).toEqual({ giver: b.id, helper: a.id, day: expect.any(Number), at: expect.any(Number), what: theFire, told: false });
    await waitFor(() => ctx.storage.get(a.id)!.stats?.thanked === 1, 'the thanks received to be counted');
    // Back in the same day, the welcome says whom they thanked.
    b.c.ws.terminate();
    await waitFor(() => !world().has(b.id), 'b to leave');
    expect((await login(b.token)).welcome.thanked).toEqual([a.id]);
  });

  it('warms a helper out in the wilds by 3, five times a trip at most; walking into their home room starts a new trip', async () => {
    now += OUT;
    const h = await feeder({ energy: 50 });
    const givers = [];
    for (let i = 0; i < 7; i++) givers.push(await enter({ map: 'woods', x: 4, y: 6 }));
    for (const g of givers.slice(0, 6)) {
      g.c.send({ t: 'thank', who: h.id, what: FIRE });
      await g.c.next('did');
    }
    const heard = await h.c.settle();
    expect(of(heard, 'thanked').map(m => m.energy)).toEqual([3, 3, 3, 3, 3, undefined]);
    expect(world().get(h.id)!.energy).toBe(65);
    await walk(h.c, HOME);
    expect(world().get(h.id)).toMatchObject({ map: 'house', x: 2, y: 3 });
    await h.c.next('letter');
    // Out again: the first thanks of the new trip warms them again.
    await walk(h.c, ['down', 'left', 'left', 'up', 'up', 'up']);
    expect(world().get(h.id)).toMatchObject({ map: 'woods', x: 4, y: 6 });
    givers[6]!.c.send({ t: 'thank', who: h.id, what: FIRE });
    expect((await h.c.next('thanked')).energy).toBe(3);
  });

  it('says it in the text box of a helper who is not out there, and puts the rest in a letter for when they walk in at home', async () => {
    now += OUT;
    // The helper feeds the fire and paints an arrow west, onto 4,6 (by the fire too), then leaves the game.
    const h = await feeder({ dir: 'left', energy: 50, bag: [{ item: 'resin', count: 1 }, { item: 'cap', count: 1 }] });
    h.c.send({ t: 'use', slot: 0 });
    const { mark } = await h.c.next('mark');
    expect(mark).toMatchObject({ x: 5, y: 6, dir: 'left', owner: h.id, name: h.welcome.name });
    h.c.ws.terminate();
    await waitFor(() => !world().has(h.id), 'the helper to leave');

    const [g1, g2, g3, g4, g5] = [await enter({ map: 'woods', x: 4, y: 6 }), await enter({ map: 'woods', x: 4, y: 6 }), await enter({ map: 'woods', x: 4, y: 6 }), await enter({ map: 'woods', x: 4, y: 6 }), await enter({ map: 'woods', x: 4, y: 5 })];
    for (const g of [g1, g2]) {
      g.c.send({ t: 'thank', who: h.id, what: FIRE });
      await g.c.next('did');
      now += 1000;
    }
    g3!.c.send({ t: 'thank', who: h.id, what: { kind: 'mark', id: mark.id } });
    expect(await g3!.c.next('did')).toEqual({ t: 'did', did: { kind: 'thanked', who: h.id, name: h.welcome.name, what: 'mark' } });
    now += 1000;
    // Back in the game, out in the woods: a float now, the letter later.
    const back = await login(h.token);
    g4!.c.send({ t: 'thank', who: h.id, what: FIRE });
    expect(await back.c.next('thanked')).toEqual({ t: 'thanked', name: g4!.welcome.name, what: theFire, energy: expect.any(Number) });
    expect(of(await back.c.settle(), 'letter')).toEqual([]);

    await walk(back.c, HOME);
    // Grouped by what it was for, the most thanked first; the names of the latest two.
    expect(await back.c.next('letter')).toEqual({
      t: 'letter',
      thanks: [
        { what: theFire, count: 3, people: 3, names: [g4!.welcome.name, g2!.welcome.name] },
        { what: { kind: 'mark', map: 'woods', x: 5, y: 6 }, count: 1, people: 1, names: [g3!.welcome.name] },
      ],
    });
    // At home, a thanks is said in the text box, and it is in no letter.
    g5!.c.send({ t: 'thank', who: h.id, what: FIRE });
    expect(await back.c.next('thanked')).toEqual({ t: 'thanked', name: g5!.welcome.name, what: theFire, line: true });
    await walk(back.c, OUT_AND_IN);
    expect(of(await back.c.settle(), 'letter')).toEqual([]);
    await waitFor(() => ctx.storage.storedThanks().filter(t => t.helper === h.id).every(t => t.told), 'every thanks to be stored as told');
  });

  it('thanks the painter of an arrow from where it points, and the same helper again only the next UTC day', async () => {
    now += OUT;
    // A good neighbor (rank 1): the arrow lasts two days, past the next UTC day whenever this runs.
    const h = await enter({ map: 'town', x: 2, y: 4, dir: 'right', bag: [{ item: 'cap', count: 1 }], stats: { thanked: 25 } });
    await h.c.settle();
    h.c.send({ t: 'use', slot: 0 });
    const { mark } = await h.c.next('mark');
    expect((await h.c.next('did')).did).toEqual({ kind: 'used', item: 'cap', mark: { dir: 'right', left: 2 * MARK_LIFETIME_MS / 1000 } });
    const far = await enter({ map: 'town', x: 7, y: 6 });
    far.c.send({ t: 'thank', who: h.id, what: { kind: 'mark', id: mark.id } });
    expect(await far.c.next('refused')).toEqual({ t: 'refused', action: 'thank', reason: 'too_far' });
    const g = await enter({ map: 'town', x: 3, y: 4 });
    g.c.send({ t: 'thank', who: g.id, what: { kind: 'mark', id: mark.id } });
    expect(await g.c.next('refused')).toEqual({ t: 'refused', action: 'thank', reason: 'gone' });
    g.c.send({ t: 'thank', who: h.id, what: { kind: 'mark', id: mark.id } });
    await g.c.next('did');
    expect(await h.c.next('thanked')).toEqual({ t: 'thanked', name: g.welcome.name, what: { kind: 'mark', map: 'town', x: 2, y: 4 }, line: true });
    g.c.send({ t: 'thank', who: h.id, what: { kind: 'mark', id: mark.id } });
    expect(await g.c.next('refused')).toEqual({ t: 'refused', action: 'thank', reason: 'thanked' });
    // g came in at this game time: the server's wall clock is where its welcome said.
    now += nextDay(g.welcome.clock);
    g.c.send({ t: 'thank', who: h.id, what: { kind: 'mark', id: mark.id } });
    expect(await g.c.next('did')).toMatchObject({ did: { kind: 'thanked', who: h.id } });
    expect(world().get(h.id)!.stats).toEqual({ thanked: 27 });
  });

  it('counts toward Good neighbor: a rank at 25 thanks, told once, and arrows that last two days', async () => {
    now += OUT;
    const h = await feeder({ x: 6, y: 6, stats: { thanked: 24 }, bag: [{ item: 'resin', count: 1 }, { item: 'cap', count: 1 }] });
    const g = await enter({ map: 'woods', x: 4, y: 6 });
    g.c.send({ t: 'thank', who: h.id, what: FIRE });
    expect(await h.c.next('feat')).toEqual({ t: 'feat', id: 'good-neighbor', rank: 1, stats: { fed: 1, thanked: 25 } });
    await waitFor(() => ctx.storage.get(h.id)!.stats?.thanked === 25, 'the thanks to be counted');
    // A save of the player (as when they leave) never undoes it.
    h.c.ws.terminate();
    await waitFor(() => !world().has(h.id), 'the helper to leave');
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(ctx.storage.get(h.id)!.stats).toEqual({ fed: 1, thanked: 25 });
    const back = await login(h.token);
    expect(back.welcome.stats).toEqual({ fed: 1, thanked: 25 });
    back.c.send({ t: 'use', slot: 0 });
    expect((await back.c.next('did')).did).toMatchObject({ mark: { left: 2 * MARK_LIFETIME_MS / 1000 } });
  });

  it('forgets who thanked whom after 7 days: the letter never brings one that old', async () => {
    now += OUT;
    const h = await feeder();
    h.c.ws.terminate();
    await waitFor(() => !world().has(h.id), 'the helper to leave');
    const g = await enter({ map: 'woods', x: 4, y: 6 });
    g.c.send({ t: 'thank', who: h.id, what: FIRE });
    await g.c.next('did');
    g.c.ws.terminate();
    await waitFor(() => world().size === 0, 'everyone to leave');
    now += THANKS_KEPT_MS + 60_000;
    // A week on (offline, their energy waited for them), they walk home.
    const back = await login(h.token);
    await walk(back.c, HOME);
    expect(world().get(h.id)!.map).toBe('house');
    expect(of(await back.c.settle(), 'letter')).toEqual([]);
  });
});

describe('thanks kept for 7 days', () => {
  it('are forgotten by storage at start-up and every so often after', async () => {
    setLogLevel('silent');
    const storage = new MemoryStorage();
    const h = await savedPlayer(storage, { map: 'house', x: 2, y: 3 }), g = await savedPlayer(storage);
    const wall = Date.now();
    const thanks = (ago: number) => ({ giver: g.id, helper: h.id, day: utcDay(wall - ago), at: wall - ago, what: theFire, told: false, name: '' });
    await storage.saveThanks(thanks(8 * DAY));
    await storage.saveThanks(thanks(DAY));
    const server = await startServer({ ...serverDefaults(), maps: maps(), items: items(), storage, weather: 'overcast', forgetThanksEveryMs: 20 });
    try {
      expect(storage.storedThanks().map(t => t.at)).toEqual([wall - DAY]);
      // The one still kept comes in the letter: they are back in the game at home.
      const back = await loginTo(server.port, h.token);
      expect(await back.c.next('letter')).toEqual({ t: 'letter', thanks: [{ what: theFire, count: 1, people: 1, names: [g.name] }] });
      back.c.ws.terminate();
      // One older than 7 days goes within the hour (here, within moments).
      await storage.saveThanks(thanks(THANKS_KEPT_MS + 1000));
      await waitFor(() => storage.storedThanks().length === 1, 'the old thanks to be forgotten');
    } finally {
      await server.stop();
    }
  });
});

describe('the thanks received, stored', () => {
  it('stay apart from every save, in memory as in the database: a whole player round trips, and a save from an older copy undoes no thanks', async () => {
    const { kept } = await keepsWholeRow(new MemoryStorage());
    expect(kept.stats?.thanked).toBe(8);
  });
});

describe('thanks with sign-in', () => {
  let now = 5_000_000;
  const { ctx, enter, open, welcomed } = setup({ maps: maps(), items: items(), weather: 'overcast', clock: () => now, rng: () => 0, auth: devAuth() });

  it('carry no words, so guests give them and get them', async () => {
    const h = await enter({ map: 'woods', x: 5, y: 6, bag: [{ item: 'resin', count: 1 }] });
    const g = await enter({ map: 'woods', x: 4, y: 6 });
    expect([h.welcome.guest, g.welcome.guest]).toEqual([true, true]);
    h.c.send({ t: 'feed', x: 5, y: 5, slot: 0 });
    await h.c.next('did');
    g.c.send({ t: 'thank', who: h.id, what: FIRE });
    expect(await g.c.next('did')).toMatchObject({ did: { kind: 'thanked', who: h.id } });
    expect(await h.c.next('thanked')).toMatchObject({ name: g.welcome.name });
  });

  it('never reach someone who blocks the giver, and the giver is not told', async () => {
    now += OUT;
    await savedPlayer(ctx.storage, { map: 'woods', x: 5, y: 6, bag: [{ item: 'resin', count: 1 }], tokenHash: null, authSub: 'dev:helper@example.test' });
    const c = await open();
    const h = await welcomed(c, { t: 'hello', v: PROTOCOL_VERSION, auth: 'helper@example.test' });
    c.send({ t: 'feed', x: 5, y: 5, slot: 0 });
    await c.next('did');
    const g = await enter({ map: 'woods', x: 4, y: 6 });
    c.send({ t: 'block', id: g.id, on: true });
    await c.next('friends', m => m.blocked.some(p => p.id === g.id));
    g.c.send({ t: 'thank', who: h.you, what: FIRE });
    expect(await g.c.next('did')).toMatchObject({ did: { kind: 'thanked', who: h.you } });
    expect(of(await c.settle(), 'thanked')).toEqual([]);
    expect(ctx.storage.storedThanks().filter(t => t.helper === h.you)).toEqual([]);

    // Away, they are thanked by both; back in the game at home, the letter leaves out whom they block.
    c.ws.terminate();
    await waitFor(() => !ctx.server.world.has(h.you), 'the helper to leave');
    g.c.send({ t: 'thank', who: h.you, what: FIRE });
    await g.c.next('did');
    const other = await enter({ map: 'woods', x: 4, y: 5 });
    other.c.send({ t: 'thank', who: h.you, what: FIRE });
    await other.c.next('did');
    await waitFor(() => ctx.storage.storedThanks().filter(t => t.helper === h.you).length === 2, 'both thanks to be stored');
    await ctx.storage.save({ ...ctx.storage.get(h.you)!, map: 'house', x: 2, y: 3 });
    const home = await open();
    await welcomed(home, { t: 'hello', v: PROTOCOL_VERSION, auth: 'helper@example.test' });
    expect(await home.next('letter')).toEqual({ t: 'letter', thanks: [{ what: theFire, count: 1, people: 1, names: [other.welcome.name] }] });
  });
});

function of<T extends ServerMsg['t']>(msgs: ServerMsg[], t: T): Array<Extract<ServerMsg, { t: T }>> {
  return msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
}
