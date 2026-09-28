/**
 * Home, the stash, XP and levels: what makes a trip count. Come home and put what you carry into the
 * stash (the chest at home); each item stashed earns its XP (`xp` in content/items.json), XP brings
 * levels, and every level raises your energy bar, so you can go a little farther next time.
 *
 * What you take out of the stash and put back earns nothing again: the stash remembers how many of
 * each item you took out (`out`) and bringing those back pays that off first. What you use up after
 * taking it out (a thermos drunk, resin burned) is forgotten from `out`, so it never counts against
 * new finds; what it turns into (a strange object looked at) is counted there in its place. Gear
 * counts the same way, piece by piece: a piece taken out, or put on at the chest, is out until it comes
 * back into the stash, from the bag or off your back. The rules are pure functions shared by the server
 * (which owns every stash) and tests.
 */
import { ENERGY_MAX } from './energy';
import { newPiece, type Piece } from './gear';
import type { BagSlot, ItemDef } from './items';

/** The highest level, and what each level adds to the energy bar. */
export const LEVEL_MAX = 20;
export const ENERGY_PER_LEVEL = 5;
/** The XP curve: reaching level L takes XP_CURVE * (L - 1)^2 in all. */
export const XP_CURVE = 30;

/** The XP it takes, in all, to reach `level` (level 1: 0). */
export function xpFor(level: number): number {
  const l = Math.min(LEVEL_MAX, Math.max(1, Math.floor(level)));
  return XP_CURVE * (l - 1) ** 2;
}

/** The level `xp` has reached. */
export function levelOf(xp: number): number {
  const l = Math.floor(Math.sqrt(Math.max(0, xp) / XP_CURVE)) + 1;
  return Math.min(LEVEL_MAX, l);
}

/** A full bar at `level`. */
export function maxEnergy(level: number): number {
  return ENERGY_MAX + ENERGY_PER_LEVEL * (Math.min(LEVEL_MAX, Math.max(1, Math.floor(level))) - 1);
}

/**
 * Where a player stands: XP in all, the level, the XP that level started at and the next one needs (null:
 * the top), the bar, and the rest saved up while away (none: the cup is empty).
 */
export interface ProgressView {
  xp: number;
  level: number;
  from: number;
  to: number | null;
  maxEnergy: number;
  /** Rested XP: what stashing still earns twice over, out of the cup of rest (spendRest). */
  rested?: number;
}

export function progressOf(xp: number, rested = 0): ProgressView {
  const level = levelOf(xp);
  return { xp, level, from: xpFor(level), to: level >= LEVEL_MAX ? null : xpFor(level + 1), maxEnergy: maxEnergy(level), ...(rested > 0 ? { rested } : {}) };
}

/**
 * Rested while away. Time away from the game fills a cup of rest, one XP of it for every RESTED_EVERY_MS
 * not playing, up to three days' worth (RESTED_MAX). While it holds anything, what you stash earns double,
 * and the extra comes out of the cup. It rewards time away, so it is a gift for coming back and never a
 * penalty for playing a lot; the daily parcels reward coming back often (parcels.ts).
 */
export const RESTED_EVERY_MS = 20 * 60_000;
export const RESTED_DAYS = 3;
/** The most the cup holds: three days' worth, 216 XP. */
export const RESTED_MAX = Math.floor((RESTED_DAYS * 86_400_000) / RESTED_EVERY_MS);
/** An arrival is worth a word (a banner) when the time away was worth this much rest, three hours' worth, and the cup holds some. */
export const RESTED_NOTICE = 9;

/** A cup as the game keeps it: a whole number of XP from 0 to RESTED_MAX. Anything else saved is an empty cup. */
export function cleanRested(cup: unknown): number {
  return typeof cup === 'number' && Number.isFinite(cup) ? Math.min(RESTED_MAX, Math.max(0, Math.floor(cup))) : 0;
}

/**
 * The rest `awayMs` of time away is worth: one XP for every whole `everyMs` (RESTED_EVERY_MS, unless a
 * play-test shortens it), never more than the cup holds. Time that runs backwards (a clock set back) is none.
 */
export function restFor(awayMs: number, everyMs = RESTED_EVERY_MS): number {
  return awayMs > 0 && everyMs > 0 ? Math.min(RESTED_MAX, Math.floor(awayMs / everyMs)) : 0;
}

/** The cup after `awayMs` away: what it held, and what the time away was worth, up to RESTED_MAX. */
export function restAfter(cup: number, awayMs: number, everyMs = RESTED_EVERY_MS): number {
  return Math.min(RESTED_MAX, cleanRested(cup) + restFor(awayMs, everyMs));
}

/**
 * Stashing that earns `xp`, with `cup` of rest: as much again comes out of the cup, never more than it
 * holds. Returns the XP gained in all, the part of it the cup paid, and the cup after. Nothing that earns
 * nothing (a parcel, a lockbox's contents, what comes back after being taken out) touches the cup.
 */
export function spendRest(xp: number, cup: number): { gained: number; fromRest: number; cup: number } {
  // The cup pays whole XP only, so it stays a whole number.
  const earned = Math.max(0, xp), had = cleanRested(cup), fromRest = Math.min(Math.floor(earned), had);
  return { gained: earned + fromRest, fromRest, cup: had - fromRest };
}

/**
 * A player's stash: how many of each item lie in it, and how many they took out and have not brought
 * back. Gear lies in it piece by piece (`pieces`, gear.ts): as many as `items` counts, which stays the
 * truth, so a stash saved before pieces existed (or by an older release) still reads right (fitPieces).
 */
export interface Stash {
  items: Record<string, number>;
  out: Record<string, number>;
  pieces?: Record<string, Piece[]>;
}

export const emptyStash = (): Stash => ({ items: {}, out: {} });

/** The stash as a list, in item order (the order of content/items.json), for the client; gear piece by piece. */
export function stashList(s: Stash, order: readonly ItemDef[]): BagSlot[] {
  return order.filter(d => (s.items[d.id] ?? 0) > 0).flatMap(d => {
    const pieces = s.pieces?.[d.id];
    return pieces?.length ? pieces.map(piece => ({ item: d.id, count: 1, piece: { ...piece } })) : [{ item: d.id, count: s.items[d.id]! }];
  });
}

/**
 * The stash with one piece for every unit of gear it counts: pieces it had are kept (as many as it
 * counts, in order), missing ones come new (anomalous ones with a quirk), and pieces of anything
 * that is not gear, or no longer lies there, are dropped.
 */
export function fitPieces(s: Stash, items: Map<string, ItemDef>, rng: () => number): Stash {
  const pieces: Record<string, Piece[]> = {};
  for (const [id, n] of Object.entries(s.items)) {
    const def = items.get(id);
    if (def?.kind !== 'gear') continue;
    const had = (s.pieces?.[id] ?? []).slice(0, n).map(p => ({ ...p }));
    while (had.length < n) had.push(newPiece(def, rng));
    pieces[id] = had;
  }
  return Object.keys(pieces).length ? { items: s.items, out: s.out, pieces } : { items: s.items, out: s.out };
}

/** A copy of a stash's pieces, if it has any: every change to a stash keeps them. */
const copyPieces = (s: Stash): Pick<Stash, 'pieces'> =>
  s.pieces ? { pieces: Object.fromEntries(Object.entries(s.pieces).map(([id, list]) => [id, list.map(p => ({ ...p }))])) } : {};

/**
 * Puts `add` into the stash. Units that pay back what was taken out earn nothing; the rest earn their
 * item's XP. A piece of gear goes in as it is (its condition, quirk and level), after the pieces of its
 * kind already there. Returns the new stash (the old one is left alone) and the XP earned.
 */
export function store(s: Stash, add: readonly BagSlot[], items: Map<string, ItemDef>): { stash: Stash; xp: number } {
  const out: Stash = { items: { ...s.items }, out: { ...s.out }, ...copyPieces(s) };
  let xp = 0;
  for (const a of add) {
    const def = items.get(a.item);
    if (!def || a.count <= 0) continue;
    out.items[a.item] = (out.items[a.item] ?? 0) + a.count;
    const back = Math.min(a.count, out.out[a.item] ?? 0);
    if (back) {
      out.out[a.item] = out.out[a.item]! - back;
      if (!out.out[a.item]) delete out.out[a.item];
    }
    xp += (a.count - back) * (def.xp ?? 0);
    if (a.piece) ((out.pieces ??= {})[a.item] ??= []).push({ ...a.piece });
  }
  return { stash: out, xp };
}

/**
 * A live find brought home: one `into` (the plain item it becomes) goes into the stash, worth `xp`
 * (liveXp). It is a new find that never came out of the stash, so it pays nothing off `out`.
 */
export function storeLive(s: Stash, into: string, xp: number): { stash: Stash; xp: number } {
  return { stash: { items: { ...s.items, [into]: (s.items[into] ?? 0) + 1 }, out: { ...s.out }, ...copyPieces(s) }, xp };
}

/**
 * Puts `add` into the stash as a gift (a parcel, or what a lockbox held): it earns no XP, since it was
 * not brought home, and pays nothing off `out`, since it never came out. Taken out and brought back
 * later, it earns nothing either, like anything taken out of the stash. Unknown items are left out.
 */
export function gift(s: Stash, add: readonly BagSlot[], items: Map<string, ItemDef>): Stash {
  const out: Stash = { ...s, items: { ...s.items }, out: { ...s.out } };
  for (const a of add) {
    if (!items.has(a.item) || !(a.count > 0)) continue;
    out.items[a.item] = (out.items[a.item] ?? 0) + Math.floor(a.count);
  }
  return out;
}

/** One sealed `item` opened in the stash: it goes, and what it held (`got`) comes in as a gift. Undefined when the stash holds none. */
export function openInStash(s: Stash, item: string, got: readonly BagSlot[], items: Map<string, ItemDef>): Stash | undefined {
  const have = s.items[item] ?? 0;
  if (have < 1) return undefined;
  const left: Stash = { ...s, items: { ...s.items }, out: { ...s.out } };
  if (have > 1) left.items[item] = have - 1;
  else delete left.items[item];
  return gift(left, got, items);
}

/**
 * Takes up to `count` of an item out of the stash. Returns the new stash and how many came out. Gear
 * comes out piece by piece (takePiece), so this leaves the pieces alone.
 */
export function takeOut(s: Stash, item: string, count: number): { stash: Stash; taken: number } {
  const have = s.items[item] ?? 0, taken = Math.max(0, Math.min(have, Math.floor(count)));
  if (!taken) return { stash: s, taken: 0 };
  const out: Stash = { items: { ...s.items }, out: { ...s.out }, ...copyPieces(s) };
  out.items[item] = have - taken;
  if (!out.items[item]) delete out.items[item];
  out.out[item] = (out.out[item] ?? 0) + taken;
  return { stash: out, taken };
}

/**
 * Takes the `n`th piece of an item out of the stash (in the stash's order; the last there is when `n`
 * is past it), to carry or to wear: it counts as taken out, like anything. `piece` is undefined only
 * for a stash that counts gear it has no pieces for (fitPieces gives them).
 */
export function takePiece(s: Stash, item: string, n = 0): { stash: Stash; piece: Piece | undefined; taken: boolean } {
  const r = takeOut(s, item, 1);
  if (!r.taken) return { stash: s, piece: undefined, taken: false };
  const list = r.stash.pieces?.[item];
  if (!list?.length) return { stash: r.stash, piece: undefined, taken: true };
  const [piece] = list.splice(Math.min(Math.max(0, Math.floor(n)), list.length - 1), 1);
  if (!list.length) delete r.stash.pieces![item];
  if (!Object.keys(r.stash.pieces!).length) delete r.stash.pieces;
  return { stash: r.stash, piece, taken: true };
}

/**
 * One `from` turned into `into` (a strange object looked at). If the stash counts it as taken out, what
 * it turned into is counted as taken out in its place, as many as it turned into, so bringing that home
 * (in the bag, or a piece of gear off your back) earns nothing, as bringing the strange object back would
 * not have. One found out there owes nothing: what it turns into earns its XP.
 */
export function turnedInto(s: Stash, from: string, into: BagSlot): Stash {
  const owed = s.out[from] ?? 0;
  if (!owed || !(into.count > 0)) return usedUp(s, from, 1);
  const out: Stash = { items: { ...s.items }, out: { ...s.out }, ...copyPieces(s) };
  out.out[from] = owed - 1;
  if (!out.out[from]) delete out.out[from];
  out.out[into.item] = (out.out[into.item] ?? 0) + into.count;
  return out;
}

/** `count` of an item were used up (drunk, burned, taken by a watcher...): they will never come back, so they no longer count as out. */
export function usedUp(s: Stash, item: string, count: number): Stash {
  const owed = s.out[item] ?? 0;
  if (!owed || count <= 0) return s;
  const out: Stash = { items: s.items, out: { ...s.out }, ...copyPieces(s) };
  out.out[item] = Math.max(0, owed - count);
  if (!out.out[item]) delete out.out[item];
  return out;
}
