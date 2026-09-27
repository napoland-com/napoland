/**
 * Equipment: six slots, what each piece resists, how big the bag is. Gear is put on and taken off
 * only at home (at the chest), it stays with you when you collapse, and others see what you wear.
 *
 * Five elements, each with its own resistance (DESIGN.md, Hazards), all applied in energy.ts:
 * - cold: the extra drain of rain, night and aurora, and of being wet (more in a storm);
 * - wind: how fast rain soaks you, and half of a storm's extra drain;
 * - electricity: half of a surge's and of a storm's extra drain, and all of a spark's;
 * - radiation: half of a surge's extra drain;
 * - heat: a fire flash's extra drain.
 * Resistances add up over the pieces worn and never make you immune: each stops at RESIST_MAX.
 */
import { BAG_SLOTS, type BagSlot, type ItemDef } from './items';

export type Slot = 'cap' | 'shirt' | 'gloves' | 'pants' | 'shoes' | 'bag';
export const SLOTS: readonly Slot[] = ['cap', 'shirt', 'gloves', 'pants', 'shoes', 'bag'];

export type Element = 'heat' | 'cold' | 'wind' | 'electricity' | 'radiation';
export const ELEMENTS: readonly Element[] = ['heat', 'cold', 'wind', 'electricity', 'radiation'];

export type Tier = 'worn' | 'sturdy' | 'rugged' | 'expedition' | 'anomalous';
export const TIERS: readonly Tier[] = ['worn', 'sturdy', 'rugged', 'expedition', 'anomalous'];

/** No resistance goes past this: gear cuts a loss, it never takes it away. */
export const RESIST_MAX = 0.75;

/** What a player wears, by slot (item ids). A missing slot is bare; the bag is never missing. */
export type Gear = Partial<Record<Slot, string>>;
export type Resist = Record<Element, number>;

/** What everyone starts in: worn clothes and a backpack. */
export const STARTER_GEAR: Readonly<Gear> = {
  cap: 'worn-cap', shirt: 'worn-shirt', gloves: 'worn-gloves', pants: 'worn-pants', shoes: 'worn-shoes', bag: 'backpack',
};

/** Slots when no bag is worn: a world whose items have no bags (the tests) keeps the old bag. */
export const NO_BAG = BAG_SLOTS;

/** A recipe at the workbench: what it makes (into your stash) from what your stash holds. */
export interface Recipe {
  id: string;
  make: string;
  count?: number;
  needs: BagSlot[];
}

export const noResist = (): Resist => ({ heat: 0, cold: 0, wind: 0, electricity: 0, radiation: 0 });

/** The pieces worn, as item definitions (what does not exist, or is not gear, counts as bare). */
function worn(gear: Gear, items: Map<string, ItemDef>): ItemDef[] {
  return SLOTS.flatMap(s => {
    const def = gear[s] ? items.get(gear[s]!) : undefined;
    return def?.kind === 'gear' ? [def] : [];
  });
}

/** Every element's resistance over what is worn, each at most RESIST_MAX. */
export function resistOf(gear: Gear, items: Map<string, ItemDef>): Resist {
  const out = noResist();
  for (const def of worn(gear, items)) for (const e of ELEMENTS) out[e] += def.resist?.[e] ?? 0;
  for (const e of ELEMENTS) out[e] = Math.round(Math.min(RESIST_MAX, Math.max(0, out[e])) * 1000) / 1000;
  return out;
}

/** Slots in the bag worn. */
export function bagSlotsOf(gear: Gear, items: Map<string, ItemDef>): number {
  const def = gear.bag ? items.get(gear.bag) : undefined;
  return def?.kind === 'gear' && def.bag ? def.bag : NO_BAG;
}

/** Extra energy the pieces worn give, added to the bar. */
export function gearEnergy(gear: Gear, items: Map<string, ItemDef>): number {
  return worn(gear, items).reduce((n, d) => n + (d.bonus ?? 0), 0);
}

/** Can the stash pay for a recipe (items: how many of each it holds)? */
export function canMake(recipe: Recipe, stash: Record<string, number>): boolean {
  return recipe.needs.every(n => (stash[n.item] ?? 0) >= n.count);
}
