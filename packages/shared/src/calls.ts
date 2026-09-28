/**
 * Calls without words: hold B and your character sings a short note, in a voice of their own, that
 * everyone on the map within CALL_REACH hears from where it came. Three calls, told apart by their
 * shape: here I am (one note), come here (a note held and rising) and thank you (two quick notes).
 * No words go anywhere, so there is nothing to filter and guests call too. The server decides who
 * hears one; how it sounds and where the notes sit on the fan are the client's (calls.ts there).
 */

/** The calls, in the order the fan shows them (and 1, 2, 3 on a keyboard pick them). */
export const CALL_KINDS = ['here', 'come', 'thanks'] as const;
export type CallKind = (typeof CALL_KINDS)[number];

/** A call is heard this far (tiles, center to center) on the caller's map: twice as far as local chat. */
export const CALL_REACH = 25;

/** At most one call from a player in any window this long (ms). */
export const CALL_EVERY_MS = 2000;
