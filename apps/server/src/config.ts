/**
 * Server settings, read once from environment variables. Anything invalid stops the server at
 * startup with a message that says which variable is wrong, instead of failing later.
 */
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { AUTH_MODES, OAUTH_PROVIDERS, Weather, isOAuthProvider, type OAuthProvider } from '@napoland/shared';
import { LOG_LEVELS, type LogLevel } from './log';

/**
 * How players sign in (auth.ts has what each mode means). `providers` (AUTH_PROVIDERS): Google and
 * Apple, once the Supabase project has them set up (docs/OPERATIONS.md), in the order the sign-in
 * card offers them; in dev mode they only show their buttons.
 */
export type AuthSettings =
  | { mode: 'legacy' }
  | { mode: 'dev'; providers: OAuthProvider[] }
  | {
      mode: 'supabase';
      /** The project's address, like https://abcd.supabase.co (no trailing slash). */
      url: string;
      /** The project's publishable key (or its legacy anon key). Public: every browser gets it from /auth-config. */
      publishableKey: string;
      /** Only for projects that still sign access tokens with a shared secret (HS256). */
      jwtSecret: string | undefined;
      providers: OAuthProvider[];
    };

export interface Config {
  port: number;
  host: string;
  /** Unset means players live in memory and are lost on restart. */
  databaseUrl: string | undefined;
  /** The folder with every map of the world (*.json). */
  mapsDir: string;
  /** Items and where finds grow (content/items.json). */
  itemsFile: string;
  /** The story's chapters (content/story.json). */
  storyFile: string;
  /** The id of the town where new players start and collapsed players wake up. */
  homeMap: string;
  /** Only needed with a database. */
  migrationsDir: string | undefined;
  /** The built client; unset means this server only speaks WebSocket and /health. */
  clientDir: string | undefined;
  /** A fixed weather, or cycle: it follows the day. */
  weather: Weather | 'cycle';
  maxPlayers: number;
  tickMs: number;
  saveEveryMs: number;
  logLevel: LogLevel;
  /** Behind our own proxy: the client address is the last X-Forwarded-For entry. */
  trustProxy: boolean;
  /** Open connections one address may have; more are refused with HTTP 429. */
  maxConnectionsPerIp: number;
  /** New players one address may create in any hour. */
  newPlayersPerIpPerHour: number;
  /** Reported on /health, so a deploy can be checked from outside. */
  version: string;
  /** Development only: the world's clock runs this many ms ahead (or behind), to play-test a dawn or a surge without waiting for it. */
  clockShiftMs: number;
  /** Development only: the parcels' days last this many ms (0: real calendar days), to play-test a week of parcels in minutes. */
  parcelDayMs: number;
  /** Development only: stashing earns this many times the XP, to play-test the levels (and the outfits they open) without the trips. */
  xpMultiplier: number;
  /** Development only: the time away (ms) that fills one XP of rest (0: 20 minutes, as it should), to play-test the cup of rest without days away. */
  restedEveryMs: number;
  auth: AuthSettings;
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
  /** Anything but these stops the server: a misspelt "on" must not quietly mean off. */
  const bool = (name: string, def: boolean) => {
    const raw = get(name);
    if (raw === undefined) return def;
    const v = raw.toLowerCase();
    if (v === '1' || v === 'true') return true;
    if (v === '0' || v === 'false') return false;
    errors.push(`${name} must be 1, true, 0 or false, got "${raw}"`);
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
  // MAP_FILE named the one map there was. Left over, it would quietly run another world than the one asked for.
  if (get('MAP_FILE') !== undefined) errors.push('MAP_FILE is no longer used: set MAPS_DIR (the folder with every map) and HOME_MAP (the home town\'s id) instead');
  const mapsDir = path('MAPS_DIR', 'content/maps', 'dir');
  if (mapsDir === undefined) errors.push(`MAPS_DIR is not set and content/maps was not found in ${cwd} or its parents`);
  // Whether the items fit the maps is checked with them (content.ts).
  const itemsFile = path('ITEMS_FILE', 'content/items.json', 'file');
  if (itemsFile === undefined) errors.push(`ITEMS_FILE is not set and content/items.json was not found in ${cwd} or its parents`);
  // Whether the story fits the maps and items is checked with them too (content.ts).
  const storyFile = path('STORY_FILE', 'content/story.json', 'file');
  if (storyFile === undefined) errors.push(`STORY_FILE is not set and content/story.json was not found in ${cwd} or its parents`);
  // Whether the map exists and is a town is checked with the maps (content.ts).
  const homeMap = get('HOME_MAP') ?? 'stonebrook';
  const migrationsDir = path('MIGRATIONS_DIR', 'apps/server/migrations', 'dir');
  if (databaseUrl !== undefined && migrationsDir === undefined) errors.push(`MIGRATIONS_DIR is not set and apps/server/migrations was not found in ${cwd} or its parents`);
  const clientDir = path('CLIENT_DIR', 'apps/client/dist', 'dir');
  // 'cycle': the weather follows the day, the same for everyone (sky.ts). A fixed one is for trying things out.
  const weather = oneOf('WEATHER', [...Weather.options, 'cycle'] as const, 'cycle');
  const maxPlayers = int('MAX_PLAYERS', 500, 1, 100_000);
  const tickMs = int('TICK_MS', 50, 1, 1000);
  const saveEveryMs = int('SAVE_EVERY_MS', 15_000, 1000, 3_600_000);
  const logLevel = oneOf('LOG_LEVEL', LOG_LEVELS, 'info');
  // Only behind a proxy that sets X-Forwarded-For: without one, clients could claim any address.
  const trustProxy = bool('TRUST_PROXY', false);
  const maxConnectionsPerIp = int('MAX_CONNECTIONS_PER_IP', 20, 1, 100_000);
  const newPlayersPerIpPerHour = int('NEW_PLAYERS_PER_IP_PER_HOUR', 10, 1, 100_000);
  const version = get('APP_VERSION') ?? 'dev';
  let clockShiftMs = 0;
  const shift = get('CLOCK_SHIFT_MS');
  if (shift !== undefined) {
    if (!/^-?\d+$/.test(shift) || !Number.isSafeInteger(Number(shift))) errors.push(`CLOCK_SHIFT_MS must be a whole number of milliseconds, got "${shift}"`);
    // Everyone shares one sky: a live server must never run another day than the wall clock's.
    else if (get('NODE_ENV') === 'production' && Number(shift) !== 0) errors.push('CLOCK_SHIFT_MS moves the whole world\'s clock, so it is refused when NODE_ENV=production');
    else clockShiftMs = Number(shift);
  }
  let parcelDayMs = 0;
  const parcelDay = get('PARCEL_DAY_MS');
  // 0 is the real calendar, as when it is not set, anywhere. Anything else is a day for everyone's
  // parcels: a live server must follow the real calendar.
  if (parcelDay !== undefined && !/^0+$/.test(parcelDay)) {
    if (get('NODE_ENV') === 'production') errors.push('PARCEL_DAY_MS shortens the days of everyone\'s parcels, so it is refused when NODE_ENV=production');
    else parcelDayMs = int('PARCEL_DAY_MS', 0, 5000, 86_400_000);
  }
  const xpMultiplier = int('XP_MULTIPLIER', 1, 1, 100_000);
  // Levels are earned by bringing things home, for everyone alike: a live server never hands them out.
  if (get('NODE_ENV') === 'production' && xpMultiplier !== 1) errors.push('XP_MULTIPLIER hands out levels, so it is refused when NODE_ENV=production');
  let restedEveryMs = 0;
  if (get('RESTED_EVERY_MS') !== undefined) {
    // Rest is a gift for real time away: a live server never fills it faster.
    if (get('NODE_ENV') === 'production') errors.push('RESTED_EVERY_MS fills everyone\'s rest faster than time away does, so it is refused when NODE_ENV=production');
    else restedEveryMs = int('RESTED_EVERY_MS', 0, 100, 3_600_000);
  }

  let auth: AuthSettings = { mode: 'legacy' };
  const authMode = oneOf('AUTH_MODE', AUTH_MODES, 'legacy');
  const allowDevAuth = bool('ALLOW_DEV_AUTH', false);
  // Checked in every mode, so a misspelt name stops the server the day it is written, not the day
  // sign-in is switched on (without sign-in the list is not used).
  const providers = oauthProviders(get('AUTH_PROVIDERS'), errors);
  if (authMode === 'dev') {
    // Anyone can be anyone in dev mode: a production server must not end up in it by a slip.
    if (get('NODE_ENV') === 'production' && !allowDevAuth) {
      errors.push('AUTH_MODE=dev lets anyone sign in as anyone with just an email, so it is refused when NODE_ENV=production; set ALLOW_DEV_AUTH=1 only on a test server');
    }
    auth = { mode: 'dev', providers };
  } else if (authMode === 'supabase') {
    const rawUrl = get('SUPABASE_URL');
    const url = rawUrl === undefined ? undefined : projectUrl(rawUrl);
    if (rawUrl === undefined) errors.push('SUPABASE_URL is required with AUTH_MODE=supabase (the project\'s address, like https://abcd.supabase.co)');
    else if (url === undefined) errors.push(`SUPABASE_URL must be the project's address, like https://abcd.supabase.co (http only for a Supabase on this machine), got "${rawUrl}"`);
    // SUPABASE_ANON_KEY is the older name, from before Supabase's publishable keys replaced anon keys.
    const publishable = get('SUPABASE_PUBLISHABLE_KEY');
    const anon = get('SUPABASE_ANON_KEY');
    const key = publishable ?? anon;
    // Never echo a key: if it is a secret one, the log must not spread it further.
    if (publishable !== undefined && anon !== undefined && publishable !== anon) {
      errors.push('SUPABASE_PUBLISHABLE_KEY and SUPABASE_ANON_KEY are both set, to different keys: set only SUPABASE_PUBLISHABLE_KEY');
    } else if (key === undefined) {
      errors.push('SUPABASE_PUBLISHABLE_KEY is required with AUTH_MODE=supabase (the project\'s publishable key, sb_publishable_...)');
    } else {
      const problem = publicKeyProblem(key);
      if (problem) errors.push(`${publishable !== undefined ? 'SUPABASE_PUBLISHABLE_KEY' : 'SUPABASE_ANON_KEY'} ${problem}`);
    }
    const jwtSecret = get('SUPABASE_JWT_SECRET');
    if (jwtSecret !== undefined && jwtSecret.length < 32) errors.push('SUPABASE_JWT_SECRET must be the project\'s JWT secret (at least 32 characters)');
    auth = { mode: 'supabase', url: url ?? '', publishableKey: key ?? '', jwtSecret, providers };
  }

  if (errors.length) throw new Error(`Invalid configuration:\n  ${errors.join('\n  ')}`);
  return {
    port, host, databaseUrl, mapsDir: mapsDir!, itemsFile: itemsFile!, storyFile: storyFile!, homeMap, migrationsDir, clientDir, weather, maxPlayers, tickMs, saveEveryMs,
    logLevel, trustProxy, maxConnectionsPerIp, newPlayersPerIpPerHour, version, clockShiftMs, parcelDayMs, xpMultiplier, restedEveryMs, auth,
  };
}

/**
 * AUTH_PROVIDERS ("google,apple", "apple" or nothing): the sign-ins the card offers besides the email
 * code, in this order. A name the game does not offer stops the server, so a misspelt "gogle" never
 * quietly leaves its button out.
 */
function oauthProviders(raw: string | undefined, errors: string[]): OAuthProvider[] {
  const names = (raw ?? '').split(',').map(name => name.trim()).filter(Boolean);
  const unknown = names.filter(name => !isOAuthProvider(name));
  if (unknown.length) {
    errors.push(`AUTH_PROVIDERS takes ${OAUTH_PROVIDERS.join(', ')} (comma-separated), not ${unknown.map(name => `"${name}"`).join(', ')}`);
    return [];
  }
  return [...new Set(names.filter(isOAuthProvider))];
}

/** A Supabase project's address as clients and tokens name it (the origin), or undefined if it is not one. */
function projectUrl(raw: string): string | undefined {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return undefined;
  }
  // Plain http would let anyone on the way swap the keys; only a Supabase running on this machine may use it.
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return undefined;
  if (u.username || u.password || u.search || u.hash || u.pathname.replace(/\/+$/, '') !== '') return undefined;
  return u.origin;
}

/**
 * Why `key` must not be handed to every browser as the project's public key, or undefined if it
 * may. Supabase's secret keys (sb_secret_..., or the legacy service_role JWT) bypass all its rules.
 */
function publicKeyProblem(key: string): string | undefined {
  if (/\s/.test(key)) return 'must be one line without spaces';
  if (key.startsWith('sb_secret_')) return 'is a secret key: use the project\'s publishable key (sb_publishable_...), since every browser gets it';
  const parts = key.split('.');
  if (parts.length !== 3) return undefined; // a publishable key (sb_publishable_...)
  // A legacy key is a JWT whose role says what it may do.
  let role: unknown;
  try {
    role = (JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as { role?: unknown }).role;
  } catch {
    return 'is not a key Supabase made (it looks like a JWT but cannot be read)';
  }
  return role === 'anon' ? undefined : 'is not a public key: use the project\'s publishable key (sb_publishable_...), since every browser gets it';
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
