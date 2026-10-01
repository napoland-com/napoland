import { describe, expect, it } from 'vitest';
import {
  CACHE_NEAR, CACHE_SIZE, PIECES, STARTER_TOOLS, TileMap, addAllToBag, addToBag, cacheTakes, findTiles, halfOf, itemIndex, liveEnds, liveXp, merge, quarterOf, takeFromBag, takeItem, toolsOf, validateItems,
  type FindRule, type ItemDef, type ItemsData, type MapData,
} from '../src';

const glowcap: ItemDef = { id: 'glowcap', name: 'Glowcap', kind: 'resource', stack: 10, text: 'Glows after rain.' };
const shard: ItemDef = { id: 'shard', name: 'Anomaly shard', kind: 'resource', stack: 3, text: 'Warm to the touch.' };
const thermos: ItemDef = { id: 'thermos', name: 'Thermos', kind: 'consumable', stack: 2, text: 'Still hot.', use: { energy: 30 } };
const items = itemIndex({ version: 1, items: [glowcap, shard, thermos], finds: [] });

/** A 6x5 patch of wilds: a trail from the home exit at the bottom, a car at the top right. */
function woods(): MapData {
  return {
    id: 'woods', name: 'Woods', version: 1, kind: 'wilds', depth: 1, width: 6, height: 5,
    tiles: ['gggmgg', 'gtttgg', 'gtfffg', 'gtttgg', 'tttmtt'],
    levels: Array<string>(5).fill('000000'),
    spawn: { x: 3, y: 3, dir: 'up' },
    exits: [{ x: 3, y: 4, w: 1, h: 1, to: 'town', tx: 0, ty: 0, dir: 'down', home: true }],
    objects: [{ kind: 'car', x: 4, y: 0, w: 2 }],
  };
}

describe('the bag', () => {
  it('tops up slots that hold the same item before starting new ones', () => {
    let r = addToBag([], glowcap, 7);
    expect(r).toEqual({ bag: [{ item: 'glowcap', count: 7 }], left: 0 });
    r = addToBag(r.bag, glowcap, 5);
    expect(r.bag).toEqual([{ item: 'glowcap', count: 10 }, { item: 'glowcap', count: 2 }]);
  });
  it('says how many did not fit, and never changes the bag it was given', () => {
    const full = Array.from({ length: 8 }, () => ({ item: 'shard', count: 3 }));
    const r = addToBag(full, shard, 2);
    expect(r.left).toBe(2);
    expect(r.bag).toEqual(full);
    const small = addToBag([], shard, 7, 2);
    expect(small).toEqual({ bag: [{ item: 'shard', count: 3 }, { item: 'shard', count: 3 }], left: 1 });
  });
  it('puts several stacks in and brings back what is left, skipping items that no longer exist', () => {
    const r = addAllToBag([], [{ item: 'glowcap', count: 4 }, { item: 'gone', count: 1 }, { item: 'shard', count: 7 }], items, 2);
    expect(r.bag).toEqual([{ item: 'glowcap', count: 4 }, { item: 'shard', count: 3 }]);
    expect(r.left).toEqual([{ item: 'shard', count: 4 }]);
  });
  it('takes some or all out of a slot', () => {
    const bag = [{ item: 'glowcap', count: 4 }, { item: 'thermos', count: 1 }];
    expect(takeFromBag(bag, 0, 1)).toEqual([{ item: 'glowcap', count: 3 }, { item: 'thermos', count: 1 }]);
    expect(takeFromBag(bag, 1)).toEqual([{ item: 'glowcap', count: 4 }]);
    expect(takeFromBag(bag, 5)).toEqual(bag);
  });
  it('takes several of one item: from the slot asked for, then from the others that hold it, never more than there is', () => {
    const bag = [{ item: 'glowcap', count: 4 }, { item: 'thermos', count: 1 }, { item: 'glowcap', count: 10 }, { item: 'glowcap', count: 2 }];
    expect(takeItem(bag, 0, 3)).toEqual({ bag: [{ item: 'glowcap', count: 1 }, ...bag.slice(1)], taken: 3 });
    expect(takeItem(bag, 2, 12)).toEqual({ bag: [{ item: 'glowcap', count: 2 }, { item: 'thermos', count: 1 }, { item: 'glowcap', count: 2 }], taken: 12 });
    expect(takeItem(bag, 3, 99)).toEqual({ bag: [{ item: 'thermos', count: 1 }], taken: 16 });
    expect(takeItem(bag, 1, 5)).toEqual({ bag: [bag[0], bag[2], bag[3]], taken: 1 });
    // Nothing asked, or nothing there: nothing taken, and the bag it was given is left alone.
    expect(takeItem(bag, 0, 0).taken).toBe(0);
    expect(takeItem(bag, 9, 3)).toEqual({ bag, taken: 0 });
    expect(bag).toEqual([{ item: 'glowcap', count: 4 }, { item: 'thermos', count: 1 }, { item: 'glowcap', count: 10 }, { item: 'glowcap', count: 2 }]);
    // A live one keeps when it was picked, whatever is taken around it.
    const live = [{ item: 'shard', count: 1, since: 5 }, { item: 'shard', count: 1, since: 9 }];
    expect(takeItem(live, 1, 1)).toEqual({ bag: [{ item: 'shard', count: 1, since: 5 }], taken: 1 });
  });

  it('joins equal items', () => {
    expect(merge([{ item: 'a', count: 2 }, { item: 'b', count: 1 }, { item: 'a', count: 3 }, { item: 'c', count: 0 }])).toEqual([{ item: 'a', count: 5 }, { item: 'b', count: 1 }]);
  });
});

describe('half a pile', () => {
  const pile = [{ item: 'glowcap', count: 7 }, { item: 'shard', count: 2 }, { item: 'thermos', count: 1 }];
  const count = (s: { count: number }[]) => s.reduce((n, x) => n + x.count, 0);
  it('gives exactly half, with an odd one out going either way', () => {
    let rolls = 0;
    const seq = [0.1, 0.9, 0.4, 0.6, 0.2, 0.8, 0.3, 0.7, 0.5, 0.05, 0.95];
    const rng = () => seq[rolls++ % seq.length]!;
    const half = halfOf(pile, rng);
    expect([5]).toContain(count(half)); // 10 units: exactly 5
    for (const s of half) expect(s.count).toBeLessThanOrEqual(pile.find(p => p.item === s.item)!.count);
    const odd = [{ item: 'glowcap', count: 3 }];
    expect(count(halfOf(odd, () => 0.1))).toBe(2); // the coin toss says yes
    expect(count(halfOf(odd, () => 0.9))).toBe(1);
  });
  it('picks different units each time, and on average half of each kind', () => {
    let seed = 7;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const got = new Map<string, number>();
    for (let i = 0; i < 2000; i++) for (const s of halfOf(pile, rng)) got.set(s.item, (got.get(s.item) ?? 0) + s.count);
    expect(got.get('glowcap')! / 2000).toBeCloseTo(3.5, 0);
    expect(got.get('thermos')! / 2000).toBeCloseTo(0.5, 1);
  });
});

describe('where finds grow', () => {
  const map = new TileMap(woods());
  it('keeps to walkable tiles off the exits, the kinds asked for, the distance and the nearness', () => {
    const all = findTiles(map, { item: 'glowcap', map: 'woods', count: 1, respawn: [1, 2] });
    expect(all).not.toContainEqual({ x: 3, y: 4 }); // the exit
    expect(all).not.toContainEqual({ x: 1, y: 1 }); // forest
    expect(findTiles(map, { item: 'glowcap', map: 'woods', on: ['ferns'], count: 1, respawn: [1, 2] })).toEqual([{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }]);
    const far = findTiles(map, { item: 'shard', map: 'woods', steps: [6, 99], count: 1, respawn: [1, 2] });
    for (const t of far) expect(map.homeSteps(t.x, t.y)).toBeGreaterThanOrEqual(6);
    const byCar = findTiles(map, { item: 'shard', map: 'woods', near: { kinds: ['car'], radius: 1.5 }, count: 1, respawn: [1, 2] });
    expect(byCar.length).toBeGreaterThan(0);
    for (const t of byCar) expect(Math.hypot(t.x - 4, t.y - 0)).toBeLessThanOrEqual(1.5);
  });
});

describe('the tools a player owns', () => {
  const tool = (id: string): ItemDef => ({ id, name: id, kind: 'tool', stack: 1, icon: 'map', text: 'Yours.' });
  const known = itemIndex({ version: 1, items: [tool('stonebrook-map'), tool('near-woods-map'), tool('south-road-map'), tool('reservoir-map'), tool('radio'), glowcap], finds: [] });

  it('are the starter tools for someone who never got one of their own, as far as they are tools here', () => {
    expect(toolsOf(undefined, known)).toEqual([...STARTER_TOOLS]);
    expect(toolsOf(undefined, itemIndex({ version: 1, items: [tool('near-woods-map')], finds: [] }))).toEqual(['near-woods-map']);
  });

  it('are the saved list otherwise, in the order they came, without what is no tool here (a newer release\'s, kept in the save)', () => {
    expect(toolsOf(['near-woods-map', 'radio', 'stonebrook-map'], known)).toEqual(['near-woods-map', 'radio', 'stonebrook-map']);
    expect(toolsOf(['stonebrook-map', 'bolt-cutters', 'glowcap', 'radio'], known)).toEqual(['stonebrook-map', 'radio']);
    expect(toolsOf([], known)).toEqual([]);
  });
});

describe('live finds', () => {
  const plain: ItemDef = { id: 'shard', name: 'Anomaly shard', kind: 'resource', stack: 5, xp: 12, text: 'Warm.' };
  const live: ItemDef = { id: 'live-shard', name: 'Live shard', kind: 'resource', stack: 1, xp: 12, text: 'Burning.', live: { xp: 40, fresh: 240, fade: 5, into: 'shard' } };

  it('are worth their most while fresh, then 5 XP less a minute, never below what they turn into', () => {
    expect([0, 240, 241, 300, 420, 600].map(s => liveXp(live, s, plain))).toEqual([40, 40, 35, 35, 25, 12]);
    expect(liveEnds(live, plain)).toBe(600);
  });

  it('keep when they were picked when repacked', () => {
    const r = addAllToBag([], [{ item: 'live-shard', count: 1, since: 5 }, { item: 'shard', count: 1 }], itemIndex({ version: 1, items: [plain, live], finds: [] }));
    expect(r.bag).toEqual([{ item: 'live-shard', count: 1, since: 5 }, { item: 'shard', count: 1 }]);
  });

  it('are checked: they turn into a plain item worth less, fade by numbers above 0 and stack one to a slot', () => {
    const errors = (l: ItemDef, into: ItemDef = plain) =>
      validateItems({ version: 1, items: [into, l], finds: [] }, [woods()]).filter(p => p.level === 'error').map(p => p.message);
    expect(errors(live)).toEqual([]);
    expect(errors({ ...live, live: { ...live.live!, into: 'nothing' } }).join()).toMatch(/not an item/);
    expect(errors(live, { ...plain, live: { xp: 50, fresh: 1, fade: 1, into: 'live-shard' } }).join()).toMatch(/live too/);
    expect(errors({ ...live, live: { ...live.live!, xp: 12 } }).join()).toMatch(/worth more XP/);
    expect(errors({ ...live, live: { ...live.live!, fade: 0 } }).join()).toMatch(/above 0/);
    expect(errors({ ...live, live: { ...live.live!, fresh: -1 } }).join()).toMatch(/above 0/);
    expect(errors({ ...live, stack: 2 }).join()).toMatch(/one to a slot/);
  });
});

describe('validateItems', () => {
  /** A paper map of the test woods, as the starter tools are. */
  const mapOf = (id: string): ItemDef => ({ id, name: 'Map', kind: 'tool', stack: 1, chart: 'woods', icon: 'map', text: 'Old.' });
  /** The starter tools besides the one a test looks at: once there are tools at all, they must be there. */
  const starters = [mapOf('stonebrook-map'), mapOf('south-road-map'), mapOf('reservoir-map')];

  it('checks tools: one to a slot, never used up, weightless, charting a real map, with an icon for their button', () => {
    const errors = (tool: ItemDef) => validateItems({ version: 1, items: [tool, ...starters], finds: [] }, [woods()]).filter(p => p.level === 'error').map(p => p.message);
    const map = mapOf('near-woods-map');
    expect(errors(map)).toEqual([]);
    expect(errors({ ...map, chart: 'nowhere' })).toEqual(['item "near-woods-map": charts nowhere, which is not a map']);
    expect(errors({ ...map, weight: 0.1 })).toEqual(['item "near-woods-map": a tool is never used up, weighs nothing and earns no XP']);
    expect(errors({ ...map, live: { xp: 40, fresh: 60, fade: 5, into: 'stonebrook-map' } })).toContain('item "near-woods-map": a tool is never used up, weighs nothing and earns no XP');
    expect(errors({ ...map, kind: 'resource' })).toEqual([
      'item "near-woods-map": only a tool charts a map', 'item "near-woods-map": only a tool has an icon (everything else is drawn by its id)', 'the starter tool near-woods-map is not a tool',
    ]);
    // Its button in the bag's header needs a drawing the client has.
    const noIcon = ['item "near-woods-map": a tool needs an icon for its button in the bag\'s header (map, radio, cutters, waders, lantern, crampons)'];
    expect(errors({ ...map, icon: undefined })).toEqual(noIcon);
    expect(errors({ ...map, icon: 'kettle' as never })).toEqual(noIcon);
    expect(errors({ ...map, icon: 'radio' })).toEqual([]);
    // A tool needs a name and words, like every item.
    expect(errors({ ...map, name: ' ', text: '' })).toEqual(['item "near-woods-map" has no name', 'item "near-woods-map" has no text']);
  });

  it('wants every starter tool once there are tools at all: whoever never got one of their own carries them', () => {
    const radio: ItemDef = { id: 'radio', name: 'Radio', kind: 'tool', stack: 1, icon: 'map', text: 'It crackles.' };
    const errors = validateItems({ version: 1, items: [radio], finds: [] }, [woods()]).map(p => p.message);
    expect(errors).toEqual(['the starter tool stonebrook-map is not an item', 'the starter tool near-woods-map is not an item', 'the starter tool south-road-map is not an item', 'the starter tool reservoir-map is not an item']);
    expect(validateItems({ version: 1, items: [radio, mapOf('near-woods-map'), ...starters], finds: [] }, [woods()])).toEqual([]);
  });

  it('lets a recipe and a find give a tool, one at a time, and never pays with a tool or turns something into one', () => {
    const radio: ItemDef = { id: 'radio', name: 'Radio', kind: 'tool', stack: 1, icon: 'map', text: 'It crackles.' };
    const strange: ItemDef = { id: 'strange', name: 'Strange object', kind: 'resource', stack: 1, text: 'Odd.', use: { identify: true }, reveals: [{ item: 'shard', count: 1, weight: 1 }] };
    const base: ItemsData = {
      version: 1,
      items: [shard, strange, radio, mapOf('near-woods-map'), ...starters],
      finds: [{ item: 'radio', map: 'woods', count: 1, respawn: [60, 120] }],
      recipes: [{ id: 'radio', make: 'radio', needs: [{ item: 'shard', count: 2 }] }],
      mend: { sturdy: [{ item: 'shard', count: 1 }] },
    };
    const errors = (data: Partial<ItemsData>) => validateItems({ ...base, ...data }, [woods()]).filter(p => p.level === 'error').map(p => p.message);
    expect(errors({})).toEqual([]);
    expect(errors({ recipes: [{ id: 'radio', make: 'radio', count: 1, needs: [{ item: 'shard', count: 2 }] }] })).toEqual([]);
    expect(errors({ recipes: [{ id: 'radio', make: 'radio', count: 2, needs: [{ item: 'shard', count: 2 }] }] })).toEqual(['recipe "radio" makes radio, a tool, which is yours once: count is 1 or left out']);
    expect(errors({ recipes: [{ id: 'shards', make: 'shard', needs: [{ item: 'radio', count: 1 }] }] })).toEqual(['recipe "shards" needs radio, a tool: tools are never used up']);
    expect(errors({ mend: { sturdy: [{ item: 'near-woods-map', count: 1 }] } })).toEqual(['mend: sturdy needs near-woods-map, a tool: tools are never used up']);
    expect(errors({ items: [shard, { ...strange, reveals: [{ item: 'radio', count: 1, weight: 1 }] }, radio, mapOf('near-woods-map'), ...starters] }))
      .toEqual(['item "strange" reveals radio, a tool: tools are made at the workbench or found']);
  });

  it('checks what a tool listens for: only a tool listens, loud nearer than faint, for items that lie out there, always or on aurora nights', () => {
    const senses = { finds: [{ item: 'shard' }, { item: 'glowcap', when: 'aurora' as const }], loud: 6, faint: 15 };
    const radio: ItemDef = { id: 'radio', name: 'Radio', kind: 'tool', stack: 1, icon: 'radio', text: 'It crackles.', senses };
    const finds: ItemsData['finds'] = [{ item: 'shard', map: 'woods', count: 1, respawn: [60, 120] }, { item: 'glowcap', map: 'woods', count: 1, respawn: [60, 120] }];
    const problems = (r: Partial<ItemDef>, data: Partial<ItemsData> = {}) =>
      validateItems({ version: 1, items: [shard, glowcap, thermos, { ...radio, ...r }, mapOf('near-woods-map'), ...starters], finds, ...data }, [woods()]).map(p => `${p.level}: ${p.message}`);
    expect(problems({})).toEqual([]);
    const reach = ['error: item "radio": it hears loud within some tiles above 0, and faint within more'];
    expect(problems({ senses: { ...senses, faint: 6 } })).toEqual(reach);
    expect(problems({ senses: { ...senses, loud: 0 } })).toEqual(reach);
    expect(problems({ senses: { ...senses, finds: [] } })).toEqual(['error: item "radio": it listens for nothing']);
    expect(problems({ senses: { ...senses, finds: [{ item: 'shard', when: 'storm' as never }] } })).toEqual(['error: item "radio": it hears shard always, or only on aurora nights (when: aurora)']);
    expect(problems({ senses: { ...senses, finds: [{ item: 'ghost' }] } })).toEqual(['error: item "radio" listens for ghost, which is not an item']);
    // Something that never lies out there can be listened for, but it will never be heard.
    expect(problems({ senses: { ...senses, finds: [{ item: 'thermos' }] } })).toEqual(['warning: item "radio" listens for thermos, which grows nowhere']);
    expect(problems({ kind: 'resource', icon: undefined })).toContain('error: item "radio": only a tool listens (senses)');
  });

  const good: ItemsData = {
    version: 1,
    items: [glowcap, shard, thermos],
    finds: [{ item: 'glowcap', map: 'woods', count: 2, respawn: [60, 120] }],
  };
  it('passes good items and finds', () => {
    expect(validateItems(good, [woods()])).toEqual([]);
  });
  it('catches broken items and finds', () => {
    const bad: ItemsData = {
      version: 1,
      items: [glowcap, { ...glowcap }, { ...thermos, id: 'empty', use: {} }, { ...shard, id: 'Shard!', stack: 0 }],
      finds: [
        { item: 'nothing', map: 'woods', count: 1, respawn: [1, 2] },
        { item: 'glowcap', map: 'nowhere', count: 1, respawn: [1, 2] },
        { item: 'glowcap', map: 'woods', count: 50, respawn: [5, 1] },
        { item: 'glowcap', map: 'woods', on: ['ferns'], count: 2, respawn: [1, 2] },
      ],
    };
    const msgs = validateItems(bad, [woods()]).map(p => `${p.level}: ${p.message}`).join('\n');
    expect(msgs).toMatch(/"glowcap" is defined twice/);
    expect(msgs).toMatch(/"empty" is a consumable that does nothing/);
    expect(msgs).toMatch(/"Shard!": ids are lowercase/);
    expect(msgs).toMatch(/stack must be a whole number/);
    expect(msgs).toMatch(/there is no item nothing/);
    expect(msgs).toMatch(/there is no map nowhere/);
    expect(msgs).toMatch(/respawn is \[shortest, longest\]/);
    expect(msgs).toMatch(/warning: find 3 .*only 3 tiles fit the rule for 2 finds/);
  });
});

describe('a crate for whoever comes next', () => {
  it('takes what you find and make, never gear or a tool; six things at most', () => {
    const coat: ItemDef = { id: 'coat', name: 'Coat', kind: 'gear', stack: 1, slot: 'shirt', text: 'Warm.' };
    const chart: ItemDef = { id: 'woods-map', name: 'Map of the woods', kind: 'tool', stack: 1, text: 'Folded.' };
    const pebble: ItemDef = { id: 'pebble', name: 'Warm pebble', kind: 'charm', stack: 1, text: 'Warm.', charm: { wetting: 0.6 } };
    const lockbox: ItemDef = { id: 'lockbox', name: 'NAPO lockbox', kind: 'sealed', stack: 1, text: 'Locked.', holds: [{ weight: 1, items: [{ item: 'glowcap', count: 2 }] }] };
    expect([glowcap, thermos, pebble].map(cacheTakes)).toEqual([true, true, true]);
    // A piece of gear carries its own condition and quirk, a tool is yours for good, and a lockbox is opened at the chest.
    expect([coat, chart, lockbox, undefined].map(cacheTakes)).toEqual([false, false, false, false]);
    expect([CACHE_SIZE, CACHE_NEAR]).toEqual([6, 3]);
  });
});

describe('a torn map, in pieces', () => {
  const tool = (id: string): ItemDef => ({ id, name: id, kind: 'tool', stack: 1, icon: 'map', text: 'A map.' });
  const map: ItemDef = { ...tool('woods-map'), chart: 'woods' };
  const starters = STARTER_TOOLS.map(tool);
  /** A piece of the woods' map at tile x,y (the woods are 6 by 5: the quarters split at x 3 and y 2). */
  const piece = (n: number, x: number, y: number, item = 'woods-map'): FindRule => ({ item, map: 'woods', piece: n, around: { x, y, r: 0.5 }, count: 1, respawn: [1, 2] });
  const errors = (finds: FindRule[], items: ItemDef[] = [map, glowcap, ...starters]) => validateItems({ version: 1, items, finds }, [woods()]).filter(p => p.level === 'error').map(p => p.message);

  it('splits a map in four quarters, the middle lines going east and south', () => {
    expect([quarterOf(0, 0, 6, 5), quarterOf(2, 1, 6, 5), quarterOf(3, 0, 6, 5), quarterOf(0, 2, 6, 5), quarterOf(5, 4, 6, 5)]).toEqual([0, 0, 1, 2, 3]);
    expect(PIECES).toBe(4);
  });

  it('passes four pieces, one in each quarter, of a map of that place', () => {
    expect(errors([piece(0, 1, 0), piece(1, 4, 1), piece(2, 0, 3), piece(3, 4, 3)])).toEqual([]);
  });

  it('catches a piece outside its quarter, of no map of the place, a missing piece, and a map found whole as well', () => {
    const msgs = errors([piece(1, 1, 0), piece(0, 4, 1), piece(2, 0, 3), piece(9, 4, 3), piece(3, 4, 3, 'glowcap'), { item: 'woods-map', map: 'woods', count: 1, respawn: [1, 2] }]);
    expect(msgs).toContainEqual(expect.stringMatching(/find 0 .*piece 1 may lie outside its quarter of woods/));
    expect(msgs).toContainEqual(expect.stringMatching(/find 1 .*piece 0 may lie outside its quarter of woods/));
    expect(msgs).toContainEqual(expect.stringMatching(/find 3 .*piece is a quarter, 0 to 3/));
    expect(msgs).toContainEqual(expect.stringMatching(/find 4 .*a piece of glowcap, which is no map of woods/));
    expect(msgs).toContain('woods-map is torn in pieces, but no find grows piece 3');
    expect(msgs).toContain('woods-map is torn in pieces, and a find grows it whole too');
  });
});
