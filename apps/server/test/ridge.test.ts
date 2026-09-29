/**
 * The Ridge (roadmap/the-ridge.md), over real WebSockets with the content as it ships: the trappers' fixed rope
 * north of the Burn's scar, which holds only with three on it and then takes all three up; the way home, which
 * needs nobody; the icefall, climbed only in crampons; the footprints its snow keeps for the next hour; and its
 * cold, always winter's.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GATE_WINDOW_MS, PRINTS_KEPT_MS, SEASONS, energyRate, quarterOf, seasonAt, type MapObject, type Season, type ServerMsg } from '@napoland/shared';
import { loadItems, loadMaps, loadStory } from '../src/content';
import { setup } from './helpers';

const content = resolve(import.meta.dirname, '../../../content');

describe('the Ridge, up the trappers\' rope', () => {
  const { maps } = loadMaps(resolve(content, 'maps'), 'stonebrook');
  const { items } = loadItems(resolve(content, 'items.json'), maps.values());
  const story = loadStory(resolve(content, 'story.json'), maps.values(), items);
  let now = 1_000_000;
  const { enter } = setup({ maps: [...maps.values()], items, story, homeMap: 'stonebrook', weather: 'overcast', rng: () => 0, clock: () => now });
  const burn = maps.get('burn')!, ridge = maps.get('ridge')!;
  const rope = burn.data.objects.find((o): o is Extract<MapObject, { kind: 'gate' }> => o.kind === 'gate')!;
  /** Someone under the rope's tile `k`, facing it. */
  const under = (k: number) => enter({ map: 'burn', x: rope.x + k, y: rope.y + 1, dir: 'up' });
  const zones = async (c: { settle: () => Promise<ServerMsg[]> }) => (await c.settle()).filter(m => m.t === 'zone');

  it('hangs at the head of a cut north of the scar and leads up to the Ridge, deeper', () => {
    expect(rope).toMatchObject({ to: 'ridge', w: 3, pullers: 3, look: 'rope' });
    expect(ridge.data).toMatchObject({ depth: 4, kind: 'wilds', forest: 'snow' });
  });

  it('will not hold two: two on it, nobody goes anywhere', async () => {
    now += 60_000;
    const [a, b] = [await under(0), await under(1)];
    a.c.send({ t: 'talk', x: rope.x, y: rope.y });
    await a.c.settle();
    b.c.send({ t: 'talk', x: rope.x + 1, y: rope.y });
    expect(await zones(a.c)).toEqual([]);
    expect(await zones(b.c)).toEqual([]);
  });

  it('holds three taking it together, and takes all three up onto the Ridge, side by side', async () => {
    now += 60_000;
    const [a, b, c] = [await under(0), await under(1), await under(2)];
    a.c.send({ t: 'talk', x: rope.x, y: rope.y });
    await a.c.settle();
    now += 1000;
    b.c.send({ t: 'talk', x: rope.x + 1, y: rope.y });
    await b.c.settle();
    now += GATE_WINDOW_MS - 1500;
    c.c.send({ t: 'talk', x: rope.x + 2, y: rope.y });
    const got = await Promise.all([a.c.next('zone'), b.c.next('zone'), c.c.next('zone')]);
    expect(got.map(z => [z.map.id, z.x, z.y, z.dir])).toEqual([0, 1, 2].map(k => ['ridge', rope.tx + k, rope.ty, 'up']));
  });

  it('holds for anyone coming down: the Ridge\'s way home comes out under the rope', async () => {
    now += 60_000;
    const home = ridge.data.exits.find(e => e.home)!;
    const a = await enter({ map: 'ridge', x: home.x, y: home.y - 1, dir: 'down' });
    a.c.send({ t: 'step', dir: 'down', seq: 1 });
    const back = await a.c.next('zone');
    expect([back.map.id, back.x, back.y, back.dir]).toEqual(['burn', rope.x, rope.y + 1, 'down']);
  });

  it('lets only whoever owns crampons onto the icefall', async () => {
    now += 60_000;
    // The icefall's foot: the lowest tile of it, and the open ground below.
    let foot = { x: 0, y: 0 };
    for (let y = 0; y < ridge.height; y++) for (let x = 0; x < ridge.width; x++) if (ridge.kind(x, y) === 'icefall' && ridge.kind(x, y + 1) !== 'icefall' && ridge.walkable(x, y + 1)) foot = { x, y };
    const boots = await enter({ map: 'ridge', x: foot.x, y: foot.y + 1, dir: 'up' });
    boots.c.send({ t: 'step', dir: 'up', seq: 1 });
    expect(await boots.c.next('reject')).toMatchObject({ x: foot.x, y: foot.y + 1 });
    const spikes = await enter({ map: 'ridge', x: foot.x, y: foot.y + 1, dir: 'up', tools: ['stonebrook-map', 'radio', 'crampons'] });
    spikes.c.send({ t: 'step', dir: 'up', seq: 1 });
    expect(await spikes.c.next('step')).toMatchObject({ x: foot.x, y: foot.y });
  });

  it('keeps every step in its snow for an hour, for whoever comes after, and never whose', async () => {
    now += 60_000;
    const home = ridge.data.exits.find(e => e.home)!;
    const a = await enter({ map: 'ridge', x: home.x + 1, y: home.y - 1, dir: 'up' });
    a.c.send({ t: 'step', dir: 'up', seq: 1 });
    await a.c.next('step');
    now += 1000;
    a.c.send({ t: 'step', dir: 'up', seq: 2 });
    await a.c.next('step');
    now += 10_000;
    const b = await enter({ map: 'ridge', x: home.x, y: home.y - 1, dir: 'up' });
    const prints = b.welcome.prints!.slice(-2);
    expect(prints).toEqual([
      { x: home.x + 1, y: home.y - 2, dir: 'up', age: 11 },
      { x: home.x + 1, y: home.y - 3, dir: 'up', age: 10 },
    ]);
    // An hour on, they have filled in.
    now += PRINTS_KEPT_MS;
    const c = await enter({ map: 'ridge', x: home.x + 2, y: home.y - 1, dir: 'up' });
    expect(c.welcome.prints).toEqual([]);
    // Nowhere but in the snow.
    const d = await enter({ map: 'burn', x: 27, y: 70, dir: 'up' });
    expect(d.welcome.prints).toBeUndefined();
  });

  it('is always as cold as winter, whatever the season: you tire faster there than at the same distance and depth anywhere else', async () => {
    now += 60_000;
    const home = ridge.data.exits.find(e => e.home)!;
    const a = await enter({ map: 'ridge', x: home.x, y: home.y - 1, dir: 'up' });
    expect(seasonAt(now)).not.toBe('winter');
    const chill = (s: Season) => ({ chill: { weather: SEASONS[s].chill, wet: SEASONS[s].wet } });
    expect(a.welcome.energy.rate).toBeCloseTo(energyRate(ridge, home.x, home.y - 1, 'overcast', chill('winter')), 2);
    expect(a.welcome.energy.rate).toBeLessThan(energyRate(ridge, home.x, home.y - 1, 'overcast', chill(seasonAt(now))));
  });

  it('has its map torn in four across it, a piece in each quarter', async () => {
    const home = ridge.data.exits.find(e => e.home)!;
    const a = await enter({ map: 'ridge', x: home.x, y: home.y - 1 });
    const pieces = a.welcome.finds.filter(f => f.item === 'ridge-map');
    expect(pieces.map(f => f.piece).sort()).toEqual([0, 1, 2, 3]);
    for (const f of pieces) expect(quarterOf(f.x, f.y, ridge.width, ridge.height)).toBe(f.piece);
  });
});
