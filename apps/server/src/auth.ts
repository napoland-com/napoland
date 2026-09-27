/**
 * Who is signing in. The server runs in one of three modes (AUTH_MODE, see config.ts), and tells
 * clients which on GET /auth-config:
 * - legacy: no sign-in. A name makes a character, a token kept in the browser logs back in (net.ts).
 * - dev: the hello's `auth` is an email, and it is believed. For development and tests only.
 * - supabase: the hello's `auth` is the access token Supabase Auth gave the client (a JWT). It is
 *   checked here against the project's public keys; Supabase only proves who someone is, the game
 *   keeps its own players in its own database.
 * Proofs (tokens, emails) are never logged.
 */
import { createRemoteJWKSet, decodeProtectedHeader, errors, jwtVerify, type JWTPayload, type JWTVerifyOptions } from 'jose';
import type { AuthConfig, AuthMode } from '@napoland/shared';
import type { AuthSettings } from './config';

export interface Auth {
  readonly mode: AuthMode;
  /** What GET /auth-config answers. */
  readonly config: AuthConfig;
  /**
   * The identity `proof` (a hello's `auth`) proves, as stored in players.auth_sub: Supabase's user id
   * (the token's `sub`), or "dev:" and the email in dev mode. Undefined when it proves nothing:
   * malformed, expired, forged, or meant for another project. Throws only when it cannot be checked
   * right now (Supabase's keys cannot be fetched), which is the server's trouble, not the player's.
   */
  identify(proof: string): Promise<string | undefined>;
}

export function createAuth(s: AuthSettings): Auth {
  if (s.mode === 'dev') return devAuth();
  if (s.mode === 'supabase') return supabaseAuth({ url: s.url, publishableKey: s.publishableKey, jwtSecret: s.jwtSecret });
  return legacyAuth();
}

export function legacyAuth(): Auth {
  return { mode: 'legacy', config: { mode: 'legacy' }, identify: async () => undefined };
}

/** Something@something, at most 254 characters: dev mode only needs a stable name for each tester. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

export function devAuth(): Auth {
  return {
    mode: 'dev',
    config: { mode: 'dev' },
    async identify(proof) {
      const email = proof.trim().toLowerCase();
      return email.length <= 254 && EMAIL_RE.test(email) ? `dev:${email}` : undefined;
    },
  };
}

export interface SupabaseAuthOptions {
  /** The project's address, like https://abcd.supabase.co. */
  url: string;
  /** The project's publishable key (public): clients need it to talk to Supabase. */
  publishableKey: string;
  /** Only for projects that still sign access tokens with a shared secret (HS256). */
  jwtSecret?: string;
  /** How long to wait for the project's keys; default 5 s. */
  timeoutMs?: number;
}

/** The algorithms Supabase's signing keys use (ECC P-256 by default, RSA, Ed25519); never "none" or a shared secret. */
const KEY_ALGORITHMS = ['ES256', 'RS256', 'EdDSA'];
/** The server's clock and Supabase's are never exactly the same. */
const CLOCK_TOLERANCE_S = 30;
/** jose's errors that mean the token is no good, as opposed to the keys being out of reach. */
const BAD_TOKEN = new Set<string>([
  'ERR_JOSE_ALG_NOT_ALLOWED',
  'ERR_JOSE_NOT_SUPPORTED',
  'ERR_JWKS_NO_MATCHING_KEY',
  'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
  'ERR_JWS_INVALID',
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JWT_CLAIM_VALIDATION_FAILED',
  'ERR_JWT_EXPIRED',
  'ERR_JWT_INVALID',
]);

export function supabaseAuth(o: SupabaseAuthOptions): Auth {
  const url = o.url.replace(/\/+$/, '');
  const issuer = `${url}/auth/v1`;
  // Fetched when first needed and kept 10 minutes; a token signed with a key it has not seen yet
  // (Supabase rotated its keys) fetches the set again, at most every 30 s.
  const keys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), { timeoutDuration: o.timeoutMs ?? 5000 });
  const secret = o.jwtSecret === undefined ? undefined : new TextEncoder().encode(o.jwtSecret);
  // A token without exp would never expire; without sub it names nobody.
  const checks: JWTVerifyOptions = { issuer, audience: 'authenticated', requiredClaims: ['exp', 'sub'], clockTolerance: CLOCK_TOLERANCE_S };

  async function verify(proof: string): Promise<JWTPayload | undefined> {
    let alg: unknown;
    try {
      alg = decodeProtectedHeader(proof).alg;
    } catch {
      return undefined;
    }
    // Each kind of key only ever checks its own algorithms, so a token cannot pass itself off as
    // the other kind (say, an HS256 token "signed" with a public key).
    if (alg === 'HS256') return secret && (await jwtVerify(proof, secret, { ...checks, algorithms: ['HS256'] })).payload;
    return (await jwtVerify(proof, keys, { ...checks, algorithms: KEY_ALGORITHMS })).payload;
  }

  return {
    mode: 'supabase',
    config: { mode: 'supabase', url, publishableKey: o.publishableKey },
    async identify(proof) {
      let payload: JWTPayload | undefined;
      try {
        payload = await verify(proof);
      } catch (err) {
        if (err instanceof errors.JOSEError && BAD_TOKEN.has(err.code)) return undefined;
        throw err;
      }
      // A project that allows anonymous sign-ins hands out real tokens that prove nobody in particular.
      if (!payload || payload.is_anonymous === true) return undefined;
      const { sub } = payload;
      return typeof sub === 'string' && sub.length > 0 && sub.length <= 255 ? sub : undefined;
    },
  };
}
