/**
 * Unease as your own game shows it (DESIGN.md, What wears you down: unease). The server keeps how uneasy
 * you are and now and then tells a level, 0 to UNEASE_LEVELS; everything here only shows it, and only to
 * you: the edges of the screen close in (uneaseLook), steps that are not yours sound behind you now and
 * then (Stalker), and where watchers roam, at the higher levels, something stands at the edge of the fog,
 * too far to make out, gone when you turn toward it (Apparition). None of it is there: nobody else sees or
 * hears it, no creature is behind it, and none of it ever says where anything is. Plain logic, tested
 * without a page.
 */
import { UNEASE_LEVELS, faces, type Dir, type TileMap } from '@napoland/shared';

/** The edges of the screen as unease closes them in (hud.ts draws it). */
export interface UneaseLook {
  /** How dark the edges are: 0, not there at all, to 1. */
  opacity: number;
  /** How far out the dark ring sits: 1 at the screen's edge, off it beyond, so as it shrinks the edges close in. */
  scale: number;
  /** Full: the edges breathe, slowly in and out. */
  breathe: boolean;
}

/** The darkest the edges get, at full: the middle stays clear, since you still have to find your way. */
const EDGE_DARKEST = 0.88;

/** How the edges look at `level`: darker and closer in with each level, and at full they breathe. */
export function uneaseLook(level: number): UneaseLook {
  const k = Math.min(UNEASE_LEVELS, Math.max(0, Math.round(level))) / UNEASE_LEVELS;
  // The first level is already felt, the last ones less each: a feeling grows fast, then settles in.
  return { opacity: Math.round(EDGE_DARKEST * k ** 0.8 * 1000) / 1000, scale: Math.round((1.4 - 0.4 * k) * 1000) / 1000, breathe: k >= 1 };
}

/** Steps that are not yours sound from this level on, and only out in the wilds. */
export const STALK_FROM = 2;
/** Seconds between them at STALK_FROM, shortest and longest; each level more takes STALK_SOONER of it away. */
export const STALK_EVERY_S: readonly [number, number] = [50, 100];
const STALK_SOONER = 0.3;

/**
 * When the steps that are not yours sound. They wait while you walk (your own steps would hide them) and
 * come as you stand still, or right as you stop: a step or two more than yours. The first comes a while
 * after they may, never at once, and sooner the uneasier you are.
 */
export class Stalker {
  /** When the next may come (ms); Infinity while none may. */
  private nextAt = Infinity;
  private level = 0;
  private walked = false;

  constructor(private readonly rng: () => number = Math.random) {}

  /**
   * How many steps sound behind you now (0: none), `now` in ms, at `level`, out in the wilds or not
   * (`wilds`), walking or not. A number, so a frame makes nothing new.
   */
  update(now: number, level: number, wilds: boolean, walking: boolean): number {
    const stopped = this.walked && !walking;
    this.walked = walking;
    if (!wilds || level < STALK_FROM) {
      this.nextAt = Infinity;
      this.level = 0;
      return 0;
    }
    // Uneasier than when the next was set, it may come sooner; never later.
    if (level !== this.level) {
      this.nextAt = Math.min(this.nextAt, now + this.gap(level));
      this.level = level;
    }
    if (walking || now < this.nextAt) return 0;
    this.nextAt = now + this.gap(level);
    return (stopped ? 1 : 2) + (this.rng() < 0.5 ? 1 : 0);
  }

  /** A while (ms) until the next, at `level`. */
  private gap(level: number): number {
    const [a, b] = STALK_EVERY_S, k = Math.max(0, 1 - STALK_SOONER * (level - STALK_FROM));
    return (a + this.rng() * (b - a)) * k * 1000;
  }
}

/** Something stands at the edge of the fog from this level on, only where watchers roam. */
export const FIGURE_FROM = 3;
/** How far from you it stands, nearest and farthest (tiles, center to center); nearer than the first, it is gone. */
export const FIGURE_TILES: readonly [number, number] = [6, 16];
/** Where on the screen it is seen, as a share of the way from the middle to the edge (edgeOf): near the edge, whole on it. */
export const FIGURE_EDGE: readonly [number, number] = [0.6, 0.88];
/** Seconds until it stands there, shortest and longest (again each time after it is gone). */
export const FIGURE_EVERY_S: readonly [number, number] = [25, 70];
/** Seconds it takes to come out of the dark; how long it stands there unless you look; how long it takes to fade back. */
export const FIGURE_IN_S = 2;
export const FIGURE_STAY_S = 16;
export const FIGURE_OUT_S = 3;
/** With nowhere for it to stand (trees all round, say), it looks again this much later (seconds). */
const FIGURE_RETRY_S = 3;

/**
 * How far out on the screen something standing on tile x,y is seen: 0 in the middle to 1 at the edge (more:
 * off it), or null for behind the camera. The view says it (WorldView.edgeOf).
 */
export type EdgeOf = (x: number, y: number) => number | null;

/**
 * Where something may stand at the edge of the fog for you on tile x,y facing `dir`: where a watcher could
 * (out of the light, away from fires, never in tall grass), FIGURE_TILES from you, toward the fog (the
 * camera looks north, where the fog closes in: north of you, or level with you) and never on the side you
 * face, seen near the edge of the screen (FIGURE_EDGE). One of those, at random; null when there is none.
 */
export function figureSpot(map: TileMap, x: number, y: number, dir: Dir, edge: EdgeOf, rng: () => number): { x: number; y: number } | null {
  const [near, far] = FIGURE_TILES, [from, to] = FIGURE_EDGE, spots: Array<{ x: number; y: number }> = [];
  for (let ty = y - far; ty <= y; ty++) {
    for (let tx = x - far; tx <= x + far; tx++) {
      const d = Math.hypot(tx - x, ty - y);
      if (d < near || d > far || faces(x, y, dir, tx, ty) || !map.creatureMayStand(tx, ty)) continue;
      const e = edge(tx, ty);
      if (e !== null && e >= from && e <= to) spots.push({ x: tx, y: ty });
    }
  }
  return spots[Math.min(spots.length - 1, Math.floor(rng() * spots.length))] ?? null;
}

/**
 * Something at the edge of the fog: on a map where watchers roam, in the dark, at FIGURE_FROM or more, now
 * and then it stands somewhere you are not looking. It comes out of the dark slowly, and it is gone at once
 * when you turn toward it, come near it or lose sight of it, or when the dark or the unease lifts; left long
 * enough, it fades back. Only your game has it: it is no creature, and the server knows nothing of it.
 */
export class Apparition {
  /** The tile it stands on, while `standing`. */
  x = 0;
  y = 0;
  standing = false;
  private since = 0;
  /** When it may next stand there (ms); Infinity while it may not. */
  private nextAt = Infinity;
  private map: TileMap | null = null;

  constructor(private readonly rng: () => number = Math.random) {}

  /**
   * How much of it shows now, 0 (nothing there) to 1, `now` in ms: for you on tile x,y of `map` facing
   * `dir`, uneasy at `level`, in the dark or not. A number, so a frame makes nothing new.
   */
  update(now: number, map: TileMap, level: number, dark: boolean, x: number, y: number, dir: Dir, edge: EdgeOf): number {
    const may = dark && level >= FIGURE_FROM && map.data.kind === 'wilds' && !!map.data.watchers;
    if (map !== this.map) {
      this.map = map;
      this.standing = false;
      this.nextAt = Infinity;
    }
    if (this.standing) {
      const age = (now - this.since) / 1000, e = edge(this.x, this.y);
      // Turn toward it and it is not there.
      const gone = !may || faces(x, y, dir, this.x, this.y) || Math.hypot(this.x - x, this.y - y) < FIGURE_TILES[0] || e === null || e > 1
        || age >= FIGURE_STAY_S + FIGURE_OUT_S;
      if (!gone) return Math.max(0, Math.min(1, age / FIGURE_IN_S, (FIGURE_STAY_S + FIGURE_OUT_S - age) / FIGURE_OUT_S));
      this.standing = false;
      this.nextAt = now + this.gap();
      return 0;
    }
    if (!may) {
      this.nextAt = Infinity;
      return 0;
    }
    // Never the moment it may: a while after.
    if (this.nextAt === Infinity) this.nextAt = now + this.gap();
    if (now < this.nextAt) return 0;
    const spot = figureSpot(map, x, y, dir, edge, this.rng);
    if (!spot) {
      this.nextAt = now + FIGURE_RETRY_S * 1000;
      return 0;
    }
    this.x = spot.x;
    this.y = spot.y;
    this.standing = true;
    this.since = now;
    return 0;
  }

  private gap(): number {
    const [a, b] = FIGURE_EVERY_S;
    return (a + this.rng() * (b - a)) * 1000;
  }
}
