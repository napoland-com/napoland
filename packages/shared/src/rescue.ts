/**
 * A window to be saved (roadmap/rescue-window.md). At zero energy out in the wilds you do not collapse
 * at once: you slump where you stand, and everyone on your map hears where you are down, by landmark
 * (landmarks.ts). For SLUMP_S seconds, SLUMP_FLARE_S with a flare burning by you, anyone who reaches you
 * can give you RESCUE_ENERGY of their own energy, and you get up with it; nobody comes, and you collapse
 * as ever. Slumped, you cannot walk or act, nothing drains you further and no creature touches you.
 *
 * The rules both sides share are here; the server decides everything.
 */

/** How long you lie slumped before you collapse, in seconds. */
export const SLUMP_S = 90;
/** How long with a flare burning by you (FLARE_RADIUS, world.ts), in seconds. */
export const SLUMP_FLARE_S = 180;
/** What a rescuer gives you of their own energy, and what you get up with. They need more than this to give it. */
export const RESCUE_ENERGY = 20;

/** Can someone with `energy` get a slumped player up? Only with more than they give. */
export function canRescue(energy: number): boolean {
  return energy > RESCUE_ENERGY;
}
