/**
 * A window to be saved (roadmap/rescue-window.md), as the client shows it: while you are down, a quiet
 * countdown and "Someone may come.", no walking and no acting; local chat says where someone is down, by
 * landmark; A at someone down asks to give them 20 of your energy, or says you have too little; and the
 * words for all of it, by name, never a pronoun.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { RESCUE_ENERGY, SLUMP_S, STEP_MS, type ClientMsg, type EnergyView, type ItemsData, type MapData, type PlayerView } from '@napoland/shared';
import { Game } from '../src/game';
import { slumpLook } from '../src/hud';
import { Items } from '../src/items';
import { Maps } from '../src/maps';
import {
  SOMEONE_MAY_COME, YOU_ARE_DOWN, didText, didWho, downLine, raisedText, rescueQuestion, rescueRefusal, rescueTooTired,
} from '../src/said';
import { letterLines, thanksFor } from '../src/thanks';
import { ITEMS, tinyTown, welcome } from './fixtures';

/** Every map as it ships, to name where a thanks was for. */
const content = resolve(import.meta.dirname, '../../../content/maps');
const real = new Map(readdirSync(content).filter(f => f.endsWith('.json')).map(f => {
  const d = JSON.parse(readFileSync(resolve(content, f), 'utf8')) as MapData;
  return [d.id, d] as const;
}));
const find = (id: string) => real.get(id);
const items = new Items(JSON.parse(readFileSync(resolve(content, '../items.json'), 'utf8')) as ItemsData);

describe('what the window to be saved says', () => {
  it('counts down quietly while you are down, and says someone may come', () => {
    expect(SOMEONE_MAY_COME).toBe('Someone may come.');
    expect(slumpLook(SLUMP_S)).toEqual({ clock: '1:30', text: 'Someone may come.' });
    expect(slumpLook(83.2)).toEqual({ clock: '1:24', text: 'Someone may come.' });
    expect(slumpLook(0)).toEqual({ clock: '0:00', text: 'Someone may come.' });
    expect(slumpLook(null)).toBeNull();
  });

  it('tells local chat where someone is down, by landmark, and your own line with you', () => {
    expect(downLine('Ana', 'by the pond')).toBe('Ana is down by the pond.');
    expect(downLine('Ana', '12 steps from the crossroads')).toBe('Ana is down 12 steps from the crossroads.');
    expect(downLine('Aldo', 'by the pond', true)).toBe('You are down by the pond.');
  });

  it('asks before you give your energy, says when you have too little, and what it did: by name, never a pronoun', () => {
    expect(rescueQuestion('Ana', 64.7)).toBe(`Give Ana ${RESCUE_ENERGY} of your energy? Ana gets up with it, and you keep 44.`);
    expect(rescueTooTired('Ana', 18.4)).toBe(`Getting Ana up takes ${RESCUE_ENERGY} of your energy, and you need more than that. You have 18.`);
    expect(didText({ kind: 'rescued', who: 'ana', name: 'Ana' }, items)).toBe(`You give Ana ${RESCUE_ENERGY} of your energy. Ana is back up.`);
    expect(didWho({ kind: 'rescued', who: 'ana', name: 'Ana' }, items)).toBe('Ana');
    expect(raisedText('Bo', true)).toBe(`Bo gives you ${RESCUE_ENERGY} energy, and you are back on your feet. You thank Bo.`);
    expect(raisedText('Bo')).toBe(`Bo gives you ${RESCUE_ENERGY} energy, and you are back on your feet.`);
    expect(rescueRefusal('too_tired', 'Ana')).toBe(`You need more than ${RESCUE_ENERGY} energy to get Ana up.`);
    expect(rescueRefusal('too_far', 'Ana')).toBe('You are too far from Ana now.');
    expect(rescueRefusal('gone', 'Ana')).toBe('Ana is not down any more.');
    expect(rescueRefusal('down', 'Ana')).toBe(YOU_ARE_DOWN);
    for (const t of [rescueQuestion('Ana', 50), rescueTooTired('Ana', 5), raisedText('Bo', true), rescueRefusal('gone', 'Ana')]) expect(t).not.toMatch(/\b(she|he|her|him|his|they|them|their)\b/i);
  });

  it('names a rescue in the letter home by who was down and where, by landmark', () => {
    // As the trip report says where you fell: right by the pond, and how far the nearest door is.
    const pond = { kind: 'rescue' as const, map: 'near-woods', x: 21, y: 40, who: 'ana' };
    expect(thanksFor(pond, find, items, 'Ana')).toBe('getting Ana back up by the pond, 36 steps from the old cabin');
    expect(letterLines([{ what: pond, count: 1, people: 1, names: ['Ana'] }], find, items)).toEqual([
      'While you were away, Ana thanked you for getting Ana back up by the pond, 36 steps from the old cabin.',
    ]);
    // By a cabin's door: the room's name, and how far the next door is.
    const deep = { kind: 'rescue' as const, map: 'near-woods', x: 55, y: 6, who: 'ana' };
    expect(thanksFor(deep, find, items, 'Ana')).toBe('getting Ana back up by the cabin at the end, 39 steps from the ranger\'s hut');
  });
});

/**
 * A 7x7 patch of wilds, grass walled in by forest, the way home at the bottom (3,6); the pond is a place it
 * names at 1,1.
 */
function field(): MapData {
  return {
    id: 'field', name: 'The Field', version: 1, kind: 'wilds', depth: 1, width: 7, height: 7,
    tiles: ['ttttttt', 'tgggggt', 'tgggggt', 'tgggggt', 'tgggggt', 'tgggggt', 'tttmttt'],
    levels: Array<string>(7).fill('0000000'),
    spawn: { x: 3, y: 5, dir: 'up' },
    exits: [{ x: 3, y: 6, w: 1, h: 1, to: 'town', tx: 3, ty: 1, dir: 'down', home: true }],
    objects: [],
    places: [{ name: 'pond', x: 1, y: 1 }],
  };
}
const maps = new Maps([tinyTown(), field()]);
const person = (id: string, name: string, x: number, y: number, dir: PlayerView['dir'] = 'up', more: Partial<PlayerView> = {}): PlayerView => ({
  id, name, x, y, dir, color: '#f29e4c', gear: {}, quirks: [], ...more,
});
const energy = (value: number): EnergyView => ({ value, max: 100, rate: -0.3 });

let sent: ClientMsg[];
let g: Game;
let now: number;
function run(ms: number) {
  for (let t = 0; t < ms; t += 1000 / 60) {
    now += 1000 / 60;
    g.update(1 / 60, now);
    g.idle(now, false);
  }
}

beforeEach(() => {
  sent = [];
  now = 1000;
  g = new Game(maps, m => sent.push(m), ITEMS);
});

describe('down out there', () => {
  it('counts down from what the server says, and neither walks nor acts until someone comes', () => {
    g.handle(welcome(field(), [person('me', 'Aldo', 3, 4)], energy(0.2)), now);
    g.handle({ t: 'energy', energy: { value: 0, max: 100, rate: 0 }, body: { wet: 0, wetRate: 0, load: 0, hitched: false, worn: {} } }, now);
    g.handle({ t: 'slump', left: SLUMP_S }, now);
    g.handle({ t: 'down', id: 'me', on: true }, now);
    expect(g.slumpLeft(now)).toBe(SLUMP_S);
    run(10_000);
    expect(g.slumpLeft(now)).toBeCloseTo(SLUMP_S - 10, 0);
    // The stick, a tap on the world and A do nothing.
    g.padChange('up', now);
    run(STEP_MS * 3);
    g.padChange(null, now);
    g.tapTile(3, 1);
    run(STEP_MS * 5);
    g.pressA();
    expect(sent.filter(m => m.t === 'step' || m.t === 'rescue' || m.t === 'pick')).toEqual([]);
    expect(g.avatars().find(a => a.id === 'me')?.down).toBe(true);
    // A flare by you: longer.
    g.handle({ t: 'slump', left: 170 }, now);
    expect(g.slumpLeft(now)).toBe(170);
    // Someone came: up, and the box says who and what.
    g.handle({ t: 'down', id: 'me', on: false }, now);
    g.handle({ t: 'raised', by: { id: 'bo', name: 'Bo' }, thanked: true }, now);
    expect(g.slumpLeft(now)).toBeNull();
    expect(g.note).toMatchObject({ who: 'Bo', text: raisedText('Bo', true) });
    expect(g.avatars().find(a => a.id === 'me')?.down).toBe(false);
  });

  it('puts where someone is down in local chat, as the game\'s own line, with a dot on the chat', () => {
    g.handle(welcome(field(), [person('me', 'Aldo', 3, 4), person('ana', 'Ana', 1, 2)]), now);
    g.handle({ t: 'slumped', id: 'ana', name: 'Ana', where: 'by the pond' }, now);
    expect(g.chat.at(-1)).toEqual({ to: 'local', id: 'ana', name: 'Ana', text: 'Ana is down by the pond.', mine: false, system: true });
    expect(g.chatNews).toBe(true);
    g.handle({ t: 'slumped', id: 'me', name: 'Aldo', where: 'by the pond' }, now);
    expect(g.chat.at(-1)).toMatchObject({ text: 'You are down by the pond.', mine: true, system: true });
  });

  it('asks at someone down you face to give them 20 of your energy, and sends it on YES', () => {
    g.handle(welcome(field(), [person('me', 'Aldo', 3, 4, 'up'), person('ana', 'Ana', 3, 3, 'down', { down: true })], energy(64.7)), now);
    expect(g.action()).toEqual({ kind: 'rescue', id: 'ana', name: 'Ana' });
    g.pressA();
    expect(g.askView()).toMatchObject({ who: 'Ana', text: rescueQuestion('Ana', 64.7), choice: 'yes' });
    g.pressA();
    expect(sent.filter(m => m.t === 'rescue')).toEqual([{ t: 'rescue', who: 'ana' }]);
    g.handle({ t: 'did', did: { kind: 'rescued', who: 'ana', name: 'Ana' } }, now);
    g.handle({ t: 'down', id: 'ana', on: false }, now);
    expect(g.note).toMatchObject({ who: 'Ana', text: `You give Ana ${RESCUE_ENERGY} of your energy. Ana is back up.` });
    expect(g.action()).toBeNull();
  });

  it('says you have too little to give, and asks nothing; the server\'s no comes by name', () => {
    g.handle(welcome(field(), [person('me', 'Aldo', 3, 4, 'up'), person('ana', 'Ana', 3, 3, 'down', { down: true })], energy(RESCUE_ENERGY)), now);
    g.pressA();
    expect(g.question).toBeNull();
    expect(g.note).toMatchObject({ who: 'Ana', text: rescueTooTired('Ana', RESCUE_ENERGY) });
    expect(sent.filter(m => m.t === 'rescue')).toEqual([]);
    // With more, it asks; and if someone got there first, the box says so.
    g.pressA();
    g.handle({ t: 'energy', energy: energy(50), body: { wet: 0, wetRate: 0, load: 0, hitched: false, worn: {} } }, now);
    g.pressA();
    g.pressA();
    g.handle({ t: 'refused', action: 'rescue', reason: 'gone' }, now);
    expect(g.note).toMatchObject({ text: 'Ana is not down any more.' });
  });

  it('walks up to someone down who is tapped, and asks as it gets there', () => {
    g.handle(welcome(field(), [person('me', 'Aldo', 3, 5, 'up'), person('ana', 'Ana', 1, 2, 'down', { down: true })], energy(80)), now);
    g.tapTile(1, 2);
    for (let i = 0; i < 12 && !g.question; i++) {
      run(STEP_MS * 1.2);
      const step = sent.filter(m => m.t === 'step').at(-1), you = g.me!;
      if (step?.t === 'step') g.handle({ t: 'step', id: 'me', x: you.tx, y: you.ty, dir: you.dir, seq: step.seq }, now);
    }
    expect(Math.abs(g.me!.tx - 1) + Math.abs(g.me!.ty - 2)).toBe(1);
    expect(g.askView()).toMatchObject({ who: 'Ana', text: rescueQuestion('Ana', g.energy(now)!.value) });
  });
});
