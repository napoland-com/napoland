/**
 * The interface over the world: status, the menu, the joystick and A/B, name tags, the text box
 * and the bag. It only draws state and reports input; the rules live in game.ts.
 * There is no map on purpose: napoland is a mapless game, you learn the world by walking it.
 */
import type { Dir } from '@napoland/shared';

const svg = (inner: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON = {
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
};

/** How far the stick must be pushed (fraction of its radius) before it counts as a direction. */
const DEAD_ZONE = 0.35;

export interface HudHandlers {
  pad(dir: Dir | null): void;
  a(): void;
  b(): void;
  dialogTap(): void;
  logout(): void;
}

export interface TagView { id: string; name: string; x: number; y: number }
export interface FloatView { id: number; text: string; color: string; x: number; y: number; t: number }
export interface DialogView { who: string; text: string; done: boolean }

export class Hud {
  readonly root: HTMLElement;
  private el: Record<string, HTMLElement>;
  private tagEls = new Map<string, HTMLElement>();
  private floatEls = new Map<number, HTMLElement>();

  constructor(parent: HTMLElement, private h: HudHandlers) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="status panel"><div class="name"><span data-el="name">...</span><span data-el="online"></span></div>
        <div class="sub"><span class="conn" data-el="conn" data-state="connecting"><i></i><span data-el="connText">Connecting</span></span><span data-el="ping"></span></div></div>
      <button type="button" class="menu-btn" data-el="menuBtn" aria-label="Menu" aria-expanded="false">${ICON.menu}</button>
      <div class="menu-panel panel" data-el="menu" hidden>
        <button type="button" data-el="menuBag">Bag</button>
        <button type="button" data-el="menuLogout">Log out</button>
      </div>
      <div class="labels" data-el="labels"></div>
      <div class="floats" data-el="floats"></div>
      <div class="stick" data-el="stick" role="group" aria-label="Movement stick"><div class="knob" data-el="knob"></div></div>
      <div class="ab"><button type="button" class="b" data-el="b" aria-label="B: bag and back">B</button><button type="button" class="a" data-el="a" aria-label="A: pick up, talk, open">A</button></div>
      <div class="dialog panel" data-el="dialog" role="dialog" aria-live="polite"><div class="who panel" data-el="who"></div><div data-el="text"></div><div class="more" data-el="more" aria-hidden="true">&#9660;</div></div>
      <div class="sheet panel" data-el="sheet" data-open="false" role="dialog" aria-label="Bag"><div class="sheet-head"><b>Bag</b><button type="button" class="close" data-el="close" aria-label="Close the bag">${ICON.x}</button></div>
        <div class="grid">${'<div class="slot"></div>'.repeat(8)}</div><p class="hint">Your bag is empty. Things you find out there go here, and you keep them only if you bring them home.</p></div>`;
    parent.appendChild(this.root);
    this.el = {};
    for (const node of this.root.querySelectorAll<HTMLElement>('[data-el]')) this.el[node.dataset.el!] = node;
    this.bindInput();
  }

  private bindInput() {
    const stick = this.el.stick!, knob = this.el.knob!;
    let pid = -1, current: Dir | null = null;
    const move = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect();
      let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      knob.style.transform = `translate(${(dx * r.width * 0.29).toFixed(1)}px, ${(dy * r.height * 0.29).toFixed(1)}px)`;
      // The world is walked tile by tile, so the stick picks one of four directions.
      const dir: Dir | null = m < DEAD_ZONE ? null : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      if (dir !== current) { current = dir; this.h.pad(dir); }
    };
    stick.addEventListener('pointerdown', e => {
      e.preventDefault();
      pid = e.pointerId;
      stick.classList.add('active');
      try { stick.setPointerCapture(e.pointerId); } catch { /* not all browsers allow it */ }
      move(e);
    });
    stick.addEventListener('pointermove', e => { if (e.pointerId === pid) move(e); });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      pid = -1;
      stick.classList.remove('active');
      knob.style.transform = '';
      if (current) { current = null; this.h.pad(null); }
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
    stick.addEventListener('lostpointercapture', end);
    this.el.a!.addEventListener('click', () => this.h.a());
    this.el.b!.addEventListener('click', () => this.h.b());
    this.el.dialog!.addEventListener('click', () => this.h.dialogTap());
    this.el.close!.addEventListener('click', () => this.toggleBag(false));
    this.el.menuBtn!.addEventListener('click', () => this.toggleMenu());
    this.el.menuBag!.addEventListener('click', () => { this.toggleMenu(false); this.toggleBag(true); });
    this.el.menuLogout!.addEventListener('click', () => { this.toggleMenu(false); this.h.logout(); });
  }

  get bagOpen(): boolean {
    return this.el.sheet!.dataset.open === 'true';
  }
  toggleBag(open = !this.bagOpen) {
    this.el.sheet!.dataset.open = String(open);
  }
  get menuOpen(): boolean {
    return !this.el.menu!.hidden;
  }
  toggleMenu(open = !this.menuOpen) {
    this.el.menu!.hidden = !open;
    this.el.menuBtn!.setAttribute('aria-expanded', String(open));
  }

  setName(name: string) { this.el.name!.textContent = name; }
  setOnline(n: number) { this.el.online!.textContent = n > 1 ? `${n} online` : ''; }
  setConnection(state: 'connecting' | 'online' | 'offline', pingMs?: number) {
    this.el.conn!.dataset.state = state;
    this.el.connText!.textContent = state === 'online' ? 'Online' : state === 'connecting' ? 'Connecting' : 'Reconnecting';
    this.el.ping!.textContent = state === 'online' && pingMs !== undefined ? `${Math.round(pingMs)} ms` : '';
  }

  setDialog(d: DialogView | null) {
    this.root.classList.toggle('talking', !!d);
    if (!d) return;
    this.el.who!.textContent = d.who;
    this.el.text!.textContent = d.text;
    this.el.more!.style.visibility = d.done ? 'visible' : 'hidden';
  }

  /** Name tags above other players, positioned in screen pixels. */
  setTags(tags: TagView[]) {
    const seen = new Set<string>();
    for (const t of tags) {
      seen.add(t.id);
      let el = this.tagEls.get(t.id);
      if (!el) { el = document.createElement('div'); el.className = 'tag'; this.el.labels!.appendChild(el); this.tagEls.set(t.id, el); }
      if (el.textContent !== t.name) el.textContent = t.name;
      el.style.transform = `translate(${t.x.toFixed(1)}px, ${t.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (const [id, el] of this.tagEls) if (!seen.has(id)) { el.remove(); this.tagEls.delete(id); }
  }

  setFloats(floats: FloatView[]) {
    const seen = new Set<number>();
    for (const f of floats) {
      seen.add(f.id);
      let el = this.floatEls.get(f.id);
      if (!el) { el = document.createElement('div'); el.className = 'float'; el.textContent = f.text; el.style.color = f.color; this.el.floats!.appendChild(el); this.floatEls.set(f.id, el); }
      el.style.transform = `translate(${f.x.toFixed(1)}px, ${(f.y - f.t * 30).toFixed(1)}px) translate(-50%, -100%)`;
      el.style.opacity = String(Math.max(0, 1 - Math.pow(f.t / 1.3, 3)));
    }
    for (const [id, el] of this.floatEls) if (!seen.has(id)) { el.remove(); this.floatEls.delete(id); }
  }
}
