/**
 * The Long Night on the client (roadmap/long-night.md): its banners as it begins and at dawn, the notice
 * board as the server writes it, Walt's word by the lodge's fire, and that fire fed like a shelter's
 * that night only.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TALK_TURN, type BagSlot, type ClientMsg, type ItemsData, type LongNightView, type MapData, type MapObject, type PlayerView } from '@napoland/shared';
import { Game } from '../src/game';
import { Items } from '../src/items';
import { Maps } from '../src/maps';
import { TENDED, waltOnTheLongNight } from '../src/said';
import { newsBanner } from '../src/status';
import { FULL, welcome } from './fixtures';

const content = (path: string): unknown => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../content/${path}`), 'utf8'));
const ITEMS = new Items(content('items.json') as ItemsData);
const lodge = content('maps/stonebrook-lodge.json') as MapData;
const walt = lodge.objects.find((o): o is Extract<MapObject, { kind: 'npc' }> => o.kind === 'npc' && o.id === 'walt')!;
const ON: LongNightView = { on: true, bonus: true, out: false };
const OFF: LongNightView = { on: false, bonus: true, out: false };

/** A game in the lodge, standing at x,y facing `dir` (by default below Walt, who is at 3,2), its fire (5,1) with `left` seconds of fuel (null: tended). */
function game(night: LongNightView, left: number | null, at: { x: number; y: number; dir: PlayerView['dir'] } = { x: 3, y: 3, dir: 'up' }, bag: BagSlot[] = []) {
  const sent: ClientMsg[] = [];
  const g = new Game(new Maps([lodge]), m => sent.push(m), ITEMS);
  const me: PlayerView = { id: 'me', name: 'Aldo', ...at, color: '#d9a53a', gear: {}, quirks: [] };
  g.handle(welcome(lodge, [me], FULL, { items: ITEMS.version, longNight: night, fires: [{ x: 5, y: 1, left }], bag }), 1000);
  return { g, sent };
}
const talk = (g: Game) => {
  g.pressA();
  return g.dialog?.lines;
};

describe('the Long Night\'s banners', () => {
  it('says as it begins what it does, and at dawn whether the lodge\'s fire held', () => {
    expect(newsBanner({ kind: 'longNight', on: true, bonus: true }, 'Stonebrook', ITEMS)).toEqual({
      title: 'The Long Night begins',
      sub: 'An aurora from dawn to dawn, and wire and strange objects grow back twice as fast.\nThe lodge\'s fire needs feeding until dawn: bring resin or cloth.',
    });
    expect(newsBanner({ kind: 'longNight', on: true, bonus: false }, 'Stonebrook', ITEMS)).toEqual({
      title: 'The Long Night begins', sub: 'Only long and dark this time: the lodge\'s fire went out last week.\nKeep it fed until dawn, and the next one has its bonus again.',
    });
    expect(newsBanner({ kind: 'longNight', on: false, bonus: true }, 'Stonebrook', ITEMS)).toEqual({
      title: 'Dawn. The lodge\'s fire held.', sub: 'Next week\'s Long Night keeps its bonus: wire and strange objects grow back twice as fast.',
    });
    expect(newsBanner({ kind: 'longNight', on: false, bonus: false }, 'Stonebrook', ITEMS)).toEqual({
      title: 'Dawn. The lodge\'s fire went out.', sub: 'Next week\'s Long Night will only be long and dark.',
    });
  });

  it('comes once as it begins and once at dawn: the fire going out in the night, and arriving in it, bring none', () => {
    const { g } = game(OFF, null);
    g.takeNews(1000);
    g.handle({ t: 'longNight', night: ON }, 2000);
    g.handle({ t: 'longNight', night: { ...ON, out: true } }, 3000);
    g.handle({ t: 'longNight', night: { on: false, bonus: false, out: false } }, 4000);
    expect(g.takeNews(4000).filter(n => n.kind === 'longNight')).toEqual([{ kind: 'longNight', on: true, bonus: true }, { kind: 'longNight', on: false, bonus: false }]);
    expect(g.longNight).toEqual({ on: false, bonus: false, out: false });
    expect(game(ON, 900).g.takeNews(1000).filter(n => n.kind === 'longNight')).toEqual([]);
  });
});

describe('the notice board and Walt', () => {
  it('shows the notice board as the server writes it', () => {
    const { g } = game(ON, 1080);
    const lines = [
      'The Long Night: no rain anywhere. Dawn in about 30 minutes.',
      'Tonight wire and strange objects grow back twice as fast, and the watchers are restless.',
      'The lodge\'s fire needs feeding tonight: 18 minutes left. If it lasts until dawn, next week\'s Long Night keeps its bonus.',
    ];
    g.handle({ t: 'board', lines }, 2000);
    expect(g.dialog).toMatchObject({ who: 'Notice board', lines });
  });

  it('has Walt ask for fuel first on the Long Night, with how long his fire has, and say it when it went out; any other night, what he always says', () => {
    expect(talk(game(ON, 1080).g)).toEqual(['Long Night tonight. Nobody keeps this fire alone tonight, not me either: it wants resin and cloth from whoever\'s about, till dawn. There\'s about 18 minutes in it.', ...walt.lines.slice(0, TALK_TURN)]);
    expect(talk(game({ ...ON, out: true }, 0).g)).toEqual(['It went out on us. Light it again if you\'ve got something that burns, but the woods will know it went out.', ...walt.lines.slice(0, TALK_TURN)]);
    // What he always says comes a few lines a talk, the next talk taking up where the last left off.
    const other = game(OFF, null).g;
    expect(talk(other)).toEqual(walt.lines.slice(0, TALK_TURN));
    other.dialog = null;
    expect(talk(other)).toEqual(walt.lines.slice(TALK_TURN, 2 * TALK_TURN));
    // Under a minute, or somewhere he cannot see it.
    expect(waltOnTheLongNight(false, 45)).toBe('Long Night tonight. Nobody keeps this fire alone tonight, not me either: it wants resin and cloth from whoever\'s about, till dawn. It\'s nearly out.');
    expect(waltOnTheLongNight(false, null)).toBe('Long Night tonight. Nobody keeps this fire alone tonight, not me either: it wants resin and cloth from whoever\'s about, till dawn.');
  });

  it('asks to feed the lodge\'s fire that night, and says someone keeps it going any other', () => {
    const byFire = { x: 5, y: 2, dir: 'up' } as const, resin: BagSlot[] = [{ item: 'resin', count: 3 }];
    const night = game(ON, 600, byFire, resin).g;
    night.pressA();
    expect(night.question?.text).toBe('Feed the fire resin?');
    const other = game(OFF, null, byFire, resin).g;
    other.pressA();
    expect(other.note?.text).toBe(TENDED);
  });
});
