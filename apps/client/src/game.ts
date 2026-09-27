/**
 * What the player sees and does, kept in sync with the server:
 * - your own steps are predicted (you move the instant you press) and confirmed or corrected by the server;
 * - other players are animated from the steps the server reports;
 * - D-pad: a quick tap on a new direction turns in place, holding walks (like FireRed);
 * - tapping the ground walks there; tapping a person or a sign walks up and talks, tapping a find or a
 *   pile walks onto it and picks it up;
 * - A picks up what lies on your tile or the one you face, else feeds the fire or the Old Stone you
 *   face (with the best you carry for it), reads the notice board, talks to people and reads signs;
 * - finds and piles on your map, fires, marks, creatures and flares, and your bag, are the server's:
 *   it tells us, we show them;
 * - the map can change: walking onto an exit, or collapsing, makes the server move you (`zone`);
 * - energy, wetness, fires and the surge clock are counted forward between the server's reports, so
 *   everything moves smoothly.
 */
import {
  STEP_MS, dirOf, dirToward, energyAfter, findPath, flashHits, inSurge, stepTarget, surgeFront, DIR_VEC,
  type BagSlot, type BodyView, type ClientMsg, type CreatureView, type Dir, type DropView, type EnergyView, type FindView, type FireView, type MapObject,
  type Gear, type MarkView, type Quirk, type Worn, type PlayerView, type ProgressView, type ServerMsg, type Slot, type Stats, type StoneView, type SurgeView, type TileMap,
  type FlashKind, type FlashView, type StormView,
} from '@napoland/shared';
import { countOf, lookOf, refusalText, useText, type Items } from './items';
import type { Maps } from './maps';
import type { Avatar } from './view/world';

interface Mover {
  id: string;
  name: string;
  color: string;
  /** Tile the player stands on or is walking to. */
  tx: number;
  ty: number;
  /** Drawn position (tile units). */
  x: number;
  y: number;
  dir: Dir;
  anim: { fx: number; fy: number; t0: number; dur: number } | null;
  phase: number;
  turnT: number;
}

/**
 * Something you face and press A at: a person or a sign (talk), the notice board (the server writes
 * it), a fire or the Old Stone (you feed them).
 */
export type Talker = { x: number; y: number; who: string; lines: string[]; kind: 'talk' | 'board' | 'fire' | 'stone' | 'chest' | 'bench' };

/** Something lying on a tile to pick up: a pile someone left when they collapsed, or a find. */
export type Thing = { kind: 'drop'; drop: DropView } | { kind: 'find'; find: FindView };

/** What A does now: pick up what lies on tile x,y (a pile or a find), or talk. */
export type Action = { kind: 'pick'; x: number; y: number; what: Thing['kind'] } | { kind: 'talk'; talker: Talker };

/** Where a tap sends us, and what to do there. */
type Goal = { talk: Talker } | { pick: { x: number; y: number } };

/** How long a D-pad direction must be held before a turn becomes a walk. */
const HOLD_TO_WALK_MS = 160;
/** Never run more than this many steps ahead of the server's confirmations. */
const MAX_UNCONFIRMED = 2;
/**
 * How long to stand on an exit waiting for the server to move us before walking is allowed again.
 * The server normally answers within a round trip; this only keeps a lost or refused trip from
 * leaving the player stuck on the exit.
 */
const EXIT_WAIT_MS = 3000;
/**
 * A pick, or a use, waits this long for the server's answer before another may be asked. The answer
 * normally comes within a round trip; asking twice meanwhile would earn a "Someone got there first"
 * for a find we took ourselves.
 */
const ANSWER_WAIT_MS = 2500;
/**
 * The server empties your bag in the same moment it sends you home, so when you collapse the empty
 * bag arrives just before the zone or just after it. A bag emptied this recently still counts as
 * carried then.
 */
const JUST_NOW_MS = 1000;
/** Piles show whose they are while you are this close (tiles, center to center). */
export const PILE_TAG_TILES = 3.5;
/** Float colors: something gained, energy back, a gentle no, nothing there. */
const GAIN = '#ffe3a1';
const ENERGY = '#ffcf5a';
const NO = '#ffae98';
const GREY = '#c9c2b0';
const FIRE = '#ffb36b';
const EERIE = '#c7a6ff';
/** How long a watcher takes to walk a tile, as drawn (the server moves them a little slower than this). */
const CREATURE_STEP_MS = 420;

function talkersOf(map: TileMap): Talker[] {
  return map.data.objects.flatMap((o: MapObject): Talker[] => {
    if (o.kind === 'npc') return [{ x: o.x, y: o.y, who: o.name, lines: o.lines, kind: 'talk' }];
    if (o.kind === 'sign') return [{ x: o.x, y: o.y, who: 'Sign', lines: o.text, kind: 'talk' }];
    if (o.kind === 'board') return [{ x: o.x, y: o.y, who: 'Notice board', lines: [], kind: 'board' }];
    if (o.kind === 'fireplace') return [{ x: o.x, y: o.y, who: 'Fire', lines: [], kind: 'fire' }];
    if (o.kind === 'stone') return [{ x: o.x, y: o.y, who: 'The Old Stone', lines: [], kind: 'stone' }];
    if (o.kind === 'chest') return [{ x: o.x, y: o.y, who: 'Your stash', lines: [], kind: 'chest' }];
    if (o.kind === 'workbench') return [{ x: o.x, y: o.y, who: 'Workbench', lines: [], kind: 'bench' }];
    return [];
  });
}

/** "12 minutes", "under a minute". */
export function minutes(seconds: number): string {
  if (seconds < 60) return 'under a minute';
  const m = Math.round(seconds / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
}

/** News from the world for the interface to announce (status.ts, newsBanner). */
export type News =
  | { kind: 'feat'; id: string } | { kind: 'surge'; view: SurgeView } | { kind: 'storm'; view: StormView } | { kind: 'stone'; view: StoneView } | { kind: 'level'; progress: ProgressView };

export class Game {
  meId: string | null = null;
  /** True between the server's welcome and the connection dropping; no steps are taken otherwise. */
  online = false;
  /** Set while the screen fades out on the way to another map: nobody walks on a map that is going away. */
  held = false;
  players = new Map<string, Mover>();
  stepMs = STEP_MS;
  marker: { x: number; y: number; t: number } | null = null;
  dialog: { who: string; lines: string[]; i: number; shown: number } | null = null;
  /** Words rising over a tile; `row` stacks several said at once (0 at the bottom). */
  floats: Array<{ id: number; text: string; color: string; x: number; y: number; t: number; row: number }> = [];
  /** What lies on this map to pick up, by id. */
  finds = new Map<number, FindView>();
  /** Piles on this map, by id (the owner's id: each player leaves at most one). */
  drops = new Map<string, DropView>();
  /** Counts every change to finds and piles, so the view rebuilds them only when something changed. */
  lootChanges = 0;
  /** Your bag as the server last told it; replaced whole, never changed in place. */
  bag: BagSlot[] = [];
  /** The fires on this map by "x,y": fuel left as told, and when (null: tended, it never goes out). */
  fires = new Map<string, { left: number | null; at: number }>();
  /** Marks painted on this map, by id; `markChanges` counts changes, like lootChanges. */
  marks = new Map<number, MarkView>();
  markChanges = 0;
  /** Creatures on this map (watchers), animated like players. */
  creatures = new Map<number, Mover>();
  /** Flares burning on this map, until when (our clock). */
  flares: Array<{ x: number; y: number; until: number }> = [];
  /** This map's surge clock as told, and when (null: it never surges). */
  surge: { view: SurgeView; at: number } | null = null;
  /** This map's storm clock as told, and when (null: it never storms). */
  storm: { view: StormView; at: number } | null = null;
  /** Flashes on this map, until when they are over (our clock). */
  flashes: Array<{ x: number; y: number; kind: FlashKind; until: number }> = [];
  /** How wet you are, your load and whether something clings to you, as told and when. */
  body: { view: BodyView; at: number } = { view: { wet: 0, wetRate: 0, load: 0, hitched: false, worn: {} }, at: 0 };
  /** The Old Stone in town, and your counts toward feats. */
  stone: StoneView = { charge: 0, need: 0, awake: false, left: 0 };
  stats: Stats = {};
  /** Your tools (item ids), as the welcome said: a paper map, for now. */
  tools: string[] = [];
  /** Your XP and level. */
  progress: ProgressView = { xp: 0, level: 1, from: 0, to: null, maxEnergy: 100 };
  /** The chest you opened (its tile) and what your stash holds, while it is open; null otherwise. */
  chest: { x: number; y: number; stash: BagSlot[] } | null = null;
  /** The workbench you opened and what your stash holds, while it is open. */
  bench: { x: number; y: number; stash: BagSlot[] } | null = null;
  /** The quirks of what everyone on this map wears, by player id: some show in the world. */
  quirks = new Map<string, Quirk[]>();
  /** What everyone on this map wears, by player id (you too). */
  gear = new Map<string, Gear>();
  /** Feats just earned, for the interface to announce (it empties the list). */
  news: News[] = [];
  private fid = 0;
  private seq = 0;
  private pending: Array<{ seq: number; x: number; y: number }> = [];
  private path: Array<{ x: number; y: number }> = [];
  private goal: Goal | null = null;
  private pad = { dir: null as Dir | null, changedAt: 0, facingAtPress: false };
  private justStepped = false;
  /** When we started standing on an exit tile (null when not on one). */
  private exitSince: number | null = null;
  private current: TileMap;
  private talkers: Talker[];
  /** The server's last energy report and when it arrived. */
  private lastEnergy: { view: EnergyView; at: number } | null = null;
  /** The time of the latest update or message: when things were asked. */
  private clock = 0;
  /** A pick asked for and not answered yet. */
  private picking: { at: number } | null = null;
  /** A use asked for: the item and how many the bag held, to tell when it went through. */
  private using: { item: string; had: number; at: number } | null = null;
  /** A fire fed and not answered yet, to say how it took it. */
  private feeding: { x: number; y: number; at: number } | null = null;
  /** A chest asked to open and not answered yet. */
  private opening: { x: number; y: number; at: number } | null = null;
  /** A workbench asked to open and not answered yet. */
  private benching: { x: number; y: number; at: number } | null = null;
  /** When the server last emptied a bag that held something. */
  private emptiedAt = -Infinity;

  constructor(private readonly maps: Maps, private readonly send: (msg: ClientMsg) => void, readonly items: Items) {
    this.current = maps.home();
    this.talkers = talkersOf(this.current);
  }

  /** The map we are on: the one the server's welcome or latest zone named. */
  get map(): TileMap {
    return this.current;
  }

  get me(): Mover | undefined {
    return this.meId ? this.players.get(this.meId) : undefined;
  }

  /** Energy right now: the server's last report counted forward at its rate. Null until the first report. */
  energy(now: number): EnergyView | null {
    const e = this.lastEnergy;
    if (!e) return null;
    return { value: energyAfter(e.view, Math.max(0, now - e.at) / 1000), max: e.view.max, rate: e.view.rate };
  }

  /** Your body right now: wetness counted forward at its rate. */
  bodyNow(now: number): BodyView {
    const b = this.body.view;
    if (!this.online) return b;
    return { ...b, wet: Math.min(1, Math.max(0, b.wet + (b.wetRate * Math.max(0, now - this.body.at)) / 1000)) };
  }

  /** Seconds of fuel the fire on tile x,y has left now; null for a tended fire, undefined where there is none. */
  fireLeft(x: number, y: number, now: number): number | null | undefined {
    const f = this.fires.get(`${x},${y}`);
    if (!f) return undefined;
    return f.left === null ? null : Math.max(0, f.left - Math.max(0, now - f.at) / 1000);
  }

  /** The surge clock right now, counted on from the last report (it stays at 0 left until the next phase is told). */
  surgeNow(now: number): SurgeView | null {
    const s = this.surge;
    if (!s) return null;
    const dt = Math.max(0, now - s.at) / 1000;
    return { phase: s.view.phase, left: Math.max(0, s.view.left - dt), into: s.view.into + dt };
  }

  /** Is the surge's front over the tile you stand on (and no street light shelters you)? */
  caught(now: number): boolean {
    const me = this.me, rule = this.current.data.surge, s = this.surgeNow(now);
    if (!me || !rule || !s) return false;
    return inSurge(this.current, me.tx, me.ty, surgeFront(rule, this.current.deepest, s));
  }

  /** The storm clock right now, counted on from the last report. */
  stormNow(now: number): StormView | null {
    const s = this.storm;
    return s && { phase: s.view.phase, left: Math.max(0, s.view.left - Math.max(0, now - s.at) / 1000) };
  }

  /** Flashes not over yet. */
  flashesNow(now: number): FlashView[] {
    return this.flashes.filter(f => f.until > now).map(f => ({ x: f.x, y: f.y, kind: f.kind, left: (f.until - now) / 1000 }));
  }

  /** The kind of flash discharging on the tile you stand on, or null. */
  flashed(now: number): FlashKind | null {
    const me = this.me;
    return (me && this.flashesNow(now).find(f => flashHits(f, me.tx, me.ty))?.kind) ?? null;
  }

  /** Flares still burning. */
  flaresNow(now: number): Array<{ x: number; y: number; left: number }> {
    return this.flares.filter(f => f.until > now).map(f => ({ x: f.x, y: f.y, left: (f.until - now) / 1000 }));
  }

  // ---------- messages from the server ----------

  handle(msg: ServerMsg, now: number) {
    this.clock = now;
    switch (msg.t) {
      case 'welcome': {
        const map = this.maps.get(msg.map);
        // A map we do not have, or other items than the server's: this client is out of date and
        // about to reload, so it must not play.
        if (!map || msg.items !== this.items.version) { this.disconnected(now); break; }
        this.meId = msg.you;
        this.online = true;
        this.stepMs = msg.stepMs;
        this.enter(map, msg.players, msg.finds, msg.drops);
        this.scene(msg, now);
        this.bag = msg.bag;
        this.lastEnergy = { view: msg.energy, at: now };
        this.body = { view: msg.body, at: now };
        this.stone = msg.stone;
        this.stats = msg.stats;
        this.progress = msg.progress;
        this.tools = msg.tools;
        break;
      }
      case 'zone': {
        const map = this.maps.get(msg.map);
        if (!map) { this.disconnected(now); break; }
        const old = this.me;
        this.enter(map, msg.players, msg.finds, msg.drops);
        this.scene(msg, now);
        this.stats = msg.stats;
        this.dialog = null; this.marker = null; this.floats = [];
        // Where the server put us wins over the list, and we stay ourselves even if the list left us out.
        const me = this.me ?? (old ? { ...old } : undefined);
        if (me) {
          me.tx = me.x = msg.x; me.ty = me.y = msg.y; me.dir = msg.dir; me.anim = null; me.turnT = 0;
          this.players.set(me.id, me);
        }
        break;
      }
      case 'energy':
        this.lastEnergy = { view: msg.energy, at: now };
        this.body = { view: msg.body, at: now };
        break;
      case 'fire': {
        this.fires.set(`${msg.fire.x},${msg.fire.y}`, { left: msg.fire.left, at: now });
        const f = this.feeding;
        if (f && f.x === msg.fire.x && f.y === msg.fire.y && now - f.at < ANSWER_WAIT_MS) {
          this.feeding = null;
          this.floatOverMe(msg.fire.left === null ? 'It burns on its own' : `It burns ${minutes(msg.fire.left)}`, FIRE);
        }
        break;
      }
      case 'mark':
        this.marks.set(msg.mark.id, msg.mark);
        this.markChanges++;
        break;
      case 'markGone':
        if (this.marks.delete(msg.id)) this.markChanges++;
        break;
      case 'creature': {
        const c = this.creatures.get(msg.creature.id);
        if (!c) this.creatures.set(msg.creature.id, this.creatureMover(msg.creature));
        // One that jumped (it woke somewhere else) is put there at once; a step is walked.
        else if (Math.abs(c.tx - msg.creature.x) + Math.abs(c.ty - msg.creature.y) > 1) this.snapMover(c, msg.creature);
        else {
          c.anim = { fx: c.x, fy: c.y, t0: now, dur: CREATURE_STEP_MS };
          c.tx = msg.creature.x; c.ty = msg.creature.y; c.dir = msg.creature.dir;
        }
        break;
      }
      case 'creatureGone':
        this.creatures.delete(msg.id);
        break;
      case 'touched': {
        const lost = msg.lost && this.items.get(msg.lost).name;
        this.floatOverMe(lost ? `It took your ${lost.toLowerCase()}` : 'It touched you', EERIE, 1);
        this.floatOverMe('The cold goes right through you', NO);
        break;
      }
      case 'hitch':
        this.floatOverMe(msg.on ? 'Something clings to you. Find a light' : 'It let go of you', msg.on ? EERIE : GAIN);
        break;
      case 'flare':
        this.flares.push({ x: msg.flare.x, y: msg.flare.y, until: now + msg.flare.left * 1000 });
        break;
      case 'surge':
        this.surge = { view: msg.surge, at: now };
        this.news.push({ kind: 'surge', view: msg.surge });
        break;
      case 'storm':
        this.storm = { view: msg.storm, at: now };
        this.news.push({ kind: 'storm', view: msg.storm });
        break;
      case 'flash':
        this.flashes.push({ x: msg.flash.x, y: msg.flash.y, kind: msg.flash.kind, until: now + msg.flash.left * 1000 });
        break;
      case 'stone':
        if (msg.stone.awake !== this.stone.awake) this.news.push({ kind: 'stone', view: msg.stone });
        this.stone = msg.stone;
        break;
      case 'board':
        this.openDialog({ x: 0, y: 0, who: 'Notice board', lines: msg.lines, kind: 'board' });
        break;
      case 'feat':
        this.stats = msg.stats;
        this.news.push({ kind: 'feat', id: msg.id });
        break;
      case 'chest': {
        // The answer to opening one, or news of the one already open.
        const o = this.opening;
        if (o && this.clock - o.at < ANSWER_WAIT_MS) { this.chest = { x: o.x, y: o.y, stash: msg.stash }; this.opening = null; }
        else if (this.chest) this.chest = { ...this.chest, stash: msg.stash };
        break;
      }
      case 'gear':
        this.gear.set(msg.id, msg.gear);
        this.quirks.set(msg.id, msg.quirks);
        break;
      case 'mended':
        this.floatOverMe(`Mended: ${this.items.get(msg.item).name}`, GAIN);
        break;
      case 'bench': {
        const b = this.benching;
        if (b && this.clock - b.at < ANSWER_WAIT_MS) { this.bench = { x: b.x, y: b.y, stash: msg.stash }; this.benching = null; }
        else if (this.bench) this.bench = { ...this.bench, stash: msg.stash };
        break;
      }
      case 'crafted':
        this.floatOverMe(`Made: ${this.items.get(msg.item).name}`, GAIN);
        break;
      case 'progress':
        if (msg.gained > 0) this.floatOverMe(`+${msg.gained} XP`, GAIN);
        if (msg.progress.level > this.progress.level) this.news.push({ kind: 'level', progress: msg.progress });
        this.progress = msg.progress;
        break;
      case 'join':
        this.players.set(msg.player.id, this.mover(msg.player));
        this.gear.set(msg.player.id, msg.player.gear ?? {});
        this.quirks.set(msg.player.id, msg.player.quirks ?? []);
        break;
      case 'leave':
        this.players.delete(msg.id);
        break;
      case 'step': {
        const p = this.players.get(msg.id);
        if (!p) break;
        if (msg.id === this.meId) {
          // Our own step, confirmed. If the server put us somewhere else, trust the server.
          const i = this.pending.findIndex(s => s.seq === msg.seq);
          const predicted = this.pending[i];
          if (i >= 0) this.pending.splice(0, i + 1);
          if (!predicted || predicted.x !== msg.x || predicted.y !== msg.y) this.snap(p, msg.x, msg.y, msg.dir);
          break;
        }
        this.walk(p, msg.x, msg.y, msg.dir, now);
        break;
      }
      case 'face': {
        const p = this.players.get(msg.id);
        if (p && msg.id !== this.meId) { p.dir = msg.dir; p.turnT = 0.14; }
        break;
      }
      case 'reject': {
        const p = this.me;
        if (p) this.snap(p, msg.x, msg.y, msg.dir);
        break;
      }
      case 'find':
        this.finds.set(msg.find.id, msg.find);
        this.lootChanges++;
        break;
      case 'findGone':
        if (this.finds.delete(msg.id)) this.lootChanges++;
        break;
      case 'drop':
        // A new collapse replaces the owner's old pile: same id.
        this.drops.set(msg.drop.id, msg.drop);
        this.lootChanges++;
        break;
      case 'dropGone':
        if (this.drops.delete(msg.id)) this.lootChanges++;
        break;
      case 'bag': {
        // A use went through when the bag holds one fewer of it. One never answered is forgotten, so
        // it cannot take a later change for its answer.
        const u = this.using;
        if (u && now - u.at >= ANSWER_WAIT_MS) this.using = null;
        else if (u && countOf(msg.bag, u.item) < u.had) {
          this.using = null;
          this.floatOverMe(useText(this.items.get(u.item)), ENERGY);
        }
        if (this.bag.length && !msg.bag.length) this.emptiedAt = now;
        this.bag = msg.bag;
        break;
      }
      case 'got': {
        this.picking = null;
        // A column over your head, in the order the server listed them, first on top.
        msg.items.forEach((s, i) => this.floatOverMe(`+${s.count} ${this.items.get(s.item).name}`, GAIN, msg.items.length - 1 - i));
        // Someone else's pile can leave you nothing (your half did not fit, or the coin went the
        // other way); it is gone all the same, so say so rather than let it vanish silently.
        if (!msg.items.length) this.floatOverMe('Nothing in it for you', NO);
        break;
      }
      case 'refused':
        if (msg.action === 'pick') this.picking = null;
        if (msg.action === 'use') this.using = null;
        if (msg.action === 'feed') this.feeding = null;
        this.floatOverMe(refusalText(msg.reason), NO);
        break;
      default:
        break;
    }
  }

  /** The connection dropped: stop predicting until the next welcome puts us back in sync. */
  disconnected(now: number) {
    this.online = false;
    this.pending = []; this.path = []; this.goal = null;
    // Answers to what we asked went with the connection.
    this.picking = null; this.using = null; this.feeding = null; this.opening = null; this.chest = null; this.benching = null; this.bench = null;
    // Nobody tells us how energy changes while we are away, so the bar holds still until the next welcome.
    const e = this.energy(now);
    if (e) this.lastEnergy = { view: { ...e, rate: 0 }, at: now };
  }

  /**
   * Arrive on a map: its players, finds and piles replace the old ones, and plans made for the old
   * map are dropped.
   */
  private enter(map: TileMap, players: PlayerView[], finds: FindView[], drops: DropView[]) {
    if (map !== this.current) {
      this.current = map;
      this.talkers = talkersOf(map);
      this.chest = null; this.opening = null; this.bench = null; this.benching = null;
      this.dialog = null; this.marker = null; this.floats = [];
    }
    this.players.clear();
    for (const p of players) this.players.set(p.id, this.mover(p));
    this.gear = new Map(players.map(p => [p.id, p.gear ?? {}]));
    this.quirks = new Map(players.map(p => [p.id, p.quirks ?? []]));
    this.finds = new Map(finds.map(f => [f.id, f]));
    this.drops = new Map(drops.map(d => [d.id, d]));
    this.lootChanges++;
    this.pending = []; this.path = []; this.goal = null; this.justStepped = false; this.exitSince = null;
    this.picking = null;
  }

  private mover(p: PlayerView): Mover {
    return { id: p.id, name: p.name, color: p.color, tx: p.x, ty: p.y, x: p.x, y: p.y, dir: p.dir, anim: null, phase: 0, turnT: 0 };
  }

  private creatureMover(c: CreatureView): Mover {
    return { id: String(c.id), name: '', color: '', tx: c.x, ty: c.y, x: c.x, y: c.y, dir: c.dir, anim: null, phase: 0, turnT: 0 };
  }

  private snapMover(m: Mover, c: CreatureView) {
    m.tx = m.x = c.x; m.ty = m.y = c.y; m.dir = c.dir; m.anim = null;
  }

  /** The fires, marks, creatures, flares, flashes, and surge and storm clocks of the map a welcome or zone put us on. */
  private scene(
    msg: { fires: FireView[]; marks: MarkView[]; creatures: CreatureView[]; flares: Array<{ x: number; y: number; left: number }>; flashes: FlashView[]; surge: SurgeView | null; storm: StormView | null },
    now: number,
  ) {
    this.fires = new Map(msg.fires.map(f => [`${f.x},${f.y}`, { left: f.left, at: now }]));
    this.marks = new Map(msg.marks.map(m => [m.id, m]));
    this.markChanges++;
    this.creatures = new Map(msg.creatures.map(c => [c.id, this.creatureMover(c)]));
    this.flares = msg.flares.map(f => ({ x: f.x, y: f.y, until: now + f.left * 1000 }));
    this.surge = msg.surge && { view: msg.surge, at: now };
    this.storm = msg.storm && { view: msg.storm, at: now };
    this.flashes = msg.flashes.map(f => ({ x: f.x, y: f.y, kind: f.kind, until: now + f.left * 1000 }));
  }

  private walk(p: Mover, x: number, y: number, dir: Dir, now: number) {
    // Start from where the player is drawn now, so a late message does not make them jump.
    p.anim = { fx: p.x, fy: p.y, t0: now, dur: this.stepMs };
    p.tx = x; p.ty = y; p.dir = dir;
  }

  private snap(p: Mover, x: number, y: number, dir: Dir) {
    p.tx = p.x = x; p.ty = p.y = y; p.dir = dir; p.anim = null;
    this.pending = []; this.path = []; this.goal = null;
  }

  // ---------- input ----------

  padChange(dir: Dir | null, now: number) {
    if (dir === this.pad.dir) return;
    this.pad.dir = dir;
    this.pad.changedAt = now;
    this.pad.facingAtPress = !!dir && this.me?.dir === dir;
    if (dir && this.dialog) this.advanceDialog();
  }

  pressA() {
    if (this.dialog) return this.advanceDialog();
    const me = this.me;
    if (!me || me.anim) return;
    const act = this.action();
    if (!act) this.float('Nothing here', GREY, me.tx, me.ty);
    else if (act.kind === 'talk') this.meet(act.talker);
    else this.pick(act.x, act.y);
  }

  /** What A does at someone or something you face: talk, read the board, feed a fire or the Old Stone. */
  private meet(t: Talker) {
    if (t.kind === 'talk') return this.openDialog(t);
    if (t.kind === 'board') {
      if (this.online) this.send({ t: 'board', x: t.x, y: t.y });
      return;
    }
    if (t.kind === 'fire') return this.tend(t.x, t.y);
    if (t.kind === 'chest') {
      if (!this.online) return;
      this.opening = { x: t.x, y: t.y, at: this.clock };
      this.send({ t: 'chest', x: t.x, y: t.y });
      return;
    }
    if (t.kind === 'bench') {
      if (!this.online) return;
      this.benching = { x: t.x, y: t.y, at: this.clock };
      this.send({ t: 'bench', x: t.x, y: t.y });
      return;
    }
    return this.offer(t.x, t.y);
  }

  /** Put bag slot `slot` (or everything, left out) into the open chest. */
  store(slot?: number) {
    const c = this.chest;
    if (!c || !this.online) return;
    this.send(slot === undefined ? { t: 'store', x: c.x, y: c.y } : { t: 'store', x: c.x, y: c.y, slot });
  }

  /** Take a stack of an item out of the open chest (as much as fits the server decides). */
  take(item: string) {
    const c = this.chest;
    if (!c || !this.online) return;
    this.send({ t: 'take', x: c.x, y: c.y, item, count: this.items.get(item).stack });
  }

  /** Close the chest (the panel went away). */
  closeChest() {
    this.chest = null;
  }

  /** At the open chest: put on a piece of gear from the stash, or take off what a slot wears. */
  /** Puts on the `n`th piece of `item` in the stash (their order in the chest). */
  equip(item: string, n = 0) {
    const c = this.chest;
    if (c && this.online) this.send({ t: 'equip', x: c.x, y: c.y, item, ...(n ? { n } : {}) });
  }

  /** Mends what you wear in `slot`, at the open workbench. */
  mend(slot: Slot) {
    const b = this.bench;
    if (b && this.online) this.send({ t: 'mend', x: b.x, y: b.y, slot });
  }

  unequip(slot: Slot) {
    const c = this.chest;
    if (c && this.online) this.send({ t: 'unequip', x: c.x, y: c.y, slot });
  }

  /** At the open workbench: make a recipe. */
  craft(recipe: string) {
    const b = this.bench;
    if (b && this.online) this.send({ t: 'craft', x: b.x, y: b.y, recipe });
  }

  closeBench() {
    this.bench = null;
  }

  /** What you wear. */
  get myGear(): Gear {
    return (this.meId && this.gear.get(this.meId)) || {};
  }

  /** What you wear, piece by piece (condition and quirk), as the server last told it. */
  get myWorn(): Worn {
    return this.body.view.worn ?? {};
  }

  /**
   * Feeds the fire on tile x,y with what burns longest of what you carry; with nothing to burn, says
   * how long it has left. A tended fire needs nothing.
   */
  private tend(x: number, y: number) {
    const left = this.fireLeft(x, y, this.clock);
    if (left === null) return this.floatOverMe('Someone keeps this fire going', GREY);
    const slot = this.bestSlot(def => def.fuel ?? 0);
    if (slot < 0) return this.floatOverMe(left ? `It burns ${minutes(left)} more. Nothing to feed it` : 'It went out. Bring something that burns', left ? GREY : NO);
    if (!this.online) return;
    this.feeding = { x, y, at: this.clock };
    this.send({ t: 'feed', x, y, slot });
  }

  /** Gives the Old Stone a shard, if you carry one; else says how far it is from waking. */
  private offer(x: number, y: number) {
    const slot = this.bestSlot(def => def.charge ?? 0);
    const st = this.stone;
    if (slot < 0) return this.floatOverMe(st.awake ? `It is awake for ${minutes(st.left)}` : `${st.charge} of ${st.need} shards. It wants more`, EERIE);
    if (this.online) this.send({ t: 'feed', x, y, slot });
  }

  /** The bag slot whose item scores highest (above 0), or -1. */
  private bestSlot(score: (def: ReturnType<Items['get']>) => number): number {
    let best = -1, top = 0;
    this.bag.forEach((s, i) => {
      const v = score(this.items.get(s.item));
      if (v > top) { top = v; best = i; }
    });
    return best;
  }

  /**
   * What A would do now: pick up what lies on your own tile, else on the tile you face (on either, a
   * pile before a find), and only then talk to whoever you face or read the sign.
   */
  action(): Action | null {
    const me = this.me;
    if (!me) return null;
    const [dx, dy] = DIR_VEC[me.dir];
    for (const [x, y] of [[me.tx, me.ty], [me.tx + dx, me.ty + dy]] as const) {
      const thing = this.thingAt(x, y);
      if (thing) return { kind: 'pick', x, y, what: thing.kind };
    }
    const talker = this.talkerAt(me.tx + dx, me.ty + dy);
    return talker ? { kind: 'talk', talker } : null;
  }

  /** What lies on tile x,y to pick up: a pile before a find. */
  thingAt(x: number, y: number): Thing | undefined {
    for (const drop of this.drops.values()) if (drop.x === x && drop.y === y) return { kind: 'drop', drop };
    for (const find of this.finds.values()) if (find.x === x && find.y === y) return { kind: 'find', find };
    return undefined;
  }

  /** B: back. Returns true when it handled something (so the caller does not open the bag). */
  pressB(): boolean {
    if (this.dialog) { this.advanceDialog(); return true; }
    return false;
  }

  tapTile(x: number, y: number) {
    if (this.dialog) return this.advanceDialog();
    const me = this.me;
    if (!me) return;
    const from = { x: me.tx, y: me.ty };
    // Something to pick up: walk onto it (finds are small, so a tap on one lands on its own tile).
    if (this.thingAt(x, y)) {
      this.goal = { pick: { x, y } };
      this.path = findPath(this.map, from.x, from.y, x, y);
      const end = this.path.at(-1) ?? from;
      this.marker = { x: end.x, y: end.y, t: 0 };
      return;
    }
    // People and signs are tall: a tap on the head lands on the tile behind them.
    const talker = this.talkerAt(x, y) ?? this.talkerAt(x, y + 1);
    if (talker) {
      this.goal = { talk: talker };
      this.path = findPath(this.map, from.x, from.y, talker.x, talker.y, true);
      const end = this.path.at(-1) ?? from;
      this.marker = { x: end.x, y: end.y, t: 0 };
      return;
    }
    if (!this.map.inside(x, y)) return;
    this.goal = null;
    this.path = findPath(this.map, from.x, from.y, x, y);
    if (this.path.length) { const end = this.path.at(-1)!; this.marker = { x: end.x, y: end.y, t: 0 }; }
  }

  private talkerAt(x: number, y: number): Talker | undefined {
    return this.talkers.find(t => t.x === x && t.y === y);
  }

  /** Asks the server for what lies on tile x,y. One pick at a time: the answer is on its way. */
  private pick(x: number, y: number) {
    if (!this.online || (this.picking && this.clock - this.picking.at < ANSWER_WAIT_MS)) return;
    this.picking = { at: this.clock };
    this.send({ t: 'pick', x, y });
  }

  /** Use what is in bag slot `slot` (a thermos: energy back). The server says whether it went through. */
  use(slot: number) {
    const s = this.bag[slot];
    if (!s || !this.online) return;
    this.using = { item: s.item, had: countOf(this.bag, s.item), at: this.clock };
    this.send({ t: 'use', slot });
  }

  /** Throw away everything in bag slot `slot`. */
  discard(slot: number) {
    if (!this.bag[slot] || !this.online) return;
    // A use still waiting would take this for its answer.
    this.using = null;
    this.send({ t: 'discard', slot });
  }

  /**
   * Were you carrying something just now? Asked when a collapse arrives, to say that what you
   * carried lies where you fell: the bag itself, or what it held if the server emptied it a moment ago.
   */
  carrying(now: number): boolean {
    return this.bag.length > 0 || now - this.emptiedAt < JUST_NOW_MS;
  }

  /** Piles close enough to show whose they are. */
  pilesNear(): DropView[] {
    const me = this.me;
    if (!me) return [];
    return [...this.drops.values()].filter(d => Math.hypot(d.x - me.x, d.y - me.y) <= PILE_TAG_TILES);
  }

  // ---------- dialog ----------

  private openDialog(t: Talker) {
    this.dialog = { who: t.who, lines: t.lines, i: 0, shown: 0 };
  }

  advanceDialog() {
    const d = this.dialog;
    if (!d) return;
    const line = d.lines[d.i] ?? '';
    if (d.shown < line.length) { d.shown = line.length; return; }
    d.i++; d.shown = 0;
    if (d.i >= d.lines.length) this.dialog = null;
  }

  private float(text: string, color: string, x: number, y: number, row = 0) {
    this.floats.push({ id: ++this.fid, text, color, x, y, t: 0, row });
  }

  private floatOverMe(text: string, color: string, row = 0) {
    const me = this.me;
    if (me) this.float(text, color, me.tx, me.ty, row);
  }

  // ---------- simulation ----------

  update(dt: number, now: number) {
    this.clock = now;
    for (const f of this.floats) f.t += dt;
    this.floats = this.floats.filter(f => f.t < 1.3);
    if (this.marker) { this.marker.t += dt; if (this.marker.t > 0.8) this.marker = null; }
    if (this.dialog) { const line = this.dialog.lines[this.dialog.i] ?? ''; this.dialog.shown = Math.min(line.length, this.dialog.shown + dt * 48); }

    for (const c of this.creatures.values()) {
      if (!c.anim) continue;
      const k = (now - c.anim.t0) / c.anim.dur;
      if (k >= 1) { c.x = c.tx; c.y = c.ty; c.anim = null; } else { c.x = c.anim.fx + (c.tx - c.anim.fx) * k; c.y = c.anim.fy + (c.ty - c.anim.fy) * k; }
    }
    for (const p of this.players.values()) {
      p.turnT = Math.max(0, p.turnT - dt);
      if (!p.anim) continue;
      const k = (now - p.anim.t0) / p.anim.dur;
      if (k >= 1) {
        p.x = p.tx; p.y = p.ty; p.anim = null;
        if (p.id === this.meId) this.justStepped = true;
      } else {
        p.x = p.anim.fx + (p.tx - p.anim.fx) * k;
        p.y = p.anim.fy + (p.ty - p.anim.fy) * k;
      }
      p.phase += dt * (1000 / this.stepMs) * 3;
    }
    this.driveMe(now);
  }

  /** Decide the local player's next step once they stand on a tile. */
  private driveMe(now: number) {
    const me = this.me;
    if (!me || me.anim || this.dialog || !this.online || this.held) { this.justStepped = false; return; }
    // On an exit the server is about to move us to another map, and steps planned on this one would be refused.
    if (this.map.exitAt(me.tx, me.ty)) {
      this.exitSince ??= now;
      this.path = []; this.goal = null; this.justStepped = false;
      if (now - this.exitSince < EXIT_WAIT_MS) return;
    } else this.exitSince = null;
    const wasWalking = this.justStepped;
    this.justStepped = false;
    let dir: Dir | null = null;
    if (this.pad.dir) {
      this.path = []; this.goal = null;
      if (me.dir !== this.pad.dir) {
        me.dir = this.pad.dir;
        if (wasWalking) dir = this.pad.dir;
        else { me.turnT = 0.14; this.pad.facingAtPress = false; this.pad.changedAt = now; this.send({ t: 'face', dir: me.dir }); }
      } else if (wasWalking || this.pad.facingAtPress || now - this.pad.changedAt >= HOLD_TO_WALK_MS) dir = this.pad.dir;
    } else if (this.path.length) {
      const next = this.path[0]!;
      dir = dirOf(next.x - me.tx, next.y - me.ty);
      if (!dir) this.path = [];
    } else if (this.goal) {
      this.reach(me, this.goal);
      this.goal = null;
    }
    if (!dir) return;
    if (this.pending.length >= MAX_UNCONFIRMED) return; // wait for the server to catch up
    const to = stepTarget(me.tx, me.ty, dir);
    if (!this.map.walkable(to.x, to.y)) {
      if (me.dir !== dir) { me.dir = dir; this.send({ t: 'face', dir }); }
      this.path = [];
      return;
    }
    if (this.path.length) this.path.shift();
    const seq = ++this.seq;
    this.pending.push({ seq, x: to.x, y: to.y });
    this.walk(me, to.x, to.y, dir, now);
    this.send({ t: 'step', dir, seq });
  }

  /**
   * The walk to what was tapped is over: talk to the person next to us, or pick up what we stand on
   * (or what lies next to us, when its tile could not be reached). Nothing, if it went away meanwhile.
   */
  private reach(me: Mover, goal: Goal) {
    const at = 'talk' in goal ? goal.talk : goal.pick;
    const d = Math.abs(at.x - me.tx) + Math.abs(at.y - me.ty);
    const there = 'talk' in goal ? d === 1 : d <= 1 && !!this.thingAt(at.x, at.y);
    if (!there) return;
    if (d === 1) {
      const face = dirToward(at.x - me.tx, at.y - me.ty);
      if (face !== me.dir) { me.dir = face; this.send({ t: 'face', dir: face }); }
    }
    if ('talk' in goal) this.meet(goal.talk);
    else this.pick(at.x, at.y);
  }

  avatars(): Avatar[] {
    const hitched = this.body.view.hitched;
    return [...this.players.values()].map(p => ({
      id: p.id, x: p.x, y: p.y, dir: p.dir, moving: !!p.anim, phase: p.phase, color: p.color, turnT: p.turnT, hitched: hitched && p.id === this.meId,
      look: lookOf(this.gear.get(p.id) ?? {}, this.items),
    }));
  }

  /** The creatures on this map, where they are drawn now. */
  creatureViews(): Array<{ id: string; x: number; y: number; dir: Dir; moving: boolean }> {
    return [...this.creatures.values()].map(c => ({ id: c.id, x: c.x, y: c.y, dir: c.dir, moving: !!c.anim }));
  }
}
