/**
 * The shop for looks, in the wardrobe at the chest (packages/shared/src/shop.ts has what it sells and its
 * rules): its tab, shown only while the server says it is open, with every look it sells, its price or
 * that it is yours, and the owner's terms of sale; and what the game says when a player comes back from
 * Stripe's page, where they paid (or did not): the look is theirs once Stripe tells the server, which
 * tells the game, so until then it says the payment is being confirmed.
 *
 * Plain logic with no page in it, so it can be tested: main.ts reads where the player came back from and
 * builds the tab from the game, hud.ts draws it.
 */
import { SHOP_KINDS, formatPrice, priceOf, shopLookOf, type ShopData, type ShopKind, type ShopLook, type ShopOpen } from '@napoland/shared';
import { NO_BADGE_ICON, badgeIcon, outfitIcon, patternIcon } from './icons';

/** Over the looks in the Shop tab. */
export const SHOP_HINT = 'Looks only: they change how you look, never what you can do. You pay on Stripe\'s page: your card never reaches the game.';
/** The link to the owner's terms of sale, under it. */
export const SHOP_TERMS = 'Terms of sale';
/** Coming back from Stripe's page, in the text box. */
export const SHOP_CONFIRMING = 'Your payment is being confirmed.';
export const SHOP_THANKS = 'Thank you. The look is in your wardrobe.';
export const SHOP_CANCELLED = 'No payment was made.';
/** While the payment page opens, said yes to the question. */
export const SHOP_OPENING = 'Opening the payment page...';
/** On a tile and a card, a look you bought. */
export const YOURS = 'Yours';
/** The headings of the Shop tab's parts, by kind. */
export const SHOP_TITLES: Readonly<Record<ShopKind, string>> = { outfit: 'Outfits', pattern: 'Jacket patterns', badge: 'Name tag badges' };
/** Where each kind of look goes, on its card. */
export const SHOP_WHERE: Readonly<Record<ShopKind, string>> = { outfit: 'An outfit: how you look, whatever you wear', pattern: 'On your jacket, over an outfit too', badge: 'On your name tag, beside your name' };

/** What the wardrobe knows of the shop: what it sells, whether it is open (its currency and terms), and what you bought. */
export interface ShopState {
  catalog: ShopData;
  open: ShopOpen | null;
  owned: readonly string[];
}

/** A look's tile in the Shop tab (and, once bought, in its kind's tab): like an outfit's, with its price or that it is yours. */
export interface ShopTile {
  id: string;
  name: string;
  icon: string;
  /** Under its drawing: its price, or "Yours". */
  label: string;
  locked: boolean;
  worn: boolean;
  /** Not yours, and it can be bought now: its price shows bright. */
  buy: boolean;
  /** Its tile opens the shop's card (DetailRef `shop`), wherever it is. */
  shop: true;
}

/** The Shop tab: what it says over the looks, the terms of sale's address, and the looks by kind. */
export interface ShopTabView {
  hint: string;
  terms: string;
  groups: Array<{ kind: ShopKind; title: string; tiles: ShopTile[] }>;
}

/** A look's drawing: an outfit on a small figure, a pattern on a jacket, a badge as it sits on a name tag. */
export function shopIcon(look: ShopLook): string {
  if (look.kind === 'outfit') return outfitIcon(look.id);
  if (look.kind === 'pattern') return patternIcon(look.id);
  return badgeIcon(look.id) ?? NO_BADGE_ICON;
}

/** A look's tile: `wearing` is what you wear of its kind now; `open` whether it can be bought now (the shop open, signed in). */
export function shopTile(look: ShopLook, s: ShopState, wearing: string | null, open: boolean): ShopTile {
  const owned = s.owned.includes(look.id), price = s.open ? priceOf(look, s.open.currency) : undefined;
  const label = owned ? YOURS : price !== undefined ? formatPrice(price, s.open!.currency) : look.name;
  return { id: look.id, name: look.name, icon: shopIcon(look), label, locked: !owned && !open, worn: owned && wearing === look.id, buy: !owned && open && price !== undefined, shop: true };
}

/**
 * The Shop tab, or null when there is none: the shop is closed (the server did not say it is open), or it
 * sells nothing. `wearing` is what you wear, by kind; `guest`: a guest buys nothing (the wardrobe shows
 * its sign-in card instead, so this is only the belt to those braces).
 */
export function shopTab(s: ShopState | undefined, wearing: Readonly<Record<ShopKind, string | null>>, guest: boolean): ShopTabView | null {
  if (!s?.open || !s.catalog.looks.length) return null;
  const groups = SHOP_KINDS.flatMap(kind => {
    const looks = s.catalog.looks.filter(l => l.kind === kind);
    return looks.length ? [{ kind, title: SHOP_TITLES[kind], tiles: looks.map(l => shopTile(l, s, wearing[kind], !guest)) }] : [];
  });
  return { hint: SHOP_HINT, terms: s.open.terms, groups };
}

/** The looks of `kind` you bought that the catalog has, as tiles for that kind's own tab (so they are worn whether the shop is open or not). */
export function ownedTiles(s: ShopState | undefined, kind: ShopKind, wearing: string | null): ShopTile[] {
  if (!s) return [];
  return s.owned.flatMap(id => {
    const look = shopLookOf(s.catalog, id, kind);
    return look ? [{ ...shopTile(look, s, wearing, false), label: look.name }] : [];
  });
}

/** Where a player came back from Stripe's page: `?shop=paid` or `?shop=cancelled`, with the look. */
export interface ShopReturn {
  look: string;
  paid: boolean;
}

/** The return in a page's query (`location.search`), for a look the shop sells; null for none, or one that makes no sense. */
export function returnFrom(search: string, catalog: ShopData): ShopReturn | null {
  const q = new URLSearchParams(search), how = q.get('shop'), look = q.get('look');
  if ((how !== 'paid' && how !== 'cancelled') || !shopLookOf(catalog, look)) return null;
  return { look: look!, paid: how === 'paid' };
}

/** The query without the return's words, so a reload says nothing again ('' when nothing is left). */
export function withoutReturn(search: string): string {
  const q = new URLSearchParams(search);
  q.delete('shop');
  q.delete('look');
  const left = q.toString();
  return left ? `?${left}` : '';
}

/**
 * What the game says on coming back: nothing paid; the look already yours (Stripe's word came first, as it
 * mostly does); or, until it comes, that the payment is being confirmed (`waiting`).
 */
export function returnLine(r: ShopReturn, owned: readonly string[]): { text: string; waiting: boolean } {
  if (!r.paid) return { text: SHOP_CANCELLED, waiting: false };
  return owned.includes(r.look) ? { text: SHOP_THANKS, waiting: false } : { text: SHOP_CONFIRMING, waiting: true };
}

/** "The winter parka": a look's noun at the start of a sentence. */
const Noun = (noun: string) => `${noun.charAt(0).toUpperCase()}${noun.slice(1)}`;

/** A look bought, for its banner: "The winter parka is in your wardrobe." */
export function inWardrobe(noun: string, plural: boolean): string {
  return `${Noun(noun)} ${plural ? 'are' : 'is'} in your wardrobe.`;
}

/** A look refunded, in the text box: "The winter parka was refunded, so it is no longer in your wardrobe." */
export function refundedLine(look: ShopLook): string {
  return look.plural ? `${Noun(look.noun)} were refunded, so they are no longer in your wardrobe.` : `${Noun(look.noun)} was refunded, so it is no longer in your wardrobe.`;
}

/** Only an address the browser can go to as a page: the server says where the payment page is. */
export function payPage(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}
