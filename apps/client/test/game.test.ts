import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { STEP_MS, type ClientMsg, type MapData, type PlayerView } from '@napoland/shared';
import { Game } from '../src/game';
import { Maps } from '../src/maps';
import { cabin, houseTown, ref, shed, tinyTown, tinyWoods, welcome } from './fixtures';

const stonebrook = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/maps/stonebrook.json'), 'utf8')) as MapData;
const maps = new Maps([stonebrook]);
const map = maps.get(stonebrook)!;
const spawn = map.data.spawn;
const me: PlayerView = { id: 'me', name: 'Aldo', x: spawn.x, y: spawn.y, dir: 'down', color: '#d9a53a' };
const other: PlayerView = { id: 'o1', name: 'Bea', x: spawn.x + 1, y: spawn.y, dir: 'left', color: '#58a8f8' };

let sent: ClientMsg[];
let game: Game;
let now: number;
/** Advance time in 1/60 s frames. */
function run(ms: number, g = game) {
  for (let t = 0; t < ms; t += 1000 / 60) { now += 1000 / 60; g.update(1 / 60, now); }
}
const steps = () => sent.filter(m => m.t === 'step');

beforeEach(() => {
  sent = [];
  now = 1000;
  game = new Game(maps, m => sent.push(m));
  game.handle(welcome(stonebrook, [me, other]), now);
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
  it('plays the map the welcome names', () => {
    expect(game.map).toBe(map);
    expect(game.online).toBe(true);
  });
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
    game.disconnected(now);
    game.padChange('down', now);
    run(500);
    expect(steps()).toHaveLength(0);
    game.handle(welcome(stonebrook, [me]), now);
    run(20);
    expect(steps()).toHaveLength(1);
  });
  it('adds and removes players', () => {
    game.handle({ t: 'join', player: { ...other, id: 'o2', name: 'Cid' } }, now);
    expect(game.players.has('o2')).toBe(true);
    game.handle({ t: 'leave', id: 'o2' }, now);
    expect(game.players.has('o2')).toBe(false);
  });
  it('does not play a map it does not have', () => {
    const g = new Game(maps, m => sent.push(m));
    g.handle({ ...welcome(stonebrook, [me]), map: { id: 'stonebrook', version: stonebrook.version + 1 } }, now);
    expect(g.online).toBe(false);
    g.padChange('down', now);
    run(500, g);
    expect(steps()).toHaveLength(0);
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
    const g = new Game(maps, () => {});
    g.handle(welcome(stonebrook, [{ ...me, x: sign.x, y: sign.y + 1, dir: 'up' }]), now);
    g.pressA();
    expect(g.dialog?.who).toBe('Sign');
    const lines = g.dialog!.lines.length;
    for (let i = 0; i < lines * 2; i++) g.advanceDialog();
    expect(g.dialog).toBeNull();
  });
});

describe('moving between maps', () => {
  const town = tinyTown(), woods = tinyWoods();
  const two = new Maps([town, woods]);
  const at = (x: number, y: number, dir: PlayerView['dir'] = 'up'): PlayerView => ({ ...me, x, y, dir });
  let g: Game;
  beforeEach(() => {
    g = new Game(two, m => sent.push(m));
    g.handle(welcome(town, [at(3, 2), { ...other, x: 5, y: 3 }]), now);
  });
  const zone = (x: number, y: number, players: PlayerView[], reason: 'exit' | 'collapse' = 'exit') =>
    g.handle({ t: 'zone', map: ref(woods), x, y, dir: 'up', players, reason }, now);

  it('starts on the map the welcome names, wherever that is', () => {
    const g2 = new Game(two, () => {});
    expect(g2.map.data.id).toBe('town');
    g2.handle(welcome(woods, [at(2, 2)]), now);
    expect(g2.map.data.id).toBe('woods');
  });

  it('switches map, players and our place on zone', () => {
    zone(2, 4, [at(2, 4), { ...other, id: 'o9', name: 'Dot', x: 3, y: 2 }]);
    expect(g.map.data.id).toBe('woods');
    expect([...g.players.keys()].sort()).toEqual(['me', 'o9']);
    expect(g.me).toMatchObject({ tx: 2, ty: 4, x: 2, y: 4, dir: 'up', anim: null });
  });

  it('trusts the zone for our place, even if its player list is behind or leaves us out', () => {
    zone(2, 4, [at(1, 1, 'down')]);
    expect(g.me).toMatchObject({ tx: 2, ty: 4, dir: 'up' });
    zone(2, 3, []);
    expect(g.me).toMatchObject({ id: 'me', name: 'Aldo', tx: 2, ty: 3 });
  });

  it('forgets steps planned on the old map', () => {
    g.padChange('down', now);
    run(600, g); // turn, then two steps south that the server never confirms
    expect(steps()).toHaveLength(2);
    g.padChange(null, now);
    zone(2, 4, [at(2, 4)]);
    // Were the two old steps still pending, we could not walk before they are confirmed.
    g.padChange('up', now);
    run(20, g);
    expect(steps()).toHaveLength(3);
    expect(steps()[2]).toMatchObject({ dir: 'up' });
    expect(g.me).toMatchObject({ tx: 2, ty: 3 });
  });

  it('forgets a path planned on the old map', () => {
    g.handle(welcome(town, [at(2, 2, 'down')]), now);
    g.tapTile(2, 4);
    run(20, g);
    expect(steps()).toHaveLength(1);
    // The rest of the path, one step south, would be walkable from here in the woods.
    zone(2, 3, [at(2, 3)]);
    expect(woods.tiles[4]![2]).toBe('g');
    run(1000, g);
    expect(steps()).toHaveLength(1);
    expect(g.me).toMatchObject({ tx: 2, ty: 3 });
    expect(g.marker).toBeNull();
  });

  it('talks to the people and signs of the new map, not the old one', () => {
    g.handle(welcome(town, [at(1, 2)]), now);
    g.pressA();
    expect(g.dialog?.who).toBe('Sign');
    zone(1, 2, [at(1, 2)]);
    expect(g.dialog).toBeNull();
    g.pressA(); // facing 1,1: the town's sign stood there, in the woods it is a lamp
    expect(g.dialog).toBeNull();
    zone(2, 2, [at(2, 2)]);
    g.pressA();
    expect(g.dialog?.who).toBe('Rook');
  });

  it('stops predicting on an exit until the server moves us', () => {
    g.padChange('up', now);
    run(20, g);
    g.handle({ t: 'step', id: 'me', x: 3, y: 1, dir: 'up', seq: 1 }, now);
    run(500, g);
    expect(steps()).toHaveLength(2); // onto 3,1 and onto the exit at 3,0
    expect(g.me).toMatchObject({ tx: 3, ty: 0, anim: null });
    g.handle({ t: 'step', id: 'me', x: 3, y: 0, dir: 'up', seq: 2 }, now);
    // West of the exit is open grass, yet no step and no turn: the server is about to move us.
    g.padChange('left', now);
    run(1000, g);
    expect(steps()).toHaveLength(2);
    expect(sent.filter(m => m.t === 'face')).toHaveLength(0);
    zone(2, 4, [at(2, 4)]);
    g.padChange('up', now);
    run(20, g);
    expect(steps()).toHaveLength(3);
    expect(g.me).toMatchObject({ tx: 2, ty: 3 });
  });

  it('walks off an exit again if the server never moves us', () => {
    g.handle(welcome(town, [at(3, 0, 'left')]), now);
    g.padChange('left', now);
    run(2000, g);
    expect(steps()).toHaveLength(0);
    run(1200, g);
    expect(steps()).toHaveLength(1);
    expect(steps()[0]).toMatchObject({ dir: 'left' });
  });

  it('does not walk while held, on the way to another map', () => {
    g.held = true;
    g.padChange('up', now);
    run(500, g);
    expect(steps()).toHaveLength(0);
    g.held = false;
    run(20, g);
    expect(steps()).toHaveLength(1);
  });
});

describe('going into a house', () => {
  const town = houseTown(), home = cabin();
  const world = new Maps([town, home, shed()]);
  const at = (x: number, y: number, dir: PlayerView['dir'] = 'up'): PlayerView => ({ ...me, x, y, dir });
  let g: Game;
  beforeEach(() => {
    g = new Game(world, m => sent.push(m));
    g.handle(welcome(town, [at(2, 3)]), now);
  });

  it('walks into the open door and waits on it for the server to take it inside', () => {
    g.padChange('up', now);
    run(20, g);
    expect(steps()).toHaveLength(1);
    expect(g.me).toMatchObject({ tx: 2, ty: 2 });
    g.handle({ t: 'step', id: 'me', x: 2, y: 2, dir: 'up', seq: 1 }, now);
    run(1000, g);
    expect(steps()).toHaveLength(1);
    g.handle({ t: 'zone', map: ref(home), x: 4, y: 5, dir: 'up', players: [at(4, 5)], reason: 'exit' }, now);
    expect(g.map.data.id).toBe('cabin');
    expect(g.me).toMatchObject({ tx: 4, ty: 5, dir: 'up' });
  });

  it('walks up to a door that is tapped', () => {
    g.handle(welcome(town, [at(5, 4)]), now);
    g.tapTile(2, 2);
    expect(g.marker).toMatchObject({ x: 2, y: 2 });
  });

  it('is stopped inside by the fire and the walls, and walks out through the doorway', () => {
    g.handle(welcome(home, [at(4, 2)]), now);
    g.padChange('up', now);
    run(400, g);
    g.padChange(null, now);
    g.handle(welcome(home, [at(1, 4, 'left')]), now);
    g.padChange('left', now);
    run(400, g);
    g.padChange(null, now);
    expect(steps()).toHaveLength(0);
    g.handle(welcome(home, [at(4, 5, 'down')]), now);
    g.padChange('down', now);
    run(20, g);
    expect(steps()).toHaveLength(1);
    expect(g.me).toMatchObject({ tx: 4, ty: 6 });
    expect(g.map.exitAt(4, 6)?.to).toBe('hometown');
  });
});

describe('energy', () => {
  const town = tinyTown();
  const two = new Maps([town, tinyWoods()]);
  let g: Game;
  beforeEach(() => {
    g = new Game(two, () => {});
  });

  it('is unknown until the server reports it', () => {
    expect(g.energy(now)).toBeNull();
  });

  it('counts on at the reported rate between messages, within 0 and max', () => {
    g.handle(welcome(town, [], { value: 50, max: 100, rate: -2 }), now);
    expect(g.energy(now)).toEqual({ value: 50, max: 100, rate: -2 });
    expect(g.energy(now + 1000)!.value).toBeCloseTo(48);
    expect(g.energy(now + 30_000)!.value).toBe(0);
    g.handle({ t: 'energy', energy: { value: 20, max: 120, rate: 8 } }, now + 5000);
    expect(g.energy(now + 6000)).toEqual({ value: 28, max: 120, rate: 8 });
    expect(g.energy(now + 60_000)!.value).toBe(120);
  });

  it('holds still while disconnected', () => {
    g.handle(welcome(town, [], { value: 50, max: 100, rate: -2 }), now);
    g.disconnected(now + 1000);
    expect(g.energy(now + 1000)!.value).toBeCloseTo(48);
    expect(g.energy(now + 10_000)!.value).toBeCloseTo(48);
    g.handle(welcome(town, [], { value: 30, max: 100, rate: -1 }), now + 10_000);
    expect(g.energy(now + 12_000)!.value).toBeCloseTo(28);
  });
});

describe('walking into another map', () => {
  it('walks up the north road onto the exit while the joystick is held, then waits there', () => {
    const g = new Game(maps, m => sent.push(m));
    g.handle(welcome(stonebrook, [{ ...me, x: 29, y: 17, dir: 'right' }]), now);
    // The server confirms every step at once (a fast connection) and tracks where we really are.
    let y = 17, confirmed = 0;
    g.padChange('up', now);
    for (let t = 0; t < 6000; t += 1000 / 60) {
      now += 1000 / 60;
      g.update(1 / 60, now);
      for (const m of steps().slice(confirmed)) {
        confirmed++;
        if (m.t === 'step') g.handle({ t: 'step', id: 'me', x: 29, y: --y, dir: 'up', seq: m.seq }, now);
      }
    }
    expect(map.exitAt(29, 0)?.to).toBe('near-woods');
    // Seventeen steps from y 17 to the exit tile at y 0, and none past it until the server moves us.
    expect(y).toBe(0);
    expect(steps()).toHaveLength(17);
    expect(g.me).toMatchObject({ tx: 29, ty: 0 });
  });
});
