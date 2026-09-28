/**
 * First finders (packages/shared/src/firsts.ts): the first player on the server to read a note or pick up
 * a keepsake is kept with it for good, and everyone online hears it; the welcome carries them all, and the
 * notice board the latest three. World rules first, then storage, then over real WebSockets.
 */
import { describe, expect, it } from 'vitest';
import { TileMap, keepsakeFindId, zoneDay, type Dir, type ItemsData, type MapData, type MapObject, type ServerMsg } from '@napoland/shared';
import { MemoryStorage, type FirstRecord, type PlayerRecord } from '../src/storage';
import { FIRSTS_ON_BOARD, World, colorFor, type Outgoing, type WorldOptions } from '../src/world';
import { houseData, townData, woodsData } from './fixtures';
import { keepsFirsts, setup, waitFor } from './helpers';

const note = (id: string, x: number, y: number): MapObject => ({ kind: 'note', id, by: 'ranger', name: 'Nailed to the pole', x, y, text: [`${id}.`] });
/** The fixture town with a note on a pole at 2,4 (read it from 2,5, facing up) and the notice board at 4,6 (read it from 4,7). */
function town(): MapData {
  const t = townData();
  return { ...t, objects: [...t.objects, { kind: 'pole', x: 2, y: 4 }, note('on-the-pole', 2, 4), { kind: 'board', x: 4, y: 6 }] };
}
/** The fixture woods with a note on a pole at 6,5 (read it from 6,6, facing up). */
function woods(): MapData {
  const w = woodsData();
  return { ...w, objects: [...w.objects, { kind: 'pole', x: 6, y: 5 }, note('in-the-woods', 6, 5)], places: [{ name: 'the campfire', x: 4, y: 3 }] };
}
const maps = () => [new TileMap(town()), new TileMap(houseData()), new TileMap(woods())];
const ITEMS: ItemsData = {
  version: 1,
  items: [{ id: 'compass', name: 'Brass compass', kind: 'keepsake', stack: 1, xp: 2, text: 'It points at the woods.' }],
  finds: [],
  keepsakes: { energy: 5, places: [{ item: 'compass', map: 'woods', x: 5, y: 6 }] },
};
/** Noon on 28 September 2026: day 3,052 of the Zone. */
const NOON = Date.UTC(2026, 8, 28, 12);

const rec = (id: string, map: string, x: number, y: number, dir: Dir = 'up', more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map, x, y, dir, color: colorFor(id), energy: 100, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});
function world(options: WorldOptions = {}, ...players: PlayerRecord[]): World {
  const w = new World(maps(), 'town', 'overcast', { items: ITEMS, rng: () => 0, epochOffset: NOON, ...options });
  for (const p of players) w.join(p, 0);
  w.drain();
  w.takeWrites();
  return w;
}
const firstsIn = (out: Outgoing[]) => out.flatMap(o => (o.msg.t === 'first' ? [{ to: o.to, first: o.msg.first }] : []));

describe('first finders', () => {
  it('keep the first to read a note, for good, and tell everyone online (a guest can be first)', () => {
    const w = world({ guests: true }, rec('ana', 'town', 2, 5), rec('bo', 'town', 3, 5), rec('cy', 'woods', 5, 5));
    w.talk('ana', 2, 4, 1000);
    expect(firstsIn(w.drain())).toEqual([{ to: 'all', first: { secret: 'note:on-the-pole', name: 'ANA', day: 3052 } }]);
    expect(w.takeWrites().firsts).toEqual([{ secret: 'note:on-the-pole', player: 'ana', name: 'ANA', day: 3052, at: NOON + 1000 }]);
    // Only the first: whoever reads it after is nobody's first.
    w.step('bo', 'left', 1, 1000);
    w.tick(2000);
    w.drain();
    w.talk('bo', 2, 4, 2000);
    const out = w.drain();
    expect(out.map(o => o.msg.t)).toContain('noteRead');
    expect(firstsIn(out)).toEqual([]);
    expect(w.takeWrites().firsts).toEqual([]);
  });

  it('keep the first to pick up a keepsake: each player finds their own, and only the first is anybody\'s first', () => {
    const w = world({}, rec('ana', 'woods', 5, 5, 'down'), rec('bo', 'woods', 4, 6, 'right'));
    w.pick('ana', 5, 6, 1000);
    expect(firstsIn(w.drain())).toEqual([{ to: 'all', first: { secret: 'keepsake:compass', name: 'ANA', day: zoneDay(NOON + 1000) } }]);
    w.pick('bo', 5, 6, 1000);
    const out = w.drain();
    expect(out.flatMap(o => (o.to === 'bo' && o.msg.t === 'findGone' ? [o.msg.id] : []))).toEqual([keepsakeFindId(0)]);
    expect(firstsIn(out)).toEqual([]);
  });

  it('are in every welcome, as saved: the first of each secret only', () => {
    const saved: FirstRecord[] = [
      { secret: 'note:in-the-woods', player: 'x', name: 'Ana', day: 3040, at: 1 },
      { secret: 'note:in-the-woods', player: 'y', name: 'Bo', day: 3041, at: 2 },
    ];
    const w = world({ firsts: saved });
    expect(w.join(rec('cy', 'town', 1, 2), 0).firsts).toEqual([{ secret: 'note:in-the-woods', name: 'Ana', day: 3040 }]);
    // A note found first before the restart stays found first.
    w.join(rec('dee', 'woods', 6, 6), 0);
    w.drain();
    w.talk('dee', 6, 5, 1000);
    expect(firstsIn(w.drain())).toEqual([]);
  });

  it('show on the notice board, the latest three, the latest first', () => {
    const at = (secret: string, name: string, day: number, t: number): FirstRecord => ({ secret, player: name.toLowerCase(), name, day, at: t });
    const w = world({
      firsts: [at('note:on-the-pole', 'Ana', 3040, 1), at('note:in-the-woods', 'Bo', 3045, 3), at('keepsake:compass', 'Cy', 3050, 4), at('note:written-later', 'Dee', 3051, 5)],
    }, rec('eve', 'town', 4, 7));
    w.board('eve', 4, 6, 1000);
    const board = w.drain().flatMap(o => (o.msg.t === 'board' ? o.msg.lines : []));
    // A secret this release does not know is left out, and the three before it shown.
    expect(board.slice(-FIRSTS_ON_BOARD)).toEqual([
      'First to find the brass compass: Cy, on day 3,050.',
      'First to read the ranger\'s note by the campfire: Bo, on day 3,045.',
      'First to read the ranger\'s note in Town: Ana, on day 3,040.',
    ]);
  });
});

describe('first finders in storage', () => {
  it('are kept in memory with the finder\'s name, never written over, and go with the player', async () => {
    await keepsFirsts(new MemoryStorage());
  });
});

describe('first finders over WebSockets', () => {
  const { enter } = setup({ maps: maps(), items: ITEMS, weather: 'overcast' });

  it('tell everyone online who read a note first, and welcome the ones after with it', async () => {
    const reader = await enter({ map: 'town', x: 2, y: 5, dir: 'up' });
    const other = await enter({ map: 'woods', x: 5, y: 5 });
    expect(reader.welcome.firsts).toEqual([]);
    reader.c.send({ t: 'talk', x: 2, y: 4 });
    const heard = (m: Extract<ServerMsg, { t: 'first' }>) => ({ secret: m.first.secret, name: m.first.name });
    expect(heard(await reader.c.next('first'))).toEqual({ secret: 'note:on-the-pole', name: reader.welcome.name });
    expect(heard(await other.c.next('first'))).toEqual({ secret: 'note:on-the-pole', name: reader.welcome.name });
    const late = await enter({ map: 'town', x: 1, y: 2 });
    await waitFor(() => late.welcome.firsts.length > 0, 'the first finder in the welcome');
    expect(late.welcome.firsts.map(f => f.name)).toEqual([reader.welcome.name]);
  });
});
