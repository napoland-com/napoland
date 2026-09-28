/**
 * Seasons on the client (roadmap/seasons.md): the season the server says, the ice it freezes walked on
 * here too, and how the status panel, the banners, the paper map, the light and the sound say it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TileMap, type ClientMsg, type MapData, type PlayerView } from '@napoland/shared';
import { Game } from '../src/game';
import { Maps } from '../src/maps';
import { FROZEN, sketchOf } from '../src/papermap';
import { drainText, newsBanner, seasonText, statusView } from '../src/status';
import { soundscape, stepSurface, type Scene } from '../src/soundscape';
import { GRADES, Ground } from '../src/view/grass';
import { SNOW, ambience } from '../src/view/lighting';
import { DRY, FULL, ITEMS, welcome } from './fixtures';

const load = (name: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../content/maps/${name}.json`), 'utf8')) as MapData;
const stonebrook = load('stonebrook'), nearWoods = load('near-woods');
/** By the brook, north of it, below the mill. */
const me: PlayerView = { id: 'me', name: 'Aldo', x: 37, y: 29, dir: 'down', color: '#d9a53a', gear: {}, quirks: [] };

/** A game in Stonebrook, by the brook, in `season`, with what it sent. */
function game(season: 'spring' | 'winter') {
  const sent: ClientMsg[] = [], maps = new Maps([stonebrook, nearWoods]);
  const g = new Game(maps, m => sent.push(m), ITEMS);
  g.handle(welcome(stonebrook, [me], FULL, { season: { season, left: 3 * 86_400 } }), 1000);
  return { g, sent, maps };
}

describe('the season the server says', () => {
  it('walks onto the frozen brook in winter, as the server allows, and not in any other season', () => {
    const winter = game('winter');
    expect(winter.g.map.walkable(37, 30)).toBe(true);
    winter.g.padChange('down', 1000);
    winter.g.update(0.02, 1020);
    expect(winter.sent).toContainEqual({ t: 'step', dir: 'down', seq: 1 });
    const spring = game('spring');
    expect(spring.g.map.walkable(37, 30)).toBe(false);
    spring.g.padChange('down', 1000);
    spring.g.update(0.02, 1020);
    expect(spring.sent.filter(m => m.t === 'step')).toEqual([]);
  });

  it('thaws with the server: the ice is water again, every map of it, and the news says spring', () => {
    const { g, maps } = game('winter');
    const woods = maps.get(nearWoods)!;
    expect(woods.frozenAt(13, 41)).toBe(true);
    g.handle({ t: 'season', season: { season: 'spring', left: 7 * 86_400 } }, 2000);
    expect([g.map.walkable(37, 30), woods.walkable(13, 41)]).toEqual([false, false]);
    const news = g.takeNews(2000).filter(n => n.kind === 'season');
    expect(news).toEqual([{ kind: 'season', season: 'spring', frozen: ['the pond in the Near Woods', 'the brook in Stonebrook'] }]);
    expect(newsBanner(news[0]!, 'Stonebrook')).toEqual({ title: 'Spring', sub: 'Longer rain, and more glowcaps out there.\nThe ice is gone.' });
    // A map built later is as frozen as the season says.
    g.handle({ t: 'season', season: { season: 'winter', left: 7 * 86_400 } }, 3000);
    expect(new Maps([nearWoods]).get(nearWoods)!.frozenAt(13, 41)).toBe(false);
    expect(maps.get(nearWoods)!.frozenAt(13, 41)).toBe(true);
  });

  it('counts the season down, and says it in the status panel with how long is left and what it changes', () => {
    const { g } = game('winter');
    expect(g.seasonNow(1000 + 86_400_000)).toEqual({ season: 'winter', left: 2 * 86_400 });
    expect(seasonText({ season: 'winter', left: 2 * 86_400 })).toBe('Winter, 2 days left. Colder out there, and snow instead of rain.');
    expect(seasonText({ season: 'summer', left: 5 * 3600 })).toBe('Summer, 5 hours left. Shorter rain, and light until later in the evening.');
    expect(seasonText({ season: 'autumn', left: 20 * 60 })).toBe('Autumn, 20 minutes left. More resin out there, and storms twice as often.');
    const v = statusView({
      energy: FULL, body: DRY, surge: null, caught: false, stone: { charge: 0, need: 20, awake: false, left: 0 }, stats: {}, bag: [], items: ITEMS,
      progress: { xp: 0, level: 1, from: 0, to: 30, maxEnergy: 100 }, resists: null, wear: null, quirks: [], storm: null, flash: null, weather: 'rain', wilds: true,
      season: { season: 'winter', left: 3 * 86_400 },
    });
    const rows = v.rows.map(r => [r.label, r.text]);
    expect(rows).toContainEqual(['Season', 'Winter, 3 days left. Colder out there, and snow instead of rain.']);
    // What drains you says the snow, and the winter's cold.
    expect(rows).toContainEqual(['Draining', 'Cold: snow, winter']);
    expect(drainText({ weather: 'overcast', wet: 0, storm: false, caught: false, flash: null, season: 'winter' })).toBe('Cold: winter');
    expect(drainText({ weather: 'rain', wet: 0, storm: false, caught: false, flash: null, season: 'autumn' })).toBe('Cold: rain');
  });

  it('announces the winter with what it freezes', () => {
    expect(newsBanner({ kind: 'season', season: 'winter', frozen: ['the pond in the Near Woods', 'the brook in Stonebrook'] }, 'Stonebrook')).toEqual({
      title: 'Winter', sub: 'Colder out there, and snow instead of rain.\nThe pond in the Near Woods and the brook in Stonebrook are frozen: you can walk across.',
    });
    expect(newsBanner({ kind: 'season', season: 'autumn', frozen: [] }, 'Stonebrook')).toEqual({ title: 'Autumn', sub: 'More resin out there, and storms twice as often.' });
  });

  it('shows the notice board as the server writes it, the season among the lines', () => {
    const { g } = game('winter');
    const lines = ['Night falls in about 18 minutes.', 'The Near Woods: snow for about 10 minutes more.', 'Winter, for about 3 days more: colder out there, and snow instead of rain. Spring comes next.'];
    g.handle({ t: 'board', lines }, 2000);
    expect(g.dialog).toMatchObject({ who: 'Notice board', lines });
  });
});

describe('how a season looks and sounds', () => {
  it('writes "frozen in winter" on the paper map by the pond and by the brook, and moves no name for it', () => {
    for (const [data, near] of [[nearWoods, 'pond'], [stonebrook, 'the pond']] as const) {
      const plain = sketchOf(new TileMap({ ...data, ice: undefined }), () => undefined).labels;
      const labels = sketchOf(new TileMap(data), () => undefined).labels;
      const note = labels.find(l => l.text === FROZEN)!;
      const ice = data.ice![0]!.tiles, cx = ice.reduce((n, [x]) => n + x, 0) / ice.length, cy = ice.reduce((n, [, y]) => n + y, 0) / ice.length;
      expect(Math.hypot(note.x - cx, note.y - cy), data.id).toBeLessThan(6);
      expect(labels.filter(l => l.text !== FROZEN), data.id).toEqual(plain);
      expect(labels.some(l => l.text === near), data.id).toBe(true);
    }
  });

  it('snows in winter: pale, and a storm drives snow too; tints the light a little in every season', () => {
    const winter = ambience('wilds', 'rain', false, 'winter');
    expect(winter.snow).toBe(true);
    expect(winter.rain).toEqual(SNOW);
    expect(ambience('wilds', 'overcast', false, 'winter')).toMatchObject({ snow: true, rain: null });
    expect(ambience('wilds', 'rain', false, 'autumn')).toMatchObject({ snow: false, rain: { color: '#aebfcc' } });
    // Each season its own light, the same weather; inside, no snow.
    const suns = (['spring', 'summer', 'autumn', 'winter'] as const).map(s => ambience('wilds', 'overcast', false, s).sun.color);
    expect(new Set(suns).size).toBeGreaterThanOrEqual(3);
    expect(ambience('inside', 'rain', true, 'winter').snow).toBe(false);
    // No season: the light as it always was.
    expect(ambience('wilds', 'overcast', false)).toEqual({ ...ambience('wilds', 'overcast', false), snow: false });
  });

  it('grades the ground and the plants: greener in spring, rust in autumn, frost in winter; water frozen is ice', () => {
    const map = new TileMap(nearWoods);
    const at = (season?: 'spring' | 'autumn' | 'winter') => new Ground(map, season).color('grass', 20, 60, 20, 60, false, new THREE.Color());
    const plain = at(), spring = at('spring'), autumn = at('autumn'), winter = at('winter');
    expect(spring.g - spring.r).toBeGreaterThan(plain.g - plain.r - 0.001);
    expect(autumn.r - autumn.g).toBeGreaterThan(plain.r - plain.g);
    expect(winter.getHSL({ h: 0, s: 0, l: 0 }).l).toBeGreaterThan(plain.getHSL({ h: 0, s: 0, l: 0 }).l);
    // Roads take only the winter's frost.
    const road = (season?: 'autumn' | 'winter') => new Ground(map, season).color('road', 31, 70, 31, 70, false, new THREE.Color()).getHex();
    expect(road('autumn')).toBe(road());
    expect(road('winter')).not.toBe(road());
    expect(GRADES.winter.paved).toBeGreaterThan(0);
    const ice = new Ground(map, 'winter').iceColor(13, 41, 13, 41, new THREE.Color());
    expect(ice.b).toBeGreaterThan(ice.r);
  });

  it('hushes the rain to snow, and taps on the ice', () => {
    const scene = (snow: boolean): Scene => ({
      map: 'woods', kind: 'wilds', weather: 'rain', snow, storm: false, lightning: false, me: null, fires: [], poles: [], surge: null, caught: false, creatures: [], flashes: [], live: false, radio: null, news: [],
    });
    expect(soundscape(scene(true)).loops.rain).toBeLessThan(soundscape(scene(false)).loops.rain);
    expect(soundscape(scene(true)).loops.rain).toBeGreaterThan(0);
    expect(stepSurface('water', true)).toBe('ice');
    expect(stepSurface('water')).toBe('water');
  });
});
