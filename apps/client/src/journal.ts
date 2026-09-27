/**
 * The journal: the chapters of the story you reached (story.ts), in plain words for hud.ts. The
 * latest comes first: it is what you open the journal for. No count of chapters, and nothing to
 * finish: the story goes on as the world grows.
 */
import type { Chapter } from '@napoland/shared';

export interface JournalView {
  /** The latest first; `n` is the chapter's place in the story, from 1. */
  chapters: Array<{ n: number; title: string; text: string; latest: boolean }>;
}

/** What the journal shows of the chapters reached (first to latest, as Game.reached gives them). */
export function journalView(reached: readonly Chapter[]): JournalView {
  return { chapters: reached.map((c, i) => ({ n: i + 1, title: c.title, text: c.text, latest: i === reached.length - 1 })).reverse() };
}
