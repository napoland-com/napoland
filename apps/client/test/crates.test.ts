import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { CACHE_SIZE, TileMap, type CacheItemView, type ClientMsg, type ItemsData, type MapData, type PlayerView } from '@napoland/shared';
import { cardPress, detailView, type DetailState } from '../src/details';
import { Game } from '../src/game';
import { crateView } from '../src/crates';
import { Items } from '../src/items';
import { Maps } from '../src/maps';
import { CRATE_EMPTY, CRATE_FULL, CRATE_NO_GEAR, LEFT_ONE, TOOK_ONE, agoText, didText, didWho, leaveQuestion, leftBy } from '../src/said';
import { furnitureModel } from '../src/view/interior';
import { FULL, cabin, tinyTown, welcome } from './fixtures';

/** What players read comes from the real items. */
const items = new Items(JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/items.json'), 'utf8')) as ItemsData);
const thing = (id: number, item: string, owner: string, name: string, age: number): CacheItemView => ({ id, item, owner, name, age });

describe('what a crate says', () => {
  it('asks before you leave something, and says what it did', () => {
    expect(leaveQuestion(items.get('resin'))).toBe('Leave 1 resin in the crate for whoever comes next?');
    expect(leaveQuestion(items.get('glowcap'))).toBe('Leave a glowcap in the crate for whoever comes next?');
    expect(didText({ kind: 'left', item: 'resin' }, items)).toBe('You leave 1 resin in the crate. Whoever comes next will find it.');
    expect(didText({ kind: 'took', item: 'resin', name: 'Ana', thanked: true }, items)).toBe('You take the resin Ana left, and thank Ana for it.');
    expect(didText({ kind: 'took', item: 'thermos', name: 'Ana' }, items)).toBe('You take the thermos Ana left.');
    expect(didText({ kind: 'took', item: 'resin', name: 'Aldo', mine: true }, items)).toBe('You take back the resin you left.');
    expect([didWho({ kind: 'left', item: 'resin' }, items), didWho({ kind: 'took', item: 'resin', name: 'Ana' }, items)]).toEqual(['Crate', 'Crate']);
  });

  it('says who left each thing and when, in few words', () => {
    expect([0, 59, 60, 3599, 3600, 7300, 86_399, 86_400, 3 * 86_400].map(agoText)).toEqual(['just now', 'just now', '1 min ago', '59 min ago', '1 h ago', '2 h ago', '23 h ago', 'a day ago', '3 days ago']);
    expect(leftBy('Ana', false, 7300)).toBe('left by Ana, 2 h ago');
    expect(leftBy('Aldo', true, 10)).toBe('left by you, just now');
    expect(CRATE_EMPTY).toBe('Nothing in it yet. Leave something for whoever comes next.');
    expect(CRATE_FULL).toBe(`The crate is full: it holds ${CACHE_SIZE} things. Someone has to take one out first.`);
  });

  it('shows its panel: how full, what you may still do this visit, and each thing, the newest first', () => {
    const inside = [thing(2, 'resin', 'ana', 'Ana', 7300), thing(1, 'glowcap', 'me', 'Aldo', 90_000)];
    expect(crateView({ items: inside, left: false, took: false }, items, 'me')).toEqual({
      count: '2 of 6',
      hint: 'For whoever comes next: take one thing and leave one, each time you come by.',
      rows: [
        { id: 2, name: 'Fir resin', icon: expect.stringContaining('<svg'), line: 'left by Ana, 2 h ago' },
        { id: 1, name: 'Glowcap', icon: expect.stringContaining('<svg'), line: 'left by you, a day ago' },
      ],
      empty: null,
    });
    expect(crateView({ items: [], left: false, took: false }, items, 'me')).toMatchObject({ count: '0 of 6', rows: [], empty: CRATE_EMPTY });
    expect(crateView({ items: [], left: true, took: false }, items, 'me').hint).toBe('You left one thing this time. Take one if you need it.');
    expect(crateView({ items: [], left: false, took: true }, items, 'me').hint).toBe('You took one thing this time. Leave one for whoever comes next?');
    expect(crateView({ items: [], left: true, took: true }, items, 'me').hint).toBe('You took one thing and left one this time. Come by again for more.');
  });
});

describe('a crate\'s cards', () => {
  // At a crate, the cards of your bag's slots leave one there (panel 'crate'), as in the chest they put it away.
  const state = (crate: DetailState['crate'], bag: DetailState['bag'] = []): DetailState => ({ items, bag, stash: [], gear: {}, worn: {}, panel: 'crate', ...(crate ? { crate } : {}) });
  const inside = [thing(7, 'resin', 'ana', 'Ana', 120)];

  it('shows a thing in it with who left it, and takes it without asking, once a visit', () => {
    const card = detailView({ from: 'crate', id: 7 }, state({ items: inside, left: false, took: false, me: 'me' }))!;
    expect(card).toMatchObject({ name: 'Fir resin', notes: [{ text: 'Left by Ana, 2 min ago.', tone: 'plain' }], act: { label: 'Take it', enabled: true, does: { kind: 'crateTake', id: 7 } } });
    expect(cardPress(card)).toEqual({ does: { kind: 'crateTake', id: 7 }, close: true, shake: false });
    const took = detailView({ from: 'crate', id: 7 }, state({ items: inside, left: false, took: true, me: 'me' }))!;
    expect(took.act?.enabled).toBe(false);
    expect(took.notes.at(-1)).toEqual({ text: TOOK_ONE, tone: 'bad' });
    expect(cardPress(took)).toEqual({ close: false, shake: true });
    expect(detailView({ from: 'crate', id: 8 }, state({ items: inside, left: false, took: false, me: 'me' }))).toBeNull();
  });

  it('offers to leave one of a bag slot, and says why not: gear, one left already, or a full crate', () => {
    const bag = [{ item: 'resin', count: 4 }, { item: 'raincoat', count: 1 }];
    const open = { items: inside, left: false, took: false, me: 'me' };
    const leave = detailView({ from: 'bag', slot: 0, item: 'resin' }, state(open, bag))!;
    expect(leave.act).toEqual({ label: 'Leave one', enabled: true, does: { kind: 'crateLeave', slot: 0 } });
    const gear = detailView({ from: 'bag', slot: 1, item: 'raincoat' }, state(open, bag))!;
    expect(gear.act?.enabled).toBe(false);
    expect(gear.notes).toContainEqual({ text: CRATE_NO_GEAR, tone: 'bad' });
    // Greyed out, it still goes to the game, which says why in the text box (as making does).
    expect(cardPress(gear)).toEqual({ does: { kind: 'crateLeave', slot: 1 }, close: false, shake: true });
    expect(detailView({ from: 'bag', slot: 0, item: 'resin' }, state({ ...open, left: true }, bag))!.notes).toContainEqual({ text: LEFT_ONE, tone: 'bad' });
    const full = Array.from({ length: CACHE_SIZE }, (_, i) => thing(i, 'resin', 'ana', 'Ana', 60));
    expect(detailView({ from: 'bag', slot: 0, item: 'resin' }, state({ ...open, items: full }, bag))!.notes).toContainEqual({ text: CRATE_FULL, tone: 'bad' });
    // The slot no longer holds what was tapped, or the crate is closed: no card.
    expect(detailView({ from: 'bag', slot: 0, item: 'glowcap' }, state(open, bag))).toBeNull();
    expect(detailView({ from: 'bag', slot: 0, item: 'resin' }, state(undefined, bag))).toBeNull();
    // The same slot in the chest puts it away, and in the bag uses it or throws it away: only at a crate is it left.
    expect(detailView({ from: 'bag', slot: 0, item: 'resin' }, { ...state(open, bag), panel: 'home' })!.act).toMatchObject({ label: 'Put away', does: { kind: 'store', slot: 0 } });
    expect(detailView({ from: 'bag', slot: 0, item: 'resin' }, { ...state(open, bag), panel: 'bag' })!.act?.does.kind).not.toBe('crateLeave');
  });
});

/** A room out in the wilds (its door opens onto the woods) with a crate at 3,2: stand at 3,3, facing up. */
function hut(): MapData {
  return { ...cabin(), id: 'hut', objects: [...cabin().objects, { kind: 'cache', x: 3, y: 2, name: 'the hut\'s crate' }] };
}
const maps = new Maps([tinyTown(), hut()]);
const me: PlayerView = { id: 'me', name: 'Aldo', x: 3, y: 3, dir: 'up', color: '#f29e4c', gear: {}, quirks: [] };

describe('at a crate', () => {
  let sent: ClientMsg[];
  let g: Game;
  const now = 1000;
  beforeEach(() => {
    sent = [];
    g = new Game(maps, m => sent.push(m), items);
  });
  /** In the hut by the crate, with this bag, and the crate open with these things in it. */
  function atCrate(bag = [{ item: 'resin', count: 3 }], inside = [thing(7, 'resin', 'ana', 'Ana', 120)], visit = { left: false, took: false }) {
    g.handle(welcome(hut(), [me], FULL, { bag, items: items.version }), now);
    g.pressA();
    expect(sent.at(-1)).toEqual({ t: 'cache', x: 3, y: 2 });
    g.handle({ t: 'cache', x: 3, y: 2, items: inside, ...visit }, now);
    expect(g.cache).toMatchObject({ x: 3, y: 2, items: inside });
  }

  it('opens with A, facing it, and follows what the server says of it', () => {
    atCrate();
    g.handle({ t: 'cache', x: 3, y: 2, items: [], left: false, took: true }, now + 500);
    expect(g.cache).toMatchObject({ items: [], took: true });
    // What came in 30 s ago is 30 s older now.
    g.handle({ t: 'cache', x: 3, y: 2, items: [thing(9, 'resin', 'ana', 'Ana', 10)], left: false, took: true }, now);
    expect(g.cacheItemsNow(now + 30_000)[0]!.age).toBe(40);
    g.closeCache();
    expect(g.cache).toBeNull();
  });

  it('asks before leaving one thing, and says why when it cannot', () => {
    atCrate([{ item: 'resin', count: 3 }, { item: 'raincoat', count: 1 }]);
    g.leaveInCache(0);
    expect(g.askView()).toMatchObject({ who: 'Crate', text: 'Leave 1 resin in the crate for whoever comes next?' });
    g.pressA();
    expect(sent.at(-1)).toEqual({ t: 'cacheLeave', x: 3, y: 2, slot: 0 });
    g.handle({ t: 'did', did: { kind: 'left', item: 'resin' } }, now);
    expect(g.note).toMatchObject({ who: 'Crate', text: 'You leave 1 resin in the crate. Whoever comes next will find it.' });
    g.pressA();
    g.leaveInCache(1);
    expect(g.note?.text).toBe(CRATE_NO_GEAR);
    g.pressA();
    g.handle({ t: 'cache', x: 3, y: 2, items: [], left: true, took: false }, now);
    g.leaveInCache(0);
    expect(g.note?.text).toBe(LEFT_ONE);
    g.pressA();
    g.handle({ t: 'cache', x: 3, y: 2, items: Array.from({ length: CACHE_SIZE }, (_, i) => thing(i, 'resin', 'ana', 'Ana', 60)), left: false, took: false }, now);
    g.leaveInCache(0);
    expect(g.note?.text).toBe(CRATE_FULL);
    expect(sent.filter(m => m.t === 'cacheLeave')).toHaveLength(1);
  });

  it('takes one thing without asking, and the box says whom it thanked', () => {
    atCrate();
    g.takeFromCache(7);
    expect(g.question).toBeNull();
    expect(sent.at(-1)).toEqual({ t: 'cacheTake', x: 3, y: 2, id: 7 });
    g.handle({ t: 'did', did: { kind: 'took', item: 'resin', name: 'Ana', thanked: true } }, now);
    expect(g.note).toMatchObject({ who: 'Crate', text: 'You take the resin Ana left, and thank Ana for it.' });
    g.pressA();
    g.handle({ t: 'refused', action: 'cacheTake', reason: 'gone' }, now);
    expect(g.note).toMatchObject({ who: 'Crate', text: 'Someone got there first.' });
  });

  it('says why it cannot take one: one taken this visit already, or a full bag', () => {
    atCrate([{ item: 'resin', count: 3 }], [thing(7, 'resin', 'ana', 'Ana', 120)], { left: false, took: true });
    g.takeFromCache(7);
    expect(g.note?.text).toBe(TOOK_ONE);
    g.pressA();
    const full = Array.from({ length: 8 }, (_, i) => ({ item: i % 2 ? 'glowcap' : 'thermos', count: i % 2 ? 20 : 3 }));
    atCrate(full, [thing(7, 'resin', 'ana', 'Ana', 120)]);
    g.takeFromCache(7);
    expect(g.note?.text).toBe('Your bag is full. Make room first.');
    expect(sent.filter(m => m.t === 'cacheTake')).toEqual([]);
  });

  it('closes when you walk into another map or lose the connection', () => {
    atCrate();
    g.disconnected(now);
    expect(g.cache).toBeNull();
  });
});

describe('a crate, drawn', () => {
  const size = (m: THREE.Object3D) => new THREE.Box3().setFromObject(m);
  const colors = (m: THREE.Object3D) => {
    const out = new Set<string>();
    m.traverse(o => { if (o instanceof THREE.Mesh && (o.material as THREE.MeshToonMaterial).color) out.add(`#${(o.material as THREE.MeshToonMaterial).color.getHexString()}`); });
    return out;
  };

  it('stands on its tile, lower than a person: plain boards with a chalk mark, or one of NAPO\'s in its rooms, with its yellow stencil', () => {
    const plain = furnitureModel({ kind: 'cache', x: 3, y: 2, name: 'the hut\'s crate' }, new TileMap(hut()))!;
    const napo = furnitureModel({ kind: 'cache', x: 3, y: 2, name: 'the bunker\'s crate' }, new TileMap({ ...hut(), style: 'napo' }))!;
    for (const m of [plain, napo]) {
      const b = size(m);
      expect(b.min.x).toBeGreaterThanOrEqual(3);
      expect(b.max.x).toBeLessThanOrEqual(4);
      expect(b.min.z).toBeGreaterThanOrEqual(2);
      expect(b.max.z).toBeLessThanOrEqual(3);
      expect(b.max.y).toBeLessThan(0.8);
    }
    expect(colors(napo).has('#d6ad2f')).toBe(true);
    expect(colors(plain).has('#d6ad2f')).toBe(false);
    expect(colors(plain).has('#e8e3d3')).toBe(true);
  });
});
