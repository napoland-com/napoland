import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STARTER_TOOLS, TOOL_ICONS, type FindView, type ItemsData, type Senses } from '@napoland/shared';
import { toolsHtml } from '../src/hud';
import { RADIO_ICON, TOOL_DRAWINGS, iconFor } from '../src/icons';
import { Items, toolViews } from '../src/items';
import { FAINT_EDGE, FAINT_END, LOUD_EDGE, crackleAt, heardFinds, nearest, radioCrackle, radioHears, radioHum, radioOf, type RadioScene } from '../src/radio';
import { didText, makeQuestion } from '../src/said';
import { soundscape, type Scene } from '../src/soundscape';

/** The items as they ship: the field radio among them. */
const content = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/items.json'), 'utf8')) as ItemsData;
const items = new Items(content);
const radio = radioOf([...STARTER_TOOLS, 'radio'], items)!;

const find = (item: string, x: number, y: number, id = x * 100 + y): FindView => ({ id, item, x, y });

describe('the field radio in content/items.json', () => {
  it('is a tool that listens for shards, live shards and strange objects, and copper on aurora nights: loud within 6 tiles, faint within 15', () => {
    const def = items.get('radio');
    expect(def).toMatchObject({ kind: 'tool', icon: 'radio', stack: 1 });
    expect(def.senses).toEqual({ finds: [{ item: 'shard' }, { item: 'live-shard' }, { item: 'strange' }, { item: 'wire', when: 'aurora' }], loud: 6, faint: 15 });
    expect(radio).toBe(def);
  });

  it('is rewired at the workbench from 2 copper wire and 1 scrap, asking first like anything made', () => {
    const recipe = content.recipes!.find(r => r.make === 'radio')!;
    expect(recipe.needs).toEqual([{ item: 'wire', count: 2 }, { item: 'scrap', count: 1 }]);
    expect(recipe.count ?? 1).toBe(1);
    expect(makeQuestion(recipe, items)).toBe('Make a radio? It uses 2 wire and 1 scrap.');
  });

  it('says where it went and what it does once made', () => {
    expect(didText({ kind: 'made', item: 'radio', count: 1 }, items)).toBe(
      'You make a radio. It is yours for good: its button is in your bag. Out in the wilds it crackles louder the nearer you are to something strange. Its button turns it off and on.',
    );
  });

  it('has a drawing of its own for its button (npm run validate checks the rest of it)', () => {
    expect(TOOL_ICONS).toContain('radio');
    expect(TOOL_DRAWINGS.radio).toBe(RADIO_ICON);
    expect(iconFor(items.get('radio'))).toBe(RADIO_ICON);
    expect(RADIO_ICON).not.toBe(TOOL_DRAWINGS.map);
    expect(RADIO_ICON).toMatch(/^<svg viewBox="0 0 32 32"[^>]*>[\s\S]*<\/svg>$/);
  });

  it('is found among the tools you own, and nothing else is a radio', () => {
    expect(radioOf([...STARTER_TOOLS], items)).toBeUndefined();
    expect(radioOf([], items)).toBeUndefined();
    expect(radioOf(['stonebrook-map', 'radio'], items)?.id).toBe('radio');
  });
});

describe('what the radio hears', () => {
  const senses = radio.senses;
  const lying = [find('shard', 10, 10), find('live-shard', 20, 5), find('strange', 3, 30), find('wire', 12, 10), find('glowcap', 11, 10), find('resin', 10, 11)];

  it('hears shards, live shards and strange objects always, and copper wire only on aurora nights, never anything else', () => {
    expect(heardFinds(lying, senses, 'rain')).toEqual([{ x: 10, y: 10 }, { x: 20, y: 5 }, { x: 3, y: 30 }]);
    expect(heardFinds(lying, senses, 'night')).toEqual([{ x: 10, y: 10 }, { x: 20, y: 5 }, { x: 3, y: 30 }]);
    expect(heardFinds(lying, senses, 'aurora')).toEqual([{ x: 10, y: 10 }, { x: 20, y: 5 }, { x: 3, y: 30 }, { x: 12, y: 10 }]);
    expect(heardFinds([find('glowcap', 1, 1)], senses, 'aurora')).toEqual([]);
  });

  it('goes by the nearest one alone', () => {
    const spots = heardFinds(lying, senses, 'rain');
    expect(nearest(spots, 12, 10)).toBe(2);
    expect(nearest(spots, 20, 8)).toBe(3);
    expect(nearest([], 12, 10)).toBe(Infinity);
    // Copper in the dark, on an aurora night: closer than the shard.
    expect(nearest(heardFinds(lying, senses, 'aurora'), 12, 11)).toBe(1);
  });

  it('crackles loud within 6 tiles, faint within 15, and not at all past that, louder the nearer', () => {
    expect(crackleAt(0, senses)).toBe(1);
    expect(crackleAt(6, senses)).toBeCloseTo(LOUD_EDGE);
    expect(crackleAt(6.01, senses)).toBeCloseTo(FAINT_EDGE, 2);
    expect(crackleAt(15, senses)).toBeCloseTo(FAINT_END);
    expect(crackleAt(15.01, senses)).toBe(0);
    expect(crackleAt(Infinity, senses)).toBe(0);
    let last = 2;
    for (let d = 0; d <= 15; d += 0.5) {
      expect(crackleAt(d, senses), `${d} tiles`).toBeLessThan(last);
      expect(crackleAt(d, senses), `${d} tiles`).toBeGreaterThan(0);
      last = crackleAt(d, senses);
    }
    // Crossing into the loud reach is a step up you hear.
    expect(crackleAt(5.99, senses) - crackleAt(6.01, senses)).toBeGreaterThan(0.25);
  });
});

describe('what the radio plays', () => {
  const on = (near: number): RadioScene => ({ on: true, senses: radio.senses, near });

  /** The crackle and the hum it plays. */
  const plays = (r: RadioScene | null, kind: 'wilds' | 'town' | 'inside', storm = false) => [radioCrackle(r, kind, storm), radioHum(r, storm)];

  it('crackles out in the wilds by the nearest thing it hears, over the hum', () => {
    expect(plays(on(3), 'wilds')).toEqual([crackleAt(3, radio.senses), 1]);
    expect(plays(on(Infinity), 'wilds')).toEqual([0, 1]);
  });

  it('gives only the hum elsewhere, in town and in rooms, whatever lies near', () => {
    expect(plays(on(1), 'town')).toEqual([0, 1]);
    expect(plays(on(1), 'inside')).toEqual([0, 1]);
  });

  it('goes silent in a storm, and while it is off or you have none', () => {
    expect(plays(on(1), 'wilds', true)).toEqual([0, 0]);
    expect(plays(on(1), 'inside', true)).toEqual([0, 0]);
    expect(plays({ ...on(1), on: false }, 'wilds')).toEqual([0, 0]);
    expect(plays(null, 'wilds')).toEqual([0, 0]);
    expect(radioHears(on(1), false)).toBe(true);
    expect(radioHears(on(1), true)).toBe(false);
    expect(radioHears(null, false)).toBe(false);
  });
});

describe('the radio in the soundscape', () => {
  const scene = (s: Partial<Scene> = {}): Scene => ({
    map: 'woods', kind: 'wilds', weather: 'overcast', storm: false, lightning: false,
    me: { id: 'me', x: 5, y: 5, tx: 5, ty: 5, ground: 'grass' },
    fires: [], poles: [], surge: null, caught: false, creatures: [], flashes: [], live: false, news: [], radio: null, ...s,
  });
  const set = (on: boolean, near = 4): RadioScene => ({ on, senses: radio.senses, near });
  const restless = { kind: 'surge' as const, view: { phase: 'unstable' as const, left: 360, into: 0 } };

  it('plays the crackle and the hum as loops, never panned: they are the same in both ears', () => {
    const { loops } = soundscape(scene({ radio: set(true) }));
    expect(loops.radio).toBeCloseTo(crackleAt(4, radio.senses));
    expect(loops.hum).toBe(1);
    expect(soundscape(scene({ radio: set(true), kind: 'town' })).loops).toMatchObject({ radio: 0, hum: 1 });
    expect(soundscape(scene({ radio: set(true), storm: true })).loops).toMatchObject({ radio: 0, hum: 0 });
    expect(soundscape(scene({ radio: set(false) })).loops).toMatchObject({ radio: 0, hum: 0 });
    expect(soundscape(scene()).loops).toMatchObject({ radio: 0, hum: 0 });
  });

  it('gives one burst of static on each of the Tower\'s pulses, the moment the region grows restless', () => {
    expect(soundscape(scene({ radio: set(true), news: [restless] })).shots).toEqual([{ kind: 'bell' }, { kind: 'pulse' }]);
    expect(soundscape(scene({ radio: set(true), news: [{ kind: 'surge', view: { phase: 'surge', left: 150, into: 0 } }] })).shots).toEqual([]);
    // Off, in a storm, or without a radio: only the bell.
    expect(soundscape(scene({ radio: set(false), news: [restless] })).shots).toEqual([{ kind: 'bell' }]);
    expect(soundscape(scene({ radio: set(true), storm: true, news: [restless] })).shots).toEqual([{ kind: 'bell' }]);
    expect(soundscape(scene({ news: [restless] })).shots).toEqual([{ kind: 'bell' }]);
  });

  it('clicks when switched, and tunes in when switched on or just made on', () => {
    expect(soundscape(scene({ radio: set(true) }), scene({ radio: set(false) })).shots).toEqual([{ kind: 'tune' }]);
    expect(soundscape(scene({ radio: set(false) }), scene({ radio: set(true) })).shots).toEqual([{ kind: 'click' }]);
    expect(soundscape(scene({ radio: set(true) }), scene()).shots).toEqual([{ kind: 'tune' }]);
    expect(soundscape(scene({ radio: set(true) }), scene({ radio: set(true, 9) })).shots).toEqual([]);
    // Arriving on another map is no switch.
    expect(soundscape(scene({ radio: set(true), map: 'cabin' }), scene()).shots).toEqual([]);
  });
});

describe("the radio's button in the bag's header", () => {
  it('says whether it is on, with its own drawing, beside the map button', () => {
    const tools = [...STARTER_TOOLS, 'radio'];
    expect(toolViews(tools, items, true)).toEqual([
      { item: null, label: 'Open the map', icon: TOOL_DRAWINGS.map },
      { item: 'radio', label: 'Field radio', icon: RADIO_ICON, on: true },
    ]);
    expect(toolViews(tools, items, false)[1]).toMatchObject({ item: 'radio', on: false });
    // On unless it was turned off.
    expect(toolViews(tools, items)[1]).toMatchObject({ on: true });
  });

  it('is drawn pressed with its lamp lit while on, unpressed with its lamp dark while off; other tools have neither', () => {
    const [map, on] = toolViews([...STARTER_TOOLS, 'radio'], items, true);
    const off = toolViews(['radio'], items, false)[0]!;
    expect(toolsHtml([map!])).toBe(`<button type="button" class="slot" data-map aria-label="Open the map">${TOOL_DRAWINGS.map}</button>`);
    expect(toolsHtml([on!])).toBe(`<button type="button" class="slot" data-tool="radio" aria-pressed="true" data-on aria-label="Field radio">${RADIO_ICON}<i class="lamp" aria-hidden="true"></i></button>`);
    expect(toolsHtml([off])).toBe(`<button type="button" class="slot" data-tool="radio" aria-pressed="false" aria-label="Field radio">${RADIO_ICON}<i class="lamp" aria-hidden="true"></i></button>`);
  });
});

describe('a radio that listens for something else', () => {
  it('follows its senses: what it hears and how far are data', () => {
    const senses: Senses = { finds: [{ item: 'glowcap' }], loud: 2, faint: 4 };
    expect(heardFinds([find('glowcap', 1, 1), find('shard', 2, 2)], senses, 'rain')).toEqual([{ x: 1, y: 1 }]);
    expect(crackleAt(3, senses)).toBeGreaterThan(0);
    expect(crackleAt(4.5, senses)).toBe(0);
  });
});
