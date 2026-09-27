import { describe, expect, it } from 'vitest';
import {
  QUIRKS, WEAR_FADES, fitPieces, gearEnergy, itemIndex, mendCost, newPiece, pieceFactor, resistOf, stashList, validateItems, wearSeconds, type ItemsData,
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
