/**
 * A glimpse of someone's steps, as your game walks it (DESIGN.md, Cooperation: glimpses): the server sends a
 * walk somebody really took on your map in the last day, their jacket color and the tiles, never who; a
 * see-through figure in that color walks it, at an echo's pace, while you watch, and fades at its end. It
 * shows only while you are alone out there, and once you come within GLIMPSE_NEAR tiles of it, it fades for
 * good. Plain logic, tested without a page; view/wilds.ts draws it.
 */
import { GLIMPSE_NEAR, type GlimpseView } from '@napoland/shared';

/** A tile takes it this long (seconds): an echo's pace, a little slower than the living. */
export const GLIMPSE_STEP_S = 0.34;
/** It comes out of the dark over this long (seconds). */
export const GLIMPSE_IN_S = 0.8;
/** It fades over this long (seconds), at the end of the walk, when you come near or when someone else is here. */
export const GLIMPSE_OUT_S = 1.2;

export class Passing {
  /** Where it is (tiles, fractions between two), which way it heads (as a model turns about y), and whether it walks. */
  x = 0;
  y = 0;
  heading = 0;
  walking = false;
  /** Its walker's jacket color. */
  color = '';
  private steps: ReadonlyArray<readonly [number, number]> = [];
  private start = 0;
  /** When it began to fade before its walk was over (ms), Infinity while it has not, and how much of it showed then. */
  private fading = Infinity;
  private from = 0;

  /** Somebody's walk, from `now` (ms): it takes the place of any other. */
  begin(g: GlimpseView, now: number) {
    this.steps = g.steps.filter(s => Array.isArray(s) && Number.isFinite(s[0]) && Number.isFinite(s[1]));
    this.color = g.color;
    this.start = now;
    this.fading = Infinity;
    this.from = 0;
    this.heading = 0;
    this.walking = false;
    const first = this.steps[0];
    if (first) [this.x, this.y] = first;
  }

  /** Gone at once: another map, or the connection went. */
  end() {
    this.steps = [];
  }

  /** A walk is under way (it may be fading). */
  get active(): boolean {
    return this.steps.length > 0;
  }

  /**
   * How much of it shows now, 0 to 1, `now` in ms, with you at mx,my (tiles) and `alone` out there or not.
   * Faded all the way, it is over. A number, so a frame makes nothing new.
   */
  update(now: number, mx: number, my: number, alone: boolean): number {
    const n = this.steps.length;
    if (!n) return 0;
    const t = Math.max(0, now - this.start) / 1000, walk = (n - 1) * GLIMPSE_STEP_S;
    const along = Math.min(n - 1, t / GLIMPSE_STEP_S), i = Math.floor(along), f = along - i;
    const [x0, y0] = this.steps[i]!, [x1, y1] = this.steps[Math.min(n - 1, i + 1)]!;
    this.x = x0 + (x1 - x0) * f;
    this.y = y0 + (y1 - y0) * f;
    if (x1 !== x0 || y1 !== y0) this.heading = Math.atan2(x1 - x0, y1 - y0);
    this.walking = t < walk;
    // Out of the dark as it begins, back into it as the walk ends.
    const shown = Math.min(1, t / GLIMPSE_IN_S, 1 - Math.max(0, t - walk) / GLIMPSE_OUT_S);
    // Someone else here, or you came near: it fades from as much as showed then, and does not come back.
    if (this.fading === Infinity && (!alone || Math.hypot(this.x - mx, this.y - my) <= GLIMPSE_NEAR)) {
      this.fading = now;
      this.from = Math.max(0, shown);
    }
    const k = this.fading === Infinity ? shown : Math.min(shown, this.from * (1 - (now - this.fading) / 1000 / GLIMPSE_OUT_S));
    if (k > 0) return k;
    // Its very first moment, it is still to come; anything else is over.
    if (this.fading === Infinity && t < GLIMPSE_IN_S) return 0;
    this.end();
    return 0;
  }
}
