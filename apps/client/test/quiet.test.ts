import { describe, expect, it } from 'vitest';
import { TileMap, type MapData, type PlayerView } from '@napoland/shared';
import { Game } from '../src/game';
import { refusalText } from '../src/items';
import { Maps } from '../src/maps';
import { fakePage, fakeRenderer } from './fakegl';
import { ITEMS, storyData, tinyTown, tinyWoods, welcome } from './fixtures';

fakePage();
const { WorldView } = await import('../src/view/world');

/** A little Quiet: a stone at 2,1 and the gap at 3,1, a figure at 1,3, the way home on the bottom row. */
const quiet = (): MapData => ({
  id: 'quiet', name: 'The Quiet', version: 1, kind: 'wilds', depth: 5, width: 5, height: 6,
  tiles: ['ttttt', 'tgggt', 'tgggt', 'tgggt', 'ttgtt', 'ttgtt'],
  levels: Array<string>(6).fill('00000'),
  spawn: { x: 2, y: 4, dir: 'up' },
  exits: [{ x: 2, y: 5, w: 1, h: 1, to: 'town', tx: 3, ty: 1, dir: 'down', home: true }],
  objects: [
    { kind: 'standing', x: 2, y: 1, text: ['Pecked into it: four on a line.'] },
    { kind: 'standing', x: 3, y: 1, text: ['Where a stone stood.'], gap: true },
    { kind: 'figure', x: 1, y: 3 },
  ],
  hush: true, forest: 'snow', rain: [],
});
const me = (x: number, y: number, dir: PlayerView['dir']): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir, color: '#d9a53a', gear: {}, quirks: [] });
function at(x: number, y: number, dir: PlayerView['dir']): Game {
  const g = new Game(new Maps([tinyTown(), tinyWoods(), quiet()]), () => {}, ITEMS, storyData());
  g.handle(welcome(quiet(), [me(x, y, dir)], undefined, { story: { version: storyData().version, chapter: 'home' } }), 1000);
  g.update(0, 1000);
  return g;
}
const read = (g: Game) => {
  g.pressA();
  const said = g.dialog && { who: g.dialog.who, lines: g.dialog.lines };
  while (g.dialog) g.pressB();
  return said;
};

describe('the Quiet, in the game', () => {
  it('reads a standing stone, and the gap where one stood, like signs from beside them', () => {
    expect(read(at(2, 2, 'up'))).toEqual({ who: 'A standing stone', lines: ['Pecked into it: four on a line.'] });
    expect(read(at(3, 2, 'up'))).toEqual({ who: 'The gap', lines: ['Where a stone stood.'] });
  });

  it('says why nothing said up there was said', () => {
    expect(refusalText('hushed', 'say')).toBe('Up here your words do not carry');
  });

  it('draws the stones, the gap and a figure that stands still, facing the gap, frame after frame', () => {
    const { renderer } = fakeRenderer();
    const view = new WorldView(renderer, new TileMap(quiet()));
    view.resize(390, 844);
    let t = 100;
    const frames = () => { for (let i = 0; i < 10; i++) view.render((t += 0.1), 0.1, { x: 2, y: 4 }, [], null, null); return renderer.info.render.triangles; };
    const drawn = frames();
    expect(drawn).toBeGreaterThan(0);
    expect(frames()).toBe(drawn);
    view.dispose();
    // Without its stones and figure the same map draws less.
    const empty = fakeRenderer().renderer, bare = new WorldView(empty, new TileMap({ ...quiet(), objects: [] }));
    bare.resize(390, 844);
    for (let i = 0; i < 10; i++) bare.render((t += 0.1), 0.1, { x: 2, y: 4 }, [], null, null);
    expect(empty.info.render.triangles).toBeLessThan(drawn);
    bare.dispose();
  });
});
