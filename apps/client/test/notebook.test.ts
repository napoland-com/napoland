import { describe, expect, it } from 'vitest';
import type { NotebookData, PlayerView } from '@napoland/shared';
import { Game } from '../src/game';
import { areaHeading, fieldNotesHtml, fieldNotesView, NOTHING_YET } from '../src/journal';
import { Maps } from '../src/maps';
import { newsBanner } from '../src/status';
import { ITEMS, storyData, tinyTown, tinyWoods, welcome } from './fixtures';

/** Pages in the town, the woods and anywhere; the watchers' page has a blank. */
function notebook(): NotebookData {
  return {
    version: 2,
    pages: [
      { id: 'the-sign', area: 'town', title: 'The sign', text: 'Pop. 2 <and counting>.', when: { read: { map: 'town', x: 1, y: 1 } } },
      {
        id: 'watchers', area: 'woods', title: 'Watchers', text: 'Tall and pale.', when: { saw: 'watcher' },
        blanks: [{ id: 'watcher-stops', ask: 'It stops when... ?', fill: 'It stops when someone looks at it.', when: { saw: 'froze' } }],
      },
      { id: 'rook', area: 'woods', title: 'Rook', text: 'Lost.', when: { saw: 'storm' } },
      { id: 'glowcaps', area: 'anywhere', title: 'Glowcaps', text: 'They grow in the damp.', when: { find: 'glowcap' } },
    ],
  };
}
const names: Record<string, string> = { town: 'Testbrook', woods: 'The Test Woods' };
const mapName = (id: string) => names[id];
const me: PlayerView = { id: 'me', name: 'Aldo', x: 2, y: 2, dir: 'up', color: '#d9a53a', gear: {}, quirks: [] };
/** A game welcomed with `pages` open and `blanks` filled, in field notes of `version`. */
function game(pages: string[] = [], blanks: string[] = [], version = 2): Game {
  const g = new Game(new Maps([tinyTown(), tinyWoods()]), () => {}, ITEMS, storyData(), notebook());
  g.handle(welcome(tinyWoods(), [me], undefined, { story: { version: storyData().version, chapter: 'home' }, notebook: { version, pages, blanks } }), 1000);
  return g;
}

describe('the field notes in the journal', () => {
  it('count each area\'s pages, never the story\'s chapters, and show only the pages opened, in the notebook\'s order', () => {
    const v = fieldNotesView(notebook(), { pages: ['rook', 'the-sign'], blanks: [] }, mapName);
    expect(v.areas.map(areaHeading)).toEqual(['Testbrook: 1 of 1', 'The Test Woods: 1 of 2', 'Anywhere: 0 of 1']);
    expect(v.areas.map(a => a.pages.map(p => p.title))).toEqual([['The sign'], ['Rook'], []]);
  });

  it('read a blank as its question until it is seen, then as what was seen', () => {
    const page = (blanks: string[]) => fieldNotesView(notebook(), { pages: ['watchers'], blanks }, mapName).areas[1]!.pages[0]!;
    expect(page([]).blanks).toEqual([{ text: 'It stops when... ?', filled: false }]);
    expect(page(['watcher-stops']).blanks).toEqual([{ text: 'It stops when someone looks at it.', filled: true }]);
  });

  it('neither show nor count a page or a blank this copy does not know', () => {
    const v = fieldNotesView(notebook(), { pages: ['written-later', 'glowcaps'], blanks: ['from-later'] }, mapName);
    expect(v.areas.map(areaHeading)).toEqual(['Testbrook: 0 of 1', 'The Test Woods: 0 of 2', 'Anywhere: 1 of 1']);
  });

  it('draw each area under its heading, its pages marked while new, and say so where nothing is open yet', () => {
    const html = fieldNotesHtml(fieldNotesView(notebook(), { pages: ['the-sign', 'watchers'], blanks: [] }, mapName, new Set(['watchers'])));
    expect(html).toContain('<h3>Testbrook: 1 of 1</h3>');
    expect(html).toContain('<h3>Anywhere: 0 of 1</h3>');
    expect(html).toContain(`<p class="none">${NOTHING_YET}</p>`);
    expect(html).toContain('Pop. 2 &lt;and counting&gt;.');
    expect(html).toContain('<article class="page" data-fresh><h4>Watchers</h4>');
    expect(html).toContain('<article class="page"><h4>The sign</h4>');
    expect(html).toContain('<p class="blank">It stops when... ?</p>');
  });
});

describe('the field notes in the game', () => {
  it('start from the welcome, and grow as the server opens pages and fills in blanks: news, and new until looked at', () => {
    const g = game(['the-sign']);
    expect(g.fieldNotes).toEqual({ pages: ['the-sign'], blanks: [] });
    const changes = g.notebookChanges;
    g.handle({ t: 'page', id: 'watchers' }, 2000);
    g.handle({ t: 'page', id: 'watchers' }, 2000);
    g.handle({ t: 'blank', id: 'watcher-stops' }, 3000);
    expect(g.fieldNotes).toEqual({ pages: ['the-sign', 'watchers'], blanks: ['watcher-stops'] });
    expect(g.notebookChanges).toBe(changes + 2);
    const watchers = notebook().pages[1]!;
    expect(g.news).toEqual([{ kind: 'page', page: watchers }, { kind: 'blank', page: watchers, blank: watchers.blanks![0] }]);
    expect([...g.freshPages]).toEqual(['watchers']);
    g.seenFieldNotes();
    expect(g.freshPages.size).toBe(0);
    expect(g.notebookChanges).toBe(changes + 3);
  });

  it('keep a page it does not know as the server said, and say nothing of it', () => {
    const g = game();
    g.handle({ t: 'page', id: 'written-later' }, 2000);
    expect(g.fieldNotes.pages).toEqual(['written-later']);
    expect(g.news).toEqual([]);
  });

  it('do not play with other field notes than the server\'s: the copy is out of date', () => {
    expect(game([], [], 1).online).toBe(false);
    expect(game([], [], 2).online).toBe(true);
    // A server from before the field notes sends none: the game plays on, with none.
    const g = new Game(new Maps([tinyTown(), tinyWoods()]), () => {}, ITEMS, storyData(), notebook());
    const { notebook: _none, ...older } = welcome(tinyWoods(), [me], undefined, { story: { version: storyData().version, chapter: 'home' } });
    g.handle(older as ReturnType<typeof welcome>, 1000);
    expect(g.online).toBe(true);
    expect(g.fieldNotes).toEqual({ pages: [], blanks: [] });
  });

  it('say a page quietly in a banner, and a blank filled in with what was seen', () => {
    const [sign, watchers] = [notebook().pages[0]!, notebook().pages[1]!];
    expect(newsBanner({ kind: 'page', page: sign }, 'Testbrook')).toEqual({ title: 'A new page: The sign', sub: '' });
    expect(newsBanner({ kind: 'blank', page: watchers, blank: watchers.blanks![0]! }, 'Testbrook')).toEqual({ title: 'Filled in: Watchers', sub: 'It stops when someone looks at it.' });
  });
});
