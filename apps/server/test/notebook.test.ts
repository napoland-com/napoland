/**
 * The field notes (packages/shared/src/notebook.ts): a page opens the first time a player picks up, reads
 * or lives through what it is about, and a blank on an open page fills in when they see its answer
 * happen; each is heard at once and saved at once. World rules first, then over real WebSockets.
 *
 * Most tests use a field like survival.test.ts's: open grass in the wilds, walled in by forest, the way
 * home in the middle of its bottom row, so steps from home are |x - 4| + (bottom row - y).
 */
import { describe, expect, it } from 'vitest';
import { STEP_MS, TileMap, liveEnds, type Dir, type ItemsData, type MapData, type NotebookData, type ServerMsg, type Weather } from '@napoland/shared';
import { MemoryStorage, type PlayerRecord } from '../src/storage';
import { HITCH_STEPS, STONE_NEED, World, colorFor, type Outgoing, type WorldOptions } from '../src/world';
import { MOSS_TILES, fixtureMaps, houseData, townData, woodsData } from './fixtures';
import { keepsNotebook, setup, waitFor } from './helpers';

/** A field `h` tiles tall (8 wide inside the forest), its way home at (4, h - 1). */
function fieldData(h = 12, more: Partial<MapData> = {}): MapData {
  const tiles = Array.from({ length: h }, (_, y) => (y === 0 ? 'tttttttttt' : y === h - 1 ? 'ttttgttttt' : 'tggggggggt'));
  return {
    id: 'field', name: 'The Field', version: 1, kind: 'wilds', depth: 1, width: 10, height: h, tiles, levels: Array<string>(h).fill('0000000000'),
    spawn: { x: 4, y: h - 2, dir: 'up' }, exits: [{ x: 4, y: h - 1, w: 1, h: 1, to: 'town', tx: 4, ty: 1, dir: 'down', home: true }], objects: [], ...more,
  };
}
const withTiles = (d: MapData, row: (r: string, y: number) => string): MapData => ({ ...d, tiles: d.tiles.map(row) });
/** A hut whose door opens off the field at 1,1: you come out onto 1,2. */
const hut = (): MapData => ({ ...houseData(), id: 'hut', name: 'Hut', exits: [{ x: 2, y: 4, w: 1, h: 1, to: 'field', tx: 1, ty: 2, dir: 'down' }] });
const HUT_DOOR = { x: 1, y: 1, w: 1, h: 1, to: 'hut', tx: 2, ty: 3, dir: 'up' as const };
/**
 * The fixture town with the Old Stone at 3,3 and its sign at 6,5 (read it from 6,6), a sign at 0,4 (read
 * it from 0,5), a desk at 2,6 (read it from 2,5) and a pole at 5,5.
 */
function town(): MapData {
  const t = townData();
  return {
    ...t,
    objects: [
      ...t.objects, { kind: 'stone', x: 3, y: 3 }, { kind: 'sign', x: 6, y: 5, text: ['The Old Stone'] }, { kind: 'sign', x: 0, y: 4, text: ['Town. Pop. 2'] },
      { kind: 'console', id: 'log', name: 'Log', x: 2, y: 6, text: ['Week 1.'] }, { kind: 'pole', x: 5, y: 5 },
    ],
  };
}

const ITEMS: ItemsData = {
  version: 1,
  items: [
    { id: 'moss', name: 'Moss', kind: 'resource', stack: 10, text: 'Soft.' },
    { id: 'wire', name: 'Wire', kind: 'resource', stack: 10, text: 'Copper.' },
    { id: 'flare', name: 'Flare', kind: 'consumable', stack: 3, text: 'Red.', use: { flare: 30 } },
    { id: 'shard', name: 'Shard', kind: 'resource', stack: 20, text: 'Warm.', charge: 1 },
    { id: 'odd', name: 'Strange object', kind: 'resource', stack: 1, text: 'What is it?', use: { identify: true }, reveals: [{ item: 'feather', count: 1, weight: 1 }] },
    { id: 'feather', name: 'Feather', kind: 'charm', stack: 1, text: 'Light.', charm: { load: 0.5 } },
    { id: 'live', name: 'Live shard', kind: 'resource', stack: 1, text: 'Humming.', charge: 1, live: { xp: 40, fresh: 10, fade: 5, into: 'shard' } },
  ],
  finds: [],
};

const blank = (id: string, saw: string) => ({ id, ask: `${id}... ?`, fill: `${id}.`, when: { saw } });
/** A page for each kind of thing that opens one, most of them with a blank, as content/notebook.json has them. */
const NOTEBOOK = {
  version: 3,
  pages: [
    { id: 'moss', area: 'woods', title: 'Moss', text: 'Soft.', when: { find: 'moss' } },
    {
      id: 'wire', area: 'anywhere', title: 'Wire', text: 'Copper.', when: { find: 'wire' },
      blanks: [{ id: 'wire-green', ask: 'More... ?', fill: 'More on green nights.', when: { find: 'wire', during: 'aurora' } }, { id: 'wire-storm', ask: 'In a storm... ?', fill: 'In a storm too.', when: { find: 'wire', during: 'storm' } }],
    },
    { id: 'the-sign', area: 'town', title: 'The sign', text: 'Pop. 2.', when: { read: { map: 'town', x: 0, y: 4 } } },
    { id: 'the-log', area: 'town', title: 'The log', text: 'Week 1.', when: { read: 'log' } },
    { id: 'surges', area: 'field', title: 'Surges', text: 'It rolls in.', when: { saw: 'surge' }, blanks: [blank('surge-light', 'lit')] },
    { id: 'storms', area: 'field', title: 'Storms', text: 'Wind.', when: { saw: 'storm' }, blanks: [blank('storm-roof', 'roof')] },
    { id: 'flashes', area: 'field', title: 'Flashes', text: 'Glow.', when: { saw: 'flash' }, blanks: [blank('flash-burst', 'burst')] },
    { id: 'auroras', area: 'anywhere', title: 'Auroras', text: 'Green.', when: { saw: 'aurora' }, blanks: [blank('aurora-hum', 'hum')] },
    { id: 'hitchhikers', area: 'anywhere', title: 'Hitchhikers', text: 'On my back.', when: { saw: 'hitched' }, blanks: [blank('hitch-lets-go', 'let-go')] },
    { id: 'watchers', area: 'field', title: 'Watchers', text: 'Tall.', when: { saw: 'watcher' }, blanks: [blank('watcher-stops', 'froze')] },
    { id: 'skulkers', area: 'field', title: 'Skulkers', text: 'Low.', when: { saw: 'escaped' }, blanks: [blank('skulker-rustle', 'rustle')] },
    { id: 'tall-grass', area: 'field', title: 'Tall grass', text: 'Crouch.', when: { saw: 'hidden' }, blanks: [blank('grass-edge', 'grass')] },
    { id: 'strange', area: 'anywhere', title: 'Strange', text: 'Odd.', when: { find: 'odd' }, blanks: [blank('strange-light', 'looked')] },
    { id: 'charms', area: 'anywhere', title: 'Charms', text: 'Light.', when: { find: 'feather' } },
    { id: 'live', area: 'field', title: 'Live', text: 'Humming.', when: { find: 'live' }, blanks: [blank('live-fades', 'faded')] },
    { id: 'the-stone', area: 'town', title: 'The stone', text: 'It hums.', when: { read: { map: 'town', x: 6, y: 5 } }, blanks: [blank('stone-wakes', 'woke')] },
  ],
} as NotebookData;

/** A player on `map` at x,y with a full bar, unless `more` says otherwise. */
const rec = (id: string, map: string, x: number, y: number, dir: Dir = 'up', more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map, x, y, dir, color: colorFor(id), energy: 100, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});
/** A world of the town, `field`, the hut and the fixture woods and house. Players join at 0; joins and writes drained. */
function world(field: MapData, weather: Weather, options: WorldOptions = {}, ...players: PlayerRecord[]): World {
  const maps = [new TileMap(town()), new TileMap(field), new TileMap(hut()), ...fixtureMaps().filter(m => m.data.id !== 'town')];
  const w = new World(maps, 'town', weather, { items: ITEMS, notebook: NOTEBOOK, rng: () => 0, ...options });
  for (const p of players) w.join(p, 0);
  w.drain();
  w.takeWrites();
  return w;
}
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id || o.to === 'all' ? [o.msg] : []));
const of = <T extends ServerMsg['t']>(msgs: ServerMsg[], t: T) => msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
/** The pages and the blanks a player heard of. */
const heard = (out: Outgoing[], id: string) => ({ pages: of(to(out, id), 'page').map(m => m.id), blanks: of(to(out, id), 'blank').map(m => m.id) });
const none = { pages: [], blanks: [] };
/** Ticks every 50 ms from `from` to `to`, everything heard. */
const run = (w: World, from: number, to: number, each: (t: number) => void = () => {}) => {
  const out: Outgoing[] = [];
  for (let t = from; t <= to; t += 50) {
    each(t);
    w.tick(t);
    out.push(...w.drain());
  }
  return out;
};

describe('the field notes', () => {
  it('open a page the first time you pick up a kind of find, once: heard, and saved at once', () => {
    const w = world(fieldData(), 'overcast', { items: { ...ITEMS, finds: [{ item: 'moss', map: 'woods', near: { kinds: ['fireplace'], radius: 1.5 }, count: 1, respawn: [10, 20] }] } }, rec('a', 'woods', 4, 1));
    const moss = w.findViews('woods')[0]!;
    w.pick('a', moss.x, moss.y, 1000);
    const out = w.drain();
    expect(heard(out, 'a')).toEqual({ pages: ['moss'], blanks: [] });
    // After the find itself.
    expect(to(out, 'a').findIndex(m => m.t === 'page')).toBeGreaterThan(to(out, 'a').findIndex(m => m.t === 'got'));
    expect(w.takeWrites().players.map(p => [p.id, p.notebook])).toEqual([['a', { pages: ['moss'], blanks: [] }]]);
    w.tick(30_000);
    w.drain();
    const again = w.findViews('woods')[0]!;
    w.pick('a', again.x, again.y, 31_000);
    expect(heard(w.drain(), 'a')).toEqual(none);
  });

  it('open a page when you read a sign by where it stands, or a desk by its id: from next to it, and never from farther', () => {
    const w = world(fieldData(), 'overcast', {}, rec('a', 'town', 0, 5), rec('b', 'town', 2, 5), rec('far', 'town', 1, 6));
    w.talk('far', 0, 4, 1000);
    w.talk('a', 1, 4, 1000);
    expect(heard(w.drain(), 'far')).toEqual(none);
    w.talk('a', 0, 4, 1000);
    w.talk('b', 2, 6, 1000);
    const out = w.drain();
    expect(heard(out, 'a')).toEqual({ pages: ['the-sign'], blanks: [] });
    expect(heard(out, 'b')).toEqual({ pages: ['the-log'], blanks: [] });
    expect(w.get('a')!.notebook).toEqual({ pages: ['the-sign'], blanks: [] });
  });

  it('fill in a blank on what you picked up and when: an aurora night, a storm; the page first', () => {
    // Wire grows within a tile of a, who reaches every one of them.
    const items: ItemsData = { ...ITEMS, finds: [{ item: 'wire', map: 'field', around: { x: 4, y: 5, r: 1 }, count: 2, respawn: [1, 1] }] };
    const w = world(fieldData(12, { storm: { every: 100, warn: 10, length: 20 } }), 'aurora', { items }, rec('a', 'field', 4, 5));
    // On an aurora night the first wire opens its page and fills in its blank at once.
    const first = w.findViews('field')[0]!;
    w.pick('a', first.x, first.y, 1000);
    const out = to(w.drain(), 'a');
    expect(of(out, 'page').map(m => m.id)).toEqual(['wire']);
    expect(of(out, 'blank').map(m => m.id)).toEqual(['wire-green']);
    expect(out.findIndex(m => m.t === 'page')).toBeLessThan(out.findIndex(m => m.t === 'blank'));
    // In a storm (80 to 100 s into each round), the other.
    w.setWeather('overcast', 85_000);
    w.tick(85_000);
    w.drain();
    const next = w.findViews('field')[0]!;
    w.pick('a', next.x, next.y, 85_000);
    expect(heard(w.drain(), 'a')).toEqual({ pages: [], blanks: ['wire-storm'] });
  });

  it('let a blank seen before its page was go unnoticed: looked at in town, a strange object fills in nothing yet', () => {
    const w = world(fieldData(), 'overcast', {}, rec('a', 'town', 1, 2, 'up', { bag: [{ item: 'odd', count: 1 }] }));
    w.use('a', 0, 1000);
    // What it turned out to be comes into your hands like a find: its page opens.
    expect(heard(w.drain(), 'a')).toEqual({ pages: ['charms'], blanks: [] });
    expect(w.get('a')!.notebook).toEqual({ pages: ['charms'], blanks: [] });
    // With the strange object's page open, looking at the next one fills in its blank.
    const b = world(fieldData(), 'overcast', {}, rec('b', 'town', 1, 2, 'up', { bag: [{ item: 'odd', count: 1 }], notebook: { pages: ['strange'], blanks: [] } }));
    b.use('b', 0, 1000);
    expect(heard(b.drain(), 'b')).toEqual({ pages: ['charms'], blanks: ['strange-light'] });
  });

  describe('as you live through it', () => {
    // A round of 100 s: calm 60, restless 20, surge 20; the front takes 10 s to reach home. A street light
    // at 1,5 lights 3,5 but not 4,5; the hut's door opens off 1,1, and you come out onto 1,2.
    const surge = { every: 100, unstable: 20, surge: 20, sweep: 10 };
    const surging = () => fieldData(12, { surge, objects: [{ kind: 'lamp', x: 1, y: 5 }], exits: [...fieldData().exits, HUT_DOOR] });

    it('opens the page on a surge you shelter from under a street light or a roof; out in it, it waits for you to find one', () => {
      // lit: 3,5, 7 steps from home. out: 4,5, 6 steps. In the hut: its door, 1,2, is 12 steps out.
      const w = world(surging(), 'overcast', {}, rec('lit', 'field', 3, 5), rec('out', 'field', 4, 5), rec('in', 'hut', 2, 2));
      w.tick(79_000);
      w.drain();
      // 80 s: the front starts at the deepest tile, 14 steps, and reaches 12 at 81.4 s, 7 at 85 and 6 at 85.7.
      const early = run(w, 80_000, 81_000);
      expect(heard(early, 'in')).toEqual(none);
      const reached = run(w, 81_050, 86_000);
      expect(heard(reached, 'in')).toEqual({ pages: ['surges'], blanks: [] });
      expect(heard(reached, 'lit')).toEqual({ pages: ['surges'], blanks: [] });
      // Caught out in it: no page, until a street light stops the drain. Then that too.
      expect(heard(reached, 'out')).toEqual(none);
      w.step('out', 'left', 1, 86_050);
      const lit = run(w, 86_100, 86_500);
      expect(heard(lit, 'out')).toEqual({ pages: ['surges'], blanks: ['surge-light'] });
      // The one who sheltered there all along saw no drain stop.
      expect(heard(lit, 'lit')).toEqual(none);
    });

    it('opens the page on a storm out in it, and fills in its blank when a roof keeps it off', () => {
      // A round of 100 s: clear 70, a warning of 10, then 20 of storm.
      const w = world({ ...fieldData(12, { storm: { every: 100, warn: 10, length: 20 } }), exits: [...fieldData().exits, HUT_DOOR] }, 'overcast', {}, rec('a', 'field', 1, 2), rec('b', 'hut', 2, 2));
      w.tick(79_000);
      expect(heard(w.drain(), 'a')).toEqual(none);
      w.tick(81_000);
      const out = w.drain();
      expect(heard(out, 'a')).toEqual({ pages: ['storms'], blanks: [] });
      // Under the roof the whole storm, b never was out in it: nothing yet.
      expect(heard(out, 'b')).toEqual(none);
      w.step('a', 'up', 1, 82_000);
      expect(w.get('a')!.map).toBe('hut');
      w.tick(82_500);
      expect(heard(w.drain(), 'a')).toEqual({ pages: [], blanks: ['storm-roof'] });
    });

    it('opens the page on a flash that starts near you, and fills in its blank if you stand in it when it bursts', () => {
      // rng 0: a is picked, and the flash goes on 2,3, 2.8 tiles from a and next to b.
      const w = world(fieldData(12, { flashes: { every: 30, steps: [3, 99] } }), 'overcast', {}, rec('a', 'field', 4, 5), rec('b', 'field', 2, 4), rec('c', 'field', 8, 9));
      w.tick(0);
      w.tick(30_000);
      const started = w.drain();
      expect(heard(started, 'a')).toEqual({ pages: ['flashes'], blanks: [] });
      expect(heard(started, 'b')).toEqual({ pages: ['flashes'], blanks: [] });
      expect(heard(started, 'c')).toEqual(none);
      w.tick(38_001);
      const burst = w.drain();
      expect(heard(burst, 'b')).toEqual({ pages: [], blanks: ['flash-burst'] });
      expect(heard(burst, 'a')).toEqual(none);
    });

    it('opens the page on an aurora night out in the wilds, and fills in its blank by the dead wires humming at a pole', () => {
      const w = world(fieldData(12, { objects: [{ kind: 'pole', x: 7, y: 5 }] }), 'overcast', {}, rec('a', 'field', 4, 5), rec('b', 'town', 5, 6));
      w.tick(1000);
      expect(heard(w.drain(), 'a')).toEqual(none);
      w.setWeather('aurora', 2000);
      w.tick(2000);
      const out = w.drain();
      expect(heard(out, 'a')).toEqual({ pages: ['auroras'], blanks: [] });
      // In town, by a pole: the wires hum there too, but the aurora's page opens only out there.
      expect(heard(out, 'b')).toEqual(none);
      w.step('a', 'right', 1, 2100);
      w.tick(2400);
      expect(heard(w.drain(), 'a')).toEqual({ pages: [], blanks: ['aurora-hum'] });
    });

    it('opens the page on something clinging to you, and fills in its blank when it lets go', () => {
      const w = world(fieldData(HITCH_STEPS + 4), 'night', {}, rec('a', 'field', 4, 1, 'up', { bag: [{ item: 'flare', count: 1 }] }));
      w.tick(1000);
      expect(heard(w.drain(), 'a')).toEqual({ pages: ['hitchhikers'], blanks: [] });
      w.use('a', 0, 2000);
      expect(heard(w.drain(), 'a')).toEqual({ pages: [], blanks: ['hitch-lets-go'] });
    });

    it('opens the page on a watcher within sight, and fills in its blank when it freezes while you face it', () => {
      // One watcher, waking 12 or more steps from home: with rng 0, at 1,1, 5.8 tiles from a; b is too far to see it.
      const w = world(fieldData(12, { watchers: { count: 1, steps: [12, 99] } }), 'overcast', {}, rec('a', 'field', 4, 6, 'down'), rec('b', 'field', 8, 10, 'up'));
      w.tick(0);
      w.drain();
      w.tick(50);
      const seen = w.drain();
      expect(heard(seen, 'a')).toEqual({ pages: ['watchers'], blanks: [] });
      expect(heard(seen, 'b')).toEqual(none);
      w.face('a', 'up');
      w.tick(100);
      expect(heard(w.drain(), 'a')).toEqual({ pages: [], blanks: ['watcher-stops'] });
    });

    // One skulker, out at night, 8 steps from home or more; its lair the one fern tile, 4,3. a stands at 3,9,
    // steps right at 800 (heard, 6 away), then walks down; tall grass across row 13 ends the chase there.
    const skulking = (more: Partial<MapData> = {}) => withTiles(fieldData(40, { skulkers: { count: 1, steps: [8, 999], when: ['night'] }, ...more }), (r, y) => (y === 3 ? `${r.slice(0, 4)}f${r.slice(5)}` : y === 13 ? 'thhhhhhhht' : r));
    const walk = (w: World, stop: number) => (t: number) => {
      const dir = t === 800 ? 'right' : t >= 1000 && w.get('a')!.y < stop ? 'down' : undefined;
      if (dir && t % STEP_MS === 0) w.step('a', dir, t, t);
    };

    it('opens the page on a skulker chase you got out of, at the edge of the tall grass that ended it; the rustle before it went unnoticed', () => {
      const w = world(skulking(), 'night');
      w.tick(0);
      w.join(rec('a', 'field', 3, 9), 0);
      w.drain();
      const out = run(w, 50, 6000, walk(w, 13));
      expect(w.get('a')).toMatchObject({ x: 4, y: 13 });
      expect(of(to(out, 'a'), 'touched')).toEqual([]);
      // Hidden while it hunted, then free of it: both pages, and the tall grass's blank. The ferns rustled
      // before either was open. (A hitchhiker clung on too, this far out at night.)
      expect(heard(out, 'a')).toEqual({ pages: ['hitchhikers', 'tall-grass', 'skulkers'], blanks: ['grass-edge'] });
    });

    it('fills in the rustle for whoever has the page and is near enough to hear a chase start, you or not', () => {
      const w = world(skulking(), 'night');
      w.tick(0);
      // b stands in the grass at 6,13, hidden: it chases a, whose page is not open; b's is.
      w.join(rec('a', 'field', 3, 9), 0);
      w.join(rec('b', 'field', 6, 10, 'up', { notebook: { pages: ['skulkers'], blanks: [] } }), 0);
      w.join(rec('c', 'field', 6, 30, 'up', { notebook: { pages: ['skulkers'], blanks: [] } }), 0);
      w.drain();
      const out = run(w, 50, 1000, walk(w, 13));
      expect(of(to(out, 'a'), 'page').map(m => m.id)).not.toContain('skulkers');
      expect(heard(out, 'b').blanks).toEqual(['skulker-rustle']);
      expect(heard(out, 'c')).toEqual(none);
    });

    it('never counts a chase that ended in a catch as one you got out of', () => {
      const w = world(skulking(), 'night');
      w.tick(0);
      w.join(rec('a', 'field', 4, 6), 0);
      w.drain();
      const out = run(w, 50, 1500);
      expect(of(to(out, 'a'), 'touched')).toHaveLength(1);
      expect(heard(out, 'a').pages).not.toContain('skulkers');
    });

    it('fills in the blank on a live find that fades in your bag', () => {
      const def = ITEMS.items.find(i => i.id === 'live')!, ends = liveEnds(def, ITEMS.items.find(i => i.id === 'shard'));
      // In town, where nothing drains, so it has all the time it takes.
      const w = world(fieldData(), 'overcast', {}, rec('a', 'town', 1, 2, 'up', { bag: [{ item: 'live', count: 1, since: 0 }], notebook: { pages: ['live'], blanks: [] } }));
      w.tick((ends - 1) * 1000);
      expect(heard(w.drain(), 'a')).toEqual(none);
      w.tick((ends + 1) * 1000);
      expect(heard(w.drain(), 'a')).toEqual({ pages: [], blanks: ['live-fades'] });
    });

    it('fills in the Old Stone\'s blank for everyone online who has its page, when it wakes', () => {
      const shards = [{ item: 'shard', count: STONE_NEED }];
      const w = world(fieldData(), 'overcast', {}, rec('s', 'town', 3, 4, 'up', { bag: shards }), rec('a', 'field', 4, 5, 'up', { notebook: { pages: ['the-stone'], blanks: [] } }), rec('r', 'town', 6, 6));
      w.feed('s', 3, 3, 0, 1000, STONE_NEED - 1);
      expect(heard(w.drain(), 'a')).toEqual(none);
      w.feed('s', 3, 3, 0, 1000, 1);
      const out = w.drain();
      expect(heard(out, 'a')).toEqual({ pages: [], blanks: ['stone-wakes'] });
      expect(heard(out, 'r')).toEqual(none);
      // Its sign read later, its page opens with its blank still a question: that waking went unnoticed.
      w.talk('r', 6, 5, 2000);
      expect(heard(w.drain(), 'r')).toEqual({ pages: ['the-stone'], blanks: [] });
    });
  });

  it('welcomes you with your notebook, and keeps the pages and blanks a newer notebook wrote', () => {
    const w = world(fieldData(), 'overcast');
    const joined = w.join(rec('a', 'town', 0, 5, 'up', { notebook: { pages: ['moss', 'written-later'], blanks: ['from-later'] } }), 0);
    expect(joined.notebook).toEqual({ version: 3, pages: ['moss', 'written-later'], blanks: ['from-later'] });
    expect(w.join(rec('b', 'town', 1, 2), 0).notebook).toEqual({ version: 3, pages: [], blanks: [] });
    // Nothing yet stays nothing: a save without a notebook keeps what storage has.
    expect(w.get('b')!.notebook).toBeUndefined();
    w.talk('a', 0, 4, 1000);
    expect(w.get('a')!.notebook).toEqual({ pages: ['moss', 'written-later', 'the-sign'], blanks: ['from-later'] });
  });
});

describe('the field notes in storage', () => {
  it('are kept with the player in memory, and a save without them loses none', async () => {
    await keepsNotebook(new MemoryStorage());
  });
});

describe('the field notes over WebSockets', () => {
  const maps = () => [new TileMap(town()), new TileMap(houseData()), new TileMap(woodsData())];
  const items: ItemsData = { ...ITEMS, finds: [{ item: 'moss', map: 'woods', near: { kinds: ['fireplace'], radius: 1.5 }, count: 1, respawn: [10, 20] }] };
  const { ctx, enter } = setup({ maps: maps(), items, notebook: NOTEBOOK, weather: 'overcast' });

  it('welcomes you with your notebook and the version of the pages, and says when a page opens as you read a sign', async () => {
    const a = await enter({ map: 'town', x: 0, y: 5, dir: 'up', notebook: { pages: ['moss'], blanks: [] } });
    expect(a.welcome.notebook).toEqual({ version: 3, pages: ['moss'], blanks: [] });
    a.c.send({ t: 'talk', x: 0, y: 4 });
    expect(await a.c.next('page')).toEqual({ t: 'page', id: 'the-sign' });
    await waitFor(() => ctx.storage.get(a.id)?.notebook?.pages.includes('the-sign') ?? false, 'the page to be saved');
    expect(ctx.storage.get(a.id)!.notebook).toEqual({ pages: ['moss', 'the-sign'], blanks: [] });
  });

  it('opens a page as you pick up a find', async () => {
    const b = await enter({ map: 'woods', x: 4, y: 1 });
    expect(b.welcome.notebook).toEqual({ version: 3, pages: [], blanks: [] });
    const moss = b.welcome.finds.find(f => MOSS_TILES.some(t => t.x === f.x && t.y === f.y))!;
    b.c.send({ t: 'pick', x: moss.x, y: moss.y });
    expect(await b.c.next('page')).toEqual({ t: 'page', id: 'moss' });
    await waitFor(() => ctx.storage.get(b.id)?.notebook?.pages[0] === 'moss', 'the page to be saved');
  });
});
