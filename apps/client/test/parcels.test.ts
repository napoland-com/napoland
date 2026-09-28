import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ClientMsg, ItemsData, MapData, ParcelView, PlayerView } from '@napoland/shared';
import { cardPress, detailView } from '../src/details';
import { Game } from '../src/game';
import { cardHtml } from '../src/hud';
import { Items } from '../src/items';
import { Maps } from '../src/maps';
import { parcelBanner, parcelList, parcelNote, untold } from '../src/parcels';
import { newsBanner } from '../src/status';
import { FULL, tinyTown, welcome } from './fixtures';

/** What players read comes from the real items and the real calendar, so it is tested with them. */
const content = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/items.json'), 'utf8')) as ItemsData;
const items = new Items(content);
const day = (weekday: number): ParcelView => ({ weekday, items: content.parcels!.week[weekday]! });
const WELCOME: ParcelView = { weekday: null, items: content.parcels!.welcome };
const SUNDAY: ParcelView = { ...day(6), allWeek: content.parcels!.allWeek! };

describe('what the parcels say', () => {
  it('lists what came, as the calendar on the notice board does', () => {
    expect(parcelList(day(1).items, items)).toBe('a thermos, 2 scrap');
    expect(parcelList(WELCOME.items, items)).toBe('5 resin, 4 cloth, a thermos, 2 road flares');
  });

  it('says in a banner that a parcel waits in the chest, and what is in it', () => {
    expect(parcelBanner(WELCOME, items)).toEqual({ title: 'A parcel waits in your chest', sub: 'A welcome from the residents:\n5 resin, 4 cloth, a thermos, 2 road flares' });
    expect(parcelBanner(day(1), items)).toEqual({ title: 'A parcel waits in your chest', sub: 'Tuesday: a thermos, 2 scrap' });
    expect(parcelBanner(SUNDAY, items).sub).toBe('Sunday: 4 resin, a thermos\nand a NAPO lockbox, for coming back every day this week');
    expect(newsBanner({ kind: 'parcel', parcel: day(1) }, 'Stonebrook', items)).toEqual(parcelBanner(day(1), items));
  });

  it('says at the top of the stash what came, as "Tuesday\'s parcel: a thermos, 2 scrap"', () => {
    expect(parcelNote(day(1), items)).toBe("Tuesday's parcel: a thermos, 2 scrap");
    expect(parcelNote(day(5), items)).toBe("Saturday's parcel: 2 scrap, 2 wire, a road flare");
    expect(parcelNote(WELCOME, items)).toBe('Your welcome parcel: 5 resin, 4 cloth, a thermos, 2 road flares');
    expect(parcelNote(SUNDAY, items)).toBe("Sunday's parcel: 4 resin, a thermos, and a NAPO lockbox for coming back every day this week");
  });
});

describe('a NAPO lockbox in the stash', () => {
  const state = (count: number) => ({ items, bag: [], stash: [{ item: 'resin', count: 2 }, { item: 'lockbox', count }], gear: {}, worn: {} });

  it('shows its card with what it may hold, and its one button opens it', () => {
    const v = detailView({ from: 'stash', item: 'lockbox' }, state(1))!;
    expect(v).toMatchObject({ name: 'NAPO lockbox', count: 1, act: { label: 'Open', enabled: true, does: { kind: 'open', item: 'lockbox' } } });
    expect(v.notes).toEqual([{ text: 'Inside is one of these: 3 shards, a strange object, a charm or 6 cloth and 4 wire.', tone: 'plain' }]);
    expect(cardPress(v)).toEqual({ does: { kind: 'open', item: 'lockbox' }, close: true, shake: false });
    expect(cardHtml(v)).toContain('>Open</button>');
    // Never "Take out": it stays in the chest.
    expect(cardHtml(v)).not.toContain('Take');
  });

  it('opens one at a time, and has no card once none is left', () => {
    expect(detailView({ from: 'stash', item: 'lockbox' }, state(2))!.act?.label).toBe('Open one');
    expect(detailView({ from: 'stash', item: 'lockbox' }, { ...state(1), stash: [] })).toBeNull();
  });
});

/** A 5x4 room with the chest against the top wall at 2,1: stand at 2,2 facing up to open it. */
function room(): MapData {
  return {
    id: 'room', name: 'Home', version: 1, kind: 'inside', depth: 0, width: 5, height: 4, tiles: ['xxxxx', 'xpppx', 'xpppx', 'xxpxx'], levels: Array<string>(4).fill('00000'),
    spawn: { x: 2, y: 2, dir: 'up' }, exits: [{ x: 2, y: 3, w: 1, h: 1, to: 'town', tx: 3, ty: 1, dir: 'down' }], objects: [{ kind: 'chest', x: 2, y: 1 }],
  };
}
const me: PlayerView = { id: 'me', name: 'Aldo', x: 2, y: 2, dir: 'up', color: '#f29e4c', gear: {}, quirks: [] };

describe('the game, when a parcel comes and a lockbox is opened', () => {
  let sent: ClientMsg[];
  let g: Game;
  const now = 1000;
  beforeEach(() => {
    sent = [];
    g = new Game(new Maps([tinyTown(), room()]), m => sent.push(m), items);
    g.handle(welcome(room(), [me], FULL, { items: items.version }), now);
  });
  const openChest = () => {
    g.pressA();
    g.handle({ t: 'chest', stash: [{ item: 'lockbox', count: 1 }] }, now);
  };

  it('makes the news of a parcel, and tells the chest once what came since it last opened', () => {
    g.handle({ t: 'parcel', parcel: WELCOME }, now);
    g.handle({ t: 'parcel', parcel: day(1) }, now);
    // The welcome parcel comes with the first sign-in, which gives the NAPO work suit: its banner names it (wardrobe.test.ts).
    expect(g.news).toEqual([{ kind: 'parcel', parcel: WELCOME, outfits: ['napo-suit'] }, { kind: 'parcel', parcel: day(1) }]);
    expect(g.takeParcels()).toEqual([WELCOME, day(1)]);
    expect(g.takeParcels()).toEqual([]);
  });

  it('drops a parcel\'s banner still waiting to be shown once the stash\'s card has told it, and keeps the rest', () => {
    // The banners wait while a panel is open (main.ts): opened first, the chest tells the parcel instead.
    g.handle({ t: 'parcel', parcel: WELCOME }, now);
    g.handle({ t: 'feat', id: 'rain-walker', rank: 1, stats: { rainSteps: 1500 } }, now);
    const waiting = g.news.splice(0);
    const told = g.takeParcels();
    expect(untold(waiting, told)).toEqual([{ kind: 'feat', id: 'rain-walker', rank: 1 }]);
    // One that came after the card was shown still has its banner.
    g.handle({ t: 'parcel', parcel: day(1) }, now);
    expect(untold(g.news, told)).toEqual([{ kind: 'parcel', parcel: day(1) }]);
  });

  it('asks before opening it, sends it on YES, and the box says what was inside', () => {
    openChest();
    g.openSealed('lockbox');
    expect(g.askView()).toMatchObject({ who: 'NAPO lockbox', text: 'Open the NAPO lockbox? It has been sealed since the evacuation.', choice: 'yes', count: null });
    g.pressA();
    expect(sent.at(-1)).toEqual({ t: 'open', x: 2, y: 1, item: 'lockbox' });
    expect(g.noteView(now)).toMatchObject({ waiting: true });
    g.handle({ t: 'did', did: { kind: 'opened', item: 'lockbox', got: [{ item: 'humming-bead', count: 1 }] } }, now);
    expect(g.noteView(now)).toMatchObject({
      who: 'NAPO lockbox', text: 'Inside: a humming bead. While it is in your bag, what wants to cling to you in the dark thinks twice.', waiting: false,
    });
  });

  it('opens nothing on NO, and says in the same box why the server would not', () => {
    openChest();
    g.openSealed('lockbox');
    g.pressB();
    expect(sent.filter(m => m.t === 'open')).toEqual([]);
    g.openSealed('lockbox');
    g.answer('yes');
    g.handle({ t: 'refused', action: 'open', reason: 'not_stashed' }, now);
    expect(g.noteView(now)).toMatchObject({ who: 'NAPO lockbox', text: 'That is not in your stash.' });
  });

  it('asks nothing without an open chest', () => {
    g.openSealed('lockbox');
    expect(g.question).toBeNull();
    expect(sent.filter(m => m.t === 'open')).toEqual([]);
  });

  it('reads the calendar on the notice board page by page, as the server wrote it (net-parcels.test.ts)', () => {
    const lines = [
      "Parcels this week, from the town's stores. Mon: 3 resin, 2 cloth. Tue (today): a thermos, 2 scrap. Wed: 2 road flares, 2 cloth. Thu: 3 resin, 2 wire.",
      'Fri: a thermos, 3 cloth. Sat: 2 scrap, 2 wire, a road flare. Sun: 4 resin, a thermos, and a NAPO lockbox for whoever came back on all seven days.',
      'Sign in to get the parcels.',
    ];
    g.handle({ t: 'board', lines }, now);
    expect(g.dialog).toMatchObject({ who: 'Notice board', lines });
    const pages: string[] = [];
    while (g.dialog) {
      g.dialog.shown = Infinity;
      pages.push(g.dialog.lines[g.dialog.i]!);
      g.advanceDialog();
    }
    expect(pages).toEqual(lines);
  });
});
