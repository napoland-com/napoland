/**
 * Finds, the bag and piles over real WebSockets: the fixture maps and items (see fixtures.ts) on a
 * server with in-memory storage, and a game clock that only moves when a test moves it.
 */
import { describe, expect, it } from 'vitest';
import { BAG_SLOTS, DROP_LIFETIME_MS, ENERGY_MAX, STEP_MS, type BagSlot, type Dir, type EnergyView } from '@napoland/shared';
import { MemoryStorage } from '../src/storage';
import { MOSS_TILES, itemsData } from './fixtures';
import { restartKeepsBagsAndPiles, setup, waitFor, type Client } from './helpers';

/** The energy a player is told: value to 1 decimal, rate to 3. */
const told = (value: number, rate: number): EnergyView => ({ value: Math.round(value * 10) / 10, max: ENERGY_MAX, rate: Math.round(rate * 1000) / 1000 });
const units = (slots: BagSlot[]) => slots.reduce((n, s) => n + s.count, 0);
const fullOfNails = (): BagSlot[] => Array.from({ length: BAG_SLOTS }, () => ({ item: 'nail', count: 5 }));
/** Lets the server tick a few times at the current game time. */
const ticks = () => new Promise(resolve => setTimeout(resolve, 100));
/** What a client heard so far, but its energy (the woods repeat it every 2 s). */
const news = async (c: Client) => (await c.settle()).filter(m => m.t !== 'energy');

describe('finds and the bag', () => {
  let now = 1_000_000;
  const { ctx, enter } = setup({ items: itemsData(), weather: 'overcast', clock: () => now });
  const world = () => ctx.server.world;
  /** The moss lying in the woods. If someone took it, the clock moves on until it has grown back (nobody is online between tests). */
  async function moss() {
    if (!world().findViews('woods').length) {
      now += 20_000;
      await waitFor(() => world().findViews('woods').length === 1, 'the moss to grow back');
    }
    return world().findViews('woods')[0]!;
  }

  it('welcomes a player with what lies on their map, their bag and the version of the items', async () => {
    const m = await moss();
    const a = await enter({ map: 'woods', x: 4, y: 1, bag: [{ item: 'tea', count: 1 }] });
    expect(a.welcome).toMatchObject({ finds: [m], drops: [], bag: [{ item: 'tea', count: 1 }], items: itemsData().version });
    const t = await enter({ map: 'town', x: 0, y: 5 });
    expect(t.welcome.finds.map(f => f.item)).toEqual(['nail', 'nail']);
    expect(t.welcome.finds).toEqual(world().findViews('town'));
  });

  it('gives a find to the player next to it: what they got, their bag, then gone for everyone on that map and nobody elsewhere', async () => {
    const m = await moss();
    const a = await enter({ map: 'woods', x: 4, y: 1 }); // next to every tile where moss grows
    const b = await enter({ map: 'woods', x: 1, y: 1 });
    const t = await enter({ map: 'town', x: 0, y: 5 });
    await Promise.all([a.c.settle(), b.c.settle(), t.c.settle()]);
    a.c.send({ t: 'pick', x: m.x, y: m.y });
    expect(await news(a.c)).toEqual([
      { t: 'got', items: [{ item: 'moss', count: 1 }], from: 'find' },
      { t: 'bag', bag: [{ item: 'moss', count: 1 }] },
      { t: 'findGone', id: m.id },
    ]);
    expect(await b.c.next('findGone')).toEqual({ t: 'findGone', id: m.id });
    expect(await news(t.c)).toEqual([]);
    expect(world().get(a.id)!.bag).toEqual([{ item: 'moss', count: 1 }]);
    expect(world().findViews('woods')).toEqual([]);
  });

  it('gives a find to the player standing on it, into the slot that already holds some', async () => {
    const m = await moss();
    const a = await enter({ map: 'woods', x: m.x, y: m.y, bag: [{ item: 'moss', count: 1 }] });
    a.c.send({ t: 'pick', x: m.x, y: m.y });
    expect(await news(a.c)).toEqual([
      { t: 'got', items: [{ item: 'moss', count: 1 }], from: 'find' },
      { t: 'bag', bag: [{ item: 'moss', count: 2 }] },
      { t: 'findGone', id: m.id },
    ]);
  });

  it('refuses a pick too far away, where nothing lies, and one that does not fit in the bag', async () => {
    const m = await moss();
    const far = await enter({ map: 'woods', x: 1, y: 1 }); // two tiles or more from every moss tile
    far.c.send({ t: 'pick', x: m.x, y: m.y });
    expect(await far.c.next('refused')).toEqual({ t: 'refused', action: 'pick', reason: 'too_far' });
    far.c.send({ t: 'pick', x: 1, y: 2 }); // next to it, but nothing lies there
    expect(await far.c.next('refused')).toEqual({ t: 'refused', action: 'pick', reason: 'gone' });
    const full = await enter({ map: 'woods', x: m.x, y: m.y, bag: fullOfNails() });
    full.c.send({ t: 'pick', x: m.x, y: m.y });
    expect(await full.c.next('refused')).toEqual({ t: 'refused', action: 'pick', reason: 'bag_full' });
    expect(world().findViews('woods')).toEqual([m]);
    expect(world().get(full.id)!.bag).toEqual(fullOfNails());
  });

  it('grows a picked find back within its respawn time, on another tile, and everyone on that map hears it', async () => {
    const m = await moss();
    const a = await enter({ map: 'woods', x: m.x, y: m.y }); // next to the campfire: never runs out
    const t = await enter({ map: 'town', x: 0, y: 5 });
    a.c.send({ t: 'pick', x: m.x, y: m.y });
    await a.c.next('findGone');
    now += 10_000 - 1; // just short of the shortest respawn
    await ticks();
    expect((await a.c.settle()).filter(msg => msg.t === 'find')).toEqual([]);
    now += 10_001; // the longest
    const { find } = await a.c.next('find');
    expect(find).toMatchObject({ item: 'moss', y: 1 });
    expect(find.id).not.toBe(m.id);
    expect(find.x).not.toBe(m.x);
    expect(MOSS_TILES).toContainEqual({ x: find.x, y: find.y });
    expect(world().findViews('woods')).toEqual([find]);
    expect((await t.c.settle()).filter(msg => msg.t === 'find')).toEqual([]);
  });

  it('uses a thermos (energy up, one gone), refuses what cannot be used, and throws a slot away; the bag is saved', async () => {
    const a = await enter({ map: 'town', x: 0, y: 5, energy: 50, bag: [{ item: 'tea', count: 2 }, { item: 'nail', count: 3 }] });
    a.c.send({ t: 'use', slot: 0 });
    expect(await a.c.next('energy')).toEqual({ t: 'energy', energy: told(80, 0), body: expect.any(Object) });
    expect(await a.c.next('bag')).toEqual({ t: 'bag', bag: [{ item: 'tea', count: 1 }, { item: 'nail', count: 3 }] });
    a.c.send({ t: 'use', slot: 1 });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'use', reason: 'not_usable' });
    a.c.send({ t: 'discard', slot: 1 });
    expect(await a.c.next('bag')).toEqual({ t: 'bag', bag: [{ item: 'tea', count: 1 }] });
    a.c.send({ t: 'discard', slot: 1 });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'discard', reason: 'empty_slot' });
    a.c.send({ t: 'use', slot: 7 });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'use', reason: 'empty_slot' });
    a.c.ws.close();
    await waitFor(() => ctx.storage.get(a.id)?.bag.length === 1, 'the bag to be saved');
    expect(ctx.storage.get(a.id)).toMatchObject({ energy: 80, bag: [{ item: 'tea', count: 1 }] });
  });

  it('closes on a pick, use or discard that breaks the rules of the protocol', async () => {
    for (const bad of [{ t: 'pick', x: 1.5, y: 2 }, { t: 'pick', x: 1 }, { t: 'use', slot: -1 }, { t: 'discard', slot: 64 }, { t: 'use', slot: '0' }]) {
      const a = await enter();
      a.c.send(JSON.stringify(bad));
      expect(await a.c.next('error')).toMatchObject({ code: 'bad_message' });
      expect((await a.c.closed).code).toBe(1008);
    }
  });
});

describe('piles', () => {
  let now = 1_000_000;
  let seq = 0;
  const { ctx, enter, login } = setup({ items: itemsData(), weather: 'overcast', clock: () => now });
  /** Walks one tile per direction, a step's time apart on the game clock. */
  async function walk(c: Client, ...dirs: Dir[]) {
    for (const dir of dirs) {
      const s = ++seq;
      c.send({ t: 'step', dir, seq: s });
      await c.next('step', m => m.seq === s);
      now += STEP_MS;
    }
  }
  /** From the town's spawn up the road into the woods, where it arrives at 3,6. */
  const TO_THE_WOODS: Dir[] = ['right', 'right', 'right', 'up', 'up'];

  it('turns the bag into a pile where the player fell; they go back for it and get all of it', async () => {
    const w = await enter({ map: 'woods', x: 4, y: 1 }); // by the campfire: never runs out
    const bag = [{ item: 'moss', count: 2 }, { item: 'nail', count: 3 }];
    const a = await enter({ map: 'woods', x: 3, y: 6, energy: 1, bag });
    await Promise.all([w.c.settle(), a.c.settle()]);
    now += 5000; // 1 energy lasts about 4.1 s at 3,6
    const { drop } = await w.c.next('drop');
    expect(drop).toEqual({ id: a.id, x: 3, y: 6, owner: a.id, name: a.welcome.name, until: expect.any(Number), trail: [] });
    // An hour after the collapse, on the wall clock.
    expect(Math.abs(drop.until - DROP_LIFETIME_MS - Date.now())).toBeLessThan(60_000);
    expect(await w.c.next('leave')).toEqual({ t: 'leave', id: a.id });
    expect(await a.c.next('bag')).toEqual({ t: 'bag', bag: [] });
    expect(await a.c.next('zone')).toMatchObject({ map: { id: 'town' }, reason: 'collapse', drops: [] });
    // The pile and the emptied bag are stored right away.
    await waitFor(() => ctx.storage.drop(a.id) !== undefined && ctx.storage.get(a.id)!.bag.length === 0, 'the pile and the empty bag to be stored');
    expect(ctx.storage.drop(a.id)).toEqual({ owner: a.id, map: 'woods', x: 3, y: 6, items: bag, droppedAt: drop.until - DROP_LIFETIME_MS, trail: [] });

    await walk(a.c, ...TO_THE_WOODS);
    expect(await a.c.next('zone', m => m.reason === 'exit')).toMatchObject({ map: { id: 'woods' }, x: 3, y: 6, drops: [drop] });
    a.c.send({ t: 'pick', x: 3, y: 6 });
    expect(await a.c.next('got')).toEqual({ t: 'got', items: bag, from: 'drop' });
    expect(await a.c.next('bag')).toEqual({ t: 'bag', bag });
    expect(await w.c.next('dropGone')).toEqual({ t: 'dropGone', id: a.id });
    await waitFor(() => ctx.storage.drop(a.id) === undefined, 'the pile to be forgotten');
    expect(ctx.server.world.dropViews('woods')).toEqual([]);
  });

  it('leaves in the pile what does not fit in the owner\'s bag: the map hears the pile again, and storage keeps the rest', async () => {
    const w = await enter({ map: 'woods', x: 4, y: 1 });
    const a = await enter({ map: 'woods', x: 2, y: 6, energy: 1, bag: [{ item: 'moss', count: 3 }, { item: 'nail', count: 5 }, { item: 'tea', count: 2 }] });
    now += 5000;
    const { drop } = await w.c.next('drop', m => m.drop.owner === a.id);
    await a.c.next('zone', m => m.reason === 'collapse');
    // Back out later, next to the pile, with seven slots of nails: one slot free.
    a.c.ws.close();
    await waitFor(() => !ctx.server.world.has(a.id), 'the player to leave');
    const nails = Array.from({ length: BAG_SLOTS - 1 }, () => ({ item: 'nail', count: 5 }));
    await ctx.storage.save({ ...ctx.storage.get(a.id)!, map: 'woods', x: 2, y: 5, bag: nails });
    const again = await login(a.token);
    await w.c.settle();
    again.c.send({ t: 'pick', x: 2, y: 6 });
    expect(await again.c.next('got')).toEqual({ t: 'got', items: [{ item: 'moss', count: 3 }], from: 'drop' });
    expect(await again.c.next('bag')).toEqual({ t: 'bag', bag: [...nails, { item: 'moss', count: 3 }] });
    expect(await w.c.next('drop')).toEqual({ t: 'drop', drop });
    await waitFor(() => ctx.storage.drop(a.id)?.items.length === 2, 'the rest of the pile to be stored');
    expect(ctx.storage.drop(a.id)!.items).toEqual([{ item: 'nail', count: 5 }, { item: 'tea', count: 2 }]);
    // Nothing more fits: the pile stays as it is.
    again.c.send({ t: 'pick', x: 2, y: 6 });
    expect(await again.c.next('refused')).toEqual({ t: 'refused', action: 'pick', reason: 'bag_full' });
    expect(ctx.server.world.dropViews('woods')).toContainEqual(drop);
    // With two slots made free, the rest comes back and the pile is gone.
    again.c.send({ t: 'discard', slot: 0 });
    again.c.send({ t: 'discard', slot: 0 });
    await again.c.next('bag');
    await again.c.next('bag');
    again.c.send({ t: 'pick', x: 2, y: 6 });
    expect(await again.c.next('got')).toEqual({ t: 'got', items: [{ item: 'nail', count: 5 }, { item: 'tea', count: 2 }], from: 'drop' });
    expect(await w.c.next('dropGone')).toEqual({ t: 'dropGone', id: a.id });
    await waitFor(() => ctx.storage.drop(a.id) === undefined, 'the pile to be forgotten');
  });

  it('gives someone else a random half: the rest is lost, and the owner finds nothing', async () => {
    const b = await enter({ map: 'woods', x: 3, y: 5 });
    const a = await enter({ map: 'woods', x: 3, y: 6, energy: 1, bag: [{ item: 'moss', count: 3 }, { item: 'nail', count: 5 }] });
    await b.c.settle();
    now += 5000;
    await b.c.next('drop');
    b.c.send({ t: 'pick', x: 3, y: 6 });
    const got = await b.c.next('got');
    expect(got.from).toBe('drop');
    expect(units(got.items)).toBe(4);
    expect(await b.c.next('bag')).toEqual({ t: 'bag', bag: got.items });
    expect(await b.c.next('dropGone')).toEqual({ t: 'dropGone', id: a.id });
    await waitFor(() => ctx.storage.drop(a.id) === undefined, 'the pile to be forgotten');

    await walk(a.c, ...TO_THE_WOODS);
    expect(await a.c.next('zone', m => m.reason === 'exit')).toMatchObject({ map: { id: 'woods' }, drops: [] });
    a.c.send({ t: 'pick', x: 3, y: 6 });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'pick', reason: 'gone' });
  });

  it('replaces the old pile when its owner collapses again', async () => {
    const w = await enter({ map: 'woods', x: 4, y: 1 });
    const a = await enter({ map: 'woods', x: 3, y: 6, energy: 1, bag: [{ item: 'moss', count: 1 }] });
    now += 5000;
    await w.c.next('drop', m => m.drop.owner === a.id);
    await waitFor(() => ctx.storage.drop(a.id) !== undefined, 'the first pile to be stored');
    // Out again later with something new in the bag, and out of energy a few tiles farther.
    a.c.ws.close();
    await waitFor(() => !ctx.server.world.has(a.id) && ctx.storage.get(a.id)!.map === 'town', 'the player to leave');
    await ctx.storage.save({ ...ctx.storage.get(a.id)!, map: 'woods', x: 6, y: 5, energy: 0.5, bag: [{ item: 'tea', count: 1 }] });
    const again = await login(a.token);
    await w.c.settle();
    now += 5000;
    expect(await w.c.next('dropGone')).toEqual({ t: 'dropGone', id: a.id });
    expect((await w.c.next('drop')).drop).toMatchObject({ id: a.id, x: 6, y: 5 });
    await again.c.next('zone', m => m.reason === 'collapse');
    await waitFor(() => ctx.storage.drop(a.id)?.x === 6, 'the new pile to be stored');
    expect(ctx.storage.drop(a.id)).toMatchObject({ map: 'woods', x: 6, y: 5, items: [{ item: 'tea', count: 1 }] });
    expect(ctx.server.world.dropViews('woods').filter(d => d.owner === a.id)).toHaveLength(1);
  });

  it('fades an hour after the collapse, for everyone on the map and in storage', async () => {
    const a = await enter({ map: 'woods', x: 3, y: 6, energy: 1, bag: [{ item: 'nail', count: 1 }] });
    now += 5000;
    const fell = now;
    await waitFor(() => ctx.storage.drop(a.id) !== undefined, 'the pile to be stored');
    now = fell + DROP_LIFETIME_MS - 1;
    await ticks();
    // Nobody lasts an hour in the woods (the campfire burns down), so the one who sees it fade comes just before.
    // (Piles left by the tests before this one have faded by now.)
    const w = await enter({ map: 'woods', x: 4, y: 1 });
    expect(w.welcome.drops.map(d => d.owner)).toEqual([a.id]);
    await w.c.settle();
    now = fell + DROP_LIFETIME_MS;
    expect(await w.c.next('dropGone', m => m.id === a.id)).toEqual({ t: 'dropGone', id: a.id });
    await waitFor(() => ctx.storage.drop(a.id) === undefined, 'the pile to be forgotten');
  });
});

describe('a restart with MemoryStorage', () => {
  it('keeps bags with their players and piles within their hour, and forgets older piles', async () => {
    const storage = new MemoryStorage();
    await restartKeepsBagsAndPiles(storage, storage, async owner => storage.drop(owner) !== undefined);
  });
});
