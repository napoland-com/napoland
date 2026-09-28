/**
 * Coming back (docs/DESIGN.md, the loop): the residents look after whoever comes back, sharing out the
 * town's own stores, since nothing comes into the Zone from outside any more. The first time a player
 * signs in, a welcome parcel waits in their chest at home; after that, the first time they play on each
 * calendar day, signed in, the day's parcel goes into their chest, never into the bag. The parcels follow
 * a calendar of seven days, Monday to Sunday, the same for everyone (`parcels` in content/items.json);
 * whoever came back on all seven days of a week finds more in Sunday's (`allWeek`: a NAPO lockbox).
 * Missing a day costs only that week's extra, a new week starts afresh on Monday, and nothing is ever
 * taken away.
 *
 * The days are calendar days in UTC, not the game's 48-minute days (sky.ts, dayIndex): coming back is
 * about the player's days. Weeks turn on Monday at 00:00 UTC, like the weekly conditions' (sky.ts,
 * weekIndex). Pure functions: the server gives the parcels and keeps each player's ParcelState.
 */
import type { BagSlot } from './items';

/** A calendar day, in ms. */
export const CALENDAR_DAY_MS = 86_400_000;
/** The days of the week, Monday first, as the calendar on the notice board lists them. */
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
/** Every day of a week, one bit each, Monday the lowest. */
export const WHOLE_WEEK = 0b111_1111;

/** How days are counted: how long one lasts, and when day 0 began (ms since the epoch). */
export interface Calendar {
  dayMs: number;
  origin: number;
}

/** Real days: UTC calendar days since 1970-01-01 (day 0, a Thursday). */
export const UTC_CALENDAR: Readonly<Calendar> = { dayMs: CALENDAR_DAY_MS, origin: 0 };

/**
 * Days of `dayMs` that start on a Monday at `start`: a whole week of parcels in minutes, to play-test
 * them (PARCEL_DAY_MS, development only). Day 4 after the epoch was a Monday.
 */
export function quickCalendar(dayMs: number, start: number): Calendar {
  return { dayMs, origin: start - 4 * dayMs };
}

/** The calendar day at a wall time (ms since the epoch). */
export function calendarDay(wall: number, cal: Readonly<Calendar> = UTC_CALENDAR): number {
  return Math.floor((wall - cal.origin) / cal.dayMs);
}

/** The day of the week of a calendar day: 0 is Monday, 6 Sunday. */
export function weekdayOf(day: number): number {
  return (((day + 3) % 7) + 7) % 7;
}

/** The week a calendar day is in. It turns on Monday, the same weeks as sky.ts's weekIndex. */
export function weekOf(day: number): number {
  return Math.floor((day + 3) / 7);
}

/** The parcels, as data (content/items.json). */
export interface ParcelsData {
  /** The first parcel, the first time a player signs in. */
  welcome: BagSlot[];
  /** Each day's parcel, Monday first: seven of them. */
  week: BagSlot[][];
  /** What the last day's parcel also holds for whoever came back on every day of that week. */
  allWeek?: BagSlot[];
}

/** Where a signed-in player stands with the parcels: saved with them. */
export interface ParcelState {
  /** They had their welcome parcel. */
  welcome: boolean;
  /** The calendar day their last parcel came (null: none has yet). */
  day: number | null;
  /** The days of that day's week they came back on: a bit each, Monday the lowest. */
  days: number;
}

/**
 * A parcel that came into your chest: the day of the week it is for (0 Monday to 6 Sunday; null for
 * the welcome parcel), what was in it, and what came besides for coming back on every day of the week.
 */
export interface ParcelView {
  weekday: number | null;
  items: BagSlot[];
  allWeek?: BagSlot[];
}

const copy = (list: readonly BagSlot[] | undefined): BagSlot[] => (list ?? []).map(s => ({ item: s.item, count: s.count }));

/**
 * The parcel due to a signed-in player on calendar day `day`, and where they stand after it; null when
 * none is: they had that day's already, or the day is before their last one (a clock put back). The
 * first is the welcome parcel, and that day counts as one they came back on; then each day's, and on
 * the last day of the week, for whoever came back on all of its days, what `allWeek` adds.
 */
export function nextParcel(data: ParcelsData, state: ParcelState | undefined, day: number): { parcel: ParcelView; state: ParcelState } | null {
  const was = state ?? { welcome: false, day: null, days: 0 };
  if (was.day !== null && day <= was.day) return null;
  const weekday = weekdayOf(day);
  const days = daysThisWeek(was, day) | (1 << weekday);
  const next: ParcelState = { welcome: true, day, days };
  if (!was.welcome) return { parcel: { weekday: null, items: copy(data.welcome) }, state: next };
  const all = weekday === WEEKDAYS.length - 1 && days === WHOLE_WEEK ? copy(data.allWeek) : [];
  return { parcel: { weekday, items: copy(data.week[weekday]), ...(all.length ? { allWeek: all } : {}) }, state: next };
}

/** The days of `day`'s week a player came back on (a bit each, Monday the lowest): none from another week. */
export function daysThisWeek(state: ParcelState | undefined, day: number): number {
  return state && state.day !== null && weekOf(state.day) === weekOf(day) ? state.days & WHOLE_WEEK : 0;
}

/** Did they come back on every day of the week so far, `day` included? Then every day to its end still brings `allWeek`. */
export function everyDaySoFar(days: number, day: number): boolean {
  const sofar = (1 << (weekdayOf(day) + 1)) - 1;
  return (days & sofar) === sofar;
}
