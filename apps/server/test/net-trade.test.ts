/**
 * Face-to-face exchange over real WebSockets: two friends in one copy of a map, at most TRADE_REACH tiles apart,
 * ask and answer, put things in, press Ready and Trade, and the server swaps both sides in one step.
 * Anything that changes either side takes both Readys back; walking apart, another map, going down out
 * of energy or going offline calls it off; nothing traded ever earns XP twice.
 */
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, TRADE_REACH, TileMap, type BagSlot, type ItemsData, type TradeView } from '@napoland/shared';
import { devAuth } from '../src/auth';
import type { PlayerRecord } from '../src/storage';
import { TRADE_ASK_MS, TRADE_ASKS_PER_MINUTE } from '../src/trade';
import { zoneKey } from '../src/world';
import { chestMaps, itemsData } from './fixtures';
import { newName, setup, waitFor, type Client, type Msg } from './helpers';

/** The fixture items with XP to earn, and a piece of anomalous gear to hand over. */
function tradeItems(): ItemsData {
  const base = itemsData();
  return {
    ...base,
    items: [
      ...base.items.map(i => (i.id === 'nail' ? { ...i, xp: 3 } : i)),
      { id: 'coat', name: 'Coat', kind: 'gear', stack: 1, slot: 'shirt', tier: 'anomalous', resist: { wind: 0.3 }, xp: 10, text: 'Pale, and warm.' },
    ],
  };
}

type Player = { c: Client; id: string; welcome: Msg<'welcome'> };

/**
 * Waits until the latest trade a client heard is as asked, and returns it. Trades come in order, so the
 * latest is where the trade stands for them; those before it are left in the inbox, and never matter.
 */
async function until(c: Client, pred: (t: TradeView) => boolean): Promise<TradeView> {
  let last: TradeView | undefined;
  await waitFor(() => {
    last = c.inbox.findLast((m): m is Msg<'trade'> => m.t === 'trade')?.trade;
    return !!last && pred(last);
  }, `a trade as asked; the last one: ${JSON.stringify(last)}`);
  return last!;
}
const over = (c: Client) => c.next('tradeOver');
/** Forgets the trades a client heard, so the next one is the one it waits for. */
const forget = (c: Client) => c.inbox.splice(0, c.inbox.length, ...c.inbox.filter(m => m.t !== 'trade'));

describe('a trade between two friends', () => {
  const { ctx, enter } = setup({ items: tradeItems(), maps: chestMaps() });

  /** Two friends in the town, a tile apart, with these bags. */
  async function friends(a: Partial<PlayerRecord> = {}, b: Partial<PlayerRecord> = {}): Promise<[Player, Player]> {
    const one = await enter({ map: 'town', x: 1, y: 3, ...a });
    const two = await enter({ map: 'town', x: 2, y: 3, ...b });
    for (const [x, y] of [[one.id, two.id], [two.id, one.id]] as const) await ctx.storage.setLink(x, y, 'friend', true);
    return [one, two];
  }

  /** `a` asks `b`, `b` says yes: both are in. */
  async function opened(a: Player, b: Player): Promise<void> {
    for (const p of [a, b]) forget(p.c);
    a.c.send({ t: 'tradeOpen', id: b.id });
    expect(await until(a.c, t => t.state === 'asking')).toMatchObject({ with: { id: b.id, name: b.welcome.name } });
    expect(await until(b.c, t => t.state === 'asked')).toMatchObject({ with: { id: a.id, name: a.welcome.name } });
    b.c.send({ t: 'tradeAnswer', id: a.id, yes: true });
    for (const p of [a, b]) expect(await until(p.c, t => t.state === 'open')).toMatchObject({ mine: [], theirs: [], ready: false, theyReady: false });
  }

  /** Both press Ready, and both hear it. */
  async function ready(a: Player, b: Player): Promise<void> {
    for (const p of [a, b]) p.c.send({ t: 'tradeReady', on: true });
    for (const p of [a, b]) await until(p.c, t => t.ready && t.theyReady);
  }

  it('asks, opens, swaps both sides in one step when both are ready and both press Trade', async () => {
    const coat: BagSlot = { item: 'coat', count: 1, piece: { cond: 0.5, quirk: 'hum', level: 2 } };
    const [a, b] = await friends({ bag: [{ item: 'nail', count: 5 }, coat] }, { bag: [{ item: 'tea', count: 2 }] });
    await opened(a, b);
    a.c.send({ t: 'tradeOffer', items: [{ slot: 0, count: 3 }, { slot: 1, count: 1 }] });
    const given = [{ item: 'nail', count: 3 }, coat];
    expect(await until(b.c, t => t.theirs.length === 2)).toMatchObject({ mine: [], theirs: given });
    expect((await until(a.c, t => t.mine.length === 2)).mine).toEqual(given);
    b.c.send({ t: 'tradeOffer', items: [{ slot: 0, count: 1 }] });
    await until(a.c, t => t.theirs.length === 1);
    a.c.send({ t: 'tradeReady', on: true });
    expect(await until(b.c, t => t.theyReady)).toMatchObject({ ready: false, theyReady: true });
    b.c.send({ t: 'tradeReady', on: true });
    await until(a.c, t => t.ready && t.theyReady);
    a.c.send({ t: 'tradeConfirm' });
    expect(await until(b.c, t => t.theyConfirmed)).toMatchObject({ confirmed: false, theyConfirmed: true });
    b.c.send({ t: 'tradeConfirm' });
    // The bag first, then how it went.
    expect((await a.c.next('bag')).bag).toEqual([{ item: 'nail', count: 2 }, { item: 'tea', count: 1 }]);
    expect(await over(a.c)).toEqual({ t: 'tradeOver', with: { id: b.id, name: b.welcome.name }, end: { kind: 'done', gave: given, got: [{ item: 'tea', count: 1 }] } });
    expect(await over(b.c)).toMatchObject({ end: { kind: 'done', gave: [{ item: 'tea', count: 1 }], got: given } });
    // The piece keeps its condition, quirk and level; both are saved, together, at once.
    const bBag = [{ item: 'tea', count: 1 }, { item: 'nail', count: 3 }, coat];
    expect(ctx.server.world.get(b.id)!.bag).toEqual(bBag);
    await waitFor(() => JSON.stringify(ctx.storage.get(b.id)?.bag) === JSON.stringify(bBag), 'the trade to be saved');
    expect(ctx.storage.get(a.id)?.bag).toEqual([{ item: 'nail', count: 2 }, { item: 'tea', count: 1 }]);
  });

  it('takes both Readys back when either side changes, and when a bag changes what it offers', async () => {
    const [a, b] = await friends({ bag: [{ item: 'nail', count: 4 }] }, { bag: [{ item: 'tea', count: 1 }] });
    await opened(a, b);
    // More than the bag holds is what the bag holds.
    a.c.send({ t: 'tradeOffer', items: [{ slot: 0, count: 99 }] });
    expect((await until(b.c, t => t.theirs.length === 1)).theirs).toEqual([{ item: 'nail', count: 4 }]);
    a.c.send({ t: 'tradeOffer', items: [{ slot: 0, count: 2 }] });
    await until(b.c, t => t.theirs[0]?.count === 2);
    await ready(a, b);
    // B offers something too: nobody is ready any more.
    b.c.send({ t: 'tradeOffer', items: [{ slot: 0, count: 1 }] });
    expect(await until(a.c, t => t.theirs.length === 1)).toMatchObject({ ready: false, theyReady: false });
    await ready(a, b);
    // A throws away 3 of the 4 nails: A's side keeps the one left, and both look again.
    a.c.send({ t: 'discard', slot: 0, count: 3 });
    expect(await until(b.c, t => t.theirs[0]?.count === 1)).toMatchObject({ theirs: [{ item: 'nail', count: 1 }], ready: false, theyReady: false });
    // Taking back Ready takes back a Trade pressed too.
    await ready(a, b);
    a.c.send({ t: 'tradeConfirm' });
    await until(b.c, t => t.theyConfirmed);
    b.c.send({ t: 'tradeReady', on: false });
    expect(await until(a.c, t => !t.theyReady)).toMatchObject({ ready: true, confirmed: false, theyConfirmed: false });
  });

  it('refuses a swap a bag has no room for, and says whose bag it is', async () => {
    const full: BagSlot[] = Array.from({ length: 8 }, () => ({ item: 'tea', count: 2 }));
    const [a, b] = await friends({ bag: [{ item: 'nail', count: 1 }] }, { bag: full });
    await opened(a, b);
    a.c.send({ t: 'tradeOffer', items: [{ slot: 0, count: 1 }] });
    await until(b.c, t => t.theirs.length === 1);
    await ready(a, b);
    a.c.send({ t: 'tradeConfirm' });
    await until(b.c, t => t.theyConfirmed);
    b.c.send({ t: 'tradeConfirm' });
    expect(await b.c.next('refused')).toEqual({ t: 'refused', action: 'tradeConfirm', reason: 'bag_full' });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'tradeConfirm', reason: 'their_bag_full' });
    // Nothing moved, and both Trades are taken back: the Readys stay.
    expect(await until(a.c, t => !t.confirmed && !t.theyConfirmed)).toMatchObject({ ready: true, theyReady: true });
    expect(ctx.server.world.get(a.id)!.bag).toEqual([{ item: 'nail', count: 1 }]);
    // Giving a slot's worth back makes room: B gives two tea, and it goes.
    b.c.send({ t: 'tradeOffer', items: [{ slot: 0, count: 2 }] });
    await until(a.c, t => t.theirs.length === 1 && !t.ready);
    await ready(a, b);
    a.c.send({ t: 'tradeConfirm' });
    await until(b.c, t => t.theyConfirmed);
    b.c.send({ t: 'tradeConfirm' });
    expect((await over(a.c)).end).toMatchObject({ kind: 'done', gave: [{ item: 'nail', count: 1 }], got: [{ item: 'tea', count: 2 }] });
  });

  it('refuses a Trade when neither side gives anything', async () => {
    const [a, b] = await friends();
    await opened(a, b);
    await ready(a, b);
    a.c.send({ t: 'tradeConfirm' });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'tradeConfirm', reason: 'nothing_to_trade' });
  });

  it('is between friends only, one trade at a time, and never with someone who turned trade requests off', async () => {
    const [a, b] = await friends();
    const stranger = await enter({ map: 'town', x: 1, y: 4 });
    a.c.send({ t: 'tradeOpen', id: stranger.id });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'tradeOpen', reason: 'not_friends' });
    a.c.send({ t: 'tradeOpen', id: a.id });
    expect((await a.c.next('refused')).reason).toBe('unknown_player');
    b.c.send({ t: 'tradeRequests', off: true });
    expect(await b.c.next('friends', m => m.tradesOff)).toMatchObject({ requestsOff: false, tradesOff: true });
    a.c.send({ t: 'tradeOpen', id: b.id });
    expect((await a.c.next('refused')).reason).toBe('trades_off');
    b.c.send({ t: 'tradeRequests', off: false });
    await b.c.next('friends', m => !m.tradesOff);
    // Kept with the player, like friend requests.
    expect((await ctx.storage.findPerson({ id: b.id }))?.tradesOff).toBe(false);
    // In a trade already: one at a time, for both.
    await opened(a, b);
    for (const [x, y] of [[stranger.id, b.id], [b.id, stranger.id]] as const) await ctx.storage.setLink(x, y, 'friend', true);
    stranger.c.send({ t: 'tradeOpen', id: b.id });
    expect((await stranger.c.next('refused')).reason).toBe('busy');
    b.c.send({ t: 'tradeOpen', id: stranger.id });
    expect((await b.c.next('refused')).reason).toBe('trading');
  });

  it('is face to face: on one map, at most TRADE_REACH tiles apart', async () => {
    const [a, b] = await friends({ x: 0, y: 0 }, { x: 8, y: 7 });
    expect(Math.hypot(8, 7)).toBeGreaterThan(TRADE_REACH);
    a.c.send({ t: 'tradeOpen', id: b.id });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'tradeOpen', reason: 'too_far' });
    const [c, d] = await friends({ map: 'house', x: 2, y: 3 }, { map: 'town', x: 7, y: 3 });
    c.c.send({ t: 'tradeOpen', id: d.id });
    expect((await c.c.next('refused')).reason).toBe('too_far');
  });

  it('opens at once when both asked each other, and is off for both when the asked says no or either calls it off', async () => {
    const [a, b] = await friends();
    a.c.send({ t: 'tradeOpen', id: b.id });
    await until(b.c, t => t.state === 'asked');
    b.c.send({ t: 'tradeOpen', id: a.id });
    for (const p of [a, b]) await until(p.c, t => t.state === 'open');
    b.c.send({ t: 'tradeCancel' });
    expect((await over(a.c)).end).toEqual({ kind: 'off', why: 'cancel', by: 'them' });
    expect((await over(b.c)).end).toEqual({ kind: 'off', why: 'cancel', by: 'you' });
    forget(b.c);
    a.c.send({ t: 'tradeOpen', id: b.id });
    await until(b.c, t => t.state === 'asked');
    b.c.send({ t: 'tradeAnswer', id: a.id, yes: false });
    expect((await over(a.c)).end).toEqual({ kind: 'off', why: 'no', by: 'them' });
    expect((await over(b.c)).end).toEqual({ kind: 'off', why: 'no', by: 'you' });
  });

  it('is off for both when they walk farther apart than TRADE_REACH', async () => {
    const [a, b] = await friends({ x: 0, y: 3 }, { x: 8, y: 7 });
    await opened(a, b);
    // Up the west edge: 9.4 tiles apart, then exactly 10 (still near enough), then 10.6.
    for (const seq of [1, 2, 3]) {
      a.c.send({ t: 'step', dir: 'up', seq });
      await a.c.next('step', m => m.seq === seq);
      if (seq < 3) expect(await b.c.settle()).not.toContainEqual(expect.objectContaining({ t: 'tradeOver' }));
    }
    expect((await over(b.c)).end).toEqual({ kind: 'off', why: 'far' });
    expect((await over(a.c)).end).toEqual({ kind: 'off', why: 'far' });
    expect(ctx.server.world.get(a.id)).toMatchObject({ x: 0, y: 0 });
  });

  it('is off for both when one of them leaves the map, or goes offline', async () => {
    const [a, b] = await friends({ x: 7, y: 3, dir: 'up' }, { x: 6, y: 3 });
    await opened(a, b);
    // Up through the door, into the house.
    a.c.send({ t: 'step', dir: 'up', seq: 1 });
    expect((await a.c.next('zone')).map.id).toBe('house');
    expect((await over(a.c)).end).toEqual({ kind: 'off', why: 'left', by: 'you' });
    expect((await over(b.c)).end).toEqual({ kind: 'off', why: 'left', by: 'them' });
    const [c, d] = await friends();
    await opened(c, d);
    d.c.ws.close();
    expect((await over(c.c)).end).toEqual({ kind: 'off', why: 'offline', by: 'them' });
  });

  it('is off when they are friends no more', async () => {
    const [a, b] = await friends();
    await opened(a, b);
    a.c.send({ t: 'block', id: b.id, on: true });
    expect((await over(b.c)).end).toEqual({ kind: 'off', why: 'unfriended' });
  });

  it('holds each player to a few asks a minute', async () => {
    const [a, b] = await friends();
    for (let i = 0; i < TRADE_ASKS_PER_MINUTE; i++) {
      forget(b.c);
      a.c.send({ t: 'tradeOpen', id: b.id });
      await until(b.c, t => t.state === 'asked');
      a.c.send({ t: 'tradeCancel' });
      await over(b.c);
    }
    a.c.send({ t: 'tradeOpen', id: b.id });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'tradeOpen', reason: 'slow_down' });
  });

  it('never lets XP be farmed by trading back and forth, and a fresh find given still earns it', async () => {
    // At the chest in the house: A stashed 5 nails long ago, and has 2 more just found.
    const at = { map: 'house', x: 3, y: 2, dir: 'up' } as const;
    const [a, b] = await friends({ ...at, stash: { items: { nail: 5 }, out: {} }, bag: [{ item: 'nail', count: 2 }] }, at);
    const swap = async (from: Player, to: Player, count: number) => {
      await opened(from, to);
      from.c.send({ t: 'tradeOffer', items: [{ slot: 0, count }] });
      await until(to.c, t => t.theirs.length === 1);
      await ready(from, to);
      from.c.send({ t: 'tradeConfirm' });
      await until(to.c, t => t.theyConfirmed);
      to.c.send({ t: 'tradeConfirm' });
      for (const p of [from, to]) expect((await over(p.c)).end.kind).toBe('done');
    };
    const stored = async (p: Player) => {
      p.c.send({ t: 'store', x: 3, y: 1 });
      return (await p.c.next('progress')).gained;
    };
    const took = async (p: Player, count: number) => {
      p.c.send({ t: 'take', x: 3, y: 1, item: 'nail', count });
      await p.c.next('chest');
    };
    await took(a, 5);
    // 7 nails, 5 of them out of A's stash: B earns only for the 2 fresh ones.
    await swap(a, b, 7);
    expect(await stored(b)).toBe(2 * 3);
    for (let round = 0; round < 2; round++) {
      await took(b, 7);
      await swap(b, a, 7);
      expect(await stored(a)).toBe(0);
      await took(a, 7);
      await swap(a, b, 7);
      expect(await stored(b)).toBe(0);
    }
    expect(ctx.server.world.get(a.id)!.stash).toEqual({ items: {}, out: {} });
    expect(ctx.server.world.get(b.id)!.stash).toEqual({ items: { nail: 7 }, out: {} });
    expect([ctx.server.world.get(a.id)!.xp ?? 0, ctx.server.world.get(b.id)!.xp]).toEqual([0, 2 * 3]);
  });
});

describe('a trade and the copies of a map', () => {
  // The house made a home of one's own, as the real one is (cabin.test.ts): everyone is alone in their copy of it.
  const maps = () => chestMaps().map(m => (m.data.id === 'house' ? new TileMap({ ...m.data, private: true, wake: { x: 2, y: 2, dir: 'down' } }) : m));
  const { ctx, enter } = setup({ items: tradeItems(), maps: maps() });

  it('is never between two copies: two friends each in their own cabin are not face to face', async () => {
    const a = await enter({ map: 'house', x: 2, y: 2 }), b = await enter({ map: 'house', x: 3, y: 2 });
    for (const [x, y] of [[a.id, b.id], [b.id, a.id]] as const) await ctx.storage.setLink(x, y, 'friend', true);
    expect([ctx.server.world.zoneOf(a.id), ctx.server.world.zoneOf(b.id)]).toEqual([zoneKey('house', a.id), zoneKey('house', b.id)]);
    a.c.send({ t: 'tradeOpen', id: b.id });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'tradeOpen', reason: 'too_far' });
    expect(b.c.inbox.some(m => m.t === 'trade')).toBe(false);
  });
});

describe('a trade and the clock', () => {
  let now = 1_000_000;
  const { ctx, enter } = setup({ items: tradeItems(), clock: () => now });

  async function friends(a: Partial<PlayerRecord>, b: Partial<PlayerRecord>): Promise<[Player, Player]> {
    const one = await enter(a), two = await enter(b);
    for (const [x, y] of [[one.id, two.id], [two.id, one.id]] as const) await ctx.storage.setLink(x, y, 'friend', true);
    return [one, two];
  }

  it('drops an ask nobody answers in time', async () => {
    const [a, b] = await friends({ map: 'town', x: 1, y: 3 }, { map: 'town', x: 2, y: 3 });
    a.c.send({ t: 'tradeOpen', id: b.id });
    await until(b.c, t => t.state === 'asked');
    now += TRADE_ASK_MS + 100;
    expect((await over(a.c)).end).toEqual({ kind: 'off', why: 'timeout', by: 'them' });
    expect((await over(b.c)).end).toEqual({ kind: 'off', why: 'timeout', by: 'you' });
  });

  it('is off for both when one of them goes down out there, and nobody asks or is asked while down', async () => {
    // Out in the woods, one step from home, with almost nothing left.
    const [a, b] = await friends({ map: 'woods', x: 4, y: 5, energy: 1 }, { map: 'woods', x: 5, y: 5 });
    a.c.send({ t: 'tradeOpen', id: b.id });
    await until(b.c, t => t.state === 'asked');
    b.c.send({ t: 'tradeAnswer', id: a.id, yes: true });
    await until(a.c, t => t.state === 'open');
    now += 10_000;
    // Down first (rescue.ts): the trade is off at once, long before any collapse.
    await a.c.next('slump');
    expect((await over(a.c)).end).toEqual({ kind: 'off', why: 'down', by: 'you' });
    expect((await over(b.c)).end).toEqual({ kind: 'off', why: 'down', by: 'them' });
    for (const [from, to] of [[b, a], [a, b]] as const) {
      from.c.send({ t: 'tradeOpen', id: to.id });
      expect(await from.c.next('refused')).toEqual({ t: 'refused', action: 'tradeOpen', reason: 'down' });
    }
  });
});

describe('a trade with sign-in', () => {
  const { ctx, open, welcomed } = setup({ items: tradeItems(), auth: devAuth() });

  it('refuses a guest, who can be nobody\'s friend yet', async () => {
    const signed = await open();
    const s = await welcomed(signed, { t: 'hello', v: PROTOCOL_VERSION, auth: `${newName().replace(' ', '')}@example.test`, name: newName() });
    const guest = await open();
    const g = await welcomed(guest, { t: 'hello', v: PROTOCOL_VERSION, name: newName() });
    expect(g.guest).toBe(true);
    guest.send({ t: 'tradeOpen', id: s.you });
    expect(await guest.next('refused')).toEqual({ t: 'refused', action: 'tradeOpen', reason: 'sign_in_first' });
    guest.send({ t: 'tradeRequests', off: true });
    expect(await guest.next('refused')).toEqual({ t: 'refused', action: 'tradeRequests', reason: 'sign_in_first' });
    // And nobody can be friends with a guest, so nobody trades with one.
    signed.send({ t: 'tradeOpen', id: g.you });
    expect((await signed.next('refused')).reason).toBe('not_friends');
    expect(ctx.server.world.size).toBe(2);
  });
});
