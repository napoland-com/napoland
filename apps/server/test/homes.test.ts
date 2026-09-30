/**
 * Homes of one's own (roadmap/home-lots.md): every player's house stands in a garden of its own, their own
 * copies of both, closed all round, so NAPO's teleport is the only way to town and back. Friends visit from
 * the friends list, whether the owner is home or not, unless the owner keeps visitors out; a visit is for
 * looking, and never a way home from the wilds. The workbench builds the house up, level by level, from the
 * stash: the kitchen (which cooks from the chest) and the map table stand in it only from their levels on.
 * World rules first, then over real WebSockets.
 *
 * The fixture world (fixtures.ts): the town with NAPO's teleport at 8,5 (it sets you down at 8,6, facing
 * down), the woods up its road, the garden (its house's door at 3,3; out of the house you stand at 3,4) and
 * the home inside (the teleport at 4,1, which sets you down at 4,2; the chest at 3,1, the workbench at 1,1,
 * the kitchen at 4,3 from level 2, the map table at 5,3 from level 3; the way in at 2,4, the way out at 2,5).
 */
import { describe, expect, it } from 'vitest';
import {
  COZY_AFTER_S, ENERGY_MAX, PROTOCOL_VERSION, STEP_MS, TileMap, validateMap, validateWorld, type Dir, type ItemsData, type MapData, type ServerMsg,
} from '@napoland/shared';
import { setLogLevel } from '../src/log';
import { startServer } from '../src/server';
import { MemoryStorage, type HomeRecord, type PlayerRecord } from '../src/storage';
import { VISITS_EVERY_MS, World, colorFor, zoneKey, type Outgoing } from '../src/world';
import { HOUSE_LEVELS, gardenData, homeMaps, homeRoomData, homeTownData, itemsData, woodsData } from './fixtures';
import { Client, savedPlayer, serverDefaults, waitFor } from './helpers';

/** The fixture items, with furniture, a charm and a piece of anomalous gear for the shelf, tea to cook from moss, and the house's levels. */
function items(): ItemsData {
  const base = itemsData();
  return {
    ...base,
    items: [
      ...base.items,
      { id: 'stove', name: 'Iron stove', kind: 'furniture', stack: 1, furnishes: 'stove', comfort: 3, text: 'Warm.', spoiled: 'Rusted.' },
      { id: 'shelf', name: 'Trophy shelf', kind: 'furniture', stack: 1, furnishes: 'shelf', comfort: 1, text: 'Strange things.', spoiled: 'Warped.' },
      { id: 'pebble', name: 'Warm pebble', kind: 'charm', stack: 1, charm: { wetting: 0.6 }, text: 'It never cools.' },
      { id: 'shard-cap', name: 'Shard-lined cap', kind: 'gear', stack: 1, slot: 'cap', tier: 'anomalous', text: 'It hums.' },
    ],
    recipes: [{ id: 'stove', make: 'stove', needs: [{ item: 'nail', count: 4 }] }],
    cooking: [{ id: 'tea', make: 'tea', needs: [{ item: 'moss', count: 2 }] }],
    house: HOUSE_LEVELS,
  };
}

const rec = (id: string, map: string, x: number, y: number, dir: Dir = 'up', more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map, x, y, dir, color: colorFor(id), energy: ENERGY_MAX, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});
const home = (id: string, more: Partial<HomeRecord> = {}): HomeRecord => ({ id, name: id.toUpperCase(), ...more });
const HOUSE = (owner: string) => zoneKey('house', owner);
const GARDEN = (owner: string) => zoneKey('garden', owner);

function world(homes: HomeRecord[] = [], friends: Record<string, string[]> = {}, crowd?: { town: number }): World {
  const w = new World(homeMaps(), 'town', 'overcast', { items: items(), rng: () => 0, homes, ...(crowd && { crowd }) });
  w.friends = id => new Set(friends[id] ?? []);
  return w;
}
/** In their own house at x,y, settled in: whom they block, and who blocks them, is known (World.returned). */
function atHome(w: World, id: string, x = 2, y = 2, more: Partial<PlayerRecord> = {}): void {
  w.join(rec(id, 'house', x, y, 'down', { zone: id, ...more }), 0);
  w.returned(id, 0);
}
/** In town at x,y, settled in. */
function inTown(w: World, id: string, x = 1, y = 2, more: Partial<PlayerRecord> = {}): void {
  w.join(rec(id, 'town', x, y, 'down', more), 0);
  w.returned(id, 0);
}
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id ? [o.msg] : []));
const of = <T extends ServerMsg['t']>(msgs: ServerMsg[], t: T) => msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
let seq = 0;
/** From in front of the teleport (4,2), where a visit sets you down, out of the house into its garden: round the kitchen and out of the door. */
const OUT_OF_THE_HOUSE: Dir[] = ['left', 'down', 'down', 'left', 'down'];
/** Walks `dirs` one step after the other from game time `at`; returns the time after the last. */
function walk(w: World, id: string, dirs: Dir[], at: number): number {
  for (const dir of dirs) {
    w.step(id, dir, ++seq, at);
    at += STEP_MS;
  }
  return at;
}

describe('the fixtures', () => {
  it('follow the content rules: a garden closed all round, its house into the home, the teleport and its twin', () => {
    for (const m of [homeTownData(), gardenData(), homeRoomData()]) expect(validateMap(m).filter(p => p.level === 'error'), m.id).toEqual([]);
    expect(validateWorld([homeTownData(), gardenData(), homeRoomData(), woodsData()], 'town').filter(p => p.level === 'error')).toEqual([]);
  });
});

describe('a home of one\'s own', () => {
  it('is a house and its garden, each player\'s own copies of both: out of the door into the garden, and back in', () => {
    const w = world();
    atHome(w, 'a', 2, 4);
    atHome(w, 'b', 2, 4);
    expect([w.zoneOf('a'), w.zoneOf('b')]).toEqual([HOUSE('a'), HOUSE('b')]);
    w.drain();
    let at = walk(w, 'a', ['down'], 1000);
    expect(w.zoneOf('a')).toBe(GARDEN('a'));
    expect(w.get('a')).toMatchObject({ map: 'garden', x: 3, y: 4, dir: 'down' });
    const [z] = of(to(w.drain(), 'a'), 'zone');
    // Nobody else is in a's garden, and its welcome to it says no friend's home.
    expect(z).toMatchObject({ map: { id: 'garden' }, x: 3, y: 4, players: [{ id: 'a' }] });
    expect(z?.visit).toBeUndefined();
    // Back in through the door: a's own house again, where the door leads in.
    at = walk(w, 'a', ['up'], at);
    expect(w.zoneOf('a')).toBe(HOUSE('a'));
    expect(w.get('a')).toMatchObject({ map: 'house', x: 2, y: 4, dir: 'up' });
    // b walks out into b's own garden, apart from a's.
    walk(w, 'b', ['down'], at);
    expect(w.zoneOf('b')).toBe(GARDEN('b'));
  });

  it('is closed all round: nothing in the garden leads anywhere but into the house', () => {
    const w = world();
    w.join(rec('a', 'garden', 7, 5, 'right', { zone: 'a' }), 0);
    w.drain();
    walk(w, 'a', ['right', 'down'], 1000);
    expect(w.get('a')).toMatchObject({ map: 'garden', x: 7, y: 5 });
    expect(of(to(w.drain(), 'a'), 'reject')).toHaveLength(2);
  });

  it('is where a new record wakes up, and where a collapse brings you, in your own copy', () => {
    const w = world();
    expect(w.wakeUp).toMatchObject({ x: 2, y: 2, dir: 'down' });
    expect(w.wakeUp.map.data.id).toBe('house');
  });
});

describe('visits from the friends list', () => {
  it('set a friend down by the teleport in the host\'s house, with what the host made of it, whether the host is home or not', () => {
    // B is away: their furniture, the charms and anomalous gear their stash holds, and their house came with the homes.
    const w = world([home('b', { house: 2, furniture: ['stove', 'shelf'], stash: { items: { moss: 3, pebble: 1, 'shard-cap': 2 }, out: {} } })], { a: ['b'] });
    inTown(w, 'a');
    w.drain();
    w.visit('a', 'b', 1000);
    expect(w.zoneOf('a')).toBe(HOUSE('b'));
    expect(w.get('a')).toMatchObject({ map: 'house', x: 4, y: 2, dir: 'down' });
    const [z] = of(to(w.drain(), 'a'), 'zone');
    // Each trophy once, in the order the chest lists them; never a's own furniture; B's house as built.
    expect(z).toMatchObject({ map: { id: 'house' }, x: 4, y: 2, dir: 'down', furniture: ['stove', 'shelf'], visit: { name: 'B', house: 2, trophies: ['pebble', 'shard-cap'] } });
    // Out of the door, into B's garden, still B's: the house there is drawn as B built it.
    walk(w, 'a', OUT_OF_THE_HOUSE, 2000);
    expect(w.zoneOf('a')).toBe(GARDEN('b'));
    expect(of(to(w.drain(), 'a'), 'zone').at(-1)).toMatchObject({ map: { id: 'garden' }, visit: { name: 'B', house: 2 } });
  });

  it('tells the host who came, while the host is in their home, and shows it as it stands', () => {
    const w = world([], { a: ['b'] });
    atHome(w, 'b', 1, 2, { furniture: ['shelf'], stash: { items: { nail: 4, pebble: 1 }, out: {} } });
    inTown(w, 'a');
    w.drain();
    w.visit('a', 'b', 1000);
    let out = w.drain();
    expect(to(out, 'b')).toEqual([{ t: 'visited', name: 'A' }]);
    expect(of(to(out, 'a'), 'zone')[0]).toMatchObject({ furniture: ['shelf'], visit: { name: 'B', house: 1, trophies: ['pebble'] } });
    // B makes a stove at the workbench while a looks round: it stands there for both at once.
    w.craft('b', 1, 1, 'stove', 2000);
    out = w.drain();
    expect(of(to(out, 'a'), 'furniture')).toEqual([{ t: 'furniture', furniture: ['shelf', 'stove'] }]);
    expect(of(to(out, 'b'), 'furniture')).toEqual([{ t: 'furniture', furniture: ['shelf', 'stove'] }]);
    // Out in the garden, B hears nobody else come: only a visit tells.
    walk(w, 'b', ['right', 'down', 'down', 'down'], 3000);
    expect(w.zoneOf('b')).toBe(GARDEN('b'));
    w.drain();
    inTown(w, 'c');
    w.friends = id => new Set(id === 'c' || id === 'a' ? ['b'] : []);
    w.visit('c', 'b', 4000);
    expect(to(w.drain(), 'b')).toEqual([{ t: 'visited', name: 'C' }]);
  });

  it('go to friends only, never from out in the wilds, never while the host keeps visitors out, and never with a block either way', () => {
    const tryVisit = (o: { friends?: Record<string, string[]>; from?: string; closed?: boolean; blocks?: Record<string, string[]>; blockedBy?: Record<string, string[]>; known?: boolean }) => {
      const w = world([home('b', o.closed ? { closed: true } : {})], o.friends ?? { a: ['b'] });
      if (o.blocks) w.blocks = id => new Set(o.blocks![id] ?? []);
      if (o.blockedBy) w.blockedBy = id => new Set(o.blockedBy![id] ?? []);
      w.join(rec('a', o.from ?? 'town', o.from === 'woods' ? 3 : 1, o.from === 'woods' ? 6 : 2), 0);
      if (o.known !== false) w.returned('a', 0);
      w.drain();
      w.visit('a', 'b', 1000);
      return { zone: w.zoneOf('a'), heard: of(to(w.drain(), 'a'), 'refused').map(r => r.reason) };
    };
    expect(tryVisit({}).zone).toBe(HOUSE('b'));
    // Friends are asked both ways: the World may know only one side yet.
    expect(tryVisit({ friends: { b: ['a'] } }).zone).toBe(HOUSE('b'));
    expect(tryVisit({ friends: {} })).toEqual({ zone: zoneKey('town', ''), heard: ['not_friends'] });
    // Out in the woods, a visit would be a way home that costs nothing.
    expect(tryVisit({ from: 'woods' })).toEqual({ zone: zoneKey('woods', ''), heard: ['too_far'] });
    expect(tryVisit({ closed: true })).toEqual({ zone: zoneKey('town', ''), heard: ['closed'] });
    expect(tryVisit({ blocks: { a: ['b'] } }).heard).toEqual(['closed']);
    expect(tryVisit({ blocks: { b: ['a'] } }).heard).toEqual(['closed']);
    // B, away, blocks a: the World knows it from a's side (who blocks a, from social.ts).
    expect(tryVisit({ blockedBy: { a: ['b'] } }).heard).toEqual(['closed']);
    // Just back in the game, before social.ts has read whom a blocks and who blocks a: no visit yet.
    expect(tryVisit({ known: false }).heard).toEqual(['closed']);
    // Nobody visits their own home, or one that is not there.
    const w = world([home('b')], { a: ['b', 'nobody'] });
    atHome(w, 'a');
    w.drain();
    w.visit('a', 'a', 1000);
    w.visit('a', 'nobody', 1000);
    expect(of(to(w.drain(), 'a'), 'refused').map(r => r.reason)).toEqual(['gone', 'gone']);
  });

  it('is for looking: the host\'s chest, workbench and kitchen answer only the host, and nothing is built there', () => {
    const w = world([home('b', { house: 2, stash: { items: { moss: 3, nail: 9 }, out: {} } })], { a: ['b'] });
    inTown(w, 'a', 1, 2, { bag: [{ item: 'moss', count: 3 }] });
    w.visit('a', 'b', 1000);
    let at = walk(w, 'a', ['left'], 2000);
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
    w.build('a', 1, 1, at);
    expect(to(w.drain(), 'a')).toEqual([{ t: 'refused', action: 'craft', reason: 'not_yours' }, { t: 'refused', action: 'build', reason: 'not_yours' }]);
    at = walk(w, 'a', ['right', 'down', 'down', 'right', 'right'], at);
    expect(w.get('a')).toMatchObject({ map: 'house', x: 4, y: 4 });
    w.cook('a', 4, 3, 'tea', at);
    expect(of(to(w.drain(), 'a'), 'refused')).toEqual([{ t: 'refused', action: 'cook', reason: 'not_yours' }]);
    expect(w.get('a')!.bag).toEqual([{ item: 'moss', count: 3 }]);
  });

  it('never makes a visitor cozy by the host\'s fire, however long they stand there; the host, beside them, is', () => {
    const w = world([], { a: ['b'] });
    atHome(w, 'b', 1, 2);
    inTown(w, 'a');
    w.visit('a', 'b', 1000);
    walk(w, 'a', ['left', 'left'], 2000);
    expect(w.get('a')).toMatchObject({ map: 'house', x: 2, y: 2 });
    w.tick(5000);
    w.tick(5000 + (COZY_AFTER_S + 60) * 1000);
    expect(w.get('a')!.cozy).toBeUndefined();
    expect(w.get('b')!.cozy).toBeDefined();
  });

  it('sends a visitor home, by the teleport, the moment the host keeps visitors out or a block comes between them; a friend who may stays', () => {
    const blocking = new Map<string, Set<string>>();
    const w = world([], { a: ['b'], c: ['b'] });
    w.blocks = id => blocking.get(id) ?? new Set();
    atHome(w, 'b', 1, 2);
    inTown(w, 'a');
    inTown(w, 'c', 2, 3);
    w.visit('a', 'b', 1000);
    w.visit('c', 'b', 1000);
    // c walks out into B's garden: sent home from there too.
    walk(w, 'c', OUT_OF_THE_HOUSE, 1000);
    expect([w.zoneOf('a'), w.zoneOf('c')]).toEqual([HOUSE('b'), GARDEN('b')]);
    w.drain();
    w.takeWrites();
    // a blocks B, friends no more: net.ts has the World keep out whoever that keeps out.
    blocking.set('a', new Set(['b']));
    w.keepOut('b', 2000);
    expect(w.zoneOf('a')).toBe(HOUSE('a'));
    expect(w.get('a')).toMatchObject({ map: 'house', x: 4, y: 2, dir: 'down' });
    expect(w.zoneOf('c')).toBe(GARDEN('b'));
    // B keeps visitors out: c is sent home at once, and it is saved.
    w.visitsOff('b', true, 3000);
    const out = w.drain();
    expect(to(out, 'b')).toContainEqual({ t: 'visitsOff', off: true });
    expect(of(to(out, 'c'), 'zone').at(-1)).toMatchObject({ map: { id: 'house' }, x: 4, y: 2, dir: 'down' });
    expect(w.zoneOf('c')).toBe(HOUSE('c'));
    expect(w.takeWrites().players.find(p => p.id === 'b')).toMatchObject({ visitsOff: true });
    expect(w.homeClosed('b')).toBe(true);
  });

  it('brings a visitor who left the game back into their own home, where they stood', () => {
    const w = world([home('b')], { a: ['b'] });
    inTown(w, 'a');
    w.visit('a', 'b', 1000);
    const saved = w.leave('a', 2000)!;
    expect(saved).toMatchObject({ map: 'house', zone: 'b', x: 4, y: 2 });
    const back = w.join(saved, 3000);
    expect(back.map.id).toBe('house');
    expect(back.visit).toBeUndefined();
    expect(w.zoneOf('a')).toBe(HOUSE('a'));
    expect(w.get('a')).toMatchObject({ map: 'house', x: 4, y: 2 });
  });

  it('is no homecoming: a trip ends in your own home, not a friend\'s', () => {
    const w = world([home('b')], { a: ['b'] });
    w.join(rec('a', 'woods', 3, 6, 'up'), 0);
    w.returned('a', 0);
    // Out in the woods for a trip: up and down, a dozen steps, then back to town well over half a minute on.
    let at = walk(w, 'a', ['up', 'down', 'up', 'down', 'up', 'down', 'up', 'down', 'up', 'down', 'up', 'down'], 1000);
    at = walk(w, 'a', ['down'], Math.max(at, 40_000));
    expect(w.get('a')).toMatchObject({ map: 'town' });
    w.visit('a', 'b', at);
    expect(w.zoneOf('a')).toBe(HOUSE('b'));
    expect(of(to(w.drain(), 'a'), 'trip')).toEqual([]);
    // Then home: B's teleport to town, and the one in town home.
    w.teleport('a', 4, 1, at + 1000);
    w.teleport('a', 8, 5, at + 2000);
    expect(w.zoneOf('a')).toBe(HOUSE('a'));
    expect(of(to(w.drain(), 'a'), 'trip')).toHaveLength(1);
  });

  it('keeps who may visit as a setting of its own: saved at once, changed once in a while, in the welcome', () => {
    const w = world();
    atHome(w, 'b');
    w.drain();
    w.takeWrites();
    w.visitsOff('b', true, 1000);
    expect(to(w.drain(), 'b')).toEqual([{ t: 'visitsOff', off: true }]);
    expect(w.takeWrites().players.find(p => p.id === 'b')).toMatchObject({ visitsOff: true });
    // Too soon: nothing changes, and B hears it as it stands.
    w.visitsOff('b', false, 1500);
    expect(to(w.drain(), 'b')).toEqual([{ t: 'visitsOff', off: true }]);
    w.visitsOff('b', false, 1000 + VISITS_EVERY_MS);
    expect(to(w.drain(), 'b')).toEqual([{ t: 'visitsOff', off: false }]);
    expect(w.get('b')!.visitsOff).toBeUndefined();
    expect(w.homeClosed('b')).toBe(false);
    // Back in the game, the welcome says it; saved as anything but true, it is not kept.
    expect(w.join(rec('g', 'town', 1, 2, 'down', { visitsOff: true }), 0).visitsOff).toBe(true);
    w.join(rec('h', 'town', 1, 2, 'down', { visitsOff: 1 as unknown as true }), 0);
    expect(w.get('h')!.visitsOff).toBeUndefined();
  });

  it('forgets the homes of players deleted for good, but never of someone online', () => {
    const w = world([home('gone'), home('here')], { a: ['gone', 'here'] });
    inTown(w, 'here');
    w.forgetHomes(['gone', 'here']);
    inTown(w, 'a', 2, 3);
    w.drain();
    w.visit('a', 'gone', 1000);
    expect(of(to(w.drain(), 'a'), 'refused')).toEqual([{ t: 'refused', action: 'visit', reason: 'gone' }]);
    w.visit('a', 'here', 1000);
    expect(w.zoneOf('a')).toBe(HOUSE('here'));
  });
});

describe('building your house up', () => {
  it('happens at the workbench in your own home, paid from the stash, a level at a time: saved at once, and everyone in the home sees it', () => {
    const w = world([], { v: ['a'] });
    atHome(w, 'a', 1, 2, { stash: { items: { nail: 9, moss: 1 }, out: {} } });
    // v visits, out in a's garden.
    inTown(w, 'v');
    w.visit('v', 'a', 0);
    walk(w, 'v', OUT_OF_THE_HOUSE, 0);
    expect(w.zoneOf('v')).toBe(GARDEN('a'));
    expect(w.join(rec('x', 'town', 1, 2), 0).house).toBe(1);
    w.drain();
    w.takeWrites();
    w.build('a', 1, 1, 2000);
    let out = w.drain();
    expect(to(out, 'a')).toEqual([
      { t: 'house', level: 2 },
      { t: 'bench', stash: [{ item: 'moss', count: 1 }, { item: 'nail', count: 7 }] },
      { t: 'did', did: { kind: 'built', level: 2 } },
    ]);
    expect(to(out, 'v')).toEqual([{ t: 'house', level: 2 }]);
    expect(w.get('a')).toMatchObject({ house: 2 });
    expect(w.takeWrites().players.find(p => p.id === 'a')).toMatchObject({ house: 2 });
    // The next level takes 3 nails and a moss; then the house is as built as it goes.
    w.build('a', 1, 1, 3000);
    out = w.drain();
    expect(of(to(out, 'a'), 'did')).toEqual([{ t: 'did', did: { kind: 'built', level: 3 } }]);
    expect(w.get('a')).toMatchObject({ house: 3, stash: { items: { nail: 4 } } });
    w.build('a', 1, 1, 4000);
    expect(to(w.drain(), 'a')).toEqual([{ t: 'refused', action: 'build', reason: 'built' }]);
    // Coming back, the welcome says how far it is built.
    const saved = w.leave('a', 5000)!;
    expect(w.join(saved, 6000).house).toBe(3);
  });

  it('is refused short of what it takes, away from the workbench, and anywhere but your own home', () => {
    const w = world();
    atHome(w, 'a', 1, 2, { stash: { items: { nail: 1 }, out: {} } });
    w.drain();
    w.build('a', 1, 1, 1000);
    w.build('a', 3, 1, 1000);
    expect(of(to(w.drain(), 'a'), 'refused').map(r => r.reason)).toEqual(['missing', 'too_far']);
    expect(w.get('a')!.house).toBeUndefined();
    expect(w.get('a')!.stash).toMatchObject({ items: { nail: 1 } });
  });

  it('keeps a level from storage and the record, and reads one it does not know (past the last, or no number) as the first', () => {
    const w = world([home('b', { house: 3 }), home('c', { house: 9 })], { a: ['b', 'c'] });
    inTown(w, 'a');
    w.visit('a', 'b', 1000);
    expect(of(to(w.drain(), 'a'), 'zone')[0]).toMatchObject({ visit: { name: 'B', house: 3 } });
    w.teleport('a', 4, 1, 2000);
    w.visit('a', 'c', 3000);
    expect(of(to(w.drain(), 'a'), 'zone').at(-1)).toMatchObject({ visit: { name: 'C', house: 1 } });
    expect(w.join(rec('d', 'town', 1, 2, 'down', { house: 7 }), 0).house).toBe(1);
    expect(w.get('d')!.house).toBeUndefined();
    expect(w.join(rec('e', 'town', 1, 2, 'down', { house: 2 }), 0).house).toBe(2);
  });

  it('opens the kitchen from its level: before, it cooks nothing; then it cooks from the bag and then the chest', () => {
    const w = world();
    atHome(w, 'a', 4, 4, { bag: [{ item: 'moss', count: 1 }], stash: { items: { moss: 3, nail: 2 }, out: {} } });
    w.drain();
    w.cook('a', 4, 3, 'tea', 1000);
    expect(to(w.drain(), 'a')).toEqual([{ t: 'refused', action: 'cook', reason: 'not_built' }]);
    // Built up to a cabin (at the workbench, then back to the kitchen).
    let at = walk(w, 'a', ['left', 'left', 'up', 'up', 'left'], 1000);
    w.build('a', 1, 1, at);
    at = walk(w, 'a', ['right', 'down', 'down', 'right', 'right'], at);
    w.drain();
    w.cook('a', 4, 3, 'tea', at);
    const out = to(w.drain(), 'a');
    // The one moss in the bag first, then one from the chest: the chest says what it holds now.
    expect(of(out, 'chest')).toEqual([{ t: 'chest', stash: [{ item: 'moss', count: 2 }] }]);
    expect(of(out, 'bag')).toEqual([{ t: 'bag', bag: [{ item: 'tea', count: 1 }] }]);
    expect(of(out, 'did')).toEqual([{ t: 'did', did: { kind: 'cooked', item: 'tea', count: 1, chest: true } }]);
    // With too little in both, it cooks nothing.
    w.cook('a', 4, 3, 'tea', at + 1000);
    w.cook('a', 4, 3, 'tea', at + 2000);
    expect(of(to(w.drain(), 'a'), 'refused')).toEqual([{ t: 'refused', action: 'cook', reason: 'missing' }]);
  });

  it('opens the map table from its level: before, it tells nothing; then how things stand out there, as the notice board does', () => {
    const w = world();
    atHome(w, 'a', 5, 4, { house: 2 });
    w.drain();
    w.board('a', 5, 3, 1000);
    expect(to(w.drain(), 'a')).toEqual([{ t: 'refused', action: 'board', reason: 'not_built' }]);
    const b = world();
    atHome(b, 'a', 5, 4, { house: 3 });
    b.drain();
    b.board('a', 5, 3, 1000);
    expect(of(to(b.drain(), 'a'), 'board')).toHaveLength(1);
  });
});

describe('the letter about home', () => {
  it('comes once, the first time home since homes stood in gardens, and waits until a new player\'s first steps are done', () => {
    const w = world();
    atHome(w, 'a');
    const heard = to(w.drain(), 'a');
    expect(of(heard, 'homeLetter')).toEqual([{ t: 'homeLetter' }]);
    expect(w.get('a')!.homeTold).toBe(true);
    expect(w.takeWrites().players.find(p => p.id === 'a')).toMatchObject({ homeTold: true });
    // Back in the game at home: no second letter.
    w.drain();
    w.leave('a', 2000);
    atHome(w, 'a', 2, 2, { homeTold: true });
    expect(of(to(w.drain(), 'a'), 'homeLetter')).toEqual([]);
    // A new player, taking their first steps, reads it once they are done.
    atHome(w, 'n', 2, 2, { firstSteps: 1 });
    expect(of(to(w.drain(), 'n'), 'homeLetter')).toEqual([]);
  });
});

describe('NAPO\'s teleport', () => {
  it('sets you down in town, in front of its twin, from your own home or a friend\'s', () => {
    const w = world([], { c: ['a'] });
    atHome(w, 'a', 4, 2);
    w.drain();
    w.teleport('a', 4, 1, 1000);
    expect(w.zoneOf('a')).toBe(zoneKey('town', ''));
    expect(w.get('a')).toMatchObject({ map: 'town', x: 8, y: 6, dir: 'down' });
    expect(of(to(w.drain(), 'a'), 'zone')[0]).toMatchObject({ map: { id: 'town' }, x: 8, y: 6, dir: 'down', reason: 'exit' });
    // c, visiting a's home, goes the same way.
    inTown(w, 'c');
    w.teleport('a', 8, 5, 2000);
    w.visit('c', 'a', 2000);
    expect(w.get('c')).toMatchObject({ map: 'house', x: 4, y: 2 });
    w.teleport('c', 4, 1, 3000);
    expect(w.get('c')).toMatchObject({ map: 'town', x: 8, y: 6, dir: 'down' });
  });

  it('works only from a tile next to one: not from farther, not across a corner, not from the garden', () => {
    const w = world();
    atHome(w, 'a', 3, 2);
    w.join(rec('t', 'town', 7, 6, 'up'), 0);
    w.join(rec('g', 'garden', 4, 1 + 3, 'up', { zone: 'g' }), 0);
    w.drain();
    w.teleport('a', 4, 1, 1000);
    w.teleport('a', 3, 1, 1000);
    w.teleport('t', 8, 5, 1000);
    w.teleport('t', 7, 5, 1000);
    w.teleport('g', 4, 1, 1000);
    const out = w.drain();
    const tooFar = { t: 'refused', action: 'teleport', reason: 'too_far' };
    expect(to(out, 'a')).toEqual([tooFar, tooFar]);
    expect(to(out, 't')).toEqual([tooFar, tooFar]);
    expect(to(out, 'g')).toEqual([tooFar]);
    expect([w.zoneOf('a'), w.zoneOf('t'), w.zoneOf('g')]).toEqual([HOUSE('a'), zoneKey('town', ''), GARDEN('g')]);
  });

  it('in town, sets you down at home: in front of the one in your own house, never a friend\'s, and you are home', () => {
    const w = world([], { a: ['b'] });
    atHome(w, 'b', 4, 2);
    inTown(w, 'a', 8, 6, { homeTold: true });
    w.drain();
    w.teleport('a', 8, 5, 1000);
    expect(w.zoneOf('a')).toBe(HOUSE('a'));
    expect(w.get('a')).toMatchObject({ map: 'house', x: 4, y: 2, dir: 'down' });
    expect(of(to(w.drain(), 'a'), 'zone')[0]).toMatchObject({ map: { id: 'house' }, x: 4, y: 2, dir: 'down', reason: 'exit' });
    // Back to town and home again: the same way both times.
    w.teleport('a', 4, 1, 2000);
    expect(w.get('a')).toMatchObject({ map: 'town', x: 8, y: 6, dir: 'down' });
    w.teleport('a', 8, 5, 3000);
    expect(w.zoneOf('a')).toBe(HOUSE('a'));
  });

  it('ends a trip in the wilds at home', () => {
    const w = world();
    w.join(rec('a', 'woods', 3, 6, 'up'), 0);
    w.returned('a', 0);
    // Up the woods and back, for as long as a trip takes, then out to town and to the teleport.
    let at = walk(w, 'a', ['right', 'right', 'right', 'up', 'up', 'up', 'down', 'down', 'down', 'left', 'left', 'left'], 1000);
    at = walk(w, 'a', ['down'], at + 30_000);
    expect(w.get('a')).toMatchObject({ map: 'town', x: 4, y: 1 });
    at = walk(w, 'a', ['down', 'down', 'down', 'down', 'down', 'right', 'right', 'right', 'right'], at);
    expect(w.get('a')).toMatchObject({ map: 'town', x: 8, y: 6 });
    w.drain();
    w.teleport('a', 8, 5, at);
    // The step out of the woods counts; the ones in town do not.
    const [trip] = of(to(w.drain(), 'a'), 'trip');
    expect(trip?.trip).toMatchObject({ steps: 13, fell: null });
  });

  it('in a hut out in the wilds, takes you home, in front of the one in your own house, and there is no way back by it', () => {
    const hut: MapData = {
      id: 'hut', name: 'The hut', version: 1, kind: 'inside', depth: 0, width: 5, height: 4,
      tiles: ['xxxxx', 'xpppx', 'xpppx', 'xxpxx'], levels: Array<string>(4).fill('00000'),
      spawn: { x: 2, y: 2, dir: 'up' }, exits: [{ x: 2, y: 3, w: 1, h: 1, to: 'woods', tx: 3, ty: 6, dir: 'down' }],
      objects: [{ kind: 'teleport', x: 3, y: 1, home: true }],
    };
    const w = new World([...homeMaps(), new TileMap(hut)], 'town', 'overcast', { items: items(), rng: () => 0 });
    w.friends = () => new Set();
    w.join(rec('a', 'hut', 3, 2, 'up'), 0);
    w.returned('a', 0);
    w.join(rec('b', 'hut', 1, 2, 'up'), 0);
    w.drain();
    // From a tile next to it only.
    w.teleport('b', 3, 1, 500);
    expect(to(w.drain(), 'b')).toEqual([{ t: 'refused', action: 'teleport', reason: 'too_far' }]);
    expect(w.get('b')).toMatchObject({ map: 'hut', x: 1, y: 2 });
    w.teleport('a', 3, 1, 1000);
    expect(w.get('a')).toMatchObject({ map: 'house', x: 4, y: 2, dir: 'down' });
    expect(w.zoneOf('a')).toBe(HOUSE('a'));
    expect(of(to(w.drain(), 'a'), 'zone')[0]).toMatchObject({ map: { id: 'house' }, x: 4, y: 2, dir: 'down', reason: 'exit' });
  });

  it('goes into the copy of town walking in would: where your friends are, if it has room', () => {
    const w = world([], { a: ['f'] }, { town: 2 });
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
    const rack = items();
    rack.items.push({ id: 'rack', name: 'Drying rack', kind: 'furniture', stack: 1, furnishes: 'rack', comfort: 2, dries: true, text: 'Dry.', spoiled: 'Broken.' });
    const w = new World(homeMaps(), 'town', 'overcast', { items: rack, rng: () => 0 });
    w.friends = id => new Set(id === 'c' ? ['a'] : []);
    atHome(w, 'a', 4, 2, { furniture: ['rack'], wet: 0.6 });
    w.teleport('a', 4, 1, 1000);
    expect(w.get('a')!.wet).toBe(0);
    // c, wet, visits a's home, the rack and all, and goes the same way.
    inTown(w, 'c', 1, 2, { wet: 0.6 });
    w.teleport('a', 8, 5, 2000);
    w.visit('c', 'a', 2000);
    w.teleport('c', 4, 1, 3000);
    expect(w.get('c')).toMatchObject({ map: 'town' });
    expect(w.get('c')!.wet).toBeGreaterThan(0);
  });
});

describe('homes over the network', () => {
  it('keep visitors out, then let a friend in by the friends list, tell the owner, show the house as it is built up, and send a blocked visitor home', async () => {
    setLogLevel('silent');
    let now = 1_000_000;
    const storage = new MemoryStorage();
    const server = await startServer({ ...serverDefaults(), storage, maps: homeMaps(), items: items(), weather: 'overcast', clock: () => now });
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
    // Signed in (friends and blocks need it): Ann in town, Bob at home with his stove, his shelf and what stands on it.
    const saved = (name: string, more: Partial<PlayerRecord> = {}) =>
      savedPlayer(storage, { name, authSub: `dev:${name.toLowerCase()}@example.test`, map: 'house', x: 1, y: 2, dir: 'up', homeTold: true, ...more });
    try {
      const ann = await hello(await saved('Ann', { map: 'town', x: 1, y: 2 }));
      const bob = await hello(await saved('Bob', { furniture: ['stove', 'shelf'], stash: { items: { pebble: 1, nail: 9, moss: 2 }, out: {} } }));
      expect(bob.welcome.house).toBe(1);
      // They become friends.
      ann.c.send({ t: 'befriend', id: bob.id });
      await bob.c.next('friends', m => m.incoming.length === 1);
      bob.c.send({ t: 'answer', id: ann.id, yes: true });
      expect((await ann.c.next('friends', m => m.friends.length === 1)).friends).toEqual([{ id: bob.id, name: 'Bob', map: 'house' }]);

      // Bob keeps visitors out: saved at once, and Ann's list says so.
      bob.c.send({ t: 'visitsOff', off: true });
      expect(await bob.c.next('visitsOff')).toEqual({ t: 'visitsOff', off: true });
      expect((await ann.c.next('friends', m => m.friends[0]?.closed === true)).friends[0]).toEqual({ id: bob.id, name: 'Bob', map: 'house', closed: true });
      await waitFor(() => storage.get(bob.id)?.visitsOff === true, 'the setting to be saved');
      ann.c.send({ t: 'visit', id: bob.id });
      expect(await ann.c.next('refused')).toEqual({ t: 'refused', action: 'visit', reason: 'closed' });

      // A while later he lets friends in again. Ann visits: she stands by his teleport and sees his stove, his
      // shelf and the pebble on it; Bob reads that she came.
      now += VISITS_EVERY_MS;
      bob.c.send({ t: 'visitsOff', off: false });
      await bob.c.next('visitsOff', m => !m.off);
      await ann.c.next('friends', m => !m.friends[0]?.closed);
      ann.c.send({ t: 'visit', id: bob.id });
      expect(await ann.c.next('zone')).toMatchObject({ map: { id: 'house' }, x: 4, y: 2, dir: 'down', furniture: ['stove', 'shelf'], visit: { name: 'Bob', house: 1, trophies: ['pebble'] } });
      expect(await bob.c.next('visited')).toEqual({ t: 'visited', name: 'Ann' });
      expect(server.world.zoneOf(ann.id)).toBe(zoneKey('house', bob.id));

      // Bob builds his house up at the workbench, from his stash: Ann, looking round, sees it stand so.
      bob.c.send({ t: 'build', x: 1, y: 1 });
      expect(await bob.c.next('did')).toEqual({ t: 'did', did: { kind: 'built', level: 2 } });
      expect(await ann.c.next('house')).toEqual({ t: 'house', level: 2 });
      await waitFor(() => storage.get(bob.id)?.house === 2, 'the house to be saved');

      // Bob blocks her: she is sent home at once, in front of her own teleport.
      bob.c.send({ t: 'block', id: ann.id, on: true });
      expect(await ann.c.next('zone')).toMatchObject({ map: { id: 'house' }, x: 4, y: 2, dir: 'down' });
      expect(server.world.zoneOf(ann.id)).toBe(zoneKey('house', ann.id));
      // And out by NAPO's teleport: in town, in front of its twin.
      ann.c.send({ t: 'teleport', x: 4, y: 1 });
      expect(await ann.c.next('zone', m => m.map.id === 'town')).toMatchObject({ x: 8, y: 6, dir: 'down' });
    } finally {
      for (const c of clients) c.ws.terminate();
      await server.stop();
    }
  });

  it('show a home whose owner is away as storage keeps it, read as the server starts', async () => {
    setLogLevel('silent');
    const now = 1_000_000;
    const storage = new MemoryStorage();
    // Bob has not been online on this server: his furniture, his stash and his house are in storage.
    const bob = await savedPlayer(storage, { name: 'Bob', authSub: 'dev:bob@example.test', map: 'house', x: 2, y: 2, dir: 'down', furniture: ['shelf'], stash: { items: { 'shard-cap': 1 }, out: {} }, house: 3 });
    const ann = await savedPlayer(storage, { name: 'Ann', authSub: 'dev:ann@example.test', map: 'town', x: 1, y: 2, dir: 'down', homeTold: true });
    await storage.setLink(ann.id, bob.id, 'friend', true);
    await storage.setLink(bob.id, ann.id, 'friend', true);
    const server = await startServer({ ...serverDefaults(), storage, maps: homeMaps(), items: items(), weather: 'overcast', clock: () => now });
    const c = await Client.open(server.port);
    try {
      c.send({ t: 'hello', v: PROTOCOL_VERSION, token: ann.token });
      await c.next('welcome');
      // Her friends list comes once whom she blocks is known (World.returned): then a visit may go.
      await c.next('friends');
      c.send({ t: 'visit', id: bob.id });
      expect(await c.next('zone')).toMatchObject({ map: { id: 'house' }, furniture: ['shelf'], visit: { name: 'Bob', house: 3, trophies: ['shard-cap'] } });
    } finally {
      c.ws.terminate();
      await server.stop();
    }
  });
});
