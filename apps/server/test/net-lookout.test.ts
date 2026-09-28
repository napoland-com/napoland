/**
 * The fire lookout over real WebSockets (roadmap/lookout-tower.md): climbing it and coming down, what up
 * there keeps off, its lamp fed with resin and burning out, and what its beam does where it passes. Each
 * test runs a server of its own whose world clock reads what the test wants as it starts, and moves only
 * when the test moves it: the beam turns by that clock, and the surges and storms come by it.
 *
 *   woods (16x34, depth 1)
 *     0123456789ABCDEF
 *   0 tttttttttttttttt
 *   1 tggggggggggggggt   1,1: where a watcher wakes, on a map that has one
 *     ...
 *   8 tggggggLLggggggt   L: the lookout (7,8), 2 by 2; its lamp hangs over the middle of its legs, the point (8,9)
 *   9 tggggggLLggggggt
 *  10 tggggggg@ggggggt   @: the foot of its ladder (8,10), 27 steps from home
 *     ...
 *  30 tggggggggggggFgt   F: a campfire (13,30), tended: whoever waits by it (13,31) never tires
 *  32 tggggggggggggggt   where the road from town arrives, 3,32 and 4,32
 *  33 tttmmttttttttttt   the way home, 3,33 and 4,33
 *
 * The town is the fixture town with a notice board at 0,4 (read from 0,5).
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  LOOKOUT_UP_S, PROTOCOL_VERSION, STEP_MS, SURGE_DRAIN, TileMap, energyRate, inBeam, type CreatureView, type ItemsData, type MapData,
} from '@napoland/shared';
import { setLogLevel } from '../src/log';
import { startServer, type RunningServer, type ServerOptions } from '../src/server';
import { MemoryStorage, type PlayerRecord } from '../src/storage';
import { houseData, itemsData, townData } from './fixtures';
import { Client, savedPlayer, serverDefaults, waitFor } from './helpers';

const W = 16, H = 34;
const LOOKOUT = { kind: 'lookout', x: 7, y: 8 } as const;
const FOOT = { x: 8, y: 10 };
/** Beside the campfire: whoever waits there never tires, however long a test waits. */
const FIRE = { x: 13, y: 31 };
/** Midnight UTC: the start of a round of every surge and storm here (their rounds divide a day) and of a turn of the beam. */
const MIDNIGHT = Date.UTC(2026, 0, 5);
/** The game clock as each server starts; it moves only when a test moves it. */
const START = 1_000_000;

function woods(more: Partial<MapData> = {}): MapData {
  return {
    id: 'woods', name: 'The Woods', version: 1, kind: 'wilds', depth: 1, width: W, height: H,
    tiles: Array.from({ length: H }, (_, y) => (y === 0 ? 't'.repeat(W) : y === H - 1 ? `tttmm${'t'.repeat(W - 5)}` : `t${'g'.repeat(W - 2)}t`)),
    levels: Array<string>(H).fill('0'.repeat(W)),
    spawn: { x: 3, y: H - 2, dir: 'up' },
    exits: [{ x: 3, y: H - 1, w: 2, h: 1, to: 'town', tx: 4, ty: 1, dir: 'down', home: true }],
    objects: [LOOKOUT, { kind: 'fireplace', x: 13, y: 30, tended: true }],
    ...more,
  };
}
function town(): MapData {
  const t = townData();
  return { ...t, exits: t.exits.map(e => (e.to === 'woods' ? { ...e, ty: H - 2 } : e)), objects: [...t.objects, { kind: 'board', x: 0, y: 4 }] };
}
const items = (): ItemsData => ({ ...itemsData(), items: [...itemsData().items, { id: 'resin', name: 'Resin', kind: 'resource', stack: 10, text: 'Sticky.', fuel: 300 }] });
const r3 = (v: number) => Math.round(v * 1000) / 1000;

let running: Array<{ server: RunningServer; clients: Client[] }> = [];
afterEach(async () => {
  for (const { server, clients } of running) {
    for (const c of clients) c.ws.terminate();
    await server.stop();
  }
  running = [];
});

/** Long enough for a few of the server's ticks (every 20 ms) to see where the game clock is now. */
const ticks = () => new Promise(resolve => setTimeout(resolve, 80));

/** A server whose world clock reads `at` (ms since the epoch) as it starts, and moves only when the test moves it; `map` changes the woods. */
async function serverAt(at: number, more: Partial<ServerOptions> = {}, map: Partial<MapData> = {}) {
  setLogLevel('silent');
  let now = START;
  const storage = new MemoryStorage();
  const data = woods(map);
  const server = await startServer({
    ...serverDefaults(), storage, maps: [new TileMap(town()), new TileMap(houseData()), new TileMap(data)], items: items(), weather: 'overcast',
    clock: () => now, clockShiftMs: at - Date.now(), ...more,
  });
  const clients: Client[] = [];
  running.push({ server, clients });
  /** The world clock now, as the server reads it (to within the few ms the server took to start). */
  const wall = () => at + (now - START);
  return {
    map: new TileMap(data),
    wall,
    /** A player saved in the woods (unless `where` says otherwise), facing up, logged in; what follows the welcome is taken. */
    enter: async (where: Partial<PlayerRecord>) => {
      const { token, id } = await savedPlayer(storage, { map: 'woods', dir: 'up', ...where });
      const c = await Client.open(server.port);
      clients.push(c);
      c.send({ t: 'hello', v: PROTOCOL_VERSION, token });
      const welcome = await c.next('welcome');
      await c.settle();
      return { c, id, welcome };
    },
    /** Moves the game clock on by `ms`, and lets the server tick. */
    later: async (ms: number) => {
      now += ms;
      await ticks();
    },
    /** Moves the game clock on to world clock time `t`, and lets the server tick. */
    until: async (t: number) => {
      now += Math.max(0, t - wall());
      await ticks();
    },
    creatures: (): CreatureView[] => server.world.scene('woods', now).creatures,
  };
}

/** The next whole pass of a burning lamp's beam over tile x,y after world clock time `from`: when it comes onto it, and when it has gone (ms). */
function beamOver(x: number, y: number, from: number): [number, number] {
  let t = from;
  while (inBeam(LOOKOUT, x, y, t)) t += 10;
  while (!inBeam(LOOKOUT, x, y, t)) t += 10;
  const on = t;
  while (inBeam(LOOKOUT, x, y, t)) t += 10;
  return [on, t];
}

describe('the fire lookout, over the network', () => {
  it('is climbed from the foot of its ladder, and everyone sees it; up there nobody walks, B brings them down, and after two minutes down they come anyway', async () => {
    const w = await serverAt(MIDNIGHT);
    const a = await w.enter({ ...FOOT });
    const b = await w.enter({ x: 10, y: 12 });
    // From anywhere but its foot, or at a corner that is not the lookout's, nothing is climbed.
    b.c.send({ t: 'climb', x: 7, y: 8 });
    expect(await b.c.next('refused')).toEqual({ t: 'refused', action: 'climb', reason: 'too_far' });
    a.c.send({ t: 'climb', x: 8, y: 8 });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'climb', reason: 'too_far' });
    a.c.send({ t: 'climb', x: 7, y: 8 });
    expect(await a.c.next('up')).toEqual({ t: 'up', id: a.id, on: true, left: LOOKOUT_UP_S });
    expect(await b.c.next('up')).toEqual({ t: 'up', id: a.id, on: true });
    // Whoever comes along sees them up there, over the foot of the ladder, where they climbed.
    const c = await w.enter({ x: 12, y: 14 });
    expect(c.welcome.players.find(p => p.id === a.id)).toMatchObject({ x: 8, y: 10, up: true });
    expect(c.welcome.players.find(p => p.id === b.id)!.up).toBeUndefined();
    // Up there nobody walks, picks anything up or climbs any higher.
    a.c.send({ t: 'step', dir: 'down', seq: 1 });
    expect(await a.c.next('reject')).toEqual({ t: 'reject', seq: 1, x: 8, y: 10, dir: 'up' });
    a.c.send({ t: 'pick', x: 8, y: 11 });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'pick', reason: 'up' });
    a.c.send({ t: 'climb', x: 7, y: 8 });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'climb', reason: 'up' });
    // B: down the ladder, and off they go.
    a.c.send({ t: 'climbDown' });
    expect(await a.c.next('up')).toEqual({ t: 'up', id: a.id, on: false });
    expect(await b.c.next('up')).toEqual({ t: 'up', id: a.id, on: false });
    expect(await c.c.next('up')).toEqual({ t: 'up', id: a.id, on: false });
    a.c.send({ t: 'step', dir: 'down', seq: 2 });
    expect(await a.c.next('step', m => m.seq === 2)).toMatchObject({ x: 8, y: 11 });
    // Back up, for two minutes at most: then down they come, and everyone sees it.
    await w.later(STEP_MS);
    a.c.send({ t: 'step', dir: 'up', seq: 3 });
    await a.c.next('step', m => m.seq === 3);
    a.c.send({ t: 'climb', x: 7, y: 8 });
    expect(await a.c.next('up')).toEqual({ t: 'up', id: a.id, on: true, left: LOOKOUT_UP_S });
    await w.later(LOOKOUT_UP_S * 1000 - 1000);
    expect((await a.c.settle()).filter(m => m.t === 'up')).toEqual([]);
    await w.later(1000);
    expect(await a.c.next('up')).toEqual({ t: 'up', id: a.id, on: false });
    expect(await b.c.next('up', m => !m.on)).toEqual({ t: 'up', id: a.id, on: false });
  });

  it('keeps a storm and a flash off whoever is up there, as a roof does, but they tire as they would at its foot', async () => {
    // A storm from 170 s into every 200, for 30 s; a flash every 5 s near whoever is out in the open.
    const w = await serverAt(MIDNIGHT + 160_000, { rng: () => 0 }, { storm: { every: 200, warn: 10, length: 30 }, flashes: { every: 5, steps: [0, 999] } });
    const a = await w.enter({ ...FOOT });
    a.c.send({ t: 'climb', x: 7, y: 8 });
    await a.c.next('up');
    // Into the storm, for three flashes' time.
    await w.until(MIDNIGHT + 172_000);
    for (let k = 0; k < 3; k++) await w.later(5000);
    const up = await a.c.settle();
    expect(up.filter(m => m.t === 'flash')).toEqual([]);
    expect(up.filter(m => m.t === 'energy').length).toBeGreaterThan(0);
    const base = r3(energyRate(w.map, 8, 10, 'overcast'));
    for (const m of up) if (m.t === 'energy') {
      expect(m.energy.rate).toBe(base);
      expect(m.body.wetRate).toBeLessThanOrEqual(0);
    }
    // Down the ladder into it: the storm's drain and its rain, and soon a flash near them.
    a.c.send({ t: 'climbDown' });
    const down = await a.c.next('energy');
    expect(down.energy.rate).toBe(r3(energyRate(w.map, 8, 10, 'overcast', { storm: true })));
    expect(down.energy.rate).toBeLessThan(base);
    expect(down.body.wetRate).toBeGreaterThan(0);
    await w.later(5000);
    expect(await a.c.next('flash')).toMatchObject({ t: 'flash' });
  });

  it('shakes off whatever clings to you as you climb, and nothing clings up there, deep in the dark as it is', async () => {
    const w = await serverAt(MIDNIGHT, { weather: 'night', rng: () => 0 });
    const a = await w.enter({ ...FOOT });
    // 27 steps from home in the dark: with these dice, something clings as soon as time moves.
    await w.later(100);
    expect(await a.c.next('hitch')).toEqual({ t: 'hitch', on: true });
    a.c.send({ t: 'climb', x: 7, y: 8 });
    expect(await a.c.next('hitch')).toEqual({ t: 'hitch', on: false });
    for (let k = 0; k < 3; k++) await w.later(10_000);
    expect((await a.c.settle()).filter(m => m.t === 'hitch')).toEqual([]);
    // Down again, and it finds them.
    a.c.send({ t: 'climbDown' });
    await a.c.next('up');
    await w.later(100);
    expect(await a.c.next('hitch')).toEqual({ t: 'hitch', on: true });
  });

  it('burns resin fed at the foot of its ladder: six fill it for an hour, the woods see it lit, the notice board says for how long, and it goes out when they burn away', async () => {
    const w = await serverAt(MIDNIGHT);
    const a = await w.enter({ ...FOOT, bag: [{ item: 'moss', count: 1 }, { item: 'resin', count: 5 }, { item: 'resin', count: 3 }] });
    const b = await w.enter({ ...FIRE, bag: [{ item: 'resin', count: 1 }] });
    const r = await w.enter({ map: 'town', x: 0, y: 5 });
    expect(a.welcome.lamps).toEqual([{ x: 7, y: 8, left: 0 }]);
    expect(r.welcome.lamps).toBeUndefined();
    const board = async () => {
      r.c.send({ t: 'board', x: 0, y: 4 });
      return (await r.c.next('board')).lines.filter(l => l.includes('lookout'));
    };
    expect(await board()).toEqual(['The fire lookout in the Woods: its lamp is out. It burns resin: feed it at the foot of the ladder.']);

    // Moss does not burn in it, and nobody feeds it but from the foot of its ladder.
    a.c.send({ t: 'feed', x: 7, y: 8, slot: 0 });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'feed', reason: 'not_fuel' });
    b.c.send({ t: 'feed', x: 7, y: 8, slot: 0 });
    expect(await b.c.next('refused')).toEqual({ t: 'refused', action: 'feed', reason: 'too_far' });
    // As many as asked, from every slot of it, while it has room: six, an hour's worth, and it lights.
    a.c.send({ t: 'feed', x: 7, y: 8, slot: 1, count: 8 });
    expect(await a.c.next('did')).toEqual({ t: 'did', did: { kind: 'lamp', item: 'resin', count: 6, left: 3600, lit: true } });
    expect(await a.c.next('bag')).toEqual({ t: 'bag', bag: [{ item: 'moss', count: 1 }, { item: 'resin', count: 2 }] });
    expect(await b.c.next('lamp')).toEqual({ t: 'lamp', lamp: { x: 7, y: 8, left: 3600 } });
    expect(await board()).toEqual(['The fire lookout in the Woods: its lamp burns for about 60 minutes more, and its beam sweeps the woods.']);
    // Full, it takes no more; and up there, nobody reaches it.
    a.c.send({ t: 'feed', x: 7, y: 8, slot: 1 });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'feed', reason: 'lamp_full' });
    a.c.send({ t: 'climb', x: 7, y: 8 });
    await a.c.next('up');
    a.c.send({ t: 'feed', x: 7, y: 8, slot: 1 });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'feed', reason: 'too_far' });
    a.c.ws.terminate();

    // Fifty minutes on, ten are left; at the hour it goes out, and everyone in the woods sees it.
    await w.later(3_000_000);
    expect(await board()).toEqual(['The fire lookout in the Woods: its lamp burns for about 10 minutes more, and its beam sweeps the woods.']);
    expect((await b.c.settle()).filter(m => m.t === 'lamp')).toEqual([]);
    await w.later(600_000);
    expect(await b.c.next('lamp')).toEqual({ t: 'lamp', lamp: { x: 7, y: 8, left: 0 } });
    expect(await board()).toEqual(['The fire lookout in the Woods: its lamp is out. It burns resin: feed it at the foot of the ladder.']);
  });
});

describe('the fire lookout\'s beam, over the network', () => {
  it('shelters whoever it passes over from a surge, as a street light does, only while it is on them', async () => {
    // A surge from 160 s into every 200, whose front reaches the way home 5 s later: then everyone out there is in it.
    const w = await serverAt(MIDNIGHT + 150_000, {}, { surge: { every: 200, unstable: 20, surge: 40, sweep: 5 } });
    const f = await w.enter({ ...FOOT, bag: [{ item: 'resin', count: 1 }] });
    const lit = await w.enter({ x: 8, y: 4 });
    const dark = await w.enter({ x: 13, y: 20 });
    f.c.send({ t: 'feed', x: 7, y: 8, slot: 0 });
    await f.c.next('did');
    const base = (x: number, y: number) => r3(energyRate(w.map, x, y, 'overcast'));
    const surged = (x: number, y: number) => r3(energyRate(w.map, x, y, 'overcast', { surgeFront: 0, surgeDrain: SURGE_DRAIN }));
    // The beam comes round to 8,4 a while after the front has swept the whole map.
    const [on, off] = beamOver(8, 4, MIDNIGHT + 166_000);
    expect(on - 2000).toBeGreaterThan(MIDNIGHT + 166_000);
    await w.until(on - 2000);
    await lit.c.next('energy', m => m.energy.rate === surged(8, 4));
    await dark.c.next('energy', m => m.energy.rate === surged(13, 20));
    // Under it, only the woods' own drain.
    await w.until(on + 150);
    await lit.c.next('energy', m => m.energy.rate === base(8, 4));
    // Gone on, and the surge has them again.
    await w.until(off + 150);
    await lit.c.next('energy', m => m.energy.rate === surged(8, 4));
    // Where it never came, the surge never let up.
    expect((await dark.c.settle()).filter(m => m.t === 'energy' && m.energy.rate !== surged(13, 20))).toEqual([]);
  });

  it('shakes off whatever clings to whoever it passes over in the dark, while its lamp burns, and only as it passes', async () => {
    const w = await serverAt(MIDNIGHT, { weather: 'night', rng: () => 0 });
    // 33 steps from home: with these dice, something clings as soon as time moves.
    const h = await w.enter({ x: 8, y: 4 });
    await w.later(100);
    expect(await h.c.next('hitch')).toEqual({ t: 'hitch', on: true });
    // Its lamp out, there is no beam: the moment it would pass over 8,4 comes and goes, and it clings on.
    let [on, off] = beamOver(8, 4, w.wall());
    await w.until(on + 150);
    await w.until(off + 150);
    expect((await h.c.settle()).filter(m => m.t === 'hitch')).toEqual([]);
    // Lit, its beam comes round and shakes it off; gone on, and it clings again (with these dice, at once).
    const f = await w.enter({ ...FOOT, bag: [{ item: 'resin', count: 1 }] });
    f.c.send({ t: 'feed', x: 7, y: 8, slot: 0 });
    await f.c.next('did');
    [on, off] = beamOver(8, 4, w.wall());
    await w.until(on + 150);
    expect(await h.c.next('hitch')).toEqual({ t: 'hitch', on: false });
    await w.until(off + 150);
    expect(await h.c.next('hitch')).toEqual({ t: 'hitch', on: true });
  });

  it('holds a watcher still while it is on it, as a face does, however long its prey\'s back is turned', async () => {
    // One watcher, waking 30 steps from home or more: with these dice at 1,1, the first such tile far enough from everyone.
    const w = await serverAt(MIDNIGHT, { rng: () => 0 }, { watchers: { count: 1, steps: [30, 99] } });
    // Its prey, 8 steps below it with their back turned; and someone at the lookout with resin for its lamp.
    const p = await w.enter({ x: 1, y: 9, dir: 'down' });
    const f = await w.enter({ ...FOOT, bag: [{ item: 'resin', count: 1 }] });
    await waitFor(() => w.creatures().length > 0, 'the watcher to wake');
    expect(w.creatures()).toEqual([{ id: 1, kind: 'watcher', x: 1, y: 1, dir: 'down' }]);
    f.c.send({ t: 'feed', x: 7, y: 8, slot: 0 });
    await f.c.next('did');
    await p.c.settle();
    // For as long as the beam is on 1,1 the watcher stays there, though it may step every half second.
    const [on, off] = beamOver(1, 1, w.wall() + 1000);
    await w.until(on + 100);
    while (w.wall() < off - 200) await w.later(100);
    expect((await p.c.settle()).filter(m => m.t === 'creature')).toEqual([]);
    expect(w.creatures()).toEqual([{ id: 1, kind: 'watcher', x: 1, y: 1, dir: 'down' }]);
    // Gone on, and it comes.
    await w.until(off + 600);
    expect(await p.c.next('creature')).toEqual({ t: 'creature', creature: { id: 1, kind: 'watcher', x: 1, y: 2, dir: 'down' } });
  });
});
