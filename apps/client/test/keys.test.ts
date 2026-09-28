import { beforeEach, describe, expect, it } from 'vitest';
import type { Dir } from '@napoland/shared';
import { Keys, keyTarget } from '../src/keys';

let heard: Array<Dir | null | 'A' | 'B' | 'chat' | 'map'>;
let keys: Keys;

beforeEach(() => {
  heard = [];
  keys = new Keys({ pad: d => heard.push(d), a: () => heard.push('A'), b: () => heard.push('B'), openChat: () => heard.push('chat'), openMap: () => heard.push('map') });
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

  it('presses A with E or Space and B with Q or Escape, once per press', () => {
    expect(keys.down('KeyE', 'page')).toBe(true);
    keys.down('KeyE', 'page', true);
    keys.down('Space', 'page');
    expect(keys.down('KeyQ', 'page')).toBe(true);
    keys.down('KeyQ', 'page', true);
    keys.down('Escape', 'page');
    expect(heard).toEqual(['A', 'A', 'B', 'B']);
  });

  it('opens the chat with Enter, as in Metin2, once per press', () => {
    expect(keys.down('Enter', 'page')).toBe(true);
    keys.down('Enter', 'page', true);
    keys.down('NumpadEnter', 'page');
    expect(heard).toEqual(['chat', 'chat']);
  });

  it('opens the map with M, once per press', () => {
    expect(keys.down('KeyM', 'page', false, false, 'm')).toBe(true);
    keys.down('KeyM', 'page', true, false, 'm');
    expect(keys.down('KeyM', 'text', false, false, 'm')).toBe(false);
    expect(heard).toEqual(['map']);
  });

  it('opens the map with the key that types M, wherever a layout puts it', () => {
    // French: M sits right of L, and the key in its place types a comma.
    expect(keys.down('Semicolon', 'page', false, false, 'm')).toBe(true);
    expect(keys.down('KeyM', 'page', false, false, ',')).toBe(false);
    expect(keys.down('Semicolon', 'page', false, false, 'M')).toBe(true);
    // A layout without Latin letters goes by where M sits, and so does an event without its letter.
    expect(keys.down('KeyM', 'page', false, false, 'ь')).toBe(true);
    expect(keys.down('KeyM', 'page')).toBe(true);
    // The keys that walk and press A and B stay where they sit, whatever they type.
    keys.down('KeyE', 'page', false, false, 'm');
    expect(heard).toEqual(['map', 'map', 'map', 'map', 'A']);
  });

  it('leaves the browser its shortcuts, fields their typing, and buttons their Enter and Space', () => {
    expect(keys.down('KeyW', 'page', false, true)).toBe(false);
    expect(keys.down('KeyW', 'text')).toBe(false);
    expect(keys.down('KeyE', 'text')).toBe(false);
    expect(keys.down('Enter', 'text')).toBe(false);
    expect(keys.down('Enter', 'control')).toBe(false);
    expect(keys.down('Space', 'control')).toBe(false);
    expect(keys.down('Backspace', 'page')).toBe(false);
    expect(keys.down('KeyZ', 'page')).toBe(false);
    expect(heard).toEqual([]);
    // On a focused button, E and Q are still the game's: the button has nothing to do with them.
    keys.down('KeyE', 'control');
    keys.down('Escape', 'control');
    expect(heard).toEqual(['A', 'B']);
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

describe('Q held, for a call', () => {
  let said: string[];
  let held: Keys;
  beforeEach(() => {
    said = [];
    held = new Keys({
      pad: d => said.push(`pad ${d}`), a: () => said.push('A'), b: () => said.push('B'), openChat: () => said.push('chat'), openMap: () => said.push('map'),
      holdB: on => said.push(on ? 'hold' : 'let go'), call: k => said.push(`call ${k}`), cancelCall: () => said.push('cancel'),
    });
  });

  it('holds B while Q is down, once however long it repeats, and lets it go with Q', () => {
    expect(held.down('KeyQ', 'page')).toBe(true);
    expect(held.down('KeyQ', 'page', true)).toBe(true);
    held.up('KeyQ');
    held.up('KeyQ');
    expect(said).toEqual(['hold', 'let go']);
  });

  it('sings the call 1, 2 or 3 picks while Q is held, by where the digit sits, on the row or the keypad', () => {
    held.down('KeyQ', 'page');
    expect(held.down('Digit1', 'page', false, false, '&')).toBe(true);
    held.down('Digit2', 'page');
    held.down('Digit2', 'page', true);
    held.down('Numpad3', 'page');
    held.up('KeyQ');
    expect(said).toEqual(['hold', 'call here', 'call come', 'call thanks', 'let go']);
  });

  it('leaves the digits to the page when Q is not held', () => {
    expect(held.down('Digit1', 'page')).toBe(false);
    expect(said).toEqual([]);
  });

  it('calls nothing when Escape comes while Q is held, or the window loses focus; Escape alone is B', () => {
    held.down('KeyQ', 'page');
    held.down('Escape', 'page');
    held.up('KeyQ');
    held.down('KeyQ', 'page');
    held.clear();
    held.up('KeyQ');
    held.down('Escape', 'page');
    expect(said).toEqual(['hold', 'cancel', 'let go', 'hold', 'cancel', 'B']);
  });

  it('keeps walking while Q is held: the stick and the call are two hands', () => {
    held.down('KeyQ', 'page');
    held.down('KeyW', 'page');
    held.up('KeyW');
    held.up('KeyQ');
    expect(said).toEqual(['hold', 'pad up', 'pad null', 'let go']);
  });

  it('is B at once without a hold to feed, as it always was', () => {
    held = new Keys({ pad: () => {}, a: () => said.push('A'), b: () => said.push('B'), openChat: () => {}, openMap: () => {} });
    held.down('KeyQ', 'page');
    held.up('KeyQ');
    expect(held.down('Digit1', 'page')).toBe(false);
    expect(said).toEqual(['B']);
  });

  it('leaves Q alone while typing, and with Ctrl, Alt or Cmd', () => {
    expect(held.down('KeyQ', 'text')).toBe(false);
    expect(held.down('KeyQ', 'page', false, true)).toBe(false);
    held.up('KeyQ');
    expect(said).toEqual([]);
  });
});
