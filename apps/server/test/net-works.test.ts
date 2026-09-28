/**
 * Mending the woods together over real WebSockets (roadmap/trail-works.md): giving what a place takes,
 * its standing again, its wear at each midnight and its breaking, a footbridge walked and a street light
 * lit only while it stands, the plaque, the notice board, and the state kept in world_state through a
 * restart. Each test runs a server of its own whose world clock reads what the test wants as it starts,
 * and moves only when the test moves it.
 *
 *   woods (12x10, depth 1)
 *     0123456789AB
 *   0 tttttttttttt
 *   1 tggggwgggggt   w: a creek down column 5
 *   2 tggggBgggLgt   B: its footbridge (5,2), creek-bridge; L: the street light (9,2), creek-light
 *   3 tggggwgggggt
 *     ...
 *   7 tggggwgggggt
 *   8 tggggggggggt   the ford: the long way round; the road from town arrives at 3,8 and 4,8
 *   9 tttmmttttttt   the way home, 3,9 and 4,9
 *
 * The west bank at the bridge (4,2) is 7 steps from home, the east bank (6,2) 9. The town is the fixture
 * town with a notice board at 0,4 (read from 0,5), where energy never runs down.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, SEASONS, STEP_MS, SURGE_DRAIN, TileMap, energyRate, seasonAt, type ItemsData, type MapData } from '@napoland/shared';
import { setLogLevel } from '../src/log';
import { startServer, type RunningServer, type ServerOptions } from '../src/server';
import { MemoryStorage, type PlayerRecord } from '../src/storage';
import { houseData, itemsData, townData } from './fixtures';
import { Client, boardText, savedPlayer, serverDefaults, waitFor } from './helpers';

const W = 12, H = 10;
/** Midnight UTC, when a place pays its day's wear, and the start of a surge's round here (its rounds divide a day). */
const MIDNIGHT = Date.UTC(2026, 0, 5);
const DAY = 86_400_000;
const START = 1_000_000;
const WEST = { x: 4, y: 2 }, BY_LIGHT = { x: 8, y: 2 };
/** The cold of the season at `at` (sky.ts, SEASONS): part of every drain the server works out, as in winter here. */
const chillAt = (at: number) => ({ weather: SEASONS[seasonAt(at)].chill, wet: SEASONS[seasonAt(at)].wet });

function woods(more: Partial<MapData> = {}): MapData {
  return {
    id: 'woods', name: 'The Woods', version: 1, kind: 'wilds', depth: 1, width: W, height: H,
    tiles: ['t'.repeat(W), ...Array<string>(7).fill('tggggwgggggt'), `t${'g'.repeat(W - 2)}t`, `tttmm${'t'.repeat(W - 5)}`],
    levels: Array<string>(H).fill('0'.repeat(W)),
    spawn: { x: 3, y: H - 2, dir: 'up' },
    exits: [{ x: 3, y: H - 1, w: 2, h: 1, to: 'town', tx: 4, ty: 1, dir: 'down', home: true }],
    objects: [{ kind: 'footbridge', id: 'creek-bridge', x: 5, y: 2, w: 1, h: 1 }, { kind: 'lamp', x: 9, y: 2, works: 'creek-light' }],
    ...more,
  };
}
function town(): MapData {
  const t = townData();
  return { ...t, exits: t.exits.map(e => (e.to === 'woods' ? { ...e, ty: H - 2 } : e)), objects: [...t.objects, { kind: 'board', x: 0, y: 4 }] };
}
const items = (): ItemsData => ({
  ...itemsData(),
  items: [
    ...itemsData().items,
    { id: 'scrap', name: 'Scrap metal', noun: 'scrap', plural: 'scrap', kind: 'resource', stack: 10, text: 'Rust.' },
    { id: 'wire', name: 'Copper wire', noun: 'wire', plural: 'wire', kind: 'resource', stack: 10, text: 'Copper.' },
  ],
  works: [
    { id: 'creek-bridge', build: 'footbridge', name: 'the footbridge', where: 'over the creek, in the Woods', item: 'scrap', need: 30, wear: 5, hold: 35 },
    { id: 'creek-light', build: 'light', name: 'the street light', where: 'by the creek, in the Woods', item: 'wire', need: 12, wear: 2, hold: 14 },
  ],
});
const scrap = (...counts: number[]) => counts.map(count => ({ item: 'scrap', count }));
const r3 = (v: number) => Math.round(v * 1000) / 1000;

let running: Array<{ server: RunningServer; clients: Client[] }> = [];
afterEach(async () => {
  for (const { server, clients } of running) {
    for (const c of clients) c.ws.terminate();
    await server.stop();
  }
  running = [];
});

/** Long enough for a few of the server's ticks (every 20 ms) to see where the game clock is now. */
const ticks = () => new Promise(resolve => setTimeout(resolve, 80));

/** A server whose world clock reads `at` (ms since the epoch) as it starts, on `storage` (a new one unless given); `map` changes the woods. */
async function serverAt(at: number, storage = new MemoryStorage(), more: Partial<ServerOptions> = {}, map: Partial<MapData> = {}) {
  setLogLevel('silent');
  let now = START;
  const data = woods(map);
  const server = await startServer({
    ...serverDefaults(), storage, maps: [new TileMap(town()), new TileMap(houseData()), new TileMap(data)], items: items(), weather: 'overcast',
    clock: () => now, clockShiftMs: at - Date.now(), ...more,
  });
  const clients: Client[] = [];
  running.push({ server, clients });
  const wall = () => at + (now - START);
  return {
    server, storage, map: new TileMap(data), wall,
    /** A player saved in the woods (unless `where` says otherwise), facing right, logged in; what follows the welcome is taken. */
    enter: async (where: Partial<PlayerRecord>) => {
      const { token, id, name } = await savedPlayer(storage, { map: 'woods', dir: 'right', ...where });
      const c = await Client.open(server.port);
      clients.push(c);
      c.send({ t: 'hello', v: PROTOCOL_VERSION, token });
      const welcome = await c.next('welcome');
      await c.settle();
      return { c, id, name, welcome };
    },
    later: async (ms: number) => {
      now += ms;
      await ticks();
    },
    until: async (t: number) => {
      now += Math.max(0, t - wall());
      await ticks();
    },
    stop: async () => {
      for (const c of clients.splice(0)) c.ws.terminate();
      await server.stop();
      running = running.filter(r => r.server !== server);
    },
  };
}

/** Reads the notice board in town (a player at 0,5): its lines about the places mended together. */
async function board(c: Client): Promise<string[]> {
  c.send({ t: 'board', x: 0, y: 4 });
  return boardText(await c.next('board'), items()).filter(l => l.includes('the Woods'));
}

describe('mending the woods together, over the network', () => {
  it('takes what a place takes from beside it, as much as asked and it has room for, and everyone anywhere hears how it stands', async () => {
    const w = await serverAt(MIDNIGHT + 3_600_000);
    const a = await w.enter({ ...WEST, bag: [{ item: 'moss', count: 2 }, ...scrap(10, 10)] });
    const t = await w.enter({ map: 'town', x: 0, y: 5 });
    expect(a.welcome.works).toEqual([{ id: 'creek-bridge', standing: false, held: 0 }, { id: 'creek-light', standing: false, held: 0 }]);
    expect(t.welcome.works).toEqual(a.welcome.works);
    expect(await board(t.c)).toEqual([
      'The footbridge over the creek, in the Woods: broken. It stands again with 30 scrap. Nobody has given anything yet.',
      'The street light by the creek, in the Woods: dark. It lights up again with 12 wire. Nobody has given anything yet.',
    ]);

    // Moss is not what it takes; an empty slot gives nothing; from town, or two tiles off, nothing reaches it.
    a.c.send({ t: 'bring', x: 5, y: 2, slot: 0 });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'bring', reason: 'not_wanted' });
    a.c.send({ t: 'bring', x: 5, y: 2, slot: 5 });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'bring', reason: 'empty_slot' });
    a.c.send({ t: 'bring', x: 9, y: 2, slot: 1 });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'bring', reason: 'too_far' });
    t.c.send({ t: 'bring', x: 5, y: 2, slot: 0 });
    expect(await t.c.next('refused')).toEqual({ t: 'refused', action: 'bring', reason: 'too_far' });

    // Twelve, from the slot asked for first and then from the other: the giver hears how it stands, everyone else too.
    a.c.send({ t: 'bring', x: 5, y: 2, slot: 1, count: 12 });
    const view = { id: 'creek-bridge', standing: false, held: 12, top: a.name };
    expect(await a.c.next('did')).toEqual({ t: 'did', did: { kind: 'brought', works: 'creek-bridge', item: 'scrap', count: 12, view } });
    expect(await a.c.next('bag')).toEqual({ t: 'bag', bag: [{ item: 'moss', count: 2 }, { item: 'scrap', count: 8 }] });
    expect(await t.c.next('works')).toEqual({ t: 'works', works: view });
    expect(await board(t.c)).toContain(`The footbridge over the creek, in the Woods: broken. 12 of 30 scrap given, 18 more and it stands again. ${a.name} gave the most.`);
    // Kept in world_state as it is now, and the giver with what went into it.
    await waitFor(() => w.storage.get(a.id)!.bag.length === 2, 'the giver to be saved');
    expect(await w.storage.loadWorks()).toEqual({ 'creek-bridge': { standing: false, held: 12, day: 0, givers: [{ id: a.id, name: a.name, count: 12 }] }, 'creek-light': { standing: false, held: 0, day: 0, givers: [] } });
  });

  it('stands again at what it takes: its footbridge is walked by everyone from then on, and it keeps a week\'s wear put by at most', async () => {
    const w = await serverAt(MIDNIGHT + 3_600_000);
    const a = await w.enter({ ...WEST, bag: scrap(10, 10, 10, 10, 10, 10, 10) });
    const b = await w.enter({ x: 6, y: 3, dir: 'up' });
    // Broken, the creek is water: no way across.
    a.c.send({ t: 'step', dir: 'right', seq: 1 });
    expect(await a.c.next('reject')).toEqual({ t: 'reject', seq: 1, x: 4, y: 2, dir: 'right' });
    a.c.send({ t: 'bring', x: 5, y: 2, slot: 0, count: 30 });
    const built = { id: 'creek-bridge', standing: true, held: 0, top: a.name };
    expect(await a.c.next('did')).toEqual({ t: 'did', did: { kind: 'brought', works: 'creek-bridge', item: 'scrap', count: 30, view: built, built: true } });
    expect(await b.c.next('works')).toEqual({ t: 'works', works: built });
    // Over it, and off the other side; and back.
    await w.later(STEP_MS);
    a.c.send({ t: 'step', dir: 'right', seq: 2 });
    expect(await a.c.next('step', m => m.seq === 2)).toMatchObject({ x: 5, y: 2 });
    await w.later(STEP_MS);
    a.c.send({ t: 'step', dir: 'right', seq: 3 });
    expect(await a.c.next('step', m => m.seq === 3)).toMatchObject({ x: 6, y: 2 });
    b.c.send({ t: 'step', dir: 'up', seq: 1 });
    expect(await b.c.next('step', m => m.seq === 1)).toMatchObject({ x: 6, y: 2 });

    // Standing, it takes up to a week's wear put by (35), from anyone beside it: then no more.
    a.c.send({ t: 'bring', x: 5, y: 2, slot: 0, count: 30 });
    expect(await a.c.next('did')).toMatchObject({ did: { kind: 'brought', count: 30, view: { standing: true, held: 30 } } });
    await w.later(STEP_MS);
    a.c.send({ t: 'step', dir: 'left', seq: 4 });
    await a.c.next('step', m => m.seq === 4);
    a.c.send({ t: 'bring', x: 6, y: 2, slot: 0, count: 30 });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'bring', reason: 'too_far' });
    // From on it, too: 5 more, and it has all it keeps.
    a.c.send({ t: 'bring', x: 5, y: 2, slot: 0, count: 30 });
    expect(await a.c.next('did')).toMatchObject({ did: { kind: 'brought', count: 5, view: { standing: true, held: 35 } } });
    a.c.send({ t: 'bring', x: 5, y: 2, slot: 0 });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'bring', reason: 'works_full' });
  });

  it('pays its wear at each midnight from what was put by, and breaks when that runs short: its footbridge is water again, for everyone', async () => {
    const w = await serverAt(MIDNIGHT - 60_000);
    const a = await w.enter({ ...WEST, bag: scrap(10, 10, 10, 10) });
    const t = await w.enter({ map: 'town', x: 0, y: 5 });
    // At most 30 at a time (FEED_MAX): 30, and it stands; 10 more, put by.
    a.c.send({ t: 'bring', x: 5, y: 2, slot: 0, count: 30 });
    expect(await a.c.next('did')).toMatchObject({ did: { count: 30, built: true, view: { standing: true, held: 0 } } });
    a.c.send({ t: 'bring', x: 5, y: 2, slot: 0, count: 10 });
    expect(await a.c.next('did')).toMatchObject({ did: { count: 10, view: { standing: true, held: 10 } } });
    expect(await board(t.c)).toContain(`The footbridge over the creek, in the Woods: standing. 10 scrap put by, enough for 2 more days (it takes 5 a day). ${a.name} gave the most.`);
    a.c.ws.terminate();
    await waitFor(() => !w.server.world.has(a.id), 'the giver to leave');
    await t.c.settle();

    // Midnight: 5 of it goes; the next, the other 5; the one after finds nothing put by, and it breaks.
    await w.later(61_000);
    expect(await t.c.next('works')).toEqual({ t: 'works', works: { id: 'creek-bridge', standing: true, held: 5, top: a.name } });
    await w.later(DAY);
    expect(await t.c.next('works')).toEqual({ t: 'works', works: { id: 'creek-bridge', standing: true, held: 0, top: a.name } });
    expect(await board(t.c)).toContain(`The footbridge over the creek, in the Woods: standing, but not past today. It takes 5 scrap a day, and none is put by. ${a.name} gave the most.`);
    await w.later(DAY);
    expect(await t.c.next('works')).toEqual({ t: 'works', works: { id: 'creek-bridge', standing: false, held: 0, top: a.name } });
    // Broken, the creek is water again; a broken place does not wear.
    const b = await w.enter({ ...WEST });
    b.c.send({ t: 'step', dir: 'right', seq: 1 });
    expect(await b.c.next('reject')).toEqual({ t: 'reject', seq: 1, x: 4, y: 2, dir: 'right' });
    b.c.ws.terminate();
    await w.later(DAY);
    expect((await t.c.settle()).filter(m => m.t === 'works')).toEqual([]);
    expect((await w.storage.loadWorks())['creek-bridge']).toMatchObject({ standing: false, held: 0, givers: [{ id: a.id, count: 40 }] });
  });

  it('names on its plaque whoever gave the most, all told: level, the one who got there first keeps it', async () => {
    const w = await serverAt(MIDNIGHT + 3_600_000);
    const a = await w.enter({ ...WEST, bag: scrap(10) });
    const c = await w.enter({ x: 6, y: 2, dir: 'left', bag: scrap(10) });
    const give = async (who: typeof a, n: number) => {
      who.c.send({ t: 'bring', x: 5, y: 2, slot: 0, count: n });
      return (await who.c.next('did')).did;
    };
    expect(await give(a, 3)).toMatchObject({ view: { held: 3, top: a.name } });
    // From either bank.
    expect(await give(c, 5)).toMatchObject({ view: { held: 8, top: c.name } });
    expect(await give(a, 2)).toMatchObject({ view: { held: 10, top: c.name } });
    expect(await give(a, 1)).toMatchObject({ view: { held: 11, top: a.name } });
    expect((await w.storage.loadWorks())['creek-bridge']!.givers).toEqual([{ id: a.id, name: a.name, count: 6 }, { id: c.id, name: c.name, count: 5 }]);
  });

  it('lights around its street light only while it stands: there, a surge does not reach whoever stands in it', async () => {
    // A surge from 160 s into every 200, whose front reaches the way home 5 s later.
    const w = await serverAt(MIDNIGHT + 150_000, new MemoryStorage(), {}, { surge: { every: 200, unstable: 20, surge: 40, sweep: 5 } });
    const l = await w.enter({ ...BY_LIGHT, bag: [{ item: 'wire', count: 10 }, { item: 'wire', count: 4 }] });
    const t = await w.enter({ map: 'town', x: 0, y: 5 });
    const chill = chillAt(MIDNIGHT + 170_000);
    const base = r3(energyRate(w.map, 8, 2, 'overcast', { chill })), surged = r3(energyRate(w.map, 8, 2, 'overcast', { surgeFront: 0, surgeDrain: SURGE_DRAIN, chill }));
    await w.until(MIDNIGHT + 170_000);
    // Dark, the surge has them.
    await l.c.next('energy', m => m.energy.rate === surged);
    l.c.send({ t: 'bring', x: 9, y: 2, slot: 0, count: 12 });
    expect(await l.c.next('did')).toMatchObject({ did: { kind: 'brought', works: 'creek-light', item: 'wire', count: 12, built: true, view: { standing: true, held: 0 } } });
    // Lit, it does not.
    await l.c.next('energy', m => m.energy.rate === base);
    expect(await board(t.c)).toContain(`The street light by the creek, in the Woods: lit, but not past today. It takes 2 wire a day, and none is put by. ${l.name} gave the most.`);
    await w.later(1000);
    expect((await l.c.settle()).filter(m => m.t === 'energy' && m.energy.rate !== base)).toEqual([]);
  });

  it('keeps how each place stands through a restart: whoever comes back finds its footbridge as it was, and its plaque', async () => {
    const storage = new MemoryStorage();
    const one = await serverAt(MIDNIGHT + 3_600_000, storage);
    const a = await one.enter({ ...WEST, bag: scrap(10, 10, 10, 5) });
    a.c.send({ t: 'bring', x: 5, y: 2, slot: 0, count: 30 });
    expect(await a.c.next('did')).toMatchObject({ did: { built: true, view: { standing: true, held: 0 } } });
    a.c.send({ t: 'bring', x: 5, y: 2, slot: 0, count: 5 });
    expect(await a.c.next('did')).toMatchObject({ did: { view: { standing: true, held: 5 } } });
    await one.stop();
    expect((await storage.loadWorks())['creek-bridge']).toEqual({ standing: true, held: 5, day: Math.floor((MIDNIGHT + 3_600_000) / DAY), givers: [{ id: a.id, name: a.name, count: 35 }] });

    // Later the same day: still standing, and walked.
    const two = await serverAt(MIDNIGHT + 7_200_000, storage);
    const b = await two.enter({ ...WEST });
    expect(b.welcome.works).toEqual([{ id: 'creek-bridge', standing: true, held: 5, top: a.name }, { id: 'creek-light', standing: false, held: 0 }]);
    b.c.send({ t: 'step', dir: 'right', seq: 1 });
    expect(await b.c.next('step', m => m.seq === 1)).toMatchObject({ x: 5, y: 2 });
    await two.stop();

    // Two days on, the server down all the while: both midnights count as it starts, and it broke at the second.
    const three = await serverAt(MIDNIGHT + 2 * DAY + 3_600_000, storage);
    const c = await three.enter({ ...WEST });
    await three.later(100);
    expect((await storage.loadWorks())['creek-bridge']).toMatchObject({ standing: false, held: 0 });
    c.c.send({ t: 'step', dir: 'right', seq: 1 });
    expect(await c.c.next('reject')).toEqual({ t: 'reject', seq: 1, x: 4, y: 2, dir: 'right' });
  });
});
