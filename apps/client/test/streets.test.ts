/**
 * Your street, as the client shows it: whose each lot is and who is home (their window lit), the name
 * plates near you, knocking at a neighbor's door and what it says back, never walking into one, and at
 * your own door the offer to move next to a friend. On Residents' Lane as it ships, since players read
 * its words there.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { lotDoors, type ClientMsg, type Dir, type MapData, type PlayerView, type StreetView } from '@napoland/shared';
import { Game } from '../src/game';
import { refusalText } from '../src/items';
import { Maps } from '../src/maps';
import { areaOf, mapFor } from '../src/papermap';
import { DOOR_SETTING, NO_MOVES, cabinWho, didText, doorText, knockedText, moveQuestion, streetLetterLines } from '../src/said';
import { friendsView } from '../src/friends';
import { ITEMS, tinyTown, welcome, zone } from './fixtures';

const read = (id: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../content/maps/${id}.json`), 'utf8')) as MapData;
const lane = read('residents-lane'), home = read('stonebrook-home'), stonebrook = read('stonebrook');
const doors = lotDoors(lane);
/** Lot 0 is yours (Aldo's), Bo lives next door and is home, lot 2 is empty, Cy lives on lot 3 and is out. */
const STREET: StreetView = { mine: 0, lots: [{ name: 'Aldo' }, { name: 'Bo', home: true }, null, { name: 'Cy' }, ...Array<null>(doors.length - 4).fill(null)] };
const me = (x: number, y: number, dir: Dir = 'up'): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir, color: '#f29e4c', gear: {}, quirks: [] });
/** In front of lot `n`'s door. */
const doorstep = (n: number) => ({ x: doors[n]!.x, y: doors[n]!.y + 1 });

let sent: ClientMsg[];
let g: Game;
let now: number;
function run(ms: number) {
  for (let t = 0; t < ms; t += 1000 / 60) { now += 1000 / 60; g.update(1 / 60, now); }
}
/** On the street, standing at `at` facing `dir`. */
function standAt(at: { x: number; y: number }, dir: Dir = 'up') {
  g.handle({ ...welcome(lane, [me(at.x, at.y, dir)]), street: STREET }, now);
  sent.length = 0;
}

beforeEach(() => {
  sent = [];
  now = 1000;
  g = new Game(new Maps([lane, home, tinyTown()]), m => sent.push(m), ITEMS);
});

describe('your street', () => {
  it('is learned with the map: whose each lot is, who is home, and which is yours; a lot that changes lights or darkens its window', () => {
    standAt(doorstep(0));
    expect(g.street).toEqual(STREET);
    expect([...g.litLots()]).toEqual([1]);
    const before = g.streetChanges;
    g.handle({ t: 'lot', lot: 1, view: { name: 'Bo' } }, now);
    g.handle({ t: 'lot', lot: 3, view: { name: 'Cy', home: true } }, now);
    g.handle({ t: 'lot', lot: 2, view: { name: 'Dee' } }, now);
    expect([...g.litLots()]).toEqual([3]);
    expect(g.street!.lots.slice(0, 4)).toEqual([{ name: 'Aldo' }, { name: 'Bo' }, { name: 'Dee' }, { name: 'Cy', home: true }]);
    expect(g.streetChanges).toBe(before + 3);
    // A lot the street does not have is none of ours.
    g.handle({ t: 'lot', lot: doors.length, view: { name: 'Eve' } }, now);
    expect(g.street!.lots).toHaveLength(doors.length);
    // Off the street, there is none.
    g.handle(zone(tinyTown(), 3, 3, [me(3, 3)]), now);
    expect(g.street).toBeNull();
    expect(g.litLots().size).toBe(0);
  });

  it('shows the name plates of the cabins near you, never of an empty lot', () => {
    // Between your door and Bo's: both plates.
    standAt({ x: (doors[0]!.x + doors[1]!.x) / 2, y: doors[0]!.y + 1 });
    expect(g.platesNear().map(p => [p.lot, p.name])).toEqual([[0, 'Aldo'], [1, 'Bo']]);
    // In front of the empty lot: Bo's and Cy's, on either side, but none of its own.
    standAt(doorstep(2));
    expect(g.platesNear().map(p => p.name)).toEqual([]);
    standAt({ x: doors[2]!.x - 2, y: doors[2]!.y + 1 });
    expect(g.platesNear().map(p => p.name)).toEqual(['Bo']);
  });
});

describe('a neighbor\'s door', () => {
  it('is knocked at with A: the box says you knock, then whether they are home', () => {
    standAt(doorstep(1));
    g.pressA();
    expect(sent).toEqual([{ t: 'knock', ...doors[1]! }]);
    expect(g.note).toMatchObject({ who: 'Bo\'s cabin', text: 'You knock.', waiting: true });
    g.handle({ t: 'door', ...doors[1]!, lot: { name: 'Bo', home: true } }, now);
    expect(g.note).toMatchObject({ who: 'Bo\'s cabin', text: 'Bo is home.', waiting: false });
    g.note = null;
    standAt(doorstep(3));
    g.pressA();
    g.handle({ t: 'door', ...doors[3]!, lot: { name: 'Cy' } }, now);
    expect(g.note).toMatchObject({ who: 'Cy\'s cabin', text: 'Nobody answers.' });
    // Too soon after the last knock: said in the same box.
    g.note = null;
    g.pressA();
    g.handle({ t: 'refused', action: 'knock', reason: 'slow_down' }, now);
    expect(g.note).toMatchObject({ who: 'Cy\'s cabin', text: 'Give them a moment to answer.' });
  });

  it('where nobody lives yet, says so without knocking', () => {
    standAt(doorstep(2));
    g.pressA();
    expect(sent).toEqual([]);
    expect(g.note).toMatchObject({ who: 'Empty cabin', text: 'Nobody lives here yet.' });
  });

  it('is never walked into; your own is', () => {
    standAt(doorstep(1));
    g.padChange('up', now);
    run(400);
    expect(sent.filter(m => m.t === 'step')).toEqual([]);
    standAt(doorstep(0));
    g.padChange('up', now);
    run(20);
    expect(sent.filter(m => m.t === 'step')).toEqual([{ t: 'step', dir: 'up', seq: expect.any(Number) }]);
  });

  it('tapped, is walked up to and knocked at; your own, tapped, is walked into', () => {
    standAt({ x: doors[1]!.x - 1, y: doors[1]!.y + 1 }, 'left');
    g.tapTile(doors[1]!.x, doors[1]!.y);
    run(20);
    const [step] = sent.filter(m => m.t === 'step');
    expect(step).toMatchObject({ dir: 'right' });
    g.handle({ t: 'step', id: 'me', x: doors[1]!.x, y: doors[1]!.y + 1, dir: 'right', seq: (step as { seq: number }).seq }, now);
    run(400);
    expect(sent).toContainEqual({ t: 'knock', ...doors[1]! });
    g.handle({ t: 'door', ...doors[1]!, lot: { name: 'Bo', home: true } }, now);
    g.note = null;
    standAt({ x: doors[0]!.x, y: doors[0]!.y + 2 }, 'down');
    g.tapTile(doors[0]!.x, doors[0]!.y);
    run(20);
    expect(sent.filter(m => m.t === 'step')).toEqual([{ t: 'step', dir: 'up', seq: expect.any(Number) }]);
    expect(sent.filter(m => m.t === 'knock')).toEqual([]);
  });

  it('knocked at while you are home, says who knocked in your text box', () => {
    g.handle(welcome(home, [me(4, 2, 'down')]), now);
    g.handle({ t: 'knocked', name: 'Bo' }, now);
    expect(g.note).toMatchObject({ who: 'Door', text: 'Bo knocked.' });
  });
});

describe('your own door', () => {
  it('offers to move next to each friend whose street has room, one after the other; YES moves you', () => {
    standAt(doorstep(0));
    g.pressA();
    expect(sent).toEqual([{ t: 'knock', ...doors[0]! }]);
    g.handle({ t: 'doorstep', moves: [{ id: 'a1', name: 'Ana' }, { id: 'c1', name: 'Cy' }] }, now);
    expect(g.askView()).toMatchObject({ who: 'Your cabin', text: 'Move next to Ana? Your cabin comes with you.', choice: 'yes' });
    g.answer('no');
    expect(g.askView()).toMatchObject({ text: 'Move next to Cy? Your cabin comes with you.' });
    g.answer('yes');
    expect(sent.at(-1)).toEqual({ t: 'move', to: 'c1' });
    expect(g.note).toMatchObject({ who: 'Your cabin', waiting: true });
    g.handle({ t: 'did', did: { kind: 'moved', name: 'Cy' } }, now);
    expect(g.note).toMatchObject({ who: 'Your cabin', text: 'Your cabin stands next to Cy\'s now.' });
  });

  it('says how it works when no friend has room, and why a move could not happen', () => {
    standAt(doorstep(0));
    g.pressA();
    g.handle({ t: 'doorstep', moves: [] }, now);
    expect(g.note).toMatchObject({ who: 'Your cabin', text: NO_MOVES });
    g.note = null;
    g.pressA();
    g.handle({ t: 'doorstep', moves: [{ id: 'a1', name: 'Ana' }] }, now);
    g.answer('yes');
    g.handle({ t: 'refused', action: 'move', reason: 'street_full' }, now);
    expect(g.note).toMatchObject({ who: 'Your cabin', text: 'Their street has no lot free.' });
  });
});

describe('a door kept to oneself', () => {
  it('shows a resident on the plate, never a lit window, and is knocked at under that name', () => {
    g.handle({ ...welcome(lane, [me(doorstep(1).x, doorstep(1).y)]), street: { ...STREET, lots: [STREET.lots[0]!, {}, ...STREET.lots.slice(2)] } }, now);
    sent.length = 0;
    expect(g.litLots().has(1)).toBe(false);
    expect(g.platesNear().map(p => [p.lot, p.name])).toEqual([[1, 'A resident']]);
    g.pressA();
    expect(sent).toEqual([{ t: 'knock', ...doors[1]! }]);
    expect(g.note).toMatchObject({ who: 'A resident\'s cabin', text: 'You knock.' });
    g.handle({ t: 'door', ...doors[1]!, lot: {} }, now);
    expect(g.note).toMatchObject({ who: 'A resident\'s cabin', text: 'Nobody answers.' });
  });

  it('is yours to set, beside friend and trade requests: the welcome says how it stands, and the server says it back', () => {
    const view = () => friendsView(null, g, () => undefined);
    standAt(doorstep(0));
    expect(g.doorOff).toBe(false);
    expect(view().doorOff).toBe(false);
    const before = g.socialChanges;
    g.setDoorOff(true);
    expect(sent).toEqual([{ t: 'doorOff', off: true }]);
    // Nothing changes until the server says so.
    expect(g.doorOff).toBe(false);
    g.handle({ t: 'doorOff', off: true }, now);
    expect([g.doorOff, view().doorOff]).toEqual([true, true]);
    expect(g.socialChanges).toBeGreaterThan(before);
    // Back in the game, the welcome says it.
    g.handle({ ...welcome(lane, [me(doorstep(0).x, doorstep(0).y)]), street: STREET, doorOff: true }, now);
    expect(g.doorOff).toBe(true);
    g.handle({ ...welcome(lane, [me(doorstep(0).x, doorstep(0).y)]), street: STREET }, now);
    expect(g.doorOff).toBe(false);
    expect(DOOR_SETTING).toBe('Show my name on my door and when I am home');
  });
});

describe('the letter about your street', () => {
  it('comes once the box is free, as a letter, and waits behind another', () => {
    g.handle(welcome(home, [me(4, 2, 'down')]), now);
    g.handle({ t: 'streetLetter', doorOff: false }, now);
    g.handle({ t: 'letter', thanks: [{ what: { kind: 'mark', map: 'residents-lane', x: 2, y: 23 }, count: 1, people: 1, names: ['Bo'] }] }, now);
    g.idle(now, false);
    expect(g.dialog).toMatchObject({ who: 'Letter', lines: streetLetterLines(false) });
    g.dialog = null;
    // The thanks were not lost: they come next.
    g.idle(now, false);
    expect(g.dialog).toMatchObject({ who: 'Letter' });
    expect(g.dialog!.lines[0]).toMatch(/^While you were away, Bo thanked you/);
    g.dialog = null;
    g.idle(now, false);
    expect(g.dialog).toBeNull();
  });

  it('says what the street sees of you, and where to change it', () => {
    expect(streetLetterLines(false)).toEqual([
      'Your cabin stands on Residents\' Lane now. Your neighbors see your name on your door, and your window lit while you are home.',
      'You can hide both in the menu, under Friends.',
    ]);
    expect(streetLetterLines(true)).toEqual([
      'Your cabin stands on Residents\' Lane now. Your neighbors see a resident\'s cabin: your name stays off your door, and your window dark, as you chose.',
      'You can show both in the menu, under Friends.',
    ]);
  });
});

describe('the words', () => {
  it('say what the door says, by name', () => {
    expect(doorText({ name: 'Bo', home: true })).toBe('Bo is home.');
    expect(doorText({ name: 'Bo' })).toBe('Nobody answers.');
    expect(doorText(null)).toBe('Nobody lives here yet.');
    // A resident who keeps their door to themselves answers only friends: to anyone else, nobody answers.
    expect(doorText({})).toBe('Nobody answers.');
    expect([cabinWho({ name: 'Bo' }), cabinWho({}), cabinWho(null)]).toEqual(['Bo\'s cabin', 'A resident\'s cabin', 'Empty cabin']);
    expect(knockedText('Bo')).toBe('Bo knocked.');
    expect(moveQuestion('Ana')).toBe('Move next to Ana? Your cabin comes with you.');
    expect(didText({ kind: 'moved', name: 'Ana' }, ITEMS)).toBe('Your cabin stands next to Ana\'s now.');
  });

  it('say why a move or a knock is refused', () => {
    expect(refusalText('street_full', 'move')).toBe('Their street has no lot free');
    expect(refusalText('neighbors', 'move')).toBe('You live on the same street already');
    expect(refusalText('not_friends', 'move')).toBe('You can only move next to friends');
    expect(refusalText('too_far', 'move')).toBe('Only at your own door');
    expect(refusalText('gone', 'move')).toBe('They have no cabin on a street yet');
    expect(refusalText('slow_down', 'knock')).toBe('Give them a moment to answer');
    expect(refusalText('slow_down', 'move')).toBe('You only just moved');
    // Elsewhere as before.
    expect(refusalText('not_friends', 'tell')).toBe('You can only message friends');
    expect(refusalText('too_far', 'pick')).toBe('Too far');
  });
});

describe('the paper map', () => {
  it('on your street and in your cabin is the map of Stonebrook, whose house leads onto the lane', () => {
    const all = [lane, home, stonebrook];
    const find = (id: string) => all.find(m => m.id === id);
    expect(areaOf('residents-lane', find)).toBe('stonebrook');
    expect(areaOf('stonebrook-home', find)).toBe('stonebrook');
    expect(mapFor('stonebrook-home', ['town-map'], t => (t === 'town-map' ? 'stonebrook' : undefined), find)).toBe('town-map');
  });
});
