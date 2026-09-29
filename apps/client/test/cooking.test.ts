/**
 * Cooking at a fire, and meals (meals.ts), as the game asks and says them: a choice at a fire between
 * feeding it and cooking on it, the question before cooking with what it uses, eating from the bag
 * (asked first, or why not), what it did, and the status panel's Meals row. The words are tested against
 * the real items.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { itemIndex, type ClientMsg, type ItemsData, type MapData, type PlayerView } from '@napoland/shared';
import json from '../../../content/items.json';
import { Question } from '../src/ask';
import { detailView } from '../src/details';
import { Game } from '../src/game';
import { Items, factsOf, refusalText, useLabel } from '../src/items';
import { Maps } from '../src/maps';
import {
  FIRE_CHOICE, FIRE_OPTIONS, TWO_MEALS, WHAT_TO_COOK, ateAlready, cookQuestion, cookShort, didText, didWho, eatQuestion, mealDoes, mealsText,
} from '../src/said';
import { statusView } from '../src/status';
import { DRY, FULL, START, ASLEEP, cabin, houseTown, tinyWoods, welcome } from './fixtures';

const real = new Items(json as ItemsData);
const recipe = (id: string) => real.cooking.find(r => r.id === id)!;

describe('what cooking and meals say', () => {
  it('asks before cooking, with what it uses', () => {
    expect(cookQuestion(recipe('fir-tip-tea'), real)).toBe('Cook fir-tip tea? It uses 3 fir tips.');
    expect(cookQuestion(recipe('chanterelle-stew'), real)).toBe('Cook chanterelle stew? It uses 3 chanterelles and 2 fiddleheads.');
    expect(cookQuestion(recipe('berry-pemmican'), real)).toBe('Cook berry pemmican? It uses 5 huckleberries.');
    expect(cookShort(recipe('chanterelle-stew'), [{ item: 'chanterelles', count: 2 }], real)).toBe('For chanterelle stew you need 1 more chanterelle and 2 more fiddleheads in your bag.');
    expect([FIRE_CHOICE, FIRE_OPTIONS]).toEqual(['Feed the fire, or cook on it?', ['Feed the fire', 'Cook']]);
  });

  it('says what each meal does, before and after eating it', () => {
    const tea = real.get('fir-tip-tea'), stew = real.get('chanterelle-stew'), pemmican = real.get('berry-pemmican');
    expect([mealDoes(tea), mealDoes(stew), mealDoes(pemmican)]).toEqual(['15 more energy on your bar', 'cold bites 15% less', 'your bag feels 15% lighter']);
    expect(eatQuestion(tea)).toBe('Drink the fir-tip tea? 15 more energy on your bar until you come home.');
    expect(eatQuestion(stew)).toBe('Eat the chanterelle stew? Cold bites 15% less until you come home.');
    expect([useLabel(tea), useLabel(stew)]).toEqual(['Drink', 'Eat']);
    expect(didText({ kind: 'cooked', item: 'fir-tip-tea', count: 1 }, real)).toBe('You cook fir-tip tea. It is in your bag.');
    expect(didWho({ kind: 'cooked', item: 'fir-tip-tea', count: 1 }, real)).toBe('Fire');
    expect(didText({ kind: 'ate', item: 'fir-tip-tea', energy: 15 }, real)).toBe('You drink the fir-tip tea. 15 more energy on your bar until you come home.');
    expect(didText({ kind: 'ate', item: 'berry-pemmican' }, real)).toBe('You eat the berry pemmican. Your bag feels 15% lighter until you come home.');
    expect(didWho({ kind: 'ate', item: 'berry-pemmican' }, real)).toBe('Berry pemmican');
  });

  it('says why a meal cannot be eaten yet, and what is in you on the status panel', () => {
    expect(ateAlready(real.get('fir-tip-tea'))).toBe('You drank the fir-tip tea this trip already. It works until you come home.');
    expect(ateAlready(real.get('chanterelle-stew'))).toBe('You ate the chanterelle stew this trip already. It works until you come home.');
    expect(TWO_MEALS).toBe('You ate two meals this trip already. Another waits until you are home again.');
    expect(mealsText(['fir-tip-tea', 'berry-pemmican'], real)).toBe('Fir-tip tea: 15 more energy on your bar. Berry pemmican: your bag feels 15% lighter. Until you come home.');
    expect(mealsText([], real)).toBeNull();
    expect([refusalText('fire_out', 'cook'), refusalText('missing', 'cook'), refusalText('ate_it', 'use'), refusalText('two_meals', 'use')]).toEqual([
      'The fire is out: nothing cooks on it', 'You do not carry what it takes', 'You ate that this trip already', 'You ate two meals this trip already',
    ]);
    const rows = statusView({
      energy: FULL, body: { ...DRY, meals: ['chanterelle-stew'] }, surge: null, caught: false, storm: null, flash: null, weather: 'overcast', wilds: true, stone: ASLEEP, stats: {}, bag: [],
      items: real, progress: START, resists: null, wear: null, quirks: [],
    }).rows;
    expect(rows.find(r => r.label === 'Meals')).toEqual({ label: 'Meals', text: 'Chanterelle stew: cold bites 15% less. Until you come home.', tone: 'good' });
  });

  it('shows food and meals for what they are in the bag', () => {
    expect(factsOf(real.get('fir-tips'), real)).toContain('Cooks at a fire');
    expect(factsOf(real.get('fir-tip-tea'), real)).toContain('A meal: it works until you come home');
    expect(factsOf(real.get('resin'), real)).not.toContain('Cooks at a fire');
    // A meal's card greys its button once it cannot be eaten this trip, and says why.
    const state = { items: real, bag: [{ item: 'fir-tip-tea', count: 1 }], stash: [], gear: {}, worn: {}, panel: 'bag' as const };
    expect(detailView({ from: 'bag', slot: 0, item: 'fir-tip-tea' }, state)?.act).toMatchObject({ label: 'Drink', enabled: true });
    const eaten = detailView({ from: 'bag', slot: 0, item: 'fir-tip-tea' }, { ...state, meals: ['fir-tip-tea'] })!;
    expect(eaten.act).toMatchObject({ label: 'Drink', enabled: false });
    expect(eaten.notes).toContainEqual({ text: ateAlready(real.get('fir-tip-tea')), tone: 'bad' });
    expect(detailView({ from: 'bag', slot: 0, item: 'fir-tip-tea' }, { ...state, meals: ['berry-pemmican', 'chanterelle-stew'] })!.notes).toContainEqual({ text: TWO_MEALS, tone: 'bad' });
    expect(itemIndex(json as ItemsData).size).toBe(real.byId.size);
  });
});

describe('a choice in the text box', () => {
  it('chooses among answers in words: up and down, stopping at either end, never counting', () => {
    let picked = -1;
    const q = new Question({ who: 'Fire', text: FIRE_CHOICE, options: FIRE_OPTIONS, count: { min: 1, max: 5 }, yes: () => {}, pick: i => { picked = i; } });
    expect(q.view()).toEqual({ who: 'Fire', text: FIRE_CHOICE, choice: 0, count: null, options: ['Feed the fire', 'Cook'] });
    expect(q.move('up')).toBe(false);
    expect(q.move('down')).toBe(true);
    expect(q.choice).toBe(1);
    expect(q.move('down')).toBe(false);
    expect(q.move('right')).toBe(false);
    q.ask.pick?.(q.choice as number);
    expect(picked).toBe(1);
  });
});

/** The woods of the fixtures, with a fire that burns down at 3,1, north of the clearing. */
const woods = (): MapData => ({ ...tinyWoods(), objects: [...tinyWoods().objects, { kind: 'fireplace', x: 3, y: 1 }] });
const items = new Items({
  version: 1,
  items: [
    { id: 'resin', name: 'Fir resin', noun: 'resin', plural: 'resin', kind: 'resource', stack: 20, text: 'Sticky.', fuel: 300 },
    { id: 'tips', name: 'Fir tips', noun: 'fir tip', kind: 'resource', stack: 10, text: 'Green.' },
    { id: 'berries', name: 'Huckleberries', noun: 'huckleberry', plural: 'huckleberries', kind: 'resource', stack: 10, text: 'Sweet.' },
    { id: 'tea', name: 'Fir-tip tea', noun: 'fir-tip tea', plural: 'fir-tip tea', kind: 'consumable', stack: 3, use: { meal: 'drink' }, eaten: { energy: 15 }, text: 'Hot.' },
    { id: 'cakes', name: 'Berry pemmican', noun: 'berry pemmican', plural: 'berry pemmican', kind: 'consumable', stack: 3, use: { meal: 'eat' }, eaten: { load: 0.85 }, text: 'Dense.' },
  ],
  finds: [],
  cooking: [
    { id: 'tea', make: 'tea', needs: [{ item: 'tips', count: 3 }] },
    { id: 'cakes', make: 'cakes', needs: [{ item: 'berries', count: 5 }] },
  ],
});
const maps = new Maps([woods(), houseTown(), cabin()]);
const me = (x: number, y: number): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir: 'up', color: '#f29e4c', gear: {}, quirks: [] });

let sent: ClientMsg[];
let g: Game;
const now = 1000;
/** At 3,2 in the woods, facing the fire at 3,1 (`left` seconds of fuel; null: someone keeps it going). */
function atTheFire(bag: Array<{ item: string; count: number }>, left: number | null = 600, meals?: string[]) {
  g.handle(welcome(woods(), [me(3, 2)], FULL, { fires: [{ x: 3, y: 1, left }], bag, items: items.version, body: { ...DRY, ...(meals ? { meals } : {}) } }), now);
}

beforeEach(() => {
  sent = [];
  g = new Game(maps, m => sent.push(m), items);
});

describe('at a fire', () => {
  it('offers a choice with something to cook and something to feed it: feed, or cook', () => {
    atTheFire([{ item: 'resin', count: 2 }, { item: 'tips', count: 3 }]);
    g.pressA();
    expect(g.askView()).toMatchObject({ who: 'Fire', text: FIRE_CHOICE, options: ['Feed the fire', 'Cook'], choice: 0 });
    // Feeding it, as ever.
    g.pressA();
    expect(g.askView()).toMatchObject({ text: 'Feed the fire resin?', choice: 'yes' });
    g.pressB();
    // Cooking: the one thing the bag can cook, asked first with what it uses.
    g.pressA();
    g.padChange('down', now);
    g.padChange(null, now);
    g.pressA();
    expect(g.askView()).toMatchObject({ who: 'Fire', text: 'Cook fir-tip tea? It uses 3 fir tips.', choice: 'yes' });
    g.pressA();
    expect(sent.at(-1)).toEqual({ t: 'cook', x: 3, y: 1, recipe: 'tea' });
    expect(g.note).toMatchObject({ waiting: true });
  });

  it('asks which, when the bag can cook more than one; B backs out of it', () => {
    atTheFire([{ item: 'tips', count: 3 }, { item: 'berries', count: 5 }]);
    // Nothing that burns: straight to cooking, and there are two things to cook.
    g.pressA();
    expect(g.askView()).toMatchObject({ text: WHAT_TO_COOK, options: ['Fir-tip tea', 'Berry pemmican'] });
    g.answer(1);
    expect(g.askView()?.text).toBe('Cook berry pemmican? It uses 5 huckleberries.');
    g.pressB();
    expect(g.question).toBeNull();
    expect(sent.filter(m => m.t === 'cook')).toEqual([]);
  });

  it('cooks at a fire someone keeps going without a choice, and says what the bag still lacks', () => {
    atTheFire([{ item: 'resin', count: 2 }, { item: 'tips', count: 3 }], null);
    g.pressA();
    expect(g.askView()?.text).toBe('Cook fir-tip tea? It uses 3 fir tips.');
    g.pressB();
    atTheFire([{ item: 'tips', count: 1 }], null);
    g.pressA();
    expect(g.note?.text).toBe('For fir-tip tea you need 2 more fir tips in your bag.');
  });

  it('feeds a dead fire as ever: nothing cooks on it until it burns again', () => {
    atTheFire([{ item: 'resin', count: 2 }, { item: 'tips', count: 3 }], 0);
    g.pressA();
    expect(g.askView()?.text).toBe('Feed the fire resin?');
  });
});

describe('eating from the bag', () => {
  it('asks first, and says why not when it is eaten already or two are', () => {
    atTheFire([{ item: 'tea', count: 2 }]);
    g.use(0);
    expect(g.askView()?.text).toBe('Drink the fir-tip tea? 15 more energy on your bar until you come home.');
    g.answer('yes');
    expect(sent.at(-1)).toEqual({ t: 'use', slot: 0 });
    atTheFire([{ item: 'tea', count: 2 }], 600, ['tea']);
    g.use(0);
    expect(g.question).toBeNull();
    expect(g.note?.text).toBe('You drank the fir-tip tea this trip already. It works until you come home.');
    atTheFire([{ item: 'cakes', count: 1 }], 600, ['tea', 'other']);
    g.use(0);
    expect(g.note?.text).toBe(TWO_MEALS);
  });

  it('says it over your head when what you ate wears off', () => {
    atTheFire([], 600, ['tea']);
    g.handle({ t: 'energy', energy: FULL, body: DRY }, now);
    expect(g.floats.map(f => f.text)).toEqual(['What you ate has worn off']);
  });
});
