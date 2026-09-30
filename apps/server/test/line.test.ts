/**
 * The dead line (packages/shared/src/line.ts): facing the poles' leanings in the right order beside the lamp with
 * no wires on an aurora night puts it out for the whole world until dawn. The lamp stands at 5,4 of the fixture
 * woods here (WorldOptions.lamp); real content uses LAMP. World rules, with the messages the network would send.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DAY_S, LAMP, SOLUTION, poleTag, tagNumber, LEANS, type Dir, type NotebookData, type MapData, type ServerMsg, type Weather } from '@napoland/shared';
import type { PlayerRecord } from '../src/storage';
import { World, colorFor, type Outgoing } from '../src/world';
import { TileMap } from '@napoland/shared';
import { fixtureMaps } from './fixtures';

const rec = (id: string, map: string, x: number, y: number, dir: Dir = 'up'): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map, x, y, dir, color: colorFor(id), energy: 100, bag: [], createdAt: 1, lastSeenAt: 1,
});
const NOTEBOOK: NotebookData = { version: 1, pages: [{ id: 'dark-lamp', area: 'woods', title: 'The lamp went out', text: 'Dark.', when: { saw: 'lamp-out' } }] };
/** Lamp at 5,4: beside it, at 4,4, stands "a"; "b" waits in the woods at 2,2 and "t" in town. */
function world(weather: Weather | 'cycle', epochOffset = 0): World {
  const w = new World(fixtureMaps(), 'town', weather === 'cycle' ? 'overcast' : weather, {
    rng: () => 0, notebook: NOTEBOOK, lamp: { map: 'woods', x: 5, y: 4 }, cycle: weather === 'cycle', epochOffset,
  });
  for (const p of [rec('a', 'woods', 4, 4), rec('b', 'woods', 2, 2), rec('t', 'town', 2, 2)]) w.join(p, 0);
  w.drain();
  return w;
}
const lampMsgs = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id || o.to === 'all') && o.msg.t === 'lampOut' ? [(o.msg as Extract<ServerMsg, { t: 'lampOut' }>).out] : []);
const faceAll = (w: World, id: string, dirs: readonly Dir[]) => dirs.forEach(d => w.face(id, d));
/** A wall time late on an aurora night (every third day), in ms. */
const AURORA_NIGHT = (3 * 1000 + 2) * DAY_S * 1000 + (DAY_S - 100) * 1000;

describe('the lamp with no wires', () => {
  it('stays lit while a surge runs, since its light is shelter for whoever stands in it', () => {
    const maps = fixtureMaps().map(m => (m.data.id === 'woods' ? new TileMap({ ...m.data, surge: { every: 100, unstable: 10, surge: 20, sweep: 10 } }) : m));
    const w = new World(maps, 'town', 'aurora', { rng: () => 0, lamp: { map: 'woods', x: 5, y: 4 } });
    for (const p of [rec('a', 'woods', 4, 4), rec('t', 'town', 2, 2)]) w.join(p, 0);
    w.drain();
    // 90 s into the round is the surge; the next round begins calm.
    w.tick(90_000);
    faceAll(w, 'a', SOLUTION);
    expect(lampMsgs(w.drain(), 't')).toEqual([]);
    w.tick(105_000);
    faceAll(w, 'a', SOLUTION.slice().reverse().slice(0, 1));
    faceAll(w, 'a', SOLUTION);
    expect(lampMsgs(w.drain(), 't')).toEqual([true]);
  });

  it('stays lit for the right order on a plain night', () => {
    const w = world('night');
    faceAll(w, 'a', SOLUTION);
    expect(lampMsgs(w.drain(), 't')).toEqual([]);
  });

  it('goes out for everyone when the right order is faced on an aurora night, and only once', () => {
    const w = world('aurora');
    faceAll(w, 'a', SOLUTION);
    const out = w.drain();
    expect(lampMsgs(out, 't')).toEqual([true]);
    expect(lampMsgs(out, 'b')).toEqual([true]);
    faceAll(w, 'a', SOLUTION.slice().reverse());
    faceAll(w, 'a', SOLUTION);
    expect(lampMsgs(w.drain(), 't')).toEqual([]);
  });

  it('starts over after a wrong turn, and after stepping away', () => {
    const w = world('aurora');
    faceAll(w, 'a', SOLUTION.slice(0, 4));
    w.face('a', SOLUTION[3] === 'up' ? 'down' : 'up');
    faceAll(w, 'a', SOLUTION.slice(4));
    expect(lampMsgs(w.drain(), 't')).toEqual([]);

    faceAll(w, 'a', SOLUTION.slice(0, 4));
    w.step('a', 'down', 1, 1000);
    w.tick(1000);
    expect(w.get('a')).toMatchObject({ x: 4, y: 5 });
    w.tick(1500);
    w.step('a', 'up', 2, 2000);
    w.tick(3000);
    expect(w.get('a')).toMatchObject({ x: 4, y: 4 });
    faceAll(w, 'a', SOLUTION.slice(4));
    expect(lampMsgs(w.drain(), 't')).toEqual([]);
  });

  it('judges a turn sent right behind a queued step from the tile that step ends on', () => {
    const w = world('aurora');
    w.join(rec('c', 'woods', 2, 4), 0);
    w.drain();
    // Two steps right, the second arriving early and waiting; the turn follows at once, before it is walked.
    w.step('c', 'right', 1, 1000);
    w.step('c', 'right', 2, 1001);
    w.face('c', SOLUTION[0]!, 1002);
    expect(w.get('c')).toMatchObject({ x: 3, y: 4 });
    w.tick(2000);
    expect(w.get('c')).toMatchObject({ x: 4, y: 4, dir: SOLUTION[0] });
    faceAll(w, 'c', SOLUTION.slice(1));
    expect(lampMsgs(w.drain(), 't')).toEqual([true]);
  });

  it('is told to a late joiner, and relit at dawn', () => {
    const w = world('cycle', AURORA_NIGHT);
    w.tick(0);
    faceAll(w, 'a', SOLUTION);
    expect(lampMsgs(w.drain(), 't')).toEqual([true]);
    w.join(rec('late', 'town', 2, 3), 1);
    expect(lampMsgs(w.drain(), 'late')).toEqual([true]);
    // Dawn is 100 s away: the night after is a new one, dark only by a new solve.
    w.tick(101_000);
    expect(lampMsgs(w.drain(), 't')).toEqual([false]);
    w.join(rec('later', 'town', 2, 4), 102_000);
    expect(lampMsgs(w.drain(), 'later')).toEqual([]);
  });

  it('lights nothing while it is out, and lights again at dawn', () => {
    const maps = fixtureMaps();
    const woods = maps.find(m => m.data.id === 'woods')!;
    const w = new World(maps, 'town', 'overcast', { rng: () => 0, lamp: { map: 'woods', x: 1, y: 4 }, cycle: true, epochOffset: AURORA_NIGHT });
    w.join(rec('a', 'woods', 2, 4), 0);
    w.tick(0);
    // The fixture's street light at 1,4 lights the tiles beside it: what shelters from a surge and keeps creatures off is this same light.
    expect(woods.lit(2, 4)).toBe(true);
    expect(woods.creatureMayStand(2, 4)).toBe(false);
    faceAll(w, 'a', SOLUTION);
    expect(woods.lit(2, 4)).toBe(false);
    expect(woods.creatureMayStand(2, 4)).toBe(true);
    w.tick(101_000);
    expect(woods.lit(2, 4)).toBe(true);
  });

  it('puts "lamp-out" in the notebook of everyone in its woods, and of no one elsewhere', () => {
    const w = world('aurora');
    faceAll(w, 'a', SOLUTION);
    w.drain();
    expect(['a', 'b', 't'].map(id => w.get(id)!.notebook?.pages ?? [])).toEqual([['dark-lamp'], ['dark-lamp'], []]);
  });
});

describe('the dead line in the real Near Woods', () => {
  const woods = JSON.parse(readFileSync(new URL('../../../content/maps/near-woods.json', import.meta.url), 'utf8')) as MapData;
  it('has the lamp where LAMP says, with open ground beside it', () => {
    expect(woods.id).toBe(LAMP.map);
    expect(woods.objects.some(o => o.kind === 'lamp' && o.x === LAMP.x && o.y === LAMP.y)).toBe(true);
    const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => woods.tiles[LAMP.y + dy!]![LAMP.x + dx!] === 'g');
    expect(open.length).toBeGreaterThan(0);
  });
  it('has a lean for every pole of its line, and none for a pole that is not on it', () => {
    const tags = woods.objects.flatMap(o => (o.kind === 'pole' ? [tagNumber(poleTag(woods, o.x, o.y))] : []));
    expect(tags.every(n => n !== undefined && n in LEANS)).toBe(true);
  });
});
