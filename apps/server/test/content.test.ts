import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ItemsData, MapData } from '@napoland/shared';
import { loadItems, loadMaps } from '../src/content';
import { fixtureMaps, houseData, itemsData, townData, woodsData } from './fixtures';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A folder with these files; maps are written as JSON under their own name. */
function folder(files: Record<string, MapData | string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'napoland-maps-'));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
  return dir;
}

/** The fixture world as files: the town, the house (its door leads there) and the woods. */
const world = (): Record<string, MapData> => ({ 'town.json': townData(), 'house.json': houseData(), 'woods.json': woodsData() });

/** The message of the error loadMaps throws (it must throw). */
function failure(dir: string, home = 'town'): string {
  try {
    loadMaps(dir, home);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('loadMaps did not throw');
}

describe('loadMaps', () => {
  it('loads every map of the folder by id, and nothing else', () => {
    const dir = folder({ ...world(), 'README.md': '# not a map' });
    const { maps, warnings } = loadMaps(dir, 'town');
    expect([...maps.keys()].sort()).toEqual(['house', 'town', 'woods']);
    expect(maps.get('woods')!.exitAt(3, 7)).toEqual({ to: 'town', x: 4, y: 1, dir: 'down' });
    expect(maps.get('town')!.exitAt(7, 2)).toEqual({ to: 'house', x: 2, y: 3, dir: 'up' });
    expect(warnings).toEqual([]);
  });

  it('returns the warnings of each map and of the world', () => {
    // No way in or out; no house either, as its door would have to lead somewhere.
    const island = { ...townData(), id: 'island', name: 'Island', exits: [], objects: [] };
    const lonely = townData();
    lonely.tiles[7] = 'gggggggwwg'; // one tile of grass behind the water
    const dir = folder({ ...world(), 'town.json': lonely, 'island.json': island, 'odd-name.json': { ...island, id: 'odd' } });
    const { maps, warnings } = loadMaps(dir, 'town');
    expect(maps.size).toBe(5);
    expect(warnings).toEqual(
      expect.arrayContaining([
        { map: 'town', message: '1 walkable tiles cannot be reached from the spawn' },
        { map: 'island', message: 'cannot be reached from town' },
        { map: 'odd', message: 'is in odd-name.json; the file should be named odd.json' },
      ]),
    );
  });

  it('stops at a map that is broken on its own, naming the file and every problem', () => {
    const broken = woodsData();
    broken.tiles[2] = 'tgttt'; // too short
    broken.spawn = { x: 0, y: 0, dir: 'up' };
    const msg = failure(folder({ ...world(), 'woods.json': broken }));
    expect(msg).toMatch(/^the maps in .* are not valid/);
    expect(msg).toContain('woods.json: tiles row 2 has 5 tiles, expected 8');
    expect(failure(folder({ ...world(), 'woods.json': { ...woodsData(), kind: 'desert' as 'town' } }))).toContain('woods.json: kind must be');
  });

  it('stops at maps that do not fit together', () => {
    const lost = woodsData();
    lost.exits[0]!.to = 'nowhere';
    expect(failure(folder({ ...world(), 'woods.json': lost }))).toContain('woods: exit 0 (to nowhere): there is no map nowhere');
    const twice = folder({ ...world(), 'copy.json': townData() });
    expect(failure(twice)).toContain('town: two maps have the id town');
  });

  it('wants the home map to exist and to be a town', () => {
    expect(failure(folder(world()), 'stonebrook')).toContain('the home map stonebrook does not exist');
    expect(failure(folder(world()), 'woods')).toContain('the home map must be a town');
    expect(failure(folder(world()), 'house')).toContain('the home map must be a town');
    expect(failure(folder({}))).toContain('the home map town does not exist');
  });

  it('stops at files it cannot read', () => {
    const msg = failure(folder({ ...world(), 'half.json': '{"id": "half", "tiles": [' }));
    expect(msg).toMatch(/half\.json: cannot be read: .*JSON/);
    expect(failure(folder({ ...world(), 'empty.json': '{}' }))).toMatch(/empty\.json: cannot be read/);
    expect(() => loadMaps(join(tmpdir(), 'napoland-no-such-folder'), 'town')).toThrow(/the maps in .* cannot be read/);
  });
});

describe('loadItems', () => {
  /** An items file with this content, in a folder of its own. */
  const file = (body: ItemsData | string) => join(folder({ 'items.json': typeof body === 'string' ? body : JSON.stringify(body) }), 'items.json');

  it('loads items whose finds fit the maps, with the warnings', () => {
    expect(loadItems(file(itemsData()), fixtureMaps())).toEqual({ items: itemsData(), warnings: [] });
    // Three tiles for two moss: little room to move when one is picked.
    const tight = itemsData();
    tight.finds[0]!.count = 2;
    expect(loadItems(file(tight), fixtureMaps()).warnings).toEqual([expect.stringMatching(/only 3 tiles fit the rule for 2 finds/)]);
  });

  it('stops at items that break the rules, naming the file and every problem', () => {
    const bad = itemsData();
    bad.items.push({ ...bad.items[0]! });
    bad.finds.push({ item: 'moss', map: 'nowhere', count: 1, respawn: [1, 2] });
    const path = file(bad);
    expect(() => loadItems(path, fixtureMaps())).toThrow(/^the items in .*items\.json are not valid:/);
    expect(() => loadItems(path, fixtureMaps())).toThrow(/item "moss" is defined twice/);
    expect(() => loadItems(path, fixtureMaps())).toThrow(/there is no map nowhere/);
  });

  it('stops at a file it cannot read', () => {
    expect(() => loadItems(file('{"version": 1, "items": ['), fixtureMaps())).toThrow(/the items in .* cannot be read: .*JSON/);
    expect(() => loadItems(file('{}'), fixtureMaps())).toThrow(/cannot be read: it needs a version, a list of items and a list of finds/);
    expect(() => loadItems(file('{"version": 1, "items": [null], "finds": []}'), fixtureMaps())).toThrow(/cannot be read/);
    expect(() => loadItems(join(tmpdir(), 'napoland-no-such-items.json'), fixtureMaps())).toThrow(/cannot be read/);
  });
});
