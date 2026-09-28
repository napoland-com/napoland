/**
 * The fire lookout (roadmap/lookout-tower.md): the rules both sides run. Where you climb it, what its lamp
 * takes, and which tiles its beam lights at a moment of the wall clock, which the server counts and every
 * client draws without anything sent but how long the lamp burns.
 *
 *   0123456789AB
 * 0 tttttttttttt
 * 1 tggggggggggt
 * 2 tgggLLgggggt   L: the lookout (4,2), 2 by 2; its lamp hangs over the middle of its legs, the point (5,3)
 * 3 tgggLLgggggt      and its ladder is up its south face, on (5,3)
 * 4 tggggFgggggt   F: the foot of the ladder (5,4), where you climb
 * 5 tggggggggggt
 * 6 tggggggggggt
 * 7 ttttttmttttt   the way home (6,7)
 */
import { describe, expect, it } from 'vitest';
import {
  BEAM_EVERY_S, BEAM_HALF, BEAM_REACH, BEAM_UNDER, LAMP_BURNS, LAMP_MAX_S, LAMP_PER_S, LOOKOUT_UP_S, LOOKOUT_ZOOM, TileMap, beamAngle, energyRate, footOf, inBeam,
  inSurge, ladderOf, lampOf, lampTakes, lookoutAtFoot, validateMap, type MapData,
} from '../src';

function hill(more: Partial<MapData> = {}): MapData {
  return {
    id: 'hill', name: 'The Hill', version: 1, kind: 'wilds', depth: 1, width: 12, height: 8,
    tiles: ['tttttttttttt', ...Array<string>(6).fill('tggggggggggt'), 'ttttttmttttt'],
    levels: Array<string>(8).fill('000000000000'),
    spawn: { x: 6, y: 6, dir: 'up' },
    exits: [{ x: 6, y: 7, w: 1, h: 1, to: 'town', tx: 0, ty: 0, dir: 'down', home: true }],
    objects: [{ kind: 'lookout', x: 4, y: 2 }],
    ...more,
  };
}
const LOOKOUT = { kind: 'lookout', x: 4, y: 2 } as const;
const DEG = Math.PI / 180;

describe('the fire lookout', () => {
  const map = new TileMap(hill());

  it('stands on its four legs, 2 by 2, and is climbed from in front of its ladder, up its south face', () => {
    for (const [x, y] of [[4, 2], [5, 2], [4, 3], [5, 3]] as const) expect(map.walkable(x, y), `${x},${y}`).toBe(false);
    expect(footOf(LOOKOUT)).toEqual({ x: 5, y: 4 });
    expect(ladderOf(LOOKOUT)).toEqual({ x: 5, y: 3 });
    expect(lampOf(LOOKOUT)).toEqual({ x: 5, y: 3 });
    expect(map.walkable(5, 4)).toBe(true);
    // Only from its foot: beside it, or the tile next to the foot, climbs nothing.
    expect(lookoutAtFoot(map.data.objects, 5, 4)).toEqual(LOOKOUT);
    for (const [x, y] of [[4, 4], [6, 4], [5, 5], [6, 3]] as const) expect(lookoutAtFoot(map.data.objects, x, y), `${x},${y}`).toBeUndefined();
  });

  it('lets you see three times as far for two minutes, and its lamp burns resin, ten minutes each, an hour at most', () => {
    expect([LOOKOUT_ZOOM, LOOKOUT_UP_S]).toEqual([3, 120]);
    expect([LAMP_BURNS, LAMP_PER_S, LAMP_MAX_S]).toEqual(['resin', 600, 3600]);
    // Out, it takes six; the last may top it up past what it holds, as at a fire; full, none.
    expect(lampTakes(0)).toBe(6);
    expect(lampTakes(-30)).toBe(6);
    expect(lampTakes(2950)).toBe(2);
    expect(lampTakes(3000)).toBe(1);
    expect(lampTakes(LAMP_MAX_S - 1)).toBe(0);
    expect(lampTakes(LAMP_MAX_S)).toBe(0);
  });

  it('turns its beam once round every 20 seconds by the wall clock: east, then south, west and north', () => {
    expect(BEAM_EVERY_S).toBe(20);
    expect(beamAngle(0)).toBe(0);
    expect(beamAngle(5000)).toBeCloseTo(Math.PI / 2, 9);
    expect(beamAngle(10_000)).toBeCloseTo(Math.PI, 9);
    expect(beamAngle(15_000)).toBeCloseTo((3 * Math.PI) / 2, 9);
    expect(beamAngle(20_000)).toBe(0);
    // The same moment of any turn, and before the epoch too.
    expect(beamAngle(1_000_000_005_000)).toBeCloseTo(Math.PI / 2, 6);
    expect(beamAngle(-5000)).toBeCloseTo((3 * Math.PI) / 2, 9);
  });

  it('lights the tiles in its cone as far as it reaches, and passes over the tower\'s own feet', () => {
    expect([BEAM_REACH, BEAM_HALF / DEG, BEAM_UNDER]).toEqual([22, 12, 1.6]);
    // Pointing east: the tiles either side of its line are in it; south of east by more than its half, not.
    expect(inBeam(LOOKOUT, 8, 2, 0)).toBe(true);
    expect(inBeam(LOOKOUT, 8, 3, 0)).toBe(true);
    expect(inBeam(LOOKOUT, 8, 5, 0)).toBe(false);
    expect(inBeam(LOOKOUT, 1, 3, 0)).toBe(false);
    // As far as it reaches, and no farther.
    expect(inBeam(LOOKOUT, 5 + 21, 2, 0)).toBe(true);
    expect(inBeam(LOOKOUT, 5 + 23, 2, 0)).toBe(false);
    // Under the tower it lights nothing, wherever it points.
    for (let t = 0; t < 20_000; t += 250) expect(inBeam(LOOKOUT, 5, 3, t) || inBeam(LOOKOUT, 4, 2, t) || inBeam(LOOKOUT, 5, 4, t)).toBe(false);
    // A quarter turn on, it points south.
    expect(inBeam(LOOKOUT, 5, 8, 5000)).toBe(true);
    expect(inBeam(LOOKOUT, 8, 3, 5000)).toBe(false);
  });

  it('passes over every tile in its reach once a turn, for as long as its cone is wide', () => {
    for (const [x, y] of [[9, 1], [0, 7], [5, 20], [-10, 3], [15, 15]] as const) {
      let lit = 0;
      for (let t = 0; t < 20_000; t += 10) if (inBeam(LOOKOUT, x, y, t)) lit += 10;
      // 24 degrees of 360: about 1.3 s of every 20, in one pass.
      expect(lit, `${x},${y}`).toBeGreaterThan(1200);
      expect(lit, `${x},${y}`).toBeLessThan(1500);
    }
  });

  it('shelters whoever it lights from a surge as a street light does, while it is on them', () => {
    // The whole field is in the front (0 steps from home or more).
    expect(inSurge(map, 9, 1, 0)).toBe(true);
    expect(inSurge(map, 9, 1, 0, true)).toBe(false);
    expect(energyRate(map, 9, 1, 'overcast', { surgeFront: 0, surgeDrain: 3, lit: true })).toBeCloseTo(energyRate(map, 9, 1, 'overcast'), 9);
    expect(energyRate(map, 9, 1, 'overcast', { surgeFront: 0, surgeDrain: 3 })).toBeCloseTo(3 * energyRate(map, 9, 1, 'overcast'), 9);
  });

  it('is content the validators know: it stands in the wilds, on a map whose foot of the ladder is open ground', () => {
    expect(validateMap(hill())).toEqual([]);
    const messages = (data: MapData) => validateMap(data).map(p => p.message).join('\n');
    // Its foot in the firs, or on the way home: nobody could climb it.
    expect(messages(hill({ objects: [{ kind: 'lookout', x: 4, y: 3 }], tiles: ['tttttttttttt', ...Array<string>(4).fill('tggggggggggt'), 'tggggtgggggt', 'tggggggggggt', 'ttttttmttttt'] })))
      .toMatch(/lookout at 4,3: the foot of its ladder \(5,5\) is not open ground, so nobody can climb it/);
    expect(validateMap(hill({ objects: [{ kind: 'lookout', x: 5, y: 4 }] }))).toEqual([]);
    const onExit = hill({ objects: [{ kind: 'lookout', x: 5, y: 4 }], exits: [{ x: 6, y: 6, w: 1, h: 1, to: 'town', tx: 0, ty: 0, dir: 'down', home: true }] });
    expect(messages(onExit)).toMatch(/lookout at 5,4: the foot of its ladder \(6,6\) is not open ground/);
    // Out in the wilds only.
    expect(messages(hill({ kind: 'town', depth: 0, exits: [] }))).toMatch(/a fire lookout stands out in the wilds/);
    // Nobody climbs it out of tall grass.
    expect(messages(hill({ tiles: ['tttttttttttt', 'tggggggggggt', 'tggggggggggt', 'tggggggggggt', 'tggggHgggggt', 'tggggggggggt', 'tggggggggggt', 'ttttttmttttt'].map(r => r.replace('H', 'h')) })))
      .toMatch(/tall grass at 5,4 is in front of the ladder of the lookout at 4,2/);
  });
});
