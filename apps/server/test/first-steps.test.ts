/**
 * A new player's first steps (roadmap/first-steps.md): to town by NAPO's teleport, out of town to pick
 * something up, and home again to put it in the chest. Each step taken is saved and said at once, and
 * after the last one nothing more is. World rules first, then over real WebSockets, where everyone new
 * starts on the first.
 *
 * The fixture world: the town of a street (fixtures.ts) with NAPO's teleport at 8,5 (it sets you down at
 * 8,6, facing down), its road up into the woods, where moss grows by the campfire (at 5,1 with the dice
 * at 0.9); and the cabin every lot's door leads into:
 *
 *   house (5x5, private)
 *     01234
 *   0 xxxxx
 *   1 xHpTx   H chest (1,1), T teleport (3,1): the one in town sets you down at 3,2, facing down
 *   2 xpzpx   z where you wake up (2,2)
 *   3 xpppx   2,3: where every lot's door leads in
 *   4 xxpxx   2,4: out onto the lane, in front of your lot's door
 */
import { describe, expect, it } from 'vitest';
import { ENERGY_MAX, FIRST_STEPS, STEP_MS, TileMap, validateWorld, type Dir, type MapData, type ServerMsg } from '@napoland/shared';
import type { LotRecord, PlayerRecord } from '../src/storage';
import { World, colorFor, zoneKey, type Outgoing } from '../src/world';
import { itemsData, laneData, streetTownData, woodsData } from './fixtures';
import { setup, waitFor } from './helpers';

function home(): MapData {
  return {
    id: 'house', name: 'Home', version: 1, kind: 'inside', depth: 0, width: 5, height: 5,
    tiles: ['xxxxx', 'xpppx', 'xpppx', 'xpppx', 'xxpxx'],
    levels: Array<string>(5).fill('00000'),
    spawn: { x: 2, y: 3, dir: 'up' },
    exits: [{ x: 2, y: 4, w: 1, h: 1, to: 'lane', tx: 2, ty: 3, dir: 'down' }],
    objects: [{ kind: 'chest', x: 1, y: 1 }, { kind: 'teleport', x: 3, y: 1 }],
    private: true,
    wake: { x: 2, y: 2, dir: 'down' },
  };
}

function town(): MapData {
  const t = streetTownData();
  return { ...t, objects: [...t.objects, { kind: 'teleport', x: 8, y: 5 }] };
}

const maps = () => [new TileMap(town()), new TileMap(laneData()), new TileMap(home()), new TileMap(woodsData())];

const rec = (id: string, map: string, x: number, y: number, dir: Dir, more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map, x, y, dir, color: colorFor(id), energy: ENERGY_MAX, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});
const lot = (id: string, n: number): LotRecord => ({ id, name: id.toUpperCase(), street: 1, lot: n });

/** With the dice at 0.9, the moss in the woods lies at 5,1. */
function world(lots: LotRecord[]): World {
  return new World(maps(), 'town', 'overcast', { items: itemsData(), rng: () => 0.9, lots });
}
/** Settled in where the record says: whom they block, and who blocks them, is known (World.returned). */
function enter(w: World, r: PlayerRecord): void {
  w.join(r, 0);
  w.returned(r.id, 0);
}
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id ? [o.msg] : []));
/** What `id` heard of their first steps. */
const steps = (out: Outgoing[], id: string) => to(out, id).filter((m): m is Extract<ServerMsg, { t: 'firstSteps' }> => m.t === 'firstSteps');
/** Whose first steps were saved, and which step each is on now. */
const saved = (w: World) => w.takeWrites().players.map(p => [p.id, p.firstSteps]);
let seq = 0;
/** Walks `dirs` one step after the other from game time `at`; returns the time after the last. */
function walk(w: World, id: string, dirs: Dir[], at: number): number {
  for (const dir of dirs) {
    w.step(id, dir, ++seq, at);
    at += STEP_MS;
  }
  return at;
}
const times = (dir: Dir, n: number): Dir[] => Array<Dir>(n).fill(dir);

describe('the fixtures', () => {
  it('fit together: a cabin with a teleport, and its twin in town', () => {
    expect(validateWorld([town(), laneData(), home(), woodsData()], 'town').filter(p => p.level === 'error')).toEqual([]);
    expect(FIRST_STEPS).toBe(3);
  });
});

describe('the first steps', () => {
  it('take a new player to town by the teleport, out of town to pick something up, and home again to the chest, each saved and said at once', () => {
    const w = world([lot('a', 0)]);
    enter(w, rec('a', 'house', 2, 2, 'down', { zone: 'a', firstSteps: 1 }));
    w.drain();
    w.takeWrites();
    // To town: in front of the teleport there, and the next step to take.
    let at = walk(w, 'a', ['right'], 1000);
    w.teleport('a', 3, 1, at);
    expect(w.get('a')).toMatchObject({ map: 'town', x: 8, y: 6 });
    expect(steps(w.drain(), 'a')).toEqual([{ t: 'firstSteps', step: 2 }]);
    expect(w.get('a')!.firstSteps).toBe(2);
    expect(saved(w)).toContainEqual(['a', 2]);
    // Up the road into the woods and to the moss by the campfire: picked up, and the last step to take.
    at = walk(w, 'a', [...times('left', 3), ...times('up', 6)], at);
    expect(w.get('a')).toMatchObject({ map: 'woods', x: 4, y: 6 });
    at = walk(w, 'a', [...times('right', 2), ...times('up', 5)], at);
    w.drain();
    w.pick('a', 5, 1, at);
    expect(to(w.drain(), 'a').map(m => m.t)).toEqual(['got', 'bag', 'firstSteps']);
    expect(w.get('a')!.firstSteps).toBe(3);
    expect(saved(w)).toContainEqual(['a', 3]);
    // Back down to town and home by the teleport: home is not the step; putting it in the chest is.
    at = walk(w, 'a', [...times('down', 5), ...times('left', 2), 'down'], at);
    expect(w.get('a')).toMatchObject({ map: 'town', x: 5, y: 1 });
    at = walk(w, 'a', [...times('down', 5), ...times('right', 3)], at);
    w.drain();
    w.teleport('a', 8, 5, at);
    expect(w.zoneOf('a')).toBe(zoneKey('house', 'a'));
    expect(steps(w.drain(), 'a')).toEqual([]);
    at = walk(w, 'a', ['left', 'left'], at);
    w.store('a', 1, 1, undefined, at);
    const out = w.drain();
    expect(steps(out, 'a')).toEqual([{ t: 'firstSteps', step: null }]);
    expect(w.get('a')!.stash!.items).toEqual({ moss: 1 });
    expect(w.get('a')).not.toHaveProperty('firstSteps');
    expect(saved(w)).toContainEqual(['a', undefined]);
    // Done: nothing more is said, whatever they do.
    at = walk(w, 'a', ['right', 'right'], at);
    w.teleport('a', 3, 1, at);
    expect(w.get('a')).toMatchObject({ map: 'town' });
    expect(steps(w.drain(), 'a')).toEqual([]);
  });

  it('count the first one walked too: out the door, along the lane and up the road into town', () => {
    const w = world([lot('a', 0)]);
    enter(w, rec('a', 'house', 2, 3, 'down', { zone: 'a', firstSteps: 1 }));
    let at = walk(w, 'a', ['down'], 1000);
    expect(w.get('a')).toMatchObject({ map: 'lane', x: 2, y: 3 });
    w.drain();
    at = walk(w, 'a', [...times('right', 4), ...times('down', 2)], at);
    expect(w.get('a')).toMatchObject({ map: 'town' });
    expect(steps(w.drain(), 'a')).toEqual([{ t: 'firstSteps', step: 2 }]);
  });

  it('go one at a time: a step out of turn, or something picked up in town, is not one', () => {
    const w = world([lot('a', 0), lot('b', 1), lot('c', 2)]);
    // Two steps ahead: in the woods, on the moss's tile, the first still to take.
    enter(w, rec('a', 'woods', 5, 1, 'down', { firstSteps: 1 }));
    // Out of town is where the second is: nails picked up in town are not it.
    const [nail] = w.findViews('town');
    enter(w, rec('b', 'town', nail!.x, nail!.y, 'down', { firstSteps: 2 }));
    // At home by the chest, with the second still to take.
    enter(w, rec('c', 'house', 1, 2, 'up', { zone: 'c', firstSteps: 2, bag: [{ item: 'moss', count: 1 }] }));
    w.drain();
    w.takeWrites();
    w.pick('a', 5, 1, 1000);
    w.pick('b', nail!.x, nail!.y, 1000);
    w.store('c', 1, 1, undefined, 1000);
    const out = w.drain();
    expect(to(out, 'a').map(m => m.t)).toEqual(['got', 'bag']);
    expect(to(out, 'b').map(m => m.t)).toEqual(['got', 'bag']);
    expect(steps(out, 'c')).toEqual([]);
    expect(['a', 'b', 'c'].map(id => w.get(id)!.firstSteps)).toEqual([1, 2, 2]);
    // Stored, for c; nobody's first steps.
    expect(saved(w)).toEqual([['c', 2]]);
    // To town again, with the first one taken: nothing.
    const at = walk(w, 'c', ['right', 'right'], 2000);
    w.teleport('c', 3, 1, at);
    expect(w.get('c')).toMatchObject({ map: 'town' });
    expect(steps(w.drain(), 'c')).toEqual([]);
    expect(w.get('c')!.firstSteps).toBe(2);
  });

  it('are never shown to a player from before them', () => {
    const w = world([lot('old', 0)]);
    enter(w, rec('old', 'house', 2, 2, 'down', { zone: 'old' }));
    let at = walk(w, 'old', ['right'], 1000);
    w.teleport('old', 3, 1, at);
    at = walk(w, 'old', [...times('left', 3), ...times('up', 6), ...times('right', 2), ...times('up', 5)], at);
    w.pick('old', 5, 1, at);
    at = walk(w, 'old', [...times('down', 5), ...times('left', 2), 'down', ...times('down', 5), ...times('right', 3)], at);
    w.teleport('old', 8, 5, at);
    at = walk(w, 'old', ['left', 'left'], at);
    w.store('old', 1, 1, undefined, at);
    expect(w.get('old')!.stash!.items).toEqual({ moss: 1 });
    expect(steps(w.drain(), 'old')).toEqual([]);
    expect(w.get('old')).not.toHaveProperty('firstSteps');
  });

  it('keep a saved step that is one of them, and say it in the welcome; anything else saved reads as none', () => {
    const w = world([]);
    for (const [i, n] of [1, 2, 3].entries()) {
      const id = `ok${i}`;
      expect(w.join(rec(id, 'town', 1 + i, 5, 'down', { firstSteps: n }), 0).firstSteps).toBe(n);
      expect(w.get(id)!.firstSteps).toBe(n);
    }
    for (const [i, bad] of [0, 4, -1, 1.5, Number.NaN, '2' as unknown as number].entries()) {
      const id = `bad${i}`;
      expect(w.join(rec(id, 'town', i, 6, 'down', { firstSteps: bad }), 0), String(bad)).not.toHaveProperty('firstSteps');
      expect(w.get(id), String(bad)).not.toHaveProperty('firstSteps');
    }
  });
});

describe('the first steps over the network', () => {
  const { ctx, join, enter: saved } = setup(() => ({ maps: maps(), items: itemsData(), weather: 'overcast' }));

  it('start everyone new on the first, in the welcome and in storage, and a player from before them on none', async () => {
    const fresh = await join();
    expect(fresh.welcome.firstSteps).toBe(1);
    await waitFor(() => ctx.storage.get(fresh.id) !== undefined, 'the new player to be stored');
    expect(ctx.storage.get(fresh.id)!.firstSteps).toBe(1);
    // In their cabin, where they wake up: the teleport is a step to the right.
    expect(fresh.welcome.map.id).toBe('house');
    const older = await saved({ map: 'town', x: 1, y: 5 });
    expect(older.welcome).not.toHaveProperty('firstSteps');
  });

  it('say the next one and save it at once', async () => {
    const p = await saved({ map: 'house', x: 3, y: 2, dir: 'up', firstSteps: 1 });
    expect(p.welcome.firstSteps).toBe(1);
    p.c.send({ t: 'teleport', x: 3, y: 1 });
    expect(await p.c.next('firstSteps')).toEqual({ t: 'firstSteps', step: 2 });
    await waitFor(() => ctx.storage.get(p.id)?.firstSteps === 2, 'the step to be saved');
  });
});
