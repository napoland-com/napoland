import { describe, expect, it } from 'vitest';
import {
  QUIRKS, WEAR_FADES, addAllToBag, fitPieces, gather, gearEnergy, halfOf, itemIndex, merge, mendCost, newPiece, pieceFactor, resistOf, stashList, store, takeOut, takePiece, usedUp,
  validateItems, wearSeconds, type BagSlot, type ItemsData,
} from '../src';

const data: ItemsData = {
  version: 1,
  items: [
    { id: 'coat', name: 'Coat', kind: 'gear', stack: 1, text: 'Warm.', slot: 'shirt', tier: 'sturdy', resist: { cold: 0.4 }, bonus: 8 },
    { id: 'rag', name: 'Rag', kind: 'gear', stack: 1, text: 'Old.', slot: 'cap', tier: 'worn' },
    { id: 'pack', name: 'Pack', kind: 'gear', stack: 1, text: 'Big.', slot: 'bag', tier: 'sturdy', bag: 12 },
    { id: 'halo', name: 'Halo', kind: 'gear', stack: 1, text: 'Hums.', slot: 'cap', tier: 'anomalous' },
    { id: 'cloth', name: 'Cloth', kind: 'resource', stack: 10, text: 'Dry.' },
  ],
  finds: [],
  wear: { sturdy: 100, anomalous: 300 },
  mend: { sturdy: [{ item: 'cloth', count: 2 }] },
  quirks: QUIRKS.map(id => ({ id, name: id, text: 'Odd.' })),
};
const items = itemIndex(data);

describe('pieces of gear', () => {
  it('protect fully until nearly worn out, then less and less, and not at all at 0', () => {
    expect(pieceFactor(1)).toBe(1);
    expect(pieceFactor(WEAR_FADES)).toBe(1);
    expect(pieceFactor(WEAR_FADES / 2)).toBeCloseTo(0.5, 10);
    expect(pieceFactor(0)).toBe(0);
    expect(resistOf({ shirt: 'coat' }, items, { shirt: { cond: WEAR_FADES / 2 } }).cold).toBeCloseTo(0.2, 10);
    expect(resistOf({ shirt: 'coat' }, items, { shirt: { cond: 0 } }).cold).toBe(0);
    expect(gearEnergy({ shirt: 'coat' }, items, { shirt: { cond: WEAR_FADES / 2 } })).toBe(4);
    expect(gearEnergy({ shirt: 'coat' }, items)).toBe(8);
  });

  it('wear out by their tier, except worn clothes and bags; they mend by their tier', () => {
    expect(wearSeconds(items.get('coat'), data.wear)).toBe(100);
    expect(wearSeconds(items.get('rag'), data.wear)).toBeUndefined();
    expect(wearSeconds(items.get('pack'), data.wear)).toBeUndefined();
    expect(mendCost(items.get('coat'), data.mend)).toEqual([{ item: 'cloth', count: 2 }]);
    expect(mendCost(items.get('halo'), data.mend)).toBeUndefined();
  });

  it('come new, anomalous ones with a quirk', () => {
    expect(newPiece(items.get('coat')!, () => 0.99)).toEqual({ cond: 1 });
    expect(newPiece(items.get('halo')!, () => 0.99)).toEqual({ cond: 1, quirk: QUIRKS.at(-1) });
  });

  it('lie in the stash as many as it counts, old ones kept, and list one by one', () => {
    const s = fitPieces({ items: { coat: 2, cloth: 3 }, out: {}, pieces: { coat: [{ cond: 0.5 }, { cond: 0.2 }, { cond: 0.1 }], cloth: [{ cond: 1 }] } }, items, () => 0);
    expect(s.pieces).toEqual({ coat: [{ cond: 0.5 }, { cond: 0.2 }] });
    expect(fitPieces({ items: { coat: 1, halo: 1 }, out: {} }, items, () => 0).pieces).toEqual({ coat: [{ cond: 1 }], halo: [{ cond: 1, quirk: QUIRKS[0] }] });
    expect(fitPieces({ items: { cloth: 1 }, out: {} }, items, () => 0)).toEqual({ items: { cloth: 1 }, out: {} });
    expect(stashList(s, data.items)).toEqual([{ item: 'coat', count: 1, piece: { cond: 0.5 } }, { item: 'coat', count: 1, piece: { cond: 0.2 } }, { item: 'cloth', count: 3 }]);
  });

  it('are checked in the content: wear times, mending costs and every quirk named', () => {
    // (The starter gear is not what this checks: these items have none.)
    const errors = (more: Partial<ItemsData>) => validateItems({ ...data, ...more }, []).filter(p => p.level === 'error' && !p.message.startsWith('the starter gear')).map(p => p.message);
    expect(errors({})).toEqual([]);
    expect(errors({ wear: { sturdy: 0 } })).toEqual(['wear: sturdy wears out after some seconds above 0']);
    expect(errors({ mend: { sturdy: [{ item: 'glue', count: 1 }] } })).toEqual(['mend: sturdy needs glue, which is not an item']);
    expect(errors({ quirks: [] })).toEqual(QUIRKS.map(q => `quirk ${q} has no name and text`));
  });
});

describe('pieces on the road', () => {
  const worn = { cond: 0.3 }, odd = { cond: 0.8, quirk: 'hum' as const };

  it('stay apart in a pile, each with its piece, while everything else joins up', () => {
    const bag: BagSlot[] = [{ item: 'cloth', count: 2 }, { item: 'coat', count: 1, piece: worn }, { item: 'cloth', count: 3 }, { item: 'coat', count: 1, piece: { cond: 1 } }, { item: 'halo', count: 1, piece: odd }];
    expect(gather(bag)).toEqual([{ item: 'cloth', count: 5 }, { item: 'coat', count: 1, piece: worn }, { item: 'coat', count: 1, piece: { cond: 1 } }, { item: 'halo', count: 1, piece: odd }]);
    // For "+2 Coat" over your head they are counted as ever.
    expect(merge(bag)).toEqual([{ item: 'cloth', count: 5 }, { item: 'coat', count: 2 }, { item: 'halo', count: 1 }]);
    // A copy: the pile never shares a piece with the bag it came from.
    expect(gather(bag)[1]!.piece).not.toBe(worn);
  });

  it('keep their piece in someone else\'s half of a pile, as any unit does', () => {
    const pile: BagSlot[] = [{ item: 'cloth', count: 2 }, { item: 'halo', count: 1, piece: odd }, { item: 'coat', count: 1, piece: worn }];
    // With these dice: one cloth and the halo.
    expect(halfOf(pile, () => 0)).toEqual([{ item: 'cloth', count: 1 }, { item: 'halo', count: 1, piece: odd }]);
    // Whatever the dice, every piece in a half is one of the pile's, as it was.
    for (const seed of [0.1, 0.35, 0.6, 0.99]) for (const s of halfOf(pile, () => seed)) if (s.piece) expect([odd, worn]).toContainEqual(s.piece);
  });

  it('go into a bag with their piece, a slot each, and what does not fit keeps its piece too', () => {
    const r = addAllToBag([{ item: 'cloth', count: 1 }], [{ item: 'coat', count: 1, piece: worn }, { item: 'halo', count: 1, piece: odd }], items, 2);
    expect(r.bag).toEqual([{ item: 'cloth', count: 1 }, { item: 'coat', count: 1, piece: worn }]);
    expect(r.left).toEqual([{ item: 'halo', count: 1, piece: odd }]);
  });

  it('come out of the stash one at a time, the one asked for, and count as taken out', () => {
    const s = { items: { coat: 2, cloth: 4 }, out: {}, pieces: { coat: [{ cond: 1 }, worn] } };
    const r = takePiece(s, 'coat', 1);
    expect(r).toEqual({ stash: { items: { coat: 1, cloth: 4 }, out: { coat: 1 }, pieces: { coat: [{ cond: 1 }] } }, piece: worn, taken: true });
    // The stash it came from is left alone.
    expect(s.pieces.coat).toHaveLength(2);
    // The last one takes its list with it; past the end is the last; nothing there is nothing.
    expect(takePiece(r.stash, 'coat', 5)).toEqual({ stash: { items: { cloth: 4 }, out: { coat: 2 } }, piece: { cond: 1 }, taken: true });
    expect(takePiece(r.stash, 'halo')).toEqual({ stash: r.stash, piece: undefined, taken: false });
  });

  it('go back into the stash as they are, after the pieces of their kind, paying off what was taken out', () => {
    const s = { items: { coat: 1 }, out: { coat: 1 }, pieces: { coat: [{ cond: 1 }] } };
    const worth = itemIndex({ ...data, items: data.items.map(i => (i.id === 'halo' ? { ...i, xp: 40 } : i)) });
    const r = store(s, [{ item: 'coat', count: 1, piece: worn }, { item: 'halo', count: 1, piece: odd }], worth);
    expect(r).toEqual({ stash: { items: { coat: 2, halo: 1 }, out: {}, pieces: { coat: [{ cond: 1 }, worn], halo: [odd] } }, xp: 40 });
  });

  it('stay in the stash as they are, whatever else goes in or out of it', () => {
    const s = { items: { coat: 1, cloth: 5 }, out: { cloth: 2 }, pieces: { coat: [worn] } };
    expect(takeOut(s, 'cloth', 2).stash.pieces).toEqual({ coat: [worn] });
    expect(usedUp(s, 'cloth', 1).pieces).toEqual({ coat: [worn] });
    expect(store(s, [{ item: 'cloth', count: 1 }], items).stash.pieces).toEqual({ coat: [worn] });
    expect(fitPieces(store(s, [{ item: 'cloth', count: 1 }], items).stash, items, () => 0).pieces).toEqual({ coat: [worn] });
  });
});
