/**
 * What the text box says about using something up: the question before (ask.ts), why it cannot happen
 * when the game already knows, and what it did, from the server's answer (`did`). Short, plain and
 * concrete, and every number from the data (content/items.json: nouns, fuel, uses, recipes, what
 * mending costs) or from the server. No drawing, so it is tested; game.ts asks and says, hud.ts shows it.
 */
import { aOf, amount, countable, fireFull, nounOf, pluralOf, type BagSlot, type Did, type Dir, type EnergyView, type ItemDef, type NextGear, type Recipe, type StoneView } from '@napoland/shared';
import type { Items } from './items';

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

/** Use, in the bag: what it does, and a word when the bar has little room for what a drink gives. */
export function useQuestion(def: ItemDef, energy: EnergyView | null): string {
  const u = def.use ?? {}, n = nounOf(def);
  if (u.identify) return `Look closely at the ${n}? It will be used up.`;
  if (u.energy) {
    const room = energy ? energy.max - energy.value : Infinity;
    if (u.energy > 0 && room < 0.5) return `Drink the ${n}? Your energy is full already.`;
    if (u.energy > 0 && room < u.energy) return `Drink the ${n}? Only +${Math.round(room)} energy: your bar is nearly full.`;
    return `Drink the ${n}? ${signed(u.energy)} energy.`;
  }
  if (u.flare) return `Light ${aOf(def)}? It burns ${howLong(u.flare)}.`;
  if (u.mark) return `Crush ${aOf(def)} to paint an arrow where you face?`;
  return `Use the ${n}? It will be used up.`;
}

/** Throw away, in the bag: `n` of the `inSlot` the slot holds. "Throw away 3 resin? It is gone for good." */
export function tossQuestion(def: ItemDef, n: number, inSlot: number): string {
  const what = n === 1 && inSlot === 1 ? `the ${nounOf(def)}` : n === inSlot ? `all ${n} ${pluralOf(def)}` : amount(def, n);
  return `Throw away ${what}? ${they(def, n) ? 'They are' : 'It is'} gone for good.`;
}

/** At the workbench: "Make a raincoat? It uses 8 cloth and 4 resin." */
export function makeQuestion(recipe: Recipe, items: Items): string {
  const made = items.get(recipe.make), n = recipe.count ?? 1;
  return `Make ${n === 1 ? aOf(made) : amount(made, n)}? It uses ${listOf(recipe.needs.map(x => counted(items.get(x.item), x.count)))}.`;
}

/** At the workbench: "Mend your raincoat? It uses 2 cloth and 1 scrap." */
export function mendQuestion(def: ItemDef, cost: readonly BagSlot[], items: Items): string {
  return `Mend your ${nounOf(def)}? It uses ${listOf(cost.map(x => counted(items.get(x.item), x.count)))}.`;
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

/** The stash lacks what making or mending takes: "Your stash is short of 3 cloth and 1 resin for a raincoat." */
export function stashShort(short: readonly BagSlot[], items: Items, what: { make: ItemDef } | { mend: ItemDef }): string {
  const list = listOf(short.map(x => counted(items.get(x.item), x.count)));
  return 'make' in what ? `Your stash is short of ${list} for ${aOf(what.make)}.` : `Your stash is short of ${list} to mend your ${nounOf(what.mend)}.`;
}

/** Where a tool is once you have it: never the stash or the bag, but a button of its own in the bag's header. */
const YOURS = 'It is yours for good: its button is in your bag.';

/** At the workbench, a tool you have already: each is yours once. */
export function haveTool(def: ItemDef): string {
  return `You have ${aOf(def)} already. ${YOURS}`;
}

/** What a list of needs lacks against what a stash holds, need by need (none: it can pay). */
export function shortOf(needs: readonly BagSlot[], stash: readonly BagSlot[]): BagSlot[] {
  return needs.flatMap(n => {
    const have = stash.reduce((sum, s) => sum + (s.item === n.item ? s.count : 0), 0);
    return have < n.count ? [{ item: n.item, count: n.count - have }] : [];
  });
}

// ---------- what it did ----------

/** The name over the box for what something did. */
export function didWho(did: Did, items: Items): string {
  switch (did.kind) {
    case 'fire': return 'Fire';
    case 'stone': return 'The Old Stone';
    case 'made': case 'mended': return 'Workbench';
    case 'used': case 'thrown': case 'opened': return items.get(did.item).name;
  }
}

/** What something did, in words, from the server's answer. */
export function didText(did: Did, items: Items): string {
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
      // A tool never goes into the stash: it joins your tools (World.giveTool).
      if (def.kind === 'tool') return `You make ${aOf(def)}. ${YOURS}`;
      const pl = they(def, did.count), gear = def.kind === 'gear';
      return `You make ${did.count === 1 ? aOf(def) : amount(def, did.count)}. ${pl ? 'They wait' : 'It waits'} in your stash${gear ? `: put ${pl ? 'them' : 'it'} on at the chest` : ''}.`;
    }
    case 'mended':
      return `You mend your ${nounOf(def)}: as good as new.`;
    case 'thrown':
      return `You throw away ${amount(def, did.count)}.`;
    case 'opened': {
      // One thing inside says what it is good for, as a strange object does.
      const about = did.got.length === 1 ? items.get(did.got[0]!.item).about : undefined;
      if (!did.got.length) return `The ${nounOf(def)} is empty.`;
      return `Inside: ${listOf(did.got.map(s => amount(items.get(s.item), s.count)))}.${about ? ` ${about}` : ''}`;
    }
  }
}

/** A plain no from the server, as a sentence for the box. */
export function sentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}
