/**
 * Face-to-face exchange, as the trade panel shows it (hud.ts draws it): whom with, what each side
 * gives, your bag to give from, the Ready and Trade buttons, and the line that says where it stands;
 * and what the text box says about it (the question when a friend asks, how it ended, why not). Plain
 * logic with no page in it, so it is tested; the server decides everything (trade.ts there).
 *
 * Your side is kept as what it gives (the server's list: each piece of gear and live find on its own,
 * the rest by item), and sent as picks of your bag, how many of what each slot holds. A tap on a slot of
 * your bag gives all of that item you carry (a piece or a live find: that one), and a tap again takes
 * it back; − and + on a row give one fewer or one more.
 */
import { TRADE_REACH, aOf, amount, wearSeconds, type BagSlot, type ItemDef, type OfferPick, type Piece, type Refusal, type TradeEnd, type TradeView } from '@napoland/shared';
import { pieceStats, tierName } from './details';
import { iconFor } from './icons';
import { conditionText, factsOf, pieceName, slotViews, type Items, type SlotView } from './items';
import { listOf } from './said';

export { TRADE_REACH };

/** One thing a side gives, as the panel shows it. */
export interface OfferRow {
  /** Its place in its side's list (the server's order). */
  i: number;
  item: string;
  name: string;
  icon: string;
  count: number;
  /** What it is in a few words: its tier, what it resists, how worn it is, its quirk. */
  facts: string;
  /** What a tap on it says more: its words, and its quirk's. */
  text: string;
  /** Given by item, as many as its count (− and + change it), or one thing of its own (a piece, a live find). */
  stack: boolean;
  /** Your side: one fewer, and one more, can be given (more: the bag carries more of it). */
  less: boolean;
  more: boolean;
}

/** A slot of your bag in the trade panel: as the bag shows it, and whether what it holds is in your side. */
export type GiveSlot = SlotView & { given: boolean };

export interface TradePanel {
  /** "Trade with Ana". */
  title: string;
  /** Where it stands, in one line. */
  line: string;
  /** "Ana gives". */
  theirsTitle: string;
  mine: OfferRow[];
  theirs: OfferRow[];
  bag: GiveSlot[];
  /** Your Ready: pressed or not, and whether it can be pressed now (both are in). */
  ready: { on: boolean; enabled: boolean };
  /** Trade: pressed (you wait for them), or whether it can be pressed now. */
  trade: { label: string; enabled: boolean; pressed: boolean };
}

/** Whoever you trade with, as the words name them. */
const who = (t: TradeView) => t.with.name;

/** Holds one thing of its own in a bag or an offer: a piece of gear, or a live find (which fades on its own clock). */
function single(s: BagSlot, items: Items): boolean {
  return s.piece !== undefined || !!items.get(s.item).live;
}

const samePiece = (a: Piece | undefined, b: Piece | undefined) =>
  a === b || (!!a && !!b && a.cond === b.cond && (a.quirk ?? null) === (b.quirk ?? null) && (a.level ?? 0) === (b.level ?? 0));

/** How many of an item a bag carries in stacks (not pieces, not live finds). */
function carried(bag: readonly BagSlot[], item: string, items: Items): number {
  return bag.reduce((n, s) => n + (s.item === item && !single(s, items) ? s.count : 0), 0);
}

/**
 * Your side as picks of your bag, entry by entry (null: that entry is in the bag no more): a stack by
 * the first slot of its item and how many, each piece and live find by the slot that holds it.
 */
function picksBy(mine: readonly BagSlot[], bag: readonly BagSlot[], items: Items): Array<OfferPick | null> {
  const used = new Set<number>();
  return mine.map(e => {
    if (single(e, items)) {
      const at = bag.findIndex((s, j) => !used.has(j) && s.item === e.item && single(s, items) && samePiece(s.piece, e.piece));
      if (at < 0) return null;
      used.add(at);
      return { slot: at, count: 1 };
    }
    const at = bag.findIndex(s => s.item === e.item && !single(s, items));
    return at < 0 ? null : { slot: at, count: e.count };
  });
}

/** Your side as the picks the server asks for. */
export function picksOf(mine: readonly BagSlot[], bag: readonly BagSlot[], items: Items): OfferPick[] {
  return picksBy(mine, bag, items).filter((p): p is OfferPick => p !== null);
}

/** What picks of your bag give, as the server will keep them: stacks by item and never more than you carry, each single on its own. */
export function offerOf(picks: readonly OfferPick[], bag: readonly BagSlot[], items: Items): BagSlot[] {
  const out: BagSlot[] = [];
  const seen = new Set<number>();
  for (const p of picks) {
    const s = bag[p.slot];
    if (!s || seen.has(p.slot)) continue;
    seen.add(p.slot);
    if (single(s, items)) {
      out.push({ item: s.item, count: 1, ...(s.piece ? { piece: { ...s.piece } } : {}) });
      continue;
    }
    const e = out.find(x => x.item === s.item && !single(x, items));
    if (e) e.count = Math.min(carried(bag, s.item, items), e.count + p.count);
    else out.push({ item: s.item, count: Math.min(carried(bag, s.item, items), p.count) });
  }
  return out.filter(e => e.count > 0);
}

/**
 * A tap on bag slot `slot`: what you give then. Given already, it is taken back (a stack: all of that
 * item); not yet, it goes in (a stack: all of that item you carry; a piece or a live find: that one).
 */
export function tapSlot(mine: readonly BagSlot[], bag: readonly BagSlot[], slot: number, items: Items): OfferPick[] {
  const s = bag[slot], picks = picksOf(mine, bag, items);
  if (!s) return picks;
  if (single(s, items)) {
    const at = picks.findIndex(p => p.slot === slot);
    return at >= 0 ? picks.filter((_, i) => i !== at) : [...picks, { slot, count: 1 }];
  }
  const at = picks.findIndex(p => bag[p.slot]?.item === s.item && !single(bag[p.slot]!, items));
  return at >= 0 ? picks.filter((_, i) => i !== at) : [...picks, { slot, count: carried(bag, s.item, items) }];
}

/** − (by -1) or + (by 1) on row `i` of your side: one fewer or one more of a stack; − takes a single, or the last of a stack, back. */
export function stepRow(mine: readonly BagSlot[], bag: readonly BagSlot[], i: number, by: -1 | 1, items: Items): OfferPick[] {
  const picks = picksBy(mine, bag, items), p = picks[i], e = mine[i];
  if (!p || !e) return picks.filter((x): x is OfferPick => x !== null);
  if (single(e, items)) {
    if (by < 0) picks[i] = null;
  } else {
    const n = Math.min(carried(bag, e.item, items), e.count + by);
    picks[i] = n > 0 ? { ...p, count: n } : null;
  }
  return picks.filter((x): x is OfferPick => x !== null);
}

/** Which of your bag's slots hold what you give (a stack: every slot of an item you give some of). */
export function givenSlots(mine: readonly BagSlot[], bag: readonly BagSlot[], items: Items): boolean[] {
  const picked = new Set(picksOf(mine, bag, items).filter(p => single(bag[p.slot]!, items)).map(p => p.slot));
  const stacks = new Set(mine.filter(e => !single(e, items)).map(e => e.item));
  return bag.map((s, i) => (single(s, items) ? picked.has(i) : stacks.has(s.item)));
}

/** One thing a side gives, as a row: its name (with its level), how many, and what it is. */
function row(e: BagSlot, i: number, items: Items, mine: boolean, bag: readonly BagSlot[]): OfferRow {
  const def = items.get(e.item), stack = !single(e, items);
  const facts = e.piece ? gearFacts(def, e.piece, items) : factsOf(def).slice(0, 3);
  const quirk = e.piece?.quirk ? items.quirk(e.piece.quirk) : undefined;
  return {
    i, item: e.item, name: pieceName(def, e.piece?.level), icon: iconFor(def), count: e.count, facts: facts.join(' · '),
    text: quirk ? `${def.text} ${quirk.name}: ${quirk.text}` : def.text, stack,
    less: mine, more: mine && stack && e.count < carried(bag, e.item, items),
  };
}

/** A piece in a few words: its tier, what it resists and adds as worn and upgraded as it is, how worn, its quirk. */
function gearFacts(def: ItemDef, piece: Piece, items: Items): string[] {
  const quirk = piece.quirk ? `✦ ${items.quirk(piece.quirk).name}` : undefined;
  return [
    ...(def.tier && def.tier !== 'worn' ? [tierName(def.tier)] : []),
    ...pieceStats(def, piece.cond, piece.level).map(s => s.text),
    ...(wearSeconds(def, items.wear) !== undefined ? [conditionText(piece.cond)] : []),
    ...(quirk ? [quirk] : []),
  ];
}

/**
 * The trade panel from your trade (the server's), your side as you last set it (`mine`, which runs ahead
 * of the server's answer) and your bag.
 */
export function tradePanel(t: TradeView, s: { mine: readonly BagSlot[]; bag: readonly BagSlot[]; items: Items }): TradePanel {
  const { items, bag, mine } = s, open = t.state === 'open', given = givenSlots(mine, bag, items);
  const nothing = !mine.length && !t.theirs.length, both = t.ready && t.theyReady;
  return {
    title: `Trade with ${who(t)}`,
    line: tradeLine(t, nothing),
    theirsTitle: `${who(t)} gives`,
    mine: mine.map((e, i) => row(e, i, items, true, bag)),
    theirs: t.theirs.map((e, i) => row(e, i, items, false, bag)),
    bag: slotViews(bag, items).map((v, i) => ({ ...v, given: given[i] ?? false })),
    ready: { on: t.ready, enabled: open },
    trade: { label: t.confirmed ? `Waiting for ${who(t)}` : 'Trade', enabled: open && both && !t.confirmed && !nothing, pressed: t.confirmed },
  };
}

/** Where a trade stands, in one line: what to do next, or whom it waits for. */
export function tradeLine(t: TradeView, nothing = !t.mine.length && !t.theirs.length): string {
  const name = who(t);
  if (t.state === 'asking') return `Waiting for ${name} to answer. You can put things in already.`;
  if (t.confirmed) return `Waiting for ${name} to press Trade.`;
  if (t.ready && t.theyReady) {
    if (nothing) return 'Nothing to trade yet: put something in, or ask them to.';
    return t.theyConfirmed ? `${name} pressed Trade. Press Trade to swap.` : 'Both ready. Look it over, then press Trade.';
  }
  if (t.ready) return `Waiting for ${name} to be ready.`;
  if (t.theyReady) return `${name} is ready. Press Ready when you are.`;
  return 'Put in what you give, then press Ready.';
}

/** The text box, when a friend asks: "Ana wants to trade. Open the trade?" */
export function tradeQuestion(name: string): string {
  return `${name} wants to trade. Open the trade?`;
}

/** What changes hands, in a sentence: "3 resin and a raincoat +2". */
function goods(list: readonly BagSlot[], items: Items): string {
  return listOf(list.map(s => {
    const def = items.get(s.item);
    // A piece is one of its kind, a pair of gloves too: "a raincoat +2", "crew gloves".
    if (s.piece) return s.piece.level ? `${aOf(def)} +${s.piece.level}` : aOf(def);
    return amount(def, s.count);
  }));
}

/** How a trade ended, for the text box; null when there is nothing to say (you said no yourself). */
export function tradeOverText(end: TradeEnd, name: string, items: Items): string | null {
  if (end.kind === 'done') {
    if (end.gave.length && end.got.length) return `You traded with ${name}. You gave ${goods(end.gave, items)} and got ${goods(end.got, items)}.`;
    if (end.gave.length) return `You gave ${name} ${goods(end.gave, items)}.`;
    return `${name} gave you ${goods(end.got, items)}.`;
  }
  const you = end.by === 'you';
  switch (end.why) {
    case 'cancel': return you ? 'You called off the trade.' : `${name} called off the trade.`;
    case 'no': return you ? null : `${name} said no.`;
    case 'timeout': return you ? `${name} stopped waiting for your answer.` : `${name} did not answer.`;
    case 'far': return 'You are too far apart now. The trade is off.';
    case 'left': return you ? 'You left, so the trade is off.' : `${name} left. The trade is off.`;
    case 'down': return you ? 'You are down, so the trade is off.' : `${name} is down. The trade is off.`;
    case 'collapsed': return you ? 'You collapsed, so the trade is off.' : `${name} collapsed. The trade is off.`;
    case 'offline': return `${name} went offline. The trade is off.`;
    case 'unfriended': return 'The trade is off.';
  }
}

/** Why the server said no to a trade, for the text box: `name`, whoever you trade with or asked. */
export function tradeRefusal(reason: Refusal, name: string): string {
  switch (reason) {
    case 'not_friends': return `You trade with friends only. Ask ${name} to be friends first.`;
    case 'trades_off': return `${name} takes no trade requests.`;
    case 'busy': return `${name} is trading with someone else.`;
    case 'trading': return 'Finish the trade you are in first.';
    case 'too_far': return `Walk up to ${name} first: you trade face to face.`;
    case 'slow_down': return 'Wait a little before you ask again.';
    case 'sign_in_first': return 'Sign in to trade with your friends.';
    case 'unknown_player': return 'Nobody by that name.';
    case 'bag_full': return 'Your bag has no room for all of it. Make room, or ask for less.';
    case 'their_bag_full': return `${name}'s bag has no room for it. Give less, or ask for more.`;
    case 'nothing_to_trade': return 'Nothing to trade yet: put something in first.';
    // You cannot ask while you are down (Game.askTrade): it is whoever you asked.
    case 'down': return `${name} is down. Get ${name} back up first.`;
    default: return 'That did not work.';
  }
}

/** Where a friend is for a trade: near enough, on your map but too far, or not here at all (another map, offline). */
export type TradeReach = 'near' | 'far' | 'away';

export function tradeReach(me: { x: number; y: number } | undefined, them: { x: number; y: number } | undefined): TradeReach {
  if (!me || !them) return 'away';
  return Math.hypot(me.x - them.x, me.y - them.y) <= TRADE_REACH ? 'near' : 'far';
}

/** What a friend's card says when they are too far to trade with. */
export function reachText(reach: TradeReach, name: string): string {
  return reach === 'far' ? `Walk up to ${name} to trade: you trade face to face.` : `You trade face to face: meet ${name} out there first.`;
}
