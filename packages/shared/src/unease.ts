/**
 * Unease (DESIGN.md, What wears you down: unease): alone in the dark, away from any light, a feeling
 * builds that you are not alone. There is no bar. The client shows it as the edges of the screen closing
 * in, as footsteps that are not yours and, where watchers roam, as something standing at the edge of the
 * fog. It never drains energy; once it is full, hitchhikers find you twice as often (UNEASE_MODS).
 * Company calms it fastest; a street light, a burning fire, a flare, a roof, town and daylight calm it too.
 * Tall grass hides you from creatures, not from this.
 *
 * The rules are here so the server, which keeps each player's unease and decides what it does, and the
 * client, which only ever hears its level, agree.
 */
import type { Mods } from './feats';
import type { Weather } from './protocol';

/** The levels the server tells, 0 (none) to UNEASE_LEVELS (full): a few, so a client hears of it seldom. */
export const UNEASE_LEVELS = 4;
/** Seconds alone in the dark from none to full, with nothing to hurry it. */
export const UNEASE_BUILD_S = 180;
/** Seconds from full to none under a street light, by a burning fire, near a flare, under a roof, in town or by day. */
export const UNEASE_CALM_S = 45;
/** Seconds from full to none with someone near: company calms it fastest. */
export const UNEASE_COMPANY_S = 12;
/** Someone this close (tiles, center to center) is company. */
export const UNEASE_COMPANY = 4;
/** A flash starting near you (the notebook's `flash`) leaves you shaken this long: meanwhile unease builds faster. */
export const UNEASE_SHAKEN_S = 60;
/**
 * A level lasts until unease falls this far below where it began, so walking along the edge of a lamp's
 * light never makes it flicker between two.
 */
export const UNEASE_HOLD = 0.03;
/** Full, it goes into Mods (feats.ts) like a charm: hitchhikers find you twice as often. */
export const UNEASE_MODS: Readonly<Partial<Mods>> = { hitch: 2 };

/** The dark that hitchhikers and unease go by: night, and aurora nights. */
export const inTheDark = (weather: Weather): boolean => weather === 'night' || weather === 'aurora';

/** Where someone stands, as far as unease cares. */
export interface UneaseAround {
  /** Out in the wilds in the dark, not under a street light, not by a burning fire, not near a flare. */
  dark: boolean;
  /** Someone else within UNEASE_COMPANY tiles. */
  company: boolean;
  /** An awake watcher within sight. */
  watcher: boolean;
  /** A flash started near them less than UNEASE_SHAKEN_S ago. */
  shaken: boolean;
}

/**
 * How fast unease moves, as a share of full a second: up while alone in the dark (twice as fast with a
 * watcher in sight, and again after a flash near), down otherwise, fastest in company.
 */
export function uneaseRate(a: UneaseAround): number {
  if (a.company) return -1 / UNEASE_COMPANY_S;
  if (!a.dark) return -1 / UNEASE_CALM_S;
  return (1 + (a.watcher ? 1 : 0) + (a.shaken ? 1 : 0)) / UNEASE_BUILD_S;
}

/** Unease `v` (0 to 1) after `seconds` of `a`. */
export function uneaseAfter(v: number, a: UneaseAround, seconds: number): number {
  return Math.min(1, Math.max(0, v + uneaseRate(a) * Math.max(0, seconds)));
}

/**
 * The level unease `v` shows, `was` the level last told: a level begins at its share of full (the top one
 * only at full), and once reached it lasts until unease falls UNEASE_HOLD below where it began.
 */
export function uneaseLevel(v: number, was = 0): number {
  // A hair over, so a sum that should be a whole share is never counted a level short.
  const at = (share: number) => Math.min(UNEASE_LEVELS, Math.max(0, Math.floor(share * UNEASE_LEVELS + 1e-9)));
  const up = at(v);
  if (up >= was) return up;
  return v >= was / UNEASE_LEVELS - UNEASE_HOLD ? was : Math.min(was - 1, at(v + UNEASE_HOLD));
}

/** Full: hitchhikers find you twice as often. */
export const uneaseFull = (level: number): boolean => level >= UNEASE_LEVELS;
