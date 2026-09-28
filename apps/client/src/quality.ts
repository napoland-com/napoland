/**
 * The resolution follows the phone. The world is drawn at up to twice the screen's CSS pixels, which is
 * sharp on a phone but costs a slow one its frame rate, so when frames come too slowly for a while the
 * world is drawn a step coarser, and a step finer again once they come easily. A step that did not hold
 * waits longer before it is tried again, so the picture never flickers between two sharpnesses.
 *
 * Plain logic, tested without a page: main.ts gives it every frame's time and applies the scale it
 * answers (WorldView.pixelScale).
 */

/** The share of the full resolution at each step, finest first. */
export const SCALES: readonly number[] = [1, 0.85, 0.72, 0.6, 0.5];

export interface ResolutionOptions {
  /** Frames slower than this on average (ms) are too slow: about 42 a second. */
  slowMs: number;
  /** Frames faster than this on average (ms) come easily: a phone at 60 a second. */
  easyMs: number;
  /** How long frames must stay too slow before a step down (ms of play). */
  downAfterMs: number;
  /** How long frames must come easily before a step up (ms of play). */
  upAfterMs: number;
  /** A step up that is followed by a step down within this long did not hold (ms of play). */
  holdMs: number;
  /** After a step up that did not hold, how long before trying again; it doubles each time (ms of play). */
  retryMs: number;
}

export const RESOLUTION: ResolutionOptions = { slowMs: 24, easyMs: 18, downAfterMs: 1500, upAfterMs: 6000, holdMs: 15_000, retryMs: 60_000 };

/** Longer than this (ms) is not a frame but a pause (a hidden tab, a map loading): it counts for nothing. */
const PAUSE_MS = 250;
/** How much one frame moves the average: about the last dozen frames count. */
const EASE = 0.1;

export class Resolution {
  private step = 0;
  private avg = 0;
  private slowFor = 0;
  private easyFor = 0;
  /** Play time so far (ms), counting only real frames. */
  private played = 0;
  /** When the last step up happened (play time), and when a step up may be tried again. */
  private upAt = -Infinity;
  private retryAt = 0;
  private retry: number;

  constructor(private readonly o: ResolutionOptions = RESOLUTION) {
    this.retry = o.retryMs;
  }

  /** The share of the full resolution to draw at now. */
  get scale(): number {
    return SCALES[this.step]!;
  }

  /** One frame took `ms`. Returns the new scale when it changes, otherwise null. */
  frame(ms: number): number | null {
    if (!(ms > 0) || ms > PAUSE_MS) return null;
    this.played += ms;
    this.avg = this.avg === 0 ? ms : this.avg + (ms - this.avg) * EASE;
    if (this.avg > this.o.slowMs) {
      this.slowFor += ms;
      this.easyFor = 0;
      if (this.slowFor >= this.o.downAfterMs && this.step < SCALES.length - 1) {
        // A step up that could not hold: try it again later, and later still each time.
        if (this.played - this.upAt < this.o.holdMs) {
          this.retryAt = this.played + this.retry;
          this.retry *= 2;
        }
        return this.move(1);
      }
    } else if (this.avg < this.o.easyMs) {
      this.easyFor += ms;
      this.slowFor = 0;
      if (this.easyFor >= this.o.upAfterMs && this.step > 0 && this.played >= this.retryAt) {
        this.upAt = this.played;
        return this.move(-1);
      }
    } else {
      this.slowFor = Math.max(0, this.slowFor - ms);
      this.easyFor = Math.max(0, this.easyFor - ms);
    }
    return null;
  }

  private move(by: 1 | -1): number {
    this.step += by;
    this.slowFor = 0;
    this.easyFor = 0;
    // The average starts over at the new sharpness: the old frames say nothing about it.
    this.avg = 0;
    return this.scale;
  }
}
