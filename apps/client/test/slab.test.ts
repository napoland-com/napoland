/**
 * The slab in the ring of stones, as the client shows it (slab.ts, roadmap/sealed-crates.md): A facing it
 * puts your hands to it (nothing is used up, so nothing is asked), the text box says why it did not move
 * or what the two of you took, and a tap above it does not walk to it (it lies flat).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { type ClientMsg, type ItemsData, type MapData, type PlayerView } from '@napoland/shared';
import { Game } from '../src/game';
import { Items } from '../src/items';
import { Maps } from '../src/maps';
import { SLAB, didText, didWho, slabRefusal } from '../src/said';
import { tinyTown, welcome } from './fixtures';

const items = new Items(JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/items.json'), 'utf8')) as ItemsData);

describe('what the slab says', () => {
  it('will not move for one pair of hands, lies cold while the woods are calm, and opens once each time', () => {
    expect(slabRefusal('one_pair')).toBe('It will not move for one pair of hands.');
    expect(slabRefusal('cold')).toBe('The slab lies still and cold. Its seams glow when the woods grow restless.');
    expect(slabRefusal('opened')).toBe('You have had what the slab holds this time. It glows again the next time the woods grow restless.');
    expect(slabRefusal('bag_full')).toBe('Your bag has no room for what the slab holds. Make room first.');
    expect(slabRefusal('too_far')).toBe('Face the slab from right beside it.');
  });

  it('says what the two of you took, by name', () => {
    const did = { kind: 'slab' as const, with: 'Bo', got: [{ item: 'strange', count: 2 }, { item: 'shard', count: 1 }] };
    expect(didWho(did, items)).toBe(SLAB);
    expect(didText(did, items)).toBe('Together with Bo, you lift the slab. You take 2 strange objects and a shard.');
  });
});

/** A 7x6 patch of woods that surges, with the slab at 3,2. */
function glade(): MapData {
  return {
    id: 'woods', name: 'The Glade', version: 1, kind: 'wilds', depth: 1, width: 7, height: 6,
    tiles: ['ttttttt', 'tgggggt', 'tgggggt', 'tgggggt', 'tgggggt', 'tttmttt'],
    levels: Array<string>(6).fill('0000000'),
    spawn: { x: 3, y: 4, dir: 'up' },
    exits: [{ x: 3, y: 5, w: 1, h: 1, to: 'town', tx: 3, ty: 1, dir: 'down', home: true }],
    objects: [{ kind: 'slab', x: 3, y: 2, name: 'the slab in the glade', holds: [{ item: 'shard', count: 1 }] }],
    surge: { every: 100, unstable: 20, surge: 10, sweep: 5 },
  };
}
const me = (x: number, y: number, dir: PlayerView['dir']): PlayerView => ({ id: 'me', name: 'Aldo', x, y, dir, color: '#f29e4c', gear: {}, quirks: [] });

let sent: ClientMsg[];
let g: Game;
beforeEach(() => {
  sent = [];
  g = new Game(new Maps([tinyTown(), glade()]), m => sent.push(m), items);
});

describe('at the slab', () => {
  it('puts your hands to it at A, facing it, asking nothing, and the box says what the server answered', () => {
    g.handle(welcome(glade(), [me(3, 3, 'up')], undefined, { items: items.version }), 1000);
    expect(g.action()).toMatchObject({ kind: 'talk', talker: { kind: 'slab', x: 3, y: 2 } });
    g.pressA();
    expect(g.question).toBeNull();
    expect(sent).toEqual([{ t: 'slab', x: 3, y: 2 }]);
    g.handle({ t: 'refused', action: 'slab', reason: 'one_pair' }, 1000);
    expect(g.note).toMatchObject({ who: SLAB, text: 'It will not move for one pair of hands.' });
    g.handle({ t: 'did', did: { kind: 'slab', with: 'Bo', got: [{ item: 'shard', count: 1 }] } }, 1000);
    expect(g.note).toMatchObject({ who: SLAB, text: 'Together with Bo, you lift the slab. You take a shard.' });
  });

  it('is not walked to by a tap on the tile above it: it lies flat, unlike people and signs', () => {
    g.handle(welcome(glade(), [me(3, 4, 'up')], undefined, { items: items.version }), 1000);
    g.tapTile(3, 1);
    // A walk onto the tile tapped (past the slab), not up to the slab to put your hands to it.
    expect(g.marker).toMatchObject({ x: 3, y: 1 });
  });
});
