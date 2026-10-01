import { describe, expect, it } from 'vitest';
import { TileMap, drained, drawdownAt, untilDrawdown, validateMap, type MapData } from '../src';

const RULE = { every: 600, down: 120, warn: 30 };

/**
 * A lake below a shore path that leads home (row 0, the way home at 0,0): two rows of water between banks; with
 * `island`, a knoll in its lower row (3,2) that only the low water reaches, and with `boat`, an exit on it.
 */
function lake(island = false, boat = false): MapData {
  const tiles = ['ggggggg', 'gwwwwwg', island ? 'xwwgwwx' : 'xwwwwwx', 'xxxxxxx'];
  const bed: Array<[number, number]> = tiles.flatMap((row, y) => [...row].flatMap((c, x) => (c === 'w' ? [[x, y] as [number, number]] : [])));
  return {
    id: 'lake', name: 'Lake', version: 1, kind: 'wilds', depth: 1, width: 7, height: 4, tiles, levels: Array<string>(4).fill('0000000'), spawn: { x: 6, y: 0, dir: 'left' },
    exits: [{ x: 0, y: 0, w: 1, h: 1, to: 'town', tx: 1, ty: 1, dir: 'left', home: true }, ...(boat ? [{ x: 3, y: 2, w: 1, h: 1, to: 'town', tx: 2, ty: 1, dir: 'down' as const }] : [])],
    objects: [], drawdown: { name: 'the lake', tiles: bed, ...RULE },
  };
}
const errors = (d: MapData) => validateMap(d).filter(p => p.level === 'error').map(p => p.message);

describe('a lake that draws down', () => {
  it('keeps a round: low water first, its last part a warning, then full', () => {
    expect(drawdownAt(RULE, 0)).toEqual({ phase: 'down', left: 90 });
    expect(drawdownAt(RULE, 100_000)).toEqual({ phase: 'warn', left: 20 });
    expect(drawdownAt(RULE, 200_000)).toEqual({ phase: 'full', left: 400 });
    expect(drawdownAt({ ...RULE, offset: 100 }, 0).phase).toBe('warn');
    expect([drained(drawdownAt(RULE, 100_000)), drained(drawdownAt(RULE, 200_000))]).toEqual([true, false]);
    expect([untilDrawdown(drawdownAt(RULE, 200_000)), untilDrawdown(drawdownAt(RULE, 0))]).toEqual([400, 0]);
  });

  it('is walked on, and counted on the way home, only while drawn down', () => {
    const m = new TileMap(lake());
    expect([m.walkable(3, 2), m.homeSteps(3, 2), m.bedAt(3, 2), m.drainedAt(3, 2)]).toEqual([false, -1, true, false]);
    expect(m.drain(true)).toBe(true);
    expect(m.drain(true)).toBe(false);
    expect([m.walkable(3, 2), m.homeSteps(3, 2), m.drainedAt(3, 2)]).toEqual([true, 5, true]);
    m.drain(false);
    expect(m.walkable(3, 2)).toBe(false);
    // Winter does not freeze it.
    m.freeze(true);
    expect(m.walkable(3, 2)).toBe(false);
  });

  it('is checked: water tiles, a clock that fits, no ice besides, ground on the way home beside it', () => {
    expect(errors(lake())).toEqual([]);
    expect(errors({ ...lake(), drawdown: { ...lake().drawdown!, down: 700 } }).join()).toMatch(/fill for some of it/);
    expect(errors({ ...lake(), drawdown: { ...lake().drawdown!, warn: 200 } }).join()).toMatch(/inside the low water/);
    expect(errors({ ...lake(), ice: [] }).join()).toMatch(/not both/);
    expect(errors({ ...lake(), drawdown: { ...lake().drawdown!, tiles: [[0, 0]] } }).join()).toMatch(/is not water/);
  });

  it('will not strand anyone on ground only the low water reaches, unless it has a way off', () => {
    expect(errors(lake(true)).join()).toMatch(/stranded/);
    expect(errors(lake(true, true)).filter(e => /stranded/.test(e))).toEqual([]);
  });
});
