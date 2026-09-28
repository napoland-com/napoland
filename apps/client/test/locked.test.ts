/**
 * Places you can see but not reach yet (roadmap/locked-places.md), as your own game has them: it paths and
 * predicts your steps with what your tools open (the culvert in waders, the shed's door with bolt
 * cutters), as the server checks them, and a padlocked door you cannot open says why. The paper map draws
 * the culvert as a dashed line, "flooded", and the shed under its lean-to.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { TileMap, type ClientMsg, type ItemsData, type MapData, type PlayerView } from '@napoland/shared';
import { Game } from '../src/game';
import { Items } from '../src/items';
import { Maps } from '../src/maps';
import { culvertRuns, sketchOf } from '../src/papermap';
import { culvertMouths } from '../src/view/left';
import { welcome } from './fixtures';

/**
 *     012345678
 *   0 ttttttttt
 *   1 tgcccgSSt   c: the culvert, (2,1) to (4,1); S: a shed, (6,1) 2 by 2
 *   2 tgtttgSDt   D: its door (7,2), padlocked: bolt cutters open it
 *   3 tgtttgggt
 *   4 tgggggggt
 *   5 tttmmtttt   the way home
 */
function woods(): MapData {
  return {
    id: 'woods', name: 'Woods', version: 1, kind: 'wilds', depth: 1, width: 9, height: 6,
    tiles: ['ttttttttt', 'tgcccgggt', 'tgtttgggt', 'tgtttgggt', 'tgggggggt', 'tttmmtttt'],
    levels: Array<string>(6).fill('000000000'),
    spawn: { x: 5, y: 4, dir: 'up' },
    exits: [
      { x: 3, y: 5, w: 2, h: 1, to: 'town', tx: 0, ty: 0, dir: 'down', home: true },
      { x: 7, y: 2, w: 1, h: 1, to: 'shed', tx: 1, ty: 1, dir: 'up', lock: 'bolt-cutters' },
    ],
    objects: [{ kind: 'house', x: 6, y: 1, w: 2, h: 2, roof: '#4c5646', lit: 0, style: 'shed' }],
  };
}
const DATA: ItemsData = {
  version: 1, finds: [],
  items: [
    { id: 'bolt-cutters', name: 'Bolt cutters', kind: 'tool', stack: 1, icon: 'cutters', text: 'They cut.' },
    { id: 'waders', name: 'Waders', kind: 'tool', stack: 1, icon: 'waders', text: 'They wade.' },
  ],
};
const items = new Items(DATA);
const maps = new Maps([woods()]);
const at = (x: number, y: number, dir: PlayerView['dir']): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir, color: '#d9a53a', gear: {}, quirks: [] });

let sent: ClientMsg[];
let now: number;
function play(me: PlayerView, tools: string[]): Game {
  const g = new Game(maps, m => sent.push(m), items);
  g.handle(welcome(woods(), [me], undefined, { tools, items: DATA.version }), now);
  return g;
}
function run(g: Game, ms: number) {
  for (let t = 0; t < ms; t += 1000 / 60) { now += 1000 / 60; g.update(1 / 60, now); }
}
/** Steps sent, each confirmed at once, so the walk goes on as far as it goes. */
function walk(g: Game, ms: number) {
  for (let t = 0; t < ms; t += 50) {
    run(g, 50);
    for (const m of sent.splice(0)) if (m.t === 'step') { const me = g.me!; g.handle({ t: 'step', id: 'me', x: me.tx, y: me.ty, dir: m.dir, seq: m.seq }, now); walked.push(m.dir); }
  }
}
let walked: string[];
const note = (g: Game) => g.noteView(now)?.text;
const PADLOCK = 'A padlock, rusted shut. Bolt cutters would do it.';

beforeEach(() => {
  sent = [];
  walked = [];
  now = 1000;
});

describe('your own game and the culvert', () => {
  it('walks a tap round the culvert without waders, and through it in them, as the server would take it', () => {
    const round = play(at(1, 1, 'right'), []);
    round.tapTile(5, 1);
    walk(round, 3000);
    expect(walked).toEqual(['down', 'down', 'down', 'right', 'right', 'right', 'right', 'up', 'up', 'up']);
    expect(round.me).toMatchObject({ tx: 5, ty: 1 });

    walked = [];
    const through = play(at(1, 1, 'right'), ['waders']);
    through.tapTile(5, 1);
    walk(through, 3000);
    expect(walked).toEqual(['right', 'right', 'right', 'right']);
  });

  it('never steps into it without waders: pushing against it only turns you, and says nothing', () => {
    const g = play(at(1, 1, 'down'), []);
    g.padChange('right', now);
    run(g, 600);
    expect(sent.filter(m => m.t === 'step')).toEqual([]);
    expect(g.me!.dir).toBe('right');
    expect(note(g)).toBeUndefined();
  });

  it('steps into it in waders, and the tools the server sends open it at once', () => {
    const g = play(at(1, 1, 'right'), []);
    g.handle({ t: 'tools', tools: ['waders'] }, now);
    expect(g.pass.has('waders')).toBe(true);
    g.padChange('right', now);
    run(g, 50);
    expect(sent.filter(m => m.t === 'step')).toEqual([{ t: 'step', dir: 'right', seq: 1 }]);
  });
});

describe('your own game and a padlocked door', () => {
  it('says why it stays shut as you walk into it, once for each push', () => {
    const g = play(at(7, 3, 'up'), []);
    g.padChange('up', now);
    run(g, 500);
    expect(sent.filter(m => m.t === 'step')).toEqual([]);
    expect(note(g)).toBe(PADLOCK);
    const shown = g.boxChanges;
    run(g, 500);
    expect(g.boxChanges).toBe(shown);
  });

  it('says it for A as you face it, and for a tap on the shed, walking up to it first', () => {
    const facing = play(at(7, 3, 'up'), []);
    facing.pressA();
    expect(note(facing)).toBe(PADLOCK);

    const tapped = play(at(5, 4, 'up'), []);
    tapped.tapTile(7, 1);
    walk(tapped, 2000);
    expect(tapped.me).toMatchObject({ tx: 7, ty: 3, dir: 'up' });
    expect(note(tapped)).toBe(PADLOCK);
  });

  it('says it when the server keeps you from it', () => {
    const g = play(at(7, 3, 'up'), []);
    g.handle({ t: 'refused', action: 'step', reason: 'padlocked' }, now);
    expect(note(g)).toBe(PADLOCK);
  });

  it('lets whoever carries bolt cutters walk in, by the stick or a tap, and says nothing', () => {
    const g = play(at(7, 3, 'up'), ['bolt-cutters']);
    g.padChange('up', now);
    run(g, 50);
    expect(sent.filter(m => m.t === 'step')).toEqual([{ t: 'step', dir: 'up', seq: 1 }]);
    expect(note(g)).toBeUndefined();

    sent = [];
    const tapped = play(at(5, 4, 'up'), ['bolt-cutters']);
    tapped.tapTile(7, 2);
    walk(tapped, 2000);
    expect(walked.at(-1)).toBe('up');
    expect(tapped.me).toMatchObject({ tx: 7, ty: 2 });
  });
});

describe('the paper map', () => {
  it('draws the culvert as a dashed line from mouth to mouth, "flooded" beside it, and the shed under its lean-to', () => {
    const s = sketchOf(new TileMap(woods()), () => undefined);
    expect(s.culverts).toEqual([[[2.5, 1.5], [3.5, 1.5], [4.5, 1.5]]]);
    expect(s.labels.map(l => l.text)).toContain('flooded');
    expect(s.houses).toEqual([expect.objectContaining({ w: 2, h: 2, shed: true })]);
  });

  it('draws the Near Woods\' culvert whole, from by the bog to the headlight clearing', () => {
    const runs = culvertRuns(new TileMap(nearWoods()));
    expect(runs).toHaveLength(1);
    const [a, b] = [runs[0]![0]!, runs[0]!.at(-1)!].sort((p, q) => p[1] - q[1]);
    expect(a![1]).toBeLessThan(35);
    expect(b![1]).toBeGreaterThan(55);
  });
});

describe('the culvert in the world', () => {
  it('has a mouth at each end, facing the ground it opens onto: north to the bog, west into the clearing', () => {
    expect(culvertMouths(new TileMap(woods()))).toEqual([{ x: 2, y: 1, dir: 'left' }, { x: 4, y: 1, dir: 'right' }]);
    const mouths = culvertMouths(new TileMap(nearWoods()));
    expect(mouths.map(m => m.dir)).toEqual(['up', 'left']);
  });
});

function nearWoods(): MapData {
  return JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/maps/near-woods.json'), 'utf8')) as MapData;
}
