import { describe, expect, it } from 'vitest';
import {
  ENERGY_MAX, ENERGY_PER_LEVEL, LEVEL_MAX, XP_CURVE, emptyStash, itemIndex, levelOf, maxEnergy, progressOf, stashList, store, takeOut, usedUp, type ItemsData,
} from '../src';

const data: ItemsData = {
  version: 1,
  items: [
    { id: 'cap', name: 'Glowcap', kind: 'resource', stack: 20, text: 'Glows.', xp: 1 },
    { id: 'shard', name: 'Shard', kind: 'resource', stack: 5, text: 'Warm.', xp: 12 },
    { id: 'pebble', name: 'Pebble', kind: 'resource', stack: 5, text: 'Plain.' },
  ],
  finds: [],
};
const items = itemIndex(data);

describe('levels', () => {
  it('follow the XP curve, up to the top level', () => {
    expect(levelOf(0)).toBe(1);
    expect(levelOf(XP_CURVE - 1)).toBe(1);
    expect(levelOf(XP_CURVE)).toBe(2);
    expect(levelOf(XP_CURVE * 4)).toBe(3);
    expect(levelOf(1e9)).toBe(LEVEL_MAX);
  });

  it('each raise the energy bar', () => {
    expect(maxEnergy(1)).toBe(ENERGY_MAX);
    expect(maxEnergy(3)).toBe(ENERGY_MAX + 2 * ENERGY_PER_LEVEL);
    expect(maxEnergy(99)).toBe(maxEnergy(LEVEL_MAX));
  });

  it('show where you stand, and nothing to reach at the top', () => {
    expect(progressOf(40)).toEqual({ xp: 40, level: 2, from: XP_CURVE, to: XP_CURVE * 4, maxEnergy: ENERGY_MAX + ENERGY_PER_LEVEL });
    expect(progressOf(1e9).to).toBeNull();
  });
});

describe('the stash', () => {
  it('earns the XP of what goes in', () => {
    const r = store(emptyStash(), [{ item: 'cap', count: 10 }, { item: 'shard', count: 2 }, { item: 'pebble', count: 3 }], items);
    expect(r.xp).toBe(10 + 24);
    expect(stashList(r.stash, data.items)).toEqual([{ item: 'cap', count: 10 }, { item: 'shard', count: 2 }, { item: 'pebble', count: 3 }]);
  });

  it('earns nothing again for what was taken out and comes back, but does for new finds', () => {
    let s = store(emptyStash(), [{ item: 'shard', count: 3 }], items).stash;
    const out = takeOut(s, 'shard', 2);
    expect(out.taken).toBe(2);
    s = out.stash;
    expect(s).toEqual({ items: { shard: 1 }, out: { shard: 2 } });
    // Both back, and one new: only the new one counts.
    const back = store(s, [{ item: 'shard', count: 3 }], items);
    expect(back.xp).toBe(12);
    expect(back.stash).toEqual({ items: { shard: 4 }, out: {} });
  });

  it('forgets what was used up after it came out, so new finds count in full', () => {
    let s = takeOut(store(emptyStash(), [{ item: 'shard', count: 2 }], items).stash, 'shard', 2).stash;
    s = usedUp(s, 'shard', 1);
    expect(s.out).toEqual({ shard: 1 });
    expect(usedUp(s, 'shard', 5).out).toEqual({});
    // Nothing out: nothing changes.
    expect(usedUp(emptyStash(), 'cap', 3)).toEqual(emptyStash());
  });

  it('gives out only what it holds', () => {
    const s = store(emptyStash(), [{ item: 'cap', count: 3 }], items).stash;
    expect(takeOut(s, 'cap', 10).taken).toBe(3);
    expect(takeOut(s, 'shard', 1)).toEqual({ stash: s, taken: 0 });
  });
});
