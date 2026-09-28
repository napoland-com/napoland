/**
 * NAPO's teleport as you see it use you (the beam pad): step onto the pad, turn round, rings of light climb
 * round you and a column of light comes on, you fade into sparks from your feet up, and a flash; only then
 * does the game ask the server to move you. At the other end: a flash on the pad, sparks fall, you form from
 * your head down, and step off onto the tile the server put you on. It plays on your screen alone: everyone
 * else sees you vanish in a small violet pop, and pop out at the other end (popAt). Plain timing with no
 * drawing, so it is tested; game.ts runs the clock, view/world.ts draws the pose.
 */
import { teleportArrival, type MapObject } from '@napoland/shared';

/** Seconds from YES to the teleport being sent: you are gone by then. */
export const BEAM_OUT_S = 1.55;
/** Seconds from arriving (the new map put in place, still dark) to stepping off the pad. */
export const BEAM_IN_S = 1.65;

/** Where the trip is at, as the view draws it: every part 0 to 1. */
export interface BeamPose {
  /** 0 on your own tile, 1 on the pad. */
  onPad: number;
  /** 0 facing the pad, 1 turned round, facing away from it. */
  turn: number;
  /** How much of you is not there, from your feet up: 0 all of you, 1 none. */
  gone: number;
  /** Stepping (legs swinging). */
  walking: boolean;
  rings: number;
  column: number;
  sparks: number;
  flash: number;
  /** Which way the sparks and rings go: up as you go, down as you come. */
  rising: boolean;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const ease = (x: number) => x * x * (3 - 2 * x);

/** The pose `t` seconds into going ('out') or arriving ('in'). Past its end it holds its last pose. */
export function beamPose(phase: 'out' | 'in', t: number): BeamPose {
  if (phase === 'out') {
    return {
      onPad: ease(seg(t, 0, 0.2)),
      turn: ease(seg(t, 0.2, 0.4)),
      gone: seg(t, 0.6, 1.4),
      walking: t < 0.2,
      rings: seg(t, 0.35, 0.5),
      column: seg(t, 0.35, 0.6),
      sparks: seg(t, 0.55, 0.7),
      flash: seg(t, 1.35, 1.45) * (1 - seg(t, 1.45, 1.8)),
      rising: true,
    };
  }
  return {
    onPad: 1 - ease(seg(t, 1.4, 1.6)),
    turn: 1,
    gone: 1 - seg(t, 0.4, 1.1),
    walking: t >= 1.4 && t < 1.6,
    rings: seg(t, 0.15, 0.3) * (1 - seg(t, 1.15, 1.45)),
    column: seg(t, 0.15, 0.4) * (1 - seg(t, 1.2, 1.5)),
    sparks: seg(t, 0.3, 0.45) * (1 - seg(t, 1.05, 1.25)),
    flash: seg(t, 1.05, 1.12) * (1 - seg(t, 1.12, 1.4)),
    rising: false,
  };
}

/** The teleport on a map that sets you down on x,y (teleportArrival), if one does. */
export function padFor(objects: readonly MapObject[], x: number, y: number): { x: number; y: number } | undefined {
  const t = objects.find(o => o.kind === 'teleport' && teleportArrival(o).x === x && teleportArrival(o).y === y);
  return t && { x: t.x, y: t.y };
}

/**
 * Where someone else vanishing or appearing makes a pop, as seen by everyone but them: vanishing from a tile
 * next to a teleport ('leave'), or appearing on the tile one sets you down on ('join'). Null anywhere else.
 */
export function popAt(objects: readonly MapObject[], how: 'leave' | 'join', x: number, y: number): { x: number; y: number } | null {
  const near = objects.some(o => o.kind === 'teleport' && (how === 'join' ? teleportArrival(o).x === x && teleportArrival(o).y === y : Math.abs(o.x - x) + Math.abs(o.y - y) === 1));
  return near ? { x, y } : null;
}
