/**
 * Content checks for maps. Run on every change (npm run validate) so a broken map never ships.
 * validateMap checks one map on its own; validateWorld checks how the maps fit together.
 */
import { TILE_CHARS, TileMap, objectTiles, type MapData } from './map';
import { DIRS, stepTarget } from './movement';
import { Dir } from './protocol';

export interface Problem {
  level: 'error' | 'warning';
  message: string;
}

export function validateMap(data: MapData): Problem[] {
  const out: Problem[] = [];
  const err = (message: string) => out.push({ level: 'error', message });
  const warn = (message: string) => out.push({ level: 'warning', message });
  if (data.tiles.length !== data.height) err(`tiles has ${data.tiles.length} rows, expected ${data.height}`);
  if (data.levels.length !== data.height) err(`levels has ${data.levels.length} rows, expected ${data.height}`);
  data.tiles.forEach((row, y) => {
    if (row.length !== data.width) err(`tiles row ${y} has ${row.length} tiles, expected ${data.width}`);
    for (const c of row) if (!(c in TILE_CHARS)) err(`tiles row ${y}: unknown tile '${c}'`);
  });
  data.levels.forEach((row, y) => {
    if (row.length !== data.width) err(`levels row ${y} has ${row.length} values, expected ${data.width}`);
    if (!/^[0-9]*$/.test(row)) err(`levels row ${y}: only digits allowed`);
  });
  if (data.kind !== 'town' && data.kind !== 'wilds') err(`kind must be "town" or "wilds", got ${JSON.stringify(data.kind)}`);
  if (!Number.isInteger(data.depth) || data.depth < 0) err(`depth must be a whole number from 0, got ${JSON.stringify(data.depth)}`);
  else if (data.kind === 'town' && data.depth !== 0) err('a town has depth 0');
  else if (data.kind === 'wilds' && data.depth < 1) err('the wilds have depth 1 or more');
  if (!Array.isArray(data.exits)) err('exits must be a list (it may be empty)');
  if (out.some(p => p.level === 'error')) return out;

  const map = new TileMap(data);
  const exitTiles = new Set<string>();
  data.exits.forEach((e, i) => {
    const name = `exit ${i} (to ${e.to})`;
    if (!e.to) err(`exit ${i} has no target map`);
    if (!Dir.safeParse(e.dir).success) err(`${name}: dir must be up, down, left or right`);
    if (!(e.w >= 1 && e.h >= 1)) err(`${name}: w and h must be 1 or more`);
    for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) {
      if (!map.walkable(x, y)) err(`${name}: tile ${x},${y} is not walkable, so nobody can use the exit there`);
      if (exitTiles.has(`${x},${y}`)) err(`${name}: tile ${x},${y} belongs to two exits`);
      exitTiles.add(`${x},${y}`);
    }
  });
  if (data.kind === 'wilds' && !data.exits.some(e => e.home)) err('the wilds need an exit marked home: danger is measured from it');
  if (exitTiles.has(`${data.spawn.x},${data.spawn.y}`)) err('the spawn is on an exit');
  const used = new Map<string, string>();
  for (const o of data.objects) {
    for (const [x, y] of objectTiles(o)) {
      if (!map.inside(x, y)) err(`${o.kind} at ${o.x},${o.y} reaches outside the map`);
      if (o.kind === 'shrooms') continue;
      const key = `${x},${y}`;
      const other = used.get(key);
      if (other) err(`${o.kind} at ${o.x},${o.y} overlaps ${other} on tile ${key}`);
      used.set(key, `${o.kind} at ${o.x},${o.y}`);
    }
    if (o.kind === 'sign' && (!o.text.length || o.text.some(t => !t.trim()))) err(`sign at ${o.x},${o.y} has no text`);
    if (o.kind === 'npc' && !o.lines.length) err(`npc ${o.id} has nothing to say`);
    if (o.kind === 'sign' || o.kind === 'npc') {
      const front = stepTarget(o.x, o.y, 'down');
      if (!map.walkable(front.x, front.y)) err(`${o.kind} at ${o.x},${o.y}: the tile in front (below) is not walkable, so nobody can talk to it`);
    }
  }
  const s = data.spawn;
  if (!map.walkable(s.x, s.y)) err(`spawn ${s.x},${s.y} is not walkable`);

  // Every walkable tile should be reachable from the spawn; islands usually mean a blocked road.
  if (map.walkable(s.x, s.y)) {
    const seen = new Uint8Array(map.width * map.height);
    const queue = [s.y * map.width + s.x];
    seen[queue[0]!] = 1;
    for (let h = 0; h < queue.length; h++) {
      const i = queue[h]!;
      for (const dir of DIRS) {
        const n = stepTarget(i % map.width, (i / map.width) | 0, dir);
        if (!map.walkable(n.x, n.y)) continue;
        const j = n.y * map.width + n.x;
        if (!seen[j]) { seen[j] = 1; queue.push(j); }
      }
    }
    let islands = 0;
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.walkable(x, y) && !seen[y * map.width + x]) islands++;
    if (islands) warn(`${islands} walkable tiles cannot be reached from the spawn`);
  }
  if (data.kind === 'wilds') {
    let lost = 0;
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.walkable(x, y) && map.homeSteps(x, y) < 0) lost++;
    if (lost) warn(`${lost} walkable tiles have no way to a home exit`);
  }
  return out;
}

/**
 * How the maps fit together: every exit leads to a map that exists, onto walkable tiles that are
 * not exits themselves (or you would bounce back and forth), and every map can be reached from
 * the home town. Run validateMap on each map first; this assumes each one is valid on its own.
 */
export function validateWorld(maps: MapData[], homeId: string): Array<Problem & { map: string }> {
  const out: Array<Problem & { map: string }> = [];
  const byId = new Map<string, TileMap>();
  for (const m of maps) {
    if (byId.has(m.id)) out.push({ level: 'error', map: m.id, message: `two maps have the id ${m.id}` });
    byId.set(m.id, new TileMap(m));
  }
  const home = byId.get(homeId);
  if (!home) return [...out, { level: 'error', map: homeId, message: `the home map ${homeId} does not exist` }];
  if (home.data.kind !== 'town') out.push({ level: 'error', map: homeId, message: 'the home map must be a town (collapsed players wake up there)' });

  for (const map of byId.values()) {
    map.data.exits.forEach((e, i) => {
      const where = `exit ${i} (to ${e.to})`;
      const target = byId.get(e.to);
      if (!target) return out.push({ level: 'error', map: map.data.id, message: `${where}: there is no map ${e.to}` });
      for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) {
        const a = map.exitAt(x, y)!;
        if (!target.walkable(a.x, a.y)) out.push({ level: 'error', map: map.data.id, message: `${where}: tile ${x},${y} arrives on ${a.x},${a.y} in ${e.to}, which is not walkable` });
        else if (target.exitAt(a.x, a.y)) out.push({ level: 'error', map: map.data.id, message: `${where}: tile ${x},${y} arrives on ${a.x},${a.y} in ${e.to}, which is an exit itself` });
      }
      if (e.home && target.data.depth >= map.data.depth) out.push({ level: 'warning', map: map.data.id, message: `${where} is marked home but does not lead to a shallower map` });
      return undefined;
    });
  }

  const reached = new Set([homeId]);
  const queue = [homeId];
  for (let h = 0; h < queue.length; h++) {
    for (const e of byId.get(queue[h]!)?.data.exits ?? []) if (byId.has(e.to) && !reached.has(e.to)) { reached.add(e.to); queue.push(e.to); }
  }
  for (const id of byId.keys()) if (!reached.has(id)) out.push({ level: 'warning', map: id, message: `cannot be reached from ${homeId}` });
  return out;
}
