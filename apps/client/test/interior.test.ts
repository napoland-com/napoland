import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TileMap, validateMap, validateWorld, type MapData, type MapObject } from '@napoland/shared';
import { Maps } from '../src/maps';
import { campfireModel, coldHearthModel, hearthModel } from '../src/view/fire';
import {
  WALL_LOW, WALL_TALL, doorways, floorTile, furnitureModel, hasFire, hearthAt, houseDoors, roomCurtains, roomTone, wallShapes, wallTile, windowModel, windowSpots, type QuadFn,
} from '../src/view/interior';
import { curtainColor } from '../src/view/left';
import { cabin, houseTown, shed, tinyTown, tinyWoods } from './fixtures';

const room = new TileMap(cabin());
const shapes = wallShapes(room);
const shapeAt = (map: TileMap, s: readonly string[], x: number, y: number) => s[y * map.width + x];

describe('the fixtures', () => {
  it('follow the content rules, doors and insides included', () => {
    for (const m of [tinyTown(), tinyWoods(), houseTown(), cabin(), shed()]) expect(validateMap(m).filter(p => p.level === 'error'), m.id).toEqual([]);
    expect(validateWorld([tinyTown(), tinyWoods()], 'town').filter(p => p.level === 'error')).toEqual([]);
    expect(validateWorld([houseTown(), cabin(), shed()], 'hometown').filter(p => p.level === 'error')).toEqual([]);
  });
});

describe('the walls of a room', () => {
  it('stand tall at the back and on the sides', () => {
    for (let x = 0; x < 9; x++) expect(shapeAt(room, shapes, x, 0), `back wall ${x}`).toBe('tall');
    for (let y = 1; y <= 5; y++) {
      expect(shapeAt(room, shapes, 0, y), `left wall ${y}`).toBe('tall');
      expect(shapeAt(room, shapes, 8, y), `right wall ${y}`).toBe('tall');
    }
  });

  it('are cut down low in front, corners too, with a gap where the door is', () => {
    for (const x of [0, 1, 2, 3, 5, 6, 7, 8]) expect(shapeAt(room, shapes, x, 6), `front wall ${x}`).toBe('low');
    expect(room.kind(4, 6)).toBe('floor');
    expect(shapeAt(room, shapes, 4, 6)).toBe('none');
  });

  it('never stand tall right in front of the room, where they would hide it from the camera', () => {
    for (const map of [room, new TileMap(shed())]) {
      const s = wallShapes(map);
      for (let y = 1; y < map.height; y++) for (let x = 0; x < map.width; x++) {
        if (shapeAt(map, s, x, y) === 'tall') expect(map.kind(x, y - 1), `${map.data.id} ${x},${y}`).toBe('wall');
      }
    }
  });

  it('are not drawn where they only touch other walls: the void around a room is black', () => {
    const thick: MapData = { ...shed(), id: 'thick', width: 8, tiles: shed().tiles.map(r => 'x' + r), levels: Array<string>(6).fill('00000000'), spawn: { x: 4, y: 4, dir: 'up' }, exits: [{ x: 4, y: 5, w: 1, h: 1, to: 'hometown', tx: 7, ty: 3, dir: 'down' }], objects: [] };
    const map = new TileMap(thick), s = wallShapes(map);
    for (let y = 0; y < 6; y++) expect(shapeAt(map, s, 0, y)).toBe('none');
    expect(shapeAt(map, s, 1, 3)).toBe('tall');
  });

  it('are blocks as high as their shape, floors lie flat, and a buried wall draws nothing', () => {
    const heights = (fn: (quad: QuadFn) => void) => {
      const ys: number[] = [];
      fn((a, b, c, d) => { for (const p of [a, b, c, d]) ys.push(p[1]); });
      return ys;
    };
    const tone = roomTone(true);
    expect(Math.max(...heights(q => wallTile(q, room, shapes, 4, 0, tone)))).toBeCloseTo(WALL_TALL);
    expect(Math.max(...heights(q => wallTile(q, room, shapes, 3, 6, tone)))).toBeCloseTo(WALL_LOW);
    expect(heights(q => wallTile(q, room, shapes, 4, 6, tone))).toEqual([]);
    const floor = heights(q => floorTile(q, 4, 3, tone));
    expect(floor.length).toBeGreaterThan(0);
    expect(floor.every(y => y === 0)).toBe(true);
  });
});

describe('NAPO\'s rooms', () => {
  /** How many quads a builder adds to the terrain. */
  const quads = (build: (quad: QuadFn) => void) => { let n = 0; build(() => { n++; }); return n; };

  it('are concrete: one slab a floor tile, and flat courses of block on the walls instead of logs', () => {
    const wood = roomTone(true), concrete = roomTone(true, true);
    expect(concrete.concrete).toBe(true);
    expect(wood.concrete).toBeFalsy();
    // A slab and its grout on two sides; a wooden tile is three boards, and a joint or two between them.
    expect(quads(q => floorTile(q, 3, 3, concrete))).toBe(3);
    expect(quads(q => floorTile(q, 3, 3, wood))).toBeGreaterThanOrEqual(3);
    const backWall = (tone: typeof wood) => quads(q => wallTile(q, room, shapes, 4, 0, tone));
    expect(backWall(concrete)).toBeLessThan(backWall(wood));
  });
});

describe('windows, doorways and the fire', () => {
  it('puts windows in the back wall, not over the fireplace or a shelf', () => {
    const spots = windowSpots(room, shapes);
    expect(spots.length).toBeGreaterThanOrEqual(1);
    for (const w of spots) {
      expect(w.y).toBe(0);
      expect(Math.abs(w.x - 4)).toBeGreaterThan(1); // the fireplace's chimney is at 4
      expect(w.x).not.toBe(7); // the shelf
      expect(w.x).toBeGreaterThan(0);
      expect(w.x).toBeLessThan(8);
    }
  });

  it('puts two windows in a wide room, a quarter in from each side, and one in a narrow room', () => {
    const wide = new TileMap({ ...cabin(), id: 'wide', objects: [] });
    expect(windowSpots(wide, wallShapes(wide))).toEqual([{ x: 2, y: 0 }, { x: 6, y: 0 }]);
    // Either side of a fire in the middle, as in the lodge.
    const hearth = new TileMap({ ...cabin(), id: 'hearth', objects: [{ kind: 'fireplace', x: 4, y: 1 }] });
    expect(windowSpots(hearth, wallShapes(hearth))).toEqual([{ x: 2, y: 0 }, { x: 6, y: 0 }]);
    const narrow = new TileMap({ ...shed(), id: 'narrow', width: 5, tiles: ['xxxxx', 'xpppx', 'xpppx', 'xpppx', 'xpppx', 'xxpxx'], levels: Array<string>(6).fill('00000'), objects: [] });
    expect(windowSpots(narrow, wallShapes(narrow))).toEqual([{ x: 2, y: 0 }]);
  });

  it('keeps a window clear of the board a workbench hangs its tools on', () => {
    // As at home: the fire in the middle, the chest and the workbench beside it, a bed in the corner.
    const home = new TileMap({ ...cabin(), id: 'home', objects: [{ kind: 'fireplace', x: 4, y: 1 }, { kind: 'chest', x: 5, y: 1 }, { kind: 'workbench', x: 6, y: 1 }, { kind: 'bed', x: 7, y: 1 }] });
    expect(windowSpots(home, wallShapes(home))).toEqual([{ x: 2, y: 0 }, { x: 7, y: 0 }]);
  });

  it('finds the doorway and the way out through it', () => {
    expect(doorways(room)).toEqual([{ x: 4, y: 6, dir: 'down' }]);
  });

  it('builds a hearth against a wall and a ring of stones in the open, flames where the fire is', () => {
    expect(hearthAt(room, 4, 1)).toBe(true);
    const woods = new TileMap(tinyWoods());
    expect(hearthAt(woods, 3, 2)).toBe(false);
    const embers = new THREE.MeshBasicMaterial();
    const hearth = hearthModel(4, 1, embers), camp = campfireModel(3, 2, embers);
    expect(hearth.spot).toMatchObject({ x: 4.5, hearth: true });
    expect(hearth.spot.z).toBeGreaterThan(1);
    expect(hearth.spot.z).toBeLessThan(1.5);
    expect(camp.spot).toMatchObject({ x: 3.5, z: 2.5, hearth: false });
    // The chimney breast goes up to the top of the wall.
    const top = new THREE.Box3().setFromObject(hearth.model).max.y;
    expect(top).toBeGreaterThanOrEqual(WALL_TALL - 0.01);
  });
});

describe('furniture', () => {
  it('is built for every kind of furniture, on its tiles, and not for other things', () => {
    for (const o of cabin().objects) {
      const m = furnitureModel(o, room);
      if (o.kind === 'fireplace') { expect(m).toBeNull(); continue; }
      expect(m, o.kind).not.toBeNull();
      const b = new THREE.Box3().setFromObject(m!);
      const w = o.kind === 'rug' ? o.w : 1, h = o.kind === 'rug' ? o.h : o.kind === 'bed' ? 2 : 1;
      expect(b.min.x, o.kind).toBeGreaterThanOrEqual(o.x - 0.01);
      expect(b.max.x, o.kind).toBeLessThanOrEqual(o.x + w + 0.01);
      expect(b.min.z, o.kind).toBeGreaterThanOrEqual(o.y - 0.01);
      expect(b.max.z, o.kind).toBeLessThanOrEqual(o.y + h + 0.01);
    }
    expect(furnitureModel({ kind: 'lamp', x: 1, y: 1 }, room)).toBeNull();
  });

  it('builds NAPO\'s desk on its tile, its back to the wall and its screen still glowing', () => {
    const desk = furnitureModel({ kind: 'console', x: 4, y: 1, id: 'radio', name: 'Radio', text: ['A hum.'] }, room)!;
    const b = new THREE.Box3().setFromObject(desk);
    expect(b.min.x).toBeGreaterThanOrEqual(3.99);
    expect(b.max.x).toBeLessThanOrEqual(5.01);
    expect(b.min.z).toBeGreaterThanOrEqual(0.99);
    expect(b.max.z).toBeLessThanOrEqual(2.01);
    let glows = false;
    desk.traverse(o => { if (o instanceof THREE.Mesh && (o.material as THREE.MeshToonMaterial).emissive?.getHex()) glows = true; });
    expect(glows).toBe(true);
  });

  it('keeps rugs flat, under shadows and pools of light', () => {
    const rug = furnitureModel({ kind: 'rug', x: 3, y: 3, w: 3, h: 2 }, room)!;
    expect(new THREE.Box3().setFromObject(rug).max.y).toBeLessThan(0.03);
  });

  it('stacks a woodpile along the wall beside it, on its tile and lower than a person', () => {
    const lodge = new TileMap({ ...cabin(), objects: [{ kind: 'woodpile', x: 7, y: 3 }] });
    const pile = furnitureModel({ kind: 'woodpile', x: 7, y: 3 }, lodge)!;
    const b = new THREE.Box3().setFromObject(pile);
    expect(b.min.x).toBeGreaterThanOrEqual(6.99);
    expect(b.max.x).toBeLessThanOrEqual(8.01);
    expect(b.min.z).toBeGreaterThanOrEqual(2.99);
    expect(b.max.z).toBeLessThanOrEqual(4.01);
    expect(b.max.y).toBeLessThan(0.9);
    // Against the east wall: the top of the stack leans on it, east of the tile's middle.
    const top = new THREE.Box3();
    pile.updateMatrixWorld(true);
    pile.traverse(o => { if (o instanceof THREE.Mesh && new THREE.Box3().setFromObject(o).min.y > 0.5) top.expandByObject(o); });
    expect(top.isEmpty()).toBe(false);
    expect(top.min.x).toBeGreaterThan(7.5);
  });

  it('turns a shelf so its back is against the wall beside it', () => {
    const side = new TileMap({ ...cabin(), objects: [{ kind: 'shelf', x: 1, y: 3 }] });
    const shelf = furnitureModel({ kind: 'shelf', x: 1, y: 3 }, side)!;
    const b = new THREE.Box3().setFromObject(shelf);
    // Against the west wall: its back is at the tile's west edge, and it is shallow east to west.
    expect(b.min.x).toBeLessThan(1.1);
    expect(b.max.x - b.min.x).toBeLessThan(0.6);
  });
});

describe('the houses of those who left, and the mill (roadmap/richer-places.md)', () => {
  /** The cabin with these things in it, and no fire: a house whose people left. */
  const left = (...objects: MapObject[]) => new TileMap({ ...cabin(), id: 'left', objects });

  it('keeps windows clear of a cold hearth\'s chimney, a tall clock and a calendar or a drawing on the wall', () => {
    const m = left({ kind: 'hearth', x: 4, y: 1 }, { kind: 'clock', x: 6, y: 1 }, { kind: 'paper', x: 2, y: 0, look: 'calendar', name: 'Calendar', text: ['Our turn.'] });
    const spots = windowSpots(m, wallShapes(m)).map(w => w.x);
    for (const x of [2, 3, 4, 5, 6]) expect(spots).not.toContain(x);
    expect(spots.length).toBeGreaterThan(0);
  });

  it('draws the curtains inside a house whose people drew them, in the cloth they have from the street, and boards in the empty house', () => {
    const town: MapData = { ...houseTown(), objects: houseTown().objects.map(o => (o.kind === 'house' && !o.lit ? { ...o, curtains: true } : o)) };
    const shedHouse = town.objects.find(o => o.kind === 'house' && !o.lit)!;
    expect(roomCurtains(shed(), id => (id === 'hometown' ? town : undefined))).toBe(curtainColor(shedHouse));
    expect(roomCurtains(shed(), id => (id === 'hometown' ? houseTown() : undefined))).toBeNull();
    expect(roomCurtains(cabin(), id => (id === 'hometown' ? town : undefined))).toBeNull();
    const pane = new THREE.MeshBasicMaterial();
    const colors = (g: THREE.Object3D) => { const out = new Set<string>(); g.traverse(o => { if (o instanceof THREE.Mesh) out.add((o.material as THREE.MeshToonMaterial).color?.getHexString() ?? ''); }); return out; };
    expect(colors(windowModel(2, 0, pane, true, '#6e3a3a'))).toContain('6e3a3a');
    expect(colors(windowModel(2, 0, pane, true))).toContain('5d4c3b');
  });

  it('builds what they left on its tiles: dust sheets, a crib, a stopped clock, a note or a list on a table, a calendar or a drawing on the wall', () => {
    const things: MapObject[] = [
      { kind: 'sheeted', x: 1, y: 3 }, { kind: 'sheeted', x: 6, y: 2 }, { kind: 'sheeted', x: 7, y: 4 }, { kind: 'crib', x: 3, y: 1 }, { kind: 'clock', x: 1, y: 1 },
      { kind: 'paper', x: 4, y: 3, look: 'note', name: 'Note', text: ['Back soon.'] }, { kind: 'paper', x: 5, y: 3, look: 'list', name: 'List', text: ['TAKE: the cat.'] },
    ];
    const m = left(...things);
    for (const o of things) {
      const b = new THREE.Box3().setFromObject(furnitureModel(o, m)!);
      expect([b.min.x >= o.x - 0.03, b.max.x <= o.x + 1.03, b.min.z >= o.y - 0.03, b.max.z <= o.y + 1.03], `${o.kind} at ${o.x},${o.y}`).toEqual([true, true, true, true]);
    }
    // On the wall: flat against the face of the wall tile, up where it can be read from the floor below.
    for (const look of ['calendar', 'drawing'] as const) {
      const b = new THREE.Box3().setFromObject(furnitureModel({ kind: 'paper', x: 2, y: 0, look, name: 'On the wall', text: ['.'] }, m)!);
      expect(b.min.z, look).toBeGreaterThanOrEqual(0.99);
      expect(b.max.z, look).toBeLessThan(1.1);
      expect(b.min.y, look).toBeGreaterThan(0.8);
      expect(b.max.y, look).toBeLessThan(WALL_TALL);
    }
  });

  it('leaves a cold hearth\'s stones as a lit one\'s, with ash and charred ends where the fire was, and nothing that glows', () => {
    const embers = new THREE.MeshBasicMaterial();
    const lit = new THREE.Box3().setFromObject(hearthModel(4, 1, embers).model), cold = coldHearthModel(4, 1);
    const b = new THREE.Box3().setFromObject(cold);
    expect(b.max.y).toBeCloseTo(lit.max.y);
    let glows = false;
    cold.traverse(o => { if (o instanceof THREE.Mesh && (o.material === embers || (o.material as THREE.MeshToonMaterial).emissive?.getHex())) glows = true; });
    expect(glows).toBe(false);
  });

  it('builds the mill\'s floor of boards, and its saw, carriage and sawdust inside the room', () => {
    const mill = roomTone(false, 'mill');
    expect(mill.boards).toBe(true);
    expect(mill.concrete).toBeFalsy();
    /** The heights where a wall's bands meet, low down. */
    const seams = (tone: ReturnType<typeof roomTone>) => {
      const ys = new Set<number>();
      wallTile((a, b, c, d) => { for (const p of [a, b, c, d]) if (p[1] > 0 && p[1] < 0.2) ys.add(Math.round(p[1] * 1000) / 1000); }, room, shapes, 4, 0, tone);
      return [...ys].sort();
    };
    // Sawn boards start with a thin dark line; round logs stand on a sill.
    expect(seams(mill)[0]).toBeCloseTo(0.02);
    expect(seams(roomTone(false))[0]).toBeCloseTo(0.1);
    const floor = new TileMap({ ...cabin(), id: 'mill', style: 'mill', objects: [] });
    for (const o of [{ kind: 'saw', x: 4, y: 1 }, { kind: 'carriage', x: 2, y: 2, w: 5 }, { kind: 'sawdust', x: 3, y: 4 }] as MapObject[]) {
      const b = new THREE.Box3().setFromObject(furnitureModel(o, floor)!);
      const w = o.kind === 'carriage' ? o.w : 1;
      expect([b.min.z >= o.y - 0.5, b.max.z <= o.y + 1.05], o.kind).toEqual([true, true]);
      // The line shaft over the saw runs along the wall; everything else keeps to its tiles.
      if (o.kind !== 'saw') expect([b.min.x >= o.x - 0.05, b.max.x <= o.x + w + 0.05], o.kind).toEqual([true, true]);
    }
  });
});

describe('houses', () => {
  const town = new TileMap(houseTown());
  const maps = new Maps([houseTown(), cabin(), shed()]);

  it('all have an open door you can walk into', () => {
    for (const d of houseDoors(town, id => maps.find(id))) {
      expect(town.walkable(d.x, d.y)).toBe(true);
      expect(town.exitAt(d.x, d.y)).toBeDefined();
    }
  });

  it('know whether the room behind the door keeps a fire, so its chimney smokes', () => {
    expect(houseDoors(town, id => maps.find(id)).map(d => [d.x, d.y, d.fire])).toEqual([[2, 2, true], [7, 2, false]]);
    expect(hasFire(cabin())).toBe(true);
    expect(hasFire(shed())).toBe(false);
  });

  it('have no fire behind a door that leads to a map this client does not have', () => {
    expect(houseDoors(town, () => undefined).some(d => d.fire)).toBe(false);
  });
});
