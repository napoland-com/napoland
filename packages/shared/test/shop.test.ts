import { describe, expect, it } from 'vitest';
import {
  BADGES, OUTFITS, PATTERNS, SHOP_CURRENCIES, SHOP_KINDS, formatPrice, mayWearShopLook, parseClientMsg, priceOf, shopLookOf, validateShop, whyNotCheckout, type ShopData, type ShopLook,
} from '../src';
import json from '../../../content/shop.json';

const catalog = json as ShopData;
const errors = (data: ShopData, currency?: string) => validateShop(data, currency).filter(p => p.level === 'error').map(p => p.message);
const look = (more: Partial<ShopLook> = {}): ShopLook => ({
  id: 'sea-coat', kind: 'outfit', name: 'Sea coat', noun: 'the sea coat', text: 'A coat for the sea.', prices: { eur: 299, chf: 290 }, ...more,
});
const shop = (...looks: ShopLook[]): ShopData => ({ version: 1, looks });

describe('the catalog (content/shop.json)', () => {
  it('is valid, in every currency the shop sells in', () => {
    expect(validateShop(catalog)).toEqual([]);
    for (const c of Object.keys(catalog.looks[0]!.prices)) expect(errors(catalog, c), c).toEqual([]);
  });

  it('sells four outfits, and a few jacket patterns and name tag badges, with a price for each', () => {
    expect(catalog.looks.filter(l => l.kind === 'outfit').map(l => l.id)).toEqual(['lighthouse-oilskin', 'winter-parka', 'napo-dress-uniform', 'festival-sweater']);
    expect(catalog.looks.filter(l => l.kind === 'pattern').length).toBeGreaterThanOrEqual(2);
    expect(catalog.looks.filter(l => l.kind === 'badge').length).toBeGreaterThanOrEqual(2);
    expect(formatPrice(priceOf(shopLookOf(catalog, 'lighthouse-oilskin')!, 'eur')!, 'eur')).toBe('€2.99');
  });

  it('never sells a look that can be earned: no id and no name is one of an outfit, a pattern or a badge', () => {
    const earned = [...OUTFITS, ...PATTERNS, ...BADGES];
    for (const l of catalog.looks) {
      expect(earned.map(e => e.id), l.id).not.toContain(l.id);
      expect(earned.map(e => e.name.toLowerCase()), l.id).not.toContain(l.name.toLowerCase());
    }
  });
});

describe('checking a catalog', () => {
  it('refuses a look that can be earned, by its id or by its name, whatever its kind', () => {
    expect(errors(shop(look({ id: 'rain-cape' })))).toEqual(['look rain-cape: the outfit rain-cape can be earned, and the shop never sells a look that can be earned']);
    expect(errors(shop(look({ id: 'shiny-chevron', kind: 'pattern', name: 'Chevron' })))[0]).toContain('the pattern chevron can be earned');
    expect(errors(shop(look({ id: 'fir', kind: 'outfit' })))[0]).toContain('the badge fir can be earned');
  });

  it('refuses a look twice, a bad id, a kind it does not know and words missing', () => {
    expect(errors(shop(look(), look()))).toEqual(['look sea-coat is there twice']);
    expect(errors(shop(look({ id: 'Sea Coat' })))[0]).toContain('lowercase words');
    expect(errors(shop(look({ kind: 'hat' as never })))[0]).toContain('its kind must be one of outfit, pattern, badge');
    expect(errors(shop(look({ name: ' ' })))).toContain('look sea-coat: it needs a name');
    expect(errors(shop(look({ text: 'no capital' })))[0]).toContain('from a capital to a full stop');
    expect(errors(shop(look({ noun: 'sea coat' })))[0]).toContain('reads in a sentence');
  });

  it('wants whole prices from 0.50 to 99.99 in currencies the shop sells in, the same for every look', () => {
    expect(errors(shop(look({ prices: {} })))).toEqual(['look sea-coat: it needs a price']);
    expect(errors(shop(look({ prices: { eur: 49 } })))[0]).toContain('from 50 to 9999');
    expect(errors(shop(look({ prices: { eur: 2.99 } })))[0]).toContain('whole minor units');
    expect(errors(shop(look({ prices: { eur: 10_000 } })))[0]).toContain('from 50 to 9999');
    expect(errors(shop(look({ prices: { jpy: 300 } })))[0]).toContain('jpy is not a currency the shop sells in');
    expect(errors(shop(look(), look({ id: 'lake-coat', name: 'Lake coat', prices: { eur: 299 } })))).toEqual(['look lake-coat: every look is priced in the same currencies (chf,eur), this one in eur']);
  });

  it('wants the shop\'s own currency among them', () => {
    expect(errors(shop(look()), 'eur')).toEqual([]);
    expect(errors(shop(look()), 'usd')).toEqual(['nothing is priced in usd: the shop sells in chf,eur']);
  });

  it('refuses a catalog without a version or a list', () => {
    expect(errors({ version: 0, looks: [] })).toEqual(['the version must be a whole number from 1']);
    expect(errors({ version: 1 } as ShopData)).toEqual(['it needs a list of looks']);
  });
});

describe('prices', () => {
  it('are written as a player reads them, in every currency the shop sells in', () => {
    expect(formatPrice(299, 'eur')).toBe('€2.99');
    expect(formatPrice(99, 'usd')).toBe('$0.99');
    expect(formatPrice(290, 'chf')).toBe('CHF 2.90');
    expect(formatPrice(1205, 'GBP')).toBe('£12.05');
    expect(formatPrice(300, 'sek')).toBe('SEK 3.00');
    expect(Object.keys(SHOP_CURRENCIES)).toEqual(['eur', 'usd', 'gbp', 'chf']);
  });

  it('are the catalog\'s, in the currency asked for', () => {
    expect(priceOf(look(), 'EUR')).toBe(299);
    expect(priceOf(look(), 'usd')).toBeUndefined();
  });
});

describe('who may buy and wear what', () => {
  const coat = look();
  it('buys only while the shop is open, signed in, and each look once', () => {
    expect(whyNotCheckout(coat, [], true, false)).toBe('shop_closed');
    expect(whyNotCheckout(coat, [], false, true)).toBe('sign_in_first');
    expect(whyNotCheckout(coat, ['sea-coat'], true, true)).toBe('owned');
    expect(whyNotCheckout(coat, ['other'], true, true)).toBeNull();
  });

  it('wears only a look bought, of its kind, signed in: whether the shop is open or not', () => {
    const data = shop(coat, look({ id: 'wave', kind: 'pattern', name: 'Wave', noun: 'the wave' }));
    expect(mayWearShopLook(data, 'sea-coat', 'outfit', ['sea-coat'], true)).toBe(true);
    expect(mayWearShopLook(data, 'sea-coat', 'outfit', [], true)).toBe(false);
    expect(mayWearShopLook(data, 'sea-coat', 'outfit', ['sea-coat'], false)).toBe(false);
    expect(mayWearShopLook(data, 'sea-coat', 'pattern', ['sea-coat'], true)).toBe(false);
    expect(mayWearShopLook(data, 'gone-coat', 'outfit', ['gone-coat'], true)).toBe(false);
    expect(shopLookOf(data, 'wave', 'pattern')?.name).toBe('Wave');
    expect(shopLookOf(data, 'wave', 'badge')).toBeUndefined();
    expect(shopLookOf(undefined, 'wave')).toBeUndefined();
    expect(SHOP_KINDS).toEqual(['outfit', 'pattern', 'badge']);
  });
});

describe('the checkout message', () => {
  it('comes only with the waiver said yes to', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'checkout', x: 3, y: 1, look: 'winter-parka', waiver: true }))).toEqual({ t: 'checkout', x: 3, y: 1, look: 'winter-parka', waiver: true });
    for (const bad of [
      { t: 'checkout', x: 3, y: 1, look: 'winter-parka' },
      { t: 'checkout', x: 3, y: 1, look: 'winter-parka', waiver: false },
      { t: 'checkout', x: 3, y: 1, look: '', waiver: true },
      { t: 'checkout', x: 3, look: 'winter-parka', waiver: true },
      { t: 'checkout', x: 3, y: 1, look: 'x'.repeat(41), waiver: true },
    ]) expect(parseClientMsg(JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
  });
});
