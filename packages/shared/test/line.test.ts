import { describe, expect, it } from 'vitest';
import { LEANS, ORDER, DIAGRAM_PIECES, SOLUTION, pieceLines, pieceOf, solved, tagNumber } from '../src';

describe('the dead line', () => {
  it('leans every pole of the woods\' line, and orders only poles that lean', () => {
    expect(Object.keys(LEANS).map(Number).sort((a, b) => a - b)).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(ORDER.every(n => n in LEANS) && new Set(ORDER).size === ORDER.length).toBe(true);
  });
  it('never asks for the same way twice in a row, since facing it again is no turn', () => {
    expect(SOLUTION.every((d, i) => i === 0 || d !== SOLUTION[i - 1])).toBe(true);
  });
  it('gives pieces that chain and cover the whole order', () => {
    const covered = new Set(DIAGRAM_PIECES.flatMap(([a, b]) => ORDER.slice(a, b)));
    expect(covered.size).toBe(ORDER.length);
    DIAGRAM_PIECES.slice(1).forEach(([a], i) => expect(a).toBeLessThan(DIAGRAM_PIECES[i]![1]));
  });
  it('hands a player the same piece every time, and pieces are all used', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(pieceOf(ids[3]!)).toBe(pieceOf(ids[3]!));
    expect(new Set(ids.map(pieceOf)).size).toBe(DIAGRAM_PIECES.length);
    expect(pieceLines(0).join(' ')).toContain('N-9, then N-14, then N-7');
  });
  it('is solved by the last facings only, in order', () => {
    expect(solved(SOLUTION)).toBe(true);
    expect(solved(['up', 'up', ...SOLUTION])).toBe(true);
    expect(solved(SOLUTION.slice(1))).toBe(false);
    expect(tagNumber('N-12')).toBe(12);
    expect(tagNumber('N-x')).toBeUndefined();
  });
});
