/**
 * The keyboard, on a computer: WASD and the arrow keys are the joystick, E or Space is A, Q or Escape
 * is B, Enter opens the chat, as in Metin2 (in the chat's line Enter sends, and on an empty line closes
 * the chat again: hud.ts), and M opens the map of where you are. Q held is B held, as on the screen: a
 * call once long enough (calls.ts), and 1, 2 or 3 meanwhile sing here I am, come here or thank you;
 * Escape while Q is held calls nothing. Keys are read by where they sit (`KeyboardEvent.code`), so
 * WASD, the Q and E beside it and the digits above are the same keys on any layout (ZQSD, A and E on
 * a French one). M stands for the map, so it goes by the letter it types instead (`mapKey`).
 * Nothing ever needs the keyboard: the game stays mobile-first.
 *
 * The keys feed the same handlers as the stick and the buttons, so a direction keeps the stick's rules
 * (a quick tap on a new direction turns in place, holding walks). With several direction keys held,
 * the last one pressed wins; letting it go falls back to the one held before. Plain logic with no
 * page in it, so it can be tested; main.ts listens to the window and passes the events on.
 */
import type { CallKind, Dir } from '@napoland/shared';

const DIRS: Readonly<Record<string, Dir>> = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
};
const A_KEYS = new Set(['KeyE', 'Space']);
const B_KEYS = new Set(['KeyQ', 'Escape']);
const CHAT_KEYS = new Set(['Enter', 'NumpadEnter']);
/** Q held is B held (a call, once long enough); Escape stays a plain B, and cancels a call Q holds. */
const HOLD_KEY = 'KeyQ';
/** While Q is held: the call each digit sings, in the fan's order. */
const CALL_KEYS: Readonly<Record<string, CallKind>> = { Digit1: 'here', Digit2: 'come', Digit3: 'thanks', Numpad1: 'here', Numpad2: 'come', Numpad3: 'thanks' };
/** The keys a focused button answers on its own: it presses itself. */
const PRESS_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']);

export interface KeyHandlers {
  pad(dir: Dir | null): void;
  a(): void;
  b(): void;
  /** Enter: the chat, with its line ready to type in. */
  openChat(): void;
  /** M: the paper map of the area you are in. */
  openMap(): void;
  /** Q went down (true) or came up (false): B held, a call once long enough. Without it, Q is B at once. */
  holdB?(on: boolean): void;
  /** 1, 2 or 3 while Q is held: that call. */
  call?(kind: CallKind): void;
  /** Escape while Q is held, or the window lost focus with Q down: no call, and no B. */
  cancelCall?(): void;
}

/** Where a key went: a field to type in (the game keeps out), a button or a link (it answers Enter itself), or the page. */
export type KeyTarget = 'text' | 'control' | 'page';

/**
 * Whether a key is M, for the map. It goes by the letter the key types (`key`), because layouts put M
 * in different places: on a French one it sits right of L, and the key in its place types a comma. A
 * layout that types no Latin letters (Cyrillic, Greek) goes by where M sits, and so does an event
 * without its letter.
 */
export function mapKey(code: string, key = ''): boolean {
  if (/^[a-z]$/i.test(key)) return key.toLowerCase() === 'm';
  return code === 'KeyM' && !/^[\x20-\x7e]$/.test(key);
}

export class Keys {
  /** Direction keys held, oldest first (by code, so W and the up arrow are two keys). */
  private held: string[] = [];
  private shown: Dir | null = null;
  /** Q is down, held as B (holdB). */
  private q = false;

  constructor(private readonly h: KeyHandlers) {}

  /**
   * A key went down. Returns true when the game used it (the caller then stops the page from
   * scrolling on Space). Ignored with Ctrl, Alt or Cmd held (the browser's own shortcuts), and while
   * typing in a field. `key` is the letter the key types, for M (mapKey).
   */
  down(code: string, target: KeyTarget, repeat = false, modified = false, key = ''): boolean {
    if (modified || target === 'text') return false;
    const dir = DIRS[code];
    if (dir) {
      if (!this.held.includes(code)) this.held.push(code);
      this.update();
      return true;
    }
    if (code === HOLD_KEY && this.h.holdB) {
      if (!this.q) {
        this.q = true;
        this.h.holdB(true);
      }
      return true;
    }
    if (this.q) {
      const call = CALL_KEYS[code];
      if (call) {
        if (!repeat) this.h.call?.(call);
        return true;
      }
      if (code === 'Escape') {
        this.h.cancelCall?.();
        return true;
      }
    }
    // A focused button answers Enter and Space on its own; a held key repeating is not a new press.
    if (target === 'control' && PRESS_KEYS.has(code)) return false;
    const press = A_KEYS.has(code) ? this.h.a : B_KEYS.has(code) ? this.h.b : CHAT_KEYS.has(code) ? this.h.openChat : mapKey(code, key) ? this.h.openMap : undefined;
    if (!press) return false;
    if (!repeat) press.call(this.h);
    return true;
  }

  up(code: string) {
    if (code === HOLD_KEY && this.q) {
      this.q = false;
      this.h.holdB?.(false);
      return;
    }
    const i = this.held.indexOf(code);
    if (i < 0) return;
    this.held.splice(i, 1);
    this.update();
  }

  /** The window lost focus: whatever was held is let go, so nobody keeps walking, and a call Q held is not sung. */
  clear() {
    this.held = [];
    this.update();
    if (this.q) {
      this.q = false;
      this.h.cancelCall?.();
    }
  }

  private update() {
    const code = this.held.at(-1);
    const dir = code ? DIRS[code]! : null;
    if (dir === this.shown) return;
    this.shown = dir;
    this.h.pad(dir);
  }
}

/** What kind of element a key went to (read from its tag, so it needs no page to be tested). */
export function keyTarget(el: EventTarget | null): KeyTarget {
  const e = el as { tagName?: unknown; isContentEditable?: unknown } | null;
  const tag = typeof e?.tagName === 'string' ? e.tagName.toUpperCase() : '';
  if (e?.isContentEditable === true || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return 'text';
  if (tag === 'BUTTON' || tag === 'A') return 'control';
  return 'page';
}
