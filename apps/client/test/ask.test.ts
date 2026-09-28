import { describe, expect, it } from 'vitest';
import { Question, REPEAT_AFTER_MS, REPEAT_FASTEST_MS, REPEAT_FIRST_MS, REPEAT_RAMP_MS, Repeat, noteMs, type AskCount } from '../src/ask';

const question = (count?: AskCount, text: string | ((n: number) => string) = 'Feed the fire resin?') => new Question({ who: 'Fire', text, count, yes: () => {} });

describe('a question', () => {
  it('starts on YES, and up and down move between YES and NO', () => {
    const q = question();
    expect(q.choice).toBe('yes');
    expect(q.move('up')).toBe(false);
    expect(q.move('down')).toBe(true);
    expect(q.choice).toBe('no');
    expect(q.move('down')).toBe(false);
    expect(q.move('up')).toBe(true);
    expect(q.choice).toBe('yes');
  });

  it('counts from the fewest, one at a time with left and right, never past what can go', () => {
    const q = question({ min: 1, max: 3 });
    expect(q.n).toBe(1);
    expect(q.move('left')).toBe(false);
    expect([q.move('right'), q.move('right'), q.move('right')]).toEqual([true, true, false]);
    expect(q.n).toBe(3);
    expect(q.step(-5)).toBe(true);
    expect(q.n).toBe(1);
    // Counting leaves the choice alone.
    expect(q.choice).toBe('yes');
  });

  it('starts where it is told, kept within what can go', () => {
    expect(question({ min: 1, max: 6, start: 4 }).n).toBe(4);
    expect(question({ min: 1, max: 6, start: 9 }).n).toBe(6);
    expect(question({ min: 2, max: 6, start: 0 }).n).toBe(2);
    // Nonsense limits still make a question that can be answered: one.
    const odd = question({ min: 0, max: -3 });
    expect([odd.min, odd.max, odd.n]).toEqual([1, 1, 1]);
  });

  it('asks how many only when more than one can go', () => {
    const one = question({ min: 1, max: 1 });
    expect(one.counts).toBe(false);
    expect(one.move('right')).toBe(false);
    expect(one.view().count).toBeNull();
    expect(question().counts).toBe(false);
    expect(question({ min: 1, max: 2 }).counts).toBe(true);
  });

  it('asks again in words for each count, when its words say how many', () => {
    const q = question({ min: 1, max: 20 }, n => `Throw away ${n} resin? It is gone for good.`);
    expect(q.text).toBe('Throw away 1 resin? It is gone for good.');
    q.step(2);
    expect(q.text).toBe('Throw away 3 resin? It is gone for good.');
  });

  it('is drawn with what it asks, the choice and how many', () => {
    const q = question({ min: 1, max: 5 });
    q.move('right');
    q.move('down');
    expect(q.view()).toEqual({ who: 'Fire', text: 'Feed the fire resin?', choice: 'no', count: { n: 2, min: 1, max: 5 } });
  });
});

describe('holding − or +', () => {
  it('steps once at once, then after a moment repeats, faster and faster, down to the fastest', () => {
    const r = new Repeat();
    expect(r.press(1, 0)).toBe(1);
    expect(r.held).toBe(1);
    // Nothing more until the hold turns into repeats.
    expect(r.due(REPEAT_AFTER_MS - 1)).toBe(0);
    expect(r.due(REPEAT_AFTER_MS)).toBe(1);
    expect(r.due(REPEAT_AFTER_MS + REPEAT_FIRST_MS - 1)).toBe(0);
    expect(r.due(REPEAT_AFTER_MS + REPEAT_FIRST_MS)).toBe(1);
    // Well into the hold, a step comes every REPEAT_FASTEST_MS.
    let t = REPEAT_AFTER_MS + REPEAT_RAMP_MS + 2000, steps = 0;
    for (let at = REPEAT_AFTER_MS + REPEAT_FIRST_MS + 1; at <= t; at += 5) steps += r.due(at);
    const later = r.due(t + REPEAT_FASTEST_MS * 10);
    expect(later).toBeGreaterThanOrEqual(4);
    expect(steps).toBeGreaterThan(20);
    // Held the other way, it counts down.
    expect(r.press(-1, t)).toBe(-1);
    t += REPEAT_AFTER_MS;
    expect(r.due(t)).toBe(-1);
  });

  it('stops when let go, and a frame that comes very late never leaps to the end', () => {
    const r = new Repeat();
    r.press(1, 0);
    expect(r.due(60_000)).toBe(4);
    expect(r.due(60_001)).toBe(0);
    r.release();
    expect(r.held).toBe(0);
    expect(r.due(120_000)).toBe(0);
  });
});

describe('what the box says by itself', () => {
  it('stays up about 4 seconds, longer when there is more to read, never past 8', () => {
    expect(noteMs('You throw away 3 resin.')).toBe(4000);
    expect(noteMs('It turns out to be a hollow feather. While it is in your bag, what you carry feels lighter.')).toBeGreaterThan(4000);
    expect(noteMs('x'.repeat(1000))).toBe(8000);
  });
});
