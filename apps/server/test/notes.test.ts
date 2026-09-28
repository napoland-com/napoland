/**
 * What people left behind (packages/shared/src/notes.ts): notes read like a sign, whose first read gives
 * NOTE_XP once (only at their time, for one written to show at night, in the rain or on a green night),
 * and keepsakes, each lying for every player alone until they bring it home, where it stays; the whole
 * set home makes the bar bigger. World rules first, then over real WebSockets.
 */
import { describe, expect, it } from 'vitest';
import { NOTE_XP, TileMap, keepsakeFindId, type Dir, type ItemsData, type MapData, type MapObject, type ServerMsg, type Weather } from '@napoland/shared';
import { MemoryStorage, type PlayerRecord } from '../src/storage';
import { World, colorFor, type Outgoing, type WorldOptions } from '../src/world';
import { houseData, townData, woodsData } from './fixtures';
import { keepsNotes, setup, waitFor } from './helpers';

const note = (id: string, x: number, y: number, more: Partial<Extract<MapObject, { kind: 'note' }>> = {}): MapObject => ({
  kind: 'note', id, by: 'ranger', name: 'Nailed to the pole', x, y, text: [`${id}.`], ...more,
});
/** The fixture town with a pole at 2,4 and a note on it: read it from 2,5, facing up. */
function town(): MapData {
  const t = townData();
  return { ...t, objects: [...t.objects, { kind: 'pole', x: 2, y: 4 }, note('on-the-pole', 2, 4)] };
}
/**
 * The fixture woods with a storm every 100 s (80 to 100 s into each round) and poles at 6,5 (a note
 * that shows at night), 1,6 (in the rain) and 1,5 (on a green night): read the first from 6,6 facing up,
 * the others from 2,6 and 2,5 facing left. A crate for whoever comes next stands at 3,4: open it from 3,5.
 */
function woods(): MapData {
  const w = woodsData();
  return {
    ...w, storm: { every: 100, warn: 10, length: 20 },
    objects: [
      ...w.objects, { kind: 'pole', x: 6, y: 5 }, { kind: 'pole', x: 1, y: 6 }, { kind: 'pole', x: 1, y: 5 }, { kind: 'cache', x: 3, y: 4, name: 'the crate' },
      note('in-the-dark', 6, 5, { when: 'night', faint: 'A greenish smear.' }), note('in-the-rain', 1, 6, { when: 'rain' }), note('when-green', 1, 5, { when: 'aurora' }),
    ],
  };
}
/** The fixture house with a chest at 3,1, beside the fireplace: stand at 3,2 facing up to reach it. */
function house(): MapData {
  const h = houseData();
  return { ...h, objects: [...h.objects, { kind: 'chest', x: 3, y: 1 }] };
}
const maps = () => [new TileMap(town()), new TileMap(house()), new TileMap(woods())];

/** Two keepsakes: the compass lies in the woods at 5,6 and the tag in town at 2,6; the whole set home adds 5 to the bar. */
const ITEMS: ItemsData = {
  version: 1,
  items: [
    { id: 'moss', name: 'Moss', kind: 'resource', stack: 10, xp: 1, text: 'Soft.' },
    { id: 'compass', name: 'Brass compass', kind: 'keepsake', stack: 1, xp: 2, text: 'It points at the woods.' },
    { id: 'tag', name: 'Pole tag', kind: 'keepsake', stack: 1, xp: 2, text: 'Stamped 16.' },
  ],
  finds: [],
  keepsakes: { energy: 5, places: [{ item: 'compass', map: 'woods', x: 5, y: 6 }, { item: 'tag', map: 'town', x: 2, y: 6 }] },
};
const COMPASS = { id: keepsakeFindId(0), item: 'compass', x: 5, y: 6 };
const TAG = { id: keepsakeFindId(1), item: 'tag', x: 2, y: 6 };

const rec = (id: string, map: string, x: number, y: number, dir: Dir = 'up', more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map, x, y, dir, color: colorFor(id), energy: 100, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});
/** Players join at 0; joins and writes drained. */
function world(weather: Weather, options: WorldOptions = {}, ...players: PlayerRecord[]): World {
  const w = new World(maps(), 'town', weather, { items: ITEMS, rng: () => 0, ...options });
  for (const p of players) w.join(p, 0);
  w.drain();
  w.takeWrites();
  return w;
}
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id || o.to === 'all' ? [o.msg] : []));
const of = <T extends ServerMsg['t']>(msgs: ServerMsg[], t: T) => msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
const read = (out: Outgoing[], id: string) => of(to(out, id), 'noteRead').map(m => m.id);

describe('notes people left', () => {
  it('give their XP the first time you read one, from next to it: heard, and saved at once', () => {
    const w = world('overcast', {}, rec('a', 'town', 2, 5), rec('far', 'town', 2, 7));
    w.talk('far', 2, 4, 1000);
    expect(read(w.drain(), 'far')).toEqual([]);
    w.talk('a', 2, 4, 1000);
    const out = w.drain();
    expect(read(out, 'a')).toEqual(['on-the-pole']);
    expect(of(to(out, 'a'), 'progress')).toEqual([{ t: 'progress', progress: expect.objectContaining({ xp: NOTE_XP }), gained: NOTE_XP }]);
    expect(w.takeWrites().players.map(p => [p.id, p.notes, p.xp])).toEqual([['a', ['on-the-pole'], NOTE_XP]]);
    // Read again, it says the same, and gives nothing.
    w.talk('a', 2, 4, 2000);
    expect(to(w.drain(), 'a')).toEqual([]);
    expect(w.get('a')!.xp).toBe(NOTE_XP);
  });

  it('show only in their time: glowing writing at night, wax in the rain or a storm, a shard\'s scratches on a green night', () => {
    const w = world('overcast', {}, rec('dark', 'woods', 6, 6), rec('wet', 'woods', 2, 6, 'left'), rec('green', 'woods', 2, 5, 'left'));
    const tryAll = (t: number) => {
      w.talk('dark', 6, 5, t);
      w.talk('wet', 1, 6, t);
      w.talk('green', 1, 5, t);
      const out = w.drain();
      return [...read(out, 'dark'), ...read(out, 'wet'), ...read(out, 'green')];
    };
    expect(tryAll(1000)).toEqual([]);
    w.setWeather('rain', 2000);
    expect(tryAll(2000)).toEqual(['in-the-rain']);
    w.setWeather('night', 3000);
    expect(tryAll(3000)).toEqual(['in-the-dark']);
    w.setWeather('aurora', 4000);
    expect(tryAll(4000)).toEqual(['when-green']);
    expect(w.get('dark')!.notes).toEqual(['in-the-dark']);
    // A storm wets the paper as the rain does: 80 to 100 s into each round of the woods' storms.
    const s = world('overcast', {}, rec('s', 'woods', 2, 6, 'left'));
    s.tick(85_000);
    s.drain();
    s.talk('s', 1, 6, 85_000);
    expect(read(s.drain(), 's')).toEqual(['in-the-rain']);
    // A green night is a night too: what glows in the dark shows.
    const g = world('aurora', {}, rec('g', 'woods', 6, 6));
    g.talk('g', 6, 5, 1000);
    expect(read(g.drain(), 'g')).toEqual(['in-the-dark']);
  });

  it('are in the welcome, ids a newer release wrote kept; nothing read stays nothing', () => {
    const w = world('overcast');
    const joined = w.join(rec('a', 'town', 2, 5, 'up', { notes: ['on-the-pole', 'written-later', 'on-the-pole'] }), 0);
    expect(joined.notes).toEqual(['on-the-pole', 'written-later']);
    expect(w.join(rec('b', 'town', 1, 2), 0).notes).toEqual([]);
    expect(w.get('b')!.notes).toBeUndefined();
  });
});

describe('keepsakes', () => {
  it('lie for every player alone, beside the zone\'s finds, until they pick theirs up', () => {
    const w = new World(maps(), 'town', 'overcast', { items: ITEMS, rng: () => 0 });
    const a = w.join(rec('a', 'woods', 5, 5, 'down'), 0), b = w.join(rec('b', 'woods', 4, 6, 'right'), 0);
    expect(a.finds).toEqual([COMPASS]);
    expect(b.finds).toEqual([COMPASS]);
    w.drain();
    w.pick('a', 5, 6, 1000);
    const out = w.drain();
    expect(of(to(out, 'a'), 'got')).toEqual([{ t: 'got', items: [{ item: 'compass', count: 1 }], from: 'find' }]);
    expect(of(to(out, 'a'), 'findGone')).toEqual([{ t: 'findGone', id: COMPASS.id }]);
    // Nobody else hears it go: b's still lies there, and b takes it too.
    expect(out.filter(o => o.to !== 'a' && o.msg.t === 'findGone')).toEqual([]);
    w.pick('b', 5, 6, 1000);
    expect(w.get('b')!.bag).toEqual([{ item: 'compass', count: 1 }]);
    // Carried, it no longer lies there: a second one is never there to pick up.
    w.pick('a', 5, 6, 2000);
    expect(of(to(w.drain(), 'a'), 'refused')).toEqual([{ t: 'refused', action: 'pick', reason: 'gone' }]);
    expect(w.get('a')!.bag).toEqual([{ item: 'compass', count: 1 }]);
  });

  it('come home for good at the chest, apart from the stash: their XP once, and the whole set makes the bar bigger', () => {
    const w = world('overcast', {}, rec('a', 'house', 3, 2, 'up', { bag: [{ item: 'compass', count: 1 }, { item: 'moss', count: 2 }, { item: 'tag', count: 1 }] }));
    w.store('a', 3, 1, 0, 1000);
    let out = to(w.drain(), 'a');
    expect(of(out, 'keepsake')).toEqual([{ t: 'keepsake', item: 'compass' }]);
    expect(of(out, 'progress').map(m => m.gained)).toEqual([2]);
    expect(of(out, 'chest').at(-1)!.stash).toEqual([]);
    expect(w.get('a')!.keepsakes).toEqual(['compass']);
    // One of two home: the bar is as it was.
    expect(of(out, 'energy').at(-1)?.energy.max ?? 100).toBe(100);
    w.store('a', 3, 1, undefined, 2000);
    out = to(w.drain(), 'a');
    expect(of(out, 'keepsake')).toEqual([{ t: 'keepsake', item: 'tag' }]);
    expect(of(out, 'progress').map(m => m.gained)).toEqual([4]);
    expect(of(out, 'chest').at(-1)!.stash).toEqual([{ item: 'moss', count: 2 }]);
    expect(of(out, 'energy').at(-1)!.energy.max).toBe(105);
    expect(w.get('a')).toMatchObject({ keepsakes: ['compass', 'tag'], bag: [], xp: 6 });
    // Home, they lie nowhere for them any more, and the welcome says they are home.
    const again = world('overcast');
    const joined = again.join(rec('a', 'woods', 5, 5, 'down', { keepsakes: ['compass', 'tag'] }), 0);
    expect(joined.finds).toEqual([]);
    expect(joined.keepsakes).toEqual(['compass', 'tag']);
    expect(joined.energy.max).toBe(105);
  });

  it('never fall into a pile: collapsing, you lose it to where it lay, and find it there again', () => {
    const w = world('overcast', {}, rec('a', 'woods', 5, 5, 'down', { energy: 0.01, bag: [{ item: 'compass', count: 1 }, { item: 'moss', count: 1 }] }));
    w.tick(10_000);
    w.drain();
    expect(w.takeWrites().drops[0]?.drop?.items).toEqual([{ item: 'moss', count: 1 }]);
    expect(w.get('a')!.bag).toEqual([]);
    // Nothing else in the bag: no pile at all.
    const alone = world('overcast', {}, rec('b', 'woods', 5, 5, 'down', { energy: 0.01, bag: [{ item: 'compass', count: 1 }] }));
    alone.tick(10_000);
    alone.drain();
    expect(alone.takeWrites().drops).toEqual([]);
    // Back in the woods, it lies where it did.
    const back = world('overcast');
    expect(back.join({ ...w.get('a')!, map: 'woods', x: 5, y: 5 }, 20_000).finds).toEqual([COMPASS]);
  });

  it('go back where they lay when thrown away, and never into a crate', () => {
    const w = world('overcast', {}, rec('a', 'woods', 3, 5, 'up', { bag: [{ item: 'compass', count: 1 }, { item: 'tag', count: 1 }] }));
    w.cacheLeave('a', 3, 4, 0, 1000);
    expect(of(to(w.drain(), 'a'), 'refused')).toEqual([{ t: 'refused', action: 'cacheLeave', reason: 'keepsake' }]);
    w.discard('a', 0, 2000);
    const out = to(w.drain(), 'a');
    // It lies on this map: you see it there again. The tag lies in town: nothing to see here.
    expect(of(out, 'find')).toEqual([{ t: 'find', find: COMPASS }]);
    w.discard('a', 0, 3000);
    expect(of(to(w.drain(), 'a'), 'find')).toEqual([]);
    expect(w.get('a')!.bag).toEqual([]);
  });

  it('are carried once: a second of one, or one home already, drops out of the bag as you join', () => {
    const w = world('overcast');
    w.join(rec('a', 'town', 1, 2, 'down', { keepsakes: ['tag'], bag: [{ item: 'compass', count: 1 }, { item: 'tag', count: 1 }, { item: 'compass', count: 1 }] }), 0);
    expect(w.get('a')!.bag).toEqual([{ item: 'compass', count: 1 }]);
  });

  it('keep shared finds off their tiles', () => {
    // Moss may grow on the compass's tile and one more; it always grows on the other.
    const items: ItemsData = { ...ITEMS, finds: [{ item: 'moss', map: 'woods', around: { x: 5, y: 6, r: 1 }, count: 1, respawn: [1, 1] }] };
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const w = world('overcast', { items, rng: () => r });
      expect(w.findViews('woods').map(f => `${f.x},${f.y}`)).not.toContain('5,6');
    }
  });
});

describe('notes and keepsakes in storage', () => {
  it('are kept with the player in memory, and a save without them loses none', async () => {
    await keepsNotes(new MemoryStorage());
  });
});

describe('notes and keepsakes over WebSockets', () => {
  const { ctx, enter } = setup({ maps: maps(), items: ITEMS, weather: 'overcast' });

  it('welcome you with the notes you read and the keepsakes home, and say when you read a new one', async () => {
    const a = await enter({ map: 'town', x: 2, y: 5, dir: 'up', notes: ['in-the-dark'], keepsakes: ['compass'] });
    expect(a.welcome.notes).toEqual(['in-the-dark']);
    expect(a.welcome.keepsakes).toEqual(['compass']);
    // The tag lies in town for them, beside the town's finds.
    expect(a.welcome.finds).toContainEqual(TAG);
    a.c.send({ t: 'talk', x: 2, y: 4 });
    expect(await a.c.next('noteRead')).toEqual({ t: 'noteRead', id: 'on-the-pole' });
    expect(await a.c.next('progress')).toMatchObject({ gained: NOTE_XP });
    await waitFor(() => ctx.storage.get(a.id)?.notes?.length === 2, 'the note to be saved');
    expect(ctx.storage.get(a.id)!.notes).toEqual(['in-the-dark', 'on-the-pole']);
  });

  it('pick up a keepsake and bring it home', async () => {
    const b = await enter({ map: 'town', x: 2, y: 5, dir: 'down' });
    b.c.send({ t: 'pick', x: 2, y: 6 });
    expect(await b.c.next('got')).toEqual({ t: 'got', items: [{ item: 'tag', count: 1 }], from: 'find' });
    expect(await b.c.next('findGone')).toEqual({ t: 'findGone', id: TAG.id });
  });
});
