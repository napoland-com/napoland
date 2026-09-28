/**
 * Your street and your neighbors: every player's cabin stands on a lot of a street, a copy of the street's
 * map; players are given the first free lot as they first come home, and a new street opens when the
 * others are full. The road onto the street from town comes in where it comes in, and out of a cabin you
 * stand in front of its door; other doors are knocked at, or walked into (visits.test.ts). World rules
 * first, then over real WebSockets.
 *
 * The fixture world: the town (fixtures.ts, without its house), whose road off its bottom edge at 4,7 and
 * 5,7 leads onto a lane of three lots, where it comes in (6,4); each lot's door leads into the home, a
 * private room where you wake up by the fire; the lane's end leads back onto that road, at the town's 4,6.
 *
 *   lane (13x6, a street)              home (5x5, private)
 *     0123456789012                      01234
 *   0 ttttttttttttt                    0 xxxxx
 *   1 tHHHgHHHgHHHt                    1 xpFHx   F fire (2,1), H chest (3,1)
 *   2 tHDHgHDHgHDHt  D the lots' doors 2 xpzpx   z where you wake up (2,2)
 *   3 tgggggggggggt  0 (2,2), 1 (6,2), 3 xpppx   2,3: where every lot's door leads in
 *   4 tgggggggggggt  2 (10,2)          4 xxpxx   2,4: out onto the lane, in front of that lot's door
 *   5 ttttttggttttt  6,5 and 7,5: the lane's end, to the town's 4,6
 */
import { describe, expect, it } from 'vitest';
import { ENERGY_MAX, PROTOCOL_VERSION, STEP_MS, TileMap, lotDoors, validateMap, validateWorld, type Dir, type MapData, type ServerMsg } from '@napoland/shared';
import { setLogLevel } from '../src/log';
import { startServer } from '../src/server';
import { MemoryStorage, type LotRecord, type PlayerRecord } from '../src/storage';
import { devAuth } from '../src/auth';
import { DOOR_EVERY_MS, KNOCK_EVERY_MS, MOVE_EVERY_MS, World, colorFor, zoneKey, type Outgoing } from '../src/world';
import { itemsData, laneData, streetTownData, townData, woodsData } from './fixtures';
import { Client, loginTo, nobodyCame, savedPlayer, serverDefaults, waitFor } from './helpers';

/** The town with its road onto the lane, and the lane (fixtures.ts). */
const town = streetTownData, lane = laneData;

function home(): MapData {
  return {
    id: 'house', name: 'Home', version: 1, kind: 'inside', depth: 0, width: 5, height: 5,
    tiles: ['xxxxx', 'xpppx', 'xpppx', 'xpppx', 'xxpxx'],
    levels: Array<string>(5).fill('00000'),
    spawn: { x: 2, y: 3, dir: 'up' },
    exits: [{ x: 2, y: 4, w: 1, h: 1, to: 'lane', tx: 2, ty: 3, dir: 'down' }],
    objects: [{ kind: 'fireplace', x: 2, y: 1 }, { kind: 'chest', x: 3, y: 1 }],
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
const lot = (id: string, street: number, n: number, off = false): LotRecord => ({ id, name: id.toUpperCase(), street, lot: n, ...(off && { off: true as const }) });

function world(lots: LotRecord[] = [], friends: Record<string, string[]> = {}): World {
  const w = new World(maps(), 'town', 'overcast', { items: itemsData(), rng: () => 0, lots });
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
  it('follow the content rules: a street whose every door leads into the home, reached by a road off the edge of the town', () => {
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
    w.join(rec('y', 'town', 4, 6, 'down', { street: 1, lot: 0 }), 0);
    expect(w.get('y')!.street).toBeUndefined();
    w.step('y', 'down', ++seq, 1000);
    expect(w.zoneOf('y')).toBe(LANE(2));
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

  it('keep you out of a lot nobody lives on: the step comes back, and its door says so', () => {
    const w = world([lot('a', 1, 0), lot('b', 1, 1)]);
    w.join(rec('a', 'lane', 10, 3, 'up'), 0);
    w.returned('a', 0);
    w.drain();
    walk(w, 'a', ['up'], 1000);
    const out = to(w.drain(), 'a');
    expect(of(out, 'reject')).toEqual([{ t: 'reject', seq, x: 10, y: 3, dir: 'up' }]);
    expect(of(out, 'door')).toEqual([{ t: 'door', x: 10, y: 2, lot: null, closed: true }]);
    expect(w.zoneOf('a')).toBe(LANE(1));
  });

  it('are reached from town by the road, where it comes in, on your own street; out of the cabin you stand in front of your door', () => {
    const w = world([lot('a', 1, 1), lot('b', 2, 0)]);
    w.join(rec('a', 'town', 4, 6, 'down'), 0);
    w.join(rec('b', 'town', 5, 6, 'down'), 0);
    walk(w, 'a', ['down'], 1000);
    expect(w.zoneOf('a')).toBe(LANE(1));
    expect(w.get('a')).toMatchObject({ map: 'lane', x: 6, y: 4, dir: 'up' });
    // Two tiles wide, like every road: the other lane of it comes in a tile over, on b's own street.
    walk(w, 'b', ['down'], 1000);
    expect(w.zoneOf('b')).toBe(LANE(2));
    expect(w.get('b')).toMatchObject({ map: 'lane', x: 7, y: 4, dir: 'up' });
    // a walks to their own door and in, and out again: in front of it. The lane's end leads back into town.
    walk(w, 'a', ['up', 'up'], 2000);
    expect(w.zoneOf('a')).toBe(zoneKey('house', 'a'));
    walk(w, 'a', ['down'], 3000);
    expect(w.get('a')).toMatchObject({ map: 'lane', x: 6, y: 3, dir: 'down' });
    walk(w, 'a', ['down', 'down'], 4000);
    expect(w.get('a')).toMatchObject({ map: 'town', x: 4, y: 6, dir: 'up' });
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

  it('waits until a new player\'s first steps are done: one thing at a time', () => {
    const w = world([lot('a', 1, 0)]);
    w.join(rec('a', 'house', 2, 2, 'down', { zone: 'a', firstSteps: 1 }), 0);
    w.returned('a', 0);
    expect(of(to(w.drain(), 'a'), 'streetLetter')).toEqual([]);
    // Done with them (as on coming home with a first find), the next time home brings it.
    w.join({ ...w.leave('a', 1000)!, firstSteps: undefined }, 2000);
    w.returned('a', 2000);
    expect(of(to(w.drain(), 'a'), 'streetLetter')).toEqual([{ t: 'streetLetter', doorOff: false }]);
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
    // Everyone new wakes up at home; the letter about their street waits until their first steps are done.
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
      // New players read the street's letter once their first steps are done, not on waking up.
      for (const p of [bob, ann, gus]) expect((await p.c.settle()).filter(m => m.t === 'streetLetter')).toEqual([]);

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
      // Home again, still in her first steps: the letter still waits.
      await go(back.c, ['right', 'right', 'right', 'right', 'up']);
      expect(await back.c.next('zone')).toMatchObject({ map: { id: 'house' } });
      expect((await back.c.settle()).filter(m => m.t === 'streetLetter')).toEqual([]);
      expect(storage.get(ann.id)?.streetTold).toBeUndefined();
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

      // Ann knocks at Cid's door: Cid, at home, hears it in his text box; Ann hears that Cid is home.
      await go(a.c, ['right', 'right', 'right', 'right', 'right', 'right', 'right']);
      a.c.send({ t: 'knock', x: 10, y: 2 });
      expect(await a.c.next('door')).toEqual({ t: 'door', x: 10, y: 2, lot: { name: 'Cid', home: true } });
      expect(await c.c.next('knocked')).toEqual({ t: 'knocked', name: 'Ann' });
      // Then she walks in: Cid's cabin, not hers, and Cid reads that she came in. Out again, she stands in front of his door.
      await step(a.c, 'up');
      expect(await a.c.next('zone')).toMatchObject({ map: { id: 'house' }, x: 2, y: 3, visit: { name: 'Cid', trophies: [] } });
      expect(await c.c.next('visited')).toEqual({ t: 'visited', name: 'Ann' });
      expect(server.world.zoneOf(a.id)).toBe(zoneKey('house', c.id));
      await step(a.c, 'down');
      expect(await a.c.next('zone')).toMatchObject({ map: { id: 'lane' }, x: 10, y: 3, dir: 'down', street: { mine: 0 } });

      // Bob walks out at the lane's end into town, then back along the road: onto his own street where the
      // road comes in. Two steps more and he is home, and Ann sees his window light.
      await go(b.c, ['down', 'down']);
      expect(await b.c.next('zone')).toMatchObject({ map: { id: 'town' }, x: 4, y: 6, dir: 'up' });
      await step(b.c, 'down');
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
      // Down first (rescue.ts), and nobody comes.
      await nobodyCame(c, ms => { now += ms; });
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
