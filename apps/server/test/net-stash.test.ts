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
