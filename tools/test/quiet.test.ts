/**
 * The Quiet as it ships (roadmap/the-quiet.md, docs/DESIGN.md): the region at depth 5 above the Ridge's crest, up a
 * rope for four. Where its rope hangs and where its way home comes down, the ring of standing stones and its gap,
 * the figures that face the gap and leave the way in open, and what a trip up there costs.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIRS, TileMap, energyRate, maxEnergy, stepTarget, validateMap, type MapData, type MapObject } from '@napoland/shared';

const content = resolve(import.meta.dirname, '../../content');
const maps = new Map(readdirSync(resolve(content, 'maps')).filter(f => f.endsWith('.json')).map(f => {
  const data = JSON.parse(readFileSync(resolve(content, 'maps', f), 'utf8')) as MapData;
  return [data.id, new TileMap(data)] as const;
}));
const ridge = maps.get('ridge')!, quiet = maps.get('quiet')!;
const objects = <K extends MapObject['kind']>(m: TileMap, kind: K) => m.data.objects.filter((o): o is Extract<MapObject, { kind: K }> => o.kind === kind);
const rope = objects(ridge, 'gate').find(g => g.to === 'quiet')!;
const stones = objects(quiet, 'standing'), gap = stones.find(s => s.gap)!;
/** Steps home from the nearest tile beside x,y. */
const beside = (x: number, y: number) => Math.min(...DIRS.map(d => stepTarget(x, y, d)).map(n => quiet.homeSteps(n.x, n.y)).filter(s => s >= 0));

describe('the Quiet, where it is', () => {
  it('is the region at depth 5, always winter, still: it never snows, and words do not carry', () => {
    expect(quiet.data).toMatchObject({ name: 'The Quiet', kind: 'wilds', depth: 5, forest: 'snow', rain: [], hush: true });
    expect([...maps.values()].filter(m => m.data.depth >= 5).map(m => m.data.id)).toEqual(['quiet']);
  });

  it('is reached only up a rope for four above the trappers\' cairn on the Ridge\'s crest, and its way home comes back under it', () => {
    expect(rope).toMatchObject({ look: 'rope', pullers: 4, w: 4 });
    const cairn = objects(ridge, 'sign').find(s => /needles spin/.test(s.text.join(' ')))!;
    expect(Math.abs(rope.x + 1 - cairn.x) + Math.abs(rope.y - cairn.y)).toBeLessThanOrEqual(5);
    expect([...maps.values()].filter(m => m.data.exits.some(e => e.to === 'quiet')).map(m => m.data.id)).toEqual([]);
    for (let k = 0; k < rope.w; k++) expect(quiet.walkable(rope.tx + k, rope.ty), `${k}`).toBe(true);
    const home = quiet.data.exits.find(e => e.home)!;
    expect(home).toMatchObject({ to: 'ridge', tx: rope.x, ty: rope.y + 1, w: rope.w, y: rope.ty + 1 });
    expect(quiet.data.exits).toHaveLength(1);
  });
});

describe('the ring and the figures', () => {
  it('is twelve stones the Old Stone\'s kin, each with something to read, and one of them the gap, the socket the Old Stone\'s shape', () => {
    expect(stones).toHaveLength(12);
    expect(stones.filter(s => s.gap)).toEqual([gap]);
    expect(gap.text.join(' ')).toMatch(/Old Stone's shape/);
    // The gap is the farthest of the ring from the way in: the far side.
    expect(stones.every(s => s.y >= gap.y)).toBe(true);
    // One picture is fresh; the rest are worn.
    expect(stones.filter(s => /fresh/.test(s.text.join(' ')))).toHaveLength(1);
    for (const s of stones) expect(beside(s.x, s.y), `${s.x},${s.y}`).toBeGreaterThan(0);
  });

  it('is watched by still figures all round, which leave the way in from the rope open', () => {
    const figures = objects(quiet, 'figure');
    expect(figures.length).toBeGreaterThanOrEqual(12);
    const home = quiet.data.exits[0]!;
    // None between the rope and the ring.
    const ring = quiet.data.places!.find(p => p.name === 'the ring')!;
    expect(figures.filter(f => f.y > ring.y && Math.abs(f.x - (home.x + 1.5)) < 3)).toEqual([]);
    expect(beside(gap.x, gap.y)).toBeLessThan(40);
  });

  it('only stand where a figure or a stone is said to stand: out in the wilds, the stones with something to read', () => {
    const errors = (o: MapObject) => validateMap({ ...quiet.data, objects: [o] }).filter(p => p.level === 'error').map(p => p.message);
    expect(errors({ kind: 'standing', x: gap.x, y: gap.y, text: [] })).toContainEqual(expect.stringMatching(/nothing to read/));
    expect(validateMap({ ...maps.get('ridge-high-hut')!.data, hush: true }).map(p => p.message)).toContainEqual(expect.stringMatching(/hush/));
  });
});

describe('a trip up there', () => {
  it('costs a strong bar a good part of itself: at level 20, standing by the gap by day, it lasts well past the walk there and back', () => {
    const at = beside(gap.x, gap.y);
    const lasts = maxEnergy(20) / -energyRate(quiet, gap.x, gap.y + 1, 'overcast');
    expect(lasts).toBeGreaterThan(at * 2 * 0.2 * 3);
    // And a level 1 bar would not last long at all.
    expect(maxEnergy(1) / -energyRate(quiet, gap.x, gap.y + 1, 'overcast')).toBeLessThan(lasts);
  });
});
