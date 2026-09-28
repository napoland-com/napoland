/**
 * The shop without a page: its tab in the wardrobe (only while the server says it is open), its tiles and
 * cards, the question before paying with its price and the waiver, what the game sends and where it goes,
 * what it says coming back from Stripe's page (confirmed, being confirmed, not paid), a look refunded, and
 * how the shop's looks are drawn, in how many draw calls.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { formatPrice, xpFor, type ClientMsg, type MapData, type PlayerView, type ShopData, type ShopView } from '@napoland/shared';
import { cardPress, detailView, type DetailState, type DetailView } from '../src/details';
import { Game } from '../src/game';
import { cardHtml, shopGridsHtml, wardrobeTilesHtml } from '../src/hud';
import { NO_BADGE_ICON, badgeIcon, outfitIcon, patternIcon } from '../src/icons';
import { lookOf, refusalText } from '../src/items';
import { Maps } from '../src/maps';
import { checkoutQuestion } from '../src/said';
import {
  SHOP_CANCELLED, SHOP_CONFIRMING, SHOP_HINT, SHOP_OPENING, SHOP_THANKS, inWardrobe, payPage, refundedLine, returnFrom, returnLine, shopTab, withoutReturn, type ShopState,
} from '../src/shop';
import { newsBanner } from '../src/status';
import { wardrobeView, type WardrobeState } from '../src/wardrobe';
import { OUTFIT_LOOKS, PATTERN_LOOKS, dressOf, makePlayer } from '../src/view/characters';
import { FULL, ITEMS, shopData, tinyTown, welcome } from './fixtures';
import shopJson from '../../../content/shop.json';

const CATALOG = shopData();
const REAL = shopJson as ShopData;
const OPEN = { currency: 'eur', terms: 'https://example.test/terms' };
const shop = (owned: string[] = [], open: ShopState['open'] = OPEN): ShopState => ({ catalog: CATALOG, open, owned });
const state = (more: Partial<WardrobeState> = {}): WardrobeState => ({ guest: false, level: 3, wearing: null, xp: xpFor(3), shop: shop(), ...more });
const card = (id: string, w: WardrobeState): DetailView | null => detailView({ from: 'shop', id }, { items: ITEMS, bag: [], stash: [], gear: {}, worn: {}, wardrobe: w } satisfies DetailState);

describe('the Shop tab', () => {
  it('is there only while the shop is open, and sells nothing it has not got', () => {
    expect(wardrobeView(state({ shop: undefined })).shop).toBeNull();
    expect(wardrobeView(state({ shop: shop([], null) })).shop).toBeNull();
    expect(wardrobeView(state({ shop: { catalog: { version: 1, looks: [] }, open: OPEN, owned: [] } })).shop).toBeNull();
    // A guest meets the wardrobe's sign-in card, the shop and all.
    expect(wardrobeView(state({ guest: true }))).toMatchObject({ gate: expect.any(String), shop: null });
    expect(shopTab(shop(), { outfit: null, pattern: null, badge: null }, false)).not.toBeNull();
  });

  it('shows every look it sells by kind, with its price in the shop\'s currency, and the terms of sale', () => {
    const v = wardrobeView(state({ shop: shop([], { currency: 'chf', terms: 'https://example.test/agb' }) })).shop!;
    expect(v.hint).toBe(SHOP_HINT);
    expect(v.terms).toBe('https://example.test/agb');
    expect(v.groups.map(g => [g.title, g.tiles.map(t => [t.id, t.label, t.buy, t.locked])])).toEqual([
      ['Outfits', [['lighthouse-oilskin', 'CHF 2.90', true, false]]],
      ['Jacket patterns', [['aurora-bands', 'CHF 1.50', true, false]]],
      ['Name tag badges', [['heart', 'CHF 1.00', true, false]]],
    ]);
  });

  it('says a look bought is yours, ticks the one you wear, and puts it in its own kind\'s tab too', () => {
    const v = wardrobeView(state({ wearing: 'lighthouse-oilskin', badge: 'heart', shop: shop(['lighthouse-oilskin', 'heart']) }));
    expect(v.shop!.groups[0]!.tiles[0]).toMatchObject({ id: 'lighthouse-oilskin', label: 'Yours', worn: true, buy: false });
    expect(v.tiles.at(-1)).toMatchObject({ id: 'lighthouse-oilskin', label: 'Lighthouse oilskin', worn: true, shop: true, locked: false });
    expect(v.tiles[0]).toMatchObject({ id: 'none', worn: false });
    expect(v.badges.at(-1)).toMatchObject({ id: 'heart', worn: true, shop: true, buy: false });
    // Wearing it, the tile for no badge has no tick.
    expect(v.badges[0]).toMatchObject({ id: 'no-badge', worn: false });
    // Not bought: not in its kind's tab.
    expect(v.patterns.some(t => t.id === 'aurora-bands')).toBe(false);
  });

  it('keeps a look bought wearable in its kind\'s tab when the shop is closed', () => {
    const v = wardrobeView(state({ shop: shop(['aurora-bands'], null) }));
    expect(v.shop).toBeNull();
    expect(v.patterns.at(-1)).toMatchObject({ id: 'aurora-bands', label: 'Aurora bands', shop: true, locked: false });
  });

  it('is drawn as the rest of the wardrobe: a heading for each kind, and tiles that open the shop\'s card', () => {
    const html = shopGridsHtml(wardrobeView(state({ shop: shop(['heart']) })).shop!);
    expect(html).toContain('<h3 class="stash-title">Outfits</h3>');
    expect(html).toContain('data-shop="lighthouse-oilskin" data-buy aria-label="Lighthouse oilskin, €2.99 to buy"');
    expect(html).toContain('<span class="lbl">€2.99</span>');
    expect(html).toContain('data-shop="heart" aria-label="Heart"');
    // In a kind's tab, a look from the shop opens the shop's card too.
    const tabs = wardrobeTilesHtml(wardrobeView(state({ shop: shop(['heart']) })).badges, 'data-look');
    expect(tabs).toContain('data-shop="heart"');
    expect(tabs).toContain('data-look="fir"');
  });
});

describe('a look\'s card in the shop', () => {
  it('buys it with its price, asking first with the card still open behind the question', () => {
    const v = card('lighthouse-oilskin', state())!;
    expect(v).toMatchObject({ icon: outfitIcon('lighthouse-oilskin'), name: 'Lighthouse oilskin', text: 'Yellow oilskin.', facts: ['An outfit: how you look, whatever you wear'] });
    expect(v.act).toEqual({ label: 'Buy', then: '€2.99', enabled: true, does: { kind: 'checkout', look: 'lighthouse-oilskin' } });
    expect(v.notes).toEqual([{ text: 'A look only: it changes nothing out there. You pay on Stripe\'s page.', tone: 'plain' }]);
    expect(cardPress(v)).toEqual({ does: { kind: 'checkout', look: 'lighthouse-oilskin' }, close: false, shake: false });
    expect(cardHtml(v)).toContain('data-card-act>Buy <span class="then">(€2.99)</span></button>');
  });

  it('wears one bought, or takes it off, whether the shop is open or not', () => {
    const w = card('aurora-bands', state({ shop: shop(['aurora-bands'], null) }))!;
    expect(w.facts).toEqual(['On your jacket, over an outfit too', 'Yours for good']);
    expect(w.act).toEqual({ label: 'Wear', enabled: true, does: { kind: 'pattern', id: 'aurora-bands' } });
    const off = card('heart', state({ badge: 'heart', shop: shop(['heart']) }))!;
    expect(off.act).toEqual({ label: 'Take off', then: 'your name alone', enabled: true, does: { kind: 'badge', id: null } });
    expect(card('lighthouse-oilskin', state({ wearing: 'lighthouse-oilskin', shop: shop(['lighthouse-oilskin']) }))!.act).toMatchObject({ label: 'Take off', then: 'your gear shows again', does: { kind: 'outfit', id: null } });
  });

  it('is greyed out for a guest, says why, and only shakes', () => {
    const v = card('heart', state({ guest: true }))!;
    expect(v.notes).toEqual([{ text: 'Sign in to buy looks.', tone: 'plain' }]);
    expect(v.act?.enabled).toBe(false);
    expect(cardPress(v)).toEqual({ close: false, shake: true });
  });

  it('is gone for a look the shop does not sell, for one not bought while it is closed, and without the wardrobe', () => {
    expect(card('crown', state())).toBeNull();
    expect(card('heart', state({ shop: shop([], null) }))).toBeNull();
    expect(detailView({ from: 'shop', id: 'heart' }, { items: ITEMS, bag: [], stash: [], gear: {}, worn: {} })).toBeNull();
  });
});

describe('what the shop says', () => {
  const [oilskin, bands] = [CATALOG.looks[0]!, CATALOG.looks[1]!];

  it('asks before paying, with the price and the waiver the law asks for', () => {
    const real = REAL.looks.find(l => l.id === 'lighthouse-oilskin')!;
    expect(checkoutQuestion(real, real.prices.eur!, 'eur')).toBe('Buy the lighthouse oilskin for €2.99? You get it at once, so you give up the 14 days to change your mind.');
    expect(checkoutQuestion(bands, 150, 'chf')).toBe('Buy the aurora bands for CHF 1.50? You get them at once, so you give up the 14 days to change your mind.');
  });

  it('says why a payment cannot be opened, in plain words', () => {
    expect(refusalText('shop_closed', 'checkout')).toBe('The shop is closed');
    expect(refusalText('shop_down', 'checkout')).toBe('The shop cannot reach Stripe right now. Try again in a moment');
    expect(refusalText('sign_in_first', 'checkout')).toBe('Sign in to buy looks');
    expect(refusalText('slow_down', 'checkout')).toBe('Give it a moment before you try again');
    expect(refusalText('gone', 'checkout')).toBe('The shop does not sell that');
    expect(refusalText('owned', 'checkout')).toBe('It is yours already');
    expect(refusalText('not_owned', 'outfit')).toBe('It is not yours yet');
  });

  it('thanks you once a look is yours, in a banner, and says when one is refunded', () => {
    expect(inWardrobe('the winter parka', false)).toBe('The winter parka is in your wardrobe.');
    expect(newsBanner({ kind: 'bought', noun: 'the aurora bands', plural: true, said: false }, 'Home')).toEqual({ title: 'Thank you', sub: 'The aurora bands are in your wardrobe.' });
    expect(newsBanner({ kind: 'bought', noun: 'the heart badge', plural: false, said: true }, 'Home')).toBeNull();
    expect(refundedLine(oilskin)).toBe('The lighthouse oilskin was refunded, so it is no longer in your wardrobe.');
    expect(refundedLine(bands)).toBe('The aurora bands were refunded, so they are no longer in your wardrobe.');
  });

  it('reads where you came back from, for a look it sells, and takes it out of the address', () => {
    expect(returnFrom('?shop=paid&look=heart', CATALOG)).toEqual({ look: 'heart', paid: true });
    expect(returnFrom('?look=heart&shop=cancelled', CATALOG)).toEqual({ look: 'heart', paid: false });
    for (const q of ['', '?shop=paid', '?shop=paid&look=crown', '?shop=free&look=heart', '?code=abc']) expect([q, returnFrom(q, CATALOG)]).toEqual([q, null]);
    expect(withoutReturn('?shop=paid&look=heart')).toBe('');
    expect(withoutReturn('?code=abc&shop=paid&look=heart')).toBe('?code=abc');
  });

  it('says on the way back that the look is yours, or is being confirmed until it is, or that nothing was paid', () => {
    expect(returnLine({ look: 'heart', paid: true }, ['heart'])).toEqual({ text: 'Thank you. The look is in your wardrobe.', waiting: false });
    expect(returnLine({ look: 'heart', paid: true }, [])).toEqual({ text: 'Your payment is being confirmed.', waiting: true });
    expect(returnLine({ look: 'heart', paid: false }, [])).toEqual({ text: 'No payment was made.', waiting: false });
  });

  it('only ever sends the browser to a page', () => {
    expect(payPage('https://checkout.stripe.com/c/pay/cs_test_1#x')).toBe('https://checkout.stripe.com/c/pay/cs_test_1#x');
    expect(payPage('http://localhost:12111/pay/cs_test_fake_1')).toBe('http://localhost:12111/pay/cs_test_fake_1');
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'not a url']) expect(payPage(bad)).toBeNull();
  });
});

describe('the game at the shop', () => {
  /** A 5x4 room like home, the chest at 1,1: stand at 1,2, facing up. */
  const room = (): MapData => ({
    id: 'room', name: 'Home', version: 1, kind: 'inside', depth: 0, width: 5, height: 4,
    tiles: ['xxxxx', 'xpppx', 'xpppx', 'xxpxx'], levels: Array<string>(4).fill('00000'),
    spawn: { x: 1, y: 2, dir: 'up' }, exits: [{ x: 2, y: 3, w: 1, h: 1, to: 'town', tx: 3, ty: 1, dir: 'down' }],
    objects: [{ kind: 'chest', x: 1, y: 1 }],
  });
  const person = (id: string, more: Partial<PlayerView> = {}): PlayerView => ({ id, name: id, x: 1, y: 2, dir: 'up', color: '#f29e4c', gear: {}, quirks: [], ...more });
  const view = (owned: string[] = [], open: ShopView['open'] | null = OPEN): ShopView => ({ version: CATALOG.version, owned, ...(open ? { open } : {}) });
  let sent: ClientMsg[];
  let went: string[];
  let g: Game;
  /** In the game at home (nothing pressed yet: a press would close what the text box says). */
  const land = (shopView: ShopView = view(), more: { guest?: boolean; players?: PlayerView[] } = {}) =>
    g.handle({ ...welcome(room(), more.players ?? [person('me')], FULL, { shop: shopView }), guest: more.guest ?? false }, 0);
  /** In the game at home, the chest open. */
  const arrive = (shopView: ShopView = view(), more: { guest?: boolean; players?: PlayerView[] } = {}) => {
    land(shopView, more);
    g.pressA();
    g.handle({ t: 'chest', stash: [] }, 0);
    sent.length = 0;
  };
  beforeEach(() => {
    sent = [];
    went = [];
    g = new Game(new Maps([tinyTown(), room()]), m => sent.push(m), ITEMS, undefined, undefined, CATALOG);
    g.goTo = url => went.push(url);
  });

  it('knows from the welcome whether the shop is open and what you bought', () => {
    arrive(view(['heart']));
    expect(g.shopOpen).toEqual(OPEN);
    expect(g.shopOwned).toEqual(['heart']);
    arrive(view([], null));
    expect(g.shopOpen).toBeNull();
  });

  it('asks first, with the price and the waiver; YES opens the payment, and the game goes to the page the server says', () => {
    arrive();
    g.checkout('lighthouse-oilskin');
    expect(g.askView()).toMatchObject({ who: 'Shop', text: 'Buy the lighthouse oilskin for €2.99? You get it at once, so you give up the 14 days to change your mind.', choice: 'yes' });
    expect(sent).toEqual([]);
    g.pressA();
    expect(sent).toEqual([{ t: 'checkout', x: 1, y: 1, look: 'lighthouse-oilskin', waiver: true }]);
    expect(g.note).toMatchObject({ who: 'Shop', text: SHOP_OPENING, waiting: true });
    g.handle({ t: 'checkout', look: 'lighthouse-oilskin', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }, 0);
    expect(went).toEqual(['https://checkout.stripe.com/c/pay/cs_test_1']);
    // Nothing is yours for asking.
    expect(g.shopOwned).toEqual([]);
  });

  it('sends nothing on NO, and says in the box what the server says no to', () => {
    arrive();
    g.checkout('heart');
    g.pressB();
    expect(sent).toEqual([]);
    g.checkout('heart');
    g.pressA();
    g.handle({ t: 'refused', action: 'checkout', reason: 'shop_down' }, 0);
    expect(g.note).toMatchObject({ who: 'Shop', text: 'The shop cannot reach Stripe right now. Try again in a moment.' });
    // A page that is no page: the game stays.
    g.handle({ t: 'checkout', look: 'heart', url: 'javascript:alert(1)' }, 0);
    expect(went).toEqual([]);
  });

  it('says why it cannot, without asking: bought already, closed, or a guest', () => {
    arrive(view(['heart']));
    g.checkout('heart');
    expect(g.question).toBeNull();
    expect(g.note).toMatchObject({ who: 'Shop', text: 'It is yours already.' });
    arrive(view([], null));
    g.checkout('heart');
    expect(g.note).toMatchObject({ text: 'The shop is closed.' });
    arrive(view(), { guest: true });
    g.checkout('heart');
    expect(g.note).toMatchObject({ text: 'Sign in to buy looks.' });
    expect(sent).toEqual([]);
  });

  it('makes news of a look that becomes yours, and says in the box when one is refunded', () => {
    arrive();
    g.news = [];
    g.handle({ t: 'shop', owned: ['aurora-bands'] }, 0);
    expect(g.shopOwned).toEqual(['aurora-bands']);
    expect(g.news).toEqual([{ kind: 'bought', noun: 'the aurora bands', plural: true, said: false }]);
    g.news = [];
    g.handle({ t: 'shop', owned: [] }, 0);
    expect(g.news).toEqual([]);
    expect(g.note).toMatchObject({ who: 'Shop', text: 'The aurora bands were refunded, so they are no longer in your wardrobe.' });
  });

  it('coming back from paying, says the payment is being confirmed until the look is yours, then thanks you', () => {
    g.returning = { look: 'heart', paid: true };
    land();
    expect(g.note).toMatchObject({ who: 'Shop', text: SHOP_CONFIRMING, waiting: false });
    // It stays up a while: Stripe's word mostly comes in seconds.
    expect(g.noteView(0)!.ms).toBeGreaterThanOrEqual(30_000);
    g.news = [];
    g.handle({ t: 'shop', owned: ['heart'] }, 0);
    expect(g.note).toMatchObject({ who: 'Shop', text: SHOP_THANKS });
    expect(g.returning).toBeNull();
    // Said in the box already: no banner, but the wardrobe's dot.
    expect(g.news).toEqual([{ kind: 'bought', noun: 'the heart badge', plural: false, said: true }]);
  });

  it('coming back from paying, thanks you at once when Stripe\'s word came first, and says so when nothing was paid', () => {
    g.returning = { look: 'heart', paid: true };
    land(view(['heart']));
    expect(g.note).toMatchObject({ who: 'Shop', text: SHOP_THANKS });
    expect(g.returning).toBeNull();
    g.returning = { look: 'heart', paid: false };
    land();
    expect(g.note).toMatchObject({ who: 'Shop', text: SHOP_CANCELLED });
    // Said once: the next welcome (a reconnect) says nothing again.
    g.pressA();
    land();
    expect(g.note).toBeNull();
  });

  it('waits to say it until you are in signed in: a guest\'s welcome says nothing of it', () => {
    g.returning = { look: 'heart', paid: true };
    land(view(), { guest: true });
    expect(g.note).toBeNull();
    expect(g.returning).toEqual({ look: 'heart', paid: true });
  });

  it('is out of date when the server sells from another catalog: it stops, and main.ts reloads', () => {
    g.handle(welcome(room(), [person('me')], FULL, { shop: { ...view(), version: CATALOG.version + 1 } }), 0);
    expect(g.online).toBe(false);
  });

  it('draws everyone in what they bought: an outfit and a pattern from the shop', () => {
    arrive(view(), { players: [person('me'), person('bea', { x: 3, outfit: 'lighthouse-oilskin', pattern: 'aurora-bands' })] });
    const looks = new Map(g.avatars().map(a => [a.id, a.look]));
    expect(looks.get('bea')).toMatchObject({ outfit: 'lighthouse-oilskin', pattern: 'aurora-bands' });
    // A copy that has no catalog leaves them in their gear, as for an outfit of a newer release.
    expect(lookOf({}, ITEMS, 'lighthouse-oilskin', 'aurora-bands')).toEqual(lookOf({}, ITEMS));
  });
});

describe('the shop\'s looks as the world draws them', () => {
  const meshes = (rig: ReturnType<typeof makePlayer>) => { let n = 0; rig.root.traverse(o => { if (o instanceof THREE.Mesh) n++; }); return n; };

  it('has a drawing of every look the shop sells, in the wardrobe and in the world', () => {
    for (const l of REAL.looks) {
      if (l.kind === 'outfit') expect(Object.hasOwn(OUTFIT_LOOKS, l.id), l.id).toBe(true);
      if (l.kind === 'pattern') expect(Object.hasOwn(PATTERN_LOOKS, l.id), l.id).toBe(true);
      if (l.kind === 'badge') expect(badgeIcon(l.id), l.id).toBeDefined();
    }
    const icons = REAL.looks.map(l => (l.kind === 'outfit' ? outfitIcon(l.id) : l.kind === 'pattern' ? patternIcon(l.id) : badgeIcon(l.id) ?? NO_BADGE_ICON));
    expect(new Set(icons).size).toBe(REAL.looks.length);
    for (const svg of icons) expect(svg).toMatch(/^<svg viewBox="0 0 32 32"[^>]*>[\s\S]*<\/svg>$/);
  });

  it('draws each outfit in its own colors, as its tile does', () => {
    for (const l of REAL.looks.filter(x => x.kind === 'outfit')) {
      const d = dressOf('#fff', { outfit: l.id });
      for (const c of new Set([d.body, d.sleeveL, d.sleeveR])) expect(outfitIcon(l.id), `${l.id} ${c}`).toContain(c);
      // The pack still shows over it.
      expect(dressOf('#fff', { outfit: l.id, bag: '#123456' }).bag).toBe('#123456');
    }
  });

  it('costs no more draw calls: ten meshes whatever the shop\'s outfit and pattern, over each other and over the gear', () => {
    const outfits = [undefined, ...REAL.looks.filter(l => l.kind === 'outfit').map(l => l.id), 'rain-cape'];
    const patterns = [undefined, ...REAL.looks.filter(l => l.kind === 'pattern').map(l => l.id)];
    for (const outfit of outfits) for (const pattern of patterns) expect(meshes(makePlayer('#3a86ff', { outfit, pattern, bagSize: 1.4 })), `${outfit} ${pattern}`).toBe(10);
  });

  it('puts a pattern from the shop on the jacket, and on a cape\'s bell, never off it', () => {
    for (const pattern of REAL.looks.filter(l => l.kind === 'pattern').map(l => l.id)) {
      const plain = dressOf('#3a86ff'), worn = dressOf('#3a86ff', { pattern });
      expect(worn.parts.length, pattern).toBeGreaterThan(plain.parts.length);
      const cape = dressOf('#3a86ff', { outfit: 'rain-cape', pattern });
      expect(cape.armL.length + cape.armR.length, pattern).toBe(0);
    }
  });

  it('writes prices as a player reads them', () => {
    expect(formatPrice(REAL.looks[0]!.prices.eur!, 'eur')).toBe('€2.99');
  });
});
