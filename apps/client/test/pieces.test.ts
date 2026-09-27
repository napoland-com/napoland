import { describe, expect, it } from 'vitest';
import type { ItemsData } from '@napoland/shared';
import { Items, conditionText, mendViews, quirkNames, slotViews, wearText, wornViews } from '../src/items';

const items = new Items({
  version: 1,
  items: [
    { id: 'coat', name: 'Raincoat', kind: 'gear', stack: 1, text: 'Yellow.', slot: 'shirt', tier: 'sturdy', resist: { wind: 0.3 } },
    { id: 'boots', name: 'Rubber boots', kind: 'gear', stack: 1, text: 'Tall.', slot: 'shoes', tier: 'sturdy' },
    { id: 'halo', name: 'Halo', kind: 'gear', stack: 1, text: 'Odd.', slot: 'cap', tier: 'anomalous' },
    { id: 'pack', name: 'Pack', kind: 'gear', stack: 1, text: 'Big.', slot: 'bag', tier: 'worn', bag: 8 },
    { id: 'cloth', name: 'Cloth scraps', kind: 'resource', stack: 10, text: 'Dry.' },
  ],
  finds: [],
  wear: { sturdy: 100, anomalous: 100 },
  mend: { sturdy: [{ item: 'cloth', count: 2 }] },
  quirks: [{ id: 'hum', name: 'Humming', text: 'It hums before a surge.' }],
} satisfies ItemsData);
const gear = { shirt: 'coat', shoes: 'boots', cap: 'halo', bag: 'pack' };
const worn = { shirt: { cond: 0.4 }, shoes: { cond: 0 }, cap: { cond: 1, quirk: 'hum' as const }, bag: { cond: 1 } };

describe('pieces in the interface', () => {
  it('say how much is left, and what needs mending', () => {
    expect(conditionText(1)).toBe('As good as new');
    expect(conditionText(0.4)).toBe('40% left');
    expect(conditionText(0)).toBe('Worn out: mend it at the workbench');
    expect(conditionText(0.1, false)).toBe('As good as new');
    expect(wearText(gear, worn, items)).toBe('Raincoat 40%, Rubber boots worn out');
    expect(wearText(gear, { cap: { cond: 1 } }, items)).toBeNull();
    expect(quirkNames(worn, items)).toEqual(['Humming']);
  });

  it('show each piece in the stash on its own, with its condition and which of its kind it is', () => {
    const v = slotViews([{ item: 'coat', count: 1, piece: { cond: 1 } }, { item: 'coat', count: 1, piece: { cond: 0.4 } }, { item: 'halo', count: 1, piece: { cond: 1, quirk: 'hum' } }, { item: 'cloth', count: 3 }], items);
    expect(v.map(s => [s.item, s.n, s.cond])).toEqual([['coat', 0, 1], ['coat', 1, 0.4], ['halo', 0, 1], ['cloth', undefined, undefined]]);
    expect(v[1]!.facts[0]).toBe('40% left');
    expect(v[2]!.text).toBe('Odd. Humming: It hums before a surge.');
  });

  it('offer mending for what has worn down and can be mended, against what the stash holds', () => {
    const rows = mendViews(gear, worn, [{ item: 'cloth', count: 3 }], items);
    expect(rows.map(r => [r.id, r.can, r.act])).toEqual([['mend:shirt', true, 'Mend'], ['mend:shoes', true, 'Mend']]);
    expect(mendViews(gear, worn, [{ item: 'cloth', count: 1 }], items).every(r => !r.can)).toBe(true);
    expect(wornViews(gear, items, worn).filter(w => w).map(w => [w!.slot, w!.cond, w!.quirk])).toEqual([['cap', 1, 'Humming'], ['shirt', 0.4, undefined], ['shoes', 0, undefined], ['bag', undefined, undefined]]);
  });
});
