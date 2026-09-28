import { describe, expect, it } from 'vitest';
import {
  DAY_S, DEFAULT_RAIN, NIGHT_FROM, SEASONS, SEASON_ORDER, TileMap, dayAt, energyRate, findPath, findTiles, seasonAt, seasonView, stormAt, surgeAt, validateItems, validateMap, weatherAt,
  type ItemsData, type MapData, type Season,
} from '../src';
import itemsJson from '../../../content/items.json';
import nearWoods from '../../../content/maps/near-woods.json';
import stonebrook from '../../../content/maps/stonebrook.json';

const DAY_MS = DAY_S * 1000;
const WEEK_MS = 7 * 86_400_000;
/** A Monday, 00:00 UTC: the turn of a week, and so of a season. */
const MONDAY = Date.UTC(2026, 8, 28);
/** The first Monday from MONDAY that starts `season`, and a wall time `m` minutes into its first day. */
const mondayOf = (season: Season) => {
  let t = MONDAY;
  while (seasonAt(t) !== season) t += WEEK_MS;
  return t;
};
const into = (season: Season, m: number) => mondayOf(season) + m * 60_000;

/**
 * A 9x7 field with a pond in the middle (x 2 to 6, y 2 to 4) that freezes in winter, grass all round it
 * and the way home at the bottom (4,6).
 */
function pondField(more: Partial<MapData> = {}): MapData {
  const tiles = ['ttttttttt', 'tgggggggt', 'tgwwwwwgt', 'tgwwwwwgt', 'tgwwwwwgt', 'tgggggggt', 'ttttgtttt'];
  const pond: Array<[number, number]> = [];
  for (let y = 2; y <= 4; y++) for (let x = 2; x <= 6; x++) pond.push([x, y]);
  return {
    id: 'field', name: 'The Field', version: 1, kind: 'wilds', depth: 1, width: 9, height: 7, tiles, levels: Array<string>(7).fill('000000000'),
    spawn: { x: 4, y: 5, dir: 'up' }, exits: [{ x: 4, y: 6, w: 1, h: 1, to: 'town', tx: 0, ty: 0, dir: 'down', home: true }], objects: [],
    ice: [{ name: 'the pond', tiles: pond }], ...more,
  };
}

describe('seasons from the wall clock (roadmap/seasons.md)', () => {
  it('lasts a week each, from Monday 00:00 UTC, spring, summer, autumn, winter and round again, the same for everyone', () => {
    const start = mondayOf('spring');
    expect([0, 1, 2, 3, 4].map(k => seasonAt(start + k * WEEK_MS))).toEqual(['spring', 'summer', 'autumn', 'winter', 'spring']);
    // It turns at the Monday, not a moment before or after within the week.
    expect(seasonAt(start - 1)).toBe('winter');
    expect(seasonAt(start + WEEK_MS - 1)).toBe('spring');
    // A Monday is always a dawn: the season turns with the day.
    expect(start % DAY_MS).toBe(0);
    // And it says how long is left of it.
    expect(seasonView(start)).toEqual({ season: 'spring', left: 7 * 86_400 });
    expect(seasonView(start + 5 * 86_400_000 + 3_600_000)).toEqual({ season: 'spring', left: 2 * 86_400 - 3600 });
    expect(SEASON_ORDER).toEqual(['spring', 'summer', 'autumn', 'winter']);
  });

  it('rains longer in spring and shorter in summer, from where the windows start; summer\'s dusk lasts longer', () => {
    expect(weatherAt(into('spring', 12))).toEqual({ weather: 'rain', left: 18 * 60 });
    expect(weatherAt(into('summer', 12))).toEqual({ weather: 'rain', left: 6 * 60 });
    expect(weatherAt(into('autumn', 12))).toEqual({ weather: 'rain', left: 12 * 60 });
    expect(weatherAt(into('winter', 12))).toEqual({ weather: 'rain', left: 12 * 60 });
    // Never past nightfall: the South Road's spring rain stops as night falls.
    const south = [{ from: 24 * 60, length: 6 * 60 }];
    expect(weatherAt(into('spring', 24), south)).toEqual({ weather: 'rain', left: 8 * 60 });
    // Summer's light lasts four minutes longer; the day is as long as ever.
    expect(dayAt(into('summer', 0)).night).toBe(NIGHT_FROM + 4 * 60);
    expect(weatherAt(into('summer', 34)).weather).toBe('overcast');
    expect(weatherAt(into('summer', 36))).toEqual({ weather: 'night', left: 12 * 60 });
    expect(weatherAt(into('autumn', 32)).weather).toBe('night');
    expect(DEFAULT_RAIN).toEqual([{ from: 12 * 60, length: 12 * 60 }]);
  });

  it('storms twice as often in autumn, a quarter of the round either side of the usual storm, clear of the surges', () => {
    const woods = nearWoods as unknown as MapData, storm = woods.storm!, surge = woods.surge!;
    const storming = (season: Season) => {
      const at: number[] = [];
      for (let t = 0; t < storm.every; t += 30) if (stormAt(storm, mondayOf(season) + t * 1000, season).phase === 'storm') at.push(t);
      return at;
    };
    // Otherwise one storm a round, three minutes long; in autumn two.
    expect(storming('winter')).toHaveLength(6);
    expect(storming('autumn')).toHaveLength(12);
    // And never while the woods are restless or surging, in any season.
    for (const season of SEASON_ORDER) for (let t = 0; t < 2400; t += 10) {
      const wall = mondayOf(season) + t * 1000;
      if (stormAt(storm, wall, season).phase !== 'clear') expect(surgeAt(surge, wall).phase, `${season} ${t}`).toBe('calm');
    }
    // stormAt goes by the season of the wall time unless told.
    expect(stormAt(storm, into('autumn', 7))).toEqual(stormAt(storm, into('autumn', 7), 'autumn'));
  });

  it('bites colder in winter: every weather drains more, being wet more, and cold resistance cuts it all', () => {
    const map = new TileMap(pondField());
    const winter = { weather: SEASONS.winter.chill, wet: SEASONS.winter.wet };
    for (const w of ['overcast', 'rain', 'night'] as const) expect(-energyRate(map, 4, 5, w, { chill: winter })).toBeGreaterThan(-energyRate(map, 4, 5, w));
    expect(-energyRate(map, 4, 5, 'overcast', { chill: winter, wet: 1 }) / -energyRate(map, 4, 5, 'overcast', { chill: winter })).toBeGreaterThan(-energyRate(map, 4, 5, 'overcast', { wet: 1 }) / -energyRate(map, 4, 5, 'overcast'));
    // All cold resisted, winter is no worse than any other time.
    expect(energyRate(map, 4, 5, 'night', { chill: winter, resist: { cold: 1 } })).toBeCloseTo(energyRate(map, 4, 5, 'overcast'), 10);
    // The other seasons are not colder at all.
    for (const s of ['spring', 'summer', 'autumn'] as const) expect(SEASONS[s].chill).toBe(0);
  });
});

describe('frozen water (roadmap/seasons.md): walkable only in winter', () => {
  it('lets you walk on the ice only while it is frozen', () => {
    const map = new TileMap(pondField());
    expect(map.hasIce).toBe(true);
    expect(map.walkable(4, 3)).toBe(false);
    expect(map.freeze(true)).toBe(true);
    expect(map.walkable(4, 3)).toBe(true);
    expect(map.frozenAt(4, 3)).toBe(true);
    // Freezing again changes nothing; thawing does.
    expect(map.freeze(true)).toBe(false);
    expect(map.freeze(false)).toBe(true);
    expect([map.walkable(4, 3), map.frozenAt(4, 3), map.iceAt(4, 3)]).toEqual([false, false, true]);
    // Water nobody marked never freezes, and a map without ice never changes.
    const plain = new TileMap(pondField({ ice: [{ name: 'the pond', tiles: [[2, 2]] }] }));
    plain.freeze(true);
    expect([plain.walkable(2, 2), plain.walkable(3, 2)]).toEqual([true, false]);
    expect(new TileMap(pondField({ ice: undefined })).freeze(true)).toBe(false);
  });

  it('paths straight across the pond in winter, and around it otherwise', () => {
    const map = new TileMap(pondField());
    expect(findPath(map, 1, 3, 7, 3)).toHaveLength(10);
    map.freeze(true);
    const across = findPath(map, 1, 3, 7, 3);
    expect(across).toHaveLength(6);
    expect(across.every(p => p.y === 3)).toBe(true);
  });

  it('counts the ways home across the ice while it is frozen: the drain goes by them', () => {
    const map = new TileMap(pondField());
    expect(map.homeSteps(4, 3)).toBe(-1);
    map.freeze(true);
    expect(map.homeSteps(4, 3)).toBe(3);
    map.freeze(false);
    expect(map.homeSteps(4, 3)).toBe(-1);
  });

  it('never grows a find, nor wakes a watcher, on the ice: it thaws', () => {
    const map = new TileMap(pondField());
    map.freeze(true);
    const tiles = findTiles(map, { item: 'moss', map: 'field', count: 1, respawn: [1, 1] });
    expect(tiles.some(t => map.iceAt(t.x, t.y))).toBe(false);
    expect(map.lairs([0, 99]).some(i => map.iceAt(i % map.width, Math.floor(i / map.width)))).toBe(false);
  });

  it('freezes the pond in the Near Woods and the brook in Stonebrook, and each can be crossed', () => {
    const woods = new TileMap(nearWoods as unknown as MapData), town = new TileMap(stonebrook as unknown as MapData);
    expect(woods.data.ice!.map(w => w.name)).toEqual(['the pond']);
    expect(town.data.ice!.map(w => w.name)).toEqual(['the brook']);
    // Across the pond, west bank to east bank, along row 41; across the brook by the mill, north to south.
    expect(findPath(woods, 9, 41, 17, 41).some(p => woods.iceAt(p.x, p.y))).toBe(false);
    woods.freeze(true);
    const pond = findPath(woods, 9, 41, 17, 41);
    expect(pond).toHaveLength(8);
    expect(pond.some(p => woods.frozenAt(p.x, p.y))).toBe(true);
    town.freeze(true);
    expect(findPath(town, 37, 29, 37, 31)).toEqual([{ x: 37, y: 30 }, { x: 37, y: 31 }]);
  });

  it('checks a map\'s ice: water with a name, outdoors, each tile once, and a shore to step on from', () => {
    const errors = (d: MapData) => validateMap(d).filter(p => p.level === 'error').map(p => p.message);
    const warnings = (d: MapData) => validateMap(d).filter(p => p.level === 'warning').map(p => p.message);
    expect(errors(pondField())).toEqual([]);
    expect(errors(pondField({ ice: [{ name: 'the pond', tiles: [[1, 1]] }] }))).toEqual(['ice: 1,1 is not water']);
    expect(errors(pondField({ ice: [{ name: '', tiles: [[2, 2]] }] }))).toEqual(['ice: each frozen water has a name people say, like "the pond"']);
    expect(errors(pondField({ ice: [{ name: 'the pond', tiles: [[2, 2], [2, 2]] }] }))).toEqual(['ice: 2,2 is listed twice']);
    expect(warnings(pondField({ ice: [{ name: 'the middle', tiles: [[4, 3]] }] }))).toContain('ice: the middle has no shore to step onto it from, so nobody can cross it');
  });

  it('checks that storms stay clear of the surges in every season', () => {
    const errors = (d: MapData) => validateMap(d).filter(p => p.level === 'error').map(p => p.message);
    const surge = { every: 2400, unstable: 360, surge: 150, sweep: 90 };
    expect(errors(pondField({ ice: undefined, surge, storm: { every: 2400, warn: 60, length: 180, offset: 1200 } }))).toEqual([]);
    // Halfway through a round is clear; right before the surge, autumn's second storm lands on the restless time.
    expect(errors(pondField({ ice: undefined, surge, storm: { every: 2400, warn: 60, length: 180, offset: 700 } }))[0]).toMatch(/^storm: in autumn a storm \(or its warning\) blows while the region is restless or surging/);
  });

  it('checks a season\'s finds: a season there is, and only that', () => {
    const data = (more: object): ItemsData => ({ version: 1, items: [{ id: 'moss', name: 'Moss', kind: 'resource', stack: 3, text: 'Damp.' }], finds: [{ item: 'moss', map: 'field', count: 1, respawn: [1, 2], ...more }] });
    const errors = (d: ItemsData) => validateItems(d, [pondField()]).filter(p => p.level === 'error').map(p => p.message);
    expect(errors(data({ season: 'spring' }))).toEqual([]);
    expect(errors(data({ season: 'monsoon' }))).toEqual(['find 0 (moss in field): grows in "monsoon", which is not a season (spring, summer, autumn, winter)']);
    expect(errors(data({ season: 'spring', when: 'aurora' }))).toEqual(['find 0 (moss in field): grows in a season, or with a condition or at a time (when): one of them']);
  });

  it('ships more glowcaps in spring and more resin in autumn', () => {
    const content = itemsJson as unknown as ItemsData;
    expect(new Set(content.finds.filter(f => f.season === 'spring').map(f => f.item))).toEqual(new Set(['glowcap']));
    expect(new Set(content.finds.filter(f => f.season === 'autumn').map(f => f.item))).toEqual(new Set(['resin']));
    expect(content.finds.some(f => f.season === 'summer' || f.season === 'winter')).toBe(false);
  });
});
