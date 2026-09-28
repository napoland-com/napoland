/**
 * A cozy cabin (comfort.ts): furniture made at the workbench in your own cabin goes straight into its
 * place, never the stash, and only you are told of it; standing by your own fire makes you cozy, and out
 * in the wilds you then tire slower, for longer the more comfort; with the drying rack you always walk out
 * dry. World rules first, then over real WebSockets.
 *
 * The fixture cabin, 7 by 5, private, its door at the town's 7,2 as in fixtures.ts:
 *
 *     0123456
 *   0 xxxxxxx
 *   1 xorFHWx   o the stove's place (1,1), r the drying rack's (2,1), F the fire (3,1), H the chest, W the workbench
 *   2 xpp*ppx   * where you wake up (3,2), by the fire; 2,2 to 4,2 are warm
 *   3 xpppppx   2,3: where the town's door leads in (not warm)
 *   4 xxpxxxx   2,4: the way out, to the town's 7,3
 */
import { describe, expect, it } from 'vitest';
import {
  COZY_AFTER_S, COZY_DRAIN, ENERGY_MAX, PROTOCOL_VERSION, STEP_MS, TileMap, cozySeconds, type Dir, type ItemsData, type MapData, type ServerMsg,
} from '@napoland/shared';
import { setLogLevel } from '../src/log';
import { startServer } from '../src/server';
import { MemoryStorage, type PlayerRecord } from '../src/storage';
import { World, colorFor, zoneKey, type Outgoing } from '../src/world';
import { itemsData, townData, woodsData } from './fixtures';
import { Client, savedPlayer, serverDefaults, waitFor } from './helpers';

function cabinData(): MapData {
  return {
    id: 'house', name: 'Home', version: 1, kind: 'inside', depth: 0, width: 7, height: 5,
    tiles: ['xxxxxxx', 'xpppppx', 'xpppppx', 'xpppppx', 'xxpxxxx'],
    levels: Array<string>(5).fill('0000000'),
    spawn: { x: 2, y: 3, dir: 'up' },
    exits: [{ x: 2, y: 4, w: 1, h: 1, to: 'town', tx: 7, ty: 3, dir: 'down' }],
    objects: [
      { kind: 'fireplace', x: 3, y: 1 }, { kind: 'chest', x: 4, y: 1 }, { kind: 'workbench', x: 5, y: 1 },
      { kind: 'comfort', x: 1, y: 1, what: 'stove' }, { kind: 'comfort', x: 2, y: 1, what: 'rack' },
    ],
    private: true,
    wake: { x: 3, y: 2, dir: 'down' },
  };
}

/** A lodge off the town with a workbench of its own and no place for any furniture. */
function lodgeData(): MapData {
  return { ...cabinData(), id: 'lodge', name: 'Lodge', objects: [{ kind: 'fireplace', x: 3, y: 1 }, { kind: 'workbench', x: 5, y: 1 }], private: undefined, wake: undefined };
}

const maps = () => [new TileMap(townData()), new TileMap(cabinData()), new TileMap(woodsData()), new TileMap(lodgeData())];

/** The fixture items, with a stove (comfort 3) and a drying rack (comfort 2, it dries you) made of nails and moss. */
function items(): ItemsData {
  const base = itemsData();
  return {
    ...base,
    items: [
      ...base.items,
      { id: 'stove', name: 'Iron stove', kind: 'furniture', stack: 1, furnishes: 'stove', comfort: 3, text: 'Warm.', spoiled: 'Rusted.' },
      { id: 'rack', name: 'Drying rack', kind: 'furniture', stack: 1, furnishes: 'rack', comfort: 2, dries: true, text: 'Dry.', spoiled: 'Broken.' },
    ],
    recipes: [
      { id: 'stove', make: 'stove', needs: [{ item: 'nail', count: 4 }] },
      { id: 'rack', make: 'rack', needs: [{ item: 'moss', count: 2 }] },
    ],
  };
}

const rec = (id: string, map: string, x: number, y: number, dir: Dir = 'up', more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map, x, y, dir, color: colorFor(id), energy: ENERGY_MAX, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});
/** A player in their own cabin, at x,y. */
const home = (id: string, x: number, y: number, more: Partial<PlayerRecord> = {}) => rec(id, 'house', x, y, 'up', { zone: id, ...more });

function world(...players: PlayerRecord[]): World {
  const w = new World(maps(), 'town', 'overcast', { items: items(), rng: () => 0 });
  for (const p of players) w.join(p, 0);
  w.drain();
  w.takeWrites();
  return w;
}
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id ? [o.msg] : []));
const of = <T extends ServerMsg['t']>(msgs: ServerMsg[], t: T) => msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
const bodyOf = (out: Outgoing[], id: string) => of(to(out, id), 'energy').at(-1)?.body;

describe('furniture for your own cabin', () => {
  it('is made at the workbench and set in its place at once: never into the stash, and only once', () => {
    const w = world(home('a', 5, 2, { stash: { items: { nail: 5 }, out: {} } }));
    w.craft('a', 5, 1, 'stove', 1000);
    const out = to(w.drain(), 'a');
    expect(out).toEqual([
      { t: 'furniture', furniture: ['stove'] },
      { t: 'bench', stash: [{ item: 'nail', count: 1 }] },
      { t: 'did', did: { kind: 'made', item: 'stove', count: 1, comfort: 3 } },
    ]);
    expect(w.get('a')).toMatchObject({ furniture: ['stove'], stash: { items: { nail: 1 } } });
    // Saved at once, with what it cost.
    expect(w.takeWrites().players.map(p => p.furniture)).toEqual([['stove']]);
    w.craft('a', 5, 1, 'stove', 1100);
    expect(to(w.drain(), 'a')).toEqual([{ t: 'refused', action: 'craft', reason: 'placed' }]);
  });

  it('asks what it needs of the stash, and has no place anywhere but your own cabin', () => {
    const w = world(home('a', 5, 2, { stash: { items: { moss: 1 }, out: {} } }), rec('b', 'lodge', 5, 2, 'up', { stash: { items: { nail: 9 }, out: {} } }));
    w.craft('a', 5, 1, 'rack', 1000);
    expect(to(w.drain(), 'a')).toEqual([{ t: 'refused', action: 'craft', reason: 'missing' }]);
    w.craft('b', 5, 1, 'stove', 1000);
    expect(to(w.drain(), 'b')).toEqual([{ t: 'refused', action: 'craft', reason: 'not_here' }]);
    expect(w.get('b')!.stash).toEqual({ items: { nail: 9 }, out: {} });
  });

  it('is told to its owner alone, with the room: walking into your cabin, and in the welcome there', () => {
    const w = world(rec('a', 'town', 7, 3, 'up', { furniture: ['stove'] }), rec('b', 'town', 7, 3, 'up'));
    w.step('a', 'up', 1, 1000);
    w.step('b', 'up', 1, 1000);
    const out = w.drain();
    expect(of(to(out, 'a'), 'zone')[0]).toMatchObject({ map: { id: 'house' }, furniture: ['stove'] });
    expect(of(to(out, 'b'), 'zone')[0]).toMatchObject({ map: { id: 'house' }, furniture: [] });
    // Nothing of a's reaches anyone else, and out in town nobody hears of furniture.
    expect(out.filter(o => o.to !== 'a' && JSON.stringify(o.msg).includes('stove'))).toEqual([]);
    expect(w.join(home('c', 3, 2, { furniture: ['rack', 'gone'] }), 1000).furniture).toEqual(['rack']);
    expect(w.join(rec('d', 'town', 1, 2, 'down', { furniture: ['rack'] }), 1000).furniture).toBeUndefined();
  });
});

describe('cozy by your own fire', () => {
  it('comes after standing by it a while, holds in full while you stay, and counts down once you go', () => {
    const w = world(home('a', 3, 2, { furniture: ['stove'] }));
    const full = cozySeconds(3);
    expect(full).toBe(8 * 60);
    w.tick((COZY_AFTER_S - 1) * 1000);
    expect(w.get('a')!.cozy).toBeUndefined();
    w.drain();
    w.tick(COZY_AFTER_S * 1000);
    expect(bodyOf(w.drain(), 'a')).toMatchObject({ cozy: full, fireside: COZY_AFTER_S });
    // A minute more by the fire, and it is still in full.
    w.tick(80_000);
    expect(w.get('a')!.cozy).toBe(80_000 + full * 1000);
    w.drain();
    // A step away from the warmth: the countdown starts, and the client hears it.
    w.step('a', 'down', 1, 80_000);
    const away = bodyOf(w.drain(), 'a');
    expect(away).toMatchObject({ cozy: full });
    expect(away!.fireside).toBeUndefined();
    w.tick(140_000);
    expect(w.get('a')!.cozy).toBe(80_000 + full * 1000);
    expect(bodyOf(w.drain(), 'a')).toBeUndefined();
    // Worn off: the client hears that too.
    w.tick(80_000 + full * 1000 + 100);
    const gone = bodyOf(w.drain(), 'a');
    expect(gone).toBeDefined();
    expect(gone!.cozy).toBeUndefined();
    expect(w.get('a')!.cozy).toBeUndefined();
  });

  it('lasts five minutes and a minute more for each point of comfort, from when you leave the fire', () => {
    const plain = world(home('a', 3, 2));
    plain.tick(0);
    plain.tick(COZY_AFTER_S * 1000);
    expect(plain.get('a')!.cozy).toBe(COZY_AFTER_S * 1000 + 5 * 60_000);
    const cozier = world(home('a', 3, 2, { furniture: ['stove', 'rack'] }));
    cozier.tick(0);
    cozier.tick(COZY_AFTER_S * 1000);
    expect(cozier.get('a')!.cozy).toBe(COZY_AFTER_S * 1000 + 10 * 60_000);
  });

  it('needs your own fire: a fire in town or someone else\'s room is no home', () => {
    const w = world(rec('a', 'lodge', 3, 2));
    w.tick(0);
    w.tick(60_000);
    expect(w.get('a')!.cozy).toBeUndefined();
    expect(bodyOf(w.drain(), 'a')?.fireside).toBeUndefined();
  });

  it('makes you tire slower out in the wilds, and only there', () => {
    const w = new World(maps(), 'town', 'overcast', { items: items(), rng: () => 0 });
    const cozy = w.join(rec('a', 'woods', 3, 5, 'up', { cozy: 600_000 }), 1000), plain = w.join(rec('b', 'woods', 3, 5), 1000);
    expect(cozy.body.cozy).toBe(599);
    expect(plain.body.cozy).toBeUndefined();
    expect(plain.energy.rate).toBeLessThan(0);
    expect(cozy.energy.rate / plain.energy.rate).toBeCloseTo(COZY_DRAIN, 2);
    // In town it holds, cozy or not.
    expect(w.join(rec('c', 'town', 1, 2, 'down', { cozy: 600_000 }), 1000).energy.rate).toBe(0);
  });

  it('ends early with a collapse, and is kept when you leave and come back while it lasts', () => {
    const w = world(rec('a', 'woods', 3, 5, 'up', { cozy: 600_000, energy: 0.1 }), rec('b', 'woods', 3, 5, 'up', { cozy: 600_000 }));
    w.tick(2000);
    expect(w.zoneOf('a')).toBe(zoneKey('house', 'a'));
    expect(w.get('a')!.cozy).toBeUndefined();
    const saved = w.leave('b', 3000)!;
    expect(saved.cozy).toBe(600_000);
    w.join(saved, 4000);
    expect(w.get('b')!.cozy).toBe(600_000);
    // Gone by the time they come back: it counted down while they were away.
    const late = w.leave('b', 5000)!;
    w.join(late, 700_000);
    expect(w.get('b')!.cozy).toBeUndefined();
  });
});

describe('the drying rack', () => {
  it('lets you out of your cabin dry, however wet you came in; without it, you walk out as wet as you were', () => {
    const w = world(home('a', 2, 3, { wet: 0.9, furniture: ['rack'] }), home('b', 2, 3, { wet: 0.9 }));
    w.step('a', 'down', 1, 1000);
    w.step('b', 'down', 1, 1000);
    const out = w.drain();
    expect(w.zoneOf('a')).toBe('town');
    expect(bodyOf(out, 'a')!.wet).toBe(0);
    expect(bodyOf(out, 'b')!.wet).toBeGreaterThan(0.85);
  });
});

describe('a cozy cabin over the network', () => {
  it('makes and places furniture, tells only its owner, keeps it, and makes them cozy by their fire', async () => {
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
      const a = await savedPlayer(storage, { map: 'house', x: 5, y: 2, dir: 'up', stash: { items: { nail: 4, moss: 2 }, out: {} } });
      const b = await savedPlayer(storage, { map: 'house', x: 5, y: 2, dir: 'up' });
      const ca = await login(a.token), cb = await login(b.token);
      expect(ca.welcome.furniture).toEqual([]);
      expect(cb.welcome.furniture).toEqual([]);

      // At the workbench: the stove goes into its place, and the stash pays for it.
      ca.c.send({ t: 'craft', x: 5, y: 1, recipe: 'stove' });
      expect(await ca.c.next('furniture')).toEqual({ t: 'furniture', furniture: ['stove'] });
      expect(await ca.c.next('did')).toEqual({ t: 'did', did: { kind: 'made', item: 'stove', count: 1, comfort: 3 } });
      ca.c.send({ t: 'craft', x: 5, y: 1, recipe: 'stove' });
      expect(await ca.c.next('refused')).toEqual({ t: 'refused', action: 'craft', reason: 'placed' });
      await waitFor(() => storage.get(a.id)?.furniture?.length === 1, 'the stove to be saved');
      expect(storage.get(a.id)).toMatchObject({ furniture: ['stove'], stash: { items: { moss: 2 } } });
      // b, in a cabin of their own, heard nothing of it.
      expect((await cb.c.settle()).filter(m => m.t !== 'energy')).toEqual([]);

      // By the fire (3,2): two steps west. Once it has warmed a for COZY_AFTER_S, a is cozy for 8 minutes.
      for (const [i, dir] of (['left', 'left'] as const).entries()) {
        now += STEP_MS + 10;
        ca.c.send({ t: 'step', dir, seq: i + 1 });
        await ca.c.next('step', m => m.seq === i + 1);
      }
      expect((await ca.c.next('energy', m => m.body.fireside !== undefined)).body.cozy).toBeUndefined();
      now += COZY_AFTER_S * 1000;
      const cozy = await ca.c.next('energy', m => m.body.cozy !== undefined);
      expect(cozy.body).toMatchObject({ cozy: cozySeconds(3) });
      expect(cozy.body.fireside).toBeGreaterThanOrEqual(COZY_AFTER_S);

      // Gone and back: the stove is still in its place, told with the room, and a is still cozy.
      ca.c.ws.close();
      await waitFor(() => !server.world.has(a.id), 'a to leave');
      expect(storage.get(a.id)!.cozy).toBeGreaterThan(Date.now());
      const back = await login(a.token);
      expect(back.welcome.furniture).toEqual(['stove']);
      expect(back.welcome.body.cozy).toBeGreaterThan(0);
    } finally {
      for (const c of clients) c.ws.terminate();
      await server.stop();
    }
  });

  it('dries you as you walk out of your cabin with the rack in it, and tires you slower out there while cozy', async () => {
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
      // Both soaked, one with the rack in their cabin: out through the door, onto the town's 7,3.
      const a = await savedPlayer(storage, { map: 'house', x: 2, y: 3, dir: 'down', wet: 0.9, furniture: ['rack'] });
      const b = await savedPlayer(storage, { map: 'house', x: 2, y: 3, dir: 'down', wet: 0.9 });
      const ca = await login(a.token), cb = await login(b.token);
      ca.c.send({ t: 'step', dir: 'down', seq: 1 });
      cb.c.send({ t: 'step', dir: 'down', seq: 1 });
      expect(await ca.c.next('zone')).toMatchObject({ map: { id: 'town' }, x: 7, y: 3 });
      expect((await ca.c.next('energy')).body.wet).toBe(0);
      expect(await cb.c.next('zone')).toMatchObject({ map: { id: 'town' }, x: 7, y: 3 });
      expect((await cb.c.next('energy')).body.wet).toBeGreaterThan(0.85);

      // Two dry players below the road into the woods, one still cozy from their fire: one step up, and
      // side by side where the road comes in, the cozy one tires 10% slower.
      const c = await savedPlayer(storage, { map: 'town', x: 5, y: 1, dir: 'up', cozy: Date.now() + 10 * 60_000 });
      const d = await savedPlayer(storage, { map: 'town', x: 5, y: 1, dir: 'up' });
      const rates: number[] = [];
      for (const who of [c, d]) {
        const { c: client } = await login(who.token);
        now += STEP_MS + 10;
        client.send({ t: 'step', dir: 'up', seq: 1 });
        expect(await client.next('zone')).toMatchObject({ map: { id: 'woods' }, x: 4, y: 6 });
        rates.push((await client.next('energy', m => m.energy.rate < 0)).energy.rate);
      }
      expect(rates[0]! / rates[1]!).toBeCloseTo(COZY_DRAIN, 2);
    } finally {
      for (const c of clients) c.ws.terminate();
      await server.stop();
    }
  });
});
