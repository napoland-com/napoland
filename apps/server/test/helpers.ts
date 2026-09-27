/**
 * For tests of the real HTTP + WebSocket stack: a server on a free port with in-memory storage and
 * the fixture maps, and WebSocket clients that keep every message they get.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import WebSocket from 'ws';
import { DROP_LIFETIME_MS, ENERGY_MAX, PROTOCOL_VERSION, type BagSlot, type ClientMsg, type DropView, type ServerMsg } from '@napoland/shared';
import { devAuth } from '../src/auth';
import { setLogLevel } from '../src/log';
import { hashToken } from '../src/net';
import { startServer, type RunningServer, type ServerOptions } from '../src/server';
import { MemoryStorage, type PlayerRecord, type Storage } from '../src/storage';
import { colorFor } from '../src/world';
import { fixtureMaps, itemsData } from './fixtures';

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

/** A player saved in `storage` where the test wants them (in the town at the spawn, full, with an empty bag, unless `where` says otherwise). */
export async function savedPlayer(storage: Storage, where: Partial<PlayerRecord> = {}): Promise<{ id: string; name: string; token: string }> {
  const token = randomBytes(32).toString('base64url');
  const id = randomUUID();
  const name = newName();
  await storage.create({
    id, name, tokenHash: hashToken(token), authSub: null, map: 'town', x: 1, y: 2, dir: 'down', color: colorFor(id), energy: ENERGY_MAX, bag: [],
    createdAt: 1, lastSeenAt: 1, ...where,
  });
  return { id, name, token };
}

/** Logs in on the server at `port` with a saved token; the welcome, and the energy, friends list and unread messages after it, are taken out of the inbox. */
export async function loginTo(port: number, token: string): Promise<{ c: Client; welcome: Extract<ServerMsg, { t: 'welcome' }> }> {
  const c = await Client.open(port);
  c.send({ t: 'hello', v: PROTOCOL_VERSION, token });
  const welcome = await c.next('welcome');
  await c.next('energy');
  await c.next('friends');
  await c.next('tells');
  return { c, welcome };
}

/**
 * Bags and piles through a restart. A server on `first` where one player carries things and another
 * collapses with things in the bag is stopped; then a server starts on `second` (the same storage, or
 * a new connection to the same database). The bag comes back with its player, the pile lies where it
 * fell until its hour is over, and a pile older than an hour is forgotten. `stored` tells whether a
 * player's pile is in storage.
 */
export async function restartKeepsBagsAndPiles(first: Storage, second: Storage, stored: (owner: string) => Promise<boolean>): Promise<void> {
  setLogLevel('silent');
  let now = 1_000_000;
  const options = (storage: Storage): ServerOptions => ({ ...serverDefaults(), storage, items: itemsData(), weather: 'overcast', clock: () => now });
  const bag: BagSlot[] = [{ item: 'nail', count: 2 }, { item: 'tea', count: 1 }];
  const carrier = await savedPlayer(first, { map: 'town', x: 0, y: 5, bag });
  const faller = await savedPlayer(first, { map: 'woods', x: 3, y: 6, energy: 1, bag: [{ item: 'moss', count: 2 }] });
  const watcher = await savedPlayer(first, { map: 'woods', x: 4, y: 1 }); // by the campfire
  const late = await savedPlayer(first, { map: 'town', x: 0, y: 6 });

  let dropped: DropView[] = [];
  const one = await startServer(options(first));
  try {
    const c = await loginTo(one.port, carrier.token);
    const f = await loginTo(one.port, faller.token);
    now += 5000; // 1 energy lasts about 4.1 s where the faller stands
    await f.c.next('zone', m => m.reason === 'collapse');
    await eventually(async () => expect(await stored(faller.id)).toBe(true), 'the pile to be stored');
    dropped = one.world.dropViews('woods');
    expect(dropped).toEqual([expect.objectContaining({ owner: faller.id, x: 3, y: 6 })]);
    for (const x of [c, f]) x.c.ws.terminate();
  } finally {
    await one.stop();
  }
  // A pile from more than an hour ago: the server was down when it should have faded.
  await second.saveDrop({ owner: late.id, name: late.name, map: 'woods', x: 5, y: 5, items: [{ item: 'moss', count: 1 }], droppedAt: Date.now() - DROP_LIFETIME_MS - 1000 });

  now += 60_000;
  const two = await startServer(options(second));
  try {
    const w = await loginTo(two.port, watcher.token);
    expect(w.welcome.drops).toEqual(dropped);
    const c = await loginTo(two.port, carrier.token);
    expect(c.welcome.bag).toEqual(bag);
    const f = await loginTo(two.port, faller.token);
    expect(f.welcome).toMatchObject({ map: { id: 'town' }, bag: [] });
    expect(await stored(faller.id)).toBe(true);
    expect(await stored(late.id)).toBe(false);
    for (const x of [w, c, f]) x.c.ws.terminate();
  } finally {
    await two.stop();
  }
}

/**
 * Signing in with an identity (dev mode here, so on any storage): a character made before sign-in
 * is claimed with its token by the first identity that brings it, and is theirs from then on, with
 * or without the token; for anyone else the token claims nothing, and they make their own. Runs on
 * `storage` (in memory, or a real database).
 */
export async function signInAndClaim(storage: Storage): Promise<void> {
  setLogLevel('silent');
  const server = await startServer({ ...serverDefaults(), storage, items: itemsData(), auth: devAuth() });
  const clients: Client[] = [];
  const say = async (hello: Partial<Extract<ClientMsg, { t: 'hello' }>>) => {
    const c = await Client.open(server.port);
    clients.push(c);
    c.send({ t: 'hello', v: PROTOCOL_VERSION, ...hello });
    return c;
  };
  try {
    const old = await savedPlayer(storage, { map: 'town', x: 0, y: 5, bag: [{ item: 'nail', count: 3 }] });
    const ann = await (await say({ auth: 'ann@example.test', token: old.token })).next('welcome');
    expect(ann).toMatchObject({ you: old.id, name: old.name, claimed: true, bag: [{ item: 'nail', count: 3 }] });
    expect(ann.token).toBeUndefined();
    expect(ann.players.find(p => p.id === old.id)).toMatchObject({ x: 0, y: 5 });

    // Theirs from now on, even without the token (and a new sign-in replaces the old connection).
    const again = await (await say({ auth: 'ANN@example.test' })).next('welcome');
    expect(again).toMatchObject({ you: old.id, name: old.name });
    expect(again.claimed).toBeUndefined();

    // The token claims nothing for anyone else: they are asked for a name, and make their own character.
    const bobAsked = await say({ auth: 'bob@example.test', token: old.token });
    expect(await bobAsked.next('error')).toMatchObject({ code: 'need_name' });
    expect((await bobAsked.closed).code).toBe(1000);
    const name = newName();
    const bob = await (await say({ auth: 'bob@example.test', token: old.token, name })).next('welcome');
    expect(bob).toMatchObject({ name });
    expect(bob.you).not.toBe(old.id);
    expect(bob.token).toBeUndefined();
    expect(bob.claimed).toBeUndefined();

    expect(await storage.findByAuthSub('dev:ann@example.test')).toMatchObject({ id: old.id, tokenHash: hashToken(old.token), authSub: 'dev:ann@example.test' });
    expect(await storage.findByAuthSub('dev:bob@example.test')).toMatchObject({ id: bob.you, name, tokenHash: null });
    expect(await storage.findByTokenHash(hashToken(old.token))).toMatchObject({ id: old.id, authSub: 'dev:ann@example.test' });
  } finally {
    for (const c of clients) c.ws.terminate();
    await server.stop();
  }
}

/** What every test server gets unless the test says otherwise: the fixture maps, home in the town. */
export const serverDefaults = (): ServerOptions => ({
  host: '127.0.0.1', port: 0, storage: new MemoryStorage(), maps: fixtureMaps(), homeMap: 'town',
  weather: 'rain', maxPlayers: 50, tickMs: 20, saveEveryMs: 60_000, helloTimeoutMs: 500,
});

/**
 * Starts a server for one describe block and cleans up its clients after every test. `options` may
 * be a function, read when the server starts (after earlier beforeAll hooks, say one that starts a
 * stand-in Supabase project).
 */
export function setup(options: Partial<ServerOptions> | (() => Partial<ServerOptions>) = {}) {
  const ctx = { server: undefined as unknown as RunningServer, storage: new MemoryStorage() };
  const clients: Client[] = [];

  beforeAll(async () => {
    setLogLevel('silent');
    ctx.server = await startServer({ ...serverDefaults(), storage: ctx.storage, ...(typeof options === 'function' ? options() : options) });
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
  /** Says hello and takes the welcome, and the energy, friends list and unread messages that follow it, out of the inbox. */
  const welcomed = async (c: Client, hello: ClientMsg) => {
    c.send(hello);
    const welcome = await c.next('welcome');
    expect(await c.next('energy')).toEqual({ t: 'energy', energy: welcome.energy, body: expect.any(Object) });
    await c.next('friends');
    await c.next('tells');
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
  /** A player saved where the test wants them (in the town at the spawn, full, with an empty bag, unless `where` says otherwise), welcomed. */
  const enter = async (where: Partial<PlayerRecord> = {}) => login((await savedPlayer(ctx.storage, where)).token);
  /** Opens a connection, sends `first` and expects an error with `code`, then the close. */
  const refused = async (first: ClientMsg | string, code: string, closeCode: number) => {
    const c = await open();
    c.send(first);
    expect(await c.next('error')).toMatchObject({ t: 'error', code, message: expect.any(String) });
    expect((await c.closed).code).toBe(closeCode);
    return c;
  };
  return { ctx, open, join, login, enter, refused, welcomed };
}

/**
 * Links, private messages, the requests setting and reports, stored and read back: the same for
 * every storage. Links name both players; messages come oldest first and go when read.
 */
export async function keepsFriendsAndMessages(storage: Storage): Promise<void> {
  const a = await savedPlayer(storage), b = await savedPlayer(storage);
  expect(await storage.findPerson({ name: a.name.toUpperCase() })).toEqual({ id: a.id, name: a.name, requestsOff: false });
  expect(await storage.findPerson({ id: randomUUID() })).toBeNull();
  await storage.setRequestsOff(b.id, true);
  expect((await storage.findPerson({ id: b.id }))?.requestsOff).toBe(true);

  await storage.setLink(a.id, b.id, 'request', true);
  await storage.setLink(a.id, b.id, 'request', true);
  await storage.setLink(b.id, a.id, 'block', true);
  expect(await storage.linksOf(b.id)).toEqual([
    { from: a.id, to: b.id, kind: 'request', fromName: a.name, toName: b.name },
    { from: b.id, to: a.id, kind: 'block', fromName: b.name, toName: a.name },
  ]);
  await storage.setLink(a.id, b.id, 'request', false);
  await storage.setLink(b.id, a.id, 'block', false);
  expect(await storage.linksOf(a.id)).toEqual([]);

  await storage.addTell({ from: a.id, to: b.id, text: 'first', at: 1_700_000_000_000 });
  await storage.addTell({ from: a.id, to: b.id, text: 'second', at: 1_700_000_001_000 });
  expect(await storage.tellsTo(b.id)).toEqual([
    { from: a.id, fromName: a.name, to: b.id, text: 'first', at: 1_700_000_000_000 },
    { from: a.id, fromName: a.name, to: b.id, text: 'second', at: 1_700_000_001_000 },
  ]);
  await storage.deleteTells(b.id, a.id);
  expect(await storage.tellsTo(b.id)).toEqual([]);
  await storage.addReport({ reporter: a.id, reported: b.id, reason: 'spam', quote: null, at: 1_700_000_002_000 });
}
