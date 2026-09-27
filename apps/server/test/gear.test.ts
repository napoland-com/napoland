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
    expect(onMap(out, 'house')).toContainEqual({ t: 'gear', id: 'a', gear: { ...STARTER, shirt: 'coat' } });
    expect(of(to(out, 'a'), 'chest')).toEqual([{ t: 'chest', stash: [{ item: 'worn-shirt', count: 1 }] }]);
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
    expect(onMap(out, 'house')).toContainEqual({ t: 'gear', id: 'a', gear: { shirt: 'worn-shirt', gloves: 'worn-gloves', pants: 'worn-pants', shoes: 'worn-shoes', bag: 'backpack' } });
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
      { t: 'crafted', item: 'coat', count: 1 },
      { t: 'bench', stash: [{ item: 'coat', count: 1 }, { item: 'cloth', count: 1 }] },
    ]);
    expect(w.takeWrites().players[0]!.stash).toEqual({ items: { cloth: 1, coat: 1 }, out: {} });
  });

  it('refuses what the stash cannot pay for, recipes that do not exist, and from too far', () => {
    const w = world(rec('a', 'house', 1, 2, { stash: { items: { cloth: 3 }, out: {} } }));
    w.craft('a', 1, 1, 'coat', 1000);
    w.craft('a', 1, 1, 'crown', 1000);
    w.craft('a', 3, 1, 'coat', 1000);
    expect(of(to(w.drain(), 'a'), 'refused').map(r => r.reason)).toEqual(['missing', 'gone', 'too_far']);
  });
});
