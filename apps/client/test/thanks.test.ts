import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { STEP_MS, type ClientMsg, type FireView, type ItemsData, type MapData, type MarkView, type PlayerView, type ThanksGroup } from '@napoland/shared';
import { Game } from '../src/game';
import { Items } from '../src/items';
import { Maps } from '../src/maps';
import { THANK_AFTER_MS, fireThanksQuestion, letterLines, markThanksQuestion, thankRefusal, thankedFloat, thankedLine, thanksFor } from '../src/thanks';
import { ITEMS, tinyTown, tinyWoods, welcome, zone } from './fixtures';

/** Every map as it ships, to name what a thanks was for. */
const content = resolve(import.meta.dirname, '../../../content/maps');
const real = new Map(readdirSync(content).filter(f => f.endsWith('.json')).map(f => {
  const d = JSON.parse(readFileSync(resolve(content, f), 'utf8')) as MapData;
  return [d.id, d] as const;
}));
const find = (id: string) => real.get(id);
const items = new Items(JSON.parse(readFileSync(resolve(content, '../items.json'), 'utf8')) as ItemsData);

describe('what thanks say', () => {
  it('asks by name, never with a pronoun', () => {
    expect(fireThanksQuestion('Ana')).toBe('Ana fed this fire. Thank Ana?');
    expect(markThanksQuestion('Ana')).toBe('Ana painted this arrow. Thank Ana?');
    expect(thankRefusal('thanked', 'Ana')).toBe('You thanked Ana today already. Thanks go once a day.');
    expect(thankRefusal('too_far', 'Ana')).toBe('You are too far away now to thank Ana.');
    expect(thankRefusal('gone', 'Ana')).toBe('It is too late to thank Ana for that.');
  });

  it('names the fire by its room or its own name, and an arrow by the nearest place the map names', () => {
    expect(thanksFor({ kind: 'fire', map: 'near-woods-ranger-hut', x: 3, y: 1 }, find, items)).toBe('the fire at the ranger\'s hut');
    expect(thanksFor({ kind: 'fire', map: 'south-road-laboratory', x: 5, y: 1 }, find, items)).toBe('the fire at the NAPO Laboratory');
    expect(thanksFor({ kind: 'fire', map: 'south-road', x: 22, y: 22 }, find, items)).toBe('the fire at the leavers\' camp');
    // The Near Woods' places: the pond (20,41) and the ring of stones (6,5) have no "the" of their own.
    expect(thanksFor({ kind: 'mark', map: 'near-woods', x: 21, y: 40 }, find, items)).toBe('your arrow by the pond');
    expect(thanksFor({ kind: 'mark', map: 'near-woods', x: 7, y: 7 }, find, items)).toBe('your arrow by the ring of stones');
    expect(thanksFor({ kind: 'mark', map: 'south-road', x: 50, y: 50 }, find, items)).toBe('your arrow by the Tower');
    // A fire in the open with no name of its own, and a map that names no places.
    const woods = tinyWoods(), open = { ...woods, objects: [...woods.objects, { kind: 'fireplace' as const, x: 3, y: 1 }] };
    expect(thanksFor({ kind: 'fire', map: 'woods', x: 3, y: 1 }, id => (id === 'woods' ? open : undefined), items)).toBe('the campfire in the Test Woods');
    expect(thanksFor({ kind: 'mark', map: 'woods', x: 2, y: 2 }, id => (id === 'woods' ? open : undefined), items)).toBe('your arrow in the Test Woods');
  });

  it('names what you left in a crate, and the crate by what people call it', () => {
    expect(thanksFor({ kind: 'cache', map: 'near-woods-old-cabin', x: 2, y: 1, item: 'resin' }, find, items)).toBe('the resin you left in the old cabin\'s crate');
    expect(thanksFor({ kind: 'cache', map: 'south-road', x: 19, y: 19, item: 'glowcap' }, find, items)).toBe('the glowcap you left in the crate at the leavers\' camp');
    expect(letterLines([{ what: { kind: 'cache', map: 'south-road-bunker', x: 1, y: 3, item: 'thermos' }, count: 1, people: 1, names: ['Ana'] }], find, items))
      .toEqual(['While you were away, Ana thanked you for the thermos you left in the bunker\'s crate.']);
  });

  it('floats over your head out in the wilds, and is a line anywhere else', () => {
    expect(thankedFloat('Tess', 3)).toBe('Tess thanked you: +3');
    expect(thankedFloat('Tess')).toBe('Tess thanked you');
    expect(thankedLine('Tess', 'your arrow by the pond')).toBe('Tess thanked you for your arrow by the pond.');
  });

  it('writes the letter home in three short lines at most, the most thanked first', () => {
    const hut = { kind: 'fire' as const, map: 'near-woods-ranger-hut', x: 3, y: 1 }, pond = { kind: 'mark' as const, map: 'near-woods', x: 21, y: 40 };
    const camp = { kind: 'fire' as const, map: 'south-road', x: 22, y: 22 }, lab = { kind: 'fire' as const, map: 'south-road-laboratory', x: 5, y: 1 };
    const g = (what: ThanksGroup['what'], count: number, people: number, names: string[]): ThanksGroup => ({ what, count, people, names });
    expect(letterLines([g(hut, 4, 4, ['Tess', 'Ana'])], find, items)).toEqual(['While you were away, 4 people thanked you for the fire at the ranger\'s hut.']);
    expect(letterLines([g(hut, 2, 2, ['Tess', 'Ana']), g(pond, 2, 1, ['Bo'])], find, items)).toEqual([
      'While you were away, Tess and Ana thanked you for the fire at the ranger\'s hut.',
      'Bo thanked you twice for your arrow by the pond.',
    ]);
    expect(letterLines([g(hut, 5, 5, ['Tess', 'Ana']), g(pond, 3, 3, ['Bo', 'Cy']), g(camp, 2, 2, ['Di', 'Ed']), g(lab, 1, 1, ['Fay'])], find, items)).toEqual([
      'While you were away, 5 people thanked you for the fire at the ranger\'s hut.',
      '3 people thanked you for your arrow by the pond.',
      'And 3 more thanks, for other things.',
    ]);
    expect(letterLines([], find, items)).toEqual([]);
  });
});

/**
 * A 7x7 patch of wilds, grass walled in by forest: a fire that burns down at 5,1 (it warms 4,1, 4,2 and
 * 5,2), and the way home at the bottom (3,6).
 */
function field(): MapData {
  return {
    id: 'field', name: 'The Field', version: 1, kind: 'wilds', depth: 1, width: 7, height: 7,
    tiles: ['ttttttt', 'tgggggt', 'tgggggt', 'tgggggt', 'tgggggt', 'tgggggt', 'tttmttt'],
    levels: Array<string>(7).fill('0000000'),
    spawn: { x: 3, y: 5, dir: 'up' },
    exits: [{ x: 3, y: 6, w: 1, h: 1, to: 'town', tx: 3, ty: 1, dir: 'down', home: true }],
    objects: [{ kind: 'fireplace', x: 5, y: 1 }],
  };
}
const maps = new Maps([tinyTown(), field(), tinyWoods()]);
const me = (x: number, y: number, dir: PlayerView['dir'] = 'up'): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir, color: '#f29e4c', gear: {}, quirks: [] });
const fire = (fed: string[], left: number | null = 600): FireView => ({ x: 5, y: 1, left, fed: fed.map(id => ({ id, name: id[0]!.toUpperCase() + id.slice(1) })) });
/** Bo's arrow at 2,4, pointing north onto 2,3. */
const arrow: MarkView = { id: 5, x: 2, y: 4, dir: 'up', color: '#fff', owner: 'bo', name: 'Bo', until: 1e13 };

let sent: ClientMsg[];
let g: Game;
let now: number;
/** A panel, the menu or the fade is up. */
let covered: boolean;
function run(ms: number) {
  for (let t = 0; t < ms; t += 1000 / 60) {
    now += 1000 / 60;
    g.update(1 / 60, now);
    g.idle(now, covered);
  }
}
function enter(at: [number, number], extras: Parameters<typeof welcome>[3] = {}) {
  g.handle(welcome(field(), [me(...at)], undefined, extras), now);
}
/** One step `dir` with the stick (turning first if you face another way), and standing again. */
function go(dir: PlayerView['dir']) {
  const turn = g.me?.dir !== dir;
  g.padChange(dir, now);
  // A turn walks once held a moment; facing that way already, it walks at once.
  run(turn ? STEP_MS * 1.25 : STEP_MS * 0.5);
  g.padChange(null, now);
  run(STEP_MS * 1.5);
  // The server says yes to it, so steps never wait for its answers.
  const step = sent.filter(m => m.t === 'step').at(-1), you = g.me!;
  if (step?.t === 'step') g.handle({ t: 'step', id: 'me', x: you.tx, y: you.ty, dir: you.dir, seq: step.seq }, now);
}
const thanks = () => sent.filter(m => m.t === 'thank');

beforeEach(() => {
  sent = [];
  now = 1000;
  covered = false;
  g = new Game(maps, m => sent.push(m), ITEMS);
});

describe('offering to thank someone who fed a fire', () => {
  it('asks after a few seconds by a burning fire someone else fed, standing still, and thanks them on YES', () => {
    enter([4, 2], { fires: [fire(['ana'])] });
    run(THANK_AFTER_MS - 200);
    expect(g.question).toBeNull();
    run(400);
    expect(g.askView()).toMatchObject({ who: 'Fire', text: 'Ana fed this fire. Thank Ana?', choice: 'yes' });
    g.pressA();
    expect(thanks()).toEqual([{ t: 'thank', who: 'ana', what: { kind: 'fire', x: 5, y: 1 } }]);
    g.handle({ t: 'did', did: { kind: 'thanked', who: 'ana', name: 'Ana', what: 'fire' } }, now);
    expect(g.note).toMatchObject({ who: 'Fire', text: 'You thank Ana for feeding the fire.' });
    // Thanked today: never offered again, even after walking away and back.
    g.pressA();
    go('down');
    go('up');
    run(THANK_AFTER_MS * 2);
    expect(g.question).toBeNull();
  });

  it('offers the latest who fed it and is neither you, thanked today nor blocked; never for yourself', () => {
    enter([4, 2], { fires: [fire(['me'])] });
    run(THANK_AFTER_MS * 2);
    expect(g.question).toBeNull();
    g.handle({ t: 'fire', fire: fire(['me', 'ana', 'bo']) }, now);
    run(100);
    expect(g.question?.text).toBe('Ana fed this fire. Thank Ana?');
    g = new Game(maps, m => sent.push(m), ITEMS);
    enter([4, 2], { fires: [fire(['ana', 'bo', 'cy'])], thanked: ['ana'] });
    g.handle({ t: 'friends', friends: [], incoming: [], outgoing: [], blocked: [{ id: 'bo', name: 'Bo' }], requestsOff: false, tradesOff: false }, now);
    run(THANK_AFTER_MS + 100);
    expect(g.question?.text).toBe('Cy fed this fire. Thank Cy?');
  });

  it('never asks at a fire that went out or that someone keeps, nor while the stick is held', () => {
    enter([4, 2], { fires: [fire(['ana'], 0)] });
    run(THANK_AFTER_MS * 2);
    expect(g.question).toBeNull();
    enter([4, 2], { fires: [fire(['ana'], null)] });
    run(THANK_AFTER_MS * 2);
    expect(g.question).toBeNull();
    // Pushing on (into the trees here): not until you stand.
    enter([4, 1], { fires: [fire(['ana'])] });
    g.padChange('up', now);
    run(THANK_AFTER_MS * 2);
    expect(g.question).toBeNull();
    g.padChange(null, now);
    run(100);
    expect(g.question?.text).toBe('Ana fed this fire. Thank Ana?');
  });

  it('after a NO, never again for that fire this session', () => {
    enter([4, 2], { fires: [fire(['ana'])] });
    run(THANK_AFTER_MS + 100);
    g.pressB();
    expect(g.question).toBeNull();
    go('down');
    go('down');
    go('up');
    go('up');
    run(THANK_AFTER_MS * 2);
    expect(g.question).toBeNull();
    expect(thanks()).toEqual([]);
  });

  it('waits while a panel or someone\'s lines are up, and drops the offer if you walked away meanwhile', () => {
    enter([4, 2], { fires: [fire(['ana'])] });
    covered = true;
    run(THANK_AFTER_MS * 2);
    expect(g.question).toBeNull();
    covered = false;
    run(100);
    expect(g.question?.text).toBe('Ana fed this fire. Thank Ana?');
    g.answer('no');
    // Another fire, another time: lines to read, then gone from its warmth before they are done.
    g = new Game(maps, m => sent.push(m), ITEMS);
    enter([4, 2], { fires: [fire(['bo'])] });
    g.handle({ t: 'board', lines: ['Rain.'] }, now);
    run(THANK_AFTER_MS * 2);
    expect(g.question).toBeNull();
    g.pressA();
    g.pressA();
    g.padChange('down', now);
    run(STEP_MS * 3);
    g.padChange(null, now);
    run(500);
    expect(g.question).toBeNull();
  });

  it('says why a thanks did not go through, with the name', () => {
    enter([4, 2], { fires: [fire(['ana'])] });
    run(THANK_AFTER_MS + 100);
    g.pressA();
    g.handle({ t: 'refused', action: 'thank', reason: 'thanked' }, now);
    expect(g.note?.text).toBe('You thanked Ana today already. Thanks go once a day.');
  });

  it('offers again the next UTC day whom you thanked today', () => {
    // A welcome ten seconds before midnight (UTC), Ana thanked that day.
    g.handle({ ...welcome(field(), [me(4, 2)], undefined, { fires: [fire(['ana'])], thanked: ['ana'] }), serverTime: 86_400_000 - 10_000 }, now);
    run(THANK_AFTER_MS + 100);
    expect(g.question).toBeNull();
    run(10_000);
    expect(g.question?.text).toBe('Ana fed this fire. Thank Ana?');
  });
});

describe('offering to thank someone for an arrow', () => {
  it('asks once you stop where it points, after stepping off it the way it points', () => {
    enter([2, 4], { marks: [arrow] });
    go('up');
    expect(g.askView()).toMatchObject({ who: 'Arrow', text: 'Bo painted this arrow. Thank Bo?' });
    g.pressA();
    expect(thanks()).toEqual([{ t: 'thank', who: 'bo', what: { kind: 'mark', id: 5 } }]);
    g.handle({ t: 'did', did: { kind: 'thanked', who: 'bo', name: 'Bo', what: 'mark' } }, now);
    expect(g.note).toMatchObject({ who: 'Arrow', text: 'You thank Bo for the arrow.' });
  });

  it('never when you walk straight on past it, or come onto that tile any other way', () => {
    enter([2, 4], { marks: [arrow] });
    g.padChange('up', now);
    run(STEP_MS * 2.5);
    g.padChange(null, now);
    run(STEP_MS * 2);
    expect(g.question).toBeNull();
    // From the side, onto the tile it points to.
    enter([1, 3], { marks: [arrow] });
    go('right');
    expect(g.me).toMatchObject({ tx: 2, ty: 3 });
    expect(g.question).toBeNull();
  });

  it('never for your own arrow, and never again for one you said no to', () => {
    enter([2, 4], { marks: [{ ...arrow, owner: 'me', name: 'Aldo' }] });
    go('up');
    expect(g.me).toMatchObject({ tx: 2, ty: 3 });
    expect(g.question).toBeNull();
    // Another map and back: whatever was about to be offered went with the old one.
    g.handle(zone(tinyWoods(), 2, 4, [me(2, 4)]), now);
    g.handle(zone(field(), 2, 4, [me(2, 4)], 'exit', { marks: [arrow] }), now);
    go('up');
    expect(g.question?.text).toBe('Bo painted this arrow. Thank Bo?');
    g.answer('no');
    go('down');
    go('up');
    expect(g.me).toMatchObject({ tx: 2, ty: 3 });
    expect(g.question).toBeNull();
  });
});

describe('thanks that reach you', () => {
  it('float over your head out in the wilds, and are said in the text box anywhere else', () => {
    enter([3, 3]);
    g.handle({ t: 'thanked', name: 'Tess', what: { kind: 'fire', map: 'field', x: 5, y: 1 }, energy: 3 }, now);
    expect(g.floats.map(f => f.text)).toEqual(['Tess thanked you: +3']);
    g.handle({ t: 'thanked', name: 'Tess', what: { kind: 'fire', map: 'field', x: 5, y: 1 }, line: true }, now);
    expect(g.note).toMatchObject({ who: 'Thanks', text: 'Tess thanked you for the campfire in the Field.' });
  });

  it('come in a letter home, once nothing else is up', () => {
    enter([3, 3]);
    covered = true;
    g.handle({ t: 'letter', thanks: [{ what: { kind: 'fire', map: 'field', x: 5, y: 1 }, count: 3, people: 3, names: ['Tess', 'Ana'] }] }, now);
    run(500);
    expect(g.dialog).toBeNull();
    covered = false;
    run(100);
    expect(g.dialog).toMatchObject({ who: 'Letter', lines: ['While you were away, 3 people thanked you for the campfire in the Field.'] });
    // The letter has the box: no offer comes through it.
    expect(g.question).toBeNull();
  });
});
