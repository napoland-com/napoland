/**
 * Small maps for the server tests, so they never depend on the real content (which changes as the
 * world grows): a town and a patch of woods, joined by a two-lane road.
 *
 *   town (10x8)                        woods (8x8, depth 1)
 *     0123456789                         01234567
 *   0 ggggrrggww  <- exit to the woods   tttttttt
 *   1 gRggrrggww     (4,0) -> (3,6)      tggggggt
 *   2 gSggrrggww     (5,0) -> (4,6)      tgttttgt
 *   3 ggggrrggww                         tgttttgt
 *   4 ggggrrggww                         tLgggggt   L: street lamp (1,4)
 *   5 ggggrrggww                         tggggggt
 *   6 ggggggggww                         tggggggt
 *   7 ggggggggww                         tttmmttt   <- home exit to town
 *   S: spawn (1,2) facing down                           (3,7) -> (4,1), (4,7) -> (5,1)
 *   R: a rock above it
 *
 * In the woods, (3,6) is dark (energy drains) and one step from home; (2,6) and (3,5) next to it
 * are in the lamp's light (energy refills). The way up the right side, (6,6) to (6,1), leads away
 * from home without light: 3 to 8 steps from the home exit.
 */
import { TileMap, type MapData } from '@napoland/shared';

export function townData(): MapData {
  return {
    id: 'town', name: 'Town', version: 1, kind: 'town', depth: 0, width: 10, height: 8,
    tiles: [...Array<string>(6).fill('ggggrrggww'), ...Array<string>(2).fill('ggggggggww')],
    levels: Array<string>(8).fill('0000000000'),
    spawn: { x: 1, y: 2, dir: 'down' },
    exits: [{ x: 4, y: 0, w: 2, h: 1, to: 'woods', tx: 3, ty: 6, dir: 'up' }],
    objects: [{ kind: 'rock', x: 1, y: 1, s: 1, v: 0 }],
  };
}

export function woodsData(): MapData {
  return {
    id: 'woods', name: 'Woods', version: 1, kind: 'wilds', depth: 1, width: 8, height: 8,
    tiles: ['tttttttt', 'tggggggt', 'tgttttgt', 'tgttttgt', 'tggggggt', 'tggggggt', 'tggggggt', 'tttmmttt'],
    levels: Array<string>(8).fill('00000000'),
    spawn: { x: 5, y: 5, dir: 'up' },
    exits: [{ x: 3, y: 7, w: 2, h: 1, to: 'town', tx: 4, ty: 1, dir: 'down', home: true }],
    objects: [{ kind: 'lamp', x: 1, y: 4 }],
  };
}

/** The town and the woods, ready for a World (home: 'town'). */
export const fixtureMaps = (): TileMap[] => [new TileMap(townData()), new TileMap(woodsData())];
