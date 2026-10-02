/**
 * Where the Near Woods and the Turning meet: the path west out of the ring of stones' glade, off the Near Woods'
 * west edge (gen-woods.ts), and where it comes into each of the Turning's clearings, by its east edge
 * (gen-turning.ts). Every way out of the Turning but the one on puts you back by the ring, so both generators
 * take the ends from here, and the maps always meet.
 */

/** The path's last tile on the Near Woods' west edge (walking onto it takes you into the Turning). */
export const NEAR_WOODS_MOUTH = { x: 0, y: 5 } as const;
/** Where the Turning puts you back out: the tile inside the mouth, facing the ring. */
export const NEAR_WOODS_BACK = { x: 1, y: 5 } as const;
/** Where you come into each of the Turning's clearings: by its east edge, facing in, whichever way you came. */
export const TURNING_ENTRY = { x: 29, y: 13 } as const;
/**
 * Where the ranger's camp and the Other Woods meet (gen-turning.ts, gen-other-woods.ts): the path on out of her
 * camp's west edge, and the Other Woods' way home, which is the Turning's mouth said back, on their east edge by
 * the ring (the Near Woods mirrored east for west).
 */
export const CAMP_ON = { x: 0, y: 10 } as const;
/** Where the Other Woods' way home sets you down: inside the camp's west edge, facing in. */
export const CAMP_BACK = { x: 1, y: 10 } as const;
/** The Other Woods' way home, on their east edge (the Near Woods' mouth, mirrored). */
export const OTHER_WOODS_MOUTH = { x: 63, y: 5 } as const;
/** Where you come into the Other Woods: inside the mouth, facing the ring. */
export const OTHER_WOODS_BACK = { x: 62, y: 5 } as const;
