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

/** A shared toon material (use for things that never change color). */
export function toon(color: THREE.ColorRepresentation, opts?: ToonOpts): THREE.MeshToonMaterial {
  const key = String(color) + (opts ? JSON.stringify(opts) : '');
  let m = cache.get(key);
  if (!m) cache.set(key, (m = new THREE.MeshToonMaterial({ color, gradientMap: grad, ...opts })));
  return m;
}

/** A toon material of its own (for things whose color or glow changes at runtime). */
export const ownToon = (color: THREE.ColorRepresentation, opts?: ToonOpts) => new THREE.MeshToonMaterial({ color, gradientMap: grad, ...opts });

export const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x0d1014, side: THREE.BackSide });
export const OUTLINE_INSTANCED = new THREE.MeshBasicMaterial({ color: 0x0d1014, side: THREE.BackSide });

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
