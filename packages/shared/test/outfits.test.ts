import { describe, expect, it } from 'vitest';
import { LEVEL_MAX, OUTFITS, mayWear, outfitOf, outfitsFor, outfitsOpening, parseClientMsg } from '../src';

const ids = (list: ReadonlyArray<{ id: string }>) => list.map(o => o.id);

describe('the outfits', () => {
  it('are five, each with a name, one line and the level that opens it, in the order they open', () => {
    expect(OUTFITS.map(o => [o.id, o.name, o.level])).toEqual([
      ['napo-suit', 'NAPO work suit', 1],
      ['lineman-jacket', 'Lineman\'s jacket', 5],
      ['rain-cape', 'Survey rain cape', 10],
      ['ranger-coat', 'Ranger\'s coat', 15],
      ['patchwork', 'Residents\' patchwork', 20],
    ]);
    for (const o of OUTFITS) {
      expect(o.text, o.id).toMatch(/^[A-Z].*\.$/);
      expect(o.text, o.id).not.toContain('\n');
      expect(o.level).toBeLessThanOrEqual(LEVEL_MAX);
    }
    expect(new Set(ids(OUTFITS)).size).toBe(OUTFITS.length);
  });

  it('are found by id, and one this release does not have is nothing', () => {
    expect(outfitOf('rain-cape')?.name).toBe('Survey rain cape');
    expect(outfitOf('top-hat')).toBeUndefined();
    expect(outfitOf(null)).toBeUndefined();
    expect(outfitOf(undefined)).toBeUndefined();
  });
});

describe('who may wear what', () => {
  it('gives everyone signed in the NAPO work suit from the first sign-in, and each other outfit at its level', () => {
    expect(ids(outfitsFor(1, true))).toEqual(['napo-suit']);
    expect(ids(outfitsFor(4, true))).toEqual(['napo-suit']);
    expect(ids(outfitsFor(5, true))).toEqual(['napo-suit', 'lineman-jacket']);
    expect(ids(outfitsFor(12, true))).toEqual(['napo-suit', 'lineman-jacket', 'rain-cape']);
    expect(ids(outfitsFor(19, true))).toEqual(['napo-suit', 'lineman-jacket', 'rain-cape', 'ranger-coat']);
    expect(ids(outfitsFor(LEVEL_MAX, true))).toEqual(ids(OUTFITS));
  });

  it('gives a guest none, whatever their level, until they sign in', () => {
    for (const level of [1, 5, 10, 20]) expect(outfitsFor(level, false)).toEqual([]);
    expect(mayWear('napo-suit', 20, false)).toBe(false);
    expect(mayWear('napo-suit', 1, true)).toBe(true);
  });

  it('checks an outfit by id or as it is, and never one that does not exist', () => {
    expect(mayWear('ranger-coat', 14, true)).toBe(false);
    expect(mayWear('ranger-coat', 15, true)).toBe(true);
    expect(mayWear(outfitOf('patchwork'), 20, true)).toBe(true);
    expect(mayWear('top-hat', 20, true)).toBe(false);
    expect(mayWear(null, 20, true)).toBe(false);
  });

  it('says which outfits a climb of several levels opens, and none for a climb that opens nothing', () => {
    expect(ids(outfitsOpening(1, 2))).toEqual([]);
    expect(ids(outfitsOpening(4, 5))).toEqual(['lineman-jacket']);
    expect(ids(outfitsOpening(3, 12))).toEqual(['lineman-jacket', 'rain-cape']);
    expect(ids(outfitsOpening(5, 9))).toEqual([]);
    // Level 1 is where everyone starts: the suit comes with signing in, not with a level.
    expect(ids(outfitsOpening(1, LEVEL_MAX))).toEqual(['lineman-jacket', 'rain-cape', 'ranger-coat', 'patchwork']);
  });
});

describe('the outfit message', () => {
  it('wears an outfit at the chest on a tile, or none', () => {
    expect(parseClientMsg('{"t":"outfit","x":5,"y":1,"outfit":"rain-cape"}')).toEqual({ t: 'outfit', x: 5, y: 1, outfit: 'rain-cape' });
    expect(parseClientMsg('{"t":"outfit","x":5,"y":1,"outfit":null}')).toEqual({ t: 'outfit', x: 5, y: 1, outfit: null });
  });

  it('refuses one without an outfit, an empty or overlong one, or one without a tile', () => {
    for (const raw of [
      '{"t":"outfit","x":5,"y":1}',
      '{"t":"outfit","x":5,"y":1,"outfit":""}',
      `{"t":"outfit","x":5,"y":1,"outfit":"${'x'.repeat(41)}"}`,
      '{"t":"outfit","outfit":"rain-cape"}',
      '{"t":"outfit","x":5.5,"y":1,"outfit":"rain-cape"}',
      '{"t":"outfit","x":5,"y":1,"outfit":7}',
    ]) expect(parseClientMsg(raw), raw).toBeNull();
  });
});
