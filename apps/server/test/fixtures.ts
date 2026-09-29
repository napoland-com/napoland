/**
 * Small maps for the server tests, so they never depend on the real content (which changes as the
 * world grows): a town with a house, the inside of that house, and a patch of woods joined to the
 * town by a two-lane road; and for homes, the town with NAPO's teleport instead of the house, a garden and
 * the home in it (homeTownData, gardenData, homeRoomData).
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
import { TileMap, type ItemsData, type MapData, type ShopData } from '@napoland/shared';
import type { ShopSettings } from '../src/config';

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
 * The home town of a world of homes (homes.test.ts and others): townData without its house, and NAPO's
 * teleport by its road at 8,5, the twin of the one in every home: it sets you down at 8,6, facing down.
 */
export function homeTownData(): MapData {
  const t = townData();
  return {
    ...t,
    exits: t.exits.filter(e => e.to !== 'house'),
    objects: [...t.objects.filter(o => o.kind !== 'house'), { kind: 'teleport', x: 8, y: 5 }],
  };
}

/**
 * The garden of a home of one's own (every player's is a copy of it, the server's zones): the house, 5 by 3
 * with a name plate by its door, whose door leads into room `room` at `into` (its 2,4); forest all round,
 * and no other way out (home is reached by NAPO's teleport).
 *
 *   garden (9x7, private)
 *     012345678
 *   0 ttttttttt
 *   1 tHHHHHggt
 *   2 tHHHHHggt
 *   3 tHHDHHggt   D: the house's door (3,3), into the room at its 2,4, facing up
 *   4 tgggggggt   (3,4): in front of it, where the room's way out comes out, facing down; the spawn
 *   5 tgggggggt
 *   6 ttttttttt
 */
export function gardenData(room = 'house', into = { x: 2, y: 4 }): MapData {
  return {
    id: 'garden', name: 'Garden', version: 1, kind: 'town', depth: 0, width: 9, height: 7, private: true,
    tiles: ['ttttttttt', ...Array<string>(5).fill('tgggggggt'), 'ttttttttt'],
    levels: Array<string>(7).fill('000000000'),
    spawn: { x: 3, y: 4, dir: 'down' },
    exits: [{ x: 3, y: 3, w: 1, h: 1, to: room, tx: into.x, ty: into.y, dir: 'up' }],
    objects: [{ kind: 'house', x: 1, y: 1, w: 5, h: 3, roof: '#5d4a3b', lit: 0, plate: true }],
  };
}

/**
 * A home of one's own (the private room, the house's inside) whose door opens into gardenData's garden,
 * with everything a home has: the fire you wake up by, the chest, the workbench, NAPO's teleport, places for
 * furniture, and what the house opens as it is built up (house.ts: the kitchen, the map table).
 *
 *   house (7x6, private)
 *     0123456
 *   0 xxxxxxx
 *   1 xWFHTsx   W workbench (1,1), F fire (2,1), H chest (3,1), T teleport (4,1): it sets you down at 4,2; s the shelf's place (5,1)
 *   2 xpzpppx   z where you wake up (2,2); 1,2 to 3,2 are warm
 *   3 xoppKMx   o the stove's place (1,3); K the kitchen (4,3), from level 2; M the map table (5,3), from level 3
 *   4 xpppppx   (2,4): where the garden's door leads in, facing up
 *   5 xxpxxxx   (2,5): out into the garden, in front of the house's door
 */
export function homeRoomData(): MapData {
  return {
    id: 'house', name: 'Home', version: 1, kind: 'inside', depth: 0, width: 7, height: 6,
    tiles: ['xxxxxxx', 'xpppppx', 'xpppppx', 'xpppppx', 'xpppppx', 'xxpxxxx'],
    levels: Array<string>(6).fill('0000000'),
    spawn: { x: 2, y: 4, dir: 'up' },
    exits: [{ x: 2, y: 5, w: 1, h: 1, to: 'garden', tx: 3, ty: 4, dir: 'down' }],
    objects: [
      { kind: 'workbench', x: 1, y: 1 }, { kind: 'fireplace', x: 2, y: 1 }, { kind: 'chest', x: 3, y: 1 }, { kind: 'teleport', x: 4, y: 1 },
      { kind: 'comfort', x: 5, y: 1, what: 'shelf' }, { kind: 'comfort', x: 1, y: 3, what: 'stove' },
      { kind: 'kitchen', x: 4, y: 3, house: 2 }, { kind: 'board', x: 5, y: 3, house: 3 },
    ],
    private: true,
    wake: { x: 2, y: 2, dir: 'down' },
  };
}

/** The world of homes, ready for a World (home: 'town'): the town with its teleport, the garden, the home, the woods. */
export const homeMaps = (): TileMap[] => [new TileMap(homeTownData()), new TileMap(gardenData()), new TileMap(homeRoomData()), new TileMap(woodsData())];

/** The levels a house is built up to in the tests (house.ts): a garage, then a cabin for 2 nails, then a house for 3 nails and a moss. */
export const HOUSE_LEVELS = [
  { name: 'Garage', text: 'Where it starts.' },
  { name: 'Cabin', needs: [{ item: 'nail', count: 2 }], text: 'A kitchen by the fire.' },
  { name: 'House', needs: [{ item: 'nail', count: 3 }, { item: 'moss', count: 1 }], text: 'A map table.' },
];

/** What a test shop sells: an outfit, a jacket pattern and a name tag badge, priced in euros and francs. */
export function shopData(): ShopData {
  return {
    version: 3,
    looks: [
      { id: 'winter-parka', kind: 'outfit', name: 'Winter parka', noun: 'the winter parka', text: 'A long parka.', prices: { eur: 299, chf: 290 } },
      { id: 'argyle', kind: 'pattern', name: 'Argyle', noun: 'the argyle pattern', text: 'Diamonds.', prices: { eur: 149, chf: 150 } },
      { id: 'heart', kind: 'badge', name: 'Heart', noun: 'the heart badge', text: 'A heart.', prices: { eur: 99, chf: 100 } },
    ],
  };
}

/**
 * A made-up Stripe key or secret of a kind ('sk_test', 'rk_live', 'whsec'...), never a real one. It is put
 * together here rather than written out whole, so that no secret scanner takes the tests for a leaked key
 * and stops a push.
 */
export const fakeKey = (kind: string, rest = '51FakeKeyForTheTestsOnly0000000000') => `${kind}_${rest}`;

/** How a test shop is set up: open, in Stripe's test mode, in euros. The keys are made up: never a real one. */
export const shopSettings = (more: Partial<ShopSettings> = {}): ShopSettings => ({
  secretKey: fakeKey('sk_test'), webhookSecret: fakeKey('whsec', 'FakeSigningSecret0000000000'), terms: 'https://example.test/terms', currency: 'eur',
  publicUrl: 'https://play.example.test', api: 'https://api.stripe.com', live: false, ...more,
});

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
