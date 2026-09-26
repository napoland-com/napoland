/**
 * The WebSocket side: one connection per player. Checks the hello, feeds client messages to the
 * World and sends out what the World has to say. Nothing a client sends is trusted.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  PlayerName,
  encode,
  parseClientMsg,
  type ClientMsg,
  type ErrorCode,
  type ServerMsg,
  type Weather,
} from '@napoland/shared';
import { log } from './log';
import type { PlayerRecord, Storage } from './storage';
import { colorFor, type World } from './world';

const HELLO_TIMEOUT_MS = 5000;
/** Mobile connections die silently; a socket that misses a ping round is closed. */
const HEARTBEAT_MS = 30_000;
const RATE_PER_SECOND = 30;
const RATE_BURST = 60;
/** A client this far behind on reading will not catch up; drop it before it eats our memory. */
const MAX_BUFFERED_BYTES = 1 << 20;

/** WebSocket close codes: 1008 for broken rules, 1013 for "try again later". */
const CLOSE_CODES: Record<ErrorCode, number> = {
  bad_message: 1008,
  bad_version: 1008,
  too_fast: 1008,
  bad_name: 1000,
  unknown_token: 1000,
  replaced: 1000,
  server_full: 1013,
};
const VERSION_TEXT = `This server speaks protocol version ${PROTOCOL_VERSION}; reload to update`;
const NAME_TEXT = 'Names are 2 to 16 letters, digits, spaces, - or _';

export interface NetOptions {
  server: Server;
  world: World;
  storage: Storage;
  weather: Weather;
  maxPlayers: number;
  /** Game time in ms for the World and the rate limits. It must never go backwards. */
  clock?: () => number;
  helloTimeoutMs?: number;
  heartbeatMs?: number;
}

export interface Net {
  /** Starts the steps whose time has come and sends what the World has to say. */
  tick(): void;
  /** Saves everyone online. */
  saveAll(): Promise<void>;
  /** Disconnects everyone with `code`, saves them and stops accepting connections. */
  close(code?: number): Promise<void>;
}

interface Session {
  ws: WebSocket;
  /** hello: waiting for it; auth: checking it; play: in the world; closed: deaf to everything. */
  state: 'hello' | 'auth' | 'play' | 'closed';
  /** The player's id, once in the world. */
  id: string;
  /** Rate limit: a token bucket. */
  tokens: number;
  refilledAt: number;
  /** Answered the last heartbeat ping. */
  alive: boolean;
  helloTimer: ReturnType<typeof setTimeout>;
}

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export function attachNet(o: NetOptions): Net {
  const { world, storage } = o;
  const clock = o.clock ?? (() => performance.now());
  const wss = new WebSocketServer({ server: o.server, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });
  const conns = new Set<Session>();
  /** Sessions whose player is in the world, by player id. */
  const playing = new Map<string, Session>();
  /** New players between the capacity check and world.join (creating them takes a database round trip). */
  let joining = 0;
  /** The last save started for each player, while it runs. */
  const pendingSaves = new Map<string, Promise<void>>();
  let saving = false;
  let closing = false;

  // Errors of the HTTP server (like a busy port) are handled where it listens; ws repeats them here.
  wss.on('error', () => {});
  wss.on('connection', ws => {
    const s: Session = {
      ws,
      state: 'hello',
      id: '',
      tokens: RATE_BURST,
      refilledAt: clock(),
      alive: true,
      helloTimer: setTimeout(() => {
        if (s.state === 'hello') fail(s, 'bad_message', 'Say hello first');
      }, o.helloTimeoutMs ?? HELLO_TIMEOUT_MS),
    };
    conns.add(s);
    // Oversized or broken frames: ws closes the socket itself, the 'close' handler cleans up.
    ws.on('error', err => log.debug('socket error', { err: err.message }));
    ws.on('pong', () => {
      s.alive = true;
    });
    ws.on('message', (data, isBinary) => onMessage(s, data, isBinary));
    ws.on('close', () => onClose(s));
    if (closing) disconnect(s, 1012, 'server restarting');
  });

  const heartbeat = setInterval(() => {
    for (const s of conns) {
      if (!s.alive) {
        s.ws.terminate();
        continue;
      }
      s.alive = false;
      if (s.ws.readyState === WebSocket.OPEN) s.ws.ping();
    }
  }, o.heartbeatMs ?? HEARTBEAT_MS);

  function onMessage(s: Session, data: RawData, isBinary: boolean): void {
    if (s.state === 'closed') return;
    const now = clock();
    s.tokens = Math.min(RATE_BURST, s.tokens + ((now - s.refilledAt) * RATE_PER_SECOND) / 1000);
    s.refilledAt = now;
    if (s.tokens < 1) return fail(s, 'too_fast', 'Too many messages');
    s.tokens -= 1;

    const raw = isBinary ? '' : text(data);
    const msg = isBinary ? null : parseClientMsg(raw);
    if (s.state === 'hello') return onFirstMessage(s, raw, msg);
    if (!msg) return fail(s, 'bad_message', 'Bad message');
    if (msg.t === 'ping') return send(s, { t: 'pong', at: msg.at, serverTime: Date.now() });
    if (s.state === 'auth') return fail(s, 'bad_message', 'Wait for welcome');
    switch (msg.t) {
      case 'step':
        world.step(s.id, msg.dir, msg.seq, now);
        return flush();
      case 'face':
        world.face(s.id, msg.dir);
        return flush();
      case 'hello':
        return fail(s, 'bad_message', 'Already said hello');
    }
  }

  function onFirstMessage(s: Session, raw: string, msg: ClientMsg | null): void {
    if (!msg) {
      const [code, message] = helloProblem(raw) ?? ['bad_message', 'Say hello first'];
      return fail(s, code, message);
    }
    if (msg.t !== 'hello') return fail(s, 'bad_message', 'Say hello first');
    if (msg.v !== PROTOCOL_VERSION) return fail(s, 'bad_version', VERSION_TEXT);
    clearTimeout(s.helloTimer);
    s.state = 'auth';
    hello(s, msg).catch((err: unknown) => {
      log.error('hello failed', { err });
      // The protocol has no error code for our own failures: 1011 tells the client to retry later.
      if (s.state === 'auth') disconnect(s, 1011, 'server error');
    });
  }

  async function hello(s: Session, msg: Extract<ClientMsg, { t: 'hello' }>): Promise<void> {
    let found: { rec: PlayerRecord; token: string } | undefined;
    if (msg.token !== undefined) {
      const rec = await storage.findByTokenHash(hashToken(msg.token));
      if (s.state !== 'auth') return;
      if (!rec) return fail(s, 'unknown_token', 'Unknown token: choose a name');
      // Someone already online who signs in again does not need a new place.
      if (!world.has(rec.id) && isFull()) return fail(s, 'server_full', 'The server is full, try again soon');
      found = { rec, token: msg.token };
    } else if (msg.name !== undefined) {
      if (isFull()) return fail(s, 'server_full', 'The server is full, try again soon');
      joining++;
      try {
        found = await newPlayer(s, msg.name);
      } finally {
        joining--;
      }
    } else {
      return fail(s, 'bad_name', 'Choose a name');
    }
    if (!found || s.state !== 'auth') return;
    let { rec } = found;
    // Signed in again while still online (another tab, or a reconnect before the old socket
    // timed out): the old connection goes, and the freshest position comes with the player.
    const old = playing.get(rec.id);
    if (old) {
      send(old, { t: 'error', code: 'replaced', message: 'You are playing somewhere else' });
      rec = disconnect(old, CLOSE_CODES.replaced, 'replaced', false) ?? rec;
    }
    enter(s, rec, found.token);
  }

  /** Creates a player with a new token at the spawn. Undefined if that failed the session. */
  async function newPlayer(s: Session, name: string): Promise<{ rec: PlayerRecord; token: string } | undefined> {
    // parseClientMsg has already trimmed the name and checked it with PlayerName.
    const taken = await storage.nameTaken(name);
    if (s.state !== 'auth') return undefined;
    if (taken) {
      fail(s, 'bad_name', 'That name is taken');
      return undefined;
    }
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    const now = Date.now();
    const { spawn } = world.map.data;
    const rec: PlayerRecord = { id, name, tokenHash: hashToken(token), x: spawn.x, y: spawn.y, dir: spawn.dir, color: colorFor(id), createdAt: now, lastSeenAt: now };
    // create() also refuses the name if another player took it since nameTaken().
    if (!(await storage.create(rec))) {
      fail(s, 'bad_name', 'That name is taken');
      return undefined;
    }
    log.info('player created', { id, name });
    return { rec, token };
  }

  function enter(s: Session, rec: PlayerRecord, token: string): void {
    world.join(rec);
    s.state = 'play';
    s.id = rec.id;
    playing.set(rec.id, s);
    const { id, version } = world.map.data;
    send(s, {
      t: 'welcome',
      v: PROTOCOL_VERSION,
      you: rec.id,
      name: rec.name,
      token,
      players: world.views(),
      stepMs: world.stepMs,
      map: { id, version },
      weather: o.weather,
      serverTime: Date.now(),
    });
    flush();
    log.info('player joined', { id: rec.id, name: rec.name, online: world.size });
  }

  const isFull = () => world.size + joining >= o.maxPlayers;

  function fail(s: Session, code: ErrorCode, message: string): void {
    if (s.state === 'closed') return;
    send(s, { t: 'error', code, message });
    disconnect(s, CLOSE_CODES[code], code);
  }

  /** Closes the connection; returns the player's record if they were in the world. */
  function disconnect(s: Session, code: number, reason: string, save = true): PlayerRecord | undefined {
    const rec = removeFromWorld(s, save);
    s.state = 'closed';
    clearTimeout(s.helloTimer);
    s.ws.close(code, reason);
    return rec;
  }

  function removeFromWorld(s: Session, save: boolean): PlayerRecord | undefined {
    if (!s.id || playing.get(s.id) !== s) return undefined;
    playing.delete(s.id);
    const rec = world.leave(s.id);
    flush();
    if (rec && save) void persist(rec);
    log.info('player left', { id: s.id, online: world.size });
    return rec;
  }

  function onClose(s: Session): void {
    conns.delete(s);
    clearTimeout(s.helloTimer);
    s.state = 'closed';
    removeFromWorld(s, true);
  }

  /**
   * Saves a snapshot of the player. Saves of one player run one after another, so a periodic save
   * that started earlier can never land after (and overwrite) the save made when they left.
   */
  function persist(rec: PlayerRecord): Promise<void> {
    const snapshot = { ...rec, lastSeenAt: Date.now() };
    const done = (pendingSaves.get(rec.id) ?? Promise.resolve())
      .then(() => storage.save(snapshot))
      .catch((err: unknown) => log.error('saving a player failed', { id: rec.id, err }))
      .finally(() => {
        if (pendingSaves.get(rec.id) === done) pendingSaves.delete(rec.id);
      });
    pendingSaves.set(rec.id, done);
    return done;
  }

  /** Sends everything the World has queued. Runs after every World call. */
  function flush(): void {
    for (const out of world.drain()) {
      const data = encode(out.msg);
      if (out.to !== '*') {
        const s = playing.get(out.to);
        if (s) sendRaw(s, data);
      } else {
        for (const [id, s] of playing) if (id !== out.except) sendRaw(s, data);
      }
    }
  }

  function send(s: Session, msg: ServerMsg): void {
    sendRaw(s, encode(msg));
  }

  function sendRaw(s: Session, data: string): void {
    if (s.ws.readyState !== WebSocket.OPEN) return;
    if (s.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      log.warn('dropping a client that does not keep up', { id: s.id });
      s.state = 'closed';
      s.ws.terminate();
      return;
    }
    s.ws.send(data);
  }

  return {
    tick() {
      world.tick(clock());
      flush();
    },

    async saveAll() {
      // A slow database must not pile up rounds of saves.
      if (saving) return;
      saving = true;
      try {
        await Promise.all(world.records().map(persist));
      } finally {
        saving = false;
      }
    },

    async close(code = 1012) {
      if (closing) return;
      closing = true;
      clearInterval(heartbeat);
      const recs: PlayerRecord[] = [];
      for (const s of conns) {
        if (s.id && playing.get(s.id) === s) {
          playing.delete(s.id);
          const rec = world.leave(s.id);
          if (rec) recs.push(rec);
        }
        s.state = 'closed';
        clearTimeout(s.helloTimer);
        s.ws.close(code, 'server restarting');
      }
      world.drain(); // Nobody is left to hear who left.
      for (const rec of recs) void persist(rec);
      // Includes saves of players who left just before, so storage can be closed after this.
      await Promise.all(pendingSaves.values());
      // Clients get a moment to answer the close; then their sockets are cut.
      const force = setTimeout(() => {
        for (const ws of wss.clients) ws.terminate();
      }, 1000);
      await new Promise<void>(resolve => wss.close(() => resolve()));
      clearTimeout(force);
    },
  };
}

function text(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data).toString('utf8');
}

/**
 * Why a first message that failed validation was refused. A client of another protocol version
 * must hear bad_version (so it reloads) even if its hello looks different, and a bad name is bad_name.
 */
function helloProblem(raw: string): [ErrorCode, string] | undefined {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof json !== 'object' || json === null) return undefined;
  const { t, v, name } = json as { t?: unknown; v?: unknown; name?: unknown };
  if (t !== 'hello') return undefined;
  if (v !== PROTOCOL_VERSION) return ['bad_version', VERSION_TEXT];
  if (name !== undefined && !PlayerName.safeParse(name).success) return ['bad_name', NAME_TEXT];
  return undefined;
}
