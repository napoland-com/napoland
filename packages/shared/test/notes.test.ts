import { describe, expect, it } from 'vitest';
import {
  FAINT, NOTE_LINE_MAX, cleanIds, keepsakeEnergy, keepsakeFindId, noteAt, noteLines, noteShows, notesOf, validateItems, validateMap, validateWorld, type ItemDef, type ItemsData,
  type KeepsakesData, type MapData, type MapNote, type MapObject,
} from '../src';

const note = (more: Partial<MapNote> = {}): MapNote => ({ kind: 'note', id: 'walt-n8', by: 'walt', name: 'Nailed to the pole', x: 2, y: 1, text: ['N-8. All sound. W.P.'], ...more });

/** A small open map: a pole at 2,1 and a table at 5,3 (a room's walls when `inside`), with these objects too. */
function map(id: string, objects: MapObject[], kind: MapData['kind'] = 'wilds'): MapData {
  const W = 8, H = 6;
  const tiles = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => (kind === 'inside' && (x === 0 || y === 0 || x === W - 1 || y === H - 1) ? (x === 4 && y === H - 1 ? 'p' : 'x') : kind === 'inside' ? 'p' : 'g')).join(''));
  return {
    id, name: id, version: 1, kind, depth: kind === 'wilds' ? 1 : 0, width: W, height: H, tiles, levels: Array<string>(H).fill('0'.repeat(W)), spawn: { x: 4, y: 4, dir: 'up' },
    exits: kind === 'wilds' ? [{ x: 4, y: 5, w: 1, h: 1, to: 'town', tx: 1, ty: 1, dir: 'down', home: true }] : kind === 'inside' ? [{ x: 4, y: 5, w: 1, h: 1, to: 'town', tx: 1, ty: 1, dir: 'down' }] : [],
    objects: [{ kind: 'pole', x: 2, y: 1 }, { kind: 'table', x: 5, y: 3 }, ...objects],
  };
}
const errors = (d: MapData) => validateMap(d).filter(p => p.level === 'error').map(p => p.message);

describe('notes people left', () => {
  it('show at their time: glowing writing at night (a green night too), wax in the rain or a storm, a shard\'s scratches on a green night', () => {
    const at = (when: MapNote['when'], weather: Parameters<typeof noteShows>[1], storm = false) => noteShows(note(when ? { when } : {}), weather, storm);
    expect(['overcast', 'rain', 'night', 'aurora'].every(w => at(undefined, w as never))).toBe(true);
    expect([at('night', 'overcast'), at('night', 'rain'), at('night', 'night'), at('night', 'aurora')]).toEqual([false, false, true, true]);
    expect([at('rain', 'overcast'), at('rain', 'rain'), at('rain', 'night'), at('rain', 'overcast', true)]).toEqual([false, true, false, true]);
    expect([at('aurora', 'night'), at('aurora', 'aurora'), at('aurora', 'rain', true)]).toEqual([false, true, false]);
  });

  it('say their text in their time, and at another only that they cannot be read: in their own words, or the plain ones', () => {
    const glowing = note({ when: 'night', faint: 'A greenish smear.', text: ['If you can read this, it is dark.'] });
    expect(noteLines(glowing, 'night')).toEqual(['If you can read this, it is dark.']);
    expect(noteLines(glowing, 'overcast')).toEqual(['A greenish smear.']);
    expect(noteLines(note({ when: 'aurora' }), 'night')).toEqual([FAINT.aurora]);
    expect(FAINT.aurora).toBe('It only shows when the sky is green.');
  });

  it('are found by tile, and by id across maps, the first of an id kept', () => {
    const a = map('woods', [note()]), b = map('south', [note({ id: 'walt-t9', x: 5, y: 3 }), note({ x: 2, y: 1 })]);
    expect(noteAt(a, 2, 1)?.id).toBe('walt-n8');
    expect(noteAt(a, 5, 3)).toBeUndefined();
    const all = notesOf([a, b]);
    expect([...all.keys()]).toEqual(['walt-n8', 'walt-t9']);
    expect(all.get('walt-n8')!.map).toBe(a);
  });

  it('are checked: named for good by who wrote them, lying on something, readable from beside it, rain out of doors', () => {
    expect(errors(map('woods', [note(), note({ id: 'on-the-table', x: 5, y: 3, when: 'night', faint: 'A smear.' })]))).toEqual([]);
    const bad = (o: Partial<MapNote>, kind: MapData['kind'] = 'wilds') => errors(map('woods', [note(o)], kind));
    expect(bad({ id: 'Walt N8' })).toEqual([expect.stringContaining('its id is lowercase words')]);
    expect(bad({ by: 'mira' as never })).toEqual([expect.stringContaining('by is ranger, walt, barlows')]);
    expect(bad({ name: ' ' })).toEqual([expect.stringContaining('needs a name')]);
    expect(bad({ text: [] })).toEqual([expect.stringContaining('nothing to read')]);
    expect(bad({ text: ['x'.repeat(NOTE_LINE_MAX + 1)] })).toEqual([expect.stringContaining(`${NOTE_LINE_MAX} at most`)]);
    expect(bad({ when: 'fog' as never })).toEqual([expect.stringContaining('when is night, rain, aurora')]);
    expect(bad({ faint: 'Too faint.' })).toEqual([expect.stringContaining('only a note with a when has it')]);
    expect(bad({ x: 3, y: 1 })).toEqual([expect.stringContaining('lies on nothing')]);
    // In a room: no rain falls on it.
    expect(errors(map('hut', [note({ x: 5, y: 3, when: 'rain' })], 'inside'))).toEqual([expect.stringContaining('no rain falls inside')]);
    // Boxed in, nobody reads it.
    const boxed = map('woods', [{ kind: 'rock', x: 1, y: 1, s: 1, v: 0 }, { kind: 'rock', x: 3, y: 1, s: 1, v: 0 }, { kind: 'rock', x: 2, y: 2, s: 1, v: 0 }, { kind: 'rock', x: 2, y: 0, s: 1, v: 0 }, note()]);
    expect(errors(boxed)).toContainEqual(expect.stringContaining('nobody can stand beside it'));
    expect(errors(map('woods', [note(), note({ id: 'another' })]))).toEqual([expect.stringContaining('two notes lie on 2,1')]);
  });

  it('have an id each across every map, since what a player read is kept by it', () => {
    const town: MapData = { ...map('town', [], 'town'), exits: [{ x: 7, y: 5, w: 1, h: 1, to: 'woods', tx: 4, ty: 4, dir: 'up' }] };
    const problems = validateWorld([town, map('woods', [note()]), { ...map('south', [note()]), exits: [] }], 'town').filter(p => p.level === 'error');
    expect(problems).toEqual([expect.objectContaining({ map: 'south', message: expect.stringContaining('the note at 2,1 of woods has that id too') })]);
  });
});

describe('keepsakes', () => {
  const PLACES: KeepsakesData = { energy: 5, places: [{ item: 'compass', map: 'woods', x: 3, y: 3 }, { item: 'tag', map: 'woods', x: 6, y: 1 }] };

  it('make the bar bigger with the whole set home, and only then', () => {
    expect(keepsakeEnergy(PLACES, ['compass', 'tag'])).toBe(5);
    expect(keepsakeEnergy(PLACES, ['tag', 'something-newer', 'compass'])).toBe(5);
    expect(keepsakeEnergy(PLACES, ['compass'])).toBe(0);
    expect(keepsakeEnergy(PLACES, undefined)).toBe(0);
    expect(keepsakeEnergy(undefined, ['compass', 'tag'])).toBe(0);
  });

  it('lie as finds of their own, below zero, each its own id', () => {
    expect([0, 1, 2].map(keepsakeFindId)).toEqual([-1, -2, -3]);
  });

  it('are kept as a clean list of ids, each once, newer ones too', () => {
    expect(cleanIds(['compass', 3, 'tag', 'compass', '', null, 'x'.repeat(65)])).toEqual(['compass', 'tag']);
    expect(cleanIds('compass')).toEqual([]);
  });

  describe('in content/items.json', () => {
    const keepsake = (id: string, more: Partial<ItemDef> = {}): ItemDef => ({ id, name: id, kind: 'keepsake', stack: 1, xp: 20, text: `The ${id}.`, ...more });
    const data = (more: Partial<ItemsData> = {}): ItemsData => ({
      version: 1, items: [keepsake('compass'), keepsake('tag'), { id: 'moss', name: 'Moss', kind: 'resource', stack: 10, text: 'Soft.' }], finds: [], keepsakes: PLACES, ...more,
    });
    const maps = [map('woods', [])];
    const problems = (d: ItemsData) => validateItems(d, maps).filter(p => p.level === 'error').map(p => p.message);

    it('lie one of a kind each, in one place each, on a tile somebody can walk onto', () => {
      expect(problems(data())).toEqual([]);
      expect(problems(data({ items: [keepsake('compass', { stack: 2 }), keepsake('tag')] }))).toEqual([expect.stringContaining('one of a kind')]);
      expect(problems(data({ items: [keepsake('compass', { use: { energy: 5 } }), keepsake('tag')] }))).toEqual([expect.stringContaining('only brought home')]);
      const at = (places: KeepsakesData['places'], energy = 5) => problems(data({ keepsakes: { energy, places } }));
      expect(at([PLACES.places[0]!])).toEqual(['keepsakes: tag lies nowhere']);
      expect(at([...PLACES.places, { item: 'tag', map: 'woods', x: 1, y: 3 }])).toEqual([expect.stringContaining('tag lies in two places')]);
      expect(at([...PLACES.places, { item: 'moss', map: 'woods', x: 1, y: 3 }])).toEqual([expect.stringContaining('moss is not a keepsake')]);
      expect(at([PLACES.places[0]!, { item: 'tag', map: 'woods', x: 2, y: 1 }])).toEqual([expect.stringContaining('is not walkable')]);
      expect(at([PLACES.places[0]!, { item: 'tag', map: 'woods', x: 4, y: 5 }])).toEqual([expect.stringContaining('is an exit')]);
      expect(at([PLACES.places[0]!, { item: 'tag', map: 'town', x: 1, y: 1 }])).toEqual([expect.stringContaining('there is no map town')]);
      expect(at([PLACES.places[0]!, { item: 'tag', map: 'woods', x: 3, y: 3 }])).toEqual([expect.stringContaining('another keepsake lies on woods 3,3')]);
      expect(at(PLACES.places, 0)).toEqual([expect.stringContaining('energy is a whole number from 1')]);
      expect(problems(data({ keepsakes: undefined }))).toEqual(['keepsakes: compass, tag lie nowhere']);
    });

    it('never grow, get made, come in a parcel or pay for anything', () => {
      expect(problems(data({ finds: [{ item: 'tag', map: 'woods', count: 1, respawn: [1, 1] }] }))).toEqual([expect.stringContaining('tag is a keepsake')]);
      expect(problems(data({ recipes: [{ id: 'tag', make: 'tag', needs: [{ item: 'moss', count: 1 }] }] }))).toEqual([expect.stringContaining('makes tag, a keepsake')]);
      expect(problems(data({ recipes: [{ id: 'moss', make: 'moss', needs: [{ item: 'tag', count: 1 }] }] }))).toEqual([expect.stringContaining('needs tag, a keepsake')]);
      expect(problems(data({ parcels: { welcome: [{ item: 'compass', count: 1 }], week: Array.from({ length: 7 }, () => [{ item: 'moss', count: 1 }]) } })))
        .toEqual([expect.stringContaining('compass is a keepsake')]);
    });
  });
});
