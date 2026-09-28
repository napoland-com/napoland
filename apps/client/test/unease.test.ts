import { describe, expect, it } from 'vitest';
import { TileMap, UNEASE_LEVELS, faces, type ClientMsg, type Dir, type MapData, type PlayerView } from '@napoland/shared';
import { Game, type News } from '../src/game';
import { Maps } from '../src/maps';
import { soundscape, type Scene } from '../src/soundscape';
import { newsBanner } from '../src/status';
import {
  Apparition, FIGURE_EDGE, FIGURE_FROM, FIGURE_IN_S, FIGURE_OUT_S, FIGURE_STAY_S, FIGURE_TILES, STALK_EVERY_S, STALK_FROM, Stalker, figureSpot, uneaseLook, type EdgeOf,
} from '../src/unease';
import { ITEMS, tinyTown, tinyWoods, welcome } from './fixtures';

/**
 * A clearing out in the wilds, 25 by 25, open grass in a ring of forest, the way home at 12,24; watchers
 * roam it unless `watchers` is false. A street lamp at 6,12, and tall grass at 19,13: both about 8 tiles
 * from 12,18, where you stand in the tests.
 */
function clearing(watchers = true): MapData {
  const W = 25, H = 25, row = (y: number) => {
    if (y === 0) return 't'.repeat(W);
    if (y === H - 1) return `${'t'.repeat(12)}g${'t'.repeat(12)}`;
    return `t${[...'g'.repeat(W - 2)].map((c, i) => (y === 13 && i + 1 === 19 ? 'h' : c)).join('')}t`;
  };
  return {
    id: watchers ? 'clearing' : 'quiet', name: 'Clearing', version: 1, kind: 'wilds', depth: 1, width: W, height: H,
    tiles: Array.from({ length: H }, (_, y) => row(y)), levels: Array<string>(H).fill('0'.repeat(W)),
    spawn: { x: 12, y: 22, dir: 'up' },
    exits: [{ x: 12, y: 24, w: 1, h: 1, to: 'town', tx: 3, ty: 1, dir: 'down', home: true }],
    objects: [{ kind: 'lamp', x: 6, y: 12 }],
    ...(watchers ? { watchers: { count: 1, steps: [6, 99] as [number, number] } } : {}),
  };
}

const map = new TileMap(clearing()), quiet = new TileMap(clearing(false));
/** A screen for someone at x0,y0: a tile is seen as far out as it is from them, the edge 12 tiles away. */
const screen = (x0: number, y0: number): EdgeOf => (x, y) => Math.hypot(x - x0, y - y0) / 12;

describe('the edges of the screen', () => {
  it('close in with each level, darker and nearer, and breathe only when it is full', () => {
    const looks = Array.from({ length: UNEASE_LEVELS + 1 }, (_, l) => uneaseLook(l));
    expect(looks[0]).toEqual({ opacity: 0, scale: 1.4, breathe: false });
    for (let l = 1; l <= UNEASE_LEVELS; l++) {
      expect(looks[l]!.opacity).toBeGreaterThan(looks[l - 1]!.opacity);
      expect(looks[l]!.scale).toBeLessThan(looks[l - 1]!.scale);
      expect(looks[l]!.breathe).toBe(l === UNEASE_LEVELS);
    }
    // At full the dark ring sits at the screen's edge, and the middle stays clear to find the way by.
    expect(looks[UNEASE_LEVELS]).toMatchObject({ scale: 1, breathe: true });
    expect(looks[UNEASE_LEVELS]!.opacity).toBeLessThan(1);
    // A level it does not know is the nearest it does.
    expect(uneaseLook(-1)).toEqual(looks[0]);
    expect(uneaseLook(UNEASE_LEVELS + 5)).toEqual(looks[UNEASE_LEVELS]);
  });
});

describe('steps that are not yours', () => {
  /** With these dice each wait is halfway between the shortest and the longest, and a stop gets one step, standing two. */
  const stalker = () => new Stalker(() => 0.5);
  const wait = (level: number) => ((STALK_EVERY_S[0] + STALK_EVERY_S[1]) / 2) * (1 - 0.3 * (level - STALK_FROM)) * 1000;

  it('never sound below their level, or anywhere but out in the wilds', () => {
    const s = stalker();
    for (let t = 0; t < 600_000; t += 1000) {
      expect(s.update(t, STALK_FROM - 1, true, false)).toBe(0);
      expect(s.update(t + 500, UNEASE_LEVELS, false, false)).toBe(0);
    }
  });

  it('come a while after they may, never at once, and sooner the uneasier you are', () => {
    for (const level of [STALK_FROM, UNEASE_LEVELS]) {
      const s = stalker();
      expect(s.update(0, level, true, false)).toBe(0);
      expect(s.update(wait(level) - 1, level, true, false)).toBe(0);
      expect(s.update(wait(level), level, true, false)).toBe(2);
      // And again, as long again after.
      expect(s.update(2 * wait(level) - 1, level, true, false)).toBe(0);
      expect(s.update(2 * wait(level), level, true, false)).toBe(2);
    }
    expect(wait(UNEASE_LEVELS)).toBeLessThan(wait(STALK_FROM));
  });

  it('wait while you walk, and come right as you stop: a step more than yours', () => {
    const s = stalker();
    s.update(0, UNEASE_LEVELS, true, true);
    for (let t = 0; t <= wait(UNEASE_LEVELS) * 2; t += 200) expect(s.update(t, UNEASE_LEVELS, true, true)).toBe(0);
    expect(s.update(wait(UNEASE_LEVELS) * 2 + 200, UNEASE_LEVELS, true, false)).toBe(1);
  });

  it('come sooner once you grow uneasier, never later', () => {
    const s = stalker();
    s.update(0, STALK_FROM, true, false);
    s.update(1000, UNEASE_LEVELS, true, false);
    expect(s.update(1000 + wait(UNEASE_LEVELS), UNEASE_LEVELS, true, false)).toBe(2);
  });
});

describe('what stands at the edge of the fog', () => {
  /** Every spot it may take for you at 12,18 facing `dir`, as far as a hundred rolls of the dice find them. */
  const spots = (m: TileMap, dir: Dir) => {
    const seen = new Map<string, { x: number; y: number }>();
    for (let k = 0; k < 100; k++) {
      const s = figureSpot(m, 12, 18, dir, screen(12, 18), () => k / 100);
      if (s) seen.set(`${s.x},${s.y}`, s);
    }
    return [...seen.values()];
  };

  it('stands where you do not look, toward the fog, near the screen\'s edge, and only where a watcher could', () => {
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      const all = spots(map, dir);
      expect(all.length, dir).toBeGreaterThan(0);
      for (const s of all) {
        expect(faces(12, 18, dir, s.x, s.y)).toBe(false);
        expect(s.y).toBeLessThanOrEqual(18);
        const d = Math.hypot(s.x - 12, s.y - 18);
        expect(d).toBeGreaterThanOrEqual(FIGURE_TILES[0]);
        expect(d).toBeLessThanOrEqual(FIGURE_TILES[1]);
        expect(d / 12).toBeGreaterThanOrEqual(FIGURE_EDGE[0]);
        expect(d / 12).toBeLessThanOrEqual(FIGURE_EDGE[1]);
        // Never in a street light, never in tall grass, never in the trees.
        expect(map.creatureMayStand(s.x, s.y)).toBe(true);
      }
    }
    // Facing north, into the fog, it can only be level with you, far to a side.
    expect(spots(map, 'up').every(s => s.y === 18)).toBe(true);
    // The light and the tall grass are right there, as far away as it stands.
    expect(map.lit(6, 12) || map.lit(7, 12)).toBe(true);
    expect(map.kind(19, 13)).toBe('tallgrass');
    expect(Math.hypot(19 - 12, 13 - 18) / 12).toBeGreaterThan(FIGURE_EDGE[0]);
  });

  it('has nowhere to stand off the screen', () => {
    expect(figureSpot(map, 12, 18, 'down', () => null, () => 0.5)).toBeNull();
    expect(figureSpot(map, 12, 18, 'down', () => 1.5, () => 0.5)).toBeNull();
  });

  /** With these dice each wait is halfway between the shortest and the longest. */
  const apparition = () => new Apparition(() => 0.5);
  /** Frames every 100 ms from `from` to `to` (ms), for you at 12,18: the most that showed, and what shows at the end. */
  function frames(a: Apparition, from: number, to: number, o: { m?: TileMap; level?: number; dark?: boolean; dir?: Dir; x?: number; y?: number } = {}) {
    let most = 0, last = 0;
    for (let t = from; t <= to; t += 100) {
      last = a.update(t, o.m ?? map, o.level ?? UNEASE_LEVELS, o.dark ?? true, o.x ?? 12, o.y ?? 18, o.dir ?? 'down', screen(12, 18));
      most = Math.max(most, last);
    }
    return { most, last };
  }

  it('never comes where no watchers roam, by day, or below its level', () => {
    expect(frames(apparition(), 0, 600_000, { m: quiet }).most).toBe(0);
    expect(frames(apparition(), 0, 600_000, { dark: false }).most).toBe(0);
    expect(frames(apparition(), 0, 600_000, { level: FIGURE_FROM - 1 }).most).toBe(0);
  });

  it('comes a while after it may, out of the dark slowly, and left long enough fades back and comes again later', () => {
    const a = apparition();
    // Halfway between the shortest wait and the longest: 47.5 s.
    expect(frames(a, 0, 47_400).most).toBe(0);
    expect(a.standing).toBe(false);
    frames(a, 47_500, 47_500);
    expect(a.standing).toBe(true);
    expect(frames(a, 47_600, 47_500 + (FIGURE_IN_S / 2) * 1000).last).toBeCloseTo(0.5, 5);
    expect(frames(a, 47_500 + (FIGURE_IN_S / 2) * 1000 + 100, 47_500 + FIGURE_STAY_S * 1000).last).toBe(1);
    expect(frames(a, 47_500 + FIGURE_STAY_S * 1000 + 100, 47_500 + (FIGURE_STAY_S + FIGURE_OUT_S / 2) * 1000).last).toBeCloseTo(0.5, 5);
    const gone = 47_500 + (FIGURE_STAY_S + FIGURE_OUT_S) * 1000;
    expect(frames(a, gone - 900, gone).last).toBe(0);
    expect(a.standing).toBe(false);
    expect(frames(a, gone + 100, gone + 47_400).most).toBe(0);
    frames(a, gone + 47_500, gone + 47_500);
    expect(a.standing).toBe(true);
  });

  /** One standing, fully come out of the dark, 50 s in. */
  const standing = () => {
    const a = apparition();
    frames(a, 0, 50_000);
    expect(a.standing).toBe(true);
    return a;
  };

  it('is gone the moment you turn toward it', () => {
    const a = standing(), dir = a.y < 18 ? 'up' : a.x < 12 ? 'left' : 'right';
    expect(a.update(50_100, map, UNEASE_LEVELS, true, 12, 18, 'down', screen(12, 18))).toBe(1);
    expect(a.update(50_200, map, UNEASE_LEVELS, true, 12, 18, dir, screen(12, 18))).toBe(0);
    expect(a.standing).toBe(false);
    // Turning back does not bring it back.
    expect(a.update(50_300, map, UNEASE_LEVELS, true, 12, 18, 'down', screen(12, 18))).toBe(0);
  });

  it('is gone when the unease or the dark lifts, when you come near, or when you lose sight of it', () => {
    expect(standing().update(50_100, map, FIGURE_FROM - 1, true, 12, 18, 'down', screen(12, 18))).toBe(0);
    expect(standing().update(50_100, map, UNEASE_LEVELS, false, 12, 18, 'down', screen(12, 18))).toBe(0);
    const near = standing();
    expect(near.update(50_100, map, UNEASE_LEVELS, true, near.x, near.y + 3, 'down', screen(12, 18))).toBe(0);
    expect(standing().update(50_100, map, UNEASE_LEVELS, true, 12, 18, 'down', () => 1.2)).toBe(0);
    // Another map: gone, and its own wait begins.
    const moved = standing();
    expect(moved.update(50_100, new TileMap(clearing()), UNEASE_LEVELS, true, 12, 18, 'down', screen(12, 18))).toBe(0);
    expect(moved.standing).toBe(false);
  });
});

describe('unease in the game', () => {
  const maps = new Maps([tinyTown(), tinyWoods()]);
  const me = (x: number, y: number, dir: PlayerView['dir'] = 'up'): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir, color: '#f29e4c', gear: {}, quirks: [] });
  const game = () => new Game(maps, (_: ClientMsg) => {}, ITEMS);

  it('keeps the level the server tells, and nobody comes into the game uneasy', () => {
    const g = game();
    g.handle(welcome(tinyWoods(), [me(2, 4)]), 1000);
    expect(g.unease).toBe(0);
    g.handle({ t: 'unease', level: 3 }, 1000);
    expect(g.unease).toBe(3);
    g.handle({ t: 'unease', level: 99 }, 1000);
    expect(g.unease).toBe(UNEASE_LEVELS);
    g.handle(welcome(tinyWoods(), [me(2, 4)]), 2000);
    expect(g.unease).toBe(0);
  });

  it('hears steps that are not yours out in the wilds, on the ground behind you, and never in town', () => {
    const stalks = (map: MapData, at: PlayerView) => {
      const g = game();
      g.handle(welcome(map, [at]), 1000);
      g.handle({ t: 'unease', level: UNEASE_LEVELS }, 1000);
      // Full, the longest wait is well under two minutes.
      for (let t = 1000; t <= 121_000; t += 500) g.update(0.5, t);
      return g.takeNews(121_000).filter((n): n is Extract<News, { kind: 'stalk' }> => n.kind === 'stalk');
    };
    const heard = stalks(tinyWoods(), me(2, 4, 'up'));
    expect(heard.length).toBeGreaterThan(0);
    // Behind you, facing up the trail, is the mud of the way home.
    for (const n of heard) expect(n).toMatchObject({ ground: 'mud', steps: expect.any(Number) });
    expect(stalks(tinyTown(), me(3, 3))).toEqual([]);
  });

  it('are for the ears alone: no banner, and the same in both ears', () => {
    const n: News = { kind: 'stalk', steps: 2, ground: 'road' };
    expect(newsBanner(n, 'The Test Woods', ITEMS)).toBeNull();
    const scene: Scene = {
      map: 'woods', kind: 'wilds', weather: 'night', storm: false, lightning: false, me: { id: 'me', x: 2, y: 4, tx: 2, ty: 4, ground: 'grass' },
      fires: [], poles: [], surge: null, caught: false, creatures: [], flashes: [], live: false, radio: null, news: [n],
    };
    expect(soundscape(scene).shots).toEqual([{ kind: 'stalk', surface: 'road', steps: 2 }]);
  });
});
