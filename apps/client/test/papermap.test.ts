import { describe, expect, it } from 'vitest';
import { TileMap, type MapData } from '@napoland/shared';
import { areaOf, mapFor, mask, sketchOf } from '../src/papermap';

/** Forest around a road going north from the way home, a pond, a cabin with its door, and two poles. */
function woods(): MapData {
  return {
    id: 'woods', name: 'The Woods', version: 1, kind: 'wilds', depth: 1, width: 10, height: 10,
    tiles: ['tttttttttt', 'tgggrggggt', 'tgggrgwwwt', 'tgggrgwwwt', 'tgggrgwwgt', 'tgggrggggt', 'tgggrggggt', 'tgggrggggt', 'tgggrggggt', 'ttttrttttt'],
    levels: Array<string>(10).fill('0000000000'),
    spawn: { x: 4, y: 8, dir: 'up' },
    exits: [
      { x: 4, y: 9, w: 1, h: 1, to: 'town', tx: 0, ty: 0, dir: 'down', home: true },
      { x: 2, y: 3, w: 1, h: 1, to: 'hut', tx: 1, ty: 1, dir: 'up' },
    ],
    objects: [{ kind: 'house', x: 1, y: 1, w: 3, h: 2, roof: '#555555', lit: 1 }, { kind: 'pole', x: 5, y: 2 }, { kind: 'pole', x: 5, y: 7 }],
  };
}
const names: Record<string, string> = { town: 'Stonebrook', hut: 'The hut' };

describe('the paper map', () => {
  const s = sketchOf(new TileMap(woods()), id => names[id]);

  it('draws the road, the water, the cabin and the power line, a little off where they really are', () => {
    // The road runs from y 1 to y 9, never more than a little off.
    expect(s.roads).toHaveLength(9);
    for (const [x] of s.roads) expect(Math.abs(x - 4.5)).toBeLessThanOrEqual(0.35);
    expect(s.forest.length).toBeGreaterThan(s.trees.length);
    expect(s.water).toHaveLength(8);
    expect(s.houses).toHaveLength(1);
    expect(s.wires).toHaveLength(1);
    expect(s.trees.length).toBeGreaterThan(0);
  });

  it('names the way home, the cabins and the pond, and the map at the top', () => {
    expect(s.title).toBe('The Woods');
    expect(s.labels.map(l => l.text)).toEqual(['to Stonebrook', 'The hut', 'pond']);
  });

  it('draws NAPO\'s buildings with flat roofs, its masts, and fences as closed lines', () => {
    const napo: MapData = {
      ...woods(), id: 'grounds', name: 'The Grounds',
      objects: [
        { kind: 'house', x: 1, y: 1, w: 3, h: 2, roof: '#555555', lit: 1, style: 'napo' },
        { kind: 'antenna', x: 7, y: 7 },
        { kind: 'fence', x: 6, y: 5, dir: 'h' }, { kind: 'fence', x: 7, y: 5, dir: 'h' }, { kind: 'fence', x: 8, y: 6, dir: 'v' },
      ],
    };
    const g = sketchOf(new TileMap(napo), id => names[id]);
    expect(g.houses.map(h => h.flat)).toEqual([true]);
    expect(s.houses.map(h => h.flat)).toEqual([false]);
    expect(g.masts).toHaveLength(1);
    expect(Math.hypot(g.masts[0]![0] - 7.5, g.masts[0]![1] - 7.5)).toBeLessThanOrEqual(0.5);
    // Two fence tiles side by side make one line with no gap: a yard drawn on paper stays closed.
    expect(g.fences).toEqual([[[6, 5.5], [7, 5.5]], [[7, 5.5], [8, 5.5]], [[8.5, 6], [8.5, 7]]]);
  });

  it('writes in the places the map names, which then name the water too', () => {
    const named = sketchOf(new TileMap({ ...woods(), places: [{ name: 'the sinks', x: 7, y: 3 }, { name: 'ring of stones', x: 2, y: 7 }] }), id => names[id]);
    expect(named.labels.map(l => l.text)).toEqual(['to Stonebrook', 'The hut', 'the sinks', 'ring of stones']);
  });

  it('never writes one name over another: side by side, one goes a line up', () => {
    const two: MapData = {
      ...woods(), width: 30, height: 20, tiles: Array<string>(20).fill('g'.repeat(30)), levels: Array<string>(20).fill('0'.repeat(30)),
      exits: [{ x: 10, y: 12, w: 1, h: 1, to: 'hut', tx: 1, ty: 1, dir: 'up' }, { x: 14, y: 12, w: 1, h: 1, to: 'town', tx: 0, ty: 0, dir: 'up' }],
      objects: [],
    };
    const [a, b] = sketchOf(new TileMap(two), id => names[id]).labels;
    expect(a!.y).toBeCloseTo(8.6);
    expect(Math.abs(a!.y - b!.y)).toBeGreaterThanOrEqual(1.9);
  });

  it('never writes a name over a mast or a sign: a place named at one, or beside it, goes to the nearest clear line', () => {
    const grounds: MapData = {
      ...woods(), width: 30, height: 20, tiles: Array<string>(20).fill('g'.repeat(30)), levels: Array<string>(20).fill('0'.repeat(30)),
      exits: [], objects: [{ kind: 'antenna', x: 15, y: 10 }, { kind: 'antenna', x: 24, y: 14 }, { kind: 'sign', x: 6, y: 16, text: ['The ford'] }],
      places: [{ name: 'the Tower', x: 15, y: 10 }, { name: 'field site', x: 21, y: 15 }, { name: 'the ford', x: 6, y: 16 }],
    };
    const g = sketchOf(new TileMap(grounds), id => names[id]);
    // A name is 0.95 a letter wide and 1.9 high. A mast is drawn from 2.2 tiles above its point to half
    // a tile below, 0.45 each side; a sign from 0.75 above to 5/12 below, 5/12 each side.
    const marks = [...g.masts.map(([x, y]) => ({ x, y, up: 2.2, down: 0.5, side: 0.45 })), ...g.signs.map(([x, y]) => ({ x, y, up: 0.75, down: 5 / 12, side: 5 / 12 }))];
    expect(marks).toHaveLength(3);
    for (const l of g.labels) for (const m of marks) {
      const beside = Math.abs(l.x - m.x) >= (l.text.length * 0.95) / 2 + m.side;
      const aboveOrBelow = l.y + 0.95 <= m.y - m.up || l.y - 0.95 >= m.y + m.down;
      expect(beside || aboveOrBelow, `${l.text} and the drawing at ${m.x}`).toBe(true);
    }
    // Still by the place it names: one line off, not across the paper.
    for (const l of g.labels) expect(Math.abs(l.y - (grounds.places!.find(p => p.name === l.text)!.y + 0.5)), l.text).toBeCloseTo(1.9);
  });

  it('hatches every tile of tall grass, a little off, and puts no ground dots there', () => {
    const tall = woods();
    tall.tiles = tall.tiles.map((r, y) => (y === 6 || y === 7 ? `${r.slice(0, 5)}hhh${r.slice(8)}` : r));
    const g = sketchOf(new TileMap(tall), id => names[id]);
    expect(g.grass).toHaveLength(6);
    for (const [x, y] of g.grass) {
      expect(x >= 5 && x <= 8 && y >= 6 && y <= 8, `${x},${y}`).toBe(true);
      expect(Math.abs(x - Math.floor(x) - 0.5)).toBeLessThanOrEqual(0.35);
    }
    expect(g.ground.filter(([x, y]) => x > 5 && x < 8 && y > 6 && y < 8)).toEqual([]);
    expect(s.grass).toEqual([]);
  });

  it('draws what the town, the leavers and NAPO left: the mill\'s sawtooth, vehicles by their size, log decks, stumps, stakes, skids and small things', () => {
    const left: MapData = {
      ...woods(), width: 30, height: 20, tiles: Array<string>(20).fill('g'.repeat(30)), levels: Array<string>(20).fill('0'.repeat(30)),
      exits: [{ x: 5, y: 3, w: 1, h: 1, to: 'hut', tx: 1, ty: 1, dir: 'up' }],
      objects: [
        { kind: 'house', x: 2, y: 2, w: 6, h: 2, roof: '#7a4a2e', lit: 0, style: 'mill' },
        { kind: 'car', x: 10, y: 2, w: 2 }, { kind: 'car', x: 14, y: 2, w: 1, h: 2, dir: 'down', door: true },
        { kind: 'truck', x: 16, y: 2, w: 1, h: 3, dir: 'down', style: 'napo' }, { kind: 'jeep', x: 18, y: 2, w: 2, h: 1, dir: 'left', text: ['NAPO'] },
        { kind: 'logs', x: 2, y: 8, w: 3, h: 2 }, { kind: 'stump', x: 7, y: 8, s: 1, v: 0.2 }, { kind: 'stake', x: 9, y: 8 },
        { kind: 'skid', x: 11, y: 8, dir: 'h' }, { kind: 'piano', x: 13, y: 8 }, { kind: 'cage', x: 16, y: 8, text: ['NAPO'] },
        { kind: 'sign', x: 18, y: 8, style: 'mailbox', text: ['DAHL'] }, { kind: 'sign', x: 20, y: 8, style: 'cardboard', text: ['PLEASE'] },
      ],
    };
    const g = sketchOf(new TileMap(left), id => names[id]);
    expect(g.houses.map(h => [h.flat, h.mill])).toEqual([[false, true]]);
    expect(g.cars.map(c => [c.kind, c.w, c.h])).toEqual([['car', 2, 1], ['car', 1, 2], ['truck', 1, 3], ['jeep', 2, 1]]);
    // Each by the middle of its tiles, a little off: a car standing north to south is drawn so.
    for (const c of g.cars) expect(Math.abs(c.at[0] - (left.objects.find(o => o.kind === c.kind && o.x <= c.at[0] && c.at[0] <= o.x + c.w)!.x + c.w / 2))).toBeLessThanOrEqual(0.35);
    expect(g.logs).toEqual([{ x: 2, y: 8, w: 3, h: 2 }]);
    expect(g.stumps).toHaveLength(1);
    expect(g.stakes).toHaveLength(1);
    expect(g.skids).toEqual([[[11.5, 8.15], [11.5, 8.85]]]);
    expect(g.things.map(t => t.kind)).toEqual(['piano', 'cage', 'mailbox']);
    // A mailbox is a little thing by a door; the cardboard sign is a sign like any other.
    expect(g.signs).toHaveLength(1);
  });

  it('draws the fire lookout where it stands, over the middle of its four legs, and names it where you climb it', () => {
    const hill: MapData = {
      ...woods(), width: 12, height: 10, tiles: Array<string>(10).fill('g'.repeat(12)), levels: Array<string>(10).fill('0'.repeat(12)), exits: [],
      objects: [{ kind: 'lookout', x: 4, y: 3 }], places: [{ name: 'the fire lookout', x: 5, y: 5 }],
    };
    const g = sketchOf(new TileMap(hill), id => names[id]);
    expect(g.things).toEqual([{ at: [5, 4], kind: 'lookout' }]);
    expect(g.labels.map(l => l.text)).toContain('the fire lookout');
  });

  it('writes a name once: a door named like a place gives its name to the place', () => {
    const mill: MapData = { ...woods(), places: [{ name: 'the hut', x: 1, y: 1 }] };
    const labels = sketchOf(new TileMap(mill), id => ({ ...names, hut: 'The hut' })[id]).labels.map(l => l.text);
    expect(labels.filter(t => t.toLowerCase() === 'the hut')).toEqual(['the hut']);
  });

  it('writes the places before the doors, so a street of new houses never moves a name that was there, and a door\'s name that finds no room goes in front of it', () => {
    const street: MapData = {
      ...woods(), width: 40, height: 30, tiles: Array<string>(30).fill('g'.repeat(40)), levels: Array<string>(30).fill('0'.repeat(40)),
      exits: [
        { x: 11, y: 15, w: 1, h: 1, to: 'hut', tx: 1, ty: 1, dir: 'up' },
        { x: 15, y: 15, w: 1, h: 1, to: 'far', tx: 1, ty: 1, dir: 'up' },
      ],
      objects: [{ kind: 'house', x: 10, y: 14, w: 3, h: 2, roof: '#555555', lit: 0 }, { kind: 'house', x: 14, y: 14, w: 3, h: 2, roof: '#555555', lit: 0 }],
      places: [{ name: 'the notice board', x: 8, y: 11 }],
    };
    const g = sketchOf(new TileMap(street), id => ({ hut: 'The Lindqvist house', far: 'The Okada house' })[id]);
    const at = (text: string) => g.labels.find(l => l.text === text)!;
    // The place is written where it stands; the first door's name above its roof, the second in front of its door.
    expect(at('the notice board').y).toBeCloseTo(11.5);
    expect(at('The Lindqvist house').y).toBeLessThan(14);
    expect(at('The Okada house').y).toBeGreaterThan(15);
  });

  it('is the same drawing every time, and knows nothing of who looks at it', () => {
    expect(sketchOf(new TileMap(woods()), id => names[id])).toEqual(s);
    expect(sketchOf.length).toBe(2);
  });
});

describe('which map the map button opens', () => {
  // A town with a room, woods with a hut, and a region nobody has a map of yet.
  const at = (id: string, kind: MapData['kind'], to: string[]) => ({ id, kind, exits: to.map(t => ({ x: 0, y: 0, w: 1, h: 1, to: t, tx: 0, ty: 0, dir: 'up' as const })) }) as unknown as MapData;
  const all = [at('town', 'town', ['home', 'woods']), at('home', 'inside', ['town']), at('woods', 'wilds', ['town', 'hut', 'far']), at('hut', 'inside', ['woods']), at('far', 'wilds', ['woods'])];
  const find = (id: string) => all.find(m => m.id === id);
  const charts: Record<string, string> = { 'town-map': 'town', 'woods-map': 'woods', radio: '' };
  const chartOf = (t: string) => charts[t] || undefined;
  const tools = ['radio', 'town-map', 'woods-map'];

  it('takes a room for the place its door opens onto, and anywhere else for itself', () => {
    expect(areaOf('hut', find)).toBe('woods');
    expect(areaOf('home', find)).toBe('town');
    expect(areaOf('woods', find)).toBe('woods');
    expect(areaOf('nowhere', find)).toBe('nowhere');
  });

  it('opens the map of the area you are in, indoors the one outside, and none where you have no map', () => {
    expect(mapFor('town', tools, chartOf, find)).toBe('town-map');
    expect(mapFor('woods', tools, chartOf, find)).toBe('woods-map');
    expect(mapFor('hut', tools, chartOf, find)).toBe('woods-map');
    expect(mapFor('home', tools, chartOf, find)).toBe('town-map');
    expect(mapFor('far', tools, chartOf, find)).toBeUndefined();
    expect(mapFor('woods', ['town-map'], chartOf, find)).toBeUndefined();
  });
});

describe('a torn map, drawn by the pieces found', () => {
  const s = sketchOf(new TileMap(woods()), id => names[id]);

  it('keeps what lies in the quarters found, names included, and nothing of the rest', () => {
    // The woods are 10 by 10: the road down the middle-left (x 4) runs through the west quarters, the pond and its name lie north-east.
    const nw = mask(s, [0]);
    expect(nw.roads.length).toBe(4);
    for (const [x, y] of nw.roads) expect([x < 5, y < 5]).toEqual([true, true]);
    expect(nw.water).toEqual([]);
    expect(nw.houses).toHaveLength(1);
    expect(nw.labels.map(l => l.text)).toEqual(['The hut']);
    const ne = mask(s, [1]);
    expect(ne.water).toHaveLength(8);
    expect(ne.roads).toEqual([]);
    expect(ne.labels.map(l => l.text)).toEqual(['pond']);
    // The power line runs from y 2 to y 7: its wire needs both poles, one in each half.
    expect(ne.poles).toHaveLength(1);
    expect(ne.wires).toEqual([]);
    expect(mask(s, [1, 3]).wires).toHaveLength(1);
  });

  it('is the whole sketch with every piece found', () => {
    expect(mask(s, [3, 1, 0, 2])).toBe(s);
  });
});
