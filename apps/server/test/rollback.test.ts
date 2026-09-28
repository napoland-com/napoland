/**
 * Rolling back to this release from a newer one loses nothing the newer one saved: an item this release
 * has no definition of (in the bag, in the stash with its pieces, in what was taken out) and a count it
 * does not keep are set aside as saved, never shown or used, and written back with every save, like the
 * tools a newer release gave. (Taking a database backup before a release that changes saved data, and
 * restoring it to roll back past it, is in docs/OPERATIONS.md.) World rules and memory storage; the same
 * helper runs on a real database in storage-pg.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { BagSlot } from '@napoland/shared';
import { MemoryStorage, type PlayerRecord } from '../src/storage';
import { World } from '../src/world';
import { chestMaps, itemsData } from './fixtures';
import { keepsWhatANewerReleaseSaved } from './helpers';

/** The fixture house has a chest at 3,1: stand at 3,2 to reach it. */
const rec = (more: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id: 'a', name: 'A', tokenHash: 'h', authSub: null, map: 'house', x: 3, y: 2, dir: 'up', color: '#fff', energy: 100, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});
const LANTERN = { item: 'lantern', count: 1, piece: { cond: 0.5, glow: 3 } } as BagSlot;

describe('what a newer release saved', () => {
  it('is kept through play: stashing, taking out and using the stash leave the stash\'s unknown items and counts as they were', () => {
    const w = new World(chestMaps(), 'town', 'overcast', { items: itemsData(), rng: () => 0 });
    w.join(rec({
      bag: [{ item: 'moss', count: 2 }, LANTERN],
      stats: { found: 3, sparks: 9 } as never,
      stash: { items: { moss: 1, lantern: 2 }, out: { lantern: 1 }, pieces: { lantern: [{ cond: 1 }, { cond: 0.2 }] } },
    }), 0);
    w.store('a', 3, 1, undefined, 1000);
    w.take('a', 3, 1, 'moss', 1, 2000);
    const after = w.get('a')!;
    expect(after.bag).toEqual([{ item: 'moss', count: 1 }]);
    expect(after.kept).toEqual({ bag: [LANTERN] });
    expect(after.stash).toEqual({ items: { moss: 2, lantern: 2 }, out: { lantern: 1, moss: 1 }, pieces: { lantern: [{ cond: 1 }, { cond: 0.2 }] } });
    expect(after.stats).toMatchObject({ found: 3, sparks: 9 });
    // Nothing of it reaches the player.
    const msgs = w.drain().flatMap(o => (o.to === 'a' ? [o.msg] : []));
    expect(JSON.stringify(msgs)).not.toContain('lantern');
  });

  it('comes back with the player after they leave and come back, a replaced session and a quick reconnect alike', () => {
    const w = new World(chestMaps(), 'town', 'overcast', { items: itemsData(), rng: () => 0 });
    w.join(rec({ bag: [LANTERN, { item: 'nail', count: 1 }] }), 0);
    const left = w.leave('a', 1000)!;
    expect(left.kept).toEqual({ bag: [LANTERN] });
    // The record they left with, straight back (net.ts: another tab, or saves still on their way).
    w.join(left, 2000);
    expect(w.get('a')!.kept).toEqual({ bag: [LANTERN] });
    expect(w.get('a')!.bag).toEqual([{ item: 'nail', count: 1 }]);
  });

  it('is written back by memory storage as it was saved', async () => {
    await keepsWhatANewerReleaseSaved(new MemoryStorage(), itemsData());
  });
});
