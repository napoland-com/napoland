/**
 * The field radio, as this client plays it. Out in the wilds it crackles, louder the nearer you are to
 * something strange lying out there (what the tool `senses`, content/items.json: a shard, a strange
 * object, copper wire on an aurora night), among the finds the game already knows on this map: the
 * nearest one decides. It never shows a direction or a place and never pans: you walk and listen,
 * hotter and colder. Elsewhere (town, rooms) it gives only the hum, which is everywhere; each of the
 * Tower's pulses (the region you are in turning restless) comes through as one burst of static; in a
 * storm it goes silent. Its button in the bag's header turns it on and off, and this browser keeps the
 * choice, like the sound setting.
 *
 * Plain logic with no sound in it, so it is tested: main.ts keeps what it listens for, soundscape.ts
 * turns it into loops and shots, and sound.ts makes the noise.
 */
import type { FindView, ItemDef, MapKind, Senses, Weather } from '@napoland/shared';
import type { Items } from './items';

/** Your radio: the first tool you own that listens, if you have one. */
export function radioOf(tools: readonly string[], items: Items): (ItemDef & { senses: Senses }) | undefined {
  for (const t of tools) {
    const def = items.get(t);
    if (def.kind === 'tool' && def.senses) return def as ItemDef & { senses: Senses };
  }
  return undefined;
}

/**
 * Where the finds the radio hears lie on this map in this weather: what it listens for, and what it
 * listens for only on aurora nights (copper) only then. Asked when the finds or the weather change, so
 * a frame only measures distances.
 */
export function heardFinds(finds: Iterable<FindView>, senses: Senses, weather: Weather): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (const f of finds) if (senses.finds.some(s => s.item === f.item && (s.when !== 'aurora' || weather === 'aurora'))) out.push({ x: f.x, y: f.y });
  return out;
}

/** How far the nearest of `spots` is from x,y (tiles, center to center); Infinity when there is none. Every frame, so it allocates nothing. */
export function nearest(spots: ReadonlyArray<{ x: number; y: number }>, x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < spots.length; i++) best = Math.min(best, Math.hypot(spots[i]!.x - x, spots[i]!.y - y));
  return best;
}

/**
 * How loud the crackle is at the edges of its two bands: loud from LOUD_EDGE (at the loud reach) up to
 * 1 right on it; faint from FAINT_EDGE (just outside the loud reach) down to FAINT_END at the faint one.
 * The step between the bands is on purpose: crossing into the loud reach is how you hear you are close.
 */
export const LOUD_EDGE = 0.6;
export const FAINT_EDGE = 0.3;
export const FAINT_END = 0.08;

/** How loud the radio crackles with the nearest thing it hears `d` tiles away: loud within `loud`, faint within `faint`, nothing past that. */
export function crackleAt(d: number, s: Pick<Senses, 'loud' | 'faint'>): number {
  if (!(d <= s.faint)) return 0;
  if (d <= s.loud) return LOUD_EDGE + (1 - LOUD_EDGE) * (1 - Math.max(0, d) / s.loud);
  return FAINT_END + (FAINT_EDGE - FAINT_END) * ((s.faint - d) / (s.faint - s.loud));
}

/** The radio this frame, as the soundscape hears it (null: you have none): on or off, what it listens for, and how far the nearest thing it hears is. */
export interface RadioScene {
  on: boolean;
  senses: Pick<Senses, 'loud' | 'faint'>;
  near: number;
}

/** Whether the radio plays at all: it is on, and no storm blows over the region you are in. */
export function radioHears(r: RadioScene | null, storm: boolean): boolean {
  return !!r?.on && !storm;
}

/** How loud the radio crackles now: out in the wilds only, by the nearest thing it hears. */
export function radioCrackle(r: RadioScene | null, kind: MapKind, storm: boolean): number {
  return radioHears(r, storm) && kind === 'wilds' ? crackleAt(r!.near, r!.senses) : 0;
}

/** How loud the hum is now: the same everywhere, whenever the radio plays. */
export function radioHum(r: RadioScene | null, storm: boolean): number {
  return radioHears(r, storm) ? 1 : 0;
}
