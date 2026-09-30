/**
 * The journal, the one book the game keeps, in plain words for hud.ts: the chapters of the story you
 * reached (story.ts), the latest first, with no count of chapters and nothing to finish, since the story
 * goes on as the world grows; the field notes (notebook.ts), area by area, each area with a count of
 * its pages ("The Near Woods: 23 of 41"), and the pages you opened in the order the notebook keeps them;
 * the notes people left (notes.ts), by who wrote them, with the keepsakes you brought home; and what
 * people told you at length (story.ts, scenes), by who told it.
 */
import {
  ANYWHERE, AUTHOR_NAMES, NOTE_AUTHORS, firstInJournal, notesOf, scenesTold, secretKey, type Chapter, type FirstView, type ItemDef, type KeepsakesData, type MapData, type NoteAuthor,
  type NotebookData, type NotebookState, type Stats, type StoryData,
  pieceLines, pieceOf,
} from '@napoland/shared';

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

/** A note someone left, as the journal keeps it: what the text box called it, where it lies, and what it says. */
export interface NoteView {
  id: string;
  name: string;
  /** The name of the map it lies on: "The ranger's hut", "The Near Woods". */
  place: string;
  lines: string[];
  /** Read since the notes were last looked at. */
  fresh: boolean;
  /** Who read it first on the server, and when: "First read by Ana, day 3,052." (firsts.ts). */
  first?: string;
}

/** Someone who left notes: how many of theirs you read of how many there are, and those, in the order you read them. */
export interface AuthorView {
  by: NoteAuthor;
  name: string;
  have: number;
  total: number;
  notes: NoteView[];
}

/** The keepsakes home: each with its line, how many there are in all, and what the whole set home gives. */
export interface KeepsakesView {
  home: Array<{ item: string; name: string; text: string; first?: string }>;
  total: number;
  energy: number;
}

export interface NotesView {
  /** Only those you read something of: who else left notes is for you to find out. */
  authors: AuthorView[];
  /** The lines of your torn piece of the diagram, once you read Walt's last note on the line. */
  piece?: string[];
  /** Null until one is home. */
  keepsakes: KeepsakesView | null;
}

/**
 * The notes part of the journal: who left notes, in a fixed order (the ranger, Walt, the Barlows), each with
 * the notes of theirs you read, then the keepsakes you brought home. A note or keepsake this copy does not
 * know (a newer release's) neither shows nor counts.
 */
export function notesView(
  maps: Iterable<MapData>, read: readonly string[], keepsakes: KeepsakesData | undefined, home: readonly string[], item: (id: string) => ItemDef | undefined, fresh: ReadonlySet<string> = new Set(),
  firsts: ReadonlyMap<string, FirstView> = new Map(), me = '', meId = '',
): NotesView {
  const all = notesOf(maps);
  // Who found it first, under it: "by you" when that was you.
  const first = (key: string) => {
    const f = firsts.get(key);
    return f ? { first: firstInJournal(f, f.name === me) } : {};
  };
  const authors = NOTE_AUTHORS.flatMap((by): AuthorView[] => {
    const notes = read.flatMap((id): NoteView[] => {
      const n = all.get(id);
      return n && n.note.by === by ? [{ id, name: n.note.name, place: n.map.name, lines: [...n.note.text], fresh: fresh.has(id), ...first(secretKey({ kind: 'note', id })) }] : [];
    });
    return notes.length ? [{ by, name: AUTHOR_NAMES[by], have: notes.length, total: [...all.values()].filter(n => n.note.by === by).length, notes }] : [];
  });
  const kept = (keepsakes?.places ?? []).filter(p => home.includes(p.item)).flatMap(p => {
    const def = item(p.item);
    return def ? [{ item: def.id, name: def.name, text: def.text, ...first(secretKey({ kind: 'keepsake', item: def.id })) }] : [];
  });
  // Walt's last note on the line leads to the torn piece of NAPO's diagram; which one is worked out from your id.
  const piece = meId && read.includes('walt-n16') ? pieceLines(pieceOf(meId)) : undefined;
  return { authors, piece, keepsakes: kept.length ? { home: kept, total: keepsakes!.places.length, energy: keepsakes!.energy } : null };
}

/** "The ranger: 3 of 10": who left notes, and how many of theirs you read. */
export const authorHeading = (a: Pick<AuthorView, 'name' | 'have' | 'total'>): string => `${a.name}: ${a.have} of ${a.total}`;
/** "Keepsakes: 2 of 5 home". */
export const keepsakesHeading = (k: KeepsakesView): string => `Keepsakes: ${k.home.length} of ${k.total} home`;
/** What the whole set home gives, said under the keepsakes once it is. */
export const allHome = (k: KeepsakesView): string => `All of them are home: your energy bar is ${k.energy} bigger, for good.`;

/** The notes part as the journal draws it: each writer under their heading, then the keepsakes home, or that there is nothing yet. */
export function notesHtml(v: NotesView): string {
  const authors = v.authors.map(a => `<section class="area"><h3>${esc(authorHeading(a))}</h3>${a.notes.map(n => `<article class="page note"${n.fresh ? ' data-fresh' : ''}><h4>${esc(n.name)}</h4>`
    + `<p class="where">${esc(n.place)}</p>${n.lines.map(l => `<p>${esc(l)}</p>`).join('')}${firstLine(n.first)}</article>`).join('')}</section>`).join('');
  const k = v.keepsakes;
  const keepsakes = k ? `<section class="area keepsakes"><h3>${esc(keepsakesHeading(k))}</h3>${k.home.map(h => `<article class="page"><h4>${esc(h.name)}</h4><p>${esc(h.text)}</p>${firstLine(h.first)}</article>`).join('')}`
    + `${k.home.length === k.total ? `<p class="blank" data-filled>${esc(allHome(k))}</p>` : ''}</section>` : '';
  const torn = v.piece ? `<section class="area"><article class="page note"><h4>${esc(TORN_PIECE)}</h4>${v.piece.map(l => `<p>${esc(l)}</p>`).join('')}</article></section>` : '';
  return authors + torn + keepsakes || `<p class="none">${NOTHING_YET}</p>`;
}

export const TORN_PIECE = "A torn piece of NAPO's diagram";

/** Who found it first, dim under a note or a keepsake. */
const firstLine = (first: string | undefined) => (first ? `<p class="first">${esc(first)}</p>` : '');

function esc(t: string): string {
  return t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** A scene someone told you, as the journal keeps it: its title and what they said. */
export interface SceneView {
  id: string;
  title: string;
  lines: string[];
  /** Told since the journal's People were last looked at. */
  fresh: boolean;
}

/** Someone who told you things at length: their name, how many of theirs you heard of how many there are, and those, in the story's order. */
export interface PersonScenes {
  who: string;
  name: string;
  have: number;
  total: number;
  scenes: SceneView[];
}

/**
 * The People part of the journal: whoever told you a scene (story.ts, scenesTold), in the order the story
 * first names them, each with the scenes of theirs you heard. Nobody you heard nothing from shows: who
 * else has something to tell is for you to find out. `name` is a person's name by their id.
 */
export function peopleView(story: StoryData, stats: Stats, name: (id: string) => string, fresh: ReadonlySet<string> = new Set()): PersonScenes[] {
  const told = scenesTold(story, stats), all = story.scenes ?? [];
  const who = [...new Set(all.map(s => s.who))];
  return who.flatMap(w => {
    const heard = told.filter(s => s.who === w);
    return heard.length
      ? [{ who: w, name: name(w), have: heard.length, total: all.filter(s => s.who === w).length, scenes: heard.map(s => ({ id: s.id, title: s.title, lines: [...s.lines], fresh: fresh.has(s.id) })) }]
      : [];
  });
}

/** "Walt: 2 of 5": someone who told you things, and how many of theirs you heard. */
export const personHeading = (p: Pick<PersonScenes, 'name' | 'have' | 'total'>): string => `${p.name}: ${p.have} of ${p.total}`;

/** The People part as the journal draws it: each person under their heading, then their scenes, or that there is nothing yet. */
export function peopleHtml(v: readonly PersonScenes[]): string {
  return v.map(p => `<section class="area"><h3>${esc(personHeading(p))}</h3>${p.scenes.map(s => `<article class="page note"${s.fresh ? ' data-fresh' : ''}><h4>${esc(s.title)}</h4>`
    + `${s.lines.map(l => `<p>${esc(l)}</p>`).join('')}</article>`).join('')}</section>`).join('') || `<p class="none">${NOTHING_YET}</p>`;
}
