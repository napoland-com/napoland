import { describe, expect, it } from 'vitest';
import { QUIRKS, SLOTS, charmsIn, itemIndex, modsOf, reveal, seeded, type ItemsData } from '../src';
import json from '../../../content/items.json';

const data = json as ItemsData;
const items = itemIndex(data);
const strange = items.get('strange')!;
const reveals = strange.reveals!;
const kind = (id: string) => items.get(id)!.kind;
const weight = (pick: (id: string) => boolean) => reveals.filter(r => pick(r.item)).reduce((n, r) => n + r.weight, 0);
const total = weight(() => true);

describe('what a strange object turns out to be', () => {
  it('is one of 15 things, each with a line on what it is good for', () => {
    expect(reveals).toHaveLength(15);
    expect(new Set(reveals.map(r => r.item)).size).toBe(15);
    for (const r of reveals) expect(items.get(r.item)?.about, r.item).toBeTruthy();
  });

  it('is rare gear 1 time in 20 in all, and a charm about 1 time in 4', () => {
    expect(total).toBe(120);
    expect(weight(id => kind(id) === 'gear') / total).toBe(1 / 20);
    const charms = weight(id => kind(id) === 'charm') / total;
    expect(charms).toBeGreaterThan(0.22);
    expect(charms).toBeLessThan(0.28);
    // And so it comes out, over many looks.
    const rng = seeded(7), n = 40_000, got = { gear: 0, charm: 0 };
    for (let i = 0; i < n; i++) {
      const k = kind(reveal(reveals, rng)!.item);
      if (k === 'gear' || k === 'charm') got[k]++;
    }
    expect(got.gear / n).toBeCloseTo(0.05, 2);
    expect(got.charm / n).toBeCloseTo(0.25, 1);
  });

  it('can be anomalous gear for every slot but the bag, NAPO crews\' white-suit kit among it', () => {
    const gear = reveals.map(r => items.get(r.item)!).filter(d => d.kind === 'gear');
    expect(gear.every(d => d.tier === 'anomalous')).toBe(true);
    expect(new Set(gear.map(d => d.slot))).toEqual(new Set(SLOTS.filter(s => s !== 'bag')));
    expect(gear.map(d => d.id)).toEqual(expect.arrayContaining(['crew-hood', 'crew-jacket', 'crew-gloves', 'crew-trousers', 'crew-boots']));
    // Like the other anomalous piece: it resists what the anomalies do, and comes one at a time.
    for (const d of gear) {
      expect(Object.keys(d.resist ?? {}).some(e => e === 'radiation' || e === 'electricity'), d.id).toBe(true);
      expect(reveals.find(r => r.item === d.id)!.count, d.id).toBe(1);
      expect(d.about, d.id).toMatch(/^Put (it|them) on from your bag/);
    }
  });

  it('is a handful of cloth now and then', () => {
    const cloth = reveals.find(r => r.item === 'cloth')!;
    expect(cloth.count).toBeGreaterThanOrEqual(2);
    expect(cloth.weight / total).toBeLessThan(0.1);
  });
});

describe('the new charms', () => {
  it('an ember coal makes fires warm you 20% faster; a pale moth gives 1 energy for a crushed glowcap', () => {
    const mods = modsOf({}, charmsIn([{ item: 'ember-coal', count: 1 }, { item: 'pale-moth', count: 1 }], items));
    expect(mods.warmth).toBeCloseTo(1.2, 10);
    expect(mods.markEnergy).toBe(1);
    // One of each kind works: a second moth does not give twice.
    expect(modsOf({}, charmsIn([{ item: 'pale-moth', count: 1 }, { item: 'pale-moth', count: 1 }], items)).markEnergy).toBe(1);
  });

  it('say in the game\'s words what they do', () => {
    expect(items.get('ember-coal')!.about).toBe('While it is in your bag, fires warm you 20% faster.');
    expect(items.get('pale-moth')!.about).toBe('While it is in your bag, crushing a glowcap gives you 1 energy.');
  });
});

describe('the new quirks', () => {
  it('are rolled like the others, and named with what they do', () => {
    expect(QUIRKS).toEqual(expect.arrayContaining(['hush', 'lodestone', 'afterglow']));
    for (const q of QUIRKS) expect(data.quirks?.find(x => x.id === q)?.text, q).toBeTruthy();
  });
});
