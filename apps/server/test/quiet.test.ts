/**
 * The Quiet on the server (roadmap/the-quiet.md): the trappers' last rope above the Ridge's crest holds only with
 * four on it and takes all four up; up there words do not carry, said or heard, while calls and walking still do;
 * and the way down holds for anyone.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GATE_WINDOW_MS, type MapObject, type ServerMsg } from '@napoland/shared';
import { loadItems, loadMaps, loadNotebook, loadStory } from '../src/content';
import { setup } from './helpers';

describe('the Quiet, up the last rope', () => {
  const content = resolve(import.meta.dirname, '../../../content');
  const { maps } = loadMaps(resolve(content, 'maps'), 'stonebrook');
  const { items } = loadItems(resolve(content, 'items.json'), maps.values());
  const story = loadStory(resolve(content, 'story.json'), maps.values(), items);
  const notebook = loadNotebook(resolve(content, 'notebook.json'), maps.values(), items);
  let now = 1_000_000;
  const { enter } = setup({ maps: [...maps.values()], items, story, homeMap: 'stonebrook', weather: 'overcast', rng: () => 0, clock: () => now, notebook });
  const ridge = maps.get('ridge')!, quiet = maps.get('quiet')!;
  const rope = ridge.data.objects.find((o): o is Extract<MapObject, { kind: 'gate' }> => o.kind === 'gate' && o.to === 'quiet')!;
  /** Someone signed in under the rope's tile `k`, facing it. */
  const under = (k: number) => enter({ map: 'ridge', x: rope.x + k, y: rope.y + 1, dir: 'up', authSub: `dev:climber${k}-${now}@example.test` });
  const zones = async (c: { settle: () => Promise<ServerMsg[]> }) => (await c.settle()).filter(m => m.t === 'zone');

  it('will not hold three: three on it, nobody goes anywhere', async () => {
    now += 60_000;
    const three = [await under(0), await under(1), await under(2)];
    for (const [k, p] of three.entries()) p.c.send({ t: 'talk', x: rope.x + k, y: rope.y });
    for (const p of three) expect(await zones(p.c)).toEqual([]);
  });

  it('holds four taking it together, and takes all four up into the Quiet, side by side', async () => {
    now += 60_000;
    const four = [await under(0), await under(1), await under(2), await under(3)];
    for (const [k, p] of four.slice(0, 3).entries()) {
      p.c.send({ t: 'talk', x: rope.x + k, y: rope.y });
      await p.c.settle();
      now += (GATE_WINDOW_MS - 1000) / 3;
    }
    four[3]!.c.send({ t: 'talk', x: rope.x + 3, y: rope.y });
    const got = await Promise.all(four.map(p => p.c.next('zone')));
    expect(got.map(z => [z.map.id, z.x, z.y])).toEqual([0, 1, 2, 3].map(k => ['quiet', rope.tx + k, rope.ty]));
  });

  it('keeps words from carrying up there, either way: nothing said there is said, nothing said elsewhere is heard there', async () => {
    now += 60_000;
    const up = await enter({ map: 'quiet', x: quiet.data.spawn.x, y: quiet.data.spawn.y, authSub: `dev:up-${now}@example.test` });
    const town = await enter({ authSub: `dev:town-${now}@example.test` });
    up.c.send({ t: 'say', to: 'world', text: 'hello?' });
    expect(await up.c.next('refused')).toEqual({ t: 'refused', action: 'say', reason: 'hushed' });
    town.c.send({ t: 'say', to: 'world', text: 'anyone?' });
    expect((await town.c.next('said')).text).toBe('anyone?');
    await up.c.settle();
    expect(up.c.inbox.filter(m => m.t === 'said')).toEqual([]);
  });

  it('opens a page of the field notes for what is read up there: the gap, read from beside it', async () => {
    now += 60_000;
    const gap = quiet.data.objects.find((o): o is Extract<MapObject, { kind: 'standing' }> => o.kind === 'standing' && !!o.gap)!;
    const a = await enter({ map: 'quiet', x: gap.x, y: gap.y + 1, dir: 'up' });
    a.c.send({ t: 'talk', x: gap.x, y: gap.y });
    expect(await a.c.next('page')).toEqual({ t: 'page', id: 'the-gap' });
  });

  it('opens one for the Turning\'s notches too, read from the trail', async () => {
    now += 60_000;
    const a = await enter({ map: 'turning-2', x: 20, y: 13, dir: 'up' });
    a.c.send({ t: 'talk', x: 20, y: 12 });
    expect(await a.c.next('page')).toEqual({ t: 'page', id: 'two-notches' });
  });

  it('holds for anyone coming down: the Quiet\'s way home comes out under the rope', async () => {
    now += 60_000;
    const home = quiet.data.exits.find(e => e.home)!;
    const a = await enter({ map: 'quiet', x: home.x + 1, y: home.y - 1, dir: 'down' });
    a.c.send({ t: 'step', dir: 'down', seq: 1 });
    expect((await zones(a.c)).map(z => [z.map.id, z.x, z.y])).toEqual([['ridge', rope.x + 1, rope.y + 1]]);
  });
});
