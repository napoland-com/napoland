/**
 * Checks every map in content/maps with the shared validator. Exit code 1 on any error.
 * Usage: npm run validate
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateMap, type MapData } from '../packages/shared/src';

const dir = resolve(import.meta.dirname, '../content/maps');
let errors = 0;
for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
  const data = JSON.parse(readFileSync(join(dir, file), 'utf8')) as MapData;
  const problems = validateMap(data);
  for (const p of problems) console.log(`${file}: ${p.level}: ${p.message}`);
  errors += problems.filter(p => p.level === 'error').length;
  if (!problems.length) console.log(`${file}: ok (${data.width}x${data.height}, ${data.objects.length} objects)`);
}
process.exit(errors ? 1 : 0);
