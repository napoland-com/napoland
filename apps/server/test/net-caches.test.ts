/**
 * A crate for whoever comes next, over real WebSockets (caches.ts): open it next to it, leave one thing
 * and take one out each visit (never gear), six things at most, taking thanks whoever left it, what
 * comes out earns no XP at home, and what lies in it survives a restart.
 *
 * The fixture town and home (a chest in the house), and woods with a fire at 5,5 that burns down and a
 * crate by it in the open at 4,4 (stand at 4,5); the woods' top right corner (6,1) is the door of a hut
 * whose fire burns down, with a crate at 3,2 (stand at 3,3). A game clock that only moves when a test
 * moves it.
 */
import { describe, expect, it } from 'vitest';
import { CACHE_SIZE, STEP_MS, TileMap, type Dir, type ItemsData, type MapData } from '@napoland/shared';
import { setLogLevel } from '../src/log';
import { startServer } from '../src/server';
import { MemoryStorage } from '../src/storage';
import { houseData, itemsData, townData, woodsData } from './fixtures';
import { loginTo, savedPlayer, serverDefaults, setup, waitFor, type Client } from './helpers';

function hut(): MapData {
  return {
    id: 'hut', name: 'The hut', version: 1, kind: 'inside', depth: 0, width: 5, height: 5,
    tiles: ['xxxxx', 'xpppx', 'xpppx', 'xpppx', 'xxpxx'],
    levels: Array<string>(5).fill('00000'),
    spawn: { x: 2, y: 3, dir: 'up' },
    exits: [{ x: 2, y: 4, w: 1, h: 1, to: 'woods', tx: 6, ty: 2, dir: 'down' }],
    objects: [{ kind: 'fireplace', x: 2, y: 1 }, { kind: 'cache', x: 3, y: 2, name: 'the hut\'s crate' }],
  };
}
const maps = () => [
  new TileMap(townData()),
  new TileMap({ ...houseData(), objects: [...houseData().objects, { kind: 'chest', x: 1, y: 1 }] }),
  new TileMap({
    ...woodsData(),
    exits: [...woodsData().exits, { x: 6, y: 1, w: 1, h: 1, to: 'hut', tx: 2, ty: 3, dir: 'up' }],
    objects: [{ kind: 'lamp', x: 1, y: 4 }, { kind: 'fireplace', x: 5, y: 5 }, { kind: 'cache', x: 4, y: 4, name: 'the crate by the fire' }],
  }),
  new TileMap(hut()),
];
const items = (): ItemsData => ({
  ...itemsData(),
  items: [
    ...itemsData().items,
    { id: 'resin', name: 'Fir resin', noun: 'resin', plural: 'resin', kind: 'resource', stack: 20, text: 'Sticky.', fuel: 300, xp: 2 },
    { id: 'spark', name: 'Live spark', kind: 'resource', stack: 1, text: 'Burning.', live: { xp: 10, fresh: 60, fade: 1, into: 'resin' } },
    { id: 'coat', name: 'Coat', kind: 'gear', stack: 1, text: 'Warm.', slot: 'shirt', tier: 'sturdy', resist: { cold: 0.2 } },
  ],
});
const HUT = { x: 3, y: 2 }, CAMP = { x: 4, y: 4 };
/** By the hut's crate, and by the crate in the open. */
const inHut = { map: 'hut', x: 3, y: 3, dir: 'up' as Dir };
const atCamp = { map: 'woods', x: 4, y: 5, dir: 'up' as Dir };

describe('a crate for whoever comes next', () => {
  let now = 1_000_000;
  let seq = 0;
  const { ctx, enter, login } = setup({ maps: maps(), items: items(), weather: 'overcast', clock: () => now, rng: () => 0 });
  const world = () => ctx.server.world;
  async function walk(c: Client, dirs: Dir[]) {
    for (const dir of dirs) {
      const s = ++seq;
      c.send({ t: 'step', dir, seq: s });
      await c.next('step', m => m.seq === s);
      now += STEP_MS;
    }
  }
  /** Opens the crate at `at` and returns what it says (what came before is old news: a visitor hears every change). */
  async function open(c: Client, at: { x: number; y: number }) {
    await c.settle();
    c.send({ t: 'cache', ...at });
    return c.next('cache', m => m.x === at.x && m.y === at.y);
  }

  it('opens next to it: each thing says who left it and when; one left and one taken a visit, never gear, and taking thanks whoever left it', async () => {
    const b = await enter({ ...inHut, energy: 50, bag: [{ item: 'resin', count: 3 }] });
    expect(await open(b.c, HUT)).toEqual({ t: 'cache', ...HUT, items: [], left: false, took: false });
    b.c.send({ t: 'cacheLeave', ...HUT, slot: 0 });
    expect(await b.c.next('did')).toEqual({ t: 'did', did: { kind: 'left', item: 'resin' } });
    expect(world().get(b.id)!.bag).toEqual([{ item: 'resin', count: 2 }]);
    now += 120_000;
    const a = await enter({ ...inHut, bag: [{ item: 'coat', count: 1 }, { item: 'resin', count: 1 }] });
    const seen = await open(a.c, HUT);
    expect(seen).toMatchObject({ left: false, took: false, items: [{ item: 'resin', owner: b.id, name: b.welcome.name, age: 120 }] });
    // Gear stays out; from afar, nothing.
    a.c.send({ t: 'cacheLeave', ...HUT, slot: 0 });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'cacheLeave', reason: 'no_gear' });
    const far = await enter({ map: 'hut', x: 1, y: 3 });
    far.c.send({ t: 'cacheTake', ...HUT, id: seen.items[0]!.id });
    expect(await far.c.next('refused')).toEqual({ t: 'refused', action: 'cacheTake', reason: 'too_far' });

    a.c.send({ t: 'cacheTake', ...HUT, id: seen.items[0]!.id });
    expect(await a.c.next('did')).toEqual({ t: 'did', did: { kind: 'took', item: 'resin', name: b.welcome.name, thanked: true } });
    // The coat carried is a piece of gear, with its piece (gear on the road): it stays in the bag as it was.
    expect(world().get(a.id)!.bag).toEqual([{ item: 'coat', count: 1, piece: { cond: 1 } }, { item: 'resin', count: 2 }]);
    // Whoever left it is thanked, for what they left where; out in a shelter off the woods, it warms them.
    expect(await b.c.next('thanked')).toEqual({ t: 'thanked', name: a.welcome.name, what: { kind: 'cache', map: 'hut', ...HUT, item: 'resin' }, energy: 3 });
    // Everyone visiting sees it go.
    expect((await b.c.next('cache', m => m.items.length === 0))).toMatchObject({ left: true, took: false });
    a.c.send({ t: 'cacheTake', ...HUT, id: seen.items[0]!.id });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'cacheTake', reason: 'took_one' });
    a.c.send({ t: 'cacheLeave', ...HUT, slot: 1 });
    expect(await a.c.next('did')).toEqual({ t: 'did', did: { kind: 'left', item: 'resin' } });
    a.c.send({ t: 'cacheLeave', ...HUT, slot: 1 });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'cacheLeave', reason: 'left_one' });

    // Out of the room and back in: a new visit. What you left yourself you may take back, and nobody is thanked.
    await walk(a.c, ['left', 'down', 'up']);
    expect(world().get(a.id)).toMatchObject({ map: 'hut', x: 2, y: 3 });
    await walk(a.c, ['right']);
    const again = await open(a.c, HUT);
    expect(again).toMatchObject({ left: false, took: false, items: [{ owner: a.id }] });
    a.c.send({ t: 'cacheTake', ...HUT, id: again.items[0]!.id });
    expect(await a.c.next('did')).toEqual({ t: 'did', did: { kind: 'took', item: 'resin', name: a.welcome.name, mine: true } });
  });

  it('holds six things at most, the newest first, and says so when full', async () => {
    const leavers = [];
    for (let i = 0; i <= CACHE_SIZE; i++) leavers.push(await enter({ ...atCamp, bag: [{ item: 'moss', count: 1 }] }));
    for (const p of leavers.slice(0, CACHE_SIZE)) {
      p.c.send({ t: 'cacheLeave', ...CAMP, slot: 0 });
      await p.c.next('did');
      now += 1000;
    }
    const last = leavers.at(-1)!;
    last.c.send({ t: 'cacheLeave', ...CAMP, slot: 0 });
    expect(await last.c.next('refused')).toEqual({ t: 'refused', action: 'cacheLeave', reason: 'crate_full' });
    const full = await open(last.c, CAMP);
    expect(full.items.map(e => e.owner)).toEqual(leavers.slice(0, CACHE_SIZE).map(p => p.id).reverse());
    expect(full.items.map(e => e.age)).toEqual([1, 2, 3, 4, 5, 6]);
    // Take one out (each leaver thanked by a different taker), and there is room again.
    last.c.send({ t: 'cacheTake', ...CAMP, id: full.items[0]!.id });
    await last.c.next('did');
    const other = await enter({ ...atCamp, bag: [{ item: 'moss', count: 1 }] });
    other.c.send({ t: 'cacheLeave', ...CAMP, slot: 0 });
    expect(await other.c.next('did')).toMatchObject({ did: { kind: 'left' } });
    // Empty the crate for the tests that follow.
    for (const p of leavers.slice(0, CACHE_SIZE)) {
      const { items: left } = await open(p.c, CAMP);
      if (!left.length) break;
      p.c.send({ t: 'cacheTake', ...CAMP, id: left[0]!.id });
      await p.c.next('did');
    }
  });

  it('ends a visit in the open when you walk away from the crate, and a live find left in it goes dim', async () => {
    const a = await enter({ ...atCamp, bag: [{ item: 'spark', count: 1, since: Date.now() }, { item: 'moss', count: 2 }] });
    a.c.send({ t: 'cacheLeave', ...CAMP, slot: 0 });
    expect(await a.c.next('did')).toEqual({ t: 'did', did: { kind: 'left', item: 'resin' } });
    a.c.send({ t: 'cacheLeave', ...CAMP, slot: 0 });
    expect(await a.c.next('refused')).toMatchObject({ reason: 'left_one' });
    // Home is two steps down: leaving the woods ends the visit, and coming back starts a new one.
    await walk(a.c, ['down', 'down']);
    expect(world().get(a.id)!.map).toBe('town');
    await walk(a.c, ['up']);
    expect(world().get(a.id)).toMatchObject({ map: 'woods', x: 4, y: 6 });
    await walk(a.c, ['up']);
    a.c.send({ t: 'cacheLeave', ...CAMP, slot: 0 });
    expect(await a.c.next('did')).toEqual({ t: 'did', did: { kind: 'left', item: 'moss' } });
  });

  it('counts what comes out as taken out of your stash: it earns no XP at home', async () => {
    const b = await enter({ ...atCamp, bag: [{ item: 'resin', count: 1 }] });
    b.c.send({ t: 'cacheLeave', ...CAMP, slot: 0 });
    await b.c.next('did');
    const a = await enter({ ...atCamp, bag: [{ item: 'resin', count: 1 }] });
    const { items: inside } = await open(a.c, CAMP);
    a.c.send({ t: 'cacheTake', ...CAMP, id: inside.find(e => e.owner === b.id)!.id });
    await a.c.next('did');
    expect(world().get(a.id)!.stash).toEqual({ items: {}, out: { resin: 1 } });
    // Home: out of the woods, through town into the house, and up to the chest.
    await walk(a.c, ['down', 'down', 'down', 'down', 'right', 'right', 'up', 'up', 'left']);
    expect(world().get(a.id)).toMatchObject({ map: 'house', x: 1, y: 2 });
    a.c.send({ t: 'store', x: 1, y: 1 });
    // Two resin: the one found out there earns its 2 XP, the one out of the crate nothing.
    expect(await a.c.next('progress')).toMatchObject({ gained: 2 });
    expect(world().get(a.id)!.stash).toEqual({ items: { resin: 2 }, out: {} });
  });

  it('doubles, while rested, only what was found: what came out of a crate earns nothing, so the cup pays nothing for it', async () => {
    const b = await enter({ ...atCamp, bag: [{ item: 'resin', count: 1 }] });
    b.c.send({ t: 'cacheLeave', ...CAMP, slot: 0 });
    await b.c.next('did');
    const a = await enter({ ...atCamp, rested: 50, bag: [{ item: 'resin', count: 1 }] });
    const { items: inside } = await open(a.c, CAMP);
    a.c.send({ t: 'cacheTake', ...CAMP, id: inside.find(e => e.owner === b.id)!.id });
    await a.c.next('did');
    await walk(a.c, ['down', 'down', 'down', 'down', 'right', 'right', 'up', 'up', 'left']);
    a.c.send({ t: 'store', x: 1, y: 1 });
    expect(await a.c.next('progress')).toMatchObject({ gained: 4, fromRest: 2, progress: { rested: 48 } });
  });

  it('thanks someone who is away in their letter, for what they left where', async () => {
    const b = await enter({ ...atCamp, bag: [{ item: 'resin', count: 1 }] });
    b.c.send({ t: 'cacheLeave', ...CAMP, slot: 0 });
    await b.c.next('did');
    b.c.ws.terminate();
    await waitFor(() => !world().has(b.id), 'the leaver to leave');
    const a = await enter(atCamp);
    const { items: inside } = await open(a.c, CAMP);
    a.c.send({ t: 'cacheTake', ...CAMP, id: inside.find(e => e.owner === b.id)!.id });
    await a.c.next('did');
    await waitFor(() => ctx.storage.storedThanks().some(t => t.helper === b.id), 'the thanks to be kept');
    // Back in the game at home: the letter says what for, and where.
    await ctx.storage.save({ ...ctx.storage.get(b.id)!, map: 'house', x: 2, y: 3 });
    const home = await login(b.token);
    expect(await home.c.next('letter')).toEqual({ t: 'letter', thanks: [{ what: { kind: 'cache', map: 'woods', ...CAMP, item: 'resin' }, count: 1, people: 1, names: [a.welcome.name] }] });
  });
});

describe('what lies in the crates', () => {
  it('survives a restart, with who left it and when', async () => {
    setLogLevel('silent');
    let now = 5_000_000;
    const storage = new MemoryStorage();
    const options = { ...serverDefaults(), storage, maps: maps(), items: items(), weather: 'overcast' as const, clock: () => now };
    const a = await savedPlayer(storage, { ...inHut, bag: [{ item: 'resin', count: 1 }] });
    const b = await savedPlayer(storage, inHut);
    const one = await startServer(options);
    try {
      const c = await loginTo(one.port, a.token);
      c.c.send({ t: 'cacheLeave', ...HUT, slot: 0 });
      await c.c.next('did');
      c.c.ws.terminate();
    } finally {
      await one.stop();
    }
    expect((await storage.loadCacheItems()).map(e => ({ item: e.item, owner: e.owner, name: e.name }))).toEqual([{ item: 'resin', owner: a.id, name: a.name }]);
    now += 60_000;
    const two = await startServer(options);
    try {
      const c = await loginTo(two.port, b.token);
      c.c.send({ t: 'cache', ...HUT });
      const seen = await c.c.next('cache');
      expect(seen.items).toEqual([{ id: expect.any(Number), item: 'resin', owner: a.id, name: a.name, age: expect.any(Number) }]);
      c.c.send({ t: 'cacheTake', ...HUT, id: seen.items[0]!.id });
      expect(await c.c.next('did')).toMatchObject({ did: { kind: 'took', item: 'resin', name: a.name, thanked: true } });
      c.c.ws.terminate();
    } finally {
      await two.stop();
    }
    expect(await storage.loadCacheItems()).toEqual([]);
  });
});
