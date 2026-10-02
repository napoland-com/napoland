/**
 * The Turning as it ships (roadmap/the-turning.md, docs/DESIGN.md): a region at depth 2 west of the Near Woods'
 * ring of stones. Three clearings that look the same, where every way out but one puts you back by the ring; the
 * ranger's directions, which name each clearing's clue; and her camp past the third, its fire always in.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TileMap, notesOf, type MapData, type MapExit, type MapObject } from '@napoland/shared';
import { NEAR_WOODS_BACK, NEAR_WOODS_MOUTH, TURNING_ENTRY } from '../turning-mouth';

const content = resolve(import.meta.dirname, '../../content');
const maps = new Map(readdirSync(resolve(content, 'maps')).filter(f => f.endsWith('.json')).map(f => {
  const data = JSON.parse(readFileSync(resolve(content, 'maps', f), 'utf8')) as MapData;
  return [data.id, new TileMap(data)] as const;
}));
const near = maps.get('near-woods')!, camp = maps.get('turning-camp')!, hut = maps.get('turning-camp-hut')!;
const clearings = ['turning', 'turning-2', 'turning-3'].map(id => maps.get(id)!);
type Side = 'up' | 'left' | 'down' | 'right';
/** Which side of its map an exit is on. */
const sideOf = (m: TileMap, e: MapExit): Side => (e.y === 0 ? 'up' : e.x === 0 ? 'left' : e.y === m.height - 1 ? 'down' : 'right');
const onward = (m: TileMap) => m.data.exits.filter(e => e.to !== 'near-woods');
const objects = <K extends MapObject['kind']>(m: TileMap, kind: K) => m.data.objects.filter((o): o is Extract<MapObject, { kind: K }> => o.kind === kind);

describe('the Turning, where it is', () => {
  it('is reached by a path west out of the Near Woods\' ring of stones, the only way into it from outside it', () => {
    const mouth = near.data.exits.find(e => e.to === 'turning')!;
    expect(mouth).toMatchObject({ x: NEAR_WOODS_MOUTH.x, y: NEAR_WOODS_MOUTH.y, tx: TURNING_ENTRY.x, ty: TURNING_ENTRY.y });
    const ring = near.data.places!.find(p => p.name === 'ring of stones')!;
    expect(Math.abs(mouth.x - ring.x) + Math.abs(mouth.y - ring.y)).toBeLessThanOrEqual(8);
    const into = [...maps.values()].filter(m => !m.data.id.startsWith('turning') && m.data.exits.some(e => e.to.startsWith('turning'))).map(m => m.data.id);
    expect(into).toEqual(['near-woods']);
    // The ranger's board by the mouth says what the wood does.
    expect(objects(near, 'sign').find(s => s.x === NEAR_WOODS_BACK.x && s.y === NEAR_WOODS_BACK.y - 1)!.text.join(' ')).toMatch(/turns you round/);
  });

  it('is three clearings and a camp, all called the Turning, at depth 2, in old firs', () => {
    for (const m of [...clearings, camp]) expect(m.data).toMatchObject({ name: 'The Turning', kind: 'wilds', depth: 2, forest: 'old' });
  });
});

describe('the clearings, which look the same', () => {
  it('are the same tile for tile but for a clue or two (the spring and its brook in the first), the same size, with one watcher each', () => {
    const [a, ...rest] = clearings.map(m => m.data);
    for (const b of rest) {
      expect([b.width, b.height]).toEqual([a!.width, a!.height]);
      const differ = a!.tiles.flatMap((r, y) => [...r].flatMap((t, x) => (t !== b.tiles[y]![x] ? [t] : [])));
      expect(differ.length).toBeGreaterThan(0);
      expect(differ.length).toBeLessThanOrEqual(20);
    }
    for (const m of clearings) expect(m.data.watchers).toMatchObject({ count: 1 });
  });

  it('each have a way out on every side, and every one but the way on puts you back by the ring, facing it, as a way home', () => {
    for (const m of clearings) {
      expect(m.data.exits.map(e => sideOf(m, e)).sort()).toEqual(['down', 'left', 'right', 'up']);
      expect(onward(m)).toHaveLength(1);
      for (const e of m.data.exits.filter(e => e.to === 'near-woods')) expect(e).toMatchObject({ tx: NEAR_WOODS_BACK.x, ty: NEAR_WOODS_BACK.y, dir: 'right', home: true });
      expect(near.walkable(NEAR_WOODS_BACK.x, NEAR_WOODS_BACK.y)).toBe(true);
      // You always come in by the east side, whichever side you left the last one by.
      expect(m.data.spawn).toMatchObject({ x: TURNING_ENTRY.x, y: TURNING_ENTRY.y });
    }
    expect(clearings.map(m => onward(m)[0]!.to)).toEqual(['turning-2', 'turning-3', 'turning-camp']);
    for (const e of onward(clearings[0]!).concat(onward(clearings[1]!))) expect(e).toMatchObject({ tx: TURNING_ENTRY.x, ty: TURNING_ENTRY.y });
  });

  it('lead on the ways the ranger wrote: with the water at the stump, to the stone that hums at the cairn, back where you came in at NAPO\'s stakes', () => {
    const directions = notesOf([...maps.values()].map(m => m.data)).get('ranger-turning')!;
    expect(directions.map.id).toBe('near-woods-ranger-hut');
    expect(directions.note).toMatchObject({ when: 'night' });
    expect(directions.note.text.join(' ')).toMatch(/At the stump, go with the water\. At the cairn, go to the stone that hums\. At NAPO's stakes, turn round\./);
    const [stump, cairn, stakes] = clearings;
    const way = (m: TileMap) => sideOf(m, onward(m)[0]!);
    // The stump's brook leaves by one side only: the way on.
    expect(objects(stump!, 'stump')).toHaveLength(1);
    const brook = stump!.data.tiles.flatMap((r, y) => [...r].flatMap((t, x) => (t === 'w' ? [[x, y] as const] : [])));
    expect(Math.min(...brook.map(([, y]) => y))).toBe(1);
    expect(way(stump!)).toBe('up');
    // At the cairn, the one stone that hums stands by the trail out of the way on.
    const hum = objects(cairn!, 'rock').filter(r => r.hum);
    expect(hum).toHaveLength(1);
    const e = onward(cairn!)[0]!;
    for (const other of cairn!.data.exits.filter(x => x !== e)) expect(Math.hypot(hum[0]!.x - e.x, hum[0]!.y - e.y)).toBeLessThan(Math.hypot(hum[0]!.x - other.x, hum[0]!.y - other.y));
    // NAPO's stakes run out the other way: the way on is back where you came in.
    expect(way(stakes!)).toBe('right');
    expect(Math.max(...objects(stakes!, 'stake').map(s => s.x))).toBeLessThan(stakes!.width / 2);
  });

  it('are told apart by the ranger\'s notches, read from the trail you come in by', () => {
    const notches = clearings.map(m => objects(m, 'sign').find(s => /notch/.test(s.text.join(' ')))!.text[0]!.split(' ').slice(0, 2).join(' '));
    expect(notches).toEqual(['One notch', 'Two notches', 'Three notches']);
  });
});

describe('the ranger\'s camp', () => {
  it('is past the third clearing, and its way home puts you back by the ring', () => {
    expect(camp.data.exits.find(e => e.home)).toMatchObject({ to: 'near-woods', tx: NEAR_WOODS_BACK.x, ty: NEAR_WOODS_BACK.y });
    expect(onward(clearings[2]!)[0]).toMatchObject({ tx: camp.data.spawn.x, ty: camp.data.spawn.y });
  });

  it('has her hut, whose fire is always burning, her crate, her drawing of the Turning and her last notes', () => {
    expect(hut.data.exits[0]!.to).toBe('turning-camp');
    expect(objects(hut, 'fireplace')).toEqual([expect.objectContaining({ tended: true })]);
    expect(objects(hut, 'cache')).toHaveLength(1);
    expect(objects(hut, 'paper').map(p => p.look).sort()).toEqual(['calendar', 'drawing']);
    const notes = objects(hut, 'note');
    expect(notes.map(n => n.id).sort()).toEqual(['ranger-camp', 'ranger-kettle', 'ranger-said-back']);
    expect(notes.every(n => n.by === 'ranger')).toBe(true);
  });

  it('has a way on that gives out in the firs, for now', () => {
    expect(camp.data.exits.filter(e => !e.home && e.to !== 'turning-camp-hut')).toEqual([]);
    expect(objects(camp, 'sign').some(s => /On\. Mornings\./.test(s.text.join(' ')))).toBe(true);
  });
});
