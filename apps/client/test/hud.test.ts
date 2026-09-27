import { describe, expect, it } from 'vitest';
import { REFILL_PER_SECOND } from '@napoland/shared';
import { chatKey, energyLook, soundRow } from '../src/hud';
import type { SoundSetting } from '../src/sound';

describe('the energy bar', () => {
  it('shows neither refilling nor draining while energy holds, in town and inside (rate 0)', () => {
    expect(energyLook({ value: 60, max: 100, rate: 0 })).toEqual({ fill: 0.6, level: 'ok', refill: false, vignette: 0 });
  });

  it('keeps its bright tip while a fire refills it, until it is full', () => {
    expect(energyLook({ value: 60, max: 100, rate: REFILL_PER_SECOND }).refill).toBe(true);
    expect(energyLook({ value: 100, max: 100, rate: REFILL_PER_SECOND }).refill).toBe(false);
  });

  it('has no tip while draining in the wilds', () => {
    expect(energyLook({ value: 60, max: 100, rate: -0.3 }).refill).toBe(false);
  });

  it('turns low, then critical, and darkens the screen edges below a fifth', () => {
    expect(energyLook({ value: 24, max: 100, rate: -0.3 })).toMatchObject({ level: 'low', vignette: 0 });
    const almost = energyLook({ value: 5, max: 100, rate: -0.3 });
    expect(almost.level).toBe('critical');
    expect(almost.vignette).toBeCloseTo(0.75);
  });

  it('shows a full, quiet bar before the first report', () => {
    expect(energyLook(null)).toEqual({ fill: 1, level: 'ok', refill: false, vignette: 0 });
  });
});

describe("the chat's line", () => {
  it('works as in Metin2: Enter with words sends them, Enter on an empty line closes the chat, and so does Escape', () => {
    expect(chatKey('Enter', 'hello')).toBe('send');
    expect(chatKey('Enter', '')).toBe('close');
    expect(chatKey('Enter', '   ')).toBe('close');
    expect(chatKey('Escape', 'half a thought')).toBe('close');
    expect(chatKey('a', '')).toBeNull();
  });

  it('leaves the keys alone while an input method is still picking a word', () => {
    expect(chatKey('Enter', '', true)).toBeNull();
    expect(chatKey('Escape', 'こん', true)).toBeNull();
  });
});

describe("the menu's sound row", () => {
  /** Plain EventTargets stand in for the mute button, its label and the slider. */
  function setup() {
    const mute = Object.assign(new EventTarget(), { attrs: {} as Record<string, string>, setAttribute(k: string, v: string) { this.attrs[k] = v; } });
    const label = { textContent: '' as string | null }, volume = Object.assign(new EventTarget(), { value: '' });
    const said: SoundSetting[] = [];
    const show = soundRow({ mute, label, volume }, s => said.push(s));
    return { mute, label, volume, said, show };
  }

  it('shows the setting it is given', () => {
    const { mute, label, volume, said, show } = setup();
    show({ volume: 0.4, muted: true });
    expect([mute.attrs['aria-pressed'], label.textContent, volume.value]).toEqual(['false', 'Sound off', '40']);
    show({ volume: 1, muted: false });
    expect([mute.attrs['aria-pressed'], label.textContent, volume.value]).toEqual(['true', 'Sound on', '100']);
    expect(said).toEqual([]);
  });

  it('mutes and unmutes with the button, keeping the volume', () => {
    const { mute, label, said, show } = setup();
    show({ volume: 0.4, muted: false });
    mute.dispatchEvent(new Event('click'));
    mute.dispatchEvent(new Event('click'));
    expect(said).toEqual([{ volume: 0.4, muted: true }, { volume: 0.4, muted: false }]);
    expect(label.textContent).toBe('Sound on');
  });

  it('sets the volume with the slider, and a muted game comes back on', () => {
    const { volume, said, show } = setup();
    show({ volume: 0.7, muted: true });
    volume.value = '25';
    volume.dispatchEvent(new Event('input'));
    expect(said).toEqual([{ volume: 0.25, muted: false }]);
  });
});
