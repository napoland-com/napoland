import { describe, expect, it } from 'vitest';
import { FLASH_BURST_S, TILE_CHARS } from '@napoland/shared';
import { soundscape, stepSurface, type Scene } from '../src/soundscape';
import { lightningAt } from '../src/view/world';

/** A dry day in the woods, you on 5,5 and nothing else around. */
const scene = (s: Partial<Scene> = {}): Scene => ({
  map: 'woods', kind: 'wilds', weather: 'overcast', storm: false, lightning: false,
  me: { id: 'me', x: 5, y: 5, tx: 5, ty: 5, ground: 'grass' },
  fires: [], poles: [], surge: null, caught: false, creatures: [], flashes: [], live: false, news: [], ...s,
});
/** A creature on 8,5 (3 tiles from you), unless `c` says otherwise. */
const creature = (c: Partial<Scene['creatures'][number]> = {}): Scene['creatures'][number] => ({ id: '1', kind: 'watcher', x: 8, y: 5, moving: false, chasing: undefined, ...c });
const loops = (s: Partial<Scene>) => soundscape(scene(s)).loops;

describe('soundscape', () => {
  it('rains outdoors in rain and a storm, faintly inside, and not indoors on a dry day', () => {
    expect(loops({ kind: 'inside' }).rain).toBe(0);
    expect(loops({ weather: 'rain' }).rain).toBeGreaterThan(0);
    expect(loops({ storm: true }).rain).toBeGreaterThan(loops({ weather: 'rain' }).rain);
    expect(loops({ kind: 'inside', weather: 'rain' }).rain).toBeLessThan(loops({ weather: 'rain' }).rain);
  });

  it('shimmers faintly while you carry a live find', () => {
    expect(loops({ live: true }).shimmer).toBeGreaterThan(0);
    expect(loops({}).shimmer).toBe(0);
  });

  it('blows in the wilds and a storm, never inside', () => {
    expect(loops({}).wind).toBeGreaterThan(0);
    expect(loops({ kind: 'town' }).wind).toBe(0);
    expect(loops({ kind: 'inside', storm: true }).wind).toBe(0);
  });

  it('hears a fire quieter as its fuel runs low, and not at 5 tiles', () => {
    const fire = (left: number | null, x = 7) => loops({ fires: [{ x, y: 5, left }] }).fire;
    expect(fire(600)).toBeGreaterThan(fire(20));
    expect(fire(20)).toBeGreaterThan(fire(0));
    expect(fire(0)).toBe(0);
    expect(fire(null, 10)).toBe(0);
    expect(fire(null, 6)).toBeGreaterThan(fire(null, 8));
  });

  it('hums the wires only on aurora nights near a pole', () => {
    expect(loops({ weather: 'aurora', poles: [{ x: 7, y: 5 }] }).wires).toBeGreaterThan(0);
    expect(loops({ weather: 'night', poles: [{ x: 7, y: 5 }] }).wires).toBe(0);
    expect(loops({ weather: 'aurora', poles: [{ x: 11, y: 5 }] }).wires).toBe(0);
  });

  it('drones full when caught, silent when calm, and rises as the front comes', () => {
    expect(loops({ caught: true, surge: { phase: 'surge', gap: 0 } }).surge).toBe(1);
    expect(loops({ surge: { phase: 'calm', gap: 1 } }).surge).toBe(0);
    expect(loops({ surge: { phase: 'unstable', gap: 1 } }).surge).toBeGreaterThan(0);
    expect(loops({ surge: { phase: 'surge', gap: 0.1 } }).surge).toBeGreaterThan(loops({ surge: { phase: 'surge', gap: 0.9 } }).surge);
  });

  it('hears a watcher only while it moves', () => {
    expect(loops({ creatures: [creature({ moving: true })] }).watcher).toBeGreaterThan(0);
    expect(loops({ creatures: [creature({ moving: false })] }).watcher).toBe(0);
    expect(loops({ creatures: [creature({ x: 20, moving: true })] }).watcher).toBe(0);
    expect(loops({ creatures: [creature({ kind: 'skulker', moving: true })] }).watcher).toBe(0);
  });

  it('hears a skulker only on a chase, louder the nearer it is, and not 8 tiles off', () => {
    const skulker = (x: number, chasing: string | null = 'someone') => loops({ creatures: [creature({ kind: 'skulker', x, moving: true, chasing: chasing ?? undefined })] }).skulker;
    expect(skulker(8, null)).toBe(0);
    expect(skulker(8)).toBeGreaterThan(skulker(11));
    expect(skulker(11)).toBeGreaterThan(0);
    expect(skulker(13)).toBe(0);
  });

  it('cries out once, the moment a skulker goes after you', () => {
    const lying = scene({ creatures: [creature({ kind: 'skulker' })] });
    const after = (who: string) => scene({ creatures: [creature({ kind: 'skulker', moving: true, chasing: who })] });
    expect(soundscape(after('me'), lying).shots).toEqual([{ kind: 'cry' }]);
    expect(soundscape(after('me'), after('me')).shots).toEqual([]);
    expect(soundscape(after('someone'), lying).shots).toEqual([]);
  });

  it('makes one footstep for a new step, on the ground stepped onto, and none on arrival', () => {
    const was = scene();
    const step = scene({ me: { id: 'me', x: 5, y: 5, tx: 6, ty: 5, ground: 'road' } });
    expect(soundscape(step, was).shots).toEqual([{ kind: 'step', surface: 'road' }]);
    expect(soundscape(step, step).shots).toEqual([]);
    expect(soundscape({ ...step, map: 'cabin' }, was).shots).toEqual([]);
  });

  it('swishes for each step into or through tall grass', () => {
    const into = scene({ me: { id: 'me', x: 5, y: 5, tx: 5, ty: 4, ground: 'tallgrass' } });
    expect(soundscape(into, scene()).shots).toEqual([{ kind: 'step', surface: 'swish' }]);
  });

  it('thunders once for each blink, only in a storm outdoors', () => {
    const blink = scene({ storm: true, lightning: true });
    expect(soundscape(blink, scene({ storm: true })).shots).toEqual([{ kind: 'thunder' }]);
    expect(soundscape(blink, blink).shots).toEqual([]);
    expect(soundscape(scene({ lightning: true }), scene()).shots).toEqual([]);
  });

  it('crackles when a flash starts near you and pops when it bursts', () => {
    const f = (left: number, x = 7) => ({ x, y: 5, kind: 'spark' as const, left });
    expect(soundscape(scene({ flashes: [f(9)] }), scene()).shots).toEqual([{ kind: 'crackle' }]);
    expect(soundscape(scene({ flashes: [f(9, 20)] }), scene()).shots).toEqual([]);
    expect(soundscape(scene({ flashes: [f(FLASH_BURST_S - 0.1)] }), scene({ flashes: [f(FLASH_BURST_S + 0.1)] })).shots).toEqual([{ kind: 'pop' }]);
  });

  it('rings for a restless region and rises for a coming storm', () => {
    const shots = soundscape(scene({ news: [{ kind: 'surge', view: { phase: 'unstable', left: 60, into: 0 } }, { kind: 'storm', view: { phase: 'coming', left: 60 } }] })).shots;
    expect(shots).toEqual([{ kind: 'bell' }, { kind: 'rise' }]);
  });

  it('chimes softly when a new day brings its conditions', () => {
    expect(soundscape(scene({ news: [{ kind: 'conditions', names: ['Thick fog'] }] })).shots).toEqual([{ kind: 'dawn' }]);
    expect(soundscape(scene({ news: [{ kind: 'conditions', names: [] }] })).shots).toEqual([]);
  });
});

describe('stepSurface', () => {
  it('has a sound for every kind of tile', () => {
    const want = { grass: 'soft', ferns: 'soft', tallgrass: 'swish', lot: 'soft', forest: 'soft', road: 'road', mud: 'mud', water: 'water', floor: 'floor', wall: 'floor' };
    for (const kind of Object.values(TILE_CHARS)) expect(stepSurface(kind), kind).toBe(want[kind]);
    expect(stepSurface(undefined)).toBe('soft');
  });
});

describe('lightningAt', () => {
  it('blinks for a small share of a minute, never for two seconds running', () => {
    let on = 0, run = 0, longest = 0;
    for (let t = 0; t < 60; t += 0.01) {
      run = lightningAt(t) ? run + 0.01 : 0;
      if (run) on += 0.01;
      longest = Math.max(longest, run);
    }
    expect(on).toBeGreaterThan(0);
    expect(on / 60).toBeLessThan(0.1);
    expect(longest).toBeLessThan(2);
  });
});
