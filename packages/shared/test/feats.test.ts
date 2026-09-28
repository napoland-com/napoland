import { describe, expect, it } from 'vitest';
import {
  CHANCES, DRAIN_GROWTH_STEPS, DRAIN_PER_SECOND, FAR_STEPS, FEATS, HEAVY_LOAD, MARK_LIFETIME_MS, MILESTONES, MODS, NO_MODS, RANKS, STATS, STEP_STATS, TileMap, energyRate, featOf, markLifetime,
  modChanges, modsOf, rankOf, rankText, rankValue, stepCounts, validateItems, type Feat, type MapData, type Mods,
} from '../src';

const feat = (id: string): Feat => FEATS.find(f => f.id === id)!;

/**
 * A corridor of wilds `h` tiles long, one tile wide, the way home at the bottom (1, h - 1): tile 1,y
 * is h - 1 - y steps from home.
 */
function corridor(h: number): MapData {
  return {
    id: 'long', name: 'Long', version: 1, kind: 'wilds', depth: 1, width: 3, height: h,
    tiles: Array.from({ length: h }, (_, y) => (y === 0 ? 'ttt' : 'tgt')),
    levels: Array<string>(h).fill('000'),
    spawn: { x: 1, y: h - 2, dir: 'up' },
    exits: [{ x: 1, y: h - 1, w: 1, h: 1, to: 'town', tx: 0, ty: 0, dir: 'down', home: true }],
    objects: [],
  };
}

describe('the table of feats and ranks', () => {
  it('is the one the design says: what each rank needs, and how much it does', () => {
    const table = Object.fromEntries(FEATS.map(f => [f.id, { stat: f.stat, mod: f.mod, way: f.way, need: f.ranks.map(r => r.need), by: f.ranks.map(r => r.by) }]));
    expect(table).toEqual({
      'rain-walker': { stat: 'rainSteps', mod: 'wetting', way: 'less', need: [1_500, 5_000, 15_000, 40_000, 100_000], by: [0.2, 0.3, 0.4, 0.45, 0.5] },
      'night-owl': { stat: 'nightSteps', mod: 'hitch', way: 'less', need: [1_000, 3_500, 10_000, 25_000, 60_000], by: [0.5, 0.6, 0.7, 0.75, 0.8] },
      'pack-mule': { stat: 'heavySteps', mod: 'load', way: 'less', need: [800, 2_500, 8_000, 20_000, 50_000], by: [0.15, 0.2, 0.25, 0.28, 0.3] },
      'fire-keeper': { stat: 'fed', mod: 'warmth', way: 'more', need: [20, 60, 200, 500, 1_200], by: [0.15, 0.2, 0.25, 0.28, 0.3] },
      mender: { stat: 'mended', mod: 'wear', way: 'less', need: [5, 15, 40, 100, 250], by: [0.05, 0.1, 0.15, 0.2, 0.25] },
      forager: { stat: 'found', mod: 'double', way: 'chance', need: [200, 700, 2_000, 5_000, 12_000], by: [0.05, 0.08, 0.11, 0.13, 0.15] },
      pathfinder: { stat: 'farSteps', mod: 'farDrain', way: 'less', need: [500, 1_500, 5_000, 12_000, 30_000], by: [0.03, 0.06, 0.09, 0.12, 0.15] },
      // Arrows last 2, 3, 4, 5 and 7 days: a day, times 1 and what it adds.
      'good-neighbor': { stat: 'thanked', mod: 'marks', way: 'more', need: [25, 75, 200, 500, 1_200], by: [1, 2, 3, 4, 6] },
    });
    expect(FAR_STEPS).toBe(85);
  });

  it('gives every feat five ranks, each needing more and doing more than the one before, one feat to each count', () => {
    expect(RANKS).toBe(5);
    for (const f of FEATS) {
      expect(f.ranks, f.id).toHaveLength(RANKS);
      f.ranks.forEach((r, i) => {
        expect(Number.isInteger(r.need) && r.need > 0, f.id).toBe(true);
        // Less of something never goes to nothing, and a chance is a share; more of something may double and more.
        expect(r.by > 0 && (f.way === 'more' || r.by < 1), f.id).toBe(true);
        if (i) expect(r.need > f.ranks[i - 1]!.need && r.by > f.ranks[i - 1]!.by, `${f.id} rank ${i + 1}`).toBe(true);
      });
      expect(featOf(f.stat)).toBe(f);
    }
    expect(new Set(FEATS.map(f => f.stat)).size).toBe(FEATS.length);
    // Every count is a feat's, or one of what people say once after the first time (story.ts), or which of that was said.
    expect([...STATS].sort()).toEqual([...FEATS.map(f => f.stat), ...MILESTONES, 'told'].sort());
    for (const m of [...MILESTONES, 'told' as const]) expect(featOf(m), m).toBeUndefined();
    for (const s of STEP_STATS) expect(STATS).toContain(s);
  });

  it('makes rank 1 of the first four the feat as it was before ranks, at the same count', () => {
    const before: Array<[string, number, Partial<Mods>]> = [
      ['rain-walker', 1_500, { wetting: 0.8 }], ['night-owl', 1_000, { hitch: 0.5 }], ['pack-mule', 800, { load: 0.85 }], ['fire-keeper', 20, { warmth: 1.15 }],
    ];
    for (const [id, need, mods] of before) {
      const f = feat(id);
      expect(f.ranks[0]!.need).toBe(need);
      const [k, v] = Object.entries(mods)[0]! as [keyof Mods, number];
      expect(rankValue(f, 1)).toBeCloseTo(v, 10);
      expect(modsOf({ [f.stat]: need })[k]).toBeCloseTo(v, 10);
      expect(modsOf({ [f.stat]: need - 1 })).toEqual(NO_MODS);
    }
  });
});

describe('ranks', () => {
  it('follow from the count: none before the first, then one at each mark, and five at most', () => {
    const rain = feat('rain-walker');
    expect([0, 1_499, 1_500, 4_999, 5_000, 14_999, 15_000, 39_999, 40_000, 99_999, 100_000, 1e9].map(n => rankOf(rain, n))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it('put a factor below 1 (less), above 1 (more) or a chance into Mods', () => {
    expect(rankValue(feat('rain-walker'), 2)).toBeCloseTo(0.7, 10);
    expect(rankValue(feat('fire-keeper'), 5)).toBeCloseTo(1.3, 10);
    expect(rankValue(feat('forager'), 3)).toBeCloseTo(0.11, 10);
    expect(rankValue(feat('pathfinder'), 1)).toBeCloseTo(0.97, 10);
    expect(rankValue(feat('mender'), 4)).toBeCloseTo(0.8, 10);
  });

  it('say what they do in plain words', () => {
    expect(rankText(feat('rain-walker'), 2)).toBe('Rain soaks you 30% slower');
    expect(rankText(feat('night-owl'), 1)).toBe('Hitchhikers find you 50% less often');
    expect(rankText(feat('pack-mule'), 4)).toBe('What you carry feels 28% lighter');
    expect(rankText(feat('fire-keeper'), 5)).toBe('Fires warm you 30% faster');
    expect(rankText(feat('mender'), 1)).toBe('Gear wears 5% slower out there');
    expect(rankText(feat('forager'), 2)).toBe('Finds come up double 8% of the time');
    expect(rankText(feat('pathfinder'), 3)).toBe('85 steps or more from home, you tire 9% slower');
    expect([1, 2, 3, 4, 5].map(r => rankText(feat('good-neighbor'), r))).toEqual([
      'Your arrows last 2 days', 'Your arrows last 3 days', 'Your arrows last 4 days', 'Your arrows last 5 days', 'Your arrows last 7 days',
    ]);
  });
});

describe('the good neighbor\'s arrows', () => {
  it('last a day, and as many days as the rank says: counted by thanks received', () => {
    expect(MARK_LIFETIME_MS).toBe(86_400_000);
    expect(markLifetime(NO_MODS)).toBe(MARK_LIFETIME_MS);
    expect(markLifetime(modsOf({ thanked: 24 }))).toBe(MARK_LIFETIME_MS);
    expect([25, 75, 200, 500, 1_200, 99_999].map(n => markLifetime(modsOf({ thanked: n })) / MARK_LIFETIME_MS)).toEqual([2, 3, 4, 5, 7, 7]);
    expect(featOf('thanked')).toBe(feat('good-neighbor'));
  });
});

describe('mods', () => {
  it('take every feat at the rank its count reaches', () => {
    const mods = modsOf({ rainSteps: 5_000, nightSteps: 60_000, heavySteps: 2_499, fed: 1_200, mended: 40, found: 700, farSteps: 30_000 });
    expect(mods.wetting).toBeCloseTo(0.7, 10);
    expect(mods.hitch).toBeCloseTo(0.2, 10);
    expect(mods.load).toBeCloseTo(0.85, 10);
    expect(mods.warmth).toBeCloseTo(1.3, 10);
    expect(mods.wear).toBeCloseTo(0.85, 10);
    expect(mods.double).toBeCloseTo(0.08, 10);
    expect(mods.farDrain).toBeCloseTo(0.85, 10);
  });

  it('multiply factors with a charm\'s, and add chances up as separate tries', () => {
    const mods = modsOf({ mended: 250, found: 12_000 }, [{ wear: 0.5 }, { double: 0.1 }]);
    expect(mods.wear).toBeCloseTo(0.75 * 0.5, 10);
    // 15% and 10%: doubled unless both miss, 1 - 0.85 * 0.9.
    expect(mods.double).toBeCloseTo(0.235, 10);
    expect(modsOf({}, [{ double: 3 }]).double).toBe(1);
  });

  it('know which values change something, for charms in the content', () => {
    expect(CHANCES).toEqual(['double']);
    expect(MODS).toEqual(Object.keys(NO_MODS));
    expect(modChanges('wear', 0.8)).toBe(true);
    expect(modChanges('wear', 1)).toBe(false);
    expect(modChanges('double', 0.1)).toBe(true);
    expect(modChanges('double', 0)).toBe(false);
    expect(modChanges('double', 1.5)).toBe(false);
    expect(modChanges('load', -1)).toBe(false);
    const charm = (charm: Partial<Mods>) => validateItems({ version: 1, items: [{ id: 'bead', name: 'Bead', kind: 'charm', stack: 1, text: 'Odd.', charm }], finds: [] }, [])
      .filter(p => p.level === 'error').map(p => p.message);
    expect(charm({ wear: 0.8 })).toEqual([]);
    expect(charm({ double: 0.1, farDrain: 0.9 })).toEqual([]);
    expect(charm({ double: 0 })).toEqual(['item "bead" is a charm that does nothing']);
    expect(charm({ luck: 2 } as Partial<Mods>)).toEqual([
      'item "bead" is a charm that does nothing',
      'item "bead": a charm changes wetting, load, hitch, warmth, wear, farDrain, double, marks or drain, not luck',
    ]);
  });
});

describe('what a step counts toward', () => {
  const long = new TileMap(corridor(100));
  const town = new TileMap({ ...corridor(100), id: 'town', kind: 'town' });

  it('counts only out in the wilds: in the rain, in the dark, with a heavy bag, far from home', () => {
    // 1,50 is 49 steps from home; 1,14 is 85.
    expect(STEP_STATS.filter(s => stepCounts(s, long, 1, 50, 'rain', 0))).toEqual(['rainSteps']);
    expect(STEP_STATS.filter(s => stepCounts(s, long, 1, 50, 'aurora', HEAVY_LOAD))).toEqual(['nightSteps', 'heavySteps']);
    expect(STEP_STATS.filter(s => stepCounts(s, long, 1, 50, 'night', HEAVY_LOAD - 0.01))).toEqual(['nightSteps']);
    expect(STEP_STATS.filter(s => stepCounts(s, long, 1, 14, 'overcast', 0))).toEqual(['farSteps']);
    expect(STEP_STATS.filter(s => stepCounts(s, long, 1, 15, 'overcast', 0))).toEqual([]);
    expect(STEP_STATS.filter(s => stepCounts(s, town, 1, 14, 'rain', 2))).toEqual([]);
  });
});

describe('the pathfinder\'s drain', () => {
  const long = new TileMap(corridor(100));

  it('is gentler only on tiles 85 or more steps from home', () => {
    const plain = (y: number) => -DRAIN_PER_SECOND * (1 + (99 - y) / DRAIN_GROWTH_STEPS);
    expect(long.homeSteps(1, 14)).toBe(FAR_STEPS);
    expect(energyRate(long, 1, 14, 'overcast', { farDrain: 0.97 })).toBeCloseTo(plain(14) * 0.97, 10);
    expect(energyRate(long, 1, 4, 'overcast', { farDrain: 0.85 })).toBeCloseTo(plain(4) * 0.85, 10);
    expect(energyRate(long, 1, 15, 'overcast', { farDrain: 0.97 })).toBeCloseTo(plain(15), 10);
    expect(energyRate(long, 1, 14, 'overcast')).toBeCloseTo(plain(14), 10);
    // The whole drain: the weather's, a hitchhiker's and all.
    expect(energyRate(long, 1, 14, 'night', { farDrain: 0.94, hitched: true, wet: 1 })).toBeCloseTo(energyRate(long, 1, 14, 'night', { hitched: true, wet: 1 }) * 0.94, 10);
  });
});
