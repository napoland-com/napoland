/**
 * Items, the bag, and where finds grow. Items are data (content/items.json) so the list can grow and
 * be tuned without code. The rules here are pure functions used by the server (which owns every bag)
 * and the client (which shows it).
 *
 * Finds are shared: one lies somewhere on a map until someone picks it up; then a new one of the
 * same kind grows after a while on another tile that fits the same rule, so deep finds stay deep.
 * When you collapse, what you carry falls out as a pile where you fell: you get it all back, anyone
 * else gets a random half (the rest is lost), and it fades an hour after the collapse.
 */
import { objectTiles, type MapObject, type TileKind, type TileMap } from './map';

export type ItemKind = 'resource' | 'consumable';

export interface ItemDef {
  /** Stable id, e.g. "glowcap"; bags and saves refer to it. */
  id: string;
  name: string;
  kind: ItemKind;
  /** How many fit in one bag slot. */
  stack: number;
  /** One or two plain sentences, shown in the bag. */
  text: string;
  /** What using it does; only consumables can be used. */
  use?: { energy?: number };
}

/** Where one kind of find grows, and how many are out there at once. */
export interface FindRule {
  item: string;
  map: string;
  /** Tile kinds it grows on; any walkable tile when left out. */
  on?: TileKind[];
  /** In the wilds: walking steps from the home exit, both ends included. */
  steps?: [number, number];
  /** Only within `radius` tiles (center to center) of any tile one of these objects covers, e.g. scrap near wrecks. */
  near?: { kinds: Array<MapObject['kind']>; radius: number };
  /** How many lie out there at once. */
  count: number;
  /** Seconds before a picked one grows back somewhere else: a random time in this range. */
  respawn: [number, number];
}

export interface ItemsData {
  /** Bump when items or finds change; a client with another version reloads. */
  version: number;
  items: ItemDef[];
  finds: FindRule[];
}

/** One bag slot: an item and how many of it (at most its stack). */
export interface BagSlot {
  item: string;
  count: number;
}

/** Slots in the bag until the bag becomes equipment (a tote 6, a backpack 8, a hiking pack 12...). */
export const BAG_SLOTS = 8;
/** A pile dropped on collapse fades this long after the collapse. */
export const DROP_LIFETIME_MS = 60 * 60 * 1000;

/** Items by id. */
export function itemIndex(data: ItemsData): Map<string, ItemDef> {
  return new Map(data.items.map(i => [i.id, i]));
}

/**
 * Puts `count` of an item into a bag: first topping up slots that already hold it, then new slots.
 * Returns the new bag (the old one is left alone) and how many did not fit.
 */
export function addToBag(bag: readonly BagSlot[], item: ItemDef, count: number, slots = BAG_SLOTS): { bag: BagSlot[]; left: number } {
  const out = bag.map(s => ({ ...s }));
  let left = Math.max(0, Math.floor(count));
  for (const s of out) {
    if (!left) break;
    if (s.item !== item.id || s.count >= item.stack) continue;
    const put = Math.min(left, item.stack - s.count);
    s.count += put;
    left -= put;
  }
  while (left > 0 && out.length < slots) {
    const put = Math.min(left, item.stack);
    out.push({ item: item.id, count: put });
    left -= put;
  }
  return { bag: out, left };
}

/** Puts several stacks into a bag, in order; what does not fit comes back in `left`. */
export function addAllToBag(bag: readonly BagSlot[], add: readonly BagSlot[], items: Map<string, ItemDef>, slots = BAG_SLOTS): { bag: BagSlot[]; left: BagSlot[] } {
  let out = bag.map(s => ({ ...s }));
  const left: BagSlot[] = [];
  for (const a of add) {
    const def = items.get(a.item);
    if (!def) continue; // an item that no longer exists is dropped silently
    const r = addToBag(out, def, a.count, slots);
    out = r.bag;
    if (r.left) left.push({ item: a.item, count: r.left });
  }
  return { bag: out, left };
}

/** Takes `count` (default: all) out of one slot; an emptied slot is removed. */
export function takeFromBag(bag: readonly BagSlot[], slot: number, count = Infinity): BagSlot[] {
  const out = bag.map(s => ({ ...s }));
  const s = out[slot];
  if (!s) return out;
  s.count -= Math.min(s.count, count);
  if (s.count <= 0) out.splice(slot, 1);
  return out;
}

/** The same items with equal kinds joined (for piles and messages; ignores stack sizes). */
export function merge(items: readonly BagSlot[]): BagSlot[] {
  const by = new Map<string, number>();
  for (const s of items) if (s.count > 0) by.set(s.item, (by.get(s.item) ?? 0) + s.count);
  return [...by].map(([item, count]) => ({ item, count }));
}

/**
 * A random half of a pile, for someone who is not its owner: exactly half of the units, chosen at
 * random, and an odd one out goes either way by a coin toss (so on average it is exactly half).
 */
export function halfOf(items: readonly BagSlot[], rng: () => number): BagSlot[] {
  const units: string[] = [];
  for (const s of items) for (let i = 0; i < s.count; i++) units.push(s.item);
  // Fisher-Yates, then keep the first half.
  for (let i = units.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [units[i], units[j]] = [units[j]!, units[i]!];
  }
  const keep = Math.floor(units.length / 2) + (units.length % 2 && rng() < 0.5 ? 1 : 0);
  return merge(units.slice(0, keep).map(item => ({ item, count: 1 })));
}

/** Every tile a find may grow on: walkable, not an exit, and fitting the rule's tiles, steps and nearness. */
export function findTiles(map: TileMap, rule: FindRule): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  // Measured from every tile an object covers, so a cabin or a car is near from all sides alike.
  const near = rule.near ? map.data.objects.filter(o => rule.near!.kinds.includes(o.kind)).flatMap(objectTiles) : [];
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    if (!map.walkable(x, y) || map.exitAt(x, y)) continue;
    if (rule.on && !rule.on.includes(map.kind(x, y)!)) continue;
    if (rule.steps) {
      const s = map.homeSteps(x, y);
      if (s < rule.steps[0] || s > rule.steps[1]) continue;
    }
    if (rule.near && !near.some(([ox, oy]) => Math.hypot(ox - x, oy - y) <= rule.near!.radius)) continue;
    out.push({ x, y });
  }
  return out;
}
