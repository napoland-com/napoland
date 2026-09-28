/**
 * A first goal on the first day, over real WebSockets: the counts kept for it (gear made, collapses,
 * surges that caught someone out in the wilds), what people say once about them (kept when the server
 * hears the talk), and the stash in the welcome, from which the bag says what gear comes next.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, TileMap, type ItemsData, type MapData, type StoryData } from '@napoland/shared';
import { devAuth } from '../src/auth';
import { setLogLevel } from '../src/log';
import { startServer, type RunningServer, type ServerOptions } from '../src/server';
import { MemoryStorage, type PlayerRecord } from '../src/storage';
import { houseData, itemsData, townData, woodsData } from './fixtures';
import { Client, nobodyCame, savedPlayer, serverDefaults } from './helpers';

/** Mira at 2,5 in town (talk to her from 2,6); a workbench at 1,1 in the house (from 1,2); the woods surge every ten minutes. */
const SURGE = { every: 600, unstable: 60, surge: 120, sweep: 60 };
const woods = (): MapData => ({ ...woodsData(), surge: SURGE });
const maps = () => [
  new TileMap({ ...townData(), objects: [...townData().objects, { kind: 'npc', id: 'mira', name: 'Mira', x: 2, y: 5, dir: 'down', lines: ['Heading out?'] }] }),
  new TileMap({ ...houseData(), objects: [...houseData().objects, { kind: 'workbench', x: 1, y: 1 }] }),
  new TileMap(woods()),
];
const items = (): ItemsData => ({
  ...itemsData(),
  items: [
    ...itemsData().items,
    { id: 'cloth', name: 'Cloth', kind: 'resource', stack: 10, text: 'Dry.' },
    { id: 'coat', name: 'Coat', kind: 'gear', stack: 1, text: 'Warm.', slot: 'shirt', tier: 'sturdy', resist: { cold: 0.2 } },
  ],
  recipes: [{ id: 'coat', make: 'coat', count: 2, needs: [{ item: 'cloth', count: 4 }] }],
  parcels: { welcome: [{ item: 'cloth', count: 4 }], week: Array.from({ length: 7 }, () => [{ item: 'nail', count: 1 }]) },
});
const story = (): StoryData => ({
  version: 1,
  chapters: [{ id: 'home', title: 'Home', text: 'You woke up at home.' }],
  remarks: [
    { id: 'first-collapse', who: 'mira', after: 'collapsed', line: 'You went down out there.' },
    { id: 'first-surge', who: 'mira', after: 'surged', line: 'A surge caught you.' },
  ],
});

let running: Array<{ server: RunningServer; clients: Client[] }> = [];
afterEach(async () => {
  for (const { server, clients } of running) {
    for (const c of clients) c.ws.terminate();
    await server.stop();
  }
  running = [];
});

/** A server whose world clock reads `at` (ms since the epoch) now and moves only with `later`. */
async function serverAt(at = Date.now(), more: Partial<ServerOptions> = {}) {
  setLogLevel('silent');
  let now = 1_000_000;
  const storage = new MemoryStorage();
  const server = await startServer({
    ...serverDefaults(), storage, maps: maps(), items: items(), story: story(), weather: 'overcast', clock: () => now, clockShiftMs: at - Date.now(), ...more,
  });
  const clients: Client[] = [];
  running.push({ server, clients });
  /** A player saved where the test wants them, logged in with their token; what follows the welcome is taken. */
  const enter = async (where: Partial<PlayerRecord>) => {
    const { token, id } = await savedPlayer(storage, where);
    const c = await Client.open(server.port);
    clients.push(c);
    c.send({ t: 'hello', v: PROTOCOL_VERSION, token });
    const welcome = await c.next('welcome');
    await c.settle();
    return { c, id, welcome };
  };
  /** The counts as the server answers when asked: what it sent unasked before (a count that went up) is left out. */
  const stats = async (c: Client) => {
    await c.settle();
    c.send({ t: 'stats' });
    return (await c.next('stats')).stats;
  };
  return { server, storage, enter, stats, later: (ms: number) => { now += ms; }, hello: async (h: Record<string, unknown>) => {
    const c = await Client.open(server.port);
    clients.push(c);
    c.send({ t: 'hello', v: PROTOCOL_VERSION, ...h } as never);
    return { c, welcome: await c.next('welcome') };
  } };
}

describe('the counts a first day keeps', () => {
  it('counts gear made at the workbench, each piece, saved at once', async () => {
    const w = await serverAt();
    const p = await w.enter({ map: 'house', x: 1, y: 2, dir: 'up', stash: { items: { cloth: 9 }, out: {} } });
    p.c.send({ t: 'craft', x: 1, y: 1, recipe: 'coat' });
    await p.c.next('did');
    expect((await w.stats(p.c)).made).toBe(2);
    expect(w.storage.get(p.id)!.stats!.made).toBe(2);
  });

  it('counts a collapse, and the zone home says so', async () => {
    const w = await serverAt();
    const p = await w.enter({ map: 'woods', x: 3, y: 6, energy: 1 });
    // One energy lasts about four seconds where they stand; down, and nobody comes (rescue.ts).
    w.later(5000);
    await nobodyCame(p.c, w.later);
    const zone = await p.c.next('zone', m => m.reason === 'collapse');
    expect(zone.stats.collapsed).toBe(1);
    expect(w.storage.get(p.id)!.stats!.collapsed).toBe(1);
  });

  it('tells the player at once, unasked, when gear made or a collapse adds to the counts: what people say about it is due now', async () => {
    // Ten seconds into a calm stretch of the woods, so that no surge adds to the counts meanwhile.
    const w = await serverAt((Math.floor(Date.now() / 1000 / SURGE.every) * SURGE.every + 10) * 1000);
    const maker = await w.enter({ map: 'house', x: 1, y: 2, dir: 'up', stash: { items: { cloth: 9 }, out: {} } });
    maker.c.send({ t: 'craft', x: 1, y: 1, recipe: 'coat' });
    // Both pieces of one making, in one message.
    expect(await maker.c.next('stats')).toEqual({ t: 'stats', stats: { made: 2 } });
    expect((await maker.c.settle()).filter(m => m.t === 'stats')).toEqual([]);
    const faller = await w.enter({ map: 'woods', x: 3, y: 6, energy: 1, stats: { made: 1 } });
    w.later(5000);
    await nobodyCame(faller.c, w.later);
    expect(await faller.c.next('stats')).toEqual({ t: 'stats', stats: { made: 1, collapsed: 1 } });
  });

  it('counts each surge that caught someone out in the wilds once, and none that found them indoors or in town', async () => {
    // One second before a surge starts.
    const round = Math.floor(Date.now() / 1000 / SURGE.every) * SURGE.every;
    const w = await serverAt((round + SURGE.every - SURGE.surge - 1) * 1000);
    const map = new TileMap(woods());
    // By the campfire, as deep as that is: the front passes it early, and the fire keeps them going meanwhile.
    const tiles: Array<[number, number]> = [];
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.walkable(x, y) && map.warm(x, y) && !map.lit(x, y)) tiles.push([x, y]);
    const [x, y] = tiles.sort((a, b) => map.homeSteps(b[0], b[1]) - map.homeSteps(a[0], a[1]))[0]!;
    const out = await w.enter({ map: 'woods', x, y });
    const home = await w.enter({ map: 'house', x: 2, y: 3 });
    const inTown = await w.enter({ map: 'town', x: 1, y: 2 });
    w.later(1000 + SURGE.sweep * 1000);
    // Heard at once, unasked.
    expect((await out.c.next('stats')).stats.surged).toBe(1);
    expect((await w.stats(out.c)).surged).toBe(1);
    // The same surge, still on: still one.
    w.later(20_000);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect((await w.stats(out.c)).surged).toBe(1);
    // The next one.
    w.later(SURGE.every * 1000);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect((await w.stats(out.c)).surged).toBe(2);
    expect(w.storage.get(out.id)!.stats!.surged).toBe(2);
    for (const p of [home, inTown]) expect((await w.stats(p.c)).surged).toBeUndefined();
  });
});

describe('what people say once', () => {
  it('is kept told when the server hears the talk, saved at once, and only what was due', async () => {
    const w = await serverAt();
    const fell = await w.enter({ map: 'town', x: 2, y: 6, dir: 'up', stats: { collapsed: 1 } });
    fell.c.send({ t: 'talk', x: 2, y: 5 });
    await fell.c.settle();
    expect((await w.stats(fell.c)).told).toBe(0b01);
    expect(w.storage.get(fell.id)!.stats!.told).toBe(0b01);
    // Talking again changes nothing; the surge's remark waits for a surge.
    fell.c.send({ t: 'talk', x: 2, y: 5 });
    expect((await w.stats(fell.c)).told).toBe(0b01);
    // Nothing due, nothing told; and only from next to her.
    const fresh = await w.enter({ map: 'town', x: 2, y: 6, dir: 'up' });
    fresh.c.send({ t: 'talk', x: 2, y: 5 });
    expect((await w.stats(fresh.c)).told).toBeUndefined();
    const far = await w.enter({ map: 'town', x: 5, y: 6, stats: { collapsed: 2, surged: 1 } });
    far.c.send({ t: 'talk', x: 2, y: 5 });
    expect((await w.stats(far.c)).told).toBeUndefined();
  });
});

describe('the stash in the welcome', () => {
  it('says what the stash holds, with the welcome parcel that came as they arrived', async () => {
    const w = await serverAt(Date.now(), { auth: devAuth() });
    const first = await w.hello({ auth: 'new@example.test', name: 'New Here' });
    expect(first.welcome.stash).toEqual([{ item: 'cloth', count: 4 }]);
    const old = await w.enter({ map: 'house', x: 2, y: 3, stash: { items: { nail: 2, coat: 1 }, out: {} } });
    expect(old.welcome.stash).toEqual([{ item: 'nail', count: 2 }, { item: 'coat', count: 1, piece: { cond: 1 } }]);
  });
});
