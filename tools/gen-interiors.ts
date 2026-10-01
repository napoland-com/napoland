/**
 * Generates the inside of every building, like the houses of FireRed: one small room per house door,
 * each a map of its own (content/maps/<id>.json). The rooms are drawn by hand below, as rows of wall
 * (x) and floor (p) plus the furniture, so they only change when this file does; re-running it
 * overwrites hand edits to their JSON. Usage: npm run gen:interiors
 *
 * Every room follows one plan, so going in and out always feels the same: walls all around; the way
 * out is the floor tile in the middle of the bottom wall, and it leads to the tile in front of the
 * house's door, facing down; you come in on the tile above it, facing up (also the room's spawn). A
 * fireplace stands against the top wall with floor in front: the tiles around it are where energy
 * comes back. A room without one is cold and dark. Rooms stay small so the camera shows all of one.
 * Every shelter out in the wilds whose fire people rest by keeps a crate for whoever comes next (a
 * `cache`, caches.ts), added last in its list so that nothing placed before it ever moves. The notes
 * people left (notes-left.ts) come after even that, each lying on a table, a shelf, a crate or a bed.
 *
 * The outside generators (gen-map.ts, gen-woods.ts, gen-garden.ts, gen-reservoir.ts...) put the exit on each house's door with
 * doorInto, which fails if the room expects its house somewhere else. This script checks the other
 * direction, so run it after them: each door on the outside maps must lead to its room's way in. Your own
 * house is behind the door of the house in your garden: each player's own copy of both.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TileMap, doorOf, hangs, objectTiles, underfoot, validateMap, type Comfort, type Dir, type MapData, type MapExit, type MapObject, type MapTown } from '../packages/shared/src';
import { noteAt } from './notes-left';

type House = Extract<MapObject, { kind: 'house' }>;

interface Room {
  /** Also the file name. */
  id: string;
  /** Shown as a banner when you walk in. */
  name: string;
  /** Bump when the room changes; a client with another version reloads. */
  version: number;
  /** The map the house stands on, and the house's door there (doorOf). */
  outside: string;
  door: readonly [number, number];
  rows: readonly string[];
  things: readonly MapObject[];
  /** One of NAPO's rooms (concrete), the mill's floor or a shed's (boards): its house outside must be of the same style. */
  style?: 'napo' | 'mill' | 'shed';
  /** A home of one's own (a room with the chest): each player who walks in is in a copy of it of their own. */
  private?: true;
  /** Where you wake up in it, by the fire: as a new player, and after a collapse. */
  wake?: { x: number; y: number; dir: Dir };
  /** What else about the room changes with the town (map.ts, MapTown): its name, once someone comes home to it. */
  town?: MapTown;
}

/** The camera shows about six tiles around you: a room this size fits on any screen. */
const MAX_W = 11, MAX_H = 8;

type Npc = Extract<MapObject, { kind: 'npc' }>;

// ---- People who come back to town with it (packages/shared/src/town.ts): each stands in a room only
// within the gate of the milestone that brings them, so the town is one for everyone. Their words here
// are what they always say; what they say once, at length, or about the sky and the town is in
// content/story.json (scenes and says).

/** Edith Lund, older, dry and practical: the house next to yours is hers. She waits out the years with Ruth in the bunker. */
const EDITH = { kind: 'npc', id: 'edith', name: 'Edith', look: { coat: '#5d586b', scarf: '#a8834a', hair: '#e4dfd4', skin: '#d6ad8e' } } as const;
const EDITH_BUNKER = [
  'Edith. Edith Lund. The house next to yours in town is mine. Has been for fifty years.',
  'NAPO said everybody out of town. Nobody said anything about the bunker, so here I am. Ruth doesn\'t mind. Ruth minds, but she doesn\'t say.',
  'I\'m not walking down to that barrier and out. I\'ve lived in Stonebrook all my life. I can wait out two weeks.',
  'The day that stone in town wakes up again, I\'m going home. Walt says it\'s close. Walt says a lot of things.',
  'Keep your feet dry. Nobody out here is going to knit you new socks.',
];
const EDITH_HOME = [
  'Come in and shut the door. The heat\'s for me, but you can stand in it.',
  'Somebody slept here while I was down the road. Folded my blankets, took four tins of beans, and left a note saying they\'d pay it back. I kept it.',
  'The girl left one too. A house next door with a light on, she wrote. That was your house. You\'ll have been asleep.',
  'The stone woke, so I came home. I said I would. I don\'t say things I don\'t do.',
  'Ruth sends her regards. She doesn\'t, but she would if she thought of it.',
];
/** Arvid Holm, who ran the mill's head saw: he comes back up from the bunker once the fires out there stay fed (mill-stove). */
const ARVID: Npc = {
  kind: 'npc', id: 'arvid', name: 'Arvid', x: 9, y: 2, dir: 'down', town: { from: 'mill-stove' },
  look: { coat: '#8a3a2e', scarf: '#2f3a36', hair: '#8c8780', skin: '#c49270' },
  lines: [
    'Arvid Holm. I ran the head saw in here thirty-one winters. Then came the winter it didn\'t open.',
    'The fires out there are lit again, enough that I thought: somebody\'s keeping this place. So I came up from the bunker.',
    'Nothing in here works but the stove. The stove always drew.',
    'The saw\'s still true. Nobody\'s touched it. I oil it anyway.',
    'Ruth said I\'d freeze up here. Ruth says that about everywhere.',
  ],
};
/** Maud, who cooked for NAPO's crews: she comes up to the lodge once the town thanks each other enough (lodge-cook). */
const MAUD: Npc = {
  kind: 'npc', id: 'maud', name: 'Maud', x: 7, y: 2, dir: 'down', town: { from: 'lodge-cook' },
  look: { coat: '#d8cfbd', scarf: '#9b3d34', hair: '#b8683e', skin: '#e9c6a6' },
  lines: [
    'Maud. I cooked for NAPO\'s crews, three shifts, till there were no crews. Then I cooked for Ruth, who eats like a bird.',
    'Folk up here thank each other, I hear. For fires, for arrows on the ground. A town that says thank you is a town worth cooking for.',
    'There\'s coffee by the fire when there\'s coffee. Take a thermos. Bring it back or don\'t: I\'ve a stack of NAPO\'s.',
  ],
};

const ROOMS: readonly Room[] = [
  {
    // Your cabin, a home of your own: whoever walks in through its door is in a copy of it that is theirs
    // alone. You wake up here, in front of the fire and facing the room (the door beyond the rug): the
    // first time you play, and after every collapse. The spawn is at its door. A small warm room, and
    // the fire never goes out. Side by side along the back wall, where this camera sees them whole: the
    // fire, the chest (your stash: what you put in it earns XP) and the workbench, which makes gear from
    // what the chest holds. The chest's front is warm, so you thaw out while you put things away, and the
    // workbench is one step on. The middle stays open from the door to the fire.
    // Years of damp spoiled the rest (comfort.ts): an iron stove in the corner, a shelf, a drying rack
    // by the fire, the bed, the rug and the lamp on the table stand spoiled in their places until you
    // make each again at the workbench, which sets it there at once.
    // Its door is the house's in your own garden (gen-garden.ts), and nothing else leads here: in the
    // corner by the bed, a step off the way from the door to the fire, stands NAPO's teleport, the same in
    // every house: A at it and you are in town, in front of its twin by the notice board, and A at that one
    // brings you home, in front of this one (roadmap/home-lots.md). A friend's visit sets them down there too.
    // The house is built up at the workbench (house.ts: a garage, a cabin, a house), and two things stand
    // here only once it is: the kitchen against the west wall, a step below the iron stove's corner (the
    // cabin), and the map table beside the teleport, to look at before you go out (the house). Until then
    // boxes stand in their places, so the room keeps its shape at every level. Neither stands where it
    // would wall off a place: the stove's is reached from the tile below it.
    id: 'stonebrook-home', name: 'Home', version: 8, outside: 'home-garden', door: [8, 5], private: true, wake: { x: 4, y: 2, dir: 'down' },
    rows: [
      'xxxxxxxxx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xxxxpxxxx',
    ],
    things: [
      { kind: 'fireplace', x: 4, y: 1 },
      { kind: 'chest', x: 5, y: 1 },
      { kind: 'workbench', x: 6, y: 1 },
      { kind: 'comfort', x: 1, y: 1, what: 'stove' },
      { kind: 'comfort', x: 2, y: 1, what: 'shelf' },
      { kind: 'comfort', x: 3, y: 1, what: 'rack' },
      { kind: 'comfort', x: 7, y: 1, what: 'bed' },
      { kind: 'comfort', x: 3, y: 2, what: 'rug' },
      { kind: 'comfort', x: 2, y: 4, what: 'lamp' },
      { kind: 'teleport', x: 7, y: 4 },
      { kind: 'kitchen', x: 1, y: 3, house: 2 },
      { kind: 'board', x: 6, y: 4, house: 3 },
    ],
  },
  {
    // Edith Lund's house, next door to yours: she stayed down the road in the NAPO Bunker with Ruth when
    // the town left, and it stood empty, cold hearth and dust, what she did not carry. The Barlows slept
    // here one night on their way out. Once the Old Stone wakes she comes home (town.ts, edith-home):
    // the hearth burns again, she sits by it, and the room is Edith's house; their notes stay on the
    // table, since she kept them.
    id: 'stonebrook-empty-house', name: 'The empty house', version: 3, outside: 'stonebrook', door: [15, 20],
    rows: [
      'xxxxxxxxx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xxxxpxxxx',
    ],
    town: { names: [{ from: 'edith-home', name: 'Edith\'s house' }] },
    things: [
      { kind: 'shelf', x: 2, y: 1 },
      { kind: 'crate', x: 6, y: 1 },
      { kind: 'crate', x: 7, y: 1 },
      { kind: 'crate', x: 7, y: 2 },
      { kind: 'crate', x: 3, y: 3 },
      { kind: 'table', x: 1, y: 4 },
      { kind: 'crate', x: 6, y: 5 },
      // Her hearth, cold until she comes home to it, and Edith by it once she has.
      { kind: 'fireplace', x: 4, y: 1, town: { from: 'edith-home' } },
      { ...EDITH, x: 5, y: 3, dir: 'down', lines: EDITH_HOME, town: { from: 'edith-home' } },
      // The Barlows slept here one night on their way out (notes-left.ts).
      noteAt('barlow-tins', 1, 4),
      noteAt('barlow-next-door', 2, 1),
    ],
  },
  {
    // The house that was Home before everyone who stayed moved out to a home of their own, which NAPO's
    // teleport by the notice board reaches (roadmap/home-lots.md), and what they had here went with them: a
    // cold hearth, the boxes nobody came back for, and a note on the table that says where they went, for
    // whoever still walks in here out of habit. Dark, like the houses the leavers left.
    id: 'stonebrook-old-home', name: 'The old home', version: 2, outside: 'stonebrook', door: [8, 20],
    rows: [
      'xxxxxxx',
      'xpppppx',
      'xpppppx',
      'xpppppx',
      'xpppppx',
      'xxxpxxx',
    ],
    things: [
      { kind: 'hearth', x: 3, y: 1 },
      { kind: 'boxes', x: 1, y: 1 },
      { kind: 'boxes', x: 5, y: 1 },
      {
        kind: 'paper', x: 1, y: 3, look: 'note', name: 'A note on the table',
        text: [
          'In Mira\'s round hand: "We carried your things out to a place of your own, in a clearing past the woods: an old garage with a garden round it. Everyone who stayed has one."',
          '"NAPO\'s teleport by the notice board takes you there, and the one in your garage brings you back. Your fire is lit."',
        ],
      },
    ],
  },
  {
    // Where the town gathers: the biggest room, long tables, and the fire in the middle of the back wall.
    // Its firewood is stacked against the east wall, split the way the town split it when it still
    // logged the woods. Walt Pruitt sits by the fire: he kept the north line for the power company and
    // then NAPO's, and remembers how it all went wrong. On the Long Night nobody tends that fire, and the
    // town keeps it going until dawn (longNight). At his elbow stands the lost and found box
    // (lostfound.ts), where whatever someone carries back for a stranger is left: its front, 2,3, is
    // beside where you stand to talk to him.
    id: 'stonebrook-lodge', name: 'Stonebrook Lodge', version: 8, outside: 'stonebrook', door: [8, 31],
    rows: [
      'xxxxxxxxxxx',
      'xpppppppppx',
      'xpppppppppx',
      'xpppppppppx',
      'xpppppppppx',
      'xpppppppppx',
      'xpppppppppx',
      'xxxxxpxxxxx',
    ],
    things: [
      { kind: 'fireplace', x: 5, y: 1, longNight: true },
      { kind: 'rug', x: 4, y: 2, w: 3, h: 2 },
      { kind: 'shelf', x: 1, y: 1 },
      { kind: 'shelf', x: 2, y: 1 },
      { kind: 'shelf', x: 8, y: 1 },
      { kind: 'shelf', x: 9, y: 1 },
      { kind: 'table', x: 2, y: 4 },
      { kind: 'table', x: 3, y: 4 },
      { kind: 'table', x: 7, y: 4 },
      { kind: 'table', x: 8, y: 4 },
      { kind: 'barrel', x: 1, y: 6 },
      { kind: 'barrel', x: 9, y: 6 },
      { kind: 'woodpile', x: 9, y: 3 },
      {
        kind: 'npc', id: 'walt', name: 'Walt', x: 3, y: 2, dir: 'down',
        look: { coat: '#5a4a3a', scarf: '#c98a2b', hair: '#9a958d', skin: '#c68b62', hat: '#d9a82b' },
        // What he swaps and the ledger come first, so a first talk says what the lodge is for; who would come
        // back to town, and what would bring them (town.ts: the milestones that bring Maud and Arvid), near
        // the end; the lost and found box at his elbow, last of all.
        lines: [
          'Pull up a chair. Pruitt. Walt. I kept the north line for the power company, and then NAPO\'s. I strung its wire from the station to the Tower.',
          'Glowcaps to spare? Ten buys you a cloth off me: I keep the lodge\'s lamps in them. Five scrap buys a road flare, company issue.',
          'The ledger on the stand is the town\'s. What\'s broken, and what it needs. Put down what you can spare.',
          'Before NAPO came, the Old Stone only hummed on cold nights. Nobody minded it.',
          'Then the hum got into the radios, and every compass in town pointed at the woods. That\'s when the Observatory came.',
          'The night they switched the Tower on, the woods lit up like a town and the Old Stone cracked. You can still see the crack.',
          'Every forty minutes since, the woods surge. Regular as a clock. You\'d think something out there was keeping time.',
          'NAPO said two weeks, and I went with the rest. Came back for my truck, up where the north road gives out. It never started again, so I stayed.',
          'Maud cooked for NAPO\'s crews, three shifts a day. She always said a town where folk thank each other is a town worth cooking for.',
          'Arvid Holm ran the head saw at the mill. He always said he\'d light its stove again once the fires out in the woods stay fed.',
          'Folks leave what they find here. Somebody\'s always glad of it.',
        ],
      },
      // The town's ledger (town.ts): what each broken part of town needs, and where anyone gives it. Walt keeps it.
      { kind: 'ledger', x: 1, y: 4 },
      // Maud, once the town has thanked each other enough to be worth cooking for.
      MAUD,
      // The lost and found box, at Walt's elbow. Last, so nothing placed before it moves.
      { kind: 'lostfound', x: 2, y: 2 },
    ],
  },
  {
    // The Near Woods' first shelter, past the crossroads, and the nearest to town. Abandoned once; now
    // somebody keeps the fire going, so it never goes out: a new player always has one safe fire (the
    // other shelters' fires burn down). A bunk, crates, not much else.
    id: 'near-woods-old-cabin', name: 'The old cabin', version: 4, outside: 'near-woods', door: [47, 38],
    rows: [
      'xxxxxxxxx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xxxxpxxxx',
    ],
    things: [
      { kind: 'fireplace', x: 4, y: 1, tended: true },
      { kind: 'bed', x: 1, y: 1 },
      { kind: 'shelf', x: 6, y: 1 },
      { kind: 'crate', x: 7, y: 1 },
      { kind: 'crate', x: 1, y: 3 },
      { kind: 'crate', x: 6, y: 3 },
      { kind: 'crate', x: 7, y: 3 },
      // A crate for whoever comes next, by the fire (caches.ts). Last, so nothing before it moves.
      { kind: 'cache', x: 2, y: 1, name: 'the old cabin\'s crate' },
      noteAt('ranger-fires', 6, 1),
      noteAt('ranger-deer', 7, 3),
      noteAt('barlow-old-cabin', 1, 3),
    ],
  },
  {
    // Behind the lonely lamp, the refuge of the west loop: one room, a bunk, the fire, a ranger's things.
    id: 'near-woods-ranger-hut', name: 'The ranger\'s hut', version: 3, outside: 'near-woods', door: [30, 6],
    rows: [
      'xxxxxxx',
      'xpppppx',
      'xpppppx',
      'xpppppx',
      'xpppppx',
      'xxxpxxx',
    ],
    things: [
      { kind: 'fireplace', x: 3, y: 1 },
      { kind: 'shelf', x: 1, y: 1 },
      { kind: 'bed', x: 5, y: 1 },
      { kind: 'table', x: 1, y: 3 },
      { kind: 'crate', x: 5, y: 4 },
      { kind: 'cache', x: 2, y: 3, name: 'the ranger\'s crate' },
      // Hers: the logbook on the shelf, the note on the table, one in the crate that only shows in the
      // dark, and under the pillow one that only shows on a green night.
      noteAt('ranger-rocks', 1, 1),
      noteAt('ranger-tall-ones', 1, 3),
      noteAt('ranger-dark', 5, 4),
      noteAt('ranger-green', 5, 1),
    ],
  },
  {
    // The deepest shelter, at the end of the east trail: the cabin whose light was always on. Somebody
    // lived here longer than anywhere else in the woods.
    id: 'near-woods-end-cabin', name: 'The cabin at the end', version: 3, outside: 'near-woods', door: [55, 4],
    rows: [
      'xxxxxxxxx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xxxxpxxxx',
    ],
    things: [
      { kind: 'fireplace', x: 3, y: 1 },
      { kind: 'rug', x: 2, y: 2, w: 3, h: 2 },
      { kind: 'shelf', x: 6, y: 1 },
      { kind: 'shelf', x: 7, y: 1 },
      { kind: 'table', x: 6, y: 3 },
      { kind: 'bed', x: 1, y: 4 },
      { kind: 'crate', x: 7, y: 5 },
      { kind: 'cache', x: 5, y: 1, name: 'the crate in the cabin at the end' },
      // The Barlows' home: Ellen's lists, Wren's notes, and the ranger's, in the ink that shows in the dark.
      noteAt('barlow-oil', 6, 1),
      noteAt('ranger-lamp', 7, 1),
      noteAt('barlow-crews', 6, 3),
      noteAt('barlow-tall-ones', 1, 4),
      noteAt('barlow-ferns', 7, 5),
    ],
  },
  {
    // The one shelter of the Far Woods (gen-far-woods.ts), beyond the gorge: the trapper's bunk, his traps
    // on their pegs, the wood he split, his tally on the table, and a fire nobody keeps: it burns down
    // unless whoever passes feeds it. His map of these woods lies by the tally for whoever has none (a
    // find: content/items.json). A crate for whoever comes next stands by the fire, last in the list.
    id: 'far-woods-trapper-cabin', name: 'The trapper\'s cabin', version: 1, outside: 'far-woods', door: [15, 62],
    rows: [
      'xxxxxxxxx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xxxxpxxxx',
    ],
    things: [
      { kind: 'fireplace', x: 4, y: 1 },
      { kind: 'bed', x: 1, y: 1 },
      { kind: 'traps', x: 6, y: 1 },
      { kind: 'shelf', x: 7, y: 1 },
      { kind: 'woodpile', x: 7, y: 3 },
      {
        kind: 'paper', x: 2, y: 3, look: 'list', name: 'Tally in pencil',
        text: [
          'A trapper\'s tally in pencil, the seasons down the side: marten, fisher, and one lynx, underlined twice.',
          'Along the bottom: "No sets past the split rock. Up there the traps come back sprung, and empty."',
          'Pressed in hard under it: "Never alone past the gorge. Feed the fire going in. Leave wood for the next one."',
        ],
      },
      { kind: 'crate', x: 7, y: 4 },
      { kind: 'cache', x: 2, y: 1, name: 'the trapper\'s crate' },
    ],
  },
  {
    // The one shelter of the Burn (gen-burn.ts): the trapper's line cabin, which the fire went round. His
    // bunk, a shelf, the wood he left, the line book on the table with its last page, and a fire nobody keeps:
    // it burns down unless whoever passes feeds it. His map of the line, redrawn after the fire, lies by the
    // book for whoever has none (a find: content/items.json). A crate for whoever comes next, last in the list.
    id: 'burn-line-cabin', name: 'The line cabin', version: 1, outside: 'burn', door: [13, 49],
    rows: [
      'xxxxxxx',
      'xpppppx',
      'xpppppx',
      'xpppppx',
      'xpppppx',
      'xxxpxxx',
    ],
    things: [
      { kind: 'fireplace', x: 3, y: 1 },
      { kind: 'bed', x: 1, y: 1 },
      { kind: 'shelf', x: 5, y: 3 },
      { kind: 'woodpile', x: 5, y: 4 },
      {
        kind: 'paper', x: 1, y: 3, look: 'note', name: 'The line book',
        text: [
          'The trapper\'s line book, its last page in pencil, the hand not steady.',
          '"Green over the ridge, then white, like a town lit where no town is. Every needle swung north and stayed."',
          '"By morning the fire came down the hill. It went round the cabin the way water goes round a stone."',
          '"The rocks where it came up ring when you touch them, and they are warm. Going down. Nobody works this line alone."',
        ],
      },
      {
        kind: 'paper', x: 4, y: 0, look: 'calendar', name: 'Calendar on the wall',
        text: [
          'A feed-store calendar, the days crossed off in charcoal a week past the night of the answer, then not.',
          'On the last page crossed off, in charcoal: "Rocks still warm. Needles still north. Traps come back empty, and clean."',
        ],
      },
      { kind: 'cache', x: 5, y: 1, name: 'the line cabin\'s crate' },
    ],
  },
  {
    // The one shelter of the Ridge (gen-ridge.ts): the trappers' high hut, stone below and logs above, under
    // the icefall. Three bunks for the three on the rope, the wood they carried up, the tally on the wall, and
    // a fire nobody keeps: it burns down unless whoever passes feeds it. Their map of the high line lies by the
    // tally for whoever has none (a find: content/items.json). A crate for whoever comes next, last in the list.
    id: 'ridge-high-hut', name: 'The high hut', version: 2, outside: 'ridge', door: [6, 39],
    rows: [
      'xxxxxxx',
      'xpppppx',
      'xpppppx',
      'xpppppx',
      'xpppppx',
      'xxxpxxx',
    ],
    things: [
      { kind: 'teleport', x: 4, y: 3, home: true },
      { kind: 'fireplace', x: 3, y: 1 },
      { kind: 'bed', x: 1, y: 1 },
      { kind: 'bed', x: 5, y: 2 },
      { kind: 'woodpile', x: 1, y: 4 },
      {
        kind: 'paper', x: 2, y: 0, look: 'calendar', name: 'The tally on the wall',
        text: [
          'Three names in pencil to every trip up the high line, a stroke for each, years of them. The last three are crossed out and written again, as if to be sure.',
          'Under them: "The needles turn up here too, but slowly, like they are thinking."',
          'And last, pressed hard: "The ice sang all night. We tied the rope off for three again at the top. Nobody comes up this line alone."',
        ],
      },
      { kind: 'shelf', x: 5, y: 1 },
      { kind: 'cache', x: 4, y: 1, name: 'the high hut\'s crate' },
    ],
  },
  {
    // The one shelter of the Marsh (gen-marsh.ts): the peat cutters' hut on the bog, where the town's cutters
    // slept in May. Their bunks, the peat they stacked to dry and never carried home, their tally of the cutting
    // and a fire nobody keeps: it burns down unless whoever passes feeds it. Their map of the bog lies by the
    // tally for whoever has none (a find: content/items.json). A crate for whoever comes next, last in the list.
    id: 'marsh-cutters-hut', name: 'The cutters\' hut', version: 2, outside: 'marsh', door: [12, 16],
    rows: [
      'xxxxxxx',
      'xpppppx',
      'xpppppx',
      'xpppppx',
      'xpppppx',
      'xxxpxxx',
    ],
    things: [
      { kind: 'teleport', x: 2, y: 3, home: true },
      { kind: 'fireplace', x: 3, y: 1 },
      { kind: 'bed', x: 1, y: 1 },
      { kind: 'bed', x: 5, y: 2 },
      { kind: 'woodpile', x: 5, y: 4 },
      {
        kind: 'paper', x: 1, y: 3, look: 'note', name: 'The cutting book',
        text: [
          'The cutters\' book, a line a day in May: how many rows cut, how many turned to dry.',
          'The last May, the lines get short: "Lights on the water again. Nobody went out to them."',
          'And last: "Left the peat stacked. Come back in August for it." Nobody did.',
        ],
      },
      { kind: 'shelf', x: 5, y: 1 },
      { kind: 'cache', x: 4, y: 1, name: 'the cutters\' crate' },
    ],
  },
  {
    // NAPO's field post in the hollow of the Far Woods where the rocks hum back, further gone than the
    // listening post by the ring of stones: a concrete room with no fire, a cot, the shelves and crates
    // of its field kit, and the desk with the post's log, NAPO's last word from up here. Cold and dark.
    id: 'far-woods-field-post', name: 'The NAPO field post', version: 2, outside: 'far-woods', door: [46, 8], style: 'napo',
    rows: [
      'xxxxxxx',
      'xpppppx',
      'xpppppx',
      'xpppppx',
      'xpppppx',
      'xxxpxxx',
    ],
    things: [
      { kind: 'teleport', x: 1, y: 2, home: true },
      { kind: 'shelf', x: 1, y: 1 },
      {
        kind: 'console', x: 3, y: 1, id: 'field-post-log', name: 'Field post log',
        text: [
          'NAPO · Field post, the hollow. It relays to the listening post by the ring of stones.',
          'Week 38. The rocks here hum back louder than the ring\'s. North of here the needles will not settle.',
          'After the answer: crews up in pairs, batteries changed every ten days. Nobody stays the night.',
          'The last page, in pencil: "Relief did not come. Batteries in the crate for whoever does."',
        ],
      },
      { kind: 'crate', x: 5, y: 1 },
      { kind: 'bed', x: 5, y: 3 },
      { kind: 'crate', x: 1, y: 4 },
    ],
  },
  {
    // The NAPO Bunker, the first building down the South Road and its nearest shelter to town: bunks,
    // NAPO's rules for staff on the wall, and Ruth, who keeps the fire going, so it never goes out.
    id: 'south-road-bunker', name: 'The NAPO Bunker', version: 5, outside: 'south-road', door: [42, 15], style: 'napo',
    rows: [
      'xxxxxxxxx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xxxxpxxxx',
    ],
    things: [
      { kind: 'fireplace', x: 4, y: 1, tended: true },
      { kind: 'bed', x: 1, y: 1 },
      { kind: 'shelf', x: 2, y: 1 },
      { kind: 'bed', x: 7, y: 1 },
      {
        kind: 'console', x: 6, y: 1, id: 'staff-notice', name: 'Staff notice',
        text: [
          'NAPO · What to do during an event.',
          'In a surge, get under a light and stay there until it passes.',
          'If a figure stands in the trees, keep facing it. It moves only while nobody looks.',
          'Keep a fire going. Keep a flare in your bag. Do not go out alone after dark.',
        ],
      },
      { kind: 'table', x: 2, y: 3 },
      { kind: 'crate', x: 7, y: 4 },
      {
        kind: 'npc', id: 'ruth', name: 'Ruth', x: 3, y: 3, dir: 'down',
        look: { coat: '#7d8f86', scarf: '#b33a3a', hair: '#2b2421', skin: '#8d5a3c' },
        lines: [
          'Come in out of the wet. I keep this fire going. The ones farther down the road, you\'ll have to feed yourself.',
          'I was NAPO\'s nurse. When they pulled out, somebody had to stay with the ones who wouldn\'t go.',
          'The station is down the road, past the cars. Vera is still in the laboratory. She says she\'s listening.',
          'Read the notice on the wall. NAPO got a lot of things wrong, but not those.',
          'The road ends at the checkpoint. Nobody has kept it in years. Don\'t go looking past the barrier.',
        ],
      },
      // Edith, one of the ones who would not go, until the Old Stone wakes and she goes home (town.ts, edith-home).
      { ...EDITH, x: 5, y: 3, dir: 'down', lines: EDITH_BUNKER, town: { until: 'edith-home' } },
      { kind: 'cache', x: 1, y: 3, name: 'the bunker\'s crate' },
      noteAt('ranger-ruth', 2, 1),
    ],
  },
  {
    // The NAPO Laboratory, in the research station's main building: benches, the station's log and a
    // radio still on, a stove against the back wall (it burns down unless someone feeds it), and Vera,
    // the last of NAPO's researchers, who never left.
    id: 'south-road-laboratory', name: 'The NAPO Laboratory', version: 4, outside: 'south-road', door: [23, 42], style: 'napo',
    rows: [
      'xxxxxxxxxxx',
      'xpppppppppx',
      'xpppppppppx',
      'xpppppppppx',
      'xpppppppppx',
      'xpppppppppx',
      'xpppppppppx',
      'xxxxxpxxxxx',
    ],
    things: [
      { kind: 'fireplace', x: 5, y: 1 },
      { kind: 'shelf', x: 1, y: 1 },
      {
        kind: 'console', x: 2, y: 1, id: 'station-log', name: 'Station log',
        text: [
          'Week 1. The Old Stone hums. So do the rocks deep in the woods: the same hum, at the same time.',
          'Week 30. When we play the hum back, it changes. It is not an echo. It is a reply.',
          'Week 52. The Tower is ready. Tonight we answer.',
          'The pages after that are blank.',
        ],
      },
      {
        kind: 'console', x: 8, y: 1, id: 'station-radio', name: 'Radio',
        text: [
          'The radio is on. Under the static, a low hum rises and falls.',
          'A card is taped to it, in Vera\'s hand: "Still listening. Day 3,041."',
        ],
      },
      { kind: 'shelf', x: 9, y: 1 },
      { kind: 'table', x: 1, y: 4 },
      { kind: 'table', x: 2, y: 4 },
      { kind: 'table', x: 8, y: 4 },
      { kind: 'table', x: 9, y: 4 },
      { kind: 'crate', x: 9, y: 5 },
      { kind: 'crate', x: 1, y: 6 },
      { kind: 'crate', x: 9, y: 6 },
      {
        kind: 'npc', id: 'vera', name: 'Vera', x: 7, y: 2, dir: 'down',
        look: { coat: '#d9d6cc', scarf: '#2f4a6b', hair: '#c9c2b0', skin: '#e0b793' },
        lines: [
          'Quietly, please. I\'m listening.',
          'The Old Stone hums, and so do the rocks deep in the woods. The same hum. They were answering each other long before we came.',
          'We thought we could answer too. One night we sent it back from the Tower. You\'ve seen what came back.',
          'The Tower still pulses every forty minutes, and the woods surge on the same clock. We set that clock.',
          'Switch the Tower off? Go and read the note on its panel first.',
          'Bring the shards back to the Old Stone. It is taking back what we broke off it.',
          'We called the tall ones observers. We watched the woods for years. Now something watches back.',
          'If NAPO is still out there, it isn\'t answering my radio.',
        ],
      },
      { kind: 'cache', x: 3, y: 1, name: 'the laboratory\'s crate' },
      noteAt('ranger-vera', 9, 4),
    ],
  },
  {
    // NAPO's dormitory: bunks for the crews who stopped coming, and a fire that burns down unless
    // someone feeds it.
    id: 'south-road-dormitory', name: 'The dormitory', version: 3, outside: 'south-road', door: [28, 41], style: 'napo',
    rows: [
      'xxxxxxxxx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xxxxpxxxx',
    ],
    things: [
      { kind: 'teleport', x: 3, y: 1, home: true },
      { kind: 'fireplace', x: 4, y: 1 },
      { kind: 'bed', x: 1, y: 1 },
      { kind: 'bed', x: 2, y: 1 },
      { kind: 'bed', x: 6, y: 1 },
      { kind: 'bed', x: 7, y: 1 },
      { kind: 'rug', x: 3, y: 2, w: 3, h: 1 },
      { kind: 'crate', x: 1, y: 4 },
      { kind: 'crate', x: 7, y: 4 },
      { kind: 'cache', x: 5, y: 3, name: 'the dormitory\'s crate' },
    ],
  },
  {
    // NAPO's stores: shelves and crates of equipment nobody came back for. No fire: dark and cold.
    id: 'south-road-stores', name: 'The stores', version: 1, outside: 'south-road', door: [22, 51], style: 'napo',
    rows: [
      'xxxxxxxxx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xxxxpxxxx',
    ],
    things: [
      { kind: 'shelf', x: 1, y: 1 },
      { kind: 'shelf', x: 2, y: 1 },
      { kind: 'crate', x: 4, y: 1 },
      { kind: 'shelf', x: 6, y: 1 },
      { kind: 'shelf', x: 7, y: 1 },
      { kind: 'crate', x: 1, y: 3 },
      { kind: 'crate', x: 2, y: 3 },
      { kind: 'crate', x: 7, y: 3 },
      { kind: 'barrel', x: 1, y: 4 },
      { kind: 'crate', x: 6, y: 4 },
      { kind: 'crate', x: 7, y: 4 },
    ],
  },
  {
    // The Tower's shed: the panel that works the Tower, with a note taped over its switch, and crates of
    // spare parts. No fire.
    id: 'south-road-tower-shed', name: 'The tower shed', version: 3, outside: 'south-road', door: [46, 44], style: 'napo',
    rows: [
      'xxxxxxx',
      'xpppppx',
      'xpppppx',
      'xpppppx',
      'xpppppx',
      'xxxpxxx',
    ],
    things: [
      { kind: 'crate', x: 1, y: 1 },
      {
        kind: 'console', x: 3, y: 1, id: 'tower-panel', name: 'Tower panel',
        text: [
          'NAPO Tower · relay control.',
          'Relay armed. Pulse every 40:00.',
          'A note is taped over the switch, in capitals: "DO NOT SWITCH OFF."',
        ],
      },
      { kind: 'crate', x: 5, y: 1 },
      { kind: 'shelf', x: 1, y: 3 },
      { kind: 'crate', x: 5, y: 4 },
      noteAt('walt-tower', 1, 3),
    ],
  },
  {
    // The checkpoint's booth on the quarantine line, at the end of the South Road: a stove that burns
    // down, a cot, and the log the last guard kept.
    id: 'south-road-checkpoint', name: 'The checkpoint', version: 4, outside: 'south-road', door: [40, 83], style: 'napo',
    rows: [
      'xxxxxxx',
      'xpppppx',
      'xpppppx',
      'xpppppx',
      'xpppppx',
      'xxxpxxx',
    ],
    things: [
      {
        kind: 'console', x: 1, y: 1, id: 'checkpoint-log', name: 'Checkpoint log',
        text: [
          'Day 1. Road closed on NAPO\'s orders. Everyone out, nobody in.',
          'Day 9. The last cars went through. The lights in the woods are brighter.',
          'Day 40. No relief again. The radio only plays the hum.',
          'Day 212. I can see the Tower\'s light from here. Every forty minutes the woods to the north light up.',
        ],
      },
      { kind: 'fireplace', x: 3, y: 1 },
      { kind: 'bed', x: 5, y: 1 },
      { kind: 'table', x: 1, y: 3 },
      { kind: 'crate', x: 5, y: 4 },
      { kind: 'cache', x: 2, y: 3, name: 'the checkpoint\'s crate' },
      noteAt('barlow-checkpoint', 1, 3),
    ],
  },
  // The houses of four families who left Stonebrook when NAPO said two weeks, and never came back
  // (gen-map.ts puts them on its streets, dark behind their curtains). Each room is as they left it
  // the night their street's turn came: cold, dust sheets over what they could not take, and one thing
  // to read that says a little of that night. Nothing burns in any of them.
  {
    // An older couple, and tidy: everything under a sheet, the boxes they packed and could not take
    // stacked by the door, and the calendar still on the month they left.
    id: 'stonebrook-okada-house', name: 'The Okada house', version: 1, outside: 'stonebrook', door: [5, 15],
    rows: [
      'xxxxxxxxx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xxxxpxxxx',
    ],
    things: [
      {
        kind: 'paper', x: 2, y: 0, look: 'calendar', name: 'Calendar',
        text: [
          'A calendar from the feed store, still on the month they left.',
          'One day is circled in red pencil: "Our turn. At the verge by six."',
          'Two weeks on, in the same pencil: "Home."',
        ],
      },
      { kind: 'bed', x: 1, y: 1 },
      { kind: 'hearth', x: 4, y: 1 },
      { kind: 'shelf', x: 7, y: 1 },
      { kind: 'sheeted', x: 6, y: 2 },
      { kind: 'sheeted', x: 3, y: 3 },
      { kind: 'boxes', x: 1, y: 4 },
      { kind: 'boxes', x: 2, y: 4 },
      { kind: 'table', x: 6, y: 4 },
    ],
  },
  {
    // A family with a girl of seven: her bed and her drawing of the lights in the woods pinned above it,
    // the toys they got as far as boxing, the rest under sheets.
    id: 'stonebrook-hale-house', name: 'The Hale house', version: 1, outside: 'stonebrook', door: [19, 15],
    rows: [
      'xxxxxxxxx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xxxxpxxxx',
    ],
    things: [
      {
        kind: 'paper', x: 2, y: 0, look: 'drawing', name: 'A child\'s drawing',
        text: [
          'Crayon on the back of a NAPO form: black trees, and green lights coming up between them.',
          'Across the top, in careful capitals: "THE LIGHTS IN THE WOODS. BY NORA, AGE 7."',
          'On the other side, the form is filled in halfway: "Hale, D. Motor pool."',
        ],
      },
      { kind: 'bed', x: 1, y: 1 },
      { kind: 'boxes', x: 3, y: 1 },
      { kind: 'sheeted', x: 7, y: 1 },
      { kind: 'rug', x: 3, y: 2, w: 3, h: 2 },
      { kind: 'sheeted', x: 6, y: 3 },
      { kind: 'table', x: 1, y: 4 },
      { kind: 'boxes', x: 6, y: 4 },
    ],
  },
  {
    // A young couple with a baby. They went the night their street was called, in a hurry: boxes half
    // packed, the crib left because it would not fit, and a note on the table for her mother.
    id: 'stonebrook-dahl-house', name: 'The Dahl house', version: 1, outside: 'stonebrook', door: [21, 27],
    rows: [
      'xxxxxxxxx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xxxxpxxxx',
    ],
    things: [
      { kind: 'shelf', x: 1, y: 1 },
      { kind: 'crib', x: 3, y: 1 },
      { kind: 'bed', x: 6, y: 1 },
      { kind: 'sheeted', x: 1, y: 3 },
      {
        kind: 'paper', x: 4, y: 3, look: 'note', name: 'Note on the table',
        text: [
          'Mom, they came by at nine. Our street goes tonight, so we go tonight.',
          'We took the baby\'s things and the photographs. The crib would not fit with the car seat in, so it stays.',
          'Key is under the blue pot. Water the fern if you get the chance. Kari',
        ],
      },
      { kind: 'boxes', x: 1, y: 4 },
      { kind: 'boxes', x: 2, y: 4 },
      { kind: 'boxes', x: 7, y: 4 },
    ],
  },
  {
    // The family by the mill: the father filed its saws. Their clock stopped on the mantel wall, the
    // rug still down, and the list of what to take and what to leave (the piano and the rocker are on
    // the verge by the south road, where the town waited its turn).
    id: 'stonebrook-lindqvist-house', name: 'The Lindqvist house', version: 1, outside: 'stonebrook', door: [25, 27],
    rows: [
      'xxxxxxxxx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xxxxpxxxx',
    ],
    things: [
      { kind: 'clock', x: 1, y: 1 },
      { kind: 'hearth', x: 4, y: 1 },
      { kind: 'shelf', x: 7, y: 1 },
      { kind: 'rug', x: 3, y: 2, w: 3, h: 1 },
      { kind: 'sheeted', x: 7, y: 2 },
      { kind: 'sheeted', x: 2, y: 3 },
      {
        kind: 'paper', x: 5, y: 3, look: 'list', name: 'List on the table',
        text: [
          'TAKE: papers, pills, the photo albums, Dad\'s saw files, the good blankets, the cat.',
          'LEAVE: the piano (ask about a truck), the rocker, the bird?',
          'Under it, in another pen: "No truck. Mrs. Okada says let the bird go."',
        ],
      },
      { kind: 'boxes', x: 1, y: 4 },
      { kind: 'bed', x: 7, y: 3 },
    ],
  },
  {
    // The old sawmill's floor, dark since it closed: the head saw against the back wall, the carriage on
    // its rails in front of it with the last log still dogged on, belts up to the line shaft, sawdust
    // drifted where it fell, and a few logs that were never cut. No fire and nobody, until Arvid, who ran
    // the head saw, comes back up to it and lights its stove (town.ts, mill-stove).
    id: 'stonebrook-sawmill', name: 'The sawmill', version: 2, outside: 'stonebrook', door: [36, 28], style: 'mill',
    rows: [
      'xxxxxxxxxxx',
      'xpppppppppx',
      'xpppppppppx',
      'xpppppppppx',
      'xpppppppppx',
      'xpppppppppx',
      'xxxxxpxxxxx',
    ],
    things: [
      { kind: 'shelf', x: 1, y: 1 },
      { kind: 'barrel', x: 3, y: 1 },
      { kind: 'crate', x: 4, y: 1 },
      { kind: 'saw', x: 5, y: 1 },
      { kind: 'crate', x: 6, y: 1 },
      { kind: 'barrel', x: 7, y: 1 },
      { kind: 'shelf', x: 9, y: 1 },
      { kind: 'carriage', x: 3, y: 2, w: 5 },
      { kind: 'sawdust', x: 4, y: 3 },
      { kind: 'sawdust', x: 6, y: 3 },
      { kind: 'sawdust', x: 7, y: 4 },
      { kind: 'logs', x: 1, y: 4, w: 2, h: 1 },
      { kind: 'crate', x: 9, y: 4 },
      { kind: 'crate', x: 9, y: 5 },
      { kind: 'sawdust', x: 3, y: 5 },
      // The mill's stove, cold since it shut, and Arvid by it once he comes back up to light it (town.ts, mill-stove).
      { kind: 'fireplace', x: 8, y: 1, town: { from: 'mill-stove' } },
      ARVID,
    ],
  },
  {
    // The ranger's shed, behind the hut in the Near Woods, padlocked (gen-woods.ts puts the lock on its
    // door: bolt cutters open it). Inside, the ranger's tools on a shelf, a crate, and the bench where
    // something that was not there the day before turns up again and again (a strange object, every half
    // hour: content/items.json), with the ranger's note about it. No fire: dark and cold.
    id: 'near-woods-shed', name: 'The ranger\'s shed', version: 1, outside: 'near-woods', door: [32, 3], style: 'shed',
    rows: [
      'xxxxx',
      'xpppx',
      'xpppx',
      'xpppx',
      'xxpxx',
    ],
    things: [
      { kind: 'shelf', x: 1, y: 1 },
      {
        kind: 'paper', x: 2, y: 1, look: 'note', name: 'Note on the bench',
        text: [
          'In pencil, on a page torn out of the ranger\'s log:',
          'Every morning there is something on this bench that was not here the night before.',
          'I put a padlock on the door. It still turns up.',
          'Take it to town and look at it in the light, if you must. Another one comes.',
        ],
      },
      { kind: 'crate', x: 3, y: 1 },
    ],
  },
  {
    // The keeper's house at the foot of the dam (gen-reservoir.ts), the Reservoir's one shelter: Agnes Brandt has
    // kept the dam from here for the Timber Co., and then for nobody, and she keeps the fire going (the region's
    // safe fire). Her bed, her shelf, NAPO's letter asking for the water down, and on her tables the keeper's
    // log. A crate for whoever comes next by the fire; her log last of all (notes-left.ts).
    id: 'reservoir-keepers-house', name: 'The keeper\'s house', version: 1, outside: 'reservoir', door: [4, 19],
    rows: [
      'xxxxxxxxx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xpppppppx',
      'xxxxpxxxx',
    ],
    things: [
      { kind: 'fireplace', x: 4, y: 1, tended: true },
      { kind: 'bed', x: 1, y: 1 },
      { kind: 'shelf', x: 7, y: 1 },
      { kind: 'table', x: 1, y: 3 },
      { kind: 'table', x: 7, y: 4 },
      {
        kind: 'paper', x: 2, y: 3, look: 'note', name: 'A letter from NAPO',
        text: [
          'On NAPO\'s paper, to the keeper of the Stonebrook dam: "Draw the reservoir down three metres by the 14th, for a survey of the valley floor. NAPO will meet the cost."',
          'Across it in pencil, pressed hard: "No. A. Brandt, keeper."',
          'Under that, smaller, in another hand: "They pay, Ag."',
        ],
      },
      {
        kind: 'npc', id: 'agnes', name: 'Agnes', x: 6, y: 2, dir: 'down',
        look: { coat: '#3e4f5c', scarf: '#b9b2a2', hair: '#cfc9c0', skin: '#dcb497' },
        lines: [
          'Agnes Brandt. I keep this dam. Kept it for the Timber Co., and when they went, I kept it for nobody.',
          'The water is mine to keep. That is the whole of the job, and I do it.',
          'Sit by the fire if you\'re cold. It doesn\'t go out. I see to that.',
          'The lake goes out by itself now and comes home. Don\'t be on the bed when it does.',
          'I don\'t go out there. A keeper keeps the water. She doesn\'t walk where it was.',
          'If you see a fire on the knoll, that\'s my husband. He made his choice.',
        ],
      },
      // A crate for whoever comes next, by the fire (caches.ts). Last, so nothing before it moves.
      { kind: 'cache', x: 2, y: 1, name: 'the keeper\'s crate' },
      noteAt('brandts-log-letter', 1, 3),
      noteAt('brandts-log-night', 7, 1),
      noteAt('brandts-log-hum', 7, 4),
    ],
  },
  {
    // The boathouse on the shore at the dam's end, Jon Brandt's: the boat and the sluice were his. Its door
    // opens onto the dam; from Jon's knoll in the lake, at high water, he rows you across into it (the knoll's
    // landing, gen-reservoir.ts). No fire: dark and cold. His sluice book, and an old slate of his.
    id: 'reservoir-boathouse', name: 'The boathouse', version: 1, outside: 'reservoir', door: [13, 7],
    rows: [
      'xxxxxxx',
      'xpppppx',
      'xpppppx',
      'xpppppx',
      'xxxpxxx',
    ],
    things: [
      { kind: 'shelf', x: 1, y: 1 },
      { kind: 'crate', x: 5, y: 1 },
      { kind: 'barrel', x: 5, y: 3 },
      {
        kind: 'paper', x: 3, y: 1, look: 'note', name: 'The sluice book',
        text: [
          'Jon Brandt\'s sluice book: forty years of openings, a line each. One turn, two turns, never more.',
          'The last line is the week before the answer, at two in the morning: "9 turns." No name after it.',
        ],
      },
      noteAt('brandts-slate-sluice', 1, 1),
    ],
  },
];

/** The way out: the middle of the bottom wall. You come in on the tile above it. */
function wayOut(room: Room): { x: number; y: number } {
  return { x: Math.floor(room.rows[0]!.length / 2), y: room.rows.length - 1 };
}

/**
 * The exit on a house's door into room `id`, for the generator of the map the house stands on. Fails
 * if the room expects its house somewhere else, so a house cannot move without its room following.
 */
export function doorInto(id: string, outside: string, house: House): MapExit {
  const room = ROOMS.find(r => r.id === id);
  if (!room) throw new Error(`there is no room ${id} in tools/gen-interiors.ts`);
  const d = doorOf(house);
  if (room.outside !== outside || room.door[0] !== d.x || room.door[1] !== d.y) {
    throw new Error(`the room ${id} expects its door at ${room.door.join(',')} in ${room.outside}, but this house's door is at ${d.x},${d.y} in ${outside}`);
  }
  if ((room.style ?? null) !== (house.style ?? null)) throw new Error(`the room ${id} is ${room.style ?? 'a cabin\'s'} style, but its house is ${house.style ?? 'a cabin'}`);
  const way = wayOut(room);
  return { x: d.x, y: d.y, w: 1, h: 1, to: id, tx: way.x, ty: way.y - 1, dir: 'up' };
}

function build(room: Room): MapData {
  const way = wayOut(room);
  return {
    id: room.id, name: room.name, version: room.version, kind: 'inside', depth: 0,
    width: room.rows[0]!.length, height: room.rows.length,
    tiles: [...room.rows],
    levels: room.rows.map(r => '0'.repeat(r.length)),
    spawn: { x: way.x, y: way.y - 1, dir: 'up' },
    exits: [{ x: way.x, y: way.y, w: 1, h: 1, to: room.outside, tx: room.door[0], ty: room.door[1] + 1, dir: 'down' }],
    objects: [...room.things],
    ...(room.style && { style: room.style }),
    ...(room.private && { private: room.private }),
    ...(room.wake && { wake: { ...room.wake } }),
    ...(room.town && { town: structuredClone(room.town) }),
  };
}

/** The plan every room follows, beyond what validateMap checks for any map. */
function planProblems(room: Room, map: MapData): string[] {
  const out: string[] = [];
  const W = map.width, H = map.height, way = wayOut(room);
  if (W % 2 === 0) out.push(`it is ${W} tiles wide: an odd width puts the way out in the middle`);
  if (W > MAX_W || H > MAX_H) out.push(`it is ${W}x${H}, bigger than ${MAX_W}x${MAX_H}: the camera would not show all of it`);
  room.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const outer = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      if (row[x] !== 'x' && row[x] !== 'p') out.push(`tile ${x},${y} is '${row[x]}': rooms are wall (x) and floor (p)`);
      else if (outer && row[x] !== 'x' && !(x === way.x && y === way.y)) out.push(`the outer wall has a gap at ${x},${y}`);
    }
  });
  const tm = new TileMap(map);
  for (const o of room.things) {
    // A calendar or a drawing hangs on the back wall, over the floor it is read from (validateMap checks the rest).
    const hung = o.kind === 'paper' && hangs(o.look);
    if (hung && (o.y !== 0 || room.rows[1]?.[o.x] !== 'p')) out.push(`the ${o.look} at ${o.x},${o.y} must hang on the top wall, over the floor`);
    else if (!hung && objectTiles(o).some(([x, y]) => room.rows[y]?.[x] !== 'p')) out.push(`the ${o.kind} at ${o.x},${o.y} is not on the floor`);
    if ((o.kind === 'fireplace' || o.kind === 'hearth') && (o.y !== 1 || !tm.walkable(o.x, o.y + 1))) out.push(`the ${o.kind} at ${o.x},${o.y} must stand against the top wall with floor in front`);
  }
  return out;
}

// One row or object per line, like the other maps, so changes show up as small, readable diffs.
function json(map: MapData): string {
  return [
    '{',
    `  "id": ${JSON.stringify(map.id)},`, `  "name": ${JSON.stringify(map.name)},`, `  "version": ${map.version},`,
    `  "kind": ${JSON.stringify(map.kind)},`, `  "depth": ${map.depth},`,
    `  "width": ${map.width},`, `  "height": ${map.height},`,
    '  "tiles": [', map.tiles.map(r => `    ${JSON.stringify(r)}`).join(',\n'), '  ],',
    '  "levels": [', map.levels.map(r => `    ${JSON.stringify(r)}`).join(',\n'), '  ],',
    `  "spawn": ${JSON.stringify(map.spawn)},`,
    ...(map.private ? ['  "private": true,'] : []),
    ...(map.wake ? [`  "wake": ${JSON.stringify(map.wake)},`] : []),
    ...(map.town ? [`  "town": ${JSON.stringify(map.town)},`] : []),
    '  "exits": [', map.exits.map(e => `    ${JSON.stringify(e)}`).join(',\n'), '  ],',
    '  "objects": [', map.objects.map(o => `    ${JSON.stringify(o)}`).join(',\n'), `  ]${map.style ? ',' : ''}`,
    ...(map.style ? [`  "style": ${JSON.stringify(map.style)}`] : []),
    '}',
    '',
  ].join('\n');
}

/** A glance at a room: # wall, . floor, + warm floor (next to the fire), v the way out, z where you wake up, letters for furniture. */
const GLYPH: Partial<Record<MapObject['kind'], string>> = {
  fireplace: 'F', bed: 'B', table: 'T', shelf: 'L', crate: 'c', barrel: 'b', woodpile: 'w', rug: '_', chest: 'H', workbench: 'W', console: 'K', npc: '@', ledger: 'D',
  hearth: 'f', sheeted: 's', boxes: 'n', crib: 'C', clock: 'k', paper: '?', saw: 'S', carriage: '=', sawdust: ':', logs: 'l', luggage: 'u', cache: 'X',
  traps: 't', teleport: 'N', lostfound: 'Y', kitchen: 'K', board: 'M',
};
/** The places for furniture in a home (comfort.ts), in lower case: what stands there, spoiled until it is made. */
const COMFORT_GLYPH: Record<Comfort, string> = { stove: 'o', bed: 'b', rug: '_', lamp: 'i', rack: 'r', shelf: 't' };
function glance(map: MapData): string[] {
  const tm = new TileMap(map);
  const things = new Map<string, string>();
  // Solid things first, so a rug under a table shows the table.
  for (const o of [...map.objects].sort((a, b) => Number(underfoot(b)) - Number(underfoot(a)))) {
    for (const [x, y] of objectTiles(o)) things.set(`${x},${y}`, o.kind === 'comfort' ? COMFORT_GLYPH[o.what] : GLYPH[o.kind] ?? '?');
  }
  const exit = map.exits[0]!;
  return map.tiles.map((row, y) => [...row].map((c, x) => {
    if (x === exit.x && y === exit.y) return 'v';
    if (map.wake && x === map.wake.x && y === map.wake.y) return 'z';
    const thing = things.get(`${x},${y}`);
    if (thing && thing !== '_') return thing;
    if (c === 'x') return '#';
    return tm.warm(x, y) ? '+' : thing ?? '.';
  }).join(''));
}

if (import.meta.main) {
  let failed = false;
  for (const room of ROOMS) {
    const map = build(room);
    const out = resolve(import.meta.dirname, `../content/maps/${map.id}.json`);
    writeFileSync(out, json(map));
    const kinds = [...new Set(map.objects.map(o => o.kind))].map(k => { const n = map.objects.filter(o => o.kind === k).length; return n > 1 ? `${k} x${n}` : k; });
    console.log(`wrote ${out}: "${map.name}", ${map.width}x${map.height}, ${kinds.join(', ')}; out to ${room.door[0]},${room.door[1] + 1} in ${room.outside}`);
    for (const row of glance(map)) console.log(`    ${row}`);
    const problems = [...planProblems(room, map).map(message => ({ level: 'error', message })), ...validateMap(map)];
    // Rooms are small and drawn by hand, so even a warning (floor nobody can reach) is a mistake here.
    for (const p of problems) console.log(`${p.level}: ${map.id}: ${p.message}`);
    if (problems.length) failed = true;
  }
  // The other direction of doorInto: the door on the outside map must lead to the room's way in. It is
  // written by the outside map's generator, so after changing a room's size, run that one again too.
  const GENERATOR: Record<string, string> = {
    stonebrook: 'npm run gen:map', 'near-woods': 'npm run gen:woods', 'south-road': 'npm run gen:south', 'far-woods': 'npm run gen:far-woods', burn: 'npm run gen:burn', ridge: 'npm run gen:ridge', marsh: 'npm run gen:marsh', reservoir: 'npm run gen:reservoir', 'home-garden': 'npm run gen:garden',
  };
  for (const room of ROOMS) {
    const outside = JSON.parse(readFileSync(resolve(import.meta.dirname, `../content/maps/${room.outside}.json`), 'utf8')) as MapData;
    const doors = outside.exits.filter(e => e.to === room.id), way = wayOut(room);
    const first = doors[0], inside = doors.every(e => e.tx === way.x && e.ty === way.y - 1);
    // One door, on the house, listed first; another way in (the boat from Jon's knoll, gen-reservoir.ts) comes into the same way in.
    const onDoor = doors.filter(e => e.x === room.door[0] && e.y === room.door[1]).length;
    if (first?.x === room.door[0] && first.y === room.door[1] && inside && onDoor === 1) continue;
    console.log(`error: ${room.outside}.json has no door at ${room.door.join(',')} into ${room.id}'s way in (${way.x},${way.y - 1}): run ${GENERATOR[room.outside] ?? `the generator of ${room.outside}`} again`);
    failed = true;
  }
  if (failed) process.exit(1);
}
