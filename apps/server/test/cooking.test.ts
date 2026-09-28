/**
 * Cooking at a fire, and meals (meals.ts): at a fire that burns (tended, or fed), what the bag holds
 * cooks into a meal; eaten, a meal works until you come home into your cabin or collapse, two at a
 * time and never the same one twice; and what grows in the rain grows a while after it. World rules
 * first, then over real WebSockets.
 *
 * The fixture maps (fixtures.ts), with a chest in the house (a home: walking in ends a trip), and in the
 * woods a second fire at 6,6 that burns down (with dice of 0 it starts half full: 15 minutes of fuel).
 * Standing at 5,6 you are next to it; at 4,1 next to the campfire at 4,2, which never goes out.
 */
import { describe, expect, it } from 'vitest';
import { ENERGY_MAX, FIRE_MAX_S, PROTOCOL_VERSION, SLUMP_S, STEP_MS, TileMap, energyRate, type Dir, type ItemsData, type MapData, type ServerMsg } from '@napoland/shared';
import { setLogLevel } from '../src/log';
import { startServer } from '../src/server';
import { MemoryStorage, type PlayerRecord } from '../src/storage';
import { World, colorFor, type Outgoing } from '../src/world';
import { houseData, itemsData, laneData, streetTownData, townData, woodsData } from './fixtures';
import { Client, nobodyCame, savedPlayer, serverDefaults, waitFor } from './helpers';

const woods = (): MapData => ({ ...woodsData(), objects: [...woodsData().objects, { kind: 'fireplace', x: 6, y: 6 }] });
const house = (): MapData => ({ ...houseData(), objects: [...houseData().objects, { kind: 'chest', x: 3, y: 1 }] });
const maps = () => [new TileMap(townData()), new TileMap(house()), new TileMap(woods())];

/** The fixture items, with fir tips and berries to cook, three meals, and nails that weigh something. */
function items(): ItemsData {
  const base = itemsData();
  return {
    ...base,
    items: [
      ...base.items.map(i => (i.id === 'nail' ? { ...i, weight: 1 } : i)),
      { id: 'tips', name: 'Fir tips', noun: 'fir tip', kind: 'resource', stack: 10, text: 'Green.' },
      { id: 'berries', name: 'Berries', noun: 'berry', plural: 'berries', kind: 'resource', stack: 10, text: 'Sweet.' },
      { id: 'shrooms', name: 'Chanterelles', noun: 'chanterelle', kind: 'resource', stack: 10, text: 'Golden.' },
      { id: 'brew', name: 'Fir-tip tea', noun: 'fir-tip tea', plural: 'fir-tip tea', kind: 'consumable', stack: 3, use: { meal: 'drink' }, eaten: { energy: 15 }, text: 'Hot.' },
      { id: 'stew', name: 'Stew', noun: 'stew', plural: 'stew', kind: 'consumable', stack: 3, use: { meal: 'eat' }, eaten: { cold: 0.15 }, text: 'Warm.' },
      { id: 'cakes', name: 'Pemmican', noun: 'pemmican', plural: 'pemmican', kind: 'consumable', stack: 3, use: { meal: 'eat' }, eaten: { load: 0.85 }, text: 'Dense.' },
    ],
    finds: [
      ...base.finds,
      // After the rain, for a minute: anywhere on the woods' way up the right side.
      { item: 'shrooms', map: 'woods', around: { x: 6, y: 3, r: 1 }, count: 1, respawn: [10, 20], when: 'rain', after: 60 },
    ],
    cooking: [
      { id: 'brew', make: 'brew', needs: [{ item: 'tips', count: 3 }] },
      { id: 'stew', make: 'stew', needs: [{ item: 'berries', count: 2 }] },
      { id: 'cakes', make: 'cakes', needs: [{ item: 'tips', count: 1 }, { item: 'berries', count: 1 }] },
    ],
  };
}

const rec = (id: string, map: string, x: number, y: number, dir: Dir = 'up', more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map, x, y, dir, color: colorFor(id), energy: ENERGY_MAX, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});
function world(weather: 'overcast' | 'rain', ...players: PlayerRecord[]): World {
  const w = new World(maps(), 'town', weather, { items: items(), rng: () => 0 });
  for (const p of players) w.join(p, 0);
  w.drain();
  w.takeWrites();
  return w;
}
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id ? [o.msg] : []));
const of = <T extends ServerMsg['t']>(msgs: ServerMsg[], t: T) => msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
const energyOf = (out: Outgoing[], id: string) => of(to(out, id), 'energy').at(-1);

describe('cooking at a fire', () => {
  it('cooks at a fire that never goes out: what it needs leaves the bag, the meal goes into it', () => {
    const w = world('overcast', rec('a', 'woods', 4, 1, 'down', { bag: [{ item: 'tips', count: 4 }, { item: 'nail', count: 2 }] }));
    w.cook('a', 4, 2, 'brew', 1000);
    const out = to(w.drain(), 'a');
    expect(of(out, 'bag')).toEqual([{ t: 'bag', bag: [{ item: 'tips', count: 1 }, { item: 'nail', count: 2 }, { item: 'brew', count: 1 }] }]);
    expect(out.at(-1)).toEqual({ t: 'did', did: { kind: 'cooked', item: 'brew', count: 1 } });
  });

  it('cooks at a fire someone keeps fed, and not once it has gone out', () => {
    const w = world('overcast', rec('a', 'woods', 5, 6, 'right', { bag: [{ item: 'berries', count: 4 }] }));
    w.cook('a', 6, 6, 'stew', 1000);
    expect(to(w.drain(), 'a').at(-1)).toEqual({ t: 'did', did: { kind: 'cooked', item: 'stew', count: 1 } });
    // Half full at the start: it goes out after 15 minutes, and a dead fire cooks nothing.
    w.tick((FIRE_MAX_S / 2) * 1000 + 1000);
    w.drain();
    w.cook('a', 6, 6, 'stew', (FIRE_MAX_S / 2) * 1000 + 1000);
    expect(to(w.drain(), 'a')).toEqual([{ t: 'refused', action: 'cook', reason: 'fire_out' }]);
    expect(w.get('a')!.bag).toEqual([{ item: 'berries', count: 2 }, { item: 'stew', count: 1 }]);
  });

  it('refuses what the bag lacks, a fire out of reach, no fire at all, a recipe it does not know, and a full bag', () => {
    const full = Array.from({ length: 8 }, () => ({ item: 'nail', count: 5 }));
    const w = world('overcast', rec('a', 'woods', 4, 1, 'down', { bag: [{ item: 'tips', count: 2 }] }), rec('b', 'woods', 1, 1), rec('c', 'woods', 4, 1, 'down', { bag: [...full.slice(1), { item: 'tips', count: 3 }] }));
    w.cook('a', 4, 2, 'brew', 1000);
    w.cook('a', 4, 2, 'soup', 1000);
    w.cook('a', 5, 1, 'brew', 1000);
    w.cook('b', 4, 2, 'brew', 1000);
    const out = w.drain();
    expect(to(out, 'a')).toEqual([
      { t: 'refused', action: 'cook', reason: 'missing' },
      { t: 'refused', action: 'cook', reason: 'gone' },
      { t: 'refused', action: 'cook', reason: 'gone' },
    ]);
    expect(to(out, 'b')).toEqual([{ t: 'refused', action: 'cook', reason: 'too_far' }]);
    // The fir tips leave a slot of their own for the tea.
    w.cook('c', 4, 2, 'brew', 1000);
    expect(to(w.drain(), 'c').at(-1)).toEqual({ t: 'did', did: { kind: 'cooked', item: 'brew', count: 1 } });
    // With every slot full of what stays, there is no room for it.
    w.join(rec('d', 'woods', 4, 1, 'down', { bag: [...full.slice(0, 7), { item: 'berries', count: 1 }] }), 1000);
    w.join(rec('e', 'woods', 4, 1, 'down', { bag: [...full.slice(0, 7), { item: 'tips', count: 4 }] }), 1000);
    w.drain();
    w.cook('e', 4, 2, 'brew', 1000);
    expect(to(w.drain(), 'e')).toEqual([{ t: 'refused', action: 'cook', reason: 'bag_full' }]);
  });
});

describe('meals', () => {
  it('fill the bar and make it bigger (the tea), until you come home into your cabin', () => {
    const w = world('overcast', rec('a', 'town', 7, 3, 'up', { energy: 60, bag: [{ item: 'brew', count: 2 }] }));
    w.use('a', 0, 1000);
    const out = w.drain(), msgs = to(out, 'a');
    expect(energyOf(out, 'a')).toMatchObject({ energy: { value: 75, max: ENERGY_MAX + 15 }, body: { meals: ['brew'] } });
    expect(msgs.at(-1)).toEqual({ t: 'did', did: { kind: 'ate', item: 'brew', energy: 15 } });
    expect(w.get('a')).toMatchObject({ meals: ['brew'], bag: [{ item: 'brew', count: 1 }] });
    // Saved at once: it outlasts a reconnect.
    expect(w.takeWrites().players.map(p => p.meals)).toEqual([['brew']]);
    // The same one again does nothing more.
    w.use('a', 0, 1100);
    expect(to(w.drain(), 'a')).toEqual([{ t: 'refused', action: 'use', reason: 'ate_it' }]);
    // Home again (the house, where the chest is): the trip is over, and the bar is its own size.
    w.step('a', 'up', 1, 2000);
    const home = w.drain();
    expect(w.get('a')!.meals).toBeUndefined();
    expect(energyOf(home, 'a')).toMatchObject({ energy: { value: 75, max: ENERGY_MAX } });
    expect(energyOf(home, 'a')!.body.meals).toBeUndefined();
  });

  it('are two at a time, never the same one twice', () => {
    const w = world('overcast', rec('a', 'town', 1, 2, 'down', { bag: [{ item: 'brew', count: 1 }, { item: 'stew', count: 1 }, { item: 'cakes', count: 1 }] }));
    w.use('a', 0, 1000);
    w.use('a', 0, 1000);
    w.use('a', 0, 1000);
    const out = to(w.drain(), 'a');
    expect(of(out, 'did').map(m => m.did)).toEqual([{ kind: 'ate', item: 'brew', energy: 15 }, { kind: 'ate', item: 'stew' }]);
    expect(of(out, 'refused')).toEqual([{ t: 'refused', action: 'use', reason: 'two_meals' }]);
    expect(w.get('a')).toMatchObject({ meals: ['brew', 'stew'], bag: [{ item: 'cakes', count: 1 }] });
  });

  it('bite less cold (the stew) and lighten the bag (the pemmican) out in the wilds', () => {
    const w = world('rain', rec('a', 'woods', 3, 5, 'up', { bag: [{ item: 'stew', count: 1 }, { item: 'nail', count: 5 }] }), rec('b', 'woods', 3, 5, 'up', { bag: [{ item: 'cakes', count: 1 }, { item: 'nail', count: 5 }] }));
    const map = new TileMap(woods());
    const before = w.get('a')!;
    w.use('a', 0, 1000);
    w.use('b', 0, 1000);
    const out = w.drain(), a = energyOf(out, 'a')!, b = energyOf(out, 'b')!;
    // Nearly dry, with a bag of 5 kg (half of what is carried easily): the stew keeps 15% of the rain's cold out.
    expect(before.wet ?? 0).toBe(0);
    expect(a.energy.rate).toBeCloseTo(energyRate(map, 3, 5, 'rain', { load: 0.5, wet: a.body.wet, resist: { cold: 0.15 } }), 3);
    expect(b.body.load).toBeCloseTo(0.5 * 0.85, 3);
    expect(b.energy.rate).toBeCloseTo(energyRate(map, 3, 5, 'rain', { load: 0.5 * 0.85, wet: b.body.wet }), 3);
    // Without either, the rain bites harder and the bag weighs more.
    expect(energyRate(map, 3, 5, 'rain', { load: 0.5, wet: a.body.wet })).toBeLessThan(a.energy.rate);
    expect(energyRate(map, 3, 5, 'rain', { load: 0.5, wet: b.body.wet })).toBeLessThan(b.energy.rate);
  });

  it('end with a collapse, and last through leaving and coming back', () => {
    const w = world('overcast', rec('a', 'woods', 3, 5, 'up', { energy: 0.2, meals: ['stew'] }), rec('b', 'woods', 3, 5, 'up', { meals: ['brew', 'nothing', 'brew'] }));
    expect(w.get('b')!.meals).toEqual(['brew']);
    w.tick(2000);
    // Down out there first (rescue.ts): nobody comes, and when the window is over they collapse.
    w.tick(2000 + SLUMP_S * 1000);
    expect(w.get('a')!.map).toBe('town');
    expect(w.get('a')!.meals).toBeUndefined();
    const saved = w.leave('b', 3000)!;
    expect(saved.meals).toEqual(['brew']);
    // Coming back out in the woods, the tea still makes the bar bigger, and what it held is still there.
    const back = w.join({ ...saved, energy: ENERGY_MAX + 10 }, 4000);
    expect(back.energy).toMatchObject({ value: ENERGY_MAX + 10, max: ENERGY_MAX + 15 });
    expect(back.body.meals).toEqual(['brew']);
  });
});

describe('meals and NAPO\'s teleport', () => {
  /** The cabin every lot's door leads into, with NAPO's teleport at 3,1, and the town of a street with its twin at 8,5 (as in first-steps.test.ts). */
  const cabin = (): MapData => ({
    id: 'house', name: 'Home', version: 1, kind: 'inside', depth: 0, width: 5, height: 5, tiles: ['xxxxx', 'xpppx', 'xpppx', 'xpppx', 'xxpxx'],
    levels: Array<string>(5).fill('00000'), spawn: { x: 2, y: 3, dir: 'up' }, exits: [{ x: 2, y: 4, w: 1, h: 1, to: 'lane', tx: 2, ty: 3, dir: 'down' }],
    objects: [{ kind: 'chest', x: 1, y: 1 }, { kind: 'teleport', x: 3, y: 1 }], private: true, wake: { x: 2, y: 2, dir: 'down' },
  });
  const town = (): MapData => ({ ...streetTownData(), objects: [...streetTownData().objects, { kind: 'teleport', x: 8, y: 5 }] });

  it('end coming home by the teleport, as walking in does', () => {
    const w = new World([new TileMap(town()), new TileMap(laneData()), new TileMap(cabin()), new TileMap(woodsData())], 'town', 'overcast', { items: items(), rng: () => 0.9 });
    w.join(rec('a', 'town', 8, 6, 'up', { bag: [{ item: 'brew', count: 1 }] }), 0);
    w.returned('a', 0);
    w.use('a', 0, 1000);
    expect(w.get('a')!.meals).toEqual(['brew']);
    w.drain();
    w.teleport('a', 8, 5, 2000);
    const out = w.drain();
    expect(w.get('a')).toMatchObject({ map: 'house', zone: 'a' });
    expect(w.get('a')!.meals).toBeUndefined();
    expect(energyOf(out, 'a')).toMatchObject({ energy: { max: ENERGY_MAX } });
    expect(energyOf(out, 'a')!.body.meals).toBeUndefined();
  });
});

describe('what grows after the rain', () => {
  it('comes up in the rain, stays its while after it stops, then goes', () => {
    const w = world('overcast', rec('a', 'woods', 6, 4, 'up'));
    w.tick(1000);
    expect(w.findViews('woods').map(f => f.item)).toEqual(['moss']);
    w.setWeather('rain', 2000);
    w.tick(2000);
    expect(w.findViews('woods').map(f => f.item).sort()).toEqual(['moss', 'shrooms']);
    w.setWeather('overcast', 10_000);
    w.tick(10_000);
    w.tick(10_000 + 59_000);
    expect(w.findViews('woods').map(f => f.item).sort()).toEqual(['moss', 'shrooms']);
    w.tick(10_000 + 61_000);
    expect(w.findViews('woods').map(f => f.item)).toEqual(['moss']);
  });

  it('opens a page picked up in the rain (a blank waits for one)', () => {
    const w = new World(maps(), 'town', 'rain', {
      items: items(), rng: () => 0,
      notebook: { version: 1, pages: [{ id: 'shrooms', area: 'woods', title: 'Chanterelles', text: 'Golden.', when: { find: 'shrooms' }, blanks: [{ id: 'after-rain', ask: 'They come up... ?', fill: 'In the rain.', when: { find: 'shrooms', during: 'rain' } }] }] },
    });
    w.join(rec('a', 'woods', 6, 3, 'up'), 0);
    w.tick(1000);
    const f = w.findViews('woods').find(x => x.item === 'shrooms')!;
    w.drain();
    w.pick('a', f.x, f.y, 1000);
    expect(of(to(w.drain(), 'a'), 'blank')).toEqual([{ t: 'blank', id: 'after-rain' }]);
  });
});

describe('cooking and meals over the network', () => {
  it('cooks at a burning fire only, eats, grows the bar, and ends at home', async () => {
    setLogLevel('silent');
    let now = 1_000_000;
    const storage = new MemoryStorage();
    const server = await startServer({ ...serverDefaults(), storage, maps: maps(), items: items(), weather: 'overcast', clock: () => now });
    const clients: Client[] = [];
    const login = async (token: string) => {
      const c = await Client.open(server.port);
      clients.push(c);
      c.send({ t: 'hello', v: PROTOCOL_VERSION, token });
      const welcome = await c.next('welcome');
      await c.next('energy');
      await c.next('friends');
      await c.next('tells');
      return { c, welcome };
    };
    try {
      // At the campfire (it never goes out), with fir tips: the tea, then drunk.
      const a = await savedPlayer(storage, { map: 'woods', x: 4, y: 1, dir: 'down', bag: [{ item: 'tips', count: 3 }] });
      const { c } = await login(a.token);
      c.send({ t: 'cook', x: 4, y: 2, recipe: 'brew' });
      expect(await c.next('bag')).toEqual({ t: 'bag', bag: [{ item: 'brew', count: 1 }] });
      expect(await c.next('did')).toEqual({ t: 'did', did: { kind: 'cooked', item: 'brew', count: 1 } });
      c.send({ t: 'use', slot: 0 });
      const grown = await c.next('energy', m => m.energy.max === ENERGY_MAX + 15);
      expect(grown.body.meals).toEqual(['brew']);
      expect(await c.next('did')).toEqual({ t: 'did', did: { kind: 'ate', item: 'brew', energy: 15 } });
      await waitFor(() => storage.get(a.id)?.meals?.length === 1, 'the meal to be saved');
      // A fire that went out cooks nothing: the second fire burns half an hour at most, then it is dead.
      const b = await savedPlayer(storage, { map: 'woods', x: 5, y: 6, dir: 'right', bag: [{ item: 'berries', count: 2 }] });
      const cb = await login(b.token);
      now += FIRE_MAX_S * 1000 + 5000;
      await cb.c.next('energy', m => m.energy.rate < 0);
      cb.c.send({ t: 'cook', x: 6, y: 6, recipe: 'stew' });
      expect(await cb.c.next('refused')).toEqual({ t: 'refused', action: 'cook', reason: 'fire_out' });
      // Home: down the road to town and into the house, where the chest is. The meal is over there.
      const home = await savedPlayer(storage, { map: 'town', x: 7, y: 3, dir: 'up', meals: ['cakes'] });
      const ch = await login(home.token);
      expect(ch.welcome.body.meals).toEqual(['cakes']);
      now += STEP_MS + 10;
      ch.c.send({ t: 'step', dir: 'up', seq: 1 });
      await ch.c.next('zone');
      expect(of(await ch.c.settle(), 'energy').at(-1)!.body.meals).toBeUndefined();
      await waitFor(() => storage.get(home.id) !== undefined && storage.get(home.id)!.meals === undefined, 'the meal to be over in storage');
    } finally {
      for (const c of clients) c.ws.terminate();
      await server.stop();
    }
  });

  it('ends a meal with a collapse, and keeps one through a reconnect', async () => {
    setLogLevel('silent');
    let now = 1_000_000;
    const storage = new MemoryStorage();
    const server = await startServer({ ...serverDefaults(), storage, maps: maps(), items: items(), weather: 'overcast', clock: () => now });
    const clients: Client[] = [];
    const login = async (token: string) => {
      const c = await Client.open(server.port);
      clients.push(c);
      c.send({ t: 'hello', v: PROTOCOL_VERSION, token });
      const welcome = await c.next('welcome');
      await c.settle();
      return { c, welcome };
    };
    try {
      const kept = await savedPlayer(storage, { map: 'woods', x: 4, y: 1, dir: 'down', meals: ['stew'] });
      const first = await login(kept.token);
      expect(first.welcome.body.meals).toEqual(['stew']);
      first.c.ws.close();
      await waitFor(() => !server.world.has(kept.id), 'them to leave');
      expect((await login(kept.token)).welcome.body.meals).toEqual(['stew']);
      // Out of energy in the woods: home by the fire, and the meal is spent.
      const faller = await savedPlayer(storage, { map: 'woods', x: 3, y: 5, energy: 0.5, meals: ['brew', 'stew'] });
      const f = await login(faller.token);
      now += 5000;
      // Down out there first (rescue.ts): nobody comes, and when the window is over they collapse.
      await nobodyCame(f.c, ms => (now += ms));
      await f.c.next('zone', m => m.reason === 'collapse');
      expect(of(await f.c.settle(), 'energy').at(-1)!.body.meals).toBeUndefined();
      await waitFor(() => storage.get(faller.id)?.map === 'town' && storage.get(faller.id)!.meals === undefined, 'the collapse to be saved');
    } finally {
      for (const c of clients) c.ws.terminate();
      await server.stop();
    }
  });
});
