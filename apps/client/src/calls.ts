/**
 * Calls without words, as this client plays them. B held (Q on a keyboard) with nothing open becomes
 * a call: a fan of three opens above B, the finger slides onto one and letting go sings it (here I
 * am, if it never left B). Every voice is a note of one pentatonic scale, picked from the player's
 * id, so friends learn each other's voices; a call is heard from the side it comes from, fainter and
 * duller the farther away. Nothing ever shows where a caller is: sound alone, and a note over their
 * head if they are on screen.
 *
 * Plain logic with no page and no sound in it, so it can be tested: main.ts feeds CallButton the
 * finger and the keys, hud.ts draws the fan, soundscape.ts turns a call heard into a sound for
 * sound.ts to sing.
 */
import { CALL_REACH, type CallKind } from '@napoland/shared';

/** B held this long, with nothing open, is a call; shorter, it is a tap: B as ever (the bag, back). */
export const HOLD_MS = 300;

/** Under each call's note on the fan, the first few times. */
export const CALL_WORDS: Readonly<Record<CallKind, string>> = { here: 'Here I am', come: 'Come here', thanks: 'Thank you' };
/** The fan says its calls in words until you have sung this many (this browser counts): then the notes alone. */
export const CALL_WORDS_UNTIL = 5;

/**
 * Where the three calls sit on the fan: degrees counterclockwise from B's right (90 is straight up), so
 * the fan opens up and to the left, away from A (which sits up and to the right of B).
 */
export const FAN: ReadonlyArray<{ kind: CallKind; deg: number }> = [
  { kind: 'here', deg: 90 },
  { kind: 'come', deg: 130 },
  { kind: 'thanks', deg: 176 },
];
/**
 * How far the fan's notes sit from B's center, and how big each is, in B's diameters (style.css draws
 * them so, --fan-r and --fan-d, and a little farther and bigger on the smallest phones, where B is small
 * and the words are not). A finger picks a note by its angle alone, so the size never changes the choice.
 */
export const FAN_RADIUS = 1.7;
export const FAN_NOTE = 0.62;
/** A finger this close to B's center (in B's diameters) is still on B. */
const ON_B = 0.55;
/** The fan's side, in degrees as FAN has them: from a little right of straight up round to a little below left. */
const FAN_FROM = 60;
const FAN_TO = 225;

/**
 * The call under a finger `dx`, `dy` from B's center, in B's diameters (screen axes: y grows down). On B
 * itself, here I am: what letting go there sings. Out on the fan's side, the call nearest in angle, so
 * a thumb need not land on the note exactly. Off it (toward A, to the right or down): none, and letting
 * go there sings nothing, a way out of a call held by mistake.
 */
export function fanChoice(dx: number, dy: number): CallKind | null {
  if (Math.hypot(dx, dy) <= ON_B) return 'here';
  const deg = (Math.atan2(-dy, dx) * 180) / Math.PI;
  // Below the left, the angle goes on past 180 rather than jumping to -180.
  const a = deg < -90 ? deg + 360 : deg;
  if (a < FAN_FROM || a > FAN_TO) return null;
  return FAN.reduce((best, f) => (Math.abs(f.deg - a) < Math.abs(best.deg - a) ? f : best)).kind;
}

/** What B does, pressed or let go: B as ever (the bag, back), a call, or nothing. */
export type BPress = { kind: 'b' } | { kind: 'call'; call: CallKind } | null;

/**
 * B under a finger, or Q on a keyboard: a tap is B as ever; held HOLD_MS with nothing open (`callable`:
 * no panel, text box or question) it opens the fan, and letting go sings the call chosen. Pressed with
 * something open, B is only B, at once, as it always was. A hold that something opened in front of
 * before the fan came is B too, once let go.
 */
export class CallButton {
  /**
   * up: B is not held. pending: held, not long enough yet. late: held long enough, but something had
   * opened: B when let go. fan: the fan is open. spent: B or a call was done already; letting go does nothing.
   */
  private state: 'up' | 'pending' | 'late' | 'fan' | 'spent' = 'up';
  private since = 0;
  /** What the finger is on: a call, or null off the fan. A key held has it stay on B: here I am. */
  private on: CallKind | null = 'here';

  /** The fan is open, to be drawn with `choice` lit (none: the finger is off it). */
  get open(): boolean {
    return this.state === 'fan';
  }

  get choice(): CallKind | null {
    return this.on;
  }

  /** B went down at `now` (ms). With something open it is B at once. */
  press(now: number, callable: boolean): BPress {
    this.on = 'here';
    if (!callable) {
      this.state = 'spent';
      return { kind: 'b' };
    }
    this.state = 'pending';
    this.since = now;
    return null;
  }

  /** Every frame while B is held: true the moment the hold opens the fan. */
  tick(now: number, callable: boolean): boolean {
    if (this.state !== 'pending' || now - this.since < HOLD_MS) return false;
    this.state = callable ? 'fan' : 'late';
    return this.state === 'fan';
  }

  /** The finger moved: it is on this call now (fanChoice), or off the fan (null). */
  point(choice: CallKind | null) {
    if (this.state === 'pending' || this.state === 'fan') this.on = choice;
  }

  /** 1, 2 or 3 while Q is held: that call at once, even before the fan has opened. */
  choose(kind: CallKind, callable: boolean): BPress {
    if (this.state !== 'fan' && !(this.state === 'pending' && callable)) return null;
    this.state = 'spent';
    return { kind: 'call', call: kind };
  }

  /** B let go at `now`: a tap is B; the fan sings the call the finger is on (nothing off it). */
  release(now: number, callable: boolean): BPress {
    // A hold long enough whose fan no frame drew yet still counts.
    this.tick(now, callable);
    const was = this.state;
    this.state = 'up';
    if (was === 'pending' || was === 'late') return { kind: 'b' };
    if (was === 'fan' && this.on) return { kind: 'call', call: this.on };
    return null;
  }

  /** The hold was taken away (the system took the touch, the window lost focus, Escape while Q is held): neither B nor a call. */
  cancel() {
    this.state = 'up';
  }
}

/** The notes a voice can be: a pentatonic scale (D major) over two octaves from A3, in Hz. */
export const VOICES: readonly number[] = [220, 246.94, 293.66, 329.63, 369.99, 440, 493.88, 587.33, 659.26, 739.99];

/** The note a player sings: the same for their id on every screen and every day, so friends learn each other's voices. */
export function voiceOf(id: string): number {
  // FNV-1a, then mixed (murmur3's finalizer): a voice says nothing about the jacket color, which comes from FNV-1a alone (world.ts).
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return VOICES[(h >>> 0) % VOICES.length]!;
}

/** The most a call leans to one side: never all in one ear, which sounds like a fault in headphones. */
export const PAN_MAX = 0.8;

/**
 * Where a call from `dx`, `dy` tiles away plays, from -1 (left) to 1 (right): west on the left, east on
 * the right, as the screen shows them. By its direction, not its distance, so a caller far off due north
 * sounds from the middle; one right beside you leans only a little.
 */
export function callPan(dx: number, dy: number): number {
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return 0;
  return PAN_MAX * (dx / d) * Math.min(1, d / 3);
}

/** A call at the edge of its reach is this loud against one beside you: faint, but still there. */
export const CALL_FAINTEST = 0.12;

/** How loud a call `d` tiles away is (1 beside you): it falls off fast near you, then stays faintly heard to the edge of its reach. */
export function callGain(d: number): number {
  const k = 1 - Math.min(1, Math.max(0, d) / CALL_REACH);
  return CALL_FAINTEST + (1 - CALL_FAINTEST) * k * k;
}

/** Distance dulls a call too, as air takes the highs: the cutoff of its lowpass in Hz, 9 kHz beside you down to 1.8 kHz at the edge. */
export function callTone(d: number): number {
  const k = Math.min(1, Math.max(0, d) / CALL_REACH);
  return Math.round(9000 * Math.pow(1800 / 9000, k));
}

/**
 * One note of a call: when it starts and how long it lasts (seconds), how loud (1 the loudest); for a
 * rising one, how long it holds before it rises and by how much (a factor of its pitch).
 */
export interface CallNote {
  at: number;
  len: number;
  peak: number;
  hold?: number;
  rise?: number;
}

/**
 * How each call is sung, on the caller's own note. Told apart by their shape, never by pitch, which
 * is the caller's: one note; a note held, then rising a fourth; two quick notes, the second softer.
 */
export const CALL_SONGS: Readonly<Record<CallKind, readonly CallNote[]>> = {
  here: [{ at: 0, len: 0.36, peak: 1 }],
  come: [{ at: 0, len: 1.1, peak: 0.9, hold: 0.4, rise: 2 ** (5 / 12) }],
  thanks: [{ at: 0, len: 0.16, peak: 1 }, { at: 0.21, len: 0.26, peak: 0.8 }],
};

/** A note rises over a caller's head for this long (seconds). */
export const CALL_NOTE_S = 1;

/**
 * A call heard longer ago than this (ms) is not sung: only a tab that was hidden, with no frames to
 * play them, lets calls wait, and a crowd of old calls must not sing at once when it comes back.
 */
export const CALL_FRESH_MS = 1000;

/**
 * This client waits a little longer than the server's CALL_EVERY_MS before it sends another call, so
 * one sent just on time never arrives early behind a slower one and is turned away.
 */
export const CALL_SLACK_MS = 150;

/** A call heard, as sound.ts sings it: its shape, the caller's note, and where it came from as pan, loudness and tone. */
export interface CallSound {
  call: CallKind;
  pitch: number;
  pan: number;
  gain: number;
  tone: number;
}

/** A call from `who` sung `dx`, `dy` tiles from where you stand. */
export function callSound(call: CallKind, who: string, dx: number, dy: number): CallSound {
  const d = Math.hypot(dx, dy);
  return { call, pitch: voiceOf(who), pan: callPan(dx, dy), gain: callGain(d), tone: callTone(d) };
}
