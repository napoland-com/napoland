/**
 * Where something is, as people say it: by the nearest landmark, walking, never by coordinates, since
 * nothing in the game ever shows where anyone is (docs/DESIGN.md, no position marker). One rule for every
 * line that says where out there, on both sides: where you fell, on the trip report's card (the client's
 * trip.ts); someone down, in local chat (rescue.ts, which the server words); and an arrow, a rescue or a
 * lost pile, in a letter home (the client's thanks.ts).
 *
 * "Nearest" is walking distance, the steps someone would take, not a straight line through the firs.
 */
import type { MapData, TileMap } from './map';

/** Landmarks farther than this, walking, are no help saying where. */
export const LANDMARK_STEPS = 40;
/** This close, walking, you are by it. */
export const BY_STEPS = 2;
/** A named place (a pond, a clearing) is reached anywhere this close to its middle, which may be water or rock. */
const PLACE_REACH = 3;

/** A name as it goes in a sentence: "the pond" (named "pond"), "the ranger's hut" (named "The ranger's hut"), "the Tower". */
export const the = (name: string): string => (/^the /i.test(name) ? `the ${name.slice(4)}` : `the ${name}`);

/** A map's or a room's own name mid-sentence: "The old cabin" is "the old cabin"; "Stonebrook Lodge" stays. */
export function inSentence(name: string): string {
  return name.replace(/^The /, 'the ');
}

/** What landmarkOf needs to know of the maps a map's exits lead to, by id: their names, and which are rooms. */
export type MapNames = (id: string) => Pick<MapData, 'name' | 'kind'> | undefined;

/**
 * Where tile x,y of `map` is, by the nearest landmark, walking: "by the pond", "12 steps from the ranger's
 * hut", or, right by one, how far the nearest door is too ("by the pond, 9 steps from the ranger's hut").
 * Landmarks are the doors of the rooms off it (named by the room's name: `dataOf` finds a map's data by
 * id), its named places, the way on to another region, the power line, the wreck, a sign, the road and
 * the way home. None within LANDMARK_STEPS: "deep in the Near Woods". Nobody is lost indoors: a room is
 * its own name ("in the old cabin"), and your own cabin is home.
 */
export function landmarkOf(map: TileMap, x: number, y: number, dataOf: MapNames): string {
  if (map.data.kind === 'inside') return map.data.private ? 'at home' : `in ${inSentence(map.data.name)}`;
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
