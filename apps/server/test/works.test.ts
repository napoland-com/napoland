/**
 * Mending the woods together (roadmap/trail-works.md), World rules: a street light of the works is like
 * any street light while it stands, and like none while it is dark: what clings to your back lets go in
 * it, and no watcher comes for whoever stands in it. Over real WebSockets: net-works.test.ts.
 *
 * A field (the fixture town's woods) HITCH_STEPS + 4 tiles tall (deep enough for a hitchhiker at its top), 8 wide inside the forest,
 * its way home in the middle of its bottom row, and the works' street light at its top, 4,1.
 */
import { describe, expect, it } from 'vitest';
import { ENERGY_MAX, TileMap, type Dir, type ItemsData, type MapData, type ServerMsg } from '@napoland/shared';
import { MemoryStorage, type PlayerRecord } from '../src/storage';
import { HITCH_STEPS, WATCHER_STEP_MS, World, colorFor, type Outgoing } from '../src/world';
import { houseData, townData } from './fixtures';
import { savedPlayer } from './helpers';

const H = HITCH_STEPS + 4;
function field(more: Partial<MapData> = {}): MapData {
  return {
    id: 'woods', name: 'The Field', version: 1, kind: 'wilds', depth: 1, width: 10, height: H,
    tiles: Array.from({ length: H }, (_, y) => (y === 0 ? 'tttttttttt' : y === H - 1 ? 'ttttgttttt' : 'tggggggggt')),
    levels: Array<string>(H).fill('0000000000'),
    spawn: { x: 4, y: H - 2, dir: 'up' },
    exits: [{ x: 4, y: H - 1, w: 1, h: 1, to: 'town', tx: 4, ty: 1, dir: 'down', home: true }],
    objects: [{ kind: 'lamp', x: 4, y: 1, works: 'field-light' }],
    ...more,
  };
}
const ITEMS: ItemsData = {
  version: 1, finds: [],
  items: [{ id: 'wire', name: 'Copper wire', noun: 'wire', plural: 'wire', kind: 'resource', stack: 20, text: 'Copper.' }],
  works: [{ id: 'field-light', build: 'light', name: 'the street light', where: 'at the top of the field', item: 'wire', need: 12, wear: 2, hold: 14 }],
};
/** A player on the field, signed in (on this server of sign-in, one nobody signed in with is a guest). */
const rec = (id: string, x: number, y: number, dir: Dir, more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: null, authSub: `dev:${id}@example.test`, map: 'woods', x, y, dir, color: colorFor(id), energy: ENERGY_MAX, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});
function world(data: MapData, weather: 'night' | 'overcast', ...players: PlayerRecord[]): World {
  const w = new World([new TileMap(townData()), new TileMap(houseData()), new TileMap(data)], 'town', weather, { items: ITEMS, rng: () => 0, guests: true });
  for (const p of players) w.join(p, 0);
  w.drain();
  return w;
}
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id || o.to === 'all' ? [o.msg] : []));
const onMap = (out: Outgoing[], map: string) => out.flatMap(o => ('map' in o && o.map === map ? [o.msg] : []));
const of = <T extends ServerMsg['t']>(msgs: ServerMsg[], t: T) => msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);

describe('a street light of the works', () => {
  it('keeps nothing off while it is dark; lit again, whatever clings to whoever stands in its light lets go, and nothing clings there', () => {
    // 4,3 is in its light (two tiles below it), and 26 steps from home: deep enough, in the dark.
    const w = world(field(), 'night', rec('a', 4, 3, 'up'), rec('g', 4, 2, 'up', { bag: [{ item: 'wire', count: 12 }] }));
    w.tick(1000);
    const dark = w.drain();
    expect(of(to(dark, 'a'), 'hitch')).toEqual([{ t: 'hitch', on: true }]);
    expect(of(to(dark, 'g'), 'hitch')).toEqual([{ t: 'hitch', on: true }]);
    w.bring('g', 4, 1, 0, 2000, 12);
    const lit = w.drain();
    expect(of(to(lit, 'g'), 'did')).toEqual([{ t: 'did', did: { kind: 'brought', works: 'field-light', item: 'wire', count: 12, view: { id: 'field-light', standing: true, held: 0, top: 'G' }, built: true } }]);
    expect(of(to(lit, 'a'), 'works')).toEqual([{ t: 'works', works: { id: 'field-light', standing: true, held: 0, top: 'G' } }]);
    w.tick(3000);
    const after = w.drain();
    expect(of(to(after, 'a'), 'hitch')).toEqual([{ t: 'hitch', on: false }]);
    expect(of(to(after, 'g'), 'hitch')).toEqual([{ t: 'hitch', on: false }]);
    for (let t = 4000; t < 30_000; t += 1000) w.tick(t);
    expect(of(to(w.drain(), 'a'), 'hitch')).toEqual([]);
  });

  it('lets no watcher come for whoever stands in its light while it stands; dark, one comes', () => {
    // One watcher, waking 20 or more steps from home: with these dice at 8,7, the first such tile far enough from a.
    const data = field({ watchers: { count: 1, steps: [20, 99] } });
    const watch = (lit: boolean) => {
      // Both with their backs to where it wakes, below them.
      const w = world(data, 'overcast', rec('a', 4, 3, 'up'), rec('g', 4, 2, 'up', { bag: [{ item: 'wire', count: 12 }] }));
      if (lit) w.bring('g', 4, 1, 0, 0, 12);
      w.drain();
      let steps = 0;
      for (let t = 0; t < 20; t++) {
        w.tick(t * WATCHER_STEP_MS);
        steps += of(onMap(w.drain(), 'woods'), 'creature').length;
      }
      return steps;
    };
    // Dark, it wakes and comes on; lit, it wakes and stays where it woke.
    expect(watch(false)).toBeGreaterThan(2);
    expect(watch(true)).toBe(1);
  });
});

describe('the plaque of a place mended together', () => {
  it('counts a guest\'s gift, but puts no guest\'s name on it: guests are forgotten, and their names with them', () => {
    const w = world(field(), 'overcast', rec('g', 4, 2, 'up', { authSub: null, tokenHash: 'hash-g', bag: [{ item: 'wire', count: 5 }] }), rec('s', 3, 1, 'right', { bag: [{ item: 'wire', count: 2 }] }));
    w.bring('g', 4, 1, 0, 1000, 5);
    expect(of(to(w.drain(), 'g'), 'did')).toEqual([{ t: 'did', did: { kind: 'brought', works: 'field-light', item: 'wire', count: 5, view: { id: 'field-light', standing: false, held: 5 } } }]);
    w.bring('s', 4, 1, 0, 2000, 2);
    expect(of(to(w.drain(), 's'), 'did')).toEqual([{ t: 'did', did: { kind: 'brought', works: 'field-light', item: 'wire', count: 2, view: { id: 'field-light', standing: false, held: 7, top: 'S' } } }]);
    expect(w.takeWrites().works).toEqual({ 'field-light': { standing: false, held: 7, day: 0, givers: [{ id: 's', name: 'S', count: 2 }] } });
  });

  it('is kept by the ids of who gave, never their names: each is named as their character is now, and one whose character is gone is left out', async () => {
    const storage = new MemoryStorage();
    const guest = await savedPlayer(storage, { lastSeenAt: 1 }), kept = await savedPlayer(storage, { tokenHash: null, authSub: `dev:kept-${Date.now()}@example.test` });
    await storage.saveWorks({ 'field-light': { standing: true, held: 3, day: 20_000, givers: [{ id: kept.id, name: 'An old name', count: 9 }, { id: guest.id, name: guest.name, count: 4 }] } });
    expect(await storage.loadWorks()).toEqual({ 'field-light': { standing: true, held: 3, day: 20_000, givers: [{ id: kept.id, name: kept.name, count: 9 }, { id: guest.id, name: guest.name, count: 4 }] } });
    // The guest, away too long, is deleted: their gift stays in what it holds, their name goes.
    expect(await storage.forgetGuests(Date.now())).toEqual([guest.id]);
    expect(await storage.loadWorks()).toEqual({ 'field-light': { standing: true, held: 3, day: 20_000, givers: [{ id: kept.id, name: kept.name, count: 9 }] } });
  });
});
