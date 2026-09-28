/**
 * Stripe, as the shop reaches it (stripe.ts), without the network: the signature on a webhook's events
 * (valid, tampered, from another secret, too old or too new, missing), what an event means to the shop,
 * and the Checkout Session it asks for, through a fake fetch.
 */
import { describe, expect, it } from 'vitest';
import type { ShopLook } from '@napoland/shared';
import { STRIPE_API, STRIPE_VERSION, createCheckout, readEvent, signPayload, verifySignature, type Fetch } from '../src/stripe';
import { fakeKey } from './fixtures';

const SECRET = 'whsec_test_0123456789abcdefghij';
// Made up: never a real key.
const KEY = fakeKey('sk_test');
const NOW = 1_800_000_000;
const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_1' } } });

describe('a webhook\'s signature', () => {
  it('is Stripe\'s: an HMAC-SHA256 of the time and the raw body, keyed with the endpoint\'s secret', () => {
    expect(verifySignature(body, signPayload(body, SECRET, NOW), SECRET, NOW)).toBe('ok');
    expect(verifySignature(Buffer.from(body), signPayload(body, SECRET, NOW), SECRET, NOW)).toBe('ok');
    expect(signPayload(body, SECRET, NOW)).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
  });

  it('counts any one v1 signature that matches (Stripe sends several while an endpoint\'s secret is rolled), and never a v0', () => {
    const good = signPayload(body, SECRET, NOW).split(',')[1]!, other = signPayload(body, 'whsec_another_secret_000000', NOW).split(',')[1]!;
    expect(verifySignature(body, `t=${NOW},${other},${good}`, SECRET, NOW)).toBe('ok');
    expect(verifySignature(body, `t=${NOW},v0=${good.slice(3)}`, SECRET, NOW)).toBe('malformed');
  });

  it('refuses a body changed on the way, even by a byte, and a signature made with another secret', () => {
    const header = signPayload(body, SECRET, NOW);
    expect(verifySignature(body.replace('cs_test_1', 'cs_test_2'), header, SECRET, NOW)).toBe('mismatch');
    expect(verifySignature(`${body} `, header, SECRET, NOW)).toBe('mismatch');
    expect(verifySignature(body, signPayload(body, 'whsec_someone_else_000000', NOW), SECRET, NOW)).toBe('mismatch');
    // The time is signed too: the same signature with another time is no signature.
    expect(verifySignature(body, header.replace(`t=${NOW}`, `t=${NOW + 1}`), SECRET, NOW)).toBe('mismatch');
  });

  it('refuses an event signed too long ago, or too far ahead: five minutes either way', () => {
    expect(verifySignature(body, signPayload(body, SECRET, NOW - 300), SECRET, NOW)).toBe('ok');
    expect(verifySignature(body, signPayload(body, SECRET, NOW - 301), SECRET, NOW)).toBe('stale');
    expect(verifySignature(body, signPayload(body, SECRET, NOW + 301), SECRET, NOW)).toBe('stale');
    expect(verifySignature(body, signPayload(body, SECRET, NOW - 3600), SECRET, NOW, 7200)).toBe('ok');
  });

  it('refuses none at all, and one that is not a signature', () => {
    expect(verifySignature(body, undefined, SECRET, NOW)).toBe('missing');
    expect(verifySignature(body, '', SECRET, NOW)).toBe('missing');
    for (const header of ['nonsense', `t=${NOW}`, 'v1=abc', `t=soon,v1=${'0'.repeat(64)}`, `t=${NOW},v1=${'z'.repeat(64)}`, `t=${NOW},v1=${'0'.repeat(63)}`]) {
      expect([header, verifySignature(body, header, SECRET, NOW)]).toEqual([header, 'malformed']);
    }
  });
});

describe('what an event means to the shop', () => {
  const event = (type: string, object: object, livemode = false) => JSON.stringify({ id: 'evt_1', type, livemode, data: { object } });
  const session = {
    id: 'cs_test_1', object: 'checkout.session', mode: 'payment', payment_status: 'paid', amount_total: 299, currency: 'eur', payment_intent: 'pi_1',
    metadata: { napoland_player: 'p1', napoland_look: 'winter-parka' }, customer_details: { email: 'ann@example.test', name: 'Ann' },
  };

  it('is a look paid for when a checkout the game opened completes paid: never what Stripe says of the customer', () => {
    const e = readEvent(event('checkout.session.completed', session));
    expect(e).toEqual({ kind: 'paid', session: 'cs_test_1', player: 'p1', look: 'winter-parka', amount: 299, currency: 'eur', paymentIntent: 'pi_1', live: false });
    expect(JSON.stringify(e)).not.toContain('ann@example.test');
    expect(readEvent(event('checkout.session.completed', { ...session, currency: 'EUR', payment_intent: null }, true))).toMatchObject({ currency: 'eur', paymentIntent: null, live: true });
  });

  it('is nothing for a checkout the game did not open, one not paid yet, or one in another mode than a payment', () => {
    expect(readEvent(event('checkout.session.completed', { ...session, metadata: {} }))).toEqual({ kind: 'other', why: 'not a checkout of the game' });
    expect(readEvent(event('checkout.session.completed', { ...session, metadata: { napoland_player: 'p1' } })).kind).toBe('other');
    expect(readEvent(event('checkout.session.completed', { ...session, payment_status: 'unpaid' }))).toEqual({ kind: 'other', why: 'not paid' });
    expect(readEvent(event('checkout.session.completed', { ...session, mode: 'subscription' }))).toEqual({ kind: 'other', why: 'not paid' });
    expect(readEvent(event('checkout.session.completed', { ...session, amount_total: '299' }))).toEqual({ kind: 'other', why: 'not a checkout' });
  });

  it('is a look taken back when a charge is refunded in full, and nothing for a partial refund', () => {
    const charge = { id: 'ch_1', object: 'charge', payment_intent: 'pi_1', amount: 299, amount_refunded: 299, refunded: true, billing_details: { email: 'ann@example.test' } };
    expect(readEvent(event('charge.refunded', charge))).toEqual({ kind: 'refunded', paymentIntent: 'pi_1', live: false });
    expect(readEvent(event('charge.refunded', { ...charge, amount_refunded: 100, refunded: false }))).toEqual({ kind: 'other', why: 'partly refunded' });
    expect(readEvent(event('charge.refunded', { ...charge, payment_intent: null }))).toEqual({ kind: 'other', why: 'no payment' });
  });

  it('is nothing for any other event, or a body that is not one', () => {
    expect(readEvent(event('customer.created', {}))).toEqual({ kind: 'other', why: 'another event' });
    expect(readEvent('{')).toEqual({ kind: 'other', why: 'not JSON' });
    expect(readEvent('null')).toEqual({ kind: 'other', why: 'another event' });
  });
});

describe('a checkout', () => {
  const look: ShopLook = { id: 'winter-parka', kind: 'outfit', name: 'Winter parka', noun: 'the winter parka', text: 'A long parka.', prices: { eur: 299 } };
  const ask = { api: STRIPE_API, key: KEY, look, amount: 299, currency: 'eur', player: 'p1', back: 'https://play.example.test', waiver: 'You get the look at once.' };
  /** A fake Stripe that answers `answer`, keeping what it was asked. */
  const fake = (answer: { ok?: boolean; status?: number; body: unknown } | Error) => {
    const asked: Array<{ url: string; init: Parameters<Fetch>[1] }> = [];
    const fetch: Fetch = async (url, init) => {
      asked.push({ url, init });
      if (answer instanceof Error) throw answer;
      return { ok: answer.ok ?? true, status: answer.status ?? 200, json: async () => answer.body };
    };
    return { fetch, asked };
  };

  it('asks Stripe for one look at its price, card only, with the player and the look in its metadata, and comes back to the game', async () => {
    const f = fake({ body: { id: 'cs_test_9', url: 'https://checkout.stripe.com/c/pay/cs_test_9#abc' } });
    expect(await createCheckout(f.fetch, ask)).toEqual({ id: 'cs_test_9', url: 'https://checkout.stripe.com/c/pay/cs_test_9#abc' });
    expect(f.asked).toHaveLength(1);
    const { url, init } = f.asked[0]!;
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': STRIPE_VERSION });
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
      mode: 'payment',
      'payment_method_types[0]': 'card',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'eur',
      'line_items[0][price_data][unit_amount]': '299',
      'line_items[0][price_data][product_data][name]': 'Winter parka, a look in napoland',
      'line_items[0][price_data][product_data][description]': 'A long parka.',
      client_reference_id: 'p1',
      'metadata[napoland_player]': 'p1',
      'metadata[napoland_look]': 'winter-parka',
      'payment_intent_data[metadata][napoland_player]': 'p1',
      'payment_intent_data[metadata][napoland_look]': 'winter-parka',
      'custom_text[submit][message]': 'You get the look at once.',
      success_url: 'https://play.example.test/?shop=paid&look=winter-parka',
      cancel_url: 'https://play.example.test/?shop=cancelled&look=winter-parka',
    });
  });

  it('throws when Stripe says no, answers without a page, or sends the player anywhere but its own checkout', async () => {
    await expect(createCheckout(fake({ ok: false, status: 401, body: { error: { type: 'invalid_request_error', code: 'api_key_expired' } } }).fetch, ask)).rejects.toThrow('Stripe answered 401 (invalid_request_error, api_key_expired)');
    await expect(createCheckout(fake({ body: { id: 'cs_test_9' } }).fetch, ask)).rejects.toThrow('without a checkout');
    await expect(createCheckout(fake({ body: { id: 'cs_test_9', url: 'https://evil.example.test/pay' } }).fetch, ask)).rejects.toThrow('not Stripe\'s');
    await expect(createCheckout(fake({ body: { id: 'cs_test_9', url: 'http://checkout.stripe.com/c/pay' } }).fetch, ask)).rejects.toThrow('not Stripe\'s');
    await expect(createCheckout(fake({ body: { id: 'cs_test_9', url: 'javascript:alert(1)' } }).fetch, ask)).rejects.toThrow('not Stripe\'s');
    await expect(createCheckout(fake(new Error('network down')).fetch, ask)).rejects.toThrow('network down');
  });

  it('lets a fake Stripe on this machine (development) send the player to its own page', async () => {
    const f = fake({ body: { id: 'cs_test_fake', url: 'http://localhost:12111/pay/cs_test_fake' } });
    expect((await createCheckout(f.fetch, { ...ask, api: 'http://localhost:12111' })).url).toBe('http://localhost:12111/pay/cs_test_fake');
    expect(f.asked[0]!.url).toBe('http://localhost:12111/v1/checkout/sessions');
    await expect(createCheckout(fake({ body: { id: 'x', url: 'javascript:alert(1)' } }).fetch, { ...ask, api: 'http://localhost:12111' })).rejects.toThrow('not Stripe\'s');
  });
});
