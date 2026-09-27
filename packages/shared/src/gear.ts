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
 *
 * Each piece has a condition, 1 new to 0 worn out. Worn out in the wilds it wears down (`wear` in
 * content/items.json: seconds of wilds by tier); below WEAR_FADES it protects less and less, and at 0
 * not at all, until it is mended at the workbench (`mend`: what that costs, by tier). The rarest
 * pieces (anomalous) come with a quirk (QUIRKS), rolled when one first lands in your stash or on you.
 */
import { BAG_SLOTS, type BagSlot, type ItemDef, type ItemsData } from './items';

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

/** One piece of gear: its condition (1 new, 0 worn out) and its quirk, if it has one. */
export interface Piece {
  cond: number;
  quirk?: Quirk;
}

/** What you wear, piece by piece, by slot. */
export type Worn = Partial<Record<Slot, Piece>>;

/** Below this condition a piece protects less, down to nothing at 0. */
export const WEAR_FADES = 0.25;

/** How much of its protection and energy a piece in condition `cond` still gives: 1 down to 0. */
export const pieceFactor = (cond: number): number => Math.min(1, Math.max(0, cond / WEAR_FADES));

/**
 * Quirks of anomalous gear, the rules they change (content/items.json names and describes them):
 * - footprints: your steps glow a while where you walk out there, for everyone to see;
 * - flicker: street lights flicker as you pass, for everyone to see;
 * - hum: it hums a minute before your region grows restless, before anyone is told.
 */
export type Quirk = 'footprints' | 'flicker' | 'hum';
export const QUIRKS: readonly Quirk[] = ['footprints', 'flicker', 'hum'];
/** The hum comes this many seconds before a region grows restless. */
export const HUM_BEFORE_S = 60;

/** A new piece of `def`: whole, and with a quirk if it is anomalous. */
export function newPiece(def: ItemDef, rng: () => number): Piece {
  return def.tier === 'anomalous' ? { cond: 1, quirk: QUIRKS[Math.floor(rng() * QUIRKS.length)]! } : { cond: 1 };
}

/** A recipe at the workbench: what it makes (into your stash) from what your stash holds. */
export interface Recipe {
  id: string;
  make: string;
  count?: number;
  needs: BagSlot[];
}

export const noResist = (): Resist => ({ heat: 0, cold: 0, wind: 0, electricity: 0, radiation: 0 });

/** Every element's resistance over what is worn (as worn down as `pieces` say), each at most RESIST_MAX. */
export function resistOf(gear: Gear, items: Map<string, ItemDef>, pieces: Worn = {}): Resist {
  const out = noResist();
  for (const s of SLOTS) {
    const def = gear[s] ? items.get(gear[s]!) : undefined;
    if (def?.kind !== 'gear') continue;
    const k = pieceFactor(pieces[s]?.cond ?? 1);
    for (const e of ELEMENTS) out[e] += (def.resist?.[e] ?? 0) * k;
  }
  for (const e of ELEMENTS) out[e] = Math.round(Math.min(RESIST_MAX, Math.max(0, out[e])) * 1000) / 1000;
  return out;
}

/** Slots in the bag worn. */
export function bagSlotsOf(gear: Gear, items: Map<string, ItemDef>): number {
  const def = gear.bag ? items.get(gear.bag) : undefined;
  return def?.kind === 'gear' && def.bag ? def.bag : NO_BAG;
}

/** Extra energy the pieces worn give (none from one worn out), added to the bar. */
export function gearEnergy(gear: Gear, items: Map<string, ItemDef>, pieces: Worn = {}): number {
  return SLOTS.reduce((n, s) => {
    const def = gear[s] ? items.get(gear[s]!) : undefined;
    return def?.kind === 'gear' ? n + Math.round((def.bonus ?? 0) * pieceFactor(pieces[s]?.cond ?? 1)) : n;
  }, 0);
}

/** Seconds out in the wilds that wear a piece from new to worn out; undefined: it never wears (worn clothes, bags). */
export function wearSeconds(def: ItemDef | undefined, wear: ItemsData['wear']): number | undefined {
  if (def?.kind !== 'gear' || def.slot === 'bag' || !def.tier) return undefined;
  const s = wear?.[def.tier];
  return s && s > 0 ? s : undefined;
}

/** What mending a piece of `def` costs at the workbench (by its tier); undefined: it cannot be mended. */
export function mendCost(def: ItemDef | undefined, mend: ItemsData['mend']): BagSlot[] | undefined {
  return def?.kind === 'gear' && def.tier ? mend?.[def.tier] : undefined;
}

/** Can the stash pay for a recipe (items: how many of each it holds)? */
export function canMake(recipe: Recipe, stash: Record<string, number>): boolean {
  return recipe.needs.every(n => (stash[n.item] ?? 0) >= n.count);
}
