/**
 * Signing in over the real HTTP + WebSocket stack: every way a hello can go in each mode. With
 * Supabase, the access tokens come from a stand-in project whose keys the server fetches over HTTP,
 * like the real thing; dev mode believes an email; legacy is the name and token of before.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION, type ClientMsg } from '@napoland/shared';
import { devAuth, supabaseAuth } from '../src/auth';
import { setLogLevel } from '../src/log';
import { hashToken } from '../src/net';
import { startServer } from '../src/server';
import { MemoryStorage } from '../src/storage';
import { itemsData } from './fixtures';
import { Client, newName, savedPlayer, serverDefaults, setup, signInAndClaim, waitFor } from './helpers';
import { JWT_SECRET, PUBLISHABLE_KEY, fakeSupabase, type FakeProject, type TokenOptions } from './supabase';

const hello = (more: Partial<Extract<ClientMsg, { t: 'hello' }>>): ClientMsg => ({ t: 'hello', v: PROTOCOL_VERSION, ...more });

describe('signing in with Supabase', () => {
  let project: FakeProject;
  beforeAll(async () => {
    project = await fakeSupabase();
  });
  afterAll(() => project?.close());
  const { ctx, open, refused, welcomed } = setup(() => ({
    auth: supabaseAuth({ url: project.url, publishableKey: PUBLISHABLE_KEY, jwtSecret: JWT_SECRET }),
    items: itemsData(),
  }));
  let users = 0;
  /** A token for a user of its own (or for `sub`). */
  const tokenFor = (o: TokenOptions = {}) => project.token({ sub: `user-${++users}`, ...o });

  it('tells the client on /auth-config to sign in with the project, and never lets it be cached', async () => {
    const res = await fetch(`http://127.0.0.1:${ctx.server.port}/auth-config`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await res.json()).toEqual({ mode: 'supabase', url: project.url, publishableKey: PUBLISHABLE_KEY });
  });

  it('plays a guest without an auth (a saved token, or a name), and asks to sign in a hello with nothing to go on', async () => {
    const old = await savedPlayer(ctx.storage);
    await refused(hello({}), 'sign_in_required', 1000);
    // More about guests in net-guests.test.ts: here, only that no auth claims nothing.
    expect(await welcomed(await open(), hello({ token: old.token }))).toMatchObject({ you: old.id, guest: true, token: old.token });
    expect(await welcomed(await open(), hello({ name: newName() }))).toMatchObject({ guest: true, token: expect.any(String) });
    expect((await ctx.storage.findByTokenHash(hashToken(old.token)))!.authSub).toBeNull();
  });

  it('asks to sign in again for tokens that are expired, for another audience or project, or forged', async () => {
    const tokens = [
      await tokenFor({ expiresIn: -3600 }),
      await tokenFor({ aud: 'anon' }),
      await tokenFor({ iss: 'https://someone-else.supabase.co/auth/v1' }),
      await tokenFor({ foreignKey: true }),
      await tokenFor({ alg: 'none' }),
      await tokenFor({ alg: 'HS256', secret: 'a-secret-that-is-not-the-projects-one' }),
      await tokenFor({ claims: { is_anonymous: true } }),
      'player@example.test',
    ];
    const before = await ctx.storage.count();
    for (const auth of tokens) await refused(hello({ auth, name: newName() }), 'sign_in_required', 1000);
    expect(await ctx.storage.count()).toBe(before);
  });

  it('asks a new user for a name, then makes their character, which has no token, and brings them back to it', async () => {
    const auth = await tokenFor();
    const sub = `user-${users}`;
    await refused(hello({ auth }), 'need_name', 1000);
    expect(await ctx.storage.findByAuthSub(sub)).toBeNull();

    const c = await open();
    const welcome = await welcomed(c, hello({ auth, name: 'Aldo' }));
    expect(welcome).toMatchObject({ name: 'Aldo', map: { id: 'town' } });
    expect(welcome.token).toBeUndefined();
    expect(welcome.claimed).toBeUndefined();
    expect(ctx.storage.get(welcome.you)).toMatchObject({ name: 'Aldo', authSub: sub, tokenHash: null });
    c.ws.close();
    await waitFor(() => !ctx.server.world.has(welcome.you), 'the player to leave');

    // Back with a fresh token of the same user, and without a name: the same character.
    const back = await welcomed(await open(), hello({ auth: await project.token({ sub }) }));
    expect(back).toMatchObject({ you: welcome.you, name: 'Aldo' });
  });

  it('claims a character made before sign-in with its token, once, and keeps its bag and place', async () => {
    const old = await savedPlayer(ctx.storage, { x: 0, y: 5, bag: [{ item: 'nail', count: 2 }] });
    const auth = await tokenFor();
    const sub = `user-${users}`;
    const welcome = await welcomed(await open(), hello({ auth, token: old.token }));
    expect(welcome).toMatchObject({ you: old.id, name: old.name, claimed: true, bag: [{ item: 'nail', count: 2 }] });
    expect(welcome.token).toBeUndefined();
    expect(welcome.players.find(p => p.id === old.id)).toMatchObject({ x: 0, y: 5 });
    expect(ctx.storage.get(old.id)).toMatchObject({ authSub: sub, tokenHash: hashToken(old.token) });

    // Someone else signing in on that browser later: the token claims nothing for them.
    const other = await tokenFor();
    await refused(hello({ auth: other, token: old.token }), 'need_name', 1000);
    const theirs = await welcomed(await open(), hello({ auth: other, token: old.token, name: newName() }));
    expect(theirs.you).not.toBe(old.id);
    expect(ctx.storage.get(old.id)!.authSub).toBe(sub);
  });

  it('gives a user their own character, but first says so when the hello brings a guest the account cannot keep', async () => {
    const auth = await tokenFor();
    const mine = await welcomed(await open(), hello({ auth, name: newName() }));
    const unclaimed = await savedPlayer(ctx.storage);
    // One character per account: theirs wins, and the client is told before it plays in the guest's place.
    const asked = await open();
    asked.send(hello({ auth, token: unclaimed.token, name: newName() }));
    expect(await asked.next('error')).toEqual({ t: 'error', code: 'has_character', message: expect.any(String), name: mine.name });
    expect((await asked.closed).code).toBe(1000);
    // Without the guest's token: their own character, and the guest stays as it was.
    const again = await welcomed(await open(), hello({ auth }));
    expect(again).toMatchObject({ you: mine.you, guest: false });
    expect(again.claimed).toBeUndefined();
    expect(ctx.storage.get(unclaimed.id)!.authSub).toBeNull();
    // The token of a character someone signed in with is no guest: nothing to ask.
    const taken = await savedPlayer(ctx.storage, { authSub: `user-${++users}` });
    expect((await welcomed(await open(), hello({ auth, token: taken.token }))).you).toBe(mine.you);
  });

  it('holds new characters to the name rules', async () => {
    const auth = await tokenFor();
    const taken = await welcomed(await open(), hello({ auth, name: newName() }));
    await refused(hello({ auth: await tokenFor(), name: taken.name.toUpperCase() }), 'bad_name', 1000);
    await refused(JSON.stringify(hello({ auth: await tokenFor(), name: '<script>' })), 'bad_name', 1000);
  });

  it('replaces the old connection when the same user signs in again', async () => {
    const auth = await tokenFor();
    const first = await open();
    const a = await welcomed(first, hello({ auth, name: newName() }));
    const b = await welcomed(await open(), hello({ auth: await project.token({ sub: `user-${users}` }) }));
    expect(b.you).toBe(a.you);
    expect(await first.next('error')).toMatchObject({ code: 'replaced' });
    expect(ctx.server.world.size).toBe(1);
  });

  it('takes the long hello a token with a big profile makes, but still no long game messages', async () => {
    const auth = await tokenFor({ claims: { user_metadata: { avatar_url: `https://example.test/${'a'.repeat(2500)}`, full_name: 'Aldo Rossi' } } });
    expect(auth.length).toBeGreaterThan(3000);
    const c = await open();
    await welcomed(c, hello({ auth, name: newName() }));
    c.send(JSON.stringify({ t: 'ping', at: 1, pad: 'x'.repeat(MAX_MESSAGE_BYTES) }));
    expect((await c.closed).code).toBe(1009);
  });

  it('takes the HS256 tokens of a project that signs with a shared secret, when the server has it', async () => {
    const c = await open();
    const welcome = await welcomed(c, hello({ auth: await tokenFor({ alg: 'HS256' }), name: newName() }));
    expect(ctx.storage.get(welcome.you)!.authSub).toBe(`user-${users}`);
  });
});

describe('when the project\'s keys cannot be fetched', () => {
  it('closes with 1011 (try again later), not with an error that asks to sign in again', async () => {
    setLogLevel('silent');
    const project = await fakeSupabase();
    const closed = createServer();
    await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
    await new Promise<void>(resolve => closed.close(() => resolve()));
    const server = await startServer({ ...serverDefaults(), auth: supabaseAuth({ url, publishableKey: PUBLISHABLE_KEY, timeoutMs: 1000 }) });
    try {
      const c = await Client.open(server.port);
      c.send(hello({ auth: await project.token({ iss: `${url}/auth/v1` }), name: newName() }));
      expect((await c.closed).code).toBe(1011);
      expect(c.inbox).toEqual([]);
    } finally {
      await server.stop();
      await project.close();
    }
  });
});

describe('dev sign-in', () => {
  const { ctx, open, refused, welcomed } = setup({ auth: devAuth() });

  it('tells the client on /auth-config that an email is enough', async () => {
    const res = await fetch(`http://127.0.0.1:${ctx.server.port}/auth-config`);
    expect(await res.json()).toEqual({ mode: 'dev' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('believes an email: a name for a new one, then the same character for it in any case', async () => {
    await refused(hello({ auth: 'cid@example.test' }), 'need_name', 1000);
    const first = await open();
    const welcome = await welcomed(first, hello({ auth: 'cid@example.test', name: 'Cid' }));
    expect(ctx.storage.get(welcome.you)).toMatchObject({ authSub: 'dev:cid@example.test', tokenHash: null });
    first.ws.close();
    await waitFor(() => !ctx.server.world.has(welcome.you), 'the player to leave');
    expect((await welcomed(await open(), hello({ auth: 'CID@Example.test' }))).you).toBe(welcome.you);
  });

  it('asks to sign in when the hello has nothing to go on, or an auth that is not an email', async () => {
    // (A hello with only a name makes a guest: net-guests.test.ts.)
    await refused(hello({}), 'sign_in_required', 1000);
    await refused(hello({ auth: 'not an email', name: newName() }), 'sign_in_required', 1000);
  });

  it('claims characters made before sign-in', async () => {
    await signInAndClaim(new MemoryStorage());
  });
});

describe('dev sign-in on a server with a limit of 1 new player per address', () => {
  const { ctx, open, refused, welcomed } = setup({ auth: devAuth(), newPlayersPerIpPerHour: 1 });

  it('holds new characters to the limit, but never a sign-in or a claim', async () => {
    const first = await welcomed(await open(), hello({ auth: 'one@example.test', name: newName() }));
    await refused(hello({ auth: 'two@example.test', name: newName() }), 'bad_name', 1000);
    expect((await welcomed(await open(), hello({ auth: 'one@example.test' }))).you).toBe(first.you);
    const old = await savedPlayer(ctx.storage);
    expect(await welcomed(await open(), hello({ auth: 'two@example.test', token: old.token }))).toMatchObject({ you: old.id, claimed: true });
  });
});

describe('a full server with sign-in', () => {
  const { ctx, open, refused, welcomed } = setup({ auth: devAuth(), maxPlayers: 1 });

  it('refuses new characters and claims with server_full, but lets an online player sign in again', async () => {
    const first = await open();
    const a = await welcomed(first, hello({ auth: 'full@example.test', name: newName() }));
    await refused(hello({ auth: 'late@example.test', name: newName() }), 'server_full', 1013);
    const old = await savedPlayer(ctx.storage);
    await refused(hello({ auth: 'late@example.test', token: old.token }), 'server_full', 1013);
    expect(ctx.storage.get(old.id)!.authSub).toBeNull();
    const again = await welcomed(await open(), hello({ auth: 'full@example.test' }));
    expect(again.you).toBe(a.you);
    expect(await first.next('error')).toMatchObject({ code: 'replaced' });
  });
});

describe('without sign-in (legacy)', () => {
  const { ctx, open, welcomed } = setup();

  it('tells the client on /auth-config, and ignores an auth in the hello', async () => {
    const res = await fetch(`http://127.0.0.1:${ctx.server.port}/auth-config`);
    expect(await res.json()).toEqual({ mode: 'legacy' });
    const welcome = await welcomed(await open(), hello({ auth: 'ann@example.test', name: newName() }));
    expect(welcome.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ctx.storage.get(welcome.you)).toMatchObject({ authSub: null, tokenHash: hashToken(welcome.token!) });
  });
});
