/**
 * Calls without words. A player sings a short note (here I am, come here, thank you) and the server
 * decides who hears it: everyone on the caller's map within CALL_REACH, the caller too, each told the
 * tile it came from so their game plays it from that side. There are no words, so guests call as well;
 * someone who blocks the caller does not hear it, as they would not hear them in chat. At most one call
 * in any CALL_EVERY_MS. Nothing about a call is kept or logged.
 */
import { CALL_EVERY_MS, CALL_REACH, type CallKind, type ServerMsg } from '@napoland/shared';
import { RollingLimit } from './limits';
import type { World } from './world';

export interface CallsOptions {
  world: World;
  /** Who a player blocks (social.ts). */
  blocks: (id: string) => ReadonlySet<string>;
  send: (id: string, msg: ServerMsg) => void;
  /** ms, never going backwards: for the limit. */
  clock: () => number;
}

export class Calls {
  private readonly limit: RollingLimit;

  constructor(private readonly o: CallsOptions) {
    this.limit = new RollingLimit(1, CALL_EVERY_MS, o.clock);
  }

  call(id: string, kind: CallKind): void {
    // The limit comes before the record is looked up: a client that floods calls costs next to nothing.
    if (!this.o.world.has(id)) return;
    if (!this.limit.start(id)) return this.o.send(id, { t: 'refused', action: 'call', reason: 'slow_down' });
    this.limit.finish(id, true);
    const me = this.o.world.get(id)!;
    const msg: ServerMsg = { t: 'called', id, kind, x: me.x, y: me.y };
    for (const p of this.o.world.views(me.map)) {
      if (Math.hypot(p.x - me.x, p.y - me.y) > CALL_REACH) continue;
      if (p.id !== id && this.o.blocks(p.id).has(id)) continue;
      this.o.send(p.id, msg);
    }
  }
}
