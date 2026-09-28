/**
 * The notice board as a panel (board.ts): the sky over its tabs, a card for each region out there with
 * its chips and a row for whatever there needs someone, the sentences a tap opens, the town and the
 * week. Read with the real items (their works, the town's ledger, the conditions and the parcels),
 * since that is what players read.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boardWords, type BoardRegion, type ItemsData } from '@napoland/shared';
import { QUIET, boardPanel, shortTime } from '../src/board';
import { boardView } from './fixtures';

const content = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/items.json'), 'utf8')) as ItemsData;
const words = boardWords(content);
const NEAR: BoardRegion = { id: 'near-woods', name: 'The Near Woods', rain: { raining: false, left: 480 }, surge: { phase: 'calm', next: 1980 }, storm: { phase: 'clear', next: 780 }, glowing: [] };
/** A region's card, whole, from the panel's Out there tab. */
const cardOf = (out: string, id: string) => out.slice(out.indexOf(`data-card="${id}"`), out.indexOf('</div></div>', out.indexOf(`data-card="${id}"`)));

describe('the times on its chips', () => {
  it('are short: minutes, then hours, then days', () => {
    expect([shortTime(30), shortTime(60), shortTime(8 * 60 + 20), shortTime(95 * 60), shortTime(20 * 3600), shortTime(40 * 3600), shortTime(6 * 86_400)]).toEqual(['<1 min', '1 min', '8 min', '2 h', '20 h', '2 days', '6 days']);
  });
});

describe('the sky over its tabs', () => {
  it('says when night falls or dawn comes, the season and how long it lasts, and when the Long Night comes; the last two lead to the week', () => {
    const { sky } = boardPanel(boardView(), words);
    expect(sky).toContain('Night in 18 min');
    expect(sky).toContain('Summer · 6 days left');
    expect(sky).toContain('Long Night in 5 days');
    expect(sky.match(/data-goto="week"/g)).toHaveLength(2);
    expect(boardPanel(boardView({ sky: { kind: 'night', night: 'aurora', dawn: 300 } }), words).sky).toContain('Aurora · dawn in 5 min');
    expect(boardPanel(boardView({ sky: { kind: 'fixed', weather: 'rain' } }), words).sky).toContain('Rain');
  });
});

describe('out there', () => {
  it('has a card for each region, nearest town first: its rain, and its surge and storm clocks as chips, colored only when they need seeing to', () => {
    const calm = boardPanel(boardView({ regions: [NEAR] }), words).out;
    expect(calm).toContain('data-card="near-woods" aria-expanded="false"');
    expect(calm).toContain('Rain in 8 min');
    expect(calm).toContain('<span>Surge in 33 min</span>');
    expect(calm).toContain('<span>Storm in 13 min</span>');
    expect(calm).not.toMatch(/data-tone="(restless|surge|warn|bad)"/);
    const tones = (r: Partial<BoardRegion>) => boardPanel(boardView({ regions: [{ ...NEAR, ...r }] }), words).out;
    expect(tones({ surge: { phase: 'unstable', left: 240 } })).toContain('data-tone="restless">');
    expect(tones({ surge: { phase: 'unstable', left: 240 } })).toContain('Surge in 4 min');
    expect(tones({ surge: { phase: 'surge', left: 50 } })).toContain('Surge on · &lt;1 min');
    expect(tones({ storm: { phase: 'coming', left: 60 } })).toMatch(/data-tone="warn">[\s\S]*?Storm in 1 min/);
    expect(tones({ storm: { phase: 'storm', left: 170 } })).toMatch(/data-tone="bad">[\s\S]*?Storm on · 3 min/);
    expect(tones({ rain: { raining: true, left: 360 } })).toMatch(/data-tone="rain">[\s\S]*?Rain · 6 min more/);
    // At night nothing falls anywhere: the sky says so, and no card has a rain chip.
    expect(tones({ rain: undefined })).not.toContain('Rain');
  });

  it('gives a card a row for whatever there needs someone: a fire gone out or burning low, the lookout\'s lamp, a place mended together, a slab glowing, today\'s condition, a collapse', () => {
    const out = boardPanel(boardView({
      regions: [{ ...NEAR, surge: { phase: 'unstable', left: 240 }, glowing: ['the slab in the ring of stones'] }, { id: 'far-woods', name: 'The Far Woods', glowing: [] }],
      conditions: { today: ['fog'], week: null, next: null },
      fires: { out: [{ name: 'the cabin at the end', map: 'near-woods' }], low: [{ name: 'the trapper\'s cabin', map: 'far-woods' }], count: 4 },
      lamps: [{ map: 'near-woods', name: 'The Near Woods', left: 2220 }],
      works: [{ id: 'pond-footbridge', standing: true, held: 20, map: 'near-woods' }, { id: 'pond-light', standing: false, held: 3, top: 'Ana', map: 'near-woods' }],
      collapses: [{ map: 'near-woods', name: 'The Near Woods', n: 2 }],
    }), words).out;
    const near = cardOf(out, 'near-woods'), far = cardOf(out, 'far-woods');
    expect(near).toMatch(/data-tone="bad">[\s\S]*?Gone out: the cabin at the end/);
    expect(near).toContain('The slab in the ring of stones is glowing');
    expect(near).toContain('Lookout\'s lamp: 37 min more');
    // The footbridge stands with 4 days put by of the 7 it keeps; the light is dark, 3 of the 12 it takes.
    expect(near).toContain('Footbridge</span><span class="sbar" aria-hidden="true"><i style="transform:translateX(-42.9%)"></i></span><span class="n">4 days</span>');
    expect(near).toContain('Street light: dark</span><span class="sbar" aria-hidden="true"><i style="transform:translateX(-75.0%)"></i></span><span class="n">3 of 12</span>');
    expect(near).toContain('Thick fog');
    expect(near).toContain('2 collapsed in the last hour');
    expect(near).not.toContain('trapper');
    expect(far).toMatch(/data-tone="warn">[\s\S]*?Burning low: the trapper's cabin/);
    // Tapped, a card says what the board says about its region, in whole sentences (hidden until then: hud.ts).
    expect(near).toContain('<div class="bmore" hidden>');
    for (const line of [
      'The Near Woods: dry for about 8 minutes, then rain.', 'The Near Woods: restless. A surge comes in about 4 minutes.', 'The slab in the ring of stones is glowing.',
      'The Near Woods: clear. The next storm comes in about 13 minutes.', 'Today in the Near Woods: thick fog.', 'The fire lookout in the Near Woods: its lamp burns for about 37 minutes more, and its beam sweeps the woods.',
      'The footbridge by the pond, in the Near Woods: standing. 20 scrap put by, enough for 4 more days (it takes 5 a day). Nobody has given anything yet.',
      'The street light in the pond clearing, in the Near Woods: dark. 3 of 12 wire given, 9 more and it lights up again. Ana gave the most.',
      'Gone out: the cabin at the end. Bring something that burns.', 'Collapsed in the last hour: 2 in The Near Woods.',
    ]) expect(near).toContain(line);
    expect(far).toContain('Burning low: the trapper\'s cabin.');
  });

  it('says under the cards what is true of all of them: every shelter fire burning, and nobody collapsed', () => {
    const out = boardPanel(boardView({ regions: [NEAR], fires: { out: [], low: [], count: 5 } }), words).out;
    expect(out).toMatch(/data-tone="good">[\s\S]*?Every shelter fire is burning\./);
    expect(out).toMatch(/data-tone="good">[\s\S]*?Nobody collapsed in the last hour\./);
    expect(boardPanel(boardView(), words).out).not.toContain('Every shelter fire');
  });

  it('gives a region with nothing to say now a quiet line, and nothing to open', () => {
    const out = boardPanel(boardView({ sky: { kind: 'night', night: 'night', dawn: 600 }, regions: [{ id: 'south-road', name: 'The South Road', glowing: [] }] }), words).out;
    expect(out).toContain('The South Road');
    expect(out).toContain(QUIET);
    expect(out).not.toContain('data-card');
  });

  it('writes names as text, never as markup', () => {
    const out = boardPanel(boardView({ regions: [{ ...NEAR, name: '<b>Woods</b>' }] }), words).out;
    expect(out).toContain('&lt;b&gt;Woods&lt;/b&gt;');
    expect(out).not.toContain('<b>Woods');
  });
});

describe('the town', () => {
  it('shows the Old Stone, the ledger\'s works material by material, who came back and the first finders', () => {
    const town = boardPanel(boardView({
      stone: { charge: 3, need: 20, awake: false, left: 0 },
      town: { done: [{ id: 'edith-home', day: 3061 }, { id: 'board-shelter', day: 3062 }], given: { 'south-lights': { wire: 10 } } },
      firsts: [{ first: { secret: 'keepsake:brass-compass', name: 'Ana', day: 3052 }, title: 'the brass compass' }],
    }), words).town;
    expect(town).toContain('3 of 20 shards');
    expect(town).toMatch(/Asleep<\/span><span class="sbar"[^>]*><i style="transform:translateX\(-85\.0%\)"><\/i><\/span>/);
    expect(town).toContain('The street lights on the south road');
    expect(town).toMatch(/Copper wire<\/span><span class="sbar"[^>]*><i style="transform:translateX\(-16\.7%\)"><\/i><\/span><span class="n">10 of 12<\/span>/);
    expect(town).toMatch(/Scrap metal<\/span><span class="sbar"[^>]*><i style="transform:translateX\(-100\.0%\)"><\/i><\/span><span class="n">0 of 6<\/span>/);
    expect(town).toMatch(/data-tone="good">[\s\S]*?A roof over the notice board: mended for good/);
    expect(town).toContain('Edith, since day 3,061');
    expect(town).toContain('the brass compass: Ana, on day 3,052.');
    expect(boardPanel(boardView({ stone: { charge: 20, need: 20, awake: true, left: 7200 } }), words).town).toContain('Awake: surges are gentler for 2 h');
    expect(boardPanel(boardView(), words).town).toContain('Nothing new in town.');
  });
});

describe('the week', () => {
  it('says this week\'s condition and the next week\'s, the season and the Long Night', () => {
    const week = boardPanel(boardView({ conditions: { today: [], week: 'quiet-woods', next: 'copper-week' } }), words).week;
    const quiet = content.conditions!.weekly.find(c => c.id === 'quiet-woods')!;
    expect(week).toContain(`<b>Quiet woods</b>`);
    expect(week).toContain(`${quiet.text} Next week: copper week.`);
    expect(week).toContain('<b>Summer</b></span><p class="bsay">For about 6 days more: shorter rain, and light until later in the evening. Autumn comes next.</p>');
    expect(week).toContain('The Long Night comes in about 5 days: an aurora from dawn to dawn, and wire and strange objects grow back twice as fast.');
  });
});
