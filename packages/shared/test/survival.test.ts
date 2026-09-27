import { describe, expect, it } from 'vitest';
import {
  AURORA_EVERY, CARRY_KG, DAY_S, DRAIN_GROWTH_STEPS, DRAIN_PER_SECOND, DRY_AIR_SECONDS, DRY_FIRE_SECONDS, DRY_ROOF_SECONDS, FEATS, HITCH_DRAIN, LOAD_DRAIN,
  REFILL_PER_SECOND, SURGE_DRAIN, TileMap, WET_DRAIN, WET_SECONDS, bagLoad, charmsIn, energyRate, featsOf, inSurge, itemIndex, modsOf, reveal, surgeAt,
  surgeFront, untilSurge, validateItems, validateMap, weatherAt, wetRate, type ItemsData, type MapData,
} from '../src';

/** A 5x6 strip of wilds: the way home at the bottom, a lamp at 0,1 lighting the top-left, a campfire at 4,1. */
function strip(more: Partial<MapData> = {}): MapData {
  return {
    id: 'strip', name: 'Strip', version: 1, kind: 'wilds', depth: 1, width: 5, height: 6,
    tiles: ['ggggg', 'ggggg', 'ggggg', 'ggggg', 'ggggg', 'ttgtt'],
    levels: Array<string>(6).fill('00000'),
    spawn: { x: 2, y: 4, dir: 'up' },
    exits: [{ x: 2, y: 5, w: 1, h: 1, to: 'town', tx: 0, ty: 0, dir: 'down', home: true }],
    objects: [{ kind: 'lamp', x: 0, y: 1 }, { kind: 'fireplace', x: 4, y: 1 }],
    ...more,
  };
}
const map = new TileMap(strip());
/** The plain drain at 3,3 (3 steps from home, out of the light), overcast. */
const base = -DRAIN_PER_SECOND * (1 + 3 / DRAIN_GROWTH_STEPS);

describe('what wears you down', () => {
  it('multiplies the drain by load, wetness, a hitchhiker and a surge', () => {
    expect(energyRate(map, 3, 3, 'overcast')).toBeCloseTo(base, 10);
    expect(energyRate(map, 3, 3, 'overcast', { load: 1 })).toBeCloseTo(base * (1 + LOAD_DRAIN), 10);
    // A load counts up to full: beyond that it is not worse.
    expect(energyRate(map, 3, 3, 'overcast', { load: 3 })).toBeCloseTo(base * (1 + LOAD_DRAIN), 10);
    expect(energyRate(map, 3, 3, 'overcast', { wet: 1 })).toBeCloseTo(base * (1 + WET_DRAIN), 10);
    expect(energyRate(map, 3, 3, 'overcast', { hitched: true })).toBeCloseTo(base * HITCH_DRAIN, 10);
    expect(energyRate(map, 3, 3, 'overcast', { surgeFront: 3 })).toBeCloseTo(base * SURGE_DRAIN, 10);
    expect(energyRate(map, 3, 3, 'overcast', { surgeFront: 4 })).toBeCloseTo(base, 10);
    expect(energyRate(map, 3, 3, 'overcast', { surgeFront: 0, surgeDrain: 2 })).toBeCloseTo(base * 2, 10);
  });

  it('refills by a fire only while it burns, as warm as it is', () => {
    expect(energyRate(map, 3, 1, 'rain')).toBe(REFILL_PER_SECOND);
    expect(energyRate(map, 3, 1, 'rain', { warmth: 0.4 })).toBeCloseTo(REFILL_PER_SECOND * 0.4, 10);
    // Out: the tile drains like any other.
    expect(energyRate(map, 3, 1, 'overcast', { warmth: 0 })).toBeCloseTo(-DRAIN_PER_SECOND * (1 + 5 / DRAIN_GROWTH_STEPS), 10);
  });

  it('shelters you from a surge under a street light, and only in the wilds', () => {
    expect(inSurge(map, 1, 1, 0)).toBe(false);
    expect(inSurge(map, 3, 3, 0)).toBe(true);
    expect(inSurge(map, 3, 3, undefined)).toBe(false);
  });

  it('soaks you in the rain anywhere outdoors, and dries you by a fire, under a roof or in dry air', () => {
    expect(wetRate('wilds', 'rain', false)).toBeCloseTo(1 / WET_SECONDS, 10);
    expect(wetRate('town', 'rain', false, 0.5)).toBeCloseTo(0.5 / WET_SECONDS, 10);
    expect(wetRate('wilds', 'rain', true)).toBeCloseTo(-1 / DRY_FIRE_SECONDS, 10);
    expect(wetRate('inside', 'rain', false)).toBeCloseTo(-1 / DRY_ROOF_SECONDS, 10);
    expect(wetRate('wilds', 'night', false)).toBeCloseTo(-1 / DRY_AIR_SECONDS, 10);
  });
});

describe('the sky', () => {
  it('runs a day of overcast, rain, overcast and night, with an aurora every third night', () => {
    expect(weatherAt(0)).toEqual({ weather: 'overcast', left: 12 * 60 });
    expect(weatherAt(13 * 60_000)).toEqual({ weather: 'rain', left: 11 * 60 });
    expect(weatherAt(33 * 60_000).weather).toBe('night');
    expect(weatherAt(((AURORA_EVERY - 1) * DAY_S + 33 * 60) * 1000).weather).toBe('aurora');
    expect(weatherAt((AURORA_EVERY * DAY_S + 33 * 60) * 1000).weather).toBe('night');
  });

  it('runs a surge round: calm, restless, then a front sweeping from the deepest tile home', () => {
    const rule = { every: 100, unstable: 20, surge: 20, sweep: 10 };
    expect(surgeAt(rule, 30_000)).toEqual({ phase: 'calm', left: 30, into: 30 });
    expect(surgeAt(rule, 65_000)).toEqual({ phase: 'unstable', left: 15, into: 5 });
    const s = surgeAt(rule, 85_000);
    expect(s).toEqual({ phase: 'surge', left: 15, into: 5 });
    expect(surgeFront(rule, 20, s)).toBe(10);
    expect(surgeFront(rule, 20, surgeAt(rule, 99_000))).toBe(0);
    expect(surgeFront(rule, 20, surgeAt(rule, 30_000))).toBeUndefined();
    expect(untilSurge(rule, surgeAt(rule, 30_000))).toBe(50);
    expect(untilSurge(rule, surgeAt(rule, 65_000))).toBe(15);
    // An offset shifts the round; times before the epoch still work.
    expect(surgeAt({ ...rule, offset: 40 }, 30_000).phase).toBe('unstable');
    expect(surgeAt(rule, -10_000).phase).toBe('surge');
  });

  it('knows the deepest tile of a map', () => {
    expect(map.deepest).toBe(7);
  });
});

describe('bags, charms, strange objects and feats', () => {
  const data: ItemsData = {
    version: 1,
    items: [
      { id: 'rock', name: 'Rock', kind: 'resource', stack: 10, text: 'Heavy.', weight: 2 },
      { id: 'moss', name: 'Moss', kind: 'resource', stack: 10, text: 'Light.' },
      { id: 'pebble', name: 'Warm pebble', kind: 'charm', stack: 1, text: 'Warm.', charm: { wetting: 0.5 } },
    ],
    finds: [],
  };
  const items = itemIndex(data);

  it('weighs a bag against what you carry easily', () => {
    expect(bagLoad([{ item: 'rock', count: 5 }, { item: 'moss', count: 10 }], items)).toBe(10 / CARRY_KG);
    expect(bagLoad([{ item: 'rock', count: 5 }], items, 0.5)).toBe(0.5);
    expect(bagLoad([], items)).toBe(0);
  });

  it('counts each kind of charm once', () => {
    expect(charmsIn([{ item: 'pebble', count: 1 }, { item: 'pebble', count: 1 }, { item: 'rock', count: 1 }], items)).toEqual([{ wetting: 0.5 }]);
  });

  it('reveals by weight', () => {
    const list = [{ item: 'a', count: 1, weight: 3 }, { item: 'b', count: 2, weight: 1 }];
    expect(reveal(list, () => 0)).toEqual({ item: 'a', count: 1 });
    expect(reveal(list, () => 0.74)).toEqual({ item: 'a', count: 1 });
    expect(reveal(list, () => 0.76)).toEqual({ item: 'b', count: 2 });
    expect(reveal([], () => 0)).toBeUndefined();
  });

  it('earns feats at their mark, and multiplies feats and charms into one set of factors', () => {
    const rain = FEATS.find(f => f.stat === 'rainSteps')!;
    expect(featsOf({ rainSteps: rain.need - 1 })).toEqual([]);
    expect(featsOf({ rainSteps: rain.need })).toEqual([rain.id]);
    expect(modsOf({ rainSteps: rain.need }, [{ wetting: 0.5 }])).toEqual({ wetting: 0.8 * 0.5, load: 1, hitch: 1, warmth: 1 });
    expect(modsOf({})).toEqual({ wetting: 1, load: 1, hitch: 1, warmth: 1 });
  });
});

describe('validation of the new content', () => {
  it('checks surges, watchers and notice boards', () => {
    expect(validateMap(strip({ surge: { every: 100, unstable: 20, surge: 20, sweep: 10 }, watchers: { count: 2, steps: [2, 9] } }))).toEqual([]);
    const msgs = (d: MapData) => validateMap(d).filter(p => p.level === 'error').map(p => p.message);
    expect(msgs(strip({ surge: { every: 30, unstable: 20, surge: 20, sweep: 10 } }))).toEqual(['surge: unstable and surge must leave calm time in every round']);
    expect(msgs(strip({ surge: { every: 100, unstable: 20, surge: 20, sweep: 30 } }))).toEqual(['surge: the front must reach home (sweep) before the surge is over']);
    expect(msgs(strip({ watchers: { count: 0, steps: [2, 9] } }))).toEqual(['watchers: count must be a whole number from 1']);
    // A board, like a sign, needs a tile in front to read it from.
    expect(msgs(strip({ objects: [{ kind: 'board', x: 1, y: 4 }] }))).toEqual(['board at 1,4: the tile in front (below) is not walkable, so nobody can talk to it']);
  });

  it('checks what items do: charms, uses, fuel and what strange objects reveal', () => {
    const maps = [strip()];
    const problems = (items: ItemsData['items'], finds: ItemsData['finds'] = []) => validateItems({ version: 1, items, finds }, maps).filter(p => p.level === 'error').map(p => p.message);
    expect(problems([
      { id: 'cap', name: 'Cap', kind: 'resource', stack: 5, text: 'Glows.', use: { mark: true }, weight: 0.1 },
      { id: 'odd', name: 'Odd', kind: 'resource', stack: 1, text: '?', use: { identify: true }, reveals: [{ item: 'cap', count: 2, weight: 1 }] },
      { id: 'pebble', name: 'Pebble', kind: 'charm', stack: 1, text: 'Warm.', charm: { wetting: 0.5 } },
    ])).toEqual([]);
    expect(problems([{ id: 'dud', name: 'Dud', kind: 'charm', stack: 1, text: 'Nothing.', charm: { load: 1 } }])).toEqual(['item "dud" is a charm that does nothing']);
    expect(problems([{ id: 'odd', name: 'Odd', kind: 'resource', stack: 1, text: '?', use: { identify: true }, reveals: [{ item: 'nope', count: 1, weight: 1 }] }]))
      .toEqual(['item "odd" reveals nope, which is not an item']);
    expect(problems([{ id: 'log', name: 'Log', kind: 'resource', stack: 1, text: 'Wood.', fuel: -5 }])).toEqual(['item "log": fuel must be a number above 0']);
    expect(problems([{ id: 'cap', name: 'Cap', kind: 'resource', stack: 5, text: 'Glows.' }], [{ item: 'cap', map: 'strip', count: 1, respawn: [1, 2], when: 'unstable' }]))
      .toEqual(['find 0 (cap in strip): grows while the map is restless, but strip never surges']);
  });
});
