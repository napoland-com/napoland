/**
 * One running game server: HTTP + WebSocket on one port, the World (with the piles saved before a
 * restart), its tick and periodic saves. main.ts builds it from the environment; tests start it directly.
 */
import type { AddressInfo } from 'node:net';
import { DROP_LIFETIME_MS, weatherAt, type ItemsData, type TileMap, type Weather } from '@napoland/shared';
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
}

export interface RunningServer {
  readonly port: number;
  readonly world: World;
  /** Stops accepting, disconnects everyone (close code 1012) and saves them. Storage stays open. */
  stop(): Promise<void>;
}

export async function startServer(o: ServerOptions): Promise<RunningServer> {
  const clock = o.clock ?? (() => performance.now());
  // Piles fade an hour after the collapse, restart or not; older ones are forgotten.
  const drops = await o.storage.loadDrops(Date.now() - DROP_LIFETIME_MS);
  if (drops.length) log.info('piles loaded', { piles: drops.length });
  // Marks fade a day after they were painted, restart or not.
  const marks = await o.storage.loadMarks(Date.now() - MARK_LIFETIME_MS);
  if (marks.length) log.info('marks loaded', { marks: marks.length });
  const stone = await o.storage.loadStone();
  const cycle = o.weather === 'cycle';
  const world = new World(o.maps, o.homeMap, cycle ? weatherAt(Date.now()).weather : (o.weather as Weather), {
    cycle,
    marks,
    stone,
    now: clock(),
    // Where players run out tells how hard each part of the world really is.
    onCollapse: (id, where) => log.info('player collapsed', { id, ...where }),
    items: o.items,
    rng: o.rng,
    drops,
    // Game time never goes backwards; piles keep wall clock time, which is this far ahead of it.
    epochOffset: Date.now() - clock(),
  });
  const http = createHttpServer({ clientDir: o.clientDir, players: () => world.size, version: o.version });
  const net = attachNet({
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
  let stopping: Promise<void> | undefined;

  return {
    port: (http.address() as AddressInfo).port,
    world,
    stop() {
      stopping ??= (async () => {
        clearInterval(tick);
        clearInterval(save);
        const closed = new Promise<void>(resolve => http.close(() => resolve()));
        await net.close(1012);
        http.closeAllConnections();
        await closed;
      })();
      return stopping;
    },
  };
}
