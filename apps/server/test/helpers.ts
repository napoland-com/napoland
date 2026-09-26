/**
 * For tests of the real HTTP + WebSocket stack: a server on a free port with in-memory storage and
 * the fixture maps, and WebSocket clients that keep every message they get.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import WebSocket from 'ws';
import { ENERGY_MAX, PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from '@napoland/shared';
import { setLogLevel } from '../src/log';
import { hashToken } from '../src/net';
import { startServer, type RunningServer, type ServerOptions } from '../src/server';
import { MemoryStorage, type PlayerRecord } from '../src/storage';
import { colorFor } from '../src/world';
import { fixtureMaps } from './fixtures';

export type Msg<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;

/** A WebSocket client that keeps every message so tests can wait for the one they want. */
export class Client {
  readonly inbox: ServerMsg[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  private readonly waiters = new Set<() => void>();

  private constructor(readonly ws: WebSocket) {
    ws.on('message', data => {
      this.inbox.push(JSON.parse(String(data)) as ServerMsg);
      for (const w of [...this.waiters]) w();
    });
    this.closed = new Promise(resolve => ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })));
  }

  /** Rejects with "Unexpected server response: <status>" if the server refuses the upgrade. */
  static open(port: number, headers: Record<string, string> = {}): Promise<Client> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
      const client = new Client(ws);
      ws.once('open', () => {
        ws.off('error', reject);
        ws.on('error', () => {});
        resolve(client);
      });
      ws.once('error', reject);
    });
  }

  send(msg: ClientMsg | string): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  /** Takes the first message of type t (received or still to come) that matches. */
  next<T extends ServerMsg['t']>(t: T, match: (m: Msg<T>) => boolean = () => true, timeoutMs = 3000): Promise<Msg<T>> {
    return new Promise((resolve, reject) => {
      const take = () => {
        const i = this.inbox.findIndex(m => m.t === t && match(m as Msg<T>));
        if (i < 0) return false;
        resolve(this.inbox.splice(i, 1)[0] as Msg<T>);
        return true;
      };
      if (take()) return;
      const waiter = () => {
        if (!take()) return;
        clearTimeout(timer);
        this.waiters.delete(waiter);
      };
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`no '${t}' message within ${timeoutMs} ms; got ${JSON.stringify(this.inbox)}`));
      }, timeoutMs);
      this.waiters.add(waiter);
    });
  }

  /** Everything the server sent before its answer to a ping sent now, taken out of the inbox. */
  async settle(): Promise<ServerMsg[]> {
    const at = Math.random();
    this.send({ t: 'ping', at });
    await this.next('pong', m => m.at === at);
    return this.inbox.splice(0);
  }
}

export async function waitFor(cond: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

/** Retries until `attempt` succeeds: the server may notice a closed socket a moment after the client does. */
export async function eventually<T>(attempt: () => Promise<T>, what: string, timeoutMs = 3000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await attempt();
    } catch (err) {
      if (Date.now() > until) throw new Error(`timed out waiting for ${what}: ${String(err)}`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}

let names = 0;
export const newName = (): string => `Player ${++names}`;

/** What every test server gets unless the test says otherwise: the fixture maps, home in the town. */
export const serverDefaults = (): ServerOptions => ({
  host: '127.0.0.1', port: 0, storage: new MemoryStorage(), maps: fixtureMaps(), homeMap: 'town',
  weather: 'rain', maxPlayers: 50, tickMs: 20, saveEveryMs: 60_000, helloTimeoutMs: 500,
});

/** Starts a server for one describe block and cleans up its clients after every test. */
export function setup(options: Partial<ServerOptions> = {}) {
  const ctx = { server: undefined as unknown as RunningServer, storage: new MemoryStorage() };
  const clients: Client[] = [];

  beforeAll(async () => {
    setLogLevel('silent');
    ctx.server = await startServer({ ...serverDefaults(), storage: ctx.storage, ...options });
  });
  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.terminate();
    await waitFor(() => ctx.server.world.size === 0, 'everyone to leave');
  });
  afterAll(async () => {
    await ctx.server?.stop();
  });

  const open = async (headers?: Record<string, string>) => {
    const c = await Client.open(ctx.server.port, headers);
    clients.push(c);
    return c;
  };
  /** Says hello and takes the welcome and the energy message that follows it out of the inbox. */
  const welcomed = async (c: Client, hello: ClientMsg) => {
    c.send(hello);
    const welcome = await c.next('welcome');
    expect(await c.next('energy')).toEqual({ t: 'energy', energy: welcome.energy });
    return welcome;
  };
  /** A new player, welcomed. */
  const join = async (name = newName()) => {
    const c = await open();
    const welcome = await welcomed(c, { t: 'hello', v: PROTOCOL_VERSION, name });
    return { c, welcome, id: welcome.you };
  };
  /** Logs in with a token (a player saved earlier), welcomed. */
  const login = async (token: string) => {
    const c = await open();
    const welcome = await welcomed(c, { t: 'hello', v: PROTOCOL_VERSION, token });
    return { c, welcome, id: welcome.you, token };
  };
  /** A player saved where the test wants them (in the town at the spawn, full, unless `where` says otherwise), welcomed. */
  const enter = async (where: Partial<PlayerRecord> = {}) => {
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    await ctx.storage.create({
      id, name: newName(), tokenHash: hashToken(token), map: 'town', x: 1, y: 2, dir: 'down', color: colorFor(id), energy: ENERGY_MAX,
      createdAt: 1, lastSeenAt: 1, ...where,
    });
    return login(token);
  };
  /** Opens a connection, sends `first` and expects an error with `code`, then the close. */
  const refused = async (first: ClientMsg | string, code: string, closeCode: number) => {
    const c = await open();
    c.send(first);
    expect(await c.next('error')).toMatchObject({ t: 'error', code, message: expect.any(String) });
    expect((await c.closed).code).toBe(closeCode);
    return c;
  };
  return { ctx, open, join, login, enter, refused };
}
