import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ClientMsg, ItemsData, MapData, NextGear, PlayerView, StoryData } from '@napoland/shared';
import { Game } from '../src/game';
import { Items } from '../src/items';
import { Maps } from '../src/maps';
import { goalText } from '../src/said';
import { FULL, storyData, tinyTown, tinyWoods, welcome } from './fixtures';

/** What players read comes from the real items and recipes, so it is tested with them. */
const content = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/items.json'), 'utf8')) as ItemsData;
const items = new Items(content);
const recipe = (id: string) => items.recipes.find(r => r.id === id)!;

describe('what the bag and the chest say comes next', () => {
  it('names the nearest gear and what it still lacks', () => {
    expect(goalText({ recipe: recipe('rubber-gloves'), missing: [{ item: 'resin', count: 1 }], ready: false }, items)).toBe('Next: rubber gloves. 1 more resin.');
    expect(goalText({ recipe: recipe('raincoat'), missing: [{ item: 'cloth', count: 4 }, { item: 'resin', count: 1 }], ready: false }, items)).toBe('Next: a raincoat. 4 more cloth and 1 more resin.');
    expect(goalText({ recipe: recipe('lead-cap'), missing: [{ item: 'shard', count: 2 }], ready: false }, items)).toBe('Next: a lead-lined cap. 2 more shards.');
  });

  it('says where to make it once the stash can pay for it, and to put away what you carry when that is all it lacks', () => {
    const ready: NextGear = { recipe: recipe('rubber-gloves'), missing: [], ready: true };
    expect(goalText(ready, items)).toBe('You can make rubber gloves at the workbench beside the chest.');
    expect(goalText({ ...ready, ready: false }, items)).toBe('Put away what you carry, and you can make rubber gloves at the workbench beside the chest.');
    expect(goalText({ recipe: recipe('raincoat'), missing: [], ready: true }, items)).toBe('You can make a raincoat at the workbench beside the chest.');
  });
});

/** A 5x4 room, the chest at 1,1 and the workbench at 3,1 against the top wall: stand at 3,2 for the workbench. */
function home(): MapData {
  return {
    id: 'room', name: 'Home', version: 1, kind: 'inside', depth: 0, width: 5, height: 4, tiles: ['xxxxx', 'xpppx', 'xpppx', 'xxpxx'], levels: Array<string>(4).fill('00000'),
    spawn: { x: 2, y: 2, dir: 'up' }, exits: [{ x: 2, y: 3, w: 1, h: 1, to: 'town', tx: 3, ty: 1, dir: 'down' }],
    objects: [{ kind: 'chest', x: 1, y: 1 }, { kind: 'workbench', x: 3, y: 1 }],
  };
}
const me = (x: number, y: number, more: Partial<PlayerView> = {}): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir: 'up', color: '#f29e4c', gear: {}, quirks: [], ...more });
const WELCOME_PARCEL = content.parcels!.welcome;

describe('the game, on the first day', () => {
  let sent: ClientMsg[];
  let g: Game;
  const now = 1000;
  beforeEach(() => {
    sent = [];
    g = new Game(new Maps([tinyTown(), home()]), m => sent.push(m), items);
  });

  it('knows the stash from the welcome, and from every chest and workbench after, open or not', () => {
    expect(g.nextGear()).toBeNull();
    g.handle(welcome(home(), [me(2, 2)], FULL, { items: items.version, stash: WELCOME_PARCEL }), now);
    expect(g.stash).toEqual(WELCOME_PARCEL);
    // With only the welcome parcel: rubber gloves, 1 more resin.
    expect(g.nextGear()).toMatchObject({ recipe: { id: 'rubber-gloves' }, missing: [{ item: 'resin', count: 1 }], ready: false });
    // A resin carried home counts before it is put away.
    g.handle({ t: 'bag', bag: [{ item: 'resin', count: 1 }] }, now);
    expect(g.nextGear()).toMatchObject({ recipe: { id: 'rubber-gloves' }, missing: [], ready: false });
    // Put away: the stash can pay for them now.
    g.handle({ t: 'bag', bag: [] }, now);
    g.handle({ t: 'chest', stash: [{ item: 'resin', count: 6 }, { item: 'cloth', count: 4 }] }, now);
    expect(g.nextGear()).toMatchObject({ recipe: { id: 'rubber-gloves' }, ready: true });
    // Made: rubber gloves are owned now, and the next is the wool cap.
    g.handle({ t: 'bench', stash: [{ item: 'cloth', count: 2 }, { item: 'rubber-gloves', count: 1, piece: { cond: 1 } }] }, now);
    expect(g.nextGear()).toMatchObject({ recipe: { id: 'wool-cap' }, missing: [{ item: 'cloth', count: 4 }, { item: 'resin', count: 1 }] });
  });

  it('leaves out what you wear, and says nothing once everything is made', () => {
    g.handle(welcome(home(), [me(2, 2, { gear: { gloves: 'rubber-gloves' } })], FULL, { items: items.version, stash: WELCOME_PARCEL }), now);
    expect(g.nextGear()?.recipe.id).not.toBe('rubber-gloves');
    const everything = items.recipes.map(r => ({ item: r.make, count: 1, piece: { cond: 1 } }));
    g.handle({ t: 'chest', stash: everything }, now);
    expect(g.nextGear()).toBeNull();
  });

  it('opens the workbench right next to you, and only then', () => {
    g.handle(welcome(home(), [me(2, 2)], FULL, { items: items.version, stash: [] }), now);
    expect(g.benchBeside()).toBeNull();
    g.openBench();
    expect(sent).toEqual([]);
    g.handle(welcome(home(), [me(3, 2)], FULL, { items: items.version, stash: [] }), now);
    expect(g.benchBeside()).toEqual({ x: 3, y: 1 });
    g.openBench();
    expect(sent).toEqual([{ t: 'bench', x: 3, y: 1 }]);
    g.handle({ t: 'bench', stash: [] }, now);
    expect(g.bench).toEqual({ x: 3, y: 1, stash: [] });
  });
});

describe('what people say once, as the game says it', () => {
  // Rook stands at 2,1 in the woods: talk to him from 2,2.
  const story = (): StoryData => ({ ...storyData(), remarks: [{ id: 'first-collapse', who: 'rook', after: 'collapsed', line: 'You went down out there.' }] });
  let sent: ClientMsg[];
  let g: Game;
  const now = 1000;
  beforeEach(() => {
    sent = [];
    g = new Game(new Maps([tinyTown(), tinyWoods()]), m => sent.push(m), new Items({ version: 4, items: [], finds: [] }), story());
    g.handle(welcome(tinyWoods(), [me(2, 2)], FULL, { items: 4, story: { version: 2, chapter: 'home' } }), now);
  });
  const talk = () => {
    g.pressA();
    const lines = g.dialog?.lines ?? [];
    while (g.dialog) g.advanceDialog();
    return lines;
  };

  it('says it after the chapter\'s hint, once, and tells the server who was talked to', () => {
    expect(talk()).toEqual(['Bring something home first.', 'Lost?']);
    g.handle({ t: 'stats', stats: { collapsed: 1 } }, now);
    expect(talk()).toEqual(['Bring something home first.', 'You went down out there.', 'Lost?']);
    expect(g.stats.told).toBe(1);
    expect(talk()).toEqual(['Bring something home first.', 'Lost?']);
    expect(sent.filter(m => m.t === 'talk')).toEqual([{ t: 'talk', x: 2, y: 1 }, { t: 'talk', x: 2, y: 1 }, { t: 'talk', x: 2, y: 1 }]);
  });

  it('stays said once the server says so, in the counts it sends', () => {
    g.handle({ t: 'stats', stats: { collapsed: 1, told: 1 } }, now);
    expect(talk()).toEqual(['Bring something home first.', 'Lost?']);
  });
});
