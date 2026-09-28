/**
 * The sign-in flow (signin.ts) in each mode, with a stand-in for Supabase and for the connection:
 * no page and no network.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type AuthConfig, type OAuthProvider, type ServerMsg } from '@napoland/shared';
import {
  AuthProblem, CODE_SENT_KEY, DEV_EMAIL_KEY, PROVIDER_KEY, RESEND_AFTER_MS, SET_ASIDE_KEY, SignIn, TOKEN_KEY, digits, loadAuthConfig,
  type AuthBackend, type Screen, type Session, type Store,
} from '../src/signin';
import { ASLEEP, DRY, START } from './fixtures';

/**
 * Supabase as the flow sees it: one right code, a session kept after it, refreshes that can go three
 * ways, and Google and Apple, whose pages this stand-in only notes the page leaving for (a test then
 * plays the page that comes back: a new SignIn, with or without the session the provider gave).
 */
class FakeSupabase implements AuthBackend {
  session_: Session | null = null;
  code = '482913';
  sentTo: string[] = [];
  sendProblem: AuthProblem | undefined;
  offline = false;
  refreshes = 0;
  onRefresh: 'new token' | 'session gone' | 'offline' = 'new token';
  signOuts = 0;
  /** Each time the page left for a provider: which, and the address it asked to come back to. */
  left: Array<[OAuthProvider, string | undefined]> = [];
  leaveProblem: AuthProblem | undefined;

  async session() {
    if (this.offline) throw new AuthProblem('offline');
    return this.session_;
  }
  async sendCode(email: string) {
    if (this.sendProblem) throw this.sendProblem;
    this.sentTo.push(email);
  }
  async verifyCode(email: string, code: string) {
    if (code !== this.code) throw new AuthProblem('bad_code');
    this.session_ = { token: 'access-1', email };
  }
  async signInWith(provider: OAuthProvider, returnTo?: string) {
    if (this.leaveProblem) throw this.leaveProblem;
    this.left.push([provider, returnTo]);
  }
  async refresh() {
    this.refreshes++;
    if (this.onRefresh === 'offline') throw new AuthProblem('offline');
    if (this.onRefresh === 'session gone' || !this.session_) {
      this.session_ = null;
      return false;
    }
    this.session_ = { ...this.session_, token: `access-${this.refreshes + 1}` };
    return true;
  }
  async signOut() {
    this.signOuts++;
    this.session_ = null;
  }
}

class MemoryStore implements Store {
  readonly values = new Map<string, string>();
  get(key: string) {
    return this.values.get(key) ?? null;
  }
  set(key: string, value: string) {
    this.values.set(key, value);
  }
  del(key: string) {
    this.values.delete(key);
  }
}

type Welcome = Extract<ServerMsg, { t: 'welcome' }>;
const welcome = (more: Partial<Welcome> = {}): Welcome => ({
  t: 'welcome', v: PROTOCOL_VERSION, you: 'p1', name: 'Aldo', guest: false, map: { id: 'stonebrook', version: 1 }, players: [], finds: [], drops: [], stepMs: 200,
  weather: 'rain', energy: { value: 100, max: 100, rate: 0 }, bag: [], stash: [], items: 1, serverTime: 0,
  fires: [], marks: [], creatures: [], flares: [], flashes: [], surge: null, storm: null, body: DRY, stone: ASLEEP, stats: {}, progress: START, merits: { spent: 0, owned: [] }, tools: [],
  conditions: { today: [], week: null, next: null }, season: { season: 'spring', left: 86_400 }, longNight: { on: false, bonus: true, out: false },
  story: { version: 0, chapter: '' }, thanked: [], notebook: { version: 0, pages: [], blanks: [] }, notes: [], keepsakes: [], firsts: [], ...more,
});

/** Supabase with the email code alone, as before any provider is set up. */
const SUPABASE: AuthConfig = { mode: 'supabase', url: 'https://abcd.supabase.co', publishableKey: 'sb_publishable_x', providers: [] };
/** Supabase with Google and Apple set up (AUTH_PROVIDERS=google,apple). */
const PROVIDERS: AuthConfig = { ...SUPABASE, providers: ['google', 'apple'] };
const LEGACY_TOKEN = 'l'.repeat(43);
/** The game's address, where Google and Apple send the player back. */
const GAME = 'https://www.napoland.com';

let now: number;
/** This browser's storage, and this tab's. */
let store: MemoryStore;
let tab: MemoryStore;
let supabase: FakeSupabase;
/** What the flow did to the connection and the page, in order. */
let did: string[];

function flow(config: AuthConfig) {
  return new SignIn({
    config, store, tab, backend: config.mode === 'supabase' ? supabase : undefined, now: () => now, returnTo: GAME,
    connect: () => did.push('connect'),
    disconnect: () => did.push('disconnect'),
    show: () => {},
    reload: () => did.push('reload'),
  });
}
const kind = (s: SignIn) => s.screen.kind;
const screen = <K extends Screen['kind']>(s: SignIn, k: K) => {
  expect(s.screen.kind).toBe(k);
  return s.screen as Extract<Screen, { kind: K }>;
};

beforeEach(() => {
  now = 1_700_000_000_000;
  store = new MemoryStore();
  tab = new MemoryStore();
  supabase = new FakeSupabase();
  did = [];
});

describe('signing in with Supabase', () => {
  it('starts on the play card; "I have played before" asks for an email, sends a code to it, and plays with the session the right code brings', async () => {
    const s = flow(SUPABASE);
    await s.start();
    expect(screen(s, 'play')).toEqual({ kind: 'play', error: '', note: '' });
    expect(did).toEqual([]);
    s.beginSignIn();
    expect(screen(s, 'email')).toEqual({ kind: 'email', dev: false, email: '', error: '', busy: false, back: 'Back', providers: [], providerError: '' });

    await s.submitEmail(' ann@example.test ');
    expect(supabase.sentTo).toEqual(['ann@example.test']);
    expect(screen(s, 'code')).toMatchObject({ email: 'ann@example.test', error: '', busy: false, resendAt: now + RESEND_AFTER_MS });
    expect(did).toEqual(['disconnect']); // nothing was connected: the guest's way out of the world, when there is one

    await s.submitCode('482913');
    expect(did).toEqual(['disconnect', 'connect']);
    expect(screen(s, 'message').text).toBe('Connecting...');
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'access-1' });
    s.welcomed(welcome());
    expect(kind(s)).toBe('none');
    expect([s.guest, s.claimed, s.news]).toEqual([false, false, null]);
  });

  it('keeps the code card after a wrong code, says so, and takes the right one pasted with a space', async () => {
    const s = flow(SUPABASE);
    await s.start();
    await s.submitEmail('ann@example.test');
    await s.submitCode('111111');
    expect(screen(s, 'code').error).toMatch(/That code is wrong or too old/);
    expect(did).toEqual([]);
    await s.submitCode('48291');
    expect(screen(s, 'code').error).toMatch(/Enter the 6 digits/);
    await s.submitCode('482 913');
    expect(did).toEqual(['connect']);
  });

  it('says what went wrong with an email: not one, refused, too many codes, Supabase out of reach', async () => {
    const s = flow(SUPABASE);
    await s.start();
    await s.submitEmail('ann@example');
    expect(screen(s, 'email')).toMatchObject({ email: 'ann@example', error: expect.stringMatching(/does not look like an email/) });
    const cases: Array<[AuthProblem, RegExp]> = [
      [new AuthProblem('bad_email'), /does not work/],
      [new AuthProblem('rate_limited', 42), /Wait 42 seconds/],
      [new AuthProblem('rate_limited'), /Too many codes were sent/],
      [new AuthProblem('offline'), /Cannot reach the sign-in service/],
      [new AuthProblem('closed'), /closed right now/],
    ];
    for (const [problem, text] of cases) {
      supabase.sendProblem = problem;
      await s.submitEmail('ann@example.test');
      expect(screen(s, 'email')).toMatchObject({ email: 'ann@example.test', error: expect.stringMatching(text), busy: false });
    }
    expect(supabase.sentTo).toEqual([]);
  });

  it('sends a new code only after a minute, and lets the email be changed', async () => {
    const s = flow(SUPABASE);
    await s.start();
    await s.submitEmail('ann@example.test');
    now += RESEND_AFTER_MS - 1000;
    await s.resend();
    expect(supabase.sentTo).toHaveLength(1);
    now += 1000;
    await s.resend();
    expect(supabase.sentTo).toEqual(['ann@example.test', 'ann@example.test']);
    expect(screen(s, 'code')).toMatchObject({ note: 'We sent a new code.', resendAt: now + RESEND_AFTER_MS });

    s.changeEmail();
    expect(screen(s, 'email')).toMatchObject({ email: 'ann@example.test', error: '' });
    await s.submitEmail('bea@example.test');
    expect(screen(s, 'code').email).toBe('bea@example.test');
  });

  it('comes back to the code card after a reload (the phone dropped the page while you read your mail), for an hour', async () => {
    const first = flow(SUPABASE);
    await first.start();
    first.beginSignIn();
    await first.submitEmail('ann@example.test');
    now += 30_000;
    const reloaded = flow(SUPABASE);
    await reloaded.start();
    expect(screen(reloaded, 'code')).toMatchObject({ email: 'ann@example.test', resendAt: now - 30_000 + RESEND_AFTER_MS });
    // Not a code from another Supabase project (say, one tried on this browser before).
    const elsewhere = new SignIn({
      config: { ...SUPABASE, url: 'https://other.supabase.co' } as AuthConfig, store, tab, backend: supabase, now: () => now,
      connect: () => {}, disconnect: () => {}, show: () => {}, reload: () => {},
    });
    await elsewhere.start();
    expect(kind(elsewhere)).toBe('play');

    await reloaded.submitCode('482913');
    expect(did).toEqual(['disconnect', 'connect']);
    expect(store.get(CODE_SENT_KEY)).toBeNull();

    // A code from more than an hour ago is no good any more.
    const old = flow(SUPABASE);
    supabase.session_ = null;
    await old.start();
    old.beginSignIn();
    await old.submitEmail('bea@example.test');
    now += 3_600_001;
    const late = flow(SUPABASE);
    await late.start();
    expect(kind(late)).toBe('play');
  });

  it('plays at once with the session kept from before, and each hello takes the freshest token', async () => {
    supabase.session_ = { token: 'kept', email: 'ann@example.test' };
    const s = flow(SUPABASE);
    await s.start();
    expect(did).toEqual(['connect']);
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'kept' });
    supabase.session_ = { token: 'refreshed', email: 'ann@example.test' };
    expect(await s.hello()).toMatchObject({ auth: 'refreshed' });
  });

  it('asks for a name when the server needs one, and says hello with it until the welcome', async () => {
    supabase.session_ = { token: 'kept', email: 'ann@example.test' };
    const s = flow(SUPABASE);
    await s.start();
    await s.hello();
    await s.refused('need_name', 'Choose a name for your character');
    expect(did).toEqual(['connect', 'disconnect']);
    expect(screen(s, 'name')).toEqual({ kind: 'name', signedIn: true, who: 'ann@example.test', error: '' });

    s.submitName('x');
    expect(screen(s, 'name').error).toMatch(/2 to 16 letters/);
    s.submitName(' Aldo ');
    expect(did).toEqual(['connect', 'disconnect', 'connect']);
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'kept', name: 'Aldo' });

    // The name is taken: back to the card with the server's words.
    await s.refused('bad_name', 'That name is taken');
    expect(screen(s, 'name').error).toBe('That name is taken');
    s.submitName('Aldo Two');
    s.welcomed(welcome({ name: 'Aldo Two' }));
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'kept' });
  });

  it('says hello with the token of a character made before sign-in, so it is claimed, and keeps the token after', async () => {
    store.set(TOKEN_KEY, LEGACY_TOKEN);
    const s = flow(SUPABASE);
    await s.start();
    await s.submitEmail('ann@example.test');
    await s.submitCode('482913');
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'access-1', token: LEGACY_TOKEN });
    s.welcomed(welcome({ claimed: true }));
    expect(s.claimed).toBe(true);
    // Kept: the character is still playable with it if the server ever runs without sign-in again.
    expect(store.get(TOKEN_KEY)).toBe(LEGACY_TOKEN);
    s.welcomed(welcome());
    expect(s.claimed).toBe(false);
  });

  it('refreshes the session once when the server wants sign-in, then asks to sign in again', async () => {
    supabase.session_ = { token: 'access-1', email: 'ann@example.test' };
    const s = flow(SUPABASE);
    await s.start();
    await s.refused('sign_in_required', 'Sign in to play');
    expect(supabase.refreshes).toBe(1);
    expect(did).toEqual(['connect', 'disconnect', 'connect']);
    expect(await s.hello()).toMatchObject({ auth: 'access-2' });

    await s.refused('sign_in_required', 'Sign in to play');
    expect(supabase.refreshes).toBe(1);
    expect(screen(s, 'email').error).toBe('Please sign in again.');

    // A welcome in between: the next refusal gets its refresh again.
    await s.submitEmail('ann@example.test');
    await s.submitCode('482913');
    s.welcomed(welcome());
    await s.refused('sign_in_required', 'Sign in to play');
    expect(supabase.refreshes).toBe(2);
  });

  it('asks to sign in again when the refresh finds the session gone, or Supabase out of reach', async () => {
    for (const onRefresh of ['session gone', 'offline'] as const) {
      supabase.session_ = { token: 'access-1', email: 'ann@example.test' };
      supabase.onRefresh = onRefresh;
      const s = flow(SUPABASE);
      await s.start();
      await s.refused('sign_in_required', 'Sign in to play');
      expect([onRefresh, screen(s, 'email').error]).toEqual([onRefresh, 'Please sign in again.']);
    }
  });

  it('signs out: Supabase forgets the session here, and the play card is back', async () => {
    supabase.session_ = { token: 'kept', email: 'ann@example.test' };
    const s = flow(SUPABASE);
    await s.start();
    s.welcomed(welcome());
    await s.signOut();
    expect(supabase.signOuts).toBe(1);
    expect(did).toEqual(['connect', 'disconnect']);
    expect(screen(s, 'play')).toEqual({ kind: 'play', error: '', note: '' });
    expect(await s.hello()).toBeNull();
  });

  it('signs out with a token kept from before: it plays as a guest if it still is one, and if its character is an account\'s, it goes', async () => {
    supabase.session_ = { token: 'kept', email: 'ann@example.test' };
    store.set(TOKEN_KEY, LEGACY_TOKEN);
    const s = flow(SUPABASE);
    await s.start();
    s.welcomed(welcome());
    await s.signOut();
    // Kept until the server says: the token of a claimed character claims nothing for anyone else.
    expect(did).toEqual(['connect', 'disconnect', 'connect']);
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, token: LEGACY_TOKEN });
    await s.refused('sign_in_required', 'This character belongs to an account: sign in to play it');
    expect(store.get(TOKEN_KEY)).toBeNull();
    expect(supabase.refreshes).toBe(0);
    expect(screen(s, 'play')).toEqual({ kind: 'play', error: '', note: 'Your character is kept with your account. Sign in to play it.' });
  });

  it('plays with a kept session while Supabase is out of reach, and the connection tries again', async () => {
    supabase.offline = true;
    const s = flow(SUPABASE);
    await s.start();
    expect(did).toEqual(['connect']);
    await expect(s.hello()).rejects.toThrow(AuthProblem);
  });
});

describe('dev sign-in', () => {
  const DEV: AuthConfig = { mode: 'dev', providers: [] };

  it('asks for an email and nothing else, and remembers it in this tab (another tab can be someone else)', async () => {
    const s = flow(DEV);
    await s.start();
    expect(kind(s)).toBe('play');
    s.beginSignIn();
    expect(screen(s, 'email')).toMatchObject({ dev: true, error: '', back: 'Back' });
    await s.submitEmail('not an email');
    expect(screen(s, 'email').error).toMatch(/does not look like an email/);
    await s.submitEmail(' Cid@Example.test ');
    expect(did).toEqual(['disconnect', 'connect']);
    expect(tab.get(DEV_EMAIL_KEY)).toBe('cid@example.test');
    expect(store.get(DEV_EMAIL_KEY)).toBeNull();
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'cid@example.test' });

    // The tab reloaded: still signed in.
    const reloaded = flow(DEV);
    await reloaded.start();
    expect(did).toEqual(['disconnect', 'connect', 'connect']);

    // Another tab has its own first card.
    tab = new MemoryStore();
    const other = flow(DEV);
    await other.start();
    expect(kind(other)).toBe('play');
  });

  it('asks for a name, claims with the guest this tab keeps, and forgets the email when refused or signed out', async () => {
    tab.set(DEV_EMAIL_KEY, 'cid@example.test');
    tab.set(TOKEN_KEY, LEGACY_TOKEN);
    const s = flow(DEV);
    await s.start();
    // The email this tab kept signs in, not this page: the guest the tab keeps goes with it only when asked.
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'cid@example.test' });
    await s.refused('need_name', 'Choose a name for your character');
    expect(screen(s, 'keep')).toEqual({ kind: 'keep', who: 'cid@example.test' });
    s.keepGuestCharacter();
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'cid@example.test', token: LEGACY_TOKEN });
    // Its character is nobody's to claim any more: a name then, and the token still goes with it.
    await s.refused('need_name', 'Choose a name for your character');
    expect(screen(s, 'name')).toMatchObject({ signedIn: true, who: 'cid@example.test' });
    s.submitName('Cid');
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'cid@example.test', token: LEGACY_TOKEN, name: 'Cid' });

    await s.refused('sign_in_required', 'Sign in to play');
    expect(tab.get(DEV_EMAIL_KEY)).toBeNull();
    expect(screen(s, 'email')).toMatchObject({ error: 'Please sign in again.', back: 'Keep playing as a guest' });

    await s.submitEmail('cid@example.test');
    await s.signOut();
    expect(tab.get(DEV_EMAIL_KEY)).toBeNull();
    // Signed out, the tab's guest plays again.
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, token: LEGACY_TOKEN });
  });
});

describe('play first, sign in to keep it', () => {
  const GUEST_TOKEN = 'g'.repeat(43);
  const DEV: AuthConfig = { mode: 'dev', providers: [] };
  /** A guest playing in this browser, as the welcome left them. */
  async function asGuest(config: AuthConfig = SUPABASE) {
    (config.mode === 'dev' ? tab : store).set(TOKEN_KEY, GUEST_TOKEN);
    const s = flow(config);
    await s.start();
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, token: GUEST_TOKEN });
    s.welcomed(welcome({ guest: true, token: GUEST_TOKEN, name: 'Wren' }));
    did = [];
    return s;
  }
  /** A guest signing in with Supabase, up to the hello that comes after the code. */
  async function guestSignsIn(s: SignIn) {
    s.beginSignIn();
    expect(did).toEqual(['disconnect']);
    expect(screen(s, 'email').back).toBe('Keep playing as a guest');
    await s.submitEmail('wren@example.test');
    await s.submitCode(supabase.code);
    expect(did).toEqual(['disconnect', 'connect']);
  }

  it('a first visit plays at once as a guest: a name, no email, and the browser keeps its token', async () => {
    const s = flow(SUPABASE);
    await s.start();
    expect(screen(s, 'play')).toEqual({ kind: 'play', error: '', note: '' });
    expect(await s.hello()).toBeNull(); // nobody to play as yet: the play card stays
    s.playAsGuest('x');
    expect(screen(s, 'play').error).toMatch(/2 to 16 letters/);
    expect(did).toEqual([]);
    s.playAsGuest(' Wren ');
    expect(did).toEqual(['connect']);
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, name: 'Wren' });
    s.welcomed(welcome({ guest: true, token: GUEST_TOKEN, name: 'Wren' }));
    expect(kind(s)).toBe('none');
    expect([s.guest, s.claimed, s.news]).toEqual([true, false, null]);
    expect(store.get(TOKEN_KEY)).toBe(GUEST_TOKEN);

    // Coming back: straight in as the guest, no card.
    const back = flow(SUPABASE);
    await back.start();
    expect(did).toEqual(['connect', 'connect']);
    expect(await back.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, token: GUEST_TOKEN });
  });

  it('never gives the guest away to a session this page did not sign in to: the keep card asks first', async () => {
    // A session found here, which this page did not sign in to (a link with someone's session in it, or
    // one kept from before), while the browser keeps a guest.
    store.set(TOKEN_KEY, GUEST_TOKEN);
    supabase.session_ = { token: 'theirs', email: 'someone@example.test' };
    const s = flow(SUPABASE);
    await s.start();
    expect(did).toEqual(['connect']);
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'theirs' });
    // Their account has no character: the guest is not taken for it unasked.
    await s.refused('need_name', 'Choose a name for your character');
    expect(screen(s, 'keep')).toEqual({ kind: 'keep', who: 'someone@example.test' });

    // "Play as a guest instead": signed out of that account in this browser, the guest plays on, as it was.
    await s.keepGuest();
    expect(supabase.signOuts).toBe(1);
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, token: GUEST_TOKEN });

    // "Keep it": only then does the guest's token go with the sign-in, which claims it.
    supabase.session_ = { token: 'mine', email: 'wren@example.test' };
    const again = flow(SUPABASE);
    await again.start();
    expect(await again.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'mine' });
    await again.refused('need_name', 'Choose a name for your character');
    again.keepGuestCharacter();
    expect(await again.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'mine', token: GUEST_TOKEN });
    again.welcomed(welcome({ claimed: true }));
    expect(again.claimed).toBe(true);
    // Claimed, a reconnect needs the token no more.
    expect(await again.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'mine' });
  });

  it('plays the account\'s own character with a session kept from before, and never asks for a guest it does not keep', async () => {
    supabase.session_ = { token: 'access-9', email: 'ann@example.test' };
    const s = flow(SUPABASE);
    await s.start();
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'access-9' });
    // No guest here: an account without a character is asked for a name, as ever.
    await s.refused('need_name', 'Choose a name for your character');
    expect(screen(s, 'name')).toMatchObject({ signedIn: true, who: 'ann@example.test' });
    // A guest set aside for the account's own character stays out too.
    store.set(TOKEN_KEY, GUEST_TOKEN);
    store.set(SET_ASIDE_KEY, GUEST_TOKEN);
    const set = flow(SUPABASE);
    await set.start();
    await set.refused('need_name', 'Choose a name for your character');
    expect(kind(set)).toBe('name');
  });

  it('takes a guest\'s name the server refuses (taken, too many new players) back to the play card, with its words', async () => {
    const s = flow(SUPABASE);
    await s.start();
    s.playAsGuest('Wren');
    await s.hello();
    await s.refused('bad_name', 'That name is taken');
    expect(did).toEqual(['connect', 'disconnect']);
    expect(screen(s, 'play')).toEqual({ kind: 'play', error: 'That name is taken', note: '' });
    // Signing in instead: that name was for a guest, so an account without a character is asked for one.
    s.beginSignIn();
    await s.submitEmail('wren@example.test');
    await s.submitCode(supabase.code);
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'access-1' });
  });

  it('forgets a guest\'s token the server does not know, and shows the play card', async () => {
    store.set(TOKEN_KEY, GUEST_TOKEN);
    const s = flow(SUPABASE);
    await s.start();
    await s.hello();
    await s.refused('unknown_token', 'Unknown token: choose a name');
    expect(store.get(TOKEN_KEY)).toBeNull();
    expect(kind(s)).toBe('play');
  });

  it('a guest who signs in keeps the character: the hello brings its token, and the welcome says it was claimed', async () => {
    const s = await asGuest();
    await guestSignsIn(s);
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'access-1', token: GUEST_TOKEN });
    s.welcomed(welcome({ claimed: true, name: 'Wren' }));
    expect([s.guest, s.claimed]).toEqual([false, true]);
    expect(s.news).toEqual({ title: 'Signed in', sub: expect.stringMatching(/^Your character is yours to keep\./) });
  });

  it('asks before an account with a character of its own plays in the guest\'s place, and plays it with the guest set aside', async () => {
    const s = await asGuest();
    await guestSignsIn(s);
    await s.hello();
    await s.refused('has_character', 'This account already has a character', 'Aldo');
    expect(did).toEqual(['disconnect', 'connect', 'disconnect']);
    expect(screen(s, 'account')).toEqual({ kind: 'account', name: 'Aldo' });

    s.playAccount();
    expect(did.at(-1)).toBe('connect');
    // The guest stays in this browser, out of the hello: no question again.
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'access-1' });
    s.welcomed(welcome({ name: 'Aldo' }));
    expect(s.news).toEqual({ title: 'Signed in', sub: expect.stringMatching(/^Welcome back, Aldo\.\nYour guest character stays in this browser\.$/) });
    expect([store.get(TOKEN_KEY), store.get(SET_ASIDE_KEY)]).toEqual([GUEST_TOKEN, GUEST_TOKEN]);
    // The page again, signed in: the account's character, still no question.
    const reloaded = flow(SUPABASE);
    await reloaded.start();
    expect(await reloaded.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'access-1' });

    // Signed out, the guest plays again; from then on it is no longer set aside, so the next sign-in asks again.
    await s.signOut();
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, token: GUEST_TOKEN });
    s.welcomed(welcome({ guest: true, token: GUEST_TOKEN, name: 'Wren' }));
    expect(store.get(SET_ASIDE_KEY)).toBeNull();
    s.beginSignIn();
    await s.submitEmail('wren@example.test');
    await s.submitCode(supabase.code);
    expect(await s.hello()).toMatchObject({ token: GUEST_TOKEN });
  });

  it('keeps the guest when its player chooses so on the account card: signed out of that account again, the guest plays on', async () => {
    const s = await asGuest();
    await guestSignsIn(s);
    await s.refused('has_character', 'This account already has a character', 'Aldo');
    await s.keepGuest();
    expect(supabase.signOuts).toBe(1);
    expect(did.at(-1)).toBe('connect');
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, token: GUEST_TOKEN });
    s.welcomed(welcome({ guest: true, token: GUEST_TOKEN, name: 'Wren' }));
    expect([s.guest, s.news]).toEqual([true, null]);
  });

  it('goes back from the email card to the guest (forgetting a code sent, so a reload plays too), or to the play card', async () => {
    const s = await asGuest();
    s.beginSignIn();
    await s.submitEmail('wren@example.test');
    s.changeEmail();
    s.back();
    expect(did).toEqual(['disconnect', 'connect']);
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, token: GUEST_TOKEN });
    const reloaded = flow(SUPABASE);
    await reloaded.start();
    expect(kind(reloaded)).toBe('message'); // connecting, as the guest

    store.del(TOKEN_KEY);
    const first = flow(SUPABASE);
    await first.start();
    first.beginSignIn();
    first.back();
    expect(kind(first)).toBe('play');
  });

  it('comes back to the code card while a code is on its way, even with a guest in this browser', async () => {
    const s = await asGuest();
    s.beginSignIn();
    await s.submitEmail('wren@example.test');
    const reloaded = flow(SUPABASE);
    await reloaded.start();
    expect(screen(reloaded, 'code').email).toBe('wren@example.test');
    // A guest's Sign in goes there too.
    s.welcomed(welcome({ guest: true, token: GUEST_TOKEN }));
    store.set(CODE_SENT_KEY, JSON.stringify({ email: 'wren@example.test', at: now, project: SUPABASE.url }));
    s.beginSignIn();
    expect(kind(s)).toBe('code');
  });

  it('keeps a guest per tab in dev mode, so each tab can be someone else, and signs in with it', async () => {
    const s = flow(DEV);
    await s.start();
    s.playAsGuest('Ann');
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, name: 'Ann' });
    s.welcomed(welcome({ guest: true, token: GUEST_TOKEN, name: 'Ann' }));
    expect([tab.get(TOKEN_KEY), store.get(TOKEN_KEY)]).toEqual([GUEST_TOKEN, null]);
    const reloaded = flow(DEV);
    await reloaded.start();
    expect(await reloaded.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, token: GUEST_TOKEN });

    const firstTab = tab;
    tab = new MemoryStore();
    const other = flow(DEV);
    await other.start();
    expect(kind(other)).toBe('play');

    tab = firstTab;
    s.beginSignIn();
    expect(screen(s, 'email')).toMatchObject({ dev: true, back: 'Keep playing as a guest' });
    await s.submitEmail('ann@example.test');
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'ann@example.test', token: GUEST_TOKEN });
  });

  it('asks again, and signs in again, as before for someone signed in (their hello was not a guest\'s)', async () => {
    supabase.session_ = { token: 'access-1', email: 'ann@example.test' };
    supabase.onRefresh = 'session gone';
    const s = flow(SUPABASE);
    await s.start();
    await s.hello();
    await s.refused('sign_in_required', 'Sign in to play');
    expect(screen(s, 'email')).toMatchObject({ error: 'Please sign in again.', back: 'Back' });
    await s.refused('bad_name', 'That name is taken');
    expect(kind(s)).toBe('name');
  });

  it('loads the page again when it plays without sign-in and the server now has it (a guest\'s welcome)', async () => {
    store.set(TOKEN_KEY, LEGACY_TOKEN);
    const s = flow({ mode: 'legacy' });
    await s.start();
    s.welcomed(welcome({ guest: true, token: LEGACY_TOKEN }));
    expect(did).toEqual(['connect', 'reload']);
  });

  it('has nothing to sign in to without sign-in (legacy)', async () => {
    const s = flow({ mode: 'legacy' });
    await s.start();
    s.beginSignIn();
    expect(kind(s)).toBe('name');
    expect(did).toEqual([]);
  });
});

describe('signing in with Google or Apple', () => {
  const GUEST_TOKEN = 'g'.repeat(43);
  /** A guest playing in this browser, as the welcome left them. */
  async function asGuest(config: AuthConfig = PROVIDERS) {
    store.set(TOKEN_KEY, GUEST_TOKEN);
    const s = flow(config);
    await s.start();
    s.welcomed(welcome({ guest: true, token: GUEST_TOKEN, name: 'Wren' }));
    did = [];
    return s;
  }
  /** The guest's Sign in, then a provider's button: the page leaves for the provider's own sign-in. */
  async function leaveFor(s: SignIn, provider: OAuthProvider) {
    s.beginSignIn();
    await s.signInWith(provider);
    expect(supabase.left.at(-1)).toEqual([provider, GAME]);
  }
  /** The page the provider sends the player back to: a new one, which starts afresh. */
  async function comeBack() {
    const back = flow(PROVIDERS);
    await back.start();
    return back;
  }

  it('shows the providers the server lists above the email, in its order, and nothing more', async () => {
    const cases: Array<[AuthConfig, OAuthProvider[]]> = [
      [PROVIDERS, ['google', 'apple']],
      [{ ...SUPABASE, providers: ['apple', 'google'] }, ['apple', 'google']],
      [{ ...SUPABASE, providers: ['apple'] }, ['apple']],
      [SUPABASE, []],
    ];
    for (const [config, shown] of cases) {
      const s = flow(config);
      await s.start();
      s.beginSignIn();
      expect(screen(s, 'email')).toMatchObject({ providers: shown, providerError: '', back: 'Back' });
    }
    // A provider the server does not list does nothing, whatever asks for it.
    const s = flow({ ...SUPABASE, providers: ['apple'] });
    await s.start();
    s.beginSignIn();
    await s.signInWith('google');
    expect([supabase.left, kind(s), store.get(PROVIDER_KEY)]).toEqual([[], 'email', null]);
  });

  it('leaves for the provider, with the way back to this game, once it has noted what the page that comes back needs', async () => {
    const s = await asGuest();
    s.beginSignIn();
    // (Say another tab of this browser sent a code meanwhile.)
    store.set(CODE_SENT_KEY, JSON.stringify({ email: 'wren@example.test', at: now, project: SUPABASE.url }));
    await s.signInWith('google');
    expect(supabase.left).toEqual([['google', GAME]]);
    expect(screen(s, 'message').text).toBe('Taking you to Google...');
    // A second tap while the page goes starts nothing more.
    await s.signInWith('apple');
    expect(supabase.left).toEqual([['google', GAME]]);
    // The guest's token is already here; the page that comes back learns which provider it went to, and when.
    expect(store.get(TOKEN_KEY)).toBe(GUEST_TOKEN);
    expect(JSON.parse(store.get(PROVIDER_KEY)!)).toEqual({ provider: 'google', at: now, project: SUPABASE.url });
    // Not with a code after all: the page that comes back must not ask for one.
    expect(store.get(CODE_SENT_KEY)).toBeNull();
    // The guest left the world for the sign-in cards, and nothing connects until the page is back.
    expect(did).toEqual(['disconnect']);
  });

  it('does not leave while a code is being sent', async () => {
    const s = flow(PROVIDERS);
    await s.start();
    s.beginSignIn();
    const sending = s.submitEmail('ann@example.test');
    expect(screen(s, 'email').busy).toBe(true);
    await s.signInWith('apple');
    await sending;
    expect([supabase.left, kind(s)]).toEqual([[], 'code']);
  });

  it('a guest who comes back signed in keeps the character: the hello brings the guest\'s token, and the welcome says it was claimed', async () => {
    const s = await asGuest();
    await leaveFor(s, 'google');
    // Google said yes, and supabase-js turned the code the page came back with into a session.
    supabase.session_ = { token: 'google-access', email: 'wren@gmail.test' };
    const back = await comeBack();
    expect(did).toEqual(['disconnect', 'connect']);
    expect(screen(back, 'message').text).toBe('Connecting...');
    expect(await back.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'google-access', token: GUEST_TOKEN });
    back.welcomed(welcome({ claimed: true, name: 'Wren' }));
    expect([back.guest, back.claimed]).toEqual([false, true]);
    expect(back.news).toEqual({ title: 'Signed in', sub: expect.stringMatching(/^Your character is yours to keep\./) });
    expect(store.get(PROVIDER_KEY)).toBeNull();
    // The next page plays the account's character at once, like after a code.
    const later = flow(PROVIDERS);
    await later.start();
    expect(await later.hello()).toMatchObject({ auth: 'google-access' });
  });

  it('comes back to the same question as after a code when the account already has a character', async () => {
    const s = await asGuest();
    await leaveFor(s, 'apple');
    supabase.session_ = { token: 'apple-access', email: 'x7@privaterelay.appleid.com' };
    const back = await comeBack();
    await back.hello();
    await back.refused('has_character', 'This account already has a character', 'Aldo');
    expect(screen(back, 'account')).toEqual({ kind: 'account', name: 'Aldo' });
    back.playAccount();
    expect(await back.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'apple-access' });
    back.welcomed(welcome({ name: 'Aldo' }));
    expect(back.news).toEqual({ title: 'Signed in', sub: expect.stringMatching(/^Welcome back, Aldo\./) });
    expect(store.get(SET_ASIDE_KEY)).toBe(GUEST_TOKEN);
  });

  it('asks for a name after signing in with a provider when neither the account nor this browser has a character', async () => {
    const s = flow(PROVIDERS);
    await s.start();
    await leaveFor(s, 'google');
    supabase.session_ = { token: 'google-access', email: 'ann@gmail.test' };
    const back = await comeBack();
    expect(await back.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'google-access' });
    await back.refused('need_name', 'Choose a name for your character');
    expect(screen(back, 'name')).toEqual({ kind: 'name', signedIn: true, who: 'ann@gmail.test', error: '' });
  });

  it('comes back from a sign-in that did not finish to the card, with a plain line, and the guest plays on', async () => {
    const s = await asGuest();
    await leaveFor(s, 'apple');
    // Cancelled on Apple's page, or refused: the page comes back without a session.
    const back = await comeBack();
    expect(screen(back, 'email')).toEqual({
      kind: 'email', dev: false, email: '', error: '', busy: false, back: 'Keep playing as a guest', providers: ['google', 'apple'],
      providerError: 'Signing in with Apple did not finish. Try again, or use your email.',
    });
    expect(did).toEqual(['disconnect']); // nothing connected: the card is up
    // The guest is as it was: its way back plays it at once.
    back.back();
    expect(did).toEqual(['disconnect', 'connect']);
    expect(await back.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, token: GUEST_TOKEN });
    // Said once: a reload plays the guest.
    const reloaded = flow(PROVIDERS);
    await reloaded.start();
    expect(did).toEqual(['disconnect', 'connect', 'connect']);
    // Trying again from the card works as the first time.
    await back.signInWith('google');
    expect(supabase.left.at(-1)).toEqual(['google', GAME]);
  });

  it('comes back from a first visit\'s sign-in that did not finish to the card, whose way back is the play card', async () => {
    const s = flow(PROVIDERS);
    await s.start();
    await leaveFor(s, 'google');
    const back = await comeBack();
    expect(screen(back, 'email')).toMatchObject({ back: 'Back', providerError: 'Signing in with Google did not finish. Try again, or use your email.' });
    back.back();
    expect(kind(back)).toBe('play');
    // The email still works from that card.
    back.beginSignIn();
    await back.submitEmail('ann@example.test');
    expect(kind(back)).toBe('code');
  });

  it('says so on the card when the page cannot leave for the provider', async () => {
    const s = await asGuest();
    supabase.leaveProblem = new AuthProblem('other');
    s.beginSignIn();
    await s.signInWith('google');
    expect(screen(s, 'email')).toMatchObject({ providerError: 'Signing in with Google did not finish. Try again, or use your email.', back: 'Keep playing as a guest' });
    expect(store.get(PROVIDER_KEY)).toBeNull();
  });

  it('forgets a sign-in that left long ago, or from another Supabase project: the page plays as usual', async () => {
    store.set(TOKEN_KEY, GUEST_TOKEN);
    store.set(PROVIDER_KEY, JSON.stringify({ provider: 'google', at: now - 11 * 60_000, project: SUPABASE.url }));
    expect(kind(await comeBack())).toBe('message'); // connecting, as the guest
    store.set(PROVIDER_KEY, JSON.stringify({ provider: 'google', at: now, project: 'https://other.supabase.co' }));
    expect(kind(await comeBack())).toBe('message');
    store.set(PROVIDER_KEY, 'not json');
    expect(kind(await comeBack())).toBe('message');
    expect(store.get(PROVIDER_KEY)).toBeNull();
    // A provider the server no longer offers: nothing to try again.
    store.set(PROVIDER_KEY, JSON.stringify({ provider: 'apple', at: now, project: SUPABASE.url }));
    const noApple = flow({ ...SUPABASE, providers: ['google'] });
    await noApple.start();
    expect(kind(noApple)).toBe('message');
    expect(did).toEqual(['connect', 'connect', 'connect', 'connect']);
  });

  it('says it did not finish when the browser brings back the page that left (the back button), unless a later page signed in', async () => {
    const s = await asGuest();
    await leaveFor(s, 'google');
    await s.resumed();
    expect(screen(s, 'email').providerError).toBe('Signing in with Google did not finish. Try again, or use your email.');
    expect(store.get(PROVIDER_KEY)).toBeNull();
    // Only a page that left says so: brought back again, it stays as it is.
    await s.resumed();
    expect(kind(s)).toBe('email');

    // It left again; the page that came back signed in (and read what was noted), then the back button.
    await s.signInWith('apple');
    supabase.session_ = { token: 'apple-access', email: 'x7@privaterelay.appleid.com' };
    await comeBack();
    did = [];
    await s.resumed();
    expect(did).toEqual(['connect']);
    expect(await s.hello()).toMatchObject({ auth: 'apple-access', token: GUEST_TOKEN });
  });

  it('shows the buttons in dev mode when the server lists them, and says there that they need a Supabase project', async () => {
    const s = flow({ mode: 'dev', providers: ['google', 'apple'] });
    await s.start();
    s.beginSignIn();
    expect(screen(s, 'email')).toMatchObject({ dev: true, providers: ['google', 'apple'], providerError: '' });
    await s.signInWith('apple');
    expect(screen(s, 'email')).toMatchObject({ dev: true, providerError: 'Google and Apple sign-in only work with a Supabase project.' });
    expect([store.get(PROVIDER_KEY), tab.get(PROVIDER_KEY)]).toEqual([null, null]);
    // The email is still how dev mode signs in.
    await s.submitEmail('cid@example.test');
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'cid@example.test' });
    // Without them listed, dev mode is the email alone, as before.
    const plain = flow({ mode: 'dev', providers: [] });
    await plain.start();
    plain.beginSignIn();
    expect(screen(plain, 'email').providers).toEqual([]);
  });
});

describe('a server whose sign-in changed since the page loaded', () => {
  it('loads the page again when the server now wants another kind, and signs in again otherwise', async () => {
    tab.set(DEV_EMAIL_KEY, 'cid@example.test');
    let serverMode: AuthConfig['mode'] = 'supabase';
    const s = new SignIn({
      config: { mode: 'dev', providers: [] }, store, tab, now: () => now, serverMode: async () => serverMode,
      connect: () => did.push('connect'), disconnect: () => did.push('disconnect'), show: () => {}, reload: () => did.push('reload'),
    });
    await s.start();
    await s.refused('sign_in_required', 'Sign in to play');
    expect(did).toEqual(['connect', 'disconnect', 'reload']);
    // The same mode as before: this page's own sign-in again.
    serverMode = 'dev';
    await s.refused('sign_in_required', 'Sign in to play');
    expect(did).toEqual(['connect', 'disconnect', 'reload', 'disconnect']);
    expect(screen(s, 'email').error).toBe('Please sign in again.');
  });
});

describe('without sign-in (legacy)', () => {
  const LEGACY: AuthConfig = { mode: 'legacy' };

  it('asks for a name, keeps the token the welcome brings, and logs back in with it', async () => {
    const s = flow(LEGACY);
    await s.start();
    expect(screen(s, 'name')).toEqual({ kind: 'name', signedIn: false, who: null, error: '' });
    expect(await s.hello()).toBeNull();
    s.submitName('Aldo');
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, name: 'Aldo' });
    s.welcomed(welcome({ token: LEGACY_TOKEN }));
    expect(store.get(TOKEN_KEY)).toBe(LEGACY_TOKEN);
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, token: LEGACY_TOKEN });

    const reloaded = flow(LEGACY);
    await reloaded.start();
    expect(did).toEqual(['connect', 'connect']);
  });

  it('forgets a token the server does not know, and shows the server\'s words for a bad name', async () => {
    store.set(TOKEN_KEY, LEGACY_TOKEN);
    const s = flow(LEGACY);
    await s.start();
    await s.refused('unknown_token', 'Unknown token: choose a name');
    expect(store.get(TOKEN_KEY)).toBeNull();
    expect(kind(s)).toBe('name');
    s.submitName('Aldo');
    await s.refused('bad_name', 'Too many new players from your network. Try again later.');
    expect(screen(s, 'name').error).toBe('Too many new players from your network. Try again later.');
  });

  it('loads the page again when the server wants sign-in now', async () => {
    store.set(TOKEN_KEY, LEGACY_TOKEN);
    const s = flow(LEGACY);
    await s.start();
    await s.refused('sign_in_required', 'Sign in to play');
    expect(did).toEqual(['connect', 'disconnect', 'reload']);
  });

  it('logs out: the token is forgotten, and the name card is back', async () => {
    store.set(TOKEN_KEY, LEGACY_TOKEN);
    const s = flow(LEGACY);
    await s.start();
    await s.signOut();
    expect(store.get(TOKEN_KEY)).toBeNull();
    expect(kind(s)).toBe('name');
  });
});

describe('the server\'s other answers', () => {
  it('offers to play here after playing on another screen, and waits out a full server', async () => {
    store.set(TOKEN_KEY, LEGACY_TOKEN);
    const s = flow({ mode: 'legacy' });
    await s.start();
    await s.refused('replaced', 'You are playing somewhere else');
    const replaced = screen(s, 'message');
    expect(replaced).toMatchObject({ text: 'You are playing on another screen.', button: { label: 'Play here' } });
    replaced.button!.run();
    expect(did).toEqual(['connect', 'disconnect', 'connect']);
    await s.refused('server_full', 'The server is full, try again soon');
    expect(screen(s, 'message').text).toMatch(/full right now/);
    expect(did).toEqual(['connect', 'disconnect', 'connect']); // the connection keeps trying by itself
  });
});

describe('asking the server how to sign in', () => {
  const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

  it('takes what /auth-config says', async () => {
    expect(await loadAuthConfig(answer(200, SUPABASE))).toEqual(SUPABASE);
    expect(await loadAuthConfig(answer(200, { mode: 'dev' }))).toEqual({ mode: 'dev', providers: [] });
  });

  it('takes the providers it lists, and none from a server from before them; one this page does not know is left out', async () => {
    expect(await loadAuthConfig(answer(200, PROVIDERS))).toEqual(PROVIDERS);
    const { providers: _, ...before } = PROVIDERS;
    expect(await loadAuthConfig(answer(200, before))).toEqual(SUPABASE);
    expect(await loadAuthConfig(answer(200, { ...PROVIDERS, providers: ['facebook', 'apple'] }))).toEqual({ ...SUPABASE, providers: ['apple'] });
  });

  it('plays without sign-in with a server from before /auth-config', async () => {
    expect(await loadAuthConfig(answer(404, 'Not found'))).toEqual({ mode: 'legacy' });
  });

  it('throws, to try again, when the server fails or says something else', async () => {
    await expect(loadAuthConfig(answer(502, 'Bad gateway'))).rejects.toThrow(/502/);
    await expect(loadAuthConfig(answer(200, { mode: 'magic' }))).rejects.toThrow(/did not say how to sign in/);
    await expect(loadAuthConfig(answer(200, { ...SUPABASE, url: 'javascript:alert(1)' }))).rejects.toThrow();
  });
});

describe('the code', () => {
  it('is its digits, however it was typed or pasted, at most six', () => {
    expect(digits('123 456')).toBe('123456');
    expect(digits('123-456')).toBe('123456');
    expect(digits(' 12 34 56 78')).toBe('123456');
    expect(digits('abc')).toBe('');
  });
});
