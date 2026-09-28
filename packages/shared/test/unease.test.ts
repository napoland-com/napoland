import { describe, expect, it } from 'vitest';
import {
  FEATS, UNEASE_BUILD_S, UNEASE_CALM_S, UNEASE_COMPANY_S, UNEASE_HOLD, UNEASE_LEVELS, UNEASE_MODS, faces, inTheDark, modsOf, uneaseAfter, uneaseFull, uneaseLevel, uneaseRate,
  type UneaseAround,
} from '../src';

/** Alone in the dark, with nothing to hurry it, unless `a` says otherwise. */
const alone = (a: Partial<UneaseAround> = {}): UneaseAround => ({ dark: true, company: false, watcher: false, shaken: false, ...a });

/** The levels told along the way, `seconds` at a time, from `v` and `was`, while `a` holds. */
function levels(a: UneaseAround, seconds: number, times: number, v = 0, was = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < times; i++) {
    v = uneaseAfter(v, a, seconds);
    out.push((was = uneaseLevel(v, was)));
  }
  return out;
}

describe('unease', () => {
  it('builds in about 3 minutes alone in the dark, a level every quarter, the top one only when full', () => {
    expect(uneaseAfter(0, alone(), UNEASE_BUILD_S)).toBe(1);
    expect(uneaseAfter(0, alone(), UNEASE_BUILD_S / 2)).toBeCloseTo(0.5, 9);
    expect(levels(alone(), UNEASE_BUILD_S / UNEASE_LEVELS, UNEASE_LEVELS + 1)).toEqual([1, 2, 3, 4, 4]);
    // Built a little at a time, as the server ticks, it comes to the same.
    expect(levels(alone(), 0.05, (UNEASE_BUILD_S / 0.05) * 0.99).at(-1)).toBe(3);
    expect(levels(alone(), 0.05, UNEASE_BUILD_S / 0.05 + 1).at(-1)).toBe(UNEASE_LEVELS);
    expect(uneaseFull(UNEASE_LEVELS)).toBe(true);
    expect(uneaseFull(UNEASE_LEVELS - 1)).toBe(false);
  });

  it('builds twice as fast with a watcher in sight or after a flash near, and three times with both', () => {
    expect(uneaseAfter(0, alone({ watcher: true }), UNEASE_BUILD_S / 2)).toBe(1);
    expect(uneaseAfter(0, alone({ shaken: true }), UNEASE_BUILD_S / 2)).toBe(1);
    expect(uneaseAfter(0, alone({ watcher: true, shaken: true }), UNEASE_BUILD_S / 3)).toBeCloseTo(1, 9);
    expect(uneaseRate(alone({ watcher: true }))).toBeCloseTo(2 * uneaseRate(alone()), 12);
  });

  it('falls anywhere else: under a light, by a fire, near a flare, under a roof, in town or by day, in 45 seconds', () => {
    const calm = alone({ dark: false });
    expect(uneaseRate(calm)).toBeLessThan(0);
    expect(uneaseAfter(1, calm, UNEASE_CALM_S)).toBe(0);
    expect(uneaseAfter(1, calm, UNEASE_CALM_S / 2)).toBeCloseTo(0.5, 9);
    // It never goes below none.
    expect(uneaseAfter(0, calm, 60)).toBe(0);
  });

  it('falls fastest in company, even in the dark and whatever else hurries it', () => {
    expect(uneaseAfter(1, alone({ company: true, watcher: true, shaken: true }), UNEASE_COMPANY_S)).toBe(0);
    expect(uneaseAfter(1, alone({ company: true, dark: false }), UNEASE_COMPANY_S)).toBe(0);
    expect(uneaseRate(alone({ company: true }))).toBeLessThan(uneaseRate(alone({ dark: false })));
    expect(UNEASE_COMPANY_S).toBeLessThan(UNEASE_CALM_S);
  });

  it('is told a few levels, and a level lasts a little way down, so it never flickers between two', () => {
    // Full, it stays full until it falls a hold below it.
    expect(uneaseLevel(1, 0)).toBe(4);
    expect(uneaseLevel(1 - UNEASE_HOLD / 2, 4)).toBe(4);
    expect(uneaseLevel(1 - UNEASE_HOLD * 2, 4)).toBe(3);
    // In and out of a lamp's light along its edge: the level holds.
    expect(uneaseLevel(0.51, 1)).toBe(2);
    expect(uneaseLevel(0.49, 2)).toBe(2);
    expect(uneaseLevel(0.51, 2)).toBe(2);
    expect(uneaseLevel(0.5 - UNEASE_HOLD * 1.5, 2)).toBe(1);
    // Fallen far at once (company), it says where it is.
    expect(uneaseLevel(0.1, 4)).toBe(0);
    expect(uneaseLevel(0, 3)).toBe(0);
    // Down in company, from full: a level at a time, then none.
    expect(levels(alone({ company: true }), UNEASE_COMPANY_S / 8, 8, 1, 4)).toEqual([3, 3, 2, 2, 1, 1, 0, 0]);
  });

  it('full, makes hitchhikers find you twice as often, beside what feats and charms do', () => {
    expect(modsOf({}, [UNEASE_MODS]).hitch).toBe(2);
    const owl = FEATS.find(f => f.id === 'night-owl')!;
    // Night owl rank 1 (they find you half as often) and full unease: as often as ever.
    expect(modsOf({ nightSteps: owl.ranks[0]!.need }, [UNEASE_MODS]).hitch).toBeCloseTo(1, 12);
  });

  it('goes by the dark hitchhikers go by: night and aurora nights', () => {
    expect(inTheDark('night')).toBe(true);
    expect(inTheDark('aurora')).toBe(true);
    expect(inTheDark('rain')).toBe(false);
    expect(inTheDark('overcast')).toBe(false);
  });

  it('is gone when faced: anything on the side you face, however far to either side', () => {
    expect(faces(5, 5, 'up', 9, 4)).toBe(true);
    expect(faces(5, 5, 'up', 1, 5)).toBe(false);
    expect(faces(5, 5, 'down', 5, 4)).toBe(false);
    expect(faces(5, 5, 'left', 4, 9)).toBe(true);
    expect(faces(5, 5, 'right', 4, 0)).toBe(false);
  });
});
