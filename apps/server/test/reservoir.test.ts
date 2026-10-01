/**
 * A lake that draws down on a clock (the Reservoir; MapData.drawdown, sky.ts drawdownAt), World rules: its
 * bed is walked on only while the water is back; as it fills, whatever is on the bed goes ashore onto ground
 * on the way home (never a knoll only the low water reached), and whoever was caught is soaked and drained.
 */
import { describe, expect, it } from 'vitest';
import { ENERGY_MAX, FLOOD_ENERGY, TileMap, type Dir, type ItemsData, type MapData, type NotebookData, type ServerMsg } from '@napoland/shared';
import type { DropRecord, PlayerRecord } from '../src/storage';
import { World, colorFor, type Outgoing } from '../src/world';
import { fixtureMaps } from './fixtures';

/** A round start on the wall clock: the water is back for 120 s (the last 30 a warning), then full until 600. */
const T = Date.UTC(2026, 6, 1, 12);
const FULL = 120_000;

/** As in packages/shared/test/drawdown.test.ts: a lake below a shore path home (0,0); with `island`, a knoll at 3,2. */
function lake(island = false): MapData {
  const tiles = ['ggggggg', 'gwwwwwg', island ? 'xwwgwwx' : 'xwwwwwx', 'xxxxxxx'];
  const bed: Array<[number, number]> = tiles.flatMap((row, y) => [...row].flatMap((c, x) => (c === 'w' ? [[x, y] as [number, number]] : [])));
  return {
    id: 'lake', name: 'Lake', version: 1, kind: 'wilds', depth: 1, width: 7, height: 4, tiles, levels: Array<string>(4).fill('0000000'), spawn: { x: 6, y: 0, dir: 'left' },
    exits: [{ x: 0, y: 0, w: 1, h: 1, to: 'town', tx: 1, ty: 1, dir: 'left', home: true }],
    objects: [], drawdown: { name: 'the lake', tiles: bed, every: 600, down: 120, warn: 30 },
  };
}
const ITEMS: ItemsData = { version: 1, items: [{ id: 'bud', name: 'Bud', kind: 'resource', stack: 5, text: 'Green.' }], finds: [] };
const NOTEBOOK: NotebookData = {
  version: 1,
  pages: [
    { id: 'low-water', area: 'field', title: 'Low water', text: 'The bed.', when: { saw: 'drawdown' } },
    { id: 'caught', area: 'field', title: 'Caught', text: 'Wet.', when: { saw: 'flooded' } },
  ],
};
const rec = (id: string, x: number, y: number, dir: Dir = 'down', more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map: 'lake', x, y, dir, color: colorFor(id), energy: ENERGY_MAX, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});
/** A world with the lake whose clock reads `wall` at game time 0. */
const world = (wall: number, island = false, drops: DropRecord[] = []) =>
  new World([...fixtureMaps(), new TileMap(lake(island))], 'town', 'overcast', { items: ITEMS, notebook: NOTEBOOK, epochOffset: wall, rng: () => 0.99, drops });
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id ? [o.msg] : []));
const of = <K extends ServerMsg['t']>(msgs: ServerMsg[], t: K) => msgs.filter((m): m is Extract<ServerMsg, { t: K }> => m.t === t);
const pile = (x: number, y: number): DropRecord => ({ owner: 'z', name: 'Z', map: 'lake', x, y, items: [{ item: 'bud', count: 2 }], droppedAt: T, trail: [] });

describe('a lake that draws down', () => {
  it('refuses a step onto its bed while full, and takes it while the water is back', () => {
    const full = world(T + FULL);
    full.join(rec('a', 1, 0), 0);
    full.drain();
    full.step('a', 'down', 1, 1000);
    expect(of(to(full.drain(), 'a'), 'reject')[0]).toMatchObject({ seq: 1, x: 1, y: 0 });
    expect(full.get('a')).toMatchObject({ x: 1, y: 0 });

    const low = world(T);
    low.join(rec('a', 1, 0), 0);
    low.drain();
    low.step('a', 'down', 1, 1000);
    expect(of(to(low.drain(), 'a'), 'reject')).toEqual([]);
    expect(low.get('a')).toMatchObject({ x: 1, y: 1 });
  });

  it('keeps what lies on its bed unread while it is under water', () => {
    // A slate on a drowned table at 2,1, read from the shore at 2,0.
    const slate = (wall: number) => {
      const m = lake();
      m.objects = [{ kind: 'table', x: 2, y: 1 }, { kind: 'note', x: 2, y: 1, id: 'slate', by: 'brandts', name: 'A slate', text: ['Chalk.'] }];
      const w = new World([...fixtureMaps(), new TileMap(m)], 'town', 'overcast', { items: ITEMS, notebook: NOTEBOOK, epochOffset: wall, rng: () => 0.99 });
      w.join(rec('a', 2, 0), 0);
      w.drain();
      w.talk('a', 2, 1, 1000);
      return of(to(w.drain(), 'a'), 'noteRead');
    };
    expect(slate(T + FULL)).toEqual([]);
    expect(slate(T)).toEqual([{ t: 'noteRead', id: 'slate' }]);
  });

  it('puts standing on the bed in the field notes', () => {
    const w = world(T);
    w.join(rec('a', 3, 1), 0);
    w.tick(1000);
    expect(w.get('a')!.notebook?.pages).toEqual(['low-water']);
  });

  it('as it fills, carries whoever is on the bed to the mainland (not the knoll), soaked and drained; the knoll stays', () => {
    const w = world(T, true);
    w.join(rec('a', 2, 2), 0);
    w.join(rec('b', 3, 2), 0);
    w.tick(FULL - 1);
    const before = w.get('a')!.energy;
    w.drain();
    w.tick(FULL);
    const out = w.drain();
    // The knoll beside them (3,2) is nearer, but only the low water reached it: up the shore to row 0.
    expect(w.get('a')).toMatchObject({ x: 2, y: 0, wet: 1 });
    expect(w.get('a')!.energy).toBeCloseTo(before - FLOOD_ENERGY, 1);
    expect(of(to(out, 'a'), 'reject')).toEqual([{ t: 'reject', seq: 0, x: 2, y: 0, dir: 'down' }]);
    expect(of(to(out, 'a'), 'energy').at(-1)!.body.wet).toBe(1);
    expect(w.get('a')!.notebook?.pages).toContain('caught');
    expect(w.get('b')).toMatchObject({ x: 3, y: 2 });
    expect(of(to(out, 'b'), 'reject')).toEqual([]);
    // And the bed is lake again.
    w.step('a', 'down', 1, FULL + 1000);
    expect(w.get('a')).toMatchObject({ x: 2, y: 0 });
  });

  it('brings back to the mainland, not the knoll, someone saved on the bed who comes back with the lake full', () => {
    expect(world(T + FULL, true).join(rec('a', 2, 2), 0).player).toMatchObject({ x: 2, y: 0 });
  });

  it('goes down the usual way when the water takes the last of their energy', () => {
    // Two seconds before it fills, with less left than the water takes.
    const w = world(T + FULL - 2000);
    w.join(rec('a', 3, 1, 'down', { energy: 5 }), 0);
    w.tick(1999);
    w.drain();
    w.tick(2000);
    expect(of(to(w.drain(), 'a'), 'slump')).toHaveLength(1);
    expect(w.get('a')).toMatchObject({ x: 3, y: 0, energy: 0 });
  });

  it('washes a pile on the bed ashore as it fills, and one saved there while it was full at start', () => {
    const w = world(T, false, [pile(3, 1)]);
    w.tick(FULL);
    expect(w.dropViews('lake')).toMatchObject([{ owner: 'z', x: 3, y: 0 }]);
    expect(world(T + FULL, false, [pile(4, 2)]).dropViews('lake')).toMatchObject([{ owner: 'z', x: 4, y: 0 }]);
  });
});
