import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TileMap, Weather } from '@napoland/shared';
import { ambience, assignLights, lightSources } from '../src/view/lighting';
import { cabin, houseTown, shed, tinyWoods } from './fixtures';

const luminance = (hex: string) => { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };
const warmth = (hex: string) => { const c = new THREE.Color(hex); return c.r - c.b; };

describe('the weather, outside and in', () => {
  it('rains, mists and fogs outside as the weather says', () => {
    const rain = ambience('town', 'rain', false);
    expect(rain.rain).not.toBeNull();
    expect(rain.mist).not.toBeNull();
    expect(rain.fog).not.toBeNull();
    expect(rain.wisps).toBeGreaterThan(0);
    // Rain soaks you (energy.ts), so it only falls when it rains: never at night, nor on an aurora.
    expect(ambience('wilds', 'night', false).rain).toBeNull();
    expect(ambience('wilds', 'aurora', false).rain).toBeNull();
    expect(ambience('wilds', 'overcast', false).rain).toBeNull();
  });

  it('never reaches inside: no rain, mist, fog or wisps, and black around the room, in any weather', () => {
    for (const w of Weather.options) for (const fire of [true, false]) {
      expect(ambience('inside', w, fire), `${w}, fire ${fire}`).toMatchObject({ rain: null, mist: null, fog: null, wisps: 0, sky: '#000000' });
    }
  });

  it('shows only through the windows, darker at night', () => {
    for (const fire of [true, false]) {
      const day = ambience('inside', 'overcast', fire), night = ambience('inside', 'night', fire);
      expect(luminance(night.window.glow)).toBeLessThan(luminance(day.window.glow));
      expect(night.window.light).toBeLessThan(day.window.light);
    }
  });

  it('keeps a room with a fire warm and one without dark and cold', () => {
    for (const w of Weather.options) {
      const warm = ambience('inside', w, true), dark = ambience('inside', w, false);
      expect(warmth(warm.hemi.sky)).toBeGreaterThan(0);
      expect(warmth(dark.hemi.sky)).toBeLessThan(0);
      expect(dark.hemi.intensity * luminance(dark.hemi.sky)).toBeLessThan(warm.hemi.intensity * luminance(warm.hemi.sky));
      // The sun stands for the daylight through the windows: always cold.
      expect(warmth(warm.sun.color)).toBeLessThan(0);
    }
  });

  it('turns the flashlight on at night, except by a fire indoors', () => {
    expect(ambience('town', 'night', false).flashlight).toBe(true);
    expect(ambience('town', 'rain', false).flashlight).toBe(false);
    expect(ambience('inside', 'night', false).flashlight).toBe(true);
    expect(ambience('inside', 'night', true).flashlight).toBe(false);
    expect(ambience('inside', 'overcast', false).flashlight).toBe(false);
  });
});

describe('the real lights: lamps and fires, nearest first', () => {
  it('finds every lamp and fire, a hearth\'s light hanging in front of its mouth', () => {
    expect(lightSources(new TileMap(houseTown()))).toEqual([expect.objectContaining({ kind: 'lamp', x: 5.84, y: 1.1, z: 3.5 })]);
    const [fire] = lightSources(new TileMap(cabin()));
    expect(fire).toMatchObject({ kind: 'fire', x: 4.5 });
    expect(fire!.z).toBeGreaterThan(1.5); // in the room, in front of the wall's face at z = 1
    expect(lightSources(new TileMap(shed()))).toEqual([]);
  });

  it('gives a fire a light like a lamp\'s, to whichever is nearest', () => {
    // The woods' lamp at 1,1 and a campfire at 2,4 near the way home.
    const woods = new TileMap({ ...tinyWoods(), objects: [...tinyWoods().objects, { kind: 'fireplace', x: 2, y: 4 }] });
    const sources = lightSources(woods);
    expect(sources.map(s => s.kind)).toEqual(['lamp', 'fire']);
    expect(assignLights([-1, -1, -1, -1], sources, 2.5, 4.5)).toEqual([1, 0, -1, -1]);
    // With one real light, it goes to the nearer of the two.
    expect(assignLights([-1], sources, 2.5, 4.5)).toEqual([1]);
    expect(assignLights([1], sources, 1.5, 1.5)).toEqual([0]);
  });

  it('keeps a light on a source that is still near, so it does not blink, and moves the others', () => {
    const row = Array.from({ length: 8 }, (_, i) => ({ x: i * 3, z: 0 }));
    const first = assignLights([-1, -1, -1, -1], row, 0, 0);
    expect([...first].sort()).toEqual([0, 1, 2, 3]);
    // Three sources further on, 3 (at x 9) is still near and keeps its light; the others take 4, 5 and 6.
    const next = assignLights(first, row, 13, 0);
    expect(next[first.indexOf(3)]).toBe(3);
    expect([...next].sort()).toEqual([3, 4, 5, 6]);
  });

  it('never changes the number of lights, whatever the map', () => {
    for (const sources of [[], [{ x: 0, z: 0 }], Array.from({ length: 9 }, (_, i) => ({ x: i, z: i }))]) {
      expect(assignLights([-1, -1, -1, -1], sources, 0, 0)).toHaveLength(4);
    }
    expect(assignLights([2, 0, -1, -1], [{ x: 0, z: 0 }], 0, 0)).toEqual([-1, 0, -1, -1]);
  });
});
