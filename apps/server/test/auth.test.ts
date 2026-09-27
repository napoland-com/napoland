/**
 * Who a hello's `auth` proves, in each mode: the access tokens of a stand-in Supabase project
 * (checked against its published keys over HTTP, like the real thing), and emails in dev mode.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { devAuth, legacyAuth, supabaseAuth, type Auth } from '../src/auth';
import { JWT_SECRET, PUBLISHABLE_KEY, TEST_USER, fakeSupabase, type FakeProject } from './supabase';

describe('Supabase access tokens', () => {
  let project: FakeProject;
  let auth: Auth;
  beforeAll(async () => {
    project = await fakeSupabase();
    auth = supabaseAuth({ url: `${project.url}/`, publishableKey: PUBLISHABLE_KEY });
  });
  afterAll(() => project?.close());

  it('tells clients where the project is and its publishable key', () => {
    expect(auth.config).toEqual({ mode: 'supabase', url: project.url, publishableKey: PUBLISHABLE_KEY });
  });

  it('proves the user a good token names, signed with ES256 (as real projects do) or RS256', async () => {
    expect(await auth.identify(await project.token())).toBe(TEST_USER);
    expect(await auth.identify(await project.token({ alg: 'RS256', sub: 'rsa-user' }))).toBe('rsa-user');
  });

  it('fetches the project\'s keys once and keeps them', async () => {
    const before = project.fetches;
    for (let i = 0; i < 3; i++) expect(await auth.identify(await project.token())).toBe(TEST_USER);
    expect(project.fetches - before).toBeLessThanOrEqual(1);
  });

  it('proves nothing with a token that is expired, for another audience or project, or without a user or an expiry', async () => {
    const bad = {
      expired: await project.token({ expiresIn: -3600 }),
      'another audience': await project.token({ aud: 'anon' }),
      'another project': await project.token({ iss: 'https://someone-else.supabase.co/auth/v1' }),
      'no user': await project.token({ sub: null }),
      'no expiry': await project.token({ expiresIn: null }),
      'an empty user': await project.token({ sub: '' }),
    };
    for (const [what, token] of Object.entries(bad)) expect([what, await auth.identify(token)]).toEqual([what, undefined]);
  });

  it('allows a little clock difference, but not more', async () => {
    expect(await auth.identify(await project.token({ expiresIn: -10 }))).toBe(TEST_USER);
    expect(await auth.identify(await project.token({ expiresIn: -120 }))).toBeUndefined();
  });

  it('proves nothing with forged tokens: another key, no signature, a changed payload, a shared secret it was not given', async () => {
    const good = await project.token();
    const [header, , signature] = good.split('.');
    const otherPayload = (await project.token({ sub: 'someone-else' })).split('.')[1];
    const forged = {
      'a key the project does not publish': await project.token({ foreignKey: true }),
      'alg none': await project.token({ alg: 'none' }),
      'a changed payload': `${header}.${otherPayload}.${signature}`,
      'HS256 while the project has no shared secret here': await project.token({ alg: 'HS256' }),
    };
    for (const [what, token] of Object.entries(forged)) expect([what, await auth.identify(token)]).toEqual([what, undefined]);
  });

  it('proves nothing with things that are not tokens at all', async () => {
    for (const proof of ['', 'player@example.test', 'a.b.c', 'eyJhbGciOiJFUzI1NiJ9.e30.', 'x'.repeat(5000)]) {
      expect([proof.slice(0, 30), await auth.identify(proof)]).toEqual([proof.slice(0, 30), undefined]);
    }
  });

  it('proves nothing with the token of an anonymous user', async () => {
    expect(await auth.identify(await project.token({ claims: { is_anonymous: true } }))).toBeUndefined();
  });

  it('takes HS256 tokens signed with the project\'s shared secret when it has one, and only those', async () => {
    const withSecret = supabaseAuth({ url: project.url, publishableKey: PUBLISHABLE_KEY, jwtSecret: JWT_SECRET });
    expect(await withSecret.identify(await project.token({ alg: 'HS256', sub: 'hs-user' }))).toBe('hs-user');
    expect(await withSecret.identify(await project.token({ alg: 'HS256', secret: 'another-secret-that-is-also-long-enough' }))).toBeUndefined();
    expect(await withSecret.identify(await project.token({ alg: 'HS256', expiresIn: -3600 }))).toBeUndefined();
    // The asymmetric keys still work next to the secret.
    expect(await withSecret.identify(await project.token())).toBe(TEST_USER);
  });

  it('throws, rather than proving nothing, when the project\'s keys cannot be fetched', async () => {
    const closed = createServer();
    await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>(resolve => closed.close(() => resolve()));
    const unreachable = supabaseAuth({ url: `http://127.0.0.1:${port}`, publishableKey: PUBLISHABLE_KEY, timeoutMs: 1000 });
    await expect(unreachable.identify(await project.token())).rejects.toThrow();

    const broken = createServer((_req, res) => {
      res.writeHead(500);
      res.end();
    });
    await new Promise<void>(resolve => broken.listen(0, '127.0.0.1', resolve));
    try {
      const failing = supabaseAuth({ url: `http://127.0.0.1:${(broken.address() as AddressInfo).port}`, publishableKey: PUBLISHABLE_KEY });
      await expect(failing.identify(await project.token())).rejects.toThrow(/200 OK/);
      // A malformed token is still just a bad token: it never gets as far as the keys.
      expect(await failing.identify('not a token')).toBeUndefined();
    } finally {
      await new Promise<void>(resolve => broken.close(() => resolve()));
    }
  });
});

describe('dev sign-in', () => {
  const auth = devAuth();

  it('believes any email, whatever its case', async () => {
    expect(auth.config).toEqual({ mode: 'dev' });
    expect(await auth.identify('Ann@Example.test')).toBe('dev:ann@example.test');
    expect(await auth.identify(' bot-1@example.test ')).toBe('dev:bot-1@example.test');
  });

  it('proves nothing with what is not an email', async () => {
    for (const proof of ['', 'ann', 'ann@', '@example.test', 'ann @example.test', `${'a'.repeat(250)}@example.test`]) {
      expect([proof, await auth.identify(proof)]).toEqual([proof, undefined]);
    }
  });
});

describe('without sign-in', () => {
  it('says so, and proves nobody', async () => {
    const auth = legacyAuth();
    expect(auth.config).toEqual({ mode: 'legacy' });
    expect(await auth.identify('ann@example.test')).toBeUndefined();
  });
});
