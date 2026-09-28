/**
 * What the friends panel shows, from what the server told us: plain data, no drawing, so it can be
 * tested; hud.ts shows it. Private messages live here only for the session: the server forgets them
 * once they are read, so there is no history to load.
 */
import type { PersonView, ServerMsg } from '@napoland/shared';

export type FriendsMsg = Extract<ServerMsg, { t: 'friends' }>;

/** One line of a conversation. */
export interface TalkLine {
  mine: boolean;
  text: string;
}

/** Where someone stands with you, for the buttons on their card. */
export type Standing = 'friend' | 'asked' | 'asking' | 'blocked' | 'none';

export interface FriendsView {
  requestsOff: boolean;
  incoming: PersonView[];
  friends: Array<PersonView & { where: string; unread: boolean }>;
  outgoing: PersonView[];
  blocked: PersonView[];
  /** Someone's card: open from the list or from their name tag. `guest`: they play as a guest, so no friends yet (blocking and reporting still work). */
  person: (PersonView & { where: string | null; standing: Standing; lines: TalkLine[]; guest?: true }) | null;
}

/** "The Near Woods", "offline": where a friend is, by our copy of the map's name. */
export function whereText(map: string | null, nameOf: (id: string) => string | undefined): string {
  return map === null ? 'offline' : nameOf(map) ?? 'online';
}

export function standingOf(f: FriendsMsg | null, id: string): Standing {
  if (!f) return 'none';
  if (f.blocked.some(p => p.id === id)) return 'blocked';
  if (f.friends.some(p => p.id === id)) return 'friend';
  if (f.incoming.some(p => p.id === id)) return 'asking';
  if (f.outgoing.some(p => p.id === id)) return 'asked';
  return 'none';
}

/** `s.guests`: who plays as a guest, among the players the game knows of. */
export function friendsView(
  f: FriendsMsg | null,
  s: { person: PersonView | null; talks: ReadonlyMap<string, readonly TalkLine[]>; unread: ReadonlySet<string>; guests?: ReadonlySet<string> },
  nameOf: (map: string) => string | undefined,
): FriendsView {
  const friends = (f?.friends ?? [])
    .map(p => ({ id: p.id, name: p.name, where: whereText(p.map, nameOf), unread: s.unread.has(p.id), online: p.map !== null }))
    // Unread first, then who is online, then by name.
    .sort((a, b) => Number(b.unread) - Number(a.unread) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
    .map(({ online: _online, ...p }) => p);
  const p = s.person;
  const friend = p && f?.friends.find(x => x.id === p.id);
  return {
    requestsOff: f?.requestsOff ?? false,
    incoming: f?.incoming ?? [],
    friends,
    outgoing: f?.outgoing ?? [],
    blocked: f?.blocked ?? [],
    person: p && {
      id: p.id, name: p.name, where: friend ? whereText(friend.map, nameOf) : null, standing: standingOf(f, p.id), lines: [...(s.talks.get(p.id) ?? [])],
      ...(s.guests?.has(p.id) && { guest: true as const }),
    },
  };
}

/** What someone wrote you last, for a report's quote (the server keeps no messages once read). */
export function lastFrom(lines: readonly TalkLine[] | undefined): string | undefined {
  return lines && [...lines].reverse().find(l => !l.mine)?.text;
}
