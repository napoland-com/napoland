/**
 * Asking first, over real WebSockets: feeding a fire several at once (as many as fit), giving the Old
 * Stone shards, using, throwing away, making and mending, each followed by `did` with what it did, and
 * the refusals as before. The fixture maps (fixtures.ts) with the Old Stone in town, a fire in the woods
 * that burns down, and a workbench in the house; a game clock that only moves when a test moves it.
 */
import { describe, expect, it } from 'vitest';
import { FEED_MAX, FIRE_MAX_S, TileMap, type ItemsData, type ServerMsg } from '@napoland/shared';
import { houseData, itemsData, townData, woodsData } from './fixtures';
import { setup, type Client } from './helpers';

/** The Old Stone at 2,5 in town (stand at 2,6); a workbench at 1,1 in the house (stand at 1,2); the woods' fire at 4,2 burns down (stand at 4,1). */
const maps = () => [
  new TileMap({ ...townData(), objects: [...townData().objects, { kind: 'stone', x: 2, y: 5 }] }),
  new TileMap({ ...houseData(), objects: [...houseData().objects, { kind: 'workbench', x: 1, y: 1 }] }),
  new TileMap({ ...woodsData(), objects: [{ kind: 'lamp', x: 1, y: 4 }, { kind: 'fireplace', x: 4, y: 2 }] }),
];
const items = (): ItemsData => ({
  ...itemsData(),
  items: [
    ...itemsData().items,
    { id: 'resin', name: 'Fir resin', kind: 'resource', stack: 20, text: 'Sticky.', fuel: 300 },
    { id: 'rock', name: 'Rock', kind: 'resource', stack: 10, text: 'Heavy.' },
    { id: 'shard', name: 'Shard', kind: 'resource', stack: 5, text: 'Warm.', charge: 1 },
    { id: 'odd', name: 'Strange object', kind: 'resource', stack: 1, text: '?', use: { identify: true }, reveals: [{ item: 'feather', count: 1, weight: 1 }] },
    { id: 'feather', name: 'Feather', kind: 'charm', stack: 1, text: 'Light.', charm: { load: 0.5 }, about: 'Your bag feels lighter.' },
    { id: 'cloth', name: 'Cloth', kind: 'resource', stack: 10, text: 'Dry.' },
    { id: 'coat', name: 'Coat', kind: 'gear', stack: 1, text: 'Warm.', slot: 'shirt', tier: 'sturdy', resist: { cold: 0.2 } },
  ],
  recipes: [{ id: 'coat', make: 'coat', needs: [{ item: 'cloth', count: 4 }] }],
  wear: { sturdy: 100 },
  mend: { sturdy: [{ item: 'cloth', count: 2 }] },
});

/** What a client heard so far, but its energy (the woods repeat it every 2 s). */
const news = async (c: Client) => (await c.settle()).filter(m => m.t !== 'energy');
const did = (msgs: ServerMsg[]) => msgs.filter(m => m.t === 'did');

describe('asking first, over the network', () => {
  const now = 1_000_000;
  // rng 0: the woods' fire starts half full, 900 s.
  const { ctx, enter } = setup({ maps: maps(), items: items(), weather: 'overcast', clock: () => now, rng: () => 0 });

  it('feeds a fire as many as fit from one message: the map sees it burn, the feeder hears what it took; then it refuses as before', async () => {
    const a = await enter({ map: 'woods', x: 4, y: 1, bag: [{ item: 'resin', count: 5 }, { item: 'rock', count: 1 }] });
    const b = await enter({ map: 'woods', x: 1, y: 1 });
    await Promise.all([a.c.settle(), b.c.settle()]);
    // 900 s left: three resin go in (the third tops it up), the other two stay in the bag.
    a.c.send({ t: 'feed', x: 4, y: 2, slot: 0, count: 5 });
    const heard = await news(a.c);
    expect(heard).toContainEqual({ t: 'bag', bag: [{ item: 'resin', count: 2 }, { item: 'rock', count: 1 }] });
    expect(heard).toContainEqual({ t: 'fire', fire: { x: 4, y: 2, left: FIRE_MAX_S } });
    expect(heard.at(-1)).toEqual({ t: 'did', did: { kind: 'fire', item: 'resin', count: 3, left: FIRE_MAX_S } });
    expect(await b.c.next('fire')).toEqual({ t: 'fire', fire: { x: 4, y: 2, left: FIRE_MAX_S } });
    expect(did(await news(b.c))).toEqual([]);
    // Full now; and a rock never burns. Nothing is spent either way.
    a.c.send({ t: 'feed', x: 4, y: 2, slot: 0, count: 2 });
    a.c.send({ t: 'feed', x: 4, y: 2, slot: 1 });
    expect(await news(a.c)).toEqual([{ t: 'refused', action: 'feed', reason: 'fire_full' }, { t: 'refused', action: 'feed', reason: 'not_fuel' }]);
    expect(ctx.server.world.get(a.id)!.bag).toEqual([{ item: 'resin', count: 2 }, { item: 'rock', count: 1 }]);
  });

  it('refuses a fire someone in town keeps going, and one too far away', async () => {
    const a = await enter({ map: 'house', x: 2, y: 2, bag: [{ item: 'resin', count: 3 }] });
    await a.c.settle();
    a.c.send({ t: 'feed', x: 2, y: 1, slot: 0, count: 3 });
    a.c.send({ t: 'feed', x: 2, y: 4, slot: 0 });
    expect(await news(a.c)).toEqual([{ t: 'refused', action: 'feed', reason: 'tended' }, { t: 'refused', action: 'feed', reason: 'too_far' }]);
    expect(ctx.server.world.get(a.id)!.bag).toEqual([{ item: 'resin', count: 3 }]);
  });

  it('gives the Old Stone as many shards as asked, from every slot of them: everyone hears the Stone, the giver how it stands', async () => {
    const a = await enter({ map: 'town', x: 2, y: 6, bag: [{ item: 'shard', count: 5 }, { item: 'tea', count: 1 }, { item: 'shard', count: 2 }] });
    const t = await enter({ map: 'woods', x: 1, y: 1 });
    await Promise.all([a.c.settle(), t.c.settle()]);
    const before = ctx.server.world.stoneView(now).charge;
    a.c.send({ t: 'feed', x: 2, y: 5, slot: 0, count: 6 });
    const stone = { charge: before + 6, need: 20, awake: false, left: 0 };
    const heard = await news(a.c);
    expect(heard.at(-1)).toEqual({ t: 'did', did: { kind: 'stone', item: 'shard', count: 6, stone } });
    expect(heard).toContainEqual({ t: 'bag', bag: [{ item: 'tea', count: 1 }, { item: 'shard', count: 1 }] });
    expect(await t.c.next('stone')).toEqual({ t: 'stone', stone });
  });

  it('says what using and throwing away did; a strange object says what it turned out to be, and nothing floats as picked up', async () => {
    const a = await enter({ map: 'house', x: 2, y: 3, energy: 50, bag: [{ item: 'tea', count: 2 }, { item: 'rock', count: 3 }, { item: 'odd', count: 1 }] });
    await a.c.settle();
    a.c.send({ t: 'use', slot: 0 });
    expect(did(await news(a.c))).toEqual([{ t: 'did', did: { kind: 'used', item: 'tea', energy: 30 } }]);
    a.c.send({ t: 'discard', slot: 1, count: 2 });
    expect(await news(a.c)).toEqual([
      { t: 'bag', bag: [{ item: 'tea', count: 1 }, { item: 'rock', count: 1 }, { item: 'odd', count: 1 }] },
      { t: 'did', did: { kind: 'thrown', item: 'rock', count: 2 } },
    ]);
    // Left out, the count is all of it, as before.
    a.c.send({ t: 'discard', slot: 1 });
    expect(did(await news(a.c))).toEqual([{ t: 'did', did: { kind: 'thrown', item: 'rock', count: 1 } }]);
    a.c.send({ t: 'use', slot: 1 });
    const looked = await news(a.c);
    expect(looked.filter(m => m.t === 'got')).toEqual([]);
    expect(looked.at(-1)).toEqual({ t: 'did', did: { kind: 'used', item: 'odd', into: { item: 'feather', count: 1 } } });
    expect(ctx.server.world.get(a.id)!.bag).toEqual([{ item: 'tea', count: 1 }, { item: 'feather', count: 1 }]);
  });

  it('says what making and mending at the workbench did, and refuses what the stash lacks as before', async () => {
    const a = await enter({ map: 'house', x: 1, y: 2, dir: 'up', gear: { shirt: 'coat' }, worn: { shirt: { cond: 0.3 } }, stash: { items: { cloth: 7 }, out: {} } });
    await a.c.settle();
    a.c.send({ t: 'craft', x: 1, y: 1, recipe: 'coat' });
    const made = await news(a.c);
    expect(made.at(-1)).toEqual({ t: 'did', did: { kind: 'made', item: 'coat', count: 1 } });
    expect(made.map(m => m.t)).toEqual(['bench', 'did']);
    a.c.send({ t: 'mend', x: 1, y: 1, slot: 'shirt' });
    expect((await news(a.c)).at(-1)).toEqual({ t: 'did', did: { kind: 'mended', item: 'coat' } });
    // One cloth left: not enough for either.
    a.c.send({ t: 'craft', x: 1, y: 1, recipe: 'coat' });
    expect(await news(a.c)).toEqual([{ t: 'refused', action: 'craft', reason: 'missing' }]);
  });

  it('closes on a feed or discard whose count breaks the rules of the protocol', async () => {
    for (const bad of [
      { t: 'feed', x: 4, y: 2, slot: 0, count: 0 }, { t: 'feed', x: 4, y: 2, slot: 0, count: FEED_MAX + 1 }, { t: 'feed', x: 4, y: 2, slot: 0, count: 2.5 },
      { t: 'discard', slot: 0, count: 0 }, { t: 'discard', slot: 0, count: '1' },
    ]) {
      const a = await enter({ bag: [{ item: 'resin', count: 3 }] });
      a.c.send(JSON.stringify(bad));
      expect(await a.c.next('error')).toMatchObject({ code: 'bad_message' });
      expect((await a.c.closed).code).toBe(1008);
    }
  });
});
