/**
 * Seasons (roadmap/seasons.md), World rules: a week each on the wall clock, everyone told as they turn;
 * the season's finds; winter's cold; and the water that freezes, walked on in winter only, with whoever
 * stands on it stepping ashore as it thaws.
 */
import { describe, expect, it } from 'vitest';
import { ENERGY_MAX, SEASONS, TileMap, energyRate, seasonAt, type Dir, type ItemsData, type MapData, type Season, type ServerMsg } from '@napoland/shared';
import type { PlayerRecord } from '../src/storage';
import { World, colorFor, type Outgoing } from '../src/world';
import { fixtureMaps, townData } from './fixtures';

const WEEK_MS = 7 * 86_400_000;
/** The first Monday 00:00 UTC from late September 2026 that starts `season`. */
const mondayOf = (season: Season) => {
  let t = Date.UTC(2026, 8, 28);
  while (seasonAt(t) !== season) t += WEEK_MS;
  return t;
};

/** A 9x7 field with a pond (x 2 to 6, y 2 to 4) that freezes in winter, its way home at the bottom (4,6). */
function pondField(): MapData {
  const pond: Array<[number, number]> = [];
  for (let y = 2; y <= 4; y++) for (let x = 2; x <= 6; x++) pond.push([x, y]);
  return {
    id: 'field', name: 'The Field', version: 1, kind: 'wilds', depth: 1, width: 9, height: 7,
    tiles: ['ttttttttt', 'tgggggggt', 'tgwwwwwgt', 'tgwwwwwgt', 'tgwwwwwgt', 'tgggggggt', 'ttttgtttt'], levels: Array<string>(7).fill('000000000'),
    spawn: { x: 4, y: 5, dir: 'up' }, exits: [{ x: 4, y: 6, w: 1, h: 1, to: 'town', tx: 4, ty: 1, dir: 'down', home: true }], objects: [],
    ice: [{ name: 'the pond', tiles: pond }],
  };
}
/** The fixture town, with a notice board at 0,4. */
const town = (): MapData => ({ ...townData(), objects: [...townData().objects, { kind: 'board', x: 0, y: 4 }] });
const ITEMS: ItemsData = {
  version: 1,
  items: [{ id: 'bud', name: 'Spring bud', kind: 'resource', stack: 5, text: 'Green.' }],
  finds: [{ item: 'bud', map: 'field', on: ['grass'], count: 1, respawn: [10, 20], season: 'spring' }],
};

const rec = (id: string, map: string, x: number, y: number, dir: Dir = 'right', more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map, x, y, dir, color: colorFor(id), energy: ENERGY_MAX, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});
/** A world of the town (its house and woods too) and the pond field, whose clock is `wall` at game time 0. */
const world = (wall: number, cycle = false) => new World(
  [new TileMap(town()), new TileMap(pondField()), ...fixtureMaps().filter(m => m.data.id !== 'town')], 'town', 'overcast', { items: ITEMS, epochOffset: wall, rng: () => 0.99, cycle },
);
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id || o.to === 'all' ? [o.msg] : []));
const onMap = (out: Outgoing[], map: string) => out.flatMap(o => ('map' in o && o.map === map ? [o.msg] : []));
const of = <T extends ServerMsg['t']>(msgs: ServerMsg[], t: T) => msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

describe('seasons', () => {
  it('tells everyone as the week turns the season, and the welcome says it with the time left', () => {
    const w = world(mondayOf('autumn') - 60_000);
    const joined = w.join(rec('a', 'town', 0, 5), 0);
    expect(joined.season).toEqual({ season: 'summer', left: 60 });
    w.drain();
    w.tick(30_000);
    expect(of(to(w.drain(), 'a'), 'season')).toEqual([]);
    w.tick(60_000);
    expect(of(to(w.drain(), 'a'), 'season')).toEqual([{ t: 'season', season: { season: 'autumn', left: 7 * 86_400 } }]);
  });

  it('grows a season\'s finds while it lasts, and takes them back as it ends', () => {
    const w = world(mondayOf('spring') - 1000);
    w.tick(0);
    expect(w.findViews('field')).toEqual([]);
    w.join(rec('a', 'field', 4, 5), 0);
    w.drain();
    w.tick(1000);
    expect(of(onMap(w.drain(), 'field'), 'find')).toHaveLength(1);
    // A world that starts in spring has them from the start.
    expect(world(mondayOf('spring')).findViews('field')).toHaveLength(1);
    const late = world(mondayOf('summer') - 1000);
    late.join(rec('b', 'field', 4, 5), 0);
    late.drain();
    late.tick(1000);
    expect(of(onMap(late.drain(), 'field'), 'findGone')).toHaveLength(1);
    expect(late.findViews('field')).toEqual([]);
  });

  it('bites colder in winter out there: the cold part of the drain is stronger', () => {
    const field = new TileMap(pondField()), chill = { weather: SEASONS.winter.chill, wet: SEASONS.winter.wet };
    const winter = world(mondayOf('winter')).join(rec('a', 'field', 4, 5), 0);
    const autumn = world(mondayOf('autumn')).join(rec('a', 'field', 4, 5), 0);
    expect(winter.energy.rate).toBe(r3(energyRate(field, 4, 5, 'overcast', { chill })));
    expect(autumn.energy.rate).toBe(r3(energyRate(field, 4, 5, 'overcast')));
    expect(-winter.energy.rate).toBeGreaterThan(-autumn.energy.rate);
  });

  it('says the season on the notice board, how long is left of it and what it changes, and snow for rain in winter', () => {
    const board = (wall: number) => {
      const w = world(wall, true);
      w.join(rec('a', 'town', 0, 5, 'up'), 0);
      w.drain();
      w.board('a', 0, 4, 0);
      return of(to(w.drain(), 'a'), 'board')[0]!.lines;
    };
    // Three days into winter, 14 minutes after that day's dawn: the Field rains (snows) on the usual cycle.
    const lines = board(mondayOf('winter') + 3 * 86_400_000 + 14 * 60_000);
    expect(lines).toContain('The Field: snow for about 10 minutes more.');
    expect(lines).toContain('Winter, for about 4 days more: colder out there, and snow instead of rain, and the pond in the Field frozen hard enough to cross. Spring comes next.');
    expect(board(mondayOf('spring') + 6 * 86_400_000)).toContain('Spring, for about 24 hours more: longer rain, and more glowcaps out there. Summer comes next.');
    expect(board(mondayOf('summer'))).toContain('Summer, for about 7 days more: shorter rain, and light until later in the evening. Autumn comes next.');
    expect(board(mondayOf('autumn') + 86_400_000)).toContain('Autumn, for about 6 days more: more resin out there, and storms twice as often. Winter comes next.');
  });
});

describe('the frozen pond', () => {
  it('can be crossed in winter only: a step onto the ice goes, in any other season it is refused', () => {
    const cross = (season: Season) => {
      const w = world(mondayOf(season));
      w.join(rec('a', 'field', 1, 3), 0);
      w.drain();
      for (let k = 0; k < 6; k++) w.step('a', 'right', k + 1, 1000 + k * 200);
      return { w, out: to(w.drain(), 'a') };
    };
    const winter = cross('winter');
    expect(of(winter.out, 'reject')).toEqual([]);
    expect(winter.w.get('a')).toMatchObject({ x: 7, y: 3 });
    for (const season of ['spring', 'summer', 'autumn'] as const) {
      const other = cross(season);
      expect(of(other.out, 'reject')[0], season).toMatchObject({ t: 'reject', seq: 1, x: 1, y: 3 });
      expect(other.w.get('a'), season).toMatchObject({ x: 1, y: 3 });
    }
  });

  it('thaws as winter ends: whoever stands on it steps ashore, and the others see the step', () => {
    const w = world(mondayOf('spring') - 60_000);
    w.join(rec('a', 'field', 4, 3, 'up'), 0);
    w.join(rec('b', 'field', 1, 1), 0);
    w.drain();
    w.tick(60_000);
    const out = w.drain();
    // The nearest ground, two tiles up across the ice.
    expect(w.get('a')).toMatchObject({ x: 4, y: 1 });
    expect(of(to(out, 'a'), 'reject')).toEqual([{ t: 'reject', seq: 0, x: 4, y: 1, dir: 'up' }]);
    expect(out).toContainEqual({ to: '*', map: 'field', except: 'a', msg: { t: 'step', id: 'a', x: 4, y: 1, dir: 'up' } });
    // Before the season is heard: a client sees itself ashore, then the thaw.
    const msgs = to(out, 'a').map(m => m.t);
    expect(msgs.indexOf('reject')).toBeLessThan(msgs.indexOf('season'));
    // And the ice is water again.
    w.step('b', 'down', 1, 61_000);
    w.step('b', 'right', 2, 61_300);
    expect(w.get('b')).toMatchObject({ x: 1, y: 2 });
  });

  it('washes a pile on the ice up on the shore as it thaws, and an arrow painted on it goes with the ice', () => {
    const at = mondayOf('spring') - 60_000;
    const w = new World([new TileMap(town()), new TileMap(pondField()), ...fixtureMaps().filter(m => m.data.id !== 'town')], 'town', 'overcast', {
      items: ITEMS, epochOffset: at, rng: () => 0.99,
      drops: [{ owner: 'z', name: 'Z', map: 'field', x: 3, y: 3, items: [{ item: 'bud', count: 2 }], droppedAt: at, trail: [] }],
      marks: [{ id: 7, owner: 'z', name: 'Z', color: '#ffffff', map: 'field', x: 5, y: 3, dir: 'up', placedAt: at, until: at + 86_400_000 }],
    });
    w.join(rec('a', 'field', 1, 1), 0);
    w.drain();
    w.takeWrites();
    w.tick(60_000);
    const out = onMap(w.drain(), 'field');
    // Two tiles up across the ice is the nearest shore (as near as two to the left: up is looked at first).
    expect(w.dropViews('field')).toMatchObject([{ owner: 'z', x: 3, y: 1 }]);
    expect(out).toContainEqual({ t: 'drop', drop: expect.objectContaining({ owner: 'z', x: 3, y: 1 }) });
    expect(out).toContainEqual({ t: 'markGone', id: 7 });
    const writes = w.takeWrites();
    expect(writes.drops).toContainEqual({ owner: 'z', drop: expect.objectContaining({ x: 3, y: 1 }) });
    expect(writes.marks).toEqual([{ id: 7, mark: undefined }]);
  });

  it('brings back ashore, not to the map\'s start, someone saved on the ice who comes back after it thawed', () => {
    const w = world(mondayOf('spring'));
    expect(w.join(rec('a', 'field', 3, 3), 0).player).toMatchObject({ x: 3, y: 1 });
  });

  it('measures the way home across the ice in winter: the drain on it is by the steps it saves', () => {
    const field = new TileMap(pondField());
    field.freeze(true);
    const w = world(mondayOf('winter'));
    const on = w.join(rec('a', 'field', 4, 3), 0);
    expect(on.energy.rate).toBe(r3(energyRate(field, 4, 3, 'overcast', { chill: { weather: SEASONS.winter.chill, wet: SEASONS.winter.wet } })));
  });
});
