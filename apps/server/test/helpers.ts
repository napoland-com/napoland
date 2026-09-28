/**
 * For tests of the real HTTP + WebSocket stack: a server on a free port with in-memory storage and
 * the fixture maps, and WebSocket clients that keep every message they get.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import WebSocket from 'ws';
import {
  CALENDAR_DAY_MS, DROP_LIFETIME_MS, ENERGY_MAX, GUEST_DAYS, MARK_LIFETIME_MS, PROTOCOL_VERSION, utcDay, xpFor, type BagSlot, type ClientMsg, type DropView, type ItemsData, type ServerMsg,
} from '@napoland/shared';
import { devAuth } from '../src/auth';
import { setLogLevel } from '../src/log';
import { hashToken } from '../src/net';
import { startServer, type RunningServer, type ServerOptions } from '../src/server';
import { MemoryStorage, type PlayerRecord, type PurchaseRecord, type Storage } from '../src/storage';
import { signPayload, type Fetch } from '../src/stripe';
import { World, colorFor } from '../src/world';
import { chestMaps, fixtureMaps, itemsData, shopData, shopSettings } from './fixtures';

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

/**
 * A player saved in `storage` where the test wants them (in the town at the spawn, full, with an empty bag,
 * last seen a moment ago, unless `where` says otherwise: time away would fill their cup of rest).
 */
export async function savedPlayer(storage: Storage, where: Partial<PlayerRecord> = {}): Promise<{ id: string; name: string; token: string }> {
  const token = randomBytes(32).toString('base64url');
  const id = randomUUID();
  const name = newName();
  await storage.create({
    id, name, tokenHash: hashToken(token), authSub: null, map: 'town', x: 1, y: 2, dir: 'down', color: colorFor(id), energy: ENERGY_MAX, bag: [],
    createdAt: 1, lastSeenAt: Date.now(), ...where,
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
 * Outfits through a restart, over the network with dev sign-in, on `first` and then `second` (the same
 * storage, or two connections to the same database). Signed in at level 10, one player puts on the
 * survey rain cape at the chest and another takes off the NAPO work suit they wore; after the restart the
 * first comes back in the cape, and everyone who joins sees it, while the second comes back in their gear.
 */
export async function outfitsKeptThroughARestart(first: Storage, second: Storage): Promise<void> {
  setLogLevel('silent');
  const options = (storage: Storage): ServerOptions => ({ ...serverDefaults(), storage, maps: chestMaps(), items: itemsData(), auth: devAuth() });
  const who = randomUUID().slice(0, 8), sub = (name: string) => `dev:${name}-${who}@example.test`;
  const at = { map: 'house', x: 3, y: 2, dir: 'up', tokenHash: null, xp: xpFor(10) } as const;
  const ann = await savedPlayer(first, { ...at, authSub: sub('ann') });
  const cid = await savedPlayer(first, { ...at, authSub: sub('cid'), outfit: 'napo-suit' });
  const signIn = async (port: number, name: string) => {
    const c = await Client.open(port);
    c.send({ t: 'hello', v: PROTOCOL_VERSION, auth: `${name}-${who}@example.test` });
    return { c, welcome: await c.next('welcome') };
  };

  const one = await startServer(options(first));
  try {
    const a = await signIn(one.port, 'ann');
    a.c.send({ t: 'outfit', x: 3, y: 1, outfit: 'rain-cape' });
    expect(await a.c.next('outfit')).toEqual({ t: 'outfit', id: ann.id, outfit: 'rain-cape' });
    const c = await signIn(one.port, 'cid');
    expect(c.welcome.players.find(p => p.id === cid.id)?.outfit).toBe('napo-suit');
    c.c.send({ t: 'outfit', x: 3, y: 1, outfit: null });
    expect(await c.c.next('outfit', m => m.id === cid.id)).toEqual({ t: 'outfit', id: cid.id, outfit: null });
    for (const x of [a, c]) x.c.ws.terminate();
    await waitFor(() => one.world.size === 0, 'everyone to leave');
  } finally {
    await one.stop();
  }
  expect((await second.findByAuthSub(sub('ann')))?.outfit).toBe('rain-cape');
  expect((await second.findByAuthSub(sub('cid')))?.outfit).toBeUndefined();

  const two = await startServer(options(second));
  try {
    const a = await signIn(two.port, 'ann');
    expect(a.welcome.players.find(p => p.id === ann.id)?.outfit).toBe('rain-cape');
    const c = await signIn(two.port, 'cid');
    expect(c.welcome.players.find(p => p.id === ann.id)?.outfit).toBe('rain-cape');
    expect(c.welcome.players.find(p => p.id === cid.id)?.outfit).toBeUndefined();
    for (const x of [a, c]) x.c.ws.terminate();
  } finally {
    await two.stop();
  }
}

/**
 * The cup of rest through a restart, on `first` and then `second` (the same storage, or two connections to
 * the same database). Ten hours away fill it with 30 XP as the player arrives, and three nails stashed (9
 * XP) take 9 more out of it; after the restart the player comes back, straight away, with the 21 left.
 */
export async function restKeptThroughARestart(first: Storage, second: Storage): Promise<void> {
  setLogLevel('silent');
  const items: ItemsData = { ...itemsData(), items: itemsData().items.map(i => (i.id === 'nail' ? { ...i, xp: 3 } : i)) };
  const options = (storage: Storage): ServerOptions => ({ ...serverDefaults(), storage, maps: chestMaps(), items });
  const saved = await savedPlayer(first, { map: 'house', x: 3, y: 2, dir: 'up', lastSeenAt: Date.now() - 10 * 3_600_000 - 60_000, bag: [{ item: 'nail', count: 3 }] });

  const one = await startServer(options(first));
  try {
    const { c, welcome } = await loginTo(one.port, saved.token);
    expect(welcome.progress.rested).toBe(30);
    c.send({ t: 'store', x: 3, y: 1 });
    expect(await c.next('progress')).toEqual({ t: 'progress', progress: expect.objectContaining({ xp: 18, rested: 21 }), gained: 18, fromRest: 9 });
    c.ws.terminate();
    await waitFor(() => one.world.size === 0, 'the player to leave');
  } finally {
    await one.stop();
  }
  expect(await second.findByTokenHash(hashToken(saved.token))).toMatchObject({ xp: 18, rested: 21 });

  const two = await startServer(options(second));
  try {
    const { c, welcome } = await loginTo(two.port, saved.token);
    expect(welcome.progress).toMatchObject({ xp: 18, rested: 21 });
    expect(welcome.restedAway).toBeUndefined();
    c.ws.terminate();
  } finally {
    await two.stop();
  }
}

/**
 * Merits through a restart, over the network with dev sign-in, on `first` and then `second` (the same
 * storage, or two connections to the same database). Signed in with two merits' XP, a player spends one on
 * the chevron and wears it, and one on the lamp badge and wears it, then takes the badge off; after the
 * restart they come back with both bought, one merit spent each, the chevron on and no badge, and whoever
 * joins sees it; a merit is left for nobody.
 */
export async function meritsKeptThroughARestart(first: Storage, second: Storage): Promise<void> {
  setLogLevel('silent');
  const options = (storage: Storage): ServerOptions => ({ ...serverDefaults(), storage, maps: chestMaps(), items: itemsData(), auth: devAuth() });
  const who = randomUUID().slice(0, 8), mail = `merits-${who}@example.test`;
  const saved = await savedPlayer(first, { map: 'house', x: 3, y: 2, dir: 'up', tokenHash: null, authSub: `dev:${mail}`, xp: xpFor(20) + 2 * 1500 + 10 });
  const signIn = async (port: number, email: string) => {
    const c = await Client.open(port);
    c.send({ t: 'hello', v: PROTOCOL_VERSION, auth: email, name: `M ${who}` });
    return { c, welcome: await c.next('welcome') };
  };

  const one = await startServer(options(first));
  try {
    const { c, welcome } = await signIn(one.port, mail);
    expect(welcome.merits).toEqual({ spent: 0, owned: [] });
    c.send({ t: 'buy', x: 3, y: 1, look: 'chevron' });
    c.send({ t: 'pattern', x: 3, y: 1, pattern: 'chevron' });
    c.send({ t: 'buy', x: 3, y: 1, look: 'lamp' });
    c.send({ t: 'badge', x: 3, y: 1, badge: 'lamp' });
    c.send({ t: 'badge', x: 3, y: 1, badge: null });
    expect(await c.next('badge', m => m.badge === null)).toEqual({ t: 'badge', id: saved.id, badge: null });
    c.ws.terminate();
    await waitFor(() => one.world.size === 0, 'the player to leave');
  } finally {
    await one.stop();
  }
  expect(await second.findByAuthSub(`dev:${mail}`)).toMatchObject({ meritsSpent: 2, looks: ['chevron', 'lamp'], pattern: 'chevron' });
  expect((await second.findByAuthSub(`dev:${mail}`))!.badge).toBeUndefined();

  const two = await startServer(options(second));
  try {
    const { c, welcome } = await signIn(two.port, mail);
    expect(welcome.merits).toEqual({ spent: 2, owned: ['chevron', 'lamp'] });
    expect(welcome.players.find(p => p.id === saved.id)).toMatchObject({ pattern: 'chevron' });
    expect(welcome.players.find(p => p.id === saved.id)!.badge).toBeUndefined();
    // Both merits are spent: a third look waits for the next 1,500 XP.
    c.send({ t: 'buy', x: 3, y: 1, look: 'fir' });
    expect(await c.next('refused')).toEqual({ t: 'refused', action: 'buy', reason: 'no_merits' });
    c.ws.terminate();
  } finally {
    await two.stop();
  }
}

/**
 * Merits kept with a player, on `storage` (in memory, or a real database): none for a new player; what a
 * save writes (merits spent, the looks bought in their order, a pattern and a badge worn); a save without
 * them loses none (nothing bought is ever lost); and null takes off what is worn.
 */
export async function keepsMerits(storage: Storage): Promise<void> {
  const sub = `dev:${randomUUID()}@example.test`;
  // Whole, as a save writes it back (every storage fills in a stash, counts, XP and wetness), so what is read back compares as it is.
  await savedPlayer(storage, { tokenHash: null, authSub: sub, wet: 0, stats: {}, xp: 0, stash: { items: {}, out: {} } });
  const load = async () => (await storage.findByAuthSub(sub))!;
  const rec = await load();
  expect([rec.meritsSpent, rec.looks, rec.pattern, rec.badge]).toEqual([undefined, undefined, undefined, undefined]);
  const bought = { ...rec, meritsSpent: 3, looks: ['moth', 'stripes', 'fir'], pattern: 'stripes', badge: 'moth', lastSeenAt: rec.lastSeenAt + 1000 };
  await storage.save(bought);
  expect(await load()).toEqual(bought);
  const { meritsSpent: _spent, looks: _looks, pattern: _pattern, badge: _badge, ...without } = bought;
  await storage.save({ ...without, lastSeenAt: bought.lastSeenAt + 1000 });
  expect(await load()).toEqual({ ...bought, lastSeenAt: bought.lastSeenAt + 1000 });
  await storage.save({ ...bought, pattern: null, badge: null, lastSeenAt: bought.lastSeenAt + 2000 });
  expect(await load()).toMatchObject({ meritsSpent: 3, looks: ['moth', 'stripes', 'fir'] });
  expect([(await load()).pattern, (await load()).badge]).toEqual([undefined, undefined]);
  // Made with them too.
  const other = `dev:${randomUUID()}@example.test`;
  await savedPlayer(storage, { tokenHash: null, authSub: other, meritsSpent: 1, looks: ['lamp'], badge: 'lamp' });
  expect(await storage.findByAuthSub(other)).toMatchObject({ meritsSpent: 1, looks: ['lamp'], badge: 'lamp' });
}

/**
 * The cup of rest kept with a player, on `storage` (in memory, or a real database): none for a new player,
 * what a save writes, and none once it is spent; a player made with some keeps it too.
 */
export async function keepsRested(storage: Storage): Promise<void> {
  const sub = `dev:${randomUUID()}@example.test`;
  // Whole, as a save writes it back (every storage fills in a stash, counts, XP and wetness), so what is read back compares as it is.
  await savedPlayer(storage, { tokenHash: null, authSub: sub, wet: 0, stats: {}, xp: 0, stash: { items: {}, out: {} } });
  const load = async () => (await storage.findByAuthSub(sub))!;
  const rec = await load();
  expect(rec.rested).toBeUndefined();
  await storage.save({ ...rec, rested: 140, lastSeenAt: rec.lastSeenAt + 1000 });
  expect(await load()).toEqual({ ...rec, rested: 140, lastSeenAt: rec.lastSeenAt + 1000 });
  await storage.save({ ...rec, rested: 0, lastSeenAt: rec.lastSeenAt + 2000 });
  expect((await load()).rested).toBeUndefined();
  const other = `dev:${randomUUID()}@example.test`;
  await savedPlayer(storage, { tokenHash: null, authSub: other, rested: 12 });
  expect((await storage.findByAuthSub(other))!.rested).toBe(12);
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

/**
 * Play first, sign in to keep it, on `storage` (in memory, or a real database), in dev mode: a name
 * makes a guest whose token alone brings it back; signing in with that token keeps it (and from then
 * on the token alone plays it no more); an account that has a character of its own is asked first,
 * and the guest stays as it was.
 */
export async function playFirstThenSignIn(storage: Storage): Promise<void> {
  setLogLevel('silent');
  const server = await startServer({ ...serverDefaults(), storage, items: itemsData(), auth: devAuth() });
  const clients: Client[] = [];
  const say = async (hello: Partial<Extract<ClientMsg, { t: 'hello' }>>) => {
    const c = await Client.open(server.port);
    clients.push(c);
    c.send({ t: 'hello', v: PROTOCOL_VERSION, ...hello });
    return c;
  };
  const gone = (id: string) => waitFor(() => !server.world.has(id), 'the player to leave');
  try {
    const name = newName();
    const first = await say({ name });
    const guest = await first.next('welcome');
    expect(guest).toMatchObject({ name, guest: true, token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(await storage.findByTokenHash(hashToken(guest.token!))).toMatchObject({ id: guest.you, authSub: null });
    first.ws.close();
    await gone(guest.you);

    const back = await (await say({ token: guest.token })).next('welcome');
    expect(back).toMatchObject({ you: guest.you, guest: true, token: guest.token });
    // Seen as it came back: the cleanup of guests who stayed away counts from now.
    expect((await storage.findByTokenHash(hashToken(guest.token!)))!.lastSeenAt).toBeGreaterThan(Date.now() - 60_000);

    // An account that has a character already: it says so, and the guest is left as it was.
    const theirs = await (await say({ auth: 'owner@example.test', name: newName() })).next('welcome');
    const asked = await say({ auth: 'owner@example.test', token: guest.token });
    expect(await asked.next('error')).toMatchObject({ code: 'has_character', name: theirs.name });
    expect((await storage.findByTokenHash(hashToken(guest.token!)))!.authSub).toBeNull();

    // An account without one keeps the guest: the claim, and it is no guest any more.
    const kept = await (await say({ auth: 'wren@example.test', token: guest.token })).next('welcome');
    expect(kept).toMatchObject({ you: guest.you, name, claimed: true, guest: false });
    expect(kept.token).toBeUndefined();
    expect(await storage.findByAuthSub('dev:wren@example.test')).toMatchObject({ id: guest.you, tokenHash: hashToken(guest.token!) });

    // Its token alone plays it no more: only whoever signed in with it does.
    const alone = await say({ token: guest.token });
    expect(await alone.next('error')).toMatchObject({ code: 'sign_in_required' });
    expect((await alone.closed).code).toBe(1000);
  } finally {
    for (const c of clients) c.ws.terminate();
    await server.stop();
  }
}

/**
 * Guests who stayed away GUEST_DAYS are forgotten, on `storage` (in memory, or a real database, with
 * nobody else in it): with their pile, marks, links, messages, thanks and what they left in crates, and
 * their name is free again. A guest seen since, and anyone signed in however long ago, stay. Returns who
 * went, and who reported them.
 */
export async function forgetsGuestsWhoStayedAway(storage: Storage): Promise<{ away: string; reporter: string }> {
  const now = Date.now(), cutoff = now - GUEST_DAYS * 86_400_000;
  const away = await savedPlayer(storage, { lastSeenAt: cutoff - 1000 });
  const lately = await savedPlayer(storage, { lastSeenAt: cutoff + 60_000 });
  const signed = await savedPlayer(storage, { lastSeenAt: cutoff - 86_400_000, tokenHash: null, authSub: `dev:${randomUUID()}@example.test` });
  const back = await savedPlayer(storage, { lastSeenAt: cutoff - 1000 });
  await storage.saveDrop({ owner: away.id, name: away.name, map: 'woods', x: 3, y: 6, items: [{ item: 'moss', count: 1 }], droppedAt: now - 1000 });
  await storage.saveMark({ id: 7_000_001, owner: away.id, name: away.name, color: '#fff', map: 'woods', x: 3, y: 5, dir: 'up', placedAt: now - 1000 });
  await storage.setLink(away.id, signed.id, 'friend', true);
  await storage.setLink(signed.id, away.id, 'friend', true);
  await storage.addTell({ from: away.id, to: signed.id, text: 'see you out there', at: now - 1000 });
  const thanks = { day: utcDay(now), at: now - 1000, what: { kind: 'fire' as const, map: 'woods', x: 4, y: 2 }, told: false, name: '' };
  await storage.saveThanks({ ...thanks, giver: away.id, helper: signed.id });
  await storage.saveThanks({ ...thanks, giver: signed.id, helper: away.id });
  await storage.saveThanks({ ...thanks, giver: signed.id, helper: lately.id });
  await storage.saveCacheItem({ id: 7_000_002, map: 'woods', x: 4, y: 4, item: 'moss', owner: away.id, name: away.name, at: now - 1000 });
  await storage.saveCacheItem({ id: 7_000_003, map: 'woods', x: 4, y: 4, item: 'moss', owner: lately.id, name: lately.name, at: now - 1000 });
  await storage.addReport({ reporter: signed.id, reported: away.id, reason: 'spam', quote: null, at: now - 1000 });
  // Coming back counts: seen now, it stays.
  expect(await storage.seen(back.id, now)).toBe(true);
  // Only a guest is seen so: someone signed in with is no guest (a guest's hello by token loses to the claim).
  expect(await storage.seen(signed.id, now)).toBe(false);

  expect(await storage.forgetGuests(cutoff)).toEqual([away.id]);
  expect(await storage.findByTokenHash(hashToken(away.token))).toBeNull();
  expect(await storage.nameTaken(away.name)).toBe(false);
  expect((await storage.loadDrops(now - DROP_LIFETIME_MS)).map(d => d.owner)).not.toContain(away.id);
  expect((await storage.loadMarks(now, MARK_LIFETIME_MS)).map(m => m.owner)).not.toContain(away.id);
  expect(await storage.linksOf(signed.id)).toEqual([]);
  expect(await storage.tellsTo(signed.id)).toEqual([]);
  expect((await storage.loadThanks(now - 60_000)).map(t => [t.giver, t.helper])).toEqual([[signed.id, lately.id]]);
  expect((await storage.loadCacheItems()).map(c => c.owner)).toEqual([lately.id]);
  expect(await storage.seen(away.id, now)).toBe(false);
  for (const stays of [lately, signed, back]) expect(await storage.findPerson({ id: stays.id }), stays.name).not.toBeNull();
  // Nobody else has stayed away that long.
  expect(await storage.forgetGuests(cutoff)).toEqual([]);
  // The day this server began to delete guests is kept from the first time it is asked.
  const began = await storage.guestsSince(now);
  expect(await storage.guestsSince(now + 86_400_000)).toBe(began);
  return { away: away.id, reporter: signed.id };
}

/**
 * The daily parcels kept with a player, on `storage` (in memory, or a real database): none for a new
 * player, what a save writes, and a save of a record without them (one that never had a parcel) leaves
 * them as they are, as a save without a chapter leaves the story.
 */
export async function keepsParcels(storage: Storage): Promise<void> {
  const sub = `dev:${randomUUID()}@example.test`;
  await savedPlayer(storage, { tokenHash: null, authSub: sub });
  const load = async () => (await storage.findByAuthSub(sub))!;
  const rec = await load();
  expect(rec.parcels).toBeUndefined();
  const had = { ...rec, parcels: { welcome: true, day: 20_724, days: 0b101 }, lastSeenAt: rec.lastSeenAt + 1000 };
  await storage.save(had);
  expect((await load()).parcels).toEqual({ welcome: true, day: 20_724, days: 0b101 });
  const { parcels: _left, ...without } = had;
  await storage.save(without);
  expect((await load()).parcels).toEqual({ welcome: true, day: 20_724, days: 0b101 });
  await storage.save({ ...had, parcels: { welcome: true, day: 20_725, days: 0b1 } });
  expect((await load()).parcels).toEqual({ welcome: true, day: 20_725, days: 0b1 });
  // Made with them too.
  const other = `dev:${randomUUID()}@example.test`;
  await savedPlayer(storage, { tokenHash: null, authSub: other, parcels: { welcome: true, day: 20_000, days: 0b1000000 } });
  expect((await storage.findByAuthSub(other))!.parcels).toEqual({ welcome: true, day: 20_000, days: 0b1000000 });
}

/**
 * The field notes kept with a player, on `storage` (in memory, or a real database): none for a new player,
 * what a save writes, and a save of a record without them (the release before, which never writes them)
 * leaves them as they are, as a save without a chapter leaves the story.
 */
export async function keepsNotebook(storage: Storage): Promise<void> {
  const sub = `dev:${randomUUID()}@example.test`;
  await savedPlayer(storage, { tokenHash: null, authSub: sub });
  const load = async () => (await storage.findByAuthSub(sub))!;
  const rec = await load();
  expect(rec.notebook).toBeUndefined();
  const noted = { ...rec, notebook: { pages: ['glowcaps', 'pop-23'], blanks: [] }, lastSeenAt: rec.lastSeenAt + 1000 };
  await storage.save(noted);
  expect((await load()).notebook).toEqual({ pages: ['glowcaps', 'pop-23'], blanks: [] });
  const { notebook: _left, ...without } = noted;
  await storage.save(without);
  expect((await load()).notebook).toEqual({ pages: ['glowcaps', 'pop-23'], blanks: [] });
  await storage.save({ ...noted, notebook: { pages: ['glowcaps', 'pop-23', 'watchers'], blanks: ['watcher-stops'] } });
  expect((await load()).notebook).toEqual({ pages: ['glowcaps', 'pop-23', 'watchers'], blanks: ['watcher-stops'] });
  // Made with them too.
  const other = `dev:${randomUUID()}@example.test`;
  await savedPlayer(storage, { tokenHash: null, authSub: other, notebook: { pages: ['moss'], blanks: [] } });
  expect((await storage.findByAuthSub(other))!.notebook).toEqual({ pages: ['moss'], blanks: [] });
}

/**
 * First finders on `storage` (in memory, or a real database): kept with the finder's name (it comes from
 * the player), the oldest first; never written over by a later finder of the same secret; and gone with
 * a guest who stayed away, as the database's foreign key takes them.
 */
export async function keepsFirsts(storage: Storage): Promise<void> {
  const ana = await savedPlayer(storage, { lastSeenAt: 1_000 });
  const bo = await savedPlayer(storage, { authSub: `dev:${randomUUID()}@example.test`, tokenHash: null });
  const secret = `note:${randomUUID()}`, other = `keepsake:${randomUUID()}`;
  await storage.saveFirst({ secret, player: ana.id, name: ana.name, day: 3052, at: 5_000 });
  await storage.saveFirst({ secret, player: bo.id, name: bo.name, day: 3053, at: 6_000 });
  await storage.saveFirst({ secret: other, player: bo.id, name: bo.name, day: 3050, at: 4_000 });
  const mine = (await storage.loadFirsts()).filter(f => f.secret === secret || f.secret === other);
  expect(mine).toEqual([
    { secret: other, player: bo.id, name: bo.name, day: 3050, at: 4_000 },
    { secret, player: ana.id, name: ana.name, day: 3052, at: 5_000 },
  ]);
  // A guest last seen long ago goes, and their first finds with them: the secret waits for a new first finder.
  await storage.forgetGuests(2_000);
  const left = (await storage.loadFirsts()).filter(f => f.secret === secret || f.secret === other);
  expect(left.map(f => f.secret)).toEqual([other]);
}

/**
 * The notes a player read and the keepsakes they brought home, on `storage` (in memory, or a real
 * database): none for a new player, what a save writes, and a save of a record without them (the release
 * before, which never writes them) leaves them as they are.
 */
export async function keepsNotes(storage: Storage): Promise<void> {
  const sub = `dev:${randomUUID()}@example.test`;
  await savedPlayer(storage, { tokenHash: null, authSub: sub });
  const load = async () => (await storage.findByAuthSub(sub))!;
  const rec = await load();
  expect(rec.notes).toBeUndefined();
  expect(rec.keepsakes).toBeUndefined();
  const kept = { ...rec, notes: ['ranger-fires', 'walt-n8'], keepsakes: ['brass-compass'], lastSeenAt: rec.lastSeenAt + 1000 };
  await storage.save(kept);
  expect(await load()).toMatchObject({ notes: ['ranger-fires', 'walt-n8'], keepsakes: ['brass-compass'] });
  const { notes: _notes, keepsakes: _keepsakes, ...without } = kept;
  await storage.save(without);
  expect(await load()).toMatchObject({ notes: ['ranger-fires', 'walt-n8'], keepsakes: ['brass-compass'] });
  await storage.save({ ...kept, notes: [...kept.notes, 'barlow-oil'], keepsakes: [...kept.keepsakes, 'pole-tag'] });
  expect(await load()).toMatchObject({ notes: ['ranger-fires', 'walt-n8', 'barlow-oil'], keepsakes: ['brass-compass', 'pole-tag'] });
  // Made with them too.
  const other = `dev:${randomUUID()}@example.test`;
  await savedPlayer(storage, { tokenHash: null, authSub: other, notes: ['walt-truck'], keepsakes: ['tin-whistle'] });
  expect(await storage.findByAuthSub(other)).toMatchObject({ notes: ['walt-truck'], keepsakes: ['tin-whistle'] });
}

/** The best trips (world.ts, endTrip), in `storage`: kept, grown, and never lost to a save without them. */
export async function keepsBests(storage: Storage): Promise<void> {
  const sub = `dev:${randomUUID()}@example.test`;
  await savedPlayer(storage, { tokenHash: null, authSub: sub });
  const load = async () => (await storage.findByAuthSub(sub))!;
  const rec = await load();
  expect(rec.bests).toBeUndefined();
  const bests = { deepest: { map: 'near-woods', depth: 1, steps: 96 }, longestS: 660, xp: 47 };
  const kept = { ...rec, bests, lastSeenAt: rec.lastSeenAt + 1000 };
  await storage.save(kept);
  expect((await load()).bests).toEqual(bests);
  const { bests: _bests, ...without } = kept;
  await storage.save(without);
  expect((await load()).bests).toEqual(bests);
  await storage.save({ ...kept, bests: { ...bests, longestS: 900 } });
  expect((await load()).bests).toEqual({ ...bests, longestS: 900 });
}

/**
 * What a newer release saved that this one does not know, through the World and `storage` (in memory,
 * or a real database), as after a rollback to this release: items it has no definition of (in the bag,
 * in the stash with their pieces and in `out`) and counts it does not keep are never shown and never
 * lost: the player plays without them, and every save writes them back as they were, so the newer
 * release, back, finds them. `items` are this release's items (they know moss and nails, not a lantern).
 */
export async function keepsWhatANewerReleaseSaved(storage: Storage, items: ItemsData): Promise<void> {
  const lantern = { item: 'lantern', count: 1, piece: { cond: 0.5, glow: 3 } };
  const { id, token } = await savedPlayer(storage, {
    map: 'town', x: 0, y: 5,
    bag: [{ item: 'moss', count: 2 }, lantern as BagSlot, { item: 'nail', count: 1 }],
    stats: { found: 4, sparks: 9, charted: { woods: true } } as never,
    stash: { items: { moss: 1, lantern: 2 }, out: { lantern: 1 }, pieces: { lantern: [{ cond: 1, glow: 1 }, { cond: 0.2, glow: 2 }] } } as never,
  });
  const world = new World(fixtureMaps(), 'town', 'overcast', { items });
  const joined = world.join((await storage.findByTokenHash(hashToken(token)))!, 0);
  // Played without it: nothing of it is shown.
  expect(joined.bag).toEqual([{ item: 'moss', count: 2 }, { item: 'nail', count: 1 }]);
  expect(joined.stash).toEqual([{ item: 'moss', count: 1 }]);
  // A save of the player as they play writes it all back, as it was.
  await storage.save(world.get(id)!);
  const back = (await storage.findByTokenHash(hashToken(token)))!;
  expect(back.bag).toEqual([{ item: 'moss', count: 2 }, { item: 'nail', count: 1 }, lantern]);
  expect(back.stats).toEqual({ found: 4, sparks: 9, charted: { woods: true } });
  expect(back.stash).toEqual({ items: { moss: 1, lantern: 2 }, out: { lantern: 1 }, pieces: { lantern: [{ cond: 1, glow: 1 }, { cond: 0.2, glow: 2 }] } });
}

/**
 * The mark that what a player wears was counted as taken out of the stash, once (PlayerRecord.wornOut), on
 * `storage` (in memory, or a real database): kept with the counts but never among them, and never
 * forgotten by a save of a record without it.
 */
export async function keepsTheWornOutMark(storage: Storage): Promise<void> {
  const { token } = await savedPlayer(storage, { stats: { found: 2 } });
  const load = async () => (await storage.findByTokenHash(hashToken(token)))!;
  const rec = await load();
  expect(rec.wornOut).toBeUndefined();
  await storage.save({ ...rec, wornOut: true, lastSeenAt: rec.lastSeenAt + 1000 });
  const marked = await load();
  expect(marked.wornOut).toBe(true);
  expect(marked.stats).toEqual({ found: 2 });
  const { wornOut: _mark, ...without } = marked;
  await storage.save({ ...without, lastSeenAt: marked.lastSeenAt + 1000 });
  expect((await load()).wornOut).toBe(true);
}

/**
 * Tools, parcels and the outfit kept side by side in one player (on `storage`, in memory or a real
 * database): made with all three, saved with all three changed, and a save with none of them (a record
 * that never had them) loses none. Returns the player's identity and what was kept.
 */
export async function keepsToolsParcelsAndOutfit(storage: Storage): Promise<{ sub: string; kept: PlayerRecord }> {
  const sub = `dev:${randomUUID()}@example.test`;
  // Whole, as a save writes it back (every storage fills in a stash, counts, XP and wetness), so what is read back compares as it is.
  await savedPlayer(storage, {
    tokenHash: null, authSub: sub, wet: 0, stats: {}, xp: 0, stash: { items: {}, out: {} }, tools: ['stonebrook-map', 'radio'], parcels: { welcome: true, day: 20_724, days: 0b1 },
    outfit: 'napo-suit',
  });
  const load = async () => (await storage.findByAuthSub(sub))!;
  const made = await load();
  expect(made).toMatchObject({ tools: ['stonebrook-map', 'radio'], parcels: { welcome: true, day: 20_724, days: 0b1 }, outfit: 'napo-suit' });
  const later = {
    ...made, tools: [...made.tools!, 'near-woods-map'], parcels: { welcome: true, day: 20_725, days: 0b11 }, outfit: 'rain-cape', lastSeenAt: made.lastSeenAt + 1000,
  };
  await storage.save(later);
  expect(await load()).toEqual(later);
  const { tools: _tools, parcels: _parcels, outfit: _outfit, ...none } = later;
  await storage.save({ ...none, lastSeenAt: later.lastSeenAt + 1000 });
  const kept = await load();
  expect(kept).toEqual({ ...later, lastSeenAt: later.lastSeenAt + 1000 });
  return { sub, kept };
}

/**
 * One player whole, on `storage` (in memory, or a real database): made with everything a new character
 * can have (the tools, the parcels, the outfit, the furniture in their cabin, being cozy and the thanks
 * received among it), then saved whole, every field comes back as it went (a carried piece and a live
 * find in the bag, the counts, the stash with its pieces, what is worn and how worn, the chapter). A save
 * writes every field it carries but the thanks received, which only creditThanks adds to (a save from an
 * older copy of the player never undoes one), and a save without tools, parcels, an outfit or furniture
 * loses none of them; every save says whether they are cozy, where their cabin stands and whether they keep
 * their door to themselves, and the letter about their street stays read. Returns the player's identity and
 * what was kept.
 */
export async function keepsWholeRow(storage: Storage): Promise<{ sub: string; kept: PlayerRecord }> {
  const sub = `dev:${randomUUID()}@example.test`, id = randomUUID();
  const rec: PlayerRecord = {
    id, name: newName(), tokenHash: null, authSub: sub, map: 'woods', x: 3, y: 4, dir: 'left', color: colorFor(id), energy: 61.5, wet: 0.25,
    bag: [{ item: 'moss', count: 3 }, { item: 'coat', count: 1, piece: { cond: 0.5, quirk: 'hum', level: 2 } }, { item: 'spark', count: 1, since: 1_800_000_000_000 }],
    stats: { rainSteps: 40, fed: 3, made: 1, collapsed: 2, surged: 1, told: 0b101, thanked: 7 },
    xp: 120, stash: { items: { moss: 9, coat: 1 }, out: { moss: 2 }, pieces: { coat: [{ cond: 1, level: 1 }] } },
    gear: { shirt: 'coat' }, worn: { shirt: { cond: 0.75, level: 2 } }, story: 'the-lineman', tools: ['stonebrook-map', 'radio'],
    parcels: { welcome: true, day: 20_724, days: 0b1 }, outfit: 'napo-suit', notebook: { pages: ['glowcaps', 'watchers'], blanks: [] }, furniture: ['iron-stove'], cozy: 1_700_000_300_000,
    street: 2, lot: 7, doorOff: true, visitsOff: true, firstSteps: 2,
    createdAt: 1_700_000_000_123, lastSeenAt: 1_700_000_000_456,
  };
  expect(await storage.create(rec)).toBe(true);
  const load = async () => (await storage.findByAuthSub(sub))!;
  const { worn: _worn, story: _story, ...made } = rec;
  expect(await load()).toMatchObject(made);
  await storage.save(rec);
  expect(await load()).toEqual(rec);
  // Thanked meanwhile, by someone else: a save from the copy online before it leaves the count as it is.
  await storage.creditThanks(id);
  // Later: their door shown again, their neighbors let in again, and the letter about their street read.
  const { doorOff: _door, visitsOff: _visits, ...shown } = rec;
  const later: PlayerRecord = {
    ...shown, streetTold: true, map: 'town', x: 0, y: 5, dir: 'down', energy: 90, wet: 0, bag: [{ item: 'moss', count: 1 }], stats: { ...rec.stats, fed: 4, thanked: 7 }, xp: 131,
    stash: { items: { moss: 11, coat: 1 }, out: {}, pieces: { coat: [{ cond: 1, level: 1 }] } }, worn: { shirt: { cond: 1, level: 2 } }, tools: [...rec.tools!, 'near-woods-map'],
    parcels: { welcome: true, day: 20_725, days: 0b11 }, outfit: 'rain-cape', notebook: { pages: ['glowcaps', 'watchers'], blanks: ['watcher-stops'] }, furniture: ['iron-stove', 'bed'],
    cozy: 1_700_000_400_000, street: 3, lot: 0, firstSteps: 3, lastSeenAt: rec.lastSeenAt + 1000,
  };
  await storage.save(later);
  expect(await load()).toEqual({ ...later, stats: { ...later.stats, thanked: 8 } });
  // A save that carries no tools, parcels, outfit, field notes or furniture (and no thanks received) keeps them all.
  const { tools: _tools, parcels: _parcels, outfit: _outfit, notebook: _notebook, furniture: _furniture, ...none } = later;
  const { thanked: _thanked, ...counts } = later.stats!;
  await storage.save({ ...none, stats: counts, lastSeenAt: later.lastSeenAt + 1000 });
  const kept = await load();
  expect(kept).toEqual({ ...later, stats: { ...later.stats, thanked: 8 }, lastSeenAt: later.lastSeenAt + 1000 });
  // Every save says whether they are cozy: one without it, and they are not.
  const { cozy: _cozy, ...cold } = kept;
  await storage.save({ ...cold, lastSeenAt: kept.lastSeenAt + 1000 });
  expect((await load()).cozy).toBeUndefined();
  // And which of the first steps is theirs to take: one without it, and they took them all.
  const { firstSteps: _first, ...past } = kept;
  await storage.save({ ...past, lastSeenAt: kept.lastSeenAt + 1100 });
  expect((await load()).firstSteps).toBeUndefined();
  // The letter about their street, once read, stays read, even by a save without it; the door's setting and
  // who may come in are said by every save.
  const { streetTold: _told, ...untold } = kept;
  await storage.save({ ...untold, doorOff: true, visitsOff: true, lastSeenAt: kept.lastSeenAt + 1200 });
  expect(await load()).toMatchObject({ streetTold: true, doorOff: true, visitsOff: true });
  // Their lot says both, and what their cabin shows a neighbor who walks in while they are away: the furniture and the stash.
  const shows = { furniture: kept.furniture, stash: kept.stash };
  expect((await storage.loadLots()).find(l => l.id === id)).toEqual({ id, name: rec.name, street: 3, lot: 0, off: true, closed: true, ...shows });
  await storage.save({ ...kept, lastSeenAt: kept.lastSeenAt + 1300 });
  expect(await load()).not.toHaveProperty('doorOff');
  expect(await load()).not.toHaveProperty('visitsOff');
  // And where their cabin stands, which everyone's lots are read from: one without it, and it stands on none.
  expect(await storage.loadLots()).toContainEqual({ id, name: rec.name, street: 3, lot: 0, ...shows });
  const { street: _street, lot: _lot, ...unhoused } = kept;
  await storage.save({ ...unhoused, lastSeenAt: kept.lastSeenAt + 1500 });
  expect(await load()).not.toHaveProperty('street');
  expect((await storage.loadLots()).some(l => l.id === id)).toBe(false);
  await storage.save({ ...kept, lastSeenAt: kept.lastSeenAt + 2000 });
  return { sub, kept: await load() };
}

/**
 * The parcels through restarts, on `storage`: a welcome parcel the first time someone signs in; after a
 * restart the same day, nothing more; on the next calendar day, that day's parcel, into a stash that
 * kept everything. Each server's world clock reads a time of that day.
 */
export async function parcelsThroughRestarts(storage: Storage): Promise<void> {
  setLogLevel('silent');
  // Monday 28 September 2026, ten in the morning (UTC), and the day after.
  const monday = Date.UTC(2026, 8, 28, 10);
  const items: ItemsData = { ...itemsData(), parcels: { welcome: [{ item: 'tea', count: 2 }], week: Array.from({ length: 7 }, (_, i) => [{ item: 'nail', count: i + 1 }]) } };
  const signIn = async (at: number) => {
    const server = await startServer({ ...serverDefaults(), storage, items, auth: devAuth(), clockShiftMs: at - Date.now() });
    const c = await Client.open(server.port);
    try {
      c.send({ t: 'hello', v: PROTOCOL_VERSION, auth: 'parcels@example.test', name: 'Parcel Keeper' });
      await c.next('welcome');
      return (await c.settle()).flatMap(m => (m.t === 'parcel' ? [m.parcel] : []));
    } finally {
      c.ws.terminate();
      await server.stop();
    }
  };
  expect(await signIn(monday)).toEqual([{ weekday: null, items: [{ item: 'tea', count: 2 }] }]);
  expect(await signIn(monday + 3_600_000)).toEqual([]);
  expect(await signIn(monday + CALENDAR_DAY_MS)).toEqual([{ weekday: 1, items: [{ item: 'nail', count: 2 }] }]);
  const rec = (await storage.findByAuthSub('dev:parcels@example.test'))!;
  expect(rec).toMatchObject({ xp: 0, stash: { items: { tea: 2, nail: 2 }, out: {} } });
  expect(rec.parcels).toEqual({ welcome: true, day: Date.UTC(2026, 8, 29) / CALENDAR_DAY_MS, days: 0b11 });
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
  /**
   * Says hello and takes the welcome, and the energy, friends list and unread messages that follow it,
   * out of the inbox. A guest gets no friends list and no messages: those wait for sign-in.
   */
  const welcomed = async (c: Client, hello: ClientMsg) => {
    c.send(hello);
    const welcome = await c.next('welcome');
    expect(await c.next('energy')).toEqual({ t: 'energy', energy: welcome.energy, body: expect.any(Object) });
    if (welcome.guest) return welcome;
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
  expect(await storage.findPerson({ name: a.name.toUpperCase() })).toEqual({ id: a.id, name: a.name, requestsOff: false, tradesOff: false, signedIn: false });
  expect(await storage.findPerson({ id: randomUUID() })).toBeNull();
  // Whether anyone signed in with them: a guest cannot be asked to be friends.
  const signed = await savedPlayer(storage, { tokenHash: null, authSub: `dev:${randomUUID()}@example.test` });
  expect((await storage.findPerson({ id: signed.id }))?.signedIn).toBe(true);
  await storage.setRequestsOff(b.id, true);
  expect((await storage.findPerson({ id: b.id }))).toMatchObject({ requestsOff: true, tradesOff: false });
  // The two settings are apart: trade requests off leaves friend requests as they were.
  await storage.setTradesOff(a.id, true);
  expect((await storage.findPerson({ id: a.id }))).toMatchObject({ requestsOff: false, tradesOff: true });
  await storage.setTradesOff(a.id, false);
  expect((await storage.findPerson({ id: a.id }))?.tradesOff).toBe(false);

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

/**
 * A fake Stripe for the shop's tests, never the network: every checkout it is asked for is a page of its own
 * on Stripe's checkout host, and it keeps what it was asked. `failNext` makes its next answer a failure:
 * no answer at all, or an error from Stripe.
 */
export function fakeStripe() {
  const asked: Array<{ url: string; params: Record<string, string>; headers: Record<string, string> }> = [];
  let n = 0, fail: 'network' | 'error' | null = null;
  const fetch: Fetch = async (url, init) => {
    asked.push({ url, params: Object.fromEntries(new URLSearchParams(init.body)), headers: init.headers });
    const how = fail;
    fail = null;
    if (how === 'network') throw new Error('Stripe cannot be reached');
    if (how === 'error') return { ok: false, status: 500, json: async () => ({ error: { type: 'api_error' } }) };
    const id = `cs_test_fake_${++n}`;
    return { ok: true, status: 200, json: async () => ({ id, url: `https://checkout.stripe.com/c/pay/${id}` }) };
  };
  return { fetch, asked, failNext: (how: 'network' | 'error') => { fail = how; } };
}

/**
 * A Stripe event as its webhook sends it: a checkout of the game's completed (paid unless `paid` is false;
 * not the game's when `ours` is false), with what Stripe says of its customer, which the game never keeps.
 */
export function paidEvent(o: { player: string; look: string; session?: string; amount?: number; currency?: string; pi?: string | null; live?: boolean; paid?: boolean; ours?: boolean }): string {
  const session = o.session ?? `cs_test_${randomUUID()}`;
  return JSON.stringify({
    id: `evt_${randomUUID()}`, object: 'event', type: 'checkout.session.completed', livemode: o.live ?? false,
    data: {
      object: {
        id: session, object: 'checkout.session', mode: 'payment', payment_status: o.paid === false ? 'unpaid' : 'paid', amount_total: o.amount ?? 299, currency: o.currency ?? 'eur',
        payment_intent: o.pi === undefined ? `pi_${randomUUID()}` : o.pi, customer_details: { email: 'buyer@example.test', name: 'A Buyer' },
        metadata: o.ours === false ? {} : { napoland_player: o.player, napoland_look: o.look },
      },
    },
  });
}

/** A Stripe event as its webhook sends it: the charge of payment `pi` refunded, in full unless `full` is false. */
export function refundEvent(o: { pi: string; full?: boolean; live?: boolean }): string {
  return JSON.stringify({
    id: `evt_${randomUUID()}`, object: 'event', type: 'charge.refunded', livemode: o.live ?? false,
    data: { object: { id: `ch_${randomUUID()}`, object: 'charge', payment_intent: o.pi, amount: 299, amount_refunded: o.full === false ? 100 : 299, refunded: o.full !== false } },
  });
}

/**
 * Sends `body` to the webhook of the server on `port` (POST /stripe-webhook unless said), signed as Stripe
 * signs it with `secret` at `t` (seconds; now unless said), or with the header `signature` as given (none:
 * no header). Returns the status and what it answered.
 */
export function postWebhook(port: number, body: string | Buffer, sign: { secret: string; t?: number } | { signature?: string }, o: { path?: string; method?: string } = {}): Promise<{ status: number; body: string }> {
  const signature = 'secret' in sign ? signPayload(body, sign.secret, sign.t ?? Math.floor(Date.now() / 1000)) : sign.signature;
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path: o.path ?? '/stripe-webhook', method: o.method ?? 'POST', headers: { 'Content-Type': 'application/json', ...(signature !== undefined ? { 'Stripe-Signature': signature } : {}) } },
      res => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', chunk => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode!, body: text }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * Purchases kept on `storage` (in memory, or a real database): none for a new player; a checkout paid is
 * kept once however often Stripe says it; a player's looks are those of their paid purchases, each once,
 * in the order they first bought it, read with the player and never written by a save; a refund takes a
 * look back unless another payment for it stands; a purchase for a player who is gone is kept whose-less.
 * Returns the player's id and the sessions of their purchases.
 */
export async function keepsPurchases(storage: Storage): Promise<{ id: string; sessions: string[] }> {
  const sub = `dev:${randomUUID()}@example.test`;
  const { id } = await savedPlayer(storage, { tokenHash: null, authSub: sub, wet: 0, stats: {}, xp: 0, stash: { items: {}, out: {} } });
  const load = async () => (await storage.findByAuthSub(sub))!;
  expect((await load()).shop).toBeUndefined();
  expect(await storage.shopLooksOf(id)).toEqual([]);
  const at = 1_800_000_000_000, pi = `pi_${randomUUID()}`;
  const paid: PurchaseRecord = { session: `cs_test_${randomUUID()}`, player: id, look: 'winter-parka', amount: 299, currency: 'eur', paymentIntent: pi, status: 'paid', created: at, refunded: null };
  expect(await storage.addPurchase(paid)).toBe(true);
  // Stripe sends it again until it hears it arrived: kept once.
  expect(await storage.addPurchase({ ...paid, created: at + 5000 })).toBe(false);
  expect((await load()).shop).toEqual(['winter-parka']);
  // Another look, and the first bought again (two tabs at once): each look once, in the order first bought.
  const heart = { ...paid, session: `cs_test_${randomUUID()}`, paymentIntent: `pi_${randomUUID()}`, look: 'heart', amount: 99, created: at + 1000 };
  const again = { ...paid, session: `cs_test_${randomUUID()}`, paymentIntent: `pi_${randomUUID()}`, created: at + 2000 };
  expect(await storage.addPurchase(heart)).toBe(true);
  expect(await storage.addPurchase(again)).toBe(true);
  expect(await storage.shopLooksOf(id)).toEqual(['winter-parka', 'heart']);
  // A save never writes them, whatever the record says: only Stripe's word does.
  const rec = await load();
  await storage.save({ ...rec, shop: [], lastSeenAt: rec.lastSeenAt + 1000 });
  expect((await load()).shop).toEqual(['winter-parka', 'heart']);
  const { shop: _shop, ...without } = rec;
  await storage.save({ ...without, lastSeenAt: rec.lastSeenAt + 2000 });
  expect(await load()).toEqual({ ...rec, lastSeenAt: rec.lastSeenAt + 2000 });
  // The first payment refunded: the parka stays theirs by the second, now bought after the heart.
  expect(await storage.refundPurchase(pi, at + 10_000)).toEqual({ player: id, look: 'winter-parka' });
  expect(await storage.refundPurchase(pi, at + 20_000)).toBeNull();
  expect(await storage.shopLooksOf(id)).toEqual(['heart', 'winter-parka']);
  expect(await storage.refundPurchase(again.paymentIntent!, at + 30_000)).toEqual({ player: id, look: 'winter-parka' });
  expect((await load()).shop).toEqual(['heart']);
  // Another of the account's sales: nothing of the game's.
  expect(await storage.refundPurchase(`pi_${randomUUID()}`, at)).toBeNull();
  // A player gone before Stripe's word came: the payment is kept, whose-less, and nobody has its look.
  const gone = { ...paid, session: `cs_test_${randomUUID()}`, paymentIntent: null, player: randomUUID() };
  expect(await storage.addPurchase(gone)).toBe(true);
  expect(await storage.shopLooksOf(gone.player)).toEqual([]);
  return { id, sessions: [paid.session, heart.session, again.session] };
}

/**
 * The shop through a restart, over the network with dev sign-in, on `first` and then `second` (the same
 * storage, or two connections to the same database), with a fake Stripe. Signed in at the chest, a player
 * opens a payment for the winter parka; Stripe's webhook says it is paid, and they hear it at once and put it
 * on. After the restart they come back with it bought and on, and whoever joins sees it; the shop has it as
 * theirs, so a second payment for it is refused.
 */
export async function shopKeptThroughARestart(first: Storage, second: Storage): Promise<void> {
  setLogLevel('silent');
  const stripe = fakeStripe();
  const options = (storage: Storage): ServerOptions => ({
    ...serverDefaults(), storage, maps: chestMaps(), items: itemsData(), auth: devAuth(), shop: { settings: shopSettings(), catalog: shopData(), fetch: stripe.fetch },
  });
  const who = randomUUID().slice(0, 8), mail = `shop-${who}@example.test`;
  const saved = await savedPlayer(first, { map: 'house', x: 3, y: 2, dir: 'up', tokenHash: null, authSub: `dev:${mail}` });
  const signIn = async (port: number) => {
    const c = await Client.open(port);
    c.send({ t: 'hello', v: PROTOCOL_VERSION, auth: mail });
    return { c, welcome: await c.next('welcome') };
  };

  const one = await startServer(options(first));
  try {
    const { c, welcome } = await signIn(one.port);
    expect(welcome.shop).toEqual({ version: 3, owned: [], open: { currency: 'eur', terms: 'https://example.test/terms' } });
    c.send({ t: 'checkout', x: 3, y: 1, look: 'winter-parka', waiver: true });
    expect(await c.next('checkout')).toMatchObject({ look: 'winter-parka', url: expect.stringMatching(/^https:\/\/checkout\.stripe\.com\//) });
    expect(await postWebhook(one.port, paidEvent({ player: saved.id, look: 'winter-parka' }), { secret: shopSettings().webhookSecret })).toEqual({ status: 200, body: 'Kept' });
    expect(await c.next('shop')).toEqual({ t: 'shop', owned: ['winter-parka'] });
    c.send({ t: 'outfit', x: 3, y: 1, outfit: 'winter-parka' });
    expect(await c.next('outfit')).toEqual({ t: 'outfit', id: saved.id, outfit: 'winter-parka' });
    c.ws.terminate();
    await waitFor(() => one.world.size === 0, 'the player to leave');
  } finally {
    await one.stop();
  }
  expect(await second.findByAuthSub(`dev:${mail}`)).toMatchObject({ outfit: 'winter-parka', shop: ['winter-parka'] });

  const two = await startServer(options(second));
  try {
    const { c, welcome } = await signIn(two.port);
    expect(welcome.shop.owned).toEqual(['winter-parka']);
    expect(welcome.players.find(p => p.id === saved.id)).toMatchObject({ outfit: 'winter-parka' });
    c.send({ t: 'checkout', x: 3, y: 1, look: 'winter-parka', waiver: true });
    expect(await c.next('refused')).toEqual({ t: 'refused', action: 'checkout', reason: 'owned' });
    c.ws.terminate();
  } finally {
    await two.stop();
  }
}

/**
 * Two players who traded, saved together (on `storage`, in memory or a real database): both bags and
 * stashes as the swap left them, read back whole.
 */
export async function savesATradeTogether(storage: Storage): Promise<void> {
  const whole = { wet: 0, stats: {}, xp: 0, stash: { items: {}, out: {} } };
  const [a, b] = [await savedPlayer(storage, { ...whole, bag: [{ item: 'nail', count: 3 }] }), await savedPlayer(storage, { ...whole, bag: [{ item: 'tea', count: 1 }] })];
  const load = async (token: string) => (await storage.findByTokenHash(hashToken(token)))!;
  const [ra, rb] = [await load(a.token), await load(b.token)];
  const after = [
    { ...ra, bag: [{ item: 'tea', count: 1 }], stash: { items: {}, out: { tea: 1 } }, lastSeenAt: ra.lastSeenAt + 1000 },
    { ...rb, bag: [{ item: 'nail', count: 3 }], lastSeenAt: rb.lastSeenAt + 1000 },
  ];
  await storage.saveTogether(after);
  expect([await load(a.token), await load(b.token)]).toEqual(after);
}
