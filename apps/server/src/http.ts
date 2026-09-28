/**
 * The HTTP side: /health for load balancers, /auth-config for the client's sign-in screen and,
 * when the client has been built, its static files, so one process can serve the whole game.
 */
import { createReadStream, type Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';
import type { AuthConfig } from '@napoland/shared';
import { log } from './log';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.glb': 'model/gltf-binary',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
};

/** Vite puts a content hash in every file name under /assets/, so they never change. */
const IMMUTABLE = 'public, max-age=31536000, immutable';

export interface HttpOptions {
  /** Serve the built client from here; without it, only /health exists. */
  clientDir?: string;
  /** Players online, for /health. */
  players: () => number;
  /** The running version, for /health, so a deploy can be checked from outside. Default 'dev'. */
  version?: string;
  /** How players sign in, for /auth-config (with sign-in, the providers the card offers too). Default: without sign-in (legacy). */
  auth?: AuthConfig;
}

export function createHttpServer(opts: HttpOptions): Server {
  const root = opts.clientDir === undefined ? undefined : resolve(opts.clientDir);
  const index = root && join(root, 'index.html');
  const startedAt = Date.now();
  const version = opts.version ?? 'dev';
  const authConfig = JSON.stringify(opts.auth ?? { mode: 'legacy' });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      return reply(res, 400, 'Bad request');
    }
    if (pathname === '/health') {
      const body = JSON.stringify({ ok: true, players: opts.players(), uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), version });
      return reply(res, 200, body, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    // Never cached (reply() says no-store): after a release that changes the mode, the next page load must see it.
    if (pathname === '/auth-config') return reply(res, 200, authConfig, { 'Content-Type': 'application/json; charset=utf-8' });
    if (pathname === '/ws') return reply(res, 426, 'This is the WebSocket endpoint', { Upgrade: 'websocket' });

    const found = root && (await findFile(root, pathname));
    if (!found) return reply(res, 404, 'Not found');
    const etag = `W/"${found.st.size.toString(36)}-${Math.trunc(found.st.mtimeMs).toString(36)}"`;
    const headers = {
      'Content-Type': CONTENT_TYPES[extname(found.file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': found.file !== index && pathname.startsWith('/assets/') ? IMMUTABLE : 'no-cache',
      ETag: etag,
    };
    const inm = req.headers['if-none-match'];
    if (inm && (inm.trim() === '*' || inm.split(',').some(t => t.trim() === etag))) {
      res.writeHead(304, headers);
      return void res.end();
    }
    res.writeHead(200, { ...headers, 'Content-Length': found.st.size });
    if (req.method === 'HEAD') return void res.end();
    pipeline(createReadStream(found.file), res, () => {});
  }

  return createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    handle(req, res).catch((err: unknown) => {
      log.error('http request failed', { path: req.url?.split('?')[0], err });
      if (res.headersSent) res.destroy();
      else reply(res, 500, 'Internal error');
    });
  });
}

/**
 * The file to serve for a URL path, never outside root. Paths without an extension that match
 * no file are client-side routes and get index.html.
 */
async function findFile(root: string, pathname: string): Promise<{ file: string; st: Stats } | undefined> {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const parts = rel.split('/').filter(Boolean);
  // No "..", no hidden files, no Windows separators, drive letters or NUL bytes.
  if (parts.some(p => p.startsWith('.') || /[\\:\0]/.test(p))) return undefined;
  const file = join(root, ...parts);
  if (file !== root && !file.startsWith(root + sep)) return undefined;
  const st = await stat(file).catch(() => undefined);
  if (st?.isFile()) return { file, st };
  if (extname(parts.at(-1) ?? '')) return undefined;
  const index = join(root, 'index.html');
  const ist = await stat(index).catch(() => undefined);
  return ist?.isFile() ? { file: index, st: ist } : undefined;
}

function reply(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}
