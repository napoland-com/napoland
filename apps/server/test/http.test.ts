import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthConfig } from '@napoland/shared';
import { createHttpServer } from '../src/http';

interface Res {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/** Sends the path exactly as written (fetch would tidy up the ".." first). */
function get(port: number, path: string, headers: Record<string, string> = {}, method = 'GET'): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

describe('static files', () => {
  const base = mkdtempSync(join(tmpdir(), 'napoland-http-'));
  const root = join(base, 'dist');
  let server: Server;
  let port: number;

  beforeAll(async () => {
    mkdirSync(join(root, 'assets'), { recursive: true });
    const files: Record<string, string> = {
      'index.html': '<!doctype html><title>napoland</title>',
      'assets/index-1a2b3c.js': 'console.log(1)',
      'assets/index-4d5e6f.css': 'body{}',
      'assets/font-7a8b.woff2': 'woff2',
      'data.json': '{}',
      'logo.png': 'png',
      'logo.svg': '<svg/>',
      'favicon.ico': 'ico',
      'manifest.webmanifest': '{}',
      '.env': 'SECRET=in-root',
    };
    for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body);
    writeFileSync(join(base, 'secret.txt'), 'SECRET=outside');
    server = createHttpServer({ clientDir: root, players: () => 2, version: '0.4.1-abc1234' });
    port = await listen(server);
  });
  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    rmSync(base, { recursive: true, force: true });
  });

  it('serves index.html at / and asks browsers to revalidate it', async () => {
    const res = await get(port, '/');
    expect(res.status).toBe(200);
    expect(res.body).toContain('<title>napoland</title>');
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('serves files under /assets/ as immutable', async () => {
    const res = await get(port, '/assets/index-1a2b3c.js');
    expect(res.status).toBe(200);
    expect(res.body).toBe('console.log(1)');
    expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('sends the right content types', async () => {
    const types: Record<string, string> = {
      '/assets/index-4d5e6f.css': 'text/css; charset=utf-8',
      '/assets/font-7a8b.woff2': 'font/woff2',
      '/data.json': 'application/json; charset=utf-8',
      '/logo.png': 'image/png',
      '/logo.svg': 'image/svg+xml',
      '/favicon.ico': 'image/x-icon',
      '/manifest.webmanifest': 'application/manifest+json',
    };
    for (const [path, type] of Object.entries(types)) {
      const res = await get(port, path);
      expect([path, res.status, res.headers['content-type']]).toEqual([path, 200, type]);
      expect(res.headers['cache-control']).toBe(path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    }
  });

  it('answers client routes with index.html, but missing files with 404', async () => {
    for (const path of ['/play', '/play/room/7', '/assets']) {
      const res = await get(port, path);
      expect([path, res.status, res.headers['cache-control']]).toEqual([path, 200, 'no-cache']);
      expect(res.body).toContain('<title>napoland</title>');
    }
    for (const path of ['/missing.png', '/assets/missing.js']) expect((await get(port, path)).status).toBe(404);
  });

  it('never serves anything outside the client folder, or hidden files', async () => {
    const paths = [
      '/../secret.txt',
      '/%2e%2e/secret.txt',
      '/..%2fsecret.txt',
      '/assets/..%2f..%2fsecret.txt',
      '/%5c..%5csecret.txt',
      '/..\\secret.txt',
      '/.env',
      '/%2eenv',
      '/assets/%2e%2e%2f.env',
      '/C:%5cWindows%5cwin.ini',
      '/secret.txt%00.html',
      '/%E0%A4%A',
    ];
    for (const path of paths) {
      const res = await get(port, path);
      expect([path, res.status]).toEqual([path, 404]);
      expect(res.body).not.toContain('SECRET');
    }
  });

  it('answers HEAD without a body, 304 for a known ETag and 405 for other methods', async () => {
    const head = await get(port, '/', {}, 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    expect(Number(head.headers['content-length'])).toBeGreaterThan(0);

    const first = await get(port, '/assets/index-1a2b3c.js');
    const again = await get(port, '/assets/index-1a2b3c.js', { 'If-None-Match': first.headers.etag! });
    expect(again.status).toBe(304);
    expect(again.body).toBe('');

    const post = await get(port, '/', {}, 'POST');
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe('GET, HEAD');
  });

  it('tells plain HTTP requests to /ws to upgrade', async () => {
    const res = await get(port, '/ws');
    expect(res.status).toBe(426);
    expect(res.headers.upgrade).toBe('websocket');
  });

  it('reports the running version on /health, so a deploy can be checked from outside', async () => {
    const res = await get(port, '/health');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res.body)).toEqual({ ok: true, players: 2, uptimeSeconds: expect.any(Number), version: '0.4.1-abc1234' });
  });
});

describe('without a client folder', () => {
  let server: Server;
  let port: number;
  beforeAll(async () => {
    server = createHttpServer({ players: () => 3 });
    port = await listen(server);
  });
  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  it('only has /health and /auth-config', async () => {
    const health = await get(port, '/health');
    expect(health.status).toBe(200);
    expect(health.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(JSON.parse(health.body)).toEqual({ ok: true, players: 3, uptimeSeconds: expect.any(Number), version: 'dev' });
    for (const path of ['/', '/index.html', '/play']) expect((await get(port, path)).status).toBe(404);
  });

  it('says on /auth-config that players need no sign-in, unless told otherwise, and never lets it be cached', async () => {
    const res = await get(port, '/auth-config');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res.body)).toEqual({ mode: 'legacy' });
  });
});

describe('/auth-config with Supabase', () => {
  let server: Server;
  let port: number;
  const auth: AuthConfig = { mode: 'supabase', url: 'https://abcd.supabase.co', publishableKey: 'sb_publishable_abc', providers: ['google', 'apple'] };
  beforeAll(async () => {
    server = createHttpServer({ players: () => 0, auth });
    port = await listen(server);
  });
  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  it('hands the client the project, its publishable key and the providers it offers, even next to a built client', async () => {
    const res = await get(port, '/auth-config');
    expect([res.status, res.headers['cache-control']]).toEqual([200, 'no-store']);
    expect(JSON.parse(res.body)).toEqual({ mode: 'supabase', url: 'https://abcd.supabase.co', publishableKey: 'sb_publishable_abc', providers: ['google', 'apple'] });
    // What the client reads from it, and what a page from before the providers reads: the same without them.
    expect(AuthConfig.parse(JSON.parse(res.body))).toEqual(auth);
    expect(AuthConfig.parse({ ...JSON.parse(res.body), providers: undefined })).toEqual({ ...auth, providers: [] });
    expect((await get(port, '/auth-config', {}, 'HEAD')).body).toBe('');
  });
});
