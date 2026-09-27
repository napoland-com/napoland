/**
 * The story (story.ts): chapters reached one after another by what the game already asks, heard by
 * the player who reached them and saved at once. World rules, then the talk message and the welcome
 * over real WebSockets (net.ts).
 */
import { describe, expect, it } from 'vitest';
import { TileMap, type Dir, type ItemsData, type MapData, type ServerMsg, type StoryData } from '@napoland/shared';
import type { PlayerRecord } from '../src/storage';
import { World, colorFor, type Outgoing, type WorldOptions } from '../src/world';
import { houseData, townData, woodsData } from './fixtures';
import { setup, waitFor } from './helpers';

/** The fixture town with the Old Stone at 3,3, Mira at 0,4 (talk to her from 1,4) and a desk at 2,6 (read it from 2,5). */
function town(): MapData {
  const t = townData();
  return {
    ...t,
    objects: [
      ...t.objects,
      { kind: 'stone', x: 3, y: 3 },
      { kind: 'npc', id: 'mira', name: 'Mira', x: 0, y: 4, dir: 'right', lines: ['Heading out?'] },
      { kind: 'console', id: 'log', name: 'Log', x: 2, y: 6, text: ['Week 1: the hum again.'] },
    ],
  };
}
/** The fixture house (its fire is tended: its door opens onto the town), with a chest at 3,1: reach it from 3,2. */
function house(): MapData {
  const h = houseData();
  return { ...h, objects: [...h.objects, { kind: 'chest', x: 3, y: 1 }] };
}
/** The fixture woods with a campfire that burns down at 4,2 (reach it from 4,1). */
function woods(): MapData {
  const w = woodsData();
  return { ...w, objects: w.objects.map(o => (o.kind === 'fireplace' ? { kind: 'fireplace', x: o.x, y: o.y } : o)) };
}
const maps = () => [new TileMap(town()), new TileMap(house()), new TileMap(woods())];

const ITEMS: ItemsData = {
  version: 1,
  items: [
    { id: 'moss', name: 'Moss', kind: 'resource', stack: 10, text: 'Soft.', xp: 2 },
    { id: 'twig', name: 'Twig', kind: 'resource', stack: 10, text: 'Dry.', fuel: 120 },
    { id: 'shard', name: 'Shard', kind: 'resource', stack: 5, text: 'Warm.', charge: 1 },
  ],
  // Moss grows by the campfire, on 3,1, 4,1 or 5,1: all within reach of 4,1.
  finds: [{ item: 'moss', map: 'woods', near: { kinds: ['fireplace'], radius: 1.5 }, count: 1, respawn: [10, 20] }],
};

/** Every kind of thing that moves the story on, one chapter each. */
const STORY: StoryData = {
  version: 3,
  chapters: [
    { id: 'home', title: 'Home', text: 'You woke up at home.' },
    { id: 'stored', title: 'Stored', text: 'You brought something home.', when: { store: true } },
    { id: 'the-woods', title: 'The woods', text: 'You walked into the woods.', when: { reach: 'woods' } },
    { id: 'moss', title: 'Moss', text: 'You picked moss.', when: { pick: 'moss' } },
    { id: 'fed', title: 'Fed', text: 'You fed a fire.', when: { feed: 'fire' } },
    { id: 'mira', title: 'Mira', text: 'Mira told you.', when: { talk: 'mira' } },
    { id: 'the-log', title: 'The log', text: 'You read the log.', when: { read: 'log' } },
    { id: 'the-stone', title: 'The stone', text: 'You gave the stone a shard.', when: { feed: 'stone' } },
  ],
};

const rec = (id: string, map: string, x: number, y: number, story: string | undefined, more: Partial<PlayerRecord> = {}, dir: Dir = 'up'): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map, x, y, dir, color: colorFor(id), energy: 50, bag: [], createdAt: 1, lastSeenAt: 1,
  ...(story ? { story } : {}), ...more,
});

/** The world of the story, players joined at 0; joins and writes drained. */
function world(options: WorldOptions, ...players: PlayerRecord[]): World {
  const w = new World(maps(), 'town', 'overcast', { items: ITEMS, story: STORY, rng: () => 0, ...options });
  for (const p of players) w.join(p, 0);
  w.drain();
  w.takeWrites();
  return w;
}
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id ? [o.msg] : []));
const chapters = (out: Outgoing[], id: string) => to(out, id).filter((m): m is Extract<ServerMsg, { t: 'chapter' }> => m.t === 'chapter');
/** The chapter each player saved now is at. */
const saved = (w: World) => w.takeWrites().players.map(p => [p.id, p.story]);

describe('the story', () => {
  it('moves on when you bring something home: you hear the chapter, and it is saved at once', () => {
    const w = world({}, rec('a', 'house', 3, 2, undefined, { bag: [{ item: 'moss', count: 2 }] }));
    w.store('a', 3, 1, 0, 1000);
    expect(chapters(w.drain(), 'a')).toEqual([{ t: 'chapter', id: 'stored' }]);
    expect(saved(w)).toEqual([['a', 'stored']]);
    expect(w.get('a')!.story).toBe('stored');
    // The next chapter waits for the woods: bringing more home again moves nothing.
    w.store('a', 3, 1, 0, 2000);
    expect(chapters(w.drain(), 'a')).toEqual([]);
    expect(w.get('a')!.story).toBe('stored');
  });

  it('moves on when you walk onto the map the chapter waits for', () => {
    const w = world({}, rec('a', 'town', 4, 1, 'stored'), rec('b', 'town', 5, 1, 'home'));
    w.step('a', 'up', 1, 1000);
    w.step('b', 'up', 1, 1000);
    const out = w.drain();
    expect(chapters(out, 'a')).toEqual([{ t: 'chapter', id: 'the-woods' }]);
    // b is still in the first chapter: the woods are what the one after next waits for.
    expect(chapters(out, 'b')).toEqual([]);
    expect(w.get('b')).toMatchObject({ map: 'woods', story: 'home' });
  });

  it('moves on when you pick up what the chapter waits for', () => {
    const w = world({}, rec('a', 'woods', 4, 1, 'the-woods'));
    const moss = w.findViews('woods')[0]!;
    w.pick('a', moss.x, moss.y, 1000);
    expect(chapters(w.drain(), 'a')).toEqual([{ t: 'chapter', id: 'moss' }]);
  });

  it('moves on when you feed a fire out in the wilds; a fire someone tends takes nothing, and moves nothing', () => {
    const w = world({}, rec('a', 'house', 2, 2, 'moss', { bag: [{ item: 'twig', count: 2 }] }), rec('b', 'woods', 4, 1, 'moss', { bag: [{ item: 'twig', count: 2 }] }));
    w.feed('a', 2, 1, 0, 1000);
    w.feed('b', 4, 2, 0, 1000);
    const out = w.drain();
    expect(to(out, 'a')).toContainEqual({ t: 'refused', action: 'feed', reason: 'tended' });
    expect(chapters(out, 'a')).toEqual([]);
    expect(chapters(out, 'b')).toEqual([{ t: 'chapter', id: 'fed' }]);
  });

  it('moves on when you talk to the person, or read the desk, the chapter waits for, from next to them', () => {
    const w = world({}, rec('a', 'town', 1, 4, 'fed'), rec('far', 'town', 2, 4, 'fed'), rec('c', 'town', 2, 5, 'fed'), rec('b', 'town', 2, 5, 'mira'));
    // From two tiles away, and at a tile where nobody stands, nothing happens.
    w.talk('far', 0, 4, 1000);
    w.talk('a', 1, 3, 1000);
    // The desk is not what c's next chapter waits for: Mira is.
    w.talk('c', 2, 6, 1000);
    expect(w.drain()).toEqual([]);
    w.talk('a', 0, 4, 1000);
    w.talk('b', 2, 6, 1000);
    const out = w.drain();
    expect(chapters(out, 'a')).toEqual([{ t: 'chapter', id: 'mira' }]);
    expect(chapters(out, 'b')).toEqual([{ t: 'chapter', id: 'the-log' }]);
    expect(saved(w)).toEqual([['a', 'mira'], ['b', 'the-log']]);
  });

  it('hears a talk that came in behind steps still waiting in the queue once they are walked, from where they took you', () => {
    // A slow network bunched up the two steps that bring A next to Mira: the second still waits in the
    // queue when the talk comes in, and from two tiles away it would move nothing.
    const w = world({}, rec('a', 'town', 3, 4, 'fed', {}, 'left'));
    w.step('a', 'left', 1, 350);
    w.step('a', 'left', 2, 351);
    w.talk('a', 0, 4, 450);
    expect(chapters(w.drain(), 'a')).toEqual([]);
    w.tick(1000);
    expect(chapters(w.drain(), 'a')).toEqual([{ t: 'chapter', id: 'mira' }]);
    expect(saved(w)).toEqual([['a', 'mira']]);
  });

  it('moves on when you give the Old Stone a shard; at the latest chapter written, nothing moves you on', () => {
    const w = world({}, rec('a', 'town', 3, 4, 'the-log', { bag: [{ item: 'shard', count: 2 }] }));
    w.feed('a', 3, 3, 0, 1000);
    expect(chapters(w.drain(), 'a')).toEqual([{ t: 'chapter', id: 'the-stone' }]);
    w.feed('a', 3, 3, 0, 2000);
    expect(chapters(w.drain(), 'a')).toEqual([]);
    expect(w.get('a')!.story).toBe('the-stone');
  });

  it('welcomes you with the chapter you are in: the first if you never started', () => {
    const w = new World(maps(), 'town', 'overcast', { items: ITEMS, story: STORY });
    expect(w.join(rec('new', 'town', 1, 2, undefined), 0).story).toEqual({ version: 3, chapter: 'home' });
    expect(w.join(rec('old', 'town', 0, 5, 'mira'), 0).story).toEqual({ version: 3, chapter: 'mira' });
    expect(w.get('new')!.story).toBeUndefined();
  });

  it('keeps a chapter from a newer story as it is: past every chapter written here, and moved on no further', () => {
    const w = world({}, rec('a', 'house', 3, 2, 'written-later', { bag: [{ item: 'moss', count: 1 }] }));
    expect(w.join(rec('b', 'town', 1, 2, 'written-later'), 0).story).toEqual({ version: 3, chapter: 'the-stone' });
    w.store('a', 3, 1, 0, 1000);
    expect(chapters(w.drain(), 'a')).toEqual([]);
    expect(w.get('a')!.story).toBe('written-later');
    expect(saved(w)).toEqual([['a', 'written-later']]);
  });

  it('tells nobody anything without a story', () => {
    const w = world({ story: undefined }, rec('a', 'house', 3, 2, 'stored', { bag: [{ item: 'moss', count: 1 }] }));
    expect(w.join(rec('b', 'town', 1, 2, undefined), 0).story).toEqual({ version: 0, chapter: '' });
    w.store('a', 3, 1, 0, 1000);
    expect(chapters(w.drain(), 'a')).toEqual([]);
    expect(w.get('a')!.story).toBe('stored');
  });
});

describe('the story over WebSockets', () => {
  const { ctx, enter } = setup({ maps: maps(), items: ITEMS, story: STORY, weather: 'overcast' });

  it('welcomes you with where you are, and moves on when you talk to the person next to you', async () => {
    const a = await enter({ map: 'town', x: 1, y: 4, dir: 'left', story: 'fed' });
    expect(a.welcome.story).toEqual({ version: 3, chapter: 'fed' });
    a.c.send({ t: 'talk', x: 0, y: 4 });
    expect(await a.c.next('chapter')).toEqual({ t: 'chapter', id: 'mira' });
    await waitFor(() => ctx.storage.get(a.id)?.story === 'mira', 'the chapter to be saved');
  });

  it('welcomes a new player in the first chapter', async () => {
    const b = await enter({ map: 'town', x: 1, y: 2 });
    expect(b.welcome.story).toEqual({ version: 3, chapter: 'home' });
  });
});
