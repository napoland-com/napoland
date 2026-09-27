/**
 * Energy: the one thing a trip spends. It drains out in the wilds, faster the deeper you are and in
 * bad weather; in town and inside buildings it holds. It only comes back next to a burning fire
 * (shelters out in the wilds keep one, if someone feeds it; the fires in town and at home are always
 * tended). At zero you collapse and wake up at home. Street lights do not give energy: light is for
 * seeing, and for hiding from a surge.
 *
 * What else wears you down out there, each a factor on the drain:
 * - a heavy bag (load: what it weighs against what you carry easily),
 * - being wet (rain soaks you through; a fire or a roof dries you),
 * - a surge sweeping the region (surge.ts), unless you stand in a street light,
 * - something clinging to your back at night (a hitchhiker), until you reach light or a roof.
 *
 * The server owns the numbers; the client only shows them (and counts between updates using `rate`).
 * Tuning targets: standing at the woods' edge in the rain, dry and light, empties a full bar in about
 * 5.5 minutes, the deep end of the Near Woods in under 2, so the shelters' fires matter.
 */
import type { Resist } from './gear';
import type { MapKind, TileMap } from './map';
import type { Weather } from './protocol';

/** A full bar, before levels raise it. */
export const ENERGY_MAX = 100;
/** Energy per second lost at a depth-1 region's home exit, in overcast weather. */
export const DRAIN_PER_SECOND = 0.24;
/** Every this many steps away from the home exit adds DRAIN_PER_SECOND again. */
export const DRAIN_GROWTH_STEPS = 60;
/** Energy per second gained next to a well-fed fire. */
export const REFILL_PER_SECOND = 8;
/** Bad weather drains faster. An aurora is a night with lights in the sky. */
export const WEATHER_DRAIN: Readonly<Record<Weather, number>> = { overcast: 1, rain: 1.25, night: 1.5, aurora: 1.5 };
/** The server repeats a player's energy this often, so the client's count never drifts far. */
export const ENERGY_SYNC_MS = 2000;
/** A full load (load 1 or more) drains this much more: 0.4 is 40% faster. */
export const LOAD_DRAIN = 0.4;
/** Soaked through (wet 1) drains this much more. */
export const WET_DRAIN = 0.5;
/** Caught in a surge, away from a street light, drains this many times faster. */
export const SURGE_DRAIN = 3;
/** A hitchhiker on your back drains this many times faster. */
export const HITCH_DRAIN = 1.5;

/** The most a fire out there holds: this many seconds of burning. */
export const FIRE_MAX_S = 30 * 60;
/** Below this many seconds of fuel a fire is low: it only glows. */
export const FIRE_LOW_S = 3 * 60;
/** How warm a low fire still is, against a well-fed one. */
export const EMBERS = 0.4;

/** How warm a fire is with `left` seconds of fuel (null: tended, always well fed): 1, EMBERS, or 0 when out. */
export function fireHeat(left: number | null): number {
  if (left === null) return 1;
  return left >= FIRE_LOW_S ? 1 : left > 0 ? EMBERS : 0;
}

/** Seconds of steady rain to soak you through, dry to wet 1. */
export const WET_SECONDS = 150;
/** Seconds to dry off completely: by a burning fire, under a roof, outdoors when it does not rain. */
export const DRY_FIRE_SECONDS = 25;
export const DRY_ROOF_SECONDS = 240;
export const DRY_AIR_SECONDS = 600;

/** A player's energy as the client sees it: `rate` is per second (negative while draining). */
export interface EnergyView {
  value: number;
  max: number;
  rate: number;
}

/** What else weighs on the drain right now (see the top of this file). Everything is optional. */
export interface Conditions {
  /** How well the fire next to you burns, 0 (out) to 1 (well fed), times any bonus. Default 1. */
  warmth?: number;
  /** 0 dry to 1 soaked. */
  wet?: number;
  /** What the bag weighs over what you carry easily (bagLoad); counts up to 1. */
  load?: number;
  /** A surge is sweeping this map: tiles at least this many steps from home are in it. */
  surgeFront?: number;
  /** How many times faster a surge drains (SURGE_DRAIN unless something calms it). */
  surgeDrain?: number;
  /** Something clings to your back. */
  hitched?: boolean;
  /** What your gear resists (gear.ts): cold softens the weather's and wetness's extra drain, electricity and radiation a surge's. */
  resist?: Partial<Resist>;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Energy change per second on tile x,y of `map`: positive refills, negative drains, 0 holds. */
export function energyRate(map: TileMap, x: number, y: number, weather: Weather, c: Conditions = {}): number {
  const warmth = c.warmth ?? 1;
  if (map.warm(x, y) && warmth > 0) return REFILL_PER_SECOND * warmth;
  if (map.data.kind !== 'wilds') return 0;
  // A tile with no way home (it should not exist; the validator warns) counts as far away.
  const steps = map.homeSteps(x, y);
  const far = steps < 0 ? 3 * DRAIN_GROWTH_STEPS : steps;
  const cold = clamp01(c.resist?.cold ?? 0);
  const weatherK = 1 + (WEATHER_DRAIN[weather] - 1) * (1 - cold);
  let k = weatherK * (1 + LOAD_DRAIN * clamp01(c.load ?? 0)) * (1 + WET_DRAIN * clamp01(c.wet ?? 0) * (1 - cold));
  if (c.hitched) k *= HITCH_DRAIN;
  if (inSurge(map, x, y, c.surgeFront)) {
    // A surge is electric and radiant: each resistance cuts half of its extra drain.
    const shield = (clamp01(c.resist?.electricity ?? 0) + clamp01(c.resist?.radiation ?? 0)) / 2;
    k *= 1 + ((c.surgeDrain ?? SURGE_DRAIN) - 1) * (1 - shield);
  }
  return -DRAIN_PER_SECOND * Math.max(1, map.data.depth) * (1 + far / DRAIN_GROWTH_STEPS) * k;
}

/** Is tile x,y caught by a surge whose front is at `front` steps from home? A street light shelters you. */
export function inSurge(map: TileMap, x: number, y: number, front: number | undefined): boolean {
  if (front === undefined || map.data.kind !== 'wilds' || map.lit(x, y)) return false;
  const steps = map.homeSteps(x, y);
  return (steps < 0 ? Infinity : steps) >= front;
}

/**
 * How fast you get wet (positive) or dry off (negative), per second, as a share of soaked. Rain soaks
 * you anywhere outdoors, `wetting` times as fast (feats and charms can slow it). A burning fire dries
 * you fastest, a roof slowly, and dry air slowest.
 */
export function wetRate(kind: MapKind, weather: Weather, byFire: boolean, wetting = 1): number {
  if (byFire) return -1 / DRY_FIRE_SECONDS;
  if (kind === 'inside') return -1 / DRY_ROOF_SECONDS;
  if (weather === 'rain') return wetting / WET_SECONDS;
  return -1 / DRY_AIR_SECONDS;
}

/** Energy after `seconds` at `rate`, kept between 0 and max. */
export function energyAfter(e: EnergyView, seconds: number): number {
  return Math.min(e.max, Math.max(0, e.value + e.rate * seconds));
}
