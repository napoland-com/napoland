/**
 * The story you go through, in chapters (docs/DESIGN.md, the story). Chapters are data
 * (content/story.json) and come one after another: everyone starts in the first, and each of the
 * others is reached by one thing the game already asks of you, its `when` (bring something home, walk
 * somewhere, feed a fire, talk to someone, read one of NAPO's desks). While a chapter is the latest you
 * reached, people may hint at the next one in their own words (`hints`). Nothing is ever missed or
 * failed, and the story is never finished: new chapters are added at the end as the world grows.
 *
 * Chapters are only ever added, at the end, never removed or reordered: a player's place in the
 * story is the id of the latest chapter they reached, and it has to keep meaning the same. So an id
 * the story does not have comes from a newer one (a release rolled back): that player is past every
 * chapter written here, and keeps their id for when the newer story is back.
 */

/** One thing a player did that can move the story on. */
export type StoryEvent =
  /** Put something into the stash. */
  | { store: true }
  /** Walked onto this map (through an exit or a door). */
  | { reach: string }
  /** Fed a fire out in the wilds (never one in town), or a shard to the Old Stone. */
  | { feed: 'fire' | 'stone' }
  /** Picked up a find of this item. */
  | { pick: string }
  /** Talked to this person (an npc's id). */
  | { talk: string }
  /** Read this desk of NAPO's (a console's id). */
  | { read: string };

/** The kinds of StoryEvent, for checking content. */
export const STORY_EVENTS = ['store', 'reach', 'feed', 'pick', 'talk', 'read'] as const;

export interface Chapter {
  /** Lowercase words joined by hyphens; never changed once players reached it. */
  id: string;
  title: string;
  /** What the journal keeps of it. */
  text: string;
  /** What reaches it. The first chapter has none: everyone starts there. */
  when?: StoryEvent;
  /** While this is the latest chapter reached: what a person (by npc id) says before their usual lines. */
  hints?: Record<string, string>;
}

export interface StoryData {
  /** Bump when the story changes; a client with another version reloads. */
  version: number;
  chapters: Chapter[];
}

/**
 * The chapter a player is in: the one with this id; the first for a player who never started (no id);
 * the last for an id from a newer story, which only has more chapters.
 */
export function chapterOf(story: StoryData, id: string | undefined): Chapter | undefined {
  if (!id) return story.chapters[0];
  return story.chapters.find(c => c.id === id) ?? story.chapters.at(-1);
}

/** The chapter after the one a player is in, if it is written yet (never for an id from a newer story). */
export function nextChapter(story: StoryData, id: string | undefined): Chapter | undefined {
  if (id && !story.chapters.some(c => c.id === id)) return undefined;
  const at = chapterOf(story, id);
  return at && story.chapters[story.chapters.indexOf(at) + 1];
}

/** Is this what the chapter waits for? */
export function reaches(chapter: Chapter, event: StoryEvent): boolean {
  const w = chapter.when;
  if (!w) return false;
  const [kind, value] = Object.entries(w)[0] ?? [];
  return kind !== undefined && (event as Record<string, unknown>)[kind] === value;
}

/** The chapter this event reaches, for a player in chapter `id`: the next one, if the event is what it waits for. */
export function reachedBy(story: StoryData, id: string | undefined, event: StoryEvent): Chapter | undefined {
  const next = nextChapter(story, id);
  return next && reaches(next, event) ? next : undefined;
}

/** The chapters reached so far, first to latest: what the journal shows. */
export function journal(story: StoryData, id: string | undefined): Chapter[] {
  const at = chapterOf(story, id);
  return at ? story.chapters.slice(0, story.chapters.indexOf(at) + 1) : [];
}

/**
 * What a person says, story included. When talking to them reaches the next chapter, that chapter's
 * hint for them comes after what they always say (they tell you, then point the way); otherwise the
 * hint of the chapter you are in, if they have one, comes first.
 */
export function storyLines(story: StoryData, id: string | undefined, npc: string, lines: readonly string[]): string[] {
  const reached = reachedBy(story, id, { talk: npc });
  if (reached) return reached.hints?.[npc] ? [...lines, reached.hints[npc]] : [...lines];
  const hint = chapterOf(story, id)?.hints?.[npc];
  return hint ? [hint, ...lines] : [...lines];
}
