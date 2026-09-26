/**
 * Server settings, read once from environment variables. Anything invalid stops the server at
 * startup with a message that says which variable is wrong, instead of failing later.
 */
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Weather } from '@napoland/shared';
import { LOG_LEVELS, type LogLevel } from './log';

export interface Config {
  port: number;
  host: string;
  /** Unset means players live in memory and are lost on restart. */
  databaseUrl: string | undefined;
  mapFile: string;
  /** Only needed with a database. */
  migrationsDir: string | undefined;
  /** The built client; unset means this server only speaks WebSocket and /health. */
  clientDir: string | undefined;
  weather: Weather;
  maxPlayers: number;
  tickMs: number;
  saveEveryMs: number;
  logLevel: LogLevel;
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env, cwd = process.cwd()): Config {
  const errors: string[] = [];
  const get = (name: string) => {
    const v = env[name]?.trim();
    return v ? v : undefined;
  };
  const int = (name: string, def: number, min: number, max: number) => {
    const raw = get(name);
    if (raw === undefined) return def;
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || n < min || n > max) {
      errors.push(`${name} must be a whole number from ${min} to ${max}, got "${raw}"`);
      return def;
    }
    return n;
  };
  const oneOf = <T extends string>(name: string, options: readonly T[], def: T): T => {
    const raw = get(name);
    if (raw === undefined) return def;
    if ((options as readonly string[]).includes(raw)) return raw as T;
    errors.push(`${name} must be one of ${options.join(', ')}, got "${raw}"`);
    return def;
  };
  /** An explicit path must exist; otherwise look for the default one in cwd and its parents. */
  const path = (name: string, fallback: string, kind: 'file' | 'dir') => {
    const raw = get(name);
    if (raw === undefined) return findUp(fallback, cwd, kind);
    const p = resolve(cwd, raw);
    if (!isKind(p, kind)) errors.push(`${name} must point to an existing ${kind === 'dir' ? 'directory' : 'file'}, got "${raw}"`);
    return p;
  };

  const port = int('PORT', 8080, 0, 65535);
  const host = get('HOST') ?? '0.0.0.0';
  const databaseUrl = get('DATABASE_URL');
  // Never echo the URL: it usually contains the password.
  if (databaseUrl !== undefined && !isPostgresUrl(databaseUrl)) errors.push('DATABASE_URL must be a postgres:// or postgresql:// URL');
  const mapFile = path('MAP_FILE', 'content/maps/stonebrook.json', 'file');
  if (mapFile === undefined) errors.push(`MAP_FILE is not set and content/maps/stonebrook.json was not found in ${cwd} or its parents`);
  const migrationsDir = path('MIGRATIONS_DIR', 'apps/server/migrations', 'dir');
  if (databaseUrl !== undefined && migrationsDir === undefined) errors.push(`MIGRATIONS_DIR is not set and apps/server/migrations was not found in ${cwd} or its parents`);
  const clientDir = path('CLIENT_DIR', 'apps/client/dist', 'dir');
  const weather = oneOf('WEATHER', Weather.options, 'rain');
  const maxPlayers = int('MAX_PLAYERS', 500, 1, 100_000);
  const tickMs = int('TICK_MS', 50, 1, 1000);
  const saveEveryMs = int('SAVE_EVERY_MS', 15_000, 1000, 3_600_000);
  const logLevel = oneOf('LOG_LEVEL', LOG_LEVELS, 'info');

  if (errors.length) throw new Error(`Invalid configuration:\n  ${errors.join('\n  ')}`);
  return { port, host, databaseUrl, mapFile: mapFile!, migrationsDir, clientDir, weather, maxPlayers, tickMs, saveEveryMs, logLevel };
}

/** The first `rel` that exists in `from` or one of its parents. */
export function findUp(rel: string, from: string, kind: 'file' | 'dir'): string | undefined {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const p = join(dir, rel);
    if (isKind(p, kind)) return p;
    if (dirname(dir) === dir) return undefined;
  }
}

function isKind(p: string, kind: 'file' | 'dir'): boolean {
  if (!existsSync(p)) return false;
  const st = statSync(p);
  return kind === 'dir' ? st.isDirectory() : st.isFile();
}

function isPostgresUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'postgres:' || protocol === 'postgresql:';
  } catch {
    return false;
  }
}
