/**
 * The notes people left behind (docs/DESIGN.md, the story; packages/shared/src/notes.ts), all in one
 * place so they read as one story: the ranger, Walt Pruitt when he walked the line, the Barlows
 * from the cabin at the end, the people who left, and Agnes and Jon Brandt at the Reservoir. The generators lay each one where it belongs (noteAt), after everything
 * else on the map, so nothing that was there moves.
 *
 * The deeper a note lies, the more it says: a line or two near town, three in the deepest shelters.
 * Some only show at certain times: the ranger wrote what matters in glowcap mashed in resin, which
 * glows in the dark (night); Wren Barlow wrote her secrets in white crayon, which only wet paper shows
 * (rain, so those lie out of doors); and what was scratched with a shard shows on a green night
 * (aurora). None of them explains what the story keeps open (DESIGN.md, Still open).
 */
import type { MapObject, NoteAuthor, NoteWhen } from '../packages/shared/src';

type Note = Extract<MapObject, { kind: 'note' }>;
type Words = { by: NoteAuthor; name: string; text: string[]; when?: NoteWhen; faint?: string };

const GLOWS = 'Written in something that glows. In this light it is only a greenish smear.';
const WAX = 'The paper looks blank, and feels waxy. Wet, it might show something.';
const SCRATCHED = 'Scratched into the paper with something sharp. The scratches only show when the sky is green.';

export const NOTES = {
  // ---- The ranger: careful and practical, the weather and the animals; she kept the woods from the hut
  // behind the lonely light, and was the first to write down how the watchers move.
  'ranger-fires': {
    by: 'ranger', name: 'A note on the shelf',
    text: [
      'Resin burns longest. Cloth catches fastest. Green wood never: it smokes and gives nothing back.',
      'Whoever keeps this fire going when I am not here: thank you. Whoever you are.',
    ],
  },
  'ranger-deer': {
    by: 'ranger', name: 'Tucked in the crate',
    text: [
      'The deer left the meadow the week of the answer. The birds went a week before it, all in one morning.',
      'The ferns have not been still since. Something lies in them now, and it listens.',
    ],
  },
  'ranger-rocks': {
    by: 'ranger', name: 'A logbook on the shelf',
    text: [
      'Cold and clear. The rocks by the ring hum on cold nights, like the Old Stone in town. They always have.',
      'A man from NAPO asked who else knew about the rocks. I said nobody, and I showed him the way in.',
      'He came back with a crew, stakes and a mast. I should not have shown him.',
    ],
  },
  'ranger-tall-ones': {
    by: 'ranger', name: 'A note on the table',
    text: [
      'The tall ones. I watched one from this window for a whole night, and it never moved.',
      'When I turned to feed the fire, it stood nearer. They move only while nobody looks. I am writing it down, so somebody knows.',
      'Keep one in front of you and make for a light or a fire. They never come into the light.',
    ],
  },
  'ranger-dark': {
    by: 'ranger', name: 'A note in the crate', when: 'night', faint: GLOWS,
    text: [
      'If you can read this, it is dark, and they are out.',
      'Stay by the fire until grey light. The ferns are worst at night: they lie in them and listen for you.',
      'Glowcap mashed in resin keeps its glow for years. I write the ones that matter in it.',
    ],
  },
  'ranger-green': {
    by: 'ranger', name: 'Under the pillow', when: 'aurora', faint: SCRATCHED,
    text: [
      'Scratched with a shard: it only shows on a green night, and NAPO\'s crews never come out on a green night.',
      'They took stones from the ring to their field site. The ring has hummed louder every night since.',
      'I told Vera. She wrote it down, and asked me to tell nobody else. So I am telling you.',
    ],
  },
  'ranger-lamp': {
    by: 'ranger', name: 'A note on the shelf', when: 'night', faint: GLOWS,
    text: [
      'Ellen: if the lamp goes out, do not go for the matches in the dark. Sit where you can see the window, and watch it.',
      'They come to the glass when the light is out, but not while somebody watches.',
      'Keep Wren back from the ferns after dark. I will come by on the next clear day.',
    ],
  },
  'ranger-ruth': {
    by: 'ranger', name: 'A note on the shelf',
    text: [
      'Ruth: the Barlows are still out in the cabin at the end. Dan says they go when the crews stop coming.',
      'Look in on them if you can. I take them what I can carry.',
    ],
  },
  'ranger-vera': {
    by: 'ranger', name: 'A note on the bench',
    text: [
      'Vera: you asked what the woods were like before. Wind in the firs, the creek, deer at dusk. The stones hummed only in the cold.',
      'Now the woods keep time with your Tower. I think you know that.',
    ],
  },
  'ranger-turning': {
    by: 'ranger', name: 'A note on the table', when: 'night', faint: GLOWS,
    text: [
      'West of the ring the wood turns you round: three clearings alike as peas, and every way out but one puts you back by the stones.',
      'At the stump, go with the water. At the cairn, go to the stone that hums. At NAPO\'s stakes, turn round.',
      'NAPO\'s men followed their stakes in and came out by the ring, every time. I write this in glowcap so they never read it.',
    ],
  },
  'ranger-camp': {
    by: 'ranger', name: 'A note on the table',
    text: [
      'I have stopped going home. It is not the walk: the wood lets me through now, either way.',
      'The hut by the lamp has felt like somebody else\'s since the answer. This one does not.',
      'Whoever keeps my fire in while I am out: I would like to know you. Leave a word in the crate.',
    ],
  },
  'ranger-said-back': {
    by: 'ranger', name: 'A logbook on the shelf',
    text: [
      'Some mornings I go on past the camp. It is the Near Woods: every path and pond of them, and every one the wrong way round.',
      'It is always that night there: the sky green, the woods lit up to the north, the lamp with no wires lit, Walt\'s truck with its lights on.',
      'It is not a place. It is what the woods heard that night, said back.',
    ],
  },
  'ranger-kettle': {
    by: 'ranger', name: 'Under the pillow', when: 'aurora', faint: SCRATCHED,
    text: [
      'Scratched with a shard. On a green night I came back late and someone was sitting at my fire. My coat. My hat.',
      'They looked up when I did. I stood in the trees until it was grey, and when I came in the kettle was warm.',
      'I have not told Vera. I do not know how to write it so it reads as anything but mad.',
    ],
  },
  'ranger-walt': {
    by: 'ranger', name: 'Nailed to the pole',
    text: ['Walt: your line hums at night past the crossroads, and it has no business humming. Thought you should know.'],
  },

  // ---- Walt Pruitt, from when he walked the line: a lineman's shorthand, every pole by its tag (the north
  // line counts from town, N-1 to N-6 in Stonebrook and N-7 to N-16 in the woods; NAPO's own line carries none).
  'walt-n8': {
    by: 'walt', name: 'Nailed to the pole',
    text: ['N-8. Walked the line, 7 to 16. All sound. W.P.'],
  },
  'walt-n10': {
    by: 'walt', name: 'Nailed to the pole',
    text: ['N-10. Hum on the cond., no load on it. Grounded it. Still hums. Reported. W.P.'],
  },
  'walt-n11': {
    by: 'walt', name: 'Nailed to the pole',
    text: ['N-11. Compass on the dash points up the line, not north. Since spring. Office says get a new compass. W.P.'],
  },
  'walt-truck': {
    by: 'walt', name: 'In the glove box',
    text: [
      'Truck log, the night of the answer. Up N-16 at eleven, after the hum. Tower sent at 11:40. Wire jumped in my hands.',
      'Woods lit up to the north like a town. Truck dead where I left it. Don\'t remember the walk home. W.P.',
    ],
  },
  'walt-n12': {
    by: 'walt', name: 'Nailed to the pole',
    text: [
      'N-12. Line dead since the answer. Breaker\'s open in town: I opened it myself. Wire hums anyway.',
      'Don\'t touch it bare-handed. W.P.',
    ],
  },
  'walt-n14': {
    by: 'walt', name: 'Nailed to the pole',
    text: [
      'Ranger: I know. It\'s dead and it hums. On green nights the whole line sings, town to the old cabin.',
      'Pulled a span down here after a storm. A month on there was copper lying on the ground again, new. Nobody strung it. W.P.',
    ],
  },
  'walt-n16': {
    by: 'walt', name: 'Nailed to the pole', when: 'aurora', faint: SCRATCHED,
    text: [
      'N-16, end of the line. Scratched this with a shard, the ranger\'s trick. Only shows when the sky\'s green.',
      'Green nights, the dead wire sings from here to town. I climbed it on a green night. There is nothing on it.',
      'Tag\'s off this pole. Whoever finds it, keep it. W.P.',
    ],
  },
  'walt-tower': {
    by: 'walt', name: 'A note on the shelf',
    text: [
      'Strung the line from the station to the Tower in eleven days. NAPO paid double and never said what for.',
      'At the pulse it draws more than the whole town did in a winter. Every forty minutes. W.P.',
    ],
  },
  'walt-napo-line': {
    by: 'walt', name: 'Nailed to the pole',
    text: ['Ninth and last pole of NAPO\'s line. NAPO tags none of its poles, so I counted. Glass insulators the size of your head. W.P.'],
  },
  'walt-jam': {
    by: 'walt', name: 'Under the wiper',
    text: ['Line hasn\'t moved since noon, and nobody up front says why. I\'m walking back for my truck. W.P.'],
  },

  // ---- The Barlows, from the cabin at the end: Ellen's worried lists, Wren's own notes (she is nine),
  // and the way they walked out when NAPO's crews, which Dan drove, stopped coming.
  'barlow-tins': {
    by: 'barlows', name: 'A list on the table',
    text: ['Slept here one night. Used two blankets, folded them back. Took four tins of beans. We will pay it back. E. Barlow'],
  },
  'barlow-next-door': {
    by: 'barlows', name: 'A note on the shelf',
    text: ['There is a house next door with a light on. Mom says let them sleep. Wren'],
  },
  'barlow-old-cabin': {
    by: 'barlows', name: 'A note in the crate',
    text: [
      'The fire was going when we got here, and nobody about. We slept by it and left what we could spare.',
      'Dan, Wren and me, walking out. If the ranger comes by: we have gone. E.B.',
    ],
  },
  'barlow-oil': {
    by: 'barlows', name: 'A list on the shelf',
    text: [
      'Lamp oil: 2 cans. Matches, dry: 3 boxes. Flour. Wren\'s boots (too small by winter).',
      'Dan in with the crews Monday, back Thursday. Keep the lamp lit every night he is gone.',
      'Do not let Wren past the ferns. Do not let Wren past the ferns.',
    ],
  },
  'barlow-crews': {
    by: 'barlows', name: 'A list on the table',
    text: [
      'Lamp oil: half a can. Matches: 1 box. Flour: none. The crews have not come in two weeks.',
      'Dan went down to the station to ask. Only Vera is there, he says, at her radio, and she does not know either.',
      'We go when the weather turns. The ranger says the south road is calm. E.',
    ],
  },
  'barlow-tall-ones': {
    by: 'barlows', name: 'Under the pillow',
    text: [
      'The tall ones only move when you do not look. I looked at one all day from the window and it did not move once.',
      'Mom says do not look at them. I think you should look at them. That is the whole trick.',
      'Dad says when the crews stop coming he takes the truck back to NAPO, and then we go. Wren, 9',
    ],
  },
  'barlow-ferns': {
    by: 'barlows', name: 'Tucked in the crate',
    text: [
      'The ferns rustle before one comes. Then it goes quiet, and the quiet is the bad part. Mom says get to the lamp.',
      'I have a whistle. Mom has a whistle. The ranger has no whistle, only a compass that points one way.',
    ],
  },
  'barlow-wiper': {
    by: 'barlows', name: 'Under the wiper', when: 'rain', faint: WAX,
    text: [
      'In the rain, white crayon shows on the wet paper, pale on grey:',
      'WE WALKED OUT TODAY, ALL THREE OF US. NOBODY SAW US GO. SECRET. W.',
    ],
  },
  'barlow-cars': {
    by: 'barlows', name: 'On the suitcases', when: 'rain', faint: WAX,
    text: [
      'In the rain, white crayon shows on the wet paper:',
      'ALL THE CARS ARE EMPTY. ONE HAS A DOG BLANKET AND NO DOG. I HOPE THE DOG WALKED TOO. W.',
    ],
  },
  'barlow-checkpoint': {
    by: 'barlows', name: 'A note on the table',
    text: [
      'Nobody at the checkpoint. The barrier is down, the lamp is out, and the book lies open on the desk.',
      'We waited a day and a night, and nobody came. Dan says we go on in the morning, and so we will.',
      'Whoever reads this: we were the Barlows, from the cabin at the end. If you pass it, keep the lamp lit. Ellen',
    ],
  },

  // ---- The people who left: a tag on each of four cars of the jam, one for every family whose house is
  // dark in Stonebrook (the family name is the one on the mailbox). Each says the street and what rode in
  // that car; none says where they went, and nothing on any map joins a tag to a house.
  'leavers-okada': {
    by: 'leavers', name: 'A luggage tag',
    text: [
      'OKADA. The main street, Stonebrook, the house with the neat black letters on the box.',
      'Two suitcases and the good kettle. The birdcage rides on the back seat, empty. Two weeks, they said.',
    ],
  },
  'leavers-hale': {
    by: 'leavers', name: 'A luggage tag',
    text: [
      'THE HALES. The main street, Stonebrook, under the street light.',
      'A pencil case and a blanket in the back. Nora is seven and drew the whole way out of town.',
    ],
  },
  'leavers-dahl': {
    by: 'leavers', name: 'A luggage tag on the child seat',
    text: [
      'DAHL. The old road to the mill, Stonebrook.',
      'The child seat is in and the crib is not: it would not fit. The door is open for the last bag. Then the line moved, and then it did not.',
    ],
  },
  'leavers-lindqvist': {
    by: 'leavers', name: 'A luggage tag',
    text: [
      'LINDQVIST. The old road to the mill, Stonebrook.',
      'Dad\'s saw files, in a roll on the back seat, and the winter coats. The piano would not go. It stayed on the verge.',
    ],
  },

  // ---- Agnes and Jon Brandt, at the Reservoir (gen-reservoir.ts): she keeps the dam, he ran the boat and the
  // sluice. Her keeper's log lies in the keeper's house and on the dam; his chalk slates lie out on the lakebed,
  // read only at low water, at his camp on the knoll and in his boathouse. Each tells one side, and neither
  // crosses: whoever reads both carries the words. Her last page says what is still open: the Sister hums
  // before the Tower pulses, not after.
  'brandts-log-dam': {
    by: 'brandts', name: 'A page of the keeper\'s log, under a stone',
    text: [
      'Level at the mark. Sluice shut, checked twice. I check it twice now.',
      'His fire on the knoll again tonight. I don\'t wave.',
    ],
  },
  'brandts-log-letter': {
    by: 'brandts', name: 'The keeper\'s log, open on the table',
    text: [
      'NAPO wants the water down three metres, for a survey. I wrote no. A keeper keeps the water.',
      'Jon says they pay. Jon says a lot of things after supper.',
    ],
  },
  'brandts-log-night': {
    by: 'brandts', name: 'A page of the keeper\'s log',
    text: [
      'Woke at two and the house was too quiet. The sluice was open and his boots were gone.',
      'By morning the top of the valley was out of the water, and her with it. I would have left her there.',
    ],
  },
  'brandts-log-hum': {
    by: 'brandts', name: 'The last page of the keeper\'s log',
    text: [
      'The water goes out by itself now, twice to every pulse of the Tower. I time it from the dam. She hums first.',
      'Not after the Tower. Before it. She doesn\'t answer. She starts it.',
    ],
  },
  'brandts-slate-car': {
    by: 'brandts', name: 'A slate under the wiper',
    text: [
      'Chalk on a slate: The first night it went out I walked to her, just to look. Then the water came home behind me.',
      'I made the knoll. I have been here since. J.',
    ],
  },
  'brandts-slate-table': {
    by: 'brandts', name: 'A slate on the farm table',
    text: [
      'Chalk on a slate: Somebody ate their last supper at this table before the water came. I would like one more.',
      'Going back to the dam? She keeps the kettle left of the stove. Not that she\'d put it on for me.',
    ],
  },
  'brandts-slate-camp': {
    by: 'brandts', name: 'A slate on the crate',
    text: [
      'Chalk on a slate: I opened the sluice for NAPO\'s money. Then she came up out of the water, and then the lights.',
      'I woke her. I am not leaving her out here alone.',
    ],
  },
  'brandts-slate-sluice': {
    by: 'brandts', name: 'A slate on the shelf',
    text: [
      'Chalk on a slate, old and smudged: Sluice wheel, two turns, never more. J. B.',
      'Under it, newer, in the same hand: I gave it nine.',
    ],
  },
} as const satisfies Record<string, Words>;

export type NoteId = keyof typeof NOTES;

/** The note `id`, lying on tile x,y (on whatever is there: a table, a shelf, a pole, a car). */
export function noteAt(id: NoteId, x: number, y: number): Note {
  const w: Words = NOTES[id];
  return {
    kind: 'note', x, y, id, by: w.by, name: w.name, text: [...w.text],
    ...(w.when ? { when: w.when } : {}), ...(w.faint ? { faint: w.faint } : {}),
  };
}
