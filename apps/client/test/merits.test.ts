/**
 * Merits past level 20, without a page: the wardrobe's patterns and badges (their tiles and cards, what
 * buying asks and says, what wearing sends), what the status panel and the banners say of merits, how the
 * game keeps everyone's pattern and badge, and how a pattern is drawn on the jacket, in how many draw calls.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { BADGES, MERITS_FROM, MERIT_XP, OUTFITS, PATTERNS, xpFor, type ClientMsg, type MapData, type MeritsView, type PlayerView, type ProgressView } from '@napoland/shared';
import { cardPress, detailView, refKey, type DetailState, type DetailView } from '../src/details';
import { Game } from '../src/game';
import { cardHtml, wardrobeTilesHtml } from '../src/hud';
import { NO_BADGE_ICON, NO_PATTERN_ICON, badgeIcon, patternIcon } from '../src/icons';
import { lookOf, refusalText } from '../src/items';
import { Maps } from '../src/maps';
import { buyQuestion, didText, didWho, meritText, noMerit } from '../src/said';
import { newsBanner, statusView, type StatusInput } from '../src/status';
import { MERITS_COME, NO_BADGE, NO_PATTERN, lookIcon, wardrobeView, type WardrobeState } from '../src/wardrobe';
import { PATTERN_LOOKS, dressOf, makePlayer, shadeOf } from '../src/view/characters';
import { FULL, ITEMS, tinyTown, welcome } from './fixtures';

/** XP worth `n` merits, 260 XP past the last (1,240 to the next). */
const worth = (n: number) => MERITS_FROM + n * MERIT_XP + 260;
const at = (xp: number, merits: MeritsView = { spent: 0, owned: [] }, more: Partial<WardrobeState> = {}): WardrobeState => ({ guest: false, level: 20, wearing: null, xp, merits, ...more });
const card = (id: string, w: WardrobeState): DetailView => detailView({ from: 'look', id }, { items: ITEMS, bag: [], stash: [], gear: {}, worn: {}, wardrobe: w } satisfies DetailState)!;
const progress = (xp: number): ProgressView => ({ xp, level: 20, from: xpFor(20), to: null, maxEnergy: 195 });

describe('the wardrobe\'s patterns and badges', () => {
  it('show none first, then every one in order; one not yours shows its price, bright while a merit can buy it', () => {
    const v = wardrobeView(at(worth(2), { spent: 1, owned: ['checks'] }, { pattern: 'checks' }));
    expect(v.patterns.map(t => [t.id, t.label, t.locked, t.buy, t.worn])).toEqual([
      ['no-pattern', 'No pattern', false, false, false],
      ['stripes', '1 merit', false, true, false],
      ['checks', 'Checks', false, false, true],
      ['chevron', '1 merit', false, true, false],
      ['reflective', '1 merit', false, true, false],
      ['napo-patch', '1 merit', false, true, false],
      ['squares', '1 merit', false, true, false],
    ]);
    expect(v.badges.map(t => t.id)).toEqual(['no-badge', ...BADGES.map(b => b.id)]);
    // No badge worn: its tile has the tick.
    expect(v.badges.filter(t => t.worn).map(t => t.id)).toEqual(['no-badge']);
    expect(v.merits).toBe('Merits: 1 to spend, 1,240 XP to the next.');
  });

  it('are dim while no merit can buy them, and say below level 20 how merits come', () => {
    const top = wardrobeView(at(worth(1), { spent: 1, owned: ['fir'] }));
    expect(top.badges.filter(t => t.locked).map(t => t.id)).toEqual(BADGES.filter(b => b.id !== 'fir').map(b => b.id));
    expect(top.merits).toBe('Merits: None to spend, 1,240 XP to the next.');
    const low = wardrobeView({ guest: false, level: 12, wearing: null });
    expect(low.patterns.slice(1).every(t => t.locked && !t.buy)).toBe(true);
    expect(low.merits).toBe(MERITS_COME);
    expect(MERITS_COME).toBe('Past level 20, every 1,500 XP earns a merit.');
  });

  it('are behind the one sign-in card for a guest, like the outfits', () => {
    expect(wardrobeView({ ...at(worth(3)), guest: true })).toMatchObject({ patterns: [], badges: [], tiles: [] });
  });

  it('draw every pattern and every badge its own way', () => {
    const drawings = [...PATTERNS.map(p => lookIcon(p)), ...BADGES.map(b => lookIcon(b)), NO_PATTERN_ICON, NO_BADGE_ICON];
    expect(new Set(drawings).size).toBe(PATTERNS.length + BADGES.length + 2);
    for (const svg of drawings) expect(svg).toMatch(/^<svg viewBox="0 0 32 32"[^>]*>[\s\S]*<\/svg>$/);
    expect(patternIcon('stripes')).toBe(lookIcon(PATTERNS[0]!));
    expect(badgeIcon('fir')).toBe(lookIcon(BADGES[0]!));
    expect(badgeIcon('crown')).toBeUndefined();
  });

  it('are drawn as the outfits are, with the price bright where a merit can buy it', () => {
    const html = wardrobeTilesHtml(wardrobeView(at(worth(1), { spent: 0, owned: ['moth'] }, { badge: 'moth' })).badges, 'data-look');
    expect(html).toContain('data-look="moth" data-worn aria-label="Moth, wearing it"');
    expect(html).toContain('data-look="fir" data-buy aria-label="Fir, 1 merit to buy"');
    expect(html).toContain('<span class="lbl">1 merit</span>');
  });
});

describe('a pattern\'s or a badge\'s card', () => {
  it('buys one not yours, asking first with the card still open, and says how many merits there are', () => {
    const v = card('chevron', at(worth(3)));
    expect(v).toMatchObject({ icon: patternIcon('chevron'), name: 'Chevron', text: PATTERNS[2]!.text, facts: ['On your jacket, over an outfit too'] });
    expect(v.notes).toEqual([{ text: 'You have 3 merits to spend.', tone: 'plain' }]);
    expect(v.act).toEqual({ label: 'Buy', then: '1 merit', enabled: true, does: { kind: 'buy', look: 'chevron' } });
    expect(cardPress(v)).toEqual({ does: { kind: 'buy', look: 'chevron' }, close: false, shake: false });
    expect(card('fir', at(worth(1))).notes).toEqual([{ text: 'You have a merit to spend.', tone: 'plain' }]);
    expect(cardHtml(v)).toContain('data-card-act>Buy <span class="then">(1 merit)</span></button>');
  });

  it('greys Buy out without a merit to spend, and says how far the next is, or below level 20 how merits come', () => {
    const none = card('lamp', at(worth(1), { spent: 1, owned: ['fir'] }));
    expect(none.act).toMatchObject({ label: 'Buy', enabled: false });
    expect(none.notes).toEqual([{ text: 'You have no merit to spend. 1,240 XP to the next.', tone: 'plain' }]);
    expect(cardPress(none)).toEqual({ close: false, shake: true });
    expect(card('lamp', { guest: false, level: 12, wearing: null }).notes).toEqual([{ text: 'Past level 20, every 1,500 XP earns a merit.', tone: 'plain' }]);
    expect(card('lamp', { ...at(worth(2)), guest: true }).notes).toEqual([{ text: 'Sign in to spend merits.', tone: 'plain' }]);
  });

  it('wears one of yours, asking nothing, and takes off the one you wear', () => {
    const mine = { spent: 2, owned: ['stripes', 'flame'] };
    const v = card('flame', at(worth(2), mine));
    expect(v).toMatchObject({ facts: ['On your name tag, beside your name', 'Yours for good'], notes: [] });
    expect(v.act).toEqual({ label: 'Wear', enabled: true, does: { kind: 'badge', id: 'flame' } });
    expect(cardPress(v)).toEqual({ does: { kind: 'badge', id: 'flame' }, close: true, shake: false });
    const worn = card('stripes', at(worth(2), mine, { pattern: 'stripes' }));
    expect(worn.notes).toEqual([{ text: 'You wear it now.', tone: 'plain' }]);
    expect(worn.act).toEqual({ label: 'Take off', then: 'your jacket as it is', enabled: true, does: { kind: 'pattern', id: null } });
  });

  it('of none takes off the one you wear, by name, and has nothing to do when you wear none', () => {
    const w = at(worth(2), { spent: 2, owned: ['stripes', 'old-stone'] }, { pattern: 'stripes', badge: 'old-stone' });
    expect(card(NO_PATTERN.id, w).act).toEqual({ label: 'Take off the stripes', enabled: true, does: { kind: 'pattern', id: null } });
    expect(card(NO_BADGE.id, w).act).toEqual({ label: 'Take off the Old Stone badge', enabled: true, does: { kind: 'badge', id: null } });
    const bare = card(NO_BADGE.id, at(worth(2)));
    expect(bare).toMatchObject({ icon: NO_BADGE_ICON, name: 'No badge', text: 'Your name alone on your name tag.', notes: [{ text: 'You wear no badge now.', tone: 'plain' }] });
    expect(bare.act).toBeUndefined();
  });

  it('is gone for a look this copy does not have, or without the wardrobe', () => {
    expect(detailView({ from: 'look', id: 'crown' }, { items: ITEMS, bag: [], stash: [], gear: {}, worn: {}, wardrobe: at(worth(1)) })).toBeNull();
    expect(detailView({ from: 'look', id: 'fir' }, { items: ITEMS, bag: [], stash: [], gear: {}, worn: {} })).toBeNull();
    expect(refKey({ from: 'look', id: 'fir' })).toBe('look:fir');
  });
});

describe('merits in plain words', () => {
  it('ask before a merit is spent, and say what it bought', () => {
    expect(buyQuestion(PATTERNS[2]!, 3)).toBe('Spend a merit on the chevron pattern? You have 3.');
    expect(buyQuestion(BADGES[5]!, 1)).toBe('Spend a merit on the Old Stone badge? You have 1.');
    expect(didWho({ kind: 'bought', look: 'chevron', left: 2 }, ITEMS)).toBe('Wardrobe');
    expect(didText({ kind: 'bought', look: 'chevron', left: 2 }, ITEMS)).toBe('The chevron pattern is yours for good. 2 merits left to spend.');
    expect(didText({ kind: 'bought', look: 'stripes', left: 1 }, ITEMS)).toBe('The stripes are yours for good. One merit left to spend.');
    expect(didText({ kind: 'bought', look: 'fir', left: 0 }, ITEMS)).toBe('The fir badge is yours for good.');
  });

  it('say why there is no merit to spend, and why the server said no', () => {
    expect(noMerit(xpFor(15))).toBe('Past level 20, every 1,500 XP earns a merit.');
    expect(noMerit(worth(0))).toBe('You have no merit to spend. 1,240 XP to the next.');
    expect(refusalText('no_merits', 'buy')).toBe('You have no merit to spend on it');
    expect(refusalText('owned', 'buy')).toBe('It is yours already');
    expect(refusalText('not_owned', 'pattern')).toBe('It is not yours yet: spend a merit on it first');
    expect(refusalText('sign_in_first', 'buy')).toBe('Sign in to spend merits');
    expect(refusalText('sign_in_first', 'badge')).toBe('Sign in to wear a badge');
    expect(refusalText('sign_in_first', 'outfit')).toBe('Sign in to wear an outfit');
  });

  it('show in the status panel past level 20: how many to spend, and how far the next is', () => {
    expect(meritText(worth(3), 0)).toBe('3 to spend, 1,240 XP to the next');
    expect(meritText(worth(3), 3)).toBe('None to spend, 1,240 XP to the next');
    expect(meritText(worth(2), 0, true)).toBe('2 to spend once you sign in, 1,240 XP to the next');
    const rows = (xp: number, level = 20) => statusView({
      energy: null, body: { wet: 0, wetRate: 0, load: 0, hitched: false, worn: {} }, surge: null, caught: false, storm: null, flash: null, weather: 'overcast', wilds: false,
      stone: { charge: 0, need: 0, awake: false, left: 0 }, stats: {}, bag: [], items: ITEMS, progress: { ...progress(xp), level }, resists: null, wear: null, quirks: [],
      merits: { spent: 1, owned: ['fir'] },
    } satisfies StatusInput).rows;
    expect(rows(worth(3))[1]).toEqual({ label: 'Merits', text: '2 to spend, 1,240 XP to the next', bar: 260 / 1500, tone: 'good' });
    expect(rows(xpFor(19), 19).map(r => r.label)).not.toContain('Merits');
  });

  it('are news: a banner for each merit stashing earns, and level 20 says they come next', () => {
    expect(newsBanner({ kind: 'merit', earned: 1, left: 3 }, 'Home')).toEqual({ title: 'A merit', sub: 'Past level 20, every 1,500 XP earns one.\nYou have 3 to spend in the wardrobe at your chest.' });
    expect(newsBanner({ kind: 'merit', earned: 2, left: 2 }, 'Home', ITEMS, true)).toEqual({ title: '2 merits', sub: 'Past level 20, every 1,500 XP earns one.\nSign in to spend merits in the wardrobe at your chest.' });
    const top = newsBanner({ kind: 'level', progress: { ...progress(xpFor(20)), maxEnergy: 195 }, from: 19 }, 'Home')!;
    expect(top.sub).toBe('Your energy bar grows to 195.\nYou can go a little farther now.\nNew in your wardrobe: the residents\' patchwork.\nFrom here on, every 1,500 XP earns a merit.');
  });
});

describe('merits in the game', () => {
  /** A 5x4 room like home, the chest at 1,1: stand at 1,2, facing up. */
  const room = (): MapData => ({
    id: 'room', name: 'Home', version: 1, kind: 'inside', depth: 0, width: 5, height: 4,
    tiles: ['xxxxx', 'xpppx', 'xpppx', 'xxpxx'], levels: Array<string>(4).fill('00000'),
    spawn: { x: 1, y: 2, dir: 'up' }, exits: [{ x: 2, y: 3, w: 1, h: 1, to: 'town', tx: 3, ty: 1, dir: 'down' }],
    objects: [{ kind: 'chest', x: 1, y: 1 }],
  });
  const person = (id: string, more: Partial<PlayerView> = {}): PlayerView => ({ id, name: id, x: 1, y: 2, dir: 'up', color: '#f29e4c', gear: {}, quirks: [], ...more });
  let sent: ClientMsg[];
  let g: Game;
  const arrive = (xp: number, merits: MeritsView, players = [person('me')]) => {
    g.handle({ ...welcome(room(), players, FULL, { progress: progress(xp) }), merits }, 0);
    g.pressA();
    g.handle({ t: 'chest', stash: [] }, 0);
    sent.length = 0;
  };
  beforeEach(() => {
    sent = [];
    g = new Game(new Maps([tinyTown(), room()]), m => sent.push(m), ITEMS);
  });

  it('asks before spending a merit, sends it on YES, and says in the box what it bought', () => {
    arrive(worth(3), { spent: 0, owned: [] });
    g.buyLook('chevron');
    expect(g.askView()).toMatchObject({ who: 'Wardrobe', text: 'Spend a merit on the chevron pattern? You have 3.', choice: 'yes' });
    expect(sent).toEqual([]);
    g.pressA();
    expect(sent).toEqual([{ t: 'buy', x: 1, y: 1, look: 'chevron' }]);
    g.handle({ t: 'merits', merits: { spent: 1, owned: ['chevron'] } }, 0);
    g.handle({ t: 'did', did: { kind: 'bought', look: 'chevron', left: 2 } }, 0);
    expect(g.merits).toEqual({ spent: 1, owned: ['chevron'] });
    expect(g.note).toMatchObject({ who: 'Wardrobe', text: 'The chevron pattern is yours for good. 2 merits left to spend.', waiting: false });
  });

  it('says why when no merit can buy it, and sends nothing; NO sends nothing either', () => {
    arrive(worth(1), { spent: 1, owned: ['fir'] });
    g.buyLook('moth');
    expect(g.question).toBeNull();
    expect(g.note).toMatchObject({ who: 'Wardrobe', text: 'You have no merit to spend. 1,240 XP to the next.' });
    g.pressB();
    g.buyLook('fir');
    expect(g.note).toMatchObject({ text: 'It is yours already.' });
    arrive(worth(2), { spent: 0, owned: [] });
    g.buyLook('moth');
    g.pressB();
    expect(sent).toEqual([]);
    // What the server says no to is said in the same box.
    g.buyLook('moth');
    g.pressA();
    g.handle({ t: 'refused', action: 'buy', reason: 'no_merits' }, 0);
    expect(g.note).toMatchObject({ text: 'You have no merit to spend on it.' });
  });

  it('wears a pattern or a badge from the open chest only, asking nothing', () => {
    g.handle({ ...welcome(room(), [person('me')], FULL, { progress: progress(worth(2)) }), merits: { spent: 2, owned: ['stripes', 'moth'] } }, 0);
    g.wearLook('pattern', 'stripes');
    expect(sent).toEqual([]);
    g.pressA();
    g.handle({ t: 'chest', stash: [] }, 0);
    g.wearLook('pattern', 'stripes');
    g.wearLook('badge', 'moth');
    g.wearLook('badge', null);
    expect(g.question).toBeNull();
    expect(sent.slice(1)).toEqual([{ t: 'pattern', x: 1, y: 1, pattern: 'stripes' }, { t: 'badge', x: 1, y: 1, badge: 'moth' }, { t: 'badge', x: 1, y: 1, badge: null }]);
    g.handle({ t: 'refused', action: 'pattern', reason: 'not_owned' }, 0);
    expect(g.note).toMatchObject({ who: 'Wardrobe', text: 'It is not yours yet: spend a merit on it first.' });
    expect(g.floats).toEqual([]);
  });

  it('knows everyone\'s pattern and badge, from the welcome, as they come and as they change them, and draws the pattern', () => {
    arrive(0, { spent: 0, owned: [] }, [person('me', { pattern: 'checks', badge: 'fir' }), person('bea', { x: 3 })]);
    expect([g.myPattern, g.myBadge]).toEqual(['checks', 'fir']);
    g.handle({ t: 'pattern', id: 'bea', pattern: 'chevron' }, 0);
    g.handle({ t: 'badge', id: 'bea', badge: 'lamp' }, 0);
    expect([g.patterns.get('bea'), g.badges.get('bea')]).toEqual(['chevron', 'lamp']);
    g.handle({ t: 'badge', id: 'me', badge: null }, 0);
    expect(g.myBadge).toBeNull();
    g.handle({ t: 'join', player: person('cid', { x: 2, pattern: 'squares', badge: 'moth' }) }, 0);
    expect([g.patterns.get('cid'), g.badges.get('cid')]).toEqual(['squares', 'moth']);
    g.handle({ t: 'join', player: person('cid', { x: 2 }) }, 0);
    expect(g.patterns.has('cid') || g.badges.has('cid')).toBe(false);
    const looks = new Map(g.avatars().map(a => [a.id, a.look]));
    expect(looks.get('bea')).toMatchObject({ pattern: 'chevron' });
    expect(looks.get('me')).toMatchObject({ pattern: 'checks' });
  });

  it('makes news of each merit stashing earns, with how many are left to spend', () => {
    arrive(worth(1), { spent: 1, owned: ['fir'] });
    g.news = [];
    g.handle({ t: 'progress', progress: progress(worth(2)), gained: 1540 }, 0);
    expect(g.news).toEqual([{ kind: 'merit', earned: 1, left: 1 }]);
    g.news = [];
    g.handle({ t: 'progress', progress: progress(worth(2) + 100), gained: 100 }, 0);
    expect(g.news).toEqual([]);
  });
});

describe('a pattern as the world draws it', () => {
  it('has a drawing for every pattern, and none for one this copy does not have', () => {
    expect(Object.keys(PATTERN_LOOKS).sort()).toEqual(PATTERNS.map(p => p.id).sort());
    expect(dressOf('#3a86ff', { pattern: 'polka-dots' })).toEqual(dressOf('#3a86ff'));
    expect(lookOf({}, ITEMS, undefined, 'polka-dots')).toEqual(lookOf({}, ITEMS));
    expect(lookOf({}, ITEMS, 'rain-cape', 'chevron')).toEqual({ outfit: 'rain-cape', pattern: 'chevron' });
  });

  it('goes over the gear and over every outfit, on the body and on the sleeves, in a shade of their cloth', () => {
    for (const outfit of [undefined, ...OUTFITS.map(o => o.id).filter(o => o !== 'rain-cape')]) {
      const plain = dressOf('#3a86ff', { ...(outfit ? { outfit } : {}) });
      for (const p of PATTERNS) {
        const d = dressOf('#3a86ff', { ...(outfit ? { outfit } : {}), pattern: p.id });
        expect(d.parts.length, `${outfit} ${p.id}`).toBeGreaterThan(plain.parts.length);
        expect(d.armL.length + d.armR.length, `${outfit} ${p.id}`).toBeGreaterThan(0);
        // Nothing else changes: the cloth, the pack, what the head wears.
        expect({ ...d, parts: [], armL: [], armR: [] }).toEqual({ ...plain, parts: [], armL: [], armR: [] });
        expect(d.parts.slice(0, plain.parts.length)).toEqual(plain.parts);
      }
    }
    const stripes = dressOf('#f4f1de', { pattern: 'stripes' });
    expect(stripes.parts.at(-1)!.color).toBe(shadeOf('#f4f1de'));
  });

  it('goes on the bell of the rain cape, leaned back with it, and not on the arms the cape hides', () => {
    for (const p of PATTERNS) {
      const d = dressOf('#3a86ff', { outfit: 'rain-cape', pattern: p.id }), added = d.parts.slice(dressOf('#3a86ff', { outfit: 'rain-cape' }).parts.length);
      expect(added.length, p.id).toBeGreaterThan(0);
      expect([d.armL, d.armR], p.id).toEqual([[], []]);
      for (const part of added) {
        if ('box' in part) {
          expect(part.tilt, p.id).toBeLessThan(0);
          // Out on the bell's front, past the jacket it covers.
          expect(part.at[2], p.id).toBeGreaterThan(0.3);
        }
      }
    }
  });

  it('takes a shade darker on a light cloth, and lighter on a dark one', () => {
    expect(shadeOf('#f4f1de')).toBe('#97958a');
    expect(shadeOf('#2f5b3f')).toBe('#86a090');
    const light = new THREE.Color(shadeOf('#f1c40f')), dark = new THREE.Color(shadeOf('#3a4450'));
    expect(light.getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(new THREE.Color('#f1c40f').getHSL({ h: 0, s: 0, l: 0 }).l);
    expect(dark.getHSL({ h: 0, s: 0, l: 0 }).l).toBeGreaterThan(new THREE.Color('#3a4450').getHSL({ h: 0, s: 0, l: 0 }).l);
  });

  it('costs no more draw calls: ten meshes whatever the pattern, the outfit and the pack', () => {
    const meshes = (rig: ReturnType<typeof makePlayer>) => { let n = 0; rig.root.traverse(o => { if (o instanceof THREE.Mesh) n++; }); return n; };
    for (const outfit of [undefined, ...OUTFITS.map(o => o.id)]) {
      for (const pattern of PATTERNS.map(p => p.id)) {
        const rig = makePlayer('#3a86ff', { ...(outfit ? { outfit } : {}), pattern, bag: '#7a4a2a', bagSize: 1.4 });
        expect(meshes(rig), `${outfit} ${pattern}`).toBe(10);
        for (const part of [rig.legL, rig.legR, rig.armL, rig.armR]) expect(part.children).toHaveLength(2);
      }
    }
  });
});
