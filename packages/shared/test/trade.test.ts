import { describe, expect, it } from 'vitest';
import {
  emptyStash, itemIndex, keptOffer, offerFrom, offerView, sameOffer, store, swapOffers, takeOffer, takeOut, tradeable, traded, type BagSlot, type ItemsData, type Stash,
} from '../src';

const data: ItemsData = {
  version: 1,
  items: [
    { id: 'resin', name: 'Fir resin', kind: 'resource', stack: 20, text: 'Sticky.', xp: 2 },
    { id: 'shard', name: 'Shard', kind: 'resource', stack: 5, text: 'Warm.', xp: 12 },
    { id: 'live', name: 'Live shard', kind: 'resource', stack: 1, text: 'Humming.', xp: 12, live: { xp: 40, fresh: 240, fade: 5, into: 'shard' } },
    { id: 'coat', name: 'Raincoat', kind: 'gear', stack: 1, text: 'Yellow.', slot: 'shirt', tier: 'sturdy', resist: { wind: 0.35 }, xp: 10 },
    { id: 'map', name: 'Map', kind: 'tool', stack: 1, text: 'Drawn by hand.', icon: 'map' },
    { id: 'box', name: 'Lockbox', kind: 'sealed', stack: 1, text: 'Sealed.' },
  ],
  finds: [],
};
const items = itemIndex(data);
const coat = (cond: number, level?: number): BagSlot => ({ item: 'coat', count: 1, piece: { cond, ...(level ? { level } : {}) } });

describe('an offer', () => {
  const bag: BagSlot[] = [{ item: 'resin', count: 20 }, coat(0.8, 2), { item: 'resin', count: 5 }, { item: 'live', count: 1, since: 1000 }, coat(1)];

  it('takes stacks by item, never more than the bag carries, and each piece and live find on its own', () => {
    expect(offerFrom(bag, [{ slot: 0, count: 12 }, { slot: 2, count: 9 }, { slot: 1, count: 1 }, { slot: 3, count: 1 }], items)).toEqual([
      { item: 'resin', count: 21 }, coat(0.8, 2), { item: 'live', count: 1, since: 1000 },
    ]);
    expect(offerFrom(bag, [{ slot: 0, count: 999 }], items)).toEqual([{ item: 'resin', count: 25 }]);
    // A piece is one, however many were asked for.
    expect(offerFrom(bag, [{ slot: 4, count: 3 }], items)).toEqual([coat(1)]);
  });

  it('leaves out an empty slot, a slot picked twice, and what cannot change hands', () => {
    expect(offerFrom(bag, [{ slot: 9, count: 1 }, { slot: 1, count: 1 }, { slot: 1, count: 1 }], items)).toEqual([coat(0.8, 2)]);
    const odd: BagSlot[] = [{ item: 'map', count: 1 }, { item: 'box', count: 1 }];
    expect(offerFrom(odd, [{ slot: 0, count: 1 }, { slot: 1, count: 1 }], items)).toEqual([]);
    expect([tradeable(items.get('map')), tradeable(items.get('box')), tradeable(items.get('coat')), tradeable(undefined)]).toEqual([false, false, true, false]);
  });

  it('keeps what the bag still holds when it changes', () => {
    const offer = offerFrom(bag, [{ slot: 0, count: 22 }, { slot: 1, count: 1 }, { slot: 3, count: 1 }], items);
    // A watcher took 4 resin, the live shard faded into a plain one, and the raincoat is still there.
    const after: BagSlot[] = [{ item: 'resin', count: 20 }, coat(0.8, 2), { item: 'resin', count: 1 }, { item: 'shard', count: 1 }, coat(1)];
    expect(keptOffer(after, offer)).toEqual([{ item: 'resin', count: 21 }, coat(0.8, 2)]);
    expect(sameOffer(keptOffer(bag, offer), offer)).toBe(true);
    expect(sameOffer(keptOffer(after, offer), offer)).toBe(false);
    // Two pieces alike are two: the bag must hold both.
    const two = [coat(1), coat(1)];
    expect(keptOffer([coat(1)], two)).toEqual([coat(1)]);
  });

  it('is heard without when a live find was picked, and each piece as the bag shows it', () => {
    expect(offerView([{ item: 'live', count: 1, since: 1000 }, { item: 'coat', count: 1, piece: { cond: 0.123456, quirk: 'hum', level: 3 } }])).toEqual([
      { item: 'live', count: 1 }, { item: 'coat', count: 1, piece: { cond: 0.123, quirk: 'hum', level: 3 } },
    ]);
  });
});

describe('a swap', () => {
  it('takes stacks from the last slots first, and the very piece and live find offered', () => {
    const bag: BagSlot[] = [{ item: 'resin', count: 20 }, coat(0.5), { item: 'resin', count: 5 }, coat(1), { item: 'live', count: 1, since: 7 }];
    expect(takeOffer(bag, [{ item: 'resin', count: 8 }, coat(1), { item: 'live', count: 1, since: 7 }])).toEqual([{ item: 'resin', count: 17 }, coat(0.5)]);
    expect(takeOffer(bag, [{ item: 'resin', count: 26 }])).toBeUndefined();
    expect(takeOffer(bag, [coat(0.9)])).toBeUndefined();
    expect(takeOffer(bag, [{ item: 'live', count: 1, since: 8 }])).toBeUndefined();
  });

  it('moves both sides in one step, each piece as it was', () => {
    const a: BagSlot[] = [{ item: 'resin', count: 6 }, coat(0.8, 2)];
    const b: BagSlot[] = [{ item: 'shard', count: 3 }];
    const r = swapOffers(a, b, [coat(0.8, 2), { item: 'resin', count: 2 }], [{ item: 'shard', count: 3 }], 8, 8, items);
    expect(r).toEqual({
      ok: true, a: [{ item: 'resin', count: 4 }, { item: 'shard', count: 3 }], b: [coat(0.8, 2), { item: 'resin', count: 2 }],
      aGave: [coat(0.8, 2), { item: 'resin', count: 2 }], bGave: [{ item: 'shard', count: 3 }],
    });
    // A gift: one side gives nothing.
    expect(swapOffers(a, [], [{ item: 'resin', count: 6 }], [], 8, 8, items)).toMatchObject({ ok: true, a: [coat(0.8, 2)], b: [{ item: 'resin', count: 6 }] });
  });

  it('counts room after what each side gives, and moves nothing when a bag has none', () => {
    const full = (n: number): BagSlot[] => Array.from({ length: n }, (_, i) => ({ item: i % 2 ? 'resin' : 'shard', count: i % 2 ? 20 : 5 }));
    // Giving a slot away makes room for one coming in.
    expect(swapOffers(full(4), [coat(1)], [{ item: 'shard', count: 5 }], [coat(1)], 4, 8, items).ok).toBe(true);
    expect(swapOffers(full(4), [coat(1)], [], [coat(1)], 4, 8, items)).toEqual({ ok: false, why: 'room', side: 'a' });
    expect(swapOffers([coat(1)], full(4), [coat(1)], [], 8, 4, items)).toEqual({ ok: false, why: 'room', side: 'b' });
    // Resin tops up a stack that has room: no slot of its own needed.
    expect(swapOffers([{ item: 'resin', count: 5 }, { item: 'shard', count: 5 }], [{ item: 'resin', count: 9 }], [], [{ item: 'resin', count: 9 }], 2, 8, items).ok).toBe(true);
    expect(swapOffers([coat(1)], [], [coat(0.5)], [], 8, 8, items)).toEqual({ ok: false, why: 'gone', side: 'a' });
  });
});

describe('the stash after a trade', () => {
  const s = (items: Record<string, number>, out: Record<string, number>): Stash => ({ items, out });

  it('makes what the giver took out of their stash out for whoever gets it, never more than was given', () => {
    const [a, b] = traded(s({}, { resin: 5, coat: 1 }), s({ shard: 1 }, { shard: 1 }), [{ item: 'resin', count: 8 }, coat(1)], [{ item: 'shard', count: 1 }]);
    expect(a).toEqual(s({}, { shard: 1 }));
    expect(b).toEqual(s({ shard: 1 }, { resin: 5, coat: 1 }));
    // Of 3 given, 3 were out: the 2 left in the bag are the giver's own finds.
    expect(traded(s({}, { resin: 5 }), emptyStash(), [{ item: 'resin', count: 3 }], [])).toEqual([s({}, { resin: 2 }), s({}, { resin: 3 })]);
  });

  it('counts both ways from the stashes as they were, even for the same item', () => {
    const [a, b] = traded(s({}, { resin: 3 }), s({}, { resin: 1 }), [{ item: 'resin', count: 3 }], [{ item: 'resin', count: 2 }]);
    expect([a.out, b.out]).toEqual([{ resin: 1 }, { resin: 3 }]);
  });

  it('never lets XP be farmed by trading back and forth, and a fresh find given still earns it', () => {
    // Ana stashed 5 resin long ago (10 XP then), takes them out and gives them to Bo, with 3 she just found.
    let ana = store(emptyStash(), [{ item: 'resin', count: 5 }], items).stash, bo = emptyStash();
    ana = takeOut(ana, 'resin', 5).stash;
    [ana, bo] = traded(ana, bo, [{ item: 'resin', count: 8 }], []);
    // Bo stashes all 8: only the 3 fresh ones earn.
    let r = store(bo, [{ item: 'resin', count: 8 }], items);
    expect(r.xp).toBe(3 * 2);
    bo = r.stash;
    // Round and round: Bo takes them out and gives them back, Ana stashes them, and again. Nobody earns.
    for (let i = 0; i < 3; i++) {
      bo = takeOut(bo, 'resin', 8).stash;
      [bo, ana] = traded(bo, ana, [{ item: 'resin', count: 8 }], []);
      r = store(ana, [{ item: 'resin', count: 8 }], items);
      expect(r.xp).toBe(0);
      ana = takeOut(r.stash, 'resin', 8).stash;
      [ana, bo] = traded(ana, bo, [{ item: 'resin', count: 8 }], []);
      r = store(bo, [{ item: 'resin', count: 8 }], items);
      expect(r.xp).toBe(0);
      bo = r.stash;
    }
    expect([ana.out, bo.out]).toEqual([{}, {}]);
  });
});
