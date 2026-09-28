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
 * - something clinging to your back at night (a hitchhiker), until you reach light or a roof,
 * - a storm (sky.ts): wind and lightning, and being wet in its wind chills you more,
 * - a flash discharging where you stand: a spark (electricity) or a fire flash (heat).
 * In winter the cold part of it is stronger (sky.ts, SEASONS: `chill`), so cold resistance matters more.
 * Far out (FAR_STEPS or more from home), a pathfinder's whole drain is gentler (feats.ts), and anywhere
 * out here, cozy from your own cabin's fire, so is everyone's (comfort.ts). In a deep region, standing in
 * someone else's lantern light halves it (lanternLights).
 *
 * The server owns the numbers; the client only shows them (and counts between updates using `rate`).
 * Tuning targets: standing at the woods' edge in the rain, dry and light, empties a full bar in about
 * 5.5 minutes, the deep end of the Near Woods in under 2, so the shelters' fires matter.
 */
import { FAR_STEPS } from './feats';
import type { Resist } from './gear';
import type { MapKind, TileMap } from './map';
import type { Weather } from './protocol';
import type { FlashKind } from './sky';

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
/** Out in a storm drains this many times faster; wind and electricity each cut half of the extra. */
export const STORM_DRAIN = 1.5;
/** In a storm's wind, being wet drains this many times more (cold resists it). */
export const STORM_CHILL = 1.5;
/** A flash discharging where you stand drains this many times faster; heat (fire) or electricity (spark) cuts the extra. */
export const FLASH_DRAIN = 6;

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

/** A fire with `left` seconds of fuel takes nothing more: within a second of FIRE_MAX_S (fuel is told in whole seconds). */
export function fireFull(left: number): boolean {
  return left >= FIRE_MAX_S - 1;
}

/**
 * How many of an item that burns `fuel` seconds a fire with `left` seconds takes, one after another,
 * before it is full: each goes in while the fire is not full yet, and the last may top it up past what
 * it holds (the rest of that one burns away). The server feeds them so; the client asks how many.
 */
export function fireTakes(left: number, fuel: number): number {
  if (!(fuel > 0)) return 0;
  return Math.max(0, Math.ceil((FIRE_MAX_S - 1 - Math.max(0, left)) / fuel));
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
  /** A storm blows over you (out in the wilds, not under a roof). */
  storm?: boolean;
  /** A flash discharges where you stand. */
  flash?: FlashKind;
  /** What your gear resists (gear.ts): cold softens the weather's and wetness's extra drain, electricity and radiation a surge's, wind and electricity a storm's, heat and electricity a flash's. */
  resist?: Partial<Resist>;
  /** How hard the whole drain is FAR_STEPS or more from home (the pathfinder's ranks, feats.ts); nearer home it is as ever. Default 1. */
  farDrain?: number;
  /**
   * The season's cold (sky.ts, SEASONS): `weather` more of every weather's extra drain (dry days are
   * cold too), and being wet `wet` times worse. Cold resistance cuts both, like the rest of the cold.
   * Default none.
   */
  chill?: { weather: number; wet: number };
  /** How hard the whole drain is anywhere out here (cozy after your own fire: comfort.ts, COZY_DRAIN). Default 1. */
  drain?: number;
  /** A light over you besides the street lights (a fire lookout's beam as it passes, lookout.ts): a surge does not reach you under it. */
  lit?: boolean;
  /** Someone else's lantern lights you (lanternLights): the whole drain is LANTERN_DRAIN of itself. */
  lantern?: boolean;
}

/** The tool that is a lantern (content/items.json). */
export const LANTERN = 'lantern';
/** Lanterns count in regions this deep or deeper, where the dark itself wears you down (the Burn). */
export const LANTERN_DEPTH = 3;
/** A lantern lights the ground this many tiles around whoever carries it, in a straight line. */
export const LANTERN_REACH = 3;
/** In someone else's lantern light you tire this much as fast: half. Your own lights the way for the others. */
export const LANTERN_DRAIN = 0.5;

/**
 * Does the lantern carried at `by` light tile x,y of `map`, so whoever stands there tires slower? Only out
 * in the wilds of a deep region. The caller never passes your own: a lantern helps the others, and more
 * lanterns light more ground, so a group walks in a bigger light than anyone alone.
 */
export function lanternLights(map: TileMap, x: number, y: number, by: { x: number; y: number }): boolean {
  if (map.data.kind !== 'wilds' || map.data.depth < LANTERN_DEPTH) return false;
  return (by.x - x) ** 2 + (by.y - y) ** 2 <= LANTERN_REACH ** 2;
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
  const r = (e: keyof Resist) => clamp01(c.resist?.[e] ?? 0);
  const cold = r('cold'), season = c.chill ?? { weather: 0, wet: 1 };
  const weatherK = 1 + (WEATHER_DRAIN[weather] - 1 + season.weather) * (1 - cold);
  const chill = (c.storm ? STORM_CHILL : 1) * season.wet;
  let k = weatherK * (1 + LOAD_DRAIN * clamp01(c.load ?? 0)) * (1 + WET_DRAIN * chill * clamp01(c.wet ?? 0) * (1 - cold));
  if (c.hitched) k *= HITCH_DRAIN;
  if (c.storm) k *= 1 + (STORM_DRAIN - 1) * (1 - (r('wind') + r('electricity')) / 2);
  if (c.flash) k *= 1 + (FLASH_DRAIN - 1) * (1 - r(c.flash === 'fire' ? 'heat' : 'electricity'));
  if (inSurge(map, x, y, c.surgeFront, c.lit)) {
    // A surge is electric and radiant: each resistance cuts half of its extra drain.
    const shield = (r('electricity') + r('radiation')) / 2;
    k *= 1 + ((c.surgeDrain ?? SURGE_DRAIN) - 1) * (1 - shield);
  }
  if (far >= FAR_STEPS) k *= c.farDrain ?? 1;
  k *= c.drain ?? 1;
  if (c.lantern) k *= LANTERN_DRAIN;
  return -DRAIN_PER_SECOND * Math.max(1, map.data.depth) * (1 + far / DRAIN_GROWTH_STEPS) * k;
}

/**
 * Is tile x,y caught by a surge whose front is at `front` steps from home? A street light shelters you,
 * and so does any other light over you right now (`lit`: a fire lookout's beam as it passes).
 */
export function inSurge(map: TileMap, x: number, y: number, front: number | undefined, lit = false): boolean {
  if (front === undefined || map.data.kind !== 'wilds' || lit || map.lit(x, y)) return false;
  const steps = map.homeSteps(x, y);
  return (steps < 0 ? Infinity : steps) >= front;
}

/**
 * How fast you get wet (positive) or dry off (negative), per second, as a share of soaked. Rain (and a
 * storm) soaks you anywhere outdoors, `wetting` times as fast (feats and charms can slow it). A burning
 * fire dries you fastest, a roof slowly, and dry air slowest.
 */
export function wetRate(kind: MapKind, weather: Weather, byFire: boolean, wetting = 1, storm = false): number {
  if (byFire) return -1 / DRY_FIRE_SECONDS;
  if (kind === 'inside') return -1 / DRY_ROOF_SECONDS;
  if (weather === 'rain' || storm) return wetting / WET_SECONDS;
  return -1 / DRY_AIR_SECONDS;
}

/** Energy after `seconds` at `rate`, kept between 0 and max. */
export function energyAfter(e: EnergyView, seconds: number): number {
  return Math.min(e.max, Math.max(0, e.value + e.rate * seconds));
}
