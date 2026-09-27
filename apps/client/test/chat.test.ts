import { beforeEach, describe, expect, it } from 'vitest';
import { BUBBLE_S, type ClientMsg } from '@napoland/shared';
import { CHAT_LOG, Game } from '../src/game';
import { Items } from '../src/items';
import { Maps } from '../src/maps';
import { itemsData, tinyTown, welcome } from './fixtures';

describe('chat in the game', () => {
  let sent: ClientMsg[];
  let g: Game;
  beforeEach(() => {
    sent = [];
    g = new Game(new Maps([tinyTown()]), m => sent.push(m), new Items(itemsData()));
    g.handle(welcome(tinyTown(), []), 0);
  });

  it('says what you type, and keeps what it hears for the session, local lines with a bubble', () => {
    g.say('local', '  hello  ');
    expect(sent).toEqual([{ t: 'say', to: 'local', text: 'hello' }]);
    g.handle({ t: 'said', to: 'local', id: 'b', name: 'Bea', text: 'hi!' }, 1000);
    g.handle({ t: 'said', to: 'world', id: 'c', name: 'Cid', text: 'storm coming' }, 1000);
    expect(g.chat).toEqual([{ to: 'local', id: 'b', name: 'Bea', text: 'hi!', mine: false }, { to: 'world', id: 'c', name: 'Cid', text: 'storm coming', mine: false }]);
    expect(g.chatNews).toBe(true);
    expect(g.bubblesNow(1000 + BUBBLE_S * 1000 - 1)).toEqual([{ id: 'b', text: 'hi!' }]);
    expect(g.bubblesNow(1000 + BUBBLE_S * 1000)).toEqual([]);
  });

  it('keeps only the last lines, and says why something did not go out', () => {
    for (let i = 0; i < CHAT_LOG + 5; i++) g.handle({ t: 'said', to: 'world', id: 'c', name: 'Cid', text: `${i}` }, 0);
    expect(g.chat).toHaveLength(CHAT_LOG);
    expect(g.chat[0]!.text).toBe('5');
    g.handle({ t: 'refused', action: 'say', reason: 'sign_in_first' }, 0);
    expect(g.chatNote).toBe('Sign in to talk');
  });
});
