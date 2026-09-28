/**
 * The stash keeps its gear piece by piece, over real WebSockets: putting something in, taking something
 * out, drinking or throwing away what came out of it never resets how worn a stored piece is, nor rolls
 * its quirk again. The fixture house with a chest at 3,1 (stand at 3,2, facing up); dice that always
 * roll 0, so a quirk rolled again would be the first one, not the one it had.
 */
import { describe, expect, it } from 'vitest';
import { QUIRKS, TileMap, type ItemsData, type Stash } from '@napoland/shared';
import { fixtureMaps, houseData, itemsData } from './fixtures';
import { setup } from './helpers';

const maps = () => [
  ...fixtureMaps().filter(m => m.data.id !== 'house'),
  new TileMap({ ...houseData(), objects: [...houseData().objects, { kind: 'chest', x: 3, y: 1 }] }),
];
const items = (): ItemsData => ({
  ...itemsData(),
  items: [
    ...itemsData().items.map(i => ({ ...i, xp: 2 })),
    { id: 'coat', name: 'Coat', kind: 'gear', stack: 1, text: 'Warm.', slot: 'shirt', tier: 'sturdy', resist: { cold: 0.2 } },
    { id: 'odd-cap', name: 'Odd cap', kind: 'gear', stack: 1, text: 'It hums.', slot: 'cap', tier: 'anomalous', resist: { radiation: 0.5 } },
  ],
  wear: { sturdy: 5400, anomalous: 10800 },
  quirks: QUIRKS.map(id => ({ id, name: id, text: `${id}.` })),
});

describe('the chest behind steps a slow network bunched up', () => {
  let now = 1_000_000;
  const { enter } = setup({ maps: maps(), items: items(), weather: 'overcast', clock: () => now });

  it('opens once the steps before the look are walked', async () => {
    const a = await enter({ map: 'house', x: 2, y: 3, dir: 'right', stash: { items: { moss: 2 }, out: {} } });
    await a.c.settle();
    // Both steps and the A at the chest arrive together: the first step starts, the second waits its turn.
    a.c.send({ t: 'step', dir: 'right', seq: 1 });
    a.c.send({ t: 'step', dir: 'up', seq: 2 });
    a.c.send({ t: 'chest', x: 3, y: 1 });
    await a.c.next('step', m => m.seq === 1);
    now += 400;
    await a.c.next('step', m => m.seq === 2);
    expect(await a.c.next('chest')).toEqual({ t: 'chest', stash: [{ item: 'moss', count: 2 }] });
  });
});

describe('the stash keeps its gear piece by piece', () => {
  const { ctx, enter } = setup({ maps: maps(), items: items(), weather: 'overcast', rng: () => 0 });
  // Not the quirk dice that always roll 0 would give: rolled again, it would change.
  const quirk = QUIRKS.at(-1)!;
  const pieces = { coat: [{ cond: 0.3 }], 'odd-cap': [{ cond: 0.8, quirk }] };

  it('whatever else goes in or out of it, or is used up after it came out', async () => {
    expect(quirk).not.toBe(QUIRKS[0]);
    const stash: Stash = { items: { coat: 1, 'odd-cap': 1, tea: 2 }, out: {}, pieces };
    const a = await enter({ map: 'house', x: 3, y: 2, dir: 'up', stash, bag: [{ item: 'moss', count: 2 }, { item: 'nail', count: 3 }] });
    const kept = async (what: string) => {
      await a.c.settle();
      expect(ctx.server.world.get(a.id)!.stash!.pieces, what).toEqual(pieces);
    };
    await kept('when joining');
    a.c.send({ t: 'store', x: 3, y: 1, slot: 0 });
    await kept('after putting moss in');
    a.c.send({ t: 'take', x: 3, y: 1, item: 'tea', count: 2 });
    await kept('after taking tea out');
    a.c.send({ t: 'use', slot: 1 });
    await kept('after drinking a tea that came out of it');
    a.c.send({ t: 'discard', slot: 1 });
    await kept('after throwing away a tea that came out of it');
    a.c.send({ t: 'store', x: 3, y: 1 });
    await kept('after putting everything in');
    // And the chest shows them as they are.
    a.c.send({ t: 'chest', x: 3, y: 1 });
    const { stash: shown } = await a.c.next('chest');
    expect(shown.filter(s => s.piece)).toEqual([{ item: 'coat', count: 1, piece: { cond: 0.3 } }, { item: 'odd-cap', count: 1, piece: { cond: 0.8, quirk } }]);
    expect(ctx.storage.get(a.id)!.stash!.pieces).toEqual(pieces);
  });
});

describe('what a strange object turns into', () => {
  /** A strange object that turns into a feather, worth 25 XP at home, and one that turns into an odd cap, worth 40. */
  const odd = (): ItemsData => ({
    ...items(),
    items: [
      ...items().items.map(i => (i.id === 'odd-cap' ? { ...i, xp: 40 } : i)),
      { id: 'odd', name: 'Strange object', kind: 'resource', stack: 1, xp: 15, text: '?', use: { identify: true }, reveals: [{ item: 'feather', count: 1, weight: 1 }] },
      { id: 'feather', name: 'Hollow feather', kind: 'charm', stack: 1, xp: 25, text: 'Light.', charm: { load: 0.75 }, about: 'Your bag feels lighter.' },
      { id: 'odd-box', name: 'Humming box', kind: 'resource', stack: 1, xp: 15, text: '?', use: { identify: true }, reveals: [{ item: 'odd-cap', count: 1, weight: 1 }] },
    ],
  });
  const { ctx, enter } = setup({ maps: maps(), items: odd(), weather: 'overcast', rng: () => 0 });

  it('earns nothing brought home when the strange object came out of the stash, as the strange object would not have', async () => {
    // In the house, in town: light enough to look closely.
    const a = await enter({ map: 'house', x: 3, y: 2, dir: 'up', stash: { items: { odd: 1 }, out: {} } });
    a.c.send({ t: 'take', x: 3, y: 1, item: 'odd', count: 1 });
    a.c.send({ t: 'use', slot: 0 });
    expect((await a.c.next('did')).did).toMatchObject({ kind: 'used', item: 'odd', into: { item: 'feather', count: 1 } });
    expect(ctx.server.world.get(a.id)!.stash!.out).toEqual({ feather: 1 });
    a.c.send({ t: 'store', x: 3, y: 1 });
    expect((await a.c.next('progress')).gained).toBe(0);
    expect(ctx.server.world.get(a.id)!.stash).toMatchObject({ items: { feather: 1 }, out: {} });
  });

  it('earns nothing either when it turned into a piece of gear, worn at once and taken off at the chest', async () => {
    const a = await enter({ map: 'house', x: 3, y: 2, dir: 'up', stash: { items: { 'odd-box': 1 }, out: {} } });
    a.c.send({ t: 'take', x: 3, y: 1, item: 'odd-box', count: 1 });
    a.c.send({ t: 'use', slot: 0 });
    expect((await a.c.next('did')).did).toMatchObject({ kind: 'used', item: 'odd-box', into: { item: 'odd-cap', count: 1, piece: { cond: 1 } } });
    a.c.send({ t: 'wear', slot: 0 });
    // Home off your back, as a piece that came out of the stash would be.
    a.c.send({ t: 'unequip', x: 3, y: 1, slot: 'cap' });
    await a.c.settle();
    const home = ctx.server.world.get(a.id)!;
    expect(home.xp ?? 0).toBe(0);
    expect(home.stash).toMatchObject({ items: { 'odd-cap': 1 }, out: {} });
  });

  it('earns its XP when the strange object was found out there', async () => {
    const a = await enter({ map: 'house', x: 3, y: 2, dir: 'up', bag: [{ item: 'odd', count: 1 }] });
    a.c.send({ t: 'use', slot: 0 });
    await a.c.next('did');
    a.c.send({ t: 'store', x: 3, y: 1 });
    expect((await a.c.next('progress')).gained).toBe(25);
  });
});
