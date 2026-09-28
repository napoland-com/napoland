/**
 * Stonebrook wakes up (packages/shared/src/town.ts): the town the whole server shares. What it counts brings
 * people back for good, and what anyone gives at the ledger mends what is broken, for good; Walt swaps
 * surplus; scenes are told once, and kept. The World's rules first, then over real WebSockets.
 */
import { describe, expect, it } from 'vitest';
import { TileMap, xpFor, type Dir, type ItemsData, type MapData, type ServerMsg, type StoryData } from '@napoland/shared';
import { MemoryStorage, type PlayerRecord, type TownRecord } from '../src/storage';
import { STONE_NEED, STONE_SHARD_S, World, colorFor, type Outgoing, type WorldOptions } from '../src/world';
import { houseData, townData, woodsData } from './fixtures';
import { boardText, eventually, keepsTown, setup } from './helpers';

/**
 * The fixture town as it changes with the town (fixtures.ts has the rest):
 *
 *     0123456789
 *   0 ggggrrgggw
 *   1 gRggrrHHHw   H: the house next door (6,1), dark until Edith is home
 *   2 gSggrrHDHw
 *   3 !ggErrgggw   !: the town's sign (0,3), Pop. 23 until someone chalks over it; E: Edith (3,3), until she is home
 *   4 ggLgrrggLw   L: a street light (2,4), dark until the street lights are mended; the ledger (8,4),
 *   5 ggggrrgggw      given at from 8,5 facing up
 *   6 OPPggBggWw   O: the Old Stone (0,6), fed from 1,6 or 1,5; P: the porch over (2,6) and (3,6), once the
 *   7 gggggggggw      board has its roof; B: the notice board (5,6), read from 5,7; W: Walt (8,6), talked to
 *                     and swapped with from 8,7
 */
function town(): MapData {
  const t = townData();
  return {
    ...t,
    objects: [
      ...t.objects.map(o => (o.kind === 'house' ? { ...o, lit: 0 as const } : o)),
      { kind: 'sign', x: 0, y: 3, text: ['Town. Pop. 23'] },
      { kind: 'stone', x: 0, y: 6 },
      { kind: 'npc', id: 'edith', name: 'Edith', x: 3, y: 3, dir: 'down', lines: ['Waiting.'], town: { until: 'edith-home' } },
      { kind: 'npc', id: 'walt', name: 'Walt', x: 8, y: 6, dir: 'down', lines: ['Pull up a chair.'] },
      { kind: 'ledger', x: 8, y: 4 },
      { kind: 'lamp', x: 2, y: 4, town: { from: 'lights' } },
      { kind: 'porch', x: 2, y: 6, w: 2, h: 1, town: { from: 'roof' } },
      { kind: 'board', x: 5, y: 6 },
    ],
    town: { houses: [{ x: 6, y: 1, from: 'edith-home', lit: 1 }], sign: { x: 0, y: 3, pop: 23 } },
  };
}
/** The fixture house is Edith's: its hearth (2,1) cold until she is home, and she by it (3,2) then; talk to her from 3,3. */
function house(): MapData {
  const h = houseData();
  return {
    ...h,
    objects: [
      { kind: 'fireplace', x: 2, y: 1, town: { from: 'edith-home' } },
      { kind: 'npc', id: 'edith', name: 'Edith', x: 3, y: 2, dir: 'down', lines: ['Home.'], town: { from: 'edith-home' } },
    ],
    town: { names: [{ from: 'edith-home', name: 'Edith\'s house' }] },
  };
}
/** The fixture woods with a fire at 6,3 that burns down: fed from 6,4, 5,4 or 6,2. */
function woods(): MapData {
  const w = woodsData();
  return { ...w, objects: [...w.objects, { kind: 'fireplace', x: 6, y: 3 }] };
}
const maps = () => [new TileMap(town()), new TileMap(house()), new TileMap(woods())];

const ITEMS: ItemsData = {
  version: 1,
  items: [
    { id: 'shard', name: 'Anomaly shard', kind: 'resource', stack: 30, xp: 12, charge: 1, text: 'Warm.' },
    { id: 'resin', name: 'Fir resin', noun: 'resin', plural: 'resin', kind: 'resource', stack: 10, xp: 2, fuel: 60, text: 'Sticky.' },
    { id: 'glowcap', name: 'Glowcap', kind: 'resource', stack: 30, xp: 1, text: 'Glows.' },
    { id: 'cloth', name: 'Cloth scraps', noun: 'cloth', plural: 'cloth', kind: 'resource', stack: 10, xp: 2, text: 'Cloth.' },
    { id: 'scrap', name: 'Scrap metal', noun: 'scrap', plural: 'scrap', kind: 'resource', stack: 10, xp: 3, text: 'Scrap.' },
    { id: 'wire', name: 'Copper wire', noun: 'copper wire', plural: 'copper wire', kind: 'resource', stack: 10, xp: 4, text: 'Wire.' },
    { id: 'flare', name: 'Road flare', kind: 'consumable', stack: 3, xp: 3, text: 'Red.', use: { flare: 45 } },
  ],
  finds: [
    // The cloth the empty house holds moves to town once Edith is home: the same cloth, never both.
    { item: 'cloth', map: 'house', near: { kinds: ['hearth', 'fireplace'], radius: 1.5 }, count: 1, respawn: [1, 1], town: { until: 'edith-home' } },
    { item: 'cloth', map: 'town', around: { x: 1, y: 7, r: 0.5 }, count: 1, respawn: [1, 1], town: { from: 'edith-home' } },
  ],
  swaps: [
    { id: 'glowcaps-for-cloth', who: 'walt', give: { item: 'glowcap', count: 10 }, get: { item: 'cloth', count: 1 } },
    { id: 'scrap-for-flare', who: 'walt', give: { item: 'scrap', count: 5 }, get: { item: 'flare', count: 1 } },
  ],
  town: {
    pop: 23,
    milestones: [
      { id: 'edith-home', when: { count: 'woke', n: 1 }, back: 'Edith', title: 'Edith is home', text: 'A fire burns.' },
      { id: 'lodge-cook', when: { count: 'thanks', n: 2 }, back: 'Maud', title: 'Coffee', text: 'Maud cooks.' },
      { id: 'mill-stove', when: { count: 'fed', n: 3 }, back: 'Arvid', title: 'Smoke', text: 'Arvid is back.' },
    ],
    works: [
      { id: 'lights', name: 'The street lights', needs: [{ item: 'wire', count: 2 }, { item: 'scrap', count: 1 }], perk: 'The street is lit.', title: 'Lit', text: 'Lit.' },
      { id: 'roof', name: 'A roof over the board', needs: [{ item: 'cloth', count: 2 }], perk: 'Under it you dry off.', title: 'A roof', text: 'Dry.' },
    ],
  },
};

const rec = (id: string, map: string, x: number, y: number, dir: Dir = 'down', more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map, x, y, dir, color: colorFor(id), energy: 100, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});
/** A world on `on` (the maps above unless a test brings its own); players join at 0, joins and writes drained. */
function world(options: WorldOptions, players: PlayerRecord[], on: TileMap[] = maps()): World {
  const w = new World(on, 'town', 'overcast', { items: ITEMS, rng: () => 0, ...options });
  for (const p of players) w.join(p, 0);
  w.drain();
  w.takeWrites();
  return w;
}
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id || o.to === 'all' ? [o.msg] : []));
const all = (out: Outgoing[]) => out.flatMap(o => (o.to === 'all' ? [o.msg] : []));
const of = <T extends ServerMsg['t']>(msgs: ServerMsg[], t: T) => msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
const towns = (out: Outgoing[]) => all(out).filter(m => m.t === 'town');
/** What everyone in a zone heard. */
const inZone = (out: Outgoing[], key: string) => out.flatMap(o => ('map' in o && o.map === key ? [o.msg] : []));
const people = (m: TileMap) => m.data.objects.flatMap(o => (o.kind === 'npc' ? [`${o.id} ${o.x},${o.y}`] : []));
const shards = (n: number) => [{ item: 'shard', count: n }];

describe('the town comes to its milestones, for everyone', () => {
  it('brings Edith home the first time the Old Stone wakes: out of the street, by her own fire next door, and everyone hears it', () => {
    const on = maps();
    const w = world({}, [rec('a', 'town', 1, 6, 'left', { bag: shards(2 * STONE_NEED) }), rec('in', 'house', 2, 2, 'up', { energy: 50, bag: [{ item: 'resin', count: 1 }] })], on);
    // Her hearth is cold: nobody lights it for her, and it warms nobody.
    w.feed('in', 2, 1, 0, 1000);
    expect(of(to(w.drain(), 'in'), 'refused')).toEqual([{ t: 'refused', action: 'feed', reason: 'cold' }]);
    w.tick(1000);
    expect(w.get('in')!.energy).toBe(50);
    expect(people(on[0]!)).toContain('edith 3,3');

    w.feed('a', 0, 6, 0, 2000, STONE_NEED);
    const out = w.drain();
    // What the feed did first, then the town, to everyone online.
    expect(of(to(out, 'a'), 'did').map(m => m.did.kind)).toEqual(['stone']);
    expect(towns(out)).toEqual([{ t: 'town', town: { done: ['edith-home'], given: {} } }]);
    // Her fire burns in the room, and whoever is there warms by it.
    expect(inZone(out, 'house')).toContainEqual({ t: 'fire', fire: { x: 2, y: 1, left: null } });
    w.tick(12_000);
    expect(w.get('in')!.energy).toBeGreaterThan(50);
    // She is home by her fire, and gone from the street; the house next door is lit, the room is hers, and the sign is chalked over.
    expect(people(on[0]!)).toEqual(['walt 8,6']);
    expect(people(on[1]!)).toEqual(['edith 3,2']);
    expect(on[0]!.data.objects.find(o => o.kind === 'house')).toMatchObject({ lit: 1 });
    expect(on[1]!.data.name).toBe('Edith\'s house');
    expect(on[0]!.data.objects.find(o => o.kind === 'sign')).toMatchObject({ text: ['Town. Pop. 23', 'The 23 is crossed out in chalk. Beside it, in the same chalk: 24.'] });
    const kept = w.takeWrites().town!;
    expect(kept.counts).toEqual({ woke: 1 });
    expect(kept.done).toEqual([{ id: 'edith-home', day: expect.any(Number), at: 2000 }]);
    expect(w.townView()).toEqual({ done: ['edith-home'], given: {} });

    // Asleep again and woken again: counted, and nothing more comes of it.
    const later = 2000 + STONE_NEED * STONE_SHARD_S * 1000 + 1000;
    w.tick(later);
    w.drain();
    w.feed('a', 0, 6, 0, later + 1000, STONE_NEED);
    const again = w.drain();
    expect(of(to(again, 'a'), 'did').map(m => m.did)).toEqual([expect.objectContaining({ kind: 'stone', woke: true })]);
    expect(towns(again)).toEqual([]);
    expect(w.takeWrites().town?.counts).toEqual({ woke: 2 });
  });

  it('moves what the town has with it: the cloth the empty house held lies in town once Edith is home, and never both', () => {
    const w = world({}, [rec('a', 'town', 1, 5, 'down', { bag: shards(STONE_NEED) }), rec('in', 'house', 2, 3, 'up')]);
    const inside = () => w.findViews('house').map(f => f.item), outside = () => w.findViews('town').map(f => f.item);
    expect([inside(), outside()]).toEqual([['cloth'], []]);
    w.feed('a', 0, 6, 0, 1000, STONE_NEED);
    // Whoever is in either place sees it go, and come.
    const out = w.drain();
    expect(inZone(out, 'house').map(m => m.t)).toContain('findGone');
    expect(inZone(out, 'town').map(m => m.t)).toContain('find');
    expect([inside(), outside()]).toEqual([[], ['cloth']]);
    expect(w.findViews('town')[0]).toMatchObject({ x: 1, y: 7 });
  });

  it('counts the units fed to fires out there and the thanks given, and a count that reaches its number brings someone back', () => {
    const w = world({}, [rec('a', 'woods', 6, 4, 'up', { bag: [{ item: 'resin', count: 5 }] }), rec('b', 'woods', 5, 4, 'up'), rec('c', 'woods', 6, 2, 'down')]);
    w.feed('a', 6, 3, 0, 1000, 2);
    expect(towns(w.drain())).toEqual([]);
    w.feed('a', 6, 3, 0, 2000, 1);
    expect(towns(w.drain())).toEqual([{ t: 'town', town: { done: ['mill-stove'], given: {} } }]);
    // Two thanks, from two people, to whoever fed the fire.
    w.thank('b', 'a', { kind: 'fire', x: 6, y: 3 }, 3000);
    expect(towns(w.drain())).toEqual([]);
    w.thank('c', 'a', { kind: 'fire', x: 6, y: 3 }, 3000);
    expect(towns(w.drain())).toEqual([{ t: 'town', town: { done: ['mill-stove', 'lodge-cook'], given: {} } }]);
    expect(w.takeWrites().town).toMatchObject({ counts: { fed: 3, thanks: 2 } });
  });

  it('never counts a fire in town, which is tended', () => {
    const w = world({ town: { since: 0, counts: {}, given: {}, done: [{ id: 'edith-home', day: 1, at: 1 }] } }, [rec('in', 'house', 2, 2, 'up', { bag: [{ item: 'resin', count: 1 }] })]);
    w.feed('in', 2, 1, 0, 1000);
    expect(of(to(w.drain(), 'in'), 'refused')).toEqual([{ t: 'refused', action: 'feed', reason: 'tended' }]);
    expect(w.takeWrites().town).toBeUndefined();
  });

  it('keeps what it counted and came to across a restart, and the maps follow it from the start', () => {
    const saved: TownRecord = { since: 5, counts: { woke: 1, fed: 2 }, given: { lights: { wire: 1 } }, done: [{ id: 'edith-home', day: 3061, at: 9 }] };
    const on = maps();
    const w = world({ town: saved }, [rec('in', 'house', 2, 2, 'up', { energy: 50 }), rec('out', 'woods', 6, 4, 'up', { bag: [{ item: 'resin', count: 1 }] })], on);
    expect(w.townView()).toEqual({ done: ['edith-home'], given: { lights: { wire: 1 } } });
    // Her fire burns from the start, and the cloth lies in town, not in her house.
    expect(w.scene('house', 0).fires).toEqual([{ x: 2, y: 1, left: null }]);
    expect(people(on[1]!)).toEqual(['edith 3,2']);
    expect(w.findViews('house')).toEqual([]);
    expect(w.findViews('town').map(f => f.item)).toEqual(['cloth']);
    // Nothing to write until it changes; then it counts on from what was kept: one more unit fed out there is the third.
    expect(w.takeWrites().town).toBeUndefined();
    w.feed('out', 6, 3, 0, 1000);
    expect(towns(w.drain())).toEqual([{ t: 'town', town: { done: ['edith-home', 'mill-stove'], given: { lights: { wire: 1 } } } }]);
    expect(w.takeWrites().town).toMatchObject({ since: 5, counts: { woke: 1, fed: 3 } });
    // A town that starts counting now writes where it starts from.
    expect(new World(maps(), 'town', 'overcast', { items: ITEMS, now: 7 }).takeWrites().town).toEqual({ since: 7, counts: {}, given: {}, done: [] });
    // What a newer release came to stays; a count that is no count is none.
    const odd = new World(maps(), 'town', 'overcast', { items: ITEMS, town: { since: 5, counts: { woke: 1.5, fed: 2 }, given: {}, done: [{ id: 'long-gone', day: 1, at: 1 }] } });
    expect(odd.townView().done).toEqual(['long-gone']);
    odd.join(rec('a', 'town', 1, 6, 'left', { bag: shards(STONE_NEED) }), 0);
    odd.feed('a', 0, 6, 0, 1000, STONE_NEED);
    expect(odd.takeWrites().town?.counts).toEqual({ woke: 1, fed: 2 });
  });

  it('starts, for a play-test, with what TOWN_DONE names (only what the town has), and writes it', () => {
    const w = new World(maps(), 'town', 'overcast', { items: ITEMS, townDone: ['roof', 'no-such-thing'], now: 1000 });
    expect(w.townView().done).toEqual(['roof']);
    expect(w.takeWrites().town?.done.map(d => d.id)).toEqual(['roof']);
  });

  it('is in the welcome, with the world\'s clock', () => {
    const w = new World(maps(), 'town', 'overcast', { items: ITEMS, epochOffset: 5000 });
    const joined = w.join(rec('a', 'town', 1, 5), 100);
    expect(joined.town).toEqual({ done: [], given: {} });
    expect(joined.clock).toBe(5100);
  });

  it('never changes when the items have no town', () => {
    const { town: _town, ...bare } = ITEMS;
    const w = world({ items: bare }, [rec('a', 'town', 1, 6, 'left', { bag: shards(STONE_NEED) })]);
    w.feed('a', 0, 6, 0, 1000, STONE_NEED);
    expect(towns(w.drain())).toEqual([]);
    expect(w.townView()).toEqual({ done: [], given: {} });
  });
});

describe('the town\'s ledger', () => {
  const giver = (bag: PlayerRecord['bag'], more: Partial<PlayerRecord> = {}) => rec('a', 'town', 8, 5, 'up', { bag, ...more });

  it('takes what a work still wants, from next to it, and tells everyone the town as it stands before what it did', () => {
    const w = world({}, [giver([{ item: 'wire', count: 3 }, { item: 'scrap', count: 1 }]), rec('b', 'town', 1, 5)]);
    w.give('a', 8, 4, 'lights', 'wire', 5, 1000);
    const out = w.drain();
    // Never more than it wants.
    expect(w.get('a')!.bag).toEqual([{ item: 'wire', count: 1 }, { item: 'scrap', count: 1 }]);
    expect(to(out, 'a').filter(m => m.t === 'town' || m.t === 'did')).toEqual([
      { t: 'town', town: { done: [], given: { lights: { wire: 2 } } } }, { t: 'did', did: { kind: 'gave', work: 'lights', item: 'wire', count: 2 } },
    ]);
    expect(of(to(out, 'b'), 'town')).toEqual([{ t: 'town', town: { done: [], given: { lights: { wire: 2 } } } }]);
    // It wants no more wire; the scrap is the last of what it needs, and does it.
    w.give('a', 8, 4, 'lights', 'wire', 1, 2000);
    expect(of(to(w.drain(), 'a'), 'refused')).toEqual([{ t: 'refused', action: 'give', reason: 'not_needed' }]);
    w.give('a', 8, 4, 'lights', 'scrap', 1, 3000);
    const done = w.drain();
    expect(of(to(done, 'a'), 'did')).toEqual([{ t: 'did', did: { kind: 'gave', work: 'lights', item: 'scrap', count: 1, done: true } }]);
    expect(of(to(done, 'b'), 'town')).toEqual([{ t: 'town', town: { done: ['lights'], given: {} } }]);
    const kept = w.takeWrites().town!;
    expect(kept.done).toEqual([{ id: 'lights', day: expect.any(Number), at: 3000 }]);
    expect(kept.given).toEqual({});
    // Done for good: it takes nothing more.
    w.give('a', 8, 4, 'lights', 'wire', 1, 4000);
    expect(of(to(w.drain(), 'a'), 'refused')).toEqual([{ t: 'refused', action: 'give', reason: 'not_needed' }]);
  });

  it('says no from afar, for a work it does not have, for what a work does not want, and for what you do not carry', () => {
    const w = world({}, [giver([{ item: 'wire', count: 2 }]), rec('far', 'town', 1, 5, 'down', { bag: [{ item: 'wire', count: 2 }] })]);
    w.give('far', 8, 4, 'lights', 'wire', 1, 1000);
    w.give('a', 8, 4, 'nothing', 'wire', 1, 1000);
    w.give('a', 8, 4, 'roof', 'wire', 1, 1000);
    w.give('a', 8, 4, 'lights', 'scrap', 1, 1000);
    // Walt is next to them, and no ledger.
    w.give('a', 8, 6, 'lights', 'wire', 1, 1000);
    const out = w.drain();
    expect(of(to(out, 'far'), 'refused').map(m => m.reason)).toEqual(['too_far']);
    expect(of(to(out, 'a'), 'refused').map(m => m.reason)).toEqual(['gone', 'not_needed', 'empty_slot', 'too_far']);
    expect(w.get('a')!.bag).toEqual([{ item: 'wire', count: 2 }]);
    expect(w.takeWrites().town).toBeUndefined();
  });

  it('uses up what it takes: what came out of the stash is owed no more', () => {
    const w = world({}, [giver([{ item: 'cloth', count: 2 }], { stash: { items: {}, out: { cloth: 2 } } })]);
    w.give('a', 8, 4, 'roof', 'cloth', 2, 1000);
    expect(w.get('a')!.stash!.out).toEqual({});
    expect(w.takeWrites().players.map(p => p.id)).toEqual(['a']);
  });

  it('mends the street lights for good: the lamp lights the tiles around it', () => {
    const on = maps();
    const w = world({}, [giver([{ item: 'wire', count: 2 }, { item: 'scrap', count: 1 }])], on);
    expect(on[0]!.lit(2, 5)).toBe(false);
    w.give('a', 8, 4, 'lights', 'wire', 2, 1000);
    w.give('a', 8, 4, 'lights', 'scrap', 1, 1000);
    expect(on[0]!.lit(2, 5)).toBe(true);
  });

  it('builds the roof over the board for good: under it the rain keeps off, and you dry off', () => {
    const w = world({}, [giver([{ item: 'cloth', count: 2 }]), rec('wet', 'town', 2, 6, 'up', { wet: 0.5 })]);
    w.setWeather('rain', 500);
    // In the rain, out in the open: it soaks you, even in town.
    expect(of(to(w.drain(), 'wet'), 'energy').at(-1)!.body.wetRate).toBeGreaterThan(0);
    w.give('a', 8, 4, 'roof', 'cloth', 2, 1000);
    expect(of(to(w.drain(), 'wet'), 'energy').at(-1)!.body.wetRate).toBeLessThan(0);
  });

  it('tells the notice board who is back, and what the ledger still wants or has mended', () => {
    const saved: TownRecord = { since: 0, counts: { woke: 1 }, given: { lights: { wire: 1 } }, done: [{ id: 'edith-home', day: 3061, at: 1 }] };
    const w = world({ town: saved }, [rec('a', 'town', 5, 7, 'up')]);
    w.board('a', 5, 6, 1000);
    const lines = boardText(of(to(w.drain(), 'a'), 'board')[0]!, ITEMS);
    expect(lines).toContain('Back in town: Edith, since day 3,061.');
    expect(lines).toContain('The town\'s ledger at the lodge wants 1 copper wire and 1 scrap for the street lights; 2 cloth for a roof over the board.');
    expect(lines.join(' ')).not.toMatch(/Mended/);
    const later = world({ town: { ...saved, done: [...saved.done, { id: 'roof', day: 3062, at: 2 }] } }, [rec('a', 'town', 5, 7, 'up')]);
    later.board('a', 5, 6, 1000);
    const now = boardText(of(to(later.drain(), 'a'), 'board')[0]!, ITEMS);
    expect(now).toContain('The town\'s ledger at the lodge wants 1 copper wire and 1 scrap for the street lights.');
    expect(now).toContain('Mended for good: a roof over the board.');
  });
});

describe('Walt\'s swaps', () => {
  const at = (bag: PlayerRecord['bag'], more: Partial<PlayerRecord> = {}) => rec('a', 'town', 8, 7, 'up', { bag, ...more });

  it('makes a swap as many times over as asked and carried, next to him, and says what it did', () => {
    const w = world({}, [at([{ item: 'glowcap', count: 25 }, { item: 'scrap', count: 5 }])]);
    w.swapWith('a', 8, 6, 'glowcaps-for-cloth', 3, 1000);
    // Twenty-five glowcaps go twice into ten: two cloth, five glowcaps left.
    expect(w.get('a')!.bag).toEqual([{ item: 'glowcap', count: 5 }, { item: 'scrap', count: 5 }, { item: 'cloth', count: 2 }]);
    expect(of(to(w.drain(), 'a'), 'did')).toEqual([{ t: 'did', did: { kind: 'swapped', swap: 'glowcaps-for-cloth', count: 2 } }]);
    w.swapWith('a', 8, 6, 'scrap-for-flare', 1, 2000);
    expect(w.get('a')!.bag).toEqual([{ item: 'glowcap', count: 5 }, { item: 'cloth', count: 2 }, { item: 'flare', count: 1 }]);
    expect(w.takeWrites().players.map(p => p.id)).toEqual(['a']);
  });

  it('says why not: too few to swap, no such swap, not next to him, no room for what comes back', () => {
    const w = world({}, [at([{ item: 'glowcap', count: 9 }])]);
    w.swapWith('a', 8, 6, 'glowcaps-for-cloth', 1, 1000);
    w.swapWith('a', 8, 6, 'no-such-swap', 1, 1000);
    w.swapWith('a', 7, 6, 'glowcaps-for-cloth', 1, 1000);
    expect(of(to(w.drain(), 'a'), 'refused').map(m => m.reason)).toEqual(['missing', 'gone', 'too_far']);
    const full = world({}, [at([{ item: 'scrap', count: 6 }, ...Array.from({ length: 7 }, () => ({ item: 'glowcap', count: 30 }))])]);
    full.swapWith('a', 8, 6, 'scrap-for-flare', 1, 1000);
    expect(of(to(full.drain(), 'a'), 'refused').map(m => m.reason)).toEqual(['bag_full']);
    // Swapping the last five frees their slot for what comes back.
    const last = world({}, [at([{ item: 'scrap', count: 5 }, ...Array.from({ length: 7 }, () => ({ item: 'glowcap', count: 30 }))])]);
    last.swapWith('a', 8, 6, 'scrap-for-flare', 1, 1000);
    expect(last.get('a')!.bag.at(-1)).toEqual({ item: 'flare', count: 1 });
  });

  it('never earns XP twice: what was given out of the stash makes what comes back owed', () => {
    const w = world({}, [at([{ item: 'glowcap', count: 10 }], { stash: { items: {}, out: { glowcap: 10 } } })]);
    w.swapWith('a', 8, 6, 'glowcaps-for-cloth', 1, 1000);
    expect(w.get('a')!.stash!.out).toEqual({ cloth: 1 });
  });
});

describe('scenes, told once', () => {
  const STORY: StoryData = {
    version: 1,
    chapters: [{ id: 'home', title: 'Home', text: 'Home.' }],
    scenes: [
      { id: 'walt-hum', who: 'walt', title: 'The hum', when: { level: 2, notes: ['walt-n10'] }, lines: ['It hummed.'] },
      { id: 'edith-home', who: 'edith', title: 'Home', when: { town: 'edith-home' }, lines: ['I came home.'] },
    ],
  };

  it('are kept told when the player talks to the person after they opened, and saved at once; not before', () => {
    const w = world({ story: STORY }, [
      rec('a', 'town', 8, 7, 'up', { xp: xpFor(2), notes: [] }), rec('b', 'town', 8, 7, 'up', { xp: xpFor(2), notes: ['walt-n10'] }), rec('c', 'town', 8, 7, 'up', { notes: ['walt-n10'] }),
    ]);
    w.talk('a', 8, 6, 1000);
    w.talk('c', 8, 6, 1000);
    expect([w.get('a')!.stats?.scenes, w.get('c')!.stats?.scenes]).toEqual([undefined, undefined]);
    expect(w.takeWrites().players).toEqual([]);
    w.talk('b', 8, 6, 1000);
    expect(w.get('b')!.stats?.scenes).toBe(1);
    expect(w.takeWrites().players.map(p => [p.id, p.stats?.scenes])).toEqual([['b', 1]]);
    // Told: talking again tells nothing more.
    w.talk('b', 8, 6, 2000);
    expect(w.takeWrites().players).toEqual([]);
  });

  it('wait for what the town comes to', () => {
    const before = world({ story: STORY }, [rec('a', 'house', 3, 3, 'up')]);
    before.talk('a', 3, 2, 1000);
    expect(before.get('a')!.stats?.scenes).toBeUndefined();
    const w = world({ story: STORY, town: { since: 0, counts: {}, given: {}, done: [{ id: 'edith-home', day: 1, at: 1 }] } }, [rec('a', 'house', 3, 3, 'up')]);
    w.talk('a', 3, 2, 1000);
    expect(w.get('a')!.stats?.scenes).toBe(2);
  });
});

describe('the town over the network', () => {
  const { ctx, enter } = setup(() => ({ maps: maps(), items: ITEMS, weather: 'overcast' }));

  it('welcomes with the town and the world\'s clock, tells everyone what anyone gives at the ledger, and keeps it', async () => {
    const a = await enter({ map: 'town', x: 8, y: 5, dir: 'up', bag: [{ item: 'wire', count: 2 }] });
    const b = await enter({ map: 'town', x: 1, y: 5 });
    expect(a.welcome.town).toEqual({ done: [], given: {} });
    expect(Math.abs(a.welcome.clock - Date.now())).toBeLessThan(60_000);
    a.c.send({ t: 'give', x: 8, y: 4, work: 'lights', item: 'wire', count: 2 });
    expect(await a.c.next('did')).toEqual({ t: 'did', did: { kind: 'gave', work: 'lights', item: 'wire', count: 2 } });
    expect(await b.c.next('town')).toEqual({ t: 'town', town: { done: [], given: { lights: { wire: 2 } } } });
    await eventually(async () => expect((await ctx.storage.loadTown())?.given).toEqual({ lights: { wire: 2 } }), 'the town to be saved');
  });

  it('makes Walt\'s swaps', async () => {
    const a = await enter({ map: 'town', x: 8, y: 7, dir: 'up', bag: [{ item: 'glowcap', count: 20 }] });
    a.c.send({ t: 'swap', x: 8, y: 6, swap: 'glowcaps-for-cloth', count: 2 });
    expect(await a.c.next('did')).toEqual({ t: 'did', did: { kind: 'swapped', swap: 'glowcaps-for-cloth', count: 2 } });
    a.c.send({ t: 'swap', x: 8, y: 6, swap: 'glowcaps-for-cloth' });
    expect(await a.c.next('refused')).toEqual({ t: 'refused', action: 'swap', reason: 'missing' });
  });

  it('closes on a give or a swap that breaks the rules of the protocol', async () => {
    for (const bad of [
      { t: 'give', x: 8, y: 4, work: 'lights', item: 'wire', count: 0 }, { t: 'give', x: 8, y: 4, work: '', item: 'wire' }, { t: 'give', x: 8, y: 4, work: 'lights' },
      { t: 'swap', x: 8, y: 6, swap: 'glowcaps-for-cloth', count: 100 }, { t: 'swap', x: 8, y: 6 },
    ]) {
      const a = await enter({ map: 'town', x: 8, y: 5, dir: 'up', bag: [{ item: 'wire', count: 2 }] });
      a.c.send(JSON.stringify(bad));
      expect(await a.c.next('error')).toMatchObject({ code: 'bad_message' });
      expect((await a.c.closed).code).toBe(1008);
    }
  });
});

describe('storing the town', () => {
  it('keeps it in memory, whole, as the last save wrote it', async () => {
    await keepsTown(new MemoryStorage());
  });
});
