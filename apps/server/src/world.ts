/**
 * The game rules for the players who are online. No I/O and no clock of its own: every call that
 * depends on time gets `now` (ms), and everything the players should hear is queued as Outgoing
 * messages for the network layer to drain and send.
 *
 * The world is several maps joined by exits; players see and hear only the players on their own
 * map. Everyone online has energy, which drains in the wilds and refills in town and under street
 * lights (the numbers are in shared/energy.ts). At zero a player collapses and wakes up at home.
 */
import {
  ENERGY_MAX,
  ENERGY_SYNC_MS,
  STEP_MS,
  energyRate,
  stepTarget,
  type Arrival,
  type Dir,
  type EnergyView,
  type MapRef,
  type PlayerView,
  type ServerMsg,
  type TileMap,
  type Weather,
} from '@napoland/shared';
import type { PlayerRecord } from './storage';

/** A step may start this much early: messages sent at a steady pace arrive bunched up. */
export const STEP_TOLERANCE_MS = 40;
/** Early steps wait here, in order; one more than this is rejected. */
export const STEP_QUEUE_MAX = 2;
/**
 * A player hears their energy again as soon as its rate moves this share away from the rate they
 * last heard. Smaller changes (one more step into the woods) wait for the regular repeat.
 */
export const ENERGY_RATE_CHANGE = 0.1;

/** Jacket colors, all easy to tell apart in the rain and at night. */
export const JACKET_COLORS = [
  '#e4572e', // red
  '#f29e4c', // orange
  '#f1c40f', // yellow
  '#7bc950', // green
  '#2ec4b6', // teal
  '#3a86ff', // blue
  '#9b5de5', // purple
  '#f15bb5', // pink
  '#f4f1de', // white
  '#c08552', // tan
] as const;

/** The same id always gets the same color (FNV-1a hash of the id). */
export function colorFor(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return JACKET_COLORS[(h >>> 0) % JACKET_COLORS.length]!;
}

/**
 * A message for one player (by id), or for everyone on a map ('*'), optionally leaving one player
 * out. '*' means everyone on the map when the message was queued: the network layer sends the
 * messages in order and moves a player over to the new map's audience at their `zone` message.
 */
export type Outgoing = { to: string; msg: ServerMsg } | { to: '*'; map: string; except?: string; msg: ServerMsg };

/** What a player who joins is told in the welcome: where they are, who is there, their energy. */
export interface Joined {
  player: PlayerView;
  map: MapRef;
  /** Everyone on the player's map, the player included. */
  players: PlayerView[];
  energy: EnergyView;
}

export interface WorldOptions {
  /** Time to walk one tile. */
  stepMs?: number;
  /** Hears about every collapse, with where the player fell (for the log). */
  onCollapse?: (id: string, where: { map: string; x: number; y: number }) => void;
}

interface Online {
  rec: PlayerRecord;
  map: TileMap;
  /** When the current step is over and the next one may start. */
  readyAt: number;
  queue: Array<{ dir: Dir; seq: number }>;
  /** Energy per second on the player's tile. rec.energy is up to date as of energyAt. */
  rate: number;
  energyAt: number;
  /** The rate the player last heard, and when: the client counts on from there. */
  heardRate: number;
  heardAt: number;
}

const view = (r: PlayerRecord): PlayerView => ({ id: r.id, name: r.name, x: r.x, y: r.y, dir: r.dir, color: r.color });
const mapRef = (m: TileMap): MapRef => ({ id: m.data.id, version: m.data.version });
const energyView = (p: Online): EnergyView => ({
  value: Math.round(p.rec.energy * 10) / 10,
  max: ENERGY_MAX,
  rate: Math.round(p.rate * 1000) / 1000,
});
/** Draining and not empty yet, or refilling and not full yet. */
const changing = (p: Online): boolean => (p.rate < 0 && p.rec.energy > 0) || (p.rate > 0 && p.rec.energy < ENERGY_MAX);

export class World {
  readonly stepMs: number;
  /** Where new players start and collapsed players wake up. */
  readonly home: TileMap;
  private readonly maps = new Map<string, TileMap>();
  private readonly players = new Map<string, Online>();
  /** Who is on each map, by map id. */
  private readonly onMap = new Map<string, Set<Online>>();
  /** readyAt of players who left mid-step, so leaving and joining again cannot skip the wait. */
  private readonly resting = new Map<string, number>();
  private outbox: Outgoing[] = [];
  private sky: Weather;
  private readonly onCollapse: WorldOptions['onCollapse'];

  /** `maps` must fit together (validateWorld); `homeId` is one of them, a town. */
  constructor(maps: Iterable<TileMap>, homeId: string, weather: Weather, options: WorldOptions = {}) {
    for (const m of maps) {
      if (this.maps.has(m.data.id)) throw new Error(`two maps have the id ${m.data.id}`);
      this.maps.set(m.data.id, m);
      this.onMap.set(m.data.id, new Set());
    }
    // loadMaps checks this and more; a world without it would lose players walking through an exit.
    for (const m of this.maps.values()) {
      for (const e of m.data.exits) if (!this.maps.has(e.to)) throw new Error(`map ${m.data.id} has an exit to ${e.to}, which does not exist`);
    }
    const home = this.maps.get(homeId);
    if (!home) throw new Error(`the home map ${homeId} does not exist`);
    this.home = home;
    this.sky = weather;
    this.stepMs = options.stepMs ?? STEP_MS;
    this.onCollapse = options.onCollapse;
  }

  get weather(): Weather {
    return this.sky;
  }

  get size(): number {
    return this.players.size;
  }

  has(id: string): boolean {
    return this.players.has(id);
  }

  /** A copy of an online player's record, as it should be saved (energy as of the last tick). */
  get(id: string): PlayerRecord | undefined {
    const p = this.players.get(id);
    return p && { ...p.rec };
  }

  records(): PlayerRecord[] {
    return [...this.players.values()].map(p => ({ ...p.rec }));
  }

  /** Everyone on a map. */
  views(mapId: string): PlayerView[] {
    return [...(this.onMap.get(mapId) ?? [])].map(p => view(p.rec));
  }

  /** Puts a player in the world, tells everyone on their map and returns what goes in the welcome. */
  join(rec: PlayerRecord, now: number): Joined {
    if (this.players.has(rec.id)) throw new Error(`player ${rec.id} is already online`);
    const r = { ...rec };
    // Maps change between visits: a map may be gone (start over at home), or the saved tile may be
    // inside something new or part of an exit now (start at that map's spawn). Never start inside
    // a wall, or on an exit that would move you the moment you step.
    let map = this.maps.get(r.map);
    if (!map) {
      map = this.home;
      toSpawn(r, map);
    } else if (!map.walkable(r.x, r.y) || map.exitAt(r.x, r.y)) {
      toSpawn(r, map);
    }
    r.map = map.data.id;
    r.energy = Number.isFinite(r.energy) ? Math.min(ENERGY_MAX, Math.max(0, r.energy)) : ENERGY_MAX;
    const readyAt = this.resting.get(r.id) ?? -Infinity;
    this.resting.delete(r.id);
    const rate = energyRate(map, r.x, r.y, this.sky);
    const p: Online = { rec: r, map, readyAt, queue: [], rate, energyAt: now, heardRate: rate, heardAt: now };
    this.players.set(r.id, p);
    this.onMap.get(map.data.id)!.add(p);
    const player = view(r);
    this.toMap(map, { t: 'join', player }, r.id);
    // The welcome has the energy too; the message after it is what a client listens to from then on.
    this.tell(p, now);
    return { player, map: mapRef(map), players: this.views(map.data.id), energy: energyView(p) };
  }

  /** Takes a player out of the world, tells everyone on their map and returns the record to save. */
  leave(id: string, now: number): PlayerRecord | undefined {
    const p = this.players.get(id);
    if (!p) return undefined;
    const from = p.map;
    // Energy that runs out on the way out still counts: the player wakes up at home next time.
    if (this.advance(p, now) <= 0) this.fall(p);
    this.players.delete(id);
    this.onMap.get(p.map.data.id)!.delete(p);
    if (p.readyAt > -Infinity) this.resting.set(id, p.readyAt);
    this.toMap(from, { t: 'leave', id }, id);
    return { ...p.rec };
  }

  /**
   * Walk one tile. A step starts when the previous one is (almost) over; readyAt then moves on by
   * stepMs from whichever is later, now or readyAt, so arriving early never adds up to walking
   * faster. Steps that arrive too early wait in a short queue that tick() works through; when
   * it is full the new step is refused and the queued ones still run.
   */
  step(id: string, dir: Dir, seq: number, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.runQueue(p, now);
    if (p.queue.length === 0 && this.ready(p, now)) this.move(p, dir, seq, now);
    else if (p.queue.length < STEP_QUEUE_MAX) p.queue.push({ dir, seq });
    else this.reject(p, seq);
  }

  /** Turn in place. Only a real change is worth telling the others about. */
  face(id: string, dir: Dir): void {
    const p = this.players.get(id);
    if (!p || p.rec.dir === dir) return;
    p.rec.dir = dir;
    this.toMap(p.map, { t: 'face', id, dir }, id);
  }

  /**
   * Brings everyone's energy up to `now` (whoever ran out collapses), starts queued steps whose time
   * has come and repeats the energy of players whose bar is moving. Call it often (every TICK_MS).
   */
  tick(now: number): void {
    for (const p of this.players.values()) {
      if (this.advance(p, now) <= 0) {
        this.collapse(p, now);
        continue;
      }
      if (p.queue.length) this.runQueue(p, now);
      // The client counts on with the rate it heard; repeating the value keeps it from drifting.
      if (now - p.heardAt >= ENERGY_SYNC_MS && changing(p)) this.tell(p, now);
    }
    for (const [id, readyAt] of this.resting) if (readyAt <= now) this.resting.delete(id);
  }

  /** Changes the weather everywhere. Energy rates follow: bad weather drains faster. */
  setWeather(weather: Weather, now: number): void {
    if (weather === this.sky) return;
    this.sky = weather;
    for (const [map, here] of this.onMap) if (here.size) this.outbox.push({ to: '*', map, msg: { t: 'weather', weather } });
    for (const p of this.players.values()) {
      // Up to now at the rate of the old weather, which the player still has.
      if (this.advance(p, now) <= 0) this.collapse(p, now);
      else this.rerate(p, now);
    }
  }

  /** Everything queued since the last drain, in order. */
  drain(): Outgoing[] {
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  private ready(p: Online, now: number): boolean {
    return now >= p.readyAt - STEP_TOLERANCE_MS;
  }

  private runQueue(p: Online, now: number): void {
    while (p.queue.length && this.ready(p, now)) {
      const s = p.queue.shift()!;
      this.move(p, s.dir, s.seq, now);
    }
  }

  private move(p: Online, dir: Dir, seq: number, now: number): void {
    // Energy that ran out before this step could start: the player collapses instead of walking.
    if (this.advance(p, now) <= 0) return this.collapse(p, now);
    const { x, y } = stepTarget(p.rec.x, p.rec.y, dir);
    if (!p.map.walkable(x, y)) {
      // Steps queued behind this one were planned from a tile the player never reached.
      p.queue.length = 0;
      return this.reject(p, seq);
    }
    const { id } = p.rec;
    p.rec.x = x;
    p.rec.y = y;
    p.rec.dir = dir;
    p.readyAt = Math.max(now, p.readyAt) + this.stepMs;
    this.outbox.push({ to: id, msg: { t: 'step', id, x, y, dir, seq } });
    this.toMap(p.map, { t: 'step', id, x, y, dir }, id);
    const exit = p.map.exitAt(x, y);
    if (exit) this.cross(p, exit, now);
    else this.rerate(p, now);
  }

  /** Refuses step `seq`, telling the mover where they really are. */
  private reject(p: Online, seq: number): void {
    const { id, x, y, dir } = p.rec;
    this.outbox.push({ to: id, msg: { t: 'reject', seq, x, y, dir } });
  }

  /**
   * The player stepped onto an exit and goes on to the other map at once. readyAt stays as it is,
   * so changing maps never lets anyone walk faster.
   */
  private cross(p: Online, to: Arrival, now: number): void {
    const from = p.map;
    this.place(p, this.maps.get(to.to)!, to.x, to.y, to.dir);
    this.arrive(p, from, 'exit', now);
  }

  /** Out of energy while online: the player wakes up at home, and both maps see it. */
  private collapse(p: Online, now: number): void {
    const from = p.map;
    this.fall(p);
    this.arrive(p, from, 'collapse', now);
  }

  /** Out of energy: home to the spawn with a full bar. (Next milestone: the bag drops where they fell.) */
  private fall(p: Online): void {
    const { id, map, x, y } = p.rec;
    const { spawn } = this.home.data;
    this.place(p, this.home, spawn.x, spawn.y, spawn.dir);
    p.rec.energy = ENERGY_MAX;
    this.onCollapse?.(id, { map, x, y });
  }

  /** Puts a player on a tile of a map. Queued steps go: they were planned on the old map. */
  private place(p: Online, map: TileMap, x: number, y: number, dir: Dir): void {
    this.onMap.get(p.map.data.id)!.delete(p);
    this.onMap.get(map.data.id)!.add(p);
    p.map = map;
    p.rec.map = map.data.id;
    p.rec.x = x;
    p.rec.y = y;
    p.rec.dir = dir;
    p.queue.length = 0;
  }

  /**
   * Tells everyone about a map change that just happened: the old map sees the player leave, the
   * new one sees them join, and the player hears where they are, who is there and their energy.
   */
  private arrive(p: Online, from: TileMap, reason: 'exit' | 'collapse', now: number): void {
    const { id, x, y, dir } = p.rec;
    this.toMap(from, { t: 'leave', id }, id);
    this.toMap(p.map, { t: 'join', player: view(p.rec) }, id);
    this.outbox.push({ to: id, msg: { t: 'zone', map: mapRef(p.map), x, y, dir, players: this.views(p.map.data.id), reason } });
    p.rate = energyRate(p.map, x, y, this.sky);
    this.tell(p, now);
  }

  /**
   * A new rate for where the player stands now. They hear it when it turns from draining to
   * refilling or back, or moves far from the rate they last heard; small changes wait for tick().
   */
  private rerate(p: Online, now: number): void {
    p.rate = energyRate(p.map, p.rec.x, p.rec.y, this.sky);
    const turned = (p.rate < 0) !== (p.heardRate < 0);
    const moved = Math.abs(p.rate - p.heardRate) > ENERGY_RATE_CHANGE * Math.abs(p.heardRate);
    if (turned || moved) this.tell(p, now);
  }

  /** Brings the player's energy up to `now` at their current rate, and returns it. */
  private advance(p: Online, now: number): number {
    if (now > p.energyAt) {
      p.rec.energy = Math.min(ENERGY_MAX, Math.max(0, p.rec.energy + (p.rate * (now - p.energyAt)) / 1000));
      p.energyAt = now;
    }
    return p.rec.energy;
  }

  /** Sends the player their energy; call advance() first so the value is current. */
  private tell(p: Online, now: number): void {
    p.heardRate = p.rate;
    p.heardAt = now;
    this.outbox.push({ to: p.rec.id, msg: { t: 'energy', energy: energyView(p) } });
  }

  private toMap(map: TileMap, msg: ServerMsg, except: string): void {
    this.outbox.push({ to: '*', map: map.data.id, except, msg });
  }
}

function toSpawn(r: PlayerRecord, map: TileMap): void {
  const { spawn } = map.data;
  r.x = spawn.x;
  r.y = spawn.y;
  r.dir = spawn.dir;
}
