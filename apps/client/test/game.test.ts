import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { STEP_MS, TileMap, type ClientMsg, type MapData, type PlayerView } from '@napoland/shared';
import { Game } from '../src/game';

const map = new TileMap(JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/maps/stonebrook.json'), 'utf8')) as MapData);
const spawn = map.data.spawn;
const me: PlayerView = { id: 'me', name: 'Aldo', x: spawn.x, y: spawn.y, dir: 'down', color: '#d9a53a' };
const other: PlayerView = { id: 'o1', name: 'Bea', x: spawn.x + 1, y: spawn.y, dir: 'left', color: '#58a8f8' };

let sent: ClientMsg[];
let game: Game;
let now: number;
/** Advance time in 1/60 s frames. */
function run(ms: number) {
  for (let t = 0; t < ms; t += 1000 / 60) { now += 1000 / 60; game.update(1 / 60, now); }
}
const steps = () => sent.filter(m => m.t === 'step');

beforeEach(() => {
  sent = [];
  now = 1000;
  game = new Game(map, m => sent.push(m));
  game.handle({ t: 'welcome', v: 1, you: 'me', name: 'Aldo', token: 'x'.repeat(20), players: [me, other], stepMs: STEP_MS, map: { id: 'stonebrook', version: 1 }, weather: 'rain', serverTime: 0 }, now);
});

describe('D-pad', () => {
  it('turns in place on a quick tap in a new direction', () => {
    expect(map.walkable(spawn.x - 1, spawn.y)).toBe(true);
    game.padChange('left', now);
    run(50);
    game.padChange(null, now);
    run(300);
    expect(game.me!.dir).toBe('left');
    expect(steps()).toHaveLength(0);
    expect(sent).toContainEqual({ t: 'face', dir: 'left' });
  });
  it('walks when the direction is held', () => {
    game.padChange('left', now);
    run(400);
    expect(steps().length).toBeGreaterThanOrEqual(1);
    expect(steps()[0]).toMatchObject({ t: 'step', dir: 'left', seq: 1 });
  });
  it('walks at once in the direction already faced', () => {
    expect(map.walkable(spawn.x, spawn.y + 1)).toBe(true);
    game.padChange('down', now);
    run(20);
    expect(steps()[0]).toMatchObject({ dir: 'down', seq: 1 });
    expect(game.me!.ty).toBe(spawn.y + 1);
    expect(game.me!.y).toBeGreaterThan(spawn.y);
    expect(game.me!.anim).not.toBeNull();
  });
  it('never runs more than two steps ahead of the server', () => {
    game.padChange('down', now);
    run(2000);
    expect(steps()).toHaveLength(2);
  });
});

describe('server answers', () => {
  it('keeps the prediction when the server confirms', () => {
    game.padChange('down', now);
    run(20);
    game.padChange(null, now);
    game.handle({ t: 'step', id: 'me', x: spawn.x, y: spawn.y + 1, dir: 'down', seq: 1 }, now);
    run(300);
    expect(game.me).toMatchObject({ tx: spawn.x, ty: spawn.y + 1, x: spawn.x, y: spawn.y + 1 });
  });
  it('snaps back when the server rejects a step', () => {
    game.padChange('down', now);
    run(20);
    game.handle({ t: 'reject', seq: 1, x: spawn.x, y: spawn.y, dir: 'down' }, now);
    game.padChange(null, now);
    run(20);
    expect(game.me).toMatchObject({ tx: spawn.x, ty: spawn.y, x: spawn.x, y: spawn.y, anim: null });
  });
  it('animates other players smoothly to where the server says', () => {
    game.handle({ t: 'step', id: 'o1', x: other.x + 1, y: other.y, dir: 'right' }, now);
    run(STEP_MS / 2);
    const o = game.players.get('o1')!;
    expect(o.x).toBeGreaterThan(other.x);
    expect(o.x).toBeLessThan(other.x + 1);
    run(STEP_MS);
    expect(o.x).toBe(other.x + 1);
  });
  it('stops walking while disconnected and resumes after the next welcome', () => {
    game.disconnected();
    game.padChange('down', now);
    run(500);
    expect(steps()).toHaveLength(0);
    game.handle({ t: 'welcome', v: 1, you: 'me', name: 'Aldo', token: 'x'.repeat(20), players: [me], stepMs: STEP_MS, map: { id: 'stonebrook', version: 1 }, weather: 'rain', serverTime: 0 }, now);
    run(20);
    expect(steps()).toHaveLength(1);
  });
  it('adds and removes players', () => {
    game.handle({ t: 'join', player: { ...other, id: 'o2', name: 'Cid' } }, now);
    expect(game.players.has('o2')).toBe(true);
    game.handle({ t: 'leave', id: 'o2' }, now);
    expect(game.players.has('o2')).toBe(false);
  });
});

describe('tapping and talking', () => {
  it('walks a path to a tapped tile, one confirmed step at a time', () => {
    game.tapTile(spawn.x, spawn.y + 2);
    run(20);
    expect(steps()).toHaveLength(1);
    game.handle({ t: 'step', id: 'me', x: spawn.x, y: spawn.y + 1, dir: 'down', seq: 1 }, now);
    run(STEP_MS + 20);
    game.handle({ t: 'step', id: 'me', x: spawn.x, y: spawn.y + 2, dir: 'down', seq: 2 }, now);
    run(STEP_MS + 20);
    expect(game.me).toMatchObject({ tx: spawn.x, ty: spawn.y + 2 });
  });
  it('reads a sign with A when facing it', () => {
    const sign = map.data.objects.find(o => o.kind === 'sign')!;
    const g = new Game(map, () => {});
    g.handle({ t: 'welcome', v: 1, you: 'me', name: 'Aldo', token: 'x'.repeat(20), players: [{ ...me, x: sign.x, y: sign.y + 1, dir: 'up' }], stepMs: STEP_MS, map: { id: 'stonebrook', version: 1 }, weather: 'rain', serverTime: 0 }, now);
    g.pressA();
    expect(g.dialog?.who).toBe('Sign');
    const lines = g.dialog!.lines.length;
    for (let i = 0; i < lines * 2; i++) g.advanceDialog();
    expect(g.dialog).toBeNull();
  });
});
