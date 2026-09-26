/**
 * Boot: log in (a saved token, or pick a name), connect, then run the game loop.
 */
import './style.css';
import { NAME_RE, PROTOCOL_VERSION, TileMap, type ClientMsg, type MapData, type ServerMsg } from '@napoland/shared';
import mapJson from '../../../content/maps/stonebrook.json';
import { Game } from './game';
import { Hud } from './hud';
import { Connection, serverUrl } from './net';
import { WorldView } from './view/world';

const TOKEN_KEY = 'napoland.token';
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

const map = new TileMap(mapJson as unknown as MapData);
const app = document.getElementById('app')!;
const screen = document.createElement('div');
screen.className = 'screen';
const canvas = document.createElement('canvas');
canvas.className = 'world';
screen.appendChild(canvas);
app.appendChild(screen);

const view = new WorldView(canvas, map);
/** The server accepts game messages only after its welcome on the current connection. */
let welcomed = false;
const game = new Game(map, msg => { if (welcomed) conn.send(msg); });
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
conn.onClose = () => { welcomed = false; game.disconnected(); hud.setConnection('offline'); };
conn.onMessage = (msg: ServerMsg) => {
  const now = performance.now();
  switch (msg.t) {
    case 'welcome':
      welcomed = true;
      store.set(TOKEN_KEY, msg.token);
      pendingName = null;
      overlay.hidden = true;
      hud.setName(msg.name);
      hud.setConnection('online', ping);
      view.setWeather(msg.weather);
      break;
    case 'weather':
      view.setWeather(msg.weather);
      break;
    case 'pong':
      ping = now - msg.at;
      hud.setConnection('online', ping);
      break;
    case 'error':
      if (msg.code === 'unknown_token') { store.del(TOKEN_KEY); conn.stop(); showLogin(); }
      else if (msg.code === 'bad_name') { conn.stop(); showLogin(msg.message || 'That name cannot be used.'); }
      else if (msg.code === 'bad_version') { conn.stop(); showMessage('A new version is out. Loading it...'); setTimeout(() => location.reload(), 800); }
      else if (msg.code === 'replaced') { conn.stop(); showMessage('You are playing on another screen.', { label: 'Play here', onClick: () => { showMessage('Connecting...'); conn.start(); } }); }
      else if (msg.code === 'server_full') showMessage('The server is full right now. Trying again...');
      return;
  }
  game.handle(msg, now);
  hud.setOnline(game.players.size);
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
const resize = () => view.resize(screen.clientWidth, screen.clientHeight);
new ResizeObserver(resize).observe(screen);
resize();

let last = performance.now();
const start = last;
function frame(now: number) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  game.update(dt, now);
  const me = game.me;
  view.render((now - start) / 1000, dt, me ?? map.data.spawn, game.avatars(), game.meId, game.marker);
  hud.setTags([...game.players.values()].filter(p => p.id !== game.meId).map(p => { const s = view.project(p.x, p.y, 1.25); return { id: p.id, name: p.name, x: s.x, y: s.y }; }));
  hud.setFloats(game.floats.map(f => { const s = view.project(f.x, f.y, 1.3); return { ...f, x: s.x, y: s.y }; }));
  const d = game.dialog, line = d ? d.lines[d.i] ?? '' : '';
  hud.setDialog(d ? { who: d.who, text: line.slice(0, Math.floor(d.shown)), done: d.shown >= line.length } : null);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
