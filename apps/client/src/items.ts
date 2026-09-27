/**
 * What things are. The items (content/items.json) ship with the client like the maps, so a bag or a
 * find can be named and shown without asking the server. The server's welcome says which version it
 * runs; a client with another one is out of date and reloads (main.ts).
 * Plain logic with no drawing, so it can be tested.
 */
import { itemIndex, type BagSlot, type ItemDef, type ItemsData, type Refusal } from '@napoland/shared';

export class Items {
  /** The version of content/items.json this client carries; 0 when it has none. */
  readonly version: number;
  private readonly byId: Map<string, ItemDef>;

  constructor(data: ItemsData | undefined) {
    this.version = data?.version ?? 0;
    this.byId = data ? itemIndex(data) : new Map();
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /**
   * An item by id. One this copy does not know (it should not happen, the versions match) gets a
   * plain stand-in named after its id, so the bag still shows something sensible.
   */
  get(id: string): ItemDef {
    return this.byId.get(id) ?? { id, name: plainName(id), kind: 'resource', stack: 1, text: 'Something you found out there.' };
  }
}

/** "fir-resin" becomes "Fir resin". */
export function plainName(id: string): string {
  const s = id.replace(/[-_]+/g, ' ').trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : 'Something';
}

/** What using an item did, for a float over your head: "+30 energy". */
export function useText(item: ItemDef): string {
  const e = item.use?.energy;
  return e ? `${e > 0 ? '+' : ''}${e} energy` : `Used the ${item.name.toLowerCase()}`;
}

/** Why the server said no, in plain words, for a float over your head. */
export function refusalText(reason: Refusal): string {
  switch (reason) {
    case 'bag_full': return 'Your bag is full';
    case 'too_far': return 'Too far';
    case 'gone': return 'Someone got there first';
    case 'not_usable': return 'That cannot be used';
    case 'empty_slot': return 'That slot is empty';
  }
}

/** One bag slot as the bag shows it. */
export interface SlotView {
  item: string;
  name: string;
  text: string;
  count: number;
  /** A consumable: the bag offers Use. */
  usable: boolean;
}

export function slotViews(bag: readonly BagSlot[], items: Items): SlotView[] {
  return bag.map(s => {
    const def = items.get(s.item);
    return { item: s.item, name: def.name, text: def.text, count: s.count, usable: def.kind === 'consumable' };
  });
}

/** How many of an item a bag holds, over all its slots. */
export function countOf(bag: readonly BagSlot[], item: string): number {
  return bag.reduce((n, s) => n + (s.item === item ? s.count : 0), 0);
}
