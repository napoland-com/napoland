/**
 * Time in the world, the same for everyone because it follows the wall clock: the weather's day, and
 * each region's surge clock. Fixed schedules, so players can learn them and share them ("the woods
 * surge at a quarter to"), and the server can restart without the sky jumping.
 *
 * The day: overcast from dawn, then night. Day and night are one for the whole world (one sun), and
 * every third night is an aurora: lights in the sky, dead power lines hum, copper grows back near the
 * poles, creatures get restless. Rain is each region's own: its map says when in the day it rains
 * (`rain`, rain windows counted from dawn), so the South Road can be dry while the Near Woods pour.
 * Rain falls only by day; the night is dry everywhere.
 *
 * A surge: a region is calm most of the time, then restless for a few minutes (rare finds show up,
 * and it is announced), then a surge sweeps it from its deepest tile toward the way home. Caught in it,
 * away from a street light, energy drains several times faster (energy.ts). Then it is calm again.
 *
 * Storms keep a clock like a surge's; flashes are the server's own dice, near whoever is out.
 */
import type { Weather } from './protocol';

/** One day of weather, in seconds. */
export const DAY_S = 48 * 60;
/** Night falls this many seconds after dawn: 32 minutes of day, then 16 of night. */
export const NIGHT_FROM = 32 * 60;
/** Every this many days, the night is an aurora. */
export const AURORA_EVERY = 3;

/**
 * When it rains over a region (its map's `rain`): from `from` seconds after dawn, for `length`
 * seconds. Rain falls only by day, so every window ends by nightfall (NIGHT_FROM).
 */
export interface RainWindow {
  from: number;
  length: number;
}

/** The rain of a map that says nothing about it: 12 minutes of it, from 12 minutes after dawn (Stonebrook's and the Near Woods'). */
export const DEFAULT_RAIN: readonly RainWindow[] = [{ from: 12 * 60, length: 12 * 60 }];

/** The day at a wall time, the same everywhere: which day (dayIndex), seconds since its dawn, when its night falls, and whether its night is an aurora. */
export interface DayView {
  day: number;
  into: number;
  night: number;
  aurora: boolean;
}

export function dayAt(wallMs: number): DayView {
  const s = wallMs / 1000, day = Math.floor(s / DAY_S);
  return { day, into: s - day * DAY_S, night: NIGHT_FROM, aurora: day % AURORA_EVERY === AURORA_EVERY - 1 };
}

/**
 * A region's rain windows on a day, as [start, end) seconds after dawn: in order, joined where they
 * touch or overlap, and cut at nightfall, since the night is dry everywhere.
 */
export function rainOf(rain: readonly RainWindow[] | undefined, day: DayView): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const windows = [...(rain ?? DEFAULT_RAIN)].sort((a, b) => a.from - b.from);
  for (const w of windows) {
    const a = Math.max(0, w.from), b = Math.min(day.night, w.from + w.length);
    if (b <= a) continue;
    const last = out.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * The weather over a region at a wall clock time (ms since the epoch), and the seconds until it
 * changes there: the night (or an aurora) everywhere at once, and by day rain in the region's own
 * windows (`rain`, its map's; left out, DEFAULT_RAIN), overcast between them.
 */
export function weatherAt(wallMs: number, rain: readonly RainWindow[] = DEFAULT_RAIN): { weather: Weather; left: number } {
  const d = dayAt(wallMs);
  if (d.into >= d.night) return { weather: d.aurora ? 'aurora' : 'night', left: DAY_S - d.into };
  for (const [a, b] of rainOf(rain, d)) {
    if (d.into < a) return { weather: 'overcast', left: a - d.into };
    if (d.into < b) return { weather: 'rain', left: b - d.into };
  }
  return { weather: 'overcast', left: d.night - d.into };
}

/**
 * A region's rain from now until nightfall, for the notice board: it rains, and stops in `left`
 * seconds; or it is dry, and the next rain comes in `left` seconds. Null: no more rain before night
 * (or it is night already).
 */
export function rainAhead(wallMs: number, rain: readonly RainWindow[] = DEFAULT_RAIN): { raining: boolean; left: number } | null {
  const d = dayAt(wallMs);
  if (d.into >= d.night) return null;
  for (const [a, b] of rainOf(rain, d)) {
    if (d.into < a) return { raining: false, left: a - d.into };
    if (d.into < b) return { raining: true, left: b - d.into };
  }
  return null;
}

/** How a region surges, in seconds: one round every `every`, ending with `unstable` then `surge`. */
export interface SurgeRule {
  every: number;
  unstable: number;
  surge: number;
  /** How long the front takes from the deepest tile to the way home. */
  sweep: number;
  /** Shifts this region's round, so two regions need not surge together. */
  offset?: number;
}

export type SurgePhase = 'calm' | 'unstable' | 'surge';

/** Where a region is in its round: the phase, seconds left of it and seconds into it. */
export interface SurgeView {
  phase: SurgePhase;
  left: number;
  into: number;
}

export function surgeAt(rule: SurgeRule, wallMs: number): SurgeView {
  const t = (((wallMs / 1000 + (rule.offset ?? 0)) % rule.every) + rule.every) % rule.every;
  const calm = rule.every - rule.unstable - rule.surge;
  if (t < calm) return { phase: 'calm', left: calm - t, into: t };
  if (t < calm + rule.unstable) return { phase: 'unstable', left: calm + rule.unstable - t, into: t - calm };
  return { phase: 'surge', left: rule.every - t, into: t - calm - rule.unstable };
}

/**
 * During a surge, the steps from home where its front is: tiles at least this far are in it. It
 * starts at the deepest tile and reaches the way home after `sweep` seconds. Undefined when calm.
 */
export function surgeFront(rule: SurgeRule, deepest: number, s: SurgeView): number | undefined {
  if (s.phase !== 'surge') return undefined;
  return deepest * Math.max(0, 1 - s.into / rule.sweep);
}

/** Seconds from `s` until the next surge starts (0 while one is on). */
export function untilSurge(rule: SurgeRule, s: SurgeView): number {
  if (s.phase === 'surge') return 0;
  return s.phase === 'unstable' ? s.left : s.left + rule.unstable;
}

/**
 * A storm: a region is clear most of the time, then a storm rolls in, announced `warn` seconds
 * before, and blows for `length`. Out in it, it soaks you like rain and the wind and the lightning wear
 * you down (energy.ts); a roof keeps all of it off. Fixed to the wall clock, like a surge.
 */
export interface StormRule {
  every: number;
  warn: number;
  length: number;
  offset?: number;
}

export type StormPhase = 'clear' | 'coming' | 'storm';

/** Where a region is in its storm round: the phase and seconds left of it. */
export interface StormView {
  phase: StormPhase;
  left: number;
}

const STORM_PHASE: Record<SurgePhase, StormPhase> = { calm: 'clear', unstable: 'coming', surge: 'storm' };

/** A storm round has the same shape as a surge's: clear, then the warning, then the storm. */
export function stormAt(rule: StormRule, wallMs: number): StormView {
  const s = surgeAt({ every: rule.every, unstable: rule.warn, surge: rule.length, sweep: rule.length, offset: rule.offset }, wallMs);
  return { phase: STORM_PHASE[s.phase], left: s.left };
}

/**
 * Flashes: every `every` seconds a patch of ground near someone out between `steps` from home glows
 * for FLASH_GLOW_S, then discharges for FLASH_BURST_S. A spark is electric, a fire flash hot; standing
 * in one while it discharges drains energy fast (energy.ts). The glow is the warning: step out of it.
 */
export interface FlashRule {
  every: number;
  steps: [number, number];
}

export type FlashKind = 'spark' | 'fire';
export const FLASH_GLOW_S = 8;
export const FLASH_BURST_S = 4;
/** Tiles, center to center, that a flash covers. */
export const FLASH_RADIUS = 1.5;

/** A flash on tile x,y, over in `left` seconds; it discharges in its last FLASH_BURST_S. */
export interface FlashView {
  x: number;
  y: number;
  kind: FlashKind;
  left: number;
}

/** Does this flash discharge on tile x,y now? */
export function flashHits(f: FlashView, x: number, y: number): boolean {
  return f.left > 0 && f.left <= FLASH_BURST_S && Math.hypot(f.x - x, f.y - y) <= FLASH_RADIUS;
}

/**
 * What the woods are like today: every day (from dawn, when the night ends) a region draws one or two
 * conditions from a list in content/ (thick fog, crates by the pond, the watchers moved north...), and
 * a weekly one everyone shares comes round in a fixed order. The map never changes, only what happens
 * on it. Drawn from the wall clock alone, so nothing is stored: every server and client gets the same
 * answer, and a restart picks up the same day.
 */
export interface ConditionDef {
  id: string;
  name: string;
  /** One or two plain sentences: the notice board reads them out. */
  text: string;
  /** The region it happens in. */
  map: string;
  /** Daily: how likely it is drawn, against the others. */
  weight?: number;
  /** Never two daily conditions of one group on the same day (two about the watchers would fight). */
  group?: string;
  /** You see about this many tiles past yourself, outdoors on `map`. */
  fog?: number;
  /** Watchers wake only this far from home (steps), or not at all. */
  watchers?: { steps?: [number, number]; asleep?: boolean };
  /** One untended fire on `map` (or in its shelters) went out overnight. */
  fireOut?: boolean;
}

export interface ConditionsData {
  seed: number;
  /** The chance of a second daily condition. */
  second: number;
  daily: ConditionDef[];
  weekly: ConditionDef[];
}

/** Today's daily conditions (ids), this week's and next week's. */
export interface ConditionsView {
  today: string[];
  week: string | null;
  next: string | null;
}

/** The day at a wall time: the same one weatherAt uses (dayAt). It starts at dawn (overcast after the night). */
export function dayIndex(wallMs: number): number {
  return Math.floor(wallMs / 1000 / DAY_S);
}

/** The week at a wall time. Weeks turn on Monday at 00:00 UTC (the epoch was a Thursday), always at a dawn. */
export function weekIndex(wallMs: number): number {
  return Math.floor((wallMs / 1000 + 3 * 86400) / 604800);
}

/** Numbers from 0 to 1 that depend only on `n` (mulberry32): the same seed gives the same dice everywhere. */
export function seeded(n: number): () => number {
  let a = n >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The conditions at a wall time: one daily by weight, a second (another group) by chance, and the week's in turn. */
export function conditionsAt(data: ConditionsData | undefined, wallMs: number): ConditionsView {
  if (!data) return { today: [], week: null, next: null };
  const rng = seeded(dayIndex(wallMs) * 7919 + data.seed);
  const pick = (pool: ConditionDef[]): ConditionDef | undefined => {
    let roll = rng() * pool.reduce((n, c) => n + (c.weight ?? 0), 0);
    for (const c of pool) if ((roll -= c.weight ?? 0) < 0) return c;
    return pool.at(-1);
  };
  const first = pick(data.daily);
  const today = first ? [first] : [];
  if (first && rng() < data.second) {
    const second = pick(data.daily.filter(c => c !== first && (first.group === undefined || c.group !== first.group)));
    if (second) today.push(second);
  }
  const n = data.weekly.length, w = weekIndex(wallMs);
  return { today: today.map(c => c.id), week: n ? data.weekly[w % n]!.id : null, next: n ? data.weekly[(w + 1) % n]!.id : null };
}

/** The conditions a view names that are on now (today's and this week's), as defined. */
export function activeConditions(data: ConditionsData | undefined, view: ConditionsView): ConditionDef[] {
  if (!data) return [];
  const on = new Set([...view.today, ...(view.week ? [view.week] : [])]);
  return [...data.daily, ...data.weekly].filter(c => on.has(c.id));
}
