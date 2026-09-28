/**
 * The wardrobe, a tab of the chest at home: how your character looks, whatever gear it wears
 * (outfits.ts). A tile for no outfit and one for each outfit, in the order they open; a locked one
 * says the level that opens it. A tap shows its card (details.ts), whose button, A or a double tap
 * wears it: nothing is used up, so nothing is asked first. A guest finds one card that says signing
 * in keeps what they wear, with the Sign in button.
 *
 * Plain logic with no page in it, so it can be tested: main.ts builds the view from the game, and
 * hud.ts draws it.
 */
import { OUTFITS, mayWear } from '@napoland/shared';
import { NO_OUTFIT_ICON, outfitIcon } from './icons';

/** What the wardrobe says to a guest, over a Sign in button, in place of the outfits. */
export const WARDROBE_GATE = 'Sign in to keep what you wear. Signing in keeps your character.';
/** Over the tiles. */
export const WARDROBE_HINT = 'An outfit changes how you look, whatever you wear, and nothing else. Tap one to see it, and tap it twice to wear it.';
/** The tile, and the card, for wearing no outfit. */
export const NO_OUTFIT = { id: 'none', name: 'No outfit', text: 'Your gear shows, piece by piece, as you wear it.' } as const;

/** What the wardrobe knows about you: a guest has none of it yet. */
export interface WardrobeState {
  guest: boolean;
  level: number;
  /** The outfit you wear (null: none, your gear shows). */
  wearing: string | null;
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
}

export interface WardrobeView {
  /** For a guest: what signing in keeps, with the Sign in button, and no tiles. */
  gate: string | null;
  tiles: OutfitTile[];
}

export function wardrobeView(s: WardrobeState): WardrobeView {
  if (s.guest) return { gate: WARDROBE_GATE, tiles: [] };
  const none: OutfitTile = { id: NO_OUTFIT.id, name: NO_OUTFIT.name, icon: NO_OUTFIT_ICON, locked: false, worn: s.wearing === null, label: NO_OUTFIT.name };
  return {
    gate: null,
    tiles: [none, ...OUTFITS.map(o => {
      const locked = !mayWear(o, s.level, true);
      return { id: o.id, name: o.name, icon: outfitIcon(o.id), locked, worn: s.wearing === o.id, label: locked ? `Level ${o.level}` : o.name };
    })],
  };
}

/** An outfit's name inside a sentence: "the lineman's jacket", but "the NAPO work suit". */
export function outfitWords(name: string): string {
  return /^[A-Z]{2}/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1);
}
