import { beforeEach, describe, expect, it } from 'vitest';
import type { Dir } from '@napoland/shared';
import { Keys, keyTarget } from '../src/keys';

let heard: Array<Dir | null | 'A' | 'B' | 'map'>;
let keys: Keys;

beforeEach(() => {
  heard = [];
  keys = new Keys({ pad: d => heard.push(d), a: () => heard.push('A'), b: () => heard.push('B'), openMap: () => heard.push('map') });
});

describe('the keyboard', () => {
  it('walks with WASD and the arrow keys, and stops when the key is let go', () => {
    expect(keys.down('KeyW', 'page')).toBe(true);
    keys.up('KeyW');
    keys.down('ArrowLeft', 'page');
    keys.up('ArrowLeft');
    keys.down('KeyS', 'page');
    keys.down('KeyS', 'page', true); // the key repeating: nothing new
    keys.up('KeyS');
    keys.down('ArrowRight', 'page');
    expect(heard).toEqual(['up', null, 'left', null, 'down', null, 'right']);
  });

  it('follows the last direction pressed, and falls back to one still held', () => {
    keys.down('KeyW', 'page');
    keys.down('KeyD', 'page');
    keys.up('KeyD');
    keys.up('KeyW');
    expect(heard).toEqual(['up', 'right', 'up', null]);
  });

  it('counts W and the up arrow as two keys: letting one go keeps walking on the other', () => {
    keys.down('KeyW', 'page');
    keys.down('ArrowUp', 'page');
    keys.up('KeyW');
    expect(heard).toEqual(['up']);
    keys.up('ArrowUp');
    expect(heard).toEqual(['up', null]);
  });

  it('presses A with Enter and B with Backspace, once per press', () => {
    expect(keys.down('Enter', 'page')).toBe(true);
    keys.down('Enter', 'page', true);
    keys.down('NumpadEnter', 'page');
    expect(keys.down('Backspace', 'page')).toBe(true);
    keys.down('Backspace', 'page', true);
    expect(heard).toEqual(['A', 'A', 'B']);
  });

  it('opens the map with M, once per press', () => {
    expect(keys.down('KeyM', 'page')).toBe(true);
    keys.down('KeyM', 'page', true);
    expect(keys.down('KeyM', 'text')).toBe(false);
    expect(heard).toEqual(['map']);
  });

  it('leaves the browser its shortcuts, fields their typing, and buttons their Enter', () => {
    expect(keys.down('KeyW', 'page', false, true)).toBe(false);
    expect(keys.down('KeyW', 'text')).toBe(false);
    expect(keys.down('Backspace', 'text')).toBe(false);
    expect(keys.down('Enter', 'control')).toBe(false);
    expect(keys.down('KeyQ', 'page')).toBe(false);
    expect(heard).toEqual([]);
  });

  it('lets everything go when the window loses focus', () => {
    keys.down('KeyW', 'page');
    keys.down('KeyA', 'page');
    keys.clear();
    keys.clear();
    expect(heard).toEqual(['up', 'left', null]);
  });

  it('tells fields, buttons and the page apart by their tag', () => {
    expect(keyTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe('text');
    expect(keyTarget({ tagName: 'div', isContentEditable: true } as unknown as EventTarget)).toBe('text');
    expect(keyTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe('control');
    expect(keyTarget({ tagName: 'CANVAS' } as unknown as EventTarget)).toBe('page');
    expect(keyTarget(null)).toBe('page');
  });
});
