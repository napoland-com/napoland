/**
 * The interface over the world: status and energy (and how wet you are, and what clings to you), the
 * surge clock, the menu with the status and About panels, the joystick and A/B, name tags, the text
 * box, the bag, and the fade and name banner when you arrive somewhere.
 * It only draws state and reports input; the rules live in game.ts.
 * There is no map on purpose: napoland is a mapless game, you learn the world by walking it.
 */
import { BAG_SLOTS, SLOTS, type BodyView, type Dir, type EnergyView, type Slot, type SurgeView } from '@napoland/shared';
import { aboutBody, versionView } from './about';
import type { SlotView } from './items';

const svg = (inner: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON = {
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  bolt: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.5 2 4 13.5h6.5L9 22l10-12h-6.6z"/></svg>`,
  drop: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5C9 7 5.5 10.6 5.5 14.6a6.5 6.5 0 0 0 13 0c0-4-3.5-7.6-6.5-12.1z"/></svg>`,
  cling: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3c-4.4 0-7 3.3-7 7.6V21l2.3-1.8L9.6 21l2.4-1.8 2.4 1.8 2.3-1.8L19 21V10.6C19 6.3 16.4 3 12 3zm-3 8.2a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8zm6 0a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8z"/></svg>`,
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
  /** The status panel opened: fill it (setStatus), and keep it current while it is open. */
  status?(): void;
  /** In the open stash: put bag slot `slot` in (or everything, left out), take a stack of an item out, or close it. */
  store?(slot?: number): void;
  take?(item: string): void;
  stashClosed?(): void;
  /** At the chest: put on gear from the stash, take off what a slot wears. At the workbench: make a recipe, or close it. */
  equip?(item: string): void;
  unequip?(slot: Slot): void;
  craft?(recipe: string): void;
  benchClosed?(): void;
  /** A tool in the bag's header was tapped (a paper map: open it). */
  tool?(item: string): void;
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

/** "3:05": minutes and seconds, for the surge clock. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** What the surge pill says, and how it looks: nothing while calm. `caught`: the front is over you. */
export function surgeLook(s: SurgeView | null, caught: boolean): { text: string; level: 'restless' | 'surge' | 'caught' } | null {
  if (!s || s.phase === 'calm') return null;
  if (s.phase === 'unstable') return { text: `Restless. A surge in ${clock(s.left)}`, level: 'restless' };
  return caught ? { text: `Caught in the surge! Find a light. ${clock(s.left)}`, level: 'caught' } : { text: `Surge! It sweeps toward home. ${clock(s.left)}`, level: 'surge' };
}

/** What the bag's header says: slots used, and the load once there is some to speak of. */
export function roomText(slots: number, load: number, capacity: number = BAG_SLOTS): string {
  const room = `${slots} of ${capacity}`;
  if (load < 0.05) return room;
  return `${room} · ${load >= 1 ? 'heavy' : `load ${Math.round(load * 100)}%`}`;
}

/** The most slots a bag can have: the grids hold this many, and show as many as the bag worn has. */
export const MAX_BAG = 16;

/** A slot of what you wear, as the stash sheet shows it: the piece's name and drawing, or bare. */
export interface WornView { slot: Slot; name: string; icon: string }
/** A recipe as the workbench shows it: what it makes, what it needs against what your stash holds. */
export interface RecipeView { id: string; name: string; icon: string; facts: string; needs: Array<{ name: string; icon: string; have: number; need: number }>; can: boolean }

/** One row of the status panel: a label, what it says, and a bar (0 to 1) when it has one. */
export interface StatusRow { label: string; text: string; bar?: number; tone?: 'good' | 'bad' | 'plain' }
/** The status panel: rows about you, then a section per feat. */
export interface StatusView { rows: StatusRow[]; feats: Array<{ name: string; text: string; done: boolean; progress: number }> }

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
  private shown = { fill: -1, level: '', refill: false, pct: -1, vignette: -1, dark: -1, wet: -1, wetShown: false, hitched: false, surge: '', surgeLevel: '', surgeGlow: -1, room: '', status: '', stash: '', bench: '' };
  private load = 0;
  private capacity = BAG_SLOTS;
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
      <div class="status panel"><div class="name"><span><span data-el="name">...</span><span class="lvl" data-el="level" hidden></span></span><span data-el="online"></span></div>
        <div class="energy" data-el="energy" hidden>${ICON.bolt}<div class="bar" data-el="energyBar" role="meter" aria-label="Energy" aria-valuemin="0" aria-valuemax="100"><div class="fill" data-el="energyFill"></div></div></div>
        <div class="wet" data-el="wet" hidden>${ICON.drop}<div class="bar" data-el="wetBar" role="meter" aria-label="Wet" aria-valuemin="0" aria-valuemax="100"><div class="fill" data-el="wetFill"></div></div></div>
        <div class="cling" data-el="cling" hidden role="status">${ICON.cling}<span>Something clings to you</span></div>
        <div class="surge-pill" data-el="surge" hidden role="status" aria-live="polite"></div>
        <div class="sub"><span class="conn" data-el="conn" data-state="connecting"><i></i><span data-el="connText">Connecting</span></span><span data-el="ping"></span></div></div>
      <div class="surge-glow" data-el="surgeGlow"></div>
      <button type="button" class="menu-btn" data-el="menuBtn" aria-label="Menu" aria-expanded="false">${ICON.menu}</button>
      <div class="menu-panel panel" data-el="menu" hidden>
        <button type="button" data-el="menuBag">Bag</button>
        <button type="button" data-el="menuStatus">Status</button>
        <button type="button" data-el="menuAbout">About</button>
        <button type="button" data-el="menuLogout">Log out</button>
      </div>
      <div class="stick" data-el="stick" role="group" aria-label="Movement stick"><div class="knob" data-el="knob"></div></div>
      <div class="ab"><button type="button" class="b" data-el="b" aria-label="B: bag and back">B</button><button type="button" class="a" data-el="a" aria-label="A: pick up, talk, open">A</button></div>
      <div class="dialog panel" data-el="dialog" role="dialog" aria-live="polite"><div class="who panel" data-el="who"></div><div data-el="text"></div><div class="more" data-el="more" aria-hidden="true">&#9660;</div></div>
      <div class="sheet panel" data-el="sheet" data-open="false" role="dialog" aria-label="Bag">
        <div class="sheet-head"><b>Bag</b><span class="room" data-el="room"></span><span class="tools" data-el="tools"></span><button type="button" class="close" data-el="close" aria-label="Close the bag">${ICON.x}</button></div>
        <div class="grid" data-el="grid">${Array.from({ length: MAX_BAG }, (_, i) => `<button type="button" class="slot" data-slot="${i}" data-empty="true" aria-label="Empty slot"${i < BAG_SLOTS ? '' : ' hidden'}></button>`).join('')}</div>
        <div class="detail" data-el="detail" aria-live="polite">
          <p class="hint" data-el="hint">${EMPTY_BAG}</p>
          <div class="about" data-el="about" hidden><div class="big" data-el="bigIcon"></div>
            <div class="words"><div class="title"><b data-el="itemName"></b><span class="count" data-el="itemCount"></span></div><p data-el="itemText"></p><p class="facts" data-el="itemFacts"></p></div></div>
          <div class="acts" data-el="acts" hidden><button type="button" class="act go" data-el="use">Use</button><button type="button" class="act toss" data-el="toss">Throw away</button></div>
          <div class="acts" data-el="ask" hidden><span class="ask" data-el="askText"></span><button type="button" class="act toss sure" data-el="tossYes">Throw away</button><button type="button" class="act" data-el="tossNo">Keep</button></div>
        </div>
      </div>
      <div class="paper-view" data-el="paper" hidden role="dialog" aria-label="Map"><button type="button" class="close" data-el="paperClose" aria-label="Put the map away">${ICON.x}</button></div>
      <div class="sheet panel stash-sheet" data-el="stashSheet" data-open="false" role="dialog" aria-label="Stash">
        <div class="sheet-head"><b>Stash</b><span class="room" data-el="stashXp"></span><button type="button" class="close" data-el="stashClose" aria-label="Close the stash">${ICON.x}</button></div>
        <p class="hint">Tap something in your bag to put it away. What you bring home earns XP.</p>
        <div class="grid" data-el="stashBag">${Array.from({ length: MAX_BAG }, (_, i) => `<button type="button" class="slot" data-bag="${i}" data-empty="true" aria-label="Empty slot"${i < BAG_SLOTS ? '' : ' hidden'}></button>`).join('')}</div>
        <div class="acts"><button type="button" class="act go" data-el="storeAll">Put everything in</button></div>
        <h3 class="stash-title">Wearing</h3>
        <p class="hint">Tap a piece to take it off. Tap gear in the stash to put it on.</p>
        <div class="grid wear" data-el="wearGrid">${SLOTS.map(sl => `<button type="button" class="slot" data-wear="${sl}" aria-label="${sl}"><span class="lbl">${sl}</span></button>`).join('')}</div>
        <h3 class="stash-title">In the stash</h3>
        <div class="grid" data-el="stashGrid"></div>
        <p class="hint" data-el="stashEmpty">Nothing here yet.</p>
      </div>
      <div class="sheet panel bench-sheet" data-el="benchSheet" data-open="false" role="dialog" aria-label="Workbench">
        <div class="sheet-head"><b>Workbench</b><button type="button" class="close" data-el="benchClose" aria-label="Close the workbench">${ICON.x}</button></div>
        <p class="hint">It makes gear from what is in your stash at home, and puts it there. Put it on at the chest.</p>
        <div class="recipes" data-el="benchList"></div>
      </div>
      <div class="sheet panel status-sheet" data-el="statusSheet" data-open="false" role="dialog" aria-label="Status">
        <div class="sheet-head"><b>Status</b><button type="button" class="close" data-el="statusClose" aria-label="Close the status">${ICON.x}</button></div>
        <div class="status-body" data-el="statusBody"></div>
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
    this.el.menuStatus!.addEventListener('click', () => { this.toggleMenu(false); this.toggleStatus(true); });
    this.el.statusClose!.addEventListener('click', () => this.toggleStatus(false));
    this.el.stashClose!.addEventListener('click', () => this.toggleStash(false));
    this.el.storeAll!.addEventListener('click', () => this.h.store?.());
    this.el.stashBag!.addEventListener('click', e => {
      const slot = (e.target as Element).closest<HTMLElement>('[data-bag]');
      if (slot && this.bag[Number(slot.dataset.bag)]) this.h.store?.(Number(slot.dataset.bag));
    });
    this.el.stashGrid!.addEventListener('click', e => {
      const it = (e.target as Element).closest<HTMLElement>('[data-item]');
      // Gear goes on; anything else comes out into the bag.
      if (it?.dataset.gear) this.h.equip?.(it.dataset.item!);
      else if (it) this.h.take?.(it.dataset.item!);
    });
    this.el.wearGrid!.addEventListener('click', e => {
      const it = (e.target as Element).closest<HTMLElement>('[data-wear]');
      if (it && it.dataset.empty !== 'true') this.h.unequip?.(it.dataset.wear as Slot);
    });
    this.el.benchClose!.addEventListener('click', () => this.toggleBench(false));
    this.el.tools!.addEventListener('click', e => {
      const it = (e.target as Element).closest<HTMLElement>('[data-tool]');
      if (it) this.h.tool?.(it.dataset.tool!);
    });
    this.el.paperClose!.addEventListener('click', () => this.showPaper(null));
    // On a phone the whole map is small: a tap shows it at full size, to pan around with a finger.
    this.el.paper!.addEventListener('click', e => {
      if (!(e.target instanceof HTMLCanvasElement)) return;
      const p = this.el.paper!;
      p.toggleAttribute('data-zoom');
      e.target.scrollIntoView({ block: 'center', inline: 'center' });
    });
    this.el.benchList!.addEventListener('click', e => {
      const it = (e.target as Element).closest<HTMLButtonElement>('[data-make]');
      if (it && !it.disabled) this.h.craft?.(it.dataset.make!);
    });
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

  get statusOpen(): boolean {
    return this.el.statusSheet!.dataset.open === 'true';
  }
  toggleStatus(open = !this.statusOpen) {
    this.el.statusSheet!.dataset.open = String(open);
    // The bag, the stash, the status and the About panel open in the same place: one at a time.
    if (open) { this.toggleBag(false); this.toggleAbout(false); this.toggleStash(false); this.toggleBench(false); this.h.status?.(); }
  }

  get stashOpen(): boolean {
    return this.el.stashSheet!.dataset.open === 'true';
  }
  /** Opens or closes the stash sheet (the chest at home). Closing it tells the game. */
  toggleStash(open = !this.stashOpen) {
    const was = this.stashOpen;
    if (open) { this.toggleBag(false); this.toggleAbout(false); this.toggleBench(false); this.el.statusSheet!.dataset.open = 'false'; }
    this.el.stashSheet!.dataset.open = String(open);
    if (was && !open) this.h.stashClosed?.();
  }

  get benchOpen(): boolean {
    return this.el.benchSheet!.dataset.open === 'true';
  }
  /** Opens or closes the workbench sheet. Closing it tells the game. */
  toggleBench(open = !this.benchOpen) {
    const was = this.benchOpen;
    if (open) { this.toggleBag(false); this.toggleAbout(false); this.toggleStash(false); this.el.statusSheet!.dataset.open = 'false'; }
    this.el.benchSheet!.dataset.open = String(open);
    if (was && !open) this.h.benchClosed?.();
  }

  /** The workbench's recipes. Only written to the page when they changed. */
  setBench(recipes: RecipeView[]) {
    const html = recipes.map(r => `<div class="recipe"${r.can ? '' : ' data-short'}><div class="big">${r.icon}</div><div class="words"><b>${esc(r.name)}</b><span class="rfacts">${esc(r.facts)}</span>
      <span class="needs">${r.needs.map(n => `<span class="need"${n.have >= n.need ? '' : ' data-short'} title="${esc(n.name)}">${n.icon}<i>${Math.min(n.have, n.need)}/${n.need}</i></span>`).join('')}</span></div>
      <button type="button" class="act go" data-make="${esc(r.id)}"${r.can ? '' : ' disabled'}>Make</button></div>`).join('');
    if (html !== this.shown.bench) { this.shown.bench = html; this.el.benchList!.innerHTML = html; }
  }

  /** What you wear, slot by slot, in the stash sheet. */
  setWearing(worn: Array<WornView | null>) {
    SLOTS.forEach((sl, i) => {
      const el = this.root.querySelector<HTMLButtonElement>(`[data-wear="${sl}"]`)!, w = worn[i];
      const html = w ? `${w.icon}<span class="lbl">${sl}</span>` : `<span class="lbl">${sl}</span>`;
      if (el.innerHTML !== html) el.innerHTML = html;
      el.dataset.empty = String(!w);
      el.setAttribute('aria-label', w ? `Take off ${w.name}` : `${sl}: nothing`);
    });
  }

  /** What the open stash holds, and your XP for its header. Only written to the page when it changed. */
  setStash(stash: SlotView[], xp: string) {
    const html = stash.map(s => `<button type="button" class="slot" data-item="${esc(s.item)}"${s.slot ? ' data-gear="1"' : ''} aria-label="${esc(`${s.slot ? 'Put on' : 'Take out'} ${s.name}, ${s.count}`)}">${s.icon}<span class="n">${s.count}</span></button>`).join('');
    if (html !== this.shown.stash) { this.shown.stash = html; this.el.stashGrid!.innerHTML = html; }
    this.el.stashEmpty!.hidden = stash.length > 0;
    if (this.el.stashXp!.textContent !== xp) this.el.stashXp!.textContent = xp;
  }

  /** Your level next to your name. */
  setLevel(level: number) {
    const t = `Lv ${level}`, el = this.el.level!;
    if (el.textContent !== t) el.textContent = t;
    el.hidden = false;
  }

  /** What the status panel shows. Only written to the page when it changed. */
  setStatus(v: StatusView) {
    const html = [
      ...v.rows.map(r => `<div class="srow" data-tone="${r.tone ?? 'plain'}"><span class="k">${esc(r.label)}</span><span class="v">${esc(r.text)}</span>${r.bar === undefined ? '' : `<span class="sbar"><i style="transform:translateX(${((Math.min(1, Math.max(0, r.bar)) - 1) * 100).toFixed(1)}%)"></i></span>`}</div>`),
      '<h3>Feats</h3>',
      ...v.feats.map(f => `<div class="feat"${f.done ? ' data-done' : ''}><b>${esc(f.name)}</b><span>${esc(f.text)}</span>${f.done ? '' : `<span class="sbar"><i style="transform:translateX(${((f.progress - 1) * 100).toFixed(1)}%)"></i></span>`}</div>`),
    ].join('');
    if (html === this.shown.status) return;
    this.shown.status = html;
    this.el.statusBody!.innerHTML = html;
  }
  toggleBag(open = !this.bagOpen) {
    // The bag, the status and the About panel open in the same place: one at a time.
    if (open) { this.toggleAbout(false); this.toggleStash(false); this.toggleBench(false); }
    this.el.sheet!.dataset.open = String(open);
    if (open) this.el.statusSheet!.dataset.open = 'false';
    // It opens on the whole bag, never on the details left from last time.
    this.choose(null);
  }

  get aboutOpen(): boolean {
    return this.el.aboutSheet!.dataset.open === 'true';
  }
  toggleAbout(open = !this.aboutOpen) {
    if (open && this.bagOpen) this.toggleBag(false);
    if (open) { this.el.statusSheet!.dataset.open = 'false'; this.toggleStash(false); this.toggleBench(false); }
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

  /** Your tools, as buttons in the bag's header. */
  setTools(tools: Array<{ item: string; name: string; icon: string }>) {
    const html = tools.map(t => `<button type="button" class="slot" data-tool="${esc(t.item)}" aria-label="${esc(`Open the ${t.name.toLowerCase()}`)}">${t.icon}</button>`).join('');
    if (this.el.tools!.innerHTML !== html) this.el.tools!.innerHTML = html;
  }

  get paperOpen(): boolean {
    return !this.el.paper!.hidden;
  }
  /** A paper map over everything (null puts it away). The drawing is made elsewhere; this only shows it. */
  showPaper(drawing: HTMLCanvasElement | null) {
    const el = this.el.paper!;
    el.querySelector('canvas')?.remove();
    if (drawing) el.prepend(drawing);
    el.hidden = !drawing;
    el.removeAttribute('data-zoom');
  }

  /** B in the bag: out of the question, then out of the details. False when there is nothing to back out of (B closes the bag). */
  back(): boolean {
    if (this.statusOpen) { this.toggleStatus(false); return true; }
    if (this.stashOpen) { this.toggleStash(false); return true; }
    if (this.benchOpen) { this.toggleBench(false); return true; }
    if (!this.bagOpen) return false;
    if (this.asking) { this.asking = false; this.showDetail(); return true; }
    if (this.picked) { this.choose(null); return true; }
    return false;
  }

  /** The bag, slot by slot (the server's order). Call it when the bag changes. */
  setBag(slots: SlotView[], capacity: number = BAG_SLOTS) {
    this.bag = slots;
    if (capacity !== this.capacity) {
      this.capacity = capacity;
      // As many slots as the bag worn has, in the bag and in the stash sheet's bag row.
      this.slotEls.forEach((el, i) => { el.hidden = i >= capacity; });
      this.root.querySelectorAll<HTMLButtonElement>('[data-bag]').forEach((el, i) => { el.hidden = i >= capacity; });
    }
    // Details stay open while their slot still holds the same item (a thermos used: one fewer).
    if (this.picked && slots[this.picked.slot]?.item !== this.picked.item) this.picked = null;
    this.slotEls.forEach((el, i) => {
      const s = slots[i];
      el.dataset.empty = String(!s);
      el.innerHTML = s ? `${s.icon}<span class="n">${s.count}</span>` : '';
      el.setAttribute('aria-label', s ? `${s.name}, ${s.count}` : 'Empty slot');
    });
    this.showRoom();
    this.showDetail();
    // The stash sheet's bag row shows the same slots.
    this.root.querySelectorAll<HTMLButtonElement>('[data-bag]').forEach((el, i) => {
      const s = slots[i];
      el.dataset.empty = String(!s);
      el.innerHTML = s ? `${s.icon}<span class="n">${s.count}</span>` : '';
      el.setAttribute('aria-label', s ? `Put away ${s.name}, ${s.count}` : 'Empty slot');
    });
    (this.el.storeAll as HTMLButtonElement).disabled = !slots.length;
  }

  /** What the bag weighs, for its header. */
  setLoad(load: number) {
    this.load = load;
    this.showRoom();
  }

  private showRoom() {
    const t = roomText(this.bag.length, this.load, this.capacity);
    if (t !== this.shown.room) this.el.room!.textContent = this.shown.room = t;
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
    this.el.bigIcon!.innerHTML = s.icon;
    this.el.itemName!.textContent = s.name;
    this.el.itemCount!.textContent = s.count > 1 ? `× ${s.count}` : '';
    this.el.itemText!.textContent = s.text;
    this.el.itemFacts!.textContent = s.facts.join(' · ');
    this.el.itemFacts!.hidden = !s.facts.length;
    this.el.use!.textContent = s.useLabel;
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

  /**
   * How wet you are (a blue bar under the energy, shown once there is something to show) and, in
   * words, whether something clings to your back: an icon alone says nothing on a phone, where
   * nothing shows a tooltip. Called every frame; only writes what changed.
   */
  setBody(b: BodyView | null) {
    const s = this.shown;
    const show = !!b && (b.wet > 0.005 || b.wetRate > 0);
    if (show !== s.wetShown) this.el.wet!.hidden = !(s.wetShown = show);
    if (!b) {
      if (s.hitched) this.el.cling!.hidden = !(s.hitched = false);
      return;
    }
    const wet = Math.round(b.wet * 200) / 200;
    if (wet !== s.wet) {
      s.wet = wet;
      this.el.wetFill!.style.transform = `translateX(${((wet - 1) * 100).toFixed(1)}%)`;
      this.el.wetBar!.setAttribute('aria-valuenow', String(Math.round(wet * 100)));
    }
    const hitched = !!b?.hitched;
    if (hitched !== s.hitched) this.el.cling!.hidden = !(s.hitched = hitched);
  }

  /** The surge clock (hidden while calm) and the violet edges while the front is over you. */
  setSurge(v: SurgeView | null, caught: boolean) {
    const s = this.shown, look = surgeLook(v, caught), pill = this.el.surge!;
    const text = look?.text ?? '';
    if (text !== s.surge) { s.surge = text; pill.textContent = text; pill.hidden = !look; }
    if ((look?.level ?? '') !== s.surgeLevel) pill.dataset.level = s.surgeLevel = look?.level ?? '';
    const glow = caught ? 1 : look?.level === 'surge' ? 0.35 : 0;
    if (glow !== s.surgeGlow) {
      s.surgeGlow = glow;
      const g = this.el.surgeGlow!;
      g.style.visibility = glow > 0 ? 'visible' : 'hidden';
      g.style.opacity = String(glow);
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

function esc(t: string): string {
  return t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
