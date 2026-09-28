/**
 * What the shop needs of Stripe, as plain REST calls and no SDK: a Checkout Session for one look (the
 * hosted page where the player pays, so card details never reach the game), and the checks on what its
 * webhook sends: the signature Stripe puts on every event (HMAC-SHA256 of the raw body, keyed with the
 * endpoint's signing secret), and the two events the shop acts on, a checkout paid and a charge refunded.
 * Plain functions: the network is the `fetch` the caller hands in (a fake one in tests).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ShopLook } from '@napoland/shared';

/** Stripe's API, which the shop's secret key is only ever sent to (config.ts refuses another in production). */
export const STRIPE_API = 'https://api.stripe.com';
/** Where Stripe's hosted payment pages are: the only place a real checkout may send a player. */
export const STRIPE_CHECKOUT_HOST = 'checkout.stripe.com';
/**
 * The API version the calls are made with, so what comes back keeps its shape whatever the account's own
 * is. The webhook's events come in the endpoint's version: only fields that every version has are read.
 */
export const STRIPE_VERSION = '2024-06-20';
/** A signed event older (or newer) than this, in seconds, is refused: a copy sent again later is no event (Stripe's own libraries allow as much). */
export const SIGNATURE_TOLERANCE_S = 300;
/** Stripe gets this long to answer a checkout before the player hears the shop cannot be reached. */
const CHECKOUT_TIMEOUT_MS = 10_000;
/** What the metadata of a checkout names, so an event from anything else the account sells is left alone. */
export const META_PLAYER = 'napoland_player';
export const META_LOOK = 'napoland_look';

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** The signature header's value for `payload` signed at `t` (seconds) with `secret`: what Stripe sends, for tests and the fake Stripe. */
export function signPayload(payload: string | Buffer, secret: string, t: number): string {
  return `t=${t},v1=${hmac(payload, secret, t)}`;
}

function hmac(payload: string | Buffer, secret: string, t: number): string {
  return createHmac('sha256', secret).update(`${t}.`).update(payload).digest('hex');
}

/**
 * Whether `payload` (the raw body, exactly as it came) carries a signature of Stripe's made with `secret`
 * no more than `toleranceS` from `nowS`: 'ok', or why not. The header holds a time (`t`) and one or more
 * signatures (`v1`; others, like `v0`, are Stripe's test ones and never count); any one v1 that matches
 * is enough, compared in constant time.
 */
export function verifySignature(payload: string | Buffer, header: string | undefined, secret: string, nowS: number, toleranceS = SIGNATURE_TOLERANCE_S): 'ok' | 'missing' | 'malformed' | 'stale' | 'mismatch' {
  if (!header) return 'missing';
  let t: number | undefined;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim(), value = part.slice(eq + 1).trim();
    if (key === 't' && /^\d{1,12}$/.test(value)) t = Number(value);
    else if (key === 'v1' && /^[0-9a-f]{64}$/.test(value)) v1.push(value);
  }
  if (t === undefined || !v1.length) return 'malformed';
  if (Math.abs(nowS - t) > toleranceS) return 'stale';
  const expected = Buffer.from(hmac(payload, secret, t), 'hex');
  return v1.some(sig => timingSafeEqual(Buffer.from(sig, 'hex'), expected)) ? 'ok' : 'mismatch';
}

/** What a webhook's event means to the shop: a look paid for, a payment refunded in full, or nothing it acts on. */
export type ShopEvent =
  | { kind: 'paid'; session: string; player: string; look: string; amount: number; currency: string; paymentIntent: string | null; live: boolean }
  | { kind: 'refunded'; paymentIntent: string; live: boolean }
  | { kind: 'other'; why: string };

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 255;

/**
 * The event, read from the webhook's body once its signature is checked. Only what the shop needs is read:
 * never the customer's details, which Stripe puts in the same object (an email, a name), and which the
 * game never keeps. A checkout counts once it is paid, and only one the game opened (its metadata names a
 * player and a look); a refund only once the whole charge is refunded (a partial one leaves the look).
 */
export function readEvent(body: string): ShopEvent {
  let e: unknown;
  try {
    e = JSON.parse(body);
  } catch {
    return { kind: 'other', why: 'not JSON' };
  }
  const event = (typeof e === 'object' && e !== null ? e : {}) as { type?: unknown; livemode?: unknown; data?: { object?: unknown } };
  const o = (typeof event.data?.object === 'object' && event.data.object !== null ? event.data.object : {}) as Record<string, unknown>;
  const live = event.livemode === true;
  if (event.type === 'checkout.session.completed') {
    const meta = (typeof o.metadata === 'object' && o.metadata !== null ? o.metadata : {}) as Record<string, unknown>;
    const player = meta[META_PLAYER], look = meta[META_LOOK];
    if (!str(player) || !str(look)) return { kind: 'other', why: 'not a checkout of the game' };
    if (o.mode !== 'payment' || o.payment_status !== 'paid') return { kind: 'other', why: 'not paid' };
    if (!str(o.id) || !Number.isInteger(o.amount_total) || !str(o.currency)) return { kind: 'other', why: 'not a checkout' };
    return { kind: 'paid', session: o.id, player, look, amount: o.amount_total as number, currency: o.currency.toLowerCase(), paymentIntent: str(o.payment_intent) ? o.payment_intent : null, live };
  }
  if (event.type === 'charge.refunded') {
    if (!str(o.payment_intent)) return { kind: 'other', why: 'no payment' };
    if (o.refunded !== true) return { kind: 'other', why: 'partly refunded' };
    return { kind: 'refunded', paymentIntent: o.payment_intent, live };
  }
  return { kind: 'other', why: 'another event' };
}

/** What a checkout is for: one look, at its price, for one player, and where Stripe sends them back. */
export interface CheckoutAsk {
  api: string;
  key: string;
  look: ShopLook;
  /** In minor units, in `currency`. */
  amount: number;
  currency: string;
  player: string;
  /** The game's own address: back there after paying (`?shop=paid`) or not (`?shop=cancelled`), with the look. */
  back: string;
  /** Said under the pay button on Stripe's page, as the game said it before sending the player there. */
  waiver: string;
}

/**
 * Opens a Checkout Session for one look (POST /v1/checkout/sessions) and returns its id and the address of
 * its page. Card only (so a checkout is paid when it completes), one line for the look at the catalog's
 * price, the player and the look in its metadata (and its payment's, for whoever looks it up in Stripe's
 * dashboard), nothing about who the player is. Throws when Stripe does not answer as it should.
 */
export async function createCheckout(fetch: Fetch, a: CheckoutAsk): Promise<{ id: string; url: string }> {
  const back = (how: 'paid' | 'cancelled') => `${a.back}/?shop=${how}&look=${encodeURIComponent(a.look.id)}`;
  const params: Record<string, string> = {
    mode: 'payment',
    'payment_method_types[0]': 'card',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': a.currency,
    'line_items[0][price_data][unit_amount]': String(a.amount),
    'line_items[0][price_data][product_data][name]': `${a.look.name}, a look in napoland`,
    'line_items[0][price_data][product_data][description]': a.look.text,
    client_reference_id: a.player,
    [`metadata[${META_PLAYER}]`]: a.player,
    [`metadata[${META_LOOK}]`]: a.look.id,
    [`payment_intent_data[metadata][${META_PLAYER}]`]: a.player,
    [`payment_intent_data[metadata][${META_LOOK}]`]: a.look.id,
    'custom_text[submit][message]': a.waiver,
    success_url: back('paid'),
    cancel_url: back('cancelled'),
  };
  const res = await fetch(`${a.api}/v1/checkout/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${a.key}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': STRIPE_VERSION },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(CHECKOUT_TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => null)) as { id?: unknown; url?: unknown; error?: { type?: unknown; code?: unknown } } | null;
  // Stripe's error says what went wrong (a key without the right, say), never anything secret.
  if (!res.ok) throw new Error(`Stripe answered ${res.status}${body?.error ? ` (${String(body.error.type)}${body.error.code ? `, ${String(body.error.code)}` : ''})` : ''}`);
  if (!str(body?.id) || typeof body?.url !== 'string') throw new Error('Stripe answered without a checkout');
  let url: URL;
  try {
    url = new URL(body.url);
  } catch {
    throw new Error('Stripe answered with a checkout page that is no address');
  }
  // A real checkout is on Stripe's own page; only a fake Stripe (in development, STRIPE_API) may send a player elsewhere.
  if (a.api === STRIPE_API ? url.protocol !== 'https:' || url.hostname !== STRIPE_CHECKOUT_HOST : url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Stripe answered with a checkout page that is not Stripe\'s');
  }
  return { id: body.id, url: url.href };
}
