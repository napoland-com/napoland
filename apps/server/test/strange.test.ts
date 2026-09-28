/**
 * The strange objects' new things, as the World runs them: the ember coal and the pale moth (charms), and
 * the quirks hush (skulkers hear you from fewer steps) and afterglow (a flash leaves you glowing, and
 * watchers keep off you meanwhile). The lodestone is felt by the wearer's game alone (lodestone.ts there).
 *
 * The field is open grass in the wilds walled in by forest, its way home in the middle of the bottom row.
 */
import { describe, expect, it } from 'vitest';
import {
  AFTERGLOW_S, ENERGY_MAX, FLASH_GLOW_S, REFILL_PER_SECOND, STEP_MS, TileMap, type Dir, type ItemsData, type MapData, type ServerMsg, type Weather,
} from '@napoland/shared';
import type { PlayerRecord } from '../src/storage';
import { SKULKER_HEAR, SKULKER_HEAR_HUSHED, WATCHER_STEP_MS, World, colorFor, type Outgoing, type WorldOptions } from '../src/world';
import { fixtureMaps } from './fixtures';

const ITEMS: ItemsData = {
  version: 1,
  items: [
    { id: 'cap', name: 'Glowcap', kind: 'resource', stack: 20, text: 'Glows.', use: { mark: true } },
    { id: 'coal', name: 'Ember coal', kind: 'charm', stack: 1, text: 'Warm.', charm: { warmth: 1.2 } },
    { id: 'moth', name: 'Pale moth', kind: 'charm', stack: 1, text: 'Pale.', charm: { markEnergy: 1 } },
    { id: 'hood', name: 'Crew hood', kind: 'gear', stack: 1, text: 'White.', slot: 'cap', tier: 'anomalous', resist: { radiation: 0.3 } },
  ],
  finds: [],
};

/** A field `h` tiles tall (8 wide inside the forest), its way home at (4, h - 1). */
function fieldData(h = 12, more: Partial<MapData> = {}): MapData {
  const tiles = Array.from({ length: h }, (_, y) => (y === 0 ? 'tttttttttt' : y === h - 1 ? 'ttttgttttt' : 'tggggggggt'));
  return {
    id: 'field', name: 'The Field', version: 1, kind: 'wilds', depth: 1, width: 10, height: h, tiles, levels: Array<string>(h).fill('0000000000'),
    spawn: { x: 4, y: h - 2, dir: 'up' }, exits: [{ x: 4, y: h - 1, w: 1, h: 1, to: 'town', tx: 4, ty: 1, dir: 'down', home: true }], objects: [], ...more,
  };
}

const rec = (id: string, map: string, x: number, y: number, dir: Dir = 'up', more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map, x, y, dir, color: colorFor(id), energy: ENERGY_MAX, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});
/** Wearing a crew hood with this quirk. */
const hooded = (quirk: 'hush' | 'afterglow' | 'lodestone'): Partial<PlayerRecord> => ({ gear: { cap: 'hood' }, worn: { cap: { cond: 1, quirk } } });

function world(field: MapData, weather: Weather, options: WorldOptions = {}, ...players: PlayerRecord[]): World {
  const w = new World([new TileMap(field), ...fixtureMaps()], 'town', weather, { items: ITEMS, rng: () => 0, ...options });
  for (const p of players) w.join(p, 0);
  w.drain();
  return w;
}
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id || o.to === 'all' ? [o.msg] : []));
const onMap = (out: Outgoing[], map: string) => out.flatMap(o => ('map' in o && o.map === map ? [o.msg] : []));
const of = <T extends ServerMsg['t']>(msgs: ServerMsg[], t: T) => msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);

describe('the new charms', () => {
  it('an ember coal in the bag makes a fire warm you 20% faster', () => {
    // Next to the fixture woods' campfire, which never goes out, for 2 seconds.
    const warmed = (bag: PlayerRecord['bag']) => {
      const w = world(fieldData(), 'overcast', {}, rec('a', 'woods', 4, 1, 'down', { energy: 10, bag }));
      w.tick(2000);
      return w.get('a')!.energy - 10;
    };
    expect(warmed([])).toBeCloseTo(REFILL_PER_SECOND * 2, 3);
    expect(warmed([{ item: 'coal', count: 1 }])).toBeCloseTo(REFILL_PER_SECOND * 1.2 * 2, 3);
  });

  it('a pale moth gives 1 energy each time a glowcap is crushed, as far as the bar has room, and says so', () => {
    const w = world(fieldData(), 'overcast', {}, rec('a', 'field', 4, 5, 'up', { energy: 50, bag: [{ item: 'cap', count: 3 }, { item: 'moth', count: 1 }] }));
    w.use('a', 0, 0);
    const out = to(w.drain(), 'a');
    expect(of(out, 'did')).toEqual([{ t: 'did', did: { kind: 'used', item: 'cap', mark: { dir: 'up', left: 86_400 }, lift: { item: 'moth', energy: 1 } } }]);
    expect(w.get('a')!.energy).toBe(51);
    // Full, nothing comes of it, and nothing is said.
    const full = world(fieldData(), 'overcast', {}, rec('b', 'field', 4, 5, 'up', { bag: [{ item: 'cap', count: 1 }, { item: 'moth', count: 1 }] }));
    full.use('b', 0, 0);
    expect(of(to(full.drain(), 'b'), 'did')[0]!.did).toEqual({ kind: 'used', item: 'cap', mark: { dir: 'up', left: 86_400 } });
    // Without one, a glowcap only paints.
    const plain = world(fieldData(), 'overcast', {}, rec('c', 'field', 4, 5, 'up', { energy: 50, bag: [{ item: 'cap', count: 1 }] }));
    plain.use('c', 0, 0);
    expect(plain.get('c')!.energy).toBe(50);
  });
});

describe('hush', () => {
  // One skulker at night, in its lair at 4,3 (the field's one fern tile), that may go 8 steps from home or more.
  const skulkers = { count: 1, steps: [8, 999] as [number, number], when: ['night'] as Array<'night' | 'storm'> };
  const data = (): MapData => {
    const d = fieldData(40, { skulkers });
    return { ...d, tiles: d.tiles.map((r, y) => (y === 3 ? `${r.slice(0, 4)}f${r.slice(5)}` : r)) };
  };
  /** Ticks every 50 ms from `from` to `until`; at each STEP_MS, `a` steps where `walk` says. The skulkers' news. */
  const run = (w: World, from: number, until: number, walk: (t: number) => Dir | undefined) => {
    const out: Outgoing[] = [];
    for (let t = from; t <= until; t += 50) {
      const dir = t % STEP_MS === 0 ? walk(t) : undefined;
      if (dir) w.step('a', dir, t, t);
      w.tick(t);
      out.push(...w.drain());
    }
    return of(onMap(out, 'field'), 'creature').map(m => m.creature);
  };

  it('keeps a skulker from hearing you walk until you are 4 steps away, not 6', () => {
    expect([SKULKER_HEAR, SKULKER_HEAR_HUSHED]).toEqual([6, 4]);
    const w = world(data(), 'night');
    w.tick(0);
    expect(w.scene('field', 0).creatures).toEqual([{ id: 1, kind: 'skulker', x: 4, y: 3, dir: 'down' }]);
    w.join(rec('a', 'field', 4, 8, 'up', hooded('hush')), 0);
    w.drain();
    // Walking 6, then 5 steps away: it hears nothing.
    expect(run(w, 50, 2000, t => (t === 400 ? 'down' : t === 1200 ? 'up' : undefined))).toEqual([]);
    // 4 steps away, walking: it hears that.
    expect(run(w, 2050, 3000, t => (t === 2200 ? 'up' : undefined))[0]).toMatchObject({ chasing: 'a' });
  });
});

describe('afterglow', () => {
  // A flash every minute near someone 3 or more steps from home (so the next comes only after a glow has
  // faded), and one watcher waking 12 or more from it.
  const data = () => fieldData(12, { flashes: { every: 60, steps: [3, 99] }, watchers: { count: 1, steps: [12, 99] } });
  const T = 60_000, BURST = T + FLASH_GLOW_S * 1000;

  it('leaves you glowing after a flash discharges near you, for everyone on the map to see; watchers keep off you meanwhile', () => {
    // With these dice, the flash goes on 2,4, beside a (at 4,6), and the watcher wakes at 1,1, 8 steps from
    // a, who faces it (so it holds still) until the glow is on.
    const w = world(data(), 'overcast', {}, rec('a', 'field', 4, 6, 'up', hooded('afterglow')));
    w.tick(0);
    expect(w.scene('field', 0).creatures).toMatchObject([{ kind: 'watcher', x: 1, y: 1 }]);
    w.drain();
    w.tick(T);
    expect(of(onMap(w.drain(), 'field'), 'flash')).toMatchObject([{ flash: { x: 2, y: 4 } }]);
    w.tick(BURST - 100);
    expect(of(onMap(w.drain(), 'field'), 'afterglow')).toEqual([]);
    w.tick(BURST + 1);
    expect(of(onMap(w.drain(), 'field'), 'afterglow')).toEqual([{ t: 'afterglow', id: 'a', left: AFTERGLOW_S }]);
    // Whoever comes sees it too.
    w.tick(BURST + 10_000);
    expect(w.views('field').find(p => p.id === 'a')?.afterglow).toBeCloseTo(AFTERGLOW_S - 10, 0);
    // Its back turned now, a is still nobody's prey while the glow lasts: the watcher does not move.
    w.face('a', 'down');
    w.drain();
    const end = BURST + 1 + AFTERGLOW_S * 1000;
    for (let t = BURST + 10_050; t < end - 100; t += WATCHER_STEP_MS) w.tick(t);
    expect(of(onMap(w.drain(), 'field'), 'creature')).toEqual([]);
    // Once it fades, everyone hears it, and the watcher comes.
    w.tick(end + 1);
    expect(of(onMap(w.drain(), 'field'), 'afterglow')).toEqual([{ t: 'afterglow', id: 'a', left: 0 }]);
    expect(w.views('field').find(p => p.id === 'a')?.afterglow).toBeUndefined();
    let came = false;
    for (let t = end + WATCHER_STEP_MS; t < end + 10 * WATCHER_STEP_MS && !came; t += WATCHER_STEP_MS) {
      w.tick(t);
      came = of(onMap(w.drain(), 'field'), 'creature').length > 0;
    }
    expect(came).toBe(true);
  });

  it('is only for gear that has it, and only near the flash', () => {
    const w = world(data(), 'overcast', {}, rec('a', 'field', 4, 5, 'down'));
    w.tick(0);
    w.tick(T);
    w.tick(BURST + 1);
    expect(of(onMap(w.drain(), 'field'), 'afterglow')).toEqual([]);
  });

  it('ends when you collapse: you wake at home, dry and alone', () => {
    const w = world(data(), 'overcast', {}, rec('a', 'field', 4, 5, 'down', { ...hooded('afterglow'), energy: 30 }));
    w.tick(0);
    w.tick(T);
    w.tick(BURST + 1);
    expect(of(onMap(w.drain(), 'field'), 'afterglow')).toHaveLength(1);
    // Out of energy: home, and no glow there.
    for (let t = BURST + 1000; w.get('a')!.map === 'field' && t < BURST + 600_000; t += 1000) w.tick(t);
    expect(w.get('a')!.map).toBe('town');
    expect(w.views('town').find(p => p.id === 'a')?.afterglow).toBeUndefined();
  });
});
