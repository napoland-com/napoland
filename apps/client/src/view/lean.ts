import { LEANS, tagNumber } from '@napoland/shared';

/** How far the woods' line poles lean (radians, about 10 degrees): enough to read, a little wrong. */
export const LEAN = 0.175;

/** The axis and angle a pole with this tag tilts by (toward LEANS, x right and z down on the ground), or undefined for a straight one. */
export function poleLean(tag: string | undefined): { axis: [number, number, number]; angle: number } | undefined {
  const dir = LEANS[tagNumber(tag) ?? 0];
  if (!dir) return undefined;
  const [dx, dz] = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir];
  return { axis: [dz!, 0, 0 - dx!], angle: LEAN };
}
