/**
 * Tile-by-tile movement rules shared by the server (which enforces them) and the client
 * (which predicts them so walking feels instant).
 */
import type { TileMap } from './map';
import type { Dir } from './protocol';

/** Time to walk one tile: 200 ms is 5 tiles per second, one steady running pace. */
export const STEP_MS = 200;

export const DIR_VEC: Readonly<Record<Dir, readonly [number, number]>> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

export const DIRS: readonly Dir[] = ['up', 'right', 'down', 'left'];

export function stepTarget(x: number, y: number, dir: Dir): { x: number; y: number } {
  const [dx, dy] = DIR_VEC[dir];
  return { x: x + dx, y: y + dy };
}

/** The direction of a one-tile move, or null if (dx, dy) is not one. */
export function dirOf(dx: number, dy: number): Dir | null {
  if (dx === 0 && dy === -1) return 'up';
  if (dx === 0 && dy === 1) return 'down';
  if (dx === -1 && dy === 0) return 'left';
  if (dx === 1 && dy === 0) return 'right';
  return null;
}

/**
 * Does someone at x,y facing `dir` look toward tile tx,ty? Anything on the side they face counts, however
 * far to either side: a watcher freezes under it (the server), and what stands at the edge of the fog is
 * gone under it (the client's unease).
 */
export function faces(x: number, y: number, dir: Dir, tx: number, ty: number): boolean {
  switch (dir) {
    case 'up': return ty < y;
    case 'down': return ty > y;
    case 'left': return tx < x;
    case 'right': return tx > x;
  }
}

/** The direction to face something at (dx, dy) from here: the larger axis wins. */
export function dirToward(dx: number, dy: number): Dir {
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

/**
 * Shortest 4-direction path from (sx, sy) to (tx, ty), as the tiles to walk through (start excluded).
 * If the target cannot be reached, the path leads to the closest reachable tile.
 * With `adjacent`, the path stops next to the target (to talk to someone or face a sign).
 */
export function findPath(map: TileMap, sx: number, sy: number, tx: number, ty: number, adjacent = false, maxNodes = 5000): Array<{ x: number; y: number }> {
  const W = map.width;
  const start = sy * W + sx;
  const prev = new Int32Array(W * map.height).fill(-1);
  const seen = new Uint8Array(W * map.height);
  const queue: number[] = [start];
  seen[start] = 1;
  let best = start;
  let bestD = Infinity;
  for (let head = 0; head < queue.length && head < maxNodes; head++) {
    const i = queue[head]!;
    const x = i % W;
    const y = (i / W) | 0;
    const m = Math.abs(x - tx) + Math.abs(y - ty);
    const d = adjacent ? (m === 1 ? 0 : m + 1) : m;
    if (d < bestD) {
      bestD = d;
      best = i;
      if (d === 0) break;
    }
    for (const dir of DIRS) {
      const n = stepTarget(x, y, dir);
      if (!map.walkable(n.x, n.y)) continue;
      const j = n.y * W + n.x;
      if (seen[j]) continue;
      seen[j] = 1;
      prev[j] = i;
      queue.push(j);
    }
  }
  const path: Array<{ x: number; y: number }> = [];
  for (let i = best; i !== start && i !== -1; i = prev[i]!) path.push({ x: i % W, y: (i / W) | 0 });
  return path.reverse();
}
