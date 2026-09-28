/**
 * A tap looks, an action is a second step. In the chest, at the workbench, in the bag and at a crate a
 * tap on anything opens its card: what a piece of gear is (tier, what it resists and the energy it adds
 * as worn down as it is, how worn, its quirk, the slot it goes in), what a recipe makes and takes, what
 * a mend takes, what a lockbox may hold, what something in your bag or stash is, an outfit in the
 * wardrobe, a look the shop sells, or what lies in a crate and who left it. The card's button does the one thing that can be done with it; so do A and a second tap on
 * the same thing (DoubleTap). A card may offer a second thing beside it (throwing away what you carry,
 * taking a piece out of the stash), which only its own button does.
 *
 * Plain logic with no page in it, so it can be tested: main.ts builds a card from the game
 * (detailView), hud.ts draws it and sends what its buttons do.
 */
import {
  CACHE_SIZE, RESIST_MAX, WEAR_FADES, bagSlotsOf, cacheTakes, formatPrice, mayWear, meritLookOf, meritsLeft, mendCost, nextUpgrade, outfitOf, pieceFactor, priceOf, shopLookOf, upgradable,
  upgradeFactor, wearSeconds, whyNotBuy, whyNotCheckout, xpFor, type BagSlot, type CacheItemView, type Element, type Gear, type ItemDef, type LookKind, type Piece, type PieceAt, type Slot,
  type Tier, type Worn,
} from '@napoland/shared';
import { NO_BADGE_ICON, NO_OUTFIT_ICON, NO_PATTERN_ICON, iconFor, outfitIcon } from './icons';
import { ELEMENT_WORDS, conditionText, countOf, factsOf, oddsText, pieceName, slotName, useLabel, type Items } from './items';
import { CRATE_FULL, CRATE_NO_GEAR, KEEPSAKE_STAYS, LEFT_ONE, TOOK_ONE, holdsText, leftBy, merits, noMerit, price } from './said';
import { SHOP_WHERE, YOURS, shopIcon } from './shop';
import { NO_BADGE, NO_OUTFIT, NO_PATTERN, lookIcon, outfitWords, type WardrobeState } from './wardrobe';

export { pieceName };

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

/** What a tap in the chest, at the workbench, in the bag or at a crate is on. */
export type DetailRef =
  /** A slot of your bag, in the chest's or a crate's bag row or in the bag (and what it held when tapped). */
  | { from: 'bag'; slot: number; item: string }
  /** Something in your stash: gear piece by piece (the `n`th of its item, in the stash's order). */
  | { from: 'stash'; item: string; n?: number }
  /** What you wear in a slot. */
  | { from: 'worn'; slot: Slot }
  /** A recipe at the workbench, the mending of what you wear in a slot, and upgrading a piece you wear or keep in the stash. */
  | { from: 'recipe'; id: string }
  | { from: 'mend'; slot: Slot }
  | { from: 'upgrade'; of: PieceAt }
  /** An outfit in the wardrobe (outfits.ts), by id, or NO_OUTFIT's. */
  | { from: 'outfit'; id: string }
  /** A thing lying in the crate you opened (caches.ts), by its id. */
  | { from: 'crate'; id: number }
  /** A jacket pattern or a name tag badge in the wardrobe (merits.ts), by id, or NO_PATTERN's or NO_BADGE's. */
  | { from: 'look'; id: string }
  /** A look the shop sells (shop.ts), by id: in the Shop tab, or, bought, in its kind's tab. */
  | { from: 'shop'; id: string };

/** Names what a card is about, for the double tap and to keep it open while the game changes around it. */
export function refKey(r: DetailRef): string {
  switch (r.from) {
    case 'bag': return `bag:${r.slot}:${r.item}`;
    case 'stash': return r.n === undefined ? `stash:${r.item}` : `stash:${r.item}:${r.n}`;
    case 'worn': return `worn:${r.slot}`;
    case 'recipe': return `recipe:${r.id}`;
    case 'mend': return `mend:${r.slot}`;
    case 'upgrade': return r.of.from === 'worn' ? `upgrade:worn:${r.of.slot}` : `upgrade:stash:${r.of.item}:${r.of.n}`;
    case 'outfit': return `outfit:${r.id}`;
    case 'crate': return `crate:${r.id}`;
    case 'look': return `look:${r.id}`;
    case 'shop': return `shop:${r.id}`;
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
  | { kind: 'upgrade'; of: PieceAt }
  | { kind: 'open'; item: string }
  /** Wear an outfit, or none (null); a pattern or a badge of yours, or none. */
  | { kind: 'outfit'; id: string | null }
  | { kind: 'pattern'; id: string | null }
  | { kind: 'badge'; id: string | null }
  /** Spend merits on a look: it asks first, with the card still open. */
  | { kind: 'buy'; look: string }
  /** Buy a look in the shop, on Stripe's page: it asks first (with the waiver), with the card still open. */
  | { kind: 'checkout'; look: string }
  /** At a crate: take the thing `id` out (it asks nothing: someone left it for you), or leave one of what bag slot `slot` holds (it asks first). */
  | { kind: 'crateTake'; id: number }
  | { kind: 'crateLeave'; slot: number };

/** Something a piece gives: "Wind 14%" (the element's color), "+5 energy", "Holds 12 things". */
export interface StatView {
  kind: Element | 'energy' | 'bag' | 'none' | 'wear';
  /** What it gives now. */
  text: string;
  /** What it gives when whole ("35%", "+5"), when wear has cut it down. */
  whole?: string;
  /** What it will give at the next level, on an upgrade's card ("37%"), when that is more. */
  next?: string;
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

/** What the card and the rest of the game know: your bag, what the open chest or workbench says your stash holds, what you wear, and the wardrobe. */
export interface DetailState {
  items: Items;
  bag: readonly BagSlot[];
  stash: readonly BagSlot[];
  gear: Gear;
  worn: Worn;
  /** The tools you own: a recipe for one of them cannot be made again. None known: none. */
  tools?: readonly string[];
  /** The furniture standing in your cabin (comfort.ts): each place has one, so it is not made again. None known: none. */
  furniture?: readonly string[];
  /**
   * Where the card opens: at home (in the chest or at the workbench), where gear goes on from and off
   * into the stash, in the bag, anywhere, where it goes on from and off into the bag, or at a crate, where
   * a bag slot's card leaves one of it there. Home if left out.
   */
  panel?: 'home' | 'bag' | 'crate';
  /** Your level, the outfit you wear, and whether you play as a guest; without it, no outfit has a card. */
  wardrobe?: WardrobeState;
  /** The crate you opened: what lies in it (ages in seconds as of now), what you did at it this visit, and you (to tell your own things). */
  crate?: { items: readonly CacheItemView[]; left: boolean; took: boolean; me: string };
}

/** "Sturdy". */
export function tierName(tier: Tier): string {
  return capital(tier);
}

/** Gloves, pants and shoes come in pairs: "your rubber boots go", "your raincoat goes". */
const PAIRS: ReadonlySet<Slot> = new Set(['gloves', 'pants', 'shoes']);

/**
 * What a piece resists and the energy it adds, as worn down and as upgraded as it is (a piece below a
 * quarter left protects less, and nothing at all worn out; each level adds to what it resists), with
 * what it gives whole beside what wear cut. A bag says first how many things it holds.
 */
export function pieceStats(def: ItemDef, cond = 1, level = 0): StatView[] {
  const k = pieceFactor(cond), out: StatView[] = [], resist = Object.entries(def.resist ?? {}) as Array<[Element, number]>;
  if (def.bag) out.push({ kind: 'bag', text: `Holds ${def.bag} things` });
  else if (!resist.length) out.push({ kind: 'none', text: 'Resists nothing' });
  for (const [e, v] of resist) {
    const whole = resistPct(v, level), now = pct(Math.min(RESIST_MAX, v * upgradeFactor(level)) * k);
    out.push({ kind: e, text: `${ELEMENT_WORDS[e]} ${now}%`, ...(now < whole ? { whole: `${whole}%` } : {}) });
  }
  if (def.bonus) {
    const now = Math.round(def.bonus * k);
    out.push({ kind: 'energy', text: `+${now} energy`, ...(now < def.bonus ? { whole: `+${def.bonus}` } : {}) });
  }
  return out;
}

/** A resistance of `v` at `level`, as a whole percent: never past RESIST_MAX, the most that any gear keeps out. */
function resistPct(v: number, level: number): number {
  return pct(Math.min(RESIST_MAX, v * upgradeFactor(level)));
}

/**
 * A share as a whole percent, rounded the way resistOf rounds (to a thousandth first), so a card and the
 * status panel say the same: 0.35 × 1.3 is 0.45499999... in floating point, and 46%, not 45%.
 */
const pct = (share: number) => Math.round(Math.round(share * 1000) / 10);

/**
 * What going up a level changes on a piece of `def` at `level`, whole: each thing it resists now and at
 * the next level ("Wind 35% → 37%"), and how long it lasts out there before it wears out.
 */
export function upgradeStats(def: ItemDef, level: number, wear: Items['wear']): StatView[] {
  const out: StatView[] = [];
  for (const [e, v] of Object.entries(def.resist ?? {}) as Array<[Element, number]>) {
    const now = resistPct(v, level), next = resistPct(v, level + 1);
    out.push({ kind: e, text: `${ELEMENT_WORDS[e]} ${now}%`, ...(next > now ? { next: `${next}%` } : {}) });
  }
  const lasts = wearSeconds(def, wear, level), then = wearSeconds(def, wear, level + 1);
  // To the second first: 5400 × 1.15 is 6209.999... in floating point.
  const min = (s: number) => Math.round(Math.round(s) / 60);
  if (lasts && then) out.push({ kind: 'wear', text: `Lasts ${min(lasts)} min`, next: `${min(then)} min` });
  return out;
}

/** A stat in plain words: "Wind 14% (35% when mended)", "Wind 35% → 37%". */
export function statText(s: StatView): string {
  if (s.next) return `${s.text} → ${s.next}`;
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
  // Using and buying ask first, with the card still open behind the question; bought, it offers to wear it.
  if (act.enabled) return { does: act.does, close: act.does.kind !== 'use' && act.does.kind !== 'buy' && act.does.kind !== 'checkout', shake: false };
  const asks = act.does.kind === 'make' || act.does.kind === 'mend' || act.does.kind === 'upgrade' || act.does.kind === 'crateLeave';
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
      if (s.panel === 'crate') return s.crate ? leaveCard(card, def, ref.slot, s.crate) : null;
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
      if (items.get(recipe.make).kind === 'furniture') return furnitureCard(recipe.id, items.get(recipe.make), needViews(recipe.needs, s), s);
      // Only gear is worn: a tool or a consumable (a hand warmer) has a card that says what it is, like anything else's.
      const def = items.get(recipe.make), count = recipe.count ?? 1, card = def.kind === 'gear' ? gearCard(def, undefined, s) : itemCard(def, count);
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
    case 'upgrade': {
      const at = pieceAt(ref.of, s);
      if (!at || !upgradable(at.def)) return null;
      const level = at.piece.level ?? 0, next = nextUpgrade(level, items.upgrades);
      if (!next) return null;
      // What the next level changes, whole: the piece's wear shows beside it, and mending costs the same at any level.
      const card = { ...gearCard(at.def, at.piece, s), stats: upgradeStats(at.def, level, items.wear) }, needs = needViews(next.needs, s);
      card.costs = { title: `To +${level + 1} it takes`, needs };
      card.notes.push({ text: next.chance === undefined || next.chance >= 1 ? oddsText(next) : `${oddsText(next)} If it does not take, the materials are gone, and it stays +${level}.`, tone: 'plain' });
      short(card, needs);
      return { ...card, act: { label: `Upgrade to +${level + 1}`, enabled: needs.every(n => n.have >= n.need), does: { kind: 'upgrade', of: ref.of } } };
    }
    case 'outfit':
      return s.wardrobe ? outfitCard(ref.id, s.wardrobe) : null;
    case 'crate': {
      const c = s.crate, e = c?.items.find(x => x.id === ref.id);
      if (!c || !e) return null;
      const card = itemCard(items.get(e.item), 1);
      card.notes.push({ text: `${capital(leftBy(e.name, e.owner === c.me, e.age))}.`, tone: 'plain' });
      // Taking asks nothing: it is someone's gift. One a visit.
      if (c.took) card.notes.push({ text: TOOK_ONE, tone: 'bad' });
      return { ...card, act: { label: 'Take it', enabled: !c.took, does: { kind: 'crateTake', id: e.id } } };
    }
    case 'look':
      return s.wardrobe ? lookCard(ref.id, s.wardrobe) : null;
    case 'shop':
      return s.wardrobe ? shopCard(ref.id, s.wardrobe) : null;
  }
}

/**
 * A look the shop sells: its drawing, name and line, where it goes, and its one button. Bought, it wears it
 * (or takes it off, when you wear it), whether the shop is open or not; not yet, Buy with its price, which
 * asks first with the waiver and sends you to Stripe's page, greyed out for a guest, with why. Gone for a
 * look the shop does not sell, and for one not bought while the shop is closed.
 */
function shopCard(id: string, w: WardrobeState): DetailView | null {
  const s = w.shop, look = shopLookOf(s?.catalog, id);
  if (!s || !look) return null;
  const card: DetailView = { icon: shopIcon(look), name: look.name, text: look.text, stats: [], facts: [SHOP_WHERE[look.kind]], notes: [] };
  if (s.owned.includes(look.id)) {
    card.facts.push(`${YOURS} for good`);
    const kind = look.kind, wearing = kind === 'outfit' ? w.wearing : kind === 'pattern' ? w.pattern : w.badge;
    if (wearing === look.id) {
      const then = kind === 'outfit' ? 'your gear shows again' : kind === 'pattern' ? 'your jacket as it is' : 'your name alone';
      return { ...card, notes: [{ text: 'You wear it now.', tone: 'plain' }], act: { label: 'Take off', then, enabled: true, does: { kind, id: null } } };
    }
    return { ...card, act: { label: 'Wear', enabled: true, does: { kind, id: look.id } } };
  }
  const amount = s.open ? priceOf(look, s.open.currency) : undefined;
  if (!s.open || amount === undefined) return null;
  const why = whyNotCheckout(look, s.owned, !w.guest, true);
  if (why === 'sign_in_first') card.notes.push({ text: 'Sign in to buy looks.', tone: 'plain' });
  else card.notes.push({ text: 'A look only: it changes nothing out there. You pay on Stripe\'s page.', tone: 'plain' });
  return { ...card, act: { label: 'Buy', then: formatPrice(amount, s.open.currency), enabled: !why, does: { kind: 'checkout', look: look.id } } };
}

/**
 * What the workbench makes for your cabin (comfort.ts): what it is and the comfort it adds, what it takes,
 * and that it goes straight into its place; once it stands there, its button is greyed and says so (pressed,
 * the game says why in the text box, as for a tool you have).
 */
function furnitureCard(recipe: string, def: ItemDef, needs: NeedView[], s: DetailState): DetailView {
  const card = itemCard(def, 1);
  card.costs = { title: 'It takes', needs };
  if (s.furniture?.includes(def.id)) {
    card.notes.push({ text: 'It stands in its place in your cabin.', tone: 'plain' });
    return { ...card, act: { label: 'In its place', enabled: false, does: { kind: 'make', recipe } } };
  }
  card.notes.push({ text: 'Made, it goes straight into its place in your cabin.', tone: 'plain' });
  short(card, needs);
  return { ...card, act: { label: 'Make', enabled: needs.every(n => n.have >= n.need), does: { kind: 'make', recipe } } };
}

/**
 * A slot of your bag at a crate: its one button leaves one of it for whoever comes next (the game asks
 * first), or it is greyed out and the card says why: gear stays with you, you left one this visit
 * already, or the crate is full.
 */
function leaveCard(card: DetailView, def: ItemDef, slot: number, c: NonNullable<DetailState['crate']>): DetailView {
  const act: NonNullable<DetailView['act']> = { label: 'Leave one', enabled: false, does: { kind: 'crateLeave', slot } };
  if (def.kind === 'keepsake') card.notes.push({ text: KEEPSAKE_STAYS, tone: 'bad' });
  else if (!cacheTakes(def)) card.notes.push({ text: CRATE_NO_GEAR, tone: 'bad' });
  else if (c.left) card.notes.push({ text: LEFT_ONE, tone: 'bad' });
  else if (c.items.length >= CACHE_SIZE) card.notes.push({ text: CRATE_FULL, tone: 'bad' });
  else act.enabled = true;
  return { ...card, act };
}

/**
 * A pattern's or a badge's card: its drawing, name and line, where it goes, and its one button. Yours, it
 * wears it (or takes it off, when you wear it); not yours yet, Buy, which asks first and spends a merit,
 * greyed out while there is none to spend, with why. The card for none takes off the one you wear.
 */
function lookCard(id: string, w: WardrobeState): DetailView | null {
  const base = { stats: [], facts: [] as string[], notes: [] as DetailView['notes'] };
  if (id === NO_PATTERN.id || id === NO_BADGE.id) {
    const kind: LookKind = id === NO_PATTERN.id ? 'pattern' : 'badge', none = kind === 'pattern' ? NO_PATTERN : NO_BADGE;
    const card = { ...base, icon: kind === 'pattern' ? NO_PATTERN_ICON : NO_BADGE_ICON, name: none.name, text: none.text };
    const wearing = meritLookOf(kind === 'pattern' ? w.pattern : w.badge, kind);
    if (!wearing) return { ...card, notes: [{ text: `You wear no ${kind} now.`, tone: 'plain' }] };
    return { ...card, act: { label: `Take off ${wearing.noun}`, enabled: true, does: { kind, id: null } } };
  }
  const look = meritLookOf(id);
  if (!look) return null;
  const where = look.kind === 'pattern' ? 'On your jacket, over an outfit too' : 'On your name tag, beside your name';
  const card: DetailView = { ...base, icon: lookIcon(look), name: look.name, text: look.text, facts: [where] };
  const merit = w.merits ?? { spent: 0, owned: [] }, xp = w.xp ?? xpFor(w.level);
  if ((look.kind === 'pattern' ? w.pattern : w.badge) === look.id) {
    return { ...card, notes: [{ text: 'You wear it now.', tone: 'plain' }], act: { label: 'Take off', then: look.kind === 'pattern' ? 'your jacket as it is' : 'your name alone', enabled: true, does: { kind: look.kind, id: null } } };
  }
  if (merit.owned.includes(look.id)) return { ...card, facts: [where, 'Yours for good'], act: { label: 'Wear', enabled: true, does: { kind: look.kind, id: look.id } } };
  // Not yours yet: merits buy it, signed in.
  const why = whyNotBuy(look, xp, merit, !w.guest), left = meritsLeft(xp, merit.spent);
  const say = w.guest ? 'Sign in to spend merits.' : why === 'no_merits' ? noMerit(xp) : `You have ${merits(left)} to spend.`;
  return { ...card, notes: [{ text: say, tone: 'plain' }], act: { label: 'Buy', then: price(look.cost), enabled: !why, does: { kind: 'buy', look: look.id } } };
}

/** The piece a workbench's upgrade is about: one you wear, or the `n`th of an item in the stash, with what it is. */
export function pieceAt(of: PieceAt, s: DetailState): { def: ItemDef; piece: Piece } | null {
  if (of.from === 'worn') {
    const id = s.gear[of.slot], piece = s.worn[of.slot];
    return id && piece ? { def: s.items.get(id), piece } : null;
  }
  const piece = s.stash.filter(b => b.item === of.item)[of.n]?.piece;
  return piece ? { def: s.items.get(of.item), piece } : null;
}

/**
 * An outfit's card: its drawing, its name and its line. Its button wears it, or takes it off when you
 * wear it (your gear shows again); greyed out while your level has not reached it, and the card says
 * which level does. No outfit's card takes off the one you wear. Nothing is used up, so nothing asks.
 */
function outfitCard(id: string, w: WardrobeState): DetailView | null {
  const base = { stats: [], facts: [], notes: [] as DetailView['notes'] };
  if (id === NO_OUTFIT.id) {
    const now = outfitOf(w.wearing);
    if (!w.wearing) return { ...base, icon: NO_OUTFIT_ICON, name: NO_OUTFIT.name, text: NO_OUTFIT.text, notes: [{ text: 'You wear no outfit now.', tone: 'plain' }] };
    return { ...base, icon: NO_OUTFIT_ICON, name: NO_OUTFIT.name, text: NO_OUTFIT.text, act: { label: now ? `Take off your ${outfitWords(now.name)}` : 'Take it off', enabled: true, does: { kind: 'outfit', id: null } } };
  }
  const o = outfitOf(id);
  if (!o) return null;
  const card: DetailView = { ...base, icon: outfitIcon(o.id), name: o.name, text: o.text };
  if (w.wearing === o.id) {
    return { ...card, notes: [{ text: 'You wear it now.', tone: 'plain' }], act: { label: 'Take off', then: 'your gear shows again', enabled: true, does: { kind: 'outfit', id: null } } };
  }
  const open = mayWear(o, w.level, !w.guest);
  if (w.guest) card.notes.push({ text: 'Sign in to wear it.', tone: 'plain' });
  else if (!open) card.notes.push({ text: `It opens at level ${o.level}. You are level ${w.level}.`, tone: 'plain' });
  else card.facts.push(o.level > 1 ? `Yours since level ${o.level}` : 'Yours since your first sign-in');
  return { ...card, act: { label: 'Wear', enabled: open, does: { kind: 'outfit', id: o.id } } };
}

/** A piece of gear (or what a recipe makes: no piece yet, so no wear to show). */
function gearCard(def: ItemDef, piece: Piece | undefined, s: DetailState): DetailView {
  const wears = wearSeconds(def, s.items.wear) !== undefined, cond = piece?.cond ?? 1;
  return {
    icon: iconFor(def), name: pieceName(def, piece?.level), text: def.text, stats: pieceStats(def, cond, piece?.level), facts: [], notes: [],
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
  return { then: `your ${lowerFirst(pieceName(s.items.get(id), s.worn[slot]?.level))} ${PAIRS.has(slot) ? 'go' : 'goes'} into ${where}` };
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
