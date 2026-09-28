import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { doorOf, type MapObject } from '@napoland/shared';
import { HUM, NAPO_WALL_H, NAPO_YELLOW, TOWER_H, cageModel, jeepModel, napoBuilding, napoProp, napoSign, napoTruck, pumpModel, stakeModel, towerModel } from '../src/view/napo';

type House = Extract<MapObject, { kind: 'house' }>;
/** A cabin's doorway (world.ts): NAPO's buildings share it. */
const DOOR = { w: 0.6, h: 0.84, back: 0.2 };
const warm = new THREE.MeshToonMaterial(), doorGlow = new THREE.MeshToonMaterial();
const mats = { warm, doorGlow };

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.updateMatrixWorld(true);
  root.traverse(o => { if (o instanceof THREE.Mesh) out.push(o); });
  return out;
}
const uses = (root: THREE.Object3D, m: THREE.Material) => meshes(root).some(x => x.material === m);
const colored = (root: THREE.Object3D, hex: string) => meshes(root).filter(m => (m.material as THREE.MeshToonMaterial).color?.getHexString() === hex.slice(1));
const covers = (list: THREE.Mesh[], p: THREE.Vector3) => list.some(m => new THREE.Box3().setFromObject(m).containsPoint(p));

describe('NAPO\'s buildings', () => {
  const station: House = { kind: 'house', x: 20, y: 40, w: 5, h: 3, roof: '#4a4f52', lit: 1, style: 'napo' };
  const build = (h: House, fire = false) => napoBuilding(h, doorOf(h).x, fire, DOOR, mats);

  it('stand on their tiles: only the open door swings out in front', () => {
    const b = new THREE.Box3().setFromObject(build(station).root);
    expect(b.min.x).toBeGreaterThanOrEqual(station.x);
    expect(b.max.x).toBeLessThanOrEqual(station.x + station.w);
    expect(b.min.z).toBeGreaterThanOrEqual(station.y);
    expect(b.max.z).toBeLessThanOrEqual(station.y + station.h + 0.5);
    expect(b.max.y).toBeLessThan(NAPO_WALL_H + 0.7);
  });

  it('leave the doorway open on the door tile, off the middle too, and are solid beside it', () => {
    for (const h of [station, { ...station, w: 4 }, { ...station, w: 3, h: 2 }]) {
      const concrete = colored(build(h).root, '#7c8081'), d = doorOf(h);
      const inDoorway = new THREE.Vector3(d.x + 0.5, 0.4, h.y + h.h - 0.4);
      expect(covers(concrete, inDoorway), `${h.w} by ${h.h}`).toBe(false);
      expect(covers(concrete, inDoorway.clone().setX(d.x + 1.3)), `${h.w} by ${h.h}`).toBe(true);
    }
  });

  it('glow through the doorway when the room behind keeps a fire, and smoke from the flue', () => {
    expect(uses(build(station, true).root, doorGlow)).toBe(true);
    expect(uses(build(station, false).root, doorGlow)).toBe(false);
    const { flue } = build(station, true);
    expect(flue.y).toBeGreaterThan(NAPO_WALL_H + 0.3);
    expect(flue.x).toBeGreaterThan(station.x);
    expect(flue.x).toBeLessThan(station.x + station.w);
    expect(flue.z).toBeGreaterThan(station.y);
    expect(flue.z).toBeLessThan(station.y + station.h);
  });

  it('show a light when someone is in, and only dark windows when nobody is', () => {
    expect(uses(build(station).root, warm)).toBe(true);
    expect(uses(build({ ...station, lit: 0 }).root, warm)).toBe(false);
  });
});

describe('NAPO\'s signs', () => {
  it('are yellow plates on a post, on their tile', () => {
    const sign = napoSign({ kind: 'sign', x: 34, y: 9, text: ['NAPO'], style: 'napo' });
    const b = new THREE.Box3().setFromObject(sign);
    expect(b.min.x).toBeGreaterThanOrEqual(34);
    expect(b.max.x).toBeLessThanOrEqual(35);
    expect(b.max.y).toBeLessThan(0.9);
    expect(colored(sign, NAPO_YELLOW).length).toBeGreaterThan(0);
  });
});

describe('the Tower', () => {
  const beacon = new THREE.MeshToonMaterial();
  const tower = towerModel(51, 46, beacon);

  it('stands on its tile, as tall as TOWER_H, the light on top', () => {
    const b = new THREE.Box3().setFromObject(tower);
    expect(b.min.x).toBeGreaterThanOrEqual(50.99);
    expect(b.max.x).toBeLessThanOrEqual(52.01);
    expect(b.min.z).toBeGreaterThanOrEqual(45.99);
    expect(b.max.z).toBeLessThanOrEqual(47.01);
    expect(b.max.y).toBeGreaterThan(TOWER_H);
    expect(b.max.y).toBeLessThan(TOWER_H + 0.2);
    const light = meshes(tower).find(m => m.material === beacon)!;
    expect(new THREE.Box3().setFromObject(light).getCenter(new THREE.Vector3()).y).toBeCloseTo(TOWER_H, 1);
  });

  it('turns its dish north, toward the woods, and a little up', () => {
    const [dish] = colored(tower, '#d9d6cc');
    const facing = new THREE.Vector3(0, 1, 0).applyQuaternion(dish!.getWorldQuaternion(new THREE.Quaternion()));
    expect(facing.z).toBeLessThan(-0.8);
    expect(facing.y).toBeGreaterThan(0.2);
  });
});

describe('what NAPO left out in the places', () => {
  /** Stays on its tiles, give or take its outlines. */
  const onTiles = (o: THREE.Object3D, x: number, y: number, w = 1, h = 1) => {
    const b = new THREE.Box3().setFromObject(o);
    expect([b.min.x >= x - 0.05, b.max.x <= x + w + 0.05, b.min.z >= y - 0.05, b.max.z <= y + h + 0.05], `${x},${y}`).toEqual([true, true, true, true]);
  };

  it('parks its box trucks, three tiles long, in NAPO\'s yellow and white', () => {
    const truck = napoTruck({ kind: 'truck', x: 42, y: 36, w: 1, h: 3, dir: 'down', style: 'napo' });
    onTiles(truck, 42, 36, 1, 3);
    expect(colored(truck, NAPO_YELLOW).length).toBeGreaterThan(0);
    expect(napoProp({ kind: 'truck', x: 42, y: 36, w: 1, h: 3, dir: 'down' })).toBeNull();
  });

  it('leaves its burned jeep on its two tiles, a patch of yellow left on the door that hangs open, a little way out', () => {
    const jeep = jeepModel({ kind: 'jeep', x: 27, y: 72, w: 2, h: 1, dir: 'left', text: ['NAPO'] });
    const b = new THREE.Box3().setFromObject(jeep);
    expect([b.min.x >= 26.95, b.max.x <= 29.05, b.min.z >= 71.95]).toEqual([true, true, true]);
    // The driver's door is on the south side, facing the camera, and swings out no farther than a third of a tile.
    expect(b.max.z).toBeGreaterThan(73);
    expect(b.max.z).toBeLessThan(73.35);
    expect(colored(jeep, NAPO_YELLOW).length).toBeGreaterThan(0);
  });

  it('stands its pump, its cages and its stakes each on their tile; the rock in a cage hums in the one shared glow', () => {
    onTiles(pumpModel({ x: 42, y: 40 }), 42, 40);
    const cage = cageModel({ x: 49, y: 66 }, HUM);
    onTiles(cage, 49, 66);
    expect(uses(cage, HUM)).toBe(true);
    expect(uses(napoProp({ kind: 'cage', x: 50, y: 66, text: ['NAPO · Sample 7'] })!, HUM)).toBe(true);
    expect(colored(cage, NAPO_YELLOW).length).toBeGreaterThan(0);
    for (const [x, y] of [[33, 21], [42, 21], [0, 0]] as const) {
      const stake = stakeModel({ x, y });
      onTiles(stake, x, y);
      expect(colored(stake, NAPO_YELLOW).length).toBeGreaterThan(0);
      expect(colored(stake, '#ff7a1a').length, 'its orange flagging').toBeGreaterThan(0);
    }
  });
});
