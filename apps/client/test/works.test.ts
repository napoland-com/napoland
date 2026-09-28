/**
 * Mending the woods together (roadmap/trail-works.md) as your own game has it: what the text box asks and
 * says at a footbridge or a street light being mended, the footbridge walked and pathed over only while
 * it stands (as the server takes it), the surge a lit street light keeps off, the paper map, and the view,
 * which shows each place whole or broken without compiling anything.
 *
 *     012345678
 *   0 ttttttttt
 *   1 tggggwggt   w: a creek down column 5; over it at 5,2 the footbridge (creek-bridge)
 *   2 tggggwgLt   L: the street light (7,2), creek-light
 *   3 tggggwggt
 *   4 tgggggggt   the ford, the long way round
 *   5 tttmmtttt   the way home
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { FEED_MAX, TileMap, type ClientMsg, type Did, type ItemsData, type MapData, type PlayerView, type WorksView } from '@napoland/shared';
import { Game } from '../src/game';
import { Items, refusalText } from '../src/items';
import { Maps } from '../src/maps';
import { sketchOf } from '../src/papermap';
import { didText, didWho, bringQuestion, nothingToGive, worksText, worksWho } from '../src/said';
import { fakePage, fakeRenderer } from './fakegl';
import { welcome } from './fixtures';

fakePage();
const { WorldView } = await import('../src/view/world');

function woods(): MapData {
  return {
    id: 'woods', name: 'Woods', version: 1, kind: 'wilds', depth: 1, width: 9, height: 6,
    tiles: ['ttttttttt', 'tggggwggt', 'tggggwggt', 'tggggwggt', 'tgggggggt', 'tttmmtttt'],
    levels: Array<string>(6).fill('000000000'),
    spawn: { x: 4, y: 4, dir: 'up' },
    exits: [{ x: 3, y: 5, w: 2, h: 1, to: 'town', tx: 0, ty: 0, dir: 'down', home: true }],
    objects: [{ kind: 'footbridge', id: 'creek-bridge', x: 5, y: 2, w: 1, h: 1 }, { kind: 'lamp', x: 7, y: 2, works: 'creek-light' }],
    surge: { every: 200, unstable: 20, surge: 40, sweep: 5 },
  };
}
const DATA: ItemsData = {
  version: 1, finds: [],
  items: [
    { id: 'scrap', name: 'Scrap metal', noun: 'scrap', plural: 'scrap', kind: 'resource', stack: 10, text: 'Rust.' },
    { id: 'wire', name: 'Copper wire', noun: 'wire', plural: 'wire', kind: 'resource', stack: 10, text: 'Copper.' },
    { id: 'moss', name: 'Moss', kind: 'resource', stack: 3, text: 'Damp.' },
  ],
  works: [
    { id: 'creek-bridge', build: 'footbridge', name: 'the footbridge', where: 'over the creek', item: 'scrap', need: 30, wear: 5, hold: 35 },
    { id: 'creek-light', build: 'light', name: 'the street light', where: 'by the creek', item: 'wire', need: 12, wear: 2, hold: 14 },
  ],
};
const items = new Items(DATA);
const BRIDGE = items.works.get('creek-bridge')!, LIGHT = items.works.get('creek-light')!, SCRAP = items.get('scrap'), WIRE = items.get('wire');
const maps = new Maps([woods()]);
const at = (x: number, y: number, dir: PlayerView['dir']): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir, color: '#d9a53a', gear: {}, quirks: [] });
const broken: WorksView[] = [{ id: 'creek-bridge', standing: false, held: 0 }, { id: 'creek-light', standing: false, held: 0 }];

let sent: ClientMsg[];
let now: number;
function play(me: PlayerView, works: WorksView[] = broken, bag: Array<{ item: string; count: number }> = [], more: object = {}): Game {
  const g = new Game(maps, m => sent.push(m), items);
  g.handle({ ...welcome(woods(), [me], undefined, { bag, items: DATA.version }), works, ...more }, now);
  return g;
}
function run(g: Game, ms: number) {
  for (let t = 0; t < ms; t += 1000 / 60) { now += 1000 / 60; g.update(1 / 60, now); }
}
/** Steps sent, each confirmed at once, so the walk goes on as far as it goes. */
function walk(g: Game, ms: number): string[] {
  const walked: string[] = [];
  for (let t = 0; t < ms; t += 50) {
    run(g, 50);
    for (const m of sent.splice(0)) if (m.t === 'step') { const me = g.me!; g.handle({ t: 'step', id: 'me', x: me.tx, y: me.ty, dir: m.dir, seq: m.seq }, now); walked.push(m.dir); }
  }
  return walked;
}
const note = (g: Game) => g.noteView(now)?.text;

beforeEach(() => {
  sent = [];
  now = 1000;
});

describe('what the text box says at a place being mended', () => {
  it('asks first what to give, by its name', () => {
    expect(bringQuestion(SCRAP, BRIDGE, 3)).toBe('Give 3 scrap to the footbridge?');
    expect(bringQuestion(SCRAP, BRIDGE, 1)).toBe('Give 1 scrap to the footbridge?');
    expect(bringQuestion(WIRE, LIGHT, 2)).toBe('Give 2 wire to the street light?');
    expect([worksWho(BRIDGE), worksWho(LIGHT)]).toEqual(['Footbridge', 'Street light']);
  });

  it('says how it stands, and whose name is on its plaque', () => {
    expect(worksText(BRIDGE, undefined, SCRAP)).toBe('The footbridge is broken: it stands again with 30 scrap. Its plaque is blank: nobody has given anything yet.');
    expect(worksText(BRIDGE, { id: BRIDGE.id, standing: false, held: 12, top: 'Ana' }, SCRAP))
      .toBe('The footbridge is broken: 12 of 30 scrap given, 18 more and it stands again. Its plaque: Ana gave the most.');
    expect(worksText(BRIDGE, { id: BRIDGE.id, standing: true, held: 18, top: 'Ana' }, SCRAP))
      .toBe('The footbridge stands. 18 scrap put by, enough for 3 more days (it takes 5 a day). Its plaque: Ana gave the most.');
    expect(worksText(BRIDGE, { id: BRIDGE.id, standing: true, held: 1, top: 'Ana' }, SCRAP))
      .toBe('The footbridge stands. It takes 5 scrap a day, and only 1 is put by: it will not last past today. Its plaque: Ana gave the most.');
    expect(worksText(LIGHT, { id: LIGHT.id, standing: false, held: 4, top: 'Bo' }, WIRE))
      .toBe('The street light is dark: 4 of 12 wire given, 8 more and it lights up again. Its plaque: Bo gave the most.');
    expect(worksText(LIGHT, { id: LIGHT.id, standing: true, held: 0, top: 'Bo' }, WIRE))
      .toBe('The street light is lit. It takes 2 wire a day, and none is put by: it will not last past today. Its plaque: Bo gave the most.');
    expect(nothingToGive(SCRAP)).toBe('You have no scrap to give it.');
  });

  it('says what giving did, from the server\'s answer', () => {
    const gave = (count: number, view: Omit<WorksView, 'id'>, built?: true): Did => ({ kind: 'brought', works: 'creek-bridge', item: 'scrap', count, view: { id: 'creek-bridge', ...view }, ...(built ? { built } : {}) });
    expect(didWho(gave(3, { standing: false, held: 15 }), items)).toBe('Footbridge');
    expect(didText(gave(3, { standing: false, held: 15 }), items)).toBe('You give 3 scrap to the footbridge: 15 of 30, 15 more and it stands again.');
    expect(didText(gave(8, { standing: true, held: 3 }, true), items)).toBe('You give 8 scrap to the footbridge, and it stands again! It takes 5 scrap a day, and only 3 are put by: it will not last past today.');
    expect(didText(gave(10, { standing: true, held: 13 }), items)).toBe('You give 10 scrap to the footbridge. 13 scrap put by, enough for 2 more days (it takes 5 a day).');
    expect(didText({ kind: 'brought', works: 'creek-light', item: 'wire', count: 12, view: { id: 'creek-light', standing: true, held: 0 }, built: true }, items))
      .toBe('You give 12 wire to the street light, and it lights up again! It takes 2 wire a day, and none is put by: it will not last past today.');
    expect([refusalText('not_wanted', 'bring'), refusalText('works_full', 'bring')]).toEqual(['It takes something else', 'It has all it can keep for now']);
  });
});

describe('your own game at a place being mended', () => {
  it('asks first to give what it takes, up to what you carry and what it has room for; yes gives it, no says how it stands', () => {
    const g = play(at(4, 2, 'right'), broken, [{ item: 'moss', count: 1 }, { item: 'scrap', count: 10 }, { item: 'scrap', count: 4 }]);
    g.pressA();
    expect(g.askView()).toMatchObject({ who: 'Footbridge', text: 'Give 1 scrap to the footbridge?', count: expect.objectContaining({ n: 1, max: 14 }) });
    g.answer('yes');
    expect(sent).toEqual([{ t: 'bring', x: 5, y: 2, slot: 1 }]);
    g.handle({ t: 'did', did: { kind: 'brought', works: 'creek-bridge', item: 'scrap', count: 1, view: { id: 'creek-bridge', standing: false, held: 1, top: 'Aldo' } } }, now);
    expect(note(g)).toBe('You give 1 scrap to the footbridge: 1 of 30, 29 more and it stands again.');

    const no = play(at(4, 2, 'right'), [{ id: 'creek-bridge', standing: false, held: 12, top: 'Ana' }], [{ item: 'scrap', count: 40 }]);
    no.pressA();
    // What it takes, at most: 18 to stand again and 35 put by, and never more than FEED_MAX at once.
    expect(no.askView()?.count).toMatchObject({ max: Math.min(40, 53, FEED_MAX) });
    no.answer('no');
    expect(note(no)).toBe('The footbridge is broken: 12 of 30 scrap given, 18 more and it stands again. Its plaque: Ana gave the most.');
    expect(sent.filter(m => m.t === 'bring')).toEqual([{ t: 'bring', x: 5, y: 2, slot: 1 }]);
  });

  it('says how it stands, and why you give nothing, when you carry none of what it takes, or it has all it keeps', () => {
    const none = play(at(6, 2, 'right'), broken, [{ item: 'scrap', count: 5 }]);
    none.pressA();
    expect(none.askView()).toBeNull();
    expect(note(none)).toBe('The street light is dark: it lights up again with 12 wire. Its plaque is blank: nobody has given anything yet. You have no wire to give it.');
    const full = play(at(4, 2, 'right'), [{ id: 'creek-bridge', standing: true, held: 35, top: 'Ana' }], [{ item: 'scrap', count: 5 }]);
    full.pressA();
    expect(note(full)).toBe('The footbridge stands. 35 scrap put by, enough for 7 more days (it takes 5 a day). Its plaque: Ana gave the most. It has all it can keep for now.');
  });

  it('walks over a footbridge only while it stands, as the server takes it, and a tap on it walks there; broken, round by the ford', () => {
    const round = play(at(4, 2, 'right'));
    round.tapTile(6, 2);
    expect(walk(round, 4000)).toEqual(['down', 'down', 'right', 'right', 'up', 'up']);
    const over = play(at(4, 2, 'right'), [{ id: 'creek-bridge', standing: true, held: 5 }]);
    expect(over.pass.has('creek-bridge')).toBe(true);
    over.tapTile(5, 2);
    expect(walk(over, 1000)).toEqual(['right']);
    // It breaks: the server says so, and from the next step the creek is water again.
    over.handle({ t: 'works', works: { id: 'creek-bridge', standing: false, held: 0 } }, now);
    expect(over.pass.has('creek-bridge')).toBe(false);
    expect(over.map.walkable(5, 2, over.pass)).toBe(false);
  });

  it('knows a lit street light keeps a surge off whoever stands in its light, as the server counts it; dark, it does not', () => {
    // Swept: the whole map is in it.
    const surge = { phase: 'surge' as const, left: 30, into: 10 };
    const dark = play(at(6, 1, 'up'), broken, [], { surge });
    expect(dark.caught(now)).toBe(true);
    const lit = play(at(6, 1, 'up'), [{ id: 'creek-light', standing: true, held: 0 }], [], { surge });
    expect(lit.caught(now)).toBe(false);
  });
});

describe('the paper map, and the view', () => {
  it('draws a footbridge from bank to bank, whole or broken alike', () => {
    expect(sketchOf(new TileMap(woods()), () => undefined).footbridges).toEqual([[[4.8, 2.5], [6.2, 2.5]]]);
  });

  it('shows each place whole or broken, lit or dark, as it stands, and compiles nothing for it', () => {
    const near = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/maps/near-woods.json'), 'utf8')) as MapData;
    const { renderer, counts } = fakeRenderer();
    const view = new WorldView(renderer, new TileMap(near));
    view.resize(390, 844);
    const frame = (t: number) => view.render(t, 0.1, { x: 18, y: 42 }, [{ id: 'me', x: 18, y: 42, dir: 'up', moving: false, phase: 0, color: '#d9a53a', turnT: 0 }], 'me', null);
    const inner = view as unknown as { bridges: Array<{ id: string; whole: { visible: boolean }; broken: { visible: boolean } }>; worksLamps: Array<{ id: string; on: boolean }> };
    view.setWorks(new Set());
    frame(0);
    const programs = counts.programs;
    expect(inner.bridges.map(b => [b.id, b.whole.visible, b.broken.visible])).toEqual([['pond-footbridge', false, true]]);
    expect(inner.worksLamps.map(l => [l.id, l.on])).toEqual([['pond-light', false]]);
    view.setWorks(new Set(['pond-footbridge', 'pond-light']));
    frame(0.1);
    expect(inner.bridges.map(b => [b.whole.visible, b.broken.visible])).toEqual([[true, false]]);
    expect(inner.worksLamps.map(l => l.on)).toEqual([true]);
    view.setWorks(new Set());
    frame(0.2);
    expect(counts.programs).toBe(programs);
    view.dispose();
  });
});
