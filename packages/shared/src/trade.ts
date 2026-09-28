/**
 * Face-to-face exchange: two friends on the same map, at most TRADE_REACH tiles apart, each put things
 * from their bag into their side of a trade, both press Ready, then both press Trade, and the server
 * swaps both sides in one step. The rules for what a side offers and for the swap itself are pure
 * functions shared by the server (which owns every bag and every trade) and the client (which shows
 * what each side gives).
 *
 * What a side offers is always what its bag holds: each piece of gear and each live find on its own,
 * as its slot holds it (a piece keeps its condition, quirk and level; a live find when it was picked),
 * and everything else by item, never more than the bag carries. Tools never go into a bag, and sealed
 * things stay in the chest, so neither can be offered.
 */
import { addAllToBag, type BagSlot, type ItemDef } from './items';
import type { Piece } from './gear';

/** Two friends trade face to face: on one map, at most this many tiles apart (center to center). */
export const TRADE_REACH = 10;
/** The most a side can offer at once: no bag holds more slots. */
export const OFFER_MAX = 16;

/** Can it change hands? Anything a bag holds; never a tool (yours for good) or a sealed thing (it stays in the chest). */
export function tradeable(def: ItemDef | undefined): boolean {
  return !!def && def.kind !== 'tool' && def.kind !== 'sealed';
}

/** One pick of a bag for an offer: how many of what bag slot `slot` holds (a piece of gear or a live find is one). */
export interface OfferPick {
  slot: number;
  count: number;
}

/** A slot that holds one thing of its own: a piece of gear, or a live find (each one to a slot). */
const single = (s: BagSlot): boolean => s.piece !== undefined || s.since !== undefined;

const samePiece = (a: Piece | undefined, b: Piece | undefined): boolean =>
  !!a && !!b && a.cond === b.cond && (a.quirk ?? null) === (b.quirk ?? null) && (a.level ?? 0) === (b.level ?? 0);

/** Is this bag slot the very thing an offer's entry is: the same piece, or the live find picked at the same moment? */
function holds(s: BagSlot, o: BagSlot): boolean {
  if (s.item !== o.item) return false;
  if (o.since !== undefined) return s.since === o.since;
  return o.piece !== undefined && s.since === undefined && samePiece(s.piece, o.piece);
}

/** How many of `item` a bag carries in plain stacks (not a piece, not a live find). */
function stacked(bag: readonly BagSlot[], item: string): number {
  return bag.reduce((n, s) => n + (s.item === item && !single(s) ? s.count : 0), 0);
}

const entry = (s: BagSlot): BagSlot => ({
  item: s.item, count: 1, ...(s.piece ? { piece: { ...s.piece } } : {}), ...(s.since !== undefined ? { since: s.since } : {}),
});

/**
 * What picks of a bag offer: each piece of gear and each live find its own entry, as its slot holds it,
 * and everything else one entry an item, as many as picked in all and never more than the bag carries.
 * A slot picked twice, an empty one, and what cannot change hands (tradeable) are left out.
 */
export function offerFrom(bag: readonly BagSlot[], picks: readonly OfferPick[], items: Map<string, ItemDef>): BagSlot[] {
  const out: BagSlot[] = [];
  const stacks = new Map<string, BagSlot>();
  const seen = new Set<number>();
  for (const p of picks) {
    const s = bag[p.slot];
    if (!s || seen.has(p.slot) || !(p.count >= 1) || !tradeable(items.get(s.item))) continue;
    seen.add(p.slot);
    if (single(s)) {
      out.push(entry(s));
      continue;
    }
    let e = stacks.get(s.item);
    if (!e) {
      e = { item: s.item, count: 0 };
      stacks.set(s.item, e);
      out.push(e);
    }
    e.count = Math.min(stacked(bag, s.item), e.count + Math.floor(p.count));
  }
  return out;
}

/**
 * What of an offer a bag still holds (a find, a watcher's touch or a live find fading changes it): every
 * piece and live find that is still there, and of the rest no more than the bag carries now.
 */
export function keptOffer(bag: readonly BagSlot[], offer: readonly BagSlot[]): BagSlot[] {
  const used = new Set<number>();
  return offer.flatMap(o => {
    if (single(o)) {
      const i = bag.findIndex((s, j) => !used.has(j) && holds(s, o));
      if (i < 0) return [];
      used.add(i);
      return [entry(o)];
    }
    const n = Math.min(o.count, stacked(bag, o.item));
    return n > 0 ? [{ item: o.item, count: n }] : [];
  });
}

/** The same offer: the same things, as many of each, in the same order. */
export function sameOffer(a: readonly BagSlot[], b: readonly BagSlot[]): boolean {
  return a.length === b.length && a.every((x, i) => {
    const y = b[i]!;
    return x.item === y.item && x.count === y.count && x.since === y.since && (x.piece === undefined ? y.piece === undefined : samePiece(x.piece, y.piece));
  });
}

/**
 * The bag without what it offers, or undefined when it no longer holds all of it. Stacks are taken from
 * the last slots first, so what stays keeps its full stacks at the front.
 */
export function takeOffer(bag: readonly BagSlot[], offer: readonly BagSlot[]): BagSlot[] | undefined {
  let out = bag.map(s => ({ ...s, ...(s.piece ? { piece: { ...s.piece } } : {}) }));
  for (const o of offer) {
    if (single(o)) {
      const i = out.findIndex(s => holds(s, o));
      if (i < 0) return undefined;
      out.splice(i, 1);
      continue;
    }
    let want = o.count;
    for (let i = out.length - 1; i >= 0 && want > 0; i--) {
      const s = out[i]!;
      if (s.item !== o.item || single(s)) continue;
      const n = Math.min(want, s.count);
      s.count -= n;
      want -= n;
    }
    if (want > 0) return undefined;
    out = out.filter(s => s.count > 0);
  }
  return out;
}

/** Both sides of a trade, swapped: the two bags after it, and what each side gave. */
export type Swapped =
  | { ok: true; a: BagSlot[]; b: BagSlot[]; aGave: BagSlot[]; bGave: BagSlot[] }
  /** Nothing moved: side `side`'s bag no longer holds all it offered (gone), or has no room for what it gets after what it gives (room). */
  | { ok: false; why: 'gone' | 'room'; side: 'a' | 'b' };

/**
 * Swaps what two bags offer, both in one step: each gives what it offers and gets the other's, a piece
 * of gear as it was and a live find still fading from when it was picked. It happens only if each bag
 * still holds all it offers and has room, after what it gives, for all it gets (`aSlots`, `bSlots`: the
 * slots of the bag each wears); otherwise nothing moves.
 */
export function swapOffers(
  aBag: readonly BagSlot[], bBag: readonly BagSlot[], aGives: readonly BagSlot[], bGives: readonly BagSlot[], aSlots: number, bSlots: number, items: Map<string, ItemDef>,
): Swapped {
  const aLeft = takeOffer(aBag, aGives);
  if (!aLeft) return { ok: false, why: 'gone', side: 'a' };
  const bLeft = takeOffer(bBag, bGives);
  if (!bLeft) return { ok: false, why: 'gone', side: 'b' };
  const a = addAllToBag(aLeft, bGives, items, aSlots);
  if (a.left.length) return { ok: false, why: 'room', side: 'a' };
  const b = addAllToBag(bLeft, aGives, items, bSlots);
  if (b.left.length) return { ok: false, why: 'room', side: 'b' };
  return { ok: true, a: a.bag, b: b.bag, aGave: aGives.map(entryOf), bGave: bGives.map(entryOf) };
}

const entryOf = (s: BagSlot): BagSlot => (single(s) ? entry(s) : { item: s.item, count: s.count });

/**
 * An offer as a player hears it: without when a live find was picked (the server's clock only), and each
 * piece's condition to a thousandth, as in the bag.
 */
export function offerView(offer: readonly BagSlot[]): BagSlot[] {
  return offer.map(s => ({ item: s.item, count: s.count, ...(s.piece ? { piece: { ...s.piece, cond: Math.round(s.piece.cond * 1000) / 1000 } } : {}) }));
}
