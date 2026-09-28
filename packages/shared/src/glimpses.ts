/**
 * Glimpses of other people's steps (DESIGN.md, Cooperation: glimpses): when you are the only one out in the
 * wilds on your map, now and then a see-through figure in someone's jacket color walks 20 to 40 steps that
 * somebody really took there in the last day, on their way to a find, a fire or home. It shows no name, and
 * it fades if you come near. With few people online the woods feel less empty, and routes are learned by
 * watching (Dark Souls' phantoms, beside the echoes of the ones who collapsed).
 *
 * The server keeps the walks, in memory only, and says when and which; the client walks them.
 */
import type { Dir } from './protocol';

/** A walk kept for a glimpse is at least this many steps, and at most this many (the last ones before it ended). */
export const GLIMPSE_STEPS: readonly [number, number] = [20, 40];
/** A walk is kept this long (ms), in the server's memory only: a restart forgets it sooner. */
export const GLIMPSE_KEPT_MS = 24 * 60 * 60 * 1000;
/** Each map keeps at most this many walks, the oldest going first. */
export const GLIMPSES_PER_MAP = 40;
/** Whoever is alone out there glimpses one this often (seconds), at random between the two. */
export const GLIMPSE_EVERY_S: readonly [number, number] = [60, 120];
/** It fades once you come this close to it (tiles, center to center): so it never begins this close to you either. */
export const GLIMPSE_NEAR = 3;
/**
 * It passes this close to you somewhere along its way (tiles, center to center), so that you can see it: a
 * walk somewhere else on the map is not glimpsed from here.
 */
export const GLIMPSE_SEEN = 10;

/** A glimpse, as the one who sees it hears it: the walker's jacket color and the tiles they walked, in order. Never who. */
export interface GlimpseView {
  color: string;
  steps: Array<[number, number]>;
}

/**
 * Footprints in the snow (MapData.forest 'snow', the Ridge): every step anyone takes there stays in the
 * snow for PRINTS_KEPT_MS, for everyone to see and follow, a map keeping at most PRINTS_PER_MAP (the oldest
 * go first). Like a glimpse, never whose: a tile, the way the step went, and how long ago.
 */
export const PRINTS_KEPT_MS = 60 * 60 * 1000;
export const PRINTS_PER_MAP = 1500;

/** A footprint as a client hears it on arrival: where, which way the step went, and its age in seconds. */
export interface PrintView {
  x: number;
  y: number;
  dir: Dir;
  age: number;
}
