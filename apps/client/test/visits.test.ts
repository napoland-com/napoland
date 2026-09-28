/**
 * Visits and NAPO's teleport, as the client shows them (roadmap/street-visits.md): a neighbor's cabin drawn
 * with their furniture and trophy shelf, never yours, and named by whose it is; their chest and workbench
 * saying whose they are; the owner reading who came in; the setting under Friends; A at the teleport, and
 * its hum; the road onto your street on the paper map. On the real maps and items, since players read
 * their words there.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { TileMap, teleportArrival, type ClientMsg, type ItemsData, type MapData, type MapObject, type PlayerView } from '@napoland/shared';
import { friendsView } from '../src/friends';
import { Game } from '../src/game';
import { Items } from '../src/items';
import { Maps } from '../src/maps';
import { sketchOf } from '../src/papermap';
import { TELEPORT, TELEPORT_TOWN, VISITS_SETTING, comfortLines, visitedText } from '../src/said';
import { soundscape, type Scene } from '../src/soundscape';
import { FULL, welcome, zone } from './fixtures';

const read = <T>(path: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content', path), 'utf8')) as T;
const items = new Items(read<ItemsData>('items.json'));
const home = read<MapData>('maps/stonebrook-home.json'), lane = read<MapData>('maps/residents-lane.json'), stonebrook = read<MapData>('maps/stonebrook.json');
const maps = new Maps([home, lane, stonebrook]);
const one = (m: MapData, kind: MapObject['kind']) => m.objects.find(o => o.kind === kind)!;
const teleport = one(home, 'teleport'), twin = one(stonebrook, 'teleport'), chest = one(home, 'chest'), bench = one(home, 'workbench');
const place = (what: string) => home.objects.find(o => o.kind === 'comfort' && o.what === what)!;
const me = (x: number, y: number): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir: 'up', color: '#f29e4c', gear: {}, quirks: [] });
/** In the cabin you walk into through Bo's door: Bo's bed and shelf, and a shard-lined cap on the shelf. */
const BOS = { furniture: ['bed', 'trophy-shelf'], visit: { name: 'Bo', trophies: ['shard-cap'] } };

let sent: ClientMsg[];
let g: Game;
/** In a cabin, in front of tile x,y and facing it: your own (with your stove, and a warm pebble in your stash), or Bo's. */
function standBefore(o: { x: number; y: number }, bos = false) {
  const at = me(o.x, o.y + 1);
  if (bos) g.handle({ ...zone(home, at.x, at.y, [at]), ...BOS }, 2000);
  else g.handle({ ...welcome(home, [at], FULL, { items: items.version, stash: [{ item: 'warm-pebble', count: 1 }] }), furniture: ['iron-stove'] }, 1000);
  sent.length = 0;
}

beforeEach(() => {
  sent = [];
  g = new Game(maps, m => sent.push(m), items);
  standBefore(teleport);
});

describe('a neighbor\'s cabin', () => {
  it('is drawn with their furniture and trophy shelf, never yours, and named by whose it is; your own is kept for when you are home', () => {
    expect(g.roomFurniture()).toEqual(['iron-stove']);
    expect(g.trophies().map(d => d.id)).toEqual(['warm-pebble']);
    expect(g.placeName()).toBe('Home');
    const before = g.furnitureChanges;
    standBefore(teleport, true);
    expect(g.furnitureChanges).toBeGreaterThan(before);
    expect(g.visit).toEqual({ name: 'Bo', furniture: ['bed', 'trophy-shelf'], trophies: ['shard-cap'] });
    expect(g.roomFurniture()).toEqual(['bed', 'trophy-shelf']);
    expect(g.trophies().map(d => d.id)).toEqual(['shard-cap']);
    expect(g.placeName()).toBe('Bo\'s cabin');
    expect(g.furniture).toEqual(['iron-stove']);
    // Bo makes a stove while you look round: it stands in Bo's cabin, not in yours.
    g.handle({ t: 'furniture', furniture: ['bed', 'trophy-shelf', 'iron-stove'] }, 2100);
    expect(g.roomFurniture()).toEqual(['bed', 'trophy-shelf', 'iron-stove']);
    expect(g.furniture).toEqual(['iron-stove']);
    // Out on the street it is nobody's; home again, your own cabin is as you left it.
    g.handle(zone(lane, 6, 22, [me(6, 22)]), 3000);
    expect(g.visit).toBeNull();
    g.handle({ ...zone(home, 4, 5, [me(4, 5)]), furniture: ['iron-stove'] }, 4000);
    expect([g.roomFurniture(), g.trophies().map(d => d.id), g.placeName()]).toEqual([['iron-stove'], ['warm-pebble'], 'Home']);
  });

  it('says what stands in each place as its owner made it, without telling you to make what is theirs to make', () => {
    standBefore(place('stove'), true);
    g.pressA();
    expect(g.dialog).toMatchObject({ who: 'Old stove', lines: [items.get('iron-stove').spoiled] });
    g.dialog = null;
    standBefore(place('shelf'), true);
    g.pressA();
    expect(g.dialog).toMatchObject({ who: 'Trophy shelf', lines: [items.get('trophy-shelf').text, 'On it: a shard-lined cap.'] });
    expect(comfortLines('shelf', items.get('trophy-shelf'), true, [], true).lines[1]).toBe('Nothing on it yet.');
    expect(sent).toEqual([]);
  });

  it('keeps its chest and workbench to its owner: A there says whose they are, and asks the server nothing', () => {
    standBefore(chest, true);
    g.pressA();
    expect(g.note).toMatchObject({ who: 'Bo\'s chest', text: 'Only Bo opens it.' });
    g.note = null;
    standBefore(bench, true);
    g.pressA();
    expect(g.note).toMatchObject({ who: 'Bo\'s workbench', text: 'Only Bo works at it.' });
    expect(sent).toEqual([]);
    g.note = null;
    // Your own opens as ever.
    standBefore(chest);
    g.pressA();
    expect(sent).toEqual([{ t: 'chest', x: chest.x, y: chest.y }]);
  });

  it('is yours to be looked round in: at home, you read who came in', () => {
    g.handle({ t: 'visited', name: 'Bo' }, 2000);
    expect(g.note).toMatchObject({ who: 'Your cabin', text: visitedText('Bo') });
    expect(visitedText('Bo')).toBe('Bo came in.');
  });
});

describe('who comes into your cabin', () => {
  it('is a setting under Friends: sent as you change it, and as the server says it stands, in the welcome too', () => {
    const view = () => friendsView(null, g, () => undefined);
    expect([g.visitsOff, view().visitsOff]).toEqual([false, false]);
    const before = g.socialChanges;
    g.setVisitsOff(true);
    expect(sent).toEqual([{ t: 'visitsOff', off: true }]);
    // Nothing changes until the server says so.
    expect(g.visitsOff).toBe(false);
    g.handle({ t: 'visitsOff', off: true }, 2000);
    expect([g.visitsOff, view().visitsOff]).toEqual([true, true]);
    expect(g.socialChanges).toBeGreaterThan(before);
    // Back in the game, the welcome says it, either way.
    g.handle(welcome(home, [me(4, 5)], FULL, { items: items.version }), 3000);
    expect(g.visitsOff).toBe(false);
    g.handle({ ...welcome(home, [me(4, 5)], FULL, { items: items.version }), visitsOff: true }, 4000);
    expect(g.visitsOff).toBe(true);
    expect(VISITS_SETTING).toBe('Let my neighbors come into my cabin');
  });
});

describe('NAPO\'s teleport', () => {
  it('goes to town with A, from your own cabin or a neighbor\'s', () => {
    g.pressA();
    expect(sent).toEqual([{ t: 'teleport', x: teleport.x, y: teleport.y }]);
    standBefore(teleport, true);
    g.pressA();
    expect(sent).toEqual([{ t: 'teleport', x: teleport.x, y: teleport.y }]);
  });

  it('in town only brings people here: A there says the way home is the road', () => {
    const at = teleportArrival(twin);
    g.handle(zone(stonebrook, at.x, at.y, [me(at.x, at.y)]), 2000);
    sent.length = 0;
    g.pressA();
    expect(sent).toEqual([]);
    expect(g.note).toMatchObject({ who: TELEPORT, text: TELEPORT_TOWN });
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

describe('the road to your street', () => {
  it('is named on the paper map where it leaves town, like the roads out to the regions', () => {
    const labels = sketchOf(new TileMap(stonebrook), id => maps.find(id)?.name).labels;
    const road = stonebrook.exits.find(e => e.to === lane.id)!;
    const name = labels.find(l => l.text === 'Residents\' Lane');
    expect(name).toBeDefined();
    expect(Math.abs(name!.x - road.x) + Math.abs(name!.y - road.y)).toBeLessThan(8);
  });
});
