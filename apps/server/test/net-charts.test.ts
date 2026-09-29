/**
 * A torn paper map, found in pieces (roadmap/inked-maps.md), over real WebSockets: the fixture woods with a
 * map of them torn in four, a piece in each quarter. A piece picked up goes into the player's charts and the
 * map into their tools, saved at once; the piece goes from their sight and grows back for whoever has not
 * found it; the welcome says which pieces they have.
 */
import { describe, expect, it } from 'vitest';
import { STARTER_TOOLS, type ItemsData } from '@napoland/shared';
import { itemsData } from './fixtures';
import { setup, waitFor } from './helpers';

/** The fixture items, and the woods' map torn in four: one piece by the fire, one east, and two down south. */
function tornItems(): ItemsData {
  const d = itemsData();
  d.items.push({ id: 'woods-map', name: 'Map of the Woods', kind: 'tool', stack: 1, chart: 'woods', icon: 'map', text: 'Torn in four.' });
  d.finds.push(
    { item: 'woods-map', map: 'woods', piece: 0, around: { x: 2, y: 1, r: 0.5 }, count: 1, respawn: [10, 20] },
    { item: 'woods-map', map: 'woods', piece: 1, around: { x: 6, y: 2, r: 0.5 }, count: 1, respawn: [10, 20] },
    { item: 'woods-map', map: 'woods', piece: 2, around: { x: 2, y: 5, r: 0.5 }, count: 1, respawn: [10, 20] },
    { item: 'woods-map', map: 'woods', piece: 3, around: { x: 5, y: 5, r: 0.5 }, count: 1, respawn: [10, 20] },
  );
  return d;
}

describe('a map torn in pieces', () => {
  let now = 1_000_000;
  const { ctx, enter } = setup({ items: tornItems(), weather: 'overcast', clock: () => now });
  const pieces = (finds: Array<{ item: string; piece?: number }>) => finds.filter(f => f.item === 'woods-map').map(f => f.piece).sort();

  it('lies in four pieces, each in its quarter, for whoever has none of the map', async () => {
    const a = await enter({ map: 'woods', x: 1, y: 1, dir: 'right' });
    expect(pieces(a.welcome.finds)).toEqual([0, 1, 2, 3]);
    expect(a.welcome.finds.find(f => f.item === 'woods-map' && f.piece === 0)).toMatchObject({ x: 2, y: 1 });
    expect(a.welcome.charts).toEqual({});
    expect(a.welcome.tools).toEqual([]);
  });

  it('gives whoever picks a piece up that quarter and the map, saved at once; the piece grows back for others, not for them', async () => {
    const a = await enter({ map: 'woods', x: 1, y: 1, dir: 'right' });
    const piece = a.welcome.finds.find(f => f.item === 'woods-map' && f.piece === 0)!;
    a.c.send({ t: 'pick', x: 2, y: 1 });
    expect(await a.c.next('got')).toEqual({ t: 'got', items: [{ item: 'woods-map', count: 1 }], from: 'piece' });
    expect(await a.c.next('tools')).toEqual({ t: 'tools', tools: ['woods-map'], charts: { 'woods-map': [0] } });
    expect(await a.c.next('findGone')).toMatchObject({ id: piece.id });
    await waitFor(() => ctx.storage.get(a.id)?.charts?.['woods-map']?.join() === '0', 'the piece to be saved');
    expect(ctx.storage.get(a.id)?.tools).toEqual([...STARTER_TOOLS, 'woods-map']);
    // Gone for now: nothing to pick. Grown back, it lies there for whoever has not found it, out of a's sight.
    a.c.send({ t: 'pick', x: 2, y: 1 });
    expect(await a.c.next('refused')).toMatchObject({ action: 'pick', reason: 'gone' });
    now += 20_000;
    await waitFor(() => ctx.server.world.findViews('woods').some(f => f.item === 'woods-map' && f.piece === 0), 'the piece to grow back');
    expect((await a.c.settle()).filter(m => m.t === 'find')).toEqual([]);
    a.c.send({ t: 'pick', x: 2, y: 1 });
    expect(await a.c.next('refused')).toMatchObject({ action: 'pick', reason: 'have_tool' });
    const b = await enter({ map: 'woods', x: 1, y: 1, dir: 'right' });
    expect(pieces(b.welcome.finds)).toEqual([0, 1, 2, 3]);
    // The second piece joins the first; the map is theirs already.
    const c = await enter({ map: 'woods', x: 5, y: 4, dir: 'down', tools: [...STARTER_TOOLS, 'woods-map'], charts: { 'woods-map': [0] } });
    expect(pieces(c.welcome.finds)).toEqual([1, 2, 3]);
    expect(c.welcome.charts).toEqual({ 'woods-map': [0] });
    c.c.send({ t: 'pick', x: 5, y: 5 });
    expect(await c.c.next('got')).toMatchObject({ from: 'piece' });
    expect(await c.c.next('tools')).toEqual({ t: 'tools', tools: ['woods-map'], charts: { 'woods-map': [0, 3] } });
  });

  it('shows none of the pieces to whoever has them all, or got the map whole before it was torn', async () => {
    const whole = await enter({ map: 'woods', x: 1, y: 1, tools: [...STARTER_TOOLS, 'woods-map'] });
    expect(pieces(whole.welcome.finds)).toEqual([]);
    expect(whole.welcome.charts).toEqual({});
    const all = await enter({ map: 'woods', x: 1, y: 1, tools: [...STARTER_TOOLS, 'woods-map'], charts: { 'woods-map': [0, 1, 2, 3] } });
    expect(pieces(all.welcome.finds)).toEqual([]);
    expect(all.welcome.charts).toEqual({ 'woods-map': [0, 1, 2, 3] });
  });
});
