/**
 * The field notes (docs/DESIGN.md, the story: the journal): the second part of the one book the game
 * keeps, beside the story's chapters. Its pages are content (content/notebook.json): each belongs to an
 * area (a town or a region of the wilds, or anywhere), and opens the first time the player does or
 * lives through what it is about: picks up a kind of find, reads a sign, a desk, a paper or a tag, or
 * sees something happen out there (a sight). A page about the strange may end in blanks, questions
 * that fill in only once the player sees the answer happen, after the page is open: you learn the
 * rules by watching, never by being told. Pages never say where anything is.
 *
 * What a player has is the ids of the pages opened and the blanks filled, in the order they came; ids
 * a newer notebook.json wrote (a release rolled back) are kept, and only the ones this copy knows show.
 */
import { objectTiles, type MapData, type MapObject } from './map';

/**
 * What a player lives through that a page, or one of its blanks, may wait for. The server notices
 * each one (World), and only ever these: content picks from them (validateNotebook checks).
 */
export const SIGHTS = [
  /** A surge came over you while a street light or a roof sheltered you. */
  'surge',
  /** Caught out in a surge, you reached a street light: the drain stopped. */
  'lit',
  /** A storm blew over you out in the open. */
  'storm',
  /** A roof kept a storm off you. */
  'roof',
  /** A patch of ground started to glow near you. */
  'flash',
  /** A flash burst where you stood. */
  'burst',
  /** An aurora night found you out in the wilds. */
  'aurora',
  /** The dead power lines hummed beside you on an aurora night. */
  'hum',
  /** Something clung to your back. */
  'hitched',
  /** What clung to you let go: at a street light, a fire, a roof or a flare. */
  'let-go',
  /** The lamp with no wires went out (line.ts), while you were in the woods. */
  'lamp-out',
  /** You stood on a lakebed while the water was drawn back (MapData.drawdown). */
  'drawdown',
  /** The water came back while you were on the lakebed, and carried you ashore. */
  'flooded',
  /** A watcher stood within sight. */
  'watcher',
  /** A watcher froze while you faced it. */
  'froze',
  /** A skulker chased you, and gave up before it caught you. */
  'escaped',
  /** The ferns rustled as a skulker came, for you or for someone near you. */
  'rustle',
  /** You hid in tall grass while something hunted near. */
  'hidden',
  /** Something chasing you gave up at the edge of the tall grass you reached. */
  'grass',
  /** You looked closely at a strange object in town, and saw what it was. */
  'looked',
  /** A live find faded in your bag. */
  'faded',
  /** The Old Stone woke. */
  'woke',
  /** You ate (or drank) a meal you cooked at a fire (meals.ts). */
  'ate',
] as const;
export type Sight = (typeof SIGHTS)[number];

/** When a find was picked up, for a blank that waits for one picked up then: on an aurora night, while a storm blew over its region, or in the rain. */
export const DURING = ['aurora', 'storm', 'rain'] as const;
export type During = (typeof DURING)[number];

/** A readable thing by where it stands: the map and its tile (the first, for something bigger), for what has no id of its own. */
export interface ReadAt {
  map: string;
  x: number;
  y: number;
}

/**
 * What opens a page or fills a blank: a find picked up (or what a strange object turned out to be), a
 * readable thing read (by its id, or by where it stands), or a sight.
 */
export type NotebookEvent = { find: string; during?: During } | { read: string | ReadAt } | { saw: Sight };

/** A fact that reads as a question until it is seen (`ask`, "It stops when... ?"), and then as its answer (`fill`). */
export interface Blank {
  /** Lowercase words joined by hyphens, unique in the whole notebook; never changed once players filled it. */
  id: string;
  ask: string;
  fill: string;
  /** What fills it in, once its page is open. */
  when: NotebookEvent;
}

export interface Page {
  /** Lowercase words joined by hyphens; never changed once players opened it. */
  id: string;
  /** The map it belongs to (a town or a region of the wilds, its rooms included), or 'anywhere'. */
  area: string;
  title: string;
  /** In the voice of the player's own notes: short, observational, plain, and never where anything is. */
  text: string;
  /** What opens it: one event, or any of several. */
  when: NotebookEvent | NotebookEvent[];
  blanks?: Blank[];
}

export interface NotebookData {
  /** Bump when the notebook changes; a client with another version reloads. */
  version: number;
  /** In the order the journal shows them, area by area. */
  pages: Page[];
}

/** A player's notebook: the ids of the pages opened and the blanks filled, in the order they came. */
export interface NotebookState {
  pages: string[];
  blanks: string[];
}

/** What the welcome says of it: the version of content/notebook.json the server runs, and the player's notebook. */
export interface NotebookView extends NotebookState {
  version: number;
}

/** The area of a page that belongs to no one place. */
export const ANYWHERE = 'anywhere';

/** A notebook with nothing in it. */
export const emptyNotebook = (): NotebookState => ({ pages: [], blanks: [] });

/** The kinds of thing read like a sign (the text box shows what it says): what a read event may name. */
export const READABLE = new Set<MapObject['kind']>(['sign', 'console', 'paper', 'cage', 'jeep', 'gate', 'sister', 'standing']);
export type Readable = Extract<MapObject, { kind: 'sign' | 'console' | 'paper' | 'cage' | 'jeep' | 'gate' }>;

/** The readable thing covering tile x,y of a map, if one does (a jeep is bigger than one tile). */
export function readableAt(map: MapData, x: number, y: number): Readable | undefined {
  return map.objects.find((o): o is Readable => READABLE.has(o.kind) && objectTiles(o).some(([tx, ty]) => tx === x && ty === y));
}

/** The read events of a readable thing on `map`: by where it stands, and by its id when it has one (a desk). */
export function readEvents(map: string, o: Readable): NotebookEvent[] {
  const at: NotebookEvent = { read: { map, x: o.x, y: o.y } };
  return o.kind === 'console' ? [{ read: o.id }, at] : [at];
}

/** The one string an event is known by, to look it up. */
export function eventKey(e: NotebookEvent): string {
  if ('find' in e) return e.during ? `find:${e.find}@${e.during}` : `find:${e.find}`;
  if ('read' in e) return typeof e.read === 'string' ? `read:${e.read}` : `read:${e.read.map}@${e.read.x},${e.read.y}`;
  return `saw:${e.saw}`;
}

/** What opens a page, as a list. */
export const opensOn = (p: Page): NotebookEvent[] => (Array.isArray(p.when) ? p.when : [p.when]);

/** The pages and blanks each event may open or fill, made once from the notebook. */
export interface NotebookIndex {
  data: NotebookData;
  opens: Map<string, Page[]>;
  fills: Map<string, Array<{ page: Page; blank: Blank }>>;
}

export function notebookIndex(data: NotebookData): NotebookIndex {
  const opens = new Map<string, Page[]>(), fills = new Map<string, Array<{ page: Page; blank: Blank }>>();
  for (const page of data.pages) {
    for (const e of opensOn(page)) {
      const k = eventKey(e);
      opens.set(k, [...(opens.get(k) ?? []), page]);
    }
    for (const blank of page.blanks ?? []) {
      const k = eventKey(blank.when);
      fills.set(k, [...(fills.get(k) ?? []), { page, blank }]);
    }
  }
  return { data, opens, fills };
}

/**
 * What an event does to a player's notebook: the pages it opens (not open yet), then the blanks it fills
 * on pages open by then (the ones it just opened too); null when it does nothing, which is nearly always
 * and cheap to find out. A blank waits for its page: seen before the page was, it went unnoticed.
 */
export function noted(index: NotebookIndex, state: NotebookState, event: NotebookEvent): { pages: Page[]; blanks: Blank[]; state: NotebookState } | null {
  const key = eventKey(event);
  const pages = (index.opens.get(key) ?? []).filter(p => !state.pages.includes(p.id));
  const open = new Set([...state.pages, ...pages.map(p => p.id)]);
  const blanks = (index.fills.get(key) ?? []).filter(f => open.has(f.page.id) && !state.blanks.includes(f.blank.id)).map(f => f.blank);
  if (!pages.length && !blanks.length) return null;
  return { pages, blanks, state: { pages: [...state.pages, ...pages.map(p => p.id)], blanks: [...state.blanks, ...blanks.map(b => b.id)] } };
}

/** A saved notebook as the server writes them: ids, each once, in the order they came. Anything else counts as nothing yet. */
export function cleanNotebook(saved: unknown): NotebookState {
  const raw = (typeof saved === 'object' && saved !== null ? saved : {}) as Partial<Record<keyof NotebookState, unknown>>;
  const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((id): id is string => typeof id === 'string' && id !== ''))] : []);
  return { pages: ids(raw.pages), blanks: ids(raw.blanks) };
}

/** The page a blank is on, and the blank, by the blank's id. */
export function blankOf(data: NotebookData, id: string): { page: Page; blank: Blank } | undefined {
  for (const page of data.pages) {
    const blank = page.blanks?.find(b => b.id === id);
    if (blank) return { page, blank };
  }
  return undefined;
}
