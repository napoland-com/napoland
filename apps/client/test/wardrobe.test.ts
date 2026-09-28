/**
 * The wardrobe without a page: its tiles, the cards of outfits and what they do, how the game keeps
 * everyone's outfit and asks the server for yours, what the level banner says about new outfits, and
 * which look an outfit draws (characters.ts) in how many draw calls.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { OUTFITS, xpFor, type ClientMsg, type ItemsData, type MapData, type PlayerView } from '@napoland/shared';
import { cardPress, detailView, refKey, type DetailState, type DetailView } from '../src/details';
import { Game } from '../src/game';
import { cardHtml } from '../src/hud';
import { NO_OUTFIT_ICON, outfitIcon } from '../src/icons';
import { Items, lookOf, refusalText } from '../src/items';
import { Maps } from '../src/maps';
import { newsBanner } from '../src/status';
import { NO_OUTFIT, WARDROBE_GATE, outfitWords, wardrobeView, type WardrobeState } from '../src/wardrobe';
import { OUTFIT_LOOKS, dressOf, makePlayer } from '../src/view/characters';
import { FULL, itemsData, tinyTown, welcome } from './fixtures';

const data: ItemsData = {
  ...itemsData(),
  items: [
    ...itemsData().items,
    { id: 'coat', name: 'Raincoat', kind: 'gear', stack: 1, text: 'Dry.', slot: 'shirt', tier: 'sturdy', color: '#e8c547' },
    { id: 'pack', name: 'Hiking pack', kind: 'gear', stack: 1, text: 'Big.', slot: 'bag', color: '#7a4a2a', bag: 12 },
  ],
};
const items = new Items(data);
const signedIn = (level: number, wearing: string | null = null): WardrobeState => ({ guest: false, level, wearing });
const state = (wardrobe?: WardrobeState): DetailState => ({ items, bag: [], stash: [], gear: {}, worn: {}, ...(wardrobe ? { wardrobe } : {}) });
const card = (id: string, w: WardrobeState): DetailView => detailView({ from: 'outfit', id }, state(w))!;

describe('the wardrobe\'s tiles', () => {
  it('show no outfit first, then every outfit in the order they open; a locked one says the level that opens it', () => {
    const v = wardrobeView(signedIn(12, 'lineman-jacket'));
    expect(v.gate).toBeNull();
    expect(v.tiles.map(t => [t.id, t.label, t.locked, t.worn])).toEqual([
      ['none', 'No outfit', false, false],
      ['napo-suit', 'NAPO work suit', false, false],
      ['lineman-jacket', 'Lineman\'s jacket', false, true],
      ['rain-cape', 'Survey rain cape', false, false],
      ['ranger-coat', 'Level 15', true, false],
      ['patchwork', 'Level 20', true, false],
    ]);
    expect(v.tiles.map(t => t.icon)).toEqual([NO_OUTFIT_ICON, ...OUTFITS.map(o => outfitIcon(o.id))]);
  });

  it('mark no outfit as worn when none is, and open only the suit at the first level', () => {
    const v = wardrobeView(signedIn(1));
    expect(v.tiles.filter(t => t.worn).map(t => t.id)).toEqual(['none']);
    expect(v.tiles.filter(t => !t.locked).map(t => t.id)).toEqual(['none', 'napo-suit']);
    expect(wardrobeView(signedIn(20)).tiles.every(t => !t.locked)).toBe(true);
  });

  it('are one card for a guest: signing in keeps what you wear', () => {
    expect(wardrobeView({ guest: true, level: 20, wearing: null })).toEqual({ gate: WARDROBE_GATE, tiles: [] });
    expect(WARDROBE_GATE).toBe('Sign in to keep what you wear. Signing in keeps your character.');
  });

  it('draw every outfit its own way', () => {
    const icons = OUTFITS.map(o => outfitIcon(o.id));
    expect(new Set([...icons, NO_OUTFIT_ICON]).size).toBe(OUTFITS.length + 1);
    for (const svg of icons) expect(svg).toMatch(/^<svg viewBox="0 0 32 32"[^>]*>[\s\S]*<\/svg>$/);
  });
});

describe('an outfit\'s card', () => {
  it('shows its drawing, name and line, and wears it', () => {
    const v = card('rain-cape', signedIn(12));
    expect(v).toMatchObject({ icon: outfitIcon('rain-cape'), name: 'Survey rain cape', text: OUTFITS[2]!.text, facts: ['Yours since level 10'], notes: [] });
    expect(v.act).toEqual({ label: 'Wear', enabled: true, does: { kind: 'outfit', id: 'rain-cape' } });
    expect(cardPress(v)).toEqual({ does: { kind: 'outfit', id: 'rain-cape' }, close: true, shake: false });
    expect(card('napo-suit', signedIn(1)).facts).toEqual(['Yours since your first sign-in']);
  });

  it('takes off the one you wear: your gear shows again', () => {
    const v = card('rain-cape', signedIn(12, 'rain-cape'));
    expect(v.notes).toEqual([{ text: 'You wear it now.', tone: 'plain' }]);
    expect(v.act).toEqual({ label: 'Take off', then: 'your gear shows again', enabled: true, does: { kind: 'outfit', id: null } });
  });

  it('greys out one your level has not reached, says which level does, and only shakes', () => {
    const v = card('ranger-coat', signedIn(12));
    expect(v.notes).toEqual([{ text: 'It opens at level 15. You are level 12.', tone: 'plain' }]);
    expect(v.act).toMatchObject({ label: 'Wear', enabled: false });
    expect(cardPress(v)).toEqual({ close: false, shake: true });
    expect(cardHtml(v)).toContain('aria-disabled="true"');
  });

  it('asks a guest to sign in first', () => {
    const v = card('napo-suit', { guest: true, level: 5, wearing: null });
    expect(v.notes).toEqual([{ text: 'Sign in to wear it.', tone: 'plain' }]);
    expect(v.act?.enabled).toBe(false);
  });

  it('of no outfit takes off the one you wear, by name, and has nothing to do when you wear none', () => {
    const off = card(NO_OUTFIT.id, signedIn(12, 'lineman-jacket'));
    expect(off).toMatchObject({ icon: NO_OUTFIT_ICON, name: 'No outfit', text: 'Your gear shows, piece by piece, as you wear it.' });
    expect(off.act).toEqual({ label: 'Take off your lineman\'s jacket', enabled: true, does: { kind: 'outfit', id: null } });
    const none = card(NO_OUTFIT.id, signedIn(12));
    expect(none.act).toBeUndefined();
    expect(none.notes).toEqual([{ text: 'You wear no outfit now.', tone: 'plain' }]);
    expect(card(NO_OUTFIT.id, signedIn(1, 'napo-suit')).act?.label).toBe('Take off your NAPO work suit');
  });

  it('is gone for an outfit this copy does not have, or without the wardrobe', () => {
    expect(detailView({ from: 'outfit', id: 'top-hat' }, state(signedIn(20)))).toBeNull();
    expect(detailView({ from: 'outfit', id: 'napo-suit' }, state())).toBeNull();
    expect(refKey({ from: 'outfit', id: 'patchwork' })).toBe('outfit:patchwork');
  });

  it('draws as the others do: name, line and its one button', () => {
    const html = cardHtml(card('patchwork', signedIn(20)));
    expect(html).toContain('<b>Residents\' patchwork</b>');
    expect(html).toContain('A coat stitched from Stonebrook');
    expect(html).toContain('data-card-act>Wear</button>');
  });
});

describe('outfits in plain words', () => {
  it('name an outfit inside a sentence, keeping NAPO as it is', () => {
    expect(outfitWords('Lineman\'s jacket')).toBe('lineman\'s jacket');
    expect(outfitWords('NAPO work suit')).toBe('NAPO work suit');
  });

  it('say why the server would not change it', () => {
    expect(refusalText('sign_in_first', 'outfit')).toBe('Sign in to wear an outfit');
    expect(refusalText('locked', 'outfit')).toBe('Your level has not reached it yet');
    // Everything among friends still says what it did.
    expect(refusalText('sign_in_first', 'befriend')).toBe('Sign in to make friends');
  });

  it('put in the level banner the outfits a new level opens, or what signing in would', () => {
    const at = (level: number) => ({ xp: xpFor(level), level, from: xpFor(level), to: xpFor(level + 1), maxEnergy: 100 + 5 * (level - 1) });
    expect(newsBanner({ kind: 'level', progress: at(5), from: 4 }, 'Home')!.sub).toBe(
      'Your energy bar grows to 120.\nYou can go a little farther now.\nNew in your wardrobe: the lineman\'s jacket.',
    );
    expect(newsBanner({ kind: 'level', progress: at(12), from: 3 }, 'Home')!.sub).toMatch(/\nNew in your wardrobe: the lineman's jacket and the survey rain cape\.$/);
    expect(newsBanner({ kind: 'level', progress: at(15), from: 14 }, 'Home', items, true)!.sub).toMatch(/\nSign in to wear the ranger's coat\.$/);
    expect(newsBanner({ kind: 'level', progress: at(7), from: 6 }, 'Home')!.sub).toBe('Your energy bar grows to 130.\nYou can go a little farther now.');
  });
});

describe('outfits in the game', () => {
  /** A 5x4 room like home, the chest at 1,1: stand at 1,2, facing up. */
  const room = (): MapData => ({
    id: 'room', name: 'Home', version: 1, kind: 'inside', depth: 0, width: 5, height: 4,
    tiles: ['xxxxx', 'xpppx', 'xpppx', 'xxpxx'], levels: Array<string>(4).fill('00000'),
    spawn: { x: 1, y: 2, dir: 'up' }, exits: [{ x: 2, y: 3, w: 1, h: 1, to: 'town', tx: 3, ty: 1, dir: 'down' }],
    objects: [{ kind: 'chest', x: 1, y: 1 }],
  });
  const person = (id: string, more: Partial<PlayerView> = {}): PlayerView => ({ id, name: id, x: 1, y: 2, dir: 'up', color: '#f29e4c', gear: { shirt: 'coat', bag: 'pack' }, quirks: [], ...more });
  let sent: ClientMsg[];
  let g: Game;
  beforeEach(() => {
    sent = [];
    g = new Game(new Maps([tinyTown(), room()]), m => sent.push(m), items);
  });

  it('knows what outfit everyone wears, from the welcome, as they come and as they change it', () => {
    g.handle(welcome(room(), [person('me', { outfit: 'napo-suit' }), person('bea', { x: 3 })], FULL), 0);
    expect(g.myOutfit).toBe('napo-suit');
    expect(g.outfits.get('bea')).toBeUndefined();
    g.handle({ t: 'outfit', id: 'bea', outfit: 'rain-cape' }, 0);
    expect(g.outfits.get('bea')).toBe('rain-cape');
    g.handle({ t: 'outfit', id: 'me', outfit: null }, 0);
    expect(g.myOutfit).toBeNull();
    g.handle({ t: 'join', player: person('cid', { x: 2, outfit: 'patchwork' }) }, 0);
    expect(g.outfits.get('cid')).toBe('patchwork');
    g.handle({ t: 'join', player: person('cid', { x: 2 }) }, 0);
    expect(g.outfits.has('cid')).toBe(false);
  });

  it('draws someone in an outfit in it, with the pack they carry and nothing else of their gear', () => {
    g.handle(welcome(room(), [person('me'), person('bea', { x: 3, outfit: 'ranger-coat' })], FULL), 0);
    const looks = new Map(g.avatars().map(a => [a.id, a.look]));
    expect(looks.get('me')).toEqual({ cap: null, shirt: '#e8c547', bag: '#7a4a2a', bagSize: Math.sqrt(12 / 8) });
    expect(looks.get('bea')).toEqual({ outfit: 'ranger-coat', bag: '#7a4a2a', bagSize: Math.sqrt(12 / 8) });
    expect(lookOf({}, items, 'napo-suit')).toEqual({ outfit: 'napo-suit' });
    // One this copy does not have (a newer server's): they show in their gear.
    expect(lookOf({ shirt: 'coat' }, items, 'top-hat')).toEqual(lookOf({ shirt: 'coat' }, items));
  });

  it('wears one from the open chest only, asking nothing: nothing is used up', () => {
    g.handle(welcome(room(), [person('me')], FULL), 0);
    g.wearOutfit('napo-suit');
    expect(sent).toEqual([]);
    g.pressA();
    g.handle({ t: 'chest', stash: [] }, 0);
    g.wearOutfit('napo-suit');
    g.wearOutfit(null);
    expect(g.question).toBeNull();
    expect(sent).toEqual([{ t: 'chest', x: 1, y: 1 }, { t: 'outfit', x: 1, y: 1, outfit: 'napo-suit' }, { t: 'outfit', x: 1, y: 1, outfit: null }]);
  });

  it('says in the text box, above the chest, why the server said no', () => {
    g.handle(welcome(room(), [person('me')], FULL), 0);
    g.handle({ t: 'refused', action: 'outfit', reason: 'locked' }, 0);
    expect(g.note).toMatchObject({ who: 'Wardrobe', text: 'Your level has not reached it yet.', waiting: false });
    expect(g.floats).toEqual([]);
  });
});

describe('an outfit as the world draws it', () => {
  it('shows instead of the gear, all but the pack, which keeps its color and size', () => {
    const gear = { cap: '#123456', shirt: '#abcdef', gloves: '#222222', pants: '#333333', shoes: '#444444', bag: '#7a4a2a', bagSize: 1.3 };
    const plain = dressOf('#3a86ff', gear);
    expect([plain.body, plain.sleeveL, plain.sleeveR, plain.front, plain.hands, plain.pants, plain.shoes]).toEqual(['#3a86ff', '#3a86ff', '#3a86ff', '#abcdef', '#222222', '#333333', '#444444']);
    for (const o of OUTFITS) {
      const d = dressOf('#3a86ff', { ...gear, outfit: o.id });
      expect([d.bag, d.bagSize], o.id).toEqual(['#7a4a2a', 1.3]);
      const colors = new Set([d.body, d.sleeveL, d.sleeveR, d.front, d.pants, d.shoes, d.hands, ...d.parts.map(p => p.color), ...d.arm.map(p => p.color)]);
      // Not the player's color, and none of their gear's.
      for (const c of ['#3a86ff', '#123456', '#abcdef', '#222222', '#333333', '#444444']) expect(colors.has(c), `${o.id} ${c}`).toBe(false);
    }
  });

  it('gives the lineman Walt\'s yellow hard hat, and the rain cape a pack over the cape', () => {
    expect(dressOf('#fff', { outfit: 'lineman-jacket' }).parts.map(p => p.color)).toContain('#d9a82b');
    expect(dressOf('#fff', { outfit: 'rain-cape' }).packBack).toBeGreaterThan(0);
    expect(dressOf('#fff', { outfit: 'napo-suit' }).packBack).toBe(0);
  });

  it('has a look for every outfit, and draws the gear for one this copy does not have', () => {
    expect(Object.keys(OUTFIT_LOOKS).sort()).toEqual(OUTFITS.map(o => o.id).sort());
    expect(dressOf('#3a86ff', { outfit: 'top-hat', cap: null })).toEqual(dressOf('#3a86ff', { cap: null }));
  });

  it('is drawn in the wardrobe in the colors of the world', () => {
    for (const o of OUTFITS) {
      const d = dressOf('#fff', { outfit: o.id });
      for (const c of new Set([d.body, d.sleeveL, d.sleeveR])) expect(outfitIcon(o.id), `${o.id} ${c}`).toContain(c);
    }
  });

  it('costs no more draw calls than anyone: five moving parts, each one mesh and one outline, whatever they wear', () => {
    const meshes = (rig: ReturnType<typeof makePlayer>) => { let n = 0; rig.root.traverse(o => { if (o instanceof THREE.Mesh) n++; }); return n; };
    const all = [{}, { cap: null }, { bag: '#7a4a2a', bagSize: 1.4 }, ...OUTFITS.map(o => ({ outfit: o.id, bag: '#7a4a2a', bagSize: 1.4 }))];
    for (const look of all) {
      const rig = makePlayer('#3a86ff', look);
      expect(meshes(rig), JSON.stringify(look)).toBe(10);
      for (const part of [rig.legL, rig.legR, rig.armL, rig.armR]) expect(part.children).toHaveLength(2);
    }
  });
});
