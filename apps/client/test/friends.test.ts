import { beforeEach, describe, expect, it } from 'vitest';
import type { ClientMsg } from '@napoland/shared';
import { friendsView, lastFrom, standingOf, whereText, type FriendsMsg } from '../src/friends';
import { Game } from '../src/game';
import { Items } from '../src/items';
import { Maps } from '../src/maps';
import { itemsData, tinyTown, welcome } from './fixtures';

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333';
const list: FriendsMsg = {
  t: 'friends',
  friends: [{ id: A, name: 'Aldo', map: null }, { id: B, name: 'Bea', map: 'woods' }],
  incoming: [{ id: C, name: 'Cleo' }], outgoing: [], blocked: [], requestsOff: false, tradesOff: false,
};
const names = (id: string) => ({ woods: 'The Woods' })[id];

describe('the friends panel', () => {
  it('lists friends with unread first, then who is online, and says where they are', () => {
    const v = friendsView(list, { person: null, talks: new Map(), unread: new Set() }, names);
    expect(v.friends).toEqual([{ id: B, name: 'Bea', where: 'The Woods', unread: false }, { id: A, name: 'Aldo', where: 'offline', unread: false }]);
    expect(friendsView(list, { person: null, talks: new Map(), unread: new Set([A]) }, names).friends[0]).toMatchObject({ id: A, unread: true });
    expect(v.incoming).toEqual([{ id: C, name: 'Cleo' }]);
    expect(whereText('elsewhere', names)).toBe('online');
  });

  it('opens a card with where someone stands, and the conversation of this session', () => {
    const talks = new Map([[B, [{ mine: true, text: 'hi' }, { mine: false, text: 'hey there' }]]]);
    const v = friendsView(list, { person: { id: B, name: 'Bea' }, talks, unread: new Set() }, names);
    // A friend's card says how near they are to trade with (told nothing, they are not here).
    expect(v.person).toEqual({ id: B, name: 'Bea', where: 'The Woods', standing: 'friend', lines: talks.get(B), trade: 'away' });
    expect(friendsView(list, { person: { id: B, name: 'Bea' }, talks, unread: new Set(), tradeReach: () => 'near' }, names).person?.trade).toBe('near');
    // Nobody but a friend is asked to trade.
    expect(friendsView(list, { person: { id: C, name: 'Cleo' }, talks, unread: new Set(), tradeReach: () => 'near' }, names).person?.trade).toBeUndefined();
    expect(friendsView({ ...list, tradesOff: true }, { person: null, talks, unread: new Set() }, names).tradesOff).toBe(true);
    expect(standingOf(list, C)).toBe('asking');
    expect(standingOf({ ...list, blocked: [{ id: C, name: 'Cleo' }] }, C)).toBe('blocked');
    expect(standingOf(list, 'nobody')).toBe('none');
    expect(lastFrom(talks.get(B))).toBe('hey there');
    expect(lastFrom(undefined)).toBeUndefined();
  });
});

describe('the game and friends', () => {
  let sent: ClientMsg[];
  let g: Game;
  beforeEach(() => {
    sent = [];
    g = new Game(new Maps([tinyTown()]), m => sent.push(m), new Items(itemsData()));
    g.handle(welcome(tinyTown(), []), 0);
  });

  it('keeps messages for the session, and reads them only when their card is open', () => {
    g.handle({ t: 'tells', tells: [{ from: A, name: 'Aldo', text: 'where are you?', at: 1 }] }, 0);
    expect(g.unread.has(A)).toBe(true);
    expect(g.socialNews).toBe(true);
    expect(sent).toEqual([]);
    g.openPerson({ id: A, name: 'Aldo' });
    expect(sent).toEqual([{ t: 'read', from: A }]);
    expect(g.socialNews).toBe(false);
    g.tell(A, '  at the pond ');
    g.handle({ t: 'tells', tells: [{ from: A, name: 'Aldo', text: 'coming', at: 2 }] }, 0);
    expect(g.talks.get(A)).toEqual([{ mine: false, text: 'where are you?' }, { mine: true, text: 'at the pond' }, { mine: false, text: 'coming' }]);
    expect(sent.slice(1)).toEqual([{ t: 'tell', to: A, text: 'at the pond' }, { t: 'read', from: A }]);
  });

  it('shows a request as news, and a refusal in the panel', () => {
    g.handle(list, 0);
    expect(g.socialNews).toBe(true);
    g.befriend({ name: 'Nobody' });
    g.handle({ t: 'refused', action: 'befriend', reason: 'unknown_player' }, 0);
    expect(g.socialNote).toBe('Nobody by that name');
  });
});
