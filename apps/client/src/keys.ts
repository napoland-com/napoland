/**
 * The keyboard, on a computer: WASD and the arrow keys are the joystick, Enter is A and Backspace is
 * B, and M opens the map of where you are. Keys are read by where they sit (`KeyboardEvent.code`),
 * so WASD is the same four keys on any layout (ZQSD on a French one). Nothing ever needs the
 * keyboard: the game stays mobile-first.
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
const A_KEYS = new Set(['Enter', 'NumpadEnter']);
const B_KEYS = new Set(['Backspace']);
const MAP_KEYS = new Set(['KeyM']);

export interface KeyHandlers {
  pad(dir: Dir | null): void;
  a(): void;
  b(): void;
  /** M: the paper map of the area you are in. */
  openMap(): void;
}

/** Where a key went: a field to type in (the game keeps out), a button or a link (it answers Enter itself), or the page. */
export type KeyTarget = 'text' | 'control' | 'page';

export class Keys {
  /** Direction keys held, oldest first (by code, so W and the up arrow are two keys). */
  private held: string[] = [];
  private shown: Dir | null = null;

  constructor(private readonly h: KeyHandlers) {}

  /**
   * A key went down. Returns true when the game used it (the caller then stops the page from
   * scrolling, or from going back on Backspace). Ignored with Ctrl, Alt or Cmd held (the browser's
   * own shortcuts), and while typing in a field.
   */
  down(code: string, target: KeyTarget, repeat = false, modified = false): boolean {
    if (modified || target === 'text') return false;
    const dir = DIRS[code];
    if (dir) {
      if (!this.held.includes(code)) this.held.push(code);
      this.update();
      return true;
    }
    // A focused button answers Enter on its own; a held key repeating is not a new press.
    if (A_KEYS.has(code)) {
      if (target === 'control') return false;
      if (!repeat) this.h.a();
      return true;
    }
    if (B_KEYS.has(code)) {
      if (!repeat) this.h.b();
      return true;
    }
    if (MAP_KEYS.has(code)) {
      if (!repeat) this.h.openMap();
      return true;
    }
    return false;
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
