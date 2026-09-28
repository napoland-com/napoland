/**
 * The shop for looks, on the server (packages/shared/src/shop.ts says what it sells and its rules). A
 * player signed in asks for a look at the chest (`checkout`); the World checks they may, and the shop asks
 * Stripe for a Checkout Session for that one look (stripe.ts), whose page the player is sent to: their
 * card never reaches the game. The look is theirs only when Stripe's webhook says the checkout is paid,
 * once for each checkout however often Stripe sends it, and no longer theirs when it says the payment was
 * refunded in full. What was bought is kept in storage (the purchases), read with the player whenever they
 * come into the game, and told to them at once if they are online.
 *
 * Closed (the owner has not set it up: config.ts), it opens no payment and its webhook is not there; what
 * was bought stays bought, and is worn as ever. Nothing about a card, an email or a key is ever logged.
 */
import { priceOf, shopLookOf, type ServerMsg, type ShopData, type ShopView } from '@napoland/shared';
import type { ShopSettings } from './config';
import { RollingLimit } from './limits';
import { log } from './log';
import type { Storage } from './storage';
import { createCheckout, readEvent, verifySignature, type Fetch, type ShopEvent } from './stripe';
import type { World } from './world';

/** Payments one player may open in any minute: each is a page at Stripe. */
export const CHECKOUTS_PER_MINUTE = 5;
/** Stripe's word about a player this recent is read again when they come into the game: their hello may have read storage just before it. */
const RECENT_MS = 60_000;
/** Warnings that anyone can cause at will (a forged webhook) are logged at most this often. */
const WARN_EVERY_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the game says under the pay button on Stripe's page, as it said it before sending the player there, with the terms of sale. */
export function stripeWaiver(terms: string): string {
  return `You get the look at once, so you give up the 14 days to change your mind. Terms of sale: ${terms}`;
}

export interface ShopOptions {
  /** How the shop is set up; none: it is closed. */
  settings: ShopSettings | undefined;
  /** What it sells (content/shop.json). */
  catalog: ShopData;
  world: World;
  storage: Storage;
  /** A message to a player online (net.ts). */
  send: (id: string, msg: ServerMsg) => void;
  /** Sends what the World queued (net.ts). */
  flush: () => void;
  /** Game time in ms, for the World and the limit on payments. */
  clock: () => number;
  /** The network, for Stripe: the real one unless a test hands in its own. */
  fetch?: Fetch;
  /** Seconds since the epoch, for the time on a webhook's signature: the wall clock unless a test sets its own. */
  nowS?: () => number;
}

/** What the webhook answers Stripe: a status (Stripe sends the event again, for up to three days, until it hears one in the 200s), and a word for its dashboard. */
export interface WebhookAnswer {
  status: number;
  body: string;
}

export class Shop {
  private readonly limit: RollingLimit;
  /** Players whose payment is being opened at Stripe right now: one at a time. */
  private readonly asking = new Set<string>();
  /** When Stripe's word last changed what each player bought (the wall clock), for RECENT_MS. */
  private readonly recent = new Map<string, number>();
  /** Each player's reads of what they bought, one after another, so an older read never lands after a newer one. */
  private readonly reads = new Map<string, Promise<void>>();
  private readonly warnSignature = throttled('a webhook was refused: its signature is not Stripe\'s');

  constructor(private readonly o: ShopOptions) {
    this.limit = new RollingLimit(CHECKOUTS_PER_MINUTE, 60_000, o.clock);
  }

  /** Open: set up, with something to sell. */
  get open(): boolean {
    return !!this.o.settings && this.o.catalog.looks.length > 0;
  }

  /** What the welcome says of the shop, to a player who bought `owned`. */
  view(owned: string[]): ShopView {
    const s = this.o.settings;
    return { version: this.o.catalog.version, owned, ...(s && this.open ? { open: { currency: s.currency, terms: s.terms } } : {}) };
  }

  /**
   * A player asks to buy `lookId` at the chest on tile x,y (they said yes to the waiver: the protocol wants
   * it). If the shop is open and the World lets them, Stripe is asked for a payment page, and they hear its
   * address (`checkout`), or why not (`refused`: `shop_down` when Stripe did not answer as it should).
   */
  async checkout(id: string, x: number, y: number, lookId: string): Promise<void> {
    const s = this.o.settings;
    const refuse = (reason: NonNullable<ReturnType<World['mayCheckout']>>) => this.o.send(id, { t: 'refused', action: 'checkout', reason });
    if (!s || !this.open) return refuse('shop_closed');
    const why = this.o.world.mayCheckout(id, x, y, lookId, this.o.clock());
    // Steps that waited in the queue were walked: everyone hears them first.
    this.o.flush();
    if (why) return refuse(why);
    const look = shopLookOf(this.o.catalog, lookId)!, amount = priceOf(look, s.currency);
    // The catalog was checked against the currency at start-up (content.ts): never, but never a checkout without a price.
    if (amount === undefined) return refuse('gone');
    if (this.asking.has(id) || !this.limit.start(id)) return refuse('slow_down');
    this.asking.add(id);
    let opened = false;
    try {
      const c = await createCheckout(this.o.fetch ?? fetch, { api: s.api, key: s.secretKey, look, amount, currency: s.currency, player: id, back: s.publicUrl, waiver: stripeWaiver(s.terms) });
      opened = true;
      log.info('checkout opened', { id, look: look.id, session: c.id });
      this.o.send(id, { t: 'checkout', look: look.id, url: c.url });
    } catch (err) {
      log.warn('a checkout could not be opened', { id, look: look.id, err: err instanceof Error ? err.message : String(err) });
      refuse('shop_down');
    } finally {
      this.asking.delete(id);
      this.limit.finish(id, opened);
    }
  }

  /**
   * Stripe's webhook (POST /stripe-webhook): the raw body and its signature header. Only an event Stripe
   * signed with this endpoint's secret, within the tolerance, counts; then a checkout paid gives its look
   * (kept once), a charge refunded in full takes it back, and anything else is heard and left alone. A
   * failure to keep it answers 500, so Stripe sends it again. Closed, the address is not there (404).
   */
  async webhook(body: Buffer, signature: string | undefined): Promise<WebhookAnswer> {
    const s = this.o.settings;
    if (!s) return { status: 404, body: 'Not found' };
    const checked = verifySignature(body, signature, s.webhookSecret, this.o.nowS?.() ?? Math.floor(Date.now() / 1000));
    if (checked !== 'ok') {
      this.warnSignature({ why: checked });
      return { status: 400, body: `Signature ${checked}` };
    }
    const event = readEvent(body.toString('utf8'));
    if (event.kind === 'other') return { status: 200, body: 'Nothing to do' };
    // A test endpoint's secret signs test events: one of the other mode here would be a mistake in the setup.
    if (event.live !== s.live) {
      log.warn('a webhook event of the other mode was left alone', { live: event.live });
      return { status: 200, body: 'Other mode' };
    }
    try {
      return event.kind === 'paid' ? await this.paid(event) : await this.refunded(event);
    } catch (err) {
      log.error('a webhook event could not be kept: Stripe sends it again', { err });
      return { status: 500, body: 'Try again' };
    }
  }

  /** A checkout paid: its look is the player's, kept once whatever Stripe sends again; they hear it if online. */
  private async paid(e: Extract<ShopEvent, { kind: 'paid' }>): Promise<WebhookAnswer> {
    if (!UUID.test(e.player)) {
      log.warn('a paid checkout names no player of the game', { session: e.session });
      return { status: 200, body: 'Not ours' };
    }
    // Kept even for a look the shop sells no more (or at another price): it was paid, and the accounts need it.
    const kept = await this.o.storage.addPurchase({
      session: e.session, player: e.player, look: e.look, amount: e.amount, currency: e.currency, paymentIntent: e.paymentIntent, status: 'paid', created: Date.now(), refunded: null,
    });
    if (!kept) return { status: 200, body: 'Kept already' };
    log.info('look bought', { id: e.player, look: e.look, session: e.session });
    if (!shopLookOf(this.o.catalog, e.look)) log.warn('a look was paid that the shop does not sell', { id: e.player, look: e.look, session: e.session });
    await this.changed(e.player);
    return { status: 200, body: 'Kept' };
  }

  /** A payment refunded in full: the look it paid for is no longer the player's, and comes off if they wear it. */
  private async refunded(e: Extract<ShopEvent, { kind: 'refunded' }>): Promise<WebhookAnswer> {
    const was = await this.o.storage.refundPurchase(e.paymentIntent, Date.now());
    // Another of the account's sales, or refunded already.
    if (!was) return { status: 200, body: 'Nothing to do' };
    log.info('look refunded', { id: was.player, look: was.look });
    if (was.player) await this.changed(was.player);
    return { status: 200, body: 'Kept' };
  }

  /**
   * A player came into the game (net.ts, after the welcome). If Stripe's word about them came in the last
   * RECENT_MS, their hello may have read storage just before it was kept: what they bought is read again.
   */
  async joined(id: string): Promise<void> {
    const at = this.recent.get(id);
    if (at === undefined || Date.now() - at > RECENT_MS) return;
    // Housekeeping for a rare race: it never stops the game, and their next sign-in reads it all anyway.
    await this.tell(id).catch((err: unknown) => log.error('what a player bought could not be read again', { id, err }));
  }

  /** Stripe's word changed what `id` bought: they hear it now if online, and on the way in within RECENT_MS. */
  private changed(id: string): Promise<void> {
    const now = Date.now();
    this.recent.set(id, now);
    for (const [k, at] of this.recent) if (now - at > RECENT_MS) this.recent.delete(k);
    return this.tell(id);
  }

  /** Reads what `id` bought and tells the World, if they are online: one read after another for each player. */
  private tell(id: string): Promise<void> {
    // A read that failed before this one says nothing about this one: it runs all the same.
    const done = (this.reads.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!this.o.world.has(id)) return;
        const owned = await this.o.storage.shopLooksOf(id);
        if (this.o.world.setShop(id, owned)) this.o.flush();
      })
      .finally(() => {
        if (this.reads.get(id) === done) this.reads.delete(id);
      });
    this.reads.set(id, done);
    return done;
  }
}

/** A warning logged at most once every WARN_EVERY_MS, with how many times it came since. */
function throttled(msg: string): (fields: Record<string, unknown>) => void {
  let at = -Infinity, times = 0;
  return fields => {
    times++;
    const now = Date.now();
    if (now - at < WARN_EVERY_MS) return;
    log.warn(msg, { times, ...fields });
    at = now;
    times = 0;
  };
}
