/**
 * The slab's shared rules (slab.ts): it glows only while its region is restless, a restless time is one
 * round of the surge clock, nothing grows on it, and what content may say about one.
 */
import { describe, expect, it } from 'vitest';
import { SLAB_PAIR_MS, TileMap, findTiles, slabGlows, surgeAt, surgeRound, validateItems, validateMap, type MapData } from '../src';

const RULE = { every: 100, unstable: 20, surge: 10, sweep: 5 };

describe('when the slab glows', () => {
  it('glows while the woods are restless, and not while they are calm or the surge sweeps them', () => {
    expect([10, 75, 95].map(s => slabGlows(surgeAt(RULE, s * 1000)))).toEqual([false, true, false]);
    expect(slabGlows(null)).toBe(false);
    expect(SLAB_PAIR_MS).toBe(3000);
  });

  it('counts each restless time as one round of the clock, its offset included', () => {
    expect([0, 75, 99.9, 100, 175].map(s => surgeRound(RULE, s * 1000))).toEqual([0, 0, 0, 1, 1]);
    expect(surgeRound({ ...RULE, offset: 30 }, 75 * 1000)).toBe(1);
  });
});

/** A 7x6 patch of woods that surges, a slab at 3,2 on open ground, the way home at the bottom. */
function patch(more: Partial<MapData> = {}): MapData {
  return {
    id: 'patch', name: 'The Patch', version: 1, kind: 'wilds', depth: 1, width: 7, height: 6,
    tiles: ['ttttttt', 'tgggggt', 'tgggggt', 'tgggggt', 'tgggggt', 'tttmttt'],
    levels: Array<string>(6).fill('0000000'),
    spawn: { x: 3, y: 4, dir: 'up' },
    exits: [{ x: 3, y: 5, w: 1, h: 1, to: 'town', tx: 1, ty: 1, dir: 'down', home: true }],
    objects: [{ kind: 'shrooms', x: 3, y: 2 }, { kind: 'slab', x: 3, y: 2, name: 'the slab in the patch', holds: [{ item: 'shard', count: 1 }] }],
    surge: RULE,
    ...more,
  };
}

describe('a slab on a map', () => {
  it('is walked over, even over the glowcaps drawn on its tile, and nothing grows on it', () => {
    const map = new TileMap(patch());
    expect(map.walkable(3, 2)).toBe(true);
    expect(validateMap(patch()).filter(p => p.level === 'error')).toEqual([]);
    expect(findTiles(map, { item: 'shard', map: 'patch', count: 1, respawn: [1, 2] }).some(t => t.x === 3 && t.y === 2)).toBe(false);
  });

  it('needs a name, something to hold, and restless woods to lie in', () => {
    const errors = (d: MapData) => validateMap(d).filter(p => p.level === 'error').map(p => p.message);
    const slab = { kind: 'slab' as const, x: 3, y: 2, name: '', holds: [] };
    expect(errors(patch({ objects: [slab], surge: undefined }))).toEqual([
      'slab at 3,2: it opens while the woods are restless, so it lies in wilds that surge',
      'slab at 3,2 needs a name: what the notice board calls it ("the slab in the ring of stones")',
      'slab at 3,2 holds nothing: a list of items and counts',
    ]);
  });

  it('holds things a bag carries, which exist', () => {
    const items = { version: 1, finds: [], items: [{ id: 'shard', name: 'Shard', kind: 'resource' as const, stack: 5, text: 'Warm.' }] };
    expect(validateItems(items, [patch()]).filter(p => p.level === 'error')).toEqual([]);
    const odd = patch({ objects: [{ kind: 'slab', x: 3, y: 2, name: 'the slab', holds: [{ item: 'ghost', count: 1 }] }] });
    expect(validateItems(items, [odd]).map(p => p.message)).toContain('patch: the slab at 3,2 holds ghost, which is not an item');
  });
});
