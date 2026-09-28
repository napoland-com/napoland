/**
 * Entry point: reads the configuration, loads the maps and the items, opens storage and runs the
 * server until SIGINT or SIGTERM, then saves everyone and exits.
 */
import { dirname, join } from 'node:path';
import { createAuth } from './auth';
import { loadConfig } from './config';
import { loadItems, loadMaps, loadStory, loadWords } from './content';
import { flushLogs, log, setLogLevel } from './log';
import { startServer } from './server';
import { MemoryStorage, PgStorage, type Storage } from './storage';

/** If a clean shutdown hangs (say, on the database), give up after this long. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const cfg = loadConfig();
  setLogLevel(cfg.logLevel);
  const { maps, warnings } = loadMaps(cfg.mapsDir, cfg.homeMap);
  for (const { map, message } of warnings) log.warn('map warning', { map, warning: message });
  log.info('maps loaded', {
    dir: cfg.mapsDir,
    home: cfg.homeMap,
    maps: [...maps.values()].map(({ data: m }) => ({ id: m.id, version: m.version, kind: m.kind, depth: m.depth, size: `${m.width}x${m.height}` })),
  });
  const { items, warnings: itemWarnings } = loadItems(cfg.itemsFile, maps.values());
  for (const message of itemWarnings) log.warn('items warning', { warning: message });
  log.info('items loaded', {
    file: cfg.itemsFile,
    version: items.version,
    items: items.items.map(i => i.id),
    finds: items.finds.reduce((n, f) => n + f.count, 0),
  });
  const story = loadStory(cfg.storyFile, maps.values(), items);
  log.info('story loaded', { file: cfg.storyFile, version: story.version, chapters: story.chapters.length });

  // The words chat masks lie next to the items.
  const words = loadWords(join(dirname(cfg.itemsFile), 'words.json'));
  log.info('chat words loaded', { count: words.length });

  const storage: Storage = cfg.databaseUrl ? new PgStorage(cfg.databaseUrl, cfg.migrationsDir!) : new MemoryStorage();
  await storage.init();
  const auth = createAuth(cfg.auth);
  if (auth.mode === 'dev') log.warn('dev sign-in: anyone can sign in as anyone with just an email (development and tests only)');
  const server = await startServer({
    host: cfg.host,
    port: cfg.port,
    storage,
    maps: maps.values(),
    items,
    story,
    words,
    homeMap: cfg.homeMap,
    weather: cfg.weather,
    maxPlayers: cfg.maxPlayers,
    tickMs: cfg.tickMs,
    saveEveryMs: cfg.saveEveryMs,
    clientDir: cfg.clientDir,
    version: cfg.version,
    trustProxy: cfg.trustProxy,
    maxConnectionsPerIp: cfg.maxConnectionsPerIp,
    newPlayersPerIpPerHour: cfg.newPlayersPerIpPerHour,
    clockShiftMs: cfg.clockShiftMs,
    auth,
  });
  log.info('server started', {
    version: cfg.version,
    port: server.port,
    host: cfg.host,
    storage: cfg.databaseUrl ? 'postgres' : 'memory',
    homeMap: cfg.homeMap,
    maps: maps.size,
    players: await storage.count(),
    maxPlayers: cfg.maxPlayers,
    weather: cfg.weather,
    client: cfg.clientDir ?? 'not served',
    // Off behind a proxy, every player seems to come from the proxy and they share one set of limits.
    trustProxy: cfg.trustProxy,
    maxConnectionsPerIp: cfg.maxConnectionsPerIp,
    newPlayersPerIpPerHour: cfg.newPlayersPerIpPerHour,
    // The mode and, with Supabase, the project's address (both public); never a key.
    signIn: cfg.auth.mode,
    supabase: cfg.auth.mode === 'supabase' ? cfg.auth.url : undefined,
    // The buttons the sign-in card shows besides the email (AUTH_PROVIDERS).
    providers: cfg.auth.mode === 'legacy' ? undefined : cfg.auth.providers,
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
