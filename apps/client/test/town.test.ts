import { describe, expect, it } from 'vitest';
import { ledgerLines, type ClientMsg, type ItemsData, type MapData, type PlayerView, type ProgressView, type StoryData } from '@napoland/shared';
import { Game } from '../src/game';
import { Items, refusalText } from '../src/items';
import { NOTHING_YET, peopleHtml, peopleView, personHeading } from '../src/journal';
import { Maps } from '../src/maps';
import { didText, didWho, giveQuestion, swapQuestion } from '../src/said';
import { newsBanner } from '../src/status';
import { tinyTown, tinyWoods, welcome, type Extras } from './fixtures';

/**
 * Stonebrook wakes up, as the game shows it (town.ts): the town the server says, which every map follows;
 * Walt's swaps and the town's ledger, each offered once his lines or the ledger's are done; scenes told
 * once, kept in the journal's People; what people say about the sky and the town.
 *
 * Testbrook with Walt at 5,1 (talk to him from 5,2 facing up), the town's ledger at 5,3 (read it from 5,2
 * facing down) and Edith at 1,3 (from 1,4 facing up) until she is home. The woods storm now and then.
 */
const town = (): MapData => ({
  ...tinyTown(),
  objects: [
    ...tinyTown().objects,
    { kind: 'npc', x: 5, y: 1, id: 'walt', name: 'Walt', dir: 'down', lines: ['Pull up a chair.'] },
    { kind: 'ledger', x: 5, y: 3 },
    { kind: 'npc', x: 1, y: 3, id: 'edith', name: 'Edith', dir: 'down', lines: ['Waiting.'], town: { until: 'edith-home' } },
  ],
  town: { sign: { x: 1, y: 1, pop: 2 } },
});
const woods = (): MapData => ({ ...tinyWoods(), storm: { every: 1000, warn: 100, length: 100 } });

const DATA: ItemsData = {
  version: 4,
  items: [
    { id: 'glowcap', name: 'Glowcap', kind: 'resource', stack: 30, text: 'Glows.' },
    { id: 'cloth', name: 'Cloth scraps', noun: 'cloth', plural: 'cloth', kind: 'resource', stack: 10, text: 'Cloth.' },
    { id: 'scrap', name: 'Scrap metal', noun: 'scrap', plural: 'scrap', kind: 'resource', stack: 10, text: 'Scrap.' },
    { id: 'wire', name: 'Copper wire', noun: 'copper wire', plural: 'copper wire', kind: 'resource', stack: 10, text: 'Wire.' },
    { id: 'flare', name: 'Road flare', kind: 'consumable', stack: 3, text: 'Red.', use: { flare: 45 } },
  ],
  finds: [],
  swaps: [
    { id: 'glowcaps-for-cloth', who: 'walt', give: { item: 'glowcap', count: 10 }, get: { item: 'cloth', count: 1 } },
    { id: 'scrap-for-flare', who: 'walt', give: { item: 'scrap', count: 5 }, get: { item: 'flare', count: 1 } },
  ],
  town: {
    pop: 2,
    milestones: [{ id: 'edith-home', when: { count: 'woke', n: 1 }, back: 'Edith', title: 'Edith is home', text: 'A fire burns next door.' }],
    works: [
      { id: 'lights', name: 'The street lights', needs: [{ item: 'wire', count: 2 }, { item: 'scrap', count: 1 }], perk: 'The street is lit at night.', title: 'Lit', text: 'The street lights are on.' },
      { id: 'roof', name: 'A roof over the board', needs: [{ item: 'cloth', count: 2 }], perk: 'Under it you dry off.', title: 'A roof', text: 'The board has a roof.' },
    ],
  },
};
const ITEMS = new Items(DATA);
const STORY: StoryData = {
  version: 2,
  chapters: [{ id: 'home', title: 'Home', text: 'You woke up at home.' }],
  scenes: [
    { id: 'walt-hum', who: 'walt', title: 'The hum', when: { level: 2, notes: ['walt-n10'] }, lines: ['The wires hummed that night.', 'I never told anyone <then>.'] },
    { id: 'walt-edith', who: 'walt', title: 'Edith', when: { town: 'edith-home' }, lines: ['Edith is home.'] },
  ],
  says: [
    { who: 'walt', when: { town: 'edith-home' }, line: 'Smoke from Edith\'s chimney.' },
    { who: 'walt', when: { sky: 'rain' }, line: 'Rain on the lodge roof. I like it.' },
    { who: 'walt', when: { sky: 'storm' }, line: 'Storm over the woods. Stay in.' },
  ],
};
const LEVEL_2: ProgressView = { xp: 30, level: 2, from: 30, to: 120, maxEnergy: 105 };
const me = (x: number, y: number, dir: PlayerView['dir']): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir, color: '#d9a53a', gear: {}, quirks: [] });

/**
 * A game at x,y in Testbrook facing `dir` (at 5,2 facing up: Walt), welcomed with `extras` (it rains), the
 * notes read and the counts given; what it sends goes in `sent`. Every game has maps of its own: they keep the town.
 */
function game(sent: ClientMsg[] = [], at: { x?: number; y?: number; dir?: PlayerView['dir'] } = {}, extras: Extras = {}, more: { notes?: string[]; scenes?: number } = {}): Game {
  const g = new Game(new Maps([town(), woods()]), m => sent.push(m), ITEMS, STORY);
  const w = welcome(town(), [me(at.x ?? 5, at.y ?? 2, at.dir ?? 'up')], undefined, { story: { version: STORY.version, chapter: 'home' }, ...extras });
  g.handle({ ...w, notes: more.notes ?? [], stats: more.scenes ? { scenes: more.scenes } : {} }, 1000);
  return g;
}
/** Presses on until someone's lines are done. */
const close = (g: Game) => { while (g.dialog) g.pressB(); };
const edithHere = (g: Game) => {
  g.pressA();
  const who = g.dialog?.who;
  close(g);
  return who === 'Edith';
};

describe('the town, in the game', () => {
  it('follows the town from the welcome: who stands where, and every map as the town has it', () => {
    expect(edithHere(game([], { x: 1, y: 4, dir: 'up' }))).toBe(true);
    const g = game([], { x: 1, y: 4, dir: 'up' }, { town: { done: ['edith-home'], given: {} } });
    expect(edithHere(g)).toBe(false);
    expect(g.town).toEqual({ done: ['edith-home'], given: {} });
    // The welcome is how things stand, not news.
    expect(g.news.filter(n => n.kind === 'town')).toEqual([]);
  });

  it('moves on as the server says: the map you are on is drawn again, and what it just came to is news with a banner', () => {
    const g = game([], { x: 1, y: 4, dir: 'up' });
    const changes = g.townChanges;
    g.handle({ t: 'town', town: { done: [], given: { lights: { wire: 1 } } } }, 2000);
    expect(g.townChanges).toBe(changes + 1);
    // Something given changes no map.
    expect([...g.townMaps]).toEqual([]);
    g.handle({ t: 'town', town: { done: ['edith-home'], given: { lights: { wire: 1 } } } }, 3000);
    expect([...g.townMaps]).toEqual(['town']);
    expect(edithHere(g)).toBe(false);
    expect(g.news.filter(n => n.kind === 'town')).toEqual([{ kind: 'town', id: 'edith-home', pop: 3 }]);
    expect(newsBanner({ kind: 'town', id: 'edith-home', pop: 3 }, 'Testbrook', ITEMS)).toEqual({ title: 'Edith is home', sub: 'A fire burns next door.\nThe sign in town says 3 now.' });
    // A work done brings nobody back: no number.
    expect(newsBanner({ kind: 'town', id: 'roof', pop: 3 }, 'Testbrook', ITEMS)).toEqual({ title: 'A roof', sub: 'The board has a roof.' });
    // Something this release does not know: nothing to say.
    expect(newsBanner({ kind: 'town', id: 'long-gone', pop: 3 }, 'Testbrook', ITEMS)).toBeNull();
    // What it came to before is no news again.
    g.handle({ t: 'town', town: { done: ['edith-home'], given: {} } }, 4000);
    expect(g.news.filter(n => n.kind === 'town')).toHaveLength(1);
    expect([...g.townMaps]).toEqual([]);
  });

  it('chalks the new number on the town\'s sign', () => {
    const g = game([], { x: 1, y: 2, dir: 'up' }, { town: { done: ['edith-home'], given: {} } });
    g.pressA();
    expect(g.dialog?.lines).toEqual(['Testbrook', 'Pop. 2', 'The 2 is crossed out in chalk. Beside it, in the same chalk: 3.']);
  });
});

describe('the maps, as the town has them', () => {
  it('are built as the town has it now, and say which of those built changed when it moves on', () => {
    const m = new Maps([town(), woods()]);
    const edith = (d: MapData | undefined) => d!.objects.some(o => o.kind === 'npc' && o.id === 'edith');
    expect(edith(m.find('town'))).toBe(true);
    const built = m.get({ id: 'town', version: 1 })!;
    expect(m.setTown(new Set(['edith-home']), 3)).toEqual(new Set(['town']));
    expect(edith(built.data)).toBe(false);
    expect(m.find('town')).toBe(built.data);
    // Already so: nothing changed.
    expect(m.setTown(new Set(['edith-home']), 3)).toEqual(new Set());
    // A map not built yet is found as the town has it, and built so.
    const later = new Maps([town(), woods()]);
    later.setTown(new Set(['edith-home']), 3);
    expect(edith(later.find('town'))).toBe(false);
    expect(edith(later.get({ id: 'town', version: 1 })!.data)).toBe(false);
    expect(later.all().map(d => d.id)).toEqual(['town', 'woods']);
    expect(later.find('woods')).toEqual(woods());
  });
});

describe('Walt\'s swaps', () => {
  it('are offered once his lines are done, one by one, as many times over as you carry for; yes sends it, and the box says what he did', () => {
    const sent: ClientMsg[] = [];
    const g = game(sent, {}, { bag: [{ item: 'glowcap', count: 25 }, { item: 'scrap', count: 5 }] });
    g.pressA();
    expect(g.dialog?.lines).toEqual(['Rain on the lodge roof. I like it.', 'Pull up a chair.']);
    expect(g.question).toBeNull();
    close(g);
    expect(g.askView()).toMatchObject({ who: 'Walt', text: 'Swap 10 glowcaps for 1 cloth?', count: { n: 1, min: 1, max: 2 } });
    g.holdCount(1, 2000);
    g.holdCount(0, 2000);
    expect(g.askView()?.text).toBe('Swap 20 glowcaps for 2 cloth?');
    g.answer('yes');
    expect(sent.at(-1)).toEqual({ t: 'swap', x: 5, y: 1, swap: 'glowcaps-for-cloth', count: 2 });
    g.handle({ t: 'did', did: { kind: 'swapped', swap: 'glowcaps-for-cloth', count: 2 } }, 2000);
    expect(g.noteView(2000)).toMatchObject({ who: 'Walt', text: 'Walt takes 20 glowcaps and hands you 2 cloth.' });
    // Then the next one he makes, once the box is free: no is no, and nothing more is asked.
    g.pressA();
    expect(g.askView()?.text).toBe('Swap 5 scrap for a road flare?');
    g.answer('no');
    expect([g.question, g.note]).toEqual([null, null]);
    expect(sent.filter(m => m.t === 'swap')).toHaveLength(1);
  });

  it('are not offered for what you do not carry enough of, and go when you do', () => {
    const g = game([], {}, { bag: [{ item: 'glowcap', count: 9 }] });
    g.pressA();
    close(g);
    expect(g.question).toBeNull();
    const h = game([], {}, { bag: [{ item: 'glowcap', count: 10 }] });
    h.pressA();
    h.disconnected(2000);
    close(h);
    expect(h.question).toBeNull();
  });

  it('say in words what goes and what comes', () => {
    const [cloth, flare] = ITEMS.swaps;
    expect(swapQuestion(cloth!, 3, ITEMS)).toBe('Swap 30 glowcaps for 3 cloth?');
    expect(swapQuestion(flare!, 2, ITEMS)).toBe('Swap 10 scrap for 2 road flares?');
    const ctx = { name: (id: string) => (id === 'walt' ? 'Walt' : undefined), town: { view: { done: [], given: {} }, works: DATA.town!.works, swaps: ITEMS.swaps } };
    expect(didWho({ kind: 'swapped', swap: 'scrap-for-flare', count: 1 }, ITEMS, ctx)).toBe('Walt');
    expect(didText({ kind: 'swapped', swap: 'scrap-for-flare', count: 1 }, ITEMS, ctx)).toBe('Walt takes 5 scrap and hands you a road flare.');
    // A swap this release does not know.
    expect(didWho({ kind: 'swapped', swap: 'gone', count: 1 }, ITEMS, ctx)).toBe('Swap');
    expect(didText({ kind: 'swapped', swap: 'gone', count: 1 }, ITEMS, ctx)).toBe('The swap is made.');
    expect(refusalText('missing', 'swap')).toBe('You do not carry enough of it');
    expect(refusalText('missing', 'craft')).toBe('Your stash lacks what it needs');
  });
});

describe('the town\'s ledger', () => {
  it('is read out as the town stands, then offers what you carry that a work still wants, never more than it wants', () => {
    const sent: ClientMsg[] = [];
    const g = game(sent, { dir: 'down' }, { bag: [{ item: 'wire', count: 5 }, { item: 'glowcap', count: 3 }], town: { done: [], given: { lights: { wire: 1 } } } });
    g.pressA();
    expect(g.dialog?.who).toBe('The town ledger');
    expect(g.dialog?.lines).toEqual([
      'The town\'s ledger. Walt keeps it: what each broken part of town needs, and what came in.',
      'The street lights: wants 1 copper wire and 1 scrap more. Once done: the street is lit at night.',
      'A roof over the board: wants 2 cloth more. Once done: under it you dry off.',
    ]);
    expect(g.dialog?.lines).toEqual(ledgerLines(DATA.town, g.town, id => ITEMS.byId.get(id)));
    close(g);
    expect(g.askView()).toMatchObject({ who: 'The town ledger', text: 'Give 1 copper wire to the street lights? The ledger wants 1 copper wire for it.', count: null });
    g.answer('yes');
    expect(sent.at(-1)).toEqual({ t: 'give', x: 5, y: 3, work: 'lights', item: 'wire' });
    // The town comes first, then what it did.
    g.handle({ t: 'town', town: { done: [], given: { lights: { wire: 2 } } } }, 2000);
    g.handle({ t: 'did', did: { kind: 'gave', work: 'lights', item: 'wire', count: 1 } }, 2000);
    expect(g.noteView(2000)).toMatchObject({ who: 'The town ledger', text: 'The ledger takes 1 copper wire for the street lights. It still wants 1 scrap.' });
    // Nothing else you carry is wanted.
    g.pressA();
    expect(g.question).toBeNull();
  });

  it('asks how many when more than one can go, and offers nothing for a work that is done', () => {
    const sent: ClientMsg[] = [];
    const g = game(sent, { dir: 'down' }, { bag: [{ item: 'wire', count: 5 }, { item: 'cloth', count: 3 }], town: { done: ['lights'], given: {} } });
    g.pressA();
    expect(g.dialog?.lines[1]).toBe('The street lights: done. The street is lit at night.');
    close(g);
    expect(g.askView()).toMatchObject({ text: 'Give 1 cloth to a roof over the board? The ledger wants 2 cloth for it.', count: { n: 1, min: 1, max: 2 } });
    g.holdCount(1, 2000);
    g.holdCount(0, 2000);
    g.answer('yes');
    expect(sent.at(-1)).toEqual({ t: 'give', x: 5, y: 3, work: 'roof', item: 'cloth', count: 2 });
    g.handle({ t: 'town', town: { done: ['lights', 'roof'], given: {} } }, 2000);
    g.handle({ t: 'did', did: { kind: 'gave', work: 'roof', item: 'cloth', count: 2, done: true } }, 2000);
    expect(g.noteView(2000)?.text).toBe('The ledger takes 2 cloth for a roof over the board. That was the last of what it needed. Under it you dry off.');
    expect(g.news.filter(n => n.kind === 'town')).toEqual([{ kind: 'town', id: 'roof', pop: 2 }]);
  });

  it('says in words what goes, and why not', () => {
    const [lights] = DATA.town!.works;
    expect(giveQuestion(lights!, ITEMS.get('wire'), 2, 2)).toBe('Give 2 copper wire to the street lights? The ledger wants 2 copper wire for it.');
    expect(didWho({ kind: 'gave', work: 'lights', item: 'wire', count: 2 }, ITEMS)).toBe('The town ledger');
    expect(didText({ kind: 'gave', work: 'gone', item: 'wire', count: 2 }, ITEMS)).toBe('The ledger takes 2 copper wire.');
    expect(refusalText('not_needed', 'give')).toBe('The ledger wants no more of that for it');
    expect(refusalText('cold', 'feed')).toBe('Nobody keeps this hearth yet. It stays cold');
  });
});

describe('what people say, and tell', () => {
  it('follows the sky and the town in one order: the sky, then what the town came to, then what they always say', () => {
    const g = game([], {}, { town: { done: ['edith-home'], given: {} } }, { scenes: 0b10 });
    g.pressA();
    expect(g.dialog?.lines).toEqual(['Rain on the lodge roof. I like it.', 'Smoke from Edith\'s chimney.', 'Pull up a chair.']);
    close(g);
    // A storm over the woods, by the world's clock (the welcome's): Walt has heard.
    const s = game([], {}, { clock: 950_000 });
    expect(s.sayContext().sky).toEqual({ weather: 'rain', storm: true });
    s.pressA();
    expect(s.dialog?.lines).toEqual(['Rain on the lodge roof. I like it.', 'Storm over the woods. Stay in.', 'Pull up a chair.']);
  });

  it('keeps the world\'s clock from the welcome, and counts on from it', () => {
    const g = game([], {}, { clock: 5_000_000 });
    g.update(0, 3000);
    expect(g.skyNow()).toBe(5_002_000);
    expect(g.sayContext()).toMatchObject({ level: 1, notes: [], keepsakes: [], pages: [], town: [], sky: { weather: 'rain', storm: false } });
  });

  it('tells a scene once it opened, in place of the rest, and keeps it told: news for the journal\'s People, never a banner', () => {
    const sent: ClientMsg[] = [];
    const g = game(sent, {}, { progress: LEVEL_2 }, { notes: ['walt-n10'] });
    g.pressA();
    expect(g.dialog?.lines).toEqual(['The wires hummed that night.', 'I never told anyone <then>.']);
    expect(g.stats.scenes).toBe(1);
    expect(sent.at(-1)).toEqual({ t: 'talk', x: 5, y: 1 });
    expect(g.news).toContainEqual({ kind: 'scene', id: 'walt-hum' });
    expect([...g.freshScenes]).toEqual(['walt-hum']);
    expect(newsBanner({ kind: 'scene', id: 'walt-hum' }, 'Testbrook', ITEMS)).toBeNull();
    close(g);
    // Told: next time, what he says as ever.
    g.pressA();
    expect(g.dialog?.lines).toEqual(['Rain on the lodge roof. I like it.', 'Pull up a chair.']);
    expect(g.news.filter(n => n.kind === 'scene')).toHaveLength(1);
    const changes = g.townChanges;
    g.seenScenes();
    expect(g.freshScenes.size).toBe(0);
    expect(g.townChanges).toBe(changes + 1);
    g.seenScenes();
    expect(g.townChanges).toBe(changes + 1);
  });

  it('keeps nothing told before it opened', () => {
    const g = game([], {}, {}, { notes: ['walt-n10'] });
    g.pressA();
    expect(g.dialog?.lines).toEqual(['Rain on the lodge roof. I like it.', 'Pull up a chair.']);
    expect(g.stats.scenes ?? 0).toBe(0);
  });
});

describe('the journal\'s People', () => {
  const name = (id: string) => ({ walt: 'Walt', edith: 'Edith' })[id] ?? id;

  it('go by whoever told you something, with the scenes of theirs you heard, in the story\'s order', () => {
    expect(peopleView(STORY, {}, name)).toEqual([]);
    const v = peopleView(STORY, { scenes: 0b11 }, name, new Set(['walt-edith']));
    expect(v.map(personHeading)).toEqual(['Walt: 2 of 2']);
    expect(v[0]!.scenes.map(s => [s.id, s.title, s.fresh])).toEqual([['walt-hum', 'The hum', false], ['walt-edith', 'Edith', true]]);
    expect(peopleView(STORY, { scenes: 0b10 }, name).map(personHeading)).toEqual(['Walt: 1 of 2']);
  });

  it('are drawn under each person\'s heading, what they said kept as they said it', () => {
    const html = peopleHtml(peopleView(STORY, { scenes: 0b01 }, name, new Set(['walt-hum'])));
    expect(html).toContain('<h3>Walt: 1 of 2</h3>');
    expect(html).toContain('<article class="page note" data-fresh><h4>The hum</h4>');
    expect(html).toContain('<p>I never told anyone &lt;then&gt;.</p>');
    expect(peopleHtml([])).toBe(`<p class="none">${NOTHING_YET}</p>`);
  });
});
