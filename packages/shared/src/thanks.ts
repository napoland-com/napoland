/**
 * Thanks: fires and arrows let players help each other without meeting, and a thanks lets the helper
 * know it did something. A fire out in the wilds remembers the last few players who fed it, an arrow
 * knows its painter. Whoever warms at a fire someone else fed, or follows an arrow, is offered once to
 * thank them (the client decides when it offers, the server whether a thanks goes through). A thanks
 * carries no words: it gives the helper a little energy if they are out in the wilds right then (a few
 * times a trip), and a letter when they come home says who thanked them, and for what. Each player
 * thanks each helper once a UTC day, and the thanks received count toward a feat, Good neighbor, whose
 * ranks make the arrows its owner paints last longer (feats.ts).
 *
 * The rules both sides share are here; the server keeps who thanked whom for THANKS_KEPT_DAYS.
 */
import type { Mods } from './feats';

/** What a thanks gives a helper who is out in the wilds right then, and how many such gifts one trip gets at most. */
export const THANKS_ENERGY = 3;
export const THANKS_PER_TRIP = 5;
/** Who thanked whom, when and for what is kept this long (for the once-a-day rule and the letter), then deleted. */
export const THANKS_KEPT_DAYS = 7;
export const THANKS_KEPT_MS = THANKS_KEPT_DAYS * 86_400_000;
/** A fire remembers this many of the players who fed it last, the most recent first. */
export const FEEDERS_KEPT = 3;
/**
 * How far (tiles, in any direction, diagonals too) a thanks may come from: the fire, or the tile an
 * arrow points to. A little more than the fire's warmth reaches, for steps still on their way.
 */
export const THANKS_REACH = 2;

/** An arrow shows this long, times its painter's `marks` factor (Good neighbor, feats.ts). */
export const MARK_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** How long an arrow painted with these Mods lasts, in ms. */
export function markLifetime(mods: Pick<Mods, 'marks'>): number {
  return Math.round(MARK_LIFETIME_MS * (Number.isFinite(mods.marks) && mods.marks > 0 ? mods.marks : 1));
}

/** The UTC day of a wall-clock time (ms since the epoch), as a whole number: each player thanks each helper once in one. */
export function utcDay(wallMs: number): number {
  return Math.floor(wallMs / 86_400_000);
}

/**
 * What a thanks was for, as the helper's letter names it: a fire (on its map and tile), an arrow (where
 * it was painted), or something left in a crate for whoever comes next (its item, and the crate's tile).
 */
export type ThanksFor =
  | { kind: 'fire'; map: string; x: number; y: number }
  | { kind: 'mark'; map: string; x: number; y: number }
  | { kind: 'cache'; map: string; x: number; y: number; item: string };

/** One thing thanked for, as a letter lists it: how many thanks, from how many people, and the names of the latest (two at most). */
export interface ThanksGroup {
  what: ThanksFor;
  count: number;
  people: number;
  names: string[];
}

/** One key for the same thing thanked for, so the letter groups the thanks for it: the same fire, the same arrow, or the same item left in the same crate. */
export function thanksKey(w: ThanksFor): string {
  return `${w.kind}:${w.map}:${w.x},${w.y}${w.kind === 'cache' ? `:${w.item}` : ''}`;
}
