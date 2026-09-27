/**
 * Energy: the one thing a trip spends. It drains out in the wilds, faster the deeper you are and in
 * bad weather; in town and inside buildings it holds. It only comes back next to a fireplace (shelters
 * out in the wilds keep one burning, and so do some houses, home among them). At zero you collapse and
 * wake up at home. Street lights do not give energy: light is for seeing.
 * The server owns the numbers; the client only shows them (and counts between updates using `rate`).
 * Tuning targets: standing at the woods' edge in the rain empties a full bar in about 5.5 minutes,
 * the deep end of the Near Woods in under 2, so the shelters' fires matter.
 */
import type { TileMap } from './map';
import type { Weather } from './protocol';

/** A full bar, before levels raise it. */
export const ENERGY_MAX = 100;
/** Energy per second lost at a depth-1 region's home exit, in overcast weather. */
export const DRAIN_PER_SECOND = 0.24;
/** Every this many steps away from the home exit adds DRAIN_PER_SECOND again. */
export const DRAIN_GROWTH_STEPS = 60;
/** Energy per second gained next to a fireplace. */
export const REFILL_PER_SECOND = 8;
/** Bad weather drains faster. */
export const WEATHER_DRAIN: Readonly<Record<Weather, number>> = { overcast: 1, rain: 1.25, night: 1.5 };
/** The server repeats a player's energy this often, so the client's count never drifts far. */
export const ENERGY_SYNC_MS = 2000;

/** A player's energy as the client sees it: `rate` is per second (negative while draining). */
export interface EnergyView {
  value: number;
  max: number;
  rate: number;
}

/** Energy change per second on tile x,y of `map`: positive refills, negative drains, 0 holds. */
export function energyRate(map: TileMap, x: number, y: number, weather: Weather): number {
  if (map.warm(x, y)) return REFILL_PER_SECOND;
  if (map.data.kind !== 'wilds') return 0;
  // A tile with no way home (it should not exist; the validator warns) counts as far away.
  const steps = map.homeSteps(x, y);
  const far = steps < 0 ? 3 * DRAIN_GROWTH_STEPS : steps;
  return -DRAIN_PER_SECOND * Math.max(1, map.data.depth) * (1 + far / DRAIN_GROWTH_STEPS) * WEATHER_DRAIN[weather];
}

/** Energy after `seconds` at `rate`, kept between 0 and max. */
export function energyAfter(e: EnergyView, seconds: number): number {
  return Math.min(e.max, Math.max(0, e.value + e.rate * seconds));
}
