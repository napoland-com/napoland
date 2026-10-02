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
