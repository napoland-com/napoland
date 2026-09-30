/**
 * First finders (docs/DESIGN.md, Cooperation): the first player on the server to find each secret gets
 * their name kept with it, and everyone sees it: a one-line banner for everyone online, the latest three
 * on the notice board, and a line in the journal of whoever finds it after ("First read by Ana, day
 * 3,052"). A secret is a note someone left (read in its time) or a keepsake (picked up); later a map
 * piece or an echo's walk. The story's chapters never are one: the story is not a race. Only the first
 * finder is kept, whoever they are (a guest too), and nobody's name is hidden from anyone.
 *
 * A secret goes by a key of its own ("note:ranger-fires", "keepsake:brass-compass"); the day is the
 * Zone's (sky.ts, zoneDay).
 */
import { nounOf, type ItemDef } from './items';
import type { MapData } from './map';
import type { MapNote } from './notes';

/** Something the first to find it is remembered for: a note, by its id; a keepsake, by its item. */
export type Secret = { kind: 'note'; id: string } | { kind: 'keepsake'; item: string };

/** A secret's key, as it is kept. */
export const secretKey = (s: Secret): string => (s.kind === 'note' ? `note:${s.id}` : `keepsake:${s.item}`);

/** The secret a key names; undefined for a kind this release does not know (a newer one kept it). */
export function secretOf(key: string): Secret | undefined {
  const at = key.indexOf(':'), kind = key.slice(0, at), id = key.slice(at + 1);
  if (at < 1 || !id) return undefined;
  if (kind === 'note') return { kind, id };
  if (kind === 'keepsake') return { kind, item: id };
  return undefined;
}

/** The first finder of a secret, as everyone sees it: the secret's key, their name, and the Zone's day it was found. */
export interface FirstView {
  secret: string;
  name: string;
  day: number;
}

/** "12,345": a count with its thousands apart, the same in every language. */
export function thousands(n: number): string {
  return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Whose a note is, in a sentence. */
const WHOSE = { ranger: 'the ranger\'s', walt: 'Walt\'s', barlows: 'the Barlows\'', leavers: 'the leavers\'' } as const;
/** "The ranger's hut" in a sentence: "the ranger's hut". */
const inSentence = (name: string) => name.replace(/^The /, 'the ');
/** A place's name with its article: "pond" is "the pond", "the Tower" stays. */
const withThe = (name: string) => (/^the /i.test(name) ? inSentence(name) : `the ${name}`);

/**
 * What a secret is called in a sentence: "the ranger's note by the pond" (out of doors, by the nearest
 * place its map names), "Walt's note in the tower shed" (in a room), "the brass compass". `notes` are
 * every note by id (notes.ts, notesOf); undefined for a secret this release does not know.
 */
export function secretTitle(key: string, notes: ReadonlyMap<string, { map: MapData; note: MapNote }>, items: ReadonlyMap<string, ItemDef>): string | undefined {
  const s = secretOf(key);
  if (s?.kind === 'keepsake') {
    const def = items.get(s.item);
    return def && `the ${nounOf(def)}`;
  }
  const found = s && notes.get(s.id);
  if (!found) return undefined;
  const { map, note } = found;
  const place = map.kind === 'inside' ? undefined : [...(map.places ?? [])].sort((a, b) => Math.hypot(a.x - note.x, a.y - note.y) - Math.hypot(b.x - note.x, b.y - note.y))[0];
  return `${WHOSE[note.by]} note ${place ? `by ${withThe(place.name)}` : `in ${inSentence(map.name)}`}`;
}

/** Reading a note, finding a keepsake. */
const verbs = (key: string): [string, string] => (secretOf(key)?.kind === 'keepsake' ? ['find', 'found'] : ['read', 'read']);

/** The banner for everyone online: "Ana is the first to read the ranger's note by the pond." (`you`: the finder hears it too). */
export function firstBanner(f: FirstView, title: string, you = false): string {
  return `${you ? 'You are' : `${f.name} is`} the first to ${verbs(f.secret)[0]} ${title}.`;
}

/** A line of the notice board: "First to read the ranger's note by the pond: Ana, on day 3,052." */
export function firstOnBoard(f: FirstView, title: string): string {
  return `First to ${verbs(f.secret)[0]} ${title}: ${f.name}, on day ${thousands(f.day)}.`;
}

/** The line under a note or a keepsake in the journal: "First read by Ana, day 3,052." (`you`: "by you"). */
export function firstInJournal(f: FirstView, you = false): string {
  return `First ${verbs(f.secret)[1]} by ${you ? 'you' : f.name}, day ${thousands(f.day)}.`;
}
