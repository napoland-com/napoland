/**
 * What wears you down out there, and what helps: fires that burn down and are fed, a heavy bag,
 * rain, surges, storms, flashes, watchers, skulkers, hitchhikers, flares, marks, the Old Stone, strange objects, feats, the
 * echo a pile keeps, the notice board and the weather's day. World rules only; over real
 * WebSockets they go through the same calls as the rest (net.ts).
 *
 * Most tests use a field: open grass in the wilds, walled in by forest, with the way home in the
 * middle of its bottom row. Steps from home are simple there: |x - 4| + (bottom row - y).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DAY_S, conditionsAt, seeded, ENERGY_MAX, FEATS, FLASH_BURST_S, FLASH_GLOW_S, REFILL_PER_SECOND, STEP_MS, SURGE_DRAIN, TileMap, WET_SECONDS, energyRate, weatherAt,
  type ConditionDef, type ConditionsData, type Dir, type ItemsData, type MapData, type MapObject, type ServerMsg, type Weather,
} from '@napoland/shared';
import { loadMaps } from '../src/content';
import { EMBERS, FIRE_LOW_S, FIRE_MAX_S } from '../src/fires';
import type { MarkRecord, PlayerRecord } from '../src/storage';
import {
  HITCH_STEPS, MARKS_PER_PLAYER, MARK_LIFETIME_MS, SKULKER_CATCH, SKULKER_CHASE_MS, SKULKER_STEP_MS, STONE_NEED, STONE_SHARD_S, TRAIL_STEPS, WATCHER_HUNT, WATCHER_HUNT_LIVE, WATCHER_STEP_MS, WATCHER_TOUCH, World, colorFor, faces,
  type Outgoing, type WorldOptions,
} from '../src/world';
import { fixtureMaps, houseData, townData } from './fixtures';

/** A field `h` tiles tall (8 wide inside the forest), its way home at (4, h - 1). */
function fieldData(h = 12, more: Partial<MapData> = {}): MapData {
  const tiles = Array.from({ length: h }, (_, y) => (y === 0 ? 'tttttttttt' : y === h - 1 ? 'ttttgttttt' : 'tggggggggt'));
  return {
    id: 'field', name: 'The Field', version: 1, kind: 'wilds', depth: 1, width: 10, height: h,
    tiles, levels: Array<string>(h).fill('0000000000'),
    spawn: { x: 4, y: h - 2, dir: 'up' },
    exits: [{ x: 4, y: h - 1, w: 1, h: 1, to: 'town', tx: 4, ty: 1, dir: 'down', home: true }],
    objects: [],
    ...more,
  };
}

/** The fixture town, with the Old Stone at 3,3 and a notice board at 0,4. */
function townWithStone(): MapData {
  const t = townData();
  return { ...t, objects: [...t.objects, { kind: 'stone', x: 3, y: 3 }, { kind: 'board', x: 0, y: 4 }] };
}

const ITEMS: ItemsData = {
  version: 9,
  items: [
    { id: 'twig', name: 'Twig', kind: 'resource', stack: 10, text: 'Dry.', fuel: 120, weight: 0.1 },
    { id: 'rock', name: 'Rock', kind: 'resource', stack: 10, text: 'Heavy.', weight: 2 },
    { id: 'cap', name: 'Glowcap', kind: 'resource', stack: 20, text: 'Glows.', use: { mark: true } },
    { id: 'flare', name: 'Flare', kind: 'consumable', stack: 3, text: 'Red.', use: { flare: 30 } },
    { id: 'shard', name: 'Shard', kind: 'resource', stack: 5, text: 'Warm.', charge: 1 },
    { id: 'odd', name: 'Strange object', kind: 'resource', stack: 1, text: 'What is it?', use: { identify: true }, reveals: [{ item: 'feather', count: 1, weight: 1 }] },
    { id: 'feather', name: 'Feather', kind: 'charm', stack: 1, text: 'Light.', charm: { load: 0.5 } },
  ],
  finds: [],
};

/** A player on `map` at x,y with a full bar, unless `more` says otherwise. */
const rec = (id: string, map: string, x: number, y: number, dir: Dir = 'up', more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map, x, y, dir, color: colorFor(id), energy: ENERGY_MAX, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});

/** A world of the town with the Old Stone, and `field` (or the fixture house and woods too). Players join at 0; joins drained. */
function world(field: MapData, weather: Weather, options: WorldOptions = {}, ...players: PlayerRecord[]): World {
  const maps = [new TileMap(townWithStone()), new TileMap(field), ...fixtureMaps().filter(m => m.data.id !== 'town')];
  const w = new World(maps, 'town', weather, { items: ITEMS, rng: () => 0, ...options });
  for (const p of players) w.join(p, 0);
  w.drain();
  w.takeWrites();
  return w;
}

/** What player `id` hears for themselves: messages for them, and those for everyone online. */
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id || o.to === 'all' ? [o.msg] : []));
const onMap = (out: Outgoing[], map: string) => out.flatMap(o => ('map' in o && o.map === map ? [o.msg] : []));
const of = <T extends ServerMsg['t']>(msgs: ServerMsg[], t: T) => msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
const lastEnergy = (out: Outgoing[], id: string) => of(to(out, id), 'energy').at(-1);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

describe('fires out there', () => {
  // The field with a campfire at 4,4: it warms 3,3 to 5,5.
  const withFire = () => fieldData(12, { objects: [{ kind: 'fireplace', x: 4, y: 4 }] });
  const field = new TileMap(withFire());

  it('burn down: well fed they give energy back, low they only glow, out they give nothing', () => {
    // rng 0: it starts half full.
    const start = FIRE_MAX_S / 2;
    const w = world(withFire(), 'overcast', {}, rec('a', 'field', 4, 5, 'up', { energy: 10 }));
    expect(w.scene('field', 0).fires).toEqual([{ x: 4, y: 4, left: start }]);
    const at = (s: number) => {
      w.tick(s * 1000);
      return lastEnergy(w.drain(), 'a');
    };
    expect(w.get('a')).toBeDefined();
    // Well fed: the full rate.
    w.tick(1000);
    expect(w.get('a')!.energy).toBeCloseTo(10 + REFILL_PER_SECOND, 5);
    // Low: embers.
    expect(at(start - FIRE_LOW_S + 1)?.energy.rate).toBe(r3(REFILL_PER_SECOND * EMBERS));
    // Out: a drain like anywhere else out there.
    expect(at(start + 1)?.energy.rate).toBe(r3(energyRate(field, 4, 5, 'overcast', { warmth: 0 })));
    expect(w.scene('field', (start + 1) * 1000).fires).toEqual([{ x: 4, y: 4, left: 0 }]);
  });

  it('are fed with what burns, from next to them: the map sees it burn again, and it counts for the fire keeper', () => {
    const w = world(withFire(), 'overcast', {}, rec('a', 'field', 4, 5, 'up', { bag: [{ item: 'twig', count: 2 }, { item: 'rock', count: 1 }] }), rec('b', 'field', 1, 1));
    const out = FIRE_MAX_S / 2 * 1000;
    w.tick(out + 5000);
    w.drain();
    // A rock does not burn; from two tiles away, nothing reaches it.
    w.feed('a', 4, 4, 1, out + 5000);
    w.feed('b', 4, 4, 0, out + 5000);
    expect([...to(w.drain(), 'a'), ...[]].filter(m => m.t === 'refused')).toEqual([{ t: 'refused', action: 'feed', reason: 'not_fuel' }]);
    w.feed('a', 4, 4, 0, out + 5000);
    const heard = w.drain();
    expect(onMap(heard, 'field')).toContainEqual({ t: 'fire', fire: { x: 4, y: 4, left: 120 } });
    expect(of(to(heard, 'a'), 'bag').at(-1)).toEqual({ t: 'bag', bag: [{ item: 'twig', count: 1 }, { item: 'rock', count: 1 }] });
    // Lit again, it warms whoever stands by it (low: 120 s is under FIRE_LOW_S).
    expect(lastEnergy(heard, 'a')?.energy.rate).toBe(r3(REFILL_PER_SECOND * EMBERS));
    expect(w.get('a')!.stats).toEqual({ fed: 1 });
  });

  it('never needs feeding in town, and never burns past full', () => {
    const w = world(withFire(), 'overcast', {}, rec('a', 'house', 2, 2, 'up', { bag: [{ item: 'twig', count: 10 }] }), rec('b', 'field', 4, 5, 'up', { bag: [{ item: 'twig', count: 10 }] }));
    w.feed('a', 2, 1, 0, 1000);
    expect(of(to(w.drain(), 'a'), 'refused')).toEqual([{ t: 'refused', action: 'feed', reason: 'tended' }]);
    expect(w.scene('house', 1000).fires).toEqual([{ x: 2, y: 1, left: null }]);
    // Half full (900 s): seven twigs fill it, the eighth tops it up to full, the ninth does not fit.
    for (let i = 0; i < 9; i++) w.feed('b', 4, 4, 0, 1000);
    expect(of(to(w.drain(), 'b'), 'refused')).toEqual([{ t: 'refused', action: 'feed', reason: 'fire_full' }]);
    expect(w.scene('field', 1000).fires[0]!.left).toBe(FIRE_MAX_S);
  });
});

describe('the bag and the rain', () => {
  const field = new TileMap(fieldData());

  it('drains faster with a heavy bag, and a charm makes it lighter', () => {
    const w = world(fieldData(), 'overcast');
    // 3 rocks: 6 kg of 10. The feather halves how heavy the bag feels.
    const a = w.join(rec('a', 'field', 3, 5, 'up', { bag: [{ item: 'rock', count: 3 }] }), 0);
    const b = w.join(rec('b', 'field', 3, 6, 'up', { bag: [{ item: 'rock', count: 3 }, { item: 'feather', count: 1 }] }), 0);
    expect(a.body.load).toBe(0.6);
    expect(a.energy.rate).toBe(r3(energyRate(field, 3, 5, 'overcast', { load: 0.6 })));
    expect(b.body.load).toBe(0.3);
    expect(b.energy.rate).toBe(r3(energyRate(field, 3, 6, 'overcast', { load: 0.3 })));
    // Throwing the rocks away makes it light again, and the player hears it at once.
    w.drain();
    w.discard('a', 0, 1000);
    expect(lastEnergy(w.drain(), 'a')).toMatchObject({ body: { load: 0 }, energy: { rate: r3(energyRate(field, 3, 5, 'overcast')) } });
  });

  it('soaks you in the rain, and wet drains faster; a fire dries you', () => {
    const fire: MapObject = { kind: 'fireplace', x: 4, y: 3 };
    const w = world(fieldData(12, { objects: [fire] }), 'rain', {}, rec('a', 'field', 4, 7));
    w.tick(WET_SECONDS * 500);
    expect(w.get('a')!.wet).toBeCloseTo(0.5, 5);
    const heard = w.drain();
    // The rate follows the wetness (told again once it moved far enough from what was heard).
    expect(of(to(heard, 'a'), 'energy').length).toBeGreaterThan(0);
    w.tick(WET_SECONDS * 1000);
    expect(w.get('a')!.wet).toBe(1);
    expect(lastEnergy(w.drain(), 'a')?.energy.rate).toBeLessThan(energyRate(field, 4, 7, 'rain', { wet: 0.8 }));
    // Walk up to the fire: it dries.
    const t = WET_SECONDS * 1000 + 1000;
    w.step('a', 'up', 1, t);
    w.step('a', 'up', 2, t + 300);
    w.step('a', 'up', 3, t + 600);
    w.tick(t + 600);
    expect(lastEnergy(w.drain(), 'a')?.body.wetRate).toBeLessThan(0);
    w.tick(t + 600 + 25_000);
    expect(w.get('a')!.wet).toBe(0);
  });
});

describe('surges', () => {
  // A round of 100 s: calm 60, restless 20, surge 20; the front takes 10 s to reach home.
  const surge = { every: 100, unstable: 20, surge: 20, sweep: 10 };
  const data = () => fieldData(12, { surge, objects: [{ kind: 'lamp', x: 1, y: 2 }] });
  const field = new TileMap(data());
  const items: ItemsData = { ...ITEMS, finds: [{ item: 'shard', map: 'field', count: 2, respawn: [5, 5], when: 'unstable' }] };

  it('announce each phase to the map, and grow restless finds only until the calm comes back', () => {
    const w = world(data(), 'overcast', { items }, rec('a', 'field', 4, 9), rec('b', 'town', 1, 2));
    w.tick(0);
    expect(w.scene('field', 0).surge).toEqual({ phase: 'calm', left: 60, into: 0 });
    expect(w.findViews('field')).toEqual([]);
    w.drain();
    w.tick(60_000);
    const restless = w.drain();
    expect(onMap(restless, 'field')).toContainEqual({ t: 'surge', surge: { phase: 'unstable', left: 20, into: 0 } });
    expect(of(onMap(restless, 'field'), 'find')).toHaveLength(2);
    expect(onMap(restless, 'town')).toEqual([]);
    w.tick(80_000);
    expect(onMap(w.drain(), 'field')).toContainEqual({ t: 'surge', surge: { phase: 'surge', left: 20, into: 0 } });
    expect(w.findViews('field')).toHaveLength(2);
    w.tick(100_000);
    const calm = onMap(w.drain(), 'field');
    expect(calm).toContainEqual({ t: 'surge', surge: { phase: 'calm', left: 60, into: 0 } });
    expect(of(calm, 'findGone')).toHaveLength(2);
    expect(w.findViews('field')).toEqual([]);
  });

  it('sweeps from the deepest tile toward home, and a street light shelters you', () => {
    // deepest: the top right corner, 4 + 10 = 14 steps from home. 1,3 (lit) is 11; 4,9 is 2.
    expect(field.deepest).toBe(14);
    const w = world(data(), 'overcast', {}, rec('deep', 'field', 8, 1), rec('lit', 'field', 1, 3), rec('near', 'field', 4, 9));
    w.tick(79_000);
    w.drain();
    // As it starts, the front is at the deepest tile, 14 steps: the deep one is in it.
    w.tick(80_000);
    const heard = w.drain();
    expect(lastEnergy(heard, 'deep')?.energy.rate).toBe(r3(SURGE_DRAIN * energyRate(field, 8, 1, 'overcast')));
    expect(of(to(heard, 'near'), 'energy')).toEqual([]);
    // 9 s in, the front is at 1.4: everyone but the one in the light.
    w.tick(89_000);
    const later = w.drain();
    expect(lastEnergy(later, 'near')?.energy.rate).toBe(r3(SURGE_DRAIN * energyRate(field, 4, 9, 'overcast')));
    // The one in the light drains as ever (repeated every few seconds, the same rate).
    for (const m of of(to(later, 'lit'), 'energy')) expect(m.energy.rate).toBe(r3(energyRate(field, 1, 3, 'overcast')));
  });

  it('is gentler while the Old Stone is awake; it wakes on enough shards and sleeps when they burn away', () => {
    const shards = [{ item: 'shard', count: 5 }, { item: 'shard', count: 5 }, { item: 'shard', count: 5 }, { item: 'shard', count: 5 }];
    const w = world(data(), 'overcast', {}, rec('s', 'town', 3, 4, 'up', { bag: shards }), rec('d', 'field', 8, 1));
    for (let i = 0; i < STONE_NEED - 1; i++) w.feed('s', 3, 3, 0, 1000);
    const fed = w.drain();
    expect(of(to(fed, 's'), 'stone').at(-1)).toEqual({ t: 'stone', stone: { charge: 19, need: 20, awake: false, left: 0 } });
    expect(of(to(fed, 'd'), 'stone')).toHaveLength(STONE_NEED - 1);
    expect(w.takeWrites().stone).toEqual({ charge: 19, awake: false, at: 1000 });
    w.feed('s', 3, 3, 0, 1000);
    expect(of(to(w.drain(), 'd'), 'stone')).toEqual([{ t: 'stone', stone: { charge: 20, need: 20, awake: true, left: 20 * STONE_SHARD_S } }]);
    w.tick(79_000);
    w.drain();
    w.tick(80_000);
    expect(lastEnergy(w.drain(), 'd')?.energy.rate).toBe(r3(energyRate(field, 8, 1, 'overcast', { surgeFront: 14, surgeDrain: 1 + (SURGE_DRAIN - 1) / 2 })));
    // Nobody feeds it: it sleeps once every shard burned away, and everyone hears it.
    w.tick(1000 + STONE_NEED * STONE_SHARD_S * 1000);
    expect(of(to(w.drain(), 'd'), 'stone')).toEqual([{ t: 'stone', stone: { charge: 0, need: 20, awake: false, left: 0 } }]);
  });
});

describe('storms', () => {
  // A round of 100 s: clear 70, a warning of 10, then 20 of storm. A hut's door opens off the field.
  const storm = { every: 100, warn: 10, length: 20 };
  const data = () => fieldData(12, { storm, exits: [...fieldData().exits, { x: 1, y: 1, w: 1, h: 1, to: 'hut', tx: 2, ty: 3, dir: 'up' }] });
  const hut = (): MapData => ({ ...houseData(), id: 'hut', name: 'Hut', exits: [{ x: 2, y: 4, w: 1, h: 1, to: 'field', tx: 1, ty: 2, dir: 'down' }] });
  const items: ItemsData = { ...ITEMS, finds: [{ item: 'shard', map: 'field', count: 1, respawn: [5, 5], when: 'storm' }] };

  it('announce each phase to the map and the rooms off it, drain and soak whoever is out in one, and leave finds while they blow', () => {
    const maps = [new TileMap(townWithStone()), new TileMap(data()), new TileMap(hut()), ...fixtureMaps().filter(m => m.data.id !== 'town')];
    const w = new World(maps, 'town', 'overcast', { items, rng: () => 0 });
    w.join(rec('a', 'field', 4, 5), 0);
    w.join(rec('b', 'hut', 2, 2), 0);
    w.tick(0);
    w.drain();
    expect(w.scene('field', 0).storm).toEqual({ phase: 'clear', left: 70 });
    expect(w.scene('hut', 0).storm).toEqual({ phase: 'clear', left: 70 });
    w.tick(70_000);
    const coming = w.drain();
    expect(onMap(coming, 'field')).toContainEqual({ t: 'storm', storm: { phase: 'coming', left: 10 } });
    expect(onMap(coming, 'hut')).toContainEqual({ t: 'storm', storm: { phase: 'coming', left: 10 } });
    expect(w.findViews('field')).toEqual([]);
    w.tick(80_000);
    const blowing = w.drain();
    expect(onMap(blowing, 'field')).toContainEqual({ t: 'storm', storm: { phase: 'storm', left: 20 } });
    expect(w.findViews('field')).toHaveLength(1);
    const a = lastEnergy(blowing, 'a')!;
    expect(a.energy.rate).toBeCloseTo(energyRate(new TileMap(data()), 4, 5, 'overcast', { storm: true }), 3);
    expect(a.body.wetRate).toBeCloseTo(1 / WET_SECONDS, 5);
    // Under the hut's roof nothing drains, and you dry off.
    expect(w.get('b')!.energy).toBe(ENERGY_MAX);
    w.tick(100_000);
    const clear = onMap(w.drain(), 'field');
    expect(clear).toContainEqual({ t: 'storm', storm: { phase: 'clear', left: 70 } });
    expect(of(clear, 'findGone')).toHaveLength(1);
  });
});

describe('flashes', () => {
  // A flash every 30 s near someone 3 or more steps from home.
  const data = () => fieldData(12, { flashes: { every: 30, steps: [3, 99] } });

  it('start near someone out there, glow first, then drain whoever stands in them by their kind', () => {
    // rng 0: a is picked, the flash goes on the first free tile around a (2,3), and it is a spark.
    const w = world(data(), 'overcast', {}, rec('a', 'field', 4, 5), rec('b', 'field', 2, 4));
    const T = 30_000;
    w.tick(0);
    w.tick(T - 1000);
    expect(w.drain().filter(o => o.msg.t === 'flash')).toEqual([]);
    w.tick(T);
    const started = w.drain();
    expect(onMap(started, 'field')).toContainEqual({ t: 'flash', flash: { x: 2, y: 3, kind: 'spark', left: FLASH_GLOW_S + FLASH_BURST_S } });
    expect(w.scene('field', T).flashes).toHaveLength(1);
    const field = new TileMap(data()), plainB = energyRate(field, 2, 4, 'overcast'), plainA = energyRate(field, 4, 5, 'overcast');
    // Glowing: nobody loses more yet.
    w.tick(T + 5000);
    expect(lastEnergy(w.drain(), 'b')?.energy.rate ?? plainB).toBeCloseTo(plainB, 3);
    // Discharging: b stands in it, a does not.
    w.tick(T + FLASH_GLOW_S * 1000 + 1);
    const burst = w.drain();
    expect(lastEnergy(burst, 'b')!.energy.rate).toBeCloseTo(energyRate(field, 2, 4, 'overcast', { flash: 'spark' }), 3);
    expect(lastEnergy(burst, 'a')?.energy.rate ?? plainA).toBeCloseTo(plainA, 3);
    w.tick(T + (FLASH_GLOW_S + FLASH_BURST_S) * 1000 + 1);
    expect(w.scene('field', T + 13_000).flashes).toEqual([]);
  });

  it('leave alone whoever is close to home or under a street light', () => {
    const w = world(fieldData(12, { flashes: { every: 30, steps: [3, 99] }, objects: [{ kind: 'lamp', x: 1, y: 5 }] }), 'overcast', {}, rec('a', 'field', 4, 9), rec('b', 'field', 2, 5));
    w.tick(0);
    w.tick(30_000);
    expect(w.drain().filter(o => o.msg.t === 'flash')).toEqual([]);
  });
});

describe('watchers', () => {
  // One watcher, waking 12 or more steps from home: with rng 0, at 1,1 (13 steps), the first such tile far enough from everyone.
  const data = () => fieldData(12, { watchers: { count: 1, steps: [12, 99] } });

  it('wake where nobody is, and come closer only while nobody looks their way', () => {
    const w = world(data(), 'overcast', {}, rec('a', 'field', 4, 6, 'down', { bag: [{ item: 'rock', count: 2 }] }));
    w.tick(0);
    expect(onMap(w.drain(), 'field')).toContainEqual({ t: 'creature', creature: { id: 1, kind: 'watcher', x: 1, y: 1, dir: 'down' } });
    // Back turned: it comes.
    w.tick(WATCHER_STEP_MS);
    const first = of(onMap(w.drain(), 'field'), 'creature');
    expect(first).toHaveLength(1);
    expect(Math.abs(first[0]!.creature.x - 4) + Math.abs(first[0]!.creature.y - 6)).toBe(7);
    // Facing it: it holds still, however long.
    w.face('a', 'up');
    for (let t = 2; t < 10; t++) w.tick(t * WATCHER_STEP_MS);
    expect(of(onMap(w.drain(), 'field'), 'creature')).toEqual([]);
  });

  it('take energy and one thing you carry when they reach you, and go away for a while', () => {
    const w = world(data(), 'overcast', {}, rec('a', 'field', 4, 6, 'down', { bag: [{ item: 'rock', count: 2 }] }));
    let touched: Extract<ServerMsg, { t: 'touched' }> | undefined;
    let t = 0;
    for (; t < 40 && !touched; t++) {
      w.tick(t * WATCHER_STEP_MS);
      touched = of(to(w.drain(), 'a'), 'touched')[0];
    }
    expect(touched).toEqual({ t: 'touched', by: 'watcher', lost: 'rock' });
    expect(w.get('a')!.bag).toEqual([{ item: 'rock', count: 1 }]);
    // Seven steps to reach you, a little drain on the way, and the touch.
    expect(w.get('a')!.energy).toBeLessThan(ENERGY_MAX - WATCHER_TOUCH);
    expect(w.get('a')!.energy).toBeGreaterThan(ENERGY_MAX - WATCHER_TOUCH - 5);
    expect(w.scene('field', t * WATCHER_STEP_MS).creatures).toEqual([]);
  });

  it('keep off a flare and slink away from one lit near them; a friend facing it holds it too', () => {
    // It wakes at 1,1: 8 steps from a, 11 from b, who faces up toward it.
    const w = world(data(), 'overcast', {}, rec('a', 'field', 4, 6, 'down', { bag: [{ item: 'flare', count: 1 }] }), rec('b', 'field', 5, 8, 'up'));
    w.tick(0);
    w.drain();
    // b, below it and facing up, keeps it still for a.
    for (let t = 1; t < 6; t++) w.tick(t * WATCHER_STEP_MS);
    expect(of(onMap(w.drain(), 'field'), 'creature')).toEqual([]);
    w.face('b', 'down');
    w.tick(6 * WATCHER_STEP_MS);
    w.tick(7 * WATCHER_STEP_MS);
    expect(of(onMap(w.drain(), 'field'), 'creature').length).toBeGreaterThan(0);
    w.use('a', 0, 8 * WATCHER_STEP_MS);
    const lit = onMap(w.drain(), 'field');
    expect(lit).toContainEqual({ t: 'flare', flare: { x: 4, y: 6, left: 30 } });
    expect(lit).toContainEqual({ t: 'creatureGone', id: 1 });
  });

  it('look where you face: anything on that side of you', () => {
    expect(faces(5, 5, 'up', 9, 4)).toBe(true);
    expect(faces(5, 5, 'up', 5, 5)).toBe(false);
    expect(faces(5, 5, 'left', 4, 9)).toBe(true);
    expect(faces(5, 5, 'down', 5, 4)).toBe(false);
  });
});

describe('live finds', () => {
  // Restless from 60 s to 80 s of each 100 s round; a live shard (40 XP, fresh 240 s, 5 less a minute) fades into a 12 XP shard at 600 s.
  const surge = { every: 100, unstable: 20, surge: 20, sweep: 10 };
  const items: ItemsData = {
    ...ITEMS,
    items: [
      ...ITEMS.items.map(i => (i.id === 'shard' ? { ...i, xp: 12 } : i)),
      { id: 'live-shard', name: 'Live shard', kind: 'resource', stack: 1, xp: 12, weight: 0.3, charge: 1, text: 'Burning.', live: { xp: 40, fresh: 240, fade: 5, into: 'shard' } },
    ],
    finds: [{ item: 'live-shard', map: 'field', count: 1, respawn: [5, 5], when: 'unstable' }],
  };
  const live = (since: number) => ({ item: 'live-shard', count: 1, since });

  it('start fading when picked, and make the carrier glow for everyone on the map', () => {
    const w = world(fieldData(12, { surge }), 'overcast', { items }, rec('b', 'field', 1, 1));
    w.tick(60_000);
    const [find] = w.findViews('field');
    w.join(rec('a', 'field', find!.x, find!.y), 60_000);
    w.drain();
    w.pick('a', find!.x, find!.y, 61_000);
    const out = w.drain();
    expect(of(to(out, 'a'), 'bag').at(-1)).toEqual({ t: 'bag', bag: [{ item: 'live-shard', count: 1, age: 0 }] });
    expect(onMap(out, 'field')).toContainEqual({ t: 'glow', id: 'a', on: true });
    expect(w.get('a')!.bag).toEqual([live(61_000)]);
    // Someone who comes along later sees it too.
    expect(w.join(rec('c', 'field', 8, 1), 62_000).players.find(p => p.id === 'a')?.live).toBe(true);
  });

  it('are worth 40 XP stashed within 4 minutes, less after, and never pay off what was taken out', () => {
    const field = fieldData(12, { objects: [{ kind: 'chest', x: 1, y: 1 }] });
    const stash = { items: {}, out: { shard: 2 } };
    const w = world(field, 'overcast', { items },
      rec('a', 'field', 1, 2, 'up', { bag: [live(0)], stash }), rec('b', 'field', 2, 1, 'left', { bag: [live(0), { item: 'twig', count: 1 }], stash }));
    w.store('a', 1, 1, undefined, 180_000);
    expect(of(to(w.drain(), 'a'), 'progress')[0]?.gained).toBe(40);
    expect(w.get('a')!.stash).toEqual({ items: { shard: 1 }, out: { shard: 2 } });
    w.store('b', 1, 1, 0, 360_000);
    expect(of(to(w.drain(), 'b'), 'progress')[0]?.gained).toBe(30);
    expect(w.get('b')!.bag).toEqual([{ item: 'twig', count: 1 }]);
  });

  it('turn into a plain shard after 10 minutes, and the map sees the glow go out', () => {
    const w = world(fieldData(), 'overcast', { items }, rec('a', 'town', 1, 2, 'up', { bag: [{ item: 'shard', count: 1 }, live(0)] }), rec('b', 'town', 2, 2));
    w.tick(599_000);
    expect(of(onMap(w.drain(), 'town'), 'glow')).toEqual([]);
    w.tick(600_000);
    const out = w.drain();
    expect(w.get('a')!.bag).toEqual([{ item: 'shard', count: 2 }]);
    expect(of(to(out, 'a'), 'bag').at(-1)).toEqual({ t: 'bag', bag: [{ item: 'shard', count: 2 }] });
    expect(onMap(out, 'town')).toContainEqual({ t: 'glow', id: 'a', on: false });
    expect(w.takeWrites().players.map(p => p.id)).toEqual(['a']);
  });

  it('go dim in a collapse: the pile holds a plain shard', () => {
    const w = world(fieldData(), 'overcast', { items }, rec('a', 'field', 4, 5, 'up', { energy: 0.01, bag: [live(0), { item: 'rock', count: 1 }] }));
    w.tick(10_000);
    expect(onMap(w.drain(), 'field')).toContainEqual({ t: 'glow', id: 'a', on: false });
    expect(w.takeWrites().drops[0]?.drop?.items).toEqual([{ item: 'shard', count: 1 }, { item: 'rock', count: 1 }]);
  });

  it('draw watchers from farther away', () => {
    expect(WATCHER_HUNT_LIVE).toBeGreaterThan(WATCHER_HUNT);
    // The watcher wakes at 1,1 (as in the watchers' tests); 4,9 is 11 steps from it.
    const hunted = (bag: PlayerRecord['bag']) => {
      const w = world(fieldData(12, { watchers: { count: 1, steps: [12, 99] } }), 'overcast', { items }, rec('a', 'field', 4, 9, 'down', { bag }));
      w.tick(0);
      w.drain();
      w.tick(WATCHER_STEP_MS);
      return of(onMap(w.drain(), 'field'), 'creature').length > 0;
    };
    expect(hunted([live(0)])).toBe(true);
    expect(hunted([{ item: 'shard', count: 1 }])).toBe(false);
  });
});

describe('skulkers', () => {
  // One skulker, out at night and in storms, that may go 8 steps from home or more. The field has one
  // fern tile, at 4,3: its lair (h - 4 steps from home).
  const skulkers = { count: 1, steps: [8, 999] as [number, number], when: ['night', 'storm'] as Array<'night' | 'storm'> };
  const data = (h = 40, more: Partial<MapData> = {}): MapData => {
    const d = fieldData(h, { skulkers, ...more });
    return { ...d, tiles: d.tiles.map((r, y) => (y === 3 ? `${r.slice(0, 4)}f${r.slice(5)}` : r)) };
  };
  const creatures = (out: Outgoing[]) => of(onMap(out, 'field'), 'creature').map(m => m.creature);
  /** A night where the skulker woke in its lair with nobody near, then `a` joined. */
  const night = (a: PlayerRecord, d = data()) => {
    const w = world(d, 'night');
    w.tick(0);
    expect(w.scene('field', 0).creatures).toEqual([{ id: 1, kind: 'skulker', x: 4, y: 3, dir: 'down' }]);
    w.join(a, 0);
    w.drain();
    return w;
  };
  /** Ticks every 50 ms from `from` to `to`; at each STEP_MS, `a` steps where `walk` says (if anywhere). Everything heard. */
  const run = (w: World, from: number, to: number, walk: (t: number) => Dir | undefined = () => undefined) => {
    const out: Outgoing[] = [];
    for (let t = from; t <= to; t += 50) {
      const dir = t % STEP_MS === 0 ? walk(t) : undefined;
      if (dir) w.step('a', dir, t, t);
      w.tick(t);
      out.push(...w.drain());
    }
    return out;
  };
  /** From 3,9 (7 from the lair), a step right at 800 (6 from it, walking: it hears that), then down from 1000 while `more` says so. */
  const noticed = (more: (t: number) => boolean = () => false) => (t: number): Dir | undefined => (t === 800 ? 'right' : t >= 1000 && more(t) ? 'down' : undefined);

  it('lie in the deep ferns only at night (aurora nights too) or in a storm', () => {
    const w = world(data(), 'overcast', {}, rec('a', 'field', 4, 30));
    w.tick(0);
    expect(w.scene('field', 0).creatures).toEqual([]);
    w.setWeather('aurora', 1000);
    w.tick(1000);
    expect(creatures(w.drain())).toEqual([{ id: 1, kind: 'skulker', x: 4, y: 3, dir: 'down' }]);
    w.setWeather('overcast', 2000);
    w.tick(2000);
    expect(onMap(w.drain(), 'field')).toContainEqual({ t: 'creatureGone', id: 1 });
    // A storm (80 to 100 s into each round of 100) brings it out by day, once its time away is over.
    const s = world(data(40, { storm: { every: 100, warn: 10, length: 20 } }), 'overcast', {}, rec('a', 'field', 4, 30));
    s.tick(79_000);
    expect(s.scene('field', 79_000).creatures).toEqual([]);
    s.tick(81_000);
    expect(s.scene('field', 81_000).creatures).toMatchObject([{ kind: 'skulker', x: 4, y: 3 }]);
    s.tick(101_000);
    expect(s.scene('field', 101_000).creatures).toEqual([]);
  });

  it('hear you walking 6 tiles away, but see you standing still only 3 away', () => {
    // Still, 5 away: it lies where it is.
    const w = night(rec('a', 'field', 4, 8));
    expect(creatures(run(w, 50, 3000))).toEqual([]);
    // One step to 6 away: it heard that, and comes.
    const heard = creatures(run(w, 3050, 3500, t => (t === 3200 ? 'down' : undefined)));
    expect(heard[0]).toEqual({ id: 1, kind: 'skulker', x: 4, y: 4, dir: 'down', chasing: 'a' });
    // Standing still 3 away is close enough to be seen.
    const seen = night(rec('a', 'field', 4, 6));
    expect(creatures(run(seen, 50, 600))[0]).toMatchObject({ chasing: 'a' });
  });

  it('chase a little slower than you walk: walking away in time gets you out, and it gives up when you leave', () => {
    expect(SKULKER_STEP_MS).toBeGreaterThanOrEqual(STEP_MS * 1.2);
    const w = night(rec('a', 'field', 3, 9));
    const away = run(w, 50, 5500, noticed(() => w.get('a')!.y < 30));
    expect(creatures(away)[0]).toMatchObject({ x: 4, y: 4, chasing: 'a' });
    expect(of(to(away, 'a'), 'touched')).toEqual([]);
    const last = creatures(away).at(-1)!;
    expect(w.get('a')).toMatchObject({ x: 4, y: 30 });
    // It started 6 behind, and is farther behind now.
    expect(30 - last.y).toBeGreaterThan(7);
    // Out through the way home: it lets you go, and goes back to its lair.
    const gone = run(w, 5550, 9000, t => (t >= 5600 ? 'down' : undefined));
    expect(w.get('a')!.map).toBe('town');
    const after = creatures(gone), quit = after.findIndex(c => !c.chasing);
    expect(quit).toBeGreaterThanOrEqual(0);
    expect(after.slice(quit + 1).every(c => c.dir === 'up')).toBe(true);
    expect(after.at(-1)!.y).toBeLessThan(after[quit]!.y);
  });

  it('catch you standing still: energy lost, and one bag slot dropped as your pile, to pick up again; then it stays away a while', () => {
    const w = night(rec('a', 'field', 4, 6, 'up', { bag: [{ item: 'rock', count: 2 }, { item: 'twig', count: 1 }] }));
    const out = run(w, 50, 1500);
    expect(of(to(out, 'a'), 'touched')).toEqual([{ t: 'touched', by: 'skulker', lost: 'rock' }]);
    expect(onMap(out, 'field')).toContainEqual({ t: 'creatureGone', id: 1 });
    expect(of(onMap(out, 'field'), 'drop')).toMatchObject([{ drop: { owner: 'a', x: 4, y: 6, trail: [] } }]);
    expect(w.takeWrites().drops).toMatchObject([{ owner: 'a', drop: { items: [{ item: 'rock', count: 2 }] } }]);
    expect(w.get('a')!.bag).toEqual([{ item: 'twig', count: 1 }]);
    expect(w.get('a')!.energy).toBeLessThanOrEqual(ENERGY_MAX - SKULKER_CATCH);
    expect(w.get('a')!.energy).toBeGreaterThan(ENERGY_MAX - SKULKER_CATCH - 2);
    w.pick('a', 4, 6, 1600);
    expect(w.get('a')!.bag).toEqual([{ item: 'twig', count: 1 }, { item: 'rock', count: 2 }]);
    // Away for a minute at least, however near you stand.
    expect(creatures(run(w, 1650, 50_000))).toEqual([]);
  });

  it.each([
    ['a street light', 13, { objects: [{ kind: 'lamp', x: 4, y: 14 }] as MapObject[] }],
    ['a burning fire', 13, { objects: [{ kind: 'fireplace', x: 4, y: 14 }] as MapObject[] }],
    ['the end of its range', 36, {}],
  ])('give up when you reach %s, and never follow you there', (_, stop, more) => {
    const d = data(40, more), map = new TileMap(d);
    const w = night(rec('a', 'field', 3, 9), d);
    const out = run(w, 50, 12_000, noticed(() => w.get('a')!.y < stop));
    expect(w.get('a')).toMatchObject({ x: 4, y: stop });
    expect(of(to(out, 'a'), 'touched')).toEqual([]);
    const seen = creatures(out);
    expect(seen[0]).toMatchObject({ chasing: 'a' });
    expect(seen.find(c => !c.chasing)).toBeDefined();
    for (const c of seen) expect(map.lit(c.x, c.y) || map.warm(c.x, c.y) || map.homeSteps(c.x, c.y) < 8).toBe(false);
  });

  it(`give up after ${SKULKER_CHASE_MS / 1000} seconds of chasing, and go back to its lair`, () => {
    const w = night(rec('a', 'field', 3, 9), data(150));
    const out = run(w, 50, 23_000, noticed(() => true));
    const seen = creatures(out);
    const quit = seen.findIndex(c => !c.chasing);
    expect(quit).toBeGreaterThan(0);
    // It noticed you at 800: 20 seconds later it turns back, uphill toward its lair.
    expect(seen.slice(0, quit).every(c => c.chasing === 'a' && c.dir === 'down')).toBe(true);
    expect(seen.slice(quit + 1).every(c => c.dir === 'up')).toBe(true);
    expect(quit).toBeGreaterThan((SKULKER_CHASE_MS - 1000) / SKULKER_STEP_MS);
  });

  it('knock a live shard out of your bag dim: your pile holds a plain shard, and your glow goes out', () => {
    const items: ItemsData = {
      ...ITEMS,
      items: [...ITEMS.items, { id: 'live-shard', name: 'Live shard', kind: 'resource', stack: 1, xp: 12, weight: 0.3, charge: 1, text: 'Burning.', live: { xp: 40, fresh: 240, fade: 5, into: 'shard' } }],
    };
    const w = world(data(), 'night', { items });
    w.tick(0);
    w.join(rec('a', 'field', 4, 6, 'up', { bag: [{ item: 'live-shard', count: 1, since: 0 }] }), 0);
    w.drain();
    const out = run(w, 50, 1500);
    expect(of(to(out, 'a'), 'touched')).toHaveLength(1);
    expect(onMap(out, 'field')).toContainEqual({ t: 'glow', id: 'a', on: false });
    expect(w.takeWrites().drops).toMatchObject([{ owner: 'a', drop: { items: [{ item: 'shard', count: 1 }] } }]);
  });

  it('keep off a flare: lit while one chases you, it slinks away', () => {
    const w = night(rec('a', 'field', 3, 9, 'up', { bag: [{ item: 'flare', count: 1 }] }));
    expect(creatures(run(w, 50, 900, noticed()))[0]).toMatchObject({ chasing: 'a' });
    w.use('a', 0, 950);
    expect(onMap(w.drain(), 'field')).toContainEqual({ t: 'creatureGone', id: 1 });
    expect(creatures(run(w, 1000, 20_000))).toEqual([]);
  });
});

describe('hitchhikers', () => {
  // Tall enough to be HITCH_STEPS from home: 4,1 is h - 2 steps away.
  const data = () => fieldData(HITCH_STEPS + 4, { objects: [{ kind: 'lamp', x: 7, y: 2 }] });

  it('cling to you in the dark, deep in, until you reach a light; a flare shakes them off too', () => {
    const w = world(data(), 'night', {}, rec('a', 'field', 4, 1, 'up', { bag: [{ item: 'flare', count: 1 }] }), rec('b', 'field', 4, HITCH_STEPS + 2));
    // rng 0: the first tick in the dark, deep in, is enough. b is too close to home.
    w.tick(1000);
    const heard = w.drain();
    expect(of(to(heard, 'a'), 'hitch')).toEqual([{ t: 'hitch', on: true }]);
    expect(of(to(heard, 'b'), 'hitch')).toEqual([]);
    expect(lastEnergy(heard, 'a')?.body.hitched).toBe(true);
    w.use('a', 0, 2000);
    expect(of(to(w.drain(), 'a'), 'hitch')).toEqual([{ t: 'hitch', on: false }]);
    // Near its flare, nothing clings to you.
    w.tick(3000);
    expect(of(to(w.drain(), 'a'), 'hitch')).toEqual([]);
  });

  it('never cling in daylight', () => {
    const w = world(data(), 'overcast', {}, rec('a', 'field', 4, 1));
    w.tick(60_000);
    expect(of(to(w.drain(), 'a'), 'hitch')).toEqual([]);
  });
});

describe('marks', () => {
  it('paint an arrow where you stand, pointing where you face, for everyone on the map, for a day', () => {
    const w = world(fieldData(), 'overcast', {}, rec('a', 'field', 3, 5, 'left', { bag: [{ item: 'cap', count: 3 }] }), rec('b', 'field', 6, 6));
    w.use('a', 0, 1000);
    const mark = { id: 1, x: 3, y: 5, dir: 'left', color: colorFor('a'), name: 'A', until: 1000 + MARK_LIFETIME_MS };
    const heard = w.drain();
    expect(onMap(heard, 'field')).toContainEqual({ t: 'mark', mark });
    expect(of(to(heard, 'a'), 'bag').at(-1)).toEqual({ t: 'bag', bag: [{ item: 'cap', count: 2 }] });
    expect(w.takeWrites().marks).toEqual([{ id: 1, mark: { id: 1, owner: 'a', name: 'A', color: colorFor('a'), map: 'field', x: 3, y: 5, dir: 'left', placedAt: 1000 } }]);
    // One per tile.
    w.use('a', 0, 2000);
    expect(of(to(w.drain(), 'a'), 'refused')).toEqual([{ t: 'refused', action: 'use', reason: 'marked' }]);
    w.tick(1000 + MARK_LIFETIME_MS);
    expect(onMap(w.drain(), 'field')).toContainEqual({ t: 'markGone', id: 1 });
    expect(w.takeWrites().marks).toEqual([{ id: 1, mark: undefined }]);
  });

  it('are never painted indoors; a player keeps only the newest few', () => {
    const w = world(fieldData(), 'overcast', {}, rec('a', 'field', 1, 1, 'right', { bag: [{ item: 'cap', count: 20 }] }), rec('h', 'house', 2, 2, 'up', { bag: [{ item: 'cap', count: 1 }] }));
    w.use('h', 0, 0);
    expect(of(to(w.drain(), 'h'), 'refused')).toEqual([{ t: 'refused', action: 'use', reason: 'not_here' }]);
    for (let i = 0; i < MARKS_PER_PLAYER + 1; i++) {
      w.use('a', 0, i * 1000);
      w.step('a', 'right', i + 1, i * 1000 + 1);
    }
    const marks = w.scene('field', 10_000).marks;
    expect(marks).toHaveLength(MARKS_PER_PLAYER);
    expect(marks.map(m => m.x)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it('come back after a restart, and new ones get new ids', () => {
    const saved: MarkRecord = { id: 41, owner: 'z', name: 'Z', color: '#fff', map: 'field', x: 2, y: 2, dir: 'up', placedAt: 0 };
    const w = world(fieldData(), 'overcast', { marks: [saved, { ...saved, id: 42, map: 'gone' }] }, rec('a', 'field', 5, 5, 'up', { bag: [{ item: 'cap', count: 1 }] }));
    expect(w.scene('field', 0).marks.map(m => m.id)).toEqual([41]);
    w.use('a', 0, 0);
    expect(w.scene('field', 0).marks.map(m => m.id)).toEqual([41, 42]);
  });
});

describe('strange objects, charms and feats', () => {
  it('turn into what they are only in town, where there is light and a table', () => {
    const w = world(fieldData(), 'overcast', {}, rec('out', 'field', 4, 5, 'up', { bag: [{ item: 'odd', count: 1 }] }), rec('in', 'house', 2, 3, 'up', { bag: [{ item: 'odd', count: 1 }] }));
    w.use('out', 0, 0);
    expect(of(to(w.drain(), 'out'), 'refused')).toEqual([{ t: 'refused', action: 'use', reason: 'not_here' }]);
    w.use('in', 0, 0);
    const heard = to(w.drain(), 'in');
    expect(of(heard, 'got')).toEqual([{ t: 'got', items: [{ item: 'feather', count: 1 }], from: 'identify' }]);
    expect(of(heard, 'bag').at(-1)).toEqual({ t: 'bag', bag: [{ item: 'feather', count: 1 }] });
  });

  it('earn a feat for good once its count is reached, and tell the player', () => {
    const rain = FEATS.find(f => f.id === 'rain-walker')!;
    const w = world(fieldData(), 'rain', {}, rec('a', 'field', 1, 5, 'right', { stats: { rainSteps: rain.need - 1 } }));
    w.step('a', 'right', 1, 1000);
    expect(of(to(w.drain(), 'a'), 'feat')).toEqual([{ t: 'feat', id: 'rain-walker', stats: { rainSteps: rain.need } }]);
    expect(w.takeWrites().players.map(p => p.stats)).toEqual([{ rainSteps: rain.need }]);
    // Rain soaks a rain walker 20% slower, from now on.
    w.step('a', 'right', 2, 1200);
    w.tick(1400);
    expect(w.get('a')!.stats).toEqual({ rainSteps: rain.need + 1 });
  });

  it('change the rates the moment they are earned', () => {
    const rain = FEATS.find(f => f.id === 'rain-walker')!;
    const w = world(fieldData(), 'rain', {}, rec('a', 'field', 1, 5, 'right', { stats: { rainSteps: rain.need - 1 } }));
    w.step('a', 'right', 1, 1000);
    expect(lastEnergy(w.drain(), 'a')?.body.wetRate).toBe(Math.round((0.8 / WET_SECONDS) * 1e5) / 1e5);
  });
});

describe('echoes and the notice board', () => {
  it('a pile keeps the last steps its owner walked out there', () => {
    const w = world(fieldData(40), 'overcast', {}, rec('a', 'field', 1, 30, 'up', { energy: 3, bag: [{ item: 'rock', count: 1 }] }));
    for (let i = 0; i < TRAIL_STEPS + 4; i++) w.step('a', i % 2 ? 'up' : 'right', i + 1, i * 200);
    w.tick(60_000);
    const drop = w.dropViews('field')[0]!;
    expect(drop.trail).toHaveLength(TRAIL_STEPS);
    expect(drop.trail.at(-1)).toEqual([drop.x, drop.y]);
  });

  it('the board tells the weather, the surges, the fires, the collapses and the Old Stone', () => {
    const surge = { every: 100, unstable: 20, surge: 20, sweep: 10 };
    const w = world(fieldData(12, { surge, objects: [{ kind: 'fireplace', x: 4, y: 4 }] }), 'rain', {}, rec('a', 'town', 0, 5));
    w.board('a', 0, 4, (FIRE_MAX_S / 2 + 1) * 1000);
    const lines = of(to(w.drain(), 'a'), 'board')[0]!.lines;
    expect(lines).toEqual([
      'Rain.',
      expect.stringMatching(/^The Field: /),
      'Gone out: the campfire in the Field. Bring something that burns.',
      'Nobody collapsed in the last hour.',
      'The Old Stone sleeps. 0 of 20 shards fed.',
    ]);
    // Only next to a board.
    w.board('a', 0, 0, 0);
    expect(w.drain()).toEqual([]);
  });
});

describe('the day', () => {
  it('follows the wall clock when the weather cycles, and aurora nights grow their own finds', () => {
    const items: ItemsData = { ...ITEMS, finds: [{ item: 'shard', map: 'field', count: 1, respawn: [5, 5], when: 'aurora' }] };
    // Find an aurora in the first days of the epoch.
    let t = 0;
    while (weatherAt(t).weather !== 'aurora') t += 60_000;
    const w = world(fieldData(), 'overcast', { items, cycle: true }, rec('a', 'field', 4, 5));
    w.tick(t - 60_000);
    w.drain();
    expect(w.findViews('field')).toEqual([]);
    w.tick(t + 1);
    const heard = w.drain();
    // Hours went by: the player collapsed long ago and is at home, where the sky is the same.
    expect(onMap(heard, 'town')).toContainEqual({ t: 'weather', weather: 'aurora' });
    expect(w.findViews('field')).toHaveLength(1);
  });
});

describe('what the woods are like today', () => {
  const DAY_MS = DAY_S * 1000;
  const day = (id: string, more: Partial<ConditionDef> = {}): ConditionDef => ({ id, name: `The ${id}`, text: `The ${id} today.`, weight: 1, map: 'field', ...more });
  /** The first dawn from day 20000 on whose day before, day and day after draw as asked. */
  const dawnWhere = (data: ConditionsData, ok: (before: string[], today: string[], after: string[]) => boolean): number => {
    for (let d = 20_000; ; d++) {
      const at = d * DAY_MS;
      if (ok(conditionsAt(data, at - 1).today, conditionsAt(data, at).today, conditionsAt(data, at + DAY_MS).today)) return at;
    }
  };
  /** Rooms off the field: a hut whose fire burns down, and the old cabin, whose fire is tended. */
  const room = (id: string, x: number, tended: boolean): MapData => ({
    ...houseData(), id, name: id === 'hut' ? 'The hut' : 'The old cabin',
    exits: [{ x: 2, y: 4, w: 1, h: 1, to: 'field', tx: x, ty: 2, dir: 'down' }],
    objects: [{ kind: 'fireplace', x: 2, y: 1, ...(tended && { tended: true }) }],
  });
  const withShelters = () => fieldData(12, {
    exits: [
      { x: 4, y: 11, w: 1, h: 1, to: 'town', tx: 4, ty: 1, dir: 'down', home: true },
      { x: 1, y: 1, w: 1, h: 1, to: 'hut', tx: 2, ty: 3, dir: 'up' },
      { x: 7, y: 1, w: 1, h: 1, to: 'cabin', tx: 2, ty: 3, dir: 'up' },
    ],
    objects: [{ kind: 'fireplace', x: 4, y: 4 }, { kind: 'fireplace', x: 6, y: 6, tended: true }],
  });
  const shelterWorld = (conditions: ConditionsData, epochOffset: number) => new World(
    [new TileMap(townWithStone()), new TileMap(withShelters()), new TileMap(room('hut', 1, false)), new TileMap(room('cabin', 7, true)), ...fixtureMaps().filter(m => m.data.id !== 'town')],
    'town', 'overcast', { items: { ...ITEMS, conditions }, rng: () => 0, epochOffset },
  );
  const fires = (w: World, now: number) => ['field', 'hut', 'cabin'].flatMap(m => w.scene(m, now).fires.map(f => ({ map: m, ...f })));

  it('condition finds grow at dawn, are first come first served all day, and go at the next dawn', () => {
    const conditions: ConditionsData = { seed: 3, second: 0, daily: [day('drop'), day('calm')], weekly: [] };
    const items: ItemsData = { ...ITEMS, finds: [{ item: 'rock', map: 'field', around: { x: 4, y: 5, r: 1 }, count: 3, respawn: [86_400, 86_400], condition: 'drop' }], conditions };
    const dawn = dawnWhere(conditions, (b, t, a) => b[0] === 'calm' && t[0] === 'drop' && a[0] === 'calm');
    const w = world(fieldData(12), 'overcast', { items, epochOffset: dawn - 1000 }, rec('a', 'field', 4, 5));
    w.tick(0);
    expect(w.scene('field', 0).finds).toEqual([]);
    // The first tick after start-up tells nobody: the welcome said it.
    expect(of(to(w.drain(), 'a'), 'conditions')).toEqual([]);
    w.tick(1000);
    const out = w.drain();
    expect(of(to(out, 'a'), 'conditions')).toEqual([{ t: 'conditions', conditions: { today: ['drop'], week: null, next: null } }]);
    expect(of(onMap(out, 'field'), 'find')).toHaveLength(3);
    const first = w.scene('field', 1000).finds[0]!;
    w.pick('a', first.x, first.y, 2000);
    expect(w.get('a')!.bag).toEqual([{ item: 'rock', count: 1 }]);
    w.leave('a', 2000);
    w.drain();
    // Taken is taken: nothing grows back that day.
    for (let t = 60_000; t < DAY_MS; t += 60_000) w.tick(t);
    expect(w.scene('field', DAY_MS).finds).toHaveLength(2);
    w.tick(DAY_MS + 1000);
    expect(w.scene('field', DAY_MS + 1000).finds).toEqual([]);
    expect(of(onMap(w.drain(), 'field'), 'findGone')).toHaveLength(2);
  });

  it('a fire goes out overnight: exactly one that burns down, never the old cabin\'s, and not when a world starts mid-day', () => {
    const conditions: ConditionsData = { seed: 1, second: 0, daily: [day('out', { fireOut: true })], weekly: [] };
    const dawn = 20_000 * DAY_MS;
    const w = shelterWorld(conditions, dawn - 1000);
    w.tick(0);
    expect(fires(w, 0).filter(f => f.left === 0)).toEqual([]);
    w.tick(1000);
    const out = fires(w, 1000).filter(f => f.left === 0);
    expect(out).toHaveLength(1);
    expect(out[0]!.map).not.toBe('cabin');
    expect(fires(w, 1000).filter(f => f.left === null)).toEqual([{ map: 'field', x: 6, y: 6, left: null }, { map: 'cabin', x: 2, y: 1, left: null }]);
    expect(onMap(w.drain(), out[0]!.map)).toContainEqual({ t: 'fire', fire: { x: out[0]!.x, y: out[0]!.y, left: 0 } });
    // A restart in the middle of that day puts no fire out again.
    const again = shelterWorld(conditions, dawn + 10 * 60_000);
    again.tick(0);
    again.tick(60_000);
    expect(fires(again, 60_000).filter(f => f.left === 0)).toEqual([]);
  });

  it('quiet woods keep the watchers asleep all week, and send away one that was out', () => {
    const conditions: ConditionsData = { seed: 1, second: 0, daily: [day('calm')], weekly: [day('loud'), day('quiet', { watchers: { asleep: true } })] };
    let monday = Date.UTC(2026, 8, 28);
    while (conditionsAt(conditions, monday).week !== 'quiet') monday += 7 * 86_400_000;
    const w = world(fieldData(12, { watchers: { count: 1, steps: [8, 99] } }), 'overcast', { items: { ...ITEMS, conditions }, epochOffset: monday - 1000 }, rec('a', 'field', 7, 10, 'down'));
    w.tick(0);
    expect(w.scene('field', 0).creatures).toHaveLength(1);
    w.drain();
    w.tick(1000);
    expect(of(onMap(w.drain(), 'field'), 'creatureGone')).toHaveLength(1);
    for (let t = 2000; t < 600_000; t += WATCHER_STEP_MS) w.tick(t);
    expect(of(onMap(w.drain(), 'field'), 'creature')).toEqual([]);
    expect(w.scene('field', 600_000).creatures).toEqual([]);
  });

  it('the watchers moved north: they wake only 80 or more steps from home', () => {
    const { maps } = loadMaps(resolve(import.meta.dirname, '../../../content/maps'), 'stonebrook');
    const content = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/items.json'), 'utf8')) as ItemsData;
    const north = content.conditions!.daily.find(c => c.id === 'watchers-north')!;
    const conditions: ConditionsData = { seed: 5, second: 0, daily: [{ ...north, id: 'calm', watchers: undefined }, north], weekly: [] };
    const dawn = dawnWhere(conditions, (b, t) => b[0] === 'calm' && t[0] === 'watchers-north');
    const woods = maps.get('near-woods')!;
    expect(woods.lairs([55, 79]).length).toBeGreaterThan(0);
    const w = new World(maps.values(), 'stonebrook', 'overcast', { items: { ...content, conditions }, rng: seeded(11), epochOffset: dawn - 1000 });
    // Skulkers share the map (and come out in its storms); the condition only moves the watchers.
    const steps = (now: number) => w.scene('near-woods', now).creatures.filter(c => c.kind === 'watcher').map(c => woods.homeSteps(c.x, c.y));
    w.tick(0);
    expect(steps(0)).toHaveLength(3);
    w.drain();
    // After dawn, wherever they wake, it is far in.
    const seen: number[] = [];
    for (let t = 1000; t < 1000 + 30 * 60_000; t += 10_000) {
      w.tick(t);
      for (const m of of(onMap(w.drain(), 'near-woods'), 'creature')) if (m.creature.kind === 'watcher') seen.push(woods.homeSteps(m.creature.x, m.creature.y));
      seen.push(...steps(t));
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(80);
  });

  it('the notice board says today\'s, this week\'s and next week\'s', () => {
    const conditions: ConditionsData = {
      seed: 1, second: 0,
      daily: [day('fog', { name: 'Thick fog', text: 'You will not see far.', fog: 5 })],
      weekly: [day('copper', { name: 'Copper week', text: 'Wire by every pole, all week.' }), day('quiet', { name: 'Quiet woods', text: 'The watchers sleep all week.' })],
    };
    const now = 20_000 * DAY_MS;
    const view = conditionsAt(conditions, now);
    const [week, next] = view.week === 'copper' ? ['copper week. Wire by every pole, all week.', 'quiet woods'] : ['quiet woods. The watchers sleep all week.', 'copper week'];
    const w = world(fieldData(12), 'rain', { items: { ...ITEMS, conditions }, epochOffset: now }, rec('a', 'town', 0, 5));
    w.board('a', 0, 4, 0);
    expect(of(to(w.drain(), 'a'), 'board')[0]!.lines.slice(0, 4)).toEqual([
      'Rain.',
      'Today in the Field: thick fog.',
      'You will not see far.',
      `This week: ${week} Next week: ${next}.`,
    ]);
    // And the welcome carries them.
    expect(w.join(rec('b', 'town', 1, 5), 0).conditions).toEqual(view);
  });
});
