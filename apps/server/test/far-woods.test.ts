/**
 * The Far Woods (roadmap/far-woods.md). First the World's rules they brought: creatures that keep their
 * region's own pace. Then, over real WebSockets with the content as it ships: the trappers' trail both
 * ways between the Near Woods and the Far Woods, the map of the Far Woods found in the trapper's cabin
 * (seen and picked only by whoever has none, growing back for the next), and the chapter the field
 * post's desk reaches.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STARTER_TOOLS, TileMap, type Dir, type MapData, type ServerMsg } from '@napoland/shared';
import { loadItems, loadMaps, loadStory } from '../src/content';
import type { PlayerRecord } from '../src/storage';
import { SKULKER_STEP_MS, WATCHER_STEP_MS, World, colorFor, type Outgoing } from '../src/world';
import { fixtureMaps } from './fixtures';
import { setup, waitFor, type Client } from './helpers';

/** A field `h` tiles tall (8 wide inside the forest), its way home at (4, h - 1), with one fern tile at 4,3. */
function fieldData(h: number, more: Partial<MapData> = {}): MapData {
  const tiles = Array.from({ length: h }, (_, y) => (y === 0 ? 'tttttttttt' : y === h - 1 ? 'ttttgttttt' : y === 3 ? 'tgggfggggt' : 'tggggggggt'));
  return {
    id: 'field', name: 'The Field', version: 1, kind: 'wilds', depth: 2, width: 10, height: h,
    tiles, levels: Array<string>(h).fill('0000000000'),
    spawn: { x: 4, y: h - 2, dir: 'up' },
    exits: [{ x: 4, y: h - 1, w: 1, h: 1, to: 'town', tx: 4, ty: 1, dir: 'down', home: true }],
    objects: [],
    ...more,
  };
}
const rec = (id: string, map: string, x: number, y: number, dir: Dir = 'up', more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map, x, y, dir, color: colorFor(id), energy: 100, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});
function world(field: MapData, weather: 'overcast' | 'night' | 'aurora'): World {
  const w = new World([...fixtureMaps(), new TileMap(field)], 'town', weather, { rng: () => 0 });
  w.drain();
  return w;
}
/** When a creature moved (a watcher, or whatever chases `a`), ticking every 2 ms from `from` to `to`. */
const creatureTimes = (w: World, a: string, from: number, to: number, every = 2) => {
  const at: number[] = [];
  for (let t = from; t <= to; t += every) {
    w.tick(t);
    const moved = w.drain().filter((o: Outgoing) => 'map' in o && o.map === 'field' && o.msg.t === 'creature' && (o.msg.creature.chasing === a || o.msg.creature.kind === 'watcher'));
    if (moved.length) at.push(t);
  }
  return at;
};

describe('creatures at their region\'s own pace', () => {
  it('watchers step as often as their region says, quicker still on an aurora night, and at the old pace where it says nothing', () => {
    const times = (stepMs: number | undefined, weather: 'overcast' | 'aurora') => {
      const w = world(fieldData(12, { watchers: { count: 1, steps: [12, 99], ...(stepMs ? { stepMs } : {}) } }), weather);
      w.join(rec('a', 'field', 4, 7, 'down'), 0);
      w.drain();
      // It wakes at 1,1 on the first tick, then comes at its pace (its back to a: nobody faces it).
      return creatureTimes(w, 'a', 0, 1500).slice(1, 4);
    };
    expect(times(460, 'overcast')).toEqual([460, 920, 1380]);
    // An aurora quickens every watcher by the same share: 460 × 400 / 520.
    expect(times(460, 'aurora')).toEqual([460, 814, 1168]);
    expect(times(undefined, 'overcast')).toEqual([WATCHER_STEP_MS, 2 * WATCHER_STEP_MS]);
  });

  it('skulkers chase at their region\'s pace, a little slower than you walk', () => {
    const chase = (stepMs: number | undefined) => {
      const w = world(fieldData(40, { skulkers: { count: 1, steps: [8, 999], when: ['night'], ...(stepMs ? { stepMs } : {}) } }), 'night');
      w.tick(0);
      w.drain();
      // Standing still three tiles from its lair (4,3): it sees you, and comes.
      w.join(rec('a', 'field', 4, 6), 0);
      w.drain();
      return creatureTimes(w, 'a', 10, 1500);
    };
    expect(chase(230)).toEqual([WATCHER_STEP_MS, WATCHER_STEP_MS + 230]);
    expect(chase(undefined)).toEqual([WATCHER_STEP_MS, WATCHER_STEP_MS + SKULKER_STEP_MS]);
  });
});

describe('the Far Woods over WebSockets, as the content ships', () => {
  const content = resolve(import.meta.dirname, '../../../content');
  const { maps } = loadMaps(resolve(content, 'maps'), 'stonebrook');
  const { items } = loadItems(resolve(content, 'items.json'), maps.values());
  const story = loadStory(resolve(content, 'story.json'), maps.values(), items);
  let now = 1_000_000;
  const { ctx, enter } = setup({ maps: [...maps.values()], items, story, homeMap: 'stonebrook', weather: 'overcast', rng: () => 0, clock: () => now });
  const CABIN = 'far-woods-trapper-cabin', POST = 'far-woods-field-post';
  const far = maps.get('far-woods')!, near = maps.get('near-woods')!;

  it('are reached up the trappers\' trail from the Near Woods, and left down it the same way', async () => {
    const up = near.data.exits.find(e => e.to === 'far-woods')!;
    const a = await enter({ map: 'near-woods', x: up.x, y: up.y + 1, dir: 'up' });
    a.c.send({ t: 'step', dir: 'up', seq: 1 });
    const zone = await a.c.next('zone');
    expect([zone.map.id, zone.x, zone.y, zone.dir]).toEqual(['far-woods', up.tx, up.ty, 'up']);
    // The Far Woods have their own surge and storm clocks, which every arrival hears.
    expect(zone.surge).not.toBeNull();
    expect(zone.storm).not.toBeNull();
    now += 1000;
    a.c.send({ t: 'step', dir: 'down', seq: 2 });
    const back = await a.c.next('zone', m => m.map.id === 'near-woods');
    expect([back.x, back.y, back.dir]).toEqual([up.x, up.y + 1, 'down']);
    expect(far.exitAt(up.tx, up.ty + 1)).toMatchObject({ to: 'near-woods' });
  });

  it('keep their map in the trapper\'s cabin for whoever has none: picked, it is theirs for good; whoever has one never sees it, and it grows back for the next', async () => {
    const probe = await enter({ map: CABIN, x: 4, y: 4 });
    const find = probe.welcome.finds.find(f => f.item === 'far-woods-map')!;
    expect(find).toBeDefined();
    const room = maps.get(CABIN)!;
    const spots = [[find.x, find.y], [find.x + 1, find.y], [find.x - 1, find.y], [find.x, find.y + 1], [find.x, find.y - 1]]
      .filter(([x, y]) => room.walkable(x!, y!) && !room.exitAt(x!, y!) && !(x === 4 && y === 4)) as Array<[number, number]>;
    expect(spots.length).toBeGreaterThanOrEqual(2);

    // Someone who owns it already: it is not there for them, and reaching for it anyway is refused.
    const owner = await enter({ map: CABIN, x: spots[0]![0], y: spots[0]![1], tools: [...STARTER_TOOLS, 'far-woods-map'] });
    expect(owner.welcome.finds.map(f => f.item)).not.toContain('far-woods-map');
    owner.c.send({ t: 'pick', x: find.x, y: find.y });
    expect(await owner.c.next('refused')).toEqual({ t: 'refused', action: 'pick', reason: 'have_tool' });

    // Someone who has none: it floats over them, joins their tools for good, and is gone for everyone.
    const finder = await enter({ map: CABIN, x: spots[1]![0], y: spots[1]![1] });
    expect(finder.welcome.finds).toContainEqual(find);
    finder.c.send({ t: 'pick', x: find.x, y: find.y });
    expect(await finder.c.next('got')).toEqual({ t: 'got', items: [{ item: 'far-woods-map', count: 1 }], from: 'tool' });
    expect(await finder.c.next('tools')).toEqual({ t: 'tools', tools: [...STARTER_TOOLS, 'far-woods-map'] });
    expect(await probe.c.next('findGone')).toEqual({ t: 'findGone', id: find.id });
    await waitFor(() => ctx.storage.get(finder.id)?.tools?.includes('far-woods-map') === true, 'the map to be saved');
    expect(ctx.storage.get(finder.id)!.bag).toEqual([]);

    // A minute or two later another lies there, for the next who has none: never for the two who have one.
    now += 121_000;
    const again = await probe.c.next('find', m => m.find.item === 'far-woods-map');
    expect(again.find.item).toBe('far-woods-map');
    const heard = async (c: Client) => (await c.settle()).filter((m: ServerMsg) => m.t === 'find' && m.find.item === 'far-woods-map');
    expect(await heard(finder.c)).toEqual([]);
    expect(await heard(owner.c)).toEqual([]);
  });

  it('are on the notice board in town, after the Near Woods: their own surge and storm clocks', async () => {
    const board = maps.get('stonebrook')!.data.objects.find(o => o.kind === 'board')!;
    const a = await enter({ map: 'stonebrook', x: board.x, y: board.y + 1, dir: 'up' });
    a.c.send({ t: 'board', x: board.x, y: board.y });
    const { lines } = await a.c.next('board');
    const at = (start: string) => lines.findIndex(l => l.startsWith(start));
    for (const clock of [/next surge|restless|a surge is on/, /next storm|a storm is/]) {
      const nearLine = lines.findIndex(l => l.startsWith('The Near Woods:') && clock.test(l)), farLine = lines.findIndex(l => l.startsWith('The Far Woods:') && clock.test(l));
      expect(nearLine, String(clock)).toBeGreaterThanOrEqual(0);
      expect(farLine, String(clock)).toBeGreaterThan(nearLine);
    }
    expect(at('The Far Woods:')).toBeGreaterThan(at('The Near Woods:'));
  });

  it('move the story on to the field post when you read its desk, once you have seen the Tower\'s panel', async () => {
    const desk = maps.get(POST)!.data.objects.find(o => o.kind === 'console')!;
    const a = await enter({ map: POST, x: desk.x, y: desk.y + 1, dir: 'up', story: 'do-not-switch-off' });
    expect(a.welcome.story).toEqual({ version: story.version, chapter: 'do-not-switch-off' });
    a.c.send({ t: 'talk', x: desk.x, y: desk.y });
    expect(await a.c.next('chapter')).toEqual({ t: 'chapter', id: 'the-field-post' });
    await waitFor(() => ctx.storage.get(a.id)?.story === 'the-field-post', 'the chapter to be saved');
    // The story rests there: reading it again moves nothing.
    a.c.send({ t: 'talk', x: desk.x, y: desk.y });
    expect((await a.c.settle()).filter(m => m.t === 'chapter')).toEqual([]);
  });
});
