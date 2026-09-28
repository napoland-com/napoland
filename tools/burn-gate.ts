/**
 * Where the Far Woods and the Burn meet (roadmap/deeper-regions.md): NAPO's gate in the rim north of the
 * Far Woods' hollow (gen-far-woods.ts), two tiles wide, and where its pullers come out, on the bottom of the
 * Burn (gen-burn.ts), whose way home comes back to the tiles below the gate. Both generators take the ends
 * from here, so the two maps always meet.
 */
/** The gate's west tile in the Far Woods; you pull at it from the row below. */
export const FAR_WOODS_GATE = { x: 51, y: 3 } as const;
/** The Burn's way home, its west tile on the Burn's bottom row; you come in on the row above it. */
export const BURN_WAY_HOME = { x: 27, y: 71 } as const;
/** Both are this wide: one tile for each who pulls. */
export const GATE_WIDTH = 2;
