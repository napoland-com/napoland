import { describe, expect, it } from 'vitest';
import type { ClientMsg, ItemsData, MapData, PlayerView } from '@napoland/shared';
import { pieceLines, pieceOf } from '@napoland/shared';
import { Game } from '../src/game';
import { LEAN, poleLean } from '../src/view/lean';
import { Items, factsOf } from '../src/items';
import { NOTHING_YET, allHome, authorHeading, keepsakesHeading, notesHtml, notesView } from '../src/journal';
import { Maps } from '../src/maps';
import { didText, tossQuestion } from '../src/said';
import { newsBanner } from '../src/status';
import { itemsData, storyData, tinyTown, tinyWoods, welcome } from './fixtures';

/**
 * The test woods with two poles and a note on each: at 1,2 one that shows only at night (read it from 2,2
 * facing left) and at 3,2 Walt's (from 2,2 facing right). A table in town at 5,1 holds the ranger's.
 */
const woods = (): MapData => ({
  ...tinyWoods(),
  objects: [
    ...tinyWoods().objects, { kind: 'pole', x: 1, y: 2 }, { kind: 'pole', x: 3, y: 2 },
    { kind: 'note', x: 1, y: 2, id: 'in-the-dark', by: 'ranger', name: 'Nailed to the pole', text: ['If you can read this, it is dark.', 'Stay by the fire.'], when: 'night', faint: 'A greenish smear.' },
    { kind: 'note', x: 3, y: 2, id: 'walt-n8', by: 'walt', name: 'Nailed to the pole', text: ['N-8. All sound. W.P.'] },
  ],
});
const town = (): MapData => ({
  ...tinyTown(),
  objects: [...tinyTown().objects, { kind: 'table', x: 5, y: 1 }, { kind: 'note', x: 5, y: 1, id: 'ranger-fires', by: 'ranger', name: 'A note on the table', text: ['Resin burns longest.'] }],
});
/** Two keepsakes: the compass in the woods, the tag in town; the whole set home adds 5 to the bar. */
const items = (): ItemsData => {
  const d = itemsData();
  return {
    ...d,
    items: [...d.items, { id: 'compass', name: 'Brass compass', kind: 'keepsake', stack: 1, xp: 20, text: 'It points at the woods.' }, { id: 'tag', name: 'Pole tag', kind: 'keepsake', stack: 1, xp: 20, text: 'Stamped 16.' }],
    keepsakes: { energy: 5, places: [{ item: 'compass', map: 'woods', x: 2, y: 1 }, { item: 'tag', map: 'town', x: 4, y: 3 }] },
  };
};
const ITEMS = new Items(items());
const me = (x: number, y: number, dir: PlayerView['dir']): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir, color: '#d9a53a', gear: {}, quirks: [] });
const maps = () => new Maps([town(), woods()]);

/** A game standing at 2,2 in the woods facing `dir`, welcomed with these notes read and keepsakes home; what it sends goes in `sent`. */
function inWoods(dir: PlayerView['dir'], sent: ClientMsg[] = [], notes: string[] = [], keepsakes: string[] = []): Game {
  const g = new Game(maps(), m => sent.push(m), ITEMS, storyData());
  g.handle({ ...welcome(woods(), [me(2, 2, dir)], undefined, { story: { version: storyData().version, chapter: 'home' }, items: ITEMS.version }), notes, keepsakes }, 1000);
  return g;
}
const read = (g: Game) => {
  g.pressA();
  const said = g.dialog && { who: g.dialog.who, lines: g.dialog.lines };
  while (g.dialog) g.pressB();
  return said;
};

describe('notes people left, in the game', () => {
  it('read like a sign, facing what they lie on: only the tile goes to the server, which decides whether it counts', () => {
    const sent: ClientMsg[] = [];
    expect(read(inWoods('right', sent))).toEqual({ who: 'Nailed to the pole', lines: ['N-8. All sound. W.P.'] });
    expect(sent.filter(m => m.t === 'talk')).toEqual([{ t: 'talk', x: 3, y: 2 }]);
  });

  it('show only at their time: at another the box says only what shows, in the note\'s own words', () => {
    const g = inWoods('left');
    // The welcome said rain.
    expect(read(g)?.lines).toEqual(['A greenish smear.']);
    g.weather = 'night';
    expect(read(g)?.lines).toEqual(['If you can read this, it is dark.', 'Stay by the fire.']);
    g.weather = 'aurora';
    expect(read(g)?.lines).toEqual(['If you can read this, it is dark.', 'Stay by the fire.']);
  });

  it('start from the welcome, and grow as the server says one was read: new until looked at, news with no banner', () => {
    const g = inWoods('up', [], ['ranger-fires']);
    expect(g.notesRead).toEqual(['ranger-fires']);
    const changes = g.notesChanges;
    g.handle({ t: 'noteRead', id: 'walt-n8' }, 2000);
    g.handle({ t: 'noteRead', id: 'walt-n8' }, 2000);
    expect(g.notesRead).toEqual(['ranger-fires', 'walt-n8']);
    expect([...g.freshNotes]).toEqual(['walt-n8']);
    expect(g.notesChanges).toBe(changes + 1);
    expect(g.news).toEqual([{ kind: 'note', id: 'walt-n8' }]);
    expect(newsBanner(g.news[0]!, 'The Test Woods', ITEMS)).toBeNull();
    g.seenNotes();
    expect(g.freshNotes.size).toBe(0);
    expect(g.notesChanges).toBe(changes + 2);
  });

  it('take keepsakes home as the server says, with a banner for each, and one for the whole set', () => {
    const g = inWoods('up', [], [], ['tag']);
    expect(g.keepsakesHome).toEqual(['tag']);
    g.handle({ t: 'keepsake', item: 'compass' }, 2000);
    expect(g.keepsakesHome).toEqual(['tag', 'compass']);
    expect(g.news).toEqual([{ kind: 'keepsake', item: 'compass', home: 2, of: 2 }]);
    expect(newsBanner(g.news[0]!, 'Home', ITEMS)).toEqual({ title: 'All the keepsakes are home', sub: 'Brass compass, the last of them.\nYour energy bar is 5 bigger, for good.' });
    expect(newsBanner({ kind: 'keepsake', item: 'tag', home: 1, of: 2 }, 'Home', ITEMS)).toEqual({ title: 'Home: Pole tag', sub: 'Stamped 16.\n1 of 2 keepsakes home.' });
  });

  it('say that a keepsake thrown away goes back where it lay, and what one is in the bag', () => {
    const compass = ITEMS.get('compass');
    expect(tossQuestion(compass, 1, 1)).toBe('Leave the brass compass? It goes back where you found it.');
    expect(didText({ kind: 'thrown', item: 'compass', count: 1 }, ITEMS)).toBe('The brass compass goes back where you found it.');
    expect(factsOf(compass)).toEqual(['20 XP at home', 'One of a kind: bring it home']);
  });
});

describe('notes people left, in the journal', () => {
  const all = [town(), woods()];
  const item = (id: string) => ITEMS.byId.get(id);

  it('go by who wrote them, in a fixed order, only those you read something of, each note in the order you read it', () => {
    const v = notesView(all, ['walt-n8', 'ranger-fires', 'in-the-dark', 'written-later'], items().keepsakes, [], item, new Set(['in-the-dark']));
    expect(v.authors.map(authorHeading)).toEqual(['The ranger: 2 of 2', 'Walt Pruitt: 1 of 1']);
    expect(v.authors[0]!.notes.map(n => [n.id, n.place, n.fresh])).toEqual([['ranger-fires', 'Testbrook', false], ['in-the-dark', 'The Test Woods', true]]);
    expect(v.keepsakes).toBeNull();
    expect(notesView(all, [], undefined, [], item).authors).toEqual([]);
  });

  it('keep the keepsakes home after the notes, with a word once the whole set is', () => {
    const one = notesView(all, [], items().keepsakes, ['tag'], item).keepsakes!;
    expect(keepsakesHeading(one)).toBe('Keepsakes: 1 of 2 home');
    expect(one.home).toEqual([{ item: 'tag', name: 'Pole tag', text: 'Stamped 16.' }]);
    const both = notesView(all, [], items().keepsakes, ['tag', 'compass'], item).keepsakes!;
    expect(both.home.map(h => h.item)).toEqual(['compass', 'tag']);
    expect(allHome(both)).toBe('All of them are home: your energy bar is 5 bigger, for good.');
  });

  it('draw each writer under a heading, where each note lies, marked while new; and say so when there is nothing yet', () => {
    const html = notesHtml(notesView(all, ['in-the-dark'], items().keepsakes, ['compass', 'tag'], item, new Set(['in-the-dark'])));
    expect(html).toContain('<h3>The ranger: 1 of 2</h3>');
    expect(html).toContain('<article class="page note" data-fresh><h4>Nailed to the pole</h4><p class="where">The Test Woods</p><p>If you can read this, it is dark.</p><p>Stay by the fire.</p></article>');
    expect(html).toContain('<h3>Keepsakes: 2 of 2 home</h3>');
    expect(html).toContain('<p class="blank" data-filled>All of them are home: your energy bar is 5 bigger, for good.</p>');
    expect(notesHtml(notesView(all, [], items().keepsakes, [], item))).toBe(`<p class="none">${NOTHING_YET}</p>`);
  });
});

describe('first finders, in the game and the journal', () => {
  const all = [town(), woods()];
  const item = (id: string) => ITEMS.byId.get(id);

  it('come with the welcome, and a new one says in one line who found what first, "you" when it was you', () => {
    const g = new Game(maps(), () => {}, ITEMS, storyData());
    g.handle({ ...welcome(woods(), [me(2, 2, 'up')], undefined, { story: { version: storyData().version, chapter: 'home' }, items: ITEMS.version }), firsts: [{ secret: 'note:walt-n8', name: 'Bo', day: 3040 }] }, 1000);
    expect([...g.firsts.keys()]).toEqual(['note:walt-n8']);
    const changes = g.notesChanges;
    g.handle({ t: 'first', first: { secret: 'note:ranger-fires', name: 'Ana', day: 3052 } }, 2000);
    g.handle({ t: 'first', first: { secret: 'keepsake:compass', name: 'Aldo', day: 3052 } }, 2000);
    // A secret this copy does not know is kept, and goes unsaid.
    g.handle({ t: 'first', first: { secret: 'note:written-later', name: 'Cy', day: 3053 } }, 2000);
    expect(g.notesChanges).toBe(changes + 3);
    expect(g.news.filter(n => n.kind === 'first')).toEqual([
      { kind: 'first', text: 'Ana is the first to read the ranger\'s note in Testbrook.' },
      { kind: 'first', text: 'You are the first to find the brass compass.' },
    ]);
    expect(newsBanner(g.news.find(n => n.kind === 'first')!, 'The Test Woods', ITEMS)).toEqual({ title: 'Ana is the first to read the ranger\'s note in Testbrook.', sub: '' });
  });

  it('put who found it first under each note and keepsake in the journal, "you" when it was you', () => {
    const firsts = new Map([
      ['note:walt-n8', { secret: 'note:walt-n8', name: 'Bo', day: 3040 }],
      ['keepsake:compass', { secret: 'keepsake:compass', name: 'Aldo', day: 3052 }],
    ]);
    const v = notesView(all, ['walt-n8', 'in-the-dark'], items().keepsakes, ['compass'], item, new Set(), firsts, 'Aldo');
    expect(v.authors.map(a => a.notes.map(n => n.first))).toEqual([[undefined], ['First read by Bo, day 3,040.']]);
    expect(v.keepsakes!.home.map(h => h.first)).toEqual(['First found by you, day 3,052.']);
    expect(notesHtml(v)).toContain('<p class="first">First read by Bo, day 3,040.</p></article>');
  });
});

describe('the north line\'s poles, in the game', () => {
  /** The test woods under this id, with poles at 1,2 (bare), 3,2 (Walt's note on it) and 2,3 (bare), listed in that order. */
  const line = (id: string, dir: PlayerView['dir']): Game => {
    const w: MapData = { ...woods(), id, objects: [...tinyWoods().objects, { kind: 'pole', x: 1, y: 2 }, { kind: 'pole', x: 3, y: 2 }, { kind: 'pole', x: 2, y: 3 }, woods().objects.at(-1)!] };
    const g = new Game(new Maps([town(), w]), () => {}, ITEMS, storyData());
    g.handle(welcome(w, [me(2, 2, dir)], undefined, { story: { version: storyData().version, chapter: 'home' }, items: ITEMS.version }), 1000);
    return g;
  };
  it('read their tin tag, counted from N-7 in the Near Woods; one with a note says the note', () => {
    expect(read(line('near-woods', 'left'))).toEqual({ who: 'Pole', lines: ['A tin tag, stamped N-7.', 'The pole leans west.'] });
    expect(read(line('near-woods', 'down'))).toEqual({ who: 'Pole', lines: ['A tin tag, stamped N-9.', 'The pole leans east.'] });
    expect(read(line('near-woods', 'right'))?.who).toBe('Nailed to the pole');
  });
  it('carry none on NAPO\'s own line', () => {
    expect(read(line('south-road', 'left'))).toBeFalsy();
  });
});

describe('the dead line', () => {
  it('lampOut is set by the server, one line of news when it goes out, and reset by a welcome', () => {
    const g = inWoods('up');
    expect(g.lampOut).toBe(false);
    g.handle({ t: 'lampOut', out: true }, 2000);
    expect(g.lampOut).toBe(true);
    expect(g.news).toEqual([{ kind: 'first', text: 'The lamp with no wires went out.' }]);
    g.handle({ t: 'lampOut', out: true }, 2100);
    expect(g.news).toHaveLength(1);
    g.handle(welcome(woods(), [me(2, 2, 'up')], undefined, { story: { version: storyData().version, chapter: 'home' }, items: ITEMS.version }), 3000);
    expect(g.lampOut).toBe(false);
    // Told on joining (`known`) it is how things stand, not news: no banner, however long after the welcome.
    g.handle({ t: 'lampOut', out: true, known: true }, 9000);
    expect(g.lampOut).toBe(true);
    expect(g.news).toHaveLength(1);
    g.handle({ t: 'lampOut', out: false }, 3200);
    expect(g.lampOut).toBe(false);
  });

  it('the journal shows the torn piece for your id only once you read walt-n16', () => {
    const view = (read: string[], id: string) => notesView(maps().all(), read, undefined, [], () => undefined, new Set(), new Map(), 'Me', id);
    expect(view(['walt-n8'], 'p7').piece).toBeUndefined();
    const v = view(['walt-n16'], 'p7');
    expect(v.piece).toEqual(pieceLines(pieceOf('p7')));
    expect(notesHtml(v)).toContain('A torn piece of NAPO');
    expect(notesHtml(view(['walt-n8'], 'p7'))).not.toContain('torn piece');
  });
});

describe('pole lean', () => {
  it('tilts the woods line toward LEANS and leaves other tags straight', () => {
    expect(poleLean('N-7')).toEqual({ axis: [0, 0, 1], angle: LEAN });
    expect(poleLean('N-9')!.axis).toEqual([0, 0, -1]);
    expect(poleLean('N-8')!.axis).toEqual([-1, 0, 0]);
    expect(poleLean('N-13')!.axis).toEqual([1, 0, 0]);
    expect(poleLean('N-6')).toBeUndefined();
    expect(poleLean(undefined)).toBeUndefined();
  });
});
