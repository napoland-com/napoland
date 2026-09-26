/**
 * The look: flat two-tone "toon" shading with dark outlines, so models read like chunky sprites.
 */
import * as THREE from 'three';

const grad = new THREE.DataTexture(new Uint8Array([84, 160, 255]), 3, 1, THREE.RedFormat);
grad.minFilter = THREE.NearestFilter;
grad.magFilter = THREE.NearestFilter;
grad.generateMipmaps = false;
grad.needsUpdate = true;

type ToonOpts = THREE.MeshToonMaterialParameters;
const cache = new Map<string, THREE.MeshToonMaterial>();
/** Materials that outlive any one map (every map uses them): disposing a map's view leaves these alone. */
const shared = new WeakSet<THREE.Material>();
const keep = <T extends THREE.Material>(m: T): T => (shared.add(m), m);
/** Shared materials that are only a color: bake() turns them into vertex colors of one material. */
const plain = new WeakSet<THREE.Material>();

/** A shared toon material (use for things that never change color). */
export function toon(color: THREE.ColorRepresentation, opts?: ToonOpts): THREE.MeshToonMaterial {
  const key = String(color) + (opts ? JSON.stringify(opts) : '');
  let m = cache.get(key);
  if (!m) {
    cache.set(key, (m = keep(new THREE.MeshToonMaterial({ color, gradientMap: grad, ...opts }))));
    if (!opts) plain.add(m);
  }
  return m;
}

/** A toon material of its own (for things whose color or glow changes at runtime). Freed with the view that made it. */
export const ownToon = (color: THREE.ColorRepresentation, opts?: ToonOpts) => new THREE.MeshToonMaterial({ color, gradientMap: grad, ...opts });

export const OUTLINE = keep(new THREE.MeshBasicMaterial({ color: 0x0d1014, side: THREE.BackSide }));
export const OUTLINE_INSTANCED = keep(new THREE.MeshBasicMaterial({ color: 0x0d1014, side: THREE.BackSide }));

/**
 * Frees the GPU memory held by everything under `root`: geometries, instance buffers, and the
 * materials and textures made for it. The shared materials stay, because the next map uses them too.
 */
export function disposeTree(root: THREE.Object3D) {
  root.traverse(o => {
    if (o instanceof THREE.InstancedMesh) o.dispose();
    // All sprites share one quad that three.js keeps for itself.
    if (!(o instanceof THREE.Sprite) && 'geometry' in o && o.geometry instanceof THREE.BufferGeometry) o.geometry.dispose();
    if (!('material' in o) || !o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!(m instanceof THREE.Material) || shared.has(m)) continue;
      const map = (m as THREE.MeshBasicMaterial).map;
      if (map && map !== grad) map.dispose();
      m.dispose();
    }
  });
}

/** Faceted normals: every triangle gets its own, which gives the low-poly look. */
export function flat<T extends THREE.BufferGeometry>(g: T): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  n.computeVertexNormals();
  return n;
}

/** A dark shell around a mesh, `t` world units thick (the back faces of a slightly bigger copy). */
export function outline(mesh: THREE.Mesh, t = 0.026): THREE.Mesh {
  const g = mesh.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const size = new THREE.Vector3(), c = new THREE.Vector3();
  g.boundingBox!.getSize(size);
  g.boundingBox!.getCenter(c);
  const o = new THREE.Mesh(g, OUTLINE);
  const sx = 1 + (2 * t) / Math.max(size.x, 0.02), sy = 1 + (2 * t) / Math.max(size.y, 0.02), sz = 1 + (2 * t) / Math.max(size.z, 0.02);
  o.scale.set(sx, sy, sz);
  o.position.set(c.x * (1 - sx), c.y * (1 - sy), c.z * (1 - sz));
  mesh.add(o);
  return mesh;
}

/** A positioned mesh; `ol` false = no outline, a number = outline thickness. */
export function part(geo: THREE.BufferGeometry, mat: THREE.Material | string, x = 0, y = 0, z = 0, ol: boolean | number = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, typeof mat === 'string' ? toon(mat) : mat);
  m.position.set(x, y, z);
  if (ol !== false) outline(m, typeof ol === 'number' ? ol : 0.026);
  return m;
}

export const box = (w: number, h: number, d: number, mat: THREE.Material | string, x = 0, y = 0, z = 0, ol: boolean | number = true) =>
  part(new THREE.BoxGeometry(w, h, d), mat, x, y, z, ol);

/** Joins non-indexed geometries into one, with one vertex color per part (or no colors). */
export function merge(parts: Array<[THREE.BufferGeometry, THREE.Color | null]>): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  for (const [g, c] of parts) {
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      if (c) col.push(c.r, c.g, c.b);
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (col.length) out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

/**
 * Joins the meshes under `roots` (things that never move, built with part() and box()) into one
 * mesh per material, returned for the caller to add to the scene. Every plain toon() color goes
 * into one mesh as vertex colors and every outline into another, so a town of boxes costs a few
 * draw calls instead of hundreds. Other materials (a lit window, a lamp head: their glow changes
 * with the weather) keep a mesh of their own. The meshes leave their parents; anything else (a
 * light and its target) stays where it is.
 */
export function bake(roots: THREE.Object3D[]): THREE.Mesh[] {
  const colored = toon(0xffffff, { vertexColors: true });
  const byMaterial = new Map<THREE.Material, Array<[THREE.BufferGeometry, THREE.Color | null]>>();
  for (const root of roots) {
    root.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    root.traverse(o => { if (o instanceof THREE.Mesh) meshes.push(o); });
    for (const m of meshes) {
      const mat = m.material as THREE.Material;
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrixWorld);
      const key = plain.has(mat) ? colored : mat;
      let list = byMaterial.get(key);
      if (!list) byMaterial.set(key, (list = []));
      list.push([g, plain.has(mat) ? (mat as THREE.MeshToonMaterial).color : null]);
      m.removeFromParent();
    }
  }
  return [...byMaterial].map(([mat, parts]) => new THREE.Mesh(merge(parts), mat));
}

export function pivot(x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  return g;
}

/** A soft round glow, used for wisps, mist and pickups. */
export function softTexture(inner: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 1, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(inner, 'rgba(255,255,255,.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
