/**
 * Outfits: how your character looks, whatever gear it wears. A look only: an outfit resists nothing,
 * adds nothing and changes nothing out there; the gear under it still does what it does (gear.ts).
 *
 * Who has which follows from two things the game already knows, so nothing is granted or stored but
 * the one a player wears: everyone signed in has the NAPO work suit from their first sign-in, and each
 * other outfit once their level reaches it (progress.ts). XP never goes down, so an outfit once had is
 * never lost. A guest has none until they sign in (DESIGN.md, Play first, sign in to keep it).
 *
 * The server checks every change (World.outfit); the client shows the wardrobe from the same rules and
 * draws each outfit (apps/client/src/view/characters.ts). The drawing of an outfit is code, so a new
 * one comes with the code that draws it: they are listed here, not in content/.
 */
import { LEVEL_MAX } from './progress';

export interface Outfit {
  /** Kept with the player (players.outfit): never renamed once released. */
  id: string;
  name: string;
  /** One line, in the game's words. */
  text: string;
  /** The level that opens it (1: it comes with signing in). */
  level: number;
}

/** Every outfit, in the order the wardrobe shows them: the level that opens each goes up. */
export const OUTFITS: readonly Outfit[] = [
  { id: 'napo-suit', name: 'NAPO work suit', level: 1, text: 'The grey coverall with the yellow NAPO patch. The station\'s stores held them by the hundred.' },
  { id: 'lineman-jacket', name: 'Lineman\'s jacket', level: 5, text: 'Orange, with bands that catch a light, and a yellow hard hat like the one Walt still wears.' },
  { id: 'rain-cape', name: 'Survey rain cape', level: 10, text: 'Dark green, edged in yellow: what NAPO\'s field crews wore out in the rain.' },
  { id: 'ranger-coat', name: 'Ranger\'s coat', level: 15, text: 'Brown wool, with the badge of the ranger who looked after these woods.' },
  { id: 'patchwork', name: 'Residents\' patchwork', level: 20, text: 'A coat stitched from Stonebrook\'s own cloth scraps, a patch at a time.' },
];

/** An outfit by id; undefined for one this release does not have. */
export function outfitOf(id: string | null | undefined): Outfit | undefined {
  return id ? OUTFITS.find(o => o.id === id) : undefined;
}

/** May someone at `level`, signed in or not, wear `outfit`? Only signed in, and only once their level has reached it. */
export function mayWear(outfit: Outfit | string | null | undefined, level: number, signedIn: boolean): boolean {
  const o = typeof outfit === 'string' ? outfitOf(outfit) : outfit ?? undefined;
  return !!o && signedIn && level >= o.level;
}

/** The outfits someone at `level` has, in the wardrobe's order: none for a guest. */
export function outfitsFor(level: number, signedIn: boolean): Outfit[] {
  return OUTFITS.filter(o => mayWear(o, level, signedIn));
}

/** The outfits that open on the way from level `from` up to `to` (a stash can climb several levels at once). */
export function outfitsOpening(from: number, to: number): Outfit[] {
  return OUTFITS.filter(o => o.level > from && o.level <= Math.min(to, LEVEL_MAX));
}
