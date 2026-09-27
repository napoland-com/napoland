/**
 * What the game should sound like now: how loud each loop plays, and the sounds to fire once. Plain
 * data in, plain data out, so it is tested without a page; sound.ts makes the noise.
 */
import { FLASH_BURST_S, type FlashView, type MapKind, type SurgePhase, type TileKind, type Weather } from '@napoland/shared';
import type { News } from './game';
import { fireLevel } from './view/fire';

/** A fire is heard this many tiles away, the wires this many on aurora nights, a moving watcher this many (the server's WATCHER_HUNT). */
const FIRE_HEARD = 4;
const WIRES_HEARD = 5;
const WATCHER_HEARD = 9;
/** A flash crackles and pops this close to you. */
const FLASH_HEARD = 6;

export type Surface = 'road' | 'soft' | 'mud' | 'floor' | 'water';
export type Loop = 'rain' | 'wind' | 'fire' | 'wires' | 'surge' | 'watcher';
export type Shot = { kind: 'step'; surface: Surface } | { kind: 'thunder' | 'crackle' | 'pop' | 'bell' | 'rise' | 'dawn' };

export interface Mix {
  /** How loud each loop should play, 0 to 1. */
  loops: Record<Loop, number>;
  shots: Shot[];
}

/** The game as it stands this frame, as far as sound cares. */
export interface Scene {
  map: string;
  kind: MapKind;
  weather: Weather;
  storm: boolean;
  /** The lightning blink (lightningAt); it only strikes in a storm, outdoors. */
  lightning: boolean;
  /** You: where you are drawn, and the tile you are on or stepping onto, and its kind. */
  me: { x: number; y: number; tx: number; ty: number; ground: TileKind | undefined } | null;
  /** The fireplaces on this map, with the fuel they have left (null: tended; see Game.fireLeft). */
  fires: Array<{ x: number; y: number; left: number | null | undefined }>;
  poles: Array<{ x: number; y: number }>;
  /** The surge's phase here, and during one how far its front still is from you, as a share of its sweep (1 far off, 0 on you). */
  surge: { phase: SurgePhase; gap: number } | null;
  caught: boolean;
  watchers: Array<{ x: number; y: number; moving: boolean }>;
  flashes: FlashView[];
  /** News that came this frame. */
  news: News[];
}

/** What your feet sound like on this kind of tile. */
export function stepSurface(kind: TileKind | undefined): Surface {
  switch (kind) {
    case 'road': return 'road';
    case 'mud': return 'mud';
    case 'water': return 'water';
    case 'floor': case 'wall': return 'floor';
    default: return 'soft';
  }
}

/** How loud something `d` tiles away is, heard up to `far` tiles. */
const near = (d: number, far: number) => Math.max(0, 1 - d / far);

/** The mix for scene `s`; `was` is the scene a frame ago, for what just started. */
export function soundscape(s: Scene, was?: Scene): Mix {
  const outdoors = s.kind !== 'inside', me = s.me;
  const dist = (p: { x: number; y: number }) => (me ? Math.hypot(p.x - me.x, p.y - me.y) : Infinity);
  const loudest = (list: Array<{ x: number; y: number }>, far: number, k: (i: number) => number = () => 1) =>
    list.reduce((m, p, i) => Math.max(m, k(i) * near(dist(p), far)), 0);
  const wet = s.weather === 'rain' || s.storm;

  const surge = s.caught ? 1 : s.surge?.phase === 'unstable' ? 0.15 : s.surge?.phase === 'surge' ? 0.3 + 0.4 * (1 - Math.min(1, Math.max(0, s.surge.gap))) : 0;
  const loops: Record<Loop, number> = {
    rain: outdoors ? (s.storm ? 0.9 : wet ? 0.6 : 0) : s.weather === 'rain' ? 0.15 : 0,
    wind: !outdoors ? 0 : s.storm ? 0.6 : s.kind === 'wilds' ? 0.25 : 0,
    fire: loudest(s.fires, FIRE_HEARD, i => fireLevel(s.fires[i]!.left)),
    wires: s.weather === 'aurora' ? loudest(s.poles, WIRES_HEARD) : 0,
    surge,
    watcher: loudest(s.watchers.filter(w => w.moving), WATCHER_HEARD),
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
  for (const n of s.news) {
    if (n.kind === 'surge' && n.view.phase === 'unstable') shots.push({ kind: 'bell' });
    if (n.kind === 'storm' && n.view.phase === 'coming') shots.push({ kind: 'rise' });
    if (n.kind === 'conditions' && n.names.length) shots.push({ kind: 'dawn' });
  }
  return { loops, shots };
}
