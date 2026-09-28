/**
 * The WebSocket side: one connection per player. Holds each address to its limits, checks the
 * hello (and with it who is signing in, see auth.ts), feeds client messages to the World and sends
 * out what the World has to say, each message to the players it is for: one player, or everyone in
 * one zone (a copy of a map). Nothing a client sends is trusted. It also stores players (now and then,
 * and when they leave), piles and marks (whenever one changes), thanks (whenever one is given or told,
 * with one more thanks received for its helper), what lies in the crates (whenever a thing is left or
 * taken) and the Old Stone (whenever it is fed or falls asleep).
 * Friends, requests, blocks, private messages and reports go to social.ts, one player's in order;
 * what is said to chat.ts, and calls without words to calls.ts. On a server with sign-in, whoever
 * says hello without it plays as a guest (a character that lives in their browser, by its token);
 * signing in later with that token keeps the character.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { STATUS_CODES, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  ENERGY_MAX,
  MAX_HELLO_BYTES,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  PlayerName,
  encode,
  parseClientMsg,
  type ClientMsg,
  type ErrorCode,
  type ServerMsg,
} from '@napoland/shared';
import { legacyAuth, type Auth } from './auth';
import { RollingLimit, clientIp } from './limits';
import { log } from './log';
import { Calls } from './calls';
import { Chat } from './chat';
import { Social, type SocialMsg } from './social';
import type { CacheItemRecord, DropRecord, MarkRecord, PlayerRecord, Storage, StoneRecord, ThanksRecord } from './storage';
import { colorFor, type World } from './world';

const HELLO_TIMEOUT_MS = 5000;
/** Mobile connections die silently; a socket that misses a ping round is closed. */
const HEARTBEAT_MS = 30_000;
const RATE_PER_SECOND = 30;
const RATE_BURST = 60;
/** A client this far behind on reading will not catch up; drop it before it eats our memory. */
const MAX_BUFFERED_BYTES = 1 << 20;
const HOUR_MS = 3_600_000;
/** Warnings that clients can cause at will are logged at most this often. */
const WARN_EVERY_MS = 60_000;

/** WebSocket close codes: 1008 for broken rules, 1013 for "try again later". */
const CLOSE_CODES: Record<ErrorCode, number> = {
  bad_message: 1008,
  bad_version: 1008,
  too_fast: 1008,
  bad_name: 1000,
  unknown_token: 1000,
  replaced: 1000,
  need_name: 1000,
  sign_in_required: 1000,
  has_character: 1000,
  server_full: 1013,
};
const VERSION_TEXT = `This server speaks protocol version ${PROTOCOL_VERSION}; reload to update`;
const NAME_TEXT = 'Names are 2 to 16 letters, digits, spaces, - or _';
const TOO_MANY_NEW_TEXT = 'Too many new players from your network. Try again later.';
const FULL_TEXT = 'The server is full, try again soon';

export interface NetOptions {
  server: Server;
  world: World;
  storage: Storage;
  maxPlayers: number;
  /** Game time in ms for the World and the rate limits. It must never go backwards. */
  clock?: () => number;
  helloTimeoutMs?: number;
  heartbeatMs?: number;
  /** The client address is the last X-Forwarded-For entry. Only behind our own proxy. */
  trustProxy?: boolean;
  /** Open connections one address may have; more get HTTP 429. Unset means no limit. */
  maxConnectionsPerIp?: number;
  /** New players one address may create in any hour. Unset means no limit. */
  newPlayersPerIpPerHour?: number;
  /** How players sign in. Unset means without sign-in (legacy). */
  auth?: Auth;
  /** Words chat masks. None if unset. */
  words?: readonly string[];
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
  /** The client's address, for the limits per address. Never logged. */
  ip: string;
  /** hello: waiting for it; auth: checking it; play: in the world; closed: deaf to everything. */
  state: 'hello' | 'auth' | 'play' | 'closed';
  /** The player's id, once in the world. */
  id: string;
  /** The zone whose news this player hears, once in the world (its key: a map's id for its main copy). */
  zone: string;
  /** The map of that zone, which is all anyone else is told of where they are (friends). */
  map: string;
  /** Plays as a guest (nobody signed in with the character, on a server with sign-in): no chat, no friends. */
  guest: boolean;
  /** Rate limit: a token bucket. */
  tokens: number;
  refilledAt: number;
  /** Answered the last heartbeat ping. */
  alive: boolean;
  helloTimer: ReturnType<typeof setTimeout>;
}

type Hello = Extract<ClientMsg, { t: 'hello' }>;

/** Who a hello turned out to be, and what their welcome says about how they got in. */
interface Entry {
  rec: PlayerRecord;
  /** Without sign-in (legacy, or a guest): the token they logged in with, or the new player's new one. */
  token?: string;
  /** This sign-in just claimed the character of the hello's token. */
  claimed?: true;
}

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export function attachNet(o: NetOptions): Net {
  const { world, storage } = o;
  const auth = o.auth ?? legacyAuth();
  const clock = o.clock ?? (() => performance.now());
  // noServer: upgrade requests come through onUpgrade first, which can refuse them. Frames may be
  // as long as a hello (it carries the sign-in); onMessage holds every later message to less.
  const wss = new WebSocketServer({ noServer: true, path: '/ws', maxPayload: MAX_HELLO_BYTES });
  const conns = new Set<Session>();
  /** Sessions whose player is in the world, by player id. */
  const playing = new Map<string, Session>();
  /** The same sessions by the zone they hear, for messages to everyone in a zone. */
  const audiences = new Map<string, Set<Session>>();
  /** New players between the capacity check and world.join (creating them takes a database round trip). */
  let joining = 0;
  /** The last save started for each player, while it runs. */
  const pendingSaves = new Map<string, Promise<void>>();
  /** The same for each player's pile, each mark and the Old Stone. */
  const pendingDrops = new Map<string, Promise<void>>();
  const pendingMarks = new Map<number, Promise<void>>();
  /** The same for each thanks (by giver, helper and day), and each helper's count of thanks received. */
  const pendingThanks = new Map<string, Promise<void>>();
  const pendingCredits = new Map<string, Promise<void>>();
  /** The same for each thing left in a crate. */
  const pendingCaches = new Map<number, Promise<void>>();
  let pendingStone: Promise<void> = Promise.resolve();
  let saving = false;
  let closing = false;
  /** Open sockets per client address. */
  const openPerIp = new Map<string, number>();
  const maxPerIp = o.maxConnectionsPerIp ?? Infinity;
  const newPlayers = new RollingLimit(o.newPlayersPerIpPerHour ?? Infinity, HOUR_MS, clock);
  const warnConnections = throttledLog('warn', 'too many connections from one address', clock);
  const warnNewPlayers = throttledLog('warn', 'too many new players from one address', clock);
  const warnCannotCheck = throttledLog('error', 'cannot check sign-ins (are Supabase\'s keys reachable?)', clock);
  /** Players sign in on this server, so whoever has not plays as a guest. */
  const guests = auth.mode !== 'legacy';
  const social = new Social({
    storage,
    clock,
    guests,
    isGuest: id => playing.get(id)?.guest ?? false,
    where: id => playing.get(id)?.map || undefined,
    send: (id, msg) => { const s = playing.get(id); if (s) send(s, msg); },
  });
  const chat = new Chat({
    world,
    clock,
    words: o.words ?? [],
    online: () => playing.keys(),
    blocks: id => social.blocks(id),
    send: (id, msg) => { const s = playing.get(id); if (s) send(s, msg); },
  });
  const calls = new Calls({
    world,
    clock,
    blocks: id => social.blocks(id),
    send: (id, msg) => { const s = playing.get(id); if (s) send(s, msg); },
  });
  // Someone who blocks a player hears no thanks from them either.
  world.blocks = id => social.blocks(id);
  /** Each player's social actions, one after another: each reads what the one before wrote. */
  const socialQueue = new Map<string, Promise<void>>();

  o.server.on('upgrade', onUpgrade);

  /** Refused here, before the handshake, a client over its limit costs no WebSocket at all. */
  function onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const ip = clientIp(req, o.trustProxy ?? false);
    const open = openPerIp.get(ip) ?? 0;
    if (open >= maxPerIp) {
      warnConnections();
      return refuseUpgrade(socket, 429, 'Too many connections from your network');
    }
    openPerIp.set(ip, open + 1);
    // The place is freed however the socket ends: a failed handshake, a bad hello, a player leaving.
    socket.once('close', () => {
      const left = openPerIp.get(ip)! - 1;
      if (left > 0) openPerIp.set(ip, left);
      else openPerIp.delete(ip);
    });
    wss.handleUpgrade(req, socket, head, ws => onConnection(ws, ip));
  }

  function onConnection(ws: WebSocket, ip: string): void {
    const s: Session = {
      ws,
      ip,
      state: 'hello',
      id: '',
      zone: '',
      map: '',
      guest: false,
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
  }

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
    if (s.state === 'hello') return onFirstMessage(s, raw, isBinary ? null : parseClientMsg(raw, MAX_HELLO_BYTES));
    // Only the hello may be that long; later messages get what ws gives frames over its limit.
    if (byteLength(data) > MAX_MESSAGE_BYTES) return void disconnect(s, 1009, 'message too big');
    const msg = isBinary ? null : parseClientMsg(raw);
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
      case 'pick':
        world.pick(s.id, msg.x, msg.y, now);
        return flush();
      case 'use':
        world.use(s.id, msg.slot, now);
        return flush();
      case 'discard':
        world.discard(s.id, msg.slot, now, msg.count);
        return flush();
      case 'feed':
        world.feed(s.id, msg.x, msg.y, msg.slot, now, msg.count);
        return flush();
      case 'board':
        world.board(s.id, msg.x, msg.y, now);
        return flush();
      case 'chest':
        world.chest(s.id, msg.x, msg.y);
        return flush();
      case 'store':
        world.store(s.id, msg.x, msg.y, msg.slot, now);
        return flush();
      case 'equip':
        world.equip(s.id, msg.x, msg.y, msg.item, now, msg.n);
        return flush();
      case 'mend':
        world.mend(s.id, msg.x, msg.y, msg.slot, now);
        return flush();
      case 'upgrade':
        world.upgrade(s.id, msg.x, msg.y, msg.of, now);
        return flush();
      case 'unequip':
        world.unequip(s.id, msg.x, msg.y, msg.slot, now);
        return flush();
      case 'wear':
        world.wear(s.id, msg.slot, now);
        return flush();
      case 'doff':
        world.doff(s.id, msg.slot, now);
        return flush();
      case 'outfit':
        world.outfit(s.id, msg.x, msg.y, msg.outfit, now);
        return flush();
      case 'bench':
        world.bench(s.id, msg.x, msg.y);
        return flush();
      case 'craft':
        world.craft(s.id, msg.x, msg.y, msg.recipe, now);
        return flush();
      case 'take':
        world.take(s.id, msg.x, msg.y, msg.item, msg.count, now, msg.n);
        return flush();
      case 'open':
        world.open(s.id, msg.x, msg.y, msg.item, now);
        return flush();
      case 'talk':
        world.talk(s.id, msg.x, msg.y, now);
        return flush();
      case 'stats':
        world.stats(s.id);
        return flush();
      case 'thank':
        // Guests too: a thanks carries no words.
        world.thank(s.id, msg.who, msg.what, now);
        return flush();
      case 'cache':
        world.openCache(s.id, msg.x, msg.y, now);
        return flush();
      case 'cacheLeave':
        world.cacheLeave(s.id, msg.x, msg.y, msg.slot, now);
        return flush();
      case 'cacheTake':
        world.cacheTake(s.id, msg.x, msg.y, msg.id, now);
        return flush();
      case 'befriend':
      case 'answer':
      case 'unfriend':
      case 'tell':
      case 'read':
      case 'block':
      case 'report':
      case 'requests':
      case 'friends':
        // Whether they play as a guest is taken now: the action may run after they have left.
        return befriends(s.id, () => social.handle(s.id, msg as SocialMsg, s.guest));
      case 'say':
        return chat.say(s.id, msg.to, msg.text);
      case 'call':
        return calls.call(s.id, msg.kind);
      case 'hello':
        return fail(s, 'bad_message', 'Already said hello');
    }
  }

  function befriends(id: string, run: () => Promise<void>): void {
    const done = (socialQueue.get(id) ?? Promise.resolve())
      .then(run)
      .catch((err: unknown) => log.error('a friends action failed', { id, err }))
      .finally(() => {
        if (socialQueue.get(id) === done) socialQueue.delete(id);
      });
    socialQueue.set(id, done);
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

  async function hello(s: Session, msg: Hello): Promise<void> {
    const entry = auth.mode === 'legacy' ? await legacyHello(s, msg) : msg.auth === undefined ? await guestHello(s, msg) : await signedInHello(s, msg);
    if (!entry || s.state !== 'auth') return;
    // Signed in again while still online (another tab, or a reconnect before the old socket
    // timed out): the old connection goes, and the freshest position comes with the player. Whose
    // character it is comes from storage: a guest may have been claimed just now.
    const old = playing.get(entry.rec.id);
    if (old) {
      send(old, { t: 'error', code: 'replaced', message: 'You are playing somewhere else' });
      const live = disconnect(old, CLOSE_CODES.replaced, 'replaced', false);
      if (live) entry.rec = { ...live, authSub: entry.rec.authSub };
    }
    enter(s, entry);
  }

  /** Without sign-in: a saved token logs back in; a name makes a new player, with a new token. */
  async function legacyHello(s: Session, msg: Hello): Promise<Entry | undefined> {
    if (msg.token !== undefined) {
      const rec = await storage.findByTokenHash(hashToken(msg.token));
      if (s.state !== 'auth') return undefined;
      if (!rec) return void fail(s, 'unknown_token', 'Unknown token: choose a name');
      return room(s, rec) ? { rec, token: msg.token } : undefined;
    }
    if (msg.name !== undefined) return newPlayer(s, msg.name, null);
    return void fail(s, 'bad_name', 'Choose a name');
  }

  /**
   * On a server with sign-in, without it: a guest. The token this browser keeps plays its character,
   * unless someone has signed in with it since (then only they play it, signed in); a name makes a
   * new guest, held to the name rules and the limit of new players per address like anyone new.
   */
  async function guestHello(s: Session, msg: Hello): Promise<Entry | undefined> {
    if (msg.token !== undefined) {
      const rec = await storage.findByTokenHash(hashToken(msg.token));
      if (s.state !== 'auth') return undefined;
      if (!rec) return void fail(s, 'unknown_token', 'Unknown token: choose a name');
      if (rec.authSub !== null) return void fail(s, 'sign_in_required', 'This character belongs to an account: sign in to play it');
      // Seen before it plays: the cleanup of guests who stayed away, should it run meanwhile, spares it (or had taken it).
      const here = await storage.seen(rec.id, Date.now());
      if (s.state !== 'auth') return undefined;
      if (!here) return void fail(s, 'unknown_token', 'Unknown token: choose a name');
      return room(s, rec) ? { rec, token: msg.token } : undefined;
    }
    if (msg.name !== undefined) return newPlayer(s, msg.name, null);
    return void fail(s, 'sign_in_required', 'Sign in, or choose a name to play as a guest');
  }

  /**
   * With sign-in: `auth` must prove who this is. They get their character; without one, the
   * character of the hello's token if nobody has claimed it yet (a guest, or made before sign-in,
   * on this browser); without that, a new one with the hello's name; without a name, need_name.
   * One character per identity: an account that has one already never takes the guest of the
   * hello's token, and says so (has_character) rather than play in its place unasked.
   */
  async function signedInHello(s: Session, msg: Hello): Promise<Entry | undefined> {
    const sub = await identify(s, msg.auth);
    if (s.state !== 'auth') return undefined;
    if (sub === undefined) return void fail(s, 'sign_in_required', 'Sign in to play');
    const mine = await storage.findByAuthSub(sub);
    if (s.state !== 'auth') return undefined;
    if (mine) {
      if (msg.token !== undefined && hashToken(msg.token) !== mine.tokenHash) {
        const guest = await storage.findByTokenHash(hashToken(msg.token));
        if (s.state !== 'auth') return undefined;
        if (guest && guest.authSub === null) return void fail(s, 'has_character', 'This account already has a character', mine.name);
      }
      return room(s, mine) ? { rec: mine } : undefined;
    }
    if (msg.token !== undefined) {
      const claimed = await claim(s, sub, msg.token);
      if (claimed || s.state !== 'auth') return claimed;
    }
    if (msg.name === undefined) return void fail(s, 'need_name', 'Choose a name for your character');
    return newPlayer(s, msg.name, sub);
  }

  /**
   * The identity a hello's `auth` proves, or undefined. When it cannot be checked right now, the
   * session ends with 1011, so the client tries again later instead of asking to sign in again.
   */
  async function identify(s: Session, proof: string | undefined): Promise<string | undefined> {
    if (proof === undefined) return undefined;
    try {
      return await auth.identify(proof);
    } catch (err) {
      warnCannotCheck({ err: err instanceof Error ? err.message : String(err) });
      if (s.state === 'auth') disconnect(s, 1011, 'cannot check sign-in');
      return undefined;
    }
  }

  /** The character of a token saved before sign-in, now `sub`'s, if nobody had claimed it yet. */
  async function claim(s: Session, sub: string, token: string): Promise<Entry | undefined> {
    const rec = await storage.findByTokenHash(hashToken(token));
    if (!rec || rec.authSub !== null || s.state !== 'auth' || !room(s, rec)) return undefined;
    if (await storage.claim(rec.id, sub)) {
      log.info('character claimed', { id: rec.id });
      return { rec: { ...rec, authSub: sub }, claimed: true };
    }
    // Lost a race: someone claimed it first, or this identity got a character meanwhile (another tab).
    const mine = await storage.findByAuthSub(sub);
    return mine && s.state === 'auth' && room(s, mine) ? { rec: mine } : undefined;
  }

  /** Someone already online who signs in again needs no new place; anyone else does. False if the session failed for it. */
  function room(s: Session, rec: PlayerRecord): boolean {
    if (world.has(rec.id) || !isFull()) return true;
    fail(s, 'server_full', FULL_TEXT);
    return false;
  }

  /**
   * A new player, where everyone wakes up (World.wakeUp: at home, by the fire): with a new token
   * without sign-in (`sub` null: in legacy mode, or a guest), or belonging to `sub`. Undefined if that
   * failed the session.
   */
  async function newPlayer(s: Session, name: string, sub: string | null): Promise<Entry | undefined> {
    if (isFull()) return void fail(s, 'server_full', FULL_TEXT);
    // Every new player is a database row: one address must not make them without end.
    if (!newPlayers.start(s.ip)) {
      warnNewPlayers();
      return void fail(s, 'bad_name', TOO_MANY_NEW_TEXT);
    }
    joining++;
    let made = false;
    let entry: Entry | undefined;
    try {
      // parseClientMsg has already trimmed the name and checked it with PlayerName.
      const taken = await storage.nameTaken(name);
      if (s.state !== 'auth') return undefined;
      if (taken) return void fail(s, 'bad_name', 'That name is taken');
      const token = sub === null ? randomBytes(32).toString('base64url') : undefined;
      const id = randomUUID();
      const now = Date.now();
      // Where everyone wakes up: at home, by the fire (the World puts them in a copy of the home of their own).
      const { map, x, y, dir } = world.wakeUp;
      const rec: PlayerRecord = {
        id, name, tokenHash: token === undefined ? null : hashToken(token), authSub: sub, map: map.data.id, x, y, dir,
        color: colorFor(id), energy: ENERGY_MAX, bag: [], wet: 0, stats: {}, xp: 0, stash: { items: {}, out: {} }, createdAt: now, lastSeenAt: now,
      };
      // create() also refuses the name if another player took it since nameTaken().
      made = await storage.create(rec);
      if (made) {
        log.info('player created', { id, name, ...(guests && sub === null && { guest: true }) });
        entry = token === undefined ? { rec } : { rec, token };
      } else if (sub !== null) {
        // Or this identity got a character meanwhile (two tabs at once): then it plays that one.
        const mine = await storage.findByAuthSub(sub);
        if (mine) entry = { rec: mine };
      }
      if (!entry) fail(s, 'bad_name', 'That name is taken');
    } finally {
      joining--;
      // Only a player that was really created counts; a taken name or an error does not.
      newPlayers.finish(s.ip, made);
    }
    return s.state === 'auth' ? entry : undefined;
  }

  function enter(s: Session, { rec, token, claimed }: Entry): void {
    const joined = world.join(rec, clock());
    s.state = 'play';
    s.id = rec.id;
    s.guest = guests && rec.authSub === null;
    playing.set(rec.id, s);
    hear(s, world.zoneOf(rec.id)!, joined.map.id);
    send(s, {
      t: 'welcome',
      v: PROTOCOL_VERSION,
      you: rec.id,
      name: rec.name,
      ...(token !== undefined && { token }),
      ...(claimed && { claimed }),
      guest: s.guest,
      map: joined.map,
      players: joined.players,
      finds: joined.finds,
      drops: joined.drops,
      stepMs: world.stepMs,
      weather: world.weather,
      energy: joined.energy,
      bag: joined.bag,
      stash: joined.stash,
      fires: joined.fires,
      marks: joined.marks,
      creatures: joined.creatures,
      flares: joined.flares,
      flashes: joined.flashes,
      surge: joined.surge,
      storm: joined.storm,
      body: joined.body,
      stone: joined.stone,
      conditions: joined.conditions,
      stats: joined.stats,
      progress: joined.progress,
      ...(joined.restedAway > 0 && { restedAway: joined.restedAway }),
      tools: joined.tools,
      items: world.itemsVersion,
      story: joined.story,
      thanked: joined.thanked,
      serverTime: Date.now(),
    });
    flush();
    const guest = s.guest;
    // Once whom they block is known, a player back in the game at home reads their letter (World.returned).
    befriends(rec.id, async () => {
      await social.joined(rec.id, guest);
      if (playing.get(rec.id) !== s) return;
      world.returned(rec.id, clock());
      flush();
    });
    log.info('player joined', { id: rec.id, name: rec.name, map: joined.map.id, online: world.size, ...(guest && { guest }) });
  }

  const isFull = () => world.size + joining >= o.maxPlayers;

  /** Ends the hello (or the game here) with an error; `name` goes with has_character. */
  function fail(s: Session, code: ErrorCode, message: string, name?: string): void {
    if (s.state === 'closed') return;
    send(s, { t: 'error', code, message, ...(name !== undefined && { name }) });
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
    social.left(s.id);
    hear(s, '', '');
    const rec = world.leave(s.id, clock());
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

  /** Stores a player's pile as it is now, or forgets it (undefined). One owner's writes run in order, like persist(). */
  function persistDrop(owner: string, drop: DropRecord | undefined): Promise<void> {
    const done = (pendingDrops.get(owner) ?? Promise.resolve())
      .then(() => (drop ? storage.saveDrop(drop) : storage.removeDrop(owner)))
      .catch((err: unknown) => log.error('saving a pile failed', { owner, err }))
      .finally(() => {
        if (pendingDrops.get(owner) === done) pendingDrops.delete(owner);
      });
    pendingDrops.set(owner, done);
    return done;
  }

  /** Stores a mark as it is now, or forgets it. One mark's writes run in order, like persist(). */
  function persistMark(id: number, mark: MarkRecord | undefined): Promise<void> {
    const done = (pendingMarks.get(id) ?? Promise.resolve())
      .then(() => (mark ? storage.saveMark(mark) : storage.removeMark(id)))
      .catch((err: unknown) => log.error('saving a mark failed', { id, err }))
      .finally(() => {
        if (pendingMarks.get(id) === done) pendingMarks.delete(id);
      });
    pendingMarks.set(id, done);
    return done;
  }

  /** Stores a thanks as it is now. One thanks's writes run in order (given, then told), like persist(). */
  function persistThanks(t: ThanksRecord): Promise<void> {
    const key = `${t.giver} ${t.helper} ${t.day}`;
    const done = (pendingThanks.get(key) ?? Promise.resolve())
      .then(() => storage.saveThanks(t))
      .catch((err: unknown) => log.error('saving a thanks failed', { giver: t.giver, helper: t.helper, err }))
      .finally(() => {
        if (pendingThanks.get(key) === done) pendingThanks.delete(key);
      });
    pendingThanks.set(key, done);
    return done;
  }

  /** One more thanks received by `helper`, added in storage on its own (the save of a player never writes it). */
  function persistCredit(helper: string): Promise<void> {
    const done = (pendingCredits.get(helper) ?? Promise.resolve())
      .then(() => storage.creditThanks(helper))
      .catch((err: unknown) => log.error('counting a thanks failed', { helper, err }))
      .finally(() => {
        if (pendingCredits.get(helper) === done) pendingCredits.delete(helper);
      });
    pendingCredits.set(helper, done);
    return done;
  }

  /** Stores a thing left in a crate, or forgets it (taken). One thing's writes run in order, like persist(). */
  function persistCache(id: number, item: CacheItemRecord | undefined): Promise<void> {
    const done = (pendingCaches.get(id) ?? Promise.resolve())
      .then(() => (item ? storage.saveCacheItem(item) : storage.removeCacheItem(id)))
      .catch((err: unknown) => log.error('saving a crate failed', { id, err }))
      .finally(() => {
        if (pendingCaches.get(id) === done) pendingCaches.delete(id);
      });
    pendingCaches.set(id, done);
    return done;
  }

  function persistStone(stone: StoneRecord): Promise<void> {
    pendingStone = pendingStone.then(() => storage.saveStone(stone)).catch((err: unknown) => log.error('saving the Old Stone failed', { err }));
    return pendingStone;
  }

  /** Starts the writes the World asked for: every pile, mark and thanks that changed, the players whose bag changed with one, the Old Stone. */
  function store(): void {
    const { drops, players, marks, stone, thanks, credits, caches } = world.takeWrites();
    // Players first: a pile or a mark belongs to a player who must exist in the database.
    for (const rec of players) void persist(rec);
    for (const { owner, drop } of drops) void persistDrop(owner, drop);
    for (const { id, mark } of marks) void persistMark(id, mark);
    for (const { id, item } of caches) void persistCache(id, item);
    for (const t of thanks) void persistThanks(t);
    for (const helper of credits) void persistCredit(helper);
    if (stone) void persistStone(stone);
  }

  /**
   * Sends everything the World has queued, in order, and starts the writes it asked for. Runs after
   * every World call. A message for a zone goes to the players in it at that point of the queue: a
   * player who changes zones hears the new one from their `zone` message on (a copy's key comes with it,
   * never to the client), even when several players moved in the same tick.
   */
  function flush(): void {
    for (const out of world.drain()) {
      const data = encode(out.msg);
      if (out.to === 'all') {
        for (const p of playing.values()) sendRaw(p, data);
        continue;
      }
      if ('map' in out) {
        for (const s of audiences.get(out.map) ?? []) if (s.id !== out.except) sendRaw(s, data);
        continue;
      }
      const s = playing.get(out.to);
      if (!s) continue;
      if (out.msg.t === 'zone') hear(s, ('zone' in out ? out.zone : undefined) ?? out.msg.map.id, out.msg.map.id);
      sendRaw(s, data);
    }
    store();
  }

  /** Makes a session hear the news of another zone, on `map` ('' for none). */
  function hear(s: Session, zone: string, map: string): void {
    if (s.zone) {
      const old = audiences.get(s.zone);
      old?.delete(s);
      if (old?.size === 0) audiences.delete(s.zone);
    }
    s.zone = zone;
    s.map = map;
    if (!zone) return;
    const audience = audiences.get(zone);
    if (audience) audience.add(s);
    else audiences.set(zone, new Set([s]));
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
      const now = clock();
      for (const s of conns) {
        if (s.id && playing.get(s.id) === s) {
          playing.delete(s.id);
          hear(s, '', '');
          const rec = world.leave(s.id, now);
          if (rec) recs.push(rec);
        }
        s.state = 'closed';
        clearTimeout(s.helloTimer);
        s.ws.close(code, 'server restarting');
      }
      world.drain(); // Nobody is left to hear who left.
      // Piles dropped by players whose energy ran out as they left.
      store();
      for (const rec of recs) void persist(rec);
      // Includes writes for players who left just before, so storage can be closed after this.
      await Promise.all([
        ...pendingSaves.values(), ...pendingDrops.values(), ...pendingMarks.values(), ...pendingThanks.values(), ...pendingCredits.values(), ...pendingCaches.values(), pendingStone,
      ]);
      // Clients get a moment to answer the close; then their sockets are cut.
      const force = setTimeout(() => {
        for (const ws of wss.clients) ws.terminate();
      }, 1000);
      o.server.off('upgrade', onUpgrade);
      await new Promise<void>(resolve => wss.close(() => resolve()));
      clearTimeout(force);
    },
  };
}

function text(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data).toString('utf8');
}

function byteLength(data: RawData): number {
  return Array.isArray(data) ? data.reduce((n, b) => n + b.byteLength, 0) : data.byteLength;
}

/** Answers an upgrade request with an HTTP error instead of a WebSocket, and closes the socket. */
function refuseUpgrade(socket: Duplex, status: number, message: string): void {
  // Nobody else listens for errors on this socket, and an unhandled one would stop the process.
  socket.on('error', () => socket.destroy());
  // The HTTP server would keep the socket half open after end(); once the answer is out, it goes.
  socket.once('finish', () => socket.destroy());
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\n` +
      `Content-Length: ${Buffer.byteLength(message)}\r\nCache-Control: no-store\r\n\r\n${message}`,
  );
}

/**
 * A problem clients can repeat at will: logged at most once a minute, with how many times it
 * happened since the last line, so a flood cannot fill the disk with log lines.
 */
function throttledLog(level: 'warn' | 'error', msg: string, clock: () => number): (fields?: Record<string, unknown>) => void {
  let loggedAt = -Infinity;
  let times = 0;
  return fields => {
    times++;
    const now = clock();
    if (now - loggedAt < WARN_EVERY_MS) return;
    log[level](msg, { times, ...fields });
    loggedAt = now;
    times = 0;
  };
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
