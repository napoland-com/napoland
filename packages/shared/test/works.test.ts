/**
 * Mending the woods together (roadmap/trail-works.md): the rules both sides run. What a place takes, how
 * long what was put by lasts, and the map, which never changes shape: a footbridge's tiles open with its
 * id while it stands (the server's passes hold it then), and a street light of the works lights its tiles
 * only then.
 *
 *   0123456789
 * 0 tttttttttt
 * 1 tggggwgggt   w: a creek down column 5, and over it at 5,2 a footbridge (pond-bridge)
 * 2 tggggwgggt
 * 3 tggggwgggt
 * 4 tggggwggLt   L: a street light of the works (pond-light) at 8,4
 * 5 tggggwgggt
 * 6 tggggggggt   the ford: the long way round
 * 7 ttttttmttt   the way home, 6,7
 */
import { describe, expect, it } from 'vitest';
import { LAMP_RADIUS, TileMap, findPath, validateItems, validateMap, worksDays, worksGive, worksRoom, worksWear, type ItemsData, type MapData, type WorksDef } from '../src';

function creek(more: Partial<MapData> = {}): MapData {
  return {
    id: 'creek', name: 'The Creek', version: 1, kind: 'wilds', depth: 1, width: 10, height: 8,
    tiles: ['tttttttttt', ...Array<string>(5).fill('tggggwgggt'), 'tggggggggt', 'ttttttmttt'],
    levels: Array<string>(8).fill('0000000000'),
    spawn: { x: 6, y: 5, dir: 'up' },
    exits: [{ x: 6, y: 7, w: 1, h: 1, to: 'town', tx: 0, ty: 0, dir: 'down', home: true }],
    objects: [{ kind: 'footbridge', id: 'pond-bridge', x: 5, y: 2, w: 1, h: 1 }, { kind: 'lamp', x: 8, y: 4, works: 'pond-light' }],
    ...more,
  };
}
const BRIDGE: WorksDef = { id: 'pond-bridge', build: 'footbridge', name: 'the footbridge', where: 'by the creek', item: 'scrap', need: 30, wear: 5, hold: 35 };
const LIGHT: WorksDef = { id: 'pond-light', build: 'light', name: 'the street light', where: 'by the creek', item: 'wire', need: 12, wear: 2, hold: 14 };
const STANDS = new Set(['pond-bridge']), LIT = new Set(['pond-light']);

describe('a place mended together', () => {
  it('takes what it needs to stand again, and then as much as it keeps put by; standing, up to that', () => {
    expect(worksRoom(BRIDGE, { standing: false, held: 0 })).toBe(65);
    expect(worksRoom(BRIDGE, { standing: false, held: 12 })).toBe(53);
    expect(worksRoom(BRIDGE, { standing: true, held: 30 })).toBe(5);
    expect(worksRoom(BRIDGE, { standing: true, held: 35 })).toBe(0);
  });

  it('stands again at what it needs, and what came beyond it is put by; never takes more than it has room for', () => {
    expect(worksGive(BRIDGE, { standing: false, held: 12 }, 3)).toEqual({ standing: false, held: 15, took: 3, built: false });
    expect(worksGive(BRIDGE, { standing: false, held: 28 }, 5)).toEqual({ standing: true, held: 3, took: 5, built: true });
    expect(worksGive(BRIDGE, { standing: true, held: 3 }, 10)).toEqual({ standing: true, held: 13, took: 10, built: false });
    expect(worksGive(BRIDGE, { standing: true, held: 33 }, 10)).toEqual({ standing: true, held: 35, took: 2, built: false });
    expect(worksGive(BRIDGE, { standing: true, held: 35 }, 1)).toEqual({ standing: true, held: 35, took: 0, built: false });
    // All at once from broken: it stands, with a week put by.
    expect(worksGive(BRIDGE, { standing: false, held: 0 }, 99)).toEqual({ standing: true, held: 35, took: 65, built: true });
  });

  it('pays its wear each midnight from what was put by; short of it, it breaks, and what was left counts toward standing again', () => {
    expect(worksDays(BRIDGE, 18)).toBe(3);
    expect(worksDays(BRIDGE, 4)).toBe(0);
    expect(worksWear(BRIDGE, { standing: true, held: 18 })).toEqual({ standing: true, held: 13, broke: false });
    expect(worksWear(BRIDGE, { standing: true, held: 5 })).toEqual({ standing: true, held: 0, broke: false });
    expect(worksWear(BRIDGE, { standing: true, held: 3 })).toEqual({ standing: false, held: 3, broke: true });
    // Broken, nothing wears.
    expect(worksWear(BRIDGE, { standing: false, held: 3 })).toEqual({ standing: false, held: 3, broke: false });
    expect(worksWear(LIGHT, { standing: true, held: 2 })).toEqual({ standing: true, held: 0, broke: false });
  });
});

describe('the map of a place mended together', () => {
  const map = new TileMap(creek());

  it('keeps a footbridge water to everyone, and walkable for all while it stands: pathing goes over it then, and round it before', () => {
    expect(map.kind(5, 2)).toBe('water');
    expect(map.walkable(5, 2)).toBe(false);
    expect(map.walkable(5, 2, STANDS)).toBe(true);
    expect(map.walkable(5, 2, LIT)).toBe(false);
    expect(map.needs(5, 2)).toBe('pond-bridge');
    // The rest of the creek stays water whatever stands.
    expect(map.walkable(5, 3, STANDS)).toBe(false);
    // From the west bank to the east: over the bridge, 2 steps; without it, 10, round by the ford.
    expect(findPath(map, 4, 2, 6, 2)).toHaveLength(10);
    expect(findPath(map, 4, 2, 6, 2, false, 5000, STANDS)).toEqual([{ x: 5, y: 2 }, { x: 6, y: 2 }]);
    // Creatures never cross it: to them it is water.
    expect(map.creatureMayStand(5, 2)).toBe(false);
  });

  it('never changes how far from home a tile is: the bridge is as far as the way to it', () => {
    // The west bank is as deep as the way round by the ford, however the bridge stands.
    const without = new TileMap(creek({ objects: [] }));
    expect([map.homeSteps(4, 2), map.homeSteps(6, 2)]).toEqual([7, 5]);
    expect([without.homeSteps(4, 2), without.homeSteps(6, 2)]).toEqual([7, 5]);
    expect(map.homeSteps(5, 2)).toBe(6);
    expect(map.deepest).toBe(without.deepest);
  });

  it('lights around a street light of the works only while it stands, and there no creature stands then', () => {
    for (const [x, y] of [[6, 4], [7, 4], [8, 3], [8, 5], [7, 3], [6, 3]] as const) {
      expect(Math.hypot(x - 8, y - 4)).toBeLessThanOrEqual(LAMP_RADIUS);
      expect(map.lit(x, y), `${x},${y}`).toBe(false);
      expect(map.lit(x, y, LIT), `${x},${y}`).toBe(true);
      expect(map.lit(x, y, STANDS), `${x},${y}`).toBe(false);
      expect(map.creatureMayStand(x, y), `${x},${y}`).toBe(true);
      expect(map.creatureMayStand(x, y, LIT), `${x},${y}`).toBe(false);
    }
    expect(map.worksLights).toEqual([{ id: 'pond-light', x: 8, y: 4 }]);
    // Its post stands in the way, like any lamp's; the east end of the bridge is out of its light.
    expect(map.walkable(8, 4)).toBe(false);
    expect(map.lit(6, 2, LIT)).toBe(false);
    // A street light that always shines lights with any pass or none.
    const plain = new TileMap(creek({ objects: [{ kind: 'lamp', x: 8, y: 4 }] }));
    expect(plain.lit(6, 4)).toBe(true);
    expect(plain.worksLights).toEqual([]);
  });

  it('is content the validators know: a footbridge spans water from bank to bank, one tile across, and what each place takes is a resource', () => {
    expect(validateMap(creek())).toEqual([]);
    const messages = (data: MapData) => validateMap(data).map(p => p.message).join('\n');
    expect(messages(creek({ objects: [{ kind: 'footbridge', id: 'pond-bridge', x: 4, y: 2, w: 2, h: 1 }] }))).toMatch(/tile 4,2 is not water: a footbridge spans water/);
    // Along the creek, not across it: its ends are in the firs and in the water.
    expect(messages(creek({ objects: [{ kind: 'footbridge', id: 'pond-bridge', x: 5, y: 1, w: 1, h: 2 }] }))).toMatch(/its end at 5,0 is not open ground/);
    expect(messages(creek({ objects: [{ kind: 'footbridge', id: 'pond-bridge', x: 5, y: 1, w: 2, h: 2 }] }))).toMatch(/is 2 by 2: a footbridge is one tile across and 1 to 4 long/);
    expect(messages(creek({ objects: [{ kind: 'footbridge', id: 'Pond Bridge', x: 5, y: 2, w: 1, h: 1 }] }))).toMatch(/its id is lowercase words joined by hyphens/);
    expect(messages(creek({ objects: [{ kind: 'lamp', x: 8, y: 4, works: 'Pond light' }] }))).toMatch(/works names the place it belongs to/);

    const town: MapData = { id: 'town', name: 'Town', version: 1, kind: 'town', depth: 0, width: 1, height: 1, tiles: ['g'], levels: ['0'], spawn: { x: 0, y: 0, dir: 'down' }, exits: [], objects: [] };
    const items = (works: WorksDef[]): ItemsData => ({
      version: 1, finds: [], works,
      items: [
        { id: 'scrap', name: 'Scrap', kind: 'resource', stack: 10, text: 'Rust.' },
        { id: 'wire', name: 'Wire', kind: 'resource', stack: 10, text: 'Copper.' },
        { id: 'tea', name: 'Tea', kind: 'consumable', stack: 2, text: 'Warm.', use: { energy: 10 } },
      ],
    });
    const errors = (works: WorksDef[], maps: MapData[] = [town, creek()]) => validateItems(items(works), maps).filter(p => p.level === 'error').map(p => p.message).join('\n');
    expect(errors([BRIDGE, LIGHT])).toBe('');
    expect(errors([BRIDGE])).toMatch(/a lamp belongs to pond-light, but no works says what it takes/);
    expect(errors([BRIDGE, { ...LIGHT, item: 'tea' }])).toMatch(/takes tea: what a place takes is a resource/);
    expect(errors([BRIDGE, { ...LIGHT, item: 'glue' }])).toMatch(/takes glue, which is not an item/);
    expect(errors([BRIDGE, { ...LIGHT, hold: 1 }])).toMatch(/keeps at least a day's wear put by/);
    expect(errors([BRIDGE, { ...LIGHT, wear: 0 }])).toMatch(/wear is a whole number from 1/);
    expect(errors([BRIDGE, { ...LIGHT, build: 'footbridge' }])).toMatch(/a footbridge is a footbridge on its map/);
    expect(errors([BRIDGE, LIGHT, { ...LIGHT, id: 'far-light' }])).toMatch(/nothing on the maps is it/);
    expect(errors([BRIDGE, LIGHT, BRIDGE])).toMatch(/is defined twice/);
  });
});
