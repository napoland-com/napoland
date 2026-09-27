import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeNpc } from '../src/view/characters';

/** Every color a model is made of. */
function colors(root: THREE.Object3D): Set<string> {
  const out = new Set<string>();
  root.traverse(o => { if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshToonMaterial) out.add(`#${o.material.color.getHexString()}`); });
  return out;
}

describe('townspeople', () => {
  it('look like Mira unless the map says otherwise', () => {
    expect(colors(makeNpc().root)).toContain('#4f7a70');
  });

  it('wear what the map gives them, and a hard hat only if they have one', () => {
    const vera = colors(makeNpc({ coat: '#d9d6cc', scarf: '#2f4a6b', hair: '#c9c2b0', skin: '#e0b793', hat: '#d9a82b' }).root);
    for (const c of ['#d9d6cc', '#2f4a6b', '#c9c2b0', '#e0b793', '#d9a82b']) expect(vera).toContain(c);
    expect(vera).not.toContain('#4f7a70');
    expect(colors(makeNpc({ coat: '#d9d6cc' }).root)).not.toContain('#d9a82b');
  });
});
