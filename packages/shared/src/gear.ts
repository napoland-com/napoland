/**
 * Equipment: six slots, what each piece resists, how big the bag is. Gear is put on and taken off at
 * the chest at home, and anywhere from and into the bag: a carried piece takes a bag slot and weighs
 * what it weighs. The bag you wear changes only at home. What you wear stays with you when you
 * collapse (a carried piece falls into the pile like anything you carry), and others see what you wear.
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
 * pieces (anomalous) come with a quirk (QUIRKS), rolled when a piece comes to be: in your stash, on
 * you, or in your bag.
 *
 * A piece can be upgraded at the workbench, one level at a time from +1 to +9 (`upgrades` in
 * content/items.json: what each level costs, and how often it works). Each level makes it resist
 * UPGRADE_STEP more of what it resists and wear UPGRADE_STEP more slowly; the resistances still stop at
 * RESIST_MAX in all. Worn clothes (they resist nothing) and bags (their size is the point) are not upgraded.
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

/** One piece of gear: its condition (1 new, 0 worn out), its quirk if it has one, and its upgrade level (none: +0). */
export interface Piece {
  cond: number;
  quirk?: Quirk;
  level?: number;
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
 * - hum: it hums a minute before your region grows restless, before anyone is told;
 * - hush: skulkers hear you walking from fewer steps (the server's skulkers: SKULKER_HEAR_HUSHED);
 * - lodestone: while a shard lies within LODESTONE_TILES of you, it tugs now and then, a soft pulse and a
 *   faint sound, and never says which way (your own game, from the finds it knows);
 * - afterglow: a flash that discharges within AFTERGLOW_NEAR tiles of you leaves you glowing faintly for
 *   AFTERGLOW_S, for everyone to see, and watchers keep off you while you do.
 */
export type Quirk = 'footprints' | 'flicker' | 'hum' | 'hush' | 'lodestone' | 'afterglow';
export const QUIRKS: readonly Quirk[] = ['footprints', 'flicker', 'hum', 'hush', 'lodestone', 'afterglow'];
/** The hum comes this many seconds before a region grows restless. */
export const HUM_BEFORE_S = 60;
/** A lodestone tugs while a shard (anything the Old Stone takes) lies this close: tiles, center to center. */
export const LODESTONE_TILES = 5;
/** Afterglow: a flash discharging this close (tiles, center to center, from its middle) leaves you glowing this long (seconds). */
export const AFTERGLOW_NEAR = 4;
export const AFTERGLOW_S = 30;

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

/** The highest level a piece goes to, and what each level adds: that share more of what it resists, and of how long it lasts out there. */
export const UPGRADE_MAX = 9;
export const UPGRADE_STEP = 0.05;

/** What going up one level takes from the stash (`upgrades` in content/items.json, +1 first), and how often it works (always, left out). */
export interface Upgrade {
  needs: BagSlot[];
  chance?: number;
}

/** What a piece's level multiplies what it resists and how long it lasts by: 1 at +0, 1.45 at +9. */
export const upgradeFactor = (level = 0): number => 1 + UPGRADE_STEP * Math.min(UPGRADE_MAX, Math.max(0, Math.floor(level)));

/** Can a piece of `def` be upgraded? Gear of any tier but worn clothes (they resist nothing), and never a bag (its size is the point). */
export function upgradable(def: ItemDef | undefined): boolean {
  return def?.kind === 'gear' && def.slot !== 'bag' && def.tier !== undefined && def.tier !== 'worn';
}

/** Going from `level` to the next: what it takes and how often it works. Undefined at the top, or past the levels the data lists. */
export function nextUpgrade(level: number, upgrades: ItemsData['upgrades']): Upgrade | undefined {
  const l = Math.max(0, Math.floor(level));
  return l < UPGRADE_MAX ? upgrades?.[l] : undefined;
}

/** How often an upgrade works, from 0 to 1 (1: always). */
export const upgradeChance = (u: Upgrade): number => Math.min(1, Math.max(0, u.chance ?? 1));

export const noResist = (): Resist => ({ heat: 0, cold: 0, wind: 0, electricity: 0, radiation: 0 });

/**
 * Every element's resistance over what is worn (as worn down and as upgraded as `pieces` say), with
 * `extra` on top (effects running, effects.ts, and what a meal eaten adds, meals.ts), each at most RESIST_MAX
 * in all: nothing makes anyone immune.
 */
export function resistOf(gear: Gear, items: Map<string, ItemDef>, pieces: Worn = {}, extra: Partial<Resist> = {}): Resist {
  const out = noResist();
  for (const s of SLOTS) {
    const def = gear[s] ? items.get(gear[s]!) : undefined;
    if (def?.kind !== 'gear') continue;
    const k = pieceFactor(pieces[s]?.cond ?? 1) * upgradeFactor(pieces[s]?.level);
    for (const e of ELEMENTS) out[e] += (def.resist?.[e] ?? 0) * k;
  }
  for (const e of ELEMENTS) out[e] += extra[e] ?? 0;
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

/**
 * Seconds out in the wilds that wear a piece from new to worn out, longer the higher it is upgraded;
 * undefined: it never wears (worn clothes, bags).
 */
export function wearSeconds(def: ItemDef | undefined, wear: ItemsData['wear'], level = 0): number | undefined {
  if (def?.kind !== 'gear' || def.slot === 'bag' || !def.tier) return undefined;
  const s = wear?.[def.tier];
  return s && s > 0 ? s * upgradeFactor(level) : undefined;
}

/** What mending a piece of `def` costs at the workbench (by its tier); undefined: it cannot be mended. */
export function mendCost(def: ItemDef | undefined, mend: ItemsData['mend']): BagSlot[] | undefined {
  return def?.kind === 'gear' && def.tier ? mend?.[def.tier] : undefined;
}

/** Can the stash pay for a recipe (items: how many of each it holds)? */
export function canMake(recipe: Recipe, stash: Record<string, number>): boolean {
  return recipe.needs.every(n => (stash[n.item] ?? 0) >= n.count);
}

/** The nearest piece of gear someone could make, and what it still lacks. */
export interface NextGear {
  recipe: Recipe;
  /** What the stash and the bag together still lack for it, need by need (none: they hold enough). */
  missing: BagSlot[];
  /** The stash alone pays for it: it can be made at the workbench now. */
  ready: boolean;
}

/**
 * A first goal (the first day): the nearest piece of gear someone could make, among the recipes whose
 * result they own none of yet (`owned`: what they wear, carry and keep in their stash). One the stash can pay
 * for now comes first; otherwise the one that lacks the fewest units, counting what the stash and the bag
 * hold (a find carried home counts before it is put away). The first of equals, in the recipes' order.
 * Null when they own everything a recipe makes.
 */
export function nearestRecipe(recipes: readonly Recipe[], owned: ReadonlySet<string>, stash: Readonly<Record<string, number>>, bag: Readonly<Record<string, number>>): NextGear | null {
  let best: NextGear | null = null, bestShort = Infinity;
  for (const recipe of recipes) {
    if (owned.has(recipe.make)) continue;
    const ready = canMake(recipe, stash);
    const missing = recipe.needs.flatMap(n => {
      const short = n.count - (stash[n.item] ?? 0) - (bag[n.item] ?? 0);
      return short > 0 ? [{ item: n.item, count: short }] : [];
    });
    const short = ready ? -1 : missing.reduce((sum, m) => sum + m.count, 0);
    if (short < bestShort) {
      best = { recipe, missing, ready };
      bestShort = short;
    }
  }
  return best;
}
