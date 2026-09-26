/**
 * Limits per client address: which address a request comes from, and how many new players an
 * address may create in a rolling window. Plain logic without I/O; net.ts applies it.
 */
import type { IncomingMessage } from 'node:http';

/**
 * The address a request comes from. Behind our own proxy (trustProxy) that is the last
 * X-Forwarded-For entry, the one the proxy added: the entries before it come from the client and
 * can say anything. Without trustProxy the header is never read, since anyone could send it.
 */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const header = req.headers['x-forwarded-for'];
    const last = (Array.isArray(header) ? header.join(',') : header)?.split(',').at(-1)?.trim();
    if (last) return normalizeIp(last);
  }
  return normalizeIp(req.socket.remoteAddress ?? '');
}

/** A dual-stack socket shows an IPv4 client as "::ffff:1.2.3.4": the same client as "1.2.3.4". */
function normalizeIp(ip: string): string {
  const v4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return v4 ? v4[1]! : ip.toLowerCase();
}

/**
 * At most `max` successes per key in any window of `windowMs`. An attempt holds a place while it
 * runs, so a burst of parallel attempts cannot get past the limit; only successes are remembered.
 */
export class RollingLimit {
  /** Times of the recent successes of each key, oldest first. */
  private readonly successes = new Map<string, number[]>();
  private readonly running = new Map<string, number>();
  private sweptAt: number;

  /** `now` is in ms and must never go backwards. */
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {
    this.sweptAt = now();
  }

  /** Starts an attempt for `key`, or returns false if it has no place left. Every start needs one finish. */
  start(key: string): boolean {
    const now = this.now();
    // Keys that never come back are dropped too, so the map only holds the last window or two.
    if (now - this.sweptAt >= this.windowMs) {
      for (const k of this.successes.keys()) this.recent(k, now);
      this.sweptAt = now;
    }
    const running = this.running.get(key) ?? 0;
    if (this.recent(key, now).length + running >= this.max) return false;
    this.running.set(key, running + 1);
    return true;
  }

  /** Ends an attempt; a success keeps its place for the next `windowMs`. */
  finish(key: string, success: boolean): void {
    const running = (this.running.get(key) ?? 0) - 1;
    if (running > 0) this.running.set(key, running);
    else this.running.delete(key);
    if (!success) return;
    const times = this.successes.get(key);
    if (times) times.push(this.now());
    else this.successes.set(key, [this.now()]);
  }

  /** How many keys have successes remembered. */
  get size(): number {
    return this.successes.size;
  }

  /** The key's successes within the window; older ones are forgotten. */
  private recent(key: string, now: number): number[] {
    const times = this.successes.get(key);
    if (!times) return [];
    let old = 0;
    while (old < times.length && times[old]! <= now - this.windowMs) old++;
    if (old === times.length) {
      this.successes.delete(key);
      return [];
    }
    if (old > 0) times.splice(0, old);
    return times;
  }
}
