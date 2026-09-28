/**
 * Merits over the real HTTP + WebSocket stack, with dev sign-in: past level 20, a player signed in spends
 * a merit at the chest on a jacket pattern or a name tag badge (the client asks first; the server checks
 * again), and wears it, and everyone on the map sees it, newcomers too; the server refuses a look without a
 * merit to spend, the same look twice, and a guest, who spends what their XP earned once signed in; what
 * was spent and bought is kept.
 */
import { describe, expect, it } from 'vitest';
import { MERITS_FROM, MERIT_XP, PROTOCOL_VERSION, xpFor, type ClientMsg } from '@napoland/shared';
import { devAuth } from '../src/auth';
import { MemoryStorage } from '../src/storage';
import { chestMaps, itemsData } from './fixtures';
import { keepsMerits, meritsKeptThroughARestart, savedPlayer, setup, waitFor } from './helpers';

const hello = (more: Partial<Extract<ClientMsg, { t: 'hello' }>>): ClientMsg => ({ t: 'hello', v: PROTOCOL_VERSION, ...more });
let people = 0;
const email = (name: string) => `${name}-${++people}@example.test`;
/** XP worth `n` merits past level 20. */
const worth = (n: number) => MERITS_FROM + n * MERIT_XP + 20;

describe('merits over WebSockets', () => {
  const { ctx, open, welcomed } = setup({ maps: chestMaps(), items: itemsData(), auth: devAuth() });

  /** Someone signed in, saved by the chest in the house (unless `where` says otherwise), with `xp`, welcomed. */
  const signedIn = async (xp: number, where: object = {}) => {
    const mail = email('m');
    const saved = await savedPlayer(ctx.storage, { map: 'house', x: 3, y: 2, dir: 'up', tokenHash: null, authSub: `dev:${mail}`, xp, ...where });
    const c = await open();
    const welcome = await welcomed(c, hello({ auth: mail }));
    expect(welcome.you).toBe(saved.id);
    await c.settle();
    return { c, welcome, id: saved.id };
  };

  it('buy a look at the chest: it is theirs for good, they hear their merits and what it did, and it is saved at once', async () => {
    const a = await signedIn(worth(2));
    expect(a.welcome.merits).toEqual({ spent: 0, owned: [] });
    a.c.send({ t: 'buy', x: 3, y: 1, look: 'chevron' });
    expect(await a.c.next('merits')).toEqual({ t: 'merits', merits: { spent: 1, owned: ['chevron'] } });
    expect(await a.c.next('did')).toEqual({ t: 'did', did: { kind: 'bought', look: 'chevron', left: 1 } });
    await waitFor(() => ctx.storage.get(a.id)?.meritsSpent === 1, 'the merit spent to be saved');
    expect(ctx.storage.get(a.id)).toMatchObject({ looks: ['chevron'], xp: worth(2) });
  });

  it('are refused without a merit to spend (below level 20, or all spent), for the same look twice, and away from the chest', async () => {
    const low = await signedIn(xpFor(19));
    low.c.send({ t: 'buy', x: 3, y: 1, look: 'fir' });
    expect(await low.c.next('refused')).toEqual({ t: 'refused', action: 'buy', reason: 'no_merits' });
    const one = await signedIn(worth(1), { x: 2, y: 3 });
    one.c.send({ t: 'buy', x: 3, y: 1, look: 'fir' });
    expect(await one.c.next('refused')).toEqual({ t: 'refused', action: 'buy', reason: 'too_far' });
    const a = await signedIn(worth(1));
    a.c.send({ t: 'buy', x: 3, y: 1, look: 'fir' });
    expect(await a.c.next('did')).toMatchObject({ did: { kind: 'bought', look: 'fir', left: 0 } });
    a.c.send({ t: 'buy', x: 3, y: 1, look: 'fir' });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'buy', reason: 'owned' });
    a.c.send({ t: 'buy', x: 3, y: 1, look: 'moth' });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'buy', reason: 'no_merits' });
    a.c.send({ t: 'buy', x: 3, y: 1, look: 'crown' });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'buy', reason: 'gone' });
    expect(ctx.server.world.get(a.id)).toMatchObject({ meritsSpent: 1, looks: ['fir'] });
  });

  it('are worn one pattern and one badge at a time: the player and everyone on the map hear it, and a newcomer sees it', async () => {
    const watcher = await signedIn(0, { x: 1, y: 3 });
    const a = await signedIn(worth(3), { meritsSpent: 3, looks: ['stripes', 'checks', 'flame'] });
    await watcher.c.next('join', m => m.player.id === a.id);
    a.c.send({ t: 'pattern', x: 3, y: 1, pattern: 'stripes' });
    a.c.send({ t: 'badge', x: 3, y: 1, badge: 'flame' });
    for (const c of [a.c, watcher.c]) {
      expect(await c.next('pattern')).toEqual({ t: 'pattern', id: a.id, pattern: 'stripes' });
      expect(await c.next('badge')).toEqual({ t: 'badge', id: a.id, badge: 'flame' });
    }
    // The other pattern in its place: one at a time.
    a.c.send({ t: 'pattern', x: 3, y: 1, pattern: 'checks' });
    expect(await watcher.c.next('pattern')).toEqual({ t: 'pattern', id: a.id, pattern: 'checks' });
    await waitFor(() => ctx.storage.get(a.id)?.pattern === 'checks', 'the pattern to be saved');
    expect(ctx.storage.get(a.id)!.badge).toBe('flame');
    const late = await signedIn(0, { x: 2, y: 3 });
    expect(late.welcome.players.find(p => p.id === a.id)).toMatchObject({ pattern: 'checks', badge: 'flame' });
    expect((await watcher.c.next('join', m => m.player.id === late.id)).player).not.toHaveProperty('badge');
    // Taken off, for everyone.
    a.c.send({ t: 'badge', x: 3, y: 1, badge: null });
    expect(await late.c.next('badge', m => m.id === a.id)).toEqual({ t: 'badge', id: a.id, badge: null });
    await waitFor(() => ctx.storage.get(a.id)?.badge === undefined, 'no badge to be saved');
  });

  it('refuse wearing a look not bought, and one of the other kind', async () => {
    const a = await signedIn(worth(2), { meritsSpent: 1, looks: ['shard'] });
    a.c.send({ t: 'pattern', x: 3, y: 1, pattern: 'chevron' });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'pattern', reason: 'not_owned' });
    a.c.send({ t: 'pattern', x: 3, y: 1, pattern: 'shard' });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'pattern', reason: 'gone' });
  });

  it('are refused a guest, whose XP earns them all the same: signed in, they spend them at once', async () => {
    const guest = await savedPlayer(ctx.storage, { map: 'house', x: 3, y: 2, dir: 'up', xp: worth(1) });
    const asGuest = await open();
    expect(await welcomed(asGuest, hello({ token: guest.token }))).toMatchObject({ guest: true, merits: { spent: 0, owned: [] } });
    asGuest.send({ t: 'buy', x: 3, y: 1, look: 'moth' });
    expect(await asGuest.next('refused')).toEqual({ t: 'refused', action: 'buy', reason: 'sign_in_first' });
    asGuest.send({ t: 'badge', x: 3, y: 1, badge: null });
    expect(await asGuest.next('refused')).toEqual({ t: 'refused', action: 'badge', reason: 'sign_in_first' });
    const signed = await open();
    expect(await welcomed(signed, hello({ auth: email('wren'), token: guest.token }))).toMatchObject({ you: guest.id, claimed: true, guest: false });
    signed.send({ t: 'buy', x: 3, y: 1, look: 'moth' });
    expect(await signed.next('did')).toEqual({ t: 'did', did: { kind: 'bought', look: 'moth', left: 0 } });
  });

  it('close the connection on a message that breaks the rules of the protocol', async () => {
    for (const bad of [{ t: 'buy', x: 3, y: 1 }, { t: 'buy', x: 3, y: 1, look: '' }, { t: 'pattern', x: 3, y: 1 }, { t: 'badge', x: 3, y: 1, badge: 7 }]) {
      const a = await signedIn(0);
      a.c.send(JSON.stringify(bad));
      expect(await a.c.next('error')).toMatchObject({ code: 'bad_message' });
      expect((await a.c.closed).code).toBe(1008);
    }
  });
});

describe('merits kept in memory', () => {
  it('are saved with the player: what was spent, the looks bought, what is worn, and never lost to a save without them', async () => {
    await keepsMerits(new MemoryStorage());
  });

  it('come back with the player through a restart', async () => {
    const storage = new MemoryStorage();
    await meritsKeptThroughARestart(storage, storage);
  });
});
