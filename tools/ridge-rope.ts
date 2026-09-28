/**
 * Where the Burn and the Ridge meet: the trappers' fixed rope up the ice north of the Burn's scar
 * (gen-burn.ts), three tiles wide, one for each who must be on it, and where they come out, on the bottom of
 * the Ridge (gen-ridge.ts), whose way home comes back to the tiles below the rope. Both generators take the
 * ends from here, so the two maps always meet.
 */
/** The rope's west tile in the Burn; you take hold of it from the row below. */
export const BURN_ROPE = { x: 37, y: 2 } as const;
/** The Ridge's way home, its west tile on the Ridge's bottom row; you come in on the row above it. */
export const RIDGE_WAY_HOME = { x: 20, y: 51 } as const;
/** Both are this wide: one tile for each on the rope. */
export const ROPE_WIDTH = 3;
