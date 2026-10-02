/**
 * The world is a grid of tiles. A map is plain data (content/maps/*.json) so it can be diffed,
 * reviewed and validated; TileMap turns it into fast lookups for the server and the client.
 *
 * The world is several maps joined by exits, like the towns and routes of FireRed: walking onto an
 * exit tile takes you to another map. A map is a town, part of the wilds (energy drains there, more
 * the deeper you are) or the inside of a building. Every house can be entered: its door is an exit
 * to a small map of its own. Energy only comes back near a fireplace. See energy.ts.
 */
import { comfortSize, underfootComfort, type Comfort } from './comfort';
import type { BagSlot } from './items';
import { STEP_MS } from './movement';
import type { Dir } from './protocol';
import type { DrawdownRule, FlashRule, RainWindow, StormRule, SurgeRule } from './sky';

/** One character per tile in MapData.tiles. */
export const TILE_CHARS = {
  g: 'grass',
  r: 'road',
  w: 'water',
  m: 'mud',
  l: 'lot',
  f: 'ferns',
  /** Knee-high grass: walked through like grass, and whoever stands in it is hidden from creatures (hidden). */
  h: 'tallgrass',
  /** Dense trees: nobody walks through. Drawn as one tree per tile, varied by position. */
  t: 'forest',
  /** Wooden floor, inside buildings. */
  p: 'floor',
  /** A building's wall, inside: nobody walks through. */
  x: 'wall',
  /**
   * A flooded culvert: water to everyone but whoever wades it in waders (TILE_NEEDS). Drawn as water,
   * heard as water, and nothing else ever walks it: creatures, finds and how far home a tile is go by
   * the map as nobody's pass opens it.
   */
  c: 'culvert',
  /**
   * An icefall: a slope of old ice, walked only by whoever wears crampons (TILE_NEEDS). Drawn as ice; to
   * everyone else, and to creatures, finds and how far home a tile is, it is a wall of ice nobody climbs.
   */
  i: 'icefall',
} as const;
export type TileChar = keyof typeof TILE_CHARS;
export type TileKind = (typeof TILE_CHARS)[TileChar];

/**
 * What a walker brings to the tiles that open only for some (TileMap.walkable): the ids of the tools
 * they own (waders through the culvert, bolt cutters through a padlocked door). The server checks every
 * step with the mover's; the client paths and predicts with its own player's.
 */
export type Pass = ReadonlySet<string>;

/** The tile kinds that open only for whoever holds a tool, and which: the flooded culvert to waders, the icefall to crampons. */
export const TILE_NEEDS: Readonly<Partial<Record<TileKind, string>>> = { culvert: 'waders', icefall: 'crampons' };

/** Water in all but name: a flooded culvert is water to whoever is not wading it. */
export const watery = (kind: TileKind | undefined): boolean => kind === 'water' || kind === 'culvert';

/** The wilds drain energy; towns and the insides of buildings do not. */
export type MapKind = 'town' | 'wilds' | 'inside';

/**
 * Walking onto any tile of this rectangle takes you to map `to`. The rectangle's top-left tile
 * arrives at (tx, ty) and the others keep their offset, so a two-lane road stays two lanes.
 */
export interface MapExit {
  x: number;
  y: number;
  w: number;
  h: number;
  to: string;
  tx: number;
  ty: number;
  /** Facing on arrival. */
  dir: Dir;
  /** This exit leads back toward town: in the wilds, danger is measured as the distance from it. */
  home?: boolean;
  /**
   * The tool it takes to go through (a padlocked door: bolt cutters, an item id). Without it the door
   * stays shut: the server refuses the step, and a player's own game neither paths nor steps through it.
   */
  lock?: string;
}

/** How far a street light reaches, from the lamp's tile center to a tile's center. Light is for seeing, not energy. */
export const LAMP_RADIUS = 2.5;
/** How close to a fireplace you must be to recover energy, center to center: the tiles around it. */
export const FIRE_RADIUS = 1.5;

/** How a townsperson looks: colors (#rrggbb), each optional; `hat` puts a hard hat on over the hair. */
export interface NpcLook {
  coat?: string;
  scarf?: string;
  hair?: string;
  skin?: string;
  hat?: string;
}

/**
 * What the town has come to decides some things (town.ts): a gate holds from a milestone the whole
 * server reached or a work of the town's ledger done (`from`), until one (`until`), or between the two.
 * A lamp or a fireplace outside its gate stands dark and cold; anything else is simply not there.
 */
export interface TownGate {
  from?: string;
  until?: string;
}

/**
 * What else on a map changes with the town (town.ts), beside what stands on it within a gate. Kept apart
 * from the objects it changes, so a map that grows with the town keeps what was on it as it was.
 */
export interface MapTown {
  /** A house (by its top-left tile) that lights up from a milestone or a work done on, someone living there again, or has its roof mended. */
  houses?: Array<{ x: number; y: number; from: string; lit?: 1; roof?: string }>;
  /** The town's sign (by its tile) and the number painted on it: someone chalks that over as people come back. */
  sign?: { x: number; y: number; pop: number };
  /** A room only: what it is called from a milestone or a work done on, the last that holds winning (the empty house is Edith's house once she is home). */
  names?: Array<{ from: string; name: string }>;
}

/** The town as it was before anything came back: nothing reached, nothing done. */
export const NO_TOWN: ReadonlySet<string> = new Set();

/** Does a gate hold, with the town come to `done`? No gate always holds. */
export function gateOpen(g: TownGate | undefined, done: ReadonlySet<string>): boolean {
  return (!g?.from || done.has(g.from)) && (!g?.until || !done.has(g.until));
}

/** Does anything on this map change with the town? */
export function touchedByTown(data: MapData): boolean {
  return !!data.town || data.objects.some(o => 'town' in o && o.town);
}

/**
 * The line someone chalked under the number painted on the town's sign, once people came back (`pop`,
 * town.ts): none while the painted number is still right.
 */
export function chalkLine(painted: number, pop: number): string | undefined {
  return pop > painted ? `The ${painted} is crossed out in chalk. Beside it, in the same chalk: ${pop}.` : undefined;
}

/**
 * The map as the town has it when it has come to `done` (town.ts), with `pop` people in it: someone who
 * comes or goes stands here only within their gate, a sign or a porch likewise; a lamp outside its gate
 * stands dark, a hearth outside its gate cold (a hearth, not a fireplace); a house takes the changes that
 * hold (lit, a mended roof); the town's sign says what was chalked on it; a room takes the last name
 * that holds. The same map, as it was, when nothing on it changes with the town.
 */
export function townData(data: MapData, done: ReadonlySet<string>, pop = 0): MapData {
  if (!touchedByTown(data)) return data;
  const t = data.town ?? {};
  const objects = data.objects.flatMap((o): MapObject[] => {
    if (o.kind === 'house') {
      let h = o;
      for (const c of t.houses ?? []) if (c.x === o.x && c.y === o.y && done.has(c.from)) h = { ...h, ...(c.lit ? { lit: 1 as const } : {}), ...(c.roof ? { roof: c.roof } : {}) };
      return [h];
    }
    if (o.kind === 'sign' && t.sign && t.sign.x === o.x && t.sign.y === o.y) {
      const chalk = chalkLine(t.sign.pop, pop);
      return chalk ? [{ ...o, text: [...o.text, chalk] }] : [o];
    }
    if (!('town' in o) || !o.town || gateOpen(o.town, done)) return [o];
    if (o.kind === 'lamp') return [{ ...o, dark: true }];
    if (o.kind === 'fireplace') return [{ kind: 'hearth', x: o.x, y: o.y }];
    return [];
  });
  const name = (t.names ?? []).filter(n => done.has(n.from)).at(-1)?.name ?? data.name;
  return { ...data, name, objects };
}

/** Two workings-out of one map that stand the same (the same name, the same objects in the same order). */
function sameMap(a: MapData, b: MapData): boolean {
  return a === b || (a.name === b.name && a.objects.length === b.objects.length && a.objects.every((o, i) => JSON.stringify(o) === JSON.stringify(b.objects[i])));
}

export type MapObject =
  | { kind: 'tree'; x: number; y: number; s: number; v: number }
  /** A rock; with `hum`, one of the rocks deep in the woods that hum back: it glows faintly, the same day and night. */
  | { kind: 'rock'; x: number; y: number; s: number; v: number; hum?: boolean }
  /**
   * A building you can enter: a wooden cabin (3 by 2, a gabled roof in `roof`), with style 'napo' one
   * of NAPO's concrete buildings (3 by 2 or bigger, a flat roof in `roof`), with style 'mill' the old
   * sawmill, long and low, timber under a sawtooth roof (`roof` its rusted metal), or with style 'shed'
   * a board shed, 2 by 2, under a lean-to roof (`roof`), whose door is padlocked when its exit has a
   * `lock`. Lit: someone is home. `curtains`: a cabin whose people left and drew the curtains behind
   * them; its windows never light. `plate`: the house in a garden of one's own (a private town map), 5 by 3,
   * with a name plate by its door where its owner's name shows: drawn as its owner has built it up (a
   * garage, a cabin, a house: house.ts), whatever `roof` and `lit` say.
   */
  | { kind: 'house'; x: number; y: number; w: number; h: number; roof: string; lit: 0 | 1; style?: 'napo' | 'mill' | 'shed'; curtains?: boolean; plate?: true }
  /**
   * A street light. `town`: it stands broken and dark outside its gate (town.ts). `dark`: it is dark now,
   * as the town (or the night) has it: only ever worked out (townData), never written in a map. `works`
   * (works.ts): it lights only while that place stands, mended by everyone.
   */
  | { kind: 'lamp'; x: number; y: number; town?: TownGate; dark?: true; works?: string }
  /**
   * A wooden signpost; with style 'napo' one of NAPO's yellow warning signs, 'cardboard' a piece of
   * cardboard someone wrote on, 'mailbox' the mailbox by a door with the family's name on it. `town`: what
   * it says only within that gate (a mailbox with a name painted on again, town.ts).
   */
  | { kind: 'sign'; x: number; y: number; text: string[]; style?: 'napo' | 'cardboard' | 'mailbox'; town?: TownGate }
  | { kind: 'pole'; x: number; y: number }
  | { kind: 'fence'; x: number; y: number; dir: 'h' | 'v' }
  | { kind: 'barrel'; x: number; y: number }
  /**
   * A car left where it stopped: w by h tiles (2 by 1, or 1 by 2 along a road that runs north), its nose
   * toward `dir` (east when left out), in `paint` (#rrggbb; the town's old teal when left out), with a
   * `door` left open or the `trunk` left up.
   */
  | { kind: 'car'; x: number; y: number; w: number; h?: number; dir?: Dir; paint?: string; door?: boolean; trunk?: boolean }
  /**
   * A truck left where it stood: a logging truck, rusted, its last load still chained on, or with style
   * 'napo' one of NAPO's box trucks. w by h tiles, one wide, its nose toward `dir`.
   */
  | { kind: 'truck'; x: number; y: number; w: number; h: number; dir: Dir; style?: 'napo' }
  /** One of NAPO's field jeeps, burned out, a door hanging open: you read what is stenciled on it like a sign, from beside it. */
  | { kind: 'jeep'; x: number; y: number; w: number; h: number; dir: Dir; text: string[] }
  /** A deck of felled logs on its w by h tiles: lying east to west on a deck one tile deep, north to south (their cut ends to the camera) on any other. */
  | { kind: 'logs'; x: number; y: number; w: number; h: number }
  /** What is left of a fir the loggers cut, or, `burned`, one a fire took. */
  | { kind: 'stump'; x: number; y: number; s: number; v: number; burned?: boolean }
  /** A log laid across a skid road and half sunk in the mud: walked over. `dir`: which way the road runs. */
  | { kind: 'skid'; x: number; y: number; dir: 'h' | 'v' }
  /** One of NAPO's survey stakes, with orange flagging: only drawn, walked past. */
  | { kind: 'stake'; x: number; y: number }
  /** Suitcases and bags as they were left, when they would not fit in the car. */
  | { kind: 'luggage'; x: number; y: number }
  /** Cardboard boxes, some taped shut, some half packed. */
  | { kind: 'boxes'; x: number; y: number }
  | { kind: 'rocker'; x: number; y: number }
  /** An upright piano under a tarp: two tiles wide. */
  | { kind: 'piano'; x: number; y: number }
  /** A child's bike, lying on its side. */
  | { kind: 'bike'; x: number; y: number }
  /** An empty birdcage, its door open. */
  | { kind: 'birdcage'; x: number; y: number }
  /** NAPO's fuel pump, in its motor pool. */
  | { kind: 'pump'; x: number; y: number }
  /** One of NAPO's sample cages: a rock from deep in the woods behind steel mesh; you read its tag like a sign. */
  | { kind: 'cage'; x: number; y: number; text: string[] }
  | { kind: 'stone'; x: number; y: number }
  /**
   * The Sister: a standing stone on the bed of the Reservoir, the Old Stone's twin, under water at high water
   * (MapData.drawdown). Read like a sign from beside it, which only the low water lets anyone stand at.
   */
  | { kind: 'sister'; x: number; y: number; text: string[] }
  /** A rowing boat pulled up on the shore, upturned: Jon's, on his knoll in the Reservoir. */
  | { kind: 'boat'; x: number; y: number }
  /** A townsperson. `town`: someone who comes or goes with the town (town.ts), here only within that gate. */
  | { kind: 'npc'; x: number; y: number; id: string; name: string; dir: Dir; lines: string[]; look?: NpcLook; town?: TownGate }
  | { kind: 'shrooms'; x: number; y: number }
  /** A tall radio mast, like the NAPO Tower's, with a red light blinking at the top; `broken`: snapped halfway, its light long dead. */
  | { kind: 'antenna'; x: number; y: number; broken?: boolean }
  /** What is left of a logging camp's bunkhouse, w by h tiles: log walls fallen to a few rounds, no roof. Not a way in: it stands in the way. */
  | { kind: 'ruin'; x: number; y: number; w: number; h: number }
  /** The loggers' yarder, rusted where it stood: a boiler and a drum of steel cable on a sled of logs, two tiles by two. */
  | { kind: 'yarder'; x: number; y: number }
  /** A wooden cable spool on its side, the yarder's steel cable still wound on it. */
  | { kind: 'spool'; x: number; y: number }
  /** An old timber bridge over a creek, laid on the ford beneath it and walked over. `dir`: which way it runs, across the water. */
  | { kind: 'bridge'; x: number; y: number; dir: 'h' | 'v' }
  /** A trapper's things against a wall: steel traps on pegs, a pair of snowshoes, a coil of snare wire. */
  | { kind: 'traps'; x: number; y: number }
  /** One of NAPO's desks with a screen, a radio or a log on it: you read it like a sign, under its `name`. `id` names it for the story. */
  | { kind: 'console'; x: number; y: number; id: string; name: string; text: string[] }
  /**
   * One of NAPO's gates, w tiles wide (east to west) in a fence, too heavy for one: you read its plate like a
   * sign, from the tile below it, and pulling at it there (A) counts. When GATE_PULLERS people pull within
   * GATE_WINDOW_MS of each other, it swings open long enough for them to slip through, and it takes each of
   * them to map `to`, the one at the gate's first tile arriving at tx, ty and the others keeping their offset,
   * like an exit. The way back needs nobody: it opens from the far side (that map's home exit).
   * `pullers`: how many it takes, GATE_PULLERS left out. `look` 'rope': not NAPO's steel but the trappers'
   * fixed rope up the ice north of the Burn, which holds only with three on it (the Ridge).
   */
  | { kind: 'gate'; x: number; y: number; w: number; to: string; tx: number; ty: number; dir: Dir; text: string[]; pullers?: number; look?: 'rope' }
  /**
   * Stand on a tile next to it to recover energy while it burns. In town it is always tended; out in
   * the wilds (and in their shelters) it burns down unless someone feeds it, or `tended` says someone
   * out there keeps it going. `name`: what people call a fire in the open (the notice board says it),
   * for example "the leavers' camp"; a fire in a room goes by the room's name. `longNight`: the lodge's
   * fire, which nobody tends on the Long Night (sky.ts): it burns down like a shelter's until dawn, and
   * the town keeps it going. `town`: a hearth in town that stays cold until someone comes home to light
   * it (town.ts).
   */
  | { kind: 'fireplace'; x: number; y: number; tended?: boolean; name?: string; longNight?: boolean; town?: TownGate }
  /**
   * A notice board: reading it tells how things stand out there (the server writes it). In a home of one's
   * own it is the map table, which tells the same: `house`, the level of the house it stands in from (house.ts).
   */
  | { kind: 'board'; x: number; y: number; house?: number }
  /**
   * The kitchen in a home of one's own (house.ts): a stove and a counter against a wall, the pantry under it.
   * It cooks what a fire cooks (`cooking` in content/items.json), paid from the bag and then the chest.
   * `house`: the level of the house it stands in from; below it, boxes stand in its place.
   */
  | { kind: 'kitchen'; x: number; y: number; house?: number }
  /**
   * A roof on posts over w by h tiles, walked under: whoever stands under it keeps out of the rain and
   * dries off, as under any roof. Built by the town (`town`: a work of its ledger, town.ts).
   */
  | { kind: 'porch'; x: number; y: number; w: number; h: number; town?: TownGate }
  /** The town's ledger, open on its stand: what each broken part of town needs, and where you give it (town.ts). */
  | { kind: 'ledger'; x: number; y: number }
  /** Your stash: a chest at home. Everyone who opens it sees only their own things in it. */
  | { kind: 'chest'; x: number; y: number }
  /** The workbench, beside the chest at home: it makes gear from what your stash holds (recipes in content/items.json). */
  | { kind: 'workbench'; x: number; y: number }
  /**
   * A crate for whoever comes next (caches.ts), where people rest by a fire out there: anyone opens it,
   * leaves a thing and takes one. `name`: what people call it, as a letter says it ("the old cabin's crate").
   */
  | { kind: 'cache'; x: number; y: number; name: string }
  /**
   * The lost and found box, by Walt in the lodge (lostfound.ts): a battered wooden box with a sign
   * lettered by hand. Whatever you carry for someone, left in it, goes back to them.
   */
  | { kind: 'lostfound'; x: number; y: number }
  /**
   * A flat stone slab lying in the ground, the stones' own sealed crate (slab.ts): walked over like the
   * ground, its seams glow while the region is restless, and then two people facing it together open it,
   * each taking what it `holds`. `name`: what the notice board calls it ("the slab in the ring of stones").
   */
  | { kind: 'slab'; x: number; y: number; name: string; holds: BagSlot[] }
  /** Furniture, inside buildings. A bed is one tile wide and two long (head at y); a rug is only drawn. */
  | { kind: 'bed'; x: number; y: number }
  | { kind: 'table'; x: number; y: number }
  | { kind: 'shelf'; x: number; y: number }
  | { kind: 'crate'; x: number; y: number }
  /** Split firewood stacked against the nearest wall. Nothing to do with it: it only stands in the way. */
  | { kind: 'woodpile'; x: number; y: number }
  | { kind: 'rug'; x: number; y: number; w: number; h: number }
  /** A hearth nobody lights any more, against the top wall like a fireplace: cold, it gives nothing. */
  | { kind: 'hearth'; x: number; y: number }
  /** Furniture under a dust sheet, as it was covered when the house was shut. */
  | { kind: 'sheeted'; x: number; y: number }
  | { kind: 'crib'; x: number; y: number }
  /** A tall clock against the wall, stopped. */
  | { kind: 'clock'; x: number; y: number }
  /**
   * Something left to read, like a sign, under its `name`: a note or a list lying on a table (on a
   * floor tile), or a calendar or a child's drawing hung on the wall (on a wall tile, read from the
   * floor below it).
   */
  | { kind: 'paper'; x: number; y: number; name: string; text: string[]; look: 'note' | 'list' | 'calendar' | 'drawing' }
  /** The sawmill's head saw: its two big wheels and the band between them, and the belts up to the line shaft. */
  | { kind: 'saw'; x: number; y: number }
  /** The saw carriage on its rails, w tiles long east to west, a log still dogged on it. */
  | { kind: 'carriage'; x: number; y: number; w: number }
  /** A drift of sawdust on the mill floor: walked through. */
  | { kind: 'sawdust'; x: number; y: number }
  /**
   * A place in a home of one's own where furniture stands (comfort.ts): spoiled by years of damp until
   * its owner makes new furniture for it at the workbench. Each player sees their own (their cabin is
   * theirs alone). `what` says which: a bed two tiles long, the rug three by two (walked over), the rest one.
   */
  | { kind: 'comfort'; x: number; y: number; what: Comfort }
  /**
   * One of NAPO's teleports: one in every house (a home of one's own) and its twin in the home town.
   * A at the house's takes you to town, onto the tile in front of the town's (teleportArrival); A at the
   * town's takes you home, onto the tile in front of the one in your own house. A friend's visit sets
   * them down in front of the one in yours. Faced like a desk, from the tile in front of it.
   * `home`: an outpost's, in a hut or barracks out in the wilds (never in a home or in town): one way,
   * it takes you home, in front of the one in your own house, and there is none to come back by.
   */
  | { kind: 'teleport'; x: number; y: number; home?: true }
  /**
   * A handwritten note someone left (notes.ts): on a table, a shelf, a crate or a bed, in a car, on the
   * luggage, nailed to a pole. It lies on the tile of what it is on, so it blocks nothing itself, and you
   * read it like a sign, facing that. `id` names it for good (what players read is kept by it), `by`
   * says who wrote it, `name` what the text box calls it ("Nailed to the pole"). A note with `when`
   * only shows at night, in the rain or on an aurora night; the rest of the time the box says `faint`.
   */
  | { kind: 'note'; x: number; y: number; id: string; by: NoteAuthor; name: string; text: string[]; when?: NoteWhen; faint?: string }
  /**
   * A fire lookout from the logging days (lookout.ts): a timber tower on four legs, 2 by 2, a cab on top
   * with a lamp in it, its ladder up the south face of its east column. Climbed from the tile in front
   * of the ladder (footOf); its lamp burns what someone feeds it there, and sweeps a beam round the woods.
   */
  | { kind: 'lookout'; x: number; y: number }
  /**
   * A footbridge over water, w by h (one of them 1), mended by everyone (works.ts, its `id`): only drawn,
   * and its tiles, water to everyone else, are walkable only while it stands (they open with its id).
   */
  | { kind: 'footbridge'; id: string; x: number; y: number; w: number; h: number };

/**
 * Who left notes behind: the ranger, Walt Pruitt when he walked the line, the Barlows from the cabin at the
 * end, the people who left (tags in the jam), and Agnes and Jon Brandt at the Reservoir, who write past each other.
 */
export const NOTE_AUTHORS = ['ranger', 'walt', 'barlows', 'leavers', 'brandts'] as const;
export type NoteAuthor = (typeof NOTE_AUTHORS)[number];
/** When a note shows (notes.ts, noteShows): written in something that glows, in wax that only water shows, or scratched with a shard. */
export const NOTE_WHEN = ['night', 'rain', 'aurora'] as const;
export type NoteWhen = (typeof NOTE_WHEN)[number];
/** What a note may lie on: its tile is one of these things' tiles. */
export const NOTE_ON = ['table', 'shelf', 'crate', 'bed', 'pole', 'car', 'truck', 'luggage'] as const;

/** The ways a paper to read can look (MapObject 'paper'); the first two lie on a table, the others hang on a wall. */
export const PAPER_LOOKS = ['note', 'list', 'calendar', 'drawing'] as const;
/** A paper that hangs on the wall: it stands on a wall tile and is read from the floor below it. */
export const hangs = (look: (typeof PAPER_LOOKS)[number]) => look === 'calendar' || look === 'drawing';

/** A place people call by name: the ring of stones, the sinks, the quarantine line. */
export interface MapPlace {
  name: string;
  x: number;
  y: number;
}

export interface MapData {
  id: string;
  /** Shown when you arrive, e.g. "The Near Woods". */
  name: string;
  /** Bump when the map changes; a client with another version reloads. */
  version: number;
  kind: MapKind;
  /** 0 for towns; 1 for the wilds next to town, more for regions farther out. Scales energy drain. */
  depth: number;
  width: number;
  height: number;
  /** Rows of TileChar, top (north, y = 0) to bottom. */
  tiles: string[];
  /** Rows of digits: ground height steps. Only level 0 is walkable for now. */
  levels: string[];
  /** Where new players start and collapsed players wake up (in the home town). */
  spawn: { x: number; y: number; dir: Dir };
  exits: MapExit[];
  objects: MapObject[];
  /**
   * Outdoors only (a town or the wilds): when it rains over this region, windows counted from dawn
   * (sky.ts). None: the usual rain (DEFAULT_RAIN); an empty list: it never rains. A room hears the rain
   * of the map its door opens onto.
   */
  rain?: RainWindow[];
  /** The wilds only: how this region surges (sky.ts). None: it never does. */
  surge?: SurgeRule;
  /** The wilds only: how often a storm rolls over this region (sky.ts). None: it never storms. */
  storm?: StormRule;
  /** The wilds only: how often a flash starts near someone out here (sky.ts). None: no flashes. */
  flashes?: FlashRule;
  /** The wilds only: watchers, creatures that come closer while nobody looks at them. */
  watchers?: WatcherRule;
  /**
   * Insides only: the inside of one of NAPO's buildings (napo: concrete, not logs), the sawmill's floor
   * (mill: boards, not logs) or a board shed's (shed: rough boards, small). Its door is a building of
   * the same style.
   */
  style?: 'napo' | 'mill' | 'shed';
  /**
   * A home that is each player's own: the room with the chest (the house's inside) and the garden it stands
   * in (a town map whose one house has a `plate`). Each player is in copies of them of their own (the
   * server's zones), where only the friends they let visit join them, to look round (world.ts, visits).
   */
  private?: true;
  /**
   * A private room only, the house's inside: where you wake up in it (as a new player, and after a
   * collapse), on a walkable tile by its fire, facing `dir`.
   */
  wake?: { x: number; y: number; dir: Dir };
  /** Places on this map people call by name; the paper map writes them in. */
  places?: MapPlace[];
  /** What else on this map changes with the town (town.ts): houses that light up, the town's sign, a room's name. */
  town?: MapTown;
  /** The wilds only: skulkers, creatures that lie in the ferns and chase whoever they hear or see. */
  skulkers?: SkulkerRule;
  /**
   * The wilds only: how the forest grows. 'old': old growth, as deep in as the Far Woods, the firs older
   * and taller with cedars among them, the ferns deep and the light under them dimmer. 'burnt': a forest
   * the answer burned (the Burn), its firs standing black and bare over grey ground. 'snow': above the
   * Burn, the Ridge, always in winter (its view, its cold, its snow for rain), and its snow keeps the
   * footprints of the last hour (PRINTS_KEPT_MS). 'marsh': east of the Far Woods, the Marsh, its drowned
   * trees standing grey in the water, its mist never lifting, lights drifting over its water. Left out: the
   * younger woods nearer town.
   */
  forest?: 'old' | 'burnt' | 'snow' | 'marsh';
  /**
   * Outdoors only: the water that freezes in winter (sky.ts, SEASONS: `frozen`), each by what people call
   * it and its tiles as [x, y]: while it is frozen it is ice, walked on like ground (TileMap.freeze). The
   * pond in the Near Woods, the brook in Stonebrook. None: nothing here freezes.
   */
  ice?: FrozenWater[];
  /**
   * The wilds only: a lake that draws down on a clock (the Reservoir; sky.ts, drawdownAt): its tiles are water,
   * walked on like ground while it is drawn down (TileMap.drain). Whoever is still on them when it fills is
   * carried ashore, soaked. A map has this or `ice`, never both.
   */
  drawdown?: Drawdown;
  /**
   * The wilds only: a sky that never moves. 'answer': it is always the night of the answer there (the Other Woods),
   * an aurora night that never ends, whatever the world's clock says: what shows only at night or on a green night
   * always shows, and the dark wears you down as it does at night. It never rains there.
   */
  sky?: 'answer';
}

/** A lake that draws down: what people call it ("the reservoir"), the tiles of its bed, and its clock. */
export interface Drawdown extends DrawdownRule {
  name: string;
  tiles: Array<[number, number]>;
}

/** Water that freezes in winter: what people call it ("the pond"), and its tiles. */
export interface FrozenWater {
  name: string;
  tiles: Array<[number, number]>;
}

/** A watcher takes a step this often, unless its region's rule says otherwise (WatcherRule.stepMs); players are faster. */
export const WATCHER_STEP_MS = 520;
/** ...and this often on aurora nights: watchers are restless then, everywhere by the same share (watcherStepMs). */
export const AURORA_WATCHER_STEP_MS = 400;
/** A skulker takes a step this often, unless its region's rule says otherwise: a quarter slower than a walking player, so moving away in time escapes it. */
export const SKULKER_STEP_MS = 250;
/**
 * No creature is ever as quick as you: its pace (a step every so many ms, a watcher's on an aurora night
 * too) is at least a tenth slower than a walking player's. Moving away in time escapes any of them.
 */
export const CREATURE_STEP_MIN_MS = Math.round(STEP_MS * 1.1);

/** How many watchers roam a region at once, how far from home (in steps) they wake up, and how fast they are there. */
export interface WatcherRule {
  count: number;
  steps: [number, number];
  /** A step every this many ms (WATCHER_STEP_MS when left out): deeper regions keep quicker ones. */
  stepMs?: number;
}

/**
 * How many skulkers lie in a region's ferns, how far from home (in steps) they wake and may go, and
 * when they are out: 'night' (night and aurora nights) and 'storm' (while a storm blows over the region).
 */
export interface SkulkerRule {
  count: number;
  steps: [number, number];
  when: Array<'night' | 'storm'>;
  /** A step every this many ms while it chases (SKULKER_STEP_MS when left out): deeper regions keep quicker ones. */
  stepMs?: number;
}

/** How often a region's watchers step: its rule's pace, quicker on an aurora night by the share every watcher is. */
export function watcherStepMs(rule: WatcherRule | undefined, aurora: boolean): number {
  const pace = rule?.stepMs ?? WATCHER_STEP_MS;
  return aurora ? Math.round((pace * AURORA_WATCHER_STEP_MS) / WATCHER_STEP_MS) : pace;
}

/** How often a region's skulkers step while they chase. */
export function skulkerStepMs(rule: SkulkerRule | undefined): number {
  return rule?.stepMs ?? SKULKER_STEP_MS;
}

/** Where an exit tile leads: the map, the tile you arrive on and your facing. */
export interface Arrival {
  to: string;
  x: number;
  y: number;
  dir: Dir;
}

/** Objects that stand on a tile and stop anyone from walking onto it (a house's door tile excepted). */
const BLOCKING = new Set<MapObject['kind']>([
  'tree', 'rock', 'house', 'lamp', 'sign', 'pole', 'fence', 'barrel', 'car', 'stone', 'sister', 'boat', 'npc', 'fireplace', 'bed', 'table', 'shelf', 'crate', 'board', 'chest', 'workbench',
  'antenna', 'console', 'woodpile',
  'truck', 'jeep', 'logs', 'stump', 'luggage', 'boxes', 'rocker', 'piano', 'bike', 'birdcage', 'pump', 'cage',
  'hearth', 'sheeted', 'crib', 'clock', 'paper', 'saw', 'carriage', 'cache', 'teleport', 'lostfound', 'ledger', 'kitchen',
  'ruin', 'yarder', 'spool', 'traps', 'gate', 'lookout',
]);

/** How many must pull at one of NAPO's gates at once (MapObject 'gate'), and how close together their pulls count as at once. */
export const GATE_PULLERS = 2;
export const GATE_WINDOW_MS = 5000;
/**
 * Objects you walk over or through: all only drawn, but the slab, which is opened from beside it. A note
 * is drawn on what it lies on, which blocks the way itself; a porch is a roof you walk under.
 */
export const DECOR = new Set<MapObject['kind']>(['shrooms', 'rug', 'skid', 'stake', 'sawdust', 'bridge', 'note', 'slab', 'porch', 'footbridge']);

/** Does this object stop anyone from walking onto its tiles? A comfort place does, but for the rug. */
export function blocks(o: MapObject): boolean {
  return o.kind === 'comfort' ? !underfootComfort(o.what) : BLOCKING.has(o.kind);
}

/** Is this object only drawn, walked over or through (DECOR, and the rug of a comfort place)? */
export function underfoot(o: MapObject): boolean {
  return o.kind === 'comfort' ? underfootComfort(o.what) : DECOR.has(o.kind);
}
/**
 * What you face to read or talk to, standing in front of it: the tile below it must stay open
 * ground (a jeep, bigger, is read from any side of it).
 */
export const FRONTED = new Set<MapObject['kind']>(['sign', 'npc', 'board', 'chest', 'workbench', 'console', 'paper', 'cage', 'cache', 'teleport', 'lostfound', 'ledger', 'kitchen']);
/**
 * What the town's state may gate (TownGate, town.ts): who is where, a lamp or a hearth that stays dark
 * until the town mends or lights it, what a sign says, and a porch the town builds. Nothing else comes
 * or goes: the map keeps its shape.
 */
export const GATED = new Set<MapObject['kind']>(['npc', 'sign', 'lamp', 'fireplace', 'porch']);

/** Where a teleport sets you down: on the tile in front of it (below), facing away from it. */
export function teleportArrival(t: { x: number; y: number }): { x: number; y: number; dir: Dir } {
  return { x: t.x, y: t.y + 1, dir: 'down' };
}

/** How many tiles an object covers, across and down: houses, vehicles, log decks, beds, rugs and a few more are bigger than one. */
export function footprint(o: MapObject): [number, number] {
  switch (o.kind) {
    case 'house': case 'rug': case 'truck': case 'jeep': case 'logs': case 'ruin': case 'porch': case 'footbridge': return [o.w, o.h];
    case 'car': return [o.w, o.h ?? 1];
    case 'carriage': case 'gate': return [o.w, 1];
    case 'bed': return [1, 2];
    case 'piano': return [2, 1];
    case 'yarder': return [2, 2];
    case 'comfort': return comfortSize(o.what);
    case 'lookout': return [2, 2];
    default: return [1, 1];
  }
}

type Gate = Extract<MapObject, { kind: 'gate' }>;
/** The gate covering tile x, y, if one does. */
export function gateAt(data: MapData, x: number, y: number): Gate | undefined {
  return data.objects.find((o): o is Gate => o.kind === 'gate' && y === o.y && x >= o.x && x < o.x + o.w);
}
/** How many must pull at this gate at once. */
export const gatePullers = (g: Gate): number => g.pullers ?? GATE_PULLERS;
/** Where pulling at a gate from below its tile x takes you, like an exit: its first tile to tx, ty, the others keeping their offset. */
export function gateArrival(g: Gate, x: number): Arrival {
  return { to: g.to, x: g.tx + Math.min(g.w - 1, Math.max(0, x - g.x)), y: g.ty, dir: g.dir };
}

/** Tiles covered by an object (houses, cars, beds and rugs are bigger than one tile). */
export function objectTiles(o: MapObject): Array<[number, number]> {
  const [w, h] = footprint(o);
  const out: Array<[number, number]> = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push([o.x + dx, o.y + dy]);
  return out;
}

/**
 * Tall grass hides whoever stands in it from creatures, and only from them (DESIGN.md, Creatures):
 * creatures never step into it, a chase ends when the prey reaches it, and nothing notices anyone in
 * it. The drain, the rain, hitchhikers, surges, storms and flashes find you there as anywhere else.
 * The one place the rule lives: the server's creatures and creatureMayStand ask it, and the client
 * asks it too, to crouch whoever stands in tall grass.
 */
export function hidden(map: TileMap, x: number, y: number): boolean {
  return map.kind(x, y) === 'tallgrass';
}

/**
 * A house's door: the middle of its front (bottom) row. The door tile is open, and it must be an
 * exit to the house's inside (the validator checks), so every building can be entered.
 */
export function doorOf(house: Extract<MapObject, { kind: 'house' }>): { x: number; y: number } {
  return { x: house.x + Math.floor(house.w / 2), y: house.y + house.h - 1 };
}

export class TileMap {
  readonly width: number;
  readonly height: number;
  readonly kinds: TileKind[];
  readonly levels: Uint8Array;
  /** 1 where something stands in the way (worked out again when the town changes what stands where). */
  readonly blocked: Uint8Array;
  /** Index into data.exits of the exit on each tile, or -1. */
  private readonly exitIndex: Int16Array;
  /** 1 where a street light reaches (one that always shines: not one of the works). */
  private readonly litTiles: Uint8Array;
  /** The street lights put out for the night (the dead line, line.ts), by "x,y": they light nothing until relit (setLampOut). */
  private readonly outLamps = new Set<string>();
  /** The street lights that shine only while their place stands (a lamp with `works`): its id, and its tile. */
  readonly worksLights: ReadonlyArray<{ id: string; x: number; y: number }>;
  /** 1 next to a fireplace, where energy comes back. */
  private readonly warmTiles: Uint8Array;
  /** 1 under a roof out of doors (a porch): the rain keeps off. */
  private readonly roofTiles: Uint8Array;
  /** Steps from each tile to the nearest home exit (-1: no way there); all 0 in towns. */
  private stepsHome: Int32Array;
  /**
   * The same with the water that opens walked on (null: none here): winter's ice, or a lakebed drawn down (a
   * map has one or the other). The ways home then, which may be shorter.
   */
  private stepsHomeFrozen: Int32Array | null;
  /** 1 on the water that freezes in winter (data.ice). */
  private readonly iceTiles: Uint8Array;
  /** Water here freezes in winter (data.ice lists some). */
  readonly hasIce: boolean;
  /** Frozen now: the ice is walked on. The server and the client set it as the season turns (freeze). */
  private frozen = false;
  /** 1 on the bed of a lake that draws down (data.drawdown). */
  private readonly bedTiles: Uint8Array;
  /** A lake here draws down (data.drawdown lists its bed). */
  readonly hasBed: boolean;
  /** Drawn down now: its bed is walked on. The server and the client set it by the lake's clock (drain). */
  private drained = false;
  /** The most steps any tile is from home: where a surge starts. 0 in towns and insides. */
  private deep = 0;
  /** The map as the town has it now (townData): who is where, which lamps and hearths are lit. */
  private now: MapData;
  /** What the town has come to, as this map was last worked out for it (town.ts). */
  private done: ReadonlySet<string>;
  /** On each tile that opens only for some, the index in `keys` of what it takes (TILE_NEEDS, MapExit.lock); -1 elsewhere. */
  private readonly locks: Int16Array;
  /** What this map's locked tiles take, each once: every tool (or later, anything else) a pass may hold here. */
  readonly keys: readonly string[];
  /** Every key there is here: validators and generators ask what is walkable for someone who holds all of them. */
  private readonly all: Pass;

  /**
   * `source` is the map as content has it; `done` what the town has come to (milestones reached, works
   * done: town.ts), which decides who is where on it and which of its lamps and hearths are lit, and `pop`
   * how many live in town (what is chalked on its sign). None: the town as it was before anything came back.
   */
  constructor(readonly source: MapData, done: ReadonlySet<string> = NO_TOWN, pop = 0) {
    const W = source.width, H = source.height;
    this.width = W;
    this.height = H;
    this.kinds = new Array<TileKind>(W * H);
    this.levels = new Uint8Array(W * H);
    this.blocked = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const row = source.tiles[y] ?? '';
      const lv = source.levels[y] ?? '';
      for (let x = 0; x < W; x++) {
        const c = row[x] as TileChar;
        const kind = TILE_CHARS[c];
        if (!kind) throw new Error(`map ${source.id}: unknown tile '${row[x]}' at ${x},${y}`);
        this.kinds[y * W + x] = kind;
        this.levels[y * W + x] = Number(lv[x] ?? '0') || 0;
      }
    }
    this.exitIndex = new Int16Array(W * H).fill(-1);
    (source.exits ?? []).forEach((e, i) => {
      for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) if (this.inside(x, y)) this.exitIndex[y * W + x] = i;
    });
    // Tiles that open only for whoever holds something: a kind of ground (the culvert, to waders) or a
    // locked exit (a padlocked door, to bolt cutters). The ground and the exits are the map's own: the
    // town never changes them.
    this.locks = new Int16Array(W * H).fill(-1);
    const keys: string[] = [];
    const lock = (i: number, key: string) => {
      let k = keys.indexOf(key);
      if (k < 0) k = keys.push(key) - 1;
      this.locks[i] = k;
    };
    for (let i = 0; i < W * H; i++) {
      const need = TILE_NEEDS[this.kinds[i]!];
      if (need) lock(i, need);
    }
    for (const e of source.exits ?? []) {
      if (!e.lock) continue;
      for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) if (this.inside(x, y)) lock(y * W + x, e.lock);
    }
    // A footbridge's tiles open with its id, for everyone while it stands (the server puts the ids of the
    // places that stand in every pass).
    for (const o of source.objects) if (o.kind === 'footbridge') for (const [x, y] of objectTiles(o)) if (this.inside(x, y)) lock(y * W + x, o.id);
    this.keys = keys;
    this.all = new Set(keys);
    this.worksLights = source.objects.flatMap(o => (o.kind === 'lamp' && o.works ? [{ id: o.works, x: o.x, y: o.y }] : []));
    this.litTiles = new Uint8Array(W * H);
    this.warmTiles = new Uint8Array(W * H);
    this.roofTiles = new Uint8Array(W * H);
    // The water that freezes in winter is the map's own: the town never changes it.
    this.iceTiles = new Uint8Array(W * H);
    for (const water of source.ice ?? []) for (const [x, y] of water.tiles ?? []) if (this.inside(x, y) && this.kinds[y * W + x] === 'water') this.iceTiles[y * W + x] = 1;
    this.hasIce = this.iceTiles.includes(1);
    this.bedTiles = new Uint8Array(W * H);
    for (const [x, y] of source.drawdown?.tiles ?? []) if (this.inside(x, y) && this.kinds[y * W + x] === 'water') this.bedTiles[y * W + x] = 1;
    this.hasBed = this.bedTiles.includes(1);
    this.stepsHome = new Int32Array(W * H);
    this.stepsHomeFrozen = null;
    this.done = done;
    this.now = townData(source, done, pop);
    this.build();
  }

  /** The map as the town has it now: the objects standing on it (who is where, which lamps are dark) and its name. */
  get data(): MapData {
    return this.now;
  }

  /** The most steps any tile is from home: where a surge starts. 0 in towns and insides. */
  get deepest(): number {
    return this.deep;
  }

  /** What the town has come to, as this map follows it. */
  get town(): ReadonlySet<string> {
    return this.done;
  }

  /**
   * The town has come to `done` (town.ts): who is where, and which lamps and hearths are lit, follow it.
   * True when anything on this map changed.
   */
  setTown(done: ReadonlySet<string>, pop = 0): boolean {
    this.done = done;
    const next = townData(this.source, done, pop);
    if (sameMap(next, this.now)) return false;
    this.now = next;
    this.build();
    return true;
  }

  /** What stands where, what is lit and warm and under a roof, and how far each tile is from home: all from the objects standing now. */
  private build(): void {
    const W = this.width, data = this.now;
    this.blocked.fill(0);
    for (const o of data.objects) if (blocks(o)) for (const [x, y] of objectTiles(o)) if (this.inside(x, y)) this.blocked[y * W + x] = 1;
    // Every house can be entered: its door tile stays open (it is an exit to the house's inside).
    for (const o of data.objects) {
      if (o.kind !== 'house') continue;
      const d = doorOf(o);
      if (this.inside(d.x, d.y)) this.blocked[d.y * W + d.x] = 0;
    }
    // A lamp the town has not mended yet (or one gone dark) lights nothing.
    this.around(this.litTiles, o => o.kind === 'lamp' && !o.dark && !o.works && !this.outLamps.has(`${o.x},${o.y}`), LAMP_RADIUS);
    this.around(this.warmTiles, o => o.kind === 'fireplace', FIRE_RADIUS);
    this.roofTiles.fill(0);
    for (const o of data.objects) if (o.kind === 'porch') for (const [x, y] of objectTiles(o)) if (this.inside(x, y)) this.roofTiles[y * W + x] = 1;

    // Distance home, walking, the year round; and in winter, with the ice walked on too (or a lake's bed,
    // drawn down). Worked out again as the town changes what stands where, frozen or not as it is now.
    const frozen = this.frozen, drained = this.drained;
    this.frozen = this.drained = false;
    this.stepsHome = this.stepsFromHome();
    this.frozen = this.hasIce;
    this.drained = this.hasBed;
    this.stepsHomeFrozen = this.hasIce || this.hasBed ? this.stepsFromHome() : null;
    this.frozen = frozen;
    this.drained = drained;
    let deepest = 0;
    for (const v of this.stepsHome) if (v > deepest) deepest = v;
    this.deep = deepest;
    // A tile that opens only for some is as far from home as the way to it through the tiles that open
    // for everyone, then along the locked ones, in winter as the rest of the year.
    this.frozen = this.drained = false;
    this.relaxLocked(this.stepsHome);
    if (this.stepsHomeFrozen) {
      this.frozen = this.hasIce;
      this.drained = this.hasBed;
      this.relaxLocked(this.stepsHomeFrozen);
    }
    this.frozen = frozen;
    this.drained = drained;
  }

  /**
   * Gives each tile that opens only for some the distance of the way to it through the tiles that open for
   * everyone, then along the locked ones: the drain, a surge's front and the hitchhikers treat it like the
   * ground it joins, and no other tile's distance changes by it (a shortcut through the culvert makes the
   * bog no shallower). Few tiles, so they are relaxed until they settle.
   */
  private relaxLocked(steps: Int32Array): void {
    const W = this.width;
    if (this.data.kind !== 'wilds' || !this.keys.length) return;
    const locked: number[] = [];
    for (let i = 0; i < W * this.height; i++) if (this.locks[i]! >= 0 && this.blocked[i] === 0 && this.levels[i] === 0) locked.push(i);
    for (let changed = true; changed;) {
      changed = false;
      for (const i of locked) {
        const x = i % W, y = (i / W) | 0;
        let best = steps[i]! < 0 ? Infinity : steps[i]!;
        for (const [nx, ny] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]] as const) {
          if (!this.inside(nx, ny)) continue;
          const j = ny * W + nx, d = steps[j]!;
          // Its neighbors that anyone walks, and the locked ones measured so far.
          if (d >= 0 && (this.locks[j]! >= 0 || this.walkable(nx, ny)) && d + 1 < best) best = d + 1;
        }
        if (best < Infinity && best !== steps[i]) {
          steps[i] = best;
          changed = true;
        }
      }
    }
  }

  /**
   * Distance home, walking, as the map is walkable now: breadth-first from every home exit tile at
   * once. Only the wilds measure it; towns and the insides of buildings are safe, so every tile there
   * counts as 0.
   */
  private stepsFromHome(): Int32Array {
    const W = this.width, data = this.data;
    const steps = new Int32Array(W * this.height).fill(data.kind === 'wilds' ? -1 : 0);
    if (data.kind !== 'wilds') return steps;
    const queue: number[] = [];
    (data.exits ?? []).forEach(e => {
      if (!e.home) return;
      for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) {
        if (this.walkable(x, y) && steps[y * W + x] === -1) { steps[y * W + x] = 0; queue.push(y * W + x); }
      }
    });
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head]!, x = i % W, y = (i / W) | 0, d = steps[i]! + 1;
      for (const [nx, ny] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]] as const) {
        if (!this.walkable(nx, ny) || steps[ny * W + nx] !== -1) continue;
        steps[ny * W + nx] = d;
        queue.push(ny * W + nx);
      }
    }
    return steps;
  }

  /**
   * Winter comes (true) or goes: the water marked as ice is walked on while frozen, and the ways home
   * across it count. The same rule on the server and the client, which each set it as the season turns.
   * True when that changed what can be walked on here.
   */
  freeze(on: boolean): boolean {
    const frozen = on && this.hasIce;
    if (frozen === this.frozen) return false;
    this.frozen = frozen;
    return true;
  }

  /**
   * The lake draws down (true) or fills: its bed is walked on while drained, and the ways home across it
   * count. The server and the client each set it by the lake's clock (drawdownAt). True when that changed
   * what can be walked on here.
   */
  drain(on: boolean): boolean {
    const drained = on && this.hasBed;
    if (drained === this.drained) return false;
    this.drained = drained;
    return true;
  }

  /** Is this the bed of a lake that draws down, drawn down now or not? */
  bedAt(x: number, y: number): boolean {
    return this.inside(x, y) && this.bedTiles[y * this.width + x] === 1;
  }

  /** Is this lakebed walked on now (drawn down)? */
  drainedAt(x: number, y: number): boolean {
    return this.drained && this.bedAt(x, y);
  }

  /** Is the water here ice now (frozen, and marked to freeze)? */
  frozenAt(x: number, y: number): boolean {
    return this.frozen && this.iceAt(x, y);
  }

  /** Is this water that freezes in winter, frozen now or not? */
  iceAt(x: number, y: number): boolean {
    return this.inside(x, y) && this.iceTiles[y * this.width + x] === 1;
  }

  /** Where walking onto this tile takes you, if it is an exit. */
  exitAt(x: number, y: number): Arrival | undefined {
    const i = this.inside(x, y) ? this.exitIndex[y * this.width + x]! : -1;
    if (i < 0) return undefined;
    const e = this.data.exits[i]!;
    return { to: e.to, x: e.tx + (x - e.x), y: e.ty + (y - e.y), dir: e.dir };
  }

  /**
   * Is this tile in the light of a street lamp? (Light is for seeing; it does not give energy.) A lamp of
   * the works shines only while its place stands: while `standing` (a pass: the server's has the ids of
   * the places that stand) holds its id.
   */
  lit(x: number, y: number, standing?: Pass): boolean {
    if (!this.inside(x, y)) return false;
    if (this.litTiles[y * this.width + x] === 1) return true;
    if (standing) for (const l of this.worksLights) if (standing.has(l.id) && Math.hypot(x - l.x, y - l.y) <= LAMP_RADIUS) return true;
    return false;
  }

  /** Is this tile next to a fireplace, where energy comes back? */
  warm(x: number, y: number): boolean {
    return this.inside(x, y) && this.warmTiles[y * this.width + x] === 1;
  }

  /** Puts the street light at x,y out, or relights it: it lights nothing meanwhile, here and for everything that asks `lit`. False if nothing changed. */
  setLampOut(x: number, y: number, out: boolean): boolean {
    const k = `${x},${y}`;
    if (this.outLamps.has(k) === out) return false;
    if (out) this.outLamps.add(k); else this.outLamps.delete(k);
    this.build();
    return true;
  }

  /** Marks in `out` the tiles within `radius` of every object that `is`, center to center. */
  private around(out: Uint8Array, is: (o: MapObject) => boolean, radius: number): void {
    out.fill(0);
    const r = Math.ceil(radius);
    for (const o of this.now.objects) {
      if (!is(o)) continue;
      for (let y = o.y - r; y <= o.y + r; y++) for (let x = o.x - r; x <= o.x + r; x++) {
        if (this.inside(x, y) && Math.hypot(x - o.x, y - o.y) <= radius) out[y * this.width + x] = 1;
      }
    }
  }

  /** Is this tile under a roof out of doors (a porch), where the rain keeps off? */
  roofed(x: number, y: number): boolean {
    return this.inside(x, y) && this.roofTiles[y * this.width + x] === 1;
  }

  /** Walking steps from this tile to the nearest home exit (across the ice while it is frozen); 0 in towns and insides, -1 if there is no way. */
  homeSteps(x: number, y: number): number {
    if (!this.inside(x, y)) return -1;
    return ((this.frozen || this.drained) && this.stepsHomeFrozen ? this.stepsHomeFrozen : this.stepsHome)[y * this.width + x]!;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  kind(x: number, y: number): TileKind | undefined {
    return this.inside(x, y) ? this.kinds[y * this.width + x] : undefined;
  }

  level(x: number, y: number): number {
    return this.inside(x, y) ? this.levels[y * this.width + x]! : 0;
  }

  /** Where a watcher may wake, as y * width + x: where a creature may stand (creatureMayStand), `steps` from home, and never on ice, which thaws, nor on a lakebed, which fills. */
  lairs(steps: readonly [number, number]): number[] {
    const out: number[] = [];
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      const s = this.homeSteps(x, y);
      if (this.creatureMayStand(x, y) && !this.iceAt(x, y) && !this.bedAt(x, y) && s >= steps[0] && s <= steps[1]) out.push(y * this.width + x);
    }
    return out;
  }

  /**
   * Where a creature may stand, step or wake: open ground out of the light (of the works' lamps too, while
   * `standing` holds them), away from fires and exits, and never in tall grass (hidden).
   */
  creatureMayStand(x: number, y: number, standing?: Pass): boolean {
    return this.walkable(x, y) && !this.exitAt(x, y) && !this.lit(x, y, standing) && !this.warm(x, y) && !hidden(this, x, y);
  }

  /**
   * Can a character stand on this tile? Water, only where it is frozen now (winter's ice). A tile that
   * opens only for some (the culvert, a padlocked door) is walkable for whoever's `pass` holds what it
   * takes, and for nobody else: without a pass, never.
   */
  walkable(x: number, y: number, pass?: Pass): boolean {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !this.inside(x, y)) return false;
    const i = y * this.width + x;
    if (this.blocked[i] !== 0 || this.levels[i] !== 0) return false;
    const g = this.locks[i]!;
    if (g >= 0) return pass?.has(this.keys[g]!) === true;
    const kind = this.kinds[i];
    return (kind !== 'water' || (this.frozen && this.iceTiles[i] === 1) || (this.drained && this.bedTiles[i] === 1)) && kind !== 'forest' && kind !== 'wall';
  }

  /** What it takes to walk this tile, when only some may (a tool's id): undefined for a tile that is open, or shut, to everyone alike. */
  needs(x: number, y: number): string | undefined {
    const g = this.inside(x, y) ? this.locks[y * this.width + x]! : -1;
    return g >= 0 ? this.keys[g] : undefined;
  }

  /** Walkable for someone who holds everything this map's locked tiles take: what content checks ask (every door leads in, for someone). */
  passable(x: number, y: number): boolean {
    return this.walkable(x, y, this.all);
  }
}
