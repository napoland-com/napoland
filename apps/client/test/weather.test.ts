/**
 * Weather per region on the client (roadmap/regional-weather.md): the sky follows the weather of the map
 * you are on as the server says it (the welcome, a zone, a turn), the notice board tells the regions
 * apart, and the effects a hand warmer or a rad tablet give show in the status panel with their time left.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ClientMsg, PlayerView } from '@napoland/shared';
import { Game } from '../src/game';
import { Items, factsOf, resistText, useLabel } from '../src/items';
import { Maps } from '../src/maps';
import { didText, useQuestion } from '../src/said';
import { newsBanner, statusView } from '../src/status';
import { soundscape, type Scene } from '../src/soundscape';
import { ambience } from '../src/view/lighting';
import { DRY, FULL, itemsData, tinyTown, tinyWoods, welcome, zone } from './fixtures';

const items = new Items({
  ...itemsData(),
  items: [
    ...itemsData().items,
    { id: 'hand-warmer', name: 'Hand warmer', kind: 'consumable', stack: 4, text: 'Hot.', use: { resist: { cold: 0.4 }, lasts: 300 } },
    { id: 'rad-tablet', name: 'Rad tablet', kind: 'consumable', stack: 6, text: 'White.', use: { resist: { radiation: 0.4 }, lasts: 300 } },
    { id: 'wool-cap', name: 'Wool cap', kind: 'gear', stack: 1, text: 'Warm.', slot: 'cap', tier: 'sturdy', resist: { cold: 0.15 } },
  ],
});
const maps = new Maps([tinyTown(), tinyWoods()]);
const me = (x: number, y: number): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir: 'up', color: '#f29e4c', gear: {}, quirks: [] });

let sent: ClientMsg[];
let g: Game;
beforeEach(() => {
  sent = [];
  g = new Game(maps, m => sent.push(m), items);
});

describe('the sky follows the region you are in', () => {
  it('takes the weather from the welcome, from every zone (the new region\'s own) and from each turn', () => {
    g.handle({ ...welcome(tinyTown(), [me(3, 3)]), weather: 'rain' }, 0);
    expect(g.weather).toBe('rain');
    // Out of the rain in town onto a road where it is dry.
    g.handle(zone(tinyWoods(), 2, 4, [me(2, 4)], 'exit', { weather: 'overcast' }), 1000);
    expect(g.weather).toBe('overcast');
    g.handle({ t: 'weather', weather: 'rain' }, 2000);
    expect(g.weather).toBe('rain');
    // And the view draws what it says: rain falls only where it rains.
    expect(ambience(g.map.data.kind, g.weather, false).rain).not.toBeNull();
    expect(ambience('wilds', 'overcast', false).rain).toBeNull();
  });

  it('announces lights in the sky once, when the night over you turns into an aurora', () => {
    g.handle(welcome(tinyWoods(), [me(2, 4)]), 0);
    g.handle({ t: 'weather', weather: 'aurora' }, 1000);
    g.handle({ t: 'weather', weather: 'aurora' }, 2000);
    const news = g.takeNews(2000).filter(n => n.kind === 'aurora');
    expect(news).toEqual([{ kind: 'aurora' }]);
    expect(newsBanner(news[0]!, 'The Test Woods')).toEqual({ title: 'Lights in the sky', sub: 'An aurora: the old wires hum,\nand copper turns up by the poles.' });
    // Walking into a region under the same aurora is no news.
    g.handle(zone(tinyTown(), 3, 1, [me(3, 1)], 'exit', { weather: 'aurora' }), 3000);
    expect(g.takeNews(3000)).toEqual([]);
  });

  it('plays the rain where it rains: the loop follows the weather of your map', () => {
    const scene = (weather: Scene['weather']): Scene => ({
      map: 'woods', kind: 'wilds', weather, storm: false, lightning: false, me: null, fires: [], poles: [], surge: null, caught: false, creatures: [], flashes: [], live: false, radio: null, news: [],
    });
    expect(soundscape(scene('rain')).loops.rain).toBeGreaterThan(0);
    expect(soundscape(scene('overcast')).loops.rain).toBe(0);
  });

  it('shows the notice board as the server writes it: the day, then each region on its own rain', () => {
    g.handle(welcome(tinyTown(), [me(3, 3)]), 0);
    const lines = ['Night falls in about 18 minutes.', 'The Near Woods: rain for about 10 minutes more.', 'The South Road: dry for about 10 minutes, then rain.'];
    g.handle({ t: 'board', lines }, 1000);
    expect(g.dialog).toMatchObject({ who: 'Notice board', lines });
  });
});

describe('hand warmers and rad tablets', () => {
  const warmer = items.get('hand-warmer'), tablet = items.get('rad-tablet');

  it('say what they give and for how long, in the bag and at the workbench', () => {
    expect(useLabel(warmer)).toBe('Use');
    expect(factsOf(warmer)).toContain('Cold +40% for 5 min');
    expect(factsOf(tablet)).toContain('Radiation +40% for 5 min');
  });

  it('ask first, and say a second one only starts the time again', () => {
    expect(useQuestion(warmer, FULL)).toBe('Use a hand warmer? Cold resistance +40% for 5 minutes.');
    expect(useQuestion(warmer, FULL, undefined, 185)).toBe('Use a hand warmer? The one before still works for 3 minutes. This one starts the 5 minutes again: it does not add up.');
    g.handle(welcome(tinyWoods(), [me(2, 4)], FULL, { bag: [{ item: 'hand-warmer', count: 2 }], body: { ...DRY, effects: [{ item: 'hand-warmer', left: 200 }] } }), 0);
    g.use(0);
    expect(g.askView()?.text).toBe('Use a hand warmer? The one before still works for 3 minutes. This one starts the 5 minutes again: it does not add up.');
    g.pressA();
    expect(sent).toEqual([{ t: 'use', slot: 0 }]);
  });

  it('say what they did, from the server', () => {
    expect(didText({ kind: 'used', item: 'hand-warmer', effect: { lasts: 300 } }, items)).toBe('You use the hand warmer. Cold resistance +40% for 5 minutes.');
    expect(didText({ kind: 'used', item: 'rad-tablet', effect: { lasts: 300, again: true } }, items)).toBe('You use the rad tablet. The one before still worked: the 5 minutes start again, radiation resistance +40%.');
  });

  it('show in the status panel with their time left, counted down, and count in what you resist', () => {
    g.handle(welcome(tinyWoods(), [me(2, 4)], FULL, { body: { ...DRY, effects: [{ item: 'hand-warmer', left: 245 }, { item: 'rad-tablet', left: 30 }] } }), 0);
    expect(g.effectsNow(0)).toEqual([{ item: 'hand-warmer', left: 245 }, { item: 'rad-tablet', left: 30 }]);
    // 40 seconds later the tablet is over, and the warmer runs on.
    const effects = g.effectsNow(40_000);
    expect(effects).toEqual([{ item: 'hand-warmer', left: 205 }]);
    const v = statusView({
      energy: FULL, body: DRY, surge: null, caught: false, stone: { charge: 0, need: 20, awake: false, left: 0 }, stats: {}, bag: [], items,
      progress: { xp: 0, level: 1, from: 0, to: 30, maxEnergy: 100 }, resists: resistText({ cap: 'wool-cap' }, items, {}, effects), effects,
      wear: null, quirks: [], storm: null, flash: null, weather: 'night', wilds: true,
    });
    const rows = v.rows.map(r => [r.label, r.text]);
    expect(rows).toContainEqual(['Resists', 'Cold 55%']);
    expect(rows).toContainEqual(['Hand warmer', 'Cold +40% for 3:25 more']);
    expect(rows.map(r => r[0])).not.toContain('Rad tablet');
    // The effect's row comes right after what you resist.
    expect(rows.findIndex(r => r[0] === 'Hand warmer')).toBe(rows.findIndex(r => r[0] === 'Resists') + 1);
  });

  it('keep nothing going offline: the connection dropped, the panel shows none until the server says again', () => {
    g.handle(welcome(tinyWoods(), [me(2, 4)], FULL, { body: { ...DRY, effects: [{ item: 'hand-warmer', left: 245 }] } }), 0);
    g.disconnected(1000);
    expect(g.effectsNow(2000)).toEqual([]);
  });
});
