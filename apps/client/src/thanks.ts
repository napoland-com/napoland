/**
 * Thanks, as the client offers and words them (the rules are shared/thanks.ts, and the server decides
 * whether one goes through). Warming at a fire someone else fed, for a few seconds and standing still,
 * or stopping where someone's arrow points after following it there, the text box offers once to thank
 * them, by name: "Ana fed this fire. Thank Ana?" Never for yourself, for someone you thanked today (UTC)
 * or block, and never again for a fire or an arrow you said no to this session. Nothing is offered while
 * a question, a panel or someone's lines are up: it waits, and is dropped if you walked away meanwhile.
 *
 * The helper reads it as a float over their head out in the wilds ("Tess thanked you: +3"), a line in
 * the text box anywhere else, and, for what the float did not say, a letter when they come home.
 *
 * Plain logic with no page in it, so it is tested; game.ts runs it, hud.ts shows the text box.
 */
import { FIRE_RADIUS, type Dir, type MapData, type MarkView, type PersonView, type Refusal, type ThanksFor, type ThanksGroup } from '@napoland/shared';

/** How long you warm by a fire someone else fed, standing still, before the text box offers to thank them. */
export const THANK_AFTER_MS = 3000;

// ---------- what the text box says ----------

export const fireThanksQuestion = (name: string) => `${name} fed this fire. Thank ${name}?`;
export const markThanksQuestion = (name: string) => `${name} painted this arrow. Thank ${name}?`;

/** Over your head, out in the wilds: what the thanks gave you. */
export function thankedFloat(name: string, energy?: number): string {
  return energy ? `${name} thanked you: +${energy}` : `${name} thanked you`;
}

/** In the text box, anywhere but out in the wilds: "Tess thanked you for the fire at the ranger's hut." */
export function thankedLine(name: string, what: string): string {
  return `${name} thanked you for ${what}.`;
}

/** Why a thanks did not go through, with the helper's name (never a pronoun). */
export function thankRefusal(reason: Refusal, name: string): string {
  switch (reason) {
    case 'thanked': return `You thanked ${name} today already. Thanks go once a day.`;
    case 'too_far': return `You are too far away now to thank ${name}.`;
    default: return `It is too late to thank ${name} for that.`;
  }
}

/** "The ranger's hut" in a sentence: "the ranger's hut". */
const inSentence = (name: string) => name.replace(/^The /, 'the ');
/** A place's name with its article: "pond" is "the pond", "the Tower" stays. */
const withThe = (name: string) => (/^the /i.test(name) ? inSentence(name) : `the ${name}`);

/**
 * What a thanks was for, as a sentence names it: "the fire at the ranger's hut", "the fire at the leavers'
 * camp", "the campfire in the Near Woods", "your arrow by the pond" (the nearest place the map names).
 * `find` gives a map's data by id (every map ships with the client).
 */
export function thanksFor(what: ThanksFor, find: (id: string) => MapData | undefined): string {
  const map = find(what.map);
  switch (what.kind) {
    case 'fire': {
      if (!map) return 'a fire you fed';
      const fire = map.objects.find(o => o.kind === 'fireplace' && o.x === what.x && o.y === what.y);
      if (fire?.kind === 'fireplace' && fire.name) return `the fire at ${fire.name}`;
      return map.kind === 'inside' ? `the fire at ${inSentence(map.name)}` : `the campfire in ${inSentence(map.name)}`;
    }
    case 'mark': {
      if (!map) return 'your arrow';
      const place = [...(map.places ?? [])].sort((a, b) => Math.hypot(a.x - what.x, a.y - what.y) - Math.hypot(b.x - what.x, b.y - what.y))[0];
      return place ? `your arrow by ${withThe(place.name)}` : `your arrow in ${inSentence(map.name)}`;
    }
  }
}

/** Who, in a letter: one name, two, or how many people. */
function whoOf(g: ThanksGroup): string {
  if (g.people >= 3 || !g.names.length) return `${g.people} people`;
  return g.names.slice(0, 2).join(' and ');
}

/** "twice", "3 times": one or two people who thanked on more than one day. */
function timesOf(g: ThanksGroup): string {
  if (g.count <= g.people) return '';
  return g.count === 2 ? ' twice' : ` ${g.count} times`;
}

/**
 * The letter home, in at most three short lines, the most thanked first: "While you were away, 4 people
 * thanked you for the fire at the ranger's hut." Past three things, the last line says how many more.
 */
export function letterLines(groups: readonly ThanksGroup[], find: (id: string) => MapData | undefined): string[] {
  const shown = groups.length > 3 ? groups.slice(0, 2) : groups;
  const lines = shown.map(g => `${whoOf(g)} thanked you${timesOf(g)} for ${thanksFor(g.what, find)}.`);
  if (groups.length > 3) {
    const rest = groups.slice(2).reduce((n, g) => n + g.count, 0);
    lines.push(`And ${rest} more thanks, for other things.`);
  }
  if (lines[0]) lines[0] = `While you were away, ${lines[0]}`;
  return lines;
}

// ---------- when to offer ----------

/** Something to thank for, and whom: offered in the text box, and remembered by `key` when said no to. */
export type Offer =
  | { kind: 'fire'; key: string; x: number; y: number; helper: PersonView }
  | { kind: 'mark'; key: string; id: number; helper: PersonView };

/** What the offers look at, every frame. */
export interface OfferState {
  now: number;
  /** You, on your tile (where you stand, or the one you are stepping onto) and whether you are on the move; null when not in the world. */
  me: { id: string; x: number; y: number; moving: boolean } | null;
  map: string;
  /** This map's fires: how long each burns now (null: tended), and who fed it last, the most recent first. */
  fires: Iterable<{ x: number; y: number; left: number | null; fed: readonly PersonView[] }>;
  marks: ReadonlyMap<number, MarkView>;
  /** Someone never to offer thanks to: thanked today already, or blocked. */
  skip: (id: string) => boolean;
  /** Nothing else is up (a question, what the box says, someone's lines, a panel, a fade): an offer may show. */
  free: boolean;
}

/** The first of these (the most recent first) you may thank: not you, and nobody to skip. */
export function helperOf(people: readonly PersonView[], me: string, skip: (id: string) => boolean): PersonView | undefined {
  return people.find(p => p.id !== me && !skip(p.id));
}

export class Offers {
  /** The fire you warm at, since when, and whether it offered already this time by it. */
  private warming: { key: string; since: number; offered: boolean } | null = null;
  /** The arrow you followed: its id, and the tile it points to (where you stepped). */
  private followed: { id: number; x: number; y: number } | null = null;
  /** Fires and arrows said no to this session: never offered again. */
  private readonly declined = new Set<string>();

  /** A step of yours starts, from tile x,y the way `dir` goes, onto `to`: an arrow on x,y pointing that way was followed. */
  stepped(x: number, y: number, dir: Dir, to: { x: number; y: number }, marks: ReadonlyMap<number, MarkView>): void {
    const mark = [...marks.values()].find(m => m.x === x && m.y === y && m.dir === dir);
    this.followed = mark ? { id: mark.id, x: to.x, y: to.y } : null;
  }

  /** NO to an offer: that fire or arrow is never offered again this session. */
  decline(key: string): void {
    this.declined.add(key);
  }

  /** Another map, or no connection: whatever was about to be offered goes. */
  reset(): void {
    this.warming = null;
    this.followed = null;
  }

  /** What to offer now, if anything (the caller asks it). Call it every frame: it keeps track of where you are. */
  due(s: OfferState): Offer | null {
    const me = s.me;
    if (!me) {
      this.reset();
      return null;
    }
    return this.arrow(s, me) ?? this.fire(s, me);
  }

  /** Stopped where an arrow you followed points: its painter. Walked on, it is dropped. */
  private arrow(s: OfferState, me: NonNullable<OfferState['me']>): Offer | null {
    const f = this.followed;
    if (!f) return null;
    if (me.x !== f.x || me.y !== f.y) {
      this.followed = null;
      return null;
    }
    if (me.moving || !s.free) return null;
    this.followed = null;
    const mark = s.marks.get(f.id), key = `mark:${f.id}`;
    if (!mark || this.declined.has(key)) return null;
    const helper = helperOf([{ id: mark.owner, name: mark.name }], me.id, s.skip);
    return helper ? { kind: 'mark', key, id: mark.id, helper } : null;
  }

  /** A few seconds by a burning fire someone else fed, standing still: one of them. Once for each time by it. */
  private fire(s: OfferState, me: NonNullable<OfferState['me']>): Offer | null {
    let near: { x: number; y: number; helper: PersonView | undefined } | undefined;
    for (const f of s.fires) {
      if (f.left === null || f.left <= 0 || Math.hypot(f.x - me.x, f.y - me.y) > FIRE_RADIUS) continue;
      const helper = helperOf(f.fed, me.id, s.skip);
      if (!near || (helper && !near.helper)) near = { x: f.x, y: f.y, helper };
    }
    if (!near) {
      this.warming = null;
      return null;
    }
    const key = `fire:${s.map}:${near.x},${near.y}`;
    if (this.warming?.key !== key) this.warming = { key, since: s.now, offered: false };
    const w = this.warming;
    if (w.offered || s.now - w.since < THANK_AFTER_MS || me.moving || !s.free || this.declined.has(key) || !near.helper) return null;
    w.offered = true;
    return { kind: 'fire', key, x: near.x, y: near.y, helper: near.helper };
  }
}
