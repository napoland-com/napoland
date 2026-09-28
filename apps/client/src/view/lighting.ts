/**
 * Light and sky: how a place looks in each weather, and which lamps and fires carry one of the few
 * real lights. Plain logic with no drawing, so it can be tested; world.ts applies it.
 *
 * Outside, the weather sets the sky, the fog, the rain and the glow of lamps and windows, and the season
 * tints the light a little (a fresh spring, a warm summer, an amber autumn, a cold bright winter, whose
 * rain falls as snow). Inside a
 * building none of it comes in: no rain, no mist, no fog, a black void around the room. The weather
 * only shows through the windows, darker at night. A room with a fire is warm and dim around it; one
 * without (an empty house) is dark, with only a faint cold light from the windows.
 */
import { SEASONS, type MapKind, type Season, type TileMap, type Weather } from '@napoland/shared';
import { hearthAt } from './interior';
import { hash2 } from './toon';

/** Intensities are in the old units: world.ts multiplies them by PI for three.js's physically based lights. */
export interface Ambience {
  /** The background, and the fog's color. */
  sky: string;
  /** How far past the player the fog closes in: at least `min`, or `share` of the camera's distance. Null: no fog. */
  fog: { min: number; share: number } | null;
  hemi: { sky: string; ground: string; intensity: number };
  sun: { color: string; intensity: number };
  /** Falling rain, or null when there is none (dry weather, and always inside). */
  rain: { color: string; opacity: number } | null;
  /** What falls is snow (winter): slow, drifting, pale; and what a storm drives, too. */
  snow: boolean;
  /** Drifting mist, or null (inside). */
  mist: { color: string; opacity: number } | null;
  /** How strongly the wisps glow; 0 inside, where there are none. */
  wisps: number;
  /** Glowing things outside: lamp heads, lit windows and doorways, car lights at night, glowcaps. */
  lampGlow: string;
  warmGlow: string;
  carLights: boolean;
  capGlow: string;
  /** Chimney smoke against this sky. */
  smoke: string;
  /** Your flashlight: on at night, except by a fire indoors. */
  flashlight: boolean;
  /** Inside: the daylight or moonlight coming through the windows, the panes' glow and how much it lights the floor. */
  window: { glow: string; light: number };
}

const OUTSIDE: Readonly<Record<Weather, Ambience>> = {
  overcast: {
    sky: '#5a676d', fog: { min: 14, share: 0.45 },
    hemi: { sky: '#a3b3bb', ground: '#1a221d', intensity: 0.58 }, sun: { color: '#c9d4d8', intensity: 0.36 },
    rain: null, snow: false, mist: { color: '#c9d6dc', opacity: 0.13 }, wisps: 0.55,
    lampGlow: '#7a4f24', warmGlow: '#8a5524', carLights: false, capGlow: '#0e3b37', smoke: '#8b9196',
    flashlight: false, window: { glow: '#6a8393', light: 0.16 },
  },
  rain: {
    sky: '#465259', fog: { min: 10, share: 0.35 },
    hemi: { sky: '#8494a0', ground: '#1a221d', intensity: 0.5 }, sun: { color: '#c9d4d8', intensity: 0.26 },
    rain: { color: '#aebfcc', opacity: 0.38 }, snow: false, mist: { color: '#c9d6dc', opacity: 0.13 }, wisps: 0.55,
    lampGlow: '#b3702e', warmGlow: '#8a5524', carLights: false, capGlow: '#0e3b37', smoke: '#737a80',
    flashlight: false, window: { glow: '#4b5f6e', light: 0.11 },
  },
  // A dry night: rain soaks you (energy.ts), so it only falls when it is raining.
  night: {
    sky: '#0a0f15', fog: { min: 7, share: 0.25 },
    hemi: { sky: '#2c3a58', ground: '#07090c', intensity: 0.34 }, sun: { color: '#7088b8', intensity: 0.18 },
    rain: null, snow: false, mist: { color: '#4b5a66', opacity: 0.12 }, wisps: 0.95,
    lampGlow: '#ffb266', warmGlow: '#ffb45a', carLights: true, capGlow: '#2fb8a8', smoke: '#353c45',
    flashlight: true, window: { glow: '#141d2b', light: 0.045 },
  },
  // Lights in the sky: a night washed green, glowing mushrooms brighter, the old wires humming (world.ts).
  aurora: {
    sky: '#06161a', fog: { min: 8, share: 0.28 },
    hemi: { sky: '#2f7f70', ground: '#060b0b', intensity: 0.44 }, sun: { color: '#6fe0b8', intensity: 0.26 },
    rain: null, snow: false, mist: { color: '#3f8f7a', opacity: 0.13 }, wisps: 1,
    lampGlow: '#ffb266', warmGlow: '#ffb45a', carLights: true, capGlow: '#3fe6c8', smoke: '#2c4a45',
    flashlight: true, window: { glow: '#12382f', light: 0.07 },
  },
};

/** Snow, as it falls: pale and thicker than rain, since it drifts down slowly. */
export const SNOW = { color: '#eef3f7', opacity: 0.8 };

/**
 * How a season tints the light outdoors, each toward a color that far: the sky (and the fog), the light
 * from above and from the ground, the sun. Gentle, and gentler still at night.
 */
const SEASON_LIGHT: Readonly<Record<Season, Partial<Record<'sky' | 'hemi' | 'ground' | 'sun', [string, number]>>>> = {
  spring: { hemi: ['#b8e0a8', 0.12], ground: ['#24402a', 0.25] },
  summer: { hemi: ['#d8d0a0', 0.1], sun: ['#ffe9b0', 0.25] },
  autumn: { sky: ['#6a5040', 0.12], ground: ['#3a2814', 0.3], sun: ['#ffbf80', 0.3] },
  winter: { sky: ['#9fb0bd', 0.25], hemi: ['#dbe8f3', 0.25], ground: ['#5a6670', 0.35], sun: ['#e8f0ff', 0.3] },
};

/** Two #rrggbb colors mixed, `k` of the way from `a` to `b`. */
export function mix(a: string, b: string, k: number): string {
  const ch = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map(i => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * k).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * How a map of `kind` looks in `weather`; `fire`: the map has a fireplace (a warm room, if it is an inside).
 * `season`: its tint on the light outdoors, and in winter the rain falls as snow. None: the plain light.
 */
export function ambience(kind: MapKind, weather: Weather, fire: boolean, season?: Season): Ambience {
  const out = season ? seasonal(OUTSIDE[weather], season, weather === 'night' || weather === 'aurora') : OUTSIDE[weather];
  if (kind !== 'inside') return out;
  const night = weather === 'night' || weather === 'aurora', wet = weather === 'rain';
  return {
    ...out,
    sky: '#000000', fog: null, rain: null, snow: false, mist: null, wisps: 0,
    // The fire's own light is the warmth; the rest of the room stays dim. Without one there is no
    // warm light at all: only the cold light from the windows, weaker at night.
    hemi: fire
      ? { sky: '#a07a5c', ground: '#1e150f', intensity: night ? 0.36 : 0.42 }
      : { sky: '#56657a', ground: '#0b0d10', intensity: night ? 0.2 : 0.34 },
    sun: { color: night ? '#50648a' : wet ? '#8fa3b4' : '#a9bccb', intensity: night ? 0.05 : wet ? 0.1 : 0.14 },
    flashlight: night && !fire,
    // In a dark room the windows are the only light, so what they let in shows more.
    window: fire ? out.window : { ...out.window, light: out.window.light * 1.8 },
  };
}

/** The outdoor light of a weather, tinted by a season (half as much at night), and snow for rain in winter. */
function seasonal(a: Ambience, season: Season, night: boolean): Ambience {
  const t = SEASON_LIGHT[season], by = (c: string, g: [string, number] | undefined) => (g ? mix(c, g[0], g[1] * (night ? 0.5 : 1)) : c);
  const snow = SEASONS[season].snow;
  return {
    ...a,
    sky: by(a.sky, t.sky),
    hemi: { ...a.hemi, sky: by(a.hemi.sky, t.hemi), ground: by(a.hemi.ground, t.ground) },
    sun: { ...a.sun, color: by(a.sun.color, t.sun) },
    rain: a.rain && snow ? { ...SNOW } : a.rain,
    snow,
  };
}

/** Something that gives light: a street lamp, or a fireplace (as bright as it burns). */
export interface LightSource {
  kind: 'lamp' | 'fire';
  /** Where its light hangs, in world units (y up). */
  x: number;
  y: number;
  z: number;
  /** A lamp that flickers now and then, like the one by the lot in town. */
  flicker: boolean;
  /** Phase, so no two flicker together. */
  ph: number;
  /** The tile of the lamp or fireplace: a fire's light follows how big it burns. */
  tx: number;
  ty: number;
}

/** A map's lamps and fires, in the order of its objects. */
export function lightSources(map: TileMap): LightSource[] {
  const out: LightSource[] = [];
  let lamps = 0;
  for (const o of map.data.objects) {
    const ph = hash2(o.x, o.y) * 6;
    // Every third lamp flickers.
    if (o.kind === 'lamp') out.push({ kind: 'lamp', x: o.x + 0.84, y: 1.1, z: o.y + 0.5, flicker: lamps++ % 3 === 1, ph, tx: o.x, ty: o.y });
    // In front of a hearth's mouth, so it lights the room; over a campfire's middle.
    else if (o.kind === 'fireplace') out.push({ kind: 'fire', x: o.x + 0.5, y: 0.5, z: o.y + (hearthAt(map, o.x, o.y) ? 0.62 : 0.5), flicker: true, ph, tx: o.x, ty: o.y });
  }
  return out;
}

/**
 * Hands the real lights (one per slot) to the sources nearest (fx, fz), fires and lamps alike.
 * `current` is the source each slot lights now (an index into `sources`, -1 for none); the result is
 * the same for after the move. A light on a source that is still among the nearest stays where it is,
 * so it does not blink; the others move to the new nearest ones. The number of slots never changes.
 */
export function assignLights(current: readonly number[], sources: ReadonlyArray<{ x: number; z: number }>, fx: number, fz: number): number[] {
  const d2 = (i: number) => (sources[i]!.x - fx) ** 2 + (sources[i]!.z - fz) ** 2;
  const near = sources.map((_, i) => i).sort((a, b) => d2(a) - d2(b)).slice(0, current.length);
  const out = current.map(s => (near.includes(s) ? s : -1));
  for (const i of near) {
    if (out.includes(i)) continue;
    out[out.indexOf(-1)] = i;
  }
  return out;
}
