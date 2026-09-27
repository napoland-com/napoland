import { describe, expect, it } from 'vitest';
import { TileMap, type MapData } from '@napoland/shared';
import { sketchOf } from '../src/papermap';

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

  it('is the same drawing every time, and knows nothing of who looks at it', () => {
    expect(sketchOf(new TileMap(woods()), id => names[id])).toEqual(s);
    expect(sketchOf.length).toBe(2);
  });
});
