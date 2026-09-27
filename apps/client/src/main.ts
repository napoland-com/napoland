/**
 * Boot: log in (a saved token, or pick a name), connect, then run the game loop.
 */
import './style.css';
import { NAME_RE, PROTOCOL_VERSION, type ClientMsg, type MapData, type MapRef, type ServerMsg, type Weather } from '@napoland/shared';
import { Arrival } from './arrival';
import { Game } from './game';
import { Hud } from './hud';
import { Maps } from './maps';
import { Connection, serverUrl } from './net';
import { WorldView, createRenderer } from './view/world';

const TOKEN_KEY = 'napoland.token';
/** When this page last reloaded because it was out of date (see outdated()). */
const RELOAD_KEY = 'napoland.reloadedAt';
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

// Every map is bundled, so moving between them needs no download.
const maps = new Maps(Object.values(import.meta.glob<MapData>('../../../content/maps/*.json', { eager: true, import: 'default' })));
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
let weather: Weather = 'rain';
/** The server accepts game messages only after its welcome on the current connection. */
let welcomed = false;
/** The first welcome of this page shows where you are; later ones are reconnects. */
let arrived = false;
const game = new Game(maps, msg => { if (welcomed) conn.send(msg); });
/** Close the bag and the menu; true when one was open. */
const closePanels = () => {
  const open = hud.bagOpen || hud.menuOpen;
  hud.toggleBag(false); hud.toggleMenu(false);
  return open;
};
const hud = new Hud(screen, {
  pad: dir => { if (dir) closePanels(); game.padChange(dir, performance.now()); },
  a: () => { if (hud.menuOpen) hud.toggleMenu(false); else if (hud.bagOpen) hud.toggleBag(false); else game.pressA(); },
  b: () => { if (hud.menuOpen) hud.toggleMenu(false); else if (!game.pressB()) hud.toggleBag(); },
  dialogTap: () => game.advanceDialog(),
  logout: () => { store.del(TOKEN_KEY); conn.stop(); location.reload(); },
});

// ---------- arriving on another map ----------
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
    resize();
  }
  if (collapsed) hud.showBanner('You collapsed from exhaustion', 'You woke up at home');
  else hud.showBanner(game.map.data.name);
});

// ---------- login and status screens ----------
const overlay = document.createElement('div');
overlay.className = 'overlay';
overlay.innerHTML = `
  <form class="card panel" data-el="login" novalidate hidden>
    <h1>napoland</h1>
    <p>Leave home, gather what glows, and get back before your energy runs out.</p>
    <label for="name">Your name</label>
    <input id="name" name="name" autocomplete="nickname" maxlength="16" placeholder="2 to 16 letters or numbers" />
    <div class="err" data-el="err" role="alert"></div>
    <button type="submit">Play</button>
  </form>
  <div class="card panel" data-el="msg" hidden>
    <h1>napoland</h1>
    <p data-el="msgText"></p>
    <button type="button" data-el="msgBtn" hidden></button>
  </div>`;
app.appendChild(overlay);
const q = <T extends HTMLElement>(sel: string) => overlay.querySelector<T>(sel)!;
const login = q<HTMLFormElement>('[data-el="login"]'), nameInput = q<HTMLInputElement>('#name'), errEl = q('[data-el="err"]');
const msgCard = q('[data-el="msg"]'), msgText = q('[data-el="msgText"]'), msgBtn = q<HTMLButtonElement>('[data-el="msgBtn"]');

function showLogin(error = '') {
  overlay.hidden = false; login.hidden = false; msgCard.hidden = true;
  errEl.textContent = error;
  setTimeout(() => nameInput.focus(), 50);
}
function showMessage(text: string, button?: { label: string; onClick: () => void }) {
  overlay.hidden = false; login.hidden = true; msgCard.hidden = false;
  msgText.textContent = text;
  msgBtn.hidden = !button;
  if (button) { msgBtn.textContent = button.label; msgBtn.onclick = button.onClick; }
}

/**
 * This client does not match the server (another protocol, or a map we lack or have in another
 * version): reload to get the new version. If a reload a moment ago did not help (say the server
 * was not restarted after a map changed), ask instead of reloading over and over.
 */
function outdated() {
  conn.stop();
  let last = 0;
  try { last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0); } catch { /* private mode */ }
  if (Date.now() - last < 30_000) {
    showMessage('This copy of the game does not match the server yet. Try again in a moment.', { label: 'Try again', onClick: () => location.reload() });
    return;
  }
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* private mode */ }
  showMessage('A new version is out. Loading it...');
  setTimeout(() => location.reload(), 800);
}
const known = (ref: MapRef) => !!maps.get(ref);

let pendingName: string | null = null;
function hello(): ClientMsg {
  const token = store.get(TOKEN_KEY);
  if (token) return { t: 'hello', v: PROTOCOL_VERSION, token };
  return { t: 'hello', v: PROTOCOL_VERSION, name: pendingName ?? '' };
}
login.addEventListener('submit', e => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!NAME_RE.test(name)) { errEl.textContent = 'Use 2 to 16 letters, numbers, spaces, - or _.'; return; }
  pendingName = name;
  showMessage('Connecting...');
  conn.start();
});

const conn = new Connection(serverUrl(), hello);
let ping: number | undefined;
conn.onOpen = () => { welcomed = false; hud.setConnection('connecting'); };
conn.onClose = () => { welcomed = false; game.disconnected(performance.now()); hud.setConnection('offline'); };
conn.onMessage = (msg: ServerMsg) => {
  const now = performance.now();
  switch (msg.t) {
    case 'welcome':
      if (!known(msg.map)) return outdated();
      welcomed = true;
      store.set(TOKEN_KEY, msg.token);
      pendingName = null;
      overlay.hidden = true;
      hud.setName(msg.name);
      hud.setConnection('online', ping);
      weather = msg.weather;
      view.setWeather(weather);
      break;
    case 'zone':
      if (!known(msg.map)) return outdated();
      break;
    case 'weather':
      weather = msg.weather;
      view.setWeather(weather);
      return;
    case 'pong':
      ping = now - msg.at;
      hud.setConnection('online', ping);
      return;
    case 'error':
      if (msg.code === 'unknown_token') { store.del(TOKEN_KEY); conn.stop(); showLogin(); }
      else if (msg.code === 'bad_name') { conn.stop(); showLogin(msg.message || 'That name cannot be used.'); }
      else if (msg.code === 'bad_version') outdated();
      else if (msg.code === 'replaced') { conn.stop(); showMessage('You are playing on another screen.', { label: 'Play here', onClick: () => { showMessage('Connecting...'); conn.start(); } }); }
      else if (msg.code === 'server_full') showMessage('The server is full right now. Trying again...');
      return;
  }
  // A zone, and whatever comes after it, waits for the screen to go black (see arrival.ts).
  if (arrival.hold(msg)) return;
  game.handle(msg, now);
  hud.setOnline(game.players.size);
  if (msg.t === 'welcome' && (!arrived || view.map !== game.map)) {
    arrived = true;
    arrival.cut();
  }
};
setInterval(() => conn.send({ t: 'ping', at: performance.now() }), 5000);

if (store.get(TOKEN_KEY)) { showMessage('Connecting...'); conn.start(); }
else showLogin();

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
function frame(now: number) {
  // Asked first, so one frame that throws cannot stop the game (or leave it black mid-arrival).
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  arrival.update(dt);
  game.held = arrival.leaving;
  game.update(dt, now);
  const me = game.me;
  view.render((now - start) / 1000, dt, me ?? view.map.data.spawn, game.avatars(), game.meId, game.marker);
  hud.setTags([...game.players.values()].filter(p => p.id !== game.meId).map(p => { const s = view.project(p.x, p.y, 1.25); return { id: p.id, name: p.name, x: s.x, y: s.y }; }));
  hud.setFloats(game.floats.map(f => { const s = view.project(f.x, f.y, 1.3); return { ...f, x: s.x, y: s.y }; }));
  const d = game.dialog, line = d ? d.lines[d.i] ?? '' : '';
  hud.setDialog(d ? { who: d.who, text: line.slice(0, Math.floor(d.shown)), done: d.shown >= line.length } : null);
  hud.setEnergy(game.energy(now));
  hud.setFade(arrival.dark);
}
requestAnimationFrame(frame);

// Development only: reach the game from the browser console, and play server messages by hand
// (for example a zone) to try things the server does not do yet.
if (import.meta.env.DEV) Object.assign(window, { napoland: { game, maps, renderer, arrival, get view() { return view; }, receive: (msg: ServerMsg) => conn.onMessage(msg) } });
