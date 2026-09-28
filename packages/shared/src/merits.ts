/**
 * Past level 20: merits. Level 20 stays the top, but stashing keeps counting XP, and every MERIT_XP of
 * it past what level 20 takes (10,830) earns a merit. Merits buy looks others see, never power: a pattern
 * on your jacket (over an outfit too) or a badge on your name tag, each bought once and kept, one of each
 * worn at a time. They resist nothing, add nothing and change nothing out there.
 *
 * How many merits someone earned follows from their XP, which never goes down, so nothing is granted:
 * only what they spent and the looks they bought are kept, with the pattern and the badge they wear. A
 * guest earns them too (XP counts for everyone), and spends them once signed in.
 *
 * The server checks every purchase and every change (World.buy, World.pattern, World.badge); the client
 * shows the wardrobe from the same rules and draws each look (a pattern: apps/client/src/view/characters.ts;
 * a badge: icons.ts). The drawing of a look is code, so a new one comes with the code that draws it: they
 * are listed here, not in content/, like the outfits (outfits.ts).
 */
import { LEVEL_MAX, xpFor } from './progress';

/** Every this much XP past MERITS_FROM earns a merit. */
export const MERIT_XP = 1500;
/** Where merits start: the XP level 20, the top, takes. */
export const MERITS_FROM = xpFor(LEVEL_MAX);

/** The merits `xp` has earned in all: none before level 20, then one for every MERIT_XP past it. */
export function meritsOf(xp: number): number {
  return xp > MERITS_FROM ? Math.floor((xp - MERITS_FROM) / MERIT_XP) : 0;
}

/** The XP still to earn before the next merit (below level 20, the first one's: level 20 and MERIT_XP more). */
export function toNextMerit(xp: number): number {
  const past = Math.max(0, xp) - MERITS_FROM;
  return past < 0 ? MERIT_XP - past : MERIT_XP - (past % MERIT_XP);
}

/** What a player keeps of merits: how many they spent, and the looks they bought, in the order they bought them. */
export interface MeritsView {
  spent: number;
  owned: string[];
}

/** Merits still to spend: earned by `xp`, less what was spent. */
export function meritsLeft(xp: number, spent: number): number {
  return Math.max(0, meritsOf(xp) - Math.max(0, spent));
}

export type LookKind = 'pattern' | 'badge';

/** A look merits buy: a pattern on your jacket, or a badge beside your name on your name tag. */
export interface MeritLook {
  /** Kept with the player (players.looks, players.pattern, players.badge): never renamed once released. */
  id: string;
  kind: LookKind;
  name: string;
  /** The look inside a sentence: "the chevron pattern", "the fir badge". */
  noun: string;
  /** The noun is plural: "the stripes are yours". */
  plural?: true;
  /** One line, in the game's words. */
  text: string;
  /** What it costs, in merits. */
  cost: number;
}

/** Every jacket pattern, in the order the wardrobe shows them. */
export const PATTERNS: readonly MeritLook[] = [
  { id: 'stripes', kind: 'pattern', name: 'Stripes', noun: 'the stripes', plural: true, cost: 1, text: 'Stripes down the front and the sleeves, a shade off the cloth they are on.' },
  { id: 'checks', kind: 'pattern', name: 'Checks', noun: 'the checks', plural: true, cost: 1, text: 'The big checks of the loggers\' flannel, from when Stonebrook cut timber.' },
  { id: 'chevron', kind: 'pattern', name: 'Chevron', noun: 'the chevron pattern', cost: 1, text: 'A chevron on the front, like the ones on NAPO\'s barriers at the checkpoint.' },
  { id: 'reflective', kind: 'pattern', name: 'Reflective bands', noun: 'the reflective bands', plural: true, cost: 1, text: 'Pale bands round the body and the sleeves that catch a light, as the lineman\'s do.' },
  { id: 'napo-patch', kind: 'pattern', name: 'NAPO patch', noun: 'the NAPO patch', cost: 1, text: 'NAPO\'s yellow patch on the front and on the sleeve, from the station\'s stores.' },
  { id: 'squares', kind: 'pattern', name: 'Patchwork squares', noun: 'the patchwork squares', plural: true, cost: 1, text: 'Squares of other cloth sewn on, the way the residents mend what they have.' },
];

/** Every name tag badge, in the order the wardrobe shows them. */
export const BADGES: readonly MeritLook[] = [
  { id: 'fir', kind: 'badge', name: 'Fir', noun: 'the fir badge', cost: 1, text: 'A fir, for whoever knows the woods by walking them.' },
  { id: 'flame', kind: 'badge', name: 'Flame', noun: 'the flame badge', cost: 1, text: 'A flame, for whoever keeps the fires going out there.' },
  { id: 'shard', kind: 'badge', name: 'Shard', noun: 'the shard badge', cost: 1, text: 'A shard, for whoever brings them home to the Old Stone.' },
  { id: 'lamp', kind: 'badge', name: 'Lamp', noun: 'the lamp badge', cost: 1, text: 'The lamp in the Near Woods that no wires run to.' },
  { id: 'moth', kind: 'badge', name: 'Moth', noun: 'the moth badge', cost: 1, text: 'A moth, drawn to the light like the rest of us.' },
  { id: 'old-stone', kind: 'badge', name: 'The Old Stone', noun: 'the Old Stone badge', cost: 1, text: 'The standing stone by the brook, crack and all.' },
];

export const MERIT_LOOKS: readonly MeritLook[] = [...PATTERNS, ...BADGES];

/** A look by id (of `kind`, if said); undefined for one this release does not have. */
export function meritLookOf(id: string | null | undefined, kind?: LookKind): MeritLook | undefined {
  const look = id ? MERIT_LOOKS.find(l => l.id === id) : undefined;
  return look && (kind === undefined || look.kind === kind) ? look : undefined;
}

/** Why `look` cannot be bought now (null: it can): only signed in, once, and with merits enough to spend. */
export function whyNotBuy(look: MeritLook, xp: number, merits: MeritsView, signedIn: boolean): 'sign_in_first' | 'owned' | 'no_merits' | null {
  if (!signedIn) return 'sign_in_first';
  if (merits.owned.includes(look.id)) return 'owned';
  return meritsLeft(xp, merits.spent) < look.cost ? 'no_merits' : null;
}

/** May someone who bought `owned`, signed in or not, wear the look `id` of `kind`? Only a look of theirs, and only signed in. */
export function mayWearLook(id: string | null | undefined, kind: LookKind, owned: readonly string[], signedIn: boolean): boolean {
  return !!meritLookOf(id, kind) && signedIn && owned.includes(id!);
}
