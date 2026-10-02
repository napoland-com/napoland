/**
 * What people left behind (docs/DESIGN.md, the story): handwritten notes, and keepsakes.
 *
 * About thirty notes lie in fixed places on the maps (MapObject 'note'): on the tables and shelves of
 * the shelters, in a car, on the luggage, nailed to the poles. The ranger, Walt Pruitt when he walked
 * the line, and the Barlows from the cabin at the end wrote them, and the deeper a note lies, the more
 * it says. You read one like a sign, facing what it lies on. Some only show at certain times: what the
 * ranger wrote in glowcap and resin glows in the dark (night), what Wren Barlow wrote in white crayon
 * shows on wet paper (rain), and what was scratched with a shard shows when the sky is green (aurora).
 * The first read of each gives NOTE_XP, once, and the journal keeps it (its third part, Notes).
 *
 * Keepsakes are one-of-a-kind things (content/items.json, kind 'keepsake', and where each lies in
 * `keepsakes`): each lies where it was left, for every player on their own, until they bring it home
 * once; then it is theirs for good, and the whole set home makes their energy bar bigger for good.
 * Carried, it never falls into a pile, a crate or anyone else's hands: lost, it goes back where it lay.
 */
import type { ItemDef } from './items';
import type { MapData, MapObject, NoteAuthor, NoteWhen } from './map';
import { leanLine } from './line';
import type { Weather } from './protocol';

export type MapNote = Extract<MapObject, { kind: 'note' }>;

/** XP for the first read of each note, once. */
export const NOTE_XP = 5;

/** How the journal names who wrote a note. */
export const AUTHOR_NAMES: Readonly<Record<NoteAuthor, string>> = { ranger: 'The ranger', walt: 'Walt Pruitt', barlows: 'The Barlows', leavers: 'The people who left', brandts: 'Agnes and Jon Brandt' };

/** What the text box says of a note at the wrong time, unless the note says its own (`faint`). */
export const FAINT: Readonly<Record<NoteWhen, string>> = {
  night: 'The writing is too faint to read in this light.',
  rain: 'The paper looks blank, and feels waxy.',
  aurora: 'It only shows when the sky is green.',
};

/**
 * Does the note show now? Glowing writing at night (an aurora night is a night too), wax on wet paper in
 * the rain or a storm (`storm`: one blows over the note's map), a shard's scratches on an aurora night.
 */
export function noteShows(note: MapNote, weather: Weather, storm = false): boolean {
  switch (note.when) {
    case undefined: return true;
    case 'night': return weather === 'night' || weather === 'aurora';
    case 'rain': return weather === 'rain' || storm;
    case 'aurora': return weather === 'aurora';
  }
}

/** What the text box says of a note now: its text, or at the wrong time only that it cannot be read. */
export function noteLines(note: MapNote, weather: Weather, storm = false): string[] {
  return noteShows(note, weather, storm) ? note.text : [note.faint ?? FAINT[note.when!]];
}

/** The note lying on tile x,y of a map, if any. */
export function noteAt(map: MapData, x: number, y: number): MapNote | undefined {
  return map.objects.find((o): o is MapNote => o.kind === 'note' && o.x === x && o.y === y);
}

/**
 * The tin tag of the pole on tile x,y of a map, if it is on the north line: the poles are listed in the order they
 * are strung, N-1 to N-6 in Stonebrook and N-7 to N-16 in the Near Woods (the South Road's are NAPO's, and carry none).
 * Worked out from that order, so no map changes; a map that re-orders its poles re-numbers the line.
 */
const LINE_FIRST: Readonly<Record<string, number>> = { stonebrook: 1, 'near-woods': 7, 'other-woods': 7 };
/** The Other Woods are the Near Woods said back: their tags read backwards ("61-N"), and so lean no way anyone reads. */
const SAID_BACK = new Set(['other-woods']);
export function poleTag(map: MapData, x: number, y: number): string | undefined {
  const first = LINE_FIRST[map.id];
  if (first === undefined) return undefined;
  const i = map.objects.filter(o => o.kind === 'pole').findIndex(o => o.x === x && o.y === y);
  if (i < 0) return undefined;
  const tag = `N-${first + i}`;
  return SAID_BACK.has(map.id) ? [...tag].reverse().join('') : tag;
}

/**
 * What reading a pole of the north line says: its tin tag in front unless what was said already names it, and
 * how it leans (line.ts) after. `said` is what shows now (a note may show only at night); `text` is the whole
 * note, and decides whether the tag is gone: Walt's N-16 note says so, but only on a green night, and the tag is
 * gone every night. A pole with no tag (not on the line) says what it said.
 */
export function withTag(said: string[], tag: string | undefined, text: string[] = said): string[] {
  if (!tag) return said;
  const gone = text.some(l => l.includes('Tag\'s off'));
  const lean = leanLine(tag);
  return [...(gone || said.some(l => l.startsWith(`${tag}.`)) ? [] : [`A tin tag, stamped ${tag}.`]), ...said, ...(lean ? [lean] : [])];
}

/** Every note on these maps by id, with the map it lies on, in the order of the maps and their objects. */
export function notesOf(maps: Iterable<MapData>): Map<string, { map: MapData; note: MapNote }> {
  const out = new Map<string, { map: MapData; note: MapNote }>();
  for (const map of maps) for (const o of map.objects) if (o.kind === 'note' && !out.has(o.id)) out.set(o.id, { map, note: o });
  return out;
}

/** Where one keepsake lies until a player brings it home: its item, on tile x,y of map `map`. */
export interface KeepsakePlace {
  item: string;
  map: string;
  x: number;
  y: number;
}

/** The keepsakes (content/items.json): where each lies, and how much bigger the energy bar is for good with all of them home. */
export interface KeepsakesData {
  energy: number;
  places: KeepsakePlace[];
}

/**
 * A keepsake lying for a player is a find of theirs alone, sent with the map's finds under an id of
 * its own: below zero, so it never meets the shared finds' ids (which count up from 1).
 */
export const keepsakeFindId = (index: number): number => -(index + 1);

/** Is this item a keepsake? */
export const isKeepsake = (def: ItemDef | undefined): boolean => def?.kind === 'keepsake';

/** How much bigger a player's energy bar is with these keepsakes home: the whole set, or nothing. */
export function keepsakeEnergy(data: KeepsakesData | undefined, home: readonly string[] | undefined): number {
  if (!data?.places.length || !home?.length) return 0;
  return data.places.every(p => home.includes(p.item)) ? data.energy : 0;
}

/**
 * A saved list of ids (the notes read, the keepsakes home) as a clean list: strings, each once, in the
 * order they came. Ids this release does not know (a newer one wrote them) are kept for when it is back.
 */
export function cleanIds(saved: unknown): string[] {
  if (!Array.isArray(saved)) return [];
  return [...new Set(saved.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= 64))];
}
