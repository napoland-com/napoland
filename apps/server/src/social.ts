/**
 * Friends, friend requests, blocks, private messages and reports. Unlike the World, these involve
 * players who are offline, so every rule reads and writes storage; net.ts hands each message over
 * and says who is online where.
 *
 * - A request goes to someone by id (their name tag) or by name. If they asked you already, you are
 *   friends at once. Nobody can be asked who turned requests off or who blocked you, and both get
 *   the same answer, so nobody learns who blocked them.
 * - Messages go between friends only, and are kept until read: reading them deletes them.
 * - Blocking someone ends a friendship and any request either way, and keeps them from asking again.
 * - A report is kept for the maintainers, with what was written as the reporter quoted it.
 * - On a server with sign-in, all of it needs a real person behind it: a guest is refused every
 *   action (sign_in_first; a report needs a reporter who answers for it), and nobody can ask a guest
 *   to be friends. A guest can still be blocked and reported.
 *
 * Whoever a change touches hears their friends list again (if online); the list says which friends
 * are online, and on which map. Who each player online is friends with is kept at hand too, for the
 * World (a friend's street is one they may move their cabin to).
 */
import type { PersonView, Refusal, RefusedAction, ReportReason, ServerMsg } from '@napoland/shared';
import { RollingLimit } from './limits';
import { log } from './log';
import type { LinkRecord, Storage } from './storage';

/** Requests one player may have waiting at once. */
export const MAX_OUTGOING = 20;
/** Unread messages one friend may leave another. */
export const MAX_UNREAD = 50;
/** Messages a player may send in any minute, and reports in any hour. */
export const TELLS_PER_MINUTE = 20;
export const REPORTS_PER_HOUR = 10;

export type SocialMsg =
  | { t: 'befriend'; id?: string; name?: string }
  | { t: 'answer'; id: string; yes: boolean }
  | { t: 'unfriend'; id: string }
  | { t: 'tell'; to: string; text: string }
  | { t: 'read'; from: string }
  | { t: 'block'; id: string; on: boolean }
  | { t: 'report'; id: string; reason: ReportReason; quote?: string }
  | { t: 'requests'; off: boolean }
  | { t: 'friends' };

export interface SocialOptions {
  storage: Storage;
  /** The map a player is on, if they are online. */
  where: (id: string) => string | undefined;
  /** A message to one player, if they are online. */
  send: (id: string, msg: ServerMsg) => void;
  /** ms, never going backwards: for the limits. */
  clock: () => number;
  /** Players sign in on this server: one nobody signed in with is a guest, who cannot have friends. */
  guests?: boolean;
  /** Whether a player online plays as a guest: nothing among friends is sent to them. */
  isGuest?: (id: string) => boolean;
}

const has = (links: LinkRecord[], from: string, to: string, kind: LinkRecord['kind']) => links.some(l => l.from === from && l.to === to && l.kind === kind);

export class Social {
  private readonly tellLimit: RollingLimit;
  private readonly reportLimit: RollingLimit;
  /** Who each player online blocks, kept at hand: chat asks it for every message (chat.ts). */
  private readonly blocking = new Map<string, Set<string>>();
  /** Who each player online is friends with, kept at hand the same way. */
  private readonly befriended = new Map<string, Set<string>>();

  constructor(private readonly o: SocialOptions) {
    this.tellLimit = new RollingLimit(TELLS_PER_MINUTE, 60_000, o.clock);
    this.reportLimit = new RollingLimit(REPORTS_PER_HOUR, 3_600_000, o.clock);
  }

  /** Who `id` blocks, while they are online (nobody before joined() has run). */
  blocks(id: string): ReadonlySet<string> {
    return this.blocking.get(id) ?? new Set();
  }

  /** Who `id` is friends with, while they are online (nobody before joined() has run, and nobody for a guest). */
  friends(id: string): ReadonlySet<string> {
    return this.befriended.get(id) ?? new Set();
  }

  /** A player left: nothing of theirs is kept at hand. */
  left(id: string): void {
    this.blocking.delete(id);
    this.befriended.delete(id);
  }

  /**
   * A player came online: their list, and what is waiting for them. A guest gets neither (it all waits
   * for sign-in), but whoever they block stays unheard in chat.
   */
  async joined(id: string, guest = false): Promise<void> {
    if (guest) {
      const links = await this.o.storage.linksOf(id);
      this.blocking.set(id, new Set(links.filter(l => l.from === id && l.kind === 'block').map(l => l.to)));
      return;
    }
    await this.list(id);
    const tells = await this.o.storage.tellsTo(id);
    this.o.send(id, { t: 'tells', tells: tells.map(t => ({ from: t.from, name: t.fromName, text: t.text, at: t.at })) });
  }

  /** `guest`: `me` plays as a guest, as it was when the message came in. */
  async handle(me: string, msg: SocialMsg, guest = false): Promise<void> {
    if (guest) return this.refuse(me, msg.t, 'sign_in_first');
    const s = this.o.storage;
    switch (msg.t) {
      case 'friends':
        return this.list(me);
      case 'requests':
        await s.setRequestsOff(me, msg.off);
        return this.list(me);
      case 'befriend':
        return this.befriend(me, msg);
      case 'answer': {
        const links = await s.linksOf(me);
        if (!has(links, msg.id, me, 'request')) return this.list(me);
        await s.setLink(msg.id, me, 'request', false);
        if (msg.yes) await this.link(me, msg.id);
        return this.lists(me, msg.id);
      }
      case 'unfriend':
        await this.unlink(me, msg.id);
        return this.lists(me, msg.id);
      case 'block':
        if (msg.id === me || !(await s.findPerson({ id: msg.id }))) return;
        if (msg.on) await this.unlink(me, msg.id);
        await s.setLink(me, msg.id, 'block', msg.on);
        if (msg.on) this.blocking.set(me, new Set([...this.blocks(me), msg.id]));
        else this.blocking.get(me)?.delete(msg.id);
        return this.lists(me, msg.id);
      case 'tell':
        return this.tell(me, msg.to, msg.text);
      case 'read':
        return s.deleteTells(me, msg.from);
      case 'report': {
        if (msg.id === me || !(await s.findPerson({ id: msg.id })) || !this.reportLimit.start(me)) return;
        try {
          await s.addReport({ reporter: me, reported: msg.id, reason: msg.reason, quote: msg.quote ?? null, at: Date.now() });
          this.reportLimit.finish(me, true);
        } catch (err) {
          this.reportLimit.finish(me, false);
          throw err;
        }
        // Who and why, never what was written.
        log.info('player reported', { reporter: me, reported: msg.id, reason: msg.reason });
        return;
      }
    }
  }

  private async befriend(me: string, msg: { id?: string; name?: string }): Promise<void> {
    const s = this.o.storage;
    const them = msg.id ? await s.findPerson({ id: msg.id }) : msg.name ? await s.findPerson({ name: msg.name }) : null;
    if (!them || them.id === me) return this.refuse(me, 'befriend', 'unknown_player');
    // They could never answer: friends wait until they sign in.
    if (this.o.guests && !them.signedIn) return this.refuse(me, 'befriend', 'guest');
    const links = await s.linksOf(me);
    if (has(links, me, them.id, 'friend')) return this.list(me);
    if (has(links, me, them.id, 'block')) return this.refuse(me, 'befriend', 'you_blocked');
    if (has(links, them.id, me, 'block')) return this.refuse(me, 'befriend', 'requests_off');
    // They asked first: that is a yes both ways.
    if (has(links, them.id, me, 'request')) {
      await s.setLink(them.id, me, 'request', false);
      await this.link(me, them.id);
      return this.lists(me, them.id);
    }
    if (them.requestsOff) return this.refuse(me, 'befriend', 'requests_off');
    if (has(links, me, them.id, 'request')) return this.list(me);
    if (links.filter(l => l.from === me && l.kind === 'request').length >= MAX_OUTGOING) return this.refuse(me, 'befriend', 'too_many');
    await s.setLink(me, them.id, 'request', true);
    return this.lists(me, them.id);
  }

  private async tell(me: string, to: string, text: string): Promise<void> {
    const s = this.o.storage;
    if (!has(await s.linksOf(me), me, to, 'friend')) return this.refuse(me, 'tell', 'not_friends');
    if (!this.tellLimit.start(me)) return this.refuse(me, 'tell', 'slow_down');
    let sent = false;
    try {
      if ((await s.tellsTo(to)).filter(t => t.from === me).length >= MAX_UNREAD) return this.refuse(me, 'tell', 'too_many');
      const at = Date.now();
      await s.addTell({ from: me, to, text, at });
      sent = true;
      const sender = await s.findPerson({ id: me });
      // (A friend who plays as a guest again reads it once signed in.)
      if (!this.o.isGuest?.(to)) this.o.send(to, { t: 'tells', tells: [{ from: me, name: sender?.name ?? '', text, at }] });
    } finally {
      this.tellLimit.finish(me, sent);
    }
  }

  private async link(a: string, b: string): Promise<void> {
    await this.o.storage.setLink(a, b, 'friend', true);
    await this.o.storage.setLink(b, a, 'friend', true);
  }

  /** Ends a friendship and any request, either way. */
  private async unlink(a: string, b: string): Promise<void> {
    for (const [x, y] of [[a, b], [b, a]] as const) {
      await this.o.storage.setLink(x, y, 'friend', false);
      await this.o.storage.setLink(x, y, 'request', false);
    }
  }

  private refuse(me: string, action: RefusedAction, reason: Refusal): void {
    this.o.send(me, { t: 'refused', action, reason });
  }

  private async lists(a: string, b: string): Promise<void> {
    await this.list(a);
    // (Someone blocking a guest changes nothing a guest could see.)
    if (this.o.where(b) !== undefined && !this.o.isGuest?.(b)) await this.list(b);
  }

  /** A player's friends list, whole, if they are online. */
  private async list(id: string): Promise<void> {
    if (this.o.where(id) === undefined) return;
    const s = this.o.storage;
    const [links, me] = [await s.linksOf(id), await s.findPerson({ id })];
    const out = (kind: LinkRecord['kind']): PersonView[] => links.filter(l => l.from === id && l.kind === kind).map(l => ({ id: l.to, name: l.toName }));
    // The list is read whole here anyway: the blocks and friends at hand follow it.
    this.blocking.set(id, new Set(out('block').map(p => p.id)));
    this.befriended.set(id, new Set(out('friend').map(p => p.id)));
    this.o.send(id, {
      t: 'friends',
      friends: out('friend').map(p => ({ ...p, map: this.o.where(p.id) ?? null })),
      incoming: links.filter(l => l.to === id && l.kind === 'request').map(l => ({ id: l.from, name: l.fromName })),
      outgoing: out('request'),
      blocked: out('block'),
      requestsOff: me?.requestsOff ?? false,
    });
  }
}
