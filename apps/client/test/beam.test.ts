/**
 * NAPO's teleport as you see it take you (beam.ts): the trip's timing, going and coming, and the game around
 * it. YES starts it on your screen, and the teleport is sent only once you are gone; nobody walks meanwhile; the
 * new map starts the arrival at its twin; a no from the server, or no move at all, calls it off. Everyone else
 * sees a pop where you vanish and where you appear. On the real maps and items, since players walk by them.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { teleportArrival, type ClientMsg, type ItemsData, type MapData, type MapObject, type PlayerView } from '@napoland/shared';
import { BEAM_IN_S, BEAM_OUT_S, beamPose, padFor, popAt } from '../src/beam';
import { Game } from '../src/game';
import { Items } from '../src/items';
import { Maps } from '../src/maps';
import { FULL, welcome, zone } from './fixtures';

const read = <T>(path: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content', path), 'utf8')) as T;
const items = new Items(read<ItemsData>('items.json'));
const home = read<MapData>('maps/stonebrook-home.json'), town = read<MapData>('maps/stonebrook.json');
const one = (m: MapData, kind: MapObject['kind']) => m.objects.find(o => o.kind === kind)!;
const pad = one(home, 'teleport'), twin = one(town, 'teleport');
const player = (id: string, x: number, y: number): PlayerView => ({ id, name: id, x, y, dir: 'up', color: '#f29e4c', gear: {}, quirks: [] });

let sent: ClientMsg[];
let g: Game;
let now: number;
/** Runs the game for `ms`, sixty frames a second. */
function run(ms: number) {
  for (let t = 0; t < ms; t += 1000 / 60) { now += 1000 / 60; g.update(1 / 60, now); }
}
/** In your cabin, in front of its teleport and facing it; A and YES. */
function go() {
  g.pressA();
  g.answer('yes');
}

beforeEach(() => {
  sent = [];
  now = 1000;
  g = new Game(new Maps([home, town]), m => sent.push(m), items);
  const at = teleportArrival(pad);
  g.handle(welcome(home, [player('me', at.x, at.y)], FULL, { items: items.version }), now);
  run(100);
  sent.length = 0;
});

describe('the trip', () => {
  it('steps onto the pad and round, fades you from the feet up, and flashes, all before the teleport is sent', () => {
    const at = (t: number) => beamPose('out', t);
    expect(at(0)).toMatchObject({ onPad: 0, turn: 0, gone: 0, walking: true, rings: 0, column: 0, sparks: 0, flash: 0, rising: true });
    expect(at(0.2)).toMatchObject({ onPad: 1, walking: false });
    expect(at(0.4).turn).toBe(1);
    expect(at(1).gone).toBeGreaterThan(0.3);
    expect(at(1).gone).toBeLessThan(0.7);
    expect(at(1.4)).toMatchObject({ gone: 1, rings: 1, column: 1, sparks: 1 });
    expect(at(1.45).flash).toBe(1);
    // Gone, and the flash at its brightest, by the time the server is asked.
    expect(at(BEAM_OUT_S)).toMatchObject({ gone: 1 });
    expect(BEAM_OUT_S).toBeGreaterThanOrEqual(1.45);
  });

  it('gives you back from the head down on the pad, then steps you off onto the tile the server put you on', () => {
    const at = (t: number) => beamPose('in', t);
    expect(at(0)).toMatchObject({ onPad: 1, turn: 1, gone: 1, rising: false });
    expect(at(0.75).gone).toBeGreaterThan(0.3);
    expect(at(0.75).gone).toBeLessThan(0.7);
    expect(at(1.1).gone).toBe(0);
    expect(at(1.5).walking).toBe(true);
    expect(at(BEAM_IN_S)).toMatchObject({ onPad: 0, gone: 0, walking: false, rings: 0, column: 0, sparks: 0, flash: 0 });
  });

  it('knows which pad sets you down on a tile, and where others pop: beside a teleport as they go, in front of one as they come', () => {
    const at = teleportArrival(pad);
    expect(padFor(home.objects, at.x, at.y)).toEqual({ x: pad.x, y: pad.y });
    expect(padFor(home.objects, at.x - 1, at.y)).toBeUndefined();
    expect(popAt(town.objects, 'leave', twin.x, twin.y + 1)).toEqual({ x: twin.x, y: twin.y + 1 });
    expect(popAt(town.objects, 'leave', twin.x - 1, twin.y)).toEqual({ x: twin.x - 1, y: twin.y });
    expect(popAt(town.objects, 'leave', twin.x, twin.y + 2)).toBeNull();
    expect(popAt(town.objects, 'join', twin.x, twin.y + 1)).toEqual({ x: twin.x, y: twin.y + 1 });
    expect(popAt(town.objects, 'join', twin.x - 1, twin.y)).toBeNull();
  });
});

describe('the game around it', () => {
  it('starts on YES, keeps you still, and sends the teleport only once you are gone', () => {
    go();
    expect(g.beam).toMatchObject({ phase: 'out', pad: { x: pad.x, y: pad.y } });
    expect(g.avatars().find(a => a.id === 'me')?.beam).toMatchObject({ phase: 'out', pad: { x: pad.x, y: pad.y } });
    run(400);
    // The stick, a tap and A all wait for the trip.
    g.padChange('left', now);
    run(400);
    g.padChange(null, now);
    g.tapTile(pad.x - 3, pad.y + 1);
    g.pressA();
    run(200);
    expect(sent).toEqual([]);
    expect(g.question).toBeNull();
    run(BEAM_OUT_S * 1000);
    expect(sent).toEqual([{ t: 'teleport', x: pad.x, y: pad.y }]);
  });

  it('arrives at its twin when the server puts you in front of it, then lets you walk again', () => {
    go();
    run(BEAM_OUT_S * 1000 + 50);
    const at = teleportArrival(twin);
    g.handle({ ...zone(town, at.x, at.y, [player('me', at.x, at.y)]), dir: 'down' }, now);
    expect(g.beam).toMatchObject({ phase: 'in', pad: { x: twin.x, y: twin.y } });
    expect(g.avatars().find(a => a.id === 'me')?.beam).toMatchObject({ phase: 'in', t: 0 });
    // Counted in frames: building the new map can take seconds on a slow phone, and skips none of it.
    now += 5000;
    g.update(0.05, now);
    expect(g.beam).toMatchObject({ phase: 'in', t: 0.05 });
    run(BEAM_IN_S * 1000 - 150);
    expect(g.beam).not.toBeNull();
    run(200);
    expect(g.beam).toBeNull();
    g.padChange('left', now);
    run(600);
    expect(sent.some(m => m.t === 'step')).toBe(true);
  });

  it('is off when the server says no, or never moves you: you are where you stood, and can walk', () => {
    go();
    run(BEAM_OUT_S * 1000 + 50);
    g.handle({ t: 'refused', action: 'teleport', reason: 'too_far' }, now);
    expect(g.beam).toBeNull();
    // Asked first, so the no is said in the text box.
    expect(g.note).not.toBeNull();
    g.pressB();
    go();
    run(BEAM_OUT_S * 1000 + 50);
    expect(sent.filter(m => m.t === 'teleport')).toHaveLength(2);
    run(4200);
    expect(g.beam).toBeNull();
    // While the screen goes dark for the new map (held), the answer waits with it: the trip is not given up.
    go();
    run(BEAM_OUT_S * 1000 + 50);
    g.held = true;
    run(6000);
    expect(g.beam).toMatchObject({ phase: 'out' });
    g.held = false;
    run(4200);
    expect(g.beam).toBeNull();
    // A zone that is not the teleport's (the server moved you some other way) starts no arrival.
    go();
    g.handle(zone(town, 5, 5, [player('me', 5, 5)]), now);
    expect(g.beam).toBeNull();
  });

  it('shows others a pop where someone vanishes beside a teleport, and where someone appears in front of one', () => {
    g.handle(zone(town, 4, 30, [player('me', 4, 30)]), now);
    expect(g.takePops()).toEqual([]);
    const at = teleportArrival(twin);
    g.handle({ t: 'join', player: player('bo', at.x, at.y) }, now);
    expect(g.takePops()).toEqual([{ x: at.x, y: at.y }]);
    expect(g.takePops()).toEqual([]);
    g.handle({ t: 'leave', id: 'bo' }, now);
    expect(g.takePops()).toEqual([{ x: at.x, y: at.y }]);
    // Anywhere else, nobody pops.
    g.handle({ t: 'join', player: player('cy', 6, 30) }, now);
    g.handle({ t: 'leave', id: 'cy' }, now);
    expect(g.takePops()).toEqual([]);
  });
});
