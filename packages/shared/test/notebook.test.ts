import { describe, expect, it } from 'vitest';
import {
  cleanNotebook, emptyNotebook, eventKey, notebookIndex, noted, readEvents, readableAt, saysWhere, validateNotebook, type ItemsData, type MapData, type MapObject, type NotebookData, type Page,
} from '../src';

/** A few pages: one a find opens, one a sign or a jeep, one a sight, with a blank; and one for any of three charms. */
function notebook(): NotebookData {
  return {
    version: 1,
    pages: [
      { id: 'glowcaps', area: 'woods', title: 'Glowcaps', text: 'They grow in the damp.', when: { find: 'glowcap' } },
      { id: 'the-sign', area: 'town', title: 'The sign', text: 'Pop. 2.', when: [{ read: { map: 'town', x: 1, y: 1 } }, { read: { map: 'woods', x: 2, y: 3 } }] },
      {
        id: 'watchers', area: 'woods', title: 'Watchers', text: 'Tall and pale.', when: { saw: 'watcher' },
        blanks: [{ id: 'watcher-stops', ask: 'It stops when... ?', fill: 'It stops when someone looks at it.', when: { saw: 'froze' } }],
      },
      {
        id: 'wire', area: 'anywhere', title: 'Wire', text: 'Copper.', when: { find: 'wire' },
        blanks: [{ id: 'wire-green', ask: 'More of it... ?', fill: 'More of it on green nights.', when: { find: 'wire', during: 'aurora' } }],
      },
      { id: 'the-log', area: 'town', title: 'The log', text: 'Week 1.', when: { read: 'station-log' } },
    ],
  };
}

/** A map with only what the notebook looks at: its id, kind and objects. */
function place(id: string, kind: MapData['kind'], objects: MapObject[]): MapData {
  return { id, name: id, version: 1, kind, depth: kind === 'wilds' ? 1 : 0, width: 4, height: 5, tiles: Array(5).fill('gggg'), levels: Array(5).fill('0000'), spawn: { x: 0, y: 0, dir: 'down' }, exits: [], objects };
}
const world = (): MapData[] => [
  place('town', 'town', [{ kind: 'sign', x: 1, y: 1, text: ['Pop. 2'] }, { kind: 'console', id: 'station-log', name: 'Log', x: 3, y: 0, text: ['Week 1.'] }]),
  place('woods', 'wilds', [{ kind: 'jeep', x: 2, y: 3, w: 2, h: 1, dir: 'left', text: ['Unit 7.'] }]),
  place('room', 'inside', []),
];
const items = { version: 1, items: [{ id: 'glowcap' }, { id: 'wire' }, { id: 'odd', reveals: [{ item: 'pebble', count: 1, weight: 1 }] }, { id: 'pebble' }], finds: [{ item: 'glowcap' }, { item: 'wire' }] } as unknown as ItemsData;

describe('the field notes', () => {
  const index = notebookIndex(notebook());

  it('open a page the first time what it is about happens, and never again', () => {
    const first = noted(index, emptyNotebook(), { find: 'glowcap' })!;
    expect(first.pages.map(p => p.id)).toEqual(['glowcaps']);
    expect(first.state).toEqual({ pages: ['glowcaps'], blanks: [] });
    expect(noted(index, first.state, { find: 'glowcap' })).toBeNull();
    // Anything else: nothing, found out cheaply.
    expect(noted(index, first.state, { find: 'moss' })).toBeNull();
    expect(noted(index, first.state, { saw: 'storm' })).toBeNull();
  });

  it('open a page on any of what opens it', () => {
    expect(noted(index, emptyNotebook(), { read: { map: 'woods', x: 2, y: 3 } })!.pages.map(p => p.id)).toEqual(['the-sign']);
    expect(noted(index, emptyNotebook(), { read: 'station-log' })!.pages.map(p => p.id)).toEqual(['the-log']);
    expect(noted(index, emptyNotebook(), { read: { map: 'town', x: 2, y: 1 } })).toBeNull();
  });

  it('fill in a blank only on a page that is open: seen before it was, it went unnoticed', () => {
    expect(noted(index, emptyNotebook(), { saw: 'froze' })).toBeNull();
    const open = noted(index, emptyNotebook(), { saw: 'watcher' })!.state;
    const seen = noted(index, open, { saw: 'froze' })!;
    expect(seen.pages).toEqual([]);
    expect(seen.blanks.map(b => b.id)).toEqual(['watcher-stops']);
    expect(seen.state).toEqual({ pages: ['watchers'], blanks: ['watcher-stops'] });
    expect(noted(index, seen.state, { saw: 'froze' })).toBeNull();
  });

  it('tell a find picked up at a certain time from the same find at any other', () => {
    expect(eventKey({ find: 'wire', during: 'aurora' })).not.toBe(eventKey({ find: 'wire' }));
    const open = noted(index, emptyNotebook(), { find: 'wire' })!.state;
    expect(noted(index, open, { find: 'wire', during: 'storm' })).toBeNull();
    expect(noted(index, open, { find: 'wire', during: 'aurora' })!.blanks.map(b => b.id)).toEqual(['wire-green']);
  });

  it('know what is read at a tile, a jeep by any of its tiles, and name it by its first tile or its id', () => {
    const [town, woods] = world();
    expect(readableAt(town!, 1, 1)?.kind).toBe('sign');
    expect(readableAt(town!, 0, 0)).toBeUndefined();
    const jeep = readableAt(woods!, 3, 3)!;
    expect(jeep.kind).toBe('jeep');
    expect(readEvents('woods', jeep)).toEqual([{ read: { map: 'woods', x: 2, y: 3 } }]);
    expect(readEvents('town', readableAt(town!, 3, 0)!)).toEqual([{ read: 'station-log' }, { read: { map: 'town', x: 3, y: 0 } }]);
  });

  it('keep what was saved as it was written: ids, each once, and nothing for anything else', () => {
    expect(cleanNotebook({ pages: ['a', 'b', 'a', 7, ''], blanks: ['c'] })).toEqual({ pages: ['a', 'b'], blanks: ['c'] });
    expect(cleanNotebook(null)).toEqual({ pages: [], blanks: [] });
    expect(cleanNotebook(['a'])).toEqual({ pages: [], blanks: [] });
  });
});

describe('content/notebook.json checks', () => {
  const problems = (data: NotebookData) => validateNotebook(data, world(), items).filter(p => p.level === 'error').map(p => p.message);
  const withPage = (page: Partial<Page>): NotebookData => ({ version: 1, pages: [{ id: 'a-page', area: 'town', title: 'A page', text: 'Plain words.', when: { find: 'glowcap' }, ...page } as Page] });

  it('pass a sound notebook', () => {
    expect(validateNotebook(notebook(), world(), items)).toEqual([]);
  });

  it('want pages with ids, areas that are towns or regions, titles and texts', () => {
    expect(problems({ version: 0, pages: [] })).toEqual(['version must be a whole number from 1', 'there are no pages']);
    expect(problems(withPage({ id: 'Bad Id' }))).toEqual([expect.stringContaining('an id is lowercase words joined by hyphens')]);
    expect(problems(withPage({ area: 'room' }))).toEqual([expect.stringContaining('its area is a town or a region')]);
    expect(problems(withPage({ title: ' ' }))).toEqual([expect.stringContaining('its title says nothing')]);
    expect(problems(withPage({ text: 'x'.repeat(301) }))).toEqual([expect.stringContaining('a page is short')]);
    expect(problems({ version: 1, pages: [...withPage({}).pages, ...withPage({}).pages] })).toEqual([expect.stringContaining('is there twice')]);
  });

  it('refuse a page that says where something is', () => {
    expect(saysWhere('North of the pond.')).toBe(true);
    expect(saysWhere('It lies 40 steps out.')).toBe(true);
    expect(saysWhere('At 13,37.')).toBe(true);
    expect(saysWhere('The woods lie northeast.')).toBe(true);
    // A name is not a way, and a number is not a place.
    expect(saysWhere('The South Road is calm.')).toBe(false);
    expect(saysWhere('Still listening. Day 3,041.')).toBe(false);
    expect(saysWhere('Unit 7, burned out.')).toBe(false);
    expect(problems(withPage({ text: 'It grows east of the cabin.' }))).toEqual([expect.stringContaining('says where something is')]);
  });

  it('want what opens a page to be about finds, readable things and sights that exist', () => {
    expect(problems(withPage({ when: [] }))).toEqual([expect.stringContaining('nothing opens it')]);
    expect(problems(withPage({ when: { find: 'moss' } }))).toEqual([expect.stringContaining('nothing out there is moss')]);
    // What a strange object turns out to be comes into your hands too.
    expect(problems(withPage({ when: { find: 'pebble' } }))).toEqual([]);
    expect(problems(withPage({ when: { find: 'glowcap', during: 'noon' as 'storm' } }))).toEqual([expect.stringContaining('during is aurora or storm')]);
    expect(problems(withPage({ when: { read: 'no-such-desk' } }))).toEqual([expect.stringContaining('nothing to read has the id no-such-desk')]);
    expect(problems(withPage({ when: { read: { map: 'nowhere', x: 0, y: 0 } } }))).toEqual([expect.stringContaining('there is no map nowhere')]);
    expect(problems(withPage({ when: { read: { map: 'town', x: 0, y: 0 } } }))).toEqual([expect.stringContaining('nothing to read at 0,0 in town')]);
    expect(problems(withPage({ when: { read: { map: 'woods', x: 3, y: 3 } } }))).toEqual([expect.stringContaining('named by its first tile, 2,3')]);
    expect(problems(withPage({ when: { saw: 'ghost' as 'storm' } }))).toEqual([expect.stringContaining('saw is one of')]);
    expect(problems(withPage({ when: { saw: 'storm', during: 'storm' } as never }))).toEqual([expect.stringContaining('only a find has a during')]);
  });

  it('want blanks with ids of their own, a question, its answer and what fills it in', () => {
    const blank = (b: object) => withPage({ blanks: [{ id: 'a-blank', ask: 'It... ?', fill: 'It does.', when: { saw: 'froze' }, ...b }] as never });
    expect(problems(blank({}))).toEqual([]);
    expect(problems(blank({ ask: 'It does' }))).toEqual([expect.stringContaining('its question ends in "?"')]);
    expect(problems(blank({ fill: '' }))).toEqual([expect.stringContaining('its answer says nothing')]);
    expect(problems(blank({ when: undefined }))).toEqual([expect.stringContaining('nothing fills it in')]);
    expect(problems(blank({ when: { saw: 'nothing' } }))).toEqual([expect.stringContaining('saw is one of')]);
    expect(problems({ version: 1, pages: [...blank({}).pages, { ...blank({}).pages[0]!, id: 'another' }] })).toEqual([expect.stringContaining('is there twice')]);
    // Filled in by what opens its page, it would never read as a question.
    expect(validateNotebook(blank({ when: { find: 'glowcap' } }), world(), items).map(p => p.level)).toEqual(['warning']);
  });
});
