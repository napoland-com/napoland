/**
 * A cozy cabin (comfort.ts), as the client shows it: what the workbench offers for the cabin and what it
 * says, what stands in each place (spoiled until made) and what A there says, the trophy shelf, and how
 * cozy you are in the status panel and the banner. With the real items, since players read their words.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { COMFORTS, COZY_AFTER_S, TileMap, type ClientMsg, type ItemsData, type MapData, type MapObject, type PlayerView } from '@napoland/shared';
import { detailView } from '../src/details';
import { Game } from '../src/game';
import { Items, recipeViews } from '../src/items';
import { Maps } from '../src/maps';
import { comfortLines, cozyText, didText, makeQuestion, placedAlready } from '../src/said';
import { newsBanner, statusView } from '../src/status';
import { comfortModel, madePlaces, trophiesIn } from '../src/view/cabin';
import { windowSpots, wallShapes } from '../src/view/interior';
import { DRY, FULL, START, tinyTown, welcome, zone } from './fixtures';

const content = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/items.json'), 'utf8')) as ItemsData;
const items = new Items(content);
const home = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/maps/stonebrook-home.json'), 'utf8')) as MapData;
const recipe = (id: string) => items.recipes.find(r => r.id === id)!;

describe('the workbench, for your home', () => {
  it('lists the furniture after the rest, under a heading of its own, with the comfort each adds', () => {
    const rows = recipeViews(items.recipes, [{ item: 'cloth', count: 6 }], items, [], ['bed']);
    const cabin = rows.filter(r => r.group === 'cabin');
    expect(cabin.map(r => r.name)).toEqual(['Rag rug', 'Oil lamp', 'Trophy shelf', 'Bed', 'Drying rack', 'Iron stove']);
    expect(rows.slice(-cabin.length)).toEqual(cabin);
    expect(cabin.find(r => r.name === 'Rag rug')).toMatchObject({ facts: 'Comfort 1', can: true });
    // The bed stands in its place already: never made again.
    expect(cabin.find(r => r.name === 'Bed')).toMatchObject({ facts: 'Comfort 2 · In its place', can: false });
  });

  it('asks first, saying where it goes, and says what it made and how comfortable the cabin is now', () => {
    expect(makeQuestion(recipe('iron-stove'), items)).toBe('Make an iron stove? It uses 10 scrap, 3 wire and 5 resin. It goes straight into its place.');
    expect(makeQuestion(recipe('rag-rug'), items)).toBe('Make a rag rug? It uses 6 cloth. It goes straight into its place.');
    expect(didText({ kind: 'made', item: 'iron-stove', count: 1, comfort: 4 }, items)).toBe('You make an iron stove and set it in its place. Your home\'s comfort is 4 of 10.');
    expect(placedAlready(items.get('drying-rack'))).toBe('Your drying rack stands in its place already.');
  });

  it('shows a card that says it goes straight into its place, or that it stands there, greyed', () => {
    const state = { items, bag: [], stash: [{ item: 'scrap', count: 4 }, { item: 'resin', count: 2 }], gear: {}, worn: {} };
    const card = detailView({ from: 'recipe', id: 'trophy-shelf' }, state)!;
    expect(card).toMatchObject({ name: 'Trophy shelf', facts: ['Comfort 1'], act: { label: 'Make', enabled: true } });
    expect(card.notes.map(n => n.text)).toEqual(['Made, it goes straight into its place in your home.']);
    const made = detailView({ from: 'recipe', id: 'trophy-shelf' }, { ...state, furniture: ['trophy-shelf'] })!;
    expect(made).toMatchObject({ act: { label: 'In its place', enabled: false } });
    expect(made.notes.map(n => n.text)).toEqual(['It stands in its place in your home.']);
  });
});

describe('what stands in your cabin', () => {
  it('says what is spoiled and where to make it again, or what you made; the shelf says what stands on it', () => {
    const stove = items.get('iron-stove');
    expect(comfortLines('stove', stove, false)).toEqual({
      who: 'Old stove', lines: [stove.spoiled, 'Make an iron stove at the workbench beside the chest: it goes straight into its place.'],
    });
    expect(comfortLines('stove', stove, true)).toEqual({ who: 'Iron stove', lines: [stove.text] });
    const shelf = items.get('trophy-shelf');
    expect(comfortLines('shelf', shelf, true, [items.get('warm-pebble'), items.get('shard-cap')]).lines[1]).toBe('On it: a warm pebble and a shard-lined cap.');
    expect(comfortLines('shelf', shelf, true).lines[1]).toBe('Nothing on it yet. The charms and anomalous gear you keep in your stash will stand here.');
  });

  it('puts on the trophy shelf each charm and piece of anomalous gear the stash holds, once, and nothing else', () => {
    const stash = [{ item: 'resin', count: 5 }, { item: 'humming-bead', count: 2 }, { item: 'raincoat', count: 1 }, { item: 'shard-cap', count: 1 }, { item: 'shard-cap', count: 1 }];
    expect(trophiesIn(stash, id => items.get(id)).map(d => d.id)).toEqual(['humming-bead', 'shard-cap']);
    expect([...madePlaces(['bed', 'iron-stove', 'resin'], id => items.get(id))].sort()).toEqual(['bed', 'stove']);
  });

  it('builds every place on its tiles, spoiled and made; a made lamp and stove glow, the spoiled ones do not', () => {
    const map = new TileMap(home);
    const places = home.objects.filter((o): o is Extract<MapObject, { kind: 'comfort' }> => o.kind === 'comfort');
    expect(places.map(p => p.what).sort()).toEqual([...COMFORTS].sort());
    const glows = (m: THREE.Object3D) => { let g = false; m.traverse(o => { if (o instanceof THREE.Mesh && (o.material as THREE.MeshToonMaterial).emissive?.getHex()) g = true; }); return g; };
    for (const o of places) {
      for (const made of [false, true]) {
        const m = comfortModel(o, made, map, o.what === 'shelf' ? [items.get('warm-pebble'), items.get('shard-cap')] : []);
        const b = new THREE.Box3().setFromObject(m), [w, h] = o.what === 'bed' ? [1, 2] : o.what === 'rug' ? [3, 2] : [1, 1];
        expect(b.min.x, `${o.what} ${made}`).toBeGreaterThanOrEqual(o.x - 0.05);
        expect(b.max.x, `${o.what} ${made}`).toBeLessThanOrEqual(o.x + w + 0.05);
        expect(b.min.z, `${o.what} ${made}`).toBeGreaterThanOrEqual(o.y - 0.05);
        expect(b.max.z, `${o.what} ${made}`).toBeLessThanOrEqual(o.y + h + 0.05);
        if (o.what === 'rug') expect(b.max.y).toBeLessThan(0.03);
        if (o.what === 'lamp' || o.what === 'stove') expect(glows(m), `${o.what} ${made}`).toBe(made);
      }
    }
  });

  it('keeps the windows clear of the stove\'s pipe and the trophy shelf', () => {
    const map = new TileMap(home);
    const spots = windowSpots(map, wallShapes(map));
    expect(spots.length).toBeGreaterThan(0);
    const tall = home.objects.flatMap(o => (o.kind === 'comfort' && (o.what === 'stove' || o.what === 'shelf') ? [`${o.x},${o.y}`] : []));
    expect(tall).toHaveLength(2);
    for (const s of spots) expect(tall).not.toContain(`${s.x},${s.y + 1}`);
  });
});

describe('in the game', () => {
  const me = (x: number, y: number): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir: 'up', color: '#f29e4c', gear: {}, quirks: [] });
  const maps = new Maps([tinyTown(), home]);
  let sent: ClientMsg[];
  let g: Game;
  beforeEach(() => {
    sent = [];
    g = new Game(maps, m => sent.push(m), items);
    // At the spawn by the door of the cabin, told what stands in it.
    g.handle({ ...welcome(home, [me(1, 2)], FULL, { items: items.version }), furniture: ['iron-stove'] }, 1000);
  });

  it('learns what stands in the cabin with the room, and when you make more', () => {
    expect(g.furniture).toEqual(['iron-stove']);
    const before = g.furnitureChanges;
    g.handle({ t: 'furniture', furniture: ['iron-stove', 'bed'] }, 1100);
    expect(g.furniture).toEqual(['iron-stove', 'bed']);
    expect(g.furnitureChanges).toBe(before + 1);
    // Out in town nothing is said of it, and it is kept for the next time in.
    g.handle(zone(tinyTown(), 3, 3, [me(3, 3)]), 1200);
    expect(g.furniture).toEqual(['iron-stove', 'bed']);
  });

  it('reads what stands in a place with A, facing it', () => {
    // 1,2 faces the stove's place at 1,1.
    g.pressA();
    expect(g.dialog).toMatchObject({ who: 'Iron stove', lines: [items.get('iron-stove').text] });
    expect(sent).toEqual([]);
    g.dialog = null;
    g.handle({ t: 'furniture', furniture: [] }, 1100);
    g.pressA();
    expect(g.dialog).toMatchObject({ who: 'Old stove' });
  });

  it('says so when you ask for furniture that stands in its place already, and asks nothing', () => {
    g.bench = { x: 6, y: 1, stash: [{ item: 'scrap', count: 20 }, { item: 'wire', count: 5 }, { item: 'resin', count: 9 }] };
    const said = () => g.note?.text;
    g.craft('iron-stove');
    expect(g.question).toBeNull();
    expect(said()).toBe('Your iron stove stands in its place already.');
    g.note = null;
    g.craft('bed');
    expect(g.question).toBeNull();
    expect(said()).toBe('Your stash is short of 8 cloth for a bed.');
  });

  it('keeps cozy quiet during a new player\'s first steps: they wake up by the fire, and one thing at a time', () => {
    g.firstSteps = 1;
    g.handle({ t: 'energy', energy: FULL, body: { ...DRY, fireside: COZY_AFTER_S, cozy: 480 } }, 22_000);
    expect(g.takeNews(22_000)).toEqual([]);
    expect(g.bodyNow(22_000).cozy).toBe(480);
  });

  it('announces cozy once, counts it down away from the fire and holds it by it, and says when it wears off', () => {
    g.handle({ t: 'energy', energy: FULL, body: { ...DRY, fireside: 0 } }, 2000);
    expect(g.takeNews(2000)).toEqual([]);
    g.handle({ t: 'energy', energy: FULL, body: { ...DRY, fireside: COZY_AFTER_S, cozy: 480 } }, 22_000);
    expect(g.takeNews(22_000)).toEqual([{ kind: 'cozy', minutes: 8 }]);
    // Held in full while you stay by the fire.
    expect(g.bodyNow(82_000).cozy).toBe(480);
    // Away from it, it counts down.
    g.handle({ t: 'energy', energy: FULL, body: { ...DRY, cozy: 480 } }, 82_000);
    expect(g.takeNews(82_000)).toEqual([]);
    expect(g.bodyNow(142_000).cozy).toBeCloseTo(420);
    expect(g.bodyNow(600_000).cozy).toBeUndefined();
    g.handle({ t: 'energy', energy: FULL, body: DRY }, 562_000);
    expect(g.floats.map(f => f.text)).toContain('The warmth of home wears off');
  });
});

describe('cozy, in the status panel and the banner', () => {
  const status = (body: typeof DRY) => statusView({
    energy: FULL, body, surge: null, caught: false, storm: null, flash: null, weather: 'overcast', wilds: true, stone: { charge: 0, need: 0, awake: false, left: 0 }, stats: {}, bag: [], items,
    progress: START, resists: null, wear: null, quirks: [],
  }).rows.find(r => r.label === 'Cozy');

  it('says how long it lasts, as "Cozy: 12 min left"', () => {
    expect(status({ ...DRY, cozy: 700 })).toEqual({ label: 'Cozy', text: '12 min left', tone: 'good' });
    expect(status({ ...DRY, cozy: 30 })).toMatchObject({ text: 'under a minute left' });
    expect(status({ ...DRY, cozy: 480, fireside: 30 })).toMatchObject({ text: '8 min, from when you leave the fire' });
    expect(status({ ...DRY, fireside: 5 })).toMatchObject({ text: 'Warming up by your fire: cozy in 15 s' });
    expect(status(DRY)).toBeUndefined();
    expect(cozyText(0, undefined)).toBeNull();
  });

  it('has a banner when you become cozy', () => {
    expect(newsBanner({ kind: 'cozy', minutes: 15 }, 'Home')).toEqual({ title: 'Cozy', sub: 'Out in the wilds you tire 10% slower\nfor 15 minutes once you leave the fire.' });
  });
});
