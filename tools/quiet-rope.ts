/**
 * Where the Ridge and the Quiet meet: the trappers' last rope, pegged into the rock above their cairn on the crest
 * (gen-ridge.ts), four tiles wide, one for each who must be on it, and where they come out, on the bottom of the
 * Quiet (gen-quiet.ts), whose way home comes back to the tiles below the rope. Both generators take the ends from
 * here, so the two maps always meet.
 */
/** The rope's west tile on the Ridge; you take hold of it from the row below. */
export const RIDGE_ROPE = { x: 23, y: 8 } as const;
/** The Quiet's way home, its west tile on the Quiet's bottom row; you come in on the row above it. */
export const QUIET_WAY_HOME = { x: 16, y: 33 } as const;
/** Both are this wide: one tile for each on the rope. */
export const QUIET_ROPE_WIDTH = 4;
