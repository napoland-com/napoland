import { describe, expect, it } from 'vitest';
import { REFILL_PER_SECOND } from '@napoland/shared';
import { energyLook } from '../src/hud';

describe('the energy bar', () => {
  it('shows neither refilling nor draining while energy holds, in town and inside (rate 0)', () => {
    expect(energyLook({ value: 60, max: 100, rate: 0 })).toEqual({ fill: 0.6, level: 'ok', refill: false, vignette: 0 });
  });

  it('keeps its bright tip while a fire refills it, until it is full', () => {
    expect(energyLook({ value: 60, max: 100, rate: REFILL_PER_SECOND }).refill).toBe(true);
    expect(energyLook({ value: 100, max: 100, rate: REFILL_PER_SECOND }).refill).toBe(false);
  });

  it('has no tip while draining in the wilds', () => {
    expect(energyLook({ value: 60, max: 100, rate: -0.3 }).refill).toBe(false);
  });

  it('turns low, then critical, and darkens the screen edges below a fifth', () => {
    expect(energyLook({ value: 24, max: 100, rate: -0.3 })).toMatchObject({ level: 'low', vignette: 0 });
    const almost = energyLook({ value: 5, max: 100, rate: -0.3 });
    expect(almost.level).toBe('critical');
    expect(almost.vignette).toBeCloseTo(0.75);
  });

  it('shows a full, quiet bar before the first report', () => {
    expect(energyLook(null)).toEqual({ fill: 1, level: 'ok', refill: false, vignette: 0 });
  });
});
