/**
 * Crowds (world.ts, copyFor): a town square holds TOWN_CROWD players and a region of the wilds
 * REGION_CROWD before another copy of it opens; the rooms off a place follow the copy they are entered
 * from, and count with it; someone arriving where a friend of theirs is goes into the friend's copy if it
 * has room. Nobody's client ever hears of a copy. These tests make a crowd of a few (WorldOptions.crowd,
 * ServerOptions.crowd). World rules first, then over real WebSockets.
 *
 * The fixture world (fixtures.ts): the town with its house (a room: its door at 7,2, out onto 7,3), and
 * the woods up its north road (4,0, arriving on 3,6; the way back at 3,7, arriving on 4,1).
 */
import { describe, expect, it } from 'vitest';
import { ENERGY_MAX, SLUMP_S, STEP_MS, type Dir, type ServerMsg } from '@napoland/shared';
import { setLogLevel } from '../src/log';
import { startServer } from '../src/server';
import { MemoryStorage, type PlayerRecord } from '../src/storage';
import { REGION_CROWD, TOWN_CROWD, World, colorFor, type Crowd } from '../src/world';
import { fixtureMaps, itemsData } from './fixtures';
import { Client, loginTo, nobodyCame, savedPlayer, serverDefaults, waitFor } from './helpers';

const rec = (id: string, map = 'town', x = 7, y = 3, dir: Dir = 'up', more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map, x, y, dir, color: colorFor(id), energy: ENERGY_MAX, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});

function world(crowd: Partial<Crowd>, friends: Record<string, string[]> = {}): World {
  const w = new World(fixtureMaps(), 'town', 'overcast', { items: itemsData(), rng: () => 0, crowd });
  w.friends = id => new Set(friends[id] ?? []);
  return w;
}
let seq = 0;
function walk(w: World, id: string, dirs: Dir[], at: number): number {
  for (const dir of dirs) {
    w.step(id, dir, ++seq, at);
    at += STEP_MS;
  }
  return at;
}
const zones = (w: World, ids: string[]) => ids.map(id => w.zoneOf(id));

describe('crowds', () => {
  it('are 150 in a town square and 300 in a region of the wilds, unless a test says fewer', () => {
    expect([TOWN_CROWD, REGION_CROWD]).toEqual([150, 300]);
    const w = new World(fixtureMaps(), 'town', 'overcast', { items: itemsData() });
    for (let i = 0; i < TOWN_CROWD; i++) w.join(rec(`p${i}`), 0);
    expect(new Set(w.zoneKeys().filter(k => k.startsWith('town')))).toEqual(new Set(['town']));
    w.join(rec('one-more'), 0);
    expect(w.zoneOf('one-more')).toBe('town:2');
  });

  it('open a copy of a town square once it is full, and fill the first copy with room first', () => {
    const w = world({ town: 2 });
    for (const id of ['a', 'b', 'c', 'd', 'e']) w.join(rec(id), 0);
    expect(zones(w, ['a', 'b', 'c', 'd', 'e'])).toEqual(['town', 'town', 'town:2', 'town:2', 'town:3']);
    expect(w.views('town:2').map(p => p.id)).toEqual(['c', 'd']);
    // A place frees up in the main copy: the next one in takes it.
    w.leave('a', 100);
    w.join(rec('f'), 200);
    expect(w.zoneOf('f')).toBe('town');
  });

  it('keep the rooms of a copy with it: into a house from a copy, into that copy of it, and back out into the copy; whoever is inside counts', () => {
    const w = world({ town: 2 });
    for (const id of ['a', 'b', 'c']) w.join(rec(id), 0);
    walk(w, 'c', ['up'], 1000);
    walk(w, 'a', ['up'], 1000);
    expect(zones(w, ['a', 'c'])).toEqual(['house', 'house:2']);
    // c, in the house, still counts in copy 2: one more there, and it is full.
    w.join(rec('d'), 1000);
    w.join(rec('e'), 1000);
    expect(zones(w, ['d', 'e'])).toEqual(['town:2', 'town:3']);
    walk(w, 'c', ['down', 'down'], 2000);
    expect(w.zoneOf('c')).toBe('town:2');
    expect(w.views('town:2').map(p => p.id).sort()).toEqual(['c', 'd']);
  });

  it('keep a copy in use while someone is in one of its rooms: the square opens again as they walk out, and a newcomer can join them', () => {
    const w = world({ town: 2 });
    for (const id of ['a', 'b', 'c']) w.join(rec(id), 0);
    walk(w, 'c', ['up'], 1000);
    // Nobody out in the second copy's square: it closes, but its house does not.
    w.tick(1500);
    expect(w.zoneKeys()).not.toContain('town:2');
    expect(w.zoneKeys()).toContain('house:2');
    // Copy 2 is in use (c is in its house), with room for one more: the next one in comes into it.
    w.join(rec('d'), 2000);
    expect(w.zoneOf('d')).toBe('town:2');
    walk(w, 'c', ['down', 'down'], 3000);
    expect(w.zoneOf('c')).toBe('town:2');
  });

  it('keep friends together: arriving where a friend is, into the friend\'s copy while it has room', () => {
    // f and c are friends; g is c's friend as c tells it (the World may know one side only, as a player joins).
    const w = world({ town: 2 }, { f: ['c'], c: ['f', 'g'] });
    for (const id of ['a', 'b', 'c']) w.join(rec(id), 0);
    w.join(rec('f', 'woods', 3, 6, 'down'), 0);
    w.join(rec('g', 'woods', 4, 6, 'down'), 0);
    expect(w.zoneOf('c')).toBe('town:2');
    // The main copy has room again; f walks home all the same into c's copy, where c is.
    w.leave('a', 100);
    walk(w, 'f', ['down'], 1000);
    expect(w.zoneOf('f')).toBe('town:2');
    // Now c's copy is full: g, c's friend too, comes into the first copy with room.
    walk(w, 'g', ['left', 'down'], 1000);
    expect(w.zoneOf('g')).toBe('town');
  });

  it('go by the region\'s crowd in the wilds, and by the town\'s in town', () => {
    const w = world({ town: 10, region: 1 });
    for (const id of ['a', 'b']) w.join(rec(id, 'town', 4, 1, 'up'), 0);
    walk(w, 'a', ['up'], 1000);
    walk(w, 'b', ['up'], 1000);
    expect(zones(w, ['a', 'b'])).toEqual(['woods', 'woods:2']);
  });

  it('take a player back into the copy they left while it is in use and has room; else the crowd decides', () => {
    const w = world({ town: 1 });
    for (const id of ['a', 'b']) w.join(rec(id), 0);
    expect(zones(w, ['a', 'b'])).toEqual(['town', 'town:2']);
    const saved = w.leave('b', 100)!;
    expect(saved.zone).toBe('2');
    w.tick(200);
    // Copy 2 closed, and opens again for whoever comes next.
    w.join(rec('c'), 300);
    expect(w.zoneOf('c')).toBe('town:2');
    // b comes back: copy 2 is in use, but full: the next copy.
    w.join(saved, 400);
    expect(w.zoneOf('b')).toBe('town:3');
    const back = w.leave('b', 500)!;
    w.leave('c', 500);
    w.join(rec('d'), 600);
    // Copy 3 is still open when b comes back (the tick has not come), with room: b is back in it.
    w.join(back, 600);
    expect(zones(w, ['d', 'b'])).toEqual(['town:2', 'town:3']);
  });

  it('keep a pile in the copy it fell in', () => {
    const w = world({ region: 1 });
    w.join(rec('x', 'woods', 5, 5), 0);
    w.join(rec('a', 'woods', 3, 6, 'up', { energy: 0.05, bag: [{ item: 'moss', count: 2 }] }), 0);
    expect(zones(w, ['x', 'a'])).toEqual(['woods', 'woods:2']);
    // Down first (rescue.ts), and nobody comes.
    w.tick(60_000);
    w.tick(60_000 + SLUMP_S * 1000);
    expect(w.dropViews('woods:2')).toMatchObject([{ owner: 'a', x: 3, y: 6 }]);
    expect(w.dropViews('woods')).toEqual([]);
  });
});

describe('crowds over the network', () => {
  it('split a crowded town square, keep friends together and piles in their copy, close a copy left empty, and never tell a client its copy', async () => {
    setLogLevel('silent');
    let now = 1_000_000;
    const storage = new MemoryStorage();
    const server = await startServer({ ...serverDefaults(), storage, items: itemsData(), weather: 'overcast', clock: () => now, crowd: { town: 2, region: 1 } });
    const clients: Client[] = [];
    const heard: ServerMsg[] = [];
    const login = async (where: Partial<PlayerRecord>) => {
      const p = await savedPlayer(storage, where);
      const { c, welcome } = await loginTo(server.port, p.token);
      clients.push(c);
      heard.push(welcome);
      return { ...p, c, welcome };
    };
    const step = async (c: Client, dir: Dir) => {
      now += STEP_MS + 10;
      const n = ++seq;
      c.send({ t: 'step', dir, seq: n });
      return c.next('step', m => m.seq === n);
    };
    try {
      // Two fill the town's main copy; the third comes into a copy of their own.
      const a = await login({ map: 'town', x: 7, y: 3, dir: 'up' });
      const b = await login({ map: 'town', x: 6, y: 3, dir: 'up' });
      const c = await login({ map: 'town', x: 5, y: 3, dir: 'up' });
      expect(b.welcome.players.map(p => p.id).sort()).toEqual([a.id, b.id].sort());
      expect(c.welcome).toMatchObject({ map: { id: 'town' }, players: [{ id: c.id }] });
      expect(server.world.zoneOf(c.id)).toBe('town:2');
      await Promise.all([a, b, c].map(p => p.c.settle()));
      // Neither copy hears the other walk.
      await step(a.c, 'left');
      expect((await c.c.settle()).filter(m => m.t === 'step' || m.t === 'join')).toEqual([]);

      // d is c's friend, out in the woods. The main copy has room again (b goes), but d walks home into c's copy.
      const d = await login({ map: 'woods', x: 3, y: 6, dir: 'down' });
      c.c.send({ t: 'befriend', id: d.id });
      await d.c.next('friends', m => m.incoming.length === 1);
      d.c.send({ t: 'answer', id: c.id, yes: true });
      await c.c.next('friends', m => m.friends.length === 1);
      b.c.ws.terminate();
      await waitFor(() => !server.world.has(b.id), 'b to leave');
      await step(d.c, 'down');
      const home = await d.c.next('zone');
      heard.push(home);
      expect(home).toMatchObject({ map: { id: 'town' } });
      expect(home.players.map(p => p.id).sort()).toEqual([c.id, d.id].sort());
      expect(server.world.zoneOf(d.id)).toBe('town:2');
      // The friends list says where a friend is by the map alone.
      c.c.send({ t: 'friends' });
      const list = await c.c.next('friends', m => m.friends.some(f => f.map === 'town'));
      heard.push(list);
      expect(list.friends).toEqual([{ id: d.id, name: d.name, map: 'town' }]);

      // The woods hold one each: e goes out first, then f, into a copy of their own, and runs out there.
      const e = await login({ map: 'town', x: 4, y: 1, dir: 'up' });
      const f = await login({ map: 'town', x: 5, y: 1, dir: 'up', energy: 0.05, bag: [{ item: 'moss', count: 2 }] });
      await step(e.c, 'up');
      heard.push(await e.c.next('zone'));
      await step(f.c, 'up');
      heard.push(await f.c.next('zone'));
      expect([server.world.zoneOf(e.id), server.world.zoneOf(f.id)]).toEqual(['woods', 'woods:2']);
      await e.c.settle();
      now += 60_000;
      // Down first (rescue.ts), and nobody comes.
      await nobodyCame(f.c, ms => { now += ms; });
      heard.push(await f.c.next('zone', m => m.reason === 'collapse'));
      // Its pile lies in its copy: e, in the main copy of the woods, never hears of it.
      await waitFor(() => server.world.dropViews('woods:2').length === 1, 'the pile in the copy');
      expect((await e.c.settle()).filter(m => m.t === 'drop')).toEqual([]);
      expect(server.world.dropViews('woods')).toEqual([]);
      // Left empty, that copy closes on the next tick.
      await waitFor(() => !server.world.zoneKeys().includes('woods:2'), 'the empty copy to close');
      // The next one out opens it again, and finds the pile where it fell.
      const g = await login({ map: 'town', x: 3, y: 1, dir: 'right' });
      await step(g.c, 'right');
      await step(g.c, 'up');
      const woods = await g.c.next('zone');
      heard.push(woods);
      expect(server.world.zoneOf(g.id)).toBe('woods:2');
      expect(woods.drops).toMatchObject([{ owner: f.id }]);

      // Not one message said which copy anyone was in: no copy's key, and no field for one.
      const said = JSON.stringify(heard);
      for (const key of ['town:2', 'woods:2', '"zone":', '"copy":']) expect(said).not.toContain(key);
    } finally {
      for (const c of clients) c.ws.terminate();
      await server.stop();
    }
  });

});
