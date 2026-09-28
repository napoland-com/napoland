/**
 * Gear upgrades at the workbench, over real WebSockets: every level's cost paid from the stash, the
 * odds from +7 (the server's dice, set here), a failure that spends the materials and keeps the level,
 * what cannot be upgraded, levels kept across a save, and a level that travels with a carried piece
 * into a pile and back. The fixture maps (fixtures.ts) with a workbench in the house; a game clock that
 * only moves when a test moves it.
 */
import { describe, expect, it } from 'vitest';
import { STEP_MS, TileMap, type Dir, type ItemsData, type ServerMsg, type Slot, type Stash } from '@napoland/shared';
import { houseData, itemsData, townData, woodsData } from './fixtures';
import { nobodyCame, setup, waitFor, type Client } from './helpers';

/** A workbench at 1,1 in the house (stand at 1,2), a chest at 3,1 (stand at 3,2). */
const maps = () => [
  new TileMap(townData()),
  new TileMap({ ...houseData(), objects: [...houseData().objects, { kind: 'chest', x: 3, y: 1 }, { kind: 'workbench', x: 1, y: 1 }] }),
  new TileMap(woodsData()),
];
const gear = (id: string, slot: Slot, more: object = {}) => ({ id, name: id, kind: 'gear' as const, stack: 1, text: 'Gear.', slot, ...more });
const res = (id: string) => ({ id, name: id, kind: 'resource' as const, stack: 99, text: 'Stuff.' });
/** What each level costs, as the brief sets it (content/items.json has the same: the shared tests check it). */
const UPGRADES: NonNullable<ItemsData['upgrades']> = [
  { needs: [{ item: 'scrap', count: 2 }, { item: 'cloth', count: 2 }] },
  { needs: [{ item: 'scrap', count: 3 }, { item: 'cloth', count: 2 }, { item: 'wire', count: 1 }] },
  { needs: [{ item: 'scrap', count: 4 }, { item: 'cloth', count: 3 }, { item: 'wire', count: 2 }] },
  { needs: [{ item: 'scrap', count: 4 }, { item: 'wire', count: 2 }, { item: 'shard', count: 1 }] },
  { needs: [{ item: 'scrap', count: 5 }, { item: 'wire', count: 3 }, { item: 'shard', count: 2 }] },
  { needs: [{ item: 'scrap', count: 6 }, { item: 'wire', count: 4 }, { item: 'shard', count: 3 }] },
  { needs: [{ item: 'shard', count: 4 }, { item: 'strange', count: 1 }], chance: 0.7 },
  { needs: [{ item: 'shard', count: 5 }, { item: 'strange', count: 2 }], chance: 0.5 },
  { needs: [{ item: 'shard', count: 6 }, { item: 'strange', count: 3 }], chance: 0.3 },
];
const items = (): ItemsData => ({
  ...itemsData(),
  items: [
    ...itemsData().items,
    gear('worn-cap', 'cap', { tier: 'worn' }), gear('worn-shirt', 'shirt', { tier: 'worn' }), gear('worn-gloves', 'gloves', { tier: 'worn' }), gear('worn-pants', 'pants', { tier: 'worn' }),
    gear('worn-shoes', 'shoes', { tier: 'worn' }), gear('backpack', 'bag', { tier: 'worn', bag: 8 }),
    gear('coat', 'shirt', { tier: 'sturdy', resist: { wind: 0.4 } }),
    gear('halo', 'cap', { tier: 'anomalous', resist: { radiation: 0.5 } }),
    res('scrap'), res('cloth'), res('wire'), res('shard'), res('strange'),
  ],
  wear: { sturdy: 100, anomalous: 300 },
  quirks: [{ id: 'footprints', name: 'Glowing steps', text: 'Glows.' }, { id: 'flicker', name: 'Flicker', text: 'Flickers.' }, { id: 'hum', name: 'Humming', text: 'Hums.' }],
  upgrades: UPGRADES,
});
const PLENTY = { scrap: 99, cloth: 99, wire: 99, shard: 99, strange: 99 };
const BENCH = { x: 1, y: 1 };

describe('gear upgrades, over the network', () => {
  let now = 1_000_000;
  let seq = 0;
  /** The server's dice: 0 makes every upgrade take, 0.99 makes one from +7 fail. */
  let dice = 0;
  const { ctx, enter, login } = setup({ maps: maps(), items: items(), weather: 'overcast', clock: () => now, rng: () => dice });
  /** Everything the client heard up to now (in the house energy holds, so nothing repeats). */
  const heard = (c: Client) => c.settle();
  const dids = (msgs: ServerMsg[]) => msgs.flatMap(m => (m.t === 'did' ? [m.did] : []));
  async function walk(c: Client, ...dirs: Dir[]) {
    for (const dir of dirs) {
      const s = ++seq;
      c.send({ t: 'step', dir, seq: s });
      await c.next('step', m => m.seq === s);
      now += STEP_MS;
    }
  }

  it('pays every level from +1 to +9 exactly as the data says, and the piece resists more each time', async () => {
    dice = 0;
    const a = await enter({ map: 'house', x: 1, y: 2, dir: 'up', gear: { shirt: 'coat', bag: 'backpack' }, worn: { shirt: { cond: 0.5 } }, stash: { items: { ...PLENTY }, out: {} } });
    await a.c.settle();
    let had: Record<string, number> = { ...PLENTY };
    for (let level = 1; level <= 9; level++) {
      a.c.send({ t: 'upgrade', ...BENCH, of: { from: 'worn', slot: 'shirt' } });
      const msgs = await heard(a.c);
      expect(dids(msgs)).toEqual([{ kind: 'upgraded', item: 'coat', level }]);
      // Its condition stays as it was; only its level moves.
      expect(msgs.find(m => m.t === 'energy')).toMatchObject({ body: { worn: { shirt: { cond: 0.5, level } } } });
      const stash = ctx.server.world.get(a.id)!.stash!;
      for (const n of UPGRADES[level - 1]!.needs) had = { ...had, [n.item]: had[n.item]! - n.count };
      expect(stash.items).toEqual(had);
    }
    // All nine: 24 scrap, 7 cloth, 12 wire, 21 shards and 6 strange objects.
    expect(had).toEqual({ scrap: 75, cloth: 92, wire: 87, shard: 78, strange: 93 });
    // +9 is the top.
    a.c.send({ t: 'upgrade', ...BENCH, of: { from: 'worn', slot: 'shirt' } });
    expect(await heard(a.c)).toEqual([{ t: 'refused', action: 'upgrade', reason: 'top_level' }]);
  });

  it('may not take from +7: the materials are spent, the piece keeps its level; it never breaks or goes down', async () => {
    const stash: Stash = { items: { coat: 1, shard: 9, strange: 2 }, out: {}, pieces: { coat: [{ cond: 0.8, level: 6 }] } };
    const a = await enter({ map: 'house', x: 1, y: 2, stash });
    await a.c.settle();
    dice = 0.99;
    a.c.send({ t: 'upgrade', ...BENCH, of: { from: 'stash', item: 'coat', n: 0 } });
    const failed = await heard(a.c);
    expect(failed.at(-1)).toEqual({ t: 'did', did: { kind: 'upgraded', item: 'coat', level: 6, failed: true } });
    expect(failed).toContainEqual({ t: 'bench', stash: [{ item: 'coat', count: 1, piece: { cond: 0.8, level: 6 } }, { item: 'shard', count: 5 }, { item: 'strange', count: 1 }] });
    dice = 0.69;
    a.c.send({ t: 'upgrade', ...BENCH, of: { from: 'stash', item: 'coat', n: 0 } });
    expect(dids(await heard(a.c))).toEqual([{ kind: 'upgraded', item: 'coat', level: 7 }]);
    expect(ctx.server.world.get(a.id)!.stash).toEqual({ items: { coat: 1, shard: 1 }, out: {}, pieces: { coat: [{ cond: 0.8, level: 7 }] } });
    dice = 0;
  });

  it('refuses worn clothes, a bag, what the stash cannot pay for, a piece that is not there, and from too far', async () => {
    const a = await enter({ map: 'house', x: 1, y: 2, gear: { cap: 'worn-cap', shirt: 'coat', bag: 'backpack' }, stash: { items: { scrap: 1, cloth: 5 }, out: {} } });
    await a.c.settle();
    for (const of of [{ from: 'worn', slot: 'cap' }, { from: 'worn', slot: 'bag' }, { from: 'worn', slot: 'shirt' }, { from: 'worn', slot: 'gloves' }, { from: 'stash', item: 'cloth', n: 0 }] as const) {
      a.c.send({ t: 'upgrade', ...BENCH, of });
    }
    a.c.send({ t: 'upgrade', x: 3, y: 1, of: { from: 'worn', slot: 'shirt' } });
    expect((await heard(a.c)).map(m => m.t === 'refused' && m.reason)).toEqual(['not_upgradable', 'not_upgradable', 'missing', 'gone', 'gone', 'too_far']);
    expect(ctx.server.world.get(a.id)!.stash!.items).toEqual({ scrap: 1, cloth: 5 });
  });

  it('keeps levels across a save: on what you wear and in the stash', async () => {
    dice = 0;
    const a = await enter({
      map: 'house', x: 1, y: 2, gear: { cap: 'halo', bag: 'backpack' }, worn: { cap: { cond: 1, quirk: 'hum', level: 2 } },
      stash: { items: { coat: 2, ...PLENTY }, out: {}, pieces: { coat: [{ cond: 1 }, { cond: 0.4, level: 1 }] } },
    });
    await a.c.settle();
    a.c.send({ t: 'upgrade', ...BENCH, of: { from: 'worn', slot: 'cap' } });
    a.c.send({ t: 'upgrade', ...BENCH, of: { from: 'stash', item: 'coat', n: 1 } });
    expect(dids(await heard(a.c))).toEqual([{ kind: 'upgraded', item: 'halo', level: 3 }, { kind: 'upgraded', item: 'coat', level: 2 }]);
    a.c.ws.close();
    await waitFor(() => !ctx.server.world.has(a.id), 'the player to leave');
    const saved = ctx.storage.get(a.id)!;
    expect(saved.worn!.cap).toEqual({ cond: 1, quirk: 'hum', level: 3 });
    expect(saved.stash!.pieces!.coat).toEqual([{ cond: 1 }, { cond: 0.4, level: 2 }]);
    const back = await login(a.token);
    expect(back.welcome.body.worn.cap).toEqual({ cond: 1, quirk: 'hum', level: 3 });
    back.c.send({ t: 'bench', ...BENCH });
    expect((await back.c.next('bench')).stash.filter(s => s.item === 'coat')).toEqual([
      { item: 'coat', count: 1, piece: { cond: 1 } }, { item: 'coat', count: 1, piece: { cond: 0.4, level: 2 } },
    ]);
  });

  it('keeps the level of a carried piece in the pile it falls into, and in the bag it comes back to', async () => {
    const coat = { cond: 0.6, level: 5 };
    const w = await enter({ map: 'woods', x: 4, y: 1 }); // by the campfire: never runs out
    const a = await enter({ map: 'woods', x: 3, y: 6, energy: 1, bag: [{ item: 'coat', count: 1, piece: coat }] });
    await Promise.all([w.c.settle(), a.c.settle()]);
    now += 5000;
    // Down first, and nobody comes (rescue.ts).
    await nobodyCame(a.c, ms => { now += ms; });
    await w.c.next('drop', m => m.drop.owner === a.id);
    await a.c.next('zone', m => m.reason === 'collapse');
    await waitFor(() => ctx.storage.drop(a.id) !== undefined, 'the pile to be stored');
    expect(ctx.storage.drop(a.id)!.items).toEqual([{ item: 'coat', count: 1, piece: coat }]);
    await walk(a.c, 'right', 'right', 'right', 'up', 'up');
    await a.c.next('zone', m => m.reason === 'exit');
    a.c.send({ t: 'pick', x: 3, y: 6 });
    expect(await a.c.next('bag', m => m.bag.length > 0)).toEqual({ t: 'bag', bag: [{ item: 'coat', count: 1, piece: coat }] });
  });

  it('closes on an upgrade that breaks the rules of the protocol', async () => {
    for (const bad of [{ t: 'upgrade', ...BENCH }, { t: 'upgrade', ...BENCH, of: { from: 'worn', slot: 'hat' } }, { t: 'upgrade', ...BENCH, of: { from: 'stash', item: 'coat' } }, { t: 'upgrade', ...BENCH, of: { from: 'bag', slot: 0 } }]) {
      const a = await enter();
      a.c.send(JSON.stringify(bad));
      expect(await a.c.next('error')).toMatchObject({ code: 'bad_message' });
      expect((await a.c.closed).code).toBe(1008);
    }
  });
});
