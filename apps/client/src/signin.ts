/**
 * Signing in, as a small state machine with no page and no network of its own (both are handed
 * in), so it can be tested: which card the overlay shows, what the hello says, and what to do with
 * the server's answers. The server picks the mode (GET /auth-config, see shared/protocol.ts):
 * - legacy: the name card; the token the welcome brings is kept in this browser and logs back in.
 * - dev: "Your email (development: no code)", then play.
 * - supabase: "Your email" and "Send me a code", then the 6-digit code from the email, then play.
 *   Supabase keeps the session in this browser and refreshes it (supabase.ts).
 * With sign-in, a token kept here from before goes with every hello: the character it belongs to
 * becomes yours if nobody has claimed it yet. Someone without a character is asked for a name.
 */
import { AuthConfig, NAME_RE, PROTOCOL_VERSION, type AuthMode, type ClientMsg, type ErrorCode, type ServerMsg } from '@napoland/shared';

/** What this browser keeps: the token of a character made without sign-in (legacy). */
export const TOKEN_KEY = 'napoland.token';
/** The email signed in with in dev mode, kept by the tab: each tab can be someone else. (Supabase keeps its own session.) */
export const DEV_EMAIL_KEY = 'napoland.devEmail';
/**
 * Where a code was sent and when, so a reload (say the phone dropped the page while you read your
 * mail) comes back to the code card.
 */
export const CODE_SENT_KEY = 'napoland.codeSent';

export const CODE_LENGTH = 6;
/** Supabase sends one code per address a minute; asking sooner only brings an error. */
export const RESEND_AFTER_MS = 60_000;
/** Codes work for an hour (Supabase's default). */
const CODE_LIFETIME_MS = 3_600_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface Store {
  get(key: string): string | null;
  set(key: string, value: string): void;
  del(key: string): void;
}

/** A Supabase session: its access token (for the hello) and whose it is. */
export interface Session {
  token: string;
  email: string | null;
}

export type ProblemKind = 'bad_code' | 'bad_email' | 'rate_limited' | 'offline' | 'closed' | 'other';

/** What went wrong talking to Supabase, in terms the cards can explain. */
export class AuthProblem extends Error {
  constructor(
    readonly kind: ProblemKind,
    /** Rate limited: how long until it may ask again, when Supabase said. */
    readonly retryInS?: number,
  ) {
    super(kind);
    this.name = 'AuthProblem';
  }
}

/** What the flow needs from Supabase: supabase.ts has the real one, tests a fake. Failures throw AuthProblem. */
export interface AuthBackend {
  /** The session kept here, refreshed first if it is about to expire; null when signed out. Throws when that cannot be told now (offline). */
  session(): Promise<Session | null>;
  /** Emails a code, making the account if the address is new. */
  sendCode(email: string): Promise<void>;
  /** Checks the code; afterwards session() has the new session. */
  verifyCode(email: string, code: string): Promise<void>;
  /** Gets a new access token now; false when the session is gone. */
  refresh(): Promise<boolean>;
  signOut(): Promise<void>;
}

/** What the overlay shows. */
export type Screen =
  /** Nothing: playing. */
  | { kind: 'none' }
  | { kind: 'message'; text: string; button?: { label: string; run: () => void } }
  | { kind: 'email'; dev: boolean; email: string; error: string; busy: boolean }
  | { kind: 'code'; email: string; error: string; note: string; busy: boolean; resendAt: number }
  /** Without sign-in, the first card; with sign-in, "Choose a name for your character" (`who` is signed in). */
  | { kind: 'name'; signedIn: boolean; who: string | null; error: string };

export interface SignInOptions {
  config: AuthConfig;
  /** Supabase, in supabase mode. */
  backend?: AuthBackend;
  /** What this browser keeps (localStorage). */
  store: Store;
  /** What this tab keeps (sessionStorage): the dev email. Default: `store`. */
  tab?: Store;
  /** Wall clock time in ms (Date.now): a code sent must outlive a reload. */
  now: () => number;
  /** Starts the game connection, which asks hello() what to say each time it connects. */
  connect(): void;
  disconnect(): void;
  /** Called with every new screen. */
  show(screen: Screen): void;
  /** Loads the page again, for a server that now wants another sign-in than this page knows. */
  reload(): void;
  /** Asks the server how it wants players to sign in now (it may have changed since this page loaded). */
  serverMode?: () => Promise<AuthMode>;
}

type Welcome = Extract<ServerMsg, { t: 'welcome' }>;

export class SignIn {
  screen: Screen = { kind: 'message', text: 'Loading...' };
  /** Set by a welcome that claimed a character made before sign-in. */
  claimed = false;
  /** The name for a new character, sent until the welcome. */
  private name: string | null = null;
  /** Where the last code went, and when. */
  private email = '';
  private sentAt = -Infinity;
  /** A refresh was tried since the last welcome: the next sign_in_required asks to sign in. */
  private refreshed = false;
  /** Who is signed in, for the name card. */
  private who: string | null = null;

  constructor(private readonly o: SignInOptions) {}

  get mode(): AuthMode {
    return this.o.config.mode;
  }

  /** Plays at once with what this browser remembers, or asks. */
  async start(): Promise<void> {
    const { store } = this.o;
    if (this.mode === 'legacy') return store.get(TOKEN_KEY) ? this.play() : this.askName();
    if (this.mode === 'dev') return this.tab.get(DEV_EMAIL_KEY) ? this.play() : this.askEmail();
    let session: Session | null;
    try {
      session = await this.backend.session();
    } catch {
      // There is a session to refresh, and Supabase is out of reach for now: the connection keeps trying.
      return this.play();
    }
    if (session) {
      this.who = session.email;
      return this.play();
    }
    const sent = this.codeSent();
    if (!sent) return this.askEmail();
    this.email = sent.email;
    this.sentAt = sent.at;
    this.askCode();
  }

  /**
   * What the connection says first, each time it connects; null when there is nobody to sign in as
   * (the first card is up then). Throws when Supabase is out of reach: the connection tries again.
   */
  async hello(): Promise<ClientMsg | null> {
    const base = { t: 'hello' as const, v: PROTOCOL_VERSION };
    const token = this.o.store.get(TOKEN_KEY) ?? undefined;
    const name = this.name ?? undefined;
    if (this.mode === 'legacy') {
      if (token) return { ...base, token };
      if (name) return { ...base, name };
      this.askName();
      return null;
    }
    let auth: string | null;
    if (this.mode === 'dev') {
      auth = this.tab.get(DEV_EMAIL_KEY);
    } else {
      const session = await this.backend.session();
      auth = session?.token ?? null;
      this.who = session?.email ?? null;
    }
    if (!auth) {
      this.askEmail();
      return null;
    }
    // The token claims its character (made before sign-in) if nobody has yet.
    return { ...base, auth, ...(token && { token }), ...(name && { name }) };
  }

  /** In the game. */
  welcomed(msg: Welcome): void {
    // Without sign-in, the token is the only way back in. With sign-in the welcome brings none, and a
    // token kept from before stays: its character is still playable if the server runs without sign-in again.
    if (msg.token) this.o.store.set(TOKEN_KEY, msg.token);
    this.claimed = msg.claimed === true;
    this.name = null;
    this.refreshed = false;
    this.o.store.del(CODE_SENT_KEY);
    this.show({ kind: 'none' });
  }

  /** The server refused the hello, or ended the game here. */
  async refused(code: ErrorCode, message: string): Promise<void> {
    switch (code) {
      case 'unknown_token':
        // The token kept here names nobody (any more): start over with a name.
        this.o.disconnect();
        this.o.store.del(TOKEN_KEY);
        return this.askName();
      case 'bad_name':
        this.o.disconnect();
        return this.askName(message || 'That name cannot be used.');
      case 'need_name':
        this.o.disconnect();
        return this.askName();
      case 'sign_in_required':
        this.o.disconnect();
        return this.signInAgain();
      case 'replaced':
        this.o.disconnect();
        return this.show({ kind: 'message', text: 'You are playing on another screen.', button: { label: 'Play here', run: () => this.play() } });
      case 'server_full':
        // The server closes with "try again later", and the connection does.
        return this.show({ kind: 'message', text: 'The server is full right now. Trying again...' });
      default:
        return undefined;
    }
  }

  async submitEmail(input: string): Promise<void> {
    if (this.busy()) return;
    const email = input.trim();
    if (!EMAIL_RE.test(email) || email.length > 254) return this.askEmail('That does not look like an email address.', email);
    if (this.mode === 'dev') {
      this.tab.set(DEV_EMAIL_KEY, email.toLowerCase());
      return this.play();
    }
    this.show({ kind: 'email', dev: false, email, error: '', busy: true });
    try {
      await this.backend.sendCode(email);
    } catch (err) {
      return this.askEmail(problemText(err, 'send'), email);
    }
    this.remember(email);
    this.askCode();
  }

  async submitCode(input: string): Promise<void> {
    if (this.busy()) return;
    const code = digits(input);
    if (code.length !== CODE_LENGTH) return this.askCode(`Enter the ${CODE_LENGTH} digits from the email.`);
    this.show({ ...this.codeScreen(), busy: true });
    try {
      await this.backend.verifyCode(this.email, code);
    } catch (err) {
      return this.askCode(problemText(err, 'verify'));
    }
    this.who = this.email;
    this.o.store.del(CODE_SENT_KEY);
    this.play();
  }

  /** Another code to the same address, once the wait is over. */
  async resend(): Promise<void> {
    if (this.busy() || this.o.now() < this.sentAt + RESEND_AFTER_MS) return;
    this.show({ ...this.codeScreen(), busy: true });
    try {
      await this.backend.sendCode(this.email);
    } catch (err) {
      return this.askCode(problemText(err, 'send'));
    }
    this.remember(this.email);
    this.askCode('', 'We sent a new code.');
  }

  changeEmail(): void {
    this.o.store.del(CODE_SENT_KEY);
    this.askEmail('', this.email);
  }

  submitName(input: string): void {
    if (this.busy()) return;
    const name = input.trim();
    if (!NAME_RE.test(name)) return this.askName('Use 2 to 16 letters, numbers, spaces, - or _.');
    this.name = name;
    this.play();
  }

  /** The menu's "Sign out" (with sign-in) or "Log out" (without): back to the first card. */
  async signOut(): Promise<void> {
    this.o.disconnect();
    this.name = null;
    this.who = null;
    this.refreshed = false;
    if (this.mode === 'legacy') {
      this.o.store.del(TOKEN_KEY);
      return this.askName();
    }
    this.show({ kind: 'message', text: 'Signing out...' });
    if (this.mode === 'dev') this.tab.del(DEV_EMAIL_KEY);
    else {
      try {
        await this.backend.signOut();
      } catch {
        // Supabase forgets the session here either way.
      }
    }
    this.askEmail();
  }

  /** A message over the game, like "a new version is out". */
  message(text: string, button?: { label: string; run: () => void }): void {
    this.show({ kind: 'message', text, ...(button && { button }) });
  }

  private play(): void {
    this.show({ kind: 'message', text: 'Connecting...' });
    this.o.connect();
  }

  private async signInAgain(): Promise<void> {
    // The server wants sign-in now (it ran without when this page loaded), or another kind than
    // this page knows: load the page again, which asks it.
    if (this.mode === 'legacy' || (await this.modeChanged())) return this.o.reload();
    if (this.mode === 'dev') {
      this.tab.del(DEV_EMAIL_KEY);
      return this.askEmail('Please sign in again.');
    }
    // Once until the next welcome: a new token helps when the old one just expired, or the clocks disagree.
    if (!this.refreshed) {
      this.refreshed = true;
      this.show({ kind: 'message', text: 'Connecting...' });
      let fresh = false;
      try {
        fresh = await this.backend.refresh();
      } catch {
        // Out of reach: signing in again says so if it still is.
      }
      if (fresh) return this.o.connect();
    }
    this.askEmail('Please sign in again.');
  }

  private async modeChanged(): Promise<boolean> {
    if (!this.o.serverMode) return false;
    try {
      return (await this.o.serverMode()) !== this.mode;
    } catch {
      return false;
    }
  }

  private askEmail(error = '', email = this.email): void {
    this.show({ kind: 'email', dev: this.mode === 'dev', email, error, busy: false });
  }

  private askCode(error = '', note = ''): void {
    this.show({ ...this.codeScreen(), error, note });
  }

  private askName(error = ''): void {
    const who = this.mode === 'dev' ? this.tab.get(DEV_EMAIL_KEY) : this.who;
    this.show({ kind: 'name', signedIn: this.mode !== 'legacy', who, error });
  }

  private codeScreen(): Extract<Screen, { kind: 'code' }> {
    return { kind: 'code', email: this.email, error: '', note: '', busy: false, resendAt: this.sentAt + RESEND_AFTER_MS };
  }

  private busy(): boolean {
    const s = this.screen;
    return (s.kind === 'email' || s.kind === 'code') && s.busy;
  }

  private remember(email: string): void {
    this.email = email;
    this.sentAt = this.o.now();
    this.o.store.set(CODE_SENT_KEY, JSON.stringify({ email, at: this.sentAt, project: this.project }));
  }

  /** The code this browser had sent, by the same Supabase project, that still works, if any. */
  private codeSent(): { email: string; at: number } | undefined {
    let sent: unknown;
    try {
      sent = JSON.parse(this.o.store.get(CODE_SENT_KEY) ?? 'null');
    } catch {
      return undefined;
    }
    const { email, at, project } = (typeof sent === 'object' && sent !== null ? sent : {}) as { email?: unknown; at?: unknown; project?: unknown };
    if (typeof email !== 'string' || typeof at !== 'number' || project !== this.project || this.o.now() - at > CODE_LIFETIME_MS) return undefined;
    return { email, at };
  }

  /** The Supabase project codes come from. */
  private get project(): string | undefined {
    return this.o.config.mode === 'supabase' ? this.o.config.url : undefined;
  }

  private get backend(): AuthBackend {
    if (!this.o.backend) throw new Error('signing in with Supabase needs its client');
    return this.o.backend;
  }

  private get tab(): Store {
    return this.o.tab ?? this.o.store;
  }

  private show(screen: Screen): void {
    this.screen = screen;
    this.o.show(screen);
  }
}

/** The digits of a pasted or typed code ("123 456" and "123-456" are 123456), at most CODE_LENGTH. */
export function digits(input: string): string {
  return input.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

function problemText(err: unknown, step: 'send' | 'verify'): string {
  const p = err instanceof AuthProblem ? err : new AuthProblem('other');
  switch (p.kind) {
    case 'bad_code':
      return 'That code is wrong or too old. Check it, or send a new one.';
    case 'bad_email':
      return 'That email address does not work. Check it and try again.';
    case 'rate_limited':
      if (step === 'verify') return 'Too many tries. Wait a minute, then try again.';
      return p.retryInS ? `Wait ${p.retryInS} seconds before asking for another code.` : 'Too many codes were sent. Try again in a while.';
    case 'offline':
      return 'Cannot reach the sign-in service. Check your connection and try again.';
    case 'closed':
      return 'Signing in with email is closed right now. Try again later.';
    default:
      return 'Something went wrong. Try again in a moment.';
  }
}

/**
 * How the server wants players to sign in (GET /auth-config). A server from before sign-in has no
 * such page: it runs without. Throws when the answer cannot be had now (try again).
 */
export async function loadAuthConfig(get: (path: string) => Promise<Response> = path => fetch(path, { cache: 'no-store' })): Promise<AuthConfig> {
  const res = await get('/auth-config');
  if (res.status === 404) return { mode: 'legacy' };
  if (!res.ok) throw new Error(`/auth-config answered ${res.status}`);
  const config = AuthConfig.safeParse(await res.json());
  if (!config.success) throw new Error('/auth-config did not say how to sign in');
  return config.data;
}
