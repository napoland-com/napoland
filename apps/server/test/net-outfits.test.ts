/**
 * Outfits over the real HTTP + WebSocket stack, with dev sign-in: a player signed in wears one at the
 * chest and everyone on the map sees it, newcomers too; a guest is refused until they sign in, and then
 * has them at once; an outfit the level has not reached is refused; what is worn is kept.
 */
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, xpFor, type ClientMsg } from '@napoland/shared';
import { devAuth } from '../src/auth';
import { MemoryStorage } from '../src/storage';
import { chestMaps, itemsData } from './fixtures';
import { outfitsKeptThroughARestart, savedPlayer, setup, waitFor } from './helpers';

const hello = (more: Partial<Extract<ClientMsg, { t: 'hello' }>>): ClientMsg => ({ t: 'hello', v: PROTOCOL_VERSION, ...more });
let people = 0;
const email = (name: string) => `${name}-${++people}@example.test`;

describe('outfits over WebSockets', () => {
  const { ctx, open, welcomed } = setup({ maps: chestMaps(), items: itemsData(), auth: devAuth() });

  /** Someone signed in, saved by the chest in the house (unless `where` says otherwise), at `level`, welcomed. */
  const signedIn = async (level: number, where: object = {}) => {
    const mail = email('p');
    const saved = await savedPlayer(ctx.storage, { map: 'house', x: 3, y: 2, dir: 'up', tokenHash: null, authSub: `dev:${mail}`, xp: xpFor(level), ...where });
    const c = await open();
    const welcome = await welcomed(c, hello({ auth: mail }));
    expect(welcome.you).toBe(saved.id);
    return { c, welcome, id: saved.id, mail };
  };

  it('wears one at the chest: the player and everyone on the map hear it, and a newcomer sees it', async () => {
    const watcher = await signedIn(1, { x: 1, y: 3 });
    const ann = await signedIn(1);
    await watcher.c.next('join', m => m.player.id === ann.id);
    ann.c.send({ t: 'outfit', x: 3, y: 1, outfit: 'napo-suit' });
    expect(await ann.c.next('outfit')).toEqual({ t: 'outfit', id: ann.id, outfit: 'napo-suit' });
    expect(await watcher.c.next('outfit')).toEqual({ t: 'outfit', id: ann.id, outfit: 'napo-suit' });
    await waitFor(() => ctx.storage.get(ann.id)?.outfit === 'napo-suit', 'the outfit to be saved');

    // Whoever comes in next sees it in their welcome; whoever is there, in the join.
    const late = await signedIn(1, { x: 2, y: 3 });
    expect(late.welcome.players.find(p => p.id === ann.id)?.outfit).toBe('napo-suit');
    expect((await watcher.c.next('join', m => m.player.id === late.id)).player.outfit).toBeUndefined();

    ann.c.send({ t: 'outfit', x: 3, y: 1, outfit: null });
    expect(await late.c.next('outfit', m => m.id === ann.id)).toEqual({ t: 'outfit', id: ann.id, outfit: null });
    await waitFor(() => ctx.storage.get(ann.id)?.outfit === undefined, 'no outfit to be saved');
  });

  it('refuses an outfit the level has not reached, and one away from the chest', async () => {
    const low = await signedIn(9);
    low.c.send({ t: 'outfit', x: 3, y: 1, outfit: 'rain-cape' });
    expect(await low.c.next('refused')).toEqual({ t: 'refused', action: 'outfit', reason: 'locked' });
    low.c.send({ t: 'outfit', x: 3, y: 1, outfit: 'lineman-jacket' });
    expect(await low.c.next('outfit')).toMatchObject({ id: low.id, outfit: 'lineman-jacket' });
    const far = await signedIn(20, { x: 1, y: 3 });
    far.c.send({ t: 'outfit', x: 3, y: 1, outfit: 'patchwork' });
    expect(await far.c.next('refused')).toEqual({ t: 'refused', action: 'outfit', reason: 'too_far' });
  });

  it('refuses a guest (sign in first), who has them at once after signing in', async () => {
    const guest = await savedPlayer(ctx.storage, { map: 'house', x: 3, y: 2, dir: 'up', xp: xpFor(5) });
    const asGuest = await open();
    const first = await welcomed(asGuest, hello({ token: guest.token }));
    expect(first.guest).toBe(true);
    asGuest.send({ t: 'outfit', x: 3, y: 1, outfit: 'napo-suit' });
    expect(await asGuest.next('refused')).toEqual({ t: 'refused', action: 'outfit', reason: 'sign_in_first' });

    // Signing in on the same browser keeps the character, and opens its outfits, up to its level.
    const signed = await open();
    const kept = await welcomed(signed, hello({ auth: email('wren'), token: guest.token }));
    expect(kept).toMatchObject({ you: guest.id, claimed: true, guest: false });
    signed.send({ t: 'outfit', x: 3, y: 1, outfit: 'lineman-jacket' });
    expect(await signed.next('outfit')).toEqual({ t: 'outfit', id: guest.id, outfit: 'lineman-jacket' });
  });
});

describe('outfits through a restart', () => {
  it('come back with the player, in memory', async () => {
    const storage = new MemoryStorage();
    await outfitsKeptThroughARestart(storage, storage);
  });
});
