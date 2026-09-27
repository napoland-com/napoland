/**
 * Time in the world, the same for everyone because it follows the wall clock: the weather's day, and
 * each region's surge clock. Fixed schedules, so players can learn them and share them ("the woods
 * surge at a quarter to"), and the server can restart without the sky jumping.
 *
 * The day: overcast, rain, overcast again, then night. Every third night is an aurora: lights in the
 * sky, dead power lines hum, copper grows back near the poles, creatures get restless.
 *
 * A surge: a region is calm most of the time, then restless for a few minutes (rare finds show up,
 * and it is announced), then a surge sweeps it from its deepest tile toward the way home. Caught in it,
 * away from a street light, energy drains several times faster (energy.ts). Then it is calm again.
 */
import type { Weather } from './protocol';

/** One day of weather, in seconds. */
export const DAY_S = 48 * 60;
const DAY: ReadonlyArray<readonly [Weather, number]> = [['overcast', 12 * 60], ['rain', 12 * 60], ['overcast', 8 * 60], ['night', 16 * 60]];
/** Every this many days, the night is an aurora. */
export const AURORA_EVERY = 3;

/** The weather at a wall clock time (ms since the epoch), and the seconds until it changes. */
export function weatherAt(wallMs: number): { weather: Weather; left: number } {
  const s = wallMs / 1000, day = Math.floor(s / DAY_S);
  let t = s - day * DAY_S;
  for (const [w, len] of DAY) {
    if (t < len) return { weather: w === 'night' && day % AURORA_EVERY === AURORA_EVERY - 1 ? 'aurora' : w, left: len - t };
    t -= len;
  }
  return { weather: 'overcast', left: 1 };
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
