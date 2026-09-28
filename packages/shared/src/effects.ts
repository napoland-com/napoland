/**
 * Effects: what a consumable gives for a while once it is used (content/items.json, `use.resist` and
 * `use.lasts`): a hand warmer, cold resistance +40% for 5 minutes; a rad tablet, radiation +40%. They go
 * into your resistances on top of what you wear, under the same cap (gear.ts, RESIST_MAX), so nothing
 * makes anyone immune. Each runs on its own clock, by item: a second of the same while the first still
 * works starts its time again and never adds up; two different ones both count.
 *
 * The server keeps them (by player, on the game clock, so they run on while you are away or on another
 * map) and tells each player theirs with the body of every energy message (BodyView.effects); the
 * client counts them down between reports, as it does energy.
 */
import type { Element, Resist } from './gear';
import type { ItemDef } from './items';

/** An effect working on you: the item that gives it, and the seconds left of it when told. */
export interface EffectView {
  item: string;
  left: number;
}

/** What the effects that still work resist together, element by element: each item once, however they were told. */
export function effectResist(effects: readonly EffectView[], items: Map<string, ItemDef>): Partial<Resist> {
  const out: Partial<Resist> = {};
  const seen = new Set<string>();
  for (const f of effects) {
    if (!(f.left > 0) || seen.has(f.item)) continue;
    seen.add(f.item);
    for (const [e, v] of Object.entries(items.get(f.item)?.use?.resist ?? {})) out[e as Element] = (out[e as Element] ?? 0) + (v ?? 0);
  }
  return out;
}

/** The effects told `dt` seconds ago, counted down to now: the ones still working. */
export function effectsAfter(effects: readonly EffectView[] | undefined, dt: number): EffectView[] {
  return (effects ?? []).flatMap(f => (f.left - dt > 0 ? [{ item: f.item, left: f.left - dt }] : []));
}
