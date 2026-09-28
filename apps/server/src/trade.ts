/**
 * Face-to-face exchange between two friends (DESIGN.md, Together: exchange). One asks from the other's
 * card; the other is asked in the text box. Once both are in, each puts what they give from their bag
 * into their side, presses Ready, and then Trade, and the World swaps both sides in one step. Any change
 * to either side takes both Readys (and both Trades) back.
 *
 * - Friends only, signed in on a server with sign-in (a guest is refused sign_in_first, as for everything
 *   among friends), on the same map (and copy of it) and at most TRADE_REACH tiles apart. Nobody can be
 *   asked who turned trade requests off, or who is in a trade already. One trade at a time each.
 * - Walking farther apart, leaving the map, collapsing, going offline, or being friends no more calls
 *   it off for both, and so does either of them (their panel closing). An ask waits TRADE_ASK_MS.
 * - A side only ever offers what that bag holds: when a bag changes (a find, a watcher's touch, a live
 *   find fading), its side keeps what is still there, and both Readys go.
 * - Nothing is asked first: both sides already confirm. The swap checks that each bag has room for what
 *   it gets after what it gives, and both players are saved together.
 *
 * Trades live in memory: one lasts only while both are online. Asks are held to TRADE_ASKS_PER_MINUTE.
 */
import { TRADE_REACH, offerView, sameOffer, type BagSlot, type OfferPick, type PersonView, type Refusal, type RefusedAction, type ServerMsg, type TradeOff, type TradeView } from '@napoland/shared';
import { RollingLimit } from './limits';
import type { World } from './world';

/** An ask to trade waits this long for its answer. */
export const TRADE_ASK_MS = 30_000;
/** Asks one player may make in any minute: each one puts a question in front of a friend. */
export const TRADE_ASKS_PER_MINUTE = 5;

export type TradeMsg =
  | { t: 'tradeOpen'; id: string }
  | { t: 'tradeAnswer'; id: string; yes: boolean }
  | { t: 'tradeOffer'; items: OfferPick[] }
  | { t: 'tradeReady'; on: boolean }
  | { t: 'tradeConfirm' }
  | { t: 'tradeCancel' };

export interface TradesOptions {
  world: World;
  /** ms, never going backwards (the World's game time). */
  clock: () => number;
  /** Are they friends (the links social.ts keeps)? */
  friends(a: string, b: string): Promise<boolean>;
  /** Who someone is, and whether they take trade requests; null for nobody. */
  person(id: string): Promise<{ name: string; tradesOff: boolean } | null>;
  /** A message to one player, if they are online. */
  send(id: string, msg: ServerMsg): void;
  /** Sends what the World queued (the bags after a swap), so the trade's end comes after them. */
  flush(): void;
  /** Saves these players in one step: a swap never lands in one bag only. */
  saveTogether(ids: readonly string[]): void;
}

interface Side {
  id: string;
  name: string;
  /** What this side gives, as World.offerOf made it: what the bag holds, with each piece and live find's own. */
  offer: BagSlot[];
  ready: boolean;
  confirmed: boolean;
}

interface Trade {
  /** Who asked, and who was asked. */
  a: Side;
  b: Side;
  /** Asked said yes: both are in. */
  open: boolean;
  askedAt: number;
  /** The zone (map, or copy of it) both were in when it began: leaving it calls the trade off. */
  zone: string;
}

export class Trades {
  /** Each player's trade, by id: both sides point at the same one. */
  private readonly byPlayer = new Map<string, Trade>();
  private readonly asks: RollingLimit;

  constructor(private readonly o: TradesOptions) {
    this.asks = new RollingLimit(TRADE_ASKS_PER_MINUTE, 60_000, o.clock);
  }

  /** `guest`: `me` plays as a guest, as it was when the message came in. */
  async handle(me: string, msg: TradeMsg, guest = false): Promise<void> {
    if (guest) return this.refuse(me, msg.t, 'sign_in_first');
    switch (msg.t) {
      case 'tradeOpen':
        return this.open(me, msg.id);
      case 'tradeAnswer':
        return this.answer(me, msg.id, msg.yes);
      case 'tradeOffer':
        return this.offer(me, msg.items);
      case 'tradeReady':
        return this.ready(me, msg.on);
      case 'tradeConfirm':
        return this.confirm(me);
      case 'tradeCancel': {
        const t = this.byPlayer.get(me);
        // Asked, calling it off is saying no.
        if (t) this.end(t, !t.open && t.b.id === me ? 'no' : 'cancel', me);
        return;
      }
    }
  }

  /** Every trade, looked at again: an ask not answered in time, and two players no longer face to face. */
  tick(now: number): void {
    for (const t of new Set(this.byPlayer.values())) {
      if (!t.open && now - t.askedAt >= TRADE_ASK_MS) {
        this.end(t, 'timeout', t.b.id);
        continue;
      }
      const a = this.o.world.where(t.a.id), b = this.o.world.where(t.b.id);
      // Gone offline: left() says so.
      if (!a || !b) continue;
      if (a.zone !== t.zone) this.end(t, 'left', t.a.id);
      else if (b.zone !== t.zone) this.end(t, 'left', t.b.id);
      else if (Math.hypot(a.x - b.x, a.y - b.y) > TRADE_REACH) this.end(t, 'far');
    }
  }

  /** The player is on another map now (a `zone`): they walked out of it, or collapsed and woke at home. */
  moved(id: string, reason: 'exit' | 'collapse'): void {
    const t = this.byPlayer.get(id);
    if (t) this.end(t, reason === 'collapse' ? 'collapsed' : 'left', id);
  }

  /** The player went offline (or plays somewhere else now). */
  left(id: string): void {
    const t = this.byPlayer.get(id);
    if (t) this.end(t, 'offline', id);
  }

  /** Two players are friends no more: a trade between them is off. */
  unlinked(a: string, b: string): void {
    const t = this.byPlayer.get(a);
    if (t && this.byPlayer.get(b) === t) this.end(t, 'unfriended');
  }

  /** The player's bag changed: their side keeps only what the bag still holds, and if that changed it, both look again. */
  bagChanged(id: string): void {
    const t = this.byPlayer.get(id);
    if (!t) return;
    const side = this.sideOf(t, id);
    if (!side.offer.length) return;
    const kept = this.o.world.keptOf(id, side.offer);
    if (sameOffer(kept, side.offer)) return;
    side.offer = kept;
    this.unready(t);
    this.tell(t);
  }

  private async open(me: string, them: string): Promise<void> {
    if (them === me) return this.refuse(me, 'tradeOpen', 'unknown_player');
    if (this.byPlayer.has(me)) return this.again(me, them);
    // Near first: it needs no storage, and a friend far away is the usual reason.
    if (!this.near(me, them)) return this.refuse(me, 'tradeOpen', 'too_far');
    if (!this.asks.start(me)) return this.refuse(me, 'tradeOpen', 'slow_down');
    let asked = false;
    try {
      if (!(await this.o.friends(me, them))) return this.refuse(me, 'tradeOpen', 'not_friends');
      const person = await this.o.person(them);
      if (!person) return this.refuse(me, 'tradeOpen', 'unknown_player');
      if (person.tradesOff) return this.refuse(me, 'tradeOpen', 'trades_off');
      // Storage took a while: things may have moved on meanwhile.
      if (this.byPlayer.has(me)) return this.again(me, them);
      if (this.byPlayer.has(them)) return this.refuse(me, 'tradeOpen', 'busy');
      const here = this.o.world.where(me), name = this.o.world.get(me)?.name;
      if (!here || name === undefined || !this.near(me, them)) return this.refuse(me, 'tradeOpen', 'too_far');
      const side = (id: string, who: string): Side => ({ id, name: who, offer: [], ready: false, confirmed: false });
      const t: Trade = { a: side(me, name), b: side(them, person.name), open: false, askedAt: this.o.clock(), zone: here.zone };
      this.byPlayer.set(me, t);
      this.byPlayer.set(them, t);
      asked = true;
      this.tell(t);
    } finally {
      this.asks.finish(me, asked);
    }
  }

  /**
   * `me`, in a trade already, asks `them` to trade: asked by them, asking back is a yes (as with friend
   * requests); in one with them already, it stands as it is; with anyone else, one trade at a time.
   */
  private again(me: string, them: string): void {
    const t = this.byPlayer.get(me)!;
    if (this.otherOf(t, me).id !== them) return this.refuse(me, 'tradeOpen', 'trading');
    if (!t.open && t.b.id === me) return this.answer(me, them, true);
    this.tell(t);
  }

  private answer(me: string, from: string, yes: boolean): void {
    const t = this.byPlayer.get(me);
    // Called off meanwhile, or the answer to an ask that is over: nothing to answer.
    if (!t || t.open || t.b.id !== me || t.a.id !== from) return;
    if (!yes) return this.end(t, 'no', me);
    if (!this.near(t.a.id, t.b.id)) return this.end(t, 'far');
    t.open = true;
    this.tell(t);
  }

  private offer(me: string, picks: readonly OfferPick[]): void {
    const t = this.byPlayer.get(me);
    // Over already: what it became was told.
    if (!t) return;
    const side = this.sideOf(t, me);
    // Asked, the answer comes first; asking, the side can be ready before the other is in.
    if (!t.open && side === t.b) return;
    const offer = this.o.world.offerOf(me, picks);
    if (!sameOffer(offer, side.offer)) {
      side.offer = offer;
      this.unready(t);
    }
    // Told even when nothing changed: the client shows what the server kept, not what it asked for.
    this.tell(t);
  }

  private ready(me: string, on: boolean): void {
    const t = this.byPlayer.get(me);
    if (!t?.open) return;
    const side = this.sideOf(t, me);
    if (side.ready === on) return;
    side.ready = on;
    if (!on) t.a.confirmed = t.b.confirmed = false;
    this.tell(t);
  }

  private confirm(me: string): void {
    const t = this.byPlayer.get(me);
    // Too early, or a Trade pressed just as something changed: the view it hears says where it stands.
    if (!t?.open || !t.a.ready || !t.b.ready) return t ? this.tell(t) : undefined;
    if (!t.a.offer.length && !t.b.offer.length) return this.refuse(me, 'tradeConfirm', 'nothing_to_trade');
    this.sideOf(t, me).confirmed = true;
    if (!t.a.confirmed || !t.b.confirmed) return this.tell(t);
    const r = this.o.world.swap(t.a.id, t.b.id, t.a.offer, t.b.offer, this.o.clock());
    if (!r.ok) {
      t.a.confirmed = t.b.confirmed = false;
      if (r.why === 'room') {
        // Both hear whose bag it is: the one whose bag it is can make room, the other can give less.
        this.refuse(r.who, 'tradeConfirm', 'bag_full');
        this.refuse(this.otherOf(t, r.who).id, 'tradeConfirm', 'their_bag_full');
      } else {
        // What someone offered left their bag at that very moment: each side keeps what is still there.
        for (const s of [t.a, t.b]) s.offer = this.o.world.keptOf(s.id, s.offer);
        this.unready(t);
      }
      return this.tell(t);
    }
    this.drop(t);
    this.o.saveTogether([t.a.id, t.b.id]);
    // The bags first, then how it went: the text box says it over what the bag shows now.
    this.o.flush();
    this.o.send(t.a.id, { t: 'tradeOver', with: this.person(t.b), end: { kind: 'done', gave: offerView(r.aGave), got: offerView(r.bGave) } });
    this.o.send(t.b.id, { t: 'tradeOver', with: this.person(t.a), end: { kind: 'done', gave: offerView(r.bGave), got: offerView(r.aGave) } });
  }

  /** It is off for both, and each hears why: `by` whom, if it was anyone's doing. */
  private end(t: Trade, why: TradeOff, by?: string): void {
    this.drop(t);
    for (const s of [t.a, t.b]) {
      this.o.send(s.id, { t: 'tradeOver', with: this.person(this.otherOf(t, s.id)), end: { kind: 'off', why, ...(by !== undefined ? { by: by === s.id ? 'you' : 'them' } : {}) } });
    }
  }

  private drop(t: Trade): void {
    for (const s of [t.a, t.b]) if (this.byPlayer.get(s.id) === t) this.byPlayer.delete(s.id);
  }

  /** Both sides look again: any change takes both Readys and both Trades back. */
  private unready(t: Trade): void {
    for (const s of [t.a, t.b]) s.ready = s.confirmed = false;
  }

  /** Both hear the trade as it stands, each from their side. */
  private tell(t: Trade): void {
    for (const s of [t.a, t.b]) this.o.send(s.id, { t: 'trade', trade: this.view(t, s) });
  }

  private view(t: Trade, mine: Side): TradeView {
    const theirs = this.otherOf(t, mine.id);
    return {
      with: this.person(theirs), state: t.open ? 'open' : mine === t.a ? 'asking' : 'asked', mine: offerView(mine.offer), theirs: offerView(theirs.offer),
      ready: mine.ready, theyReady: theirs.ready, confirmed: mine.confirmed, theyConfirmed: theirs.confirmed,
    };
  }

  /** Both online, on the same map (and copy of it), at most TRADE_REACH tiles apart, center to center. */
  private near(a: string, b: string): boolean {
    const x = this.o.world.where(a), y = this.o.world.where(b);
    return !!x && !!y && x.zone === y.zone && Math.hypot(x.x - y.x, x.y - y.y) <= TRADE_REACH;
  }

  private sideOf(t: Trade, id: string): Side {
    return t.a.id === id ? t.a : t.b;
  }

  private otherOf(t: Trade, id: string): Side {
    return t.a.id === id ? t.b : t.a;
  }

  private person(s: Side): PersonView {
    return { id: s.id, name: s.name };
  }

  private refuse(me: string, action: RefusedAction, reason: Refusal): void {
    this.o.send(me, { t: 'refused', action, reason });
  }
}
