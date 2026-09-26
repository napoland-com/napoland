import { describe, expect, it } from 'vitest';
import {
  ENERGY_MAX, ENERGY_SYNC_MS, REFILL_PER_SECOND, STEP_MS, TileMap, energyRate, type Dir, type EnergyView, type MapData, type Weather,
} from '@napoland/shared';
import type { PlayerRecord } from '../src/storage';
import { JACKET_COLORS, STEP_QUEUE_MAX, STEP_TOLERANCE_MS, World, colorFor, type Outgoing } from '../src/world';
import { fixtureMaps, woodsData } from './fixtures';

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
    id, name: id.toUpperCase(), tokenHash: `hash-${id}`, map: 'test', x, y, dir, color: colorFor(id), energy: ENERGY_MAX,
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

/** The town and the woods of fixtures.ts (home: the town), players joined at time 0, joins drained. */
function woodsWorld(weather: Weather, ...players: PlayerRecord[]): World {
  const w = new World(fixtureMaps(), 'town', weather);
  for (const p of players) w.join(p, 0);
  w.drain();
  return w;
}
const woods = new TileMap(woodsData());
/** Energy per second at 3,6 in the woods, where the road from town arrives: dark, one step from home. */
const dark = energyRate(woods, 3, 6, 'overcast');
const inTown = (id: string, x: number, y: number, dir: Dir = 'down', more: Partial<PlayerRecord> = {}) => rec(id, x, y, dir, { map: 'town', ...more });
const inWoods = (id: string, x: number, y: number, dir: Dir = 'up', more: Partial<PlayerRecord> = {}) => rec(id, x, y, dir, { map: 'woods', ...more });
const viewOf = (id: string, x: number, y: number, dir: Dir) => ({ id, name: id.toUpperCase(), x, y, dir, color: colorFor(id) });
/** The energy a player is told: value to 1 decimal, rate to 3. */
const told = (value: number, rate: number): EnergyView => ({ value: Math.round(value * 10) / 10, max: ENERGY_MAX, rate: Math.round(rate * 1000) / 1000 });

/** The step or reject answers `id` got, in order. */
const answers = (out: Outgoing[], id: string) => out.filter(o => o.to === id).map(o => o.msg);
/** The energy messages in `out`, as [to, energy]. */
const energies = (out: Outgoing[]) => out.flatMap(o => (o.msg.t === 'energy' ? [[o.to, o.msg.energy] as const] : []));

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
      player: { id: 'a', name: 'A', x: 3, y: 3, dir: 'down', color: colorFor('a') },
      map: { id: 'test', version: 1 },
      players: [joined.player],
      energy: { value: ENERGY_MAX, max: ENERGY_MAX, rate: REFILL_PER_SECOND },
    });
    expect(w.drain()).toEqual([
      { to: '*', map: 'test', except: 'a', msg: { t: 'join', player: joined.player } },
      { to: 'a', msg: { t: 'energy', energy: joined.energy } },
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
        msg: { t: 'zone', map: { id: 'woods', version: 1 }, x: 3, y: 6, dir: 'up', players: [viewOf('c', 5, 5, 'up'), viewOf('a', 3, 6, 'up')], reason: 'exit' },
      },
      { to: 'a', msg: { t: 'energy', energy: told(ENERGY_MAX, energyRate(woods, 3, 6, 'overcast')) } },
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
    expect(back[1]).toEqual({ t: 'zone', map: { id: 'town', version: 1 }, x: 5, y: 1, dir: 'down', players: [viewOf('a', 5, 1, 'down')], reason: 'exit' });
    expect(back[2]).toEqual({ t: 'energy', energy: told(ENERGY_MAX, REFILL_PER_SECOND) });
    expect(w.get('a')).toMatchObject({ map: 'town', x: 5, y: 1, dir: 'down' });
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
      { to: 'w2', msg: { t: 'energy', energy: joined.energy } },
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
  it('drains in the wilds and refills in town and under street lights', () => {
    expect(dark).toBeLessThan(0);
    const w = woodsWorld('overcast', inWoods('a', 3, 6, 'up', { energy: 50 }), inTown('t', 1, 2, 'down', { energy: 50 }));
    expect(w.join(inWoods('b', 3, 6, 'up', { energy: 50 }), 0).energy).toEqual(told(50, dark));
    w.tick(10_000);
    expect(w.get('a')!.energy).toBeCloseTo(50 + 10 * dark);
    expect(w.get('t')!.energy).toBe(ENERGY_MAX); // 8 a second: full after 6.25 s
    w.step('a', 'left', 1, 10_000); // into the lamp's light
    w.tick(11_000);
    expect(w.get('a')!.energy).toBeCloseTo(50 + 10 * dark + REFILL_PER_SECOND);
    w.tick(30_000);
    expect(w.get('a')!.energy).toBe(ENERGY_MAX);
  });

  it('tells the player at once when the rate turns between draining and refilling', () => {
    const w = woodsWorld('overcast', inWoods('a', 3, 6, 'up', { energy: 50 }));
    w.step('a', 'left', 1, 1000); // into the light
    expect(energies(w.drain())).toEqual([['a', told(50 + dark, REFILL_PER_SECOND)]]);
    w.step('a', 'right', 2, 1200); // back into the dark
    expect(energies(w.drain())).toEqual([['a', told(50 + dark + 0.2 * REFILL_PER_SECOND, dark)]]);
  });

  it('tells the player when the rate moved more than 10% since they last heard it, not at every step', () => {
    const w = woodsWorld('overcast', inWoods('a', 3, 6, 'up', { energy: 50 }));
    // Up the dark right side, one step farther from home each time (see fixtures.ts).
    const walk: Dir[] = ['right', 'right', 'right', 'up', 'up', 'up', 'up', 'up'];
    const heard: number[] = [];
    walk.forEach((dir, i) => {
      w.step('a', dir, i + 1, (i + 1) * STEP_MS);
      if (energies(w.drain()).length) heard.push(i + 1);
    });
    expect(w.get('a')).toMatchObject({ x: 6, y: 1 });
    // 8 steps from home instead of 1: 11.5% more drain; after 7 steps it was 9.8%.
    expect(heard).toEqual([8]);
    expect(energyRate(woods, 6, 1, 'overcast') / dark).toBeGreaterThan(1.1);
    expect(energyRate(woods, 6, 2, 'overcast') / dark).toBeLessThan(1.1);
  });

  it('repeats the energy every ENERGY_SYNC_MS while it changes, but not while full and refilling', () => {
    // 'low' needs 2.5 s to fill up.
    const w = woodsWorld('overcast', inWoods('a', 3, 6, 'up', { energy: 50 }), inTown('full', 1, 2), inTown('low', 2, 2, 'down', { energy: 80 }));
    w.tick(ENERGY_SYNC_MS - 1);
    expect(energies(w.drain())).toEqual([]);
    w.tick(ENERGY_SYNC_MS);
    const s = ENERGY_SYNC_MS / 1000;
    expect(energies(w.drain())).toEqual([
      ['a', told(50 + s * dark, dark)],
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
      { to: 'a', msg: { t: 'energy', energy: told(50 + dark, energyRate(woods, 3, 6, 'night')) } },
    ]);
    w.tick(2000);
    expect(w.get('a')!.energy).toBeCloseTo(50 + dark + energyRate(woods, 3, 6, 'night'));
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
    const empty = 1000 * (1 / -dark);
    w.tick(empty - 50);
    w.drain();
    expect(w.get('a')).toMatchObject({ map: 'woods', x: 3, y: 6 });
    expect(collapses).toEqual([]);
    w.tick(empty + 1);
    expect(w.drain()).toEqual([
      { to: '*', map: 'woods', except: 'a', msg: { t: 'leave', id: 'a' } },
      { to: '*', map: 'town', except: 'a', msg: { t: 'join', player: viewOf('a', 1, 2, 'down') } },
      {
        to: 'a',
        msg: { t: 'zone', map: { id: 'town', version: 1 }, x: 1, y: 2, dir: 'down', players: [viewOf('t', 0, 5, 'down'), viewOf('a', 1, 2, 'down')], reason: 'collapse' },
      },
      { to: 'a', msg: { t: 'energy', energy: told(ENERGY_MAX, REFILL_PER_SECOND) } },
    ]);
    expect(w.get('a')).toMatchObject({ map: 'town', x: 1, y: 2, dir: 'down', energy: ENERGY_MAX });
    expect(collapses).toEqual([['a', { map: 'woods', x: 3, y: 6 }]]);
  });

  it('collapses instead of taking a step when the energy ran out before it', () => {
    const { w, collapses } = collapsing(inWoods('a', 3, 6, 'up', { energy: 0.1 }));
    w.step('a', 'up', 1, 1000);
    expect(answers(w.drain(), 'a').map(m => m.t)).toEqual(['zone', 'energy']);
    expect(w.get('a')).toMatchObject({ map: 'town', x: 1, y: 2, energy: ENERGY_MAX });
    expect(collapses.map(([id]) => id)).toEqual(['a']);
  });

  it('keeps the step timer through a collapse', () => {
    const { w } = collapsing(inWoods('a', 4, 5, 'up', { energy: 0.13 }));
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
    expect(w.leave('a', 1000)).toMatchObject({ map: 'town', x: 1, y: 2, dir: 'down', energy: ENERGY_MAX });
    expect(w.drain()).toEqual([{ to: '*', map: 'woods', except: 'a', msg: { t: 'leave', id: 'a' } }]);
    expect(collapses).toEqual([['a', { map: 'woods', x: 3, y: 6 }]]);
    expect(w.views('town')).toEqual([]);
  });

  it('keeps the energy a player has when they leave in the wilds, and nothing drains while they are away', () => {
    const { w, collapses } = collapsing(inWoods('a', 3, 6, 'up', { energy: 50 }));
    const saved = w.leave('a', 10_000)!;
    expect(saved).toMatchObject({ map: 'woods', x: 3, y: 6 });
    expect(saved.energy).toBeCloseTo(50 + 10 * dark);
    expect(w.join(saved, 60_000).energy).toEqual(told(saved.energy, dark));
    w.tick(60_000);
    expect(w.get('a')!.energy).toBe(saved.energy);
    expect(collapses).toEqual([]);
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
