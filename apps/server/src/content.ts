/**
 * Loads game content from disk. A map that fails validation stops the server: a broken map would
 * let players walk through walls, get stuck, or walk through an exit into nowhere. So do broken
 * items: a find rule that points nowhere would never grow anything.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { TileMap, validateItems, validateMap, validateStory, validateWorld, type ItemsData, type MapData, type Problem, type StoryData } from '@napoland/shared';

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

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
