/**
 * The shop for looks: outfits, jacket patterns and name tag badges that are sold, never earned, and that
 * change how you look and nothing else (no energy, gear, finds, XP or parcels). One look, one price, paid
 * in money through Stripe's own page; no game currency and no random rewards. A look is bought once and
 * kept, and it is worn like any other: an outfit over your gear, a pattern on your jacket, a badge on your
 * name tag (outfits.ts, merits.ts).
 *
 * What the shop sells is data (content/shop.json: ids, names, lines and prices), checked here so that it
 * never sells a look that can be earned. How a look is drawn is code (the client's characters.ts and
 * icons.ts, by id). Which looks a player bought is kept by the server from Stripe's word (a paid checkout,
 * or a refund), never from the client's; the shop is off until the owner sets up payments.
 */
import { BADGES, PATTERNS } from './merits';
import { OUTFITS } from './outfits';
import type { Problem } from './validate';

/** What a look is: an outfit (over your gear), a pattern (on your jacket) or a badge (on your name tag). */
export type ShopKind = 'outfit' | 'pattern' | 'badge';
export const SHOP_KINDS: readonly ShopKind[] = ['outfit', 'pattern', 'badge'];

/** A look the shop sells. */
export interface ShopLook {
  /** Kept with each purchase and with what a player wears: never renamed once released. */
  id: string;
  kind: ShopKind;
  name: string;
  /** The look inside a sentence: "the lighthouse oilskin", "the aurora bands". */
  noun: string;
  /** The noun is plural: "you get them at once". */
  plural?: true;
  /** One line, in the game's words. */
  text: string;
  /** Its price in each currency the shop may sell in (lowercase ISO 4217), in minor units: 299 is 2.99. */
  prices: Record<string, number>;
}

/** content/shop.json. */
export interface ShopData {
  /** A client with another version reloads, so the prices it shows are always the server's. */
  version: number;
  looks: ShopLook[];
}

/** The currencies a price may be in, with how each is written before its amount. Each has two decimals, as Stripe counts them. */
export const SHOP_CURRENCIES: Readonly<Record<string, string>> = { eur: '€', usd: '$', gbp: '£', chf: 'CHF ' };
/** A price may be from 0.50 (below it Stripe takes no card payment in these currencies) to 99.99. */
export const SHOP_MIN_PRICE = 50;
export const SHOP_MAX_PRICE = 9999;

/**
 * What the welcome says of the shop: the version of its catalog (a client with another reloads), the
 * looks the player bought (paid, not refunded), and whether it is open, with the currency its prices are
 * in and where its terms of sale are. Closed (none), what was bought is still worn and kept.
 */
export interface ShopView {
  version: number;
  owned: string[];
  open?: ShopOpen;
}
export interface ShopOpen {
  /** Lowercase ISO 4217, a currency every look has a price in. */
  currency: string;
  /** The owner's terms of sale (an https address). */
  terms: string;
}

/** An empty catalog: a server or a client without content/shop.json sells nothing. */
export const NO_SHOP: ShopData = { version: 0, looks: [] };

/** A look the shop sells, by id (and of `kind`, if said); undefined for one it does not sell. */
export function shopLookOf(shop: ShopData | undefined, id: string | null | undefined, kind?: ShopKind): ShopLook | undefined {
  const look = id ? shop?.looks.find(l => l.id === id) : undefined;
  return look && (kind === undefined || look.kind === kind) ? look : undefined;
}

/** "€2.99", "CHF 2.90": a price in minor units, as a player reads it (the same in every browser's language). */
export function formatPrice(minor: number, currency: string): string {
  const sign = SHOP_CURRENCIES[currency.toLowerCase()] ?? `${currency.toUpperCase()} `;
  const n = Math.max(0, Math.round(minor));
  return `${sign}${Math.floor(n / 100)}.${String(n % 100).padStart(2, '0')}`;
}

/** What `look` costs in `currency`, in minor units; undefined when the catalog has no price for it there. */
export function priceOf(look: ShopLook, currency: string): number | undefined {
  const p = look.prices[currency.toLowerCase()];
  return Number.isInteger(p) ? p : undefined;
}

/**
 * Why `look` cannot be bought now (null: it can): only while the shop is open, only signed in (a
 * purchase belongs to an account, which keeps it), and only a look not bought yet: each is bought once.
 */
export function whyNotCheckout(look: ShopLook, owned: readonly string[], signedIn: boolean, open: boolean): 'shop_closed' | 'sign_in_first' | 'owned' | null {
  if (!open) return 'shop_closed';
  if (!signedIn) return 'sign_in_first';
  return owned.includes(look.id) ? 'owned' : null;
}

/** May someone who bought `owned`, signed in or not, wear the shop's look `id` of `kind`? Only one they bought, and only signed in. */
export function mayWearShopLook(shop: ShopData | undefined, id: string | null | undefined, kind: ShopKind, owned: readonly string[], signedIn: boolean): boolean {
  return !!shopLookOf(shop, id, kind) && signedIn && owned.includes(id!);
}

/** Ids of what a player keeps: lowercase words joined by hyphens, as every id in content is. */
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Every look that can be earned, by kind: the shop sells none of them, nor anything that shares an id or a name with one. */
const EARNED: ReadonlyArray<{ id: string; name: string; kind: ShopKind }> = [
  ...OUTFITS.map(o => ({ id: o.id, name: o.name, kind: 'outfit' as const })),
  ...[...PATTERNS, ...BADGES].map(l => ({ id: l.id, name: l.name, kind: l.kind })),
];

/**
 * Checks the catalog: every look well formed, each id once, never a look that can be earned (by its id or
 * its name, whatever its kind), and a price in every currency it names, the same currencies for every
 * look, from SHOP_MIN_PRICE to SHOP_MAX_PRICE in whole minor units. `currency`, when given, must be one
 * of them: the one the shop sells in (SHOP_CURRENCY).
 */
export function validateShop(data: ShopData, currency?: string): Problem[] {
  const out: Problem[] = [];
  const err = (message: string) => out.push({ level: 'error', message });
  if (!Number.isInteger(data.version) || data.version < 1) err('the version must be a whole number from 1');
  if (!Array.isArray(data.looks)) {
    err('it needs a list of looks');
    return out;
  }
  const seen = new Set<string>();
  let currencies: string | undefined;
  for (const [i, look] of data.looks.entries()) {
    const at = typeof look?.id === 'string' && look.id ? `look ${look.id}` : `look ${i + 1}`;
    if (typeof look !== 'object' || look === null) {
      err(`${at} is not a look`);
      continue;
    }
    if (typeof look.id !== 'string' || !ID.test(look.id)) err(`${at}: its id must be lowercase words joined by hyphens`);
    else if (seen.has(look.id)) err(`${at} is there twice`);
    seen.add(look.id);
    if (!SHOP_KINDS.includes(look.kind)) err(`${at}: its kind must be one of ${SHOP_KINDS.join(', ')}`);
    for (const field of ['name', 'noun', 'text'] as const) {
      if (typeof look[field] !== 'string' || !look[field].trim()) err(`${at}: it needs a ${field}`);
    }
    if (typeof look.text === 'string' && !/^[A-Z].*[.!]$/.test(look.text)) err(`${at}: its text is one sentence or two, from a capital to a full stop`);
    if (typeof look.noun === 'string' && !/^the /.test(look.noun)) err(`${at}: its noun reads in a sentence, like "the lighthouse oilskin"`);
    if (look.plural !== undefined && look.plural !== true) err(`${at}: plural is true, or left out`);
    const earned = EARNED.find(e => e.id === look.id || (typeof look.name === 'string' && e.name.toLowerCase() === look.name.trim().toLowerCase()));
    if (earned) err(`${at}: the ${earned.kind} ${earned.id} can be earned, and the shop never sells a look that can be earned`);
    const prices = typeof look.prices === 'object' && look.prices !== null ? Object.entries(look.prices) : [];
    if (!prices.length) err(`${at}: it needs a price`);
    for (const [c, p] of prices) {
      if (!Object.hasOwn(SHOP_CURRENCIES, c)) err(`${at}: ${c} is not a currency the shop sells in (${Object.keys(SHOP_CURRENCIES).join(', ')})`);
      if (!Number.isInteger(p) || p < SHOP_MIN_PRICE || p > SHOP_MAX_PRICE) err(`${at}: its price in ${c} must be whole minor units from ${SHOP_MIN_PRICE} to ${SHOP_MAX_PRICE}`);
    }
    const these = prices.map(([c]) => c).sort().join(',');
    if (currencies === undefined) currencies = these;
    else if (these !== currencies) err(`${at}: every look is priced in the same currencies (${currencies}), this one in ${these || 'none'}`);
  }
  if (currency !== undefined && data.looks.length && !(currencies ?? '').split(',').includes(currency.toLowerCase())) {
    err(`nothing is priced in ${currency}: the shop sells in ${currencies || 'no currency'}`);
  }
  return out;
}
