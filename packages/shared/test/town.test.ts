/**
 * Stonebrook wakes up (town.ts, and what the town changes on a map: map.ts, townData): gates, the maps as
 * the town has them, the ledger's arithmetic, the milestones counts reach, and the swaps Walt makes.
 */
import { describe, expect, it } from 'vitest';
import {
  NO_TOWN, TileMap, chalkLine, emptyStash, gateOpen, itemIndex, ledgerLines, popOf, reachedAt, store, swapBag, swapped, swapsFit, townData, validateItems, validateMap, workLeft, workWants,
  type ItemsData, type MapData, type SwapDef, type TownData,
} from '../src';

/**
 * A small town that changes with the town: a lamp that is dark until the street lights are mended, a porch
 * over two tiles once the board has its roof, the house at 4,1 that lights up once Edith is home, the
 * sign at 1,1 with 23 painted on it, and Edith on 2,4 once she is home.
 */
function town(): MapData {
  return {
    id: 'town', name: 'Town', version: 1, kind: 'town', depth: 0, width: 8, height: 6,
    tiles: Array<string>(6).fill('gggggggg'), levels: Array<string>(6).fill('00000000'),
    spawn: { x: 0, y: 5, dir: 'down' },
    exits: [{ x: 5, y: 2, w: 1, h: 1, to: 'room', tx: 1, ty: 1, dir: 'up' }],
    objects: [
      { kind: 'sign', x: 1, y: 1, text: ['Town. Pop. 23'] },
      { kind: 'house', x: 4, y: 1, w: 3, h: 2, roof: '#7a4b33', lit: 0 },
      { kind: 'lamp', x: 0, y: 1, town: { from: 'lights' } },
      { kind: 'porch', x: 1, y: 3, w: 2, h: 1, town: { from: 'roof' } },
      { kind: 'npc', id: 'edith', name: 'Edith', x: 2, y: 4, dir: 'down', lines: ['Edith.'], town: { from: 'edith-home' } },
    ],
    town: { houses: [{ x: 4, y: 1, from: 'edith-home', lit: 1 }, { x: 4, y: 1, from: 'roof', roof: '#6b7075' }], sign: { x: 1, y: 1, pop: 23 } },
  };
}
/** Her room: a hearth that stays cold until she is home, and its name then. */
function room(): MapData {
  return {
    id: 'room', name: 'The empty house', version: 1, kind: 'inside', depth: 0, width: 5, height: 4,
    tiles: ['xxxxx', 'xpppx', 'xpppx', 'xxpxx'], levels: Array<string>(4).fill('00000'),
    spawn: { x: 2, y: 2, dir: 'up' }, exits: [{ x: 2, y: 3, w: 1, h: 1, to: 'town', tx: 5, ty: 3, dir: 'down' }],
    objects: [{ kind: 'fireplace', x: 2, y: 1, town: { from: 'edith-home' } }],
    town: { names: [{ from: 'edith-home', name: 'Edith\'s house' }] },
  };
}
const done = (...ids: string[]) => new Set(ids);

describe('a gate of the town', () => {
  it('holds from what brings it, until what ends it, or between; no gate always holds', () => {
    expect(gateOpen(undefined, NO_TOWN)).toBe(true);
    expect(gateOpen({ from: 'a' }, NO_TOWN)).toBe(false);
    expect(gateOpen({ from: 'a' }, done('a'))).toBe(true);
    expect(gateOpen({ until: 'a' }, NO_TOWN)).toBe(true);
    expect(gateOpen({ until: 'a' }, done('a'))).toBe(false);
    expect(gateOpen({ from: 'a', until: 'b' }, done('a'))).toBe(true);
    expect(gateOpen({ from: 'a', until: 'b' }, done('a', 'b'))).toBe(false);
  });
});

describe('a map as the town has it (townData)', () => {
  it('as it starts: the lamp dark, no porch, nobody home, the hearth cold, the house dark, the sign as painted', () => {
    const t = townData(town(), NO_TOWN), r = townData(room(), NO_TOWN);
    expect(t.objects.find(o => o.kind === 'lamp')).toEqual({ kind: 'lamp', x: 0, y: 1, town: { from: 'lights' }, dark: true });
    expect(t.objects.some(o => o.kind === 'porch' || o.kind === 'npc')).toBe(false);
    expect(t.objects.find(o => o.kind === 'house')).toMatchObject({ lit: 0, roof: '#7a4b33' });
    expect(t.objects.find(o => o.kind === 'sign')).toMatchObject({ text: ['Town. Pop. 23'] });
    expect(r.objects).toEqual([{ kind: 'hearth', x: 2, y: 1 }]);
    expect(r.name).toBe('The empty house');
  });

  it('once it came to them: Edith home by her lit fire, the house lit with its roof mended, the lamp on, the porch up, the sign chalked', () => {
    const t = townData(town(), done('edith-home', 'lights', 'roof'), 24), r = townData(room(), done('edith-home'));
    expect(t.objects.find(o => o.kind === 'lamp')).toEqual({ kind: 'lamp', x: 0, y: 1, town: { from: 'lights' } });
    expect(t.objects.find(o => o.kind === 'porch')).toBeDefined();
    expect(t.objects.find(o => o.kind === 'npc')).toMatchObject({ id: 'edith' });
    expect(t.objects.find(o => o.kind === 'house')).toMatchObject({ lit: 1, roof: '#6b7075' });
    expect(t.objects.find(o => o.kind === 'sign')).toMatchObject({ text: ['Town. Pop. 23', 'The 23 is crossed out in chalk. Beside it, in the same chalk: 24.'] });
    expect(r.objects).toEqual([{ kind: 'fireplace', x: 2, y: 1, town: { from: 'edith-home' } }]);
    expect(r.name).toBe('Edith\'s house');
  });

  it('is the same map, untouched, when nothing on it changes with the town', () => {
    const plain: MapData = { ...room(), objects: [{ kind: 'fireplace', x: 2, y: 1 }], town: undefined };
    expect(townData(plain, done('edith-home'))).toBe(plain);
  });

  it('chalks the number only once people came back', () => {
    expect(chalkLine(23, 23)).toBeUndefined();
    expect(chalkLine(23, 26)).toBe('The 23 is crossed out in chalk. Beside it, in the same chalk: 26.');
  });
});

describe('a TileMap that follows the town', () => {
  it('works out again what stands in the way, what is lit, warm and under a roof, and says when anything changed', () => {
    const t = new TileMap(town()), r = new TileMap(room());
    expect(t.walkable(2, 4)).toBe(true);
    expect(t.lit(0, 2)).toBe(false);
    expect(t.roofed(1, 3)).toBe(false);
    expect(r.warm(2, 2)).toBe(false);
    expect(t.setTown(done('edith-home', 'lights', 'roof'), 24)).toBe(true);
    expect(r.setTown(done('edith-home'))).toBe(true);
    // Edith stands in the way now; the lamp lights around it; the porch keeps the rain off; her fire warms.
    expect(t.walkable(2, 4)).toBe(false);
    expect(t.lit(0, 2)).toBe(true);
    expect(t.roofed(1, 3) && t.roofed(2, 3)).toBe(true);
    expect(r.warm(2, 2)).toBe(true);
    expect(r.data.name).toBe('Edith\'s house');
    // The map as content has it stays as it was.
    expect(r.source.name).toBe('The empty house');
    // Nothing new: nothing changed.
    expect(t.setTown(done('edith-home', 'lights', 'roof'), 24)).toBe(false);
    expect(t.setTown(done('edith-home', 'lights', 'roof', 'other'), 24)).toBe(false);
  });
});

const ITEMS: ItemsData = {
  version: 1,
  items: [
    { id: 'glowcap', name: 'Glowcap', kind: 'resource', stack: 20, xp: 1, text: 'Glows.' },
    { id: 'cloth', name: 'Cloth scraps', noun: 'cloth', plural: 'cloth', kind: 'resource', stack: 10, xp: 2, text: 'Cloth.' },
    { id: 'scrap', name: 'Scrap metal', noun: 'scrap', plural: 'scrap', kind: 'resource', stack: 10, xp: 3, text: 'Scrap.' },
    { id: 'wire', name: 'Copper wire', noun: 'copper wire', plural: 'copper wire', kind: 'resource', stack: 10, xp: 4, text: 'Wire.' },
  ],
  finds: [],
};
const DATA: TownData = {
  pop: 23,
  milestones: [
    { id: 'edith-home', when: { count: 'woke', n: 1 }, back: 'Edith', title: 'Edith is home', text: 'A fire burns.' },
    { id: 'lodge-cook', when: { count: 'thanks', n: 3 }, back: 'Maud', title: 'Coffee', text: 'Maud cooks.' },
    { id: 'quiet', when: { count: 'fed', n: 5 }, title: 'Quiet', text: 'Nobody back.' },
  ],
  works: [
    { id: 'lights', name: 'The street lights', needs: [{ item: 'wire', count: 4 }, { item: 'scrap', count: 2 }], perk: 'The street is lit at night.', title: 'Lit', text: 'Lit.' },
    { id: 'roof', name: 'A roof over the board', needs: [{ item: 'cloth', count: 3 }], perk: 'Under it you dry off.', title: 'Roof', text: 'Roof.' },
  ],
};

describe('the town\'s milestones and works', () => {
  it('counts one more in town for everyone who came back, never for a milestone that brings nobody', () => {
    expect(popOf(DATA, [])).toBe(23);
    expect(popOf(DATA, ['edith-home', 'quiet', 'lights'])).toBe(24);
    expect(popOf(DATA, ['edith-home', 'lodge-cook'])).toBe(25);
    expect(popOf(undefined, ['edith-home'])).toBe(0);
  });

  it('reaches a milestone once its count has come to its number, and never one reached already', () => {
    expect(reachedAt(DATA, {}, NO_TOWN)).toEqual([]);
    expect(reachedAt(DATA, { woke: 1, thanks: 2 }, NO_TOWN).map(m => m.id)).toEqual(['edith-home']);
    expect(reachedAt(DATA, { woke: 3, thanks: 3, fed: 5 }, done('edith-home')).map(m => m.id)).toEqual(['lodge-cook', 'quiet']);
  });

  it('says what a work still wants: each need less what came in, none once it is all in', () => {
    const lights = DATA.works[0]!;
    expect(workLeft(lights, undefined)).toEqual([{ item: 'wire', count: 4 }, { item: 'scrap', count: 2 }]);
    expect(workLeft(lights, { wire: 3, scrap: 5 })).toEqual([{ item: 'wire', count: 1 }]);
    expect(workLeft(lights, { wire: 4, scrap: 2 })).toEqual([]);
    expect(workWants(lights, { wire: 3 }, 'wire')).toBe(1);
    expect(workWants(lights, { wire: 3 }, 'cloth')).toBe(0);
  });

  it('reads the ledger out as the town stands: what each work wants, or that it is done and what it does', () => {
    const item = itemIndex(ITEMS);
    expect(ledgerLines(DATA, { done: ['roof'], given: { lights: { wire: 1 } } }, id => item.get(id))).toEqual([
      'The town\'s ledger. Walt keeps it: what each broken part of town needs, and what came in.',
      'The street lights: wants 3 copper wire and 2 scrap more. Once done: the street is lit at night.',
      'A roof over the board: done. Under it you dry off.',
    ]);
  });
});

describe('Walt\'s swaps', () => {
  const items = itemIndex(ITEMS);
  const CLOTH: SwapDef = { id: 'glowcaps-for-cloth', who: 'walt', give: { item: 'glowcap', count: 10 }, get: { item: 'cloth', count: 1 } };

  it('fit as many times over as the bag holds what is given, and has room for what comes back', () => {
    expect(swapsFit([{ item: 'glowcap', count: 9 }], CLOTH, items, 8)).toBe(0);
    expect(swapsFit([{ item: 'glowcap', count: 20 }, { item: 'glowcap', count: 5 }], CLOTH, items, 8)).toBe(2);
    // A full bag: only once the glowcaps are out is there a slot for the cloth.
    const full = Array.from({ length: 8 }, (_, i) => (i === 0 ? { item: 'glowcap', count: 10 } : { item: 'scrap', count: 10 }));
    expect(swapsFit(full, CLOTH, items, 8)).toBe(1);
    expect(swapsFit([{ item: 'glowcap', count: 11 }, ...full.slice(1)], CLOTH, items, 8)).toBe(0);
  });

  it('take what is given out of the bag and put what comes back in', () => {
    expect(swapBag([{ item: 'glowcap', count: 20 }, { item: 'glowcap', count: 5 }, { item: 'cloth', count: 1 }], CLOTH, 2, items, 8))
      .toEqual([{ item: 'glowcap', count: 5 }, { item: 'cloth', count: 3 }]);
  });

  it('never earn XP twice: what was given out of the stash makes what comes back owed in its place', () => {
    // Twenty glowcaps stashed (20 XP), taken out, swapped for two cloth: the cloth earns nothing brought home.
    const out = { ...emptyStash(), out: { glowcap: 20 } };
    const after = swapped(out, CLOTH, 2);
    expect(after.out).toEqual({ cloth: 2 });
    expect(store(after, [{ item: 'cloth', count: 2 }], items).xp).toBe(0);
    // Found out there, never stashed: the cloth earns its XP like any find.
    const fresh = swapped(emptyStash(), CLOTH, 1);
    expect(store(fresh, [{ item: 'cloth', count: 1 }], items).xp).toBe(2);
  });
});

describe('checking what changes with the town', () => {
  const problems = (m: MapData) => validateMap(m).filter(p => p.level === 'error').map(p => p.message);

  it('passes the town and the room as they are', () => {
    expect(problems(town())).toEqual([]);
    expect(problems(room())).toEqual([]);
  });

  it('gates only people, signs, lamps, hearths and porches, and never in the wilds, where routes need the ground to stay', () => {
    const t = town();
    expect(problems({ ...t, objects: [...t.objects, { kind: 'rock', x: 7, y: 5, s: 1, v: 0, town: { from: 'x' } } as never] }).join()).toMatch(/only npc, sign, lamp, fireplace, porch change with the town/);
    const wild: MapData = { ...t, kind: 'wilds', depth: 1, exits: [...t.exits, { x: 0, y: 5, w: 1, h: 1, to: 'town', tx: 0, ty: 0, dir: 'down', home: true }], spawn: { x: 1, y: 5, dir: 'down' } };
    expect(problems(wild).join()).toMatch(/the wilds keep their shape/);
  });

  it('lets two things share a tile only when one stands there until what brings the other', () => {
    const t = town(), sign = (town: { from?: string; until?: string }) => ({ kind: 'sign' as const, x: 7, y: 4, text: ['A mailbox.'], style: 'mailbox' as const, town });
    expect(problems({ ...t, objects: [...t.objects, sign({ until: 'edith-home' }), sign({ from: 'edith-home' })] })).toEqual([]);
    expect(problems({ ...t, objects: [...t.objects, sign({ until: 'edith-home' }), sign({ from: 'lights' })] }).join()).toMatch(/overlaps/);
  });

  it('keeps whoever comes back out of every door and every tile read from', () => {
    const t = town();
    expect(problems({ ...t, objects: [...t.objects, { kind: 'npc', id: 'arvid', name: 'Arvid', x: 5, y: 3, dir: 'down', lines: ['Arvid.'], town: { from: 'mill' } }] }).join())
      .toMatch(/the door of the house at 4,1 is blocked/);
  });

  it('wants the town\'s part to name a house, a plain sign and a room that exist', () => {
    const t = town();
    expect(problems({ ...t, town: { houses: [{ x: 2, y: 2, from: 'edith-home', lit: 1 }], sign: { x: 0, y: 0, pop: 23 } } }).join()).toMatch(/no house at 2,2.*no plain signpost at 0,0/);
    expect(problems({ ...t, town: { names: [{ from: 'edith-home', name: 'Home' }] } }).join()).toMatch(/only a room takes another name/);
  });

  it('wants what the maps change with to be milestones or works of the town, and swaps with someone who is there', () => {
    const maps = [town(), room()];
    const ok: ItemsData = { ...ITEMS, town: DATA, swaps: [{ id: 'glowcaps-for-cloth', who: 'edith', give: { item: 'glowcap', count: 10 }, get: { item: 'cloth', count: 1 } }] };
    expect(validateItems(ok, maps).filter(p => p.level === 'error')).toEqual([]);
    const bad: ItemsData = {
      ...ok,
      town: { ...DATA, works: [...DATA.works, { id: 'edith-home', name: 'Twice', needs: [{ item: 'moss', count: 1 }], perk: 'P.', title: 'T', text: 'T' }] },
      swaps: [{ id: 'nobody', who: 'walt', give: { item: 'glowcap', count: 10 }, get: { item: 'glowcap', count: 1 } }],
    };
    const said = validateItems(bad, maps).filter(p => p.level === 'error').map(p => p.message).join('\n');
    expect(said).toMatch(/work "edith-home" is there twice/);
    expect(said).toMatch(/moss is not an item/);
    expect(said).toMatch(/nobody has the id walt/);
    expect(said).toMatch(/gives what it gets/);
    const none: ItemsData = { ...ITEMS };
    expect(validateItems(none, maps).map(p => p.message).join('\n')).toMatch(/changes with edith-home, which is no milestone or work of the town/);
  });
});
