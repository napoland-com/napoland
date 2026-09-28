/**
 * The fireplaces of one zone (a copy of a map, world.ts) and how long each burns. Fires in town (and in
 * town's houses) are tended: they never go out. Fires out in the wilds, and in the shelters out there,
 * burn down unless someone feeds them: a well-fed fire gives energy back at the full rate, a low one only
 * glows (EMBERS), and a dead one gives nothing until someone lights it again with something that burns
 * (the numbers are in shared/energy.ts, which the client shares to draw them). Each copy of a map has
 * fires of its own: feeding one in one copy leaves the same fireplace in another as it was.
 *
 * Pure bookkeeping on game time (`now`, ms): nobody is told anything here, the World does that.
 * Fuel lives in memory only: after a restart, or when a copy opens again, the wild fires burn again at
 * a random level.
 */
import { EMBERS, FIRE_LOW_S, FIRE_MAX_S, FIRE_RADIUS, fireFull, fireHeat, type FireView, type TileMap } from '@napoland/shared';

export { EMBERS, FIRE_LOW_S, FIRE_MAX_S };

export interface Fire {
  map: TileMap;
  x: number;
  y: number;
  /** Someone in town keeps it going: it never goes out and needs nothing. */
  tended: boolean;
  /** Game time when it goes out (wild fires only). */
  outAt: number;
  /** What people call a fire in the open (map.ts); none: it goes by its room or its region. */
  name?: string;
}

export class Fires {
  private readonly list: Fire[] = [];
  /** The fires that warm each tile (y * width + x). */
  private readonly warmBy = new Map<number, Fire[]>();

  /**
   * The fireplaces of `map`. `wild`: whether they burn down (unless the map says a fire is tended); wild
   * fires start between half full and full at game time `now`, by `rng`, so they do not all go out together.
   */
  constructor(readonly map: TileMap, wild: boolean, rng: () => number, now = 0) {
    const r = Math.ceil(FIRE_RADIUS);
    for (const o of map.data.objects) {
      if (o.kind !== 'fireplace') continue;
      const tended = o.tended === true || !wild;
      const fire: Fire = { map, x: o.x, y: o.y, tended, outAt: tended ? Infinity : now + (0.5 + rng() * 0.5) * FIRE_MAX_S * 1000, ...(o.name ? { name: o.name } : {}) };
      this.list.push(fire);
      for (let y = o.y - r; y <= o.y + r; y++) for (let x = o.x - r; x <= o.x + r; x++) {
        if (!map.inside(x, y) || Math.hypot(x - o.x, y - o.y) > FIRE_RADIUS) continue;
        const k = y * map.width + x, here = this.warmBy.get(k);
        if (here) here.push(fire);
        else this.warmBy.set(k, [fire]);
      }
    }
  }

  /** The fire on tile x,y (a fireplace stands there), if any. */
  at(x: number, y: number): Fire | undefined {
    return this.list.find(f => f.x === x && f.y === y);
  }

  all(): readonly Fire[] {
    return this.list;
  }

  /** Seconds of fuel left (Infinity for a tended fire). */
  left(f: Fire, now: number): number {
    return f.tended ? Infinity : Math.max(0, (f.outAt - now) / 1000);
  }

  /** How warm one fire is now: 1 well fed, EMBERS low, 0 out. */
  heat(f: Fire, now: number): number {
    return fireHeat(f.tended ? null : this.left(f, now));
  }

  /** How warm tile x,y is: the best of the fires that reach it, 0 where none does or all are out. */
  warmth(x: number, y: number, now: number): number {
    if (!this.map.inside(x, y)) return 0;
    let best = 0;
    for (const f of this.warmBy.get(y * this.map.width + x) ?? []) best = Math.max(best, this.heat(f, now));
    return best;
  }

  /** Burns `seconds` more, up to FIRE_MAX_S; a dead fire lights again. False when it is already full (fireFull). */
  feed(f: Fire, seconds: number, now: number): boolean {
    if (f.tended || fireFull(this.left(f, now))) return false;
    f.outAt = Math.min(now + FIRE_MAX_S * 1000, Math.max(now, f.outAt) + seconds * 1000);
    return true;
  }

  /** Puts a wild fire out now (a condition: it went out overnight); someone has to light it again. */
  douse(f: Fire, now: number): void {
    if (!f.tended) f.outAt = Math.min(f.outAt, now);
  }

  view(f: Fire, now: number): FireView {
    return { x: f.x, y: f.y, left: f.tended ? null : Math.round(this.left(f, now)) };
  }

  views(now: number): FireView[] {
    return this.list.map(f => this.view(f, now));
  }
}
