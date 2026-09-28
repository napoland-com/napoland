/**
 * Friends, requests, blocks, private messages and reports over real WebSockets, on a server with
 * in-memory storage. Players who are not online still have friends and messages waiting.
 */
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@napoland/shared';
import { MAX_UNREAD } from '../src/social';
import { MemoryStorage } from '../src/storage';
import { Client, keepsFriendsAndMessages, savesATradeTogether, setup, waitFor, type Msg } from './helpers';

/** The next friends list a client hears. */
const list = (c: Client, match: (m: Msg<'friends'>) => boolean = () => true) => c.next('friends', match);

describe('friends', () => {
  const { ctx, enter } = setup();

  it('ask by name, accept, and see each other online and where', async () => {
    const a = await enter({ map: 'town' });
    const b = await enter({ map: 'woods', x: 4, y: 1 });
    a.c.send({ t: 'befriend', name: b.welcome.name.toUpperCase() });
    expect(await list(a.c)).toEqual({ t: 'friends', friends: [], incoming: [], outgoing: [{ id: b.id, name: b.welcome.name }], blocked: [], requestsOff: false, tradesOff: false });
    expect((await list(b.c)).incoming).toEqual([{ id: a.id, name: a.welcome.name }]);
    b.c.send({ t: 'answer', id: a.id, yes: true });
    expect((await list(b.c)).friends).toEqual([{ id: a.id, name: a.welcome.name, map: 'town' }]);
    expect(await list(a.c)).toMatchObject({ friends: [{ id: b.id, name: b.welcome.name, map: 'woods' }], outgoing: [] });
    // Offline, a friend has no map.
    b.c.ws.close();
    await waitFor(() => !ctx.server.world.has(b.id), 'b to leave');
    a.c.send({ t: 'friends' });
    expect((await list(a.c, m => m.friends[0]?.map === null)).friends).toEqual([{ id: b.id, name: b.welcome.name, map: null }]);
  });

  it('are friends at once when both asked, and not when the other says no', async () => {
    const [a, b, c] = [await enter(), await enter(), await enter()];
    a.c.send({ t: 'befriend', id: b.id });
    await list(a.c);
    b.c.send({ t: 'befriend', id: a.id });
    expect((await list(b.c, m => m.friends.length === 1)).friends.map(f => f.id)).toEqual([a.id]);
    c.c.send({ t: 'befriend', id: a.id });
    await list(c.c);
    await list(a.c, m => m.incoming.length === 1);
    a.c.send({ t: 'answer', id: c.id, yes: false });
    expect(await list(a.c, m => m.incoming.length === 0)).toMatchObject({ friends: [{ id: b.id }], incoming: [] });
    expect(await list(c.c, m => m.outgoing.length === 0)).toMatchObject({ friends: [], outgoing: [] });
  });

  it('refuse nobody, yourself, and whoever takes no requests', async () => {
    const [a, b] = [await enter(), await enter()];
    a.c.send({ t: 'befriend', name: 'Nobody Here' });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'befriend', reason: 'unknown_player' });
    a.c.send({ t: 'befriend', id: a.id });
    expect((await a.c.next('refused')).reason).toBe('unknown_player');
    b.c.send({ t: 'requests', off: true });
    expect((await list(b.c)).requestsOff).toBe(true);
    a.c.send({ t: 'befriend', id: b.id });
    expect((await a.c.next('refused')).reason).toBe('requests_off');
  });
});

describe('private messages', () => {
  const { ctx, enter } = setup();

  async function friends() {
    const [a, b] = [await enter(), await enter()];
    a.c.send({ t: 'befriend', id: b.id });
    b.c.send({ t: 'befriend', id: a.id });
    await list(b.c, m => m.friends.length === 1);
    await list(a.c, m => m.friends.length === 1);
    return [a, b] as const;
  }

  it('go to a friend online at once, and wait for one who is not: after the welcome, until they read them', async () => {
    const [a, b] = await friends();
    a.c.send({ t: 'tell', to: b.id, text: '  meet at the old cabin  ' });
    expect((await b.c.next('tells')).tells).toEqual([{ from: a.id, name: a.welcome.name, text: 'meet at the old cabin', at: expect.any(Number) }]);
    b.c.ws.close();
    await waitFor(() => !ctx.server.world.has(b.id), 'b to leave');
    a.c.send({ t: 'tell', to: b.id, text: 'bring resin' });
    await a.c.settle();
    const back = await Client.open(ctx.server.port);
    try {
      back.send({ t: 'hello', v: PROTOCOL_VERSION, token: b.token });
      await back.next('welcome');
      expect((await back.next('tells')).tells.map(t => t.text)).toEqual(['meet at the old cabin', 'bring resin']);
      back.send({ t: 'read', from: a.id });
      await back.settle();
      expect(await ctx.storage.tellsTo(b.id)).toEqual([]);
    } finally {
      back.ws.terminate();
    }
  });

  it('go to friends only, and never pile up unread', async () => {
    const [a, b] = await friends();
    const c = await enter();
    c.c.send({ t: 'tell', to: a.id, text: 'hi' });
    expect(await c.c.next('refused')).toEqual({ t: 'refused', action: 'tell', reason: 'not_friends' });
    for (let i = 0; i < MAX_UNREAD; i++) await ctx.storage.addTell({ from: a.id, to: b.id, text: `${i}`, at: i });
    a.c.send({ t: 'tell', to: b.id, text: 'one more' });
    expect((await a.c.next('refused')).reason).toBe('too_many');
  });
});

describe('blocks and reports', () => {
  const { ctx, enter } = setup();

  it('a block ends the friendship, and nobody learns who blocked them', async () => {
    const [a, b] = [await enter(), await enter()];
    a.c.send({ t: 'befriend', id: b.id });
    b.c.send({ t: 'befriend', id: a.id });
    await list(a.c, m => m.friends.length === 1);
    a.c.send({ t: 'block', id: b.id, on: true });
    expect(await list(a.c, m => m.blocked.length === 1)).toMatchObject({ friends: [], blocked: [{ id: b.id }] });
    expect((await list(b.c, m => m.friends.length === 0)).friends).toEqual([]);
    b.c.send({ t: 'befriend', id: a.id });
    expect((await b.c.next('refused')).reason).toBe('requests_off');
    b.c.send({ t: 'tell', to: a.id, text: 'hey' });
    expect((await b.c.next('refused')).reason).toBe('not_friends');
    a.c.send({ t: 'befriend', id: b.id });
    expect((await a.c.next('refused')).reason).toBe('you_blocked');
    a.c.send({ t: 'block', id: b.id, on: false });
    expect((await list(a.c, m => m.blocked.length === 0)).blocked).toEqual([]);
  });

  it('a report is kept for the maintainers, with the quote', async () => {
    const [a, b] = [await enter(), await enter()];
    a.c.send({ t: 'report', id: b.id, reason: 'rude', quote: 'something nasty' });
    a.c.send({ t: 'report', id: a.id, reason: 'spam' });
    await a.c.settle();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(ctx.storage.reports).toEqual([{ reporter: a.id, reported: b.id, reason: 'rude', quote: 'something nasty', at: expect.any(Number) }]);
  });
});

describe('storage', () => {
  it('keeps friends, requests, blocks, unread messages, the requests settings and reports in memory', async () => {
    await keepsFriendsAndMessages(new MemoryStorage());
  });

  it('saves two players who traded together, in memory', async () => {
    await savesATradeTogether(new MemoryStorage());
  });
});
