/**
 * Places you can see but not reach yet (roadmap/locked-places.md): a padlocked door the server opens only
 * for whoever owns bolt cutters, and a flooded culvert it lets only whoever owns waders wade. World rules
 * first, then over real WebSockets with storage in memory.
 *
 *   woods (9x8, depth 1)
 *     012345678
 *   0 ttttttttt
 *   1 tgcccgSSt   c: the culvert, (2,1) to (4,1); S: a shed, (6,1) 2 by 2
 *   2 tgtttgSDt   D: its door (7,2), padlocked (bolt cutters), into the shed's room
 *   3 tgtttgggt
 *   4 tgggggggt
 *   5 tgggggggt
 *   6 tgggggggt
 *   7 tttmmtttt   the way home, to the town
 */
import { describe, expect, it } from 'vitest';
import { TileMap, type Dir, type ItemsData, type MapData } from '@napoland/shared';
import type { PlayerRecord } from '../src/storage';
import { World, colorFor } from '../src/world';
import { houseData, townData } from './fixtures';
import { setup } from './helpers';

function woods(): MapData {
  return {
    id: 'woods', name: 'Woods', version: 1, kind: 'wilds', depth: 1, width: 9, height: 8,
    tiles: ['ttttttttt', 'tgcccgggt', 'tgtttgggt', 'tgtttgggt', 'tgggggggt', 'tgggggggt', 'tgggggggt', 'tttmmtttt'],
    levels: Array<string>(8).fill('000000000'),
    spawn: { x: 5, y: 5, dir: 'up' },
    exits: [
      { x: 3, y: 7, w: 2, h: 1, to: 'town', tx: 4, ty: 1, dir: 'down', home: true },
      { x: 7, y: 2, w: 1, h: 1, to: 'shedroom', tx: 2, ty: 2, dir: 'up', lock: 'bolt-cutters' },
    ],
    objects: [{ kind: 'house', x: 6, y: 1, w: 2, h: 2, roof: '#4c5646', lit: 0, style: 'shed' }],
  };
}
function shedRoom(): MapData {
  return {
    id: 'shedroom', name: 'The shed', version: 1, kind: 'inside', depth: 0, width: 5, height: 4, style: 'shed',
    tiles: ['xxxxx', 'xpppx', 'xpppx', 'xxpxx'], levels: Array<string>(4).fill('00000'),
    spawn: { x: 2, y: 2, dir: 'up' }, exits: [{ x: 2, y: 3, w: 1, h: 1, to: 'woods', tx: 7, ty: 3, dir: 'down' }], objects: [],
  };
}
const maps = () => [townData(), houseData(), woods(), shedRoom()].map(d => new TileMap(d));
const tool = (id: string, icon: 'cutters' | 'waders') => ({ id, name: id, kind: 'tool' as const, stack: 1, icon, text: 'Yours for good.' });
const ITEMS: ItemsData = { version: 1, items: [tool('bolt-cutters', 'cutters'), tool('waders', 'waders')], finds: [] };

const rec = (id: string, x: number, y: number, dir: Dir, more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map: 'woods', x, y, dir, color: colorFor(id), energy: 100, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});

describe('the World and the tiles that open only for some', () => {
  it('lets whoever gets waders wade the culvert from their very next step', () => {
    const w = new World(maps(), 'town', 'overcast', { items: ITEMS, rng: () => 0 });
    w.join(rec('a', 1, 1, 'right'), 0);
    w.drain();
    w.step('a', 'right', 1, 1000);
    expect(w.drain()).toEqual([{ to: 'a', msg: { t: 'reject', seq: 1, x: 1, y: 1, dir: 'right' } }]);
    expect(w.giveTool('a', 'waders')).toBe(true);
    w.drain();
    w.step('a', 'right', 2, 2000);
    expect(w.drain()).toContainEqual({ to: 'a', msg: { t: 'step', id: 'a', x: 2, y: 1, dir: 'right', seq: 2 } });
  });

  it('brings back into the culvert whoever left while wading it, and anyone else who somehow stood there to the spawn', () => {
    const w = new World(maps(), 'town', 'overcast', { items: ITEMS, rng: () => 0 });
    expect(w.join(rec('a', 3, 1, 'right', { tools: ['waders'] }), 0).player).toMatchObject({ x: 3, y: 1 });
    expect(w.join(rec('b', 3, 1, 'right'), 0).player).toMatchObject({ x: 5, y: 5 });
  });
});

describe('locked places over WebSockets', () => {
  let now = 1_000_000;
  const { enter } = setup({ maps: maps(), items: ITEMS, weather: 'overcast', clock: () => now });

  it('refuses the padlocked door to whoever has no bolt cutters, and says why', async () => {
    const a = await enter({ map: 'woods', x: 7, y: 3, dir: 'up' });
    await a.c.settle();
    a.c.send({ t: 'step', dir: 'up', seq: 1 });
    expect(await a.c.next('reject')).toEqual({ t: 'reject', seq: 1, x: 7, y: 3, dir: 'up' });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'step', reason: 'padlocked' });
    // Still out in the woods, in front of the shed.
    expect((await a.c.settle()).some(m => m.t === 'zone')).toBe(false);
  });

  it('opens it for whoever carries them: in they go, into the shed', async () => {
    const a = await enter({ map: 'woods', x: 7, y: 3, dir: 'up', tools: ['bolt-cutters'] });
    await a.c.settle();
    a.c.send({ t: 'step', dir: 'up', seq: 1 });
    expect(await a.c.next('step', m => m.seq === 1)).toMatchObject({ x: 7, y: 2 });
    expect(await a.c.next('zone')).toMatchObject({ map: { id: 'shedroom' }, x: 2, y: 2, reason: 'exit' });
  });

  it('keeps whoever has no waders out of the culvert: it is water, and says nothing', async () => {
    const a = await enter({ map: 'woods', x: 1, y: 1, dir: 'right', tools: ['bolt-cutters'] });
    await a.c.settle();
    a.c.send({ t: 'step', dir: 'right', seq: 1 });
    expect(await a.c.next('reject')).toEqual({ t: 'reject', seq: 1, x: 1, y: 1, dir: 'right' });
    expect((await a.c.settle()).filter(m => m.t === 'refused')).toEqual([]);
  });

  it('lets whoever wears waders wade it through, step by step, and out the other side', async () => {
    const a = await enter({ map: 'woods', x: 1, y: 1, dir: 'right', tools: ['waders'] });
    await a.c.settle();
    for (let seq = 1; seq <= 4; seq++) {
      now += 200;
      a.c.send({ t: 'step', dir: 'right', seq });
      expect(await a.c.next('step', m => m.seq === seq)).toMatchObject({ x: 1 + seq, y: 1 });
    }
    expect((await a.c.settle()).filter(m => m.t === 'reject')).toEqual([]);
  });
});
