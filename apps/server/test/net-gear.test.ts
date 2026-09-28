/**
 * Gear on the road, over real WebSockets: a piece taken out of the chest travels in the bag as it is,
 * goes on out in the wilds and comes off into the bag, falls into the pile when you collapse and comes
 * back out of it as it went in (for its owner, and in someone else's half), and what a strange object
 * turns into is a piece at once. The fixture maps (fixtures.ts) with a chest and a workbench in the
 * house; a game clock that only moves when a test moves it, so nothing wears down unless it says so.
 */
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, STEP_MS, TileMap, type Dir, type ItemsData, type Slot } from '@napoland/shared';
import { houseData, itemsData, townData, woodsData } from './fixtures';
import { setup, waitFor, type Client } from './helpers';

/** A chest at 3,1 in the house (stand at 3,2), a workbench at 1,1 (stand at 1,2). */
const maps = () => [
  new TileMap(townData()),
  new TileMap({ ...houseData(), objects: [...houseData().objects, { kind: 'chest', x: 3, y: 1 }, { kind: 'workbench', x: 1, y: 1 }] }),
  new TileMap(woodsData()),
];
const gear = (id: string, slot: Slot, more: object = {}) => ({ id, name: id, kind: 'gear' as const, stack: 1, text: 'Gear.', slot, ...more });
const items = (): ItemsData => ({
  ...itemsData(),
  items: [
    ...itemsData().items,
    gear('worn-cap', 'cap'), gear('worn-shirt', 'shirt'), gear('worn-gloves', 'gloves'), gear('worn-pants', 'pants'), gear('worn-shoes', 'shoes'),
    gear('backpack', 'bag', { bag: 8 }), gear('tote', 'bag', { bag: 2 }),
    gear('coat', 'shirt', { tier: 'sturdy', resist: { cold: 0.4 }, bonus: 5, weight: 1 }),
    gear('halo', 'cap', { tier: 'anomalous', resist: { radiation: 0.5 } }),
    { id: 'odd', name: 'Strange object', kind: 'resource', stack: 1, text: 'What is it?', use: { identify: true }, reveals: [{ item: 'halo', count: 1, weight: 1 }] },
  ],
  wear: { sturdy: 100, anomalous: 300 },
  quirks: [{ id: 'footprints', name: 'Glowing steps', text: 'Glows.' }, { id: 'flicker', name: 'Flicker', text: 'Flickers.' }, { id: 'hum', name: 'Humming', text: 'Hums.' }],
});
const STARTER = { cap: 'worn-cap', shirt: 'worn-shirt', gloves: 'worn-gloves', pants: 'worn-pants', shoes: 'worn-shoes', bag: 'backpack' };

describe('gear on the road, over the network', () => {
  let now = 1_000_000;
  let seq = 0;
  const { ctx, enter, login } = setup({ maps: maps(), items: items(), weather: 'overcast', clock: () => now, rng: () => 0 });
  /** Walks one tile per direction, a step's time apart on the game clock. */
  async function walk(c: Client, ...dirs: Dir[]) {
    for (const dir of dirs) {
      const s = ++seq;
      c.send({ t: 'step', dir, seq: s });
      await c.next('step', m => m.seq === s);
      now += STEP_MS;
    }
  }
  /** Leaves, and comes back in where the test wants (the record as saved when they left). */
  async function moveTo(a: { c: Client; id: string; token: string }, where: { map: string; x: number; y: number }) {
    a.c.ws.close();
    await waitFor(() => !ctx.server.world.has(a.id), 'the player to leave');
    await ctx.storage.save({ ...ctx.storage.get(a.id)!, ...where });
    return login(a.token);
  }

  it('takes a piece out of the chest as it is, keeps it in the bag across a save, wears it out in the wilds and takes it off into the bag', async () => {
    const a = await enter({ map: 'house', x: 3, y: 2, dir: 'up', stash: { items: { coat: 2 }, out: {}, pieces: { coat: [{ cond: 1 }, { cond: 0.6 }] } } });
    await a.c.settle();
    a.c.send({ t: 'take', x: 3, y: 1, item: 'coat', count: 1, n: 1 });
    expect(await a.c.next('bag')).toEqual({ t: 'bag', bag: [{ item: 'coat', count: 1, piece: { cond: 0.6 } }] });
    expect(await a.c.next('chest')).toEqual({ t: 'chest', stash: [{ item: 'coat', count: 1, piece: { cond: 1 } }] });

    const b = await moveTo(a, { map: 'woods', x: 3, y: 5 });
    expect(b.welcome.bag).toEqual([{ item: 'coat', count: 1, piece: { cond: 0.6 } }]);
    const w = await enter({ map: 'woods', x: 4, y: 1 });
    await Promise.all([b.c.settle(), w.c.settle()]);
    b.c.send({ t: 'wear', slot: 0 });
    expect(await b.c.next('bag')).toEqual({ t: 'bag', bag: [{ item: 'worn-shirt', count: 1, piece: { cond: 1 } }] });
    expect(await w.c.next('gear')).toEqual({ t: 'gear', id: b.id, gear: { ...STARTER, shirt: 'coat' }, quirks: [] });
    const on = await b.c.next('energy', m => m.body.worn.shirt?.cond === 0.6);
    expect(on.energy.max).toBe(b.welcome.energy.max + 5);

    b.c.send({ t: 'doff', slot: 'shirt' });
    expect(await b.c.next('bag')).toEqual({ t: 'bag', bag: [{ item: 'worn-shirt', count: 1, piece: { cond: 1 } }, { item: 'coat', count: 1, piece: { cond: 0.6 } }] });
    expect(await w.c.next('gear')).toEqual({ t: 'gear', id: b.id, gear: { cap: 'worn-cap', gloves: 'worn-gloves', pants: 'worn-pants', shoes: 'worn-shoes', bag: 'backpack' }, quirks: [] });
    // Saved at once: a crash now loses nothing.
    await waitFor(() => ctx.storage.get(b.id)!.bag.length === 2, 'the bag to be saved');
    expect(ctx.storage.get(b.id)!.bag[1]).toEqual({ item: 'coat', count: 1, piece: { cond: 0.6 } });
  });

  it('refuses to take off into a full bag, and to put a bag on from the bag: the bag you wear changes only at home', async () => {
    const a = await enter({ map: 'woods', x: 3, y: 5, gear: { ...STARTER, bag: 'tote' }, bag: [{ item: 'backpack', count: 1, piece: { cond: 1 } }, { item: 'moss', count: 1 }] });
    await a.c.settle();
    a.c.send({ t: 'doff', slot: 'cap' });
    a.c.send({ t: 'wear', slot: 0 });
    a.c.send({ t: 'doff', slot: 'bag' });
    const heard = (await a.c.settle()).filter(m => m.t !== 'energy');
    expect(heard).toEqual([
      { t: 'refused', action: 'doff', reason: 'bag_full' },
      { t: 'refused', action: 'wear', reason: 'bag_at_home' },
      { t: 'refused', action: 'doff', reason: 'keep_bag' },
    ]);
    expect(ctx.server.world.get(a.id)).toMatchObject({ gear: { ...STARTER, bag: 'tote' }, bag: [{ item: 'backpack', count: 1 }, { item: 'moss', count: 1 }] });
  });

  it('drops a carried piece into the pile as it is; its owner picks it back so, and someone else finds it so in their half', async () => {
    const coat = { cond: 0.35, quirk: 'hum' as const };
    const w = await enter({ map: 'woods', x: 4, y: 1 }); // by the campfire: never runs out
    const a = await enter({ map: 'woods', x: 3, y: 6, energy: 1, bag: [{ item: 'coat', count: 1, piece: coat }, { item: 'moss', count: 2 }] });
    await Promise.all([w.c.settle(), a.c.settle()]);
    now += 5000; // 1 energy lasts about 4 s at 3,6
    await w.c.next('drop', m => m.drop.owner === a.id);
    await a.c.next('zone', m => m.reason === 'collapse');
    await waitFor(() => ctx.storage.drop(a.id) !== undefined, 'the pile to be stored');
    expect(ctx.storage.drop(a.id)!.items).toEqual([{ item: 'coat', count: 1, piece: coat }, { item: 'moss', count: 2 }]);

    // Back up the road, and the pile gives it all back as it was.
    await walk(a.c, 'right', 'right', 'right', 'up', 'up');
    await a.c.next('zone', m => m.reason === 'exit');
    a.c.send({ t: 'pick', x: 3, y: 6 });
    expect(await a.c.next('got')).toEqual({ t: 'got', items: [{ item: 'coat', count: 1 }, { item: 'moss', count: 2 }], from: 'drop' });
    expect(await a.c.next('bag', m => m.bag.length > 0)).toEqual({ t: 'bag', bag: [{ item: 'coat', count: 1, piece: coat }, { item: 'moss', count: 2 }] });

    // Someone else's pile: their half of one piece is the piece, as it was.
    const b = await enter({ map: 'woods', x: 3, y: 6, energy: 1, bag: [{ item: 'coat', count: 1, piece: { cond: 0.8 } }] });
    const c = await enter({ map: 'woods', x: 3, y: 5 });
    await c.c.settle();
    now += 5000;
    await c.c.next('drop', m => m.drop.owner === b.id);
    c.c.send({ t: 'pick', x: 3, y: 6 });
    expect(await c.c.next('bag')).toEqual({ t: 'bag', bag: [{ item: 'coat', count: 1, piece: { cond: 0.8 } }] });
  });

  it('turns a strange object into a piece in the bag, its quirk rolled, and it can be worn at once', async () => {
    const a = await enter({ map: 'house', x: 2, y: 3, bag: [{ item: 'odd', count: 1 }] });
    await a.c.settle();
    a.c.send({ t: 'use', slot: 0 });
    const piece = { cond: 1, quirk: 'footprints' };
    expect(await a.c.next('did')).toEqual({ t: 'did', did: { kind: 'used', item: 'odd', into: { item: 'halo', count: 1, piece } } });
    expect(ctx.server.world.get(a.id)!.bag).toEqual([{ item: 'halo', count: 1, piece }]);
    await a.c.settle();
    a.c.send({ t: 'wear', slot: 0 });
    expect(await a.c.next('gear')).toEqual({ t: 'gear', id: a.id, gear: { ...STARTER, cap: 'halo' }, quirks: ['footprints'] });
    expect(await a.c.next('bag')).toEqual({ t: 'bag', bag: [{ item: 'worn-cap', count: 1, piece: { cond: 1 } }] });
  });

  it('closes on a wear, a doff or a take whose fields break the rules of the protocol', async () => {
    for (const bad of [{ t: 'wear', slot: -1 }, { t: 'wear', slot: 'cap' }, { t: 'doff', slot: 'hat' }, { t: 'doff', slot: 0 }, { t: 'take', x: 3, y: 1, item: 'coat', count: 1, n: -1 }]) {
      const a = await enter();
      a.c.send(JSON.stringify(bad));
      expect(await a.c.next('error')).toMatchObject({ code: 'bad_message' });
      expect((await a.c.closed).code).toBe(1008);
    }
    expect(PROTOCOL_VERSION).toBe(21);
  });
});
