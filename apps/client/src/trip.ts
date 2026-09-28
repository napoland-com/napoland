/**
 * How the trip went (the server's `trip`), in words: the card the text box shows when you come home, or
 * wake up there after a collapse (game.ts). The server sends numbers and ids; every word is made here.
 */
import type { MapData, TileMap, TripView } from '@napoland/shared';

/** Landmarks farther than this, walking, are no help saying where you fell. */
const LANDMARK_STEPS = 40;
/** This close, walking, you were by it. */
const BY_STEPS = 2;
/** A named place (a pond, a clearing) is reached anywhere this close to its middle, which may be water or rock. */
const PLACE_REACH = 3;

/** A name as it goes in a sentence: "the pond" (named "pond"), "the ranger's hut" (named "The ranger's hut"), "the Tower". */
export const the = (name: string): string => (/^the /i.test(name) ? `the ${name.slice(4)}` : `the ${name}`);

/** "a storm", "2 flashes". */
const count = (n: number, one: string, many: string) => (n === 1 ? `a ${one}` : `${n} ${many}`);
/** "a, b and c". */
const list = (words: string[]) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);

/**
 * Where tile x,y of `map` is, by the nearest landmark, walking: "by the pond", "12 steps from the ranger's
 * hut", or, right by one, how far the nearest door is too ("by the pond, 9 steps from the ranger's hut").
 * Landmarks are the doors of the rooms off it (named by the room's name: `dataOf` finds a map's data by
 * id), its named places, the way on to another region, the power line, the wreck, a sign, the road and
 * the way home. None within LANDMARK_STEPS: "deep in the Near Woods".
 */
export function landmarkOf(map: TileMap, x: number, y: number, dataOf: (id: string) => Pick<MapData, 'name' | 'kind'> | undefined): string {
  const W = map.width, dist = new Int16Array(W * map.height).fill(-1), reached = [y * W + x];
  if (map.inside(x, y)) dist[y * W + x] = 0;
  for (let h = 0; h < reached.length; h++) {
    const i = reached[h]!, d = dist[i]!, cx = i % W, cy = (i / W) | 0;
    if (d >= LANDMARK_STEPS) continue;
    for (const [nx, ny] of [[cx, cy - 1], [cx + 1, cy], [cx, cy + 1], [cx - 1, cy]] as const) {
      if (!map.walkable(nx, ny) || dist[ny * W + nx] !== -1) continue;
      dist[ny * W + nx] = d + 1;
      reached.push(ny * W + nx);
    }
  }
  /** Steps to the nearest tile reached within `r` of tx,ty (a thing standing there is reached next to it). */
  const steps = (tx: number, ty: number, r = 0) => {
    let best = Infinity;
    for (let yy = ty - r; yy <= ty + r; yy++) for (let xx = tx - r; xx <= tx + r; xx++) {
      const d = map.inside(xx, yy) ? dist[yy * W + xx]! : -1;
      if (d >= 0 && d < best) best = d;
    }
    return best;
  };
  // In the order a tie goes: a door first, then a named place, the things standing, the road, the way home.
  const found: Array<{ name: string; steps: number; door?: true }> = [];
  for (const e of map.data.exits) {
    if (e.home) continue;
    const to = dataOf(e.to);
    if (!to) continue;
    let d = Infinity;
    for (let yy = e.y; yy < e.y + e.h; yy++) for (let xx = e.x; xx < e.x + e.w; xx++) d = Math.min(d, steps(xx, yy));
    found.push(to.kind === 'inside' ? { name: the(to.name), steps: d, door: true } : { name: `the way to ${the(to.name)}`, steps: d });
  }
  for (const p of map.data.places ?? []) found.push({ name: the(p.name), steps: steps(p.x, p.y, PLACE_REACH) });
  const THINGS: Record<string, string> = { pole: 'the power line', car: 'the wreck', sign: 'a sign' };
  for (const kind of Object.keys(THINGS)) {
    let d = Infinity;
    for (const o of map.data.objects) if (o.kind === kind) d = Math.min(d, steps(o.x, o.y, 1));
    found.push({ name: THINGS[kind]!, steps: d });
  }
  found.push({ name: 'the road', steps: Math.min(Infinity, ...reached.filter(i => map.kind(i % W, (i / W) | 0) === 'road').map(i => dist[i]!)) });
  let home = Infinity;
  for (const e of map.data.exits) if (e.home) for (let yy = e.y; yy < e.y + e.h; yy++) for (let xx = e.x; xx < e.x + e.w; xx++) home = Math.min(home, steps(xx, yy));
  found.push({ name: 'the way home', steps: home });

  const near = found.filter(f => f.steps <= LANDMARK_STEPS).reduce<(typeof found)[number] | null>((a, f) => (!a || f.steps < a.steps ? f : a), null);
  if (!near) return `deep in ${the(map.data.name)}`;
  if (near.steps > BY_STEPS) return `${near.steps} steps from ${near.name}`;
  // Right by it: and how far the nearest door is, to find the way back.
  const door = found.filter(f => f.door && f !== near && f.steps <= LANDMARK_STEPS).sort((a, b) => a.steps - b.steps)[0];
  return door && door.steps > BY_STEPS ? `by ${near.name}, ${door.steps} steps from ${door.name}` : `by ${near.name}`;
}

/**
 * The card for a trip: its title (the text box's name tag) and its lines. `mapOf` finds our copy of a map
 * by id; a map's name comes from it too.
 */
export function tripCard(t: TripView, mapOf: (id: string) => TileMap | undefined): { title: string; lines: string[] } {
  const dataOf = (id: string) => mapOf(id)?.data;
  const minutes = `${t.minutes} minute${t.minutes === 1 ? '' : 's'}`;
  const title = t.fell ? `Out ${minutes}` : `Home after ${minutes}`;
  const where = t.deepest && dataOf(t.deepest.map)?.name;
  const lines = [
    `${t.steps} steps · ${where ? `as deep as ${the(where)}, ${t.deepest!.steps} steps out` : 'never past the edge'}`,
  ];
  const fellOn = t.fell && mapOf(t.fell.map);
  if (t.fell) lines.push(`You fell ${fellOn ? landmarkOf(fellOn, t.fell.x, t.fell.y, dataOf) : 'out there'}`);
  else lines.push(`Lowest energy: ${t.lowest} · Bag worth ${t.xp} XP`);
  const { storms, flashes, surges } = t.caught;
  const caught = [
    ...(storms ? [count(storms, 'storm', 'storms')] : []),
    ...(flashes ? [count(flashes, 'flash', 'flashes')] : []),
    ...(surges ? [count(surges, 'surge', 'surges')] : []),
  ];
  lines.push(caught.length ? `Caught in ${list(caught)}` : 'Nothing caught you out there');
  const trip = t.best.flatMap(b => (b === 'deepest' ? ['farthest'] : b === 'longest' ? ['longest'] : []));
  if (trip.length) lines.push(`Your ${list(trip)} trip yet`);
  if (t.best.includes('xp')) lines.push('The most XP you ever brought home');
  return { title, lines };
}
