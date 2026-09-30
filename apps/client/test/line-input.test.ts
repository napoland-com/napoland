/**
 * The dead line's order is entered by turning in place beside the lamp (packages/shared/src/line.ts). Keyboard and
 * joystick both reach Game.padChange, so one flick of it per direction has to send exactly one `face` and no `step`.
 * Tapping the ground can only walk (there is no turning in place by tap), so it is not a way to enter the order.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAMP, SOLUTION, type ClientMsg, type MapData, type PlayerView } from '@napoland/shared';
import { Game } from '../src/game';
import { Maps } from '../src/maps';
import { ITEMS, welcome } from './fixtures';

const woods = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/maps/near-woods.json'), 'utf8')) as MapData;
const maps = new Maps([woods]);
const start = { x: LAMP.x, y: LAMP.y + 1 };
const you: PlayerView = { id: 'me', name: 'Aldo', ...start, dir: 'down', color: '#d9a53a', gear: {}, quirks: [] };

function setup() {
  const sent: ClientMsg[] = [];
  let now = 1000;
  const game = new Game(maps, m => sent.push(m), ITEMS);
  game.handle(welcome(woods, [you]), now);
  const run = (ms: number) => { for (let t = 0; t < ms; t += 1000 / 60) { now += 1000 / 60; game.update(1 / 60, now); } };
  return { sent, game, run, at: () => now };
}

describe('entering the dead line order with real input', () => {
  it('has open ground on three sides and the lamp on the fourth, which can only be faced', () => {
    const map = maps.get(woods)!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1]]) expect(map.walkable(start.x + dx!, start.y + dy!)).toBe(true);
    expect(map.walkable(LAMP.x, LAMP.y)).toBe(false);
  });

  it('a quick flick of the stick or key in each direction turns in place, in order, without losing the tile', () => {
    const { sent, game, run, at } = setup();
    for (const dir of SOLUTION) {
      game.padChange(dir, at());
      run(60);
      game.padChange(null, at());
      run(300);
    }
    expect(sent.filter(m => m.t === 'step')).toEqual([]);
    expect(sent.filter(m => m.t === 'face').map(m => (m as { dir: string }).dir)).toEqual(SOLUTION.filter((d, i) => d !== (i ? SOLUTION[i - 1] : 'down')));
    expect(game.me).toMatchObject({ tx: start.x, ty: start.y });
  });

  it('holding a direction past the turn walks off the tile, which is what starts the order over', () => {
    const { sent, game, run, at } = setup();
    game.padChange('left', at());
    run(500);
    expect(sent.some(m => m.t === 'step')).toBe(true);
  });

  it('tapping the ground only walks: no face is sent from a tap', () => {
    const { sent, game, run } = setup();
    game.tapTile(start.x, start.y + 2);
    run(800);
    expect(sent.some(m => m.t === 'step')).toBe(true);
    expect(sent.filter(m => m.t === 'face')).toEqual([]);
  });
});
