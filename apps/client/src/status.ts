/**
 * What the status panel and the banners say, from the game's state. Plain words, no drawing, so it
 * can be tested; hud.ts shows it and main.ts asks for it.
 */
import { FEATS, type BagSlot, type BodyView, type EnergyView, type ProgressView, type Stats, type StoneView, type SurgeView } from '@napoland/shared';
import { minutes } from './game';
import type { StatusView } from './hud';
import type { Items } from './items';

export interface StatusInput {
  energy: EnergyView | null;
  body: BodyView;
  surge: SurgeView | null;
  /** The front of a surge is over you. */
  caught: boolean;
  stone: StoneView;
  stats: Stats;
  bag: readonly BagSlot[];
  items: Items;
  progress: ProgressView;
}

/** "Level 3 · 150 XP, 120 to go": where you stand, for the status panel and the stash's header. */
export function levelText(p: ProgressView): string {
  return p.to === null ? `Level ${p.level} · ${p.xp} XP, the top` : `Level ${p.level} · ${p.xp} XP, ${p.to - p.xp} to go`;
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
  if (s.body.hitched) rows.push({ label: 'On you', text: 'Something clings to your back. Find a light, a fire or a roof.', tone: 'bad' });
  const charms = [...new Set(s.bag.map(b => s.items.get(b.item)).filter(d => d.kind === 'charm').map(d => d.name))];
  if (charms.length) rows.push({ label: 'Charms', text: charms.join(', '), tone: 'good' });
  if (s.surge && s.surge.phase !== 'calm') {
    rows.push({ label: 'Surge', text: s.surge.phase === 'unstable' ? `Coming in ${minutes(s.surge.left)}` : s.caught ? 'It has you. Get to a light!' : `On for ${minutes(s.surge.left)} more`, tone: 'bad' });
  }
  const st = s.stone;
  if (st.need) rows.push({ label: 'Old Stone', text: st.awake ? `Awake for ${minutes(st.left)}. Surges are gentler.` : `Asleep. ${st.charge} of ${st.need} shards.`, tone: st.awake ? 'good' : 'plain' });
  const feats = FEATS.map(f => {
    const have = s.stats[f.stat] ?? 0;
    return { name: f.name, text: f.text, done: have >= f.need, progress: Math.min(1, have / f.need) };
  });
  return { rows, feats };
}

/** The banner for news from the world: a surge's new phase, the Old Stone waking or sleeping, a feat. Null: nothing to say. */
export function newsBanner(
  n: { kind: 'feat'; id: string } | { kind: 'surge'; view: SurgeView } | { kind: 'stone'; view: StoneView } | { kind: 'level'; progress: ProgressView },
  place: string,
): { title: string; sub: string } | null {
  if (n.kind === 'level') return { title: `Level ${n.progress.level}`, sub: `Your energy bar grows to ${n.progress.maxEnergy}.\nYou can go a little farther now.` };
  if (n.kind === 'feat') {
    const f = FEATS.find(x => x.id === n.id);
    return f ? { title: `Feat: ${f.name}`, sub: f.text } : null;
  }
  if (n.kind === 'stone') {
    return n.view.awake
      ? { title: 'The Old Stone woke up', sub: 'Surges are gentler while it is awake.' }
      : { title: 'The Old Stone fell asleep', sub: `Bring it shards to wake it again (${n.view.need}).` };
  }
  switch (n.view.phase) {
    case 'unstable': return { title: `${place} grows restless`, sub: `A surge is coming in ${minutes(n.view.left)}.\nRare things show up deep in until it passes.` };
    case 'surge': return { title: 'Surge!', sub: 'It sweeps from the deep end toward home.\nStand in a street light, or get indoors.' };
    case 'calm': return { title: 'The surge has passed', sub: `${place} is calm again.` };
  }
}
