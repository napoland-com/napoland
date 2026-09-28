/**
 * Loads game content from disk. A map that fails validation stops the server: a broken map would
 * let players walk through walls, get stuck, or walk through an exit into nowhere. So do broken
 * items: a find rule that points nowhere would never grow anything.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  NO_SHOP, TileMap, validateItems, validateMap, validateNotebook, validateShop, validateStory, validateWorld, type ItemsData, type MapData, type NotebookData, type Problem,
  type ShopData, type StoryData,
} from '@napoland/shared';

/** Something odd about a map that does not stop the server, for the log. */
export interface MapWarning {
  map: string;
  message: string;
}

/**
 * Every map in `dir` (the *.json files), checked one by one and then together as one world whose
 * home town is `homeId`. Throws with every error found; returns the maps by id and the warnings.
 */
export function loadMaps(dir: string, homeId: string): { maps: Map<string, TileMap>; warnings: MapWarning[] } {
  let files: string[];
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  } catch (err) {
    throw new Error(`the maps in ${dir} cannot be read: ${reason(err)}`);
  }
  const errors: string[] = [];
  const warnings: MapWarning[] = [];
  const valid: MapData[] = [];
  for (const file of files) {
    let data: MapData;
    let problems: ReturnType<typeof validateMap>;
    try {
      data = JSON.parse(readFileSync(join(dir, file), 'utf8')) as MapData;
      problems = validateMap(data);
    } catch (err) {
      // Not JSON, or so far from a map that the checks themselves fail.
      errors.push(`${file}: cannot be read: ${reason(err)}`);
      continue;
    }
    if (typeof data.id !== 'string' || !data.id) problems.push({ level: 'error', message: 'the map has no id' });
    // Tools (the test bot) find a map by its id: <id>.json.
    else if (data.id !== basename(file, '.json')) problems.push({ level: 'warning', message: `is in ${file}; the file should be named ${data.id}.json` });
    for (const p of problems) {
      if (p.level === 'error') errors.push(`${file}: ${p.message}`);
      else warnings.push({ map: data.id, message: p.message });
    }
    if (!problems.some(p => p.level === 'error')) valid.push(data);
  }
  // validateWorld expects maps that are fine on their own.
  if (!errors.length) {
    for (const p of validateWorld(valid, homeId)) {
      if (p.level === 'error') errors.push(`${p.map}: ${p.message}`);
      else warnings.push({ map: p.map, message: p.message });
    }
  }
  if (errors.length) throw new Error(`the maps in ${dir} are not valid:\n  ${errors.join('\n  ')}`);
  return { maps: new Map(valid.map(d => [d.id, new TileMap(d)])), warnings };
}

/**
 * The words chat masks (content/words.json, next to the items): a list of lowercase words. None if
 * the file is not there. Throws if it is there and is not such a list.
 */
export function loadWords(file: string): string[] {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const data = JSON.parse(raw) as { words?: unknown };
  if (!Array.isArray(data.words) || !data.words.every(w => typeof w === 'string' && /^[\p{Ll}]+$/u.test(w))) {
    throw new Error(`the words in ${file} are not a list of lowercase words`);
  }
  return data.words as string[];
}

/**
 * The items file (content/items.json), checked against the maps its finds grow on. Throws with every
 * error found; returns the items and the warnings.
 */
export function loadItems(file: string, maps: Iterable<TileMap>): { items: ItemsData; warnings: string[] } {
  let data: ItemsData;
  let problems: Problem[];
  try {
    data = JSON.parse(readFileSync(file, 'utf8')) as ItemsData;
    if (typeof data !== 'object' || data === null || !Array.isArray(data.items) || !Array.isArray(data.finds)) {
      throw new Error('it needs a version, a list of items and a list of finds');
    }
    problems = validateItems(data, [...maps].map(m => m.data));
  } catch (err) {
    // Not JSON, or so far from items that the checks themselves fail.
    throw new Error(`the items in ${file} cannot be read: ${reason(err)}`);
  }
  const errors = problems.filter(p => p.level === 'error').map(p => p.message);
  if (errors.length) throw new Error(`the items in ${file} are not valid:\n  ${errors.join('\n  ')}`);
  return { items: data, warnings: problems.map(p => p.message) };
}

/**
 * The story (content/story.json), checked against the maps and items it names: the people and desks
 * that move it on, the maps you reach, the finds you pick. Throws with every error found.
 */
export function loadStory(file: string, maps: Iterable<TileMap>, items?: ItemsData): StoryData {
  let data: StoryData;
  let problems: Problem[];
  try {
    data = JSON.parse(readFileSync(file, 'utf8')) as StoryData;
    if (typeof data !== 'object' || data === null || !Array.isArray(data.chapters)) throw new Error('it needs a version and a list of chapters');
    problems = validateStory(data, [...maps].map(m => m.data), items);
  } catch (err) {
    throw new Error(`the story in ${file} cannot be read: ${reason(err)}`);
  }
  const errors = problems.filter(p => p.level === 'error').map(p => p.message);
  if (errors.length) throw new Error(`the story in ${file} is not valid:\n  ${errors.join('\n  ')}`);
  return data;
}

/**
 * The field notes (content/notebook.json, next to the story), checked against the maps and items its
 * pages are about. None if the file is not there; throws with every error found if it is and is broken.
 */
export function loadNotebook(file: string, maps: Iterable<TileMap>, items?: ItemsData): NotebookData | undefined {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  let data: NotebookData;
  let problems: Problem[];
  try {
    data = JSON.parse(raw) as NotebookData;
    if (typeof data !== 'object' || data === null || !Array.isArray(data.pages)) throw new Error('it needs a version and a list of pages');
    problems = validateNotebook(data, [...maps].map(m => m.data), items);
  } catch (err) {
    throw new Error(`the field notes in ${file} cannot be read: ${reason(err)}`);
  }
  const errors = problems.filter(p => p.level === 'error').map(p => p.message);
  if (errors.length) throw new Error(`the field notes in ${file} are not valid:\n  ${errors.join('\n  ')}`);
  return data;
}

/**
 * What the shop sells (content/shop.json, next to the items), checked: never a look that can be earned,
 * and, when the shop sells in `currency` (SHOP_CURRENCY), a price in it for every look. Nothing for sale
 * if the file is not there; throws with every error found if it is and is broken.
 */
export function loadShop(file: string, currency?: string): ShopData {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return NO_SHOP;
  }
  let data: ShopData;
  let problems: Problem[];
  try {
    data = JSON.parse(raw) as ShopData;
    if (typeof data !== 'object' || data === null) throw new Error('it needs a version and a list of looks');
    problems = validateShop(data, currency);
  } catch (err) {
    throw new Error(`the shop in ${file} cannot be read: ${reason(err)}`);
  }
  const errors = problems.filter(p => p.level === 'error').map(p => p.message);
  if (errors.length) throw new Error(`the shop in ${file} is not valid:\n  ${errors.join('\n  ')}`);
  return data;
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
