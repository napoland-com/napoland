/**
 * What the status panel and the banners say, from the game's state. Plain words, no drawing, so it
 * can be tested; hud.ts shows it and main.ts asks for it.
 */
import {
  ELEMENTS, FEATS, GUEST_DAYS, LEVEL_MAX, MERIT_XP, RESTED_MAX, SEASONS, meritsLeft, outfitsOpening, rankOf, rankText, toNextMerit, type BagSlot, type BodyView, type EffectView, type Element,
  type EnergyView, type Feat, type FlashKind, type MeritsView, type ProgressView, type Season, type SeasonView, type Stats, type StoneView, type StormView, type SurgeView, type Weather,
} from '@napoland/shared';
import { listWords } from './details';
import { minutes, type News } from './game';
import type { FeatView, StatusView } from './hud';
import { ELEMENT_WORDS, type Items } from './items';
import { parcelBanner } from './parcels';
import { cozyText, meritText, thousands } from './said';
import { outfitWords } from './wardrobe';

export interface StatusInput {
  energy: EnergyView | null;
  body: BodyView;
  surge: SurgeView | null;
  /** The front of a surge is over you. */
  caught: boolean;
  storm: StormView | null;
  /** A flash discharging where you stand. */
  flash: FlashKind | null;
  weather: Weather;
  /** Out in the wilds, where the world wears you down. */
  wilds: boolean;
  stone: StoneView;
  stats: Stats;
  bag: readonly BagSlot[];
  items: Items;
  progress: ProgressView;
  /** What your gear and the effects working on you resist, in words (items.ts, resistText); null for nothing. */
  resists: string | null;
  /** The effects working on you now (effects.ts), counted down: each shows with its time left. */
  effects?: readonly EffectView[];
  /** The season, and its time left counted down (sky.ts). */
  season?: SeasonView;
  /** What you wear that is wearing down (items.ts, wearText); null when all of it is fine. */
  wear: string | null;
  /** The quirks of what you wear, by name. */
  quirks: string[];
  /** You play as a guest (the welcome said). */
  guest?: boolean;
  /** What you spent of your merits (merits.ts): past level 20, the panel says how many are left and how far the next is. */
  merits?: MeritsView;
}

/** What the Status tab tells a guest, above everything else: where their progress lives, how long, and what keeps it. */
export const GUEST_NOTE = `You are playing as a guest. Your progress lives in this browser: clearing its data loses it, and a guest who stays away for ${GUEST_DAYS} days is deleted. Signing in keeps everything.`;

export { thousands };

/**
 * A feat in the status panel, from its count: its rank, what that rank does (before rank 1, what rank 1
 * will do), and how far the next rank is ("3,212 of 5,000 steps in the rain to rank 2"), or the top.
 */
export function featView(f: Feat, count: number): FeatView {
  const rank = rankOf(f, count), next = f.ranks[rank];
  const does = rankText(f, Math.max(1, rank));
  return {
    name: f.name,
    rank,
    does: rank ? `${does}.` : `Rank 1: ${does[0]!.toLowerCase()}${does.slice(1)}.`,
    next: next ? `${thousands(count)} of ${thousands(next.need)} ${f.counts} to rank ${rank + 1}` : 'Top rank',
    ...(next && { progress: Math.min(1, count / next.need) }),
  };
}

/** The cup of rest in the status panel, under Rested: "140 XP of doubled stashing left", or what fills it while it is empty. */
export function restedText(xp: number): string {
  return xp > 0 ? `${thousands(xp)} XP of doubled stashing left` : 'Empty. It fills while you are not playing, and then what you stash counts double.';
}

/** "Rested: your next 140 XP from the chest count double.": at the chest while the cup holds any. */
export function restedLine(xp: number): string {
  return `Rested: your next ${thousands(xp)} XP from the chest count double.`;
}

/** "Level 3 · 150 XP, 120 to go": where you stand, for the status panel and the stash's header. */
export function levelText(p: ProgressView): string {
  return p.to === null ? `Level ${p.level} · ${p.xp} XP, the top` : `Level ${p.level} · ${p.xp} XP, ${p.to - p.xp} to go`;
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** "4:05": minutes and seconds left of something short, an effect. */
const minSec = (seconds: number) => {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** An effect working on you, in the status panel: what it gives and how long it still works ("Cold +40% for 4:05 more"). */
export function effectText(f: EffectView, items: Items): string {
  const gives = Object.entries(items.get(f.item).use?.resist ?? {}).map(([e, v]) => `${ELEMENT_WORDS[e as Element]} +${Math.round((v ?? 0) * 100)}%`);
  return `${gives.join(', ')} for ${minSec(f.left)} more`;
}

/** What each season changes, in a few words (sky.ts, SEASONS; the glowcaps and the resin are find rules). */
const SEASON_DOES: Record<Season, string> = {
  spring: 'Longer rain, and more glowcaps out there.',
  summer: 'Shorter rain, and light until later in the evening.',
  autumn: 'More resin out there, and storms twice as often.',
  winter: 'Colder out there, and snow instead of rain.',
};

/** "2 days", "5 hours", "20 minutes": how long a season still lasts, as the status panel says it. */
function seasonLeft(seconds: number): string {
  if (seconds >= 36 * 3600) return `${Math.round(seconds / 86400)} days`;
  if (seconds >= 90 * 60) return `${Math.round(seconds / 3600)} hours`;
  return minutes(seconds);
}

/** The season in the status panel: which, how long it lasts, and what it changes ("Winter, 2 days left. Colder out there, and snow instead of rain."). */
export function seasonText(s: SeasonView): string {
  return `${SEASONS[s.season].name}, ${seasonLeft(s.left)} left. ${SEASON_DOES[s.season]}`;
}

/**
 * What wears you down out there now, element by element ("Cold: rain, wet · Wind: the storm"); null for
 * nothing. In winter the cold is in it whatever the weather, and the rain falls as snow.
 */
export function drainText(s: { weather: Weather; wet: number; storm: boolean; caught: boolean; flash: FlashKind | null; season?: Season }): string | null {
  const by: Record<Element, string[]> = { heat: [], cold: [], wind: [], electricity: [], radiation: [] };
  const winter = s.season === 'winter';
  if (s.weather !== 'overcast') by.cold.push(s.weather === 'rain' ? (winter ? 'snow' : 'rain') : 'night');
  if (winter) by.cold.push('winter');
  if (s.wet > 0.05) by.cold.push('wet');
  if (s.storm) { by.wind.push('the storm'); by.electricity.push('the storm'); }
  if (s.caught) { by.electricity.push('the surge'); by.radiation.push('the surge'); }
  if (s.flash) by[s.flash === 'fire' ? 'heat' : 'electricity'].push('a flash');
  const parts = ELEMENTS.filter(e => by[e].length).map(e => `${e[0]!.toUpperCase()}${e.slice(1)}: ${by[e].join(', ')}`);
  return parts.length ? parts.join(' · ') : null;
}

export function statusView(s: StatusInput): StatusView {
  const rows: StatusView['rows'] = [];
  const p = s.progress;
  rows.push({ label: 'Level', text: levelText(p), bar: p.to === null ? 1 : (p.xp - p.from) / (p.to - p.from), tone: 'good' });
  // Level 20 is the top: past it, the XP stashing earns goes to merits.
  if (p.level >= LEVEL_MAX) {
    const spent = s.merits?.spent ?? 0;
    rows.push({ label: 'Merits', text: meritText(p.xp, spent, s.guest), bar: (MERIT_XP - toNextMerit(p.xp)) / MERIT_XP, tone: meritsLeft(p.xp, spent) ? 'good' : 'plain' });
  }
  const rested = p.rested ?? 0;
  rows.push({ label: 'Rested', text: restedText(rested), bar: rested / RESTED_MAX, tone: rested > 0 ? 'good' : 'plain' });
  if (s.energy) {
    const e = s.energy, how = e.rate < 0 ? 'draining' : e.rate > 0 && e.value < e.max ? 'coming back' : 'holding';
    rows.push({ label: 'Energy', text: `${Math.round(e.value)} of ${e.max}, ${how}`, bar: e.value / e.max, tone: e.rate < 0 ? 'bad' : e.rate > 0 ? 'good' : 'plain' });
  }
  const wet = s.body.wet, how = s.body.wetRate > 0 ? 'getting wetter' : wet > 0 ? 'drying' : 'dry';
  rows.push({ label: 'Wet', text: wet > 0.005 ? `${Math.round(wet * 100)}%, ${how}` : 'Dry', bar: wet, tone: s.body.wetRate > 0 ? 'bad' : 'plain' });
  rows.push({ label: 'Load', text: s.body.load >= 1 ? 'Heavy: it tires you out' : `${Math.round(s.body.load * 100)}% of what you carry easily`, bar: Math.min(1, s.body.load), tone: s.body.load >= 0.75 ? 'bad' : 'plain' });
  if (s.wear) rows.push({ label: 'Wear', text: `${s.wear}. Mend it at the workbench at home.`, tone: s.wear.includes('worn out') ? 'bad' : 'plain' });
  if (s.quirks.length) rows.push({ label: 'Quirks', text: s.quirks.join(', '), tone: 'good' });
  rows.push({ label: 'Resists', text: s.resists ?? 'Nothing yet. Make gear at the workbench at home.', tone: s.resists ? 'good' : 'plain' });
  // Each effect working on you (a hand warmer), with its time left: it counts in Resists above.
  for (const f of s.effects ?? []) if (f.left > 0) rows.push({ label: s.items.get(f.item).name, text: effectText(f, s.items), tone: 'good' });
  if (s.wilds) rows.push({ label: 'Draining', text: drainText({ ...s, wet: s.body.wet, storm: s.storm?.phase === 'storm', season: s.season?.season }) ?? 'Just being out here', tone: 'bad' });
  if (s.body.hitched) rows.push({ label: 'On you', text: 'Something clings to your back. Find a light, a fire or a roof.', tone: 'bad' });
  // The warmth of your own fire (comfort.ts): out in the wilds you tire slower while it lasts.
  const cozy = cozyText(s.body.cozy ?? 0, s.body.fireside);
  if (cozy) rows.push({ label: 'Cozy', text: cozy, tone: 'good' });
  const charms = [...new Set(s.bag.map(b => s.items.get(b.item)).filter(d => d.kind === 'charm').map(d => d.name))];
  if (charms.length) rows.push({ label: 'Charms', text: charms.join(', '), tone: 'good' });
  if (s.surge && s.surge.phase !== 'calm') {
    rows.push({ label: 'Surge', text: s.surge.phase === 'unstable' ? `Coming in ${minutes(s.surge.left)}` : s.caught ? 'It has you. Get to a light!' : `On for ${minutes(s.surge.left)} more`, tone: 'bad' });
  }
  if (s.storm && s.storm.phase !== 'clear') {
    rows.push({ label: 'Storm', text: s.storm.phase === 'coming' ? `Coming in ${minutes(s.storm.left)}` : `Blowing for ${minutes(s.storm.left)} more. A roof keeps it off.`, tone: 'bad' });
  }
  if (s.flash) rows.push({ label: 'Flash', text: 'The ground under you is discharging. Step off it!', tone: 'bad' });
  const st = s.stone;
  if (st.need) rows.push({ label: 'Old Stone', text: st.awake ? `Awake for ${minutes(st.left)}. Surges are gentler.` : `Asleep. ${st.charge} of ${st.need} shards.`, tone: st.awake ? 'good' : 'plain' });
  if (s.season) rows.push({ label: 'Season', text: seasonText(s.season), tone: 'plain' });
  return { rows, feats: FEATS.map(f => featView(f, s.stats[f.stat] ?? 0)), ...(s.guest && { guest: GUEST_NOTE }) };
}

/**
 * The Long Night's banners: as it begins (with its bonus, `does`, or only long and dark), and at dawn,
 * whether the lodge's fire held (`bonus`: the next one keeps it) or went out.
 */
export function longNightBanner(on: boolean, bonus: boolean, does: string): { title: string; sub: string } {
  if (on) {
    return bonus
      ? { title: 'The Long Night begins', sub: `An aurora from dawn to dawn${does ? `, and ${does}` : ''}.\nThe lodge's fire needs feeding until dawn: bring resin or cloth.` }
      : { title: 'The Long Night begins', sub: 'Only long and dark this time: the lodge\'s fire went out last week.\nKeep it fed until dawn, and the next one has its bonus again.' };
  }
  return bonus
    ? { title: 'Dawn. The lodge\'s fire held.', sub: `Next week's Long Night keeps its bonus${does ? `: ${does}` : ''}.` }
    : { title: 'Dawn. The lodge\'s fire went out.', sub: 'Next week\'s Long Night will only be long and dark.' };
}

/**
 * The banner for news from the world: a surge's or storm's new phase, the Old Stone waking or sleeping, a
 * feat, a level, a chapter of the story, a page of the field notes or a blank filled in on one, a keepsake
 * home, a parcel (which names what came: `items`, and with the welcome parcel, the outfits signing in
 * gave). Null: nothing to say, as for a note just read (the text box said it all). A level says the
 * outfits it opens, which a guest (`guest`) would wear once signed in.
 */
export function newsBanner(n: News, place: string, items?: Items, guest = false): { title: string; sub: string } | null {
  // A call is for the ears alone (soundscape.ts): a banner would say who called, and from where. A
  // lodestone's tug is a pulse on the status panel and a faint sound: a banner would make it loud. Steps
  // that are not yours (unease.ts) are only ever heard: said out loud, they would be nothing. A scene
  // told needs none either: the box just told it.
  if (n.kind === 'call' || n.kind === 'tug' || n.kind === 'note' || n.kind === 'stalk' || n.kind === 'scene') return null;
  // The town came to something, for everyone online (town.ts): its own words, and the sign's number when someone came back.
  if (n.kind === 'town') {
    const m = items?.town?.milestones.find(x => x.id === n.id) ?? items?.town?.works.find(x => x.id === n.id);
    if (!m) return null;
    const back = 'back' in m && m.back ? `\nThe sign in town says ${n.pop} now.` : '';
    return { title: m.title, sub: `${m.text}${back}` };
  }
  // One line, for everyone online.
  if (n.kind === 'first') return { title: n.text, sub: '' };
  if (n.kind === 'keepsake') {
    const def = items?.get(n.item), energy = items?.keepsakes?.energy ?? 0;
    if (n.home >= n.of) return { title: 'All the keepsakes are home', sub: `${def ? `${def.name}, the last of them.\n` : ''}Your energy bar is ${energy} bigger, for good.` };
    return { title: `Home: ${def?.name ?? 'a keepsake'}`, sub: `${def ? `${def.text}\n` : ''}${n.home} of ${n.of} keepsakes home.` };
  }
  if (n.kind === 'parcel') return items ? parcelBanner(n.parcel, items, n.outfits) : null;
  if (n.kind === 'conditions') return n.names.length ? { title: 'A new day', sub: n.names.join('\n') } : null;
  if (n.kind === 'aurora') return { title: 'Lights in the sky', sub: 'An aurora: the old wires hum,\nand copper turns up by the poles.' };
  if (n.kind === 'longNight') return longNightBanner(n.on, n.bonus, items?.longNight ?? '');
  if (n.kind === 'season') {
    // Winter names the water it freezes; the spring after it says the ice is gone.
    const ice = !n.frozen.length ? '' : n.season === 'winter' ? `\n${capital(listWords(n.frozen))} ${n.frozen.length > 1 ? 'are' : 'is'} frozen: you can walk across.` : n.season === 'spring' ? '\nThe ice is gone.' : '';
    return { title: SEASONS[n.season].name, sub: `${SEASON_DOES[n.season]}${ice}` };
  }
  if (n.kind === 'cozy') return { title: 'Cozy', sub: `Out in the wilds you tire 10% slower\nfor ${n.minutes} minutes once you leave the fire.` };
  if (n.kind === 'level') {
    const opened = listWords(outfitsOpening(n.from, n.progress.level).map(o => `the ${outfitWords(o.name)}`));
    const outfits = opened ? (guest ? `\nSign in to wear ${opened}.` : `\nNew in your wardrobe: ${opened}.`) : '';
    // The top: what comes next is merits.
    const top = n.progress.level >= LEVEL_MAX ? `\nFrom here on, every ${thousands(MERIT_XP)} XP earns a merit.` : '';
    return { title: `Level ${n.progress.level}`, sub: `Your energy bar grows to ${n.progress.maxEnergy}.\nYou can go a little farther now.${outfits}${top}` };
  }
  if (n.kind === 'chapter') return { title: `Journal: ${n.chapter.title}`, sub: 'A new chapter of the story.\nRead it in your journal, in the menu.' };
  // Quiet and short: the field notes grow often, and the journal says the rest.
  if (n.kind === 'page') return { title: `A new page: ${n.page.title}`, sub: '' };
  if (n.kind === 'blank') return { title: `Filled in: ${n.page.title}`, sub: n.blank.fill };
  if (n.kind === 'rested') return { title: 'Rested', sub: `Your next ${thousands(n.xp)} XP from the chest count double.` };
  if (n.kind === 'merit') {
    const spend = guest ? 'Sign in to spend merits in the wardrobe at your chest.' : `You have ${n.left} to spend in the wardrobe at your chest.`;
    return { title: n.earned === 1 ? 'A merit' : `${n.earned} merits`, sub: `Past level ${LEVEL_MAX}, every ${thousands(MERIT_XP)} XP earns one.\n${spend}` };
  }
  if (n.kind === 'live') return { title: 'It is still live', sub: `Stash it within ${minutes(n.fresh)} for the most XP.` };
  if (n.kind === 'feat') {
    const f = FEATS.find(x => x.id === n.id);
    return f && f.ranks[n.rank - 1] ? { title: `${f.name}, rank ${n.rank}`, sub: `${rankText(f, n.rank)}.` } : null;
  }
  if (n.kind === 'stone') {
    return n.view.awake
      ? { title: 'The Old Stone woke up', sub: 'Surges are gentler while it is awake.' }
      : { title: 'The Old Stone fell asleep', sub: `Bring it shards to wake it again (${n.view.need}).` };
  }
  if (n.kind === 'storm') {
    switch (n.view.phase) {
      case 'coming': return { title: 'A storm is coming', sub: `It reaches ${place} in ${minutes(n.view.left)}.\nGet under a roof, or wear something against wind and lightning.` };
      case 'storm': return { title: 'Storm!', sub: 'Wind and lightning wear you down, and it soaks you.\nA roof keeps it all off.' };
      case 'clear': return { title: 'The storm has passed', sub: `${place} is clear again.` };
    }
  }
  switch (n.view.phase) {
    case 'unstable': return { title: `${place} grows restless`, sub: `A surge is coming in ${minutes(n.view.left)}.\nRare things show up deep in until it passes.` };
    case 'surge': return { title: 'Surge!', sub: 'It sweeps from the deep end toward home.\nStand in a street light, or get indoors.' };
    case 'calm': return { title: 'The surge has passed', sub: `${place} is calm again.` };
  }
}
