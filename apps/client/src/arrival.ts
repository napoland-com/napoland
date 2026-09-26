/**
 * Arriving on another map. When the server moves us (`zone`), the screen first fades to black on
 * the old map; the zone message and everything after it wait for the black screen, where the new
 * map is put in place in one go, and then the screen fades back in. Waiting keeps the old map
 * whole while it fades: your last step finishes and nobody pops over to the new map early.
 * Plain logic with no drawing, so it can be tested; main.ts draws `dark` and does the swap.
 */
import type { ServerMsg } from '@napoland/shared';

export const FADE_OUT_S = 0.25;
export const FADE_IN_S = 0.4;

export class Arrival {
  /** How dark the world is: 0 clear, 1 black. */
  dark = 0;
  private phase: 'clear' | 'out' | 'in' = 'clear';
  private t = 0;
  private held: ServerMsg[] = [];

  /** `swap` runs on the black screen with the messages that waited for it, oldest first. */
  constructor(private readonly swap: (held: ServerMsg[]) => void) {}

  /** True while the screen goes dark: the old map is still shown, so nobody should walk on it. */
  get leaving(): boolean {
    return this.phase === 'out';
  }

  /** Keeps msg for the black screen if it must wait: a zone starts the fade, and whatever follows it waits too. */
  hold(msg: ServerMsg): boolean {
    if (this.phase !== 'out') {
      if (msg.t !== 'zone') return false;
      // Leaving again while still fading in: go dark from where the fade is, without a flash.
      this.phase = 'out';
      this.t = this.dark * FADE_OUT_S;
    }
    this.held.push(msg);
    return true;
  }

  /** Black at once, swap, then fade in: after logging in, or when a reconnect lands on another map. */
  cut() {
    const held = this.held;
    this.held = [];
    this.phase = 'in';
    this.t = 0;
    this.dark = 1;
    this.swap(held);
  }

  /** Advance by dt seconds. Pass the frame's clamped dt, so a slow frame (building a big map) does not skip the fade. */
  update(dt: number) {
    if (this.phase === 'out') {
      this.t += dt;
      this.dark = Math.min(1, this.t / FADE_OUT_S);
      if (this.dark >= 1) this.cut();
    } else if (this.phase === 'in') {
      this.t += dt;
      const k = Math.min(1, this.t / FADE_IN_S);
      this.dark = 1 - k * k * (3 - 2 * k);
      if (k >= 1) { this.phase = 'clear'; this.dark = 0; }
    }
  }
}
