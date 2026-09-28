/**
 * A tap looks, an action is a second step. In the chest, at the workbench and in the bag a tap on
 * anything opens its card: what a piece of gear is (tier, what it resists and the energy it adds as
 * worn down as it is, how worn, its quirk, the slot it goes in), what a recipe makes and takes, what a
 * mend takes, what a lockbox may hold, or what something in your bag or stash is. The card's button
 * does the one thing that can be done with it; so do A and a second tap on the same thing (DoubleTap).
 * A card may offer a second thing beside it (throwing away what you carry, taking a piece out of the
 * stash), which only its own button does.
 *
 * Plain logic with no page in it, so it can be tested: main.ts builds a card from the game
 * (detailView), hud.ts draws it and sends what its buttons do.
 */
import { WEAR_FADES, bagSlotsOf, mendCost, pieceFactor, wearSeconds, type BagSlot, type Element, type Gear, type ItemDef, type Piece, type Slot, type Tier, type Worn } from '@napoland/shared';
import { iconFor } from './icons';
import { ELEMENT_WORDS, conditionText, countOf, factsOf, slotName, useLabel, type Items } from './items';
import { holdsText } from './said';

/** A second tap on the same thing within this many milliseconds does what its card's button does. */
export const DOUBLE_TAP_MS = 350;
/**
 * A second tap this close to the first (CSS pixels) is on the same thing even when it lands on the
 * card: the card may have opened under the finger.
 */
export const DOUBLE_TAP_SLOP = 36;

/**
 * Tells a double tap from two taps. The first tap on something only ever shows it; a second on the
 * same thing within DOUBLE_TAP_MS is the double tap. A tap on the card itself (key null) counts as
 * that second tap when it lands within DOUBLE_TAP_SLOP of the first.
 */
export class DoubleTap {
  private last: { key: string; at: number; x: number; y: number } | null = null;

  /**
   * A tap at x,y (screen pixels) at time `at` (ms) on `key` (what was tapped), or null on the card.
   * 'second': it completes a double tap on what the tap before it was on; 'first': a tap on
   * something, which a second one may make a double tap; 'none': neither.
   */
  tap(key: string | null, at: number, x: number, y: number): 'first' | 'second' | 'none' {
    const l = this.last;
    if (l && at - l.at >= 0 && at - l.at <= DOUBLE_TAP_MS && (key === l.key || (key === null && Math.hypot(x - l.x, y - l.y) <= DOUBLE_TAP_SLOP))) {
      this.last = null;
      return 'second';
    }
    this.last = key === null ? null : { key, at, x, y };
    return key === null ? 'none' : 'first';
  }

  /** Forget the last tap: the card or its panel closed another way. */
  clear() {
    this.last = null;
  }
}

/** What a tap in the chest, at the workbench or in the bag is on. */
export type DetailRef =
  /** A slot of your bag, in the chest's bag row or in the bag (and what it held when tapped). */
  | { from: 'bag'; slot: number; item: string }
  /** Something in your stash: gear piece by piece (the `n`th of its item, in the stash's order). */
  | { from: 'stash'; item: string; n?: number }
  /** What you wear in a slot. */
  | { from: 'worn'; slot: Slot }
  /** A recipe at the workbench, and the mending of what you wear in a slot. */
  | { from: 'recipe'; id: string }
  | { from: 'mend'; slot: Slot };

/** Names what a card is about, for the double tap and to keep it open while the game changes around it. */
export function refKey(r: DetailRef): string {
  switch (r.from) {
    case 'bag': return `bag:${r.slot}:${r.item}`;
    case 'stash': return r.n === undefined ? `stash:${r.item}` : `stash:${r.item}:${r.n}`;
    case 'worn': return `worn:${r.slot}`;
    case 'recipe': return `recipe:${r.id}`;
    case 'mend': return `mend:${r.slot}`;
  }
}

/** What a card's button does. */
export type DetailAct =
  /** At the chest: put a bag slot away; take something out (gear: its `n`th piece); wear a piece from the stash; take off into the stash. */
  | { kind: 'store'; slot: number }
  | { kind: 'take'; item: string; n?: number }
  | { kind: 'wear'; item: string; n: number }
  | { kind: 'off'; slot: Slot }
  /** In the bag, anywhere: put on the piece in bag slot `slot`, or take off what a slot wears into the bag. */
  | { kind: 'don'; slot: number }
  | { kind: 'doff'; slot: Slot }
  /** In the bag: use what a slot holds, or throw some of it away. Both ask first. */
  | { kind: 'use'; slot: number }
  | { kind: 'toss'; slot: number }
  /** At the workbench. */
  | { kind: 'make'; recipe: string }
  | { kind: 'mend'; slot: Slot }
  | { kind: 'open'; item: string };

/** Something a piece gives: "Wind 14%" (the element's color), "+5 energy", "Holds 12 things". */
export interface StatView {
  kind: Element | 'energy' | 'bag' | 'none';
  /** What it gives now. */
  text: string;
  /** What it gives when whole ("35%", "+5"), when wear has cut it down. */
  whole?: string;
}

/** One thing a recipe or a mend takes from the stash, against what the stash holds. */
export interface NeedView {
  item: string;
  name: string;
  icon: string;
  have: number;
  need: number;
}

export interface DetailView {
  icon: string;
  name: string;
  /** Gear: its tier and the slot it goes in ("Cap slot"). */
  tier?: { id: Tier; name: string };
  slot?: string;
  /** How many, when there are several. */
  count?: number;
  text: string;
  /** Gear: what it resists and adds, now. Anything else: small facts, as the bag shows them. */
  stats: StatView[];
  facts: string[];
  /** A piece: how worn it is, as a bar (share of it left; none for gear that never wears) and in words. */
  cond?: { share: number; words: string; low: boolean; bar: boolean };
  quirk?: { name: string; text: string };
  costs?: { title: string; needs: NeedView[] };
  notes: Array<{ text: string; tone: 'plain' | 'bad' }>;
  /** The one thing to do with it, which A and a double tap do too (none: nothing can be done here), and why not when it cannot. */
  act?: { label: string; then?: string; enabled: boolean; does: DetailAct };
  /**
   * A second thing it offers, beside the first: throwing away what you carry, taking a piece out of the
   * stash. Only its own button does it, never A or a double tap.
   */
  more?: { label: string; enabled: boolean; tone: 'plain' | 'toss'; does: DetailAct };
}

/** What the card and the rest of the game know: your bag, what the open chest or workbench says your stash holds, what you wear. */
export interface DetailState {
  items: Items;
  bag: readonly BagSlot[];
  stash: readonly BagSlot[];
  gear: Gear;
  worn: Worn;
  /** The tools you own: a recipe for one of them cannot be made again. None known: none. */
  tools?: readonly string[];
  /**
   * Where the card opens: at home (in the chest or at the workbench), where gear goes on from and off
   * into the stash, or in the bag, anywhere, where it goes on from and off into the bag. Home if left out.
   */
  panel?: 'home' | 'bag';
}

/**
 * A piece's name as the game shows it. Upgrades (roadmap/gear-upgrades.md) put the level after it,
 * "Raincoat +3", everywhere a piece is named.
 */
export function pieceName(def: ItemDef, level = 0): string {
  return level > 0 ? `${def.name} +${level}` : def.name;
}

/** "Sturdy". */
export function tierName(tier: Tier): string {
  return capital(tier);
}

/** Gloves, pants and shoes come in pairs: "your rubber boots go", "your raincoat goes". */
const PAIRS: ReadonlySet<Slot> = new Set(['gloves', 'pants', 'shoes']);

/**
 * What a piece resists and the energy it adds, as worn down as it is (a piece below a quarter left
 * protects less, and nothing at all worn out), with what it gives whole beside what wear cut. A bag
 * says first how many things it holds.
 */
export function pieceStats(def: ItemDef, cond = 1): StatView[] {
  const k = pieceFactor(cond), out: StatView[] = [], resist = Object.entries(def.resist ?? {}) as Array<[Element, number]>;
  if (def.bag) out.push({ kind: 'bag', text: `Holds ${def.bag} things` });
  else if (!resist.length) out.push({ kind: 'none', text: 'Resists nothing' });
  for (const [e, v] of resist) {
    const now = Math.round(v * k * 100), full = Math.round(v * 100);
    out.push({ kind: e, text: `${ELEMENT_WORDS[e]} ${now}%`, ...(now < full ? { whole: `${full}%` } : {}) });
  }
  if (def.bonus) {
    const now = Math.round(def.bonus * k);
    out.push({ kind: 'energy', text: `+${now} energy`, ...(now < def.bonus ? { whole: `+${def.bonus}` } : {}) });
  }
  return out;
}

/** A stat in plain words: "Wind 14% (35% when mended)". */
export function statText(s: StatView): string {
  return s.whole ? `${s.text} (${s.whole} when mended)` : s.text;
}

/** A card's button in plain words: "Wear (your worn cap goes into the stash)". */
export function actText(act: NonNullable<DetailView['act']>): string {
  return act.then ? `${act.label} (${act.then})` : act.label;
}

/**
 * What pressing a card's button does (so do A on it and a double tap): what it can do is done, and the
 * card closes, but for using something, which asks first with the card still open, as the bag always
 * did. Greyed out, the button shakes and the card stays to say why; making and mending still go to the
 * game then, which says in the text box what the stash lacks, and sends nothing (ask-first: everything
 * that uses something up goes through one place, which asks first or says why not).
 */
export function cardPress(v: DetailView): { does?: DetailAct; close: boolean; shake: boolean } {
  const act = v.act;
  if (!act) return { close: false, shake: false };
  if (act.enabled) return { does: act.does, close: act.does.kind !== 'use', shake: false };
  const asks = act.does.kind === 'make' || act.does.kind === 'mend';
  return { ...(asks ? { does: act.does } : {}), close: false, shake: true };
}

/**
 * What pressing a card's second button does: taking a piece out closes the card (the piece is in the
 * bag now); throwing away asks first, with the card still open. Greyed out, it shakes.
 */
export function morePress(v: DetailView): { does?: DetailAct; close: boolean; shake: boolean } {
  const more = v.more;
  if (!more) return { close: false, shake: false };
  if (!more.enabled) return { close: false, shake: true };
  return { does: more.does, close: more.does.kind !== 'toss', shake: false };
}

/** The bag you wear changes only at home: what a carried bag and the bag you wear say about it, in the bag. */
export const BAG_AT_HOME = 'The bag you wear changes only at home. Put this one away in the chest, then wear it from the stash.';
export const KEEP_BAG_OUT = 'You always carry a bag, and it changes only at home: wear another one from the stash at the chest.';
/** A worn piece in the bag, when the bag has no slot free for it. */
export const NO_ROOM_TO_TAKE_OFF = 'Your bag is full. Make room in it first.';
/** A piece in the stash, when the bag has no slot free for it. */
export const NO_ROOM_TO_TAKE_OUT = 'Your bag is full, so it cannot be taken out.';

/** The card for what a tap is on, as the game stands; null when it is gone (it was worn, stashed, made or mended). */
export function detailView(ref: DetailRef, s: DetailState): DetailView | null {
  const { items } = s, road = s.panel === 'bag';
  switch (ref.from) {
    case 'bag': {
      const slot = s.bag[ref.slot];
      if (!slot || slot.item !== ref.item) return null;
      const def = items.get(slot.item), gear = def.kind === 'gear';
      const card = gear ? gearCard(def, slot.piece ?? { cond: 1 }, s) : itemCard(def, slot.count);
      if (!road) return { ...card, act: { label: 'Put away', enabled: true, does: { kind: 'store', slot: ref.slot } } };
      const more = { label: 'Throw away', enabled: true, tone: 'toss', does: { kind: 'toss', slot: ref.slot } } as const;
      if (!gear) return { ...card, ...(def.use ? { act: { label: useLabel(def), enabled: true, does: { kind: 'use', slot: ref.slot } } } : {}), more };
      if (def.slot === 'bag') {
        card.notes.push({ text: BAG_AT_HOME, tone: 'plain' });
        return { ...card, more };
      }
      if (low(def, slot.piece ?? { cond: 1 }, items)) card.notes.push({ text: 'Wear it, and it can be mended at the workbench at home.', tone: 'plain' });
      // What it replaces takes its slot in the bag, so there is always room.
      return { ...card, act: { label: 'Wear', ...goesTo(s, def.slot!, 'your bag'), enabled: true, does: { kind: 'don', slot: ref.slot } }, more };
    }
    case 'stash': {
      const def = items.get(ref.item);
      if (def.kind === 'sealed') {
        const have = countOf(s.stash, ref.item);
        if (!have) return null;
        // It never leaves the chest: its one button opens it (which asks first), one at a time.
        return { ...itemCard(def, have), notes: [{ text: holdsText(def, items), tone: 'plain' }], act: { label: have > 1 ? 'Open one' : 'Open', enabled: true, does: { kind: 'open', item: ref.item } } };
      }
      if (def.kind !== 'gear') {
        const have = countOf(s.stash, ref.item);
        if (!have) return null;
        const n = Math.min(have, def.stack);
        return { ...itemCard(def, have), act: { label: n > 1 ? `Take out ${n}` : 'Take it out', enabled: true, does: { kind: 'take', item: ref.item } } };
      }
      const n = ref.n ?? 0, entry = s.stash.filter(b => b.item === ref.item)[n];
      if (!entry) return null;
      const piece = entry.piece ?? { cond: 1 }, card = gearCard(def, piece, s);
      const act: NonNullable<DetailView['act']> = { label: 'Wear', ...goesTo(s, def.slot!, 'the stash'), enabled: true, does: { kind: 'wear', item: ref.item, n } };
      // The server keeps what you carry: a smaller bag has to hold all of it.
      if (def.bag && s.bag.length > def.bag) {
        act.enabled = false;
        card.notes.push({ text: `It holds ${def.bag} things, and you carry ${s.bag.length}. Put ${s.bag.length - def.bag} away first.`, tone: 'bad' });
      }
      if (low(def, piece, items)) card.notes.push({ text: 'Wear it, and it can be mended at the workbench beside the chest.', tone: 'plain' });
      // A piece travels in the bag as it is, in a slot of its own.
      const room = hasRoom(s);
      if (!room) card.notes.push({ text: NO_ROOM_TO_TAKE_OUT, tone: 'plain' });
      return { ...card, act, more: { label: 'Take it out', enabled: room, tone: 'plain', does: { kind: 'take', item: ref.item, n } } };
    }
    case 'worn': {
      const id = s.gear[ref.slot];
      if (!id) return null;
      const def = items.get(id), piece = s.worn[ref.slot] ?? { cond: 1 }, card = gearCard(def, piece, s);
      if (ref.slot === 'bag') {
        card.notes.push({ text: road ? KEEP_BAG_OUT : 'You always carry a bag, so it cannot be taken off. To change it, wear another one from the stash.', tone: 'plain' });
        return card;
      }
      if (low(def, piece, items)) card.notes.push({ text: `It can be mended at the workbench ${road ? 'at home' : 'beside the chest'}.`, tone: 'plain' });
      const then = `${PAIRS.has(ref.slot) ? 'they go' : 'it goes'} into ${road ? 'your bag' : 'the stash'}`;
      if (!road) return { ...card, act: { label: 'Take off', then, enabled: true, does: { kind: 'off', slot: ref.slot } } };
      const room = hasRoom(s);
      if (!room) card.notes.push({ text: NO_ROOM_TO_TAKE_OFF, tone: 'bad' });
      return { ...card, act: { label: 'Take off', then, enabled: room, does: { kind: 'doff', slot: ref.slot } } };
    }
    case 'recipe': {
      const recipe = items.recipes.find(r => r.id === ref.id);
      if (!recipe) return null;
      // A tool is not worn and resists nothing: its card says what it is, like anything else's.
      const def = items.get(recipe.make), count = recipe.count ?? 1, card = def.kind === 'tool' ? itemCard(def, count) : gearCard(def, undefined, s);
      const needs = needViews(recipe.needs, s);
      if (count > 1) card.count = count;
      card.costs = { title: 'It takes', needs };
      // Each tool is yours once: its button stays greyed, and pressed it still says why, in the text box (Game.craft).
      if (def.kind === 'tool' && s.tools?.includes(def.id)) {
        card.notes.push({ text: 'It is yours for good: its button is in your bag.', tone: 'plain' });
        return { ...card, act: { label: 'You have it', enabled: false, does: { kind: 'make', recipe: recipe.id } } };
      }
      short(card, needs);
      return { ...card, act: { label: count > 1 ? `Make ${count}` : 'Make', enabled: needs.every(n => n.have >= n.need), does: { kind: 'make', recipe: recipe.id } } };
    }
    case 'mend': {
      const id = s.gear[ref.slot], piece = s.worn[ref.slot];
      const def = id ? items.get(id) : undefined, cost = mendCost(def, items.mend);
      if (!def || !piece || !cost || piece.cond >= 0.995) return null;
      const card = gearCard(def, piece, s), needs = needViews(cost, s);
      card.costs = { title: 'Mending takes', needs };
      card.notes.push({ text: 'Mended, it is like new again.', tone: 'plain' });
      short(card, needs);
      return { ...card, act: { label: 'Mend', enabled: needs.every(n => n.have >= n.need), does: { kind: 'mend', slot: ref.slot } } };
    }
  }
}

/** A piece of gear (or what a recipe makes: no piece yet, so no wear to show). */
function gearCard(def: ItemDef, piece: Piece | undefined, s: DetailState): DetailView {
  const wears = wearSeconds(def, s.items.wear) !== undefined, cond = piece?.cond ?? 1;
  return {
    icon: iconFor(def), name: pieceName(def), text: def.text, stats: pieceStats(def, cond), facts: [], notes: [],
    ...(def.tier ? { tier: { id: def.tier, name: tierName(def.tier) } } : {}),
    ...(def.slot ? { slot: slotName(def.slot) } : {}),
    ...(piece ? { cond: { share: Math.min(1, Math.max(0, cond)), words: conditionText(cond, wears), low: wears && cond < WEAR_FADES, bar: wears } } : {}),
    ...(piece?.quirk ? { quirk: s.items.quirk(piece.quirk) } : {}),
  };
}

/** Anything else: what it is and how many, and the facts the bag shows. */
function itemCard(def: ItemDef, count: number): DetailView {
  return { icon: iconFor(def), name: def.name, count, text: def.text, stats: [], facts: factsOf(def), notes: [] };
}

/** "your worn cap goes into your bag", "your fingerless gloves go into the stash": what wearing a piece in `slot` puts where. Nothing, when nothing is worn there. */
function goesTo(s: DetailState, slot: Slot, where: string): { then?: string } {
  const id = s.gear[slot];
  if (!id) return {};
  return { then: `your ${lowerFirst(pieceName(s.items.get(id)))} ${PAIRS.has(slot) ? 'go' : 'goes'} into ${where}` };
}

/** A bag slot is free: a piece of gear takes one of its own. */
function hasRoom(s: DetailState): boolean {
  return s.bag.length < bagSlotsOf(s.gear, s.items.byId);
}

/** Worn down far enough to protect less, and mendable: worth saying where to mend it. */
function low(def: ItemDef, piece: Piece, items: Items): boolean {
  return piece.cond < WEAR_FADES && wearSeconds(def, items.wear) !== undefined && !!mendCost(def, items.mend);
}

function needViews(needs: readonly BagSlot[], s: DetailState): NeedView[] {
  return needs.map(n => {
    const def = s.items.get(n.item);
    return { item: n.item, name: def.name, icon: iconFor(def), have: countOf(s.stash, n.item), need: n.count };
  });
}

/** Says what the stash is short of, if anything. */
function short(card: DetailView, needs: readonly NeedView[]) {
  const missing = needs.filter(n => n.have < n.need).map(n => lowerFirst(n.name));
  if (missing.length) card.notes.push({ text: `Your stash is short of ${listWords(missing)}.`, tone: 'bad' });
}

/** "a", "a and b", "a, b and c". */
export function listWords(words: readonly string[]): string {
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0] ?? '';
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
