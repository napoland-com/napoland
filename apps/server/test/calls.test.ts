/**
 * Calls without words, over real WebSockets: who hears a call (everyone on the caller's map within
 * CALL_REACH, the caller too, never another map or someone who blocks the caller), the limit of one
 * every CALL_EVERY_MS, and guests calling like anyone.
 */
import { describe, expect, it } from 'vitest';
import { CALL_EVERY_MS, CALL_REACH, PROTOCOL_VERSION, TileMap, type MapData } from '@napoland/shared';
import { devAuth } from '../src/auth';
import { fixtureMaps } from './fixtures';
import { newName, setup, type Client } from './helpers';

/** A field 40 tiles wide and 30 high, all grass inside its forest edge, its way home at the left end of its bottom row. */
function field(): MapData {
  const W = 40, H = 30;
  return {
    id: 'field', name: 'Field', version: 1, kind: 'wilds', depth: 1, width: W, height: H,
    tiles: ['t'.repeat(W), ...Array<string>(H - 2).fill(`t${'g'.repeat(W - 2)}t`), `tg${'t'.repeat(W - 2)}`],
    levels: Array<string>(H).fill('0'.repeat(W)), spawn: { x: 1, y: 1, dir: 'up' },
    exits: [{ x: 1, y: H - 1, w: 1, h: 1, to: 'town', tx: 4, ty: 1, dir: 'down', home: true }], objects: [],
  };
}
const maps = () => [...fixtureMaps(), new TileMap(field())];

/** The calls a client heard, in order, once everything sent before now has come in. */
const heard = async (c: Client) => (await c.settle()).filter(m => m.t === 'called');

describe('calls over the network', () => {
  let now = 1_000_000;
  const { enter } = setup({ maps: maps(), weather: 'overcast', clock: () => now });

  it('reach everyone on the caller\'s map within 25 tiles, the caller too, with the tile it came from', async () => {
    const caller = await enter({ map: 'field', x: 2, y: 2 });
    // Right at the reach, straight across and on a slant (15 and 20: 25 tiles), and one past it each way.
    const across = await enter({ map: 'field', x: 2 + CALL_REACH, y: 2 });
    const slant = await enter({ map: 'field', x: 2 + 15, y: 2 + 20 });
    const past = await enter({ map: 'field', x: 3 + CALL_REACH, y: 2 });
    const pastSlant = await enter({ map: 'field', x: 2 + 16, y: 2 + 20 });
    // The town and the woods are other maps, however near.
    const town = await enter({ map: 'town', x: 1, y: 2 });
    const all = [caller, across, slant, past, pastSlant, town];
    for (const p of all) await p.c.settle();

    caller.c.send({ t: 'call', kind: 'come' });
    const called = { t: 'called', id: caller.id, kind: 'come', x: 2, y: 2 };
    expect(await caller.c.next('called')).toEqual(called);
    expect(await across.c.next('called')).toEqual(called);
    expect(await slant.c.next('called')).toEqual(called);
    for (const p of [past, pastSlant, town]) expect(await heard(p.c)).toEqual([]);
  });

  it('come from the caller\'s tile as the server has it, wherever they walked', async () => {
    const caller = await enter({ map: 'field', x: 5, y: 5 });
    const near = await enter({ map: 'field', x: 9, y: 5 });
    caller.c.send({ t: 'step', dir: 'right', seq: 1 });
    await caller.c.next('step', m => m.id === caller.id && m.seq === 1);
    caller.c.send({ t: 'call', kind: 'thanks' });
    expect(await near.c.next('called')).toEqual({ t: 'called', id: caller.id, kind: 'thanks', x: 6, y: 5 });
  });

  it('are one every 2 seconds: one sooner is turned away, and nobody hears it', async () => {
    const caller = await enter({ map: 'field', x: 2, y: 10 });
    const near = await enter({ map: 'field', x: 4, y: 10 });
    await near.c.settle();
    caller.c.send({ t: 'call', kind: 'here' });
    await caller.c.next('called');
    await near.c.next('called');

    caller.c.send({ t: 'call', kind: 'thanks' });
    expect(await caller.c.next('refused')).toEqual({ t: 'refused', action: 'call', reason: 'slow_down' });
    now += CALL_EVERY_MS - 1;
    caller.c.send({ t: 'call', kind: 'thanks' });
    expect(await caller.c.next('refused')).toEqual({ t: 'refused', action: 'call', reason: 'slow_down' });
    expect(await heard(near.c)).toEqual([]);
    expect(await heard(caller.c)).toEqual([]);

    // Two seconds after the one that was sung, whatever was turned away meanwhile.
    now += 1;
    caller.c.send({ t: 'call', kind: 'thanks' });
    expect(await near.c.next('called')).toMatchObject({ id: caller.id, kind: 'thanks' });
    // Each player has their own limit.
    near.c.send({ t: 'call', kind: 'here' });
    expect(await caller.c.next('called', m => m.id === near.id)).toMatchObject({ kind: 'here' });
  });

  it('never reach someone who blocks the caller; the caller still hears their own', async () => {
    now += CALL_EVERY_MS;
    const caller = await enter({ map: 'field', x: 20, y: 20 });
    const blocker = await enter({ map: 'field', x: 21, y: 20 });
    const friend = await enter({ map: 'field', x: 22, y: 20 });
    blocker.c.send({ t: 'block', id: caller.id, on: true });
    await blocker.c.next('friends', m => m.blocked.length === 1);
    caller.c.send({ t: 'call', kind: 'here' });
    expect(await caller.c.next('called')).toMatchObject({ id: caller.id });
    expect(await friend.c.next('called')).toMatchObject({ id: caller.id });
    expect(await heard(blocker.c)).toEqual([]);
  });

  it('refuse a call that is none of the three, as any bad message', async () => {
    const caller = await enter({ map: 'field', x: 30, y: 3 });
    caller.c.send(JSON.stringify({ t: 'call', kind: 'shout' }));
    expect(await caller.c.next('error')).toMatchObject({ code: 'bad_message' });
    expect((await caller.c.closed).code).toBe(1008);
  });
});

describe('calls from guests', () => {
  let now = 5_000_000;
  const { join, open, welcomed } = setup({ maps: maps(), weather: 'overcast', clock: () => now, auth: devAuth() });

  it('go out like anyone\'s: there are no words to filter, where chat waits for sign-in', async () => {
    const guest = await join();
    expect(guest.welcome.guest).toBe(true);
    const signed = await open();
    const other = await welcomed(signed, { t: 'hello', v: PROTOCOL_VERSION, auth: 'wren@example.test', name: newName() });
    expect(other.guest).toBe(false);
    await signed.settle();

    guest.c.send({ t: 'say', to: 'local', text: 'hello?' });
    expect(await guest.c.next('refused')).toEqual({ t: 'refused', action: 'say', reason: 'sign_in_first' });
    now += 10;
    guest.c.send({ t: 'call', kind: 'here' });
    const at = guest.welcome.players.find(p => p.id === guest.id)!;
    const called = { t: 'called', id: guest.id, kind: 'here', x: at.x, y: at.y };
    expect(await signed.next('called')).toEqual(called);
    expect(await guest.c.next('called')).toEqual(called);
  });
});
