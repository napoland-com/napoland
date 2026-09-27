/**
 * Content checks for maps. Run on every change (npm run validate) so a broken map never ships.
 * validateMap checks one map on its own; validateWorld checks how the maps fit together.
 */
import { ELEMENTS, SLOTS, STARTER_GEAR, TIERS, type Element } from './gear';
import { findTiles, type ItemsData } from './items';
import { DECOR, TILE_CHARS, TileMap, doorOf, objectTiles, type MapData, type TileKind } from './map';
import { DIRS, stepTarget } from './movement';
import { Dir } from './protocol';
import { FLASH_BURST_S, FLASH_GLOW_S } from './sky';

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
  if (data.kind !== 'town' && data.kind !== 'wilds' && data.kind !== 'inside') err(`kind must be "town", "wilds" or "inside", got ${JSON.stringify(data.kind)}`);
  if (!Number.isInteger(data.depth) || data.depth < 0) err(`depth must be a whole number from 0, got ${JSON.stringify(data.depth)}`);
  else if (data.kind !== 'wilds' && data.depth !== 0) err(`${data.kind === 'town' ? 'a town' : 'an inside'} has depth 0`);
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
  if (data.kind === 'inside' && !data.exits.length) err('an inside needs a way out (an exit)');
  if (exitTiles.has(`${data.spawn.x},${data.spawn.y}`)) err('the spawn is on an exit');
  const used = new Map<string, string>();
  for (const o of data.objects) {
    if (o.kind === 'house') {
      // Every building can be entered: its door leads inside, and someone must be able to reach it.
      const d = doorOf(o);
      if (!exitTiles.has(`${d.x},${d.y}`)) err(`house at ${o.x},${o.y}: its door ${d.x},${d.y} is not an exit, but every building must lead inside`);
      if (!map.walkable(d.x, d.y + 1)) err(`house at ${o.x},${o.y}: the tile in front of its door (${d.x},${d.y + 1}) is not walkable`);
    }
    for (const [x, y] of objectTiles(o)) {
      if (!map.inside(x, y)) err(`${o.kind} at ${o.x},${o.y} reaches outside the map`);
      if (DECOR.has(o.kind)) continue;
      const key = `${x},${y}`;
      const other = used.get(key);
      if (other) err(`${o.kind} at ${o.x},${o.y} overlaps ${other} on tile ${key}`);
      used.set(key, `${o.kind} at ${o.x},${o.y}`);
    }
    if (o.kind === 'sign' && (!o.text.length || o.text.some(t => !t.trim()))) err(`sign at ${o.x},${o.y} has no text`);
    if (o.kind === 'npc' && !o.lines.length) err(`npc ${o.id} has nothing to say`);
    if (o.kind === 'sign' || o.kind === 'npc' || o.kind === 'board' || o.kind === 'chest' || o.kind === 'workbench') {
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
  if (data.surge) {
    const r = data.surge;
    if (data.kind !== 'wilds') err('only the wilds surge');
    const whole = (v: unknown) => Number.isInteger(v) && (v as number) > 0;
    if (![r.every, r.unstable, r.surge, r.sweep].every(whole)) err('surge: every, unstable, surge and sweep are whole seconds above 0');
    else if (r.unstable + r.surge >= r.every) err('surge: unstable and surge must leave calm time in every round');
    else if (r.sweep > r.surge) err('surge: the front must reach home (sweep) before the surge is over');
    if (r.offset !== undefined && !Number.isFinite(r.offset)) err('surge: offset is a number of seconds');
  }
  if (data.storm) {
    const r = data.storm;
    if (data.kind !== 'wilds') err('only the wilds storm');
    const whole = (v: unknown) => Number.isInteger(v) && (v as number) > 0;
    if (![r.every, r.warn, r.length].every(whole)) err('storm: every, warn and length are whole seconds above 0');
    else if (r.warn + r.length >= r.every) err('storm: warn and length must leave clear time in every round');
    if (r.offset !== undefined && !Number.isFinite(r.offset)) err('storm: offset is a number of seconds');
  }
  if (data.flashes) {
    const f = data.flashes;
    if (data.kind !== 'wilds') err('flashes happen only in the wilds');
    if (!(Number.isFinite(f.every) && f.every > FLASH_GLOW_S + FLASH_BURST_S)) err('flashes: every must be longer than one flash');
    if (!(f.steps?.length === 2 && f.steps[0] >= 0 && f.steps[0] <= f.steps[1])) err('flashes: steps is [nearest, farthest], from 0');
  }
  if (data.watchers) {
    const w = data.watchers;
    if (data.kind !== 'wilds') err('watchers live only in the wilds');
    if (!Number.isInteger(w.count) || w.count < 1) err('watchers: count must be a whole number from 1');
    if (!(w.steps?.length === 2 && w.steps[0] >= 0 && w.steps[0] <= w.steps[1])) err('watchers: steps is [nearest, farthest], from 0');
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
    // A door leads into a building: its exit must go to an inside, not to another town or the wilds.
    for (const o of map.data.objects) {
      if (o.kind !== 'house') continue;
      const d = doorOf(o), into = map.exitAt(d.x, d.y), target = into && byId.get(into.to);
      if (target && target.data.kind !== 'inside') out.push({ level: 'error', map: map.data.id, message: `house at ${o.x},${o.y}: its door leads to ${into!.to}, which is not an inside` });
    }
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

  // The owner's rule for the region right outside the home town: its shelter nearest to the way home
  // keeps a fire that never goes out, so a new player always has one safe fire. Deeper shelters, and
  // regions farther out, may let theirs burn down.
  for (const map of byId.values()) {
    if (map.data.kind !== 'wilds' || !map.data.exits.some(e => e.to === homeId)) continue;
    let nearest: { id: string; steps: number } | undefined;
    for (const e of map.data.exits) {
      const inside = byId.get(e.to);
      if (inside?.data.kind !== 'inside' || !inside.data.objects.some(o => o.kind === 'fireplace')) continue;
      const steps = map.homeSteps(e.x, e.y);
      if (steps >= 0 && (!nearest || steps < nearest.steps)) nearest = { id: e.to, steps };
    }
    if (nearest && !byId.get(nearest.id)!.data.objects.some(o => o.kind === 'fireplace' && o.tended === true)) {
      out.push({ level: 'error', map: nearest.id, message: `the shelter nearest to the way home from ${map.data.id} must keep a fire that never goes out (a fireplace with tended: true), so new players always have one safe fire` });
    }
  }

  const reached = new Set([homeId]);
  const queue = [homeId];
  for (let h = 0; h < queue.length; h++) {
    for (const e of byId.get(queue[h]!)?.data.exits ?? []) if (byId.has(e.to) && !reached.has(e.to)) { reached.add(e.to); queue.push(e.to); }
  }
  for (const id of byId.keys()) if (!reached.has(id)) out.push({ level: 'warning', map: id, message: `cannot be reached from ${homeId}` });
  return out;
}

/**
 * content/items.json: every item well formed, and every find rule pointing at a real item and map,
 * with enough tiles to grow on (at least as many as `count`, and a warning below three times that,
 * because a picked find grows back somewhere else and needs room to move).
 */
export function validateItems(data: ItemsData, maps: MapData[]): Problem[] {
  const out: Problem[] = [];
  const err = (message: string) => out.push({ level: 'error', message });
  const warn = (message: string) => out.push({ level: 'warning', message });
  if (!Number.isInteger(data.version) || data.version < 1) err('version must be a whole number from 1');
  const ids = new Set<string>();
  for (const i of data.items) {
    const name = `item ${JSON.stringify(i.id)}`;
    if (!/^[a-z][a-z0-9-]*$/.test(i.id ?? '')) err(`${name}: ids are lowercase letters, digits and -`);
    if (ids.has(i.id)) err(`${name} is defined twice`);
    ids.add(i.id);
    if (!i.name?.trim()) err(`${name} has no name`);
    if (!i.text?.trim()) err(`${name} has no text`);
    if (!['resource', 'consumable', 'charm', 'gear'].includes(i.kind)) err(`${name}: kind must be resource, consumable, charm or gear`);
    if (i.kind === 'gear') {
      if (!SLOTS.includes(i.slot!)) err(`${name}: gear needs a slot (${SLOTS.join(', ')})`);
      if (i.tier !== undefined && !TIERS.includes(i.tier)) err(`${name}: tier is one of ${TIERS.join(', ')}`);
      if (i.stack !== 1) err(`${name}: gear stacks one to a slot`);
      for (const [e, v] of Object.entries(i.resist ?? {})) {
        if (!ELEMENTS.includes(e as Element)) err(`${name}: resists an unknown element ${e}`);
        else if (!(typeof v === 'number' && v > 0 && v <= 1)) err(`${name}: a resistance is a share above 0, at most 1`);
      }
      if (i.slot === 'bag' && !(Number.isInteger(i.bag) && i.bag! >= 1 && i.bag! <= 64)) err(`${name}: a bag has 1 to 64 slots`);
      if (i.slot !== 'bag' && i.bag !== undefined) err(`${name}: only a bag has slots`);
      if (i.bonus !== undefined && !(Number.isInteger(i.bonus) && i.bonus > 0)) err(`${name}: bonus energy is a whole number above 0`);
      if (i.color !== undefined && !/^#[0-9a-f]{6}$/i.test(i.color)) err(`${name}: color is #rrggbb`);
    } else if (i.slot || i.resist || i.bag || i.bonus || i.tier) err(`${name}: only gear has a slot, a tier, resistances, a bag or bonus energy`);
    if (!Number.isInteger(i.stack) || i.stack < 1) err(`${name}: stack must be a whole number from 1`);
    const effects = Object.values(i.use ?? {}).filter(v => (typeof v === 'number' && v !== 0) || v === true).length;
    if (i.kind === 'consumable' && !effects) err(`${name} is a consumable that does nothing when used`);
    if (i.use && !effects) err(`${name}: use does nothing`);
    if (i.kind === 'charm' && !Object.values(i.charm ?? {}).some(v => typeof v === 'number' && v > 0 && v !== 1)) err(`${name} is a charm that does nothing`);
    if (i.kind !== 'charm' && i.charm) err(`${name}: only charms have a charm`);
    for (const k of Object.keys(i.charm ?? {})) if (!['wetting', 'load', 'hitch', 'warmth'].includes(k)) err(`${name}: a charm changes wetting, load, hitch or warmth, not ${k}`);
    for (const [field, v] of [['weight', i.weight], ['fuel', i.fuel], ['charge', i.charge], ['xp', i.xp]] as const) {
      if (v !== undefined && !(typeof v === 'number' && v > 0)) err(`${name}: ${field} must be a number above 0`);
    }
    if (i.use?.flare !== undefined && !(i.use.flare > 0)) err(`${name}: a flare burns for some seconds above 0`);
    if (i.use?.identify && !i.reveals?.length) err(`${name} can be identified but reveals nothing`);
    if (i.reveals && !i.use?.identify) err(`${name} reveals things but cannot be identified`);
  }
  // Once there is gear at all, everyone starts in some: it must exist.
  if (data.items.some(i => i.kind === 'gear')) for (const g of Object.values(STARTER_GEAR)) {
    const def = data.items.find(i => i.id === g);
    if (!def) err(`the starter gear ${g} is not an item`);
    else if (def.kind !== 'gear') err(`the starter gear ${g} is not gear`);
  }
  const recipeIds = new Set<string>();
  for (const r of data.recipes ?? []) {
    const name = `recipe ${JSON.stringify(r.id)}`;
    if (!/^[a-z][a-z0-9-]*$/.test(r.id ?? '')) err(`${name}: ids are lowercase letters, digits and -`);
    if (recipeIds.has(r.id)) err(`${name} is defined twice`);
    recipeIds.add(r.id);
    if (!ids.has(r.make)) err(`${name} makes ${r.make}, which is not an item`);
    if (r.count !== undefined && !(Number.isInteger(r.count) && r.count >= 1)) err(`${name}: count is a whole number from 1`);
    if (!r.needs?.length) err(`${name} needs nothing`);
    for (const n of r.needs ?? []) {
      if (!ids.has(n.item)) err(`${name} needs ${n.item}, which is not an item`);
      if (!(Number.isInteger(n.count) && n.count >= 1)) err(`${name}: each need is a whole number from 1`);
    }
  }
  for (const i of data.items) for (const r of i.reveals ?? []) {
    if (!ids.has(r.item)) err(`item ${JSON.stringify(i.id)} reveals ${r.item}, which is not an item`);
    if (r.item === i.id) err(`item ${JSON.stringify(i.id)} reveals itself`);
    if (!Number.isInteger(r.count) || r.count < 1 || !(r.weight > 0)) err(`item ${JSON.stringify(i.id)}: a reveal needs a count from 1 and a weight above 0`);
  }
  const byId = new Map(maps.map(m => [m.id, m]));
  const tileKinds = new Set<string>(Object.values(TILE_CHARS));
  data.finds.forEach((f, n) => {
    const name = `find ${n} (${f.item} in ${f.map})`;
    if (!ids.has(f.item)) err(`${name}: there is no item ${f.item}`);
    const mapData = byId.get(f.map);
    if (!mapData) return err(`${name}: there is no map ${f.map}`);
    if (!Number.isInteger(f.count) || f.count < 1) err(`${name}: count must be a whole number from 1`);
    if (!(f.respawn?.length === 2 && f.respawn[0] > 0 && f.respawn[0] <= f.respawn[1])) err(`${name}: respawn is [shortest, longest] seconds, above 0`);
    if (f.steps && !(f.steps.length === 2 && f.steps[0] >= 0 && f.steps[0] <= f.steps[1])) err(`${name}: steps is [nearest, farthest], from 0`);
    for (const k of f.on ?? []) if (!tileKinds.has(k)) err(`${name}: unknown tile kind ${k as TileKind}`);
    if (f.near && !(f.near.radius > 0 && f.near.kinds.length)) err(`${name}: near needs kinds and a radius above 0`);
    if (f.when !== undefined && f.when !== 'unstable' && f.when !== 'aurora' && f.when !== 'storm') err(`${name}: when is unstable, aurora or storm`);
    if (f.when === 'unstable' && !mapData.surge) err(`${name}: grows while the map is restless, but ${f.map} never surges`);
    if (f.when === 'storm' && !mapData.storm) err(`${name}: grows during a storm, but ${f.map} never storms`);
    if (out.some(p => p.level === 'error' && p.message.startsWith(name))) return undefined;
    const room = findTiles(new TileMap(mapData), f).length;
    if (room < f.count) err(`${name}: only ${room} tiles fit the rule, fewer than count ${f.count}`);
    else if (room < f.count * 3) warn(`${name}: only ${room} tiles fit the rule for ${f.count} finds; they have little room to move`);
    return undefined;
  });
  return out;
}
