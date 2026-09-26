/**
 * Content checks for maps. Run on every change (npm run validate) so a broken map never ships.
 */
import { TILE_CHARS, TileMap, objectTiles, type MapData } from './map';
import { DIRS, stepTarget } from './movement';

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
  if (out.some(p => p.level === 'error')) return out;

  const map = new TileMap(data);
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
  return out;
}
