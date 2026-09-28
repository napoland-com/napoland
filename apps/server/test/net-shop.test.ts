/**
 * The shop over the real HTTP + WebSocket stack, with dev sign-in and a fake Stripe (never the network):
 * a player signed in at the chest is sent to a payment page for one look; the look is theirs only once
 * Stripe's webhook, signed with the endpoint's secret, says it is paid, kept once however often it comes;
 * a refund takes it back. Guests, looks it does not sell, the chest out of reach, a missing waiver, Stripe
 * failing and too many payments at once are refused; a forged, tampered or stale event changes nothing; and
 * a shop that is not set up is closed, its webhook not there.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ClientMsg } from '@napoland/shared';
import { devAuth } from '../src/auth';
import { MemoryStorage } from '../src/storage';
import { CHECKOUTS_PER_MINUTE } from '../src/shop';
import { signPayload } from '../src/stripe';
import { chestMaps, fakeKey, itemsData, shopData, shopSettings } from './fixtures';
import { fakeStripe, keepsPurchases, paidEvent, postWebhook, refundEvent, savedPlayer, setup, shopKeptThroughARestart, waitFor } from './helpers';

const hello = (more: Partial<Extract<ClientMsg, { t: 'hello' }>>): ClientMsg => ({ t: 'hello', v: PROTOCOL_VERSION, ...more });
let people = 0;
const email = (name: string) => `${name}-${++people}@example.test`;
const SECRET = shopSettings().webhookSecret;
const buy = (look: string, more: object = {}): ClientMsg => ({ t: 'checkout', x: 3, y: 1, look, waiver: true, ...more }) as ClientMsg;

describe('the shop over WebSockets', () => {
  const stripe = fakeStripe();
  const { ctx, open, welcomed } = setup({ maps: chestMaps(), items: itemsData(), auth: devAuth(), shop: { settings: shopSettings(), catalog: shopData(), fetch: stripe.fetch } });

  /** Someone signed in, saved by the chest in the house (unless `where` says otherwise), welcomed. */
  const signedIn = async (where: object = {}) => {
    const mail = email('s');
    const saved = await savedPlayer(ctx.storage, { map: 'house', x: 3, y: 2, dir: 'up', tokenHash: null, authSub: `dev:${mail}`, ...where });
    const c = await open();
    const welcome = await welcomed(c, hello({ auth: mail }));
    expect(welcome.you).toBe(saved.id);
    await c.settle();
    return { c, welcome, id: saved.id, name: saved.name, mail };
  };
  const webhook = (body: string) => postWebhook(ctx.server.port, body, { secret: SECRET });

  it('says in the welcome that it is open, in which currency and where its terms of sale are', async () => {
    const a = await signedIn();
    expect(a.welcome.shop).toEqual({ version: 3, owned: [], open: { currency: 'eur', terms: 'https://example.test/terms' } });
  });

  it('opens a payment on Stripe\'s page for one look, for a player signed in at the chest, with nothing about who they are', async () => {
    const a = await signedIn();
    const before = stripe.asked.length;
    a.c.send(buy('winter-parka'));
    const answer = await a.c.next('checkout');
    expect(answer).toEqual({ t: 'checkout', look: 'winter-parka', url: expect.stringMatching(/^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_fake_\d+$/) });
    expect(stripe.asked).toHaveLength(before + 1);
    const { url, params, headers } = stripe.asked.at(-1)!;
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(headers.Authorization).toBe(`Bearer ${shopSettings().secretKey}`);
    expect(params).toMatchObject({
      'line_items[0][price_data][unit_amount]': '299', 'line_items[0][price_data][currency]': 'eur', 'metadata[napoland_player]': a.id, 'metadata[napoland_look]': 'winter-parka',
      success_url: 'https://play.example.test/?shop=paid&look=winter-parka', cancel_url: 'https://play.example.test/?shop=cancelled&look=winter-parka',
    });
    expect(params['custom_text[submit][message]']).toBe('You get the look at once, so you give up the 14 days to change your mind. Terms of sale: https://example.test/terms');
    // Stripe hears the player's id, never their name or their email.
    expect(JSON.stringify(params)).not.toContain(a.name);
    expect(JSON.stringify(params)).not.toContain(a.mail);
    // The look is not theirs for asking: only Stripe's word gives it.
    expect(ctx.server.world.get(a.id)?.shop ?? []).toEqual([]);
    expect(ctx.storage.storedPurchases().filter(p => p.player === a.id)).toEqual([]);
  });

  it('refuses a guest, a look it does not sell, the chest out of reach, and a checkout without the waiver', async () => {
    const guest = await savedPlayer(ctx.storage, { map: 'house', x: 3, y: 2, dir: 'up' });
    const g = await open();
    expect(await welcomed(g, hello({ token: guest.token }))).toMatchObject({ guest: true, shop: { owned: [], open: { currency: 'eur' } } });
    g.send(buy('winter-parka'));
    expect(await g.next('refused')).toEqual({ t: 'refused', action: 'checkout', reason: 'sign_in_first' });
    const a = await signedIn();
    a.c.send(buy('crown'));
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'checkout', reason: 'gone' });
    const far = await signedIn({ x: 2, y: 3 });
    far.c.send(buy('heart'));
    expect(await far.c.next('refused')).toEqual({ t: 'refused', action: 'checkout', reason: 'too_far' });
    const asked = stripe.asked.length;
    for (const bad of [{ t: 'checkout', x: 3, y: 1, look: 'heart' }, { t: 'checkout', x: 3, y: 1, look: 'heart', waiver: false }, { t: 'checkout', x: 3, y: 1, look: '', waiver: true }]) {
      const b = await signedIn();
      b.c.send(JSON.stringify(bad));
      expect(await b.c.next('error')).toMatchObject({ code: 'bad_message' });
      expect((await b.c.closed).code).toBe(1008);
    }
    expect(stripe.asked).toHaveLength(asked);
  });

  it('says the shop cannot be reached when Stripe does not answer as it should, and lets them try again', async () => {
    const a = await signedIn();
    stripe.failNext('network');
    a.c.send(buy('argyle'));
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'checkout', reason: 'shop_down' });
    stripe.failNext('error');
    a.c.send(buy('argyle'));
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'checkout', reason: 'shop_down' });
    a.c.send(buy('argyle'));
    expect(await a.c.next('checkout')).toMatchObject({ look: 'argyle' });
  });

  it(`opens at most ${CHECKOUTS_PER_MINUTE} payments a minute for one player`, async () => {
    const a = await signedIn();
    for (let i = 0; i < CHECKOUTS_PER_MINUTE; i++) {
      a.c.send(buy('heart'));
      expect(await a.c.next('checkout')).toMatchObject({ look: 'heart' });
    }
    a.c.send(buy('heart'));
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'checkout', reason: 'slow_down' });
    // Someone else is not held back by it.
    const b = await signedIn();
    b.c.send(buy('heart'));
    expect(await b.c.next('checkout')).toMatchObject({ look: 'heart' });
  });

  it('gives the look once Stripe\'s webhook says it is paid: kept once however often it comes, heard at once, and worn', async () => {
    const a = await signedIn(), session = `cs_test_${randomUUID()}`;
    const event = paidEvent({ player: a.id, look: 'winter-parka', session, pi: 'pi_parka_1' });
    expect(await webhook(event)).toEqual({ status: 200, body: 'Kept' });
    expect(await a.c.next('shop')).toEqual({ t: 'shop', owned: ['winter-parka'] });
    // Stripe sends it again until it hears it arrived: nothing more happens.
    expect(await webhook(event)).toEqual({ status: 200, body: 'Kept already' });
    expect((await a.c.settle()).filter(m => m.t === 'shop')).toEqual([]);
    const kept = ctx.storage.storedPurchases().filter(p => p.player === a.id);
    expect(kept).toEqual([{ session, player: a.id, look: 'winter-parka', amount: 299, currency: 'eur', paymentIntent: 'pi_parka_1', status: 'paid', created: expect.any(Number), refunded: null }]);
    // What Stripe says of its customer is never kept.
    expect(JSON.stringify(ctx.storage.storedPurchases())).not.toContain('buyer@example.test');
    a.c.send({ t: 'outfit', x: 3, y: 1, outfit: 'winter-parka' });
    expect(await a.c.next('outfit')).toEqual({ t: 'outfit', id: a.id, outfit: 'winter-parka' });
    // Bought: a second payment for it is refused.
    a.c.send(buy('winter-parka'));
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'checkout', reason: 'owned' });
  });

  it('never gives a look that is not bought: wearing one is refused', async () => {
    const a = await signedIn();
    a.c.send({ t: 'outfit', x: 3, y: 1, outfit: 'winter-parka' });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'outfit', reason: 'not_owned' });
    a.c.send({ t: 'pattern', x: 3, y: 1, pattern: 'argyle' });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'pattern', reason: 'not_owned' });
    // Nor one of the other kind: a badge is no pattern.
    a.c.send({ t: 'pattern', x: 3, y: 1, pattern: 'heart' });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'pattern', reason: 'gone' });
  });

  it('refuses an event without Stripe\'s signature: changed on the way, signed with another secret, too old, or none', async () => {
    const a = await signedIn();
    const event = paidEvent({ player: a.id, look: 'heart' });
    const port = ctx.server.port;
    expect(await postWebhook(port, event.replace('"heart"', '"argyle"'), { signature: signPayload(event, SECRET, Math.floor(Date.now() / 1000)) })).toEqual({ status: 400, body: 'Signature mismatch' });
    expect(await postWebhook(port, event, { secret: fakeKey('whsec', 'SomeoneElsesSecret000000') })).toEqual({ status: 400, body: 'Signature mismatch' });
    expect(await postWebhook(port, event, { secret: SECRET, t: Math.floor(Date.now() / 1000) - 600 })).toEqual({ status: 400, body: 'Signature stale' });
    expect(await postWebhook(port, event, {})).toEqual({ status: 400, body: 'Signature missing' });
    expect(await postWebhook(port, event, { signature: 'whatever' })).toEqual({ status: 400, body: 'Signature malformed' });
    expect(ctx.storage.storedPurchases().filter(p => p.player === a.id)).toEqual([]);
    expect((await a.c.settle()).filter(m => m.t === 'shop')).toEqual([]);
  });

  it('leaves alone an event that is not a paid checkout of the game\'s, a partial refund, and one of the other mode', async () => {
    const a = await signedIn();
    for (const event of [
      paidEvent({ player: a.id, look: 'heart', ours: false }),
      paidEvent({ player: a.id, look: 'heart', paid: false }),
      paidEvent({ player: a.id, look: 'heart', live: true }),
      paidEvent({ player: 'not-a-player', look: 'heart' }),
      refundEvent({ pi: 'pi_nobody', full: true }),
      JSON.stringify({ id: 'evt_x', type: 'customer.created', livemode: false, data: { object: {} } }),
    ]) {
      expect((await webhook(event)).status, event.slice(0, 80)).toBe(200);
    }
    expect(ctx.storage.storedPurchases().filter(p => p.player === a.id)).toEqual([]);
    expect((await a.c.settle()).filter(m => m.t === 'shop')).toEqual([]);
  });

  it('takes a look back when its payment is refunded in full: it comes off, for everyone who sees them', async () => {
    const watcher = await signedIn({ x: 1, y: 3 });
    const a = await signedIn();
    await watcher.c.next('join', m => m.player.id === a.id);
    await webhook(paidEvent({ player: a.id, look: 'winter-parka', pi: 'pi_refund_parka' }));
    await webhook(paidEvent({ player: a.id, look: 'heart', pi: 'pi_refund_heart' }));
    await waitFor(() => ctx.server.world.get(a.id)?.shop?.length === 2, 'both looks to be bought');
    a.c.send({ t: 'outfit', x: 3, y: 1, outfit: 'winter-parka' });
    a.c.send({ t: 'badge', x: 3, y: 1, badge: 'heart' });
    expect(await watcher.c.next('outfit', m => m.id === a.id)).toEqual({ t: 'outfit', id: a.id, outfit: 'winter-parka' });
    expect(await watcher.c.next('badge', m => m.id === a.id)).toEqual({ t: 'badge', id: a.id, badge: 'heart' });
    await a.c.settle();
    // Partly refunded: it stays theirs.
    expect(await webhook(refundEvent({ pi: 'pi_refund_parka', full: false }))).toEqual({ status: 200, body: 'Nothing to do' });
    expect(await webhook(refundEvent({ pi: 'pi_refund_parka' }))).toEqual({ status: 200, body: 'Kept' });
    expect(await a.c.next('shop')).toEqual({ t: 'shop', owned: ['heart'] });
    expect(await watcher.c.next('outfit', m => m.id === a.id)).toEqual({ t: 'outfit', id: a.id, outfit: null });
    expect(ctx.server.world.get(a.id)).toMatchObject({ outfit: null, badge: 'heart', shop: ['heart'] });
    await waitFor(() => ctx.storage.get(a.id)?.outfit === undefined, 'no outfit to be saved');
    expect(ctx.storage.storedPurchases().filter(p => p.player === a.id).map(p => [p.look, p.status, p.refunded === null])).toEqual([['winter-parka', 'refunded', false], ['heart', 'paid', true]]);
    // Refunded again (Stripe sends it again): nothing more.
    expect(await webhook(refundEvent({ pi: 'pi_refund_parka' }))).toEqual({ status: 200, body: 'Nothing to do' });
  });

  it('gives a look paid for while its buyer was away the next time they come in', async () => {
    const mail = email('away');
    const saved = await savedPlayer(ctx.storage, { map: 'house', x: 3, y: 2, dir: 'up', tokenHash: null, authSub: `dev:${mail}` });
    expect(await webhook(paidEvent({ player: saved.id, look: 'argyle' }))).toEqual({ status: 200, body: 'Kept' });
    const c = await open();
    expect((await welcomed(c, hello({ auth: mail }))).shop.owned).toEqual(['argyle']);
    c.send({ t: 'pattern', x: 3, y: 1, pattern: 'argyle' });
    expect(await c.next('pattern')).toEqual({ t: 'pattern', id: saved.id, pattern: 'argyle' });
  });

  it('answers only a POST at its webhook, and nothing too big to be one of Stripe\'s events', async () => {
    const port = ctx.server.port;
    expect((await postWebhook(port, '', {}, { method: 'GET' })).status).toBe(405);
    expect((await postWebhook(port, 'x'.repeat(300 * 1024), { secret: SECRET })).status).toBe(413);
  });
});

describe('the shop, closed', () => {
  // Not set up: what it sells is still known, so whoever bought a look while it was open still wears it.
  const { ctx, open, welcomed } = setup({ maps: chestMaps(), items: itemsData(), auth: devAuth(), shop: { settings: undefined, catalog: shopData(), fetch: fakeStripe().fetch } });

  it('says so in the welcome, opens no payment and has no webhook', async () => {
    const mail = email('c');
    await savedPlayer(ctx.storage, { map: 'house', x: 3, y: 2, dir: 'up', tokenHash: null, authSub: `dev:${mail}` });
    const c = await open();
    expect((await welcomed(c, hello({ auth: mail }))).shop).toEqual({ version: 3, owned: [] });
    c.send(buy('winter-parka'));
    expect(await c.next('refused')).toEqual({ t: 'refused', action: 'checkout', reason: 'shop_closed' });
    const signed = { secret: SECRET };
    expect(await postWebhook(ctx.server.port, paidEvent({ player: randomUUID(), look: 'heart' }), signed)).toEqual({ status: 404, body: 'Not found' });
    expect((await postWebhook(ctx.server.port, '', {}, { method: 'GET' })).status).toBe(404);
  });

  it('still dresses whoever bought a look while it was open', async () => {
    const mail = email('kept');
    const saved = await savedPlayer(ctx.storage, { map: 'house', x: 3, y: 2, dir: 'up', tokenHash: null, authSub: `dev:${mail}`, badge: 'heart' });
    await ctx.storage.addPurchase({ session: `cs_test_${randomUUID()}`, player: saved.id, look: 'heart', amount: 99, currency: 'eur', paymentIntent: null, status: 'paid', created: Date.now(), refunded: null });
    const c = await open();
    const welcome = await welcomed(c, hello({ auth: mail }));
    expect(welcome.shop).toEqual({ version: 3, owned: ['heart'] });
    expect(welcome.players.find(p => p.id === saved.id)).toMatchObject({ badge: 'heart' });
  });
});

describe('the shop without a catalog', () => {
  const { ctx, open, welcomed } = setup({ maps: chestMaps(), items: itemsData(), auth: devAuth() });

  it('sells nothing and is closed', async () => {
    const mail = email('none');
    await savedPlayer(ctx.storage, { map: 'house', x: 3, y: 2, dir: 'up', tokenHash: null, authSub: `dev:${mail}` });
    const c = await open();
    expect((await welcomed(c, hello({ auth: mail }))).shop).toEqual({ version: 0, owned: [] });
    c.send(buy('heart'));
    expect(await c.next('refused')).toEqual({ t: 'refused', action: 'checkout', reason: 'shop_closed' });
  });
});

describe('purchases in memory', () => {
  it('are kept once, read with the player, never written by a save, and taken back by a refund', async () => {
    await keepsPurchases(new MemoryStorage());
  });

  it('stay, whose-less, when their buyer is deleted', async () => {
    const storage = new MemoryStorage();
    const guest = await savedPlayer(storage, { lastSeenAt: 500 });
    await storage.addPurchase({ session: 'cs_test_g', player: guest.id, look: 'heart', amount: 99, currency: 'eur', paymentIntent: 'pi_g', status: 'paid', created: 400, refunded: null });
    expect(await storage.forgetGuests(600)).toEqual([guest.id]);
    expect(storage.storedPurchases()).toEqual([expect.objectContaining({ session: 'cs_test_g', player: null, look: 'heart' })]);
  });

  it('come back with their buyer after a restart', async () => {
    const storage = new MemoryStorage();
    await shopKeptThroughARestart(storage, storage);
  });
});
