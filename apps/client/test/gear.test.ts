import { beforeEach, describe, expect, it } from 'vitest';
import type { ClientMsg, ItemsData, MapData, PlayerView } from '@napoland/shared';
import { Game } from '../src/game';
import { benchHtml, roomText, slotHtml, slotLabel, wearSlotView } from '../src/hud';
import { Items, factsOf, lookOf, mendViews, oddsText, recipeViews, resistText, slotViews, upgradeId, upgradeOf, upgradeViews, wearText, wornViews } from '../src/items';
import { didText } from '../src/said';
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
    { id: 'cloth', name: 'Cloth', plural: 'cloth', kind: 'resource', stack: 10, text: 'Dry.' },
    { id: 'coat', name: 'Raincoat', kind: 'gear', stack: 1, text: 'Dry.', slot: 'shirt', tier: 'sturdy', color: '#e8c547', resist: { wind: 0.35, cold: 0.1 } },
    { id: 'pack', name: 'Hiking pack', kind: 'gear', stack: 1, text: 'Big.', slot: 'bag', color: '#7a4a2a', bag: 12, bonus: 5 },
    { id: 'halo', name: 'Halo', kind: 'gear', stack: 1, text: 'Odd.', slot: 'cap', tier: 'anomalous', about: 'It glows.' },
  ],
  recipes: [{ id: 'coat', make: 'coat', needs: [{ item: 'cloth', count: 8 }] }],
  wear: { sturdy: 5400, anomalous: 10800 },
  quirks: [{ id: 'hum', name: 'Humming', text: 'It hums.' }],
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
    g.handle(welcome(room(), [me(2, 2)], FULL), now);
    g.pressA();
    expect(sent).toEqual([{ t: 'bench', x: 2, y: 1 }]);
    g.handle({ t: 'bench', stash: [{ item: 'cloth', count: 9 }] }, now);
    expect(g.bench).toEqual({ x: 2, y: 1, stash: [{ item: 'cloth', count: 9 }] });
    g.craft('coat');
    expect(g.askView()).toEqual({ who: 'Workbench', text: 'Make a raincoat? It uses 8 cloth.', choice: 'yes', count: null });
    expect(sent).toHaveLength(1);
    g.pressA();
    expect(sent.at(-1)).toEqual({ t: 'craft', x: 2, y: 1, recipe: 'coat' });
    g.handle({ t: 'did', did: { kind: 'made', item: 'coat', count: 1 } }, now);
    expect(g.note).toMatchObject({ who: 'Workbench', text: 'You make a raincoat. It waits in your stash: put it on at the chest.', waiting: false });
    expect(g.floats).toEqual([]);
    g.closeBench();
    expect(g.bench).toBeNull();
  });

  it('says what the stash lacks instead of asking, and a no makes nothing', () => {
    g.handle(welcome(room(), [me(2, 2)], FULL), now);
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
    g.handle(welcome(room(), [me(2, 2, { shirt: 'coat' })], FULL, { body: { wet: 0, wetRate: 0, load: 0, hitched: false, worn: { shirt: { cond: 0.2 } } } }), now);
    g.pressA();
    g.handle({ t: 'bench', stash: [{ item: 'cloth', count: 1 }] }, now);
    g.mend('shirt');
    expect(g.note?.text).toBe('Your stash is short of 1 cloth to mend your raincoat.');
    g.pressA();
    g.handle({ t: 'bench', stash: [{ item: 'cloth', count: 4 }] }, now);
    g.mend('shirt');
    expect(g.question?.text).toBe('Mend your raincoat? It uses 2 cloth.');
    g.pressA();
    expect(sent.at(-1)).toEqual({ t: 'mend', x: 2, y: 1, slot: 'shirt' });
    g.handle({ t: 'did', did: { kind: 'mended', item: 'coat' } }, now);
    expect(g.note?.text).toBe('You mend your raincoat: as good as new.');
  });
});

describe('gear on the road, in the game', () => {
  it('puts on a carried piece and takes one off into the bag anywhere, asking nothing: nothing is used up', () => {
    g.handle(welcome(tinyTown(), [me(3, 3, { shirt: 'coat', bag: 'pack' })], FULL, { bag: [{ item: 'cloth', count: 2 }, { item: 'halo', count: 1, piece: { cond: 1, quirk: 'hum' } }] }), now);
    g.wear(1);
    g.doff('shirt');
    expect(sent).toEqual([{ t: 'wear', slot: 1 }, { t: 'doff', slot: 'shirt' }]);
    expect(g.question).toBeNull();
    // Nothing in that slot, nothing worn there: nothing to send.
    g.wear(5);
    g.doff('cap');
    expect(sent).toHaveLength(2);
  });

  it('takes the piece tapped out of the open chest', () => {
    g.handle(welcome(room(), [me(1, 2)], FULL), now);
    g.pressA();
    g.handle({ t: 'chest', stash: [{ item: 'coat', count: 1, piece: { cond: 1 } }, { item: 'coat', count: 1, piece: { cond: 0.2 } }] }, now);
    g.take('coat', 1);
    g.take('coat');
    expect(sent.slice(1)).toEqual([{ t: 'take', x: 1, y: 1, item: 'coat', count: 1, n: 1 }, { t: 'take', x: 1, y: 1, item: 'coat', count: 1 }]);
  });

  it('asks first before throwing away a carried piece, by its name', () => {
    g.handle(welcome(tinyTown(), [me(3, 3)], FULL, { bag: [{ item: 'coat', count: 1, piece: { cond: 0.5 } }] }), now);
    g.discard(0);
    expect(g.askView()).toEqual({ who: 'Raincoat', text: 'Throw away the raincoat? It is gone for good.', choice: 'yes', count: null });
    g.pressA();
    expect(sent).toEqual([{ t: 'discard', slot: 0, count: 1 }]);
  });

  it('says what a strange object turned into, and the quirk it came with', () => {
    expect(didText({ kind: 'used', item: 'glowcap', into: { item: 'halo', count: 1, piece: { cond: 1, quirk: 'hum' } } }, items)).toBe('It turns out to be a halo. It glows. It has a quirk: humming.');
  });
});

describe('what the interface says about gear', () => {
  it('shows a carried piece in the bag with how much of it is left and its quirk, and anything else with how many', () => {
    const [coat, halo, cloth] = slotViews([{ item: 'coat', count: 1, piece: { cond: 0.4 } }, { item: 'halo', count: 1, piece: { cond: 1, quirk: 'hum' } }, { item: 'cloth', count: 3 }], items);
    expect(coat).toMatchObject({ slot: 'shirt', cond: 0.4, facts: ['Worn: 40% left', 'Wind 35%', 'Cold 10%', 'Sturdy', 'Shirt slot'] });
    expect(slotHtml(coat!)).toContain('<span class="cond" data-low="false"><i style="transform:scaleX(0.400)"></i></span>');
    expect(slotHtml(coat!)).not.toContain('class="n"');
    expect(slotLabel(coat!)).toBe('Raincoat, 40% left');
    expect(halo).toMatchObject({ quirk: 'Humming' });
    expect(slotHtml(halo!)).toContain('<i class="quirk" aria-hidden="true">✦</i>');
    expect(slotLabel(halo!)).toBe('Halo, 100% left, Humming');
    expect(slotHtml(cloth!)).toContain('<span class="n">3</span>');
    expect(slotLabel(cloth!)).toBe('Cloth, 3');
  });

  it('draws the Wearing row, in the bag and at the chest: each piece over its slot, how much is left, a star for a quirk, and a bare slot by name', () => {
    const [cap, shirt, , , , bag] = wornViews({ cap: 'halo', shirt: 'coat', bag: 'pack' }, items, { cap: { cond: 1, quirk: 'hum' }, shirt: { cond: 0.1 }, bag: { cond: 1 } });
    const coat = wearSlotView('shirt', shirt!);
    expect(coat).toMatchObject({ label: 'Raincoat, 10% left', empty: false });
    expect(coat.html).toContain('<span class="lbl">shirt</span><span class="cond" data-low="true"><i style="transform:scaleX(0.100)"></i></span>');
    expect(wearSlotView('cap', cap!)).toMatchObject({ label: 'Halo, 100% left, Humming' });
    expect(wearSlotView('cap', cap!).html).toContain('✦');
    // A bag never wears: no bar.
    expect(wearSlotView('bag', bag!)).toMatchObject({ label: 'Hiking pack', empty: false });
    expect(wearSlotView('bag', bag!).html).not.toContain('class="cond"');
    expect(wearSlotView('gloves', null)).toEqual({ html: '<span class="lbl">gloves</span>', label: 'gloves: nothing', empty: true });
  });

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

describe('upgrades', () => {
  /** Two levels here: the first always works, the second half the time. The hiking pack is a bag: never upgraded. */
  const upItems = new Items({
    ...data, mend: { sturdy: [{ item: 'cloth', count: 2 }] },
    upgrades: [{ needs: [{ item: 'cloth', count: 2 }] }, { needs: [{ item: 'cloth', count: 3 }, { item: 'shard', count: 1 }], chance: 0.5 }],
  });
  const WORN = { shirt: { cond: 0.4, level: 1 }, cap: { cond: 1, quirk: 'hum' as const, level: 2 } };
  const GEAR = { shirt: 'coat', cap: 'halo', bag: 'pack' };
  const bodyWith = (worn: object) => ({ body: { wet: 0, wetRate: 0, load: 0, hitched: false, worn } });
  beforeEach(() => {
    g = new Game(maps, m => sent.push(m), upItems);
  });

  it('ask first at the workbench, with what they use and how often they work, and the box says what the server did', () => {
    g.handle(welcome(room(), [me(2, 2, GEAR)], FULL, bodyWith(WORN)), now);
    g.pressA();
    g.handle({ t: 'bench', stash: [{ item: 'cloth', count: 9 }, { item: 'shard', count: 1 }] }, now);
    g.upgrade({ from: 'worn', slot: 'shirt' });
    expect(g.askView()).toEqual({ who: 'Workbench', text: 'Upgrade your raincoat to +2? It uses 3 cloth and an anomaly shard. It works 5 times in 10.', choice: 'yes', count: null });
    expect(sent).toHaveLength(1);
    g.pressA();
    expect(sent.at(-1)).toEqual({ t: 'upgrade', x: 2, y: 1, of: { from: 'worn', slot: 'shirt' } });
    g.handle({ t: 'did', did: { kind: 'upgraded', item: 'coat', level: 1, failed: true } }, now);
    expect(g.note).toMatchObject({ who: 'Workbench', text: 'It did not take. The raincoat stays +1, and the materials are gone.', waiting: false });
  });

  it('say what the stash lacks instead of asking, ask nothing for what goes no higher, and say in the box why the server said no', () => {
    g.handle(welcome(room(), [me(2, 2, GEAR)], FULL, bodyWith(WORN)), now);
    g.pressA();
    g.handle({ t: 'bench', stash: [{ item: 'cloth', count: 2 }] }, now);
    g.upgrade({ from: 'worn', slot: 'shirt' });
    expect(g.question).toBeNull();
    expect(g.note?.text).toBe('Your stash is short of 1 cloth and 1 anomaly shard to upgrade your raincoat to +2.');
    g.pressB();
    // The halo is +2, the top here: nothing to ask.
    g.upgrade({ from: 'worn', slot: 'cap' });
    expect(g.question).toBeNull();
    expect(g.note).toBeNull();
    g.handle({ t: 'bench', stash: [{ item: 'coat', count: 1, piece: { cond: 1 } }, { item: 'cloth', count: 9 }] }, now);
    g.upgrade({ from: 'stash', item: 'coat', n: 0 });
    expect(g.question?.text).toBe('Upgrade your raincoat to +1? It uses 2 cloth.');
    g.pressA();
    g.handle({ t: 'refused', action: 'upgrade', reason: 'top_level' }, now);
    expect(g.note).toMatchObject({ who: 'Workbench', text: 'It goes no higher.' });
  });

  it('get a row at the workbench for each piece that can go higher, worn first, with the next level, its cost and its odds', () => {
    const stash = [{ item: 'coat', count: 1, piece: { cond: 1 } }, { item: 'coat', count: 1, piece: { cond: 1, level: 2 } }, { item: 'pack', count: 1, piece: { cond: 1 } }, { item: 'cloth', count: 2 }];
    const rows = upgradeViews(GEAR, WORN, stash, upItems);
    expect(rows.map(r => [r.id, r.name, r.facts, r.can])).toEqual([
      ['up:worn:shirt', 'Raincoat +1 → +2', 'You wear it. It works 5 times in 10.', false],
      ['up:stash:coat:0', 'Raincoat → +1', 'In the stash. It always works.', true],
    ]);
    expect(rows[0]!.needs.map(n => [n.name, n.have, n.need])).toEqual([['Cloth', 2, 3], ['Anomaly shard', 0, 1]]);
    expect(rows.every(r => r.group === 'upgrade')).toBe(true);
    expect(upgradeOf(upgradeId({ from: 'stash', item: 'coat', n: 1 }))).toEqual({ from: 'stash', item: 'coat', n: 1 });
    expect(upgradeOf(upgradeId({ from: 'worn', slot: 'shoes' }))).toEqual({ from: 'worn', slot: 'shoes' });
    for (const junk of ['coat', 'mend:shirt', 'up:worn:hat', 'up:stash:coat:-1', 'up:stash::0']) expect(upgradeOf(junk), junk).toBeNull();
  });

  it('say their odds plainly', () => {
    expect([undefined, 1, 0.7, 0.5, 0.3, 0.1].map(chance => oddsText({ needs: [], ...(chance === undefined ? {} : { chance }) }))).toEqual([
      'It always works.', 'It always works.', 'It works 7 times in 10.', 'It works 5 times in 10.', 'It works 3 times in 10.', 'It works 1 time in 10.',
    ]);
    expect(oddsText({ needs: [], chance: 0.25 })).toBe('It works 25% of the time.');
  });

  it('show the level after a piece\'s name everywhere it is named, and on its slot', () => {
    const [cap, shirt] = wornViews(GEAR, upItems, WORN);
    expect([cap!.name, shirt!.name]).toEqual(['Halo +2', 'Raincoat +1']);
    expect(wearSlotView('shirt', shirt!).html).toContain('<span class="lbl">shirt <b>+1</b></span>');
    expect(wearText(GEAR, WORN, upItems)).toBe('Raincoat +1 40%');
    expect(mendViews(GEAR, WORN, [], upItems)[0]!.name).toBe('Mend your raincoat +1');
    const [carried] = slotViews([{ item: 'coat', count: 1, piece: { cond: 1, level: 3 } }], upItems);
    expect(carried).toMatchObject({ name: 'Raincoat +3', level: 3 });
    expect(slotHtml(carried!)).toContain('<span class="n up">+3</span>');
    expect(slotLabel(carried!)).toBe('Raincoat +3, 100% left');
  });

  it('sit at the workbench under their own heading, between mending and making', () => {
    const html = benchHtml([
      ...mendViews(GEAR, WORN, [], upItems), ...upgradeViews(GEAR, WORN, [], upItems), ...recipeViews(data.recipes!, [], upItems),
    ]);
    expect([...html.matchAll(/<h3 class="bench-title">(\w+)<\/h3>/g)].map(m => m[1])).toEqual(['Mend', 'Upgrade', 'Make']);
    expect(html.indexOf('data-recipe="mend:shirt"')).toBeLessThan(html.indexOf('data-recipe="up:worn:shirt"'));
    expect(html.indexOf('data-recipe="up:worn:shirt"')).toBeLessThan(html.indexOf('data-recipe="coat"'));
  });
});
