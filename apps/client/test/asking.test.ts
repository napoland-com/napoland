import { beforeEach, describe, expect, it } from 'vitest';
import { STEP_MS, type ClientMsg, type MapData, type PlayerView } from '@napoland/shared';
import { REPEAT_AFTER_MS } from '../src/ask';
import { Game } from '../src/game';
import { Items } from '../src/items';
import { Maps } from '../src/maps';
import { FULL, cabin, houseTown, itemsData, tinyWoods, welcome, zone } from './fixtures';

/**
 * The text box asking first and saying what it did, as the game runs it: the stick, A, B and taps
 * while it asks, what the box says by itself and how it closes, and why it does not ask.
 */
const items = new Items({
  ...itemsData(),
  items: [
    ...itemsData().items,
    { id: 'resin', name: 'Fir resin', noun: 'resin', plural: 'resin', kind: 'resource', stack: 20, text: 'Sticky.', fuel: 300 },
    { id: 'cap', name: 'Glowcap', kind: 'resource', stack: 20, text: 'Glows.', use: { mark: true } },
    { id: 'odd', name: 'Strange object', kind: 'resource', stack: 1, text: 'What is it?', use: { identify: true }, reveals: [{ item: 'feather', count: 1, weight: 1 }] },
    { id: 'feather', name: 'Hollow feather', kind: 'charm', stack: 1, text: 'Light.', charm: { load: 0.75 }, about: 'While it is in your bag, what you carry feels lighter.' },
  ],
});
/** The woods with a fire that burns down at 3,1, north of the clearing; the lit house's room keeps one in town. */
const woods = (): MapData => ({ ...tinyWoods(), objects: [...tinyWoods().objects, { kind: 'fireplace', x: 3, y: 1 }] });
const maps = new Maps([woods(), houseTown(), cabin()]);
const me = (x: number, y: number, dir: PlayerView['dir'] = 'up'): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir, color: '#f29e4c', gear: {}, quirks: [] });

let sent: ClientMsg[];
let g: Game;
let now: number;
function run(ms: number) {
  for (let t = 0; t < ms; t += 1000 / 60) { now += 1000 / 60; g.update(1 / 60, now); }
}
const steps = () => sent.filter(m => m.t === 'step');
/** At 3,2 in the woods, facing the fire at 3,1, with resin to burn. */
function atTheFire(bag = [{ item: 'resin', count: 10 }], left = 0) {
  g.handle(welcome(woods(), [me(3, 2)], FULL, { fires: [{ x: 3, y: 1, left }], bag }), now);
}

beforeEach(() => {
  sent = [];
  now = 1000;
  g = new Game(maps, m => sent.push(m), items);
});

describe('while it asks', () => {
  it('nobody walks: the stick chooses and counts, and a direction held on walks only once pressed again', () => {
    atTheFire();
    g.pressA();
    expect(g.askView()).toMatchObject({ choice: 'yes', count: { n: 1, max: 6 } });
    g.padChange('down', now);
    run(STEP_MS * 3);
    expect(steps()).toEqual([]);
    expect(g.askView()?.choice).toBe('no');
    g.padChange('up', now);
    expect(g.askView()?.choice).toBe('yes');
    // Still held when it is answered: no walking off.
    g.pressA();
    run(STEP_MS * 3);
    expect(steps()).toEqual([]);
    g.padChange(null, now);
    g.padChange('left', now);
    run(STEP_MS * 3);
    expect(steps().length).toBeGreaterThan(0);
  });

  it('counts on while − or + (or a side of the stick) is held, faster and faster, and stops when let go', () => {
    atTheFire([{ item: 'resin', count: 20 }]);
    g.pressA();
    g.holdCount(1, now);
    expect(g.askView()?.count?.n).toBe(2);
    run(REPEAT_AFTER_MS - 50);
    expect(g.askView()?.count?.n).toBe(2);
    run(1000);
    // Six fit in a fire that went out: it stops there however long it is held.
    expect(g.askView()?.count?.n).toBe(6);
    g.holdCount(0, now);
    g.padChange('left', now);
    run(2000);
    expect(g.askView()?.count?.n).toBe(1);
    g.padChange(null, now);
    const changes = g.boxChanges;
    run(1000);
    expect(g.boxChanges).toBe(changes);
  });

  it('a tap on the world is outside the box: NO', () => {
    atTheFire();
    g.pressA();
    g.tapTile(1, 1);
    expect(g.question).toBeNull();
    run(STEP_MS * 4);
    expect(steps()).toEqual([]);
    expect(sent.filter(m => m.t === 'feed')).toEqual([]);
  });

  it('a tap on the box itself answers nothing: YES and NO do', () => {
    atTheFire();
    g.pressA();
    g.boxTap();
    expect(g.question).not.toBeNull();
    g.answer('yes');
    expect(sent.at(-1)).toEqual({ t: 'feed', x: 3, y: 1, slot: 0 });
  });

  it('goes when you do: another map, or the connection dropping', () => {
    atTheFire();
    g.pressA();
    g.handle(zone(houseTown(), 5, 4, [me(5, 4)]), now);
    expect([g.question, g.note]).toEqual([null, null]);
    atTheFire();
    g.pressA();
    g.disconnected(now);
    expect(g.question).toBeNull();
  });
});

describe('what the box says by itself', () => {
  it('closes with A, B or a tap, and that press does nothing else', () => {
    // Facing the fire with nothing that burns: it says so. A again closes it, and does not ask or say it again.
    atTheFire([]);
    g.pressA();
    expect(g.note?.text).toBe('The fire is out. Bring something that burns: resin.');
    g.pressA();
    expect(g.note).toBeNull();
    expect(g.question).toBeNull();
    g.pressA();
    expect(g.pressB()).toBe(true);
    expect(g.note).toBeNull();
    g.pressA();
    g.tapTile(1, 1);
    expect(g.note).toBeNull();
    run(STEP_MS * 4);
    expect(steps()).toEqual([]);
    g.pressA();
    g.dismiss();
    expect(g.note).toBeNull();
    g.pressA();
    g.boxTap();
    expect(g.note).toBeNull();
  });

  it('closes by itself after about 4 seconds, and walking off closes it', () => {
    atTheFire([]);
    g.pressA();
    run(3500);
    expect(g.note).not.toBeNull();
    run(1000);
    expect(g.note).toBeNull();
    g.pressA();
    g.padChange('left', now);
    expect(g.note).toBeNull();
    run(STEP_MS * 2);
    expect(steps().length).toBeGreaterThan(0);
  });

  it('keeps the question just said yes to until the server answers: no press closes it, but you may walk', () => {
    atTheFire();
    g.pressA();
    g.pressA();
    expect(g.note).toMatchObject({ text: 'Feed the fire resin?', waiting: true });
    g.pressA();
    g.pressB();
    g.dismiss();
    expect(g.note?.waiting).toBe(true);
    // No second question while the first answer is on its way.
    expect(g.question).toBeNull();
    expect(sent.filter(m => m.t === 'feed')).toHaveLength(1);
    g.padChange('left', now);
    run(STEP_MS * 2);
    expect(steps().length).toBeGreaterThan(0);
    g.handle({ t: 'did', did: { kind: 'fire', item: 'resin', count: 1, left: 300, lit: true } }, now);
    expect(g.note).toMatchObject({ who: 'Fire', text: 'The fire takes 1 resin and catches again. It will burn 5 more minutes.', waiting: false });
  });

  it('waits for a question or someone\'s lines to be done before it says what came meanwhile', () => {
    atTheFire();
    g.pressA();
    g.handle({ t: 'did', did: { kind: 'thrown', item: 'resin', count: 1 } }, now);
    expect(g.note).toBeNull();
    g.pressB();
    expect(g.note?.text).toBe('You throw away 1 resin.');
    g.pressA();
    g.read('Sign', ['Rain.']);
    g.handle({ t: 'did', did: { kind: 'thrown', item: 'resin', count: 2 } }, now);
    expect(g.note).toBeNull();
    g.pressA();
    g.pressA();
    expect(g.dialog).toBeNull();
    expect(g.note?.text).toBe('You throw away 2 resin.');
  });

  it('is drawn again only when it changed', () => {
    atTheFire([]);
    const before = g.boxChanges;
    run(500);
    expect(g.boxChanges).toBe(before);
    g.pressA();
    expect(g.boxChanges).toBe(before + 1);
    expect(g.noteView(now)).toEqual({ who: 'Fire', text: 'The fire is out. Bring something that burns: resin.', ms: 4000, waiting: false });
    expect(g.askView()).toBeNull();
  });
});

describe('why it does not ask', () => {
  it('a strange object out in the dark: only in town, in the light; there it asks, and says what it turned out to be', () => {
    g.handle(welcome(woods(), [me(2, 2)], FULL, { bag: [{ item: 'odd', count: 1 }] }), now);
    g.use(0);
    expect(g.note).toMatchObject({ who: 'Strange object', text: 'It is too dark here to tell what it is. Look at it in town, in the light.' });
    expect(g.question).toBeNull();
    g.pressA();
    // A house in town counts: its door opens onto the town.
    g.handle(zone(cabin(), 4, 5, [me(4, 5)]), now);
    g.use(0);
    expect(g.question?.text).toBe('Look closely at the strange object? It will be used up.');
    g.pressA();
    expect(sent.at(-1)).toEqual({ t: 'use', slot: 0 });
    g.handle({ t: 'did', did: { kind: 'used', item: 'odd', into: { item: 'feather', count: 1 } } }, now);
    expect(g.note?.text).toBe('It turns out to be a hollow feather. While it is in your bag, what you carry feels lighter.');
  });

  it('a glowcap indoors, or where an arrow is painted already', () => {
    g.handle(welcome(cabin(), [me(4, 5)], FULL, { bag: [{ item: 'cap', count: 3 }] }), now);
    g.use(0);
    expect(g.note?.text).toBe('An arrow needs open ground. Paint it outdoors.');
    g.pressA();
    g.handle(welcome(woods(), [me(2, 2, 'left')], FULL, { bag: [{ item: 'cap', count: 3 }], marks: [{ id: 1, x: 2, y: 2, dir: 'up', color: '#fff', owner: 'bea', name: 'Bea', until: 1e13 }] }), now);
    g.use(0);
    expect(g.note?.text).toBe('There is an arrow here already. Step onto another tile first.');
    g.pressA();
    g.handle({ t: 'markGone', id: 1 }, now);
    g.use(0);
    expect(g.question?.text).toBe('Crush a glowcap to paint an arrow where you face? Everyone sees it for a day.');
  });

  it('a strange object that nothing it may turn out to be would fit', () => {
    const full = Array.from({ length: 7 }, () => ({ item: 'shard', count: 3 }));
    g.handle(welcome(cabin(), [me(4, 5)], FULL, { bag: [{ item: 'odd', count: 1 }, ...full] }), now);
    // Its own slot frees up, so the feather fits.
    g.use(0);
    expect(g.question).not.toBeNull();
    g.pressB();
    const cramped = new Game(maps, m => sent.push(m), new Items({ ...itemsData(), items: [...items.byId.values()].map(d => (d.id === 'odd' ? { ...d, reveals: [{ item: 'shard', count: 9, weight: 1 }] } : d)) }));
    cramped.handle(welcome(cabin(), [me(4, 5)], FULL, { bag: [{ item: 'odd', count: 1 }, ...full] }), now);
    cramped.use(0);
    expect(cramped.note?.text).toBe('Your bag is full. Make room first.');
  });
});
