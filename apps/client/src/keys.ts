/**
 * The keyboard, on a computer: WASD and the arrow keys are the joystick, E or Space is A, Q or Escape
 * is B, Enter opens the chat, as in Metin2 (in the chat's line Enter sends, and on an empty line closes
 * the chat again: hud.ts), and M opens the map of where you are. Keys are read by where they sit
 * (`KeyboardEvent.code`), so WASD and the Q and E beside it are the same keys on any layout (ZQSD, A
 * and E on a French one). M stands for the map, so it goes by the letter it types instead (`mapKey`).
 * Nothing ever needs the keyboard: the game stays mobile-first.
 *
 * The keys feed the same handlers as the stick and the buttons, so a direction keeps the stick's rules
 * (a quick tap on a new direction turns in place, holding walks). With several direction keys held,
 * the last one pressed wins; letting it go falls back to the one held before. Plain logic with no
 * page in it, so it can be tested; main.ts listens to the window and passes the events on.
 */
import type { Dir } from '@napoland/shared';

const DIRS: Readonly<Record<string, Dir>> = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
};
const A_KEYS = new Set(['KeyE', 'Space']);
const B_KEYS = new Set(['KeyQ', 'Escape']);
const CHAT_KEYS = new Set(['Enter', 'NumpadEnter']);
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
    // A focused button answers Enter and Space on its own; a held key repeating is not a new press.
    if (target === 'control' && PRESS_KEYS.has(code)) return false;
    const press = A_KEYS.has(code) ? this.h.a : B_KEYS.has(code) ? this.h.b : CHAT_KEYS.has(code) ? this.h.openChat : mapKey(code, key) ? this.h.openMap : undefined;
    if (!press) return false;
    if (!repeat) press.call(this.h);
    return true;
  }

  up(code: string) {
    const i = this.held.indexOf(code);
    if (i < 0) return;
    this.held.splice(i, 1);
    this.update();
  }

  /** The window lost focus: whatever was held is let go, so nobody keeps walking. */
  clear() {
    this.held = [];
    this.update();
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
