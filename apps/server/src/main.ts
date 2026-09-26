/**
 * Entry point: reads the configuration, opens storage, loads the map and runs the server until
 * SIGINT or SIGTERM, then saves everyone and exits.
 */
import { loadConfig } from './config';
import { loadMap } from './content';
import { flushLogs, log, setLogLevel } from './log';
import { startServer } from './server';
import { MemoryStorage, PgStorage, type Storage } from './storage';

/** If a clean shutdown hangs (say, on the database), give up after this long. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const cfg = loadConfig();
  setLogLevel(cfg.logLevel);
  const { map, warnings } = loadMap(cfg.mapFile);
  for (const warning of warnings) log.warn('map warning', { map: map.data.id, warning });

  const storage: Storage = cfg.databaseUrl ? new PgStorage(cfg.databaseUrl, cfg.migrationsDir!) : new MemoryStorage();
  await storage.init();
  const server = await startServer({
    host: cfg.host,
    port: cfg.port,
    storage,
    map,
    weather: cfg.weather,
    maxPlayers: cfg.maxPlayers,
    tickMs: cfg.tickMs,
    saveEveryMs: cfg.saveEveryMs,
    clientDir: cfg.clientDir,
    version: cfg.version,
    trustProxy: cfg.trustProxy,
    maxConnectionsPerIp: cfg.maxConnectionsPerIp,
    newPlayersPerIpPerHour: cfg.newPlayersPerIpPerHour,
  });
  log.info('server started', {
    version: cfg.version,
    port: server.port,
    host: cfg.host,
    storage: cfg.databaseUrl ? 'postgres' : 'memory',
    map: map.data.id,
    mapVersion: map.data.version,
    players: await storage.count(),
    maxPlayers: cfg.maxPlayers,
    weather: cfg.weather,
    client: cfg.clientDir ?? 'not served',
    // Off behind a proxy, every player seems to come from the proxy and they share one set of limits.
    trustProxy: cfg.trustProxy,
    maxConnectionsPerIp: cfg.maxConnectionsPerIp,
    newPlayersPerIpPerHour: cfg.newPlayersPerIpPerHour,
  });

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return exit(1, 'forced exit', signal);
    stopping = true;
    log.info('shutting down', { signal, online: server.world.size });
    setTimeout(() => exit(1, 'shutdown timed out'), SHUTDOWN_TIMEOUT_MS).unref();
    server
      .stop()
      .then(() => storage.close())
      .then(
        () => exit(0, 'stopped'),
        (err: unknown) => exit(1, 'shutdown failed', err),
      );
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function exit(code: number, msg: string, err?: unknown): void {
  if (code === 0) log.info(msg);
  else log.error(msg, err === undefined ? undefined : { err });
  void flushLogs().then(() => process.exit(code));
}

process.on('uncaughtException', err => exit(1, 'uncaught exception', err));
process.on('unhandledRejection', err => exit(1, 'unhandled rejection', err));
main().catch((err: unknown) => exit(1, 'startup failed', err instanceof Error ? err.message : err));
