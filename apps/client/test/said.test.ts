import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Did, ItemsData, StoneView } from '@napoland/shared';
import { Items } from '../src/items';
import {
  GONE, INDOORS, MARKED, NO_ROOM, TENDED, TOO_DARK, aOf, amount, counted, didText, didWho, feedQuestion, fullFire, howLong, listOf, makeQuestion, mendQuestion, noShard, nothingToBurn,
  nounOf, pluralOf, sentence, shortOf, stashShort, stoneQuestion, tossQuestion, useQuestion,
} from '../src/said';

/** What players read comes from the real items, so it is tested with them. */
const content = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/items.json'), 'utf8')) as ItemsData;
const items = new Items(content);
const item = (id: string) => items.get(id);
const recipe = (id: string) => items.recipes.find(r => r.id === id)!;
const asleep = (charge: number): StoneView => ({ charge, need: 20, awake: false, left: 0 });

describe('naming things in a sentence', () => {
  it('says the short word for an item, and several of it', () => {
    expect([nounOf(item('resin')), pluralOf(item('resin'))]).toEqual(['resin', 'resin']);
    expect([nounOf(item('shard')), pluralOf(item('shard'))]).toEqual(['shard', 'shards']);
    expect([nounOf(item('flare')), pluralOf(item('flare'))]).toEqual(['road flare', 'road flares']);
    expect(pluralOf(item('thermos'))).toBe('thermoses');
    // A name that ends in s names a pair: the same word for one and for several.
    expect(pluralOf(item('rubber-gloves'))).toBe('rubber gloves');
    // Names keep their capitals past the first letter.
    expect(nounOf(item('stonebrook-map'))).toBe('map of Stonebrook');
  });

  it('counts what is counted one by one, and says a heap or a pair without "a"', () => {
    expect([aOf(item('glowcap')), aOf(item('expedition-pack')), aOf(item('resin')), aOf(item('rubber-gloves'))]).toEqual(['a glowcap', 'an expedition pack', 'resin', 'rubber gloves']);
    expect([amount(item('glowcap'), 1), amount(item('glowcap'), 3), amount(item('resin'), 1), amount(item('resin'), 3)]).toEqual(['a glowcap', '3 glowcaps', '1 resin', '3 resin']);
    expect([counted(item('scrap'), 1), counted(item('shard'), 2), counted(item('cloth'), 8)]).toEqual(['1 scrap', '2 shards', '8 cloth']);
    expect([listOf([]), listOf(['a']), listOf(['a', 'b']), listOf(['a', 'b', 'c'], 'or')]).toEqual(['', 'a', 'a and b', 'a, b or c']);
  });

  it('says how long as people do', () => {
    expect([howLong(1), howLong(45), howLong(600), howLong(3600), howLong(5400), howLong(7200), howLong(37_800), howLong(86_400), howLong(3 * 86_400)])
      .toEqual(['1 second', '45 seconds', '10 minutes', 'an hour', 'an hour and a half', '2 hours', '10 and a half hours', 'a day', '3 days']);
  });
});

describe('the questions', () => {
  it('at a fire and at the Old Stone', () => {
    expect(feedQuestion(item('resin'))).toBe('Feed the fire resin?');
    expect(feedQuestion(item('cloth'))).toBe('Feed the fire cloth?');
    expect(stoneQuestion(item('shard'), 1)).toBe('Give the Old Stone a shard?');
    expect(stoneQuestion(item('shard'), 3)).toBe('Give the Old Stone 3 shards?');
    expect(stoneQuestion(item('live-shard'), 1)).toBe('Give the Old Stone a live shard?');
  });

  it('for what is used from the bag, with numbers from the items', () => {
    expect(useQuestion(item('thermos'), { value: 40, max: 100, rate: -0.3 })).toBe('Drink the thermos? +30 energy.');
    expect(useQuestion(item('thermos'), { value: 88, max: 100, rate: 0 })).toBe('Drink the thermos? Only +12 energy: your bar is nearly full.');
    expect(useQuestion(item('thermos'), { value: 100, max: 100, rate: 0 })).toBe('Drink the thermos? Your energy is full already.');
    expect(useQuestion(item('flare'), null)).toBe('Light a road flare? It burns 45 seconds.');
    expect(useQuestion(item('glowcap'), null)).toBe('Crush a glowcap to paint an arrow where you face?');
    expect(useQuestion(item('strange'), null)).toBe('Look closely at the strange object? It will be used up.');
  });

  it('before throwing something away: how many of how many', () => {
    expect(tossQuestion(item('resin'), 3, 12)).toBe('Throw away 3 resin? It is gone for good.');
    expect(tossQuestion(item('resin'), 12, 12)).toBe('Throw away all 12 resin? It is gone for good.');
    expect(tossQuestion(item('glowcap'), 1, 5)).toBe('Throw away a glowcap? It is gone for good.');
    expect(tossQuestion(item('glowcap'), 3, 5)).toBe('Throw away 3 glowcaps? They are gone for good.');
    expect(tossQuestion(item('thermos'), 1, 1)).toBe('Throw away the thermos? It is gone for good.');
  });

  it('at the workbench, from the recipes and what mending costs', () => {
    expect(makeQuestion(recipe('raincoat'), items)).toBe('Make a raincoat? It uses 8 cloth and 4 resin.');
    expect(makeQuestion(recipe('hiking-pack'), items)).toBe('Make a hiking pack? It uses 10 cloth, 4 scrap and 3 wire.');
    expect(makeQuestion(recipe('rubber-gloves'), items)).toBe('Make rubber gloves? It uses 6 resin and 2 cloth.');
    expect(makeQuestion(recipe('storm-coat'), items)).toBe('Make a storm coat? It uses 12 cloth, 4 wire, 4 resin and 1 shard.');
    expect(makeQuestion({ id: 'caps', make: 'wool-cap', count: 2, needs: [{ item: 'cloth', count: 1 }] }, items)).toBe('Make 2 wool caps? It uses 1 cloth.');
    expect(mendQuestion(item('raincoat'), content.mend!.sturdy!, items)).toBe('Mend your raincoat? It uses 2 cloth and 1 scrap.');
    expect(mendQuestion(item('shard-cap'), content.mend!.anomalous!, items)).toBe('Mend your shard-lined cap? It uses 2 scrap and 1 shard.');
  });
});

describe('why it cannot happen', () => {
  it('at a fire someone keeps, one that is full, and with nothing that burns', () => {
    expect(TENDED).toBe('Someone keeps this fire going. It needs nothing.');
    expect(fullFire(1799.4)).toBe('The fire is as full as it gets. It will burn 30 more minutes.');
    const fuels = [item('resin'), item('cloth')];
    expect(nothingToBurn(600, fuels)).toBe('It will burn 10 more minutes. You have nothing that burns.');
    expect(nothingToBurn(40, fuels)).toBe('It will burn under a minute more. You have nothing that burns.');
    expect(nothingToBurn(0, fuels)).toBe('The fire is out. Bring something that burns: resin or cloth.');
    expect(nothingToBurn(0, [])).toBe('The fire is out, and you have nothing that burns.');
  });

  it('at the Old Stone without a shard: how it stands', () => {
    expect(noShard(asleep(13))).toBe('The Old Stone sleeps: 13 of 20 shards. You have no shard to give it.');
    expect(noShard({ charge: 4, need: 20, awake: true, left: 7200 })).toBe('The Old Stone is awake for 2 hours more. You have no shard to give it.');
  });

  it('in the bag, and at the workbench: what the stash lacks', () => {
    for (const t of [TOO_DARK, INDOORS, MARKED, NO_ROOM, GONE]) expect(t).toMatch(/^[A-Z][^]*\.$/);
    const short = shortOf(recipe('raincoat').needs, [{ item: 'cloth', count: 5 }, { item: 'scrap', count: 9 }]);
    expect(short).toEqual([{ item: 'cloth', count: 3 }, { item: 'resin', count: 4 }]);
    expect(stashShort(short, items, { make: item('raincoat') })).toBe('Your stash is short of 3 cloth and 4 resin for a raincoat.');
    expect(stashShort([{ item: 'scrap', count: 1 }], items, { mend: item('rubber-gloves') })).toBe('Your stash is short of 1 scrap to mend your rubber gloves.');
    expect(shortOf(recipe('raincoat').needs, [{ item: 'cloth', count: 5 }, { item: 'cloth', count: 3 }, { item: 'resin', count: 4 }])).toEqual([]);
    expect(sentence('The fire is as big as it gets')).toBe('The fire is as big as it gets.');
    expect(sentence('Too far?')).toBe('Too far?');
  });
});

describe('what it did, from the server\'s answer', () => {
  const said = (did: Did) => [didWho(did, items), didText(did, items)];

  it('at a fire: how many it took and how long it burns now', () => {
    expect(said({ kind: 'fire', item: 'resin', count: 3, left: 1080 })).toEqual(['Fire', 'The fire takes 3 resin. It will burn 18 more minutes.']);
    expect(didText({ kind: 'fire', item: 'cloth', count: 1, left: 90, lit: true }, items)).toBe('The fire takes 1 cloth and catches again. It will burn 2 more minutes.');
    expect(didText({ kind: 'fire', item: 'resin', count: 6, left: 1800 }, items)).toBe('The fire takes 6 resin. It is full: it will burn 30 more minutes.');
  });

  it('at the Old Stone: how close it is to waking, that it wakes, or how long it stays awake', () => {
    expect(said({ kind: 'stone', item: 'shard', count: 1, stone: asleep(13) })).toEqual(['The Old Stone', 'The Old Stone takes the shard: 13 of 20.']);
    expect(didText({ kind: 'stone', item: 'shard', count: 3, stone: { charge: 21, need: 20, awake: true, left: 37_800 }, woke: true }, items)).toBe('The Old Stone takes 3 shards: 20 of 20. It wakes.');
    expect(didText({ kind: 'stone', item: 'live-shard', count: 1, stone: { charge: 22, need: 20, awake: true, left: 39_600 } }, items)).toBe('The Old Stone takes the live shard. It stays awake 11 hours more.');
  });

  it('for what was used: the energy it gave, a flare, a mark, and what a strange object turned out to be', () => {
    expect(said({ kind: 'used', item: 'thermos', energy: 30 })).toEqual(['Thermos', 'You drink the thermos: +30 energy.']);
    expect(didText({ kind: 'used', item: 'thermos', energy: 0 }, items)).toBe('You drink the thermos, but your energy was full already.');
    expect(didText({ kind: 'used', item: 'flare', flare: 45 }, items)).toBe('The road flare hisses red. For 45 seconds, nothing comes near you.');
    expect(didText({ kind: 'used', item: 'glowcap', mark: { dir: 'left', left: 86_400 } }, items)).toBe('You crush the glowcap. An arrow glows where you stand, pointing west. Everyone sees it for a day.');
    expect(said({ kind: 'used', item: 'strange', into: { item: 'hollow-feather', count: 1 } })).toEqual(['Strange object', 'It turns out to be a hollow feather. While it is in your bag, what you carry feels lighter.']);
    expect(didText({ kind: 'used', item: 'strange', into: { item: 'shard', count: 2 } }, items)).toBe('It turns out to be 2 shards. The Old Stone in town wants shards back: enough of them wake it.');
    expect(didText({ kind: 'used', item: 'thermos' }, items)).toBe('You use the thermos.');
  });

  it('at the workbench, and for what was thrown away', () => {
    expect(said({ kind: 'made', item: 'raincoat', count: 1 })).toEqual(['Workbench', 'You make a raincoat. It waits in your stash: put it on at the chest.']);
    expect(didText({ kind: 'made', item: 'rubber-gloves', count: 1 }, items)).toBe('You make rubber gloves. They wait in your stash: put them on at the chest.');
    expect(said({ kind: 'mended', item: 'raincoat' })).toEqual(['Workbench', 'You mend your raincoat: as good as new.']);
    expect(said({ kind: 'thrown', item: 'resin', count: 3 })).toEqual(['Fir resin', 'You throw away 3 resin.']);
    expect(didText({ kind: 'thrown', item: 'glowcap', count: 1 }, items)).toBe('You throw away a glowcap.');
  });

  it('says what anything a strange object turns into is good for, with the numbers its item has', () => {
    const into = new Set(content.items.flatMap(i => i.reveals ?? []).map(r => r.item));
    expect(into.size).toBeGreaterThan(0);
    for (const id of into) expect(item(id).about, id).toMatch(/^[A-Z].*\.$/);
    // Lines that name a number name the item's own.
    expect(item('thermos').about).toContain(`${item('thermos').use!.energy} energy`);
    expect(item('flare').about).toContain(`${item('flare').use!.flare} seconds`);
  });
});
