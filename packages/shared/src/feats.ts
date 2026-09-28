/**
 * Feats: small lasting perks earned by how you play, not bought with XP. The server counts what you
 * do out there (steps in the rain, in the dark, with a heavy bag and far from home, fires fed, pieces
 * mended, finds picked up); each feat climbs five ranks as its count grows, and every rank makes the
 * matching hardship a little lighter for good. Rank 1 comes in the first hours, rank 5 after months.
 *
 * A rank is never stored: it follows from the count, with the one table below (FEATS), so the
 * server and the client always agree, and counts kept from before ranks existed are worth their rank
 * the moment a player joins.
 *
 * Charms (items.ts) change the same things while they are in your bag. Both go into one set of Mods,
 * so they add up the same way.
 */
import type { TileMap } from './map';
import type { Weather } from './protocol';

/**
 * What wears you down, and what helps, as one set of values. Most are factors (1 changes nothing,
 * below 1 makes it gentler, above 1 stronger); `double` is a chance (0 never).
 */
export interface Mods {
  /** How fast rain soaks you. */
  wetting: number;
  /** How heavy your bag feels. */
  load: number;
  /** How often something clings to your back at night. */
  hitch: number;
  /** How fast a fire gives energy back. */
  warmth: number;
  /** How fast what you wear wears down out in the wilds. */
  wear: number;
  /** How hard the drain is FAR_STEPS or more from home. */
  farDrain: number;
  /** The chance that a find out in the wilds comes up double. */
  double: number;
}

export const NO_MODS: Readonly<Mods> = { wetting: 1, load: 1, hitch: 1, warmth: 1, wear: 1, farDrain: 1, double: 0 };
/** Every value in Mods; the chances among them add up as separate tries, the rest multiply. */
export const MODS: readonly (keyof Mods)[] = ['wetting', 'load', 'hitch', 'warmth', 'wear', 'farDrain', 'double'];
export const CHANCES: readonly (keyof Mods)[] = ['double'];

/** Does value `v` of Mods key `k` change anything (a charm that does not is a mistake in the content)? */
export function modChanges(k: keyof Mods, v: unknown): boolean {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return false;
  return CHANCES.includes(k) ? v <= 1 : v !== 1;
}

/** What the server counts for feats. */
export type Stat = 'rainSteps' | 'nightSteps' | 'heavySteps' | 'farSteps' | 'fed' | 'mended' | 'found';
export type Stats = Partial<Record<Stat, number>>;
export const STATS: readonly Stat[] = ['rainSteps', 'nightSteps', 'heavySteps', 'farSteps', 'fed', 'mended', 'found'];
/** The counts a step out in the wilds may add to (stepCounts). */
export const STEP_STATS = ['rainSteps', 'nightSteps', 'heavySteps', 'farSteps'] as const satisfies readonly Stat[];

/** A bag at least this heavy (load) counts toward the pack mule. */
export const HEAVY_LOAD = 0.75;
/** Walking steps from home where the pathfinder's steps count, and where its gentler drain holds (energy.ts). */
export const FAR_STEPS = 85;
/** Every feat has this many ranks. */
export const RANKS = 5;

/** One rank of a feat: the count that reaches it, and how much it does, as a share (0.2 is 20%). */
export interface Rank {
  need: number;
  by: number;
}

export interface Feat {
  id: string;
  name: string;
  stat: Stat;
  /** What is counted, in plain words: "3,212 of 5,000 steps in the rain". */
  counts: string;
  /** The value of Mods it changes, and which way: less of it, more of it, or a chance of it. */
  mod: keyof Mods;
  way: 'less' | 'more' | 'chance';
  /** What a rank does, in plain words; {n} is its share ("Rain soaks you {n} slower" for "Rain soaks you 20% slower"). */
  does: string;
  /** Rank 1 first; RANKS of them, each needing more and doing more than the one before. */
  ranks: readonly Rank[];
}

const ranks = (need: readonly number[], by: readonly number[]): Rank[] => need.map((n, i) => ({ need: n, by: by[i]! }));

/**
 * Every feat and its ranks: the counts that reach them, and what each does. Rank 1 of the first four
 * is the feat as it was before there were ranks, at the same count, so nobody lost what they earned.
 */
export const FEATS: readonly Feat[] = [
  {
    id: 'rain-walker', name: 'Rain walker', stat: 'rainSteps', counts: 'steps in the rain', mod: 'wetting', way: 'less', does: 'Rain soaks you {n} slower',
    ranks: ranks([1_500, 5_000, 15_000, 40_000, 100_000], [0.2, 0.3, 0.4, 0.45, 0.5]),
  },
  {
    id: 'night-owl', name: 'Night owl', stat: 'nightSteps', counts: 'steps in the dark', mod: 'hitch', way: 'less', does: 'Hitchhikers find you {n} less often',
    ranks: ranks([1_000, 3_500, 10_000, 25_000, 60_000], [0.5, 0.6, 0.7, 0.75, 0.8]),
  },
  {
    id: 'pack-mule', name: 'Pack mule', stat: 'heavySteps', counts: 'steps with a heavy bag', mod: 'load', way: 'less', does: 'What you carry feels {n} lighter',
    ranks: ranks([800, 2_500, 8_000, 20_000, 50_000], [0.15, 0.2, 0.25, 0.28, 0.3]),
  },
  {
    id: 'fire-keeper', name: 'Fire keeper', stat: 'fed', counts: 'fires fed', mod: 'warmth', way: 'more', does: 'Fires warm you {n} faster',
    ranks: ranks([20, 60, 200, 500, 1_200], [0.15, 0.2, 0.25, 0.28, 0.3]),
  },
  {
    id: 'mender', name: 'Mender', stat: 'mended', counts: 'pieces mended', mod: 'wear', way: 'less', does: 'Gear wears {n} slower out there',
    ranks: ranks([5, 15, 40, 100, 250], [0.05, 0.1, 0.15, 0.2, 0.25]),
  },
  {
    id: 'forager', name: 'Forager', stat: 'found', counts: 'finds picked up', mod: 'double', way: 'chance', does: 'Finds come up double {n} of the time',
    ranks: ranks([200, 700, 2_000, 5_000, 12_000], [0.05, 0.08, 0.11, 0.13, 0.15]),
  },
  {
    id: 'pathfinder', name: 'Pathfinder', stat: 'farSteps', counts: `steps ${FAR_STEPS} or more from home`, mod: 'farDrain', way: 'less',
    does: `${FAR_STEPS} steps or more from home, you tire {n} slower`,
    ranks: ranks([500, 1_500, 5_000, 12_000, 30_000], [0.03, 0.06, 0.09, 0.12, 0.15]),
  },
];

const BY_STAT = new Map(FEATS.map(f => [f.stat, f]));

/** The feat a count is for. */
export function featOf(stat: Stat): Feat | undefined {
  return BY_STAT.get(stat);
}

/** The rank `count` reaches: 0 before the first, up to RANKS. */
export function rankOf(feat: Feat, count: number): number {
  let rank = 0;
  while (rank < feat.ranks.length && count >= feat.ranks[rank]!.need) rank++;
  return rank;
}

/** What rank `rank` (from 1) of a feat puts into Mods: a factor below or above 1, or a chance. */
export function rankValue(feat: Feat, rank: number): number {
  const by = feat.ranks[rank - 1]?.by ?? 0;
  return feat.way === 'chance' ? by : feat.way === 'more' ? 1 + by : 1 - by;
}

/** What rank `rank` (from 1) of a feat does, in plain words, without a full stop: "Rain soaks you 30% slower". */
export function rankText(feat: Feat, rank: number): string {
  const by = feat.ranks[rank - 1]?.by ?? 0;
  return feat.does.replace('{n}', `${Math.round(by * 1000) / 10}%`);
}

/** Puts one value into Mods: a chance adds up with the ones there as a separate try, a factor multiplies. */
function put(out: Mods, k: keyof Mods, v: number): void {
  if (!Number.isFinite(v)) return;
  out[k] = CHANCES.includes(k) ? 1 - (1 - out[k]) * (1 - Math.min(1, Math.max(0, v))) : out[k] * v;
}

/** Every rank reached and every charm carried, in one set of Mods. */
export function modsOf(stats: Stats, charms: ReadonlyArray<Partial<Mods>> = []): Mods {
  const out: Mods = { ...NO_MODS };
  for (const f of FEATS) {
    const rank = rankOf(f, stats[f.stat] ?? 0);
    if (rank) put(out, f.mod, rankValue(f, rank));
  }
  for (const c of charms) {
    for (const k of MODS) {
      const v = c[k];
      if (typeof v === 'number') put(out, k, v);
    }
  }
  return out;
}

/**
 * Does a step onto tile x,y count toward `stat`? Only out in the wilds: in the rain, in the dark, with
 * a bag at least HEAVY_LOAD heavy (what it really weighs, before charms and feats make it feel lighter), or
 * FAR_STEPS or more from home.
 */
export function stepCounts(stat: (typeof STEP_STATS)[number], map: TileMap, x: number, y: number, weather: Weather, load: number): boolean {
  if (map.data.kind !== 'wilds') return false;
  switch (stat) {
    case 'rainSteps': return weather === 'rain';
    case 'nightSteps': return weather === 'night' || weather === 'aurora';
    case 'heavySteps': return load >= HEAVY_LOAD;
    case 'farSteps': return map.homeSteps(x, y) >= FAR_STEPS;
  }
}
