/**
 * Rested while away, without a page: what the status panel says of the cup of rest, what floats over
 * your head as stashing spends it, the banner an arrival worth a word gets, and the line at the chest.
 */
import { describe, expect, it } from 'vitest';
import { RESTED_MAX, RESTED_NOTICE, type PlayerView, type ProgressView } from '@napoland/shared';
import { Game, xpFloat } from '../src/game';
import { Maps } from '../src/maps';
import { newsBanner, restedLine, restedText, statusView, type StatusInput } from '../src/status';
import { ITEMS, START, tinyTown, welcome } from './fixtures';

const me: PlayerView = { id: 'me', name: 'Aldo', x: 3, y: 3, dir: 'down', color: '#f29e4c', gear: {}, quirks: [] };
const rested = (xp: number): ProgressView => ({ ...START, rested: xp });
/** The status panel's rows for where you stand, as the game would show them in town. */
const rows = (progress: ProgressView) => statusView({
  energy: null, body: { wet: 0, wetRate: 0, load: 0, hitched: false, worn: {} }, surge: null, caught: false, storm: null, flash: null, weather: 'overcast', wilds: false,
  stone: { charge: 0, need: 0, awake: false, left: 0 }, stats: {}, bag: [], items: ITEMS, progress, resists: null, wear: null, quirks: [],
} satisfies StatusInput).rows;
/** A game that just heard its welcome, rested as the server says. */
const arrive = (progress: ProgressView, restedAway?: number) => {
  const g = new Game(new Maps([tinyTown()]), () => {}, ITEMS);
  g.handle({ ...welcome(tinyTown(), [me], undefined, { progress }), ...(restedAway !== undefined ? { restedAway } : {}) }, 0);
  return g;
};

describe('the cup of rest in the status panel', () => {
  it('says how much doubled stashing is left, with a bar of how full it is, right under the level', () => {
    const r = rows(rested(140));
    expect(r.map(x => x.label).slice(0, 2)).toEqual(['Level', 'Rested']);
    expect(r[1]).toEqual({ label: 'Rested', text: '140 XP of doubled stashing left', bar: 140 / RESTED_MAX, tone: 'good' });
    expect(rows(rested(RESTED_MAX))[1]!.bar).toBe(1);
  });

  it('says what fills it while it is empty', () => {
    expect(rows(START)[1]).toEqual({ label: 'Rested', text: 'Empty. It fills while you are not playing, and then what you stash counts double.', bar: 0, tone: 'plain' });
    expect(restedText(0)).toBe(rows(START)[1]!.text);
  });
});

describe('stashing while rested', () => {
  it('floats the doubled part over your head with what it earned', () => {
    expect(xpFloat(24, 12)).toBe('+24 XP (12 rested)');
    expect(xpFloat(9, 3)).toBe('+9 XP (3 rested)');
    expect(xpFloat(24)).toBe('+24 XP');
    const g = arrive(rested(140));
    g.handle({ t: 'progress', progress: { ...START, xp: 24, rested: 128 }, gained: 24, fromRest: 12 }, 0);
    g.handle({ t: 'progress', progress: { ...START, xp: 30 }, gained: 6 }, 0);
    expect(g.floats.map(f => f.text)).toEqual(['+24 XP (12 rested)', '+6 XP']);
    // The cup as the server last told it.
    expect(g.progress.rested).toBeUndefined();
  });

  it('says at the chest how much more counts double', () => {
    expect(restedLine(140)).toBe('Rested: your next 140 XP from the chest count double.');
  });
});

describe('arriving rested', () => {
  it('is news when the time away was worth a word and the cup holds some', () => {
    expect(arrive(rested(140), 30).news).toEqual([{ kind: 'rested', xp: 140 }]);
    expect(arrive(rested(RESTED_MAX), RESTED_NOTICE).news).toEqual([{ kind: 'rested', xp: RESTED_MAX }]);
  });

  it('is no news for a short time away, or with nothing in the cup', () => {
    expect(arrive(rested(140), RESTED_NOTICE - 1).news).toEqual([]);
    expect(arrive(rested(140)).news).toEqual([]);
    expect(arrive(START, 30).news).toEqual([]);
  });

  it('gets a banner that says how much of what comes home counts double', () => {
    expect(newsBanner({ kind: 'rested', xp: 140 }, 'Stonebrook')).toEqual({ title: 'Rested', sub: 'Your next 140 XP from the chest count double.' });
  });
});
