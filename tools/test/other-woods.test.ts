/**
 * The Other Woods as they ship (roadmap/the-other-woods.md, docs/DESIGN.md): past the ranger's camp, the Near Woods
 * said back, east for west, under a sky that never moves. What the mirror keeps and what it does not, the one
 * cabin with its fire, the way home to the camp, the tags and signs read backwards, and the ranger's notes there.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TileMap, notesOf, poleTag, validateMap, withTag, type MapData, type MapObject } from '@napoland/shared';
import { CAMP_BACK, NEAR_WOODS_MOUTH, OTHER_WOODS_BACK, OTHER_WOODS_MOUTH } from '../turning-mouth';

const content = resolve(import.meta.dirname, '../../content');
const maps = new Map(readdirSync(resolve(content, 'maps')).filter(f => f.endsWith('.json')).map(f => {
  const data = JSON.parse(readFileSync(resolve(content, 'maps', f), 'utf8')) as MapData;
  return [data.id, new TileMap(data)] as const;
}));
const near = maps.get('near-woods')!, other = maps.get('other-woods')!, room = maps.get('other-woods-old-cabin')!;
const W = near.width, H = near.height;
const objects = <K extends MapObject['kind']>(m: TileMap, kind: K) => m.data.objects.filter((o): o is Extract<MapObject, { kind: K }> => o.kind === kind);
const backwards = (s: string) => [...s].reverse().join('');

describe('the Other Woods, the Near Woods said back', () => {
  it('are a region at depth 3, as big as the Near Woods, under a sky that never moves and never rains', () => {
    expect(other.data).toMatchObject({ name: 'The Other Woods', kind: 'wilds', depth: 3, width: W, height: H, sky: 'answer', rain: [] });
    expect(other.data.surge).toBeUndefined();
    expect(other.data.storm).toBeUndefined();
  });

  it('are the Near Woods tile for tile, east for west, but for where a way out was: only the mouth by the ring leads anywhere', () => {
    const differ: string[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (other.data.tiles[y]![x] !== near.data.tiles[y]![W - 1 - x]) differ.push(`${x},${y}`);
    // The road home and the trappers' trail give out in the firs on the edge.
    for (const k of differ) { const [x, y] = k.split(',').map(Number) as [number, number]; expect(x === 0 || y === 0 || x === W - 1 || y === H - 1, k).toBe(true); }
    expect(differ.length).toBeLessThanOrEqual(4);
    expect(OTHER_WOODS_MOUTH).toEqual({ x: W - 1 - NEAR_WOODS_MOUTH.x, y: NEAR_WOODS_MOUTH.y });
    const out = other.data.exits.filter(e => e.home);
    expect(out).toEqual([expect.objectContaining({ ...OTHER_WOODS_MOUTH, to: 'turning-camp', tx: CAMP_BACK.x, ty: CAMP_BACK.y })]);
    expect(other.data.spawn).toMatchObject(OTHER_WOODS_BACK);
    // Every tile anyone walks on reaches the way home.
    expect(other.homeSteps(OTHER_WOODS_BACK.x, OTHER_WOODS_BACK.y)).toBe(1);
  });

  it('keep one cabin whole, the old cabin, whose fire burns there too; the rest stand as burned shells', () => {
    const houses = objects(other, 'house');
    expect(houses).toHaveLength(1);
    expect(objects(other, 'ruin').length).toBeGreaterThanOrEqual(objects(near, 'house').length - 1);
    const door = other.data.exits.find(e => e.to === room.data.id)!;
    expect(room.data.exits[0]).toMatchObject({ to: 'other-woods', tx: door.x, ty: door.y + 1 });
    expect(objects(room, 'fireplace')).toEqual([expect.objectContaining({ tended: true })]);
    expect(objects(room, 'note')).toEqual([]);
  });

  it('leave out what came after that night: nobody\'s notes but the ranger\'s from here, no slab, no footbridge, no lookout to climb', () => {
    for (const kind of ['slab', 'footbridge', 'lookout'] as const) expect(objects(other, kind), kind).toEqual([]);
    expect(objects(other, 'lamp').every(l => !l.works && !l.dark)).toBe(true);
    const notes = notesOf([other.data]);
    expect([...notes.keys()].sort()).toEqual(['ranger-other-line', 'ranger-other-me', 'ranger-other-truck']);
    for (const { note } of notes.values()) expect(note.by).toBe('ranger');
  });

  it('read backwards: every sign but where the road gives out is the Near Woods\' own, letter for letter', () => {
    const theirs = objects(near, 'sign').map(s => s.text.map(backwards).join('|')).sort();
    const ours = objects(other, 'sign').map(s => s.text.join('|'));
    const roadEnd = ['Stonebrook', 'Pop. 23'].map(backwards).join('|');
    expect(ours).toContain(roadEnd);
    expect(ours.filter(t => t !== roadEnd).sort()).toEqual(theirs);
    // The poles carry their tags backwards, and lean no way anyone reads.
    const poles = objects(other, 'pole');
    expect(poles.length).toBe(objects(near, 'pole').length);
    expect(poleTag(other.data, poles.at(-1)!.x, poles.at(-1)!.y)).toBe('61-N');
    expect(withTag([], poleTag(other.data, poles[0]!.x, poles[0]!.y))).toEqual(['A tin tag, stamped 7-N.']);
    expect(poleTag(near.data, objects(near, 'pole')[0]!.x, objects(near, 'pole')[0]!.y)).toBe('N-7');
  });
});

describe('a sky that never moves (MapData.sky)', () => {
  it('is only ever the answer\'s, out in the wilds, where it never rains', () => {
    const errors = (data: MapData) => validateMap(data).filter(p => p.level === 'error').map(p => p.message);
    expect(errors(other.data)).toEqual([]);
    expect(errors({ ...other.data, rain: [{ from: 0, length: 60 }] })).toContainEqual(expect.stringMatching(/never rains/));
    expect(errors({ ...room.data, sky: 'answer' })).toContainEqual(expect.stringMatching(/only the wilds/));
  });
});
