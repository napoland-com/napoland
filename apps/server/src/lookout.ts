/**
 * The fire lookouts' lamps (roadmap/lookout-tower.md; the rules are packages/shared/src/lookout.ts): each
 * zone's own, like its fires, and like them in memory only (after a restart they are out until someone
 * feeds them). A lamp burns what it was fed down on the game clock; while it burns, its beam sweeps the
 * woods by the wall clock, which every client follows too, so nothing about the beam is ever sent.
 * The World asks it where the beam is and tells it what was fed; who is up a lookout is the World's.
 */
import { LAMP_MAX_S, LAMP_PER_S, inBeam, type LampView, type MapObject, type TileMap } from '@napoland/shared';

export type Lookout = Extract<MapObject, { kind: 'lookout' }>;

export interface Lamp {
  /** The lookout it hangs in, on its map. */
  readonly o: Lookout;
  readonly map: TileMap;
  /** Game time (ms) when it burns out: at or before now, it is out. */
  until: number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export class Lamps {
  /** Each zone's lamps, by zone key, made (out) the first time the zone is asked about. */
  private readonly byZone = new Map<string, Lamp[]>();

  /** The lamps of a zone (a copy of `map`): one for each lookout on the map. */
  in(zone: string, map: TileMap): Lamp[] {
    let list = this.byZone.get(zone);
    if (!list) {
      list = map.data.objects.flatMap((o): Lamp[] => (o.kind === 'lookout' ? [{ o, map, until: -Infinity }] : []));
      this.byZone.set(zone, list);
    }
    return list;
  }

  /** The lamp of the lookout whose corner is x,y, in a zone. */
  at(zone: string, map: TileMap, x: number, y: number): Lamp | undefined {
    return this.in(zone, map).find(l => l.o.x === x && l.o.y === y);
  }

  /** Seconds it burns on from `now` (0: out). */
  left(l: Lamp, now: number): number {
    return Math.max(0, (l.until - now) / 1000);
  }

  /**
   * Feeds it up to `count` of what it burns, one by one while it is not full (the last may top it up past
   * what it holds, as at a fire): how many it took.
   */
  feed(l: Lamp, count: number, now: number): number {
    let fed = 0;
    while (fed < count && this.left(l, now) < LAMP_MAX_S - 1) {
      l.until = Math.max(l.until, now) + LAMP_PER_S * 1000;
      fed++;
    }
    return fed;
  }

  view(l: Lamp, now: number): LampView {
    return { x: l.o.x, y: l.o.y, left: round1(this.left(l, now)) };
  }

  views(zone: string, map: TileMap, now: number): LampView[] {
    return this.in(zone, map).map(l => this.view(l, now));
  }

  /**
   * Is tile x,y of a zone under a burning lamp's beam at this moment (`wall`: ms since the epoch, which sets
   * where the beam points)? Asked for every player on every tick: a zone without a lookout keeps an empty list.
   */
  beamOver(zone: string, map: TileMap, x: number, y: number, now: number, wall: number): boolean {
    return this.in(zone, map).some(l => l.until > now && inBeam(l.o, x, y, wall));
  }

  /**
   * The lamps that went out between `since` and `now`, with their zone: everyone there hears it. A zone
   * nobody keeps asking about keeps its lamps as they were until it is asked again.
   */
  outBetween(since: number, now: number): Array<{ zone: string; lamp: Lamp }> {
    const out: Array<{ zone: string; lamp: Lamp }> = [];
    for (const [zone, list] of this.byZone) for (const lamp of list) if (lamp.until > since && lamp.until <= now) out.push({ zone, lamp });
    return out;
  }

  /** A copy of a map closed: its lamps go with it, as its fires do. */
  forget(zone: string): void {
    this.byZone.delete(zone);
  }
}
