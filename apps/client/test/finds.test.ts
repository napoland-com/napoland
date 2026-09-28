import { beforeEach, describe, expect, it } from 'vitest';
import { STEP_MS, type ClientMsg, type DropView, type FindView, type PlayerView } from '@napoland/shared';
import { Game } from '../src/game';
import { Items, liveState, slotViews } from '../src/items';
import { Maps } from '../src/maps';
import { newsBanner } from '../src/status';
import { FULL, ITEMS, itemsData, tinyTown, tinyWoods, welcome, zone } from './fixtures';

// The 7x5 test town: open grass with a road up the middle, a sign at 1,1, the way to the woods at 3,0.
const town = tinyTown(), woods = tinyWoods();
const maps = new Maps([town, woods]);
const me = (x: number, y: number, dir: PlayerView['dir'] = 'up'): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir, color: '#f29e4c', gear: {}, quirks: [] });
const glowcap = (id: number, x: number, y: number): FindView => ({ id, item: 'glowcap', x, y });
const pile = (owner: string, x: number, y: number): DropView => ({ id: owner, x, y, owner, name: owner === 'me' ? 'Aldo' : 'Bea', until: 1e13, trail: [] });

let sent: ClientMsg[];
let g: Game;
let now: number;
/** Advance time in 1/60 s frames. */
function run(ms: number) {
  for (let t = 0; t < ms; t += 1000 / 60) { now += 1000 / 60; g.update(1 / 60, now); }
}
const picks = () => sent.filter(m => m.t === 'pick');
const texts = () => g.floats.map(f => f.text);
/** Start standing at x,y (facing up) with these finds, piles and bag. */
function start(x: number, y: number, extras: Parameters<typeof welcome>[3] = {}, dir: PlayerView['dir'] = 'up') {
  g.handle(welcome(town, [me(x, y, dir)], FULL, extras), now);
}

beforeEach(() => {
  sent = [];
  now = 1000;
  g = new Game(maps, m => sent.push(m), ITEMS);
});

describe('finds, piles and the bag', () => {
  it('are what the welcome brings', () => {
    start(3, 3, { finds: [glowcap(1, 5, 2)], drops: [pile('o1', 1, 3)], bag: [{ item: 'shard', count: 2 }] });
    expect([...g.finds.values()]).toEqual([glowcap(1, 5, 2)]);
    expect([...g.drops.keys()]).toEqual(['o1']);
    expect(g.bag).toEqual([{ item: 'shard', count: 2 }]);
  });

  it('are the new map\'s after a zone, and the bag goes along', () => {
    start(3, 1, { finds: [glowcap(1, 5, 2)], drops: [pile('o1', 1, 3)], bag: [{ item: 'shard', count: 2 }] });
    const before = g.lootChanges;
    g.handle(zone(woods, 2, 4, [me(2, 4)], 'exit', { finds: [glowcap(9, 2, 2)] }), now);
    expect([...g.finds.keys()]).toEqual([9]);
    expect(g.drops.size).toBe(0);
    expect(g.bag).toEqual([{ item: 'shard', count: 2 }]);
    expect(g.lootChanges).toBeGreaterThan(before);
  });

  it('come and go as the server says, and a new pile of the same player replaces the old one', () => {
    start(3, 3);
    let changes = g.lootChanges;
    const changed = () => { const c = g.lootChanges !== changes; changes = g.lootChanges; return c; };
    g.handle({ t: 'find', find: glowcap(4, 5, 1) }, now);
    expect(g.finds.get(4)).toEqual(glowcap(4, 5, 1));
    expect(changed()).toBe(true);
    g.handle({ t: 'findGone', id: 4 }, now);
    expect(g.finds.size).toBe(0);
    expect(changed()).toBe(true);
    g.handle({ t: 'findGone', id: 4 }, now);
    expect(changed()).toBe(false);
    g.handle({ t: 'drop', drop: pile('o1', 1, 3) }, now);
    g.handle({ t: 'drop', drop: pile('o1', 6, 4) }, now);
    expect([...g.drops.values()]).toEqual([pile('o1', 6, 4)]);
    g.handle({ t: 'dropGone', id: 'o1' }, now);
    expect(g.drops.size).toBe(0);
    expect(changed()).toBe(true);
  });

  it('shows the bag the server sends, whole', () => {
    start(3, 3, { bag: [{ item: 'glowcap', count: 3 }] });
    const bag = [{ item: 'glowcap', count: 4 }, { item: 'thermos', count: 1 }];
    g.handle({ t: 'bag', bag }, now);
    expect(g.bag).toEqual(bag);
  });

  it('floats what you got over your head, a line each, the first on top', () => {
    start(3, 3);
    g.handle({ t: 'got', items: [{ item: 'glowcap', count: 2 }, { item: 'shard', count: 1 }], from: 'drop' }, now);
    expect(g.floats.map(f => [f.text, f.row, f.x, f.y])).toEqual([['+2 Glowcap', 1, 3, 3], ['+1 Anomaly shard', 0, 3, 3]]);
    run(2000);
    expect(g.floats).toEqual([]);
  });

  it('says so when someone else\'s pile leaves you nothing', () => {
    start(3, 3);
    g.handle({ t: 'got', items: [], from: 'drop' }, now);
    expect(texts()).toEqual(['Nothing in it for you']);
  });

  it('names an item it does not know after its id', () => {
    start(3, 3);
    g.handle({ t: 'got', items: [{ item: 'fir-cone', count: 1 }], from: 'find' }, now);
    expect(texts()).toEqual(['+1 Fir cone']);
  });

  it('floats a plain no when the server refuses a pick, and says it in the text box for what it asked first', () => {
    start(3, 3);
    g.handle({ t: 'refused', action: 'pick', reason: 'bag_full' }, now);
    g.handle({ t: 'refused', action: 'pick', reason: 'too_far' }, now);
    g.handle({ t: 'refused', action: 'pick', reason: 'gone' }, now);
    expect(texts()).toEqual(['Your bag is full', 'Too far', 'Someone got there first']);
    g.handle({ t: 'refused', action: 'use', reason: 'not_usable' }, now);
    expect(g.note).toMatchObject({ text: 'That cannot be used.', waiting: false });
    g.handle({ t: 'refused', action: 'discard', reason: 'empty_slot' }, now);
    expect(g.note?.text).toBe('That slot is empty.');
    expect(texts()).toHaveLength(3);
  });
});

describe('what A does', () => {
  it('picks up a pile before a find on the same tile', () => {
    start(3, 3, { finds: [glowcap(1, 3, 3)], drops: [pile('o1', 3, 3)] });
    expect(g.action()).toEqual({ kind: 'pick', x: 3, y: 3, what: 'drop' });
    // Someone else's: what to do with it comes first (lostfound.ts), and Take half is the pick.
    g.pressA();
    expect(picks()).toEqual([]);
    g.pressA();
    expect(picks()).toEqual([{ t: 'pick', x: 3, y: 3 }]);
  });

  it('picks up your own pile at once, with nothing asked', () => {
    start(3, 3, { drops: [pile('me', 3, 3), pile('o1', 3, 3)] });
    g.pressA();
    expect(g.question).toBeNull();
    expect(picks()).toEqual([{ t: 'pick', x: 3, y: 3 }]);
  });

  it('picks up what lies on your own tile before what lies on the tile you face', () => {
    start(3, 3, { finds: [glowcap(1, 3, 3)], drops: [pile('o1', 3, 2)] });
    expect(g.action()).toEqual({ kind: 'pick', x: 3, y: 3, what: 'find' });
    g.handle({ t: 'findGone', id: 1 }, now);
    expect(g.action()).toEqual({ kind: 'pick', x: 3, y: 2, what: 'drop' });
    g.pressA();
    g.pressA();
    expect(picks()).toEqual([{ t: 'pick', x: 3, y: 2 }]);
  });

  it('picks up before it talks: the sign is read once nothing lies there', () => {
    // At 1,2 facing the sign at 1,1, with a glowcap underfoot.
    start(1, 2, { finds: [glowcap(1, 1, 2)] });
    g.pressA();
    expect(picks()).toEqual([{ t: 'pick', x: 1, y: 2 }]);
    expect(g.dialog).toBeNull();
    g.handle({ t: 'got', items: [{ item: 'glowcap', count: 1 }], from: 'find' }, now);
    g.handle({ t: 'findGone', id: 1 }, now);
    g.pressA();
    expect(g.dialog?.who).toBe('Sign');
    expect(picks()).toHaveLength(1);
  });

  it('only looks at your own tile and the one you face', () => {
    start(3, 3, { finds: [glowcap(1, 4, 3), glowcap(2, 3, 1)] });
    expect(g.action()).toBeNull();
    g.pressA();
    expect(picks()).toEqual([]);
    expect(texts()).toEqual(['Nothing here']);
  });

  it('asks once, and again only after an answer, or when none comes', () => {
    start(3, 3, { finds: [glowcap(1, 3, 2)] });
    g.pressA();
    g.pressA();
    expect(picks()).toHaveLength(1); // a second pick would earn "Someone got there first" for our own find
    g.handle({ t: 'refused', action: 'pick', reason: 'bag_full' }, now);
    g.pressA();
    expect(picks()).toHaveLength(2);
    run(3000); // no answer at all
    g.pressA();
    expect(picks()).toHaveLength(3);
  });

  it('does not pick while walking, or while offline', () => {
    start(3, 3, { finds: [glowcap(1, 3, 1)] });
    g.padChange('up', now);
    run(20);
    expect(g.me!.anim).not.toBeNull();
    g.pressA();
    g.disconnected(now);
    run(400);
    g.pressA();
    expect(picks()).toEqual([]);
  });

  it('can pick again right away on a new map', () => {
    start(3, 1, { finds: [glowcap(1, 3, 1)] });
    g.pressA();
    g.handle(zone(woods, 2, 4, [me(2, 4)], 'exit', { finds: [glowcap(2, 2, 4)] }), now);
    g.pressA();
    expect(picks()).toEqual([{ t: 'pick', x: 3, y: 1 }, { t: 'pick', x: 2, y: 4 }]);
  });
});

describe('tapping a find or a pile', () => {
  let confirmed = 0;
  beforeEach(() => { confirmed = 0; });
  /** Advance time, the server confirming each step in the frame it is taken (where we then stand). */
  function walk(ms: number) {
    for (let t = 0; t < ms; t += 1000 / 60) {
      now += 1000 / 60;
      g.update(1 / 60, now);
      for (const m of sent.filter(s => s.t === 'step').slice(confirmed)) {
        confirmed++;
        if (m.t === 'step') g.handle({ t: 'step', id: 'me', x: g.me!.tx, y: g.me!.ty, dir: m.dir, seq: m.seq }, now);
      }
    }
  }

  it('walks onto a find and picks it up', () => {
    start(3, 3, { finds: [glowcap(1, 5, 3)] });
    g.tapTile(5, 3);
    expect(g.marker).toMatchObject({ x: 5, y: 3 });
    walk(STEP_MS * 3);
    expect(g.me).toMatchObject({ tx: 5, ty: 3 });
    expect(picks()).toEqual([{ t: 'pick', x: 5, y: 3 }]);
  });

  it('walks onto a pile and picks it up', () => {
    start(3, 3, { drops: [pile('o1', 3, 1)] });
    g.tapTile(3, 1);
    walk(STEP_MS * 3);
    // Someone else's pile asks first as you get there: Take half.
    expect(g.askView()).toMatchObject({ labels: { yes: 'Take half', no: 'Carry it to the lodge for Bea' } });
    g.pressA();
    expect(picks()).toEqual([{ t: 'pick', x: 3, y: 1 }]);
  });

  it('picks up at once what lies underfoot', () => {
    start(3, 3, { finds: [glowcap(1, 3, 3)] });
    g.tapTile(3, 3);
    run(20);
    expect(picks()).toEqual([{ t: 'pick', x: 3, y: 3 }]);
    expect(sent.filter(m => m.t === 'step')).toEqual([]);
  });

  it('does not ask for what went away on the way', () => {
    start(3, 3, { finds: [glowcap(1, 6, 3)] });
    g.tapTile(6, 3);
    walk(STEP_MS);
    g.handle({ t: 'findGone', id: 1 }, now);
    walk(STEP_MS * 4);
    expect(g.me).toMatchObject({ tx: 6, ty: 3 });
    expect(picks()).toEqual([]);
  });

  it('gives up on picking when the joystick takes over', () => {
    start(3, 3, { finds: [glowcap(1, 6, 3)] });
    g.tapTile(6, 3);
    walk(STEP_MS);
    g.padChange('down', now);
    walk(STEP_MS);
    g.padChange(null, now);
    walk(STEP_MS * 4);
    expect(picks()).toEqual([]);
  });
});

describe('using and throwing away', () => {
  const used = () => sent.filter(m => m.t === 'use' || m.t === 'discard');

  it('asks before using a slot, and says what it did from the server\'s answer, not over your head', () => {
    start(3, 3, { bag: [{ item: 'glowcap', count: 3 }, { item: 'thermos', count: 2 }] });
    let closed = 0;
    g.use(1, () => closed++);
    expect(g.askView()).toEqual({ who: 'Thermos', text: 'Drink the thermos? Your energy is full already.', choice: 'yes', count: null });
    expect(used()).toEqual([]);
    g.pressA();
    expect(used()).toEqual([{ t: 'use', slot: 1 }]);
    expect(closed).toBe(1);
    g.handle({ t: 'bag', bag: [{ item: 'glowcap', count: 3 }, { item: 'thermos', count: 1 }] }, now);
    g.handle({ t: 'did', did: { kind: 'used', item: 'thermos', energy: 0 } }, now);
    expect(g.note).toMatchObject({ who: 'Thermos', text: 'You drink the thermos, but your energy was full already.' });
    expect(texts()).toEqual([]);
  });

  it('uses nothing on NO, B or a tap outside the box', () => {
    start(3, 3, { bag: [{ item: 'thermos', count: 2 }] });
    let closed = 0;
    g.use(0, () => closed++);
    g.padChange('down', now);
    expect(g.askView()?.choice).toBe('no');
    g.pressA();
    g.use(0, () => closed++);
    g.pressB();
    g.use(0, () => closed++);
    g.dismiss();
    g.use(0, () => closed++);
    g.answer('no');
    expect([used(), closed, g.question, g.note]).toEqual([[], 0, null, null]);
  });

  it('says in the box what the server refused, and forgets a question it never answered', () => {
    start(3, 3, { bag: [{ item: 'thermos', count: 2 }] });
    g.use(0);
    g.pressA();
    g.handle({ t: 'refused', action: 'use', reason: 'not_usable' }, now);
    expect(g.note).toMatchObject({ who: 'Thermos', text: 'That cannot be used.', waiting: false });
    expect(texts()).toEqual([]);
    run(8000);
    expect(g.note).toBeNull();
    g.use(0);
    g.pressA();
    expect(g.note?.waiting).toBe(true);
    run(3000);
    expect(g.note).toBeNull();
  });

  it('asks how many to throw away, from one up to the whole slot', () => {
    start(3, 3, { bag: [{ item: 'glowcap', count: 3 }, { item: 'shard', count: 1 }] });
    g.discard(0);
    expect(g.askView()).toEqual({ who: 'Glowcap', text: 'Throw away a glowcap? It is gone for good.', choice: 'yes', count: { n: 1, min: 1, max: 3 } });
    g.padChange('right', now);
    g.padChange(null, now);
    expect(g.question?.text).toBe('Throw away 2 glowcaps? They are gone for good.');
    g.pressA();
    expect(used()).toEqual([{ t: 'discard', slot: 0, count: 2 }]);
    g.handle({ t: 'did', did: { kind: 'thrown', item: 'glowcap', count: 2 } }, now);
    expect(g.note?.text).toBe('You throw away 2 glowcaps.');
    g.pressA();
    g.discard(1);
    expect(g.askView()).toMatchObject({ text: 'Throw away the anomaly shard? It is gone for good.', count: null });
    g.pressA();
    expect(used().at(-1)).toEqual({ t: 'discard', slot: 1, count: 1 });
  });

  it('goes to wherever the item lies when the bag changed while it asked, or says it is gone', () => {
    start(3, 3, { bag: [{ item: 'glowcap', count: 3 }, { item: 'thermos', count: 2 }] });
    g.use(1);
    // Something took the glowcaps meanwhile: the thermos is in the first slot now.
    g.handle({ t: 'bag', bag: [{ item: 'thermos', count: 2 }] }, now);
    g.pressA();
    expect(used()).toEqual([{ t: 'use', slot: 0 }]);
    g.handle({ t: 'did', did: { kind: 'used', item: 'thermos', energy: 30 } }, now);
    g.pressA();
    g.discard(0);
    g.handle({ t: 'bag', bag: [] }, now);
    g.pressA();
    expect(used()).toHaveLength(1);
    expect(g.note?.text).toBe('It is not in your bag any more.');
  });

  it('asks nothing for an empty slot, or while offline', () => {
    start(3, 3, { bag: [{ item: 'thermos', count: 1 }] });
    g.use(4);
    g.discard(4);
    g.disconnected(now);
    g.use(0);
    g.discard(0);
    expect(g.question).toBeNull();
    expect(used()).toEqual([]);
  });
});

describe('collapsing with something in the bag', () => {
  it('counts what the bag holds as carried', () => {
    start(3, 3, { bag: [{ item: 'glowcap', count: 3 }] });
    expect(g.carrying(now)).toBe(true);
  });

  it('still counts it when the server emptied the bag a moment before the zone', () => {
    start(3, 3, { bag: [{ item: 'glowcap', count: 3 }] });
    g.handle({ t: 'bag', bag: [] }, now);
    expect(g.carrying(now + 50)).toBe(true);
    expect(g.carrying(now + 5000)).toBe(false);
  });

  it('carried nothing with an empty bag', () => {
    start(3, 3);
    g.handle({ t: 'bag', bag: [] }, now);
    expect(g.carrying(now)).toBe(false);
  });
});

describe('piles nearby', () => {
  it('say whose they are while you are close', () => {
    start(3, 3, { drops: [pile('me', 4, 4), pile('o1', 0, 0)] });
    expect(g.pilesNear().map(d => d.name)).toEqual(['Aldo']);
  });
});

describe('the items version', () => {
  it('does not play with other items than the server\'s: the client is out of date and reloads', () => {
    g.handle(welcome(town, [me(3, 3)], FULL, { items: ITEMS.version + 1 }), now);
    expect(g.online).toBe(false);
    g.padChange('down', now);
    run(500);
    expect(sent.filter(m => m.t === 'step')).toEqual([]);
    g.handle(welcome(town, [me(3, 3)], FULL, { items: ITEMS.version }), now);
    expect(g.online).toBe(true);
  });
});

describe('live finds', () => {
  const data = itemsData();
  const items = new Items({
    ...data,
    items: [
      ...data.items.map(i => (i.id === 'shard' ? { ...i, xp: 12 } : i)),
      { id: 'live-shard', name: 'Live shard', kind: 'resource', stack: 1, xp: 12, text: 'Burning.', live: { xp: 40, fresh: 240, fade: 5, into: 'shard' } },
    ],
  });
  const countdown = (age: number) => liveState(slotViews([{ item: 'live-shard', count: 1, age: 0 }], items)[0]!.live!, age).text;

  it('count down from their age: worth the most while fresh, then fading', () => {
    expect(slotViews([{ item: 'live-shard', count: 1, age: 48 }], items)[0]!.live?.age).toBe(48);
    expect(slotViews([{ item: 'shard', count: 1 }], items)[0]!.live).toBeUndefined();
    expect(countdown(48)).toBe('Worth 40 XP for 3:12 more');
    expect(countdown(239.5)).toBe('Worth 40 XP for 0:01 more');
    expect(countdown(360)).toBe('Fading: 30 XP now');
    expect(countdown(900)).toBe('Fading: 12 XP now');
  });

  it('light up whoever carries one when the map hears it, and anyone who comes along carrying one', () => {
    start(3, 3);
    expect(g.avatars().find(a => a.id === 'me')?.live).toBe(false);
    g.handle({ t: 'glow', id: 'me', on: true }, now);
    expect(g.avatars().find(a => a.id === 'me')?.live).toBe(true);
    g.handle({ t: 'join', player: { id: 'bea', name: 'Bea', x: 1, y: 1, dir: 'up', color: '#fff', gear: {}, quirks: [], live: true } }, now);
    expect(g.live.has('bea')).toBe(true);
    g.handle({ t: 'glow', id: 'me', on: false }, now);
    g.handle({ t: 'leave', id: 'bea' }, now);
    expect(g.live.size).toBe(0);
  });

  it('say so when you pick one up', () => {
    g = new Game(maps, m => sent.push(m), items);
    g.handle(welcome(town, [me(3, 3)], FULL, { items: items.version }), now);
    g.handle({ t: 'got', items: [{ item: 'live-shard', count: 1 }], from: 'find' }, now);
    const news = g.news.find(n => n.kind === 'live')!;
    expect(newsBanner(news, 'The Near Woods')).toEqual({ title: 'It is still live', sub: 'Stash it within 4 minutes for the most XP.' });
  });
});
