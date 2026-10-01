/**
 * Places you can see but not reach yet (roadmap/locked-places.md): tiles that open only for whoever holds
 * a tool (TileMap.walkable's pass): the flooded culvert, water to all but waders, and a padlocked door,
 * shut to all but bolt cutters. Pathing goes through them with the pass and round them without; how far
 * home any tile is never changes by them.
 */
import { describe, expect, it } from 'vitest';
import { TILE_CHARS, TILE_NEEDS, TileMap, energyRate, findPath, validateItems, validateMap, validateWorld, watery, type ItemsData, type MapData } from '../src';

/**
 *   012345678
 * 0 ttttttttt
 * 1 tgcccSSgt   c: the culvert (2,1) to (4,1); S: a shed (6,1), 2 by 2
 * 2 tgtttSDgt   D: its door (7,2), padlocked: bolt cutters open it
 * 3 tgggggggt
 * 4 ttttmtttt   the way home (4,4)
 */
function woods(): MapData {
  return {
    id: 'locked-woods', name: 'Locked woods', version: 1, kind: 'wilds', depth: 1, width: 9, height: 5,
    tiles: ['ttttttttt', 'tgcccgggt', 'tgtttgggt', 'tgggggggt', 'ttttmtttt'],
    levels: Array<string>(5).fill('000000000'),
    spawn: { x: 4, y: 3, dir: 'up' },
    exits: [
      { x: 4, y: 4, w: 1, h: 1, to: 'town', tx: 0, ty: 0, dir: 'down', home: true },
      { x: 7, y: 2, w: 1, h: 1, to: 'shed-room', tx: 1, ty: 1, dir: 'up', lock: 'bolt-cutters' },
    ],
    objects: [{ kind: 'house', x: 6, y: 1, w: 2, h: 2, roof: '#4c5646', lit: 0, style: 'shed' }],
  };
}
const WADERS = new Set(['waders']), CUTTERS = new Set(['bolt-cutters']), BOTH = new Set(['waders', 'bolt-cutters']);

describe('the culvert and a padlocked door', () => {
  const map = new TileMap(woods());

  it('are a tile kind of their own, water in all but name, and a lock on an exit', () => {
    expect(TILE_CHARS.c).toBe('culvert');
    expect(TILE_NEEDS.culvert).toBe('waders');
    expect(map.kind(3, 1)).toBe('culvert');
    expect([watery('culvert'), watery('water'), watery('mud')]).toEqual([true, true, false]);
  });

  it('are walkable only for whoever holds what opens them: waders the culvert, bolt cutters the door', () => {
    for (const x of [2, 3, 4]) {
      expect(map.walkable(x, 1), `${x},1`).toBe(false);
      expect(map.walkable(x, 1, CUTTERS), `${x},1`).toBe(false);
      expect(map.walkable(x, 1, WADERS), `${x},1`).toBe(true);
    }
    expect(map.walkable(7, 2)).toBe(false);
    expect(map.walkable(7, 2, WADERS)).toBe(false);
    expect(map.walkable(7, 2, CUTTERS)).toBe(true);
    // Ground anyone walks is walked with any pass or none; forest and the shed's walls with none.
    for (const pass of [undefined, WADERS, BOTH]) {
      expect(map.walkable(1, 1, pass)).toBe(true);
      expect(map.walkable(2, 2, pass)).toBe(false);
      expect(map.walkable(6, 1, pass)).toBe(false);
    }
  });

  it('say what they take, and are passable for someone who holds all of it', () => {
    expect([map.needs(3, 1), map.needs(7, 2), map.needs(1, 1), map.needs(2, 2)]).toEqual(['waders', 'bolt-cutters', undefined, undefined]);
    expect(map.keys).toEqual(['waders', 'bolt-cutters']);
    expect(map.passable(3, 1) && map.passable(7, 2) && map.passable(1, 1)).toBe(true);
    expect(map.passable(2, 2)).toBe(false);
  });

  it('are found through by findPath with the pass, and gone round without it', () => {
    expect(findPath(map, 1, 1, 5, 1)).toHaveLength(8);
    expect(findPath(map, 1, 1, 5, 1, false, 5000, WADERS)).toEqual([{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 }]);
    // Up to the padlocked door and no farther without bolt cutters; through it with them.
    expect(findPath(map, 7, 3, 7, 2)).toEqual([]);
    expect(findPath(map, 5, 3, 7, 2, false, 5000, WADERS).at(-1)).toEqual({ x: 7, y: 3 });
    expect(findPath(map, 5, 3, 7, 2, false, 5000, CUTTERS)).toEqual([{ x: 6, y: 3 }, { x: 7, y: 3 }, { x: 7, y: 2 }]);
  });

  it('change no tile\'s way home: a locked tile is as far as the way to it, then along the locked ones', () => {
    // The same woods with forest where the culvert runs, and no door there.
    const plain = new TileMap({ ...woods(), tiles: woods().tiles.map(r => r.replaceAll('c', 't')), exits: woods().exits.slice(0, 1), objects: [] });
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      if (plain.walkable(x, y) && !(x >= 6 && x <= 7 && y >= 1 && y <= 2)) expect(map.homeSteps(x, y), `${x},${y}`).toBe(plain.homeSteps(x, y));
    }
    // From its ends inward: (1,1) is 6 steps, (5,1) 4; the door one step past the tile in front of it.
    expect([map.homeSteps(2, 1), map.homeSteps(3, 1), map.homeSteps(4, 1)]).toEqual([7, 6, 5]);
    expect(map.homeSteps(7, 2)).toBe(map.homeSteps(7, 3) + 1);
    // Where a surge starts is measured without them.
    expect(map.deepest).toBe(6);
    // So the drain in the culvert is the ground's around it, never that of a tile with no way home.
    expect(energyRate(map, 3, 1, 'overcast')).toBeCloseTo(energyRate(map, 1, 1, 'overcast'), 5);
  });

  it('are content the validators know: a shed is 2 by 2, a lock is on a door into a room, and what opens the way is a tool', () => {
    expect(validateMap(woods())).toEqual([]);
    const messages = (data: MapData) => validateMap(data).map(p => p.message).join('\n');
    const bigShed = woods();
    bigShed.objects[0] = { kind: 'house', x: 6, y: 1, w: 3, h: 2, roof: '#4c5646', lit: 0, style: 'shed' };
    expect(messages(bigShed)).toMatch(/a shed is 2 by 2/);
    const lockedHome = woods();
    lockedHome.exits[0] = { ...lockedHome.exits[0]!, lock: 'bolt-cutters' };
    expect(messages(lockedHome)).toMatch(/the way home is never locked/);
    const wetExit = woods();
    wetExit.exits.push({ x: 3, y: 1, w: 1, h: 1, to: 'town', tx: 0, ty: 0, dir: 'up' });
    expect(messages(wetExit)).toMatch(/tile 3,1 opens only with waders: an exit is on open ground, or locked/);

    const room: MapData = {
      id: 'shed-room', name: 'Shed', version: 1, kind: 'inside', depth: 0, width: 3, height: 3, tiles: ['xxx', 'xpx', 'xpx'], levels: ['000', '000', '000'],
      spawn: { x: 1, y: 1, dir: 'up' }, exits: [{ x: 1, y: 2, w: 1, h: 1, to: 'locked-woods', tx: 7, ty: 3, dir: 'down' }], objects: [], style: 'shed',
    };
    const town: MapData = {
      id: 'town', name: 'Town', version: 1, kind: 'town', depth: 0, width: 1, height: 1, tiles: ['g'], levels: ['0'], spawn: { x: 0, y: 0, dir: 'down' },
      exits: [], objects: [],
    };
    expect(validateWorld([town, woods(), room], 'town').filter(p => p.level === 'error')).toEqual([]);
    const toTown = woods();
    toTown.exits[1] = { ...toTown.exits[1]!, to: 'town' };
    expect(validateWorld([town, toTown, room], 'town').map(p => p.message).join('\n')).toMatch(/a lock is only ever on a door into a room/);

    const items = (waders: 'tool' | 'resource'): ItemsData => ({
      version: 1, finds: [],
      items: [
        // Everyone's starter maps, which must be tools once there are tools at all.
        ...['stonebrook-map', 'near-woods-map', 'south-road-map', 'reservoir-map'].map(id => ({ id, name: 'A map', kind: 'tool' as const, stack: 1, icon: 'map' as const, text: 'Drawn by hand.' })),
        { id: 'bolt-cutters', name: 'Bolt cutters', kind: 'tool', stack: 1, icon: 'cutters', text: 'They cut.' },
        ...(waders === 'tool' ? [{ id: 'waders', name: 'Waders', kind: 'tool' as const, stack: 1, icon: 'waders' as const, text: 'They wade.' }] : [{ id: 'waders', name: 'Waders', kind: 'resource' as const, stack: 1, text: 'Just rubber.' }]),
      ],
    });
    expect(validateItems(items('tool'), [woods()]).filter(p => p.level === 'error')).toEqual([]);
    expect(validateItems(items('resource'), [woods()]).map(p => p.message)).toContain('map locked-woods: some of it opens only with waders, which is not a tool: what opens the way is yours for good');
    expect(validateItems({ ...items('tool'), items: items('tool').items.filter(i => i.id !== 'bolt-cutters') }, [woods()]).map(p => p.message)).toContain('map locked-woods: some of it opens only with bolt-cutters, which is not an item');
  });
});
