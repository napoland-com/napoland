import { describe, expect, it } from 'vitest';
import { MAX_REMARKS, TALK_TURN, chapterOf, journal, linesInTurn, nextChapter, reachedBy, remarksDue, storyLines, toldAfter, validateStory, type ItemsData, type MapData, type MapObject, type Remark, type StoryData } from '../src';

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

describe('what people say once, after the first time you did something', () => {
  const REMARKS: Remark[] = [
    { id: 'first-collapse', who: 'mira', after: 'collapsed', line: 'You went down out there.' },
    { id: 'first-surge', who: 'mira', after: 'surged', line: 'A surge caught you.' },
    { id: 'first-made', who: 'tom', after: 'made', line: 'Made that yourself?' },
  ];
  const told = (): StoryData => ({ ...story(), remarks: REMARKS });

  it('comes after the chapter\'s hint and before what they always say, once something was done for the first time', () => {
    expect(storyLines(told(), 'home', 'mira', ['Heading out?'])).toEqual(['Bring something home.', 'Heading out?']);
    expect(storyLines(told(), 'home', 'mira', ['Heading out?'], { collapsed: 1 })).toEqual(['Bring something home.', 'You went down out there.', 'Heading out?']);
    expect(storyLines(told(), 'home', 'mira', ['Heading out?'], { collapsed: 3, surged: 1 })).toEqual(['Bring something home.', 'You went down out there.', 'A surge caught you.', 'Heading out?']);
    // Only from whoever says it.
    expect(storyLines(told(), 'home', 'tom', ['Pull up a chair.'], { collapsed: 1 })).toEqual(['Pull up a chair.']);
    expect(storyLines(told(), 'home', 'tom', ['Pull up a chair.'], { made: 2 })).toEqual(['Made that yourself?', 'Pull up a chair.']);
  });

  it('comes before what they always say when talking to them moves the story on, whose hint comes last', () => {
    expect(storyLines(told(), 'what-glows', 'tom', ['Pull up a chair.'], { made: 1 })).toEqual(['Made that yourself?', 'Pull up a chair.', 'Go down the south road.']);
  });

  it('comes before what they have to say about the day (Mira\'s word from the woods, Walt\'s on the Long Night), which comes before what they always say', () => {
    const today = ['Long Night tonight.'];
    expect(storyLines(told(), 'home', 'tom', ['Pull up a chair.'], { made: 1 }, today)).toEqual(['Made that yourself?', 'Long Night tonight.', 'Pull up a chair.']);
    expect(storyLines(told(), 'the-lineman', 'tom', ['Pull up a chair.'], {}, today)).toEqual(['Go down the south road.', 'Long Night tonight.', 'Pull up a chair.']);
    // Talking to them moves the story on: the hint still comes last.
    expect(storyLines(told(), 'what-glows', 'tom', ['Pull up a chair.'], {}, today)).toEqual(['Long Night tonight.', 'Pull up a chair.', 'Go down the south road.']);
  });

  it('is said once: talking to them keeps it told, a bit for each remark in its order', () => {
    const stats = { collapsed: 1, surged: 1, made: 1 };
    expect(remarksDue(told(), 'mira', stats).map(r => r.id)).toEqual(['first-collapse', 'first-surge']);
    const afterMira = toldAfter(told(), 'mira', stats);
    expect(afterMira).toBe(0b011);
    expect(remarksDue(told(), 'mira', { ...stats, told: afterMira })).toEqual([]);
    expect(storyLines(told(), 'home', 'mira', ['Heading out?'], { ...stats, told: afterMira })).toEqual(['Bring something home.', 'Heading out?']);
    // Tom's is still his to say; talking to him keeps Mira's told too.
    expect(toldAfter(told(), 'tom', { ...stats, told: afterMira })).toBe(0b111);
    // Nothing due: nothing changes.
    expect(toldAfter(told(), 'tom', { collapsed: 1 })).toBe(0);
    expect(toldAfter(story(), 'mira', stats)).toBe(0);
  });

  it('is checked with the story: people who exist, what counts, a line, ids kept, and few enough to keep', () => {
    const errors = (remarks: Remark[]) => validateStory({ ...story(), remarks }, world(), items).map(p => p.message);
    expect(errors(REMARKS)).toEqual([]);
    expect(errors([
      { id: 'a', who: 'ghost', after: 'collapsed', line: 'Boo.' },
      { id: 'b', who: 'mira', after: 'fed' as never, line: 'Warm?' },
      { id: 'c', who: 'mira', after: 'made', line: ' ' },
      { id: 'c', who: 'tom', after: 'made', line: 'Again.' },
      { id: 'Not An Id', who: 'tom', after: 'surged', line: 'Hm.' },
    ])).toEqual([
      'remark 1 ("a"): nobody has the id ghost',
      'remark 2 ("b"): after is one of collapsed, surged, made',
      'remark 3 ("c") says nothing',
      'remark 4 ("c") is there twice',
      'remark 5 ("Not An Id"): an id is lowercase words joined by hyphens',
    ]);
    const many = Array.from({ length: MAX_REMARKS + 1 }, (_, i): Remark => ({ id: `r-${i}`, who: 'mira', after: 'made', line: 'Hm.' }));
    expect(errors(many)).toEqual([`there are ${MAX_REMARKS + 1} remarks, and which were said is kept for at most ${MAX_REMARKS}`]);
    // One that is not a remark at all is said to be so, and the rest are checked as ever.
    expect(errors([null as never, REMARKS[0]!, 'Boo.' as never])).toEqual([
      'remark 1: a remark has an id, who says it, after what, and the line',
      'remark 3: a remark has an id, who says it, after what, and the line',
    ]);
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

describe('what someone always says, a few lines a talk', () => {
  const eight = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  it('says TALK_TURN lines a talk, in order, up to the last, then starts over', () => {
    expect(TALK_TURN).toBe(3);
    expect(linesInTurn(eight, 0)).toEqual({ lines: ['a', 'b', 'c'], next: 3 });
    expect(linesInTurn(eight, 3)).toEqual({ lines: ['d', 'e', 'f'], next: 6 });
    expect(linesInTurn(eight, 6)).toEqual({ lines: ['g', 'h'], next: 0 });
    // Lines taken away since (another release): from the start.
    expect(linesInTurn(eight.slice(0, 5), 6)).toEqual({ lines: ['a', 'b', 'c'], next: 3 });
  });

  it('says all of it every time when there is little more than a talk\'s worth', () => {
    expect(linesInTurn(['a', 'b', 'c', 'd'], 0)).toEqual({ lines: ['a', 'b', 'c', 'd'], next: 0 });
    expect(linesInTurn(['a'], 5)).toEqual({ lines: ['a'], next: 0 });
    expect(linesInTurn([], 0)).toEqual({ lines: [], next: 0 });
  });
});
