import { beforeEach, describe, expect, it } from 'vitest';
import type { ServerMsg } from '@napoland/shared';
import { Arrival, FADE_IN_S, FADE_OUT_S } from '../src/arrival';
import { FULL, ref, tinyWoods } from './fixtures';

const zone: ServerMsg = { t: 'zone', map: ref(tinyWoods()), x: 2, y: 4, dir: 'up', players: [], reason: 'exit' };
const energy: ServerMsg = { t: 'energy', energy: FULL };
const leave: ServerMsg = { t: 'leave', id: 'o1' };

let swaps: ServerMsg[][];
let arrival: Arrival;
/** Advance in 1/60 s frames. */
function run(seconds: number) {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) arrival.update(1 / 60);
}

beforeEach(() => {
  swaps = [];
  arrival = new Arrival(held => swaps.push(held));
});

describe('arriving on another map', () => {
  it('lets messages through while nothing is happening', () => {
    expect(arrival.hold(energy)).toBe(false);
    expect(arrival.dark).toBe(0);
    expect(arrival.leaving).toBe(false);
  });

  it('holds a zone and everything after it until the screen is black, then swaps them in order', () => {
    expect(arrival.hold(zone)).toBe(true);
    expect(arrival.hold(leave)).toBe(true);
    expect(arrival.hold(energy)).toBe(true);
    expect(arrival.leaving).toBe(true);
    run(FADE_OUT_S / 2);
    expect(arrival.dark).toBeGreaterThan(0.3);
    expect(arrival.dark).toBeLessThan(0.7);
    expect(swaps).toHaveLength(0);
    run(FADE_OUT_S / 2 + 0.02);
    expect(swaps).toEqual([[zone, leave, energy]]);
    expect(arrival.leaving).toBe(false);
    expect(arrival.dark).toBeGreaterThan(0.9);
    expect(arrival.hold(energy)).toBe(false); // the new map is in place: messages flow again
    run(FADE_IN_S + 0.05);
    expect(arrival.dark).toBe(0);
  });

  it('cuts to black and fades in, for a login', () => {
    arrival.cut();
    expect(swaps).toEqual([[]]);
    expect(arrival.dark).toBe(1);
    run(FADE_IN_S / 2);
    expect(arrival.dark).toBeGreaterThan(0.2);
    expect(arrival.dark).toBeLessThan(0.8);
    run(FADE_IN_S / 2 + 0.05);
    expect(arrival.dark).toBe(0);
  });

  it('goes dark again from where it is when leaving while still fading in', () => {
    arrival.cut();
    run(FADE_IN_S * 0.75);
    const before = arrival.dark;
    arrival.hold(zone);
    arrival.update(1 / 60);
    expect(arrival.dark).toBeGreaterThanOrEqual(before);
    expect(arrival.dark).toBeLessThan(before + 0.2);
    run(FADE_OUT_S);
    expect(swaps).toEqual([[], [zone]]);
  });

  it('does not skip the fade when a frame is slow', () => {
    arrival.hold(zone);
    run(FADE_OUT_S + 0.02);
    arrival.update(0.05); // the most a frame counts for, however long building the map took
    expect(arrival.dark).toBeGreaterThan(0.8);
  });
});
