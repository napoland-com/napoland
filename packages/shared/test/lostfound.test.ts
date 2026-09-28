/**
 * The lost and found's rules (lostfound.ts): what a pile owed its owner's stash as it fell, how a pile is
 * tied up to carry (never one bundle inside another), what a bundle was worth and the carrier's quarter of
 * it, that a bundle weighs what it holds and stays whole in piles and halves, that it never changes hands
 * or goes into a crate, and what content may say about the one bundle item.
 */
import { describe, expect, it } from 'vitest';
import {
  BUNDLE, CARRIER_SHARE, addAllToBag, bagLoad, bundleId, bundleWorth, bundlesIn, cacheTakes, carrierShare, gather, halfOf, itemIndex, namesOf, offerFrom, owedOf, packPile, slotKg, store,
  tradeable, validateItems, type BagSlot, type Bundle, type ItemDef, type ItemsData,
} from '../src';

const DEFS: ItemDef[] = [
  { id: 'moss', name: 'Moss', kind: 'resource', stack: 10, text: 'Soft.', xp: 2, weight: 0.5 },
  { id: 'nail', name: 'Nail', kind: 'resource', stack: 10, text: 'Bent.', xp: 3, weight: 0.2 },
  { id: 'coat', name: 'Coat', kind: 'gear', stack: 1, text: 'Warm.', slot: 'shirt', xp: 10, weight: 1 },
  { id: BUNDLE, name: 'Bundle', kind: 'bundle', stack: 1, text: 'Someone else\'s things.' },
];
const items = new Map(DEFS.map(d => [d.id, d]));
const pileOf = (items: BagSlot[], owed?: Record<string, number>) => ({ owner: 'ana', name: 'Ana', map: 'woods', x: 3, y: 6, droppedAt: 1000, items, ...(owed ? { owed } : {}) });

describe('what a pile owed', () => {
  it('is, of each item that fell, as many as the owner had taken out of their stash, and never more than fell', () => {
    const stash = { items: {}, out: { moss: 5, nail: 1, coat: 1 } };
    expect(owedOf(stash, [{ item: 'moss', count: 3 }, { item: 'nail', count: 4 }])).toEqual({ moss: 3, nail: 1 });
    expect(owedOf(undefined, [{ item: 'moss', count: 3 }])).toEqual({});
    // What a bundle in it holds is someone else's.
    const other: Bundle = { id: 'bo:1', owner: 'bo', name: 'Bo', map: 'woods', x: 1, y: 1, items: [{ item: 'coat', count: 1, piece: { cond: 1 } }], owed: {} };
    expect(owedOf(stash, [{ item: BUNDLE, count: 1, bundle: other }])).toEqual({});
  });
});

describe('a pile tied up to carry', () => {
  it('packs its owner\'s things into one bundle, pieces as they were, with what they owed, handed in once by its id', () => {
    const coat = { item: 'coat', count: 1, piece: { cond: 0.4, quirk: 'hum' as const, level: 2 } };
    const { bundle, others } = packPile(pileOf([{ item: 'moss', count: 3 }, coat], { moss: 1 }));
    expect(others).toEqual([]);
    expect(bundle).toEqual({
      item: BUNDLE, count: 1,
      bundle: { id: bundleId('ana', 1000), owner: 'ana', name: 'Ana', map: 'woods', x: 3, y: 6, items: [{ item: 'moss', count: 3 }, coat], owed: { moss: 1 } },
    });
    expect(bundleId('ana', 1000)).toBe('ana:1000');
  });

  it('never puts one bundle inside another: one that lay in the pile stays its own owner\'s, and a pile of only that packs nothing new', () => {
    const bos: Bundle = { id: 'bo:5', owner: 'bo', name: 'Bo', map: 'woods', x: 1, y: 1, items: [{ item: 'nail', count: 2 }], owed: {} };
    const mixed = packPile(pileOf([{ item: 'moss', count: 1 }, { item: BUNDLE, count: 1, bundle: bos }]));
    expect(mixed.bundle?.bundle?.items).toEqual([{ item: 'moss', count: 1 }]);
    expect(mixed.others).toEqual([{ item: BUNDLE, count: 1, bundle: bos }]);
    const only = packPile(pileOf([{ item: BUNDLE, count: 1, bundle: bos }]));
    expect(only).toEqual({ bundle: null, others: [{ item: BUNDLE, count: 1, bundle: bos }] });
  });

  it('counts all of a pile that remembers nothing as owed (one dropped before piles remembered): it earns the carrier nothing', () => {
    const { bundle } = packPile(pileOf([{ item: 'moss', count: 3 }, { item: 'nail', count: 2 }]));
    expect(bundle!.bundle!.owed).toEqual({ moss: 3, nail: 2 });
    expect(bundleWorth(bundle!.bundle!, items)).toBe(0);
  });
});

describe('what a bundle was worth, and the carrier\'s quarter', () => {
  it('is each thing\'s XP but for what the owner owed their stash, and the carrier gets a quarter of it, in whole XP', () => {
    const b: Bundle = { id: 'ana:1', owner: 'ana', name: 'Ana', map: 'woods', x: 3, y: 6, items: [{ item: 'moss', count: 3 }, { item: 'nail', count: 5 }], owed: { moss: 3, nail: 1 } };
    // 4 fresh nails: 12 XP. A quarter: 3.
    expect(bundleWorth(b, items)).toBe(12);
    expect(carrierShare(12)).toBe(3);
    expect(carrierShare(3)).toBe(0);
    expect(CARRIER_SHARE).toBe(0.25);
  });

  it('comes to no more than bringing it home would have earned: the owner\'s stash takes the rest by its own rule', () => {
    const b: Bundle = { id: 'ana:1', owner: 'ana', name: 'Ana', map: 'woods', x: 3, y: 6, items: [{ item: 'moss', count: 3 }, { item: 'nail', count: 5 }], owed: { moss: 3 } };
    const stash = { items: {}, out: { moss: 3 } };
    const home = store(stash, b.items, items).xp;
    const quarter = carrierShare(bundleWorth(b, items));
    expect(home).toBe(15);
    expect(quarter + (home - quarter)).toBe(home);
  });
});

describe('a bundle in the bag, in a pile and in someone\'s half', () => {
  const b: Bundle = { id: 'ana:1', owner: 'ana', name: 'Ana', map: 'woods', x: 3, y: 6, items: [{ item: 'moss', count: 4 }, { item: 'coat', count: 1, piece: { cond: 1 } }], owed: {} };
  const slot: BagSlot = { item: BUNDLE, count: 1, bundle: b };

  it('weighs what it holds, and takes one slot', () => {
    expect(slotKg(slot, items)).toBe(3);
    expect(bagLoad([slot], items)).toBe(0.3);
    const r = addAllToBag([{ item: 'nail', count: 1 }], [slot], items, 2);
    expect(r.bag).toEqual([{ item: 'nail', count: 1 }, slot]);
    expect(addAllToBag(r.bag, [slot], items, 2).left).toEqual([slot]);
  });

  it('stays whole when a pile gathers it and in a random half, each one on its own', () => {
    const two: BagSlot = { item: BUNDLE, count: 1, bundle: { ...b, id: 'bo:2', owner: 'bo', name: 'Bo' } };
    expect(gather([slot, { item: 'moss', count: 1 }, two])).toEqual([slot, { item: 'moss', count: 1 }, two]);
    // With a pile of one thing, the coin decides: here it goes to whoever takes half, whole.
    expect(halfOf([slot], () => 0)).toEqual([slot]);
    expect(bundlesIn([{ item: 'moss', count: 1 }, slot, two]).map(x => x.name)).toEqual(['Ana', 'Bo']);
    expect(namesOf([b, b, { name: 'Bo' }])).toBe('Ana and Bo');
  });

  it('never changes hands in a trade, and never goes into a crate', () => {
    expect(tradeable(items.get(BUNDLE))).toBe(false);
    expect(cacheTakes(items.get(BUNDLE))).toBe(false);
    expect(offerFrom([slot, { item: 'moss', count: 2 }], [{ slot: 0, count: 1 }, { slot: 1, count: 2 }], items)).toEqual([{ item: 'moss', count: 2 }]);
  });
});

describe('the one bundle item, in content', () => {
  // No gear: once there is gear at all, content needs the starter gear too.
  const PLAIN = DEFS.filter(d => d.kind !== 'gear');
  const data = (more: Partial<ItemsData> = {}): ItemsData => ({ version: 1, items: PLAIN, finds: [], ...more });
  const errors = (d: ItemsData) => validateItems(d, []).filter(p => p.level === 'error').map(p => p.message);

  it('is the item every bundle is, one to a slot, weighing and earning nothing of its own', () => {
    expect(errors(data())).toEqual([]);
    expect(itemIndex(data()).get(BUNDLE)?.kind).toBe('bundle');
    expect(errors(data({ items: [...PLAIN.filter(d => d.kind !== 'bundle'), { id: 'parcel', name: 'Parcel', kind: 'bundle', stack: 2, text: 'Tied.', xp: 3 }] }))).toEqual([
      'item "parcel": the one bundle is "bundle"',
      'item "parcel": a bundle stacks one to a slot',
      'item "parcel": a bundle is only carried and handed in: it weighs what it holds and earns nothing itself',
    ]);
  });

  it('is given by nothing in content: no find, recipe, strange object, parcel or lockbox holds one', () => {
    const odd: ItemDef = { id: 'odd', name: 'Odd', kind: 'resource', stack: 1, text: 'Odd.', use: { identify: true }, reveals: [{ item: BUNDLE, count: 1, weight: 1 }] };
    const box: ItemDef = { id: 'box', name: 'Box', kind: 'sealed', stack: 1, text: 'Shut.', holds: [{ weight: 1, items: [{ item: BUNDLE, count: 1 }] }] };
    const e = errors(data({
      items: [...PLAIN, odd, box],
      recipes: [{ id: 'tie', make: BUNDLE, needs: [{ item: 'moss', count: 1 }] }],
      parcels: { welcome: [{ item: BUNDLE, count: 1 }], week: Array.from({ length: 7 }, () => [{ item: 'moss', count: 1 }]) },
    }));
    expect(e).toEqual(expect.arrayContaining([
      'recipe "tie" makes bundle, a bundle: only a pile carried to the lodge makes one',
      'item "odd" reveals bundle, a bundle: only a pile carried to the lodge makes one',
      'item "box": holding 1: bundle is a bundle: only a pile carried to the lodge makes one',
      'parcels: the welcome parcel: bundle is a bundle: only a pile carried to the lodge makes one',
    ]));
  });
});
