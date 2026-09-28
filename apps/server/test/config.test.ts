import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));

describe('loadConfig', () => {
  it('has defaults for everything, and finds the content from anywhere in the repo', () => {
    const cfg = loadConfig({}, join(REPO, 'apps', 'server', 'src'));
    expect(cfg).toMatchObject({
      port: 8080, host: '0.0.0.0', databaseUrl: undefined, weather: 'cycle',
      maxPlayers: 500, tickMs: 50, saveEveryMs: 15_000, logLevel: 'info',
      trustProxy: false, maxConnectionsPerIp: 20, newPlayersPerIpPerHour: 10, version: 'dev', auth: { mode: 'legacy' },
    });
    expect(cfg.mapsDir).toBe(join(REPO, 'content', 'maps'));
    expect(cfg.itemsFile).toBe(join(REPO, 'content', 'items.json'));
    expect(cfg.storyFile).toBe(join(REPO, 'content', 'story.json'));
    expect(cfg.homeMap).toBe('stonebrook');
    expect(cfg.migrationsDir).toBe(join(REPO, 'apps', 'server', 'migrations'));
  });

  it('reads the maps folder, the items file, the story file and the home map', () => {
    const cfg = loadConfig({ MAPS_DIR: 'content/maps', ITEMS_FILE: 'content/items.json', STORY_FILE: 'content/story.json', HOME_MAP: ' riverside ' }, REPO);
    expect(cfg).toMatchObject({
      mapsDir: join(REPO, 'content', 'maps'), itemsFile: join(REPO, 'content', 'items.json'), storyFile: join(REPO, 'content', 'story.json'), homeMap: 'riverside',
    });
  });

  it('reads the environment', () => {
    const cfg = loadConfig(
      { PORT: '9000', HOST: '127.0.0.1', WEATHER: 'night', MAX_PLAYERS: '10', TICK_MS: '20', SAVE_EVERY_MS: '5000', DATABASE_URL: 'postgres://u:p@db:5432/napoland', LOG_LEVEL: 'warn' },
      REPO,
    );
    expect(cfg).toMatchObject({ port: 9000, host: '127.0.0.1', weather: 'night', maxPlayers: 10, tickMs: 20, saveEveryMs: 5000, databaseUrl: 'postgres://u:p@db:5432/napoland', logLevel: 'warn' });
  });

  it('reads the limits per address, the proxy setting and the version', () => {
    const cfg = loadConfig({ TRUST_PROXY: '1', MAX_CONNECTIONS_PER_IP: '5', NEW_PLAYERS_PER_IP_PER_HOUR: '3', APP_VERSION: ' 0.4.1-abc1234 ' }, REPO);
    expect(cfg).toMatchObject({ trustProxy: true, maxConnectionsPerIp: 5, newPlayersPerIpPerHour: 3, version: '0.4.1-abc1234' });
    for (const [raw, on] of [['true', true], ['TRUE', true], ['0', false], ['false', false], ['', false]] as const) {
      expect([raw, loadConfig({ TRUST_PROXY: raw }, REPO).trustProxy]).toEqual([raw, on]);
    }
  });

  it('treats empty variables as unset', () => {
    expect(loadConfig({ PORT: '', DATABASE_URL: '  ' }, REPO)).toMatchObject({ port: 8080, databaseUrl: undefined });
  });

  it('lists every invalid value at once', () => {
    const env = {
      PORT: 'http', WEATHER: 'sunny', MAX_PLAYERS: '0', TICK_MS: '1.5', SAVE_EVERY_MS: '-1',
      // A misspelt "on" must not quietly leave the proxy untrusted.
      TRUST_PROXY: 'yes', MAX_CONNECTIONS_PER_IP: '0', NEW_PLAYERS_PER_IP_PER_HOUR: 'many',
    };
    let msg = '';
    try {
      loadConfig(env, REPO);
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toMatch(/^Invalid configuration/);
    for (const name of Object.keys(env)) expect(msg).toContain(name);
  });

  it('never repeats the database URL, which holds the password', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://root:hunter2@db/x' }, REPO)).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'mysql://root:hunter2@db/x' }, REPO)).not.toThrow(/hunter2/);
  });

  it('fails when the maps, the items or an explicit folder cannot be found', () => {
    expect(() => loadConfig({ MAPS_DIR: 'nope' }, REPO)).toThrow(/MAPS_DIR must point to an existing directory/);
    expect(() => loadConfig({ MAPS_DIR: 'content/maps/stonebrook.json' }, REPO)).toThrow(/MAPS_DIR must point to an existing directory/);
    expect(() => loadConfig({ ITEMS_FILE: 'nope.json' }, REPO)).toThrow(/ITEMS_FILE must point to an existing file/);
    expect(() => loadConfig({ ITEMS_FILE: 'content' }, REPO)).toThrow(/ITEMS_FILE must point to an existing file/);
    expect(() => loadConfig({ STORY_FILE: 'nope.json' }, REPO)).toThrow(/STORY_FILE must point to an existing file/);
    expect(() => loadConfig({ CLIENT_DIR: `nope${sep}dist` }, REPO)).toThrow(/CLIENT_DIR/);
    expect(() => loadConfig({}, tmpdir())).toThrow(/MAPS_DIR is not set/);
    expect(() => loadConfig({}, tmpdir())).toThrow(/ITEMS_FILE is not set and content\/items\.json was not found/);
    expect(() => loadConfig({}, tmpdir())).toThrow(/STORY_FILE is not set and content\/story\.json was not found/);
  });

  it('refuses the old MAP_FILE, which would quietly be ignored', () => {
    expect(() => loadConfig({ MAP_FILE: 'content/maps/stonebrook.json' }, REPO)).toThrow(/MAP_FILE is no longer used: set MAPS_DIR/);
  });
});

describe('loadConfig: signing in', () => {
  const PUBLISHABLE = 'sb_publishable_MjuYAHlcbXjup4pBciyVGw_QRMps_UU';
  const supabase = { AUTH_MODE: 'supabase', SUPABASE_URL: 'https://abcd.supabase.co', SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE };
  /** A legacy Supabase key: a JWT whose role says what it may do (the signature does not matter here). */
  const legacyKey = (role: string) => `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify({ iss: 'supabase', ref: 'abcd', role })).toString('base64url')}.c2lnbmF0dXJl`;
  const problem = (env: Record<string, string>) => {
    try {
      loadConfig(env, REPO);
    } catch (err) {
      return (err as Error).message;
    }
    return '';
  };

  it('runs without sign-in unless AUTH_MODE says otherwise', () => {
    expect(loadConfig({}, REPO).auth).toEqual({ mode: 'legacy' });
    expect(loadConfig({ AUTH_MODE: 'legacy', SUPABASE_URL: 'https://abcd.supabase.co' }, REPO).auth).toEqual({ mode: 'legacy' });
    expect(problem({ AUTH_MODE: 'google' })).toMatch(/AUTH_MODE must be one of legacy, dev, supabase/);
  });

  it('takes dev sign-in, but refuses it in production unless ALLOW_DEV_AUTH=1', () => {
    expect(loadConfig({ AUTH_MODE: 'dev' }, REPO).auth).toEqual({ mode: 'dev', providers: [] });
    expect(loadConfig({ AUTH_MODE: 'dev', NODE_ENV: 'development' }, REPO).auth).toEqual({ mode: 'dev', providers: [] });
    expect(problem({ AUTH_MODE: 'dev', NODE_ENV: 'production' })).toMatch(/AUTH_MODE=dev lets anyone sign in as anyone.*ALLOW_DEV_AUTH=1/);
    expect(problem({ AUTH_MODE: 'dev', NODE_ENV: 'production', ALLOW_DEV_AUTH: '0' })).toMatch(/AUTH_MODE=dev/);
    expect(loadConfig({ AUTH_MODE: 'dev', NODE_ENV: 'production', ALLOW_DEV_AUTH: '1' }, REPO).auth).toEqual({ mode: 'dev', providers: [] });
    // A misspelt "on" must not quietly mean off (or on).
    expect(problem({ AUTH_MODE: 'dev', ALLOW_DEV_AUTH: 'yes' })).toMatch(/ALLOW_DEV_AUTH must be 1, true, 0 or false/);
    // Production without dev sign-in is fine.
    expect(loadConfig({ NODE_ENV: 'production' }, REPO).auth).toEqual({ mode: 'legacy' });
  });

  it('shifts the clock for a play-test, never in production', () => {
    expect(loadConfig({}, REPO).clockShiftMs).toBe(0);
    expect(loadConfig({ CLOCK_SHIFT_MS: '-120000' }, REPO).clockShiftMs).toBe(-120_000);
    expect(loadConfig({ CLOCK_SHIFT_MS: '0', NODE_ENV: 'production' }, REPO).clockShiftMs).toBe(0);
    expect(problem({ CLOCK_SHIFT_MS: '5000', NODE_ENV: 'production' })).toMatch(/CLOCK_SHIFT_MS .* refused when NODE_ENV=production/);
    expect(problem({ CLOCK_SHIFT_MS: '5 minutes' })).toMatch(/CLOCK_SHIFT_MS must be a whole number/);
  });

  it('shortens the days of the parcels for a play-test, never in production', () => {
    expect(loadConfig({}, REPO).parcelDayMs).toBe(0);
    expect(loadConfig({ PARCEL_DAY_MS: '20000' }, REPO).parcelDayMs).toBe(20_000);
    expect(problem({ PARCEL_DAY_MS: '20000', NODE_ENV: 'production' })).toMatch(/PARCEL_DAY_MS .* refused when NODE_ENV=production/);
    // Shorter than a few seconds, a day would pass before its banner is read.
    expect(problem({ PARCEL_DAY_MS: '100' })).toMatch(/PARCEL_DAY_MS must be a whole number from 5000 to 86400000/);
    expect(problem({ PARCEL_DAY_MS: 'a minute' })).toMatch(/PARCEL_DAY_MS must be a whole number/);
    // 0 is the real calendar, as with none: anywhere, production too.
    expect(loadConfig({ PARCEL_DAY_MS: '0' }, REPO).parcelDayMs).toBe(0);
    expect(loadConfig({ PARCEL_DAY_MS: '0', NODE_ENV: 'production' }, REPO).parcelDayMs).toBe(0);
    expect(problem({ PARCEL_DAY_MS: '5000', NODE_ENV: 'production' })).toMatch(/PARCEL_DAY_MS .* refused when NODE_ENV=production/);
  });

  it('multiplies the XP of stashing for a play-test, never in production', () => {
    expect(loadConfig({}, REPO).xpMultiplier).toBe(1);
    expect(loadConfig({ XP_MULTIPLIER: '1000' }, REPO).xpMultiplier).toBe(1000);
    expect(loadConfig({ XP_MULTIPLIER: '1', NODE_ENV: 'production' }, REPO).xpMultiplier).toBe(1);
    expect(problem({ XP_MULTIPLIER: '100', NODE_ENV: 'production' })).toMatch(/XP_MULTIPLIER .* refused when NODE_ENV=production/);
    expect(problem({ XP_MULTIPLIER: '0' })).toMatch(/XP_MULTIPLIER must be a whole number from 1/);
    expect(problem({ XP_MULTIPLIER: '2.5' })).toMatch(/XP_MULTIPLIER must be a whole number/);
  });

  it('fills the cup of rest faster for a play-test, never in production', () => {
    expect(loadConfig({}, REPO).restedEveryMs).toBe(0);
    expect(loadConfig({ RESTED_EVERY_MS: '1000' }, REPO).restedEveryMs).toBe(1000);
    expect(problem({ RESTED_EVERY_MS: '1000', NODE_ENV: 'production' })).toMatch(/RESTED_EVERY_MS .* refused when NODE_ENV=production/);
    expect(problem({ RESTED_EVERY_MS: '10' })).toMatch(/RESTED_EVERY_MS must be a whole number from 100 to 3600000/);
    expect(problem({ RESTED_EVERY_MS: 'a second' })).toMatch(/RESTED_EVERY_MS must be a whole number/);
  });

  it('starts the town where a play-test says (TOWN_DONE), never in production', () => {
    expect(loadConfig({}, REPO).townDone).toEqual([]);
    expect(loadConfig({ TOWN_DONE: ' edith-home, south-lights ,,edith-home' }, REPO).townDone).toEqual(['edith-home', 'south-lights']);
    expect(problem({ TOWN_DONE: 'edith-home', NODE_ENV: 'production' })).toMatch(/TOWN_DONE .* refused when NODE_ENV=production/);
    expect(problem({ TOWN_DONE: 'Edith Home' })).toMatch(/TOWN_DONE lists milestones and works of the town by their ids, got "Edith Home"/);
  });

  it('makes a crowd of a few players for a play-test of copies, never in production', () => {
    expect(loadConfig({}, REPO)).toMatchObject({ townCrowd: 0, regionCrowd: 0 });
    expect(loadConfig({ TOWN_CROWD: '2', REGION_CROWD: '3' }, REPO)).toMatchObject({ townCrowd: 2, regionCrowd: 3 });
    expect(problem({ TOWN_CROWD: '2', NODE_ENV: 'production' })).toMatch(/TOWN_CROWD splits places into copies for a few players, so it is refused when NODE_ENV=production/);
    expect(problem({ REGION_CROWD: '2', NODE_ENV: 'production' })).toMatch(/REGION_CROWD .* refused when NODE_ENV=production/);
    expect(problem({ REGION_CROWD: '0' })).toMatch(/REGION_CROWD must be a whole number from 1/);
    expect(problem({ TOWN_CROWD: 'a few' })).toMatch(/TOWN_CROWD must be a whole number/);
  });

  it('shows people\'s steps more often for a play-test of glimpses, never in production', () => {
    expect(loadConfig({}, REPO).glimpseEveryMs).toBe(0);
    expect(loadConfig({ GLIMPSE_EVERY_MS: '5000' }, REPO).glimpseEveryMs).toBe(5000);
    expect(problem({ GLIMPSE_EVERY_MS: '5000', NODE_ENV: 'production' })).toMatch(/GLIMPSE_EVERY_MS .* refused when NODE_ENV=production/);
    expect(problem({ GLIMPSE_EVERY_MS: '10' })).toMatch(/GLIMPSE_EVERY_MS must be a whole number from 1000 to 3600000/);
    expect(problem({ GLIMPSE_EVERY_MS: 'often' })).toMatch(/GLIMPSE_EVERY_MS must be a whole number/);
  });

  it('takes a Supabase project: its address (as an origin) and its publishable key', () => {
    expect(loadConfig(supabase, REPO).auth).toEqual({ mode: 'supabase', url: 'https://abcd.supabase.co', publishableKey: PUBLISHABLE, jwtSecret: undefined, providers: [] });
    expect(loadConfig({ ...supabase, SUPABASE_URL: 'https://abcd.supabase.co/' }, REPO).auth).toMatchObject({ url: 'https://abcd.supabase.co' });
    // A Supabase running on this machine may use plain http.
    expect(loadConfig({ ...supabase, SUPABASE_URL: 'http://127.0.0.1:54321' }, REPO).auth).toMatchObject({ url: 'http://127.0.0.1:54321' });
    const secret = 'x'.repeat(40);
    expect(loadConfig({ ...supabase, SUPABASE_JWT_SECRET: secret }, REPO).auth).toMatchObject({ jwtSecret: secret });
  });

  it('takes SUPABASE_ANON_KEY, the older name, and a legacy anon key', () => {
    const { SUPABASE_PUBLISHABLE_KEY: _, ...withoutKey } = supabase;
    expect(loadConfig({ ...withoutKey, SUPABASE_ANON_KEY: PUBLISHABLE }, REPO).auth).toMatchObject({ publishableKey: PUBLISHABLE });
    expect(loadConfig({ ...supabase, SUPABASE_ANON_KEY: PUBLISHABLE }, REPO).auth).toMatchObject({ publishableKey: PUBLISHABLE });
    expect(loadConfig({ ...withoutKey, SUPABASE_ANON_KEY: legacyKey('anon') }, REPO).auth).toMatchObject({ publishableKey: legacyKey('anon') });
    expect(problem({ ...supabase, SUPABASE_ANON_KEY: 'sb_publishable_another' })).toMatch(/set only SUPABASE_PUBLISHABLE_KEY/);
  });

  it('needs the address and the key with AUTH_MODE=supabase', () => {
    expect(problem({ AUTH_MODE: 'supabase' })).toMatch(/SUPABASE_URL is required with AUTH_MODE=supabase/);
    expect(problem({ AUTH_MODE: 'supabase' })).toMatch(/SUPABASE_PUBLISHABLE_KEY is required with AUTH_MODE=supabase/);
  });

  it('refuses an address that is not a project\'s: plain http on the internet, a path, credentials', () => {
    for (const url of ['abcd.supabase.co', 'http://abcd.supabase.co', 'https://abcd.supabase.co/auth/v1', 'https://user:pass@abcd.supabase.co', 'ftp://abcd.supabase.co']) {
      expect([url, problem({ ...supabase, SUPABASE_URL: url })]).toEqual([url, expect.stringMatching(/SUPABASE_URL must be the project's address/)]);
    }
  });

  it('never hands a secret key to browsers, and never repeats one', () => {
    const secretKey = 'sb_secret_abcdefghijklmnop';
    expect(problem({ ...supabase, SUPABASE_PUBLISHABLE_KEY: secretKey })).toMatch(/SUPABASE_PUBLISHABLE_KEY is a secret key/);
    expect(problem({ ...supabase, SUPABASE_PUBLISHABLE_KEY: secretKey })).not.toContain(secretKey);
    const serviceRole = legacyKey('service_role');
    expect(problem({ ...supabase, SUPABASE_PUBLISHABLE_KEY: serviceRole })).toMatch(/SUPABASE_PUBLISHABLE_KEY is not a public key/);
    expect(problem({ ...supabase, SUPABASE_PUBLISHABLE_KEY: serviceRole })).not.toContain(serviceRole);
    expect(problem({ ...supabase, SUPABASE_PUBLISHABLE_KEY: 'eyJ.not-json.x' })).toMatch(/cannot be read/);
  });

  it('refuses a JWT secret too short to be the project\'s, without repeating it', () => {
    expect(problem({ ...supabase, SUPABASE_JWT_SECRET: 'hunter2' })).toMatch(/SUPABASE_JWT_SECRET must be the project's JWT secret/);
    expect(problem({ ...supabase, SUPABASE_JWT_SECRET: 'hunter2' })).not.toContain('hunter2');
  });
});

describe('loadConfig: Google and Apple', () => {
  const supabase = { AUTH_MODE: 'supabase', SUPABASE_URL: 'https://abcd.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_MjuYAHlcbXjup4pBciyVGw_QRMps_UU' };
  const problem = (env: Record<string, string>) => {
    try {
      loadConfig(env, REPO);
    } catch (err) {
      return (err as Error).message;
    }
    return '';
  };

  it('offers the providers AUTH_PROVIDERS lists, in its order, once each', () => {
    expect(loadConfig({ ...supabase, AUTH_PROVIDERS: 'google,apple' }, REPO).auth).toMatchObject({ mode: 'supabase', providers: ['google', 'apple'] });
    expect(loadConfig({ ...supabase, AUTH_PROVIDERS: ' apple , google ' }, REPO).auth).toMatchObject({ providers: ['apple', 'google'] });
    expect(loadConfig({ ...supabase, AUTH_PROVIDERS: 'google' }, REPO).auth).toMatchObject({ providers: ['google'] });
    expect(loadConfig({ ...supabase, AUTH_PROVIDERS: 'apple,apple,' }, REPO).auth).toMatchObject({ providers: ['apple'] });
  });

  it('offers none when AUTH_PROVIDERS is empty or unset: the email code alone', () => {
    expect(loadConfig(supabase, REPO).auth).toMatchObject({ providers: [] });
    for (const empty of ['', '  ', ',', ' , ']) {
      expect([empty, loadConfig({ ...supabase, AUTH_PROVIDERS: empty }, REPO).auth]).toEqual([empty, expect.objectContaining({ providers: [] })]);
    }
  });

  it('refuses to start with a provider the game does not offer, and says which', () => {
    expect(problem({ ...supabase, AUTH_PROVIDERS: 'google,facebook' })).toMatch(/AUTH_PROVIDERS takes google, apple \(comma-separated\), not "facebook"/);
    expect(problem({ ...supabase, AUTH_PROVIDERS: 'gogle, github' })).toContain('not "gogle", "github"');
    // Names are written as the list above has them.
    expect(problem({ ...supabase, AUTH_PROVIDERS: 'Google' })).toContain('not "Google"');
    // Also without sign-in, where the list is not used: the typo is found the day it is written.
    expect(problem({ AUTH_PROVIDERS: 'facebook' })).toMatch(/AUTH_PROVIDERS/);
    expect(loadConfig({ AUTH_PROVIDERS: 'google,apple' }, REPO).auth).toEqual({ mode: 'legacy' });
  });

  it('shows their buttons in dev mode too, where a tap says they need a Supabase project', () => {
    expect(loadConfig({ AUTH_MODE: 'dev', AUTH_PROVIDERS: 'google,apple' }, REPO).auth).toEqual({ mode: 'dev', providers: ['google', 'apple'] });
  });
});
