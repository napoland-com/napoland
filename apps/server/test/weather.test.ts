/**
 * Weather per region (roadmap/regional-weather.md): one sun for the whole world, but each region's own
 * rain, by the windows its map sets, and a room under the sky of the map its door opens onto; and the
 * effects a consumable gives for a while (hand warmers, rad tablets). World rules, with the real maps
 * for the sky and small ones for the effects.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DAY_S, ENERGY_MAX, RESIST_MAX, TileMap, WET_SECONDS, energyRate, type Dir, type ItemsData, type ServerMsg } from '@napoland/shared';
import { loadMaps } from '../src/content';
import type { PlayerRecord } from '../src/storage';
import { World, colorFor, type Outgoing } from '../src/world';
import { fixtureMaps, itemsData, woodsData } from './fixtures';

const content = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/items.json'), 'utf8')) as ItemsData;
const { maps } = loadMaps(resolve(import.meta.dirname, '../../../content/maps'), 'stonebrook');
const DAY_MS = DAY_S * 1000;
/** A dawn whose night is a plain one, and the wall time `m` minutes after it. */
const DAWN = 20_001 * DAY_MS;
const at = (m: number) => DAWN + m * 60_000;

const rec = (id: string, map: string, x: number, y: number, dir: Dir = 'down', more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map, x, y, dir, color: colorFor(id), energy: ENERGY_MAX, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id || o.to === 'all' ? [o.msg] : []));
const onMap = (out: Outgoing[], map: string) => out.flatMap(o => ('map' in o && o.map === map ? [o.msg] : []));
const of = <T extends ServerMsg['t']>(msgs: ServerMsg[], t: T) => msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The real world with its weather cycling, its clock `wall` at game time 0; the dice never let anything cling to anyone. */
const realWorld = (wall: number) => new World(maps.values(), 'stonebrook', 'overcast', { items: content, cycle: true, epochOffset: wall, rng: () => 0.99 });

describe('rain, region by region', () => {
  const woods = maps.get('near-woods')!, road = maps.get('south-road')!;

  it('wets and drains each player by their own region\'s rain, and a room by the map outside its door', () => {
    // A minute before the Near Woods clear and the South Road's rain comes.
    const w = realWorld(at(23));
    const n = w.join(rec('n', 'near-woods', 31, 76, 'up'), 0), s = w.join(rec('s', 'south-road', 35, 2), 0), t = w.join(rec('t', 'stonebrook', 12, 24, 'up'), 0);
    const bunker = w.join(rec('b', 'south-road-bunker', 4, 3, 'up'), 0), lodge = w.join(rec('l', 'stonebrook-lodge', 5, 4, 'up'), 0);
    expect([n.weather, s.weather, t.weather, bunker.weather, lodge.weather]).toEqual(['rain', 'overcast', 'rain', 'overcast', 'rain']);
    // Out in the rain it drains faster and soaks you; on the dry road you dry off.
    expect(n.energy.rate).toBe(r3(energyRate(woods, 31, 76, 'rain')));
    expect(s.energy.rate).toBe(r3(energyRate(road, 35, 2, 'overcast')));
    expect(n.body.wetRate).toBeCloseTo(1 / WET_SECONDS, 5);
    expect(s.body.wetRate).toBeLessThan(0);
    w.drain();
    // At 24 minutes the Near Woods and the town clear and the South Road's rain comes: each hears its own.
    w.tick(60_000);
    const turned = w.drain();
    expect(of(onMap(turned, 'near-woods'), 'weather')).toEqual([{ t: 'weather', weather: 'overcast' }]);
    expect(of(onMap(turned, 'stonebrook'), 'weather')).toEqual([{ t: 'weather', weather: 'overcast' }]);
    expect(of(onMap(turned, 'stonebrook-lodge'), 'weather')).toEqual([{ t: 'weather', weather: 'overcast' }]);
    expect(of(onMap(turned, 'south-road'), 'weather')).toEqual([{ t: 'weather', weather: 'rain' }]);
    expect(of(onMap(turned, 'south-road-bunker'), 'weather')).toEqual([{ t: 'weather', weather: 'rain' }]);
    // And each drains and dries by it from then on.
    expect(of(to(turned, 's'), 'energy').at(-1)!.energy.rate).toBe(r3(energyRate(road, 35, 2, 'rain', { wet: w.get('s')!.wet })));
    expect(of(to(turned, 's'), 'energy').at(-1)!.body.wetRate).toBeGreaterThan(0);
    expect(of(to(turned, 'n'), 'energy').at(-1)!.body.wetRate).toBeLessThan(0);
    // Six minutes later the South Road is dry again: nobody else hears a thing. (Fresh players out there:
    // the first ones would have run out of energy by now.)
    for (const id of ['n', 's']) w.leave(id, 60_000);
    w.join(rec('n2', 'near-woods', 31, 76, 'up'), 6 * 60_000);
    w.join(rec('s2', 'south-road', 35, 2), 6 * 60_000);
    w.drain();
    w.tick(7 * 60_000);
    const cleared = w.drain();
    expect(of(onMap(cleared, 'south-road'), 'weather')).toEqual([{ t: 'weather', weather: 'overcast' }]);
    expect(of(onMap(cleared, 'near-woods'), 'weather')).toEqual([]);
    // Night falls everywhere at once: one sun.
    w.tick(9 * 60_000);
    const night = w.drain();
    for (const map of ['near-woods', 'south-road', 'stonebrook', 'stonebrook-lodge', 'south-road-bunker']) expect(of(onMap(night, map), 'weather'), map).toEqual([{ t: 'weather', weather: 'night' }]);
  });

  it('counts steps in the rain only where it rains', () => {
    const w = realWorld(at(14));
    w.join(rec('n', 'near-woods', 31, 76, 'up'), 0);
    w.join(rec('s', 'south-road', 35, 2), 0);
    w.step('n', 'up', 1, 1000);
    w.step('s', 'down', 1, 1000);
    expect(w.get('n')!.stats).toMatchObject({ rainSteps: 1 });
    expect(w.get('s')!.stats?.rainSteps).toBeUndefined();
  });

  it('says in a zone the weather of the map it leads to', () => {
    const w = realWorld(at(14));
    // On Stonebrook's south road, one step from the way out: rain in town, the road dry.
    w.join(rec('a', 'stonebrook', 11, 42), 0);
    w.drain();
    w.step('a', 'down', 1, 1000);
    const zone = of(to(w.drain(), 'a'), 'zone')[0]!;
    expect(zone).toMatchObject({ map: { id: 'south-road' }, weather: 'overcast' });
  });

  it('tells the regions apart on the notice board', () => {
    const board = (m: number) => {
      const w = realWorld(at(m));
      w.join(rec('r', 'stonebrook', 12, 24, 'up'), 0);
      w.drain();
      w.board('r', 12, 23, 0);
      return of(to(w.drain(), 'r'), 'board')[0]!.lines.slice(0, 3);
    };
    expect(board(14)).toEqual(['Night falls in about 18 minutes.', 'The Near Woods: rain for about 10 minutes more.', 'The South Road: dry for about 10 minutes, then rain.']);
    expect(board(26)).toEqual(['Night falls in about 6 minutes.', 'The Near Woods: dry until nightfall.', 'The South Road: rain for about 4 minutes more.']);
    expect(board(40)[0]).toBe('Night: no rain anywhere. Dawn in about 8 minutes.');
  });
});

describe('hand warmers and rad tablets', () => {
  const woods = new TileMap(woodsData());
  const items: ItemsData = {
    ...itemsData(),
    items: [
      ...itemsData().items,
      { id: 'warmer', name: 'Hand warmer', kind: 'consumable', stack: 4, text: 'Hot.', use: { resist: { cold: 0.4 }, lasts: 300 } },
      { id: 'tablet', name: 'Rad tablet', kind: 'consumable', stack: 6, text: 'White.', use: { resist: { radiation: 0.4 }, lasts: 300 } },
      { id: 'coat', name: 'Coat', kind: 'gear', stack: 1, text: 'Warm.', slot: 'shirt', tier: 'sturdy', resist: { cold: 0.5 } },
    ],
  };
  /** A night in the fixture woods, a player at 3,6 with hand warmers and rad tablets. */
  const night = (more: Partial<PlayerRecord> = {}) => {
    const w = new World(fixtureMaps(), 'town', 'night', { items, rng: () => 0.99 });
    w.join(rec('a', 'woods', 3, 6, 'up', { bag: [{ item: 'warmer', count: 2 }, { item: 'tablet', count: 1 }], ...more }), 0);
    w.drain();
    return w;
  };
  const cold = (c: number) => r3(energyRate(woods, 3, 6, 'night', { resist: { cold: c } }));
  const energy = (out: Outgoing[]) => of(to(out, 'a'), 'energy').at(-1);

  it('gives cold resistance +40% for 5 minutes: the night bites less, and the body says how long is left', () => {
    const w = night();
    w.use('a', 0, 1000);
    const out = w.drain();
    expect(energy(out)!.energy.rate).toBe(cold(0.4));
    expect(energy(out)!.body.effects).toEqual([{ item: 'warmer', left: 300 }]);
    expect(to(out, 'a').at(-1)).toEqual({ t: 'did', did: { kind: 'used', item: 'warmer', effect: { lasts: 300 } } });
    expect(w.get('a')!.bag).toEqual([{ item: 'warmer', count: 1 }, { item: 'tablet', count: 1 }]);
    // A moment before its end it still works; at its end the night bites as before, and nothing works on you.
    w.tick(300_999);
    expect(w.drain().flatMap(o => (o.msg.t === 'energy' ? [o.msg.energy.rate] : []))).not.toContain(cold(0));
    w.tick(301_000);
    const over = energy(w.drain())!;
    expect(over.energy.rate).toBe(cold(0));
    expect(over.body.effects).toBeUndefined();
  });

  it('does not add up with a second of the same: the second starts the 5 minutes again', () => {
    const w = night();
    w.use('a', 0, 1000);
    w.drain();
    w.use('a', 0, 121_000);
    const out = w.drain();
    expect(to(out, 'a').at(-1)).toEqual({ t: 'did', did: { kind: 'used', item: 'warmer', effect: { lasts: 300, again: true } } });
    expect(w.get('a')!.bag).toEqual([{ item: 'tablet', count: 1 }]);
    w.tick(200_000);
    expect(energy(w.drain())?.energy.rate ?? cold(0.4)).toBe(cold(0.4));
    // Still working where the first would have stopped, and over 5 minutes after the second.
    w.tick(305_000);
    expect(w.drain().flatMap(o => o.msg.t === 'energy' ? [o.msg.body.effects] : [])).not.toContainEqual(undefined);
    w.tick(421_500);
    expect(energy(w.drain())!.body.effects).toBeUndefined();
  });

  it('stays under the cap with gear, and counts beside another effect', () => {
    const w = night({ gear: { shirt: 'coat', bag: 'backpack' } });
    w.use('a', 0, 1000);
    expect(energy(w.drain())!.energy.rate).toBe(cold(RESIST_MAX));
    w.use('a', 1, 2000);
    const both = energy(w.drain())!;
    expect(both.body.effects).toEqual([{ item: 'warmer', left: 299 }, { item: 'tablet', left: 300 }]);
  });

  it('keeps working while you are away, and is over when its time is', () => {
    const w = night();
    w.use('a', 0, 1000);
    w.leave('a', 60_000);
    w.drain();
    const back = w.join(rec('a', 'woods', 3, 6, 'up', { bag: [] }), 120_000);
    expect(back.body.effects).toEqual([{ item: 'warmer', left: 181 }]);
    expect(back.energy.rate).toBe(cold(0.4));
    w.leave('a', 130_000);
    w.tick(400_000);
    expect(w.join(rec('a', 'woods', 3, 6, 'up', { bag: [] }), 400_000).body.effects).toBeUndefined();
  });

  it('cuts a surge\'s radiation with a rad tablet: half of its extra drain is radiant', () => {
    const surging = new TileMap({ ...woodsData(), surge: { every: 100, unstable: 10, surge: 20, sweep: 10 } });
    const w = new World([...fixtureMaps().filter(m => m.data.id !== 'woods'), surging], 'town', 'overcast', { items, rng: () => 0.99 });
    w.join(rec('a', 'woods', 1, 1, 'up', { bag: [{ item: 'tablet', count: 1 }] }), 0);
    // In the surge (80 to 100 seconds into each round of 100), far from the fire and the lamp, where its front has passed.
    w.tick(95_000);
    w.drain();
    w.use('a', 0, 95_000);
    const rate = energy(w.drain())!.energy.rate;
    const plain = energyRate(surging, 1, 1, 'overcast', { surgeFront: 0 }), shielded = energyRate(surging, 1, 1, 'overcast', { surgeFront: 0, resist: { radiation: 0.4 } });
    expect(rate).toBe(r3(shielded));
    expect(-rate).toBeLessThan(-plain);
  });
});
