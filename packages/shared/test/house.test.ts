/**
 * A home of one's own (roadmap/home-lots.md): the house built up a level at a time (house.ts) and what waits
 * for a level, the levels as content gives them (validateItems), the kitchen's pantry (meals.ts), and, out in
 * the wilds, about what the walk home takes from where you stand (energy.ts, wayHomeCost).
 */
import { describe, expect, it } from 'vitest';
import {
  BUILT_LATER, DRAIN_GROWTH_STEPS, DRAIN_PER_SECOND, FIRST_HOUSE, HOME_H, HOME_W, STEP_MS, TileMap, builtFrom, builtIn, cleanHouse, energyRate, houseName, itemIndex, nextHouse,
  pantryShort, payPantry, timeToTurn, validateItems, wayHomeCost, type HouseLevel, type ItemsData, type MapData,
} from '../src';
import json from '../../../content/items.json';

const content = json as ItemsData;
const LEVELS: HouseLevel[] = [
  { name: 'Garage', text: 'Block walls.' },
  { name: 'Cabin', needs: [{ item: 'scrap', count: 20 }, { item: 'resin', count: 20 }], text: 'Logs.' },
  { name: 'House', needs: [{ item: 'scrap', count: 30 }], text: 'Two floors.' },
];

describe('a house built up', () => {
  it('starts as the first level, and a saved level the data does not know is the first', () => {
    expect(FIRST_HOUSE).toBe(1);
    expect([HOME_W, HOME_H]).toEqual([5, 3]);
    expect([1, 2, 3].map(l => cleanHouse(l, LEVELS))).toEqual([1, 2, 3]);
    for (const odd of [undefined, null, 0, 4, 2.5, -1, '2', NaN]) expect(cleanHouse(odd, LEVELS), String(odd)).toBe(1);
    // Data without levels: every house is the first.
    expect(cleanHouse(2, [])).toBe(1);
  });

  it('is built up a level at a time, each with what it takes, to the last', () => {
    expect(nextHouse(1, LEVELS)).toEqual({ level: 2, name: 'Cabin', text: 'Logs.', needs: LEVELS[1]!.needs });
    expect(nextHouse(2, LEVELS)).toMatchObject({ level: 3, name: 'House' });
    expect(nextHouse(3, LEVELS)).toBeUndefined();
    expect(nextHouse(1, [])).toBeUndefined();
    expect([houseName(1, LEVELS), houseName(3, LEVELS), houseName(9, LEVELS), houseName(1, [])]).toEqual(['Garage', 'House', 'Garage', 'House']);
  });

  it('opens the kitchen and the map table only from their level on: boxes stand in their places until then', () => {
    expect([...BUILT_LATER].sort()).toEqual(['board', 'kitchen']);
    const kitchen = { kind: 'kitchen' as const, x: 1, y: 3, house: 2 }, table = { kind: 'board' as const, x: 6, y: 4, house: 3 };
    expect([builtFrom(kitchen), builtFrom(table), builtFrom({ kind: 'chest', x: 5, y: 1 })]).toEqual([2, 3, 1]);
    expect([builtIn(kitchen, 1), builtIn(kitchen, 2), builtIn(table, 2), builtIn(table, 3)]).toEqual([false, true, false, true]);
    // A notice board in town, and a kitchen without a level, always stand.
    expect(builtIn({ kind: 'board', x: 0, y: 3 }, 1)).toBe(true);
    expect(builtIn({ kind: 'kitchen', x: 1, y: 3 }, 1)).toBe(true);
  });
});

describe('the levels as content gives them', () => {
  // Without the maps, content has other errors (what is found where): only the house's are looked at here.
  const errors = (house: HouseLevel[] | undefined, maps: MapData[] = []) =>
    validateItems({ ...content, house }, maps).filter(p => p.level === 'error' && /^house|waits for level/.test(p.message)).map(p => p.message);

  it('takes the levels the game ships: a garage that takes nothing, then a cabin and a house paid from the stash', () => {
    expect(content.house?.map(l => l.name)).toEqual(['Garage', 'Cabin', 'House']);
    expect(errors(content.house)).toEqual([]);
  });

  it('keeps each level to its rules: words, nothing for the first, something a stash holds for the rest', () => {
    expect(errors([{ name: 'Garage', needs: [{ item: 'scrap', count: 1 }], text: 'Block.' }])).toContain('house level 1: the first level is the house as it starts, and takes nothing');
    expect(errors([LEVELS[0]!, { name: 'Cabin', text: 'Logs.' }])).toContain('house level 2: building up to it takes something from the stash (needs)');
    expect(errors([LEVELS[0]!, { name: ' ', needs: [{ item: 'scrap', count: 1 }], text: '' }])).toContain('house level 2 needs a name and its words (text)');
    expect(errors([LEVELS[0]!, { name: 'Cabin', needs: [{ item: 'nothing', count: 1 }], text: 'Logs.' }])).toContain('house level 2 needs "nothing", which is no item');
    expect(errors([LEVELS[0]!, { name: 'Cabin', needs: [{ item: 'bed', count: 1 }], text: 'Logs.' }])).toContain('house level 2 needs bed: a furniture is never paid with');
    expect(errors([LEVELS[0]!, { name: 'Cabin', needs: [{ item: 'scrap', count: 0 }], text: 'Logs.' }])).toContain('house level 2: what it needs is counted in whole numbers from 1');
    expect(errors(Array.from({ length: 10 }, (_, i) => (i ? LEVELS[1]! : LEVELS[0]!)))).toContain('house: 10 levels, but a house has at most 9');
  });

  it('keeps what waits for a level to the levels there are', () => {
    const home: MapData = {
      id: 'home', name: 'Home', version: 1, kind: 'inside', depth: 0, width: 5, height: 4, tiles: ['xxxxx', 'xpppx', 'xpppx', 'xxpxx'], levels: Array<string>(4).fill('00000'),
      spawn: { x: 2, y: 2, dir: 'up' }, exits: [{ x: 2, y: 3, w: 1, h: 1, to: 'town', tx: 1, ty: 1, dir: 'down' }], private: true, wake: { x: 2, y: 2, dir: 'down' },
      objects: [{ kind: 'chest', x: 2, y: 1 }, { kind: 'kitchen', x: 1, y: 1, house: 2 }, { kind: 'board', x: 3, y: 1, house: 4 }],
    };
    expect(errors(LEVELS, [home])).toEqual(['home: the board at 3,1 waits for level 4 of the house, which the items do not have']);
  });
});

describe('the kitchen\'s pantry', () => {
  const tea = content.cooking!.find(r => r.id === 'fir-tip-tea')!, stew = content.cooking!.find(r => r.id === 'chanterelle-stew')!;

  it('cooks from the bag and the chest together: what both lack, need by need', () => {
    expect(pantryShort(tea, [{ item: 'fir-tips', count: 1 }], { 'fir-tips': 2 })).toEqual([]);
    expect(pantryShort(tea, [], { 'fir-tips': 3 })).toEqual([]);
    expect(pantryShort(tea, [{ item: 'fir-tips', count: 1 }], {})).toEqual([{ item: 'fir-tips', count: 2 }]);
    expect(pantryShort(stew, [{ item: 'chanterelles', count: 1 }], { chanterelles: 1, fiddleheads: 5 })).toEqual([{ item: 'chanterelles', count: 1 }]);
  });

  it('pays from the bag first, then the chest', () => {
    expect(payPantry([{ item: 'fir-tips', count: 1 }, { item: 'resin', count: 4 }], tea.needs)).toEqual({
      bag: [{ item: 'resin', count: 4 }], fromBag: [{ item: 'fir-tips', count: 1 }], fromChest: [{ item: 'fir-tips', count: 2 }],
    });
    expect(payPantry([{ item: 'fir-tips', count: 5 }], tea.needs)).toEqual({ bag: [{ item: 'fir-tips', count: 2 }], fromBag: [{ item: 'fir-tips', count: 3 }], fromChest: [] });
    expect(payPantry([], stew.needs).fromChest).toEqual(stew.needs);
    expect(itemIndex(content).has('fir-tips')).toBe(true);
  });
});

describe('the way home', () => {
  /** A straight path out, `n` tiles long, its way home at x 0: into `to` at its far end (tx), or into town. */
  const path = (id: string, depth: number, to: string, tx: number): MapData => ({
    id, name: id, version: 1, kind: 'wilds', depth, width: 12, height: 1, tiles: ['g'.repeat(12)], levels: ['0'.repeat(12)],
    spawn: { x: 11, y: 0, dir: 'left' }, exits: [{ x: 0, y: 0, w: 1, h: 1, to, tx, ty: 0, dir: 'left', home: true }], objects: [],
  });
  const town: MapData = {
    id: 'town', name: 'Town', version: 1, kind: 'town', depth: 0, width: 3, height: 1, tiles: ['ggg'], levels: ['000'], spawn: { x: 1, y: 0, dir: 'up' }, exits: [], objects: [],
  };
  const maps = new Map([path('near', 1, 'town', 2), path('far', 2, 'near', 11), town].map(d => [d.id, new TileMap(d)]));
  const near = maps.get('near')!, far = maps.get('far')!, find = (id: string) => maps.get(id);
  /** What walking `n` steps home drains at depth `depth`, as each step from `s` away drains (energy.ts), with nothing else draining. */
  const walk = (n: number, depth: number) => {
    let total = 0;
    for (let s = 1; s <= n; s++) total += DRAIN_PER_SECOND * Math.max(1, depth) * (1 + s / DRAIN_GROWTH_STEPS) * (STEP_MS / 1000);
    return total;
  };

  it('adds up the steps to each map\'s way home, map after map, each at its own depth and distance', () => {
    const steps = near.homeSteps(11, 0);
    expect(steps).toBe(11);
    const here = energyRate(near, 11, 0, 'overcast');
    expect(wayHomeCost(near, 11, 0, here, find)).toBeCloseTo(walk(steps, 1), 9);
    // From the far end of the deeper path: its own walk, twice as hard, then the whole walk of the near one.
    expect(wayHomeCost(far, 11, 0, energyRate(far, 11, 0, 'overcast'), find)).toBeCloseTo(walk(11, 2) + walk(11, 1), 9);
    // Nearer home, less.
    expect(wayHomeCost(near, 3, 0, energyRate(near, 3, 0, 'overcast'), find)!).toBeLessThan(wayHomeCost(near, 11, 0, here, find)!);
  });

  it('counts what drains you now as it is here: rain makes the whole way cost more', () => {
    const dry = wayHomeCost(far, 11, 0, energyRate(far, 11, 0, 'overcast'), find)!;
    expect(wayHomeCost(far, 11, 0, energyRate(far, 11, 0, 'rain'), find)! / dry).toBeCloseTo(1.25, 9);
  });

  it('is nothing to show where nothing drains, or where no way leads home', () => {
    expect(wayHomeCost(near, 11, 0, 0, find)).toBeNull();
    expect(wayHomeCost(near, 11, 0, 8, find)).toBeNull();
    expect(wayHomeCost(maps.get('town')!, 1, 0, -1, find)).toBeNull();
    const cut = new TileMap({ ...path('cut', 1, 'town', 2), tiles: ['gggggxgggggg'] });
    expect(wayHomeCost(cut, 11, 0, -1, find)).toBeNull();
  });

  it('says it is time to turn back once energy is down to little more than it, with a margin', () => {
    expect(timeToTurn(40, 20)).toBe(false);
    expect(timeToTurn(31, 20)).toBe(true);
    expect(timeToTurn(6, 0)).toBe(true);
    expect(timeToTurn(7, 0)).toBe(false);
  });
});
