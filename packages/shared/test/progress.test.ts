import { describe, expect, it } from 'vitest';
import {
  ENERGY_MAX, ENERGY_PER_LEVEL, LEVEL_MAX, RESTED_EVERY_MS, RESTED_MAX, XP_CURVE, cleanRested, emptyStash, gift, itemIndex, levelOf, maxEnergy, openInStash, progressOf, restAfter, restFor,
  spendRest, stashList, store, storeLive, takeOut, turnedInto, usedUp, type ItemsData, type Stash,
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
  it('takes a live find in as the plain item it becomes, with its XP, and leaves what was taken out alone', () => {
    const before = { items: { shard: 1 }, out: { shard: 2 } };
    expect(storeLive(before, 'shard', 35)).toEqual({ stash: { items: { shard: 2 }, out: { shard: 2 } }, xp: 35 });
    expect(before).toEqual({ items: { shard: 1 }, out: { shard: 2 } });
  });

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

  it('counts what something taken out of it turned into as taken out in its place, so it earns nothing brought back', () => {
    // A strange object taken out, looked at, turns into two shards: the shards are owed now, not the strange object.
    const out = takeOut({ items: { odd: 2 }, out: {} }, 'odd', 2).stash;
    const after = turnedInto(out, 'odd', { item: 'shard', count: 2 });
    expect(after).toEqual({ items: {}, out: { odd: 1, shard: 2 } });
    expect(store(after, [{ item: 'shard', count: 2 }], items).xp).toBe(0);
    // One found out there owes nothing: what it turns into earns its XP.
    expect(turnedInto(emptyStash(), 'odd', { item: 'shard', count: 2 })).toEqual(emptyStash());
    expect(store(emptyStash(), [{ item: 'shard', count: 2 }], items).xp).toBe(24);
  });

  it('keeps the pieces of the gear in it, as worn and with their quirks, whatever else goes in or out', () => {
    // A worn-down coat and an anomalous cap with its quirk, beside some shards (one of them taken out).
    const pieces = { coat: [{ cond: 0.3 }], cap: [{ cond: 1, quirk: 'hum' as const }] };
    const s: Stash = { items: { coat: 1, cap: 1, shard: 2 }, out: { shard: 1 }, pieces };
    const kept = (after: Stash) => expect(after.pieces).toEqual(pieces);
    kept(store(s, [{ item: 'shard', count: 3 }], items).stash);
    kept(storeLive(s, 'shard', 40).stash);
    kept(takeOut(s, 'shard', 1).stash);
    kept(usedUp(s, 'shard', 1));
    kept(turnedInto(s, 'shard', { item: 'cap', count: 1 }));
    kept(gift(s, [{ item: 'cap', count: 2 }], items));
    kept(openInStash({ ...s, items: { ...s.items, box: 1 } }, 'box', [{ item: 'shard', count: 1 }], items)!);
    // Copies: a later change to one stash's pieces never reaches the other's.
    const after = store(s, [{ item: 'cap', count: 1 }], items).stash;
    after.pieces!.coat![0]!.cond = 1;
    expect(s.pieces!.coat![0]!.cond).toBe(0.3);
  });
});

describe('rest, while away', () => {
  const HOUR = 3_600_000, DAY = 24 * HOUR;

  it('fills one XP of the cup for every 20 minutes away, whole ones only', () => {
    expect(RESTED_EVERY_MS).toBe(20 * 60_000);
    expect(restFor(0)).toBe(0);
    expect(restFor(19 * 60_000)).toBe(0);
    expect(restFor(20 * 60_000)).toBe(1);
    expect(restFor(59 * 60_000)).toBe(2);
    expect(restFor(8 * HOUR)).toBe(24);
    expect(restAfter(10, 2 * HOUR)).toBe(16);
  });

  it('holds three days\' worth at most, 216 XP, however long you stay away or however much it held', () => {
    expect(RESTED_MAX).toBe(216);
    expect(restFor(3 * DAY)).toBe(216);
    expect(restFor(400 * DAY)).toBe(216);
    expect(restAfter(0, 3 * DAY - 20 * 60_000)).toBe(215);
    expect(restAfter(200, DAY)).toBe(216);
    expect(restAfter(216, HOUR)).toBe(216);
  });

  it('counts time that runs backwards, and a cup saved wrong, as nothing', () => {
    expect(restFor(-DAY)).toBe(0);
    expect(restFor(Number.NaN)).toBe(0);
    expect(restAfter(30, -DAY)).toBe(30);
    for (const bad of [-5, Number.NaN, Infinity, '40', null, undefined]) expect(cleanRested(bad), String(bad)).toBe(0);
    expect(cleanRested(12.7)).toBe(12);
    expect(cleanRested(9000)).toBe(RESTED_MAX);
    expect(restAfter(9000, HOUR)).toBe(RESTED_MAX);
  });

  it('fills faster only when a play-test says so', () => {
    expect(restFor(30_000, 1000)).toBe(30);
    expect(restFor(10 * DAY, 1000)).toBe(RESTED_MAX);
    expect(restAfter(5, 12_000, 1000)).toBe(17);
  });

  it('doubles what stashing earns while the cup holds any, the extra out of it', () => {
    expect(spendRest(12, 140)).toEqual({ gained: 24, fromRest: 12, cup: 128 });
    expect(spendRest(12, 12)).toEqual({ gained: 24, fromRest: 12, cup: 0 });
  });

  it('never pays more than the cup holds, and an empty cup pays nothing', () => {
    expect(spendRest(40, 5)).toEqual({ gained: 45, fromRest: 5, cup: 0 });
    expect(spendRest(40, 0)).toEqual({ gained: 40, fromRest: 0, cup: 0 });
  });

  it('is left alone by what earns nothing: a parcel, a lockbox\'s contents, what comes back after being taken out', () => {
    expect(spendRest(0, 140)).toEqual({ gained: 0, fromRest: 0, cup: 140 });
    // A parcel goes in as a gift, and taken out and brought back it earns nothing: nothing to double.
    const gifted = gift(emptyStash(), [{ item: 'shard', count: 3 }], items);
    const out = takeOut(gifted, 'shard', 3).stash;
    expect(spendRest(store(out, [{ item: 'shard', count: 3 }], items).xp, 140)).toEqual({ gained: 0, fromRest: 0, cup: 140 });
    // What was never home counts, and counts double.
    expect(spendRest(store(emptyStash(), [{ item: 'shard', count: 2 }], items).xp, 140)).toEqual({ gained: 48, fromRest: 24, cup: 116 });
  });

  it('shows with where you stand, and not at all when the cup is empty', () => {
    expect(progressOf(40, 140)).toEqual({ xp: 40, level: 2, from: XP_CURVE, to: XP_CURVE * 4, maxEnergy: ENERGY_MAX + ENERGY_PER_LEVEL, rested: 140 });
    expect(progressOf(40, 0)).toEqual(progressOf(40));
    expect(progressOf(40).rested).toBeUndefined();
  });
});
