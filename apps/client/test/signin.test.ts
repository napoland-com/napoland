/**
 * The sign-in flow (signin.ts) in each mode, with a stand-in for Supabase and for the connection:
 * no page and no network.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type AuthConfig, type ServerMsg } from '@napoland/shared';
import {
  AuthProblem, CODE_SENT_KEY, DEV_EMAIL_KEY, RESEND_AFTER_MS, SignIn, TOKEN_KEY, digits, loadAuthConfig,
  type AuthBackend, type Screen, type Session, type Store,
} from '../src/signin';
import { ASLEEP, DRY, START } from './fixtures';

/** Supabase as the flow sees it: one right code, a session kept after it, refreshes that can go three ways. */
class FakeSupabase implements AuthBackend {
  session_: Session | null = null;
  code = '482913';
  sentTo: string[] = [];
  sendProblem: AuthProblem | undefined;
  offline = false;
  refreshes = 0;
  onRefresh: 'new token' | 'session gone' | 'offline' = 'new token';
  signOuts = 0;

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
  t: 'welcome', v: PROTOCOL_VERSION, you: 'p1', name: 'Aldo', map: { id: 'stonebrook', version: 1 }, players: [], finds: [], drops: [], stepMs: 200,
  weather: 'rain', energy: { value: 100, max: 100, rate: 0 }, bag: [], items: 1, serverTime: 0,
  fires: [], marks: [], creatures: [], flares: [], flashes: [], surge: null, storm: null, body: DRY, stone: ASLEEP, stats: {}, progress: START, ...more,
});

const SUPABASE: AuthConfig = { mode: 'supabase', url: 'https://abcd.supabase.co', publishableKey: 'sb_publishable_x' };
const LEGACY_TOKEN = 'l'.repeat(43);

let now: number;
/** This browser's storage, and this tab's. */
let store: MemoryStore;
let tab: MemoryStore;
let supabase: FakeSupabase;
/** What the flow did to the connection and the page, in order. */
let did: string[];

function flow(config: AuthConfig) {
  return new SignIn({
    config, store, tab, backend: config.mode === 'supabase' ? supabase : undefined, now: () => now,
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
  it('asks for an email, sends a code to it, and plays with the session the right code brings', async () => {
    const s = flow(SUPABASE);
    await s.start();
    expect(screen(s, 'email')).toEqual({ kind: 'email', dev: false, email: '', error: '', busy: false });
    expect(await s.hello()).toBeNull(); // nobody to sign in as yet

    await s.submitEmail(' ann@example.test ');
    expect(supabase.sentTo).toEqual(['ann@example.test']);
    expect(screen(s, 'code')).toMatchObject({ email: 'ann@example.test', error: '', busy: false, resendAt: now + RESEND_AFTER_MS });
    expect(did).toEqual([]);

    await s.submitCode('482913');
    expect(did).toEqual(['connect']);
    expect(screen(s, 'message').text).toBe('Connecting...');
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'access-1' });
    s.welcomed(welcome());
    expect(kind(s)).toBe('none');
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
    expect(kind(elsewhere)).toBe('email');

    await reloaded.submitCode('482913');
    expect(did).toEqual(['connect']);
    expect(store.get(CODE_SENT_KEY)).toBeNull();

    // A code from more than an hour ago is no good any more.
    const old = flow(SUPABASE);
    supabase.session_ = null;
    await old.start();
    await old.submitEmail('bea@example.test');
    now += 3_600_001;
    const late = flow(SUPABASE);
    await late.start();
    expect(kind(late)).toBe('email');
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

  it('signs out: Supabase forgets the session here, and the email card is back', async () => {
    supabase.session_ = { token: 'kept', email: 'ann@example.test' };
    store.set(TOKEN_KEY, LEGACY_TOKEN);
    const s = flow(SUPABASE);
    await s.start();
    s.welcomed(welcome());
    await s.signOut();
    expect(supabase.signOuts).toBe(1);
    expect(did).toEqual(['connect', 'disconnect']);
    expect(screen(s, 'email').error).toBe('');
    expect(await s.hello()).toBeNull();
    // The token of a claimed character claims nothing for anyone else, so it may stay.
    expect(store.get(TOKEN_KEY)).toBe(LEGACY_TOKEN);
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
  const DEV: AuthConfig = { mode: 'dev' };

  it('asks for an email and nothing else, and remembers it in this tab (another tab can be someone else)', async () => {
    const s = flow(DEV);
    await s.start();
    expect(screen(s, 'email')).toMatchObject({ dev: true, error: '' });
    await s.submitEmail('not an email');
    expect(screen(s, 'email').error).toMatch(/does not look like an email/);
    await s.submitEmail(' Cid@Example.test ');
    expect(did).toEqual(['connect']);
    expect(tab.get(DEV_EMAIL_KEY)).toBe('cid@example.test');
    expect(store.get(DEV_EMAIL_KEY)).toBeNull();
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'cid@example.test' });

    // The tab reloaded: still signed in.
    const reloaded = flow(DEV);
    await reloaded.start();
    expect(did).toEqual(['connect', 'connect']);

    // Another tab asks.
    tab = new MemoryStore();
    const other = flow(DEV);
    await other.start();
    expect(kind(other)).toBe('email');
  });

  it('asks for a name, claims with a kept token, and forgets the email when refused or signed out', async () => {
    tab.set(DEV_EMAIL_KEY, 'cid@example.test');
    store.set(TOKEN_KEY, LEGACY_TOKEN);
    const s = flow(DEV);
    await s.start();
    await s.refused('need_name', 'Choose a name for your character');
    expect(screen(s, 'name')).toMatchObject({ signedIn: true, who: 'cid@example.test' });
    s.submitName('Cid');
    expect(await s.hello()).toEqual({ t: 'hello', v: PROTOCOL_VERSION, auth: 'cid@example.test', token: LEGACY_TOKEN, name: 'Cid' });

    await s.refused('sign_in_required', 'Sign in to play');
    expect(tab.get(DEV_EMAIL_KEY)).toBeNull();
    expect(screen(s, 'email').error).toBe('Please sign in again.');

    await s.submitEmail('cid@example.test');
    await s.signOut();
    expect(tab.get(DEV_EMAIL_KEY)).toBeNull();
    expect(kind(s)).toBe('email');
  });
});

describe('a server whose sign-in changed since the page loaded', () => {
  it('loads the page again when the server now wants another kind, and signs in again otherwise', async () => {
    tab.set(DEV_EMAIL_KEY, 'cid@example.test');
    let serverMode: AuthConfig['mode'] = 'supabase';
    const s = new SignIn({
      config: { mode: 'dev' }, store, tab, now: () => now, serverMode: async () => serverMode,
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
    expect(await loadAuthConfig(answer(200, { mode: 'dev' }))).toEqual({ mode: 'dev' });
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
