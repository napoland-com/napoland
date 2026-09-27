/**
 * The interface over the world: status and energy, the menu, the joystick and A/B, name tags,
 * the text box, the bag, the About panel, and the fade and name banner when you arrive somewhere.
 * It only draws state and reports input; the rules live in game.ts.
 * There is no map on purpose: napoland is a mapless game, you learn the world by walking it.
 */
import { BAG_SLOTS, type Dir, type EnergyView } from '@napoland/shared';
import { aboutBody, versionView } from './about';
import { itemIcon } from './icons';
import type { SlotView } from './items';

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
/** How long the name of a place stays up after you arrive; longer news stays longer, to be read. */
const BANNER_MS = 2500;
const BANNER_MS_PER_CHAR = 45;

export interface HudHandlers {
  pad(dir: Dir | null): void;
  a(): void;
  b(): void;
  dialogTap(): void;
  logout(): void;
  /** Use what is in bag slot `slot` (only offered for consumables). */
  use(slot: number): void;
  /** Throw away everything in bag slot `slot` (asked once first). */
  discard(slot: number): void;
  /** The version the server runs, for the About panel (null: none shown). Asked once, when the panel first opens. */
  version(): Promise<string | null>;
}

/** What the bag asks before throwing a slot away. */
export function tossQuestion(count: number): string {
  return count > 1 ? `Throw all ${count} away?` : 'Throw it away?';
}

/** How long a banner stays up: long enough to read what it says. */
export function bannerMs(title: string, sub: string): number {
  return Math.max(BANNER_MS, 1200 + (title.length + sub.length) * BANNER_MS_PER_CHAR);
}

const EMPTY_BAG = 'Your bag is empty. Things you find out there go here, and you keep them only if you bring them home.';
const PICK_SLOT = 'Tap something to see what it is.';

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

/** A name over someone's head, or over a pile (whose it is) while you are near it. */
export interface TagView { id: string; name: string; x: number; y: number; pile?: boolean }
/** `row` stacks words said at once, 0 at the bottom. */
export interface FloatView { id: number; text: string; color: string; x: number; y: number; t: number; row: number }
export interface DialogView { who: string; text: string; done: boolean }

export class Hud {
  readonly root: HTMLElement;
  private el: Record<string, HTMLElement>;
  private tagEls = new Map<string, HTMLElement>();
  private floatEls = new Map<number, HTMLElement>();
  /** What the energy bar, vignette and fade show now, so a frame only touches the page when something changed. */
  private shown = { fill: -1, level: '', refill: false, pct: -1, vignette: -1, dark: -1 };
  private bannerTimer: ReturnType<typeof setTimeout> | undefined;
  private slotEls: HTMLButtonElement[] = [];
  /** The bag as shown, the slot whose details are open (and the item in it), and whether throwing it away is being asked. */
  private bag: SlotView[] = [];
  private picked: { slot: number; item: string } | null = null;
  private asking = false;
  private versionAsked = false;

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
        <button type="button" data-el="menuAbout">About</button>
        <button type="button" data-el="menuLogout">Log out</button>
      </div>
      <div class="stick" data-el="stick" role="group" aria-label="Movement stick"><div class="knob" data-el="knob"></div></div>
      <div class="ab"><button type="button" class="b" data-el="b" aria-label="B: bag and back">B</button><button type="button" class="a" data-el="a" aria-label="A: pick up, talk, open">A</button></div>
      <div class="dialog panel" data-el="dialog" role="dialog" aria-live="polite"><div class="who panel" data-el="who"></div><div data-el="text"></div><div class="more" data-el="more" aria-hidden="true">&#9660;</div></div>
      <div class="sheet panel" data-el="sheet" data-open="false" role="dialog" aria-label="Bag">
        <div class="sheet-head"><b>Bag</b><span class="room" data-el="room"></span><button type="button" class="close" data-el="close" aria-label="Close the bag">${ICON.x}</button></div>
        <div class="grid" data-el="grid">${Array.from({ length: BAG_SLOTS }, (_, i) => `<button type="button" class="slot" data-slot="${i}" data-empty="true" aria-label="Empty slot"></button>`).join('')}</div>
        <div class="detail" data-el="detail" aria-live="polite">
          <p class="hint" data-el="hint">${EMPTY_BAG}</p>
          <div class="about" data-el="about" hidden><div class="big" data-el="bigIcon"></div>
            <div class="words"><div class="title"><b data-el="itemName"></b><span class="count" data-el="itemCount"></span></div><p data-el="itemText"></p></div></div>
          <div class="acts" data-el="acts" hidden><button type="button" class="act go" data-el="use">Use</button><button type="button" class="act toss" data-el="toss">Throw away</button></div>
          <div class="acts" data-el="ask" hidden><span class="ask" data-el="askText"></span><button type="button" class="act toss sure" data-el="tossYes">Throw away</button><button type="button" class="act" data-el="tossNo">Keep</button></div>
        </div>
      </div>
      <div class="sheet panel about-sheet" data-el="aboutSheet" data-open="false" role="dialog" aria-label="About napoland">
        <div class="sheet-head"><b>About</b><button type="button" class="close" data-el="aboutClose" aria-label="Close About">${ICON.x}</button></div>
        ${aboutBody()}
      </div>`;
    parent.appendChild(this.root);
    this.el = {};
    for (const node of this.root.querySelectorAll<HTMLElement>('[data-el]')) this.el[node.dataset.el!] = node;
    this.slotEls = [...this.root.querySelectorAll<HTMLButtonElement>('.slot')];
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
    this.el.menuAbout!.addEventListener('click', () => { this.toggleMenu(false); this.toggleAbout(true); });
    this.el.aboutClose!.addEventListener('click', () => this.toggleAbout(false));
    this.el.menuLogout!.addEventListener('click', () => { this.toggleMenu(false); this.h.logout(); });
    this.el.grid!.addEventListener('click', e => {
      const slot = (e.target as Element).closest<HTMLElement>('[data-slot]');
      if (!slot) return;
      const i = Number(slot.dataset.slot);
      // Tapping the open slot again, or an empty one, closes the details.
      this.choose(this.bag[i] && this.picked?.slot !== i ? i : null);
    });
    this.el.use!.addEventListener('click', () => { if (this.picked) this.h.use(this.picked.slot); });
    this.el.toss!.addEventListener('click', () => { this.asking = true; this.showDetail(); });
    this.el.tossNo!.addEventListener('click', () => { this.asking = false; this.showDetail(); });
    this.el.tossYes!.addEventListener('click', () => {
      if (!this.picked) return;
      this.h.discard(this.picked.slot);
      this.choose(null);
    });
  }

  get bagOpen(): boolean {
    return this.el.sheet!.dataset.open === 'true';
  }
  toggleBag(open = !this.bagOpen) {
    // The bag and the About panel open in the same place: one at a time.
    if (open) this.toggleAbout(false);
    this.el.sheet!.dataset.open = String(open);
    // It opens on the whole bag, never on the details left from last time.
    this.choose(null);
  }

  get aboutOpen(): boolean {
    return this.el.aboutSheet!.dataset.open === 'true';
  }
  toggleAbout(open = !this.aboutOpen) {
    if (open && this.bagOpen) this.toggleBag(false);
    this.el.aboutSheet!.dataset.open = String(open);
    if (open && !this.versionAsked) {
      this.versionAsked = true;
      this.h.version().then(v => this.showVersion(v), () => { /* the panel then shows no version */ });
    }
  }

  /** The version under the About panel's small print; a release links to exactly its code. */
  private showVersion(version: string | null) {
    if (!version) return;
    const { text, href } = versionView(version);
    const line = this.el.version!;
    if (href) {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = text;
      line.replaceChildren(a);
    } else {
      line.textContent = text;
    }
    line.hidden = false;
  }

  /** B in the bag: out of the question, then out of the details. False when there is nothing to back out of (B closes the bag). */
  back(): boolean {
    if (!this.bagOpen) return false;
    if (this.asking) { this.asking = false; this.showDetail(); return true; }
    if (this.picked) { this.choose(null); return true; }
    return false;
  }

  /** The bag, slot by slot (the server's order). Call it when the bag changes. */
  setBag(slots: SlotView[]) {
    this.bag = slots;
    // Details stay open while their slot still holds the same item (a thermos used: one fewer).
    if (this.picked && slots[this.picked.slot]?.item !== this.picked.item) this.picked = null;
    this.slotEls.forEach((el, i) => {
      const s = slots[i];
      el.dataset.empty = String(!s);
      el.innerHTML = s ? `${itemIcon(s.item)}<span class="n">${s.count}</span>` : '';
      el.setAttribute('aria-label', s ? `${s.name}, ${s.count}` : 'Empty slot');
    });
    this.el.room!.textContent = `${slots.length} of ${BAG_SLOTS}`;
    this.showDetail();
  }

  private choose(slot: number | null) {
    const s = slot === null ? undefined : this.bag[slot];
    this.picked = s ? { slot: slot!, item: s.item } : null;
    this.asking = false;
    this.showDetail();
  }

  /** Under the slots: what the open slot holds and what can be done with it, or a hint. */
  private showDetail() {
    const p = this.picked, s = p ? this.bag[p.slot] : undefined;
    this.slotEls.forEach((el, i) => el.toggleAttribute('data-picked', i === p?.slot));
    this.el.hint!.hidden = !!s;
    this.el.about!.hidden = this.el.acts!.hidden = this.el.ask!.hidden = true;
    if (!s) {
      this.el.hint!.textContent = this.bag.length ? PICK_SLOT : EMPTY_BAG;
      return;
    }
    this.el.about!.hidden = false;
    this.el.bigIcon!.innerHTML = itemIcon(s.item);
    this.el.itemName!.textContent = s.name;
    this.el.itemCount!.textContent = s.count > 1 ? `× ${s.count}` : '';
    this.el.itemText!.textContent = s.text;
    if (this.asking) {
      this.el.ask!.hidden = false;
      this.el.askText!.textContent = tossQuestion(s.count);
    } else {
      this.el.acts!.hidden = false;
      this.el.use!.hidden = !s.usable;
    }
  }

  get menuOpen(): boolean {
    return !this.el.menu!.hidden;
  }
  toggleMenu(open = !this.menuOpen) {
    this.el.menu!.hidden = !open;
    this.el.menuBtn!.setAttribute('aria-expanded', String(open));
  }

  setName(name: string) { this.el.name!.textContent = name; }
  /** "Sign out" with sign-in; "Log out" without, where it forgets the character's token. */
  setLogoutLabel(label: string) { this.el.menuLogout!.textContent = label; }
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

  /** The name of where you arrived (or what happened), for a few seconds. A line break in `sub` starts a new line. */
  showBanner(title: string, sub = '') {
    const banner = this.el.banner!;
    this.el.bannerTitle!.textContent = title;
    this.el.bannerSub!.textContent = sub;
    this.el.bannerSub!.hidden = !sub;
    banner.toggleAttribute('data-show', true);
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => banner.toggleAttribute('data-show', false), bannerMs(title, sub));
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

  /** Name tags above other players and near piles, positioned in screen pixels. */
  setTags(tags: TagView[]) {
    const seen = new Set<string>();
    for (const t of tags) {
      seen.add(t.id);
      let el = this.tagEls.get(t.id);
      if (!el) { el = document.createElement('div'); el.className = t.pile ? 'tag pile' : 'tag'; this.el.labels!.appendChild(el); this.tagEls.set(t.id, el); }
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
      // Several at once stand in a column, a line apart, and rise together.
      el.style.transform = `translate(${f.x.toFixed(1)}px, ${(f.y - f.t * 30).toFixed(1)}px) translate(-50%, calc(-100% - ${f.row * 1.15}em))`;
      el.style.opacity = String(Math.max(0, 1 - Math.pow(f.t / 1.3, 3)));
    }
    for (const [id, el] of this.floatEls) if (!seen.has(id)) { el.remove(); this.floatEls.delete(id); }
  }
}
