/**
 * Cooking at a fire, and meals (meals.ts): what the woods give cooks into meals, eaten two at a time and
 * never the same one twice, whose effects go into Mods beside the charms'; and the finds they come from,
 * by the water, at the forest's edge, in the clearings and after the rain.
 */
import { describe, expect, it } from 'vitest';
import {
  DAY_S, MEALS_MAX, RESIST_MAX, TileMap, bagShort, carriesFood, charmsIn, cleanMeals, cookable, cooks, findTiles, isMeal, itemIndex, longNightAt, longNightFrom, mealMods, modsOf,
  nearestCooking, payBag, resistOf, seasonAt, sinceRain, validateItems, weatherAt, whyNotEat, type ItemsData, type MapData, type Season,
} from '../src';
import json from '../../../content/items.json';
import woodsJson from '../../../content/maps/near-woods.json';

const data = json as ItemsData;
const items = itemIndex(data);
const cooking = data.cooking!;

describe('meals', () => {
  it('are eaten two at a time, never the same one twice', () => {
    expect(MEALS_MAX).toBe(2);
    expect(whyNotEat('fir-tip-tea', [])).toBeNull();
    expect(whyNotEat('fir-tip-tea', ['fir-tip-tea'])).toBe('ate_it');
    expect(whyNotEat('berry-pemmican', ['fir-tip-tea'])).toBeNull();
    expect(whyNotEat('chanterelle-stew', ['fir-tip-tea', 'berry-pemmican'])).toBe('two_meals');
    // The same one again says so, before that two are eaten already.
    expect(whyNotEat('fir-tip-tea', ['fir-tip-tea', 'berry-pemmican'])).toBe('ate_it');
  });

  it('go into Mods with the feats and the charms: more energy on the bar, cold resistance, a lighter bag', () => {
    const eaten = mealMods(['fir-tip-tea', 'chanterelle-stew'], items);
    expect(eaten).toEqual([{ energy: 15 }, { cold: 0.15 }]);
    expect(modsOf({}, eaten)).toMatchObject({ energy: 15, cold: 0.15, load: 1 });
    // The pemmican and a hollow feather both lighten the bag: their factors multiply.
    const feather = charmsIn([{ item: 'hollow-feather', count: 1 }], items);
    expect(modsOf({}, [...feather, ...mealMods(['berry-pemmican'], items)]).load).toBeCloseTo(0.75 * 0.85, 9);
    // A meal eaten twice (it never is) works once; anything but a meal does nothing.
    expect(mealMods(['fir-tip-tea', 'fir-tip-tea', 'resin', 'lantern'], items)).toEqual([{ energy: 15 }]);
    expect(mealMods(undefined, items)).toEqual([]);
  });

  it('adds a stew\'s cold resistance to what is worn, under the same cap', () => {
    const cold = modsOf({}, mealMods(['chanterelle-stew'], items)).cold;
    expect(resistOf({}, items, {}, { cold }).cold).toBe(0.15);
    // A wool cap (15%) and lined pants (15%) and the stew: 45%.
    expect(resistOf({ cap: 'wool-cap', pants: 'lined-pants' }, items, {}, { cold }).cold).toBe(0.45);
    expect(resistOf({ cap: 'wool-cap' }, items, {}, { cold: 2 }).cold).toBe(RESIST_MAX);
  });

  it('are kept as the game keeps them: known meals, each once, two at most', () => {
    expect(cleanMeals(['berry-pemmican', 'berry-pemmican', 'resin', 7, 'fir-tip-tea', 'chanterelle-stew'], items)).toEqual(['berry-pemmican', 'fir-tip-tea']);
    expect(cleanMeals('fir-tip-tea', items)).toEqual([]);
    expect(isMeal(items.get('fir-tip-tea'))).toBe(true);
    expect(isMeal(items.get('thermos'))).toBe(false);
  });
});

describe('cooking', () => {
  it('cooks at a fire that burns: tended, or with fuel left; never a dead one', () => {
    expect(cooks(null)).toBe(true);
    expect(cooks(90)).toBe(true);
    expect(cooks(0)).toBe(false);
    expect(cooks(undefined)).toBe(false);
  });

  it('pays from the bag: what it lacks, what it can cook, and the nearest', () => {
    const tea = cooking.find(r => r.id === 'fir-tip-tea')!, stew = cooking.find(r => r.id === 'chanterelle-stew')!;
    const bag = [{ item: 'fir-tips', count: 2 }, { item: 'resin', count: 4 }, { item: 'fir-tips', count: 2 }, { item: 'chanterelles', count: 1 }];
    expect(bagShort(tea, bag)).toEqual([]);
    expect(bagShort(stew, bag)).toEqual([{ item: 'chanterelles', count: 2 }, { item: 'fiddleheads', count: 2 }]);
    expect(cookable(cooking, bag).map(r => r.id)).toEqual(['fir-tip-tea']);
    expect(carriesFood(cooking, bag)).toBe(true);
    expect(carriesFood(cooking, [{ item: 'resin', count: 4 }])).toBe(false);
    expect(nearestCooking(cooking, [{ item: 'chanterelles', count: 3 }, { item: 'huckleberries', count: 1 }])?.id).toBe('chanterelle-stew');
    expect(nearestCooking(cooking, [{ item: 'resin', count: 1 }])).toBeUndefined();
    // From the first slot holding it, then the next: three of four fir tips go.
    expect(payBag(bag, tea.needs)).toEqual([{ item: 'resin', count: 4 }, { item: 'fir-tips', count: 1 }, { item: 'chanterelles', count: 1 }]);
  });

  it('makes the three meals of the design from what grows in the Near Woods', () => {
    expect(cooking.map(r => [r.make, r.needs])).toEqual([
      ['fir-tip-tea', [{ item: 'fir-tips', count: 3 }]],
      ['chanterelle-stew', [{ item: 'chanterelles', count: 3 }, { item: 'fiddleheads', count: 2 }]],
      ['berry-pemmican', [{ item: 'huckleberries', count: 5 }]],
    ]);
    expect(Object.fromEntries(cooking.map(r => [r.make, items.get(r.make)!.eaten]))).toEqual({
      'fir-tip-tea': { energy: 15 }, 'chanterelle-stew': { cold: 0.15 }, 'berry-pemmican': { load: 0.85 },
    });
    for (const food of ['huckleberries', 'fiddleheads', 'fir-tips', 'chanterelles']) expect(data.finds.some(f => f.item === food && f.map === 'near-woods'), food).toBe(true);
    expect(data.finds.find(f => f.item === 'chanterelles')).toMatchObject({ when: 'rain', after: 480 });
  });

  it('is checked with the items: a meal that does nothing, cooking what is no meal, food that is not carried', () => {
    const errors = (more: Partial<ItemsData>) => validateItems({ ...data, ...more }, []).filter(p => p.level === 'error' && /cooking|meal/.test(p.message)).map(p => p.message);
    expect(errors({ cooking: [...cooking, { id: 'odd', make: 'resin', needs: [{ item: 'radio', count: 1 }] }] })).toEqual([
      'cooking "odd" makes resin, which is not a meal',
      'cooking "odd" needs radio, which does not cook',
    ]);
    const plain = data.items.map(i => (i.id === 'fir-tip-tea' ? { ...i, eaten: {} } : i));
    expect(errors({ items: plain })).toEqual(['item "fir-tip-tea" is a meal that does nothing (eaten)']);
  });
});

describe('the finds that cook', () => {
  const woods = new TileMap(woodsJson as MapData);
  const tiles = (item: string) => findTiles(woods, data.finds.find(f => f.item === item)!);

  it('grow by the water, at the forest\'s edge, and in the open of the clearings', () => {
    const near = (x: number, y: number, kind: string, r: number) => {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.hypot(dx, dy) <= r && woods.kind(x + dx, y + dy) === kind) return true;
      return false;
    };
    expect(tiles('fiddleheads').length).toBeGreaterThan(20);
    for (const t of tiles('fiddleheads')) expect(near(t.x, t.y, 'water', 1.5)).toBe(true);
    for (const t of tiles('fir-tips')) expect(near(t.x, t.y, 'forest', 1)).toBe(true);
    for (const t of tiles('huckleberries')) expect(near(t.x, t.y, 'forest', 1.5)).toBe(false);
    expect(tiles('huckleberries').length).toBeGreaterThan(50);
  });
});

describe('the rain', () => {
  const WEEK_MS = 7 * 86_400_000;
  /** The second game day of the first week of `season` from late September 2026 (a Monday, 00:00 UTC, is a dawn), `min` minutes after its dawn. */
  const dayOf = (season: Season) => {
    let t = Date.UTC(2026, 8, 28);
    while (seasonAt(t) !== season) t += WEEK_MS;
    return (min: number) => t + DAY_S * 1000 + min * 60_000;
  };
  const woods = (woodsJson as MapData).rain, south = [{ from: 24 * 60, length: 6 * 60 }];

  it('says how long ago it stopped over a region: 0 while it rains, then counting, back to the day before', () => {
    // An autumn day in the Near Woods: rain from 12 to 24 minutes after dawn, then overcast and the night.
    const at = dayOf('autumn');
    expect(weatherAt(at(13), woods).weather).toBe('rain');
    expect(sinceRain(at(13), woods)).toBe(0);
    expect(sinceRain(at(23.5), woods)).toBe(0);
    expect(sinceRain(at(30), woods)).toBe(6 * 60);
    // Before today's rain: yesterday's, which stopped 24 minutes before the day ended.
    expect(sinceRain(at(5), woods)).toBe((24 + 5) * 60);
  });

  it('follows each region\'s own windows, as long as the season makes them', () => {
    // The South Road rains from 24 to 30 minutes after dawn: still raining there when the woods' stopped.
    const at = dayOf('autumn');
    expect(sinceRain(at(29), south)).toBe(0);
    expect(sinceRain(at(29), woods)).toBe(5 * 60);
    expect(sinceRain(at(31), south)).toBe(60);
    // Spring rains half as long again (the woods 12 to 30 minutes), summer half as long (12 to 18).
    expect(sinceRain(dayOf('spring')(29), woods)).toBe(0);
    expect(sinceRain(dayOf('summer')(20), woods)).toBe(2 * 60);
    // The Long Night is dry all day: the morning after it, the last rain fell the day before it, too long ago to count.
    const after = longNightFrom(longNightAt(Date.UTC(2026, 8, 28)).week) + DAY_S * 1000 + 5 * 60_000;
    expect(weatherAt(after - DAY_S * 1000 + 13 * 60_000, woods).weather).toBe('aurora');
    expect(sinceRain(after, woods)).toBe(Infinity);
  });
});
