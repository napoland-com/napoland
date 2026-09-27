import { beforeEach, describe, expect, it } from 'vitest';
import type { ClientMsg, MapData, PlayerView } from '@napoland/shared';
import { Game } from '../src/game';
import { Items, factsOf } from '../src/items';
import { Maps } from '../src/maps';
import { levelText, newsBanner } from '../src/status';
import { FULL, START, itemsData, tinyTown, welcome, zone } from './fixtures';

/** A 5x4 room with a chest against the top wall at 2,1: stand at 2,2 facing up to open it. */
function room(): MapData {
  return {
    id: 'room', name: 'Home', version: 1, kind: 'inside', depth: 0, width: 5, height: 4,
    tiles: ['xxxxx', 'xpppx', 'xpppx', 'xxpxx'],
    levels: Array<string>(4).fill('00000'),
    spawn: { x: 2, y: 2, dir: 'up' },
    exits: [{ x: 2, y: 3, w: 1, h: 1, to: 'town', tx: 3, ty: 1, dir: 'down' }],
    objects: [{ kind: 'chest', x: 2, y: 1 }],
  };
}

const items = new Items({ ...itemsData(), items: itemsData().items.map(i => (i.id === 'shard' ? { ...i, xp: 12 } : i)) });
const maps = new Maps([tinyTown(), room()]);
const me = (x: number, y: number): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir: 'up', color: '#f29e4c', gear: {} });

let sent: ClientMsg[];
let g: Game;
const now = 1000;

beforeEach(() => {
  sent = [];
  g = new Game(maps, m => sent.push(m), items);
  g.handle(welcome(room(), [me(2, 2)], FULL, { bag: [{ item: 'shard', count: 2 }] }), now);
});

describe('the chest at home', () => {
  it('opens with A, and shows what the stash holds once the server answers', () => {
    g.pressA();
    expect(sent).toEqual([{ t: 'chest', x: 2, y: 1 }]);
    expect(g.chest).toBeNull();
    g.handle({ t: 'chest', stash: [{ item: 'glowcap', count: 4 }] }, now);
    expect(g.chest).toEqual({ x: 2, y: 1, stash: [{ item: 'glowcap', count: 4 }] });
  });

  it('puts away one slot or everything, and takes a stack back out', () => {
    g.pressA();
    g.handle({ t: 'chest', stash: [] }, now);
    g.store(0);
    g.store();
    g.take('glowcap');
    expect(sent.slice(1)).toEqual([
      { t: 'store', x: 2, y: 1, slot: 0 },
      { t: 'store', x: 2, y: 1 },
      { t: 'take', x: 2, y: 1, item: 'glowcap', count: 10 },
    ]);
  });

  it('closes when the panel does, and when you leave the room', () => {
    g.pressA();
    g.handle({ t: 'chest', stash: [] }, now);
    g.closeChest();
    expect(g.chest).toBeNull();
    // A late answer to nothing asked opens nothing.
    g.handle({ t: 'chest', stash: [] }, now + 5000);
    expect(g.chest).toBeNull();
    g.pressA();
    g.handle({ t: 'chest', stash: [] }, now);
    g.handle(zone(tinyTown(), 3, 1, [me(3, 1)]), now);
    expect(g.chest).toBeNull();
  });

  it('says what XP stashing earned, and a new level makes the news', () => {
    const lv2 = { xp: 40, level: 2, from: 30, to: 120, maxEnergy: 105 };
    g.handle({ t: 'progress', progress: lv2, gained: 24 }, now);
    expect(g.floats.map(f => f.text)).toEqual(['+24 XP']);
    expect(g.news).toEqual([{ kind: 'level', progress: lv2 }]);
    expect(g.progress).toEqual(lv2);
    // Nothing earned (it all came out of the stash before): no float, no news.
    g.floats = []; g.news = [];
    g.handle({ t: 'progress', progress: lv2, gained: 0 }, now);
    expect(g.floats).toEqual([]);
    expect(g.news).toEqual([]);
  });
});

describe('what the interface says about levels', () => {
  it('names the level and what is left to the next', () => {
    expect(levelText(START)).toBe('Level 1 · 0 XP, 30 to go');
    expect(levelText({ xp: 20000, level: 20, from: 10830, to: null, maxEnergy: 195 })).toBe('Level 20 · 20000 XP, the top');
    expect(newsBanner({ kind: 'level', progress: { xp: 120, level: 3, from: 120, to: 270, maxEnergy: 110 } }, '')).toEqual({
      title: 'Level 3', sub: 'Your energy bar grows to 110.\nYou can go a little farther now.',
    });
  });

  it('tells in the bag what an item is worth at home', () => {
    expect(factsOf(items.get('shard'))).toEqual(['12 XP at home']);
  });
});
