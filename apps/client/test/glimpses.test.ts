import { describe, expect, it } from 'vitest';
import { GLIMPSE_NEAR, type ClientMsg, type GlimpseView, type PlayerView } from '@napoland/shared';
import { Game } from '../src/game';
import { GLIMPSE_IN_S, GLIMPSE_OUT_S, GLIMPSE_STEP_S, Passing } from '../src/glimpses';
import { Maps } from '../src/maps';
import { ITEMS, tinyTown, tinyWoods, welcome, zone } from './fixtures';

/** Somebody's walk: 20 steps east along row 5, from 0,5 to 20,5, in orange. */
const walk: GlimpseView = { color: '#f29e4c', steps: Array.from({ length: 21 }, (_, x): [number, number] => [x, 5]) };
const END_S = (walk.steps.length - 1) * GLIMPSE_STEP_S;
/** Where you stand in the tests: well off its way (10 tiles south of it), alone. */
const FAR = { x: 10, y: 15 };

/** A glimpse begun at 0, and how much of it shows at `s` seconds, for you at x,y, alone or not. */
function at(p: Passing, s: number, x = FAR.x, y = FAR.y, alone = true): number {
  return p.update(s * 1000, x, y, alone);
}

describe('a glimpse of someone\'s steps', () => {
  it('walks their tiles in order at an echo\'s pace, heading the way they went', () => {
    const p = new Passing();
    p.begin(walk, 0);
    at(p, GLIMPSE_STEP_S * 2.5);
    expect(p.x).toBeCloseTo(2.5, 6);
    expect(p.y).toBe(5);
    expect(p.walking).toBe(true);
    // East, as a model turns: a quarter turn.
    expect(p.heading).toBeCloseTo(Math.PI / 2, 6);
    expect(p.color).toBe('#f29e4c');
    at(p, END_S + 0.1);
    expect([p.x, p.y, p.walking]).toEqual([20, 5, false]);
  });

  it('comes out of the dark as it begins, and fades back into it once the walk is over', () => {
    const p = new Passing();
    p.begin(walk, 0);
    expect(at(p, 0)).toBe(0);
    expect(p.active).toBe(true);
    expect(at(p, GLIMPSE_IN_S / 2)).toBeCloseTo(0.5, 6);
    expect(at(p, GLIMPSE_IN_S)).toBe(1);
    expect(at(p, END_S)).toBe(1);
    expect(at(p, END_S + GLIMPSE_OUT_S / 2)).toBeCloseTo(0.5, 6);
    expect(at(p, END_S + GLIMPSE_OUT_S + 0.1)).toBe(0);
    expect(p.active).toBe(false);
  });

  it(`fades for good once you come within ${GLIMPSE_NEAR} tiles, and not before`, () => {
    const p = new Passing();
    p.begin(walk, 0);
    // At 2 s it is at 5.9,5; you stand 3.5 tiles below it, then 3.
    const s = 2, x = s / GLIMPSE_STEP_S;
    expect(at(p, s, x, 5 + GLIMPSE_NEAR + 0.5)).toBe(1);
    expect(at(p, s, x, 5 + GLIMPSE_NEAR)).toBe(1);
    expect(at(p, s + GLIMPSE_OUT_S / 2, FAR.x, FAR.y)).toBeCloseTo(0.5, 6);
    // Stepping back does not bring it back.
    expect(at(p, s + GLIMPSE_OUT_S + 0.1)).toBe(0);
    expect(p.active).toBe(false);
    expect(at(p, s + 2)).toBe(0);
  });

  it('fades once anyone else is out there, and never shows if you stand in its way from the start', () => {
    const p = new Passing();
    p.begin(walk, 0);
    expect(at(p, 1)).toBe(1);
    expect(at(p, 1, FAR.x, FAR.y, false)).toBe(1);
    expect(at(p, 1 + GLIMPSE_OUT_S / 2, FAR.x, FAR.y, true)).toBeCloseTo(0.5, 6);
    const q = new Passing();
    q.begin(walk, 0);
    for (let s = 0; s < 3; s += 0.05) expect(at(q, s, 0, 5)).toBe(0);
    expect(q.active).toBe(false);
  });

  it('gives way to a new one, and is gone at once when told', () => {
    const p = new Passing();
    p.begin(walk, 0);
    at(p, 3);
    p.begin({ color: '#3a86ff', steps: [[4, 4], [4, 3], [4, 2], [4, 1]] }, 3000);
    expect([p.x, p.y, p.color]).toEqual([4, 4, '#3a86ff']);
    expect(at(p, 3 + GLIMPSE_IN_S)).toBe(1);
    p.end();
    expect(p.active).toBe(false);
    expect(at(p, 4)).toBe(0);
  });
});

describe('glimpses in the game', () => {
  const maps = new Maps([tinyTown(), tinyWoods()]);
  const me = (x: number, y: number): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir: 'up', color: '#f29e4c', gear: {}, quirks: [] });

  it('walks the one the server sends, and forgets it on another map', () => {
    const g = new Game(maps, (_: ClientMsg) => {}, ITEMS);
    g.handle(welcome(tinyWoods(), [me(2, 4)]), 1000);
    g.handle({ t: 'glimpse', glimpse: { color: '#9b5de5', steps: [[1, 1], [2, 1], [3, 1]] } }, 1000);
    expect(g.passing.active).toBe(true);
    expect(g.passing.color).toBe('#9b5de5');
    g.handle(zone(tinyTown(), 3, 1, [me(3, 1)]), 1500);
    expect(g.passing.active).toBe(false);
  });
});
