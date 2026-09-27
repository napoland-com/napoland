import { describe, expect, it } from 'vitest';
import type { ClientMsg, MapData, PlayerView } from '@napoland/shared';
import { Game } from '../src/game';
import { journalView } from '../src/journal';
import { Maps } from '../src/maps';
import { newsBanner } from '../src/status';
import { ITEMS, storyData, tinyTown, tinyWoods, welcome } from './fixtures';

/** The test woods, with the station's log on a desk at 1,2: from 2,2, Rook (at 2,1) is up and the desk is left. */
const woods = (): MapData => ({ ...tinyWoods(), objects: [...tinyWoods().objects, { kind: 'console', x: 1, y: 2, id: 'log', name: 'Station log', text: ['Week 1.'] }] });
const me = (x: number, y: number, dir: PlayerView['dir']): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir, color: '#d9a53a', gear: {}, quirks: [] });

/** A game in the story's chapter `chapter`, standing at 2,2 facing Rook (or `dir`); what it sends goes in `sent`. */
function inWoods(chapter: string, sent: ClientMsg[] = [], dir: PlayerView['dir'] = 'up'): Game {
  const g = new Game(new Maps([tinyTown(), woods()]), m => sent.push(m), ITEMS, storyData());
  g.handle(welcome(woods(), [me(2, 2, dir)], undefined, { story: { version: storyData().version, chapter } }), 1000);
  return g;
}
const talk = (g: Game) => {
  g.pressA();
  return g.dialog?.lines;
};

describe('the story in what people say', () => {
  it('has someone hint at what comes next, before what they always say', () => {
    expect(talk(inWoods('home'))).toEqual(['Bring something home first.', 'Lost?']);
    expect(talk(inWoods('the-woods'))).toEqual(['Go and read the log.', 'Lost?']);
  });

  it('has the person the next chapter waits for say what they always say, then point the way', () => {
    expect(talk(inWoods('what-glows'))).toEqual(['Lost?', 'Go and read the log.']);
  });

  it('tells the server who you talked to and which desk you read, and never what a sign says', () => {
    const sent: ClientMsg[] = [];
    talk(inWoods('what-glows', sent));
    expect(talk(inWoods('what-glows', sent, 'left'))).toEqual(['Week 1.']);
    expect(sent.filter(m => m.t === 'talk')).toEqual([{ t: 'talk', x: 2, y: 1 }, { t: 'talk', x: 1, y: 2 }]);

    const town: string[] = [];
    const t = new Game(new Maps([tinyTown(), woods()]), m => town.push(m.t), ITEMS, storyData());
    t.handle(welcome(tinyTown(), [me(1, 2, 'up')], undefined, { story: { version: storyData().version, chapter: 'home' } }), 1000);
    expect(talk(t)).toEqual(['Testbrook', 'Pop. 2']);
    expect(town).not.toContain('talk');
  });

  it('moves on when the server says a chapter was reached: the journal keeps it, and it is news', () => {
    const g = inWoods('what-glows');
    const changes = g.storyChanges;
    expect(g.reached().map(c => c.id)).toEqual(['home', 'what-glows']);
    g.handle({ t: 'chapter', id: 'the-woods' }, 2000);
    expect(g.chapter).toBe('the-woods');
    expect(g.storyChanges).toBe(changes + 1);
    expect(g.reached().map(c => c.id)).toEqual(['home', 'what-glows', 'the-woods']);
    expect(g.news).toEqual([{ kind: 'chapter', chapter: storyData().chapters[2] }]);
    // What Rook says follows the chapter you are in now.
    expect(talk(g)).toEqual(['Go and read the log.', 'Lost?']);
  });

  it('does not play with a story other than the server\'s: the copy is out of date', () => {
    const g = new Game(new Maps([tinyTown(), woods()]), () => {}, ITEMS, storyData());
    g.handle(welcome(woods(), [me(2, 2, 'up')], undefined, { story: { version: storyData().version + 1, chapter: 'home' } }), 1000);
    expect(g.online).toBe(false);
  });
});

describe('the journal', () => {
  it('shows the chapters reached, the latest first and marked, each with its place in the story', () => {
    const s = storyData();
    expect(journalView(s.chapters.slice(0, 3))).toEqual({
      chapters: [
        { n: 3, title: 'The woods', text: 'Rook told you about the woods.', latest: true },
        { n: 2, title: 'What glows', text: 'You brought something home.', latest: false },
        { n: 1, title: 'Home', text: 'You woke up at home.', latest: false },
      ],
    });
    expect(journalView([])).toEqual({ chapters: [] });
  });

  it('announces a chapter reached with its title, and where to read it', () => {
    expect(newsBanner({ kind: 'chapter', chapter: storyData().chapters[1]! }, 'Testbrook')).toEqual({
      title: 'Journal: What glows', sub: 'A new chapter of the story.\nRead it in your journal, in the menu.',
    });
  });
});
