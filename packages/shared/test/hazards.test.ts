import { describe, expect, it } from 'vitest';
import {
  DRAIN_GROWTH_STEPS, DRAIN_PER_SECOND, FLASH_BURST_S, FLASH_DRAIN, STORM_CHILL, STORM_DRAIN, TileMap, WET_DRAIN, WET_SECONDS, energyRate, flashHits, stormAt,
  validateItems, validateMap, wetRate, type ItemsData, type MapData,
} from '../src';

/** A 5x6 strip of wilds, the way home at the bottom. */
function strip(more: Partial<MapData> = {}): MapData {
  return {
    id: 'strip', name: 'Strip', version: 1, kind: 'wilds', depth: 1, width: 5, height: 6,
    tiles: ['ggggg', 'ggggg', 'ggggg', 'ggggg', 'ggggg', 'ttgtt'],
    levels: Array<string>(6).fill('00000'),
    spawn: { x: 2, y: 4, dir: 'up' },
    exits: [{ x: 2, y: 5, w: 1, h: 1, to: 'town', tx: 0, ty: 0, dir: 'down', home: true }],
    objects: [],
    ...more,
  };
}
const map = new TileMap(strip());
/** The plain drain at 3,3, overcast. */
const base = -DRAIN_PER_SECOND * (1 + 3 / DRAIN_GROWTH_STEPS);

describe('storms', () => {
  it('runs a round of clear, a warning, then the storm, by the wall clock', () => {
    const rule = { every: 100, warn: 10, length: 20 };
    expect(stormAt(rule, 0)).toEqual({ phase: 'clear', left: 70 });
    expect(stormAt(rule, 75_000)).toEqual({ phase: 'coming', left: 5 });
    expect(stormAt(rule, 90_000)).toEqual({ phase: 'storm', left: 10 });
    // The offset moves the round: this one's storm is over at 50 seconds past each 100.
    expect(stormAt({ ...rule, offset: 50 }, 40_000)).toEqual({ phase: 'storm', left: 10 });
  });

  it('drains faster out in one, less with wind and electricity resistance, and chills you when wet', () => {
    expect(energyRate(map, 3, 3, 'overcast', { storm: true })).toBeCloseTo(base * STORM_DRAIN, 10);
    expect(energyRate(map, 3, 3, 'overcast', { storm: true, resist: { wind: 1 } })).toBeCloseTo(base * (1 + (STORM_DRAIN - 1) / 2), 10);
    expect(energyRate(map, 3, 3, 'overcast', { storm: true, resist: { wind: 1, electricity: 1 } })).toBeCloseTo(base, 10);
    expect(energyRate(map, 3, 3, 'overcast', { storm: true, wet: 1 })).toBeCloseTo(base * STORM_DRAIN * (1 + WET_DRAIN * STORM_CHILL), 10);
    expect(energyRate(map, 3, 3, 'overcast', { storm: true, wet: 1, resist: { cold: 0.5 } })).toBeCloseTo(base * STORM_DRAIN * (1 + (WET_DRAIN * STORM_CHILL) / 2), 10);
    // A roof keeps it all off: insides never drain.
    expect(energyRate(new TileMap(strip({ kind: 'inside' })), 3, 3, 'overcast', { storm: true })).toBe(0);
  });

  it('soaks you like rain outdoors, never under a roof', () => {
    expect(wetRate('wilds', 'night', false, 1, true)).toBeCloseTo(1 / WET_SECONDS, 10);
    expect(wetRate('inside', 'night', false, 1, true)).toBeLessThan(0);
  });
});

describe('flashes', () => {
  it('hit only the tiles around them, and only while they discharge', () => {
    const f = { x: 2, y: 2, kind: 'spark' as const, left: FLASH_BURST_S };
    expect(flashHits(f, 3, 3)).toBe(true);
    expect(flashHits(f, 4, 2)).toBe(false);
    expect(flashHits({ ...f, left: FLASH_BURST_S + 1 }, 2, 2)).toBe(false);
    expect(flashHits({ ...f, left: 0 }, 2, 2)).toBe(false);
  });

  it('drain fast: heat cuts a fire flash, electricity a spark', () => {
    expect(energyRate(map, 3, 3, 'overcast', { flash: 'spark' })).toBeCloseTo(base * FLASH_DRAIN, 10);
    expect(energyRate(map, 3, 3, 'overcast', { flash: 'spark', resist: { heat: 1 } })).toBeCloseTo(base * FLASH_DRAIN, 10);
    expect(energyRate(map, 3, 3, 'overcast', { flash: 'spark', resist: { electricity: 0.5 } })).toBeCloseTo(base * (1 + (FLASH_DRAIN - 1) / 2), 10);
    expect(energyRate(map, 3, 3, 'overcast', { flash: 'fire', resist: { heat: 0.5 } })).toBeCloseTo(base * (1 + (FLASH_DRAIN - 1) / 2), 10);
  });
});

describe('validation of storms and flashes', () => {
  const msgs = (d: MapData) => validateMap(d).filter(p => p.level === 'error').map(p => p.message);

  it('checks storm and flash rules', () => {
    expect(msgs(strip({ storm: { every: 100, warn: 10, length: 20 }, flashes: { every: 60, steps: [2, 9] } }))).toEqual([]);
    expect(msgs(strip({ storm: { every: 30, warn: 10, length: 20 } }))).toEqual(['storm: warn and length must leave clear time in every round']);
    expect(msgs(strip({ flashes: { every: 5, steps: [2, 9] } }))).toEqual(['flashes: every must be longer than one flash']);
    expect(msgs(strip({ kind: 'town', depth: 0, storm: { every: 100, warn: 10, length: 20 } }))).toContain('only the wilds storm');
  });

  it('lets finds grow during a storm only where it storms', () => {
    const items: ItemsData = {
      version: 1,
      items: [{ id: 'shard', name: 'Shard', kind: 'resource', stack: 5, text: 'Glass.' }],
      finds: [{ item: 'shard', map: 'strip', count: 1, respawn: [60, 120], when: 'storm' }],
    };
    const errors = (m: MapData) => validateItems(items, [m]).filter(p => p.level === 'error').map(p => p.message);
    expect(errors(strip({ storm: { every: 100, warn: 10, length: 20 } }))).toEqual([]);
    expect(errors(strip())).toEqual(['find 0 (shard in strip): grows during a storm, but strip never storms']);
  });
});
