/**
 * The fire lookout (roadmap/lookout-tower.md): a timber tower from the logging days, older than NAPO,
 * that anyone can climb to see the woods from above, and whose lamp, while someone feeds it resin,
 * sweeps a beam round the woods. The rules both sides run: where you climb it, what its lamp takes, and
 * which tiles its beam lights at any moment (a pure function of the wall clock, so every client draws
 * the beam where the server counts it, with nothing sent but how long the lamp burns).
 *
 * Up there is like under a roof (no rain, storms, flashes or hitchhikers, and nothing out there can
 * reach you), but you still tire as you would at its foot. You come down after LOOKOUT_UP_S, or sooner.
 */
import type { MapObject } from './map';

type Lookout = Extract<MapObject, { kind: 'lookout' }>;

/** How long you may stay up there, in seconds: then you climb down. */
export const LOOKOUT_UP_S = 120;
/** How much farther you see from up there: the camera's radius, times this. */
export const LOOKOUT_ZOOM = 3;
/** What its lamp burns (an item id), how long each one burns in it, and the most it holds (seconds). */
export const LAMP_BURNS = 'resin';
export const LAMP_PER_S = 600;
export const LAMP_MAX_S = 3600;
/** The beam: once round the woods every BEAM_EVERY_S, as far as BEAM_REACH tiles, BEAM_HALF radians either side of its line. */
export const BEAM_EVERY_S = 20;
export const BEAM_REACH = 22;
export const BEAM_HALF = (12 * Math.PI) / 180;
/** Tiles this close to the lamp are under the tower: the beam passes over them. */
export const BEAM_UNDER = 1.6;

/** Where you stand to climb it, in front of its ladder: the tile south of its east column (it is 2 by 2). */
export function footOf(o: Pick<Lookout, 'x' | 'y'>): { x: number; y: number } {
  return { x: o.x + 1, y: o.y + 2 };
}

/** The ladder's tile, which you face from the foot: what A (or a tap) at the lookout is about. */
export function ladderOf(o: Pick<Lookout, 'x' | 'y'>): { x: number; y: number } {
  return { x: o.x + 1, y: o.y + 1 };
}

/** The lamp, in the middle of the tower's four legs, in tile units (not a tile: a point). */
export function lampOf(o: Pick<Lookout, 'x' | 'y'>): { x: number; y: number } {
  return { x: o.x + 1, y: o.y + 1 };
}

/** The lookout whose foot is tile x,y, if any: where someone standing there climbs. */
export function lookoutAtFoot<T extends { kind: string; x: number; y: number }>(objects: readonly T[], x: number, y: number): Extract<T, { kind: 'lookout' }> | undefined {
  return objects.find((o): o is Extract<T, { kind: 'lookout' }> => o.kind === 'lookout' && o.x + 1 === x && o.y + 2 === y);
}

/** Which way the beam points at a wall clock time (ms since the epoch): radians from east, turning south (clockwise as the map is drawn). */
export function beamAngle(wallMs: number): number {
  const s = (((wallMs / 1000) % BEAM_EVERY_S) + BEAM_EVERY_S) % BEAM_EVERY_S;
  return (s / BEAM_EVERY_S) * Math.PI * 2;
}

/**
 * Does a burning lamp's beam light tile x,y at this wall clock time? Within its reach, past the tower's
 * own feet, and inside its cone: a few comparisons, so the server asks it for every player and creature
 * it cares about on every tick.
 */
export function inBeam(o: Pick<Lookout, 'x' | 'y'>, x: number, y: number, wallMs: number): boolean {
  const lamp = lampOf(o), dx = x + 0.5 - lamp.x, dy = y + 0.5 - lamp.y, d = Math.hypot(dx, dy);
  if (d > BEAM_REACH || d < BEAM_UNDER) return false;
  let off = Math.atan2(dy, dx) - beamAngle(wallMs);
  off -= Math.round(off / (Math.PI * 2)) * Math.PI * 2;
  return Math.abs(off) <= BEAM_HALF;
}

/** How many of what it burns a lamp with `left` seconds takes before it is full: the last one may top it up past what it holds, as a fire's does. */
export function lampTakes(left: number): number {
  return Math.max(0, Math.ceil((LAMP_MAX_S - 1 - Math.max(0, left)) / LAMP_PER_S));
}
