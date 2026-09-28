/**
 * What the game should sound like now: how loud each loop plays, and the sounds to fire once. Plain
 * data in, plain data out, so it is tested without a page; sound.ts makes the noise.
 */
import { FLASH_BURST_S, type CreatureView, type FlashView, type MapKind, type SurgePhase, type TileKind, type Weather } from '@napoland/shared';
import { callSound, type CallSound } from './calls';
import type { News } from './game';
import { radioCrackle, radioHears, radioHum, type RadioScene } from './radio';
import { fireLevel } from './view/fire';

/** A fire is heard this many tiles away, the wires this many on aurora nights, a moving watcher this many (the server's WATCHER_HUNT). */
const FIRE_HEARD = 4;
const WIRES_HEARD = 5;
const WATCHER_HEARD = 9;
/** A skulker on a chase is heard this many tiles away: a little farther than it hears you walking (the server's SKULKER_HEAR). */
const SKULKER_HEARD = 8;
/** A flash crackles and pops this close to you. */
const FLASH_HEARD = 6;

export type Surface = 'road' | 'soft' | 'mud' | 'floor' | 'water' | 'swish';
export type Loop = 'rain' | 'wind' | 'fire' | 'wires' | 'surge' | 'watcher' | 'skulker' | 'shimmer' | 'radio' | 'hum';
export type Shot =
  | { kind: 'step'; surface: Surface }
  | { kind: 'thunder' | 'crackle' | 'pop' | 'bell' | 'rise' | 'cry' | 'dawn' }
  | ({ kind: 'call' } & CallSound)
  /** The radio: the Tower's pulse (a burst of static), turned on (a click and a sweep of static) and off (a click). */
  | { kind: 'pulse' | 'tune' | 'click' }
  /** A lodestone tugs (lodestone.ts): a shard lies near, and it does not say where. */
  | { kind: 'tug' };

export interface Mix {
  /** How loud each loop should play, 0 to 1. */
  loops: Record<Loop, number>;
  shots: Shot[];
}

/** The game as it stands this frame, as far as sound cares. */
export interface Scene {
  map: string;
  kind: MapKind;
  /** You are up a fire lookout: under its roof, the rain drums as it does on a house's. */
  up?: boolean;
  weather: Weather;
  storm: boolean;
  /** The lightning blink (lightningAt); it only strikes in a storm, outdoors. */
  lightning: boolean;
  /** You: your id, where you are drawn, and the tile you are on or stepping onto, and its kind. */
  me: { id: string; x: number; y: number; tx: number; ty: number; ground: TileKind | undefined } | null;
  /** The fireplaces on this map, with the fuel they have left (null: tended; see Game.fireLeft). */
  fires: Array<{ x: number; y: number; left: number | null | undefined }>;
  poles: Array<{ x: number; y: number }>;
  /** The surge's phase here, and during one how far its front still is from you, as a share of its sweep (1 far off, 0 on you). */
  surge: { phase: SurgePhase; gap: number } | null;
  caught: boolean;
  /** The creatures on this map, and whom each one chases (a player's id). */
  creatures: Array<{ id: string; kind: CreatureView['kind']; x: number; y: number; moving: boolean; chasing: string | undefined }>;
  flashes: FlashView[];
  /** You carry a live find: it shimmers faintly. */
  live: boolean;
  /** Your radio (radio.ts), or null: you have none. */
  radio: RadioScene | null;
  /** News that came this frame. */
  news: News[];
}

/** What your feet sound like on this kind of tile. */
export function stepSurface(kind: TileKind | undefined): Surface {
  switch (kind) {
    case 'road': return 'road';
    case 'mud': return 'mud';
    // Wading the culvert: water to the waist.
    case 'water': case 'culvert': return 'water';
    // Wading through tall grass: the blades brush past your legs.
    case 'tallgrass': return 'swish';
    case 'floor': case 'wall': return 'floor';
    default: return 'soft';
  }
}

/** How loud something `d` tiles away is, heard up to `far` tiles. */
const near = (d: number, far: number) => Math.max(0, 1 - d / far);

/** The mix for scene `s`; `was` is the scene a frame ago, for what just started. */
export function soundscape(s: Scene, was?: Scene): Mix {
  // Up a lookout the rain drums on its roof, as it does on a house's: the wind still blows up there.
  const outdoors = s.kind !== 'inside', roofed = !outdoors || !!s.up, me = s.me;
  const dist = (p: { x: number; y: number }) => (me ? Math.hypot(p.x - me.x, p.y - me.y) : Infinity);
  const loudest = (list: Array<{ x: number; y: number }>, far: number, k: (i: number) => number = () => 1) =>
    list.reduce((m, p, i) => Math.max(m, k(i) * near(dist(p), far)), 0);
  const wet = s.weather === 'rain' || s.storm;

  const surge = s.caught ? 1 : s.surge?.phase === 'unstable' ? 0.15 : s.surge?.phase === 'surge' ? 0.3 + 0.4 * (1 - Math.min(1, Math.max(0, s.surge.gap))) : 0;
  const loops: Record<Loop, number> = {
    // Under a roof it drums faintly: up a lookout in rain or a storm, indoors when it rains, as ever.
    rain: !roofed ? (s.storm ? 0.9 : wet ? 0.6 : 0) : (outdoors ? wet : s.weather === 'rain') ? 0.15 : 0,
    wind: !outdoors ? 0 : s.storm ? 0.6 : s.kind === 'wilds' ? 0.25 : 0,
    fire: loudest(s.fires, FIRE_HEARD, i => fireLevel(s.fires[i]!.left)),
    wires: s.weather === 'aurora' ? loudest(s.poles, WIRES_HEARD) : 0,
    surge,
    watcher: loudest(s.creatures.filter(c => c.kind === 'watcher' && c.moving), WATCHER_HEARD),
    // Something rushing through the ferns: the nearest skulker on a chase, whoever it is after.
    skulker: loudest(s.creatures.filter(c => c.chasing !== undefined), SKULKER_HEARD),
    shimmer: s.live ? 0.3 : 0,
    radio: radioCrackle(s.radio, s.kind, s.storm),
    hum: radioHum(s.radio, s.storm),
  };

  const shots: Shot[] = [];
  const same = was?.map === s.map;
  // Only your own steps, and not the one that brings you onto another map.
  if (me && same && was.me && (me.tx !== was.me.tx || me.ty !== was.me.ty)) shots.push({ kind: 'step', surface: stepSurface(me.ground) });
  if (s.storm && outdoors && s.lightning && !(same && was.lightning)) shots.push({ kind: 'thunder' });
  for (const f of s.flashes) {
    if (dist(f) > FLASH_HEARD) continue;
    const before = same ? was.flashes.find(o => o.x === f.x && o.y === f.y) : undefined;
    if (!before) shots.push({ kind: 'crackle' });
    else if (before.left > FLASH_BURST_S && f.left <= FLASH_BURST_S) shots.push({ kind: 'pop' });
  }
  // The moment one goes after you: a sharp cry, wherever it is.
  if (me && same) for (const c of s.creatures) if (c.chasing === me.id && was.creatures.find(o => o.id === c.id)?.chasing !== me.id) shots.push({ kind: 'cry' });
  // The radio switched on (or just made, on) or off: the switch is heard, even in a storm.
  if (same && !!s.radio?.on !== !!was.radio?.on) shots.push({ kind: s.radio?.on ? 'tune' : 'click' });
  for (const n of s.news) {
    if (n.kind === 'surge' && n.view.phase === 'unstable') shots.push({ kind: 'bell' });
    // The Tower's pulse: the region turning restless comes through the radio as one burst of static.
    if (n.kind === 'surge' && n.view.phase === 'unstable' && radioHears(s.radio, s.storm)) shots.push({ kind: 'pulse' });
    if (n.kind === 'storm' && n.view.phase === 'coming') shots.push({ kind: 'rise' });
    if (n.kind === 'conditions' && n.names.length) shots.push({ kind: 'dawn' });
    if (n.kind === 'tug') shots.push({ kind: 'tug' });
    // A call, from the side it comes from and as faint as it is far (calls.ts): yours too, from the middle.
    if (n.kind === 'call' && me) shots.push({ kind: 'call', ...callSound(n.call, n.id, n.x - me.x, n.y - me.y) });
  }
  return { loops, shots };
}
