/**
 * A home of one's own in a garden of its own, as the client shows it (roadmap/home-lots.md): a friend's home
 * drawn with their house, furniture and trophy shelf and named by whose it is; their chest, workbench and
 * kitchen saying whose they are; visiting from a friend's card (asked first, then NAPO's teleport takes you),
 * or why not; the setting under Friends; NAPO's teleport both ways; building the house up at the workbench;
 * the kitchen and the map table, boxes until the house is built up to them; the name plate in the garden;
 * the letter home; and, out in the wilds, the way home on the energy bar. On the real maps and items, since
 * players read their words there.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  TileMap, teleportArrival, type BagSlot, type ClientMsg, type ItemsData, type MapData, type MapObject, type PlayerView, type ServerMsg,
} from '@napoland/shared';
import { BEAM_IN_S, BEAM_OUT_S } from '../src/beam';
import { detailView } from '../src/details';
import { friendsView } from '../src/friends';
import { Game } from '../src/game';
import { bagCount } from '../src/hud';
import { Items, homeRow, recipeViews, refusalText } from '../src/items';
import { Maps } from '../src/maps';
import { sketchOf } from '../src/papermap';
import {
  HOME_LETTER, KITCHEN, KITCHEN_EMPTY, TELEPORT, TURN_BACK, VISITS_SETTING, YOUR_GARDEN, boxesLines, builtText, comfortLines, cookFromChest, didText, didWho,
  friendsBoxes, teleportQuestion, visitQuestion, visitWhyNot, visitedText,
} from '../src/said';
import { soundscape, type Scene } from '../src/soundscape';
import { HOME_LOOKS, homeModel, homeTone, homeWall, kitchenModel, mapTableModel } from '../src/view/home';
import { FULL, welcome, zone } from './fixtures';

const read = <T>(path: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content', path), 'utf8')) as T;
const items = new Items(read<ItemsData>('items.json'));
const home = read<MapData>('maps/stonebrook-home.json'), garden = read<MapData>('maps/home-garden.json');
const stonebrook = read<MapData>('maps/stonebrook.json'), woods = read<MapData>('maps/near-woods.json');
const maps = new Maps([home, garden, stonebrook, woods]);
const one = (m: MapData, kind: MapObject['kind']) => m.objects.find(o => o.kind === kind)!;
const teleport = one(home, 'teleport'), twin = one(stonebrook, 'teleport'), chest = one(home, 'chest'), bench = one(home, 'workbench');
const kitchen = one(home, 'kitchen'), table = one(home, 'board'), fire = one(home, 'fireplace');
const house = garden.objects.find((o): o is Extract<MapObject, { kind: 'house' }> => o.kind === 'house')!;
const place = (what: string) => home.objects.find(o => o.kind === 'comfort' && o.what === what)!;
const me = (x: number, y: number): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir: 'up', color: '#f29e4c', gear: {}, quirks: [] });
const BO = '22222222-2222-4222-8222-222222222222';
const bo = { id: BO, name: 'Bo' };
/** Bo's home as a visit shows it: built up to a cabin, Bo's bed and shelf, and a shard-lined cap on the shelf. */
const BOS = { furniture: ['bed', 'trophy-shelf'], visit: { name: 'Bo', house: 2, trophies: ['shard-cap'] } };
/** Your friends: Bo, whose home keeps visitors out when `closed`. */
const friends = (closed = false): Extract<ServerMsg, { t: 'friends' }> => ({
  t: 'friends', friends: [{ id: BO, name: 'Bo', map: null, ...(closed ? { closed: true as const } : {}) }], incoming: [], outgoing: [], blocked: [], requestsOff: false, tradesOff: false,
});

let sent: ClientMsg[];
let g: Game;
let now = 3000;
/** What the text box says now (read through a call, so a note set to null earlier in a test does not narrow it). */
const said = () => g.note?.text;
/** Runs the game for `ms`, sixty frames a second: long enough for the teleport's trip (beam.ts) to send it. */
function run(ms: number) {
  for (let t = 0; t < ms; t += 1000 / 60) { now += 1000 / 60; g.update(1 / 60, now); }
}
/**
 * In your own home, in front of tile x,y and facing it: built up to `house`, your stove made, `stash` in the
 * chest and `bag` carried. Its fire never goes out (left: null), as the server says of it.
 */
function atHome(o: { x: number; y: number }, more: { house?: number; stash?: BagSlot[]; bag?: BagSlot[] } = {}) {
  const at = me(o.x, o.y + 1);
  const extras = {
    items: items.version, stash: more.stash ?? [{ item: 'warm-pebble', count: 1 }], bag: more.bag ?? [], house: more.house ?? 1, fires: [{ x: fire.x, y: fire.y, left: null }],
  };
  g.handle({ ...welcome(home, [at], FULL, extras), furniture: ['iron-stove'] }, now);
  sent.length = 0;
}
/** In Bo's home, in front of tile x,y and facing it. */
function atBos(o: { x: number; y: number }, visit = BOS) {
  const at = me(o.x, o.y + 1);
  g.handle({ ...zone(home, at.x, at.y, [at]), ...visit }, now);
  sent.length = 0;
}

beforeEach(() => {
  sent = [];
  g = new Game(maps, m => sent.push(m), items);
  atHome(teleport);
});

describe('a friend\'s home', () => {
  it('is drawn with their house, furniture and trophy shelf, never yours, and named by whose it is; your own is kept for when you are home', () => {
    expect(g.roomFurniture()).toEqual(['iron-stove']);
    expect(g.trophies().map(d => d.id)).toEqual(['warm-pebble']);
    expect([g.placeName(), g.houseHere()]).toEqual(['Home', 1]);
    const before = { furniture: g.furnitureChanges, house: g.houseChanges };
    atBos(teleport);
    expect(g.furnitureChanges).toBeGreaterThan(before.furniture);
    expect(g.houseChanges).toBeGreaterThan(before.house);
    expect(g.visit).toEqual({ name: 'Bo', house: 2, furniture: ['bed', 'trophy-shelf'], trophies: ['shard-cap'] });
    expect(g.roomFurniture()).toEqual(['bed', 'trophy-shelf']);
    expect(g.trophies().map(d => d.id)).toEqual(['shard-cap']);
    expect([g.placeName(), g.houseHere(), g.house]).toEqual(['Bo\'s cabin', 2, 1]);
    // Bo builds the house up and makes a stove while you look round: Bo's, not yours.
    const changes = g.houseChanges;
    g.handle({ t: 'house', level: 3 }, now);
    g.handle({ t: 'furniture', furniture: ['bed', 'trophy-shelf', 'iron-stove'] }, now);
    expect([g.placeName(), g.houseHere(), g.house, g.houseChanges]).toEqual(['Bo\'s house', 3, 1, changes + 1]);
    expect(g.roomFurniture()).toEqual(['bed', 'trophy-shelf', 'iron-stove']);
    expect(g.furniture).toEqual(['iron-stove']);
    // Out in Bo's garden it is still Bo's.
    g.handle({ ...zone(garden, 8, 6, [me(8, 6)]), visit: { ...BOS.visit, house: 3 } }, now);
    expect(g.placeName()).toBe('Bo\'s garden');
    // In town it is nobody's; home again, your own is as you left it, and so is its garden.
    g.handle(zone(stonebrook, twin.x, twin.y + 1, [me(twin.x, twin.y + 1)]), now);
    expect(g.visit).toBeNull();
    g.handle({ ...zone(home, 4, 5, [me(4, 5)]), furniture: ['iron-stove'] }, now);
    expect([g.roomFurniture(), g.trophies().map(d => d.id), g.placeName(), g.houseHere()]).toEqual([['iron-stove'], ['warm-pebble'], 'Home', 1]);
    g.handle(zone(garden, 8, 6, [me(8, 6)]), now);
    expect(g.placeName()).toBe(YOUR_GARDEN);
  });

  it('says what stands in each place as its owner made it, without telling you to make what is theirs to make', () => {
    atBos(place('stove'));
    g.pressA();
    expect(g.dialog).toMatchObject({ who: 'Old stove', lines: [items.get('iron-stove').spoiled] });
    g.dialog = null;
    atBos(place('shelf'));
    g.pressA();
    expect(g.dialog).toMatchObject({ who: 'Trophy shelf', lines: [items.get('trophy-shelf').text, 'On it: a shard-lined cap.'] });
    expect(comfortLines('shelf', items.get('trophy-shelf'), true, [], true).lines[1]).toBe('Nothing on it yet.');
    expect(sent).toEqual([]);
  });

  it('keeps its chest, workbench and kitchen to its owner, and its boxes say how far they built: A there asks the server nothing', () => {
    atBos(chest);
    g.pressA();
    expect(g.note).toMatchObject({ who: 'Bo\'s chest', text: 'Only Bo opens it.' });
    g.note = null;
    atBos(bench);
    g.pressA();
    expect(g.note).toMatchObject({ who: 'Bo\'s workbench', text: 'Only Bo works at it.' });
    g.note = null;
    atBos(kitchen);
    g.pressA();
    expect(g.note).toMatchObject({ who: 'Bo\'s kitchen', text: 'Only Bo cooks here.' });
    g.note = null;
    // Bo's cabin has no map table yet: boxes, which say so of Bo.
    atBos(table);
    g.pressA();
    expect(g.dialog).toMatchObject({ who: 'Boxes', lines: friendsBoxes('Bo') });
    expect(friendsBoxes('Bo')).toEqual(['Boxes, stacked against the wall. Bo has not built this far yet.']);
    expect(sent).toEqual([]);
    g.dialog = null;
    // Your own chest opens as ever.
    atHome(chest);
    g.pressA();
    expect(sent).toEqual([{ t: 'chest', x: chest.x, y: chest.y }]);
  });

  it('is yours to be visited: at home, you read who came', () => {
    g.handle({ t: 'visited', name: 'Bo' }, now);
    expect(g.note).toMatchObject({ who: 'Home', text: visitedText('Bo') });
    expect(visitedText('Bo')).toBe('Bo came to visit.');
  });
});

describe('visiting a friend', () => {
  it('asks first from their card, then NAPO\'s teleport takes you: you fade where you stand, the visit is sent once you are gone, and you form again by the teleport in their home', () => {
    g.handle(friends(), now);
    expect(g.visitReach(bo)).toBe('ok');
    g.visitFriend(bo);
    expect(g.askView()).toMatchObject({ who: 'Bo', text: visitQuestion('Bo') });
    expect(visitQuestion('Bo')).toBe('Visit Bo\'s home? NAPO\'s teleport sets you down inside it.');
    g.answer('no');
    expect([g.question, sent]).toEqual([null, []]);
    g.visitFriend(bo);
    g.answer('yes');
    // It starts where you stand (in front of your own teleport here), and nothing is sent until you are gone.
    expect(g.beam).toMatchObject({ phase: 'out', pad: { x: teleport.x, y: teleport.y + 1 } });
    expect(sent).toEqual([]);
    run(BEAM_OUT_S * 1000 + 50);
    expect(sent).toEqual([{ t: 'visit', id: BO }]);
    // The server sets you down in front of the teleport in Bo's home: the arrival plays there.
    const at = teleportArrival(teleport);
    g.handle({ ...zone(home, at.x, at.y, [me(at.x, at.y)]), ...BOS }, now);
    expect(g.beam).toMatchObject({ phase: 'in', pad: { x: teleport.x, y: teleport.y } });
    run(BEAM_IN_S * 1000 + 50);
    expect(g.beam).toBeNull();
    expect(g.placeName()).toBe('Bo\'s cabin');
  });

  it('is greyed on their card out in the wilds, into a home that keeps visitors out, and inside theirs already; pressed, it says why', () => {
    g.handle(friends(true), now);
    expect(g.visitReach(bo)).toBe('closed');
    expect(friendsView(g.friends, { person: bo, talks: new Map(), unread: new Set(), visitReach: p => g.visitReach(p) }, () => undefined).person?.visit).toBe('closed');
    g.visitFriend(bo);
    expect(g.question).toBeNull();
    expect(g.note).toMatchObject({ who: 'Bo', text: 'Bo keeps visitors out for now.' });
    // Out in the wilds a visit would be a way home that costs nothing.
    g.handle(friends(), now);
    g.handle(zone(woods, woods.spawn.x, woods.spawn.y, [me(woods.spawn.x, woods.spawn.y)]), now);
    expect(g.visitReach(bo)).toBe('wilds');
    g.note = null;
    g.visitFriend(bo);
    expect(g.note).toMatchObject({ text: 'Visits start from town or from home: come back before you visit Bo.' });
    expect(visitWhyNot('Bo', 'wilds')).toBe(said());
    atBos(teleport);
    expect(g.visitReach(bo)).toBe('here');
    // From town, or from your own garden, it can.
    g.handle(zone(stonebrook, twin.x, twin.y + 1, [me(twin.x, twin.y + 1)]), now);
    expect(g.visitReach(bo)).toBe('ok');
    g.handle(zone(garden, 8, 6, [me(8, 6)]), now);
    expect(g.visitReach(bo)).toBe('ok');
    expect(sent).toEqual([]);
  });

  it('is called off when the server says no, and the box says why', () => {
    g.handle(friends(), now);
    g.visitFriend(bo);
    g.answer('yes');
    run(BEAM_OUT_S * 1000 + 50);
    g.handle({ t: 'refused', action: 'visit', reason: 'closed' }, now);
    expect(g.beam).toBeNull();
    expect(g.note?.text).toBe('They keep visitors out of their home.');
    expect([refusalText('too_far', 'visit'), refusalText('not_friends', 'visit'), refusalText('gone', 'visit')]).toEqual([
      'Visits start from town or from home: come back first', 'You visit friends only', 'Their home is nowhere to be found',
    ]);
  });
});

describe('who may visit your home', () => {
  it('is a setting under Friends: sent as you change it, and as the server says it stands, in the welcome too', () => {
    const view = () => friendsView(null, g, () => undefined);
    expect([g.visitsOff, view().visitsOff]).toEqual([false, false]);
    const before = g.socialChanges;
    g.setVisitsOff(true);
    expect(sent).toEqual([{ t: 'visitsOff', off: true }]);
    // Nothing changes until the server says so.
    expect(g.visitsOff).toBe(false);
    g.handle({ t: 'visitsOff', off: true }, now);
    expect([g.visitsOff, view().visitsOff]).toEqual([true, true]);
    expect(g.socialChanges).toBeGreaterThan(before);
    // Back in the game, the welcome says it, either way.
    g.handle(welcome(home, [me(4, 5)], FULL, { items: items.version }), now);
    expect(g.visitsOff).toBe(false);
    g.handle({ ...welcome(home, [me(4, 5)], FULL, { items: items.version }), visitsOff: true }, now);
    expect(g.visitsOff).toBe(true);
    expect(VISITS_SETTING).toBe('Let my friends visit my home');
  });
});

describe('NAPO\'s teleport', () => {
  it('asks first with A, and goes to town on YES, from your own home or a friend\'s; NO stays', () => {
    g.pressA();
    expect(g.askView()).toMatchObject({ who: TELEPORT, text: 'Go to town? It sets you down by the notice board.' });
    expect(sent).toEqual([]);
    g.answer('no');
    expect([g.question, sent]).toEqual([null, []]);
    g.pressA();
    g.answer('yes');
    // Sent once the trip on your screen has taken you (beam.ts).
    run(BEAM_OUT_S * 1000 + 50);
    expect(sent).toEqual([{ t: 'teleport', x: teleport.x, y: teleport.y }]);
    // Into Bo's home, in front of its teleport: to the game that is where the trip set you down, so it plays out first.
    atBos(teleport);
    run(BEAM_IN_S * 1000 + 50);
    g.pressA();
    expect(g.askView()).toMatchObject({ text: teleportQuestion(false) });
    g.answer('yes');
    run(BEAM_OUT_S * 1000 + 50);
    expect(sent).toEqual([{ t: 'teleport', x: teleport.x, y: teleport.y }]);
  });

  it('in town asks first, and takes you home on YES: the only way there', () => {
    const at = teleportArrival(twin);
    g.handle(zone(stonebrook, at.x, at.y, [me(at.x, at.y)]), now);
    sent.length = 0;
    g.pressA();
    expect(g.askView()).toMatchObject({ who: TELEPORT, text: 'Go home? It sets you down inside your own home.' });
    expect(sent).toEqual([]);
    g.answer('yes');
    run(BEAM_OUT_S * 1000 + 50);
    expect(sent).toEqual([{ t: 'teleport', x: twin.x, y: twin.y }]);
    // No road out of town leads home, and the paper map names none.
    expect(stonebrook.exits.some(e => e.to === home.id || e.to === garden.id)).toBe(false);
    expect(sketchOf(new TileMap(stonebrook), id => maps.find(id)?.name).labels.some(l => /Residents|Home|Garden/.test(l.text))).toBe(false);
  });

  it('hums close by, softly, and not from across the room', () => {
    const scene = (x: number, y: number): Scene => ({
      map: home.id, kind: 'inside', weather: 'overcast', storm: false, lightning: false, me: { id: 'me', x, y, tx: x, ty: y, ground: 'floor' },
      fires: [], poles: [], teleports: [teleport], surge: null, caught: false, creatures: [], flashes: [], live: false, news: [], radio: null,
    });
    const near = soundscape(scene(teleport.x, teleport.y + 1)).loops.hum;
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThanOrEqual(0.5);
    expect(soundscape(scene(teleport.x - 5, teleport.y + 1)).loops.hum).toBe(0);
    expect(soundscape({ ...scene(teleport.x, teleport.y + 1), teleports: undefined }).loops.hum).toBe(0);
  });
});

describe('building your home up', () => {
  const CABIN: BagSlot[] = [{ item: 'scrap', count: 20 }, { item: 'resin', count: 20 }, { item: 'cloth', count: 12 }, { item: 'wire', count: 8 }];
  /** At your own workbench, open, with `stash` in the chest and the house built up to `level`. */
  function atBench(stash: BagSlot[], level = 1) {
    atHome(bench, { house: level, stash });
    g.pressA();
    expect(sent).toEqual([{ t: 'bench', x: bench.x, y: bench.y }]);
    g.handle({ t: 'bench', stash }, now);
    sent.length = 0;
  }

  it('is the workbench\'s last row, under a heading of its own: the next level against the stash, or built as far as it goes', () => {
    const rows = recipeViews(items.recipes, [{ item: 'scrap', count: 20 }], items, [], [], 1);
    expect(rows.at(-1)).toMatchObject({ id: 'home', group: 'home', name: 'Cabin', facts: 'Your home is a garage now', can: false });
    const name = (id: string) => items.get(id).name;
    expect(rows.at(-1)!.needs.map(n => [n.name, n.have, n.need])).toEqual([[name('scrap'), 20, 20], [name('resin'), 0, 20], [name('cloth'), 0, 12], [name('wire'), 0, 8]]);
    expect(homeRow(1, CABIN, items).can).toBe(true);
    expect(homeRow(2, [], items)).toMatchObject({ name: 'House', facts: 'Your home is a cabin now' });
    expect(homeRow(3, [], items)).toMatchObject({ name: 'House', facts: 'Built as far as it goes', needs: [], can: false });
    // Nowhere else is it offered (a friend's workbench is never opened): no house, no row.
    expect(recipeViews(items.recipes, CABIN, items).some(r => r.group === 'home')).toBe(false);
  });

  it('has a card that says what the next level gives, in its own words, and what it takes, greyed while the stash is short', () => {
    const state = { items, bag: [], stash: [{ item: 'scrap', count: 4 }], gear: {}, worn: {}, house: 1 };
    const card = detailView({ from: 'home' }, state)!;
    expect(card).toMatchObject({ name: 'Cabin', text: items.house[1]!.text, facts: ['Your home is a garage now'], act: { label: 'Build', enabled: false, does: { kind: 'build' } } });
    expect(card.notes.map(n => n.text)).toEqual(['Built, your home stands so at once, outside and in.', 'Your stash is short of scrap metal, fir resin, cloth scraps and copper wire.']);
    expect(detailView({ from: 'home' }, { ...state, stash: CABIN })!.act).toMatchObject({ enabled: true });
    expect(detailView({ from: 'home' }, { ...state, house: 3 })).toMatchObject({ name: 'House', act: { label: 'Built', enabled: false } });
  });

  it('asks first with what it uses, or says what the stash lacks; the server builds it, and the house stands so at once', () => {
    atBench([{ item: 'scrap', count: 20 }, { item: 'resin', count: 3 }]);
    g.build();
    expect(g.question).toBeNull();
    expect(g.note?.text).toBe('Your stash is short of 17 resin, 12 cloth and 8 wire to build your home up to a cabin.');
    g.note = null;
    atBench(CABIN);
    g.build();
    expect(g.askView()).toMatchObject({ who: 'Workbench', text: 'Build your home up to a cabin? It uses 20 scrap, 20 resin, 12 cloth and 8 wire.' });
    g.answer('yes');
    expect(sent).toEqual([{ t: 'build', x: bench.x, y: bench.y }]);
    const changes = g.houseChanges;
    g.handle({ t: 'house', level: 2 }, now);
    expect([g.house, g.houseHere(), g.houseChanges]).toEqual([2, 2, changes + 1]);
    const did = { kind: 'built' as const, level: 2 };
    g.handle({ t: 'did', did }, now);
    expect(g.note).toMatchObject({ who: 'Home', text: `Your home is a cabin now. ${items.house[1]!.text}`, waiting: false });
    expect([didWho(did, items), didText(did, items)]).toEqual(['Home', builtText(2, items.house)]);
    g.note = null;
    // Built as far as it goes: nothing more to ask.
    atBench(CABIN, 3);
    g.build();
    expect([g.question, sent]).toEqual([null, []]);
  });
});

describe('the kitchen and the map table', () => {
  it('stand as boxes until the house is built up to them, which say what comes there and what builds it', () => {
    atHome(kitchen);
    g.pressA();
    expect(g.dialog).toMatchObject({ who: 'Boxes', lines: boxesLines('kitchen', 'cabin') });
    expect(g.dialog!.lines).toEqual(['Boxes, stacked where a kitchen goes. Once the workbench builds your home up to a cabin, a kitchen stands here: it cooks from your chest.']);
    g.dialog = null;
    atHome(table, { house: 2 });
    g.pressA();
    expect(g.dialog).toMatchObject({ who: 'Boxes', lines: boxesLines('board', 'house') });
    expect(sent).toEqual([]);
  });

  it('cooks at the kitchen from the bag and the chest together, asking first; says what the nearest meal lacks, or that nothing is there to cook', () => {
    // A fir tip carried, two in the chest: tea.
    atHome(kitchen, { house: 2, bag: [{ item: 'fir-tips', count: 1 }], stash: [{ item: 'fir-tips', count: 2 }] });
    g.pressA();
    expect(g.askView()).toMatchObject({ who: KITCHEN, text: 'Cook fir-tip tea? It uses 3 fir tips.' });
    g.answer('yes');
    expect(sent).toEqual([{ t: 'cook', x: kitchen.x, y: kitchen.y, recipe: 'fir-tip-tea' }]);
    const cooked = { kind: 'cooked' as const, item: 'fir-tip-tea', count: 1, chest: true as const };
    g.handle({ t: 'did', did: cooked }, now);
    expect(g.note).toMatchObject({ who: KITCHEN, text: 'You cook fir-tip tea, some of it from your chest. It is in your bag.', waiting: false });
    expect([didWho(cooked, items), didText(cooked, items)]).toEqual([KITCHEN, g.note!.text]);
    g.note = null;
    // Too little for the stew, in the chest alone.
    atHome(kitchen, { house: 2, stash: [{ item: 'chanterelles', count: 2 }] });
    g.pressA();
    expect(said()).toBe('For chanterelle stew you need 1 more chanterelle and 2 more fiddleheads, in your bag or your chest.');
    g.note = null;
    atHome(kitchen, { house: 2, stash: [{ item: 'scrap', count: 5 }] });
    g.pressA();
    expect(said()).toBe(KITCHEN_EMPTY);
  });

  it('says at the fire at home that a fire cooks what you carry, when what a meal takes is all in the chest, rather than that it needs nothing', () => {
    const tea = items.cooking.find(r => r.id === 'fir-tip-tea')!;
    atHome(fire, { stash: [{ item: 'fir-tips', count: 3 }] });
    g.pressA();
    expect(g.note).toMatchObject({ who: 'Fire', text: cookFromChest(tea, items, false) });
    expect(g.note!.text).toBe('To cook fir-tip tea, carry 3 fir tips: take them out of your chest first. A fire cooks what you carry.');
    g.note = null;
    atHome(fire, { house: 2, stash: [{ item: 'fir-tips', count: 3 }] });
    g.pressA();
    expect(said()).toBe(`${cookFromChest(tea, items, false)} Your kitchen cooks from the chest.`);
    expect(sent).toEqual([]);
  });

  it('reads the map table as the notice board once the house stands', () => {
    atHome(table, { house: 3 });
    g.pressA();
    expect(sent).toEqual([{ t: 'board', x: table.x, y: table.y }]);
    expect(refusalText('not_built', 'board')).toBe('It is not built yet: the workbench builds your home up to it');
  });
});

describe('your garden', () => {
  it('shows the name plate by the door of the house while you are near it: yours, or the friend\'s whose garden it is', () => {
    const door = { x: house.x + Math.floor(house.w / 2), y: house.y + house.h - 1 };
    expect(garden.exits).toEqual([expect.objectContaining({ x: door.x, y: door.y, to: home.id })]);
    g.handle(zone(garden, door.x, door.y + 1, [me(door.x, door.y + 1)]), now);
    expect(g.platesNear()).toEqual([{ name: 'Aldo', ...door }]);
    g.handle(zone(garden, 14, 12, [me(14, 12)]), now);
    expect(g.platesNear()).toEqual([]);
    g.handle({ ...zone(garden, door.x, door.y + 1, [me(door.x, door.y + 1)]), visit: BOS.visit }, now);
    expect(g.platesNear()).toEqual([{ name: 'Bo', ...door }]);
    g.handle(zone(stonebrook, twin.x, twin.y + 1, [me(twin.x, twin.y + 1)]), now);
    expect(g.platesNear()).toEqual([]);
  });

  it('comes with a letter the first time you are home: how home works now, a page at a time', () => {
    g.handle({ t: 'homeLetter' }, now);
    g.idle(now, false);
    expect(g.dialog).toMatchObject({ who: 'Letter', lines: [...HOME_LETTER] });
    expect(HOME_LETTER.join(' ')).toMatch(/teleport inside it is the way to town/);
    expect(HOME_LETTER.join(' ')).toMatch(/Friends can visit from the friends list/);
    expect(HOME_LETTER.join(' ')).toMatch(/workbench builds your home up/);
  });
});

describe('the way home', () => {
  const map = new TileMap(woods);
  // A tile well out in the woods: 40 to 60 steps from its way home.
  const far = (() => {
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      const s = map.homeSteps(x, y);
      if (s >= 40 && s <= 60 && map.walkable(x, y)) return { x, y };
    }
    throw new Error('no tile 40 to 60 steps out');
  })();
  const out = (value: number, at = far) => g.handle(welcome(woods, [me(at.x, at.y)], { value, max: 100, rate: -0.3 }, { items: items.version }), now);

  it('is worked out out in the wilds from where you stand and what drains you now, and more the farther out you are', () => {
    out(100);
    const way = g.wayHome(now)!;
    expect(way.cost).toBeGreaterThan(1);
    expect(way.cost).toBeLessThan(60);
    expect(way.turn).toBe(false);
    out(100, woods.spawn);
    expect(g.wayHome(now)!.cost).toBeLessThan(way.cost);
    // Nothing drains in town or at home: nothing to show.
    g.handle(zone(stonebrook, twin.x, twin.y + 1, [me(twin.x, twin.y + 1)]), now);
    expect(g.wayHome(now)).toBeNull();
  });

  it('says it is time to turn back once your energy is down to little more than the way home, once, over your head', () => {
    out(100);
    const cost = g.wayHome(now)!.cost;
    out(cost * 1.1);
    expect(g.wayHome(now)!.turn).toBe(true);
    expect(g.floats.map(f => f.text)).toEqual([TURN_BACK]);
    g.wayHome(now + 100);
    expect(g.floats.filter(f => f.text === TURN_BACK)).toHaveLength(1);
  });

  it('says on B how full the bag is, once one slot is left', () => {
    expect(bagCount(3, 12)).toBeNull();
    expect(bagCount(11, 12)).toEqual({ text: '11/12', full: false });
    expect(bagCount(12, 12)).toEqual({ text: '12/12', full: true });
    expect(bagCount(0, 0)).toBeNull();
  });
});

describe('the house and its room, drawn', () => {
  const mats = { warm: new THREE.MeshBasicMaterial(), doorGlow: new THREE.MeshBasicMaterial() };
  const door = { w: 0.6, h: 0.84, back: 0.2 };

  it('stands on its 5 by 3 tiles at every level, and looks different at each: the garage, the cabin, the house', () => {
    const tall: number[] = [];
    for (let level = 1; level <= HOME_LOOKS + 1; level++) {
      const { root, smoke } = homeModel(house, level, house.x + 2, door, mats);
      const b = new THREE.Box3().setFromObject(root);
      expect(b.min.x, `level ${level}`).toBeGreaterThanOrEqual(house.x - 0.35);
      expect(b.max.x, `level ${level}`).toBeLessThanOrEqual(house.x + house.w + 0.35);
      expect(b.min.z, `level ${level}`).toBeGreaterThanOrEqual(house.y - 0.35);
      expect(b.max.z, `level ${level}`).toBeLessThanOrEqual(house.y + house.h + 0.6);
      expect(smoke.y).toBeGreaterThan(0);
      tall.push(b.max.y);
    }
    // The house has two floors; past the last level it is drawn as the last.
    expect(tall[2]!).toBeGreaterThan(tall[0]!);
    expect(tall[3]).toBeCloseTo(tall[2]!, 5);
    expect(new Set([1, 2, 3].map(homeWall)).size).toBe(3);
    expect(homeTone(1).concrete).toBe(true);
    expect(homeTone(3).boards).toBe(true);
  });

  it('draws the kitchen against its wall and the map table on their tiles', () => {
    const room = new TileMap(home);
    for (const [m, o] of [[kitchenModel(kitchen, room), kitchen], [mapTableModel(table), table]] as const) {
      const b = new THREE.Box3().setFromObject(m);
      expect(b.isEmpty()).toBe(false);
      expect(Math.abs((b.min.x + b.max.x) / 2 - (o.x + 0.5))).toBeLessThan(0.6);
      expect(Math.abs((b.min.z + b.max.z) / 2 - (o.y + 0.5))).toBeLessThan(0.6);
    }
    const k = new THREE.Box3().setFromObject(kitchenModel(kitchen, room));
    expect(k.min.x).toBeGreaterThanOrEqual(kitchen.x - 0.05);
    expect(k.max.x).toBeLessThanOrEqual(kitchen.x + 1.05);
    expect(k.min.z).toBeGreaterThanOrEqual(kitchen.y - 0.05);
    expect(k.max.z).toBeLessThanOrEqual(kitchen.y + 1.05);
  });
});
