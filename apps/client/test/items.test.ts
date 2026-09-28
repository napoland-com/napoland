import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Weather, type ItemsData } from '@napoland/shared';
import { bannerMs } from '../src/hud';
import { DRAWN_ITEMS, iconFor, itemIcon } from '../src/icons';
import { Items, countOf, plainName, slotViews, useLabel } from '../src/items';
import { ITEM_LOOKS, lookOf, lootGlow, lootModel, type Look } from '../src/view/loot';
import { ITEMS, itemsData } from './fixtures';

/** The items this client ships with. */
const content = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/items.json'), 'utf8')) as ItemsData;

describe('the items catalog', () => {
  it('knows the version it carries, and none without a file', () => {
    expect(ITEMS.version).toBe(4);
    expect(new Items(undefined).version).toBe(0);
    expect(new Items(content).version).toBe(content.version);
  });

  it('finds items by id', () => {
    expect(ITEMS.get('thermos')).toMatchObject({ name: 'Thermos', kind: 'consumable', use: { energy: 30 } });
    expect(ITEMS.has('glowcap')).toBe(true);
  });

  it('stands in for an item it does not know, named after its id', () => {
    expect(ITEMS.has('fir-cone')).toBe(false);
    expect(ITEMS.get('fir-cone')).toMatchObject({ id: 'fir-cone', name: 'Fir cone', kind: 'resource' });
    expect(ITEMS.get('fir-cone').text.length).toBeGreaterThan(0);
    expect(plainName('rad_tablets')).toBe('Rad tablets');
    expect(plainName('')).toBe('Something');
  });

  it('names what the bag\'s button does with something (what it did is said in the text box: said.test.ts)', () => {
    expect(useLabel(ITEMS.get('thermos'))).toBe('Drink');
    expect(useLabel({ ...ITEMS.get('thermos'), name: 'Hand warmer', use: {} })).toBe('Use');
  });

  it('shows each bag slot with its name and text, and offers Use only for consumables', () => {
    const views = slotViews([{ item: 'glowcap', count: 3 }, { item: 'thermos', count: 1 }, { item: 'fir-cone', count: 2 }], ITEMS);
    expect(views.map(v => [v.name, v.count, v.usable])).toEqual([['Glowcap', 3, false], ['Thermos', 1, true], ['Fir cone', 2, false]]);
    expect(views[1]!.text).toBe(itemsData().items[2]!.text);
  });

  it('counts an item over all its slots', () => {
    expect(countOf([{ item: 'glowcap', count: 10 }, { item: 'shard', count: 1 }, { item: 'glowcap', count: 2 }], 'glowcap')).toBe(12);
    expect(countOf([], 'glowcap')).toBe(0);
  });
});

describe('what items look like', () => {
  it('draws every item in content/items.json: an icon for the bag and a model for the ground', () => {
    expect(content.items.length).toBeGreaterThan(0);
    for (const i of content.items) {
      // Gear is drawn by its slot, in its color, and a map as a map: never a sack. Neither grows as a find, so they need no model on the ground.
      // Furniture is drawn by the place it goes into, at the workbench; it stands in the cabin, never on the ground.
      if (i.kind === 'gear' || i.kind === 'tool' || i.kind === 'furniture') {
        expect(iconFor(i), i.id).not.toBe(itemIcon('fir-cone'));
        expect(content.finds.map(f => f.item), i.id).not.toContain(i.id);
        continue;
      }
      expect(DRAWN_ITEMS, i.id).toContain(i.id);
      // A sealed thing (a lockbox) never leaves the chest, where it is opened: it never lies on the ground, nor grows as a find.
      if (i.kind === 'sealed') {
        expect(content.finds.map(f => f.item), i.id).not.toContain(i.id);
        continue;
      }
      expect(lookOf(i.id), i.id).toBe(i.id);
    }
  });

  it('gives every item its own icon, and anything else a sack', () => {
    const icons = DRAWN_ITEMS.map(itemIcon);
    expect(new Set(icons).size).toBe(icons.length);
    for (const svg of icons) expect(svg).toMatch(/^<svg viewBox="0 0 32 32"[^>]*>[\s\S]*<\/svg>$/);
    expect(itemIcon('fir-cone')).toBe(itemIcon('something-else'));
    expect(icons).not.toContain(itemIcon('fir-cone'));
    expect(lookOf('fir-cone')).toBe('sack');
  });

  it('keeps every model small, on the ground and within its tile', () => {
    const glow = new THREE.MeshToonMaterial();
    for (const look of [...ITEM_LOOKS, 'sack', 'pile'] as Look[]) {
      const b = new THREE.Box3().setFromObject(lootModel(look, glow));
      expect(b.min.x, look).toBeGreaterThan(-0.5);
      expect(b.max.x, look).toBeLessThan(0.5);
      expect(b.min.z, look).toBeGreaterThan(-0.5);
      expect(b.max.z, look).toBeLessThan(0.5);
      expect(b.min.y, look).toBeGreaterThan(-0.05);
      // Smaller than a person (about 1 tall), so they never hide one.
      expect(b.max.y, look).toBeLessThan(0.8);
    }
  });

  it('makes the mushrooms, the amber and the crystal glow, and floats the crystal', () => {
    const glow = new THREE.MeshToonMaterial();
    const glowing = (look: Look) => {
      let found = false;
      lootModel(look, glow).traverse(o => { if (o instanceof THREE.Mesh && o.material === glow) found = true; });
      return found;
    };
    expect(['glowcap', 'resin', 'shard'].every(l => glowing(l as Look))).toBe(true);
    expect(['scrap', 'wire', 'cloth', 'thermos', 'pile'].some(l => glowing(l as Look))).toBe(false);
    expect(new THREE.Box3().setFromObject(lootModel('shard', glow)).min.y).toBeGreaterThan(0.2);
  });

  it('glows most in the dark: at night and in a room without a fire', () => {
    expect(lootGlow('wilds', 'night', false)).toBeGreaterThan(lootGlow('wilds', 'rain', false));
    expect(lootGlow('wilds', 'rain', false)).toBeGreaterThan(lootGlow('wilds', 'overcast', false));
    for (const w of Weather.options) {
      expect(lootGlow('inside', w, false)).toBeGreaterThan(lootGlow('inside', w, true));
      expect(lootGlow('town', w, false)).toBe(lootGlow('wilds', w, false));
    }
  });
});

describe('banners', () => {
  it('keeps longer news up longer, so it can be read', () => {
    const place = bannerMs('The Near Woods', '');
    const pile = bannerMs('You collapsed from exhaustion', 'You woke up at home.\nWhat you carried lies where you fell. It fades in an hour.');
    expect(place).toBe(2500);
    expect(pile).toBeGreaterThan(place + 1500);
  });
});
