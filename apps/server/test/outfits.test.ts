/**
 * Outfits: what a player may wear over their gear (signed in, the level reached), changed at the chest
 * at home, seen by everyone on the map and kept with the player. World rules only; over WebSockets in
 * net-outfits.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { TileMap, xpFor, type Dir, type ItemsData, type ServerMsg } from '@napoland/shared';
import type { PlayerRecord } from '../src/storage';
import { World, colorFor, type Outgoing } from '../src/world';
import { fixtureMaps, houseData } from './fixtures';

/** The fixture house with a chest at 3,1: stand at 3,2 facing up to reach it. */
const withChest = () => {
  const h = houseData();
  return new TileMap({ ...h, objects: [...h.objects, { kind: 'chest', x: 3, y: 1 }] });
};

const ITEMS: ItemsData = { version: 1, items: [{ id: 'moss', name: 'Moss', kind: 'resource', stack: 10, text: 'Soft.', xp: 2 }], finds: [] };

/** Signed in (a dev identity) unless `authSub` says otherwise; at `level`, from its XP. */
const rec = (id: string, x: number, y: number, level = 1, more: Partial<PlayerRecord> = {}, dir: Dir = 'up'): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: null, authSub: `dev:${id}@example.test`, map: 'house', x, y, dir, color: colorFor(id), energy: 50, bag: [], xp: xpFor(level),
  createdAt: 1, lastSeenAt: 1, ...more,
});

function world(options: { guests?: boolean; xpTimes?: number } = {}, ...players: PlayerRecord[]): World {
  const maps = [...fixtureMaps().filter(m => m.data.id !== 'house'), withChest()];
  const w = new World(maps, 'town', 'overcast', { items: ITEMS, rng: () => 0, guests: options.guests ?? true, xpTimes: options.xpTimes });
  for (const p of players) w.join(p, 0);
  w.drain();
  w.takeWrites();
  return w;
}
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id ? [o.msg] : []));
const onMap = (out: Outgoing[], map: string) => out.flatMap(o => ('map' in o && o.map === map ? [o.msg] : []));
const of = <T extends ServerMsg['t']>(msgs: ServerMsg[], t: T) => msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);

describe('wearing an outfit', () => {
  it('puts one on at the chest: everyone on the map sees it, and it is saved at once', () => {
    const w = world({}, rec('a', 3, 2), rec('b', 1, 3));
    w.outfit('a', 3, 1, 'napo-suit', 1000);
    const out = w.drain();
    expect(onMap(out, 'house')).toEqual([{ t: 'outfit', id: 'a', outfit: 'napo-suit' }]);
    expect(w.get('a')!.outfit).toBe('napo-suit');
    expect(w.views('house').find(p => p.id === 'a')!.outfit).toBe('napo-suit');
    expect(w.takeWrites().players.map(p => [p.id, p.outfit])).toEqual([['a', 'napo-suit']]);
  });

  it('changes nothing else: not the gear, the bar, the bag or the stash', () => {
    const w = world({}, rec('a', 3, 2, 5, { bag: [{ item: 'moss', count: 3 }], stash: { items: { moss: 2 }, out: {} } }));
    const before = w.get('a')!;
    w.outfit('a', 3, 1, 'lineman-jacket', 1000);
    const out = w.drain();
    expect(to(out, 'a').map(m => m.t)).toEqual([]);
    const after = w.get('a')!;
    expect({ ...after, outfit: undefined }).toEqual({ ...before, outfit: undefined });
  });

  it('takes it off again (none): the gear shows, and it is saved', () => {
    const w = world({}, rec('a', 3, 2, 1, { outfit: 'napo-suit' }));
    w.outfit('a', 3, 1, null, 1000);
    expect(onMap(w.drain(), 'house')).toEqual([{ t: 'outfit', id: 'a', outfit: null }]);
    expect(w.get('a')!.outfit).toBeUndefined();
    expect(w.views('house')[0]!.outfit).toBeUndefined();
    expect(w.takeWrites().players.map(p => p.outfit)).toEqual([undefined]);
  });

  it('says nothing when it changes nothing', () => {
    const w = world({}, rec('a', 3, 2, 1, { outfit: 'napo-suit' }), rec('b', 3, 2));
    w.outfit('a', 3, 1, 'napo-suit', 1000);
    w.outfit('b', 3, 1, null, 1000);
    expect(w.drain()).toEqual([]);
    expect(w.takeWrites().players).toEqual([]);
  });

  it('opens each outfit at its level, and refuses one the level has not reached', () => {
    const w = world({}, rec('a', 3, 2, 14));
    for (const o of ['napo-suit', 'lineman-jacket', 'rain-cape', 'ranger-coat', 'patchwork']) w.outfit('a', 3, 1, o, 1000);
    const out = w.drain();
    expect(onMap(out, 'house').map(m => m.t === 'outfit' && m.outfit)).toEqual(['napo-suit', 'lineman-jacket', 'rain-cape']);
    expect(of(to(out, 'a'), 'refused')).toEqual([
      { t: 'refused', action: 'outfit', reason: 'locked' },
      { t: 'refused', action: 'outfit', reason: 'locked' },
    ]);
    expect(w.get('a')!.outfit).toBe('rain-cape');
  });

  it('refuses a guest (sign in first), anyone away from the chest, and an outfit that does not exist', () => {
    const w = world({}, rec('g', 3, 2, 20, { authSub: null, tokenHash: 'hash-g' }), rec('far', 1, 3, 20), rec('a', 3, 2, 20));
    w.outfit('g', 3, 1, 'napo-suit', 1000);
    w.outfit('g', 3, 1, null, 1000);
    w.outfit('far', 3, 1, 'napo-suit', 1000);
    w.outfit('a', 3, 1, 'top-hat', 1000);
    w.outfit('a', 3, 3, 'napo-suit', 1000);
    const out = w.drain();
    expect(onMap(out, 'house')).toEqual([]);
    expect(of(to(out, 'g'), 'refused').map(r => r.reason)).toEqual(['sign_in_first', 'sign_in_first']);
    expect(of(to(out, 'far'), 'refused').map(r => r.reason)).toEqual(['too_far']);
    expect(of(to(out, 'a'), 'refused').map(r => r.reason)).toEqual(['gone', 'too_far']);
  });

  it('lets anyone wear them on a server without sign-in, where nobody is a guest', () => {
    const w = world({ guests: false }, rec('a', 3, 2, 5, { authSub: null, tokenHash: 'hash-a' }));
    w.outfit('a', 3, 1, 'lineman-jacket', 1000);
    expect(onMap(w.drain(), 'house')).toEqual([{ t: 'outfit', id: 'a', outfit: 'lineman-jacket' }]);
  });
});

describe('an outfit as others see it', () => {
  it('comes with the player: the map hears it in the join, and a newcomer in the welcome', () => {
    const w = world({}, rec('b', 1, 3));
    const joined = w.join(rec('a', 3, 2, 10, { outfit: 'rain-cape' }), 1000);
    expect(joined.player.outfit).toBe('rain-cape');
    expect(onMap(w.drain(), 'house')).toContainEqual({ t: 'join', player: expect.objectContaining({ id: 'a', outfit: 'rain-cape' }) });
    const later = w.join(rec('c', 2, 2), 1000);
    expect(later.players.find(p => p.id === 'a')!.outfit).toBe('rain-cape');
    expect(later.players.find(p => p.id === 'b')!.outfit).toBeUndefined();
  });

  it('is none for a saved outfit the player may not wear: a guest, a level below it, or one that no longer exists', () => {
    const w = world();
    expect(w.join(rec('g', 3, 2, 20, { authSub: null, tokenHash: 'hash-g', outfit: 'napo-suit' }), 0).player.outfit).toBeUndefined();
    expect(w.join(rec('low', 3, 2, 9, { outfit: 'rain-cape' }), 0).player.outfit).toBeUndefined();
    expect(w.join(rec('gone', 3, 2, 20, { outfit: 'top-hat' }), 0).player.outfit).toBeUndefined();
    expect(w.get('low')!.outfit).toBeUndefined();
    expect(w.join(rec('ok', 3, 2, 20, { outfit: 'patchwork' }), 0).player.outfit).toBe('patchwork');
  });

  it('follows the player to another map: the map they walk into sees it', () => {
    const w = world({}, rec('a', 2, 3, 1, { outfit: 'napo-suit' }, 'down'), rec('t', 7, 4, 1, { map: 'town' }));
    w.step('a', 'down', 1, 1000);
    const out = w.drain();
    expect(onMap(out, 'town')).toContainEqual({ t: 'join', player: expect.objectContaining({ id: 'a', outfit: 'napo-suit' }) });
  });
});

describe('the XP multiplier of play-tests', () => {
  it('multiplies what stashing earns, and nothing else', () => {
    const w = world({ xpTimes: 1000 }, rec('a', 3, 2, 1, { bag: [{ item: 'moss', count: 1 }] }));
    w.store('a', 3, 1, 0, 1000);
    expect(of(to(w.drain(), 'a'), 'progress')).toEqual([{ t: 'progress', progress: expect.objectContaining({ xp: 2000, level: 9 }), gained: 2000 }]);
  });
});
