/**
 * What things are. The items (content/items.json) ship with the client like the maps, so a bag or a
 * find can be named and shown without asking the server. The server's welcome says which version it
 * runs; a client with another one is out of date and reloads (main.ts).
 * Plain logic with no drawing, so it can be tested.
 */
import {
  BAG_SLOTS, SLOTS, WEAR_FADES, effectResist, itemIndex, liveEnds, liveXp, longNightWords, mendCost, meritLookOf, nextUpgrade, outfitOf, resistOf, shopLookOf, upgradable, upgradeChance, wearSeconds,
  type BagSlot, type EffectView, type Element, type Gear, type ItemDef, type ItemsData, type Piece, type PieceAt, type Quirk, type Recipe, type Refusal, type RefusedAction, type ShopData, type Slot,
  type Upgrade, type Worn,
} from '@napoland/shared';
import type { RecipeView, ToolView, WornView } from './hud';
import type { Look } from './view/characters';
import { iconFor } from './icons';

export class Items {
  /** The version of content/items.json this client carries; 0 when it has none. */
  readonly version: number;
  /** Every item by id, for the shared rules (gear.ts, items.ts) that want the map. */
  readonly byId: Map<string, ItemDef>;
  /** What the workbench makes. */
  readonly recipes: Recipe[];
  /** How gear wears out, what mending and upgrading it cost, and the quirks' names and words. */
  readonly wear: ItemsData['wear'];
  readonly mend: ItemsData['mend'];
  readonly upgrades: ItemsData['upgrades'];
  /** What the woods may be like on a day or in a week (sky.ts). */
  readonly conditions: ItemsData['conditions'];
  /** Where the keepsakes lie, and what the whole set home gives (notes.ts). */
  readonly keepsakes: ItemsData['keepsakes'];
  /** What the Long Night's bonus does, in words ("wire and strange objects grow back twice as fast"); empty without one. */
  readonly longNight: string;
  private readonly quirks: Map<Quirk, { name: string; text: string }>;

  constructor(data: ItemsData | undefined) {
    this.version = data?.version ?? 0;
    this.byId = data ? itemIndex(data) : new Map();
    this.recipes = data?.recipes ?? [];
    this.wear = data?.wear;
    this.mend = data?.mend;
    this.upgrades = data?.upgrades;
    this.conditions = data?.conditions;
    this.keepsakes = data?.keepsakes;
    this.longNight = longNightWords(data?.longNight, this.byId);
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

/** The word on the bag's button for using an item. */
export function useLabel(item: ItemDef): string {
  const u = item.use ?? {};
  if (u.mark) return 'Mark the way';
  if (u.flare) return 'Light it';
  if (u.identify) return 'Look closely';
  if (u.energy) return 'Drink';
  return 'Use';
}

/**
 * Why the server said no, in plain words: over your head, in the text box for what was asked first, or
 * in the chat's or friends' note (`action` says which).
 */
export function refusalText(reason: Refusal, action?: RefusedAction): string {
  switch (reason) {
    case 'bag_full': return 'Your bag is full';
    case 'too_far': return action === 'move' ? 'Only at your own door' : 'Too far';
    case 'gone': return action === 'move' ? 'They have no cabin on a street yet' : action === 'checkout' ? 'The shop does not sell that' : 'Someone got there first';
    case 'not_usable': return 'That cannot be used';
    case 'empty_slot': return 'That slot is empty';
    case 'not_here': return 'Not here';
    case 'not_yours': return 'That is not yours';
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
    case 'not_friends': return action === 'move' ? 'You can only move next to friends' : 'You can only message friends';
    case 'you_blocked': return 'You blocked them';
    case 'too_many': return 'Too many waiting already';
    case 'slow_down':
      if (action === 'checkout') return 'Give it a moment before you try again';
      return action === 'call' ? 'Catch your breath first' : action === 'knock' ? 'Give them a moment to answer' : action === 'move' ? 'You only just moved' : 'Slow down a little';
    case 'sign_in_first':
      if (action === 'say' || action === undefined) return 'Sign in to talk';
      if (action === 'outfit' || action === 'pattern' || action === 'badge') return `Sign in to wear ${action === 'outfit' ? 'an outfit' : `a ${action}`}`;
      if (action === 'buy') return 'Sign in to spend merits';
      if (action === 'checkout') return 'Sign in to buy looks';
      return action.startsWith('trade') ? 'Sign in to trade' : 'Sign in to make friends';
    case 'guest': return 'They play as a guest: once they sign in, you can be friends';
    case 'bag_at_home': return 'The bag you wear changes only at home';
    case 'whole': return 'It needs no mending';
    case 'have_tool': return action === 'pick' ? 'You have one already. It stays for someone else' : 'You have one already';
    case 'not_upgradable': return 'Worn clothes and bags are not upgraded';
    case 'top_level': return 'It goes no higher';
    case 'sealed_stays': return 'It stays in the chest: open it there';
    case 'locked': return 'Your level has not reached it yet';
    case 'thanked': return 'Thanks go once a day to each person';
    case 'crate_full': return 'The crate is full';
    case 'no_gear': return 'Gear stays with you: a crate takes none';
    case 'keepsake': return 'A keepsake stays with you until you bring it home';
    case 'left_one': return 'You left something here this time already';
    case 'took_one': return 'You took something here this time already';
    case 'owned': return 'It is yours already';
    case 'no_merits': return 'You have no merit to spend on it';
    case 'not_owned': return action === 'outfit' ? 'It is not yours yet' : 'It is not yours yet: spend a merit on it first';
    case 'trades_off': return 'They take no trade requests';
    case 'busy': return 'They are trading with someone else';
    case 'trading': return 'Finish the trade you are in first';
    case 'their_bag_full': return 'Their bag has no room for it';
    case 'nothing_to_trade': return 'There is nothing to trade yet';
    case 'placed': return 'It stands in its place already';
    case 'street_full': return 'Their street has no lot free';
    case 'neighbors': return 'You live on the same street already';
    case 'shop_closed': return 'The shop is closed';
    case 'shop_down': return 'The shop cannot reach Stripe right now. Try again in a moment';
    case 'down': return 'You are down. You cannot move until someone comes';
    case 'too_tired': return 'You need more energy than that';
    case 'padlocked': return 'A padlock, rusted shut';
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
  /**
   * A piece of gear, in the stash or carried: its condition (0 to 1; none for gear that never wears),
   * which of that item's pieces it is (in the list's order), and its quirk's name.
   */
  cond?: number;
  n?: number;
  quirk?: string;
  /** Its upgrade level, once it has one (+1 to +9): shown after its name, and on its slot. */
  level?: number;
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
    return {
      ...base, name: pieceName(def, p.level), ...(wears ? { cond: p.cond } : {}), n, text: q ? `${def.text} ${q.name}: ${q.text}` : def.text,
      facts: [conditionText(p.cond, wears), ...base.facts], ...(q ? { quirk: q.name } : {}), ...(p.level ? { level: p.level } : {}),
    };
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
    return [`${pieceName(def, p.level)} ${p.cond <= 0 ? 'worn out' : `${Math.max(1, Math.round(p.cond * 100))}%`}`];
  });
  return parts.length ? parts.join(', ') : null;
}

/** A piece's name as the game shows it, with its level after it once it is upgraded: "Raincoat +3". */
export function pieceName(def: ItemDef, level = 0): string {
  return level > 0 ? `${def.name} +${level}` : def.name;
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
  // An effect: what it gives, and for how long.
  if (def.use?.resist && def.use.lasts) for (const [e, v] of Object.entries(def.use.resist)) out.push(`${ELEMENT_WORDS[e as Element]} +${Math.round((v ?? 0) * 100)}% for ${Math.round(def.use.lasts / 60)} min`);
  if (def.charge) out.push('The Old Stone wants it');
  if (def.kind === 'charm') out.push('Works while in your bag');
  if (def.kind === 'tool') out.push('A tool, yours for good');
  if (def.kind === 'keepsake') out.push('One of a kind: bring it home');
  if (def.kind === 'furniture' && def.comfort) out.push(`Comfort ${def.comfort}`);
  return out;
}

/**
 * What someone looks like in what they wear (characters.ts): each piece's color, and the bag's size;
 * or, in an outfit (outfits.ts, or one the `shop` sells), the outfit and the bag alone, since nothing
 * else of the gear shows. An outfit this copy does not have leaves them in their gear.
 */
export function lookOf(gear: Gear, items: Items, outfit?: string, pattern?: string, shop?: ShopData): Look {
  // No cap: the hair shows. (Other slots, left bare, keep the old look: nobody walks out barefoot.)
  const out: Look = gear.cap ? {} : { cap: null };
  for (const slot of SLOTS) {
    const id = gear[slot];
    const def = id ? items.get(id) : undefined;
    if (def?.kind !== 'gear' || !def.color) continue;
    out[slot] = def.color;
    if (slot === 'bag' && def.bag) out.bagSize = Math.sqrt(def.bag / BAG_SLOTS);
  }
  // A pattern goes on the jacket, whatever is worn: the gear's, or an outfit's.
  const patterned = meritLookOf(pattern, 'pattern') || shopLookOf(shop, pattern, 'pattern') ? { pattern: pattern! } : {};
  if (!outfitOf(outfit) && !shopLookOf(shop, outfit, 'outfit')) return { ...out, ...patterned };
  // The pack still shows over any outfit: how much someone carries matters out there.
  return { outfit, ...(out.bag ? { bag: out.bag } : {}), ...(out.bagSize ? { bagSize: out.bagSize } : {}), ...patterned };
}

/**
 * The workbench's recipes against what a stash holds: what each makes, what it needs, whether it can.
 * A tool is yours once: the row of one among your `tools` says you have it, and is never ready (its
 * card says so too, details.ts). Furniture for your cabin (comfort.ts) comes after the rest, under a
 * heading of its own, and the row of a piece already among your `furniture` says it stands in its place.
 */
export function recipeViews(recipes: readonly Recipe[], stash: readonly BagSlot[], items: Items, tools: readonly string[] = [], furniture: readonly string[] = []): RecipeView[] {
  const rows = recipes.map((r): RecipeView => {
    const def = items.get(r.make), needs = needsOf(r.needs, stash, items);
    if (def.kind === 'furniture') {
      const placed = furniture.includes(r.make);
      return { id: r.id, group: 'cabin', name: def.name, icon: iconFor(def), facts: placed ? `Comfort ${def.comfort ?? 0} · In its place` : factsOf(def).join(' · '), needs, can: !placed && needs.every(n => n.have >= n.need) };
    }
    const have = def.kind === 'tool' && tools.includes(r.make);
    return { id: r.id, group: 'make', name: def.name, icon: iconFor(def), facts: have ? 'You have it' : factsOf(def).join(' · '), needs, can: !have && needs.every(n => n.have >= n.need) };
  });
  return [...rows.filter(r => r.group !== 'cabin'), ...rows.filter(r => r.group === 'cabin')];
}

/**
 * The buttons in the bag's header for the tools you own, in the order you got them: every map is the
 * one map button, where the first of them came (it opens the map of the area you are in, as M does),
 * and every other tool has a button of its own, beside it. A tool that listens (the radio) is switched
 * on and off by its button: `radioOn` is how this browser left it, and its button says so (`on`).
 */
export function toolViews(tools: readonly string[], items: Items, radioOn = true): ToolView[] {
  let map = false;
  return tools.flatMap((t): ToolView[] => {
    const def = items.get(t);
    // The server sends only tools; one this copy does not know as a tool gets no button of its own.
    if (def.kind !== 'tool') return [];
    if (def.senses) return [{ item: t, label: def.name, icon: iconFor(def), on: radioOn }];
    if (!def.chart) return [{ item: t, label: def.name, icon: iconFor(def) }];
    if (map) return [];
    map = true;
    return [{ item: null, label: 'Open the map', icon: iconFor(def) }];
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
    const needs = needsOf(cost, stash, items);
    return [{
      id: `mend:${slot}`, group: 'mend', name: `Mend your ${pieceName(def, p.level).toLowerCase()}`, icon: iconFor(def),
      facts: `${p.cond <= 0 ? 'Worn out' : wornLeft(p.cond)}. Like new again when mended.`, needs, can: needs.every(n => n.have >= n.need),
    }];
  });
}

/**
 * Upgrading at the workbench: a row for each piece you wear, then each in the stash, that can go up a
 * level, with that level, what it takes against what the stash holds, and how often it works. Worn
 * clothes, bags and pieces at the top have none. Its id is upgradeId ("up:worn:shirt", "up:stash:raincoat:1").
 */
export function upgradeViews(gear: Gear, worn: Worn, stash: readonly BagSlot[], items: Items): RecipeView[] {
  const rows: RecipeView[] = [];
  const add = (of: PieceAt, def: ItemDef, p: Piece, where: string) => {
    const level = p.level ?? 0, next = nextUpgrade(level, items.upgrades);
    if (!upgradable(def) || !next) return;
    const needs = needsOf(next.needs, stash, items);
    rows.push({
      id: upgradeId(of), group: 'upgrade', name: `${pieceName(def, level)} → +${level + 1}`, icon: iconFor(def), facts: `${where}. ${oddsText(next)}`,
      needs, can: needs.every(n => n.have >= n.need),
    });
  };
  for (const slot of SLOTS) {
    const id = gear[slot], p = worn[slot];
    if (id && p && items.has(id)) add({ from: 'worn', slot }, items.get(id), p, 'You wear it');
  }
  const nth = new Map<string, number>();
  for (const s of stash) {
    if (!s.piece) continue;
    const n = nth.get(s.item) ?? 0;
    nth.set(s.item, n + 1);
    add({ from: 'stash', item: s.item, n }, items.get(s.item), s.piece, 'In the stash');
  }
  return rows;
}

/** An upgrade row's id at the workbench: "up:worn:shirt", "up:stash:raincoat:1". */
export function upgradeId(of: PieceAt): string {
  return of.from === 'worn' ? `up:worn:${of.slot}` : `up:stash:${of.item}:${of.n}`;
}

/** The piece an upgrade row's id names, or null for anything else. */
export function upgradeOf(id: string): PieceAt | null {
  const [up, from, a, b] = id.split(':');
  if (up !== 'up') return null;
  if (from === 'worn' && (SLOTS as readonly string[]).includes(a ?? '')) return { from: 'worn', slot: a as Slot };
  const n = Number(b);
  return from === 'stash' && a && Number.isInteger(n) && n >= 0 ? { from: 'stash', item: a, n } : null;
}

/** How often an upgrade works, in words: "It always works.", "It works 7 times in 10." */
export function oddsText(u: Upgrade): string {
  const c = upgradeChance(u);
  if (c >= 1) return 'It always works.';
  const tenths = Math.round(c * 10);
  return Math.abs(tenths - c * 10) < 1e-9 ? `It works ${tenths} time${tenths === 1 ? '' : 's'} in 10.` : `It works ${Math.round(c * 100)}% of the time.`;
}

/** What something needs from the stash, against what the stash holds. */
function needsOf(needs: readonly BagSlot[], stash: readonly BagSlot[], items: Items): RecipeView['needs'] {
  return needs.map(n => ({ name: items.get(n.item).name, icon: iconFor(items.get(n.item)), have: countOf(stash, n.item), need: n.count }));
}

/** What is worn in each slot, in SLOTS order (null: bare), with how worn down it is, its quirk and its level. */
export function wornViews(gear: Gear, items: Items, worn: Worn = {}): Array<WornView | null> {
  return SLOTS.map(slot => {
    const id = gear[slot];
    if (!id || !items.has(id)) return null;
    const def = items.get(id), p = worn[slot];
    const wears = wearSeconds(def, items.wear) !== undefined;
    return {
      slot, name: pieceName(def, p?.level), icon: iconFor(def), ...(p && wears ? { cond: p.cond } : {}), ...(p?.quirk ? { quirk: items.quirk(p.quirk).name } : {}),
      ...(p?.level ? { level: p.level } : {}),
    };
  });
}

/** "Cold 25%, wind 45%": what the gear worn resists (as worn down as it is), or null for nothing. */
export function resistText(gear: Gear, items: Items, worn: Worn = {}, effects: readonly EffectView[] = []): string | null {
  // The effects working on you count with your gear, under the same cap (effects.ts).
  const r = resistOf(gear, items.byId, worn, effectResist(effects, items.byId));
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
