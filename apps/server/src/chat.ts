/**
 * World and local chat. The server decides who hears a message: world chat everyone online, local
 * chat whoever is on the speaker's map within LOCAL_REACH (the speaker too, both ways). Nobody hears
 * someone they block. Only signed-in players talk, at most SAYS_PER_WINDOW messages in any
 * SAY_WINDOW_MS, and words on the list are masked first. Nothing said is kept or logged.
 */
import { LOCAL_REACH, maskWords, plainWord, type ChatTo, type ServerMsg } from '@napoland/shared';
import { RollingLimit } from './limits';
import type { World } from './world';

export const SAYS_PER_WINDOW = 5;
export const SAY_WINDOW_MS = 10_000;

export interface ChatOptions {
  world: World;
  /** Everyone online, by id. */
  online: () => Iterable<string>;
  /** Who a player blocks (social.ts). */
  blocks: (id: string) => ReadonlySet<string>;
  send: (id: string, msg: ServerMsg) => void;
  words: readonly string[];
  /** ms, never going backwards: for the limit. */
  clock: () => number;
}

export class Chat {
  private readonly words: Set<string>;
  private readonly limit: RollingLimit;

  constructor(private readonly o: ChatOptions) {
    this.words = new Set(o.words.map(plainWord));
    this.limit = new RollingLimit(SAYS_PER_WINDOW, SAY_WINDOW_MS, o.clock);
  }

  say(id: string, to: ChatTo, text: string): void {
    const me = this.o.world.get(id);
    if (!me) return;
    if (me.authSub === null) return this.o.send(id, { t: 'refused', action: 'say', reason: 'sign_in_first' });
    if (!this.limit.start(id)) return this.o.send(id, { t: 'refused', action: 'say', reason: 'slow_down' });
    this.limit.finish(id, true);
    const hearers = to === 'world'
      ? [...this.o.online()]
      : this.o.world.views(me.map).filter(p => Math.hypot(p.x - me.x, p.y - me.y) <= LOCAL_REACH).map(p => p.id);
    const msg: ServerMsg = { t: 'said', to, id, name: me.name, text: maskWords(text, this.words) };
    for (const h of hearers) if (!this.o.blocks(h).has(id)) this.o.send(h, msg);
  }
}
