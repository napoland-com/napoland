/**
 * The Ridge in the client, without a page: A at the trappers' rope (it pulls, and says it will not hold fewer
 * than three), a tap on the icefall without crampons, the whiteout while it snows, the view always in winter,
 * the footprints in its snow, its map button, and what drawing it costs: the real WorldView over a WebGL
 * context that draws nothing (fakegl.ts), against the Near Woods'.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRINTS_KEPT_MS, STARTER_TOOLS, TileMap, type ClientMsg, type ItemsData, type MapData, type MapObject, type PlayerView } from '@napoland/shared';
import { Game, ROPE_PULLED, WHITEOUT } from '../src/game';
import { Items } from '../src/items';
import { Maps } from '../src/maps';
import { mapFor, sketchOf } from '../src/papermap';
import { icefallText } from '../src/said';
import { ropeModel } from '../src/view/napo';
import { fakePage, fakeRenderer } from './fakegl';
import { welcome } from './fixtures';

fakePage();
const { WorldView } = await import('../src/view/world');

const content = resolve(import.meta.dirname, '../../../content');
const all = readdirSync(resolve(content, 'maps')).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(resolve(content, 'maps', f), 'utf8')) as MapData);
const find = (id: string) => all.find(m => m.id === id);
const items = new Items(JSON.parse(readFileSync(resolve(content, 'items.json'), 'utf8')) as ItemsData);
const ridge = new TileMap(find('ridge')!), near = new TileMap(find('near-woods')!), burn = find('burn')!;
const rope = burn.objects.find((o): o is Extract<MapObject, { kind: 'gate' }> => o.kind === 'gate')!;
const me = (x: number, y: number): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir: 'up', color: '#f29e4c', gear: {}, quirks: [] });
const game = (map: MapData, x: number, y: number, tools: string[] = [...STARTER_TOOLS], more: object = {}, sent: ClientMsg[] = []) => {
  const g = new Game(new Maps(all), m => sent.push(m), items);
  g.handle({ ...welcome(map, [me(x, y)], undefined, { tools, items: items.version }), ...more }, 1000);
  return g;
};
const home = ridge.data.exits.find(e => e.home)!;

describe('the trappers\' rope', () => {
  it('is taken hold of with A from below it: the text box says it will not hold fewer than three, then its board, and the server hears the pull', () => {
    const sent: ClientMsg[] = [];
    const g = game(burn, rope.x + 2, rope.y + 1, [...STARTER_TOOLS], {}, sent);
    g.pressA();
    expect(g.dialog).toMatchObject({ who: 'Fixed rope', lines: [ROPE_PULLED, ...rope.text] });
    expect(sent).toContainEqual({ t: 'talk', x: rope.x + 2, y: rope.y });
  });

  it('is drawn: the ice, and a rope down it with a loop at its foot for each who must be on it', () => {
    expect(ropeModel(rope).children.length).toBeGreaterThan(rope.w * 5);
  });
});

describe('the icefall', () => {
  let foot: [number, number] = [0, 0];
  for (let y = 0; y < ridge.height; y++) for (let x = 0; x < ridge.width; x++) if (ridge.kind(x, y) === 'icefall' && ridge.walkable(x, y + 1)) foot = [x, y];

  it('says what it takes when tapped without crampons, and walks nowhere', () => {
    const g = game(ridge.data, foot[0], foot[1] + 1);
    g.tapTile(foot[0], foot[1]);
    expect(g.note).toMatchObject({ who: 'Icefall', text: icefallText(items.get('crampons')) });
    expect(icefallText(items.get('crampons'))).toMatch(/Crampons would do it/);
  });

  it('is climbed by a tap in crampons', () => {
    const g = game(ridge.data, foot[0], foot[1] + 1, [...STARTER_TOOLS, 'crampons']);
    g.tapTile(foot[0], foot[1] - 3);
    expect(g.note).toBeNull();
  });
});

describe('the snow', () => {
  it('is always drawn in winter, whatever the season', () => {
    expect(game(ridge.data, home.x, home.y - 1).viewSeason()).toBe('winter');
    expect(game(burn, 27, 70).viewSeason()).toBe('spring');
  });

  it('closes in to a whiteout while it snows, and opens again when it stops', () => {
    expect(game(ridge.data, home.x, home.y - 1).fogCap()).toBe(WHITEOUT);
    expect(game(ridge.data, home.x, home.y - 1, [...STARTER_TOOLS], { weather: 'overcast' }).fogCap()).toBeUndefined();
    // Rain lower down is only rain.
    expect(game(burn, 27, 70).fogCap()).toBeUndefined();
  });

  it('keeps the footprints the server told of and every step taken there since, filling in over the hour', () => {
    const g = game(ridge.data, home.x, home.y - 1, [...STARTER_TOOLS], { prints: [{ x: 5, y: 40, dir: 'left', age: PRINTS_KEPT_MS / 2000 }] });
    expect(g.printsNow(1000)).toEqual([{ x: 5, y: 40, dir: 'left', faded: 0.5 }]);
    const changes = g.printChanges;
    g.handle({ t: 'join', player: { ...me(8, 40), id: 'bo', name: 'Bo' } }, 1000);
    g.handle({ t: 'step', id: 'bo', x: 8, y: 39, dir: 'up' }, 2000);
    expect(g.printChanges).toBeGreaterThan(changes);
    expect(g.printsNow(2000).at(-1)).toEqual({ x: 8, y: 39, dir: 'up', faded: 0 });
    // Gone when the hour is up.
    expect(g.printsNow(1000 + PRINTS_KEPT_MS)).toEqual([expect.objectContaining({ x: 8, y: 39 })]);
  });

  it('keeps none anywhere else', () => {
    const g = game(burn, 27, 70);
    g.handle({ t: 'join', player: { ...me(27, 69), id: 'bo', name: 'Bo' } }, 1000);
    g.handle({ t: 'step', id: 'bo', x: 27, y: 68, dir: 'up' }, 2000);
    expect(g.printsNow(2000)).toEqual([]);
  });
});

describe('the map button on the Ridge', () => {
  const chartOf = (t: string) => items.get(t).chart;
  it('opens no map until you have found the Ridge\'s own, then that one, in the high hut too', () => {
    expect(mapFor('ridge', [...STARTER_TOOLS], chartOf, find)).toBeUndefined();
    expect(mapFor('ridge', [...STARTER_TOOLS, 'ridge-map'], chartOf, find)).toBe('ridge-map');
    expect(mapFor('ridge-high-hut', [...STARTER_TOOLS, 'ridge-map'], chartOf, find)).toBe('ridge-map');
  });

  it('draws a paper map of it, with its places written in', () => {
    const s = sketchOf(ridge, id => find(id)?.name);
    expect(s.title).toBe('The Ridge');
    expect(s.labels.map(l => l.text)).toEqual(expect.arrayContaining(['the crest', 'the tarn']));
  });
});

describe('what the Ridge costs to draw', () => {
  function frame(map: TileMap, x: number, y: number, prints = 0): Array<{ calls: number; triangles: number }> {
    const { renderer } = fakeRenderer();
    const view = new WorldView(renderer, map, find, 'winter');
    view.setSnowPrints(Array.from({ length: prints }, (_, i) => ({ x: x + (i % 5), y: y - (i % 7), dir: 'up' as const, faded: i / prints })));
    const out = [[390, 844], [844, 390]].map(([w, h]) => {
      view.resize(w!, h!);
      view.render(1, 0.016, { x, y }, [], null, null);
      return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    });
    view.dispose();
    return out;
  }
  const deepest = (map: TileMap): [number, number] => {
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.homeSteps(x, y) === map.deepest) return [x, y];
    throw new Error('no deepest tile');
  };
  const entrance = (map: TileMap): [number, number] => {
    const e = map.data.exits.find(x => x.home)!;
    return [e.x, e.y + (e.y === 0 ? 1 : -1)];
  };

  it('stays near what the Near Woods cost, at the way in and at the deepest spot, and a full hour of footprints is one draw call', () => {
    const most = (list: Array<{ calls: number; triangles: number }>, k: 'calls' | 'triangles') => Math.max(...list.map(f => f[k]));
    const nearFrames = [...frame(near, ...entrance(near)), ...frame(near, ...deepest(near))];
    const ridgeFrames = [...frame(ridge, ...entrance(ridge)), ...frame(ridge, ...deepest(ridge))];
    expect(most(ridgeFrames, 'calls')).toBeLessThanOrEqual(most(nearFrames, 'calls') * 1.12);
    expect(most(ridgeFrames, 'triangles')).toBeLessThanOrEqual(most(nearFrames, 'triangles') * 1.1);
    const printed = frame(ridge, ...entrance(ridge), 1500), bare = frame(ridge, ...entrance(ridge));
    expect(most(printed, 'calls')).toBeLessThanOrEqual(most(bare, 'calls') + 1);
  });
});
