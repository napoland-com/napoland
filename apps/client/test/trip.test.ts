/**
 * How the trip went, in words (trip.ts): where a landmark says you fell, on the real maps, and the card.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TileMap, type MapData, type TripView } from '@napoland/shared';
import { landmarkOf, the, tripCard } from '../src/trip';

const load = (id: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../content/maps/${id}.json`), 'utf8')) as MapData;
const woods = new TileMap(load('near-woods')), south = new TileMap(load('south-road'));
const dataOf = (id: string) => {
  try {
    return load(id);
  } catch {
    return undefined;
  }
};
/** The walkable tile nearest x,y (by straight distance), for standing by a place that may be water. */
const nearest = (map: TileMap, x: number, y: number) => {
  let best: { x: number; y: number } | null = null, d = Infinity;
  for (let yy = y - 4; yy <= y + 4; yy++) for (let xx = x - 4; xx <= x + 4; xx++) {
    const dd = Math.hypot(xx - x, yy - y);
    if (map.walkable(xx, yy) && dd < d) { d = dd; best = { x: xx, y: yy }; }
  }
  return best!;
};
const place = (map: TileMap, name: string) => map.data.places!.find(p => p.name === name)!;

describe('landmarkOf', () => {
  it('names the pond, a cabin and the road in the Near Woods', () => {
    const pond = place(woods, 'pond'), by = nearest(woods, pond.x, pond.y);
    expect(landmarkOf(woods, by.x, by.y, dataOf)).toMatch(/^by the pond\b/);
    const hut = woods.data.exits.find(e => e.to === 'near-woods-ranger-hut')!, door = nearest(woods, hut.x, hut.y + 1);
    expect(landmarkOf(woods, door.x, door.y, dataOf)).toMatch(/^by the ranger's hut\b/);
    const road: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < woods.height; y++) for (let x = 0; x < woods.width; x++) if (woods.kind(x, y) === 'road') road.push({ x, y });
    expect(road.some(t => landmarkOf(woods, t.x, t.y, dataOf) === 'by the road')).toBe(true);
  });

  it('counts the steps, walking, to a landmark farther off, and says the nearest door when right by something', () => {
    const pond = place(woods, 'pond'), by = nearest(woods, pond.x, pond.y);
    // Right by the pond: how far the nearest cabin is, to find the way back to what you dropped.
    expect(landmarkOf(woods, by.x, by.y, dataOf)).toMatch(/^by the pond, \d+ steps from the (old cabin|ranger's hut|cabin at the end)$/);
    const far = landmarkOf(woods, by.x, by.y - 6, dataOf);
    expect(far).toMatch(/^(by|\d+ steps from) /);
  });

  it('names the sinks on the South Road, never a pond', () => {
    const sinks = place(south, 'the sinks'), by = nearest(south, sinks.x, sinks.y);
    expect(landmarkOf(south, by.x, by.y, dataOf)).toMatch(/^by the sinks\b/);
    for (let y = 1; y < south.height; y += 9) for (let x = 1; x < south.width; x += 9) {
      if (south.walkable(x, y)) expect(landmarkOf(south, x, y, dataOf)).not.toMatch(/pond/);
    }
  });

  it('says deep in the region when nothing is near', () => {
    const d = load('near-woods');
    const bare = new TileMap({ ...d, exits: d.exits.filter(e => e.home), places: [], objects: [], tiles: d.tiles.map(r => r.replace(/r/g, 'g')) });
    const home = d.exits.find(e => e.home)!;
    // Far from the way home: nothing within 40 steps.
    let t = { x: 0, y: 0 };
    for (let y = 0; y < bare.height && !t.x; y++) for (let x = 0; x < bare.width; x++) if (bare.walkable(x, y) && Math.abs(x - home.x) + Math.abs(y - home.y) > 90) { t = { x, y }; break; }
    expect(landmarkOf(bare, t.x, t.y, dataOf)).toBe('deep in the Near Woods');
  });
});

describe('tripCard', () => {
  const trip = (more: Partial<TripView> = {}): TripView => ({
    minutes: 11, steps: 412, deepest: { map: 'near-woods', steps: 96 }, xp: 47, lowest: 18, caught: { storms: 1, flashes: 2, surges: 0 }, fell: null, best: ['deepest'], ...more,
  });
  const mapOf = (id: string) => (id === 'near-woods' ? woods : id === 'south-road' ? south : undefined);

  it('says how a trip home went', () => {
    expect(tripCard(trip(), mapOf)).toEqual({
      title: 'Home after 11 minutes',
      lines: ['412 steps · as deep as the Near Woods, 96 steps out', 'Lowest energy: 18 · Bag worth 47 XP', 'Caught in a storm and 2 flashes', 'Your farthest trip yet'],
    });
  });

  it('counts one and many, and says when nothing caught you', () => {
    const lines = (caught: TripView['caught']) => tripCard(trip({ caught }), mapOf).lines[2];
    expect(lines({ storms: 2, flashes: 1, surges: 1 })).toBe('Caught in 2 storms, a flash and a surge');
    expect(lines({ storms: 0, flashes: 0, surges: 3 })).toBe('Caught in 3 surges');
    expect(lines({ storms: 0, flashes: 0, surges: 0 })).toBe('Nothing caught you out there');
    expect(tripCard(trip({ minutes: 1 }), mapOf).title).toBe('Home after 1 minute');
  });

  it('says every best beaten, and none on a trip that beat none', () => {
    expect(tripCard(trip({ best: ['deepest', 'longest', 'xp'] }), mapOf).lines.slice(3)).toEqual(['Your farthest and longest trip yet', 'The most XP you ever brought home']);
    expect(tripCard(trip({ best: [] }), mapOf).lines).toHaveLength(3);
  });

  it('after a collapse, says where you fell by a landmark, and nothing of a bag', () => {
    const pond = place(woods, 'pond'), by = nearest(woods, pond.x, pond.y);
    const card = tripCard(trip({ fell: { map: 'near-woods', x: by.x, y: by.y }, xp: 0, lowest: 0, best: [] }), mapOf);
    expect(card.title).toBe('Out 11 minutes');
    expect(card.lines[1]).toMatch(/^You fell by the pond\b/);
    expect(card.lines.join(' ')).not.toMatch(/Bag worth/);
  });

  it('never past the edge, and a name as a sentence has it', () => {
    expect(tripCard(trip({ deepest: null }), mapOf).lines[0]).toBe('412 steps · never past the edge');
    expect([the('pond'), the('The ranger\'s hut'), the('the Tower')]).toEqual(['the pond', 'the ranger\'s hut', 'the Tower']);
  });
});
