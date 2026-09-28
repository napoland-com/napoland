import { beforeEach, describe, expect, it } from 'vitest';
import type { ClientMsg, ItemsData, MapData, PlayerView } from '@napoland/shared';
import { Game } from '../src/game';
import { roomText } from '../src/hud';
import { Items, factsOf, lookOf, recipeViews, resistText, slotViews, wornViews } from '../src/items';
import { Maps } from '../src/maps';
import { FULL, itemsData, tinyTown, welcome } from './fixtures';

/** A 5x4 room like home, the chest at 1,1 and the workbench beside it at 2,1: stand below either, facing up. */
function room(): MapData {
  return {
    id: 'room', name: 'Home', version: 1, kind: 'inside', depth: 0, width: 5, height: 4,
    tiles: ['xxxxx', 'xpppx', 'xpppx', 'xxpxx'], levels: Array<string>(4).fill('00000'),
    spawn: { x: 2, y: 2, dir: 'up' }, exits: [{ x: 2, y: 3, w: 1, h: 1, to: 'town', tx: 3, ty: 1, dir: 'down' }],
    objects: [{ kind: 'chest', x: 1, y: 1 }, { kind: 'workbench', x: 2, y: 1 }],
  };
}

const data: ItemsData = {
  ...itemsData(),
  items: [
    ...itemsData().items,
    { id: 'cloth', name: 'Cloth', kind: 'resource', stack: 10, text: 'Dry.' },
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

  it('opens the workbench with A, makes recipes there, and says what it made', () => {
    g.handle(welcome(room(), [me(2, 2)], FULL), now);
    g.pressA();
    expect(sent).toEqual([{ t: 'bench', x: 2, y: 1 }]);
    g.handle({ t: 'bench', stash: [{ item: 'cloth', count: 9 }] }, now);
    expect(g.bench).toEqual({ x: 2, y: 1, stash: [{ item: 'cloth', count: 9 }] });
    g.craft('coat');
    expect(sent.at(-1)).toEqual({ t: 'craft', x: 2, y: 1, recipe: 'coat' });
    g.handle({ t: 'crafted', item: 'coat', count: 1 }, now);
    expect(g.floats.map(f => f.text)).toEqual(['Made: Raincoat']);
    g.closeBench();
    expect(g.bench).toBeNull();
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
    expect(factsOf(items.get('coat'))).toEqual(['Wind 35%', 'Cold 10%', 'Sturdy', 'Shirt slot']);
    expect(factsOf(items.get('pack'))).toEqual(['12 slots', '+5 energy', 'Bag slot']);
    expect(slotViews([{ item: 'coat', count: 1 }], items)[0]).toMatchObject({ slot: 'shirt' });
  });

  it('draws a bigger bag bigger, and counts the bag\'s own slots', () => {
    expect(lookOf({ bag: 'pack' }, items)).toEqual({ cap: null, bag: '#7a4a2a', bagSize: Math.sqrt(12 / 8) });
    expect(roomText(3, 0, 12)).toBe('3 of 12');
  });
});
