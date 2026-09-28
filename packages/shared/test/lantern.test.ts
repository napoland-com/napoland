/**
 * Shared light (roadmap/group-mechanics.md): the rule both sides run. A lantern lights the ground within
 * LANTERN_REACH of its carrier, only out in the wilds of a region LANTERN_DEPTH deep or deeper, and whoever
 * stands in it tires LANTERN_DRAIN as fast.
 */
import { describe, expect, it } from 'vitest';
import { LANTERN_DEPTH, LANTERN_DRAIN, LANTERN_REACH, TileMap, energyRate, lanternLights, type MapData } from '../src';

function burn(more: Partial<MapData> = {}): MapData {
  return {
    id: 'burn', name: 'The Burn', version: 1, kind: 'wilds', depth: LANTERN_DEPTH, width: 12, height: 8,
    tiles: ['tttttttttttt', ...Array<string>(6).fill('tggggggggggt'), 'ttttttmttttt'],
    levels: Array<string>(8).fill('000000000000'),
    spawn: { x: 6, y: 6, dir: 'up' },
    exits: [{ x: 6, y: 7, w: 1, h: 1, to: 'town', tx: 0, ty: 0, dir: 'down', home: true }],
    objects: [],
    ...more,
  };
}

describe('a lantern', () => {
  const map = new TileMap(burn());

  it('lights a round of ground as far as its reach, and no farther', () => {
    const by = { x: 5, y: 3 };
    expect(lanternLights(map, 5 + LANTERN_REACH, 3, by)).toBe(true);
    expect(lanternLights(map, 5 + LANTERN_REACH + 1, 3, by)).toBe(false);
    expect(lanternLights(map, 7, 5, by)).toBe(true);
    // The corner of the square is outside the round.
    expect(lanternLights(map, 5 + LANTERN_REACH, 3 + LANTERN_REACH, by)).toBe(false);
  });

  it('counts only out in the wilds of a deep region', () => {
    const by = { x: 5, y: 3 };
    expect(lanternLights(new TileMap(burn({ depth: LANTERN_DEPTH - 1 })), 5, 4, by)).toBe(false);
    expect(lanternLights(new TileMap(burn({ kind: 'inside', exits: [] })), 5, 4, by)).toBe(false);
  });

  it('cuts the whole drain of whoever stands in it', () => {
    const plain = energyRate(map, 5, 3, 'night', { wet: 1 });
    expect(energyRate(map, 5, 3, 'night', { wet: 1, lantern: true })).toBeCloseTo(plain * LANTERN_DRAIN, 9);
  });
});
