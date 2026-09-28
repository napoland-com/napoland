/**
 * Visits and NAPO's teleport (roadmap/street-visits.md). A neighbor's door lets you into their cabin when
 * they let their neighbors in, or you are friends, and never with a block either way; inside, you see what
 * they made of it (their furniture, and what their trophy shelf shows), whether they are home or not, while
 * their chest and workbench stay theirs, and so does being cozy by their fire. A at NAPO's teleport in any
 * cabin sets you down in town, in front of its twin. World rules first, then over real WebSockets.
 *
 * The fixture world: the town with its road onto the lane of three lots (fixtures.ts), NAPO's teleport in
 * town at 8,5; and a cabin roomier than streets.test.ts's:
 *
 *   home (7x5, private)
 *     0123456
 *   0 xxxxxxx
 *   1 xWFHTsx   W workbench (1,1), F fire (2,1), H chest (3,1), T teleport (4,1), s the shelf's place (5,1)
 *   2 xpzpppx   z where you wake up (2,2); 1,2 to 3,2 are warm
 *   3 xoppppx   o the stove's place (1,3); 2,3: where every lot's door leads in
 *   4 xxpxxxx   2,4: out onto the lane, in front of that lot's door
 */
import { describe, expect, it } from 'vitest';
import {
  COZY_AFTER_S, ENERGY_MAX, PROTOCOL_VERSION, STEP_MS, TileMap, validateMap, validateWorld, type Dir, type ItemsData, type MapData, type ServerMsg,
} from '@napoland/shared';
import { setLogLevel } from '../src/log';
import { startServer } from '../src/server';
import { MemoryStorage, type LotRecord, type PlayerRecord } from '../src/storage';
import { DOOR_EVERY_MS, World, colorFor, zoneKey, type Outgoing } from '../src/world';
import { itemsData, laneData, streetTownData, woodsData } from './fixtures';
import { Client, loginTo, savedPlayer, serverDefaults, waitFor } from './helpers';

function home(): MapData {
  return {
    id: 'house', name: 'Home', version: 1, kind: 'inside', depth: 0, width: 7, height: 5,
    tiles: ['xxxxxxx', 'xpppppx', 'xpppppx', 'xpppppx', 'xxpxxxx'],
    levels: Array<string>(5).fill('0000000'),
    spawn: { x: 2, y: 3, dir: 'up' },
    exits: [{ x: 2, y: 4, w: 1, h: 1, to: 'lane', tx: 2, ty: 3, dir: 'down' }],
    objects: [
      { kind: 'workbench', x: 1, y: 1 }, { kind: 'fireplace', x: 2, y: 1 }, { kind: 'chest', x: 3, y: 1 }, { kind: 'teleport', x: 4, y: 1 },
      { kind: 'comfort', x: 5, y: 1, what: 'shelf' }, { kind: 'comfort', x: 1, y: 3, what: 'stove' },
    ],
    private: true,
    wake: { x: 2, y: 2, dir: 'down' },
  };
}

const maps = () => [new TileMap(streetTownData()), new TileMap(laneData()), new TileMap(home()), new TileMap(woodsData())];

/** The fixture items, with a stove, a trophy shelf and a drying rack to make, and a charm and a piece of anomalous gear to show on the shelf. */
function items(): ItemsData {
  const base = itemsData();
  return {
    ...base,
    items: [
      ...base.items,
      { id: 'stove', name: 'Iron stove', kind: 'furniture', stack: 1, furnishes: 'stove', comfort: 3, text: 'Warm.', spoiled: 'Rusted.' },
      { id: 'shelf', name: 'Trophy shelf', kind: 'furniture', stack: 1, furnishes: 'shelf', comfort: 1, text: 'Strange things.', spoiled: 'Warped.' },
      { id: 'rack', name: 'Drying rack', kind: 'furniture', stack: 1, furnishes: 'rack', comfort: 2, dries: true, text: 'Dry.', spoiled: 'Broken.' },
      { id: 'pebble', name: 'Warm pebble', kind: 'charm', stack: 1, charm: { wetting: 0.6 }, text: 'It never cools.' },
      { id: 'shard-cap', name: 'Shard-lined cap', kind: 'gear', stack: 1, slot: 'cap', tier: 'anomalous', text: 'It hums.' },
    ],
    recipes: [{ id: 'stove', make: 'stove', needs: [{ item: 'nail', count: 4 }] }],
  };
}

const rec = (id: string, map: string, x: number, y: number, dir: Dir = 'up', more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map, x, y, dir, color: colorFor(id), energy: ENERGY_MAX, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});
const lot = (id: string, n: number, more: Partial<LotRecord> = {}): LotRecord => ({ id, name: id.toUpperCase(), street: 1, lot: n, ...more });
/** The first street's copy of the lane, and the x of each lot's door (on y 2; its doorstep on y 3). */
const LANE = zoneKey('lane', '1');
const DOORS = [2, 6, 10] as const;
const IN_B = zoneKey('house', 'b');

function world(lots: LotRecord[], friends: Record<string, string[]> = {}, crowd?: { town: number }): World {
  const w = new World(maps(), 'town', 'overcast', { items: items(), rng: () => 0, lots, ...(crowd && { crowd }) });
  w.friends = id => new Set(friends[id] ?? []);
  return w;
}
/** In front of lot n's door, facing it, settled in: whom they block, and who blocks them, is known (World.returned). */
function onLane(w: World, id: string, n: number): void {
  w.join(rec(id, 'lane', DOORS[n]!, 3, 'up'), 0);
  w.returned(id, 0);
}
/** At home in their own cabin, at x,y. */
function atHome(w: World, id: string, x = 2, y = 2, more: Partial<PlayerRecord> = {}): void {
  w.join(rec(id, 'house', x, y, 'down', { zone: id, ...more }), 0);
  w.returned(id, 0);
}
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id ? [o.msg] : []));
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

/**
 * A world of these lots where a (on lot 0) stands in front of lot n's door and steps into it: where a is
 * then, and what a heard. `blocks` and `blockedBy` stand in for social.ts, as `friends` does.
 */
function tryDoor(lots: LotRecord[], n: number, o: { friends?: Record<string, string[]>; blocks?: Record<string, string[]>; blockedBy?: Record<string, string[]>; known?: boolean } = {}) {
  const w = world(lots, o.friends);
  if (o.blocks) w.blocks = id => new Set(o.blocks![id] ?? []);
  if (o.blockedBy) w.blockedBy = id => new Set(o.blockedBy![id] ?? []);
  w.join(rec('a', 'lane', DOORS[n]!, 3, 'up'), 0);
  if (o.known !== false) w.returned('a', 0);
  w.drain();
  walk(w, 'a', ['up'], 1000);
  return { zone: w.zoneOf('a'), heard: to(w.drain(), 'a') };
}

describe('the fixtures', () => {
  it('follow the content rules: a cabin with a teleport, and its twin in town', () => {
    for (const m of [streetTownData(), laneData(), home()]) expect(validateMap(m).filter(p => p.level === 'error'), m.id).toEqual([]);
    expect(validateWorld([streetTownData(), laneData(), home(), woodsData()], 'town').filter(p => p.level === 'error')).toEqual([]);
  });
});

describe('a neighbor\'s cabin', () => {
  it('lets you in, theirs and not yours, with what they made of it, from storage while they are away', () => {
    // B is away: their furniture, and the charms and anomalous gear their stash holds, came with the lots.
    const w = world([lot('a', 0), lot('b', 1, { furniture: ['stove', 'shelf'], stash: { items: { moss: 3, pebble: 1, 'shard-cap': 2 }, out: {} } })]);
    onLane(w, 'a', 1);
    w.drain();
    walk(w, 'a', ['up'], 1000);
    expect(w.zoneOf('a')).toBe(IN_B);
    const [z] = of(to(w.drain(), 'a'), 'zone');
    // Each trophy once, in the order the chest lists them; never a's own furniture.
    expect(z).toMatchObject({ map: { id: 'house' }, x: 2, y: 3, dir: 'up', furniture: ['stove', 'shelf'], visit: { name: 'B', trophies: ['pebble', 'shard-cap'] } });
    // With no shelf made, the shelf shows nothing, whatever the stash holds.
    const bare = world([lot('a', 0), lot('b', 1, { furniture: ['stove'], stash: { items: { pebble: 1 }, out: {} } })]);
    onLane(bare, 'a', 1);
    bare.drain();
    walk(bare, 'a', ['up'], 1000);
    expect(of(to(bare.drain(), 'a'), 'zone')[0]).toMatchObject({ furniture: ['stove'], visit: { name: 'B', trophies: [] } });
  });

  it('shows what its owner made as it stands while they are home, and as it stood when they left', () => {
    const w = world([lot('a', 0), lot('b', 1, { furniture: [], stash: { items: {}, out: {} } })]);
    atHome(w, 'b', 1, 2, { furniture: ['shelf'], stash: { items: { nail: 4, pebble: 1 }, out: {} } });
    onLane(w, 'a', 1);
    w.drain();
    walk(w, 'a', ['up'], 1000);
    let out = w.drain();
    expect(of(to(out, 'a'), 'zone')[0]).toMatchObject({ furniture: ['shelf'], visit: { name: 'B', trophies: ['pebble'] } });
    // B, at home, reads who came in.
    expect(to(out, 'b')).toEqual([{ t: 'visited', name: 'A' }]);
    // B makes a stove at the workbench while a looks round: it stands there for both at once.
    w.craft('b', 1, 1, 'stove', 2000);
    out = w.drain();
    expect(of(to(out, 'a'), 'furniture')).toEqual([{ t: 'furniture', furniture: ['shelf', 'stove'] }]);
    expect(of(to(out, 'b'), 'furniture')).toEqual([{ t: 'furniture', furniture: ['shelf', 'stove'] }]);
    // Out again: in front of B's door, on a's own street, facing away from it.
    walk(w, 'a', ['down'], 3000);
    expect(w.zoneOf('a')).toBe(LANE);
    expect(w.get('a')).toMatchObject({ map: 'lane', x: 6, y: 3, dir: 'down' });
    // B leaves the game: a, walking back in, finds the cabin as B left it.
    w.leave('b', 4000);
    w.drain();
    walk(w, 'a', ['up'], 5000);
    expect(of(to(w.drain(), 'a'), 'zone')[0]).toMatchObject({ furniture: ['shelf', 'stove'], visit: { name: 'B', trophies: ['pebble'] } });
  });

  it('is for looking: its chest and workbench answer only their owner, not_yours, and tell a visitor nothing', () => {
    const w = world([lot('a', 0), lot('b', 1, { stash: { items: { moss: 3 }, out: {} } })]);
    onLane(w, 'a', 1);
    let at = walk(w, 'a', ['up', 'up', 'right'], 1000);
    expect(w.get('a')).toMatchObject({ map: 'house', x: 3, y: 2 });
    w.drain();
    w.chest('a', 3, 1, at);
    expect(to(w.drain(), 'a')).toEqual([]);
    w.store('a', 3, 1, undefined, at);
    w.take('a', 3, 1, 'moss', 1, at);
    expect(of(to(w.drain(), 'a'), 'refused')).toEqual([{ t: 'refused', action: 'store', reason: 'not_yours' }, { t: 'refused', action: 'take', reason: 'not_yours' }]);
    at = walk(w, 'a', ['left', 'left'], at);
    w.drain();
    w.bench('a', 1, 1, at);
    w.craft('a', 1, 1, 'stove', at);
    expect(to(w.drain(), 'a')).toEqual([{ t: 'refused', action: 'craft', reason: 'not_yours' }]);
  });

  it('never makes a visitor cozy by its fire, however long they stand there; its owner, beside them, is', () => {
    const w = world([lot('a', 0), lot('b', 1)]);
    atHome(w, 'b', 1, 2);
    onLane(w, 'a', 1);
    walk(w, 'a', ['up', 'up'], 1000);
    expect(w.get('a')).toMatchObject({ map: 'house', x: 2, y: 2 });
    w.tick(5000);
    w.tick(5000 + (COZY_AFTER_S + 60) * 1000);
    expect(w.get('a')!.cozy).toBeUndefined();
    expect(w.get('b')!.cozy).toBeDefined();
  });

  it('brings a visitor who drops back in front of its door, on their own street, never inside', () => {
    const w = world([lot('a', 0), lot('b', 1)]);
    onLane(w, 'a', 1);
    walk(w, 'a', ['up'], 1000);
    const saved = w.leave('a', 2000)!;
    expect(saved).toMatchObject({ map: 'house', zone: 'b' });
    const back = w.join(saved, 3000);
    expect(back.map.id).toBe('lane');
    expect(back.visit).toBeUndefined();
    expect(w.zoneOf('a')).toBe(LANE);
    expect(w.get('a')).toMatchObject({ map: 'lane', x: 6, y: 3, dir: 'down' });
  });

  it('is no homecoming: a trip ends in your own cabin, not a neighbor\'s', () => {
    const w = world([lot('a', 0), lot('b', 1)]);
    w.join(rec('a', 'woods', 3, 6, 'up'), 0);
    w.returned('a', 0);
    // Out in the woods for a trip: up and down, a dozen steps.
    let at = walk(w, 'a', ['up', 'down', 'up', 'down', 'up', 'down', 'up', 'down', 'up', 'down', 'up', 'down'], 1000);
    // Home by the road, well over half a minute on: out of the woods, down through town and off its edge onto the lane, and in at B's.
    at = walk(w, 'a', ['down', 'down', 'down', 'down', 'down', 'down', 'down', 'up', 'up'], Math.max(at, 40_000));
    expect(w.zoneOf('a')).toBe(IN_B);
    expect(of(to(w.drain(), 'a'), 'trip')).toEqual([]);
    // Then home: out, along the lane to a's own door, and in.
    walk(w, 'a', ['down', 'left', 'left', 'left', 'left', 'up'], at);
    expect(w.zoneOf('a')).toBe(zoneKey('house', 'a'));
    expect(of(to(w.drain(), 'a'), 'trip')).toHaveLength(1);
  });
});

describe('who comes in', () => {
  it('is anyone on the street, until its owner lets only friends in or keeps their door to themselves; a friend always', () => {
    expect(tryDoor([lot('a', 0), lot('b', 1)], 1).zone).toBe(IN_B);
    // Only friends: the step comes back, and the door says whose it is and that it stayed shut.
    const closed = tryDoor([lot('a', 0), lot('b', 1, { closed: true })], 1);
    expect(closed.zone).toBe(LANE);
    expect(of(closed.heard, 'reject')).toHaveLength(1);
    expect(of(closed.heard, 'door')).toEqual([{ t: 'door', x: 6, y: 2, lot: { name: 'B' }, closed: true }]);
    // A door kept to oneself lets only friends in too, and says no name.
    const off = tryDoor([lot('a', 0), lot('b', 1, { off: true })], 1);
    expect(off.zone).toBe(LANE);
    expect(of(off.heard, 'door')).toEqual([{ t: 'door', x: 6, y: 2, lot: {}, closed: true }]);
    // Friends come in, asked both ways.
    expect(tryDoor([lot('a', 0), lot('b', 1, { closed: true })], 1, { friends: { a: ['b'] } }).zone).toBe(IN_B);
    expect(tryDoor([lot('a', 0), lot('b', 1, { off: true, closed: true })], 1, { friends: { b: ['a'] } }).zone).toBe(IN_B);
    // A lot nobody lives on, never.
    const empty = tryDoor([lot('a', 0)], 1);
    expect(empty.zone).toBe(LANE);
    expect(of(empty.heard, 'door')).toEqual([{ t: 'door', x: 6, y: 2, lot: null, closed: true }]);
  });

  it('is never someone blocked, either way, friends or not; nor anyone before whom they block is known', () => {
    expect(tryDoor([lot('a', 0), lot('b', 1)], 1, { blocks: { a: ['b'] } }).zone).toBe(LANE);
    expect(tryDoor([lot('a', 0), lot('b', 1)], 1, { blocks: { b: ['a'] } }).zone).toBe(LANE);
    // B, away, blocks a: the World knows it from a's side (who blocks a, from social.ts), friends or not.
    expect(tryDoor([lot('a', 0), lot('b', 1)], 1, { blockedBy: { a: ['b'] }, friends: { a: ['b'] } }).zone).toBe(LANE);
    // Just back in the game, before social.ts has read whom a blocks and who blocks a: no door lets a in yet.
    expect(tryDoor([lot('a', 0), lot('b', 1)], 1, { known: false }).zone).toBe(LANE);
  });

  it('sends out whoever may no longer be in, the moment its owner closes it or a block comes between them; a friend stays', () => {
    const blocking = new Map<string, Set<string>>();
    const w = world([lot('a', 0), lot('b', 1), lot('c', 2)], { c: ['b'] });
    w.blocks = id => blocking.get(id) ?? new Set();
    atHome(w, 'b', 1, 2);
    onLane(w, 'a', 1);
    onLane(w, 'c', 1);
    walk(w, 'a', ['up'], 1000);
    walk(w, 'c', ['up'], 1000);
    expect([w.zoneOf('a'), w.zoneOf('c')]).toEqual([IN_B, IN_B]);
    w.drain();
    w.takeWrites();
    // B lets only friends in: a is out on the street at once, in front of B's door; c, a friend, stays.
    w.visitsOff('b', true, 2000);
    const out = w.drain();
    expect(to(out, 'b')).toContainEqual({ t: 'visitsOff', off: true });
    expect(of(to(out, 'a'), 'zone')[0]).toMatchObject({ map: { id: 'lane' }, x: 6, y: 3, dir: 'down', street: { mine: 0 } });
    expect(w.zoneOf('a')).toBe(LANE);
    expect(w.zoneOf('c')).toBe(IN_B);
    // Saved at once, and a, walking back into the door, is turned away.
    expect(w.takeWrites().players.find(p => p.id === 'b')).toMatchObject({ visitsOff: true });
    walk(w, 'a', ['up'], 3000);
    expect(w.zoneOf('a')).toBe(LANE);
    // c blocks B, friends no more: net.ts has the World keep out whoever that keeps out.
    blocking.set('c', new Set(['b']));
    w.keepOut('b', 4000);
    expect(w.zoneOf('c')).toBe(LANE);
    expect(w.get('c')).toMatchObject({ map: 'lane', x: 6, y: 3, dir: 'down' });
  });

  it('is a setting of its own: saved at once, changed once in a while, with the lot, a move and the welcome', () => {
    const w = world([lot('a', 0), lot('b', 1), lot('e', 0, { street: 2 }), lot('f', 2, { street: 2 })], { b: ['e'] });
    atHome(w, 'b');
    w.drain();
    w.takeWrites();
    w.visitsOff('b', true, 1000);
    expect(to(w.drain(), 'b')).toEqual([{ t: 'visitsOff', off: true }]);
    expect(w.takeWrites().players.find(p => p.id === 'b')).toMatchObject({ visitsOff: true });
    // Too soon: nothing changes, and B hears it as it stands.
    w.visitsOff('b', false, 1500);
    expect(to(w.drain(), 'b')).toEqual([{ t: 'visitsOff', off: true }]);
    w.visitsOff('b', false, 1000 + DOOR_EVERY_MS);
    expect(to(w.drain(), 'b')).toEqual([{ t: 'visitsOff', off: false }]);
    expect(w.get('b')!.visitsOff).toBeUndefined();
    // Closed again, then moved next to a friend: the cabin on its new lot lets only friends in still.
    w.visitsOff('b', true, 1000 + 2 * DOOR_EVERY_MS);
    walk(w, 'b', ['down', 'down'], 1000 + 2 * DOOR_EVERY_MS);
    w.moveNextTo('b', 'e', 2000 + 2 * DOOR_EVERY_MS);
    expect(w.get('b')).toMatchObject({ street: 2, lot: 1, visitsOff: true });
    // f, B's new neighbor there, is turned away.
    w.join(rec('f', 'lane', 6, 3, 'up'), 0);
    w.returned('f', 0);
    w.drain();
    walk(w, 'f', ['up'], 3000 + 2 * DOOR_EVERY_MS);
    expect(w.zoneOf('f')).toBe(zoneKey('lane', '2'));
    expect(of(to(w.drain(), 'f'), 'door')).toEqual([{ t: 'door', x: 6, y: 2, lot: { name: 'B' }, closed: true }]);
    // Back in the game, the welcome says it; saved as anything but true, it is not kept.
    expect(w.join(rec('g', 'town', 1, 2, 'down', { visitsOff: true }), 0).visitsOff).toBe(true);
    w.join(rec('h', 'town', 1, 2, 'down', { visitsOff: 1 as unknown as true }), 0);
    expect(w.get('h')!.visitsOff).toBeUndefined();
  });
});

describe('NAPO\'s teleport', () => {
  it('sets you down in town, in front of its twin, from your own cabin or a neighbor\'s', () => {
    const w = world([lot('a', 0), lot('b', 1), lot('c', 2)]);
    atHome(w, 'a', 4, 2);
    w.drain();
    w.teleport('a', 4, 1, 1000);
    expect(w.zoneOf('a')).toBe(zoneKey('town', ''));
    expect(w.get('a')).toMatchObject({ map: 'town', x: 8, y: 6, dir: 'down' });
    expect(of(to(w.drain(), 'a'), 'zone')[0]).toMatchObject({ map: { id: 'town' }, x: 8, y: 6, dir: 'down', reason: 'exit' });
    // c, looking round B's cabin, goes the same way.
    onLane(w, 'c', 1);
    const at = walk(w, 'c', ['up', 'up', 'right', 'right'], 2000);
    expect(w.get('c')).toMatchObject({ map: 'house', x: 4, y: 2 });
    w.teleport('c', 4, 1, at);
    expect(w.get('c')).toMatchObject({ map: 'town', x: 8, y: 6, dir: 'down' });
  });

  it('works only from the tile in front of one in a cabin: not from farther, not at the chest, and the one in town only receives', () => {
    const w = world([lot('a', 0)]);
    atHome(w, 'a', 3, 2);
    w.join(rec('t', 'town', 8, 6, 'up'), 0);
    w.drain();
    w.teleport('a', 4, 1, 1000);
    w.teleport('a', 3, 1, 1000);
    w.teleport('t', 8, 5, 1000);
    const out = w.drain();
    expect(to(out, 'a')).toEqual([{ t: 'refused', action: 'teleport', reason: 'too_far' }, { t: 'refused', action: 'teleport', reason: 'too_far' }]);
    expect(to(out, 't')).toEqual([{ t: 'refused', action: 'teleport', reason: 'too_far' }]);
    expect([w.zoneOf('a'), w.zoneOf('t')]).toEqual([zoneKey('house', 'a'), zoneKey('town', '')]);
  });

  it('goes into the copy of town walking in would: where your friends are, if it has room', () => {
    const w = world([lot('a', 0), lot('n', 1)], { a: ['f'] }, { town: 2 });
    w.join(rec('x', 'town', 1, 3), 0);
    w.join(rec('y', 'town', 2, 3), 0);
    w.join(rec('f', 'town', 3, 3), 0);
    expect(w.zoneOf('f')).toBe(zoneKey('town', '2'));
    w.leave('y', 0);
    atHome(w, 'a', 4, 2);
    atHome(w, 'n', 4, 2);
    w.teleport('a', 4, 1, 1000);
    expect(w.zoneOf('a')).toBe(zoneKey('town', '2'));
    // Someone with no friends there goes into the first copy with room: the main one.
    w.teleport('n', 4, 1, 1000);
    expect(w.zoneOf('n')).toBe(zoneKey('town', ''));
  });

  it('leaves you wet or dry as walking out would: the drying rack dries its owner, not a visitor', () => {
    const w = world([lot('a', 0), lot('c', 2)]);
    atHome(w, 'a', 4, 2, { furniture: ['rack'], wet: 0.6 });
    w.teleport('a', 4, 1, 1000);
    expect(w.get('a')!.wet).toBe(0);
    // c, wet, looks round a's cabin, the rack and all, and goes the same way.
    w.join(rec('c', 'lane', DOORS[0], 3, 'up', { wet: 0.6 }), 0);
    w.returned('c', 0);
    const at = walk(w, 'c', ['up', 'up', 'right', 'right'], 2000);
    w.teleport('c', 4, 1, at);
    expect(w.get('c')).toMatchObject({ map: 'town' });
    expect(w.get('c')!.wet).toBeGreaterThan(0);
  });
});

describe('visits over the network', () => {
  it('turn a neighbor away, then let them in, tell the owner, keep the chest theirs, send a blocked visitor out, and the teleport takes you to town', async () => {
    setLogLevel('silent');
    let now = 1_000_000;
    const storage = new MemoryStorage();
    const server = await startServer({ ...serverDefaults(), storage, maps: maps(), items: items(), weather: 'overcast', clock: () => now });
    const clients: Client[] = [];
    const hello = async (hi: { token: string }) => {
      const c = await Client.open(server.port);
      clients.push(c);
      c.send({ t: 'hello', v: PROTOCOL_VERSION, ...hi });
      const welcome = await c.next('welcome');
      await c.next('friends');
      await c.next('tells');
      await c.settle();
      return { c, welcome, id: welcome.you };
    };
    // Signed in (blocks need it), in their cabins where they wake up.
    const saved = (name: string, more: Partial<PlayerRecord> = {}) =>
      savedPlayer(storage, { name, authSub: `dev:${name.toLowerCase()}@example.test`, map: 'house', x: 2, y: 2, dir: 'down', ...more });
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
      const ann = await hello(await saved('Ann'));
      const bob = await hello(await saved('Bob', { furniture: ['stove', 'shelf'], stash: { items: { pebble: 1, moss: 2 }, out: {} } }));
      await waitFor(() => storage.get(bob.id)?.street !== undefined, 'the lots to be saved');
      expect([storage.get(ann.id)!.lot, storage.get(bob.id)!.lot]).toEqual([0, 1]);

      // Bob lets only friends in: saved at once.
      bob.c.send({ t: 'visitsOff', off: true });
      expect(await bob.c.next('visitsOff')).toEqual({ t: 'visitsOff', off: true });
      await waitFor(() => storage.get(bob.id)?.visitsOff === true, 'the setting to be saved');

      // Ann walks out and over to Bob's door: the step comes back, and the door says it stayed shut.
      await go(ann.c, ['down', 'down']);
      expect(await ann.c.next('zone')).toMatchObject({ map: { id: 'lane' }, x: 2, y: 3 });
      await go(ann.c, ['right', 'right', 'right', 'right']);
      now += STEP_MS + 10;
      ann.c.send({ t: 'step', dir: 'up', seq: ++seq });
      expect(await ann.c.next('reject')).toMatchObject({ x: 6, y: 3 });
      expect(await ann.c.next('door')).toEqual({ t: 'door', x: 6, y: 2, lot: { name: 'Bob', home: true }, closed: true });

      // A while later Bob lets his neighbors in again. Ann walks in and sees his stove, his shelf and the
      // pebble on it; Bob reads that she came in.
      now += DOOR_EVERY_MS;
      bob.c.send({ t: 'visitsOff', off: false });
      await bob.c.next('visitsOff', m => !m.off);
      await step(ann.c, 'up');
      expect(await ann.c.next('zone')).toMatchObject({ map: { id: 'house' }, x: 2, y: 3, furniture: ['stove', 'shelf'], visit: { name: 'Bob', trophies: ['pebble'] } });
      expect(await bob.c.next('visited')).toEqual({ t: 'visited', name: 'Ann' });
      expect(server.world.zoneOf(ann.id)).toBe(zoneKey('house', bob.id));

      // His chest is his: what she tries there is refused.
      await go(ann.c, ['up', 'right']);
      ann.c.send({ t: 'store', x: 3, y: 1 });
      expect(await ann.c.next('refused')).toEqual({ t: 'refused', action: 'store', reason: 'not_yours' });

      // Bob blocks her: she is out on the street at once, in front of his door, and it stays shut to her.
      bob.c.send({ t: 'block', id: ann.id, on: true });
      expect(await ann.c.next('zone')).toMatchObject({ map: { id: 'lane' }, x: 6, y: 3, dir: 'down' });
      now += STEP_MS + 10;
      ann.c.send({ t: 'step', dir: 'up', seq: ++seq });
      expect(await ann.c.next('reject')).toMatchObject({ x: 6, y: 3 });

      // Home, and out by NAPO's teleport: in town, in front of its twin.
      await go(ann.c, ['left', 'left', 'left', 'left', 'up']);
      expect(await ann.c.next('zone', m => m.map.id === 'house')).toMatchObject({ x: 2, y: 3 });
      await go(ann.c, ['up', 'right', 'right']);
      ann.c.send({ t: 'teleport', x: 4, y: 1 });
      expect(await ann.c.next('zone', m => m.map.id === 'town')).toMatchObject({ x: 8, y: 6, dir: 'down' });
    } finally {
      for (const c of clients) c.ws.terminate();
      await server.stop();
    }
  });

  it('show a cabin whose owner is away as storage keeps it, read as the server starts', async () => {
    setLogLevel('silent');
    let now = 1_000_000;
    const storage = new MemoryStorage();
    // Bob has not been online on this server: his lot, his furniture and his stash are in storage.
    await savedPlayer(storage, { name: 'Bob', map: 'house', x: 2, y: 2, dir: 'down', street: 1, lot: 1, furniture: ['shelf'], stash: { items: { 'shard-cap': 1 }, out: {} } });
    const ann = await savedPlayer(storage, { name: 'Ann', authSub: 'dev:ann@example.test', map: 'lane', x: 6, y: 3, dir: 'up', street: 1, lot: 0 });
    const server = await startServer({ ...serverDefaults(), storage, maps: maps(), items: items(), weather: 'overcast', clock: () => now });
    let c: Client | undefined;
    try {
      // Her friends list and messages come once whom she blocks is known (World.returned): then a door may let her in.
      ({ c } = await loginTo(server.port, ann.token));
      now += STEP_MS + 10;
      c.send({ t: 'step', dir: 'up', seq: ++seq });
      expect(await c.next('zone')).toMatchObject({ map: { id: 'house' }, furniture: ['shelf'], visit: { name: 'Bob', trophies: ['shard-cap'] } });
    } finally {
      c?.ws.terminate();
      await server.stop();
    }
  });
});
