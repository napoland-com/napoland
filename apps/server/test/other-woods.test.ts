/**
 * The Other Woods on the server (roadmap/the-other-woods.md): a sky that never moves. Whatever the weather over the
 * rest of the world, it is always the night of the answer there, an aurora night: heard on arrival, worn down by,
 * and gone again the step you are back in the ranger's camp.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { energyRate, type ServerMsg } from '@napoland/shared';
import { loadItems, loadMaps, loadStory } from '../src/content';
import { setup } from './helpers';

describe('the Other Woods, under a sky that never moves', () => {
  const content = resolve(import.meta.dirname, '../../../content');
  const { maps } = loadMaps(resolve(content, 'maps'), 'stonebrook');
  const { items } = loadItems(resolve(content, 'items.json'), maps.values());
  const story = loadStory(resolve(content, 'story.json'), maps.values(), items);
  let now = 1_000_000;
  const { enter } = setup({ maps: [...maps.values()], items, story, homeMap: 'stonebrook', weather: 'overcast', rng: () => 0, clock: () => now });
  const other = maps.get('other-woods')!, camp = maps.get('turning-camp')!;
  const home = other.data.exits.find(e => e.home)!, on = camp.data.exits.find(e => e.to === 'other-woods')!;
  const zone = async (c: { settle: () => Promise<ServerMsg[]> }) => (await c.settle()).find((m): m is Extract<ServerMsg, { t: 'zone' }> => m.t === 'zone');

  it('is always the night of the answer there, whatever the sky over the rest of the world, and you tire as at night', async () => {
    now += 60_000;
    const a = await enter({ map: 'other-woods', x: home.x - 1, y: home.y, dir: 'right' });
    expect(a.welcome.weather).toBe('aurora');
    expect(a.welcome.energy.rate).toBeCloseTo(energyRate(other, home.x - 1, home.y, 'aurora'), 3);
    expect(a.welcome.energy.rate).toBeLessThan(energyRate(other, home.x - 1, home.y, 'overcast'));
  });

  it('gives the world\'s sky back the step you are home in the camp, and the green one again the step you go on', async () => {
    now += 60_000;
    const a = await enter({ map: 'other-woods', x: home.x - 1, y: home.y, dir: 'right' });
    a.c.send({ t: 'step', dir: 'right', seq: 1 });
    expect(await zone(a.c)).toMatchObject({ map: { id: 'turning-camp' }, weather: 'overcast', x: home.tx, y: home.ty });
    now += 1000;
    a.c.send({ t: 'step', dir: 'left', seq: 2 });
    expect(await zone(a.c)).toMatchObject({ map: { id: 'other-woods' }, weather: 'aurora', x: on.tx, y: on.ty });
  });
});
