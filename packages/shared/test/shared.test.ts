import { describe, expect, it } from 'vitest';
import {
  DRAIN_GROWTH_STEPS, DRAIN_PER_SECOND, REFILL_PER_SECOND, TileMap, WEATHER_DRAIN, dirOf, dirToward, energyAfter, energyRate,
  findPath, parseClientMsg, stepTarget, validateMap, validateWorld, type MapData,
} from '../src';

/** A 6x5 town: water on the right, a house in the middle, a raised tile top-left. */
function tinyMap(): MapData {
  return {
    id: 'tiny', name: 'Tiny', version: 1, kind: 'town', depth: 0, width: 6, height: 5,
    tiles: ['ggggww', 'ggggww', 'grrrww', 'ggggww', 'ffggww'],
    levels: ['100000', '000000', '000000', '000000', '000000'],
    spawn: { x: 1, y: 3, dir: 'down' },
    exits: [],
    objects: [
      { kind: 'house', x: 1, y: 0, w: 3, h: 2, roof: '#6b7075', lit: 1 },
      { kind: 'sign', x: 3, y: 3, text: ['Hello'] },
      { kind: 'shrooms', x: 0, y: 4 },
    ],
  };
}

/**
 * A 7x6 patch of woods: a ring of path inside the forest, a street lamp in the top-left corner of
 * the ring and the way home (to the town above) at the bottom.
 */
function woodsMap(): MapData {
  return {
    id: 'woods', name: 'Woods', version: 1, kind: 'wilds', depth: 1, width: 7, height: 6,
    tiles: ['tttgttt', 'tgggggt', 'tgtttgt', 'tgtttgt', 'tgggggt', 'tttmttt'],
    levels: Array<string>(6).fill('0000000'),
    spawn: { x: 3, y: 4, dir: 'up' },
    exits: [{ x: 3, y: 5, w: 1, h: 1, to: 'tiny', tx: 1, ty: 3, dir: 'down', home: true }],
    objects: [{ kind: 'lamp', x: 1, y: 1 }],
  };
}

/** The town with a way into the woods: two tiles of road that keep their offset. */
function townWithExit(): MapData {
  const m = tinyMap();
  m.exits = [{ x: 1, y: 2, w: 2, h: 1, to: 'woods', tx: 2, ty: 4, dir: 'up' }];
  return m;
}

describe('TileMap', () => {
  const map = new TileMap(tinyMap());
  it('knows what can be walked on', () => {
    expect(map.walkable(0, 2)).toBe(true);
    expect(map.walkable(4, 2)).toBe(false); // water
    expect(map.walkable(2, 1)).toBe(false); // house footprint
    expect(map.walkable(3, 3)).toBe(false); // sign
    expect(map.walkable(0, 0)).toBe(false); // raised tile
    expect(map.walkable(0, 4)).toBe(true); // mushrooms are decoration
    expect(map.walkable(-1, 0)).toBe(false);
    expect(map.walkable(1.5, 2)).toBe(false);
  });
  it('reads tile kinds', () => {
    expect(map.kind(1, 2)).toBe('road');
    expect(map.kind(0, 4)).toBe('ferns');
    expect(map.kind(9, 9)).toBeUndefined();
  });
  it('rejects unknown tiles', () => {
    const bad = tinyMap();
    bad.tiles[0] = 'ggggwX';
    expect(() => new TileMap(bad)).toThrow(/unknown tile/);
  });
});

describe('exits, light and the way home', () => {
  const woods = new TileMap(woodsMap());
  const town = new TileMap(townWithExit());
  it('does not walk through forest', () => {
    expect(woods.walkable(0, 0)).toBe(false);
    expect(woods.walkable(3, 0)).toBe(true);
  });
  it('says where an exit leads, keeping the offset within the exit', () => {
    expect(woods.exitAt(3, 5)).toEqual({ to: 'tiny', x: 1, y: 3, dir: 'down' });
    expect(woods.exitAt(3, 4)).toBeUndefined();
    expect(town.exitAt(1, 2)).toEqual({ to: 'woods', x: 2, y: 4, dir: 'up' });
    expect(town.exitAt(2, 2)).toEqual({ to: 'woods', x: 3, y: 4, dir: 'up' });
    expect(town.exitAt(-1, 2)).toBeUndefined();
  });
  it('knows where the street lights reach', () => {
    expect(woods.lit(2, 1)).toBe(true);
    expect(woods.lit(1, 3)).toBe(true);
    expect(woods.lit(1, 4)).toBe(false);
    expect(town.lit(0, 3)).toBe(false);
  });
  it('counts walking steps to the home exit', () => {
    expect(woods.homeSteps(3, 5)).toBe(0);
    expect(woods.homeSteps(3, 4)).toBe(1);
    expect(woods.homeSteps(1, 2)).toBe(5);
    // Round the right side: the lamp blocks the short way on the left.
    expect(woods.homeSteps(3, 1)).toBe(8);
    expect(woods.homeSteps(0, 0)).toBe(-1);
    expect(town.homeSteps(0, 3)).toBe(0);
  });
});

describe('energy', () => {
  const woods = new TileMap(woodsMap());
  const town = new TileMap(tinyMap());
  it('refills in town and under street lights', () => {
    expect(energyRate(town, 0, 3, 'rain')).toBe(REFILL_PER_SECOND);
    expect(energyRate(woods, 2, 1, 'night')).toBe(REFILL_PER_SECOND);
  });
  it('drains in the wilds, more the farther from home and in bad weather', () => {
    const edge = energyRate(woods, 3, 4, 'overcast');
    expect(edge).toBeCloseTo(-DRAIN_PER_SECOND * (1 + 1 / DRAIN_GROWTH_STEPS));
    // 4,1 is seven steps from home and just outside the lamp's light.
    expect(energyRate(woods, 4, 1, 'overcast')).toBeCloseTo(-DRAIN_PER_SECOND * (1 + 7 / DRAIN_GROWTH_STEPS));
    expect(energyRate(woods, 3, 4, 'rain')).toBeCloseTo(edge * WEATHER_DRAIN.rain);
    expect(energyRate(woods, 3, 4, 'night')).toBeLessThan(energyRate(woods, 3, 4, 'rain'));
  });
  it('drains faster in deeper regions', () => {
    const deep = new TileMap({ ...woodsMap(), depth: 3 });
    expect(energyRate(deep, 3, 4, 'overcast')).toBeCloseTo(3 * energyRate(woods, 3, 4, 'overcast'));
  });
  it('counts forward between updates, never past empty or full', () => {
    expect(energyAfter({ value: 50, max: 100, rate: -2 }, 10)).toBe(30);
    expect(energyAfter({ value: 5, max: 100, rate: -2 }, 10)).toBe(0);
    expect(energyAfter({ value: 95, max: 100, rate: 8 }, 10)).toBe(100);
  });
});

describe('movement', () => {
  const map = new TileMap(tinyMap());
  it('finds a path around obstacles', () => {
    const path = findPath(map, 0, 3, 3, 4);
    expect(path.at(-1)).toEqual({ x: 3, y: 4 });
    let x = 0, y = 3;
    for (const p of path) {
      expect(Math.abs(p.x - x) + Math.abs(p.y - y)).toBe(1);
      expect(map.walkable(p.x, p.y)).toBe(true);
      x = p.x; y = p.y;
    }
  });
  it('walks to the closest reachable tile when the target is blocked', () => {
    const path = findPath(map, 0, 3, 5, 2);
    expect(path.at(-1)).toEqual({ x: 3, y: 2 });
  });
  it('can stop next to something', () => {
    const path = findPath(map, 0, 3, 3, 3, true);
    const end = path.at(-1)!;
    expect(Math.abs(end.x - 3) + Math.abs(end.y - 3)).toBe(1);
  });
  it('converts directions', () => {
    expect(stepTarget(2, 2, 'left')).toEqual({ x: 1, y: 2 });
    expect(dirOf(0, -1)).toBe('up');
    expect(dirOf(1, 1)).toBeNull();
    expect(dirToward(-3, 1)).toBe('left');
    expect(dirToward(1, 4)).toBe('down');
  });
});

describe('protocol', () => {
  it('accepts valid messages', () => {
    expect(parseClientMsg('{"t":"hello","v":1,"name":"Aldo"}')).toEqual({ t: 'hello', v: 1, name: 'Aldo' });
    expect(parseClientMsg('{"t":"step","dir":"up","seq":3}')).toEqual({ t: 'step', dir: 'up', seq: 3 });
    expect(parseClientMsg('{"t":"face","dir":"left"}')).toEqual({ t: 'face', dir: 'left' });
  });
  it('rejects anything else', () => {
    for (const raw of [
      'not json',
      '{"t":"step","dir":"north","seq":1}',
      '{"t":"step","dir":"up","seq":-1}',
      '{"t":"step","dir":"up","seq":1.5}',
      '{"t":"hello","v":1,"name":"x"}',
      '{"t":"hello","v":1,"name":"<script>"}',
      '{"t":"teleport","x":5,"y":5}',
      JSON.stringify({ t: 'hello', v: 1, name: 'A'.repeat(2000) }),
    ]) expect(parseClientMsg(raw), raw).toBeNull();
  });
});

describe('validateMap', () => {
  it('passes a good map', () => {
    expect(validateMap(tinyMap()).filter(p => p.level === 'error')).toEqual([]);
  });
  it('catches overlaps, bad spawns and unreadable signs', () => {
    const m = tinyMap();
    m.objects.push({ kind: 'lamp', x: 2, y: 1 });
    m.objects.push({ kind: 'sign', x: 0, y: 4, text: ['Nobody can stand below me'] });
    m.spawn = { x: 4, y: 0, dir: 'down' };
    const msgs = validateMap(m).map(p => p.message).join('\n');
    expect(msgs).toMatch(/overlaps/);
    expect(msgs).toMatch(/spawn 4,0 is not walkable/);
    expect(msgs).toMatch(/tile in front/);
  });
  it('passes good woods and a town with an exit', () => {
    expect(validateMap(woodsMap())).toEqual([]);
    expect(validateMap(townWithExit()).filter(p => p.level === 'error')).toEqual([]);
  });
  it('catches bad kinds, depths and exits', () => {
    const noHome = woodsMap();
    noHome.exits[0]!.home = undefined;
    expect(validateMap(noHome).map(p => p.message).join('\n')).toMatch(/exit marked home/);
    const deepTown = { ...tinyMap(), depth: 1 };
    expect(validateMap(deepTown).map(p => p.message).join('\n')).toMatch(/town has depth 0/);
    const intoWater = tinyMap();
    intoWater.exits = [{ x: 4, y: 2, w: 1, h: 1, to: 'woods', tx: 3, ty: 4, dir: 'up' }];
    expect(validateMap(intoWater).map(p => p.message).join('\n')).toMatch(/not walkable/);
  });
});

describe('validateWorld', () => {
  it('passes maps that fit together', () => {
    expect(validateWorld([townWithExit(), woodsMap()], 'tiny')).toEqual([]);
  });
  it('catches exits to nowhere, into walls or onto other exits', () => {
    const town = townWithExit();
    town.exits.push({ x: 0, y: 3, w: 1, h: 1, to: 'nowhere', tx: 0, ty: 0, dir: 'up' });
    const woods = woodsMap();
    woods.exits[0]!.ty = 0; // arrives inside the house
    const msgs = validateWorld([town, woods], 'tiny').map(p => `${p.map}: ${p.message}`).join('\n');
    expect(msgs).toMatch(/tiny: .*no map nowhere/);
    expect(msgs).toMatch(/woods: .*not walkable/);
    const bounce = townWithExit();
    bounce.exits[0]!.tx = 3;
    bounce.exits[0]!.ty = 5; // the first lane would land on the woods' own exit and bounce back
    expect(validateWorld([bounce, woodsMap()], 'tiny').map(p => p.message).join('\n')).toMatch(/which is an exit itself/);
  });
  it('wants a town at home and every map reachable from it', () => {
    expect(validateWorld([woodsMap()], 'tiny').map(p => p.message).join('\n')).toMatch(/home map tiny does not exist/);
    const msgs = validateWorld([tinyMap(), woodsMap()], 'tiny');
    expect(msgs).toContainEqual({ level: 'warning', map: 'woods', message: 'cannot be reached from tiny' });
  });
});
