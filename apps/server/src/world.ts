/**
 * The game rules for the players who are online. No I/O, no clock and no dice of its own: every call
 * that depends on time gets `now` (ms), randomness comes from `rng`, everything the players should
 * hear is queued as Outgoing messages for the network layer to drain and send, and what storage must
 * hear at once (piles) is queued for it the same way (takeWrites).
 *
 * The world is several maps joined by exits (a house's door is one, into the house); players see
 * and hear only the players on their own map. Everyone online has energy, which drains in the wilds,
 * holds in town and inside buildings, and only comes back next to a fireplace (the rules and numbers
 * are in shared/energy.ts). At zero a player collapses and wakes up at home.
 *
 * Finds lie on the maps for everyone: whoever picks one up first gets it, and a new one of the same
 * rule grows a while later on another tile that fits the rule. What a player picks up goes in their
 * bag. When they collapse, the bag falls out as a pile where they fell (one per player): its owner
 * gets it all back, anyone else a random half (the rest is lost), and it fades an hour after the
 * collapse. The rules for items and bags are in shared/items.ts.
 */
import {
  BAG_SLOTS,
  DROP_LIFETIME_MS,
  ENERGY_MAX,
  ENERGY_SYNC_MS,
  STEP_MS,
  addAllToBag,
  addToBag,
  energyRate,
  findTiles,
  halfOf,
  itemIndex,
  merge,
  stepTarget,
  takeFromBag,
  type Arrival,
  type BagSlot,
  type Dir,
  type DropView,
  type EnergyView,
  type FindView,
  type ItemDef,
  type ItemsData,
  type MapRef,
  type PlayerView,
  type Refusal,
  type ServerMsg,
  type TileMap,
  type Weather,
} from '@napoland/shared';
import type { DropRecord, PlayerRecord } from './storage';

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

/** What a player who joins is told in the welcome: where they are, who and what is there, their energy and bag. */
export interface Joined {
  player: PlayerView;
  map: MapRef;
  /** Everyone on the player's map, the player included. */
  players: PlayerView[];
  /** What lies on the player's map to pick up. */
  finds: FindView[];
  drops: DropView[];
  energy: EnergyView;
  bag: BagSlot[];
}

/** What storage must hear: piles to write (or remove: undefined), and players to save now. */
export interface Writes {
  drops: Array<{ owner: string; drop: DropRecord | undefined }>;
  /** Players whose bag changed along with a pile, as they are now: saved with it, so a crash cannot leave items in both. */
  players: PlayerRecord[];
}

export interface WorldOptions {
  /** Time to walk one tile. */
  stepMs?: number;
  /** Hears about every collapse, with where the player fell (for the log). */
  onCollapse?: (id: string, where: { map: string; x: number; y: number }) => void;
  /** Items and where finds grow (content/items.json, checked with validateItems); none if unset. */
  items?: ItemsData;
  /** Where finds grow, when and which half of a pile someone else gets. Math.random unless a test sets its own. */
  rng?: () => number;
  /** Piles saved before a restart; they lie where they were until they fade. */
  drops?: DropRecord[];
  /**
   * Add to `now` for ms since the epoch. Piles fade by the wall clock, which clients and the database
   * see, while `now` is game time, which must never go backwards. 0 (the default): `now` is the wall clock.
   */
  epochOffset?: number;
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

/** A find rule of items.json, ready to use. */
interface Rule {
  item: ItemDef;
  map: TileMap;
  /** Every tile its finds may grow on (findTiles), as y * width + x. */
  tiles: number[];
  count: number;
  /** Seconds, shortest and longest. */
  respawn: [number, number];
}

interface Find {
  id: number;
  rule: Rule;
  /** y * width + x on the rule's map. */
  tile: number;
}

/** A find that grows at `at`, on another tile than `not` (where the last one was taken) if it can. */
interface Growing {
  rule: Rule;
  at: number;
  not: number | undefined;
}

const view = (r: PlayerRecord): PlayerView => ({ id: r.id, name: r.name, x: r.x, y: r.y, dir: r.dir, color: r.color });
const mapRef = (m: TileMap): MapRef => ({ id: m.data.id, version: m.data.version });
const energyView = (p: Online): EnergyView => ({
  value: Math.round(p.rec.energy * 10) / 10,
  max: ENERGY_MAX,
  rate: Math.round(p.rate * 1000) / 1000,
});
/** Draining and not empty yet, or refilling and not full yet. Holding (rate 0) changes nothing. */
const changing = (p: Online): boolean => (p.rate < 0 && p.rec.energy > 0) || (p.rate > 0 && p.rec.energy < ENERGY_MAX);
const findView = (f: Find): FindView => ({ id: f.id, item: f.rule.item.id, x: f.tile % f.rule.map.width, y: Math.floor(f.tile / f.rule.map.width) });
const dropView = (d: DropRecord): DropView => ({ id: d.owner, x: d.x, y: d.y, owner: d.owner, name: d.name, until: d.droppedAt + DROP_LIFETIME_MS });
const copyBag = (bag: readonly BagSlot[]): BagSlot[] => bag.map(s => ({ item: s.item, count: s.count }));
const copyRecord = (r: PlayerRecord): PlayerRecord => ({ ...r, bag: copyBag(r.bag) });
/** A bag slot as the server writes them; saved data is checked with this before it is trusted. */
const isSlot = (s: unknown): s is BagSlot => {
  const { item, count } = (typeof s === 'object' && s !== null ? s : {}) as Partial<BagSlot>;
  return typeof item === 'string' && Number.isInteger(count) && count! > 0;
};

export class World {
  readonly stepMs: number;
  /** Where new players start and collapsed players wake up. */
  readonly home: TileMap;
  /** The version of the items (content/items.json): a client with another one reloads. */
  readonly itemsVersion: number;
  private readonly maps = new Map<string, TileMap>();
  private readonly players = new Map<string, Online>();
  /** Who is on each map, by map id. */
  private readonly onMap = new Map<string, Set<Online>>();
  /** readyAt of players who left mid-step, so leaving and joining again cannot skip the wait. */
  private readonly resting = new Map<string, number>();
  private outbox: Outgoing[] = [];
  private sky: Weather;
  private readonly onCollapse: WorldOptions['onCollapse'];
  private readonly items: Map<string, ItemDef>;
  private readonly rng: () => number;
  private readonly epochOffset: number;
  private readonly rules: Rule[] = [];
  /** The finds lying on each map, by map id and tile: never two on one tile. */
  private readonly finds = new Map<string, Map<number, Find>>();
  private growing: Growing[] = [];
  /** The earliest time in `growing`, so tick() only looks through it when something is due. */
  private growAt = Infinity;
  private nextFindId = 1;
  /** Piles by owner: each player has at most one. */
  private readonly piles = new Map<string, DropRecord>();
  /** The same piles by map id and tile (several players may fall on one tile). */
  private readonly pileTiles = new Map<string, Map<number, DropRecord[]>>();
  /** The game time when the next pile fades (or later), so tick() only looks when one is due. */
  private fadeAt = Infinity;
  private readonly pileWrites = new Map<string, DropRecord | undefined>();
  /** By id: the record itself, which stays whole after a player leaves (their collapse on the way out counts too). */
  private readonly saveNow = new Map<string, PlayerRecord>();

  /** `maps` must fit together (validateWorld) and `items` must fit the maps (validateItems); `homeId` is a town. */
  constructor(maps: Iterable<TileMap>, homeId: string, weather: Weather, options: WorldOptions = {}) {
    for (const m of maps) {
      if (this.maps.has(m.data.id)) throw new Error(`two maps have the id ${m.data.id}`);
      this.maps.set(m.data.id, m);
      this.onMap.set(m.data.id, new Set());
      this.finds.set(m.data.id, new Map());
      this.pileTiles.set(m.data.id, new Map());
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
    this.rng = options.rng ?? Math.random;
    this.epochOffset = options.epochOffset ?? 0;

    const items = options.items ?? { version: 0, items: [], finds: [] };
    this.items = itemIndex(items);
    this.itemsVersion = items.version;
    for (const f of items.finds) {
      // loadItems checks this and more (validateItems).
      const map = this.maps.get(f.map);
      if (!map) throw new Error(`a find rule grows ${f.item} on map ${f.map}, which does not exist`);
      const item = this.items.get(f.item);
      if (!item) throw new Error(`a find rule on map ${f.map} grows ${f.item}, which is not an item`);
      const tiles = findTiles(map, f).map(t => t.y * map.width + t.x);
      this.rules.push({ item, map, tiles, count: f.count, respawn: f.respawn });
    }
    // The piles first: finds never grow on a tile that has one.
    for (const d of options.drops ?? []) this.restore(d);
    for (const rule of this.rules) {
      // No free tile left (other rules took them): it grows as soon as there is one.
      for (let i = 0; i < rule.count; i++) if (!this.put(rule, undefined)) this.later(rule, -Infinity, undefined);
    }
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
    return p && copyRecord(p.rec);
  }

  records(): PlayerRecord[] {
    return [...this.players.values()].map(p => copyRecord(p.rec));
  }

  /** Everyone on a map. */
  views(mapId: string): PlayerView[] {
    return [...(this.onMap.get(mapId) ?? [])].map(p => view(p.rec));
  }

  /** What lies on a map to pick up. */
  findViews(mapId: string): FindView[] {
    return [...(this.finds.get(mapId)?.values() ?? [])].map(findView);
  }

  /** The piles lying on a map. */
  dropViews(mapId: string): DropView[] {
    return [...(this.pileTiles.get(mapId)?.values() ?? [])].flat().map(dropView);
  }

  /** Puts a player in the world, tells everyone on their map and returns what goes in the welcome. */
  join(rec: PlayerRecord, now: number): Joined {
    if (this.players.has(rec.id)) throw new Error(`player ${rec.id} is already online`);
    const r: PlayerRecord = { ...rec, bag: this.fitBag(rec.bag) };
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
    this.toMap(map.data.id, { t: 'join', player }, r.id);
    // The welcome has the energy too; the message after it is what a client listens to from then on.
    this.tell(p, now);
    const here = map.data.id;
    return {
      player, map: mapRef(map), players: this.views(here), finds: this.findViews(here), drops: this.dropViews(here), energy: energyView(p), bag: copyBag(r.bag),
    };
  }

  /** Takes a player out of the world, tells everyone on their map and returns the record to save. */
  leave(id: string, now: number): PlayerRecord | undefined {
    const p = this.players.get(id);
    if (!p) return undefined;
    const from = p.map;
    // Energy that runs out on the way out still counts: the bag drops, and the player wakes up at home next time.
    if (this.advance(p, now) <= 0) this.fall(p, now);
    this.players.delete(id);
    this.onMap.get(p.map.data.id)!.delete(p);
    if (p.readyAt > -Infinity) this.resting.set(id, p.readyAt);
    this.toMap(from.data.id, { t: 'leave', id }, id);
    return copyRecord(p.rec);
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
    this.toMap(p.map.data.id, { t: 'face', id, dir }, id);
  }

  /**
   * Picks up what lies on tile x,y of the player's map: their own tile or one of the four next to it.
   * A pile there comes first, then a find. The player hears what they got and their bag, or why not;
   * everyone on the map hears what went.
   */
  pick(id: string, x: number, y: number, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    // Steps whose time has come first: the player reaches from where they really are.
    this.runQueue(p, now);
    if (this.advance(p, now) <= 0) {
      // Out of energy before reaching for it: the player collapses, far away from it now.
      this.collapse(p, now);
      return this.refuse(p, 'pick', 'too_far');
    }
    if (Math.abs(x - p.rec.x) + Math.abs(y - p.rec.y) > 1) return this.refuse(p, 'pick', 'too_far');
    const pile = this.pileAt(p.map, x, y, id);
    if (pile) return this.pickPile(p, pile);
    const find = p.map.inside(x, y) ? this.finds.get(p.map.data.id)!.get(y * p.map.width + x) : undefined;
    if (find) return this.pickFind(p, find, now);
    this.refuse(p, 'pick', 'gone');
  }

  /** Uses one of what is in bag slot `slot`. Only consumables can be used; a thermos gives energy. */
  use(id: string, slot: number, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    if (this.advance(p, now) <= 0) {
      // Too late: the player collapses, and the bag falls out.
      this.collapse(p, now);
      return this.refuse(p, 'use', 'empty_slot');
    }
    const s = p.rec.bag[slot];
    if (!s) return this.refuse(p, 'use', 'empty_slot');
    const def = this.items.get(s.item);
    if (def?.kind !== 'consumable' || !def.use) return this.refuse(p, 'use', 'not_usable');
    p.rec.bag = takeFromBag(p.rec.bag, slot, 1);
    const energy = def.use.energy ?? 0;
    if (energy) {
      p.rec.energy = Math.min(ENERGY_MAX, Math.max(0, p.rec.energy + energy));
      // The bar jumped: the client counts on from the new value.
      p.rate = energyRate(p.map, p.rec.x, p.rec.y, this.sky);
      this.tell(p, now);
    }
    this.sendBag(p);
    // Something that takes energy could empty the bar.
    if (p.rec.energy <= 0) this.collapse(p, now);
  }

  /** Throws away everything in bag slot `slot`. */
  discard(id: string, slot: number, now: number): void {
    const p = this.players.get(id);
    if (!p) return;
    if (this.advance(p, now) <= 0) {
      // Too late: the player collapses, and the bag falls out.
      this.collapse(p, now);
      return this.refuse(p, 'discard', 'empty_slot');
    }
    if (!p.rec.bag[slot]) return this.refuse(p, 'discard', 'empty_slot');
    p.rec.bag = takeFromBag(p.rec.bag, slot);
    this.sendBag(p);
  }

  /**
   * Brings everyone's energy up to `now` (whoever ran out collapses), starts queued steps whose time
   * has come and repeats the energy of players whose bar is moving; piles whose hour is over fade and
   * finds whose time has come grow. Call it often (every TICK_MS).
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
    this.fadePiles(now);
    this.growFinds(now);
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

  /** What storage must hear since the last call: each pile as it is now (or gone), and players to save now. */
  takeWrites(): Writes {
    const out: Writes = {
      drops: [...this.pileWrites].map(([owner, d]) => ({ owner, drop: d && { ...d, items: copyBag(d.items) } })),
      players: [...this.saveNow.values()].map(copyRecord),
    };
    this.pileWrites.clear();
    this.saveNow.clear();
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
    this.toMap(p.map.data.id, { t: 'step', id, x, y, dir }, id);
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
    this.fall(p, now);
    this.arrive(p, from, 'collapse', now);
  }

  /** Out of energy: what the player carries falls out where they are, and they go home to the spawn with a full bar. */
  private fall(p: Online, now: number): void {
    const { id, map, x, y } = p.rec;
    this.dropBag(p, now);
    const { spawn } = this.home.data;
    this.place(p, this.home, spawn.x, spawn.y, spawn.dir);
    p.rec.energy = ENERGY_MAX;
    this.onCollapse?.(id, { map, x, y });
  }

  /**
   * The player's bag becomes their pile on the tile where they stand, and their old pile is gone:
   * each player has at most one. With nothing in the bag, only the old pile goes.
   */
  private dropBag(p: Online, now: number): void {
    const { id, name, map, x, y, bag } = p.rec;
    const old = this.piles.get(id);
    if (old) this.removePile(old);
    if (!bag.length) return;
    const pile: DropRecord = { owner: id, name, map, x, y, items: merge(bag), droppedAt: Math.floor(now + this.epochOffset) };
    this.addPile(pile);
    this.pileWrites.set(id, pile);
    this.toMap(map, { t: 'drop', drop: dropView(pile) });
    p.rec.bag = [];
    this.sendBag(p);
    this.saveNow.set(id, p.rec);
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
   * new one sees them join, and the player hears where they are, who and what is there, and their energy.
   */
  private arrive(p: Online, from: TileMap, reason: 'exit' | 'collapse', now: number): void {
    const { id, x, y, dir } = p.rec;
    const here = p.map.data.id;
    this.toMap(from.data.id, { t: 'leave', id }, id);
    this.toMap(here, { t: 'join', player: view(p.rec) }, id);
    this.outbox.push({
      to: id,
      msg: { t: 'zone', map: mapRef(p.map), x, y, dir, players: this.views(here), finds: this.findViews(here), drops: this.dropViews(here), reason },
    });
    p.rate = energyRate(p.map, x, y, this.sky);
    this.tell(p, now);
  }

  /**
   * A new rate for where the player stands now. They hear it when it turns between draining,
   * holding and refilling, or moves far from the rate they last heard; small changes wait for tick().
   */
  private rerate(p: Online, now: number): void {
    p.rate = energyRate(p.map, p.rec.x, p.rec.y, this.sky);
    const turned = Math.sign(p.rate) !== Math.sign(p.heardRate);
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

  /**
   * A saved bag as it fits today's items: items that no longer exist are gone, and a bag that no
   * longer fits (a stack size went down) is packed again; whatever does not fit then is lost.
   */
  private fitBag(bag: unknown): BagSlot[] {
    const known = (Array.isArray(bag) ? bag : []).filter((s): s is BagSlot => isSlot(s) && this.items.has(s.item));
    const fine = known.length <= BAG_SLOTS && known.every(s => s.count <= this.items.get(s.item)!.stack);
    return fine ? copyBag(known) : addAllToBag([], known, this.items).bag;
  }

  /** Can one more of `item` go in this bag? */
  private fits(bag: readonly BagSlot[], item: string): boolean {
    const def = this.items.get(item);
    return def !== undefined && addToBag(bag, def, 1).left === 0;
  }

  /** One find, one unit of its item: into the bag if it fits, and a new one grows later somewhere else. */
  private pickFind(p: Online, find: Find, now: number): void {
    const { rule } = find;
    const r = addToBag(p.rec.bag, rule.item, 1);
    if (r.left) return this.refuse(p, 'pick', 'bag_full');
    p.rec.bag = r.bag;
    this.finds.get(rule.map.data.id)!.delete(find.tile);
    const [soonest, latest] = rule.respawn;
    this.later(rule, now + (soonest + this.rng() * (latest - soonest)) * 1000, find.tile);
    this.got(p, [{ item: rule.item.id, count: 1 }], 'find');
    this.toMap(rule.map.data.id, { t: 'findGone', id: find.id });
  }

  /**
   * The owner gets all of their pile that fits in the bag, and the rest stays; anyone else gets a
   * random half as far as it fits, and the rest is lost with the pile. When nothing of the pile would
   * fit, it stays as it is: the half is only drawn once the picker can carry something of it, so
   * asking again and again never draws a better half.
   */
  private pickPile(p: Online, d: DropRecord): void {
    if (!d.items.some(s => this.fits(p.rec.bag, s.item))) return this.refuse(p, 'pick', 'bag_full');
    const mine = d.owner === p.rec.id;
    const offered = mine ? d.items : halfOf(d.items, this.rng);
    const r = addAllToBag(p.rec.bag, offered, this.items);
    p.rec.bag = r.bag;
    this.saveNow.set(p.rec.id, p.rec);
    this.got(p, less(offered, r.left), 'drop');
    if (mine && r.left.length) {
      d.items = merge(r.left);
      this.pileWrites.set(d.owner, d);
      this.toMap(d.map, { t: 'drop', drop: dropView(d) });
    } else {
      this.removePile(d);
    }
  }

  /** The pile on a tile, the picker's own first (that one they get all of). */
  private pileAt(map: TileMap, x: number, y: number, picker: string): DropRecord | undefined {
    if (!map.inside(x, y)) return undefined;
    const here = this.pileTiles.get(map.data.id)!.get(y * map.width + x);
    return here?.find(d => d.owner === picker) ?? here?.[0];
  }

  /** A pile saved before a restart. Items that no longer exist are gone; so is a pile with nothing left or on a map that is gone. */
  private restore(d: DropRecord): void {
    const map = this.maps.get(d.map);
    const items = merge((Array.isArray(d.items) ? d.items : []).filter(s => isSlot(s) && this.items.has(s.item)));
    if (!map || !map.inside(d.x, d.y) || !items.length || this.piles.has(d.owner)) return;
    this.addPile({ ...d, items });
  }

  private addPile(d: DropRecord): void {
    this.piles.set(d.owner, d);
    const tiles = this.pileTiles.get(d.map)!;
    const tile = d.y * this.maps.get(d.map)!.width + d.x;
    const here = tiles.get(tile);
    if (here) here.push(d);
    else tiles.set(tile, [d]);
    this.fadeAt = Math.min(this.fadeAt, d.droppedAt + DROP_LIFETIME_MS - this.epochOffset);
  }

  /** A pile goes (taken, faded or replaced): everyone on its map hears it, and storage forgets it. */
  private removePile(d: DropRecord): void {
    this.piles.delete(d.owner);
    const tiles = this.pileTiles.get(d.map)!;
    const tile = d.y * this.maps.get(d.map)!.width + d.x;
    const rest = tiles.get(tile)!.filter(o => o !== d);
    if (rest.length) tiles.set(tile, rest);
    else tiles.delete(tile);
    this.pileWrites.set(d.owner, undefined);
    this.toMap(d.map, { t: 'dropGone', id: d.owner });
  }

  /** Piles whose hour is over fade. */
  private fadePiles(now: number): void {
    if (now < this.fadeAt) return;
    const wall = now + this.epochOffset;
    for (const d of [...this.piles.values()]) if (wall >= d.droppedAt + DROP_LIFETIME_MS) this.removePile(d);
    this.fadeAt = [...this.piles.values()].reduce((at, d) => Math.min(at, d.droppedAt + DROP_LIFETIME_MS - this.epochOffset), Infinity);
  }

  /** Finds whose time has come grow, and everyone on their map hears it. */
  private growFinds(now: number): void {
    if (now < this.growAt) return;
    const due = this.growing.filter(g => g.at <= now).sort((a, b) => a.at - b.at);
    this.growing = this.growing.filter(g => g.at > now);
    this.growAt = this.growing.reduce((at, g) => Math.min(at, g.at), Infinity);
    for (const g of due) {
      const find = this.put(g.rule, g.not);
      // Every tile it may grow on is taken (by other finds and by piles): it tries again a while later.
      if (!find) this.later(g.rule, now + g.rule.respawn[0] * 1000, g.not);
      else this.toMap(g.rule.map.data.id, { t: 'find', find: findView(find) });
    }
  }

  private later(rule: Rule, at: number, not: number | undefined): void {
    this.growing.push({ rule, at, not });
    this.growAt = Math.min(this.growAt, at);
  }

  /** A find of the rule on a free tile (freeTile); undefined if none is free. Nobody is told here. */
  private put(rule: Rule, not: number | undefined): Find | undefined {
    const tile = this.freeTile(rule, not);
    if (tile === undefined) return undefined;
    const find: Find = { id: this.nextFindId++, rule, tile };
    this.finds.get(rule.map.data.id)!.set(tile, find);
    return find;
  }

  /**
   * A random tile the rule's finds may grow on, with no find and no pile on it. `not` (where the last
   * one was taken) only when no other tile is free, so that a find moves on whenever it can.
   */
  private freeTile(rule: Rule, not: number | undefined): number | undefined {
    const { tiles } = rule;
    const finds = this.finds.get(rule.map.data.id)!;
    const piles = this.pileTiles.get(rule.map.data.id)!;
    const empty = (t: number) => !finds.has(t) && !piles.has(t);
    // Finds are few next to the tiles they may grow on, so a few random tries nearly always hit a free one.
    for (let i = 0; i < 8 && tiles.length; i++) {
      const t = tiles[this.roll(tiles.length)]!;
      if (t !== not && empty(t)) return t;
    }
    const free = tiles.filter(t => t !== not && empty(t));
    if (free.length) return free[this.roll(free.length)];
    return not !== undefined && empty(not) ? not : undefined;
  }

  /** A random whole number from 0 to n - 1. */
  private roll(n: number): number {
    return Math.min(n - 1, Math.floor(this.rng() * n));
  }

  /** Tells the player what they got, then their whole bag. */
  private got(p: Online, items: BagSlot[], from: 'find' | 'drop'): void {
    this.outbox.push({ to: p.rec.id, msg: { t: 'got', items, from } });
    this.sendBag(p);
  }

  private sendBag(p: Online): void {
    this.outbox.push({ to: p.rec.id, msg: { t: 'bag', bag: copyBag(p.rec.bag) } });
  }

  private refuse(p: Online, action: 'pick' | 'use' | 'discard', reason: Refusal): void {
    this.outbox.push({ to: p.rec.id, msg: { t: 'refused', action, reason } });
  }

  /** A message for everyone on a map, but `except`. */
  private toMap(map: string, msg: ServerMsg, except?: string): void {
    this.outbox.push(except === undefined ? { to: '*', map, msg } : { to: '*', map, except, msg });
  }
}

function toSpawn(r: PlayerRecord, map: TileMap): void {
  const { spawn } = map.data;
  r.x = spawn.x;
  r.y = spawn.y;
  r.dir = spawn.dir;
}

/** The units of `all` that are not among `left`, equal items joined. */
function less(all: readonly BagSlot[], left: readonly BagSlot[]): BagSlot[] {
  const rest = new Map(merge(left).map(s => [s.item, s.count]));
  return merge(all).flatMap(s => {
    const n = s.count - (rest.get(s.item) ?? 0);
    return n > 0 ? [{ item: s.item, count: n }] : [];
  });
}
