/**
 * Home: the chest that is each player's stash, the XP it earns and the levels XP brings. World rules
 * only; over WebSockets they go through the same calls as the rest (net.ts).
 */
import { describe, expect, it } from 'vitest';
import { ENERGY_MAX, ENERGY_PER_LEVEL, TileMap, XP_CURVE, type Dir, type ItemsData, type ServerMsg } from '@napoland/shared';
import type { PlayerRecord } from '../src/storage';
import { World, colorFor, type Outgoing, type WorldOptions } from '../src/world';
import { fixtureMaps, houseData } from './fixtures';

/** The fixture house with a chest at 3,1, next to the fireplace: stand at 3,2 facing up to reach it. */
const withChest = () => {
  const h = houseData();
  return new TileMap({ ...h, objects: [...h.objects, { kind: 'chest', x: 3, y: 1 }] });
};

const ITEMS: ItemsData = {
  version: 1,
  items: [
    { id: 'moss', name: 'Moss', kind: 'resource', stack: 10, text: 'Soft.', xp: 2 },
    { id: 'shard', name: 'Shard', kind: 'resource', stack: 5, text: 'Warm.', xp: 12 },
    { id: 'tea', name: 'Tea', kind: 'consumable', stack: 2, text: 'Warm.', use: { energy: 30 }, xp: 3 },
  ],
  finds: [],
};

const rec = (id: string, x: number, y: number, more: Partial<PlayerRecord> = {}, dir: Dir = 'up'): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map: 'house', x, y, dir, color: colorFor(id), energy: 50, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});

function world(...players: PlayerRecord[]): World {
  return worldWith({}, ...players);
}
/** A world with its own options (a play-test's XP or rest), everyone joined at time 0. */
function worldWith(options: WorldOptions, ...players: PlayerRecord[]): World {
  const maps = [...fixtureMaps().filter(m => m.data.id !== 'house'), withChest()];
  const w = new World(maps, 'town', 'overcast', { items: ITEMS, rng: () => 0, ...options });
  for (const p of players) w.join(p, 0);
  w.drain();
  w.takeWrites();
  return w;
}
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id ? [o.msg] : []));
const of = <T extends ServerMsg['t']>(msgs: ServerMsg[], t: T) => msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);

describe('the chest at home', () => {
  it('shows each player their own stash, and only from next to it', () => {
    const w = world(rec('a', 3, 2, { stash: { items: { moss: 4 }, out: {} } }), rec('b', 2, 2));
    w.chest('a', 3, 1);
    expect(to(w.drain(), 'a')).toEqual([{ t: 'chest', stash: [{ item: 'moss', count: 4 }] }]);
    // b stands two tiles away; and a cannot open a chest where none stands.
    w.chest('b', 3, 1);
    w.chest('a', 3, 3);
    expect(w.drain()).toEqual([]);
  });

  it('takes everything you carry, earns its XP and a level, and the bar grows at once', () => {
    const w = world(rec('a', 3, 2, { bag: [{ item: 'shard', count: 3 }, { item: 'moss', count: 2 }] }));
    w.store('a', 3, 1, undefined, 1000);
    const heard = to(w.drain(), 'a');
    expect(of(heard, 'bag')).toEqual([{ t: 'bag', bag: [] }]);
    expect(of(heard, 'chest')).toEqual([{ t: 'chest', stash: [{ item: 'moss', count: 2 }, { item: 'shard', count: 3 }] }]);
    // 36 + 4 = 40 XP: level 2.
    expect(of(heard, 'progress')).toEqual([{ t: 'progress', progress: { xp: 40, level: 2, from: XP_CURVE, to: XP_CURVE * 4, maxEnergy: ENERGY_MAX + ENERGY_PER_LEVEL }, gained: 40 }]);
    expect(of(heard, 'energy').at(-1)?.energy.max).toBe(ENERGY_MAX + ENERGY_PER_LEVEL);
    expect(w.takeWrites().players.map(p => [p.xp, p.stash])).toEqual([[40, { items: { shard: 3, moss: 2 }, out: {} }]]);
  });

  it('takes one slot, and says so when there is nothing in it', () => {
    const w = world(rec('a', 3, 2, { bag: [{ item: 'moss', count: 2 }, { item: 'tea', count: 1 }] }));
    w.store('a', 3, 1, 1, 1000);
    expect(of(to(w.drain(), 'a'), 'bag')).toEqual([{ t: 'bag', bag: [{ item: 'moss', count: 2 }] }]);
    w.store('a', 3, 1, 5, 1000);
    expect(of(to(w.drain(), 'a'), 'refused')).toEqual([{ t: 'refused', action: 'store', reason: 'empty_slot' }]);
  });

  it('gives back what fits in the bag, and earns nothing when it goes back in', () => {
    const w = world(rec('a', 3, 2, { xp: 100, stash: { items: { tea: 5 }, out: {} } }));
    w.take('a', 3, 1, 'tea', 3, 1000);
    const heard = to(w.drain(), 'a');
    expect(of(heard, 'bag')).toEqual([{ t: 'bag', bag: [{ item: 'tea', count: 2 }, { item: 'tea', count: 1 }] }]);
    expect(of(heard, 'chest')).toEqual([{ t: 'chest', stash: [{ item: 'tea', count: 2 }] }]);
    // One drunk: used up. The two left go back in for nothing.
    w.use('a', 0, 1100);
    w.store('a', 3, 1, undefined, 1200);
    expect(of(to(w.drain(), 'a'), 'progress')).toEqual([{ t: 'progress', progress: expect.objectContaining({ xp: 100 }), gained: 0 }]);
    // Taking out what is not there, or from too far.
    w.take('a', 3, 1, 'shard', 1, 1300);
    w.take('a', 3, 1, 'nope', 1, 1300);
    expect(of(to(w.drain(), 'a'), 'refused').map(r => r.reason)).toEqual(['not_stashed', 'not_stashed']);
  });

  it('refuses when the bag has no room', () => {
    const full = Array.from({ length: 8 }, () => ({ item: 'shard', count: 5 }));
    const w = world(rec('a', 3, 2, { bag: full, stash: { items: { moss: 1 }, out: {} } }));
    w.take('a', 3, 1, 'moss', 1, 1000);
    expect(of(to(w.drain(), 'a'), 'refused')).toEqual([{ t: 'refused', action: 'take', reason: 'bag_full' }]);
  });
});

describe('levels', () => {
  it('fill the bar up to their own maximum', () => {
    const w = world(rec('a', 3, 2, { xp: XP_CURVE * 4, energy: 999 }));
    // Level 3: 110.
    expect(w.get('a')!.energy).toBe(ENERGY_MAX + 2 * ENERGY_PER_LEVEL);
  });

  it('come from saved XP, and bad saves count as none', () => {
    const w = world(rec('a', 3, 2, { xp: -5, stash: { items: { moss: 2, gone: 4, shard: 1.5 }, out: { moss: -1 } } as never }));
    expect(w.get('a')!.xp).toBe(0);
    expect(w.get('a')!.stash).toEqual({ items: { moss: 2 }, out: {} });
  });
});

describe('rest while away', () => {
  const HOUR = 3_600_000;

  it('fills as they join, from when they were last seen by the world\'s clock, and the welcome says what the time away was worth', () => {
    const w = worldWith({ epochOffset: 10 * HOUR });
    const joined = w.join(rec('a', 3, 2, { lastSeenAt: 8 * HOUR - 60_000 }), 0);
    expect(joined.progress.rested).toBe(6);
    expect(joined.restedAway).toBe(6);
    expect(w.get('a')!.rested).toBe(6);
    // Seen as they leave: straight back is no time away, even with the record as it left.
    const left = w.leave('a', 30_000)!;
    expect(left.lastSeenAt).toBe(10 * HOUR + 30_000);
    const again = w.join(left, 30_000);
    expect(again).toMatchObject({ restedAway: 0, progress: expect.objectContaining({ rested: 6 }) });
  });

  it('fills faster only for a play-test (RESTED_EVERY_MS), and never past three days\' worth', () => {
    const w = worldWith({ epochOffset: 10 * HOUR, restedEveryMs: 1000 });
    expect(w.join(rec('a', 3, 2, { lastSeenAt: 10 * HOUR - 30_000 }), 0).progress.rested).toBe(30);
    expect(w.join(rec('b', 3, 2, { lastSeenAt: 0, rested: 100 }), 0).progress.rested).toBe(216);
  });

  it('counts a saved cup that makes no sense as empty', () => {
    const w = world(rec('a', 3, 2, { rested: -40 }), rec('b', 3, 2, { rested: 'lots' as never }), rec('c', 3, 2, { rested: 9999 }));
    expect(['a', 'b', 'c'].map(id => w.get(id)!.rested)).toEqual([0, 0, 216]);
  });

  it('doubles a play-test\'s multiple of what stashing earns too, the cup paying as much as it holds', () => {
    const w = worldWith({ xpTimes: 10 }, rec('a', 3, 2, { rested: 30, bag: [{ item: 'moss', count: 3 }] }));
    w.store('a', 3, 1, undefined, 1000);
    expect(of(to(w.drain(), 'a'), 'progress')).toEqual([{ t: 'progress', progress: expect.objectContaining({ xp: 90 }), gained: 90, fromRest: 30 }]);
    expect(w.takeWrites().players.map(p => [p.xp, p.rested])).toEqual([[90, 0]]);
  });

  it('is saved at once with what stashing earned, and only stashing spends it', () => {
    const w = world(rec('a', 3, 2, { rested: 50, bag: [{ item: 'shard', count: 1 }, { item: 'tea', count: 1 }] }));
    // Drunk out there, the tea earns nothing and the cup stays as it is.
    w.use('a', 1, 500);
    expect(w.get('a')!.rested).toBe(50);
    w.store('a', 3, 1, undefined, 1000);
    expect(of(to(w.drain(), 'a'), 'progress')).toEqual([{ t: 'progress', progress: expect.objectContaining({ xp: 24, rested: 38 }), gained: 24, fromRest: 12 }]);
    expect(w.takeWrites().players.map(p => [p.xp, p.rested])).toEqual([[24, 38]]);
  });
});
