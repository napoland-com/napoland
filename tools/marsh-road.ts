/**
 * Where the Far Woods and the Marsh meet: the loggers' corduroy road east out of their old camp (gen-far-woods.ts)
 * off the Far Woods' east edge, and where it comes in on the Marsh's west edge (gen-marsh.ts), whose way home
 * goes back along it. Both generators take the ends from here, so the two maps always meet.
 */
/** The road's last tile on the Far Woods' east edge (walking onto it takes you to the Marsh). */
export const FAR_WOODS_ROAD = { x: 79, y: 58 } as const;
/** The Marsh's way home, on its west edge. */
export const MARSH_WAY_HOME = { x: 0, y: 20 } as const;
