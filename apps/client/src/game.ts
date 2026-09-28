/**
 * What the player sees and does, kept in sync with the server:
 * - your own steps are predicted (you move the instant you press) and confirmed or corrected by the server;
 * - other players are animated from the steps the server reports;
 * - D-pad: a quick tap on a new direction turns in place, holding walks (like FireRed);
 * - tapping the ground walks there; tapping a person or a sign walks up and talks, tapping a find or a
 *   pile walks onto it and picks it up;
 * - A picks up what lies on your tile or the one you face, else feeds the fire or the Old Stone you
 *   face (with the best you carry for it), reads the notice board, talks to people and reads signs;
 * - anything that uses up what you carry or keep asks first in the text box (ask.ts), or says why it
 *   cannot happen when that is known already; YES sends it, and the box then says what it did, from
 *   the server's answer (`did`, worded by said.ts);
 * - a parcel that comes into your chest (signed in, the first time you play each day) is news, and the
 *   stash says what came in it the next time it opens;
 * - people and NAPO's desks are in the story (story.ts): what someone says follows the chapter you
 *   are in (and, once, what you did for the first time), and the server hears whom you talked to or
 *   what you read; it says when a chapter is reached;
 * - the bag and the chest say what gear you could make next (nextGear), from your stash as the server
 *   last told it;
 * - finds and piles on your map, fires, marks, creatures and flares, and your bag, are the server's:
 *   it tells us, we show them;
 * - the map can change: walking onto an exit, or collapsing, makes the server move you (`zone`);
 * - energy, wetness, fires and the surge clock are counted forward between the server's reports, so
 *   everything moves smoothly.
 */
import {
  BUBBLE_S, FEED_MAX, STEP_MS, activeConditions, addToBag, bagSlotsOf, dirOf, dirToward, energyAfter, findPath, fireTakes, flashHits, inSurge, journal, mendCost, nearestRecipe, stepTarget,
  storyLines, surgeFront, takeFromBag, toldAfter, DIR_VEC, type NextGear,
  type BagSlot, type BodyView, type Chapter, type ClientMsg, type CreatureView, type Dir, type DropView, type EnergyView, type FindView, type FireView, type ItemDef, type MapObject,
  type Gear, type MarkView, type PersonView, type Quirk, type Worn, type PlayerView, type ProgressView, type ServerMsg, type Slot, type Stats, type StoneView, type StoryData, type SurgeView, type TileMap,
  type ChatTo, type ConditionsView, type FlashKind, type FlashView, type ParcelView, type RefusedAction, type StormView,
} from '@napoland/shared';
import { Question, Repeat, noteMs, type Ask, type Choice } from './ask';
import type { FriendsMsg, TalkLine } from './friends';
import type { AskView, NoteView } from './hud';
import { countOf, lookOf, refusalText, type Items } from './items';
import {
  GONE, INDOORS, MARKED, NO_ROOM, TENDED, TOO_DARK, didText, didWho, feedQuestion, fullFire, haveTool, makeQuestion, mendQuestion, noShard, nothingToBurn, openQuestion, sentence,
  shortOf, stashShort, stoneQuestion, tossQuestion, useQuestion,
} from './said';
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
 * Something you face and press A at: a person, a sign or one of NAPO's desks (talk), the notice
 * board (the server writes it), a fire or the Old Stone (you feed them). People and desks are in
 * the story (`story`): talking to one, or reading one, may move it on.
 */
export type Talker = {
  x: number; y: number; who: string; lines: string[]; kind: 'talk' | 'board' | 'fire' | 'stone' | 'chest' | 'bench';
  /** A person's id (the map's npc id). */
  id?: string;
  story?: { talk: string } | { read: string };
};

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
 * A pick waits this long for the server's answer before another may be asked, and after YES the box
 * waits this long for what it did. The answer normally comes within a round trip; asking twice
 * meanwhile would earn a "Someone got there first" for a find we took ourselves.
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
/** Float colors: something gained, a gentle no, nothing there, something eerie. */
const GAIN = '#ffe3a1';
const NO = '#ffae98';
const GREY = '#c9c2b0';
const EERIE = '#c7a6ff';
/** How long a creature takes to walk a tile, as drawn: each a little quicker than the server moves it, so it never lags. */
const CREATURE_STEP_MS: Record<CreatureView['kind'], number> = { watcher: 420, skulker: 230 };

/** A creature as the game animates it: like a player, and what kind it is and whom it chases. */
type Creature = Mover & { kind: CreatureView['kind']; chasing: string | undefined };

function talkersOf(map: TileMap): Talker[] {
  return map.data.objects.flatMap((o: MapObject): Talker[] => {
    if (o.kind === 'npc') return [{ x: o.x, y: o.y, who: o.name, lines: o.lines, kind: 'talk', id: o.id, story: { talk: o.id } }];
    if (o.kind === 'sign') return [{ x: o.x, y: o.y, who: o.style === 'napo' ? 'NAPO sign' : 'Sign', lines: o.text, kind: 'talk' }];
    if (o.kind === 'console') return [{ x: o.x, y: o.y, who: o.name, lines: o.text, kind: 'talk', story: { read: o.id } }];
    if (o.kind === 'board') return [{ x: o.x, y: o.y, who: 'Notice board', lines: [], kind: 'board' }];
    if (o.kind === 'fireplace') return [{ x: o.x, y: o.y, who: 'Fire', lines: [], kind: 'fire' }];
    if (o.kind === 'stone') return [{ x: o.x, y: o.y, who: 'The Old Stone', lines: [], kind: 'stone' }];
    if (o.kind === 'chest') return [{ x: o.x, y: o.y, who: 'Your stash', lines: [], kind: 'chest' }];
    if (o.kind === 'workbench') return [{ x: o.x, y: o.y, who: 'Workbench', lines: [], kind: 'bench' }];
    return [];
  });
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** "12 minutes", "under a minute". */
export function minutes(seconds: number): string {
  if (seconds < 60) return 'under a minute';
  const m = Math.round(seconds / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
}

/** News from the world for the interface to announce (status.ts, newsBanner). A feat's is the rank just reached. */
export type News =
  | { kind: 'feat'; id: string; rank: number } | { kind: 'live'; fresh: number } | { kind: 'surge'; view: SurgeView } | { kind: 'storm'; view: StormView } | { kind: 'stone'; view: StoneView } | { kind: 'level'; progress: ProgressView }
  /** A new day's conditions, by name. */
  | { kind: 'conditions'; names: string[] }
  | { kind: 'chapter'; chapter: Chapter }
  /** A parcel came into your chest. */
  | { kind: 'parcel'; parcel: ParcelView };

/** No story: a game that was given none (and a copy of the game without content/story.json). */
const NO_STORY: StoryData = { version: 0, chapters: [] };

/** Lines of chat a session keeps to scroll back through. */
export const CHAT_LOG = 100;

/** What a `refused` can answer among friends: the friends panel says why. */
const SOCIAL_ACTIONS = new Set<RefusedAction>(['befriend', 'answer', 'unfriend', 'tell', 'read', 'block', 'report', 'requests', 'friends']);
/** What asks first in the text box (ask.ts): a no from the server is said in the same box. */
const ASKED_FIRST = new Set<RefusedAction>(['feed', 'use', 'discard', 'craft', 'mend', 'open']);

export class Game {
  meId: string | null = null;
  /** True between the server's welcome and the connection dropping; no steps are taken otherwise. */
  online = false;
  /** You play as a guest (the welcome said): chat and friends wait for sign-in. */
  guest = false;
  /** Who on this map plays as a guest: nobody can ask them to be friends yet. */
  guests = new Set<string>();
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
  /** When the bag was told (`now`): a live find's age counts on from there. */
  bagAt = 0;
  /** The fires on this map by "x,y": fuel left as told, and when (null: tended, it never goes out). */
  fires = new Map<string, { left: number | null; at: number }>();
  /** Marks painted on this map, by id; `markChanges` counts changes, like lootChanges. */
  marks = new Map<number, MarkView>();
  markChanges = 0;
  /** Creatures on this map (watchers, skulkers), animated like players. */
  creatures = new Map<number, Creature>();
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
  /** The Old Stone in town, and your counts toward feats (each feat's rank follows from its count). */
  stone: StoneView = { charge: 0, need: 0, awake: false, left: 0 };
  stats: Stats = {};
  /** Counts every time the counts are told, so the open status panel shows them at once. */
  statsChanges = 0;
  /** What the woods are like today and this week (sky.ts), as the server said. */
  conditions: ConditionsView = { today: [], week: null, next: null };
  /** Your tools (item ids), in the order you got them: as the welcome said, then whole again whenever you get one. Replaced, never changed in place. */
  tools: string[] = [];
  /** Your XP and level. */
  progress: ProgressView = { xp: 0, level: 1, from: 0, to: null, maxEnergy: 100 };
  /** The id of the chapter of the story you are in, as the server said ('' until its welcome). */
  chapter = '';
  /** Counts every chapter reached, so the journal is redrawn only when it changed. */
  storyChanges = 0;
  /** The chest you opened (its tile) and what your stash holds, while it is open; null otherwise. */
  chest: { x: number; y: number; stash: BagSlot[] } | null = null;
  /** The workbench you opened and what your stash holds, while it is open. */
  bench: { x: number; y: number; stash: BagSlot[] } | null = null;
  /** Parcels that came since the chest was last opened: it says what came in them, once (takeParcels). */
  parcels: ParcelView[] = [];
  /** What your stash holds, as the server last told it (the welcome, and every chest and workbench after); null before. */
  stash: BagSlot[] | null = null;
  /** Your friends, requests and blocks as the server last told them (null until it has). */
  friends: FriendsMsg | null = null;
  /** Private messages this session, by the other player's id, oldest first; replaced whole on every change. */
  talks = new Map<string, TalkLine[]>();
  /** Friends whose messages you have not opened yet. */
  unread = new Set<string>();
  /** Whose card is open in the friends panel: their messages count as read while it is. */
  person: PersonView | null = null;
  /** The last friends action that did not go through, in words, for the panel. */
  socialNote: string | null = null;
  /** Counts every change to all of the above, so the panel is rebuilt only when something changed. */
  socialChanges = 0;
  /** What you heard said this session, oldest first, at most CHAT_LOG lines; replaced whole on every change. Nothing said is kept anywhere. */
  chat: Array<{ to: ChatTo; id: string; name: string; text: string; mine: boolean }> = [];
  /** Something was said since the chat panel was last looked at (the interface clears it). */
  chatNews = false;
  /** Why the last thing you tried to say did not go out, in words. */
  chatNote: string | null = null;
  chatChanges = 0;
  /** Speech bubbles over heads (local chat), by who said it, until when (our clock). */
  bubbles = new Map<string, { text: string; until: number }>();
  /** The quirks of what everyone on this map wears, by player id: some show in the world. */
  quirks = new Map<string, Quirk[]>();
  /** Who on this map carries a live find: a column of light stands over them. */
  live = new Set<string>();
  /** What everyone on this map wears, by player id (you too). */
  gear = new Map<string, Gear>();
  /** Feats just earned, for the interface to announce (it empties the list). */
  news: News[] = [];
  /** A question in the text box (ask.ts): until it is answered, nobody walks and A, B and the stick answer it. */
  question: Question | null = null;
  /**
   * What the text box says by itself: why something cannot happen, or what it did. It closes at `until`
   * (our clock) or with any press, and that press does nothing else. `waiting`: the question just said
   * yes to, kept up (without its choices, and no press closes it) until the server says how it went.
   */
  note: { who: string; text: string; until: number; waiting: boolean } | null = null;
  /** Counts every change to the question and the note, so the box is drawn again only when it changed. */
  boxChanges = 0;
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
  /** − or + held (or the stick held to a side) while a question asks how many. */
  private readonly repeat = new Repeat();
  /** What came to be said while a question or someone's lines had the box: said once they are done. */
  private later: { who: string; text: string } | null = null;
  /** A chest asked to open and not answered yet. */
  private opening: { x: number; y: number; at: number } | null = null;
  /** A workbench asked to open and not answered yet. */
  private benching: { x: number; y: number; at: number } | null = null;
  /** When the server last emptied a bag that held something. */
  private emptiedAt = -Infinity;

  constructor(private readonly maps: Maps, private readonly send: (msg: ClientMsg) => void, readonly items: Items, readonly story: StoryData = NO_STORY) {
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
        // A map we do not have, or other items or another story than the server's: this client is
        // out of date and about to reload, so it must not play.
        if (!map || msg.items !== this.items.version || msg.story.version !== this.story.version) { this.disconnected(now); break; }
        this.meId = msg.you;
        this.online = true;
        this.guest = msg.guest === true;
        this.stepMs = msg.stepMs;
        this.enter(map, msg.players, msg.finds, msg.drops);
        this.scene(msg, now);
        this.bag = msg.bag;
        this.bagAt = now;
        this.stash = msg.stash ?? null;
        this.lastEnergy = { view: msg.energy, at: now };
        this.body = { view: msg.body, at: now };
        this.stone = msg.stone;
        this.conditions = msg.conditions;
        this.stats = msg.stats;
        this.statsChanges++;
        this.progress = msg.progress;
        this.tools = msg.tools;
        this.chapter = msg.story.chapter;
        this.storyChanges++;
        break;
      }
      case 'zone': {
        const map = this.maps.get(msg.map);
        if (!map) { this.disconnected(now); break; }
        const old = this.me;
        this.enter(map, msg.players, msg.finds, msg.drops);
        this.scene(msg, now);
        this.stats = msg.stats;
        this.statsChanges++;
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
      case 'fire':
        this.fires.set(`${msg.fire.x},${msg.fire.y}`, { left: msg.fire.left, at: now });
        break;
      case 'mark':
        this.marks.set(msg.mark.id, msg.mark);
        this.markChanges++;
        break;
      case 'markGone':
        if (this.marks.delete(msg.id)) this.markChanges++;
        break;
      case 'creature': {
        const c = this.creatures.get(msg.creature.id);
        // The first moment one goes after you. The sound of it is soundscape.ts's.
        if (msg.creature.chasing === this.meId && c?.chasing !== this.meId) this.floatOverMe('Something is after you. Run', EERIE, 1);
        if (!c) this.creatures.set(msg.creature.id, this.creatureMover(msg.creature));
        // One that jumped (it woke somewhere else) is put there at once; a step is walked.
        else if (Math.abs(c.tx - msg.creature.x) + Math.abs(c.ty - msg.creature.y) > 1) this.snapMover(c, msg.creature);
        else if (c.tx !== msg.creature.x || c.ty !== msg.creature.y) {
          c.anim = { fx: c.x, fy: c.y, t0: now, dur: CREATURE_STEP_MS[c.kind] };
          c.tx = msg.creature.x; c.ty = msg.creature.y; c.dir = msg.creature.dir;
        }
        if (c) c.chasing = msg.creature.chasing;
        break;
      }
      case 'creatureGone':
        this.creatures.delete(msg.id);
        break;
      case 'touched': {
        const lost = msg.lost && this.items.get(msg.lost).name.toLowerCase();
        if (msg.by === 'skulker') {
          this.floatOverMe(lost ? `It caught you. You dropped your ${lost}` : 'It caught you', EERIE, 1);
          this.floatOverMe('It slipped back into the ferns', NO);
        } else {
          this.floatOverMe(lost ? `It took your ${lost}` : 'It touched you', EERIE, 1);
          this.floatOverMe('The cold goes right through you', NO);
        }
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
      case 'conditions': {
        const fresh = msg.conditions.today.join() !== this.conditions.today.join();
        this.conditions = msg.conditions;
        if (fresh) this.news.push({ kind: 'conditions', names: this.conditionNames(msg.conditions.today) });
        break;
      }
      case 'board':
        this.openDialog({ x: 0, y: 0, who: 'Notice board', lines: msg.lines, kind: 'board' });
        break;
      case 'feat':
        this.stats = msg.stats;
        this.statsChanges++;
        this.news.push({ kind: 'feat', id: msg.id, rank: msg.rank });
        break;
      case 'stats':
        this.stats = msg.stats;
        this.statsChanges++;
        break;
      case 'chapter': {
        const chapter = this.story.chapters.find(c => c.id === msg.id);
        this.chapter = msg.id;
        this.storyChanges++;
        if (chapter) this.news.push({ kind: 'chapter', chapter });
        break;
      }
      case 'chest': {
        this.stash = msg.stash;
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
      case 'parcel':
        this.parcels = [...this.parcels, msg.parcel];
        this.news.push({ kind: 'parcel', parcel: msg.parcel });
        break;
      case 'bench': {
        this.stash = msg.stash;
        const b = this.benching;
        if (b && this.clock - b.at < ANSWER_WAIT_MS) { this.bench = { x: b.x, y: b.y, stash: msg.stash }; this.benching = null; }
        else if (this.bench) this.bench = { ...this.bench, stash: msg.stash };
        break;
      }
      case 'did':
        // It takes the place of the question just said yes to, which waited for it in the box.
        this.inform(didWho(msg.did, this.items), didText(msg.did, this.items));
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
        if (msg.player.live) this.live.add(msg.player.id);
        else this.live.delete(msg.player.id);
        // A guest who signed in comes back in as someone who is not one.
        if (msg.player.guest) this.guests.add(msg.player.id);
        else this.guests.delete(msg.player.id);
        this.socialChanges++;
        break;
      case 'glow':
        if (msg.on) this.live.add(msg.id);
        else this.live.delete(msg.id);
        break;
      case 'leave':
        this.players.delete(msg.id);
        this.live.delete(msg.id);
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
        if (this.bag.length && !msg.bag.length) this.emptiedAt = now;
        this.bag = msg.bag;
        this.bagAt = now;
        break;
      }
      case 'tools':
        this.tools = msg.tools;
        break;
      case 'got': {
        this.picking = null;
        // A column over your head, in the order the server listed them, first on top. A tool is yours once: no count.
        msg.items.forEach((s, i) => this.floatOverMe(`+${msg.from === 'tool' ? '' : s.count} ${this.items.get(s.item).name}`, GAIN, msg.items.length - 1 - i));
        // Named, so the player knows which feat to thank.
        if (msg.double) this.floatOverMe('Forager: it came up double', GAIN, msg.items.length);
        // Someone else's pile can leave you nothing (your half did not fit, or the coin went the
        // other way); it is gone all the same, so say so rather than let it vanish silently.
        if (!msg.items.length) this.floatOverMe('Nothing in it for you', NO);
        const live = msg.items.map(s => this.items.get(s.item).live).find(l => l);
        if (live) this.news.push({ kind: 'live', fresh: live.fresh });
        break;
      }
      case 'friends':
        this.friends = msg;
        this.socialChanges++;
        break;
      case 'said': {
        const mine = msg.id === this.meId;
        this.chat = [...this.chat, { to: msg.to, id: msg.id, name: msg.name, text: msg.text, mine }].slice(-CHAT_LOG);
        if (msg.to === 'local') this.bubbles.set(msg.id, { text: msg.text, until: now + BUBBLE_S * 1000 });
        if (!mine) this.chatNews = true;
        this.chatChanges++;
        break;
      }
      case 'tells':
        for (const t of msg.tells) {
          this.talks.set(t.from, [...(this.talks.get(t.from) ?? []), { mine: false, text: t.text }]);
          if (this.person?.id !== t.from) this.unread.add(t.from);
        }
        // Read at once when their card is open.
        if (this.person && msg.tells.some(t => t.from === this.person!.id)) this.send({ t: 'read', from: this.person.id });
        this.socialChanges++;
        break;
      case 'refused':
        if (SOCIAL_ACTIONS.has(msg.action)) { this.socialNote = refusalText(msg.reason, msg.action); this.socialChanges++; break; }
        if (msg.action === 'say') { this.chatNote = refusalText(msg.reason, msg.action); this.chatChanges++; break; }
        // What was asked first is answered in the same box; the rest (picking up, the chest) over your head.
        if (ASKED_FIRST.has(msg.action)) {
          this.inform(this.note?.waiting ? this.note.who : '', sentence(refusalText(msg.reason, msg.action)));
          break;
        }
        if (msg.action === 'pick') this.picking = null;
        this.floatOverMe(refusalText(msg.reason, msg.action), NO);
        break;
      default:
        break;
    }
  }

  /** The connection dropped: stop predicting until the next welcome puts us back in sync. */
  disconnected(now: number) {
    this.online = false;
    this.pending = []; this.path = []; this.goal = null;
    // Answers to what we asked went with the connection, and what was being asked may no longer hold.
    this.picking = null; this.opening = null; this.chest = null; this.benching = null; this.bench = null;
    this.clearBox();
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
      this.clearBox();
    }
    this.players.clear();
    for (const p of players) this.players.set(p.id, this.mover(p));
    this.guests = new Set(players.filter(p => p.guest).map(p => p.id));
    this.socialChanges++;
    this.gear = new Map(players.map(p => [p.id, p.gear ?? {}]));
    this.quirks = new Map(players.map(p => [p.id, p.quirks ?? []]));
    this.live = new Set(players.filter(p => p.live).map(p => p.id));
    this.finds = new Map(finds.map(f => [f.id, f]));
    this.drops = new Map(drops.map(d => [d.id, d]));
    this.lootChanges++;
    this.pending = []; this.path = []; this.goal = null; this.justStepped = false; this.exitSince = null;
    this.picking = null;
  }

  private mover(p: PlayerView): Mover {
    return { id: p.id, name: p.name, color: p.color, tx: p.x, ty: p.y, x: p.x, y: p.y, dir: p.dir, anim: null, phase: 0, turnT: 0 };
  }

  private creatureMover(c: CreatureView): Creature {
    return { id: String(c.id), name: '', color: '', tx: c.x, ty: c.y, x: c.x, y: c.y, dir: c.dir, anim: null, phase: 0, turnT: 0, kind: c.kind, chasing: c.chasing };
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
    const q = this.question;
    if (q) {
      // While it asks, the stick answers: up and down choose, a side takes one away or adds one (held, it repeats).
      this.repeat.release();
      const changed = dir === 'left' || dir === 'right' ? q.step(this.repeat.press(dir === 'left' ? -1 : 1, now)) : !!dir && q.move(dir);
      if (changed) this.boxChanges++;
      return;
    }
    // Walking off is fine while the box only says something; it closes.
    if (dir && this.note && !this.note.waiting) this.closeNote();
    if (dir && this.dialog) this.advanceDialog();
  }

  pressA() {
    if (this.question) return this.answer(this.question.choice);
    // A press that closes what the box says does nothing else.
    if (this.note) return this.closeNote();
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
    if (t.kind === 'talk') {
      // What people say comes in one order (storyLines, story.ts): the chapter's hint, what they say once
      // about what you did for the first time, what they have heard (Mira: what the woods are like today),
      // then what they always say. The server hears who you talked to, or what you read.
      const word = t.id === 'mira' ? this.miraWord() : null, own = word ? [word, ...t.lines] : t.lines;
      const person = t.story && 'talk' in t.story ? t.story.talk : undefined;
      this.openDialog({ ...t, lines: person ? storyLines(this.story, this.chapter, person, own, this.stats) : own });
      // Said once: the server keeps it when it hears the talk, and so do we, for the next time you talk meanwhile.
      const told = person ? toldAfter(this.story, person, this.stats) : undefined;
      if (told !== undefined && told !== (this.stats.told ?? 0)) { this.stats = { ...this.stats, told }; this.statsChanges++; }
      if (t.story && this.online) this.send({ t: 'talk', x: t.x, y: t.y });
      return;
    }
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

  /** The open chest says what came in the parcels it has not told yet: they are told from now on. */
  takeParcels(): ParcelView[] {
    const p = this.parcels;
    this.parcels = [];
    return p;
  }

  /**
   * At the open chest: open a sealed thing from the stash (a NAPO lockbox). It asks first ("Open the NAPO
   * lockbox? It has been sealed since the evacuation."), and the box then says what was inside.
   */
  openSealed(item: string) {
    const c = this.chest;
    if (!c || !this.online) return;
    const def = this.items.get(item), text = openQuestion(def);
    this.ask({ who: def.name, text, yes: () => this.act(def.name, text, { t: 'open', x: c.x, y: c.y, item }) });
  }

  /** At the open chest: put on a piece of gear from the stash, or take off what a slot wears. */
  // ---------- chat ----------

  /** Says something to everyone online, or to whoever is near. What you said comes back like anyone's. */
  say(to: ChatTo, text: string) {
    const t = text.trim();
    if (!t || !this.online) return;
    this.chatNote = null;
    this.chatChanges++;
    this.send({ t: 'say', to, text: t });
  }

  /** Speech bubbles still up, by who said it. */
  bubblesNow(now: number): Array<{ id: string; text: string }> {
    for (const [id, b] of this.bubbles) if (b.until <= now) this.bubbles.delete(id);
    return [...this.bubbles].map(([id, b]) => ({ id, text: b.text }));
  }

  // ---------- friends ----------

  /** Opens someone's card (null: back to the list). Opening it reads what they sent. */
  openPerson(p: PersonView | null) {
    this.person = p;
    this.socialNote = null;
    if (p && this.unread.delete(p.id) && this.online) this.send({ t: 'read', from: p.id });
    this.socialChanges++;
  }

  befriend(by: { id: string } | { name: string }) {
    this.socialNote = null;
    this.socialChanges++;
    if (this.online) this.send({ t: 'befriend', ...by });
  }

  /** Says something to a friend: it shows at once, and the server keeps it until they read it. */
  tell(to: string, text: string) {
    const t = text.trim();
    if (!t || !this.online) return;
    this.talks.set(to, [...(this.talks.get(to) ?? []), { mine: true, text: t }]);
    this.socialNote = null;
    this.socialChanges++;
    this.send({ t: 'tell', to, text: t });
  }

  /** Any other friends action: answer, unfriend, block, report, the requests setting, or asking for the list again. */
  social(msg: Extract<ClientMsg, { t: 'answer' | 'unfriend' | 'block' | 'report' | 'requests' | 'friends' }>) {
    if (this.online) this.send(msg);
  }

  /** Something new for the menu's dot: a friend request, or a message not opened yet. */
  get socialNews(): boolean {
    return this.unread.size > 0 || (this.friends?.incoming.length ?? 0) > 0;
  }

  /** Puts on the `n`th piece of `item` in the stash (their order in the chest). */
  equip(item: string, n = 0) {
    const c = this.chest;
    if (c && this.online) this.send({ t: 'equip', x: c.x, y: c.y, item, ...(n ? { n } : {}) });
  }

  /**
   * At the open workbench: mend what you wear in `slot`. It asks first ("Mend your raincoat? It uses 2
   * cloth and 1 scrap."), or says what the stash lacks. Making and mending go through here and craft()
   * only, whatever the workbench's panel looks like.
   */
  mend(slot: Slot) {
    const b = this.bench, id = this.myGear[slot];
    if (!b || !this.online || !id) return;
    const def = this.items.get(id), cost = mendCost(def, this.items.mend);
    if (!cost) return;
    const short = shortOf(cost, b.stash);
    if (short.length) return this.inform('Workbench', stashShort(short, this.items, { mend: def }));
    const text = mendQuestion(def, cost, this.items);
    this.ask({ who: 'Workbench', text, yes: () => this.act('Workbench', text, { t: 'mend', x: b.x, y: b.y, slot }) });
  }

  unequip(slot: Slot) {
    const c = this.chest;
    if (c && this.online) this.send({ t: 'unequip', x: c.x, y: c.y, slot });
  }

  /**
   * At the open workbench: make a recipe. It asks first ("Make a raincoat? It uses 8 cloth and 4 resin."),
   * or says why not: the stash lacks something, or it makes a tool you have already (each is yours once).
   */
  craft(recipe: string) {
    const b = this.bench, r = this.items.recipes.find(x => x.id === recipe);
    if (!b || !this.online || !r) return;
    const made = this.items.get(r.make);
    if (made.kind === 'tool' && this.tools.includes(r.make)) return this.inform('Workbench', haveTool(made));
    const short = shortOf(r.needs, b.stash);
    if (short.length) return this.inform('Workbench', stashShort(short, this.items, { make: this.items.get(r.make) }));
    const text = makeQuestion(r, this.items);
    this.ask({ who: 'Workbench', text, yes: () => this.act('Workbench', text, { t: 'craft', x: b.x, y: b.y, recipe }) });
  }

  closeBench() {
    this.bench = null;
  }

  /**
   * The nearest piece of gear you could make (a first goal: gear.ts, nearestRecipe), counting what your
   * stash (as last told) and your bag hold, among what you do not own yet; null before the stash is
   * told, or when you own everything the workbench makes.
   */
  nextGear(): NextGear | null {
    const stash = this.stash;
    if (!stash) return null;
    const count = (list: readonly BagSlot[]) => {
      const n: Record<string, number> = {};
      for (const s of list) n[s.item] = (n[s.item] ?? 0) + s.count;
      return n;
    };
    const owned = new Set([...Object.values(this.myGear), ...stash.filter(s => this.items.get(s.item).kind === 'gear').map(s => s.item)]);
    // Gear only: a recipe that makes a tool (yours for good, never worn) is never the first goal.
    const gear = this.items.recipes.filter(r => this.items.get(r.make).kind === 'gear');
    return nearestRecipe(gear, owned, count(stash), count(this.bag));
  }

  /** The workbench right next to you, where it can be opened; null when there is none. */
  benchBeside(): { x: number; y: number } | null {
    const me = this.me;
    const b = me && this.talkers.find(t => t.kind === 'bench' && Math.abs(t.x - me.tx) + Math.abs(t.y - me.ty) === 1);
    return b ? { x: b.x, y: b.y } : null;
  }

  /** Opens the workbench next to you, as A at it does (the server answers with what the stash holds). */
  openBench() {
    const b = this.benchBeside();
    if (!b || !this.online) return;
    this.benching = { ...b, at: this.clock };
    this.send({ t: 'bench', x: b.x, y: b.y });
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
   * A at a fire: asks to feed it what burns longest of what you carry, and how many (as many as you
   * carry and as fit), or says why not: someone keeps it going, it is full, or nothing you carry burns.
   */
  private tend(x: number, y: number) {
    const left = this.fireLeft(x, y, this.clock);
    if (left === null) return this.inform('Fire', TENDED);
    const slot = this.bestSlot(def => def.fuel ?? 0);
    if (slot < 0) return this.inform('Fire', nothingToBurn(left ?? 0, this.fuels()));
    const def = this.items.get(this.bag[slot].item), fits = fireTakes(left ?? 0, def.fuel ?? 0);
    if (fits <= 0) return this.inform('Fire', fullFire(left ?? 0));
    const text = feedQuestion(def);
    this.ask({
      who: 'Fire', text, count: { min: 1, max: Math.min(countOf(this.bag, def.id), fits, FEED_MAX) },
      yes: n => this.actOn(slot, def.id, 'Fire', text, i => ({ t: 'feed', x, y, slot: i, ...(n > 1 ? { count: n } : {}) })),
    });
  }

  /** A at the Old Stone: asks to give it shards, and how many (up to what you carry), or says how it stands when you have none. */
  private offer(x: number, y: number) {
    const slot = this.bestSlot(def => def.charge ?? 0);
    if (slot < 0) return this.inform('The Old Stone', noShard(this.stone));
    const def = this.items.get(this.bag[slot].item);
    this.ask({
      who: 'The Old Stone', text: n => stoneQuestion(def, n), count: { min: 1, max: Math.min(countOf(this.bag, def.id), FEED_MAX) },
      yes: n => this.actOn(slot, def.id, 'The Old Stone', stoneQuestion(def, n), i => ({ t: 'feed', x, y, slot: i, ...(n > 1 ? { count: n } : {}) })),
    });
  }

  /** What burns, the longest first: what a fire that went out wants. */
  private fuels(): ItemDef[] {
    return [...this.items.byId.values()].filter(d => (d.fuel ?? 0) > 0).sort((a, b) => b.fuel! - a.fuel!);
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

  /** B: back, and NO to a question. Returns true when it handled something (so the caller does not open the bag). */
  pressB(): boolean {
    if (this.question) { this.answer('no'); return true; }
    if (this.note) { this.closeNote(); return true; }
    if (this.dialog) { this.advanceDialog(); return true; }
    return false;
  }

  tapTile(x: number, y: number) {
    // A tap on the world is outside the box: NO to a question, and what the box says closes.
    if (this.question) return this.answer('no');
    if (this.note) return this.closeNote();
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

  /**
   * Use one of what is in bag slot `slot` (drink a thermos, light a flare, crush a glowcap, look closely
   * at a strange object). It asks first, or says why it cannot be done here; `done` runs on YES.
   */
  use(slot: number, done?: () => void) {
    const s = this.bag[slot];
    if (!s || !this.online) return;
    const def = this.items.get(s.item), why = this.whyNotUse(slot, def);
    if (why) return this.inform(def.name, why);
    const text = useQuestion(def, this.energy(this.clock));
    this.ask({ who: def.name, text, yes: () => { done?.(); this.actOn(slot, def.id, def.name, text, i => ({ t: 'use', slot: i })); } });
  }

  /** Throw away some of what is in bag slot `slot`: it asks how many, from one up to all of it. */
  discard(slot: number) {
    const s = this.bag[slot];
    if (!s || !this.online) return;
    const def = this.items.get(s.item), all = s.count, text = (n: number) => tossQuestion(def, n, all);
    this.ask({
      who: def.name, text, count: { min: 1, max: all },
      yes: n => this.actOn(slot, def.id, def.name, text(n), i => ({ t: 'discard', slot: i, count: n })),
    });
  }

  /** Why using `def` from bag slot `slot` cannot work here, when the game knows it already (the server checks it anyway); null when it can. */
  private whyNotUse(slot: number, def: ItemDef): string | null {
    const u = def.use ?? {}, me = this.me;
    if (u.identify) {
      if (!this.inTown()) return TOO_DARK;
      // Its own slot frees up; whatever it turns out to be must fit somewhere.
      const bag = takeFromBag(this.bag, slot, 1), room = bagSlotsOf(this.myGear, this.items.byId);
      if (def.reveals?.length && !def.reveals.some(r => !addToBag(bag, this.items.get(r.item), r.count, room).left)) return NO_ROOM;
    }
    if (u.mark && this.current.data.kind === 'inside') return INDOORS;
    if (u.mark && me && [...this.marks.values()].some(m => m.x === me.tx && m.y === me.ty)) return MARKED;
    return null;
  }

  /** In town, or in one of its houses: light enough to look at something closely (the server's rule). */
  private inTown(): boolean {
    const d = this.current.data;
    return d.kind === 'town' || (d.kind === 'inside' && d.exits.some(e => this.maps.find(e.to)?.kind === 'town'));
  }

  // ---------- the text box: asking first, and saying what it did ----------

  /**
   * Asks first, in the text box (ask.ts): YES runs `yes` with how many, NO (B, or a tap outside the box)
   * runs `no`. Until it is answered nobody walks, and A, B and the stick answer it.
   */
  ask(a: Ask) {
    this.question = new Question(a);
    this.note = null;
    this.dialog = null;
    this.path = []; this.goal = null;
    this.repeat.release();
    this.boxChanges++;
  }

  /** YES or NO to the open question: A, B, a tap on either, or a tap outside the box (NO). */
  answer(choice: Choice) {
    const q = this.question;
    if (!q) return;
    this.question = null;
    this.repeat.release();
    // A direction held while it asked walks only once it is pressed again.
    this.pad.dir = null;
    this.boxChanges++;
    if (choice === 'yes') q.ask.yes(q.n);
    else q.ask.no?.();
    // Whatever was said meanwhile is old news once a new answer is on its way.
    if (this.note?.waiting) this.later = null;
    else this.sayLater();
  }

  /** − or + pressed on the question (-1 or 1), held until let go (0): one step at once, then faster and faster. */
  holdCount(dir: -1 | 0 | 1, now: number) {
    this.repeat.release();
    const q = this.question;
    if (q && dir && q.step(this.repeat.press(dir, now))) this.boxChanges++;
  }

  /** A tap outside the text box: NO to a question, and what the box says closes. */
  dismiss() {
    if (this.question) return this.answer('no');
    this.closeNote();
  }

  /** A tap on the text box itself: it closes what the box says, or moves someone's lines on. A question waits for YES or NO. */
  boxTap() {
    if (this.question) return;
    if (this.note) return this.closeNote();
    this.advanceDialog();
  }

  /** The question as the text box draws it, or null. */
  askView(): AskView | null {
    return this.question?.view() ?? null;
  }

  /** What the box says by itself as it draws it, with how long it stays up from `now`; or null. */
  noteView(now: number): NoteView | null {
    const n = this.note;
    return n && { who: n.who, text: n.text, ms: Math.max(0, n.until - now), waiting: n.waiting };
  }

  /**
   * YES to something about the item that was in bag slot `slot`: the bag may have changed while it asked
   * (a watcher took something, a live shard faded), so it goes to wherever that item lies now, or the
   * box says it is gone.
   */
  private actOn(slot: number, item: string, who: string, text: string, msg: (slot: number) => ClientMsg) {
    const i = this.bag[slot]?.item === item ? slot : this.bag.findIndex(s => s.item === item);
    if (i < 0) return this.inform(who, GONE);
    this.act(who, text, msg(i));
  }

  /** YES: the message goes, and the box keeps the question up (without its choices) until the server says how it went. */
  private act(who: string, text: string, msg: ClientMsg) {
    if (!this.online) return;
    this.send(msg);
    this.note = { who, text, until: this.clock + ANSWER_WAIT_MS, waiting: true };
    this.boxChanges++;
  }

  /** Says something in the text box that closes by itself, or with any press: why something cannot happen, or what it did. */
  private inform(who: string, text: string) {
    // A question or someone's lines keep the box until they are done.
    if (this.question || this.dialog) { this.later = { who, text }; return; }
    this.note = { who, text, until: this.clock + noteMs(text), waiting: false };
    this.boxChanges++;
  }

  private closeNote() {
    if (!this.note || this.note.waiting) return;
    this.note = null;
    this.boxChanges++;
    this.sayLater();
  }

  /** Says what waited for the box, once the box is free. */
  private sayLater() {
    const l = this.later;
    if (!l || this.question || this.dialog || this.note) return;
    this.later = null;
    this.inform(l.who, l.text);
  }

  /** Nothing is asked or said any more: another map, or a lost connection. */
  private clearBox() {
    if (this.question || this.note) this.boxChanges++;
    this.question = null; this.note = null; this.later = null;
    this.repeat.release();
  }

  /**
   * Were you carrying something just now? Asked when a collapse arrives, to say that what you
   * carried lies where you fell: the bag itself, or what it held if the server emptied it a moment ago.
   */
  carrying(now: number): boolean {
    return this.bag.length > 0 || now - this.emptiedAt < JUST_NOW_MS;
  }

  /** Asks the server for your counts toward feats as they are now: only a new rank, a zone or a welcome tells them otherwise. */
  askStats() {
    if (this.online) this.send({ t: 'stats' });
  }

  /** The chapters of the story you reached, first to latest: what the journal keeps. */
  reached(): Chapter[] {
    return journal(this.story, this.chapter);
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
    // Someone's lines take the box from what it said by itself.
    if (this.note && !this.note.waiting) { this.note = null; this.boxChanges++; }
  }

  /** The text box with these lines under `who`, as a sign's: what one of your tools is, tapped in the bag's header. */
  read(who: string, lines: string[]) {
    if (lines.length) this.openDialog({ x: 0, y: 0, who, lines, kind: 'talk' });
  }

  /** "Word from the woods today: thick fog, and a NAPO cache. This week: copper week." Null when nothing is going on. */
  miraWord(): string | null {
    const today = this.conditionNames(this.conditions.today).map(lower);
    const week = this.conditionNames(this.conditions.week ? [this.conditions.week] : []).map(lower)[0];
    const parts = [
      ...(today.length ? [`Word from the woods today: ${today.length > 1 ? `${today.slice(0, -1).join(', ')}, and ${today.at(-1)}` : today[0]}.`] : []),
      ...(week ? [`This week: ${week}.`] : []),
    ];
    return parts.length ? parts.join(' ') : null;
  }

  /** You see this many tiles past yourself on this map, when a condition brings fog here (outdoors only). */
  fogCap(): number | undefined {
    if (this.current.data.kind === 'inside') return undefined;
    const fogs = activeConditions(this.items.conditions, this.conditions).filter(c => c.map === this.current.data.id && c.fog !== undefined).map(c => c.fog!);
    return fogs.length ? Math.min(...fogs) : undefined;
  }

  private conditionNames(ids: string[]): string[] {
    const all = [...this.items.conditions?.daily ?? [], ...this.items.conditions?.weekly ?? []];
    return ids.map(id => all.find(c => c.id === id)?.name ?? id);
  }

  advanceDialog() {
    const d = this.dialog;
    if (!d) return;
    const line = d.lines[d.i] ?? '';
    if (d.shown < line.length) { d.shown = line.length; return; }
    d.i++; d.shown = 0;
    if (d.i >= d.lines.length) {
      this.dialog = null;
      this.sayLater();
    }
  }

  private float(text: string, color: string, x: number, y: number, row = 0) {
    this.floats.push({ id: ++this.fid, text, color, x, y, t: 0, row });
  }

  /** Says something short over your head, in the grey of "Nothing here". */
  murmur(text: string) {
    this.floatOverMe(text, GREY);
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
    // − or + held keeps counting; what the box says by itself closes when its time is up.
    const q = this.question, by = q && this.repeat.held ? this.repeat.due(now) : 0;
    if (q && by && q.step(by)) this.boxChanges++;
    if (this.note && now >= this.note.until) {
      this.note = null;
      this.boxChanges++;
      this.sayLater();
    }

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
    if (!me || me.anim || this.dialog || this.question || !this.online || this.held) { this.justStepped = false; return; }
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
      id: p.id, x: p.x, y: p.y, dir: p.dir, moving: !!p.anim, phase: p.phase, color: p.color, turnT: p.turnT, hitched: hitched && p.id === this.meId, live: this.live.has(p.id),
      look: lookOf(this.gear.get(p.id) ?? {}, this.items),
    }));
  }

  /** The creatures on this map, where they are drawn now, and whom they chase. */
  creatureViews(): Array<{ id: string; kind: CreatureView['kind']; x: number; y: number; dir: Dir; moving: boolean; chasing: string | undefined }> {
    return [...this.creatures.values()].map(c => ({ id: c.id, kind: c.kind, x: c.x, y: c.y, dir: c.dir, moving: !!c.anim, chasing: c.chasing }));
  }
}
