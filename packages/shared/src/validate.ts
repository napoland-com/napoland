/**
 * Content checks for maps. Run on every change (npm run validate) so a broken map never ships.
 * validateMap checks one map on its own; validateWorld checks how the maps fit together.
 */
import { COMFORTS, type Comfort } from './comfort';
import { MODS, modChanges, type Mods } from './feats';
import { ELEMENTS, QUIRKS, SLOTS, STARTER_GEAR, TIERS, UPGRADE_MAX, type Element } from './gear';
import { STARTER_TOOLS, TOOL_ICONS, findTiles, type BagSlot, type ItemsData } from './items';
import { BUNDLE } from './lostfound';
import {
  CREATURE_STEP_MIN_MS, FRONTED, GATE_PULLERS, NOTE_AUTHORS, NOTE_ON, NOTE_WHEN, PAPER_LOOKS, TILE_CHARS, TILE_NEEDS, TileMap, doorOf, footprint, gateArrival, hangs, objectTiles,
  teleportArrival, underfoot, watcherStepMs,
  type MapData, type MapObject, type NpcLook, type TileKind,
} from './map';
import { DIRS, stepTarget } from './movement';
import { ANYWHERE, DURING, SIGHTS, opensOn, readableAt, type NotebookData, type NotebookEvent } from './notebook';
import { WEEKDAYS } from './parcels';
import { Dir } from './protocol';
import { FLASH_BURST_S, FLASH_GLOW_S, NIGHT_FROM, SEASON_ORDER, stormAt, surgeAt, type Season } from './sky';
import { MAX_REMARKS, MILESTONES, STORY_EVENTS, type StoryData } from './story';

export interface Problem {
  level: 'error' | 'warning';
  message: string;
}

/** Ids that content refers to (desks, chapters): lowercase words joined by hyphens. */
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** What a townsperson's look may set (map.ts, NpcLook). */
const NPC_LOOK = ['coat', 'scarf', 'hair', 'skin', 'hat'] as const satisfies ReadonlyArray<keyof NpcLook>;
/** The styles a building and a sign come in besides the plain one (map.ts, MapObject). */
const HOUSE_STYLES = ['napo', 'mill', 'shed'] as const;
const SIGN_STYLES = ['napo', 'cardboard', 'mailbox'] as const;
/** How long each vehicle is, in tiles, from the shortest to the longest: always one tile across. */
const VEHICLE_LENGTH = { car: [2, 2], jeep: [2, 2], truck: [2, 4] } as const;
const COLOR = /^#[0-9a-f]{6}$/i;
/** What a style of building is called, and a room of that style. */
const BUILDING = { napo: 'a NAPO building', mill: 'the mill', shed: 'a shed', none: 'a cabin' } as const;
const ROOM = { napo: 'one of NAPO\'s rooms', mill: 'the mill\'s floor', shed: 'a shed\'s floor', none: 'a cabin\'s room' } as const;
/** Why a sealed thing may not be where content puts it (validateItems): it comes only in a parcel, and stays in the stash until opened. */
const NO_BAG = 'those never go in a bag';
const OPENED = 'those are only ever opened';
/** Why furniture may not be where content puts it: it is made for its place in the cabin and set there at once (comfort.ts). */
const PLACED = 'furniture stands in its place in the cabin, never in a bag or a stash';
/** Why a bundle may not be where content puts it: only someone's pile, carried to the lodge, makes one (lostfound.ts). */
const PACKED = 'only a pile carried to the lodge makes one';

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
  if (data.style !== undefined && (!(HOUSE_STYLES as readonly string[]).includes(data.style) || data.kind !== 'inside')) err(`style ${JSON.stringify(data.style)}: only an inside has a style, and it is napo (one of NAPO's rooms), mill (the sawmill's floor) or shed (a shed's floor)`);
  if (data.street !== undefined && (data.street !== true || data.kind !== 'town')) err('street: only a town is a street of cabins, and then it is true');
  if (out.some(p => p.level === 'error')) return out;

  const map = new TileMap(data);
  const exitTiles = new Set<string>();
  data.exits.forEach((e, i) => {
    const name = `exit ${i} (to ${e.to})`;
    if (!e.to) err(`exit ${i} has no target map`);
    if (!Dir.safeParse(e.dir).success) err(`${name}: dir must be up, down, left or right`);
    if (!(e.w >= 1 && e.h >= 1)) err(`${name}: w and h must be 1 or more`);
    if (e.lock !== undefined && !(typeof e.lock === 'string' && /^[a-z][a-z0-9-]*$/.test(e.lock))) err(`${name}: a lock names the tool that opens it, by its item id`);
    if (e.lock !== undefined && e.home) err(`${name}: the way home is never locked`);
    for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) {
      // A padlocked door is walked by whoever carries what opens it.
      if (!map.passable(x, y)) err(`${name}: tile ${x},${y} is not walkable, so nobody can use the exit there`);
      else if (map.needs(x, y) !== undefined && map.needs(x, y) !== e.lock) err(`${name}: tile ${x},${y} opens only with ${map.needs(x, y)}: an exit is on open ground, or locked`);
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
      // A cabin is drawn 3 by 2; NAPO's buildings and the mill are drawn to their size.
      if (o.style !== undefined && !(HOUSE_STYLES as readonly string[]).includes(o.style)) err(`house at ${o.x},${o.y}: style is napo, mill, shed or left out, not ${JSON.stringify(o.style)}`);
      else if (!o.style && (o.w !== 3 || o.h !== 2)) err(`house at ${o.x},${o.y} is ${o.w} by ${o.h}: a cabin is 3 by 2 (only NAPO's buildings, the mill and a shed come in other sizes)`);
      else if (o.style === 'napo' && !(o.w >= 3 && o.w <= 9 && o.h >= 2 && o.h <= 5)) err(`house at ${o.x},${o.y} is ${o.w} by ${o.h}: a NAPO building is 3 to 9 wide and 2 to 5 deep`);
      else if (o.style === 'mill' && !(o.w >= 5 && o.w <= 9 && o.h >= 2 && o.h <= 4)) err(`house at ${o.x},${o.y} is ${o.w} by ${o.h}: the mill is long and low, 5 to 9 wide and 2 to 4 deep`);
      else if (o.style === 'shed' && (o.w !== 2 || o.h !== 2)) err(`house at ${o.x},${o.y} is ${o.w} by ${o.h}: a shed is 2 by 2`);
      // Curtains are what the people who left drew behind them: never in a lit house, a mill or NAPO's.
      if (o.curtains && (o.style || o.lit)) err(`house at ${o.x},${o.y}: curtains are drawn only in a cabin nobody lives in (no style, not lit)`);
      // On a street every cabin is a lot, with its owner's name by the door; its window lights while they are home.
      if (data.street && (!o.plate || o.style || o.curtains || o.lit)) err(`house at ${o.x},${o.y}: on a street every house is a plain cabin with a name plate (plate), unlit and without curtains`);
      if (!data.street && o.plate !== undefined) err(`house at ${o.x},${o.y}: only a cabin on a street has a name plate`);
    }
    if (o.kind === 'car' || o.kind === 'truck' || o.kind === 'jeep') validateVehicle(o, map, err);
    if ((o.kind === 'logs' || o.kind === 'carriage') && !footprint(o).every(n => Number.isInteger(n) && n >= 1 && n <= (o.kind === 'logs' ? 4 : 9))) {
      err(`${o.kind} at ${o.x},${o.y} is ${footprint(o).join(' by ')}: ${o.kind === 'logs' ? 'a log deck is 1 to 4 tiles each way' : 'a carriage runs 1 to 9 tiles'}`);
    }
    if (o.kind === 'ruin' && !(Number.isInteger(o.w) && Number.isInteger(o.h) && o.w >= 2 && o.w <= 6 && o.h >= 2 && o.h <= 4)) {
      err(`ruin at ${o.x},${o.y} is ${o.w} by ${o.h}: what is left of a bunkhouse is 2 to 6 wide and 2 to 4 deep`);
    }
    if (o.kind === 'bridge') {
      // Laid on the ford it crosses: you walk on the ground under it, and the creek runs by on either side of it.
      const across: Array<[number, number]> = o.dir === 'v' ? [[o.x - 1, o.y], [o.x + 1, o.y]] : [[o.x, o.y - 1], [o.x, o.y + 1]];
      if (o.dir !== 'h' && o.dir !== 'v') err(`bridge at ${o.x},${o.y}: dir is h (it runs east to west) or v (north to south)`);
      else if (!map.walkable(o.x, o.y) || !across.some(([x, y]) => map.kind(x, y) === 'water')) err(`bridge at ${o.x},${o.y}: it lies on a ford you can walk, with the water beside it`);
    }
    if ((o.kind === 'rock' && o.hum !== undefined && typeof o.hum !== 'boolean') || (o.kind === 'antenna' && o.broken !== undefined && typeof o.broken !== 'boolean')) {
      err(`${o.kind} at ${o.x},${o.y}: ${o.kind === 'rock' ? 'hum' : 'broken'} is true, false or left out`);
    }
    if (o.kind === 'paper') {
      if (!o.name?.trim() || !o.text?.length || o.text.some(t => !t.trim())) err(`paper at ${o.x},${o.y} needs a name and something to read`);
      if (!(PAPER_LOOKS as readonly string[]).includes(o.look)) err(`paper at ${o.x},${o.y}: looks like ${PAPER_LOOKS.join(', ')}, not ${JSON.stringify(o.look)}`);
      // A calendar or a drawing hangs on a wall; a note or a list lies on a table on the floor.
      else if (hangs(o.look) !== (map.kind(o.x, o.y) === 'wall')) err(`paper at ${o.x},${o.y}: a ${o.look} ${hangs(o.look) ? 'hangs on a wall tile' : 'lies on a table, on the floor'}`);
    }
    if ((o.kind === 'cage' || o.kind === 'jeep') && (!o.text?.length || o.text.some(t => !t.trim()))) err(`${o.kind} at ${o.x},${o.y} has nothing to read`);
    if (o.kind === 'gate') {
      // Pulled from below, one puller a tile: as wide as the pullers it takes, each with ground to stand on.
      if (!o.text?.length || o.text.some(t => !t.trim())) err(`gate at ${o.x},${o.y} has nothing to read`);
      if (data.kind !== 'wilds') err(`gate at ${o.x},${o.y}: NAPO's gates stand out in the wilds`);
      if (!(Number.isInteger(o.w) && o.w >= GATE_PULLERS && o.w <= 4)) err(`gate at ${o.x},${o.y} is ${o.w} wide: ${GATE_PULLERS} to 4, one tile for each who pulls`);
      else if (objectTiles(o).some(([x, y]) => !map.walkable(x, y + 1))) err(`gate at ${o.x},${o.y}: every tile below it is walkable ground, where people pull from`);
      if (!Dir.safeParse(o.dir).success) err(`gate at ${o.x},${o.y}: dir must be up, down, left or right`);
    }
    for (const [x, y] of objectTiles(o)) {
      if (!map.inside(x, y)) err(`${o.kind} at ${o.x},${o.y} reaches outside the map`);
      if (underfoot(o)) continue;
      const key = `${x},${y}`;
      const other = used.get(key);
      if (other) err(`${o.kind} at ${o.x},${o.y} overlaps ${other} on tile ${key}`);
      used.set(key, `${o.kind} at ${o.x},${o.y}`);
    }
    if (o.kind === 'sign' && (!o.text.length || o.text.some(t => !t.trim()))) err(`sign at ${o.x},${o.y} has no text`);
    if (o.kind === 'sign' && o.style !== undefined && !(SIGN_STYLES as readonly string[]).includes(o.style)) err(`sign at ${o.x},${o.y}: style is ${SIGN_STYLES.join(', ')} or left out, not ${JSON.stringify(o.style)}`);
    if (o.kind === 'console' && (!o.name?.trim() || !o.text?.length || o.text.some(t => !t.trim()))) err(`console at ${o.x},${o.y} needs a name and something to read`);
    if (o.kind === 'console' && !ID.test(o.id ?? '')) err(`console at ${o.x},${o.y}: its id is lowercase words joined by hyphens (the story names it by it)`);
    if (o.kind === 'fireplace' && o.name !== undefined && !o.name.trim()) err(`fireplace at ${o.x},${o.y}: a name says something, or is left out`);
    if (o.kind === 'fireplace' && o.longNight !== undefined && (o.longNight !== true || o.tended === true || data.kind !== 'inside')) {
      err(`fireplace at ${o.x},${o.y}: longNight is true or left out, on a fire in a room in town that nobody marked tended`);
    }
    if (o.kind === 'cache' && !o.name?.trim()) err(`cache at ${o.x},${o.y} needs a name: what a letter calls it ("the old cabin's crate")`);
    if (o.kind === 'slab') {
      // It glows and opens while the region is restless: only a region that surges has such times.
      if (data.kind !== 'wilds' || !data.surge) err(`slab at ${o.x},${o.y}: it opens while the woods are restless, so it lies in wilds that surge`);
      if (!o.name?.trim()) err(`slab at ${o.x},${o.y} needs a name: what the notice board calls it ("the slab in the ring of stones")`);
      if (!Array.isArray(o.holds) || !o.holds.length || o.holds.some(s => !(typeof s?.item === 'string' && Number.isInteger(s.count) && s.count >= 1))) err(`slab at ${o.x},${o.y} holds nothing: a list of items and counts`);
      if (!map.walkable(o.x, o.y)) err(`slab at ${o.x},${o.y}: it lies in the ground, where people walk`);
    }
    if (o.kind === 'teleport') {
      // One in every cabin, and its twin in the home town (validateWorld): nowhere else, and one a map.
      if (data.private !== true && (data.kind !== 'town' || data.street)) err(`teleport at ${o.x},${o.y}: NAPO's teleports stand in a home of one's own and in the home town`);
      else if (data.objects.filter(p => p.kind === 'teleport').length > 1) err(`teleport at ${o.x},${o.y}: a map has one teleport`);
      const at = teleportArrival(o);
      if (map.exitAt(at.x, at.y)) err(`teleport at ${o.x},${o.y}: it sets you down on the tile in front of it (${at.x},${at.y}), which is an exit`);
    }
    if (o.kind === 'comfort') {
      // Each player's cabin is theirs alone: only there does furniture wait to be made again (comfort.ts).
      if (!(COMFORTS as readonly string[]).includes(o.what)) err(`comfort at ${o.x},${o.y}: it is a place for ${COMFORTS.join(', ')}, not ${JSON.stringify(o.what)}`);
      else if (data.private !== true) err(`comfort at ${o.x},${o.y}: a place for furniture is only in a home of one's own (private)`);
      else if (data.objects.filter(p => p.kind === 'comfort' && p.what === o.what).length > 1) err(`comfort at ${o.x},${o.y}: a home has one place for its ${o.what}`);
    }
    if (o.kind === 'npc' && !o.lines.length) err(`npc ${o.id} has nothing to say`);
    if (o.kind === 'npc') for (const [k, c] of Object.entries(o.look ?? {})) {
      if (!(NPC_LOOK as readonly string[]).includes(k)) err(`npc ${o.id}: a look has ${NPC_LOOK.join(', ')}, not ${k}`);
      else if (typeof c !== 'string' || !/^#[0-9a-f]{6}$/i.test(c)) err(`npc ${o.id}: ${k} is a color, #rrggbb`);
    }
    if (FRONTED.has(o.kind)) {
      const front = stepTarget(o.x, o.y, 'down');
      if (!map.walkable(front.x, front.y)) err(`${o.kind} at ${o.x},${o.y}: the tile in front (below) is not walkable, so nobody can talk to it`);
    }
    if (o.kind === 'note') validateNote(o, data, map, err);
  }
  const noteTiles = new Set<string>();
  for (const o of data.objects) {
    if (o.kind !== 'note') continue;
    if (noteTiles.has(`${o.x},${o.y}`)) err(`two notes lie on ${o.x},${o.y}: facing it, only one could be read`);
    noteTiles.add(`${o.x},${o.y}`);
  }
  const s = data.spawn;
  if (!map.walkable(s.x, s.y)) err(`spawn ${s.x},${s.y} is not walkable`);
  // A home of one's own: only a room with the chest, where each player's stash is, is private.
  if (data.private !== undefined && (data.private !== true || data.kind !== 'inside' || !data.objects.some(o => o.kind === 'chest'))) {
    err('private: only a room with a chest (a home) is private, and then it is true');
  }
  if (data.wake !== undefined) {
    const w = data.wake;
    if (data.private !== true) err('wake: only a private room (a home) has a place to wake up in');
    if (!Dir.safeParse(w.dir).success) err('wake: dir must be up, down, left or right');
    if (!map.walkable(w.x, w.y) || map.exitAt(w.x, w.y)) err(`wake ${w.x},${w.y} is not a walkable tile of the room (an exit is none either)`);
    else if (!map.warm(w.x, w.y)) err(`wake ${w.x},${w.y} is not by the fire: you wake up where it warms you`);
  }

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
  if (data.rain !== undefined) validateRain(data, err);
  if (data.ice !== undefined) validateIce(data, map, err, warn);
  // Storms come between surges in every season, the autumn's twice-as-many too (stormAt).
  if (data.surge && data.storm && !out.some(p => p.level === 'error' && /^(surge|storm):/.test(p.message))) {
    const clash = stormsClash(data);
    if (clash) err(`storm: in ${clash.season} a storm (or its warning) blows while the region is restless or surging, ${clash.at} seconds into the round: move it (offset) to between the surges`);
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
    // Quicker on an aurora night, and even then slower than you: you get away by walking.
    if (w.stepMs !== undefined && !(Number.isInteger(w.stepMs) && watcherStepMs(w, true) >= CREATURE_STEP_MIN_MS)) {
      err(`watchers: stepMs is whole ms, slow enough that on an aurora night they still step no quicker than every ${CREATURE_STEP_MIN_MS} ms`);
    }
  }
  if (data.skulkers) {
    const s = data.skulkers;
    if (data.kind !== 'wilds') err('skulkers live only in the wilds');
    if (!Number.isInteger(s.count) || s.count < 1) err('skulkers: count must be a whole number from 1');
    if (s.stepMs !== undefined && !(Number.isInteger(s.stepMs) && s.stepMs >= CREATURE_STEP_MIN_MS)) err(`skulkers: stepMs is whole ms, at least ${CREATURE_STEP_MIN_MS}: walking away gets you out`);
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
  if (data.forest !== undefined && (!['old', 'burnt'].includes(data.forest) || data.kind !== 'wilds')) err(`forest ${JSON.stringify(data.forest)}: only the wilds say how their forest grows, and it is old, burnt or left out`);
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
 * A region's rain (sky.ts): windows of whole seconds counted from dawn, each over by nightfall (the
 * night is dry everywhere), none overlapping another (one long window says it plainly). Only outdoors:
 * a room hears the rain of the map its door opens onto.
 */
function validateRain(data: MapData, err: (message: string) => void): void {
  const rain = data.rain;
  if (!Array.isArray(rain)) return void err('rain: a list of windows, each {from, length} in seconds after dawn (an empty list: it never rains)');
  if (data.kind === 'inside') err('rain: a room hears the rain of the map its door opens onto, so it has none of its own');
  if (!rain.every(w => Number.isInteger(w?.from) && w.from >= 0 && Number.isInteger(w?.length) && w.length > 0)) {
    return void err('rain: each window starts some whole seconds after dawn, from 0, and lasts whole seconds above 0');
  }
  for (const w of rain) if (w.from + w.length > NIGHT_FROM) err(`rain: the window from ${w.from} runs past nightfall (${NIGHT_FROM} seconds after dawn), and the night is dry`);
  const sorted = [...rain].sort((a, b) => a.from - b.from);
  for (let i = 1; i < sorted.length; i++) if (sorted[i]!.from < sorted[i - 1]!.from + sorted[i - 1]!.length) err(`rain: the windows from ${sorted[i - 1]!.from} and ${sorted[i]!.from} overlap: make them one`);
}

/**
 * The water that freezes in winter (`ice`): each by a name people say ("the pond") and its tiles, which
 * are water on the map, each once; only outdoors. Ice nobody can step onto from the shore would be ice
 * nobody crosses, which is worth a warning.
 */
function validateIce(data: MapData, map: TileMap, err: (message: string) => void, warn: (message: string) => void): void {
  const ice = data.ice;
  if (!Array.isArray(ice)) return void err('ice: a list of the water that freezes in winter, each {name, tiles}');
  if (data.kind === 'inside') err('ice: only water outdoors freezes');
  const seen = new Set<string>();
  for (const water of ice) {
    const name = typeof water?.name === 'string' && water.name.trim() ? water.name : '';
    if (!name) err('ice: each frozen water has a name people say, like "the pond"');
    if (!Array.isArray(water?.tiles) || !water.tiles.length) { err(`ice: ${name || 'a frozen water'} has no tiles`); continue; }
    let shore = false;
    for (const t of water.tiles) {
      const [x, y] = Array.isArray(t) ? t : [NaN, NaN];
      if (!Number.isInteger(x) || !Number.isInteger(y) || !map.inside(x!, y!)) { err(`ice: ${JSON.stringify(t)} is not a tile of the map`); continue; }
      if (map.kind(x!, y!) !== 'water') err(`ice: ${x},${y} is not water`);
      if (seen.has(`${x},${y}`)) err(`ice: ${x},${y} is listed twice`);
      seen.add(`${x},${y}`);
      if (DIRS.some(d => { const n = stepTarget(x!, y!, d); return map.walkable(n.x, n.y); })) shore = true;
    }
    if (!shore) warn(`ice: ${name || 'a frozen water'} has no shore to step onto it from, so nobody can cross it`);
  }
}

/**
 * The first moment, if any, in some season, when a storm or its warning blows over a region while it is
 * restless or surging: over whole rounds of both clocks (a day at most), a second at a time.
 */
function stormsClash(data: MapData): { season: Season; at: number } | undefined {
  const surge = data.surge!, storm = data.storm!;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const round = Math.min(86_400, (surge.every / gcd(surge.every, storm.every)) * storm.every);
  for (const season of SEASON_ORDER) {
    for (let t = 0; t < round; t++) {
      if (stormAt(storm, t * 1000, season).phase !== 'clear' && surgeAt(surge, t * 1000).phase !== 'calm') return { season, at: t };
    }
  }
  return undefined;
}

/**
 * A car, a truck or a jeep: one tile across and as long as its kind is, its nose pointing along it,
 * in a real color. A jeep is read from beside it, so somebody must be able to stand there.
 */
function validateVehicle(o: Extract<MapObject, { kind: 'car' | 'truck' | 'jeep' }>, map: TileMap, err: (message: string) => void): void {
  const [w, h] = footprint(o), [shortest, longest] = VEHICLE_LENGTH[o.kind], long = Math.max(w, h);
  const where = `${o.kind} at ${o.x},${o.y}`;
  if (!(Number.isInteger(w) && Number.isInteger(h) && Math.min(w, h) === 1 && long >= shortest && long <= longest)) {
    err(`${where} is ${w} by ${h}: ${shortest === longest ? `a ${o.kind} is ${long} by 1 or 1 by ${long}` : `a ${o.kind} is one tile across and ${shortest} to ${longest} long`}`);
    return;
  }
  const dir = o.dir ?? 'right', across = w > h ? ['left', 'right'] : ['up', 'down'];
  if (!across.includes(dir)) err(`${where}: its nose points along it, ${across.join(' or ')}, not ${JSON.stringify(dir)}`);
  if (o.kind === 'car' && o.paint !== undefined && !COLOR.test(o.paint)) err(`${where}: paint is a color, #rrggbb`);
  if (o.kind === 'truck' && o.style !== undefined && o.style !== 'napo') err(`${where}: style is napo or left out, not ${JSON.stringify(o.style)}`);
  if (o.kind === 'jeep' && !objectTiles(o).some(([x, y]) => DIRS.some(d => { const n = stepTarget(x, y, d); return map.walkable(n.x, n.y); }))) {
    err(`${where}: nobody can stand beside it to read it`);
  }
}

/** A note says something in a few lines the text box shows one at a time. */
export const NOTE_LINE_MAX = 140;

/**
 * A note someone left (notes.ts): named for good, by someone who left notes, saying something; it lies
 * on something it can lie on (a table, a pole, a car...), and somebody can stand beside that to read it.
 * Wax only shows on paper the rain reaches: a rain note lies out of doors. `faint` says what shows at
 * the wrong time, so only a note with a time has it.
 */
function validateNote(o: Extract<MapObject, { kind: 'note' }>, data: MapData, map: TileMap, err: (message: string) => void): void {
  const where = `note ${JSON.stringify(o.id)} at ${o.x},${o.y}`;
  if (!ID.test(o.id ?? '')) err(`${where}: its id is lowercase words joined by hyphens (what players read is kept by it)`);
  if (!(NOTE_AUTHORS as readonly string[]).includes(o.by)) err(`${where}: by is ${NOTE_AUTHORS.join(', ')}, not ${JSON.stringify(o.by)}`);
  if (!o.name?.trim()) err(`${where} needs a name: what the text box calls it`);
  if (!Array.isArray(o.text) || !o.text.length || o.text.some(t => typeof t !== 'string' || !t.trim())) err(`${where} has nothing to read`);
  else for (const t of o.text) if (t.length > NOTE_LINE_MAX) err(`${where}: a line is ${t.length} characters, ${NOTE_LINE_MAX} at most`);
  if (o.when !== undefined && !(NOTE_WHEN as readonly string[]).includes(o.when)) err(`${where}: when is ${NOTE_WHEN.join(', ')} or left out, not ${JSON.stringify(o.when)}`);
  if (o.faint !== undefined && (o.when === undefined || typeof o.faint !== 'string' || !o.faint.trim())) err(`${where}: faint says what shows at the wrong time, so only a note with a when has it`);
  if (o.when === 'rain' && data.kind === 'inside') err(`${where}: only rain shows it, and no rain falls inside`);
  const under = data.objects.find(u => (NOTE_ON as readonly string[]).includes(u.kind) && objectTiles(u).some(([x, y]) => x === o.x && y === o.y));
  if (!under) err(`${where} lies on nothing: it lies on a ${NOTE_ON.join(', a ')}`);
  if (!DIRS.some(d => { const n = stepTarget(o.x, o.y, d); return map.walkable(n.x, n.y); })) err(`${where}: nobody can stand beside it to read it`);
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
    if (FRONTED.has(o.kind)) fronts.set(`${o.x},${o.y + 1}`, `the ${o.kind} at ${o.x},${o.y}`);
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

/** Is every tile of this exit on the map's edge (a road out, rather than a door)? */
function onEdge(map: TileMap, e: MapData['exits'][number]): boolean {
  return e.x === 0 || e.y === 0 || e.x + e.w === map.width || e.y + e.h === map.height;
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
  if (home.data.kind !== 'town') out.push({ level: 'error', map: homeId, message: 'the home map must be a town (players start there, or in the home off it, and wake up there after a collapse)' });

  // A street of cabins (Residents' Lane): one at most, whose every door leads into one home of one's own,
  // each player's own cabin. The way onto it is a road: a way off the edge of the home town, like the
  // roads out to the regions, and its end leads back there along it. No door leads onto it.
  const streets = [...byId.values()].filter(m => m.data.street);
  if (streets.length > 1) out.push({ level: 'error', map: streets[1]!.data.id, message: `street: ${streets.map(m => m.data.id).join(' and ')} are both streets, but every player's cabin stands on the one` });
  for (const street of streets) {
    const rooms = new Set(street.data.objects.flatMap(o => (o.kind === 'house' ? [street.exitAt(doorOf(o).x, doorOf(o).y)?.to ?? ''] : [])));
    const room = rooms.size === 1 ? byId.get([...rooms][0]!) : undefined;
    if (!room?.data.private) out.push({ level: 'error', map: street.data.id, message: 'street: every cabin on it leads into the one home of one\'s own (a private room): its owner\'s own cabin' });
    if (!street.data.exits.some(e => e.to === homeId)) out.push({ level: 'error', map: street.data.id, message: `street: its end leads back to the home town (${homeId})` });
    if (!home.data.exits.some(e => e.to === street.data.id && onEdge(home, e))) out.push({ level: 'error', map: street.data.id, message: `street: the home town (${homeId}) reaches it by a road off its edge` });
  }
  for (const map of byId.values()) {
    // A door leads into a building: its exit must go to an inside, not to a town (the street neither: its
    // way in is a road) or the wilds.
    for (const o of map.data.objects) {
      if (o.kind !== 'house') continue;
      const d = doorOf(o), into = map.exitAt(d.x, d.y), target = into && byId.get(into.to);
      if (target?.data.street) out.push({ level: 'error', map: map.data.id, message: `house at ${o.x},${o.y}: its door leads onto the street ${into!.to}, whose way in is a road off the edge of the home town (${homeId}), never a door` });
      else if (target && target.data.kind !== 'inside') out.push({ level: 'error', map: map.data.id, message: `house at ${o.x},${o.y}: its door leads to ${into!.to}, which is not an inside` });
      // Concrete outside, concrete inside: one of NAPO's buildings leads into one of its rooms, the mill
      // onto its floor, a cabin into a cabin's.
      else if (target && (o.style ?? null) !== (target.data.style ?? null)) {
        out.push({ level: 'error', map: map.data.id, message: `house at ${o.x},${o.y}: ${BUILDING[o.style ?? 'none']} leads into ${into!.to}, which is ${ROOM[target.data.style ?? 'none']}` });
      }
    }
    map.data.exits.forEach((e, i) => {
      const where = `exit ${i} (to ${e.to})`;
      const target = byId.get(e.to);
      if (!target) return out.push({ level: 'error', map: map.data.id, message: `${where}: there is no map ${e.to}` });
      // A padlock is on a door: behind it is a room, never the way on to somewhere else.
      if (e.lock && target.data.kind !== 'inside') out.push({ level: 'error', map: map.data.id, message: `${where}: is locked, but a lock is only ever on a door into a room` });
      for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) {
        const a = map.exitAt(x, y)!;
        if (!target.walkable(a.x, a.y)) out.push({ level: 'error', map: map.data.id, message: `${where}: tile ${x},${y} arrives on ${a.x},${a.y} in ${e.to}, which is not walkable` });
        else if (target.exitAt(a.x, a.y)) out.push({ level: 'error', map: map.data.id, message: `${where}: tile ${x},${y} arrives on ${a.x},${a.y} in ${e.to}, which is an exit itself` });
      }
      if (e.home && target.data.depth >= map.data.depth) out.push({ level: 'warning', map: map.data.id, message: `${where} is marked home but does not lead to a shallower map` });
      return undefined;
    });
    // A gate leads on like an exit, deeper, and its far side's way home comes back to it.
    for (const g of map.data.objects) {
      if (g.kind !== 'gate') continue;
      const where = `gate at ${g.x},${g.y} (to ${g.to})`, target = byId.get(g.to);
      if (!target) { out.push({ level: 'error', map: map.data.id, message: `${where}: there is no map ${g.to}` }); continue; }
      for (let x = g.x; x < g.x + g.w; x++) {
        const a = gateArrival(g, x);
        if (!target.walkable(a.x, a.y) || target.exitAt(a.x, a.y)) out.push({ level: 'error', map: map.data.id, message: `${where}: tile ${x} arrives on ${a.x},${a.y} in ${g.to}, which is not walkable ground (or is an exit)` });
      }
      if (target.data.kind !== 'wilds' || target.data.depth <= map.data.depth) out.push({ level: 'error', map: map.data.id, message: `${where}: a gate leads deeper into the wilds` });
      if (!target.data.exits.some(e => e.home && e.to === map.data.id)) out.push({ level: 'error', map: map.data.id, message: `${where}: the way home from ${g.to} comes back here, so nobody is shut in behind it` });
    }
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

  // NAPO's teleports: the one in every cabin (a home of one's own) sets you down in front of its twin in
  // the home town, the only town that has one, and that one sets you down at home, in front of the cabin's.
  const teleporting = [...byId.values()].filter(m => m.data.objects.some(o => o.kind === 'teleport'));
  for (const m of teleporting) {
    if (m.data.kind === 'town' && m.data.id !== homeId) out.push({ level: 'error', map: m.data.id, message: `teleport: NAPO's teleport in town stands in the home town (${homeId})` });
  }
  const inTown = home.data.objects.some(o => o.kind === 'teleport'), inCabin = teleporting.some(m => m.data.private);
  if (inCabin && !inTown) out.push({ level: 'error', map: homeId, message: 'teleport: the one in the cabin has its twin in the home town, where it sets you down' });
  if (inTown && !inCabin) out.push({ level: 'error', map: homeId, message: 'teleport: the one in the home town has its twin in the cabin, where it sets you down at home' });

  // Where new players start and collapsed ones wake up: one home, off the home town or off the street
  // there (every player's own cabin), so it is never in doubt.
  const wakes = [...byId.values()].filter(m => m.data.wake);
  const offTown = (m: TileMap) => m.data.exits.some(e => e.to === homeId || (byId.get(e.to)?.data.street && byId.get(e.to)!.data.exits.some(x => x.to === homeId)));
  for (const m of wakes) {
    if (!offTown(m)) out.push({ level: 'error', map: m.data.id, message: `wake: only the home off the home town (${homeId}), or off its street, is where you wake up, and this room's door opens elsewhere` });
  }
  if (wakes.length > 1) out.push({ level: 'error', map: wakes[1]!.data.id, message: `wake: ${wakes.map(m => m.data.id).join(' and ')} both have one, but everyone wakes up in the same home` });

  // The Long Night's fire (the lodge's) is one, in a room off the home town, and never the home's: the
  // home fire stays tended, so a new player always has a safe fire.
  const nights = [...byId.values()].filter(m => m.data.objects.some(o => o.kind === 'fireplace' && o.longNight));
  for (const m of nights) {
    const off = m.data.exits.some(e => e.to === homeId);
    if (!off || m.data.wake || m.data.private || m.data.objects.some(o => o.kind === 'chest')) {
      out.push({ level: 'error', map: m.data.id, message: `longNight: the fire nobody tends on the Long Night is in a room off ${homeId} that is not the home` });
    }
  }
  if (nights.length > 1 || nights.some(m => m.data.objects.filter(o => o.kind === 'fireplace' && o.longNight).length > 1)) {
    out.push({ level: 'error', map: nights.at(-1)!.data.id, message: 'longNight: one fire in the world goes untended on the Long Night, the lodge\'s' });
  }

  // What a player read is kept by the note's id, whichever map it lies on.
  const notes = new Map<string, string>();
  for (const map of byId.values()) for (const o of map.data.objects) {
    if (o.kind !== 'note') continue;
    const other = notes.get(o.id);
    if (other) out.push({ level: 'error', map: map.data.id, message: `note ${JSON.stringify(o.id)} at ${o.x},${o.y}: ${other} has that id too` });
    else notes.set(o.id, `the note at ${o.x},${o.y} of ${map.data.id}`);
  }

  const reached = new Set([homeId]);
  const queue = [homeId];
  for (let h = 0; h < queue.length; h++) {
    const m = byId.get(queue[h]!)?.data;
    const ways = [...(m?.exits ?? []), ...(m?.objects ?? []).filter(o => o.kind === 'gate')];
    for (const e of ways) if (byId.has(e.to) && !reached.has(e.to)) { reached.add(e.to); queue.push(e.to); }
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
    if (!['resource', 'consumable', 'charm', 'gear', 'tool', 'sealed', 'keepsake', 'furniture', 'bundle'].includes(i.kind)) {
      err(`${name}: kind must be resource, consumable, charm, gear, tool, sealed, keepsake, furniture or bundle`);
    }
    if (i.kind === 'keepsake') {
      if (i.stack !== 1) err(`${name}: a keepsake is one of a kind, one to a slot`);
      if (i.use || i.weight || i.fuel || i.charge || i.live || i.reveals) err(`${name}: a keepsake is only brought home: never used, burned or fed, and it weighs nothing to speak of`);
    }
    if (i.kind === 'furniture') {
      if (!(COMFORTS as readonly string[]).includes(i.furnishes as string)) err(`${name}: furniture furnishes a place in the cabin: ${COMFORTS.join(', ')}`);
      if (!(Number.isInteger(i.comfort) && i.comfort! >= 1 && i.comfort! <= 10)) err(`${name}: furniture adds comfort, a whole number from 1 to 10`);
      if (!i.spoiled?.trim()) err(`${name}: furniture needs the words for what stands spoiled in its place until it is made (spoiled)`);
      if (i.stack !== 1) err(`${name}: furniture stacks one to a slot`);
      if (i.use || i.weight || i.xp || i.fuel || i.charge || i.live || i.reveals) err(`${name}: furniture stands in its place: it is never used, carried or stashed, and earns no XP`);
    } else if (i.furnishes !== undefined || i.comfort !== undefined || i.spoiled !== undefined || i.dries !== undefined) err(`${name}: only furniture furnishes a place, adds comfort, has spoiled words or dries you`);
    if (i.kind === 'bundle') {
      // The server packs every bundle as this one item, and a bundle weighs what it holds.
      if (i.id !== BUNDLE) err(`${name}: the one bundle is ${JSON.stringify(BUNDLE)}`);
      if (i.stack !== 1) err(`${name}: a bundle stacks one to a slot`);
      if (i.use || i.xp || i.weight || i.fuel || i.charge || i.live || i.reveals) err(`${name}: a bundle is only carried and handed in: it weighs what it holds and earns nothing itself`);
    }
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
      if (i.senses !== undefined) err(`${name}: only a tool listens (senses)`);
    }
    if (i.senses !== undefined) {
      const { loud, faint, finds } = i.senses;
      if (!(typeof loud === 'number' && loud > 0 && typeof faint === 'number' && faint > loud)) err(`${name}: it hears loud within some tiles above 0, and faint within more`);
      if (!Array.isArray(finds) || !finds.length) err(`${name}: it listens for nothing`);
      for (const f of Array.isArray(finds) ? finds : []) if (f.when !== undefined && f.when !== 'aurora') err(`${name}: it hears ${f.item} always, or only on aurora nights (when: aurora)`);
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
    const effects = Object.values(i.use ?? {}).filter(v => (typeof v === 'number' && v !== 0) || v === true || v === 'eat' || v === 'drink').length;
    if (i.kind === 'consumable' && !effects) err(`${name} is a consumable that does nothing when used`);
    if (i.use && !effects) err(`${name}: use does nothing`);
    if (i.kind === 'charm' && !MODS.some(k => modChanges(k, i.charm?.[k]))) err(`${name} is a charm that does nothing`);
    if (i.kind !== 'charm' && i.charm) err(`${name}: only charms have a charm`);
    for (const k of Object.keys(i.charm ?? {})) if (!MODS.includes(k as keyof Mods)) err(`${name}: a charm changes ${MODS.slice(0, -1).join(', ')} or ${MODS.at(-1)}, not ${k}`);
    // A meal (meals.ts) is eaten or drunk from the bag, and does something until you come home: nothing else, and nothing but it.
    if (i.use?.meal !== undefined || i.eaten !== undefined) {
      if (i.use?.meal !== 'eat' && i.use?.meal !== 'drink') err(`${name}: a meal is eaten or drunk (use.meal: eat or drink)`);
      if (i.kind !== 'consumable') err(`${name}: a meal is a consumable, used up as it is eaten`);
      if (!MODS.some(k => modChanges(k, i.eaten?.[k]))) err(`${name} is a meal that does nothing (eaten)`);
      for (const k of Object.keys(i.eaten ?? {})) if (!MODS.includes(k as keyof Mods)) err(`${name}: a meal changes ${MODS.slice(0, -1).join(', ')} or ${MODS.at(-1)}, not ${k}`);
      if (Object.keys(i.use ?? {}).some(k => k !== 'meal')) err(`${name}: eating a meal is all it does (its use has nothing but meal)`);
    }
    for (const [field, v] of [['weight', i.weight], ['fuel', i.fuel], ['charge', i.charge], ['xp', i.xp]] as const) {
      if (v !== undefined && !(typeof v === 'number' && v > 0)) err(`${name}: ${field} must be a number above 0`);
    }
    if (i.use?.flare !== undefined && !(i.use.flare > 0)) err(`${name}: a flare burns for some seconds above 0`);
    if (i.use && (i.use.resist !== undefined || i.use.lasts !== undefined)) {
      // An effect (effects.ts): what it resists, and for how long, always together.
      const { resist, lasts } = i.use;
      if (i.kind !== 'consumable') err(`${name}: only a consumable gives an effect for a while (resist, lasts)`);
      if (!(Number.isInteger(lasts) && lasts! > 0)) err(`${name}: an effect lasts some whole seconds above 0`);
      if (!resist || typeof resist !== 'object' || !Object.keys(resist).length) err(`${name}: an effect resists something (resist)`);
      for (const [e, v] of Object.entries(resist ?? {})) {
        if (!ELEMENTS.includes(e as Element)) err(`${name}: its effect resists an unknown element ${e}`);
        else if (!(typeof v === 'number' && v > 0 && v <= 1)) err(`${name}: its effect's resistance is a share above 0, at most 1`);
      }
    }
    if (i.use?.identify && !i.reveals?.length) err(`${name} can be identified but reveals nothing`);
    if (i.reveals && !i.use?.identify) err(`${name} reveals things but cannot be identified`);
    if (i.live) {
      const into = data.items.find(d => d.id === i.live!.into);
      if (!into) err(`${name}: turns into ${i.live.into}, which is not an item`);
      else if (into.live) err(`${name}: turns into ${into.id}, which is live too`);
      else if (into.kind === 'sealed') err(`${name}: turns into ${into.id}, a sealed thing: ${NO_BAG}`);
      else if (into.kind === 'furniture') err(`${name}: turns into ${into.id}: ${PLACED}`);
      else if (into.kind === 'bundle') err(`${name}: turns into ${into.id}, a bundle: ${PACKED}`);
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
  // A sealed thing comes only in a parcel and stays in the stash until it is opened there (World.open):
  // nothing may put one in a bag, make one, or pay with one unopened.
  const sealed = new Set(data.items.filter(i => i.kind === 'sealed').map(i => i.id));
  // A keepsake lies in one place for each player (keepsakes, below) until they bring it home, where it
  // stays: nothing grows, makes, holds or pays with one.
  const keepsakes = new Set(data.items.filter(i => i.kind === 'keepsake').map(i => i.id));
  const KEPT = 'those lie in one place each, and stay home once brought there';
  // Furniture is made at the workbench for its place in the cabin and set there at once (World.craft): it
  // never lies in a bag or a stash, so nothing may put it in one, and nothing is paid with it.
  const furniture = data.items.filter(i => i.kind === 'furniture');
  const placed = new Set(furniture.map(i => i.id));
  const homes = maps.filter(m => m.private === true);
  const furnished = new Map<string, string>();
  for (const f of furniture) {
    const what = f.furnishes as Comfort;
    const other = furnished.get(what);
    if (other) err(`item ${JSON.stringify(f.id)}: ${other} furnishes the ${what} already, and a cabin has one place for it`);
    furnished.set(what, f.id);
    if ((COMFORTS as readonly string[]).includes(what) && !homes.some(m => m.objects.some(o => o.kind === 'comfort' && o.what === what))) {
      err(`item ${JSON.stringify(f.id)}: furnishes the ${what}, but no home has a place for one`);
    }
    if (!(data.recipes ?? []).some(r => r.make === f.id)) warn(`item ${JSON.stringify(f.id)}: nothing makes it at the workbench`);
  }
  for (const m of homes) for (const o of m.objects) if (o.kind === 'comfort' && !furnished.has(o.what)) warn(`${m.id}: the place for the ${o.what} at ${o.x},${o.y} has no furniture to make for it`);
  // Nothing in content gives a bundle: only a pile carried to the lodge is one.
  const bundles = new Set(data.items.filter(i => i.kind === 'bundle').map(i => i.id));
  // What a slab holds goes into the bags of the two who open it: things a bag carries.
  for (const m of maps) for (const o of m.objects) {
    if (o.kind !== 'slab') continue;
    for (const s of Array.isArray(o.holds) ? o.holds : []) {
      const where = `${m.id}: the slab at ${o.x},${o.y}`, def = data.items.find(d => d.id === s.item);
      if (!def) err(`${where} holds ${s.item}, which is not an item`);
      else if (def.kind === 'tool' || def.kind === 'sealed' || def.kind === 'bundle' || def.live) err(`${where} holds ${s.item}, which never goes into a bag as it is`);
    }
  }
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
      else if (sealed.has(n.item)) err(`mend: ${tier} needs ${n.item}, a sealed thing: ${OPENED}`);
      else if (placed.has(n.item)) err(`mend: ${tier} needs ${n.item}: ${PLACED}`);
      else if (keepsakes.has(n.item)) err(`mend: ${tier} needs ${n.item}, a keepsake: ${KEPT}`);
      else if (bundles.has(n.item)) err(`mend: ${tier} needs ${n.item}, a bundle: ${PACKED}`);
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
      else if (sealed.has(n.item)) err(`${name} needs ${n.item}, a sealed thing: ${OPENED}`);
      else if (placed.has(n.item)) err(`${name} needs ${n.item}: ${PLACED}`);
      else if (keepsakes.has(n.item)) err(`${name} needs ${n.item}, a keepsake: ${KEPT}`);
      else if (bundles.has(n.item)) err(`${name} needs ${n.item}, a bundle: ${PACKED}`);
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
    else if (sealed.has(r.make)) err(`${name} makes ${r.make}, a sealed thing: those come only in parcels`);
    // Furniture is set in its one place at once: one at a time.
    else if (placed.has(r.make) && r.count !== undefined && r.count !== 1) err(`${name} makes ${r.make}, furniture, which has one place: count is 1 or left out`);
    else if (keepsakes.has(r.make)) err(`${name} makes ${r.make}, a keepsake: ${KEPT}`);
    else if (bundles.has(r.make)) err(`${name} makes ${r.make}, a bundle: ${PACKED}`);
    if (r.count !== undefined && !(Number.isInteger(r.count) && r.count >= 1)) err(`${name}: count is a whole number from 1`);
    // What it makes goes by its kind: a tool to the player's tools (World.giveTool), anything else to the stash.
    else if (tools.has(r.make) && r.count !== undefined && r.count !== 1) err(`${name} makes ${r.make}, a tool, which is yours once: count is 1 or left out`);
    if (!r.needs?.length) err(`${name} needs nothing`);
    for (const n of r.needs ?? []) {
      if (!ids.has(n.item)) err(`${name} needs ${n.item}, which is not an item`);
      else if (tools.has(n.item)) err(`${name} needs ${n.item}, a tool: tools are never used up`);
      else if (sealed.has(n.item)) err(`${name} needs ${n.item}, a sealed thing: ${OPENED}`);
      else if (placed.has(n.item)) err(`${name} needs ${n.item}: ${PLACED}`);
      else if (keepsakes.has(n.item)) err(`${name} needs ${n.item}, a keepsake: ${KEPT}`);
      else if (bundles.has(n.item)) err(`${name} needs ${n.item}, a bundle: ${PACKED}`);
      if (!(Number.isInteger(n.count) && n.count >= 1)) err(`${name}: each need is a whole number from 1`);
    }
  }
  // What opens a locked door or a kind of ground that opens only for some (the culvert) is a tool: owned for good, never used up or lost.
  for (const m of maps) {
    const needs = new Set<string>();
    for (const e of m.exits ?? []) if (e.lock) needs.add(e.lock);
    for (const row of m.tiles) for (const c of row) { const need = TILE_NEEDS[TILE_CHARS[c as keyof typeof TILE_CHARS]]; if (need) needs.add(need); }
    for (const need of needs) {
      if (!ids.has(need)) err(`map ${m.id}: some of it opens only with ${need}, which is not an item`);
      else if (!tools.has(need)) err(`map ${m.id}: some of it opens only with ${need}, which is not a tool: what opens the way is yours for good`);
    }
  }
  // What cooks at a fire (meals.ts): a meal, from things carried in the bag that grow out there.
  const cookIds = new Set<string>();
  for (const r of data.cooking ?? []) {
    const name = `cooking ${JSON.stringify(r.id)}`;
    if (!/^[a-z][a-z0-9-]*$/.test(r.id ?? '')) err(`${name}: ids are lowercase letters, digits and -`);
    if (cookIds.has(r.id)) err(`${name} is defined twice`);
    cookIds.add(r.id);
    const made = data.items.find(d => d.id === r.make);
    if (!made) err(`${name} makes ${r.make}, which is not an item`);
    else if (!made.use?.meal || !made.eaten) err(`${name} makes ${r.make}, which is not a meal`);
    if (r.count !== undefined && !(Number.isInteger(r.count) && r.count >= 1)) err(`${name}: count is a whole number from 1`);
    if (!r.needs?.length) err(`${name} needs nothing`);
    for (const n of r.needs ?? []) {
      const def = data.items.find(d => d.id === n.item);
      if (!def) err(`${name} needs ${n.item}, which is not an item`);
      // What cooks is carried: never something that stays out of a bag, a piece of gear, a live find or another meal.
      else if (['tool', 'sealed', 'furniture', 'keepsake', 'gear'].includes(def.kind) || def.live || def.use?.meal) err(`${name} needs ${n.item}, which does not cook`);
      else if (!data.finds.some(f => f.item === n.item)) warn(`${name} needs ${n.item}, which grows nowhere`);
      if (!(Number.isInteger(n.count) && n.count >= 1)) err(`${name}: each need is a whole number from 1`);
    }
  }
  for (const i of data.items) if (i.use?.meal && !(data.cooking ?? []).some(r => r.make === i.id)) warn(`item ${JSON.stringify(i.id)}: a meal nothing cooks`);
  // What a radio listens for must be something that lies out there.
  for (const i of data.items) for (const f of Array.isArray(i.senses?.finds) ? i.senses.finds : []) {
    if (!ids.has(f.item)) err(`item ${JSON.stringify(i.id)} listens for ${f.item}, which is not an item`);
    else if (!data.finds.some(r => r.item === f.item)) warn(`item ${JSON.stringify(i.id)} listens for ${f.item}, which grows nowhere`);
  }
  for (const i of data.items) for (const r of i.reveals ?? []) {
    if (!ids.has(r.item)) err(`item ${JSON.stringify(i.id)} reveals ${r.item}, which is not an item`);
    else if (tools.has(r.item)) err(`item ${JSON.stringify(i.id)} reveals ${r.item}, a tool: tools are made at the workbench or found`);
    else if (sealed.has(r.item)) err(`item ${JSON.stringify(i.id)} reveals ${r.item}, a sealed thing: ${NO_BAG}`);
    else if (placed.has(r.item)) err(`item ${JSON.stringify(i.id)} reveals ${r.item}: ${PLACED}`);
    else if (keepsakes.has(r.item)) err(`item ${JSON.stringify(i.id)} reveals ${r.item}, a keepsake: ${KEPT}`);
    else if (bundles.has(r.item)) err(`item ${JSON.stringify(i.id)} reveals ${r.item}, a bundle: ${PACKED}`);
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
    if (def.kind === 'furniture') err(`${where}: ${id}: ${PLACED}`);
    if (def.kind === 'keepsake') err(`${where}: ${id} is a keepsake: ${KEPT}`);
    if (def.kind === 'bundle') err(`${where}: ${id} is a bundle: ${PACKED}`);
    if (sealed && def.kind === 'sealed') err(`${where}: ${id} is sealed too`);
  };
  const slotsOf = (list: unknown, where: string, sealed = false) => {
    if (!Array.isArray(list) || !list.length) return err(`${where}: a list of items and counts, not empty`);
    for (const s of list as BagSlot[]) {
      stashable(s?.item, where, sealed);
      if (!(Number.isInteger(s?.count) && s.count >= 1)) err(`${where}: each count is a whole number from 1`);
    }
  };
  for (const i of data.items) if (i.holds !== undefined && !Array.isArray(i.holds)) err(`item ${JSON.stringify(i.id)}: holds is a list`);
  for (const i of data.items) (Array.isArray(i.holds) ? i.holds : []).forEach((h, n) => {
    const where = `item ${JSON.stringify(i.id)}: holding ${n + 1}`;
    if (typeof h !== 'object' || h === null) return err(`${where}: it is a weight, and some items or any one of a kind`);
    if (!(typeof h.weight === 'number' && h.weight > 0)) err(`${where}: its weight is above 0`);
    if ((h.items === undefined) === (h.any === undefined)) return err(`${where}: it is some items, or any one of a kind`);
    if (h.items !== undefined) {
      slotsOf(h.items, where, true);
      // Opening one says what was inside and, when it is one thing, what that is good for.
      const one = Array.isArray(h.items) && h.items.length === 1 ? data.items.find(d => d.id === h.items![0]?.item) : undefined;
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
  const night = data.longNight;
  if (night) {
    if (!Array.isArray(night.items) || !night.items.length) err('longNight: items lists what grows back faster that night');
    for (const id of Array.isArray(night.items) ? night.items : []) {
      if (!ids.has(id)) err(`longNight: there is no item ${id}`);
      else if (!data.finds.some(f => f.item === id)) warn(`longNight: ${id} grows back faster, but no find grows it`);
    }
    if (Array.isArray(night.items) && new Set(night.items).size !== night.items.length) err('longNight: an item is listed twice');
    // Faster, and not so fast that a find is back before anyone has walked on.
    if (!(typeof night.regrow === 'number' && night.regrow > 1 && night.regrow <= 4)) err('longNight: regrow is how many times as fast, above 1 and at most 4');
  }
  const byId = new Map(maps.map(m => [m.id, m]));
  const conditionIds = validateConditions(data, byId, err);
  const tileKinds = new Set<string>(Object.values(TILE_CHARS));
  data.finds.forEach((f, n) => {
    const name = `find ${n} (${f.item} in ${f.map})`;
    if (!ids.has(f.item)) err(`${name}: there is no item ${f.item}`);
    else if (sealed.has(f.item)) err(`${name}: ${f.item} is a sealed thing: ${NO_BAG}`);
    else if (placed.has(f.item)) err(`${name}: ${f.item}: ${PLACED}`);
    else if (keepsakes.has(f.item)) err(`${name}: ${f.item} is a keepsake: ${KEPT}`);
    else if (bundles.has(f.item)) err(`${name}: ${f.item} is a bundle: ${PACKED}`);
    const mapData = byId.get(f.map);
    if (!mapData) return err(`${name}: there is no map ${f.map}`);
    if (!Number.isInteger(f.count) || f.count < 1) err(`${name}: count must be a whole number from 1`);
    if (!(f.respawn?.length === 2 && f.respawn[0] > 0 && f.respawn[0] <= f.respawn[1])) err(`${name}: respawn is [shortest, longest] seconds, above 0`);
    if (f.steps && !(f.steps.length === 2 && f.steps[0] >= 0 && f.steps[0] <= f.steps[1])) err(`${name}: steps is [nearest, farthest], from 0`);
    for (const k of f.on ?? []) if (!tileKinds.has(k)) err(`${name}: unknown tile kind ${k as TileKind}`);
    if (f.near && !(f.near.radius > 0 && f.near.kinds.length)) err(`${name}: near needs kinds and a radius above 0`);
    for (const [field, t] of [['by', f.by], ['clear', f.clear]] as const) {
      if (t === undefined) continue;
      if (!(t.radius > 0 && Array.isArray(t.tiles) && t.tiles.length)) err(`${name}: ${field} needs tile kinds and a radius above 0`);
      for (const k of Array.isArray(t.tiles) ? t.tiles : []) if (!tileKinds.has(k)) err(`${name}: ${field}: unknown tile kind ${k as TileKind}`);
    }
    if (f.when !== undefined && f.when !== 'unstable' && f.when !== 'aurora' && f.when !== 'storm' && f.when !== 'rain') err(`${name}: when is unstable, aurora, storm or rain`);
    if (f.when === 'unstable' && !mapData.surge) err(`${name}: grows while the map is restless, but ${f.map} never surges`);
    if (f.when === 'storm' && !mapData.storm) err(`${name}: grows during a storm, but ${f.map} never storms`);
    if (f.when === 'rain' && mapData.kind === 'inside') err(`${name}: grows in the rain, but it never rains indoors`);
    if (f.after !== undefined && (f.when !== 'rain' || !(typeof f.after === 'number' && f.after >= 0))) err(`${name}: after is some seconds from 0, and only for what grows in the rain`);
    if (f.condition !== undefined) {
      if (!conditionIds.has(f.condition)) err(`${name}: grows while ${f.condition} is on, which is not a condition`);
      if (f.when !== undefined) err(`${name}: grows with a condition or at a time (when), not both`);
    }
    if (f.season !== undefined) {
      if (!(SEASON_ORDER as readonly string[]).includes(f.season)) err(`${name}: grows in ${JSON.stringify(f.season)}, which is not a season (${SEASON_ORDER.join(', ')})`);
      if (f.when !== undefined || f.condition !== undefined) err(`${name}: grows in a season, or with a condition or at a time (when): one of them`);
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
  validateKeepsakes(data, keepsakes, byId, err);
  return out;
}

/**
 * Where the keepsakes lie (notes.ts): each keepsake in exactly one place, on a tile somebody can walk
 * onto and pick it up from (not an exit, which would carry them off), never two on one tile; and the
 * whole set home makes the bar bigger by a whole number.
 */
function validateKeepsakes(data: ItemsData, keepsakes: Set<string>, maps: Map<string, MapData>, err: (message: string) => void): void {
  const k = data.keepsakes;
  if (k === undefined) {
    if (keepsakes.size) err(`keepsakes: ${[...keepsakes].join(', ')} lie nowhere`);
    return;
  }
  if (!(Number.isInteger(k.energy) && k.energy >= 1)) err('keepsakes: energy is a whole number from 1, what the whole set home adds to the bar');
  if (!Array.isArray(k.places)) return err('keepsakes: places is a list');
  const placed = new Set<string>(), tiles = new Set<string>();
  k.places.forEach((p, n) => {
    const where = `keepsakes: place ${n + 1} (${p?.item})`;
    if (!keepsakes.has(p?.item)) return err(`${where}: ${p?.item} is not a keepsake`);
    if (placed.has(p.item)) err(`${where}: ${p.item} lies in two places`);
    placed.add(p.item);
    const mapData = maps.get(p.map);
    if (!mapData) return err(`${where}: there is no map ${p.map}`);
    const map = new TileMap(mapData);
    if (!map.walkable(p.x, p.y)) err(`${where}: ${p.x},${p.y} on ${p.map} is not walkable`);
    else if (map.exitAt(p.x, p.y)) err(`${where}: ${p.x},${p.y} on ${p.map} is an exit`);
    const tile = `${p.map} ${p.x},${p.y}`;
    if (tiles.has(tile)) err(`${where}: another keepsake lies on ${tile}`);
    tiles.add(tile);
    return undefined;
  });
  for (const id of keepsakes) if (!placed.has(id)) err(`keepsakes: ${id} lies nowhere`);
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
    if (typeof r !== 'object' || r === null) return err(`remark ${i + 1}: a remark has an id, who says it, after what, and the line`);
    const name = `remark ${i + 1} (${JSON.stringify(r.id)})`;
    if (!ID.test(r.id ?? '')) err(`${name}: an id is lowercase words joined by hyphens`);
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

/** A page is short: a few lines in the journal. */
const PAGE_TITLE_MAX = 32;
const PAGE_TEXT_MAX = 300;
/**
 * Words that say where something is, which a page never does (the world is learned by walking it): the
 * compass, a count of steps or tiles, a tile's two numbers. "The South Road" is a name, not a way.
 */
const WHERE = [/\b(north|south|east|west)(east|west|ern|wards?)?\b/i, /\b\d+ (steps?|tiles?)\b/i, /\b\d{1,2} ?, ?\d{1,2}\b/];
export const saysWhere = (text: string): boolean => WHERE.some(re => re.test(text.replace(/\bSouth Road\b/g, '')));

/**
 * content/notebook.json: pages with ids, areas, titles and texts, each opened by what a player picks up,
 * reads or lives through, about finds, readable things and sights that exist, and never saying where
 * anything is; blanks with a question, its answer and what fills it in.
 */
export function validateNotebook(data: NotebookData, maps: MapData[], items?: ItemsData): Problem[] {
  const out: Problem[] = [];
  const err = (message: string) => out.push({ level: 'error', message });
  const warn = (message: string) => out.push({ level: 'warning', message });
  if (!Number.isInteger(data.version) || data.version < 1) err('version must be a whole number from 1');
  if (!Array.isArray(data.pages) || !data.pages.length) {
    err('there are no pages');
    return out;
  }
  const byId = new Map(maps.map(m => [m.id, m]));
  const areas = new Set([ANYWHERE, ...maps.filter(m => m.kind !== 'inside').map(m => m.id)]);
  // What can be picked up: what finds grow, and what a strange object may turn out to be.
  const found = new Set([...(items?.finds ?? []).map(f => f.item), ...(items?.items ?? []).flatMap(i => (i.reveals ?? []).map(r => r.item))]);
  // What has an id of its own to be read by: NAPO's desks.
  const named = new Set<string>();
  for (const m of maps) for (const o of m.objects) if (o.kind === 'console') named.add(o.id);
  const event = (e: NotebookEvent, name: string) => {
    const kinds = typeof e === 'object' && e !== null ? Object.keys(e).filter(k => k !== 'during') : [];
    if (kinds.length !== 1 || !['find', 'read', 'saw'].includes(kinds[0]!)) return err(`${name}: an event is one of find, read or saw`);
    if ('during' in e && !('find' in e)) err(`${name}: only a find has a during`);
    if ('find' in e) {
      if (!found.has(e.find)) err(`${name}: nothing out there is ${String(e.find)}: no find grows it and nothing turns out to be it`);
      if (e.during !== undefined && !(DURING as readonly string[]).includes(e.during)) err(`${name}: during is ${DURING.join(' or ')}`);
    } else if ('read' in e) {
      if (typeof e.read === 'string') {
        if (!named.has(e.read)) err(`${name}: nothing to read has the id ${e.read}`);
      } else {
        const m = byId.get(e.read?.map);
        const o = m && readableAt(m, e.read.x, e.read.y);
        if (!m) err(`${name}: there is no map ${String(e.read?.map)}`);
        else if (!o) err(`${name}: nothing to read at ${e.read.x},${e.read.y} in ${e.read.map}`);
        else if (o.x !== e.read.x || o.y !== e.read.y) err(`${name}: the ${o.kind} at ${e.read.x},${e.read.y} in ${e.read.map} is named by its first tile, ${o.x},${o.y}`);
      }
    } else if (!(SIGHTS as readonly string[]).includes(e.saw)) err(`${name}: saw is one of ${SIGHTS.join(', ')}`);
    return undefined;
  };
  const words = (text: unknown, name: string, max: number) => {
    if (typeof text !== 'string' || !text.trim()) return err(`${name} says nothing`);
    if (text.length > max) err(`${name} is ${text.length} characters: a page is short, ${max} at most`);
    if (saysWhere(text)) err(`${name} says where something is: "${text}". A page never does`);
    return undefined;
  };
  const pageIds = new Set<string>(), blankIds = new Set<string>();
  data.pages.forEach((p, i) => {
    const name = `page ${i + 1} (${JSON.stringify(p?.id)})`;
    if (typeof p !== 'object' || p === null) return err(`${name}: a page has an id, an area, a title, a text and what opens it`);
    if (!ID.test(p.id ?? '')) err(`${name}: an id is lowercase words joined by hyphens`);
    if (pageIds.has(p.id)) err(`${name} is there twice`);
    pageIds.add(p.id);
    if (!areas.has(p.area)) err(`${name}: its area is a town or a region (${[...areas].filter(a => a !== ANYWHERE).join(', ')}), or ${ANYWHERE}`);
    words(p.title, `${name}: its title`, PAGE_TITLE_MAX);
    words(p.text, `${name}: its text`, PAGE_TEXT_MAX);
    const opens = p.when === undefined ? [] : opensOn(p);
    if (!opens.length) err(`${name}: nothing opens it`);
    opens.forEach((e, k) => event(e, `${name}: what opens it${opens.length > 1 ? ` (${k + 1})` : ''}`));
    if (p.blanks !== undefined && !Array.isArray(p.blanks)) return err(`${name}: blanks is a list`);
    (p.blanks ?? []).forEach((b, k) => {
      const where = `${name}: blank ${k + 1} (${JSON.stringify(b?.id)})`;
      if (typeof b !== 'object' || b === null) return err(`${where}: a blank has an id, a question, its answer and what fills it in`);
      if (!ID.test(b.id ?? '')) err(`${where}: an id is lowercase words joined by hyphens`);
      if (blankIds.has(b.id)) err(`${where} is there twice`);
      blankIds.add(b.id);
      words(b.ask, `${where}: its question`, PAGE_TITLE_MAX * 2);
      if (typeof b.ask === 'string' && !b.ask.trim().endsWith('?')) err(`${where}: its question ends in "?"`);
      words(b.fill, `${where}: its answer`, PAGE_TEXT_MAX / 2);
      if (b.when === undefined) return err(`${where}: nothing fills it in`);
      event(b.when, `${where}: what fills it in`);
      // It would fill in as the page opens, and never read as a question.
      if (opens.some(e => JSON.stringify(e) === JSON.stringify(b.when))) warn(`${where}: filled in by what opens its page, so it never reads as a question`);
      return undefined;
    });
    return undefined;
  });
  return out;
}
