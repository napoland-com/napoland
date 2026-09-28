import { describe, expect, it } from 'vitest';
import {
  BADGES, LEVEL_MAX, MERITS_FROM, MERIT_LOOKS, MERIT_XP, PATTERNS, levelOf, mayWearLook, meritLookOf, meritsLeft, meritsOf, toNextMerit, whyNotBuy, xpFor, type MeritsView,
} from '../src';

const none: MeritsView = { spent: 0, owned: [] };

describe('merits, past level 20', () => {
  it('start where level 20 does, and come one for every 1,500 XP past it', () => {
    expect(MERITS_FROM).toBe(10_830);
    expect(MERITS_FROM).toBe(xpFor(LEVEL_MAX));
    expect(MERIT_XP).toBe(1500);
    expect(meritsOf(0)).toBe(0);
    expect(meritsOf(10_830)).toBe(0);
    expect(meritsOf(12_329)).toBe(0);
    expect(meritsOf(12_330)).toBe(1);
    expect(meritsOf(10_830 + 3 * 1500 + 1240)).toBe(3);
    // The level stays at the top all the while.
    expect(levelOf(10_830 + 30 * 1500)).toBe(LEVEL_MAX);
  });

  it('say how far the next one is, below level 20 too', () => {
    expect(toNextMerit(10_830)).toBe(1500);
    expect(toNextMerit(12_329)).toBe(1);
    expect(toNextMerit(12_330)).toBe(1500);
    expect(toNextMerit(10_830 + 3 * 1500 + 260)).toBe(1240);
    // Below the top: the rest of the way to level 20, and the first merit's 1,500 past it.
    expect(toNextMerit(10_000)).toBe(830 + 1500);
    expect(toNextMerit(0)).toBe(10_830 + 1500);
  });

  it('are spent, never below none left', () => {
    expect(meritsLeft(10_830 + 3 * 1500, 1)).toBe(2);
    expect(meritsLeft(10_830 + 3 * 1500, 3)).toBe(0);
    expect(meritsLeft(10_830 + 3 * 1500, 5)).toBe(0);
    expect(meritsLeft(1000, 0)).toBe(0);
  });
});

describe('what merits buy', () => {
  it('are six jacket patterns and six name tag badges, each its own id, and each for one merit', () => {
    expect(PATTERNS.map(p => p.id)).toEqual(['stripes', 'checks', 'chevron', 'reflective', 'napo-patch', 'squares']);
    expect(BADGES.map(b => b.id)).toEqual(['fir', 'flame', 'shard', 'lamp', 'moth', 'old-stone']);
    expect(new Set(MERIT_LOOKS.map(l => l.id)).size).toBe(12);
    for (const l of MERIT_LOOKS) {
      expect(l.cost, l.id).toBe(1);
      expect(l.noun.startsWith('the '), l.id).toBe(true);
      expect(l.text.endsWith('.'), l.id).toBe(true);
    }
    expect(PATTERNS.every(p => p.kind === 'pattern') && BADGES.every(b => b.kind === 'badge')).toBe(true);
  });

  it('are found by id, and by kind', () => {
    expect(meritLookOf('chevron')?.name).toBe('Chevron');
    expect(meritLookOf('chevron', 'pattern')?.noun).toBe('the chevron pattern');
    expect(meritLookOf('chevron', 'badge')).toBeUndefined();
    expect(meritLookOf('top-hat')).toBeUndefined();
    expect(meritLookOf(null)).toBeUndefined();
  });

  it('are bought signed in only, once, and with a merit to spend', () => {
    const chevron = meritLookOf('chevron')!, three = 10_830 + 3 * 1500;
    expect(whyNotBuy(chevron, three, none, true)).toBeNull();
    expect(whyNotBuy(chevron, three, none, false)).toBe('sign_in_first');
    expect(whyNotBuy(chevron, three, { spent: 1, owned: ['chevron'] }, true)).toBe('owned');
    expect(whyNotBuy(chevron, three, { spent: 3, owned: ['fir', 'moth', 'stripes'] }, true)).toBe('no_merits');
    expect(whyNotBuy(chevron, 10_000, none, true)).toBe('no_merits');
  });

  it('are worn only once yours, and only signed in, each of its own kind', () => {
    expect(mayWearLook('chevron', 'pattern', ['chevron'], true)).toBe(true);
    expect(mayWearLook('chevron', 'pattern', [], true)).toBe(false);
    expect(mayWearLook('chevron', 'pattern', ['chevron'], false)).toBe(false);
    expect(mayWearLook('chevron', 'badge', ['chevron'], true)).toBe(false);
    expect(mayWearLook('top-hat', 'pattern', ['top-hat'], true)).toBe(false);
    expect(mayWearLook(null, 'badge', ['fir'], true)).toBe(false);
  });
});
