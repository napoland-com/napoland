/**
 * The notice board as a panel over the game (the board itself, and its words: board.ts in shared),
 * opened by reading the board and put away with B, like the paper map. One thing at a time, in three
 * tabs: out there, a card for each region, nearest town first, its sky and its surge and storm clocks as
 * chips and a row for whatever there needs someone (a fire gone out, the lookout's lamp, a place mended
 * together, a slab glowing, today's condition), its sentences under it once it is tapped; the town (the
 * Old Stone, the ledger's works, who came back, the first finders); and the week (its condition, the
 * season, the Long Night, the parcels' calendar). Over the tabs, a strip of the sky: day or night, the
 * season, the Long Night. Plain HTML strings, like the journal's, so tests read them without a page; the
 * HUD opens and closes what they mark (data-card, data-day, data-goto).
 */
import {
  SEASONS, WEEKDAYS, collapseLine, conditionLines, fireLines, firstOnBoard, glowLine, lampLine, longNightLines, parcelWords, parcelsYou, rainLine,
  seasonLine, stormLine, surgeLine, thousands, weekLine, worksDays, worksLine, type BoardFire, type BoardRegion, type BoardView,
  type BoardWords, type ConditionDef, type WorksDef, type WorksView,
} from '@napoland/shared';
import { BOARD_ICONS, iconFor, type BoardIcon } from './icons';

export type BoardTab = 'out' | 'town' | 'week';
export const BOARD_TABS: readonly BoardTab[] = ['out', 'town', 'week'];
export const BOARD_TAB_NAMES: Readonly<Record<BoardTab, string>> = { out: 'Out there', town: 'Town', week: 'This week' };

/** The panel's parts: the sky's strip and each tab, each written to the page only when it changed. */
export interface BoardPanel {
  sky: string;
  out: string;
  town: string;
  week: string;
}

/** How a chip or a row reads at a glance: calm, rain falling, a surge near or on, something to see to soon, or now. */
type Tone = 'good' | 'rain' | 'restless' | 'surge' | 'warn' | 'bad';

const WEATHER_ICONS = { overcast: 'cloud', rain: 'rain', night: 'moon', aurora: 'aurora' } as const satisfies Record<string, BoardIcon>;
const WEATHER_NAMES = { overcast: 'Overcast', rain: 'Rain', night: 'Night', aurora: 'An aurora night' } as const;

/** A region with nothing to say about it now. */
export const QUIET = 'Quiet: nothing to report';

/** A time on a chip, short: "<1 min", "8 min", "5 h", "3 days". */
export function shortTime(seconds: number): string {
  if (seconds < 60) return '<1 min';
  if (seconds < 90 * 60) return `${Math.round(seconds / 60)} min`;
  if (seconds < 36 * 3600) return `${Math.round(seconds / 3600)} h`;
  const d = Math.round(seconds / 86400);
  return `${d} day${d === 1 ? '' : 's'}`;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A place's name on its own: "the footbridge" is "Footbridge". */
const bare = (s: string) => capital(s.replace(/^the /i, ''));

const chip = (icon: BoardIcon, text: string, tone?: Tone) => `<span class="bchip"${tone ? ` data-tone="${tone}"` : ''}>${BOARD_ICONS[icon]}<span>${esc(text)}</span></span>`;
const row = (icon: string, text: string, tone?: Tone, after = '') =>
  `<span class="brow"${tone ? ` data-tone="${tone}"` : ''}>${icon}<span class="bt">${esc(text)}</span>${after}</span>`;
/** How far along something is, 0 to 1, drawn as the status panel draws its bars. */
const bar = (k: number) => `<span class="sbar" aria-hidden="true"><i style="transform:translateX(${((Math.min(1, Math.max(0, k)) - 1) * 100).toFixed(1)}%)"></i></span>`;
const card = (inner: string) => `<div class="bcard">${inner}</div>`;
const head = (icon: BoardIcon, title: string) => `<span class="bhead">${BOARD_ICONS[icon]}<b>${esc(title)}</b></span>`;
const para = (lines: readonly string[]) => lines.map(l => `<p>${esc(l)}</p>`).join('');

/** The whole panel, as the board was read. */
export function boardPanel(b: BoardView, w: BoardWords): BoardPanel {
  return { sky: skyStrip(b), out: outThere(b, w), town: town(b, w), week: week(b, w) };
}

// ---------- the sky ----------

/** Day or night, the season and the Long Night: the season and the Long Night open the week's tab, where their words are. */
function skyStrip(b: BoardView): string {
  const s = b.sky;
  const sky = s.kind === 'fixed' ? chip(WEATHER_ICONS[s.weather], WEATHER_NAMES[s.weather])
    : s.kind === 'day' ? chip('sun', `Night in ${shortTime(s.dusk)}`)
    : chip(s.night === 'night' ? 'moon' : 'aurora', `${s.night === 'long' ? 'The Long Night · d' : s.night === 'aurora' ? 'Aurora · d' : 'D'}awn in ${shortTime(s.dawn)}`);
  const season = `<button type="button" class="bchip" data-goto="week">${BOARD_ICONS.season}<span>${esc(`${SEASONS[b.season.season].name} · ${shortTime(b.season.left)} left`)}</span></button>`;
  const n = b.longNight;
  const night = `<button type="button" class="bchip" data-goto="week"${n.on ? ' data-tone="good"' : ''}>${BOARD_ICONS.aurora}<span>${esc(n.on ? 'The Long Night is on' : `Long Night in ${shortTime(n.in)}`)}</span></button>`;
  return sky + season + night;
}

// ---------- out there ----------

/** A region's rain by day: falling, coming, or none till dark. Nothing at night: the strip says it is night everywhere. */
function weatherChip(b: BoardView, r: BoardRegion): string {
  if (r.rain === undefined) return '';
  const snow = SEASONS[b.season.season].snow, fall = snow ? 'Snow' : 'Rain';
  if (!r.rain) return chip('cloud', 'Dry till dark');
  return r.rain.raining ? chip(snow ? 'snow' : 'rain', `${fall} · ${shortTime(r.rain.left)} more`, 'rain') : chip('cloud', `${fall} in ${shortTime(r.rain.left)}`);
}

/** Its surge clock: when the next comes, restless before it (a light, soon), or one on (a light, now). */
function surgeChip(r: BoardRegion): string {
  const s = r.surge;
  if (!s) return '';
  if (s.phase === 'calm') return chip('surge', `Surge in ${shortTime(s.next)}`);
  return s.phase === 'unstable' ? chip('surge', `Surge in ${shortTime(s.left)}`, 'restless') : chip('surge', `Surge on · ${shortTime(s.left)}`, 'surge');
}

/** Its storm clock: when the next comes, one coming, or one on (a roof, now). */
function stormChip(r: BoardRegion): string {
  const s = r.storm;
  if (!s) return '';
  if (s.phase === 'clear') return chip('storm', `Storm in ${shortTime(s.next)}`);
  return s.phase === 'coming' ? chip('storm', `Storm in ${shortTime(s.left)}`, 'warn') : chip('storm', `Storm on · ${shortTime(s.left)}`, 'bad');
}

/** A place mended together, in a row: whole or broken, and how long what is put by lasts, or how far it is from standing again. */
function worksRow(def: WorksDef, v: WorksView): string {
  const icon = def.build === 'light' ? BOARD_ICONS.light : BOARD_ICONS.footbridge, name = bare(def.name);
  if (!v.standing) return row(icon, `${name}: ${def.build === 'light' ? 'dark' : 'broken'}`, 'warn', `${bar(v.held / def.need)}<span class="n">${v.held} of ${def.need}</span>`);
  const days = worksDays(def, v.held), most = Math.max(1, worksDays(def, def.hold));
  return row(icon, name, days > 0 ? undefined : 'warn', `${bar(days / most)}<span class="n">${days > 0 ? `${days} day${days === 1 ? '' : 's'}` : 'today only'}</span>`);
}

/** Today's conditions in one region, and what the board says about them. */
function conditionsIn(b: BoardView, r: BoardRegion, w: BoardWords): { defs: ConditionDef[]; lines: string[] } {
  const ids = b.conditions.today.filter(id => w.condition(id)?.map === r.id);
  return { defs: ids.flatMap(id => w.condition(id) ?? []), lines: conditionLines({ ...b, conditions: { today: ids, week: null, next: null } }, w) };
}

/**
 * A region's card: its name, its chips, a row for each thing there that needs someone or is worth
 * knowing, and under them, once tapped, what the board says about it in whole sentences.
 */
function regionCard(b: BoardView, r: BoardRegion, w: BoardWords): string {
  const here = (f: BoardFire) => f.map === r.id;
  const out = b.fires.out.filter(here), low = b.fires.low.filter(here);
  const lamps = b.lamps.filter(l => l.map === r.id), works = b.works.flatMap(v => { const def = v.map === r.id ? w.works(v.id) : undefined; return def ? [{ def, v }] : []; });
  const fell = b.collapses.filter(c => c.map === r.id), today = conditionsIn(b, r, w);
  const rows = [
    ...(out.length ? [row(BOARD_ICONS.flame, `Gone out: ${out.map(f => f.name).join(', ')}`, 'bad')] : []),
    ...(low.length ? [row(BOARD_ICONS.flame, `Burning low: ${low.map(f => f.name).join(', ')}`, 'warn')] : []),
    ...r.glowing.map(name => row(BOARD_ICONS.slab, glowLine(name).replace(/\.$/, ''), 'surge')),
    ...lamps.map(l => row(BOARD_ICONS.lookout, l.left > 0 ? `Lookout's lamp: ${shortTime(l.left)} more` : 'Lookout\'s lamp: out', l.left > 0 ? undefined : 'warn')),
    ...works.map(({ def, v }) => worksRow(def, v)),
    ...today.defs.map(c => row(BOARD_ICONS.notice, capital(c.name))),
    ...fell.map(c => row(BOARD_ICONS.down, `${c.n} collapsed in the last hour`, 'bad')),
  ];
  const said = [
    rainLine(b, r), surgeLine(r), ...(r.surge ? r.glowing.map(glowLine) : []), stormLine(r), ...today.lines, ...lamps.map(lampLine),
    ...works.map(({ def, v }) => worksLine(def, v, w.item(def.item))), ...fireLines({ out, low, count: 0 }), ...(fell.length ? [collapseLine(fell)] : []),
  ].filter((l): l is string => !!l);
  const chips = [weatherChip(b, r), surgeChip(r), stormChip(r)].join('');
  // Nothing to say about it now (a road without clocks, at night): a quiet line, and nothing to open.
  if (!chips && !rows.length && !said.length) return card(`<span class="bhead"><b>${esc(r.name)}</b></span>${row(BOARD_ICONS.check, QUIET)}`);
  return `<div class="bcard" role="button" tabindex="0" data-card="${esc(r.id)}" aria-expanded="false">`
    + `<span class="bhead"><b>${esc(r.name)}</b>${BOARD_ICONS.chevron}</span>${chips ? `<span class="bchips">${chips}</span>` : ''}${rows.join('')}`
    + `<div class="bmore" hidden>${para(said)}</div></div>`;
}

/** Out there: a card for each region; under them, what is true of all of them (every fire burning, collapses on maps without a card). */
function outThere(b: BoardView, w: BoardWords): string {
  const ids = new Set(b.regions.map(r => r.id));
  const cards = b.regions.map(r => regionCard(b, r, w));
  const loose = b.collapses.filter(c => !ids.has(c.map)), elsewhere = b.works.flatMap(v => { const def = !v.map || !ids.has(v.map) ? w.works(v.id) : undefined; return def ? [worksRow(def, v)] : []; });
  const foot = [
    ...fireLines({ out: b.fires.out.filter(f => !ids.has(f.map)), low: b.fires.low.filter(f => !ids.has(f.map)), count: 0 }).map(l => row(BOARD_ICONS.flame, l, 'warn')),
    ...(b.fires.count && !b.fires.out.length && !b.fires.low.length ? [row(BOARD_ICONS.flame, 'Every shelter fire is burning.', 'good')] : []),
    ...(loose.length ? [row(BOARD_ICONS.down, collapseLine(loose), 'bad')] : []),
    ...(!b.collapses.length ? [row(BOARD_ICONS.down, collapseLine([]), 'good')] : []),
    ...elsewhere,
  ];
  return [...cards, foot.length ? `<div class="bnote">${foot.join('')}</div>` : ''].join('') || `<p class="hint">${esc('Nothing to say about out there.')}</p>`;
}

// ---------- the town ----------

/** The town: the Old Stone, the ledger's works (what each still wants, or that it is mended), who came back, and the first finders. */
function town(b: BoardView, w: BoardWords): string {
  const parts: string[] = [];
  if (b.stone) {
    const s = b.stone;
    // Asleep, how many shards it has of what it needs to wake; awake, for how long its surges are gentler.
    parts.push(card(head('stone', 'The Old Stone') + (s.awake
      ? row(BOARD_ICONS.surge, `Awake: surges are gentler for ${shortTime(s.left)}`, 'good')
      : row(BOARD_ICONS.stone, 'Asleep', undefined, `${bar(s.charge / Math.max(1, s.need))}<span class="n">${s.charge} of ${s.need} shards</span>`))));
  }
  const t = w.town, v = b.town;
  if (t && v) {
    const done = new Map(v.done.map(d => [d.id, d]));
    if (t.works.length) {
      const works = t.works.map(x => {
        if (done.has(x.id)) return row(BOARD_ICONS.check, `${capital(x.name)}: mended for good`, 'good');
        const given = v.given[x.id] ?? {};
        return `<span class="bwork">${esc(capital(x.name))}</span>` + x.needs.map(n => {
          const def = w.item(n.item), got = Math.min(n.count, given[n.item] ?? 0);
          return row(def ? iconFor(def) : BOARD_ICONS.parcel, def ? capital(def.name) : n.item, undefined, `${bar(got / n.count)}<span class="n">${got} of ${n.count}</span>`);
        }).join('');
      });
      parts.push(card(head('ledger', 'The ledger at the lodge') + works.join('')));
    }
    const back = t.milestones.filter(m => m.back && done.has(m.id));
    if (back.length) parts.push(card(head('person', 'Back in town') + back.map(m => row(BOARD_ICONS.person, `${m.back}, since day ${thousands(done.get(m.id)!.day)}`)).join('')));
  }
  if (b.firsts.length) parts.push(card(head('star', 'First to find') + b.firsts.map(f => `<p class="bsay">${esc(firstOnBoard(f.first, f.title))}</p>`).join('')));
  return parts.join('') || `<p class="hint">${esc('Nothing new in town.')}</p>`;
}

// ---------- the week ----------

/** The week: its condition and the next week's, the season, the Long Night, and the parcels' calendar. */
function week(b: BoardView, w: BoardWords): string {
  const parts: string[] = [];
  const now = b.conditions.week ? w.condition(b.conditions.week) : undefined, next = b.conditions.next ? w.condition(b.conditions.next) : undefined;
  if (now) parts.push(card(head('notice', capital(now.name)) + `<p class="bsay">${esc(weekLine(now, next).replace(/^This week: [^.]*\. /, ''))}</p>`));
  // Under the season's name, what the board says of it, without saying its name twice: "For about 6 days more: ...".
  parts.push(card(head('season', SEASONS[b.season.season].name) + `<p class="bsay">${esc(seasonLine(b.season).replace(/^[^,]*, for/, 'For'))}</p>`));
  parts.push(card(head('aurora', 'The Long Night') + `<div class="bsay">${para(longNightLines(b.longNight, w))}</div>`));
  const p = b.parcels, data = w.parcels;
  if (p && data) {
    const last = WEEKDAYS.length - 1, extra = parcelWords(data.allWeek, w);
    const days = WEEKDAYS.map((day, i) => {
      const first = data.week[i]?.[0], came = p.days !== undefined && (p.days & (1 << i)) !== 0, def = first && w.item(first.item);
      return `<button type="button" class="bday" data-day="${i}" aria-pressed="${i === p.today}"${i === p.today ? ' data-today' : ''} aria-label="${esc(day)}">`
        + `<span>${day.slice(0, 3)}</span>${i === last && extra ? BOARD_ICONS.parcel : def ? iconFor(def) : BOARD_ICONS.parcel}${came ? `<i class="came">${BOARD_ICONS.check}</i>` : ''}</button>`;
    });
    const lines = WEEKDAYS.map((day, i) => `<p class="bdayline" data-dayline="${i}"${i === p.today ? '' : ' hidden'}>${esc(`${day}${i === p.today ? ' (today)' : ''}: ${parcelWords(data.week[i], w)}${i === last && extra ? `, and ${extra} for whoever came back on all seven days` : ''}.`)}</p>`);
    const you = p.days === undefined ? '' : parcelsYou(p, extra);
    parts.push(card(head('parcel', 'Parcels from the town\'s stores') + `<div class="bweek" role="group" aria-label="This week's parcels">${days.join('')}</div>${lines.join('')}`
      + (p.days === undefined
        ? `<div class="gate"><p>${esc('Sign in to get the parcels.')}</p><button type="button" class="act go" data-signin>Sign in</button></div>`
        : you ? `<p class="bsay">${esc(you)}</p>` : '')));
  }
  return parts.join('');
}

function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
