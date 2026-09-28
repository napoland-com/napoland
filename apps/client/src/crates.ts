/**
 * A crate for whoever comes next (shared/caches.ts), as its panel shows it: how full it is, what you may
 * still do this visit, and a row for each thing in it. Its words are said.ts's, its cards details.ts's.
 * Plain logic with no drawing, so it can be tested; hud.ts draws it.
 */
import { CACHE_SIZE, type CacheItemView } from '@napoland/shared';
import type { CrateView } from './hud';
import { iconFor } from './icons';
import type { Items } from './items';
import { CRATE_EMPTY, leftBy } from './said';

/**
 * A crate you opened: "3 of 6", what you may still do this visit, and what lies in it, the newest first
 * ("Fir resin", "left by Ana, 2 h ago"); an empty one says so. `items` have their ages as of now
 * (Game.cacheItemsNow); `me`: your id, to call your own things yours.
 */
export function crateView(c: { items: readonly CacheItemView[]; left: boolean; took: boolean }, items: Items, me: string): CrateView {
  const hint = c.left && c.took
    ? 'You took one thing and left one this time. Come by again for more.'
    : c.took ? 'You took one thing this time. Leave one for whoever comes next?'
      : c.left ? 'You left one thing this time. Take one if you need it.'
        : 'For whoever comes next: take one thing and leave one, each time you come by.';
  return {
    count: `${c.items.length} of ${CACHE_SIZE}`,
    hint,
    rows: c.items.map(e => {
      const def = items.get(e.item);
      return { id: e.id, name: def.name, icon: iconFor(def), line: leftBy(e.name, e.owner === me, e.age) };
    }),
    empty: c.items.length ? null : CRATE_EMPTY,
  };
}
