/**
 * Signing in through Supabase Auth: an email, and a 6-digit code sent to it. supabase-js keeps the
 * session in this browser's localStorage and refreshes its access token while the game runs; the
 * game server only ever sees that token. Loaded only when the server asks for Supabase sign-in, so
 * the game does not download it otherwise. Google and Apple will come through the same client
 * (signInWithOAuth), next to the email.
 */
import { createClient, isAuthRetryableFetchError, type AuthError } from '@supabase/supabase-js';
import { AuthProblem, type AuthBackend } from './signin';

export function supabaseBackend(url: string, publishableKey: string): AuthBackend {
  const { auth } = createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
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
