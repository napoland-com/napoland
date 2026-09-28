/**
 * What things are. The items (content/items.json) ship with the client like the maps, so a bag or a
 * find can be named and shown without asking the server. The server's welcome says which version it
 * runs; a client with another one is out of date and reloads (main.ts).
 * Plain logic with no drawing, so it can be tested.
 */
import {
  BAG_SLOTS, SLOTS, WEAR_FADES, itemIndex, liveEnds, liveXp, mendCost, resistOf, wearSeconds, type BagSlot, type Element, type Gear, type ItemDef, type ItemsData, type Piece, type Quirk,
  type Recipe, type Refusal, type Slot, type Worn,
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
  /** How gear wears out and what mending it costs, and the quirks' names and words. */
  readonly wear: ItemsData['wear'];
  readonly mend: ItemsData['mend'];
  /** What the woods may be like on a day or in a week (sky.ts). */
  readonly conditions: ItemsData['conditions'];
  private readonly quirks: Map<Quirk, { name: string; text: string }>;

  constructor(data: ItemsData | undefined) {
    this.version = data?.version ?? 0;
    this.byId = data ? itemIndex(data) : new Map();
    this.recipes = data?.recipes ?? [];
    this.wear = data?.wear;
    this.mend = data?.mend;
    this.conditions = data?.conditions;
    this.quirks = new Map((data?.quirks ?? []).map(q => [q.id, { name: q.name, text: q.text }]));
  }

  /** A quirk's name and words (its id, if this copy does not know it). */
  quirk(id: Quirk): { name: string; text: string } {
    return this.quirks.get(id) ?? { name: plainName(id), text: '' };
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
    case 'unknown_player': return 'Nobody by that name';
    case 'requests_off': return 'They take no friend requests';
    case 'not_friends': return 'You can only message friends';
    case 'you_blocked': return 'You blocked them';
    case 'too_many': return 'Too many waiting already';
    case 'slow_down': return 'Slow down a little';
    case 'sign_in_first': return 'Sign in to talk';
    case 'gear_stays': return 'Put gear on from the chest';
    case 'whole': return 'It needs no mending';
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
  /** A piece of gear in the stash: its condition (0 to 1; none for gear that never wears), and which of that item's pieces it is (the stash's order). */
  cond?: number;
  n?: number;
  /** A live find: what it is, what it fades into, and its age in seconds when the bag was told (liveState). */
  live?: { def: ItemDef; into?: ItemDef; age: number };
}

export function slotViews(bag: readonly BagSlot[], items: Items): SlotView[] {
  const nth = new Map<string, number>();
  return bag.map(s => {
    const def = items.get(s.item), p = s.piece;
    const base: SlotView = {
      item: s.item, name: def.name, text: def.text, count: s.count, usable: !!def.use, useLabel: useLabel(def), facts: factsOf(def), icon: iconFor(def),
      ...(def.slot ? { slot: def.slot } : {}), ...(def.live && s.age !== undefined ? { live: { def, into: items.has(def.live.into) ? items.get(def.live.into) : undefined, age: s.age } } : {}),
    };
    if (!p) return base;
    const n = nth.get(s.item) ?? 0;
    nth.set(s.item, n + 1);
    const q = p.quirk && items.quirk(p.quirk), wears = wearSeconds(def, items.wear) !== undefined;
    return { ...base, ...(wears ? { cond: p.cond } : {}), n, text: q ? `${def.text} ${q.name}: ${q.text}` : def.text, facts: [conditionText(p.cond, wears), ...base.facts] };
  });
}

/**
 * A live find `ageS` seconds after it was picked: "Worth 40 XP for 3:12 more" while fresh, then "Fading:
 * 30 XP now"; and how much of that stretch is left (1 to 0), for the ring on its slot.
 */
export function liveState(live: NonNullable<SlotView['live']>, ageS: number): { text: string; left: number; fading: boolean } {
  const { def, into } = live, fresh = def.live?.fresh ?? 0, xp = liveXp(def, ageS, into);
  if (ageS <= fresh) {
    const s = Math.ceil(fresh - ageS);
    return { text: `Worth ${xp} XP for ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} more`, left: (fresh - ageS) / fresh, fading: false };
  }
  const ends = liveEnds(def, into);
  return { text: `Fading: ${xp} XP now`, left: Math.max(0, (ends - ageS) / (ends - fresh)), fading: true };
}

/**
 * How worn a piece is, in words: "Like new", "Worn: 40% left" (below a quarter left it protects less,
 * and says so), "Worn out: it protects nothing until it is mended". Worn clothes and bags never wear.
 */
export function conditionText(cond: number, wears = true): string {
  if (!wears) return 'Never wears out';
  if (cond >= 0.995) return 'Like new';
  if (cond <= 0) return 'Worn out: it protects nothing until it is mended';
  return cond < WEAR_FADES ? `${wornLeft(cond)}, and it protects less until it is mended` : wornLeft(cond);
}

/** "Worn: 40% left" (never 0% while anything is left). */
function wornLeft(cond: number): string {
  return `Worn: ${Math.max(1, Math.round(cond * 100))}% left`;
}

/** "Raincoat 40%, rubber boots worn out": what you wear that is wearing down, or null when all of it is fine. */
export function wearText(gear: Gear, worn: Worn, items: Items): string | null {
  const parts = SLOTS.flatMap(slot => {
    const id = gear[slot], p = worn[slot], def = id ? items.get(id) : undefined;
    if (!def || !p || p.cond >= 0.995 || wearSeconds(def, items.wear) === undefined) return [];
    return [`${def.name} ${p.cond <= 0 ? 'worn out' : `${Math.max(1, Math.round(p.cond * 100))}%`}`];
  });
  return parts.length ? parts.join(', ') : null;
}

/** The quirks of what you wear, by name ("Glowing steps"). */
export function quirkNames(worn: Worn, items: Items): string[] {
  return SLOTS.flatMap(s => (worn[s]?.quirk ? [items.quirk(worn[s]!.quirk!).name] : []));
}

/** What is worth knowing about an item besides its text, in a few words each. */
export function factsOf(def: ItemDef): string[] {
  const out: string[] = [];
  if (def.kind === 'gear') {
    for (const [e, v] of Object.entries(def.resist ?? {})) out.push(`${ELEMENT_WORDS[e as Element]} ${Math.round(v * 100)}%`);
    if (def.bag) out.push(`${def.bag} slots`);
    if (def.bonus) out.push(`+${def.bonus} energy`);
    if (def.tier && def.tier !== 'worn') out.push(capital(def.tier));
    if (def.slot) out.push(slotName(def.slot));
  }
  // A live find's worth changes as it fades: its countdown says it (liveState).
  if (def.xp && !def.live) out.push(`${def.xp} XP at home`);
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

/**
 * Mending at the workbench: one row for each piece you wear that has worn down and can be mended,
 * with what it costs against what the stash holds. Its id is "mend:" and the slot.
 */
export function mendViews(gear: Gear, worn: Worn, stash: readonly BagSlot[], items: Items): RecipeView[] {
  return SLOTS.flatMap(slot => {
    const id = gear[slot], p: Piece | undefined = worn[slot], def = id ? items.get(id) : undefined;
    const cost = mendCost(def, items.mend);
    if (!def || !p || !cost || p.cond >= 0.995) return [];
    const needs = cost.map(n => ({ name: items.get(n.item).name, icon: iconFor(items.get(n.item)), have: countOf(stash, n.item), need: n.count }));
    return [{ id: `mend:${slot}`, name: `Mend your ${def.name.toLowerCase()}`, icon: iconFor(def), facts: `${p.cond <= 0 ? 'Worn out' : wornLeft(p.cond)}. Like new again when mended.`, needs, can: needs.every(n => n.have >= n.need) }];
  });
}

/** What is worn in each slot, in SLOTS order (null: bare), with how worn down it is. */
export function wornViews(gear: Gear, items: Items, worn: Worn = {}): Array<WornView | null> {
  return SLOTS.map(slot => {
    const id = gear[slot];
    if (!id || !items.has(id)) return null;
    const def = items.get(id), p = worn[slot];
    const wears = wearSeconds(def, items.wear) !== undefined;
    return { slot, name: def.name, icon: iconFor(def), ...(p && wears ? { cond: p.cond } : {}), ...(p?.quirk ? { quirk: items.quirk(p.quirk).name } : {}) };
  });
}

/** "Cold 25%, wind 45%": what the gear worn resists (as worn down as it is), or null for nothing. */
export function resistText(gear: Gear, items: Items, worn: Worn = {}): string | null {
  const r = resistOf(gear, items.byId, worn);
  const parts = (Object.entries(r) as Array<[Element, number]>).filter(([, v]) => v > 0).map(([e, v]) => `${ELEMENT_WORDS[e]} ${Math.round(v * 100)}%`);
  return parts.length ? parts.join(', ') : null;
}

/** How many of an item a bag holds, over all its slots. */
export function countOf(bag: readonly BagSlot[], item: string): number {
  return bag.reduce((n, s) => n + (s.item === item ? s.count : 0), 0);
}

/** The elements in plain words. */
export const ELEMENT_WORDS: Readonly<Record<Element, string>> = { heat: 'Heat', cold: 'Cold', wind: 'Wind', electricity: 'Electricity', radiation: 'Radiation' };

/** "Cap slot": where a piece goes, as the Wearing row names it. */
export function slotName(slot: Slot): string {
  return `${capital(slot)} slot`;
}

const capital = (t: string) => t[0]!.toUpperCase() + t.slice(1);
