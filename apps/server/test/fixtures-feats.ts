/**
 * For the tests of feats (feats.test.ts, net-feats.test.ts), besides the fixture maps (fixtures.ts):
 *
 *   long (3x100, wilds, depth 1): a trail one tile wide, the way home at its bottom (1,99) into the
 *   town at (4,1). Tile 1,y is 99 - y steps from home: 1,15 is 84, 1,14 the first 85 (FAR_STEPS).
 *   Moss grows at 1,50 and a live shard at 1,40, each back a second after it is picked.
 *
 *   house: the fixture house with a workbench at 1,1 (stand at 1,2, facing up, to mend).
 *
 * Items: moss, nails (one at a time at 0,5 in the town), cloth, an anvil (8 kg, heavy on its own),
 * shards and live shards, a backpack and a sturdy coat, which 100 s out in the wilds wear out and 2 cloth mend.
 */
import { TileMap, type ItemsData, type MapData } from '@napoland/shared';
import { houseData, townData, woodsData } from './fixtures';

export function corridorData(): MapData {
  const h = 100;
  return {
    id: 'long', name: 'The Long Trail', version: 1, kind: 'wilds', depth: 1, width: 3, height: h,
    tiles: Array.from({ length: h }, (_, y) => (y === 0 ? 'ttt' : 'tgt')),
    levels: Array<string>(h).fill('000'),
    spawn: { x: 1, y: h - 2, dir: 'up' },
    exits: [{ x: 1, y: h - 1, w: 1, h: 1, to: 'town', tx: 4, ty: 1, dir: 'down', home: true }],
    objects: [],
  };
}

export function benchHouseData(): MapData {
  const h = houseData();
  return { ...h, objects: [...h.objects, { kind: 'workbench', x: 1, y: 1 }] };
}

/** The town, the house with its workbench, the woods and the long trail, ready for a World (home: 'town'). */
export const featMaps = (): TileMap[] => [townData(), benchHouseData(), woodsData(), corridorData()].map(d => new TileMap(d));

const gear = (id: string, slot: 'shirt' | 'bag', more: object = {}) => ({ id, name: id, kind: 'gear' as const, stack: 1, text: 'Gear.', slot, ...more });

export function featItems(): ItemsData {
  return {
    version: 1,
    items: [
      { id: 'moss', name: 'Moss', kind: 'resource', stack: 3, text: 'Soft.' },
      { id: 'nail', name: 'Nail', kind: 'resource', stack: 5, text: 'Bent.' },
      { id: 'cloth', name: 'Cloth', kind: 'resource', stack: 10, text: 'Dry.' },
      { id: 'anvil', name: 'Anvil', kind: 'resource', stack: 1, text: 'Heavy.', weight: 8 },
      { id: 'shard', name: 'Shard', kind: 'resource', stack: 5, text: 'Warm.', xp: 12 },
      { id: 'live-shard', name: 'Live shard', kind: 'resource', stack: 1, xp: 12, text: 'Burning.', live: { xp: 40, fresh: 240, fade: 5, into: 'shard' } },
      gear('coat', 'shirt', { tier: 'sturdy', resist: { cold: 0.2 } }),
      gear('backpack', 'bag', { bag: 8 }),
    ],
    finds: [
      { item: 'moss', map: 'long', around: { x: 1, y: 50, r: 0 }, count: 1, respawn: [1, 1] },
      { item: 'live-shard', map: 'long', around: { x: 1, y: 40, r: 0 }, count: 1, respawn: [1, 1] },
      { item: 'nail', map: 'town', around: { x: 0, y: 5, r: 0 }, count: 1, respawn: [1, 1] },
    ],
    wear: { sturdy: 100 },
    mend: { sturdy: [{ item: 'cloth', count: 2 }] },
  };
}

/** What someone in a coat wears. */
export const COAT = { shirt: 'coat', bag: 'backpack' };
