/**
 * The fire lookout as your game has it (roadmap/lookout-tower.md; the rules are the shared lookout.ts):
 * plain logic, tested without a page. How far the view pulls back (the camera's radius, eased), and the
 * distant lights you see from up there: the lamps, the lit shelters, the masts' red lights, the Old
 * Stone's glow and the flares going up, each where it really is, or, past what the view reaches, on its
 * edge in its real direction. Never a marker: only what a person up there would see.
 */
import { LOOKOUT_ZOOM, type MapData, type MapExit } from '@napoland/shared';

/** How quickly the view pulls back and comes in again: most of the way in about a second. */
export const ZOOM_RATE = 2.4;

/** The view's zoom eased toward where it is going (3 up a lookout, 1 down), `dt` seconds on. */
export function easeZoom(zoom: number, up: boolean, dt: number): number {
  const target = up ? LOOKOUT_ZOOM : 1;
  const next = zoom + (target - zoom) * (1 - Math.exp(-ZOOM_RATE * Math.max(0, dt)));
  // Close enough is there: the far look and the lights come on and off once, not forever at the edge.
  return Math.abs(next - target) < 0.004 ? target : next;
}

/** How much of the way up the view is: 0 down, 1 all the way up (what fades the distant lights in). */
export function upness(zoom: number): number {
  return Math.min(1, Math.max(0, (zoom - 1) / (LOOKOUT_ZOOM - 1)));
}

/** A light seen from afar: where (tile units, and its height in world units), its color, and whether it blinks (a mast) or breathes (the Old Stone). */
export interface FarLight {
  x: number;
  z: number;
  y: number;
  color: string;
  kind: 'steady' | 'blink' | 'breathe';
  /** How big its glow is, in world units. */
  size: number;
}

/** Street lamps, orange; a lit window, warm; a mast's lamp, red; the Old Stone, violet. */
const LAMP = '#ffb05a', WINDOW = '#ffc070', MAST = '#ff3322', STONE = '#b28cff';

/**
 * Where another map lies, as offsets from this one's tiles: through the exits between outdoor maps (a
 * town, the wilds), up to `hops` maps away, each exit tile taken to be the tile it arrives on. So the
 * Old Stone in Stonebrook lies south of the Near Woods, and the Tower farther south again.
 */
export function mapOffsets(from: MapData, peek: (id: string) => MapData | undefined, hops = 2): Map<string, { dx: number; dy: number }> {
  const out = new Map([[from.id, { dx: 0, dy: 0 }]]);
  let edge: MapData[] = [from];
  for (let h = 0; h < hops && edge.length; h++) {
    const next: MapData[] = [];
    for (const m of edge) {
      const at = out.get(m.id)!;
      for (const e of m.exits as MapExit[]) {
        const to = peek(e.to);
        if (!to || to.kind === 'inside' || out.has(to.id)) continue;
        // Their tile tx,ty is where this map's exit tile is.
        out.set(to.id, { dx: at.dx + e.x - e.tx, dy: at.dy + e.y - e.ty });
        next.push(to);
      }
    }
    edge = next;
  }
  return out;
}

/**
 * The lights that never move, seen from up a lookout on `map`: its street lamps and lit houses, its
 * masts, and on the maps around it (mapOffsets) the Old Stone and the masts. Worked out once for a map.
 */
export function farLights(map: MapData, peek: (id: string) => MapData | undefined): FarLight[] {
  const out: FarLight[] = [];
  for (const [id, { dx, dy }] of mapOffsets(map, peek)) {
    const m = id === map.id ? map : peek(id);
    if (!m) continue;
    const here = id === map.id;
    for (const o of m.objects) {
      const x = o.x + dx, z = o.y + dy;
      if (o.kind === 'antenna') out.push({ x: x + 0.5, z: z + 0.5, y: 6.2, color: MAST, kind: 'blink', size: here ? 0.9 : 1.4 });
      else if (o.kind === 'stone') out.push({ x: x + 0.5, z: z + 0.5, y: 1.6, color: STONE, kind: 'breathe', size: here ? 1.6 : 3.2 });
      else if (here && o.kind === 'lamp') out.push({ x: x + 0.84, z: z + 0.5, y: 1.3, color: LAMP, kind: 'steady', size: 1.3 });
      // A shelter out there keeps its windows lit: its warm light shows through the trees.
      else if (here && o.kind === 'house' && o.lit) out.push({ x: x + o.w / 2, z: z + o.h / 2, y: 0.9, color: WINDOW, kind: 'steady', size: 1.5 });
    }
  }
  return out;
}

/**
 * Where a light is drawn, seen from fx, fz: where it is, if the view reaches it (`reach`, tiles); else on
 * the view's edge in its real direction, far and small, above the treetops.
 */
export function placeFar(l: Pick<FarLight, 'x' | 'z' | 'y'>, fx: number, fz: number, reach: number, out: { x: number; y: number; z: number; far: boolean }): { x: number; y: number; z: number; far: boolean } {
  const dx = l.x - fx, dz = l.z - fz, d = Math.hypot(dx, dz);
  if (d <= reach) {
    out.x = l.x; out.y = l.y; out.z = l.z; out.far = false;
  } else {
    out.x = fx + (dx / d) * reach; out.y = Math.max(l.y, 4.5); out.z = fz + (dz / d) * reach; out.far = true;
  }
  return out;
}

/** How bright a light is at `t` seconds: a mast's flashes with every other mast (napo.ts), the Old Stone breathes. */
export function farGlow(kind: FarLight['kind'], t: number): number {
  if (kind === 'blink') return t % 1.6 < 0.3 ? 1 : 0.12;
  if (kind === 'breathe') return 0.75 + 0.25 * Math.sin(t * 1.3);
  return 1;
}
