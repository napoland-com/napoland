/**
 * Tall grass (DESIGN.md, Creatures): walked through like grass, and it hides whoever stands in it
 * from creatures, and only from them. The rule is hidden(); where creatures may go is creatureMayStand.
 */
import { describe, expect, it } from 'vitest';
import { TILE_CHARS, TileMap, energyRate, findPath, hidden, inSurge, validateMap, type MapData, type MapObject } from '../src';

/**
 * Open woods, 9 wide and 8 tall: grass, with a band of tall grass across row 3 but for a gap at its
 * right end (8,3), a patch of it at 2,5 and 3,5, and the way home at 4,7.
 */
function woods(more: Partial<MapData> = {}): MapData {
  return {
    id: 'woods', name: 'Woods', version: 1, kind: 'wilds', depth: 1, width: 10, height: 8,
    tiles: ['tttttttttt', 'tggggggggt', 'tggggggggt', 'thhhhhhhgt', 'tggggggggt', 'tghhgggggt', 'tggggggggt', 'ttttgttttt'],
    levels: Array<string>(8).fill('0000000000'),
    spawn: { x: 4, y: 6, dir: 'up' },
    exits: [{ x: 4, y: 7, w: 1, h: 1, to: 'town', tx: 1, ty: 1, dir: 'down', home: true }],
    objects: [],
    ...more,
  };
}

describe('tall grass', () => {
  const map = new TileMap(woods());

  it('is its own kind of tile, with its own letter', () => {
    expect(TILE_CHARS.h).toBe('tallgrass');
    expect(map.kind(2, 3)).toBe('tallgrass');
    expect(new Set(Object.keys(TILE_CHARS)).size).toBe(Object.values(TILE_CHARS).length);
  });

  it('hides whoever stands in it, and nothing else does', () => {
    expect(hidden(map, 2, 3)).toBe(true);
    expect(hidden(map, 3, 5)).toBe(true);
    expect(hidden(map, 8, 3)).toBe(false);
    expect(hidden(map, 4, 6)).toBe(false);
    expect(hidden(map, -1, 3)).toBe(false);
    expect(hidden(map, 99, 99)).toBe(false);
  });

  it('is walked through like grass: the shortest way crosses it', () => {
    expect(map.walkable(2, 3)).toBe(true);
    // Straight up through the band, not round by its gap.
    expect(findPath(map, 4, 6, 4, 1)).toEqual([{ x: 4, y: 5 }, { x: 4, y: 4 }, { x: 4, y: 3 }, { x: 4, y: 2 }, { x: 4, y: 1 }]);
  });

  it('is never where a creature may stand, step or wake', () => {
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      if (hidden(map, x, y)) expect(map.creatureMayStand(x, y), `${x},${y}`).toBe(false);
    }
    expect(map.creatureMayStand(8, 3)).toBe(true);
    expect(map.creatureMayStand(4, 4)).toBe(true);
    const lairs = map.lairs([0, 99]).map(i => [i % map.width, Math.floor(i / map.width)] as const);
    expect(lairs.length).toBeGreaterThan(0);
    expect(lairs.filter(([x, y]) => hidden(map, x, y))).toEqual([]);
  });

  it('hides you from creatures only: it tires you and a surge finds you there as on the grass beside it', () => {
    // 3,5 is tall grass and 5,5 grass, both three steps from home.
    expect(map.homeSteps(3, 5)).toBe(map.homeSteps(5, 5));
    for (const weather of ['overcast', 'rain', 'night'] as const) expect(energyRate(map, 3, 5, weather)).toBe(energyRate(map, 5, 5, weather));
    expect(energyRate(map, 3, 5, 'rain', { surgeFront: 0, storm: true, flash: 'spark' })).toBe(energyRate(map, 5, 5, 'rain', { surgeFront: 0, storm: true, flash: 'spark' }));
    expect(inSurge(map, 3, 5, 0)).toBe(true);
  });
});

describe('the validator on tall grass', () => {
  const messages = (data: MapData, level: 'error' | 'warning') => validateMap(data).filter(p => p.level === level).map(p => p.message);

  it('takes it as a tile like any other', () => {
    expect(validateMap(woods())).toEqual([]);
  });

  it('refuses it under something that stands there, on an exit, and in front of a door or a sign', () => {
    const on = (objects: MapObject[], tiles?: string[]) => messages(woods({ objects, ...(tiles ? { tiles } : {}) }), 'error');
    expect(on([{ kind: 'rock', x: 2, y: 3, s: 1, v: 0 }]).join()).toMatch(/tall grass at 2,3 cannot be walked into/);
    expect(on([{ kind: 'sign', x: 2, y: 2, text: ['Hi'] }]).join()).toMatch(/tall grass at 2,3 is in front of the sign at 2,2/);
    const exit = woods();
    exit.tiles[7] = 'tttthttttt';
    expect(messages(exit, 'error').join()).toMatch(/tall grass at 4,7 is on an exit/);
    // A cabin at 3,1 has its door at 4,2 and its front at 4,3, in the band.
    const cabin = messages(woods({ objects: [{ kind: 'house', x: 3, y: 1, w: 3, h: 2, roof: '#555555', lit: 1 }], exits: [...woods().exits, { x: 4, y: 2, w: 1, h: 1, to: 'hut', tx: 1, ty: 1, dir: 'up' }] }), 'error');
    expect(cabin.join()).toMatch(/tall grass at 4,3 is in front of the door of the house at 3,1/);
  });

  it('warns where it hides nobody from anything: in a town, and in a street light', () => {
    expect(messages(woods({ kind: 'town', depth: 0, exits: [] }), 'warning').join()).toMatch(/tall grass in a town/);
    expect(messages(woods({ objects: [{ kind: 'lamp', x: 1, y: 2 }] }), 'warning').join()).toMatch(/tall grass in a street light/);
  });
});
