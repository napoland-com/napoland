import { describe, expect, it } from 'vitest';
import {
  BAG_SLOTS, DRAIN_GROWTH_STEPS, DRAIN_PER_SECOND, RESIST_MAX, STARTER_GEAR, SURGE_DRAIN, TileMap, WEATHER_DRAIN, WET_DRAIN, bagSlotsOf, canMake, energyRate, gearEnergy,
  itemIndex, nearestRecipe, resistOf, validateItems, type ItemsData, type MapData, type Recipe,
} from '../src';
import json from '../../../content/items.json';

const data: ItemsData = {
  version: 1,
  items: [
    { id: 'coat', name: 'Coat', kind: 'gear', stack: 1, text: 'Warm.', slot: 'shirt', resist: { cold: 0.5, wind: 0.3 }, bonus: 5 },
    { id: 'hat', name: 'Hat', kind: 'gear', stack: 1, text: 'Warm.', slot: 'cap', resist: { cold: 0.4, radiation: 0.2 } },
    { id: 'pack', name: 'Pack', kind: 'gear', stack: 1, text: 'Big.', slot: 'bag', bag: 12 },
    { id: 'cloth', name: 'Cloth', kind: 'resource', stack: 10, text: 'Dry.' },
  ],
  finds: [],
};
const items = itemIndex(data);

/** A 3x5 strip of wilds, its way home at the bottom: 1,1 is 3 steps from it. */
const strip: MapData = {
  id: 'strip', name: 'Strip', version: 1, kind: 'wilds', depth: 1, width: 3, height: 5,
  tiles: ['ggg', 'ggg', 'ggg', 'ggg', 'tgt'], levels: Array<string>(5).fill('000'),
  spawn: { x: 1, y: 3, dir: 'up' }, exits: [{ x: 1, y: 4, w: 1, h: 1, to: 'town', tx: 0, ty: 0, dir: 'down', home: true }], objects: [],
};
const map = new TileMap(strip);
const base = DRAIN_PER_SECOND * (1 + 3 / DRAIN_GROWTH_STEPS);

describe('what gear does', () => {
  it('adds up resistances over what is worn, never past the cap', () => {
    expect(resistOf({ shirt: 'coat', cap: 'hat' }, items)).toEqual({ heat: 0, cold: RESIST_MAX, wind: 0.3, electricity: 0, radiation: 0.2 });
    // A piece in the wrong place, or no gear at all, resists nothing.
    expect(resistOf({ shirt: 'cloth', cap: 'nope' }, items).cold).toBe(0);
  });

  it('sets the bag\'s slots and adds energy', () => {
    expect(bagSlotsOf({ bag: 'pack' }, items)).toBe(12);
    expect(bagSlotsOf({}, items)).toBe(BAG_SLOTS);
    expect(gearEnergy({ shirt: 'coat', bag: 'pack' }, items)).toBe(5);
  });

  it('lets cold soften the weather and wetness, and electricity and radiation a surge', () => {
    const night = -base * WEATHER_DRAIN.night;
    expect(energyRate(map, 1, 1, 'night')).toBeCloseTo(night, 10);
    // Half cold: half of the night's extra drain.
    expect(energyRate(map, 1, 1, 'night', { resist: { cold: 0.5 } })).toBeCloseTo(-base * (1 + (WEATHER_DRAIN.night - 1) / 2), 10);
    expect(energyRate(map, 1, 1, 'overcast', { wet: 1, resist: { cold: 0.5 } })).toBeCloseTo(-base * (1 + WET_DRAIN / 2), 10);
    // A surge: each of electricity and radiation cuts half of its extra.
    expect(energyRate(map, 1, 1, 'overcast', { surgeFront: 0, resist: { electricity: 1, radiation: 1 } })).toBeCloseTo(-base, 10);
    expect(energyRate(map, 1, 1, 'overcast', { surgeFront: 0, resist: { electricity: 1 } })).toBeCloseTo(-base * (1 + (SURGE_DRAIN - 1) / 2), 10);
  });

  it('knows what the stash can make', () => {
    const r = { id: 'coat', make: 'coat', needs: [{ item: 'cloth', count: 8 }] };
    expect(canMake(r, { cloth: 8 })).toBe(true);
    expect(canMake(r, { cloth: 7 })).toBe(false);
  });
});

describe('validation of gear and recipes', () => {
  const problems = (d: Partial<ItemsData>) => validateItems({ version: 1, items: [], finds: [], ...d }, [strip]).filter(p => p.level === 'error').map(p => p.message);
  const starter = ['worn-cap', 'worn-shirt', 'worn-gloves', 'worn-pants', 'worn-shoes'].map(id => ({ id, name: id, kind: 'gear' as const, stack: 1, text: 'Old.', slot: id.slice(5) as 'cap' }))
    .concat([{ id: 'backpack', name: 'Backpack', kind: 'gear', stack: 1, text: 'Old.', slot: 'bag', bag: 8 } as never]);

  it('checks slots, resistances, bags and that everyone has something to start in', () => {
    expect(problems({ items: starter })).toEqual([]);
    expect(problems({ items: [...starter, { id: 'x', name: 'X', kind: 'gear', stack: 2, text: 'X.', resist: { fire: 0.2 } as never }] })).toEqual([
      'item "x": gear needs a slot (cap, shirt, gloves, pants, shoes, bag)', 'item "x": gear stacks one to a slot', 'item "x": resists an unknown element fire',
    ]);
    expect(problems({ items: [{ id: 'coat', name: 'Coat', kind: 'gear', stack: 1, text: 'Warm.', slot: 'shirt' }] })).toContain('the starter gear worn-cap is not an item');
    expect(problems({ items: [{ id: 'rock', name: 'Rock', kind: 'resource', stack: 1, text: 'Hard.', slot: 'cap' }] })).toEqual(['item "rock": only gear has a slot, a tier, resistances, a bag or bonus energy']);
  });

  it('checks recipes make and need real items', () => {
    expect(problems({ items: starter, recipes: [{ id: 'hat', make: 'nope', needs: [{ item: 'dust', count: 0 }] }] })).toEqual([
      'recipe "hat" makes nope, which is not an item', 'recipe "hat" needs dust, which is not an item', 'recipe "hat": each need is a whole number from 1',
    ]);
  });
});

describe('the nearest gear you could make (a first goal on the first day)', () => {
  const content = json as unknown as ItemsData;
  const starter = new Set(Object.values(STARTER_GEAR));
  const RECIPES: Recipe[] = [
    { id: 'cap', make: 'cap', needs: [{ item: 'cloth', count: 6 }, { item: 'resin', count: 1 }] },
    { id: 'coat', make: 'coat', needs: [{ item: 'cloth', count: 8 }, { item: 'resin', count: 4 }] },
    { id: 'gloves', make: 'gloves', needs: [{ item: 'resin', count: 6 }, { item: 'cloth', count: 2 }] },
    { id: 'boots', make: 'boots', needs: [{ item: 'resin', count: 8 }, { item: 'scrap', count: 2 }] },
  ];

  it('points a new player, with only the welcome parcel in the stash, at rubber gloves: 1 more resin', () => {
    expect(nearestRecipe(content.recipes!, starter, { resin: 5, cloth: 4, thermos: 1, flare: 2 }, {})).toEqual({
      recipe: content.recipes!.find(r => r.id === 'rubber-gloves'), missing: [{ item: 'resin', count: 1 }], ready: false,
    });
  });

  it('counts what the bag holds as well as the stash, and says it is ready only when the stash alone can pay', () => {
    const next = nearestRecipe(RECIPES, new Set(), { resin: 5, cloth: 4 }, { resin: 3 })!;
    expect(next).toMatchObject({ recipe: { id: 'gloves' }, missing: [], ready: false });
    expect(nearestRecipe(RECIPES, new Set(), { resin: 6, cloth: 2 }, {})).toMatchObject({ recipe: { id: 'gloves' }, missing: [], ready: true });
  });

  it('puts one the stash can pay for first, the first of those in the recipes\' order', () => {
    // The cap and the coat can both be made; the gloves would need 2 more resin.
    expect(nearestRecipe(RECIPES, new Set(), { cloth: 8, resin: 4 }, {})).toMatchObject({ recipe: { id: 'cap' }, ready: true });
    // The one that lacks the fewest; of two that lack as few, the first.
    expect(nearestRecipe(RECIPES, new Set(), { cloth: 4, resin: 5 }, {})).toMatchObject({ recipe: { id: 'gloves' }, missing: [{ item: 'resin', count: 1 }] });
    expect(nearestRecipe(RECIPES, new Set(), { cloth: 5, resin: 5 }, {})).toMatchObject({ recipe: { id: 'cap' }, missing: [{ item: 'cloth', count: 1 }] });
    expect(nearestRecipe(RECIPES, new Set(), {}, {})).toMatchObject({ recipe: { id: 'cap' }, missing: [{ item: 'cloth', count: 6 }, { item: 'resin', count: 1 }] });
  });

  it('leaves out what you own already, worn or in the stash, and says nothing once you own it all', () => {
    expect(nearestRecipe(RECIPES, new Set(['gloves']), { resin: 6, cloth: 2 }, {})).toMatchObject({ recipe: { id: 'cap' }, missing: [{ item: 'cloth', count: 4 }] });
    expect(nearestRecipe(RECIPES, new Set(['cap', 'coat', 'gloves', 'boots']), { resin: 99 }, {})).toBeNull();
    expect(nearestRecipe([], new Set(), {}, {})).toBeNull();
  });
});
