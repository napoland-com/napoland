/**
 * Your street and your neighbors: every player's cabin stands on a lot of a street, a copy of the street's
 * map; players are given the first free lot as they first come home, and a new street opens when the
 * others are full. The road from town comes onto your street where it comes in; out of a cabin you stand
 * in front of its door. Other doors are knocked at, and walked into to look around unless their owner
 * keeps their neighbors out. NAPO's teleport in a cabin sends you to its twin in town. World rules first,
 * then over real WebSockets.
 *
 * The fixture world: the town (fixtures.ts, without its house), whose road at 7,2 leads onto a lane of
 * three lots (arriving at its 6,4, facing up); each lot's door leads into the home, a private room where
 * you wake up by the fire; the lane's end leads back to the town's 7,3. The town's teleport stands at 2,5.
 *
 *   lane (13x6, a street)              home (5x5, private)
 *     0123456789012                      01234
 *   0 ttttttttttttt                    0 xxxxx
 *   1 tHHHgHHHgHHHt                    1 xPFHx   P the teleport (1,1), F fire (2,1), H chest (3,1)
 *   2 tHDHgHDHgHDHt  D the lots' doors 2 xpzpx   z where you wake up (2,2)
 *   3 tgggggggggggt  0 (2,2), 1 (6,2), 3 xpppx   2,3: where every lot's door leads in
 *   4 tgggggggggggt  2 (10,2)          4 xxpxx   2,4: out onto the lane, in front of the cabin's door
 *   5 ttttttggttttt  6,5 and 7,5: the lane's end, to the town's 7,3
 */
import { describe, expect, it } from 'vitest';
import { ENERGY_MAX, PROTOCOL_VERSION, STEP_MS, TileMap, lotDoors, validateMap, validateWorld, type Dir, type ItemsData, type MapData, type ServerMsg } from '@napoland/shared';
import { setLogLevel } from '../src/log';
import { startServer } from '../src/server';
import { MemoryStorage, type LotRecord, type PlayerRecord } from '../src/storage';
import { devAuth } from '../src/auth';
import { DOOR_EVERY_MS, KNOCK_EVERY_MS, MOVE_EVERY_MS, World, colorFor, zoneKey, type Outgoing } from '../src/world';
import { itemsData, townData, woodsData } from './fixtures';
import { Client, loginTo, savedPlayer, serverDefaults, waitFor } from './helpers';

function town(): MapData {
  const t = townData();
  return {
    ...t, exits: t.exits.map(e => (e.to === 'house' ? { ...e, to: 'lane', tx: 6, ty: 4 } : e)),
    objects: [...t.objects.filter(o => o.kind !== 'house'), { kind: 'teleport', x: 2, y: 5 }],
  };
}

function lane(): MapData {
  const house = (x: number) => ({ kind: 'house' as const, x, y: 1, w: 3, h: 2, roof: '#6b7075', lit: 0 as const, plate: true as const });
  return {
    id: 'lane', name: 'The Lane', version: 1, kind: 'town', depth: 0, width: 13, height: 6, street: true,
    tiles: ['ttttttttttttt', ...Array<string>(4).fill('tgggggggggggt'), 'ttttttggttttt'],
    levels: Array<string>(6).fill('0000000000000'),
    spawn: { x: 6, y: 4, dir: 'up' },
    exits: [
      ...[2, 6, 10].map(x => ({ x, y: 2, w: 1, h: 1, to: 'house', tx: 2, ty: 3, dir: 'up' as Dir })),
      { x: 6, y: 5, w: 2, h: 1, to: 'town', tx: 7, ty: 3, dir: 'down' },
    ],
    objects: [house(1), house(5), house(9)],
  };
}

function home(): MapData {
  return {
    id: 'house', name: 'Home', version: 1, kind: 'inside', depth: 0, width: 5, height: 5,
    tiles: ['xxxxx', 'xpppx', 'xpppx', 'xpppx', 'xxpxx'],
    levels: Array<string>(5).fill('00000'),
    spawn: { x: 2, y: 3, dir: 'up' },
    exits: [{ x: 2, y: 4, w: 1, h: 1, to: 'lane', tx: 2, ty: 3, dir: 'down' }],
    objects: [{ kind: 'teleport', x: 1, y: 1 }, { kind: 'fireplace', x: 2, y: 1 }, { kind: 'chest', x: 3, y: 1 }],
    private: true,
    wake: { x: 2, y: 2, dir: 'down' },
  };
}

const maps = () => [new TileMap(town()), new TileMap(lane()), new TileMap(home()), new TileMap(woodsData())];
const LANE = (n: number) => zoneKey('lane', String(n));

const rec = (id: string, map: string, x: number, y: number, dir: Dir = 'up', more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map, x, y, dir, color: colorFor(id), energy: ENERGY_MAX, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});
/** A player who never came home since streets came: in their cabin, where they wake up. */
const fresh = (id: string) => rec(id, 'house', 2, 2, 'down');
const lot = (id: string, street: number, n: number, off = false, more: Partial<LotRecord> = {}): LotRecord => ({ id, name: id.toUpperCase(), street, lot: n, ...(off && { off: true as const }), ...more });

/** The fixture items, with a stove to make for a cabin and a charm for its trophy shelf. */
function items(): ItemsData {
  const base = itemsData();
  return {
    ...base,
    items: [
      ...base.items,
      { id: 'stove', name: 'Iron stove', kind: 'furniture', stack: 1, furnishes: 'stove', comfort: 3, text: 'Warm.', spoiled: 'Rusted.' },
      { id: 'bead', name: 'Humming bead', kind: 'charm', stack: 1, charm: { hitch: 0.4 }, text: 'It hums.' },
    ],
  };
}

function world(lots: LotRecord[] = [], friends: Record<string, string[]> = {}): World {
  const w = new World(maps(), 'town', 'overcast', { items: items(), rng: () => 0, lots });
  w.friends = id => new Set(friends[id] ?? []);
  return w;
}
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id ? [o.msg] : []));
const on = (out: Outgoing[], zone: string) => out.flatMap(o => ('map' in o && o.map === zone ? [o.msg] : []));
const of = <T extends ServerMsg['t']>(msgs: ServerMsg[], t: T) => msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
let seq = 0;
/** Walks `dirs` one step after the other from game time `at`; returns the time after the last. */
function walk(w: World, id: string, dirs: Dir[], at: number): number {
  for (const dir of dirs) {
    w.step(id, dir, ++seq, at);
    at += STEP_MS;
  }
  return at;
}

describe('the fixtures', () => {
  it('follow the content rules: a street whose every door leads into the home, reached from the town', () => {
    for (const m of [town(), lane(), home()]) expect(validateMap(m).filter(p => p.level === 'error'), m.id).toEqual([]);
    expect(validateWorld([town(), lane(), home(), woodsData()], 'town').filter(p => p.level === 'error')).toEqual([]);
    expect(lotDoors(lane())).toEqual([{ x: 2, y: 2 }, { x: 6, y: 2 }, { x: 10, y: 2 }]);
  });
});

describe('lots on a street', () => {
  it('are given as players first come home: the first free lot of the first street with one, and a new street once they are full', () => {
    const w = world();
    for (const id of ['a', 'b', 'c', 'd']) w.join(fresh(id), 0);
    expect(['a', 'b', 'c', 'd'].map(id => [w.get(id)!.street, w.get(id)!.lot])).toEqual([[1, 0], [1, 1], [1, 2], [2, 0]]);
    // Saved at once.
    expect(w.takeWrites().players.map(p => [p.id, p.street, p.lot])).toEqual([['a', 1, 0], ['b', 1, 1], ['c', 1, 2], ['d', 2, 0]]);
    // Out of the cabin: onto their own street, in front of their own door, facing away from it.
    walk(w, 'd', ['down', 'down'], 1000);
    expect(w.zoneOf('d')).toBe(LANE(2));
    expect(w.get('d')).toMatchObject({ map: 'lane', x: 2, y: 3, dir: 'down' });
    walk(w, 'b', ['down', 'down'], 1000);
    expect(w.zoneOf('b')).toBe(LANE(1));
    expect(w.get('b')).toMatchObject({ map: 'lane', x: 6, y: 3, dir: 'down' });
  });

  it('keep who lives where across a restart, and a lot saved for someone else is never taken', () => {
    // Saved twice on one lot (it should not happen): it is the first one's.
    const w = world([lot('a', 1, 1), lot('z', 1, 0), lot('y', 1, 0)]);
    w.join(fresh('n'), 0);
    expect([w.get('n')!.street, w.get('n')!.lot]).toEqual([1, 2]);
    // y has no lot now: they are given one when they come home, on a new street, the first being full.
    // The road from town comes onto it where it comes in, not at their door: they walk the rest.
    w.join(rec('y', 'town', 7, 3, 'up', { street: 1, lot: 0 }), 0);
    expect(w.get('y')!.street).toBeUndefined();
    w.step('y', 'up', ++seq, 1000);
    expect(w.zoneOf('y')).toBe(LANE(2));
    expect(w.get('y')).toMatchObject({ map: 'lane', x: 6, y: 4, dir: 'up' });
    expect([w.get('y')!.street, w.get('y')!.lot]).toEqual([2, 0]);
    w.join(rec('a', 'town', 1, 2, 'down'), 0);
    expect([w.get('a')!.street, w.get('a')!.lot]).toEqual([1, 1]);
  });

  it('light a window while its owner is home, which everyone out on the street sees', () => {
    const w = world([lot('a', 1, 0), lot('b', 1, 1)]);
    w.join(rec('a', 'lane', 4, 4, 'up'), 0);
    const b = w.join(rec('b', 'lane', 6, 3, 'up'), 0);
    expect(b.street).toEqual({ mine: 1, lots: [{ name: 'A' }, { name: 'B' }, null] });
    w.drain();
    // b walks in through their own door: a sees b's window light.
    walk(w, 'b', ['up'], 1000);
    expect(w.zoneOf('b')).toBe(zoneKey('house', 'b'));
    expect(on(w.drain(), LANE(1))).toContainEqual({ t: 'lot', lot: 1, view: { name: 'B', home: true } });
    // Gone from the game in there: dark again.
    w.leave('b', 2000);
    expect(on(w.drain(), LANE(1))).toContainEqual({ t: 'lot', lot: 1, view: { name: 'B' } });
  });

  it('keep you out of a door nobody lives behind', () => {
    const w = world([lot('a', 1, 0)]);
    w.join(rec('a', 'lane', 6, 3, 'up'), 0);
    w.drain();
    walk(w, 'a', ['up'], 1000);
    // Nothing to hear: the client never tries a free lot's door.
    expect(to(w.drain(), 'a')).toEqual([{ t: 'reject', seq, x: 6, y: 3, dir: 'up' }]);
    expect(w.zoneOf('a')).toBe(LANE(1));
  });
});

describe('visits', () => {
  it('let you walk into a neighbor\'s cabin while they are away, to see how they made it theirs, and out in front of its door', () => {
    const cabin = { furniture: ['stove', 'gone'], stash: { items: { bead: 1, moss: 3 }, out: {} } };
    const w = world([lot('a', 1, 0), lot('b', 1, 1, false, cabin)]);
    w.join(rec('a', 'lane', 6, 3, 'up'), 0);
    w.drain();
    w.takeWrites();
    walk(w, 'a', ['up'], 1000);
    expect(w.zoneOf('a')).toBe(zoneKey('house', 'b'));
    const out = to(w.drain(), 'a');
    const [zone] = of(out, 'zone');
    expect(zone).toMatchObject({ map: { id: 'house' }, x: 2, y: 3, visit: { name: 'B', furniture: ['stove'], trophies: ['bead'] } });
    expect(zone).not.toHaveProperty('furniture');
    // A visit is no homecoming: no letter, no trip's end; and it is not their window that lights.
    expect(of(out, 'streetLetter')).toEqual([]);
    expect(w.takeWrites().players.find(p => p.id === 'a')?.streetTold).toBeUndefined();
    // Their chest is b's: a's stash is never opened here.
    walk(w, 'a', ['up', 'right'], 2000);
    w.drain();
    w.chest('a', 3, 1, 3000);
    w.store('a', 3, 1, undefined, 3000);
    expect(to(w.drain(), 'a')).toEqual([{ t: 'refused', action: 'store', reason: 'too_far' }]);
    // Out again: in front of b's door, not their own.
    walk(w, 'a', ['down', 'left', 'down'], 4000);
    expect(w.zoneOf('a')).toBe(LANE(1));
    expect(w.get('a')).toMatchObject({ map: 'lane', x: 6, y: 3, dir: 'down' });
  });

  it('tell a neighbor at home who came in, once in a while, and show their cabin as it stands now', () => {
    const w = world([lot('a', 1, 0), lot('b', 1, 1)]);
    w.join(rec('a', 'lane', 6, 3, 'up'), 0);
    w.join(rec('b', 'house', 2, 2, 'down', { zone: 'b', furniture: ['stove'], stash: { items: { bead: 1 }, out: {} } }), 0);
    w.drain();
    walk(w, 'a', ['up'], 1000);
    let out = w.drain();
    expect(to(out, 'b')).toContainEqual({ t: 'cameIn', name: 'A' });
    expect(on(out, zoneKey('house', 'b'))).toContainEqual(expect.objectContaining({ t: 'join', player: expect.objectContaining({ id: 'a' }) }));
    expect(of(to(out, 'a'), 'zone')[0]).toMatchObject({ visit: { name: 'B', furniture: ['stove'], trophies: ['bead'] } });
    // Out and straight back in: b is not told twice.
    walk(w, 'a', ['down', 'up'], 1000 + STEP_MS);
    out = w.drain();
    expect(w.zoneOf('a')).toBe(zoneKey('house', 'b'));
    expect(of(to(out, 'b'), 'cameIn')).toEqual([]);
    walk(w, 'a', ['down'], 1000 + KNOCK_EVERY_MS);
    walk(w, 'a', ['up'], 1000 + KNOCK_EVERY_MS + STEP_MS);
    expect(of(to(w.drain(), 'b'), 'cameIn')).toEqual([{ t: 'cameIn', name: 'A' }]);
    // Gone from the game, b leaves the cabin as it was for whoever comes in next.
    w.leave('b', 9000);
    walk(w, 'a', ['down', 'up'], 9000);
    expect(of(to(w.drain(), 'a'), 'zone').at(-1)).toMatchObject({ visit: { name: 'B', furniture: ['stove'], trophies: ['bead'] } });
  });

  it('only by your own fire are you cozy', () => {
    const w = world([lot('a', 1, 0), lot('b', 1, 1)]);
    w.join(rec('a', 'house', 2, 2, 'down', { zone: 'b' }), 0);
    // Back in the game, a is in their own cabin (a neighbor's is never where anyone comes back to).
    expect(w.zoneOf('a')).toBe(zoneKey('house', 'a'));
    w.join(rec('c', 'lane', 6, 3, 'up'), 0);
    walk(w, 'c', ['up', 'up'], 1000);
    expect(w.zoneOf('c')).toBe(zoneKey('house', 'b'));
    expect(w.get('c')).toMatchObject({ x: 2, y: 2 });
    w.tick(60_000);
    expect(w.get('c')!.cozy).toBeUndefined();
  });

  it('keep neighbors out when the owner says so or keeps their door to themselves: friends come in, and someone blocked never does', () => {
    // b keeps their neighbors out, c their door to themselves; d lets anyone in, but blocks a.
    const w = world([lot('a', 1, 0), lot('b', 1, 1, false, { shut: true }), lot('c', 1, 2, true), lot('e', 2, 0), lot('f', 2, 1, false, { shut: true })], { a: ['c'] });
    w.blockedBy = id => new Set(id === 'a' ? ['e'] : []);
    w.join(rec('a', 'lane', 6, 3, 'up'), 0);
    w.drain();
    walk(w, 'a', ['up'], 1000);
    expect(to(w.drain(), 'a')).toEqual([{ t: 'locked', x: 6, y: 2 }, { t: 'reject', seq, x: 6, y: 3, dir: 'up' }]);
    // c is a's friend: in, though c keeps the door to themselves.
    const at = walk(w, 'a', ['right', 'right', 'right', 'right', 'up'], 2000);
    expect(w.zoneOf('a')).toBe(zoneKey('house', 'c'));
    // On street 2, g is kept out of f's (shut) and e's (e blocks nobody but a); a is kept out of e's even with e away.
    w.join(rec('g', 'lane', 6, 3, 'up', { street: 2, lot: 2 }), at);
    w.drain();
    walk(w, 'g', ['up'], at);
    expect(of(to(w.drain(), 'g'), 'locked')).toEqual([{ t: 'locked', x: 6, y: 2 }]);
    walk(w, 'g', ['left', 'left', 'left', 'left', 'up'], at + 1000);
    expect(w.zoneOf('g')).toBe(zoneKey('house', 'e'));
    const blocked = new World(maps(), 'town', 'overcast', { items: items(), rng: () => 0, lots: [lot('a', 2, 2), lot('e', 2, 0)] });
    blocked.blockedBy = id => new Set(id === 'a' ? ['e'] : []);
    blocked.join(rec('a', 'lane', 2, 3, 'up'), 0);
    blocked.drain();
    walk(blocked, 'a', ['up'], 1000);
    expect(of(to(blocked.drain(), 'a'), 'locked')).toEqual([{ t: 'locked', x: 2, y: 2 }]);
    blocked.blocks = id => new Set(id === 'e' ? ['a'] : []);
    blocked.blockedBy = () => new Set();
    walk(blocked, 'a', ['up'], 2000);
    expect(blocked.zoneOf('a')).toBe(LANE(2));
  });

  it('follow the setting: saved at once, heard back as it stands, kept with the lot through a move and the welcome', () => {
    const w = world([lot('a', 1, 0), lot('b', 1, 1), lot('d', 2, 0), lot('e', 2, 2)], { b: ['d'] });
    w.join(rec('a', 'lane', 6, 3, 'up'), 0);
    w.join(rec('b', 'lane', 6, 3, 'up'), 0);
    w.drain();
    w.takeWrites();
    w.visitsOff('b', true, 1000);
    expect(to(w.drain(), 'b')).toEqual([{ t: 'visitsOff', off: true }]);
    expect(w.takeWrites().players.find(p => p.id === 'b')).toMatchObject({ visitsOff: true });
    // Too soon to change it back: it stands.
    w.visitsOff('b', false, 1500);
    expect(to(w.drain(), 'b')).toEqual([{ t: 'visitsOff', off: true }]);
    walk(w, 'a', ['up'], 2000);
    expect(of(to(w.drain(), 'a'), 'locked')).toHaveLength(1);
    // b moves next to d: still shut there. And the welcome says it.
    w.moveNextTo('b', 'd', 3000);
    expect(w.get('b')).toMatchObject({ street: 2, lot: 1, visitsOff: true });
    w.join(rec('e', 'lane', 2, 3, 'down'), 3000);
    expect(w.join(rec('d', 'lane', 2, 3, 'up', { visitsOff: true }), 3000)).toMatchObject({ visitsOff: true });
    w.drain();
    walk(w, 'e', ['right', 'right', 'right', 'right', 'up'], 4000);
    expect(of(to(w.drain(), 'e'), 'locked')).toEqual([{ t: 'locked', x: 6, y: 2 }]);
    w.visitsOff('b', false, 5000);
    walk(w, 'e', ['up'], 6000);
    expect(w.zoneOf('e')).toBe(zoneKey('house', 'b'));
  });
});

describe('NAPO\'s teleport', () => {
  it('in a cabin, your own or a neighbor\'s, takes you to its twin in town, in front of it; the twin sends nobody anywhere', () => {
    const w = world([lot('a', 1, 0), lot('b', 1, 1)]);
    w.join(rec('a', 'house', 1, 2, 'up', { zone: 'a' }), 0);
    w.drain();
    w.talk('a', 1, 1, 1000);
    expect(w.zoneOf('a')).toBe('town');
    expect(w.get('a')).toMatchObject({ map: 'town', x: 2, y: 6, dir: 'down' });
    expect(of(to(w.drain(), 'a'), 'zone')[0]).toMatchObject({ map: { id: 'town' }, x: 2, y: 6, dir: 'down' });
    // The twin: nothing happens.
    w.talk('a', 2, 5, 2000);
    expect(w.zoneOf('a')).toBe('town');
    // From a neighbor's, and only from next to it.
    w.join(rec('c', 'lane', 6, 3, 'up'), 3000);
    walk(w, 'c', ['up'], 3000);
    w.talk('c', 1, 1, 4000);
    expect(w.zoneOf('c')).toBe(zoneKey('house', 'b'));
    walk(w, 'c', ['up', 'left'], 4000);
    w.talk('c', 1, 1, 5000);
    expect(w.get('c')).toMatchObject({ map: 'town', x: 2, y: 6 });
  });
});

describe('knocking', () => {
  it('tells a neighbor at home who knocked, and the knocker whether anyone is home; nobody on another street hears', () => {
    const w = world([lot('a', 1, 0), lot('b', 1, 1), lot('c', 1, 2), lot('d', 2, 1)]);
    w.join(rec('a', 'lane', 6, 3, 'up'), 0);
    w.join(rec('b', 'house', 2, 2, 'down', { zone: 'b' }), 0);
    w.join(rec('d', 'house', 2, 2, 'down', { zone: 'd' }), 0);
    w.drain();
    w.knock('a', 6, 2, 1000);
    const out = w.drain();
    expect(to(out, 'a')).toEqual([{ t: 'door', x: 6, y: 2, lot: { name: 'B', home: true } }]);
    expect(to(out, 'b')).toEqual([{ t: 'knocked', name: 'A' }]);
    expect(to(out, 'd')).toEqual([]);
    // Too soon for another; and at C's door, nobody answers.
    const at = walk(w, 'a', ['right', 'right', 'right', 'right'], 1000);
    w.drain();
    w.knock('a', 10, 2, at);
    expect(of(to(w.drain(), 'a'), 'refused')).toEqual([{ t: 'refused', action: 'knock', reason: 'slow_down' }]);
    w.knock('a', 10, 2, 1000 + KNOCK_EVERY_MS);
    expect(to(w.drain(), 'a')).toEqual([{ t: 'door', x: 10, y: 2, lot: { name: 'C' } }]);
    // A door nobody lives behind yet.
    const empty = world([lot('a', 1, 0)]);
    empty.join(rec('a', 'lane', 6, 3, 'up'), 0);
    empty.drain();
    empty.knock('a', 6, 2, 1000);
    expect(to(empty.drain(), 'a')).toEqual([{ t: 'door', x: 6, y: 2, lot: null }]);
  });

  it('never reaches someone who blocks the knocker, and is no knock from too far', () => {
    const w = world([lot('a', 1, 0), lot('b', 1, 1)]);
    w.blocks = id => new Set(id === 'b' ? ['a'] : []);
    w.join(rec('a', 'lane', 6, 3, 'up'), 0);
    w.join(rec('b', 'house', 2, 2, 'down', { zone: 'b' }), 0);
    w.drain();
    w.knock('a', 6, 2, 1000);
    const out = w.drain();
    expect(to(out, 'a')).toEqual([{ t: 'door', x: 6, y: 2, lot: { name: 'B', home: true } }]);
    expect(to(out, 'b')).toEqual([]);
    w.knock('a', 10, 2, 9000);
    expect(to(w.drain(), 'a')).toEqual([{ t: 'refused', action: 'knock', reason: 'too_far' }]);
  });
});

describe('moving next to a friend', () => {
  it('is offered at your own door for each friend whose street has a lot free, and takes your cabin there', () => {
    const w = world([lot('a', 1, 0), lot('b', 1, 1), lot('c', 1, 2), lot('d', 2, 2)], { c: ['d', 'a'], d: ['c', 'a'] });
    w.join(rec('c', 'lane', 10, 3, 'up'), 0);
    w.join(rec('d', 'lane', 10, 3, 'up'), 0);
    w.join(rec('a', 'lane', 2, 3, 'up'), 0);
    w.drain();
    // c's own door: D's street has room; A lives on c's own street already.
    w.knock('c', 10, 2, 1000);
    expect(to(w.drain(), 'c')).toEqual([{ t: 'doorstep', moves: [{ id: 'd', name: 'D' }] }]);
    // d's own door: A's street is full.
    w.knock('d', 10, 2, 1000);
    expect(to(w.drain(), 'd')).toEqual([{ t: 'doorstep', moves: [] }]);
    w.moveNextTo('d', 'a', 1000);
    expect(to(w.drain(), 'd')).toEqual([{ t: 'refused', action: 'move', reason: 'street_full' }]);
    // c moves next to D: onto street 2, the free lot nearest D's (lot 1), in front of its door.
    w.moveNextTo('c', 'd', 1100);
    const out = w.drain();
    expect(w.zoneOf('c')).toBe(LANE(2));
    expect(w.get('c')).toMatchObject({ map: 'lane', street: 2, lot: 1, x: 6, y: 3, dir: 'down' });
    const [zone] = of(to(out, 'c'), 'zone');
    expect(zone).toMatchObject({ map: { id: 'lane' }, x: 6, y: 3, dir: 'down' });
    expect(zone!.street).toEqual({ mine: 1, lots: [null, { name: 'C' }, { name: 'D' }] });
    expect(zone!.players.map(p => p.id).sort()).toEqual(['c', 'd']);
    expect(of(to(out, 'c'), 'did')).toEqual([{ t: 'did', did: { kind: 'moved', name: 'D' } }]);
    // Both streets see it: C's old lot is free, the new one is C's.
    expect(on(out, LANE(1))).toContainEqual({ t: 'lot', lot: 2, view: null });
    expect(on(out, LANE(2))).toContainEqual({ t: 'lot', lot: 1, view: { name: 'C' } });
    expect(w.takeWrites().players.find(p => p.id === 'c')).toMatchObject({ street: 2, lot: 1 });
    // Now a lot is free on A's street: d may move there.
    w.moveNextTo('d', 'a', 1200);
    expect(w.get('d')).toMatchObject({ street: 1, lot: 2 });
  });

  it('only at your own door, and only next to a friend', () => {
    const w = world([lot('a', 1, 0), lot('d', 2, 0), lot('e', 2, 1)], { a: ['d'] });
    w.join(rec('a', 'lane', 6, 3, 'up'), 0);
    w.drain();
    w.moveNextTo('a', 'd', 1000);
    expect(to(w.drain(), 'a')).toEqual([{ t: 'refused', action: 'move', reason: 'too_far' }]);
    const at = walk(w, 'a', ['left', 'left', 'left', 'left'], 1000);
    w.drain();
    w.moveNextTo('a', 'e', at);
    expect(to(w.drain(), 'a')).toEqual([{ t: 'refused', action: 'move', reason: 'not_friends' }]);
    w.moveNextTo('a', 'd', at);
    expect(w.get('a')).toMatchObject({ street: 2, lot: 2 });
  });

  it('once in a while: a move is saved at once, and both streets hear of it', () => {
    const w = world([lot('a', 1, 0), lot('d', 2, 0), lot('e', 3, 0)], { a: ['d', 'e'] });
    w.join(rec('a', 'lane', 2, 3, 'up'), 0);
    w.moveNextTo('a', 'd', 1000);
    expect(w.get('a')).toMatchObject({ street: 2, lot: 1 });
    // In front of the new door already: moving on to E's street waits a little.
    w.drain();
    w.moveNextTo('a', 'e', 1000 + MOVE_EVERY_MS - 1);
    expect(to(w.drain(), 'a')).toEqual([{ t: 'refused', action: 'move', reason: 'slow_down' }]);
    w.moveNextTo('a', 'e', 1000 + MOVE_EVERY_MS);
    expect(w.get('a')).toMatchObject({ street: 3, lot: 1 });
  });

  it('is never onto your own street', () => {
    const w = world([lot('a', 1, 0), lot('b', 1, 1)], { a: ['b'] });
    w.join(rec('a', 'lane', 2, 3, 'up'), 0);
    w.drain();
    w.moveNextTo('a', 'b', 1000);
    expect(to(w.drain(), 'a')).toEqual([{ t: 'refused', action: 'move', reason: 'neighbors' }]);
  });

  it('frees the lots of players deleted for good', () => {
    const w = world([lot('a', 1, 0), lot('g', 1, 1)]);
    w.join(rec('a', 'lane', 2, 3, 'up'), 0);
    w.drain();
    w.forgetLots(['g']);
    expect(on(w.drain(), LANE(1))).toEqual([{ t: 'lot', lot: 1, view: null }]);
    w.join(fresh('n'), 0);
    expect(w.get('n')).toMatchObject({ street: 1, lot: 1 });
  });
});

describe('a door kept to oneself', () => {
  it('shows the street a resident: no name on the plate, never a lit window, and it follows the setting at once', () => {
    const w = world([lot('a', 1, 0), lot('b', 1, 1)]);
    w.join(rec('a', 'lane', 2, 3, 'up'), 0);
    w.join(rec('b', 'house', 2, 2, 'down', { zone: 'b' }), 0);
    w.drain();
    w.takeWrites();
    w.doorOff('b', true, 1000);
    const out = w.drain();
    expect(to(out, 'b')).toContainEqual({ t: 'doorOff', off: true });
    expect(on(out, LANE(1))).toEqual([{ t: 'lot', lot: 1, view: {} }]);
    // Saved at once, like the other settings.
    expect(w.takeWrites().players.find(p => p.id === 'b')).toMatchObject({ doorOff: true });
    // Changed again too soon: nothing changes, and b hears the setting as it stands.
    w.doorOff('b', false, 1500);
    expect(to(w.drain(), 'b')).toEqual([{ t: 'doorOff', off: true }]);
    // Shown again: the name, and the window lit (b is home).
    w.doorOff('b', false, 1000 + DOOR_EVERY_MS);
    expect(on(w.drain(), LANE(1))).toEqual([{ t: 'lot', lot: 1, view: { name: 'B', home: true } }]);
    expect(w.get('b')!.doorOff).toBeUndefined();
  });

  it('answers only friends: anyone else hears nobody answer, and the knock still reaches whoever is home', () => {
    // c counts b a friend (the World asks both ways); a does not.
    const w = world([lot('a', 1, 0), lot('b', 1, 1, true), lot('c', 1, 2)], { c: ['b'] });
    w.join(rec('a', 'lane', 6, 3, 'up'), 0);
    w.join(rec('c', 'lane', 6, 3, 'up'), 0);
    w.join(rec('b', 'house', 2, 2, 'down', { zone: 'b', doorOff: true }), 0);
    w.drain();
    w.knock('a', 6, 2, 1000);
    let out = w.drain();
    expect(to(out, 'a')).toEqual([{ t: 'door', x: 6, y: 2, lot: {} }]);
    expect(to(out, 'b')).toEqual([{ t: 'knocked', name: 'A' }]);
    w.knock('c', 6, 2, 1000);
    out = w.drain();
    expect(to(out, 'c')).toEqual([{ t: 'door', x: 6, y: 2, lot: { name: 'B', home: true } }]);
    expect(to(out, 'b')).toEqual([{ t: 'knocked', name: 'C' }]);
  });

  it('is kept for everyone, online or not, and goes with the player: into a new lot, a move and the welcome', () => {
    // b keeps the door, offline: the street, loaded, sees a resident.
    const w = world([lot('a', 1, 0), lot('b', 1, 1, true), lot('d', 2, 0)], { e: ['d'] });
    expect(w.join(rec('a', 'lane', 2, 3, 'up'), 0).street).toEqual({ mine: 0, lots: [{ name: 'A' }, {}, null] });
    // Someone new who chose it already (before coming home): their new lot is a resident's too.
    const e = w.join(rec('e', 'lane', 10, 3, 'up', { doorOff: true }), 0);
    expect(e).toMatchObject({ doorOff: true, street: { mine: 2, lots: [{ name: 'A' }, {}, {}] } });
    // Moving next to a friend keeps it.
    w.moveNextTo('e', 'd', 1000);
    expect(w.get('e')).toMatchObject({ street: 2, lot: 1, doorOff: true });
    expect(of(to(w.drain(), 'e'), 'zone')[0]!.street).toEqual({ mine: 1, lots: [{ name: 'D' }, {}, null] });
    // Saved as anything but true, it is not kept.
    w.join(rec('f', 'lane', 2, 3, 'up', { doorOff: 1 as unknown as true }), 0);
    expect(w.get('f')!.doorOff).toBeUndefined();
  });
});

describe('the letter about your street', () => {
  it('comes the first time home, once, and says whether the door is kept to oneself', () => {
    const w = world([lot('a', 1, 0), lot('b', 1, 1)]);
    w.join(rec('a', 'lane', 2, 3, 'up'), 0);
    w.drain();
    w.takeWrites();
    walk(w, 'a', ['up'], 1000);
    expect(of(to(w.drain(), 'a'), 'streetLetter')).toEqual([{ t: 'streetLetter', doorOff: false }]);
    expect(w.takeWrites().players.find(p => p.id === 'a')).toMatchObject({ streetTold: true });
    // Out and back in: never again.
    walk(w, 'a', ['down', 'up'], 2000);
    expect(w.zoneOf('a')).toBe(zoneKey('house', 'a'));
    expect(of(to(w.drain(), 'a'), 'streetLetter')).toEqual([]);
    // Back in the game at home (net.ts says so once it knows whom they block), one who kept their door already reads it that way.
    w.join(rec('b', 'house', 2, 2, 'down', { zone: 'b', doorOff: true }), 3000);
    w.returned('b', 3000);
    expect(of(to(w.drain(), 'b'), 'streetLetter')).toEqual([{ t: 'streetLetter', doorOff: true }]);
    // Read before: not again.
    w.join(rec('c', 'house', 2, 2, 'down', { zone: 'c', streetTold: true }), 3000);
    w.returned('c', 3000);
    expect(of(to(w.drain(), 'c'), 'streetLetter')).toEqual([]);
  });

  it('never comes where there is no street', () => {
    const plain = new World([new TileMap(townData()), new TileMap({ ...home(), exits: [{ x: 2, y: 4, w: 1, h: 1, to: 'town', tx: 7, ty: 3, dir: 'down' }] }), new TileMap(woodsData())], 'town', 'overcast', { items: itemsData() });
    plain.join(rec('a', 'house', 2, 2, 'down', { zone: 'a' }), 0);
    plain.returned('a', 0);
    expect(of(to(plain.drain(), 'a'), 'streetLetter')).toEqual([]);
  });
});

describe('a door kept to oneself, over the network', () => {
  it('can be set by anyone, guests too; the street sees a resident, knocks go unanswered but for friends, and it all lasts a restart', async () => {
    setLogLevel('silent');
    let now = 1_000_000;
    const storage = new MemoryStorage();
    const options = () => ({ ...serverDefaults(), storage, maps: maps(), items: itemsData(), weather: 'overcast' as const, clock: () => now, auth: devAuth() });
    let server = await startServer(options());
    const clients: Client[] = [];
    // Everyone new wakes up at home, and reads the letter about their street there first.
    const hello = async (hi: { auth?: string; name?: string }) => {
      const c = await Client.open(server.port);
      clients.push(c);
      c.send({ t: 'hello', v: PROTOCOL_VERSION, ...hi });
      const welcome = await c.next('welcome');
      return { c, welcome, id: welcome.you };
    };
    const step = async (c: Client, dir: Dir) => {
      now += STEP_MS + 10;
      const n = ++seq;
      c.send({ t: 'step', dir, seq: n });
      return c.next('step', m => m.seq === n);
    };
    const go = async (c: Client, dirs: Dir[]) => {
      for (const dir of dirs) await step(c, dir);
    };
    try {
      const bob = await hello({ auth: 'bob@example.test', name: 'Bob' });
      const ann = await hello({ auth: 'ann@example.test', name: 'Ann' });
      const gus = await hello({ name: 'Gus' });
      expect(gus.welcome.guest).toBe(true);
      for (const p of [bob, ann, gus]) expect(await p.c.next('streetLetter')).toEqual({ t: 'streetLetter', doorOff: false });
      await Promise.all([bob, ann, gus].map(p => p.c.settle()));

      // A guest keeps his door to himself: saved at once.
      gus.c.send({ t: 'doorOff', off: true });
      expect(await gus.c.next('doorOff')).toEqual({ t: 'doorOff', off: true });
      await waitFor(() => storage.get(gus.id)?.doorOff === true, 'the setting to be saved');

      // Out on the street, Ann sees Bob home, and a resident where Gus lives.
      await go(ann.c, ['down', 'down']);
      const lane = await ann.c.next('zone');
      expect(lane.street).toEqual({ mine: 1, lots: [{ name: 'Bob', home: true }, { name: 'Ann' }, {}] });
      // Bob keeps his too: Ann sees his plate go blank and his window dark.
      now += 10;
      bob.c.send({ t: 'doorOff', off: true });
      expect(await ann.c.next('lot', m => m.lot === 0)).toEqual({ t: 'lot', lot: 0, view: {} });

      // Ann knocks at Bob's: nobody answers her, but Bob, at home, hears who knocked.
      await go(ann.c, ['left', 'left', 'left', 'left']);
      ann.c.send({ t: 'knock', x: 2, y: 2 });
      expect(await ann.c.next('door')).toEqual({ t: 'door', x: 2, y: 2, lot: {} });
      expect(await bob.c.next('knocked')).toEqual({ t: 'knocked', name: 'Ann' });
      // Friends, she knocks again: Bob is home.
      ann.c.send({ t: 'befriend', id: bob.id });
      await bob.c.next('friends', m => m.incoming.length === 1);
      bob.c.send({ t: 'answer', id: ann.id, yes: true });
      await ann.c.next('friends', m => m.friends.length === 1);
      now += KNOCK_EVERY_MS;
      ann.c.send({ t: 'knock', x: 2, y: 2 });
      expect(await ann.c.next('door')).toEqual({ t: 'door', x: 2, y: 2, lot: { name: 'Bob', home: true } });

      // A restart: Bob and Gus stay away, and their doors stay kept. Ann, back on the street, sees two residents.
      for (const c of clients.splice(0)) c.ws.terminate();
      await waitFor(() => server.world.size === 0, 'everyone to leave');
      await server.stop();
      server = await startServer(options());
      const back = await hello({ auth: 'ann@example.test' });
      expect(back.welcome.street).toEqual({ mine: 1, lots: [{}, { name: 'Ann' }, {}] });
      expect(back.welcome.doorOff).toBeUndefined();
      // Home again: the letter was read before, and never comes twice.
      await go(back.c, ['right', 'right', 'right', 'right', 'up']);
      expect(await back.c.next('zone')).toMatchObject({ map: { id: 'house' } });
      expect((await back.c.settle()).filter(m => m.t === 'streetLetter')).toEqual([]);
      expect(storage.get(ann.id)).toMatchObject({ streetTold: true });
      // Bob, back, finds his setting in his welcome.
      const bobBack = await hello({ auth: 'bob@example.test' });
      expect(bobBack.welcome.doorOff).toBe(true);
    } finally {
      for (const c of clients) c.ws.terminate();
      await server.stop();
    }
  });
});

describe('streets over the network', () => {
  it('give lots, open a new street when one is full, take you home and out to the right places, and keep neighbors to their own street', async () => {
    setLogLevel('silent');
    let now = 1_000_000;
    const storage = new MemoryStorage();
    const server = await startServer({ ...serverDefaults(), storage, maps: maps(), items: itemsData(), weather: 'overcast', clock: () => now });
    const clients: Client[] = [];
    const hello = async (hi: { token: string } | { name: string }) => {
      const c = await Client.open(server.port);
      clients.push(c);
      c.send({ t: 'hello', v: PROTOCOL_VERSION, ...hi });
      const welcome = await c.next('welcome');
      await c.next('friends');
      await c.next('tells');
      await c.settle();
      return { c, welcome, id: welcome.you };
    };
    // Signed in (so they may talk), in their cabins where they wake up, never home since streets came.
    const saved = (name: string) => savedPlayer(storage, { name, authSub: `dev:${name.toLowerCase()}@example.test`, map: 'house', x: 2, y: 2, dir: 'down' });
    const step = async (c: Client, dir: Dir) => {
      now += STEP_MS + 10;
      const n = ++seq;
      c.send({ t: 'step', dir, seq: n });
      return c.next('step', m => m.seq === n);
    };
    const go = async (c: Client, dirs: Dir[]) => {
      for (const dir of dirs) await step(c, dir);
    };
    try {
      const a = await hello(await saved('Ann'));
      const b = await hello(await saved('Bob'));
      const c = await hello(await saved('Cid'));
      // Someone new wakes up in a cabin of their own too: the first street is full, so theirs stands on a second.
      const d = await hello({ name: 'Dee' });
      expect(d.welcome).toMatchObject({ map: { id: 'house' }, players: [{ id: d.id, x: 2, y: 2, dir: 'down' }] });
      await waitFor(() => [a, b, c, d].every(p => storage.get(p.id)?.street !== undefined), 'the lots to be saved');
      expect([a, b, c, d].map(p => [storage.get(p.id)!.street, storage.get(p.id)!.lot])).toEqual([[1, 0], [1, 1], [1, 2], [2, 0]]);

      // Out of the cabin: on their own street, in front of their own door. Bob and Cid are home: their windows are lit.
      await go(a.c, ['down', 'down']);
      const za = await a.c.next('zone');
      expect(za).toMatchObject({ map: { id: 'lane' }, x: 2, y: 3, dir: 'down' });
      expect(za.street).toEqual({ mine: 0, lots: [{ name: 'Ann' }, { name: 'Bob', home: true }, { name: 'Cid', home: true }] });
      await go(b.c, ['down', 'down']);
      const zb = await b.c.next('zone');
      expect(zb).toMatchObject({ map: { id: 'lane' }, x: 6, y: 3, dir: 'down' });
      expect(zb.street).toEqual({ mine: 1, lots: [{ name: 'Ann' }, { name: 'Bob' }, { name: 'Cid', home: true }] });
      expect(zb.players.map(p => p.id).sort()).toEqual([a.id, b.id].sort());
      // Ann saw Bob's window go dark, and Bob come out.
      expect(await a.c.next('lot')).toEqual({ t: 'lot', lot: 1, view: { name: 'Bob' } });
      await a.c.next('join', m => m.player.id === b.id);
      await go(d.c, ['down', 'down']);
      const zd = await d.c.next('zone');
      expect(zd).toMatchObject({ map: { id: 'lane' }, x: 2, y: 3, dir: 'down' });
      expect(zd.street).toEqual({ mine: 0, lots: [{ name: 'Dee' }, null, null] });
      expect(zd.players.map(p => p.id)).toEqual([d.id]);
      await Promise.all([a, b, d].map(p => p.c.settle()));

      // Neighbors see and hear each other on their own street only: Dee stands where Ann stood, on another.
      await step(a.c, 'right');
      expect(await b.c.next('step', m => m.id === a.id)).toMatchObject({ x: 3, y: 3 });
      a.c.send({ t: 'say', to: 'local', text: 'evening, neighbor' });
      expect(await b.c.next('said')).toMatchObject({ id: a.id, text: 'evening, neighbor' });
      expect((await d.c.settle()).filter(m => m.t === 'said' || m.t === 'join' || (m.t === 'step' && m.id !== d.id))).toEqual([]);

      // Ann knocks at Cid's door: Cid, at home, hears it in his text box; Ann hears that Cid is home. Then she
      // walks in: Cid reads that she came in, and she sees his cabin as he made it. Out again, she stands at his door.
      await go(a.c, ['right', 'right', 'right', 'right', 'right', 'right', 'right']);
      a.c.send({ t: 'knock', x: 10, y: 2 });
      expect(await a.c.next('door')).toEqual({ t: 'door', x: 10, y: 2, lot: { name: 'Cid', home: true } });
      expect(await c.c.next('knocked')).toEqual({ t: 'knocked', name: 'Ann' });
      now += KNOCK_EVERY_MS;
      await step(a.c, 'up');
      expect(await a.c.next('zone')).toMatchObject({ map: { id: 'house' }, x: 2, y: 3, visit: { name: 'Cid', furniture: [], trophies: [] } });
      expect(await c.c.next('cameIn')).toEqual({ t: 'cameIn', name: 'Ann' });
      await step(a.c, 'down');
      expect(await a.c.next('zone')).toMatchObject({ map: { id: 'lane' }, x: 10, y: 3, dir: 'down' });

      // Bob walks out at the lane's end into town, then back up the road onto the street: where it comes in,
      // not at his door. Two steps more and he is home, and Ann sees his window light.
      await go(b.c, ['down', 'down']);
      expect(await b.c.next('zone')).toMatchObject({ map: { id: 'town' }, x: 7, y: 3, dir: 'down' });
      await step(b.c, 'up');
      const back = await b.c.next('zone');
      expect(back).toMatchObject({ map: { id: 'lane' }, x: 6, y: 4, dir: 'up', street: { mine: 1 } });
      await go(b.c, ['up', 'up']);
      expect(await b.c.next('zone')).toMatchObject({ map: { id: 'house' }, x: 2, y: 3 });
      expect(await a.c.next('lot', m => m.lot === 1 && m.view?.home === true)).toEqual({ t: 'lot', lot: 1, view: { name: 'Bob', home: true } });

      // Friends move next to each other: Cid and Dee become friends, and at his own door (his street is full)
      // Cid moves next to Dee, onto her street: to the free lot nearest hers, his cabin with him.
      c.c.send({ t: 'befriend', id: d.id });
      await d.c.next('friends', m => m.incoming.length === 1);
      d.c.send({ t: 'answer', id: c.id, yes: true });
      await c.c.next('friends', m => m.friends.length === 1);
      await go(c.c, ['down', 'down']);
      expect(await c.c.next('zone')).toMatchObject({ map: { id: 'lane' }, x: 10, y: 3 });
      c.c.send({ t: 'knock', x: 10, y: 2 });
      expect(await c.c.next('doorstep')).toEqual({ t: 'doorstep', moves: [{ id: d.id, name: 'Dee' }] });
      c.c.send({ t: 'move', to: d.id });
      const moved = await c.c.next('zone');
      expect(moved).toMatchObject({ map: { id: 'lane' }, x: 6, y: 3, dir: 'down' });
      expect(moved.street).toEqual({ mine: 1, lots: [{ name: 'Dee' }, { name: 'Cid' }, null] });
      expect(moved.players.map(p => p.id).sort()).toEqual([c.id, d.id].sort());
      expect(await c.c.next('did')).toEqual({ t: 'did', did: { kind: 'moved', name: 'Dee' } });
      expect(await a.c.next('lot', m => m.lot === 2 && m.view === null)).toEqual({ t: 'lot', lot: 2, view: null });
      expect(await d.c.next('lot', m => m.lot === 1)).toEqual({ t: 'lot', lot: 1, view: { name: 'Cid' } });
      await waitFor(() => storage.get(c.id)?.street === 2, 'the move to be saved');
      expect(storage.get(c.id)).toMatchObject({ street: 2, lot: 1 });
    } finally {
      for (const c of clients) c.ws.terminate();
      await server.stop();
    }
  });

  it('still wakes you inside your cabin after a collapse, and keeps who lives where through a restart', async () => {
    setLogLevel('silent');
    let now = 1_000_000;
    const storage = new MemoryStorage();
    const options = () => ({ ...serverDefaults(), storage, maps: maps(), items: itemsData(), weather: 'overcast' as const, clock: () => now });
    // Out in the woods, nearly spent; their cabin stands on the third lot of the first street.
    const a = await savedPlayer(storage, { map: 'woods', x: 3, y: 6, dir: 'up', energy: 0.1, street: 1, lot: 2 });
    const clients: Client[] = [];
    const first = await startServer(options());
    try {
      const { c } = await loginTo(first.port, a.token);
      clients.push(c);
      now += 60_000;
      expect(await c.next('zone')).toMatchObject({ map: { id: 'house' }, x: 2, y: 2, dir: 'down', reason: 'collapse' });
      expect(first.world.zoneOf(a.id)).toBe(zoneKey('house', a.id));
      expect(first.world.get(a.id)).toMatchObject({ street: 1, lot: 2 });
      c.ws.terminate();
      await waitFor(() => first.world.size === 0, 'a to leave');
    } finally {
      await first.stop();
    }
    const second = await startServer(options());
    try {
      // a's lot is still a's: someone new gets the first lot that is free.
      const n = await savedPlayer(storage, { map: 'house', x: 2, y: 2, dir: 'down' });
      const { c } = await loginTo(second.port, n.token);
      clients.push(c);
      await waitFor(() => storage.get(n.id)?.street !== undefined, 'the newcomer\'s lot to be saved');
      expect([storage.get(n.id)!.street, storage.get(n.id)!.lot]).toEqual([1, 0]);
      expect([storage.get(a.id)!.street, storage.get(a.id)!.lot]).toEqual([1, 2]);
    } finally {
      for (const c of clients) c.ws.terminate();
      await second.stop();
    }
  });
});
