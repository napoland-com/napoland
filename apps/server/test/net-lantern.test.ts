/**
 * Shared light (roadmap/group-mechanics.md): in the Burn, whoever stands within LANTERN_REACH of someone
 * else's lantern tires half as fast; a lantern never lights its own carrier, and in a shallower region it
 * does nothing. Over real WebSockets with the content as it ships.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANTERN_DRAIN, LANTERN_REACH, type MapObject } from '@napoland/shared';
import { loadItems, loadMaps } from '../src/content';
import { setup } from './helpers';

const content = resolve(import.meta.dirname, '../../../content');

describe('a lantern in the Burn', () => {
  const { maps } = loadMaps(resolve(content, 'maps'), 'stonebrook');
  const { items } = loadItems(resolve(content, 'items.json'), maps.values());
  const now = 1_000_000;
  const { enter } = setup({ maps: [...maps.values()], items, homeMap: 'stonebrook', weather: 'overcast', rng: () => 0, clock: () => now });
  const gate = maps.get('far-woods')!.data.objects.find((o): o is Extract<MapObject, { kind: 'gate' }> => o.kind === 'gate')!;
  // The trail just inside the Burn, where NAPO's gate lets people through: open ground straight up from
  // it (trees stand either side), few steps in, so nothing flashes. Each test's players leave at its end,
  // so everyone stays in one copy of the map.
  const trail = (y: number) => ({ map: 'burn', x: gate.tx, y, dir: 'up' as const });

  it('is made at the workbench from what the Burn gives', () => {
    expect(items.items.find(i => i.id === 'lantern')).toMatchObject({ kind: 'tool', icon: 'lantern' });
    expect(items.recipes?.find(r => r.make === 'lantern')?.needs).toContainEqual({ item: 'fused-glass', count: 2 });
  });

  it('halves the drain of whoever stands in its light, not its carrier\'s, and everyone sees who carries one', async () => {
    const b = await enter(trail(gate.ty - 1));
    const alone = b.welcome.energy.rate;
    expect(alone).toBeLessThan(0);
    const a = await enter({ ...trail(gate.ty - 2), tools: ['lantern'] });
    expect(a.welcome.players.find(p => p.id === a.id)).toMatchObject({ x: gate.tx, y: gate.ty - 2, lantern: true });
    expect(a.welcome.players.find(p => p.id === b.id)).toMatchObject({ x: gate.tx, y: gate.ty - 1 });
    expect(a.welcome.players.find(p => p.id === b.id)?.lantern).toBeUndefined();
    const lit = await b.c.next('energy', m => m.energy.rate > alone);
    expect(lit.energy.rate).toBeCloseTo(alone * LANTERN_DRAIN, 2);
    // Their own lantern does not light the carrier: one step further in, they tire faster than b in its light.
    expect(a.welcome.energy.rate).toBeLessThan(alone);
    a.c.ws.close();
    expect((await b.c.next('energy', m => m.energy.rate < lit.energy.rate)).energy.rate).toBeCloseTo(alone, 2);
    b.c.ws.close();
  });

  it('lights no farther than its reach', async () => {
    const b = await enter(trail(gate.ty));
    const alone = b.welcome.energy.rate;
    const a = await enter({ ...trail(gate.ty - LANTERN_REACH - 1), tools: ['lantern'] });
    expect(a.welcome.players.map(p => [p.x, p.y])).toEqual(expect.arrayContaining([[gate.tx, gate.ty], [gate.tx, gate.ty - LANTERN_REACH - 1]]));
    const heard = await b.c.settle();
    expect(heard.filter(m => m.t === 'energy' && m.energy.rate > alone)).toEqual([]);
    a.c.ws.close();
    b.c.ws.close();
  });

  it('does nothing in a shallower region', async () => {
    const b = await enter({ map: 'far-woods', x: gate.x, y: gate.y + 1, dir: 'up' });
    const alone = b.welcome.energy.rate;
    const a = await enter({ map: 'far-woods', x: gate.x + 1, y: gate.y + 1, dir: 'up', tools: ['lantern'] });
    expect(a.welcome.players.map(p => p.id)).toContain(b.id);
    const heard = await b.c.settle();
    expect(heard.filter(m => m.t === 'energy' && m.energy.rate > alone)).toEqual([]);
    a.c.ws.close();
    b.c.ws.close();
  });
});
