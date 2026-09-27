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
import type { Mods } from './feats';
import type { Element, Piece, Quirk, Recipe, Slot, Tier } from './gear';
import type { ConditionsData } from './sky';
import { objectTiles, type MapObject, type TileKind, type TileMap } from './map';

/**
 * A resource is gathered, a consumable used up, a charm works while it is in your bag, gear is worn
 * (gear.ts). A tool is yours for good: never used up, never in a pile, weighing nothing, and it takes
 * no bag slot (players carry their tools apart from the bag, like what they wear).
 */
export type ItemKind = 'resource' | 'consumable' | 'charm' | 'gear' | 'tool';

/** What using an item does. A mark costs the item; so does everything else here. */
export interface ItemUse {
  /** Energy back (or lost, below 0). */
  energy?: number;
  /** Paint a glowing arrow on the ground where you stand, pointing where you face. Everyone sees it for a day. */
  mark?: boolean;
  /** Light a flare for this many seconds: creatures keep away from it, and whatever clings to you lets go. */
  flare?: number;
  /** Look at it closely, which needs a roof and light in town: it turns into one of its `reveals`. */
  identify?: boolean;
}

export interface ItemDef {
  /** Stable id, e.g. "glowcap"; bags and saves refer to it. */
  id: string;
  name: string;
  kind: ItemKind;
  /** How many fit in one bag slot. */
  stack: number;
  /** One or two plain sentences, shown in the bag. */
  text: string;
  /** What using it does. Consumables must do something; a resource may (a glowcap paints a mark). */
  use?: ItemUse;
  /** XP for each one put into your stash at home (progress.ts). None: it earns nothing. */
  xp?: number;
  /** Kilograms. A bag heavier than CARRY_KG drains energy faster. None: it weighs nothing to speak of. */
  weight?: number;
  /** Seconds a fire burns longer when you feed it one. */
  fuel?: number;
  /** How much one wakes the Old Stone (a shard: 1). */
  charge?: number;
  /** What it may turn out to be when identified: the chance of each is its weight over the sum. */
  reveals?: Array<{ item: string; count: number; weight: number }>;
  /** What a charm does while it is in your bag, as factors (feats.ts). */
  charm?: Partial<Mods>;
  /** Gear only: the slot it is worn in, its tier, what it resists (0.3: 30% of the loss) and extra energy it gives. */
  slot?: Slot;
  tier?: Tier;
  resist?: Partial<Record<Element, number>>;
  bonus?: number;
  /** A bag's slots. */
  bag?: number;
  /** Gear: its color on your character. */
  color?: string;
  /** A paper map (a tool): the id of the map it is a drawing of. */
  chart?: string;
  /**
   * Live: worth `xp` if stashed within `fresh` seconds of being picked, then `fade` XP less every
   * minute until it is worth no more than `into` (a plain item), which it then becomes (liveXp, liveEnds).
   * While someone carries one it glows: everyone on the map sees them, and watchers come from farther.
   */
  live?: { xp: number; fresh: number; fade: number; into: string };
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
  /**
   * Only then, and gone as soon as it is over: while the region is restless before a surge (and
   * during it), during an aurora night, or while a storm blows over the region. Left out: always.
   */
  when?: FindWhen;
  /** Only while this daily or weekly condition is on (sky.ts, conditionsAt), and gone when it is over. Never with `when`. */
  condition?: string;
  /** Only within `r` tiles (center to center) of tile x,y: crates by the pond. */
  around?: { x: number; y: number; r: number };
}

export type FindWhen = 'unstable' | 'aurora' | 'storm';

export interface ItemsData {
  /** Bump when items or finds change; a client with another version reloads. */
  version: number;
  items: ItemDef[];
  finds: FindRule[];
  /** What the workbench in town makes (gear.ts). None: it makes nothing. */
  recipes?: Recipe[];
  /** Seconds out in the wilds that wear gear of each tier out (gear.ts); a tier left out never wears. */
  wear?: Partial<Record<Tier, number>>;
  /** What mending a piece of each tier costs at the workbench, from the stash. */
  mend?: Partial<Record<Tier, BagSlot[]>>;
  /** Names and words for the quirks of anomalous gear (gear.ts, QUIRKS). */
  quirks?: Array<{ id: Quirk; name: string; text: string }>;
  /** What the woods are like today and this week (sky.ts). None: nothing changes from day to day. */
  conditions?: ConditionsData;
}

/** One bag slot: an item and how many of it (at most its stack). In a stash's list, a piece of gear comes with its condition and quirk. */
export interface BagSlot {
  item: string;
  count: number;
  piece?: Piece;
  /** A live item, in the saved bag: when it was picked (ms since the epoch). The server's clock only. */
  since?: number;
  /** A live item, as the client hears its bag: seconds since it was picked, when the message was sent. */
  age?: number;
}

/**
 * The tools everyone carries: for now a paper map of every area there is (the town, the Near Woods, the
 * South Road). Later some areas will have none until one is found out there.
 */
export const STARTER_TOOLS: readonly string[] = ['stonebrook-map', 'near-woods-map', 'south-road-map'];

/** Slots in the bag until the bag becomes equipment (a tote 6, a backpack 8, a hiking pack 12...). */
export const BAG_SLOTS = 8;
/** A pile dropped on collapse fades this long after the collapse. */
export const DROP_LIFETIME_MS = 60 * 60 * 1000;
/** What you carry easily. A heavier bag drains energy faster (energy.ts, LOAD_DRAIN). */
export const CARRY_KG = 10;

/** What a bag weighs over what you carry easily: 0 empty, 1 at CARRY_KG, more beyond. `lighter` scales it (a feat, a charm). */
export function bagLoad(bag: readonly BagSlot[], items: Map<string, ItemDef>, lighter = 1): number {
  const kg = bag.reduce((sum, s) => sum + s.count * (items.get(s.item)?.weight ?? 0), 0);
  return Math.round((kg * lighter / CARRY_KG) * 1000) / 1000;
}

/** The charms in a bag, one of each kind (two of the same do not work twice). */
export function charmsIn(bag: readonly BagSlot[], items: Map<string, ItemDef>): Array<Partial<Mods>> {
  const seen = new Set<string>();
  const out: Array<Partial<Mods>> = [];
  for (const s of bag) {
    const def = items.get(s.item);
    if (def?.kind !== 'charm' || !def.charm || seen.has(def.id)) continue;
    seen.add(def.id);
    out.push(def.charm);
  }
  return out;
}

/** One of `reveals`, by weight; undefined for an empty list. */
export function reveal(list: NonNullable<ItemDef['reveals']>, rng: () => number): { item: string; count: number } | undefined {
  const total = list.reduce((n, r) => n + Math.max(0, r.weight), 0);
  let roll = rng() * total;
  for (const r of list) {
    roll -= Math.max(0, r.weight);
    if (roll < 0) return { item: r.item, count: r.count };
  }
  const last = list.at(-1);
  return last && { item: last.item, count: last.count };
}

/** What a live item is worth `ageS` seconds after it was picked: its full XP while fresh, then less each minute, never below `into`'s. */
export function liveXp(def: ItemDef, ageS: number, into?: ItemDef): number {
  const live = def.live;
  if (!live) return def.xp ?? 0;
  if (ageS <= live.fresh) return live.xp;
  return Math.max(into?.xp ?? 0, live.xp - live.fade * Math.ceil((ageS - live.fresh) / 60));
}

/** Seconds after picking when a live item has faded down to `into` and becomes one. */
export function liveEnds(def: ItemDef, into?: ItemDef): number {
  const live = def.live;
  if (!live) return 0;
  return live.fresh + Math.ceil((live.xp - (into?.xp ?? 0)) / live.fade) * 60;
}

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
    // A live item keeps when it was picked (it stacks one to a slot, so its slots are new ones).
    if (a.since !== undefined) for (const s of r.bag.slice(out.length)) s.since = a.since;
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

/** Every tile a find may grow on: walkable, not an exit, and fitting the rule's tiles, steps, nearness and place. */
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
    if (rule.around && Math.hypot(rule.around.x - x, rule.around.y - y) > rule.around.r) continue;
    if (rule.near && !near.some(([ox, oy]) => Math.hypot(ox - x, oy - y) <= rule.near!.radius)) continue;
    out.push({ x, y });
  }
  return out;
}
