/**
 * A cozy cabin (DESIGN.md, The loop): your own cabin has a few places whose furniture years of damp
 * spoiled (COMFORTS). Each is made at the workbench at home and set in its place at once, never into
 * the stash, and adds comfort (its item's `comfort` in content/items.json). Stand by your own fire
 * COZY_AFTER_S and you are cozy: out in the wilds you tire slower (COZY_DRAIN, a Mods factor) for
 * cozySeconds(comfort) after you leave the fire, longer the cozier the cabin.
 *
 * The rules are here so the server, which decides, and the client, which shows them, agree.
 */
import type { Mods } from './feats';
import type { ItemDef } from './items';

/** The places in a home whose furniture can be made again: what stands there, spoiled until it is. */
export const COMFORTS = ['stove', 'bed', 'rug', 'lamp', 'rack', 'shelf'] as const;
export type Comfort = (typeof COMFORTS)[number];

/** Seconds by your own fire (on a tile it warms, in your own cabin) before you are cozy. */
export const COZY_AFTER_S = 20;
/** Cozy lasts this many minutes once you leave the fire, and one more for each point of comfort. */
export const COZY_MINUTES = 5;
export const COZY_PER_COMFORT = 1;
/** Cozy, out in the wilds the whole drain is this much of what it would be: you tire 10% slower. */
export const COZY_DRAIN = 0.9;

/** What being cozy puts into Mods (feats.ts), beside the feats and the charms. */
export const COZY_MODS: Readonly<Partial<Mods>> = { drain: COZY_DRAIN };

/** How many tiles a place covers, across and down: a bed is two long, the rug three by two. */
export function comfortSize(what: Comfort): [number, number] {
  return what === 'bed' ? [1, 2] : what === 'rug' ? [3, 2] : [1, 1];
}

/** The rug is walked over, like any rug; everything else stands in the way. */
export const underfootComfort = (what: Comfort): boolean => what === 'rug';

/** The furniture that goes into a place (its item), among `items`. */
export function furnitureFor(what: Comfort, items: Iterable<ItemDef>): ItemDef | undefined {
  for (const def of items) if (def.kind === 'furniture' && def.furnishes === what) return def;
  return undefined;
}

/**
 * How comfortable a cabin is: the comfort of every piece of furniture set in it (`furniture`, item ids),
 * each once. An id today's items do not know as furniture (a newer release's) adds nothing.
 */
export function comfortOf(furniture: readonly string[] | undefined, items: Map<string, ItemDef>): number {
  let sum = 0;
  for (const id of new Set(furniture ?? [])) {
    const def = items.get(id);
    if (def?.kind === 'furniture') sum += def.comfort ?? 0;
  }
  return sum;
}

/** The most comfort a cabin can have: every piece of furniture there is. */
export function comfortMax(items: Iterable<ItemDef>): number {
  let sum = 0;
  for (const def of items) if (def.kind === 'furniture') sum += def.comfort ?? 0;
  return sum;
}

/** How long cozy lasts once you leave the fire, in seconds: COZY_MINUTES, and a minute more for each point of comfort. */
export function cozySeconds(comfort: number): number {
  return (COZY_MINUTES + COZY_PER_COMFORT * Math.max(0, Math.floor(comfort))) * 60;
}

/** Whether a set of furniture has one that dries you (the drying rack): you always leave the cabin dry. */
export function dries(furniture: readonly string[] | undefined, items: Map<string, ItemDef>): boolean {
  return (furniture ?? []).some(id => { const def = items.get(id); return def?.kind === 'furniture' && def.dries === true; });
}

/**
 * The trophies a stash shows on the trophy shelf, in its order: each charm and each piece of anomalous gear
 * it holds, once. Your own shelf shows yours; a neighbor who comes in sees theirs (the server sends it).
 */
export function trophiesIn(stash: ReadonlyArray<{ item: string }>, get: (id: string) => ItemDef | undefined): ItemDef[] {
  const seen = new Set<string>(), out: ItemDef[] = [];
  for (const s of stash) {
    if (seen.has(s.item)) continue;
    const def = get(s.item);
    if (!def || (def.kind !== 'charm' && !(def.kind === 'gear' && def.tier === 'anomalous'))) continue;
    seen.add(s.item);
    out.push(def);
  }
  return out;
}
