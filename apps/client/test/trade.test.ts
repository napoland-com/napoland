import { beforeEach, describe, expect, it } from 'vitest';
import type { BagSlot, ClientMsg, ItemsData, PlayerView, TradeView } from '@napoland/shared';
import { Game } from '../src/game';
import { GIVES_NOTHING, offerHtml } from '../src/hud';
import { Items } from '../src/items';
import { Maps } from '../src/maps';
import {
  givenSlots, offerOf, picksOf, reachText, stepRow, tapSlot, tradeLine, tradeOverText, tradePanel, tradeQuestion, tradeReach, tradeRefusal, TRADE_REACH,
} from '../src/trade';
import { tinyTown, welcome } from './fixtures';

const data: ItemsData = {
  version: 4,
  items: [
    { id: 'resin', name: 'Fir resin', noun: 'resin', plural: 'resin', kind: 'resource', stack: 20, text: 'Sticky.', xp: 2, weight: 0.2 },
    { id: 'shard', name: 'Anomaly shard', noun: 'shard', kind: 'resource', stack: 5, text: 'Warm.' },
    { id: 'live', name: 'Live shard', kind: 'resource', stack: 1, text: 'Humming.', live: { xp: 40, fresh: 240, fade: 5, into: 'shard' } },
    { id: 'coat', name: 'Raincoat', kind: 'gear', stack: 1, slot: 'shirt', tier: 'sturdy', resist: { wind: 0.35 }, text: 'Yellow.' },
    { id: 'gloves', name: 'Rubber gloves', kind: 'gear', stack: 1, slot: 'gloves', tier: 'sturdy', resist: { electricity: 0.25 }, text: 'Thick.' },
  ],
  finds: [],
  wear: { sturdy: 5400 },
  quirks: [{ id: 'hum', name: 'Humming', text: 'It hums a minute before the woods grow restless.' }],
};
const items = new Items(data);
const coat = (cond: number, level?: number): BagSlot => ({ item: 'coat', count: 1, piece: { cond, ...(level ? { level } : {}), quirk: 'hum' } });
const ANA = { id: '11111111-1111-4111-8111-111111111111', name: 'Ana' };
const open = (over: Partial<TradeView> = {}): TradeView => ({
  with: ANA, state: 'open', mine: [], theirs: [], ready: false, theyReady: false, confirmed: false, theyConfirmed: false, ...over,
});

describe('your side of a trade', () => {
  // Resin in two slots, a raincoat +2, a live shard, and another raincoat just like it.
  const bag: BagSlot[] = [{ item: 'resin', count: 20 }, coat(0.5, 2), { item: 'resin', count: 5 }, { item: 'live', count: 1, age: 30 }, coat(0.5, 2)];

  it('gives all of an item you carry with one tap on a slot of it, and takes it back with another', () => {
    const all = tapSlot([], bag, 2, items);
    expect(all).toEqual([{ slot: 2, count: 25 }]);
    const mine = offerOf(all, bag, items);
    expect(mine).toEqual([{ item: 'resin', count: 25 }]);
    expect(givenSlots(mine, bag, items)).toEqual([true, false, true, false, false]);
    expect(tapSlot(mine, bag, 0, items)).toEqual([]);
  });

  it('gives a piece of gear and a live find on their own, each the very one tapped', () => {
    const mine = offerOf(tapSlot(offerOf(tapSlot([], bag, 4, items), bag, items), bag, 3, items), bag, items);
    expect(mine).toEqual([coat(0.5, 2), { item: 'live', count: 1 }]);
    // Two raincoats alike: the first one found stands for it, and the other can still go.
    expect(givenSlots(mine, bag, items)).toEqual([false, true, false, true, false]);
    expect(offerOf(tapSlot(mine, bag, 4, items), bag, items)).toEqual([coat(0.5, 2), { item: 'live', count: 1 }, coat(0.5, 2)]);
    expect(tapSlot(mine, bag, 1, items)).toEqual([{ slot: 3, count: 1 }]);
  });

  it('gives one fewer or one more with − and +, never more than you carry, and − takes the last back', () => {
    const mine: BagSlot[] = [{ item: 'resin', count: 24 }, coat(0.5, 2)];
    expect(stepRow(mine, bag, 0, 1, items)).toEqual([{ slot: 0, count: 25 }, { slot: 1, count: 1 }]);
    expect(stepRow([{ item: 'resin', count: 25 }], bag, 0, 1, items)).toEqual([{ slot: 0, count: 25 }]);
    expect(stepRow(mine, bag, 0, -1, items)).toEqual([{ slot: 0, count: 23 }, { slot: 1, count: 1 }]);
    expect(stepRow([{ item: 'resin', count: 1 }], bag, 0, -1, items)).toEqual([]);
    expect(stepRow(mine, bag, 1, -1, items)).toEqual([{ slot: 0, count: 24 }]);
    // What is no longer in the bag goes as the server keeps it: out.
    expect(picksOf([{ item: 'shard', count: 2 }, ...mine], bag, items)).toEqual([{ slot: 0, count: 24 }, { slot: 1, count: 1 }]);
  });
});

describe('the trade panel', () => {
  const bag: BagSlot[] = [{ item: 'resin', count: 6 }, coat(0.2, 3)];

  it('names whom with, each side, and your bag with what you give marked', () => {
    const t = open({ mine: [{ item: 'resin', count: 4 }], theirs: [coat(0.2, 3)] });
    const p = tradePanel(t, { mine: t.mine, bag, items });
    expect([p.title, p.theirsTitle]).toEqual(['Trade with Ana', 'Ana gives']);
    expect(p.mine).toEqual([expect.objectContaining({ name: 'Fir resin', count: 4, stack: true, less: true, more: true })]);
    // A piece says its level, what it resists as worn and upgraded as it is, how worn, and its quirk; a tap shows its words.
    expect(p.theirs[0]).toMatchObject({ name: 'Raincoat +3', stack: false, less: false, more: false, facts: 'Sturdy · Wind 32% · Worn: 20% left, and it protects less until it is mended · ✦ Humming' });
    expect(p.theirs[0]!.text).toBe('Yellow. Humming: It hums a minute before the woods grow restless.');
    expect(p.bag.map(s => s.given)).toEqual([true, false]);
    expect(p.ready).toEqual({ on: false, enabled: true });
    expect(p.trade).toEqual({ label: 'Trade', enabled: false, pressed: false });
  });

  it('says where it stands, and what to press next', () => {
    const lines = [
      open({ state: 'asking' }), open(), open({ ready: true }), open({ theyReady: true }), open({ ready: true, theyReady: true, mine: [{ item: 'resin', count: 1 }] }),
      open({ ready: true, theyReady: true, theyConfirmed: true, theirs: [{ item: 'resin', count: 1 }] }), open({ ready: true, theyReady: true, confirmed: true, mine: [{ item: 'resin', count: 1 }] }),
      open({ ready: true, theyReady: true }),
    ].map(t => tradeLine(t));
    expect(lines).toEqual([
      'Waiting for Ana to answer. You can put things in already.',
      'Put in what you give, then press Ready.',
      'Waiting for Ana to be ready.',
      'Ana is ready. Press Ready when you are.',
      'Both ready. Look it over, then press Trade.',
      'Ana pressed Trade. Press Trade to swap.',
      'Waiting for Ana to press Trade.',
      'Nothing to trade yet: put something in, or ask them to.',
    ]);
    const both = open({ ready: true, theyReady: true, mine: [{ item: 'resin', count: 1 }] });
    expect(tradePanel(both, { mine: both.mine, bag, items }).trade).toEqual({ label: 'Trade', enabled: true, pressed: false });
    const pressed = { ...both, confirmed: true };
    expect(tradePanel(pressed, { mine: pressed.mine, bag, items }).trade).toEqual({ label: 'Waiting for Ana', enabled: false, pressed: true });
    // Asking, Ready waits for them to be in.
    expect(tradePanel(open({ state: 'asking' }), { mine: [], bag, items }).ready.enabled).toBe(false);
  });

  it('draws each side as rows: yours with − and + (a piece: one to take it back), theirs with how many', () => {
    const t = open({ mine: [{ item: 'resin', count: 6 }, coat(1)], theirs: [{ item: 'resin', count: 2 }, coat(1)] });
    const p = tradePanel(t, { mine: t.mine, bag: [{ item: 'resin', count: 6 }, coat(1)], items });
    const mine = offerHtml(p.mine, 'mine'), theirs = offerHtml(p.theirs, 'theirs');
    expect(mine.match(/data-step="-1"/g)).toHaveLength(2);
    // All 6 are given: + can give no more.
    expect(mine).toMatch(/data-step="1" aria-label="One more" aria-disabled="true"/);
    expect(mine).toContain('aria-label="Take it back"');
    expect(theirs).not.toContain('data-step');
    expect(theirs).toContain('×2');
    expect(offerHtml([], 'mine')).toContain(GIVES_NOTHING.mine);
    expect(offerHtml([], 'theirs')).toContain(GIVES_NOTHING.theirs);
  });
});

describe('what the text box says about a trade', () => {
  it('asks when a friend asks, and says how it ended', () => {
    expect(tradeQuestion('Ana')).toBe('Ana wants to trade. Open the trade?');
    const done = (gave: BagSlot[], got: BagSlot[]) => tradeOverText({ kind: 'done', gave, got }, 'Ana', items);
    expect(done([{ item: 'resin', count: 3 }, coat(1, 2)], [{ item: 'shard', count: 1 }])).toBe('You traded with Ana. You gave 3 resin and a raincoat +2 and got a shard.');
    expect(done([{ item: 'resin', count: 1 }], [])).toBe('You gave Ana 1 resin.');
    expect(done([], [coat(1)])).toBe('Ana gave you a raincoat.');
    // A piece is one of its kind, a pair too: never "1 rubber gloves".
    expect(done([{ item: 'gloves', count: 1, piece: { cond: 0.5 } }], [{ item: 'gloves', count: 1, piece: { cond: 1, level: 3 } }]))
      .toBe('You traded with Ana. You gave rubber gloves and got rubber gloves +3.');
    const off = (why: Parameters<typeof tradeOverText>[0] & { kind: 'off' }) => tradeOverText(why, 'Ana', items);
    expect(off({ kind: 'off', why: 'cancel', by: 'them' })).toBe('Ana called off the trade.');
    expect(off({ kind: 'off', why: 'cancel', by: 'you' })).toBe('You called off the trade.');
    expect(off({ kind: 'off', why: 'no', by: 'them' })).toBe('Ana said no.');
    expect(off({ kind: 'off', why: 'no', by: 'you' })).toBeNull();
    expect(off({ kind: 'off', why: 'timeout', by: 'them' })).toBe('Ana did not answer.');
    expect(off({ kind: 'off', why: 'far' })).toBe('You are too far apart now. The trade is off.');
    expect(off({ kind: 'off', why: 'left', by: 'them' })).toBe('Ana left. The trade is off.');
    expect(off({ kind: 'off', why: 'collapsed', by: 'you' })).toBe('You collapsed, so the trade is off.');
    // Down out there (rescue.ts), by name.
    expect(off({ kind: 'off', why: 'down', by: 'them' })).toBe('Ana is down. The trade is off.');
    expect(off({ kind: 'off', why: 'down', by: 'you' })).toBe('You are down, so the trade is off.');
    expect(off({ kind: 'off', why: 'offline', by: 'them' })).toBe('Ana went offline. The trade is off.');
    expect(off({ kind: 'off', why: 'unfriended' })).toBe('The trade is off.');
  });

  it('says why not, naming whoever it is with', () => {
    expect(tradeRefusal('their_bag_full', 'Ana')).toBe("Ana's bag has no room for it. Give less, or ask for more.");
    expect(tradeRefusal('bag_full', 'Ana')).toBe('Your bag has no room for all of it. Make room, or ask for less.');
    expect(tradeRefusal('trades_off', 'Ana')).toBe('Ana takes no trade requests.');
    expect(tradeRefusal('too_far', 'Ana')).toBe('Walk up to Ana first: you trade face to face.');
    expect(tradeRefusal('sign_in_first', 'Ana')).toBe('Sign in to trade with your friends.');
    expect(tradeRefusal('down', 'Ana')).toBe('Ana is down. Get Ana back up first.');
  });

  it('says how near a friend has to be', () => {
    expect(tradeReach({ x: 0, y: 0 }, { x: 6, y: 8 })).toBe('near');
    expect(TRADE_REACH).toBe(10);
    expect(tradeReach({ x: 0, y: 0 }, { x: 8, y: 7 })).toBe('far');
    expect(tradeReach({ x: 0, y: 0 }, undefined)).toBe('away');
    expect(reachText('far', 'Ana')).toBe('Walk up to Ana to trade: you trade face to face.');
    expect(reachText('away', 'Ana')).toBe('You trade face to face: meet Ana out there first.');
  });
});

describe('the game and a trade', () => {
  let sent: ClientMsg[];
  let g: Game;
  const ana: PlayerView = { id: ANA.id, name: 'Ana', x: 2, y: 3, dir: 'down', color: '#fff', gear: {}, quirks: [] };
  const me: PlayerView = { ...ana, id: 'me', name: 'Aldo', x: 3, y: 3 };
  beforeEach(() => {
    sent = [];
    g = new Game(new Maps([tinyTown()]), m => sent.push(m), items);
    g.handle(welcome(tinyTown(), [me, ana], undefined, { bag: [{ item: 'resin', count: 6 }, coat(1)], items: items.version }), 0);
  });

  it('asks you in the text box when a friend asks, and answers with YES or NO', () => {
    g.handle({ t: 'trade', trade: open({ state: 'asked' }) }, 0);
    expect(g.askView()).toMatchObject({ who: 'Trade', text: 'Ana wants to trade. Open the trade?', choice: 'yes' });
    g.pressA();
    expect(sent).toEqual([{ t: 'tradeAnswer', id: ANA.id, yes: true }]);
    g.handle({ t: 'trade', trade: open({ state: 'asked' }) }, 0);
    // The same ask told again is not asked twice.
    expect(g.question).toBeNull();
  });

  it('waits for someone\'s lines to end before it asks, and drops the question when the ask is over', () => {
    g.read('Sign', ['Testbrook']);
    g.handle({ t: 'trade', trade: open({ state: 'asked' }) }, 0);
    expect(g.question).toBeNull();
    g.advanceDialog();
    g.advanceDialog();
    expect(g.askView()?.text).toBe('Ana wants to trade. Open the trade?');
    g.handle({ t: 'tradeOver', with: ANA, end: { kind: 'off', why: 'cancel', by: 'them' } }, 0);
    expect(g.question).toBeNull();
    expect(g.noteView(0)?.text).toBe('Ana called off the trade.');
  });

  it('asks a friend, runs your side ahead of the server, and takes both Readys back as you change it', () => {
    expect(g.tradeReach(ANA.id)).toBe('near');
    g.askTrade(ANA);
    expect(sent).toEqual([{ t: 'tradeOpen', id: ANA.id }]);
    g.handle({ t: 'trade', trade: open({ ready: true, theyReady: true }) }, 0);
    g.tradeTap(0);
    expect(sent.at(-1)).toEqual({ t: 'tradeOffer', items: [{ slot: 0, count: 6 }] });
    expect(g.tradeMine).toEqual([{ item: 'resin', count: 6 }]);
    expect(g.trade).toMatchObject({ ready: false, theyReady: false });
    g.tradeStep(0, -1);
    expect(sent.at(-1)).toEqual({ t: 'tradeOffer', items: [{ slot: 0, count: 5 }] });
    // The server's answer sets it again.
    g.handle({ t: 'trade', trade: open({ mine: [{ item: 'resin', count: 5 }] }) }, 0);
    g.tradePressA();
    expect(sent.at(-1)).toEqual({ t: 'tradeReady', on: true });
    g.handle({ t: 'trade', trade: open({ mine: [{ item: 'resin', count: 5 }], ready: true, theyReady: true }) }, 0);
    g.tradePressA();
    expect(sent.at(-1)).toEqual({ t: 'tradeConfirm' });
  });

  it('forgets what the server says of a trade you called off, and says how it went', () => {
    g.handle({ t: 'trade', trade: open() }, 0);
    g.tradeCancel();
    expect(sent.at(-1)).toEqual({ t: 'tradeCancel' });
    expect(g.trade).toBeNull();
    g.handle({ t: 'trade', trade: open({ theyReady: true }) }, 0);
    expect(g.trade).toBeNull();
    g.handle({ t: 'tradeOver', with: ANA, end: { kind: 'off', why: 'cancel', by: 'you' } }, 0);
    expect(g.noteView(0)?.text).toBe('You called off the trade.');
    // A new ask from the same friend is heard again.
    g.handle({ t: 'trade', trade: open({ state: 'asking' }) }, 0);
    expect(g.trade?.state).toBe('asking');
  });

  it('says a refusal in the text box, naming whom it was with', () => {
    g.askTrade(ANA);
    g.handle({ t: 'refused', action: 'tradeOpen', reason: 'busy' }, 0);
    expect(g.noteView(0)).toMatchObject({ who: 'Trade', text: 'Ana is trading with someone else.' });
  });
});
