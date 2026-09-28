/**
 * A crate that needs two (roadmap/sealed-crates.md): in the middle of the ring of stones in the Near
 * Woods, where the rocks hum back, lies a flat slab, the stones' own sealed crate (a map object `slab`).
 * While the woods are restless before a surge, seams glow along it like the Old Stone's, and then two
 * people facing it, pressing A within SLAB_PAIR_MS of each other, lift it together: each takes what it
 * holds (two strange objects and a shard), into the bag. Each player opens it once a restless phase.
 * Alone it will not move. Nothing needs two people before this: it is the smallest real test of "together
 * you go farther".
 *
 * The rules both sides share are here; the server keeps the presses and who opened it this time, in memory.
 */
import type { SurgeRule, SurgeView } from './sky';

/** Two presses this close together (ms) are two pairs of hands on the slab at once. */
export const SLAB_PAIR_MS = 3000;

/** The slab opens (and its seams glow) only while its region is restless, before the surge. */
export function slabGlows(s: SurgeView | null | undefined): boolean {
  return s?.phase === 'unstable';
}

/** Which restless phase of a region's surge clock the wall clock is in (or past): each player opens the slab once in one. */
export function surgeRound(rule: SurgeRule, wallMs: number): number {
  return Math.floor((wallMs / 1000 + (rule.offset ?? 0)) / rule.every);
}
