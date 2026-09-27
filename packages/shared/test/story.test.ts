import { describe, expect, it } from 'vitest';
import { chapterOf, journal, nextChapter, reachedBy, storyLines, validateStory, type ItemsData, type MapData, type MapObject, type StoryData } from '../src';

/** A short story: home, then bring something home, then talk to Tom, then read the station's log. */
function story(): StoryData {
  return {
    version: 1,
    chapters: [
      { id: 'home', title: 'Home', text: 'You woke up at home.', hints: { mira: 'Bring something home.' } },
      { id: 'what-glows', title: 'What glows', text: 'You brought something home.', when: { store: true }, hints: { mira: 'Ask Tom about the Old Stone.' } },
      { id: 'the-lineman', title: 'The lineman', text: 'Tom strung the wire.', when: { talk: 'tom' }, hints: { tom: 'Go down the south road.' } },
      { id: 'the-answer', title: 'The answer', text: 'NAPO answered the hum.', when: { read: 'station-log' } },
    ],
  };
}

/** A map with only what the story looks at: its id and its objects. */
function place(id: string, objects: MapObject[]): MapData {
  return { id, name: id, version: 1, kind: 'town', depth: 0, width: 1, height: 1, tiles: ['g'], levels: ['0'], spawn: { x: 0, y: 0, dir: 'down' }, exits: [], objects };
}
const npc = (id: string): MapObject => ({ kind: 'npc', id, name: id, x: 0, y: 0, dir: 'down', lines: ['Hello.'] });
const desk = (id: string): MapObject => ({ kind: 'console', id, name: 'Log', x: 0, y: 0, text: ['Week 1.'] });
const world = (): MapData[] => [place('town', [npc('mira'), npc('tom')]), place('lab', [desk('station-log')])];
const items = { version: 1, items: [{ id: 'glowcap' }], finds: [] } as unknown as ItemsData;

describe('the story', () => {
  it('starts everyone in the first chapter', () => {
    expect(chapterOf(story(), undefined)?.id).toBe('home');
    expect(chapterOf(story(), 'what-glows')?.id).toBe('what-glows');
    expect(nextChapter(story(), undefined)?.id).toBe('what-glows');
    expect(nextChapter(story(), 'home')?.id).toBe('what-glows');
    expect(nextChapter(story(), 'the-answer')).toBeUndefined();
    expect(chapterOf({ version: 1, chapters: [] }, undefined)).toBeUndefined();
  });

  it('puts a player from a newer story (a release rolled back) past every chapter it has, and moves them on no further', () => {
    expect(chapterOf(story(), 'written-later')?.id).toBe('the-answer');
    expect(nextChapter(story(), 'written-later')).toBeUndefined();
    expect(reachedBy(story(), 'written-later', { store: true })).toBeUndefined();
    expect(journal(story(), 'written-later').map(c => c.id)).toEqual(['home', 'what-glows', 'the-lineman', 'the-answer']);
  });

  it('moves on only with what the next chapter waits for, one chapter at a time', () => {
    expect(reachedBy(story(), 'home', { store: true })?.id).toBe('what-glows');
    // Talking to Tom is what the chapter after next waits for: not yet.
    expect(reachedBy(story(), 'home', { talk: 'tom' })).toBeUndefined();
    expect(reachedBy(story(), 'what-glows', { talk: 'mira' })).toBeUndefined();
    expect(reachedBy(story(), 'what-glows', { talk: 'tom' })?.id).toBe('the-lineman');
    expect(reachedBy(story(), 'the-lineman', { read: 'station-log' })?.id).toBe('the-answer');
    expect(reachedBy(story(), 'the-lineman', { read: 'tower-panel' })).toBeUndefined();
    // The latest chapter written: nothing moves it on until the next one is.
    expect(reachedBy(story(), 'the-answer', { store: true })).toBeUndefined();
  });

  it('keeps every chapter reached for the journal, first to latest', () => {
    expect(journal(story(), undefined).map(c => c.id)).toEqual(['home']);
    expect(journal(story(), 'the-lineman').map(c => c.id)).toEqual(['home', 'what-glows', 'the-lineman']);
  });

  it('lets people hint at what comes next, before what they always say', () => {
    expect(storyLines(story(), 'home', 'mira', ['Heading out?'])).toEqual(['Bring something home.', 'Heading out?']);
    expect(storyLines(story(), 'what-glows', 'mira', ['Heading out?'])).toEqual(['Ask Tom about the Old Stone.', 'Heading out?']);
    expect(storyLines(story(), 'home', 'tom', ['Pull up a chair.'])).toEqual(['Pull up a chair.']);
  });

  it('has the person who moves the story on point the way after they have told it', () => {
    // Talking to Tom now reaches the next chapter: he tells his story, then says where to go.
    expect(storyLines(story(), 'what-glows', 'tom', ['Pull up a chair.', 'I strung the wire.'])).toEqual(['Pull up a chair.', 'I strung the wire.', 'Go down the south road.']);
    expect(storyLines(story(), 'the-lineman', 'tom', ['Pull up a chair.'])).toEqual(['Go down the south road.', 'Pull up a chair.']);
  });
});

describe('validateStory', () => {
  const errors = (s: StoryData, maps = world()) => validateStory(s, maps, items).map(p => p.message).join('\n');

  it('passes a story about people, desks, maps and items that exist', () => {
    const s = story();
    s.chapters.push({ id: 'the-lab', title: 'The lab', text: 'You walked in.', when: { reach: 'lab' } }, { id: 'glow', title: 'Glow', text: 'You picked one.', when: { pick: 'glowcap' } });
    expect(validateStory(s, world(), items)).toEqual([]);
  });

  it('wants the first chapter reached by nobody, and each other by exactly one thing', () => {
    const s = story();
    s.chapters[0]!.when = { store: true };
    s.chapters[1]!.when = undefined;
    s.chapters[2]!.when = { talk: 'tom', read: 'station-log' } as never;
    const msgs = errors(s);
    expect(msgs).toMatch(/chapter 1 \("home"\): the first chapter is where everyone starts/);
    expect(msgs).toMatch(/chapter 2 \("what-glows"\): when is one of store, reach, feed, pick, talk, read/);
    expect(msgs).toMatch(/chapter 3 \("the-lineman"\): when is one of/);
  });

  it('catches chapters about people, desks, maps or items that do not exist', () => {
    const s = story();
    s.chapters.push(
      { id: 'a', title: 'A', text: 'A.', when: { talk: 'nobody' } },
      { id: 'b', title: 'B', text: 'B.', when: { read: 'no-desk' } },
      { id: 'c', title: 'C', text: 'C.', when: { reach: 'nowhere' } },
      { id: 'd', title: 'D', text: 'D.', when: { pick: 'nothing' } },
      { id: 'e', title: 'E', text: 'E.', when: { feed: 'water' as 'fire' } },
      { id: 'f', title: 'F', text: 'F.', when: { store: true }, hints: { ghost: 'Boo.', mira: ' ' } },
    );
    const msgs = errors(s);
    expect(msgs).toMatch(/"a"\): nobody has the id nobody/);
    expect(msgs).toMatch(/"b"\): no desk has the id no-desk/);
    expect(msgs).toMatch(/"c"\): there is no map nowhere/);
    expect(msgs).toMatch(/"d"\): there is no item nothing/);
    expect(msgs).toMatch(/"e"\): when feed is fire or stone/);
    expect(msgs).toMatch(/"f"\): a hint from ghost, but nobody has that id/);
    expect(msgs).toMatch(/"f"\): mira's hint says nothing/);
  });

  it('wants ids it can keep: well formed, one chapter each, one person or desk each', () => {
    const s = story();
    s.chapters.push({ id: 'home', title: 'Again', text: 'Again.', when: { store: true } }, { id: 'Not An Id', title: 'X', text: 'X.', when: { store: true } }, { id: 'no-text', title: '', text: '', when: { store: true } });
    const msgs = errors(s, [...world(), place('far', [npc('tom'), desk('station-log')])]);
    expect(msgs).toMatch(/chapter 5 \("home"\) is there twice/);
    expect(msgs).toMatch(/chapter 6 \("Not An Id"\): an id is lowercase words joined by hyphens/);
    expect(msgs).toMatch(/chapter 7 \("no-text"\) needs a title and a text/);
    expect(msgs).toMatch(/2 people have the id tom/);
    expect(msgs).toMatch(/2 desks have the id station-log/);
    expect(errors({ version: 0, chapters: [] })).toMatch(/version must be a whole number from 1\nthere are no chapters/);
  });
});
