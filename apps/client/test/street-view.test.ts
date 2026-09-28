/**
 * Residents' Lane as the world view draws it: thirty kept cabins, each window dark until its owner is at
 * home (WorldView.setLots), and none of that anywhere else. The real WorldView over a WebGL context that
 * draws nothing (fakegl.ts).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TileMap, lotDoors, type MapData } from '@napoland/shared';
import { fakePage, fakeRenderer } from './fakegl';

fakePage();
const { WorldView } = await import('../src/view/world');

const read = (id: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/maps', `${id}.json`), 'utf8')) as MapData;
const content = new Map(['residents-lane', 'stonebrook', 'stonebrook-home'].map(id => [id, read(id)]));

describe('the street, drawn', () => {
  it('has a lit window for each lot whose owner is home, and only while they are', () => {
    const lane = content.get('residents-lane')!;
    const { renderer } = fakeRenderer();
    const view = new WorldView(renderer, new TileMap(lane), id => content.get(id));
    expect(view.lots).toBe(lotDoors(lane).length);
    expect(view.lotsLit()).toEqual([]);
    view.setLots(new Set([0, 12, 29]));
    expect(view.lotsLit()).toEqual([0, 12, 29]);
    view.setLots(new Set([12]));
    expect(view.lotsLit()).toEqual([12]);
    // A lot the street does not have lights nothing.
    view.setLots(new Set([30]));
    expect(view.lotsLit()).toEqual([]);
    view.dispose();
  });

  it('draws no lots anywhere else: the town has houses, none of them anyone\'s lot', () => {
    const { renderer } = fakeRenderer();
    const view = new WorldView(renderer, new TileMap(content.get('stonebrook')!), id => content.get(id));
    expect(view.lots).toBe(0);
    view.setLots(new Set([0]));
    expect(view.lotsLit()).toEqual([]);
    view.dispose();
  });
});
