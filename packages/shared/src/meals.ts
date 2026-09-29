/**
 * Cooking at a fire, and meals (DESIGN.md, The loop): what you forage out there (huckleberries,
 * fiddleheads, fir tips, and chanterelles after the rain) cooks at any fire that burns into a meal,
 * a thing in your bag (`cooking` in content/items.json, paid from the bag, since the stash is at home).
 * Eaten, a meal works for the rest of the trip, until you come home into your cabin or collapse: its
 * `eaten` goes into Mods (feats.ts) beside the feats and the charms. Two at a time, and never the same
 * one twice, so a trip is planned around which two.
 *
 * The rules are here so the server, which decides, and the client, which asks first and says why not,
 * agree.
 */
import type { Mods } from './feats';
import type { Recipe } from './gear';
import { takeItem, type BagSlot, type ItemDef } from './items';

/** How many meals work at once: a third waits for the next trip. */
export const MEALS_MAX = 2;

/** Is this item a meal: eaten (or drunk) from the bag, with something it does until you come home? */
export function isMeal(def: ItemDef | undefined): boolean {
  return !!def?.use?.meal && !!def.eaten;
}

/** Why a meal cannot be eaten now: this one already this trip, or two already. Null: it can. */
export function whyNotEat(meal: string, eaten: readonly string[]): 'ate_it' | 'two_meals' | null {
  if (eaten.includes(meal)) return 'ate_it';
  return eaten.length >= MEALS_MAX ? 'two_meals' : null;
}

/** What the meals eaten do, one each, as Mods to go beside the charms' (modsOf). */
export function mealMods(eaten: readonly string[] | undefined, items: Map<string, ItemDef>): Array<Partial<Mods>> {
  return [...new Set(eaten ?? [])].flatMap(id => {
    const def = items.get(id);
    return isMeal(def) ? [def!.eaten!] : [];
  });
}

/**
 * Saved meals as the game keeps them: meals these items know, each once, at most MEALS_MAX, in the order
 * they were eaten. Anything else (a meal a newer release knows) is forgotten: it would end at home anyway.
 */
export function cleanMeals(saved: unknown, items: Map<string, ItemDef>): string[] {
  const out: string[] = [];
  for (const id of Array.isArray(saved) ? saved : []) {
    if (typeof id === 'string' && isMeal(items.get(id)) && !out.includes(id) && out.length < MEALS_MAX) out.push(id);
  }
  return out;
}

/** A fire cooks while it burns: tended (null), or with fuel left. A dead one cooks nothing. */
export function cooks(left: number | null | undefined): boolean {
  return left === null || (left !== undefined && left > 0);
}

/** How many of an item a bag holds, over all its slots. */
function held(bag: readonly BagSlot[], item: string): number {
  return bag.reduce((n, s) => n + (s.item === item ? s.count : 0), 0);
}

/** What a bag lacks for a recipe, need by need (none: it can be cooked now). */
export function bagShort(recipe: Recipe, bag: readonly BagSlot[]): BagSlot[] {
  return recipe.needs.flatMap(n => {
    const short = n.count - held(bag, n.item);
    return short > 0 ? [{ item: n.item, count: short }] : [];
  });
}

/** The recipes a bag can cook now, in the order of the data. */
export function cookable(cooking: readonly Recipe[], bag: readonly BagSlot[]): Recipe[] {
  return cooking.filter(r => !bagShort(r, bag).length);
}

/** Does a bag hold something to cook: anything a recipe cooks with, enough for it or not? */
export function carriesFood(cooking: readonly Recipe[], bag: readonly BagSlot[]): boolean {
  return cooking.some(r => r.needs.some(n => held(bag, n.item) > 0));
}

/**
 * The recipe a bag comes nearest to, among those it holds something of: the one it lacks the fewest
 * units for (the first of equals). Undefined when it holds nothing to cook.
 */
export function nearestCooking(cooking: readonly Recipe[], bag: readonly BagSlot[]): Recipe | undefined {
  let best: Recipe | undefined, fewest = Infinity;
  for (const r of cooking) {
    if (!r.needs.some(n => held(bag, n.item) > 0)) continue;
    const short = bagShort(r, bag).reduce((sum, s) => sum + s.count, 0);
    if (short < fewest) [best, fewest] = [r, short];
  }
  return best;
}

/** A bag with a recipe's needs taken out of it, from the first slot holding each and then the rest (it holds them: bagShort is empty). */
export function payBag(bag: readonly BagSlot[], needs: readonly BagSlot[]): BagSlot[] {
  let out = bag.map(s => ({ ...s }));
  for (const n of needs) {
    const slot = out.findIndex(s => s.item === n.item);
    if (slot >= 0) out = takeItem(out, slot, n.count).bag;
  }
  return out;
}

/**
 * The kitchen at home (house.ts): what a bag and a stash together lack for a recipe, need by need (none: it
 * can be cooked there now). The bag pays first, then the stash, the pantry under the kitchen.
 */
export function pantryShort(recipe: Recipe, bag: readonly BagSlot[], stash: Readonly<Record<string, number>>): BagSlot[] {
  return recipe.needs.flatMap(n => {
    const short = n.count - held(bag, n.item) - (stash[n.item] ?? 0);
    return short > 0 ? [{ item: n.item, count: short }] : [];
  });
}

/**
 * How the kitchen pays a recipe: all of it the bag holds from the bag, the rest from the stash (they hold it:
 * pantryShort is empty). The bag after, and what is left for the stash to pay, need by need.
 */
export function payPantry(bag: readonly BagSlot[], needs: readonly BagSlot[]): { bag: BagSlot[]; fromBag: BagSlot[]; fromChest: BagSlot[] } {
  const fromBag: BagSlot[] = [], fromChest: BagSlot[] = [];
  for (const n of needs) {
    const carried = Math.min(n.count, held(bag, n.item));
    if (carried) fromBag.push({ item: n.item, count: carried });
    if (n.count > carried) fromChest.push({ item: n.item, count: n.count - carried });
  }
  return { bag: payBag(bag, fromBag), fromBag, fromChest };
}
