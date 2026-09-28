import { describe, expect, it } from 'vitest';
import type { BagSlot, Gear, ItemsData, Worn } from '@napoland/shared';
import {
  DOUBLE_TAP_MS, DOUBLE_TAP_SLOP, DoubleTap, actText, cardPress, detailView, listWords, pieceName, pieceStats, refKey, statText, tierName, type DetailRef, type DetailState, type DetailView,
} from '../src/details';
import { cardHtml } from '../src/hud';
import { Items, conditionText, slotName } from '../src/items';

const items = new Items({
  version: 1,
  items: [
    { id: 'cloth', name: 'Cloth scraps', kind: 'resource', stack: 10, xp: 2, weight: 0.1, fuel: 90, text: 'Dry.' },
    { id: 'resin', name: 'Fir resin', kind: 'resource', stack: 20, text: 'Sticky.' },
    { id: 'scrap', name: 'Scrap metal', kind: 'resource', stack: 10, text: 'Heavy.' },
    { id: 'worn-cap', name: 'Worn cap', kind: 'gear', stack: 1, slot: 'cap', tier: 'worn', color: '#d63b33', text: 'Faded.' },
    { id: 'worn-gloves', name: 'Fingerless gloves', kind: 'gear', stack: 1, slot: 'gloves', tier: 'worn', text: 'Knitted.' },
    { id: 'wool-cap', name: 'Wool cap', kind: 'gear', stack: 1, slot: 'cap', tier: 'sturdy', resist: { cold: 0.15 }, text: 'Thick.' },
    { id: 'raincoat', name: 'Raincoat', kind: 'gear', stack: 1, slot: 'shirt', tier: 'sturdy', color: '#e8c547', resist: { wind: 0.35, cold: 0.1 }, text: 'Yellow.' },
    { id: 'rubber-gloves', name: 'Rubber gloves', kind: 'gear', stack: 1, slot: 'gloves', tier: 'sturdy', resist: { electricity: 0.25 }, text: 'Thick.' },
    { id: 'storm-coat', name: 'Storm coat', kind: 'gear', stack: 1, slot: 'shirt', tier: 'rugged', resist: { wind: 0.45 }, bonus: 5, text: 'Waxed.' },
    { id: 'shard-cap', name: 'Shard-lined cap', kind: 'gear', stack: 1, slot: 'cap', tier: 'anomalous', resist: { radiation: 0.5 }, bonus: 10, text: 'It hums.' },
    { id: 'backpack', name: 'Backpack', kind: 'gear', stack: 1, slot: 'bag', tier: 'worn', bag: 8, text: 'A school backpack.' },
    { id: 'tote', name: 'Tote', kind: 'gear', stack: 1, slot: 'bag', tier: 'worn', bag: 4, text: 'Small.' },
    { id: 'hiking-pack', name: 'Hiking pack', kind: 'gear', stack: 1, slot: 'bag', tier: 'sturdy', bag: 12, text: 'Pockets.' },
  ],
  finds: [],
  recipes: [
    { id: 'raincoat', make: 'raincoat', needs: [{ item: 'cloth', count: 8 }, { item: 'resin', count: 4 }] },
    { id: 'rubber-gloves', make: 'rubber-gloves', needs: [{ item: 'resin', count: 6 }] },
  ],
  wear: { sturdy: 5400, rugged: 7200, anomalous: 10800 },
  mend: { sturdy: [{ item: 'cloth', count: 2 }, { item: 'scrap', count: 1 }], rugged: [{ item: 'cloth', count: 3 }, { item: 'scrap', count: 2 }] },
  quirks: [{ id: 'hum', name: 'Humming', text: 'It hums a minute before the region you are in grows restless.' }],
} satisfies ItemsData);

const WEARING: Gear = { cap: 'worn-cap', shirt: 'raincoat', gloves: 'worn-gloves', bag: 'backpack' };
const state = (o: Partial<DetailState> = {}): DetailState => ({ items, bag: [], stash: [], gear: WEARING, worn: { shirt: { cond: 0.4 }, cap: { cond: 1 }, gloves: { cond: 1 }, bag: { cond: 1 } }, ...o });
const view = (ref: DetailRef, o: Partial<DetailState> = {}): DetailView => detailView(ref, state(o))!;

describe('the double tap', () => {
  it('lets the first tap only look, and makes a second on the same thing within 350 ms the action', () => {
    const t = new DoubleTap();
    expect(t.tap('stash:raincoat:0', 1000, 50, 50)).toBe('first');
    expect(t.tap('stash:raincoat:0', 1000 + DOUBLE_TAP_MS, 52, 49)).toBe('second');
    // A third tap starts over: a triple tap never acts twice.
    expect(t.tap('stash:raincoat:0', 1000 + DOUBLE_TAP_MS + 100, 52, 49)).toBe('first');
  });

  it('is two taps when the second comes too late, or lands on something else', () => {
    const t = new DoubleTap();
    t.tap('worn:cap', 0, 10, 10);
    expect(t.tap('worn:cap', DOUBLE_TAP_MS + 1, 10, 10)).toBe('first');
    expect(t.tap('worn:shirt', DOUBLE_TAP_MS + 50, 12, 10)).toBe('first');
    t.clear();
    expect(t.tap('worn:shirt', DOUBLE_TAP_MS + 60, 12, 10)).toBe('first');
  });

  it('counts a second tap on the card that opened under the finger, only right where the first one was', () => {
    const t = new DoubleTap();
    t.tap('stash:cloth', 500, 100, 300);
    expect(t.tap(null, 700, 100 + DOUBLE_TAP_SLOP * 0.7, 300 + DOUBLE_TAP_SLOP * 0.7)).toBe('second');
    t.tap('stash:cloth', 2000, 100, 300);
    expect(t.tap(null, 2100, 100 + DOUBLE_TAP_SLOP + 1, 300)).toBe('none');
    t.tap('stash:cloth', 3000, 100, 300);
    expect(t.tap(null, 3000 + DOUBLE_TAP_MS + 1, 100, 300)).toBe('none');
    // A tap on the card with nothing tapped before is just a tap on the card.
    expect(new DoubleTap().tap(null, 10, 0, 0)).toBe('none');
  });

  it('names what was tapped the same way however the list is drawn', () => {
    expect(refKey({ from: 'stash', item: 'raincoat', n: 1 })).toBe('stash:raincoat:1');
    expect(refKey({ from: 'stash', item: 'cloth' })).toBe('stash:cloth');
    expect(refKey({ from: 'bag', slot: 2, item: 'resin' })).toBe('bag:2:resin');
    expect(refKey({ from: 'worn', slot: 'cap' })).toBe('worn:cap');
    expect(refKey({ from: 'recipe', id: 'raincoat' })).toBe('recipe:raincoat');
    expect(refKey({ from: 'mend', slot: 'shirt' })).toBe('mend:shirt');
  });
});

describe('the words on a card', () => {
  it('names a piece, with room for a level from upgrades', () => {
    expect(pieceName(items.get('raincoat'))).toBe('Raincoat');
    expect(pieceName(items.get('raincoat'), 3)).toBe('Raincoat +3');
    expect(tierName('expedition')).toBe('Expedition');
    expect(slotName('gloves')).toBe('Gloves slot');
  });

  it('says how worn a piece is in plain words, and when it protects less or nothing', () => {
    expect(conditionText(1)).toBe('Like new');
    expect(conditionText(0.996)).toBe('Like new');
    expect(conditionText(0.4)).toBe('Worn: 40% left');
    expect(conditionText(0.2)).toBe('Worn: 20% left, and it protects less until it is mended');
    expect(conditionText(0.004)).toBe('Worn: 1% left, and it protects less until it is mended');
    expect(conditionText(0)).toBe('Worn out: it protects nothing until it is mended');
    expect(conditionText(0.3, false)).toBe('Never wears out');
  });

  it('gives what a piece resists and adds as worn as it is, and what it gives whole', () => {
    const coat = items.get('raincoat');
    expect(pieceStats(coat).map(statText)).toEqual(['Wind 35%', 'Cold 10%']);
    // Below a quarter left it protects less: at 10%, 40% of it.
    expect(pieceStats(coat, 0.1).map(statText)).toEqual(['Wind 14% (35% when mended)', 'Cold 4% (10% when mended)']);
    expect(pieceStats(coat, 0).map(statText)).toEqual(['Wind 0% (35% when mended)', 'Cold 0% (10% when mended)']);
    expect(pieceStats(items.get('storm-coat'), 0.125).map(statText)).toEqual(['Wind 23% (45% when mended)', '+3 energy (+5 when mended)']);
    expect(pieceStats(items.get('hiking-pack')).map(statText)).toEqual(['Holds 12 things']);
    expect(pieceStats(items.get('worn-cap')).map(s => [s.kind, s.text])).toEqual([['none', 'Resists nothing']]);
  });

  it('lists what is missing the way people say it', () => {
    expect(listWords(['cloth scraps'])).toBe('cloth scraps');
    expect(listWords(['cloth scraps', 'fir resin'])).toBe('cloth scraps and fir resin');
    expect(listWords(['a', 'b', 'c'])).toBe('a, b and c');
  });
});

describe('the card of a piece in the stash', () => {
  const stash: BagSlot[] = [
    { item: 'cloth', count: 23 },
    { item: 'wool-cap', count: 1, piece: { cond: 1 } },
    { item: 'raincoat', count: 1, piece: { cond: 1 } },
    { item: 'raincoat', count: 1, piece: { cond: 0 } },
    { item: 'rubber-gloves', count: 1, piece: { cond: 0.6 } },
    { item: 'shard-cap', count: 1, piece: { cond: 1, quirk: 'hum' } },
    { item: 'tote', count: 1, piece: { cond: 1 } },
    { item: 'hiking-pack', count: 1, piece: { cond: 1 } },
  ];

  it('shows what it is: its color, name, tier, slot, what it resists and how worn', () => {
    const v = view({ from: 'stash', item: 'raincoat', n: 0 }, { stash });
    expect(v).toMatchObject({ name: 'Raincoat', tier: { id: 'sturdy', name: 'Sturdy' }, slot: 'Shirt slot', text: 'Yellow.' });
    expect(v.icon).toContain('#e8c547');
    expect(v.stats.map(statText)).toEqual(['Wind 35%', 'Cold 10%']);
    expect(v.cond).toEqual({ share: 1, words: 'Like new', low: false, bar: true });
    expect(v.notes).toEqual([]);
  });

  it('wears it with its button, saying what goes into the stash in its place', () => {
    expect(actText(view({ from: 'stash', item: 'wool-cap', n: 0 }, { stash }).act!)).toBe('Wear (your worn cap goes into the stash)');
    expect(actText(view({ from: 'stash', item: 'rubber-gloves', n: 0 }, { stash }).act!)).toBe('Wear (your fingerless gloves go into the stash)');
    expect(view({ from: 'stash', item: 'rubber-gloves', n: 0 }, { stash }).act!.does).toEqual({ kind: 'wear', item: 'rubber-gloves', n: 0 });
    // Nothing worn there: it just goes on.
    expect(actText(view({ from: 'stash', item: 'wool-cap', n: 0 }, { stash, gear: { bag: 'backpack' } }).act!)).toBe('Wear');
  });

  it('picks the piece tapped among several of a kind, and says a worn-out one can be mended once worn', () => {
    const v = view({ from: 'stash', item: 'raincoat', n: 1 }, { stash });
    expect(v.act!.does).toEqual({ kind: 'wear', item: 'raincoat', n: 1 });
    expect(v.cond).toMatchObject({ words: 'Worn out: it protects nothing until it is mended', low: true });
    expect(v.stats.map(statText)).toEqual(['Wind 0% (35% when mended)', 'Cold 0% (10% when mended)']);
    expect(v.notes.map(n => n.text)).toEqual(['Wear it, and it can be mended at the workbench beside the chest.']);
  });

  it('shows a quirk and what it does, and the energy a piece adds', () => {
    const v = view({ from: 'stash', item: 'shard-cap', n: 0 }, { stash });
    expect(v.quirk).toEqual({ name: 'Humming', text: 'It hums a minute before the region you are in grows restless.' });
    expect(v.tier!.name).toBe('Anomalous');
    expect(v.stats.map(statText)).toEqual(['Radiation 50%', '+10 energy']);
  });

  it('will not put on a bag too small for what you carry, and says why', () => {
    const bag = Array.from({ length: 6 }, (): BagSlot => ({ item: 'cloth', count: 1 }));
    const v = view({ from: 'stash', item: 'tote', n: 0 }, { stash, bag });
    expect(v.act).toMatchObject({ label: 'Wear', then: 'your backpack goes into the stash', enabled: false });
    expect(v.notes).toEqual([{ text: 'It holds 4 things, and you carry 6. Put 2 away first.', tone: 'bad' }]);
    expect(view({ from: 'stash', item: 'hiking-pack', n: 0 }, { stash, bag }).act!.enabled).toBe(true);
    expect(view({ from: 'stash', item: 'hiking-pack', n: 0 }, { stash }).cond).toEqual({ share: 1, words: 'Never wears out', low: false, bar: false });
  });

  it('takes out a stack of anything else, and shows it as the bag does', () => {
    const v = view({ from: 'stash', item: 'cloth' }, { stash });
    expect(v).toMatchObject({ name: 'Cloth scraps', count: 23, facts: ['2 XP at home', '100 g', 'Burns 2 min'] });
    expect(v.act).toMatchObject({ label: 'Take out 10', enabled: true, does: { kind: 'take', item: 'cloth' } });
    expect(view({ from: 'stash', item: 'cloth' }, { stash: [{ item: 'cloth', count: 1 }] }).act!.label).toBe('Take it out');
  });

  it('is gone once what it showed is not there any more', () => {
    expect(detailView({ from: 'stash', item: 'raincoat', n: 2 }, state({ stash }))).toBeNull();
    expect(detailView({ from: 'stash', item: 'resin' }, state({ stash }))).toBeNull();
  });
});

describe('the card of what you wear', () => {
  it('takes it off into the stash', () => {
    const v = view({ from: 'worn', slot: 'shirt' });
    expect(v.cond).toMatchObject({ share: 0.4, words: 'Worn: 40% left', low: false });
    expect(actText(v.act!)).toBe('Take off (it goes into the stash)');
    expect(v.act!.does).toEqual({ kind: 'off', slot: 'shirt' });
    expect(actText(view({ from: 'worn', slot: 'gloves' }).act!)).toBe('Take off (they go into the stash)');
  });

  it('says where to mend a piece worn so far it protects less', () => {
    const v = view({ from: 'worn', slot: 'shirt' }, { worn: { shirt: { cond: 0 } } });
    expect(v.notes.map(n => n.text)).toEqual(['It can be mended at the workbench beside the chest.']);
    // Worn clothes never wear, so there is nothing to mend.
    expect(view({ from: 'worn', slot: 'cap' }).notes).toEqual([]);
  });

  it('never takes the bag off: it says how to change it instead', () => {
    const v = view({ from: 'worn', slot: 'bag' });
    expect(v.act).toBeUndefined();
    expect(v.notes.map(n => n.text)).toEqual(['You always carry a bag, so it cannot be taken off. To change it, wear another one from the stash.']);
    expect(v.stats.map(statText)).toEqual(['Holds 8 things']);
  });

  it('closes when nothing is worn there', () => {
    expect(detailView({ from: 'worn', slot: 'pants' }, state())).toBeNull();
  });
});

describe('the card of a slot of your bag, in the chest', () => {
  it('puts it away', () => {
    const v = view({ from: 'bag', slot: 1, item: 'resin' }, { bag: [{ item: 'cloth', count: 2 }, { item: 'resin', count: 5 }] });
    expect(v).toMatchObject({ name: 'Fir resin', count: 5, act: { label: 'Put away', enabled: true, does: { kind: 'store', slot: 1 } } });
  });

  it('shows gear from a strange object as gear, to wear once it is in the stash', () => {
    const v = view({ from: 'bag', slot: 0, item: 'shard-cap' }, { bag: [{ item: 'shard-cap', count: 1 }] });
    expect(v.stats.map(statText)).toEqual(['Radiation 50%', '+10 energy']);
    expect(v.cond).toBeUndefined();
    expect(v.notes.map(n => n.text)).toEqual(['Put it away, then wear it from the stash.']);
  });

  it('closes when the slot holds something else now', () => {
    expect(detailView({ from: 'bag', slot: 0, item: 'resin' }, state({ bag: [{ item: 'cloth', count: 1 }] }))).toBeNull();
  });
});

describe('the cards at the workbench', () => {
  it('shows what a recipe makes, what it takes and what you have of each, and makes it', () => {
    const v = view({ from: 'recipe', id: 'raincoat' }, { stash: [{ item: 'cloth', count: 9 }, { item: 'resin', count: 4 }] });
    expect(v).toMatchObject({ name: 'Raincoat', tier: { name: 'Sturdy' }, slot: 'Shirt slot' });
    expect(v.stats.map(statText)).toEqual(['Wind 35%', 'Cold 10%']);
    expect(v.cond).toBeUndefined();
    expect(v.costs).toEqual({ title: 'It takes', needs: [
      { item: 'cloth', name: 'Cloth scraps', icon: expect.any(String), have: 9, need: 8 },
      { item: 'resin', name: 'Fir resin', icon: expect.any(String), have: 4, need: 4 },
    ] });
    expect(v.act).toMatchObject({ label: 'Make', enabled: true, does: { kind: 'make', recipe: 'raincoat' } });
    expect(v.notes).toEqual([]);
  });

  it('says what the stash is short of, and cannot make it then', () => {
    const v = view({ from: 'recipe', id: 'raincoat' }, { stash: [{ item: 'cloth', count: 3 }] });
    expect(v.act!.enabled).toBe(false);
    expect(v.notes).toEqual([{ text: 'Your stash is short of cloth scraps and fir resin.', tone: 'bad' }]);
  });

  it('shows the piece to mend, as worn as it is, what mending takes, and mends it', () => {
    const v = view({ from: 'mend', slot: 'shirt' }, { stash: [{ item: 'cloth', count: 2 }, { item: 'scrap', count: 1 }] });
    expect(v).toMatchObject({ name: 'Raincoat', cond: { words: 'Worn: 40% left' } });
    expect(v.costs!.title).toBe('Mending takes');
    expect(v.act).toMatchObject({ label: 'Mend', enabled: true, does: { kind: 'mend', slot: 'shirt' } });
    expect(v.notes.map(n => n.text)).toEqual(['Mended, it is like new again.']);
  });

  it('makes and mends through the game when pressed, even greyed out: it asks first, or says in the text box what the stash lacks', () => {
    const ready = view({ from: 'recipe', id: 'raincoat' }, { stash: [{ item: 'cloth', count: 8 }, { item: 'resin', count: 4 }] });
    expect(cardPress(ready)).toEqual({ does: { kind: 'make', recipe: 'raincoat' }, close: true, shake: false });
    // Short: the button shakes and the card stays, and the game still hears it (and sends nothing).
    expect(cardPress(view({ from: 'recipe', id: 'raincoat' }))).toEqual({ does: { kind: 'make', recipe: 'raincoat' }, close: false, shake: true });
    expect(cardPress(view({ from: 'mend', slot: 'shirt' }))).toEqual({ does: { kind: 'mend', slot: 'shirt' }, close: false, shake: true });
    // Anything else greyed out only shakes: a bag too small for what you carry is not worn.
    const tote = view({ from: 'stash', item: 'tote', n: 0 }, { stash: [{ item: 'tote', count: 1, piece: { cond: 1 } }], bag: Array.from({ length: 6 }, () => ({ item: 'cloth', count: 1 })) });
    expect(tote.act!.enabled).toBe(false);
    expect(cardPress(tote)).toEqual({ close: false, shake: true });
    // Nothing to do (the bag you wear): the card just stays.
    expect(cardPress(view({ from: 'worn', slot: 'bag' }))).toEqual({ close: false, shake: false });
  });

  it('has nothing to mend once it is whole, or in what never wears', () => {
    expect(detailView({ from: 'mend', slot: 'shirt' }, state({ worn: { shirt: { cond: 1 } } }))).toBeNull();
    expect(detailView({ from: 'mend', slot: 'cap' }, state())).toBeNull();
    expect(detailView({ from: 'recipe', id: 'nothing' }, state())).toBeNull();
  });
});

describe('a card on the page', () => {
  it('draws the button with what it does, and greys it out when it cannot', () => {
    const html = cardHtml(view({ from: 'stash', item: 'wool-cap', n: 0 }, { stash: [{ item: 'wool-cap', count: 1, piece: { cond: 1 } }] }));
    expect(html).toContain('data-card-act>Wear <span class="then">(your worn cap goes into the stash)</span></button>');
    expect(html).toContain('<span class="tier" data-tier="sturdy">Sturdy</span>');
    expect(html).toContain('<li data-kind="cold" aria-label="Cold 15%">Cold 15%</li>');
    const short = cardHtml(view({ from: 'recipe', id: 'raincoat' }));
    expect(short).toContain('data-card-act aria-disabled="true">Make</button>');
    expect(short).toMatch(/<span class="cost" data-short aria-label="Cloth scraps: it takes 8, you have 0">/);
  });

  it('strikes through what wear cut, and draws the bar only for gear that wears', () => {
    const worn: Worn = { shirt: { cond: 0.1 } };
    const html = cardHtml(view({ from: 'worn', slot: 'shirt' }, { worn }));
    expect(html).toContain('Wind 14%<s>35%</s>');
    expect(html).toContain('<span class="cbar" aria-hidden="true"><i style="transform:scaleX(0.100)"></i></span>');
    expect(cardHtml(view({ from: 'worn', slot: 'bag' }))).not.toContain('cbar');
    expect(cardHtml(view({ from: 'worn', slot: 'bag' }))).not.toContain('data-card-act');
  });

  it('keeps what content says from becoming markup', () => {
    const odd = new Items({ version: 1, items: [{ id: 'odd', name: 'A <b>bold</b> "cap"', kind: 'gear', stack: 1, slot: 'cap', text: '<script>' }], finds: [] });
    const html = cardHtml(detailView({ from: 'worn', slot: 'cap' }, { items: odd, bag: [], stash: [], gear: { cap: 'odd' }, worn: {} })!);
    expect(html).not.toContain('<script>');
    expect(html).toContain('A &lt;b&gt;bold&lt;/b&gt; &quot;cap&quot;');
  });
});
