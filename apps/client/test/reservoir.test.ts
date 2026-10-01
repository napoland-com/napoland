import { describe, expect, it } from 'vitest';
import { TileMap, type MapData, type PlayerView } from '@napoland/shared';
import { Game, agnesOnTheWater, type News } from '../src/game';
import { Maps } from '../src/maps';
import { newsBanner } from '../src/status';
import { fakePage, fakeRenderer } from './fakegl';
import { ITEMS, storyData, tinyTown, tinyWoods, welcome } from './fixtures';

fakePage();
const { WorldView } = await import('../src/view/world');

/**
 * A little reservoir: its bed is the water at 2,1 and 2,2, with the Sister standing at 2,1, and Agnes on the
 * shore at 1,3. The lake is down for the first 120 s of every 600 (the last 30 with the water coming back).
 */
const reservoir = (): MapData => ({
  id: 'reservoir', name: 'The Reservoir', version: 1, kind: 'wilds', depth: 2, width: 5, height: 6,
  tiles: ['ttttt', 'tgwgt', 'tgwgt', 'tgggt', 'ttgtt', 'ttgtt'],
  levels: Array<string>(6).fill('00000'),
  spawn: { x: 2, y: 4, dir: 'up' },
  exits: [{ x: 2, y: 5, w: 1, h: 1, to: 'town', tx: 3, ty: 1, dir: 'down', home: true }],
  objects: [
    { kind: 'sister', x: 2, y: 1, text: ['Two stood here before the water.'] },
    { kind: 'npc', x: 1, y: 3, id: 'agnes', name: 'Agnes', dir: 'right', lines: ['I keep the dam.'] },
  ],
  drawdown: { name: 'the reservoir', tiles: [[2, 1], [2, 2]], every: 600, down: 120, warn: 30 },
});
const me = (x: number, y: number, dir: PlayerView['dir']): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir, color: '#d9a53a', gear: {}, quirks: [] });
const maps = () => new Maps([tinyTown(), tinyWoods(), reservoir()]);

/** A game standing at x,y on `map`, welcomed at our 1000 ms with the world's clock at `clock` (so at our 1000 + t the lake's clock reads clock + t). */
function at(map: MapData, x: number, y: number, dir: PlayerView['dir'], clock: number): Game {
  const g = new Game(maps(), () => {}, ITEMS, storyData());
  g.handle(welcome(map, [me(x, y, dir)], undefined, { clock, story: { version: storyData().version, chapter: 'home' } }), 1000);
  g.update(0, 1000);
  return g;
}
/** The lake's news since the last look. */
const lakeNews = (g: Game, now: number) => g.takeNews(now).filter((n): n is Extract<News, { kind: 'lake' }> => n.kind === 'lake');
const read = (g: Game) => {
  g.pressA();
  const said = g.dialog && { who: g.dialog.who, lines: g.dialog.lines };
  while (g.dialog) g.pressB();
  return said;
};

describe('a lake that draws down, in the game', () => {
  it('lets you walk on its bed only while it is drawn down, by the world clock the server counts by', () => {
    const g = at(reservoir(), 2, 3, 'up', 200_000);
    expect(g.drawdownNow()?.phase).toBe('full');
    expect(g.map.walkable(2, 2)).toBe(false);
    // The next round: the water draws back.
    g.update(0, 1000 + 401_000);
    expect(g.drawdownNow()?.phase).toBe('down');
    expect(g.map.walkable(2, 2)).toBe(true);
    // Still walked on while the water is coming back; lake again once it is back.
    g.update(0, 1000 + 400_000 + 100_000);
    expect(g.map.walkable(2, 2)).toBe(true);
    g.update(0, 1000 + 400_000 + 121_000);
    expect(g.map.walkable(2, 2)).toBe(false);
  });

  it('says when the water draws back and when it is coming back, once each round, and nothing on arriving', () => {
    const g = at(reservoir(), 2, 3, 'up', 10_000); // down
    expect(lakeNews(g, 1000)).toEqual([]);
    g.update(0, 1000 + 190_000); // full
    expect(lakeNews(g, 0)).toEqual([]);
    g.update(0, 1000 + 591_000); // the next round, down
    g.update(0, 1000 + 592_000);
    expect(lakeNews(g, 0)).toEqual([{ kind: 'lake', phase: 'down', left: 89 }]);
    g.update(0, 1000 + 685_000); // warn, 25 s left
    g.update(0, 1000 + 686_000);
    const warn = lakeNews(g, 0);
    expect(warn).toEqual([{ kind: 'lake', phase: 'warn', left: 25 }]);
    expect(newsBanner(warn[0]!, 'The Reservoir')).toEqual({ title: 'The water is coming back', sub: '25 seconds left.\nGet off the lakebed.' });
    g.update(0, 1000 + 720_000); // full again: no word of that
    expect(lakeNews(g, 0)).toEqual([]);
  });

  it('says nothing of it on another map', () => {
    const g = at(tinyWoods(), 2, 3, 'up', 10_000);
    for (const t of [100_000, 591_000, 685_000, 720_000]) g.update(0, 1000 + t);
    expect(lakeNews(g, 0)).toEqual([]);
  });

  it('says the water carried you ashore when the server moves you (seq 0) off the bed as it fills, once a round', () => {
    // 2 s of warning left by our clock, on the bed: the server's says full already.
    const g = at(reservoir(), 2, 2, 'up', 118_000);
    lakeNews(g, 0);
    g.handle({ t: 'reject', seq: 0, x: 2, y: 3, dir: 'down' }, 1000);
    const carried = lakeNews(g, 0);
    expect(carried).toEqual([{ kind: 'lake', phase: 'carried', left: 0 }]);
    expect(newsBanner(carried[0]!, 'The Reservoir')).toEqual({ title: 'The water carried you ashore', sub: 'You are soaked.' });
    expect(g.me).toMatchObject({ tx: 2, ty: 3 });
    g.handle({ t: 'reject', seq: 0, x: 2, y: 3, dir: 'down' }, 1000);
    expect(lakeNews(g, 0)).toEqual([]);
  });

  it('does not take a step of yours refused off the bed for being carried ashore', () => {
    const g = at(reservoir(), 2, 2, 'up', 118_000);
    g.handle({ t: 'reject', seq: 1, x: 2, y: 3, dir: 'down' }, 1000);
    expect(lakeNews(g, 0)).toEqual([]);
  });

  it('has Agnes say first when the water goes down next, or how long it stays down', () => {
    expect(read(at(reservoir(), 2, 3, 'left', 600_000 - 8 * 60_000))?.lines).toEqual(['The water goes down in about 8 minutes.', 'I keep the dam.']);
    expect(read(at(reservoir(), 2, 3, 'left', 0))?.lines[0]).toBe("It's down now. Mind the time: it comes back in 2 minutes.");
    expect(agnesOnTheWater({ phase: 'warn', left: 14.2 }, 30)).toBe("It's coming back now, in 15 seconds. Get off the bed.");
    expect(agnesOnTheWater({ phase: 'full', left: 20 }, 30)).toBe('The water goes down any moment now. Watch the bed.');
  });

  it('reads the Sister like a sign from beside her, standing on the bed', () => {
    const g = at(reservoir(), 2, 2, 'up', 0);
    expect(read(g)).toEqual({ who: 'The Sister', lines: ['Two stood here before the water.'] });
  });
});

describe('a lake that draws down, drawn', () => {
  it('shows what stands on its bed (the Sister, a stump) only once the water has gone down past it, and hides it as it comes back', () => {
    const data = reservoir();
    data.objects.push({ kind: 'stump', x: 2, y: 2, s: 1, v: 0.3 });
    const { renderer } = fakeRenderer();
    const view = new WorldView(renderer, new TileMap(data));
    view.resize(390, 844);
    let t = 100;
    const triangles = () => {
      // A few seconds of frames: the water gets where its clock has it.
      for (let i = 0; i < 40; i++) view.render((t += 0.1), 0.1, { x: 2, y: 3 }, [], null, null);
      return renderer.info.render.triangles;
    };
    view.setDrained(false);
    const full = triangles();
    view.setDrained(true);
    const down = triangles();
    expect(down).toBeGreaterThan(full);
    view.setDrained(false);
    expect(triangles()).toBe(full);
    view.dispose();
  });
});
