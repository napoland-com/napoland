/**
 * Loads game content from disk. A map that fails validation stops the server: a broken map
 * would let players walk through walls or get stuck.
 */
import { readFileSync } from 'node:fs';
import { TileMap, validateMap, type MapData } from '@napoland/shared';

export function loadMap(file: string): { map: TileMap; warnings: string[] } {
  let data: MapData;
  let problems: ReturnType<typeof validateMap>;
  try {
    data = JSON.parse(readFileSync(file, 'utf8')) as MapData;
    problems = validateMap(data);
  } catch (err) {
    throw new Error(`map ${file} cannot be read: ${err instanceof Error ? err.message : String(err)}`);
  }
  const errors = problems.filter(p => p.level === 'error').map(p => p.message);
  if (errors.length) throw new Error(`map ${file} is invalid:\n  ${errors.join('\n  ')}`);
  return { map: new TileMap(data), warnings: problems.filter(p => p.level === 'warning').map(p => p.message) };
}
