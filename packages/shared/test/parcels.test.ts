import { describe, expect, it } from 'vitest';
import {
  CALENDAR_DAY_MS, STARTER_TOOLS, WEEKDAYS, WHOLE_WEEK, calendarDay, daysThisWeek, everyDaySoFar, gift, itemIndex, nextParcel, openInStash, openSealed, quickCalendar, store, takeOut, validateItems,
  weekIndex, weekOf, weekdayOf, type ItemDef, type ItemsData, type MapData, type ParcelState, type ParcelsData,
} from '../src';

/** Monday 28 September 2026, 00:00 UTC, and the calendar day it is. */
const MONDAY = Date.UTC(2026, 8, 28);
const MON = MONDAY / CALENDAR_DAY_MS;

/** A small calendar: one thing a day, so each parcel says which day it is; a lockbox for the whole week. */
const DATA: ParcelsData = {
  welcome: [{ item: 'resin', count: 5 }, { item: 'cloth', count: 4 }],
  week: WEEKDAYS.map((_, i) => [{ item: 'resin', count: i + 1 }]),
  allWeek: [{ item: 'lockbox', count: 1 }],
};
const signedInOn = (day: number): ParcelState => nextParcel(DATA, undefined, day)!.state;
/** Plays on each of `days` in turn, from `state`: where they stand after the last. */
const playOn = (state: ParcelState | undefined, days: number[]) => days.reduce<ParcelState | undefined>((s, d) => nextParcel(DATA, s, d)?.state ?? s, state);

describe('the calendar the parcels follow', () => {
  it('counts calendar days in UTC, turning at midnight, not at the game\'s dawn', () => {
    expect(Number.isInteger(MON)).toBe(true);
    expect(calendarDay(MONDAY)).toBe(MON);
    expect(calendarDay(MONDAY - 1)).toBe(MON - 1);
    expect(calendarDay(MONDAY + CALENDAR_DAY_MS - 1)).toBe(MON);
    expect(calendarDay(0)).toBe(0);
  });

  it('knows the day of the week, Monday first, and the week, which turns when the weekly conditions\' does', () => {
    expect(WEEKDAYS[weekdayOf(MON)]).toBe('Monday');
    expect(WEEKDAYS[weekdayOf(MON + 6)]).toBe('Sunday');
    expect(WEEKDAYS[weekdayOf(0)]).toBe('Thursday');
    expect(weekdayOf(MON + 7)).toBe(0);
    expect(weekOf(MON + 6)).toBe(weekOf(MON));
    expect(weekOf(MON + 7)).toBe(weekOf(MON) + 1);
    for (const at of [MONDAY - 1, MONDAY, MONDAY + 3 * CALENDAR_DAY_MS + 5000, MONDAY + 7 * CALENDAR_DAY_MS - 1]) expect(weekOf(calendarDay(at))).toBe(weekIndex(at));
  });

  it('can run in short days for a play-test, starting on a Monday', () => {
    const start = 1_700_000_123_456, cal = quickCalendar(20_000, start);
    expect(weekdayOf(calendarDay(start, cal))).toBe(0);
    expect(weekdayOf(calendarDay(start + 19_999, cal))).toBe(0);
    expect(weekdayOf(calendarDay(start + 20_000, cal))).toBe(1);
    expect(weekdayOf(calendarDay(start + 6 * 20_000, cal))).toBe(6);
  });
});

describe('a parcel a day', () => {
  it('gives the welcome parcel the first time, which counts as a day they came back on', () => {
    const first = nextParcel(DATA, undefined, MON + 2)!;
    expect(first.parcel).toEqual({ weekday: null, items: DATA.welcome });
    expect(first.state).toEqual({ welcome: true, day: MON + 2, days: 0b100 });
  });

  it('gives nothing more that day, and each later day that day\'s parcel', () => {
    const state = signedInOn(MON);
    expect(nextParcel(DATA, state, MON)).toBeNull();
    const tue = nextParcel(DATA, state, MON + 1)!;
    expect(tue.parcel).toEqual({ weekday: 1, items: [{ item: 'resin', count: 2 }] });
    expect(tue.state).toEqual({ welcome: true, day: MON + 1, days: 0b11 });
    expect(nextParcel(DATA, tue.state, MON + 1)).toBeNull();
    // A day missed: the next one comes all the same, and only the days they came back on count.
    const thu = nextParcel(DATA, tue.state, MON + 3)!;
    expect(thu.parcel.weekday).toBe(3);
    expect(thu.state.days).toBe(0b1011);
  });

  it('gives nothing for a day before the last one (a clock put back)', () => {
    expect(nextParcel(DATA, signedInOn(MON + 3), MON + 2)).toBeNull();
  });

  it('adds the lockbox to Sunday\'s parcel only for whoever came back on all seven days of that week', () => {
    const allWeek = playOn(undefined, [MON, MON + 1, MON + 2, MON + 3, MON + 4, MON + 5])!;
    const sunday = nextParcel(DATA, allWeek, MON + 6)!;
    expect(sunday.parcel).toEqual({ weekday: 6, items: [{ item: 'resin', count: 7 }], allWeek: [{ item: 'lockbox', count: 1 }] });
    expect(sunday.state.days).toBe(WHOLE_WEEK);
    // One day missed, Wednesday: Sunday's parcel as it always is.
    const missed = playOn(undefined, [MON, MON + 1, MON + 3, MON + 4, MON + 5])!;
    expect(nextParcel(DATA, missed, MON + 6)!.parcel).toEqual({ weekday: 6, items: [{ item: 'resin', count: 7 }] });
  });

  it('starts every week afresh on Monday: last week\'s days count for nothing, and nothing is taken away', () => {
    const lastWeek = playOn(undefined, [MON - 7, MON - 6, MON - 5, MON - 4, MON - 3, MON - 2])!;
    const monday = nextParcel(DATA, lastWeek, MON)!;
    expect(monday.state).toEqual({ welcome: true, day: MON, days: 0b1 });
    expect(monday.parcel).toEqual({ weekday: 0, items: [{ item: 'resin', count: 1 }] });
    // Playing Sunday alone after last week's six is no week of seven.
    expect(nextParcel(DATA, lastWeek, MON + 6)!.parcel.allWeek).toBeUndefined();
  });

  it('says which days of a week someone came back on, and whether every day so far', () => {
    const state = playOn(undefined, [MON, MON + 1, MON + 3]);
    expect(daysThisWeek(state, MON + 3)).toBe(0b1011);
    expect(daysThisWeek(state, MON + 7)).toBe(0);
    expect(daysThisWeek(undefined, MON)).toBe(0);
    expect(everyDaySoFar(0b11, MON + 1)).toBe(true);
    expect(everyDaySoFar(0b1011, MON + 3)).toBe(false);
    expect(everyDaySoFar(WHOLE_WEEK, MON + 6)).toBe(true);
    // A week from the first sign-in on Monday on: Sunday brings the lockbox.
    const week = playOn(undefined, [MON, MON + 1, MON + 2, MON + 3, MON + 4, MON + 5]);
    expect(nextParcel(DATA, week, MON + 6)!.parcel.allWeek).toEqual([{ item: 'lockbox', count: 1 }]);
  });
});

const ITEMS: ItemDef[] = [
  { id: 'resin', name: 'Fir resin', noun: 'resin', plural: 'resin', kind: 'resource', stack: 20, xp: 2, text: 'Sticky.' },
  { id: 'cloth', name: 'Cloth scraps', noun: 'cloth', plural: 'cloth', kind: 'resource', stack: 10, xp: 2, text: 'Dry.' },
  { id: 'shard', name: 'Anomaly shard', noun: 'shard', kind: 'resource', stack: 5, xp: 12, text: 'Warm.', about: 'The Old Stone wants it.' },
  { id: 'pebble', name: 'Warm pebble', kind: 'charm', stack: 1, xp: 25, text: 'Warm.', charm: { wetting: 0.6 }, about: 'Rain soaks you slower.' },
  { id: 'feather', name: 'Hollow feather', kind: 'charm', stack: 1, xp: 25, text: 'Light.', charm: { load: 0.75 }, about: 'Your bag feels lighter.' },
  {
    id: 'lockbox', name: 'NAPO lockbox', noun: 'NAPO lockbox', plural: 'NAPO lockboxes', kind: 'sealed', stack: 1, text: 'Sealed.', seal: 'It has been sealed since the evacuation.',
    holds: [{ weight: 3, items: [{ item: 'shard', count: 3 }] }, { weight: 2, any: 'charm' }, { weight: 3, items: [{ item: 'cloth', count: 6 }, { item: 'resin', count: 4 }] }],
  },
];
const byId = new Map(ITEMS.map(i => [i.id, i]));
const lockbox = byId.get('lockbox')!;
/** Dice that give these rolls in turn. */
const dice = (...rolls: number[]) => () => rolls.shift() ?? 0;

describe('the NAPO lockbox', () => {
  it('holds one of its holdings, by weight', () => {
    // Weights 3, 2 and 3 out of 8: below 3/8 the shards, then a charm, from 5/8 the cloth and resin.
    expect(openSealed(lockbox, ITEMS, dice(0))).toEqual([{ item: 'shard', count: 3 }]);
    expect(openSealed(lockbox, ITEMS, dice(0.374))).toEqual([{ item: 'shard', count: 3 }]);
    expect(openSealed(lockbox, ITEMS, dice(0.625))).toEqual([{ item: 'cloth', count: 6 }, { item: 'resin', count: 4 }]);
    expect(openSealed(lockbox, ITEMS, dice(0.999))).toEqual([{ item: 'cloth', count: 6 }, { item: 'resin', count: 4 }]);
  });

  it('holds any one charm, each as likely as the next', () => {
    expect(openSealed(lockbox, ITEMS, dice(0.5, 0))).toEqual([{ item: 'pebble', count: 1 }]);
    expect(openSealed(lockbox, ITEMS, dice(0.5, 0.49))).toEqual([{ item: 'pebble', count: 1 }]);
    expect(openSealed(lockbox, ITEMS, dice(0.5, 0.5))).toEqual([{ item: 'feather', count: 1 }]);
    expect(openSealed(lockbox, ITEMS, dice(0.5, 0.9999))).toEqual([{ item: 'feather', count: 1 }]);
  });

  it('holds what the weights say, over many openings', () => {
    let seed = 7;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const seen = new Map<string, number>();
    for (let i = 0; i < 8000; i++) {
      const got = openSealed(lockbox, ITEMS, rng)[0]!.item;
      seen.set(got, (seen.get(got) ?? 0) + 1);
    }
    expect(seen.get('shard')! / 8000).toBeCloseTo(3 / 8, 1);
    expect(seen.get('cloth')! / 8000).toBeCloseTo(3 / 8, 1);
    expect((seen.get('pebble')! + seen.get('feather')!) / 8000).toBeCloseTo(2 / 8, 1);
    expect(seen.get('pebble')! / seen.get('feather')!).toBeCloseTo(1, 0);
  });

  it('holds nothing when it has no holdings', () => {
    expect(openSealed({ ...lockbox, holds: [] }, ITEMS, dice(0.5))).toEqual([]);
  });
});

describe('what a parcel puts in the stash', () => {
  it('earns no XP, and what is taken out of it and brought back earns nothing either', () => {
    const s = gift({ items: { resin: 2 }, out: { cloth: 1 } }, [{ item: 'resin', count: 5 }, { item: 'cloth', count: 4 }, { item: 'nothing', count: 3 }], byId);
    expect(s).toEqual({ items: { resin: 7, cloth: 4 }, out: { cloth: 1 } });
    const taken = takeOut(s, 'resin', 7);
    expect(taken.taken).toBe(7);
    expect(store(taken.stash, [{ item: 'resin', count: 7 }], byId)).toEqual({ stash: { items: { resin: 7, cloth: 4 }, out: { cloth: 1 } }, xp: 0 });
  });

  it('opens one lockbox at a time, what it held coming in as a gift', () => {
    const s = { items: { lockbox: 2, shard: 1 }, out: {} };
    expect(openInStash(s, 'lockbox', [{ item: 'shard', count: 3 }], byId)).toEqual({ items: { lockbox: 1, shard: 4 }, out: {} });
    expect(openInStash({ items: { lockbox: 1 }, out: {} }, 'lockbox', [{ item: 'pebble', count: 1 }], byId)).toEqual({ items: { pebble: 1 }, out: {} });
    expect(openInStash({ items: {}, out: {} }, 'lockbox', [], byId)).toBeUndefined();
  });
});

describe('checking the parcels and sealed things in content', () => {
  const room: MapData = {
    id: 'room', name: 'Room', version: 1, kind: 'town', depth: 0, width: 3, height: 3, tiles: ['ggg', 'ggg', 'ggg'], levels: ['000', '000', '000'],
    spawn: { x: 1, y: 1, dir: 'down' }, exits: [], objects: [],
  };
  // The starter tools, as every world with tools has them (validateItems): the first stands for any tool.
  const tools = STARTER_TOOLS.map((id): ItemDef => ({ id, name: `Map ${id}`, kind: 'tool', stack: 1, icon: 'map', text: 'A map.' }));
  const map = tools[0]!;
  const data = (d: Partial<ItemsData>): ItemsData => ({ version: 1, items: [...ITEMS, ...tools], finds: [], parcels: DATA, ...d });
  const errors = (d: Partial<ItemsData>) => validateItems(data(d), [room]).filter(p => p.level === 'error').map(p => p.message);

  it('takes a well-made calendar and lockbox', () => {
    expect(validateItems(data({}), [room])).toEqual([]);
    expect(itemIndex(data({})).get('lockbox')?.kind).toBe('sealed');
  });

  it('wants a parcel for each of the seven days, each of things that lie in a stash', () => {
    expect(errors({ parcels: { ...DATA, week: DATA.week.slice(1) } })).toEqual(['parcels: week is a parcel for each of the 7 days, Monday first']);
    expect(errors({ parcels: { ...DATA, welcome: [] } })).toEqual(['parcels: the welcome parcel: a list of items and counts, not empty']);
    expect(errors({ parcels: { ...DATA, allWeek: [{ item: map.id, count: 1 }] } })).toEqual([`parcels: allWeek: ${map.id} is a tool, which never lies in a stash`]);
    const week = DATA.week.map((d, i) => (i === 2 ? [{ item: 'tea', count: 0 }] : d));
    expect(errors({ parcels: { ...DATA, week } })).toEqual(["parcels: Wednesday's parcel: tea is not an item", "parcels: Wednesday's parcel: each count is a whole number from 1"]);
  });

  it('wants a sealed thing to hold something, by weight, earn no XP and hold no sealed thing', () => {
    const sealed = (more: Partial<ItemDef>) => ({ items: [...ITEMS.filter(i => i.id !== 'lockbox'), ...tools, { ...lockbox, ...more }] });
    expect(errors(sealed({ holds: [] }))).toEqual(['item "lockbox": a sealed thing holds something']);
    expect(errors(sealed({ xp: 10 }))).toEqual(['item "lockbox": a sealed thing is only opened, at the chest, and earns no XP']);
    expect(errors(sealed({ holds: [{ weight: 0, any: 'charm' }] }))).toEqual(['item "lockbox": holding 1: its weight is above 0']);
    expect(errors(sealed({ holds: [{ weight: 1, any: 'charm', items: [{ item: 'shard', count: 1 }] }] }))).toEqual(['item "lockbox": holding 1: it is some items, or any one of a kind']);
    expect(errors(sealed({ holds: [{ weight: 1, items: [{ item: 'lockbox', count: 1 }] }] }))).toEqual(['item "lockbox": holding 1: lockbox is sealed too']);
    expect(errors(sealed({ holds: [{ weight: 1, any: 'gear' }] }))).toEqual(['item "lockbox": holding 1: any is resource, consumable or charm']);
    expect(errors(sealed({ holds: [{ weight: 1, any: 'consumable' }] }))).toEqual(['item "lockbox": holding 1: any consumable, but there is none']);
    expect(errors({ items: [...ITEMS, ...tools, { id: 'box', name: 'Box', kind: 'resource', stack: 1, text: 'A box.', holds: lockbox.holds }] })).toEqual(['item "box": only a sealed thing holds something']);
  });

  it('warns when one thing a lockbox may hold alone has no line to say what it is good for', () => {
    const plain = { ...lockbox, holds: [{ weight: 1, items: [{ item: 'resin', count: 3 }] }] };
    expect(validateItems({ ...data({}), items: [...ITEMS.filter(i => i.id !== 'lockbox'), ...tools, plain] }, [room])).toEqual([
      { level: 'warning', message: 'item "resin": lockbox may hold it, but it has no about line to say what it is good for' },
    ]);
  });
});
