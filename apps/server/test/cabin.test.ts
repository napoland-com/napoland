/**
 * Your own cabin: the home room is private, so each player who walks in through its door is in a copy
 * of it of their own (keyed by them), where nobody else ever is. New players start in it by the fire,
 * facing the room, and a collapse wakes you there too. World rules first, then over real WebSockets.
 *
 * The fixture world (fixtures.ts) with its house made a home of one's own: a chest beside the fire,
 * and a place to wake up in front of it, 2,2 facing down. Its door at the town's 7,2 leads in onto
 * 2,3; its way out at 2,4 leads back to 7,3 in front of the door, facing down.
 */
import { describe, expect, it } from 'vitest';
import { ENERGY_MAX, PROTOCOL_VERSION, TileMap, utcDay, type Dir, type MapData, type StoryData } from '@napoland/shared';
import { Chat } from '../src/chat';
import type { PlayerRecord, ThanksRecord } from '../src/storage';
import { World, colorFor, zoneKey, type Outgoing } from '../src/world';
import { houseData, itemsData, townData, woodsData } from './fixtures';
import { setup, waitFor } from './helpers';

function cabinData(): MapData {
  const h = houseData();
  return { ...h, objects: [...h.objects, { kind: 'chest', x: 3, y: 1 }], private: true, wake: { x: 2, y: 2, dir: 'down' } };
}
const cabinMaps = () => [new TileMap(townData()), new TileMap(cabinData()), new TileMap(woodsData())];

const STORY: StoryData = {
  version: 1,
  chapters: [{ id: 'home', title: 'Home', text: 'You woke up at home.' }, { id: 'stored', title: 'What glows', text: 'You put it in your chest.', when: { store: true } }],
};

const rec = (id: string, map: string, x: number, y: number, dir: Dir = 'up', more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map, x, y, dir, color: colorFor(id), energy: ENERGY_MAX, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});
const inTown = (id: string, x = 7, y = 3, more: Partial<PlayerRecord> = {}) => rec(id, 'town', x, y, 'up', more);

function world(...players: PlayerRecord[]): World {
  const w = new World(cabinMaps(), 'town', 'overcast', { items: itemsData(), story: STORY, rng: () => 0 });
  for (const p of players) w.join(p, 0);
  w.drain();
  w.takeWrites();
  return w;
}
const viewOf = (id: string, x: number, y: number, dir: Dir) => ({ id, name: id.toUpperCase(), x, y, dir, color: colorFor(id), gear: {}, quirks: [] });
const noEnergy = (out: Outgoing[]) => out.filter(o => o.msg.t !== 'energy');
const own = (id: string) => zoneKey('house', id);

describe('your own cabin', () => {
  it('is where everyone wakes up: in front of the home\'s fire, facing the room', () => {
    const w = world();
    expect(w.wakeUp).toMatchObject({ x: 2, y: 2, dir: 'down' });
    expect(w.wakeUp.map.data.id).toBe('house');
    // Without a home to wake up in, it is the home town's spawn, as it always was.
    const plain = new World([new TileMap(townData()), new TileMap(houseData()), new TileMap(woodsData())], 'town', 'overcast');
    expect(plain.wakeUp).toMatchObject({ x: 1, y: 2, dir: 'down' });
    expect(plain.wakeUp.map.data.id).toBe('town');
  });

  it('is each player\'s own: two walk in through the one door, and neither sees nor hears the other in there', () => {
    const w = world(inTown('a', 7, 3, { authSub: 'dev:a' }), inTown('b', 7, 3, { authSub: 'dev:b' }));
    w.step('a', 'up', 1, 1000);
    expect(noEnergy(w.drain())).toEqual([
      { to: 'a', msg: { t: 'step', id: 'a', x: 7, y: 2, dir: 'up', seq: 1 } },
      { to: '*', map: 'town', except: 'a', msg: { t: 'step', id: 'a', x: 7, y: 2, dir: 'up' } },
      { to: '*', map: 'town', except: 'a', msg: { t: 'leave', id: 'a' } },
      { to: '*', map: own('a'), except: 'a', msg: { t: 'join', player: viewOf('a', 2, 3, 'up') } },
      { to: 'a', msg: expect.objectContaining({ t: 'zone', map: { id: 'house', version: 1 }, players: [viewOf('a', 2, 3, 'up')], reason: 'exit' }), zone: own('a') },
    ]);
    w.step('b', 'up', 1, 1000);
    const [zone] = w.drain().flatMap(o => (o.msg.t === 'zone' ? [o.msg] : []));
    expect(zone!.players).toEqual([viewOf('b', 2, 3, 'up')]);
    expect([w.zoneOf('a'), w.zoneOf('b')]).toEqual([own('a'), own('b')]);
    // Nobody is ever in the room's main copy.
    expect(w.views('house')).toEqual([]);
    w.face('a', 'left');
    w.step('a', 'up', 2, 1200);
    expect(noEnergy(w.drain()).map(o => ('map' in o ? o.map : o.to))).toEqual([own('a'), 'a', own('a')]);
    // Local chat stays in the cabin too.
    const heard: string[] = [];
    const chat = new Chat({ world: w, words: [], clock: () => 0, online: () => ['a', 'b'], blocks: () => new Set(), send: (id, m) => void (m.t === 'said' && heard.push(id)) });
    chat.say('a', 'local', 'anyone home?');
    expect(heard).toEqual(['a']);
  });

  it('keeps each player\'s own stash at the chest in there, and stashing moves the story on', () => {
    const w = world(rec('a', 'house', 3, 2, 'up', { zone: 'a', bag: [{ item: 'moss', count: 2 }] }), rec('b', 'house', 3, 2, 'up', { stash: { items: { nail: 1 }, out: {} } }));
    expect([w.zoneOf('a'), w.zoneOf('b')]).toEqual([own('a'), own('b')]);
    w.store('a', 3, 1, undefined, 1000);
    const out = w.drain();
    expect(out.filter(o => o.to === 'a').map(o => o.msg.t)).toContain('chapter');
    expect(out).toContainEqual({ to: 'a', msg: { t: 'chest', stash: [{ item: 'moss', count: 2 }] } });
    w.chest('b', 3, 1, 1000);
    expect(w.drain()).toEqual([{ to: 'b', msg: { t: 'chest', stash: [{ item: 'nail', count: 1 }] } }]);
    expect(w.get('a')!.story).toBe('stored');
  });

  it('wakes you up in it after a collapse, by the fire, full and alone; what you carried lies where you fell', () => {
    const w = world(rec('a', 'woods', 3, 6, 'up', { energy: 1, bag: [{ item: 'moss', count: 1 }] }), rec('c', 'woods', 5, 5), inTown('t', 0, 5));
    w.tick(5000);
    const out = noEnergy(w.drain());
    expect(out).toContainEqual({ to: '*', map: 'woods', except: 'a', msg: { t: 'leave', id: 'a' } });
    expect(out).toContainEqual({ to: '*', map: own('a'), except: 'a', msg: { t: 'join', player: viewOf('a', 2, 2, 'down') } });
    // Nobody in town sees them come home: they are inside already.
    expect(out.filter(o => 'map' in o && o.map === 'town')).toEqual([]);
    const zone = out.find(o => o.msg.t === 'zone')!;
    expect(zone).toEqual({ to: 'a', msg: expect.objectContaining({ t: 'zone', map: { id: 'house', version: 1 }, x: 2, y: 2, dir: 'down', players: [viewOf('a', 2, 2, 'down')], reason: 'collapse' }), zone: own('a') });
    expect(w.get('a')).toMatchObject({ map: 'house', zone: 'a', x: 2, y: 2, dir: 'down', energy: ENERGY_MAX, bag: [] });
    expect(w.dropViews('woods')).toMatchObject([{ owner: 'a', x: 3, y: 6 }]);
  });

  it('lets you out through its door in front of the house in town, among everyone there', () => {
    const w = world(rec('a', 'house', 2, 2, 'down', { zone: 'a' }), inTown('t', 0, 5));
    w.step('a', 'down', 1, 1000);
    w.step('a', 'down', 2, 1200);
    const out = noEnergy(w.drain());
    expect(out).toContainEqual({ to: '*', map: 'town', except: 'a', msg: { t: 'join', player: viewOf('a', 7, 3, 'down') } });
    const zone = out.find(o => o.msg.t === 'zone')!;
    expect(zone).toEqual({ to: 'a', msg: expect.objectContaining({ t: 'zone', map: { id: 'town', version: 1 }, x: 7, y: 3, dir: 'down', players: [viewOf('t', 0, 5, 'up'), viewOf('a', 7, 3, 'down')] }) });
    expect(w.get('a')!.zone).toBeUndefined();
    // Left empty, the cabin closes on the next tick; it opens again as they walk back in.
    w.tick(1400);
    expect(w.zoneKeys()).not.toContain(own('a'));
  });

  it('takes you back inside when you come back in there: your own, whatever copy the save said', () => {
    const w = world(rec('b', 'house', 1, 3, 'up', { zone: 'b' }));
    // Saved inside by the release before cabins (the room's main copy), or by this one (their own).
    const back = w.join(rec('a', 'house', 1, 2, 'up'), 1000);
    expect(back).toMatchObject({ map: { id: 'house' }, players: [viewOf('a', 1, 2, 'up')] });
    expect(w.zoneOf('a')).toBe(own('a'));
    const saved = w.leave('a', 2000)!;
    expect(saved).toMatchObject({ map: 'house', zone: 'a', x: 1, y: 2 });
    w.tick(3000);
    expect(w.join(saved, 4000).players.map(p => p.id)).toEqual(['a']);
    expect(w.zoneOf('a')).toBe(own('a'));
    // Nobody gets into someone else's: a save naming another's cabin is theirs all the same.
    w.join(rec('c', 'house', 1, 2, 'up', { zone: 'b' }), 5000);
    expect(w.zoneOf('c')).toBe(own('c'));
  });

  it('is home for the letter: walking in, or waking up there after a collapse, you read who thanked you', () => {
    // b thanked a for an arrow in the woods while a was away.
    const thanks = (at: number): ThanksRecord => ({ giver: 'b', helper: 'a', day: utcDay(at), at, what: { kind: 'mark', map: 'woods', x: 5, y: 5 }, told: false, name: 'B' });
    const letter = { t: 'letter', thanks: [{ what: { kind: 'mark', map: 'woods', x: 5, y: 5 }, count: 1, people: 1, names: ['B'] }] };
    const walkingIn = new World(cabinMaps(), 'town', 'overcast', { items: itemsData(), rng: () => 0, thanks: [thanks(500)] });
    walkingIn.join(inTown('a'), 1000);
    walkingIn.step('a', 'up', 1, 1000);
    expect(walkingIn.drain().filter(o => o.to === 'a').map(o => o.msg)).toContainEqual(letter);
    const collapsing = new World(cabinMaps(), 'town', 'overcast', { items: itemsData(), rng: () => 0, thanks: [thanks(500)] });
    collapsing.join(rec('a', 'woods', 3, 6, 'up', { energy: 1 }), 1000);
    collapsing.drain();
    collapsing.tick(6000);
    const out = collapsing.drain().filter(o => o.to === 'a').map(o => o.msg);
    expect(out.map(m => m.t)).toEqual(expect.arrayContaining(['zone', 'letter']));
    expect(out).toContainEqual(letter);
  });

  it('keeps the outfit you put on at its chest to yourself until you walk out, where everyone sees it', () => {
    const w = world(rec('a', 'house', 3, 2, 'up', { zone: 'a', authSub: 'dev:a' }), rec('b', 'house', 3, 2, 'up', { zone: 'b', authSub: 'dev:b' }), inTown('t', 0, 5));
    w.outfit('a', 3, 1, 'napo-suit', 1000);
    expect(w.drain()).toEqual([{ to: '*', map: own('a'), msg: { t: 'outfit', id: 'a', outfit: 'napo-suit' } }]);
    // Out: from 3,2 to the way out at 2,4.
    (['left', 'down', 'down'] as const).forEach((dir, i) => w.step('a', dir, i + 1, 1200 + i * 200));
    const joined = w.drain().find(o => 'map' in o && o.map === 'town' && o.msg.t === 'join');
    expect(joined?.msg).toMatchObject({ t: 'join', player: { id: 'a', outfit: 'napo-suit' } });
  });

  it('is where a player whose map is gone starts over', () => {
    const w = world();
    expect(w.join(rec('a', 'gone', 3, 3), 0)).toMatchObject({ map: { id: 'house' }, player: { x: 2, y: 2, dir: 'down' } });
    expect(w.zoneOf('a')).toBe(own('a'));
  });
});

describe('your own cabin over the network', () => {
  const { ctx, join, enter, login } = setup({ maps: cabinMaps(), items: itemsData(), weather: 'overcast' });

  it('is where a new player starts: by the fire, facing the room, alone in it', async () => {
    const [a, b] = [await join(), await join()];
    expect(a.welcome).toMatchObject({ map: { id: 'house', version: 1 }, players: [{ id: a.id, x: 2, y: 2, dir: 'down' }] });
    expect(b.welcome.players.map(p => p.id)).toEqual([b.id]);
    expect(ctx.storage.get(a.id)).toMatchObject({ map: 'house', x: 2, y: 2, dir: 'down' });
    // Fully rested, and warm: the fire is right there.
    expect(a.welcome.energy.value).toBe(ENERGY_MAX);
  });

  it('keeps two players in it apart: neither hears the other walk, and each goes out into the same town', async () => {
    const a = await enter({ map: 'town', x: 7, y: 3, dir: 'up' });
    const b = await enter({ map: 'town', x: 7, y: 3, dir: 'up' });
    await Promise.all([a.c.settle(), b.c.settle()]);
    a.c.send({ t: 'step', dir: 'up', seq: 1 });
    expect((await a.c.next('zone')).players.map(p => p.id)).toEqual([a.id]);
    b.c.send({ t: 'step', dir: 'up', seq: 1 });
    expect((await b.c.next('zone')).players.map(p => p.id)).toEqual([b.id]);
    await Promise.all([a.c.settle(), b.c.settle()]);
    a.c.send({ t: 'step', dir: 'up', seq: 2 });
    await a.c.next('step');
    b.c.send({ t: 'face', dir: 'left' });
    expect((await b.c.settle()).filter(m => m.t !== 'energy')).toEqual([]);
    expect((await a.c.settle()).filter(m => m.t !== 'energy')).toEqual([]);
    // Out through the door, in front of the house, where b, still inside, is not.
    a.c.send({ t: 'step', dir: 'down', seq: 3 });
    a.c.send({ t: 'step', dir: 'down', seq: 4 });
    const out = await a.c.next('zone');
    expect(out).toMatchObject({ map: { id: 'town' }, x: 7, y: 3, dir: 'down' });
    expect(out.players.map(p => p.id)).toEqual([a.id]);
  });

  it('wakes you in it after a collapse, and takes you back into it when you come back', async () => {
    const a = await enter({ map: 'woods', x: 3, y: 6, dir: 'up', energy: 0.2, bag: [{ item: 'moss', count: 1 }] });
    expect(await a.c.next('zone')).toMatchObject({ map: { id: 'house' }, x: 2, y: 2, dir: 'down', players: [{ id: a.id }], reason: 'collapse' });
    a.c.ws.close();
    await waitFor(() => !ctx.server.world.has(a.id), 'a to leave');
    expect(ctx.storage.get(a.id)).toMatchObject({ map: 'house', zone: a.id, x: 2, y: 2 });
    const again = await login(a.token);
    expect(again.welcome).toMatchObject({ map: { id: 'house' }, players: [{ id: a.id, x: 2, y: 2 }] });
    expect(ctx.server.world.zoneOf(a.id)).toBe(own(a.id));
  });

  it('never tells the client whose copy it is in: the welcome names the room alone, as it always did', async () => {
    const c = await join();
    expect(c.welcome).toMatchObject({ v: PROTOCOL_VERSION, map: { id: 'house', version: 1 } });
    expect(JSON.stringify(c.welcome)).not.toContain(own(c.id));
  });
});
