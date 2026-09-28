/**
 * The shop's rules in the World (who may open a payment, which looks bought are worn, what Stripe's word
 * changes) and the shop itself with a stand-in World and storage: the webhook's answers, and Stripe's word
 * that comes while a player is on their way into the game. Over WebSockets in net-shop.test.ts.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { TileMap, type ServerMsg } from '@napoland/shared';
import { setLogLevel } from '../src/log';
import { Shop } from '../src/shop';
import type { PlayerRecord, Storage } from '../src/storage';
import { signPayload } from '../src/stripe';
import { World, colorFor, type Outgoing } from '../src/world';
import { fixtureMaps, houseData, shopData, shopSettings } from './fixtures';
import { paidEvent, refundEvent } from './helpers';

/** The fixture house with a chest at 3,1: stand at 3,2 facing up to reach it. */
const withChest = () => {
  const h = houseData();
  return new TileMap({ ...h, objects: [...h.objects, { kind: 'chest', x: 3, y: 1 }] });
};
/** Signed in (a dev identity) unless `authSub` says otherwise, by the chest. */
const rec = (id: string, more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: null, authSub: `dev:${id}@example.test`, map: 'house', x: 3, y: 2, dir: 'up', color: colorFor(id), energy: 50, bag: [],
  createdAt: 1, lastSeenAt: 1, ...more,
});
function world(options: { guests?: boolean } = {}, ...players: PlayerRecord[]): World {
  const maps = [...fixtureMaps().filter(m => m.data.id !== 'house'), withChest()];
  const w = new World(maps, 'town', 'overcast', { shop: shopData(), guests: options.guests ?? true });
  for (const p of players) w.join(p, 0);
  w.drain();
  w.takeWrites();
  return w;
}
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id ? [o.msg] : []));
const onMap = (out: Outgoing[], map: string) => out.flatMap(o => ('map' in o && o.map === map ? [o.msg] : []));

describe('the shop\'s looks in the World', () => {
  it('are worn only while they are the player\'s, and only signed in: another shows as none, and stays saved', () => {
    const w = world({});
    const joined = w.join(rec('a', { outfit: 'winter-parka', pattern: 'argyle', badge: 'heart', shop: ['winter-parka', 'heart'] }), 0);
    expect(joined.player).toMatchObject({ outfit: 'winter-parka', badge: 'heart' });
    expect(joined.player.pattern).toBeUndefined();
    expect(joined.shop).toEqual(['winter-parka', 'heart']);
    // Left out, not null: a save without it keeps what was saved, for when it is theirs again.
    expect(w.get('a')!.pattern).toBeUndefined();
    const guest = w.join(rec('g', { authSub: null, outfit: 'winter-parka', shop: ['winter-parka'] }), 0);
    expect(guest.player.outfit).toBeUndefined();
  });

  it('keep a look bought that the shop no longer sells, unshown', () => {
    const w = world({});
    expect(w.join(rec('a', { shop: ['old-hat', 'heart'] }), 0).shop).toEqual(['heart']);
    expect(w.get('a')!.shop).toEqual(['old-hat', 'heart']);
  });

  it('are worn at the chest once bought, at any level; one not bought is refused', () => {
    const w = world({}, rec('a', { shop: ['winter-parka'] }));
    w.outfit('a', 3, 1, 'winter-parka', 100);
    expect(onMap(w.drain(), 'house')).toEqual([{ t: 'outfit', id: 'a', outfit: 'winter-parka' }]);
    w.badge('a', 3, 1, 'heart', 200);
    expect(to(w.drain(), 'a')).toEqual([{ t: 'refused', action: 'badge', reason: 'not_owned' }]);
  });
});

describe('a payment in the World', () => {
  it('may be opened only signed in, at the chest, for a look the shop sells and the player has not bought', () => {
    const w = world({}, rec('a', { shop: ['heart'] }), rec('far', { x: 2, y: 3 }), rec('g', { authSub: null }));
    expect(w.mayCheckout('a', 3, 1, 'winter-parka', 100)).toBeNull();
    expect(w.mayCheckout('a', 3, 1, 'heart', 100)).toBe('owned');
    expect(w.mayCheckout('a', 3, 1, 'crown', 100)).toBe('gone');
    expect(w.mayCheckout('far', 3, 1, 'winter-parka', 100)).toBe('too_far');
    expect(w.mayCheckout('g', 3, 1, 'winter-parka', 100)).toBe('sign_in_first');
    expect(w.mayCheckout('nobody', 3, 1, 'winter-parka', 100)).toBe('gone');
    // Asking changes nothing, and nobody hears it.
    expect(w.drain()).toEqual([]);
    expect(w.takeWrites().players).toEqual([]);
  });

  it('is never opened without sign-in: without it, a purchase would belong to nobody', () => {
    const w = world({ guests: false }, rec('a', { authSub: null }));
    expect(w.mayCheckout('a', 3, 1, 'winter-parka', 100)).toBe('sign_in_first');
  });
});

describe('Stripe\'s word in the World', () => {
  it('tells the player what they bought, and takes off a look no longer theirs, for everyone who sees them, saved at once', () => {
    const w = world({}, rec('a', { shop: ['winter-parka', 'argyle', 'heart'], outfit: 'winter-parka', pattern: 'argyle', badge: 'heart' }), rec('b', { x: 1, y: 3 }));
    expect(w.setShop('a', ['heart'])).toBe(true);
    const out = w.drain();
    expect(to(out, 'a')).toEqual([{ t: 'shop', owned: ['heart'] }]);
    expect(onMap(out, 'house')).toEqual([{ t: 'outfit', id: 'a', outfit: null }, { t: 'pattern', id: 'a', pattern: null }]);
    expect(w.get('a')).toMatchObject({ shop: ['heart'], outfit: null, pattern: null, badge: 'heart' });
    expect(w.takeWrites().players.map(p => p.id)).toEqual(['a']);
    // Someone who is not online hears it all the next time they join.
    expect(w.setShop('nobody', ['heart'])).toBe(false);
  });

  it('leaves an earned look on: only the shop\'s come off', () => {
    const w = world({}, rec('a', { xp: 30, outfit: 'napo-suit', shop: ['winter-parka'] }));
    w.setShop('a', []);
    expect(onMap(w.drain(), 'house')).toEqual([]);
    expect(w.get('a')!.outfit).toBe('napo-suit');
  });
});

describe('the shop itself', () => {
  beforeAll(() => setLogLevel('silent'));
  const SECRET = shopSettings().webhookSecret, T = 1_800_000_000;
  /** A shop with a stand-in World (whose `online` players are in the game) and storage. */
  const stand = (online = new Set<string>(), shopLooksOf = async (_id: string): Promise<string[]> => ['heart']) => {
    const setShop = vi.fn((id: string, _owned: string[]) => online.has(id));
    const w = { has: (id: string) => online.has(id), setShop, mayCheckout: () => null } as unknown as World;
    const kept: unknown[] = [];
    const storage = {
      addPurchase: async (p: unknown) => { kept.push(p); return true; },
      refundPurchase: async () => null,
      shopLooksOf,
    } as unknown as Storage;
    const sent: Array<[string, ServerMsg]> = [];
    const shop = new Shop({ settings: shopSettings(), catalog: shopData(), world: w, storage, send: (id, msg) => sent.push([id, msg]), flush: () => {}, clock: () => 0, nowS: () => T });
    const hook = (body: string) => shop.webhook(Buffer.from(body), signPayload(body, SECRET, T));
    return { shop, setShop, kept, sent, hook, online };
  };

  it('reads again what a player bought when Stripe\'s word came while they were on their way in', async () => {
    const id = randomUUID(), s = stand();
    expect(await s.hook(paidEvent({ player: id, look: 'heart' }))).toEqual({ status: 200, body: 'Kept' });
    // Not in the game yet: nobody to tell.
    expect(s.setShop).not.toHaveBeenCalled();
    s.online.add(id);
    await s.shop.joined(id);
    expect(s.setShop).toHaveBeenCalledWith(id, ['heart']);
    // Nobody else is read again, and a minute on, nor are they.
    await s.shop.joined(randomUUID());
    expect(s.setShop).toHaveBeenCalledTimes(1);
    vi.useFakeTimers({ now: Date.now() + 61_000 });
    try {
      await s.shop.joined(id);
    } finally {
      vi.useRealTimers();
    }
    expect(s.setShop).toHaveBeenCalledTimes(1);
  });

  it('answers 500 when what Stripe said cannot be kept, so Stripe sends it again; and a failed read never stops the next', async () => {
    const id = randomUUID();
    let fail = true;
    const s = stand(new Set([id]), async () => {
      if (fail) throw new Error('database down');
      return ['heart'];
    });
    expect(await s.hook(paidEvent({ player: id, look: 'heart' }))).toEqual({ status: 500, body: 'Try again' });
    fail = false;
    await s.shop.joined(id);
    expect(s.setShop).toHaveBeenCalledWith(id, ['heart']);
  });

  it('refuses an event of the other mode, and one that names no player of the game', async () => {
    const s = stand();
    expect(await s.hook(paidEvent({ player: randomUUID(), look: 'heart', live: true }))).toEqual({ status: 200, body: 'Other mode' });
    expect(await s.hook(paidEvent({ player: 'someone', look: 'heart' }))).toEqual({ status: 200, body: 'Not ours' });
    expect(await s.hook(refundEvent({ pi: 'pi_1' }))).toEqual({ status: 200, body: 'Nothing to do' });
    expect(s.kept).toEqual([]);
  });

  it('says in the welcome whether it is open, and never says a key', () => {
    const s = stand();
    expect(s.shop.view(['heart'])).toEqual({ version: 3, owned: ['heart'], open: { currency: 'eur', terms: 'https://example.test/terms' } });
    expect(JSON.stringify(s.shop.view([]))).not.toContain('sk_test');
    expect(JSON.stringify(s.shop.view([]))).not.toContain('whsec');
    const closed = new Shop({ settings: undefined, catalog: shopData(), world: {} as World, storage: {} as Storage, send: () => {}, flush: () => {}, clock: () => 0 });
    expect(closed.view(['heart'])).toEqual({ version: 3, owned: ['heart'] });
    expect(closed.open).toBe(false);
  });
});
