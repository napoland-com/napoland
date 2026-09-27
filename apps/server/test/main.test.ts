/**
 * The real entry point (src/main.ts, run the way `npm run dev -w @napoland/server` runs it): dev
 * sign-in lets anyone be anyone, so a production server must refuse to start with it by a slip.
 */
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SERVER = fileURLToPath(new URL('..', import.meta.url));
/** A clean environment: the developer's own settings must not change what is tested. */
const env = (more: Record<string, string>) => {
  const { AUTH_MODE: _a, ALLOW_DEV_AUTH: _b, DATABASE_URL: _c, NODE_ENV: _d, SUPABASE_URL: _e, ...rest } = process.env;
  return { ...rest, PORT: '0', HOST: '127.0.0.1', LOG_LEVEL: 'info', ...more };
};
const args = ['--import', 'tsx', 'src/main.ts'];

describe('starting the server', () => {
  it('refuses AUTH_MODE=dev when NODE_ENV=production', () => {
    const r = spawnSync(process.execPath, args, { cwd: SERVER, env: env({ AUTH_MODE: 'dev', NODE_ENV: 'production' }), encoding: 'utf8', timeout: 20_000 });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/startup failed/);
    expect(r.stdout).toMatch(/AUTH_MODE=dev lets anyone sign in as anyone/);
  });

  it('starts with it when ALLOW_DEV_AUTH=1 says this is a test server, and warns', async () => {
    const p = spawn(process.execPath, args, { cwd: SERVER, env: env({ AUTH_MODE: 'dev', NODE_ENV: 'production', ALLOW_DEV_AUTH: '1' }) });
    let out = '';
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`the server did not start: ${out}`)), 20_000);
        p.stdout.on('data', (chunk: Buffer) => {
          out += chunk.toString('utf8');
          if (out.includes('"server started"')) {
            clearTimeout(timer);
            resolve();
          }
        });
        p.on('exit', code => {
          clearTimeout(timer);
          reject(new Error(`the server exited with ${code}: ${out}`));
        });
      });
    } finally {
      p.kill();
    }
    const lines = out.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toContainEqual(expect.objectContaining({ level: 'warn', msg: expect.stringMatching(/dev sign-in: anyone can sign in as anyone/) }));
    expect(lines).toContainEqual(expect.objectContaining({ msg: 'server started', signIn: 'dev' }));
  });
});
