/**
 * The ground and the grass (view/grass.ts): colors that flow instead of a checkerboard, the same on
 * every visit; where tufts and tall grass grow; how much they cost to draw; crouching; and the sway
 * that lives in the shader, so nothing about it recompiles.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TileMap, hidden, type MapData } from '@napoland/shared';
import {
  CROUCH_DROP, GrassMaterial, Ground, PARTERS, TALL_BLADES, TALL_MIN, TUFT_BLADES, TUFT_MAX, clumpGeometry, crouchToward, grassClumps, mapSeed, noise, trianglesOf,
} from '../src/view/grass';

/**
 * A clearing 20 by 16 in the forest: grass, a road across row 12, a patch of tall grass at 4..6, 3..4,
 * a rock at 10,5, glowcaps at 12,5, a lamp at 15,9 and the way home at 10,15.
 */
function clearing(): MapData {
  const tiles = Array.from({ length: 16 }, (_, y) => {
    if (y === 0 || y === 15) return 't'.repeat(10) + (y === 15 ? 'g' : 't') + 't'.repeat(9);
    if (y === 12) return `t${'r'.repeat(18)}t`;
    return `t${Array.from({ length: 18 }, (_, k) => (k + 1 >= 4 && k + 1 <= 6 && (y === 3 || y === 4) ? 'h' : 'g')).join('')}t`;
  });
  return {
    id: 'clearing', name: 'Clearing', version: 1, kind: 'wilds', depth: 1, width: 20, height: 16,
    tiles, levels: Array<string>(16).fill('0'.repeat(20)),
    spawn: { x: 10, y: 14, dir: 'up' },
    exits: [{ x: 10, y: 15, w: 1, h: 1, to: 'town', tx: 1, ty: 1, dir: 'down', home: true }],
    objects: [{ kind: 'rock', x: 10, y: 5, s: 1, v: 0 }, { kind: 'shrooms', x: 12, y: 5 }, { kind: 'lamp', x: 15, y: 9 }],
  };
}

const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

describe('the ground', () => {
  const map = new TileMap(clearing()), ground = new Ground(map);
  const at = (kind: Parameters<Ground['color']>[0], cx: number, cy: number, tx: number, ty: number) => ground.color(kind, cx, cy, tx, ty, false, new THREE.Color());

  it('is the same on every visit, and different on every map', () => {
    expect(at('grass', 7, 7, 7, 7).equals(at('grass', 7, 7, 7, 7))).toBe(true);
    expect(mapSeed('clearing')).toBe(mapSeed('clearing'));
    expect(mapSeed('clearing')).not.toBe(mapSeed('near-woods'));
    const other = new Ground(new TileMap({ ...clearing(), id: 'other' }));
    const differ = [3, 5, 7, 9, 11].filter(x => !other.color('grass', x, 8, x, 8, false, new THREE.Color()).equals(at('grass', x, 8, x, 8)));
    expect(differ.length).toBeGreaterThan(0);
  });

  it('flows from tile to tile: two tiles side by side differ at their shared corner only by each one\'s slight jitter', () => {
    for (let y = 5; y < 11; y++) for (let x = 6; x < 16; x++) {
      const left = lum(at('grass', x + 1, y, x, y)), right = lum(at('grass', x + 1, y, x + 1, y));
      expect(Math.abs(left - right) / left, `${x},${y}`).toBeLessThan(0.05);
    }
  });

  it('has no checkerboard: tiles of one color and the other in between are alike on average', () => {
    const sums = [0, 0], counts = [0, 0];
    for (let y = 2; y < 11; y++) for (let x = 2; x < 18; x++) {
      const k = (x + y) & 1;
      sums[k]! += lum(at('grass', x, y, x, y));
      counts[k]!++;
    }
    expect(Math.abs(sums[0]! / counts[0]! - sums[1]! / counts[1]!) / (sums[0]! / counts[0]!)).toBeLessThan(0.02);
  });

  it('is darker where the trees shade it, and the tall grass keeps its own color', () => {
    // 1,1 is the clearing's corner, forest on two sides; 10,8 its middle.
    expect(lum(at('grass', 1, 1, 1, 1))).toBeLessThan(lum(at('grass', 10, 8, 10, 8)) * 0.85);
    expect(at('tallgrass', 5, 4, 5, 3).equals(at('grass', 5, 4, 5, 3))).toBe(false);
  });

  it('varies on the road too, and it stays asphalt', () => {
    const road = Array.from({ length: 18 }, (_, k) => at('road', k + 1, 12, k + 1, 12));
    expect(new Set(road.map(c => c.getHexString())).size).toBeGreaterThan(5);
    for (const c of road) expect(Math.abs(c.r - c.b) + Math.abs(c.g - c.b)).toBeLessThan(0.05);
  });

  it('comes from noise that is smooth and between 0 and 1', () => {
    for (let i = 0; i < 200; i++) {
      const v = noise(i * 0.37, i * 0.19, 6, 1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(Math.abs(noise(i * 0.37 + 0.01, i * 0.19, 6, 1) - v)).toBeLessThan(0.02);
    }
  });
});

describe('where grass grows', () => {
  const map = new TileMap(clearing()), clumps = grassClumps(map, new Ground(map));
  const tileOf = (c: { x: number; y: number }) => [Math.floor(c.x), Math.floor(c.y)] as const;

  it('grows one to three tufts on a grass tile, and never where something stands, on an exit or among the glowcaps', () => {
    const perTile = new Map<string, number>();
    for (const c of clumps.filter(c => !c.tall)) {
      const [x, y] = tileOf(c);
      expect(map.kind(x, y), `${x},${y}`).toBe('grass');
      perTile.set(`${x},${y}`, (perTile.get(`${x},${y}`) ?? 0) + 1);
    }
    for (const n of perTile.values()) expect(n >= 1 && n <= 3).toBe(true);
    expect(perTile.has('10,5')).toBe(false);
    expect(perTile.has('12,5')).toBe(false);
    expect(perTile.has('15,9')).toBe(false);
    expect(perTile.has('10,15')).toBe(false);
    expect(perTile.has('8,8')).toBe(true);
  });

  it('grows tall grass only on tall grass, densely, every clump taller than any tuft', () => {
    const tall = clumps.filter(c => c.tall);
    for (const c of tall) expect(hidden(map, ...tileOf(c))).toBe(true);
    // 6 tiles of it, about fourteen clumps each.
    expect(tall.length).toBeGreaterThanOrEqual(6 * 12);
    expect(Math.min(...tall.map(c => c.height))).toBeGreaterThanOrEqual(TALL_MIN);
    expect(Math.max(...clumps.filter(c => !c.tall).map(c => c.height))).toBeLessThanOrEqual(TUFT_MAX);
    expect(TALL_MIN).toBeGreaterThan(TUFT_MAX);
  });

  it('is the same every time', () => {
    const again = grassClumps(map, new Ground(map));
    expect(again.map(c => [c.x, c.y, c.rot, c.height, c.color.getHex()])).toEqual(clumps.map(c => [c.x, c.y, c.rot, c.height, c.color.getHex()]));
  });
});

describe('what grass costs to draw', () => {
  const maps = readdirSync(resolve(import.meta.dirname, '../../../content/maps')).filter(f => f.endsWith('.json'))
    .map(f => new TileMap(JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/maps', f), 'utf8')) as MapData));

  it('stays well under 60k triangles in the blocks the camera can see at once (4 by 4 blocks of 8 tiles), on every map', () => {
    for (const map of maps) {
      if (map.data.kind === 'inside') continue;
      const clumps = grassClumps(map, new Ground(map));
      const bw = Math.ceil(map.width / 8), bh = Math.ceil(map.height / 8), tris = new Float64Array(bw * bh);
      for (const c of clumps) tris[Math.floor(c.y / 8) * bw + Math.floor(c.x / 8)] += trianglesOf(c.tall ? TALL_BLADES : TUFT_BLADES);
      let most = 0;
      for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
        let sum = 0;
        for (let y = by; y < Math.min(bh, by + 4); y++) for (let x = bx; x < Math.min(bw, bx + 4); x++) sum += tris[y * bw + x]!;
        most = Math.max(most, sum);
      }
      expect(most, map.data.id).toBeLessThan(40_000);
    }
  });

  it('builds each clump from a few three-sided blades, lit like the ground they grow from', () => {
    for (const blades of [TUFT_BLADES, TALL_BLADES]) {
      const g = clumpGeometry(blades), normal = g.getAttribute('normal');
      expect(g.getAttribute('position').count / 3).toBe(trianglesOf(blades));
      for (let i = 0; i < normal.count; i++) expect(normal.getY(i)).toBeGreaterThan(0.5);
      g.dispose();
    }
  });
});

describe('the grass\'s material', () => {
  it('sways and parts in the vertex shader, one program for every map: nothing recompiles as you move', () => {
    const a = new GrassMaterial(), b = new GrassMaterial();
    expect(a.material.customProgramCacheKey()).toBe(b.material.customProgramCacheKey());
    const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: '#include <common>\nvoid main() {\n#include <project_vertex>\n}', fragmentShader: '' };
    a.material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, undefined as unknown as THREE.WebGLRenderer);
    expect(shader.vertexShader).not.toContain('#include <project_vertex>');
    expect(shader.vertexShader).toContain('grassPart');
    expect(Object.keys(shader.uniforms).sort()).toEqual(['grassPart', 'grassTime', 'grassWind']);
    // What changes every frame changes the uniforms' values, never the shader.
    a.update(12.5);
    a.setWind(2);
    a.part(PARTERS - 1, 3, 4, 1);
    expect(shader.uniforms.grassTime!.value).toBe(12.5);
    expect(shader.uniforms.grassWind!.value).toBe(2);
    expect((shader.uniforms.grassPart!.value as THREE.Vector4[])[PARTERS - 1]!.toArray()).toEqual([3, 4, 1, 0]);
    a.material.dispose();
    b.material.dispose();
  });
});

describe('crouching in tall grass', () => {
  it('eases all the way down in it and back up out of it, in under half a second, never past either end', () => {
    let c = 0;
    for (let t = 0; t < 0.5; t += 1 / 60) c = crouchToward(c, true, 1 / 60);
    expect(c).toBeGreaterThan(0.95);
    expect(c).toBeLessThanOrEqual(1);
    expect(crouchToward(1, true, 10)).toBe(1);
    for (let t = 0; t < 0.5; t += 1 / 60) c = crouchToward(c, false, 1 / 60);
    expect(c).toBeLessThan(0.05);
    expect(crouchToward(0, false, 10)).toBe(0);
    expect(crouchToward(0.4, true, 0)).toBe(0.4);
    // Low enough that the grass, knee-high, hides all but the head and shoulders of a chibi about 1 tall.
    expect(CROUCH_DROP).toBeGreaterThan(0.1);
  });
});
