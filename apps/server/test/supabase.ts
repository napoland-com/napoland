/**
 * A stand-in for a Supabase project's sign-in side, for tests: an HTTP server on a free port that
 * publishes the project's public keys at /auth/v1/.well-known/jwks.json (an ES256 key, like real
 * projects, and an RS256 one), and a signer for access tokens as Supabase makes them. Tokens can be
 * made wrong in every way that matters (expired, another audience or issuer, a key the project does
 * not publish, no signature at all).
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, base64url, exportJWK, generateKeyPair, type CryptoKey } from 'jose';

export const PUBLISHABLE_KEY = 'sb_publishable_test-project-key';
/** For projects that still sign with a shared secret (HS256). */
export const JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256'; // gitleaks:allow

export interface TokenOptions {
  /** The user id; null leaves the claim out. Default: a fixed test user. */
  sub?: string | null;
  aud?: string;
  /** Default: the project's `${url}/auth/v1`. */
  iss?: string;
  /** Seconds from now until it expires (negative: already expired); null leaves exp out. Default one hour. */
  expiresIn?: number | null;
  /** More claims, like Supabase's email, role and user_metadata. */
  claims?: Record<string, unknown>;
  /** ES256 (the default, like real projects), RS256, HS256 (with `secret`, default JWT_SECRET), or none. */
  alg?: 'ES256' | 'RS256' | 'HS256' | 'none';
  secret?: string;
  /** Signed with a key the project does not publish. */
  foreignKey?: boolean;
}

export interface FakeProject {
  /** The project's address, like https://abcd.supabase.co. */
  readonly url: string;
  /** How many times the key set was fetched. */
  readonly fetches: number;
  token(o?: TokenOptions): Promise<string>;
  close(): Promise<void>;
}

export const TEST_USER = '7c1f4c2e-5b1a-4a8e-9d51-0c6f1f7c9a11';

export async function fakeSupabase(): Promise<FakeProject> {
  const ec = await generateKeyPair('ES256', { extractable: true });
  const rsa = await generateKeyPair('RS256', { extractable: true });
  const stranger = await generateKeyPair('ES256');
  const keys = [
    { ...(await exportJWK(ec.publicKey)), kid: 'test-ec', alg: 'ES256', use: 'sig' },
    { ...(await exportJWK(rsa.publicKey)), kid: 'test-rsa', alg: 'RS256', use: 'sig' },
  ];
  let fetches = 0;
  const server = createServer((req, res) => {
    if (req.url === '/auth/v1/.well-known/jwks.json') {
      fetches++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    url,
    get fetches() {
      return fetches;
    },
    async token(o = {}) {
      const now = Math.floor(Date.now() / 1000);
      const payload: Record<string, unknown> = {
        iss: o.iss ?? `${url}/auth/v1`,
        aud: o.aud ?? 'authenticated',
        iat: now,
        role: 'authenticated',
        email: 'player@example.test',
        is_anonymous: false,
        ...o.claims,
      };
      const sub = o.sub === undefined ? TEST_USER : o.sub;
      if (sub !== null) payload.sub = sub;
      const expiresIn = o.expiresIn === undefined ? 3600 : o.expiresIn;
      if (expiresIn !== null) payload.exp = now + expiresIn;
      const alg = o.alg ?? 'ES256';
      if (alg === 'none') return `${base64url.encode(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${base64url.encode(JSON.stringify(payload))}.`;
      if (alg === 'HS256') return new SignJWT(payload).setProtectedHeader({ alg, typ: 'JWT' }).sign(new TextEncoder().encode(o.secret ?? JWT_SECRET));
      const key: CryptoKey = o.foreignKey ? stranger.privateKey : alg === 'RS256' ? rsa.privateKey : ec.privateKey;
      return new SignJWT(payload).setProtectedHeader({ alg, typ: 'JWT', kid: alg === 'RS256' ? 'test-rsa' : 'test-ec' }).sign(key);
    },
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}
