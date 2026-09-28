import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { doorOf, footprint, type MapData, type MapObject } from '@napoland/shared';
import {
  CAR_TEAL, CURTAINS, birdcageModel, bikeModel, boxesModel, carModel, cardboardModel, curtainColor, deckLogs, headlightCar, leftModel, logDeck, logTruck,
  luggageModel, mailboxModel, millBuilding, pianoModel, rockerModel, skidModel, stumpModel, vehiclePlace,
} from '../src/view/left';

const map = (id: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../content/maps/${id}.json`), 'utf8')) as MapData;
/** The box a model takes up in the world. */
const bounds = (o: THREE.Object3D) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
/** Does the model stay on its tiles, give or take a hair (outlines)? */
function onTiles(o: THREE.Object3D, x: number, y: number, w = 1, h = 1, slack = 0.03) {
  const b = bounds(o);
  expect(b.min.x, 'west').toBeGreaterThanOrEqual(x - slack);
  expect(b.max.x, 'east').toBeLessThanOrEqual(x + w + slack);
  expect(b.min.z, 'north').toBeGreaterThanOrEqual(y - slack);
  expect(b.max.z, 'south').toBeLessThanOrEqual(y + h + slack);
  // An outline reaches a little under the ground, as every prop's does.
  expect(b.min.y, 'under the ground').toBeGreaterThanOrEqual(-0.04);
}
const lights = { head: new THREE.MeshToonMaterial(), tail: new THREE.MeshToonMaterial() };
const colors = (o: THREE.Object3D) => {
  const out = new Set<string>();
  o.traverse(m => { if (m instanceof THREE.Mesh) out.add(`#${(m.material as THREE.MeshToonMaterial).color?.getHexString()}`); });
  return out;
};

describe('where vehicles stand', () => {
  it('takes the middle of their tiles, the nose where the map says: east when it says nothing, as the town\'s cars always stood', () => {
    expect(vehiclePlace({ x: 30, y: 28, w: 2 })).toEqual({ x: 31, z: 28.5, turn: Math.PI / 2 });
    expect(vehiclePlace({ x: 38, y: 21, w: 1, h: 2, dir: 'down' })).toEqual({ x: 38.5, z: 22, turn: 0 });
    expect(vehiclePlace({ x: 27, y: 72, w: 2, h: 1, dir: 'left' }).turn).toBeCloseTo(-Math.PI / 2);
    expect(vehiclePlace({ x: 42, y: 36, w: 1, h: 3, dir: 'up' })).toEqual({ x: 42.5, z: 37.5, turn: Math.PI });
  });

  it('keeps the one headlight on the car it always lit: the old car on the Near Woods\' road, the truck behind the South Road\'s barrier', () => {
    for (const [id, x, y] of [['near-woods', 32, 60], ['south-road', 35, 90], ['stonebrook', 13, 24]] as const) {
      const m = map(id), cars = m.objects.filter(o => o.kind === 'car');
      expect(cars[headlightCar(cars, m.spawn)], id).toMatchObject({ x, y });
    }
    expect(headlightCar([], { x: 0, y: 0 })).toBe(-1);
  });

  it('draws a car on its tiles either way it stands, in its own paint or the old teal, with a door open or the hatch up when it says so', () => {
    const east = { kind: 'car', x: 10, y: 5, w: 2 } as const, south = { kind: 'car', x: 4, y: 3, w: 1, h: 2, dir: 'down', paint: '#8a3b32' } as const;
    onTiles(carModel(east, lights), 10, 5, 2, 1, 0.08);
    onTiles(carModel(south, lights), 4, 3, 1, 2, 0.08);
    expect(colors(carModel(east, lights))).toContain(CAR_TEAL);
    expect(colors(carModel(south, lights))).toContain('#8a3b32');
    const count = (o: THREE.Object3D) => { let n = 0; o.traverse(m => { if (m instanceof THREE.Mesh) n++; }); return n; };
    expect(count(carModel({ ...south, door: true }, lights))).toBeGreaterThan(count(carModel(south, lights)));
    expect(count(carModel({ ...south, trunk: true }, lights))).toBeGreaterThan(count(carModel(south, lights)));
    // The driver's door (east of a car nosed south) swings out, but not far into the next tile.
    const open = bounds(carModel({ ...south, door: true }, lights));
    expect(open.max.x).toBeGreaterThan(5.1);
    expect(open.max.x).toBeLessThan(5.4);
  });

  it('draws the logging truck on its three tiles, its logs chained on', () => {
    onTiles(logTruck({ kind: 'truck', x: 28, y: 28, w: 3, h: 1, dir: 'right' }), 28, 28, 3, 1, 0.08);
    expect(leftModel({ kind: 'truck', x: 28, y: 28, w: 3, h: 1, dir: 'right', style: 'napo' })).toBeNull();
  });
});

describe('log decks', () => {
  it('stack their logs in rows that narrow as they go up, inside their tiles', () => {
    for (const deck of [{ x: 29, y: 26, w: 3, h: 1 }, { x: 42, y: 67, w: 3, h: 2 }, { x: 1, y: 4, w: 2, h: 1 }]) {
      const logs = deckLogs(deck);
      expect(logs.length, JSON.stringify(deck)).toBeGreaterThanOrEqual(3);
      const rows = [...new Set(logs.map(l => l.y.toFixed(3)))];
      const per = rows.map(r => logs.filter(l => l.y.toFixed(3) === r).length);
      for (let i = 1; i < per.length; i++) expect(per[i]).toBeLessThan(per[i - 1]!);
      for (const l of logs) {
        const [hx, hz] = l.along === 'x' ? [l.len / 2, l.r] : [l.r, l.len / 2];
        expect(l.x - hx).toBeGreaterThanOrEqual(deck.x - 0.02);
        expect(l.x + hx).toBeLessThanOrEqual(deck.x + deck.w + 0.02);
        expect(l.z - hz).toBeGreaterThanOrEqual(deck.y - 0.02);
        expect(l.z + hz).toBeLessThanOrEqual(deck.y + deck.h + 0.02);
      }
    }
  });

  it('lay a deck one tile deep east to west, and any other with its cut ends to the camera', () => {
    expect(new Set(deckLogs({ x: 29, y: 26, w: 3, h: 1 }).map(l => l.along))).toEqual(new Set(['x']));
    expect(new Set(deckLogs({ x: 42, y: 67, w: 3, h: 2 }).map(l => l.along))).toEqual(new Set(['z']));
    onTiles(logDeck({ kind: 'logs', x: 42, y: 67, w: 3, h: 2 }), 42, 67, 3, 2, 0.05);
  });
});

describe('curtains', () => {
  it('are one cloth per house, the same from the street and from the room, from the palette of the curtains people left', () => {
    const house = { x: 20, y: 26 };
    expect(curtainColor(house)).toBe(curtainColor({ ...house }));
    expect(CURTAINS).toContain(curtainColor(house));
    const town = map('stonebrook'), cloths = town.objects.flatMap(o => (o.kind === 'house' && o.curtains ? [curtainColor(o)] : []));
    expect(cloths).toHaveLength(4);
  });
});

describe('what the leavers left, and the logging days', () => {
  it('stands on its own tile, whatever it is', () => {
    for (const [x, y] of [[13, 36], [21, 36], [10, 36]] as const) onTiles(luggageModel({ x, y }), x, y);
    for (const [x, y] of [[14, 36], [9, 36], [1, 4]] as const) onTiles(boxesModel({ x, y }), x, y);
    onTiles(rockerModel({ x: 19, y: 36 }), 19, 36);
    onTiles(bikeModel({ x: 19, y: 37 }), 19, 37);
    onTiles(birdcageModel({ x: 20, y: 37 }), 20, 37);
    onTiles(pianoModel({ x: 16, y: 36 }), 16, 36, 2, 1);
    onTiles(stumpModel({ kind: 'stump', x: 44, y: 70, s: 1.25, v: 0.9 }), 44, 70);
    onTiles(stumpModel({ kind: 'stump', x: 27, y: 71, s: 1.15, v: 0.3, burned: true }), 27, 71);
    // A skid lies half sunk in the mud of its road.
    const skid = bounds(skidModel({ kind: 'skid', x: 40, y: 70, dir: 'h' }));
    expect([skid.min.x >= 40, skid.max.x <= 41, skid.min.z >= 70, skid.max.z <= 71, skid.min.y < 0, skid.max.y > 0.1]).toEqual([true, true, true, true, true, true]);
    onTiles(mailboxModel({ kind: 'sign', x: 6, y: 16, style: 'mailbox', text: ['OKADA'] }), 6, 16);
    onTiles(cardboardModel({ kind: 'sign', x: 16, y: 37, style: 'cardboard', text: ['PLEASE LEAVE THESE.'] }), 16, 37);
  });

  it('raises a mailbox\'s flag where a letter was left to go, and keeps it down elsewhere', () => {
    const flagTop = (text: string[]) => {
      let top = 0;
      mailboxModel({ kind: 'sign', x: 0, y: 0, style: 'mailbox', text }).traverse(m => {
        if (m instanceof THREE.Mesh && (m.material as THREE.MeshToonMaterial).color?.getHexString() === 'c8281c') top = bounds(m).max.y;
      });
      return top;
    };
    expect(flagTop(['DAHL', 'The little flag is still up.'])).toBeGreaterThan(flagTop(['OKADA', 'Empty.']));
  });

  it('knows a skid lies across the road it is on', () => {
    const size = (dir: 'h' | 'v') => bounds(skidModel({ kind: 'skid', x: 0, y: 0, dir })).getSize(new THREE.Vector3());
    expect(size('h').z).toBeGreaterThan(size('h').x);
    expect(size('v').x).toBeGreaterThan(size('v').z);
  });
});

describe('the sawmill', () => {
  const mill = map('stonebrook').objects.find((o): o is Extract<MapObject, { kind: 'house' }> => o.kind === 'house' && o.style === 'mill')!;
  const door = { w: 0.6, h: 0.84, back: 0.2 };
  const model = millBuilding(mill, doorOf(mill).x, door);

  it('stands on its tiles, long and low, the burner\'s stack the only thing above its roof', () => {
    const [w, h] = footprint(mill);
    onTiles(model, mill.x, mill.y, w, h, 0.05);
    expect(bounds(model).max.y).toBeGreaterThan(3);
  });

  it('leaves its doorway open on the door tile, like every door', () => {
    const d = doorOf(mill), inDoorway = new THREE.Vector3(d.x + 0.5, 0.4, mill.y + mill.h - 0.35);
    let blocked = false;
    model.traverse(m => {
      if (!(m instanceof THREE.Mesh) || (m.material as THREE.Material).side === THREE.BackSide) return;
      if ((m.material as THREE.MeshToonMaterial).color?.getHexString() === '5e5246' && bounds(m).containsPoint(inDoorway)) blocked = true;
    });
    expect(blocked).toBe(false);
  });
});
