/**
 * The connection (net.ts), with a stand-in WebSocket, and what the game does with it: a connection
 * stopped on purpose (a guest leaving the world to sign in, a hello the server refused) tells the game
 * it is offline at once, as one that dropped does, and a welcome for another character on the same map
 * (the account's own after its guest) leaves nothing of the first one open.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientMsg, MapData, PlayerView } from '@napoland/shared';
import { Game } from '../src/game';
import { Items } from '../src/items';
import { Maps } from '../src/maps';
import { Connection } from '../src/net';
import { FULL, itemsData, welcome } from './fixtures';

/** A WebSocket that opens at once and closes when asked, like a browser's (its onclose comes after close()). */
class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket | null = null;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
    queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
  }
  send() {}
  close() {
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.());
  }
}

const g = globalThis as { WebSocket?: unknown };
let before: unknown;
beforeEach(() => { before = g.WebSocket; g.WebSocket = FakeSocket; });
afterEach(() => { g.WebSocket = before; });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('a connection stopped on purpose', () => {
  it('tells the game it is closed, once, as a dropped one does', async () => {
    const conn = new Connection('ws://test/ws', () => ({ t: 'hello', v: 1, name: 'Aldo' }) as ClientMsg);
    let closed = 0, opened = 0;
    conn.onOpen = () => opened++;
    conn.onClose = () => closed++;
    conn.start();
    await tick();
    expect(opened).toBe(1);
    conn.stop();
    await tick();
    expect(FakeSocket.last?.readyState).toBe(3);
    expect(closed).toBe(1);
    // Stopped already, nothing more.
    conn.stop();
    await tick();
    expect(closed).toBe(1);
  });
});

describe('a welcome for another character on the same map', () => {
  /** A home room with the chest at 5,1 and the workbench at 6,1, as stonebrook-home has them. */
  const home: MapData = {
    id: 'home', name: 'Home', version: 1, kind: 'inside', depth: 0, width: 9, height: 7,
    tiles: ['xxxxxxxxx', 'xpppppppx', 'xpppppppx', 'xpppppppx', 'xpppppppx', 'xpppppppx', 'xxxxpxxxx'],
    levels: Array<string>(7).fill('000000000'), spawn: { x: 4, y: 5, dir: 'up' },
    exits: [{ x: 4, y: 6, w: 1, h: 1, to: 'home', tx: 4, ty: 5, dir: 'down' }],
    objects: [{ kind: 'chest', x: 5, y: 1 }, { kind: 'workbench', x: 6, y: 1 }],
  };

  it('closes the chest the guest had open, with the guest\'s stash in it', () => {
    const sent: ClientMsg[] = [];
    const game = new Game(new Maps([home]), m => sent.push(m), new Items(itemsData()));
    const guest: PlayerView = { id: 'guest', name: 'Wren', x: 5, y: 2, dir: 'up', color: '#f29e4c', gear: {}, quirks: [] };
    game.handle({ ...welcome(home, [guest], FULL, { stash: [{ item: 'glowcap', count: 5 }] }), you: 'guest', guest: true }, 0);
    game.pressA();
    expect(sent.at(-1)).toEqual({ t: 'chest', x: 5, y: 1 });
    game.handle({ t: 'chest', stash: [{ item: 'glowcap', count: 5 }] }, 10);
    expect(game.chest).not.toBeNull();
    // Signed in, the account's own character comes in, elsewhere in the same room.
    const account: PlayerView = { ...guest, id: 'acct', name: 'Bea', x: 2, y: 4 };
    game.handle({ ...welcome(home, [account], FULL, { stash: [{ item: 'shard', count: 1 }] }), you: 'acct' }, 5000);
    expect(game.meId).toBe('acct');
    expect(game.stash).toEqual([{ item: 'shard', count: 1 }]);
    expect(game.chest).toBeNull();
    expect(game.bench).toBeNull();
    // The same character welcomed again (a reconnect) keeps what it had open.
    game.pressA();
    const again: PlayerView = { ...account, x: 5, y: 2 };
    game.handle({ ...welcome(home, [again], FULL, { stash: [{ item: 'shard', count: 1 }] }), you: 'acct' }, 6000);
    game.pressA();
    game.handle({ t: 'chest', stash: [{ item: 'shard', count: 1 }] }, 6010);
    expect(game.chest).not.toBeNull();
    game.handle({ ...welcome(home, [again], FULL, { stash: [{ item: 'shard', count: 1 }] }), you: 'acct' }, 7000);
    expect(game.chest).not.toBeNull();
  });
});
