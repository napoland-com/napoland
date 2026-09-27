import { describe, expect, it } from 'vitest';
import { maskWords, plainWord } from '../src';

describe('the chat word filter', () => {
  const words = new Set(['shit', 'fuck'].map(plainWord));

  it('masks whole listed words however they are spelled, and nothing else', () => {
    expect(maskWords('Sh1t! FUUUCK... 5h1t?', words)).toBe('****! ******... ****?');
    // Inside a longer word, or a word with a pair of letters, it is another word.
    expect(maskWords('shitake mushrooms, fucking hell, shiit', words)).toBe('shitake mushrooms, fucking hell, shiit');
    expect(maskWords('anything', new Set())).toBe('anything');
  });
});
