/**
 * The real HTTP + WebSocket stack on a free port, with in-memory storage and the fixture maps,
 * talked to by real WebSocket clients. Maps, exits and energy: net-maps.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { ENERGY_MAX, PROTOCOL_VERSION, TileMap } from '@napoland/shared';
import { setLogLevel } from '../src/log';
import { hashToken } from '../src/net';
import { startServer } from '../src/server';
import { MemoryStorage, type PlayerRecord } from '../src/storage';
import { colorFor } from '../src/world';
import { townData } from './fixtures';
import { Client, eventually, newName, serverDefaults, setup, waitFor } from './helpers';

/** The home town of the tests: spawn at 1,2 facing down, a rock above it, grass below. */
const town = new TileMap(townData());

describe('connecting', () => {
  const { ctx, open, join, refused } = setup({ version: '1.2.3-test' });

  it('welcomes a new player with a token, at the home spawn with full energy that holds there', async () => {
    const c = await open();
    c.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'Aldo' });
    await waitFor(() => c.inbox.length >= 4, 'the welcome, the energy, the friends list and the unread messages');
    expect(c.inbox.map(m => m.t)).toEqual(['welcome', 'energy', 'friends', 'tells']);
    const welcome = await c.next('welcome');
    const id = welcome.you;
    expect(await c.next('energy')).toEqual({ t: 'energy', energy: { value: ENERGY_MAX, max: ENERGY_MAX, rate: 0 }, body: expect.any(Object) });
    expect(welcome).toMatchObject({
      t: 'welcome', v: PROTOCOL_VERSION, name: 'Aldo', stepMs: 200, map: { id: 'town', version: 1 }, weather: 'rain',
      energy: { value: ENERGY_MAX, max: ENERGY_MAX, rate: 0 },
    });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(welcome.token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes
    expect(welcome.players).toEqual([{ id, name: 'Aldo', x: 1, y: 2, dir: 'down', color: colorFor(id), gear: {} }]);
    expect(Math.abs(welcome.serverTime - Date.now())).toBeLessThan(5000);
    // Only the token's hash is kept.
    expect(ctx.storage.get(id)).toMatchObject({ name: 'Aldo', tokenHash: hashToken(welcome.token!), map: 'town', x: 1, y: 2, energy: ENERGY_MAX });
    expect(JSON.stringify(ctx.storage.get(id))).not.toContain(welcome.token);
  });

  it('shows everyone who is online and tells them who joins and leaves', async () => {
    const a = await join();
    const b = await join('Bea');
    expect(b.welcome.players.map(p => p.id).sort()).toEqual([a.id, b.id].sort());
    expect((await a.c.next('join')).player).toEqual(b.welcome.players.find(p => p.id === b.id));
    b.c.ws.close();
    expect(await a.c.next('leave')).toEqual({ t: 'leave', id: b.id });
  });

  it('logs a player back in with the token, where they left', async () => {
    const a = await join('Rae');
    a.c.send({ t: 'step', dir: 'down', seq: 1 });
    await a.c.next('step');
    a.c.ws.close();
    await waitFor(() => !ctx.server.world.has(a.id), 'the player to leave');
    expect(ctx.storage.get(a.id)).toMatchObject({ map: 'town', x: 1, y: 3, dir: 'down' });

    const c = await open();
    c.send({ t: 'hello', v: PROTOCOL_VERSION, token: a.welcome.token });
    const again = await c.next('welcome');
    expect(again).toMatchObject({ you: a.id, name: 'Rae', token: a.welcome.token, map: { id: 'town' } });
    expect(again.players.find(p => p.id === a.id)).toMatchObject({ x: 1, y: 3, dir: 'down' });
  });

  it('replaces the old connection when a player signs in again', async () => {
    const a = await join();
    const watcher = await join();
    const c = await open();
    c.send({ t: 'hello', v: PROTOCOL_VERSION, token: a.welcome.token });
    expect(await a.c.next('error')).toMatchObject({ code: 'replaced' });
    expect((await a.c.closed).code).toBe(1000);
    expect((await c.next('welcome')).you).toBe(a.id);
    await watcher.c.next('leave', m => m.id === a.id);
    await watcher.c.next('join', m => m.player.id === a.id);
    expect(ctx.server.world.size).toBe(2);
  });

  it('refuses a name that is taken, whatever its case', async () => {
    await join('Taken');
    const c = await refused({ t: 'hello', v: PROTOCOL_VERSION, name: 'tAKEN' }, 'bad_name', 1000);
    expect(c.inbox).toEqual([]);
  });

  it('refuses names that break the rules with bad_name', async () => {
    await refused(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'x' }), 'bad_name', 1000);
    await refused(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: '<script>' }), 'bad_name', 1000);
    await refused({ t: 'hello', v: PROTOCOL_VERSION }, 'bad_name', 1000);
  });

  it('refuses unknown tokens', async () => {
    await refused({ t: 'hello', v: PROTOCOL_VERSION, token: 'x'.repeat(43) }, 'unknown_token', 1000);
  });

  it('refuses other protocol versions, even when their hello looks different', async () => {
    await refused({ t: 'hello', v: PROTOCOL_VERSION + 1, name: 'Future' }, 'bad_version', 1008);
    await refused({ t: 'hello', v: PROTOCOL_VERSION - 1, name: 'Past' }, 'bad_version', 1008);
    await refused(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION + 1, token: { kind: 'jwt' } }), 'bad_version', 1008);
  });

  it('refuses garbage and anything but hello first, and closes', async () => {
    await refused('this is not json', 'bad_message', 1008);
    await refused('{"t":"step","dir":"up","seq":1}', 'bad_message', 1008);
    await refused('{"t":"ping","at":1}', 'bad_message', 1008);
    const c = await open();
    c.ws.send(Buffer.from([1, 2, 3]), { binary: true });
    expect(await c.next('error')).toMatchObject({ code: 'bad_message' });
    expect((await c.closed).code).toBe(1008);
  });

  it('closes connections that do not say hello in time', async () => {
    const c = await open();
    expect(await c.next('error', () => true, 2000)).toMatchObject({ code: 'bad_message' });
    expect((await c.closed).code).toBe(1008);
  });

  it('closes connections that send messages larger than 1 KiB', async () => {
    const a = await join();
    a.c.send(JSON.stringify({ t: 'ping', at: 1, pad: 'x'.repeat(2000) }));
    expect((await a.c.closed).code).toBe(1009);
    await waitFor(() => !ctx.server.world.has(a.id), 'the player to leave');
  });

  it('reports the players online and the version on /health', async () => {
    await join();
    const res = await fetch(`http://127.0.0.1:${ctx.server.port}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await res.json()).toEqual({ ok: true, players: 1, uptimeSeconds: expect.any(Number), version: '1.2.3-test' });
  });
});

describe('playing', () => {
  const { ctx, join } = setup();

  it('sends a step into an open tile to both players, the seq only to the mover', async () => {
    expect(town.walkable(1, 3)).toBe(true);
    const a = await join();
    const b = await join();
    a.c.send({ t: 'step', dir: 'down', seq: 1 });
    expect(await a.c.next('step')).toStrictEqual({ t: 'step', id: a.id, x: 1, y: 3, dir: 'down', seq: 1 });
    expect(await b.c.next('step')).toStrictEqual({ t: 'step', id: a.id, x: 1, y: 3, dir: 'down' });
    expect(ctx.server.world.get(a.id)).toMatchObject({ x: 1, y: 3 });
  });

  it('rejects a step into a wall with the real position, to the mover only', async () => {
    expect(town.walkable(1, 1)).toBe(false);
    const a = await join();
    const b = await join();
    a.c.send({ t: 'step', dir: 'up', seq: 5 });
    expect(await a.c.next('reject')).toEqual({ t: 'reject', seq: 5, x: 1, y: 2, dir: 'down' });
    b.c.send({ t: 'ping', at: 1 });
    await b.c.next('pong');
    expect(b.c.inbox.filter(m => m.t === 'reject' || m.t === 'step')).toEqual([]);
  });

  it('runs steps that arrive early on the server tick, one stepMs apart', async () => {
    for (const y of [3, 4, 5]) expect(town.walkable(1, y)).toBe(true);
    const a = await join();
    const started = Date.now();
    for (const seq of [1, 2, 3]) a.c.send({ t: 'step', dir: 'down', seq });
    const steps = [await a.c.next('step'), await a.c.next('step'), await a.c.next('step')];
    expect(steps.map(s => [s.seq, s.y])).toEqual([[1, 3], [2, 4], [3, 5]]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(2 * 200 - 2 * 40);
  });

  it('tells everyone else when a player turns', async () => {
    const a = await join();
    const b = await join();
    a.c.send({ t: 'face', dir: 'left' });
    expect(await b.c.next('face')).toEqual({ t: 'face', id: a.id, dir: 'left' });
  });

  it('answers pings with the server time', async () => {
    const a = await join();
    a.c.send({ t: 'ping', at: 1234.5 });
    const pong = await a.c.next('pong');
    expect(pong.at).toBe(1234.5);
    expect(Math.abs(pong.serverTime - Date.now())).toBeLessThan(5000);
  });

  it('disconnects a client that floods messages', async () => {
    const a = await join();
    for (let i = 0; i < 100; i++) a.c.send({ t: 'ping', at: i });
    expect(await a.c.next('error')).toMatchObject({ code: 'too_fast' });
    expect((await a.c.closed).code).toBe(1008);
    const pongs = a.c.inbox.filter(m => m.t === 'pong').length;
    expect(pongs).toBeGreaterThanOrEqual(55); // the burst of 60, minus the hello
    expect(pongs).toBeLessThan(100);
  });

  it('closes on a bad message after the welcome', async () => {
    const a = await join();
    a.c.send('{"t":"teleport","x":5,"y":5}');
    expect(await a.c.next('error')).toMatchObject({ code: 'bad_message' });
    expect((await a.c.closed).code).toBe(1008);
  });
});

describe('a full server', () => {
  const { open, join, refused } = setup({ maxPlayers: 1 });

  it('refuses new players with server_full, but lets an online player sign in again', async () => {
    const a = await join();
    await refused({ t: 'hello', v: PROTOCOL_VERSION, name: newName() }, 'server_full', 1013);
    const c = await open();
    c.send({ t: 'hello', v: PROTOCOL_VERSION, token: a.welcome.token });
    expect((await c.next('welcome')).you).toBe(a.id);
    expect(await a.c.next('error')).toMatchObject({ code: 'replaced' });
  });
});

const TOO_MANY_CONNECTIONS = 'Unexpected server response: 429';
const TOO_MANY_NEW_PLAYERS = 'Too many new players from your network. Try again later.';
const forwardedFor = (value: string) => ({ 'X-Forwarded-For': value });

describe('a limit of 2 connections per address', () => {
  // Sockets that do not say hello are closed after 500 ms, so every check follows its open closely.
  const { ctx, open, join } = setup({ maxConnectionsPerIp: 2, helloTimeoutMs: 500 });

  it('answers the next upgrade with HTTP 429, and has room again when a socket closes, even during hello', async () => {
    const tooMany = () => expect(Client.open(ctx.server.port)).rejects.toThrow(TOO_MANY_CONNECTIONS);
    await join();
    const leaving = await join();
    await tooMany();

    leaving.c.ws.close();
    const badHello = await eventually(open, 'the closed socket to give its place back');
    await tooMany();

    badHello.send('this is not json');
    expect((await badHello.closed).code).toBe(1008);
    const silent = await eventually(open, 'the socket refused during hello to give its place back');
    await tooMany();

    expect((await silent.closed).code).toBe(1008); // said nothing in time
    await eventually(open, 'the socket that never said hello to give its place back');
    await tooMany();
  });
});

describe('behind our proxy (trustProxy)', () => {
  const { ctx, open } = setup({ trustProxy: true, maxConnectionsPerIp: 1, helloTimeoutMs: 5000 });

  it('counts connections by the last X-Forwarded-For entry, the one the proxy added', async () => {
    const tooMany = (headers?: Record<string, string>) => expect(Client.open(ctx.server.port, headers)).rejects.toThrow(TOO_MANY_CONNECTIONS);
    await open(forwardedFor('203.0.113.7'));
    // The same address behind an entry the client made up, or written as an IPv4-mapped IPv6 address.
    await tooMany(forwardedFor('198.51.100.1, 203.0.113.7'));
    await tooMany(forwardedFor('::ffff:203.0.113.7'));
    // Only the last entry counts, whatever the client put in front of it.
    await open(forwardedFor('203.0.113.7, 198.51.100.2'));
    await tooMany(forwardedFor('203.0.113.8, 198.51.100.2'));
    // Without the header, the socket's own address counts.
    await open();
    await tooMany();
  });
});

describe('without trustProxy', () => {
  const { ctx, open } = setup({ maxConnectionsPerIp: 1, helloTimeoutMs: 5000 });

  it('never reads X-Forwarded-For: every connection counts for the socket address', async () => {
    await open(forwardedFor('203.0.113.7'));
    await expect(Client.open(ctx.server.port, forwardedFor('198.51.100.1'))).rejects.toThrow(TOO_MANY_CONNECTIONS);
  });
});

describe('a limit of 2 new players per address', () => {
  const { open, join, refused } = setup({ trustProxy: true, newPlayersPerIpPerHour: 2 });

  it('refuses the third with bad_name, but never a sign-in with a token', async () => {
    const a = await join();
    // A taken name creates nobody, so it does not count.
    await refused({ t: 'hello', v: PROTOCOL_VERSION, name: a.welcome.name }, 'bad_name', 1000);
    await join();
    const c = await open();
    c.send({ t: 'hello', v: PROTOCOL_VERSION, name: newName() });
    expect(await c.next('error')).toEqual({ t: 'error', code: 'bad_name', message: TOO_MANY_NEW_PLAYERS });
    expect((await c.closed).code).toBe(1000);

    const again = await open();
    again.send({ t: 'hello', v: PROTOCOL_VERSION, token: a.welcome.token });
    expect((await again.next('welcome')).you).toBe(a.id);

    // Another address has places of its own.
    const other = await open(forwardedFor('203.0.113.9'));
    other.send({ t: 'hello', v: PROTOCOL_VERSION, name: newName() });
    await other.next('welcome');
  });

  it('lets a burst of hellos sent together get no further than the limit', async () => {
    /** Creating a player takes a while here, so all the hellos are in flight at the same time. */
    class SlowCreate extends MemoryStorage {
      override async create(rec: PlayerRecord): Promise<boolean> {
        await new Promise(resolve => setTimeout(resolve, 100));
        return super.create(rec);
      }
    }
    const server = await startServer({ ...serverDefaults(), storage: new SlowCreate(), helloTimeoutMs: 5000, newPlayersPerIpPerHour: 2 });
    try {
      const cs = await Promise.all(Array.from({ length: 5 }, () => Client.open(server.port)));
      for (const c of cs) c.send({ t: 'hello', v: PROTOCOL_VERSION, name: newName() });
      await waitFor(() => cs.every(c => c.inbox.length > 0), 'an answer to every hello');
      const answers = cs.map(c => c.inbox[0]!).map(m => (m.t === 'error' ? m.message : m.t));
      expect(answers.sort()).toEqual([TOO_MANY_NEW_PLAYERS, TOO_MANY_NEW_PLAYERS, TOO_MANY_NEW_PLAYERS, 'welcome', 'welcome']);
      for (const c of cs) c.ws.terminate();
    } finally {
      await server.stop();
    }
  });
});

describe('saving', () => {
  /** Its first save is slow, so it would finish after later ones if nothing kept them in order. */
  class SlowFirstSave extends MemoryStorage {
    private calls = 0;
    override async save(rec: PlayerRecord): Promise<void> {
      if (this.calls++ === 0) await new Promise(resolve => setTimeout(resolve, 400));
      return super.save(rec);
    }
  }

  it('never lets an older save of a player overwrite a newer one', async () => {
    setLogLevel('silent');
    const storage = new SlowFirstSave();
    const server = await startServer({ ...serverDefaults(), storage, maxPlayers: 10, saveEveryMs: 40 });
    try {
      const c = await Client.open(server.port);
      c.send({ t: 'hello', v: PROTOCOL_VERSION, name: newName() });
      const { you } = await c.next('welcome');
      c.send({ t: 'step', dir: 'down', seq: 1 });
      await c.next('step');
      await new Promise(resolve => setTimeout(resolve, 200)); // periodic saves of 1,3 start
      c.send({ t: 'step', dir: 'down', seq: 2 });
      expect(await c.next('step')).toMatchObject({ x: 1, y: 4 });
      c.ws.close();
      await waitFor(() => storage.get(you)?.y === 4, 'the save made when leaving', 5000);
      await new Promise(resolve => setTimeout(resolve, 600)); // an older save still running would land now
      expect(storage.get(you)).toMatchObject({ x: 1, y: 4 });
    } finally {
      await server.stop();
    }
  });
});

describe('stopping', () => {
  it('disconnects everyone with 1012 and saves them', async () => {
    setLogLevel('silent');
    const storage = new MemoryStorage();
    const server = await startServer({ ...serverDefaults(), storage, weather: 'night', maxPlayers: 10 });
    const c = await Client.open(server.port);
    c.send({ t: 'hello', v: PROTOCOL_VERSION, name: newName() });
    const { you } = await c.next('welcome');
    c.send({ t: 'step', dir: 'down', seq: 1 });
    await c.next('step');
    await server.stop();
    expect((await c.closed).code).toBe(1012);
    expect(storage.get(you)).toMatchObject({ map: 'town', x: 1, y: 3 });
    await expect(Client.open(server.port)).rejects.toThrow();
  });
});
