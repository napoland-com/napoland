import { describe, expect, it } from 'vitest';
import {
  DAY_S, DEFAULT_RAIN, ENERGY_MAX, NIGHT_FROM, RESIST_MAX, TileMap, dayAt, effectResist, effectsAfter, energyRate, itemIndex, rainAhead, rainOf, resistOf, validateItems, validateMap,
  weatherAt, type ItemsData, type MapData, type RainWindow,
} from '../src';
import itemsJson from '../../../content/items.json';
import farWoods from '../../../content/maps/far-woods.json';
import nearWoods from '../../../content/maps/near-woods.json';
import southRoad from '../../../content/maps/south-road.json';
import stonebrook from '../../../content/maps/stonebrook.json';

const DAY_MS = DAY_S * 1000;
/** A dawn well past the epoch (its night is a plain one), and a minute of that day. */
const DAWN = 20_001 * DAY_MS;
const at = (minutes: number) => DAWN + minutes * 60_000;
const MIN = 60;

describe('rain, region by region (roadmap/regional-weather.md)', () => {
  const south: RainWindow[] = [{ from: 24 * MIN, length: 6 * MIN }];

  it('keeps one sun: night falls everywhere at once, 32 minutes after dawn, and every third night is an aurora', () => {
    for (const rain of [DEFAULT_RAIN, south, []]) {
      expect(weatherAt(at(31.9), rain).weather).not.toBe('night');
      expect(weatherAt(at(32), rain)).toEqual({ weather: 'night', left: 16 * MIN });
    }
    const auroraDay = [0, 1, 2].map(k => DAWN + k * DAY_MS).find(t => dayAt(t).aurora)!;
    expect(weatherAt(auroraDay + NIGHT_FROM * 1000, south).weather).toBe('aurora');
    expect(weatherAt(auroraDay + NIGHT_FROM * 1000).weather).toBe('aurora');
  });

  it('rains over each region in its own windows, counted from dawn: today\'s cycle when the map says nothing', () => {
    // Today's cycle: overcast 12 minutes, rain 12, overcast until nightfall.
    expect(weatherAt(at(0))).toEqual({ weather: 'overcast', left: 12 * MIN });
    expect(weatherAt(at(12))).toEqual({ weather: 'rain', left: 12 * MIN });
    expect(weatherAt(at(24))).toEqual({ weather: 'overcast', left: 8 * MIN });
    // The same wall clock over a region whose rain comes later and is shorter.
    expect(weatherAt(at(12), south)).toEqual({ weather: 'overcast', left: 12 * MIN });
    expect(weatherAt(at(24), south)).toEqual({ weather: 'rain', left: 6 * MIN });
    expect(weatherAt(at(30), south)).toEqual({ weather: 'overcast', left: 2 * MIN });
    // A region that never rains, and one with two showers.
    expect(weatherAt(at(15), [])).toEqual({ weather: 'overcast', left: 17 * MIN });
    const showers = [{ from: 20 * MIN, length: 2 * MIN }, { from: 5 * MIN, length: 3 * MIN }];
    expect([at(4), at(6), at(10), at(21), at(25)].map(t => weatherAt(t, showers).weather)).toEqual(['overcast', 'rain', 'overcast', 'rain', 'overcast']);
    // It follows the wall clock alone: the same minute of any day is the same weather.
    expect(weatherAt(at(26) + 7 * DAY_MS, south)).toEqual(weatherAt(at(26), south));
  });

  it('joins windows that touch or overlap, and keeps the night dry', () => {
    const d = dayAt(DAWN);
    expect(rainOf([{ from: 600, length: 300 }, { from: 800, length: 400 }, { from: 1200, length: 60 }], d)).toEqual([[600, 1260]]);
    expect(rainOf([{ from: 1800, length: 600 }], d)).toEqual([[1800, NIGHT_FROM]]);
    expect(rainOf(undefined, d)).toEqual([[12 * MIN, 24 * MIN]]);
  });

  it('says for the notice board how long it rains on, or when the next rain comes, until nightfall', () => {
    expect(rainAhead(at(5))).toEqual({ raining: false, left: 7 * MIN });
    expect(rainAhead(at(20))).toEqual({ raining: true, left: 4 * MIN });
    expect(rainAhead(at(25))).toBeNull();
    expect(rainAhead(at(20), south)).toEqual({ raining: false, left: 4 * MIN });
    expect(rainAhead(at(40), south)).toBeNull();
  });

  it('wets you and drains you by the region\'s weather: dry on the South Road while the Near Woods pour', () => {
    const woods = new TileMap(nearWoods as unknown as MapData), road = new TileMap(southRoad as unknown as MapData);
    const t = at(14);
    expect(weatherAt(t, woods.data.rain).weather).toBe('rain');
    expect(weatherAt(t, road.data.rain).weather).toBe('overcast');
    // Twelve minutes later it is the other way round.
    expect(weatherAt(at(26), woods.data.rain).weather).toBe('overcast');
    expect(weatherAt(at(26), road.data.rain).weather).toBe('rain');
    // The same spot drains faster under rain.
    expect(-energyRate(road, 35, 3, 'rain')).toBeGreaterThan(-energyRate(road, 35, 3, 'overcast'));
  });

  it('ships Stonebrook and the Near Woods on today\'s timing, and the South Road later and shorter', () => {
    const rain = (m: unknown) => (m as MapData).rain;
    expect(rain(stonebrook)).toEqual(DEFAULT_RAIN);
    expect(rain(nearWoods)).toEqual(DEFAULT_RAIN);
    const [woods] = DEFAULT_RAIN, [road] = rain(southRoad)!;
    expect(road!.from).toBeGreaterThan(woods!.from);
    expect(road!.length).toBeLessThan(woods!.length);
    // So from the Near Woods' first rain to the South Road's last, one of the two is always dry.
    for (let m = 12; m < 30; m += 0.5) {
      const both = [nearWoods, southRoad].map(map => weatherAt(at(m), rain(map)).weather);
      expect(both, `${m} minutes after dawn`).toContain('overcast');
    }
  });

  it('ships the Far Woods the wettest: two showers a day, and never while the Near Woods rain', () => {
    const windows = rainOf((farWoods as MapData).rain, dayAt(at(0)));
    const minutes = windows.reduce((n, [a, b]) => n + (b - a) / MIN, 0);
    expect(windows.length).toBe(2);
    expect(minutes).toBeGreaterThan(12);
    for (let m = 0; m < 32; m += 0.5) {
      const both = [nearWoods, farWoods].map(map => weatherAt(at(m), (map as MapData).rain).weather);
      expect(both, `${m} minutes after dawn`).toContain('overcast');
    }
  });

  it('checks a map\'s rain: outdoors only, whole seconds, by nightfall, never two windows at once', () => {
    const field = (more: Partial<MapData> = {}): MapData => ({
      id: 'field', name: 'Field', version: 1, kind: 'wilds', depth: 1, width: 3, height: 3,
      tiles: ['ggg', 'ggg', 'tgt'], levels: ['000', '000', '000'], spawn: { x: 1, y: 1, dir: 'up' },
      exits: [{ x: 1, y: 2, w: 1, h: 1, to: 'town', tx: 0, ty: 0, dir: 'down', home: true }], objects: [], ...more,
    });
    const errors = (d: MapData) => validateMap(d).filter(p => p.level === 'error').map(p => p.message);
    expect(errors(field({ rain: [{ from: 0, length: 60 }, { from: 600, length: 60 }] }))).toEqual([]);
    expect(errors(field({ rain: [] }))).toEqual([]);
    expect(errors(field({ rain: [{ from: 1800, length: 300 }] }))).toEqual(['rain: the window from 1800 runs past nightfall (1920 seconds after dawn), and the night is dry']);
    expect(errors(field({ rain: [{ from: 60, length: 600 }, { from: 300, length: 60 }] }))).toEqual(['rain: the windows from 60 and 300 overlap: make them one']);
    expect(errors(field({ rain: [{ from: -5, length: 60 }] }))).toEqual(['rain: each window starts some whole seconds after dawn, from 0, and lasts whole seconds above 0']);
    const room = field({ kind: 'inside', depth: 0, tiles: ['ppp', 'ppp', 'xpx'], exits: [{ x: 1, y: 2, w: 1, h: 1, to: 'field', tx: 0, ty: 0, dir: 'down' }], rain: [{ from: 0, length: 60 }] });
    expect(errors(room)).toEqual(['rain: a room hears the rain of the map its door opens onto, so it has none of its own']);
  });
});

describe('hand warmers and rad tablets: effects for a while', () => {
  const content = itemsJson as unknown as ItemsData, items = itemIndex(content);

  it('ships hand warmers (cold +40%) and rad tablets (radiation +40%) for 5 minutes, found in NAPO\'s first-aid stores and made at the workbench', () => {
    expect(items.get('hand-warmer')).toMatchObject({ kind: 'consumable', use: { resist: { cold: 0.4 }, lasts: 300 } });
    expect(items.get('rad-tablet')).toMatchObject({ kind: 'consumable', use: { resist: { radiation: 0.4 }, lasts: 300 } });
    for (const item of ['hand-warmer', 'rad-tablet']) {
      const maps = new Set(content.finds.filter(f => f.item === item).map(f => f.map));
      expect([...maps].every(m => ['south-road-bunker', 'south-road-laboratory', 'south-road-stores'].includes(m)), item).toBe(true);
      expect(content.recipes!.some(r => r.make === item), item).toBe(true);
    }
    // Between them, the bunker, the laboratory and the stores all keep some.
    expect(new Set(content.finds.filter(f => f.item === 'hand-warmer' || f.item === 'rad-tablet').map(f => f.map))).toEqual(new Set(['south-road-bunker', 'south-road-laboratory', 'south-road-stores']));
  });

  it('adds what each works for on top of the gear, each item once, and never past the cap', () => {
    const coat = { id: 'coat', name: 'Coat', kind: 'gear' as const, stack: 1, text: 'Warm.', slot: 'shirt' as const, resist: { cold: 0.5 } };
    const all = new Map([...items, ['coat', coat]]);
    const warm = effectResist([{ item: 'hand-warmer', left: 120 }], all);
    expect(warm).toEqual({ cold: 0.4 });
    // Two of the same count once: a second one only starts the time again.
    expect(effectResist([{ item: 'hand-warmer', left: 120 }, { item: 'hand-warmer', left: 300 }], all)).toEqual({ cold: 0.4 });
    expect(effectResist([{ item: 'hand-warmer', left: 10 }, { item: 'rad-tablet', left: 10 }], all)).toEqual({ cold: 0.4, radiation: 0.4 });
    // One that is over gives nothing.
    expect(effectResist([{ item: 'hand-warmer', left: 0 }], all)).toEqual({});
    expect(resistOf({ shirt: 'coat' }, all, {}, warm).cold).toBe(RESIST_MAX);
    expect(resistOf({}, all, {}, warm).cold).toBe(0.4);
  });

  it('counts the time down between reports, and lets go of what is over', () => {
    const told = [{ item: 'hand-warmer', left: 30 }, { item: 'rad-tablet', left: 200 }];
    expect(effectsAfter(told, 10)).toEqual([{ item: 'hand-warmer', left: 20 }, { item: 'rad-tablet', left: 190 }]);
    expect(effectsAfter(told, 30)).toEqual([{ item: 'rad-tablet', left: 170 }]);
    expect(effectsAfter(undefined, 1)).toEqual([]);
  });

  it('keeps the cold of the night off: a hand warmer cuts its extra drain by 40%', () => {
    const woods = new TileMap(nearWoods as unknown as MapData);
    const plain = energyRate(woods, 31, 76, 'overcast'), night = energyRate(woods, 31, 76, 'night');
    const warmed = energyRate(woods, 31, 76, 'night', { resist: resistOf({}, items, {}, effectResist([{ item: 'hand-warmer', left: 60 }], items)) });
    expect((warmed - plain) / (night - plain)).toBeCloseTo(0.6, 5);
    expect(ENERGY_MAX / -warmed).toBeGreaterThan(ENERGY_MAX / -night);
  });

  it('checks an effect: a consumable\'s, with what it resists and for how long', () => {
    const data = (use: object, kind: 'consumable' | 'resource' = 'consumable'): ItemsData => ({ version: 1, items: [{ id: 'pill', name: 'Pill', kind, stack: 5, text: 'Small.', use }], finds: [] });
    const errors = (d: ItemsData) => validateItems(d, []).filter(p => p.level === 'error').map(p => p.message);
    expect(errors(data({ resist: { cold: 0.3 }, lasts: 120 }))).toEqual([]);
    expect(errors(data({ resist: { cold: 0.3 } }))).toContain('item "pill": an effect lasts some whole seconds above 0');
    expect(errors(data({ lasts: 120 }))).toContain('item "pill": an effect resists something (resist)');
    expect(errors(data({ resist: { damp: 0.3 }, lasts: 120 }))).toContain('item "pill": its effect resists an unknown element damp');
    expect(errors(data({ resist: { cold: 1.5 }, lasts: 120 }))).toContain('item "pill": its effect\'s resistance is a share above 0, at most 1');
    expect(errors(data({ resist: { cold: 0.3 }, lasts: 120 }, 'resource'))).toContain('item "pill": only a consumable gives an effect for a while (resist, lasts)');
  });
});
