/**
 * The Far Woods in the client, without a page: the map button there (its map is found, not given), the
 * paper map drawn of it, how old growth looks (taller firs and cedars, deeper ferns, less light), the
 * bridge over its gorge, and what drawing it costs: the real WorldView over three.js's real renderer and
 * a WebGL context that draws nothing (fakegl.ts), its draw calls and triangles counted at the Far Woods'
 * entrance and heart against the Near Woods'.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STARTER_TOOLS, TileMap, type ItemsData, type MapData, type PlayerView } from '@napoland/shared';
import { Game } from '../src/game';
import { Items } from '../src/items';
import { Maps } from '../src/maps';
import { mapFor, sketchOf } from '../src/papermap';
import { NO_MAP_YET } from '../src/said';
import { ambience, underOldGrowth } from '../src/view/lighting';
import { bridgeRails } from '../src/view/left';
import { fakePage, fakeRenderer } from './fakegl';
import { welcome } from './fixtures';

fakePage();
const { CEDAR_SHARE, WorldView, deepInForest, isCedar, treeSize } = await import('../src/view/world');

const content = resolve(import.meta.dirname, '../../../content');
const all = readdirSync(resolve(content, 'maps')).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(resolve(content, 'maps', f), 'utf8')) as MapData);
const find = (id: string) => all.find(m => m.id === id);
const items = new Items(JSON.parse(readFileSync(resolve(content, 'items.json'), 'utf8')) as ItemsData);
const far = new TileMap(find('far-woods')!), near = new TileMap(find('near-woods')!);
const chartOf = (t: string) => items.get(t).chart;

describe('the map button in the Far Woods', () => {
  it('opens no map until you have found the Far Woods\' own, then that one, indoors there too', () => {
    const found = [...STARTER_TOOLS, 'far-woods-map'];
    expect(mapFor('far-woods', [...STARTER_TOOLS], chartOf, find)).toBeUndefined();
    expect(mapFor('far-woods-trapper-cabin', [...STARTER_TOOLS], chartOf, find)).toBeUndefined();
    expect(mapFor('far-woods', found, chartOf, find)).toBe('far-woods-map');
    expect(mapFor('far-woods-field-post', found, chartOf, find)).toBe('far-woods-map');
    // The maps everyone starts with still open where they did.
    expect(mapFor('near-woods-end-cabin', [...STARTER_TOOLS], chartOf, find)).toBe('near-woods-map');
  });

  it('says in the text box that you have no map of this place yet', () => {
    const me: PlayerView = { id: 'me', name: 'Aldo', x: 40, y: 97, dir: 'up', color: '#f29e4c', gear: {}, quirks: [] };
    const g = new Game(new Maps(all), () => {}, items);
    g.handle(welcome(find('far-woods')!, [me], undefined, { tools: [...STARTER_TOOLS], items: items.version }), 1000);
    g.noMap();
    expect(NO_MAP_YET).toBe('You have no map of this place yet.');
    expect(g.note).toMatchObject({ who: 'Map', text: NO_MAP_YET, waiting: false });
  });
});

describe('the paper map of the Far Woods', () => {
  const nameOf = (id: string) => find(id)?.name;
  const s = sketchOf(far, nameOf);

  it('draws the loggers\' camp, the bridge over the gorge and the field post\'s mast, and writes in the places and the doors', () => {
    expect(s.title).toBe('The Far Woods');
    expect(s.ruins).toHaveLength(1);
    expect(s.things.filter(t => t.kind === 'yarder')).toHaveLength(1);
    expect(s.things.filter(t => t.kind === 'spool').length).toBeGreaterThanOrEqual(3);
    // Two rails a tile, and the tiles of a bridge meet end to end.
    expect(s.bridges.length).toBeGreaterThanOrEqual(4);
    expect(s.masts).toHaveLength(1);
    expect(s.water.length).toBeGreaterThan(80);
    const labels = s.labels.map(l => l.text);
    for (const name of ['to The Near Woods', 'the fork', 'the ford', 'the cedar grove', 'the split rock', 'the loggers\' bridge', 'the old camp', 'the cut', 'the hollow', 'The trapper\'s cabin', 'The NAPO field post']) {
      expect(labels, name).toContain(name);
    }
  });

  it('shows the way on from the Near Woods on theirs', () => {
    expect(sketchOf(near, nameOf).labels.map(l => l.text)).toContain('The Far Woods');
  });
});

describe('old growth', () => {
  it('grows taller firs than young woods, the giants only deep in the forest', () => {
    const sizes = (old: boolean, deep: boolean) => [treeSize(0, old, deep), treeSize(1, old, deep)].map(v => Math.round(v * 100) / 100);
    expect(sizes(false, false)).toEqual([1, 1.5]);
    expect(sizes(false, true)).toEqual([1, 1.5]);
    expect(sizes(true, false)).toEqual([1.2, 1.8]);
    expect(sizes(true, true)).toEqual([1.6, 2.4]);
    // A forest tile beside the trail is not deep; one with forest all round it is.
    const [x, y] = [far.data.exits[0]!.x, far.data.exits[0]!.y - 1];
    expect(deepInForest(far, x - 1, y)).toBe(false);
    expect(deepInForest(far, 2, 2)).toBe(true);
  });

  it('has a cedar for about every third tree, the same ones on every visit', () => {
    let trees = 0, cedars = 0;
    for (let y = 0; y < far.height; y++) for (let x = 0; x < far.width; x++) if (far.kind(x, y) === 'forest') { trees++; if (isCedar(x, y)) cedars++; }
    expect(cedars / trees).toBeGreaterThan(CEDAR_SHARE - 0.04);
    expect(cedars / trees).toBeLessThan(CEDAR_SHARE + 0.04);
    expect(isCedar(10, 20)).toBe(isCedar(10, 20));
  });

  it('lets less light through in any weather, and closes the mist in sooner; what glows glows as bright', () => {
    for (const w of ['overcast', 'rain', 'night', 'aurora'] as const) {
      const plain = ambience('wilds', w, false), old = underOldGrowth(plain);
      expect(old.hemi.intensity, w).toBeLessThan(plain.hemi.intensity);
      expect(old.sun.intensity, w).toBeLessThan(plain.sun.intensity);
      expect(old.fog!.min, w).toBeLessThan(plain.fog!.min);
      expect([old.lampGlow, old.warmGlow, old.capGlow, old.flashlight], w).toEqual([plain.lampGlow, plain.warmGlow, plain.capGlow, plain.flashlight]);
    }
  });
});

describe('the loggers\' bridge', () => {
  it('has a rail down each outer side and none down its middle', () => {
    const tiles = new Set(far.data.objects.flatMap(o => (o.kind === 'bridge' ? [`${o.x},${o.y}`] : [])));
    const isBridge = (x: number, y: number) => tiles.has(`${x},${y}`);
    const bridges = far.data.objects.filter(o => o.kind === 'bridge');
    // Two tiles wide, it runs north to south over the gorge.
    expect(bridges.every(b => b.kind === 'bridge' && b.dir === 'v')).toBe(true);
    const rails = bridges.map(b => (b.kind === 'bridge' ? bridgeRails(b, isBridge) : [false, false]));
    for (const [west, east] of rails) expect(west !== east).toBe(true);
    expect(bridgeRails({ x: 0, y: 0, dir: 'h' }, () => false)).toEqual([true, true]);
  });
});

describe('what the Far Woods cost to draw', () => {
  /** Draw calls and triangles of one frame with the camera on x,y, on a phone held upright and on its side. */
  function frame(map: TileMap, x: number, y: number): Array<{ calls: number; triangles: number }> {
    const { renderer } = fakeRenderer();
    const view = new WorldView(renderer, map, find);
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

  it('stays near what the Near Woods cost, at the way in and at the heart, upright and on its side', () => {
    const nearFrames = [...frame(near, ...entrance(near)), ...frame(near, ...deepest(near))];
    const farFrames = [...frame(far, ...entrance(far)), ...frame(far, ...deepest(far))];
    const most = (list: Array<{ calls: number; triangles: number }>, k: 'calls' | 'triangles') => Math.max(...list.map(f => f[k]));
    // Measured when they were built: the Near Woods at most 78 calls and 133K triangles, the Far Woods 77
    // and 137K (landscape at the way in), with nobody on screen. Old growth is the same instanced blocks
    // scaled and tinted, and deep in it the trees cast no blob shadow; the bigger map's terrain is one mesh.
    expect(most(farFrames, 'calls')).toBeLessThanOrEqual(most(nearFrames, 'calls') * 1.1);
    expect(most(farFrames, 'triangles')).toBeLessThanOrEqual(most(nearFrames, 'triangles') * 1.1);
  });
});
