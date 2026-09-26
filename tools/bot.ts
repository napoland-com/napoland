/**
 * Test players for a quick smoke test of a running server: each bot says hello, walks to random
 * places at full pace (one step every stepMs), then prints what happened.
 * Usage: npx tsx tools/bot.ts [--url ws://localhost:8080/ws] [--name Bot1] [--count 1] [--steps 50]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { NAME_RE, PROTOCOL_VERSION, TileMap, dirOf, findPath, type ClientMsg, type MapData, type ServerMsg } from '../packages/shared/src';

const USAGE = 'Usage: npx tsx tools/bot.ts [--url ws://localhost:8080/ws] [--name Bot1] [--count 1] [--steps 50]';

interface Result {
  name: string;
  ok: boolean;
  sent: number;
  accepted: number;
  rejected: number;
  seen: number;
  at: string;
  error?: string;
}

const maps = new Map<string, TileMap>();

/** The map the server says it runs, from this repo's content folder. */
function loadMap(id: string, version: number): TileMap {
  if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error(`strange map id from the server: ${id}`);
  let map = maps.get(id);
  if (!map) {
    const data = JSON.parse(readFileSync(resolve(import.meta.dirname, '../content/maps', `${id}.json`), 'utf8')) as MapData;
    if (data.version !== version) console.warn(`warning: the server runs ${id} version ${version}, this repo has version ${data.version}`);
    map = new TileMap(data);
    maps.set(id, map);
  }
  return map;
}

/** A random walkable tile near x,y. */
function randomTarget(map: TileMap, x: number, y: number): { x: number; y: number } {
  for (let i = 0; i < 100; i++) {
    const tx = x + Math.floor(Math.random() * 21) - 10;
    const ty = y + Math.floor(Math.random() * 21) - 10;
    if ((tx !== x || ty !== y) && map.walkable(tx, ty)) return { x: tx, y: ty };
  }
  return { x, y };
}

function runBot(url: string, name: string, steps: number): Promise<Result> {
  return new Promise(done => {
    const r: Result = { name, ok: false, sent: 0, accepted: 0, rejected: 0, seen: 0, at: '?' };
    const seen = new Set<string>();
    let you = '';
    let map: TileMap | undefined;
    let x = 0;
    let y = 0;
    let path: Array<{ x: number; y: number }> = [];
    let walker: ReturnType<typeof setInterval> | undefined;
    let grace: ReturnType<typeof setTimeout> | undefined;
    let finished = false;

    const ws = new WebSocket(url);
    const send = (msg: ClientMsg) => ws.send(JSON.stringify(msg));
    const giveUp = setTimeout(() => finish('timed out'), 15_000 + steps * 500);

    function finish(error?: string): void {
      if (finished) return;
      finished = true;
      clearInterval(walker);
      clearTimeout(grace);
      clearTimeout(giveUp);
      Object.assign(r, { ok: !error, error, seen: seen.size, at: you ? `${x},${y}` : '?' });
      if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) ws.close(1000);
      done(r);
    }

    function walk(): void {
      if (r.sent >= steps) {
        clearInterval(walker);
        // Answers for the last steps are on their way; do not wait forever for them.
        grace ??= setTimeout(() => finish(), 2000);
        return;
      }
      if (!path.length) {
        const t = randomTarget(map!, x, y);
        path = findPath(map!, x, y, t.x, t.y);
      }
      const next = path.shift();
      if (!next) return;
      send({ t: 'step', dir: dirOf(next.x - x, next.y - y)!, seq: ++r.sent });
      x = next.x;
      y = next.y;
    }

    ws.addEventListener('open', () => send({ t: 'hello', v: PROTOCOL_VERSION, name }));
    ws.addEventListener('error', () => finish(`cannot talk to ${url}`));
    ws.addEventListener('close', e => finish(`the server closed the connection (${e.code}${e.reason ? ` ${e.reason}` : ''})`));
    ws.addEventListener('message', e => {
      const msg = JSON.parse(String(e.data)) as ServerMsg;
      switch (msg.t) {
        case 'welcome': {
          you = msg.you;
          const me = msg.players.find(p => p.id === you)!;
          x = me.x;
          y = me.y;
          for (const p of msg.players) if (p.id !== you) seen.add(p.id);
          try {
            map = loadMap(msg.map.id, msg.map.version);
          } catch (err) {
            return finish(err instanceof Error ? err.message : String(err));
          }
          walker = setInterval(walk, msg.stepMs);
          walk();
          break;
        }
        case 'join':
          seen.add(msg.player.id);
          break;
        case 'step':
          if (msg.id !== you) seen.add(msg.id);
          else if (msg.seq !== undefined) r.accepted++;
          break;
        case 'reject':
          // The server knows best: continue from where it says we are.
          r.rejected++;
          x = msg.x;
          y = msg.y;
          path = [];
          break;
        case 'error':
          return finish(`${msg.code}: ${msg.message}`);
      }
      if (r.sent >= steps && r.accepted + r.rejected >= r.sent) finish();
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

  console.log(`${count} bot${count > 1 ? 's' : ''} on ${url}, ${steps} steps each`);
  // A little apart, so the first ones see the others join.
  const results = await Promise.all(names.map((n, i) => new Promise<Result>(ok => setTimeout(() => ok(runBot(url, n, steps)), i * 150))));
  for (const r of results) {
    const line = `${r.name.padEnd(16)} sent ${r.sent}  accepted ${r.accepted}  rejected ${r.rejected}  players seen ${r.seen}  ended at ${r.at}`;
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
