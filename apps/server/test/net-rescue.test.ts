/**
 * A window to be saved (roadmap/rescue-window.md), over real WebSockets: at zero energy out in the wilds
 * a player slumps where they stand for 90 seconds (180 with a flare burning by them) before they collapse;
 * everyone on the map hears once, in local chat, where they are down, by landmark; anyone next to them
 * with more than 20 energy gives them 20 and they get up, thanking them for it; nobody comes, and they
 * collapse as ever.
 *
 * The fixture woods (fixtures.ts), overcast, with a place people call by name (the old oak, at 6,1) and a
 * game clock that only moves when a test moves it (the wall clock follows it). The player going down
 * stands at 5,5, four steps from the oak.
 */
import { describe, expect, it } from 'vitest';
import { ENERGY_MAX, RESCUE_ENERGY, SLUMP_FLARE_S, SLUMP_S, TileMap, type ItemsData, type MapData, type ServerMsg } from '@napoland/shared';
import { houseData, itemsData, townData, woodsData } from './fixtures';
import { setup, waitFor, type Client } from './helpers';

/** A long surge that is on right now, whenever the test runs: every tile of the woods is in it (the front swept long ago). */
function surgeNow(): NonNullable<MapData['surge']> {
  const every = 100_000, unstable = 10, surge = 90_000, calm = every - unstable - surge;
  return { every, unstable, surge, sweep: 10, offset: calm + unstable + 20_000 - ((Date.now() / 1000) % every) };
}
const woods = (): MapData => ({ ...woodsData(), places: [{ name: 'the old oak', x: 6, y: 1 }] });
const surging = (): MapData => ({ ...woods(), id: 'surging', name: 'Surging woods', surge: surgeNow(), exits: [{ x: 3, y: 7, w: 2, h: 1, to: 'town', tx: 4, ty: 1, dir: 'down', home: true }] });
const items = (): ItemsData => ({
  ...itemsData(),
  items: [...itemsData().items, { id: 'flare', name: 'Road flare', kind: 'consumable', stack: 3, text: 'Red light.', use: { flare: 45 } }],
});
const of = <T extends ServerMsg['t']>(msgs: ServerMsg[], t: T) => msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);

describe('a window to be saved', () => {
  let now = 1_000_000;
  const maps = [new TileMap(townData()), new TileMap(houseData()), new TileMap(woods()), new TileMap(surging())];
  const { ctx, enter } = setup({ maps, items: items(), weather: 'overcast', clock: () => now });
  const world = () => ctx.server.world;
  /** Moves the game clock on, and lets the server tick on it. */
  async function wait(ms: number) {
    now += ms;
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  /** A player who goes down at 5,5: 1 energy lasts about 4 s there. */
  async function faller(more: Parameters<typeof enter>[0] = {}) {
    const a = await enter({ map: 'woods', x: 5, y: 5, dir: 'down', energy: 1, ...more });
    await wait(5000);
    await a.c.next('slump');
    return a;
  }
  const drained = (c: Client) => c.next('energy', m => m.energy.value === 0);

  it('slumps where they stand, tells them how long, and tells the map once where they are down, by landmark', async () => {
    const near = await enter({ map: 'woods', x: 1, y: 1 });
    const town = await enter({ map: 'town', x: 1, y: 5 });
    const a = await enter({ map: 'woods', x: 5, y: 5, energy: 1, bag: [{ item: 'nail', count: 2 }] });
    await Promise.all([near.c.settle(), town.c.settle()]);
    await wait(5000);
    expect(await a.c.next('slump')).toEqual({ t: 'slump', left: SLUMP_S });
    expect((await drained(a.c)).energy).toMatchObject({ value: 0, rate: 0 });
    const line = { t: 'slumped', id: a.id, name: a.welcome.name, where: 'by the old oak' };
    expect(await a.c.next('slumped')).toEqual(line);
    expect(await near.c.next('down')).toEqual({ t: 'down', id: a.id, on: true });
    expect(await near.c.next('slumped')).toEqual(line);
    // Never by position: the line says where in words, and only once.
    await wait(1000);
    expect(of(await near.c.settle(), 'slumped')).toEqual([]);
    // Another map hears nothing of it.
    expect(of(await town.c.settle(), 'slumped')).toEqual([]);
    // Whoever comes by later sees them lying there.
    const later = await enter({ map: 'woods', x: 2, y: 5 });
    expect(later.welcome.players.find(p => p.id === a.id)).toMatchObject({ down: true, x: 5, y: 5 });
    // They cannot walk or act: steps are refused, and so is anything else.
    a.c.send({ t: 'step', dir: 'left', seq: 1 });
    expect(await a.c.next('reject')).toEqual({ t: 'reject', seq: 1, x: 5, y: 5, dir: expect.any(String) });
    a.c.send({ t: 'discard', slot: 0 });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'discard', reason: 'down' });
    expect(world().get(a.id)).toMatchObject({ map: 'woods', x: 5, y: 5, energy: 0, bag: [{ item: 'nail', count: 2 }] });
  });

  it('collapses as ever after 90 seconds when nobody comes: the pile, and waking up at home', async () => {
    const a = await faller({ bag: [{ item: 'nail', count: 2 }] });
    const near = await enter({ map: 'woods', x: 1, y: 1 });
    await wait((SLUMP_S - 2) * 1000);
    expect(world().get(a.id)).toMatchObject({ map: 'woods', energy: 0 });
    await wait(3000);
    expect(await a.c.next('zone')).toMatchObject({ reason: 'collapse', map: { id: 'town' } });
    expect(await near.c.next('leave')).toEqual({ t: 'leave', id: a.id });
    expect((await near.c.next('drop')).drop).toMatchObject({ owner: a.id, x: 5, y: 5 });
    expect(world().get(a.id)).toMatchObject({ energy: ENERGY_MAX, bag: [] });
  });

  it('gives them 180 seconds with a flare burning by them', async () => {
    const a = await faller();
    const b = await enter({ map: 'woods', x: 5, y: 6, energy: ENERGY_MAX, bag: [{ item: 'flare', count: 1 }] });
    await wait(10_000);
    b.c.send({ t: 'use', slot: 0 });
    await b.c.next('did');
    await wait(100);
    // Told as soon as it burns: 180 seconds from when they went down, 10.1 of them gone.
    const longer = await a.c.next('slump', m => m.left > SLUMP_S);
    expect(longer.left).toBeCloseTo(SLUMP_FLARE_S - 10.1, 0);
    // Past the 90 seconds they are still down, and they go only when the longer window is over.
    await wait(SLUMP_S * 1000);
    expect(world().get(a.id)).toMatchObject({ map: 'woods', energy: 0 });
    await wait((SLUMP_FLARE_S - SLUMP_S) * 1000);
    expect(await a.c.next('zone')).toMatchObject({ reason: 'collapse' });
  });

  it('takes 20 from whoever gets them up, who needs more than that, and they get up with those 20 and thank them', async () => {
    const a = await faller();
    const tired = await enter({ map: 'woods', x: 4, y: 5, dir: 'right', energy: RESCUE_ENERGY });
    const far = await enter({ map: 'woods', x: 3, y: 5, dir: 'right', energy: 60 });
    const b = await enter({ map: 'woods', x: 5, y: 6, dir: 'up', energy: 50 });
    // Exactly 20 is not enough: it takes more than you give.
    tired.c.send({ t: 'rescue', who: a.id });
    expect(await tired.c.next('refused')).toEqual({ t: 'refused', action: 'rescue', reason: 'too_tired' });
    far.c.send({ t: 'rescue', who: a.id });
    expect(await far.c.next('refused')).toEqual({ t: 'refused', action: 'rescue', reason: 'too_far' });
    // Nobody to get up who is not down.
    b.c.send({ t: 'rescue', who: far.id });
    expect(await b.c.next('refused')).toEqual({ t: 'refused', action: 'rescue', reason: 'gone' });

    b.c.send({ t: 'rescue', who: a.id });
    expect(await b.c.next('did')).toEqual({ t: 'did', did: { kind: 'rescued', who: a.id, name: a.welcome.name } });
    expect(await a.c.next('raised')).toEqual({ t: 'raised', by: { id: b.id, name: b.welcome.name }, thanked: true });
    expect((await a.c.next('energy', m => m.energy.value > 0)).energy.value).toBe(RESCUE_ENERGY);
    expect(await far.c.next('down', m => !m.on)).toEqual({ t: 'down', id: a.id, on: false });
    // The rescuer gave 20, and the thanks warms them by 3 out here.
    expect(await b.c.next('thanked')).toEqual({ t: 'thanked', name: a.welcome.name, what: { kind: 'rescue', map: 'woods', x: 5, y: 5, who: a.id }, energy: 3 });
    expect(world().get(b.id)!.energy).toBe(50 - RESCUE_ENERGY + 3);
    expect(world().get(b.id)!.stats).toEqual({ thanked: 1 });
    await waitFor(() => ctx.storage.storedThanks().some(t => t.giver === a.id && t.helper === b.id), 'the thanks to be stored');
    expect(ctx.storage.storedThanks().find(t => t.giver === a.id)).toMatchObject({ helper: b.id, what: { kind: 'rescue', map: 'woods', x: 5, y: 5, who: a.id }, told: false });
    // Up again: nobody sees them lie there any more, there is nothing more to get them up from, and they walk.
    expect(world().views('woods').find(p => p.id === a.id)?.down).toBeUndefined();
    b.c.send({ t: 'rescue', who: a.id });
    expect(await b.c.next('refused')).toEqual({ t: 'refused', action: 'rescue', reason: 'gone' });
    a.c.send({ t: 'step', dir: 'left', seq: 1 });
    expect(await a.c.next('step', m => m.seq === 1)).toMatchObject({ x: 4, y: 5 });
  });

  it('thanks the same rescuer only once a UTC day', async () => {
    const a = await faller();
    const b = await enter({ map: 'woods', x: 5, y: 6, dir: 'up', energy: 90 });
    b.c.send({ t: 'rescue', who: a.id });
    expect(await a.c.next('raised')).toMatchObject({ thanked: true });
    // Down again (20 energy lasts about 80 seconds there): the second time the same day, the help is the
    // same and the thanks does not come twice.
    await wait(85_000);
    expect(await a.c.next('slump')).toMatchObject({ left: SLUMP_S });
    b.c.send({ t: 'rescue', who: a.id });
    expect(await a.c.next('raised')).toEqual({ t: 'raised', by: { id: b.id, name: b.welcome.name } });
    expect(world().get(b.id)!.stats).toEqual({ thanked: 1 });
  });

  it('drains nothing further while they are down, in a surge too, and leaves them alone when they leave: a collapse', async () => {
    const a = await enter({ map: 'surging', x: 5, y: 5, energy: 1, bag: [{ item: 'nail', count: 1 }] });
    const other = await enter({ map: 'surging', x: 1, y: 1, energy: 90 });
    await wait(2000);
    await a.c.next('slump');
    expect((await drained(a.c)).energy.rate).toBe(0);
    await wait(30_000);
    expect(world().get(a.id)!.energy).toBe(0);
    // Everyone else in the surge drains all the while.
    expect(world().get(other.id)!.energy).toBeLessThan(90);
    a.c.ws.terminate();
    await waitFor(() => !world().has(a.id), 'the player to leave');
    expect((await other.c.next('drop')).drop).toMatchObject({ owner: a.id, x: 5, y: 5 });
    // Saved at home (the fixture town's spawn), rested, with nothing carried.
    await waitFor(() => ctx.storage.get(a.id)?.map === 'town', 'the collapse to be saved');
    expect(ctx.storage.get(a.id)).toMatchObject({ energy: ENERGY_MAX, bag: [] });
  });
});

/** Ferns along the top row of a small glade, and a skulker in them at night (as in net-creatures.test.ts). */
function gladeData(): MapData {
  return {
    id: 'glade', name: 'Glade', version: 1, kind: 'wilds', depth: 1, width: 5, height: 6,
    tiles: ['ttttt', 'tffft', 'tgggt', 'tgggt', 'tgggt', 'ttgtt'],
    levels: Array<string>(6).fill('00000'),
    spawn: { x: 2, y: 4, dir: 'up' },
    exits: [{ x: 2, y: 5, w: 1, h: 1, to: 'town', tx: 4, ty: 1, dir: 'down', home: true }],
    objects: [],
    skulkers: { count: 1, steps: [3, 99], when: ['night'] },
  };
}

describe('a creature and someone down', () => {
  const maps = [new TileMap(townData()), new TileMap(houseData()), new TileMap(woodsData()), new TileMap(gladeData())];
  const { ctx, enter } = setup({ weather: 'night', maps, items: itemsData() });

  it('does not touch a slumped player: it goes after whoever still stands', async () => {
    await waitFor(() => ctx.server.world.scene('glade', 0).creatures.length > 0, 'the skulker to wake');
    // Right below the ferns, out of energy: close enough to be seen, were they standing.
    const a = await enter({ map: 'glade', x: 2, y: 2, energy: 0.001, bag: [{ item: 'nail', count: 3 }] });
    await a.c.next('slump');
    await new Promise(resolve => setTimeout(resolve, 1500));
    const heard = await a.c.settle();
    expect(heard.filter(m => m.t === 'creature' && m.creature.chasing === a.id)).toEqual([]);
    expect(of(heard, 'touched')).toEqual([]);
    // Someone standing there, within three tiles of every fern, is another matter.
    const b = await enter({ map: 'glade', x: 2, y: 3 });
    expect(await b.c.next('creature', m => m.creature.chasing === b.id)).toMatchObject({ creature: { kind: 'skulker' } });
    expect(ctx.server.world.get(a.id)).toMatchObject({ map: 'glade', energy: 0, bag: [{ item: 'nail', count: 3 }] });
  });
});
