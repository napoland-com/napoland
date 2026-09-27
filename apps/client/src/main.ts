/**
 * Boot: ask the server how to sign in, sign in (signin.ts), connect, then run the game loop.
 */
// The fonts come with the game, so the page loads nothing from other sites (the privacy policy
// promises it). Vite bundles their files; a browser downloads only the alphabets a page shows.
import '@fontsource-variable/fredoka';
import '@fontsource-variable/nunito';
import './style.css';
import { HUM_BEFORE_S, bagSlotsOf, surgeFront, type AuthConfig, type BagSlot, type Dir, type Gear, type ItemsData, type MapData, type MapRef, type ServerMsg, type ChatTo, type Slot, type Weather, type Worn } from '@napoland/shared';
import { loadVersion, signInFooter } from './about';
import { Arrival } from './arrival';
import { Game } from './game';
import { friendsView, lastFrom } from './friends';
import { Hud, type TagView } from './hud';
import { iconFor } from './icons';
import { Items, mendViews, quirkNames, recipeViews, resistText, slotViews, wearText, wornViews } from './items';
import { Keys, keyTarget } from './keys';
import { Maps } from './maps';
import { paperMap } from './papermap';
import { Connection, serverUrl } from './net';
import { Sound, type SoundSetting } from './sound';
import { soundscape, type Scene } from './soundscape';
import { CODE_LENGTH, SignIn, digits, loadAuthConfig, type AuthBackend, type Screen } from './signin';
import { levelText, newsBanner, statusView } from './status';
import { fireLevel } from './view/fire';
import { PRINT_S } from './view/wilds';
import { WorldView, createRenderer, lightningAt } from './view/world';
import { guardZoom } from './zoom';

// Before anything can be touched: on iPhones two thumbs (the stick and A) would zoom the page.
guardZoom({ doc: document, viewport: window.visualViewport, meta: document.querySelector<HTMLMetaElement>('meta[name="viewport"]') });

/** When this page last reloaded because it was out of date (see outdated()). */
const RELOAD_KEY = 'napoland.reloadedAt';
/** A browser storage that never throws (private mode, storage turned off): it just forgets. */
const safe = (storage: () => Storage) => ({
  get: (k: string) => { try { return storage().getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { storage().setItem(k, v); } catch { /* private mode */ } },
  del: (k: string) => { try { storage().removeItem(k); } catch { /* private mode */ } },
});
/** What this browser keeps, and what only this tab keeps (so in dev mode each tab can be someone else). */
const store = safe(() => localStorage);
const tabStore = safe(() => sessionStorage);
/** The sound's volume and mute, as this browser keeps them. */
const SOUND_KEY = 'napoland.sound';
const soundSetting = ((): SoundSetting => {
  try {
    const s = JSON.parse(store.get(SOUND_KEY) ?? '{}') as Partial<SoundSetting>;
    return { volume: typeof s.volume === 'number' ? Math.min(1, Math.max(0, s.volume)) : 0.7, muted: s.muted === true };
  } catch { return { volume: 0.7, muted: false }; }
})();
const sound = new Sound(soundSetting);

// Every map is bundled, so moving between them needs no download; the items too, so the bag can
// name what it holds. (A glob, not an import: a checkout without items.json still builds, and the
// version check below sends it the message that it does not match.)
const maps = new Maps(Object.values(import.meta.glob<MapData>('../../../content/maps/*.json', { eager: true, import: 'default' })));
const items = new Items(Object.values(import.meta.glob<ItemsData>('../../../content/items.json', { eager: true, import: 'default' }))[0]);
const app = document.getElementById('app')!;
const screen = document.createElement('div');
screen.className = 'screen';
const canvas = document.createElement('canvas');
canvas.className = 'world';
screen.appendChild(canvas);
app.appendChild(screen);

const renderer = createRenderer(canvas);
/** A view sees other maps' data: a house whose room keeps a fire has smoke over its chimney. */
const peek = (id: string) => maps.find(id);
/** The view of the map you are on; replaced (and the old one freed) when you arrive somewhere else. */
let view = new WorldView(renderer, maps.home(), peek);
/** Every view asks the game how big each fire burns, as it draws. */
const watchFires = (v: WorldView) => v.setFires((x, y) => fireLevel(game.fireLeft(x, y, performance.now())));
let weather: Weather = 'rain';
/** The server accepts game messages only after its welcome on the current connection. */
let welcomed = false;
/** The first welcome of this page shows where you are; later ones are reconnects. */
let arrived = false;
const game = new Game(maps, msg => { if (welcomed) conn.send(msg); }, items);
/** Close the bag, the status and About panels and the menu; true when one was open. */
const closePanels = () => {
  const open = hud.bagOpen || hud.statusOpen || hud.aboutOpen || hud.stashOpen || hud.benchOpen || hud.menuOpen || hud.friendsOpen || hud.chatOpen || hud.paperOpen;
  hud.showPaper(null);
  hud.toggleBag(false); hud.toggleStatus(false); hud.toggleAbout(false); hud.toggleStash(false); hud.toggleBench(false); hud.toggleMenu(false); hud.toggleFriends(false); hud.toggleChat(false);
  return open;
};
/** The status panel, as the game stands now. */
const showStatus = () => {
  const now = performance.now();
  hud.setStatus(statusView({
    energy: game.energy(now), body: game.bodyNow(now), surge: game.surgeNow(now), caught: game.caught(now), stone: game.stone, stats: game.stats, bag: game.bag, items,
    progress: game.progress, resists: resistText(game.myGear, items, game.myWorn),
    wear: wearText(game.myGear, game.myWorn, items), quirks: quirkNames(game.myWorn, items),
    storm: game.stormNow(now), flash: game.flashed(now), weather, wilds: game.map.data.kind === 'wilds',
  }));
};
/** The stick and A and B, on screen or on the keyboard (keys.ts): the same handlers either way. */
const controls = {
  pad: (dir: Dir | null) => { if (dir) closePanels(); game.padChange(dir, performance.now()); },
  a: () => { if (hud.paperOpen) hud.showPaper(null); else if (hud.menuOpen) hud.toggleMenu(false); else if (hud.aboutOpen) hud.toggleAbout(false); else if (hud.statusOpen) hud.toggleStatus(false); else if (hud.stashOpen) hud.toggleStash(false); else if (hud.benchOpen) hud.toggleBench(false); else if (hud.friendsOpen) hud.toggleFriends(false); else if (hud.chatOpen) hud.toggleChat(false); else if (hud.bagOpen) hud.toggleBag(false); else game.pressA(); },
  // Back out of the About panel and the text box, then out of the status or the bag's details, before the bag itself opens or closes.
  b: () => { if (hud.paperOpen) hud.showPaper(null); else if (hud.menuOpen) hud.toggleMenu(false); else if (hud.aboutOpen) hud.toggleAbout(false); else if (!game.pressB() && !hud.back()) hud.toggleBag(); },
};
const hud = new Hud(screen, {
  ...controls,
  dialogTap: () => game.advanceDialog(),
  logout: () => signOut(),
  // Using something shows what it did over your head (and on the energy bar), so the bag closes.
  use: slot => { game.use(slot); hud.toggleBag(false); },
  discard: slot => game.discard(slot),
  status: showStatus,
  store: slot => game.store(slot),
  take: item => game.take(item),
  stashClosed: () => game.closeChest(),
  equip: (item, n) => game.equip(item, n),
  unequip: slot => game.unequip(slot),
  // The workbench's rows are recipes, and mending ("mend:" and the slot).
  craft: recipe => (recipe.startsWith('mend:') ? game.mend(recipe.slice(5) as Slot) : game.craft(recipe)),
  benchClosed: () => game.closeBench(),
  chat: a => {
    if (a.a === 'tab') chatTab = a.to;
    else if (a.a === 'say') game.say(a.to, a.text);
  },
  social: a => {
    switch (a.a) {
      case 'opened': friendsAskedAt = 0; return;
      case 'person': game.openPerson({ id: a.id, name: a.name }); return hud.toggleFriends(true);
      case 'back': return game.openPerson(null);
      case 'befriend': return game.befriend(a.id ? { id: a.id } : { name: a.name ?? '' });
      case 'answer': return game.social({ t: 'answer', id: a.id, yes: a.yes });
      case 'unfriend': return game.social({ t: 'unfriend', id: a.id });
      case 'block': return game.social({ t: 'block', id: a.id, on: a.on });
      case 'requests': return game.social({ t: 'requests', off: a.off });
      case 'tell': return game.tell(a.id, a.text);
      case 'report': {
        // What they wrote last goes with it (a private message, or else a line of chat): the server keeps neither.
        const quote = lastFrom(game.talks.get(a.id)) ?? game.chat.findLast(l => l.id === a.id)?.text;
        game.social({ t: 'report', id: a.id, reason: a.reason, ...(quote ? { quote } : {}) });
        game.socialNote = 'Reported. Thank you: the maintainers will look into it.';
        game.socialChanges++;
        return;
      }
    }
  },
  // A paper map: drawn from our copy of the map it charts, and never with you on it.
  tool: item => {
    const chart = items.get(item).chart, data = chart ? maps.find(chart) : undefined;
    const map = data && maps.get(data);
    if (!map) return;
    hud.toggleBag(false);
    hud.showPaper(paperMap(map, id => maps.find(id)?.name));
  },
  version: () => loadVersion(),
  sound: s => { sound.set(s); store.set(SOUND_KEY, JSON.stringify(s)); },
});
hud.setSound(soundSetting);
watchFires(view);

// ---------- the keyboard, on a computer ----------
const keys = new Keys(controls);
window.addEventListener('keydown', e => {
  // Behind the sign-in cards the keys are the page's (typing a name, pressing Enter to go on).
  if (!overlay.hidden) return;
  if (keys.down(e.code, keyTarget(e.target), e.repeat, e.ctrlKey || e.altKey || e.metaKey)) e.preventDefault();
});
window.addEventListener('keyup', e => keys.up(e.code));
window.addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => { if (document.hidden) keys.clear(); });

// ---------- arriving on another map ----------
/** Set when a collapse arrives: you were carrying something, which now lies where you fell. */
let leftPile = false;
/** Said under the map's name when you arrive: this sign-in just made the character yours. */
let claimNote = '';
/** On the black screen: apply what waited, build the new map's view (freeing the old one) and say where you are. */
const arrival = new Arrival(held => {
  const now = performance.now();
  let collapsed = false;
  for (const msg of held) {
    game.handle(msg, now);
    if (msg.t === 'zone') collapsed = msg.reason === 'collapse';
    else if (msg.t === 'welcome') { collapsed = false; arrived = true; }
  }
  hud.setOnline(game.players.size);
  if (view.map !== game.map) {
    view.dispose();
    view = new WorldView(renderer, game.map, peek);
    view.setWeather(weather);
    watchFires(view);
    resize();
  }
  if (collapsed) hud.showBanner('You collapsed from exhaustion', leftPile ? 'You woke up at home.\nWhat you carried lies where you fell. It fades in an hour.' : 'You woke up at home');
  else hud.showBanner(game.map.data.name, claimNote);
  claimNote = '';
});

// ---------- signing in, and status screens ----------
// One card at a time over the game; signin.ts decides which (see Screen). More ways to sign in
// (Google, Apple) will go on the email card, above the email. Every sign-in card ends with the
// small print: the privacy policy, the legal notice and the source code, before anyone signs in.
const overlay = document.createElement('div');
overlay.className = 'overlay';
overlay.innerHTML = `
  <form class="card panel" data-el="emailCard" novalidate hidden>
    <h1>napoland</h1>
    <p class="intro">Leave home, gather what glows, and get back before your energy runs out.</p>
    <label for="email" data-el="emailLabel">Your email</label>
    <input id="email" name="email" type="email" autocomplete="email" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" maxlength="254" placeholder="you@example.com" />
    <div class="err" data-el="emailErr" role="alert"></div>
    <button type="submit" data-el="emailBtn">Send me a code</button>
    <p class="fine" data-el="emailFine">We email you a ${CODE_LENGTH}-digit code to sign in. No password to remember.</p>
    ${signInFooter()}
  </form>
  <form class="card panel" data-el="codeCard" novalidate hidden>
    <h1>napoland</h1>
    <p>Enter the ${CODE_LENGTH}-digit code we sent to <b data-el="codeEmail"></b></p>
    <input id="code" name="code" class="code" inputmode="numeric" autocomplete="one-time-code" enterkeyhint="go" aria-label="The ${CODE_LENGTH}-digit code" placeholder="${'0'.repeat(CODE_LENGTH)}" />
    <div class="err" data-el="codeErr" role="alert"></div>
    <button type="submit" data-el="codeBtn">Sign in</button>
    <p class="fine">It can take a minute to arrive. Check your spam folder too.</p>
    <div class="links"><button type="button" class="link" data-el="resend">Send a new code</button><button type="button" class="link" data-el="changeEmail">Change email</button></div>
    ${signInFooter()}
  </form>
  <form class="card panel" data-el="nameCard" novalidate hidden>
    <h1>napoland</h1>
    <p data-el="nameIntro"></p>
    <label for="name" data-el="nameLabel">Your name</label>
    <input id="name" name="name" autocomplete="nickname" autocapitalize="words" maxlength="16" enterkeyhint="go" placeholder="2 to 16 letters or numbers" />
    <div class="err" data-el="nameErr" role="alert"></div>
    <button type="submit">Play</button>
    <div class="links" data-el="nameLinks" hidden><span class="who" data-el="who"></span><button type="button" class="link" data-el="nameSignOut">Sign out</button></div>
    ${signInFooter()}
  </form>
  <div class="card panel" data-el="msg">
    <h1>napoland</h1>
    <p data-el="msgText">Loading...</p>
    <button type="button" data-el="msgBtn" hidden></button>
  </div>`;
app.appendChild(overlay);
const el = Object.fromEntries([...overlay.querySelectorAll<HTMLElement>('[data-el]')].map(e => [e.dataset.el!, e]));
const card = (name: string) => el[name] as HTMLFormElement;
const text = (name: string) => el[name]!;
const button = (name: string) => el[name] as HTMLButtonElement;
const emailInput = overlay.querySelector<HTMLInputElement>('#email')!;
const codeInput = overlay.querySelector<HTMLInputElement>('#code')!;
const nameInput = overlay.querySelector<HTMLInputElement>('#name')!;

/** Set once the server has said how to sign in. */
let signin: SignIn | undefined;
/** The kind of card shown, so a card that updates (an error, the resend wait) keeps what was typed and the focus. */
let shown: Screen['kind'] | null = 'message';

function render(s: Screen) {
  const first = s.kind !== shown;
  shown = s.kind;
  overlay.hidden = s.kind === 'none';
  card('emailCard').hidden = s.kind !== 'email';
  card('codeCard').hidden = s.kind !== 'code';
  card('nameCard').hidden = s.kind !== 'name';
  text('msg').hidden = s.kind !== 'message';
  if (s.kind === 'message') {
    text('msgText').textContent = s.text;
    const btn = button('msgBtn');
    btn.hidden = !s.button;
    if (s.button) { btn.textContent = s.button.label; btn.onclick = s.button.run; }
  } else if (s.kind === 'email') {
    text('emailLabel').textContent = s.dev ? 'Your email (development: no code)' : 'Your email';
    const btn = button('emailBtn');
    btn.textContent = s.busy ? 'Sending...' : s.dev ? 'Sign in' : 'Send me a code';
    btn.disabled = s.busy;
    text('emailFine').hidden = s.dev;
    text('emailErr').textContent = s.error;
    if (first) { emailInput.value = s.email; focusSoon(emailInput); }
  } else if (s.kind === 'code') {
    text('codeEmail').textContent = s.email;
    const btn = button('codeBtn');
    btn.textContent = s.busy ? 'Checking...' : 'Sign in';
    btn.disabled = s.busy;
    const msg = text('codeErr');
    msg.textContent = s.error || s.note;
    msg.classList.toggle('ok', !s.error && !!s.note);
    showResend();
    // A whole code that was wrong goes, so the next one can be typed (or pasted) straight in.
    if (first || (s.error && !s.busy && digits(codeInput.value).length === CODE_LENGTH)) codeInput.value = '';
    if (first || (s.error && !s.busy)) focusSoon(codeInput);
  } else if (s.kind === 'name') {
    const intro = text('nameIntro');
    intro.textContent = s.signedIn ? 'Choose a name for your character.' : 'Leave home, gather what glows, and get back before your energy runs out.';
    // Without sign-in it is only the welcome, which a short screen can do without.
    intro.classList.toggle('intro', !s.signedIn);
    text('nameLabel').textContent = s.signedIn ? 'Name' : 'Your name';
    text('nameErr').textContent = s.error;
    text('nameLinks').hidden = !s.signedIn;
    text('who').textContent = s.who ? `Signed in as ${s.who}` : '';
    if (first) focusSoon(nameInput);
  }
}

function focusSoon(input: HTMLInputElement) {
  setTimeout(() => input.focus(), 50);
}

/** The resend button counts down the wait Supabase keeps between codes. */
function showResend() {
  const s = signin?.screen;
  if (s?.kind !== 'code') return;
  const wait = Math.ceil((s.resendAt - Date.now()) / 1000);
  const btn = button('resend');
  btn.disabled = s.busy || wait > 0;
  const label = wait > 0 ? `Send a new code (${wait} s)` : 'Send a new code';
  if (btn.textContent !== label) btn.textContent = label;
}
setInterval(showResend, 500);

card('emailCard').addEventListener('submit', e => { e.preventDefault(); void signin?.submitEmail(emailInput.value); });
card('codeCard').addEventListener('submit', e => { e.preventDefault(); void signin?.submitCode(codeInput.value); });
card('nameCard').addEventListener('submit', e => { e.preventDefault(); signin?.submitName(nameInput.value); });
// Typed, pasted ("123 456") or filled in from the email by the phone: digits only, and in it goes once whole.
codeInput.addEventListener('input', () => {
  const d = digits(codeInput.value);
  if (codeInput.value !== d) codeInput.value = d;
  if (d.length === CODE_LENGTH) void signin?.submitCode(d);
});
button('resend').addEventListener('click', () => void signin?.resend());
button('changeEmail').addEventListener('click', () => signin?.changeEmail());
button('nameSignOut').addEventListener('click', () => signOut());

/** "Sign out" (or "Log out" without sign-in): this browser forgets who plays here, and the page starts afresh. */
function signOut() {
  if (!signin) return;
  void signin.signOut().then(() => location.reload());
}

function showMessage(text: string, button?: { label: string; run: () => void }) {
  if (signin) signin.message(text, button);
  else render({ kind: 'message', text, ...(button && { button }) });
}

/**
 * This client does not match the server (another protocol, or a map we lack or have in another
 * version): reload to get the new version. If a reload a moment ago did not help (say the server
 * was not restarted after a map changed), ask instead of reloading over and over.
 */
function outdated() {
  conn.stop();
  const last = Number(tabStore.get(RELOAD_KEY) ?? 0);
  if (Date.now() - last < 30_000) {
    showMessage('This copy of the game does not match the server yet. Try again in a moment.', { label: 'Try again', run: () => location.reload() });
    return;
  }
  tabStore.set(RELOAD_KEY, String(Date.now()));
  showMessage('A new version is out. Loading it...');
  setTimeout(() => location.reload(), 800);
}
const known = (ref: MapRef) => !!maps.get(ref);

// It asks the sign-in what to say on every connection: a reconnect uses the freshest token.
const conn = new Connection(serverUrl(), () => signin?.hello() ?? null);
let ping: number | undefined;
conn.onOpen = () => { welcomed = false; hud.setConnection('connecting'); };
conn.onClose = () => { welcomed = false; game.disconnected(performance.now()); hud.setConnection('offline'); };
conn.onMessage = (msg: ServerMsg) => {
  const now = performance.now();
  switch (msg.t) {
    case 'welcome':
      if (!known(msg.map) || msg.items !== items.version) return outdated();
      welcomed = true;
      signin?.welcomed(msg);
      if (msg.claimed) claimNote = 'Your character is now linked to your account. Sign in anywhere to play it.';
      hud.setName(msg.name);
      hud.setConnection('online', ping);
      weather = msg.weather;
      view.setWeather(weather);
      break;
    case 'zone':
      if (!known(msg.map)) return outdated();
      // Asked now, while the bag is as it was: the zone waits for the black screen, and the empty bag
      // the collapse brings may come just before or just after it.
      if (msg.reason === 'collapse') leftPile = game.carrying(now);
      break;
    case 'weather':
      if (msg.weather === 'aurora' && weather !== 'aurora') hud.showBanner('Lights in the sky', 'An aurora: the old wires hum,\nand copper turns up by the poles.');
      weather = msg.weather;
      view.setWeather(weather);
      return;
    case 'pong':
      ping = now - msg.at;
      hud.setConnection('online', ping);
      return;
    case 'error':
      if (msg.code === 'bad_version') outdated();
      else void signin?.refused(msg.code, msg.message);
      return;
  }
  // A zone, and whatever comes after it, waits for the screen to go black (see arrival.ts).
  if (arrival.hold(msg)) return;
  game.handle(msg, now);
  hud.setOnline(game.players.size);
  if (msg.t === 'welcome') {
    if (!arrived || view.map !== game.map) {
      arrived = true;
      arrival.cut();
    } else if (claimNote) {
      // Back on the same map (a reconnect): no fade, but the news still gets said.
      hud.showBanner(game.map.data.name, claimNote);
    }
    claimNote = '';
  }
};
setInterval(() => conn.send({ t: 'ping', at: performance.now() }), 5000);

/** Asks the server how to sign in (until it answers), then signs in: at once with what this browser remembers, or with a card. */
async function boot() {
  let config: AuthConfig | undefined;
  for (let wait = 1000; !config; wait = Math.min(wait * 2, 10_000)) {
    try {
      config = await loadAuthConfig();
    } catch {
      showMessage('Cannot reach the game right now. Trying again...');
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  }
  let backend: AuthBackend | undefined;
  if (config.mode === 'supabase') backend = (await import('./supabase')).supabaseBackend(config.url, config.publishableKey);
  signin = new SignIn({
    config, backend, store, tab: tabStore, now: () => Date.now(),
    connect: () => conn.start(),
    disconnect: () => conn.stop(),
    show: render,
    reload: () => location.reload(),
    serverMode: async () => (await loadAuthConfig()).mode,
  });
  hud.setLogoutLabel(config.mode === 'legacy' ? 'Log out' : 'Sign out');
  await signin.start();
}
boot().catch(() => showMessage('The game could not start.', { label: 'Try again', run: () => location.reload() }));

// ---------- tap on the world ----------
let down: { x: number; y: number; t: number; id: number } | null = null;
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; });
canvas.addEventListener('pointerup', e => {
  if (!down || down.id !== e.pointerId) return;
  const tap = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12 && performance.now() - down.t < 700;
  down = null;
  if (!tap || closePanels()) return;
  if (game.dialog) { game.advanceDialog(); return; }
  const r = canvas.getBoundingClientRect(), tile = view.toWorld(e.clientX - r.left, e.clientY - r.top);
  if (tile) game.tapTile(tile.x, tile.y);
});
screen.addEventListener('contextmenu', e => e.preventDefault());

// ---------- sizing and the loop ----------
function resize() { view.resize(screen.clientWidth, screen.clientHeight); }
new ResizeObserver(resize).observe(screen);
resize();

let last = performance.now();
const start = last;
/** What the bag and the ground show now: they are redrawn only when the game's lists change (or the map's view is new). */
let bagShown: BagSlot[] | null = null;
let lootShown = { changes: -1, view: null as WorldView | null };
let marksShown = { changes: -1, view: null as WorldView | null };
/** Echoes are chosen again when the piles change or you reach another tile. */
let echoesShown = { changes: -1, view: null as WorldView | null, tile: '' };
let statusAt = 0;
let friendsShown = { changes: -1, open: false };
/** The chat tab shown, what of the chat is drawn, and the dots drawn on the menu. */
let chatTab: ChatTo = 'local';
let chatShown: { changes: number; tab: ChatTo } = { changes: -1, tab: chatTab };
let newsShown = '';
/** The friends panel asks for the list again this often while it is open: who is online, and where. */
const FRIENDS_REFRESH_MS = 10_000;
let friendsAskedAt = 0;
/** The chest as the stash sheet shows it: it opens when the game opens one, and follows what is in it. */
let chestShown: typeof game.chest = null;
let capacityShown = 0;
/** The workbench and the gear worn, as their sheets show them. */
let benchShown: typeof game.bench = null;
/** Glowing footprints (a quirk): the tile each player was last seen on, and the prints left on this map, oldest first. */
const printTiles = new Map<string, string>();
let prints: Array<{ map: string; x: number; y: number; dir: Dir; at: number }> = [];
/** When the last hum said the region grows restless: one hum for each time it does. */
let humFor = -Infinity;
let gearShown: { gear: Gear | null; worn: Worn | null } = { gear: null, worn: null };
let toolsShown: string[] | null = null;
let progressShown: typeof game.progress | null = null;
/** The scene sound was mixed for last frame: what changed since is what makes a one-shot. */
let heard: Scene | undefined;
function frame(now: number) {
  // Asked first, so one frame that throws cannot stop the game (or leave it black mid-arrival).
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  arrival.update(dt);
  game.held = arrival.leaving;
  game.update(dt, now);
  const me = game.me;
  if (game.lootChanges !== lootShown.changes || view !== lootShown.view) {
    lootShown = { changes: game.lootChanges, view };
    view.setLoot(game.finds.values(), game.drops.values(), game.meId, me?.color ?? null);
  }
  const capacity = bagSlotsOf(game.myGear, items.byId);
  if (game.bag !== bagShown || capacity !== capacityShown) hud.setBag(slotViews((bagShown = game.bag), items), (capacityShown = capacity));
  if (game.markChanges !== marksShown.changes || view !== marksShown.view) {
    marksShown = { changes: game.markChanges, view };
    view.setMarks(game.marks.values());
  }
  const focus = me ?? view.map.data.spawn, tile = `${Math.round(focus.x)},${Math.round(focus.y)}`;
  if (game.lootChanges !== echoesShown.changes || view !== echoesShown.view || tile !== echoesShown.tile) {
    echoesShown = { changes: game.lootChanges, view, tile };
    view.setEchoes(game.drops.values(), focus);
  }
  view.setCreatures(game.creatureViews());
  view.setFlares(game.flaresNow(now), focus);
  // Quirks that show in the world: glowing steps out in the wilds, and street lights that flicker as someone passes.
  const mapId = game.map.data.id, flicker: Array<{ x: number; y: number }> = [];
  for (const p of game.players.values()) {
    const q = game.quirks.get(p.id) ?? [], tile = `${mapId}:${p.tx},${p.ty}`;
    if (q.includes('flicker')) flicker.push({ x: p.x, y: p.y });
    if (printTiles.get(p.id) === tile) continue;
    printTiles.set(p.id, tile);
    if (q.includes('footprints') && game.map.data.kind === 'wilds') prints.push({ map: mapId, x: p.tx, y: p.ty, dir: p.dir, at: now });
  }
  prints = prints.filter(p => p.map === mapId && now - p.at < PRINT_S * 1000);
  view.setPrints(prints.map(p => ({ x: p.x, y: p.y, dir: p.dir, age: (now - p.at) / 1000 })));
  view.setFlickerAt(flicker);
  // A humming piece: a minute before the region grows restless, before anyone is told.
  const coming = game.surgeNow(now);
  if (coming?.phase === 'calm' && coming.left <= HUM_BEFORE_S && Object.values(game.myWorn).some(p => p?.quirk === 'hum')) {
    const at = now + coming.left * 1000;
    if (Math.abs(at - humFor) > 10_000) {
      humFor = at;
      hud.showBanner('Your gear hums', `${game.map.data.name} grows restless in about a minute.`);
    }
  }
  view.setStone(game.stone.awake);
  const surge = game.surgeNow(now), caught = game.caught(now);
  view.setSurge(caught ? 1 : surge?.phase === 'surge' ? 0.35 : surge?.phase === 'unstable' ? 0.12 : 0);
  hud.setSurge(surge, caught);
  view.setStorm(game.stormNow(now)?.phase === 'storm');
  view.setFogCap(game.fogCap());
  view.setFlashes(game.flashesNow(now));
  const body = game.online ? game.bodyNow(now) : null;
  hud.setBody(body);
  if (body) hud.setLoad(body.load);
  const worldNews = game.news.splice(0);
  for (const n of worldNews) {
    const b = newsBanner(n, game.map.data.name);
    if (b) hud.showBanner(b.title, b.sub);
  }
  if (hud.statusOpen && now - statusAt > 500) { statusAt = now; showStatus(); }
  if (game.socialChanges !== friendsShown.changes || hud.friendsOpen !== friendsShown.open) {
    friendsShown = { changes: game.socialChanges, open: hud.friendsOpen };
    hud.setFriends(friendsView(game.friends, game, id => maps.find(id)?.name), game.socialNote);
  }
  // Chat: what the open tab heard (reading it clears the dot), and the dots on the menu.
  if (hud.chatOpen) game.chatNews = false;
  if (game.chatChanges !== chatShown.changes || chatTab !== chatShown.tab) {
    chatShown = { changes: game.chatChanges, tab: chatTab };
    hud.setChat(chatTab, game.chat.filter(l => l.to === chatTab), game.chatNote);
  }
  const news = `${game.socialNews}${game.chatNews}`;
  if (news !== newsShown) { newsShown = news; hud.setNews(game.socialNews, game.chatNews); }
  if (hud.friendsOpen && now - friendsAskedAt > FRIENDS_REFRESH_MS) { friendsAskedAt = now; game.social({ t: 'friends' }); }
  const benchChanged = game.bench !== benchShown;
  if (benchChanged) {
    if (game.bench && !benchShown) hud.toggleBench(true);
    if (!game.bench && benchShown) hud.toggleBench(false);
    benchShown = game.bench;
  }
  // Also when what you wear wears down or is mended: its mend row changes.
  if (game.bench && (benchChanged || game.myGear !== gearShown.gear || game.myWorn !== gearShown.worn)) {
    hud.setBench([...mendViews(game.myGear, game.myWorn, game.bench.stash, items), ...recipeViews(items.recipes, game.bench.stash, items)]);
  }
  if (game.myGear !== gearShown.gear || game.myWorn !== gearShown.worn) {
    gearShown = { gear: game.myGear, worn: game.myWorn };
    hud.setWearing(wornViews(game.myGear, items, game.myWorn));
  }
  if (game.tools !== toolsShown) hud.setTools((toolsShown = game.tools).map(item => ({ item, name: items.get(item).name, icon: iconFor(items.get(item)) })));
  if (game.chest !== chestShown || game.progress !== progressShown) {
    if (game.chest && !chestShown) hud.toggleStash(true);
    if (!game.chest && chestShown) hud.toggleStash(false);
    chestShown = game.chest;
    progressShown = game.progress;
    if (game.chest) hud.setStash(slotViews(game.chest.stash, items), levelText(game.progress));
    hud.setLevel(game.progress.level);
  }
  const t = (now - start) / 1000;
  view.render(t, dt, me ?? view.map.data.spawn, game.avatars(), game.meId, game.marker);
  const map = game.map, rule = map.data.surge;
  const scene: Scene = {
    map: map.data.id, kind: map.data.kind, weather, storm: game.stormNow(now)?.phase === 'storm', lightning: lightningAt(t),
    me: me ? { id: me.id, x: me.x, y: me.y, tx: me.tx, ty: me.ty, ground: map.kind(me.tx, me.ty) } : null,
    fires: map.data.objects.flatMap(o => (o.kind === 'fireplace' ? [{ x: o.x, y: o.y, left: game.fireLeft(o.x, o.y, now) }] : [])),
    poles: map.data.objects.filter(o => o.kind === 'pole'),
    // How far the front still has to come to reach your tile, as a share of its sweep.
    surge: surge && { phase: surge.phase, gap: rule && me && map.deepest ? ((surgeFront(rule, map.deepest, surge) ?? map.deepest) - map.homeSteps(me.tx, me.ty)) / map.deepest : 1 },
    caught, creatures: game.creatureViews(), flashes: game.flashesNow(now), news: worldNews,
  };
  sound.update(soundscape(scene, heard));
  heard = scene;
  const tags: TagView[] = [...game.players.values()].filter(p => p.id !== game.meId).map(p => { const s = view.project(p.x, p.y, 1.25); return { id: p.id, name: p.name, x: s.x, y: s.y }; });
  // Whose pile it is, while you are near. Its id is its owner's, so it gets a key of its own.
  for (const d of game.pilesNear()) { const s = view.project(d.x, d.y, 0.62); tags.push({ id: `pile:${d.id}`, name: d.name, x: s.x, y: s.y, pile: true }); }
  hud.setTags(tags);
  // A speech bubble over whoever said something near you, above their name.
  hud.setBubbles(game.bubblesNow(now).flatMap(b => {
    const p = game.players.get(b.id);
    if (!p) return [];
    const s = view.project(p.x, p.y, 1.75);
    return [{ id: b.id, text: b.text, x: s.x, y: s.y }];
  }));
  hud.setFloats(game.floats.map(f => { const s = view.project(f.x, f.y, 1.3); return { ...f, x: s.x, y: s.y }; }));
  const d = game.dialog, line = d ? d.lines[d.i] ?? '' : '';
  hud.setDialog(d ? { who: d.who, text: line.slice(0, Math.floor(d.shown)), done: d.shown >= line.length } : null);
  hud.setEnergy(game.energy(now));
  hud.setFade(arrival.dark);
}
requestAnimationFrame(frame);

// Development only: reach the game from the browser console, and play server messages by hand
// (for example a zone) to try things the server does not do yet.
if (import.meta.env.DEV) Object.assign(window, { napoland: { game, maps, items, hud, renderer, arrival, sound, get view() { return view; }, get signin() { return signin; }, receive: (msg: ServerMsg) => conn.onMessage(msg) } });
