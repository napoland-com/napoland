import { describe, expect, it } from 'vitest';
import {
  RESIST_MAX, UPGRADE_MAX, UPGRADE_STEP, itemIndex, nextUpgrade, resistOf, upgradable, upgradeChance, upgradeFactor, validateItems, wearSeconds, type ItemsData,
} from '../src';

const data: ItemsData = {
  version: 1,
  items: [
    { id: 'coat', name: 'Coat', kind: 'gear', stack: 1, text: 'Dry.', slot: 'shirt', tier: 'sturdy', resist: { wind: 0.35, cold: 0.1 } },
    { id: 'halo', name: 'Halo', kind: 'gear', stack: 1, text: 'Hums.', slot: 'cap', tier: 'anomalous', resist: { radiation: 0.5, cold: 0.3 } },
    { id: 'boots', name: 'Boots', kind: 'gear', stack: 1, text: 'Tall.', slot: 'shoes', tier: 'expedition', resist: { cold: 0.4 } },
    { id: 'rag', name: 'Rag', kind: 'gear', stack: 1, text: 'Old.', slot: 'cap', tier: 'worn' },
    { id: 'pack', name: 'Pack', kind: 'gear', stack: 1, text: 'Big.', slot: 'bag', tier: 'sturdy', bag: 12 },
    { id: 'cloth', name: 'Cloth', kind: 'resource', stack: 10, text: 'Dry.' },
  ],
  finds: [],
  wear: { sturdy: 5400, anomalous: 10800 },
  upgrades: [{ needs: [{ item: 'cloth', count: 2 }] }, { needs: [{ item: 'cloth', count: 3 }], chance: 0.5 }],
};
const items = itemIndex(data);

describe('upgrades', () => {
  it('make a piece resist 5% more of what it resists and last 5% longer out there, a level at a time', () => {
    expect(UPGRADE_STEP).toBe(0.05);
    expect([0, 1, 6, 9].map(upgradeFactor)).toEqual([1, 1.05, 1.3, 1.45]);
    // Never past the top, never below nothing.
    expect(upgradeFactor(12)).toBe(1.45);
    expect(upgradeFactor(-3)).toBe(1);
    expect(resistOf({ shirt: 'coat' }, items, { shirt: { cond: 1, level: 1 } })).toMatchObject({ wind: 0.368, cold: 0.105 });
    expect(resistOf({ shirt: 'coat' }, items, { shirt: { cond: 1, level: 9 } }).wind).toBeCloseTo(0.5075, 3);
    // Worn down, a level still counts, as a share of what is left.
    expect(resistOf({ shirt: 'coat' }, items, { shirt: { cond: 0.125, level: 4 } }).wind).toBeCloseTo(0.35 * 0.5 * 1.2, 3);
    expect(wearSeconds(items.get('coat'), data.wear, 4)).toBeCloseTo(5400 * 1.2, 6);
    expect(wearSeconds(items.get('coat'), data.wear)).toBe(5400);
    // What never wears still never wears.
    expect(wearSeconds(items.get('pack'), data.wear, 9)).toBeUndefined();
  });

  it('never make anyone immune: resistances still stop at 75% in all', () => {
    const top = { cond: 1, level: 9 };
    // 0.3 and 0.4 cold, both at +9: 1.015, held at 75%.
    expect(resistOf({ cap: 'halo', shoes: 'boots' }, items, { cap: top, shoes: top }).cold).toBe(RESIST_MAX);
    expect(resistOf({ cap: 'halo' }, items, { cap: top }).radiation).toBeCloseTo(0.725, 3);
  });

  it('go one level at a time up to +9, always up to +6 and then by the odds the data gives', () => {
    expect(nextUpgrade(0, data.upgrades)).toEqual({ needs: [{ item: 'cloth', count: 2 }] });
    expect(upgradeChance(nextUpgrade(0, data.upgrades)!)).toBe(1);
    expect(upgradeChance(nextUpgrade(1, data.upgrades)!)).toBe(0.5);
    // Past what the data lists, and at the top whatever it lists, there is no next level.
    expect(nextUpgrade(2, data.upgrades)).toBeUndefined();
    expect(nextUpgrade(UPGRADE_MAX, Array.from({ length: 12 }, () => ({ needs: [{ item: 'cloth', count: 1 }] })))).toBeUndefined();
    expect(nextUpgrade(0, undefined)).toBeUndefined();
  });

  it('are for gear of every tier but worn clothes, and never for a bag', () => {
    expect(['coat', 'halo', 'boots', 'rag', 'pack', 'cloth'].map(id => upgradable(items.get(id)))).toEqual([true, true, true, false, false, false]);
    expect(upgradable(undefined)).toBe(false);
  });

  it('are checked in the content: real items, whole counts, odds between nothing and always, nine levels at most', () => {
    const errors = (upgrades: unknown) => validateItems({ ...data, upgrades } as ItemsData, []).filter(p => p.level === 'error' && p.message.startsWith('upgrades')).map(p => p.message);
    expect(errors(data.upgrades)).toEqual([]);
    expect(errors([{ needs: [] }, { needs: [{ item: 'glue', count: 1 }] }, { needs: [{ item: 'cloth', count: 0.5 }], chance: 1.5 }])).toEqual([
      'upgrades: +1 costs nothing', 'upgrades: +2 needs glue, which is not an item', 'upgrades: +3: each need is a whole number from 1', 'upgrades: +3: chance is a share above 0, at most 1',
    ]);
    expect(errors(Array.from({ length: 10 }, () => ({ needs: [{ item: 'cloth', count: 1 }] })))).toEqual(['upgrades: at most 9 levels']);
    // A tool is yours for good: nothing is paid with one.
    const withTool = { ...data, items: [...data.items, { id: 'lamp', name: 'Lamp', kind: 'tool' as const, stack: 1, text: 'Bright.', icon: 'map' as const }], upgrades: [{ needs: [{ item: 'lamp', count: 1 }] }] };
    expect(validateItems(withTool, []).filter(p => p.level === 'error' && p.message.startsWith('upgrades')).map(p => p.message)).toEqual(['upgrades: +1 needs lamp, a tool: tools are never used up']);
  });
});
