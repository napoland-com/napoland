/**
 * The Long Night from the wall clock (roadmap/long-night.md): the game day that dawns on Saturday at
 * 19:12 UTC, once a week, is all night under an aurora, in every season and every region; what its
 * bonus grows back faster is data, checked like the rest; and its fire, the lodge's, is one, in town.
 */
import { describe, expect, it } from 'vitest';
import {
  DAY_S, LONG_NIGHT_DAY, dayAt, dayIndex, isLongNight, itemIndex, longNightAt, longNightFrom, longNightWords, rainAhead, seasonAt, validateItems, validateMap, validateWorld, weatherAt,
  weekIndex, type ItemsData, type MapData, type MapObject,
} from '../src';
import itemsJson from '../../../content/items.json';
import southRoad from '../../../content/maps/south-road.json';

const DAY_MS = DAY_S * 1000, WEEK_MS = 7 * 86_400_000;
/** Saturday 3 October 2026, 19:12 UTC: a Long Night's dawn. */
const NIGHT = Date.UTC(2026, 9, 3, 19, 12);

describe('when it is', () => {
  it('dawns on Saturday at 19:12 UTC, once a week, and lasts one game day, until 20:00', () => {
    expect(longNightFrom(weekIndex(NIGHT))).toBe(NIGHT);
    for (let k = -60; k <= 60; k++) {
      const at = new Date(longNightFrom(weekIndex(NIGHT) + k));
      expect([at.getUTCDay(), at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds()]).toEqual([6, 19, 12, 0]);
    }
    const week = weekIndex(NIGHT);
    expect(longNightAt(NIGHT - 1000)).toEqual({ on: false, left: 1, week });
    expect(longNightAt(NIGHT)).toEqual({ on: true, left: DAY_S, week });
    expect(longNightAt(NIGHT + DAY_MS - 1000)).toEqual({ on: true, left: 1, week });
    // Over at 20:00: the next is a week on, next week's.
    expect(longNightAt(NIGHT + DAY_MS)).toEqual({ on: false, left: (WEEK_MS - DAY_MS) / 1000, week: week + 1 });
    // From the Monday it belongs to.
    const monday = Date.UTC(2026, 8, 28);
    expect(longNightAt(monday)).toEqual({ on: false, left: (NIGHT - monday) / 1000, week });
  });

  it('is one game day of the 210 in each week, always the same one: the 175th', () => {
    const first = dayIndex(Date.UTC(2026, 8, 28));
    for (let w = 0; w < 8; w++) {
      const days = Array.from({ length: 210 }, (_, d) => first + w * 210 + d).filter(isLongNight);
      expect(days).toEqual([first + w * 210 + LONG_NIGHT_DAY]);
    }
    expect(isLongNight(dayIndex(NIGHT))).toBe(true);
    expect([dayIndex(NIGHT) - 1, dayIndex(NIGHT) + 1].map(isLongNight)).toEqual([false, false]);
  });

  it('is all night under an aurora in every season and every region: no rain, and no dusk to wait for', () => {
    for (let k = 0; k < 4; k++) {
      const at = NIGHT + k * WEEK_MS, season = seasonAt(at);
      expect(dayAt(at + 13 * 60_000), season).toMatchObject({ long: true, night: 0, aurora: true, into: 13 * 60 });
      for (const rain of [undefined, (southRoad as MapData).rain]) {
        expect(weatherAt(at + 13 * 60_000, rain), season).toEqual({ weather: 'aurora', left: DAY_S - 13 * 60 });
        expect(weatherAt(at + 25 * 60_000, rain).weather, season).toBe('aurora');
        expect(rainAhead(at, rain), season).toBeNull();
      }
    }
    // The night before is an aurora (every third), and the day after dawns like any other.
    expect(weatherAt(NIGHT - 60_000).weather).toBe('aurora');
    expect(weatherAt(NIGHT + DAY_MS)).toEqual({ weather: 'overcast', left: 12 * 60 });
    expect(dayAt(NIGHT + DAY_MS)).toMatchObject({ long: false, aurora: false });
    // The day before is its usual day: 13 minutes after its dawn, it rains.
    expect(weatherAt(NIGHT - DAY_MS + 13 * 60_000).weather).toBe('rain');
  });
});

describe('its bonus, as data', () => {
  const content = itemsJson as ItemsData, items = itemIndex(content);

  it('grows wire and strange objects back twice as fast, in words the notice board and the banners share', () => {
    expect(content.longNight).toEqual({ items: ['wire', 'strange'], regrow: 2 });
    expect(longNightWords(content.longNight, items)).toBe('wire and strange objects grow back twice as fast');
    expect(longNightWords({ items: ['wire'], regrow: 3 }, items)).toBe('wire grows back 3 times as fast');
    expect(longNightWords({ items: ['strange'], regrow: 2 }, items)).toBe('strange objects grow back twice as fast');
    expect(longNightWords(undefined, items)).toBe('');
  });

  it('is checked: items that exist and grow somewhere, each once, faster but not by much', () => {
    const field: MapData = {
      id: 'field', name: 'The Field', version: 1, kind: 'wilds', depth: 1, width: 5, height: 5, tiles: Array<string>(5).fill('ggggg'), levels: Array<string>(5).fill('00000'),
      spawn: { x: 2, y: 2, dir: 'up' }, exits: [{ x: 2, y: 4, w: 1, h: 1, to: 'town', tx: 0, ty: 0, dir: 'down', home: true }], objects: [],
    };
    const data = (longNight: ItemsData['longNight']): ItemsData => ({
      version: 1,
      items: [{ id: 'wire', name: 'Copper wire', kind: 'resource', stack: 10, text: 'It hums.' }, { id: 'moss', name: 'Moss', kind: 'resource', stack: 3, text: 'Soft.' }],
      finds: [{ item: 'wire', map: 'field', count: 1, respawn: [10, 20] }],
      longNight,
    });
    const said = (longNight: ItemsData['longNight']) => validateItems(data(longNight), [field]).filter(p => p.message.startsWith('longNight')).map(p => `${p.level}: ${p.message}`);
    expect(said({ items: ['wire'], regrow: 2 })).toEqual([]);
    expect(said({ items: ['nothing'], regrow: 2 })).toEqual(['error: longNight: there is no item nothing']);
    expect(said({ items: ['moss'], regrow: 2 })).toEqual(['warning: longNight: moss grows back faster, but no find grows it']);
    expect(said({ items: ['wire', 'wire'], regrow: 2 })).toEqual(['error: longNight: an item is listed twice']);
    expect(said({ items: [], regrow: 2 })).toEqual(['error: longNight: items lists what grows back faster that night']);
    for (const regrow of [1, 5]) expect(said({ items: ['wire'], regrow })).toEqual(['error: longNight: regrow is how many times as fast, above 1 and at most 4']);
  });
});

describe('its fire', () => {
  /** A 6x6 town with doors into a lodge (1,0) and the home (4,0), and the woods off it, with a hut; `fires` puts fireplaces in them. */
  const world = (fires: Partial<Record<'lodge' | 'home' | 'hut' | 'woods', MapObject>>): MapData[] => {
    const room = (id: string, name: string, to: string, tx: number, more: Partial<MapData> = {}): MapData => ({
      id, name, version: 1, kind: 'inside', depth: 0, width: 5, height: 5, tiles: ['xxxxx', 'xpppx', 'xpppx', 'xpppx', 'xxpxx'], levels: Array<string>(5).fill('00000'),
      spawn: { x: 2, y: 3, dir: 'up' }, exits: [{ x: 2, y: 4, w: 1, h: 1, to, tx, ty: 1, dir: 'down' }], objects: [], ...more,
    });
    const town: MapData = {
      id: 'town', name: 'Town', version: 1, kind: 'town', depth: 0, width: 6, height: 6, tiles: Array<string>(6).fill('gggggg'), levels: Array<string>(6).fill('000000'),
      spawn: { x: 2, y: 3, dir: 'down' },
      exits: [
        { x: 1, y: 0, w: 1, h: 1, to: 'lodge', tx: 2, ty: 3, dir: 'up' },
        { x: 4, y: 0, w: 1, h: 1, to: 'home', tx: 2, ty: 3, dir: 'up' },
        { x: 2, y: 5, w: 1, h: 1, to: 'woods', tx: 2, ty: 1, dir: 'down' },
      ],
      objects: [],
    };
    const woods: MapData = {
      id: 'woods', name: 'The Woods', version: 1, kind: 'wilds', depth: 1, width: 5, height: 5, tiles: Array<string>(5).fill('ggggg'), levels: Array<string>(5).fill('00000'),
      spawn: { x: 2, y: 2, dir: 'down' },
      exits: [{ x: 2, y: 0, w: 1, h: 1, to: 'town', tx: 2, ty: 4, dir: 'up', home: true }, { x: 2, y: 4, w: 1, h: 1, to: 'hut', tx: 2, ty: 3, dir: 'up' }],
      objects: fires.woods ? [fires.woods] : [],
    };
    const put = (m: MapData, f: MapObject | undefined) => (f ? { ...m, objects: [...m.objects, f] } : m);
    return [
      town, woods,
      put(room('lodge', 'The Lodge', 'town', 1), fires.lodge),
      put(room('home', 'Home', 'town', 4, { wake: { x: 2, y: 3, dir: 'up' }, objects: [{ kind: 'chest', x: 1, y: 1 }] }), fires.home),
      put(room('hut', 'The Hut', 'woods', 2, { exits: [{ x: 2, y: 4, w: 1, h: 1, to: 'woods', tx: 2, ty: 3, dir: 'down' }] }), fires.hut),
    ];
  };
  const night = (x = 2): MapObject => ({ kind: 'fireplace', x, y: 1, longNight: true });
  const said = (maps: MapData[]) => validateWorld(maps, 'town').filter(p => p.message.startsWith('longNight')).map(p => `${p.map}: ${p.message}`);

  it('is one fire, in a room off the home town that is not the home, never tended by the map, never out in the wilds', () => {
    expect(said(world({ lodge: night() }))).toEqual([]);
    expect(said(world({ home: night(2) }))).toEqual(['home: longNight: the fire nobody tends on the Long Night is in a room off town that is not the home']);
    expect(said(world({ hut: night() }))).toEqual(['hut: longNight: the fire nobody tends on the Long Night is in a room off town that is not the home']);
    expect(said(world({ lodge: night(), home: night(3) }))).toEqual([
      'home: longNight: the fire nobody tends on the Long Night is in a room off town that is not the home',
      'home: longNight: one fire in the world goes untended on the Long Night, the lodge\'s',
    ]);
    const map = (o: MapObject) => validateMap(world({ lodge: o })[2]!).filter(p => p.message.includes('longNight')).map(p => p.message);
    expect(map(night())).toEqual([]);
    expect(map({ kind: 'fireplace', x: 2, y: 1, longNight: true, tended: true })).toEqual(['fireplace at 2,1: longNight is true or left out, on a fire in a room in town that nobody marked tended']);
    expect(map({ kind: 'fireplace', x: 2, y: 1, longNight: false })).toEqual(['fireplace at 2,1: longNight is true or left out, on a fire in a room in town that nobody marked tended']);
    expect(validateMap(world({ woods: night() })[1]!).map(p => p.message)).toContain('fireplace at 2,1: longNight is true or left out, on a fire in a room in town that nobody marked tended');
  });
});
