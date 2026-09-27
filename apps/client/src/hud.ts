/**
 * The interface over the world: status and energy, the menu, the joystick and A/B, name tags,
 * the text box, the bag, and the fade and name banner when you arrive somewhere.
 * It only draws state and reports input; the rules live in game.ts.
 * There is no map on purpose: napoland is a mapless game, you learn the world by walking it.
 */
import type { Dir, EnergyView } from '@napoland/shared';

const svg = (inner: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON = {
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  bolt: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.5 2 4 13.5h6.5L9 22l10-12h-6.6z"/></svg>`,
};

/** How far the stick must be pushed (fraction of its radius) before it counts as a direction. */
const DEAD_ZONE = 0.35;
/** Energy below this share turns the bar red; below CRITICAL it pulses. */
const LOW = 0.25;
const CRITICAL = 0.1;
/** Below this share of energy the screen edges darken, more as it runs out. */
const VIGNETTE_FROM = 0.2;
/** How long the name of a place stays up after you arrive. */
const BANNER_MS = 2500;

export interface HudHandlers {
  pad(dir: Dir | null): void;
  a(): void;
  b(): void;
  dialogTap(): void;
  logout(): void;
}

/** What the energy bar and the screen's edges show for a player's energy. */
export interface EnergyLook {
  /** Share of the bar that is full, 0 to 1. */
  fill: number;
  level: 'ok' | 'low' | 'critical';
  /**
   * Energy is coming back (next to a fire): the bar gets a bright tip. Holding (rate 0, in town and
   * inside) shows neither refilling nor draining, and a full bar has nothing left to refill.
   */
  refill: boolean;
  /** How dark the screen's edges are, 0 to 1. */
  vignette: number;
}

export function energyLook(e: EnergyView | null): EnergyLook {
  const f = e && e.max > 0 ? Math.min(1, Math.max(0, e.value / e.max)) : 1;
  return {
    fill: Math.round(f * 1000) / 1000,
    level: f < CRITICAL ? 'critical' : f < LOW ? 'low' : 'ok',
    refill: !!e && e.rate > 0 && f < 1,
    vignette: e ? Math.round(Math.min(1, Math.max(0, (VIGNETTE_FROM - f) / VIGNETTE_FROM)) * 200) / 200 : 0,
  };
}

export interface TagView { id: string; name: string; x: number; y: number }
export interface FloatView { id: number; text: string; color: string; x: number; y: number; t: number }
export interface DialogView { who: string; text: string; done: boolean }

export class Hud {
  readonly root: HTMLElement;
  private el: Record<string, HTMLElement>;
  private tagEls = new Map<string, HTMLElement>();
  private floatEls = new Map<number, HTMLElement>();
  /** What the energy bar, vignette and fade show now, so a frame only touches the page when something changed. */
  private shown = { fill: -1, level: '', refill: false, pct: -1, vignette: -1, dark: -1 };
  private bannerTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(parent: HTMLElement, private h: HudHandlers) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    // Order matters: later elements are drawn on top. Name tags, the vignette and the fade belong to
    // the world; the panels and controls stay above them, so they never go dark or get covered.
    this.root.innerHTML = `
      <div class="labels" data-el="labels"></div>
      <div class="floats" data-el="floats"></div>
      <div class="vignette" data-el="vignette"></div>
      <div class="fade" data-el="fade"></div>
      <div class="banner panel" data-el="banner" role="status" aria-live="polite"><b data-el="bannerTitle"></b><span data-el="bannerSub"></span></div>
      <div class="status panel"><div class="name"><span data-el="name">...</span><span data-el="online"></span></div>
        <div class="energy" data-el="energy" hidden>${ICON.bolt}<div class="bar" data-el="energyBar" role="meter" aria-label="Energy" aria-valuemin="0" aria-valuemax="100"><div class="fill" data-el="energyFill"></div></div></div>
        <div class="sub"><span class="conn" data-el="conn" data-state="connecting"><i></i><span data-el="connText">Connecting</span></span><span data-el="ping"></span></div></div>
      <button type="button" class="menu-btn" data-el="menuBtn" aria-label="Menu" aria-expanded="false">${ICON.menu}</button>
      <div class="menu-panel panel" data-el="menu" hidden>
        <button type="button" data-el="menuBag">Bag</button>
        <button type="button" data-el="menuLogout">Log out</button>
      </div>
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
  /** Players on your map, you included (the server only tells us about the map you are on). */
  setOnline(n: number) { this.el.online!.textContent = n > 1 ? `${n} here` : ''; }

  /**
   * The energy bar under your name, and the dark edges of the screen when it runs low. Called
   * every frame, so it only writes to the page when what is shown changes.
   */
  setEnergy(e: EnergyView | null) {
    const s = this.shown, bar = this.el.energy!, vignette = this.el.vignette!;
    if (bar.hidden !== !e) bar.hidden = !e;
    const { fill, level, refill, vignette: v } = energyLook(e);
    if (fill !== s.fill) {
      s.fill = fill;
      // Sliding a full-width fill (not resizing it) keeps the work off the layout.
      this.el.energyFill!.style.transform = `translateX(${((fill - 1) * 100).toFixed(1)}%)`;
    }
    if (level !== s.level) bar.dataset.level = s.level = level;
    if (refill !== s.refill) bar.toggleAttribute('data-refill', (s.refill = refill));
    const pct = Math.round(fill * 100);
    if (pct !== s.pct) this.el.energyBar!.setAttribute('aria-valuenow', String((s.pct = pct)));
    if (v !== s.vignette) {
      s.vignette = v;
      vignette.style.visibility = v > 0 ? 'visible' : 'hidden';
      vignette.style.opacity = String(v);
      // Scaled up, the dark edge sits off screen; as energy runs out it closes in.
      vignette.style.transform = `scale(${(1.35 - 0.35 * v).toFixed(3)})`;
    }
  }

  /** How dark the world is (0 to 1) while you move between maps. The HUD stays above it. */
  setFade(dark: number) {
    const d = Math.round(dark * 100) / 100;
    if (d === this.shown.dark) return;
    this.shown.dark = d;
    const fade = this.el.fade!;
    fade.style.visibility = d > 0 ? 'visible' : 'hidden';
    fade.style.opacity = String(d);
  }

  /** The name of where you arrived (or what happened), for a couple of seconds. */
  showBanner(title: string, sub = '') {
    const banner = this.el.banner!;
    this.el.bannerTitle!.textContent = title;
    this.el.bannerSub!.textContent = sub;
    this.el.bannerSub!.hidden = !sub;
    banner.toggleAttribute('data-show', true);
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => banner.toggleAttribute('data-show', false), BANNER_MS);
  }
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
