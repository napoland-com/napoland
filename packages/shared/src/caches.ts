/**
 * A crate for whoever comes next: each place out there where people rest by a fire keeps one (a map
 * object `cache`, map.ts) that anyone can open. It holds CACHE_SIZE things at most, one unit each, and
 * each says who left it and when. Each visit (from walking into its room, or coming within CACHE_NEAR of
 * a crate in the open, until you leave) you may leave one thing from your bag and take one out. Taking
 * one thanks whoever left it (thanks.ts), and what comes out of a crate earns no stash XP (it counts as
 * taken out of your stash: progress.ts, `out`), so crates cannot be farmed. Gear and tools stay out: a
 * piece of gear carries its own condition, quirk and level, and a tool is yours for good (and a sealed
 * lockbox is opened at the chest, never carried).
 *
 * The rules both sides share are here; the server keeps every crate's things across restarts.
 */
import type { ItemDef } from './items';

/** The most things a crate holds, one unit each. */
export const CACHE_SIZE = 6;
/** A visit to a crate in the open lasts while you are this near it (tiles, either way, diagonals too). In a room, the whole room is the visit. */
export const CACHE_NEAR = 3;

/**
 * Can a thing be left in a crate? Gear and tools stay out, and so does a sealed lockbox (it never leaves
 * the chest) and a keepsake (it stays with you until you bring it home).
 */
export function cacheTakes(def: ItemDef | undefined): boolean {
  return !!def && def.kind !== 'gear' && def.kind !== 'tool' && def.kind !== 'sealed' && def.kind !== 'keepsake';
}

/** A thing in a crate, as its visitors see it: what, who left it (id and name), and how long ago (seconds, when sent). */
export interface CacheItemView {
  id: number;
  item: string;
  owner: string;
  name: string;
  age: number;
}
