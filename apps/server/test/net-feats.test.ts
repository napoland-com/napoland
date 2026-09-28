/**
 * Feats with ranks over real WebSockets: the maps and items of fixtures-feats.ts on a server with
 * in-memory storage, a game clock that only moves when a test moves it, and dice that always come up
 * (rng 0), so a forager's find comes up double whenever it may.
 */
import { describe, expect, it } from 'vitest';
import { STEP_MS, TileMap, WET_SECONDS, energyRate, type Dir } from '@napoland/shared';
import { COAT, corridorData, featItems, featMaps } from './fixtures-feats';
import { setup, waitFor, type Client } from './helpers';

const long = new TileMap(corridorData());
const r3 = (v: number) => Math.round(v * 1000) / 1000;

describe('feats over the wire', () => {
  let now = 1_000_000;
  let seq = 0;
  const { ctx, enter } = setup({ maps: featMaps(), items: featItems(), weather: 'rain', clock: () => now, rng: () => 0 });
  const world = () => ctx.server.world;
  /** One step, a step's time on the game clock after the last. */
  async function step(c: Client, dir: Dir) {
    const s = ++seq;
    c.send({ t: 'step', dir, seq: s });
    await c.next('step', m => m.seq === s);
    now += STEP_MS;
  }
  /** The moss on the long trail, grown back if someone took it. */
  async function moss() {
    if (!world().findViews('long').some(f => f.item === 'moss')) {
      now += 1000;
      await waitFor(() => world().findViews('long').some(f => f.item === 'moss'), 'the moss to grow back');
    }
    return world().findViews('long').find(f => f.item === 'moss')!;
  }

  it('tells a new rank once, with the rank and the counts, and saves it at once', async () => {
    const a = await enter({ map: 'long', x: 1, y: 70, stats: { rainSteps: 4_999 } });
    await a.c.settle();
    await step(a.c, 'up');
    expect(await a.c.next('feat')).toEqual({ t: 'feat', id: 'rain-walker', rank: 2, stats: { rainSteps: 5_000 } });
    await waitFor(() => ctx.storage.get(a.id)!.stats?.rainSteps === 5_000, 'the new rank to be saved');
    await step(a.c, 'up');
    await step(a.c, 'up');
    expect((await a.c.settle()).filter(m => m.t === 'feat')).toEqual([]);
    expect(world().get(a.id)!.stats).toEqual({ rainSteps: 5_002 });
  });

  it('gives counts kept from before ranks their rank at the welcome, without a word', async () => {
    const a = await enter({ map: 'long', x: 1, y: 70, stats: { rainSteps: 20_000, found: 5_000 } });
    expect(a.welcome.stats).toEqual({ rainSteps: 20_000, found: 5_000 });
    // Rank 3 of the rain walker from the start: rain soaks them 40% slower.
    expect(a.welcome.body.wetRate).toBe(Math.round((0.6 / WET_SECONDS) * 1e5) / 1e5);
    expect((await a.c.settle()).filter(m => m.t === 'feat')).toEqual([]);
  });

  it('answers the status panel with the counts as they are now', async () => {
    const a = await enter({ map: 'long', x: 1, y: 70, stats: { rainSteps: 10 } });
    await step(a.c, 'up');
    await step(a.c, 'up');
    a.c.send({ t: 'stats' });
    expect(await a.c.next('stats')).toEqual({ t: 'stats', stats: { rainSteps: 12 } });
  });

  it('doubles a forager\'s find out in the wilds, and counts every find picked up there', async () => {
    const m = await moss();
    const a = await enter({ map: 'long', x: m.x, y: m.y + 1, stats: { found: 200 } });
    await a.c.settle();
    a.c.send({ t: 'pick', x: m.x, y: m.y });
    expect(await a.c.next('got')).toEqual({ t: 'got', items: [{ item: 'moss', count: 2 }], from: 'find', double: true });
    expect(await a.c.next('bag')).toEqual({ t: 'bag', bag: [{ item: 'moss', count: 2 }] });
    expect(world().get(a.id)!.stats).toEqual({ found: 201 });
    // Without a rank, one.
    const again = await moss();
    const b = await enter({ map: 'long', x: again.x, y: again.y + 1 });
    await b.c.settle();
    b.c.send({ t: 'pick', x: again.x, y: again.y });
    expect(await b.c.next('got')).toEqual({ t: 'got', items: [{ item: 'moss', count: 1 }], from: 'find' });
    expect(world().get(b.id)!.stats).toEqual({ found: 1 });
  });

  it('wears a mender\'s gear slower out there, and counts every piece mended at the workbench', async () => {
    const plain = await enter({ map: 'long', x: 1, y: 70, gear: COAT });
    const mender = await enter({ map: 'long', x: 1, y: 71, gear: COAT, stats: { mended: 40 } });
    now += 50_000;
    await waitFor(() => world().get(plain.id)!.worn!.shirt!.cond < 0.51, 'the coats to wear down');
    // 100 s out there wear a sturdy coat out: half of it in 50 s, and 15% less than that at rank 3.
    expect(world().get(plain.id)!.worn!.shirt!.cond).toBeCloseTo(0.5, 5);
    expect(world().get(mender.id)!.worn!.shirt!.cond).toBeCloseTo(1 - 0.5 * 0.85, 5);

    const a = await enter({ map: 'house', x: 1, y: 2, dir: 'up', gear: COAT, worn: { shirt: { cond: 0.3 } }, stash: { items: { cloth: 2 }, out: {} }, stats: { mended: 4 } });
    a.c.send({ t: 'mend', x: 1, y: 1, slot: 'shirt' });
    // What it did comes in the text box's message (ask-first), and the mend counts once.
    expect(await a.c.next('did')).toEqual({ t: 'did', did: { kind: 'mended', item: 'coat' } });
    expect(await a.c.next('feat')).toEqual({ t: 'feat', id: 'mender', rank: 1, stats: { mended: 5 } });
    expect(world().get(a.id)!.stats).toEqual({ mended: 5 });
  });

  it('drains a pathfinder more gently 85 steps or more from home, and nowhere nearer', async () => {
    // 1,10 is 89 steps from home, 1,20 is 79.
    const far = await enter({ map: 'long', x: 1, y: 10, stats: { farSteps: 5_000 } });
    const farPlain = await enter({ map: 'long', x: 1, y: 10 });
    expect(far.welcome.energy.rate).toBe(r3(energyRate(long, 1, 10, 'rain', { farDrain: 0.91 })));
    expect(farPlain.welcome.energy.rate).toBe(r3(energyRate(long, 1, 10, 'rain')));
    expect(far.welcome.energy.rate).toBeGreaterThan(farPlain.welcome.energy.rate);
    const near = await enter({ map: 'long', x: 1, y: 20, stats: { farSteps: 5_000 } });
    expect(near.welcome.energy.rate).toBe(r3(energyRate(long, 1, 20, 'rain')));
  });

  it('counts a pathfinder\'s steps only 85 or more from home, and tells the new rank\'s gentler drain at once', async () => {
    // 1,15 is 84 steps from home; 1,14 is 85.
    const a = await enter({ map: 'long', x: 1, y: 15, stats: { farSteps: 499 } });
    await a.c.settle();
    await step(a.c, 'up');
    // It rains, too: every count comes with it.
    expect(await a.c.next('feat')).toEqual({ t: 'feat', id: 'pathfinder', rank: 1, stats: { farSteps: 500, rainSteps: 1 } });
    expect((await a.c.next('energy')).energy.rate).toBe(r3(energyRate(long, 1, 14, 'rain', { farDrain: 0.97 })));
    await step(a.c, 'down');
    await step(a.c, 'down');
    expect(world().get(a.id)!.stats).toEqual({ farSteps: 500, rainSteps: 3 });
  });
});
