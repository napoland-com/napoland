/**
 * A crate that needs two, over real WebSockets (slab.ts, roadmap/sealed-crates.md): while the woods are
 * restless, two players facing the slab and putting their hands to it within SLAB_PAIR_MS of each other
 * lift it, and each takes what it holds; alone it will not move; each opens it once a restless phase;
 * calm or surging it lies cold; a bag without room for it is told so; and the notice board says when it
 * glows.
 *
 * The fixture town with a notice board at 2,5 (read from 2,6), and woods that grow restless on a clock of
 * their own: every 100 s, calm for 70, restless for 20, then a surge of 10. The slab lies at 3,4: faced
 * from 3,5 (up), 2,4 (right) and 4,4 (left). A game clock that only moves when a test moves it.
 */
import { describe, expect, it } from 'vitest';
import { SLAB_PAIR_MS, TileMap, type BagSlot, type Dir, type ItemsData, type MapData } from '@napoland/shared';
import { houseData, townData, woodsData } from './fixtures';
import { setup, type Client } from './helpers';

const EVERY = 100;
/** A clock that starts a second into a calm, whenever the test runs: restless 70 s in, the surge 90 s in. */
const RULE: NonNullable<MapData['surge']> = { every: EVERY, unstable: 20, surge: 10, sweep: 5, offset: EVERY - ((Date.now() / 1000) % EVERY) + 1 };
const SLAB = { x: 3, y: 4 };
const HOLDS: BagSlot[] = [{ item: 'strange', count: 2 }, { item: 'shard', count: 1 }];
const maps = () => [
  new TileMap({ ...townData(), objects: [...townData().objects, { kind: 'board', x: 2, y: 5 }] }),
  new TileMap(houseData()),
  new TileMap({ ...woodsData(), surge: RULE, objects: [...woodsData().objects, { kind: 'slab', ...SLAB, name: 'the slab in the woods', holds: HOLDS }] }),
];
const items = (): ItemsData => ({
  version: 1,
  items: [
    { id: 'strange', name: 'Strange object', kind: 'resource', stack: 1, text: 'What is it?', xp: 15 },
    { id: 'shard', name: 'Anomaly shard', noun: 'shard', kind: 'resource', stack: 5, text: 'Warm.', xp: 12 },
    { id: 'tea', name: 'Tea', kind: 'consumable', stack: 2, text: 'Warm.', use: { energy: 30 } },
  ],
  finds: [],
});
/** Beside the slab, facing it. */
const SOUTH = { map: 'woods', x: 3, y: 5, dir: 'up' as Dir }, WEST = { map: 'woods', x: 2, y: 4, dir: 'right' as Dir }, EAST = { map: 'woods', x: 4, y: 4, dir: 'left' as Dir };

describe('the slab in the ring of stones, over the network', () => {
  let now = 1_000_000;
  const { ctx, enter } = setup({ maps: maps(), items: items(), weather: 'overcast', clock: () => now, rng: () => 0 });
  const world = () => ctx.server.world;
  /** Moves the clock to `s` seconds into the next surge cycle (0: calm starts; 70: restless; 90: the surge), and lets the world see it. */
  const at = async (s: number, c: Client) => {
    const t = ((((now + epoch()) / 1000 + RULE.offset!) % EVERY) + EVERY) % EVERY;
    now += ((s - t + EVERY) % EVERY) * 1000 + 50;
    await c.settle();
  };
  // The wall clock the World reads, less the game clock: it was fixed when the server started.
  let offset: number | undefined;
  const epoch = () => (offset ??= Date.now() - now);
  const press = (c: Client) => c.send({ t: 'slab', ...SLAB });

  it('lifts for two within a few seconds of each other: each takes what it holds, into the bag', async () => {
    const ana = await enter(SOUTH), bo = await enter(WEST);
    await at(72, ana.c);
    press(ana.c);
    expect(await ana.c.next('refused')).toEqual({ t: 'refused', action: 'slab', reason: 'one_pair' });
    now += SLAB_PAIR_MS - 500;
    press(bo.c);
    expect(await bo.c.next('did')).toEqual({ t: 'did', did: { kind: 'slab', with: ana.welcome.name, got: HOLDS } });
    expect(await ana.c.next('did')).toEqual({ t: 'did', did: { kind: 'slab', with: bo.welcome.name, got: HOLDS } });
    // One strange object to a slot, as ever.
    for (const p of [ana, bo]) expect(world().get(p.id)!.bag).toEqual([{ item: 'strange', count: 1 }, { item: 'strange', count: 1 }, { item: 'shard', count: 1 }]);
  });

  it('will not move for one pair of hands, nor for two more than a few seconds apart', async () => {
    const ana = await enter(SOUTH), bo = await enter(WEST);
    await at(72, ana.c);
    press(ana.c);
    expect(await ana.c.next('refused')).toMatchObject({ reason: 'one_pair' });
    // The same hands again are still one pair.
    press(ana.c);
    expect(await ana.c.next('refused')).toMatchObject({ reason: 'one_pair' });
    now += SLAB_PAIR_MS + 100;
    press(bo.c);
    expect(await bo.c.next('refused')).toMatchObject({ reason: 'one_pair' });
    expect(world().get(ana.id)!.bag).toEqual([]);
  });

  it('opens once a restless time for each: the pair that had it cannot again, others can, and next time they can too', async () => {
    const ana = await enter(SOUTH), bo = await enter(WEST), cid = await enter(EAST);
    await at(71, ana.c);
    press(ana.c);
    await ana.c.next('refused');
    press(bo.c);
    await bo.c.next('did');
    await ana.c.next('did');
    press(ana.c);
    expect(await ana.c.next('refused')).toEqual({ t: 'refused', action: 'slab', reason: 'opened' });
    // Cid comes along: Ana's hands, who had it, do not make a pair with Cid's.
    press(cid.c);
    expect(await cid.c.next('refused')).toMatchObject({ reason: 'one_pair' });
    press(bo.c);
    expect(await bo.c.next('refused')).toMatchObject({ reason: 'opened' });
    const dee = await enter({ map: 'woods', x: 3, y: 5, dir: 'up' });
    press(dee.c);
    expect(await dee.c.next('did')).toMatchObject({ did: { kind: 'slab', with: cid.welcome.name } });
    expect(await cid.c.next('did')).toMatchObject({ did: { kind: 'slab', with: dee.welcome.name } });

    // The next time the woods grow restless, Ana and Bo can again.
    await at(20, ana.c);
    await at(75, ana.c);
    press(ana.c);
    await ana.c.next('refused', m => m.reason === 'one_pair');
    press(bo.c);
    expect(await bo.c.next('did')).toMatchObject({ did: { kind: 'slab', with: ana.welcome.name } });
    expect(world().get(ana.id)!.bag).toEqual([{ item: 'strange', count: 1 }, { item: 'strange', count: 1 }, { item: 'shard', count: 2 }, { item: 'strange', count: 1 }, { item: 'strange', count: 1 }]);
  });

  it('lies cold while the woods are calm, and while the surge sweeps them', async () => {
    const ana = await enter(SOUTH), bo = await enter(WEST);
    await at(10, ana.c);
    press(ana.c);
    expect(await ana.c.next('refused')).toEqual({ t: 'refused', action: 'slab', reason: 'cold' });
    await at(92, ana.c);
    press(ana.c);
    press(bo.c);
    expect(await ana.c.next('refused')).toMatchObject({ reason: 'cold' });
    expect(await bo.c.next('refused')).toMatchObject({ reason: 'cold' });
  });

  it('says plainly when a bag has no room for what it holds, and those hands do not count', async () => {
    const full = Array.from({ length: 8 }, () => ({ item: 'tea', count: 2 }));
    const ana = await enter({ ...SOUTH, bag: full }), bo = await enter(WEST);
    await at(72, ana.c);
    press(ana.c);
    expect(await ana.c.next('refused')).toEqual({ t: 'refused', action: 'slab', reason: 'bag_full' });
    press(bo.c);
    expect(await bo.c.next('refused')).toMatchObject({ reason: 'one_pair' });
  });

  it('is opened from beside it, facing it', async () => {
    const far = await enter({ map: 'woods', x: 3, y: 6, dir: 'up' }), away = await enter({ map: 'woods', x: 3, y: 5, dir: 'down' });
    await at(72, far.c);
    press(far.c);
    press(away.c);
    expect(await far.c.next('refused')).toMatchObject({ reason: 'too_far' });
    expect(await away.c.next('refused')).toMatchObject({ reason: 'too_far' });
  });

  it('is on the notice board while it glows', async () => {
    const reader = await enter({ map: 'town', x: 2, y: 6, dir: 'up' });
    await at(72, reader.c);
    reader.c.send({ t: 'board', x: 2, y: 5 });
    expect((await reader.c.next('board')).lines).toContain('The slab in the woods is glowing.');
    await at(20, reader.c);
    reader.c.send({ t: 'board', x: 2, y: 5 });
    expect((await reader.c.next('board')).lines.some(l => l.includes('slab'))).toBe(false);
  });
});
