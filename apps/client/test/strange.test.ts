import { describe, expect, it } from 'vitest';
import type { ClientMsg, ItemsData, PlayerView } from '@napoland/shared';
import json from '../../../content/items.json';
import { Game } from '../src/game';
import { Items } from '../src/items';
import { Lodestone, TUG_EVERY_MS, shardNear } from '../src/lodestone';
import { Maps } from '../src/maps';
import { didText, useQuestion } from '../src/said';
import { soundscape, type Scene } from '../src/soundscape';
import { newsBanner } from '../src/status';
import { tinyWoods, welcome } from './fixtures';

const items = new Items(json as ItemsData);

describe('what the new things say', () => {
  it('names what a strange object turns out to be, with what it is good for', () => {
    const into = (item: string, count = 1, quirk?: 'hush' | 'lodestone' | 'afterglow') =>
      didText({ kind: 'used', item: 'strange', into: { item, count, ...(quirk ? { piece: { cond: 1, quirk } } : {}) } }, items);
    expect(into('ember-coal')).toBe('It turns out to be an ember coal. While it is in your bag, fires warm you 20% faster.');
    expect(into('pale-moth')).toBe('It turns out to be a pale moth. While it is in your bag, crushing a glowcap gives you 1 energy.');
    expect(into('cloth', 3)).toBe('It turns out to be 3 cloth. Cloth mends gear at the workbench, and it catches fast in a fire.');
    expect(into('crew-hood', 1, 'hush')).toBe('It turns out to be a crew hood. Put it on from your bag: a third of the glow of the anomalies stays out, and some of the cold. It has a quirk: hush.');
    expect(into('crew-boots', 1, 'afterglow')).toBe('It turns out to be crew boots. Put them on from your bag: electricity stings less, and some of the glow and the cold stay out. It has a quirk: afterglow.');
  });

  it('says what the new quirks do', () => {
    expect(items.quirk('hush')).toEqual({ name: 'Hush', text: 'Your steps fall soft: the skulkers in the ferns hear you walking only from 4 steps, not 6.' });
    expect(items.quirk('lodestone').text).toBe('It tugs, softly, while a shard lies within 5 steps of you. It never says which way.');
    expect(items.quirk('afterglow').text).toMatch(/^When a flash discharges near you, you glow faintly for 30 seconds/);
  });

  it('asks before a glowcap is crushed what a pale moth gives back, and says it after', () => {
    const cap = items.get('glowcap'), moth = items.get('pale-moth');
    expect(useQuestion(cap, { value: 50, max: 100, rate: 0 }, 86_400, { charm: moth, energy: 1 }))
      .toBe('Crush a glowcap to paint an arrow where you face? Everyone sees it for a day. Your pale moth gives you 1 energy.');
    expect(useQuestion(cap, { value: 50, max: 100, rate: 0 })).toBe('Crush a glowcap to paint an arrow where you face? Everyone sees it for a day.');
    expect(didText({ kind: 'used', item: 'glowcap', mark: { dir: 'up', left: 86_400 }, lift: { item: 'pale-moth', energy: 1 } }, items))
      .toBe('You crush the glowcap. An arrow glows where you stand, pointing north. Everyone sees it for a day. The pale moth in your bag stirs: +1 energy.');
  });

  it('says the pale moth when the game asks, as long as the bar has room for what it gives', () => {
    const me: PlayerView = { id: 'me', name: 'Aldo', x: 2, y: 2, dir: 'up', color: '#fff', gear: {}, quirks: [] };
    const asked = (value: number) => {
      const g = new Game(new Maps([tinyWoods()]), () => {}, items);
      g.handle(welcome(tinyWoods(), [me], { value, max: 100, rate: 0 }, { items: items.version, bag: [{ item: 'glowcap', count: 2 }, { item: 'pale-moth', count: 1 }] }), 0);
      g.use(0);
      return g.question?.text;
    };
    expect(asked(50)).toBe('Crush a glowcap to paint an arrow where you face? Everyone sees it for a day. Your pale moth gives you 1 energy.');
    expect(asked(100)).toBe('Crush a glowcap to paint an arrow where you face? Everyone sees it for a day.');
  });
});

describe('a lodestone', () => {
  const shard = (x: number, y: number) => ({ id: x * 100 + y, item: 'shard', x, y });

  it('feels a shard (anything the Old Stone takes) within 5 tiles, and nothing else', () => {
    expect(shardNear([shard(3, 4)], items, 0, 0)).toBe(true);
    expect(shardNear([shard(4, 4)], items, 0, 0)).toBe(false);
    expect(shardNear([{ id: 1, item: 'live-shard', x: 2, y: 0 }], items, 0, 0)).toBe(true);
    expect(shardNear([{ id: 1, item: 'resin', x: 1, y: 0 }], items, 0, 0)).toBe(false);
  });

  it('tugs at once, then now and then while one stays near, never more often', () => {
    const l = new Lodestone();
    expect(l.update(false, 0)).toBe(false);
    expect(l.update(true, 100)).toBe(true);
    expect(l.update(true, 200)).toBe(false);
    expect(l.update(true, 100 + TUG_EVERY_MS)).toBe(true);
    // Out of reach and back at once: still not sooner.
    expect(l.update(false, 150 + TUG_EVERY_MS)).toBe(false);
    expect(l.update(true, 200 + TUG_EVERY_MS)).toBe(false);
  });

  it('is felt by whoever wears one near a shard: a tug, which a sound says and no banner does', () => {
    const me = (quirk?: 'lodestone' | 'hush'): PlayerView => ({ id: 'me', name: 'Aldo', x: 2, y: 2, dir: 'up', color: '#fff', gear: {}, quirks: quirk ? [quirk] : [] });
    const play = (quirk?: 'lodestone' | 'hush') => {
      const g = new Game(new Maps([tinyWoods()]), (_: ClientMsg) => {}, items);
      g.handle(welcome(tinyWoods(), [me(quirk)], undefined, { items: items.version, finds: [shard(2, 4)], ...(quirk ? { body: { wet: 0, wetRate: 0, load: 0, hitched: false, worn: { cap: { cond: 1, quirk } } } } : {}) }), 0);
      g.update(0.016, 1000);
      return g.takeNews(1000).filter(n => n.kind === 'tug');
    };
    expect(play('lodestone')).toEqual([{ kind: 'tug' }]);
    expect(play('hush')).toEqual([]);
    expect(play()).toEqual([]);
    expect(newsBanner({ kind: 'tug' }, 'The Woods', items)).toBeNull();
    const scene: Scene = { map: 'woods', kind: 'wilds', weather: 'overcast', storm: false, lightning: false, me: null, fires: [], poles: [], surge: null, caught: false, creatures: [], flashes: [], live: false, radio: null, news: [{ kind: 'tug' }] };
    expect(soundscape(scene).shots).toContainEqual({ kind: 'tug' });
  });
});

describe('an afterglow', () => {
  it('shows on whoever glows, as the server says, until it fades', () => {
    const ana: PlayerView = { id: 'ana', name: 'Ana', x: 1, y: 2, dir: 'up', color: '#fff', gear: {}, quirks: ['afterglow'], afterglow: 12 };
    const g = new Game(new Maps([tinyWoods()]), () => {}, items);
    g.handle(welcome(tinyWoods(), [{ ...ana, id: 'me', afterglow: undefined }, ana], undefined, { items: items.version }), 0);
    const glows = () => Object.fromEntries(g.avatars().map(a => [a.id, a.afterglow]));
    g.update(0.016, 1000);
    expect(glows()).toEqual({ me: false, ana: true });
    g.handle({ t: 'afterglow', id: 'me', left: 30 }, 2000);
    g.update(0.016, 2000);
    expect(glows()).toEqual({ me: true, ana: true });
    // Ana's was 12 seconds: over by now. Mine fades when the server says so.
    g.update(0.016, 13_000);
    expect(glows()).toEqual({ me: true, ana: false });
    g.handle({ t: 'afterglow', id: 'me', left: 0 }, 14_000);
    expect(glows().me).toBe(false);
  });
});
