/**
 * The fake Stripe of the shop's play-tests (tools/fake-stripe.ts), on this machine only: it opens a checkout
 * as Stripe's API does, for test keys only; its page pays or cancels and sends the player back to the game;
 * and it tells the game as Stripe would, with events the game's own checks take: signed with the endpoint's
 * secret, a checkout paid, a charge refunded.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ShopLook } from '../../packages/shared/src';
import { loadConfig } from '../../apps/server/src/config';
import { createCheckout, readEvent, verifySignature } from '../../apps/server/src/stripe';
import { PLAYTEST_SECRET, startFakeStripe, type FakeStripe } from '../fake-stripe';

// Made up, and put together rather than written out whole, so no secret scanner takes them for leaked keys.
const SECRET = ['whsec', 'ToolTestSecretForThisMachine'].join('_');
const key = (mode: 'test' | 'live') => ['sk', mode, '51FakeKeyForTheTestsOnly0000'].join('_');
const look: ShopLook = { id: 'winter-parka', kind: 'outfit', name: 'Winter parka', noun: 'the winter parka', text: 'A long parka.', prices: { eur: 299 } };

describe('the fake Stripe', () => {
  /** Stands in for the game: keeps every event sent to its webhook, with its signature. */
  const got: Array<{ path: string; body: string; signature: string | undefined }> = [];
  let game: Server;
  let fake: FakeStripe;
  const ask = (secretKey = key('test')) => ({ api: `http://127.0.0.1:${fake.port}`, key: secretKey, look, amount: 299, currency: 'eur', player: 'p1', back: 'http://localhost:5173', waiver: 'You get the look at once.' });
  const until = async (n: number) => {
    for (let i = 0; i < 200 && got.length < n; i++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(got).toHaveLength(n);
  };

  beforeAll(async () => {
    game = createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', c => (body += c));
      req.on('end', () => {
        const signature = req.headers['stripe-signature'];
        got.push({ path: req.url ?? '', body, signature: typeof signature === 'string' ? signature : undefined });
        res.end('Kept');
      });
    });
    await new Promise<void>(resolve => game.listen(0, '127.0.0.1', resolve));
    fake = await startFakeStripe({ port: 0, game: `http://127.0.0.1:${(game.address() as AddressInfo).port}`, secret: SECRET, delayMs: 0 });
  });
  afterAll(async () => {
    await fake.close();
    await new Promise(resolve => game.close(resolve));
  });

  it('opens a checkout as Stripe does, and its page says nothing is charged', async () => {
    const c = await createCheckout(fetch, ask());
    expect(c.url).toBe(`http://localhost:${fake.port}/pay/${c.id}`);
    const page = await (await fetch(`http://127.0.0.1:${fake.port}/pay/${c.id}`)).text();
    expect(page).toContain('Winter parka, a look in napoland');
    expect(page).toContain('2.99 EUR');
    expect(page).toContain('You get the look at once.');
    expect(page).toContain('nothing is charged');
    // Nothing from other sites: the page is its own.
    expect(page).not.toMatch(/(src|href)="https?:/);
  });

  it('pays, sends the player back to the game, and tells the game as Stripe would, signed; and refunds from its list', async () => {
    got.length = 0;
    const c = await createCheckout(fetch, ask());
    const paid = await fetch(`http://127.0.0.1:${fake.port}/pay/${c.id}/paid`, { method: 'POST', redirect: 'manual' });
    expect(paid.status).toBe(303);
    expect(paid.headers.get('location')).toBe('http://localhost:5173/?shop=paid&look=winter-parka');
    await until(1);
    expect(got[0]!.path).toBe('/stripe-webhook');
    expect(verifySignature(got[0]!.body, got[0]!.signature, SECRET, Math.floor(Date.now() / 1000))).toBe('ok');
    expect(readEvent(got[0]!.body)).toEqual({ kind: 'paid', session: c.id, player: 'p1', look: 'winter-parka', amount: 299, currency: 'eur', paymentIntent: expect.stringMatching(/^pi_fake_/), live: false });
    // Paid once: its page pays no more.
    expect((await fetch(`http://127.0.0.1:${fake.port}/pay/${c.id}/paid`, { method: 'POST', redirect: 'manual' })).status).toBe(404);
    expect(await (await fetch(`http://127.0.0.1:${fake.port}/`)).text()).toContain('Refund');
    const refund = await fetch(`http://127.0.0.1:${fake.port}/refund/${c.id}`, { method: 'POST', redirect: 'manual' });
    expect(refund.status).toBe(303);
    await until(2);
    expect(readEvent(got[1]!.body)).toEqual({ kind: 'refunded', paymentIntent: (readEvent(got[0]!.body) as { paymentIntent: string }).paymentIntent, live: false });
    expect(fake.sessions.get(c.id)?.status).toBe('refunded');
  });

  it('cancels, sending the player back to the game with nothing paid, and telling the game nothing', async () => {
    got.length = 0;
    const c = await createCheckout(fetch, ask());
    const cancelled = await fetch(`http://127.0.0.1:${fake.port}/pay/${c.id}/cancel`, { method: 'POST', redirect: 'manual' });
    expect(cancelled.headers.get('location')).toBe('http://localhost:5173/?shop=cancelled&look=winter-parka');
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(got).toEqual([]);
  });

  it('takes test keys only: a live key has no business on this machine', async () => {
    await expect(createCheckout(fetch, ask(key('live')))).rejects.toThrow('Stripe answered 401');
  });

  it('plays with settings the game takes: its own secret, a made-up test key, and itself as Stripe', () => {
    // The play-test's settings (docs/OPERATIONS.md): the game must open its shop with them, and point at this fake.
    const env = {
      AUTH_MODE: 'dev', SHOP_ENABLED: '1', STRIPE_SECRET_KEY: 'sk_test_playtest_on_this_machine', STRIPE_WEBHOOK_SECRET: PLAYTEST_SECRET,
      SHOP_TERMS_URL: 'http://localhost:12111/terms', SHOP_CURRENCY: 'eur', PUBLIC_URL: 'http://localhost:5173', STRIPE_API: 'http://localhost:12111',
    };
    expect(loadConfig(env, fileURLToPath(new URL('../..', import.meta.url))).shop).toMatchObject({ webhookSecret: PLAYTEST_SECRET, api: 'http://localhost:12111', live: false });
  });

  it('stands in for the terms of sale, so the Shop tab\'s link opens a page here too', async () => {
    const terms = await fetch(`http://127.0.0.1:${fake.port}/terms`);
    expect(terms.status).toBe(200);
    expect(await terms.text()).toContain('A stand-in for the owner\'s terms of sale');
  });
});
