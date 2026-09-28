/**
 * Equipment: what everyone starts in, putting gear on and taking it off at the chest, bags of other
 * sizes, what gear resists, and the workbench. World rules only.
 */
import { describe, expect, it } from 'vitest';
import { ENERGY_MAX, TileMap, energyRate, type Dir, type ItemsData, type ServerMsg } from '@napoland/shared';
import type { PlayerRecord } from '../src/storage';
import { World, colorFor, type Outgoing } from '../src/world';
import { fixtureMaps, houseData, woodsData } from './fixtures';

/** The fixture house with a chest at 3,1 and a workbench at 1,1: stand at 3,2 for the chest, 1,2 for the bench (both facing up). */
const house = () => {
  const h = houseData();
  return new TileMap({ ...h, objects: [...h.objects, { kind: 'chest', x: 3, y: 1 }, { kind: 'workbench', x: 1, y: 1 }] });
};
const woods = new TileMap(woodsData());

const gear = (id: string, slot: string, more: object = {}) => ({ id, name: id, kind: 'gear' as const, stack: 1, text: 'Gear.', slot: slot as 'cap', ...more });
const ITEMS: ItemsData = {
  version: 1,
  items: [
    gear('worn-cap', 'cap'), gear('worn-shirt', 'shirt'), gear('worn-gloves', 'gloves'), gear('worn-pants', 'pants'), gear('worn-shoes', 'shoes'),
    gear('backpack', 'bag', { bag: 8 }),
    gear('tote', 'bag', { bag: 2 }),
    gear('coat', 'shirt', { resist: { cold: 0.5, wind: 0.5 }, bonus: 10 }),
    { id: 'cloth', name: 'Cloth', kind: 'resource', stack: 10, text: 'Dry.' },
  ],
  finds: [],
  recipes: [{ id: 'coat', make: 'coat', needs: [{ item: 'cloth', count: 4 }] }],
};
const STARTER = { cap: 'worn-cap', shirt: 'worn-shirt', gloves: 'worn-gloves', pants: 'worn-pants', shoes: 'worn-shoes', bag: 'backpack' };

const rec = (id: string, map: string, x: number, y: number, more: Partial<PlayerRecord> = {}, dir: Dir = 'up'): PlayerRecord => ({
  id, name: id.toUpperCase(), tokenHash: `hash-${id}`, authSub: null, map, x, y, dir, color: colorFor(id), energy: 50, bag: [], createdAt: 1, lastSeenAt: 1, ...more,
});
function world(...players: PlayerRecord[]): World {
  const maps = [...fixtureMaps().filter(m => m.data.id !== 'house'), house()];
  const w = new World(maps, 'town', 'overcast', { items: ITEMS, rng: () => 0 });
  for (const p of players) w.join(p, 0);
  w.drain();
  w.takeWrites();
  return w;
}
const to = (out: Outgoing[], id: string) => out.flatMap(o => (o.to === id ? [o.msg] : []));
const onMap = (out: Outgoing[], map: string) => out.flatMap(o => ('map' in o && o.map === map ? [o.msg] : []));
const of = <T extends ServerMsg['t']>(msgs: ServerMsg[], t: T) => msgs.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);

describe('what you wear', () => {
  it('is the starter gear for someone who never chose, and everyone sees it', () => {
    const w = world();
    const joined = w.join(rec('a', 'house', 2, 3), 0);
    expect(joined.player.gear).toEqual(STARTER);
    // Saved gear that no longer fits (not gear, the wrong slot) is bare, but the bag is never missing.
    const b = w.join(rec('b', 'house', 2, 2, { gear: { cap: 'cloth', shirt: 'coat', gloves: 'coat' } }), 0);
    expect(b.player.gear).toEqual({ shirt: 'coat', bag: 'backpack' });
  });

  it('goes on at the chest from the stash, and what it replaces goes into the stash; the map sees it', () => {
    const w = world(rec('a', 'house', 3, 2, { stash: { items: { coat: 1 }, out: {} } }));
    w.equip('a', 3, 1, 'coat', 1000);
    const out = w.drain();
    expect(onMap(out, 'house')).toContainEqual({ t: 'gear', id: 'a', gear: { ...STARTER, shirt: 'coat' }, quirks: [] });
    expect(of(to(out, 'a'), 'chest')).toEqual([{ t: 'chest', stash: [{ item: 'worn-shirt', count: 1, piece: { cond: 1 } }] }]);
    // The coat gives 10 more energy.
    expect(of(to(out, 'a'), 'energy').at(-1)?.energy.max).toBe(ENERGY_MAX + 10);
    expect(w.takeWrites().players[0]!.gear).toEqual({ ...STARTER, shirt: 'coat' });
  });

  it('comes off into the stash, except the bag; and only at the chest', () => {
    const w = world(rec('a', 'house', 3, 2), rec('b', 'house', 1, 3));
    w.unequip('a', 3, 1, 'cap', 1000);
    w.unequip('a', 3, 1, 'bag', 1000);
    w.unequip('a', 3, 1, 'cap', 1000);
    w.unequip('b', 3, 1, 'shoes', 1000);
    const out = w.drain();
    expect(onMap(out, 'house')).toContainEqual({ t: 'gear', id: 'a', gear: { shirt: 'worn-shirt', gloves: 'worn-gloves', pants: 'worn-pants', shoes: 'worn-shoes', bag: 'backpack' }, quirks: [] });
    expect(of(to(out, 'a'), 'refused').map(r => r.reason)).toEqual(['keep_bag', 'empty_slot']);
    expect(of(to(out, 'b'), 'refused').map(r => r.reason)).toEqual(['too_far']);
  });

  it('refuses what is not gear, and a bag too small for what you carry', () => {
    const w = world(rec('a', 'house', 3, 2, { bag: [{ item: 'cloth', count: 1 }, { item: 'cloth', count: 1 }, { item: 'cloth', count: 1 }], stash: { items: { tote: 1, cloth: 5 }, out: {} } }));
    w.equip('a', 3, 1, 'cloth', 1000);
    w.equip('a', 3, 1, 'tote', 1000);
    w.equip('a', 3, 1, 'coat', 1000);
    expect(of(to(w.drain(), 'a'), 'refused').map(r => r.reason)).toEqual(['not_gear', 'bag_too_full', 'not_stashed']);
  });

  it('decides how much the bag holds', () => {
    const w = world(rec('a', 'house', 3, 2, { gear: { ...STARTER, bag: 'tote' }, stash: { items: { cloth: 30 }, out: {} } }));
    w.take('a', 3, 1, 'cloth', 30, 1000);
    // Two slots of ten.
    expect(w.get('a')!.bag).toEqual([{ item: 'cloth', count: 10 }, { item: 'cloth', count: 10 }]);
  });

  it('resists: a coat halves the rain soaking you, and the cold of the weather', () => {
    const w = new World(fixtureMaps(), 'town', 'rain', { items: ITEMS, rng: () => 0 });
    const plain = w.join(rec('a', 'woods', 3, 5, { energy: 100 }), 0);
    const coat = w.join(rec('b', 'woods', 4, 5, { energy: 100, gear: { ...STARTER, shirt: 'coat' } }), 0);
    expect(coat.body.wetRate).toBeCloseTo(plain.body.wetRate / 2, 4);
    expect(coat.energy.rate).toBe(Math.round(energyRate(woods, 4, 5, 'rain', { resist: { cold: 0.5, wind: 0.5 } }) * 1000) / 1000);
    expect(coat.energy.rate).toBeGreaterThan(Math.round(energyRate(woods, 4, 5, 'rain') * 1000) / 1000);
  });
});

describe('the workbench', () => {
  it('opens next to it, and makes gear from the stash into the stash', () => {
    const w = world(rec('a', 'house', 1, 2, { stash: { items: { cloth: 5 }, out: {} } }));
    w.bench('a', 1, 1);
    expect(to(w.drain(), 'a')).toEqual([{ t: 'bench', stash: [{ item: 'cloth', count: 5 }] }]);
    w.craft('a', 1, 1, 'coat', 1000);
    expect(to(w.drain(), 'a')).toEqual([
      // Gear made counts toward what Walt says once, and the player hears the count at once.
      { t: 'stats', stats: { made: 1 } },
      { t: 'bench', stash: [{ item: 'coat', count: 1, piece: { cond: 1 } }, { item: 'cloth', count: 1 }] },
      { t: 'did', did: { kind: 'made', item: 'coat', count: 1 } },
    ]);
    expect(w.takeWrites().players[0]!.stash).toEqual({ items: { cloth: 1, coat: 1 }, out: {}, pieces: { coat: [{ cond: 1 }] } });
  });

  it('refuses what the stash cannot pay for, recipes that do not exist, and from too far', () => {
    const w = world(rec('a', 'house', 1, 2, { stash: { items: { cloth: 3 }, out: {} } }));
    w.craft('a', 1, 1, 'coat', 1000);
    w.craft('a', 1, 1, 'crown', 1000);
    w.craft('a', 3, 1, 'coat', 1000);
    expect(of(to(w.drain(), 'a'), 'refused').map(r => r.reason)).toEqual(['missing', 'gone', 'too_far']);
  });
});

describe('pieces: wear, mending and quirks', () => {
  const WEARS: ItemsData = {
    ...ITEMS,
    items: [...ITEMS.items.filter(i => i.id !== 'coat'), gear('coat', 'shirt', { tier: 'sturdy', resist: { cold: 0.5, wind: 0.5 }, bonus: 10 }), gear('halo', 'cap', { tier: 'anomalous' })],
    wear: { sturdy: 100 },
    mend: { sturdy: [{ item: 'cloth', count: 2 }] },
    quirks: [{ id: 'footprints', name: 'Glowing steps', text: 'Glows.' }, { id: 'flicker', name: 'Flicker', text: 'Flickers.' }, { id: 'hum', name: 'Humming', text: 'Hums.' }],
  };
  const COAT = { ...STARTER, shirt: 'coat' };
  function pieces(...players: PlayerRecord[]): World {
    const maps = [...fixtureMaps().filter(m => m.data.id !== 'house'), house()];
    const w = new World(maps, 'town', 'overcast', { items: WEARS, rng: () => 0 });
    for (const p of players) w.join(p, 0);
    w.drain();
    return w;
  }
  const lastEnergy = (out: Outgoing[], id: string) => of(to(out, id), 'energy').at(-1)!;

  it('wear down out in the wilds only; nearly worn out they protect less, worn out not at all, and give no energy', () => {
    const w = pieces(rec('a', 'woods', 3, 5, { energy: 100, gear: COAT }), rec('b', 'house', 2, 3, { gear: COAT }));
    w.tick(50_000);
    expect(w.get('a')!.worn!.shirt!.cond).toBeCloseTo(0.5, 5);
    expect(w.get('b')!.worn!.shirt!.cond).toBe(1);
    expect(lastEnergy(w.drain(), 'a').energy.max).toBe(ENERGY_MAX + 10);
    w.tick(90_000);
    const fading = lastEnergy(w.drain(), 'a');
    expect(fading.body.worn.shirt!.cond).toBeCloseTo(0.1, 3);
    // At 10%, 40% of its protection is left, and 40% of its energy (rounded).
    expect(fading.energy.max).toBe(ENERGY_MAX + 4);
    w.tick(120_000);
    const out = lastEnergy(w.drain(), 'a');
    expect(out.body.worn.shirt).toEqual({ cond: 0 });
    expect(out.energy.max).toBe(ENERGY_MAX);
    expect(out.energy.rate).toBe(Math.round(energyRate(woods, 3, 5, 'overcast', { resist: { cold: 0, wind: 0 } }) * 1000) / 1000);
  });

  it('wear 5% more slowly for each level they are upgraded, and mend for the same at any level, keeping it', () => {
    const w = pieces(rec('a', 'woods', 3, 5, { energy: 100, gear: COAT, worn: { shirt: { cond: 1, level: 4 } } }));
    // 60 s out: a sturdy coat lasts 100 s, and 120 s at +4.
    w.tick(60_000);
    expect(w.get('a')!.worn!.shirt).toEqual({ cond: expect.closeTo(0.5, 5), level: 4 });
    const home = pieces(rec('b', 'house', 1, 2, { gear: COAT, worn: { shirt: { cond: 0.3, level: 8 } }, stash: { items: { cloth: 2 }, out: {} } }));
    home.mend('b', 1, 1, 'shirt', 1000);
    expect(to(home.drain(), 'b').at(-1)).toEqual({ t: 'did', did: { kind: 'mended', item: 'coat', level: 8 } });
    expect(home.get('b')).toMatchObject({ worn: { shirt: { cond: 1, level: 8 } }, stash: { items: {} } });
  });

  it('are mended at the workbench from the stash, whole again', () => {
    const w = pieces(rec('a', 'house', 1, 2, { gear: COAT, worn: { shirt: { cond: 0.3 } }, stash: { items: { cloth: 3 }, out: {} } }));
    w.mend('a', 1, 1, 'shirt', 1000);
    const out = to(w.drain(), 'a');
    // What it did comes last, after the piece's condition and the bench.
    expect(out.at(-1)).toEqual({ t: 'did', did: { kind: 'mended', item: 'coat' } });
    expect(of(out, 'energy').at(-1)!.body.worn.shirt).toEqual({ cond: 1 });
    expect(w.get('a')!.stash!.items).toEqual({ cloth: 1 });
    w.mend('a', 1, 1, 'shirt', 1000);
    expect(to(w.drain(), 'a')).toEqual([{ t: 'refused', action: 'mend', reason: 'whole' }]);
    const poor = pieces(rec('b', 'house', 1, 2, { gear: COAT, worn: { shirt: { cond: 0.3 } }, stash: { items: { cloth: 1 }, out: {} } }));
    poor.mend('b', 1, 1, 'shirt', 1000);
    poor.mend('b', 3, 1, 'shirt', 1000);
    expect(to(poor.drain(), 'b')).toEqual([{ t: 'refused', action: 'mend', reason: 'missing' }, { t: 'refused', action: 'mend', reason: 'too_far' }]);
  });

  it('keep how worn they are in the stash, and the one you pick is the one you put on', () => {
    const w = pieces(rec('a', 'house', 3, 2, { gear: COAT, worn: { shirt: { cond: 0.4 } }, stash: { items: { coat: 1 }, out: {}, pieces: { coat: [{ cond: 0.9 }] } } }));
    w.unequip('a', 3, 1, 'shirt', 1000);
    expect(w.get('a')!.stash!.pieces!.coat).toEqual([{ cond: 0.9 }, { cond: 0.4 }]);
    expect(of(to(w.drain(), 'a'), 'chest')[0]!.stash).toEqual([{ item: 'coat', count: 1, piece: { cond: 0.9 } }, { item: 'coat', count: 1, piece: { cond: 0.4 } }]);
    w.equip('a', 3, 1, 'coat', 1000, 1);
    expect(w.get('a')!.worn!.shirt).toEqual({ cond: 0.4 });
    expect(w.get('a')!.stash!.pieces!.coat).toEqual([{ cond: 0.9 }]);
    // Taken out, a piece keeps how worn it is: it never comes back new.
    w.take('a', 3, 1, 'coat', 1, 1000);
    expect(w.get('a')!.bag).toEqual([{ item: 'coat', count: 1, piece: { cond: 0.9 } }]);
    expect(w.get('a')!.stash!.items.coat).toBeUndefined();
  });

  it('keep how worn they are, and their quirk, whatever else goes in or out of the stash', () => {
    const halo = { cond: 0.5, quirk: 'hum' as const };
    const w = pieces(rec('a', 'house', 3, 2, { bag: [{ item: 'cloth', count: 2 }], stash: { items: { coat: 1, halo: 1, cloth: 3 }, out: {}, pieces: { coat: [{ cond: 0.3 }], halo: [halo] } } }));
    w.take('a', 3, 1, 'cloth', 1, 1000);
    w.store('a', 3, 1, undefined, 1000);
    expect(w.get('a')!.stash!.pieces).toEqual({ coat: [{ cond: 0.3 }], halo: [halo] });
    expect(of(to(w.drain(), 'a'), 'chest').at(-1)!.stash).toContainEqual({ item: 'coat', count: 1, piece: { cond: 0.3 } });
  });

  it('come from what players already have: counted gear becomes new pieces, and anomalous ones get a quirk everyone knows', () => {
    const w = pieces(rec('a', 'house', 3, 2, { gear: { ...STARTER, cap: 'halo' }, stash: { items: { coat: 2, halo: 1, cloth: 1 }, out: {} } }));
    const a = w.get('a')!;
    expect(a.stash!.pieces).toEqual({ coat: [{ cond: 1 }, { cond: 1 }], halo: [{ cond: 1, quirk: 'footprints' }] });
    expect(a.worn!.cap).toEqual({ cond: 1, quirk: 'footprints' });
    expect(w.join(rec('b', 'house', 2, 3), 0).players.find(p => p.id === 'a')!.quirks).toEqual(['footprints']);
    w.unequip('a', 3, 1, 'cap', 1000);
    expect(onMap(w.drain(), 'house')).toContainEqual({ t: 'gear', id: 'a', gear: { shirt: 'worn-shirt', gloves: 'worn-gloves', pants: 'worn-pants', shoes: 'worn-shoes', bag: 'backpack' }, quirks: [] });
  });
});

describe('gear on the road', () => {
  /** The starter clothes and bags, a heavy coat, an anomalous cap worth XP, cloth, and a strange object that is always the cap. */
  const ROAD: ItemsData = {
    version: 1,
    items: [
      gear('worn-cap', 'cap'), gear('worn-shirt', 'shirt'), gear('worn-gloves', 'gloves'), gear('worn-pants', 'pants'), gear('worn-shoes', 'shoes'),
      gear('backpack', 'bag', { bag: 8 }), gear('tote', 'bag', { bag: 2 }),
      gear('coat', 'shirt', { tier: 'sturdy', resist: { cold: 0.5, wind: 0.5 }, bonus: 10, weight: 2 }),
      gear('halo', 'cap', { tier: 'anomalous', xp: 40 }),
      { id: 'cloth', name: 'Cloth', kind: 'resource', stack: 10, text: 'Dry.' },
      { id: 'odd', name: 'Strange object', kind: 'resource', stack: 1, text: 'What is it?', use: { identify: true }, reveals: [{ item: 'halo', count: 1, weight: 1 }] },
    ],
    finds: [],
    wear: { sturdy: 100, anomalous: 300 },
    quirks: [{ id: 'footprints', name: 'Glowing steps', text: 'Glows.' }, { id: 'flicker', name: 'Flicker', text: 'Flickers.' }, { id: 'hum', name: 'Humming', text: 'Hums.' }],
  };
  function road(...players: PlayerRecord[]): World {
    const maps = [...fixtureMaps().filter(m => m.data.id !== 'house'), house()];
    const w = new World(maps, 'town', 'overcast', { items: ROAD, rng: () => 0 });
    for (const p of players) w.join(p, 0);
    w.drain();
    w.takeWrites();
    return w;
  }
  const lastEnergy = (out: Outgoing[], id: string) => of(to(out, id), 'energy').at(-1)!;

  it('come out of the chest one piece at a time, the one asked for, into a slot of its own, as it is', () => {
    const w = road(rec('a', 'house', 3, 2, { bag: [{ item: 'cloth', count: 3 }], stash: { items: { coat: 2, cloth: 5 }, out: {}, pieces: { coat: [{ cond: 0.9 }, { cond: 0.4 }] } } }));
    w.take('a', 3, 1, 'coat', 1, 1000, 1);
    const out = to(w.drain(), 'a');
    expect(of(out, 'bag')).toEqual([{ t: 'bag', bag: [{ item: 'cloth', count: 3 }, { item: 'coat', count: 1, piece: { cond: 0.4 } }] }]);
    expect(of(out, 'chest').at(-1)!.stash).toEqual([{ item: 'coat', count: 1, piece: { cond: 0.9 } }, { item: 'cloth', count: 5 }]);
    // It counts as taken out, like anything.
    expect(w.get('a')!.stash).toEqual({ items: { coat: 1, cloth: 5 }, out: { coat: 1 }, pieces: { coat: [{ cond: 0.9 }] } });
    // A piece takes a slot of its own: a full bag has no room for one.
    const full = road(rec('b', 'house', 3, 2, { gear: { ...STARTER, bag: 'tote' }, bag: [{ item: 'cloth', count: 9 }, { item: 'cloth', count: 1 }], stash: { items: { coat: 1 }, out: {} } }));
    full.take('b', 3, 1, 'coat', 1, 1000);
    expect(to(full.drain(), 'b')).toEqual([{ t: 'refused', action: 'take', reason: 'bag_full' }]);
    expect(full.get('b')!.stash!.items).toEqual({ coat: 1 });
  });

  it('go on from the bag anywhere: what they replace takes their slot, the map sees it, the bar follows', () => {
    const coat = { cond: 0.6 };
    const w = road(rec('a', 'town', 1, 2, { bag: [{ item: 'cloth', count: 2 }, { item: 'coat', count: 1, piece: coat }] }), rec('b', 'town', 2, 2));
    w.wear('a', 1, 1000);
    const out = w.drain();
    expect(of(to(out, 'a'), 'bag')).toEqual([{ t: 'bag', bag: [{ item: 'cloth', count: 2 }, { item: 'worn-shirt', count: 1, piece: { cond: 1 } }] }]);
    expect(onMap(out, 'town')).toContainEqual({ t: 'gear', id: 'a', gear: { ...STARTER, shirt: 'coat' }, quirks: [] });
    expect(lastEnergy(out, 'a').body.worn.shirt).toEqual(coat);
    expect(lastEnergy(out, 'a').energy.max).toBe(ENERGY_MAX + 10);
    // Away from the chest, the stash is not what changed.
    expect(of(to(out, 'a'), 'chest')).toEqual([]);
    expect(w.takeWrites().players[0]).toMatchObject({ gear: { shirt: 'coat' }, worn: { shirt: coat } });
    // Nothing worn in its slot: the slot it left in the bag is free.
    const bare = road(rec('c', 'town', 1, 2, { gear: { bag: 'backpack' }, bag: [{ item: 'halo', count: 1, piece: { cond: 1, quirk: 'hum' } }] }));
    bare.wear('c', 0, 1000);
    expect(bare.get('c')).toMatchObject({ bag: [], gear: { cap: 'halo', bag: 'backpack' }, worn: { cap: { cond: 1, quirk: 'hum' } } });
    expect(onMap(bare.drain(), 'town')).toContainEqual({ t: 'gear', id: 'c', gear: { cap: 'halo', bag: 'backpack' }, quirks: ['hum'] });
  });

  it('never put on a bag from the bag, nor what is not gear or not there', () => {
    const w = road(rec('a', 'woods', 3, 5, { bag: [{ item: 'tote', count: 1, piece: { cond: 1 } }, { item: 'cloth', count: 1 }] }));
    w.wear('a', 0, 1000);
    w.wear('a', 1, 1000);
    w.wear('a', 5, 1000);
    expect(of(to(w.drain(), 'a'), 'refused').map(r => r.reason)).toEqual(['bag_at_home', 'not_gear', 'empty_slot']);
    expect(w.get('a')!.gear).toEqual(STARTER);
  });

  it('come off into the bag anywhere, when it has a slot free, and weigh what they weigh there; never the bag itself', () => {
    const w = road(rec('a', 'town', 1, 2, { gear: { ...STARTER, shirt: 'coat' }, worn: { shirt: { cond: 0.3 } } }));
    w.doff('a', 'shirt', 1000);
    const out = w.drain();
    expect(of(to(out, 'a'), 'bag')).toEqual([{ t: 'bag', bag: [{ item: 'coat', count: 1, piece: { cond: 0.3 } }] }]);
    expect(onMap(out, 'town')).toContainEqual({ t: 'gear', id: 'a', gear: { cap: 'worn-cap', gloves: 'worn-gloves', pants: 'worn-pants', shoes: 'worn-shoes', bag: 'backpack' }, quirks: [] });
    // The coat's 10 energy went with it, and it weighs 2 kg in the bag.
    expect(lastEnergy(out, 'a').energy.max).toBe(ENERGY_MAX);
    expect(lastEnergy(out, 'a').body.load).toBe(0.2);
    w.doff('a', 'shirt', 1000);
    w.doff('a', 'bag', 1000);
    expect(of(to(w.drain(), 'a'), 'refused').map(r => r.reason)).toEqual(['empty_slot', 'keep_bag']);
    const full = road(rec('b', 'town', 1, 2, { gear: { ...STARTER, bag: 'tote' }, bag: [{ item: 'cloth', count: 1 }, { item: 'cloth', count: 1 }] }));
    full.doff('b', 'cap', 1000);
    expect(to(full.drain(), 'b')).toEqual([{ t: 'refused', action: 'doff', reason: 'bag_full' }]);
    expect(full.get('b')!.gear!.cap).toBe('worn-cap');
  });

  it('earn their XP once: however a piece leaves the stash, bringing it back pays that off first', () => {
    const w = road(rec('a', 'house', 3, 2, { stash: { items: { halo: 1 }, out: {}, pieces: { halo: [{ cond: 1, quirk: 'hum' }] } } }));
    // Taken out and put away again.
    w.take('a', 3, 1, 'halo', 1, 1000);
    w.store('a', 3, 1, undefined, 1000);
    // Put on at the chest, taken off into the bag, put away.
    w.equip('a', 3, 1, 'halo', 1000);
    w.doff('a', 'cap', 1000);
    w.store('a', 3, 1, undefined, 1000);
    // Taken out, put on from the bag, taken off at the chest.
    w.take('a', 3, 1, 'halo', 1, 1000);
    w.wear('a', 0, 1000);
    w.unequip('a', 3, 1, 'cap', 1000);
    expect(of(to(w.drain(), 'a'), 'progress').map(p => p.gained)).toEqual([0, 0]);
    expect(w.get('a')).toMatchObject({ xp: 0, stash: { items: { halo: 1, 'worn-cap': 1 }, out: {}, pieces: { halo: [{ cond: 1, quirk: 'hum' }] } } });
  });

  it('are pieces the moment a strange object turns into one: its quirk rolled, worn at once, and it earns its XP the first time it comes home', () => {
    const w = road(rec('a', 'house', 3, 2, { bag: [{ item: 'odd', count: 1 }] }));
    w.use('a', 0, 1000);
    expect(to(w.drain(), 'a').at(-1)).toEqual({ t: 'did', did: { kind: 'used', item: 'odd', into: { item: 'halo', count: 1, piece: { cond: 1, quirk: 'footprints' } } } });
    expect(w.get('a')!.bag).toEqual([{ item: 'halo', count: 1, piece: { cond: 1, quirk: 'footprints' } }]);
    w.wear('a', 0, 1000);
    expect(w.get('a')!.worn!.cap).toEqual({ cond: 1, quirk: 'footprints' });
    // Taken off at the chest: it is home for the first time.
    w.unequip('a', 3, 1, 'cap', 1000);
    expect(of(to(w.drain(), 'a'), 'progress').map(p => p.gained)).toEqual([40]);
    expect(w.get('a')!.xp).toBe(40);
  });

  it('count double while rested, like anything else brought home for the first time', () => {
    const w = road(rec('a', 'house', 3, 2, { rested: 100, bag: [{ item: 'odd', count: 1 }] }));
    w.use('a', 0, 1000);
    w.wear('a', 0, 1000);
    w.drain();
    w.unequip('a', 3, 1, 'cap', 1000);
    expect(of(to(w.drain(), 'a'), 'progress')).toEqual([{ t: 'progress', progress: expect.objectContaining({ xp: 80, rested: 60 }), gained: 80, fromRest: 40 }]);
  });

  it('fall into the pile as they are when you collapse; the owner gets them back so, and anyone else their half so', () => {
    const halo = { cond: 0.7, quirk: 'flicker' as const };
    const bag = [{ item: 'cloth', count: 2 }, { item: 'halo', count: 1, piece: halo }, { item: 'coat', count: 1, piece: { cond: 0.2 } }];
    const w = road(rec('a', 'woods', 3, 6, { energy: 0.01, gear: { ...STARTER, shirt: 'coat' }, worn: { shirt: { cond: 0.5 } }, bag }));
    w.tick(1000);
    const pile = w.takeWrites().drops[0]!.drop!;
    expect(pile.items).toEqual(bag);
    // What you wear stays on.
    expect(w.get('a')).toMatchObject({ map: 'town', bag: [], gear: { shirt: 'coat' } });
    const back = w.leave('a', 2000)!;
    w.join({ ...back, map: 'woods', x: 3, y: 5 }, 2000);
    w.pick('a', 3, 6, 2000);
    expect(w.get('a')!.bag).toEqual(bag);
    // Someone else: with these dice, one cloth and the cap, as it was.
    const other = road(rec('b', 'woods', 3, 6, { energy: 0.01, bag }), rec('c', 'woods', 3, 5));
    other.tick(1000);
    other.pick('c', 3, 6, 1000);
    expect(other.get('c')!.bag).toEqual([{ item: 'cloth', count: 1 }, { item: 'halo', count: 1, piece: halo }]);
    expect(of(to(other.drain(), 'c'), 'got')).toEqual([{ t: 'got', items: [{ item: 'cloth', count: 1 }, { item: 'halo', count: 1 }], from: 'drop' }]);
  });

  it('come back as pieces from what was saved before they travelled: gear in a bag or a pile gets one', () => {
    const w = road(rec('a', 'town', 1, 2, { bag: [{ item: 'halo', count: 1 }, { item: 'coat', count: 1, piece: { cond: 5 } as never }, { item: 'cloth', count: 1, piece: { cond: 1 } }] }));
    expect(w.get('a')!.bag).toEqual([{ item: 'halo', count: 1, piece: { cond: 1, quirk: 'footprints' } }, { item: 'coat', count: 1, piece: { cond: 1 } }, { item: 'cloth', count: 1 }]);
    const piles = new World([...fixtureMaps().filter(m => m.data.id !== 'house'), house()], 'town', 'overcast', {
      items: ROAD, rng: () => 0, drops: [{ owner: 'z', name: 'Z', map: 'woods', x: 3, y: 6, items: [{ item: 'coat', count: 2 }], droppedAt: Date.now() }],
    });
    piles.join(rec('b', 'woods', 3, 5), 0);
    piles.pick('b', 3, 6, 1000);
    expect(piles.get('b')!.bag).toEqual([{ item: 'coat', count: 1, piece: { cond: 1 } }]);
  });
});

describe('pieces in storage', () => {
  it('keeps how worn each piece is, its quirk, and the pieces in the stash, in memory', async () => {
    const { MemoryStorage } = await import('../src/storage');
    const storage = new MemoryStorage();
    const r = rec('a', 'town', 1, 2);
    await storage.create(r);
    const worn = { ...r, gear: { shirt: 'coat' }, worn: { shirt: { cond: 0.35, quirk: 'hum' as const } }, stash: { items: { coat: 1 }, out: {}, pieces: { coat: [{ cond: 0.2 }] } } };
    await storage.save(worn);
    expect(storage.get('a')).toMatchObject({ worn: worn.worn, stash: worn.stash });
  });
});
