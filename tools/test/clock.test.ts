import { describe, expect, it } from 'vitest';
import { dayAt, longNightAt, seasonAt, weatherAt } from '../../packages/shared/src';
import nearWoods from '../../content/maps/near-woods.json';
import southRoad from '../../content/maps/south-road.json';
import type { MapData } from '../../packages/shared/src';
import { clockTarget, shiftFor } from '../clock';

/** Monday 28 September 2026, ten past three in the afternoon (UTC): a summer's week. */
const NOW = Date.UTC(2026, 8, 28, 15, 10);

describe('the play-test clock (CLOCK_SHIFT_MS)', () => {
  it('puts the world a minute before the next Long Night, or into it', () => {
    expect(clockTarget('long-night', NOW)).toEqual({ at: Date.UTC(2026, 9, 3, 19, 11), what: 'a minute before the next Long Night' });
    expect(shiftFor('long-night', NOW)).toBe(Date.UTC(2026, 9, 3, 19, 11) - NOW);
    expect(longNightAt(NOW + shiftFor('long-night', NOW)! + 60_000).on).toBe(true);
    expect(clockTarget('long-night+10', NOW)).toEqual({ at: Date.UTC(2026, 9, 3, 19, 22), what: '10 minutes after the next Long Night' });
    // While one is on, the next week's.
    expect(clockTarget('long-night', Date.UTC(2026, 9, 3, 19, 30))!.at).toBe(Date.UTC(2026, 9, 10, 19, 11));
  });

  it('puts the world a minute before the next week of a season', () => {
    expect(seasonAt(NOW)).toBe('summer');
    expect(clockTarget('winter', NOW)).toEqual({ at: Date.UTC(2026, 9, 11, 23, 59), what: 'a minute before the next winter' });
    expect(seasonAt(clockTarget('winter+1', NOW)!.at)).toBe('winter');
    // This week's season comes round again in four weeks.
    expect(clockTarget('summer', NOW)!.at).toBe(Date.UTC(2026, 9, 25, 23, 59));
  });

  it('puts the world into a game day: 13 minutes after a dawn it rains in the Near Woods and not on the South Road', () => {
    const at = clockTarget('dawn+13', NOW)!.at;
    expect(dayAt(at).into).toBe(13 * 60);
    expect([weatherAt(at, (nearWoods as MapData).rain).weather, weatherAt(at, (southRoad as MapData).rain).weather]).toEqual(['rain', 'overcast']);
    expect(clockTarget('dawn', NOW)!.at).toBe(at - 14 * 60_000);
  });

  it('takes now, and a wall time in UTC, and nothing else', () => {
    expect(shiftFor('now', NOW)).toBe(0);
    expect(shiftFor('now+30', NOW)).toBe(30 * 60_000);
    expect(shiftFor('2026-10-03T19:11Z', NOW)).toBe(Date.UTC(2026, 9, 3, 19, 11) - NOW);
    for (const bad of ['', 'tomorrow', 'long night', 'winter+', '+5']) expect(clockTarget(bad, NOW), bad).toBeNull();
  });
});
