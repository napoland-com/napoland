/**
 * One running game server: HTTP + WebSocket on one port, the World (with the piles, marks, thanks and
 * what lies in the crates, saved before a restart), its tick and periodic saves, the hourly cleanup of thanks older than
 * THANKS_KEPT_DAYS, and with sign-in, the daily cleanup of guests who stayed away. main.ts builds it
 * from the environment; tests start it directly.
 */
import type { AddressInfo } from 'node:net';
import { DROP_LIFETIME_MS, GUEST_DAYS, THANKS_KEPT_MS, quickCalendar, weatherAt, type ItemsData, type StoryData, type TileMap, type Weather } from '@napoland/shared';
import { legacyAuth, type Auth } from './auth';
import { createHttpServer } from './http';
import { log } from './log';
import { attachNet } from './net';
import type { Storage } from './storage';
import { MARK_LIFETIME_MS, World } from './world';

export interface ServerOptions {
  host: string;
  /** 0 picks a free port. */
  port: number;
  storage: Storage;
  /** Every map of the world; they must fit together (loadMaps checks that). */
  maps: Iterable<TileMap>;
  /** Items and where finds grow; they must fit the maps (loadItems checks that). No items if unset. */
  items?: ItemsData;
  /** The story's chapters; they must fit the maps and items (loadStory checks that). No story if unset. */
  story?: StoryData;
  /** Words chat masks (content/words.json). None if unset. */
  words?: string[];
  /** Where finds grow and which half of a pile others get: Math.random unless a test sets its own. */
  rng?: () => number;
  /** The id of the town where new players start and collapsed players wake up. */
  homeMap: string;
  /** A fixed weather, or 'cycle': it follows the day (sky.ts). */
  weather: Weather | 'cycle';
  maxPlayers: number;
  tickMs: number;
  saveEveryMs: number;
  clientDir?: string;
  helloTimeoutMs?: number;
  heartbeatMs?: number;
  /** Game time in ms (steps, energy, rate limits); it must never go backwards. Tests set their own. */
  clock?: () => number;
  /** Reported on /health; default 'dev'. */
  version?: string;
  /** The client address is the last X-Forwarded-For entry. Only behind our own proxy. */
  trustProxy?: boolean;
  /** Open connections one address may have; unset means no limit. */
  maxConnectionsPerIp?: number;
  /** New players one address may create in any hour; unset means no limit. */
  newPlayersPerIpPerHour?: number;
  /** How players sign in (auth.ts); unset means without sign-in (legacy). */
  auth?: Auth;
  /** Development only (CLOCK_SHIFT_MS): the sky, the surges and the conditions run this many ms ahead of the wall clock. */
  clockShiftMs?: number;
  /** Development only (PARCEL_DAY_MS): the parcels' days last this long, the first a Monday that starts now, so a week of them passes in minutes. */
  parcelDayMs?: number;
  /** Development only (XP_MULTIPLIER): stashing earns this many times the XP. 1 unless set. */
  xpMultiplier?: number;
  /** Development only (RESTED_EVERY_MS): the time away that fills one XP of rest. 20 minutes unless set. */
  restedEveryMs?: number;
  /** With sign-in, how often guests who stayed away GUEST_DAYS are looked for (after start-up); default once a day. */
  forgetGuestsEveryMs?: number;
  /** How often thanks older than THANKS_KEPT_DAYS are deleted (after start-up); default once an hour. */
  forgetThanksEveryMs?: number;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface RunningServer {
  readonly port: number;
  readonly world: World;
  /** Stops accepting, disconnects everyone (close code 1012) and saves them. Storage stays open. */
  stop(): Promise<void>;
}

export async function startServer(o: ServerOptions): Promise<RunningServer> {
  const clock = o.clock ?? (() => performance.now());
  const auth = o.auth ?? legacyAuth();
  // With sign-in, whoever has not signed in plays as a guest, and a guest who has not played for
  // GUEST_DAYS is deleted with their pile and marks. Without sign-in (legacy), nobody is a guest.
  const guests = auth.mode !== 'legacy';
  // Nobody is deleted before every player could read the rule in the game: GUEST_DAYS after this
  // server first began to delete guests (the privacy policy promises to say such a change in the game
  // before it takes effect, and characters from before sign-in count as guests too).
  let since = Date.now();
  if (guests) {
    try {
      since = await o.storage.guestsSince(since);
    } catch (err) {
      log.error('cannot tell since when guests are deleted: none are for now', { err });
    }
  }
  const forgetGuests = async () => {
    if (Date.now() - since < GUEST_DAYS * DAY_MS) return;
    try {
      const gone = await o.storage.forgetGuests(Date.now() - GUEST_DAYS * DAY_MS);
      if (gone) log.info('guests deleted', { guests: gone, days: GUEST_DAYS });
    } catch (err) {
      // Housekeeping: it never keeps the game from running, and it runs again tomorrow.
      log.error('deleting guests who stayed away failed', { err });
    }
  };
  // Before the piles and marks are loaded, so none of theirs is.
  if (guests) await forgetGuests();
  // Piles fade an hour after the collapse, restart or not; older ones are forgotten.
  const drops = await o.storage.loadDrops(Date.now() - DROP_LIFETIME_MS);
  if (drops.length) log.info('piles loaded', { piles: drops.length });
  // Marks fade a day after they were painted (longer for a good neighbor), restart or not.
  const marks = await o.storage.loadMarks(Date.now(), MARK_LIFETIME_MS);
  if (marks.length) log.info('marks loaded', { marks: marks.length });
  // Who thanked whom is kept THANKS_KEPT_DAYS: for the once-a-day rule and the letters home.
  const thanks = await o.storage.loadThanks(Date.now() - THANKS_KEPT_MS);
  if (thanks.length) log.info('thanks loaded', { thanks: thanks.length });
  // What lies in the crates stays until someone takes it.
  const cacheItems = await o.storage.loadCacheItems();
  if (cacheItems.length) log.info('crates loaded', { things: cacheItems.length });
  const forgetThanks = async () => {
    try {
      await o.storage.forgetThanks(Date.now() - THANKS_KEPT_MS);
    } catch (err) {
      // Housekeeping: it never keeps the game from running, and it runs again within the hour.
      log.error('deleting old thanks failed', { err });
    }
  };
  const stone = await o.storage.loadStone();
  const cycle = o.weather === 'cycle';
  const shift = o.clockShiftMs ?? 0;
  const world = new World(o.maps, o.homeMap, cycle ? weatherAt(Date.now() + shift).weather : (o.weather as Weather), {
    cycle,
    marks,
    thanks,
    cacheItems,
    stone,
    now: clock(),
    // Where players run out tells how hard each part of the world really is.
    onCollapse: (id, where) => log.info('player collapsed', { id, ...where }),
    items: o.items,
    story: o.story,
    rng: o.rng,
    drops,
    // Game time never goes backwards; piles keep wall clock time, which is this far ahead of it.
    epochOffset: Date.now() + shift - clock(),
    guests,
    ...(o.parcelDayMs ? { calendar: quickCalendar(o.parcelDayMs, Date.now() + shift) } : {}),
    xpTimes: o.xpMultiplier,
    ...(o.restedEveryMs ? { restedEveryMs: o.restedEveryMs } : {}),
  });
  const http = createHttpServer({ clientDir: o.clientDir, players: () => world.size, version: o.version, auth: auth.config });
  const net = attachNet({
    auth,
    server: http,
    world,
    storage: o.storage,
    maxPlayers: o.maxPlayers,
    clock,
    helloTimeoutMs: o.helloTimeoutMs,
    heartbeatMs: o.heartbeatMs,
    trustProxy: o.trustProxy,
    maxConnectionsPerIp: o.maxConnectionsPerIp,
    newPlayersPerIpPerHour: o.newPlayersPerIpPerHour,
    words: o.words,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(o.port, o.host, () => {
        http.off('error', reject);
        resolve();
      });
    });
  } catch (err) {
    await net.close();
    throw err;
  }
  // Once listening, a connection that cannot be accepted (say, out of file handles) must not stop the game.
  http.on('error', err => log.error('http server error', { err: err.message }));

  const tick = setInterval(() => net.tick(), o.tickMs);
  const save = setInterval(() => void net.saveAll(), o.saveEveryMs);
  // A guest who plays is seen at once (net.ts), so this never takes one who is online.
  const cleanup = guests ? setInterval(() => void forgetGuests(), o.forgetGuestsEveryMs ?? DAY_MS) : undefined;
  // The World forgets old thanks by itself; storage is told here, so none is kept much past the promise.
  const thanksCleanup = setInterval(() => void forgetThanks(), o.forgetThanksEveryMs ?? HOUR_MS);
  let stopping: Promise<void> | undefined;

  return {
    port: (http.address() as AddressInfo).port,
    world,
    stop() {
      stopping ??= (async () => {
        clearInterval(tick);
        clearInterval(save);
        clearInterval(cleanup);
        clearInterval(thanksCleanup);
        const closed = new Promise<void>(resolve => http.close(() => resolve()));
        await net.close(1012);
        http.closeAllConnections();
        await closed;
      })();
      return stopping;
    },
  };
}
