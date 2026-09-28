/**
 * Where the figure at the edge of the fog may be seen: the view says how far out on the screen a tile is, and
 * a tile whose figure the HUD would hide (the status panel, the buttons, the stick) counts as not seen at all.
 * The real WorldView over a WebGL context that draws nothing (fakegl.ts).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TileMap, type MapData } from '@napoland/shared';
import { fakePage, fakeRenderer } from './fakegl';

fakePage();
const { WorldView } = await import('../src/view/world');

const read = (id: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../content/maps/${id}.json`), 'utf8')) as MapData;
const near = new TileMap(read('near-woods'));

describe('the figure at the edge of the fog, on the screen', () => {
  const { renderer } = fakeRenderer();
  const view = new WorldView(renderer, near, () => undefined);
  const x = 30, y = 50;
  view.resize(390, 844);
  view.render(1, 0.016, { x, y }, [], null, null);

  it('is seen near the edge a few tiles north, and nowhere the HUD covers', () => {
    const north = view.edgeOf(x, y - 8);
    expect(north).not.toBeNull();
    expect(north!).toBeGreaterThan(0.3);
    // Everything covered: never seen.
    expect(view.edgeOf(x, y - 8, () => true)).toBeNull();
    // Only the top quarter of the screen covered (the status panel's and the buttons' row): a tile seen up
    // there is not seen, one lower down still is.
    const top = (_px: number, py: number) => py < 844 / 4;
    const far = view.edgeOf(x, y - 12, top), near2 = view.edgeOf(x + 4, y, top);
    expect(far).toBeNull();
    expect(near2).not.toBeNull();
  });
});
