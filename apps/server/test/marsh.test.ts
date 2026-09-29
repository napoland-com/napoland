/**
 * The Marsh (roadmap/the-marsh.md), over real WebSockets with the content as it ships: in along the corduroy road
 * off the Far Woods' east edge and back out, the west boardwalk that is water until everyone has brought the scrap
 * it takes, and the Marsh's map, found in the cutters' hut.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STEP_MS, quarterOf, type MapObject } from '@napoland/shared';
import { loadItems, loadMaps, loadStory } from '../src/content';
import { setup } from './helpers';

const content = resolve(import.meta.dirname, '../../../content');

describe('the Marsh, along the corduroy road', () => {
  const { maps } = loadMaps(resolve(content, 'maps'), 'stonebrook');
  const { items } = loadItems(resolve(content, 'items.json'), maps.values());
  const story = loadStory(resolve(content, 'story.json'), maps.values(), items);
  let now = 1_000_000;
  const { enter } = setup({ maps: [...maps.values()], items, story, homeMap: 'stonebrook', weather: 'overcast', rng: () => 0, clock: () => now });
  const far = maps.get('far-woods')!, marsh = maps.get('marsh')!;
  const road = far.data.exits.find(e => e.to === 'marsh')!;
  const west = marsh.data.objects.find((o): o is Extract<MapObject, { kind: 'footbridge' }> => o.kind === 'footbridge' && o.id === 'marsh-boardwalk-west')!;

  it('goes in off the Far Woods\' east edge, and the way home goes back out onto the road', async () => {
    now += 60_000;
    const a = await enter({ map: 'far-woods', x: road.x - 1, y: road.y, dir: 'right' });
    a.c.send({ t: 'step', dir: 'right', seq: 1 });
    const inside = await a.c.next('zone');
    expect([inside.map.id, inside.x, inside.y, inside.dir]).toEqual(['marsh', road.tx, road.ty, 'right']);
    now += STEP_MS;
    a.c.send({ t: 'step', dir: 'left', seq: 2 });
    const back = await a.c.next('zone');
    expect([back.map.id, back.x, back.y, back.dir]).toEqual(['far-woods', road.x - 1, road.y, 'left']);
  });

  it('keeps the west boardwalk water until the scrap it takes is brought, and then it is walked', async () => {
    now += 60_000;
    const need = items.works!.find(w => w.id === west.id)!.need;
    const a = await enter({ map: 'marsh', x: west.x - 1, y: west.y, dir: 'right', bag: [{ item: 'scrap', count: need }] });
    a.c.send({ t: 'step', dir: 'right', seq: 1 });
    expect(await a.c.next('reject')).toMatchObject({ x: west.x - 1, y: west.y });
    a.c.send({ t: 'bring', x: west.x, y: west.y, slot: 0, count: need });
    expect((await a.c.next('did')).did).toMatchObject({ kind: 'brought', works: west.id, item: 'scrap', count: need, built: true });
    now += STEP_MS;
    a.c.send({ t: 'step', dir: 'right', seq: 2 });
    expect(await a.c.next('step', m => m.seq === 2)).toMatchObject({ x: west.x, y: west.y });
  });

  it('has its map torn in four across it, a piece in each quarter', async () => {
    const home = marsh.data.exits.find(e => e.home)!;
    const a = await enter({ map: 'marsh', x: home.x + 1, y: home.y });
    const pieces = a.welcome.finds.filter(f => f.item === 'marsh-map');
    expect(pieces.map(f => f.piece).sort()).toEqual([0, 1, 2, 3]);
    for (const f of pieces) expect(quarterOf(f.x, f.y, marsh.width, marsh.height)).toBe(f.piece);
  });
});
