/**
 * The interface over the world: status and energy (and how wet you are, and what clings to you), the
 * surge clock, the menu with the journal, status and About panels, the joystick and A/B, name tags,
 * the text box, the bag, and the fade and name banner when you arrive somewhere.
 * It only draws state and reports input; the rules live in game.ts.
 * There is no map on purpose: napoland is a mapless game, you learn the world by walking it.
 */
import { BAG_SLOTS, RANKS, SLOTS, type BodyView, type Dir, type EnergyView, type Slot, type SurgeView } from '@napoland/shared';
import { aboutBody, versionView } from './about';
import { DOUBLE_TAP_MS, DoubleTap, cardPress, refKey, statText, type DetailAct, type DetailRef, type DetailView } from './details';
import type { FriendsView } from './friends';
import { liveState, type SlotView } from './items';
import type { JournalView } from './journal';
import type { SoundSetting } from './sound';

const svg = (inner: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON = {
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  more: svg('<path d="M9 5l7 7-7 7"/>'),
  // The waves show while the sound is on, the cross while it is off (style.css).
  speaker: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path class="on" d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/><path class="off" d="M17 9.5l5 5M22 9.5l-5 5"/>'),
  chat: svg('<path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>'),
  minus: svg('<path d="M6 12h12"/>'),
  plus: svg('<path d="M12 6v12M6 12h12"/>'),
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

/**
 * What a key does in the chat's line, as in Metin2: Enter with words in it sends them (the form does,
 * and the line stays open for more), Enter on an empty line and Escape close the chat. Keys that pick
 * a word (an input method still composing) do nothing here.
 */
export function chatKey(key: string, text: string, composing = false): 'send' | 'close' | null {
  if (composing) return null;
  if (key === 'Escape') return 'close';
  if (key === 'Enter') return text.trim() ? 'send' : 'close';
  return null;
}

export interface HudHandlers {
  pad(dir: Dir | null): void;
  /** The status panel opened: fill it (setStatus), and keep it current while it is open. */
  status?(): void;
  /** In the open stash: put bag slot `slot` in (or everything, left out), take a stack of an item out, or close it. */
  store?(slot?: number): void;
  take?(item: string): void;
  stashClosed?(): void;
  /**
   * At the chest: put on gear from the stash, take off what a slot wears. At the workbench: make a
   * recipe or mend what a slot wears ("mend:" and the slot), or close it.
   */
  equip?(item: string, n?: number): void;
  unequip?(slot: Slot): void;
  /** At the chest: open a sealed thing from the stash (a NAPO lockbox); the game asks first. */
  open?(item: string): void;
  craft?(recipe: string): void;
  benchClosed?(): void;
  /** What a tap in the chest or at the workbench shows: its card, as the game stands now (null: it is gone). */
  details?(ref: DetailRef): DetailView | null;
  /** Something done in the friends panel, or a player's name tag tapped. */
  social?(a: SocialAction): void;
  /** The chat panel: opened, another tab picked, or something said. */
  chat?(a: { a: 'opened' } | { a: 'tab'; to: 'world' | 'local' } | { a: 'say'; to: 'world' | 'local'; text: string }): void;
  /** A tool in the bag's header was tapped (one that is not a map). */
  tool?(item: string): void;
  /** The map button in the bag's header: the paper map of the area you are in. */
  map?(): void;
  /** The sound was muted or unmuted, or its volume moved. */
  sound?(s: SoundSetting): void;
  /** A guest's Sign in button (in the status panel, the Status tab, the chat or the friends panel). */
  signIn?(): void;
  a(): void;
  b(): void;
  /** A tap on the text box itself (not on its buttons). */
  dialogTap(): void;
  /** The question in the text box: YES or NO tapped; − or + pressed (-1 or 1) and let go (0); a tap anywhere outside the box. */
  answer?(choice: 'yes' | 'no'): void;
  count?(dir: -1 | 0 | 1): void;
  dismiss?(): void;
  logout(): void;
  /** Use what is in bag slot `slot` (only offered for what can be used); the game asks first. */
  use(slot: number): void;
  /** Throw away some of what is in bag slot `slot`; the game asks how many first. */
  discard(slot: number): void;
  /** The version the server runs, for the About panel (null: none shown). Asked once, when the panel first opens. */
  version(): Promise<string | null>;
}

/**
 * The menu's sound row: the button mutes and unmutes, the slider sets the volume (and unmutes); both
 * tell `on`. Returns what shows a setting on it.
 */
export function soundRow(
  row: { mute: EventTarget & { setAttribute(name: string, value: string): void }; label: { textContent: string | null }; volume: EventTarget & { value: string } },
  on?: (s: SoundSetting) => void,
): (s: SoundSetting) => void {
  let now: SoundSetting = { volume: 0.7, muted: false };
  const show = (s: SoundSetting) => {
    now = s;
    row.mute.setAttribute('aria-pressed', String(!s.muted));
    row.label.textContent = s.muted ? 'Sound off' : 'Sound on';
    row.volume.value = String(Math.round(s.volume * 100));
  };
  const change = (s: SoundSetting) => { show(s); on?.(s); };
  row.mute.addEventListener('click', () => change({ ...now, muted: !now.muted }));
  row.volume.addEventListener('input', () => change({ volume: Number(row.volume.value) / 100, muted: false }));
  return show;
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
export interface WornView { slot: Slot; name: string; icon: string; /** How worn down (1 new, 0 worn out), for gear that wears. */ cond?: number; /** Its quirk's name. */ quirk?: string }
/** A row of the workbench: what a recipe makes (or a mend), what it needs against what your stash holds, and whether it can be done. */
export interface RecipeView { id: string; name: string; icon: string; facts: string; needs: Array<{ name: string; icon: string; have: number; need: number }>; can: boolean }

/** One row of the status panel: a label, what it says, and a bar (0 to 1) when it has one. */
export interface StatusRow { label: string; text: string; bar?: number; tone?: 'good' | 'bad' | 'plain' }
/**
 * A feat in the status panel: its rank (0 before the first), what that rank does, how far the next
 * one is in words, and as a share for its bar (none at the top rank).
 */
export interface FeatView { name: string; rank: number; does: string; next: string; progress?: number }
/** The status panel: what a guest should know first (with a Sign in button), rows about you, then a card per feat. */
export interface StatusView { guest?: string; rows: StatusRow[]; feats: FeatView[] }

/** What the chat and the friends panel say to a guest, over a Sign in button, instead of what they cannot use yet. */
export const CHAT_GATE = 'Sign in to chat with other players. Signing in keeps your character.';
export const FRIENDS_GATE = 'Sign in to make friends and write to them. Signing in keeps your character.';
/** A guest's card, as someone signed in sees it: no friends yet, but they can still be blocked and reported. */
export const GUEST_CARD = 'They play as a guest. Once they sign in, you can be friends.';

/** The status panel's body: what a guest should know first, the rows about you, then the feats. */
export function statusHtml(v: StatusView): string {
  return [
    v.guest ? `<div class="gate snote"><p>${esc(v.guest)}</p><button type="button" class="act go" data-signin>Sign in</button></div>` : '',
    ...v.rows.map(r => `<div class="srow" data-tone="${r.tone ?? 'plain'}"><span class="k">${esc(r.label)}</span><span class="v">${esc(r.text)}</span>${r.bar === undefined ? '' : `<span class="sbar"><i style="transform:translateX(${((Math.min(1, Math.max(0, r.bar)) - 1) * 100).toFixed(1)}%)"></i></span>`}</div>`),
    '<h3>Feats</h3>',
    `<div class="feats">${v.feats.map(featHtml).join('')}</div>`,
  ].join('');
}

/** A feat's card: its name and rank as pips (the ones earned lit), what it does, and the way to the next rank. */
export function featHtml(f: FeatView): string {
  const pips = Array.from({ length: RANKS }, (_, i) => `<i${i < f.rank ? ' data-on' : ''}></i>`).join('');
  const bar = f.progress === undefined ? '' : `<span class="sbar"><i style="transform:translateX(${((Math.min(1, Math.max(0, f.progress)) - 1) * 100).toFixed(1)}%)"></i></span>`;
  return `<div class="feat" data-rank="${f.rank}"${f.progress === undefined ? ' data-top' : ''}><b>${esc(f.name)}</b>`
    + `<span class="pips" role="img" aria-label="Rank ${f.rank} of ${RANKS}">${pips}</span>`
    + `<span class="does">${esc(f.does)}</span>${bar}<span class="next">${esc(f.next)}</span></div>`;
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
/** What the friends panel (and tapping a name tag) asks the game to do. */
export type SocialAction =
  | { a: 'opened' }
  | { a: 'person'; id: string; name: string } | { a: 'back' }
  | { a: 'befriend'; id?: string; name?: string }
  | { a: 'answer'; id: string; yes: boolean }
  | { a: 'unfriend'; id: string }
  | { a: 'block'; id: string; on: boolean }
  | { a: 'report'; id: string; reason: 'rude' | 'spam' | 'cheating' | 'other' }
  | { a: 'tell'; id: string; text: string }
  | { a: 'requests'; off: boolean };

export interface TagView { id: string; name: string; x: number; y: number; pile?: boolean }
/** `row` stacks words said at once, 0 at the bottom. */
export interface FloatView { id: number; text: string; color: string; x: number; y: number; t: number; row: number }
/** Someone's lines in the text box, as far as they are typed out (`done`: the whole line is). */
export interface DialogView { who: string; text: string; done: boolean }
/** A question in the text box (ask.ts): its words, the choice highlighted, and how many (null: it does not ask how many). */
export interface AskView { who: string; text: string; choice: 'yes' | 'no'; count: { n: number; min: number; max: number } | null }
/** What the text box says by itself: it stays up `ms` more (a thin line along its bottom runs out), or it waits for the server. */
export interface NoteView { who: string; text: string; ms: number; waiting: boolean }

export class Hud {
  readonly root: HTMLElement;
  private el: Record<string, HTMLElement>;
  private tagEls = new Map<string, HTMLElement>();
  private floatEls = new Map<number, HTMLElement>();
  /** What the energy bar, vignette and fade show now, so a frame only touches the page when something changed. */
  private shown = { fill: -1, level: '', refill: false, pct: -1, vignette: -1, dark: -1, wet: -1, wetShown: false, hitched: false, surge: '', surgeLevel: '', surgeGlow: -1, room: '', status: '', stash: '', bench: '', card: '', friends: '', personActs: '', talk: '', journal: '', chat: '' };
  /** What the dots say is new: among friends (a request, an unread message) and in the journal (a chapter), on the menu; in the chat (something said), on its own button. */
  private news = { social: false, journal: false, chat: false };
  private load = 0;
  private capacity = BAG_SLOTS;
  private bannerTimer: ReturnType<typeof setTimeout> | undefined;
  private slotEls: HTMLButtonElement[] = [];
  /** The bag as shown, and the slot whose details are open (and the item in it). */
  private bag: SlotView[] = [];
  /** When the bag was told (performance.now()), and what each live slot's countdown last showed. */
  private bagAt = 0;
  private readonly liveShown = new Map<number, string>();
  /** Whose card the friends panel shows, if anyone's. */
  private person: string | null = null;
  /** The chat tab shown, and the speech bubbles over heads by who said it. */
  private chatTab: 'world' | 'local' = 'local';
  private bubbleEls = new Map<string, HTMLElement>();
  private picked: { slot: number; item: string } | null = null;
  /**
   * What the text box holds: someone's lines (told every frame), a question, or what it says by itself
   * (told when they change). A question comes first, then what it says, then the lines. `shown` is what
   * the page shows now, so a frame only writes what changed.
   */
  private box: { talk: DialogView | null; ask: AskView | null; note: NoteView | null } = { talk: null, ask: null, note: null };
  private boxShown: { mode: string; who: string; text: string; done: boolean; ask: AskView | null } = { mode: '', who: '', text: '', done: false, ask: null };
  /** The card open in the stash or at the workbench (details.ts): what it is about, and what it shows. */
  private card: { where: 'stash' | 'bench'; ref: DetailRef; view: DetailView } | null = null;
  /** The last tap in the stash or at the workbench, and what it was on: a second one may make it a double tap. */
  private readonly taps = new DoubleTap();
  private tapped: DetailRef | null = null;
  /** The sheet whose dock shows a card on the page: it stays drawn while its panel slides away. */
  private docked: 'stash' | 'bench' | null = null;
  private revealTimer: ReturnType<typeof setTimeout> | undefined;
  private versionAsked = false;
  private showSound: (s: SoundSetting) => void = () => {};
  /** You play as a guest: the status panel says so, and chat and friends show what signing in opens. */
  private guest = false;
  /** What the stash says came in parcels, while it is open. */
  private parcelLines: string[] = [];

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
      <div class="status panel" data-el="status"><div class="name"><span><span data-el="name">...</span><span class="lvl" data-el="level" hidden></span></span><span data-el="online"></span></div>
        <div class="guest" data-el="guest" hidden><span class="guest-tag">Guest</span><button type="button" class="signin" data-signin>Sign in</button></div>
        <div class="energy" data-el="energy" hidden>${ICON.bolt}<div class="bar" data-el="energyBar" role="meter" aria-label="Energy" aria-valuemin="0" aria-valuemax="100"><div class="fill" data-el="energyFill"></div></div></div>
        <div class="wet" data-el="wet" hidden>${ICON.drop}<div class="bar" data-el="wetBar" role="meter" aria-label="Wet" aria-valuemin="0" aria-valuemax="100"><div class="fill" data-el="wetFill"></div></div></div>
        <div class="cling" data-el="cling" hidden role="status">${ICON.cling}<span>Something clings to you</span></div>
        <div class="surge-pill" data-el="surge" hidden role="status" aria-live="polite"></div>
        <div class="sub"><span class="conn" data-el="conn" data-state="connecting"><i></i><span data-el="connText">Connecting</span></span><span data-el="ping"></span></div></div>
      <div class="surge-glow" data-el="surgeGlow"></div>
      <button type="button" class="menu-btn" data-el="menuBtn" aria-label="Menu" aria-expanded="false">${ICON.menu}</button>
      <button type="button" class="menu-btn chat-btn" data-el="chatBtn" aria-label="Chat" aria-expanded="false">${ICON.chat}</button>
      <div class="menu-panel panel" data-el="menu" hidden>
        <button type="button" data-el="menuBag">Bag</button>
        <button type="button" data-el="menuJournal" hidden>Journal</button>
        <button type="button" data-el="menuStatus">Status</button>
        <button type="button" data-el="menuFriends">Friends</button>
        <button type="button" data-el="menuAbout">About</button>
        <div class="sound-row"><button type="button" data-el="soundMute" aria-pressed="true">${ICON.speaker}<span data-el="soundLabel">Sound on</span></button><input type="range" min="0" max="100" value="70" data-el="soundVolume" aria-label="Volume" /></div>
        <button type="button" data-el="menuLogout">Log out</button>
      </div>
      <div class="stick" data-el="stick" role="group" aria-label="Movement stick"><div class="knob" data-el="knob"></div></div>
      <div class="ab"><button type="button" class="b" data-el="b" aria-label="B: bag and back">B</button><button type="button" class="a" data-el="a" aria-label="A: pick up, talk, open">A</button></div>
      <div class="scrim" data-el="scrim" hidden></div>
      <div class="dialog panel" data-el="dialog" role="dialog" aria-live="polite"><div class="who panel" data-el="who"></div><div class="line" data-el="text"></div>
        <div class="count" data-el="count" role="group" aria-label="How many" hidden><button type="button" class="step" data-step="-1" aria-label="One fewer">${ICON.minus}</button><b class="n" data-el="countN"></b><button type="button" class="step" data-step="1" aria-label="One more">${ICON.plus}</button></div>
        <div class="choices panel" data-el="choices" role="group" aria-label="Your answer" hidden><button type="button" data-choice="yes">YES</button><button type="button" data-choice="no">NO</button></div>
        <div class="more" data-el="more" aria-hidden="true" style="visibility: hidden">&#9660;</div><i class="timer" data-el="timer" aria-hidden="true" hidden></i></div>
      <div class="sheet panel" data-el="sheet" data-open="false" role="dialog" aria-label="Bag">
        <div class="sheet-head"><b>Bag</b><span class="room" data-el="room"></span><span class="tools" data-el="tools"></span><button type="button" class="close" data-el="close" aria-label="Close the bag">${ICON.x}</button></div>
        <div class="grid" data-el="grid">${Array.from({ length: MAX_BAG }, (_, i) => `<button type="button" class="slot" data-slot="${i}" data-empty="true" aria-label="Empty slot"${i < BAG_SLOTS ? '' : ' hidden'}></button>`).join('')}</div>
        <div class="detail" data-el="detail" aria-live="polite">
          <p class="hint" data-el="hint">${EMPTY_BAG}</p>
          <div class="about" data-el="about" hidden><div class="big" data-el="bigIcon"></div>
            <div class="words"><div class="title"><b data-el="itemName"></b><span class="count" data-el="itemCount"></span></div><p data-el="itemText"></p><p class="facts" data-el="itemFacts"></p></div></div>
          <div class="acts" data-el="acts" hidden><button type="button" class="act go" data-el="use">Use</button><button type="button" class="act toss" data-el="toss">Throw away</button></div>
        </div>
      </div>
      <div class="paper-view" data-el="paper" hidden role="dialog" aria-label="Map"><button type="button" class="close" data-el="paperClose" aria-label="Put the map away">${ICON.x}</button></div>
      <div class="sheet panel stash-sheet docked" data-el="stashSheet" data-open="false" role="dialog" aria-label="Stash">
        <div class="sheet-head"><b>Stash</b><span class="room" data-el="stashXp"></span><button type="button" class="close" data-el="stashClose" aria-label="Close the stash">${ICON.x}</button></div>
        <div class="sheet-body" data-el="stashBody">
          <div class="parcel-note" data-el="stashParcels" role="status" hidden></div>
          <p class="hint">What you bring home earns XP. Tap something to see it, and tap it twice to put it away.</p>
          <div class="grid" data-el="stashBag">${Array.from({ length: MAX_BAG }, (_, i) => `<button type="button" class="slot" data-bag="${i}" data-empty="true" aria-label="Empty slot"${i < BAG_SLOTS ? '' : ' hidden'}></button>`).join('')}</div>
          <div class="acts"><button type="button" class="act go" data-el="storeAll">Put everything in</button></div>
          <h3 class="stash-title">Wearing</h3>
          <p class="hint">Tap a piece to see what it does. Tap it twice to take it off, or to wear it from the stash.</p>
          <div class="grid wear" data-el="wearGrid">${SLOTS.map(sl => `<button type="button" class="slot" data-wear="${sl}" aria-label="${sl}"><span class="lbl">${sl}</span></button>`).join('')}</div>
          <h3 class="stash-title">In the stash</h3>
          <div class="grid" data-el="stashGrid"></div>
          <p class="hint" data-el="stashEmpty">Nothing here yet.</p>
        </div>
        <div class="dock" data-el="stashDock" hidden><div class="detail" data-el="stashCard" aria-live="polite"></div></div>
      </div>
      <div class="sheet panel bench-sheet docked" data-el="benchSheet" data-open="false" role="dialog" aria-label="Workbench">
        <div class="sheet-head"><b>Workbench</b><button type="button" class="close" data-el="benchClose" aria-label="Close the workbench">${ICON.x}</button></div>
        <div class="sheet-body" data-el="benchBody">
          <p class="hint">It makes and mends gear from your stash; wear what it makes from the chest beside it. Tap one to see what it takes, and tap it twice to do it.</p>
          <div class="recipes" data-el="benchList"></div>
        </div>
        <div class="dock" data-el="benchDock" hidden><div class="detail" data-el="benchCard" aria-live="polite"></div></div>
      </div>
      <div class="sheet panel status-sheet" data-el="statusSheet" data-open="false" role="dialog" aria-label="Status">
        <div class="sheet-head"><b>Status</b><button type="button" class="close" data-el="statusClose" aria-label="Close the status">${ICON.x}</button></div>
        <div class="status-body" data-el="statusBody"></div>
      </div>
      <div class="sheet panel chat-sheet" data-el="chatSheet" data-open="false" role="dialog" aria-label="Chat">
        <div class="sheet-head"><b>Chat</b><button type="button" class="close" data-el="chatClose" aria-label="Close chat">${ICON.x}</button></div>
        <div class="tabs" role="tablist"><button type="button" role="tab" data-tab="local">Near you</button><button type="button" role="tab" data-tab="world">Everyone</button></div>
        <div class="log" data-el="chatLog" aria-live="polite"></div>
        <p class="note" data-el="chatNote" role="status" hidden></p>
        <form class="say" data-el="chatForm"><input data-el="chatText" maxlength="120" placeholder="Say something" autocomplete="off" enterkeyhint="send" aria-label="Say something"><button type="submit" class="act go">Say</button></form>
        <div class="gate" data-el="chatGate" hidden><p>${CHAT_GATE}</p><button type="button" class="act go" data-signin>Sign in</button></div>
      </div>
      <div class="sheet panel friends-sheet" data-el="friendsSheet" data-open="false" role="dialog" aria-label="Friends">
        <div class="sheet-head"><button type="button" class="close" data-el="friendsBack" aria-label="Back to your friends" hidden>${ICON.back}</button><b data-el="friendsTitle">Friends</b><button type="button" class="close" data-el="friendsClose" aria-label="Close friends">${ICON.x}</button></div>
        <p class="note" data-el="friendsNote" role="status" hidden></p>
        <div class="gate" data-el="friendsGate" hidden><p>${FRIENDS_GATE}</p><button type="button" class="act go" data-signin>Sign in</button></div>
        <div class="friends-list" data-el="friendsList">
          <form class="say" data-el="askForm"><input data-el="askName" maxlength="16" placeholder="A player's name" autocomplete="off" enterkeyhint="send" aria-label="Ask a player to be your friend, by name"><button type="submit" class="act go">Ask</button></form>
          <div data-el="friendsRows"></div>
          <label class="setting"><input type="checkbox" data-el="requestsOn"> Let people ask me to be friends</label>
        </div>
        <div class="person" data-el="personView" hidden>
          <p class="where" data-el="personWhere"></p>
          <div class="acts" data-el="personActs"></div>
          <div class="acts" data-el="reasons" hidden><span class="ask">Why?</span>${(['rude', 'spam', 'cheating', 'other'] as const).map(r => `<button type="button" class="act toss" data-reason="${r}">${r[0]!.toUpperCase()}${r.slice(1)}</button>`).join('')}</div>
          <div class="talk" data-el="talk" aria-live="polite"></div>
          <form class="say" data-el="sayForm" hidden><input data-el="sayText" maxlength="200" placeholder="Write to them" autocomplete="off" enterkeyhint="send" aria-label="Message"><button type="submit" class="act go">Send</button></form>
        </div>
      </div>
      <div class="sheet panel journal-sheet" data-el="journalSheet" data-open="false" role="dialog" aria-label="Journal">
        <div class="sheet-head"><b>Journal</b><button type="button" class="close" data-el="journalClose" aria-label="Close the journal">${ICON.x}</button></div>
        <p class="hint">The story so far, the latest first. It goes on: new chapters come as the world grows.</p>
        <div class="journal-body" data-el="journalBody"></div>
      </div>
      <div class="sheet panel about-sheet" data-el="aboutSheet" data-open="false" role="dialog" aria-label="About napoland">
        <div class="sheet-head"><b>About</b><button type="button" class="close" data-el="aboutClose" aria-label="Close About">${ICON.x}</button></div>
        ${aboutBody()}
      </div>`;
    parent.appendChild(this.root);
    this.el = {};
    for (const node of this.root.querySelectorAll<HTMLElement>('[data-el]')) this.el[node.dataset.el!] = node;
    // The bag's own slots only: the stash sheet has slots too (its bag row, what you wear), drawn apart.
    this.slotEls = [...this.el.grid!.querySelectorAll<HTMLButtonElement>('.slot')];
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
    // Every Sign in button a guest sees, wherever it is.
    this.root.addEventListener('click', e => {
      if ((e.target as Element).closest('[data-signin]')) this.h.signIn?.();
    });
    // The status panel opens the Status tab; its Sign in button is a target of its own.
    this.el.status!.addEventListener('click', e => {
      if (!(e.target as Element).closest('[data-signin]')) this.toggleStatus(true);
    });
    this.el.dialog!.addEventListener('click', e => {
      const t = e.target as Element, choice = t.closest<HTMLElement>('[data-choice]'), step = t.closest<HTMLElement>('[data-step]');
      if (choice) return this.h.answer?.(choice.dataset.choice as 'yes' | 'no');
      // − and + count on pointerdown (and repeat while held); a click that came from the keyboard is one step.
      if (step) {
        if (e.detail === 0) { this.h.count?.(Number(step.dataset.step) as -1 | 1); this.h.count?.(0); }
        return;
      }
      this.h.dialogTap();
    });
    const count = this.el.count!, letGo = () => this.h.count?.(0);
    count.addEventListener('pointerdown', e => {
      const step = (e.target as Element).closest<HTMLElement>('[data-step]');
      if (!step) return;
      try { step.setPointerCapture(e.pointerId); } catch { /* not all browsers allow it */ }
      this.h.count?.(Number(step.dataset.step) as -1 | 1);
    });
    count.addEventListener('pointerup', letGo);
    count.addEventListener('pointercancel', letGo);
    count.addEventListener('lostpointercapture', letGo);
    // Anywhere outside the box while it asks (or says something by itself): no, or it closes.
    this.el.scrim!.addEventListener('click', () => this.h.dismiss?.());
    this.el.close!.addEventListener('click', () => this.toggleBag(false));
    this.el.menuBtn!.addEventListener('click', () => this.toggleMenu());
    this.el.menuBag!.addEventListener('click', () => { this.toggleMenu(false); this.toggleBag(true); });
    this.el.menuStatus!.addEventListener('click', () => { this.toggleMenu(false); this.toggleStatus(true); });
    this.el.menuJournal!.addEventListener('click', () => { this.toggleMenu(false); this.toggleJournal(true); });
    this.el.journalClose!.addEventListener('click', () => this.toggleJournal(false));
    this.el.menuFriends!.addEventListener('click', () => { this.toggleMenu(false); this.toggleFriends(true); });
    this.el.chatBtn!.addEventListener('click', () => { this.toggleMenu(false); this.toggleChat(); });
    this.el.chatClose!.addEventListener('click', () => this.toggleChat(false));
    this.el.chatForm!.addEventListener('submit', e => {
      e.preventDefault();
      const input = this.el.chatText as HTMLInputElement, text = input.value.trim();
      if (text) { this.h.chat?.({ a: 'say', to: this.chatTab, text }); input.value = ''; }
    });
    // As in Metin2: Enter on an empty line (or Escape) closes the chat; with words in it, the form sends them and the line stays open.
    this.el.chatText!.addEventListener('keydown', e => {
      const k = e as KeyboardEvent;
      // The key ends here: the game must not take the same Escape for B, or the same Enter for opening the chat again.
      if (chatKey(k.key, (this.el.chatText as HTMLInputElement).value, k.isComposing) === 'close') { k.preventDefault(); k.stopPropagation(); this.toggleChat(false); }
    });
    this.el.chatSheet!.addEventListener('click', e => {
      const t = (e.target as Element).closest<HTMLElement>('[data-tab], [data-who]');
      // The tab counts at once: what is said right after goes where it now shows.
      if (t?.dataset.tab) { this.chatTab = t.dataset.tab as 'world' | 'local'; this.h.chat?.({ a: 'tab', to: this.chatTab }); }
      // A name in the log: that player's card (friends, block, report).
      else if (t?.dataset.who) this.h.social?.({ a: 'person', id: t.dataset.who, name: t.textContent ?? '' });
    });
    this.el.friendsClose!.addEventListener('click', () => this.toggleFriends(false));
    this.el.friendsBack!.addEventListener('click', () => this.h.social?.({ a: 'back' }));
    this.el.askForm!.addEventListener('submit', e => {
      e.preventDefault();
      const input = this.el.askName as HTMLInputElement, name = input.value.trim();
      if (name) { this.h.social?.({ a: 'befriend', name }); input.value = ''; }
    });
    this.el.sayForm!.addEventListener('submit', e => {
      e.preventDefault();
      const input = this.el.sayText as HTMLInputElement, text = input.value.trim();
      if (text && this.person) { this.h.social?.({ a: 'tell', id: this.person, text }); input.value = ''; }
    });
    this.el.requestsOn!.addEventListener('change', e => this.h.social?.({ a: 'requests', off: !(e.target as HTMLInputElement).checked }));
    // Buttons in the rows and on a card say what they do (data-act) and to whom (data-id, data-name).
    this.el.friendsSheet!.addEventListener('click', e => {
      const b = (e.target as Element).closest<HTMLElement>('[data-act], [data-reason]');
      if (!b) return;
      if (b.dataset.reason) {
        this.el.reasons!.hidden = true;
        if (this.person) this.h.social?.({ a: 'report', id: this.person, reason: b.dataset.reason as 'rude' });
        return;
      }
      const id = b.dataset.id ?? this.person ?? '', name = b.dataset.name ?? '';
      switch (b.dataset.act) {
        case 'open': return this.h.social?.({ a: 'person', id, name });
        case 'accept': return this.h.social?.({ a: 'answer', id, yes: true });
        case 'decline': return this.h.social?.({ a: 'answer', id, yes: false });
        case 'befriend': return this.h.social?.({ a: 'befriend', id });
        case 'unfriend': return this.h.social?.({ a: 'unfriend', id });
        case 'block': return this.h.social?.({ a: 'block', id, on: true });
        case 'unblock': return this.h.social?.({ a: 'block', id, on: false });
        case 'report': this.el.reasons!.hidden = false; return;
      }
    });
    // A player's name tag opens their card.
    this.el.labels!.addEventListener('click', e => {
      const tag = (e.target as Element).closest<HTMLElement>('[data-player]');
      if (tag) this.h.social?.({ a: 'person', id: tag.dataset.player!, name: tag.textContent ?? '' });
    });
    this.el.statusClose!.addEventListener('click', () => this.toggleStatus(false));
    this.el.stashClose!.addEventListener('click', () => this.toggleStash(false));
    this.el.storeAll!.addEventListener('click', () => this.h.store?.());
    // A tap looks, an action is a second step: in the chest and at the workbench a tap opens a card, and
    // its button, A or a second tap does what it says. Taken in the capture phase, so a second tap
    // that lands on the card (it may have opened under the finger) still counts as the double tap.
    this.el.stashSheet!.addEventListener('click', e => this.sheetTap('stash', e), true);
    this.el.benchSheet!.addEventListener('click', e => this.sheetTap('bench', e), true);
    for (const dock of [this.el.stashDock!, this.el.benchDock!]) {
      dock.addEventListener('click', e => {
        // A double tap that landed on the button already did it. Greyed out, it still answers, with a shake.
        if (!e.defaultPrevented && (e.target as Element).closest('[data-card-act]')) this.pressCard();
      });
    }
    this.el.benchClose!.addEventListener('click', () => this.toggleBench(false));
    this.el.tools!.addEventListener('click', e => {
      const it = (e.target as Element).closest<HTMLElement>('[data-tool], [data-map]');
      if (it?.dataset.tool) this.h.tool?.(it.dataset.tool);
      else if (it) this.h.map?.();
    });
    this.el.paperClose!.addEventListener('click', () => this.showPaper(null));
    // On a phone the whole map is small: a tap shows it at full size, to pan around with a finger.
    this.el.paper!.addEventListener('click', e => {
      if (!(e.target instanceof HTMLCanvasElement)) return;
      const p = this.el.paper!;
      p.toggleAttribute('data-zoom');
      e.target.scrollIntoView({ block: 'center', inline: 'center' });
    });
    this.el.menuAbout!.addEventListener('click', () => { this.toggleMenu(false); this.toggleAbout(true); });
    this.el.aboutClose!.addEventListener('click', () => this.toggleAbout(false));
    this.el.menuLogout!.addEventListener('click', () => { this.toggleMenu(false); this.h.logout(); });
    this.showSound = soundRow({ mute: this.el.soundMute!, label: this.el.soundLabel!, volume: this.el.soundVolume as HTMLInputElement }, s => this.h.sound?.(s));
    this.el.grid!.addEventListener('click', e => {
      const slot = (e.target as Element).closest<HTMLElement>('[data-slot]');
      if (!slot) return;
      const i = Number(slot.dataset.slot);
      // Tapping the open slot again, or an empty one, closes the details.
      this.choose(this.bag[i] && this.picked?.slot !== i ? i : null);
    });
    // The game asks first, in the text box: the details stay open meanwhile, and after, while the slot holds the same.
    this.el.use!.addEventListener('click', () => { if (this.picked) this.h.use(this.picked.slot); });
    this.el.toss!.addEventListener('click', () => { if (this.picked) this.h.discard(this.picked.slot); });
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
    if (open) { this.el.friendsSheet!.dataset.open = 'false'; this.toggleJournal(false); this.el.chatSheet!.dataset.open = 'false'; this.toggleBag(false); this.toggleAbout(false); this.toggleStash(false); this.toggleBench(false); this.h.status?.(); }
  }

  get chatOpen(): boolean {
    return this.el.chatSheet!.dataset.open === 'true';
  }
  /** Opens or closes the chat; with `type`, its line takes the keys (Enter on a keyboard). */
  toggleChat(open = !this.chatOpen, type = false) {
    if (open) { this.toggleJournal(false); this.toggleBag(false); this.toggleAbout(false); this.toggleStash(false); this.toggleBench(false); this.toggleFriends(false); this.el.statusSheet!.dataset.open = 'false'; }
    const was = this.chatOpen, line = this.el.chatText as HTMLInputElement;
    this.el.chatSheet!.dataset.open = String(open);
    this.el.chatBtn!.setAttribute('aria-expanded', String(open));
    if (open && type) line.focus({ preventScroll: true });
    // Closed, its line lets go of the keys, so they walk again.
    else if (!open && document.activeElement === line) line.blur();
    if (open && !was) this.h.chat?.({ a: 'opened' });
  }

  /** The chat panel: the tab shown, its lines (oldest first), and why the last message did not go out. */
  setChat(tab: 'world' | 'local', lines: ReadonlyArray<{ id: string; name: string; text: string; mine: boolean }>, note: string | null) {
    this.chatTab = tab;
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    const html = lines.map(l => `<p class="cline"${l.mine ? ' data-mine' : ''}>${l.mine ? `<b>${esc(l.name)}</b>` : `<button type="button" class="who" data-who="${esc(l.id)}">${esc(l.name)}</button>`} ${esc(l.text)}</p>`).join('')
      || `<p class="hint">${tab === 'local' ? 'Only players near you hear what you say here, and see it over your head.' : 'Everyone online hears what you say here.'}</p>`;
    if (html !== this.shown.chat) {
      this.shown.chat = html;
      const log = this.el.chatLog!;
      log.innerHTML = html;
      log.scrollTop = log.scrollHeight;
    }
    const n = this.el.chatNote!;
    n.hidden = !note;
    if (note && n.textContent !== note) n.textContent = note;
  }

  /** Speech bubbles over the heads of whoever said something near you, in screen pixels. */
  setBubbles(list: ReadonlyArray<{ id: string; text: string; x: number; y: number }>) {
    const seen = new Set<string>();
    for (const b of list) {
      seen.add(b.id);
      let el = this.bubbleEls.get(b.id);
      if (!el) { el = document.createElement('div'); el.className = 'bubble'; this.el.labels!.appendChild(el); this.bubbleEls.set(b.id, el); }
      if (el.textContent !== b.text) el.textContent = b.text;
      el.style.transform = `translate(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (const [id, el] of this.bubbleEls) if (!seen.has(id)) { el.remove(); this.bubbleEls.delete(id); }
  }

  get friendsOpen(): boolean {
    return this.el.friendsSheet!.dataset.open === 'true';
  }
  toggleFriends(open = !this.friendsOpen) {
    if (open) { this.toggleJournal(false); this.toggleBag(false); this.toggleAbout(false); this.toggleStash(false); this.toggleBench(false); this.toggleChat(false); this.el.statusSheet!.dataset.open = 'false'; }
    const was = this.friendsOpen;
    this.el.friendsSheet!.dataset.open = String(open);
    if (open && !was) this.h.social?.({ a: 'opened' });
    // Closed, nobody's card is open: their messages no longer count as read.
    if (was && !open && this.person) this.h.social?.({ a: 'back' });
  }

  /** The friends panel: the list, or someone's card. Only written to the page when it changed. */
  setFriends(v: FriendsView, note: string | null) {
    const p = v.person;
    this.person = p?.id ?? null;
    const row = (x: { id: string; name: string }, inner: string) => `<div class="frow"><span class="fname">${esc(x.name)}</span>${inner}</div>`;
    const btn = (act: string, x: { id: string; name: string } | null, label: string, cls = '') =>
      `<button type="button" class="act ${cls}" data-act="${act}"${x ? ` data-id="${esc(x.id)}" data-name="${esc(x.name)}"` : ''}>${label}</button>`;
    const rows = [
      v.incoming.length ? `<h3>Asking you</h3>${v.incoming.map(x => row(x, btn('accept', x, 'Accept', 'go') + btn('decline', x, 'No'))).join('')}` : '',
      `<h3>Friends</h3>${v.friends.length
        ? v.friends.map(x => `<button type="button" class="frow open" data-act="open" data-id="${esc(x.id)}" data-name="${esc(x.name)}"><span class="fname">${x.unread ? '<i class="dot"></i>' : ''}${esc(x.name)}</span><span class="fwhere" data-on="${x.where !== 'offline'}">${esc(x.where)}</span></button>`).join('')
        : '<p class="hint">No friends yet. Ask someone by name, or tap their name tag.</p>'}`,
      v.outgoing.length ? `<h3>You asked</h3>${v.outgoing.map(x => row(x, btn('unfriend', x, 'Take back'))).join('')}` : '',
      v.blocked.length ? `<h3>Blocked</h3>${v.blocked.map(x => row(x, btn('unblock', x, 'Unblock'))).join('')}` : '',
    ].join('');
    if (rows !== this.shown.friends) { this.shown.friends = rows; this.el.friendsRows!.innerHTML = rows; }
    (this.el.requestsOn as HTMLInputElement).checked = !v.requestsOff;
    this.el.friendsTitle!.textContent = p ? p.name : 'Friends';
    // A guest has no friends yet: one card says what signing in opens, whoever's name tag brought them here.
    this.el.friendsGate!.hidden = !this.guest;
    const n = this.el.friendsNote!;
    if (this.guest) {
      this.el.friendsList!.hidden = this.el.personView!.hidden = this.el.friendsBack!.hidden = n.hidden = true;
      return;
    }
    this.el.friendsList!.hidden = !!p;
    this.el.personView!.hidden = !p;
    this.el.friendsBack!.hidden = !p;
    n.hidden = !note;
    if (note && n.textContent !== note) n.textContent = note;
    if (!p) { this.el.reasons!.hidden = true; return; }
    // Someone who plays as a guest cannot be asked yet, but can be blocked and reported like anyone.
    const guestCard = p.guest && p.standing === 'none';
    this.el.personWhere!.textContent = guestCard ? GUEST_CARD : { friend: `Friends · ${p.where}`, asked: 'You asked them to be friends', asking: 'They asked to be your friend', blocked: 'Blocked: they cannot ask you or write to you', none: '' }[p.standing];
    const acts = (guestCard ? '' : {
      friend: btn('unfriend', null, 'Unfriend'),
      asked: btn('unfriend', null, 'Take back'),
      asking: btn('accept', null, 'Accept', 'go') + btn('decline', null, 'No'),
      blocked: btn('unblock', null, 'Unblock'),
      none: btn('befriend', null, 'Ask to be friends', 'go'),
    }[p.standing]) + (p.standing === 'blocked' ? '' : btn('block', null, 'Block', 'toss')) + btn('report', null, 'Report', 'toss');
    if (acts !== this.shown.personActs) { this.shown.personActs = acts; this.el.personActs!.innerHTML = acts; }
    const talk = p.lines.map(l => `<p class="line"${l.mine ? ' data-mine' : ''}>${esc(l.text)}</p>`).join('') || (p.standing === 'friend' ? '<p class="hint">Messages wait for them until they read them.</p>' : '');
    if (talk !== this.shown.talk) {
      this.shown.talk = talk;
      this.el.talk!.innerHTML = talk;
      this.el.talk!.scrollTop = this.el.talk!.scrollHeight;
    }
    this.el.sayForm!.hidden = p.standing !== 'friend';
  }

  /** Dots for something new: on Friends and the menu button (a request or an unread message), and on the chat button (something said). */
  setNews(friends: boolean, chat: boolean) {
    this.news.social = friends;
    this.news.chat = chat;
    this.showNews();
  }
  /** A dot on the menu button and on Journal: a chapter you have not read yet. Opening the journal takes it away. */
  setJournalNews(on: boolean) {
    this.news.journal = on;
    this.showNews();
  }
  private showNews() {
    this.el.menuBtn!.toggleAttribute('data-news', this.news.social || this.news.journal);
    this.el.menuFriends!.toggleAttribute('data-news', this.news.social);
    this.el.menuJournal!.toggleAttribute('data-news', this.news.journal);
    this.el.chatBtn!.toggleAttribute('data-news', this.news.chat);
  }

  get journalOpen(): boolean {
    return this.el.journalSheet!.dataset.open === 'true';
  }
  toggleJournal(open = !this.journalOpen) {
    // It opens where the bag and the other panels do: one at a time.
    if (open) {
      this.el.friendsSheet!.dataset.open = 'false'; this.el.statusSheet!.dataset.open = 'false'; this.el.chatSheet!.dataset.open = 'false';
      this.toggleBag(false); this.toggleAbout(false); this.toggleStash(false); this.toggleBench(false);
      this.el.journalSheet!.scrollTop = 0;
      this.setJournalNews(false);
    }
    this.el.journalSheet!.dataset.open = String(open);
  }
  /** The chapters of the story you reached. Only written to the page when they changed; the menu offers the journal once there is one. */
  setJournal(v: JournalView) {
    this.el.menuJournal!.hidden = !v.chapters.length;
    const html = v.chapters.map(c => `<article class="chapter"${c.latest ? ' data-latest' : ''}><h3><span class="n">Chapter ${c.n}</span>${esc(c.title)}</h3><p>${esc(c.text)}</p></article>`).join('');
    if (html === this.shown.journal) return;
    this.shown.journal = html;
    this.el.journalBody!.innerHTML = html;
  }

  get stashOpen(): boolean {
    return this.el.stashSheet!.dataset.open === 'true';
  }
  /** Opens or closes the stash sheet (the chest at home), always without a card. Closing it tells the game. */
  toggleStash(open = !this.stashOpen) {
    const was = this.stashOpen;
    if (open) { this.el.friendsSheet!.dataset.open = 'false'; this.toggleJournal(false); this.el.chatSheet!.dataset.open = 'false'; this.toggleBag(false); this.toggleAbout(false); this.toggleBench(false); this.el.statusSheet!.dataset.open = 'false'; }
    // It opens at the top of the list, never on a card left from last time; closing, the card slides away with it.
    if (open && !was) { this.el.stashBody!.scrollTop = 0; if (this.docked === 'stash') this.closeCard(); }
    else if (!open && this.card?.where === 'stash') this.forgetCard();
    // What came in the parcels is said once: it goes with the panel.
    if (!open && this.parcelLines.length) { this.parcelLines = []; this.showParcels(); }
    this.el.stashSheet!.dataset.open = String(open);
    if (was && !open) this.h.stashClosed?.();
  }

  get benchOpen(): boolean {
    return this.el.benchSheet!.dataset.open === 'true';
  }
  /** Opens or closes the workbench sheet, always without a card. Closing it tells the game. */
  toggleBench(open = !this.benchOpen) {
    const was = this.benchOpen;
    if (open) { this.el.friendsSheet!.dataset.open = 'false'; this.toggleJournal(false); this.el.chatSheet!.dataset.open = 'false'; this.toggleBag(false); this.toggleAbout(false); this.toggleStash(false); this.el.statusSheet!.dataset.open = 'false'; }
    if (open && !was) { this.el.benchBody!.scrollTop = 0; if (this.docked === 'bench') this.closeCard(); }
    else if (!open && this.card?.where === 'bench') this.forgetCard();
    this.el.benchSheet!.dataset.open = String(open);
    if (was && !open) this.h.benchClosed?.();
  }

  /** The workbench's rows: mending, then what it makes. Each opens its card. Only written to the page when they changed. */
  setBench(recipes: RecipeView[]) {
    const html = recipes.map(r => `<button type="button" class="recipe" data-recipe="${esc(r.id)}"${r.can ? '' : ' data-short'} aria-label="${esc(`${r.name}${r.can ? ', ready' : ''}`)}"><span class="big">${r.icon}</span><span class="words"><b>${esc(r.name)}</b><span class="rfacts">${esc(r.facts)}</span>
      <span class="needs">${r.needs.map(n => `<span class="need"${n.have >= n.need ? '' : ' data-short'} title="${esc(n.name)}">${n.icon}<i>${Math.min(n.have, n.need)}/${n.need}</i></span>`).join('')}</span></span>
      <span class="more">${r.can ? '<i class="ready">Ready</i>' : ''}${ICON.more}</span></button>`).join('');
    if (html !== this.shown.bench) { this.shown.bench = html; this.el.benchList!.innerHTML = html; }
    this.refreshCard();
  }

  /** What you wear, slot by slot, in the stash sheet. */
  setWearing(worn: Array<WornView | null>) {
    SLOTS.forEach((sl, i) => {
      const el = this.root.querySelector<HTMLButtonElement>(`[data-wear="${sl}"]`)!, w = worn[i];
      const html = w ? `${w.icon}<span class="lbl">${sl}</span>${condBar(w.cond)}${w.quirk ? '<i class="quirk" aria-hidden="true">✦</i>' : ''}` : `<span class="lbl">${sl}</span>`;
      if (el.innerHTML !== html) el.innerHTML = html;
      el.dataset.empty = String(!w);
      el.setAttribute('aria-label', w ? `${w.name}${w.cond === undefined ? '' : `, ${Math.round(w.cond * 100)}% left`}${w.quirk ? `, ${w.quirk}` : ''}` : `${sl}: nothing`);
    });
    this.refreshCard();
  }

  /** At the top of the open stash: what came in parcels, since it last opened or while it is open. It goes when the stash closes. */
  addParcels(lines: readonly string[]) {
    this.parcelLines = [...this.parcelLines, ...lines];
    this.showParcels();
  }

  private showParcels() {
    const el = this.el.stashParcels!;
    el.hidden = !this.parcelLines.length;
    el.replaceChildren(...this.parcelLines.map(t => { const p = document.createElement('p'); p.textContent = t; return p; }));
  }

  /** What the open stash holds, and your XP for its header. Only written to the page when it changed. */
  setStash(stash: SlotView[], xp: string) {
    // A piece shows how worn it is (nothing, for gear that never wears); anything else, how many.
    const html = stash.map(s => `<button type="button" class="slot" data-item="${esc(s.item)}"${s.slot ? ` data-gear="1" data-n="${s.n ?? 0}"` : ''} aria-label="${esc(`${s.name}${s.slot ? (s.cond === undefined ? '' : `, ${Math.round(s.cond * 100)}% left`) : `, ${s.count}`}`)}">${s.icon}${s.slot ? condBar(s.cond) : `<span class="n">${s.count}</span>`}</button>`).join('');
    if (html !== this.shown.stash) { this.shown.stash = html; this.el.stashGrid!.innerHTML = html; }
    this.el.stashEmpty!.hidden = stash.length > 0;
    if (this.el.stashXp!.textContent !== xp) this.el.stashXp!.textContent = xp;
    this.refreshCard();
  }

  /** A card is open in the stash or at the workbench. */
  get cardOpen(): boolean {
    return !!this.card;
  }

  /**
   * A tap in the stash or at the workbench. On something, it opens its card (on the thing whose card
   * is open, it closes it, as in the bag); a second tap on the same thing, or on the card just where
   * the first one was, within DOUBLE_TAP_MS, does what the card's button does. Keys that press a
   * focused button (detail 0) only ever open cards.
   */
  private sheetTap(where: 'stash' | 'bench', e: MouseEvent) {
    const target = e.target as Element, ref = this.refAt(where, target);
    const onCard = !!target.closest('.dock');
    if (e.detail === 0) {
      if (ref && ref !== 'empty') this.openCard(where, ref);
      return;
    }
    if (ref && ref !== 'empty') {
      const second = this.taps.tap(refKey(ref), e.timeStamp, e.clientX, e.clientY) === 'second';
      this.tapped = ref;
      if (second) this.doCard(where, ref);
      else if (this.card && refKey(this.card.ref) === refKey(ref)) this.closeCard(false);
      else this.openCard(where, ref);
      return;
    }
    if (onCard) {
      if (this.taps.tap(null, e.timeStamp, e.clientX, e.clientY) === 'second' && this.tapped) {
        // Not the button's own click as well.
        e.preventDefault();
        this.doCard(where, this.tapped);
      }
      return;
    }
    this.taps.clear();
    // An empty slot closes the card, as it does in the bag.
    if (ref === 'empty') this.closeCard();
  }

  /** What a tap on `target` is on: something with a card, an empty slot, or nothing to show. */
  private refAt(where: 'stash' | 'bench', target: Element): DetailRef | 'empty' | null {
    if (target.closest('.dock')) return null;
    if (where === 'bench') {
      const id = target.closest<HTMLElement>('[data-recipe]')?.dataset.recipe;
      if (!id) return null;
      return id.startsWith('mend:') ? { from: 'mend', slot: id.slice(5) as Slot } : { from: 'recipe', id };
    }
    const bag = target.closest<HTMLElement>('[data-bag]');
    if (bag) {
      const slot = Number(bag.dataset.bag), s = this.bag[slot];
      return s ? { from: 'bag', slot, item: s.item } : 'empty';
    }
    const wear = target.closest<HTMLElement>('[data-wear]');
    if (wear) return wear.dataset.empty === 'true' ? 'empty' : { from: 'worn', slot: wear.dataset.wear as Slot };
    const it = target.closest<HTMLElement>('[data-item]');
    if (it) return it.dataset.n === undefined ? { from: 'stash', item: it.dataset.item! } : { from: 'stash', item: it.dataset.item!, n: Number(it.dataset.n) };
    return null;
  }

  private openCard(where: 'stash' | 'bench', ref: DetailRef) {
    const view = this.h.details?.(ref);
    if (!view) return this.closeCard();
    this.card = { where, ref, view };
    this.showCard();
    this.reveal(where, ref);
  }

  /**
   * Once a double tap can no longer come, scrolls what the card is about into sight if the card now
   * hides it. Not sooner: the list moving under the finger would turn a double tap into two taps.
   */
  private reveal(where: 'stash' | 'bench', ref: DetailRef) {
    clearTimeout(this.revealTimer);
    this.revealTimer = setTimeout(() => {
      if (!this.card || this.card.where !== where || refKey(this.card.ref) !== refKey(ref)) return;
      const body = this.el[`${where}Body`]!, el = body.querySelector(pickedSelector(ref));
      if (!el) return;
      const view = body.getBoundingClientRect(), r = el.getBoundingClientRect(), margin = 8;
      const by = r.bottom > view.bottom - margin ? r.bottom - view.bottom + margin : r.top < view.top + margin ? r.top - view.top - margin : 0;
      if (by) body.scrollBy({ top: by, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }, DOUBLE_TAP_MS + 20);
  }

  /** Closes the card; `forget` false keeps the last tap, so the next one can still make it a double tap. */
  private closeCard(forget = true) {
    if (forget) { this.taps.clear(); this.tapped = null; }
    clearTimeout(this.revealTimer);
    if (!this.card && !this.docked) return;
    this.card = null;
    this.showCard();
  }

  /** No card any more, while its panel slides away with it still drawn: the next open clears it. */
  private forgetCard() {
    this.card = null;
    this.taps.clear();
    this.tapped = null;
    clearTimeout(this.revealTimer);
  }

  /** The open card as the game stands now: it follows what changes, and closes when what it is about is gone. */
  private refreshCard() {
    if (!this.card) return;
    const view = this.h.details?.(this.card.ref);
    if (!view) return this.closeCard();
    this.card.view = view;
    this.showCard();
  }

  /** Draws the open card in its sheet's dock (only when it changed), and marks what it is about. */
  private showCard() {
    const c = this.card, html = c ? cardHtml(c.view) : '', want = c?.where ?? null;
    if (this.docked !== want) {
      for (const [where, open] of [[this.docked, false], [want, true]] as const) {
        if (!where) continue;
        this.el[`${where}Dock`]!.hidden = !open;
        // In landscape the sheet makes room for the card beside the list (style.css).
        this.el[`${where}Sheet`]!.toggleAttribute('data-card', open);
      }
      this.docked = want;
    }
    if (c && html !== this.shown.card) this.el[`${c.where}Card`]!.innerHTML = html;
    this.shown.card = html;
    for (const sheet of [this.el.stashSheet!, this.el.benchSheet!]) for (const el of sheet.querySelectorAll('[data-picked]')) el.removeAttribute('data-picked');
    if (c) this.el[`${c.where}Body`]!.querySelector(pickedSelector(c.ref))?.setAttribute('data-picked', '');
  }

  /** A: presses the open card's button. False when no card is open. */
  pressCard(): boolean {
    if (!this.card) return false;
    this.doCard(this.card.where, this.card.ref);
    return true;
  }

  /** Does what the card of `ref` says, as the game stands now, and closes it; a card that can do nothing now stays open to say why. */
  private doCard(where: 'stash' | 'bench', ref: DetailRef) {
    const view = this.h.details?.(ref);
    if (!view) return this.closeCard();
    const press = cardPress(view);
    if (press.close) this.closeCard();
    else this.openCard(where, ref);
    // Its button, greyed out, gives a shake: the card says why (and the text box too, for making and mending).
    const button = press.shake ? this.el[`${where}Card`]!.querySelector('[data-card-act]') : null;
    if (button && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      button.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], { duration: 260, easing: 'ease-out' });
    }
    if (press.does) this.run(press.does);
  }

  private run(a: DetailAct) {
    switch (a.kind) {
      case 'store': return this.h.store?.(a.slot);
      case 'take': return this.h.take?.(a.item);
      case 'wear': return this.h.equip?.(a.item, a.n);
      case 'off': return this.h.unequip?.(a.slot);
      case 'make': return this.bench(a.recipe);
      case 'mend': return this.bench(`mend:${a.slot}`);
      case 'open': return this.h.open?.(a.item);
    }
  }

  /** The one way making and mending leave the workbench's panel: whatever asks first before using things up wraps `craft`. */
  private bench(id: string) {
    this.h.craft?.(id);
  }

  /** Your level next to your name. */
  setLevel(level: number) {
    const t = `Lv ${level}`, el = this.el.level!;
    if (el.textContent !== t) el.textContent = t;
    el.hidden = false;
  }

  /** What the status panel shows. Only written to the page when it changed. */
  setStatus(v: StatusView) {
    const html = statusHtml(v);
    if (html === this.shown.status) return;
    this.shown.status = html;
    this.el.statusBody!.innerHTML = html;
  }
  toggleBag(open = !this.bagOpen) {
    // The bag, the status and the About panel open in the same place: one at a time.
    if (open) { this.el.friendsSheet!.dataset.open = 'false'; this.toggleJournal(false); this.el.chatSheet!.dataset.open = 'false'; this.toggleAbout(false); this.toggleStash(false); this.toggleBench(false); }
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
    if (open) { this.el.friendsSheet!.dataset.open = 'false'; this.el.statusSheet!.dataset.open = 'false'; this.toggleJournal(false); this.el.chatSheet!.dataset.open = 'false'; this.toggleStash(false); this.toggleBench(false); }
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

  /** Your tools, as buttons in the bag's header: first one button for all your maps (`map`, its icon; it opens the one for where you are), then the rest. */
  setTools(tools: Array<{ item: string; name: string; icon: string }>, map: string | null = null) {
    const html = (map ? `<button type="button" class="slot" data-map aria-label="Open the map">${map}</button>` : '')
      + tools.map(t => `<button type="button" class="slot" data-tool="${esc(t.item)}" aria-label="${esc(`Open the ${t.name.toLowerCase()}`)}">${t.icon}</button>`).join('');
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
    if (this.chatOpen) { this.toggleChat(false); return true; }
    if (this.friendsOpen) {
      // A guest sees the same card whoever it was opened for: B closes it at once.
      if (this.person && !this.guest) this.h.social?.({ a: 'back' });
      else this.toggleFriends(false);
      return true;
    }
    if (this.statusOpen) { this.toggleStatus(false); return true; }
    if (this.journalOpen) { this.toggleJournal(false); return true; }
    // Out of a card first, then out of its panel: B backs out one step at a time.
    if (this.card) { this.closeCard(); return true; }
    if (this.stashOpen) { this.toggleStash(false); return true; }
    if (this.benchOpen) { this.toggleBench(false); return true; }
    if (!this.bagOpen) return false;
    if (this.picked) { this.choose(null); return true; }
    return false;
  }

  /** The bag, slot by slot (the server's order). Call it when the bag changes. */
  setBag(slots: SlotView[], capacity: number = BAG_SLOTS, at = 0) {
    this.bag = slots;
    this.bagAt = at;
    this.liveShown.clear();
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
      el.innerHTML = s ? slotHtml(s) : '';
      el.setAttribute('aria-label', s ? `${s.name}, ${s.count}` : 'Empty slot');
    });
    this.showRoom();
    this.showDetail();
    // The stash sheet's bag row shows the same slots.
    this.root.querySelectorAll<HTMLButtonElement>('[data-bag]').forEach((el, i) => {
      const s = slots[i];
      el.dataset.empty = String(!s);
      el.innerHTML = s ? slotHtml(s) : '';
      el.setAttribute('aria-label', s ? `${s.name}, ${s.count}` : 'Empty slot');
    });
    (this.el.storeAll as HTMLButtonElement).disabled = !slots.length;
    this.refreshCard();
  }

  /**
   * Live finds count down: the ring on each one's slot, and the line in its details. Every frame; it
   * touches the page only when a shown value changes.
   */
  tickLive(now: number) {
    const rows = [this.slotEls, [...this.root.querySelectorAll<HTMLElement>('[data-bag]')]];
    this.bag.forEach((s, i) => {
      if (!s.live) return;
      const st = liveState(s.live, s.live.age + Math.max(0, now - this.bagAt) / 1000), key = `${st.text}|${st.left.toFixed(2)}`;
      if (this.liveShown.get(i) === key) return;
      this.liveShown.set(i, key);
      for (const row of rows) {
        const ring = row[i]?.querySelector<HTMLElement>('.ring');
        ring?.style.setProperty('--left', st.left.toFixed(2));
        ring?.toggleAttribute('data-fading', st.fading);
      }
      if (this.picked?.slot === i) this.el.itemFacts!.textContent = [st.text, ...s.facts].join(' · ');
    });
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
    this.showDetail();
  }

  /** Under the slots: what the open slot holds and what can be done with it, or a hint. */
  private showDetail() {
    const p = this.picked, s = p ? this.bag[p.slot] : undefined;
    this.slotEls.forEach((el, i) => el.toggleAttribute('data-picked', i === p?.slot));
    this.el.hint!.hidden = !!s;
    this.el.about!.hidden = this.el.acts!.hidden = true;
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
    // Its countdown line comes with the next tickLive.
    this.liveShown.delete(p!.slot);
    this.el.use!.textContent = s.useLabel;
    this.el.acts!.hidden = false;
    this.el.use!.hidden = !s.usable;
  }

  get menuOpen(): boolean {
    return !this.el.menu!.hidden;
  }
  toggleMenu(open = !this.menuOpen) {
    this.el.menu!.hidden = !open;
    this.el.menuBtn!.setAttribute('aria-expanded', String(open));
  }

  setName(name: string) { this.el.name!.textContent = name; }

  /**
   * You play as a guest, or not (signed in): the Guest label and its Sign in button under your name,
   * and in the chat and the friends panel, one card saying what signing in opens, in place of what
   * a guest cannot use yet.
   */
  setGuest(on: boolean) {
    this.guest = on;
    this.el.guest!.hidden = !on;
    this.el.chatForm!.hidden = on;
    this.el.chatGate!.hidden = !on;
    this.el.friendsGate!.hidden = !on;
    if (on) this.el.friendsList!.hidden = this.el.personView!.hidden = this.el.friendsBack!.hidden = this.el.friendsNote!.hidden = true;
  }
  /** The sound setting this browser keeps, on the menu's sound row. */
  setSound(s: SoundSetting) { this.showSound(s); }
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
  /** A banner is up: the name of a place just reached, or news. */
  get bannerUp(): boolean {
    return this.el.banner!.hasAttribute('data-show');
  }
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

  /** Someone's lines in the text box, typed out as far as `text` goes. Called every frame. */
  setDialog(d: DialogView | null) {
    this.box.talk = d;
    this.showBox();
  }

  /** A question in the text box (ask.ts), or none. Called when it changes. */
  setAsk(q: AskView | null) {
    this.box.ask = q;
    this.showBox();
  }

  /** What the text box says by itself, or nothing. Called when it changes: a new one starts its line running out. */
  setNote(n: NoteView | null) {
    this.box.note = n;
    const timer = this.el.timer!;
    for (const a of timer.getAnimations()) a.cancel();
    timer.hidden = !n || n.waiting;
    // One animation per note, run by the browser: nothing to do each frame.
    if (n && !n.waiting && n.ms > 0) timer.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: n.ms, easing: 'linear', fill: 'forwards' });
    this.showBox();
  }

  /**
   * The text box: a question first, then what it says by itself, then someone's lines. A question and
   * what the box says by itself stand above the panels, over a scrim that takes a tap anywhere else;
   * A, B and the stick stay above it. Only what changed is written to the page.
   */
  private showBox() {
    const { talk, ask, note } = this.box, s = this.boxShown;
    const mode = ask ? 'ask' : note ? 'note' : talk ? 'talk' : '';
    if (mode !== s.mode) {
      s.mode = mode;
      this.root.classList.toggle('talking', !!mode);
      this.root.classList.toggle('asking', mode === 'ask' || mode === 'note');
      this.el.dialog!.dataset.mode = mode;
      this.el.scrim!.hidden = mode !== 'ask' && mode !== 'note';
      this.el.choices!.hidden = mode !== 'ask';
    }
    const shown = ask ?? note ?? talk;
    if (!shown) return;
    if (shown.who !== s.who) this.el.who!.textContent = s.who = shown.who;
    if (shown.text !== s.text) this.el.text!.textContent = s.text = shown.text;
    const done = mode === 'talk' && !!talk?.done;
    if (done !== s.done) this.el.more!.style.visibility = (s.done = done) ? 'visible' : 'hidden';
    // A question comes anew with every change (setAsk), so the same one is never drawn twice.
    if (ask === s.ask) return;
    s.ask = ask;
    for (const b of this.el.choices!.querySelectorAll<HTMLElement>('[data-choice]')) {
      const on = b.dataset.choice === ask?.choice;
      b.toggleAttribute('data-on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    const c = ask?.count;
    this.el.count!.hidden = !c;
    if (!c) return;
    this.el.countN!.textContent = `×${c.n}`;
    // Dimmed at either end, but still pressable, so a finger holding it never gets stuck.
    const [less, more] = this.el.count!.querySelectorAll<HTMLElement>('[data-step]');
    less!.setAttribute('aria-disabled', String(c.n <= c.min));
    more!.setAttribute('aria-disabled', String(c.n >= c.max));
  }

  /** Name tags above other players and near piles, positioned in screen pixels. */
  setTags(tags: TagView[]) {
    const seen = new Set<string>();
    for (const t of tags) {
      seen.add(t.id);
      let el = this.tagEls.get(t.id);
      if (!el) {
        el = document.createElement('div');
        el.className = t.pile ? 'tag pile' : 'tag';
        // A player's tag can be tapped: their card, to ask them to be friends (or block or report them).
        if (!t.pile) el.dataset.player = t.id;
        this.el.labels!.appendChild(el);
        this.tagEls.set(t.id, el);
      }
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

/** A bag slot's drawing and count; a live find gets its countdown ring (tickLive turns it). */
function slotHtml(s: SlotView): string {
  return `${s.live ? '<i class="ring" aria-hidden="true"></i>' : ''}${s.icon}<span class="n">${s.count}</span>`;
}

/** A thin bar along a slot's bottom: how much of a piece is left. Nothing for gear that never wears. */
function condBar(cond: number | undefined): string {
  if (cond === undefined) return '';
  return `<span class="cond" data-low="${cond < 0.25}"><i style="transform:scaleX(${Math.min(1, Math.max(0, cond)).toFixed(3)})"></i></span>`;
}

/**
 * A card as the page shows it (details.ts), in the look of the bag's details: the drawing, the name
 * with its tier, the slot, its words, a chip for each thing it gives (what wear cut struck through
 * beside it), how worn it is, its quirk, what it takes, notes, and its one button.
 */
export function cardHtml(v: DetailView): string {
  const title = `<div class="title"><b>${esc(v.name)}</b>${v.count && v.count > 1 ? `<span class="count">× ${v.count}</span>` : ''}${v.tier ? `<span class="tier" data-tier="${v.tier.id}">${esc(v.tier.name)}</span>` : ''}</div>`;
  const stats = v.stats.length
    ? `<ul class="stats">${v.stats.map(s => `<li data-kind="${s.kind}" aria-label="${esc(statText(s))}">${esc(s.text)}${s.whole ? `<s>${esc(s.whole)}</s>` : ''}</li>`).join('')}</ul>`
    : '';
  const cond = v.cond
    ? `<div class="condition" data-low="${v.cond.low}">${v.cond.bar ? `<span class="cbar" aria-hidden="true"><i style="transform:scaleX(${v.cond.share.toFixed(3)})"></i></span>` : ''}<span>${esc(v.cond.words)}</span></div>`
    : '';
  const costs = v.costs
    ? `<div class="costs"><span class="ctitle">${esc(v.costs.title)}</span>${v.costs.needs.map(n => `<span class="cost"${n.have >= n.need ? '' : ' data-short'} aria-label="${esc(`${n.name}: it takes ${n.need}, you have ${n.have}`)}">${n.icon}<span class="cname">${esc(n.name)}</span><i>${n.have}/${n.need}</i></span>`).join('')}</div>`
    : '';
  const act = v.act
    ? `<div class="acts"><button type="button" class="act go" data-card-act${v.act.enabled ? '' : ' aria-disabled="true"'}>${esc(v.act.label)}${v.act.then ? ` <span class="then">(${esc(v.act.then)})</span>` : ''}</button></div>`
    : '';
  return `<div class="about"><div class="big">${v.icon}</div><div class="words">${title}${v.slot ? `<p class="slotname">${esc(v.slot)}</p>` : ''}<p>${esc(v.text)}</p>${stats}`
    + `${v.facts.length ? `<p class="facts">${esc(v.facts.join(' · '))}</p>` : ''}${cond}${v.quirk ? `<p class="quirk"><b>✦ ${esc(v.quirk.name)}</b> ${esc(v.quirk.text)}</p>` : ''}${costs}`
    + `${v.notes.map(n => `<p class="note" data-tone="${n.tone}">${esc(n.text)}</p>`).join('')}</div></div>${act}`;
}

/** Where in its sheet's list the thing a card is about is drawn. */
function pickedSelector(r: DetailRef): string {
  switch (r.from) {
    case 'bag': return `[data-bag="${r.slot}"]`;
    case 'worn': return `[data-wear="${r.slot}"]`;
    case 'stash': return r.n === undefined ? `[data-item="${r.item}"]:not([data-n])` : `[data-item="${r.item}"][data-n="${r.n}"]`;
    case 'recipe': return `[data-recipe="${r.id}"]`;
    case 'mend': return `[data-recipe="mend:${r.slot}"]`;
  }
}

function esc(t: string): string {
  return t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
