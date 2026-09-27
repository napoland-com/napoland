/**
 * Feats: small lasting perks earned by how you play, not bought with XP. The server counts what you
 * do out there (steps in the rain, steps at night, steps with a heavy bag, fires fed); when a count
 * reaches a feat's mark, the feat is yours for good and makes the matching hardship a little lighter.
 *
 * Charms (items.ts) change the same things while they are in your bag. Both are factors on one set
 * of Mods, so they add up the same way.
 */

/** Factors on what wears you down: 1 changes nothing, below 1 makes it gentler, above 1 stronger. */
export interface Mods {
  /** How fast rain soaks you. */
  wetting: number;
  /** How heavy your bag feels. */
  load: number;
  /** How often something clings to your back at night. */
  hitch: number;
  /** How fast a fire gives energy back. */
  warmth: number;
}

export const NO_MODS: Readonly<Mods> = { wetting: 1, load: 1, hitch: 1, warmth: 1 };

/** What the server counts for feats. */
export type Stat = 'rainSteps' | 'nightSteps' | 'heavySteps' | 'fed';
export type Stats = Partial<Record<Stat, number>>;
export const STATS: readonly Stat[] = ['rainSteps', 'nightSteps', 'heavySteps', 'fed'];

export interface Feat {
  id: string;
  name: string;
  /** What earned it and what it does, in plain words. */
  text: string;
  stat: Stat;
  need: number;
  mods: Partial<Mods>;
}

/** A bag at least this heavy (load) counts toward the pack mule. */
export const HEAVY_LOAD = 0.75;

export const FEATS: readonly Feat[] = [
  { id: 'rain-walker', name: 'Rain walker', text: '1,500 steps out in the rain. Rain soaks you 20% slower.', stat: 'rainSteps', need: 1500, mods: { wetting: 0.8 } },
  { id: 'night-owl', name: 'Night owl', text: '1,000 steps out in the dark. Hitchhikers find you half as often.', stat: 'nightSteps', need: 1000, mods: { hitch: 0.5 } },
  { id: 'pack-mule', name: 'Pack mule', text: '800 steps out with a heavy bag. What you carry feels 15% lighter.', stat: 'heavySteps', need: 800, mods: { load: 0.85 } },
  { id: 'fire-keeper', name: 'Fire keeper', text: '20 fires fed. Fires warm you 15% faster.', stat: 'fed', need: 20, mods: { warmth: 1.15 } },
];

/** The feats these counts have earned, by id, in FEATS order. */
export function featsOf(stats: Stats): string[] {
  return FEATS.filter(f => (stats[f.stat] ?? 0) >= f.need).map(f => f.id);
}

/** Every factor of the earned feats and the charms carried, multiplied together. */
export function modsOf(stats: Stats, charms: ReadonlyArray<Partial<Mods>> = []): Mods {
  const out: Mods = { ...NO_MODS };
  const apply = (m: Partial<Mods>) => {
    for (const k of Object.keys(out) as Array<keyof Mods>) if (typeof m[k] === 'number' && Number.isFinite(m[k])) out[k] *= m[k];
  };
  for (const f of FEATS) if ((stats[f.stat] ?? 0) >= f.need) apply(f.mods);
  for (const c of charms) apply(c);
  return out;
}
