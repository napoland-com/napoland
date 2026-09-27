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

describe('skulkers', () => {
  const maps = [new TileMap(townData()), new TileMap(houseData()), new TileMap(woodsData()), new TileMap(gladeData())];
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
});
