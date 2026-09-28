/**
 * Generates content/maps/residents-lane.json: Residents' Lane, where the cabins of the people who stayed
 * stand, thirty lots in three rows, each a plain cabin like the leavers' houses with a name plate by its
 * door, lamps between them and a few trees behind. Every player's cabin stands on a street, and every
 * street is a copy of this one map (the server's zones), so the lane is the same for everyone and never
 * reshuffles: always the same layout, no dice. This script is the source of the map: change it, not the
 * JSON. Usage: npm run gen:street (after gen:map, whose road onto the lane it checks, and before
 * gen:interiors, which checks every cabin's door leads into the cabin).
 *
 * The lane is a road's end: Stonebrook's main street runs on west out of town (gen-map.ts) and comes in
 * here at the east end of the first row's lane, and walking back off that end leads into town along it
 * (roadmap/street-visits.md). Each lot's door leads into its owner's own cabin (the private home room,
 * gen-interiors.ts): the server lets each player in through their own, and a neighbor in through theirs
 * when they let neighbors visit.
 *
 *   row 2 (lots 20-29)   y 5-6    cabins, doors on y 6, the lane in front on y 7-8
 *   row 1 (lots 10-19)   y 12-13  gardens behind on y 9-11
 *   row 0 (lots 0-9)     y 19-20  gardens behind on y 16-18, the lane in front on y 21-22
 *   the three lanes joined on x 2-3; the road to Stonebrook off the east edge, on y 21-22
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TileMap, objectTiles, validateMap, type MapData, type MapExit, type MapObject } from '../packages/shared/src';
import { doorInto } from './gen-interiors';

export const LANE_ID = 'residents-lane';
const W = 47, H = 26;
/** Ten cabins to a row, three rows: the lots in order, the row nearest the way in first. */
const PER_ROW = 10;
const ROWS = [19, 12, 5] as const;
/** The first cabin's west edge, and how far apart they stand (three wide, one tile of garden between). */
const FIRST_X = 5, STEP = 4;
/** Where the road from town comes in, and where you stand when you arrive: walking on west, toward the cabins. */
export const LANE_SPAWN = { x: W - 2, y: ROWS[0] + 2, dir: 'left' } as const;
/**
 * Where Stonebrook's main street runs off the town's west edge onto the lane (gen-map.ts paints it), two
 * tiles wide like every road out; the lane's end leads back onto it, walking on east into town.
 */
export const TOWN_ROAD = { x: 0, y: 17, h: 2 } as const;
/** Roofs, muted like the town's, a different one from lot to lot. */
const ROOFS = ['#6b7075', '#7a4b33', '#4a5a44', '#5d4a3b', '#4f5b62', '#6a4638', '#55603f'];

/** The exit where Stonebrook's main street runs off the edge of town: onto the lane where its road comes in. */
export function ontoStreet(): MapExit {
  return { x: TOWN_ROAD.x, y: TOWN_ROAD.y, w: 1, h: TOWN_ROAD.h, to: LANE_ID, tx: LANE_SPAWN.x, ty: LANE_SPAWN.y, dir: 'left' };
}

function build(): MapData {
  const tile: string[][] = Array.from({ length: H }, () => Array<string>(W).fill('g'));
  const rect = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tile[y]![x] = c;
  };
  // The forest all around, then the lanes: one along the front of each row, joined down the west side,
  // and the first row's running on off the east edge, the road to town.
  rect(0, 0, W - 1, 1, 't');
  rect(0, 24, W - 1, H - 1, 't');
  rect(0, 0, 1, H - 1, 't');
  rect(W - 2, 0, W - 1, H - 1, 't');
  rect(2, ROWS[2] + 2, 3, ROWS[0] + 3, 'l');
  for (const y of ROWS) rect(2, y + 2, W - 3, y + 3, 'l');
  rect(W - 2, ROWS[0] + 2, W - 1, ROWS[0] + 3, 'l');

  const objects: MapObject[] = [];
  const exits: MapExit[] = [];
  // The cabins first, lot by lot, so the lots are the houses in the order the map lists them.
  for (let lot = 0; lot < ROWS.length * PER_ROW; lot++) {
    const y = ROWS[Math.floor(lot / PER_ROW)]!, x = FIRST_X + STEP * (lot % PER_ROW);
    const house = { kind: 'house', x, y, w: 3, h: 2, roof: ROOFS[(lot * 3 + Math.floor(lot / PER_ROW)) % ROOFS.length]!, lit: 0, plate: true } as const;
    objects.push(house);
    exits.push(doorInto('stonebrook-home', LANE_ID, house));
  }
  // Lamps in the gaps between the cabins, every other one along each row, one at the west end of the
  // first row's lane, and one where the road from town comes in.
  for (const y of ROWS) for (const k of [1, 3, 5, 7]) objects.push({ kind: 'lamp', x: FIRST_X + 3 + STEP * k, y: y + 1 });
  objects.push({ kind: 'lamp', x: 4, y: 23 });
  objects.push({ kind: 'lamp', x: W - 3, y: ROWS[0] + 4 });
  // A few trees in the gardens behind the rows, in their middle line only, so every garden stays one walk.
  const trees: Array<[number, number]> = [];
  for (const [y, from] of [[ROWS[2] - 2, 6], [ROWS[1] - 2, 9], [ROWS[0] - 2, 7]] as const) {
    for (let x = from, i = 0; x < W - 3; x += 5 + (i % 3), i++) trees.push([x, y]);
  }
  for (const [x, y] of trees) objects.push({ kind: 'tree', x, y, s: 0.9 + ((x * 7 + y * 3) % 5) / 10, v: ((x * 13 + y * 5) % 10) / 10 });

  // The lane's end leads back into Stonebrook along the road that came here: onto its main street, walking east.
  exits.push({ x: W - 1, y: ROWS[0] + 2, w: 1, h: 2, to: 'stonebrook', tx: TOWN_ROAD.x + 1, ty: TOWN_ROAD.y, dir: 'right' });
  return {
    id: LANE_ID, name: 'Residents\' Lane', version: 2, kind: 'town', depth: 0, width: W, height: H, street: true,
    tiles: tile.map(r => r.join('')),
    levels: tile.map(r => '0'.repeat(r.length)),
    spawn: { ...LANE_SPAWN },
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
    '  "street": true,',
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
  for (const o of map.objects) for (const [x, y] of objectTiles(o)) glyph.set(`${x},${y}`, o.kind === 'house' ? 'H' : o.kind === 'lamp' ? '*' : 'T');
  console.log(`wrote ${out}: "${map.name}", ${W}x${H}, ${map.objects.filter(o => o.kind === 'house').length} cabins`);
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) row += tm.exitAt(x, y) ? 'v' : glyph.get(`${x},${y}`) ?? (tm.kind(x, y) === 'forest' ? ' ' : tm.kind(x, y) === 'lot' ? '=' : '.');
    console.log(`    ${row}`);
  }
  // A generated map is drawn by hand no more than a room is: even a warning is a mistake here.
  const problems = validateMap(map);
  for (const p of problems) console.log(`${p.level}: ${map.id}: ${p.message}`);
  // gen-map.ts writes the road onto the lane; this checks it is there, where the lane's end leads back to.
  const town = JSON.parse(readFileSync(resolve(import.meta.dirname, '../content/maps/stonebrook.json'), 'utf8')) as MapData;
  const road = town.exits.find(e => e.to === LANE_ID);
  if (!road || road.x !== TOWN_ROAD.x || road.y !== TOWN_ROAD.y || road.h !== TOWN_ROAD.h) {
    console.log(`error: stonebrook.json has no road at ${TOWN_ROAD.x},${TOWN_ROAD.y} onto ${LANE_ID}: run npm run gen:map again`);
    process.exit(1);
  }
  if (problems.length) process.exit(1);
}
