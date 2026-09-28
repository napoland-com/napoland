/**
 * Play first, sign in to keep it, over the real HTTP + WebSocket stack. On a server with sign-in (a
 * stand-in Supabase project, and dev mode) a hello without sign-in plays a guest, whose token lives in
 * the browser: guests play like anyone, but may not talk or have friends, and are seen as guests by
 * others. Signing in with a guest's token keeps the character, unless the account has one of its own,
 * which the server says first. Guests who stay away GUEST_DAYS are deleted, at start-up and once a day.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GUEST_DAYS, MARK_LIFETIME_MS, PROTOCOL_VERSION, type ClientMsg, type RefusedAction } from '@napoland/shared';
import { devAuth, supabaseAuth } from '../src/auth';
import { setLogLevel } from '../src/log';
import { hashToken } from '../src/net';
import { startServer } from '../src/server';
import { MemoryStorage } from '../src/storage';
import { itemsData } from './fixtures';
import { Client, forgetsGuestsWhoStayedAway, newName, playFirstThenSignIn, savedPlayer, serverDefaults, setup, waitFor } from './helpers';
import { JWT_SECRET, PUBLISHABLE_KEY, fakeSupabase, type FakeProject } from './supabase';

const hello = (more: Partial<Extract<ClientMsg, { t: 'hello' }>>): ClientMsg => ({ t: 'hello', v: PROTOCOL_VERSION, ...more });
const DAY_MS = 86_400_000;

describe('guests on a server with Supabase sign-in', () => {
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

  it('a first visit plays at once: a name makes a guest, whose token alone brings it back', async () => {
    const first = await open();
    const welcome = await welcomed(first, hello({ name: 'Wren' }));
    expect(welcome).toMatchObject({ name: 'Wren', guest: true, map: { id: 'town' }, token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(welcome.claimed).toBeUndefined();
    // Only its hash is kept, and no identity: nothing says who plays it.
    expect(ctx.storage.get(welcome.you)).toMatchObject({ name: 'Wren', authSub: null, tokenHash: hashToken(welcome.token!) });
    // Friends and messages wait for sign-in: none follow the welcome.
    expect((await first.settle()).filter(m => m.t === 'friends' || m.t === 'tells')).toEqual([]);
    first.ws.close();
    await waitFor(() => !ctx.server.world.has(welcome.you), 'the guest to leave');

    const back = await welcomed(await open(), hello({ token: welcome.token! }));
    expect(back).toMatchObject({ you: welcome.you, name: 'Wren', guest: true, token: welcome.token });
    await refused(hello({ token: 'n'.repeat(43) }), 'unknown_token', 1000);
  });

  it('shows others who plays as a guest, and never a signed-in player as one', async () => {
    const watcher = await open();
    const signed = await welcomed(watcher, hello({ auth: await project.token({ sub: `user-${++users}` }), name: newName() }));
    expect(signed.guest).toBe(false);
    const guest = await welcomed(await open(), hello({ name: newName() }));
    expect((await watcher.next('join', m => m.player.id === guest.you)).player).toMatchObject({ id: guest.you, guest: true });
    expect(guest.players.find(p => p.id === guest.you)).toMatchObject({ guest: true });
    expect(guest.players.find(p => p.id === signed.you)!.guest).toBeUndefined();
  });

  it('keeps the guest when its player signs in: the claim, even with the guest still online elsewhere', async () => {
    const guestTab = await open();
    const guest = await welcomed(guestTab, hello({ name: newName() }));
    const sub = `user-${++users}`;
    const signedIn = await open();
    const kept = await welcomed(signedIn, hello({ auth: await project.token({ sub }), token: guest.token! }));
    expect(kept).toMatchObject({ you: guest.you, name: guest.name, claimed: true, guest: false });
    expect(kept.token).toBeUndefined();
    expect(await guestTab.next('error')).toMatchObject({ code: 'replaced' });
    expect(ctx.storage.get(guest.you)).toMatchObject({ authSub: sub, tokenHash: hashToken(guest.token!) });
    // Signed in now in the world too: it may talk (a guest may not), and others no longer see a guest.
    signedIn.send({ t: 'say', to: 'local', text: 'kept it' });
    expect(await signedIn.next('said')).toMatchObject({ id: guest.you, text: 'kept it' });

    // Its token alone plays it no more: the character is the account's, and a guest cannot take it over.
    await refused(hello({ token: guest.token! }), 'sign_in_required', 1000);
    expect(ctx.server.world.has(guest.you)).toBe(true);
    expect(await ctx.storage.findByAuthSub(sub)).toMatchObject({ id: guest.you });
  });

  it('says so before an account with a character of its own plays in the guest\'s place, and the guest stays as it was', async () => {
    const sub = `user-${++users}`;
    const mine = await welcomed(await open(), hello({ auth: await project.token({ sub }), name: newName() }));
    const guest = await welcomed(await open(), hello({ name: newName() }));
    const asked = await open();
    asked.send(hello({ auth: await project.token({ sub }), token: guest.token! }));
    expect(await asked.next('error')).toEqual({ t: 'error', code: 'has_character', message: expect.any(String), name: mine.name });
    expect((await asked.closed).code).toBe(1000);
    expect(ctx.storage.get(guest.you)!.authSub).toBeNull();
    // The guest still plays by its token, in this browser.
    expect((await welcomed(await open(), hello({ token: guest.token! }))).you).toBe(guest.you);
  });
});

describe('what a guest may not do (dev sign-in)', () => {
  const { ctx, open, welcomed } = setup({ auth: devAuth(), items: itemsData() });
  const signedIn = async (email: string) => {
    const c = await open();
    return { c, welcome: await welcomed(c, hello({ auth: email, name: newName() })) };
  };
  const guest = async () => {
    const c = await open();
    return { c, welcome: await welcomed(c, hello({ name: newName() })) };
  };

  it('a guest cannot talk, and hears why; what others say still reaches them', async () => {
    const sam = await signedIn('sam@example.test');
    const g = await guest();
    g.c.send({ t: 'say', to: 'world', text: 'hello?' });
    expect(await g.c.next('refused')).toEqual({ t: 'refused', action: 'say', reason: 'sign_in_first' });
    sam.c.send({ t: 'say', to: 'local', text: 'welcome to town' });
    expect(await g.c.next('said')).toMatchObject({ id: sam.welcome.you, text: 'welcome to town' });
  });

  it('a guest is refused everything among friends, each by its own name, and nothing is kept', async () => {
    const ann = await signedIn('ann@example.test');
    const g = await guest();
    const them = ann.welcome.you;
    const asks: ClientMsg[] = [
      { t: 'befriend', id: them }, { t: 'befriend', name: ann.welcome.name }, { t: 'answer', id: them, yes: true }, { t: 'unfriend', id: them },
      { t: 'tell', to: them, text: 'hi' }, { t: 'read', from: them }, { t: 'block', id: them, on: true }, { t: 'report', id: them, reason: 'rude', quote: 'x' },
      { t: 'requests', off: true }, { t: 'friends' },
    ];
    for (const msg of asks) {
      g.c.send(msg);
      expect(await g.c.next('refused'), msg.t).toEqual({ t: 'refused', action: msg.t as RefusedAction, reason: 'sign_in_first' });
    }
    expect(await ctx.storage.linksOf(g.welcome.you)).toEqual([]);
    expect(ctx.storage.reports.filter(r => r.reporter === g.welcome.you)).toEqual([]);
    expect((await ctx.storage.findPerson({ id: g.welcome.you }))!.requestsOff).toBe(false);
    // And no friends list ever came: they wait for sign-in.
    expect((await g.c.settle()).filter(m => m.t === 'friends' || m.t === 'tells')).toEqual([]);
  });

  it('nobody can ask a guest to be friends, but a guest can be blocked and reported', async () => {
    const bo = await signedIn('bo@example.test');
    const g = await guest();
    bo.c.send({ t: 'befriend', id: g.welcome.you });
    expect(await bo.c.next('refused')).toEqual({ t: 'refused', action: 'befriend', reason: 'guest' });
    bo.c.send({ t: 'befriend', name: g.welcome.name.toUpperCase() });
    expect(await bo.c.next('refused')).toEqual({ t: 'refused', action: 'befriend', reason: 'guest' });
    bo.c.send({ t: 'block', id: g.welcome.you, on: true });
    expect((await bo.c.next('friends', m => m.blocked.length === 1)).blocked).toEqual([{ id: g.welcome.you, name: g.welcome.name }]);
    bo.c.send({ t: 'report', id: g.welcome.you, reason: 'spam' });
    await bo.c.settle();
    await waitFor(() => ctx.storage.reports.some(r => r.reported === g.welcome.you), 'the report to be kept');
    expect(ctx.storage.reports.find(r => r.reported === g.welcome.you)).toMatchObject({ reporter: bo.welcome.you, reason: 'spam' });
    // Nothing among friends reaches the guest, not even the block.
    expect((await g.c.settle()).filter(m => m.t === 'friends' || m.t === 'tells')).toEqual([]);
  });

  it('plays first, then keeps the guest on sign-in, in memory', async () => {
    await playFirstThenSignIn(new MemoryStorage());
  });
});

describe('new guests on a server with a limit of 1 new player per address', () => {
  const { open, refused, welcomed } = setup({ auth: devAuth(), newPlayersPerIpPerHour: 1 });

  it('count against the limit like anyone new; coming back and signing in never do', async () => {
    const first = await welcomed(await open(), hello({ name: newName() }));
    expect(first.guest).toBe(true);
    await refused(hello({ name: newName() }), 'bad_name', 1000);
    expect((await welcomed(await open(), hello({ token: first.token! }))).you).toBe(first.you);
    expect(await welcomed(await open(), hello({ auth: 'late@example.test', token: first.token! }))).toMatchObject({ you: first.you, claimed: true });
  });
});

describe('guests who stay away', () => {
  it('are forgotten from memory with all that is theirs, and never someone signed in', async () => {
    await forgetsGuestsWhoStayedAway(new MemoryStorage());
  });

  it(`are deleted at start-up after ${GUEST_DAYS} days, pile and marks too, but never on a server without sign-in`, async () => {
    setLogLevel('silent');
    const now = Date.now();
    const storage = new MemoryStorage();
    const away = await savedPlayer(storage, { lastSeenAt: now - GUEST_DAYS * DAY_MS - 60_000 });
    const lately = await savedPlayer(storage, { lastSeenAt: now - (GUEST_DAYS - 1) * DAY_MS });
    const signed = await savedPlayer(storage, { lastSeenAt: now - 400 * DAY_MS, authSub: 'dev:long-gone@example.test' });
    await storage.saveDrop({ owner: away.id, name: away.name, map: 'woods', x: 3, y: 6, items: [{ item: 'moss', count: 2 }], droppedAt: now - 1000 });
    await storage.saveMark({ id: 1, owner: away.id, name: away.name, color: '#fff', map: 'woods', x: 3, y: 5, dir: 'up', placedAt: now - 1000 });
    // This server has deleted guests for longer than GUEST_DAYS, so everyone had time to read the rule.
    await storage.guestsSince(now - GUEST_DAYS * DAY_MS - 60_000);

    // Without sign-in every character is made that way, and none is a guest: nobody goes.
    const legacy = await startServer({ ...serverDefaults(), storage, items: itemsData() });
    await legacy.stop();
    expect(storage.get(away.id)).toBeDefined();

    const server = await startServer({ ...serverDefaults(), storage, items: itemsData(), auth: devAuth() });
    try {
      expect(storage.get(away.id)).toBeUndefined();
      expect(storage.drop(away.id)).toBeUndefined();
      expect(server.world.dropViews('woods')).toEqual([]);
      expect(await storage.loadMarks(0, MARK_LIFETIME_MS)).toEqual([]);
      expect(storage.get(lately.id)).toBeDefined();
      expect(storage.get(signed.id)).toBeDefined();
    } finally {
      await server.stop();
    }
  });

  it('are looked for again every day (every few ms here)', async () => {
    setLogLevel('silent');
    const storage = new MemoryStorage();
    await storage.guestsSince(Date.now() - GUEST_DAYS * DAY_MS - 60_000);
    const server = await startServer({ ...serverDefaults(), storage, items: itemsData(), auth: devAuth(), forgetGuestsEveryMs: 20 });
    try {
      const later = await savedPlayer(storage, { lastSeenAt: Date.now() - GUEST_DAYS * DAY_MS - 60_000 });
      await waitFor(() => !storage.get(later.id), 'the next round of the cleanup');
    } finally {
      await server.stop();
    }
  });

  it(`wait ${GUEST_DAYS} days after a server first deletes guests, so every player can read the rule in the game first`, async () => {
    setLogLevel('silent');
    const now = Date.now();
    const storage = new MemoryStorage();
    // Made before sign-in, never claimed, last played long ago: a guest now, and told only once back.
    const old = await savedPlayer(storage, { lastSeenAt: now - 400 * DAY_MS });
    const server = await startServer({ ...serverDefaults(), storage, items: itemsData(), auth: devAuth(), forgetGuestsEveryMs: 20 });
    try {
      await new Promise(r => setTimeout(r, 100));
      expect(storage.get(old.id)).toBeDefined();
      // The day the rule began is kept: a restart does not start the wait again.
      const began = await storage.guestsSince(now + DAY_MS);
      expect(began).toBeGreaterThanOrEqual(now);
      expect(began).toBeLessThan(now + DAY_MS);
    } finally {
      await server.stop();
    }
  });

  it(`count a character made on a server without sign-in, and never claimed, as a guest: deleted after ${GUEST_DAYS} days away once the rule is as old (privacy.html)`, async () => {
    setLogLevel('silent');
    const storage = new MemoryStorage();
    const legacy = await startServer({ ...serverDefaults(), storage, items: itemsData() });
    let made: string;
    try {
      const c = await Client.open(legacy.port);
      c.send({ t: 'hello', v: PROTOCOL_VERSION, name: newName() });
      made = (await c.next('welcome')).you;
      c.ws.terminate();
    } finally {
      await legacy.stop();
    }
    await storage.save({ ...storage.get(made)!, lastSeenAt: Date.now() - (GUEST_DAYS + 1) * DAY_MS });
    await storage.guestsSince(Date.now() - (GUEST_DAYS + 1) * DAY_MS);
    const signIn = await startServer({ ...serverDefaults(), storage, items: itemsData(), auth: devAuth() });
    await signIn.stop();
    expect(storage.get(made)).toBeUndefined();
  });

  it('never take a guest who plays: one who comes back is seen at once', async () => {
    setLogLevel('silent');
    const storage = new MemoryStorage();
    const server = await startServer({ ...serverDefaults(), storage, items: itemsData(), auth: devAuth() });
    const c = await Client.open(server.port);
    try {
      const cutoff = Date.now() - GUEST_DAYS * DAY_MS;
      const back = await savedPlayer(storage, { lastSeenAt: cutoff - 60_000 });
      c.send(hello({ token: back.token }));
      expect(await c.next('welcome')).toMatchObject({ you: back.id, guest: true });
      expect(storage.get(back.id)!.lastSeenAt).toBeGreaterThan(cutoff);
      // The day's round comes right after: it stays.
      expect(await storage.forgetGuests(cutoff)).toEqual([]);
      expect(storage.get(back.id)).toBeDefined();
    } finally {
      c.ws.terminate();
      await server.stop();
    }
  });
});

/**
 * A guest's hello by its token alone, while the same browser (or whoever has the token) signs in with
 * it in another tab: the claim may land at any moment of that hello. Whenever it does, the token plays
 * the character no more (sign_in_required), and the account's own session stays where it is.
 */
describe('a guest\'s hello racing the claim of its character', () => {
  /** Storage whose seen() waits for the test: before it writes (`before`), or after it wrote (`after`). */
  class HeldSeen extends MemoryStorage {
    at: 'before' | 'after' | null = null;
    reached: () => void = () => {};
    private release: () => void = () => {};
    private gate: Promise<void> = Promise.resolve();
    hold(at: 'before' | 'after'): Promise<void> {
      this.at = at;
      this.gate = new Promise(resolve => { this.release = resolve; });
      return new Promise(resolve => { this.reached = resolve; });
    }
    letGo(): void {
      this.at = null;
      this.release();
    }
    override async seen(id: string, at: number): Promise<boolean> {
      const when = this.at;
      if (when === 'before') { this.reached(); await this.gate; }
      const here = await super.seen(id, at);
      if (when === 'after') { this.reached(); await this.gate; }
      return here;
    }
  }

  for (const when of ['before', 'after'] as const) {
    it(`refuses the token and keeps the account playing when the claim lands ${when} the guest is seen`, async () => {
      setLogLevel('silent');
      const storage = new HeldSeen();
      const server = await startServer({ ...serverDefaults(), storage, items: itemsData(), auth: devAuth() });
      const clients: Client[] = [];
      const open = async () => { const c = await Client.open(server.port); clients.push(c); return c; };
      try {
        const first = await open();
        first.send(hello({ name: newName() }));
        const guest = await first.next('welcome');
        first.ws.close();
        await waitFor(() => !server.world.has(guest.you), 'the guest to leave');

        const seen = storage.hold(when);
        const byToken = await open();
        byToken.send(hello({ token: guest.token! }));
        await seen;
        const account = await open();
        account.send(hello({ auth: 'owner@example.test', token: guest.token! }));
        expect(await account.next('welcome')).toMatchObject({ you: guest.you, claimed: true, guest: false });
        storage.letGo();

        expect(await byToken.next('error')).toMatchObject({ code: 'sign_in_required' });
        expect(server.world.get(guest.you)!.authSub).toBe('dev:owner@example.test');
        // The account was not thrown out.
        account.send({ t: 'ping', at: 1 });
        await account.next('pong');
        expect(account.inbox.some(m => m.t === 'error')).toBe(false);
        expect(storage.get(guest.you)!.authSub).toBe('dev:owner@example.test');
      } finally {
        storage.letGo();
        for (const c of clients) c.ws.terminate();
        await server.stop();
      }
    });
  }
});
