/**
 * How the trip went (world.ts, endTrip): a trip starts at the first step out into the wilds and ends at
 * home, walked into or woken up in; its owner alone hears how it went, after the zone that brings them
 * home, and their bests are kept. World rules, then once over real WebSockets.
 */
import { describe, expect, it } from 'vitest';
import { FLASH_BURST_S, FLASH_GLOW_S, TileMap, stormAt, type Dir, type ItemsData, type MapData, type ServerMsg, type StormRule, type SurgeRule } from '@napoland/shared';
import { MemoryStorage, type PlayerRecord } from '../src/storage';
import { TRIP_MIN_MS, World, colorFor, type Outgoing } from '../src/world';
import { houseData, townData } from './fixtures';
import { keepsBests, setup } from './helpers';

/**
 * Open grass in the wilds, walled in by forest, with the way home in the middle of its bottom row (4,11)
 * onto the town's 4,1. Steps from home: |x - 4| + (11 - y).
 */
function fieldData(more: Partial<MapData> = {}): MapData {
  const tiles = Array.from({ length: 12 }, (_, y) => (y === 0 ? 'tttttttttt' : y === 11 ? 'ttttgttttt' : 'tggggggggt'));
  return {
    id: 'field', name: 'The Field', version: 1, kind: 'wilds', depth: 1, width: 10, height: 12,
    tiles, levels: Array<string>(12).fill('0000000000'),
    spawn: { x: 4, y: 10, dir: 'up' },
    exits: [{ x: 4, y: 11, w: 1, h: 1, to: 'town', tx: 4, ty: 1, dir: 'down', home: true }],
    objects: [],
    ...more,
  };
}

/** The fixture town, whose road north (4,0) leads into the field at 4,10. */
function town(): TileMap {
  const t = townData();
  return new TileMap({ ...t, exits: t.exits.map(e => (e.to === 'woods' ? { ...e, to: 'field', tx: 4, ty: 10, w: 1 } : e)) });
}
/** Home: the fixture house with a chest (its door at the town's 7,2, its way out at 2,4 onto the town's 7,3). */
const house = () => new TileMap({ ...houseData(), objects: [...houseData().objects, { kind: 'chest', x: 3, y: 1 }] });
const maps = (field: MapData) => [town(), house(), new TileMap(field)];

const ITEMS: ItemsData = {
  version: 1,
  items: [{ id: 'moss', name: 'Moss', kind: 'resource', stack: 10, text: 'Soft.', xp: 2 }],
  finds: [],
};

const rec = (id: string, x: number, y: number, more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map: 'field', x, y, dir: 'up', color: colorFor(id), energy: 100, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});

function world(field: MapData, ...players: PlayerRecord[]): World {
  const w = new World(maps(field), 'town', 'overcast', { items: ITEMS, rng: () => 0 });
  for (const p of players) w.join(p, 0);
  w.drain();
  w.takeWrites();
  return w;
}

const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id ? [o.msg] : []));
const of = <T extends ServerMsg['t']>(msgs: ServerMsg[], t: T) => msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);

/** From the field's 4,10: up 5 to 4,5 (6 steps from home). */
const OUT: Dir[] = ['up', 'up', 'up', 'up', 'up'];
/** From 4,5 down 6, the last onto the way home; then from the town's 4,1 down, right and up into the house. */
const HOME: Dir[] = ['down', 'down', 'down', 'down', 'down', 'down', 'down', 'down', 'right', 'right', 'right', 'up'];
/** From the house's 2,3 out onto the town's 7,3, left and up the road into the field at 4,10. */
const OUT_OF_HOUSE: Dir[] = ['down', 'left', 'left', 'left', 'up', 'up', 'up'];

/** Walks `a` along `dirs` from `t`, a step every 300 ms, ticking; returns everything heard, and the time after. */
function walk(w: World, dirs: Dir[], t: number): { out: Outgoing[]; t: number } {
  const out: Outgoing[] = [];
  for (const dir of dirs) {
    w.step('a', dir, 0, t);
    w.tick(t);
    out.push(...w.drain());
    t += 300;
  }
  return { out, t };
}

/** Stands still from `from` to `to`, ticking every `every` ms; returns everything heard. */
function wait(w: World, from: number, to: number, every = 1000): Outgoing[] {
  const out: Outgoing[] = [];
  for (let t = from; t <= to; t += every) {
    w.tick(t);
    out.push(...w.drain());
  }
  return out;
}

/** Out to 4,5, a wait of `ms` there, and home: how the trip went, as told, and the time after. */
function trip(w: World, t: number, ms: number) {
  ({ t } = walk(w, OUT, t));
  wait(w, t, t + ms);
  const back = walk(w, HOME, t + ms + 1000);
  return { told: of(to(back.out, 'a'), 'trip').map(m => m.trip), out: back.out, t: back.t };
}

describe('how the trip went', () => {
  it('is told once, at home, after the zone that brings you there: the steps, how far out, what the bag is worth', () => {
    const w = world(fieldData(), rec('a', 4, 10, { bag: [{ item: 'moss', count: 3 }] }));
    const { told, out } = trip(w, 1000, TRIP_MIN_MS);
    expect(told).toHaveLength(1);
    // After the zone that brings them home, and to them alone.
    const heard = to(out, 'a'), home = heard.findIndex(m => m.t === 'zone' && m.map.id === 'house');
    expect(home).toBeGreaterThanOrEqual(0);
    expect(heard.findIndex(m => m.t === 'trip')).toBeGreaterThan(home);
    expect(out.filter(o => o.msg.t === 'trip' && o.to !== 'a')).toEqual([]);
    // 5 up and 6 down, the last onto the way home: 11 steps out there. Three moss, 2 XP each.
    expect(told[0]).toMatchObject({ steps: 11, deepest: { map: 'field', steps: 6 }, xp: 6, fell: null, best: [], caught: { storms: 0, flashes: 0, surges: 0 } });
    expect(told[0]!.minutes).toBe(1);
    expect(told[0]!.lowest).toBeLessThan(100);
    expect(told[0]!.lowest).toBeGreaterThan(0);
    // The first trip sets the bests quietly: there was none to beat. They are saved at once.
    expect(w.get('a')!.bests).toEqual({ deepest: { map: 'field', depth: 1, steps: 6 }, longestS: expect.any(Number), xp: 6 });
    expect(w.takeWrites().players.map(p => p.id)).toContain('a');
  });

  it('is not told for stepping out of the door and back', () => {
    const w = world(fieldData(), rec('a', 4, 10));
    const { out } = walk(w, ['up', ...HOME.slice(4)], 1000);
    expect(to(out, 'a').some(m => m.t === 'zone' && m.map.id === 'house')).toBe(true);
    expect(of(to(out, 'a'), 'trip')).toEqual([]);
    expect(w.get('a')!.bests).toBeUndefined();
  });

  it('says the bests a trip beat: a longer one is the longest yet, and the next shorter one beats nothing', () => {
    const w = world(fieldData(), rec('a', 4, 10));
    const first = trip(w, 1000, 40_000);
    expect(first.told.map(t => t.best)).toEqual([[]]);
    const longer = trip(w, walk(w, OUT_OF_HOUSE, first.t).t, 90_000);
    expect(longer.told.map(t => t.best)).toEqual([['longest']]);
    const shorter = trip(w, walk(w, OUT_OF_HOUSE, longer.t).t, 40_000);
    expect(shorter.told.map(t => t.best)).toEqual([[]]);
    expect(w.get('a')!.bests!.longestS).toBeGreaterThanOrEqual(90);
  });

  it('after a collapse, comes when you wake up: where you fell, and nothing brought home', () => {
    const w = world(fieldData(), rec('a', 4, 10, { energy: 3, bag: [{ item: 'moss', count: 3 }] }));
    const { t } = walk(w, OUT, 1000);
    const heard = to(wait(w, t, t + 10 * 60_000), 'a');
    const trips = of(heard, 'trip');
    expect(trips).toHaveLength(1);
    expect(heard.findIndex(m => m.t === 'trip')).toBeGreaterThan(heard.findIndex(m => m.t === 'zone'));
    expect(trips[0]!.trip).toMatchObject({ steps: 5, xp: 0, lowest: 0, fell: { map: 'field', x: 4, y: 5 }, deepest: { map: 'field', steps: 6 } });
  });

  it('counts each storm you are out in once', () => {
    const storm: StormRule = { every: 100, warn: 10, length: 20 };
    // By a tended fire: out in the storms for minutes, and nobody collapses.
    const w = world(fieldData({ storm, objects: [{ kind: 'fireplace', x: 5, y: 5, tended: true }] }), rec('a', 4, 10));
    const { told, t } = trip(w, 1000, 250_000);
    // As many storms as blew while they stood out there, by the storm's own clock (the World's runs from 0).
    let storms = 0, was = false;
    for (let s = 2500; s <= t; s += 500) {
      const now = stormAt(storm, s).phase === 'storm';
      if (now && !was) storms++;
      was = now;
    }
    expect(storms).toBeGreaterThanOrEqual(2);
    expect(told[0]!.caught.storms).toBe(storms);
  });

  it('counts each surge that caught you once', () => {
    const surge: SurgeRule = { every: 100, unstable: 20, surge: 20, sweep: 10 };
    // A tended fire next to them: the surges drain, the fire gives back, and nobody collapses.
    const w = world(fieldData({ surge, objects: [{ kind: 'fireplace', x: 5, y: 5, tended: true }] }), rec('a', 4, 10));
    const { told } = trip(w, 1000, 200_000);
    expect(told[0]!.caught.surges).toBe(2);
  });

  it('counts each flash that discharged on you once', () => {
    // A flash every 30 s near someone 3 or more steps from home.
    const w = world(fieldData({ flashes: { every: 30, steps: [3, 99] } }), rec('a', 4, 10));
    // The flashes' clock starts at the first tick.
    w.tick(0);
    let { t } = walk(w, OUT, 1000);
    wait(w, t, 30_000);
    w.tick(30_000);
    w.drain();
    const flash = w.scene('field', 30_000).flashes[0];
    expect(flash).toBeDefined();
    // Onto it while it glows, then through its whole burst, ticked often: one flash.
    const me = () => w.get('a')!;
    const toward = (x: number, y: number): Dir | undefined =>
      me().x < x ? 'right' : me().x > x ? 'left' : me().y < y ? 'down' : me().y > y ? 'up' : undefined;
    t = 30_100;
    for (let dir = toward(flash!.x, flash!.y); dir; dir = toward(flash!.x, flash!.y)) ({ t } = walk(w, [dir], t));
    expect(t).toBeLessThan(30_000 + FLASH_GLOW_S * 1000);
    wait(w, t, 30_000 + (FLASH_GLOW_S + FLASH_BURST_S) * 1000 + 500, 100);
    // Home before the next one: back to 4,10, and on down.
    t = 43_000;
    for (let dir = toward(4, 10); dir; dir = toward(4, 10)) ({ t } = walk(w, [dir], t));
    const back = walk(w, HOME.slice(5), t);
    expect(of(to(back.out, 'a'), 'trip')[0]!.trip.caught.flashes).toBe(1);
  });
});

describe('the best trips in storage', () => {
  it('are kept in memory, grow, and a save without them loses none', async () => {
    await keepsBests(new MemoryStorage());
  });
});

describe('how the trip went, over WebSockets', () => {
  let now = 1_000_000;
  const { enter } = setup({ maps: maps(fieldData()), items: ITEMS, weather: 'overcast', clock: () => now });

  it('comes after the zone that brings you home', async () => {
    const a = await enter({ map: 'field', x: 4, y: 10, dir: 'up' });
    await a.c.settle();
    let seq = 0;
    const step = async (dir: Dir) => {
      now += 400;
      a.c.send({ t: 'step', dir, seq: ++seq });
      await a.c.next('step', m => m.seq === seq);
    };
    for (const dir of OUT) await step(dir);
    now += TRIP_MIN_MS;
    for (const dir of HOME) await step(dir);
    await a.c.next('zone', m => m.map.id === 'house');
    const { trip } = await a.c.next('trip');
    expect(trip).toMatchObject({ steps: 11, deepest: { map: 'field', steps: 6 }, fell: null, best: [] });
  });
});
