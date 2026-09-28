/**
 * What the status panel and the banners say, from the game's state. Plain words, no drawing, so it
 * can be tested; hud.ts shows it and main.ts asks for it.
 */
import {
  ELEMENTS, FEATS, GUEST_DAYS, rankOf, rankText, type BagSlot, type BodyView, type Element, type EnergyView, type Feat, type FlashKind, type ProgressView, type Stats, type StoneView,
  type StormView, type SurgeView, type Weather,
} from '@napoland/shared';
import { minutes, type News } from './game';
import type { FeatView, StatusView } from './hud';
import type { Items } from './items';

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
  /** What your gear resists, in words (items.ts, resistText); null for nothing. */
  resists: string | null;
  /** What you wear that is wearing down (items.ts, wearText); null when all of it is fine. */
  wear: string | null;
  /** The quirks of what you wear, by name. */
  quirks: string[];
  /** You play as a guest (the welcome said). */
  guest?: boolean;
}

/** What the Status tab tells a guest, above everything else: where their progress lives, how long, and what keeps it. */
export const GUEST_NOTE = `You are playing as a guest. Your progress lives in this browser: clearing its data loses it, and a guest who stays away for ${GUEST_DAYS} days is deleted. Signing in keeps everything.`;

/** "12,345": a count with its thousands apart, the same in every language the browser speaks. */
export function thousands(n: number): string {
  return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

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

/** "Level 3 · 150 XP, 120 to go": where you stand, for the status panel and the stash's header. */
export function levelText(p: ProgressView): string {
  return p.to === null ? `Level ${p.level} · ${p.xp} XP, the top` : `Level ${p.level} · ${p.xp} XP, ${p.to - p.xp} to go`;
}

/** What wears you down out there now, element by element ("Cold: rain, wet · Wind: the storm"); null for nothing. */
export function drainText(s: { weather: Weather; wet: number; storm: boolean; caught: boolean; flash: FlashKind | null }): string | null {
  const by: Record<Element, string[]> = { heat: [], cold: [], wind: [], electricity: [], radiation: [] };
  if (s.weather !== 'overcast') by.cold.push(s.weather === 'rain' ? 'rain' : 'night');
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
  if (s.wilds) rows.push({ label: 'Draining', text: drainText({ ...s, wet: s.body.wet, storm: s.storm?.phase === 'storm' }) ?? 'Just being out here', tone: 'bad' });
  if (s.body.hitched) rows.push({ label: 'On you', text: 'Something clings to your back. Find a light, a fire or a roof.', tone: 'bad' });
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
  return { rows, feats: FEATS.map(f => featView(f, s.stats[f.stat] ?? 0)), ...(s.guest && { guest: GUEST_NOTE }) };
}

/** The banner for news from the world: a surge's or storm's new phase, the Old Stone waking or sleeping, a feat, a level, a chapter of the story. Null: nothing to say. */
export function newsBanner(n: News, place: string): { title: string; sub: string } | null {
  // A call is for the ears alone (soundscape.ts): a banner would say who called, and from where.
  if (n.kind === 'call') return null;
  if (n.kind === 'conditions') return n.names.length ? { title: 'A new day', sub: n.names.join('\n') } : null;
  if (n.kind === 'level') return { title: `Level ${n.progress.level}`, sub: `Your energy bar grows to ${n.progress.maxEnergy}.\nYou can go a little farther now.` };
  if (n.kind === 'chapter') return { title: `Journal: ${n.chapter.title}`, sub: 'A new chapter of the story.\nRead it in your journal, in the menu.' };
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
