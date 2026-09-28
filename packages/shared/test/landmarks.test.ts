/**
 * Where something is, as people say it (landmarks.ts): by the nearest landmark, walking, never by
 * coordinates. The one rule for the trip report, someone down and the letters home; the real maps are
 * tried in the client's trip.test.ts, and here a small patch of wilds and some rooms.
 */
import { describe, expect, it } from 'vitest';
import { BY_STEPS, LANDMARK_STEPS, TileMap, inSentence, landmarkOf, the, type MapData } from '../src';

/**
 * A 16x9 patch of wilds: a wall of forest down column 7 with one gap at its foot (7,7), the only way between
 * the west side and the east. A door into the trapper's shack at 2,1, a sign at 12,2, the way home at 4,8.
 */
function patch(): MapData {
  const side = 't' + 'g'.repeat(6) + 't' + 'g'.repeat(7) + 't';
  return {
    id: 'patch', name: 'The Patch', version: 1, kind: 'wilds', depth: 1, width: 16, height: 9,
    tiles: ['t'.repeat(16), side, side, side, side, side, side, 't' + 'g'.repeat(14) + 't', 'tttt' + 'm' + 't'.repeat(11)],
    levels: Array<string>(9).fill('0'.repeat(16)),
    spawn: { x: 4, y: 7, dir: 'up' },
    exits: [
      { x: 4, y: 8, w: 1, h: 1, to: 'town', tx: 1, ty: 1, dir: 'down', home: true },
      { x: 2, y: 1, w: 1, h: 1, to: 'patch-shack', tx: 2, ty: 3, dir: 'up' },
    ],
    objects: [{ kind: 'sign', x: 12, y: 2, text: ['Mind the wall.'] }],
  };
}
const map = new TileMap(patch());
/** The rooms and places the patch's exits lead to, by id. */
const dataOf = (id: string): Pick<MapData, 'name' | 'kind'> | undefined =>
  id === 'patch-shack' ? { name: 'The trapper\'s shack', kind: 'inside' } : id === 'town' ? { name: 'Stonebrook', kind: 'town' } : undefined;

describe('a name in a sentence', () => {
  it('has its article: "pond" is "the pond", "the Tower" stays; a room\'s own name reads mid-sentence', () => {
    expect([the('pond'), the('The ranger\'s hut'), the('the Tower')]).toEqual(['the pond', 'the ranger\'s hut', 'the Tower']);
    expect([inSentence('The old cabin'), inSentence('Stonebrook Lodge')]).toEqual(['the old cabin', 'Stonebrook Lodge']);
  });
});

describe('landmarkOf', () => {
  it('names a door by the room it leads into, and is "by" it within a couple of steps', () => {
    expect(BY_STEPS).toBe(2);
    expect(landmarkOf(map, 2, 2, dataOf)).toBe('by the trapper\'s shack');
    expect(landmarkOf(map, 2, 3, dataOf)).toBe('by the trapper\'s shack');
    expect(landmarkOf(map, 2, 4, dataOf)).toBe('3 steps from the trapper\'s shack');
  });

  it('goes by walking, not by a straight line through the trees', () => {
    // 8,1 is six tiles east of the shack's door as the crow flies, but the wall stands between: 18 steps
    // round by the gap. The sign is three steps along.
    expect(landmarkOf(map, 8, 1, dataOf)).toBe('3 steps from a sign');
  });

  it('right by something, says how far the nearest door is too, to find the way back', () => {
    expect(landmarkOf(map, 12, 3, dataOf)).toBe('by a sign, 20 steps from the trapper\'s shack');
  });

  it('says deep in the region when nothing is within LANDMARK_STEPS', () => {
    expect(LANDMARK_STEPS).toBe(40);
    const corridor = new TileMap({
      id: 'corridor', name: 'The Corridor', version: 1, kind: 'wilds', depth: 1, width: 64, height: 3,
      tiles: ['t'.repeat(64), 't' + 'g'.repeat(62) + 't', 'tm' + 't'.repeat(62)], levels: Array<string>(3).fill('0'.repeat(64)),
      spawn: { x: 1, y: 1, dir: 'right' }, exits: [{ x: 1, y: 2, w: 1, h: 1, to: 'town', tx: 1, ty: 1, dir: 'down', home: true }], objects: [],
    });
    expect(landmarkOf(corridor, 5, 1, dataOf)).toBe('5 steps from the way home');
    expect(landmarkOf(corridor, 60, 1, dataOf)).toBe('deep in the Corridor');
  });

  it('names a room by its own name, and your own cabin as home', () => {
    const room = (more: Partial<MapData>): TileMap => new TileMap({
      id: 'room', name: 'The old cabin', version: 1, kind: 'inside', depth: 0, width: 5, height: 5,
      tiles: ['xxxxx', 'xpppx', 'xpppx', 'xpppx', 'xxpxx'], levels: Array<string>(5).fill('00000'),
      spawn: { x: 2, y: 3, dir: 'up' }, exits: [{ x: 2, y: 4, w: 1, h: 1, to: 'patch', tx: 5, ty: 5, dir: 'down' }], objects: [], ...more,
    });
    expect(landmarkOf(room({}), 2, 2, dataOf)).toBe('in the old cabin');
    expect(landmarkOf(room({ name: 'Stonebrook Lodge' }), 2, 2, dataOf)).toBe('in Stonebrook Lodge');
    expect(landmarkOf(room({ name: 'Home', private: true, objects: [{ kind: 'chest', x: 1, y: 1 }] }), 2, 2, dataOf)).toBe('at home');
  });
});
