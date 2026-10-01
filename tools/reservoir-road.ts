/**
 * Where the east road up the brook leaves Stonebrook and where it comes into the Reservoir, for both
 * generators (gen-map.ts, gen-reservoir.ts), so the two ends always meet: each is the exit tile on its map's
 * edge, and each arrives on the tile just inside the other.
 */
export const STONEBROOK_EAST = { x: 43, y: 34 } as const;
export const RESERVOIR_WAY_HOME = { x: 0, y: 24 } as const;
