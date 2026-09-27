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
  const u = item.use ?? {};
  if (u.energy) return `${u.energy > 0 ? '+' : ''}${u.energy} energy`;
  if (u.mark) return 'You marked the way';
  if (u.flare) return 'The flare hisses red';
  if (u.identify) return 'You turn it over in the light';
  return `Used the ${item.name.toLowerCase()}`;
}

/** The word on the bag's button for using an item. */
export function useLabel(item: ItemDef): string {
  const u = item.use ?? {};
  if (u.mark) return 'Mark the way';
  if (u.flare) return 'Light it';
  if (u.identify) return 'Look closely';
  if (u.energy) return 'Drink';
  return 'Use';
}

/** Why the server said no, in plain words, for a float over your head. */
export function refusalText(reason: Refusal): string {
  switch (reason) {
    case 'bag_full': return 'Your bag is full';
    case 'too_far': return 'Too far';
    case 'gone': return 'Someone got there first';
    case 'not_usable': return 'That cannot be used';
    case 'empty_slot': return 'That slot is empty';
    case 'not_here': return 'Not here';
    case 'not_fuel': return 'That will not burn';
    case 'fire_full': return 'The fire is as big as it gets';
    case 'tended': return 'Someone keeps this fire going';
    case 'marked': return 'There is a mark here already';
  }
}

/** One bag slot as the bag shows it. */
export interface SlotView {
  item: string;
  name: string;
  text: string;
  count: number;
  /** It can be used: the bag offers a button, with this word on it. */
  usable: boolean;
  useLabel: string;
  /** Small facts under the text: how heavy, what it does in a fire or in your bag. */
  facts: string[];
}

export function slotViews(bag: readonly BagSlot[], items: Items): SlotView[] {
  return bag.map(s => {
    const def = items.get(s.item);
    return { item: s.item, name: def.name, text: def.text, count: s.count, usable: !!def.use, useLabel: useLabel(def), facts: factsOf(def) };
  });
}

/** What is worth knowing about an item besides its text, in a few words each. */
export function factsOf(def: ItemDef): string[] {
  const out: string[] = [];
  if (def.weight) out.push(def.weight >= 0.95 ? `${Math.round(def.weight * 10) / 10} kg` : `${Math.round(def.weight * 1000)} g`);
  if (def.fuel) out.push(`Burns ${Math.round(def.fuel / 60)} min`);
  if (def.charge) out.push('The Old Stone wants it');
  if (def.kind === 'charm') out.push('Works while in your bag');
  return out;
}

/** How many of an item a bag holds, over all its slots. */
export function countOf(bag: readonly BagSlot[], item: string): number {
  return bag.reduce((n, s) => n + (s.item === item ? s.count : 0), 0);
}
