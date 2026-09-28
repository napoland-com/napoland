/**
 * Asking first, like Pokémon's YES/NO: before anything you carry or keep is used up, the text box asks,
 * with YES already chosen, so saying yes costs one more press. Where more than one can go at once it
 * also asks how many (×N, with − and +), starting at the fewest. Up and down move between YES and NO,
 * left and right take one away or add one, A says the chosen answer, and B, NO or a tap outside the
 * box say no: nothing is spent. Holding − or + (or the stick to a side) repeats, faster and faster.
 *
 * Plain state with no page in it, so it is tested without one. Game keeps the open question (Game.ask)
 * and passes it the stick, A, B and taps; hud.ts draws it. Everything that uses something up asks
 * through it: feeding a fire or the Old Stone, cooking at one, using and throwing away what is in the
 * bag, making and mending at the workbench, and later opening, upgrading and giving.
 *
 * A question can also be a choice between a few answers in words ("Feed the fire" or "Cook"), in the
 * frame where YES and NO stand: up and down choose, A says the chosen one, and B, or a tap outside the
 * box, is none of them. It asks nothing about using something up; what it leads to does.
 */
import type { Dir } from '@napoland/shared';
import type { AskView } from './hud';

/** How many can go at once: the fewest and the most (what you carry, what fits), and where it starts (the fewest when left out). */
export interface AskCount {
  min: number;
  max: number;
  start?: number;
}

export interface Ask {
  /** The name over the box: what you are dealing with (the fire, the Old Stone, the item). */
  who: string;
  /** The question. One that says how many is a function of the count: "Throw away 3 resin?" */
  text: string | ((n: number) => string);
  /** How many can go at once. Asked only when more than one can. */
  count?: AskCount;
  /** YES, with how many (1 when it does not count). */
  yes(n: number): void;
  /** NO, B or a tap outside the box: nothing happens, nothing is spent. */
  no?(): void;
  /**
   * Two things to choose between, instead of YES and NO (at someone else's pile: "Take half" or "Carry it
   * to the lodge for Ana"): the words on each, and what the second one does. B and a tap outside the box
   * still back out, and nothing happens.
   */
  choices?: { yes: string; other: string; run(): void };
  /** What the question is about, when something else may take it back before it is answered (a friend's ask to trade that is over). */
  tag?: 'trade';
  /**
   * A choice instead of YES and NO: these answers in words, top to bottom, the first chosen to start. The
   * one said is `pick`ed, by its place; B or a tap outside the box is `no`, as ever. It never counts.
   */
  options?: readonly string[];
  pick?(i: number): void;
}

/** YES or NO, or the place of an answer in words (a choice: Ask.options). */
export type Choice = 'yes' | 'no' | number;
/** How a question is answered: a choice, or backed out of (B, a tap outside the box), which is NO where there is one. */
export type Answer = Choice | 'back';

export class Question {
  choice: Choice;
  /** How many, from `min` to `max`; 1 when it does not count. */
  n: number;
  readonly min: number;
  readonly max: number;

  constructor(readonly ask: Ask) {
    const c = ask.options?.length ? undefined : ask.count;
    this.choice = ask.options?.length ? 0 : 'yes';
    this.min = c ? Math.max(1, Math.floor(c.min)) : 1;
    this.max = c ? Math.max(this.min, Math.floor(c.max)) : 1;
    this.n = Math.min(this.max, Math.max(this.min, Math.floor(c?.start ?? this.min)));
  }

  /** It asks how many: more than one can go. */
  get counts(): boolean {
    return this.max > this.min;
  }

  get text(): string {
    const t = this.ask.text;
    return typeof t === 'string' ? t : t(this.n);
  }

  /**
   * Up and down choose YES or NO (or, in a choice, the answer above or below, stopping at either end); left
   * and right take one away or add one. True when anything changed.
   */
  move(dir: Dir): boolean {
    if (dir === 'left' || dir === 'right') return this.step(dir === 'left' ? -1 : 1);
    const options = this.ask.options?.length ?? 0;
    const c: Choice = options
      ? Math.min(options - 1, Math.max(0, (typeof this.choice === 'number' ? this.choice : 0) + (dir === 'up' ? -1 : 1)))
      : dir === 'up' ? 'yes' : 'no';
    if (c === this.choice) return false;
    this.choice = c;
    return true;
  }

  /** − or + (`by` of them at once, from holding), kept between the fewest and the most. True when the count changed. */
  step(by: number): boolean {
    if (!this.counts || !by) return false;
    const n = Math.min(this.max, Math.max(this.min, this.n + by));
    if (n === this.n) return false;
    this.n = n;
    return true;
  }

  /** What the text box draws for it: YES and NO, or the answers of a choice. */
  view(): AskView {
    const c = this.ask.choices;
    return {
      who: this.ask.who, text: this.text, choice: this.choice, count: this.counts ? { n: this.n, min: this.min, max: this.max } : null,
      ...(c ? { labels: { yes: c.yes, no: c.other } } : {}),
      ...(this.ask.options?.length ? { options: [...this.ask.options] } : {}),
    };
  }

  /** What an answer does: an answer in words (by its place), YES, the second of two choices, or NO (backing out is NO). */
  run(answer: Answer): void {
    if (typeof answer === 'number') return this.ask.pick?.(answer);
    if (answer === 'yes') return this.ask.yes(this.n);
    if (answer === 'no' && this.ask.choices) return this.ask.choices.run();
    this.ask.no?.();
  }
}

/** A held − or + (or the stick held to a side) repeats after this long... */
export const REPEAT_AFTER_MS = 380;
/** ...one step every this often at first, closing in on the fastest over REPEAT_RAMP_MS of repeating. */
export const REPEAT_FIRST_MS = 160;
export const REPEAT_FASTEST_MS = 45;
export const REPEAT_RAMP_MS = 1200;

/** Holding − or +: one step at once, then, after a moment, steps that come faster and faster. */
export class Repeat {
  private dir: -1 | 0 | 1 = 0;
  /** When the repeats began (ms), and when the next step is due. */
  private from = 0;
  private next = Infinity;

  /** Which way it is held: -1, 1, or 0 when let go. */
  get held(): -1 | 0 | 1 {
    return this.dir;
  }

  /** Held toward `dir` from `now` (ms). Its first step comes at once: that step is returned. */
  press(dir: -1 | 1, now: number): number {
    this.dir = dir;
    this.from = now + REPEAT_AFTER_MS;
    this.next = this.from;
    return dir;
  }

  release(): void {
    this.dir = 0;
    this.next = Infinity;
  }

  /** The steps due by `now`, summed (each -1 or +1); 0 when none. Call it every frame while held. */
  due(now: number): number {
    if (!this.dir) return 0;
    let n = 0;
    // A few at most: a frame that comes very late (a slow device) must not leap to the end.
    while (now >= this.next && n < 4) {
      n++;
      const k = Math.min(1, (this.next - this.from) / REPEAT_RAMP_MS);
      this.next += REPEAT_FIRST_MS + (REPEAT_FASTEST_MS - REPEAT_FIRST_MS) * k;
    }
    if (now >= this.next) this.next = now + REPEAT_FASTEST_MS;
    return n * this.dir;
  }
}

/** How long what the box says by itself stays up, unless a press closes it first: about 4 seconds, longer for more to read. */
export function noteMs(text: string): number {
  return Math.min(8000, Math.max(4000, 1200 + text.length * 50));
}
