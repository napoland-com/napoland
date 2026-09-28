import { beforeEach, describe, expect, it } from 'vitest';
import type { ClientMsg, ItemsData, MapData, PlayerView } from '@napoland/shared';
import { Game } from '../src/game';
import { roomText } from '../src/hud';
import { Items, factsOf, lookOf, recipeViews, resistText, slotViews, wornViews } from '../src/items';
import { Maps } from '../src/maps';
import { FULL, itemsData, tinyTown, welcome } from './fixtures';

/** A 5x4 room with a chest at 1,1 and a workbench at 3,1: stand below either, facing up. */
function room(): MapData {
  return {
    id: 'room', name: 'Lodge', version: 1, kind: 'inside', depth: 0, width: 5, height: 4,
    tiles: ['xxxxx', 'xpppx', 'xpppx', 'xxpxx'], levels: Array<string>(4).fill('00000'),
    spawn: { x: 2, y: 2, dir: 'up' }, exits: [{ x: 2, y: 3, w: 1, h: 1, to: 'town', tx: 3, ty: 1, dir: 'down' }],
    objects: [{ kind: 'chest', x: 1, y: 1 }, { kind: 'workbench', x: 3, y: 1 }],
  };
}

const data: ItemsData = {
  ...itemsData(),
  items: [
    ...itemsData().items,
    { id: 'cloth', name: 'Cloth', plural: 'cloth', kind: 'resource', stack: 10, text: 'Dry.' },
    { id: 'coat', name: 'Raincoat', kind: 'gear', stack: 1, text: 'Dry.', slot: 'shirt', tier: 'sturdy', color: '#e8c547', resist: { wind: 0.35, cold: 0.1 } },
    { id: 'pack', name: 'Hiking pack', kind: 'gear', stack: 1, text: 'Big.', slot: 'bag', color: '#7a4a2a', bag: 12, bonus: 5 },
  ],
  recipes: [{ id: 'coat', make: 'coat', needs: [{ item: 'cloth', count: 8 }] }],
};
const items = new Items(data);
const maps = new Maps([tinyTown(), room()]);
const me = (x: number, y: number, gear = {}): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir: 'up', color: '#f29e4c', gear, quirks: [] });

let sent: ClientMsg[];
let g: Game;
const now = 1000;
beforeEach(() => {
  sent = [];
  g = new Game(maps, m => sent.push(m), items);
});

describe('gear in the game', () => {
  it('knows what everyone wears, and follows the changes', () => {
    g.handle(welcome(room(), [me(2, 2, { shirt: 'coat' }), { id: 'o', name: 'Bea', x: 2, y: 1, dir: 'up', color: '#fff', gear: {}, quirks: [] }]), now);
    expect(g.myGear).toEqual({ shirt: 'coat' });
    g.handle({ t: 'gear', id: 'o', gear: { bag: 'pack' }, quirks: [] }, now);
    expect(g.gear.get('o')).toEqual({ bag: 'pack' });
    // Your character is drawn in it.
    expect(g.avatars().find(a => a.id === 'me')!.look).toEqual({ cap: null, shirt: '#e8c547' });
  });

  it('puts gear on and takes it off at the open chest', () => {
    g.handle(welcome(room(), [me(1, 2)], FULL), now);
    g.pressA();
    g.handle({ t: 'chest', stash: [{ item: 'coat', count: 1 }] }, now);
    g.equip('coat');
    g.unequip('cap');
    expect(sent).toEqual([{ t: 'chest', x: 1, y: 1 }, { t: 'equip', x: 1, y: 1, item: 'coat' }, { t: 'unequip', x: 1, y: 1, slot: 'cap' }]);
  });

  it('opens the workbench with A, asks before making a recipe there, and says what it made in the text box', () => {
    g.handle(welcome(room(), [me(3, 2)], FULL), now);
    g.pressA();
    expect(sent).toEqual([{ t: 'bench', x: 3, y: 1 }]);
    g.handle({ t: 'bench', stash: [{ item: 'cloth', count: 9 }] }, now);
    expect(g.bench).toEqual({ x: 3, y: 1, stash: [{ item: 'cloth', count: 9 }] });
    g.craft('coat');
    expect(g.askView()).toEqual({ who: 'Workbench', text: 'Make a raincoat? It uses 8 cloth.', choice: 'yes', count: null });
    expect(sent).toHaveLength(1);
    g.pressA();
    expect(sent.at(-1)).toEqual({ t: 'craft', x: 3, y: 1, recipe: 'coat' });
    g.handle({ t: 'did', did: { kind: 'made', item: 'coat', count: 1 } }, now);
    expect(g.note).toMatchObject({ who: 'Workbench', text: 'You make a raincoat. It waits in your stash: put it on at the chest.', waiting: false });
    expect(g.floats).toEqual([]);
    g.closeBench();
    expect(g.bench).toBeNull();
  });

  it('says what the stash lacks instead of asking, and a no makes nothing', () => {
    g.handle(welcome(room(), [me(3, 2)], FULL), now);
    g.pressA();
    g.handle({ t: 'bench', stash: [{ item: 'cloth', count: 5 }] }, now);
    g.craft('coat');
    expect(g.question).toBeNull();
    expect(g.note).toMatchObject({ who: 'Workbench', text: 'Your stash is short of 3 cloth for a raincoat.' });
    g.pressB();
    g.handle({ t: 'bench', stash: [{ item: 'cloth', count: 8 }] }, now);
    g.craft('coat');
    g.pressB();
    expect(g.question).toBeNull();
    expect(sent.filter(m => m.t === 'craft')).toEqual([]);
  });

  it('asks before mending what you wear, with what mending it costs', () => {
    const mending = new Items({ ...data, mend: { sturdy: [{ item: 'cloth', count: 2 }] } });
    g = new Game(maps, m => sent.push(m), mending);
    g.handle(welcome(room(), [me(3, 2, { shirt: 'coat' })], FULL, { body: { wet: 0, wetRate: 0, load: 0, hitched: false, worn: { shirt: { cond: 0.2 } } } }), now);
    g.pressA();
    g.handle({ t: 'bench', stash: [{ item: 'cloth', count: 1 }] }, now);
    g.mend('shirt');
    expect(g.note?.text).toBe('Your stash is short of 1 cloth to mend your raincoat.');
    g.pressA();
    g.handle({ t: 'bench', stash: [{ item: 'cloth', count: 4 }] }, now);
    g.mend('shirt');
    expect(g.question?.text).toBe('Mend your raincoat? It uses 2 cloth.');
    g.pressA();
    expect(sent.at(-1)).toEqual({ t: 'mend', x: 3, y: 1, slot: 'shirt' });
    g.handle({ t: 'did', did: { kind: 'mended', item: 'coat' } }, now);
    expect(g.note?.text).toBe('You mend your raincoat: as good as new.');
  });
});

describe('what the interface says about gear', () => {
  it('lists recipes against what the stash holds', () => {
    const [coat] = recipeViews(data.recipes!, [{ item: 'cloth', count: 5 }], items);
    expect(coat).toMatchObject({ id: 'coat', name: 'Raincoat', can: false, needs: [{ name: 'Cloth', have: 5, need: 8 }] });
    expect(recipeViews(data.recipes!, [{ item: 'cloth', count: 8 }], items)[0]!.can).toBe(true);
  });

  it('names what is worn, what it resists and what a piece does', () => {
    expect(wornViews({ shirt: 'coat' }, items).map(w => w?.name ?? null)).toEqual([null, 'Raincoat', null, null, null, null]);
    expect(resistText({ shirt: 'coat' }, items)).toBe('Cold 10%, Wind 35%');
    expect(resistText({}, items)).toBeNull();
    expect(factsOf(items.get('coat'))).toEqual(['Wind 35%', 'Cold 10%', 'Sturdy', 'Worn: shirt']);
    expect(factsOf(items.get('pack'))).toEqual(['12 slots', '+5 energy', 'Worn: bag']);
    expect(slotViews([{ item: 'coat', count: 1 }], items)[0]).toMatchObject({ slot: 'shirt' });
  });

  it('draws a bigger bag bigger, and counts the bag\'s own slots', () => {
    expect(lookOf({ bag: 'pack' }, items)).toEqual({ cap: null, bag: '#7a4a2a', bagSize: Math.sqrt(12 / 8) });
    expect(roomText(3, 0, 12)).toBe('3 of 12');
  });
});
