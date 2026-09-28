/**
 * The Burn in the client, without a page: A at NAPO's gate (it pulls, and says it will not move for one), the
 * map button there (its map is found, not given), how a burnt forest looks, and what drawing it costs: the real
 * WorldView over a WebGL context that draws nothing (fakegl.ts), against the Near Woods'.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STARTER_TOOLS, TileMap, type ClientMsg, type ItemsData, type MapData, type MapObject, type PlayerView } from '@napoland/shared';
import { GATE_PULLED, Game } from '../src/game';
import { Items } from '../src/items';
import { Maps } from '../src/maps';
import { mapFor, sketchOf } from '../src/papermap';
import { gateModel } from '../src/view/napo';
import { fakePage, fakeRenderer } from './fakegl';
import { welcome } from './fixtures';

fakePage();
const { WorldView } = await import('../src/view/world');

const content = resolve(import.meta.dirname, '../../../content');
const all = readdirSync(resolve(content, 'maps')).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(resolve(content, 'maps', f), 'utf8')) as MapData);
const find = (id: string) => all.find(m => m.id === id);
const items = new Items(JSON.parse(readFileSync(resolve(content, 'items.json'), 'utf8')) as ItemsData);
const burn = new TileMap(find('burn')!), near = new TileMap(find('near-woods')!), far = find('far-woods')!;
const gate = far.objects.find((o): o is Extract<MapObject, { kind: 'gate' }> => o.kind === 'gate')!;

describe('NAPO\'s gate', () => {
  it('is pulled at with A from below it: the text box says it will not move for one, then its plate, and the server hears the pull', () => {
    const sent: ClientMsg[] = [];
    const me: PlayerView = { id: 'me', name: 'Aldo', x: gate.x + 1, y: gate.y + 1, dir: 'up', color: '#f29e4c', gear: {}, quirks: [] };
    const g = new Game(new Maps(all), m => sent.push(m), items);
    g.handle(welcome(far, [me], undefined, { tools: [...STARTER_TOOLS], items: items.version }), 1000);
    g.pressA();
    expect(g.dialog).toMatchObject({ who: 'NAPO gate', lines: [GATE_PULLED, ...gate.text] });
    expect(sent).toContainEqual({ t: 'talk', x: gate.x + 1, y: gate.y });
  });

  it('is drawn: its posts, the gate between them, and a handle for each who pulls', () => {
    expect(gateModel(gate).children.length).toBeGreaterThan(gate.w * 3);
  });
});

describe('the map button in the Burn', () => {
  const chartOf = (t: string) => items.get(t).chart;
  it('opens no map until you have found the Burn\'s own, then that one, in the line cabin too', () => {
    expect(mapFor('burn', [...STARTER_TOOLS], chartOf, find)).toBeUndefined();
    expect(mapFor('burn', [...STARTER_TOOLS, 'burn-map'], chartOf, find)).toBe('burn-map');
    expect(mapFor('burn-line-cabin', [...STARTER_TOOLS, 'burn-map'], chartOf, find)).toBe('burn-map');
  });

  it('draws a paper map of it, with its places written in', () => {
    const s = sketchOf(burn, id => find(id)?.name);
    expect(s.title).toBe('The Burn');
    expect(s.labels.map(l => l.text)).toEqual(expect.arrayContaining(['the scar', 'the black creek']));
  });
});

describe('what the Burn costs to draw', () => {
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

  it('stays near what the Near Woods cost, at the way in and at the scar: the snags are the same instanced firs, tinted and thinned', () => {
    const most = (list: Array<{ calls: number; triangles: number }>, k: 'calls' | 'triangles') => Math.max(...list.map(f => f[k]));
    const nearFrames = [...frame(near, ...entrance(near)), ...frame(near, ...deepest(near))];
    const burnFrames = [...frame(burn, ...entrance(burn)), ...frame(burn, ...deepest(burn))];
    // Within 12% of the Near Woods' calls: the fog culling that came with the fire lookout (blocks wholly in the
    // fog are not drawn) took the Near Woods from 78 calls at most to 69, and the Burn from 81 to 76.
    expect(most(burnFrames, 'calls')).toBeLessThanOrEqual(most(nearFrames, 'calls') * 1.12);
    expect(most(burnFrames, 'triangles')).toBeLessThanOrEqual(most(nearFrames, 'triangles') * 1.1);
  });
});
