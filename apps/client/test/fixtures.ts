import { STEP_MS, type EnergyView, type MapData, type PlayerView, type ServerMsg } from '@napoland/shared';

/**
 * A 7x5 town: a road runs north up the middle, and its top tile (3,0) leads into the woods.
 * A sign stands at 1,1.
 */
export function tinyTown(): MapData {
  return {
    id: 'town', name: 'Testbrook', version: 1, kind: 'town', depth: 0, width: 7, height: 5,
    tiles: ['gggrggg', 'gggrggg', 'gggrggg', 'gggrggg', 'ggggggg'],
    levels: Array<string>(5).fill('0000000'),
    spawn: { x: 3, y: 3, dir: 'down' },
    exits: [{ x: 3, y: 0, w: 1, h: 1, to: 'woods', tx: 2, ty: 4, dir: 'up' }],
    objects: [{ kind: 'sign', x: 1, y: 1, text: ['Testbrook', 'Pop. 2'] }],
  };
}

/**
 * A 5x6 patch of woods: a trail from the way home (the mud at the bottom) up to a clearing,
 * where Rook stands at 2,1 next to a lamp at 1,1.
 */
export function tinyWoods(): MapData {
  return {
    id: 'woods', name: 'The Test Woods', version: 3, kind: 'wilds', depth: 1, width: 5, height: 6,
    tiles: ['ttttt', 'tgggt', 'tgggt', 'ttgtt', 'ttgtt', 'ttmtt'],
    levels: Array<string>(6).fill('00000'),
    spawn: { x: 2, y: 4, dir: 'up' },
    exits: [{ x: 2, y: 5, w: 1, h: 1, to: 'town', tx: 3, ty: 1, dir: 'down', home: true }],
    objects: [
      { kind: 'npc', x: 2, y: 1, id: 'rook', name: 'Rook', dir: 'down', lines: ['Lost?'] },
      { kind: 'lamp', x: 1, y: 1 },
    ],
  };
}

export const ref = (m: MapData) => ({ id: m.id, version: m.version });

export const FULL: EnergyView = { value: 100, max: 100, rate: 8 };

export function welcome(map: MapData, players: PlayerView[], energy: EnergyView = FULL): Extract<ServerMsg, { t: 'welcome' }> {
  return { t: 'welcome', v: 2, you: 'me', name: 'Aldo', token: 'x'.repeat(20), map: ref(map), players, stepMs: STEP_MS, weather: 'rain', energy, serverTime: 0 };
}
