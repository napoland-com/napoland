/**
 * The Marsh in the client, without a page: its mist, which never lifts, the lights that drift over its water,
 * its map button, and what drawing it costs: the real WorldView over a WebGL context that draws nothing
 * (fakegl.ts), against the Near Woods'.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { STARTER_TOOLS, TileMap, type ItemsData, type MapData, type PlayerView } from '@napoland/shared';
import { Game, MARSH_MIST } from '../src/game';
import { Items } from '../src/items';
import { Maps } from '../src/maps';
import { mapFor, sketchOf } from '../src/papermap';
import { MarshLights } from '../src/view/wilds';
import { fakePage, fakeRenderer } from './fakegl';
import { welcome } from './fixtures';

fakePage();
const { WorldView } = await import('../src/view/world');

const content = resolve(import.meta.dirname, '../../../content');
const all = readdirSync(resolve(content, 'maps')).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(resolve(content, 'maps', f), 'utf8')) as MapData);
const find = (id: string) => all.find(m => m.id === id);
const items = new Items(JSON.parse(readFileSync(resolve(content, 'items.json'), 'utf8')) as ItemsData);
const marsh = new TileMap(find('marsh')!), near = new TileMap(find('near-woods')!);
const home = marsh.data.exits.find(e => e.home)!;
const game = (map: MapData, x: number, y: number, more: object = {}) => {
  const me: PlayerView = { id: 'me', name: 'Aldo', x, y, dir: 'right', color: '#f29e4c', gear: {}, quirks: [] };
  const g = new Game(new Maps(all), () => {}, items);
  g.handle({ ...welcome(map, [me], undefined, { tools: [...STARTER_TOOLS], items: items.version }), ...more }, 1000);
  return g;
};

describe('the Marsh\'s mist', () => {
  it('never lifts: you see a few tiles out there, rain or none, and indoors it is gone', () => {
    expect(game(marsh.data, home.x + 1, home.y, { weather: 'overcast' }).fogCap()).toBe(MARSH_MIST);
    expect(game(marsh.data, home.x + 1, home.y).fogCap()).toBe(MARSH_MIST);
    expect(game(find('marsh-cutters-hut')!, 3, 4).fogCap()).toBeUndefined();
    expect(game(near.data, 30, 70, { weather: 'overcast' }).fogCap()).toBeUndefined();
  });
});

describe('the lights on the water', () => {
  const water: Array<[number, number]> = [];
  for (let y = 0; y < marsh.height; y++) for (let x = 0; x < marsh.width; x++) if (marsh.kind(x, y) === 'water') water.push([x, y]);

  it('drift over the water, swelling and fading, the same for everyone at the same time', () => {
    const a = new MarshLights(water), b = new MarshLights(water);
    a.update(100);
    b.update(100);
    const where = (l: MarshLights) => l.root.children.map(c => c.position.toArray().map(v => v.toFixed(3)).join(','));
    expect(where(a)).toEqual(where(b));
    expect(a.root.children.length).toBeGreaterThan(3);
    const before = where(a);
    a.update(160);
    expect(where(a)).not.toEqual(before);
    // Over the water, or nearly: never far over the dry bog.
    for (const c of a.root.children) {
      const x = Math.floor(c.position.x), y = Math.floor(c.position.z);
      expect(water.some(([wx, wy]) => Math.abs(wx - x) <= 3 && Math.abs(wy - y) <= 3), `${x},${y}`).toBe(true);
    }
    const opacity = (l: MarshLights) => ((l.root.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity;
    const seen = [0, 5, 10, 15].map(t => { a.update(t); return opacity(a); });
    expect(Math.max(...seen)).toBeGreaterThan(Math.min(...seen));
  });

  it('are none where there is no water', () => {
    expect(new MarshLights([]).root.children).toEqual([]);
  });
});

describe('the map button in the Marsh', () => {
  const chartOf = (t: string) => items.get(t).chart;
  it('opens no map until you have found the Marsh\'s own, then that one, in the cutters\' hut too', () => {
    expect(mapFor('marsh', [...STARTER_TOOLS], chartOf, find)).toBeUndefined();
    expect(mapFor('marsh', [...STARTER_TOOLS, 'marsh-map'], chartOf, find)).toBe('marsh-map');
    expect(mapFor('marsh-cutters-hut', [...STARTER_TOOLS, 'marsh-map'], chartOf, find)).toBe('marsh-map');
  });

  it('draws a paper map of it, with its places and its boardwalks', () => {
    const s = sketchOf(marsh, id => find(id)?.name);
    expect(s.title).toBe('The Marsh');
    expect(s.labels.map(l => l.text)).toEqual(expect.arrayContaining(['the black pool', 'the peat cuttings']));
    expect(s.footbridges.length).toBe(2);
  });
});

describe('what the Marsh costs to draw', () => {
  function frame(map: TileMap, x: number, y: number): Array<{ calls: number; triangles: number }> {
    const { renderer } = fakeRenderer();
    const view = new WorldView(renderer, map, find);
    const out = [[390, 844], [844, 390]].map(([w, h]) => {
      view.resize(w!, h!);
      view.render(100, 0.016, { x, y }, [], null, null);
      return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    });
    view.dispose();
    return out;
  }
  const deepest = (map: TileMap): [number, number] => {
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.homeSteps(x, y) === map.deepest) return [x, y];
    throw new Error('no deepest tile');
  };

  it('stays near what the Near Woods cost, at the way in and at the deepest spot, its lights and all', () => {
    const most = (list: Array<{ calls: number; triangles: number }>, k: 'calls' | 'triangles') => Math.max(...list.map(f => f[k]));
    const e = near.data.exits.find(x => x.home)!;
    const nearFrames = [...frame(near, e.x, e.y - 1), ...frame(near, ...deepest(near))];
    const marshFrames = [...frame(marsh, home.x + 1, home.y), ...frame(marsh, ...deepest(marsh))];
    expect(most(marshFrames, 'calls')).toBeLessThanOrEqual(most(nearFrames, 'calls') * 1.12);
    expect(most(marshFrames, 'triangles')).toBeLessThanOrEqual(most(nearFrames, 'triangles') * 1.1);
  });
});
