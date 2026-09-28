/**
 * The Burn (roadmap/deeper-regions.md), over real WebSockets with the content as it ships: NAPO's gate north
 * of the Far Woods' hollow, which moves only when two pull at it together and then takes them both through;
 * the way home, which needs nobody; and the Burn's map, found in the line cabin.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GATE_WINDOW_MS, type MapObject, type ServerMsg } from '@napoland/shared';
import { loadItems, loadMaps, loadStory } from '../src/content';
import { setup } from './helpers';

const content = resolve(import.meta.dirname, '../../../content');

describe('the Burn, through NAPO\'s gate', () => {
  const { maps } = loadMaps(resolve(content, 'maps'), 'stonebrook');
  const { items } = loadItems(resolve(content, 'items.json'), maps.values());
  const story = loadStory(resolve(content, 'story.json'), maps.values(), items);
  let now = 1_000_000;
  const { enter } = setup({ maps: [...maps.values()], items, story, homeMap: 'stonebrook', weather: 'overcast', rng: () => 0, clock: () => now });
  const far = maps.get('far-woods')!, burn = maps.get('burn')!;
  const gate = far.data.objects.find((o): o is Extract<MapObject, { kind: 'gate' }> => o.kind === 'gate')!;
  /** Two players under the gate, one below each of its tiles, facing it. */
  const pair = async () => [await enter({ map: 'far-woods', x: gate.x, y: gate.y + 1, dir: 'up' }), await enter({ map: 'far-woods', x: gate.x + 1, y: gate.y + 1, dir: 'up' })];
  const zones = async (c: { settle: () => Promise<ServerMsg[]> }) => (await c.settle()).filter(m => m.t === 'zone');

  it('stands in the Far Woods and leads to the Burn, deeper', () => {
    expect(gate).toMatchObject({ to: 'burn', w: 2 });
    expect(burn.data).toMatchObject({ depth: 3, kind: 'wilds' });
    expect(far.walkable(gate.x, gate.y)).toBe(false);
  });

  it('will not move for one: pulled alone, nobody goes anywhere', async () => {
    now += 60_000;
    const a = await enter({ map: 'far-woods', x: gate.x, y: gate.y + 1, dir: 'up' });
    a.c.send({ t: 'talk', x: gate.x, y: gate.y });
    expect(await zones(a.c)).toEqual([]);
    // Pulling again alone is still one.
    now += 1000;
    a.c.send({ t: 'talk', x: gate.x + 1, y: gate.y });
    expect(await zones(a.c)).toEqual([]);
  });

  it('opens for two pulling together and takes them both through, side by side', async () => {
    now += 60_000;
    const [a, b] = await pair();
    a!.c.send({ t: 'talk', x: gate.x, y: gate.y });
    await a!.c.settle();
    now += GATE_WINDOW_MS - 500;
    b!.c.send({ t: 'talk', x: gate.x + 1, y: gate.y });
    const [za, zb] = await Promise.all([a!.c.next('zone'), b!.c.next('zone')]);
    expect([za.map.id, za.x, za.y, za.dir]).toEqual(['burn', gate.tx, gate.ty, 'up']);
    expect([zb.map.id, zb.x, zb.y, zb.dir]).toEqual(['burn', gate.tx + 1, gate.ty, 'up']);
  });

  it('counts pulls only close together, and only from under it', async () => {
    now += 60_000;
    const [a, b] = await pair();
    a!.c.send({ t: 'talk', x: gate.x, y: gate.y });
    await a!.c.settle();
    now += GATE_WINDOW_MS + 500;
    b!.c.send({ t: 'talk', x: gate.x + 1, y: gate.y });
    expect(await zones(a!.c)).toEqual([]);
    expect(await zones(b!.c)).toEqual([]);
    // One who stepped back from it no longer pulls, even at once.
    now += GATE_WINDOW_MS + 500;
    a!.c.send({ t: 'step', dir: 'down', seq: 1 });
    await a!.c.next('step');
    now += 1000;
    a!.c.send({ t: 'talk', x: gate.x, y: gate.y });
    b!.c.send({ t: 'talk', x: gate.x + 1, y: gate.y });
    expect(await zones(a!.c)).toEqual([]);
    expect(await zones(b!.c)).toEqual([]);
  });

  it('opens from the far side for anyone: the Burn\'s way home comes out under it', async () => {
    now += 60_000;
    const home = burn.data.exits.find(e => e.home)!;
    const a = await enter({ map: 'burn', x: home.x, y: home.y - 1, dir: 'down' });
    a.c.send({ t: 'step', dir: 'down', seq: 1 });
    const back = await a.c.next('zone');
    expect([back.map.id, back.x, back.y, back.dir]).toEqual(['far-woods', gate.x, gate.y + 1, 'down']);
  });

  it('keeps its map in the line cabin, for whoever has none', async () => {
    const a = await enter({ map: 'burn-line-cabin', x: 3, y: 4 });
    expect(a.welcome.finds.map(f => f.item)).toContain('burn-map');
  });
});
