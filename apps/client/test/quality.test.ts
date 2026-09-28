/**
 * quality.ts: the resolution steps down when frames stay slow, back up when they come easily, never
 * past its ends, ignores pauses, and waits longer each time a step up does not hold; a step down that
 * does not make frames faster (a phone holding them to 30 a second) is taken back, and no other tried.
 */
import { describe, expect, it } from 'vitest';
import { RESOLUTION, Resolution, SCALES } from '../src/quality';

/** Feeds `total` ms of frames of `ms` each (or as long as `ms` says at the scale of the moment); returns every scale the resolution answered. */
function play(r: Resolution, ms: number | ((scale: number) => number), total: number): number[] {
  const changes: number[] = [];
  for (let t = 0; t < total;) {
    const frame = typeof ms === 'number' ? ms : ms(r.scale);
    t += frame;
    const s = r.frame(frame);
    if (s !== null) changes.push(s);
  }
  return changes;
}

/** A phone with more to draw than it can: every step coarser saves it a fifth of a frame or more, and it is slow down to the coarsest. */
const overloaded = (scale: number) => 60 * scale ** 2 + 10;

describe('the resolution', () => {
  it('stays full while frames come easily, on a fast screen and a phone at 60 a second', () => {
    const r = new Resolution();
    expect(play(r, 8.3, 60_000)).toEqual([]);
    expect(play(r, 16.7, 60_000)).toEqual([]);
    expect(r.scale).toBe(1);
  });

  it('steps down after frames stay slow for a while, one step at a time, down to the coarsest', () => {
    const r = new Resolution();
    expect(play(r, overloaded, RESOLUTION.downAfterMs - 100)).toEqual([]);
    expect(play(r, overloaded, 200)).toEqual([SCALES[1]]);
    expect(play(r, overloaded, 60_000)).toEqual(SCALES.slice(2));
    expect(r.scale).toBe(SCALES.at(-1));
  });

  it('takes back a step down that did not make frames faster, and tries no other while they stay held to 30 a second', () => {
    const r = new Resolution();
    // 30 a second at every sharpness: a phone saving its battery, not one with too much to draw.
    expect(play(r, 1000 / 30, 600_000)).toEqual([SCALES[1], 1]);
    expect(r.scale).toBe(1);
    // Let go of that pace (60 a second), then made too slow for real: it steps down again.
    play(r, 16.7, 10_000);
    expect(play(r, overloaded, 3_200)).toEqual([SCALES[1], SCALES[2]]);
  });

  it('does not step for a hitch now and then, or for pauses like a hidden tab or a map loading', () => {
    const r = new Resolution();
    for (let i = 0; i < 20; i++) {
      expect(play(r, 16.7, 1000)).toEqual([]);
      expect(r.frame(120)).toBeNull();
      expect(r.frame(1000)).toBeNull();
      expect(r.frame(0)).toBeNull();
    }
    expect(r.scale).toBe(1);
  });

  it('steps back up once frames come easily again, and no finer than full', () => {
    const r = new Resolution();
    play(r, overloaded, 3_500);
    expect(r.scale).toBe(SCALES[2]);
    // The average takes a moment to settle after slow frames, then easy frames count.
    expect(play(r, 16.7, RESOLUTION.upAfterMs + 1000)).toEqual([SCALES[1]]);
    expect(play(r, 16.7, RESOLUTION.upAfterMs + 100)).toEqual([1]);
    expect(play(r, 16.7, 60_000)).toEqual([]);
  });

  it('waits longer each time a step up does not hold, so it never flickers between two', () => {
    const r = new Resolution();
    // A phone that manages 60 a second one step coarser, and 30 at full.
    const frame = () => (r.scale === 1 ? 33 : 16.7);
    const changes: Array<{ at: number; scale: number }> = [];
    for (let t = 0; t < 600_000; ) {
      const ms = frame();
      t += ms;
      const s = r.frame(ms);
      if (s !== null) changes.push({ at: t, scale: s });
    }
    // Down, up (did not hold), down, then up again only after a minute, then two, then four...
    const ups = changes.filter(c => c.scale === 1).map(c => c.at);
    expect(ups.length).toBeGreaterThanOrEqual(2);
    expect(ups.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < ups.length; i++) expect(ups[i]! - ups[i - 1]!).toBeGreaterThanOrEqual(RESOLUTION.retryMs * 2 ** (i - 1));
  });
});
