/**
 * Mending the woods together (roadmap/trail-works.md): places out in the wilds that stand broken until
 * the whole server brings what they take, and then have to be kept up. The rules both sides run: what a
 * place takes (content/items.json, `works`), how much more it takes, and how long what was put by for
 * its upkeep lasts. The server keeps each place's state for everyone (world_state).
 *
 * The map never changes shape: a footbridge (a map object over water) is walkable only while it stands,
 * its tiles opening with its id as a padlocked door opens with its tool (TileMap.walkable's pass), and a
 * street light (a lamp with `works`) lights its tiles only while it stands (TileMap.lit's pass). Broken,
 * each is still there to see, and to give to.
 */

/** How many givers a place remembers, the most first: its plaque names the first (the privacy policy says so). */
export const WORKS_GIVERS = 20;

/** What a place is: a footbridge over water, or a street light. */
export type WorksBuild = 'footbridge' | 'light';

export interface WorksDef {
  /** The place's id: the map object that stands for it carries it (a footbridge, or a lamp with `works`). */
  id: string;
  build: WorksBuild;
  /** What it is called in a sentence: "the footbridge". */
  name: string;
  /** Where it is, for the notice board: "by the pond, in the Near Woods". */
  where: string;
  /** The item it takes. */
  item: string;
  /** How many it takes to stand again from broken. */
  need: number;
  /** How many it wears out a day, from what was put by: paid at midnight (UTC); when that runs short, it breaks. */
  wear: number;
  /** The most it keeps put by ahead, once it stands. */
  hold: number;
}

/**
 * A place as everyone sees it: whether it stands, what it holds (toward standing again while broken;
 * put by for its upkeep while it stands), and who gave it the most, all told (the name on its plaque).
 */
export interface WorksView {
  id: string;
  standing: boolean;
  held: number;
  top?: string;
}

/** How many more it takes now: to stand again, then as much as it keeps put by; while it stands, up to that. */
export function worksRoom(def: Pick<WorksDef, 'need' | 'hold'>, v: Pick<WorksView, 'standing' | 'held'>): number {
  return Math.max(0, (v.standing ? def.hold : def.need + def.hold) - v.held);
}

/** How many more days what is put by keeps it standing: 0, it breaks at the next midnight (UTC) unless more comes. */
export function worksDays(def: Pick<WorksDef, 'wear'>, held: number): number {
  return Math.floor(Math.max(0, held) / def.wear);
}

/**
 * Takes what was given: while broken, toward standing again (at `need` it stands, and the rest is put by);
 * while it stands, put by. Never more than worksRoom. What it holds after, and whether it stood up.
 */
export function worksGive(def: Pick<WorksDef, 'need' | 'hold'>, v: Pick<WorksView, 'standing' | 'held'>, count: number): { standing: boolean; held: number; took: number; built: boolean } {
  const took = Math.max(0, Math.min(Math.floor(count), worksRoom(def, v)));
  let held = v.held + took, standing = v.standing, built = false;
  if (!standing && held >= def.need) {
    standing = true;
    built = true;
    held -= def.need;
  }
  return { standing, held, took, built };
}

/**
 * A midnight (UTC) passing: a place that stands pays its day's wear from what was put by; when that is
 * short, it breaks, and what was left counts toward standing again. A broken place does not wear.
 */
export function worksWear(def: Pick<WorksDef, 'wear'>, v: Pick<WorksView, 'standing' | 'held'>): { standing: boolean; held: number; broke: boolean } {
  if (!v.standing) return { standing: false, held: v.held, broke: false };
  if (v.held >= def.wear) return { standing: true, held: v.held - def.wear, broke: false };
  return { standing: false, held: v.held, broke: true };
}
