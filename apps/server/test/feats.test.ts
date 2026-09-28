/**
 * Feats with ranks, as the World counts and applies them: a new rank told once and saved at once,
 * counts kept from before ranks worth their rank the moment a player joins, and what the three newer
 * feats do: the mender's gear wears slower, the forager's finds come up double, the pathfinder's drain
 * is gentler far from home. World rules only; net-feats.test.ts runs them over real WebSockets.
 */
import { describe, expect, it } from 'vitest';
import { ENERGY_MAX, ENERGY_SYNC_MS, FAR_STEPS, TileMap, WET_SECONDS, energyRate, type Dir, type ServerMsg } from '@napoland/shared';
import type { PlayerRecord } from '../src/storage';
import { World, colorFor, type Outgoing } from '../src/world';
import { COAT, corridorData, featItems, featMaps } from './fixtures-feats';

const rec = (id: string, map: string, x: number, y: number, dir: Dir = 'up', more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map, x, y, dir, color: colorFor(id), energy: ENERGY_MAX, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});
/** The town, the house with a workbench, the woods and the long trail (fixtures-feats.ts); players join at 0, and what they heard is drained. */
function world(weather: 'overcast' | 'rain', rng: () => number, ...players: PlayerRecord[]): World {
  const w = new World(featMaps(), 'town', weather, { items: featItems(), rng });
  for (const p of players) w.join(p, 0);
  w.drain();
  w.takeWrites();
  return w;
}
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id || o.to === 'all' ? [o.msg] : []));
const of = <T extends ServerMsg['t']>(msgs: ServerMsg[], t: T) => msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
const lastEnergy = (out: Outgoing[], id: string) => of(to(out, id), 'energy').at(-1);
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const long = new TileMap(corridorData());

describe('ranks', () => {
  it('are told once, saved at once, and change the rates at once', () => {
    const w = world('rain', () => 0.5, rec('a', 'long', 1, 60, 'up', { stats: { rainSteps: 4_999 } }));
    w.step('a', 'up', 1, 1000);
    const out = w.drain();
    expect(of(to(out, 'a'), 'feat')).toEqual([{ t: 'feat', id: 'rain-walker', rank: 2, stats: { rainSteps: 5_000 } }]);
    // Rank 2: rain soaks you 30% slower.
    expect(lastEnergy(out, 'a')?.body.wetRate).toBe(Math.round((0.7 / WET_SECONDS) * 1e5) / 1e5);
    expect(w.takeWrites().players.map(p => p.stats)).toEqual([{ rainSteps: 5_000 }]);
    for (let i = 2; i < 12; i++) w.step('a', 'up', i, 1000 + (i - 1) * 200);
    expect(of(to(w.drain(), 'a'), 'feat')).toEqual([]);
    expect(w.takeWrites().players).toEqual([]);
    expect(w.get('a')!.stats).toEqual({ rainSteps: 5_010 });
  });

  it('come from counts kept from before ranks the moment a player joins, without a word', () => {
    const w = world('rain', () => 0.5);
    const joined = w.join(rec('old', 'long', 1, 60, 'up', { stats: { rainSteps: 100_000, fed: 30 } }), 0);
    expect(joined.stats).toEqual({ rainSteps: 100_000, fed: 30 });
    // The top rank of the rain walker, at once: rain soaks them 50% slower.
    expect(joined.body.wetRate).toBe(Math.round((0.5 / WET_SECONDS) * 1e5) / 1e5);
    expect(w.drain().filter(o => o.msg.t === 'feat')).toEqual([]);
  });

  it('count the pack mule by what the bag really weighs, however light its ranks make it feel', () => {
    // 8 kg is heavy (a load of 0.8); at the top rank it feels 30% lighter (0.56), under HEAVY_LOAD.
    const w = world('overcast', () => 0.5, rec('a', 'long', 1, 60, 'up', { bag: [{ item: 'anvil', count: 1 }], stats: { heavySteps: 50_000 } }));
    w.step('a', 'up', 1, 1000);
    w.drain();
    expect(w.get('a')!.stats).toEqual({ heavySteps: 50_001 });
  });

  it('are what the status panel asks for: the counts as they are now', () => {
    const w = world('rain', () => 0.5, rec('a', 'long', 1, 60, 'up', { stats: { rainSteps: 7, mended: 2 } }));
    w.step('a', 'up', 1, 1000);
    w.drain();
    w.stats('a');
    expect(to(w.drain(), 'a')).toEqual([{ t: 'stats', stats: { rainSteps: 8, mended: 2 } }]);
    w.stats('nobody');
    expect(w.drain()).toEqual([]);
  });
});

describe('the mender', () => {
  it('counts every piece mended at the workbench', () => {
    const w = world('overcast', () => 0.5, rec('a', 'house', 1, 2, 'up', { gear: COAT, worn: { shirt: { cond: 0.3 } }, stash: { items: { cloth: 4 }, out: {} }, stats: { mended: 4 } }));
    w.mend('a', 1, 1, 'shirt', 1000);
    expect(of(to(w.drain(), 'a'), 'feat')).toEqual([{ t: 'feat', id: 'mender', rank: 1, stats: { mended: 5 } }]);
    // Already whole: nothing mended, nothing counted.
    w.mend('a', 1, 1, 'shirt', 1000);
    expect(w.get('a')!.stats).toEqual({ mended: 5 });
  });

  it('wears gear slower out in the wilds, by the rank reached', () => {
    const w = world('overcast', () => 0.5,
      rec('plain', 'long', 1, 60, 'up', { gear: COAT }), rec('one', 'long', 1, 61, 'up', { gear: COAT, stats: { mended: 5 } }), rec('top', 'long', 1, 62, 'up', { gear: COAT, stats: { mended: 250 } }));
    w.tick(50_000);
    // 100 s of the wilds wear a sturdy piece out: half of it in 50 s, 5% less at rank 1, 25% less at rank 5.
    expect(w.get('plain')!.worn!.shirt!.cond).toBeCloseTo(0.5, 5);
    expect(w.get('one')!.worn!.shirt!.cond).toBeCloseTo(1 - 0.5 * 0.95, 5);
    expect(w.get('top')!.worn!.shirt!.cond).toBeCloseTo(1 - 0.5 * 0.75, 5);
  });
});

describe('the forager', () => {
  it('finds double out in the wilds when the dice say so, and counts every find picked up there', () => {
    const lucky = world('overcast', () => 0, rec('a', 'long', 1, 50, 'up', { stats: { found: 200 } }));
    lucky.pick('a', 1, 50, 1000);
    const out = to(lucky.drain(), 'a');
    expect(of(out, 'got')).toEqual([{ t: 'got', items: [{ item: 'moss', count: 2 }], from: 'find', double: true }]);
    expect(lucky.get('a')).toMatchObject({ bag: [{ item: 'moss', count: 2 }], stats: { found: 201 } });
    // Rank 1 is 5%: a roll of a half never comes up.
    const plain = world('overcast', () => 0.5, rec('a', 'long', 1, 50, 'up', { stats: { found: 200 } }));
    plain.pick('a', 1, 50, 1000);
    expect(of(to(plain.drain(), 'a'), 'got')).toEqual([{ t: 'got', items: [{ item: 'moss', count: 1 }], from: 'find' }]);
    expect(plain.get('a')!.stats).toEqual({ found: 201 });
  });

  it('never doubles without a rank, nor the pick that reaches rank 1, which is told', () => {
    const w = world('overcast', () => 0, rec('a', 'long', 1, 50, 'up', { stats: { found: 199 } }), rec('b', 'long', 1, 51, 'up'));
    w.pick('a', 1, 50, 1000);
    const out = to(w.drain(), 'a');
    expect(of(out, 'got')).toEqual([{ t: 'got', items: [{ item: 'moss', count: 1 }], from: 'find' }]);
    expect(of(out, 'feat')).toEqual([{ t: 'feat', id: 'forager', rank: 1, stats: { found: 200 } }]);
    w.tick(2000);
    w.pick('b', 1, 50, 2000);
    expect(of(to(w.drain(), 'b'), 'got')).toEqual([{ t: 'got', items: [{ item: 'moss', count: 1 }], from: 'find' }]);
  });

  it('gives the second only if it fits, and never doubles a live find', () => {
    const nails = Array.from({ length: 7 }, () => ({ item: 'nail', count: 5 }));
    const w = world('overcast', () => 0, rec('a', 'long', 1, 50, 'up', { stats: { found: 12_000 }, bag: [...nails, { item: 'moss', count: 2 }] }), rec('b', 'long', 1, 40, 'up', { stats: { found: 12_000 } }));
    w.pick('a', 1, 50, 1000);
    expect(of(to(w.drain(), 'a'), 'got')).toEqual([{ t: 'got', items: [{ item: 'moss', count: 1 }], from: 'find' }]);
    expect(w.get('a')!.bag.at(-1)).toEqual({ item: 'moss', count: 3 });
    w.pick('b', 1, 40, 1000);
    expect(of(to(w.drain(), 'b'), 'got')).toEqual([{ t: 'got', items: [{ item: 'live-shard', count: 1 }], from: 'find' }]);
    expect(w.get('b')!.bag).toEqual([{ item: 'live-shard', count: 1, since: 1000 }]);
    expect(w.get('b')!.stats).toEqual({ found: 12_001 });
  });

  it('neither counts nor doubles a find in town', () => {
    const w = world('overcast', () => 0, rec('a', 'town', 0, 4, 'down', { stats: { found: 700 } }));
    w.pick('a', 0, 5, 1000);
    expect(of(to(w.drain(), 'a'), 'got')).toEqual([{ t: 'got', items: [{ item: 'nail', count: 1 }], from: 'find' }]);
    expect(w.get('a')!.stats).toEqual({ found: 700 });
  });
});

describe('the pathfinder', () => {
  it(`counts only steps ${FAR_STEPS} or more from home, and drains more gently only there`, () => {
    // 1,15 is 84 steps from home, 1,14 is 85.
    const w = world('overcast', () => 0.5, rec('a', 'long', 1, 15, 'up', { stats: { farSteps: 499 } }));
    w.step('a', 'up', 1, 1000);
    const out = w.drain();
    expect(of(to(out, 'a'), 'feat')).toEqual([{ t: 'feat', id: 'pathfinder', rank: 1, stats: { farSteps: 500 } }]);
    expect(lastEnergy(out, 'a')?.energy.rate).toBe(r3(energyRate(long, 1, 14, 'overcast', { farDrain: 0.97 })));
    w.step('a', 'down', 2, 1200);
    w.tick(1200 + ENERGY_SYNC_MS);
    expect(lastEnergy(w.drain(), 'a')?.energy.rate).toBe(r3(energyRate(long, 1, 15, 'overcast')));
    expect(w.get('a')!.stats).toEqual({ farSteps: 500 });
  });
});
