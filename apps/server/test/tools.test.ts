/**
 * Tools each player owns (items.ts, World.giveTool): the starter tools for a player from before, a tool
 * made at the workbench or picked up for good (never into the bag, the stash or a pile), a second one
 * refused. World rules, then over real WebSockets with storage in memory.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STARTER_TOOLS, TileMap, type Dir, type ItemDef, type ItemsData, type ServerMsg, type StoryData } from '@napoland/shared';
import { MemoryStorage, type PlayerRecord } from '../src/storage';
import { World, colorFor, type Outgoing, type WorldOptions } from '../src/world';
import { fixtureMaps, houseData } from './fixtures';
import { setup, waitFor } from './helpers';

/** The fixture house with a workbench at 1,1 (stand at 1,2, facing up). */
const house = () => {
  const h = houseData();
  return new TileMap({ ...h, objects: [...h.objects, { kind: 'workbench', x: 1, y: 1 }] });
};
const maps = () => [...fixtureMaps().filter(m => m.data.id !== 'house'), house()];

const tool = (id: string, name: string): ItemDef => ({ id, name, kind: 'tool', stack: 1, icon: 'map', text: 'Yours for good.' });
/**
 * Nails to pay with, moss by the campfire, the three starter maps, and a radio (a tool made up for the
 * tests): made at the workbench from two nails, and lying on one tile of the woods, 5,5, where it grows
 * back 10 to 20 s after someone takes it.
 */
const ITEMS: ItemsData = {
  version: 1,
  items: [
    { id: 'nail', name: 'Nail', kind: 'resource', stack: 5, text: 'Bent, but it will do.' },
    { id: 'moss', name: 'Moss', kind: 'resource', stack: 3, text: 'Soft and damp.' },
    tool('stonebrook-map', 'Map of Stonebrook'), tool('near-woods-map', 'Map of the Near Woods'), tool('south-road-map', 'Map of the South Road'),
    tool('radio', 'Radio'),
  ],
  finds: [
    { item: 'radio', map: 'woods', around: { x: 5, y: 5, r: 0 }, count: 1, respawn: [10, 20] },
    { item: 'moss', map: 'woods', near: { kinds: ['fireplace'], radius: 1.5 }, count: 1, respawn: [10, 20] },
  ],
  recipes: [
    { id: 'radio', make: 'radio', needs: [{ item: 'nail', count: 2 }] },
    { id: 'map', make: 'near-woods-map', needs: [{ item: 'nail', count: 1 }] },
  ],
};
const STORY: StoryData = {
  version: 1,
  chapters: [
    { id: 'home', title: 'Home', text: 'You woke up at home.' },
    { id: 'the-radio', title: 'The radio', text: 'You found a radio.', when: { pick: 'radio' } },
  ],
};
const WITH_RADIO = [...STARTER_TOOLS, 'radio'];

const rec = (id: string, map: string, x: number, y: number, more: Partial<PlayerRecord> = {}, dir: Dir = 'up'): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map, x, y, dir, color: colorFor(id), energy: 100, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});
/** The world of the tests, with dice that always roll 0: players joined at 0, joins and writes drained. */
function world(options: WorldOptions = {}, ...players: PlayerRecord[]): World {
  const w = new World(maps(), 'town', 'overcast', { items: ITEMS, rng: () => 0, ...options });
  for (const p of players) w.join(p, 0);
  w.drain();
  w.takeWrites();
  return w;
}
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id ? [o.msg] : []));
const onMap = (out: Outgoing[], map: string): ServerMsg[] => out.flatMap(o => ('map' in o && o.map === map ? [o.msg] : []));
const radioIn = (w: World) => w.findViews('woods').find(f => f.item === 'radio');

describe('the tools a player owns', () => {
  it('are the starter tools for a player from before, who never got one: nothing is written for them', () => {
    const w = world();
    const joined = w.join(rec('a', 'town', 1, 2), 0);
    expect(joined.tools).toEqual([...STARTER_TOOLS]);
    expect(joined.bag).toEqual([]);
    expect(w.get('a')!.tools).toBeUndefined();
    expect(w.takeWrites().players).toEqual([]);
  });

  it('are the saved list otherwise, in the order they came; ids that are no tool here stay in the save, and what is no list was never set', () => {
    const w = world();
    expect(w.join(rec('a', 'town', 1, 2, { tools: ['radio', 'near-woods-map', 'bolt-cutters', 'radio'] }), 0).tools).toEqual(['radio', 'near-woods-map']);
    // A newer release's tool (one rolled back) is kept for when it is back.
    expect(w.get('a')!.tools).toEqual(['radio', 'near-woods-map', 'bolt-cutters']);
    expect(w.join(rec('b', 'town', 1, 2, { tools: { radio: true } as never }), 0).tools).toEqual([...STARTER_TOOLS]);
    expect(w.get('b')!.tools).toBeUndefined();
  });

  it('come through giveTool, only to someone online, only a tool and only once: the list heard and saved at once', () => {
    const w = world({}, rec('a', 'town', 1, 2));
    expect(w.giveTool('nobody', 'radio')).toBe(false);
    expect(w.giveTool('a', 'nail')).toBe(false);
    expect(w.giveTool('a', 'nothing')).toBe(false);
    // One of the starter tools: theirs already.
    expect(w.giveTool('a', 'near-woods-map')).toBe(false);
    expect(w.drain()).toEqual([]);
    expect(w.takeWrites().players).toEqual([]);

    expect(w.giveTool('a', 'radio')).toBe(true);
    // How it came is the caller's to say (a find floats, the workbench says it in the text box).
    expect(w.drain()).toEqual([{ to: 'a', msg: { t: 'tools', tools: WITH_RADIO } }]);
    // The first of their own writes down the starter tools with it. The bag and the stash never see it.
    expect(w.takeWrites().players.map(p => p.tools)).toEqual([WITH_RADIO]);
    expect(w.get('a')).toMatchObject({ bag: [], stash: { items: {}, out: {} }, tools: WITH_RADIO });
    expect(w.giveTool('a', 'radio')).toBe(false);
    expect(w.drain()).toEqual([]);
  });
});

describe('making a tool at the workbench', () => {
  it('pays from the stash and gives it for good, never into the stash: the tools, the bench, then what it did; saved at once', () => {
    const w = world({}, rec('a', 'house', 1, 2, { stash: { items: { nail: 3 }, out: {} } }));
    w.craft('a', 1, 1, 'radio', 1000);
    expect(to(w.drain(), 'a')).toEqual([
      { t: 'tools', tools: WITH_RADIO },
      { t: 'bench', stash: [{ item: 'nail', count: 1 }] },
      // The client says where it went from the item's kind; nothing floats for it.
      { t: 'did', did: { kind: 'made', item: 'radio', count: 1 } },
    ]);
    expect(w.takeWrites().players.map(p => [p.tools, p.stash])).toEqual([[WITH_RADIO, { items: { nail: 1 }, out: {} }]]);
  });

  it('refuses one you own already, before anything is paid (even what you could not pay for): a starter tool too', () => {
    const w = world({}, rec('a', 'house', 1, 2, { stash: { items: { nail: 1 }, out: {} }, tools: WITH_RADIO }), rec('b', 'house', 1, 2, { stash: { items: { nail: 5 }, out: {} } }));
    w.craft('a', 1, 1, 'radio', 1000);
    w.craft('b', 1, 1, 'map', 1000);
    const out = w.drain();
    expect(to(out, 'a')).toEqual([{ t: 'refused', action: 'craft', reason: 'have_tool' }]);
    expect(to(out, 'b')).toEqual([{ t: 'refused', action: 'craft', reason: 'have_tool' }]);
    expect(w.get('a')!.stash!.items).toEqual({ nail: 1 });
    expect(w.get('b')!.stash!.items).toEqual({ nail: 5 });
    expect(w.takeWrites().players).toEqual([]);
  });
});

describe('a tool lying out there', () => {
  it('goes to whoever picks it up, for good and never into the bag, gone for everyone until it grows back by its rule', () => {
    const w = world({}, rec('a', 'woods', 5, 4), rec('b', 'woods', 5, 6));
    const radio = radioIn(w)!;
    expect(radio).toMatchObject({ x: 5, y: 5 });
    w.pick('a', 5, 5, 1000);
    const out = w.drain();
    expect(to(out, 'a')).toEqual([
      { t: 'got', items: [{ item: 'radio', count: 1 }], from: 'tool' },
      { t: 'tools', tools: WITH_RADIO },
    ]);
    expect(onMap(out, 'woods')).toEqual([{ t: 'findGone', id: radio.id }]);
    expect(w.get('a')).toMatchObject({ bag: [], tools: WITH_RADIO });
    expect(radioIn(w)).toBeUndefined();
    expect(w.takeWrites().players.map(p => [p.id, p.tools])).toEqual([['a', WITH_RADIO]]);

    // The dice say 10 s.
    w.tick(10_999);
    const early = w.drain();
    expect([...onMap(early, 'woods'), ...to(early, 'a'), ...to(early, 'b')].filter(m => m.t === 'find')).toEqual([]);
    w.tick(11_000);
    // It grew back for whoever has none: a, who has one now, never hears of it.
    const grown = w.drain(), find = { t: 'find', find: expect.objectContaining({ item: 'radio', x: 5, y: 5 }) };
    expect(to(grown, 'b')).toContainEqual(find);
    expect(to(grown, 'a').filter(m => m.t === 'find')).toEqual([]);
    expect(onMap(grown, 'woods').filter(m => m.t === 'find')).toEqual([]);
    w.pick('b', 5, 5, 11_000);
    expect(to(w.drain(), 'b')).toContainEqual({ t: 'tools', tools: WITH_RADIO });
  });

  it('is seen only by whoever does not own it yet: never in the welcome or the arrival of one who does, and gone from their sight once they get it', () => {
    const w = world({}, rec('a', 'woods', 5, 4, { tools: ['radio'] }), rec('b', 'woods', 5, 6), rec('c', 'woods', 1, 1));
    const seen = (id: string) => w.findViews('woods', id).map(f => f.item).sort();
    expect(seen('a')).toEqual(['moss']);
    expect(seen('b')).toEqual(['moss', 'radio']);
    // The world as nobody in particular sees it still holds it.
    expect(w.findViews('woods').map(f => f.item).sort()).toEqual(['moss', 'radio']);
    const radio = radioIn(w)!;
    expect(w.join(rec('d', 'woods', 6, 6, { tools: [...STARTER_TOOLS, 'radio'] }), 1000).finds.map(f => f.item)).toEqual(['moss']);
    expect(w.join(rec('e', 'woods', 6, 5), 1000).finds.map(f => f.item).sort()).toEqual(['moss', 'radio']);
    w.drain();
    // Given one some other way (the workbench, say), the one lying here goes from their sight.
    expect(w.giveTool('c', 'radio')).toBe(true);
    expect(to(w.drain(), 'c')).toEqual([{ t: 'tools', tools: WITH_RADIO }, { t: 'findGone', id: radio.id }]);
    expect(seen('c')).toEqual(['moss']);
  });

  it('stays where it lies, for someone else, when the picker has one already', () => {
    const w = world({}, rec('a', 'woods', 5, 4, { tools: ['radio'] }), rec('b', 'woods', 5, 6));
    const radio = radioIn(w)!;
    w.pick('a', 5, 5, 1000);
    const out = w.drain();
    expect(to(out, 'a')).toEqual([{ t: 'refused', action: 'pick', reason: 'have_tool' }]);
    expect(onMap(out, 'woods')).toEqual([]);
    expect(radioIn(w)).toEqual(radio);
    expect(w.get('a')).toMatchObject({ bag: [], tools: ['radio'] });
    w.pick('b', 5, 5, 1000);
    expect(onMap(w.drain(), 'woods')).toEqual([{ t: 'findGone', id: radio.id }]);
  });

  it('counts like any find, for the forager and the story, and never comes up double', () => {
    const w = world({ story: STORY }, rec('a', 'woods', 5, 4, { stats: { found: 12_000 } }), rec('m', 'woods', 4, 1, { stats: { found: 12_000 } }));
    // These dice make a find come up double for a forager of the top rank.
    const moss = w.findViews('woods').find(f => f.item === 'moss')!;
    w.pick('m', moss.x, moss.y, 1000);
    expect(to(w.drain(), 'm')).toContainEqual({ t: 'got', items: [{ item: 'moss', count: 2 }], from: 'find', double: true });
    w.pick('a', 5, 5, 1000);
    const heard = to(w.drain(), 'a');
    expect(heard.filter(m => m.t === 'got')).toEqual([{ t: 'got', items: [{ item: 'radio', count: 1 }], from: 'tool' }]);
    expect(heard).toContainEqual({ t: 'chapter', id: 'the-radio' });
    expect(w.get('a')).toMatchObject({ stats: { found: 12_001 }, story: 'the-radio', tools: WITH_RADIO });
  });
});

describe('a collapse', () => {
  it('never lets a tool fall into the pile: it holds what the bag held, and the tools stay', () => {
    const w = world({}, rec('a', 'woods', 3, 6, { energy: 0.01, bag: [{ item: 'moss', count: 2 }], tools: WITH_RADIO }));
    w.tick(1000);
    w.drain();
    const { drops, players } = w.takeWrites();
    expect(drops.map(d => [d.owner, d.drop?.items])).toEqual([['a', [{ item: 'moss', count: 2 }]]]);
    expect(players.map(p => p.tools)).toEqual([WITH_RADIO]);
    expect(w.get('a')).toMatchObject({ map: 'town', bag: [], tools: WITH_RADIO });
    const back = w.leave('a', 2000)!;
    expect(w.join(back, 2000).tools).toEqual(WITH_RADIO);
  });
});

describe('tools in memory storage', () => {
  it('keeps the tools a player owns, none for one who never got one, and never loses them to a save without them', async () => {
    const storage = new MemoryStorage();
    const r = rec('a', 'town', 1, 2);
    expect(await storage.create(r)).toBe(true);
    expect(storage.get('a')!.tools).toBeUndefined();
    await storage.save({ ...r, tools: WITH_RADIO });
    expect(storage.get('a')!.tools).toEqual(WITH_RADIO);
    await storage.save(r);
    expect(storage.get('a')!.tools).toEqual(WITH_RADIO);
    expect(await storage.create(rec('b', 'town', 1, 2, { tools: ['radio'] }))).toBe(true);
    expect(storage.get('b')!.tools).toEqual(['radio']);
  });
});

describe('tools over WebSockets', () => {
  const now = 1_000_000;
  const { ctx, enter, login } = setup({ items: ITEMS, weather: 'overcast', clock: () => now });

  it('welcomes a player from before with the starter tools, and anyone else with their own, in the order they got them', async () => {
    const before = await enter({ map: 'town', x: 1, y: 2 });
    expect(before.welcome.tools).toEqual([...STARTER_TOOLS]);
    const own = await enter({ map: 'town', x: 0, y: 5, tools: ['radio', 'near-woods-map'] });
    expect(own.welcome.tools).toEqual(['radio', 'near-woods-map']);
  });

  it('gives a tool picked up for good: heard, saved at once, not in the bag, and there after coming back', async () => {
    const a = await enter({ map: 'woods', x: 5, y: 4 });
    await a.c.settle();
    a.c.send({ t: 'pick', x: 5, y: 5 });
    expect(await a.c.next('got')).toEqual({ t: 'got', items: [{ item: 'radio', count: 1 }], from: 'tool' });
    expect(await a.c.next('tools')).toEqual({ t: 'tools', tools: WITH_RADIO });
    await waitFor(() => ctx.storage.get(a.id)?.tools?.includes('radio') === true, 'the tool to be saved');
    expect(ctx.storage.get(a.id)!.bag).toEqual([]);
    a.c.ws.close();
    await waitFor(() => !ctx.server.world.has(a.id), 'the player to leave');
    const back = await login(a.token);
    expect(back.welcome.tools).toEqual(WITH_RADIO);
    expect(back.welcome.bag).toEqual([]);
  });
});

describe('the field radio of content/items.json', () => {
  /** The items as they ship, without their finds and keepsakes (they lie on maps these tests do not have). */
  const content = { ...(JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/items.json'), 'utf8')) as ItemsData), finds: [], keepsakes: undefined };
  const radioTools = [...STARTER_TOOLS, 'radio'];

  it('is rewired at the workbench from 2 copper wire and 1 scrap, for good: never into the stash, and never twice', () => {
    const w = world({ items: content }, rec('a', 'house', 1, 2, { stash: { items: { wire: 3, scrap: 1, cloth: 2 }, out: {} } }));
    w.craft('a', 1, 1, 'radio', 1000);
    expect(to(w.drain(), 'a')).toEqual([
      { t: 'tools', tools: radioTools },
      { t: 'bench', stash: [{ item: 'wire', count: 1 }, { item: 'cloth', count: 2 }] },
      { t: 'did', did: { kind: 'made', item: 'radio', count: 1 } },
    ]);
    expect(w.get('a')).toMatchObject({ bag: [], tools: radioTools, stash: { items: { wire: 1, cloth: 2 } } });
    w.craft('a', 1, 1, 'radio', 2000);
    expect(to(w.drain(), 'a')).toEqual([{ t: 'refused', action: 'craft', reason: 'have_tool' }]);
  });

  it('needs all of it: one wire short, nothing is paid', () => {
    const w = world({ items: content }, rec('a', 'house', 1, 2, { stash: { items: { wire: 1, scrap: 5 }, out: {} } }));
    w.craft('a', 1, 1, 'radio', 1000);
    expect(to(w.drain(), 'a')).toEqual([{ t: 'refused', action: 'craft', reason: 'missing' }]);
    expect(w.get('a')!.stash!.items).toEqual({ wire: 1, scrap: 5 });
    expect(w.get('a')!.tools).toBeUndefined();
  });
});
