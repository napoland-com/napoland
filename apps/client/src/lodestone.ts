/**
 * The lodestone quirk (gear.ts): while a shard lies within LODESTONE_TILES of you, the piece tugs now and
 * then, a short soft pulse on the status panel and a faint sound, and never says which way: no arrow, no
 * side, nothing on the screen's edge. Only your own game feels it, from the finds it was told of (the
 * server has no part in it). Plain logic, tested without a page.
 */
import { LODESTONE_TILES, type FindView } from '@napoland/shared';
import type { Items } from './items';

/** While a shard stays near, the piece tugs again this often (ms). */
export const TUG_EVERY_MS = 5000;

/** Does a shard (anything the Old Stone takes: a shard, a live shard) lie within LODESTONE_TILES of tile x,y? */
export function shardNear(finds: Iterable<FindView>, items: Items, x: number, y: number): boolean {
  for (const f of finds) if ((items.get(f.item).charge ?? 0) > 0 && Math.hypot(f.x - x, f.y - y) <= LODESTONE_TILES) return true;
  return false;
}

export class Lodestone {
  private nextAt = -Infinity;

  /** Whether it tugs now (ms): at once when a shard comes near after a while, then every TUG_EVERY_MS while one stays. */
  update(near: boolean, now: number): boolean {
    if (!near || now < this.nextAt) return false;
    this.nextAt = now + TUG_EVERY_MS;
    return true;
  }
}
