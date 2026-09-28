/**
 * The lost and found, as the client shows it (lostfound.ts, roadmap/lost-and-found.md): A at someone
 * else's pile asks what to do, Take half or Carry it to the lodge for them (B backs out); a bundle in the
 * bag is someone else's things, as heavy as what it holds, with nothing to do but carry it; A at the box in
 * the lodge asks before handing in, or reads its sign; and the words for all of it, by name, never a pronoun.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { BUNDLE, type BagSlot, type Bundle, type ClientMsg, type DropView, type ItemsData, type MapData, type PlayerView } from '@napoland/shared';
import { detailView, type DetailState } from '../src/details';
import { Game } from '../src/game';
import { Items, slotViews } from '../src/items';
import { Maps } from '../src/maps';
import {
  IN_YOUR_CHEST, LOST_AND_FOUND, LOST_AND_FOUND_LINES, TAKE_HALF, bundleNotYours, carryLabel, didText, didWho, handInQuestion, pileQuestion, returnedLine, thingsOf,
} from '../src/said';
import { letterLines, returnedLines, thanksFor } from '../src/thanks';
import { tinyTown, tinyWoods, welcome } from './fixtures';

/** What players read comes from the real items and maps. */
const content = resolve(import.meta.dirname, '../../../content');
const items = new Items(JSON.parse(readFileSync(resolve(content, 'items.json'), 'utf8')) as ItemsData);
/** Every map, by id, as the game has them: a landmark names a door by the room it leads into. */
const real = new Map(readdirSync(resolve(content, 'maps')).filter(f => f.endsWith('.json')).map(f => {
  const m = JSON.parse(readFileSync(resolve(content, 'maps', f), 'utf8')) as MapData;
  return [m.id, m] as const;
}));
const find = (id: string) => real.get(id);
/** No pronoun ever stands for a player. */
const NO_PRONOUN = /\b(she|he|her|him|his|they|them|their)\b/i;

const anas: Bundle = { id: 'ana:1', owner: 'ana', name: 'Ana', map: 'near-woods', x: 21, y: 40, items: [{ item: 'resin', count: 4 }, { item: 'glowcap', count: 6 }] };
const tied: BagSlot = { item: BUNDLE, count: 1, bundle: anas };

describe('what the lost and found says', () => {
  it('asks at someone else\'s pile what to do, by name', () => {
    expect(pileQuestion('Ana')).toBe('What do you do with Ana\'s things?');
    expect(TAKE_HALF).toBe('Take half');
    expect(carryLabel('Ana')).toBe('Carry it to the lodge for Ana');
  });

  it('says what it did: carrying, handing in and what it earned', () => {
    expect(didWho({ kind: 'carried', names: ['Ana'] }, items)).toBe(thingsOf('Ana'));
    expect(didText({ kind: 'carried', names: ['Ana'] }, items)).toBe('You carry Ana\'s things now. Leave it all in the lost and found box in Stonebrook Lodge, by Walt, and it goes home.');
    expect(didText({ kind: 'carried', names: ['Bo', 'Ana'] }, items)).toBe('You carry Bo\'s things and Ana\'s things now. Leave it all in the lost and found box in Stonebrook Lodge, by Walt, and it goes home.');
    expect(didWho({ kind: 'handedIn', names: ['Ana'], xp: 6 }, items)).toBe(LOST_AND_FOUND);
    expect(didText({ kind: 'handedIn', names: ['Ana'], xp: 6 }, items)).toBe('You leave Ana\'s things in the box. Ana gets it all back at home. You earn 6 XP.');
    expect(didText({ kind: 'handedIn', names: ['Ana', 'Bo', 'Ana'], xp: 0 }, items)).toBe('You leave Ana\'s things and Bo\'s things in the box. Ana and Bo get it all back at home.');
    expect(handInQuestion(['Ana'])).toBe('Leave Ana\'s things in the lost and found box? Ana gets it all back at home.');
    expect(LOST_AND_FOUND_LINES.join(' ')).toContain('LOST AND FOUND');
  });

  it('tells the owner who carried it back and from where, by landmark: at once, or in the letter home', () => {
    expect(returnedLine('Bo', 'by the pond')).toBe('Bo carried what you lost by the pond back to the lodge.');
    expect(returnedLine(null, 'by the pond')).toBe('Someone carried what you lost by the pond back to the lodge.');
    // As the trip report says where you fell: by the pond, and how far the nearest door is, set off by commas.
    expect(returnedLine('Bo', 'by the pond, 36 steps from the old cabin')).toBe('Bo carried what you lost by the pond, 36 steps from the old cabin, back to the lodge.');
    expect(returnedLines([{ by: 'Bo', map: 'near-woods', x: 21, y: 40 }], find)).toEqual([
      'Bo carried what you lost by the pond, 36 steps from the old cabin, back to the lodge.', IN_YOUR_CHEST,
    ]);
    const four = Array.from({ length: 4 }, (_, i) => ({ by: `P${i}`, map: 'near-woods', x: 21, y: 40 }));
    expect(returnedLines(four, find)).toEqual([
      'P0 carried what you lost by the pond, 36 steps from the old cabin, back to the lodge.',
      'P1 carried what you lost by the pond, 36 steps from the old cabin, back to the lodge.',
      'And 2 more of your things came back.', 'It is all in your chest.',
    ]);
    // The carrier's thanks, in their own letter: whoever lost it is whoever thanked.
    const what = { kind: 'returned' as const, map: 'near-woods', x: 21, y: 40, who: 'ana' };
    expect(thanksFor(what, find, items, 'Ana')).toBe('bringing back what Ana lost by the pond, 36 steps from the old cabin');
    expect(letterLines([{ what, count: 1, people: 1, names: ['Ana'] }], find, items)).toEqual([
      'While you were away, Ana thanked you for bringing back what Ana lost by the pond, 36 steps from the old cabin.',
    ]);
  });

  it('names a bundle in the bag for whoever it belongs to, as heavy as what it holds, with nothing to do but carry it', () => {
    const [view] = slotViews([tied], items);
    expect(view).toMatchObject({ name: 'Ana\'s things', usable: false, facts: ['1.1 kg', 'Carried for Ana'] });
    const state = (panel: DetailState['panel']): DetailState => ({ items, bag: [tied], stash: [], gear: {}, worn: {}, panel, ...(panel === 'crate' ? { crate: { items: [], left: false, took: false, me: 'me' } } : {}) });
    const road = detailView({ from: 'bag', slot: 0, item: BUNDLE }, state('bag'))!;
    expect(road).toMatchObject({ name: 'Ana\'s things', facts: ['1.1 kg'] });
    expect(road.act).toBeUndefined();
    expect(road.more).toBeUndefined();
    for (const panel of ['home', 'crate'] as const) {
      const card = detailView({ from: 'bag', slot: 0, item: BUNDLE }, state(panel))!;
      expect(card.act?.enabled, panel).toBe(false);
      expect(card.notes, panel).toEqual([{ text: bundleNotYours('Ana'), tone: 'bad' }]);
    }
  });

  it('never stands a pronoun for a player', () => {
    for (const t of [
      pileQuestion('Ana'), carryLabel('Ana'), handInQuestion(['Ana', 'Bo']), bundleNotYours('Ana'), returnedLine('Bo', 'by the pond'),
      didText({ kind: 'carried', names: ['Ana'] }, items), didText({ kind: 'handedIn', names: ['Ana'], xp: 3 }, items),
    ]) expect(t).not.toMatch(NO_PRONOUN);
  });
});

/** The fixture woods, and a lodge of its own: the box at 1,1 (stand at 1,2), a fire at 2,1. */
function lodge(): MapData {
  return {
    id: 'lodge', name: 'The lodge', version: 1, kind: 'inside', depth: 0, width: 5, height: 5,
    tiles: ['xxxxx', 'xpppx', 'xpppx', 'xpppx', 'xxpxx'],
    levels: Array<string>(5).fill('00000'),
    spawn: { x: 2, y: 3, dir: 'up' },
    exits: [{ x: 2, y: 4, w: 1, h: 1, to: 'town', tx: 1, ty: 1, dir: 'down' }],
    objects: [{ kind: 'fireplace', x: 2, y: 1 }, { kind: 'lostfound', x: 1, y: 1 }],
  };
}
const maps = new Maps([tinyTown(), tinyWoods(), lodge()]);
const me = (x: number, y: number, dir: PlayerView['dir'] = 'up'): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir, color: '#f29e4c', gear: {}, quirks: [] });
const pile = (owner: string, name: string, x: number, y: number): DropView => ({ id: owner, x, y, owner, name, until: 1e13, trail: [] });

let sent: ClientMsg[];
let g: Game;
const now = 1000;
beforeEach(() => {
  sent = [];
  g = new Game(maps, m => sent.push(m), items);
});

describe('at someone else\'s pile', () => {
  it('asks what to do: A on Take half picks up half, as ever', () => {
    g.handle(welcome(tinyWoods(), [me(2, 2)], undefined, { drops: [pile('ana', 'Ana', 2, 1)], items: items.version }), now);
    g.pressA();
    expect(g.askView()).toEqual({ who: 'Ana\'s things', text: 'What do you do with Ana\'s things?', choice: 'yes', count: null, labels: { yes: 'Take half', no: 'Carry it to the lodge for Ana' } });
    expect(sent).toEqual([]);
    g.pressA();
    expect(sent).toEqual([{ t: 'pick', x: 2, y: 1 }]);
  });

  it('carries it to the lodge on the second answer, and the box says what it did', () => {
    g.handle(welcome(tinyWoods(), [me(2, 2)], undefined, { drops: [pile('ana', 'Ana', 2, 1)], items: items.version }), now);
    g.pressA();
    g.padChange('down', now);
    g.pressA();
    expect(sent).toEqual([{ t: 'carry', x: 2, y: 1, owner: 'ana' }]);
    g.handle({ t: 'did', did: { kind: 'carried', names: ['Ana'] } }, now);
    expect(g.note).toMatchObject({ who: 'Ana\'s things', text: expect.stringContaining('You carry Ana\'s things now.') });
  });

  it('backs out on B, or a tap outside the box: nothing goes', () => {
    g.handle(welcome(tinyWoods(), [me(2, 2)], undefined, { drops: [pile('ana', 'Ana', 2, 1)], items: items.version }), now);
    g.pressA();
    g.padChange('down', now);
    expect(g.pressB()).toBe(true);
    g.pressA();
    g.dismiss();
    expect(sent).toEqual([]);
    expect(g.question).toBeNull();
  });
});

describe('at the lost and found box', () => {
  it('reads its sign when you carry nothing for anyone', () => {
    g.handle(welcome(lodge(), [me(1, 2)], undefined, { items: items.version }), now);
    g.pressA();
    expect(g.dialog).toMatchObject({ who: LOST_AND_FOUND, lines: LOST_AND_FOUND_LINES });
    expect(sent).toEqual([]);
  });

  it('asks before handing in what you carry, and says what it did', () => {
    g.handle(welcome(lodge(), [me(1, 2)], undefined, { bag: [tied], items: items.version }), now);
    g.pressA();
    expect(g.askView()).toMatchObject({ who: LOST_AND_FOUND, text: handInQuestion(['Ana']), choice: 'yes' });
    g.pressA();
    expect(sent).toEqual([{ t: 'handIn', x: 1, y: 1 }]);
    g.handle({ t: 'did', did: { kind: 'handedIn', names: ['Ana'], xp: 6 } }, now);
    expect(g.note).toMatchObject({ who: LOST_AND_FOUND, text: 'You leave Ana\'s things in the box. Ana gets it all back at home. You earn 6 XP.' });
  });

  it('tells the owner at once, online, and in the letter home', () => {
    g.handle(welcome(tinyTown(), [me(3, 3)], undefined, { items: items.version }), now);
    g.handle({ t: 'returned', returned: { by: 'Bo', map: 'woods', x: 2, y: 4 } }, now);
    expect(g.note).toMatchObject({ who: LOST_AND_FOUND, text: `Bo carried what you lost by the way home back to the lodge. ${IN_YOUR_CHEST}` });
  });
});
