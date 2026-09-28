import { describe, expect, it } from 'vitest';
import { FEATS, type ClientMsg, type MapData, type PlayerView } from '@napoland/shared';
import { Game } from '../src/game';
import { featHtml, statusHtml } from '../src/hud';
import { Items } from '../src/items';
import { Maps } from '../src/maps';
import { featView, newsBanner, statusView, thousands } from '../src/status';
import { ASLEEP, DRY, ITEMS, START, itemsData, tinyTown, tinyWoods, welcome } from './fixtures';

const feat = (id: string) => FEATS.find(f => f.id === id)!;

describe('feats in the status panel', () => {
  it('shows each feat with its rank, what the rank does, and how far the next one is', () => {
    const v = statusView({
      energy: null, body: DRY, surge: null, caught: false, stone: ASLEEP, bag: [], items: ITEMS, progress: START, resists: null, wear: null, quirks: [],
      storm: null, flash: null, weather: 'overcast', wilds: false,
      stats: { rainSteps: 3_212, nightSteps: 60_000, heavySteps: 799, fed: 20, mended: 17, found: 12_345, farSteps: 29_999, thanked: 30 },
    });
    expect(v.feats).toEqual([
      { name: 'Rain walker', rank: 1, does: 'Rain soaks you 20% slower.', next: '3,212 of 5,000 steps in the rain to rank 2', progress: 3_212 / 5_000 },
      { name: 'Night owl', rank: 5, does: 'Hitchhikers find you 80% less often.', next: 'Top rank' },
      { name: 'Pack mule', rank: 0, does: 'Rank 1: what you carry feels 15% lighter.', next: '799 of 800 steps with a heavy bag to rank 1', progress: 799 / 800 },
      { name: 'Fire keeper', rank: 1, does: 'Fires warm you 15% faster.', next: '20 of 60 fires fed to rank 2', progress: 20 / 60 },
      { name: 'Mender', rank: 2, does: 'Gear wears 10% slower out there.', next: '17 of 40 pieces mended to rank 3', progress: 17 / 40 },
      { name: 'Forager', rank: 5, does: 'Finds come up double 15% of the time.', next: 'Top rank' },
      { name: 'Pathfinder', rank: 4, does: '85 steps or more from home, you tire 12% slower.', next: '29,999 of 30,000 steps 85 or more from home to rank 5', progress: 29_999 / 30_000 },
      { name: 'Good neighbor', rank: 1, does: 'Your arrows last 2 days.', next: '30 of 75 thanks to rank 2', progress: 30 / 75 },
    ]);
  });

  it('shows a feat never started at rank 0, with what rank 1 needs and does', () => {
    expect(featView(feat('mender'), 0)).toEqual({ name: 'Mender', rank: 0, does: 'Rank 1: gear wears 5% slower out there.', next: '0 of 5 pieces mended to rank 1', progress: 0 });
    expect(featView(feat('pathfinder'), 0).does).toBe('Rank 1: 85 steps or more from home, you tire 3% slower.');
    expect(featView(feat('rain-walker'), 100_000)).toEqual({ name: 'Rain walker', rank: 5, does: 'Rain soaks you 50% slower.', next: 'Top rank' });
    expect(featView(feat('good-neighbor'), 0)).toEqual({ name: 'Good neighbor', rank: 0, does: 'Rank 1: your arrows last 2 days.', next: '0 of 25 thanks to rank 1', progress: 0 });
    expect(featView(feat('good-neighbor'), 1_200).does).toBe('Your arrows last 7 days.');
  });

  it('writes big counts with their thousands apart', () => {
    expect([0, 999, 1_000, 12_345, 100_000, 1_234_567].map(thousands)).toEqual(['0', '999', '1,000', '12,345', '100,000', '1,234,567']);
  });

  it('draws a card: five pips with the earned ones lit, a bar to the next rank, none at the top', () => {
    const html = featHtml(featView(feat('rain-walker'), 5_210));
    expect(html.match(/<i data-on><\/i>/g)).toHaveLength(2);
    expect(html.match(/<i><\/i>/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Rank 2 of 5"');
    expect(html).toContain('data-rank="2"');
    expect(html).toContain('class="sbar"');
    expect(html).toContain('5,210 of 15,000 steps in the rain to rank 3');
    const top = featHtml(featView(feat('forager'), 12_000));
    expect(top.match(/<i data-on><\/i>/g)).toHaveLength(5);
    expect(top).toContain('data-top');
    expect(top).not.toContain('sbar');
    expect(featHtml({ name: 'A <b>', rank: 0, does: '"x" & y', next: 'z' })).toContain('A &lt;b&gt;');
  });

  it('puts every feat\'s card under the rows, in the order of the table', () => {
    const v = statusView({
      energy: null, body: DRY, surge: null, caught: false, stone: ASLEEP, bag: [], items: ITEMS, progress: START, resists: null, wear: null, quirks: [],
      storm: null, flash: null, weather: 'overcast', wilds: false, stats: {},
    });
    const html = statusHtml(v);
    expect(html.indexOf('<h3>Feats</h3>')).toBeGreaterThan(html.lastIndexOf('class="srow"'));
    expect([...html.matchAll(/<div class="feat" data-rank="0"><b>([^<]+)<\/b>/g)].map(m => m[1])).toEqual(FEATS.map(f => f.name));
  });
});

describe('a new rank', () => {
  it('is announced with the feat, the rank and what it does', () => {
    expect(newsBanner({ kind: 'feat', id: 'rain-walker', rank: 2 }, '')).toEqual({ title: 'Rain walker, rank 2', sub: 'Rain soaks you 30% slower.' });
    expect(newsBanner({ kind: 'feat', id: 'forager', rank: 1 }, '')).toEqual({ title: 'Forager, rank 1', sub: 'Finds come up double 5% of the time.' });
    expect(newsBanner({ kind: 'feat', id: 'pathfinder', rank: 5 }, '')).toEqual({ title: 'Pathfinder, rank 5', sub: '85 steps or more from home, you tire 15% slower.' });
    // A rank the table does not have says nothing.
    expect(newsBanner({ kind: 'feat', id: 'rain-walker', rank: 6 }, '')).toBeNull();
    expect(newsBanner({ kind: 'feat', id: 'rain-walker', rank: 0 }, '')).toBeNull();
  });
});

describe('the game and the counts', () => {
  const me = (x: number, y: number): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir: 'up', color: '#f29e4c', gear: {}, quirks: [] });
  const woods = (): MapData => tinyWoods();
  function game() {
    const sent: ClientMsg[] = [];
    const g = new Game(new Maps([tinyTown(), woods()]), m => sent.push(m), new Items(itemsData()));
    return { g, sent };
  }

  it('asks for the counts only when online, and takes them whole', () => {
    const { g, sent } = game();
    g.askStats();
    expect(sent).toEqual([]);
    g.handle(welcome(woods(), [me(2, 3)]), 0);
    const before = g.statsChanges;
    g.askStats();
    expect(sent).toEqual([{ t: 'stats' }]);
    g.handle({ t: 'stats', stats: { rainSteps: 42, found: 3 } }, 0);
    expect(g.stats).toEqual({ rainSteps: 42, found: 3 });
    expect(g.statsChanges).toBe(before + 1);
    g.handle({ t: 'feat', id: 'forager', rank: 1, stats: { rainSteps: 42, found: 200 } }, 0);
    expect(g.stats).toEqual({ rainSteps: 42, found: 200 });
    expect(g.statsChanges).toBe(before + 2);
    expect(g.news).toEqual([{ kind: 'feat', id: 'forager', rank: 1 }]);
  });

  it('says when a find came up double, and whose doing it was', () => {
    const { g } = game();
    g.handle(welcome(woods(), [me(2, 3)]), 0);
    g.handle({ t: 'got', items: [{ item: 'glowcap', count: 2 }], from: 'find', double: true }, 0);
    expect(g.floats.map(f => [f.text, f.row])).toEqual([['+2 Glowcap', 0], ['Forager: it came up double', 1]]);
    g.floats = [];
    g.handle({ t: 'got', items: [{ item: 'glowcap', count: 1 }], from: 'find' }, 0);
    expect(g.floats.map(f => f.text)).toEqual(['+1 Glowcap']);
  });
});
