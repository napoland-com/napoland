/**
 * Small maps for the server tests, so they never depend on the real content (which changes as the
 * world grows): a town with a house, the inside of that house, and a patch of woods joined to the
 * town by a two-lane road; and for a street, the town with a road onto a lane of cabins instead of the
 * house (streetTownData, laneData).
 *
 *   town (10x8)                        woods (8x8, depth 1)
 *     0123456789                         01234567
 *   0 ggggrrgggw  <- exit to the woods   tttttttt
 *   1 gRggrrHHHw     (4,0) -> (3,6)      tggggggt
 *   2 gSggrrHDHw     (5,0) -> (4,6)      tgttFtgt   F: campfire (4,2), tended: it never goes out
 *   3 ggggrrgggw                         tgttttgt
 *   4 ggggrrgggw                         tLgggggt   L: street lamp (1,4)
 *   5 ggggrrgggw                         tggggggt
 *   6 gggggggggw                         tggggggt
 *   7 gggggggggw                         tttmmttt   <- home exit to town
 *   S: spawn (1,2) facing down                           (3,7) -> (4,1), (4,7) -> (5,1)
 *   R: a rock above it
 *   H: a house (6,1), 3x2; its door D (7,2) is the exit into it
 *
 *   house (5x5, inside)
 *     01234
 *   0 xxxxx
 *   1 xpFpx   F: fireplace (2,1)
 *   2 xpppx
 *   3 xpppx   (2,3): where the door leads, and the spawn, facing up
 *   4 xxpxx   <- exit (2,4) -> the town (7,3), facing down
 *
 * Energy holds in the town and in the house, except on the tiles around the fireplace ((1,1) to (3,2))
 * where it comes back. In the woods it drains, street light or not: (3,6), where the road from town
 * arrives, is one step from home, and (2,6) and (3,5) next to it are in the lamp's light. The way up
 * the right side, (6,6) to (6,1), leads away from home: 3 to 8 steps from the home exit. At its end,
 * (3,1) to (5,1) are next to the campfire, where energy comes back.
 *
 * Items (itemsData), made up for the tests: moss and nails to find, and tea to drink.
 *   moss: one at a time in the woods, on a tile next to the campfire: (3,1), (4,1) or (5,1). From
 *         (4,1) you reach all three; from (1,1) none.
 *   nail: two at a time in the town, around the rock: the 8 tiles from (0,0) to (2,2), the spawn (1,2) among them.
 *   tea:  +30 energy; it grows nowhere, tests put it in bags.
 */
import { TileMap, type ItemsData, type MapData } from '@napoland/shared';

export function townData(): MapData {
  return {
    id: 'town', name: 'Town', version: 1, kind: 'town', depth: 0, width: 10, height: 8,
    tiles: [...Array<string>(6).fill('ggggrrgggw'), ...Array<string>(2).fill('gggggggggw')],
    levels: Array<string>(8).fill('0000000000'),
    spawn: { x: 1, y: 2, dir: 'down' },
    exits: [
      { x: 4, y: 0, w: 2, h: 1, to: 'woods', tx: 3, ty: 6, dir: 'up' },
      { x: 7, y: 2, w: 1, h: 1, to: 'house', tx: 2, ty: 3, dir: 'up' },
    ],
    objects: [
      { kind: 'rock', x: 1, y: 1, s: 1, v: 0 },
      { kind: 'house', x: 6, y: 1, w: 3, h: 2, roof: '#6b7075', lit: 1 },
    ],
  };
}

export function houseData(): MapData {
  return {
    id: 'house', name: 'House', version: 1, kind: 'inside', depth: 0, width: 5, height: 5,
    tiles: ['xxxxx', 'xpppx', 'xpppx', 'xpppx', 'xxpxx'],
    levels: Array<string>(5).fill('00000'),
    spawn: { x: 2, y: 3, dir: 'up' },
    exits: [{ x: 2, y: 4, w: 1, h: 1, to: 'town', tx: 7, ty: 3, dir: 'down' }],
    objects: [{ kind: 'fireplace', x: 2, y: 1 }],
  };
}

export function woodsData(): MapData {
  return {
    id: 'woods', name: 'Woods', version: 1, kind: 'wilds', depth: 1, width: 8, height: 8,
    tiles: ['tttttttt', 'tggggggt', 'tgttgtgt', 'tgttttgt', 'tggggggt', 'tggggggt', 'tggggggt', 'tttmmttt'],
    levels: Array<string>(8).fill('00000000'),
    spawn: { x: 5, y: 5, dir: 'up' },
    exits: [{ x: 3, y: 7, w: 2, h: 1, to: 'town', tx: 4, ty: 1, dir: 'down', home: true }],
    objects: [
      { kind: 'lamp', x: 1, y: 4 },
      // Tended: the tests of energy need a campfire that never goes out. Fires that burn down have tests of their own.
      { kind: 'fireplace', x: 4, y: 2, tended: true },
    ],
  };
}

/** The town, the house and the woods, ready for a World (home: 'town'). */
export const fixtureMaps = (): TileMap[] => [new TileMap(townData()), new TileMap(houseData()), new TileMap(woodsData())];

/** The same, with a chest in the house at 3,1, beside the fireplace: stand at 3,2 facing up to reach it. */
export const chestMaps = (): TileMap[] => {
  const h = houseData();
  return [new TileMap(townData()), new TileMap({ ...h, objects: [...h.objects, { kind: 'chest', x: 3, y: 1 }] }), new TileMap(woodsData())];
};

/** Where moss grows in the woods: the tiles next to the campfire. */
export const MOSS_TILES = [{ x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 }];

/**
 * The town of a street (streets.test.ts, visits.test.ts): townData without its house. Its road off the
 * bottom edge, (4,7) and (5,7), leads onto laneData's lane where the road comes in, (6,4) and (7,4).
 */
export function streetTownData(): MapData {
  const t = townData();
  return {
    ...t,
    exits: [...t.exits.filter(e => e.to !== 'house'), { x: 4, y: 7, w: 2, h: 1, to: 'lane', tx: 6, ty: 4, dir: 'up' }],
    objects: t.objects.filter(o => o.kind !== 'house'),
  };
}

/**
 * A street of three lots (every street is a copy of it), each door into the home (`house`, a private room
 * whose door leads back out onto it): the lane's end leads back onto the town's road, at its 4,6.
 *
 *   lane (13x6, a street)
 *     0123456789012
 *   0 ttttttttttttt
 *   1 tHHHgHHHgHHHt
 *   2 tHDHgHDHgHDHt   D: the lots' doors, 0 (2,2), 1 (6,2), 2 (10,2): into the home, at its 2,3
 *   3 tgggggggggggt
 *   4 tgggggggggggt   (6,4): where the road from town comes in, the spawn, facing up
 *   5 ttttttggttttt   (6,5) and (7,5): the lane's end, to the town's 4,6
 */
export function laneData(): MapData {
  const house = (x: number) => ({ kind: 'house' as const, x, y: 1, w: 3, h: 2, roof: '#6b7075', lit: 0 as const, plate: true as const });
  return {
    id: 'lane', name: 'The Lane', version: 1, kind: 'town', depth: 0, width: 13, height: 6, street: true,
    tiles: ['ttttttttttttt', ...Array<string>(4).fill('tgggggggggggt'), 'ttttttggttttt'],
    levels: Array<string>(6).fill('0000000000000'),
    spawn: { x: 6, y: 4, dir: 'up' },
    exits: [
      ...[2, 6, 10].map(x => ({ x, y: 2, w: 1, h: 1, to: 'house', tx: 2, ty: 3, dir: 'up' as const })),
      { x: 6, y: 5, w: 2, h: 1, to: 'town', tx: 4, ty: 6, dir: 'up' },
    ],
    objects: [house(1), house(5), house(9)],
  };
}

export function itemsData(): ItemsData {
  return {
    version: 4,
    items: [
      { id: 'moss', name: 'Moss', kind: 'resource', stack: 3, text: 'Soft and damp.' },
      { id: 'nail', name: 'Nail', kind: 'resource', stack: 5, text: 'Bent, but it will do.' },
      { id: 'tea', name: 'Tea', kind: 'consumable', stack: 2, text: 'Still warm.', use: { energy: 30 } },
    ],
    finds: [
      { item: 'moss', map: 'woods', near: { kinds: ['fireplace'], radius: 1.5 }, count: 1, respawn: [10, 20] },
      { item: 'nail', map: 'town', near: { kinds: ['rock'], radius: 1.5 }, count: 2, respawn: [30, 60] },
    ],
  };
}
