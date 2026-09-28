/**
 * A new player's first steps as the client shows them (roadmap/first-steps.md): the step to take now, from
 * the welcome and from each one the server says was taken, at the foot of the status panel; and once, in
 * the text box, that the basics are done. What each step says is checked against the real maps, since
 * players walk by it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { FIRST_STEPS, type MapData, type PlayerView } from '@napoland/shared';
import { Game } from '../src/game';
import { Items } from '../src/items';
import { Maps } from '../src/maps';
import { FIRST_STEPS_DONE, FIRST_STEPS_TITLE, FIRST_STEP_LINES, firstStepsView } from '../src/said';
import { itemsData, tinyTown, welcome } from './fixtures';

const read = (path: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content', path), 'utf8')) as MapData;
const me: PlayerView = { id: 'me', name: 'Aldo', x: 2, y: 2, dir: 'down', color: '#f29e4c', gear: {}, quirks: [] };

let g: Game;
beforeEach(() => {
  g = new Game(new Maps([tinyTown()]), () => {}, new Items(itemsData()));
});
/** The welcome, with the first step to take now if there is one. */
const hello = (firstSteps?: number) => g.handle({ ...welcome(tinyTown(), [me]), ...(firstSteps !== undefined && { firstSteps }) }, 1000);

describe('the first steps', () => {
  it('come with the welcome for a new player, and for nobody else', () => {
    hello(1);
    expect(g.firstSteps).toBe(1);
    const changes = g.firstStepsChanges;
    hello();
    expect(g.firstSteps).toBeNull();
    expect(g.firstStepsChanges).toBeGreaterThan(changes);
  });

  it('move on as the server says, quietly, and say once in the text box that the basics are done', () => {
    hello(1);
    const changes = g.firstStepsChanges;
    g.handle({ t: 'firstSteps', step: 2 }, 2000);
    expect([g.firstSteps, g.firstStepsChanges, g.note]).toEqual([2, changes + 1, null]);
    g.handle({ t: 'firstSteps', step: 3 }, 3000);
    expect(g.note).toBeNull();
    g.handle({ t: 'firstSteps', step: null }, 4000);
    expect(g.firstSteps).toBeNull();
    expect(g.note).toMatchObject({ who: FIRST_STEPS_TITLE, text: FIRST_STEPS_DONE });
    // Once: the same news again says nothing.
    g.boxTap();
    expect(g.note).toBeNull();
    g.handle({ t: 'firstSteps', step: null }, 5000);
    expect(g.note).toBeNull();
  });

  it('show on the status panel which one of how many it is, and what it asks; nothing when there is none', () => {
    expect(FIRST_STEP_LINES).toHaveLength(FIRST_STEPS);
    expect(firstStepsView(1)).toEqual({ title: 'First steps · 1 of 3', text: 'Walk to NAPO\'s teleport in the corner and press A: it takes you to town.' });
    expect(firstStepsView(2)).toEqual({ title: 'First steps · 2 of 3', text: 'Go out of town up the north road, and pick up something you find in the woods.' });
    expect(firstStepsView(3)).toEqual({ title: 'First steps · 3 of 3', text: 'Take the teleport by the notice board home, and put what you found in the chest.' });
    for (const none of [null, 0, 4]) expect(firstStepsView(none)).toBeNull();
  });

  it('say what the real maps hold: a teleport in the cabin, its twin by the notice board, and the road to the woods off the north edge of town', () => {
    const home = read('maps/stonebrook-home.json'), town = read('maps/stonebrook.json');
    const teleport = home.objects.find(o => o.kind === 'teleport')!, twin = town.objects.find(o => o.kind === 'teleport')!;
    // In the corner: against the side wall, with the tile in front of it on the cabin's last row of floor.
    expect(teleport.x).toBe(home.width - 2);
    expect(teleport.y + 1).toBe(home.height - 2);
    const board = town.objects.find(o => o.kind === 'board')!;
    expect(Math.abs(twin.x - board.x) + Math.abs(twin.y - board.y)).toBeLessThanOrEqual(4);
    expect(town.exits.find(e => e.to === 'near-woods')).toMatchObject({ y: 0 });
  });
});
