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
      port: 8080, host: '0.0.0.0', databaseUrl: undefined, weather: 'rain',
      maxPlayers: 500, tickMs: 50, saveEveryMs: 15_000, logLevel: 'info',
      trustProxy: false, maxConnectionsPerIp: 20, newPlayersPerIpPerHour: 10, version: 'dev',
    });
    expect(cfg.mapFile).toBe(join(REPO, 'content', 'maps', 'stonebrook.json'));
    expect(cfg.migrationsDir).toBe(join(REPO, 'apps', 'server', 'migrations'));
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

  it('fails when the map or an explicit folder cannot be found', () => {
    expect(() => loadConfig({ MAP_FILE: 'nope.json' }, REPO)).toThrow(/MAP_FILE must point to an existing file/);
    expect(() => loadConfig({ CLIENT_DIR: `nope${sep}dist` }, REPO)).toThrow(/CLIENT_DIR/);
    expect(() => loadConfig({}, tmpdir())).toThrow(/MAP_FILE is not set/);
  });
});
