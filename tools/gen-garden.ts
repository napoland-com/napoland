/**
 * Generates content/maps/home-garden.json: the garden every player's home stands in, their own and nobody
 * else's. A clearing in the forest, a picket fence all round it and no gate: the only way out is NAPO's
 * teleport inside the house (gen-interiors.ts), and the only way in is the house's door, or a friend's
 * visit from the friends list, which sets them down by that teleport (roadmap/home-lots.md). The server
 * keeps a copy of this map for each player (the server's zones), so the garden is the same for everyone
 * and never reshuffles: always the same layout, no dice. What changes is the house in it, as its owner
 * builds it up (a garage, then a cabin, then a house: house.ts); its footprint stays the same, so the
 * garden around it never moves. This script is the source of the map: change it, not the JSON.
 * Usage: npm run gen:garden (before gen:interiors, which checks the house's door leads into the home).
 *
 *   the forest all round, two deep; the fence one tile inside it
 *   the house (5 by 3) at the back, its door on y 5, the path from it down the middle
 *   a vegetable bed of turned earth to the left of the path, the woodpile and a barrel to the right
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TileMap, doorOf, objectTiles, validateMap, type MapData, type MapExit, type MapObject } from '../packages/shared/src';
import { doorInto } from './gen-interiors';

export const GARDEN_ID = 'home-garden';
const W = 17, H = 15;
/** The house, 5 by 3: its door is the middle of its front row (doorOf). */
export const HOME = { kind: 'house', x: 6, y: 3, w: 5, h: 3, roof: '#5d4a3b', lit: 0, plate: true } as const;

function build(): MapData {
  const tile: string[][] = Array.from({ length: H }, () => Array<string>(W).fill('g'));
  const rect = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tile[y]![x] = c;
  };
  // The forest all round the clearing, two tiles deep, so nothing shows past it.
  rect(0, 0, W - 1, 1, 't');
  rect(0, H - 2, W - 1, H - 1, 't');
  rect(0, 0, 1, H - 1, 't');
  rect(W - 2, 0, W - 1, H - 1, 't');
  const door = doorOf(HOME);
  // A path of packed earth from the door down to the fence, and a bed of turned earth beside it.
  rect(door.x, door.y + 1, door.x, H - 4, 'l');
  rect(3, 8, 6, 10, 'm');

  const objects: MapObject[] = [HOME];
  // The fence, one tile inside the forest, all the way round: no gate, the garden is closed.
  for (let x = 2; x <= W - 3; x++) objects.push({ kind: 'fence', x, y: 2, dir: 'h' }, { kind: 'fence', x, y: H - 3, dir: 'h' });
  for (let y = 3; y <= H - 4; y++) objects.push({ kind: 'fence', x: 2, y, dir: 'v' }, { kind: 'fence', x: W - 3, y, dir: 'v' });
  // A light by the door, a rain barrel at the house's corner, a stump to split wood on and the logs beside it.
  objects.push({ kind: 'lamp', x: door.x + 2, y: door.y + 1 });
  objects.push({ kind: 'barrel', x: HOME.x + HOME.w, y: HOME.y + HOME.h - 1 });
  objects.push({ kind: 'stump', x: 12, y: 9, s: 1, v: 0.4 }, { kind: 'logs', x: 11, y: 11, w: 2, h: 1 });
  // Two firs in the back corners and one by the bed, clear of the path.
  objects.push({ kind: 'tree', x: 3, y: 3, s: 1.1, v: 0.3 }, { kind: 'tree', x: W - 4, y: 3, s: 1, v: 0.7 }, { kind: 'tree', x: 3, y: 11, s: 0.9, v: 0.5 });

  const exits: MapExit[] = [doorInto('stonebrook-home', GARDEN_ID, HOME)];
  return {
    id: GARDEN_ID, name: 'Garden', version: 1, kind: 'town', depth: 0, width: W, height: H, private: true,
    tiles: tile.map(r => r.join('')),
    levels: tile.map(r => '0'.repeat(r.length)),
    // Out of the house: in front of its door, facing the garden.
    spawn: { x: door.x, y: door.y + 1, dir: 'down' },
    exits,
    objects,
  };
}

// One row or object per line, like the other maps, so changes show up as small, readable diffs.
function json(map: MapData): string {
  return [
    '{',
    `  "id": ${JSON.stringify(map.id)},`, `  "name": ${JSON.stringify(map.name)},`, `  "version": ${map.version},`,
    `  "kind": ${JSON.stringify(map.kind)},`, `  "depth": ${map.depth},`,
    `  "width": ${map.width},`, `  "height": ${map.height},`,
    '  "private": true,',
    '  "tiles": [', map.tiles.map(r => `    ${JSON.stringify(r)}`).join(',\n'), '  ],',
    '  "levels": [', map.levels.map(r => `    ${JSON.stringify(r)}`).join(',\n'), '  ],',
    `  "spawn": ${JSON.stringify(map.spawn)},`,
    '  "exits": [', map.exits.map(e => `    ${JSON.stringify(e)}`).join(',\n'), '  ],',
    '  "objects": [', map.objects.map(o => `    ${JSON.stringify(o)}`).join(',\n'), '  ]',
    '}',
    '',
  ].join('\n');
}

if (import.meta.main) {
  const map = build();
  const out = resolve(import.meta.dirname, `../content/maps/${map.id}.json`);
  writeFileSync(out, json(map));
  const tm = new TileMap(map), glyph = new Map<string, string>();
  const GLYPH: Partial<Record<MapObject['kind'], string>> = { house: 'H', lamp: '*', tree: 'T', fence: '#', barrel: 'b', stump: 's', logs: 'l' };
  for (const o of map.objects) for (const [x, y] of objectTiles(o)) glyph.set(`${x},${y}`, GLYPH[o.kind] ?? '?');
  console.log(`wrote ${out}: "${map.name}", ${W}x${H}`);
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) row += tm.exitAt(x, y) ? 'v' : glyph.get(`${x},${y}`) ?? (tm.kind(x, y) === 'forest' ? ' ' : tm.kind(x, y) === 'lot' ? '=' : tm.kind(x, y) === 'mud' ? '~' : '.');
    console.log(`    ${row}`);
  }
  // A generated map is drawn by hand no more than a room is: even a warning is a mistake here.
  const problems = validateMap(map);
  for (const p of problems) console.log(`${p.level}: ${map.id}: ${p.message}`);
  if (problems.length) process.exit(1);
}
