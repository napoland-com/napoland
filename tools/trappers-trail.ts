/**
 * The trappers' trail, where it crosses from one map to the next: it leaves the Near Woods on their
 * north edge, west of the cabin at the end (gen-woods.ts), and comes into the Far Woods on their south
 * edge (gen-far-woods.ts). Both generators take the ends from here, so the two maps always meet.
 */

/** The Near Woods' way on, one tile wide on their top row. */
export const NEAR_WOODS_END = { x: 53, y: 0 } as const;
/** The Far Woods' way home, one tile wide on their bottom row. */
export const FAR_WOODS_END = { x: 40, y: 99 } as const;
