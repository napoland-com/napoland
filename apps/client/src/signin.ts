/**
 * Signing in, as a small state machine with no page and no network of its own (both are handed
 * in), so it can be tested: which card the overlay shows, what the hello says, and what to do with
 * the server's answers. The server picks the mode (GET /auth-config, see shared/protocol.ts):
 * - legacy: the name card; the token the welcome brings is kept in this browser and logs back in.
 * - dev and supabase: play first, sign in to keep it. A first visit gets the play card: a name, and
 *   you play at once as a guest, whose token this browser keeps and logs back in with (no card).
 *   "I have played before: sign in", or a guest's Sign in button, opens the sign-in cards:
 *   - dev: "Your email (development: no code)", then play.
 *   - supabase: "Your email" and "Send me a code", then the 6-digit code from the email, then play.
 *     Supabase keeps the session in this browser and refreshes it (supabase.ts).
 *   Above the email, the email card offers the providers the server lists (Google, Apple): the page
 *   leaves for the provider's own sign-in and a new one comes back signed in, which start() plays
 *   like any session kept here. In dev mode their buttons only say they need a Supabase project.
 * Signed in, the guest's token (or one kept from before sign-in) goes with the hello: its character
 * becomes yours if nobody has claimed it yet. An account that has a character already is asked which
 * to play first (the account card); the guest stays in this browser. Someone without a character is
 * asked for a name.
 */
import {
  AuthConfig, NAME_RE, PROTOCOL_VERSION, type AuthMode, type ClientMsg, type ErrorCode, type OAuthProvider, type ServerMsg,
} from '@napoland/shared';

/**
 * What this browser keeps: the token of a character made without sign-in (a guest's, or one from
 * before sign-in). In dev mode the tab keeps a guest's token, so each tab can be someone else.
 */
export const TOKEN_KEY = 'napoland.token';
/**
 * The guest's token again, kept beside it when the player chose the character of the account they
 * signed in with: hellos signed in leave the guest out (it would be asked about every time), and
 * signing out brings it back. Kept where the token is.
 */
export const SET_ASIDE_KEY = 'napoland.guestSetAside';
/** The email signed in with in dev mode, kept by the tab: each tab can be someone else. (Supabase keeps its own session.) */
export const DEV_EMAIL_KEY = 'napoland.devEmail';
/**
 * Where a code was sent and when, so a reload (say the phone dropped the page while you read your
 * mail) comes back to the code card.
 */
export const CODE_SENT_KEY = 'napoland.codeSent';
/**
 * Which provider a sign-in left for, when, and from which Supabase project. The page that comes back
 * from Google or Apple is a new one: signed in, it just plays; if not, this is how it knows that a
 * sign-in did not finish (cancelled, refused, or its code could not be used), and says so.
 */
export const PROVIDER_KEY = 'napoland.signingInWith';
/** Signing in with a provider takes a minute or two: one that left longer ago than this was dropped, and the page need not say so. */
const PROVIDER_LIFETIME_MS = 10 * 60_000;
/** How the cards name each provider. */
export const PROVIDER_NAMES: Record<OAuthProvider, string> = { google: 'Google', apple: 'Apple' };
/** What a provider's button says in dev mode, where only an email is believed. */
export const PROVIDERS_NEED_SUPABASE = 'Google and Apple sign-in only work with a Supabase project.';

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
  /**
   * Leaves this page for the provider's own sign-in, through Supabase, which sends the player back to
   * `returnTo` (the project's Site URL without it): a new page, whose session() has the session.
   * Resolves as the page goes; throws AuthProblem when it cannot go.
   */
  signInWith(provider: OAuthProvider, returnTo?: string): Promise<void>;
  /** Gets a new access token now; false when the session is gone. */
  refresh(): Promise<boolean>;
  signOut(): Promise<void>;
}

/** What the overlay shows. */
export type Screen =
  /** Nothing: playing. */
  | { kind: 'none' }
  | { kind: 'message'; text: string; button?: { label: string; run: () => void } }
  /**
   * `back`: the words of the way back (to the guest, or to the play card), or null when there is none.
   * `providers`: the buttons above the email (Google, Apple), in order; `providerError` says under
   * them why the last one did not sign you in.
   */
  | { kind: 'email'; dev: boolean; email: string; error: string; busy: boolean; back: string | null; providers: OAuthProvider[]; providerError: string }
  /** (Its way back is Change email: the email card has one.) */
  | { kind: 'code'; email: string; error: string; note: string; busy: boolean; resendAt: number }
  /** Without sign-in, the first card; with sign-in, "Choose a name for your character" (`who` is signed in). */
  | { kind: 'name'; signedIn: boolean; who: string | null; error: string }
  /** With sign-in, the first card: a name to play at once as a guest, or sign in. `note`: why it is back, when it says. */
  | { kind: 'play'; error: string; note: string }
  /** Signed in to an account that has a character (`name`) while this browser plays a guest: play it, or keep the guest. */
  | { kind: 'account'; name: string };

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
  /** Where Google or Apple sends the player back once signed in: this game's address. */
  returnTo?: string;
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

/** What the play card and the name card say about a name the rules do not take. */
const NAME_HINT = 'Use 2 to 16 letters, numbers, spaces, - or _.';

export class SignIn {
  screen: Screen = { kind: 'message', text: 'Loading...' };
  /** Set by a welcome that claimed a character made without sign-in (a guest's, or from before sign-in). */
  claimed = false;
  /** The last welcome said this browser plays a guest. */
  guest = false;
  /** What the welcome after signing in says, in a banner: the claim, or the account's own character. Null: nothing. */
  news: { title: string; sub: string } | null = null;
  /** The name for a new character, sent until the welcome. */
  private name: string | null = null;
  /** Where the last code went, and when. */
  private email = '';
  private sentAt = -Infinity;
  /** A refresh was tried since the last welcome: the next sign_in_required asks to sign in. */
  private refreshed = false;
  /** Who is signed in, for the name card. */
  private who: string | null = null;
  /** The last hello said nothing of sign-in: it was a guest's (by token, or a new one by name). */
  private asGuest = false;
  /** The player chose the account's own character over this browser's guest; its welcome says so. */
  private switching = false;
  /** The provider this page is leaving for: if the browser brings the page back as it was (resumed), it did not get there. */
  private leaving: OAuthProvider | null = null;

  constructor(private readonly o: SignInOptions) {}

  get mode(): AuthMode {
    return this.o.config.mode;
  }

  /** Players may play without signing in, as guests: every mode with sign-in. */
  get guests(): boolean {
    return this.mode !== 'legacy';
  }

  /** The providers the email card offers: those the server lists (only once the Supabase project has them set up). */
  get providers(): OAuthProvider[] {
    return this.o.config.mode === 'legacy' ? [] : this.o.config.providers;
  }

  /** Plays at once with what this browser remembers, or asks. */
  async start(): Promise<void> {
    const { store } = this.o;
    if (this.mode === 'legacy') return store.get(TOKEN_KEY) ? this.play() : this.askName();
    if (this.mode === 'dev') return this.tab.get(DEV_EMAIL_KEY) || this.guestToken ? this.play() : this.showPlay();
    // Read and forgotten at once: only the page that comes back from the provider may say how it went.
    const leftFor = this.providerLeftFor();
    let session: Session | null;
    try {
      session = await this.backend.session();
    } catch {
      // There is a session to refresh, and Supabase is out of reach for now: the connection keeps trying.
      return this.play();
    }
    // Back from Google or Apple signed in (supabase-js took the session from the address as the page
    // started), or with a session kept from before: the hello brings the guest's token, as after a code.
    if (session) {
      this.who = session.email;
      return this.play();
    }
    // Back from one without a session: cancelled, refused, or its code could not be used. The card
    // again, with its way back to the guest, who has not been touched.
    if (leftFor) return this.askEmail('', this.email, notFinished(leftFor));
    // A code on its way (say the phone dropped the page while its player read the mail): its card again.
    const sent = this.codeSent();
    if (sent) {
      this.email = sent.email;
      this.sentAt = sent.at;
      return this.askCode();
    }
    // The guest this browser keeps plays at once, no card; a first visit gets the play card.
    return this.guestToken ? this.play() : this.showPlay();
  }

  /**
   * What the connection says first, each time it connects; null when there is nobody to sign in as
   * (the first card is up then). Throws when Supabase is out of reach: the connection tries again.
   */
  async hello(): Promise<ClientMsg | null> {
    const base = { t: 'hello' as const, v: PROTOCOL_VERSION };
    const name = this.name ?? undefined;
    if (this.mode === 'legacy') {
      const token = this.o.store.get(TOKEN_KEY) ?? undefined;
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
    const token = this.guestToken ?? undefined;
    this.asGuest = !auth;
    if (!auth) {
      // Nobody is signed in here: the guest this browser keeps, or a new one with the play card's name.
      if (token) return { ...base, token };
      if (name) return { ...base, name };
      this.showPlay();
      return null;
    }
    // The token claims its character (a guest, or made before sign-in) if nobody has yet; the server
    // asks first if the account has a character already. Once set aside for that one, it stays out.
    const claim = token && token !== this.keep.get(SET_ASIDE_KEY) ? token : undefined;
    return { ...base, auth, ...(claim && { token: claim }), ...(name && { name }) };
  }

  /** In the game. */
  welcomed(msg: Welcome): void {
    // A page that plays without sign-in on a server that has it now: the page again, which asks it.
    if (this.mode === 'legacy' && msg.guest) return this.o.reload();
    // Without sign-in (legacy, or a guest), the token is the only way back in. Signed in, the welcome
    // brings none, and a token kept from before stays: it may be a guest set aside for the account's
    // own character, and a claimed one still plays if the server runs without sign-in again.
    if (msg.token) this.keep.set(TOKEN_KEY, msg.token);
    this.guest = msg.guest === true;
    // The guest plays again: nothing is set aside any more, so the next sign-in claims it, or asks.
    if (this.guest) this.keep.del(SET_ASIDE_KEY);
    this.claimed = msg.claimed === true;
    this.news = this.claimed ? { title: 'Signed in', sub: 'Your character is yours to keep.\nSign in on any device to play it.' }
      : this.switching ? { title: 'Signed in', sub: `Welcome back, ${msg.name}.\nYour guest character stays in this browser.` }
      : null;
    this.switching = false;
    this.name = null;
    this.refreshed = false;
    this.o.store.del(CODE_SENT_KEY);
    this.show({ kind: 'none' });
  }

  /** The server refused the hello, or ended the game here. `name`: the account's own character (has_character). */
  async refused(code: ErrorCode, message: string, name?: string): Promise<void> {
    switch (code) {
      case 'unknown_token':
        // The token kept here names nobody (any more): start over with a name.
        this.o.disconnect();
        this.forgetGuest();
        return this.guests ? this.showPlay() : this.askName();
      case 'bad_name':
        this.o.disconnect();
        if (this.guests && this.asGuest) return this.showPlay(message || 'That name cannot be used.');
        return this.askName(message || 'That name cannot be used.');
      case 'need_name':
        this.o.disconnect();
        return this.askName();
      case 'sign_in_required':
        this.o.disconnect();
        // A guest's token whose character someone signed in with since: it plays that one no more.
        if (this.guests && this.asGuest) {
          this.forgetGuest();
          return this.showPlay('', 'Your character is kept with your account. Sign in to play it.');
        }
        return this.signInAgain();
      case 'has_character':
        this.o.disconnect();
        return this.show({ kind: 'account', name: name ?? 'your character' });
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

  /** The play card: a name, and in at once as a guest. */
  playAsGuest(input: string): void {
    const name = input.trim();
    if (!NAME_RE.test(name)) return this.showPlay(NAME_HINT);
    this.name = name;
    this.play();
  }

  /**
   * "I have played before: sign in" on the play card, and a guest's Sign in button: the email card,
   * or the code card while a code is on its way. A guest leaves the world meanwhile, so nothing out
   * there wears them down while they read their mail.
   */
  beginSignIn(): void {
    if (!this.guests) return;
    this.o.disconnect();
    // A name tried on the play card was for a guest: an account without a character is asked for one.
    this.name = null;
    const sent = this.codeSent();
    if (!sent) return this.askEmail('', this.email);
    this.email = sent.email;
    this.sentAt = sent.at;
    this.askCode();
  }

  /**
   * "Continue with Google" or "Sign in with Apple" on the email card: the provider's own sign-in page,
   * from which a new page comes back signed in. The guest's token already waits in this browser for
   * its hello; what else that page needs to know (that a sign-in with this provider is under way) is
   * written down before this one goes.
   */
  async signInWith(provider: OAuthProvider): Promise<void> {
    // (A second tap while the page goes would start a second sign-in over the first.)
    if (this.busy() || this.leaving || !this.providers.includes(provider)) return;
    if (this.mode === 'dev') return this.askEmail('', this.email, PROVIDERS_NEED_SUPABASE);
    // Not with a code after all: a page that comes back must not ask for one.
    this.o.store.del(CODE_SENT_KEY);
    this.o.store.set(PROVIDER_KEY, JSON.stringify({ provider, at: this.o.now(), project: this.project }));
    this.leaving = provider;
    this.show({ kind: 'message', text: `Taking you to ${PROVIDER_NAMES[provider]}...` });
    try {
      await this.backend.signInWith(provider, this.o.returnTo);
    } catch {
      this.o.store.del(PROVIDER_KEY);
      this.leaving = null;
      this.askEmail('', this.email, notFinished(provider));
    }
  }

  /**
   * The browser brought this page back from its history as it left it (the back button on the
   * provider's page): the sign-in did not get anywhere, unless it finished in a page after this one.
   * Either way it goes as a page coming back from the provider goes.
   */
  async resumed(): Promise<void> {
    if (!this.leaving) return;
    this.leaving = null;
    return this.start();
  }

  /** The email card's way back: to the guest this browser keeps, or to the play card. */
  back(): void {
    if (this.busy()) return;
    // Not signing in after all: a reload goes to the game, not to the code card.
    this.o.store.del(CODE_SENT_KEY);
    if (this.guestToken) return this.play();
    this.showPlay();
  }

  /** The account card's "Play as ...": the account's own character, with the guest set aside in this browser. */
  playAccount(): void {
    const token = this.guestToken;
    if (token) this.keep.set(SET_ASIDE_KEY, token);
    this.switching = true;
    this.play();
  }

  /** The account card's way back: signed out of that account again (in this browser), the guest plays on. */
  async keepGuest(): Promise<void> {
    this.show({ kind: 'message', text: 'Connecting...' });
    await this.signOutHere();
    this.play();
  }

  async submitEmail(input: string): Promise<void> {
    if (this.busy()) return;
    const email = input.trim();
    if (!EMAIL_RE.test(email) || email.length > 254) return this.askEmail('That does not look like an email address.', email);
    if (this.mode === 'dev') {
      this.tab.set(DEV_EMAIL_KEY, email.toLowerCase());
      return this.play();
    }
    this.show({ kind: 'email', dev: false, email, error: '', busy: true, back: this.backLabel, providers: this.providers, providerError: '' });
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
    if (!NAME_RE.test(name)) return this.askName(NAME_HINT);
    this.name = name;
    this.play();
  }

  /**
   * The menu's "Sign out" (with sign-in) or "Log out" (without). Without sign-in, back to the first
   * card; signed out, the guest set aside in this browser plays again, or the play card is back.
   */
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
    await this.signOutHere();
    // The token may be of the character just signed out of (claimed): then the server says so, and it goes.
    return this.guestToken ? this.play() : this.showPlay();
  }

  /** A message over the game, like "a new version is out". */
  message(text: string, button?: { label: string; run: () => void }): void {
    this.show({ kind: 'message', text, ...(button && { button }) });
  }

  private play(): void {
    this.show({ kind: 'message', text: 'Connecting...' });
    this.o.connect();
  }

  /** Signed out in this browser only: the dev email this tab keeps, or Supabase's session here. */
  private async signOutHere(): Promise<void> {
    this.who = null;
    if (this.mode === 'dev') return this.tab.del(DEV_EMAIL_KEY);
    try {
      await this.backend.signOut();
    } catch {
      // Supabase forgets the session here either way.
    }
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

  private askEmail(error = '', email = this.email, providerError = ''): void {
    this.show({ kind: 'email', dev: this.mode === 'dev', email, error, busy: false, back: this.backLabel, providers: this.providers, providerError });
  }

  private askCode(error = '', note = ''): void {
    this.show({ ...this.codeScreen(), error, note });
  }

  private askName(error = ''): void {
    const who = this.mode === 'dev' ? this.tab.get(DEV_EMAIL_KEY) : this.who;
    this.show({ kind: 'name', signedIn: this.mode !== 'legacy', who, error });
  }

  private showPlay(error = '', note = ''): void {
    this.show({ kind: 'play', error, note });
  }

  private codeScreen(): Extract<Screen, { kind: 'code' }> {
    return { kind: 'code', email: this.email, error: '', note: '', busy: false, resendAt: this.sentAt + RESEND_AFTER_MS };
  }

  /** The words of the email card's way back (back()): to the guest this browser keeps, or to the play card. */
  private get backLabel(): string | null {
    if (!this.guests) return null;
    return this.guestToken ? 'Keep playing as a guest' : 'Back';
  }

  /** Where this browser keeps a guest's token: the browser; in dev mode the tab, so each tab can be someone else, as with its email. */
  private get keep(): Store {
    return this.mode === 'dev' ? this.tab : this.o.store;
  }

  private get guestToken(): string | null {
    return this.keep.get(TOKEN_KEY);
  }

  /** The guest's token names nobody this browser can play without sign-in (any more). */
  private forgetGuest(): void {
    this.keep.del(TOKEN_KEY);
    this.keep.del(SET_ASIDE_KEY);
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

  /**
   * The provider a sign-in from this browser left for, lately and with the same Supabase project, if
   * any. Forgotten as it is read: only the page that comes back from it can say it did not finish.
   */
  private providerLeftFor(): OAuthProvider | undefined {
    let left: unknown;
    try {
      left = JSON.parse(this.o.store.get(PROVIDER_KEY) ?? 'null');
    } catch {
      left = null;
    }
    this.o.store.del(PROVIDER_KEY);
    const { provider, at, project } = (typeof left === 'object' && left !== null ? left : {}) as { provider?: unknown; at?: unknown; project?: unknown };
    if (typeof provider !== 'string' || !this.providers.includes(provider as OAuthProvider)) return undefined;
    if (typeof at !== 'number' || project !== this.project || Math.abs(this.o.now() - at) > PROVIDER_LIFETIME_MS) return undefined;
    return provider as OAuthProvider;
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

/** A sign-in with Google or Apple that did not sign anyone in, however it ended: the plain line under the buttons. */
export function notFinished(provider: OAuthProvider): string {
  return `Signing in with ${PROVIDER_NAMES[provider]} did not finish. Try again, or use your email.`;
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
