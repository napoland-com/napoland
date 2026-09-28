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
import type { Comfort } from './comfort';
import type { Mods } from './feats';
import type { Element, Piece, Quirk, Recipe, Slot, Tier, Upgrade } from './gear';
import type { ParcelsData } from './parcels';
import type { ConditionsData, Season } from './sky';
import { objectTiles, type MapObject, type TileKind, type TileMap, type TownGate } from './map';
import type { KeepsakesData } from './notes';
import type { SwapDef, TownData } from './town';

/**
 * A resource is gathered, a consumable used up, a charm works while it is in your bag, gear is worn
 * (gear.ts). A tool is yours for good, once made at the workbench or found: never used up, never in a
 * pile, the stash or a trade, weighing nothing, and it takes no bag slot (players keep their tools
 * apart from the bag, like what they wear: a button each in the bag's header). A sealed thing (a NAPO
 * lockbox) stays in the chest at home and is opened there: it holds one of its `holds`. A keepsake is
 * one of a kind, left behind by someone (notes.ts): each player finds their own where it lies, once,
 * and brought home it stays there for good, apart from the stash. Furniture is made at the workbench for
 * a place in your own cabin (comfort.ts) and set in it at once: never in the bag, the stash, a pile or a
 * trade. A bundle is someone else's pile tied up to carry to the lodge for them (lostfound.ts): only ever
 * packed from a pile, never opened, traded, left in a crate, stashed or thrown away.
 */
export type ItemKind = 'resource' | 'consumable' | 'charm' | 'gear' | 'tool' | 'sealed' | 'keepsake' | 'furniture' | 'bundle';

/** One thing a sealed item may hold, by weight: these items, or one item of kind `any`, every one of that kind alike (any charm). */
export interface Holding {
  weight: number;
  items?: BagSlot[];
  any?: ItemKind;
}

/**
 * The drawings a tool's button in the bag's header can show: content/items.json names one for each
 * tool (`icon`), and the client draws each (icons.ts). A tool that needs a new drawing adds it here.
 */
export const TOOL_ICONS = ['map', 'radio', 'cutters', 'waders'] as const;
export type ToolIcon = (typeof TOOL_ICONS)[number];

/**
 * What a tool that listens (the radio) picks up out in the wilds: the finds of these items lying on
 * the map (`when: 'aurora'`: only on aurora nights), loud within `loud` tiles of the nearest, faint
 * within `faint`, nothing past that. Only ever from what the player's game already knows is there.
 */
export interface Senses {
  finds: Array<{ item: string; when?: 'aurora' }>;
  loud: number;
  faint: number;
}

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
  /**
   * An effect (effects.ts): for `lasts` seconds you resist these elements that much more (a hand warmer:
   * cold 0.4 for 300), on top of your gear and under the same cap. A second of the same item while the
   * first still works starts its time again: it never adds up.
   */
  resist?: Partial<Record<Element, number>>;
  lasts?: number;
  /**
   * A meal cooked at a fire (meals.ts), eaten or drunk as this says: what it does is the item's `eaten`,
   * until you come home or collapse.
   */
  meal?: 'eat' | 'drink';
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
  /**
   * How a sentence names one of it, and several ("shard", "shards"; "resin", "resin"; "rubber gloves"
   * for both). Left out: the name as a word in a sentence, and that with an s (unless it ends in one).
   * A noun that is its own plural is never counted with "a": "Feed the fire resin?", "Make rubber gloves?"
   */
  noun?: string;
  plural?: string;
  /** One plain sentence on what it is good for, said when a strange object turns out to be it, a lockbox holds it, or you make it. */
  about?: string;
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
  /** Sealed: what it may hold when opened, one of these by weight (openSealed). */
  holds?: Holding[];
  /** Sealed: one plain sentence said with the question before it is opened ("It has been sealed since the evacuation."). */
  seal?: string;
  /** What a charm does while it is in your bag, as factors (feats.ts). */
  charm?: Partial<Mods>;
  /** A meal (use.meal): what it does once eaten, until you come home or collapse, the same way (meals.ts). */
  eaten?: Partial<Mods>;
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
  /** A tool: the drawing on its button in the bag's header. Every tool has one; nothing else does. */
  icon?: ToolIcon;
  /** A tool that listens: what it picks up, and how far (a radio). Its button turns it on and off. */
  senses?: Senses;
  /**
   * Live: worth `xp` if stashed within `fresh` seconds of being picked, then `fade` XP less every
   * minute until it is worth no more than `into` (a plain item), which it then becomes (liveXp, liveEnds).
   * While someone carries one it glows: everyone on the map sees them, and watchers come from farther.
   */
  live?: { xp: number; fresh: number; fade: number; into: string };
  /** Furniture: the place in your own cabin it goes into (comfort.ts), and the comfort it adds there. */
  furnishes?: Comfort;
  comfort?: number;
  /** Furniture: what stands in its place until it is made, spoiled by years of damp, in a plain sentence or two. */
  spoiled?: string;
  /** Furniture: with it in its place you always leave your cabin dry (the drying rack). */
  dries?: boolean;
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
  /** Only within `radius` tiles (center to center) of a tile of one of these kinds: fiddleheads by the water, fir tips at the forest's edge. */
  by?: { tiles: TileKind[]; radius: number };
  /** Only where no tile of these kinds lies within `radius` (center to center): berries out in the open of a clearing, away from the trees. */
  clear?: { tiles: TileKind[]; radius: number };
  /** How many lie out there at once. */
  count: number;
  /** Seconds before a picked one grows back somewhere else: a random time in this range. */
  respawn: [number, number];
  /**
   * Only then, and gone as soon as it is over: while the region is restless before a surge (and
   * during it), during an aurora night, while a storm blows over the region, or while it rains over it
   * (and `after` seconds more). Left out: always.
   */
  when?: FindWhen;
  /** With `when: 'rain'`: it still grows this many seconds after the rain stops (chanterelles, for a while after it). */
  after?: number;
  /** Only while this daily or weekly condition is on (sky.ts, conditionsAt), and gone when it is over. Never with `when`. */
  condition?: string;
  /** Only within `r` tiles (center to center) of tile x,y: crates by the pond. */
  around?: { x: number; y: number; r: number };
  /**
   * Only within this gate of the town (town.ts): from a milestone reached or a work done, until one, or
   * between. The cloth the empty house held lies on the lodge's shelves once Edith is home. Never with
   * `when` or `condition`.
   */
  town?: TownGate;
  /** Only in this season (sky.ts), and gone when it is over: more glowcaps in spring, more resin in autumn. Never with `when` or `condition`. */
  season?: Season;
}

export type FindWhen = 'unstable' | 'aurora' | 'storm' | 'rain';

export interface ItemsData {
  /** Bump when items or finds change; a client with another version reloads. */
  version: number;
  items: ItemDef[];
  finds: FindRule[];
  /** What the workbench at home makes (gear.ts). None: it makes nothing. */
  recipes?: Recipe[];
  /** What cooks at a burning fire, from what you carry, into a meal in your bag (meals.ts). None: nothing cooks. */
  cooking?: Recipe[];
  /** Seconds out in the wilds that wear gear of each tier out (gear.ts); a tier left out never wears. */
  wear?: Partial<Record<Tier, number>>;
  /** What mending a piece of each tier costs at the workbench, from the stash. */
  mend?: Partial<Record<Tier, BagSlot[]>>;
  /** What upgrading a piece one level costs at the workbench, from the stash, and how often it works: +1 first (gear.ts). None: nothing is upgraded. */
  upgrades?: Upgrade[];
  /** Names and words for the quirks of anomalous gear (gear.ts, QUIRKS). */
  quirks?: Array<{ id: Quirk; name: string; text: string }>;
  /** What the woods are like today and this week (sky.ts). None: nothing changes from day to day. */
  conditions?: ConditionsData;
  /** The welcome parcel and the week's calendar of parcels (parcels.ts). None: no parcels. */
  parcels?: ParcelsData;
  /** Where each keepsake lies, and what the whole set home gives (notes.ts). None: no keepsakes. */
  keepsakes?: KeepsakesData;
  /** What the townspeople swap for what you carry spare (town.ts): Walt, at the lodge. None: nobody swaps. */
  swaps?: SwapDef[];
  /** The town's milestones and the works of its ledger (town.ts). None: the town never changes. */
  town?: TownData;
  /** What grows back faster on a Long Night that has its bonus (sky.ts, world.ts). None: nothing does. */
  longNight?: LongNightData;
}

/** The Long Night's bonus (ItemsData.longNight). */
export interface LongNightData {
  /** The items whose finds, picked that night, grow back faster, wherever they grow: copper wire and strange objects. */
  items: string[];
  /** How many times as fast: 2, twice. */
  regrow: number;
}

/**
 * One bag slot: an item and how many of it (at most its stack). Gear stacks one to a slot, and its slot
 * carries the piece (its condition, quirk and level) wherever it goes: in a bag, a pile, a stash's list.
 * So does a bundle (one to a slot) carry what it holds.
 */
export interface BagSlot {
  item: string;
  count: number;
  piece?: Piece;
  /** A live item, in the saved bag: when it was picked (ms since the epoch). The server's clock only. */
  since?: number;
  /** A live item, as the client hears its bag: seconds since it was picked, when the message was sent. */
  age?: number;
  /** A bundle (lostfound.ts): whose things it holds, where they were lost, and the things. */
  bundle?: Bundle;
}

/**
 * Someone's pile, tied up to carry to the lost and found box in the lodge for them (lostfound.ts): one
 * bag slot, as heavy as what it holds, that never fades. Never inside another one: a pile that holds
 * bundles packs its owner's own things into one of their own, and the others stay as they are.
 */
export interface Bundle {
  /** The pile it was packed from, its owner's and when they collapsed (bundleId): handed in once. */
  id: string;
  owner: string;
  /** The owner's name, as their pile said it. */
  name: string;
  /** Where it was lost, the pile's map and tile, for the owner's letter ("by the pond"). */
  map: string;
  x: number;
  y: number;
  /** What it holds, as a pile holds it (gather): each piece of gear on its own, with its piece. */
  items: BagSlot[];
  /**
   * Of each item, how many had been taken out of the owner's stash when they collapsed (Stash.out): they
   * earn nothing when they go back (progress.ts). The server's only: the carrier never hears it.
   */
  owed?: Record<string, number>;
}

/** A copy of a bag slot, with its own piece and bundle: nothing a copy changes reaches the original. */
export function copySlot(s: BagSlot): BagSlot {
  return { ...s, ...(s.piece ? { piece: { ...s.piece } } : {}), ...(s.bundle ? { bundle: copyBundle(s.bundle) } : {}) };
}

/** A copy of a bundle, with its own things. */
export function copyBundle(b: Bundle): Bundle {
  return { ...b, items: b.items.map(copySlot), ...(b.owed ? { owed: { ...b.owed } } : {}) };
}

/**
 * The tools of a player who never got one of their own (their saved tools are null): a paper map of
 * every area there is (the town, the Near Woods, the South Road). Later some areas will have none until
 * one is found out there. The first tool a player gets writes these down with it, so a tool added here
 * later reaches only the players who never got one: give it to the others too (World.giveTool).
 */
export const STARTER_TOOLS: readonly string[] = ['stonebrook-map', 'near-woods-map', 'south-road-map'];

/**
 * The tools a player owns, as today's items know them, in the order they got them: their saved list
 * (none: the starter tools), without the ids that are not tools here. Such an id comes from a newer
 * release (one rolled back): it stays in the save, for when that release is back.
 */
export function toolsOf(saved: readonly string[] | undefined, items: Map<string, ItemDef>): string[] {
  return (saved ?? STARTER_TOOLS).filter(t => items.get(t)?.kind === 'tool');
}

/** Slots in the bag until the bag becomes equipment (a tote 6, a backpack 8, a hiking pack 12...). */
export const BAG_SLOTS = 8;
/** A pile dropped on collapse fades this long after the collapse. */
export const DROP_LIFETIME_MS = 60 * 60 * 1000;
/** What you carry easily. A heavier bag drains energy faster (energy.ts, LOAD_DRAIN). */
export const CARRY_KG = 10;

/** Kilograms in a bag slot: a bundle weighs what it holds. */
export function slotKg(s: BagSlot, items: Map<string, ItemDef>): number {
  if (s.bundle) return s.bundle.items.reduce((sum, b) => sum + slotKg(b, items), 0);
  return s.count * (items.get(s.item)?.weight ?? 0);
}

/** What a bag weighs over what you carry easily: 0 empty, 1 at CARRY_KG, more beyond. `lighter` scales it (a feat, a charm). */
export function bagLoad(bag: readonly BagSlot[], items: Map<string, ItemDef>, lighter = 1): number {
  const kg = bag.reduce((sum, s) => sum + slotKg(s, items), 0);
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

/** One of a list, by weight: the chance of each is its weight over the sum. Undefined for an empty list. */
export function byWeight<T extends { weight: number }>(list: readonly T[], rng: () => number): T | undefined {
  const total = list.reduce((n, r) => n + Math.max(0, r.weight), 0);
  let roll = rng() * total;
  for (const r of list) {
    roll -= Math.max(0, r.weight);
    if (roll < 0) return r;
  }
  return list.at(-1);
}

/** One of `reveals`, by weight; undefined for an empty list. */
export function reveal(list: NonNullable<ItemDef['reveals']>, rng: () => number): { item: string; count: number } | undefined {
  const r = byWeight(list, rng);
  return r && { item: r.item, count: r.count };
}

/**
 * What a sealed item turns out to hold when opened: one of its `holds`, by weight; for one of a kind
 * (`any`), one of every item of that kind in `all`, each as likely. Nothing for an empty one.
 */
export function openSealed(def: ItemDef, all: readonly ItemDef[], rng: () => number): BagSlot[] {
  const h = byWeight(def.holds ?? [], rng);
  if (!h) return [];
  if (h.any !== undefined) {
    const pool = all.filter(d => d.kind === h.any);
    const one = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
    return one ? [{ item: one.id, count: 1 }] : [];
  }
  return (h.items ?? []).map(s => ({ item: s.item, count: s.count }));
}

// ---------- naming things in a sentence (the text box, the notice board) ----------

/** One of an item in a sentence: its `noun`, or its name as a word ("Road flare": "road flare"). */
export function nounOf(def: ItemDef): string {
  return def.noun ?? def.name.charAt(0).toLowerCase() + def.name.slice(1);
}

/** Several: its `plural`, or the noun with an s. A noun that ends in one already names a pair or a heap: "rubber gloves", "cloth scraps". */
export function pluralOf(def: ItemDef): string {
  const n = nounOf(def);
  return def.plural ?? (n.endsWith('s') ? n : `${n}s`);
}

/** Counted one by one ("a shard", "2 shards"), unlike resin or rubber gloves, whose plural is the same word. */
export function countable(def: ItemDef): boolean {
  return pluralOf(def) !== nounOf(def);
}

/** "a raincoat", "an anomaly shard"; and without "a" what is not counted so: "resin", "rubber gloves". */
export function aOf(def: ItemDef): string {
  const n = nounOf(def);
  return countable(def) ? `${/^[aeiou]/i.test(n) ? 'an' : 'a'} ${n}` : n;
}

/** How many, as people say it: "a glowcap", "1 resin", "3 resin", "2 shards". */
export function amount(def: ItemDef, n: number): string {
  if (n !== 1) return `${n} ${pluralOf(def)}`;
  return countable(def) ? aOf(def) : `1 ${nounOf(def)}`;
}

/**
 * What the Long Night's bonus does, in words the notice board and the banners share: "wire and strange
 * objects grow back twice as fast". Empty without one, or with none of its items here.
 */
export function longNightWords(data: LongNightData | undefined, items: Map<string, ItemDef>): string {
  const defs = (data?.items ?? []).flatMap(id => items.get(id) ?? []);
  if (!data || !defs.length) return '';
  const names = defs.map(pluralOf), list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  // "Wire grows back", "strange objects grow back", "wire and strange objects grow back".
  const grow = defs.length > 1 || countable(defs[0]!) ? 'grow' : 'grows';
  return `${list} ${grow} back ${data.regrow === 2 ? 'twice' : `${data.regrow} times`} as fast`;
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

/**
 * Puts several stacks into a bag, in order; what does not fit comes back in `left`. A piece of gear
 * keeps its piece, and a bundle what it holds, in the bag or left out.
 */
export function addAllToBag(bag: readonly BagSlot[], add: readonly BagSlot[], items: Map<string, ItemDef>, slots = BAG_SLOTS): { bag: BagSlot[]; left: BagSlot[] } {
  let out = bag.map(s => ({ ...s }));
  const left: BagSlot[] = [];
  for (const a of add) {
    const def = items.get(a.item);
    if (!def) continue; // an item that no longer exists is dropped silently
    const r = addToBag(out, def, a.count, slots);
    // A live item keeps when it was picked, gear its piece and a bundle what it holds: all stack one to a slot, so their slots are new ones.
    for (const s of r.bag.slice(out.length)) {
      if (a.since !== undefined) s.since = a.since;
      if (a.piece) s.piece = { ...a.piece };
      if (a.bundle) s.bundle = copyBundle(a.bundle);
    }
    out = r.bag;
    if (r.left) left.push({ item: a.item, count: r.left, ...(a.piece ? { piece: { ...a.piece } } : {}), ...(a.bundle ? { bundle: copyBundle(a.bundle) } : {}) });
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

/**
 * Takes up to `count` of the item in slot `slot`: from that slot first, then from the other slots
 * holding the same item, in bag order, so what one feeding may use is everything of it you carry.
 * Emptied slots are removed. Returns the new bag (the old one is left alone) and how many came out.
 */
export function takeItem(bag: readonly BagSlot[], slot: number, count: number): { bag: BagSlot[]; taken: number } {
  const first = bag[slot];
  let want = Math.max(0, Math.floor(count));
  if (!first || !want) return { bag: bag.map(s => ({ ...s })), taken: 0 };
  const order = [slot, ...bag.flatMap((s, i) => (i !== slot && s.item === first.item ? [i] : []))];
  const left = bag.map(s => s.count);
  let taken = 0;
  for (const i of order) {
    const n = Math.min(want, left[i]!);
    left[i] = left[i]! - n;
    taken += n;
    want -= n;
    if (!want) break;
  }
  return { bag: bag.flatMap((s, i) => (left[i]! > 0 ? [{ ...s, count: left[i]! }] : [])), taken };
}

/** The same items with equal kinds joined (for counting, and "+2 Glowcap" over your head; ignores stack sizes and pieces). */
export function merge(items: readonly BagSlot[]): BagSlot[] {
  const by = new Map<string, number>();
  for (const s of items) if (s.count > 0) by.set(s.item, (by.get(s.item) ?? 0) + s.count);
  return [...by].map(([item, count]) => ({ item, count }));
}

/**
 * What a pile holds: the same items joined like merge, but each piece of gear on its own with its
 * piece, and each bundle whole, so it comes back out of the pile as it went in. In the order they first came.
 */
export function gather(items: readonly BagSlot[]): BagSlot[] {
  const out: BagSlot[] = [];
  const by = new Map<string, BagSlot>();
  for (const s of items) {
    if (s.count <= 0) continue;
    if (s.piece) {
      // A piece is one of its item, however the slot counted it.
      out.push({ item: s.item, count: 1, piece: { ...s.piece } });
      continue;
    }
    if (s.bundle) {
      out.push({ item: s.item, count: 1, bundle: copyBundle(s.bundle) });
      continue;
    }
    const joined = by.get(s.item);
    if (joined) joined.count += s.count;
    else {
      const slot = { item: s.item, count: s.count };
      by.set(s.item, slot);
      out.push(slot);
    }
  }
  return out;
}

/**
 * A random half of a pile, for someone who is not its owner: exactly half of the units, chosen at
 * random, and an odd one out goes either way by a coin toss (so on average it is exactly half). A
 * piece of gear in it is a unit like any other, and keeps its piece; so is a bundle, whole.
 */
export function halfOf(items: readonly BagSlot[], rng: () => number): BagSlot[] {
  const units: BagSlot[] = [];
  for (const s of items) {
    for (let i = 0; i < s.count; i++) units.push(s.piece ? { item: s.item, count: 1, piece: s.piece } : s.bundle ? { item: s.item, count: 1, bundle: s.bundle } : { item: s.item, count: 1 });
  }
  // Fisher-Yates, then keep the first half.
  for (let i = units.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [units[i], units[j]] = [units[j]!, units[i]!];
  }
  const keep = Math.floor(units.length / 2) + (units.length % 2 && rng() < 0.5 ? 1 : 0);
  return gather(units.slice(0, keep));
}

/** Every tile a find may grow on: walkable, not an exit or a slab, never ice (it thaws), and fitting the rule's tiles, steps, nearness and place. */
export function findTiles(map: TileMap, rule: FindRule): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  // Measured from every tile an object covers, so a cabin or a car is near from all sides alike.
  const near = rule.near ? map.data.objects.filter(o => rule.near!.kinds.includes(o.kind)).flatMap(objectTiles) : [];
  // A slab is walked over, but nothing grows on stone.
  const slabs = new Set(map.data.objects.flatMap(o => (o.kind === 'slab' ? [o.y * map.width + o.x] : [])));
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    if (!map.walkable(x, y) || map.exitAt(x, y) || map.iceAt(x, y) || slabs.has(y * map.width + x)) continue;
    if (rule.on && !rule.on.includes(map.kind(x, y)!)) continue;
    if (rule.steps) {
      const s = map.homeSteps(x, y);
      if (s < rule.steps[0] || s > rule.steps[1]) continue;
    }
    if (rule.around && Math.hypot(rule.around.x - x, rule.around.y - y) > rule.around.r) continue;
    if (rule.near && !near.some(([ox, oy]) => Math.hypot(ox - x, oy - y) <= rule.near!.radius)) continue;
    if (rule.by && !tileNear(map, x, y, rule.by.tiles, rule.by.radius)) continue;
    if (rule.clear && tileNear(map, x, y, rule.clear.tiles, rule.clear.radius)) continue;
    out.push({ x, y });
  }
  return out;
}

/** Is a tile of one of these kinds within `radius` of tile x,y (center to center), itself included? Off the map counts as nothing. */
function tileNear(map: TileMap, x: number, y: number, kinds: readonly TileKind[], radius: number): boolean {
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.hypot(dx, dy) > radius) continue;
    const k = map.kind(x + dx, y + dy);
    if (k && kinds.includes(k)) return true;
  }
  return false;
}
