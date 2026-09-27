import { describe, expect, it } from 'vitest';
import {
  TileMap, addAllToBag, addToBag, findTiles, halfOf, itemIndex, merge, takeFromBag, validateItems,
  type ItemDef, type ItemsData, type MapData,
} from '../src';

const glowcap: ItemDef = { id: 'glowcap', name: 'Glowcap', kind: 'resource', stack: 10, text: 'Glows after rain.' };
const shard: ItemDef = { id: 'shard', name: 'Anomaly shard', kind: 'resource', stack: 3, text: 'Warm to the touch.' };
const thermos: ItemDef = { id: 'thermos', name: 'Thermos', kind: 'consumable', stack: 2, text: 'Still hot.', use: { energy: 30 } };
const items = itemIndex({ version: 1, items: [glowcap, shard, thermos], finds: [] });

/** A 6x5 patch of wilds: a trail from the home exit at the bottom, a car at the top right. */
function woods(): MapData {
  return {
    id: 'woods', name: 'Woods', version: 1, kind: 'wilds', depth: 1, width: 6, height: 5,
    tiles: ['gggmgg', 'gtttgg', 'gtfffg', 'gtttgg', 'tttmtt'],
    levels: Array<string>(5).fill('000000'),
    spawn: { x: 3, y: 3, dir: 'up' },
    exits: [{ x: 3, y: 4, w: 1, h: 1, to: 'town', tx: 0, ty: 0, dir: 'down', home: true }],
    objects: [{ kind: 'car', x: 4, y: 0, w: 2 }],
  };
}

describe('the bag', () => {
  it('tops up slots that hold the same item before starting new ones', () => {
    let r = addToBag([], glowcap, 7);
    expect(r).toEqual({ bag: [{ item: 'glowcap', count: 7 }], left: 0 });
    r = addToBag(r.bag, glowcap, 5);
    expect(r.bag).toEqual([{ item: 'glowcap', count: 10 }, { item: 'glowcap', count: 2 }]);
  });
  it('says how many did not fit, and never changes the bag it was given', () => {
    const full = Array.from({ length: 8 }, () => ({ item: 'shard', count: 3 }));
    const r = addToBag(full, shard, 2);
    expect(r.left).toBe(2);
    expect(r.bag).toEqual(full);
    const small = addToBag([], shard, 7, 2);
    expect(small).toEqual({ bag: [{ item: 'shard', count: 3 }, { item: 'shard', count: 3 }], left: 1 });
  });
  it('puts several stacks in and brings back what is left, skipping items that no longer exist', () => {
    const r = addAllToBag([], [{ item: 'glowcap', count: 4 }, { item: 'gone', count: 1 }, { item: 'shard', count: 7 }], items, 2);
    expect(r.bag).toEqual([{ item: 'glowcap', count: 4 }, { item: 'shard', count: 3 }]);
    expect(r.left).toEqual([{ item: 'shard', count: 4 }]);
  });
  it('takes some or all out of a slot', () => {
    const bag = [{ item: 'glowcap', count: 4 }, { item: 'thermos', count: 1 }];
    expect(takeFromBag(bag, 0, 1)).toEqual([{ item: 'glowcap', count: 3 }, { item: 'thermos', count: 1 }]);
    expect(takeFromBag(bag, 1)).toEqual([{ item: 'glowcap', count: 4 }]);
    expect(takeFromBag(bag, 5)).toEqual(bag);
  });
  it('joins equal items', () => {
    expect(merge([{ item: 'a', count: 2 }, { item: 'b', count: 1 }, { item: 'a', count: 3 }, { item: 'c', count: 0 }])).toEqual([{ item: 'a', count: 5 }, { item: 'b', count: 1 }]);
  });
});

describe('half a pile', () => {
  const pile = [{ item: 'glowcap', count: 7 }, { item: 'shard', count: 2 }, { item: 'thermos', count: 1 }];
  const count = (s: { count: number }[]) => s.reduce((n, x) => n + x.count, 0);
  it('gives exactly half, with an odd one out going either way', () => {
    let rolls = 0;
    const seq = [0.1, 0.9, 0.4, 0.6, 0.2, 0.8, 0.3, 0.7, 0.5, 0.05, 0.95];
    const rng = () => seq[rolls++ % seq.length]!;
    const half = halfOf(pile, rng);
    expect([5]).toContain(count(half)); // 10 units: exactly 5
    for (const s of half) expect(s.count).toBeLessThanOrEqual(pile.find(p => p.item === s.item)!.count);
    const odd = [{ item: 'glowcap', count: 3 }];
    expect(count(halfOf(odd, () => 0.1))).toBe(2); // the coin toss says yes
    expect(count(halfOf(odd, () => 0.9))).toBe(1);
  });
  it('picks different units each time, and on average half of each kind', () => {
    let seed = 7;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const got = new Map<string, number>();
    for (let i = 0; i < 2000; i++) for (const s of halfOf(pile, rng)) got.set(s.item, (got.get(s.item) ?? 0) + s.count);
    expect(got.get('glowcap')! / 2000).toBeCloseTo(3.5, 0);
    expect(got.get('thermos')! / 2000).toBeCloseTo(0.5, 1);
  });
});

describe('where finds grow', () => {
  const map = new TileMap(woods());
  it('keeps to walkable tiles off the exits, the kinds asked for, the distance and the nearness', () => {
    const all = findTiles(map, { item: 'glowcap', map: 'woods', count: 1, respawn: [1, 2] });
    expect(all).not.toContainEqual({ x: 3, y: 4 }); // the exit
    expect(all).not.toContainEqual({ x: 1, y: 1 }); // forest
    expect(findTiles(map, { item: 'glowcap', map: 'woods', on: ['ferns'], count: 1, respawn: [1, 2] })).toEqual([{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }]);
    const far = findTiles(map, { item: 'shard', map: 'woods', steps: [6, 99], count: 1, respawn: [1, 2] });
    for (const t of far) expect(map.homeSteps(t.x, t.y)).toBeGreaterThanOrEqual(6);
    const byCar = findTiles(map, { item: 'shard', map: 'woods', near: { kinds: ['car'], radius: 1.5 }, count: 1, respawn: [1, 2] });
    expect(byCar.length).toBeGreaterThan(0);
    for (const t of byCar) expect(Math.hypot(t.x - 4, t.y - 0)).toBeLessThanOrEqual(1.5);
  });
});

describe('validateItems', () => {
  const good: ItemsData = {
    version: 1,
    items: [glowcap, shard, thermos],
    finds: [{ item: 'glowcap', map: 'woods', count: 2, respawn: [60, 120] }],
  };
  it('passes good items and finds', () => {
    expect(validateItems(good, [woods()])).toEqual([]);
  });
  it('catches broken items and finds', () => {
    const bad: ItemsData = {
      version: 1,
      items: [glowcap, { ...glowcap }, { ...thermos, id: 'empty', use: {} }, { ...shard, id: 'Shard!', stack: 0 }],
      finds: [
        { item: 'nothing', map: 'woods', count: 1, respawn: [1, 2] },
        { item: 'glowcap', map: 'nowhere', count: 1, respawn: [1, 2] },
        { item: 'glowcap', map: 'woods', count: 50, respawn: [5, 1] },
        { item: 'glowcap', map: 'woods', on: ['ferns'], count: 2, respawn: [1, 2] },
      ],
    };
    const msgs = validateItems(bad, [woods()]).map(p => `${p.level}: ${p.message}`).join('\n');
    expect(msgs).toMatch(/"glowcap" is defined twice/);
    expect(msgs).toMatch(/"empty" is a consumable that does nothing/);
    expect(msgs).toMatch(/"Shard!": ids are lowercase/);
    expect(msgs).toMatch(/stack must be a whole number/);
    expect(msgs).toMatch(/there is no item nothing/);
    expect(msgs).toMatch(/there is no map nowhere/);
    expect(msgs).toMatch(/respawn is \[shortest, longest\]/);
    expect(msgs).toMatch(/warning: find 3 .*only 3 tiles fit the rule for 2 finds/);
  });
});
