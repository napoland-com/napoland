/**
 * Zones: the copies of a map. Each map's main copy is the world everyone shares; any other copy is a
 * zone of its own, with its own players (who hears whom), finds, piles, marks, fires, creatures, flares
 * and flashes, while the sky, the surge and storm clocks and the day's conditions stay the map's, and
 * the Old Stone the world's. Which copy an exit leads into is decided in one place (World.copyFor): so
 * that each copy can be tried here without a crowd to open it, these tests give the World a plan of their
 * own (Copies). The crowds that open copies in the game are crowds.test.ts's. World rules first, then over
 * real WebSockets.
 *
 * The fixture town (fixtures.ts) has a second way out here, at 0,0, up into a field of the wilds that
 * arrives on 4,10; the field's way home at 4,11 leads back to the town's 0,1, where the players start.
 */
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  ENERGY_MAX, FIRE_MAX_S, SLUMP_S, STEP_MS, TileMap, conditionsAt, DAY_S,
  type ConditionsData, type Dir, type ItemsData, type MapData, type ServerMsg,
} from '@napoland/shared';
import { Calls } from '../src/calls';
import { Chat } from '../src/chat';
import { createHttpServer } from '../src/http';
import { setLogLevel } from '../src/log';
import { attachNet } from '../src/net';
import { MemoryStorage, type DropRecord, type MarkRecord, type PlayerRecord } from '../src/storage';
import { WATCHER_STEP_MS, World, colorFor, zoneKey, type Outgoing, type WorldOptions } from '../src/world';
import { houseData, townData, woodsData } from './fixtures';
import { loginTo, savedPlayer, type Client } from './helpers';

/** A World whose exits lead each player into the copy of a map the test planned for them (none planned: the main copy). */
class Copies extends World {
  private readonly plan = new Map<string, string>();

  protected override copyFor(player: PlayerRecord, map: TileMap): string {
    return this.plan.get(`${map.data.id} ${player.id}`) ?? '';
  }

  /** From now on, player `id` walks into copy `copy` of map `map`. */
  send(id: string, map: string, copy: string): this {
    this.plan.set(`${map} ${id}`, copy);
    return this;
  }
}

/** Two copies of the field, keyed so that a client would give them away if it ever heard one. */
const X = 'copy-x-7f3a', Y = 'copy-y-91c2';
const FX = zoneKey('field', X), FY = zoneKey('field', Y);

function town(): MapData {
  const t = townData();
  return { ...t, exits: [...t.exits, { x: 0, y: 0, w: 1, h: 1, to: 'field', tx: 4, ty: 10, dir: 'up' }] };
}

/** Open grass 8 by 10 inside the forest, its way home at 4,11: steps from home are |x - 4| + (11 - y). A campfire that burns down at 4,4. */
function field(more: Partial<MapData> = {}): MapData {
  const h = 12;
  return {
    id: 'field', name: 'The Field', version: 1, kind: 'wilds', depth: 1, width: 10, height: h,
    tiles: Array.from({ length: h }, (_, y) => (y === 0 ? 'tttttttttt' : y === h - 1 ? 'ttttgttttt' : 'tggggggggt')),
    levels: Array<string>(h).fill('0000000000'),
    spawn: { x: 4, y: h - 2, dir: 'up' },
    exits: [{ x: 4, y: h - 1, w: 1, h: 1, to: 'town', tx: 0, ty: 1, dir: 'down', home: true }],
    objects: [{ kind: 'fireplace', x: 4, y: 4 }],
    ...more,
  };
}

const ITEMS: ItemsData = {
  version: 1,
  items: [
    { id: 'moss', name: 'Moss', kind: 'resource', stack: 10, text: 'Soft.' },
    { id: 'twig', name: 'Twig', kind: 'resource', stack: 10, text: 'Dry.', fuel: 120 },
    { id: 'cap', name: 'Glowcap', kind: 'resource', stack: 20, text: 'Glows.', use: { mark: true } },
    { id: 'flare', name: 'Flare', kind: 'consumable', stack: 3, text: 'Red.', use: { flare: 30 } },
    { id: 'shard', name: 'Shard', kind: 'resource', stack: 5, text: 'Warm.', charge: 1 },
  ],
  // One moss at a time, on 4,8: two steps up from where the field is reached.
  finds: [{ item: 'moss', map: 'field', around: { x: 4, y: 8, r: 0 }, count: 1, respawn: [10, 10] }],
};

const maps = (more: Partial<MapData> = {}) => [new TileMap(town()), new TileMap(field(more)), new TileMap(houseData()), new TileMap(woodsData())];

/** A player in the town on 0,1, below the way up into the field, with a full bar unless `more` says otherwise. */
const rec = (id: string, more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map: 'town', x: 0, y: 1, dir: 'up', color: colorFor(id), energy: ENERGY_MAX, bag: [], createdAt: 1, lastSeenAt: 1,
  ...more,
});

/** The world of the town, the field (with `more`), the house and the woods; players join at 0, and what that said and wrote is drained. */
function world(more: Partial<MapData> = {}, options: WorldOptions = {}, ...players: PlayerRecord[]): Copies {
  const w = new Copies(maps(more), 'town', 'overcast', { items: ITEMS, rng: () => 0, ...options });
  for (const p of players) w.join(p, 0);
  w.drain();
  w.takeWrites();
  return w;
}

let seq = 0;
/** Player `id` walks one step each way of `dirs`, a step's time apart from `at`; returns the time after the last. */
function walk(w: World, id: string, dirs: Dir[], at: number): number {
  for (const dir of dirs) {
    w.step(id, dir, ++seq, at);
    at += STEP_MS;
  }
  return at;
}

const viewOf = (id: string, x: number, y: number, dir: Dir) => ({ id, name: id.toUpperCase(), x, y, dir, color: colorFor(id), gear: {}, quirks: [] });
/** The messages in `out` for everyone in zone `zone`, in order. */
const heardOn = (out: Outgoing[], zone: string) => out.flatMap(o => ('map' in o && o.map === zone ? [o.msg] : []));
/** What player `id` hears for themselves: messages for them, and those for everyone online. */
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id || o.to === 'all' ? [o.msg] : []));
const of = <T extends ServerMsg['t']>(msgs: ServerMsg[], t: T) => msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
const noEnergy = (out: Outgoing[]) => out.filter(o => o.msg.t !== 'energy');
const MAIN = ['town', 'field', 'house', 'woods'];

describe('copies of a map', () => {
  it('are not there while nobody crowds a place: every exit goes into the main copy, the world everyone shares', () => {
    const w = new World(maps(), 'town', 'overcast', { items: ITEMS });
    w.join(rec('a'), 0);
    walk(w, 'a', ['up', 'up', 'down'], 1000);
    expect(w.zoneOf('a')).toBe('field');
    expect(w.zoneKeys()).toEqual(MAIN);
    expect(w.get('a')!.zone).toBeUndefined();
  });

  it('never hear each other, nor the main copy: each has its own players, and the client hears only the map', () => {
    const w = world({}, {}, rec('a', { authSub: 'dev:a' }), rec('b', { authSub: 'dev:b' }), rec('c', { authSub: 'dev:c' }));
    w.send('a', 'field', X).send('b', 'field', Y);
    w.step('a', 'up', 1, 1000);
    const went = noEnergy(w.drain());
    expect(went).toEqual([
      { to: 'a', msg: { t: 'step', id: 'a', x: 0, y: 0, dir: 'up', seq: 1 } },
      { to: '*', map: 'town', except: 'a', msg: { t: 'step', id: 'a', x: 0, y: 0, dir: 'up' } },
      { to: '*', map: 'town', except: 'a', msg: { t: 'leave', id: 'a' } },
      { to: '*', map: FX, except: 'a', msg: { t: 'join', player: viewOf('a', 4, 10, 'up') } },
      { to: 'a', msg: expect.objectContaining({ t: 'zone', map: { id: 'field', version: 1 }, players: [viewOf('a', 4, 10, 'up')], reason: 'exit' }), zone: FX },
    ]);
    // Whichever copy it is, the client hears the map, never the copy's key.
    expect(JSON.stringify(went.map(o => o.msg))).not.toContain(X);
    w.step('b', 'up', 1, 1000);
    w.step('c', 'up', 1, 1000);
    const zones = of(w.drain().flatMap(o => o.msg), 'zone');
    expect(zones.map(z => z.players.map(p => p.id))).toEqual([['b'], ['c']]);
    expect([w.views(FX), w.views(FY), w.views('field')].map(v => v.map(p => p.id))).toEqual([['a'], ['b'], ['c']]);
    expect([w.zoneOf('a'), w.zoneOf('b'), w.zoneOf('c')]).toEqual([FX, FY, 'field']);

    // All three stand on 4,10: what a does is heard in a's copy alone.
    w.face('a', 'left');
    walk(w, 'a', ['up'], 1200);
    expect(noEnergy(w.drain())).toEqual([
      { to: '*', map: FX, except: 'a', msg: { t: 'face', id: 'a', dir: 'left' } },
      { to: 'a', msg: { t: 'step', id: 'a', x: 4, y: 9, dir: 'up', seq } },
      { to: '*', map: FX, except: 'a', msg: { t: 'step', id: 'a', x: 4, y: 9, dir: 'up' } },
    ]);
    // Nor does local chat reach past the copy, however near.
    const heard: string[] = [];
    const chat = new Chat({ world: w, words: [], clock: () => 0, online: () => ['a', 'b', 'c'], blocks: () => new Set(), send: (id, m) => void (m.t === 'said' && heard.push(id)) });
    chat.say('b', 'local', 'anyone here?');
    chat.say('c', 'local', 'hello?');
    expect(heard).toEqual(['b', 'c']);
    // The record says the copy (the main copy is none), so a reconnect can go back into it.
    expect([w.get('a')!.zone, w.get('b')!.zone, w.get('c')!.zone]).toEqual([X, Y, undefined]);
  });

  it('each grow their own finds: a find picked in one is still there in the others, and grows back where it went', () => {
    const w = world({}, {}, rec('a'), rec('c'));
    w.send('a', 'field', X);
    walk(w, 'a', ['up', 'up'], 1000);
    walk(w, 'c', ['up', 'up'], 1000);
    const [mine] = w.findViews(FX), [theirs] = w.findViews('field');
    expect(mine).toMatchObject({ item: 'moss', x: 4, y: 8 });
    expect(theirs).toMatchObject({ item: 'moss', x: 4, y: 8 });
    expect(mine!.id).not.toBe(theirs!.id);
    w.drain();
    w.pick('a', 4, 8, 2000);
    const out = w.drain();
    expect(to(out, 'a')).toContainEqual({ t: 'got', items: [{ item: 'moss', count: 1 }], from: 'find' });
    expect(heardOn(out, FX)).toEqual([{ t: 'findGone', id: mine!.id }]);
    expect(heardOn(out, 'field')).toEqual([]);
    expect([w.findViews(FX), w.findViews('field')]).toEqual([[], [theirs]]);
    // Ten seconds later it grows back in that copy, and only there.
    w.tick(12_000);
    const grown = w.findViews(FX);
    expect(grown).toMatchObject([{ item: 'moss', x: 4, y: 8 }]);
    expect(heardOn(w.drain(), FX)).toContainEqual({ t: 'find', find: grown[0] });
    expect(w.findViews('field')).toEqual([theirs]);
  });

  it('keep a pile in the copy it fell in, and there it is again after a restart', () => {
    const storage: DropRecord[] = [];
    const w = world({}, {}, rec('a', { energy: 1, bag: [{ item: 'moss', count: 3 }] }), rec('c'));
    w.send('a', 'field', X);
    walk(w, 'a', ['up'], 1000);
    walk(w, 'c', ['up'], 1000);
    w.drain();
    // 1 energy lasts about 4 s a step from home: a goes down on 4,10 of the copy, nobody comes, and a falls
    // there and wakes up at home.
    w.tick(10_000);
    w.drain();
    const at = 10_000 + SLUMP_S * 1000;
    w.tick(at);
    const fell = w.drain();
    const pile = { id: 'a', x: 4, y: 10, owner: 'a', name: 'A', until: at + 3_600_000, trail: [] };
    expect(heardOn(fell, FX)).toContainEqual({ t: 'drop', drop: pile });
    expect(heardOn(fell, 'field').filter(m => m.t === 'drop')).toEqual([]);
    expect(w.dropViews(FX)).toEqual([pile]);
    expect(w.dropViews('field')).toEqual([]);
    expect(w.zoneOf('a')).toBe('town');
    const writes = w.takeWrites();
    expect(writes.drops).toEqual([{ owner: 'a', drop: { owner: 'a', name: 'A', map: 'field', zone: X, x: 4, y: 10, items: [{ item: 'moss', count: 3 }], droppedAt: at, trail: [], owed: {} } }]);
    storage.push(writes.drops[0]!.drop!);
    // Right where it lies, but in the main copy: nothing there.
    w.pick('c', 4, 10, at + 1000);
    expect(to(w.drain(), 'c')).toEqual([{ t: 'refused', action: 'pick', reason: 'gone' }]);
    // Nobody is left in the copy: it closes, and its pile stays, as storage keeps it.
    w.tick(at + 2000);
    expect(w.zoneKeys()).toEqual(MAIN);
    expect(w.dropViews(FX)).toEqual([pile]);

    const again = new Copies(maps(), 'town', 'overcast', { items: ITEMS, rng: () => 0, drops: storage });
    expect(again.dropViews(FX)).toEqual([pile]);
    expect(again.dropViews('field')).toEqual([]);
    again.send('a', 'field', X).join(rec('a'), at + 20_000);
    walk(again, 'a', ['up'], at + 20_000);
    const [zone] = of(to(again.drain(), 'a'), 'zone');
    expect(zone!.drops).toEqual([pile]);
    again.pick('a', 4, 10, at + 21_000);
    expect(to(again.drain(), 'a')[0]).toEqual({ t: 'got', items: [{ item: 'moss', count: 3 }], from: 'drop' });
  });

  it('keep the copy of a pile and of a mark in storage, none for the main copy', async () => {
    const s = new MemoryStorage();
    const a = await savedPlayer(s);
    const pile: DropRecord = { owner: a.id, name: a.name, map: 'field', zone: X, x: 4, y: 10, items: [{ item: 'moss', count: 1 }], droppedAt: Date.now(), trail: [] };
    await s.saveDrop(pile);
    expect(await s.loadDrops(0)).toEqual([pile]);
    await s.saveDrop({ ...pile, zone: '' });
    expect(await s.loadDrops(0)).toEqual([{ ...pile, zone: undefined }]);
    expect((await s.loadDrops(0))[0]).not.toHaveProperty('zone');
    const mark: MarkRecord = { id: 5, owner: a.id, name: a.name, color: '#fff', map: 'field', zone: X, x: 4, y: 9, dir: 'up', placedAt: Date.now() };
    await s.saveMark(mark);
    expect(await s.loadMarks(Date.now(), 86_400_000)).toEqual([{ ...mark, name: a.name, color: colorFor(a.id) }]);
    // And a player's copy, forgotten once a save says the main copy.
    const saved = s.get(a.id)!;
    await s.save({ ...saved, map: 'field', zone: X });
    expect(s.get(a.id)).toMatchObject({ map: 'field', zone: X });
    await s.save({ ...saved, map: 'field', zone: undefined });
    expect(s.get(a.id)).not.toHaveProperty('zone');
  });

  it('each paint their own marks and burn their own flares', () => {
    const w = world({}, {}, rec('a', { bag: [{ item: 'cap', count: 2 }, { item: 'flare', count: 1 }] }), rec('c', { bag: [{ item: 'cap', count: 1 }] }));
    w.send('a', 'field', X);
    walk(w, 'a', ['up'], 1000);
    walk(w, 'c', ['up'], 1000);
    w.drain();
    w.use('a', 0, 1200);
    // The same tile of another copy is free to paint.
    w.use('c', 0, 1200);
    const out = w.drain();
    expect(of(heardOn(out, FX), 'mark')).toHaveLength(1);
    expect(of(heardOn(out, 'field'), 'mark')).toHaveLength(1);
    expect(w.takeWrites().marks.map(m => [m.mark!.owner, m.mark!.zone])).toEqual([['a', X], ['c', undefined]]);
    expect([w.scene(FX, 1200).marks, w.scene('field', 1200).marks].map(m => m.map(v => v.name))).toEqual([['A'], ['C']]);
    // A mark in one copy is only there.
    w.use('a', 0, 1300);
    expect(to(w.drain(), 'a')).toContainEqual({ t: 'refused', action: 'use', reason: 'marked' });
    w.use('a', 1, 1300);
    const lit = w.drain();
    expect(heardOn(lit, FX)).toContainEqual({ t: 'flare', flare: { x: 4, y: 10, left: 30 } });
    expect(w.scene(FX, 1300).flares).toHaveLength(1);
    expect(w.scene('field', 1300).flares).toEqual([]);
  });

  it('each have their own fires: fed or burning down apart from the main copy\'s, and a tended one stays tended', () => {
    const w = world({}, {}, rec('a', { bag: [{ item: 'twig', count: 5 }] }), rec('c'));
    // rng 0: a fire that burns down starts half full, in the main copy at start-up and in a copy when it opens.
    const half = FIRE_MAX_S / 2;
    w.send('a', 'field', X).send('a', 'house', X);
    w.tick(100_000);
    walk(w, 'a', ['up'], 100_000);
    expect(w.scene('field', 100_000).fires).toEqual([{ x: 4, y: 4, left: half - 100 }]);
    expect(w.scene(FX, 100_000).fires).toEqual([{ x: 4, y: 4, left: half }]);
    // Up to the fire (4,5 is next to it), and a feeds the copy's.
    const at = walk(w, 'a', ['up', 'up', 'up', 'up', 'up'], 100_200);
    w.drain();
    w.feed('a', 4, 4, 0, at, 2);
    const out = w.drain();
    // The copy's fire remembers who fed it (whoever warms there may thank them); the main copy's fed by nobody.
    expect(heardOn(out, FX)).toEqual([{ t: 'fire', fire: { x: 4, y: 4, left: Math.round(half - (at - 100_000) / 1000 + 240), fed: [{ id: 'a', name: 'A' }] } }]);
    expect(heardOn(out, 'field')).toEqual([]);
    expect(w.scene('field', at).fires).toEqual([{ x: 4, y: 4, left: Math.round(half - at / 1000) }]);
    // A room off town keeps its fire going in every copy of it.
    const home = walk(w, 'a', ['down', 'down', 'down', 'down', 'down', 'down'], at + 200);
    expect(w.zoneOf('a')).toBe('town');
    w.drain();
    // From the town's 0,1 to the door of the house at 7,2: down to 0,3, along row 3, up through the door.
    walk(w, 'a', ['down', 'down', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'up'], home);
    expect(w.zoneOf('a')).toBe(zoneKey('house', X));
    expect(w.scene(zoneKey('house', X), home).fires).toEqual([{ x: 2, y: 1, left: null }]);
  });

  it('each have their own creatures: a watcher comes for whoever is in its copy, and those of the others stay where they are', () => {
    const w = world({ watchers: { count: 1, steps: [4, 99] } }, {}, rec('a', { bag: [{ item: 'moss', count: 1 }] }));
    w.send('a', 'field', X);
    // The main copy's watcher wakes on the first tick, nobody near; the copy's once a has walked in.
    w.tick(0);
    walk(w, 'a', ['up'], 1000);
    w.tick(1000);
    const [main] = w.scene('field', 1000).creatures, [mine] = w.scene(FX, 1000).creatures;
    expect(main).toMatchObject({ kind: 'watcher', x: 1, y: 1 });
    expect(mine).toMatchObject({ kind: 'watcher', x: 1, y: 1 });
    expect(mine!.id).not.toBe(main!.id);
    // a walks up to 4,6 and turns its back on it (facing down): it comes, in a's copy alone.
    const at = walk(w, 'a', ['up', 'up', 'up', 'up'], 1200);
    w.face('a', 'down');
    w.drain();
    let touched: Extract<ServerMsg, { t: 'touched' }> | undefined;
    const moves: Array<{ zone: string; id: number }> = [];
    for (let t = at; t < at + 40 * WATCHER_STEP_MS && !touched; t += WATCHER_STEP_MS) {
      w.tick(t);
      const out = w.drain();
      for (const z of ['field', FX]) for (const m of of(heardOn(out, z), 'creature')) moves.push({ zone: z, id: m.creature.id });
      touched = of(to(out, 'a'), 'touched')[0];
    }
    expect(touched).toEqual({ t: 'touched', by: 'watcher', lost: 'moss' });
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every(m => m.zone === FX && m.id === mine!.id)).toBe(true);
    expect(w.scene('field', at).creatures).toEqual([main]);
  });

  it('share their map\'s clocks: every copy hears the surge and the storm at the same moment, and the weather', () => {
    const w = world({ surge: { every: 100, unstable: 20, surge: 20, sweep: 10 }, storm: { every: 100, warn: 10, length: 20 } }, {}, rec('a'), rec('c'));
    w.send('a', 'field', X);
    walk(w, 'a', ['up'], 1000);
    walk(w, 'c', ['up'], 1000);
    w.tick(1000);
    w.drain();
    expect(w.scene(FX, 1000).surge).toEqual(w.scene('field', 1000).surge);
    w.tick(60_000);
    const restless = w.drain();
    for (const zone of ['field', FX]) expect(of(heardOn(restless, zone), 'surge')).toEqual([{ t: 'surge', surge: { phase: 'unstable', left: 20, into: 0 } }]);
    w.tick(70_000);
    const coming = w.drain();
    for (const zone of ['field', FX]) expect(of(heardOn(coming, zone), 'storm')).toEqual([{ t: 'storm', storm: { phase: 'coming', left: 10 } }]);
    w.setWeather('night', 71_000);
    expect(of(w.drain().flatMap(o => ('map' in o ? [{ ...o.msg, zone: o.map }] : [])), 'weather')).toEqual([
      { t: 'weather', weather: 'night', zone: 'field' },
      { t: 'weather', weather: 'night', zone: FX },
    ]);
  });

  it('share the day\'s conditions: the fire that went out overnight is out in a copy that opens that day too', () => {
    const DAY_MS = DAY_S * 1000;
    const conditions: ConditionsData = {
      seed: 1, second: 0, weekly: [],
      daily: [{ id: 'out', name: 'Out', text: 'A fire went out.', weight: 1, map: 'field', fireOut: true }, { id: 'calm', name: 'Calm', text: 'Calm.', weight: 1, map: 'field' }],
    };
    let dawn = 20_000 * DAY_MS;
    while (!(conditionsAt(conditions, dawn - 1).today[0] === 'calm' && conditionsAt(conditions, dawn).today[0] === 'out')) dawn += DAY_MS;
    const w = world({}, { items: { ...ITEMS, conditions }, epochOffset: dawn - 1000 }, rec('a'));
    w.send('a', 'field', X);
    w.tick(0);
    w.tick(1000);
    expect(w.scene('field', 1000).fires).toEqual([{ x: 4, y: 4, left: 0 }]);
    walk(w, 'a', ['up'], 5000);
    expect(w.scene(FX, 5000).fires).toEqual([{ x: 4, y: 4, left: 0 }]);
  });

  it('share the Old Stone: shards fed to it from any copy go into the one stone, and everyone online hears it', () => {
    const w = world({ objects: [{ kind: 'stone', x: 4, y: 9 }] }, {}, rec('a', { bag: [{ item: 'shard', count: 2 }] }), rec('c', { bag: [{ item: 'shard', count: 1 }] }));
    w.send('a', 'field', X);
    walk(w, 'a', ['up'], 1000);
    walk(w, 'c', ['up'], 1000);
    w.drain();
    w.feed('a', 4, 9, 0, 1200, 2);
    w.feed('c', 4, 9, 0, 1200, 1);
    const out = w.drain();
    expect(of(to(out, 'c'), 'stone').map(m => m.stone.charge)).toEqual([2, 3]);
    expect(w.stoneView(1200).charge).toBe(3);
  });

  it('cost nothing once empty: a copy closes on the tick after its last player left, and opens afresh', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `p${i}`);
    const w = world({}, {}, ...ids.map(id => rec(id, { bag: [{ item: 'twig', count: 1 }] })));
    for (const id of ids) w.send(id, 'field', `own-${id}`);
    for (const id of ids) walk(w, id, ['up'], 1000);
    expect(w.zoneKeys()).toEqual([...MAIN, ...ids.map(id => zoneKey('field', `own-${id}`))]);
    // Everyone goes home or leaves: until the next tick the copies are still there, then they are gone.
    for (const id of ids.slice(0, 10)) walk(w, id, ['down'], 1200);
    for (const id of ids.slice(10)) w.leave(id, 1200);
    expect(w.zoneKeys()).toHaveLength(MAIN.length + ids.length);
    w.tick(1400);
    expect(w.zoneKeys()).toEqual(MAIN);
    w.drain();
    // Nothing of them is heard of again.
    for (let t = 2000; t < 60_000; t += 1000) w.tick(t);
    expect(w.drain().filter(o => 'map' in o && !MAIN.includes(o.map))).toEqual([]);

    // Out and back in before the tick, a copy is the same one: its fire as it was fed. Out, a tick, and
    // in again, it opens afresh: its fire starts half full again (rng 0), as when it first opened.
    const p = 'p0', copy = zoneKey('field', 'own-p0'), left = (t: number) => w.scene(copy, t).fires[0]!.left!;
    const at = walk(w, p, ['up', 'up', 'up', 'up', 'up', 'up'], 60_000);
    w.feed(p, 4, 4, 0, at);
    expect(left(at)).toBe(Math.round(FIRE_MAX_S / 2 - (at - 60_000) / 1000 + 120));
    const back = walk(w, p, ['down', 'down', 'down', 'down', 'down', 'down', 'up'], at + 200);
    expect(w.zoneOf(p)).toBe(copy);
    expect(left(back)).toBeGreaterThan(FIRE_MAX_S / 2 + 100);
    const out = walk(w, p, ['down'], back);
    w.tick(out);
    expect(w.zoneKeys()).toEqual(MAIN);
    walk(w, p, ['up'], out);
    expect(left(out)).toBe(FIRE_MAX_S / 2);
  });

  it('take a player back into the copy they were in while someone is still in it, else wherever copyFor sends anyone coming in', () => {
    const w = world({}, {}, rec('a'), rec('b'));
    w.send('a', 'field', X).send('b', 'field', X);
    walk(w, 'a', ['up'], 1000);
    walk(w, 'b', ['up'], 1000);
    const saved = w.leave('a', 2000)!;
    expect(saved).toMatchObject({ map: 'field', zone: X, x: 4, y: 10 });
    const back = w.join(saved, 3000);
    expect(w.zoneOf('a')).toBe(FX);
    expect(back.players.map(p => p.id)).toEqual(['b', 'a']);
    const again = w.leave('a', 4000)!;
    w.leave('b', 4000);
    w.tick(5000);
    // Closed: the plan is asked again. With another copy planned, that one; with none, the main copy.
    w.send('a', 'field', Y);
    w.join(again, 6000);
    expect(w.zoneOf('a')).toBe(FY);
    const last = w.leave('a', 6500)!;
    w.tick(6600);
    w.send('a', 'field', '');
    w.join(last, 6700);
    expect(w.zoneOf('a')).toBe('field');
    expect(w.get('a')!.zone).toBeUndefined();
    // A copy of a map that is gone means nothing either: home, to the main copy.
    w.leave('a', 7000);
    w.join({ ...again, map: 'gone', zone: X }, 8000);
    expect(w.zoneOf('a')).toBe('town');
  });
});

describe('copies of a map, and what came with the thanks, the crates and the calls', () => {
  it('thank only in their own copy: a fire remembers who fed it there, an arrow is followed there', () => {
    const w = world({}, {}, rec('a', { bag: [{ item: 'twig', count: 1 }, { item: 'cap', count: 1 }] }), rec('b'), rec('d'));
    w.send('a', 'field', X).send('d', 'field', X);
    for (const id of ['a', 'b', 'd']) walk(w, id, ['up', 'up', 'up', 'up', 'up', 'up'], 1000);
    // All three on 4,5, next to the fire: a feeds the copy's and paints an arrow there, pointing up.
    w.feed('a', 4, 4, 0, 2400);
    w.use('a', 0, 2400);
    const mark = w.scene(FX, 2400).marks[0]!;
    w.drain();
    // In the main copy nobody fed its fire, and there is no such arrow.
    w.thank('b', 'a', { kind: 'fire', x: 4, y: 4 }, 2500);
    w.thank('b', 'a', { kind: 'mark', id: mark.id }, 2500);
    expect(to(w.drain(), 'b').filter(m => m.t === 'refused')).toEqual([
      { t: 'refused', action: 'thank', reason: 'gone' },
      { t: 'refused', action: 'thank', reason: 'gone' },
    ]);
    // In a's copy the thanks goes through, and reaches a.
    w.thank('d', 'a', { kind: 'fire', x: 4, y: 4 }, 2500);
    const out = w.drain();
    expect(of(to(out, 'd'), 'did')).toEqual([{ t: 'did', did: { kind: 'thanked', who: 'a', name: 'A', what: 'fire' } }]);
    expect(of(to(out, 'a'), 'thanked')).toHaveLength(1);
  });

  it('each keep their own crates: a thing left in one is there alone, and there again after a restart', () => {
    const crate = { objects: [{ kind: 'fireplace' as const, x: 4, y: 4 }, { kind: 'cache' as const, x: 6, y: 9, name: 'The crate' }] };
    const w = world(crate, {}, rec('a', { bag: [{ item: 'moss', count: 1 }] }), rec('c'));
    w.send('a', 'field', X);
    // Both on 6,10, right in front of the crate, each in their own copy.
    for (const id of ['a', 'c']) walk(w, id, ['up', 'right', 'right'], 1000);
    w.drain();
    w.cacheLeave('a', 6, 9, 0, 2000);
    w.openCache('c', 6, 9, 2000);
    const out = w.drain();
    expect(of(to(out, 'a'), 'cache').at(-1)!.items.map(i => i.item)).toEqual(['moss']);
    expect(of(to(out, 'c'), 'cache')).toEqual([{ t: 'cache', x: 6, y: 9, items: [], left: false, took: false }]);
    const [left] = w.takeWrites().caches;
    expect(left!.item).toMatchObject({ map: 'field', zone: X, x: 6, y: 9, item: 'moss', owner: 'a' });

    const again = new Copies(maps(crate), 'town', 'overcast', { items: ITEMS, rng: () => 0, cacheItems: [left!.item!] });
    again.send('d', 'field', X).join(rec('d'), 0);
    again.join(rec('e'), 0);
    for (const id of ['d', 'e']) walk(again, id, ['up', 'right', 'right'], 1000);
    again.drain();
    for (const id of ['d', 'e']) again.openCache(id, 6, 9, 2000);
    const seen = again.drain();
    expect(of(to(seen, 'd'), 'cache')[0]!.items).toMatchObject([{ item: 'moss', owner: 'a' }]);
    expect(of(to(seen, 'e'), 'cache')[0]!.items).toEqual([]);
  });

  it('keep a call in the caller\'s copy', () => {
    const w = world({}, {}, rec('a'), rec('b'), rec('c'));
    w.send('a', 'field', X).send('b', 'field', X);
    for (const id of ['a', 'b', 'c']) walk(w, id, ['up'], 1000);
    const heard: string[] = [];
    const calls = new Calls({ world: w, clock: () => 0, blocks: () => new Set(), send: (id, m) => void (m.t === 'called' && heard.push(id)) });
    calls.call('a', 'here');
    expect(heard).toEqual(['a', 'b']);
  });
});

describe('copies over the network', () => {
  it('keep two players in two copies of a map apart, and tell friends only the map', async () => {
    setLogLevel('silent');
    const storage = new MemoryStorage();
    const w = new Copies(maps(), 'town', 'overcast', { items: ITEMS });
    const http = createHttpServer({ players: () => w.size });
    const net = attachNet({ server: http, world: w, storage, maxPlayers: 10, helloTimeoutMs: 500 });
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', () => resolve()));
    const tick = setInterval(() => net.tick(), 20);
    const clients: Client[] = [];
    try {
      const port = (http.address() as AddressInfo).port;
      const [a, b] = [await savedPlayer(storage, { map: 'town', x: 0, y: 1, dir: 'up' }), await savedPlayer(storage, { map: 'town', x: 0, y: 1, dir: 'up' })];
      w.send(a.id, 'field', X).send(b.id, 'field', Y);
      const ca = (await loginTo(port, a.token)).c, cb = (await loginTo(port, b.token)).c;
      clients.push(ca, cb);
      ca.send({ t: 'step', dir: 'up', seq: 1 });
      const zone = await ca.next('zone');
      expect(zone).toMatchObject({ map: { id: 'field', version: 1 }, players: [{ id: a.id }] });
      cb.send({ t: 'step', dir: 'up', seq: 1 });
      expect((await cb.next('zone')).players.map(p => p.id)).toEqual([b.id]);
      // (In town, b heard a go.)
      await Promise.all([ca.settle(), cb.settle()]);
      // Both on 4,10 of the field: neither hears the other walk.
      ca.send({ t: 'step', dir: 'up', seq: 2 });
      await ca.next('step');
      cb.send({ t: 'face', dir: 'left' });
      expect((await cb.settle()).filter(m => m.t !== 'energy')).toEqual([]);
      expect((await ca.settle()).filter(m => m.t !== 'energy')).toEqual([]);
      // Friends see where each other is by the map alone.
      ca.send({ t: 'befriend', id: b.id });
      await cb.next('friends', m => m.incoming.length === 1);
      cb.send({ t: 'answer', id: a.id, yes: true });
      expect((await cb.next('friends', m => m.friends.length === 1)).friends).toEqual([{ id: a.id, name: a.name, map: 'field' }]);
      expect(JSON.stringify([...ca.inbox, ...cb.inbox, zone])).not.toContain(X);
    } finally {
      clearInterval(tick);
      for (const c of clients) c.ws.terminate();
      await net.close();
      http.closeAllConnections();
      await new Promise<void>(resolve => http.close(() => resolve()));
    }
  });
});
