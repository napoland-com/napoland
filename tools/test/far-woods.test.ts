/**
 * The Far Woods as they ship (roadmap/far-woods.md, docs/DESIGN.md): the first region at depth 2, up
 * the trappers' trail from the cabin at the end of the Near Woods. Where they are and how they join the
 * Near Woods, how deep they go and what that costs, the trapper's cabin on the way, NAPO's field post at
 * the heart, their clocks, creatures and finds, their map found out there, the story they add, and
 * their field notes.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CREATURE_STEP_MIN_MS, ENERGY_MAX, FAR_STEPS, SKULKER_STEP_MS, STARTER_TOOLS, TileMap, WATCHER_STEP_MS, energyRate, findTiles, hidden, maxEnergy, modsOf, charmsIn,
  itemIndex, opensOn, saysWhere, skulkerStepMs, stormAt, storyLines, surgeAt, watcherStepMs, type ItemsData, type MapData, type NotebookData, type NotebookEvent, type StoryData,
} from '@napoland/shared';

const content = resolve(import.meta.dirname, '../../content');
const items = JSON.parse(readFileSync(resolve(content, 'items.json'), 'utf8')) as ItemsData;
const story = JSON.parse(readFileSync(resolve(content, 'story.json'), 'utf8')) as StoryData;
const maps = new Map(readdirSync(resolve(content, 'maps')).filter(f => f.endsWith('.json')).map(f => {
  const data = JSON.parse(readFileSync(resolve(content, 'maps', f), 'utf8')) as MapData;
  return [data.id, new TileMap(data)] as const;
}));
const far = maps.get('far-woods')!, near = maps.get('near-woods')!;
const cabin = maps.get('far-woods-trapper-cabin')!, post = maps.get('far-woods-field-post')!;
const byId = itemIndex(items);

/** Walking steps between two tiles of a map (-1: no way). */
function walk(map: TileMap, from: readonly [number, number], to: readonly [number, number]): number {
  const W = map.width, d = new Int32Array(W * map.height).fill(-1), queue = [from[1] * W + from[0]];
  d[queue[0]!] = 0;
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h]!, x = i % W, y = (i / W) | 0;
    if (x === to[0] && y === to[1]) return d[i]!;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (!map.walkable(nx, ny) || d[ny * W + nx]! >= 0) continue;
      d[ny * W + nx] = d[i]! + 1;
      queue.push(ny * W + nx);
    }
  }
  return -1;
}
/** The tile in front of the door into room `id` on `map`. */
const frontOf = (map: TileMap, id: string): [number, number] => {
  const e = map.data.exits.find(x => x.to === id)!;
  return [e.x, e.y + 1];
};
const place = (name: string) => far.data.places!.find(p => p.name === name)!;
/** Steps from home to a named place: from its tile, or the nearest walkable tile beside it. */
const stepsTo = (name: string) => {
  const p = place(name);
  return Math.min(...[[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => far.homeSteps(p.x + dx!, p.y + dy!)).filter(s => s >= 0));
};

describe('the Far Woods, where they are', () => {
  it('are the first region at depth 2: old growth, 80 by 100 tiles, in the wilds', () => {
    expect(far.data).toMatchObject({ name: 'The Far Woods', kind: 'wilds', depth: 2, forest: 'old', width: 80, height: 100 });
    expect([...maps.values()].filter(m => m.data.depth >= 2).map(m => m.data.id)).toEqual(['far-woods']);
  });

  it('are reached up the trappers\' trail from beside the cabin at the end of the Near Woods, and left down it: both ways onto open ground', () => {
    const up = near.data.exits.find(e => e.to === 'far-woods')!;
    // On the Near Woods' top row, a few steps from the cabin at the end.
    expect(up.y).toBe(0);
    const [cx, cy] = frontOf(near, 'near-woods-end-cabin');
    expect(Math.abs(up.x - cx) + Math.abs(up.y - cy)).toBeLessThanOrEqual(8);
    const down = far.data.exits.find(e => e.home)!;
    expect(down).toMatchObject({ to: 'near-woods', y: far.height - 1 });
    // Each leads onto the tile beside the other's end, which is open ground and no exit.
    expect([up.tx, up.ty]).toEqual([down.x, down.y - 1]);
    expect([down.tx, down.ty]).toEqual([up.x, up.y + 1]);
    expect(far.walkable(up.tx, up.ty) && !far.exitAt(up.tx, up.ty)).toBe(true);
    expect(near.walkable(down.tx, down.ty) && !near.exitAt(down.tx, down.ty)).toBe(true);
    // The Far Woods' way home counts as home: its danger is measured from it, and it leads somewhere shallower.
    expect(near.data.depth).toBeLessThan(far.data.depth);
  });

  it('can be walked everywhere from the way home, the heart about 150 steps in', () => {
    for (let y = 0; y < far.height; y++) for (let x = 0; x < far.width; x++) if (far.walkable(x, y)) expect(far.homeSteps(x, y), `${x},${y}`).toBeGreaterThanOrEqual(0);
    expect(far.deepest).toBeGreaterThanOrEqual(145);
    expect(far.deepest).toBeLessThanOrEqual(170);
    expect(stepsTo('the hollow')).toBeGreaterThanOrEqual(135);
    expect(stepsTo('the hollow')).toBeLessThanOrEqual(160);
    // The Near Woods' way on goes no deeper than their ring of stones did: a surge there still starts where it did.
    expect(near.deepest).toBe(125);
  });

  it('name their places for the paper map, each where it is', () => {
    expect(far.data.places!.map(p => p.name)).toEqual(['the fork', 'the ford', 'the cedar grove', 'the split rock', 'the loggers\' bridge', 'the old camp', 'the cut', 'the hollow']);
    for (const p of far.data.places!) expect(stepsTo(p.name), p.name).toBeLessThan(Infinity);
    // The ford crosses the creek, and the bridge's timbers span the gorge.
    expect(far.data.objects.filter(o => o.kind === 'bridge').length).toBeGreaterThanOrEqual(2);
    for (const o of far.data.objects.filter(o => o.kind === 'bridge')) expect(Math.hypot(o.x - place('the loggers\' bridge').x, o.y - place('the loggers\' bridge').y), 'bridge').toBeLessThan(5);
  });
});

describe('the Far Woods, what stands there', () => {
  it('keep one shelter, the trapper\'s cabin, on the way to the heart: its fire burns down, and a crate stands by it', () => {
    const shelters = far.data.exits.map(e => maps.get(e.to)!).filter(m => m.data.kind === 'inside' && m.data.objects.some(o => o.kind === 'fireplace'));
    expect(shelters.map(m => m.data.id)).toEqual(['far-woods-trapper-cabin']);
    expect(cabin.data.objects.filter(o => o.kind === 'fireplace')).toEqual([{ kind: 'fireplace', x: 4, y: 1 }]);
    expect(cabin.data.objects.some(o => o.kind === 'cache')).toBe(true);
    for (const kind of ['traps', 'bed', 'woodpile', 'paper'] as const) expect(cabin.data.objects.some(o => o.kind === kind), kind).toBe(true);
    // About sixty steps in, and the way to the field post goes past its door: a fire to feed going in and to reach coming out.
    const door = frontOf(far, 'far-woods-trapper-cabin'), postDoor = frontOf(far, 'far-woods-field-post');
    expect(far.homeSteps(...door)).toBeGreaterThanOrEqual(50);
    expect(far.homeSteps(...door)).toBeLessThanOrEqual(80);
    expect(far.homeSteps(...door) + walk(far, door, postDoor) - far.homeSteps(...postDoor)).toBeLessThanOrEqual(4);
  });

  it('keep NAPO\'s field post in the hollow at the heart: a cold concrete room with its desk, a broken mast, humming rocks and its sign', () => {
    const door = frontOf(far, 'far-woods-field-post');
    expect(Math.hypot(door[0] - place('the hollow').x, door[1] - place('the hollow').y)).toBeLessThan(7);
    expect(post.data.style).toBe('napo');
    expect(post.data.objects.some(o => o.kind === 'fireplace')).toBe(false);
    expect(post.data.objects.filter(o => o.kind === 'console').map(o => o.kind === 'console' && o.id)).toEqual(['field-post-log']);
    const hut = far.data.objects.find(o => o.kind === 'house' && o.style === 'napo')!;
    expect(hut.kind === 'house' && hut.lit).toBe(0);
    expect(far.data.objects.filter(o => o.kind === 'antenna')).toEqual([expect.objectContaining({ broken: true })]);
    const humming = far.data.objects.filter(o => o.kind === 'rock' && o.hum);
    expect(humming.length).toBeGreaterThanOrEqual(6);
    for (const r of humming) expect(Math.hypot(r.x - place('the hollow').x, r.y - place('the hollow').y)).toBeLessThan(6);
    const sign = far.data.objects.find(o => o.kind === 'sign' && o.style === 'napo')!;
    expect(sign.kind === 'sign' && sign.text[0]).toMatch(/^NAPO field post/);
    // The hollow is a bowl in a rim of rock: the trail is its one way in.
    const rim = far.data.levels.flatMap((row, y) => [...row].flatMap((c, x) => (c !== '0' && Math.hypot(x - place('the hollow').x, y - place('the hollow').y) < 10 ? [1] : [])));
    expect(rim.length).toBeGreaterThan(40);
  });

  it('keep the loggers\' last camp from before NAPO: the bunkhouse fallen in, the yarder, cable spools and the company\'s board', () => {
    const camp = place('the old camp');
    const near8 = far.data.objects.filter(o => Math.hypot(o.x - camp.x, o.y - camp.y) < 9);
    for (const kind of ['ruin', 'yarder', 'spool', 'logs', 'stump'] as const) expect(near8.some(o => o.kind === kind), kind).toBe(true);
    expect(near8.some(o => o.kind === 'sign' && o.text[0]!.startsWith('Stonebrook Timber Co.'))).toBe(true);
  });

  it('are signposted where the trail leaves the Near Woods: what it takes, in plain words', () => {
    const up = near.data.exits.find(e => e.to === 'far-woods')!;
    const sign = near.data.objects.find(o => o.kind === 'sign' && Math.abs(o.x - up.x) + Math.abs(o.y - up.y) <= 4)!;
    expect(sign.kind === 'sign' && sign.text.join(' ')).toMatch(/Far Woods.*pairs.*twice as fast.*trapper's cabin/);
    expect(near.walkable(sign.x, sign.y + 1)).toBe(true);
  });

  it('hide you in a few patches of tall grass, fewer than the Near Woods, most in the deeper half', () => {
    let tiles = 0, deep = 0;
    for (let y = 0; y < far.height; y++) for (let x = 0; x < far.width; x++) if (hidden(far, x, y)) {
      tiles++;
      if (far.homeSteps(x, y) >= far.data.skulkers!.steps[0]) deep++;
      expect(far.walkable(x, y) && !far.exitAt(x, y), `${x},${y}`).toBe(true);
    }
    expect(tiles).toBeGreaterThanOrEqual(25);
    expect(deep * 2).toBeGreaterThan(tiles);
  });
});

describe('the Far Woods, what they cost', () => {
  /** Seconds a bar of `level` lasts standing on x,y in `weather`, dry and light. */
  const lasts = (map: TileMap, x: number, y: number, weather: 'overcast' | 'rain', level = 1) => maxEnergy(level) / -energyRate(map, x, y, weather);
  const tileAt = (map: TileMap, steps: number): [number, number] => {
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.homeSteps(x, y) === steps && map.walkable(x, y) && !map.warm(x, y)) return [x, y];
    throw new Error(`no tile ${steps} steps from home in ${map.data.id}`);
  };

  it('tire you twice as fast as the Near Woods at the same distance in (energy.ts, the depth)', () => {
    for (const s of [1, 30, 60, 100]) expect(energyRate(far, ...tileAt(far, s), 'rain')).toBeCloseTo(2 * energyRate(near, ...tileAt(near, s), 'rain'), 9);
  });

  it('empty a full bar in the rain in the times DESIGN.md gives: under 3 minutes at the edge, under a minute at the heart', () => {
    const edge = tileAt(far, 1), heart = tileAt(far, far.deepest);
    expect(Math.round(lasts(far, ...edge, 'rain'))).toBe(164);
    expect(Math.round(lasts(far, ...edge, 'rain', 8))).toBe(221);
    expect(Math.round(lasts(far, ...heart, 'rain'))).toBe(46);
    expect(Math.round(lasts(far, ...heart, 'rain', 8))).toBe(62);
    expect(ENERGY_MAX).toBe(100);
  });

  it('take about level 8 and the trapper\'s fire to walk from town to the field post and back', () => {
    // Energy for a walk of `steps` from a map's way home and back, without a stop, as the drain grows with the steps.
    const walkCost = (map: TileMap, steps: number, weather: 'overcast' | 'rain') => {
      let e = 0;
      for (let s = 1; s <= steps; s++) e += -energyRate(map, ...tileAt(map, Math.min(s, map.deepest)), weather) * 0.2;
      return 2 * e;
    };
    const nearPart = walkCost(near, near.homeSteps(...frontOf(near, 'near-woods-end-cabin')) + 3, 'rain');
    const farPart = walkCost(far, far.homeSteps(...frontOf(far, 'far-woods-field-post')), 'rain');
    // In the rain, never stopping: more than a new player's bar holds, less than a level 8's.
    expect(nearPart + farPart).toBeGreaterThan(maxEnergy(1));
    expect(nearPart + farPart).toBeLessThan(maxEnergy(8));
    // The trapper's fire splits the Far Woods' part: from there to the post and back costs well under a new player's bar.
    const fromCabin = farPart - walkCost(far, far.homeSteps(...frontOf(far, 'far-woods-trapper-cabin')), 'rain');
    expect(fromCabin).toBeLessThan(maxEnergy(1) * 0.75);
  });

  it('never run their surge or storm into the Near Woods\': a trip through both meets one at a time', () => {
    const busy = (m: MapData, s: number) => (m.surge ? surgeAt(m.surge, s * 1000).phase !== 'calm' : false) || (m.storm ? stormAt(m.storm, s * 1000).phase !== 'clear' : false);
    let farBusy = 0;
    for (let s = 0; s < 3 * 2400; s++) {
      expect(busy(far.data, s) && busy(near.data, s), `${s % 2400} s into a round`).toBe(false);
      if (busy(far.data, s)) farBusy++;
    }
    // Every 40 minutes each, like the Tower's pulse: restless 5 minutes, a surge of 2.5, and a storm of 4 after a minute's warning.
    expect(far.data.surge).toMatchObject({ every: 2400, unstable: 300, surge: 150 });
    expect(far.data.storm).toMatchObject({ every: 2400, warn: 60, length: 240 });
    expect(farBusy).toBe(3 * (300 + 150 + 60 + 240));
    // Restless from 5:00 into the Tower's round, the surge from 10:00; the storm's warning at 24:00.
    expect(surgeAt(far.data.surge!, 299_000).phase).toBe('calm');
    expect(surgeAt(far.data.surge!, 300_000).phase).toBe('unstable');
    expect(surgeAt(far.data.surge!, 600_000).phase).toBe('surge');
    expect(stormAt(far.data.storm!, 1_440_000).phase).toBe('coming');
    expect(stormAt(far.data.storm!, 1_500_000).phase).toBe('storm');
  });

  it('keep watchers in their deeper half and skulkers in their ferns, a little quicker than the Near Woods\' and still slower than you', () => {
    const w = far.data.watchers!, s = far.data.skulkers!;
    expect(w.steps[0] * 2).toBeGreaterThanOrEqual(far.deepest * 0.9);
    expect(far.lairs(w.steps).length).toBeGreaterThan(200);
    expect(watcherStepMs(w, false)).toBeLessThan(WATCHER_STEP_MS);
    expect(watcherStepMs(w, true)).toBeGreaterThanOrEqual(CREATURE_STEP_MIN_MS);
    expect(skulkerStepMs(s)).toBeLessThan(SKULKER_STEP_MS);
    expect(skulkerStepMs(s)).toBeGreaterThanOrEqual(CREATURE_STEP_MIN_MS);
    expect(s.when).toEqual(['night', 'storm']);
    let lairs = 0;
    for (let y = 0; y < far.height; y++) for (let x = 0; x < far.width; x++) if (far.kind(x, y) === 'ferns' && far.creatureMayStand(x, y) && far.homeSteps(x, y) >= s.steps[0]) lairs++;
    expect(lairs).toBeGreaterThanOrEqual(40);
  });
});

describe('the Far Woods, what they give', () => {
  const rules = items.finds.filter(f => f.map === 'far-woods' || f.map.startsWith('far-woods-'));
  /** How many of `item` lie out on a map at once, every day (not a condition's, the weather's or a restless time's). */
  const always = (map: string, item: string) => items.finds.filter(f => f.map === map && f.item === item && f.when === undefined && f.condition === undefined).reduce((n, f) => n + f.count, 0);

  it('grow cedar bark that burns 4 minutes a strip, and NAPO\'s old batteries, kept for later', () => {
    expect(byId.get('cedar-bark')).toMatchObject({ kind: 'resource', fuel: 240 });
    const battery = byId.get('battery')!;
    expect(battery).toMatchObject({ kind: 'resource', noun: 'old battery', plural: 'old batteries' });
    expect(battery.text).toMatch(/NAPO's field kit ran on them/);
    expect(battery.text).toMatch(/Nothing at the workbench takes them yet/);
    // Nothing makes anything of them yet: they wait for a later recipe.
    expect((items.recipes ?? []).some(r => r.needs.some(n => n.item === 'battery'))).toBe(false);
    for (const item of ['cedar-bark', 'battery']) expect(rules.some(f => f.item === item), item).toBe(true);
  });

  it('keep a charm found nowhere else, the resin tear: 85 steps or more from home you tire 10% slower', () => {
    const tear = byId.get('resin-tear')!;
    expect(tear).toMatchObject({ kind: 'charm', charm: { farDrain: 0.9 } });
    expect(modsOf({}, charmsIn([{ item: 'resin-tear', count: 1 }], byId)).farDrain).toBeCloseTo(0.9, 9);
    expect(items.finds.filter(f => f.item === 'resin-tear').map(f => f.map)).toEqual(['far-woods']);
    // Deep in, rare: one at a time, back in 40 to 80 minutes.
    const rule = items.finds.find(f => f.item === 'resin-tear')!;
    expect(rule.steps![0]).toBeGreaterThanOrEqual(FAR_STEPS);
    expect(rule.respawn[0]).toBeGreaterThanOrEqual(2400);
    // Where it counts: as far out as the pathfinder's ground, the drain is a tenth gentler.
    const [x, y] = [...Array(far.width * far.height).keys()].map(i => [i % far.width, (i / far.width) | 0] as const).find(([tx, ty]) => far.homeSteps(tx, ty) === 120 && !far.warm(tx, ty))!;
    expect(energyRate(far, x, y, 'rain', { farDrain: 0.9 })).toBeCloseTo(0.9 * energyRate(far, x, y, 'rain'), 9);
  });

  it('hold more shards and strange objects than the Near Woods, and deeper in', () => {
    for (const item of ['shard', 'strange']) {
      expect(always('far-woods', item), item).toBeGreaterThan(always('near-woods', item));
      const deepest = (map: string) => Math.min(...items.finds.filter(f => f.map === map && f.item === item && f.when === undefined && f.steps).map(f => f.steps![0]));
      expect(deepest('far-woods'), item).toBeGreaterThanOrEqual(deepest('near-woods'));
    }
    const restless = (map: string) => items.finds.filter(f => f.map === map && f.when === 'unstable').reduce((n, f) => n + f.count, 0);
    expect(restless('far-woods')).toBeGreaterThan(restless('near-woods'));
  });

  it('give every rule room to grow, and add no cloth: the cloth each hour stays as the design sets it', () => {
    for (const f of rules) expect(findTiles(maps.get(f.map)!, f).length, `${f.item} in ${f.map}`).toBeGreaterThanOrEqual(f.count);
    expect(rules.some(f => f.item === 'cloth')).toBe(false);
  });

  it('keep their paper map in the trapper\'s cabin, found and not given: growing back within minutes for the next who has none', () => {
    const map = byId.get('far-woods-map')!;
    expect(map).toMatchObject({ kind: 'tool', chart: 'far-woods', icon: 'map' });
    expect(STARTER_TOOLS).not.toContain('far-woods-map');
    const rule = items.finds.find(f => f.item === 'far-woods-map')!;
    expect(rule.map).toBe('far-woods-trapper-cabin');
    expect(rule.respawn[1]).toBeLessThanOrEqual(180);
    // Every other area there is outdoors has a map everyone starts with; this one alone is found. (A
    // street is no area of its own: it is on the map of the town its end leads back to, areaOf.)
    const charted = new Set([...STARTER_TOOLS].map(t => byId.get(t)!.chart));
    const outdoors = [...maps.values()].filter(m => m.data.kind !== 'inside' && !m.data.street).map(m => m.data.id);
    expect(outdoors.filter(id => !charted.has(id))).toEqual(['far-woods']);
  });
});

describe('the Far Woods in the story', () => {
  const last = story.chapters.at(-1)!;
  const before = story.chapters.at(-2)!;
  const always = (npc: string) => [...maps.values()].flatMap(m => m.data.objects.flatMap(o => (o.kind === 'npc' && o.id === npc ? o.lines : [])));

  it('add one chapter, at the end, reached by reading the field post\'s desk', () => {
    expect(last).toMatchObject({ id: 'the-field-post', title: 'The field post', when: { read: 'field-post-log' } });
    expect(before.id).toBe('do-not-switch-off');
    expect(last.text).toMatch(/Far Woods/);
  });

  it('are hinted at by Walt, Mira and Vera once the Tower\'s panel is read, in their own words and never a mission', () => {
    for (const [npc, word] of [['walt', /trappers/], ['mira', /level 8/], ['vera', /field post/]] as const) {
      const lines = storyLines(story, before.id, npc, always(npc));
      expect(lines[0], npc).toMatch(/Far Woods/);
      expect(lines[0], npc).toMatch(word);
    }
    // Reached, Vera and Walt say what they make of it, before what they always say.
    for (const npc of ['vera', 'walt']) expect(storyLines(story, last.id, npc, always(npc))[0], npc).toBe(last.hints![npc]);
  });
});

describe('the Far Woods in the field notes', () => {
  const notebook = JSON.parse(readFileSync(resolve(content, 'notebook.json'), 'utf8')) as NotebookData;
  const theirs = notebook.pages.filter(p => p.area === 'far-woods');
  const opening = (e: NotebookEvent) => notebook.pages.filter(p => opensOn(p).some(o => JSON.stringify(o) === JSON.stringify(e)));
  const at = (map: TileMap, kind: string, x: number, y: number) => map.data.objects.find(o => o.kind === kind && o.x === x && o.y === y);

  it('have an area of their own, after the South Road\'s, of pages that never say where anything is', () => {
    expect(theirs.length).toBeGreaterThanOrEqual(8);
    const areas = [...new Set(notebook.pages.map(p => p.area))];
    expect(areas.indexOf('far-woods')).toBe(areas.indexOf('south-road') + 1);
    // One run of pages: the journal shows them area by area.
    const first = notebook.pages.findIndex(p => p.area === 'far-woods');
    expect(notebook.pages.slice(first, first + theirs.length).every(p => p.area === 'far-woods')).toBe(true);
    for (const p of theirs) expect(saysWhere(p.text), p.id).toBe(false);
  });

  it('open on the trail\'s sign, the fork\'s, the company\'s board, NAPO\'s sign and the trapper\'s tally, each once', () => {
    const reads: Array<[TileMap, string, number, number]> = [[near, 'sign', 52, 2], [far, 'sign', 37, 87], [far, 'sign', 62, 57], [far, 'sign', 40, 19], [cabin, 'paper', 2, 3]];
    for (const [map, kind, x, y] of reads) {
      expect(at(map, kind, x, y), `${map.data.id} ${x},${y}`).toBeDefined();
      expect(opening({ read: { map: map.data.id, x, y } }).map(p => p.area), `${map.data.id} ${x},${y}`).toEqual(['far-woods']);
    }
    // The field post's desk tells a chapter (the story's), so no page opens on it, like NAPO's other desks that do.
    expect(opening({ read: 'field-post-log' })).toEqual([]);
  });

  it('open on what grows only there: cedar bark, old batteries and the resin tear', () => {
    for (const item of ['cedar-bark', 'battery', 'resin-tear']) expect(opening({ find: item }).map(p => p.area), item).toEqual(['far-woods']);
  });
});
