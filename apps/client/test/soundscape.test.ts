import { describe, expect, it } from 'vitest';
import { FLASH_BURST_S, TILE_CHARS } from '@napoland/shared';
import { soundscape, stepSurface, type Scene } from '../src/soundscape';
import { lightningAt } from '../src/view/world';

/** A dry day in the woods, you on 5,5 and nothing else around. */
const scene = (s: Partial<Scene> = {}): Scene => ({
  map: 'woods', kind: 'wilds', weather: 'overcast', storm: false, lightning: false,
  me: { x: 5, y: 5, tx: 5, ty: 5, ground: 'grass' },
  fires: [], poles: [], surge: null, caught: false, watchers: [], flashes: [], live: false, news: [], ...s,
});
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
    expect(loops({ watchers: [{ x: 8, y: 5, moving: true }] }).watcher).toBeGreaterThan(0);
    expect(loops({ watchers: [{ x: 8, y: 5, moving: false }] }).watcher).toBe(0);
    expect(loops({ watchers: [{ x: 20, y: 5, moving: true }] }).watcher).toBe(0);
  });

  it('makes one footstep for a new step, on the ground stepped onto, and none on arrival', () => {
    const was = scene();
    const step = scene({ me: { x: 5, y: 5, tx: 6, ty: 5, ground: 'road' } });
    expect(soundscape(step, was).shots).toEqual([{ kind: 'step', surface: 'road' }]);
    expect(soundscape(step, step).shots).toEqual([]);
    expect(soundscape({ ...step, map: 'cabin' }, was).shots).toEqual([]);
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
});

describe('stepSurface', () => {
  it('has a sound for every kind of tile', () => {
    const want = { grass: 'soft', ferns: 'soft', lot: 'soft', forest: 'soft', road: 'road', mud: 'mud', water: 'water', floor: 'floor', wall: 'floor' };
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
