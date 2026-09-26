/**
 * Loads game content from disk. A map that fails validation stops the server: a broken map would
 * let players walk through walls, get stuck, or walk through an exit into nowhere.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { TileMap, validateMap, validateWorld, type MapData } from '@napoland/shared';

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

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
