/**
 * Unease over real WebSockets (unease.ts): alone in the dark it builds, a level at a time, told only as it
 * changes; company, a street light, a burning fire and a flare bring it down; full, it makes hitchhikers
 * find you twice as often. The clock is the test's, so minutes pass at once.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { TileMap, UNEASE_BUILD_S, UNEASE_CALM_S, UNEASE_COMPANY_S, UNEASE_LEVELS, xpFor, type MapData } from '@napoland/shared';
import type { PlayerRecord } from '../src/storage';
import { fixtureMaps, itemsData } from './fixtures';
import { setup, waitFor, type Client } from './helpers';

/**
 * A hollow out in the wilds, 7 tiles across and 32 deep, walled in by forest, the way home in the middle
 * of its bottom row (4,33): steps from home are |x - 4| + (33 - y), so all of its top half is deep enough
 * for hitchhikers. A street lamp at 1,1 lights 1,3 but not 1,4; a campfire that never goes out at 7,1
 * warms 6,2 but not 5,2; tall grass at 4,12.
 */
function hollowData(): MapData {
  const tiles = Array.from({ length: 34 }, (_, y) => (y === 0 ? 'ttttttttt' : y === 33 ? 'ttttgtttt' : y === 12 ? 'tggghgggt' : 'tgggggggt'));
  return {
    id: 'hollow', name: 'Hollow', version: 1, kind: 'wilds', depth: 1, width: 9, height: 34,
    tiles, levels: Array<string>(34).fill('000000000'),
    spawn: { x: 4, y: 32, dir: 'up' },
    exits: [{ x: 4, y: 33, w: 1, h: 1, to: 'town', tx: 4, ty: 1, dir: 'down', home: true }],
    objects: [{ kind: 'lamp', x: 1, y: 1 }, { kind: 'fireplace', x: 7, y: 1, tended: true }],
  };
}

/** Out in the hollow at x,y, facing up, with the biggest bar there is (level 20): minutes out there at night take a lot of it. */
const deep = (x: number, y: number, more: Partial<PlayerRecord> = {}): Partial<PlayerRecord> => ({ map: 'hollow', x, y, dir: 'up', xp: xpFor(20), energy: 1000, ...more });

/** The unease levels among what a client heard. */
const uneases = (msgs: Array<{ t: string }>) => msgs.filter(m => m.t === 'unease');

describe('unease', () => {
  let now = 1_000_000;
  /** What the server's dice roll: high enough that nothing clings to anyone, unless a test says otherwise. */
  let roll = 0.99;
  const items = itemsData();
  items.items.push({ id: 'flare', name: 'Flare', kind: 'consumable', stack: 3, text: 'Red.', use: { flare: 60 } });
  const { ctx, enter } = setup({ clock: () => now, rng: () => roll, weather: 'night', maps: [...fixtureMaps(), new TileMap(hollowData())], items });
  afterEach(() => {
    roll = 0.99;
  });

  /**
   * Minutes pass at once, and `c` hears the tick that saw them: its bar is moving out there, so it hears its
   * energy then. What it heard before is let go first, so that energy is the new tick's.
   */
  const pass = async (seconds: number, ...c: Client[]) => {
    for (const x of c) await x.settle();
    now += seconds * 1000;
    for (const x of c) await x.next('energy');
  };
  /** Full, as the one who is alone in the dark hears it. */
  const full = async (c: Client) => {
    now += UNEASE_BUILD_S * 1000;
    expect(await c.next('unease')).toEqual({ t: 'unease', level: UNEASE_LEVELS });
  };

  it('builds alone in the dark in about 3 minutes, a level at a time and told only as it changes, in tall grass as anywhere', async () => {
    // Seven tiles apart: each is alone. b crouches in the tall grass.
    const a = await enter(deep(4, 5)), b = await enter(deep(4, 12));
    for (let level = 1; level <= UNEASE_LEVELS; level++) {
      now += (UNEASE_BUILD_S / UNEASE_LEVELS) * 1000;
      for (const p of [a, b]) expect(await p.c.next('unease')).toEqual({ t: 'unease', level });
    }
    // Full, it stays so, and nothing more is said of it.
    await pass(60, a.c, b.c);
    for (const p of [a, b]) expect(uneases(await p.c.settle())).toEqual([]);
  });

  it('falls fastest with someone within 4 tiles, and whoever keeps company never grows uneasy', async () => {
    const a = await enter(deep(4, 5));
    await full(a.c);
    const b = await enter(deep(4, 8));
    now += UNEASE_COMPANY_S * 1000;
    expect(await a.c.next('unease')).toEqual({ t: 'unease', level: 0 });
    expect(uneases(await b.c.settle())).toEqual([]);
    // Half the time it takes alone, together: nothing (and a's bar lasts it).
    await pass(UNEASE_BUILD_S / 2, a.c, b.c);
    expect(uneases([...await a.c.settle(), ...await b.c.settle()])).toEqual([]);
  });

  it('falls under a street light', async () => {
    // Just below the lamp's light.
    const a = await enter(deep(1, 4));
    await full(a.c);
    a.c.send({ t: 'step', dir: 'up', seq: 1 });
    await a.c.next('step', m => m.seq === 1);
    now += UNEASE_CALM_S * 1000;
    expect(await a.c.next('unease')).toEqual({ t: 'unease', level: 0 });
  });

  it('falls by a burning fire', async () => {
    // One step from the fire's warmth.
    const a = await enter(deep(5, 2, { dir: 'right' }));
    await full(a.c);
    a.c.send({ t: 'step', dir: 'right', seq: 1 });
    await a.c.next('step', m => m.seq === 1);
    now += UNEASE_CALM_S * 1000;
    expect(await a.c.next('unease')).toEqual({ t: 'unease', level: 0 });
  });

  it('falls near a flare', async () => {
    const a = await enter(deep(4, 5, { bag: [{ item: 'flare', count: 1 }] }));
    await full(a.c);
    a.c.send({ t: 'use', slot: 0 });
    await a.c.next('did');
    now += UNEASE_CALM_S * 1000;
    expect(await a.c.next('unease')).toEqual({ t: 'unease', level: 0 });
  });

  it('full, makes a hitchhiker find you twice as often: what takes others 110 seconds takes you 55', async () => {
    // With these dice something clings to you in a stretch whose chance of it is over one in two: at the
    // usual rate that is a stretch of 104 seconds or more (1 - e^(-t/150)), full of unease one of 52.
    roll = 0.5;
    // a alone, deep in; b and c keep each other company, as deep in and out of the light too.
    const a = await enter(deep(7, 4)), b = await enter(deep(1, 8)), c = await enter(deep(1, 7));
    now += 90_000;
    expect(await a.c.next('unease')).toEqual({ t: 'unease', level: 2 });
    now += 90_000;
    expect(await a.c.next('unease')).toEqual({ t: 'unease', level: UNEASE_LEVELS });
    // Keeping each other company, b and c never grew uneasy.
    expect(uneases([...await b.c.settle(), ...await c.c.settle()])).toEqual([]);
    await pass(55, a.c, b.c, c.c);
    const heard = [await a.c.settle(), await b.c.settle(), await c.c.settle()].map(msgs => msgs.filter(m => m.t === 'hitch'));
    expect(heard).toEqual([[{ t: 'hitch', on: true }], [], []]);
    // a goes home before it wears them out; the others need twice as long for the same.
    a.c.ws.terminate();
    await waitFor(() => !ctx.server.world.has(a.id), 'a to leave');
    await pass(110, b.c, c.c);
    for (const p of [b, c]) expect((await p.c.settle()).filter(m => m.t === 'hitch')).toEqual([{ t: 'hitch', on: true }]);
  });
});
