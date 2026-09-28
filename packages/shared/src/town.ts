/**
 * Stonebrook wakes up (docs/DESIGN.md, the story): the town changes with what the whole server does,
 * never with one player alone. It is one town for everyone.
 *
 * - Milestones: the server counts a few things everyone does from this release on (the Old Stone
 *   waking, fires fed out in the wilds, thanks given), and when a count reaches a milestone's number
 *   the milestone is reached for good: someone from before comes back (never a player), a dark house
 *   lights up, the number chalked on the town's sign goes up.
 * - Works: the town's ledger in the lodge lists what each broken part of town needs (the street lights
 *   on the south road, a roof over the notice board, the sawmill's roof). Anyone gives materials at the
 *   ledger; once a work has everything it needs it is done for good, with a small lasting perk for
 *   everyone.
 *
 * Both are content (`town` in content/items.json), and what they change on the maps is too: a map
 * object may stand only within a gate (map.ts, TownGate), a house may light up, a room take a new name.
 * What the town has come to is one set of ids, the milestones reached and the works done
 * (TownView.done); townData (map.ts) works a map out from it, so the server and every client see the
 * same town.
 */
import { addToBag, amount, takeItem, type BagSlot, type ItemDef } from './items';
import { usedUp, type Stash } from './progress';

/**
 * A swap a townsperson makes (`who`, an npc's id) for what you carry spare: `give` of one item for `get`
 * of another, as many times over as you like and have. Walt, at the lodge: ten glowcaps for a cloth,
 * five scrap for a road flare. It asks first, like anything that uses up what you carry.
 */
export interface SwapDef {
  id: string;
  who: string;
  give: BagSlot;
  get: BagSlot;
}

/**
 * How many times over a bag can make a swap: as often as it holds what is given, and as far as there
 * is room in `slots` for what comes back once that is out.
 */
export function swapsFit(bag: readonly BagSlot[], swap: SwapDef, items: ReadonlyMap<string, ItemDef>, slots: number): number {
  const get = items.get(swap.get.item);
  const at = bag.findIndex(s => s.item === swap.give.item);
  if (!get || at < 0 || !(swap.give.count > 0)) return 0;
  const have = bag.reduce((n, s) => n + (s.item === swap.give.item ? s.count : 0), 0);
  for (let n = Math.floor(have / swap.give.count); n > 0; n--) {
    const left = takeItem(bag, at, n * swap.give.count).bag;
    if (!addToBag(left, get, n * swap.get.count, slots).left) return n;
  }
  return 0;
}

/**
 * A bag after a swap made `n` times (swapsFit said it fits): what is given comes out of it, from the
 * first slot that holds it on, and what comes back goes in.
 */
export function swapBag(bag: readonly BagSlot[], swap: SwapDef, n: number, items: ReadonlyMap<string, ItemDef>, slots: number): BagSlot[] {
  const at = bag.findIndex(s => s.item === swap.give.item);
  const left = takeItem(bag, at, n * swap.give.count).bag;
  return addToBag(left, items.get(swap.get.item)!, n * swap.get.count, slots).bag;
}

/**
 * The stash's side of a swap made `n` times: what was given is used up, and when any of it had been
 * taken out of the stash (and not brought back), what comes back counts as taken out in its place, so it
 * earns nothing brought home either: a swap never earns XP twice (progress.ts, turnedInto).
 */
export function swapped(s: Stash, swap: SwapDef, n: number): Stash {
  let out = s;
  for (let i = 0; i < n; i++) {
    const owed = Math.min(swap.give.count, out.out[swap.give.item] ?? 0);
    out = usedUp(out, swap.give.item, swap.give.count);
    if (owed) out = { ...out, out: { ...out.out, [swap.get.item]: (out.out[swap.get.item] ?? 0) + swap.get.count } };
  }
  return out;
}

/** What the server counts toward milestones, from this release on, for the whole town. */
export const TOWN_COUNTS = ['woke', 'fed', 'thanks'] as const;
export type TownCount = (typeof TOWN_COUNTS)[number];

/**
 * A milestone the whole server reaches: once `when.count` has reached `when.n` it is reached for good.
 * `back`: the name of someone from before who comes back to town with it (the sign's number goes up).
 * `title` and `text`: the banner everyone online reads as it happens.
 */
export interface TownMilestone {
  id: string;
  when: { count: TownCount; n: number };
  back?: string;
  title: string;
  text: string;
}

/**
 * A work of the town's ledger: what a broken part of town `needs`, given by anyone at the ledger, done
 * for good once all of it came in. `perk`: what it does for everyone, as the ledger says it; `title`
 * and `text`: the banner everyone online reads when it is done.
 */
export interface TownWork {
  id: string;
  name: string;
  needs: BagSlot[];
  perk: string;
  title: string;
  text: string;
}

/** The town's milestones and works (content/items.json), and the number painted on its sign. */
export interface TownData {
  /** The number painted on the town's sign: Pop. 23. */
  pop: number;
  milestones: TownMilestone[];
  works: TownWork[];
}

/**
 * What the town has come to, as every client hears it: the milestones reached and the works done, in
 * the order they came, and what was given to each work not done yet (by item). The server's counts
 * toward the milestones are its own: nothing says how near the next one is.
 */
export interface TownView {
  done: string[];
  given: Record<string, Record<string, number>>;
}

export const noTown = (): TownView => ({ done: [], given: {} });

/** The number on the town's sign now: the painted one, and one more for everyone who came back. */
export function popOf(data: TownData | undefined, done: readonly string[]): number {
  if (!data) return 0;
  return data.pop + data.milestones.filter(m => m.back && done.includes(m.id)).length;
}

/** What a work still needs, as given so far: each of its needs less what came in, none left out when it is all in. */
export function workLeft(work: TownWork, given: Readonly<Record<string, number>> | undefined): BagSlot[] {
  return work.needs.flatMap(n => {
    const left = n.count - Math.min(n.count, given?.[n.item] ?? 0);
    return left > 0 ? [{ item: n.item, count: left }] : [];
  });
}

/** How many of `item` a work still needs: 0 once it has all it needs of it, or needs none. */
export function workWants(work: TownWork, given: Readonly<Record<string, number>> | undefined, item: string): number {
  return workLeft(work, given).find(n => n.item === item)?.count ?? 0;
}

/** The milestones a count has just reached: those on it, not reached yet, whose number it has come to. */
export function reachedAt(data: TownData | undefined, counts: Readonly<Partial<Record<TownCount, number>>>, done: ReadonlySet<string>): TownMilestone[] {
  return (data?.milestones ?? []).filter(m => !done.has(m.id) && (counts[m.when.count] ?? 0) >= m.when.n);
}

/**
 * The ledger's lines, as the text box reads them out: what it is, then each work, what it still wants
 * of what (or that it is done, and what it does now). `item` names an item by its id.
 */
export function ledgerLines(data: TownData | undefined, view: TownView, item: (id: string) => ItemDef | undefined): string[] {
  const works = data?.works ?? [];
  const lines = ['The town\'s ledger. Walt keeps it: what each broken part of town needs, and what came in.'];
  for (const w of works) {
    const left = view.done.includes(w.id) ? [] : workLeft(w, view.given[w.id]).flatMap(n => { const d = item(n.item); return d ? [amount(d, n.count)] : []; });
    lines.push(left.length ? `${w.name}: wants ${listOf(left)} more. Once done: ${lower(w.perk)}` : `${w.name}: done. ${w.perk}`);
  }
  return works.length ? lines : [...lines, 'Nothing is written in it yet.'];
}

function listOf(parts: readonly string[]): string {
  return parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
