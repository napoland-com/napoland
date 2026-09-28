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
 *
 * People also say something once about what you did for the first time (`remarks`: Mira after your
 * first collapse). Which remarks were said is kept in the player's counts (`told`, a bit for each in
 * the order of `remarks`), so remarks too are only ever added, at the end.
 */
import type { Stats } from './feats';

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

/** Something done for the first time that a person may say something about: a count in the player's stats (feats.ts) reaching 1. */
export type Milestone = 'collapsed' | 'surged' | 'made';
export const MILESTONES: readonly Milestone[] = ['collapsed', 'surged', 'made'];
/** Remarks fit in `told`, a bit each. */
export const MAX_REMARKS = 30;

/** What a person (an npc's id) says once, the first time you talk to them after the first time you did something. */
export interface Remark {
  /** Lowercase words joined by hyphens. */
  id: string;
  who: string;
  after: Milestone;
  line: string;
}

/**
 * What opens a scene (every part that is given must hold): a level reached, notes people left read (every
 * one of them), pages of the field notes open (every one), and what the town has come to (a milestone
 * reached or a work done, town.ts). Never the sky: a scene waits for you, not for the weather.
 */
export interface SceneWhen {
  level?: number;
  notes?: string[];
  pages?: string[];
  town?: string;
}

/**
 * A scene: something a person tells you once, at length, when you talk to them after it opened, in
 * place of what they usually say. The journal keeps it, by who told it (its People). Which scenes were
 * told is kept a bit each, by their place in `scenes` (Stats.scenes), so scenes are only ever added, at
 * the end.
 */
export interface Scene {
  /** Lowercase words joined by hyphens. */
  id: string;
  who: string;
  /** What the journal calls it. */
  title: string;
  when: SceneWhen;
  lines: string[];
}

/** The sky as a line may wait for it: rain, the dark (an aurora night is dark too), an aurora night, a storm over a region of the wilds. */
export const SAY_SKIES = ['rain', 'night', 'aurora', 'storm'] as const;
export type SaySky = (typeof SAY_SKIES)[number];

/**
 * When a person says a line (`says`), every time you talk to them while it holds (every part that is
 * given must): the sky now, a note read, a keepsake home, a page of the field notes open, what the town
 * has come to, a level reached.
 */
export interface SayWhen {
  sky?: SaySky;
  note?: string;
  keepsake?: string;
  page?: string;
  town?: string;
  level?: number;
}

/** A line a person says while something holds: about the sky (what they heard about the day), or about what you did or the town came to. */
export interface Say {
  who: string;
  when: SayWhen;
  line: string;
}

export interface StoryData {
  /** Bump when the story changes; a client with another version reloads. */
  version: number;
  chapters: Chapter[];
  /** Only ever added, at the end: a player's `told` counts them by their place. */
  remarks?: Remark[];
  /** Only ever added, at the end: a player's `scenes` counts them by their place. */
  scenes?: Scene[];
  /** What people say while something holds, in the order they say it. */
  says?: Say[];
}

/** Scenes fit in `scenes`, a bit each. */
export const MAX_SCENES = 30;

/**
 * What a person's words may follow besides the chapter and the counts: the player's level, the notes
 * they read, the keepsakes they brought home, the pages of their field notes open, what the town has
 * come to, the sky now (`sky`: the weather, and whether a storm blows over a region of the wilds), and
 * what they heard about the day (`day`: Mira's word from the woods).
 */
export interface SayContext {
  level?: number;
  notes?: readonly string[];
  keepsakes?: readonly string[];
  pages?: readonly string[];
  town?: readonly string[];
  sky?: { weather: string; storm: boolean };
  day?: readonly string[];
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

/** The remarks a person has for a player now, in order: after something they did for the first time, and not said yet. */
export function remarksDue(story: StoryData, npc: string, stats: Stats): Remark[] {
  const told = stats.told ?? 0;
  return (story.remarks ?? []).filter((r, i) => r.who === npc && (stats[r.after] ?? 0) >= 1 && !(told & (1 << i)));
}

/** `told` once the player has talked to `npc`: every remark of theirs that was due is said. */
export function toldAfter(story: StoryData, npc: string, stats: Stats): number {
  const due = new Set(remarksDue(story, npc, stats));
  return (story.remarks ?? []).reduce((told, r, i) => (due.has(r) ? told | (1 << i) : told), stats.told ?? 0);
}

/** Does a scene's `when` hold for this player? */
function opens(w: SceneWhen, ctx: SayContext): boolean {
  return (w.level === undefined || (ctx.level ?? 1) >= w.level)
    && (w.notes ?? []).every(n => ctx.notes?.includes(n))
    && (w.pages ?? []).every(p => ctx.pages?.includes(p))
    && (w.town === undefined || !!ctx.town?.includes(w.town));
}

/** The scene a person has for a player now: the first of theirs that opened and was not told yet. */
export function sceneDue(story: StoryData, npc: string, stats: Stats, ctx: SayContext = {}): Scene | undefined {
  const told = stats.scenes ?? 0;
  return (story.scenes ?? []).find((s, i) => s.who === npc && !(told & (1 << i)) && opens(s.when, ctx));
}

/** `scenes` once the player has talked to `npc`: the scene that was due is told. */
export function scenesAfter(story: StoryData, npc: string, stats: Stats, ctx: SayContext = {}): number {
  const due = sceneDue(story, npc, stats, ctx);
  const told = stats.scenes ?? 0;
  return due ? told | (1 << (story.scenes ?? []).indexOf(due)) : told;
}

/** The scenes a player was told, in the order of the story's scenes. */
export function scenesTold(story: StoryData, stats: Stats): Scene[] {
  const told = stats.scenes ?? 0;
  return (story.scenes ?? []).filter((_, i) => told & (1 << i));
}

/** Does the sky hold for a line? The dark is night and aurora; a storm is one over a region of the wilds. */
function skyHolds(sky: SaySky, now: SayContext['sky']): boolean {
  if (!now) return false;
  if (sky === 'storm') return now.storm;
  if (sky === 'night') return now.weather === 'night' || now.weather === 'aurora';
  return now.weather === sky;
}

/** Does a line's `when` hold for this player now? */
function holds(w: SayWhen, ctx: SayContext): boolean {
  return (w.sky === undefined || skyHolds(w.sky, ctx.sky))
    && (w.note === undefined || !!ctx.notes?.includes(w.note))
    && (w.keepsake === undefined || !!ctx.keepsakes?.includes(w.keepsake))
    && (w.page === undefined || !!ctx.pages?.includes(w.page))
    && (w.town === undefined || !!ctx.town?.includes(w.town))
    && (w.level === undefined || (ctx.level ?? 1) >= w.level);
}

/** How many of what someone always says one talk says: the rest waits for the next talks, in order. */
export const TALK_TURN = 3;

/**
 * The part of what someone always says (`lines`) that one talk says: TALK_TURN of them from `from`, up to
 * the last, so every talk is short and a few talks say it all in order, then it starts over. `next`: where
 * the next talk starts. Someone with little more to say than that says all of it every time.
 */
export function linesInTurn(lines: readonly string[], from: number): { lines: string[]; next: number } {
  if (lines.length <= TALK_TURN + 1) return { lines: [...lines], next: 0 };
  const start = from >= 0 && from < lines.length ? from : 0, end = Math.min(lines.length, start + TALK_TURN);
  return { lines: lines.slice(start, end), next: end < lines.length ? end : 0 };
}

/**
 * What a person says, in one order: the hint of the chapter you are in, if they have one; what they say
 * once about something you did for the first time (`stats`: remarksDue); then a scene, if one is due
 * (sceneDue), told in place of the rest; else what they heard about the day (`ctx.day`, and their lines
 * about the sky now), what they say about what you did or the town came to (`says`), and last what they
 * always say. When talking to them reaches the next chapter, that chapter's hint for them comes last
 * instead (they tell you, then point the way).
 */
export function storyLines(story: StoryData, id: string | undefined, npc: string, lines: readonly string[], stats: Stats = {}, ctx: SayContext = {}): string[] {
  const scene = sceneDue(story, npc, stats, ctx);
  const says = (story.says ?? []).filter(s => s.who === npc && holds(s.when, ctx));
  const said = [
    ...remarksDue(story, npc, stats).map(r => r.line),
    ...(scene ? scene.lines : [
      ...(ctx.day ?? []), ...says.filter(s => s.when.sky).map(s => s.line), ...says.filter(s => !s.when.sky).map(s => s.line), ...lines,
    ]),
  ];
  const reached = reachedBy(story, id, { talk: npc });
  if (reached) return reached.hints?.[npc] ? [...said, reached.hints[npc]] : said;
  const hint = chapterOf(story, id)?.hints?.[npc];
  return hint ? [hint, ...said] : said;
}
