import { beforeEach, describe, expect, it } from 'vitest';
import { TOOL_ICONS, type ClientMsg, type ItemDef, type ItemsData, type MapData, type PlayerView } from '@napoland/shared';
import { Game } from '../src/game';
import { MAP_ICON, TOOL_DRAWINGS, iconFor, itemIcon } from '../src/icons';
import { Items, recipeViews, refusalText, toolViews } from '../src/items';
import { Maps } from '../src/maps';
import { FULL, itemsData, tinyTown, welcome } from './fixtures';

/** Two maps and a radio, like the tools of content/items.json and one made up for the tests. */
const tool = (id: string, name: string, more: Partial<ItemDef> = {}): ItemDef => ({ id, name, kind: 'tool', stack: 1, icon: 'map', text: `${name}: yours.`, ...more });
const data: ItemsData = {
  ...itemsData(),
  items: [
    ...itemsData().items,
    tool('town-map', 'Map of Testbrook', { chart: 'town' }),
    tool('woods-map', 'Map of the Test Woods', { chart: 'woods' }),
    tool('radio', 'Radio'),
    tool('cutters', 'Bolt cutters'),
  ],
  recipes: [{ id: 'radio', make: 'radio', needs: [{ item: 'shard', count: 2 }] }],
};
const items = new Items(data);

describe("the bag's header", () => {
  it('shows every map you own as the one map button, where the first came, and each other tool beside it, in the order you got them', () => {
    const map = { item: null, label: 'Open the map', icon: MAP_ICON };
    const radio = { item: 'radio', label: 'Radio', icon: iconFor(items.get('radio')) };
    const cutters = { item: 'cutters', label: 'Bolt cutters', icon: iconFor(items.get('cutters')) };
    // Everyone's starter maps, then two tools of their own: three buttons.
    expect(toolViews(['town-map', 'woods-map', 'radio', 'cutters'], items)).toEqual([map, radio, cutters]);
    // A map found later joins the map button.
    expect(toolViews(['town-map', 'radio', 'woods-map', 'cutters'], items)).toEqual([map, radio, cutters]);
    expect(toolViews(['radio', 'town-map'], items)).toEqual([radio, map]);
    expect(toolViews(['town-map'], items)).toEqual([map]);
  });

  it('has no map button without a map, and no button for what is no tool', () => {
    expect(toolViews([], items)).toEqual([]);
    expect(toolViews(['radio', 'glowcap', 'nothing-known'], items).map(v => v.item)).toEqual(['radio']);
  });

  it('draws every tool icon the content can name, none of them a sack, and a tool by the icon it names', () => {
    for (const icon of TOOL_ICONS) {
      expect(TOOL_DRAWINGS[icon], icon).toMatch(/^<svg viewBox="0 0 32 32"[^>]*>[\s\S]*<\/svg>$/);
      expect(TOOL_DRAWINGS[icon], icon).not.toBe(itemIcon('fir-cone'));
    }
    expect(iconFor(items.get('radio'))).toBe(TOOL_DRAWINGS.map);
    // A tool that names no icon (content that failed validation): a map if it charts one, else a sack.
    expect(iconFor({ ...items.get('town-map'), icon: undefined })).toBe(MAP_ICON);
    expect(iconFor({ ...items.get('radio'), icon: undefined })).toBe(itemIcon('fir-cone'));
  });
});

describe('a tool at the workbench', () => {
  it('can be made while you have none; then its row says you have it, and it cannot be made again', () => {
    const stash = [{ item: 'shard', count: 3 }];
    expect(recipeViews(data.recipes!, stash, items)[0]).toMatchObject({ id: 'radio', name: 'Radio', can: true, facts: 'A tool, yours for good' });
    expect(recipeViews(data.recipes!, stash, items, ['town-map'])[0]!.act).toBeUndefined();
    expect(recipeViews(data.recipes!, stash, items, ['town-map', 'radio'])[0]).toMatchObject({ can: false, act: 'You have it' });
  });

  it('says why one was refused, in plain words', () => {
    expect(refusalText('have_tool', 'craft')).toBe('You have one already');
    expect(refusalText('have_tool', 'pick')).toBe('You have one already. It stays for someone else');
  });
});

describe('tools in the game', () => {
  /** A 5x4 room: stand at 2,2 facing up. */
  const room: MapData = {
    id: 'room', name: 'Lodge', version: 1, kind: 'inside', depth: 0, width: 5, height: 4,
    tiles: ['xxxxx', 'xpppx', 'xpppx', 'xxpxx'], levels: Array<string>(4).fill('00000'),
    spawn: { x: 2, y: 2, dir: 'up' }, exits: [{ x: 2, y: 3, w: 1, h: 1, to: 'town', tx: 3, ty: 1, dir: 'down' }], objects: [],
  };
  const me: PlayerView = { id: 'me', name: 'Aldo', x: 2, y: 2, dir: 'up', color: '#f29e4c', gear: {}, quirks: [] };
  let g: Game;
  let sent: ClientMsg[];
  const now = 1000;
  beforeEach(() => {
    sent = [];
    g = new Game(new Maps([tinyTown(), room]), m => sent.push(m), items);
    g.handle(welcome(room, [me], FULL, { tools: ['town-map', 'woods-map'] }), now);
  });

  it('are the welcome\'s, then the whole list again whenever you get one', () => {
    expect(g.tools).toEqual(['town-map', 'woods-map']);
    const before = g.tools;
    g.handle({ t: 'tools', tools: ['town-map', 'woods-map', 'radio'] }, now);
    expect(g.tools).toEqual(['town-map', 'woods-map', 'radio']);
    // A new list, so the header is redrawn.
    expect(g.tools).not.toBe(before);
  });

  it('floats a tool you got by its name, without a count; one made at the workbench only once', () => {
    g.handle({ t: 'got', items: [{ item: 'radio', count: 1 }], from: 'tool' }, now);
    g.handle({ t: 'tools', tools: ['town-map', 'woods-map', 'radio'] }, now);
    g.handle({ t: 'crafted', item: 'radio', count: 1 }, now);
    expect(g.floats.map(f => f.text)).toEqual(['+ Radio']);
    g.handle({ t: 'refused', action: 'pick', reason: 'have_tool' }, now);
    expect(g.floats.map(f => f.text).at(-1)).toBe('You have one already. It stays for someone else');
  });

  it('says what a tool is in the text box when its button is tapped', () => {
    g.read('Radio', [items.get('radio').text]);
    expect(g.dialog).toMatchObject({ who: 'Radio', lines: ['Radio: yours.'] });
    g.advanceDialog();
    g.advanceDialog();
    expect(g.dialog).toBeNull();
    g.read('Nothing', []);
    expect(g.dialog).toBeNull();
    expect(sent).toEqual([]);
  });
});
