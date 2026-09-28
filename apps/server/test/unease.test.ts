/**
 * Unease on the World (unease.ts): what hurries it (a watcher in sight, a flash near you), and what ends
 * it besides company, light, fire and a flare, which net-unease.test.ts tries over real WebSockets: a
 * collapse, daylight, and walking home. The field is open grass in the wilds, walled in by forest, the way
 * home in the middle of its bottom row.
 */
import { describe, expect, it } from 'vitest';
import { ENERGY_MAX, TileMap, UNEASE_BUILD_S, UNEASE_CALM_S, UNEASE_LEVELS, type Dir, type MapData, type Weather } from '@napoland/shared';
import type { PlayerRecord } from '../src/storage';
import { World, colorFor, type Outgoing, type WorldOptions } from '../src/world';
import { fixtureMaps } from './fixtures';

/** A field 12 tall (8 wide inside the forest), its way home at 4,11. */
function fieldData(more: Partial<MapData> = {}): MapData {
  const h = 12, tiles = Array.from({ length: h }, (_, y) => (y === 0 ? 'tttttttttt' : y === h - 1 ? 'ttttgttttt' : 'tggggggggt'));
  return {
    id: 'field', name: 'The Field', version: 1, kind: 'wilds', depth: 1, width: 10, height: h,
    tiles, levels: Array<string>(h).fill('0000000000'),
    spawn: { x: 4, y: h - 2, dir: 'up' },
    exits: [{ x: 4, y: h - 1, w: 1, h: 1, to: 'town', tx: 4, ty: 1, dir: 'down', home: true }],
    objects: [],
    ...more,
  };
}

const rec = (id: string, x: number, y: number, dir: Dir = 'up'): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map: 'field', x, y, dir, color: colorFor(id), energy: ENERGY_MAX, bag: [], createdAt: 1, lastSeenAt: 1,
});

/** A world of the fixture town, house and woods and `field`, with dice that always roll 0; everyone joins at 0. */
function world(field: MapData, weather: Weather, options: WorldOptions = {}, ...players: PlayerRecord[]): World {
  const w = new World([...fixtureMaps(), new TileMap(field)], 'town', weather, { rng: () => 0, ...options });
  for (const p of players) w.join(p, 0);
  w.drain();
  return w;
}

/** The levels of unease `id` heard, in order. */
const heard = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id && o.msg.t === 'unease' ? [o.msg.level] : []));

describe('unease', () => {
  it('builds twice as fast with a watcher in sight, even one held still by your look', () => {
    // With these dice the watcher wakes at 1,1: within sight of a (at 4,6, facing it, so it holds still), far from b.
    const w = world(fieldData({ watchers: { count: 1, steps: [12, 99] } }), 'night', {}, rec('a', 4, 6), rec('b', 8, 10));
    w.tick(0);
    expect(w.scene('field', 0).creatures).toEqual([expect.objectContaining({ kind: 'watcher', x: 1, y: 1 })]);
    w.drain();
    w.tick((UNEASE_BUILD_S / UNEASE_LEVELS) * 1000);
    const out = w.drain();
    expect([heard(out, 'a'), heard(out, 'b')]).toEqual([[2], [1]]);
  });

  it('builds twice as fast for a while after a flash starts near you', () => {
    // A flash every 30 s near whoever is out there: with these dice at 1,1, next to a; b is far from it.
    const w = world(fieldData({ flashes: { every: 30, steps: [0, 99] } }), 'night', {}, rec('a', 2, 2), rec('b', 7, 9));
    w.tick(0);
    w.tick(29_999);
    w.tick(30_000);
    expect(w.scene('field', 30_000).flashes).toEqual([expect.objectContaining({ x: 1, y: 1 })]);
    w.drain();
    w.tick(30_000 + (UNEASE_BUILD_S / UNEASE_LEVELS) * 1000);
    const out = w.drain();
    // a: a sixth, then half more; b: a sixth, then a quarter.
    expect([heard(out, 'a'), heard(out, 'b')]).toEqual([[2], [1]]);
  });

  it('is gone when you collapse: you wake up at home, by your fire', () => {
    const w = world(fieldData(), 'night', {}, rec('a', 4, 6));
    w.tick(UNEASE_BUILD_S * 1000);
    expect(heard(w.drain(), 'a')).toEqual([UNEASE_LEVELS]);
    // Out there long enough to run out.
    w.tick((UNEASE_BUILD_S + 200) * 1000);
    const out = w.drain();
    expect(out.some(o => o.to === 'a' && o.msg.t === 'zone' && o.msg.reason === 'collapse')).toBe(true);
    expect(heard(out, 'a')).toEqual([0]);
  });

  it('lifts in town, and by day', () => {
    // Far apart, each alone in the dark: b one step from the way home.
    const w = world(fieldData(), 'night', {}, rec('a', 1, 2), rec('b', 4, 10, 'down'));
    let t = UNEASE_BUILD_S * 1000;
    w.tick(t);
    let out = w.drain();
    expect([heard(out, 'a'), heard(out, 'b')]).toEqual([[UNEASE_LEVELS], [UNEASE_LEVELS]]);
    // b walks home: onto the way out, into town. The night goes on out there.
    w.step('b', 'down', 1, t);
    expect(w.get('b')!.map).toBe('town');
    w.tick((t += UNEASE_CALM_S * 1000));
    out = w.drain();
    expect([heard(out, 'a'), heard(out, 'b')]).toEqual([[], [0]]);
    w.setWeather('overcast', t);
    w.tick((t += UNEASE_CALM_S * 1000));
    expect(heard(w.drain(), 'a')).toEqual([0]);
  });
});
