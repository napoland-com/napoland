import { describe, expect, it } from 'vitest';
import {
  ANSWER_DAY, dayIndex, firstBanner, firstInJournal, firstOnBoard, itemIndex, notesOf, secretKey, secretOf, secretTitle, thousands, zoneDay, type ItemsData, type MapData, type MapObject,
} from '../src';

const note = (id: string, by: 'ranger' | 'walt' | 'barlows', x: number, y: number): MapObject => ({ kind: 'note', id, by, name: 'A note', x, y, text: ['Words.'] });
/** Woods with a pond and the crossroads named, a note by each; a room with one on its table. */
const woods: MapData = {
  id: 'woods', name: 'The Near Woods', version: 1, kind: 'wilds', depth: 1, width: 20, height: 20, tiles: Array(20).fill('g'.repeat(20)), levels: Array(20).fill('0'.repeat(20)),
  spawn: { x: 1, y: 1, dir: 'up' }, exits: [], objects: [note('by-the-pond', 'ranger', 3, 4), note('by-the-crossroads', 'walt', 15, 14)],
  places: [{ name: 'pond', x: 2, y: 2 }, { name: 'the crossroads', x: 16, y: 16 }],
};
const hut: MapData = { ...woods, id: 'hut', name: 'The ranger\'s hut', kind: 'inside', depth: 0, places: [], objects: [note('on-the-table', 'barlows', 1, 1)] };
const items = itemIndex({ version: 1, items: [{ id: 'staff-badge', name: 'NAPO staff badge', noun: 'NAPO staff badge', kind: 'keepsake', stack: 1, text: 'BARLOW, D.' }], finds: [] } as ItemsData);
const notes = notesOf([woods, hut]);

describe('first finders', () => {
  it('keep each secret by a key of its own, and leave a kind this release does not know alone', () => {
    expect(secretKey({ kind: 'note', id: 'ranger-fires' })).toBe('note:ranger-fires');
    expect(secretKey({ kind: 'keepsake', item: 'brass-compass' })).toBe('keepsake:brass-compass');
    expect(secretOf('note:ranger-fires')).toEqual({ kind: 'note', id: 'ranger-fires' });
    expect(secretOf('keepsake:brass-compass')).toEqual({ kind: 'keepsake', item: 'brass-compass' });
    expect([secretOf('map-piece:3'), secretOf('note:'), secretOf('nothing')]).toEqual([undefined, undefined, undefined]);
  });

  it('call a secret what people call it: whose note, and by the nearest place out of doors or in the room; a keepsake by its name', () => {
    expect(secretTitle('note:by-the-pond', notes, items)).toBe('the ranger\'s note by the pond');
    expect(secretTitle('note:by-the-crossroads', notes, items)).toBe('Walt\'s note by the crossroads');
    expect(secretTitle('note:on-the-table', notes, items)).toBe('the Barlows\' note in the ranger\'s hut');
    expect(secretTitle('keepsake:staff-badge', notes, items)).toBe('the NAPO staff badge');
    expect([secretTitle('note:written-later', notes, items), secretTitle('keepsake:lantern', notes, items)]).toEqual([undefined, undefined]);
  });

  it('say it in one line to everyone, on the notice board and under it in the journal, with the Zone\'s day', () => {
    const f = { secret: 'note:by-the-pond', name: 'Ana', day: 3052 }, k = { secret: 'keepsake:staff-badge', name: 'Ana', day: 3050 };
    expect(firstBanner(f, 'the ranger\'s note by the pond')).toBe('Ana is the first to read the ranger\'s note by the pond.');
    expect(firstBanner(k, 'the NAPO staff badge', true)).toBe('You are the first to find the NAPO staff badge.');
    expect(firstOnBoard(f, 'the ranger\'s note by the pond')).toBe('First to read the ranger\'s note by the pond: Ana, on day 3,052.');
    expect(firstInJournal(f)).toBe('First read by Ana, day 3,052.');
    expect(firstInJournal(k, true)).toBe('First found by you, day 3,050.');
    expect([thousands(7), thousands(3052), thousands(1234567)]).toEqual(['7', '3,052', '1,234,567']);
  });

  it('count the Zone\'s days from the night of the answer, a day for each turn of the sky: past day 3,050 late in September 2026', () => {
    expect(zoneDay(Date.UTC(2026, 8, 28, 12))).toBe(3052);
    expect(zoneDay(0)).toBe(-ANSWER_DAY);
    const t = Date.UTC(2026, 8, 28, 12);
    expect(zoneDay(t + 48 * 60 * 1000) - zoneDay(t)).toBe(1);
    expect(zoneDay(t)).toBe(dayIndex(t) - ANSWER_DAY);
  });
});
