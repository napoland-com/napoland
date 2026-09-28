/**
 * Merits, past level 20: what stashing earns there buys looks at the chest (a jacket pattern, a name tag
 * badge), each once, and one of each is worn at a time, seen by everyone on the map and kept with the
 * player. World rules only; over WebSockets in net-merits.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { MERITS_FROM, MERIT_XP, TileMap, type Dir, type ItemsData, type ServerMsg } from '@napoland/shared';
import type { PlayerRecord } from '../src/storage';
import { World, colorFor, zoneKey, type Outgoing } from '../src/world';
import { fixtureMaps, houseData } from './fixtures';

/** The fixture house with a chest at 3,1: stand at 3,2 facing up to reach it. */
const withChest = () => {
  const h = houseData();
  return new TileMap({ ...h, objects: [...h.objects, { kind: 'chest', x: 3, y: 1 }] });
};
/**
 * The same house made a home of one's own, as the real one is (cabin.test.ts): whoever is in it is alone
 * in a copy of their own. Its way out at 2,4 leads onto the town's 7,3.
 */
const cabin = () => new TileMap({ ...withChest().data, private: true, wake: { x: 2, y: 2, dir: 'down' } });
const ITEMS: ItemsData = { version: 1, items: [{ id: 'shard', name: 'Shard', kind: 'resource', stack: 5, text: 'Warm.', xp: 12 }], finds: [] };
/** XP worth `n` merits, and a little more toward the next. */
const worth = (n: number) => MERITS_FROM + n * MERIT_XP + 100;

/** Signed in (a dev identity) unless `authSub` says otherwise; with the XP of `merits` merits. */
const rec = (id: string, x: number, y: number, merits = 0, more: Partial<PlayerRecord> = {}, dir: Dir = 'up'): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: null, authSub: `dev:${id}@example.test`, map: 'house', x, y, dir, color: colorFor(id), energy: 50, bag: [], xp: worth(merits),
  createdAt: 1, lastSeenAt: 1, ...more,
});

function world(...players: PlayerRecord[]): World {
  const maps = [...fixtureMaps().filter(m => m.data.id !== 'house'), withChest()];
  const w = new World(maps, 'town', 'overcast', { items: ITEMS, rng: () => 0, guests: true });
  for (const p of players) w.join(p, 0);
  w.drain();
  w.takeWrites();
  return w;
}
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id ? [o.msg] : []));
const onMap = (out: Outgoing[], map: string) => out.flatMap(o => ('map' in o && o.map === map ? [o.msg] : []));
const of = <T extends ServerMsg['t']>(msgs: ServerMsg[], t: T) => msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);

describe('buying a look', () => {
  it('spends a merit at the chest: the look is theirs for good, they hear their merits and what it did, and it is saved at once', () => {
    const w = world(rec('a', 3, 2, 3));
    w.buy('a', 3, 1, 'chevron', 1000);
    expect(to(w.drain(), 'a')).toEqual([
      { t: 'merits', merits: { spent: 1, owned: ['chevron'] } },
      { t: 'did', did: { kind: 'bought', look: 'chevron', left: 2 } },
    ]);
    expect(w.get('a')).toMatchObject({ meritsSpent: 1, looks: ['chevron'] });
    expect(w.takeWrites().players.map(p => [p.meritsSpent, p.looks])).toEqual([[1, ['chevron']]]);
    // A badge from the same merits, and the XP is as it was: merits are never taken out of it.
    w.buy('a', 3, 1, 'fir', 1100);
    expect(of(to(w.drain(), 'a'), 'did')).toEqual([{ t: 'did', did: { kind: 'bought', look: 'fir', left: 1 } }]);
    expect(w.get('a')).toMatchObject({ xp: worth(3), meritsSpent: 2, looks: ['chevron', 'fir'] });
  });

  it('changes nothing else, and nobody else hears it', () => {
    const w = world(rec('a', 3, 2, 1), rec('b', 1, 3));
    w.buy('a', 3, 1, 'stripes', 1000);
    const out = w.drain();
    expect(onMap(out, 'house')).toEqual([]);
    expect(to(out, 'b')).toEqual([]);
    expect(w.get('a')!.pattern).toBeUndefined();
  });

  it('refuses without a merit to spend, below level 20 or with all of them spent', () => {
    const w = world(rec('low', 3, 2, 0, { xp: 9000 }), rec('none', 3, 2, 0), rec('spent', 3, 2, 2, { meritsSpent: 2, looks: ['fir', 'moth'] }));
    for (const id of ['low', 'none', 'spent']) w.buy(id, 3, 1, 'lamp', 1000);
    const out = w.drain();
    for (const id of ['low', 'none', 'spent']) expect(to(out, id), id).toEqual([{ t: 'refused', action: 'buy', reason: 'no_merits' }]);
    expect(w.takeWrites().players).toEqual([]);
  });

  it('refuses the same look twice, one the game does not have, from away from the chest, and a guest', () => {
    const w = world(rec('a', 3, 2, 5, { meritsSpent: 1, looks: ['shard'] }), rec('far', 1, 3, 5), rec('g', 3, 2, 5, { authSub: null, tokenHash: 'hash-g' }));
    w.buy('a', 3, 1, 'shard', 1000);
    w.buy('a', 3, 1, 'top-hat', 1000);
    w.buy('far', 3, 1, 'shard', 1000);
    w.buy('g', 3, 1, 'shard', 1000);
    const out = w.drain();
    expect(to(out, 'a')).toEqual([{ t: 'refused', action: 'buy', reason: 'owned' }, { t: 'refused', action: 'buy', reason: 'gone' }]);
    expect(to(out, 'far')).toEqual([{ t: 'refused', action: 'buy', reason: 'too_far' }]);
    expect(to(out, 'g')).toEqual([{ t: 'refused', action: 'buy', reason: 'sign_in_first' }]);
    expect(w.get('a')).toMatchObject({ meritsSpent: 1, looks: ['shard'] });
  });

  it('lets a guest earn merits, to spend once signed in: on a server without sign-in, nobody is a guest', () => {
    const maps = [...fixtureMaps().filter(m => m.data.id !== 'house'), withChest()];
    const w = new World(maps, 'town', 'overcast', { items: ITEMS, rng: () => 0 });
    w.join(rec('a', 3, 2, 1, { authSub: null, tokenHash: 'hash-a' }), 0);
    w.drain();
    w.buy('a', 3, 1, 'moth', 1000);
    expect(of(to(w.drain(), 'a'), 'did')).toEqual([{ t: 'did', did: { kind: 'bought', look: 'moth', left: 0 } }]);
  });
});

describe('wearing a look', () => {
  it('puts a pattern and a badge on at the chest, one of each: everyone on the map sees it, newcomers too, and it is saved at once', () => {
    const w = world(rec('a', 3, 2, 3, { meritsSpent: 3, looks: ['chevron', 'checks', 'lamp'] }), rec('b', 1, 3));
    w.pattern('a', 3, 1, 'chevron', 1000);
    w.badge('a', 3, 1, 'lamp', 1000);
    expect(onMap(w.drain(), 'house')).toEqual([{ t: 'pattern', id: 'a', pattern: 'chevron' }, { t: 'badge', id: 'a', badge: 'lamp' }]);
    expect(w.views('house').find(p => p.id === 'a')).toMatchObject({ pattern: 'chevron', badge: 'lamp' });
    expect(w.takeWrites().players.map(p => [p.pattern, p.badge])).toEqual([['chevron', 'lamp']]);
    // Another pattern takes its place; taken off, it is none (null: a save without one would keep it).
    w.pattern('a', 3, 1, 'checks', 1100);
    w.badge('a', 3, 1, null, 1100);
    expect(onMap(w.drain(), 'house')).toEqual([{ t: 'pattern', id: 'a', pattern: 'checks' }, { t: 'badge', id: 'a', badge: null }]);
    expect(w.get('a')).toMatchObject({ pattern: 'checks', badge: null });
    expect(w.views('house').find(p => p.id === 'a')!.badge).toBeUndefined();
  });

  it('at the chest in their own cabin is theirs alone to see, until they walk out into town, where everyone sees it', () => {
    const w = new World([...fixtureMaps().filter(m => m.data.id !== 'house'), cabin()], 'town', 'overcast', { items: ITEMS, rng: () => 0, guests: true });
    for (const r of [rec('a', 3, 2, 2, { zone: 'a' }), rec('b', 3, 2, 0, { zone: 'b' }), rec('t', 0, 5, 0, { map: 'town' })]) w.join(r, 0);
    expect(w.zoneOf('a')).toBe(zoneKey('house', 'a'));
    w.drain();
    w.buy('a', 3, 1, 'chevron', 1000);
    w.buy('a', 3, 1, 'lamp', 1000);
    w.pattern('a', 3, 1, 'chevron', 1000);
    w.badge('a', 3, 1, 'lamp', 1000);
    const out = w.drain();
    expect(onMap(out, zoneKey('house', 'a'))).toEqual([{ t: 'pattern', id: 'a', pattern: 'chevron' }, { t: 'badge', id: 'a', badge: 'lamp' }]);
    expect([...onMap(out, 'town'), ...onMap(out, zoneKey('house', 'b')), ...to(out, 'b'), ...to(out, 't')]).toEqual([]);
    // Out: from 3,2 to the way out at 2,4, and into the town everyone shares.
    (['left', 'down', 'down'] as const).forEach((dir, i) => w.step('a', dir, i + 1, 1200 + i * 200));
    const joined = w.drain().find(o => 'map' in o && o.map === 'town' && o.msg.t === 'join');
    expect(joined?.msg).toMatchObject({ t: 'join', player: { id: 'a', pattern: 'chevron', badge: 'lamp' } });
    expect(w.views('town').find(p => p.id === 'a')).toMatchObject({ pattern: 'chevron', badge: 'lamp' });
  });

  it('says nothing when it changes nothing, and refuses one not theirs, the wrong kind, one the game does not have, from away, and a guest', () => {
    const w = world(rec('a', 3, 2, 2, { meritsSpent: 1, looks: ['fir'], badge: 'fir' }), rec('far', 1, 3, 1, { meritsSpent: 1, looks: ['fir'] }), rec('g', 3, 2, 0, { authSub: null, tokenHash: 'hash-g' }));
    w.badge('a', 3, 1, 'fir', 1000);
    w.pattern('a', 3, 1, null, 1000);
    expect(w.drain()).toEqual([]);
    w.pattern('a', 3, 1, 'stripes', 1000);
    w.pattern('a', 3, 1, 'fir', 1000);
    w.badge('a', 3, 1, 'crown', 1000);
    w.badge('far', 3, 1, 'fir', 1000);
    w.badge('g', 3, 1, null, 1000);
    const out = w.drain();
    expect(to(out, 'a').map(m => m.t === 'refused' && m.reason)).toEqual(['not_owned', 'gone', 'gone']);
    expect(to(out, 'far')).toEqual([{ t: 'refused', action: 'badge', reason: 'too_far' }]);
    expect(to(out, 'g')).toEqual([{ t: 'refused', action: 'badge', reason: 'sign_in_first' }]);
  });

  it('shows on joining only one of theirs this release has, and keeps the rest saved: merits spent, looks bought, a newer one worn', () => {
    const w = world(
      rec('a', 3, 2, 2, { meritsSpent: 2, looks: ['stripes', 'halo'], pattern: 'halo', badge: 'fir' }),
      rec('b', 3, 2, 0, { meritsSpent: -3 as never, looks: 'lots' as never, pattern: 'stripes' }),
    );
    const a = w.get('a')!, b = w.get('b')!;
    // A newer release's look stays theirs and saved; not bought, the badge shows as none but stays saved too.
    expect([a.meritsSpent, a.looks, a.pattern, a.badge]).toEqual([2, ['stripes', 'halo'], undefined, undefined]);
    expect(w.views('house').find(p => p.id === 'a')).not.toHaveProperty('pattern');
    expect([b.meritsSpent, b.looks, b.pattern]).toEqual([0, [], undefined]);
  });

  it('tells the player their merits as they join: what they spent, and what they bought that this release has', () => {
    const maps = [...fixtureMaps().filter(m => m.data.id !== 'house'), withChest()];
    const w = new World(maps, 'town', 'overcast', { items: ITEMS, rng: () => 0, guests: true });
    expect(w.join(rec('a', 3, 2, 2, { meritsSpent: 2, looks: ['stripes', 'halo'] }), 0).merits).toEqual({ spent: 2, owned: ['stripes'] });
  });
});
