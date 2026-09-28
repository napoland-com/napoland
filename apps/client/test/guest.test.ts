/**
 * Playing as a guest, without a page: what the Status tab tells a guest, how a guest's card reads to
 * others, and what the game keeps about who plays as a guest and why the server said no.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { GUEST_DAYS, type ClientMsg, type PlayerView } from '@napoland/shared';
import { friendsView, type FriendsMsg } from '../src/friends';
import { Game } from '../src/game';
import { CHAT_GATE, FRIENDS_GATE } from '../src/hud';
import { Items, refusalText } from '../src/items';
import { Maps } from '../src/maps';
import { GUEST_NOTE, statusView } from '../src/status';
import { ASLEEP, DRY, START, itemsData, tinyTown, welcome } from './fixtures';

const items = new Items(itemsData());
const G = '44444444-4444-4444-8444-444444444444', S = '55555555-5555-4555-8555-555555555555';
const player = (id: string, guest = false): PlayerView => ({ id, name: id === G ? 'Wren' : 'Sam', x: 2, y: 2, dir: 'down', color: '#fff', gear: {}, quirks: [], ...(guest && { guest: true as const }) });

describe('the Status tab of a guest', () => {
  const status = (guest: boolean) => statusView({
    energy: null, body: DRY, surge: null, caught: false, stone: ASLEEP, stats: {}, bag: [], items, progress: START,
    resists: null, wear: null, quirks: [], storm: null, flash: null, weather: 'rain', wilds: false, guest,
  });

  it('starts with one plain paragraph: where the progress lives, how long a guest who stays away is kept, and what keeps it', () => {
    expect(status(true).guest).toBe(GUEST_NOTE);
    expect(GUEST_NOTE).toContain('lives in this browser');
    expect(GUEST_NOTE).toContain(`stays away for ${GUEST_DAYS} days is deleted`);
    expect(GUEST_NOTE).toContain('Signing in keeps everything.');
    expect(status(false).guest).toBeUndefined();
  });

  it('shows chat and friends to a guest as what signing in opens', () => {
    expect(CHAT_GATE).toBe('Sign in to chat with other players. Signing in keeps your character.');
    expect(FRIENDS_GATE).toMatch(/^Sign in to make friends.*Signing in keeps your character\.$/);
  });
});

describe('a guest as others see them, and the game of a guest', () => {
  let sent: ClientMsg[];
  let g: Game;
  beforeEach(() => {
    sent = [];
    g = new Game(new Maps([tinyTown()]), m => sent.push(m), items);
  });

  it('knows who on the map plays as a guest, from the welcome and as they come, and a card says so', () => {
    g.handle(welcome(tinyTown(), [player(S), player(G, true)]), 0);
    expect(g.guest).toBe(false);
    expect([...g.guests]).toEqual([G]);
    const none: FriendsMsg = { t: 'friends', friends: [], incoming: [], outgoing: [], blocked: [], requestsOff: false };
    g.openPerson({ id: G, name: 'Wren' });
    expect(friendsView(none, g, () => undefined).person).toMatchObject({ id: G, standing: 'none', guest: true });
    g.openPerson({ id: S, name: 'Sam' });
    expect(friendsView(none, g, () => undefined).person!.guest).toBeUndefined();
    // Wren signed in: back in as someone who is not a guest.
    g.handle({ t: 'join', player: player(G) }, 0);
    expect(g.guests.has(G)).toBe(false);
  });

  it('plays as a guest when the welcome says so, and says why the server refused what needs sign-in', () => {
    g.handle({ ...welcome(tinyTown(), [player(G, true)]), you: G, guest: true }, 0);
    expect(g.guest).toBe(true);
    g.handle({ t: 'refused', action: 'say', reason: 'sign_in_first' }, 0);
    expect(g.chatNote).toBe('Sign in to talk');
    for (const action of ['befriend', 'answer', 'unfriend', 'tell', 'read', 'block', 'report', 'requests', 'friends'] as const) {
      g.socialNote = null;
      g.handle({ t: 'refused', action, reason: 'sign_in_first' }, 0);
      expect(g.socialNote, action).toBe('Sign in to make friends');
    }
    expect(g.floats).toEqual([]);
  });

  it('says plainly why nobody can ask a guest to be friends yet', () => {
    g.handle(welcome(tinyTown(), [player(S)]), 0);
    g.befriend({ name: 'Wren' });
    g.handle({ t: 'refused', action: 'befriend', reason: 'guest' }, 0);
    expect(g.socialNote).toBe(refusalText('guest'));
    expect(refusalText('guest')).toMatch(/guest.*sign in.*friends/);
  });
});
