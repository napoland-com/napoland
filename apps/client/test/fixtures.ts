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

/**
 * An 11x6 town with two houses whose doors lead inside: the lit one (1,1; door 2,2) into `cabin`,
 * which keeps a fire, the abandoned one (6,1; door 7,2) into `shed`, which is dark. A lamp at 5,3.
 */
export function houseTown(): MapData {
  return {
    id: 'hometown', name: 'Hometown', version: 1, kind: 'town', depth: 0, width: 11, height: 6,
    tiles: Array<string>(6).fill('ggggggggggg'),
    levels: Array<string>(6).fill('00000000000'),
    spawn: { x: 5, y: 4, dir: 'up' },
    exits: [
      { x: 2, y: 2, w: 1, h: 1, to: 'cabin', tx: 4, ty: 5, dir: 'up' },
      { x: 7, y: 2, w: 1, h: 1, to: 'shed', tx: 3, ty: 4, dir: 'up' },
    ],
    objects: [
      { kind: 'house', x: 1, y: 1, w: 3, h: 2, roof: '#6b7075', lit: 1 },
      { kind: 'house', x: 6, y: 1, w: 3, h: 2, roof: '#7a4b33', lit: 0 },
      { kind: 'lamp', x: 5, y: 3 },
    ],
  };
}

/**
 * Inside the lit house, 9x7 like the real rooms: walls all around, the door in the bottom wall (4,6),
 * a fireplace against the top wall (4,1), a bed (1,1 and 1,2), a shelf (7,1), a table (6,3) and a rug.
 */
export function cabin(): MapData {
  return {
    id: 'cabin', name: 'The cabin', version: 1, kind: 'inside', depth: 0, width: 9, height: 7,
    tiles: ['xxxxxxxxx', 'xpppppppx', 'xpppppppx', 'xpppppppx', 'xpppppppx', 'xpppppppx', 'xxxxpxxxx'],
    levels: Array<string>(7).fill('000000000'),
    spawn: { x: 4, y: 5, dir: 'up' },
    exits: [{ x: 4, y: 6, w: 1, h: 1, to: 'hometown', tx: 2, ty: 3, dir: 'down' }],
    objects: [
      { kind: 'fireplace', x: 4, y: 1 }, { kind: 'bed', x: 1, y: 1 }, { kind: 'shelf', x: 7, y: 1 },
      { kind: 'table', x: 6, y: 3 }, { kind: 'rug', x: 3, y: 3, w: 3, h: 2 },
    ],
  };
}

/** Inside the abandoned house, 7x6: no fire (it is dark), a crate in a corner, the door at 3,5. */
export function shed(): MapData {
  return {
    id: 'shed', name: 'The shed', version: 1, kind: 'inside', depth: 0, width: 7, height: 6,
    tiles: ['xxxxxxx', 'xpppppx', 'xpppppx', 'xpppppx', 'xpppppx', 'xxxpxxx'],
    levels: Array<string>(6).fill('0000000'),
    spawn: { x: 3, y: 4, dir: 'up' },
    exits: [{ x: 3, y: 5, w: 1, h: 1, to: 'hometown', tx: 7, ty: 3, dir: 'down' }],
    objects: [{ kind: 'crate', x: 1, y: 1 }],
  };
}

export const ref = (m: MapData) => ({ id: m.id, version: m.version });

/** A full bar that holds, as it does in town and inside (only a fire refills it). */
export const FULL: EnergyView = { value: 100, max: 100, rate: 0 };

export function welcome(map: MapData, players: PlayerView[], energy: EnergyView = FULL): Extract<ServerMsg, { t: 'welcome' }> {
  return { t: 'welcome', v: 2, you: 'me', name: 'Aldo', token: 'x'.repeat(20), map: ref(map), players, stepMs: STEP_MS, weather: 'rain', energy, serverTime: 0 };
}
