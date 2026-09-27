/**
 * What things are. The items (content/items.json) ship with the client like the maps, so a bag or a
 * find can be named and shown without asking the server. The server's welcome says which version it
 * runs; a client with another one is out of date and reloads (main.ts).
 * Plain logic with no drawing, so it can be tested.
 */
import {
  BAG_SLOTS, SLOTS, itemIndex, resistOf, type BagSlot, type Element, type Gear, type ItemDef, type ItemsData, type Recipe, type Refusal, type Slot,
} from '@napoland/shared';
import type { RecipeView, WornView } from './hud';
import type { Look } from './view/characters';
import { iconFor } from './icons';

export class Items {
  /** The version of content/items.json this client carries; 0 when it has none. */
  readonly version: number;
  /** Every item by id, for the shared rules (gear.ts, items.ts) that want the map. */
  readonly byId: Map<string, ItemDef>;
  /** What the workbench makes. */
  readonly recipes: Recipe[];

  constructor(data: ItemsData | undefined) {
    this.version = data?.version ?? 0;
    this.byId = data ? itemIndex(data) : new Map();
    this.recipes = data?.recipes ?? [];
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /**
   * An item by id. One this copy does not know (it should not happen, the versions match) gets a
   * plain stand-in named after its id, so the bag still shows something sensible.
   */
  get(id: string): ItemDef {
    return this.byId.get(id) ?? { id, name: plainName(id), kind: 'resource', stack: 1, text: 'Something you found out there.' };
  }
}

/** "fir-resin" becomes "Fir resin". */
export function plainName(id: string): string {
  const s = id.replace(/[-_]+/g, ' ').trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : 'Something';
}

/** What using an item did, for a float over your head: "+30 energy". */
export function useText(item: ItemDef): string {
  const u = item.use ?? {};
  if (u.energy) return `${u.energy > 0 ? '+' : ''}${u.energy} energy`;
  if (u.mark) return 'You marked the way';
  if (u.flare) return 'The flare hisses red';
  if (u.identify) return 'You turn it over in the light';
  return `Used the ${item.name.toLowerCase()}`;
}

/** The word on the bag's button for using an item. */
export function useLabel(item: ItemDef): string {
  const u = item.use ?? {};
  if (u.mark) return 'Mark the way';
  if (u.flare) return 'Light it';
  if (u.identify) return 'Look closely';
  if (u.energy) return 'Drink';
  return 'Use';
}

/** Why the server said no, in plain words, for a float over your head. */
export function refusalText(reason: Refusal): string {
  switch (reason) {
    case 'bag_full': return 'Your bag is full';
    case 'too_far': return 'Too far';
    case 'gone': return 'Someone got there first';
    case 'not_usable': return 'That cannot be used';
    case 'empty_slot': return 'That slot is empty';
    case 'not_here': return 'Not here';
    case 'not_fuel': return 'That will not burn';
    case 'fire_full': return 'The fire is as big as it gets';
    case 'tended': return 'Someone keeps this fire going';
    case 'marked': return 'There is a mark here already';
    case 'not_stashed': return 'That is not in your stash';
    case 'not_gear': return 'That is not something you wear';
    case 'bag_too_full': return 'What you carry does not fit in that bag';
    case 'keep_bag': return 'You always carry a bag';
    case 'missing': return 'Your stash lacks what it needs';
  }
}

/** One bag slot as the bag shows it. */
export interface SlotView {
  item: string;
  name: string;
  text: string;
  count: number;
  /** It can be used: the bag offers a button, with this word on it. */
  usable: boolean;
  useLabel: string;
  /** Small facts under the text: how heavy, what it does in a fire or in your bag. */
  facts: string[];
  /** Its drawing (icons.ts). */
  icon: string;
  /** Gear: the slot it is worn in. */
  slot?: Slot;
}

export function slotViews(bag: readonly BagSlot[], items: Items): SlotView[] {
  return bag.map(s => {
    const def = items.get(s.item);
    return { item: s.item, name: def.name, text: def.text, count: s.count, usable: !!def.use, useLabel: useLabel(def), facts: factsOf(def), icon: iconFor(def), ...(def.slot ? { slot: def.slot } : {}) };
  });
}

/** What is worth knowing about an item besides its text, in a few words each. */
export function factsOf(def: ItemDef): string[] {
  const out: string[] = [];
  if (def.kind === 'gear') {
    for (const [e, v] of Object.entries(def.resist ?? {})) out.push(`${ELEMENT_WORDS[e as Element]} ${Math.round(v * 100)}%`);
    if (def.bag) out.push(`${def.bag} slots`);
    if (def.bonus) out.push(`+${def.bonus} energy`);
    if (def.tier && def.tier !== 'worn') out.push(capital(def.tier));
    out.push(`Worn: ${def.slot}`);
  }
  if (def.xp) out.push(`${def.xp} XP at home`);
  if (def.weight) out.push(def.weight >= 0.95 ? `${Math.round(def.weight * 10) / 10} kg` : `${Math.round(def.weight * 1000)} g`);
  if (def.fuel) out.push(`Burns ${Math.round(def.fuel / 60)} min`);
  if (def.charge) out.push('The Old Stone wants it');
  if (def.kind === 'charm') out.push('Works while in your bag');
  return out;
}

/** What someone looks like in what they wear (characters.ts): each piece's color, and the bag's size. */
export function lookOf(gear: Gear, items: Items): Look {
  // No cap: the hair shows. (Other slots, left bare, keep the old look: nobody walks out barefoot.)
  const out: Look = gear.cap ? {} : { cap: null };
  for (const slot of SLOTS) {
    const id = gear[slot];
    const def = id ? items.get(id) : undefined;
    if (def?.kind !== 'gear' || !def.color) continue;
    out[slot] = def.color;
    if (slot === 'bag' && def.bag) out.bagSize = Math.sqrt(def.bag / BAG_SLOTS);
  }
  return out;
}

/** The workbench's recipes against what a stash holds: what each makes, what it needs, whether it can. */
export function recipeViews(recipes: readonly Recipe[], stash: readonly BagSlot[], items: Items): RecipeView[] {
  return recipes.map(r => {
    const def = items.get(r.make);
    const needs = r.needs.map(n => ({ name: items.get(n.item).name, icon: iconFor(items.get(n.item)), have: countOf(stash, n.item), need: n.count }));
    return { id: r.id, name: def.name, icon: iconFor(def), facts: factsOf(def).join(' · '), needs, can: needs.every(n => n.have >= n.need) };
  });
}

/** What is worn in each slot, in SLOTS order (null: bare). */
export function wornViews(gear: Gear, items: Items): Array<WornView | null> {
  return SLOTS.map(slot => {
    const id = gear[slot];
    if (!id || !items.has(id)) return null;
    const def = items.get(id);
    return { slot, name: def.name, icon: iconFor(def) };
  });
}

/** "Cold 25%, wind 45%": what the gear worn resists, or null for nothing. */
export function resistText(gear: Gear, items: Items): string | null {
  const r = resistOf(gear, items.byId);
  const parts = (Object.entries(r) as Array<[Element, number]>).filter(([, v]) => v > 0).map(([e, v]) => `${ELEMENT_WORDS[e]} ${Math.round(v * 100)}%`);
  return parts.length ? parts.join(', ') : null;
}

/** How many of an item a bag holds, over all its slots. */
export function countOf(bag: readonly BagSlot[], item: string): number {
  return bag.reduce((n, s) => n + (s.item === item ? s.count : 0), 0);
}

/** The elements in plain words. */
export const ELEMENT_WORDS: Readonly<Record<Element, string>> = { heat: 'Heat', cold: 'Cold', wind: 'Wind', electricity: 'Electricity', radiation: 'Radiation' };
const capital = (t: string) => t[0]!.toUpperCase() + t.slice(1);
