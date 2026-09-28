/**
 * For play-tests: the CLOCK_SHIFT_MS that sets a dev server's world clock to a moment worth seeing,
 * counted from now. It prints the number alone (what the moment is goes to stderr), so it goes straight
 * into the server's environment, and the server should start at once:
 *
 *   CLOCK_SHIFT_MS=$(npm run -s clock -- long-night) npm run dev
 *
 * Moments, each a minute before it comes so you see it come: `long-night` (the next Long Night, which
 * begins on Saturday at 19:12 UTC), a season (`spring`, `summer`, `autumn` or `winter`: the next week
 * that is one, from Monday 00:00 UTC), `dawn` (the next game day). Or `now`, or a wall time in UTC
 * (`2026-10-03T19:11Z`). Minutes after the moment itself with +: `dawn+13` is 13 minutes into the next
 * game day, when the Near Woods and Stonebrook rain and the South Road is dry; `long-night+10` is ten
 * minutes into the Long Night.
 */
import { DAY_S, SEASON_ORDER, longNightAt, seasonAt, weekIndex } from '../packages/shared/src';

const MINUTE = 60_000, WEEK_MS = 7 * 86_400_000;

/** The wall time (ms) of `target` as seen at `now`, and what it is, in words; null when it is not one. */
export function clockTarget(target: string, now: number): { at: number; what: string } | null {
  const m = /^(.*?)(?:\+(\d+))?$/.exec(target.trim())!;
  const moment = momentOf(m[1]!, now);
  if (!moment) return null;
  if (m[2] !== undefined) return { at: moment.at + Number(m[2]) * MINUTE, what: `${m[2]} minutes after ${moment.what}` };
  return moment.coming ? { at: moment.at - MINUTE, what: `a minute before ${moment.what}` } : moment;
}

/** A moment by name: when it is, what it is, and whether it is one that comes (the Long Night, a dawn, a season), to be seen coming. */
function momentOf(name: string, now: number): { at: number; what: string; coming: boolean } | null {
  if (name === 'now') return { at: now, what: 'now', coming: false };
  if (name === 'long-night') {
    const t = longNightAt(now);
    // One on now: the next.
    return { at: now + t.left * 1000 + (t.on ? WEEK_MS - DAY_S * 1000 : 0), what: 'the next Long Night', coming: true };
  }
  if (name === 'dawn') return { at: (Math.floor(now / 1000 / DAY_S) + 1) * DAY_S * 1000, what: 'the next dawn', coming: true };
  if ((SEASON_ORDER as readonly string[]).includes(name)) {
    // Weeks turn on Monday at 00:00 UTC (sky.ts, weekIndex): the first one from next week's that is this season.
    let monday = (weekIndex(now) + 1) * WEEK_MS - 3 * 86_400_000;
    while (seasonAt(monday) !== name) monday += WEEK_MS;
    return { at: monday, what: `the next ${name}`, coming: true };
  }
  const at = /^\d{4}-\d{2}-\d{2}T/.test(name) ? Date.parse(name) : NaN;
  return Number.isFinite(at) ? { at, what: new Date(at).toISOString(), coming: false } : null;
}

/** CLOCK_SHIFT_MS for `target` from `now`, in whole ms; null when `target` is not a moment. */
export function shiftFor(target: string, now: number): number | null {
  const t = clockTarget(target, now);
  return t && Math.round(t.at - now);
}

if (import.meta.main) {
  const target = process.argv[2] ?? '', now = Date.now(), t = clockTarget(target, now);
  if (!t) {
    console.error('Usage: npm run -s clock -- long-night | spring | summer | autumn | winter | dawn | now | 2026-10-03T19:11Z, and +minutes after it if you like (dawn+13)');
    process.exit(2);
  }
  console.error(`CLOCK_SHIFT_MS for ${t.what}: ${new Date(t.at).toUTCString()}. Start the server now.`);
  console.log(String(Math.round(t.at - now)));
}
