/**
 * Generates the Other Woods (docs/DESIGN.md, World structure): content/maps/other-woods.json and its one room,
 * other-woods-old-cabin.json. Past the ranger's camp in the Turning (gen-turning.ts): the Near Woods again, every
 * path and pond of them, east for west, under the green sky of the night of the answer, which never moves there
 * (MapData.sky). Made from the Near Woods as gen:woods and gen:interiors last wrote them, so run it after both:
 * whatever changes there is said back here too. Usage: npm run gen:other-woods
 *
 * What the woods said back is not quite what is there: the cabins and the ranger's hut stand as burned shells, all
 * but the old cabin, whose fire burns here too; the signs read backwards; the lamps are lit, the one with no wires
 * too; the jeep NAPO burned out is whole; Walt's truck has its lights on. What came after that night is not here:
 * nobody's notes, no slab in the ring, no footbridge over the creek, no lookout climbed. The trappers' trail and the
 * road to town give out in the firs. The way home is the Turning's mouth said back, on the east edge by the ring,
 * and leads back to the ranger's camp. The ranger's notes from here lie on what the woods said back.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FRONTED, STEP_MS, TileMap, doorOf, energyRate, maxEnergy, objectTiles, validateMap, type Dir, type MapData, type MapExit, type MapObject } from '../packages/shared/src';
import { noteAt } from './notes-left';
import { CAMP_BACK, NEAR_WOODS_MOUTH, OTHER_WOODS_BACK, OTHER_WOODS_MOUTH } from './turning-mouth';

const load = (id: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, `../content/maps/${id}.json`), 'utf8')) as MapData;
const near = load('near-woods'), cabin = load('near-woods-old-cabin');
const W = near.width, H = near.height;
if (OTHER_WOODS_MOUTH.x !== W - 1 - NEAR_WOODS_MOUTH.x || OTHER_WOODS_MOUTH.y !== NEAR_WOODS_MOUTH.y) throw new Error('the Other Woods\' way home is not the Turning\'s mouth said back');

const FLIP: Readonly<Record<Dir, Dir>> = { left: 'right', right: 'left', up: 'up', down: 'down' };
/** Mirror writing: each line said back, letter for letter. */
const backwards = (lines: string[]) => lines.map(l => [...l].reverse().join(''));
/** An object moved to where the mirror puts it, whatever its size: its tiles flipped east for west. */
function mirror<T extends MapObject>(o: T, width: number): T {
  const xs = objectTiles(o).map(([x]) => x);
  const dx = width - 1 - Math.max(...xs) - Math.min(...xs);
  const out = { ...o, x: o.x + dx };
  if ('dir' in out && (out.dir === 'left' || out.dir === 'right')) (out as { dir: Dir }).dir = FLIP[out.dir];
  return out;
}

const tile = near.tiles.map(r => [...r].reverse());
const levels = near.levels.map(r => [...r].reverse().join(''));
/** Any way out the Near Woods have, said back, gives out in the firs: only the mouth leads anywhere. */
for (const e of near.exits) {
  const m = mirror({ kind: 'barrel', x: e.x, y: e.y } as MapObject, W);
  for (let x = m.x - e.w + 1; x <= m.x; x++) for (let y = e.y; y < e.y + e.h; y++) if (y === 0 || y === H - 1 || x === 0 || x === W - 1) tile[y]![x] = 't';
}
tile[OTHER_WOODS_MOUTH.y]![OTHER_WOODS_MOUTH.x] = 'm';

// ---- What stands there ----

/** The old cabin, the one house the woods said back whole, with its fire. */
const OLD_CABIN = 'near-woods-old-cabin';
const doorTo = new Map(near.exits.map(e => [`${e.x},${e.y}`, e.to]));
const objects: MapObject[] = [];
let kept: Extract<MapObject, { kind: 'house' }> | undefined;
for (const o of near.objects) {
  switch (o.kind) {
    // What came after that night is not here.
    case 'note': case 'slab': case 'footbridge': continue;
    case 'house': {
      const d = doorOf(o), m = mirror(o, W);
      if (doorTo.get(`${d.x},${d.y}`) === OLD_CABIN) objects.push((kept = { ...m, lit: 1 }));
      else objects.push({ kind: 'ruin', x: m.x, y: m.y, w: o.w, h: o.h });
      continue;
    }
    // The lookout said back fell in: a shell of timbers where it stood.
    case 'lookout': { const m = mirror(o, W); objects.push({ kind: 'ruin', x: m.x, y: m.y, w: 2, h: 2 }); continue; }
    case 'sign': objects.push({ ...mirror(o, W), text: backwards(o.text) }); continue;
    case 'jeep': objects.push({ ...mirror(o, W), text: ['Stenciled on the door: NAPO · FIELD SURVEY · UNIT 7. Not a mark of fire on it.', 'The bonnet is warm.'] }); continue;
    // Every lamp is lit: none waits to be mended.
    case 'lamp': { const { works: _w, dark: _d, ...rest } = mirror(o, W); objects.push(rest); continue; }
    default: objects.push(mirror(o, W));
  }
}
if (!kept) throw new Error('the Near Woods have no old cabin to say back');

// The road home gives out where the town should be.
const roadEnd = (() => {
  const taken = new Set(objects.flatMap(o => [...objectTiles(o), ...(FRONTED.has(o.kind) ? [[o.x, o.y + 1]] : [])].map(([x, y]) => `${x},${y}`)));
  const open = (x: number, y: number) => 'gm'.includes(tile[y]?.[x] ?? 't') && !taken.has(`${x},${y}`);
  // The last bit of road before the edge with open ground beside it, and in front of that.
  for (let y = H - 3; y > 0; y--) for (let x = 1; x < W - 1; x++) if (tile[y]![x] === 'r' && open(x - 1, y) && open(x - 1, y + 1)) return [x - 1, y] as const;
  throw new Error('no room for a sign where the road gives out');
})();
objects.push({ kind: 'sign', x: roadEnd[0], y: roadEnd[1], text: backwards(['Stonebrook', 'Pop. 23']) });

// The ranger's notes from here, last, on what the woods said back (notes-left.ts): on the pole the line ends at,
// in Walt's truck, and on a pole by the pond.
const poles = objects.filter((o): o is Extract<MapObject, { kind: 'pole' }> => o.kind === 'pole');
const car = objects.find((o): o is Extract<MapObject, { kind: 'car' }> => o.kind === 'car')!;
const pond = near.places!.find(p => p.name === 'pond')!;
const byPond = poles.reduce((a, b) => (Math.hypot(a.x - (W - 1 - pond.x), a.y - pond.y) <= Math.hypot(b.x - (W - 1 - pond.x), b.y - pond.y) ? a : b));
const lastPole = poles.at(-1)!;
objects.push(noteAt('ranger-other-line', lastPole.x, lastPole.y), noteAt('ranger-other-truck', car.x, car.y), noteAt('ranger-other-me', byPond.x, byPond.y));

// ---- The old cabin's room, said back ----

const door = doorOf(kept);
const roomW = cabin.width;
const room: MapData = {
  ...cabin, id: 'other-woods-old-cabin', name: 'The old cabin', version: 1,
  tiles: cabin.tiles.map(r => [...r].reverse().join('')),
  levels: cabin.levels.map(r => [...r].reverse().join('')),
  spawn: { ...cabin.spawn, x: roomW - 1 - cabin.spawn.x },
  exits: cabin.exits.map(e => ({ ...e, x: roomW - 1 - e.x, to: 'other-woods', tx: door.x, ty: door.y + 1 })),
  // Its fire burns, nobody about; no notes, and its crate is its own.
  objects: cabin.objects.flatMap((o): MapObject[] => (o.kind === 'note' ? [] : o.kind === 'cache' ? [{ ...mirror(o, roomW), name: 'the other cabin\'s crate' }] : [mirror(o, roomW)])),
};
const roomWay = room.exits[0]!;

const exits: MapExit[] = [
  { x: OTHER_WOODS_MOUTH.x, y: OTHER_WOODS_MOUTH.y, w: 1, h: 1, to: 'turning-camp', tx: CAMP_BACK.x, ty: CAMP_BACK.y, dir: 'right', home: true },
  { x: door.x, y: door.y, w: 1, h: 1, to: room.id, tx: roomWay.x, ty: roomWay.y - 1, dir: 'up' },
];

const map: MapData = {
  id: 'other-woods', name: 'The Other Woods', version: 1, kind: 'wilds', depth: 3, width: W, height: H,
  tiles: tile.map(r => r.join('')), levels,
  spawn: { x: OTHER_WOODS_BACK.x, y: OTHER_WOODS_BACK.y, dir: 'left' },
  exits, objects,
  // Never any rain, never a surge or a storm: the sky never moves. Flashes go on, and the watchers and skulkers
  // the dark lets out never go back in.
  rain: [],
  flashes: { every: 60, steps: [20, 999] },
  watchers: { count: 4, steps: [30, 999], stepMs: 450 },
  skulkers: { count: 4, steps: [25, 999], when: ['night'], stepMs: 228 },
  places: near.places!.map(p => ({ ...p, x: W - 1 - p.x })),
  sky: 'answer',
};

// ---- Output ----

const KEYS = ['id', 'name', 'version', 'kind', 'depth', 'width', 'height', 'style', 'tiles', 'levels', 'spawn', 'exits', 'objects', 'rain', 'flashes', 'watchers', 'skulkers', 'places', 'sky'] as const;
/** One row or object per line, so map changes show up as small, readable diffs. */
function json(m: MapData): string {
  const lines = KEYS.filter(k => m[k] !== undefined).map(k => {
    const v = m[k];
    return Array.isArray(v) && ['tiles', 'levels', 'exits', 'objects', 'places'].includes(k)
      ? `  "${k}": [\n${(v as unknown[]).map(e => `    ${JSON.stringify(e)}`).join(',\n')}\n  ]`
      : `  "${k}": ${JSON.stringify(v)}`;
  });
  return `{\n${lines.join(',\n')}\n}\n`;
}
for (const m of [map, room]) {
  const problems = validateMap(m);
  for (const p of problems) console.log(`${m.id}: ${p.level}: ${p.message}`);
  if (problems.some(p => p.level === 'error')) process.exit(1);
  writeFileSync(resolve(import.meta.dirname, `../content/maps/${m.id}.json`), json(m));
}

const tm = new TileMap(map);
let deepest = [0, 0, 0];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = tm.homeSteps(x, y); if (s > deepest[0]!) deepest = [s, x, y]; }
const lasts = (x: number, y: number, lvl: number) => (maxEnergy(lvl) / -energyRate(tm, x, y, 'aurora')).toFixed(0);
const [ds, dx, dy] = deepest as [number, number, number];
console.log(`wrote other-woods (${W}x${H}, ${objects.length} objects) and its old cabin; deepest ${ds} steps (${(ds * STEP_MS / 1000).toFixed(0)} s walking), the old cabin's door ${tm.homeSteps(door.x, door.y + 1)} steps in`);
console.log(`a full bar lasts ${lasts(OTHER_WOODS_BACK.x, OTHER_WOODS_BACK.y, 1)} s at the mouth (level 10: ${lasts(OTHER_WOODS_BACK.x, OTHER_WOODS_BACK.y, 10)} s, level 20: ${lasts(OTHER_WOODS_BACK.x, OTHER_WOODS_BACK.y, 20)} s), ${lasts(dx, dy, 1)} s at the deepest (level 10: ${lasts(dx, dy, 10)} s, level 20: ${lasts(dx, dy, 20)} s)`);
console.log(`from the old cabin's fire: ${lasts(door.x, door.y + 1, 10)} s at level 10`);
