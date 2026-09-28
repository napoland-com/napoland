/**
 * Creatures over real WebSockets: a skulker in a small fern glade, at night. The rules themselves are
 * tested on the World (survival.test.ts); here, what a client hears of them.
 */
import { describe, expect, it } from 'vitest';
import { ENERGY_MAX, TileMap, type MapData } from '@napoland/shared';
import { SKULKER_CATCH } from '../src/world';
import { houseData, itemsData, townData, woodsData } from './fixtures';
import { setup, waitFor } from './helpers';

/** Ferns along the top row (4 to 5 steps from home), grass below, the way home at 2,5. */
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

/** The same glade with tall grass on two of the three tiles below the ferns: 1,2 and 2,2. */
function tallGladeData(): MapData {
  return { ...gladeData(), id: 'tall-glade', name: 'Tall glade', tiles: ['ttttt', 'tffft', 'thhgt', 'tgggt', 'tgggt', 'ttgtt'] };
}

describe('skulkers', () => {
  const maps = [new TileMap(townData()), new TileMap(houseData()), new TileMap(woodsData()), new TileMap(gladeData()), new TileMap(tallGladeData())];
  const { ctx, enter } = setup({ weather: 'night', maps, items: itemsData() });

  it('are in the welcome, chase whoever stands near, and make them drop a bag slot as their pile', async () => {
    // It wakes where nobody is near, on the first tick.
    await waitFor(() => ctx.server.world.scene('glade', 0).creatures.length > 0, 'the skulker to wake');
    // Two steps below the ferns: close enough to be seen standing still.
    const a = await enter({ map: 'glade', x: 2, y: 3, bag: [{ item: 'nail', count: 3 }] });
    const [skulker] = a.welcome.creatures;
    expect(skulker).toMatchObject({ kind: 'skulker', y: 1 });
    expect(await a.c.next('creature', m => m.creature.chasing === a.id)).toMatchObject({ creature: { id: skulker!.id, kind: 'skulker' } });
    expect(await a.c.next('touched')).toEqual({ t: 'touched', by: 'skulker', lost: 'nail' });
    expect(await a.c.next('drop')).toMatchObject({ drop: { owner: a.id, x: 2, y: 3 } });
    expect(await a.c.next('bag')).toEqual({ t: 'bag', bag: [] });
    expect(await a.c.next('creatureGone')).toEqual({ t: 'creatureGone', id: skulker!.id });
    expect((await a.c.next('energy')).energy.value).toBeLessThanOrEqual(ENERGY_MAX - SKULKER_CATCH);
    // It is theirs to pick up again.
    a.c.send({ t: 'pick', x: 2, y: 3 });
    expect(await a.c.next('got')).toEqual({ t: 'got', items: [{ item: 'nail', count: 3 }], from: 'drop' });
  });

  it('let whoever crouches in tall grass be, and go after them once they step out of it', async () => {
    await waitFor(() => ctx.server.world.scene('tall-glade', 0).creatures.length > 0, 'the skulker to wake');
    // Right below the ferns, in the grass: close enough to be seen, were it not for it.
    const a = await enter({ map: 'tall-glade', x: 2, y: 2 });
    await new Promise(resolve => setTimeout(resolve, 1200));
    expect((await a.c.settle()).filter(m => m.t === 'creature' && m.creature.chasing !== undefined)).toEqual([]);
    // One step down, onto plain grass: it comes, round the grass by 3,2.
    a.c.send({ t: 'step', dir: 'down', seq: 1 });
    expect(await a.c.next('creature', m => m.creature.chasing === a.id)).toMatchObject({ creature: { kind: 'skulker' } });
  });
});
