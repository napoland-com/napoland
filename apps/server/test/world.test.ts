import { describe, expect, it } from 'vitest';
import {
  BAG_SLOTS, DROP_LIFETIME_MS, ENERGY_MAX, ENERGY_SYNC_MS, REFILL_PER_SECOND, STEP_MS, TileMap, WET_SECONDS, energyRate,
  type BagSlot, type Dir, type DropView, type EnergyView, type MapData, type ServerMsg, type Weather,
} from '@napoland/shared';
import type { DropRecord, PlayerRecord } from '../src/storage';
import { JACKET_COLORS, STEP_QUEUE_MAX, STEP_TOLERANCE_MS, World, colorFor, type Outgoing, type WorldOptions } from '../src/world';
import { MOSS_TILES, fixtureMaps, houseData, itemsData, woodsData } from './fixtures';

/** 8x5 grass with water in the two right columns and rocks at 1,0 and 2,0: a town of its own. */
function testMap(): TileMap {
  const data: MapData = {
    id: 'test', name: 'Test', version: 1, kind: 'town', depth: 0, width: 8, height: 5,
    tiles: Array<string>(5).fill('ggggggww'),
    levels: Array<string>(5).fill('00000000'),
    spawn: { x: 1, y: 2, dir: 'down' },
    exits: [],
    objects: [
      { kind: 'rock', x: 1, y: 0, s: 1, v: 0 },
      { kind: 'rock', x: 2, y: 0, s: 1, v: 0 },
    ],
  };
  return new TileMap(data);
}

/** A player saved on map 'test' with a full bar, unless `more` says otherwise. */
function rec(id: string, x: number, y: number, dir: Dir = 'down', more: Partial<PlayerRecord> = {}): PlayerRecord {
  return {
    id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map: 'test', x, y, dir, color: colorFor(id), energy: ENERGY_MAX, bag: [],
    createdAt: 1, lastSeenAt: 1, ...more,
  };
}

/** A world of the one test map with the given players joined and the join messages already drained. */
function worldWith(...players: PlayerRecord[]): World {
  const w = new World([testMap()], 'test', 'rain');
  for (const p of players) w.join(p, 0);
  w.drain();
  return w;
}

/** The town, the house and the woods of fixtures.ts (home: the town), players joined at time 0, joins drained. */
function woodsWorld(weather: Weather, ...players: PlayerRecord[]): World {
  const w = new World(fixtureMaps(), 'town', weather);
  for (const p of players) w.join(p, 0);
  w.drain();
  return w;
}
const woods = new TileMap(woodsData());
const house = new TileMap(houseData());
/** Energy per second at 3,6 in the woods, where the road from town arrives: one step from home. */
const edge = energyRate(woods, 3, 6, 'overcast');
const inTown = (id: string, x: number, y: number, dir: Dir = 'down', more: Partial<PlayerRecord> = {}) => rec(id, x, y, dir, { map: 'town', ...more });
const inWoods = (id: string, x: number, y: number, dir: Dir = 'up', more: Partial<PlayerRecord> = {}) => rec(id, x, y, dir, { map: 'woods', ...more });
const inHouse = (id: string, x: number, y: number, dir: Dir = 'up', more: Partial<PlayerRecord> = {}) => rec(id, x, y, dir, { map: 'house', ...more });
const viewOf = (id: string, x: number, y: number, dir: Dir) => ({ id, name: id.toUpperCase(), x, y, dir, color: colorFor(id), gear: {}, quirks: [] });
/**
 * What a zone lists besides players, finds and piles, in the fixture world: fires burn down at random levels, and nothing else is
 * there; and the weather over the new map, which these worlds keep overcast everywhere.
 */
const SCENE = { fires: expect.any(Array), marks: [], creatures: [], flares: [], flashes: [], surge: null, storm: null, stats: expect.any(Object), weather: 'overcast' };
/** The energy a player is told: value to 1 decimal, rate to 3. */
const told = (value: number, rate: number): EnergyView => ({ value: Math.round(value * 10) / 10, max: ENERGY_MAX, rate: Math.round(rate * 1000) / 1000 });

/** The step or reject answers `id` got, in order. */
const answers = (out: Outgoing[], id: string) => out.filter(o => o.to === id).map(o => o.msg);
/** The energy messages in `out`, as [to, energy]. */
const energies = (out: Outgoing[]) => out.flatMap(o => (o.msg.t === 'energy' ? [[o.to, o.msg.energy] as const] : []));
/** The messages in `out` for everyone on `map`, in order. */
const heardOn = (out: Outgoing[], map: string) => out.flatMap(o => ('map' in o && o.map === map ? [o.msg] : []));
/** Everything in `out` but energy (which the woods repeat every few seconds). */
const noEnergy = (out: Outgoing[]) => out.filter(o => o.msg.t !== 'energy');

/** Dice that roll the same every run (Park-Miller). */
const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
/** The fixture world with the fixture items (fixtures.ts), players joined at time 0; joins and writes drained. */
function itemsWorld(options: WorldOptions = {}, ...players: PlayerRecord[]): World {
  const w = new World(fixtureMaps(), 'town', 'overcast', { items: itemsData(), rng: seeded(7), ...options });
  for (const p of players) w.join(p, 0);
  w.drain();
  w.takeWrites();
  return w;
}
/** A pile as storage keeps it. */
const pileOf = (owner: string, map: string, x: number, y: number, items: BagSlot[], droppedAt = 0): DropRecord => ({
  owner, name: owner.toUpperCase(), map, x, y, items, droppedAt, trail: [],
});
const dropOf = (d: DropRecord): DropView => ({ id: d.owner, x: d.x, y: d.y, owner: d.owner, name: d.name, until: d.droppedAt + DROP_LIFETIME_MS, trail: d.trail ?? [] });
const units = (slots: BagSlot[]) => slots.reduce((n, s) => n + s.count, 0);
const fullOfNails = (): BagSlot[] => Array.from({ length: BAG_SLOTS }, () => ({ item: 'nail', count: 5 }));

describe('World: stepping', () => {
  it('moves one tile, gives the mover its seq and everyone else the step without it', () => {
    const w = worldWith(rec('a', 1, 1), rec('b', 4, 4));
    w.step('a', 'right', 7, 1000);
    expect(w.drain()).toEqual([
      { to: 'a', msg: { t: 'step', id: 'a', x: 2, y: 1, dir: 'right', seq: 7 } },
      { to: '*', map: 'test', except: 'a', msg: { t: 'step', id: 'a', x: 2, y: 1, dir: 'right' } },
    ]);
    expect(w.get('a')).toMatchObject({ x: 2, y: 1, dir: 'right' });
  });

  it('queues up to two early steps, rejects a third and runs the queue on tick', () => {
    const w = worldWith(rec('a', 1, 1));
    w.step('a', 'right', 1, 1000); // runs: readyAt is now 1200
    w.step('a', 'right', 2, 1000);
    w.step('a', 'right', 3, 1000);
    expect(STEP_QUEUE_MAX).toBe(2);
    expect(answers(w.drain(), 'a')).toEqual([{ t: 'step', id: 'a', x: 2, y: 1, dir: 'right', seq: 1 }]);

    w.step('a', 'down', 4, 1000); // queue full: refused where the player is now
    expect(w.drain()).toEqual([{ to: 'a', msg: { t: 'reject', seq: 4, x: 2, y: 1, dir: 'right' } }]);

    w.tick(1200 - STEP_TOLERANCE_MS - 1);
    expect(w.drain()).toEqual([]);
    w.tick(1200 - STEP_TOLERANCE_MS); // step 2 may start 40 ms early; readyAt becomes 1400
    expect(answers(w.drain(), 'a')).toEqual([{ t: 'step', id: 'a', x: 3, y: 1, dir: 'right', seq: 2 }]);
    w.tick(1300);
    expect(w.drain()).toEqual([]);
    w.tick(1400 - STEP_TOLERANCE_MS);
    expect(answers(w.drain(), 'a')).toEqual([{ t: 'step', id: 'a', x: 4, y: 1, dir: 'right', seq: 3 }]);
    w.tick(5000);
    expect(w.drain()).toEqual([]);
  });

  it('lets a step start up to 40 ms early, and no earlier', () => {
    const w = worldWith(rec('a', 1, 1));
    w.step('a', 'right', 1, 1000);
    w.step('a', 'down', 2, 1200 - STEP_TOLERANCE_MS); // just in time
    w.step('a', 'down', 3, 1400 - STEP_TOLERANCE_MS - 1); // 1 ms too early: waits
    expect(answers(w.drain(), 'a').map(m => m.t === 'step' && m.seq)).toEqual([1, 2]);
    w.tick(1400 - STEP_TOLERANCE_MS);
    expect(answers(w.drain(), 'a')).toEqual([{ t: 'step', id: 'a', x: 2, y: 3, dir: 'down', seq: 3 }]);
  });

  it('never lets anyone walk faster than one tile per stepMs, however fast they send', () => {
    const w = worldWith(rec('a', 2, 2));
    const walked: number[] = [];
    let rejected = 0;
    for (let now = 0, seq = 0; now <= 4000; now += 5) {
      // Flood: a step every 5 ms, back and forth so the walls never get in the way.
      w.step('a', seq % 2 ? 'left' : 'right', seq++, now);
      if (now % 50 === 0) w.tick(now);
      for (const m of answers(w.drain(), 'a')) {
        if (m.t === 'step') walked.push(now);
        else rejected++;
      }
    }
    expect(rejected).toBeGreaterThan(0);
    expect(walked.length).toBeLessThanOrEqual(4000 / STEP_MS + 1);
    // Starting early never adds up: n steps always take at least n * stepMs, minus one tolerance.
    for (let i = 0; i < walked.length; i++) {
      for (let j = i + 1; j < walked.length; j++) expect(walked[j]! - walked[i]!).toBeGreaterThanOrEqual((j - i) * STEP_MS - STEP_TOLERANCE_MS);
    }
  });

  it('never rejects a client that sends at the right pace, even with network jitter', () => {
    const w = worldWith(rec('a', 2, 2));
    let rng = 42;
    const jitter = () => ((rng = (rng * 48271) % 2147483647) % 71) - 35; // -35..35 ms
    const arrivals = Array.from({ length: 60 }, (_, i) => 1000 + i * STEP_MS + jitter());
    const answered: string[] = [];
    let next = 0;
    for (let now = 1000 - 35; now <= arrivals.at(-1)! + 1000; now++) {
      while (next < arrivals.length && arrivals[next]! <= now) w.step('a', next % 2 ? 'left' : 'right', next++, now);
      if (now % 50 === 0) w.tick(now);
      for (const m of answers(w.drain(), 'a')) answered.push(m.t);
    }
    expect(answered).toEqual(Array<string>(60).fill('step'));
  });

  it('rejects steps into walls, water and the map edge with the real position, to the mover only', () => {
    const w = worldWith(rec('rock', 1, 1, 'left'), rec('water', 5, 3, 'up'), rec('edge', 0, 4, 'right'), rec('other', 3, 3));
    w.step('rock', 'up', 1, 1000);
    w.step('water', 'right', 2, 1000);
    w.step('edge', 'down', 3, 1000);
    expect(w.drain()).toEqual([
      { to: 'rock', msg: { t: 'reject', seq: 1, x: 1, y: 1, dir: 'left' } },
      { to: 'water', msg: { t: 'reject', seq: 2, x: 5, y: 3, dir: 'up' } },
      { to: 'edge', msg: { t: 'reject', seq: 3, x: 0, y: 4, dir: 'right' } },
    ]);
    expect(w.get('rock')).toMatchObject({ x: 1, y: 1, dir: 'left' });
  });

  it('drops the steps queued behind one that hits a wall', () => {
    const w = worldWith(rec('a', 1, 1));
    w.step('a', 'right', 1, 1000); // to 2,1
    w.step('a', 'up', 2, 1000); // queued: 2,0 is a rock
    w.step('a', 'down', 3, 1000); // queued behind it
    w.drain();
    w.tick(1200);
    expect(w.drain()).toEqual([{ to: 'a', msg: { t: 'reject', seq: 2, x: 2, y: 1, dir: 'right' } }]);
    w.tick(2000);
    w.tick(3000);
    expect(w.drain()).toEqual([]);
    expect(w.get('a')).toMatchObject({ x: 2, y: 1 });
  });

  it('lets players share a tile', () => {
    const w = worldWith(rec('a', 3, 3), rec('b', 4, 3));
    w.step('a', 'right', 1, 1000);
    w.step('b', 'down', 1, 1000);
    w.step('b', 'up', 2, 1200);
    expect(w.get('a')).toMatchObject({ x: 4, y: 3 });
    expect(w.get('b')).toMatchObject({ x: 4, y: 3 });
    expect(w.drain().some(o => o.msg.t === 'reject')).toBe(false);
  });

  it('does not reset the step timer when a player leaves and comes back', () => {
    const w = worldWith(rec('a', 3, 3));
    w.step('a', 'right', 1, 1000); // readyAt 1200
    const back = w.leave('a', 1005)!;
    w.join(back, 1005);
    w.drain();
    w.step('a', 'right', 2, 1010);
    expect(w.drain()).toEqual([]);
    w.tick(1200);
    expect(answers(w.drain(), 'a')).toEqual([{ t: 'step', id: 'a', x: 5, y: 3, dir: 'right', seq: 2 }]);
  });

  it('ignores steps and turns of players who are not online', () => {
    const w = worldWith(rec('a', 3, 3));
    w.step('ghost', 'right', 1, 1000);
    w.face('ghost', 'left');
    w.tick(2000);
    expect(w.drain()).toEqual([]);
  });
});

describe('World: turning, joining and leaving', () => {
  it('tells everyone else when a player turns, and only if the direction changed', () => {
    const w = worldWith(rec('a', 3, 3, 'down'), rec('b', 1, 1));
    w.face('a', 'left');
    expect(w.drain()).toEqual([{ to: '*', map: 'test', except: 'a', msg: { t: 'face', id: 'a', dir: 'left' } }]);
    expect(w.get('a')?.dir).toBe('left');
    w.face('a', 'left');
    expect(w.drain()).toEqual([]);
  });

  it('announces joins and leaves to everyone else, and welcomes with the map, its players and the energy', () => {
    const w = new World([testMap()], 'test', 'rain');
    const joined = w.join(rec('a', 3, 3), 0);
    expect(joined).toEqual({
      player: { id: 'a', name: 'A', x: 3, y: 3, dir: 'down', color: colorFor('a'), gear: {}, quirks: [] },
      map: { id: 'test', version: 1 },
      players: [joined.player],
      // A town without a fireplace: energy holds.
      energy: { value: ENERGY_MAX, max: ENERGY_MAX, rate: 0 },
      // No items in this world: nothing lies around, and the bag and the stash are empty.
      finds: [],
      drops: [],
      bag: [],
      stash: [],
      // No fires, marks, creatures or flares here, and a town never surges. Rain soaks you in town too.
      fires: [], marks: [], creatures: [], flares: [], flashes: [], surge: null, storm: null, weather: 'rain',
      body: { wet: 0, wetRate: Math.round((1 / WET_SECONDS) * 1e5) / 1e5, load: 0, hitched: false, worn: {} },
      stone: { charge: 0, need: 20, awake: false, left: 0 },
      // No conditions in this world: every day is like the one before.
      conditions: { today: [], week: null, next: null },
      // The first week after the epoch is a spring's, from three days before it: four days of it left at 0.
      season: { season: 'spring', left: 4 * 86_400 },
      // The first Long Night is on the Saturday after the epoch, with its bonus: no fire went out before it.
      longNight: { on: false, bonus: true, out: false },
      stats: {},
      // Nothing stashed yet: level 1, and the next level at 30 XP.
      progress: { xp: 0, level: 1, from: 0, to: 30, maxEnergy: ENERGY_MAX },
      // Seen just before joining: no time away to rest in.
      restedAway: 0,
      // No merits spent and no looks bought.
      merits: { spent: 0, owned: [] },
      // No items, so no paper map to carry.
      tools: [],
      // No story in this world: no chapter to be in.
      story: { version: 0, chapter: '' },
      // Nobody thanked today.
      thanked: [],
    });
    expect(w.drain()).toEqual([
      { to: '*', map: 'test', except: 'a', msg: { t: 'join', player: joined.player } },
      { to: 'a', msg: { t: 'energy', energy: joined.energy, body: expect.any(Object) } },
    ]);
    expect(w.join(rec('b', 4, 4), 0).players.map(v => v.id)).toEqual(['a', 'b']);
    expect(w.views('test').map(v => v.id)).toEqual(['a', 'b']);
    expect(w.size).toBe(2);
    w.drain();

    w.step('a', 'up', 1, 1000);
    w.drain();
    expect(w.leave('a', 1000)).toMatchObject({ id: 'a', map: 'test', x: 3, y: 2, dir: 'up', tokenHash: 'hash-a', energy: ENERGY_MAX });
    expect(w.drain()).toEqual([{ to: '*', map: 'test', except: 'a', msg: { t: 'leave', id: 'a' } }]);
    expect(w.has('a')).toBe(false);
    expect(w.leave('a', 1000)).toBeUndefined();
    expect(w.drain()).toEqual([]);
  });

  it('gives everyone, new or not, the paper map of the Near Woods, apart from the bag', () => {
    const items = { version: 1, items: [{ id: 'near-woods-map', name: 'Map', kind: 'tool' as const, stack: 1, text: 'Old.' }], finds: [] };
    const w = new World([testMap()], 'test', 'rain', { items });
    const joined = w.join(rec('a', 3, 3, 'down', { bag: [] }), 0);
    expect(joined.tools).toEqual(['near-woods-map']);
    expect(joined.bag).toEqual([]);
  });

  it('puts a player whose saved tile is no longer walkable at the spawn', () => {
    const w = new World([testMap()], 'test', 'rain');
    expect(w.join(rec('a', 1, 0), 0).player).toMatchObject({ x: 1, y: 2, dir: 'down' }); // a rock
    expect(w.join(rec('b', 60, 60), 0).player).toMatchObject({ x: 1, y: 2, dir: 'down' }); // off the map
  });

  it('refuses to have the same player online twice', () => {
    const w = worldWith(rec('a', 3, 3));
    expect(() => w.join(rec('a', 3, 3), 0)).toThrow(/already online/);
  });

  it('keeps its own copy of the record', () => {
    const r = rec('a', 3, 3);
    const w = worldWith(r);
    w.step('a', 'right', 1, 1000);
    expect(r.x).toBe(3);
    const copy = w.get('a')!;
    copy.x = 99;
    expect(w.get('a')?.x).toBe(4);
  });

  it('refuses maps that do not fit together', () => {
    expect(() => new World([testMap()], 'nowhere', 'rain')).toThrow(/home map nowhere/);
    expect(() => new World([testMap(), testMap()], 'test', 'rain')).toThrow(/two maps have the id test/);
    expect(() => new World([new TileMap(woodsData())], 'woods', 'rain')).toThrow(/exit to town, which does not exist/);
  });
});

describe('World: maps and exits', () => {
  it('walks through an exit: the step for the old map, then leave, join, zone and energy', () => {
    const w = woodsWorld('overcast', inTown('a', 4, 1, 'up'), inTown('b', 0, 5), inWoods('c', 5, 5));
    w.step('a', 'up', 1, 1000);
    expect(w.drain()).toEqual([
      { to: 'a', msg: { t: 'step', id: 'a', x: 4, y: 0, dir: 'up', seq: 1 } },
      { to: '*', map: 'town', except: 'a', msg: { t: 'step', id: 'a', x: 4, y: 0, dir: 'up' } },
      { to: '*', map: 'town', except: 'a', msg: { t: 'leave', id: 'a' } },
      { to: '*', map: 'woods', except: 'a', msg: { t: 'join', player: viewOf('a', 3, 6, 'up') } },
      {
        to: 'a',
        msg: { t: 'zone', map: { id: 'woods', version: 1 }, x: 3, y: 6, dir: 'up', players: [viewOf('c', 5, 5, 'up'), viewOf('a', 3, 6, 'up')], finds: [], drops: [], ...SCENE, reason: 'exit' },
      },
      { to: 'a', msg: { t: 'energy', energy: told(ENERGY_MAX, energyRate(woods, 3, 6, 'overcast')), body: expect.any(Object) } },
    ]);
    expect(w.get('a')).toMatchObject({ map: 'woods', x: 3, y: 6, dir: 'up' });
    expect(w.views('town').map(v => v.id)).toEqual(['b']);
    expect(w.views('woods').map(v => v.id)).toEqual(['c', 'a']);
  });

  it('keeps each lane of a wide exit, and leads back to town facing the other way', () => {
    const w = woodsWorld('overcast', inTown('a', 5, 1, 'up'));
    w.step('a', 'up', 1, 1000);
    expect(answers(w.drain(), 'a')[1]).toMatchObject({ t: 'zone', map: { id: 'woods' }, x: 4, y: 6, dir: 'up', reason: 'exit' });
    w.step('a', 'down', 2, 1200);
    const back = answers(w.drain(), 'a');
    expect(back.map(m => m.t)).toEqual(['step', 'zone', 'energy']);
    expect(back[0]).toEqual({ t: 'step', id: 'a', x: 4, y: 7, dir: 'down', seq: 2 });
    expect(back[1]).toEqual({ t: 'zone', map: { id: 'town', version: 1 }, x: 5, y: 1, dir: 'down', players: [viewOf('a', 5, 1, 'down')], finds: [], drops: [], ...SCENE, reason: 'exit' });
    // What the woods took in the 200 ms there, and in town it holds.
    expect(back[2]).toEqual({ t: 'energy', energy: told(ENERGY_MAX + 0.2 * energyRate(woods, 4, 6, 'overcast'), 0), body: expect.any(Object) });
    expect(w.get('a')).toMatchObject({ map: 'town', x: 5, y: 1, dir: 'down' });
  });

  it('walks into a house through its door and out again, in front of the door facing away from it', () => {
    const w = woodsWorld('overcast', inTown('a', 7, 3, 'up', { energy: 50 }), inTown('b', 0, 5));
    w.step('a', 'up', 1, 1000);
    expect(w.drain()).toEqual([
      { to: 'a', msg: { t: 'step', id: 'a', x: 7, y: 2, dir: 'up', seq: 1 } },
      { to: '*', map: 'town', except: 'a', msg: { t: 'step', id: 'a', x: 7, y: 2, dir: 'up' } },
      { to: '*', map: 'town', except: 'a', msg: { t: 'leave', id: 'a' } },
      { to: '*', map: 'house', except: 'a', msg: { t: 'join', player: viewOf('a', 2, 3, 'up') } },
      { to: 'a', msg: { t: 'zone', map: { id: 'house', version: 1 }, x: 2, y: 3, dir: 'up', players: [viewOf('a', 2, 3, 'up')], finds: [], drops: [], ...SCENE, reason: 'exit' } },
      { to: 'a', msg: { t: 'energy', energy: told(50, 0), body: expect.any(Object) } },
    ]);
    expect(w.views('house').map(v => v.id)).toEqual(['a']);

    w.step('a', 'down', 2, 1200);
    const out = answers(w.drain(), 'a');
    expect(out.map(m => m.t)).toEqual(['step', 'zone', 'energy']);
    expect(out[0]).toEqual({ t: 'step', id: 'a', x: 2, y: 4, dir: 'down', seq: 2 });
    expect(out[1]).toEqual({
      t: 'zone', map: { id: 'town', version: 1 }, x: 7, y: 3, dir: 'down', players: [viewOf('b', 0, 5, 'down'), viewOf('a', 7, 3, 'down')], finds: [], drops: [], ...SCENE, reason: 'exit',
    });
    expect(out[2]).toEqual({ t: 'energy', energy: told(50, 0), body: expect.any(Object) });
    expect(w.get('a')).toMatchObject({ map: 'town', x: 7, y: 3, dir: 'down', energy: 50 });
    expect(w.views('house')).toEqual([]);
  });

  it('drops the steps queued on the old map, and changing maps never saves time', () => {
    const w = woodsWorld('overcast', inTown('a', 4, 2, 'up'));
    w.step('a', 'up', 1, 1000); // to 4,1; readyAt 1200
    w.step('a', 'up', 2, 1000); // queued: onto the exit
    w.step('a', 'left', 3, 1000); // queued behind it, planned on the town map
    w.drain();
    w.tick(1200 - STEP_TOLERANCE_MS); // step 2 crosses into the woods; readyAt 1400
    expect(answers(w.drain(), 'a').map(m => m.t)).toEqual(['step', 'zone', 'energy']);
    w.tick(1300);
    w.tick(1600);
    expect(w.drain()).toEqual([]); // step 3 is gone for good

    w.step('a', 'down', 4, 1600 + 1); // readyAt is 1400: runs at once, into the home exit
    expect(answers(w.drain(), 'a').map(m => m.t)).toEqual(['step', 'zone', 'energy']); // readyAt 1801
    w.step('a', 'up', 5, 1801 - STEP_TOLERANCE_MS - 1); // back in town, and still has to wait
    expect(w.drain()).toEqual([]);
    w.tick(1801 - STEP_TOLERANCE_MS);
    expect(answers(w.drain(), 'a')[0]).toEqual({ t: 'step', id: 'a', x: 4, y: 0, dir: 'up', seq: 5 });
  });

  it('shows each map only its own players', () => {
    const w = woodsWorld('overcast', inTown('t1', 1, 2), inWoods('w1', 5, 5));
    const joined = w.join(inWoods('w2', 5, 4), 0);
    expect(joined.map).toEqual({ id: 'woods', version: 1 });
    expect(joined.players.map(p => p.id)).toEqual(['w1', 'w2']);
    expect(w.drain()).toEqual([
      { to: '*', map: 'woods', except: 'w2', msg: { t: 'join', player: joined.player } },
      { to: 'w2', msg: { t: 'energy', energy: joined.energy, body: expect.any(Object) } },
    ]);
    w.face('w2', 'left');
    w.step('t1', 'down', 1, 1000);
    w.leave('w2', 1000);
    expect(w.drain()).toEqual([
      { to: '*', map: 'woods', except: 'w2', msg: { t: 'face', id: 'w2', dir: 'left' } },
      { to: 't1', msg: { t: 'step', id: 't1', x: 1, y: 3, dir: 'down', seq: 1 } },
      { to: '*', map: 'town', except: 't1', msg: { t: 'step', id: 't1', x: 1, y: 3, dir: 'down' } },
      { to: '*', map: 'woods', except: 'w2', msg: { t: 'leave', id: 'w2' } },
    ]);
  });

  it('starts a player whose map is gone at the home spawn, and one inside a wall or on an exit at the spawn of their map', () => {
    const w = woodsWorld('overcast');
    expect(w.join(rec('a', 3, 6, 'up', { map: 'gone' }), 0)).toMatchObject({ map: { id: 'town' }, player: { x: 1, y: 2, dir: 'down' } });
    expect(w.get('a')).toMatchObject({ map: 'town', x: 1, y: 2 });
    expect(w.join(inWoods('b', 0, 0), 0)).toMatchObject({ map: { id: 'woods' }, player: { x: 5, y: 5, dir: 'up' } });
    expect(w.join(inWoods('c', 2, 6, 'left'), 0)).toMatchObject({ map: { id: 'woods' }, player: { x: 2, y: 6, dir: 'left' } });
    // An exit tile (saved there before the exit was drawn) would move the player at the first step.
    expect(w.join(inWoods('d', 3, 7, 'down'), 0)).toMatchObject({ map: { id: 'woods' }, player: { x: 5, y: 5, dir: 'up' } });
  });
});

describe('World: energy', () => {
  it('drains in the wilds, even under a street light', () => {
    expect(edge).toBeLessThan(0);
    // 3,5 is in the lamp's light and 4,5 is not; both are two steps from home.
    expect([woods.lit(3, 5), woods.lit(4, 5)]).toEqual([true, false]);
    const twoSteps = energyRate(woods, 4, 5, 'overcast');
    const w = woodsWorld('overcast', inWoods('a', 3, 6, 'up', { energy: 50 }), inWoods('lit', 3, 5, 'up', { energy: 50 }), inWoods('dark', 4, 5, 'up', { energy: 50 }));
    expect(w.join(inWoods('b', 3, 6, 'up', { energy: 50 }), 0).energy).toEqual(told(50, edge));
    w.tick(10_000);
    expect(w.get('a')!.energy).toBeCloseTo(50 + 10 * edge);
    expect(w.get('lit')!.energy).toBeCloseTo(50 + 10 * twoSteps);
    expect(w.get('lit')!.energy).toBe(w.get('dark')!.energy);
    w.drain();
    w.step('a', 'up', 1, 10_000); // into the light: it drains on, about as fast, so there is nothing new to tell
    expect(energies(w.drain())).toEqual([]);
    w.tick(11_000);
    expect(w.get('a')!.energy).toBeCloseTo(50 + 10 * edge + twoSteps);
  });

  it('holds in town and inside a building away from the fire, whatever the weather, and says nothing while it holds', () => {
    const w = woodsWorld('overcast', inTown('t', 0, 5, 'down', { energy: 50 }), inHouse('h', 2, 3, 'up', { energy: 50 }));
    expect(w.join(inTown('u', 7, 3, 'up', { energy: 50 }), 0).energy).toEqual(told(50, 0));
    expect(w.join(inHouse('i', 1, 3, 'up', { energy: 50 }), 0).energy).toEqual(told(50, 0));
    w.drain();
    for (let now = 1000; now <= 60_000; now += 1000) w.tick(now);
    w.step('t', 'right', 1, 60_000);
    w.step('i', 'right', 1, 60_000); // still away from the fire
    w.setWeather('night', 61_000);
    w.tick(120_000);
    expect(energies(w.drain())).toEqual([]);
    for (const id of ['t', 'h', 'u', 'i']) expect(w.get(id)!.energy).toBe(50);
  });

  it('refills next to the fireplace of a building reached through its door, until full', () => {
    expect([house.warm(2, 3), house.warm(2, 2)]).toEqual([false, true]);
    const w = woodsWorld('overcast', inTown('a', 7, 3, 'up', { energy: 50 }));
    w.step('a', 'up', 1, 1000); // onto the door: inside, away from the fire
    expect(w.get('a')).toMatchObject({ map: 'house', x: 2, y: 3 });
    expect(energies(w.drain())).toEqual([['a', told(50, 0)]]);
    w.step('a', 'up', 2, 1200); // next to the fire
    expect(energies(w.drain())).toEqual([['a', told(50, REFILL_PER_SECOND)]]);
    w.tick(1200 + ENERGY_SYNC_MS);
    expect(energies(w.drain())).toEqual([['a', told(50 + (ENERGY_SYNC_MS / 1000) * REFILL_PER_SECOND, REFILL_PER_SECOND)]]);
    w.tick(30_000);
    expect(w.get('a')!.energy).toBe(ENERGY_MAX);
    expect(energies(w.drain())).toEqual([]);
  });

  it('tells the player at once when the rate turns: next to a fire and away from it, in the woods and inside', () => {
    const far = energyRate(woods, 6, 1, 'overcast'); // the end of the right side, 8 steps from home
    const w = woodsWorld('overcast', inWoods('a', 6, 1, 'left', { energy: 50 }), inHouse('h', 2, 3, 'up', { energy: 50 }));
    w.step('a', 'left', 1, 1000); // next to the campfire
    w.step('h', 'up', 1, 1000); // next to the fireplace
    expect(energies(w.drain())).toEqual([
      ['a', told(50 + far, REFILL_PER_SECOND)],
      ['h', told(50, REFILL_PER_SECOND)],
    ]);
    w.step('a', 'right', 2, 1200); // away from the campfire: it drains again
    w.step('h', 'down', 2, 1200); // away from the fireplace: it holds
    expect(energies(w.drain())).toEqual([
      ['a', told(50 + far + 0.2 * REFILL_PER_SECOND, far)],
      ['h', told(50 + 0.2 * REFILL_PER_SECOND, 0)],
    ]);
  });

  it('tells the player when the rate moved more than 10% since they last heard it, not at every step', () => {
    const w = woodsWorld('overcast', inWoods('a', 3, 6, 'up', { energy: 50 }));
    // Up the right side, one step farther from home each time (see fixtures.ts).
    const walk: Dir[] = ['right', 'right', 'right', 'up', 'up', 'up', 'up', 'up'];
    const heard: number[] = [];
    walk.forEach((dir, i) => {
      w.step('a', dir, i + 1, (i + 1) * STEP_MS);
      if (energies(w.drain()).length) heard.push(i + 1);
    });
    expect(w.get('a')).toMatchObject({ x: 6, y: 1 });
    // 8 steps from home instead of 1: 11.5% more drain; after 7 steps it was 9.8%.
    expect(heard).toEqual([8]);
    expect(energyRate(woods, 6, 1, 'overcast') / edge).toBeGreaterThan(1.1);
    expect(energyRate(woods, 6, 2, 'overcast') / edge).toBeLessThan(1.1);
  });

  it('repeats the energy every ENERGY_SYNC_MS while it changes, but not while it holds or is full', () => {
    // 'low' needs 2.5 s next to the fire to fill up; 'in' and 'town' hold.
    const w = woodsWorld(
      'overcast',
      inWoods('a', 3, 6, 'up', { energy: 50 }),
      inHouse('full', 1, 2),
      inHouse('low', 2, 2, 'up', { energy: 80 }),
      inHouse('in', 2, 3, 'up', { energy: 50 }),
      inTown('town', 1, 2, 'down', { energy: 50 }),
    );
    w.tick(ENERGY_SYNC_MS - 1);
    expect(energies(w.drain())).toEqual([]);
    w.tick(ENERGY_SYNC_MS);
    const s = ENERGY_SYNC_MS / 1000;
    expect(energies(w.drain())).toEqual([
      ['a', told(50 + s * edge, edge)],
      ['low', told(80 + s * REFILL_PER_SECOND, REFILL_PER_SECOND)],
    ]);
    w.tick(2 * ENERGY_SYNC_MS); // 'low' is full now
    expect(energies(w.drain()).map(([to]) => to)).toEqual(['a']);
    w.tick(3 * ENERGY_SYNC_MS - 1);
    expect(energies(w.drain())).toEqual([]);
    w.tick(10 * ENERGY_SYNC_MS);
    expect(energies(w.drain()).map(([to]) => to)).toEqual(['a']);
  });

  it('follows the weather: everyone hears it, and whoever drains hears their new rate', () => {
    const w = woodsWorld('overcast', inWoods('a', 3, 6, 'up', { energy: 50 }), inTown('t', 1, 2, 'down', { energy: 50 }));
    w.setWeather('night', 1000);
    expect(w.weather).toBe('night');
    expect(w.drain()).toEqual([
      { to: '*', map: 'town', msg: { t: 'weather', weather: 'night' } },
      { to: '*', map: 'woods', msg: { t: 'weather', weather: 'night' } },
      { to: 'a', msg: { t: 'energy', energy: told(50 + edge, energyRate(woods, 3, 6, 'night')), body: expect.any(Object) } },
    ]);
    w.tick(2000);
    expect(w.get('a')!.energy).toBeCloseTo(50 + edge + energyRate(woods, 3, 6, 'night'));
    w.setWeather('night', 2000);
    expect(w.drain().filter(o => o.msg.t !== 'energy')).toEqual([]);
  });
});

describe('World: collapsing', () => {
  /** The woods world, with a record of every collapse. */
  function collapsing(...players: PlayerRecord[]) {
    const collapses: Array<[string, { map: string; x: number; y: number }]> = [];
    const w = new World(fixtureMaps(), 'town', 'overcast', { onCollapse: (id, where) => collapses.push([id, where]) });
    for (const p of players) w.join(p, 0);
    w.drain();
    return { w, collapses };
  }

  it('wakes a player whose energy runs out at home, full; both maps and the player hear it', () => {
    const { w, collapses } = collapsing(inWoods('a', 3, 6, 'up', { energy: 1 }), inWoods('c', 5, 5), inTown('t', 0, 5));
    const empty = 1000 * (1 / -edge);
    w.tick(empty - 50);
    w.drain();
    expect(w.get('a')).toMatchObject({ map: 'woods', x: 3, y: 6 });
    expect(collapses).toEqual([]);
    w.tick(empty + 1);
    expect(w.drain()).toEqual([
      // The count first, as each goes up (what Mira says waits on it); the zone carries it too.
      { to: 'a', msg: { t: 'stats', stats: { collapsed: 1 } } },
      { to: '*', map: 'woods', except: 'a', msg: { t: 'leave', id: 'a' } },
      { to: '*', map: 'town', except: 'a', msg: { t: 'join', player: viewOf('a', 1, 2, 'down') } },
      {
        to: 'a',
        msg: { t: 'zone', map: { id: 'town', version: 1 }, x: 1, y: 2, dir: 'down', players: [viewOf('t', 0, 5, 'down'), viewOf('a', 1, 2, 'down')], finds: [], drops: [], ...SCENE, reason: 'collapse' },
      },
      // Full, and at the spawn in town it holds.
      { to: 'a', msg: { t: 'energy', energy: told(ENERGY_MAX, 0), body: expect.any(Object) } },
    ]);
    expect(w.get('a')).toMatchObject({ map: 'town', x: 1, y: 2, dir: 'down', energy: ENERGY_MAX });
    expect(collapses).toEqual([['a', { map: 'woods', x: 3, y: 6 }]]);
  });

  it('collapses instead of taking a step when the energy ran out before it', () => {
    const { w, collapses } = collapsing(inWoods('a', 3, 6, 'up', { energy: 0.1 }));
    w.step('a', 'up', 1, 1000);
    expect(answers(w.drain(), 'a').map(m => m.t)).toEqual(['stats', 'zone', 'energy']);
    expect(w.get('a')).toMatchObject({ map: 'town', x: 1, y: 2, energy: ENERGY_MAX });
    expect(collapses.map(([id]) => id)).toEqual(['a']);
  });

  it('keeps the step timer through a collapse', () => {
    // Enough for 1 s at 4,5 and 50 ms more at 4,6.
    const energy = -(energyRate(woods, 4, 5, 'overcast') + 0.05 * energyRate(woods, 4, 6, 'overcast'));
    const { w } = collapsing(inWoods('a', 4, 5, 'up', { energy }));
    w.step('a', 'down', 1, 1000); // 4,6 with a little energy left; readyAt 1200
    w.drain();
    w.tick(1100); // empty
    expect(w.get('a')).toMatchObject({ map: 'town' });
    w.drain();
    w.step('a', 'down', 2, 1100);
    expect(w.drain()).toEqual([]);
    w.tick(1200 - STEP_TOLERANCE_MS);
    expect(answers(w.drain(), 'a')[0]).toMatchObject({ t: 'step', x: 1, y: 3, seq: 2 });
  });

  it('saves a player whose energy runs out as they leave at home, full', () => {
    const { w, collapses } = collapsing(inWoods('a', 3, 6, 'up', { energy: 0.05 }), inWoods('c', 5, 5));
    expect(w.leave('a', 1000)).toMatchObject({ map: 'town', x: 1, y: 2, dir: 'down', energy: ENERGY_MAX, stats: { collapsed: 1 } });
    // The count, told as it goes up, finds nobody to hear it (net.ts): the welcome next time carries it.
    expect(w.drain()).toEqual([{ to: 'a', msg: { t: 'stats', stats: { collapsed: 1 } } }, { to: '*', map: 'woods', except: 'a', msg: { t: 'leave', id: 'a' } }]);
    expect(collapses).toEqual([['a', { map: 'woods', x: 3, y: 6 }]]);
    expect(w.views('town')).toEqual([]);
  });

  it('keeps the energy a player has when they leave in the wilds, and nothing drains while they are away', () => {
    const { w, collapses } = collapsing(inWoods('a', 3, 6, 'up', { energy: 50 }));
    const saved = w.leave('a', 10_000)!;
    expect(saved).toMatchObject({ map: 'woods', x: 3, y: 6 });
    expect(saved.energy).toBeCloseTo(50 + 10 * edge);
    expect(w.join(saved, 60_000).energy).toEqual(told(saved.energy, edge));
    w.tick(60_000);
    expect(w.get('a')!.energy).toBe(saved.energy);
    expect(collapses).toEqual([]);
  });
});

describe('World: finds', () => {
  it('lays out the finds of every rule at start, on tiles that fit the rule, and tells nobody', () => {
    const w = new World(fixtureMaps(), 'town', 'overcast', { items: itemsData(), rng: seeded(1) });
    expect(w.drain()).toEqual([]);
    const moss = w.findViews('woods');
    expect(moss).toEqual([{ id: expect.any(Number), item: 'moss', x: expect.any(Number), y: 1 }]);
    expect(MOSS_TILES).toContainEqual({ x: moss[0]!.x, y: moss[0]!.y });
    const nails = w.findViews('town');
    expect(nails.map(n => n.item)).toEqual(['nail', 'nail']);
    // Around the rock at 1,1, on two different tiles.
    for (const n of nails) expect(Math.max(Math.abs(n.x - 1), Math.abs(n.y - 1))).toBe(1);
    expect(new Set(nails.map(n => `${n.x},${n.y}`)).size).toBe(2);
    expect(new Set([...moss, ...nails].map(f => f.id)).size).toBe(3);
    expect(w.findViews('house')).toEqual([]);
  });

  it('never puts two finds on one tile, whatever the dice say', () => {
    const crowded = { ...itemsData(), finds: [{ item: 'nail', map: 'town', near: { kinds: ['rock' as const], radius: 1.5 }, count: 7, respawn: [1, 2] as [number, number] }] };
    for (let seed = 1; seed <= 50; seed++) {
      const w = new World(fixtureMaps(), 'town', 'rain', { items: crowded, rng: seeded(seed) });
      expect(new Set(w.findViews('town').map(f => `${f.x},${f.y}`)).size).toBe(7);
    }
  });

  it('refuses find rules for maps or items that do not exist', () => {
    const items = itemsData();
    const rule = items.finds[0]!;
    expect(() => new World(fixtureMaps(), 'town', 'rain', { items: { ...items, finds: [{ ...rule, map: 'nowhere' }] } })).toThrow(/map nowhere, which does not exist/);
    expect(() => new World(fixtureMaps(), 'town', 'rain', { items: { ...items, finds: [{ ...rule, item: 'nothing' }] } })).toThrow(/nothing, which is not an item/);
  });

  it('shows a player what lies on their map when they arrive, in the welcome and in zone', () => {
    const w = itemsWorld({}, inTown('a', 4, 1, 'up'));
    expect(w.join(inWoods('b', 1, 1), 0).finds).toEqual(w.findViews('woods'));
    expect(w.join(inTown('c', 0, 5), 0)).toMatchObject({ finds: w.findViews('town'), drops: [], bag: [] });
    w.step('a', 'up', 1, 1000); // into the woods
    expect(answers(w.drain(), 'a').find(m => m.t === 'zone')).toMatchObject({ map: { id: 'woods' }, finds: w.findViews('woods'), drops: [] });
  });

  it('lets a player pick up a find on their own tile: they hear what they got and their bag, the map hears it gone', () => {
    // With the dice at 0.9, the moss lies at 5,1.
    const w = itemsWorld({ rng: () => 0.9 }, inWoods('b', 1, 1), inTown('t', 0, 5), inWoods('a', 5, 1));
    expect(w.findViews('woods')).toEqual([{ id: 1, item: 'moss', x: 5, y: 1 }]);
    w.pick('a', 5, 1, 1000);
    expect(w.drain()).toEqual([
      { to: 'a', msg: { t: 'got', items: [{ item: 'moss', count: 1 }], from: 'find' } },
      { to: 'a', msg: { t: 'bag', bag: [{ item: 'moss', count: 1 }] } },
      { to: '*', map: 'woods', msg: { t: 'findGone', id: 1 } },
    ]);
    expect(w.get('a')!.bag).toEqual([{ item: 'moss', count: 1 }]);
    expect(w.findViews('woods')).toEqual([]);
    // Finds live in memory, and the bag is saved with the player later: nothing to write now.
    expect(w.takeWrites()).toEqual({ drops: [], players: [], marks: [], thanks: [], credits: [], caches: [] });
  });

  it('reaches the four tiles next to the player, not across a corner or farther; an empty tile is gone', () => {
    const w = itemsWorld({ rng: () => 0.9 }, inWoods('far', 3, 1), inWoods('corner', 6, 2), inWoods('next', 6, 1, 'left'));
    w.pick('far', 5, 1, 1000);
    w.pick('corner', 5, 1, 1000);
    w.pick('far', 3, 1, 1000); // its own tile, where nothing lies
    expect(w.drain()).toEqual([
      { to: 'far', msg: { t: 'refused', action: 'pick', reason: 'too_far' } },
      { to: 'corner', msg: { t: 'refused', action: 'pick', reason: 'too_far' } },
      { to: 'far', msg: { t: 'refused', action: 'pick', reason: 'gone' } },
    ]);
    expect(w.findViews('woods')).toHaveLength(1);
    w.pick('next', 5, 1, 1000);
    expect(answers(w.drain(), 'next').map(m => m.t)).toEqual(['got', 'bag']);
    w.pick('corner', 6, 1, 1100); // next to it, but nothing lies there
    w.pick('next', 5, 1, 1100); // taken a moment ago
    expect(w.drain()).toEqual([
      { to: 'corner', msg: { t: 'refused', action: 'pick', reason: 'gone' } },
      { to: 'next', msg: { t: 'refused', action: 'pick', reason: 'gone' } },
    ]);
  });

  it('refuses a find that does not fit in the bag, and it stays where it is', () => {
    const full = fullOfNails();
    const w = itemsWorld({ rng: () => 0.9 }, inWoods('a', 5, 1, 'up', { bag: full }));
    w.pick('a', 5, 1, 1000);
    expect(w.drain()).toEqual([{ to: 'a', msg: { t: 'refused', action: 'pick', reason: 'bag_full' } }]);
    expect(w.findViews('woods')).toHaveLength(1);
    expect(w.get('a')!.bag).toEqual(full);
    // Every slot taken, but one of them has room for one more moss.
    const w2 = itemsWorld({ rng: () => 0.9 }, inWoods('b', 5, 1, 'up', { bag: [...full.slice(1), { item: 'moss', count: 2 }] }));
    w2.pick('b', 5, 1, 1000);
    expect(w2.get('b')!.bag.at(-1)).toEqual({ item: 'moss', count: 3 });
    expect(w2.findViews('woods')).toEqual([]);
  });

  it('grows a picked find back after a random time within its respawn, on another tile that fits the rule, and tells that map', () => {
    // With the dice at 0.5, the moss lies at 4,1 and grows back 10 + 0.5 * (20 - 10) = 15 s after it is taken.
    const w = itemsWorld({ rng: () => 0.5 }, inWoods('a', 4, 1), inTown('t', 0, 5));
    expect(w.findViews('woods')).toEqual([{ id: 1, item: 'moss', x: 4, y: 1 }]);
    w.pick('a', 4, 1, 1000);
    w.drain();
    w.tick(16_000 - 1);
    expect(noEnergy(w.drain())).toEqual([]);
    expect(w.findViews('woods')).toEqual([]);
    w.tick(16_000);
    // Ids go on counting: the moss was 1, the nails 2 and 3.
    const grown = { id: 4, item: 'moss', x: 5, y: 1 };
    expect(noEnergy(w.drain())).toEqual([{ to: '*', map: 'woods', msg: { t: 'find', find: grown } }]);
    expect(w.findViews('woods')).toEqual([grown]);
  });

  it('moves a find on every time it is picked, never sooner than its shortest respawn nor later than its longest', () => {
    const w = itemsWorld({ rng: seeded(3) }, inWoods('a', 4, 1)); // next to the campfire: never runs out
    let now = 0;
    for (let i = 0; i < 20; i++) {
      const taken = w.findViews('woods')[0]!;
      w.pick('a', taken.x, taken.y, now);
      w.tick(now + 10_000 - 1);
      expect(w.findViews('woods')).toEqual([]);
      w.tick(now + 20_000);
      const grown = w.findViews('woods')[0]!;
      expect(MOSS_TILES).toContainEqual({ x: grown.x, y: grown.y });
      expect(grown.x).not.toBe(taken.x);
      now += 20_000;
    }
    // 20 moss: six full slots of 3 and one of 2.
    expect(w.get('a')!.bag).toEqual([...Array.from({ length: 6 }, () => ({ item: 'moss', count: 3 })), { item: 'moss', count: 2 }]);
  });

  it('never grows a find on a tile with a pile, and on the tile it was taken from only when no other is free', () => {
    const pile = (owner: string, x: number) => pileOf(owner, 'woods', x, 1, [{ item: 'nail', count: 1 }]);
    const w = itemsWorld({ drops: [pile('p', 3), pile('q', 5)] }, inWoods('a', 4, 1));
    expect(w.findViews('woods')).toMatchObject([{ x: 4, y: 1 }]);
    w.pick('a', 4, 1, 1000);
    w.tick(21_000);
    expect(w.findViews('woods')).toMatchObject([{ x: 4, y: 1 }]);
  });

  it('waits for room when every tile a find may grow on has a pile', () => {
    const pile = (owner: string, x: number) => pileOf(owner, 'woods', x, 1, [{ item: 'nail', count: 1 }]);
    const w = itemsWorld({ drops: [pile('p', 3), pile('a', 4), pile('q', 5)] }, inWoods('a', 4, 1));
    expect(w.findViews('woods')).toEqual([]);
    w.tick(1000); // still no room: it tries again after the shortest respawn
    w.pick('a', 4, 1, 2000); // 'a' takes their own pile back: 4,1 is free
    w.tick(11_000 - 1);
    expect(w.findViews('woods')).toEqual([]);
    w.tick(11_000);
    expect(w.findViews('woods')).toMatchObject([{ item: 'moss', x: 4, y: 1 }]);
  });
});

describe('World: the bag', () => {
  it('uses a consumable: its energy, up to a full bar, and one unit is gone; the player hears the energy, the bag, then what it did', () => {
    const w = itemsWorld({}, inTown('a', 0, 5, 'down', { energy: 50, bag: [{ item: 'tea', count: 2 }, { item: 'moss', count: 1 }] }));
    w.use('a', 0, 1000);
    expect(w.drain()).toEqual([
      { to: 'a', msg: { t: 'energy', energy: told(80, 0), body: expect.any(Object) } },
      { to: 'a', msg: { t: 'bag', bag: [{ item: 'tea', count: 1 }, { item: 'moss', count: 1 }] } },
      { to: 'a', msg: { t: 'did', did: { kind: 'used', item: 'tea', energy: 30 } } },
    ]);
    w.use('a', 0, 2000); // 80 + 30 is more than a full bar: it gives what the bar has room for
    expect(w.drain()).toEqual([
      { to: 'a', msg: { t: 'energy', energy: told(ENERGY_MAX, 0), body: expect.any(Object) } },
      { to: 'a', msg: { t: 'bag', bag: [{ item: 'moss', count: 1 }] } },
      { to: 'a', msg: { t: 'did', did: { kind: 'used', item: 'tea', energy: 20 } } },
    ]);
    expect(w.get('a')).toMatchObject({ energy: ENERGY_MAX, bag: [{ item: 'moss', count: 1 }] });
  });

  it('keeps the rate of the tile: in the wilds the bar drains on from its new value', () => {
    const w = itemsWorld({}, inWoods('a', 3, 6, 'up', { energy: 20, bag: [{ item: 'tea', count: 1 }] }));
    w.use('a', 0, 10_000);
    expect(w.drain()).toEqual([
      { to: 'a', msg: { t: 'energy', energy: told(20 + 10 * edge + 30, edge), body: expect.any(Object) } },
      { to: 'a', msg: { t: 'bag', bag: [] } },
      { to: 'a', msg: { t: 'did', did: { kind: 'used', item: 'tea', energy: 30 } } },
    ]);
    w.tick(11_000);
    expect(w.get('a')!.energy).toBeCloseTo(20 + 11 * edge + 30);
  });

  it('refuses to use what cannot be used, and an empty slot', () => {
    const w = itemsWorld({}, inTown('a', 0, 5, 'down', { energy: 50, bag: [{ item: 'moss', count: 1 }] }));
    w.use('a', 0, 1000);
    w.use('a', 1, 1000);
    expect(w.drain()).toEqual([
      { to: 'a', msg: { t: 'refused', action: 'use', reason: 'not_usable' } },
      { to: 'a', msg: { t: 'refused', action: 'use', reason: 'empty_slot' } },
    ]);
    expect(w.get('a')).toMatchObject({ energy: 50, bag: [{ item: 'moss', count: 1 }] });
  });

  it('throws a whole slot away, and refuses an empty one', () => {
    const w = itemsWorld({}, inTown('a', 0, 5, 'down', { bag: [{ item: 'moss', count: 3 }, { item: 'nail', count: 2 }, { item: 'tea', count: 1 }] }));
    w.discard('a', 1, 1000);
    w.discard('a', 5, 1000);
    expect(w.drain()).toEqual([
      { to: 'a', msg: { t: 'bag', bag: [{ item: 'moss', count: 3 }, { item: 'tea', count: 1 }] } },
      { to: 'a', msg: { t: 'did', did: { kind: 'thrown', item: 'nail', count: 2 } } },
      { to: 'a', msg: { t: 'refused', action: 'discard', reason: 'empty_slot' } },
    ]);
  });

  it('throws away as many of a slot as asked, never more than it holds; what came out of the stash is forgotten', () => {
    const w = itemsWorld({}, inTown('a', 0, 5, 'down', { bag: [{ item: 'moss', count: 3 }], stash: { items: {}, out: { moss: 2 } } }));
    w.discard('a', 0, 1000, 2);
    expect(w.drain()).toEqual([
      { to: 'a', msg: { t: 'bag', bag: [{ item: 'moss', count: 1 }] } },
      { to: 'a', msg: { t: 'did', did: { kind: 'thrown', item: 'moss', count: 2 } } },
    ]);
    expect(w.get('a')!.stash).toEqual({ items: {}, out: {} });
    w.discard('a', 0, 1000, 5);
    expect(w.drain().at(-1)).toEqual({ to: 'a', msg: { t: 'did', did: { kind: 'thrown', item: 'moss', count: 1 } } });
    expect(w.get('a')!.bag).toEqual([]);
  });

  it('fits a saved bag to today\'s items: what no longer exists goes, and a bag that no longer fits is packed again', () => {
    const w = itemsWorld();
    const odd = [{ item: 'gone', count: 2 }, { item: 'moss', count: 2 }, null, { item: 'nail', count: 0 }, { item: 'nail', count: 1.5 }, { item: 'tea' }];
    expect(w.join(inTown('a', 0, 5, 'down', { bag: odd as BagSlot[] }), 0).bag).toEqual([{ item: 'moss', count: 2 }]);
    // Moss stacks up to 3 now, so a saved 5 takes two slots.
    expect(w.join(inTown('b', 0, 5, 'down', { bag: [{ item: 'nail', count: 1 }, { item: 'moss', count: 5 }] }), 0).bag).toEqual([
      { item: 'nail', count: 1 }, { item: 'moss', count: 3 }, { item: 'moss', count: 2 },
    ]);
    const ten = Array.from({ length: 10 }, () => ({ item: 'nail', count: 5 }));
    expect(w.join(inTown('c', 0, 5, 'down', { bag: ten }), 0).bag).toEqual(fullOfNails());
    expect(w.get('c')!.bag).toEqual(fullOfNails());
  });

  it('lets nobody drink once their energy has run out: they collapse first, and the bag falls out', () => {
    const w = itemsWorld({}, inWoods('a', 3, 6, 'up', { energy: 0.5, bag: [{ item: 'tea', count: 1 }] }));
    w.use('a', 0, 5000);
    const out = answers(w.drain(), 'a');
    expect(out.map(m => m.t)).toEqual(['bag', 'stats', 'zone', 'energy', 'refused']);
    expect(out.at(-1)).toEqual({ t: 'refused', action: 'use', reason: 'empty_slot' });
    expect(w.dropViews('woods')).toMatchObject([{ id: 'a', x: 3, y: 6 }]);
  });
});

describe('World: piles', () => {
  it('turns the whole bag into a pile where the player fell: the map hears drop, the player an empty bag, storage both', () => {
    const bag = [{ item: 'moss', count: 2 }, { item: 'nail', count: 3 }, { item: 'moss', count: 1 }];
    const w = itemsWorld({}, inWoods('a', 3, 6, 'up', { energy: 1, bag }), inWoods('c', 5, 5));
    const at = 4200; // 1 energy lasts about 4.1 s at 3,6
    expect(-1000 / edge).toBeLessThan(at);
    w.tick(at);
    const drop = { id: 'a', x: 3, y: 6, owner: 'a', name: 'A', until: at + DROP_LIFETIME_MS, trail: [] };
    expect(noEnergy(w.drain())).toEqual([
      { to: '*', map: 'woods', msg: { t: 'drop', drop } },
      { to: 'a', msg: { t: 'bag', bag: [] } },
      { to: 'a', msg: { t: 'stats', stats: { collapsed: 1 } } },
      { to: '*', map: 'woods', except: 'a', msg: { t: 'leave', id: 'a' } },
      { to: '*', map: 'town', except: 'a', msg: { t: 'join', player: viewOf('a', 1, 2, 'down') } },
      {
        to: 'a',
        msg: { t: 'zone', map: { id: 'town', version: 1 }, x: 1, y: 2, dir: 'down', players: [viewOf('a', 1, 2, 'down')], finds: w.findViews('town'), drops: [], ...SCENE, reason: 'collapse' },
      },
    ]);
    expect(w.dropViews('woods')).toEqual([drop]);
    expect(w.get('a')).toMatchObject({ map: 'town', bag: [], energy: ENERGY_MAX });
    // The pile (equal items joined) and the emptied bag go to storage together.
    const writes = w.takeWrites();
    expect(writes.drops).toEqual([
      { owner: 'a', drop: { owner: 'a', name: 'A', map: 'woods', x: 3, y: 6, items: [{ item: 'moss', count: 3 }, { item: 'nail', count: 3 }], droppedAt: at, trail: [] } },
    ]);
    expect(writes.players).toEqual([w.get('a')]);
  });

  it('drops the bag of a player whose energy runs out as they leave, and saves the empty bag', () => {
    const w = itemsWorld({}, inWoods('a', 3, 6, 'up', { energy: 0.05, bag: [{ item: 'moss', count: 1 }] }));
    const saved = w.leave('a', 1000)!;
    expect(saved).toMatchObject({ map: 'town', bag: [] });
    expect(w.dropViews('woods')).toEqual([{ id: 'a', x: 3, y: 6, owner: 'a', name: 'A', until: 1000 + DROP_LIFETIME_MS, trail: [] }]);
    const writes = w.takeWrites();
    expect(writes.drops).toMatchObject([{ owner: 'a', drop: { items: [{ item: 'moss', count: 1 }] } }]);
    expect(writes.players).toEqual([saved]);
  });

  it('gives the owner all of it back: got and bag for them, and the pile is gone for everyone on the map', () => {
    const items = [{ item: 'moss', count: 3 }, { item: 'nail', count: 3 }, { item: 'tea', count: 1 }];
    const w = itemsWorld({ drops: [pileOf('a', 'woods', 4, 5, items)] }, inWoods('a', 4, 6), inWoods('c', 1, 1));
    w.pick('a', 4, 5, 1000);
    expect(w.drain()).toEqual([
      { to: 'a', msg: { t: 'got', items, from: 'drop' } },
      { to: 'a', msg: { t: 'bag', bag: items } },
      { to: '*', map: 'woods', msg: { t: 'dropGone', id: 'a' } },
    ]);
    expect(w.dropViews('woods')).toEqual([]);
    expect(w.takeWrites()).toEqual({ drops: [{ owner: 'a', drop: undefined }], players: [w.get('a')], marks: [], thanks: [], credits: [], caches: [] });
  });

  it('leaves in the pile what does not fit in the owner\'s bag (the map hears it again), and refuses when nothing fits', () => {
    const nails = fullOfNails().slice(2);
    const pile = pileOf('a', 'woods', 4, 5, [{ item: 'moss', count: 3 }, { item: 'nail', count: 5 }, { item: 'tea', count: 2 }]);
    const w = itemsWorld({ drops: [pile] }, inWoods('a', 4, 5, 'up', { bag: [...nails, { item: 'moss', count: 2 }] }));
    w.pick('a', 4, 5, 1000);
    // One moss tops up the moss slot and two go in the last free slot; the nails and the tea do not fit.
    expect(w.drain()).toEqual([
      { to: 'a', msg: { t: 'got', items: [{ item: 'moss', count: 3 }], from: 'drop' } },
      { to: 'a', msg: { t: 'bag', bag: [...nails, { item: 'moss', count: 3 }, { item: 'moss', count: 2 }] } },
      { to: '*', map: 'woods', msg: { t: 'drop', drop: dropOf(pile) } },
    ]);
    expect(w.takeWrites().drops).toEqual([{ owner: 'a', drop: { ...pile, items: [{ item: 'nail', count: 5 }, { item: 'tea', count: 2 }] } }]);
    w.pick('a', 4, 5, 2000);
    expect(w.drain()).toEqual([{ to: 'a', msg: { t: 'refused', action: 'pick', reason: 'bag_full' } }]);
    expect(w.dropViews('woods')).toEqual([dropOf(pile)]);
    expect(w.takeWrites()).toEqual({ drops: [], players: [], marks: [], thanks: [], credits: [], caches: [] });
    // With two slots free, the rest comes back and the pile is gone.
    w.discard('a', 0, 3000);
    w.discard('a', 0, 3000);
    w.drain();
    w.pick('a', 4, 5, 4000);
    expect(answers(w.drain(), 'a')[0]).toEqual({ t: 'got', items: [{ item: 'nail', count: 5 }, { item: 'tea', count: 2 }], from: 'drop' });
    expect(w.dropViews('woods')).toEqual([]);
  });

  it('gives anyone else a random half; the rest is lost and the pile is gone for everyone', () => {
    const pile = pileOf('a', 'woods', 4, 5, [{ item: 'moss', count: 3 }, { item: 'nail', count: 5 }, { item: 'tea', count: 2 }]);
    const w = itemsWorld({ drops: [pile] }, inWoods('b', 4, 5), inWoods('a', 4, 6));
    w.pick('b', 4, 5, 1000);
    const out = w.drain();
    const got = out[0]!.msg as Extract<ServerMsg, { t: 'got' }>;
    expect(got).toMatchObject({ t: 'got', from: 'drop' });
    expect(units(got.items)).toBe(5);
    for (const s of got.items) expect(s.count).toBeLessThanOrEqual(pile.items.find(p => p.item === s.item)!.count);
    expect(out).toEqual([
      { to: 'b', msg: got },
      { to: 'b', msg: { t: 'bag', bag: got.items } },
      { to: '*', map: 'woods', msg: { t: 'dropGone', id: 'a' } },
    ]);
    expect(w.takeWrites()).toEqual({ drops: [{ owner: 'a', drop: undefined }], players: [w.get('b')], marks: [], thanks: [], credits: [], caches: [] });
    // The owner comes too late.
    w.pick('a', 4, 5, 2000);
    expect(w.drain()).toEqual([{ to: 'a', msg: { t: 'refused', action: 'pick', reason: 'gone' } }]);
  });

  it('gives someone else only what fits of their half, and leaves the pile alone when nothing of it would fit', () => {
    const pile = pileOf('a', 'woods', 4, 5, [{ item: 'moss', count: 2 }, { item: 'tea', count: 2 }]);
    const w = itemsWorld({ drops: [pile] }, inWoods('b', 4, 5, 'up', { bag: fullOfNails() }));
    w.pick('b', 4, 5, 1000);
    expect(w.drain()).toEqual([{ to: 'b', msg: { t: 'refused', action: 'pick', reason: 'bag_full' } }]);
    expect(w.dropViews('woods')).toEqual([dropOf(pile)]);
    // One slot free: the first item of the half goes in it; whatever else there was is lost with the pile.
    w.discard('b', 0, 2000);
    w.drain();
    w.pick('b', 4, 5, 3000);
    const out = w.drain();
    const got = out[0]!.msg as Extract<ServerMsg, { t: 'got' }>;
    expect(got.items).toHaveLength(1);
    expect(units(got.items)).toBeGreaterThanOrEqual(1);
    expect(units(got.items)).toBeLessThanOrEqual(2);
    expect(w.get('b')!.bag).toEqual([...fullOfNails().slice(1), ...got.items]);
    expect(heardOn(out, 'woods')).toEqual([{ t: 'dropGone', id: 'a' }]);
  });

  it('picks a pile before a find on the same tile, and the picker\'s own pile before someone else\'s', () => {
    // With the dice at 0.9, the nails lie at 2,2 and 1,2 (the spawn).
    const w = itemsWorld({ rng: () => 0.9 });
    expect(w.findViews('town')).toEqual([{ id: 2, item: 'nail', x: 2, y: 2 }, { id: 3, item: 'nail', x: 1, y: 2 }]);
    // Empty in town, where energy holds: they fall at the next tick, on the nail at 2,2.
    w.join(inTown('a', 2, 2, 'down', { energy: 0, bag: [{ item: 'moss', count: 2 }] }), 0);
    w.join(inTown('b', 2, 2, 'down', { energy: 0, bag: [{ item: 'tea', count: 1 }] }), 0);
    w.tick(1);
    expect(w.dropViews('town')).toMatchObject([{ id: 'a', x: 2, y: 2 }, { id: 'b', x: 2, y: 2 }]);
    w.drain();
    w.pick('b', 2, 2, 2); // from the spawn, next to it
    expect(answers(w.drain(), 'b')[0]).toEqual({ t: 'got', items: [{ item: 'tea', count: 1 }], from: 'drop' });
    w.join(inTown('c', 2, 3), 2);
    w.drain();
    w.pick('c', 2, 2, 3);
    expect(heardOn(w.drain(), 'town')).toEqual([{ t: 'dropGone', id: 'a' }]);
    w.pick('c', 2, 2, 4);
    const out = w.drain();
    expect(answers(out, 'c')[0]).toEqual({ t: 'got', items: [{ item: 'nail', count: 1 }], from: 'find' });
    expect(heardOn(out, 'town')).toEqual([{ t: 'findGone', id: 2 }]);
  });

  it('replaces the old pile when its owner collapses again, and only takes it away when the bag was empty', () => {
    const first = pileOf('a', 'woods', 5, 5, [{ item: 'moss', count: 1 }]);
    const w = itemsWorld({ drops: [first] }, inWoods('a', 3, 6, 'up', { energy: 1, bag: [{ item: 'nail', count: 2 }] }));
    w.tick(4200);
    const second = { id: 'a', x: 3, y: 6, owner: 'a', name: 'A', until: 4200 + DROP_LIFETIME_MS, trail: [] };
    expect(heardOn(w.drain(), 'woods').filter(m => m.t === 'drop' || m.t === 'dropGone')).toEqual([
      { t: 'dropGone', id: 'a' },
      { t: 'drop', drop: second },
    ]);
    expect(w.dropViews('woods')).toEqual([second]);
    // Storage only needs the pile as it is now.
    expect(w.takeWrites().drops).toEqual([{ owner: 'a', drop: pileOf('a', 'woods', 3, 6, [{ item: 'nail', count: 2 }], 4200) }]);

    // Out again with nothing in the bag: the pile goes, and no new one comes.
    const back = w.leave('a', 5000)!;
    w.join({ ...back, map: 'woods', x: 2, y: 6, energy: 0.5 }, 5000);
    w.drain();
    w.tick(8000);
    expect(heardOn(w.drain(), 'woods').filter(m => m.t === 'drop' || m.t === 'dropGone')).toEqual([{ t: 'dropGone', id: 'a' }]);
    expect(w.dropViews('woods')).toEqual([]);
    expect(w.takeWrites().drops).toEqual([{ owner: 'a', drop: undefined }]);
  });

  it('fades an hour after the collapse, by the wall clock', () => {
    // Game time runs this far behind the wall clock here.
    const offset = 5_000_000;
    const old = pileOf('b', 'woods', 5, 5, [{ item: 'moss', count: 1 }], offset + 1000);
    const w = itemsWorld({ drops: [old], epochOffset: offset }, inWoods('a', 3, 6, 'up', { energy: 1, bag: [{ item: 'nail', count: 1 }] }));
    w.tick(4200); // 'a' falls: an hour from now on the wall clock, their pile fades
    expect(w.dropViews('woods')).toEqual([dropOf(old), { id: 'a', x: 3, y: 6, owner: 'a', name: 'A', until: offset + 4200 + DROP_LIFETIME_MS, trail: [] }]);
    w.drain();
    w.takeWrites();
    w.tick(1000 + DROP_LIFETIME_MS - 1);
    expect(heardOn(w.drain(), 'woods')).toEqual([]);
    w.tick(1000 + DROP_LIFETIME_MS);
    expect(heardOn(w.drain(), 'woods')).toEqual([{ t: 'dropGone', id: 'b' }]);
    expect(w.takeWrites().drops).toEqual([{ owner: 'b', drop: undefined }]);
    w.tick(4200 + DROP_LIFETIME_MS);
    expect(heardOn(w.drain(), 'woods')).toEqual([{ t: 'dropGone', id: 'a' }]);
    expect(w.dropViews('woods')).toEqual([]);
  });

  it('shows the piles of a map in the welcome and in zone, and none of the other maps', () => {
    const inWoodsPile = pileOf('p', 'woods', 4, 5, [{ item: 'moss', count: 1 }]);
    const inTownPile = pileOf('q', 'town', 0, 5, [{ item: 'nail', count: 1 }]);
    const w = itemsWorld({ drops: [inWoodsPile, inTownPile] });
    expect(w.join(inTown('a', 4, 1, 'up'), 0).drops).toEqual([dropOf(inTownPile)]);
    w.step('a', 'up', 1, 1000);
    expect(answers(w.drain(), 'a').find(m => m.t === 'zone')).toMatchObject({ map: { id: 'woods' }, drops: [dropOf(inWoodsPile)] });
  });

  it('restores saved piles without the items that no longer exist, and none on maps that are gone', () => {
    const w = itemsWorld({
      drops: [
        pileOf('p', 'gone', 1, 1, [{ item: 'moss', count: 1 }]),
        pileOf('q', 'woods', 4, 5, [{ item: 'old', count: 3 }]),
        pileOf('r', 'woods', 5, 5, [{ item: 'old', count: 1 }, { item: 'moss', count: 2 }]),
        pileOf('s', 'woods', 50, 50, [{ item: 'moss', count: 1 }]),
      ],
    });
    expect(w.dropViews('woods')).toEqual([dropOf(pileOf('r', 'woods', 5, 5, []))]);
    expect(w.dropViews('gone')).toEqual([]);
    w.join(inWoods('r', 5, 5), 0);
    w.drain();
    w.pick('r', 5, 5, 1000);
    expect(answers(w.drain(), 'r')[0]).toEqual({ t: 'got', items: [{ item: 'moss', count: 2 }], from: 'drop' });
  });
});

describe('World: a restart', () => {
  it('keeps bags with the players and piles in storage: a new World gets them back', () => {
    const w = itemsWorld({ rng: () => 0.9 }, inWoods('a', 3, 6, 'up', { energy: 1, bag: [{ item: 'nail', count: 4 }] }), inWoods('b', 5, 1));
    w.pick('b', 5, 1, 1000); // the moss
    w.tick(4200); // 'a' falls
    const piles = w.takeWrites().drops.map(d => d.drop!);
    const b = w.leave('b', 5000)!;
    const a = w.leave('a', 5000)!;
    expect([a.bag, b.bag]).toEqual([[], [{ item: 'moss', count: 1 }]]);

    const again = new World(fixtureMaps(), 'town', 'overcast', { items: itemsData(), drops: piles });
    expect(again.dropViews('woods')).toEqual(w.dropViews('woods'));
    expect(again.join(b, 6000).bag).toEqual([{ item: 'moss', count: 1 }]);
    // The owner still gets all of it back.
    again.join({ ...a, map: 'woods', x: 3, y: 5 }, 6000);
    again.drain();
    again.pick('a', 3, 6, 7000);
    expect(answers(again.drain(), 'a')[0]).toEqual({ t: 'got', items: [{ item: 'nail', count: 4 }], from: 'drop' });
  });
});

describe('jacket colors', () => {
  it('are picked from the palette, the same for the same id', () => {
    const ids = Array.from({ length: 300 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    for (const id of ids) {
      expect(JACKET_COLORS).toContain(colorFor(id));
      expect(colorFor(id)).toBe(colorFor(id));
    }
    expect(new Set(ids.map(colorFor)).size).toBe(JACKET_COLORS.length);
    expect(JACKET_COLORS.length).toBeGreaterThanOrEqual(8);
    for (const c of JACKET_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});
