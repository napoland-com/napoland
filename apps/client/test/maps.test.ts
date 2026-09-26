import { describe, expect, it } from 'vitest';
import { Maps } from '../src/maps';
import { tinyTown, tinyWoods } from './fixtures';

describe('bundled maps', () => {
  const maps = new Maps([tinyWoods(), tinyTown()]);

  it('finds the map the server names, built once', () => {
    const woods = maps.get({ id: 'woods', version: 3 });
    expect(woods?.data.name).toBe('The Test Woods');
    expect(maps.get({ id: 'woods', version: 3 })).toBe(woods);
  });

  it('has nothing for a map it lacks or has in another version (the client is out of date)', () => {
    expect(maps.get({ id: 'far-woods', version: 1 })).toBeUndefined();
    expect(maps.get({ id: 'woods', version: 4 })).toBeUndefined();
  });

  it('starts in a town', () => {
    expect(maps.home().data.id).toBe('town');
  });
});
