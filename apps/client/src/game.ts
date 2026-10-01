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
 * - while the shop is open, a look is bought in the wardrobe (shop.ts): it asks first, with its price and
 *   the waiver, and the game goes to Stripe's page the server opens; the look is yours once the server
 *   says Stripe told it so, and coming back from that page the text box says whether it has yet;
 * - people and NAPO's desks are in the story (story.ts): what someone says follows the chapter you
 *   are in (and, once, what you did for the first time), and the server hears whom you talked to or
 *   what you read (a desk, a sign, a paper, a tag: where, never what it says); it says when a chapter
 *   is reached, and when a page of your field notes opens or a blank on one fills in (notebook.ts);
 * - the bag and the chest say what gear you could make next (nextGear), from your stash as the server
 *   last told it;
 * - a crate for whoever comes next (A, facing it) opens a panel like the chest's: take one thing out
 *   (it asks nothing, and thanks whoever left it) and leave one (it asks first), once each a visit;
 * - in your own home, what stands in each place for furniture (comfort.ts) reads with A: spoiled until
 *   you make it at the workbench, which sets it there at once; standing by your own fire makes you cozy,
 *   which the status panel counts down once you leave it; the workbench builds the house up (house.ts),
 *   and the kitchen and the map table stand there once it is built up to them (boxes, before);
 * - Visit on a friend's card sets you down in their home by NAPO's teleport, from town or a home only: you
 *   look round their house, drawn with their furniture and shelf, and their garden; A at NAPO's teleport in
 *   a house takes you to town;
 * - warming at a fire someone else fed, or stopping where someone's arrow points, the text box offers
 *   once to thank them (thanks.ts); thanks that reach you float over your head out in the wilds, are
 *   said in the text box anywhere else, and come in a letter when you walk in at home;
 * - out of energy out in the wilds you go down (shared rescue.ts): you cannot move, a countdown runs, and
 *   everyone on the map reads in local chat where you are down; A at someone down asks to give them
 *   some of your energy, and they get up with it;
 * - alone out in the wilds, now and then someone's steps from the last day walk past as a see-through
 *   figure in their color (glimpses.ts): the server sends only the color and the tiles, never who;
 * - finds and piles on your map, fires, marks, creatures and flares, and your bag, are the server's:
 *   it tells us, we show them; so is what everyone wears, gear and outfits (you choose yours at the chest);
 * - a call (calls.ts) goes to the server, which says who heard it: each one heard, yours too, is sung
 *   from where it came, and a note rises over the caller's head;
 * - a trade with a friend face to face (trade.ts) is the server's: a friend's ask comes as a question
 *   in the text box, your side runs ahead of the server's answer while you change it, and how it ended
 *   is said in the box;
 * - the map can change: walking onto an exit, or collapsing, makes the server move you (`zone`);
 * - energy, wetness, fires, the surge clock and the effects working on you (a hand warmer) are counted
 *   forward between the server's reports, so everything moves smoothly;
 * - the weather is your region's: the server says it as you arrive (welcome, zone) and when it turns;
 * - the Long Night is the server's too (`longNight`): its banners, and what Walt says while it is on.
 */
import {
  BUBBLE_S, TILE_NEEDS, CACHE_SIZE, LANTERN_DEPTH, lanternLights, timeToTurn, wayHomeCost, CALL_EVERY_MS, COZY_AFTER_S, FEED_MAX, NO_SHOP, RESTED_NOTICE, SEASONS, STEP_MS, UNEASE_LEVELS, activeConditions, addToBag, bagSlotsOf, blankOf,
  cacheTakes, canRescue, charmsIn, dirOf, dirToward, effectsAfter, emptyNotebook, energyAfter, findPath, fireTakes, firstBanner, flashHits, furnitureFor, inSurge, isKeepsake, journal,
  markLifetime, worksRoom, mendCost, meritLookOf, meritsLeft, meritsOf, modsOf, nearestRecipe, nextUpgrade, noteAt, noteLines, notesOf, objectTiles, poleTag, withTag, outfitsFor, priceOf, secretTitle, shopLookOf,
  stepTarget, linesInTurn, storyLines, surgeFront, takeFromBag, toldAfter, upgradable, utcDay, whyNotBuy, whyNotCheckout, DIR_VEC, type Blank, type BoardView, type ShopData, type ShopOpen,
  type CacheItemView, type FirstView, type LookKind, type MeritsView, type Mods, type NextGear, type NotebookData, type NotebookState, type Page, type Pass, BUNDLE, carriesFood, cookable,
  cooks, nearestCooking, pantryShort, builtIn, nextHouse, whyNotEat, ledgerLines, levelOf, noTown, popOf, sceneDue, scenesAfter, stormAt, swapsFit, workWants, type SayContext, type TownView, LAMP_BURNS, LOOKOUT_UP_S, footOf, inBeam, ladderOf, lampTakes, lookoutAtFoot,
  type BagSlot, type BodyView, type Chapter, type ClientMsg, type CreatureView, type Dir, type DropView, type EnergyView, type FindView, type FireView, type ItemDef, type MapObject,
  type Gear, type MarkView, type PersonView, type PieceAt, type Quirk, type Recipe, type Worn, type PlayerView, type ProgressView, type ServerMsg, type Slot, type Stats, type StoneView,
  type StoryData, type SurgeView, type TileMap,
  type CallKind, type ChatTo, type Comfort, type ConditionsView, type EffectView, type FlashKind, type FlashView, type LongNightView, type MapNote, type OfferPick, type ParcelView, type RefusedAction,
  type Season, type SeasonView, type StormView, type TileKind, type TradeEnd, type TradeView, type VisitView, type Weather, type LampView, type WorksView,
  PRINTS_KEPT_MS, PRINTS_PER_MAP, type PrintView, drawdownAt, drained, type DrawdownPhase, type DrawdownView,
} from '@napoland/shared';
import { Question, Repeat, noteMs, type Answer, type Ask } from './ask';
import { BEAM_IN_S, BEAM_OUT_S, padFor, popAt } from './beam';
import { CALL_FRESH_MS, CALL_NOTE_S, CALL_SLACK_MS } from './calls';
import { pieceAt, type DetailRef } from './details';
import type { FriendsMsg, TalkLine, VisitReach } from './friends';
import { Passing } from './glimpses';
import type { AskView, NoteView } from './hud';
import { countOf, lookOf, pieceName, refusalText, type Items } from './items';
import {
  CRATE_FULL, CRATE_NO_GEAR, FIRST_STEPS_DONE, FIRST_STEPS_TITLE, GONE, HOME_LETTER, INDOORS, KEEPSAKE_STAYS, KITCHEN, KITCHEN_EMPTY, LEFT_ONE, MAP_TABLE, MARKED, NO_MAP_HOME, NO_MAP_YET, NO_ROOM, TELEPORT, TURN_BACK,
  TENDED, TOOK_ONE, TOO_DARK, YOUR_GARDEN, YOUR_HOME, YOU_ARE_DOWN, boxesLines, buildQuestion, buyQuestion, checkoutQuestion, comfortLines, cookFromChest, didText, didWho, downLine, feedQuestion,
  friendsBoxes, fullFire, haveTool, houseWord, kitchenShort,
  floodedText, icefallText, leaveQuestion, makeQuestion, mendQuestion, noMerit, noShard, notYours, nothingToBurn, teleportQuestion, openQuestion, placedAlready, raisedText,
  rescueQuestion, rescueRefusal, rescueTooTired, sentence, shortOf, stashShort, stoneQuestion, tossQuestion, upgradeQuestion, useQuestion, visitedText, visitQuestion, visitWhyNot,
  visitWho, waltOnTheLongNight, padlocked, IN_YOUR_CHEST, LOST_AND_FOUND, LOST_AND_FOUND_LINES, TAKE_HALF, bundleNotYours, carryLabel, handInQuestion, pileQuestion, returnedLine, thingsOf,
  SLAB, WORKS_FULL, bringQuestion, nothingToGive, worksText, worksWho, slabRefusal, FIRE_CHOICE, FIRE_OPTIONS, TWO_MEALS, WHAT_TO_COOK, ateAlready, cookQuestion, cookShort, giveQuestion, swapQuestion, lampQuestion, upText, type DidContext,
} from './said';
import { Lodestone, shardNear } from './lodestone';
import { SHOP_OPENING, SHOP_THANKS, payPage, refundedLine, returnLine, type ShopReturn } from './shop';
import { trophiesIn } from './view/cabin';
import { easeZoom } from './lookout';
import type { Maps } from './maps';
import { Offers, fireThanksQuestion, letterLines, markThanksQuestion, returnedLines, thankRefusal, thankedFloat, thankedLine, thanksFor, where, type Offer } from './thanks';
import { offerOf, stepRow, tapSlot, tradeOverText, tradeQuestion, tradeReach, tradeRefusal, type TradeReach } from './trade';
import { tripCard } from './trip';
import { Stalker } from './unease';
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
 * board (the server writes it), a fire or the Old Stone (you feed them), a door you cannot open yet
 * (locked: it says why). People and desks are in the story (`story`): talking to one, or reading one,
 * may move it on.
 */
export type Talker = {
  x: number; y: number; who: string; lines: string[]; kind: 'talk' | 'board' | 'fire' | 'stone' | 'chest' | 'bench' | 'cache' | 'comfort' | 'kitchen' | 'teleport' | 'locked' | 'lostfound' | 'slab' | 'ledger' | 'lookout' | 'works';
  /** A person's id (the map's npc id). */
  id?: string;
  /** A place being mended (works.ts): its id. */
  works?: string;
  story?: { talk: string } | { read: string };
  /** A place for furniture in your home (comfort.ts): which one, read as what stands there now. */
  what?: Comfort;
  /** In a home (house.ts): the level of the house it stands in from; boxes stand in its place until then. */
  house?: number;
  /** A note someone left (notes.ts): what it shows depends on the time, so its lines are read out when you read it. */
  note?: MapNote;
};

/** Something lying on a tile to pick up: a pile someone left when they collapsed, or a find. */
export type Thing = { kind: 'drop'; drop: DropView } | { kind: 'find'; find: FindView };

/** What A does now: get someone up who is down, pick up what lies on tile x,y (a pile or a find), or talk. */
export type Action =
  | { kind: 'rescue'; id: string; name: string }
  | { kind: 'pick'; x: number; y: number; what: Thing['kind'] }
  | { kind: 'talk'; talker: Talker };

/** Where a tap sends us, and what to do there. */
type Goal = { talk: Talker } | { pick: { x: number; y: number } } | { rescue: { id: string; x: number; y: number } };

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
/** Coming back from Stripe's page, "Your payment is being confirmed." stays up this long unless something closes it: Stripe's word mostly comes in seconds. */
const CONFIRMING_MS = 60_000;
/** Piles show whose they are while you are this close (tiles, center to center). */
export const PILE_TAG_TILES = 3.5;
/** The name plate by the door of the house in a garden shows whose it is while you are this close to the tile in front of it. */
export const PLATE_TAG_TILES = 3.5;
/** How near you stand for the chest, the workbench and the kitchen in your home to show their names. */
export const SPOT_TAG_TILES = 3.5;
/** Float colors: something gained, a gentle no, nothing there, something eerie. */
const GAIN = '#ffe3a1';
const NO = '#ffae98';
const GREY = '#c9c2b0';
const EERIE = '#c7a6ff';
/** How long a creature takes to walk a tile, as drawn: each a little quicker than the server moves it, so it never lags. */
const CREATURE_STEP_MS: Record<CreatureView['kind'], number> = { watcher: 420, skulker: 230 };

/** A creature as the game animates it: like a player, and what kind it is and whom it chases. */
type Creature = Mover & { kind: CreatureView['kind']; chasing: string | undefined };

/** What pulling at one of NAPO's gates alone feels like, before its plate. */
export const GATE_PULLED = 'You pull at the gate. It gives a little, and no more: it will not move for one.';
/** What taking hold of the trappers' fixed rope alone (or with one other) feels like, before the words on its board. */
export const ROPE_PULLED = 'You take the rope and lean back on it. It slides, and holds nothing: tied off for three, it will not hold fewer.';
/** You see this many tiles past yourself in the snow while it falls up there: a whiteout. */
export const WHITEOUT = 3;
/** And this many in the Marsh, whose mist never lifts. */
export const MARSH_MIST = 6;

/** What a sign is called in the text box, by its style. */
const SIGN_WHO = { plain: 'Sign', napo: 'NAPO sign', cardboard: 'Cardboard sign', mailbox: 'Mailbox' } as const;

/** A lookout's lamp's key in Game.lamps: its corner as one number (maps are far narrower than 65536 tiles). */
const lampKey = (x: number, y: number) => y * 65536 + x;

/**
 * Everything you face and press A at on a map. A door locked with a tool `pass` does not hold (the shed's
 * padlock, without bolt cutters) says why it stays shut, under the name of what it leads into (`nameOf`);
 * one it holds is a door like any other.
 */
function talkersOf(map: TileMap, pass: Pass, items: Items, nameOf: (id: string) => string | undefined): Talker[] {
  const locked = map.data.exits.flatMap((e): Talker[] => (e.lock && !pass.has(e.lock) ? [{ x: e.x, y: e.y, who: nameOf(e.to) ?? 'Door', lines: [padlocked(items.get(e.lock))], kind: 'locked' }] : []));
  return [...locked, ...map.data.objects.flatMap((o: MapObject): Talker[] => {
    if (o.kind === 'npc') return [{ x: o.x, y: o.y, who: o.name, lines: o.lines, kind: 'talk', id: o.id, story: { talk: o.id } }];
    if (o.kind === 'sign') return [{ x: o.x, y: o.y, who: SIGN_WHO[o.style ?? 'plain'], lines: o.text, kind: 'talk' }];
    if (o.kind === 'console') return [{ x: o.x, y: o.y, who: o.name, lines: o.text, kind: 'talk', story: { read: o.id } }];
    if (o.kind === 'paper') return [{ x: o.x, y: o.y, who: o.name, lines: o.text, kind: 'talk' }];
    if (o.kind === 'cage') return [{ x: o.x, y: o.y, who: 'NAPO tag', lines: o.text, kind: 'talk' }];
    if (o.kind === 'sister') return [{ x: o.x, y: o.y, who: 'The Sister', lines: o.text, kind: 'talk' }];
    if (o.kind === 'note') return [{ x: o.x, y: o.y, who: o.name, lines: o.text, kind: 'talk', note: o }];
    // A pole of the north line has its tin tag to read; one with a note nailed to it says that instead.
    if (o.kind === 'pole') {
      const tag = noteAt(map.data, o.x, o.y) ? undefined : poleTag(map.data, o.x, o.y);
      return tag ? [{ x: o.x, y: o.y, who: 'Pole', lines: withTag([], tag), kind: 'talk' }] : [];
    }
    // A jeep is bigger than one tile: its stencil reads from whichever end you face.
    if (o.kind === 'jeep') return objectTiles(o).map(([x, y]): Talker => ({ x, y, who: 'NAPO jeep', lines: o.text, kind: 'talk' }));
    // A gate is pulled at from any of its tiles, and its plate read there: the server counts the pull, and
    // when enough pull at once it takes them all through.
    if (o.kind === 'gate') return objectTiles(o).map(([x, y]): Talker => (o.look === 'rope' ? { x, y, who: 'Fixed rope', lines: [ROPE_PULLED, ...o.text], kind: 'talk' } : { x, y, who: 'NAPO gate', lines: [GATE_PULLED, ...o.text], kind: 'talk' }));
    // In a home the board is the map table, which waits for its level of the house (house.ts), as the kitchen does.
    if (o.kind === 'board') return [{ x: o.x, y: o.y, who: map.data.private ? MAP_TABLE : 'Notice board', lines: [], kind: 'board', ...(o.house && { house: o.house }) }];
    if (o.kind === 'kitchen') return [{ x: o.x, y: o.y, who: KITCHEN, lines: [], kind: 'kitchen', ...(o.house && { house: o.house }) }];
    if (o.kind === 'fireplace') return [{ x: o.x, y: o.y, who: 'Fire', lines: [], kind: 'fire' }];
    if (o.kind === 'stone') return [{ x: o.x, y: o.y, who: 'The Old Stone', lines: [], kind: 'stone' }];
    if (o.kind === 'chest') return [{ x: o.x, y: o.y, who: 'Your stash', lines: [], kind: 'chest' }];
    if (o.kind === 'workbench') return [{ x: o.x, y: o.y, who: 'Workbench', lines: [], kind: 'bench' }];
    if (o.kind === 'cache') return [{ x: o.x, y: o.y, who: 'Crate', lines: [], kind: 'cache' }];
    // What the town's ledger says is the town as it stands (town.ts): read out as you open it.
    if (o.kind === 'ledger') return [{ x: o.x, y: o.y, who: 'The town ledger', lines: [], kind: 'ledger' }];
    if (o.kind === 'teleport') return [{ x: o.x, y: o.y, who: TELEPORT, lines: [], kind: 'teleport' }];
    // Furniture in your home reads from any side of it; the rug is walked over, not faced.
    if (o.kind === 'comfort' && o.what !== 'rug') return objectTiles(o).map(([x, y]): Talker => ({ x, y, who: '', lines: [], kind: 'comfort', what: o.what }));
    if (o.kind === 'lostfound') return [{ x: o.x, y: o.y, who: LOST_AND_FOUND, lines: LOST_AND_FOUND_LINES, kind: 'lostfound' }];
    if (o.kind === 'slab') return [{ x: o.x, y: o.y, who: SLAB, lines: [], kind: 'slab' }];
    // A fire lookout is climbed, and its lamp fed, facing its ladder from its foot.
    if (o.kind === 'lookout') return [{ ...ladderOf(o), who: 'Lookout', lines: [], kind: 'lookout' }];
    // A place being mended is given to, and read, facing it: any plank of a footbridge, broken or whole, or its street light.
    const works = o.kind === 'footbridge' ? o.id : o.kind === 'lamp' ? o.works : undefined, def = works ? items.works.get(works) : undefined;
    if (works && def) return objectTiles(o).map(([x, y]): Talker => ({ x, y, who: worksWho(def), lines: [], kind: 'works', works }));
    return [];
  })];
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** "12 minutes", "under a minute". */
export function minutes(seconds: number): string {
  if (seconds < 60) return 'under a minute';
  const m = Math.round(seconds / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
}

/** Agnes, the dam keeper, on when the reservoir goes down next, or how long it stays down (`warn`: the rule's warning, in seconds). */
export function agnesOnTheWater(v: DrawdownView, warn: number): string {
  if (v.phase === 'full') return v.left < 60 ? 'The water goes down any moment now. Watch the bed.' : `The water goes down in about ${minutes(v.left)}.`;
  // While it is down, `left` runs to the warning: the water is back that much later.
  if (v.phase === 'down') return `It's down now. Mind the time: it comes back in ${minutes(v.left + warn)}.`;
  return `It's coming back now, in ${seconds(v.left)}. Get off the bed.`;
}

/** "25 seconds", "1 second": counted up, so the last part of a second still counts. */
export function seconds(s: number): string {
  const n = Math.ceil(s);
  return `${n} second${n === 1 ? '' : 's'}`;
}

/** What floats over your head as stashing earns: "+24 XP", and the part the cup of rest paid, "+24 XP (12 rested)". */
export function xpFloat(gained: number, fromRest = 0): string {
  return fromRest > 0 ? `+${gained} XP (${fromRest} rested)` : `+${gained} XP`;
}

/** News from the world for the interface to announce (status.ts, newsBanner). A feat's is the rank just reached. */
export type News =
  | { kind: 'feat'; id: string; rank: number } | { kind: 'live'; fresh: number } | { kind: 'surge'; view: SurgeView } | { kind: 'storm'; view: StormView } | { kind: 'stone'; view: StoneView }
  /** The night over your map turned into an aurora: lights in the sky. */
  | { kind: 'aurora' }
  /** The season turned (as the week did); `frozen`: where water freezes, named, for the winter's word. */
  | { kind: 'season'; season: Season; frozen: string[] }
  /**
   * The Long Night began (`on`; `bonus`: with its faster regrowth), or dawn ended it (`bonus`: the lodge's
   * fire held, so the next one keeps it).
   */
  | { kind: 'longNight'; on: boolean; bonus: boolean }
  /** A new level: where it stands now, and the level before (one stash can climb several). */
  | { kind: 'level'; progress: ProgressView; from: number }
  /** You arrive rested: time away filled the cup, which holds `xp` of doubled stashing now. */
  | { kind: 'rested'; xp: number }
  /** Past level 20, stashing earned `earned` merits (merits.ts), and `left` are to spend now. */
  | { kind: 'merit'; earned: number; left: number }
  /** A new day's conditions, by name. */
  | { kind: 'conditions'; names: string[] }
  /** Someone (`id`, you too) sang a call from tile x,y, heard `at` (our clock): the ears announce it (soundscape.ts), nothing is shown but the note over their head. */
  | { kind: 'call'; id: string; call: CallKind; x: number; y: number; at: number }
  | { kind: 'chapter'; chapter: Chapter }
  /** A page of your field notes opened, or a blank on one filled in. */
  | { kind: 'page'; page: Page } | { kind: 'blank'; page: Page; blank: Blank }
  /** You read a note someone left for the first time (no banner: you just read it), or a keepsake came home: `of` how many there are, `home` of them home now. */
  | { kind: 'note'; id: string } | { kind: 'keepsake'; item: string; home: number; of: number }
  /** Someone (or you) is the first on the server to find a secret (firsts.ts): the banner's one line, for everyone online. */
  | { kind: 'first'; text: string }
  /** A parcel came into your chest; the welcome parcel also names the outfits signing in gave you (their ids). */
  | { kind: 'parcel'; parcel: ParcelView; outfits?: string[] }
  /** You stood by your own fire long enough: cozy, for this many minutes once you leave it (comfort.ts). */
  | { kind: 'cozy'; minutes: number }
  /** Your lodestone tugs (lodestone.ts): a shard lies near. It never says where. */
  | { kind: 'tug' }
  /** Steps that are not yours, behind you (unease.ts): how many, and on what ground. For the ears alone. */
  | { kind: 'stalk'; steps: number; ground: TileKind | undefined }
  /**
   * A look you bought in the shop is yours now (Stripe told the server it is paid), as it goes in a sentence;
   * `said`: the text box said so already, coming back from Stripe's page, so only the wardrobe's dot is news.
   */
  | { kind: 'bought'; noun: string; plural: boolean; said: boolean }
  /** The town came to a milestone or a work of its ledger (town.ts): everyone online reads it; `pop` is how many live in town now. */
  | { kind: 'town'; id: string; pop: number }
  /** Someone told you a scene (story.ts): no banner (the box just told it), a dot on the journal's People. */
  | { kind: 'scene'; id: string }
  /** On a map whose lake draws down: the water drew back ('down'), is coming back in `left` seconds ('warn'), or came back over you and carried you ashore ('carried'). */
  | { kind: 'lake'; phase: 'down' | 'warn' | 'carried'; left: number };

/** No story: a game that was given none (and a copy of the game without content/story.json). */
const NO_STORY: StoryData = { version: 0, chapters: [] };
/** No field notes, the same way. */
const NO_NOTEBOOK: NotebookData = { version: 0, pages: [] };

/** Lines of chat a session keeps to scroll back through. */
export const CHAT_LOG = 100;

/** What a `refused` can answer among friends: the friends panel says why. */
const SOCIAL_ACTIONS = new Set<RefusedAction>(['befriend', 'answer', 'unfriend', 'tell', 'read', 'block', 'report', 'requests', 'tradeRequests', 'friends']);
/** What a `refused` can answer about a trade: the text box says why, naming whoever it is with. */
const TRADE_ACTIONS = new Set<RefusedAction>(['tradeOpen', 'tradeAnswer', 'tradeOffer', 'tradeReady', 'tradeConfirm', 'tradeCancel']);
/** What asks first in the text box (ask.ts): a no from the server is said in the same box. */
const ASKED_FIRST = new Set<RefusedAction>(['feed', 'cook', 'use', 'discard', 'craft', 'mend', 'upgrade', 'open', 'thank', 'cacheLeave', 'buy', 'visit', 'build', 'board', 'teleport', 'checkout', 'rescue', 'carry', 'handIn', 'swap', 'give', 'bring']);
/** If the server has not moved you this long after the teleport was sent, the trip is off: you are shown where you stand. */
const BEAM_WAIT_MS = 4000;
/** Changed in the wardrobe, whose panel would hide anything said over your head: a no is said in the box, which stands above it. */
const WARDROBE = new Set<RefusedAction>(['outfit', 'pattern', 'badge']);

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
  /** Calls heard on this map, for the note over each caller's head: whose, which, from what tile, and when (our clock), for CALL_NOTE_S. */
  calls: Array<{ n: number; who: string; kind: CallKind; x: number; y: number; at: number }> = [];
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
  /** The fires on this map by "x,y": fuel left as told, and when (null: tended, it never goes out), and who fed it last. */
  fires = new Map<string, { left: number | null; at: number; fed: PersonView[] }>();
  /** Marks painted on this map, by id; `markChanges` counts changes, like lootChanges. */
  marks = new Map<number, MarkView>();
  markChanges = 0;
  /** Creatures on this map (watchers, skulkers), animated like players. */
  creatures = new Map<number, Creature>();
  /** Flares burning on this map, until when (our clock). */
  flares: Array<{ x: number; y: number; until: number }> = [];
  /**
   * The fire lookouts' lamps on this map, by their lookout's corner (lampKey): how long each burnt on, as
   * told, and when (lookout.ts). Keyed by a number, so the view asking every frame makes no string.
   */
  lamps = new Map<number, { left: number; at: number }>();
  /** Every place mended together in the world, as the server last told it (works.ts). */
  works = new Map<string, WorksView>();
  /** The fire lookouts on this map (their corners): whose beams may be over you. */
  private lookouts: Array<{ x: number; y: number }> = [];
  /** The lookout you are up (its corner), and until when (our clock); null down on the ground. */
  up: { x: number; y: number; until: number } | null = null;
  /** Who on this map is up a lookout (you too): they are drawn up in its cab. */
  ups = new Set<string>();
  /** How far the view is pulled back: 1 down on the ground, easing to LOOKOUT_ZOOM up a lookout. */
  zoom = 1;
  /** This map's surge clock as told, and when (null: it never surges). */
  surge: { view: SurgeView; at: number } | null = null;
  /** This map's storm clock as told, and when (null: it never storms). */
  storm: { view: StormView; at: number } | null = null;
  /** The weather over your map, as the server last said it: your region's (a room, the map outside its door). Some notes need it to be read. */
  weather: Weather = 'rain';
  /** The season as the server last said it, and when (our clock): it counts down from there. */
  season: { view: SeasonView; at: number } = { view: { season: 'spring', left: 0 }, at: 0 };
  /** The Long Night as the server last said it. */
  longNight: LongNightView = { on: false, bonus: true, out: false };
  /** Flashes on this map, until when they are over (our clock). */
  flashes: Array<{ x: number; y: number; kind: FlashKind; until: number }> = [];
  /** How wet you are, your load and whether something clings to you, as told and when. */
  body: { view: BodyView; at: number } = { view: { wet: 0, wetRate: 0, load: 0, hitched: false, worn: {} }, at: 0 };
  /**
   * How uneasy you are, as the server last told it (unease.ts): 0 to UNEASE_LEVELS. No bar shows it: the
   * screen's edges, steps that are not yours and, where watchers roam, something at the edge of the fog.
   */
  unease = 0;
  /** Someone's steps, glimpsed while you are alone out in the wilds (glimpses.ts): the walk under way, if any. */
  readonly passing = new Passing();
  /** Footprints in the snow (glimpses.ts): where, which way the step went and when (ms, as `now`), oldest first. */
  private prints: Array<{ x: number; y: number; dir: Dir; at: number }> = [];
  /** Counts every change to the footprints, so the view lays them again only then. */
  printChanges = 0;
  /** The Old Stone in town, and your counts toward feats (each feat's rank follows from its count). */
  stone: StoneView = { charge: 0, need: 0, awake: false, left: 0 };
  stats: Stats = {};
  /** Counts every time the counts are told, so the open status panel shows them at once. */
  statsChanges = 0;
  /** What the woods are like today and this week (sky.ts), as the server said. */
  conditions: ConditionsView = { today: [], week: null, next: null };
  /** Your tools (item ids), in the order you got them: as the welcome said, then whole again whenever you get one. Replaced, never changed in place. */
  tools: string[] = [];
  /** Of the torn maps among your tools, the pieces you found (quarters, items.ts quarterOf): a map not here is whole. Replaced with the tools. */
  charts: Record<string, number[]> = {};
  /**
   * The furniture you made for your home (comfort.ts), as its room last told it (item ids): told only in
   * there, so the workbench and the room know what stands in its places. `furnitureChanges` counts changes.
   */
  furniture: string[] = [];
  furnitureChanges = 0;
  /**
   * In a friend's home (the welcome or zone said, `visit`): whose it is, how far its house is built, the
   * furniture they made and what their trophy shelf shows; null anywhere else. The house and the room are
   * drawn from it instead of your own. Its changes count in furnitureChanges too.
   */
  visit: { name: string; house: number; furniture: string[]; trophies: string[] } | null = null;
  /**
   * How far your own house is built (house.ts): in the welcome, then whenever it is built up. `houseChanges`
   * counts changes of the house you are in (yours, or the friend's you visit), for its drawing.
   */
  house = 1;
  houseChanges = 0;
  /**
   * Nobody may visit your home (the setting below friend and trade requests), as the server last said: in the
   * welcome, and whenever you change it. It counts in socialChanges, as the friends panel shows it.
   */
  visitsOff = false;
  /**
   * A new player's first step to take now (1 to FIRST_STEPS: roadmap/first-steps.md), as the server said, on
   * the status panel; null when there is none. `firstStepsChanges` counts changes.
   */
  firstSteps: number | null = null;
  firstStepsChanges = 0;
  /**
   * NAPO's teleport using you (beam.ts): going, from YES until the server moves you ('out', `sent` once `go`,
   * the teleport or a visit, is asked for; `pad` the one you step onto, or your own tile for a visit), then
   * arriving by its twin ('in', `pad` the one you arrive at). `t` is seconds into it, counted in frames (a frame
   * that took long, building the new map, skips none of it). Nobody walks meanwhile. Null the rest of the time.
   */
  beam: { phase: 'out' | 'in'; t: number; pad: { x: number; y: number }; go?: ClientMsg; sent?: number } | null = null;
  /** Where others vanished or appeared at a teleport, for the view to pop (takePops). */
  private pops: Array<{ x: number; y: number }> = [];
  /**
   * What your tools open (TileMap.walkable): the culvert in waders, the shed's door with bolt cutters. Your
   * steps are predicted, and your paths found, with it, as the server checks them.
   */
  pass: Pass = new Set();
  /** Your XP and level. */
  progress: ProgressView = { xp: 0, level: 1, from: 0, to: null, maxEnergy: 100 };
  /** The id of the chapter of the story you are in, as the server said ('' until its welcome). */
  chapter = '';
  /** Counts every chapter reached, so the journal is redrawn only when it changed. */
  storyChanges = 0;
  /** Your field notes, as the server said: the pages opened and the blanks filled. Replaced whole on every change. */
  fieldNotes: NotebookState = emptyNotebook();
  /** Pages opened since the field notes were last looked at: the journal marks them. */
  freshPages = new Set<string>();
  /** Counts every change to the field notes (and to which pages are fresh), so they are redrawn only then. */
  notebookChanges = 0;
  /** The notes people left that you read (notes.ts), by id, in the order you read them. Replaced whole on every change. */
  notesRead: string[] = [];
  /** The lamp with no wires is out (the dead line): as the server says, false again with each welcome. */
  lampOut = false;
  /** Notes read since the journal's notes were last looked at: it marks them. */
  freshNotes = new Set<string>();
  /** The keepsakes you brought home, by item id, in the order they came. Replaced whole on every change. */
  keepsakesHome: string[] = [];
  /** Counts every change to the notes read, the keepsakes home, which notes are fresh and who found them first, so the journal's notes are redrawn only then. */
  notesChanges = 0;
  /** Who found each secret found so far first (firsts.ts), by its key, as the server said. */
  firsts = new Map<string, FirstView>();
  /** Every note on the maps by id, for what a secret is called (firsts.ts): worked out the first time it is needed. */
  private notesById: ReturnType<typeof notesOf> | null = null;
  /** What the town has come to (town.ts), as the server said: the milestones reached, the works done, what was given to the rest. */
  town: TownView = noTown();
  /** Counts every change to the town, so what shows it is drawn again. */
  townChanges = 0;
  /** The maps the last change to the town changed (by id): the one you are on is drawn again. */
  townMaps = new Set<string>();
  /** Scenes told since the journal's People were last looked at (story.ts), by id. */
  freshScenes = new Set<string>();
  /** The world's clock (ms since the epoch, as the sky follows it) at our `now`: what follows the wall clock elsewhere (the storms over the wilds). */
  private sky = { now: 0, ms: 0 };
  /** The phase of the lake on the map you were on at the last update (its news comes when it changes), and which lake news this round already had. */
  private lake: { map: string; phase: DrawdownPhase } | null = null;
  private lakeSaid = { round: NaN, said: new Set<string>() };
  /** What waits for the box once someone's lines are done: a swap offered, something to give at the ledger. Each asks, or does nothing when it no longer holds. */
  private queued: Array<() => void> = [];
  /** The chest you opened (its tile) and what your stash holds, while it is open; null otherwise. */
  chest: { x: number; y: number; stash: BagSlot[] } | null = null;
  /** The workbench you opened and what your stash holds, while it is open. */
  bench: { x: number; y: number; stash: BagSlot[] } | null = null;
  /**
   * The crate you opened (its tile): what lies in it, the newest first, with each one's age as told at
   * `at`, and whether you left one thing and took one this visit; null while none is open.
   */
  cache: { x: number; y: number; items: CacheItemView[]; left: boolean; took: boolean; at: number } | null = null;
  /**
   * The notice board you read (board.ts): its tile, how the world stood as it said, and when that came
   * (our clock), while its panel is open; null otherwise. The panel reads it again now and then while open.
   */
  board: { x: number; y: number; view: BoardView; at: number } | null = null;
  /** The notice board last asked to be read, until it answers. */
  private boardAsked: { x: number; y: number } | null = null;
  /** Parcels that came since the chest was last opened: it says what came in them, once (takeParcels). */
  parcels: ParcelView[] = [];
  /** What your stash holds, as the server last told it (the welcome, and every chest and workbench after); null before. */
  stash: BagSlot[] | null = null;
  /** Your friends, requests and blocks as the server last told them (null until it has). */
  friends: FriendsMsg | null = null;
  /** Private messages this session, by the other player's id, oldest first; replaced whole on every change. */
  talks = new Map<string, TalkLine[]>();
  /** Where the next talk with each person takes up what they always say (linesInTurn), by their id: this session's. */
  private heard = new Map<string, number>();
  /** Friends whose messages you have not opened yet. */
  unread = new Set<string>();
  /** Whose card is open in the friends panel: their messages count as read while it is. */
  person: PersonView | null = null;
  /** The last friends action that did not go through, in words, for the panel. */
  socialNote: string | null = null;
  /** Counts every change to all of the above, so the panel is rebuilt only when something changed. */
  socialChanges = 0;
  /** Your trade as the server last told it (trade.ts); null while you are in none. */
  trade: TradeView | null = null;
  /** Your side of it as you last set it: it runs ahead of the server's answer, and every answer sets it again. */
  tradeMine: BagSlot[] = [];
  /** Counts every change to the trade, so its panel is drawn again only when something changed. */
  tradeChanges = 0;
  /**
   * What you heard said this session, oldest first, at most CHAT_LOG lines; replaced whole on every change.
   * Nothing said is kept anywhere. `system`: a line the game says about someone (they are down), not their words.
   */
  chat: Array<{ to: ChatTo; id: string; name: string; text: string; mine: boolean; system?: boolean }> = [];
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
  /** Who on this map glows after a flash (the afterglow quirk), until when (our clock). */
  afterglows = new Map<string, number>();
  /** Who on this map lies slumped, out of energy (rescue.ts): their figure lies there, and A at one gets them up. You too. */
  downs = new Set<string>();
  /** Who on this map owns a lantern (energy.ts, LANTERN): in a deep region it lights the ground around them. */
  lanterns = new Set<string>();
  /** You are down: when you collapse unless someone gets you up (our clock). Null while you are not. */
  slump: { until: number } | null = null;
  /** What everyone on this map wears, by player id (you too). */
  gear = new Map<string, Gear>();
  /** The outfit each player on this map wears over their gear, by player id (you too); none: their gear shows. */
  outfits = new Map<string, string>();
  /** The pattern on each jacket and the badge on each name tag on this map, by player id (you too); none: none worn (merits.ts). */
  patterns = new Map<string, string>();
  badges = new Map<string, string>();
  /** What you spent of your merits, and the looks you bought, as the server last told it; what you earned follows from your XP. */
  merits: MeritsView = { spent: 0, owned: [] };
  /** The shop, while the server says it is open: the currency of its prices and its terms of sale. Null: closed, no Shop tab. */
  shopOpen: ShopOpen | null = null;
  /** The looks you bought in the shop (paid, not refunded), as the server last told it. Replaced whole on every change. */
  shopOwned: string[] = [];
  /**
   * Where you came back from, from Stripe's page (main.ts reads it from the page's address): said in the
   * text box once the welcome comes, signed in, and, while the payment is being confirmed, when it is.
   */
  returning: ShopReturn | null = null;
  /** Goes to the payment page the server opened (main.ts: the browser leaves the game for it). None in tests. */
  goTo: ((url: string) => void) | null = null;
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
  private callN = 0;
  /** When this client last sent a call (our clock): the server takes one every CALL_EVERY_MS. */
  private calledAt = -Infinity;
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
  /** The way home as last worked out (wayHome), and where from: the map, your tile and the drain. */
  private wayHomeKey = '';
  private wayHomeAt: number | null = null;
  /** The word that it is time to turn back was said, since you last had well more than the way home takes. */
  private turnSaid = false;
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
  /** A workbench asked to open and not answered yet, and the card it is to open on (the first goal's), if any. */
  private benching: { x: number; y: number; at: number; card?: DetailRef } | null = null;
  /** The card the workbench that just opened is to show: taken once (takeBenchCard). */
  private benchCard: DetailRef | null = null;
  /** The card the first goal wants the workbench to open on once it walks you there, and until when (goToBench). */
  private wantCard: { card: DetailRef; until: number } | null = null;
  /** A crate asked to open and not answered yet. */
  private caching: { x: number; y: number; at: number } | null = null;
  /** When the server last emptied a bag that held something. */
  private emptiedAt = -Infinity;
  /** When to offer thanks (thanks.ts), whom you thanked today (UTC day `thankedDay`), and the thanks asked for, for the words of the answer. */
  private readonly offers = new Offers();
  private thankedToday = new Set<string>();
  private thankedDay = -1;
  private thanking: { id: string; name: string } | null = null;
  /** Whom you asked to get up, for the words of a no. */
  private rescuing: { id: string; name: string } | null = null;
  /** The server's wall clock at our `now` (the welcome says it): the UTC day turns by it. */
  private wall = { now: 0, ms: 0 };
  /** Letters from home (who thanked you while you were away, the one about home in its own garden), in the order they came, each until the text box is free to show it. */
  /** What the text box brings up by itself when it is free (idle): letters, and a new player's first wake. */
  private letters: { who: string; lines: string[] }[] = [];
  /** Whom you last asked to trade: a refusal names them (the trade is the server's to make). */
  private tradeWith: PersonView | null = null;
  /** You called off the trade with this player: what the server says of it until it has heard you is old news. */
  private callingOff: string | null = null;
  /** A friend's ask to trade, waiting for the text box to be free of a question or someone's lines. */
  private tradeAsk: PersonView | null = null;
  /** A lodestone you wear (a quirk): when it tugs. */
  private readonly lodestone = new Lodestone();
  /** Uneasy out in the wilds: when steps that are not yours sound behind you. */
  private readonly stalker = new Stalker();
  /** The padlocked door you last walked into, so pushing against it says so once, not every frame. */
  private bumped: string | null = null;
  /** The lookout whose lamp you said no to feeding: A climbs it now, until you step away from its foot. */
  private lampDeclined: string | null = null;

  constructor(
    private readonly maps: Maps, private readonly send: (msg: ClientMsg) => void, readonly items: Items, readonly story: StoryData = NO_STORY, readonly notebook: NotebookData = NO_NOTEBOOK,
    /** What the shop sells (content/shop.json, bundled like the items): what a look bought or worn is. */
    readonly shop: ShopData = NO_SHOP,
  ) {
    this.current = maps.home();
    this.talkers = talkersOf(this.current, this.pass, this.items, this.nameOf);
  }

  /** A map's name by its id: what a door that stays shut is called in the text box. */
  private readonly nameOf = (id: string): string | undefined => this.maps.find(id)?.name;

  /** Your tools, whole: what they open, and the doors that say why they stay shut, follow them. */
  private setTools(tools: string[], charts: Record<string, number[]> | undefined) {
    this.tools = tools;
    if (charts) this.charts = charts;
    this.repass();
  }

  /**
   * What opens the tiles that open only for some, as the server has it: your tools, and every place mended
   * together that stands (works.ts: a footbridge is walked, and a street light shines, while it stands).
   */
  private repass() {
    this.pass = new Set([...this.tools, ...[...this.works.values()].filter(w => w.standing).map(w => w.id)]);
    this.talkers = talkersOf(this.current, this.pass, this.items, this.nameOf);
  }

  /**
   * Why the door next to you stays shut, when the server kept you from it: the padlocked door you face, or
   * that nearest you, by what it leads into, and what opens it.
   */
  private lockedText(): { who: string; text: string } {
    const me = this.me, [dx, dy] = me ? DIR_VEC[me.dir] : [0, 0];
    const near = me ? [[me.tx + dx, me.ty + dy], [me.tx, me.ty - 1], [me.tx, me.ty + 1], [me.tx - 1, me.ty], [me.tx + 1, me.ty]] as const : [];
    const at = near.find(([x, y]) => this.map.exitAt(x, y) && this.map.needs(x, y) !== undefined);
    const lock = at && this.map.needs(at[0], at[1]), into = at && this.map.exitAt(at[0], at[1])?.to;
    return { who: (into && this.nameOf(into)) ?? 'Door', text: padlocked(lock ? this.items.get(lock) : undefined) };
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

  /**
   * About what the walk home takes from where you stand (shared energy.ts, wayHomeCost), out in the wilds, and
   * whether it is time to turn back: your energy is down to little more than that. Null anywhere else. Worked
   * out again only when your tile or the drain changes; the first time it is time, a word says so over your
   * head, and not again until you have well more than the way home takes (or you are home).
   */
  wayHome(now: number): { cost: number; turn: boolean } | null {
    const me = this.me, e = this.energy(now), map = this.current;
    if (!me || !e || map.data.kind !== 'wilds') {
      this.turnSaid = false;
      return null;
    }
    const key = `${map.data.id}:${me.tx},${me.ty}:${e.rate.toFixed(3)}`;
    if (key !== this.wayHomeKey) {
      this.wayHomeKey = key;
      this.wayHomeAt = wayHomeCost(map, me.tx, me.ty, e.rate, id => { const d = this.maps.find(id); return d && this.maps.get({ id, version: d.version }); }, this.stepMs);
    }
    const cost = this.wayHomeAt;
    if (cost === null) return null;
    const turn = timeToTurn(e.value, cost);
    if (turn && !this.turnSaid) {
      this.turnSaid = true;
      this.murmur(TURN_BACK);
    } else if (!turn && e.value > cost * 1.6 + 12) this.turnSaid = false;
    return { cost, turn };
  }

  /**
   * Your body right now: wetness counted forward at its rate; time by your own fire counted up, and cozy
   * counted down, but for while it holds in full by the fire (comfort.ts).
   */
  bodyNow(now: number): BodyView {
    const b = this.body.view;
    if (!this.online) return b;
    const dt = Math.max(0, now - this.body.at) / 1000, held = (b.fireside ?? 0) >= COZY_AFTER_S;
    const cozy = b.cozy === undefined ? undefined : held ? b.cozy : b.cozy - dt;
    return {
      ...b, wet: Math.min(1, Math.max(0, b.wet + b.wetRate * dt)),
      cozy: cozy !== undefined && cozy > 0 ? cozy : undefined, fireside: b.fireside === undefined ? undefined : b.fireside + dt,
    };
  }

  /** What stands in your home now, as its room told it. */
  private setFurniture(furniture: readonly string[]) {
    if (furniture.join() === this.furniture.join()) return;
    this.furniture = [...furniture];
    this.furnitureChanges++;
  }

  /** The home you are in, as the welcome or a zone told it: your own (its furniture), a friend's (`visit`), or none. */
  private setRoom(furniture: readonly string[] | undefined, visit: VisitView | undefined) {
    if (visit) {
      this.visit = { name: visit.name, house: visit.house, furniture: [...furniture ?? []], trophies: [...visit.trophies] };
      this.furnitureChanges++;
      this.houseChanges++;
      return;
    }
    if (this.visit) {
      this.visit = null;
      this.furnitureChanges++;
      this.houseChanges++;
    }
    if (furniture) this.setFurniture(furniture);
  }

  /** What stands in the places of the home you are in: a friend's while you visit, else your own. */
  roomFurniture(): readonly string[] {
    return this.visit?.furniture ?? this.furniture;
  }

  /** What stands on the trophy shelf of the home you are in: the friend's (the server said), or what your own stash holds, one of each. */
  trophies() {
    if (this.visit) return this.visit.trophies.filter(id => this.items.byId.has(id)).map(id => this.items.get(id));
    return trophiesIn(this.stash ?? [], id => this.items.get(id));
  }

  /** How far the house of the home you are in is built (house.ts): the friend's while you visit, else yours. */
  houseHere(): number {
    return this.visit?.house ?? this.house;
  }

  /**
   * What the place you are in is called, for the banner as you arrive: a friend's house by whose it is and what
   * it is built up to ("Bo's cabin"), their garden by whose it is; your own garden is yours.
   */
  placeName(): string {
    const d = this.current.data;
    if (!d.private) return d.name;
    const garden = d.kind === 'town';
    if (this.visit) return visitWho(this.visit.name, garden ? 'garden' : houseWord(this.visit.house, this.items.house));
    return garden ? YOUR_GARDEN : d.name;
  }

  /** The season right now, its time left counted down from the server's last word. */
  seasonNow(now: number): SeasonView {
    const s = this.season;
    return { season: s.view.season, left: Math.max(0, s.view.left - Math.max(0, now - s.at) / 1000) };
  }

  /** The season, as the server says it: in winter the water the maps mark as ice is walked on here too (TileMap.freeze), as on the server. */
  private setSeason(view: SeasonView, now: number, news: boolean) {
    const turned = view.season !== this.season.view.season;
    this.season = { view, at: now };
    this.maps.freeze(SEASONS[view.season].frozen);
    if (news && turned) this.news.push({ kind: 'season', season: view.season, frozen: this.maps.icy() });
  }

  /** The effects working on you right now (a hand warmer), counted down from the server's last report; none offline. */
  effectsNow(now: number): EffectView[] {
    return this.online ? effectsAfter(this.body.view.effects, Math.max(0, now - this.body.at) / 1000) : [];
  }

  /** Seconds of fuel the fire on tile x,y has left now; null for a tended fire, undefined where there is none. */
  fireLeft(x: number, y: number, now: number): number | null | undefined {
    const f = this.fires.get(`${x},${y}`);
    if (!f) return undefined;
    return f.left === null ? null : Math.max(0, f.left - Math.max(0, now - f.at) / 1000);
  }

  /** The server's wall clock at our `now` (ms since the epoch): a lookout's beam turns by it, as the server counts it. */
  wallNow(now: number): number {
    return this.wall.ms + (now - this.wall.now);
  }

  /** Seconds the lamp of the lookout whose corner is x,y burns on now (0: out), or undefined where there is none. */
  lampLeft(x: number, y: number, now: number): number | undefined {
    const l = this.lamps.get(lampKey(x, y));
    return l && Math.max(0, l.left - Math.max(0, now - l.at) / 1000);
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
    // A lookout's beam as it passes, or a street light mended together while it stands, keeps it off, as the server counts it.
    return inSurge(this.current, me.tx, me.ty, surgeFront(rule, this.current.deepest, s), this.beamOver(me.tx, me.ty, now) || this.current.lit(me.tx, me.ty, this.pass));
  }

  /** Whose lantern lights where you stand (lanternLights), by name, as the server counts it; null for nobody's. Never your own. */
  lanternOver(): string | null {
    const me = this.me;
    if (!me) return null;
    for (const p of this.players.values()) if (p.id !== me.id && this.lanterns.has(p.id) && lanternLights(this.current, me.tx, me.ty, { x: p.tx, y: p.ty })) return p.name;
    return null;
  }

  /** Is tile x,y under a burning lookout's beam at `now`? As the server counts it (lookout.ts): a surge does not reach you there. */
  beamOver(x: number, y: number, now: number): boolean {
    for (const o of this.lookouts) if ((this.lampLeft(o.x, o.y, now) ?? 0) > 0 && inBeam(o, x, y, this.wallNow(now))) return true;
    return false;
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
        // A map we do not have, or other items, another story or other field notes than the server's:
        // this client is out of date and about to reload, so it must not play. (A server from before the
        // field notes sends none: then there are none to keep.)
        if (!map || msg.items !== this.items.version || msg.story.version !== this.story.version || (msg.notebook && msg.notebook.version !== this.notebook.version)
          || (msg.shop && msg.shop.version !== this.shop.version)) {
          this.disconnected(now);
          break;
        }
        // The town first: who stands where on the map you arrive on follows it.
        this.applyTown(msg.town ?? noTown(), false);
        this.sky = { now, ms: msg.clock ?? msg.serverTime };
        // Someone else now (the account's own character after its guest, say): nothing of theirs stays open.
        const someoneElse = msg.you !== this.meId;
        this.meId = msg.you;
        this.online = true;
        this.guest = msg.guest === true;
        this.stepMs = msg.stepMs;
        this.enter(map, msg.players, msg.finds, msg.drops, someoneElse);
        this.setPrints(msg.prints, now);
        this.visitsOff = msg.visitsOff === true;
        this.socialChanges++;
        this.house = msg.house;
        this.houseChanges++;
        this.firstSteps = msg.firstSteps ?? null;
        this.firstStepsChanges++;
        this.scene(msg, now);
        this.weather = msg.weather;
        this.setSeason(msg.season, now, false);
        this.longNight = msg.longNight;
        this.bag = msg.bag;
        this.bagAt = now;
        this.stash = msg.stash ?? null;
        this.lastEnergy = { view: msg.energy, at: now };
        this.body = { view: msg.body, at: now };
        // Nobody comes into the game uneasy: the server starts everyone at none.
        this.unease = 0;
        this.stone = msg.stone;
        this.conditions = msg.conditions;
        this.stats = msg.stats;
        this.statsChanges++;
        this.progress = msg.progress;
        this.merits = msg.merits ?? { spent: 0, owned: [] };
        // A server from before the shop says nothing of it: closed, nothing bought.
        this.shopOpen = msg.shop?.open ?? null;
        this.shopOwned = [...msg.shop?.owned ?? []];
        // Time away worth a word: stashing counts double for a while, and the arrival says so.
        if ((msg.restedAway ?? 0) >= RESTED_NOTICE && (msg.progress.rested ?? 0) > 0) this.news.push({ kind: 'rested', xp: msg.progress.rested! });
        this.works = new Map((msg.works ?? []).map(w => [w.id, w]));
        this.setTools(msg.tools, msg.charts ?? {});
        this.chapter = msg.story.chapter;
        this.storyChanges++;
        this.setRoom(msg.furniture, msg.visit);
        this.wall = { now, ms: msg.serverTime };
        this.thankedDay = utcDay(msg.serverTime);
        this.thankedToday = new Set(msg.thanked ?? []);
        this.fieldNotes = { pages: [...msg.notebook?.pages ?? []], blanks: [...msg.notebook?.blanks ?? []] };
        this.notebookChanges++;
        this.notesRead = [...msg.notes ?? []];
        this.lampOut = false;
        this.maps.lampOut(false);
        this.keepsakesHome = [...msg.keepsakes ?? []];
        this.firsts = new Map((msg.firsts ?? []).map(f => [f.secret, f]));
        this.notesChanges++;
        this.settleReturn();
        break;
      }
      case 'zone': {
        const map = this.maps.get(msg.map);
        if (!map) { this.disconnected(now); break; }
        const old = this.me;
        this.enter(map, msg.players, msg.finds, msg.drops);
        this.setPrints(msg.prints, now);
        this.scene(msg, now);
        // The weather over the new map: its region's own rain (a room, the map outside its door).
        this.weather = msg.weather;
        this.stats = msg.stats;
        this.statsChanges++;
        this.setRoom(msg.furniture, msg.visit);
        this.dialog = null; this.marker = null; this.floats = []; this.calls = [];
        // Another map, or home after a collapse: whatever window there was is over.
        this.slump = null;
        // Where the server put us wins over the list, and we stay ourselves even if the list left us out.
        const me = this.me ?? (old ? { ...old } : undefined);
        if (me) {
          me.tx = me.x = msg.x; me.ty = me.y = msg.y; me.dir = msg.dir; me.anim = null; me.turnT = 0;
          this.players.set(me.id, me);
        }
        // Moved by the teleport we asked for (or a visit, by the one in a friend's home): we arrive at its twin,
        // in front of which the server put us.
        const pad = this.beam?.phase === 'out' && this.beam.sent !== undefined ? padFor(map.data.objects, msg.x, msg.y) : undefined;
        this.beam = pad ? { phase: 'in', t: 0, pad } : null;
        break;
      }
      case 'energy': {
        // Cozy just now (it was not, as last told): the news says for how long. Worn off away from your fire: a word over your head.
        // Not during a new player's first steps: they wake up by the fire, and one thing at a time (DESIGN.md).
        const was = this.body.view.cozy ?? 0, is = msg.body.cozy ?? 0;
        if (!was && is > 0 && this.firstSteps === null) this.news.push({ kind: 'cozy', minutes: Math.round(is / 60) });
        else if (was > 0 && !is && msg.body.fireside === undefined) this.murmur('The warmth of home wears off');
        // The trip is over (home again, or a collapse), and what you ate for it with it.
        if (this.body.view.meals?.length && !msg.body.meals?.length) this.murmur('What you ate has worn off');
        this.lastEnergy = { view: msg.energy, at: now };
        this.body = { view: msg.body, at: now };
        break;
      }
      case 'weather':
        if (msg.weather === 'aurora' && this.weather !== 'aurora') this.news.push({ kind: 'aurora' });
        this.weather = msg.weather;
        break;
      case 'season':
        this.setSeason(msg.season, now, true);
        break;
      case 'longNight':
        // It began, or dawn came: said once, in a banner. The fire going out in the night is the notice board's and Walt's to say.
        if (msg.night.on !== this.longNight.on) this.news.push({ kind: 'longNight', on: msg.night.on, bonus: msg.night.bonus });
        this.longNight = msg.night;
        break;
      case 'fire':
        this.fires.set(`${msg.fire.x},${msg.fire.y}`, { left: msg.fire.left, at: now, fed: msg.fire.fed ?? [] });
        break;
      case 'house':
        // The house you are in was built up: a friend's while you visit (they built it as you looked round), else yours.
        if (this.visit) this.visit = { ...this.visit, house: msg.level };
        else this.house = msg.level;
        this.houseChanges++;
        break;
      case 'visitsOff':
        this.visitsOff = msg.off;
        this.socialChanges++;
        break;
      case 'visited':
        this.inform(YOUR_HOME, visitedText(msg.name));
        break;
      case 'firstSteps':
        // The last one taken: the text box says the basics are done, once.
        if (msg.step === null && this.firstSteps !== null) this.inform(FIRST_STEPS_TITLE, FIRST_STEPS_DONE);
        this.firstSteps = msg.step;
        this.firstStepsChanges++;
        break;
      case 'homeLetter':
        this.letters.push({ who: 'Letter', lines: [...HOME_LETTER] });
        break;
      case 'trip': {
        // How the trip went comes first, before any letter home: one page, once the box is free (idle).
        const card = tripCard(msg.trip, id => {
          const d = this.maps.find(id);
          return d && this.maps.get({ id, version: d.version });
        });
        this.letters.unshift({ who: card.title, lines: [card.lines.join('\n')] });
        break;
      }
      case 'lamp':
        this.lamps.set(lampKey(msg.lamp.x, msg.lamp.y), { left: msg.lamp.left, at: now });
        break;
      case 'works': {
        const was = this.works.get(msg.works.id);
        this.works.set(msg.works.id, msg.works);
        // Stood again, or broke: its footbridge opens or closes for us from the next step, as for everyone.
        if (was?.standing !== msg.works.standing) this.repass();
        break;
      }
      case 'up': {
        if (msg.on) this.ups.add(msg.id);
        else this.ups.delete(msg.id);
        if (msg.id !== this.meId) break;
        const me = this.me, o = me && lookoutAtFoot(this.current.data.objects, me.tx, me.ty);
        this.up = msg.on && o ? { x: o.x, y: o.y, until: now + (msg.left ?? LOOKOUT_UP_S) * 1000 } : null;
        this.path = []; this.goal = null;
        // Up there it says where you are, how long you may stay and how you come down.
        if (this.up) this.inform('Lookout', upText(msg.left ?? LOOKOUT_UP_S));
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
        const lost = msg.lost && pieceName(this.items.get(msg.lost), msg.level).toLowerCase();
        if (msg.by === 'skulker') {
          // Someone else's bundle is not yours: it lies in your pile all the same, to be picked up again.
          this.floatOverMe(lost ? `It caught you. You dropped ${msg.lost === BUNDLE ? 'the' : 'your'} ${lost}` : 'It caught you', EERIE, 1);
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
      case 'unease':
        this.unease = Math.min(UNEASE_LEVELS, Math.max(0, Math.round(msg.level) || 0));
        break;
      case 'glimpse':
        this.passing.begin(msg.glimpse, now);
        break;
      case 'slump':
        // You are down: nobody walks, nothing is asked, and the countdown shows how long someone has to come.
        this.slump = { until: now + msg.left * 1000 };
        this.path = []; this.goal = null; this.marker = null;
        if (this.question) { this.question = null; this.repeat.release(); this.boxChanges++; }
        break;
      case 'down':
        if (msg.on) this.downs.add(msg.id);
        else this.downs.delete(msg.id);
        if (!msg.on && msg.id === this.meId) this.slump = null;
        break;
      case 'slumped': {
        // A line in local chat, by landmark: never where exactly.
        const mine = msg.id === this.meId;
        this.chat = [...this.chat, { to: 'local' as const, id: msg.id, name: msg.name, text: downLine(msg.name, msg.where, mine), mine, system: true }].slice(-CHAT_LOG);
        if (!mine) this.chatNews = true;
        this.chatChanges++;
        break;
      }
      case 'raised':
        this.slump = null;
        if (this.meId) this.downs.delete(this.meId);
        if (msg.thanked) this.thankedToday.add(msg.by.id);
        this.inform(msg.by.name, raisedText(msg.by.name, msg.thanked));
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
      case 'board': {
        // An answer to a reading while the panel was closed again (walked away) opens nothing.
        const at = this.boardAsked ?? this.board;
        if (!at) break;
        this.board = { x: at.x, y: at.y, view: msg.board, at: now };
        this.boardAsked = null;
        break;
      }
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
      case 'page': {
        if (this.fieldNotes.pages.includes(msg.id)) break;
        this.fieldNotes = { ...this.fieldNotes, pages: [...this.fieldNotes.pages, msg.id] };
        this.freshPages.add(msg.id);
        this.notebookChanges++;
        const page = this.notebook.pages.find(p => p.id === msg.id);
        if (page) this.news.push({ kind: 'page', page });
        break;
      }
      case 'blank': {
        if (this.fieldNotes.blanks.includes(msg.id)) break;
        this.fieldNotes = { ...this.fieldNotes, blanks: [...this.fieldNotes.blanks, msg.id] };
        this.notebookChanges++;
        const on = blankOf(this.notebook, msg.id);
        if (on) this.news.push({ kind: 'blank', ...on });
        break;
      }
      case 'lampOut': {
        // One told right after the welcome is how things stand, not something that happened: no banner for it.
        if (msg.out && !this.lampOut && !msg.known) this.news.push({ kind: 'first', text: 'The lamp with no wires went out.' });
        this.lampOut = msg.out;
        this.maps.lampOut(msg.out);
        break;
      }
      case 'noteRead': {
        if (this.notesRead.includes(msg.id)) break;
        this.notesRead = [...this.notesRead, msg.id];
        this.freshNotes.add(msg.id);
        this.notesChanges++;
        this.news.push({ kind: 'note', id: msg.id });
        break;
      }
      case 'first': {
        this.firsts.set(msg.first.secret, msg.first);
        this.notesChanges++;
        // What it is called comes from the maps and items this copy has; one it does not know goes unsaid.
        const title = secretTitle(msg.first.secret, (this.notesById ??= notesOf(this.maps.all())), this.items.byId);
        if (title) this.news.push({ kind: 'first', text: firstBanner(msg.first, title, msg.first.name === this.myName()) });
        break;
      }
      case 'town':
        this.applyTown(msg.town, true);
        break;
      case 'keepsake': {
        if (this.keepsakesHome.includes(msg.item)) break;
        this.keepsakesHome = [...this.keepsakesHome, msg.item];
        this.notesChanges++;
        this.news.push({ kind: 'keepsake', item: msg.item, home: this.keepsakesHome.length, of: this.items.keepsakes?.places.length ?? this.keepsakesHome.length });
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
      case 'outfit':
        if (msg.outfit) this.outfits.set(msg.id, msg.outfit);
        else this.outfits.delete(msg.id);
        break;
      case 'pattern':
        if (msg.pattern) this.patterns.set(msg.id, msg.pattern);
        else this.patterns.delete(msg.id);
        break;
      case 'badge':
        if (msg.badge) this.badges.set(msg.id, msg.badge);
        else this.badges.delete(msg.id);
        break;
      case 'merits':
        this.merits = msg.merits;
        break;
      case 'shop':
        this.boughtNow(msg.owned);
        break;
      case 'checkout': {
        // The payment page is Stripe's (or, playing on this machine, a fake Stripe's): the game leaves for it.
        const url = payPage(msg.url);
        if (!url) { this.inform('Shop', sentence(refusalText('shop_down', 'checkout'))); break; }
        this.inform('Shop', SHOP_OPENING);
        this.goTo?.(url);
        break;
      }
      case 'parcel': {
        this.parcels = [...this.parcels, msg.parcel];
        // The welcome parcel comes with the first sign-in, which opens the wardrobe too: its banner names what is new in it.
        const outfits = msg.parcel.weekday === null ? this.newOutfits() : [];
        this.news.push({ kind: 'parcel', parcel: msg.parcel, ...(outfits.length ? { outfits } : {}) });
        break;
      }
      case 'cache': {
        // The answer to opening it, or news of the one open (someone left or took something).
        const o = this.caching, c = this.cache, fresh = { x: msg.x, y: msg.y, items: msg.items, left: msg.left, took: msg.took, at: now };
        if (o && o.x === msg.x && o.y === msg.y && this.clock - o.at < ANSWER_WAIT_MS) { this.cache = fresh; this.caching = null; }
        else if (c && c.x === msg.x && c.y === msg.y) this.cache = fresh;
        break;
      }
      case 'bench': {
        this.stash = msg.stash;
        const b = this.benching;
        if (b && this.clock - b.at < ANSWER_WAIT_MS) { this.bench = { x: b.x, y: b.y, stash: msg.stash }; this.benchCard = b.card ?? null; this.benching = null; }
        else if (this.bench) this.bench = { ...this.bench, stash: msg.stash };
        break;
      }
      case 'did':
        if (msg.did.kind === 'thanked') this.thankedToday.add(msg.did.who);
        // It takes the place of the question just said yes to, which waited for it in the box.
        this.inform(didWho(msg.did, this.items, this.didContext()), didText(msg.did, this.items, this.didContext()));
        break;
      case 'thanked': {
        // Out in the wilds, over your head; anywhere else the text box says what it was for.
        if (msg.line) this.inform('Thanks', thankedLine(msg.name, thanksFor(msg.what, id => this.maps.find(id), this.items, msg.name)));
        else this.floatOverMe(thankedFloat(msg.name, msg.energy), GAIN);
        break;
      }
      case 'letter': {
        // What came back to the chest first: it is what matters most coming home.
        const find = (id: string) => this.maps.find(id);
        const lines = [...returnedLines(msg.returned ?? [], find), ...letterLines(msg.thanks, find, this.items)];
        if (lines.length) this.letters.push({ who: 'Letter', lines });
        break;
      }
      case 'returned': {
        const r = msg.returned, map = this.maps.find(r.map);
        this.inform(LOST_AND_FOUND, `${returnedLine(r.by, map ? where(map, r.x, r.y, id => this.maps.find(id)) : 'out there')} ${IN_YOUR_CHEST}`);
        break;
      }
      case 'progress':
        if (msg.gained > 0) this.floatOverMe(xpFloat(msg.gained, msg.fromRest), GAIN);
        if (msg.progress.level > this.progress.level) this.news.push({ kind: 'level', progress: msg.progress, from: this.progress.level });
        // Past level 20, what stashing earns counts toward merits: a new one is news.
        if (meritsOf(msg.progress.xp) > meritsOf(this.progress.xp)) {
          this.news.push({ kind: 'merit', earned: meritsOf(msg.progress.xp) - meritsOf(this.progress.xp), left: meritsLeft(msg.progress.xp, this.merits.spent) });
        }
        this.progress = msg.progress;
        break;
      case 'join': {
        // Come in front of a teleport: a pop there, as they leave one by the other.
        const pop = msg.player.id !== this.meId && popAt(this.current.data.objects, 'join', msg.player.x, msg.player.y);
        if (pop) this.pops.push(pop);
        this.players.set(msg.player.id, this.mover(msg.player));
        this.gear.set(msg.player.id, msg.player.gear ?? {});
        this.quirks.set(msg.player.id, msg.player.quirks ?? []);
        if (msg.player.outfit) this.outfits.set(msg.player.id, msg.player.outfit);
        else this.outfits.delete(msg.player.id);
        if (msg.player.pattern) this.patterns.set(msg.player.id, msg.player.pattern);
        else this.patterns.delete(msg.player.id);
        if (msg.player.badge) this.badges.set(msg.player.id, msg.player.badge);
        else this.badges.delete(msg.player.id);
        if (msg.player.live) this.live.add(msg.player.id);
        else this.live.delete(msg.player.id);
        if (msg.player.afterglow) this.afterglows.set(msg.player.id, now + msg.player.afterglow * 1000);
        else this.afterglows.delete(msg.player.id);
        if (msg.player.down) this.downs.add(msg.player.id);
        else this.downs.delete(msg.player.id);
        if (msg.player.lantern) this.lanterns.add(msg.player.id);
        else this.lanterns.delete(msg.player.id);
        if (msg.player.up) this.ups.add(msg.player.id);
        else this.ups.delete(msg.player.id);
        // A guest who signed in comes back in as someone who is not one.
        if (msg.player.guest) this.guests.add(msg.player.id);
        else this.guests.delete(msg.player.id);
        this.socialChanges++;
        break;
      }
      case 'glow':
        if (msg.on) this.live.add(msg.id);
        else this.live.delete(msg.id);
        break;
      case 'afterglow':
        if (msg.left > 0) this.afterglows.set(msg.id, now + msg.left * 1000);
        else this.afterglows.delete(msg.id);
        break;
      case 'leave': {
        // Gone from beside a teleport: everyone else sees a pop where they stood (the trip is theirs alone).
        const was = this.players.get(msg.id), pop = was && msg.id !== this.meId && popAt(this.current.data.objects, 'leave', was.tx, was.ty);
        if (pop) this.pops.push(pop);
        this.players.delete(msg.id);
        this.live.delete(msg.id);
        this.afterglows.delete(msg.id);
        this.downs.delete(msg.id);
        this.ups.delete(msg.id);
        this.lanterns.delete(msg.id);
        break;
      }
      case 'step': {
        const p = this.players.get(msg.id);
        if (!p) break;
        if (msg.id === this.meId) {
          // Our own step, confirmed. If the server put us somewhere else, trust the server.
          const i = this.pending.findIndex(s => s.seq === msg.seq);
          const predicted = this.pending[i];
          if (i >= 0) this.pending.splice(0, i + 1);
          if (!predicted || predicted.x !== msg.x || predicted.y !== msg.y) this.snap(p, msg.x, msg.y, msg.dir);
          this.print(msg.x, msg.y, msg.dir, now);
          break;
        }
        this.walk(p, msg.x, msg.y, msg.dir, now);
        this.print(msg.x, msg.y, msg.dir, now);
        break;
      }
      case 'face': {
        const p = this.players.get(msg.id);
        if (p && msg.id !== this.meId) { p.dir = msg.dir; p.turnT = 0.14; }
        break;
      }
      case 'reject': {
        const p = this.me;
        if (!p) break;
        // Moved by the server itself (seq 0, no step of ours) to the shore of a lake that draws down: it filled, and
        // the water carried you there. Whatever our own clock says (it may be a moment off); a refused step is not that.
        if (msg.seq === 0 && this.current.data.drawdown && !this.current.bedAt(msg.x, msg.y)) this.sayLake('carried', 0);
        this.snap(p, msg.x, msg.y, msg.dir);
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
        this.setTools(msg.tools, msg.charts);
        break;
      case 'furniture':
        // Made in the cabin you are in: its owner's, when you visit (your own furniture is only ever made at home).
        if (this.visit) {
          this.visit = { ...this.visit, furniture: [...msg.furniture] };
          this.furnitureChanges++;
        } else this.setFurniture(msg.furniture);
        break;
      case 'got': {
        this.picking = null;
        // A column over your head, in the order the server listed them, first on top. A tool is yours once: no count; a piece of a torn map says so.
        msg.items.forEach((s, i) => this.floatOverMe(`+${msg.from === 'tool' || msg.from === 'piece' ? '' : s.count} ${msg.from === 'piece' ? 'a piece of the ' : ''}${this.items.get(s.item).name}`, GAIN, msg.items.length - 1 - i));
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
      case 'trade':
        this.traded(msg.trade);
        break;
      case 'tradeOver':
        this.tradeOver(msg.with, msg.end);
        break;
      case 'called':
        // A hidden tab runs no frames to take them: what it heard long ago goes, so the lists stay short.
        this.calls = this.calls.filter(c => now - c.at < CALL_NOTE_S * 1000);
        this.news = this.news.filter(n => n.kind !== 'call' || now - n.at < CALL_FRESH_MS);
        this.calls.push({ n: ++this.callN, who: msg.id, kind: msg.kind, x: msg.x, y: msg.y, at: now });
        this.news.push({ kind: 'call', id: msg.id, call: msg.kind, x: msg.x, y: msg.y, at: now });
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
        // The teleport said no (someone moved, or it is gone): the trip is off, and you are shown where you stand.
        if (msg.action === 'teleport' || msg.action === 'visit') this.beam = null;
        if (SOCIAL_ACTIONS.has(msg.action)) { this.socialNote = refusalText(msg.reason, msg.action); this.socialChanges++; break; }
        if (TRADE_ACTIONS.has(msg.action)) { this.inform('Trade', tradeRefusal(msg.reason, this.trade?.with.name ?? this.tradeWith?.name ?? 'them')); break; }
        if (msg.action === 'say') { this.chatNote = refusalText(msg.reason, msg.action); this.chatChanges++; break; }
        // A step the server kept you from: a padlocked door, which says why in the box.
        if (msg.action === 'step') { if (msg.reason === 'padlocked') { const said = this.lockedText(); this.inform(said.who, said.text); } break; }
        if (msg.action === 'call') { this.murmur(refusalText(msg.reason, msg.action)); break; }
        // A thanks is answered with the helper's name: the one asked about.
        if (msg.action === 'thank' && this.thanking) {
          if (msg.reason === 'thanked') this.thankedToday.add(this.thanking.id);
          this.inform(this.note?.waiting ? this.note.who : '', thankRefusal(msg.reason, this.thanking.name));
          break;
        }
        // The slab answers in the box, in its own words.
        if (msg.action === 'slab') { this.inform(SLAB, slabRefusal(msg.reason)); break; }
        // So is getting someone up: by the name of whoever was down.
        if (msg.action === 'rescue' && this.rescuing) {
          this.inform(this.rescuing.name, rescueRefusal(msg.reason, this.rescuing.name));
          break;
        }
        // Down, whatever you tried: the box says why nothing happens.
        if (msg.reason === 'down') {
          if (msg.action === 'pick') this.picking = null;
          this.inform('', YOU_ARE_DOWN);
          break;
        }
        // Taking out of a crate asks nothing, but is answered in the box like what does.
        if (msg.action === 'cacheTake') { this.inform('Crate', sentence(refusalText(msg.reason, msg.action))); break; }
        // What was asked first is answered in the same box; the rest (picking up, the chest) over your head.
        if (ASKED_FIRST.has(msg.action)) {
          this.inform(this.note?.waiting ? this.note.who : '', sentence(refusalText(msg.reason, msg.action)));
          break;
        }
        // The wardrobe's panel would hide anything said over your head: the box stands above it.
        if (WARDROBE.has(msg.action)) { this.inform('Wardrobe', sentence(refusalText(msg.reason, msg.action))); break; }
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
    // Leaving while down is a collapse (the server's rule): the next welcome is at home.
    this.slump = null;
    this.pending = []; this.path = []; this.goal = null;
    // A trip half done is off: the next welcome says where you are.
    this.beam = null;
    // Answers to what we asked went with the connection, and what was being asked may no longer hold.
    this.picking = null; this.opening = null; this.chest = null; this.benching = null; this.bench = null; this.benchCard = null; this.caching = null; this.cache = null;
    // Coming back, the server has you down on the ground again.
    this.up = null;
    // A trade lasts only while both are online: the server calls it off.
    if (this.trade) this.tradeChanges++;
    this.trade = null; this.tradeMine = []; this.tradeAsk = null; this.callingOff = null;
    this.clearBox();
    this.offers.reset();
    this.passing.end();
    // Nobody tells us how energy changes while we are away, so the bar holds still until the next welcome.
    const e = this.energy(now);
    if (e) this.lastEnergy = { view: { ...e, rate: 0 }, at: now };
  }

  /**
   * Arrive on a map: its players, finds and piles replace the old ones, and plans made for the old
   * map are dropped; so is whatever was open (the chest, the workbench, the text box) on another map,
   * or for another player (`someoneElse`: a welcome for another character, on the same map).
   */
  private enter(map: TileMap, players: PlayerView[], finds: FindView[], drops: DropView[], someoneElse = false) {
    // A glimpse was of the place you were in, among the people there.
    this.passing.end();
    if (map !== this.current || someoneElse) {
      this.current = map;
      this.talkers = talkersOf(map, this.pass, this.items, this.nameOf);
      this.lookouts = map.data.objects.flatMap(o => (o.kind === 'lookout' ? [{ x: o.x, y: o.y }] : []));
      this.chest = null; this.opening = null; this.bench = null; this.benching = null; this.benchCard = null; this.cache = null; this.caching = null;
      this.dialog = null; this.marker = null; this.floats = []; this.calls = [];
      this.clearBox();
      this.offers.reset();
    }
    this.players.clear();
    for (const p of players) this.players.set(p.id, this.mover(p));
    this.guests = new Set(players.filter(p => p.guest).map(p => p.id));
    this.socialChanges++;
    this.gear = new Map(players.map(p => [p.id, p.gear ?? {}]));
    this.quirks = new Map(players.map(p => [p.id, p.quirks ?? []]));
    this.outfits = new Map(players.flatMap(p => (p.outfit ? [[p.id, p.outfit] as const] : [])));
    this.patterns = new Map(players.flatMap(p => (p.pattern ? [[p.id, p.pattern] as const] : [])));
    this.badges = new Map(players.flatMap(p => (p.badge ? [[p.id, p.badge] as const] : [])));
    this.live = new Set(players.filter(p => p.live).map(p => p.id));
    this.ups = new Set(players.filter(p => p.up).map(p => p.id));
    // Arriving anywhere, you stand on the ground.
    this.up = null;
    this.lampDeclined = null;
    this.afterglows = new Map(players.flatMap(p => (p.afterglow ? [[p.id, this.clock + p.afterglow * 1000] as const] : [])));
    this.downs = new Set(players.filter(p => p.down).map(p => p.id));
    this.lanterns = new Set(players.filter(p => p.lantern).map(p => p.id));
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
    msg: {
      fires: FireView[]; lamps?: LampView[]; marks: MarkView[]; creatures: CreatureView[]; flares: Array<{ x: number; y: number; left: number }>; flashes: FlashView[]; surge: SurgeView | null; storm: StormView | null;
    },
    now: number,
  ) {
    this.fires = new Map(msg.fires.map(f => [`${f.x},${f.y}`, { left: f.left, at: now, fed: f.fed ?? [] }]));
    this.lamps = new Map((msg.lamps ?? []).map(l => [lampKey(l.x, l.y), { left: l.left, at: now }]));
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
    if (this.beam) return;
    const me = this.me;
    // Down, you cannot act: the countdown on screen says as much. Up a lookout there is nothing within reach: B climbs down.
    if (!me || me.anim || this.slump || this.up) return;
    const act = this.action();
    if (!act) this.float('Nothing here', GREY, me.tx, me.ty);
    else if (act.kind === 'rescue') this.rescue(act.id, act.name);
    else if (act.kind === 'talk') this.meet(act.talker);
    else this.pick(act.x, act.y);
  }

  /**
   * A at someone down: asks to give them RESCUE_ENERGY of your energy ("Give Ana 20 of your energy? Ana
   * gets up with it, and you keep 44."), or says why you cannot: it takes more than that. YES sends it; the
   * box then says what it did, from the server's answer.
   */
  rescue(id: string, name: string) {
    if (!this.online || this.slump) return;
    const energy = this.energy(this.clock)?.value ?? 0;
    if (!canRescue(energy)) return this.inform(name, rescueTooTired(name, energy));
    const text = rescueQuestion(name, energy);
    this.ask({ who: name, text, yes: () => { this.rescuing = { id, name }; this.act(name, text, { t: 'rescue', who: id }); } });
  }

  /** Someone else lying down on tile x,y, if anyone is. */
  private downAt(x: number, y: number): Mover | undefined {
    for (const id of this.downs) {
      const p = this.players.get(id);
      if (p && id !== this.meId && p.tx === x && p.ty === y) return p;
    }
    return undefined;
  }

  /** How long you have while you are down, in seconds from `now`; null while you are not. */
  slumpLeft(now: number): number | null {
    return this.slump ? Math.max(0, (this.slump.until - now) / 1000) : null;
  }

  /** What A does at someone or something you face: talk, read the board, feed a fire or the Old Stone. */
  private meet(t: Talker) {
    if (t.note) {
      // What shows depends on the time (notes.ts): the server decides whether it counts as read, from the tile alone.
      this.openDialog({ ...t, lines: withTag(noteLines(t.note, this.weather, this.stormNow(this.clock)?.phase === 'storm'), poleTag(this.current.data, t.x, t.y), t.note.text) });
      if (this.online) this.send({ t: 'talk', x: t.x, y: t.y });
      return;
    }
    if (t.kind === 'talk') {
      // What people say comes in one order (storyLines, story.ts): the chapter's hint, what they say once
      // about what you did for the first time, a scene of theirs that opened (in place of the rest), else
      // what they have heard about the day (Mira: what the woods are like today; Walt: the lodge's fire on
      // the Long Night; Agnes: when the reservoir goes down; the sky), what they say about what you did or the town came to, then what they
      // always say, a few lines a talk (linesInTurn), taken up where the last talk left off. The server
      // hears who you talked to, or what you read.
      const word = t.id === 'mira' ? this.miraWord() : t.id === 'walt' ? this.waltWord() : t.id === 'agnes' ? this.agnesWord() : null;
      const person = t.story && 'talk' in t.story ? t.story.talk : undefined, key = t.id ?? `${t.x},${t.y}`;
      const ctx = { ...this.sayContext(), day: word ? [word] : [] };
      const scene = person ? sceneDue(this.story, person, this.stats, ctx) : undefined;
      const turn = linesInTurn(t.lines, this.heard.get(key) ?? 0);
      // A scene is told in place of the rest: what they always say waits where it was for the next talk.
      if (!scene) this.heard.set(key, turn.next);
      this.openDialog({ ...t, lines: person ? storyLines(this.story, this.chapter, person, turn.lines, this.stats, ctx) : word ? [word, ...turn.lines] : turn.lines });
      if (person) {
        // Said once: the server keeps it when it hears the talk, and so do we, for the next time you talk meanwhile.
        const told = toldAfter(this.story, person, this.stats), scenes = scenesAfter(this.story, person, this.stats, ctx);
        if (told !== (this.stats.told ?? 0) || scenes !== (this.stats.scenes ?? 0)) { this.stats = { ...this.stats, told, scenes }; this.statsChanges++; }
        if (scene) { this.freshScenes.add(scene.id); this.news.push({ kind: 'scene', id: scene.id }); }
        // Once their lines are done, whatever they swap for what you carry spare is offered, one by one (town.ts).
        for (const swap of this.items.swaps.filter(x => x.who === person)) this.queued.push(() => this.offerSwap(swap.id, t.x, t.y));
      }
      // Whom you talked to, or what you read and where (never what it says): the story, and the field notes, may follow.
      if (this.online) this.send({ t: 'talk', x: t.x, y: t.y });
      return;
    }
    if (t.kind === 'ledger') {
      // The town as it stands, read out; then what you carry that a work still wants is offered, work by work.
      this.openDialog({ ...t, lines: ledgerLines(this.items.town, this.town, id => this.items.byId.get(id)) });
      for (const w of this.items.town?.works ?? []) for (const n of w.needs) this.queued.push(() => this.offerGift(w.id, n.item, t.x, t.y));
      return;
    }
    // In a home, the kitchen and the map table stand there only once the house is built up to them (house.ts):
    // until then boxes stand in their places, which say what comes there, and what builds it.
    if (t.house && !builtIn({ kind: t.kind === 'kitchen' ? 'kitchen' : 'board', x: t.x, y: t.y, house: t.house }, this.houseHere())) {
      const lines = this.visit ? friendsBoxes(this.visit.name) : boxesLines(t.kind === 'kitchen' ? 'kitchen' : 'board', houseWord(t.house, this.items.house));
      return this.openDialog({ ...t, who: 'Boxes', lines, kind: 'talk' });
    }
    if (t.kind === 'board') return this.readBoard(t.x, t.y);
    if (t.kind === 'fire') return this.tend(t.x, t.y);
    // A friend's chest, workbench and kitchen are theirs alone.
    if ((t.kind === 'chest' || t.kind === 'bench' || t.kind === 'kitchen') && this.visit) {
      const said = notYours(this.visit.name, t.kind);
      return this.inform(said.who, said.text);
    }
    if (t.kind === 'kitchen') return this.cookAt(t.x, t.y, true);
    if (t.kind === 'teleport') {
      // It takes you somewhere else, so it asks first: the one in a house (anyone's) to town, the one in town home.
      return this.ask({ who: TELEPORT, text: teleportQuestion(!this.current.data.private), yes: () => this.beamOut(t, { t: 'teleport', x: t.x, y: t.y }) });
    }
    if (t.kind === 'locked') return this.inform(t.who, t.lines[0] ?? padlocked(undefined));
    if (t.kind === 'lookout') return this.atLookout(t);
    if (t.kind === 'works') return this.atWorks(t);
    if (t.kind === 'chest') {
      if (!this.online) return;
      this.opening = { x: t.x, y: t.y, at: this.clock };
      this.send({ t: 'chest', x: t.x, y: t.y });
      return;
    }
    if (t.kind === 'bench') {
      if (!this.online) return;
      // Walked here by the first goal (goToBench): its recipe's card opens with the workbench, if it is not too late.
      const card = this.wantCard && this.clock < this.wantCard.until ? this.wantCard.card : undefined;
      this.wantCard = null;
      this.benching = { x: t.x, y: t.y, at: this.clock, ...(card ? { card } : {}) };
      this.send({ t: 'bench', x: t.x, y: t.y });
      return;
    }
    if (t.kind === 'cache') {
      if (!this.online) return;
      this.caching = { x: t.x, y: t.y, at: this.clock };
      this.send({ t: 'cache', x: t.x, y: t.y });
      return;
    }
    if (t.kind === 'comfort' && t.what) {
      // What stands there: spoiled, and where to make it again, or what you made.
      const def = furnitureFor(t.what, this.items.byId.values());
      const said = comfortLines(t.what, def, !!def && this.roomFurniture().includes(def.id), this.trophies(), !!this.visit);
      this.openDialog({ ...t, who: said.who, lines: said.lines, kind: 'talk' });
      return;
    }
    if (t.kind === 'lostfound') return this.leaveInBox(t);
    // The slab (slab.ts): hands put to it, which uses nothing up, so nothing is asked; the server says how it went.
    if (t.kind === 'slab') {
      if (this.online) this.send({ t: 'slab', x: t.x, y: t.y });
      return;
    }
    return this.offer(t.x, t.y);
  }

  /**
   * A at the lost and found box (lostfound.ts): carrying bundles, it asks first ("Leave Ana's things in
   * the lost and found box? Ana gets them back at home."), and the box then says what it did; carrying
   * none, it reads its sign.
   */
  private leaveInBox(t: Talker) {
    const names = this.bag.flatMap(s => (s.bundle ? [s.bundle.name] : []));
    if (!names.length) return this.openDialog({ ...t, kind: 'talk' });
    if (!this.online) return;
    const text = handInQuestion(names);
    this.ask({ who: LOST_AND_FOUND, text, yes: () => this.act(LOST_AND_FOUND, text, { t: 'handIn', x: t.x, y: t.y }) });
  }

  /**
   * A at someone else's pile: what to do with it, one of two answers. Take half, as ever (a random half,
   * the rest lost), or carry all of it to the lodge for them, tied up in a bundle (lostfound.ts): the box
   * then says what it did. B backs out, and nothing happens.
   */
  private askPile(d: DropView) {
    const text = pileQuestion(d.name), who = thingsOf(d.name);
    this.ask({
      who, text,
      choices: { yes: TAKE_HALF, other: carryLabel(d.name), run: () => this.act(who, text, { t: 'carry', x: d.x, y: d.y, owner: d.owner }) },
      yes: () => this.sendPick(d.x, d.y),
    });
  }

  /** The setting below friend and trade requests: keep every visitor out of your home (`off`), or let your friends visit. The server says back how it stands. */
  setVisitsOff(off: boolean) {
    if (this.online) this.send({ t: 'visitsOff', off });
  }

  /**
   * Why Visit on a friend's card cannot be pressed now (the rules the server keeps too: world.ts, visit): out in
   * the wilds a visit would be a way home that costs nothing; their home keeps visitors out; you are in it
   * already. Null: it can.
   */
  visitWhyNot(p: PersonView): 'wilds' | 'closed' | 'here' | null {
    const d = this.current.data;
    if (d.kind === 'wilds' || (d.kind === 'inside' && d.exits.some(e => this.maps.find(e.to)?.kind === 'wilds'))) return 'wilds';
    if (this.friends?.friends.find(f => f.id === p.id)?.closed) return 'closed';
    if (d.private && this.visit?.name === p.name) return 'here';
    return null;
  }

  /** Whether a friend's home can be visited from here, as their card shows it (friends.ts). */
  visitReach(p: PersonView): VisitReach {
    return this.visitWhyNot(p) ?? 'ok';
  }

  /**
   * Visit on a friend's card: asks first, then NAPO's teleport takes you, as the one in a house does (beam.ts): you
   * fade where you stand, and the server sets you down by the teleport in their home, where you form again.
   */
  visitFriend(p: PersonView) {
    if (!this.online || !this.me || this.beam) return;
    const why = this.visitWhyNot(p);
    if (why) return this.inform(p.name, visitWhyNot(p.name, why));
    const me = this.me, text = visitQuestion(p.name);
    this.ask({ who: p.name, text, yes: () => this.beamOut({ x: me.tx, y: me.ty }, { t: 'visit', id: p.id }) });
  }

  /** Put bag slot `slot` (or everything, left out) into the open chest. */
  store(slot?: number) {
    const c = this.chest;
    if (!c || !this.online) return;
    this.send(slot === undefined ? { t: 'store', x: c.x, y: c.y } : { t: 'store', x: c.x, y: c.y, slot });
  }

  /** Take a stack of an item out of the open chest (as much as fits the server decides); a piece of gear, the `n`th of its kind. */
  take(item: string, n?: number) {
    const c = this.chest;
    if (!c || !this.online) return;
    this.send({ t: 'take', x: c.x, y: c.y, item, count: this.items.get(item).stack, ...(n ? { n } : {}) });
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

  /**
   * Sings a call (calls.ts): the server says who hears it, you among them, and the note comes back like
   * anyone's. Another one too soon is not sent, and the text over your head says so. True when it went.
   */
  call(kind: CallKind, now: number): boolean {
    if (!this.online) return false;
    if (now - this.calledAt < CALL_EVERY_MS + CALL_SLACK_MS) {
      this.murmur(refusalText('slow_down', 'call'));
      return false;
    }
    this.calledAt = now;
    this.send({ t: 'call', kind });
    return true;
  }

  /**
   * The news since the last frame, for the interface to announce, and none of it again. A call heard
   * longer ago than CALL_FRESH_MS is left out: the tab was hidden, and old calls must not sing at once.
   */
  takeNews(now: number): News[] {
    const out = this.news.filter(n => n.kind !== 'call' || now - n.at < CALL_FRESH_MS);
    this.news = [];
    return out;
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

  /** Any other friends action: answer, unfriend, block, report, the settings, or asking for the list again. */
  social(msg: Extract<ClientMsg, { t: 'answer' | 'unfriend' | 'block' | 'report' | 'requests' | 'tradeRequests' | 'friends' }>) {
    if (this.online) this.send(msg);
  }

  /** Something new for the menu's dot: a friend request, or a message not opened yet. */
  get socialNews(): boolean {
    return this.unread.size > 0 || (this.friends?.incoming.length ?? 0) > 0;
  }

  // ---------- trades ----------

  /** Asks a friend to trade (their card's Trade): the server asks them, and the trade panel opens once it says so. */
  askTrade(p: PersonView) {
    if (!this.online || this.trade) return;
    if (this.slump) return this.inform('', YOU_ARE_DOWN);
    this.tradeWith = p;
    this.callingOff = null;
    this.send({ t: 'tradeOpen', id: p.id });
  }

  /** Where a friend is for a trade, as their card says it: near enough, on your map but too far, or not here. */
  tradeReach(id: string): TradeReach {
    const me = this.me, them = this.players.get(id);
    return tradeReach(me && { x: me.tx, y: me.ty }, them && { x: them.tx, y: them.ty });
  }

  /** A tap on bag slot `slot` in the trade panel: what it holds goes into your side, or comes back out of it. */
  tradeTap(slot: number) {
    const s = this.bag[slot];
    // Someone else's things are never given away (lostfound.ts): the box says so, and nothing changes.
    if (s?.bundle) return this.inform('Trade', bundleNotYours(s.bundle.name));
    if (s && isKeepsake(this.items.get(s.item))) return this.inform('Trade', KEEPSAKE_STAYS);
    this.setOffer(tapSlot(this.tradeMine, this.bag, slot, this.items));
  }

  /** − (-1) or + (1) on row `i` of your side. */
  tradeStep(i: number, by: -1 | 1) {
    this.setOffer(stepRow(this.tradeMine, this.bag, i, by, this.items));
  }

  /** Ready, or not any more (it can be pressed once both are in). */
  tradeReady() {
    const t = this.trade;
    if (t?.state === 'open' && this.online) this.send({ t: 'tradeReady', on: !t.ready });
  }

  /** Trade: once both are ready, both press it and the server swaps both sides. */
  tradeConfirm() {
    const t = this.trade;
    if (t?.state === 'open' && t.ready && t.theyReady && !t.confirmed && this.online) this.send({ t: 'tradeConfirm' });
  }

  /** A on the trade panel: Ready, and once both are ready, Trade. */
  tradePressA() {
    const t = this.trade;
    if (t?.state !== 'open') return;
    if (!t.ready) this.tradeReady();
    else this.tradeConfirm();
  }

  /** The trade panel closed: the trade is off, for both. What the server says of it until it hears this is old news. */
  tradeCancel() {
    const t = this.trade;
    if (!t) return;
    this.callingOff = t.with.id;
    this.trade = null;
    this.tradeMine = [];
    this.tradeChanges++;
    if (this.online) this.send({ t: 'tradeCancel' });
  }

  /** Your side changed: both Readys go (as the server will say), and it goes to the server as picks of your bag. */
  private setOffer(picks: OfferPick[]) {
    const t = this.trade;
    if (!t || t.state === 'asked' || !this.online) return;
    this.tradeMine = offerOf(picks, this.bag, this.items);
    this.trade = { ...t, ready: false, theyReady: false, confirmed: false, theyConfirmed: false };
    this.tradeChanges++;
    this.send({ t: 'tradeOffer', items: picks });
  }

  /** The trade as the server tells it: a friend's ask is a question in the text box; anything else, the panel shows. */
  private traded(t: TradeView) {
    if (this.callingOff === t.with.id) return;
    const was = this.trade;
    this.trade = t;
    this.tradeMine = t.mine;
    this.tradeChanges++;
    if (t.state === 'asked' && !(was?.state === 'asked' && was.with.id === t.with.id)) this.askToTrade(t.with);
  }

  /** "Ana wants to trade. Open the trade?", once the text box is free: a question or someone's lines keep it until they are done. */
  private askToTrade(p: PersonView) {
    if (this.question || this.dialog) {
      this.tradeAsk = p;
      return;
    }
    this.tradeAsk = null;
    const answer = (yes: boolean) => { if (this.online && this.trade?.with.id === p.id) this.send({ t: 'tradeAnswer', id: p.id, yes }); };
    this.ask({ who: 'Trade', text: tradeQuestion(p.name), tag: 'trade', yes: () => answer(true), no: () => answer(false) });
  }

  /** The trade is over: the panel closes, a question that still asks goes, and the box says how it ended. */
  private tradeOver(p: PersonView, end: TradeEnd) {
    if (this.callingOff === p.id) this.callingOff = null;
    // (One called off by closing its panel is over already here; a trade with someone else since stays.)
    if (!this.trade || this.trade.with.id === p.id) {
      this.trade = null;
      this.tradeMine = [];
      this.tradeChanges++;
      if (this.question?.ask.tag === 'trade') {
        this.question = null;
        this.boxChanges++;
      }
    }
    if (this.tradeAsk?.id === p.id) this.tradeAsk = null;
    const text = tradeOverText(end, p.name, this.items);
    if (text) this.inform('Trade', text);
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
    const def = this.items.get(id), cost = mendCost(def, this.items.mend), level = this.myWorn[slot]?.level;
    if (!cost) return;
    const short = shortOf(cost, b.stash);
    if (short.length) return this.inform('Workbench', stashShort(short, this.items, { mend: def, level }));
    const text = mendQuestion(def, cost, this.items, level);
    this.ask({ who: 'Workbench', text, yes: () => this.act('Workbench', text, { t: 'mend', x: b.x, y: b.y, slot }) });
  }

  /**
   * At the open workbench: upgrade a piece you wear or keep in the stash one level. It asks first, with
   * what it uses and, from +7, how often it works ("Upgrade your raincoat to +7? It uses 4 shards and a
   * strange object. It works 7 times in 10."), or says what the stash lacks. The server rolls the dice.
   */
  upgrade(of: PieceAt) {
    const b = this.bench;
    if (!b || !this.online) return;
    const at = pieceAt(of, { items: this.items, bag: this.bag, stash: b.stash, gear: this.myGear, worn: this.myWorn });
    const level = at?.piece.level ?? 0, next = at && upgradable(at.def) ? nextUpgrade(level, this.items.upgrades) : undefined;
    if (!at || !next) return;
    const short = shortOf(next.needs, b.stash);
    if (short.length) return this.inform('Workbench', stashShort(short, this.items, { upgrade: at.def, to: level + 1 }));
    const text = upgradeQuestion(at.def, level + 1, next, this.items);
    this.ask({ who: 'Workbench', text, yes: () => this.act('Workbench', text, { t: 'upgrade', x: b.x, y: b.y, of }) });
  }

  unequip(slot: Slot) {
    const c = this.chest;
    if (c && this.online) this.send({ t: 'unequip', x: c.x, y: c.y, slot });
  }

  /** At the open chest: wear an outfit from the wardrobe, or none (null). It uses nothing up, so it asks nothing. */
  wearOutfit(outfit: string | null) {
    const c = this.chest;
    if (c && this.online) this.send({ t: 'outfit', x: c.x, y: c.y, outfit });
  }

  /** At the open chest: wear a pattern or a badge of yours from the wardrobe, or none (null). Like an outfit, it asks nothing. */
  wearLook(kind: LookKind, id: string | null) {
    const c = this.chest;
    if (!c || !this.online) return;
    this.send(kind === 'pattern' ? { t: 'pattern', x: c.x, y: c.y, pattern: id } : { t: 'badge', x: c.x, y: c.y, badge: id });
  }

  /**
   * At the open chest: spend merits on a look, a jacket pattern or a name tag badge (merits.ts). It uses
   * them up, so it asks first ("Spend a merit on the chevron pattern? You have 3."), or says why it cannot;
   * the box then says what it did.
   */
  buyLook(id: string) {
    const c = this.chest, look = meritLookOf(id);
    if (!c || !this.online || !look) return;
    const why = whyNotBuy(look, this.progress.xp, this.merits, !this.guest);
    if (why) return this.inform('Wardrobe', why === 'no_merits' ? noMerit(this.progress.xp) : sentence(refusalText(why, 'buy')));
    const text = buyQuestion(look, meritsLeft(this.progress.xp, this.merits.spent));
    this.ask({ who: 'Wardrobe', text, yes: () => this.act('Wardrobe', text, { t: 'buy', x: c.x, y: c.y, look: id }) });
  }

  /**
   * At the open chest, in the wardrobe's Shop tab: buy a look, paid on Stripe's page. It asks first, with its
   * price and the waiver the law asks for ("Buy the lighthouse oilskin for €2.99? You get it at once, so you
   * give up the 14 days to change your mind."), or says why not. Said yes to, the server opens the payment,
   * and the game goes there; the look is yours once the server says Stripe told it so.
   */
  checkout(id: string) {
    const c = this.chest, look = shopLookOf(this.shop, id), open = this.shopOpen;
    if (!c || !this.online || !look) return;
    const why = whyNotCheckout(look, this.shopOwned, !this.guest, !!open);
    if (why) return this.inform('Shop', sentence(refusalText(why, 'checkout')));
    const price = priceOf(look, open!.currency);
    if (price === undefined) return this.inform('Shop', sentence(refusalText('shop_closed', 'checkout')));
    const text = checkoutQuestion(look, price, open!.currency);
    this.ask({ who: 'Shop', text, yes: () => this.act('Shop', SHOP_OPENING, { t: 'checkout', x: c.x, y: c.y, look: id, waiver: true }) });
  }

  /**
   * What you bought in the shop, whole, as the server says it now (Stripe told it a look is paid, or
   * refunded). A look new to you is news, and said in the text box when it is the one you came back from
   * paying for; one refunded is said in the box too.
   */
  private boughtNow(owned: readonly string[]) {
    const before = this.shopOwned;
    this.shopOwned = [...owned];
    for (const id of owned) {
      const look = shopLookOf(this.shop, id);
      if (before.includes(id) || !look) continue;
      const back = this.returning?.paid && this.returning.look === id;
      if (back) {
        this.returning = null;
        this.inform('Shop', SHOP_THANKS);
      }
      this.news.push({ kind: 'bought', noun: look.noun, plural: !!look.plural, said: !!back });
    }
    for (const id of before) {
      const look = shopLookOf(this.shop, id);
      if (look && !owned.includes(id)) this.inform('Shop', refundedLine(look));
    }
  }

  /**
   * Back from Stripe's page (`returning`), once you are in the game signed in: nothing paid; the look yours
   * already; or, until the server says it is, that the payment is being confirmed, which stays up a while.
   */
  private settleReturn() {
    const r = this.returning;
    if (!r || this.guest) return;
    const line = returnLine(r, this.shopOwned);
    if (!line.waiting) {
      this.returning = null;
      return this.inform('Shop', line.text);
    }
    this.note = { who: 'Shop', text: line.text, until: this.clock + CONFIRMING_MS, waiting: false };
    this.boxChanges++;
  }

  /**
   * The outfits signing in just gave you, which the welcome parcel's banner names: all your level opens
   * (the NAPO work suit first), as none were yours before. None for a guest, and none once you wear one:
   * then the wardrobe is no news.
   */
  private newOutfits(): string[] {
    return this.guest || this.myOutfit ? [] : outfitsFor(this.progress.level, true).map(o => o.id);
  }

  /**
   * Anywhere, from the bag: put on the piece in bag slot `slot` (what it replaces goes into the bag), or
   * take off what a slot wears into the bag. Nothing is used up, so nothing asks first; the server says
   * no when it cannot (a full bag), and the bag and what you wear follow its answer.
   */
  wear(slot: number) {
    if (this.online && this.bag[slot]) this.send({ t: 'wear', slot });
  }

  doff(slot: Slot) {
    if (this.online && this.myGear[slot]) this.send({ t: 'doff', slot });
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
    if (made.kind === 'furniture' && this.furniture.includes(r.make)) return this.inform('Workbench', placedAlready(made));
    const short = shortOf(r.needs, b.stash);
    if (short.length) return this.inform('Workbench', stashShort(short, this.items, { make: this.items.get(r.make) }));
    const text = makeQuestion(r, this.items);
    this.ask({ who: 'Workbench', text, yes: () => this.act('Workbench', text, { t: 'craft', x: b.x, y: b.y, recipe }) });
  }

  /**
   * At the open workbench in your own home: build the house up to its next level (house.ts). It asks first,
   * with what it uses, or says what the stash lacks; the server builds it, and the house stands so at once.
   */
  build() {
    const b = this.bench, next = nextHouse(this.house, this.items.house);
    if (!b || !this.online || !next) return;
    const short = shortOf(next.needs, b.stash), level = next.name.toLowerCase();
    if (short.length) return this.inform('Workbench', stashShort(short, this.items, { build: level }));
    const text = buildQuestion(level, next.needs, this.items);
    this.ask({ who: 'Workbench', text, yes: () => this.act('Workbench', text, { t: 'build', x: b.x, y: b.y }) });
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
    // A piece carried in the bag is owned as much as one in the stash: taken off out there, it is not the next thing to make.
    const gearIn = (list: readonly BagSlot[]) => list.filter(s => this.items.get(s.item).kind === 'gear').map(s => s.item);
    const owned = new Set([...Object.values(this.myGear), ...gearIn(stash), ...gearIn(this.bag)]);
    // Gear only: a recipe that makes a tool (yours for good, never worn) is never the first goal.
    const gear = this.items.recipes.filter(r => this.items.get(r.make).kind === 'gear');
    // A live find carried goes into the stash as what it fades into (a live shard is a shard there).
    const bag = this.bag.map(s => ({ item: this.items.get(s.item).live?.into ?? s.item, count: s.count }));
    return nearestRecipe(gear, owned, count(stash), count(bag));
  }

  /** The workbench right next to you, where it can be opened; null when there is none. */
  benchBeside(): { x: number; y: number } | null {
    const me = this.me;
    const b = me && this.talkers.find(t => t.kind === 'bench' && Math.abs(t.x - me.tx) + Math.abs(t.y - me.ty) === 1);
    return b ? { x: b.x, y: b.y } : null;
  }

  /**
   * Opens the workbench next to you, as A at it does (the server answers with what the stash holds), on
   * `card` once it answers (the first goal's recipe). The card goes with the asking: an answer that never
   * comes, or comes too late, another open, or another map forgets it.
   */
  openBench(card?: DetailRef) {
    const b = this.benchBeside();
    if (!b || !this.online) return;
    this.benching = { ...b, at: this.clock, ...(card ? { card } : {}) };
    this.send({ t: 'bench', x: b.x, y: b.y });
  }

  /** Whether the workbench in your own home is here to go to: the first goal takes you there. */
  canGoToBench(): boolean {
    return this.online && !this.visit && !this.up && !this.slump && this.talkers.some(t => t.kind === 'bench');
  }

  /**
   * Walks you to the workbench in your home and opens it there, on `card` (the first goal's recipe): the
   * same walk as a tap on it. Next to it already, it just opens.
   */
  goToBench(card?: DetailRef) {
    const me = this.me, t = this.talkers.find(k => k.kind === 'bench');
    if (!me || !t || !this.canGoToBench()) return;
    if (this.benchBeside()) return this.openBench(card);
    this.wantCard = card ? { card, until: this.clock + 30_000 } : null;
    this.goal = { talk: t };
    this.path = findPath(this.map, me.tx, me.ty, t.x, t.y, true, undefined, this.pass);
    const end = this.path.at(-1) ?? { x: me.tx, y: me.ty };
    this.marker = { x: end.x, y: end.y, t: 0 };
  }

  /**
   * The chest, the workbench and the kitchen of your home (a friend's, while you visit) that you stand near,
   * for their names to show: the kitchen once it is built. None anywhere else.
   */
  spotsNear(): Array<{ kind: 'chest' | 'bench' | 'kitchen'; name: string; x: number; y: number }> {
    const me = this.me, d = this.current.data;
    if (!me || !d.private || d.kind !== 'inside') return [];
    return this.talkers.flatMap(t => {
      if (t.kind !== 'chest' && t.kind !== 'bench' && t.kind !== 'kitchen') return [];
      if (t.kind === 'kitchen' && t.house && !builtIn({ kind: 'kitchen', x: t.x, y: t.y, house: t.house }, this.houseHere())) return [];
      if (Math.hypot(t.x - me.x, t.y - me.y) > SPOT_TAG_TILES) return [];
      return [{ kind: t.kind, name: t.kind === 'chest' ? 'Chest' : t.kind === 'bench' ? 'Workbench' : t.who, x: t.x, y: t.y }];
    });
  }

  /** What A does at the thing you face, in a word, for the button: 'Workbench', 'Chest', 'Cook', 'Fire'; null for anything else. */
  aVerb(): string | null {
    const a = this.action();
    if (a?.kind !== 'talk') return null;
    const k = a.talker.kind;
    return k === 'bench' ? 'Workbench' : k === 'chest' ? 'Chest' : k === 'kitchen' ? 'Cook' : k === 'fire' ? 'Fire' : null;
  }

  /** The card the workbench that just opened is to show (the first goal's), once; null when none. */
  takeBenchCard(): DetailRef | null {
    const c = this.benchCard;
    this.benchCard = null;
    return c;
  }

  // ---------- a crate for whoever comes next ----------

  /** What lies in the open crate, each one's age counted on to `now`. */
  cacheItemsNow(now: number): CacheItemView[] {
    const c = this.cache;
    if (!c) return [];
    const by = Math.max(0, now - c.at) / 1000;
    return c.items.map(e => ({ ...e, age: e.age + by }));
  }

  /**
   * At the open crate: leave one of what is in bag slot `slot` for whoever comes next. It asks first
   * ("Leave 1 resin in the crate for whoever comes next?"), or says why not: gear stays out, you left
   * one this visit already, or the crate is full.
   */
  leaveInCache(slot: number) {
    const c = this.cache, s = this.bag[slot];
    if (!c || !s || !this.online) return;
    const def = this.items.get(s.item);
    if (s.bundle) return this.inform('Crate', bundleNotYours(s.bundle.name));
    if (isKeepsake(def)) return this.inform('Crate', KEEPSAKE_STAYS);
    if (!cacheTakes(def)) return this.inform('Crate', CRATE_NO_GEAR);
    if (c.left) return this.inform('Crate', LEFT_ONE);
    if (c.items.length >= CACHE_SIZE) return this.inform('Crate', CRATE_FULL);
    const text = leaveQuestion(def);
    this.ask({ who: 'Crate', text, yes: () => this.actOn(slot, def.id, 'Crate', text, i => ({ t: 'cacheLeave', x: c.x, y: c.y, slot: i })) });
  }

  /** At the open crate: take the thing `id` out. Someone left it for you: it asks nothing, and the box then says what it did (and whom it thanked). */
  takeFromCache(id: number) {
    const c = this.cache, e = c?.items.find(x => x.id === id);
    if (!c || !e || !this.online) return;
    if (c.took) return this.inform('Crate', TOOK_ONE);
    if (addToBag(this.bag, this.items.get(e.item), 1, bagSlotsOf(this.myGear, this.items.byId)).left) return this.inform('Crate', NO_ROOM);
    this.send({ t: 'cacheTake', x: c.x, y: c.y, id });
  }

  /** Close the crate (its panel went away). */
  closeCache() {
    this.cache = null;
  }

  /** Read the notice board on tile x,y (next to you): the server answers with how the world stands, and its panel opens. */
  readBoard(x: number, y: number) {
    if (!this.online) return;
    this.boardAsked = { x, y };
    this.send({ t: 'board', x, y });
  }

  /** Read the open board again, so what it says keeps up while you stand reading it (the server answers only next to it). */
  rereadBoard() {
    if (this.board && !this.boardAsked) this.readBoard(this.board.x, this.board.y);
  }

  /** Step back from the notice board (its panel went away). */
  closeBoard() {
    this.board = null;
    this.boardAsked = null;
  }

  /** What you wear. */
  get myGear(): Gear {
    return (this.meId && this.gear.get(this.meId)) || {};
  }

  /** The outfit you wear, or null: your gear shows. */
  get myOutfit(): string | null {
    return (this.meId && this.outfits.get(this.meId)) || null;
  }

  /** The pattern on your jacket and the badge on your name tag, or null: none. */
  get myPattern(): string | null {
    return (this.meId && this.patterns.get(this.meId)) || null;
  }

  get myBadge(): string | null {
    return (this.meId && this.badges.get(this.meId)) || null;
  }

  /** What you wear, piece by piece (condition and quirk), as the server last told it. */
  get myWorn(): Worn {
    return this.body.view.worn ?? {};
  }

  /**
   * A (or a tap) at a place being mended (works.ts): with what it takes in the bag and room for it, asks
   * first ("Give 3 scrap to the footbridge? It is broken: it stands again with 30 scrap.", and how many, up
   * to what you carry and what it takes); YES gives it, and NO says how it stands and whose name is on its
   * plaque. With none of it, or when it takes no more for now, it says that and why.
   */
  private atWorks(t: Talker) {
    const w = t.works ? this.items.works.get(t.works) : undefined;
    if (!w || !this.online) return;
    const def = this.items.get(w.item), view = this.works.get(w.id), who = worksWho(w), state = worksText(w, view, def);
    const stands = view ?? { standing: false, held: 0 }, slot = this.bag.findIndex(b => b.item === w.item), room = worksRoom(w, stands);
    if (slot < 0) return this.inform(who, `${state} ${nothingToGive(def)}`);
    if (room <= 0) return this.inform(who, `${state} ${WORKS_FULL}`);
    this.ask({
      who, text: n => bringQuestion(def, w, stands, n), count: { min: 1, max: Math.min(countOf(this.bag, w.item), room, FEED_MAX) },
      yes: n => this.actOn(slot, w.item, who, bringQuestion(def, w, stands, n), i => ({ t: 'bring', x: t.x, y: t.y, slot: i, ...(n > 1 ? { count: n } : {}) })),
      no: () => this.inform(who, state),
    });
  }

  /**
   * A (or a tap) at a fire lookout's ladder: its lamp first, then the climb. Carrying what the lamp burns,
   * while it takes more, you are asked to feed it ("Feed the lookout's lamp resin?", how many up to what
   * you carry and what fits); YES feeds it, and NO leaves it be, so A climbs next time. Otherwise A climbs:
   * the server puts you up, and says for how long. From anywhere but its foot, you walk there first.
   */
  private atLookout(t: Talker) {
    const me = this.me;
    const o = this.current.data.objects.find((l): l is Extract<MapObject, { kind: 'lookout' }> => l.kind === 'lookout' && ladderOf(l).x === t.x && ladderOf(l).y === t.y);
    if (!me || !o || !this.online) return;
    const foot = footOf(o), key = `${o.x},${o.y}`;
    if (me.tx !== foot.x || me.ty !== foot.y) {
      this.goal = { talk: t };
      this.path = findPath(this.map, me.tx, me.ty, foot.x, foot.y, false, undefined, this.pass);
      return;
    }
    const slot = this.bag.findIndex(b => b.item === LAMP_BURNS), fits = lampTakes(this.lampLeft(o.x, o.y, this.clock) ?? 0);
    if (slot >= 0 && fits > 0 && this.lampDeclined !== key) {
      const def = this.items.get(LAMP_BURNS), text = lampQuestion(def);
      this.ask({
        who: 'Lookout', text, count: { min: 1, max: Math.min(countOf(this.bag, def.id), fits, FEED_MAX) },
        yes: n => this.actOn(slot, def.id, 'Lookout', text, i => ({ t: 'feed', x: o.x, y: o.y, slot: i, ...(n > 1 ? { count: n } : {}) })),
        no: () => { this.lampDeclined = key; },
      });
      return;
    }
    this.send({ t: 'climb', x: o.x, y: o.y });
  }

  /**
   * A at a fire. With something to cook (meals.ts) at a fire that burns, a choice: feed it, or cook on it;
   * only one of the two when the other cannot happen (a fire someone keeps going takes no fuel, one that is
   * full no more, and nothing cooks on a dead one). Anything else is feeding it, as ever.
   */
  private tend(x: number, y: number) {
    const left = this.fireLeft(x, y, this.clock);
    // At home, what a meal takes may all be in the chest: a fire cooks what you carry, and the box says so
    // (and that the kitchen, once it stands, cooks from the chest), rather than that the fire needs nothing.
    if (!carriesFood(this.items.cooking, this.bag) && left === null && this.current.data.private && !this.visit) {
      const pantry = this.pantry(), meal = this.items.cooking.find(r => !pantryShort(r, [], pantry).length);
      if (meal) return this.inform('Fire', cookFromChest(meal, this.items, this.kitchenBuilt()));
    }
    if (!carriesFood(this.items.cooking, this.bag) || !cooks(left)) return this.feed(x, y);
    const fuel = this.bestSlot(def => def.fuel ?? 0);
    const feeds = left !== null && fuel >= 0 && fireTakes(left ?? 0, this.items.get(this.bag[fuel].item).fuel ?? 0) > 0;
    if (!feeds) return this.cookAt(x, y);
    this.ask({ who: 'Fire', text: FIRE_CHOICE, options: FIRE_OPTIONS, yes: () => {}, pick: i => (i === 0 ? this.feed(x, y) : this.cookAt(x, y)) });
  }

  /**
   * Cooking at a fire that burns, or at your kitchen (`kitchen`: house.ts, paid from the bag and then the
   * chest): what can be cooked, asked first with what it uses ("Cook fir-tip tea? It uses 3 fir tips."), after
   * a choice of which when there is more than one; with too little for any, what the nearest one still lacks.
   */
  private cookAt(x: number, y: number, kitchen = false) {
    const who = kitchen ? KITCHEN : 'Fire', pantry = kitchen ? this.pantry() : {};
    const can = kitchen ? this.items.cooking.filter(r => !pantryShort(r, this.bag, pantry).length) : cookable(this.items.cooking, this.bag);
    if (!can.length) {
      if (kitchen) {
        // The meal the bag and the chest together come nearest to, among those they hold something of.
        const near = this.items.cooking
          .map(r => ({ r, short: pantryShort(r, this.bag, pantry) }))
          .filter(({ r }) => r.needs.some(n => countOf(this.bag, n.item) + (pantry[n.item] ?? 0) > 0))
          .sort((a, b) => a.short.reduce((n, s) => n + s.count, 0) - b.short.reduce((n, s) => n + s.count, 0))[0];
        return this.inform(who, near ? kitchenShort(near.r, near.short, this.items) : KITCHEN_EMPTY);
      }
      const near = nearestCooking(this.items.cooking, this.bag);
      return near && this.inform(who, cookShort(near, this.bag, this.items));
    }
    if (can.length === 1) return this.cook(x, y, can[0]!, who);
    this.ask({ who, text: WHAT_TO_COOK, options: can.map(r => this.items.get(r.make).name), yes: () => {}, pick: i => this.cook(x, y, can[i]!, who) });
  }

  private cook(x: number, y: number, recipe: Recipe, who = 'Fire') {
    const text = cookQuestion(recipe, this.items);
    this.ask({ who, text, yes: () => this.act(who, text, { t: 'cook', x, y, recipe: recipe.id }) });
  }

  /** What your chest holds, item by item, as the server last said: the kitchen's pantry. */
  private pantry(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const s of this.stash ?? []) out[s.item] = (out[s.item] ?? 0) + s.count;
    return out;
  }

  /** Whether your kitchen stands (house.ts): your house is built up to it. */
  private kitchenBuilt(): boolean {
    return this.current.data.objects.some(o => o.kind === 'kitchen' && builtIn(o, this.house));
  }

  /**
   * Feeding a fire: asks to feed it what burns longest of what you carry, and how many (as many as you
   * carry and as fit), or says why not: someone keeps it going, it is full, or nothing you carry burns.
   */
  private feed(x: number, y: number) {
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
   * What A would do now: get up someone who is down on the tile you face (or your own), else talk to
   * whoever you face or use what stands there (a gate, a sign, a fire), and only then pick up what lies
   * on your own tile, else on the tile you face (on either, a pile before a find). What stands in the
   * world comes before what lies on the ground: a pile dropped under a gate would otherwise keep you
   * from ever pulling at it. Turning away, or a tap on it, still picks it up.
   */
  action(): Action | null {
    const me = this.me;
    if (!me) return null;
    const [dx, dy] = DIR_VEC[me.dir];
    const down = this.downAt(me.tx + dx, me.ty + dy) ?? this.downAt(me.tx, me.ty);
    if (down) return { kind: 'rescue', id: down.id, name: down.name };
    const talker = this.talkerAt(me.tx + dx, me.ty + dy);
    if (talker) return { kind: 'talk', talker };
    for (const [x, y] of [[me.tx, me.ty], [me.tx + dx, me.ty + dy]] as const) {
      const thing = this.thingAt(x, y);
      if (thing) return { kind: 'pick', x, y, what: thing.kind };
    }
    return null;
  }

  /** What lies on tile x,y to pick up: a pile before a find. */
  thingAt(x: number, y: number): Thing | undefined {
    for (const drop of this.drops.values()) if (drop.x === x && drop.y === y) return { kind: 'drop', drop };
    for (const find of this.finds.values()) if (find.x === x && find.y === y) return { kind: 'find', find };
    return undefined;
  }

  /** B: back, and NO to a question. Returns true when it handled something (so the caller does not open the bag). */
  pressB(): boolean {
    if (this.question) { this.answer('back'); return true; }
    if (this.note) { this.closeNote(); return true; }
    if (this.dialog) { this.advanceDialog(); return true; }
    // Up a lookout, B climbs down (the server says when you are).
    if (this.up) { if (this.online) this.send({ t: 'climbDown' }); return true; }
    return false;
  }

  tapTile(x: number, y: number) {
    // A tap on the world is outside the box: backing out of a question, and what the box says closes.
    if (this.question) return this.answer('back');
    if (this.note) return this.closeNote();
    if (this.dialog) return this.advanceDialog();
    if (this.beam) return;
    const me = this.me;
    // Down, you go nowhere. Up a lookout nobody walks: the ground below is only to look at.
    if (!me || this.slump || this.up) return;
    const from = { x: me.tx, y: me.ty };
    // Someone down: walk up to them, and A's question comes as you arrive.
    const down = this.downAt(x, y);
    if (down) {
      this.goal = { rescue: { id: down.id, x, y } };
      this.path = findPath(this.map, from.x, from.y, x, y, true);
      const end = this.path.at(-1) ?? from;
      this.marker = { x: end.x, y: end.y, t: 0 };
      return;
    }
    // A lookout is tall: a tap anywhere on it, or on its cab above, goes to the foot of its ladder, and does what A does there.
    const tower = this.current.data.objects.find(o => o.kind === 'lookout' && x >= o.x && x <= o.x + 1 && y >= o.y - 2 && y <= o.y + 1);
    if (tower) {
      const ladder = ladderOf(tower), talker = this.talkerAt(ladder.x, ladder.y);
      if (talker) return this.atLookout(talker);
    }
    // Every way is found with what your tools open (the culvert in waders), as the server would take it.
    // Something to pick up: walk onto it (finds are small, so a tap on one lands on its own tile).
    if (this.thingAt(x, y)) {
      this.goal = { pick: { x, y } };
      this.path = findPath(this.map, from.x, from.y, x, y, false, undefined, this.pass);
      const end = this.path.at(-1) ?? from;
      this.marker = { x: end.x, y: end.y, t: 0 };
      return;
    }
    // People and signs are tall: a tap on the head lands on the tile behind them. So is a padlocked
    // door you cannot open yet: its shed stands behind it, and tapped, it says why it stays shut. A slab lies flat.
    // A footbridge that stands is a way like any other: a tap on it walks there (A, facing it, gives to it).
    const onBridge = this.talkerAt(x, y)?.kind === 'works' && this.map.walkable(x, y, this.pass);
    const behind = this.talkerAt(x, y + 1), talker = onBridge ? undefined : this.talkerAt(x, y) ?? (behind?.kind === 'slab' ? undefined : behind);
    if (talker) {
      this.goal = { talk: talker };
      this.path = findPath(this.map, from.x, from.y, talker.x, talker.y, true, undefined, this.pass);
      const end = this.path.at(-1) ?? from;
      this.marker = { x: end.x, y: end.y, t: 0 };
      return;
    }
    if (!this.map.inside(x, y)) return;
    // A tap looks: on ground that opens only with a tool you have not got (the culvert without waders), the
    // box says what it takes. Walking into it only turns you, and says nothing.
    const kind = this.map.kind(x, y), need = kind && TILE_NEEDS[kind];
    if (need && !this.pass.has(need)) return kind === 'icefall' ? this.inform('Icefall', icefallText(this.items.get(need))) : this.inform('Culvert', floodedText(this.items.get(need)));
    this.goal = null;
    this.path = findPath(this.map, from.x, from.y, x, y, false, undefined, this.pass);
    if (this.path.length) { const end = this.path.at(-1)!; this.marker = { x: end.x, y: end.y, t: 0 }; }
  }

  private talkerAt(x: number, y: number): Talker | undefined {
    return this.talkers.find(t => t.x === x && t.y === y);
  }

  /**
   * What lies on tile x,y: your own pile or a find is picked up at once; someone else's pile asks what to
   * do with it first (askPile).
   */
  private pick(x: number, y: number) {
    if (!this.online) return;
    const piles = [...this.drops.values()].filter(d => d.x === x && d.y === y);
    const theirs = piles.some(d => d.owner === this.meId) ? undefined : piles[0];
    if (theirs) return this.askPile(theirs);
    this.sendPick(x, y);
  }

  /** Asks the server for what lies on tile x,y. One pick at a time: the answer is on its way. */
  private sendPick(x: number, y: number) {
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
    // An arrow shows as long as your feats and charms say (Good neighbor), and a pale moth gives energy back: the server's rules.
    // An effect still working says so, since a second one only starts its time again.
    const mods = modsOf(this.stats, charmsIn(this.bag, this.items.byId));
    const running = def.use?.lasts ? this.effectsNow(this.clock).find(f => f.item === def.id)?.left : undefined;
    const text = useQuestion(def, this.energy(this.clock), markLifetime(mods) / 1000, def.use?.mark ? this.markLift(mods) : undefined, running);
    this.ask({ who: def.name, text, yes: () => { done?.(); this.actOn(slot, def.id, def.name, text, i => ({ t: 'use', slot: i })); } });
  }

  /** Throw away some of what is in bag slot `slot`: it asks how many, from one up to all of it. */
  discard(slot: number) {
    const s = this.bag[slot];
    if (!s || !this.online) return;
    // The card offers no Throw away for someone else's things; a key or a stray press gets the same answer.
    if (s.bundle) return this.inform(thingsOf(s.bundle.name), bundleNotYours(s.bundle.name));
    const def = this.items.get(s.item), all = s.count, level = s.piece?.level, who = pieceName(def, level), text = (n: number) => tossQuestion(def, n, all, level);
    this.ask({
      who, text, count: { min: 1, max: all },
      yes: n => this.actOn(slot, def.id, who, text(n), i => ({ t: 'discard', slot: i, count: n })),
    });
  }

  /** Why using `def` from bag slot `slot` cannot work here, when the game knows it already (the server checks it anyway); null when it can. */
  private whyNotUse(slot: number, def: ItemDef): string | null {
    const u = def.use ?? {}, me = this.me;
    if (this.slump) return YOU_ARE_DOWN;
    if (u.meal) {
      const why = whyNotEat(def.id, this.body.view.meals ?? []);
      if (why) return why === 'ate_it' ? ateAlready(def) : TWO_MEALS;
    }
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

  /**
   * What a charm in your bag gives back as a glowcap is crushed (a pale moth), and which one: the server's
   * rule (Mods.markEnergy, in the `mods` your feats and charms make), when the bar has room for it;
   * undefined when nothing would.
   */
  private markLift(mods: Mods): { charm: ItemDef; energy: number } | undefined {
    const charm = this.bag.map(s => this.items.get(s.item)).find(d => d.kind === 'charm' && (d.charm?.markEnergy ?? 0) > 0);
    const e = this.energy(this.clock), energy = mods.markEnergy;
    return charm && energy > 0 && (!e || e.max - e.value >= 0.5) ? { charm, energy } : undefined;
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

  /**
   * YES or NO to the open question (or the first or second of two choices): A, a tap on either; or backing
   * out of it, B or a tap outside the box, which is NO (and with two choices, neither).
   */
  answer(answer: Answer) {
    const q = this.question;
    if (!q) return;
    this.question = null;
    this.repeat.release();
    // A direction held while it asked walks only once it is pressed again.
    this.pad.dir = null;
    this.boxChanges++;
    q.run(answer);
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

  /** A tap outside the text box: backing out of a question (NO), and what the box says closes. */
  dismiss() {
    if (this.question) return this.answer('back');
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

  // ---------- thanks, and the letter home ----------

  /**
   * What the game brings up by itself when nothing else holds the box: the letter home, then an offer to
   * thank someone (thanks.ts). Call it every frame after update(); `covered`: a panel, the menu or the
   * dark between maps is up, and nothing new may show.
   */
  idle(now: number, covered: boolean) {
    // The UTC day turns: whom you thanked yesterday may be thanked again.
    const day = utcDay(this.wall.ms + (now - this.wall.now));
    if (day !== this.thankedDay) { this.thankedDay = day; this.thankedToday.clear(); }
    const free = this.online && !covered && !this.held && !this.question && !this.note && !this.dialog && !this.slump;
    const letter = free && this.letters.shift();
    if (letter) {
      this.openDialog({ x: 0, y: 0, who: letter.who, lines: letter.lines, kind: 'talk' });
      return;
    }
    const me = this.online ? this.me : undefined, blocked = new Set((this.friends?.blocked ?? []).map(p => p.id));
    const offer = this.offers.due({
      now, map: this.current.data.id, marks: this.marks, free,
      me: me ? { id: me.id, x: me.tx, y: me.ty, moving: !!me.anim || !!this.pad.dir || this.path.length > 0 || !!this.goal } : null,
      fires: [...this.fires].map(([k, f]) => { const [x, y] = k.split(',').map(Number) as [number, number]; return { x, y, left: this.fireLeft(x, y, now) ?? null, fed: f.fed }; }),
      skip: id => this.thankedToday.has(id) || blocked.has(id),
    });
    if (offer) this.offerThanks(offer);
  }

  /**
   * A new player's first moment, at home by the fire: the story's first chapter in the text box, before any
   * letter, and who knows the woods. Only while nothing is done yet (the first chapter, no XP). True when it
   * is to be said: main.ts keeps that, so each character hears it once.
   */
  firstWake(): boolean {
    const first = this.story.chapters[0];
    if (!this.online || !first || this.chapter !== first.id || this.progress.xp > 0) return false;
    this.letters.unshift({ who: first.title, lines: [first.text] });
    return true;
  }

  /** "Ana fed this fire. Thank Ana?" YES sends the thanks; NO means never again for that fire or arrow this session. */
  private offerThanks(o: Offer) {
    const who = o.kind === 'fire' ? 'Fire' : 'Arrow', name = o.helper.name;
    const text = o.kind === 'fire' ? fireThanksQuestion(name) : markThanksQuestion(name);
    const what = o.kind === 'fire' ? { kind: 'fire' as const, x: o.x, y: o.y } : { kind: 'mark' as const, id: o.id };
    this.ask({
      who, text,
      yes: () => { this.thanking = { id: o.helper.id, name }; this.act(who, text, { t: 'thank', who: o.helper.id, what }); },
      no: () => this.offers.decline(o.key),
    });
  }

  /**
   * Says what waited for the box, once the box is free: a friend's ask to trade first, as it does not wait
   * long; then what came to be said meanwhile; then what someone's lines left to offer (a swap, a gift at
   * the ledger), one question at a time.
   */
  private sayLater() {
    const p = this.tradeAsk;
    if (p && !this.question && !this.dialog) {
      if (this.trade?.state === 'asked' && this.trade.with.id === p.id) return this.askToTrade(p);
      this.tradeAsk = null;
    }
    const l = this.later;
    if (l && !this.question && !this.dialog && !this.note) {
      this.later = null;
      return this.inform(l.who, l.text);
    }
    while (this.queued.length && !this.question && !this.dialog && !this.note) this.queued.shift()!();
  }

  /**
   * After talking to them: the swap `id` (town.ts) with the person on tile x,y, if you carry enough to make
   * it and have room for what comes back. It asks first, how many times over; nothing when it would not fit.
   */
  private offerSwap(id: string, x: number, y: number) {
    const swap = this.items.swaps.find(s => s.id === id), me = this.me;
    if (!swap || !me || !this.online || Math.abs(me.tx - x) + Math.abs(me.ty - y) !== 1) return;
    const max = swapsFit(this.bag, swap, this.items.byId, bagSlotsOf(this.myGear, this.items.byId));
    if (max < 1) return;
    const who = this.talkers.find(t => t.id === swap.who)?.who ?? 'Swap', text = (n: number) => swapQuestion(swap, n, this.items);
    this.ask({ who, text, count: { min: 1, max }, yes: n => this.act(who, text(n), { t: 'swap', x, y, swap: id, ...(n > 1 ? { count: n } : {}) }) });
  }

  /** After reading the ledger: give it `item` for the work `work`, if you carry some and it still wants some. It asks first, how many. */
  private offerGift(workId: string, item: string, x: number, y: number) {
    const work = this.items.town?.works.find(w => w.id === workId), me = this.me;
    if (!work || !me || !this.online || this.town.done.includes(workId) || Math.abs(me.tx - x) + Math.abs(me.ty - y) !== 1) return;
    const wants = workWants(work, this.town.given[workId], item), have = countOf(this.bag, item);
    if (!wants || !have) return;
    const def = this.items.get(item), text = (n: number) => giveQuestion(work, def, n, wants);
    this.ask({
      who: 'The town ledger', text, count: { min: 1, max: Math.min(wants, have) },
      yes: n => this.act('The town ledger', text(n), { t: 'give', x, y, work: workId, item, ...(n > 1 ? { count: n } : {}) }),
    });
  }

  /** The town as the server says it is (town.ts): every map follows, and what it has just come to is news. */
  private applyTown(view: TownView, news: boolean) {
    const before = new Set(this.town.done), pop = popOf(this.items.town, view.done);
    this.town = { done: [...view.done], given: structuredClone(view.given) };
    this.townMaps = this.maps.setTown(new Set(view.done), pop);
    if (this.townMaps.has(this.current.data.id)) this.talkers = talkersOf(this.current, this.pass, this.items, this.nameOf);
    this.townChanges++;
    if (news) for (const id of view.done) if (!before.has(id)) this.news.push({ kind: 'town', id, pop });
  }

  /** What a did about the town needs besides the items: a person's name, and the town as it stands. */
  private didContext(): DidContext {
    return {
      name: id => this.talkers.find(t => t.id === id)?.who,
      town: { view: this.town, works: this.items.town?.works ?? [], swaps: this.items.swaps },
    };
  }

  /** The world's clock now (ms since the epoch, as the sky follows it). */
  skyNow(): number {
    return this.sky.ms + (this.clock - this.sky.now);
  }

  /** Where this map's lake is in its round now, by the world's clock as the server counts it; null on a map without one. */
  drawdownNow(): DrawdownView | null {
    const rule = this.current.data.drawdown;
    return rule ? drawdownAt(rule, this.skyNow()) : null;
  }

  /**
   * The lake here drawn down or full by the clock, as the server has it (TileMap.drain): the bed is walked
   * on, and paths cross it, only while drained. The water drawing back and the warning are news on this map,
   * on the turn only (arriving says nothing), once a round.
   */
  private followLake() {
    const v = this.drawdownNow(), id = this.current.data.id;
    if (!v) { this.lake = null; return; }
    this.current.drain(drained(v));
    const was = this.lake;
    this.lake = { map: id, phase: v.phase };
    if (was?.map === id && was.phase !== v.phase && v.phase !== 'full') this.sayLake(v.phase, v.left);
  }

  /** Lake news, unless this round of the lake here had it already. */
  private sayLake(phase: 'down' | 'warn' | 'carried', left: number) {
    const rule = this.current.data.drawdown;
    if (!rule) return;
    // A round starts as the water draws back, so its fill comes in the middle of it.
    const round = Math.floor((this.skyNow() / 1000 + (rule.offset ?? 0)) / rule.every);
    if (round !== this.lakeSaid.round) this.lakeSaid = { round, said: new Set() };
    if (this.lakeSaid.said.has(phase)) return;
    this.lakeSaid.said.add(phase);
    this.news.push({ kind: 'lake', phase, left });
  }

  /** What Agnes says first: when the reservoir goes down next, or how long it stays down. Nothing without one. */
  agnesWord(): string | null {
    const rule = this.current.data.drawdown ?? this.maps.find('reservoir')?.drawdown;
    return rule ? agnesOnTheWater(drawdownAt(rule, this.skyNow()), rule.warn) : null;
  }

  /** What people's words may follow besides the chapter and the counts (story.ts): your level, what you read, brought home and noted, the town, the sky. */
  sayContext(): SayContext {
    const wall = this.skyNow();
    const storm = this.maps.all().some(m => m.kind === 'wilds' && m.storm !== undefined && stormAt(m.storm, wall).phase === 'storm');
    return {
      level: this.progress.level || levelOf(this.progress.xp), notes: this.notesRead, keepsakes: this.keepsakesHome, pages: this.fieldNotes.pages, town: this.town.done,
      sky: { weather: this.weather, storm },
    };
  }

  /** The journal's People were looked at: none of the scenes there is new any more. */
  seenScenes() {
    if (!this.freshScenes.size) return;
    this.freshScenes = new Set();
    this.townChanges++;
  }

  /** Nothing is asked or said any more: another map, or a lost connection. */
  private clearBox() {
    if (this.question || this.note) this.boxChanges++;
    this.question = null; this.note = null; this.later = null; this.queued = [];
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

  /**
   * The name plate by the door of the house in a garden, while you are near it: whose home it is, a friend's
   * while you visit, else yours. None anywhere else.
   */
  platesNear(): Array<{ name: string; x: number; y: number }> {
    const me = this.me, d = this.current.data;
    if (!me || !d.private || d.kind !== 'town') return [];
    const name = this.visit?.name ?? this.me?.name ?? '';
    return d.objects.flatMap(o => {
      if (o.kind !== 'house' || !o.plate) return [];
      const door = { x: o.x + Math.floor(o.w / 2), y: o.y + o.h - 1 };
      return Math.hypot(door.x - me.x, door.y + 1 - me.y) <= PLATE_TAG_TILES ? [{ name, x: door.x, y: door.y }] : [];
    });
  }

  /** The field notes were looked at: the pages opened since are no longer new. */
  seenFieldNotes() {
    if (!this.freshPages.size) return;
    this.freshPages = new Set();
    this.notebookChanges++;
  }

  /** Your character's name, as your map shows it ('' before the welcome). */
  myName(): string {
    return (this.meId && this.players.get(this.meId)?.name) || '';
  }

  /** The journal's notes were looked at: none of them is new any more. */
  seenNotes() {
    if (!this.freshNotes.size) return;
    this.freshNotes = new Set();
    this.notesChanges++;
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

  /**
   * What Walt has to say on the Long Night: the lodge's fire is the town's to keep going until dawn, and
   * how long it has (when he sits by it, as he does); or that it went out. Nothing any other night.
   */
  waltWord(now = this.clock): string | null {
    const n = this.longNight;
    if (!n.on) return null;
    const f = this.current.data.objects.find(o => o.kind === 'fireplace' && o.longNight);
    return waltOnTheLongNight(n.out, f ? this.fireLeft(f.x, f.y, now) ?? null : null);
  }

  /** You see this many tiles past yourself on this map, when a condition brings fog here, while it snows in the snow (a whiteout), and always in the Marsh's mist (outdoors only). */
  fogCap(): number | undefined {
    if (this.current.data.kind === 'inside') return undefined;
    const fogs = activeConditions(this.items.conditions, this.conditions).filter(c => c.map === this.current.data.id && c.fog !== undefined).map(c => c.fog!);
    if (this.current.data.forest === 'snow' && this.weather === 'rain') fogs.push(WHITEOUT);
    if (this.current.data.forest === 'marsh') fogs.push(MARSH_MIST);
    return fogs.length ? Math.min(...fogs) : undefined;
  }

  /** The season the view here is drawn in: the world's, but always winter up in the snow. */
  viewSeason(): Season {
    return this.current.data.forest === 'snow' ? 'winter' : this.season.view.season;
  }

  /** The footprints in the snow here now, oldest first, each with how far it has faded (0 fresh to 1 gone). */
  printsNow(now: number): Array<{ x: number; y: number; dir: Dir; faded: number }> {
    return this.prints.filter(p => now - p.at < PRINTS_KEPT_MS).map(p => ({ x: p.x, y: p.y, dir: p.dir, faded: (now - p.at) / PRINTS_KEPT_MS }));
  }

  /** The footprints the server told of, arriving (none but in the snow). */
  private setPrints(prints: PrintView[] | undefined, now: number) {
    this.prints = (prints ?? []).map(p => ({ x: p.x, y: p.y, dir: p.dir, at: now - p.age * 1000 }));
    this.printChanges++;
  }

  /** A step taken in the snow here, anyone's: it stays in it for the next hour, like the ones the server told of. */
  private print(x: number, y: number, dir: Dir, now: number) {
    if (this.current.data.forest !== 'snow' || this.current.data.kind !== 'wilds') return;
    this.prints.push({ x, y, dir, at: now });
    if (this.prints.length > PRINTS_PER_MAP) this.prints.shift();
    this.printChanges++;
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

  /** The map button (or M) where you carry no map of the area: the text box says so, over the bag if it is open. At home, why none ever will. */
  noMap() {
    this.inform('Map', this.current.data.private ? NO_MAP_HOME : NO_MAP_YET);
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
    this.followLake();
    this.beamOn(dt, now);
    for (const f of this.floats) f.t += dt;
    this.floats = this.floats.filter(f => f.t < 1.3);
    if (this.calls.length && now - this.calls[0]!.at >= CALL_NOTE_S * 1000) this.calls = this.calls.filter(c => now - c.at < CALL_NOTE_S * 1000);
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
    // The view pulls back up a lookout, and comes in again on the ground.
    this.zoom = easeZoom(this.zoom, !!this.up, dt);
    // A lodestone you wear tugs while a shard lies near: the interface feels it (a pulse, a faint sound).
    const me = this.me;
    const near = !!me && Object.values(this.myWorn).some(p => p?.quirk === 'lodestone') && shardNear(this.finds.values(), this.items, me.tx, me.ty);
    if (this.lodestone.update(near, now)) this.news.push({ kind: 'tug' });
    // Uneasy out in the wilds: now and then steps that are not yours, on the ground behind you.
    const steps = this.stalker.update(now, this.online ? this.unease : 0, this.current.data.kind === 'wilds', !!me?.anim);
    if (steps && me) this.news.push({ kind: 'stalk', steps, ground: this.behind(me) });
  }

  /** The ground behind you (your own, where there is none to walk on): what steps that are not yours sound like. */
  private behind(me: Mover): TileKind | undefined {
    const [dx, dy] = DIR_VEC[me.dir], x = me.tx - dx, y = me.ty - dy;
    return this.current.walkable(x, y) ? this.current.kind(x, y) : this.current.kind(me.tx, me.ty);
  }

  /** Decide the local player's next step once they stand on a tile. */
  private driveMe(now: number) {
    const me = this.me;
    // Down, nobody walks: the stick and a tap on the world do nothing until someone gets you up.
    if (!me || me.anim || this.dialog || this.question || !this.online || this.held || this.slump || this.beam) { this.justStepped = false; return; }
    // Up a lookout the stick only turns you, to look (and to hold a watcher still with it).
    if (this.up) {
      const turn = this.pad.dir;
      if (turn && turn !== me.dir) { me.dir = turn; me.turnT = 0.14; this.send({ t: 'face', dir: turn }); }
      this.path = []; this.goal = null;
      return;
    }
    // Stepping away from a lookout's foot: its lamp is asked about again next time.
    if (this.lampDeclined && !lookoutAtFoot(this.current.data.objects, me.tx, me.ty)) this.lampDeclined = null;
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
    if (!dir) { this.bumped = null; return; }
    if (this.pending.length >= MAX_UNCONFIRMED) return; // wait for the server to catch up
    const to = stepTarget(me.tx, me.ty, dir);
    if (!this.map.walkable(to.x, to.y, this.pass)) {
      if (me.dir !== dir) { me.dir = dir; this.send({ t: 'face', dir }); }
      this.path = [];
      // Walking into a padlocked door says why it stays shut, once for each push against it.
      const door = `${to.x},${to.y}`;
      const into = this.map.exitAt(to.x, to.y)?.to, lock = into ? this.map.needs(to.x, to.y) : undefined;
      if (into && lock && this.bumped !== door) {
        this.bumped = door;
        this.inform(this.nameOf(into) ?? 'Door', padlocked(this.items.get(lock)));
      }
      return;
    }
    this.bumped = null;
    if (this.path.length) this.path.shift();
    // Stepping off an arrow the way it points follows it (thanks.ts).
    this.offers.stepped(me.tx, me.ty, dir, to, this.marks);
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
    const at = 'talk' in goal ? goal.talk : 'rescue' in goal ? goal.rescue : goal.pick;
    const d = Math.abs(at.x - me.tx) + Math.abs(at.y - me.ty);
    // Someone down is got up from beside them, if they are still down there.
    const down = 'rescue' in goal ? this.downAt(at.x, at.y) : undefined;
    const there = 'talk' in goal ? d === 1 : 'rescue' in goal ? d <= 1 && down?.id === goal.rescue.id : d <= 1 && !!this.thingAt(at.x, at.y);
    if (!there) return;
    if (d === 1) {
      const face = dirToward(at.x - me.tx, at.y - me.ty);
      if (face !== me.dir) { me.dir = face; this.send({ t: 'face', dir: face }); }
    }
    if ('talk' in goal) this.meet(goal.talk);
    else if ('rescue' in goal) this.rescue(down!.id, down!.name);
    else this.pick(at.x, at.y);
  }

  avatars(): Avatar[] {
    const hitched = this.body.view.hitched, b = this.beam;
    return [...this.players.values()].map(p => ({
      id: p.id, x: p.x, y: p.y, dir: p.dir, moving: !!p.anim, phase: p.phase, color: p.color, turnT: p.turnT, hitched: hitched && p.id === this.meId, live: this.live.has(p.id),
      afterglow: (this.afterglows.get(p.id) ?? 0) > this.clock,
      look: lookOf(this.gear.get(p.id) ?? {}, this.items, this.outfits.get(p.id), this.patterns.get(p.id), this.shop), down: this.downs.has(p.id),
      up: this.ups.has(p.id), lantern: this.lanterns.has(p.id) && this.current.data.depth >= LANTERN_DEPTH && this.current.data.kind === 'wilds',
      ...(b && p.id === this.meId && { beam: { phase: b.phase, t: b.t, pad: b.pad } }),
    }));
  }

  /** Where others vanished or appeared at a teleport since the last call: the view pops each once. */
  takePops(): Array<{ x: number; y: number }> {
    const out = this.pops;
    this.pops = [];
    return out;
  }

  /** YES at NAPO's teleport, or to a visit: the trip starts on your screen (beam.ts); the server is asked (`go`) once you are gone. */
  private beamOut(pad: { x: number; y: number }, go: ClientMsg) {
    if (!this.online || !this.me) return;
    this.path = []; this.goal = null;
    this.beam = { phase: 'out', t: 0, pad: { x: pad.x, y: pad.y }, go };
  }

  /** The trip's clock: gone at BEAM_OUT_S, so the teleport is sent; arrived at BEAM_IN_S; off if the server never moved us. */
  private beamOn(dt: number, now: number) {
    const b = this.beam;
    if (!b) return;
    b.t += dt;
    if (b.phase === 'in') {
      if (b.t >= BEAM_IN_S) this.beam = null;
    } else if (b.sent !== undefined) {
      // The screen going dark for the new map (held) holds the server's answer: that is no time to give up.
      if (this.held) b.sent = now;
      else if (now - b.sent > BEAM_WAIT_MS) this.beam = null;
    } else if (b.t >= BEAM_OUT_S) {
      b.sent = now;
      if (this.online && b.go) this.send(b.go);
    }
  }

  /** The creatures on this map, where they are drawn now, and whom they chase. */
  creatureViews(): Array<{ id: string; kind: CreatureView['kind']; x: number; y: number; dir: Dir; moving: boolean; chasing: string | undefined }> {
    return [...this.creatures.values()].map(c => ({ id: c.id, kind: c.kind, x: c.x, y: c.y, dir: c.dir, moving: !!c.anim, chasing: c.chasing }));
  }
}
