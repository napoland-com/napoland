import { describe, expect, it } from 'vitest';
import { TileMap, findPath, parseClientMsg, validateMap, dirToward, dirOf, stepTarget, type MapData } from '../src';

/** A 6x5 test map: water on the right, a house in the middle, a raised tile top-left. */
function tinyMap(): MapData {
  return {
    id: 'tiny', name: 'Tiny', version: 1, width: 6, height: 5,
    tiles: ['ggggww', 'ggggww', 'grrrww', 'ggggww', 'ffggww'],
    levels: ['100000', '000000', '000000', '000000', '000000'],
    spawn: { x: 1, y: 3, dir: 'down' },
    objects: [
      { kind: 'house', x: 1, y: 0, w: 3, h: 2, roof: '#6b7075', lit: 1 },
      { kind: 'sign', x: 3, y: 3, text: ['Hello'] },
      { kind: 'shrooms', x: 0, y: 4 },
    ],
  };
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
});
