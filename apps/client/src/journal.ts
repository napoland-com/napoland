/**
 * The journal, the one book the game keeps, in plain words for hud.ts: the chapters of the story you
 * reached (story.ts), the latest first, with no count of chapters and nothing to finish, since the story
 * goes on as the world grows; and the field notes (notebook.ts), area by area, each area with a count of
 * its pages ("The Near Woods: 23 of 41"), and the pages you opened in the order the notebook keeps them.
 */
import { ANYWHERE, type Chapter, type NotebookData, type NotebookState } from '@napoland/shared';

export interface JournalView {
  /** The latest first; `n` is the chapter's place in the story, from 1. */
  chapters: Array<{ n: number; title: string; text: string; latest: boolean }>;
}

/** What the journal shows of the chapters reached (first to latest, as Game.reached gives them). */
export function journalView(reached: readonly Chapter[]): JournalView {
  return { chapters: reached.map((c, i) => ({ n: i + 1, title: c.title, text: c.text, latest: i === reached.length - 1 })).reverse() };
}

/** A page of the field notes as the journal shows it: its lines, then each blank as its question or, seen, its answer. */
export interface FieldPageView {
  id: string;
  title: string;
  text: string;
  blanks: Array<{ text: string; filled: boolean }>;
  /** Opened since the field notes were last looked at. */
  fresh: boolean;
}

/** An area of the field notes: its name, how many of its pages are open of how many it has, and the open ones. */
export interface FieldAreaView {
  id: string;
  name: string;
  have: number;
  total: number;
  pages: FieldPageView[];
}

export interface FieldNotesView {
  areas: FieldAreaView[];
}

/** An area's name, for its heading: the map's own ("The Near Woods"), or "Anywhere". */
export function areaName(area: string, mapName: (id: string) => string | undefined): string {
  return area === ANYWHERE ? 'Anywhere' : mapName(area) ?? area;
}

/**
 * The field notes of a player's notebook: every area the notebook has, in the order its pages first name
 * them, with its count and the pages opened there. A page or blank this copy does not know (a newer
 * notebook's) neither shows nor counts.
 */
export function fieldNotesView(data: NotebookData, state: NotebookState, mapName: (id: string) => string | undefined, fresh: ReadonlySet<string> = new Set()): FieldNotesView {
  const open = new Set(state.pages), filled = new Set(state.blanks);
  const areas = new Map<string, FieldAreaView>();
  for (const p of data.pages) {
    let a = areas.get(p.area);
    if (!a) areas.set(p.area, (a = { id: p.area, name: areaName(p.area, mapName), have: 0, total: 0, pages: [] }));
    a.total++;
    if (!open.has(p.id)) continue;
    a.have++;
    a.pages.push({
      id: p.id, title: p.title, text: p.text, fresh: fresh.has(p.id),
      blanks: (p.blanks ?? []).map(b => (filled.has(b.id) ? { text: b.fill, filled: true } : { text: b.ask, filled: false })),
    });
  }
  return { areas: [...areas.values()] };
}

/** "The Near Woods: 23 of 41": an area's heading. */
export const areaHeading = (a: Pick<FieldAreaView, 'name' | 'have' | 'total'>): string => `${a.name}: ${a.have} of ${a.total}`;

/** What an area with no page open yet says under its heading. */
export const NOTHING_YET = 'Nothing yet.';

/** The field notes as the journal draws them: each area under its heading, then its open pages, or that there is nothing yet. */
export function fieldNotesHtml(v: FieldNotesView): string {
  return v.areas.map(a => `<section class="area"><h3>${esc(areaHeading(a))}</h3>${a.pages.length
    ? a.pages.map(p => `<article class="page"${p.fresh ? ' data-fresh' : ''}><h4>${esc(p.title)}</h4><p>${esc(p.text)}</p>`
      + `${p.blanks.map(b => `<p class="blank"${b.filled ? ' data-filled' : ''}>${esc(b.text)}</p>`).join('')}</article>`).join('')
    : `<p class="none">${NOTHING_YET}</p>`}</section>`).join('');
}

function esc(t: string): string {
  return t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
