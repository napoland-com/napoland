/**
 * What the player sees and does, kept in sync with the server:
 * - your own steps are predicted (you move the instant you press) and confirmed or corrected by the server;
 * - other players are animated from the steps the server reports;
 * - D-pad: a quick tap on a new direction turns in place, holding walks (like FireRed);
 * - tapping the ground walks there; tapping a person or a sign walks up and talks, tapping a find or a
 *   pile walks onto it and picks it up;
 * - A picks up what lies on your tile or the one you face, else talks to people and reads signs;
 * - finds and piles on your map, and your bag, are the server's: it tells us, we show them;
 * - the map can change: walking onto an exit, or collapsing, makes the server move you (`zone`);
 * - energy is counted forward between the server's reports, so the bar moves smoothly.
 */
import {
  STEP_MS, dirOf, dirToward, energyAfter, findPath, stepTarget, DIR_VEC,
  type BagSlot, type ClientMsg, type Dir, type DropView, type EnergyView, type FindView, type MapObject, type PlayerView, type ServerMsg, type TileMap,
} from '@napoland/shared';
import { countOf, refusalText, useText, type Items } from './items';
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

export type Talker = { x: number; y: number; who: string; lines: string[] };

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

function talkersOf(map: TileMap): Talker[] {
  return map.data.objects.flatMap((o: MapObject): Talker[] => {
    if (o.kind === 'npc') return [{ x: o.x, y: o.y, who: o.name, lines: o.lines }];
    if (o.kind === 'sign') return [{ x: o.x, y: o.y, who: 'Sign', lines: o.text }];
    return [];
  });
}

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
        this.bag = msg.bag;
        this.lastEnergy = { view: msg.energy, at: now };
        break;
      }
      case 'zone': {
        const map = this.maps.get(msg.map);
        if (!map) { this.disconnected(now); break; }
        const old = this.me;
        this.enter(map, msg.players, msg.finds, msg.drops);
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
        break;
      case 'join':
        this.players.set(msg.player.id, this.mover(msg.player));
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
    this.picking = null; this.using = null;
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
      this.dialog = null; this.marker = null; this.floats = [];
    }
    this.players.clear();
    for (const p of players) this.players.set(p.id, this.mover(p));
    this.finds = new Map(finds.map(f => [f.id, f]));
    this.drops = new Map(drops.map(d => [d.id, d]));
    this.lootChanges++;
    this.pending = []; this.path = []; this.goal = null; this.justStepped = false; this.exitSince = null;
    this.picking = null;
  }

  private mover(p: PlayerView): Mover {
    return { id: p.id, name: p.name, color: p.color, tx: p.x, ty: p.y, x: p.x, y: p.y, dir: p.dir, anim: null, phase: 0, turnT: 0 };
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
    else if (act.kind === 'talk') this.openDialog(act.talker);
    else this.pick(act.x, act.y);
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
    if ('talk' in goal) this.openDialog(goal.talk);
    else this.pick(at.x, at.y);
  }

  avatars(): Avatar[] {
    return [...this.players.values()].map(p => ({ id: p.id, x: p.x, y: p.y, dir: p.dir, moving: !!p.anim, phase: p.phase, color: p.color, turnT: p.turnT }));
  }
}
