/**
 * Checks every map in content/maps with the shared validator, then how the maps fit together: exits
 * lead onto walkable ground in maps that exist, and every map can be reached from the home town.
 * Then content/items.json: every item well formed, and every find rule on a real map with room to grow.
 * Warnings are printed; any error makes the exit code 1. Usage: npm run validate
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateItems, validateMap, validateWorld, type ItemsData, type MapData } from '../packages/shared/src';

/** The town where new players start and collapsed players wake up. */
const HOME = 'stonebrook';

const dir = resolve(import.meta.dirname, '../content/maps');
const maps: MapData[] = [];
let errors = 0;
for (const file of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  try {
    const data = JSON.parse(readFileSync(join(dir, file), 'utf8')) as MapData;
    const problems = validateMap(data);
    for (const p of problems) console.log(`${file}: ${p.level}: ${p.message}`);
    errors += problems.filter(p => p.level === 'error').length;
    if (!problems.length) console.log(`${file}: ok (${data.width}x${data.height}, ${data.objects.length} objects)`);
    maps.push(data);
  } catch (err) {
    console.log(`${file}: error: cannot be checked: ${err instanceof Error ? err.message : String(err)}`);
    errors++;
  }
}

// validateWorld and validateItems assume every map is sound on its own, so they run only once they all are.
const mapErrors = errors;
if (mapErrors) console.log('world: not checked until every map is valid');
else {
  const problems = validateWorld(maps, HOME);
  for (const p of problems) console.log(`world: ${p.map}: ${p.level}: ${p.message}`);
  errors += problems.filter(p => p.level === 'error').length;
  if (!problems.length) console.log(`world: ok (${maps.length} maps joined up, home ${HOME})`);
}

const ITEMS = 'items.json';
if (mapErrors) console.log(`${ITEMS}: not checked until every map is valid`);
else {
  try {
    const data = JSON.parse(readFileSync(resolve(import.meta.dirname, '../content', ITEMS), 'utf8')) as ItemsData;
    const problems = validateItems(data, maps);
    for (const p of problems) console.log(`${ITEMS}: ${p.level}: ${p.message}`);
    errors += problems.filter(p => p.level === 'error').length;
    if (!problems.length) console.log(`${ITEMS}: ok (${data.items.length} items, ${data.finds.length} find rules)`);
  } catch (err) {
    console.log(`${ITEMS}: error: cannot be checked: ${err instanceof Error ? err.message : String(err)}`);
    errors++;
  }
}
process.exit(errors ? 1 : 0);
