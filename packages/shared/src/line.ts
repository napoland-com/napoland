/**
 * The dead line (docs/DESIGN.md, the story; roadmap/the-dead-line.md): the lamp with no wires in the Near
 * Woods goes out, for everyone until dawn, when someone faces its poles' leanings in the right order beside it
 * on an aurora night. Every pole of the woods' part of the north line (N-7 to N-16) leans one way, which you can
 * see; what nobody can see is the order. Each player holds one of four torn pieces of NAPO's wiring diagram, each
 * a run of the order, overlapping the next by a pole, so a few of them put together in chat give the whole.
 * The piece comes from the player's id, so nothing is stored; four pieces is why a small server can still solve it.
 */
import type { Dir } from './protocol';

/** Where the lamp with no wires stands (the Near Woods, the "no-wires" page of the field notes). */
export const LAMP = { map: 'near-woods', x: 29, y: 9 } as const;

/** The way each pole of the woods' line leans, by its tag number (N-7 to N-16, see `poleTag`). */
export const LEANS: Readonly<Record<number, Dir>> = { 7: 'left', 8: 'up', 9: 'right', 10: 'left', 11: 'right', 12: 'up', 13: 'down', 14: 'down', 15: 'up', 16: 'right' };

/** The poles, by tag number, in the order their leanings are faced at the lamp. */
export const ORDER: readonly number[] = [9, 14, 7, 12, 16, 10, 8, 13];

/** What facing them in that order comes to: the directions, one `face` each. No two in a row are the same, so each one is a real turn. */
export const SOLUTION: readonly Dir[] = ORDER.map(n => LEANS[n]!);

/** Up on the screen is north, deeper into the woods. */
const COMPASS: Readonly<Record<Dir, string>> = { up: 'north', down: 'south', left: 'west', right: 'east' };

/** The tag number of a pole's tag ("N-12" is 12), or undefined. */
export const tagNumber = (tag: string | undefined): number | undefined => (tag && /^N-\d+$/.test(tag) ? Number(tag.slice(2)) : undefined);

/** What reading a line pole says of its lean, in compass words (a tilt is hard to judge from the camera), or nothing for a straight one. */
export const leanLine = (tag: string | undefined): string | undefined => {
  const dir = LEANS[tagNumber(tag) ?? 0];
  return dir && `The pole leans ${COMPASS[dir]}.`;
};

/** The four pieces, as runs of ORDER: [from, to) each, every one sharing a pole with the next. */
export const DIAGRAM_PIECES: ReadonlyArray<readonly [number, number]> = [[0, 3], [2, 5], [4, 7], [5, 8]];

/** Which piece a player holds (0 to 3), by their id. */
export function pieceOf(playerId: string): number {
  let h = 0;
  for (const c of playerId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % DIAGRAM_PIECES.length;
}

/** What a piece says: its run of the order, by tag, with the piece's own number and how many there are. */
export function pieceLines(piece: number): string[] {
  const [from, to] = DIAGRAM_PIECES[piece]!;
  const run = ORDER.slice(from, to).map(n => `N-${n}`);
  return [`Piece ${piece + 1} of ${DIAGRAM_PIECES.length}, torn from NAPO's wiring diagram.`, `It shows the lamp's poles in this order: ${run.join(', then ')}.`, from > 0 ? `It starts where another piece ends.` : `It is the start.`];
}

/** Has this run of `faced` directions (the most recent last) just finished the solution? */
export const solved = (faced: readonly Dir[]): boolean => faced.length >= SOLUTION.length && SOLUTION.every((d, i) => faced[faced.length - SOLUTION.length + i] === d);
