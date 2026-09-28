/**
 * The wardrobe, a tab of the chest at home: how your character looks, whatever gear it wears. Three parts,
 * each behind a tab of its own: outfits (outfits.ts), a tile for no outfit and one for each, in the order
 * they open, a locked one saying the level that opens it; and past level 20, the jacket patterns and name
 * tag badges merits buy (merits.ts), each with a tile for none. A tap shows its card (details.ts), whose
 * button, A or a double tap wears it: nothing is used up, so nothing is asked first; buying a look spends a
 * merit, so its Buy button asks first. While the shop is open (shop.ts), a fourth tab sells looks that are
 * never earned, and a look bought there is in its kind's tab too, so it is worn whether the shop is open or
 * not. A guest finds one card that says signing in keeps what they wear, with the Sign in button.
 *
 * Plain logic with no page in it, so it can be tested: main.ts builds the view from the game, and
 * hud.ts draws it.
 */
import { BADGES, LEVEL_MAX, MERIT_XP, OUTFITS, PATTERNS, levelOf, mayWear, whyNotBuy, xpFor, type LookKind, type MeritLook, type MeritsView } from '@napoland/shared';
import { NO_BADGE_ICON, NO_OUTFIT_ICON, NO_PATTERN_ICON, badgeIcon, outfitIcon, patternIcon } from './icons';
import { meritText, price, thousands } from './said';
import { ownedTiles, shopTab, type ShopState, type ShopTabView } from './shop';

/** What the wardrobe says to a guest, over a Sign in button, in place of the outfits. */
export const WARDROBE_GATE = 'Sign in to keep what you wear. Signing in keeps your character.';
/** Over the tiles, one for each part. */
export const WARDROBE_HINT = 'An outfit changes how you look, whatever you wear, and nothing else. Tap one to see it, and tap it twice to wear it.';
export const PATTERNS_HINT = 'A pattern goes on your jacket, over an outfit too, for everyone to see. Tap one to see it.';
export const BADGES_HINT = 'A badge sits beside your name on your name tag, for everyone to see. Tap one to see it.';
/** Below level 20, over the patterns and the badges: how merits come. */
export const MERITS_COME = `Past level ${LEVEL_MAX}, every ${thousands(MERIT_XP)} XP earns a merit.`;
/** The tile, and the card, for wearing no outfit, no pattern and no badge. */
export const NO_OUTFIT = { id: 'none', name: 'No outfit', text: 'Your gear shows, piece by piece, as you wear it.' } as const;
export const NO_PATTERN = { id: 'no-pattern', name: 'No pattern', text: 'Your jacket as it is.' } as const;
export const NO_BADGE = { id: 'no-badge', name: 'No badge', text: 'Your name alone on your name tag.' } as const;

/** The wardrobe's parts, each behind a tab of its own: the shop's only while it is open. */
export type WardrobePart = 'outfits' | 'patterns' | 'badges' | 'shop';

/** What the wardrobe knows about you: a guest has none of it yet. */
export interface WardrobeState {
  guest: boolean;
  level: number;
  /** The outfit you wear (null: none, your gear shows). */
  wearing: string | null;
  /** XP in all (what the level alone says, left out), what you spent of your merits and the looks you bought, and the pattern and badge you wear. */
  xp?: number;
  merits?: MeritsView;
  pattern?: string | null;
  badge?: string | null;
  /** The shop: what it sells, whether it is open, and what you bought in it. None: nothing to buy, and nothing bought. */
  shop?: ShopState;
}

export interface OutfitTile {
  /** An outfit's id, or NO_OUTFIT.id. */
  id: string;
  name: string;
  icon: string;
  /** Your level has not reached it yet: it is dimmed. */
  locked: boolean;
  /** You wear it now (for no outfit: you wear none). */
  worn: boolean;
  /** Under its drawing: its name, or while it is locked, the level that opens it ("Level 10"). */
  label: string;
  /** A look from the shop: its tile opens the shop's card (details.ts), wherever it is. */
  shop?: true;
}

/** A pattern's or a badge's tile (or none's): like an outfit's, and whether merits can buy it now. */
export interface LookTile extends OutfitTile {
  /** Not yours, and merits can buy it now: its price shows bright. */
  buy: boolean;
}

export interface WardrobeView {
  /** For a guest: what signing in keeps, with the Sign in button, and no tiles. */
  gate: string | null;
  tiles: OutfitTile[];
  patterns: LookTile[];
  badges: LookTile[];
  /** Over the patterns and the badges: the merits there are to spend, or below level 20, how they come. */
  merits: string;
  /** The Shop tab; null: there is none (the shop is closed). */
  shop: ShopTabView | null;
}

/** Your XP, as the wardrobe was told it or as the level says. */
const xpOf = (s: WardrobeState) => s.xp ?? xpFor(s.level);
const NO_MERITS: MeritsView = { spent: 0, owned: [] };

export function wardrobeView(s: WardrobeState): WardrobeView {
  if (s.guest) return { gate: WARDROBE_GATE, tiles: [], patterns: [], badges: [], merits: '', shop: null };
  const none: OutfitTile = { id: NO_OUTFIT.id, name: NO_OUTFIT.name, icon: NO_OUTFIT_ICON, locked: false, worn: s.wearing === null, label: NO_OUTFIT.name };
  const xp = xpOf(s);
  return {
    gate: null,
    tiles: [none, ...OUTFITS.map(o => {
      const locked = !mayWear(o, s.level, true);
      return { id: o.id, name: o.name, icon: outfitIcon(o.id), locked, worn: s.wearing === o.id, label: locked ? `Level ${o.level}` : o.name };
    }), ...ownedTiles(s.shop, 'outfit', s.wearing)],
    patterns: lookTiles(s, 'pattern'),
    badges: lookTiles(s, 'badge'),
    merits: levelOf(xp) < LEVEL_MAX ? MERITS_COME : `Merits: ${meritText(xp, (s.merits ?? NO_MERITS).spent)}.`,
    shop: shopTab(s.shop, { outfit: s.wearing, pattern: s.pattern ?? null, badge: s.badge ?? null }, s.guest),
  };
}

/**
 * The tiles of one kind of look: none first, then every look merits buy, in order, then the ones of that
 * kind bought in the shop. One not yours shows its price, bright while merits can buy it.
 */
function lookTiles(s: WardrobeState, kind: LookKind): LookTile[] {
  const none = kind === 'pattern' ? NO_PATTERN : NO_BADGE, wearing = (kind === 'pattern' ? s.pattern : s.badge) ?? null, m = s.merits ?? NO_MERITS;
  const bought = ownedTiles(s.shop, kind, wearing);
  const first: LookTile = { id: none.id, name: none.name, icon: kind === 'pattern' ? NO_PATTERN_ICON : NO_BADGE_ICON, locked: false, worn: !isLook(wearing, kind) && !bought.some(t => t.worn), buy: false, label: none.name };
  return [first, ...(kind === 'pattern' ? PATTERNS : BADGES).map(l => {
    const owned = m.owned.includes(l.id), buy = !owned && !whyNotBuy(l, xpOf(s), m, true);
    return { id: l.id, name: l.name, icon: lookIcon(l), locked: !owned && !buy, worn: wearing === l.id, buy, label: owned ? l.name : price(l.cost) };
  }), ...bought.map(t => ({ ...t, buy: false }))];
}

/** Is `id` a look of `kind` merits buy? */
const isLook = (id: string | null, kind: LookKind) => (kind === 'pattern' ? PATTERNS : BADGES).some(l => l.id === id);

/** A look's drawing: a pattern on a jacket, or a badge as it sits on a name tag. */
export function lookIcon(look: MeritLook): string {
  return look.kind === 'pattern' ? patternIcon(look.id) : badgeIcon(look.id) ?? NO_BADGE_ICON;
}

/** An outfit's name inside a sentence: "the lineman's jacket", but "the NAPO work suit". */
export function outfitWords(name: string): string {
  return /^[A-Z]{2}/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1);
}
