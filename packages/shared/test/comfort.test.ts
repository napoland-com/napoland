import { describe, expect, it } from 'vitest';
import {
  COMFORTS, COZY_AFTER_S, COZY_DRAIN, COZY_MODS, TileMap, blocks, comfortMax, comfortOf, cozySeconds, dries, energyRate, footprint, furnitureFor, modsOf, underfoot, validateItems,
  validateMap, type ItemDef, type ItemsData, type MapData,
} from '../src';

/** The six pieces of furniture, as content/items.json has them: comfort 3, 2, 2, 1, 1 and 1, 10 in all. */
const FURNITURE: ItemDef[] = [
  { id: 'iron-stove', name: 'Iron stove', kind: 'furniture', stack: 1, furnishes: 'stove', comfort: 3, text: 'Warm.', spoiled: 'Rusted.' },
  { id: 'bed', name: 'Bed', kind: 'furniture', stack: 1, furnishes: 'bed', comfort: 2, text: 'Soft.', spoiled: 'Bare.' },
  { id: 'drying-rack', name: 'Drying rack', kind: 'furniture', stack: 1, furnishes: 'rack', comfort: 2, dries: true, text: 'Dry.', spoiled: 'Broken.' },
  { id: 'rag-rug', name: 'Rag rug', kind: 'furniture', stack: 1, furnishes: 'rug', comfort: 1, text: 'Warm underfoot.', spoiled: 'Rotten.' },
  { id: 'oil-lamp', name: 'Oil lamp', kind: 'furniture', stack: 1, furnishes: 'lamp', comfort: 1, text: 'Lit.', spoiled: 'Cracked.' },
  { id: 'trophy-shelf', name: 'Trophy shelf', kind: 'furniture', stack: 1, furnishes: 'shelf', comfort: 1, text: 'Proud.', spoiled: 'Warped.' },
];
const index = new Map(FURNITURE.map(d => [d.id, d]));

/** A home of one's own, 7 by 5, with a place for each piece of furniture. */
function home(more: Partial<MapData> = {}): MapData {
  return {
    id: 'home', name: 'Home', version: 1, kind: 'inside', depth: 0, width: 9, height: 7,
    tiles: ['xxxxxxxxx', 'xpppppppx', 'xpppppppx', 'xpppppppx', 'xpppppppx', 'xpppppppx', 'xxxxpxxxx'],
    levels: Array<string>(7).fill('000000000'),
    spawn: { x: 4, y: 5, dir: 'up' },
    exits: [{ x: 4, y: 6, w: 1, h: 1, to: 'town', tx: 1, ty: 1, dir: 'down' }],
    objects: [
      { kind: 'fireplace', x: 4, y: 1 }, { kind: 'chest', x: 5, y: 1 }, { kind: 'workbench', x: 6, y: 1 },
      { kind: 'comfort', x: 1, y: 1, what: 'stove' }, { kind: 'comfort', x: 2, y: 1, what: 'shelf' }, { kind: 'comfort', x: 3, y: 1, what: 'rack' },
      { kind: 'comfort', x: 7, y: 1, what: 'bed' }, { kind: 'comfort', x: 3, y: 2, what: 'rug' }, { kind: 'comfort', x: 2, y: 4, what: 'lamp' },
    ],
    private: true,
    wake: { x: 4, y: 2, dir: 'down' },
    ...more,
  };
}

describe('comfort', () => {
  it('adds up what stands in the cabin, each piece once, up to 10 with all six', () => {
    expect(comfortOf(undefined, index)).toBe(0);
    expect(comfortOf(['iron-stove', 'rag-rug'], index)).toBe(4);
    expect(comfortOf(['iron-stove', 'iron-stove', 'gone'], index)).toBe(3);
    expect(comfortOf(FURNITURE.map(d => d.id), index)).toBe(10);
    expect(comfortMax(FURNITURE)).toBe(10);
    expect(furnitureFor('rack', FURNITURE)?.id).toBe('drying-rack');
    expect(dries(['drying-rack'], index)).toBe(true);
    expect(dries(['iron-stove'], index)).toBe(false);
  });

  it('keeps you cozy five minutes, and a minute more for each point of it, after twenty seconds by your fire', () => {
    expect(COZY_AFTER_S).toBe(20);
    expect(cozySeconds(0)).toBe(5 * 60);
    expect(cozySeconds(3)).toBe(8 * 60);
    expect(cozySeconds(10)).toBe(15 * 60);
  });

  it('makes you tire 10% slower out in the wilds, a Mods factor like a charm\'s', () => {
    expect(COZY_DRAIN).toBe(0.9);
    expect(modsOf({}, [COZY_MODS]).drain).toBe(0.9);
    const woods = new TileMap({
      id: 'woods', name: 'Woods', version: 1, kind: 'wilds', depth: 1, width: 3, height: 3, tiles: ['ggg', 'ggg', 'ggg'], levels: ['000', '000', '000'],
      spawn: { x: 1, y: 1, dir: 'up' }, exits: [{ x: 1, y: 2, w: 1, h: 1, to: 'town', tx: 0, ty: 0, dir: 'down', home: true }], objects: [],
    });
    const plain = energyRate(woods, 1, 0, 'rain'), cozy = energyRate(woods, 1, 0, 'rain', { drain: COZY_DRAIN });
    expect(cozy / plain).toBeCloseTo(0.9, 10);
  });

  it('draws each place its size: a bed two tiles long, the rug three by two and walked over, the rest in the way', () => {
    expect(footprint({ kind: 'comfort', x: 7, y: 1, what: 'bed' })).toEqual([1, 2]);
    expect(footprint({ kind: 'comfort', x: 3, y: 2, what: 'rug' })).toEqual([3, 2]);
    expect(footprint({ kind: 'comfort', x: 1, y: 1, what: 'stove' })).toEqual([1, 1]);
    expect(underfoot({ kind: 'comfort', x: 3, y: 2, what: 'rug' })).toBe(true);
    expect(blocks({ kind: 'comfort', x: 3, y: 2, what: 'rug' })).toBe(false);
    for (const what of COMFORTS.filter(w => w !== 'rug')) expect(blocks({ kind: 'comfort', x: 1, y: 1, what }), what).toBe(true);
    const map = new TileMap(home());
    expect(map.walkable(4, 2)).toBe(true);
    expect(map.walkable(7, 2)).toBe(false);
  });
});

describe('checking the places and the furniture', () => {
  it('keeps the places for furniture to a home of one\'s own, one of each', () => {
    expect(validateMap(home()).filter(p => p.level === 'error')).toEqual([]);
    const notHome = { ...home(), private: undefined, wake: undefined, objects: home().objects.filter(o => o.kind !== 'chest') };
    expect(validateMap(notHome).map(p => p.message)).toContain('comfort at 1,1: a place for furniture is only in a home of one\'s own (private)');
    const twice = home({ objects: [...home().objects, { kind: 'comfort', x: 6, y: 4, what: 'stove' }] });
    expect(validateMap(twice).map(p => p.message)).toContain('comfort at 1,1: a home has one place for its stove');
    const odd = home({ objects: [...home().objects, { kind: 'comfort', x: 6, y: 4, what: 'piano' as never }] });
    expect(validateMap(odd).map(p => p.message)).toContain('comfort at 6,4: it is a place for stove, bed, rug, lamp, rack, shelf, not "piano"');
  });

  const data = (more: Partial<ItemsData> = {}): ItemsData => ({
    version: 1,
    items: [{ id: 'nail', name: 'Nail', kind: 'resource', stack: 5, text: 'Bent.' }, ...FURNITURE],
    finds: [],
    recipes: FURNITURE.map(d => ({ id: d.id, make: d.id, needs: [{ item: 'nail', count: 1 }] })),
    ...more,
  });
  const errors = (d: ItemsData, maps: MapData[] = [home()]) => validateItems(d, maps).filter(p => p.level === 'error').map(p => p.message);

  it('takes furniture that furnishes a place a home has, with comfort, words for what stands spoiled, and made at the workbench', () => {
    expect(validateItems(data(), [home()])).toEqual([]);
    expect(errors(data(), [home({ objects: home().objects.filter(o => !(o.kind === 'comfort' && o.what === 'lamp')) })])).toEqual([
      'item "oil-lamp": furnishes the lamp, but no home has a place for one',
    ]);
    const bad: ItemDef = { id: 'bad', name: 'Bad', kind: 'furniture', stack: 2, furnishes: 'attic' as never, comfort: 0, text: 'Hm.', weight: 3 };
    expect(errors(data({ items: [...data().items, bad] }))).toEqual([
      'item "bad": furniture furnishes a place in the cabin: stove, bed, rug, lamp, rack, shelf',
      'item "bad": furniture adds comfort, a whole number from 1 to 10',
      'item "bad": furniture needs the words for what stands spoiled in its place until it is made (spoiled)',
      'item "bad": furniture stacks one to a slot',
      'item "bad": furniture stands in its place: it is never used, carried or stashed, and earns no XP',
    ]);
    const second: ItemDef = { ...FURNITURE[0]!, id: 'other-stove' };
    expect(errors(data({ items: [...data().items, second] }))).toContain('item "other-stove": iron-stove furnishes the stove already, and a cabin has one place for it');
    expect(errors(data({ items: [...data().items, { id: 'odd', name: 'Odd', kind: 'resource', stack: 1, text: 'Hm.', comfort: 2 }] }))).toContain('item "odd": only furniture furnishes a place, adds comfort, has spoiled words or dries you');
  });

  it('keeps furniture out of bags and stashes: never a find, a parcel, a lockbox\'s, a reveal or paid with', () => {
    const d = data({
      finds: [{ item: 'bed', map: 'home', count: 1, respawn: [1, 2] }],
      recipes: [...data().recipes!, { id: 'nails', make: 'nail', needs: [{ item: 'bed', count: 1 }] }, { id: 'two-rugs', make: 'rag-rug', count: 2, needs: [{ item: 'nail', count: 1 }] }],
      parcels: { welcome: [{ item: 'rag-rug', count: 1 }], week: Array.from({ length: 7 }, () => [{ item: 'nail', count: 1 }]) },
    });
    expect(errors(d)).toEqual([
      'recipe "nails" needs bed: furniture stands in its place in the cabin, never in a bag or a stash',
      'recipe "two-rugs" makes rag-rug, furniture, which has one place: count is 1 or left out',
      'parcels: the welcome parcel: rag-rug: furniture stands in its place in the cabin, never in a bag or a stash',
      'find 0 (bed in home): bed: furniture stands in its place in the cabin, never in a bag or a stash',
    ]);
  });
});
