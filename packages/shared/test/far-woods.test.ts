/**
 * What the Far Woods added to the contract (map.ts, validate.ts): creatures whose pace is their
 * region's, old growth, and the things that stand there: what is left of a bunkhouse, the yarder and
 * its spools, a bridge laid over a ford, humming rocks, a broken mast, a trapper's things.
 */
import { describe, expect, it } from 'vitest';
import {
  AURORA_WATCHER_STEP_MS, CREATURE_STEP_MIN_MS, DECOR, SKULKER_STEP_MS, STEP_MS, TileMap, WATCHER_STEP_MS, footprint, skulkerStepMs, validateMap, watcherStepMs,
  type MapData, type MapObject,
} from '../src';

/** Open woods 10 by 8 with a creek across row 3, forded at 4,3, and the way home at 4,7. */
function woods(more: Partial<MapData> = {}): MapData {
  return {
    id: 'woods', name: 'Woods', version: 1, kind: 'wilds', depth: 2, width: 10, height: 8,
    tiles: ['tttttttttt', 'tggggggggt', 'tggggggggt', 'twwwmwwwwt', 'tggggggggt', 'tggggfgggt', 'tggggggggt', 'ttttgttttt'],
    levels: Array<string>(8).fill('0000000000'),
    spawn: { x: 4, y: 6, dir: 'up' },
    exits: [{ x: 4, y: 7, w: 1, h: 1, to: 'town', tx: 1, ty: 1, dir: 'down', home: true }],
    objects: [],
    ...more,
  };
}
const errors = (d: MapData) => validateMap(d).filter(p => p.level === 'error').map(p => p.message);
const withObjects = (...objects: MapObject[]) => woods({ objects });

describe('a region\'s creatures, at its own pace', () => {
  it('step as their rule says, or at the pace creatures always had, quicker by the same share on an aurora night', () => {
    expect(watcherStepMs(undefined, false)).toBe(WATCHER_STEP_MS);
    expect(watcherStepMs(undefined, true)).toBe(AURORA_WATCHER_STEP_MS);
    expect(watcherStepMs({ count: 1, steps: [0, 9], stepMs: 460 }, false)).toBe(460);
    expect(watcherStepMs({ count: 1, steps: [0, 9], stepMs: 460 }, true)).toBe(354);
    expect(skulkerStepMs(undefined)).toBe(SKULKER_STEP_MS);
    expect(skulkerStepMs({ count: 1, steps: [0, 9], when: ['night'], stepMs: 230 })).toBe(230);
  });

  it('are never as quick as you: the validator holds every pace, a watcher\'s on an aurora night too, a tenth slower than a step', () => {
    expect(CREATURE_STEP_MIN_MS).toBe(Math.round(STEP_MS * 1.1));
    expect(errors(woods({ watchers: { count: 1, steps: [0, 9], stepMs: 460 } }))).toEqual([]);
    expect(errors(woods({ watchers: { count: 1, steps: [0, 9], stepMs: 280 } })).join()).toMatch(/watchers: stepMs/);
    expect(errors(woods({ watchers: { count: 1, steps: [0, 9], stepMs: 460.5 } })).join()).toMatch(/watchers: stepMs/);
    expect(errors(woods({ skulkers: { count: 1, steps: [0, 9], when: ['night'], stepMs: 230 } }))).toEqual([]);
    expect(errors(woods({ skulkers: { count: 1, steps: [0, 9], when: ['night'], stepMs: 200 } })).join()).toMatch(/skulkers: stepMs/);
  });
});

describe('old growth', () => {
  it('is said of the wilds only', () => {
    expect(errors(woods({ forest: 'old' }))).toEqual([]);
    expect(errors(woods({ forest: 'young' as 'old' })).join()).toMatch(/forest "young"/);
    expect(errors(woods({ kind: 'town', depth: 0, exits: [], forest: 'old' })).join()).toMatch(/only the wilds say how their forest grows/);
  });
});

describe('what stands in the Far Woods', () => {
  it('is as big as each is: a bunkhouse\'s ruin its own size, the yarder two by two, the rest a tile', () => {
    expect(footprint({ kind: 'ruin', x: 1, y: 1, w: 5, h: 3 })).toEqual([5, 3]);
    expect(footprint({ kind: 'yarder', x: 1, y: 1 })).toEqual([2, 2]);
    for (const o of [{ kind: 'spool', x: 1, y: 1 }, { kind: 'traps', x: 1, y: 1 }, { kind: 'bridge', x: 4, y: 3, dir: 'v' }] as MapObject[]) expect(footprint(o), o.kind).toEqual([1, 1]);
  });

  it('stands in the way, but a bridge, which is walked over', () => {
    const map = new TileMap(withObjects({ kind: 'ruin', x: 1, y: 4, w: 2, h: 2 }, { kind: 'yarder', x: 6, y: 4 }, { kind: 'spool', x: 8, y: 1 }, { kind: 'bridge', x: 4, y: 3, dir: 'v' }));
    for (const [x, y] of [[1, 4], [2, 5], [6, 4], [7, 5], [8, 1]] as const) expect(map.walkable(x, y), `${x},${y}`).toBe(false);
    expect(DECOR.has('bridge')).toBe(true);
    expect(map.walkable(4, 3)).toBe(true);
  });

  it('keeps a ruin between 2 and 6 wide and 2 and 4 deep', () => {
    expect(errors(withObjects({ kind: 'ruin', x: 1, y: 4, w: 2, h: 2 }))).toEqual([]);
    expect(errors(withObjects({ kind: 'ruin', x: 1, y: 4, w: 1, h: 2 })).join()).toMatch(/ruin at 1,4 is 1 by 2/);
  });

  it('lays a bridge on a ford, the water beside it across the way it runs', () => {
    expect(errors(withObjects({ kind: 'bridge', x: 4, y: 3, dir: 'v' }))).toEqual([]);
    // Across a ford that runs north to south the water is east and west; a bridge "running" east to west there has none beside it.
    expect(errors(withObjects({ kind: 'bridge', x: 4, y: 3, dir: 'h' })).join()).toMatch(/bridge at 4,3: it lies on a ford/);
    expect(errors(withObjects({ kind: 'bridge', x: 5, y: 3, dir: 'v' })).join()).toMatch(/bridge at 5,3: it lies on a ford/);
    expect(errors(withObjects({ kind: 'bridge', x: 4, y: 3, dir: 'x' as 'h' })).join()).toMatch(/dir is h/);
  });

  it('says of a rock whether it hums and of a mast whether it is broken, and nothing else', () => {
    expect(errors(withObjects({ kind: 'rock', x: 2, y: 1, s: 1, v: 0, hum: true }, { kind: 'antenna', x: 6, y: 1, broken: true }))).toEqual([]);
    expect(errors(withObjects({ kind: 'rock', x: 2, y: 1, s: 1, v: 0, hum: 'yes' as unknown as boolean })).join()).toMatch(/rock at 2,1: hum/);
  });
});
