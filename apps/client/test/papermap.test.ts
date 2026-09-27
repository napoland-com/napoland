import { describe, expect, it } from 'vitest';
import { TileMap, type MapData } from '@napoland/shared';
import { areaOf, mapFor, sketchOf } from '../src/papermap';

/** Forest around a road going north from the way home, a pond, a cabin with its door, and two poles. */
function woods(): MapData {
  return {
    id: 'woods', name: 'The Woods', version: 1, kind: 'wilds', depth: 1, width: 10, height: 10,
    tiles: ['tttttttttt', 'tgggrggggt', 'tgggrgwwwt', 'tgggrgwwwt', 'tgggrgwwgt', 'tgggrggggt', 'tgggrggggt', 'tgggrggggt', 'tgggrggggt', 'ttttrttttt'],
    levels: Array<string>(10).fill('0000000000'),
    spawn: { x: 4, y: 8, dir: 'up' },
    exits: [
      { x: 4, y: 9, w: 1, h: 1, to: 'town', tx: 0, ty: 0, dir: 'down', home: true },
      { x: 2, y: 3, w: 1, h: 1, to: 'hut', tx: 1, ty: 1, dir: 'up' },
    ],
    objects: [{ kind: 'house', x: 1, y: 1, w: 3, h: 2, roof: '#555555', lit: 1 }, { kind: 'pole', x: 5, y: 2 }, { kind: 'pole', x: 5, y: 7 }],
  };
}
const names: Record<string, string> = { town: 'Stonebrook', hut: 'The hut' };

describe('the paper map', () => {
  const s = sketchOf(new TileMap(woods()), id => names[id]);

  it('draws the road, the water, the cabin and the power line, a little off where they really are', () => {
    // The road runs from y 1 to y 9, never more than a little off.
    expect(s.roads).toHaveLength(9);
    for (const [x] of s.roads) expect(Math.abs(x - 4.5)).toBeLessThanOrEqual(0.35);
    expect(s.forest.length).toBeGreaterThan(s.trees.length);
    expect(s.water).toHaveLength(8);
    expect(s.houses).toHaveLength(1);
    expect(s.wires).toHaveLength(1);
    expect(s.trees.length).toBeGreaterThan(0);
  });

  it('names the way home, the cabins and the pond, and the map at the top', () => {
    expect(s.title).toBe('The Woods');
    expect(s.labels.map(l => l.text)).toEqual(['to Stonebrook', 'The hut', 'pond']);
  });

  it('draws NAPO\'s buildings with flat roofs, its masts, and fences as closed lines', () => {
    const napo: MapData = {
      ...woods(), id: 'grounds', name: 'The Grounds',
      objects: [
        { kind: 'house', x: 1, y: 1, w: 3, h: 2, roof: '#555555', lit: 1, style: 'napo' },
        { kind: 'antenna', x: 7, y: 7 },
        { kind: 'fence', x: 6, y: 5, dir: 'h' }, { kind: 'fence', x: 7, y: 5, dir: 'h' }, { kind: 'fence', x: 8, y: 6, dir: 'v' },
      ],
    };
    const g = sketchOf(new TileMap(napo), id => names[id]);
    expect(g.houses.map(h => h.flat)).toEqual([true]);
    expect(s.houses.map(h => h.flat)).toEqual([false]);
    expect(g.masts).toHaveLength(1);
    expect(Math.hypot(g.masts[0]![0] - 7.5, g.masts[0]![1] - 7.5)).toBeLessThanOrEqual(0.5);
    // Two fence tiles side by side make one line with no gap: a yard drawn on paper stays closed.
    expect(g.fences).toEqual([[[6, 5.5], [7, 5.5]], [[7, 5.5], [8, 5.5]], [[8.5, 6], [8.5, 7]]]);
  });

  it('writes in the places the map names, which then name the water too', () => {
    const named = sketchOf(new TileMap({ ...woods(), places: [{ name: 'the sinks', x: 7, y: 3 }, { name: 'ring of stones', x: 2, y: 7 }] }), id => names[id]);
    expect(named.labels.map(l => l.text)).toEqual(['to Stonebrook', 'The hut', 'the sinks', 'ring of stones']);
  });

  it('never writes one name over another: side by side, one goes a line up', () => {
    const two: MapData = {
      ...woods(), width: 30, height: 20, tiles: Array<string>(20).fill('g'.repeat(30)), levels: Array<string>(20).fill('0'.repeat(30)),
      exits: [{ x: 10, y: 12, w: 1, h: 1, to: 'hut', tx: 1, ty: 1, dir: 'up' }, { x: 14, y: 12, w: 1, h: 1, to: 'town', tx: 0, ty: 0, dir: 'up' }],
      objects: [],
    };
    const [a, b] = sketchOf(new TileMap(two), id => names[id]).labels;
    expect(a!.y).toBeCloseTo(8.6);
    expect(Math.abs(a!.y - b!.y)).toBeGreaterThanOrEqual(1.9);
  });

  it('is the same drawing every time, and knows nothing of who looks at it', () => {
    expect(sketchOf(new TileMap(woods()), id => names[id])).toEqual(s);
    expect(sketchOf.length).toBe(2);
  });
});

describe('which map the map button opens', () => {
  // A town with a room, woods with a hut, and a region nobody has a map of yet.
  const at = (id: string, kind: MapData['kind'], to: string[]) => ({ id, kind, exits: to.map(t => ({ x: 0, y: 0, w: 1, h: 1, to: t, tx: 0, ty: 0, dir: 'up' as const })) }) as unknown as MapData;
  const all = [at('town', 'town', ['home', 'woods']), at('home', 'inside', ['town']), at('woods', 'wilds', ['town', 'hut', 'far']), at('hut', 'inside', ['woods']), at('far', 'wilds', ['woods'])];
  const find = (id: string) => all.find(m => m.id === id);
  const charts: Record<string, string> = { 'town-map': 'town', 'woods-map': 'woods', radio: '' };
  const chartOf = (t: string) => charts[t] || undefined;
  const tools = ['radio', 'town-map', 'woods-map'];

  it('takes a room for the place its door opens onto, and anywhere else for itself', () => {
    expect(areaOf('hut', find)).toBe('woods');
    expect(areaOf('home', find)).toBe('town');
    expect(areaOf('woods', find)).toBe('woods');
    expect(areaOf('nowhere', find)).toBe('nowhere');
  });

  it('opens the map of the area you are in, indoors the one outside, and none where you have no map', () => {
    expect(mapFor('town', tools, chartOf, find)).toBe('town-map');
    expect(mapFor('woods', tools, chartOf, find)).toBe('woods-map');
    expect(mapFor('hut', tools, chartOf, find)).toBe('woods-map');
    expect(mapFor('home', tools, chartOf, find)).toBe('town-map');
    expect(mapFor('far', tools, chartOf, find)).toBeUndefined();
    expect(mapFor('woods', ['town-map'], chartOf, find)).toBeUndefined();
  });
});
