/**
 * What the text box says about using something up: the question before (ask.ts), why it cannot happen
 * when the game already knows, and what it did, from the server's answer (`did`). Short, plain and
 * concrete, and every number from the data (content/items.json: nouns, fuel, uses, recipes, what
 * mending costs) or from the server. No drawing, so it is tested; game.ts asks and says, hud.ts shows it.
 */
import {
  CACHE_SIZE, COZY_AFTER_S, MARK_LIFETIME_MS, aOf, amount, comfortMax, countable, fireFull, nounOf, pluralOf, type BagSlot, type Comfort, type Did, type Dir, type EnergyView, type ItemDef,
  type NextGear, type Recipe, type StoneView, type Upgrade,
} from '@napoland/shared';
import { oddsText, pieceName, type Items } from './items';

// ---------- naming things in a sentence ----------

// How items are named is shared: the notice board, which the server writes, names them the same way.
export { aOf, amount, nounOf, pluralOf };

/** Always with its number, for a list of what something takes: "1 scrap", "8 cloth", "2 shards". */
export function counted(def: ItemDef, n: number): string {
  return `${n} ${n === 1 ? nounOf(def) : pluralOf(def)}`;
}

/** Whether "they" (not "it") stands for `n` of it: several of what is counted, or a pair. */
function they(def: ItemDef, n: number): boolean {
  return countable(def) ? n > 1 : nounOf(def).endsWith('s');
}

/** One piece in a sentence, with its level once it has one: "raincoat", "raincoat +3", "rubber gloves +1". */
export function pieceNoun(def: ItemDef, level = 0): string {
  return level > 0 ? `${nounOf(def)} +${level}` : nounOf(def);
}

/** "a", "a and b", "a, b and c" (or "or"). */
export function listOf(parts: readonly string[], word: 'and' | 'or' = 'and'): string {
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} ${word} ${parts.at(-1)}`;
}

/** "45 seconds", "18 minutes", "an hour and a half", "10 hours", "a day": how long, as people say it. */
export function howLong(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minutes`;
  if (s < 20 * 3600) {
    // To the half hour: the Old Stone burns a shard every half hour.
    const halves = Math.round(s / 1800), h = Math.floor(halves / 2), half = halves % 2 === 1;
    if (h === 1) return half ? 'an hour and a half' : 'an hour';
    return `${h}${half ? ' and a half' : ''} hours`;
  }
  const d = Math.round(s / 86400);
  return d === 1 ? 'a day' : `${d} days`;
}

/** How long a fire burns on: "18 more minutes", "under a minute more". */
function burnsOn(left: number): string {
  if (left < 60) return 'under a minute more';
  const m = Math.round(left / 60);
  return `${m} more minute${m === 1 ? '' : 's'}`;
}

const COMPASS: Readonly<Record<Dir, string>> = { up: 'north', down: 'south', left: 'west', right: 'east' };
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

// ---------- the questions ----------

/** A: at a fire. "Feed the fire resin?" (how many is asked beside it). */
export function feedQuestion(fuel: ItemDef): string {
  return `Feed the fire ${pluralOf(fuel)}?`;
}

/** A: at the Old Stone. "Give the Old Stone a shard?", "Give the Old Stone 3 shards?" */
export function stoneQuestion(def: ItemDef, n: number): string {
  return `Give the Old Stone ${amount(def, n)}?`;
}

/**
 * Use, in the bag: what it does, and a word when the bar has little room for what a drink gives. An
 * arrow shows `markS` seconds (a day, longer for a good neighbor: markLifetime).
 */
export function useQuestion(def: ItemDef, energy: EnergyView | null, markS = MARK_LIFETIME_MS / 1000): string {
  const u = def.use ?? {}, n = nounOf(def);
  if (u.identify) return `Look closely at the ${n}? It will be used up.`;
  if (u.energy) {
    const room = energy ? energy.max - energy.value : Infinity;
    if (u.energy > 0 && room < 0.5) return `Drink the ${n}? Your energy is full already.`;
    if (u.energy > 0 && room < u.energy) return `Drink the ${n}? Only +${Math.round(room)} energy: your bar is nearly full.`;
    return `Drink the ${n}? ${signed(u.energy)} energy.`;
  }
  if (u.flare) return `Light ${aOf(def)}? It burns ${howLong(u.flare)}.`;
  if (u.mark) return `Crush ${aOf(def)} to paint an arrow where you face? Everyone sees it for ${howLong(markS)}.`;
  return `Use the ${n}? It will be used up.`;
}

/**
 * Throw away, in the bag: `n` of the `inSlot` the slot holds. "Throw away 3 resin? It is gone for good."
 * A piece is named with its level: "Throw away the raincoat +3?"
 */
export function tossQuestion(def: ItemDef, n: number, inSlot: number, level = 0): string {
  const what = n === 1 && inSlot === 1 ? `the ${pieceNoun(def, level)}` : n === inSlot ? `all ${n} ${pluralOf(def)}` : amount(def, n);
  return `Throw away ${what}? ${they(def, n) ? 'They are' : 'It is'} gone for good.`;
}

/** At the workbench: "Make a raincoat? It uses 8 cloth and 4 resin." Furniture says where it goes: straight into its place. */
export function makeQuestion(recipe: Recipe, items: Items): string {
  const made = items.get(recipe.make), n = recipe.count ?? 1;
  const ask = `Make ${n === 1 ? aOf(made) : amount(made, n)}? It uses ${listOf(recipe.needs.map(x => counted(items.get(x.item), x.count)))}.`;
  return made.kind === 'furniture' ? `${ask} It goes straight into its place.` : ask;
}

/** At the workbench: "Mend your raincoat? It uses 2 cloth and 1 scrap." (with its level: "your raincoat +3"). */
export function mendQuestion(def: ItemDef, cost: readonly BagSlot[], items: Items, level = 0): string {
  return `Mend your ${pieceNoun(def, level)}? It uses ${listOf(cost.map(x => counted(items.get(x.item), x.count)))}.`;
}

/**
 * At the workbench: "Upgrade your raincoat to +7? It uses 4 shards and a strange object. It works 7 times
 * in 10." What always works says only what it uses.
 */
export function upgradeQuestion(def: ItemDef, to: number, next: Upgrade, items: Items): string {
  const uses = `Upgrade your ${nounOf(def)} to +${to}? It uses ${listOf(next.needs.map(x => amount(items.get(x.item), x.count)))}.`;
  return next.chance === undefined || next.chance >= 1 ? uses : `${uses} ${oddsText(next)}`;
}

/** At the chest, before a sealed thing is opened: "Open the NAPO lockbox? It has been sealed since the evacuation." */
export function openQuestion(def: ItemDef): string {
  return `Open the ${nounOf(def)}?${def.seal ? ` ${def.seal}` : ''}`;
}

/** What a sealed thing may hold, for its card: "Inside is one of these: 3 shards, a strange object, a charm or 6 cloth and 4 wire." */
export function holdsText(def: ItemDef, items: Items): string {
  const each = (def.holds ?? []).map(h => (h.any !== undefined ? `a ${h.any}` : listOf((h.items ?? []).map(s => amount(items.get(s.item), s.count)))));
  return each.length > 1 ? `Inside is one of these: ${listOf(each, 'or')}.` : each.length ? `Inside: ${each[0]}.` : 'It is empty.';
}

// ---------- a first goal ----------

/**
 * The nearest gear you could make, as the bag and the chest say it (gear.ts, nearestRecipe): "Next: rubber
 * gloves. 1 more resin."; when the stash can pay for it, "You can make rubber gloves at the workbench
 * beside the chest."; and when only what you carry is missing from the stash, to put it away.
 */
export function goalText(g: NextGear, items: Items): string {
  const def = items.get(g.recipe.make), n = g.recipe.count ?? 1, what = n === 1 ? aOf(def) : amount(def, n);
  if (g.ready) return `You can make ${what} at the workbench beside the chest.`;
  if (!g.missing.length) return `Put away what you carry, and you can make ${what} at the workbench beside the chest.`;
  const more = g.missing.map(m => { const d = items.get(m.item); return `${m.count} more ${m.count === 1 ? nounOf(d) : pluralOf(d)}`; });
  return `Next: ${what}. ${capital(listOf(more))}.`;
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// ---------- why it cannot happen ----------

export const TENDED = 'Someone keeps this fire going. It needs nothing.';

/** A fire that takes nothing more: "The fire is as full as it gets. It will burn 30 more minutes." */
export function fullFire(left: number): string {
  return `The fire is as full as it gets. It will burn ${burnsOn(left)}.`;
}

/** Nothing that burns in the bag: how long the fire has left, or what would light it again (`fuels`, the best first). */
export function nothingToBurn(left: number, fuels: readonly ItemDef[]): string {
  if (left > 0) return `It will burn ${burnsOn(left)}. You have nothing that burns.`;
  return fuels.length ? `The fire is out. Bring something that burns: ${listOf(fuels.map(pluralOf), 'or')}.` : 'The fire is out, and you have nothing that burns.';
}

/** No shard for the Old Stone: how it stands. */
export function noShard(stone: StoneView): string {
  return stone.awake
    ? `The Old Stone is awake for ${howLong(stone.left)} more. You have no shard to give it.`
    : `The Old Stone sleeps: ${stone.charge} of ${stone.need} shards. You have no shard to give it.`;
}

/** A strange object out in the dark, or anywhere but town. */
export const TOO_DARK = 'It is too dark here to tell what it is. Look at it in town, in the light.';
/** A glowcap indoors. */
export const INDOORS = 'An arrow needs open ground. Paint it outdoors.';
/** A glowcap where an arrow is already painted. */
export const MARKED = 'There is an arrow here already. Step onto another tile first.';
/** Whatever a strange object turns out to be, the bag has no room for it. */
export const NO_ROOM = 'Your bag is full. Make room first.';
/** Asked and answered, but the bag no longer holds it (a watcher took it, say). */
export const GONE = 'It is not in your bag any more.';

/**
 * The stash lacks what making, mending or upgrading takes: "Your stash is short of 3 cloth and 1 resin for
 * a raincoat.", "...to mend your raincoat.", "...to upgrade your raincoat to +5."
 */
export function stashShort(short: readonly BagSlot[], items: Items, what: { make: ItemDef } | { mend: ItemDef; level?: number } | { upgrade: ItemDef; to: number }): string {
  const list = listOf(short.map(x => counted(items.get(x.item), x.count)));
  if ('make' in what) return `Your stash is short of ${list} for ${aOf(what.make)}.`;
  if ('mend' in what) return `Your stash is short of ${list} to mend your ${pieceNoun(what.mend, what.level)}.`;
  return `Your stash is short of ${list} to upgrade your ${nounOf(what.upgrade)} to +${what.to}.`;
}

/** Where a tool is once you have it: never the stash or the bag, but a button of its own in the bag's header. */
const YOURS = 'It is yours for good: its button is in your bag.';

/** At the workbench, a tool you have already: each is yours once. */
export function haveTool(def: ItemDef): string {
  return `You have ${aOf(def)} already. ${YOURS}`;
}

// ---------- a cozy cabin (comfort.ts) ----------

/** At the workbench, furniture you made already: each place in the cabin has one. */
export function placedAlready(def: ItemDef): string {
  return `Your ${nounOf(def)} stands in its place already.`;
}

/** What stands in a place of your cabin until you make its furniture again, as the text box names it. */
export const SPOILED_NAMES: Readonly<Record<Comfort, string>> = {
  stove: 'Old stove', bed: 'Bed frame', rug: 'Old rug', lamp: 'Old lamp', rack: 'Broken rack', shelf: 'Old shelf',
};

/**
 * A at a place in your cabin: what stands there spoiled and where to make it again, or, made, what it is;
 * the trophy shelf says what stands on it (`trophies`: the charms and anomalous gear in your stash).
 */
export function comfortLines(what: Comfort, def: ItemDef | undefined, placed: boolean, trophies: readonly ItemDef[] = []): { who: string; lines: string[] } {
  if (!def) return { who: SPOILED_NAMES[what], lines: ['Years of damp spoiled it.'] };
  if (!placed) return { who: SPOILED_NAMES[what], lines: [def.spoiled ?? 'Years of damp spoiled it.', `Make ${aOf(def)} at the workbench beside the chest: it goes straight into its place.`] };
  if (what !== 'shelf') return { who: def.name, lines: [def.text] };
  const on = trophies.length ? `On it: ${listOf(trophies.map(aOf))}.` : 'Nothing on it yet. The charms and anomalous gear you keep in your stash will stand here.';
  return { who: def.name, lines: [def.text, on] };
}

/**
 * How cozy you are, for the status panel (comfort.ts): "12 min left", "8 min, from when you leave the
 * fire" while you stand by it in full, or how long until you are, by your fire. Null: none of it.
 */
export function cozyText(cozy: number, fireside: number | undefined): string | null {
  const mins = (s: number) => (s < 60 ? 'under a minute' : `${Math.ceil(s / 60)} min`);
  if (fireside !== undefined && fireside >= COZY_AFTER_S && cozy > 0) return `${mins(cozy)}, from when you leave the fire`;
  if (cozy > 0) return `${mins(cozy)} left`;
  if (fireside !== undefined) return `Warming up by your fire: cozy in ${Math.max(1, Math.ceil(COZY_AFTER_S - fireside))} s`;
  return null;
}

/** What a list of needs lacks against what a stash holds, need by need (none: it can pay). */
export function shortOf(needs: readonly BagSlot[], stash: readonly BagSlot[]): BagSlot[] {
  return needs.flatMap(n => {
    const have = stash.reduce((sum, s) => sum + (s.item === n.item ? s.count : 0), 0);
    return have < n.count ? [{ item: n.item, count: n.count - have }] : [];
  });
}

// ---------- a crate for whoever comes next ----------

/** What an empty crate says. */
export const CRATE_EMPTY = 'Nothing in it yet. Leave something for whoever comes next.';
/** A crate with no room left. */
export const CRATE_FULL = `The crate is full: it holds ${CACHE_SIZE} things. Someone has to take one out first.`;
/** Gear stays out of a crate (tools and lockboxes are never in the bag). */
export const CRATE_NO_GEAR = 'Gear stays with you: a crate takes none.';
/** One thing left, and one taken, each visit. */
export const LEFT_ONE = 'You left something here this time. Leave more the next time you come by.';
export const TOOK_ONE = 'You took something here this time. Take more the next time you come by.';

/** Leaving asks first: "Leave 1 resin in the crate for whoever comes next?", "Leave a glowcap in the crate for whoever comes next?" */
export function leaveQuestion(def: ItemDef): string {
  return `Leave ${amount(def, 1)} in the crate for whoever comes next?`;
}

/** How long ago, short: "just now", "5 min ago", "2 h ago", "a day ago", "3 days ago". */
export function agoText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86_400);
  return d === 1 ? 'a day ago' : `${d} days ago`;
}

/** Who left a thing in a crate and when: "left by Ana, 2 h ago", or "left by you, just now". */
export function leftBy(name: string, mine: boolean, ageS: number): string {
  return `left by ${mine ? 'you' : name}, ${agoText(ageS)}`;
}

// ---------- what it did ----------

/** The name over the box for what something did. */
export function didWho(did: Did, items: Items): string {
  switch (did.kind) {
    case 'fire': return 'Fire';
    case 'stone': return 'The Old Stone';
    case 'made': case 'mended': case 'upgraded': return 'Workbench';
    case 'used': case 'opened': return items.get(did.item).name;
    case 'thrown': return pieceName(items.get(did.item), did.level);
    case 'thanked': return did.what === 'fire' ? 'Fire' : 'Arrow';
    case 'left': case 'took': return 'Crate';
    case 'moved': return YOUR_CABIN;
  }
}

/** What something did, in words, from the server's answer. */
export function didText(did: Did, items: Items): string {
  // Thanks carry no item: the helper, by name (never a pronoun).
  if (did.kind === 'thanked') return did.what === 'fire' ? `You thank ${did.name} for feeding the fire.` : `You thank ${did.name} for the arrow.`;
  // Nor does a move: your cabin, next to the friend's, by name.
  if (did.kind === 'moved') return `Your cabin stands next to ${did.name}'s now.`;
  const def = items.get(did.item);
  switch (did.kind) {
    case 'fire': {
      const took = `The fire takes ${amount(def, did.count)}${did.lit ? ' and catches again' : ''}.`;
      return `${took} ${fireFull(did.left) ? 'It is full: it' : 'It'} will burn ${burnsOn(did.left)}.`;
    }
    case 'stone': {
      const what = did.count === 1 ? `the ${nounOf(def)}` : amount(def, did.count), s = did.stone;
      if (did.woke) return `The Old Stone takes ${what}: ${Math.min(s.charge, s.need)} of ${s.need}. It wakes.`;
      if (s.awake) return `The Old Stone takes ${what}. It stays awake ${howLong(s.left)} more.`;
      return `The Old Stone takes ${what}: ${s.charge} of ${s.need}.`;
    }
    case 'used': {
      const n = nounOf(def), said: string[] = [];
      if (did.into) {
        const into = items.get(did.into.item), quirk = did.into.piece?.quirk;
        said.push(`It turns out to be ${amount(into, did.into.count)}.`);
        if (into.about) said.push(into.about);
        // Its quirk is rolled as it lands in the bag: the card in the bag says what it does.
        if (quirk) said.push(`It has a quirk: ${items.quirk(quirk).name.toLowerCase()}.`);
      }
      if (did.energy !== undefined) {
        said.push(did.energy === 0 ? `You drink the ${n}, but your energy was full already.` : `You drink the ${n}: ${signed(did.energy)} energy.`);
      }
      if (did.flare !== undefined) said.push(`The ${n} hisses red. For ${howLong(did.flare)}, nothing comes near you.`);
      if (did.mark) said.push(`You crush the ${n}. An arrow glows where you stand, pointing ${COMPASS[did.mark.dir]}. Everyone sees it for ${howLong(did.mark.left)}.`);
      return said.length ? said.join(' ') : `You use the ${n}.`;
    }
    case 'made': {
      // A tool never goes into the stash: it joins your tools (World.giveTool). What it does comes with it.
      if (def.kind === 'tool') return `You make ${aOf(def)}. ${YOURS}${def.about ? ` ${def.about}` : ''}`;
      // Nor does furniture: it stands in its place in your cabin at once, and the cabin is cozier.
      if (def.kind === 'furniture') {
        const of = comfortMax(items.byId.values());
        return `You make ${aOf(def)} and set it in its place. Your cabin's comfort is ${did.comfort ?? def.comfort ?? 0} of ${of}.`;
      }
      const pl = they(def, did.count), gear = def.kind === 'gear';
      return `You make ${did.count === 1 ? aOf(def) : amount(def, did.count)}. ${pl ? 'They wait' : 'It waits'} in your stash${gear ? `: put ${pl ? 'them' : 'it'} on at the chest` : ''}.`;
    }
    case 'mended':
      return `You mend your ${pieceNoun(def, did.level)}: as good as new.`;
    case 'upgraded': {
      // "The raincoat is +7 now.", "The rubber gloves are +7 now."
      const pl = they(def, 1), noun = `The ${nounOf(def)}`;
      return did.failed
        ? `It did not take. ${noun} ${pl ? 'stay' : 'stays'} +${did.level}, and the materials are gone.`
        : `${noun} ${pl ? 'are' : 'is'} +${did.level} now.`;
    }
    case 'thrown':
      return did.level ? `You throw away the ${pieceNoun(def, did.level)}.` : `You throw away ${amount(def, did.count)}.`;
    case 'opened': {
      // One thing inside says what it is good for, as a strange object does.
      const about = did.got.length === 1 ? items.get(did.got[0]!.item).about : undefined;
      if (!did.got.length) return `The ${nounOf(def)} is empty.`;
      return `Inside: ${listOf(did.got.map(s => amount(items.get(s.item), s.count)))}.${about ? ` ${about}` : ''}`;
    }
    case 'left':
      return `You leave ${amount(def, 1)} in the crate. Whoever comes next will find it.`;
    case 'took': {
      const n = nounOf(def);
      if (did.mine) return `You take back the ${n} you left.`;
      // By name, never a pronoun: the thanks goes with it, unless you thanked them today already.
      return did.thanked ? `You take the ${n} ${did.name} left, and thank ${did.name} for it.` : `You take the ${n} ${did.name} left.`;
    }
  }
}

// ---------- your street ----------

/** The name over the box at your own door. */
export const YOUR_CABIN = 'Your cabin';

/** The name over the box at a neighbor's door: whose cabin it is, or an empty one. */
export function cabinWho(name: string | null): string {
  return name ? `${name}'s cabin` : 'Empty cabin';
}

/** While a knock waits for its answer. */
export const KNOCKING = 'You knock.';

/** At a door nobody lives behind yet. */
export const NOBODY_LIVES = 'Nobody lives here yet.';

/** What a knock hears back: whether they are home. By name, never a pronoun. Visiting is for later. */
export function doorText(name: string | null, home: boolean): string {
  if (!name) return NOBODY_LIVES;
  return home ? `${name} is home.` : 'Nobody answers.';
}

/** At home, when a neighbor knocks at your door. */
export function knockedText(name: string): string {
  return `${name} knocked.`;
}

/** At your own door, for a friend whose street has a lot free. */
export function moveQuestion(name: string): string {
  return `Move next to ${name}? Your cabin comes with you.`;
}

/** At your own door, with no friend to move next to. */
export const NO_MOVES = 'Your own cabin. When a friend has a lot free on their street, you can move next to them from here.';

/** A plain no from the server, as a sentence for the box. */
export function sentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}
