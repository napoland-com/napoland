import { describe, expect, it } from 'vitest';
import {
  DAY_S, TileMap, activeConditions, conditionsAt, dayIndex, findTiles, seeded, validateItems, weatherAt, weekIndex,
  type ConditionsData, type ItemsData, type MapData,
} from '../src';
import json from '../../../content/items.json';

const content = json as unknown as ItemsData;
const DATA = content.conditions!;
const DAY_MS = DAY_S * 1000;
const WEEK_MS = 7 * 86_400_000;
/** A Monday, 00:00 UTC. */
const MONDAY = Date.UTC(2026, 8, 28);

describe('the day and the week', () => {
  it('a day starts at dawn, as the night ends', () => {
    const dawn = 1000 * DAY_MS;
    expect(dayIndex(dawn)).toBe(1000);
    expect(dayIndex(dawn - 1)).toBe(999);
    expect(weatherAt(dawn - 1).weather).not.toBe('overcast');
    expect(weatherAt(dawn).weather).toBe('overcast');
  });

  it('a week turns on Monday at 00:00 UTC, always at a dawn', () => {
    expect(weekIndex(MONDAY)).toBe(weekIndex(MONDAY - 1) + 1);
    expect(weekIndex(MONDAY + WEEK_MS - 1)).toBe(weekIndex(MONDAY));
    expect(MONDAY % DAY_MS).toBe(0);
  });

  it('seeded dice are the same for the same seed, and spread from 0 to 1', () => {
    const a = seeded(42), b = seeded(42);
    const rolls = Array.from({ length: 1000 }, () => a());
    expect(rolls).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(Math.min(...rolls)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...rolls)).toBeLessThan(1);
    expect(rolls.reduce((s, v) => s + v, 0) / rolls.length).toBeCloseTo(0.5, 1);
    expect(seeded(43)()).not.toBe(seeded(42)());
  });
});

describe('conditionsAt', () => {
  const dawn = 20_000 * DAY_MS;

  it('gives the same answer for the same wall time, and all day long', () => {
    const today = conditionsAt(DATA, dawn);
    expect(conditionsAt(DATA, dawn)).toEqual(today);
    for (const t of [1, 60_000, DAY_MS / 2, DAY_MS - 1]) expect(conditionsAt(DATA, dawn + t)).toEqual(today);
  });

  it('draws again at the next dawn', () => {
    const days = Array.from({ length: 20 }, (_, d) => conditionsAt(DATA, dawn + d * DAY_MS).today.join());
    expect(new Set(days).size).toBeGreaterThan(5);
    expect(conditionsAt(DATA, dawn + DAY_MS - 1).today).toEqual(conditionsAt(DATA, dawn).today);
  });

  it('draws one or two, never the same twice, never two of one group', () => {
    const groups = new Map(DATA.daily.map(c => [c.id, c.group]));
    let twos = 0;
    for (let d = 0; d < 3000; d++) {
      const { today } = conditionsAt(DATA, dawn + d * DAY_MS);
      expect(today.length === 1 || today.length === 2).toBe(true);
      if (today.length === 2) {
        twos++;
        expect(today[0]).not.toBe(today[1]);
        const [g0, g1] = today.map(id => groups.get(id));
        if (g0 !== undefined) expect(g1).not.toBe(g0);
      }
    }
    // second: 0.5
    expect(twos / 3000).toBeGreaterThan(0.45);
    expect(twos / 3000).toBeLessThan(0.55);
  });

  it('over 3000 days, the first draw follows the weights within 20%', () => {
    const count = new Map<string, number>();
    for (let d = 0; d < 3000; d++) {
      const first = conditionsAt(DATA, dawn + d * DAY_MS).today[0]!;
      count.set(first, (count.get(first) ?? 0) + 1);
    }
    const total = DATA.daily.reduce((n, c) => n + c.weight!, 0);
    for (const c of DATA.daily) {
      const expected = (3000 * c.weight!) / total;
      expect(Math.abs((count.get(c.id) ?? 0) - expected) / expected, c.id).toBeLessThan(0.2);
    }
  });

  it('the weekly ones come round in order, and next is the one after', () => {
    const data: ConditionsData = { ...DATA, weekly: [
      { id: 'a', name: 'A', text: 'A.', map: 'woods' }, { id: 'b', name: 'B', text: 'B.', map: 'woods' }, { id: 'c', name: 'C', text: 'C.', map: 'woods' },
    ] };
    const weeks = Array.from({ length: 6 }, (_, w) => conditionsAt(data, MONDAY + w * WEEK_MS + 1000));
    const order = weeks.map(v => v.week);
    const start = ['a', 'b', 'c'].indexOf(order[0]!);
    expect(order).toEqual(Array.from({ length: 6 }, (_, w) => ['a', 'b', 'c'][(start + w) % 3]));
    weeks.forEach((v, w) => expect(v.next).toBe(order[w + 1] ?? ['a', 'b', 'c'][(start + 6) % 3]));
    // All week the same, whatever the day.
    expect(conditionsAt(data, MONDAY + WEEK_MS - 1).week).toBe(order[0]);
  });

  it('knows nothing without conditions, and says which are on', () => {
    expect(conditionsAt(undefined, dawn)).toEqual({ today: [], week: null, next: null });
    const view = { today: ['fog'], week: 'quiet-woods', next: 'copper-week' };
    expect(activeConditions(DATA, view).map(c => c.id)).toEqual(['fog', 'quiet-woods']);
  });
});

describe('validating conditions', () => {
  /** An 8x8 field: home at the bottom, a hut with a fire that burns down at the top, watchers deep in. */
  const woods = (more: Partial<MapData> = {}): MapData => ({
    id: 'woods', name: 'Woods', version: 1, kind: 'wilds', depth: 1, width: 8, height: 8,
    tiles: ['ttttgttt', ...Array<string>(6).fill('tggggggt'), 'ttttgttt'],
    levels: Array<string>(8).fill('00000000'),
    spawn: { x: 4, y: 6, dir: 'up' },
    exits: [{ x: 4, y: 7, w: 1, h: 1, to: 'town', tx: 0, ty: 0, dir: 'down', home: true }, { x: 4, y: 0, w: 1, h: 1, to: 'hut', tx: 2, ty: 2, dir: 'up' }],
    objects: [],
    watchers: { count: 1, steps: [4, 99] },
    ...more,
  });
  const hut = (tended = false): MapData => ({
    id: 'hut', name: 'The hut', version: 1, kind: 'inside', depth: 0, width: 5, height: 4,
    tiles: ['wwwww', 'wfffw', 'wfffw', 'wwfww'], levels: Array<string>(4).fill('00000'),
    spawn: { x: 2, y: 2, dir: 'up' }, exits: [{ x: 2, y: 3, w: 1, h: 1, to: 'woods', tx: 4, ty: 1, dir: 'down' }],
    objects: [{ kind: 'fireplace', x: 2, y: 1, ...(tended && { tended: true }) }],
  });
  const good = (): ItemsData => ({
    version: 1,
    items: [{ id: 'twig', name: 'Twig', kind: 'resource', stack: 10, text: 'Dry.' }],
    finds: [{ item: 'twig', map: 'woods', around: { x: 3, y: 3, r: 1 }, count: 1, respawn: [5, 5], condition: 'fog' }],
    conditions: {
      seed: 1, second: 0.5,
      daily: [
        { id: 'fog', name: 'Fog', text: 'Fog.', weight: 1, map: 'woods', fog: 5 },
        { id: 'north', name: 'North', text: 'North.', weight: 1, map: 'woods', group: 'w', watchers: { steps: [6, 99] } },
        { id: 'out', name: 'Out', text: 'Out.', weight: 1, map: 'woods', fireOut: true },
      ],
      weekly: [{ id: 'quiet', name: 'Quiet', text: 'Quiet.', map: 'woods', watchers: { asleep: true } }],
    },
  });
  const errors = (data: ItemsData, maps: MapData[] = [woods(), hut()]) => validateItems(data, maps).filter(p => p.level === 'error').map(p => p.message);
  const change = (f: (d: ItemsData) => void) => {
    const d = good();
    f(d);
    return errors(d);
  };

  it('takes good ones: around keeps finds within r of the tile', () => {
    expect(errors(good())).toEqual([]);
    const tiles = findTiles(new TileMap(woods()), good().finds[0]!);
    expect(tiles).toHaveLength(5);
  });

  it('refuses each bad case', () => {
    expect(change(d => { d.conditions!.daily[1]!.id = 'fog'; })).toContainEqual(expect.stringMatching(/condition "fog" is defined twice/));
    expect(change(d => { d.conditions!.weekly[0]!.id = 'fog'; })).toContainEqual(expect.stringMatching(/defined twice/));
    expect(change(d => { d.conditions!.daily[0]!.weight = 0; })).toContainEqual(expect.stringMatching(/weight must be a number above 0/));
    expect(change(d => { d.conditions!.daily[0]!.fog = 2; })).toContainEqual(expect.stringMatching(/fog is from 3 to 12/));
    expect(change(d => { d.conditions!.daily[0]!.fog = 13; })).toContainEqual(expect.stringMatching(/fog is from 3 to 12/));
    expect(change(d => { d.finds[0]!.condition = 'rain-of-frogs'; })).toContainEqual(expect.stringMatching(/rain-of-frogs is on, which is not a condition/));
    expect(change(d => { d.finds[0]!.when = 'aurora'; })).toContainEqual(expect.stringMatching(/a condition or at a time \(when\), not both/));
    expect(errors(good(), [woods({ watchers: undefined }), hut()])).toContainEqual(expect.stringMatching(/condition "north": moves the watchers, but woods has none/));
    expect(change(d => { d.conditions!.daily[1]!.watchers = { steps: [50, 99] }; })).toContainEqual(expect.stringMatching(/leaves the watchers nowhere to wake/));
    expect(errors(good(), [woods(), hut(true)])).toContainEqual(expect.stringMatching(/condition "out": puts a fire out, but woods has no fire that burns down/));
    expect(change(d => { d.finds[0]!.around = { x: 0, y: 3, r: 0.5 }; })).toContainEqual(expect.stringMatching(/around 0,3 has no walkable tile/));
    expect(change(d => { d.finds[0]!.around = { x: 30, y: 3, r: 2 }; })).toContainEqual(expect.stringMatching(/around is a tile on the map/));
    expect(change(d => { d.conditions!.daily[0]!.map = 'nowhere'; })).toContainEqual(expect.stringMatching(/there is no map nowhere/));
  });
});
