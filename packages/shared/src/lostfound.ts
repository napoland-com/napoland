/**
 * The lost and found (roadmap/lost-and-found.md). At someone else's pile you may take half, as ever, or
 * carry all of it to the lodge for them: the pile is tied up into a bundle, one bag slot as heavy as what
 * it holds, and its hour stops. A bundle is never opened, traded, left in a crate, stashed or thrown away.
 * Left in the lost and found box in Stonebrook Lodge, by Walt, it goes into its owner's chest whole,
 * online or not, each piece as it was.
 *
 * What it was worth in XP is split, and never comes to more than the things were worth: the carrier gets
 * a quarter as they hand it in, reckoned from what the pile remembers of the owner's stash when they
 * collapsed (`owed`: what they had taken out of it earns nothing back, progress.ts), and the owner gets the
 * rest as their stash takes it, by the stash's own rule, less that quarter. So no loop of taking out,
 * losing and carrying back earns anyone anything that bringing it home would not have.
 *
 * Collapse with a bundle and it falls into your own pile as it is: anyone may carry it on, and whoever
 * hands it in is thanked by its owner.
 */
import { copyBundle, copySlot, type BagSlot, type Bundle, type ItemDef } from './items';
import type { Stash } from './progress';

/** The item every bundle is (content/items.json, kind bundle). */
export const BUNDLE = 'bundle';
/** What the carrier gets of what a bundle was worth, as they hand it in. */
export const CARRIER_SHARE = 0.25;

/** A pile's bundle is handed in once: its id is its owner's and when they collapsed (ms since the epoch). */
export const bundleId = (owner: string, droppedAt: number): string => `${owner}:${droppedAt}`;

/** How many of each item a list holds, whatever its slots. */
function counts(list: readonly BagSlot[]): Map<string, number> {
  const by = new Map<string, number>();
  for (const s of list) if (!s.bundle && s.count > 0) by.set(s.item, (by.get(s.item) ?? 0) + s.count);
  return by;
}

/**
 * What of `items` (a pile, as it falls) the owner had taken out of their stash: of each item, as many as
 * the stash counts out, at most as many as fell. What a bundle holds is its own owner's, and left out.
 */
export function owedOf(stash: Stash | undefined, items: readonly BagSlot[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [item, n] of counts(items)) {
    const owed = Math.min(n, Math.max(0, Math.floor(stash?.out[item] ?? 0)));
    if (owed > 0) out[item] = owed;
  }
  return out;
}

/** A pile as bundle() packs it: its owner, where it lies, when it fell, what it holds and what of it was owed (none remembered: all of it). */
export interface PileToPack {
  owner: string;
  name: string;
  map: string;
  x: number;
  y: number;
  droppedAt: number;
  items: readonly BagSlot[];
  owed?: Record<string, number>;
}

/**
 * A pile tied up to carry: its owner's own things as one bundle (null when it holds none, only other
 * people's bundles), and the bundles in it as they are, never one inside another. A pile that remembers
 * nothing of what was owed (dropped before piles did) counts all of it as owed: it earns the carrier
 * nothing, and the owner what their stash says.
 */
export function packPile(pile: PileToPack): { bundle: BagSlot | null; others: BagSlot[] } {
  const own = pile.items.filter(s => !s.bundle && s.count > 0).map(copySlot);
  const others = pile.items.filter(s => s.bundle).map(s => ({ item: BUNDLE, count: 1, bundle: copyBundle(s.bundle!) }));
  if (!own.length) return { bundle: null, others };
  const owed = pile.owed ? { ...pile.owed } : Object.fromEntries(counts(own));
  const bundle: Bundle = { id: bundleId(pile.owner, pile.droppedAt), owner: pile.owner, name: pile.name, map: pile.map, x: pile.x, y: pile.y, items: own, owed };
  return { bundle: { item: BUNDLE, count: 1, bundle }, others };
}

/**
 * What a bundle was worth when its owner collapsed: each thing's XP, but for what they had taken out of
 * their stash (owed), which earns nothing back. The carrier's quarter is reckoned from it.
 */
export function bundleWorth(b: Bundle, items: Map<string, ItemDef>): number {
  let xp = 0;
  // Nothing remembered at all (never so on the server): all of it was owed.
  for (const [item, n] of counts(b.items)) xp += Math.max(0, n - (b.owed ? (b.owed[item] ?? 0) : n)) * (items.get(item)?.xp ?? 0);
  return xp;
}

/** The carrier's share of what a bundle was worth: a quarter, in whole XP. */
export function carrierShare(worth: number): number {
  return Math.floor(Math.max(0, worth) * CARRIER_SHARE);
}

/** The bundles in a bag, and whose they are: what a hand-in takes, in bag order. */
export function bundlesIn(bag: readonly BagSlot[]): Bundle[] {
  return bag.flatMap(s => (s.bundle ? [s.bundle] : []));
}

/** "Ana", "Ana and Bo", "Ana, Bo and Cid": whose things, each name once, in the order they come. */
export function namesOf(bundles: ReadonlyArray<Pick<Bundle, 'name'>>): string {
  const names = [...new Set(bundles.map(b => b.name))];
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
