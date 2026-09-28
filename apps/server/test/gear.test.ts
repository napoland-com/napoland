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
    // A worn piece in the bag would come back new: gear is put on from the chest, never taken out.
    w.take('a', 3, 1, 'coat', 1, 1000);
    expect(to(w.drain(), 'a')).toContainEqual({ t: 'refused', action: 'take', reason: 'gear_stays' });
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
