/**
 * What the Burn added to the contract (map.ts, validate.ts): NAPO's gate, which blocks its tiles, is pulled
 * at from below and takes its pullers through side by side, and leads only deeper, to a map whose way home
 * comes back to it; and the burnt forest.
 */
import { describe, expect, it } from 'vitest';
import { GATE_PULLERS, TileMap, gateArrival, gateAt, validateMap, validateWorld, type MapData, type MapObject } from '../src';

type Gate = Extract<MapObject, { kind: 'gate' }>;
const GATE: Gate = { kind: 'gate', x: 4, y: 1, w: 2, to: 'deep', tx: 3, ty: 4, dir: 'up', text: ['Two to pull.'] };

/** Woods 10 by 6, the way home at 4,5, the gate across row 1 with forest behind it. */
function woods(more: Partial<MapData> = {}, gate: Partial<Gate> = {}): MapData {
  return {
    id: 'woods', name: 'Woods', version: 1, kind: 'wilds', depth: 2, width: 10, height: 6,
    tiles: ['tttttttttt', 'ttttggtttt', 'tggggggggt', 'tggggggggt', 'tggggggggt', 'ttttgttttt'],
    levels: Array<string>(6).fill('0000000000'),
    spawn: { x: 4, y: 4, dir: 'up' },
    exits: [{ x: 4, y: 5, w: 1, h: 1, to: 'town', tx: 1, ty: 1, dir: 'down', home: true }],
    objects: [{ ...GATE, ...gate }],
    ...more,
  };
}
/** The map behind the gate: deeper, its way home back under the gate. */
function deep(more: Partial<MapData> = {}): MapData {
  return {
    id: 'deep', name: 'Deep', version: 1, kind: 'wilds', depth: 3, width: 8, height: 6,
    tiles: ['tttttttt', 'tggggggt', 'tggggggt', 'tggggggt', 'tggggggt', 'tttggttt'],
    levels: Array<string>(6).fill('00000000'),
    spawn: { x: 3, y: 3, dir: 'up' },
    exits: [{ x: 3, y: 5, w: 2, h: 1, to: 'woods', tx: 4, ty: 2, dir: 'down', home: true }],
    objects: [],
    ...more,
  };
}
const town: MapData = {
  id: 'town', name: 'Town', version: 1, kind: 'town', depth: 0, width: 3, height: 3, tiles: ['ggg', 'ggg', 'ggg'], levels: Array<string>(3).fill('000'),
  spawn: { x: 1, y: 2, dir: 'up' }, exits: [{ x: 1, y: 0, w: 1, h: 1, to: 'woods', tx: 4, ty: 4, dir: 'up' }], objects: [],
};
const errors = (d: MapData) => validateMap(d).filter(p => p.level === 'error').map(p => p.message);
const worldErrors = (...maps: MapData[]) => validateWorld(maps, 'town').filter(p => p.level === 'error').map(p => p.message);

describe('NAPO\'s gate', () => {
  it('stands in the way on its tiles, is found by any of them, and takes each puller through by the tile they pull at', () => {
    const map = new TileMap(woods());
    expect([map.walkable(4, 1), map.walkable(5, 1), map.walkable(4, 2)]).toEqual([false, false, true]);
    expect(gateAt(map.data, 5, 1)).toMatchObject({ kind: 'gate', x: 4 });
    expect(gateAt(map.data, 6, 1)).toBeUndefined();
    expect(gateArrival(GATE, 4)).toEqual({ to: 'deep', x: 3, y: 4, dir: 'up' });
    expect(gateArrival(GATE, 5)).toEqual({ to: 'deep', x: 4, y: 4, dir: 'up' });
  });

  it('is as wide as those it takes, out in the wilds, with ground below each tile to pull from and a plate to read', () => {
    expect(errors(woods())).toEqual([]);
    expect(errors(woods({}, { w: GATE_PULLERS - 1 })).join()).toMatch(/gate at 4,1 is 1 wide/);
    expect(errors(woods({}, { text: [] })).join()).toMatch(/nothing to read/);
    expect(errors(woods({ tiles: ['tttttttttt', 'ttttggtttt', 'tggggtgggt', 'tggggggggt', 'tggggggggt', 'ttttgttttt'] })).join()).toMatch(/every tile below it is walkable/);
  });

  it('leads deeper, to a map whose way home comes back to it, so nobody is shut in behind it; and what is behind it counts as reached', () => {
    expect(worldErrors(town, woods(), deep())).toEqual([]);
    expect(validateWorld([town, woods(), deep()], 'town').map(p => p.message).join()).not.toMatch(/cannot be reached/);
    expect(worldErrors(town, woods(), deep({ depth: 2 })).join()).toMatch(/a gate leads deeper/);
    expect(worldErrors(town, woods(), deep({ exits: [{ x: 3, y: 5, w: 2, h: 1, to: 'town', tx: 1, ty: 1, dir: 'down', home: true }] })).join()).toMatch(/comes back here/);
    expect(worldErrors(town, woods({}, { tx: 0, ty: 0 }), deep()).join()).toMatch(/not walkable ground/);
  });
});

describe('the burnt forest', () => {
  it('is said of the wilds only', () => {
    expect(errors(woods({ forest: 'burnt' }))).toEqual([]);
    expect(errors(woods({ forest: 'ash' as 'burnt' })).join()).toMatch(/forest "ash"/);
  });
});
