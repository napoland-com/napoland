/**
 * Content checks for maps. Run on every change (npm run validate) so a broken map never ships.
 * validateMap checks one map on its own; validateWorld checks how the maps fit together.
 */
import { MODS, modChanges, type Mods } from './feats';
import { ELEMENTS, QUIRKS, SLOTS, STARTER_GEAR, TIERS, UPGRADE_MAX, type Element } from './gear';
import { STARTER_TOOLS, TOOL_ICONS, findTiles, type BagSlot, type ItemsData } from './items';
import { DECOR, TILE_CHARS, TileMap, doorOf, objectTiles, type MapData, type NpcLook, type TileKind } from './map';
import { DIRS, stepTarget } from './movement';
import { WEEKDAYS } from './parcels';
import { Dir } from './protocol';
import { FLASH_BURST_S, FLASH_GLOW_S } from './sky';
import { MAX_REMARKS, MILESTONES, STORY_EVENTS, type StoryData } from './story';

export interface Problem {
  level: 'error' | 'warning';
  message: string;
}

/** Ids that content refers to (desks, chapters): lowercase words joined by hyphens. */
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** What a townsperson's look may set (map.ts, NpcLook). */
const NPC_LOOK = ['coat', 'scarf', 'hair', 'skin', 'hat'] as const satisfies ReadonlyArray<keyof NpcLook>;

export function validateMap(data: MapData): Problem[] {
  const out: Problem[] = [];
  const err = (message: string) => out.push({ level: 'error', message });
  const warn = (message: string) => out.push({ level: 'warning', message });
  // The server tells the copies of a map apart by its id and a key after it (world.ts, zoneKey).
  if (!ID.test(data.id ?? '')) err(`its id is lowercase words joined by hyphens, not ${JSON.stringify(data.id)}`);
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
  if (data.style !== undefined && (data.style !== 'napo' || data.kind !== 'inside')) err(`style ${JSON.stringify(data.style)}: only an inside has a style, and it is napo (one of NAPO's rooms)`);
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
      // A cabin is drawn 3 by 2; NAPO's buildings are drawn to their size.
      if (o.style !== undefined && o.style !== 'napo') err(`house at ${o.x},${o.y}: style is napo or left out, not ${JSON.stringify(o.style)}`);
      else if (!o.style && (o.w !== 3 || o.h !== 2)) err(`house at ${o.x},${o.y} is ${o.w} by ${o.h}: a cabin is 3 by 2 (only NAPO's buildings come in other sizes)`);
      else if (o.style === 'napo' && !(o.w >= 3 && o.w <= 9 && o.h >= 2 && o.h <= 5)) err(`house at ${o.x},${o.y} is ${o.w} by ${o.h}: a NAPO building is 3 to 9 wide and 2 to 5 deep`);
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
    if (o.kind === 'sign' && o.style !== undefined && o.style !== 'napo') err(`sign at ${o.x},${o.y}: style is napo or left out, not ${JSON.stringify(o.style)}`);
    if (o.kind === 'console' && (!o.name?.trim() || !o.text?.length || o.text.some(t => !t.trim()))) err(`console at ${o.x},${o.y} needs a name and something to read`);
    if (o.kind === 'console' && !ID.test(o.id ?? '')) err(`console at ${o.x},${o.y}: its id is lowercase words joined by hyphens (the story names it by it)`);
    if (o.kind === 'fireplace' && o.name !== undefined && !o.name.trim()) err(`fireplace at ${o.x},${o.y}: a name says something, or is left out`);
    if (o.kind === 'npc' && !o.lines.length) err(`npc ${o.id} has nothing to say`);
    if (o.kind === 'npc') for (const [k, c] of Object.entries(o.look ?? {})) {
      if (!(NPC_LOOK as readonly string[]).includes(k)) err(`npc ${o.id}: a look has ${NPC_LOOK.join(', ')}, not ${k}`);
      else if (typeof c !== 'string' || !/^#[0-9a-f]{6}$/i.test(c)) err(`npc ${o.id}: ${k} is a color, #rrggbb`);
    }
    if (o.kind === 'sign' || o.kind === 'npc' || o.kind === 'board' || o.kind === 'chest' || o.kind === 'workbench' || o.kind === 'console') {
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
  if (data.skulkers) {
    const s = data.skulkers;
    if (data.kind !== 'wilds') err('skulkers live only in the wilds');
    if (!Number.isInteger(s.count) || s.count < 1) err('skulkers: count must be a whole number from 1');
    if (!(s.steps?.length === 2 && s.steps[0] >= 0 && s.steps[0] <= s.steps[1])) err('skulkers: steps is [nearest, farthest], from 0');
    else {
      let lairs = 0;
      for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
        const d = map.homeSteps(x, y);
        if (map.kind(x, y) === 'ferns' && map.creatureMayStand(x, y) && d >= s.steps[0] && d <= s.steps[1]) lairs++;
      }
      if (!lairs) err('skulkers: no ferns to lie in that far from home, out of the light and away from fires');
    }
    if (!(Array.isArray(s.when) && s.when.length && s.when.every(w => w === 'night' || w === 'storm'))) err('skulkers: when lists night, storm or both');
    else if (s.when.includes('storm') && !data.storm) warn('skulkers: out in a storm, but this region never storms');
  }
  if (data.kind === 'wilds') {
    let lost = 0;
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.walkable(x, y) && map.homeSteps(x, y) < 0) lost++;
    if (lost) warn(`${lost} walkable tiles have no way to a home exit`);
  }
  validateTallGrass(data, map, err, warn);
  const named = new Set<string>();
  for (const p of data.places ?? []) {
    if (!p.name?.trim()) err(`the place at ${p.x},${p.y} needs a name`);
    else if (named.has(p.name)) err(`two places are called ${p.name}`);
    named.add(p.name);
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y) || !map.inside(p.x, p.y)) err(`the place ${p.name} at ${p.x},${p.y} is not on the map`);
  }
  return out;
}

/**
 * Tall grass (hidden) is ground you wade into: never under something that stands there, never raised,
 * never an exit. The tiles in front of a door and of what you read or talk to stay plain ground, so
 * nobody comes out of a shelter or reads a sign crouched in the grass. It only hides you from
 * creatures, and they live in the wilds, out of the light and away from fires: anywhere else it is
 * only grass, which is worth a warning.
 */
function validateTallGrass(data: MapData, map: TileMap, err: (message: string) => void, warn: (message: string) => void): void {
  const fronts = new Map<string, string>();
  for (const o of data.objects) {
    if (o.kind === 'house') { const d = doorOf(o); fronts.set(`${d.x},${d.y + 1}`, `the door of the house at ${o.x},${o.y}`); }
    if (o.kind === 'sign' || o.kind === 'npc' || o.kind === 'board' || o.kind === 'chest' || o.kind === 'workbench' || o.kind === 'console') fronts.set(`${o.x},${o.y + 1}`, `the ${o.kind} at ${o.x},${o.y}`);
  }
  let tiles = 0, lit = 0;
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    if (map.kind(x, y) !== 'tallgrass') continue;
    tiles++;
    if (!map.walkable(x, y)) err(`tall grass at ${x},${y} cannot be walked into: something stands there, or it is raised`);
    else if (map.exitAt(x, y)) err(`tall grass at ${x},${y} is on an exit`);
    const front = fronts.get(`${x},${y}`);
    if (front) err(`tall grass at ${x},${y} is in front of ${front}: that tile stays plain ground`);
    if (map.lit(x, y) || map.warm(x, y)) lit++;
  }
  if (tiles && data.kind !== 'wilds') warn(`${tiles} tiles of tall grass in ${data.kind === 'town' ? 'a town' : 'an inside'}, where no creature comes: it hides nobody from anything`);
  if (lit) warn(`${lit} tiles of tall grass in a street light or by a fire, where creatures never come anyway`);
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
      // Concrete outside, concrete inside: one of NAPO's buildings leads into one of its rooms, a cabin into a cabin's.
      else if (target && (o.style ?? null) !== (target.data.style ?? null)) {
        out.push({ level: 'error', map: map.data.id, message: `house at ${o.x},${o.y}: ${o.style === 'napo' ? 'a NAPO building' : 'a cabin'} leads into ${into!.to}, which is ${target.data.style === 'napo' ? 'one of NAPO\'s rooms' : 'a cabin\'s room'}` });
      }
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
 * because a picked find grows back somewhere else and needs room to move). A recipe or a find whose
 * item is a tool gives that tool (World.giveTool): a tool is owned once and never used up, so such a
 * recipe makes one, and nothing is paid with a tool, mended with one or turns into one.
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
    for (const [field, v] of [['noun', i.noun], ['plural', i.plural], ['about', i.about]] as const) {
      if (v !== undefined && !(typeof v === 'string' && v.trim())) err(`${name}: ${field}, when given, says something`);
    }
    if (!['resource', 'consumable', 'charm', 'gear', 'tool', 'sealed'].includes(i.kind)) err(`${name}: kind must be resource, consumable, charm, gear, tool or sealed`);
    if (i.kind === 'sealed') {
      if (!i.holds?.length) err(`${name}: a sealed thing holds something`);
      if (i.use || i.xp || i.fuel || i.charge || i.reveals) err(`${name}: a sealed thing is only opened, at the chest, and earns no XP`);
    } else if (i.holds || i.seal !== undefined) err(`${name}: only a sealed thing holds something`);
    if (i.seal !== undefined && !(typeof i.seal === 'string' && i.seal.trim())) err(`${name}: seal, when given, says something`);
    if (i.kind === 'tool') {
      if (i.stack !== 1) err(`${name}: a tool stacks one to a slot`);
      if (i.use || i.weight || i.xp || i.fuel || i.charge || i.live) err(`${name}: a tool is never used up, weighs nothing and earns no XP`);
      if (i.chart !== undefined && !maps.some(m => m.id === i.chart)) err(`${name}: charts ${i.chart}, which is not a map`);
      if (!TOOL_ICONS.includes(i.icon!)) err(`${name}: a tool needs an icon for its button in the bag's header (${TOOL_ICONS.join(', ')})`);
    } else {
      if (i.chart !== undefined) err(`${name}: only a tool charts a map`);
      if (i.icon !== undefined) err(`${name}: only a tool has an icon (everything else is drawn by its id)`);
    }
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
    if (i.kind === 'charm' && !MODS.some(k => modChanges(k, i.charm?.[k]))) err(`${name} is a charm that does nothing`);
    if (i.kind !== 'charm' && i.charm) err(`${name}: only charms have a charm`);
    for (const k of Object.keys(i.charm ?? {})) if (!MODS.includes(k as keyof Mods)) err(`${name}: a charm changes ${MODS.slice(0, -1).join(', ')} or ${MODS.at(-1)}, not ${k}`);
    for (const [field, v] of [['weight', i.weight], ['fuel', i.fuel], ['charge', i.charge], ['xp', i.xp]] as const) {
      if (v !== undefined && !(typeof v === 'number' && v > 0)) err(`${name}: ${field} must be a number above 0`);
    }
    if (i.use?.flare !== undefined && !(i.use.flare > 0)) err(`${name}: a flare burns for some seconds above 0`);
    if (i.use?.identify && !i.reveals?.length) err(`${name} can be identified but reveals nothing`);
    if (i.reveals && !i.use?.identify) err(`${name} reveals things but cannot be identified`);
    if (i.live) {
      const into = data.items.find(d => d.id === i.live!.into);
      if (!into) err(`${name}: turns into ${i.live.into}, which is not an item`);
      else if (into.live) err(`${name}: turns into ${into.id}, which is live too`);
      if (!(typeof i.live.xp === 'number' && i.live.xp > (into?.xp ?? 0))) err(`${name}: live, it is worth more XP than what it turns into`);
      if (!(i.live.fresh > 0) || !(i.live.fade > 0)) err(`${name}: live, it stays fresh and fades by numbers above 0`);
      if (i.stack !== 1) err(`${name}: a live item stacks one to a slot`);
    }
  }
  // Once there is gear at all, everyone starts in some: it must exist.
  if (data.items.some(i => i.kind === 'gear')) for (const g of Object.values(STARTER_GEAR)) {
    const def = data.items.find(i => i.id === g);
    if (!def) err(`the starter gear ${g} is not an item`);
    else if (def.kind !== 'gear') err(`the starter gear ${g} is not gear`);
  }
  // Once there are tools at all, whoever never got one of their own carries the starter tools: they must be tools.
  const tools = new Set(data.items.filter(i => i.kind === 'tool').map(i => i.id));
  for (const t of STARTER_TOOLS) {
    const def = data.items.find(i => i.id === t);
    if (def && def.kind !== 'tool') err(`the starter tool ${t} is not a tool`);
    else if (!def && tools.size) err(`the starter tool ${t} is not an item`);
  }
  for (const [tier, s] of Object.entries(data.wear ?? {})) {
    if (!TIERS.includes(tier as never)) err(`wear: ${tier} is not a tier`);
    else if (!(typeof s === 'number' && s > 0)) err(`wear: ${tier} wears out after some seconds above 0`);
  }
  for (const [tier, cost] of Object.entries(data.mend ?? {})) {
    if (!TIERS.includes(tier as never)) err(`mend: ${tier} is not a tier`);
    if (!cost?.length) err(`mend: mending ${tier} gear costs nothing`);
    for (const n of cost ?? []) {
      if (!ids.has(n.item)) err(`mend: ${tier} needs ${n.item}, which is not an item`);
      else if (tools.has(n.item)) err(`mend: ${tier} needs ${n.item}, a tool: tools are never used up`);
      if (!(Number.isInteger(n.count) && n.count >= 1)) err(`mend: each need is a whole number from 1`);
    }
  }
  if (data.upgrades !== undefined && !Array.isArray(data.upgrades)) err('upgrades: a list, what each level costs, +1 first');
  else if ((data.upgrades?.length ?? 0) > UPGRADE_MAX) err(`upgrades: at most ${UPGRADE_MAX} levels`);
  (Array.isArray(data.upgrades) ? data.upgrades : []).forEach((u, i) => {
    const name = `upgrades: +${i + 1}`;
    if (!u?.needs?.length) err(`${name} costs nothing`);
    for (const n of u?.needs ?? []) {
      if (!ids.has(n.item)) err(`${name} needs ${n.item}, which is not an item`);
      else if (tools.has(n.item)) err(`${name} needs ${n.item}, a tool: tools are never used up`);
      if (!(Number.isInteger(n.count) && n.count >= 1)) err(`${name}: each need is a whole number from 1`);
    }
    if (u?.chance !== undefined && !(typeof u.chance === 'number' && u.chance > 0 && u.chance <= 1)) err(`${name}: chance is a share above 0, at most 1`);
  });
  for (const q of data.quirks ?? []) {
    if (!QUIRKS.includes(q.id)) err(`quirk ${q.id}: the game knows ${QUIRKS.join(', ')}`);
    if (!q.name?.trim() || !q.text?.trim()) err(`quirk ${q.id} needs a name and a text`);
  }
  if (data.items.some(i => i.tier === 'anomalous')) for (const q of QUIRKS) if (!data.quirks?.some(d => d.id === q)) err(`quirk ${q} has no name and text`);
  const recipeIds = new Set<string>();
  for (const r of data.recipes ?? []) {
    const name = `recipe ${JSON.stringify(r.id)}`;
    if (!/^[a-z][a-z0-9-]*$/.test(r.id ?? '')) err(`${name}: ids are lowercase letters, digits and -`);
    if (recipeIds.has(r.id)) err(`${name} is defined twice`);
    recipeIds.add(r.id);
    if (!ids.has(r.make)) err(`${name} makes ${r.make}, which is not an item`);
    if (r.count !== undefined && !(Number.isInteger(r.count) && r.count >= 1)) err(`${name}: count is a whole number from 1`);
    // What it makes goes by its kind: a tool to the player's tools (World.giveTool), anything else to the stash.
    else if (tools.has(r.make) && r.count !== undefined && r.count !== 1) err(`${name} makes ${r.make}, a tool, which is yours once: count is 1 or left out`);
    if (!r.needs?.length) err(`${name} needs nothing`);
    for (const n of r.needs ?? []) {
      if (!ids.has(n.item)) err(`${name} needs ${n.item}, which is not an item`);
      else if (tools.has(n.item)) err(`${name} needs ${n.item}, a tool: tools are never used up`);
      if (!(Number.isInteger(n.count) && n.count >= 1)) err(`${name}: each need is a whole number from 1`);
    }
  }
  for (const i of data.items) for (const r of i.reveals ?? []) {
    if (!ids.has(r.item)) err(`item ${JSON.stringify(i.id)} reveals ${r.item}, which is not an item`);
    else if (tools.has(r.item)) err(`item ${JSON.stringify(i.id)} reveals ${r.item}, a tool: tools are made at the workbench or found`);
    if (r.item === i.id) err(`item ${JSON.stringify(i.id)} reveals itself`);
    if (!Number.isInteger(r.count) || r.count < 1 || !(r.weight > 0)) err(`item ${JSON.stringify(i.id)}: a reveal needs a count from 1 and a weight above 0`);
    // Looking closely says what it turned out to be and what that is good for: the `about` line.
    const into = data.items.find(d => d.id === r.item);
    if (into && !into.about?.trim()) warn(`item ${JSON.stringify(r.item)}: ${i.id} may turn out to be it, but it has no about line to say what it is good for`);
  }
  // What goes into the stash from a lockbox or a parcel: things that lie in a stash (not tools), and never another sealed thing inside a sealed one.
  const stashable = (id: string, where: string, sealed = false) => {
    const def = data.items.find(d => d.id === id);
    if (!def) return err(`${where}: ${id} is not an item`);
    if (def.kind === 'tool') err(`${where}: ${id} is a tool, which never lies in a stash`);
    if (sealed && def.kind === 'sealed') err(`${where}: ${id} is sealed too`);
  };
  const slotsOf = (list: unknown, where: string, sealed = false) => {
    if (!Array.isArray(list) || !list.length) return err(`${where}: a list of items and counts, not empty`);
    for (const s of list as BagSlot[]) {
      stashable(s?.item, where, sealed);
      if (!(Number.isInteger(s?.count) && s.count >= 1)) err(`${where}: each count is a whole number from 1`);
    }
  };
  for (const i of data.items) i.holds?.forEach((h, n) => {
    const where = `item ${JSON.stringify(i.id)}: holding ${n + 1}`;
    if (!(typeof h.weight === 'number' && h.weight > 0)) err(`${where}: its weight is above 0`);
    if ((h.items === undefined) === (h.any === undefined)) return err(`${where}: it is some items, or any one of a kind`);
    if (h.items !== undefined) {
      slotsOf(h.items, where, true);
      // Opening one says what was inside and, when it is one thing, what that is good for.
      const one = h.items.length === 1 ? data.items.find(d => d.id === h.items![0]!.item) : undefined;
      if (one && !one.about?.trim()) warn(`item ${JSON.stringify(one.id)}: ${i.id} may hold it, but it has no about line to say what it is good for`);
    } else if (!(['resource', 'consumable', 'charm'] as const).includes(h.any as never)) err(`${where}: any is resource, consumable or charm`);
    else if (!data.items.some(d => d.kind === h.any)) err(`${where}: any ${h.any}, but there is none`);
  });
  const p = data.parcels;
  if (p) {
    slotsOf(p.welcome, 'parcels: the welcome parcel');
    if (!Array.isArray(p.week) || p.week.length !== WEEKDAYS.length) err(`parcels: week is a parcel for each of the ${WEEKDAYS.length} days, Monday first`);
    else p.week.forEach((day, n) => slotsOf(day, `parcels: ${WEEKDAYS[n]}'s parcel`));
    if (p.allWeek !== undefined) slotsOf(p.allWeek, 'parcels: allWeek');
  }
  const byId = new Map(maps.map(m => [m.id, m]));
  const conditionIds = validateConditions(data, byId, err);
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
    if (f.condition !== undefined) {
      if (!conditionIds.has(f.condition)) err(`${name}: grows while ${f.condition} is on, which is not a condition`);
      if (f.when !== undefined) err(`${name}: grows with a condition or at a time (when), not both`);
    }
    if (f.around) {
      const { x, y, r } = f.around;
      const room = new TileMap(mapData);
      if (!(r > 0) || !room.inside(x, y)) err(`${name}: around is a tile on the map and a radius above 0`);
      else if (!findTiles(room, { item: f.item, map: f.map, count: 1, respawn: [1, 1], around: f.around }).length) err(`${name}: around ${x},${y} has no walkable tile within ${r}`);
    }
    if (out.some(p => p.level === 'error' && p.message.startsWith(name))) return undefined;
    const room = findTiles(new TileMap(mapData), f).length;
    if (room < f.count) err(`${name}: only ${room} tiles fit the rule, fewer than count ${f.count}`);
    else if (room < f.count * 3) warn(`${name}: only ${room} tiles fit the rule for ${f.count} finds; they have little room to move`);
    return undefined;
  });
  return out;
}

/**
 * content/story.json: chapters with ids, titles and texts, in order. The first is where everyone
 * starts, so nothing reaches it; each other is reached by one thing a player does, about maps, items,
 * people and desks that exist. Hints come only from people who exist. People and desks the story can
 * name must each have an id of their own.
 */
export function validateStory(story: StoryData, maps: MapData[], items?: ItemsData): Problem[] {
  const out: Problem[] = [];
  const err = (message: string) => out.push({ level: 'error', message });
  if (!Number.isInteger(story.version) || story.version < 1) err('version must be a whole number from 1');
  if (!Array.isArray(story.chapters) || !story.chapters.length) {
    err('there are no chapters');
    return out;
  }
  const people = new Map<string, number>(), desks = new Map<string, number>();
  for (const m of maps) for (const o of m.objects) {
    if (o.kind === 'npc') people.set(o.id, (people.get(o.id) ?? 0) + 1);
    if (o.kind === 'console') desks.set(o.id, (desks.get(o.id) ?? 0) + 1);
  }
  for (const [id, n] of people) if (n > 1) err(`${n} people have the id ${id}: the story could not tell them apart`);
  for (const [id, n] of desks) if (n > 1) err(`${n} desks have the id ${id}: the story could not tell them apart`);
  const mapIds = new Set(maps.map(m => m.id)), itemIds = new Set((items?.items ?? []).map(i => i.id)), ids = new Set<string>();
  story.chapters.forEach((c, i) => {
    const name = `chapter ${i + 1} (${JSON.stringify(c.id)})`;
    if (!ID.test(c.id ?? '')) err(`${name}: an id is lowercase words joined by hyphens`);
    if (ids.has(c.id)) err(`${name} is there twice`);
    ids.add(c.id);
    if (!c.title?.trim() || !c.text?.trim()) err(`${name} needs a title and a text`);
    if (i === 0) {
      if (c.when) err(`${name}: the first chapter is where everyone starts, so nothing reaches it`);
    } else {
      const kinds = Object.keys(c.when ?? {}), kind = kinds[0], value = kind && (c.when as Record<string, unknown>)[kind];
      if (kinds.length !== 1 || !(STORY_EVENTS as readonly string[]).includes(kind!)) err(`${name}: when is one of ${STORY_EVENTS.join(', ')}`);
      else if (kind === 'store' && value !== true) err(`${name}: when store is true`);
      else if (kind === 'feed' && value !== 'fire' && value !== 'stone') err(`${name}: when feed is fire or stone`);
      else if (kind === 'reach' && !mapIds.has(value as string)) err(`${name}: there is no map ${String(value)}`);
      else if (kind === 'pick' && !itemIds.has(value as string)) err(`${name}: there is no item ${String(value)}`);
      else if (kind === 'talk' && !people.has(value as string)) err(`${name}: nobody has the id ${String(value)}`);
      else if (kind === 'read' && !desks.has(value as string)) err(`${name}: no desk has the id ${String(value)}`);
    }
    for (const [who, line] of Object.entries(c.hints ?? {})) {
      if (!people.has(who)) err(`${name}: a hint from ${who}, but nobody has that id`);
      else if (typeof line !== 'string' || !line.trim()) err(`${name}: ${who}'s hint says nothing`);
    }
  });
  // What people say once after something done for the first time: which were said is kept a bit each, in this order.
  const remarkIds = new Set<string>(), remarks = story.remarks ?? [];
  if (!Array.isArray(remarks)) err('remarks is a list');
  else remarks.forEach((r, i) => {
    const name = `remark ${i + 1} (${JSON.stringify(r?.id)})`;
    if (!ID.test(r?.id ?? '')) err(`${name}: an id is lowercase words joined by hyphens`);
    if (remarkIds.has(r.id)) err(`${name} is there twice`);
    remarkIds.add(r.id);
    if (!people.has(r.who)) err(`${name}: nobody has the id ${String(r.who)}`);
    if (!MILESTONES.includes(r.after)) err(`${name}: after is one of ${MILESTONES.join(', ')}`);
    if (typeof r.line !== 'string' || !r.line.trim()) err(`${name} says nothing`);
  });
  if (Array.isArray(remarks) && remarks.length > MAX_REMARKS) err(`there are ${remarks.length} remarks, and which were said is kept for at most ${MAX_REMARKS}`);
  return out;
}

/** The conditions (sky.ts): well formed, each on a map where what it does can happen. Returns every condition id. */
function validateConditions(data: ItemsData, byId: Map<string, MapData>, err: (message: string) => void): Set<string> {
  const ids = new Set<string>();
  const c = data.conditions;
  if (!c) return ids;
  if (!Number.isInteger(c.seed)) err('conditions: seed is a whole number');
  if (!(c.second >= 0 && c.second <= 1)) err('conditions: second is a chance from 0 to 1');
  if (!c.daily?.length) err('conditions: there are no daily conditions');
  for (const [list, daily] of [[c.daily ?? [], true], [c.weekly ?? [], false]] as const) for (const d of list) {
    const name = `condition ${JSON.stringify(d.id)}`;
    if (!/^[a-z][a-z0-9-]*$/.test(d.id ?? '')) err(`${name}: ids are lowercase letters, digits and -`);
    if (ids.has(d.id)) err(`${name} is defined twice`);
    ids.add(d.id);
    if (!d.name?.trim() || !d.text?.trim()) err(`${name} needs a name and a text`);
    if (daily && !(typeof d.weight === 'number' && d.weight > 0)) err(`${name}: weight must be a number above 0`);
    const mapData = byId.get(d.map);
    if (!mapData) {
      err(`${name}: there is no map ${d.map}`);
      continue;
    }
    if (d.fog !== undefined && !(d.fog >= 3 && d.fog <= 12)) err(`${name}: fog is from 3 to 12 tiles`);
    if (d.watchers) {
      const steps = d.watchers.steps;
      if (!mapData.watchers || mapData.kind !== 'wilds') err(`${name}: moves the watchers, but ${d.map} has none`);
      else if (!d.watchers.asleep && !steps) err(`${name}: watchers need steps or asleep`);
      else if (steps && !(steps.length === 2 && steps[0] >= 0 && steps[0] <= steps[1])) err(`${name}: watcher steps is [nearest, farthest], from 0`);
      else if (steps && !new TileMap(mapData).lairs(steps).length) err(`${name}: leaves the watchers nowhere to wake`);
    }
    if (d.fireOut) {
      const inside = mapData.exits.map(e => byId.get(e.to)).filter(m => m?.kind === 'inside');
      const untended = [mapData, ...inside].some(m => m!.objects.some(o => o.kind === 'fireplace' && o.tended !== true));
      if (mapData.kind !== 'wilds' || !untended) err(`${name}: puts a fire out, but ${d.map} has no fire that burns down`);
    }
  }
  return ids;
}
