/**
 * The notice board in Stonebrook, as data: how the world stands when someone reads it. The server works
 * it out (world.ts, boardView) and sends it whole; the client draws it as a panel of cards, one region
 * of the wilds to a card, the town and the week apart (client board.ts), and says each part in the words
 * here: the same sentences the board used to page through, one at a time. boardLines says them all, in
 * the order the board always read them.
 */
import { firstOnBoard, thousands, type FirstView } from './firsts';
import { amount, itemIndex, longNightWords, pluralOf, type ItemDef, type ItemsData } from './items';
import { WEEKDAYS, WHOLE_WEEK, type ParcelsData } from './parcels';
import type { StoneView, Weather } from './protocol';
import { SEASONS, type ConditionDef, type ConditionsView, type Season } from './sky';
import { workLeft, type TownData } from './town';
import { worksDays, type WorksDef, type WorksView } from './works';

/** The day or the night over the whole world. */
export type BoardSky =
  /** A server whose weather never changes (WEATHER): said as it is. */
  | { kind: 'fixed'; weather: Weather }
  /** Night everywhere (an aurora night, or the Long Night), for `dawn` more seconds: no rain anywhere. */
  | { kind: 'night'; night: 'night' | 'aurora' | 'long'; dawn: number }
  /** Day, for `dusk` more seconds; each region out there has its own rain. */
  | { kind: 'day'; dusk: number };

/** A region out there (a map of the wilds, or any with a surge or storm clock): nearest town first. */
export interface BoardRegion {
  id: string;
  /** "The Near Woods". */
  name: string;
  /**
   * By day, its rain (snow in winter): falling for `left` more seconds, or dry for `left` and then
   * falling; null, dry until nightfall. None at night, or with the weather fixed.
   */
  rain?: { raining: boolean; left: number } | null;
  /** Its surge clock: calm, the next one `next` seconds off; restless, one coming in `left`; or one on, `left` more. */
  surge?: { phase: 'calm'; next: number } | { phase: 'unstable' | 'surge'; left: number };
  /** Its storm clock: clear, the next one `next` seconds off; one coming in `left`; or one on, `left` more. */
  storm?: { phase: 'clear'; next: number } | { phase: 'coming' | 'storm'; left: number };
  /** The slabs glowing here now, by name (slab.ts): two people there can open one. */
  glowing: string[];
}

/** A fire that burns down out there, by name ("the old cabin", "the campfire in the Near Woods"), and the region it is in. */
export interface BoardFire {
  name: string;
  map: string;
}

/** The Long Night: when the next comes, or tonight's. */
export type BoardLongNight =
  /** In `in` seconds; `bonus`: it keeps its bonus (the lodge's fire lasted the last one). */
  | { on: false; in: number; bonus: boolean }
  /**
   * Tonight: `bonus`, it has its bonus; the lodge's fire, where there is one to feed: gone out, or
   * burning `left` more seconds.
   */
  | { on: true; bonus: boolean; fire?: { out: true } | { out: false; left: number } };

export interface BoardView {
  sky: BoardSky;
  /** The season: which, `left` seconds more of it, the next, and the water frozen hard enough to cross ("the pond in the Near Woods"). */
  season: { season: Season; left: number; next: Season; frozen: string[] };
  longNight: BoardLongNight;
  regions: BoardRegion[];
  /** Today's conditions, this week's and next week's (their ids: items.json, conditions). */
  conditions: ConditionsView;
  /** Each fire lookout's lamp, on the map it stands on: how long it burns on (0: out). */
  lamps: Array<{ map: string; name: string; left: number }>;
  /** Each place mended together (works.ts), and the region it stands in. */
  works: Array<WorksView & { map?: string }>;
  /** The fires that burn down out there: gone out, burning low, and how many there are at all. */
  fires: { out: BoardFire[]; low: BoardFire[]; count: number };
  /** Who collapsed in the last hour, by the map they collapsed on (how many, never who). */
  collapses: Array<{ map: string; name: string; n: number }>;
  stone?: StoneView;
  /** The town (town.ts): what it came to, and on which of the Zone's days; what was given to each work of the ledger. */
  town?: { done: Array<{ id: string; day: number }>; given: Record<string, Record<string, number>> };
  /** The latest first finders (firsts.ts), the latest first, each with what they found. */
  firsts: Array<{ first: FirstView; title: string }>;
  /**
   * This week's parcels (parcels.ts): which day is today (Monday 0); to whoever is signed in, the days
   * they came back (a bit a day) and whether they came back every day so far. None without sign-in on
   * this server, or without parcels.
   */
  parcels?: { today: number; days?: number; soFar?: boolean };
}

/** What the board's words need besides the board itself: what things are called and what each place takes (items.json), as both ends have it. */
export interface BoardWords {
  item(id: string): ItemDef | undefined;
  works(id: string): WorksDef | undefined;
  condition(id: string): ConditionDef | undefined;
  town: TownData | undefined;
  parcels: ParcelsData | undefined;
  /** What the Long Night's bonus does: "wire and strange objects grow back twice as fast"; '' without one. */
  night: string;
}

/** The board's words from the items (items.json); none: a copy without items, which says what it can. */
export function boardWords(data: ItemsData | undefined): BoardWords {
  const items = data ? itemIndex(data) : new Map<string, ItemDef>(), works = new Map((data?.works ?? []).map(w => [w.id, w]));
  const conditions = new Map([...(data?.conditions?.daily ?? []), ...(data?.conditions?.weekly ?? [])].map(c => [c.id, c]));
  return {
    item: id => items.get(id), works: id => works.get(id), condition: id => conditions.get(id), town: data?.town, parcels: data?.parcels,
    night: longNightWords(data?.longNight, items),
  };
}

// ---------- the words ----------

const WEATHER_WORDS: Record<Weather, string> = { overcast: 'Overcast', rain: 'Rain', night: 'Night', aurora: 'An aurora night' };
/** What each season changes (sky.ts, SEASONS; the glowcaps and the resin are find rules). */
const SEASON_WORDS: Record<Season, string> = {
  spring: 'longer rain, and more glowcaps out there',
  summer: 'shorter rain, and light until later in the evening',
  autumn: 'more resin out there, and storms twice as often',
  winter: 'colder out there, and snow instead of rain',
};
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A name in the middle of a sentence: "The Near Woods" is "the Near Woods". */
const inSentence = (name: string) => name.replace(/^The /, 'the ');

/** "in about 6 minutes", or "in under a minute"; `plain` drops the "in" ("for about 6 hours", "about 3 days"). */
function about(seconds: number, plain = false): string {
  const pre = plain ? '' : 'in ';
  if (seconds < 60) return plain ? 'under a minute' : 'in under a minute';
  if (seconds < 90 * 60) {
    const m = Math.round(seconds / 60);
    return `${pre}about ${m} minute${m === 1 ? '' : 's'}`;
  }
  if (seconds < 36 * 3600) {
    const h = Math.round(seconds / 3600);
    return `${pre}about ${h} hour${h === 1 ? '' : 's'}`;
  }
  const d = Math.round(seconds / 86400);
  return `${pre}about ${d} day${d === 1 ? '' : 's'}`;
}

/** "a, b and c". */
function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** What falls this season: snow in winter, rain otherwise. */
const fall = (b: BoardView) => (SEASONS[b.season.season].snow ? 'snow' : 'rain');

/** The day or the night: "Night falls in about 32 minutes.", "Night: no rain anywhere. Dawn in about 8 minutes.", "Overcast.". */
export function skyLine(b: BoardView): string {
  const s = b.sky;
  if (s.kind === 'fixed') return `${WEATHER_WORDS[s.weather]}.`;
  if (s.kind === 'night') return `${s.night === 'long' ? 'The Long Night' : s.night === 'aurora' ? 'An aurora night' : 'Night'}: no ${fall(b)} anywhere. Dawn ${about(s.dawn)}.`;
  return `Night falls ${about(s.dusk)}.`;
}

/** A region's rain by day: "The Near Woods: rain for about 6 minutes more.", "...: dry for about 12 minutes, then rain.", "...: dry until nightfall." */
export function rainLine(b: BoardView, r: BoardRegion): string | undefined {
  if (r.rain === undefined) return undefined;
  if (!r.rain) return `${r.name}: dry until nightfall.`;
  return r.rain.raining ? `${r.name}: ${fall(b)} for ${about(r.rain.left, true)} more.` : `${r.name}: dry for ${about(r.rain.left, true)}, then ${fall(b)}.`;
}

/** A region's surge clock: "The Near Woods: calm. The next surge comes in about 33 minutes." */
export function surgeLine(r: BoardRegion): string | undefined {
  const s = r.surge;
  if (!s) return undefined;
  if (s.phase === 'calm') return `${r.name}: calm. The next surge comes ${about(s.next)}.`;
  return s.phase === 'surge' ? `${r.name}: a surge is on, ${about(s.left)} more. Get to a light.` : `${r.name}: restless. A surge comes ${about(s.left)}.`;
}

/** A slab glowing while its region is restless: "The slab in the ring of stones is glowing." */
export function glowLine(name: string): string {
  return `${capital(name)} is glowing.`;
}

/** A region's storm clock: "The Near Woods: clear. The next storm comes in about 13 minutes." */
export function stormLine(r: BoardRegion): string | undefined {
  const s = r.storm;
  if (!s) return undefined;
  if (s.phase === 'clear') return `${r.name}: clear. The next storm comes ${about(s.next)}.`;
  return s.phase === 'storm' ? `${r.name}: a storm is on, ${about(s.left, true)} more. Get under a roof.` : `${r.name}: a storm is coming ${about(s.left)}.`;
}

/**
 * The Long Night: when the next one comes, and whether it keeps its bonus; while it is on, what it does,
 * and how the lodge's fire stands ("The lodge's fire needs feeding tonight: 18 minutes left.").
 */
export function longNightLines(n: BoardLongNight, w: Pick<BoardWords, 'night'>): string[] {
  const bonus = w.night;
  if (!n.on) {
    if (!n.bonus) return [`The Long Night comes ${about(n.in)}. The lodge's fire went out on the last one, so this one will only be long and dark.`];
    return [`The Long Night comes ${about(n.in)}: an aurora from dawn to dawn${bonus ? `, and ${bonus}` : ''}.`];
  }
  const lines = [
    n.bonus || !bonus
      ? `Tonight ${bonus ? `${bonus}, and ` : ''}the watchers are restless.`
      : 'Tonight is only long and dark, since the lodge\'s fire went out last week. The watchers are restless.',
  ];
  if (!n.fire) return lines;
  if (n.fire.out) return [...lines, 'The lodge\'s fire went out tonight: next week\'s Long Night will only be long and dark.'];
  const m = Math.max(1, Math.ceil(n.fire.left / 60));
  const next = !bonus ? '' : n.bonus ? ' If it lasts until dawn, next week\'s Long Night keeps its bonus.' : ' If it lasts until dawn, next week\'s Long Night has its bonus again.';
  return [...lines, `The lodge's fire needs feeding tonight: ${m} minute${m === 1 ? '' : 's'} left.${next}`];
}

/** The season: which it is, how long is left of it, what it changes, and which comes next. */
export function seasonLine(s: BoardView['season']): string {
  const does = s.season === 'winter' && s.frozen.length ? `${SEASON_WORDS.winter}, and ${listOf(s.frozen)} frozen hard enough to cross` : SEASON_WORDS[s.season];
  return `${SEASONS[s.season].name}, for ${about(s.left, true)} more: ${does}. ${SEASONS[s.next].name} comes next.`;
}

/** What a season changes, on its own: "shorter rain, and light until later in the evening". */
export function seasonDoes(season: Season): string {
  return SEASON_WORDS[season];
}

/** Today's conditions in each region they happen in ("Today in the Near Woods: thick fog."), what each means, then the weeks. */
export function conditionLines(b: BoardView, w: Pick<BoardWords, 'condition'>): string[] {
  const today = b.conditions.today.flatMap(id => w.condition(id) ?? []);
  const lines: string[] = [];
  for (const map of new Set(today.map(c => c.map))) {
    const here = today.filter(c => c.map === map), name = b.regions.find(r => r.id === map)?.name ?? map;
    lines.push(`Today in ${inSentence(name)}: ${listOf(here.map(c => lower(c.name)))}.`, ...here.map(c => c.text));
  }
  const week = b.conditions.week ? w.condition(b.conditions.week) : undefined, next = b.conditions.next ? w.condition(b.conditions.next) : undefined;
  if (week) lines.push(weekLine(week, next));
  return lines;
}

/** This week's condition, and next week's: "This week: quiet woods. The watchers sleep all week. Next week: copper week." */
export function weekLine(week: ConditionDef, next: ConditionDef | undefined): string {
  return `This week: ${lower(week.name)}. ${week.text}${next && next !== week ? ` Next week: ${lower(next.name)}.` : ''}`;
}

/** A fire lookout's lamp: how long it burns on, or that it is out and what it burns. */
export function lampLine(l: BoardView['lamps'][number]): string {
  const where = inSentence(l.name);
  return l.left > 0
    ? `The fire lookout in ${where}: its lamp burns for ${about(l.left, true)} more, and its beam sweeps the woods.`
    : `The fire lookout in ${where}: its lamp is out. It burns resin: feed it at the foot of the ladder.`;
}

/**
 * A place mended together (works.ts): "The footbridge by the pond, in the Near Woods: broken. 12 of 30
 * scrap given, 18 more and it stands again. Ana gave the most."
 */
export function worksLine(def: WorksDef, v: Pick<WorksView, 'standing' | 'held' | 'top'>, item: ItemDef | undefined): string {
  const what = `${capital(def.name)} ${def.where}`, noun = item ? pluralOf(item) : def.item, light = def.build === 'light';
  const top = v.top ? ` ${v.top} gave the most.` : ' Nobody has given anything yet.';
  if (!v.standing) {
    const down = light ? 'dark' : 'broken', again = light ? 'lights up again' : 'stands again';
    return v.held > 0
      ? `${what}: ${down}. ${v.held} of ${def.need} ${noun} given, ${def.need - v.held} more and it ${again}.${top}`
      : `${what}: ${down}. It ${again} with ${def.need} ${noun}.${top}`;
  }
  const days = worksDays(def, v.held), up = light ? 'lit' : 'standing';
  return days > 0
    ? `${what}: ${up}. ${v.held} ${noun} put by, enough for ${days} more day${days === 1 ? '' : 's'} (it takes ${def.wear} a day).${top}`
    : `${what}: ${up}, but not past today. It takes ${def.wear} ${noun} a day, and ${v.held ? `only ${v.held} ${v.held === 1 ? 'is' : 'are'}` : 'none is'} put by.${top}`;
}

/** The fires that burn down out there: which went out, which burn low, or that all of them burn. */
export function fireLines(f: BoardView['fires']): string[] {
  const lines: string[] = [];
  if (f.out.length) lines.push(`Gone out: ${listOf(f.out.map(x => x.name))}. Bring something that burns.`);
  if (f.low.length) lines.push(`Burning low: ${listOf(f.low.map(x => x.name))}.`);
  if (!f.out.length && !f.low.length && f.count > 0) lines.push('Every shelter fire is burning.');
  return lines;
}

/** Who collapsed in the last hour: "Collapsed in the last hour: 2 in The Near Woods.", or nobody. */
export function collapseLine(c: BoardView['collapses']): string {
  return c.length ? `Collapsed in the last hour: ${c.map(x => `${x.n} in ${x.name}`).join(', ')}.` : 'Nobody collapsed in the last hour.';
}

/** The Old Stone: awake and for how long, or how many shards it has of what it needs. */
export function stoneLine(s: StoneView): string {
  return s.awake ? `The Old Stone is awake: surges are gentler for ${about(s.left, true)}.` : `The Old Stone sleeps. ${s.charge} of ${s.need} shards fed.`;
}

/**
 * The town (town.ts): who came back, and since which of the Zone's days; what the works of the ledger
 * at the lodge still want, or that they are done. Never how near a milestone is: the town finds that out
 * when it happens.
 */
export function townLines(b: BoardView, w: Pick<BoardWords, 'item' | 'town'>): string[] {
  const t = w.town, v = b.town;
  if (!t || !v) return [];
  const done = new Map(v.done.map(d => [d.id, d]));
  const back = t.milestones.filter(m => m.back && done.has(m.id)).map(m => `${m.back}, since day ${thousands(done.get(m.id)!.day)}`);
  const want = t.works.filter(x => !done.has(x.id)).map(x => {
    const left = workLeft(x, v.given[x.id]).flatMap(n => { const d = w.item(n.item); return d ? [amount(d, n.count)] : []; });
    return `${listOf(left)} for ${lower(x.name)}`;
  });
  const fixed = t.works.filter(x => done.has(x.id)).map(x => lower(x.name));
  return [
    ...(back.length ? [`Back in town: ${listOf(back)}.`] : []),
    ...(want.length ? [`The town's ledger at the lodge wants ${want.join('; ')}.`] : []),
    ...(fixed.length ? [`Mended for good: ${listOf(fixed)}.`] : []),
  ];
}

/** What a day's parcel holds, in words: "3 resin, 2 cloth". */
export function parcelWords(slots: readonly { item: string; count: number }[] | undefined, w: Pick<BoardWords, 'item'>): string {
  return (slots ?? []).flatMap(s => { const d = w.item(s.item); return d ? [amount(d, s.count)] : []; }).join(', ');
}

/**
 * The parcels: this week's calendar with today marked, then to whoever reads it the days they came back
 * this week (to a guest, that signing in brings them).
 */
export function parcelLines(b: BoardView, w: Pick<BoardWords, 'item' | 'parcels'>): string[] {
  const data = w.parcels, p = b.parcels;
  if (!data || !p) return [];
  const today = p.today, last = WEEKDAYS.length - 1;
  const short = (i: number) => WEEKDAYS[i]!.slice(0, 3);
  const extra = parcelWords(data.allWeek, w);
  const entry = (i: number) =>
    `${short(i)}${i === today ? ' (today)' : ''}: ${parcelWords(data.week[i], w)}${i === last && extra ? `, and ${extra} for whoever came back on all seven days` : ''}`;
  const lines = [`Parcels this week, from the town's stores. ${[0, 1, 2, 3].map(entry).join('. ')}.`, `${[4, 5, 6].map(entry).join('. ')}.`];
  if (p.days === undefined) return [...lines, 'Sign in to get the parcels.'];
  const said = parcelsYou(p, extra);
  return said ? [...lines, said] : lines;
}

/**
 * The days you came back this week, and what coming back every day brings: "You came back Mon, Tue.
 * Play every day this week and Sunday's parcel holds a NAPO lockbox." '' when there is nothing to say.
 */
export function parcelsYou(p: NonNullable<BoardView['parcels']>, extra: string): string {
  const days = p.days ?? 0, today = p.today, sunday = WEEKDAYS[WEEKDAYS.length - 1];
  if (days === WHOLE_WEEK) return `You came back every day this week${extra ? `, and ${sunday}'s parcel held ${extra}` : ''}.`;
  const came = WEEKDAYS.flatMap((_, i) => (days & (1 << i) ? [WEEKDAYS[i]!.slice(0, 3)] : []));
  // Today alone, on the first day they play this week or on their very first (the welcome parcel's): not "You came back Wed.".
  const you = days === 1 << today ? 'You came home today.' : came.length ? `You came back ${came.join(', ')}.` : '';
  const next = !extra ? '' : p.soFar
    ? `Play every day this week and ${sunday}'s parcel holds ${extra}.`
    : `A new week starts fresh on Monday: play every day and ${sunday}'s parcel holds ${extra}.`;
  return [you, next].filter(Boolean).join(' ');
}

/** The whole board, said line by line in the order it always read: the sky, the Long Night and the season, the conditions, each region's surges then storms, the lamps, the places mended together, the fires, the collapses, the Old Stone, the town, the first finders and the parcels. */
export function boardLines(b: BoardView, w: BoardWords): string[] {
  const lines = [skyLine(b), ...b.regions.flatMap(r => rainLine(b, r) ?? [])];
  if (b.longNight.on) lines.push(...longNightLines(b.longNight, w));
  lines.push(seasonLine(b.season));
  if (!b.longNight.on) lines.push(...longNightLines(b.longNight, w));
  lines.push(...conditionLines(b, w));
  for (const r of b.regions) {
    const s = surgeLine(r);
    if (s) lines.push(s, ...r.glowing.map(glowLine));
  }
  lines.push(...b.regions.flatMap(r => stormLine(r) ?? []));
  lines.push(...b.lamps.map(lampLine));
  for (const v of b.works) {
    const def = w.works(v.id);
    if (def) lines.push(worksLine(def, v, w.item(def.item)));
  }
  lines.push(...fireLines(b.fires), collapseLine(b.collapses));
  if (b.stone) lines.push(stoneLine(b.stone));
  lines.push(...townLines(b, w), ...b.firsts.map(f => firstOnBoard(f.first, f.title)), ...parcelLines(b, w));
  return lines;
}
