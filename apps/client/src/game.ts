/**
 * What the player sees and does, kept in sync with the server:
 * - your own steps are predicted (you move the instant you press) and confirmed or corrected by the server;
 * - other players are animated from the steps the server reports;
 * - D-pad: a quick tap on a new direction turns in place, holding walks (like FireRed);
 * - tapping the ground walks there; A talks to people and reads signs.
 */
import { STEP_MS, dirOf, dirToward, findPath, stepTarget, DIR_VEC, type ClientMsg, type Dir, type MapObject, type PlayerView, type ServerMsg, type TileMap } from '@napoland/shared';
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

type Talker = { x: number; y: number; who: string; lines: string[] };

/** How long a D-pad direction must be held before a turn becomes a walk. */
const HOLD_TO_WALK_MS = 160;
/** Never run more than this many steps ahead of the server's confirmations. */
const MAX_UNCONFIRMED = 2;

export class Game {
  meId: string | null = null;
  /** True between the server's welcome and the connection dropping; no steps are taken otherwise. */
  online = false;
  players = new Map<string, Mover>();
  stepMs = STEP_MS;
  marker: { x: number; y: number; t: number } | null = null;
  dialog: { who: string; lines: string[]; i: number; shown: number } | null = null;
  floats: Array<{ id: number; text: string; color: string; x: number; y: number; t: number }> = [];
  private fid = 0;
  private seq = 0;
  private pending: Array<{ seq: number; x: number; y: number }> = [];
  private path: Array<{ x: number; y: number }> = [];
  private talkTarget: Talker | null = null;
  private pad = { dir: null as Dir | null, changedAt: 0, facingAtPress: false };
  private justStepped = false;
  private talkers: Talker[];

  constructor(private map: TileMap, private send: (msg: ClientMsg) => void) {
    this.talkers = map.data.objects.flatMap((o: MapObject): Talker[] => {
      if (o.kind === 'npc') return [{ x: o.x, y: o.y, who: o.name, lines: o.lines }];
      if (o.kind === 'sign') return [{ x: o.x, y: o.y, who: 'Sign', lines: o.text }];
      return [];
    });
  }

  get me(): Mover | undefined {
    return this.meId ? this.players.get(this.meId) : undefined;
  }

  // ---------- messages from the server ----------

  handle(msg: ServerMsg, now: number) {
    switch (msg.t) {
      case 'welcome':
        this.meId = msg.you;
        this.online = true;
        this.stepMs = msg.stepMs;
        this.players.clear();
        for (const p of msg.players) this.players.set(p.id, this.mover(p));
        this.pending = []; this.path = []; this.talkTarget = null; this.justStepped = false;
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
      default:
        break;
    }
  }

  /** The connection dropped: stop predicting until the next welcome puts us back in sync. */
  disconnected() {
    this.online = false;
    this.pending = []; this.path = []; this.talkTarget = null;
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
    this.pending = []; this.path = []; this.talkTarget = null;
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
    const [dx, dy] = DIR_VEC[me.dir];
    const t = this.talkerAt(me.tx + dx, me.ty + dy);
    if (t) this.openDialog(t);
    else this.float('Nothing here', '#c9c2b0', me.tx, me.ty);
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
    const talker = this.talkerAt(x, y) ?? this.talkerAt(x, y + 1);
    const from = { x: me.tx, y: me.ty };
    if (talker) {
      this.talkTarget = talker;
      this.path = findPath(this.map, from.x, from.y, talker.x, talker.y, true);
      const end = this.path.at(-1) ?? from;
      this.marker = { x: end.x, y: end.y, t: 0 };
      return;
    }
    if (!this.map.inside(x, y)) return;
    this.talkTarget = null;
    this.path = findPath(this.map, from.x, from.y, x, y);
    if (this.path.length) { const end = this.path.at(-1)!; this.marker = { x: end.x, y: end.y, t: 0 }; }
  }

  private talkerAt(x: number, y: number): Talker | undefined {
    return this.talkers.find(t => t.x === x && t.y === y);
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

  private float(text: string, color: string, x: number, y: number) {
    this.floats.push({ id: ++this.fid, text, color, x, y, t: 0 });
  }

  // ---------- simulation ----------

  update(dt: number, now: number) {
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
    if (!me || me.anim || this.dialog || !this.online) { this.justStepped = false; return; }
    const wasWalking = this.justStepped;
    this.justStepped = false;
    let dir: Dir | null = null;
    if (this.pad.dir) {
      this.path = []; this.talkTarget = null;
      if (me.dir !== this.pad.dir) {
        me.dir = this.pad.dir;
        if (wasWalking) dir = this.pad.dir;
        else { me.turnT = 0.14; this.pad.facingAtPress = false; this.pad.changedAt = now; this.send({ t: 'face', dir: me.dir }); }
      } else if (wasWalking || this.pad.facingAtPress || now - this.pad.changedAt >= HOLD_TO_WALK_MS) dir = this.pad.dir;
    } else if (this.path.length) {
      const next = this.path[0]!;
      dir = dirOf(next.x - me.tx, next.y - me.ty);
      if (!dir) this.path = [];
    } else if (this.talkTarget) {
      const t = this.talkTarget;
      this.talkTarget = null;
      if (Math.abs(t.x - me.tx) + Math.abs(t.y - me.ty) === 1) {
        const face = dirToward(t.x - me.tx, t.y - me.ty);
        if (face !== me.dir) { me.dir = face; this.send({ t: 'face', dir: face }); }
        this.openDialog(t);
      }
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

  avatars(): Avatar[] {
    return [...this.players.values()].map(p => ({ id: p.id, x: p.x, y: p.y, dir: p.dir, moving: !!p.anim, phase: p.phase, color: p.color, turnT: p.turnT }));
  }
}
