/**
 * The game rules for the players who are online. No I/O and no clock of its own: every call that
 * depends on time gets `now` (ms), and everything the players should hear is queued as Outgoing
 * messages for the network layer to drain and send.
 */
import { STEP_MS, stepTarget, type Dir, type PlayerView, type ServerMsg, type TileMap } from '@napoland/shared';
import type { PlayerRecord } from './storage';

/** A step may start this much early: messages sent at a steady pace arrive bunched up. */
export const STEP_TOLERANCE_MS = 40;
/** Early steps wait here, in order; one more than this is rejected. */
export const STEP_QUEUE_MAX = 2;

/** Jacket colors, all easy to tell apart in the rain and at night. */
export const JACKET_COLORS = [
  '#e4572e', // red
  '#f29e4c', // orange
  '#f1c40f', // yellow
  '#7bc950', // green
  '#2ec4b6', // teal
  '#3a86ff', // blue
  '#9b5de5', // purple
  '#f15bb5', // pink
  '#f4f1de', // white
  '#c08552', // tan
] as const;

/** The same id always gets the same color (FNV-1a hash of the id). */
export function colorFor(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return JACKET_COLORS[(h >>> 0) % JACKET_COLORS.length]!;
}

/** A message for one player (by id) or for everyone ('*'), optionally leaving one player out. */
export interface Outgoing {
  to: string;
  except?: string;
  msg: ServerMsg;
}

interface Online {
  rec: PlayerRecord;
  /** When the current step is over and the next one may start. */
  readyAt: number;
  queue: Array<{ dir: Dir; seq: number }>;
}

const view = (r: PlayerRecord): PlayerView => ({ id: r.id, name: r.name, x: r.x, y: r.y, dir: r.dir, color: r.color });

export class World {
  private readonly players = new Map<string, Online>();
  /** readyAt of players who left mid-step, so leaving and joining again cannot skip the wait. */
  private readonly resting = new Map<string, number>();
  private outbox: Outgoing[] = [];

  constructor(
    readonly map: TileMap,
    readonly stepMs = STEP_MS,
  ) {}

  get size(): number {
    return this.players.size;
  }

  has(id: string): boolean {
    return this.players.has(id);
  }

  /** A copy of an online player's record, as it should be saved. */
  get(id: string): PlayerRecord | undefined {
    const p = this.players.get(id);
    return p && { ...p.rec };
  }

  records(): PlayerRecord[] {
    return [...this.players.values()].map(p => ({ ...p.rec }));
  }

  views(): PlayerView[] {
    return [...this.players.values()].map(p => view(p.rec));
  }

  /** Puts a player in the world and tells everyone else. */
  join(rec: PlayerRecord): PlayerView {
    if (this.players.has(rec.id)) throw new Error(`player ${rec.id} is already online`);
    const r = { ...rec };
    // The map may have changed since the last visit: never start inside a wall.
    if (!this.map.walkable(r.x, r.y)) {
      const { spawn } = this.map.data;
      r.x = spawn.x;
      r.y = spawn.y;
      r.dir = spawn.dir;
    }
    const readyAt = this.resting.get(r.id) ?? -Infinity;
    this.resting.delete(r.id);
    this.players.set(r.id, { rec: r, readyAt, queue: [] });
    const player = view(r);
    this.outbox.push({ to: '*', except: r.id, msg: { t: 'join', player } });
    return player;
  }

  /** Takes a player out of the world, tells everyone else and returns the record to save. */
  leave(id: string): PlayerRecord | undefined {
    const p = this.players.get(id);
    if (!p) return undefined;
    this.players.delete(id);
    if (p.readyAt > -Infinity) this.resting.set(id, p.readyAt);
    this.outbox.push({ to: '*', except: id, msg: { t: 'leave', id } });
    return { ...p.rec };
  }

  /**
   * Walk one tile. A step starts when the previous one is (almost) over; readyAt then moves on by
   * stepMs from whichever is later, now or readyAt, so arriving early never adds up to walking
   * faster. Steps that arrive too early wait in a short queue that tick() works through; when
   * it is full the new step is refused and the queued ones still run.
   */
  step(id: string, dir: Dir, seq: number, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    if (p.queue.length === 0 && this.ready(p, now)) this.move(p, dir, seq, now);
    else if (p.queue.length < STEP_QUEUE_MAX) p.queue.push({ dir, seq });
    else this.reject(p, seq);
  }

  /** Turn in place. Only a real change is worth telling the others about. */
  face(id: string, dir: Dir): void {
    const p = this.players.get(id);
    if (!p || p.rec.dir === dir) return;
    p.rec.dir = dir;
    this.outbox.push({ to: '*', except: id, msg: { t: 'face', id, dir } });
  }

  /** Starts queued steps whose time has come. Call it often (every TICK_MS). */
  tick(now: number): void {
    for (const p of this.players.values()) if (p.queue.length) this.runQueue(p, now);
    for (const [id, readyAt] of this.resting) if (readyAt <= now) this.resting.delete(id);
  }

  /** Everything queued since the last drain, in order. */
  drain(): Outgoing[] {
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  private ready(p: Online, now: number): boolean {
    return now >= p.readyAt - STEP_TOLERANCE_MS;
  }

  private runQueue(p: Online, now: number): void {
    while (p.queue.length && this.ready(p, now)) {
      const s = p.queue.shift()!;
      this.move(p, s.dir, s.seq, now);
    }
  }

  private move(p: Online, dir: Dir, seq: number, now: number): void {
    const { x, y } = stepTarget(p.rec.x, p.rec.y, dir);
    if (!this.map.walkable(x, y)) {
      // Steps queued behind this one were planned from a tile the player never reached.
      p.queue.length = 0;
      return this.reject(p, seq);
    }
    const { id } = p.rec;
    p.rec.x = x;
    p.rec.y = y;
    p.rec.dir = dir;
    p.readyAt = Math.max(now, p.readyAt) + this.stepMs;
    this.outbox.push({ to: id, msg: { t: 'step', id, x, y, dir, seq } });
    this.outbox.push({ to: '*', except: id, msg: { t: 'step', id, x, y, dir } });
  }

  /** Refuses step `seq`, telling the mover where they really are. */
  private reject(p: Online, seq: number): void {
    const { id, x, y, dir } = p.rec;
    this.outbox.push({ to: id, msg: { t: 'reject', seq, x, y, dir } });
  }
}
