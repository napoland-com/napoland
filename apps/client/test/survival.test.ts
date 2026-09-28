import { beforeEach, describe, expect, it } from 'vitest';
import { FEATS, FIRE_LOW_S, FIRE_MAX_S, type ClientMsg, type ConditionsData, type MapData, type PlayerView } from '@napoland/shared';
import { Game, minutes } from '../src/game';
import { clock, roomText, surgeLook } from '../src/hud';
import { Items, factsOf, refusalText, slotViews, useLabel } from '../src/items';
import { Maps } from '../src/maps';
import { drainText, newsBanner, statusView } from '../src/status';
import { fireLevel } from '../src/view/fire';
import { ASLEEP, DRY, FULL, itemsData, tinyTown, tinyWoods, welcome, zone } from './fixtures';

/**
 * A 7x7 patch of wilds that surges: a campfire at 3,1, the Old Stone at 5,3, a notice board at 1,3,
 * the way home at the bottom (3,6). Steps from home: |x - 3| + (6 - y).
 */
function camp(): MapData {
  return {
    id: 'camp', name: 'The Camp', version: 1, kind: 'wilds', depth: 1, width: 7, height: 7,
    tiles: ['ggggggg', 'ggggggg', 'ggggggg', 'ggggggg', 'ggggggg', 'ggggggg', 'tttgttt'],
    levels: Array<string>(7).fill('0000000'),
    spawn: { x: 3, y: 5, dir: 'up' },
    exits: [{ x: 3, y: 6, w: 1, h: 1, to: 'town', tx: 3, ty: 1, dir: 'down', home: true }],
    objects: [{ kind: 'fireplace', x: 3, y: 1 }, { kind: 'stone', x: 5, y: 3 }, { kind: 'board', x: 1, y: 3 }],
    surge: { every: 100, unstable: 20, surge: 20, sweep: 10 },
  };
}

const items = new Items({
  ...itemsData(),
  items: [
    ...itemsData().items,
    { id: 'resin', name: 'Fir resin', noun: 'resin', plural: 'resin', kind: 'resource', stack: 20, text: 'Sticky.', fuel: 300, weight: 0.2 },
    { id: 'cloth', name: 'Cloth scraps', noun: 'cloth', plural: 'cloth', kind: 'resource', stack: 10, text: 'Dry.', fuel: 90 },
    { id: 'ore', name: 'Shard', kind: 'resource', stack: 5, text: 'Warm.', charge: 1 },
    { id: 'cap', name: 'Glowcap', kind: 'resource', stack: 20, text: 'Glows.', use: { mark: true } },
    { id: 'pebble', name: 'Warm pebble', kind: 'charm', stack: 1, text: 'Warm.', charm: { wetting: 0.6 } },
  ],
});
const maps = new Maps([tinyTown(), camp()]);
const me = (x: number, y: number, dir: PlayerView['dir'] = 'up'): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir, color: '#f29e4c', gear: {}, quirks: [] });

let sent: ClientMsg[];
let g: Game;
let now: number;
const texts = () => g.floats.map(f => f.text);

beforeEach(() => {
  sent = [];
  now = 1000;
  g = new Game(maps, m => sent.push(m), items);
});

describe('A at a fire, the Old Stone and the notice board', () => {
  it('asks before feeding a wild fire what burns longest, then says what it took, from the server', () => {
    g.handle(welcome(camp(), [me(3, 2)], FULL, { fires: [{ x: 3, y: 1, left: 100 }], bag: [{ item: 'cloth', count: 2 }, { item: 'resin', count: 1 }] }), now);
    g.pressA();
    // One resin is all there is of it: nothing to count.
    expect(g.askView()).toEqual({ who: 'Fire', text: 'Feed the fire resin?', choice: 'yes', count: null });
    expect(sent).toEqual([]);
    g.pressA();
    expect(sent).toEqual([{ t: 'feed', x: 3, y: 1, slot: 1 }]);
    // The box keeps the question up until the server says how it went.
    expect(g.note).toMatchObject({ text: 'Feed the fire resin?', waiting: true });
    g.handle({ t: 'fire', fire: { x: 3, y: 1, left: 400 } }, now);
    g.handle({ t: 'did', did: { kind: 'fire', item: 'resin', count: 1, left: 400 } }, now);
    expect(g.note).toMatchObject({ who: 'Fire', text: 'The fire takes 1 resin. It will burn 7 more minutes.', waiting: false });
    expect(texts()).toEqual([]);
    expect(g.fireLeft(3, 1, now + 100_000)).toBe(300);
  });

  it('asks how many, up to what you carry and what fits, and sends them all at once', () => {
    // 1400 s of fuel: two resin fit (the second tops it up past what it holds).
    g.handle(welcome(camp(), [me(3, 2)], FULL, { fires: [{ x: 3, y: 1, left: 1400 }], bag: [{ item: 'resin', count: 20 }, { item: 'resin', count: 5 }] }), now);
    g.pressA();
    expect(g.askView()?.count).toEqual({ n: 1, min: 1, max: 2 });
    g.padChange('right', now);
    g.padChange(null, now);
    g.padChange('right', now);
    expect(g.askView()?.count?.n).toBe(2);
    g.pressA();
    expect(sent).toEqual([{ t: 'feed', x: 3, y: 1, slot: 0, count: 2 }]);
    g.handle({ t: 'did', did: { kind: 'fire', item: 'resin', count: 2, left: 1800 } }, now);
    expect(g.note?.text).toBe('The fire takes 2 resin. It is full: it will burn 30 more minutes.');
    // A fire that went out takes as many as you carry of it, up to what it holds.
    g.handle({ t: 'fire', fire: { x: 3, y: 1, left: 0 } }, now);
    g.handle({ t: 'bag', bag: [{ item: 'cloth', count: 10 }, { item: 'cap', count: 1 }, { item: 'cloth', count: 10 }, { item: 'cloth', count: 10 }] }, now);
    g.pressA();
    g.pressA();
    expect(g.askView()).toMatchObject({ text: 'Feed the fire cloth?', count: { n: 1, max: 20 } });
    g.pressB();
    g.handle({ t: 'bag', bag: [{ item: 'resin', count: 20 }] }, now);
    g.pressA();
    expect(g.askView()?.count?.max).toBe(6);
  });

  it('says why instead of asking: nothing that burns, a fire someone keeps, a fire as full as it gets', () => {
    g.handle(welcome(camp(), [me(3, 2)], FULL, { fires: [{ x: 3, y: 1, left: 600 }] }), now);
    g.pressA();
    expect(sent).toEqual([]);
    expect(g.question).toBeNull();
    expect(g.note).toMatchObject({ who: 'Fire', text: 'It will burn 10 more minutes. You have nothing that burns.', waiting: false });
    g.pressA();
    g.handle({ t: 'fire', fire: { x: 3, y: 1, left: 0 } }, now);
    g.pressA();
    expect(g.note?.text).toBe('The fire is out. Bring something that burns: resin or cloth.');
    g.pressA();
    g.handle({ t: 'fire', fire: { x: 3, y: 1, left: null } }, now);
    g.handle({ t: 'bag', bag: [{ item: 'resin', count: 3 }] }, now);
    g.pressA();
    expect(g.note?.text).toBe('Someone keeps this fire going. It needs nothing.');
    g.pressA();
    g.handle({ t: 'fire', fire: { x: 3, y: 1, left: FIRE_MAX_S - 0.5 } }, now);
    g.pressA();
    expect(g.note?.text).toBe('The fire is as full as it gets. It will burn 30 more minutes.');
    expect(sent).toEqual([]);
    expect(texts()).toEqual([]);
  });

  it('asks before giving the Old Stone shards, how many of what you carry, or says how it stands', () => {
    g.handle(welcome(camp(), [me(5, 4)], FULL, { stone: { ...ASLEEP, charge: 7 } }), now);
    g.pressA();
    expect(g.note).toMatchObject({ who: 'The Old Stone', text: 'The Old Stone sleeps: 7 of 20 shards. You have no shard to give it.' });
    g.pressA();
    g.handle({ t: 'bag', bag: [{ item: 'ore', count: 2 }, { item: 'cap', count: 1 }, { item: 'ore', count: 5 }] }, now);
    g.pressA();
    expect(g.askView()).toEqual({ who: 'The Old Stone', text: 'Give the Old Stone a shard?', choice: 'yes', count: { n: 1, min: 1, max: 7 } });
    g.holdCount(1, now);
    g.holdCount(0, now);
    expect(g.question?.text).toBe('Give the Old Stone 2 shards?');
    g.pressA();
    expect(sent).toEqual([{ t: 'feed', x: 5, y: 3, slot: 0, count: 2 }]);
    g.handle({ t: 'did', did: { kind: 'stone', item: 'ore', count: 2, stone: { ...ASLEEP, charge: 9 } } }, now);
    expect(g.note?.text).toBe('The Old Stone takes 2 shards: 9 of 20.');
  });

  it('asks the server for the notice board, and shows what it says', () => {
    g.handle(welcome(camp(), [me(1, 4)]), now);
    g.pressA();
    expect(sent).toEqual([{ t: 'board', x: 1, y: 3 }]);
    g.handle({ t: 'board', lines: ['Rain.', 'Nobody collapsed in the last hour.'] }, now);
    expect(g.dialog).toMatchObject({ who: 'Notice board', lines: ['Rain.', 'Nobody collapsed in the last hour.'] });
  });

  it('walks up to a fire that is tapped, and asks to feed it', () => {
    g.handle(welcome(camp(), [me(3, 4)], FULL, { fires: [{ x: 3, y: 1, left: 10 }], bag: [{ item: 'resin', count: 1 }] }), now);
    g.tapTile(3, 1);
    let confirmed = 0;
    for (let i = 0; i < 60; i++) {
      now += 1000 / 60;
      g.update(1 / 60, now);
      // The server confirms each step once.
      const last = sent.at(-1);
      if (last?.t === 'step' && last.seq > confirmed) { confirmed = last.seq; g.handle({ t: 'step', id: 'me', x: g.me!.tx, y: g.me!.ty, dir: last.dir, seq: last.seq }, now); }
    }
    // Two steps up, to 3,2 next to the fire, and then it asks.
    expect(sent.filter(m => m.t === 'step')).toHaveLength(2);
    expect(g.question?.text).toBe('Feed the fire resin?');
    g.pressA();
    expect(sent.at(-1)).toEqual({ t: 'feed', x: 3, y: 1, slot: 0 });
  });
});

describe('what the server says about the world out there', () => {
  it('counts wetness on between reports, and keeps the fires, marks, creatures and flares of the map', () => {
    g.handle(welcome(camp(), [me(3, 3)], FULL, {
      body: { ...DRY, wetRate: 0.01 },
      marks: [{ id: 1, x: 2, y: 2, dir: 'up', color: '#fff', owner: 'bea', name: 'Bea', until: 1e13 }],
      creatures: [{ id: 4, kind: 'watcher', x: 0, y: 0, dir: 'down' }],
      flares: [{ x: 1, y: 1, left: 10 }],
    }), now);
    expect(g.bodyNow(now + 20_000).wet).toBeCloseTo(0.2, 5);
    expect([...g.marks.keys()]).toEqual([1]);
    expect(g.creatureViews()).toEqual([{ id: '4', kind: 'watcher', x: 0, y: 0, dir: 'down', moving: false, chasing: undefined }]);
    expect(g.flaresNow(now + 5000)).toEqual([{ x: 1, y: 1, left: 5 }]);
    expect(g.flaresNow(now + 11_000)).toEqual([]);
    // A zone brings the new map's.
    g.handle(zone(tinyTown(), 3, 3, [me(3, 3)]), now);
    expect(g.marks.size).toBe(0);
    expect(g.creatureViews()).toEqual([]);
  });

  it('walks a creature to its next tile, and puts one that jumped where it is at once', () => {
    g.handle(welcome(camp(), [me(3, 3)], FULL, { creatures: [{ id: 4, kind: 'watcher', x: 0, y: 0, dir: 'down' }] }), now);
    g.handle({ t: 'creature', creature: { id: 4, kind: 'watcher', x: 0, y: 1, dir: 'down' } }, now);
    g.update(0.1, now + 100);
    const mid = g.creatureViews()[0]!;
    expect(mid.moving).toBe(true);
    expect(mid.y).toBeGreaterThan(0);
    expect(mid.y).toBeLessThan(1);
    g.handle({ t: 'creature', creature: { id: 4, kind: 'watcher', x: 5, y: 5, dir: 'up' } }, now + 200);
    expect(g.creatureViews()[0]).toEqual({ id: '4', kind: 'watcher', x: 5, y: 5, dir: 'up', moving: false, chasing: undefined });
    g.handle({ t: 'creatureGone', id: 4 }, now);
    expect(g.creatureViews()).toEqual([]);
  });

  it('says so the first moment a skulker goes after you, and when it catches you', () => {
    g.handle(welcome(camp(), [me(3, 3)], FULL, { creatures: [{ id: 5, kind: 'skulker', x: 0, y: 3, dir: 'down' }] }), now);
    g.handle({ t: 'creature', creature: { id: 5, kind: 'skulker', x: 1, y: 3, dir: 'right', chasing: 'me' } }, now);
    expect(g.creatureViews()[0]).toMatchObject({ kind: 'skulker', moving: true, chasing: 'me' });
    g.handle({ t: 'creature', creature: { id: 5, kind: 'skulker', x: 2, y: 3, dir: 'right', chasing: 'me' } }, now + 250);
    expect(g.floats.map(f => f.text)).toEqual(['Something is after you. Run']);
    g.handle({ t: 'touched', by: 'skulker', lost: null }, now + 300);
    expect(g.floats.map(f => f.text)).toEqual(['Something is after you. Run', 'It caught you', 'It slipped back into the ferns']);
  });

  it('counts the storm on, and knows when a flash discharges under you', () => {
    g.handle(welcome(camp(), [me(3, 3)], FULL, { storm: { phase: 'coming', left: 10 }, flashes: [{ x: 3, y: 2, kind: 'fire', left: 10 }] }), now);
    expect(g.stormNow(now + 4000)).toEqual({ phase: 'coming', left: 6 });
    // Glowing for 6 more seconds: it has not discharged yet.
    expect(g.flashed(now)).toBeNull();
    expect(g.flashed(now + 7000)).toBe('fire');
    expect(g.flashed(now + 11_000)).toBeNull();
    g.handle({ t: 'flash', flash: { x: 0, y: 0, kind: 'spark', left: 12 } }, now);
    expect(g.flashesNow(now + 1000).map(f => f.kind)).toEqual(['fire', 'spark']);
    g.handle({ t: 'storm', storm: { phase: 'storm', left: 180 } }, now);
    expect(g.stormNow(now)).toEqual({ phase: 'storm', left: 180 });
    expect(g.news).toContainEqual({ kind: 'storm', view: { phase: 'storm', left: 180 } });
  });

  it('knows when the surge has you: its front over your tile', () => {
    g.handle(welcome(camp(), [me(0, 0)], FULL, { surge: { phase: 'surge', left: 20, into: 0 } }), now);
    // The front starts at the deepest tile, 3 + 6 = 9 steps: the corners, where you stand.
    expect(g.caught(now)).toBe(true);
    g.handle(welcome(camp(), [me(3, 5)], FULL, { surge: { phase: 'surge', left: 20, into: 0 } }), now);
    expect(g.caught(now)).toBe(false);
    // 9 seconds in, it is 0.9 steps from home: it has you there too.
    expect(g.caught(now + 9000)).toBe(true);
    expect(g.surgeNow(now + 9000)).toEqual({ phase: 'surge', left: 11, into: 9 });
  });

  it('says what a watcher took and what clings to you, and queues news for banners', () => {
    g.handle(welcome(camp(), [me(3, 3)]), now);
    g.handle({ t: 'touched', by: 'watcher', lost: 'resin' }, now);
    g.handle({ t: 'hitch', on: true }, now);
    expect(texts()).toEqual(['It took your fir resin', 'The cold goes right through you', 'Something clings to you. Find a light']);
    g.handle({ t: 'surge', surge: { phase: 'unstable', left: 20, into: 0 } }, now);
    g.handle({ t: 'stone', stone: { ...ASLEEP, charge: 20, awake: true, left: 3600 } }, now);
    g.handle({ t: 'feat', id: 'rain-walker', rank: 1, stats: { rainSteps: 1500 } }, now);
    expect(g.news.map(n => n.kind)).toEqual(['surge', 'stone', 'feat']);
    expect(g.news.at(-1)).toEqual({ kind: 'feat', id: 'rain-walker', rank: 1 });
    expect(g.stats).toEqual({ rainSteps: 1500 });
  });
});

describe('what the interface says', () => {
  it('shows the surge clock only when it matters', () => {
    expect(clock(185.2)).toBe('3:06');
    expect(surgeLook(null, false)).toBeNull();
    expect(surgeLook({ phase: 'calm', left: 100, into: 0 }, false)).toBeNull();
    expect(surgeLook({ phase: 'unstable', left: 61, into: 0 }, false)).toEqual({ text: 'Restless. A surge in 1:01', level: 'restless' });
    expect(surgeLook({ phase: 'surge', left: 20, into: 0 }, true)?.level).toBe('caught');
  });

  it('puts the load in the bag\'s header once there is some', () => {
    expect(roomText(3, 0.02)).toBe('3 of 8');
    expect(roomText(3, 0.42)).toBe('3 of 8 · load 42%');
    expect(roomText(8, 1.3)).toBe('8 of 8 · heavy');
  });

  it('names what using a thing does, and what is worth knowing about it', () => {
    expect(useLabel(items.get('cap'))).toBe('Mark the way');
    expect(useLabel(items.get('thermos'))).toBe('Drink');
    expect(factsOf(items.get('resin'))).toEqual(['200 g', 'Burns 5 min']);
    expect(factsOf(items.get('pebble'))).toEqual(['Works while in your bag']);
    expect(slotViews([{ item: 'cap', count: 3 }], items)[0]).toMatchObject({ usable: true, useLabel: 'Mark the way' });
    expect(refusalText('fire_full')).toBe('The fire is as big as it gets');
  });

  it('draws fires by how much fuel they have left', () => {
    expect(fireLevel(null)).toBe(1);
    expect(fireLevel(0)).toBe(0);
    expect(fireLevel(FIRE_LOW_S / 2)).toBeCloseTo(0.45, 5);
    expect(fireLevel(FIRE_MAX_S)).toBeCloseTo(1.1, 5);
    expect(minutes(30)).toBe('under a minute');
    expect(minutes(61)).toBe('1 minute');
  });

  it('fills the status panel with how you are, the Old Stone and the feats', () => {
    const v = statusView({
      energy: { value: 40, max: 100, rate: -0.5 }, body: { wet: 0.5, wetRate: 0.01, load: 0.8, hitched: true, worn: {} },
      surge: { phase: 'surge', left: 30, into: 0 }, caught: true, stone: { charge: 3, need: 20, awake: false, left: 0 },
      stats: { rainSteps: 1500, fed: 5 }, bag: [{ item: 'pebble', count: 1 }], items, progress: { xp: 40, level: 2, from: 30, to: 120, maxEnergy: 105 },
      resists: 'Cold 25%', wear: null, quirks: [], storm: null, flash: null, weather: 'rain', wilds: false,
    });
    expect(v.rows[0]).toEqual({ label: 'Level', text: 'Level 2 · 40 XP, 80 to go', bar: 10 / 90, tone: 'good' });
    expect(v.rows.slice(1).map(r => [r.label, r.text])).toEqual([
      ['Rested', 'Empty. It fills while you are not playing, and then what you stash counts double.'],
      ['Energy', '40 of 100, draining'],
      ['Wet', '50%, getting wetter'],
      ['Load', '80% of what you carry easily'],
      ['Resists', 'Cold 25%'],
      ['On you', 'Something clings to your back. Find a light, a fire or a roof.'],
      ['Charms', 'Warm pebble'],
      ['Surge', 'It has you. Get to a light!'],
      ['Old Stone', 'Asleep. 3 of 20 shards.'],
    ]);
    expect(v.feats.map(f => [f.name, f.rank])).toEqual(FEATS.map(f => [f.name, f.id === 'rain-walker' ? 1 : 0]));
    expect(v.feats.find(f => f.name === 'Fire keeper')!.progress).toBe(0.25);
  });

  it('sends you to the workbench at home to make gear and to mend it', () => {
    const v = statusView({
      energy: null, body: DRY, surge: null, caught: false, stone: ASLEEP, stats: {}, bag: [], items,
      progress: { xp: 0, level: 1, from: 0, to: 30, maxEnergy: 100 }, resists: null, wear: 'Raincoat worn out', quirks: [], storm: null, flash: null, weather: 'overcast', wilds: false,
    });
    expect(v.rows.filter(r => r.label === 'Wear' || r.label === 'Resists').map(r => [r.label, r.text])).toEqual([
      ['Wear', 'Raincoat worn out. Mend it at the workbench at home.'],
      ['Resists', 'Nothing yet. Make gear at the workbench at home.'],
    ]);
  });

  it('says what drains you, element by element, and the storm and a flash in the status panel', () => {
    expect(drainText({ weather: 'overcast', wet: 0, storm: false, caught: false, flash: null })).toBeNull();
    expect(drainText({ weather: 'night', wet: 0.5, storm: true, caught: true, flash: 'fire' })).toBe(
      'Heat: a flash · Cold: night, wet · Wind: the storm · Electricity: the storm, the surge · Radiation: the surge',
    );
    const v = statusView({
      energy: { value: 40, max: 100, rate: -0.5 }, body: DRY, surge: null, caught: false, stone: ASLEEP, stats: {}, bag: [], items,
      progress: { xp: 0, level: 1, from: 0, to: 30, maxEnergy: 100 }, resists: null, wear: null, quirks: [], storm: { phase: 'storm', left: 90 }, flash: 'spark', weather: 'rain', wilds: true,
    });
    expect(v.rows.filter(r => ['Draining', 'Storm', 'Flash'].includes(r.label)).map(r => [r.label, r.text])).toEqual([
      ['Draining', 'Cold: rain · Wind: the storm · Electricity: the storm, a flash'],
      ['Storm', 'Blowing for 2 minutes more. A roof keeps it off.'],
      ['Flash', 'The ground under you is discharging. Step off it!'],
    ]);
  });

  it('announces surges, storms, the Old Stone and feats with a banner', () => {
    expect(newsBanner({ kind: 'storm', view: { phase: 'coming', left: 60 } }, 'The Near Woods')?.title).toBe('A storm is coming');
    expect(newsBanner({ kind: 'storm', view: { phase: 'clear', left: 2000 } }, 'The Near Woods')?.sub).toBe('The Near Woods is clear again.');
    expect(newsBanner({ kind: 'surge', view: { phase: 'unstable', left: 360, into: 0 } }, 'The Near Woods')?.title).toBe('The Near Woods grows restless');
    expect(newsBanner({ kind: 'stone', view: { ...ASLEEP, awake: true } }, '')?.title).toBe('The Old Stone woke up');
    expect(newsBanner({ kind: 'feat', id: 'night-owl', rank: 1 }, '')?.title).toBe('Night owl, rank 1');
    expect(newsBanner({ kind: 'feat', id: 'nope', rank: 1 }, '')).toBeNull();
  });
});

describe('what the woods are like today', () => {
  const conditions: ConditionsData = {
    seed: 1, second: 0.5,
    daily: [
      { id: 'fog', name: 'Thick fog', text: 'You will not see far.', weight: 1, map: 'woods', fog: 5 },
      { id: 'drop', name: 'A supply drop', text: 'Crates by the pond.', weight: 1, map: 'woods' },
    ],
    weekly: [{ id: 'copper', name: 'Copper week', text: 'Wire by every pole.', map: 'woods' }],
  };
  const miraTown = (): MapData => ({ ...tinyTown(), objects: [{ kind: 'npc', x: 1, y: 1, id: 'mira', name: 'Mira', dir: 'down', lines: ['Heading out?'] }] });
  const today = { today: ['fog', 'drop'], week: 'copper', next: 'copper' };
  const game = () => new Game(new Maps([miraTown(), tinyWoods()]), () => {}, new Items({ ...itemsData(), conditions }));

  it('Mira\'s first line names today\'s conditions and this week\'s', () => {
    const g = game();
    g.handle(welcome(miraTown(), [me(1, 2)], FULL, { conditions: today }), 0);
    g.pressA();
    expect(g.dialog).toMatchObject({ who: 'Mira', lines: ['Word from the woods today: thick fog, and a supply drop. This week: copper week.', 'Heading out?'] });
    // Nothing going on: she just talks.
    const quiet = game();
    quiet.handle(welcome(miraTown(), [me(1, 2)], FULL), 0);
    quiet.pressA();
    expect(quiet.dialog?.lines).toEqual(['Heading out?']);
  });

  it('a new day shows a banner, once', () => {
    const g = game();
    g.handle(welcome(miraTown(), [me(1, 2)], FULL, { conditions: today }), 0);
    g.handle({ t: 'conditions', conditions: { ...today, today: ['drop'] } }, 0);
    expect(g.news).toEqual([{ kind: 'conditions', names: ['A supply drop'] }]);
    expect(newsBanner(g.news[0]!, 'Testbrook')).toEqual({ title: 'A new day', sub: 'A supply drop' });
    g.news.length = 0;
    // The same day told again (the week turned): no banner.
    g.handle({ t: 'conditions', conditions: { ...today, today: ['drop'], week: null } }, 0);
    expect(g.news).toEqual([]);
    expect(g.conditions.week).toBeNull();
  });

  it('fog closes in on the woods, not on the town', () => {
    const g = game();
    g.handle(welcome(miraTown(), [me(1, 2)], FULL, { conditions: today }), 0);
    expect(g.fogCap()).toBeUndefined();
    g.handle(zone(tinyWoods(), 2, 4, [me(2, 4)]), 0);
    expect(g.fogCap()).toBe(5);
    g.handle({ t: 'conditions', conditions: { ...today, today: ['drop'] } }, 0);
    expect(g.fogCap()).toBeUndefined();
  });
});
