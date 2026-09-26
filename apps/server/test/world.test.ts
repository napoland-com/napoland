import { describe, expect, it } from 'vitest';
import { STEP_MS, TileMap, type Dir, type MapData } from '@napoland/shared';
import type { PlayerRecord } from '../src/storage';
import { JACKET_COLORS, STEP_QUEUE_MAX, STEP_TOLERANCE_MS, World, colorFor, type Outgoing } from '../src/world';

/** 8x5 grass with water in the two right columns and rocks at 1,0 and 2,0. */
function testMap(): TileMap {
  const data: MapData = {
    id: 'test', name: 'Test', version: 1, width: 8, height: 5,
    tiles: Array<string>(5).fill('ggggggww'),
    levels: Array<string>(5).fill('00000000'),
    spawn: { x: 1, y: 2, dir: 'down' },
    objects: [
      { kind: 'rock', x: 1, y: 0, s: 1, v: 0 },
      { kind: 'rock', x: 2, y: 0, s: 1, v: 0 },
    ],
  };
  return new TileMap(data);
}

function rec(id: string, x: number, y: number, dir: Dir = 'down'): PlayerRecord {
  return { id, name: id.toUpperCase(), tokenHash: `hash-${id}`, x, y, dir, color: colorFor(id), createdAt: 1, lastSeenAt: 1 };
}

/** A world with the given players joined and the join messages already drained. */
function worldWith(...players: PlayerRecord[]): World {
  const w = new World(testMap());
  for (const p of players) w.join(p);
  w.drain();
  return w;
}

/** The step or reject answers `id` got, in order. */
const answers = (out: Outgoing[], id: string) => out.filter(o => o.to === id).map(o => o.msg);

describe('World: stepping', () => {
  it('moves one tile, gives the mover its seq and everyone else the step without it', () => {
    const w = worldWith(rec('a', 1, 1), rec('b', 4, 4));
    w.step('a', 'right', 7, 1000);
    expect(w.drain()).toEqual([
      { to: 'a', msg: { t: 'step', id: 'a', x: 2, y: 1, dir: 'right', seq: 7 } },
      { to: '*', except: 'a', msg: { t: 'step', id: 'a', x: 2, y: 1, dir: 'right' } },
    ]);
    expect(w.get('a')).toMatchObject({ x: 2, y: 1, dir: 'right' });
  });

  it('queues up to two early steps, rejects a third and runs the queue on tick', () => {
    const w = worldWith(rec('a', 1, 1));
    w.step('a', 'right', 1, 1000); // runs: readyAt is now 1200
    w.step('a', 'right', 2, 1000);
    w.step('a', 'right', 3, 1000);
    expect(STEP_QUEUE_MAX).toBe(2);
    expect(answers(w.drain(), 'a')).toEqual([{ t: 'step', id: 'a', x: 2, y: 1, dir: 'right', seq: 1 }]);

    w.step('a', 'down', 4, 1000); // queue full: refused where the player is now
    expect(w.drain()).toEqual([{ to: 'a', msg: { t: 'reject', seq: 4, x: 2, y: 1, dir: 'right' } }]);

    w.tick(1200 - STEP_TOLERANCE_MS - 1);
    expect(w.drain()).toEqual([]);
    w.tick(1200 - STEP_TOLERANCE_MS); // step 2 may start 40 ms early; readyAt becomes 1400
    expect(answers(w.drain(), 'a')).toEqual([{ t: 'step', id: 'a', x: 3, y: 1, dir: 'right', seq: 2 }]);
    w.tick(1300);
    expect(w.drain()).toEqual([]);
    w.tick(1400 - STEP_TOLERANCE_MS);
    expect(answers(w.drain(), 'a')).toEqual([{ t: 'step', id: 'a', x: 4, y: 1, dir: 'right', seq: 3 }]);
    w.tick(5000);
    expect(w.drain()).toEqual([]);
  });

  it('lets a step start up to 40 ms early, and no earlier', () => {
    const w = worldWith(rec('a', 1, 1));
    w.step('a', 'right', 1, 1000);
    w.step('a', 'down', 2, 1200 - STEP_TOLERANCE_MS); // just in time
    w.step('a', 'down', 3, 1400 - STEP_TOLERANCE_MS - 1); // 1 ms too early: waits
    expect(answers(w.drain(), 'a').map(m => m.t === 'step' && m.seq)).toEqual([1, 2]);
    w.tick(1400 - STEP_TOLERANCE_MS);
    expect(answers(w.drain(), 'a')).toEqual([{ t: 'step', id: 'a', x: 2, y: 3, dir: 'down', seq: 3 }]);
  });

  it('never lets anyone walk faster than one tile per stepMs, however fast they send', () => {
    const w = worldWith(rec('a', 2, 2));
    const walked: number[] = [];
    let rejected = 0;
    for (let now = 0, seq = 0; now <= 4000; now += 5) {
      // Flood: a step every 5 ms, back and forth so the walls never get in the way.
      w.step('a', seq % 2 ? 'left' : 'right', seq++, now);
      if (now % 50 === 0) w.tick(now);
      for (const m of answers(w.drain(), 'a')) {
        if (m.t === 'step') walked.push(now);
        else rejected++;
      }
    }
    expect(rejected).toBeGreaterThan(0);
    expect(walked.length).toBeLessThanOrEqual(4000 / STEP_MS + 1);
    // Starting early never adds up: n steps always take at least n * stepMs, minus one tolerance.
    for (let i = 0; i < walked.length; i++) {
      for (let j = i + 1; j < walked.length; j++) expect(walked[j]! - walked[i]!).toBeGreaterThanOrEqual((j - i) * STEP_MS - STEP_TOLERANCE_MS);
    }
  });

  it('never rejects a client that sends at the right pace, even with network jitter', () => {
    const w = worldWith(rec('a', 2, 2));
    let rng = 42;
    const jitter = () => ((rng = (rng * 48271) % 2147483647) % 71) - 35; // -35..35 ms
    const arrivals = Array.from({ length: 60 }, (_, i) => 1000 + i * STEP_MS + jitter());
    const answered: string[] = [];
    let next = 0;
    for (let now = 1000 - 35; now <= arrivals.at(-1)! + 1000; now++) {
      while (next < arrivals.length && arrivals[next]! <= now) w.step('a', next % 2 ? 'left' : 'right', next++, now);
      if (now % 50 === 0) w.tick(now);
      for (const m of answers(w.drain(), 'a')) answered.push(m.t);
    }
    expect(answered).toEqual(Array<string>(60).fill('step'));
  });

  it('rejects steps into walls, water and the map edge with the real position, to the mover only', () => {
    const w = worldWith(rec('rock', 1, 1, 'left'), rec('water', 5, 3, 'up'), rec('edge', 0, 4, 'right'), rec('other', 3, 3));
    w.step('rock', 'up', 1, 1000);
    w.step('water', 'right', 2, 1000);
    w.step('edge', 'down', 3, 1000);
    expect(w.drain()).toEqual([
      { to: 'rock', msg: { t: 'reject', seq: 1, x: 1, y: 1, dir: 'left' } },
      { to: 'water', msg: { t: 'reject', seq: 2, x: 5, y: 3, dir: 'up' } },
      { to: 'edge', msg: { t: 'reject', seq: 3, x: 0, y: 4, dir: 'right' } },
    ]);
    expect(w.get('rock')).toMatchObject({ x: 1, y: 1, dir: 'left' });
  });

  it('drops the steps queued behind one that hits a wall', () => {
    const w = worldWith(rec('a', 1, 1));
    w.step('a', 'right', 1, 1000); // to 2,1
    w.step('a', 'up', 2, 1000); // queued: 2,0 is a rock
    w.step('a', 'down', 3, 1000); // queued behind it
    w.drain();
    w.tick(1200);
    expect(w.drain()).toEqual([{ to: 'a', msg: { t: 'reject', seq: 2, x: 2, y: 1, dir: 'right' } }]);
    w.tick(2000);
    w.tick(3000);
    expect(w.drain()).toEqual([]);
    expect(w.get('a')).toMatchObject({ x: 2, y: 1 });
  });

  it('lets players share a tile', () => {
    const w = worldWith(rec('a', 3, 3), rec('b', 4, 3));
    w.step('a', 'right', 1, 1000);
    w.step('b', 'down', 1, 1000);
    w.step('b', 'up', 2, 1200);
    expect(w.get('a')).toMatchObject({ x: 4, y: 3 });
    expect(w.get('b')).toMatchObject({ x: 4, y: 3 });
    expect(w.drain().some(o => o.msg.t === 'reject')).toBe(false);
  });

  it('does not reset the step timer when a player leaves and comes back', () => {
    const w = worldWith(rec('a', 3, 3));
    w.step('a', 'right', 1, 1000); // readyAt 1200
    const back = w.leave('a')!;
    w.join(back);
    w.drain();
    w.step('a', 'right', 2, 1010);
    expect(w.drain()).toEqual([]);
    w.tick(1200);
    expect(answers(w.drain(), 'a')).toEqual([{ t: 'step', id: 'a', x: 5, y: 3, dir: 'right', seq: 2 }]);
  });

  it('ignores steps and turns of players who are not online', () => {
    const w = worldWith(rec('a', 3, 3));
    w.step('ghost', 'right', 1, 1000);
    w.face('ghost', 'left');
    w.tick(2000);
    expect(w.drain()).toEqual([]);
  });
});

describe('World: turning, joining and leaving', () => {
  it('tells everyone else when a player turns, and only if the direction changed', () => {
    const w = worldWith(rec('a', 3, 3, 'down'), rec('b', 1, 1));
    w.face('a', 'left');
    expect(w.drain()).toEqual([{ to: '*', except: 'a', msg: { t: 'face', id: 'a', dir: 'left' } }]);
    expect(w.get('a')?.dir).toBe('left');
    w.face('a', 'left');
    expect(w.drain()).toEqual([]);
  });

  it('announces joins and leaves to everyone else', () => {
    const w = new World(testMap());
    const view = w.join(rec('a', 3, 3));
    expect(view).toEqual({ id: 'a', name: 'A', x: 3, y: 3, dir: 'down', color: colorFor('a') });
    expect(w.drain()).toEqual([{ to: '*', except: 'a', msg: { t: 'join', player: view } }]);
    w.join(rec('b', 4, 4));
    expect(w.views().map(v => v.id)).toEqual(['a', 'b']);
    expect(w.size).toBe(2);
    w.drain();

    w.step('a', 'up', 1, 1000);
    w.drain();
    expect(w.leave('a')).toMatchObject({ id: 'a', x: 3, y: 2, dir: 'up', tokenHash: 'hash-a' });
    expect(w.drain()).toEqual([{ to: '*', except: 'a', msg: { t: 'leave', id: 'a' } }]);
    expect(w.has('a')).toBe(false);
    expect(w.leave('a')).toBeUndefined();
    expect(w.drain()).toEqual([]);
  });

  it('puts a player whose saved tile is no longer walkable at the spawn', () => {
    const w = new World(testMap());
    expect(w.join(rec('a', 1, 0))).toMatchObject({ x: 1, y: 2, dir: 'down' }); // a rock
    expect(w.join(rec('b', 60, 60))).toMatchObject({ x: 1, y: 2, dir: 'down' }); // off the map
  });

  it('refuses to have the same player online twice', () => {
    const w = worldWith(rec('a', 3, 3));
    expect(() => w.join(rec('a', 3, 3))).toThrow(/already online/);
  });

  it('keeps its own copy of the record', () => {
    const r = rec('a', 3, 3);
    const w = worldWith(r);
    w.step('a', 'right', 1, 1000);
    expect(r.x).toBe(3);
    const copy = w.get('a')!;
    copy.x = 99;
    expect(w.get('a')?.x).toBe(4);
  });
});

describe('jacket colors', () => {
  it('are picked from the palette, the same for the same id', () => {
    const ids = Array.from({ length: 300 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    for (const id of ids) {
      expect(JACKET_COLORS).toContain(colorFor(id));
      expect(colorFor(id)).toBe(colorFor(id));
    }
    expect(new Set(ids.map(colorFor)).size).toBe(JACKET_COLORS.length);
    expect(JACKET_COLORS.length).toBeGreaterThanOrEqual(8);
    for (const c of JACKET_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});
