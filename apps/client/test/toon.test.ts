import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { OUTLINE, bake, box, part, toon } from '../src/view/toon';

/** Every triangle a geometry draws, in world space: for each corner its position, normal and color. */
function triangles(g: THREE.BufferGeometry, matrix: THREE.Matrix4, color?: THREE.Color): number[][] {
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), col = g.getAttribute('color');
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const corner = (k: number) => {
    const i = g.index ? g.index.getX(k) : k;
    const p = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(matrix);
    const n = new THREE.Vector3().fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
    const c = color ?? (col ? new THREE.Color().fromBufferAttribute(col as THREE.BufferAttribute, i) : null);
    return [...p.toArray(), ...n.toArray(), ...(c ? c.toArray() : [])];
  };
  const out: number[][] = [];
  for (let k = 0; k < (g.index ? g.index.count : pos.count); k += 3) out.push([...corner(k), ...corner(k + 1), ...corner(k + 2)]);
  return out;
}

/** What each material draws under the roots, before baking; the plain colors together, as bake joins them. */
function drawn(roots: THREE.Object3D[], plain: Set<THREE.Material>): Map<THREE.Material | 'plain', number[][]> {
  const out = new Map<THREE.Material | 'plain', number[][]>();
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      const mat = o.material as THREE.Material, key = plain.has(mat) ? 'plain' : mat;
      out.set(key, [...(out.get(key) ?? []), ...triangles(o.geometry, o.matrixWorld, plain.has(mat) ? (mat as THREE.MeshToonMaterial).color : undefined)]);
    });
  }
  return out;
}

/** The same triangles, in any order (float32 rounding aside). */
function expectSameTriangles(actual: number[][], expected: number[][]) {
  expect(actual).toHaveLength(expected.length);
  const left = [...actual];
  for (const t of expected) {
    const i = left.findIndex(a => a.length === t.length && a.every((v, k) => Math.abs(v - t[k]!) < 1e-5));
    expect(i, `missing triangle ${t.map(v => v.toFixed(3)).join(' ')}`).toBeGreaterThanOrEqual(0);
    left.splice(i, 1);
  }
}

describe('baking props that never move', () => {
  const glow = new THREE.MeshToonMaterial({ color: '#3a2f25', emissive: 0x8a5524 });
  const roof = toon('#7a4b33', { side: THREE.DoubleSide });
  /** A turned house: an outlined wall, a tilted plank, a glowing window, a roof with a material of its own, and a light. */
  const house = () => {
    const g = new THREE.Group();
    g.position.set(14.5, 0, 20);
    g.rotation.y = 0.6;
    g.add(box(2.8, 1.15, 1.7, '#5b4838', 0, 0.575, 0));
    const plank = box(0.56, 0.07, 0.03, '#6b5a44', 0.85, 0.76, 0.9, false);
    plank.rotation.z = 0.35;
    g.add(plank);
    g.add(part(new THREE.BoxGeometry(0.46, 0.38, 0.05), glow, -0.85, 0.72, 0.87, false));
    g.add(part(new THREE.ConeGeometry(1, 1, 4), roof, 0, 1.6, 0, false));
    g.add(new THREE.PointLight());
    return g;
  };

  it('draws the same triangles, in the same places, facing the same way and in the same colors', () => {
    const roots = [house(), box(0.42, 0.03, 0.42, '#4b2819', 9.5, 0.38, 27.5)];
    const before = drawn(roots, new Set([toon('#5b4838'), toon('#6b5a44'), toon('#4b2819')]));
    const meshes = bake(roots);

    // One mesh for the plain colors (as vertex colors), one for both outlines, and one each for
    // the glowing window and the roof, whose materials are more than a color.
    expect(meshes).toHaveLength(4);
    const by = new Map(meshes.map(m => [m.material as THREE.Material, m]));
    const colored = by.get(toon(0xffffff, { vertexColors: true }))!;
    expectSameTriangles(triangles(colored.geometry, colored.matrixWorld), before.get('plain')!);
    for (const mat of [OUTLINE, glow, roof]) {
      const m = by.get(mat)!;
      expect(m.geometry.getAttribute('color')).toBeUndefined();
      expectSameTriangles(triangles(m.geometry, m.matrixWorld), before.get(mat)!);
    }
  });

  it('takes the meshes out of their groups and leaves the rest there', () => {
    const g = house();
    bake([g]);
    expect(g.children.map(c => c.type)).toEqual(['PointLight']);
  });

  it('makes nothing from nothing', () => {
    expect(bake([])).toEqual([]);
    expect(bake([new THREE.Group()])).toEqual([]);
  });
});
