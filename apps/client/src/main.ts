/**
 * Boot: ask the server how to sign in, sign in (signin.ts), connect, then run the game loop.
 */
// The fonts come with the game, so the page loads nothing from other sites (the privacy policy
// promises it). Vite bundles their files; a browser downloads only the alphabets a page shows.
import '@fontsource-variable/fredoka';
import '@fontsource-variable/nunito';
// Google's button guidelines set its words in Roboto Medium: only its Latin letters, and only
// downloaded once that button shows.
import '@fontsource/roboto/latin-500.css';
import './style.css';
import {
  HUM_BEFORE_S, OAUTH_PROVIDERS, SEASONS, bagSlotsOf, inTheDark, meritsOf, outfitsOpening, surgeFront, type AuthConfig, type AuthMode, type BagSlot, type CallKind, type Dir, type Gear, type ItemsData, type MapData,
  type MapRef, type NotebookData, type OAuthProvider, type Senses, type ServerMsg, type ChatTo, type Slot, type StoryData, type Weather, type Worn,
} from '@napoland/shared';
import { loadVersion, signInFooter } from './about';
import { Arrival } from './arrival';
import { CALL_WORDS_UNTIL, CallButton, type BPress } from './calls';
import { detailView } from './details';
import { Game, type News } from './game';
import { friendsView, lastFrom } from './friends';
import { Hud, type TagView } from './hud';
import { badgeIcon } from './icons';
import { crateView } from './crates';
import { Items, mendViews, quirkNames, recipeViews, resistText, slotViews, toolViews, upgradeOf, upgradeViews, wearText, wornViews } from './items';
import { fieldNotesView, journalView, notesView } from './journal';
import { Keys, keyTarget } from './keys';
import { Maps } from './maps';
import { mapFor, paperMap } from './papermap';
import { providerButton } from './providers';
import { Connection, serverUrl } from './net';
import { parcelNote, untold } from './parcels';
import { goalText } from './said';
import { Sound, type SoundSetting } from './sound';
import { reachText, tradePanel } from './trade';
import { Apparition } from './unease';
import { soundscape, type Scene } from './soundscape';
import { CODE_LENGTH, SignIn, digits, loadAuthConfig, type AuthBackend, type Screen } from './signin';
import { Resolution } from './quality';
import { heardFinds, nearest, radioOf, type RadioScene } from './radio';
import { levelText, newsBanner, restedLine, statusView } from './status';
import { fireLevel } from './view/fire';
import { PRINT_S } from './view/wilds';
import { madePlaces } from './view/cabin';
import { WorldView, createRenderer, lightningAt, nextView } from './view/world';
import { wardrobeView, type WardrobeState } from './wardrobe';
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
/** The characters whose first wake this browser has already shown (Game.firstWake), one key each. */
const FIRST_WAKE_KEY = 'napoland.woke';
/** The radio's switch, as this browser keeps it: on unless it was turned off, so a radio just made is heard at once. */
const RADIO_KEY = 'napoland.radio';
let radioOn = store.get(RADIO_KEY) !== 'off';

// Every map is bundled, so moving between them needs no download; the items too, so the bag can
// name what it holds, and the story and the field notes, for what people say and the journal. (Globs,
// not imports: a checkout without items.json, story.json or notebook.json still builds, and the
// version check below sends it the message that it does not match.)
const maps = new Maps(Object.values(import.meta.glob<MapData>('../../../content/maps/*.json', { eager: true, import: 'default' })));
const items = new Items(Object.values(import.meta.glob<ItemsData>('../../../content/items.json', { eager: true, import: 'default' }))[0]);
const story: StoryData = Object.values(import.meta.glob<StoryData>('../../../content/story.json', { eager: true, import: 'default' }))[0] ?? { version: 0, chapters: [] };
const notebook: NotebookData = Object.values(import.meta.glob<NotebookData>('../../../content/notebook.json', { eager: true, import: 'default' }))[0] ?? { version: 0, pages: [] };
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
/** How sharp the world is drawn: a step coarser while a slow phone needs it (quality.ts). */
const resolution = new Resolution();
/** The view of the map you are on; replaced (and the old one freed) when you arrive somewhere else, or the season turns. */
let view = new WorldView(renderer, maps.home(), peek);
view.pixelScale = resolution.scale;
/** Every view asks the game how big each fire burns, as it draws. */
const watchFires = (v: WorldView) => v.setFires((x, y) => fireLevel(game.fireLeft(x, y, performance.now())));
/** The sky as the view draws it: the weather over your map (game.weather), and the view it was set on. */
let skyShown: { weather: Weather | null; view: WorldView | null } = { weather: null, view: null };
/** A new view of the map you are on, in the season's colors (the old one freed after, nextView): on arrival, and when the season turns. */
function buildView() {
  view = nextView(renderer, view, game.map, peek, game.season.view.season);
  view.pixelScale = resolution.scale;
  view.setWeather(game.weather);
  skyShown = { weather: game.weather, view };
  watchFires(view);
  resize();
}
/** The server accepts game messages only after its welcome on the current connection. */
let welcomed = false;
/** The first welcome of this page shows where you are; later ones are reconnects. */
let arrived = false;
const game = new Game(maps, msg => { if (welcomed) conn.send(msg); }, items, story, notebook);
/** A panel is open over the world (the bag, the journal, the stash, a crate, a trade...), where it covers the banners. */
const panelOpen = () => hud.bagOpen || hud.journalOpen || hud.statusOpen || hud.aboutOpen || hud.stashOpen || hud.benchOpen || hud.crateOpen || hud.friendsOpen || hud.chatOpen || hud.paperOpen
  || hud.tradeOpen;
/** Close the bag, the journal, the chat, the status and About panels, a crate, a trade (which calls it off) and the menu; true when one was open. */
const closePanels = () => {
  const open = panelOpen() || hud.menuOpen;
  hud.showPaper(null);
  hud.toggleBag(false); hud.toggleJournal(false); hud.toggleStatus(false); hud.toggleAbout(false); hud.toggleStash(false); hud.toggleBench(false); hud.toggleCrate(false); hud.toggleMenu(false); hud.toggleFriends(false); hud.toggleChat(false);
  hud.toggleTrade(false);
  return open;
};
/** What the wardrobe knows: whether you play as a guest, your level and the outfit you wear. */
const wardrobeNow = (): WardrobeState => ({
  guest: game.guest, level: game.progress.level, wearing: game.myOutfit, xp: game.progress.xp, merits: game.merits, pattern: game.myPattern, badge: game.myBadge,
});
/** The status panel, as the game stands now. */
const showStatus = () => {
  const now = performance.now(), effects = game.effectsNow(now);
  hud.setStatus(statusView({
    energy: game.energy(now), body: game.bodyNow(now), surge: game.surgeNow(now), caught: game.caught(now), stone: game.stone, stats: game.stats, bag: game.bag, items,
    progress: game.progress, resists: resistText(game.myGear, items, game.myWorn, effects), effects, season: game.seasonNow(now),
    wear: wearText(game.myGear, game.myWorn, items), quirks: quirkNames(game.myWorn, items),
    storm: game.stormNow(now), flash: game.flashed(now), weather: game.weather, wilds: game.map.data.kind === 'wilds', guest: game.guest, merits: game.merits,
  }));
};
/**
 * The text box asks (a question) or says something by itself: it stands above the panels it came from
 * (the bag, the workbench), so A and B answer it before anything else.
 */
const boxUp = () => !!game.question || !!game.note;
/** B held, a finger on it or Q: a tap is B, held with nothing open it is a call (calls.ts). */
const callB = new CallButton();
/**
 * B held becomes a call only with no panel, card, text box or question open (nor the sign-in cards), on
 * a map that is not fading away: whatever B would close or back out of, it closes, never a call.
 */
const callable = () => game.online && overlay.hidden && !arrival.dark && !panelOpen() && !hud.cardOpen && !hud.menuOpen && !boxUp() && !game.dialog;
/** How many calls this browser has sung: the fan says them in words the first few times. */
const CALLS_KEY = 'napoland.calls';
let callsSung = Math.max(0, Math.floor(Number(store.get(CALLS_KEY)) || 0));
/** What B does, pressed or let go: B as ever, or a call sung (counted, once it went). */
const bDoes = (r: BPress) => {
  if (r?.kind === 'b') controls.b();
  else if (r?.kind === 'call' && game.call(r.call, performance.now())) store.set(CALLS_KEY, String(++callsSung));
};
/** The stick and A and B, on screen or on the keyboard (keys.ts): the same handlers either way. */
const controls = {
  // While it asks, the stick answers the question, and the panel it was asked from stays open.
  pad: (dir: Dir | null) => { if (dir && !game.question) closePanels(); game.padChange(dir, performance.now()); },
  // The text box first (it stands above everything but the paper map); then, with a card open in the stash or at the workbench, A presses its button.
  a: () => { if (hud.paperOpen) hud.showPaper(null); else if (boxUp()) game.pressA(); else if (hud.menuOpen) hud.toggleMenu(false); else if (hud.aboutOpen) hud.toggleAbout(false); else if (hud.journalOpen) hud.toggleJournal(false); else if (hud.statusOpen) hud.toggleStatus(false); else if (hud.pressCard()) return; else if (hud.tradeOpen) game.tradePressA(); else if (hud.stashOpen) hud.toggleStash(false); else if (hud.benchOpen) hud.toggleBench(false); else if (hud.crateOpen) hud.toggleCrate(false); else if (hud.friendsOpen) hud.toggleFriends(false); else if (hud.chatOpen) hud.toggleChat(false); else if (hud.bagOpen) hud.toggleBag(false); else game.pressA(); },
  // Back out of the text box first, then the About panel, then out of the status, a card or the bag's details, before the bag itself opens or closes.
  b: () => { if (hud.paperOpen) hud.showPaper(null); else if (boxUp()) game.pressB(); else if (hud.menuOpen) hud.toggleMenu(false); else if (hud.aboutOpen) hud.toggleAbout(false); else if (!game.pressB() && !hud.back()) hud.toggleBag(); },
  // B held and let go, where the finger is on the fan, 1, 2 or 3 while Q is held, and a hold taken away.
  holdB: (on: boolean) => { const now = performance.now(); bDoes(on ? callB.press(now, callable()) : callB.release(now, callable())); },
  pointB: (choice: CallKind | null) => callB.point(choice),
  call: (kind: CallKind) => bDoes(callB.choose(kind, callable())),
  cancelCall: () => callB.cancel(),
};
const hud = new Hud(screen, {
  ...controls,
  dialogTap: () => game.boxTap(),
  answer: choice => game.answer(choice),
  count: dir => game.holdCount(dir, performance.now()),
  dismiss: () => game.dismiss(),
  // A guest's account row signs in; anyone else's signs (or logs) out.
  logout: () => (game.guest ? startSignIn() : signOut()),
  signIn: () => startSignIn(),
  // Said yes to, using something shows in the world and on the energy bar, so the bag closes; said no, it stays as it was.
  use: slot => game.use(slot, () => hud.toggleBag(false)),
  discard: slot => game.discard(slot),
  // Steps count toward feats without the server telling each one: the panel asks for the counts as they are.
  status: () => { game.askStats(); showStatus(); },
  store: slot => game.store(slot),
  take: (item, n) => game.take(item, n),
  stashClosed: () => game.closeChest(),
  equip: (item, n) => game.equip(item, n),
  unequip: slot => game.unequip(slot),
  wear: slot => game.wear(slot),
  doff: slot => game.doff(slot),
  open: item => game.openSealed(item),
  outfit: id => game.wearOutfit(id),
  adorn: (kind, id) => game.wearLook(kind, id),
  buy: look => game.buyLook(look),
  // At the workbench, the first goal opens the card of what to make (once the workbench has answered).
  goal: () => {
    const next = game.nextGear();
    if (!next || !game.benchBeside()) return;
    game.openBench({ from: 'recipe', id: next.recipe.id });
  },
  // The workbench's rows are recipes, mending ("mend:" and the slot) and upgrades ("up:" and the piece, upgradeId).
  craft: recipe => {
    const up = upgradeOf(recipe);
    if (up) game.upgrade(up);
    else if (recipe.startsWith('mend:')) game.mend(recipe.slice(5) as Slot);
    else game.craft(recipe);
  },
  benchClosed: () => game.closeBench(),
  // Taking out of a crate asks nothing; leaving one asks first (the game does).
  crateTake: id => game.takeFromCache(id),
  crateLeave: slot => game.leaveInCache(slot),
  crateClosed: () => game.closeCache(),
  // What a tap in the chest, at the workbench, in the bag or at a crate shows, from what the open chest or workbench says your stash holds, or what the open crate holds.
  details: (ref, where) => detailView(ref, {
    items, bag: game.bag, stash: (game.chest ?? game.bench)?.stash ?? [], gear: game.myGear, worn: game.myWorn, tools: game.tools, furniture: game.furniture,
    panel: where === 'bag' ? 'bag' : where === 'crate' ? 'crate' : 'home', wardrobe: wardrobeNow(),
    ...(game.cache ? { crate: { items: game.cacheItemsNow(performance.now()), left: game.cache.left, took: game.cache.took, me: game.meId ?? '' } } : {}),
  }),
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
      case 'tradeRequests': return game.social({ t: 'tradeRequests', off: a.off });
      case 'door': return game.setDoorOff(a.off);
      case 'visits': return game.setVisitsOff(a.off);
      // Face to face only: from farther away, the card says so (the server checks it again).
      case 'trade': {
        const reach = game.tradeReach(a.id);
        if (reach !== 'near') {
          game.socialNote = reachText(reach, a.name);
          game.socialChanges++;
          return;
        }
        hud.toggleFriends(false);
        return game.askTrade({ id: a.id, name: a.name });
      }
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
  trade: a => {
    switch (a.a) {
      case 'give': return game.tradeTap(a.slot);
      case 'step': return game.tradeStep(a.i, a.by);
      case 'ready': return game.tradeReady();
      case 'confirm': return game.tradeConfirm();
      case 'cancel': return game.tradeCancel();
    }
  },
  map: () => openMap(),
  // A tool that listens (the radio) is switched on and off by its button, and the bag stays open to
  // show its lamp; any other tool of yours says what it is, in the text box (which the bag would cover).
  tool: item => {
    const def = items.get(item);
    if (def.senses) {
      radioOn = !radioOn;
      store.set(RADIO_KEY, radioOn ? 'on' : 'off');
      return;
    }
    hud.toggleBag(false);
    game.read(def.name, [def.text]);
  },
  fieldSeen: () => game.seenFieldNotes(),
  notesSeen: () => game.seenNotes(),
  version: () => loadVersion(),
  sound: s => { sound.set(s); store.set(SOUND_KEY, JSON.stringify(s)); },
});
hud.setSound(soundSetting);
watchFires(view);

// ---------- the keyboard, on a computer ----------
/** The paper map of the area you are in (indoors, the place outside), if you carry one: drawn from our copy of that map, never with you on it. */
function openMap() {
  const item = mapFor(game.map.data.id, game.tools, t => items.get(t).chart, id => maps.find(id));
  const data = item ? maps.find(items.get(item).chart!) : undefined;
  const map = data && maps.get(data);
  if (!map) return game.noMap();
  hud.toggleBag(false);
  hud.showPaper(paperMap(map, id => maps.find(id)?.name));
}

const keys = new Keys({
  ...controls,
  // M: the map of where you are, and M again puts it away. Neither M nor Enter goes past a question.
  openMap: () => { if (game.question) return; if (hud.paperOpen) hud.showPaper(null); else { closePanels(); openMap(); } },
  // Enter, as in Metin2: the chat opens with its line ready to type in (open already, the line takes the keys again).
  openChat: () => { if (game.question) return; if (!hud.chatOpen) closePanels(); hud.toggleChat(true, true); },
});
window.addEventListener('keydown', e => {
  // Behind the sign-in cards the keys are the page's (typing a name, pressing Enter to go on).
  if (!overlay.hidden) return;
  if (keys.down(e.code, keyTarget(e.target), e.repeat, e.ctrlKey || e.altKey || e.metaKey, e.key)) e.preventDefault();
});
// A button a tap or a click pressed lets go of the focus at once, so the keys stay the game's (Enter
// opens the chat instead of pressing that button again). One reached with Tab keeps it: its clicks
// come from the keyboard (detail 0).
document.addEventListener('click', e => {
  const b = e.target instanceof Element ? e.target.closest('button, a') : null;
  if (e.detail > 0 && b instanceof HTMLElement && b === document.activeElement) b.blur();
});
window.addEventListener('keyup', e => keys.up(e.code));
window.addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => { if (document.hidden) keys.clear(); });

// ---------- arriving on another map ----------
/** Set when a collapse arrives: you were carrying something, which now lies where you fell. */
let leftPile = false;
/** Said in place of the map's name when you arrive: you just signed in (signin.news). */
let signedInNews: { title: string; sub: string } | null = null;
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
  if (view.map !== game.map || view.season !== game.season.view.season) buildView();
  if (collapsed) hud.showBanner('You collapsed from exhaustion', leftPile ? 'You woke up at home.\nWhat you carried lies where you fell. It fades in an hour.' : 'You woke up at home');
  else if (signedInNews) hud.showBanner(signedInNews.title, signedInNews.sub);
  else hud.showBanner(game.placeName());
  signedInNews = null;
});

// ---------- signing in, and status screens ----------
// One card at a time over the game; signin.ts decides which (see Screen). The other ways to sign in
// (Google, Apple, providers.ts) go on the email card, above the email, for the providers the server
// lists; the email field's label then reads as the quiet line between them. Every sign-in card ends
// with the small print: the privacy policy, the legal notice and the source code, before anyone signs in.
/** The game in one line, on the first cards. */
const PITCH = 'Leave home, gather what glows, and get back before your energy runs out.';
/** Under "Send me a code". */
const EMAIL_FINE = `We email you a ${CODE_LENGTH}-digit code to sign in. No password to remember.`;
const overlay = document.createElement('div');
overlay.className = 'overlay';
overlay.innerHTML = `
  <form class="card panel" data-el="emailCard" novalidate hidden>
    <h1>napoland</h1>
    <p class="intro">${PITCH}</p>
    <div class="providers" data-el="providers" hidden>${OAUTH_PROVIDERS.map(providerButton).join('')}</div>
    <div class="err" data-el="providerErr" role="alert" hidden></div>
    <label for="email" data-el="emailLabel">Your email</label>
    <input id="email" name="email" type="email" autocomplete="email" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" maxlength="254" placeholder="you@example.com" />
    <div class="err" data-el="emailErr" role="alert"></div>
    <button type="submit" data-el="emailBtn">Send me a code</button>
    <p class="fine" data-el="emailFine">${EMAIL_FINE}</p>
    <div class="links center" data-el="emailLinks" hidden><button type="button" class="link" data-el="emailBack">Back</button></div>
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
    <button type="submit" data-el="nameBtn">Play</button>
    <div class="links" data-el="nameLinks" hidden><span class="who" data-el="who"></span><button type="button" class="link" data-el="nameSignOut">Sign out</button></div>
    <div class="links center" data-el="playLinks" hidden><button type="button" class="link" data-el="playSignIn">I have played before: sign in</button></div>
    ${signInFooter()}
  </form>
  <div class="card panel" data-el="accountCard" hidden>
    <h1>napoland</h1>
    <p>This account already has a character, <b data-el="accountName"></b>.</p>
    <p data-el="accountAsk"></p>
    <button type="button" data-el="accountPlay"></button>
    <div class="links center"><button type="button" class="link" data-el="accountBack">Keep playing as a guest</button></div>
  </div>
  <div class="card panel" data-el="keepCard" hidden>
    <h1>napoland</h1>
    <p data-el="keepAsk"></p>
    <button type="button" data-el="keepPlay">Keep it</button>
    <div class="links center"><button type="button" class="link" data-el="keepBack">Play as a guest instead</button></div>
  </div>
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
const providerButtons = [...overlay.querySelectorAll<HTMLButtonElement>('button[data-provider]')];
/** A touch screen, where focusing a field brings up the keyboard. */
const coarsePointer = () => matchMedia('(pointer: coarse)').matches;

/** Set once the server has said how to sign in. */
let signin: SignIn | undefined;
/** How this server signs players in (its /auth-config), once it said. */
let authMode: AuthMode = 'legacy';
/** Signing out: the page loads again next, and connects only then. */
let leaving = false;
/** The kind of card shown, so a card that updates (an error, the resend wait) keeps what was typed and the focus. */
let shown: Screen['kind'] | null = 'message';

/** A guest's Sign in button (or the menu's row): the sign-in cards, over the game, which it leaves meanwhile. */
function startSignIn() {
  signin?.beginSignIn();
}

function render(s: Screen) {
  const first = s.kind !== shown;
  shown = s.kind;
  overlay.hidden = s.kind === 'none';
  card('emailCard').hidden = s.kind !== 'email';
  card('codeCard').hidden = s.kind !== 'code';
  // The play card is the name card, with the pitch kept on short screens and sign-in beside it.
  card('nameCard').hidden = s.kind !== 'name' && s.kind !== 'play';
  text('accountCard').hidden = s.kind !== 'account';
  text('keepCard').hidden = s.kind !== 'keep';
  text('msg').hidden = s.kind !== 'message';
  if (s.kind === 'message') {
    text('msgText').textContent = s.text;
    const btn = button('msgBtn');
    btn.hidden = !s.button;
    if (s.button) { btn.textContent = s.button.label; btn.onclick = s.button.run; }
  } else if (s.kind === 'email') {
    // Google and Apple, in the server's order (in the page too, so the keyboard goes through them in
    // it), and under them why the last one did not sign you in.
    const offered = s.providers.length > 0;
    const box = text('providers');
    box.hidden = !offered;
    card('emailCard').classList.toggle('with-providers', offered);
    const shownButtons = s.providers.flatMap(p => providerButtons.filter(b => b.dataset.provider === p));
    if (shownButtons.some((b, i) => box.children[i] !== b)) box.prepend(...shownButtons);
    for (const b of providerButtons) {
      b.hidden = !shownButtons.includes(b);
      b.disabled = s.busy;
    }
    text('providerErr').textContent = s.providerError;
    text('providerErr').hidden = !s.providerError;
    // Under them, the email field's label is the quiet line between the two ways in, one line long:
    // in dev mode, the line under the button says there is no code then.
    const label = text('emailLabel');
    label.classList.toggle('or', offered);
    label.textContent = offered ? 'or with your email' : s.dev ? 'Your email (development: no code)' : 'Your email';
    const btn = button('emailBtn');
    btn.textContent = s.busy ? 'Sending...' : s.dev ? 'Sign in' : 'Send me a code';
    btn.disabled = s.busy;
    text('emailFine').textContent = s.dev ? 'Development: any email signs in, with no code.' : EMAIL_FINE;
    text('emailFine').hidden = s.dev && !offered;
    text('emailErr').textContent = s.error;
    text('emailLinks').hidden = !s.back;
    button('emailBack').textContent = s.back ?? '';
    button('emailBack').disabled = s.busy;
    // On a phone the keyboard would cover Google and Apple, the one-tap ways in: the field waits for a tap.
    if (first) { emailInput.value = s.email; if (!offered || !coarsePointer()) focusSoon(emailInput); }
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
  } else if (s.kind === 'name' || s.kind === 'play') {
    const play = s.kind === 'play', signedIn = s.kind === 'name' && s.signedIn;
    const intro = text('nameIntro');
    intro.textContent = signedIn ? 'Choose a name for your character.' : PITCH;
    // Without sign-in it is only the welcome, which a short screen can do without; the first card of
    // a game with sign-in keeps its pitch, smaller, since it is all a first visit is told.
    intro.classList.toggle('intro', !signedIn && !play);
    intro.classList.toggle('pitch', play);
    text('nameLabel').textContent = signedIn ? 'Name' : 'Your name';
    const btn = button('nameBtn');
    btn.textContent = play ? 'Play now' : 'Play';
    btn.classList.toggle('big', play);
    const err = text('nameErr');
    err.textContent = s.error || (play ? s.note : '');
    err.classList.toggle('ok', play && !s.error && !!s.note);
    text('nameLinks').hidden = !signedIn;
    text('playLinks').hidden = !play;
    text('who').textContent = s.kind === 'name' && s.who ? `Signed in as ${s.who}` : '';
    if (first) focusSoon(nameInput);
  } else if (s.kind === 'account') {
    text('accountName').textContent = s.name;
    text('accountAsk').textContent = `Play as ${s.name}? Your guest character stays in this browser.`;
    button('accountPlay').textContent = `Play as ${s.name}`;
  } else if (s.kind === 'keep') {
    text('keepAsk').textContent = s.who ? `Sign in as ${s.who} and keep this guest character?` : 'Sign in with this account and keep this guest character?';
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
card('nameCard').addEventListener('submit', e => {
  e.preventDefault();
  if (signin?.screen.kind === 'play') signin.playAsGuest(nameInput.value);
  else signin?.submitName(nameInput.value);
});
button('playSignIn').addEventListener('click', () => signin?.beginSignIn());
for (const b of providerButtons) b.addEventListener('click', () => void signin?.signInWith(b.dataset.provider as OAuthProvider));
// Back from Google's or Apple's page by the browser's back button, the page may come back just as it
// left, saying it is taking you there: the sign-in did not finish, unless it did in a later page.
window.addEventListener('pageshow', e => { if (e.persisted) void signin?.resumed(); });
button('emailBack').addEventListener('click', () => signin?.back());
button('accountPlay').addEventListener('click', () => signin?.playAccount());
button('accountBack').addEventListener('click', () => void signin?.keepGuest());
button('keepPlay').addEventListener('click', () => signin?.keepGuestCharacter());
button('keepBack').addEventListener('click', () => void signin?.keepGuest());
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
  // The page starts afresh after this: it connects then, not before.
  leaving = true;
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
      if (!known(msg.map) || msg.items !== items.version || msg.story.version !== story.version || (msg.notebook && msg.notebook.version !== notebook.version)) return outdated();
      welcomed = true;
      signin?.welcomed(msg);
      signedInNews = signin?.news ?? null;
      hud.setName(msg.name);
      hud.setGuest(msg.guest);
      hud.setLogoutLabel(msg.guest ? 'Sign in' : authMode === 'legacy' ? 'Log out' : 'Sign out');
      hud.setConnection('online', ping);
      break;
    case 'zone':
      if (!known(msg.map)) return outdated();
      // Asked now, while the bag is as it was: the zone waits for the black screen, and the empty bag
      // the collapse brings may come just before or just after it.
      if (msg.reason === 'collapse') leftPile = game.carrying(now);
      break;
    case 'pong':
      ping = now - msg.at;
      hud.setConnection('online', ping);
      return;
    case 'error':
      if (msg.code === 'bad_version') outdated();
      else void signin?.refused(msg.code, msg.message, msg.name);
      return;
  }
  // A zone, and whatever comes after it, waits for the screen to go black (see arrival.ts).
  if (arrival.hold(msg)) return;
  game.handle(msg, now);
  hud.setOnline(game.players.size);
  if (msg.t === 'welcome') {
    // A new player's first wake says where they are and who knows the woods, once for each character here.
    const woke = `${FIRST_WAKE_KEY}.${msg.you}`;
    if (!store.get(woke) && game.firstWake()) store.set(woke, '1');
    if (!arrived || view.map !== game.map) {
      arrived = true;
      arrival.cut();
    } else if (signedInNews) {
      // Back on the same map (a reconnect, or a guest who just signed in): no fade, but the news still gets said.
      hud.showBanner(signedInNews.title, signedInNews.sub);
    }
    signedInNews = null;
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
    // Google and Apple send the player back to this game's address (it lives at the root of it).
    config, backend, store, tab: tabStore, now: () => Date.now(), returnTo: location.origin,
    connect: () => { if (!leaving) conn.start(); },
    disconnect: () => conn.stop(),
    show: render,
    reload: () => location.reload(),
    serverMode: async () => (await loadAuthConfig()).mode,
  });
  authMode = config.mode;
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
  // The scrim takes taps while the box asks or says something; should one get through, it counts as outside the box.
  if (tap && boxUp()) { game.dismiss(); return; }
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
/** Your cabin's furniture as drawn, and the stash its trophy shelf was drawn from. */
let comfortShown = { changes: -1, stash: null as typeof game.stash, view: null as WorldView | null };
let lotsShown = { changes: -1, view: null as WorldView | null };
/** The furniture the workbench's rows were drawn with. */
let benchFurniture = -1;
let statusAt = 0;
let statsShown = -1;
let friendsShown = { changes: -1, open: false, reach: '' };
/** The trade as its panel shows it: drawn again when the trade, the bag or the bag's size changes. */
let tradeShown = { changes: -1, bag: null as BagSlot[] | null, capacity: 0 };
/** The chat tab shown, what of the chat is drawn, and the dots drawn on the menu. */
let chatTab: ChatTo = 'local';
let chatShown: { changes: number; tab: ChatTo } = { changes: -1, tab: chatTab };
let newsShown = '';
/** The friends panel asks for the list again this often while it is open: who is online, and where. */
const FRIENDS_REFRESH_MS = 10_000;
/** An open crate is drawn again this often: "2 min ago" moves on. */
const CRATE_REDRAW_MS = 15_000;
let friendsAskedAt = 0;
/** The chest as the stash sheet shows it: it opens when the game opens one, and follows what is in it. */
let chestShown: typeof game.chest = null;
let capacityShown = 0;
/** The workbench and the gear worn, as their sheets show them. */
let benchShown: typeof game.bench = null;
/** The crate as its sheet shows it, and when that was drawn: how long ago each thing was left moves on. */
let crateShown: typeof game.cache = null;
let crateAt = 0;
/** Glowing footprints (a quirk): the tile each player was last seen on, and the prints left on this map, oldest first. */
const printTiles = new Map<string, string>();
let prints: Array<{ map: string; x: number; y: number; dir: Dir; at: number }> = [];
/** When the last hum said the region grows restless: one hum for each time it does. */
let humFor = -Infinity;
let gearShown: { gear: Gear | null; worn: Worn | null } = { gear: null, worn: null };
/** The wardrobe as drawn: a guest's gate, or the outfits of a level, and the one worn. */
let wardrobeShown = '';
/** The badge before your own name, as drawn (undefined: not yet). */
let badgeShown: string | null | undefined;
/** A badge's drawing, if it is one this copy draws. */
const badgeOf = (id: string | undefined) => (id ? badgeIcon(id) : undefined);
let toolsShown: string[] | null = null;
let radioShown: boolean | null = null;
/** Your radio (radioOf), and where the finds it listens for lie on this map: found again only when the finds or the weather change. */
let radio: ReturnType<typeof radioOf>;
let radioSpots: Array<{ x: number; y: number }> = [];
let spotsFor: { loot: number; weather: Weather | null } = { loot: -1, weather: null };
/**
 * The radio as each frame's scene has it: two kept and taken in turn, so last frame's stays as it was
 * for the soundscape to compare with (a switch), and a frame makes nothing new for the radio.
 */
const radioScenes: [RadioScene, RadioScene] = [{ on: false, senses: { loud: 0, faint: 0 }, near: Infinity }, { on: false, senses: { loud: 0, faint: 0 }, near: Infinity }];
let radioTurn = 0;
let progressShown: typeof game.progress | null = null;
let storyShown = -1;
let firstStepsShown = -1;
let notebookShown = -1;
let notesShown = -1;
/** A map's name, for the field notes' headings. */
const mapName = (id: string) => maps.find(id)?.name;
/**
 * Chapters, feats' ranks and levels reached and not announced yet. Each waits until it can be read: for
 * what is being said (a chapter reached by talking to someone), the panel that is open (the stash you
 * put things in, which is where levels come, and the workbench you mend at), the fade and the banner
 * already up.
 */
const toSay: News[] = [];
/** The scene sound was mixed for last frame: what changed since is what makes a one-shot. */
let heard: Scene | undefined;
/** What may stand at the edge of the fog while you are uneasy (unease.ts), and where the view sees a tile on the screen. */
const apparition = new Apparition();
const edgeOf = (x: number, y: number) => view.edgeOf(x, y);
/** The question and what the box says by itself, as last drawn (Game.boxChanges). */
let boxShown = -1;
/** The fan of calls over B as last drawn: '' while closed. */
let fanShown = '';
/** This frame's radio, in the one of radioScenes whose turn it is. */
function radioScene(senses: Senses, near: number): RadioScene {
  const r = radioScenes[(radioTurn ^= 1)];
  r.on = radioOn;
  r.senses = senses;
  r.near = near;
  return r;
}
function frame(now: number) {
  // Asked first, so one frame that throws cannot stop the game (or leave it black mid-arrival).
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  const scale = resolution.frame(now - last);
  if (scale !== null) { view.pixelScale = scale; resize(); }
  last = now;
  arrival.update(dt);
  game.held = arrival.leaving;
  game.update(dt, now);
  // The letter home, and offers to thank someone, wait for the panels (and any card open in one), the menu, the fan of calls and the fade.
  game.idle(now, panelOpen() || hud.cardOpen || hud.menuOpen || callB.open || arrival.dark > 0);
  const me = game.me;
  if (game.lootChanges !== lootShown.changes || view !== lootShown.view) {
    lootShown = { changes: game.lootChanges, view };
    view.setLoot(game.finds.values(), game.drops.values(), game.meId, me?.color ?? null);
  }
  const capacity = bagSlotsOf(game.myGear, items.byId);
  if (game.bag !== bagShown || capacity !== capacityShown) hud.setBag(slotViews((bagShown = game.bag), items), (capacityShown = capacity), game.bagAt);
  hud.tickLive(now);
  // Your cabin's places: spoiled until made, and the trophy shelf with what your stash holds.
  if (game.furnitureChanges !== comfortShown.changes || game.stash !== comfortShown.stash || view !== comfortShown.view) {
    comfortShown = { changes: game.furnitureChanges, stash: game.stash, view };
    view.setComfort(madePlaces(game.roomFurniture(), id => items.get(id)), game.trophies());
  }
  // On your street, the windows of the neighbors who are home are lit.
  if (game.streetChanges !== lotsShown.changes || view !== lotsShown.view) {
    lotsShown = { changes: game.streetChanges, view };
    view.setLots(game.litLots());
  }
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
  // The season turned (as the week did): the map is drawn again in its colors, its water frozen or not.
  if (view.season !== game.season.view.season && !arrival.dark) buildView();
  // The weather over your map (your region's, a room's the map outside it): the sky turns with it.
  if (game.weather !== skyShown.weather || view !== skyShown.view) {
    skyShown = { weather: game.weather, view };
    view.setWeather(game.weather);
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
  const worldNews = game.takeNews(now);
  for (const n of worldNews) {
    // A dot on the menu until the journal is opened (it shows the chapter at once if it is open).
    if (n.kind === 'chapter') { toSay.push(n); if (!hud.journalOpen) hud.setJournalNews(true); continue; }
    // The field notes' news waits like a chapter's, with a dot of its own until they are looked at.
    if (n.kind === 'page' || n.kind === 'blank') { toSay.push(n); if (!(hud.journalOpen && hud.journalTab === 'field')) hud.setFieldNews(true); continue; }
    // A note read needs no banner (the text box just said it), only a dot on the journal's Notes until it is looked at.
    // A keepsake home waits like a level, for the chest to close, and puts the same dot there.
    if (n.kind === 'note' || n.kind === 'keepsake') { if (n.kind === 'keepsake') toSay.push(n); if (!(hud.journalOpen && hud.journalTab === 'notes')) hud.setNotesNews(true); continue; }
    // A first finder: one line for everyone online, waiting like the rest for panels and talk to be done.
    if (n.kind === 'first') { toSay.push(n); continue; }
    if (n.kind === 'feat') { toSay.push(n); continue; }
    // A dot on the chest's Wardrobe tab too, until it is looked at, when the level opened an outfit.
    if (n.kind === 'level') { toSay.push(n); if (!game.guest && outfitsOpening(n.from, n.progress.level).length) hud.setWardrobeNews(true); continue; }
    // A merit waits like a level (it comes at the chest), and puts a dot on the patterns and badges it buys until they are looked at.
    if (n.kind === 'merit') { toSay.push(n); if (!game.guest) hud.setMeritNews(true); continue; }
    // A parcel that comes on arrival waits for the place's name to be read first; one that comes while
    // the chest is open needs no banner, as the stash says what came (below). Arriving rested waits the same way.
    if (n.kind === 'parcel') { if (!game.chest) toSay.push(n); continue; }
    if (n.kind === 'rested') { toSay.push(n); continue; }
    // The season turns at a dawn, with the new day's banner, and so does the Long Night, begun or over: they wait their turn.
    if (n.kind === 'season' || n.kind === 'longNight') { toSay.push(n); continue; }
    // A lodestone's tug: a moment on the status panel (and a faint sound, soundscape.ts), never a banner.
    if (n.kind === 'tug') { hud.tug(items.quirk('lodestone').name); continue; }
    const b = newsBanner(n, game.map.data.name, items, game.guest);
    if (b) hud.showBanner(b.title, b.sub);
  }
  if (toSay.length && !game.dialog && !boxUp() && !panelOpen() && !hud.bannerUp && !arrival.dark) {
    const b = newsBanner(toSay.shift()!, game.map.data.name, items, game.guest);
    if (b) hud.showBanner(b.title, b.sub);
  }
  if (game.storyChanges !== storyShown) {
    storyShown = game.storyChanges;
    hud.setJournal(journalView(game.reached()));
  }
  if (game.firstStepsChanges !== firstStepsShown) {
    firstStepsShown = game.firstStepsChanges;
    hud.setFirstSteps(game.firstSteps);
  }
  if (game.notebookChanges !== notebookShown) {
    notebookShown = game.notebookChanges;
    hud.setFieldNotes(fieldNotesView(notebook, game.fieldNotes, mapName, game.freshPages));
  }
  if (game.notesChanges !== notesShown) {
    notesShown = game.notesChanges;
    hud.setNotes(notesView(maps.all(), game.notesRead, items.keepsakes, game.keepsakesHome, id => items.byId.get(id), game.freshNotes, game.firsts, game.myName()));
  }
  if (hud.statusOpen && (now - statusAt > 500 || game.statsChanges !== statsShown)) { statusAt = now; statsShown = game.statsChanges; showStatus(); }
  // A friend's card says whether they are near enough to trade with, as they walk.
  const reach = hud.friendsOpen && game.person ? game.tradeReach(game.person.id) : '';
  if (game.socialChanges !== friendsShown.changes || hud.friendsOpen !== friendsShown.open || reach !== friendsShown.reach) {
    friendsShown = { changes: game.socialChanges, open: hud.friendsOpen, reach };
    hud.setFriends(friendsView(game.friends, game, id => maps.find(id)?.name), game.socialNote);
  }
  // A trade opens its panel once both are in or you asked (a friend's ask is a question first), and it closes when it is over.
  const trading = !!game.trade && game.trade.state !== 'asked';
  if (trading && !hud.tradeOpen) { closePanels(); hud.toggleTrade(true); }
  else if (!trading && hud.tradeOpen) hud.toggleTrade(false, false);
  if (trading && (game.tradeChanges !== tradeShown.changes || game.bag !== tradeShown.bag || capacity !== tradeShown.capacity)) {
    tradeShown = { changes: game.tradeChanges, bag: game.bag, capacity };
    hud.setTrade(tradePanel(game.trade!, { mine: game.tradeMine, bag: game.bag, items }));
  }
  // Chat: what the open tab heard (reading it clears the dot), and the dots on the menu.
  if (hud.chatOpen) game.chatNews = false;
  if (game.chatChanges !== chatShown.changes || chatTab !== chatShown.tab) {
    chatShown = { changes: game.chatChanges, tab: chatTab };
    hud.setChat(chatTab, game.chat.filter(l => l.to === chatTab), game.chatNote);
  }
  const news = `${game.socialNews}${game.chatNews}`;
  if (news !== newsShown) { newsShown = news; hud.setNews(game.socialNews, game.chatNews); }
  // (A guest has no list to ask for: it waits for sign-in.)
  if (hud.friendsOpen && !game.guest && now - friendsAskedAt > FRIENDS_REFRESH_MS) { friendsAskedAt = now; game.social({ t: 'friends' }); }
  const benchChanged = game.bench !== benchShown;
  if (benchChanged) {
    if (game.bench && !benchShown) {
      hud.toggleBench(true);
      const card = game.takeBenchCard();
      if (card) hud.cardOf('bench', card);
    }
    if (!game.bench && benchShown) hud.toggleBench(false);
    benchShown = game.bench;
  }
  // Also when what you wear wears down, is mended or upgraded: its mend and upgrade rows change.
  if (game.bench && (benchChanged || game.myGear !== gearShown.gear || game.myWorn !== gearShown.worn || game.furnitureChanges !== benchFurniture)) {
    const { stash } = game.bench;
    benchFurniture = game.furnitureChanges;
    hud.setBench([...mendViews(game.myGear, game.myWorn, stash, items), ...upgradeViews(game.myGear, game.myWorn, stash, items), ...recipeViews(items.recipes, stash, items, game.tools, game.furniture)]);
  }
  if (game.myGear !== gearShown.gear || game.myWorn !== gearShown.worn) {
    gearShown = { gear: game.myGear, worn: game.myWorn };
    hud.setWearing(wornViews(game.myGear, items, game.myWorn));
  }
  // A guest who signs in has the outfits at once; a new level opens more.
  // Merits come with XP, and each look bought or worn changes a tile.
  const wardrobe = wardrobeNow(), wardrobeKey = `${wardrobe.guest}|${wardrobe.level}|${wardrobe.wearing}|${meritsOf(game.progress.xp)}|${game.merits.spent}|${game.merits.owned}|${wardrobe.pattern}|${wardrobe.badge}`;
  if (wardrobeKey !== wardrobeShown) {
    wardrobeShown = wardrobeKey;
    hud.setWardrobe(wardrobeView(wardrobe));
  }
  if (game.cache !== crateShown || (game.cache && now - crateAt > CRATE_REDRAW_MS)) {
    if (game.cache && !crateShown) hud.toggleCrate(true);
    if (!game.cache && crateShown) hud.toggleCrate(false);
    crateShown = game.cache;
    crateAt = now;
    if (game.cache) hud.setCrate(crateView({ ...game.cache, items: game.cacheItemsNow(now) }, items, game.meId ?? ''));
  }
  // Your maps are one button, which opens the one for where you are; any other tool has its own, in the order you got them.
  if (game.tools !== toolsShown || radioOn !== radioShown) {
    radio = radioOf(game.tools, items);
    hud.setTools(toolViews((toolsShown = game.tools), items, (radioShown = radioOn)));
  }
  // Every change to the finds counts in lootChanges, a new map's too.
  if (radio && (game.lootChanges !== spotsFor.loot || game.weather !== spotsFor.weather)) {
    spotsFor = { loot: game.lootChanges, weather: game.weather };
    radioSpots = heardFinds(game.finds.values(), radio.senses, game.weather);
  }
  if (game.chest !== chestShown || game.progress !== progressShown) {
    if (game.chest && !chestShown) hud.toggleStash(true);
    if (!game.chest && chestShown) hud.toggleStash(false);
    chestShown = game.chest;
    progressShown = game.progress;
    if (game.chest) hud.setStash(slotViews(game.chest.stash, items), levelText(game.progress));
    hud.setLevel(game.progress.level);
    // At the chest, as it is spent: how much more of what comes home counts double.
    hud.setRested(game.progress.rested ? restedLine(game.progress.rested) : null);
  }
  // Open, the stash says once what came in the parcels since it last opened, and in one that comes while it is.
  if (game.chest && game.parcels.length) {
    const told = game.takeParcels();
    hud.addParcels(told.map(p => parcelNote(p, items)));
    // A banner for them still waiting for the panel to close would only say it again.
    toSay.splice(0, toSay.length, ...untold(toSay, told));
  }
  // The first goal, in the bag and the chest; at the workbench, a tap on it opens its card (the Hud writes it only when it changed).
  const next = game.nextGear();
  hud.setGoal(next && { text: goalText(next, items), ready: next.ready, act: !!game.benchBeside() });
  // Uneasy, the screen's edges close in; where watchers roam, something may stand at the edge of the fog.
  hud.setUnease(game.unease);
  const figure = me && game.online ? apparition.update(now, game.map, game.unease, inTheDark(game.weather), me.tx, me.ty, me.dir, edgeOf) : 0;
  view.setApparition(apparition.x, apparition.y, figure);
  // Alone out in the wilds, someone's steps now and then: gone once anyone else is here, or you come near.
  const passing = game.passing, glimpsed = me && passing.active ? passing.update(now, me.x, me.y, game.players.size <= 1 && game.map.data.kind === 'wilds') : 0;
  view.setGlimpse(passing.x, passing.y, passing.heading, passing.walking, passing.color, glimpsed);
  const t = (now - start) / 1000;
  // Someone else vanished or appeared at a teleport: a pop there (the trip itself is theirs alone).
  for (const p of game.takePops()) view.pop(p.x, p.y);
  view.render(t, dt, me ?? view.map.data.spawn, game.avatars(), game.meId, game.marker);
  const map = game.map, rule = map.data.surge;
  const scene: Scene = {
    map: map.data.id, kind: map.data.kind, weather: game.weather, snow: SEASONS[game.season.view.season].snow, storm: game.stormNow(now)?.phase === 'storm', lightning: lightningAt(t),
    me: me ? { id: me.id, x: me.x, y: me.y, tx: me.tx, ty: me.ty, ground: map.kind(me.tx, me.ty), ice: map.frozenAt(me.tx, me.ty) } : null,
    fires: map.data.objects.flatMap(o => (o.kind === 'fireplace' ? [{ x: o.x, y: o.y, left: game.fireLeft(o.x, o.y, now) }] : [])),
    poles: map.data.objects.filter(o => o.kind === 'pole'),
    teleports: map.data.objects.filter(o => o.kind === 'teleport'),
    // How far the front still has to come to reach your tile, as a share of its sweep.
    surge: surge && { phase: surge.phase, gap: rule && me && map.deepest ? ((surgeFront(rule, map.deepest, surge) ?? map.deepest) - map.homeSteps(me.tx, me.ty)) / map.deepest : 1 },
    caught, creatures: game.creatureViews(), flashes: game.flashesNow(now), live: !!game.meId && game.live.has(game.meId), news: worldNews,
    radio: radio ? radioScene(radio.senses, me ? nearest(radioSpots, me.x, me.y) : Infinity) : null,
  };
  sound.update(soundscape(scene, heard));
  heard = scene;
  const tags: TagView[] = [...game.players.values()].filter(p => p.id !== game.meId).map(p => {
    const s = view.project(p.x, p.y, 1.25), badge = badgeOf(game.badges.get(p.id));
    return { id: p.id, name: p.name, x: s.x, y: s.y, ...(badge ? { badge } : {}) };
  });
  // Your own, before your name at the top: what everyone else sees on your name tag.
  if (game.myBadge !== badgeShown) {
    badgeShown = game.myBadge;
    hud.setBadge(badgeOf(badgeShown ?? undefined) ?? null);
  }
  // Whose pile it is, while you are near. Its id is its owner's, so it gets a key of its own.
  for (const d of game.pilesNear()) { const s = view.project(d.x, d.y, 0.62); tags.push({ id: `pile:${d.id}`, name: d.name, x: s.x, y: s.y, pile: true }); }
  // On your street, whose cabin it is, on the plate by its door, while you pass it.
  for (const p of game.platesNear()) { const s = view.project(p.x, p.y + 0.35, 1.3); tags.push({ id: `plate:${p.lot}`, name: p.name, x: s.x, y: s.y, plate: true }); }
  hud.setTags(tags);
  // A speech bubble over whoever said something near you, above their name.
  hud.setBubbles(game.bubblesNow(now).flatMap(b => {
    const p = game.players.get(b.id);
    if (!p) return [];
    const s = view.project(p.x, p.y, 1.75);
    return [{ id: b.id, text: b.text, x: s.x, y: s.y }];
  }));
  hud.setFloats(game.floats.map(f => { const s = view.project(f.x, f.y, 1.3); return { ...f, x: s.x, y: s.y }; }));
  // A note over the head of whoever called, where they stand now (the tile it came from, if they left).
  hud.setCallNotes(game.calls.map(c => {
    const p = game.players.get(c.who), s = view.project(p?.x ?? c.x, p?.y ?? c.y, 1.25);
    return { id: c.n, kind: c.kind, color: p?.color ?? '#f1ece0', x: s.x, y: s.y, t: Math.max(0, now - c.at) / 1000 };
  }));
  // B held long enough with nothing open opens the fan; nobody calls into a map that is fading away.
  if (arrival.dark > 0 && callB.open) callB.cancel();
  callB.tick(now, callable());
  const words = callsSung < CALL_WORDS_UNTIL, fan = callB.open ? `${callB.choice}|${words}` : '';
  if (fan !== fanShown) {
    fanShown = fan;
    hud.setFan(callB.open ? { choice: callB.choice, words } : null);
  }
  // A question, or what the box says by itself, is drawn again only when it changed.
  if (game.boxChanges !== boxShown) {
    boxShown = game.boxChanges;
    hud.setAsk(game.askView());
    hud.setNote(game.noteView(now));
  }
  const d = game.dialog, line = d ? d.lines[d.i] ?? '' : '';
  hud.setDialog(d ? { who: d.who, text: line.slice(0, Math.floor(d.shown)), done: d.shown >= line.length } : null);
  hud.setEnergy(game.energy(now));
  hud.setFade(arrival.dark);
}
requestAnimationFrame(frame);

// Development only: reach the game from the browser console, and play server messages by hand
// (for example a zone) to try things the server does not do yet.
if (import.meta.env.DEV) Object.assign(window, { napoland: { game, maps, items, hud, renderer, arrival, sound, get view() { return view; }, get signin() { return signin; }, receive: (msg: ServerMsg) => conn.onMessage(msg) } });
