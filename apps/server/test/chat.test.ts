/**
 * World and local chat: who hears what, the limits, the word filter and blocking. The rules on a
 * wide field (Chat with a real World), then over real WebSockets.
 */
import { describe, expect, it } from 'vitest';
import { LOCAL_REACH, TileMap, type MapData, type ServerMsg } from '@napoland/shared';
import { Chat, SAYS_PER_WINDOW, SAY_WINDOW_MS } from '../src/chat';
import type { PlayerRecord } from '../src/storage';
import { World, colorFor } from '../src/world';
import { fixtureMaps } from './fixtures';
import { setup, type Client } from './helpers';

/** A field 40 tiles wide, its way home at the left end of its bottom row. */
function field(): MapData {
  const W = 40;
  return {
    id: 'field', name: 'Field', version: 1, kind: 'wilds', depth: 1, width: W, height: 4,
    tiles: ['t'.repeat(W), `t${'g'.repeat(W - 2)}t`, `t${'g'.repeat(W - 2)}t`, `tg${'t'.repeat(W - 2)}`],
    levels: Array<string>(4).fill('0'.repeat(W)), spawn: { x: 1, y: 2, dir: 'up' },
    exits: [{ x: 1, y: 3, w: 1, h: 1, to: 'town', tx: 4, ty: 1, dir: 'down', home: true }], objects: [],
  };
}
const rec = (id: string, map: string, x: number, y: number, signedIn = true): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: null, authSub: signedIn ? `dev:${id}@example.test` : null, map, x, y, dir: 'up', color: colorFor(id), energy: 100, bag: [], createdAt: 1, lastSeenAt: 1,
});

/** The field again, where words do not carry (MapData.hush, the Quiet). */
const hushed = (): MapData => ({ ...field(), id: 'hushed', hush: true });

function chatWorld(...players: PlayerRecord[]) {
  const world = new World([new TileMap(field()), new TileMap(hushed()), ...fixtureMaps()], 'town', 'overcast');
  for (const p of players) world.join(p, 0);
  let now = 0;
  const heard: Array<{ to: string; msg: ServerMsg }> = [];
  const blocks = new Map<string, Set<string>>();
  const chat = new Chat({
    world, words: ['fuck', 'nigger'], clock: () => now,
    online: () => players.map(p => p.id), blocks: id => blocks.get(id) ?? new Set(), send: (to, msg) => heard.push({ to, msg }),
  });
  const hear = () => heard.splice(0);
  return { chat, blocks, hear, later: (ms: number) => { now += ms; } };
}

describe('who hears what', () => {
  it('local chat reaches whoever is near on the same map, the speaker too, with the bubble', () => {
    const { chat, hear } = chatWorld(rec('a', 'field', 2, 1), rec('b', 'field', 2 + LOCAL_REACH, 1), rec('c', 'field', 3 + LOCAL_REACH, 1), rec('d', 'town', 2, 1));
    chat.say('a', 'local', 'over here');
    // b stands right at the reach, c one tile past it, d on another map.
    expect(hear()).toEqual(['a', 'b'].map(to => ({ to, msg: { t: 'said', to: 'local', id: 'a', name: 'A', text: 'over here' } })));
  });

  it('world chat reaches everyone online, wherever they are', () => {
    const { chat, hear } = chatWorld(rec('a', 'field', 2, 1), rec('d', 'town', 2, 1));
    chat.say('a', 'world', 'anyone out there?');
    expect(hear().map(h => h.to)).toEqual(['a', 'd']);
  });

  it('is never said where words do not carry, nor heard there, near or far; everyone else hears as ever', () => {
    const { chat, hear } = chatWorld(rec('a', 'hushed', 2, 1), rec('b', 'hushed', 3, 1), rec('c', 'field', 2, 1), rec('d', 'town', 2, 1));
    chat.say('a', 'local', 'hello?');
    chat.say('a', 'world', 'can anyone hear me');
    expect(hear()).toEqual([1, 2].map(() => ({ to: 'a', msg: { t: 'refused', action: 'say', reason: 'hushed' } })));
    chat.say('c', 'world', 'over here');
    expect(hear().map(h => h.to)).toEqual(['c', 'd']);
  });

  it('never reaches someone who blocks the speaker', () => {
    const { chat, blocks, hear } = chatWorld(rec('a', 'field', 2, 1), rec('b', 'field', 3, 1));
    blocks.set('b', new Set(['a']));
    chat.say('a', 'world', 'hello');
    chat.say('b', 'world', 'hi');
    expect(hear().map(h => `${(h.msg as { id: string }).id}>${h.to}`)).toEqual(['a>a', 'b>a', 'b>b']);
  });
});

describe('what may be said', () => {
  it('only by signed-in players, and not too fast', () => {
    const { chat, hear, later } = chatWorld(rec('a', 'field', 2, 1), rec('g', 'field', 3, 1, false));
    chat.say('g', 'local', 'hi');
    expect(hear()).toEqual([{ to: 'g', msg: { t: 'refused', action: 'say', reason: 'sign_in_first' } }]);
    for (let i = 0; i < SAYS_PER_WINDOW; i++) chat.say('a', 'world', `${i}`);
    hear();
    chat.say('a', 'world', 'one more');
    expect(hear()).toEqual([{ to: 'a', msg: { t: 'refused', action: 'say', reason: 'slow_down' } }]);
    later(SAY_WINDOW_MS);
    chat.say('a', 'world', 'again');
    expect(hear()[0]!.msg).toMatchObject({ t: 'said', text: 'again' });
  });

  it('with words on the list masked, however they are spelled', () => {
    const { chat, hear } = chatWorld(rec('a', 'field', 2, 1));
    chat.say('a', 'world', 'what the FUUUCK, f*ck off, n1gger. Niger is a country.');
    expect((hear()[0]!.msg as { text: string }).text).toBe('what the ******, f*ck off, ******. Niger is a country.');
  });
});

describe('chat over the network', () => {
  const { enter } = setup();
  const said = (c: Client) => c.next('said');

  it('two signed-in players talk locally and to everyone; a guest may not; a block hides the blocked', async () => {
    const a = await enter({ authSub: 'dev:ana@example.test' });
    const b = await enter({ authSub: 'dev:bo@example.test' });
    const guest = await enter();
    a.c.send({ t: 'say', to: 'local', text: 'hi there' });
    expect(await said(b.c)).toEqual({ t: 'said', to: 'local', id: a.id, name: a.welcome.name, text: 'hi there' });
    expect((await said(a.c)).text).toBe('hi there');
    guest.c.send({ t: 'say', to: 'world', text: 'me too' });
    expect(await guest.c.next('refused')).toEqual({ t: 'refused', action: 'say', reason: 'sign_in_first' });
    b.c.send({ t: 'block', id: a.id, on: true });
    await b.c.next('friends', m => m.blocked.length === 1);
    a.c.send({ t: 'say', to: 'world', text: 'still there?' });
    // A guest hears (only talking takes signing in); whoever blocks the speaker does not.
    expect((await guest.c.next('said', m => m.text === 'still there?')).id).toBe(a.id);
    await b.c.settle();
    expect(b.c.inbox.filter(m => m.t === 'said')).toEqual([]);
  });
});
