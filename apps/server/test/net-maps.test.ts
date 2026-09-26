/**
 * Maps, exits, energy and collapsing, over real WebSockets: the fixture town and woods (see
 * fixtures.ts) on a server with in-memory storage.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENERGY_MAX, ENERGY_SYNC_MS, REFILL_PER_SECOND, STEP_MS, TileMap, energyRate, type EnergyView } from '@napoland/shared';
import { setLogLevel } from '../src/log';
import { colorFor } from '../src/world';
import { woodsData } from './fixtures';
import { setup, waitFor, type Client } from './helpers';

const woods = new TileMap(woodsData());
/** The energy a player is told: value to 1 decimal, rate to 3. */
const told = (value: number, rate: number): EnergyView => ({ value: Math.round(value * 10) / 10, max: ENERGY_MAX, rate: Math.round(rate * 1000) / 1000 });
/** What a client heard so far about the others (its energy aside: in the woods it repeats every 2 s). */
const news = async (c: Client) => (await c.settle()).filter(m => m.t !== 'energy');

describe('exits', () => {
  const { ctx, enter } = setup({ weather: 'rain' });

  it('takes a player into the woods and back: the step, then zone with the arrival tile and facing, then energy', async () => {
    const a = await enter({ map: 'town', x: 4, y: 1, dir: 'up' });
    a.c.send({ t: 'step', dir: 'up', seq: 1 });
    const me = { id: a.id, name: a.welcome.name, color: colorFor(a.id) };
    expect(await a.c.settle()).toEqual([
      { t: 'step', id: a.id, x: 4, y: 0, dir: 'up', seq: 1 },
      { t: 'zone', map: { id: 'woods', version: 1 }, x: 3, y: 6, dir: 'up', players: [{ ...me, x: 3, y: 6, dir: 'up' }], reason: 'exit' },
      { t: 'energy', energy: told(ENERGY_MAX, energyRate(woods, 3, 6, 'rain')) },
    ]);
    expect(ctx.server.world.get(a.id)).toMatchObject({ map: 'woods', x: 3, y: 6, dir: 'up' });

    // Right away: it waits for the step onto the exit to be over, like any other step.
    a.c.send({ t: 'step', dir: 'down', seq: 2 });
    expect(await a.c.next('step')).toEqual({ t: 'step', id: a.id, x: 3, y: 7, dir: 'down', seq: 2 });
    expect(await a.c.next('zone')).toEqual({
      t: 'zone', map: { id: 'town', version: 1 }, x: 4, y: 1, dir: 'down', players: [{ ...me, x: 4, y: 1, dir: 'down' }], reason: 'exit',
    });
    await a.c.next('energy', m => m.energy.rate === REFILL_PER_SECOND);
    expect(ctx.server.world.get(a.id)).toMatchObject({ map: 'town', x: 4, y: 1, dir: 'down' });
  });

  it('keeps news on its own map: players on the other map neither see nor hear them', async () => {
    const t = await enter({ map: 'town', x: 0, y: 5 });
    const w = await enter({ map: 'woods', x: 5, y: 5 });
    const a = await enter({ map: 'town', x: 4, y: 1, dir: 'up' });
    expect(w.welcome.players.map(p => p.id)).toEqual([w.id]);
    expect(a.welcome.players.map(p => p.id)).toEqual([t.id, a.id]);
    expect(await news(t.c)).toEqual([{ t: 'join', player: a.welcome.players[1] }]);
    expect(await news(w.c)).toEqual([]);

    a.c.send({ t: 'step', dir: 'up', seq: 1 });
    const zone = await a.c.next('zone');
    expect(zone.players.map(p => p.id)).toEqual([w.id, a.id]);
    expect(await news(t.c)).toEqual([
      { t: 'step', id: a.id, x: 4, y: 0, dir: 'up' },
      { t: 'leave', id: a.id },
    ]);
    expect(await news(w.c)).toEqual([{ t: 'join', player: zone.players[1] }]);
    expect(zone.players[1]).toEqual({ id: a.id, name: a.welcome.name, x: 3, y: 6, dir: 'up', color: colorFor(a.id) });

    a.c.send({ t: 'face', dir: 'left' });
    expect(await w.c.next('face')).toEqual({ t: 'face', id: a.id, dir: 'left' });
    t.c.send({ t: 'step', dir: 'down', seq: 1 });
    await t.c.next('step');
    expect(await news(t.c)).toEqual([]);
    // a heard its own step and nothing of the town it left.
    expect((await news(a.c)).map(m => m.t)).toEqual(['step']);
    expect(await news(w.c)).toEqual([]);
  });

  it('drops the steps queued on the old map', async () => {
    const a = await enter({ map: 'town', x: 4, y: 2, dir: 'up' });
    a.c.send({ t: 'step', dir: 'up', seq: 1 }); // at once
    a.c.send({ t: 'step', dir: 'up', seq: 2 }); // waits, then walks onto the exit
    a.c.send({ t: 'step', dir: 'left', seq: 3 }); // waits behind it: planned in town
    expect((await a.c.next('zone')).map.id).toBe('woods');
    await new Promise(resolve => setTimeout(resolve, 3 * STEP_MS));
    const later = await a.c.settle();
    expect(later.filter(m => (m.t === 'step' || m.t === 'reject') && m.seq === 3)).toEqual([]);
    expect(ctx.server.world.get(a.id)).toMatchObject({ map: 'woods', x: 3, y: 6 });
  });

  it('starts a player whose map is gone at the home spawn', async () => {
    const a = await enter({ map: 'gone', x: 3, y: 6, dir: 'up' });
    expect(a.welcome.map).toEqual({ id: 'town', version: 1 });
    expect(a.welcome.players).toEqual([expect.objectContaining({ id: a.id, x: 1, y: 2, dir: 'down' })]);
  });
});

describe('energy', () => {
  /** Game time: the server's clock in these tests. It only moves when a test moves it. */
  let now = 1_000_000;
  const { ctx, enter, login } = setup({ weather: 'overcast', clock: () => now });
  /** Energy per second where the road from town arrives in the woods: dark, one step from home. */
  const dark = energyRate(woods, 3, 6, 'overcast');
  /** Lets the server tick a few times at the current game time. */
  const ticks = () => new Promise(resolve => setTimeout(resolve, 100));

  afterEach(() => {
    setLogLevel('silent');
    vi.restoreAllMocks();
  });

  it('drains in the wilds and refills under a street light and in town, told at once when it turns', async () => {
    const a = await enter({ map: 'woods', x: 3, y: 6, dir: 'up', energy: 50 });
    expect(a.welcome.map).toEqual({ id: 'woods', version: 1 });
    expect(a.welcome.energy).toEqual(told(50, dark));

    now += 10_000;
    expect((await a.c.next('energy')).energy).toEqual(told(50 + 10 * dark, dark));
    a.c.send({ t: 'step', dir: 'left', seq: 1 }); // into the lamp's light
    await a.c.next('step');
    expect((await a.c.next('energy')).energy).toEqual(told(50 + 10 * dark, REFILL_PER_SECOND));
    now += 1000;
    await waitFor(() => Math.abs(ctx.server.world.get(a.id)!.energy - (50 + 10 * dark + REFILL_PER_SECOND)) < 1e-9, 'a second in the light');

    a.c.send({ t: 'step', dir: 'right', seq: 2 }); // back into the dark
    expect((await a.c.next('energy')).energy).toEqual(told(50 + 10 * dark + REFILL_PER_SECOND, dark));
    now += STEP_MS;
    a.c.send({ t: 'step', dir: 'down', seq: 3 }); // home
    expect(await a.c.next('zone')).toMatchObject({ map: { id: 'town' }, x: 4, y: 1, dir: 'down', reason: 'exit' });
    expect((await a.c.next('energy')).energy.rate).toBe(REFILL_PER_SECOND);
  });

  it('repeats the energy every ENERGY_SYNC_MS while it changes, but not while full in town', async () => {
    const a = await enter({ map: 'woods', x: 3, y: 6, dir: 'up', energy: 50 });
    const full = await enter({ map: 'town', x: 0, y: 5 });
    now += ENERGY_SYNC_MS - 1;
    await ticks();
    expect((await a.c.settle()).filter(m => m.t === 'energy')).toEqual([]);
    now += 1;
    expect((await a.c.next('energy')).energy).toEqual(told(50 + (ENERGY_SYNC_MS / 1000) * dark, dark));
    now += 5 * ENERGY_SYNC_MS;
    await a.c.next('energy');
    await ticks();
    expect((await full.c.settle()).filter(m => m.t === 'energy')).toEqual([]);
  });

  it('wakes a player who runs out at home with full energy; both maps see it, and it is logged without the address', async () => {
    const a = await enter({ map: 'woods', x: 3, y: 6, dir: 'up', energy: 1 });
    const w = await enter({ map: 'woods', x: 5, y: 5 });
    const t = await enter({ map: 'town', x: 0, y: 5 });
    await Promise.all([a.c.settle(), w.c.settle(), t.c.settle()]);
    setLogLevel('info');
    const logged: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(chunk => (logged.push(String(chunk)), true));

    now += 9000; // 1 energy lasts 8.2 s here
    const me = { id: a.id, name: a.welcome.name, x: 1, y: 2, dir: 'down' as const, color: colorFor(a.id) };
    expect(await a.c.next('zone')).toEqual({
      t: 'zone', map: { id: 'town', version: 1 }, x: 1, y: 2, dir: 'down', players: [t.welcome.players[0], me], reason: 'collapse',
    });
    expect(await a.c.next('energy')).toEqual({ t: 'energy', energy: told(ENERGY_MAX, REFILL_PER_SECOND) });
    expect(await w.c.next('leave')).toEqual({ t: 'leave', id: a.id });
    expect(await t.c.next('join')).toEqual({ t: 'join', player: me });
    expect(ctx.server.world.get(a.id)).toMatchObject({ map: 'town', x: 1, y: 2, energy: ENERGY_MAX });

    const lines = logged.filter(l => l.includes('"player collapsed"')).map(l => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toEqual([expect.objectContaining({ level: 'info', id: a.id, map: 'woods', x: 3, y: 6 })]);
    expect(JSON.stringify(lines)).not.toContain('127.0.0.1');
  });

  it('keeps the map and the energy through leaving and logging in again; nothing drains while away', async () => {
    const a = await enter({ map: 'woods', x: 3, y: 6, dir: 'up', energy: 50 });
    now += 10_000;
    await a.c.next('energy');
    a.c.ws.close();
    await waitFor(() => !ctx.server.world.has(a.id), 'the player to leave');
    const saved = ctx.storage.get(a.id)!;
    expect(saved).toMatchObject({ map: 'woods', x: 3, y: 6, dir: 'up' });
    expect(saved.energy).toBeCloseTo(50 + 10 * dark);

    now += 60_000;
    const again = await login(a.token);
    expect(again.welcome).toMatchObject({ you: a.id, map: { id: 'woods', version: 1 }, energy: told(saved.energy, dark) });
    expect(again.welcome.players).toEqual([expect.objectContaining({ id: a.id, x: 3, y: 6, dir: 'up' })]);
  });
});
