/**
 * Signing in through Supabase Auth: an email and a 6-digit code sent to it, or Google or Apple.
 * supabase-js keeps the session in this browser's localStorage and refreshes its access token while
 * the game runs; the game server only ever sees that token. Loaded only when the server asks for
 * Supabase sign-in, so the game does not download it otherwise.
 *
 * Every sign-in uses the PKCE flow: for Google and Apple the page goes to the provider through
 * Supabase, keeping a one-time secret here, and comes back to the game's address with a code that only
 * that secret turns into a session, so a code caught on the way is worth nothing. supabase-js exchanges
 * it as it starts (detectSessionInUrl). The email code is checked directly. Never the implicit flow:
 * that one takes a whole session from any address the page is opened at, so a link carrying someone
 * else's session in its fragment would sign this browser in to their account without a word.
 */
import { createClient, isAuthRetryableFetchError, type AuthError } from '@supabase/supabase-js';
import { AuthProblem, type AuthBackend } from './signin';

export function supabaseBackend(url: string, publishableKey: string): AuthBackend {
  const { auth } = createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  });
  // Starting, supabase-js reads a provider's answer from the address and takes out a code it used, but
  // leaves an error, or a code it could not use: tidied once it has read them, so a reload does not
  // read them again and the address can be shared.
  void auth.initialize().then(tidyAddress, tidyAddress);
  return {
    async session() {
      // Refreshes the access token first when it is about to expire.
      const { data, error } = await auth.getSession();
      if (data.session) return { token: data.session.access_token, email: data.session.user?.email ?? null };
      if (error && isAuthRetryableFetchError(error)) throw new AuthProblem('offline');
      return null;
    },
    async sendCode(email) {
      const { error } = await auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) throw problem(error);
    },
    async verifyCode(email, code) {
      const { data, error } = await auth.verifyOtp({ email, token: code, type: 'email' });
      if (error) throw problem(error, 'verify');
      if (!data.session) throw new AuthProblem('other');
    },
    async signInWith(provider, returnTo) {
      // Goes to the provider's page (location.assign) once the secret is kept.
      const { error } = await auth.signInWithOAuth({ provider, options: returnTo ? { redirectTo: returnTo } : {} });
      if (error) throw problem(error);
    },
    async refresh() {
      const { data, error } = await auth.refreshSession();
      if (data.session) return true;
      if (error && isAuthRetryableFetchError(error)) throw new AuthProblem('offline');
      return false;
    },
    async signOut() {
      // This browser only: signing out here must not sign you out on your other devices.
      await auth.signOut({ scope: 'local' });
    },
  };
}

/** What Supabase adds to the game's address coming back from Google or Apple (in the query, and errors in the fragment too). */
const ANSWER_PARAMS = ['code', 'sb_flow_id', 'error', 'error_code', 'error_description'];
/** A whole session in the fragment, as the implicit flow hands one over: never ours (PKCE), so it goes too. */
const SESSION_PARAMS = ['access_token', 'refresh_token'];

/** The address without a provider's answer (or a session someone put in its fragment) in it, or null when it has none. */
export function withoutAnswer(href: string): string | null {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const inQuery = ANSWER_PARAMS.filter(p => url.searchParams.has(p));
  const inHash = [...ANSWER_PARAMS, ...SESSION_PARAMS].some(p => hash.has(p));
  if (!inQuery.length && !inHash) return null;
  for (const p of inQuery) url.searchParams.delete(p);
  if (inHash) url.hash = '';
  return url.href;
}

function tidyAddress(): void {
  const href = withoutAnswer(location.href);
  if (href) history.replaceState(history.state, '', href);
}

function problem(error: AuthError, step: 'send' | 'verify' = 'send'): AuthProblem {
  if (isAuthRetryableFetchError(error)) return new AuthProblem('offline');
  switch (error.code) {
    // Supabase says this for a wrong code too, not only for an old one.
    case 'otp_expired':
      return new AuthProblem('bad_code');
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit': {
      // "For security purposes, you can only request this after 42 seconds."
      const seconds = /(\d+)\s*seconds?/i.exec(error.message)?.[1];
      return new AuthProblem('rate_limited', seconds === undefined ? undefined : Number(seconds));
    }
    case 'email_address_invalid':
      return new AuthProblem('bad_email');
    case 'validation_failed':
      return new AuthProblem(step === 'verify' ? 'bad_code' : 'bad_email');
    // email_address_not_authorized: Supabase's own mail service only writes to the project's team;
    // everyone else needs the project to send through its own mail service (see OPERATIONS.md).
    case 'email_address_not_authorized':
    case 'signup_disabled':
    case 'otp_disabled':
    case 'email_provider_disabled':
      return new AuthProblem('closed');
  }
  return new AuthProblem(error.status === 429 ? 'rate_limited' : 'other');
}
