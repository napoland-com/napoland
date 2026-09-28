/**
 * Arriving on another map compiles no shader it already had: the new view is built before the old one
 * is freed (nextView), and the grass's material is one for the whole session, so its program is never
 * freed. The real WorldView and three.js's real renderer and program cache, over a WebGL context that
 * only counts what it is asked to make (fakegl.ts).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TileMap, type MapData } from '@napoland/shared';
import { fakePage, fakeRenderer } from './fakegl';

fakePage();
const { WorldView, nextView } = await import('../src/view/world');

const load = (id: string) => new TileMap(JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/maps', `${id}.json`), 'utf8')) as MapData);
const grassProgram = (r: THREE.WebGLRenderer) => (r.info.programs ?? []).find(p => p.cacheKey.includes('napoland-grass-1'));

describe('shaders on arriving somewhere', () => {
  it('compiles nothing the maps before already had: the grass program lives through every map, a room between two woods too', () => {
    const [town, woods, south, home, lodge] = ['stonebrook', 'near-woods', 'south-road', 'stonebrook-home', 'stonebrook-lodge'].map(load);
    const { renderer, counts } = fakeRenderer();
    let view = new WorldView(renderer, town!);
    const grass = grassProgram(renderer);
    expect(grass).toBeDefined();
    const trip = [woods!, south!, home!, town!, lodge!, woods!, town!];
    const compiled: Record<string, number> = {};
    // Once round every kind of place: what each needs that none before did is compiled then.
    for (const map of trip) view = nextView(renderer, view, map);
    // Round again: everything is compiled already.
    for (const map of trip) {
      const before = counts.programs;
      view = nextView(renderer, view, map);
      compiled[map.data.id] = (compiled[map.data.id] ?? 0) + counts.programs - before;
      expect(grassProgram(renderer), `the grass program after arriving in ${map.data.id}`).toBe(grass);
    }
    expect(compiled).toEqual({ 'near-woods': 0, 'south-road': 0, 'stonebrook-home': 0, stonebrook: 0, 'stonebrook-lodge': 0 });
    // And it stays so: what is kept for that does not grow with every arrival.
    const alive = renderer.info.programs!.length;
    for (let round = 0; round < 3; round++) for (const map of trip) view = nextView(renderer, view, map);
    expect(renderer.info.programs!.length).toBe(alive);
    view.dispose();
  });
});
