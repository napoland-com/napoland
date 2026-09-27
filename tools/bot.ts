/**
 * Test players for a quick smoke test of a running server: each bot says hello, walks to random
 * places at full pace (one step every stepMs), now and then heads for an exit so longer runs travel
 * from map to map, follows the server wherever it puts it (an exit, or home after a collapse), then
 * prints what happened. Along the way it picks up now and then what lies on its tile or next to it
 * (finds, and piles left by collapses), drinks a thermos when it runs low, and throws something away
 * when its bag is full.
 * Bots sign in the way the server asks (its /auth-config): without sign-in they make a new player
 * each run; in dev mode bot n signs in as bot-<n>@example.test, so it plays the same character every
 * run (the name only names it the first time). A server that wants Supabase sign-in takes no bots.
 * Usage: npx tsx tools/bot.ts [--url ws://localhost:8080/ws] [--name Bot1] [--count 1] [--steps 50]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  AuthConfig, NAME_RE, PROTOCOL_VERSION, TileMap, dirOf, findPath,
  type AuthMode, type BagSlot, type ClientMsg, type DropView, type FindView, type ItemsData, type MapData, type MapRef, type ServerMsg,
} from '../packages/shared/src';

const USAGE = 'Usage: npx tsx tools/bot.ts [--url ws://localhost:8080/ws] [--name Bot1] [--count 1] [--steps 50]';
const MAPS_DIR = resolve(import.meta.dirname, '../content/maps');
const ITEMS_FILE = resolve(import.meta.dirname, '../content/items.json');
/** How often a bot picks an exit of its map as the next place to walk to, instead of a place nearby. */
const EXIT_CHANCE = 0.25;
/** A bot that walked onto an exit waits this long to hear where it arrived. */
const ZONE_TIMEOUT_MS = 3000;
/** How often a bot stops to pick up what lies on its tile or next to it, instead of walking on. */
const PICK_CHANCE = 0.5;
/** Below this much energy a bot drinks what it carries that gives energy. */
const DRINK_BELOW = 35;

interface Result {
  name: string;
  ok: boolean;
  sent: number;
  accepted: number;
  rejected: number;
  seen: number;
  /** The maps the bot was on, in order. */
  maps: string[];
  collapses: number;
  energy: number | undefined;
  /** Units picked up from finds and from piles. */
  fromFinds: number;
  fromPiles: number;
  used: number;
  discarded: number;
  /** Picks, uses and discards the server refused, by reason. */
  refused: Record<string, number>;
  bag: BagSlot[];
  at: string;
  error?: string;
}

/** Every map of this repo's content folder, by id, read when the first bot needs one. */
let maps: Map<string, TileMap> | undefined;
const warned = new Set<string>();

/** This repo's items (for what gives energy), if it has them. */
const items: ItemsData | undefined = existsSync(ITEMS_FILE) ? (JSON.parse(readFileSync(ITEMS_FILE, 'utf8')) as ItemsData) : undefined;
const energizing = new Set((items?.items ?? []).filter(i => i.kind === 'consumable' && (i.use?.energy ?? 0) > 0).map(i => i.id));

/** The map the server says a bot is on. */
function mapFor(ref: MapRef): TileMap {
  maps ??= new Map(
    readdirSync(MAPS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const data = JSON.parse(readFileSync(join(MAPS_DIR, f), 'utf8')) as MapData;
        return [data.id, new TileMap(data)] as const;
      }),
  );
  const map = maps.get(ref.id);
  if (!map) throw new Error(`the server put us on map ${JSON.stringify(ref.id)}, which is not in ${MAPS_DIR}`);
  if (map.data.version !== ref.version && !warned.has(ref.id)) {
    warned.add(ref.id);
    console.warn(`warning: the server runs ${ref.id} version ${ref.version}, this repo has version ${map.data.version}`);
  }
  return map;
}

/** Where to walk next: sometimes a tile of one of the map's exits, otherwise a random walkable tile near x,y. */
function randomTarget(map: TileMap, x: number, y: number): { x: number; y: number } {
  const { exits } = map.data;
  if (exits.length && Math.random() < EXIT_CHANCE) {
    const e = exits[Math.floor(Math.random() * exits.length)]!;
    return { x: e.x + Math.floor(Math.random() * e.w), y: e.y + Math.floor(Math.random() * e.h) };
  }
  for (let i = 0; i < 100; i++) {
    const tx = x + Math.floor(Math.random() * 21) - 10;
    const ty = y + Math.floor(Math.random() * 21) - 10;
    if ((tx !== x || ty !== y) && map.walkable(tx, ty)) return { x: tx, y: ty };
  }
  return { x, y };
}

/**
 * How the server at `url` (its WebSocket address) wants players to sign in. A server from before
 * sign-in has no /auth-config; one that cannot be asked is taken to be without sign-in too, and
 * the bots find out soon enough when they connect.
 */
async function signInMode(url: string): Promise<AuthMode> {
  const page = new URL('/auth-config', url.replace(/^ws/, 'http'));
  try {
    const res = await fetch(page);
    if (res.status === 404) return 'legacy';
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return AuthConfig.parse(await res.json()).mode;
  } catch (err) {
    console.warn(`warning: could not ask ${page.href} how to sign in (${err instanceof Error ? err.message : String(err)}); trying without sign-in`);
    return 'legacy';
  }
}

/** `auth`: the email the bot signs in with (dev mode), or undefined without sign-in. */
function runBot(url: string, name: string, steps: number, auth: string | undefined): Promise<Result> {
  return new Promise(done => {
    const r: Result = {
      name, ok: false, sent: 0, accepted: 0, rejected: 0, seen: 0, maps: [], collapses: 0, energy: undefined,
      fromFinds: 0, fromPiles: 0, used: 0, discarded: 0, refused: {}, bag: [], at: '?',
    };
    const seen = new Set<string>();
    /** Steps sent that the server has not answered yet. */
    const pending = new Set<number>();
    let you = '';
    let map: TileMap | undefined;
    let x = 0;
    let y = 0;
    let path: Array<{ x: number; y: number }> = [];
    /** What lies on the bot's map, as the server tells it. */
    const finds = new Map<number, FindView>();
    const piles = new Map<string, DropView>();
    /** The pick, use or discard on its way, if any: one at a time. */
    let asking: 'pick' | 'use' | 'discard' | undefined;
    /** Set while the bot stands on an exit, waiting to hear where it arrived: it plans nothing on the old map. */
    let crossing: ReturnType<typeof setTimeout> | undefined;
    let walker: ReturnType<typeof setInterval> | undefined;
    let grace: ReturnType<typeof setTimeout> | undefined;
    let finished = false;

    const ws = new WebSocket(url);
    const send = (msg: ClientMsg) => ws.send(JSON.stringify(msg));
    const giveUp = setTimeout(() => finish('timed out'), 15_000 + steps * 500);
    const noZone = () => `walked onto an exit at ${x},${y} of ${map?.data.id}, but the server never said where we arrived`;

    function finish(error?: string): void {
      if (finished) return;
      finished = true;
      clearInterval(walker);
      clearTimeout(grace);
      clearTimeout(giveUp);
      clearTimeout(crossing);
      Object.assign(r, { ok: !error, error, seen: seen.size, at: map ? `${map.data.id} ${x},${y}` : '?' });
      if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) ws.close(1000);
      done(r);
    }

    /** The server put us on a map (welcome or zone), with what lies there. False if we do not have that map. */
    function arrive(ref: MapRef, ax: number, ay: number, lying: { finds: FindView[]; drops: DropView[] }): boolean {
      try {
        map = mapFor(ref);
      } catch (err) {
        finish(err instanceof Error ? err.message : String(err));
        return false;
      }
      if (r.maps.at(-1) !== ref.id) r.maps.push(ref.id);
      x = ax;
      y = ay;
      path = [];
      finds.clear();
      piles.clear();
      for (const f of lying.finds) finds.set(f.id, f);
      for (const d of lying.drops) piles.set(d.id, d);
      return true;
    }

    /** Something to pick up on the bot's tile or one next to it: a pile first, then a find. */
    function within(): { x: number; y: number } | undefined {
      const near = (t: { x: number; y: number }) => Math.abs(t.x - x) + Math.abs(t.y - y) <= 1;
      return [...piles.values()].find(near) ?? [...finds.values()].find(near);
    }

    function ask(msg: Extract<ClientMsg, { t: 'pick' | 'use' | 'discard' }>): void {
      asking = msg.t;
      send(msg);
    }

    function walk(): void {
      if (r.sent >= steps) {
        clearInterval(walker);
        // Answers for the last steps are on their way; do not wait forever for them.
        grace ??= setTimeout(() => finish(crossing ? noZone() : undefined), 2000);
        return;
      }
      if (crossing) return;
      // Now and then, stop to pick up what lies right here (this step's time goes to that instead).
      const there = asking ? undefined : within();
      if (there && Math.random() < PICK_CHANCE) return ask({ t: 'pick', x: there.x, y: there.y });
      if (!path.length) {
        const t = randomTarget(map!, x, y);
        path = findPath(map!, x, y, t.x, t.y);
      }
      const next = path.shift();
      if (!next) return;
      const seq = ++r.sent;
      pending.add(seq);
      send({ t: 'step', dir: dirOf(next.x - x, next.y - y)!, seq });
      x = next.x;
      y = next.y;
      // The server moves us to another map as soon as this step is taken.
      if (map!.exitAt(x, y)) {
        path = [];
        crossing = setTimeout(() => finish(noZone()), ZONE_TIMEOUT_MS);
      }
    }

    // With sign-in, the name only counts the first time: after that the bot's email has its character.
    ws.addEventListener('open', () => send({ t: 'hello', v: PROTOCOL_VERSION, name, ...(auth !== undefined && { auth }) }));
    ws.addEventListener('error', () => finish(`cannot talk to ${url}`));
    ws.addEventListener('close', e => finish(`the server closed the connection (${e.code}${e.reason ? ` ${e.reason}` : ''})`));
    ws.addEventListener('message', e => {
      const msg = JSON.parse(String(e.data)) as ServerMsg;
      switch (msg.t) {
        case 'welcome': {
          you = msg.you;
          // Signed in, a bot plays the character its email already has, whatever name it asked for.
          r.name = msg.name;
          const me = msg.players.find(p => p.id === you)!;
          for (const p of msg.players) if (p.id !== you) seen.add(p.id);
          r.energy = msg.energy.value;
          r.bag = msg.bag;
          if (items && msg.items !== items.version && !warned.has('items')) {
            warned.add('items');
            console.warn(`warning: the server runs items version ${msg.items}, this repo has version ${items.version}`);
          }
          if (!arrive(msg.map, me.x, me.y, msg)) return;
          walker = setInterval(walk, msg.stepMs);
          walk();
          break;
        }
        case 'zone':
          // Through an exit, or home after running out of energy. Steps still waiting on the
          // server were planned on the old map: it dropped them, and they get no answer.
          pending.clear();
          clearTimeout(crossing);
          crossing = undefined;
          if (msg.reason === 'collapse') r.collapses++;
          for (const p of msg.players) if (p.id !== you) seen.add(p.id);
          if (!arrive(msg.map, msg.x, msg.y, msg)) return;
          break;
        case 'energy': {
          r.energy = msg.energy.value;
          // Running low: drink something that gives energy, if the bag holds any.
          const slot = r.bag.findIndex(s => energizing.has(s.item));
          if (msg.energy.value < DRINK_BELOW && slot >= 0 && !asking) ask({ t: 'use', slot });
          break;
        }
        case 'find':
          finds.set(msg.find.id, msg.find);
          break;
        case 'findGone':
          finds.delete(msg.id);
          break;
        case 'drop':
          piles.set(msg.drop.id, msg.drop);
          break;
        case 'dropGone':
          piles.delete(msg.id);
          break;
        case 'got':
          for (const s of msg.items) r[msg.from === 'find' ? 'fromFinds' : 'fromPiles'] += s.count;
          break;
        case 'bag':
          // The answer to what the bot asked (a pick sends got first), or the bag falling out on a collapse.
          if (asking === 'use') r.used++;
          if (asking === 'discard') r.discarded++;
          r.bag = msg.bag;
          asking = undefined;
          break;
        case 'refused':
          r.refused[msg.reason] = (r.refused[msg.reason] ?? 0) + 1;
          asking = undefined;
          // No room: make some, so the next find fits.
          if (msg.reason === 'bag_full' && r.bag.length) ask({ t: 'discard', slot: Math.floor(Math.random() * r.bag.length) });
          break;
        case 'join':
          seen.add(msg.player.id);
          break;
        case 'step':
          if (msg.id !== you) seen.add(msg.id);
          else if (msg.seq !== undefined && pending.delete(msg.seq)) r.accepted++;
          break;
        case 'reject':
          // The server knows best: continue from where it says we are. Steps sent after a refused
          // one went nowhere either, so there is no exit to wait for.
          if (pending.delete(msg.seq)) r.rejected++;
          x = msg.x;
          y = msg.y;
          path = [];
          clearTimeout(crossing);
          crossing = undefined;
          break;
        case 'error':
          return finish(`${msg.code}: ${msg.message}`);
      }
      if (r.sent >= steps && !pending.size && !crossing) finish();
    });
  });
}

/** Returns the exit code: 0 if every bot got in and walked, 1 if one failed, 2 for bad arguments. */
async function main(): Promise<number> {
  const usage = (problem: string) => {
    console.error(`${problem}\n${USAGE}`);
    return 2;
  };
  let args;
  try {
    args = parseArgs({
      options: {
        url: { type: 'string', default: 'ws://localhost:8080/ws' },
        name: { type: 'string' },
        count: { type: 'string', default: '1' },
        steps: { type: 'string', default: '50' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }).values;
  } catch (err) {
    return usage(err instanceof Error ? err.message : String(err));
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const { url, name } = args;
  const count = Number(args.count);
  const steps = Number(args.steps);
  if (!Number.isInteger(count) || count < 1 || count > 500) return usage('--count must be a whole number from 1 to 500');
  if (!Number.isInteger(steps) || steps < 0) return usage('--steps must be a whole number, 0 or more');
  const names = Array.from({ length: count }, (_, i) => {
    if (name === undefined) return `Bot-${Math.random().toString(36).slice(2, 7)}`;
    return count > 1 ? `${name}-${i + 1}` : name;
  });
  const bad = names.find(n => !NAME_RE.test(n));
  if (bad !== undefined) return usage(`"${bad}" is not a valid name: 2 to 16 letters, digits, spaces, - or _`);

  const mode = await signInMode(url);
  if (mode === 'supabase') {
    console.error(`${url} wants players to sign in with Supabase (an email and a code), which bots cannot do. Run them against a server with AUTH_MODE=dev or legacy.`);
    return 1;
  }
  const auth = (i: number) => (mode === 'dev' ? `bot-${i + 1}@example.test` : undefined);
  const who = mode === 'dev' ? `, signed in as ${auth(0)}${count > 1 ? ` to ${auth(count - 1)}` : ''} (dev mode)` : '';
  console.log(`${count} bot${count > 1 ? 's' : ''} on ${url}, ${steps} steps each${who}`);
  // A little apart, so the first ones see the others join.
  const results = await Promise.all(names.map((n, i) => new Promise<Result>(ok => setTimeout(() => ok(runBot(url, n, steps, auth(i))), i * 150))));
  for (const r of results) {
    const refused = Object.entries(r.refused).map(([reason, n]) => `${n} ${reason}`).join(', ');
    const bag = r.bag.map(s => `${s.count} ${s.item}`).join(', ') || 'empty';
    const line =
      `${r.name.padEnd(16)} sent ${r.sent}  accepted ${r.accepted}  rejected ${r.rejected}  players seen ${r.seen}` +
      `  maps ${r.maps.join(' > ') || '?'}${r.collapses ? `  collapsed ${r.collapses}` : ''}  energy ${r.energy ?? '?'}` +
      `  picked ${r.fromFinds} from finds, ${r.fromPiles} from piles${r.used ? `  used ${r.used}` : ''}${r.discarded ? `  discarded ${r.discarded}` : ''}` +
      `${refused ? `  refused ${refused}` : ''}  bag ${bag}  ended at ${r.at}`;
    console.log(r.ok ? line : `${line}  FAILED: ${r.error}`);
  }
  const failed = results.filter(r => !r.ok).length;
  console.log(failed ? `${failed} of ${count} bots failed` : `all ${count} bots ok`);
  return failed ? 1 : 0;
}

// exitCode rather than process.exit(): stdout on Windows pipes is asynchronous and could be cut off.
void main().then(code => {
  process.exitCode = code;
});
