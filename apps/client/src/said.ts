/**
 * What the text box says about using something up: the question before (ask.ts), why it cannot happen
 * when the game already knows, and what it did, from the server's answer (`did`). Short, plain and
 * concrete, and every number from the data (content/items.json: nouns, fuel, uses, recipes, what
 * mending costs) or from the server. No drawing, so it is tested; game.ts asks and says, hud.ts shows it.
 */
import {
  CACHE_SIZE, LAMP_MAX_S, LEVEL_MAX, MARK_LIFETIME_MS, MERIT_XP, aOf, amount, countable, fireFull, levelOf, meritLookOf, meritsLeft, nounOf, pluralOf, toNextMerit, worksDays, type BagSlot, type Did,
  type Dir, type EnergyView, type ItemDef, type MeritLook, type NextGear, type Recipe, type StoneView, type Upgrade, type WorksDef, type WorksView,
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

/** A lookout's lamp that takes nothing more: within a second of LAMP_MAX_S. */
const lampFull = (left: number) => left >= LAMP_MAX_S - 1;

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

/** A: at the foot of a fire lookout's ladder, with what its lamp burns. "Feed the lookout's lamp resin?" (how many is asked beside it). */
export function lampQuestion(fuel: ItemDef): string {
  return `Feed the lookout's lamp ${pluralOf(fuel)}?`;
}

/** Up a fire lookout: what the text box says as you get there (LOOKOUT_UP_S: how long you may stay). */
export function upText(seconds: number): string {
  return `You climb up to the lookout and see the woods for miles. You can stay ${howLong(seconds)}: B climbs down.`;
}

/** A: at a place being mended (works.ts), with what it takes. "Give 3 scrap to the footbridge?" */
export function giveQuestion(def: ItemDef, w: Pick<WorksDef, 'name'>, n: number): string {
  return `Give ${amount(def, n)} to ${w.name}?`;
}

/** What the text box calls a place being mended: "Footbridge", "Street light". */
export function worksWho(w: Pick<WorksDef, 'name'>): string {
  const n = w.name.replace(/^the /, '');
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/** How long what is put by keeps a place standing: "enough for 3 more days"; or that it will not last past today. */
function upkeep(w: WorksDef, held: number, def: ItemDef): string {
  const days = worksDays(w, held), noun = pluralOf(def);
  if (days > 0) return `${held} ${noun} put by, enough for ${days} more day${days === 1 ? '' : 's'} (it takes ${w.wear} a day).`;
  return `It takes ${w.wear} ${noun} a day, and ${held === 0 ? 'none is' : `only ${held} ${held === 1 ? 'is' : 'are'}`} put by: it will not last past today.`;
}

/** How a place being mended stands: "The footbridge is broken: 12 of 30 scrap given, 18 more and it stands again." */
function worksState(w: WorksDef, v: Pick<WorksView, 'standing' | 'held'>, def: ItemDef): string {
  const name = w.name.charAt(0).toUpperCase() + w.name.slice(1), light = w.build === 'light', again = light ? 'it lights up again' : 'it stands again';
  if (v.standing) return `${name} ${light ? 'is lit' : 'stands'}. ${upkeep(w, v.held, def)}`;
  const down = light ? 'is dark' : 'is broken';
  return v.held > 0
    ? `${name} ${down}: ${v.held} of ${w.need} ${pluralOf(def)} given, ${w.need - v.held} more and ${again}.`
    : `${name} ${down}: ${again} with ${w.need} ${pluralOf(def)}.`;
}

/**
 * A: at a place being mended, with nothing it takes in the bag, or none it has room for, or after NO: how
 * it stands, and the name on its plaque. "The footbridge stands. 18 scrap put by, enough for 3 more days
 * (it takes 5 a day). Its plaque: Ana gave the most."
 */
export function worksText(w: WorksDef, v: WorksView | undefined, def: ItemDef): string {
  const plaque = v?.top ? ` Its plaque: ${v.top} gave the most.` : ' Its plaque is blank: nobody has given anything yet.';
  return `${worksState(w, v ?? { standing: false, held: 0 }, def)}${plaque}`;
}

/** Said after how a place stands, when you carry nothing it takes: "You have no scrap to give it." */
export function nothingToGive(def: ItemDef): string {
  return `You have no ${nounOf(def)} to give it.`;
}

/** Said after how a place stands, when it takes no more for now. */
export const WORKS_FULL = 'It has all it can keep for now.';

/** A: at the Old Stone. "Give the Old Stone a shard?", "Give the Old Stone 3 shards?" */
export function stoneQuestion(def: ItemDef, n: number): string {
  return `Give the Old Stone ${amount(def, n)}?`;
}

/**
 * Use, in the bag: what it does, and a word when the bar has little room for what a drink gives. An
 * arrow shows `markS` seconds (a day, longer for a good neighbor: markLifetime). `lift`: a charm in the bag
 * that gives energy back as a glowcap is crushed (a pale moth), and how much.
 */
export function useQuestion(def: ItemDef, energy: EnergyView | null, markS = MARK_LIFETIME_MS / 1000, lift?: { charm: ItemDef; energy: number }): string {
  const u = def.use ?? {}, n = nounOf(def);
  if (u.identify) return `Look closely at the ${n}? It will be used up.`;
  if (u.energy) {
    const room = energy ? energy.max - energy.value : Infinity;
    if (u.energy > 0 && room < 0.5) return `Drink the ${n}? Your energy is full already.`;
    if (u.energy > 0 && room < u.energy) return `Drink the ${n}? Only +${Math.round(room)} energy: your bar is nearly full.`;
    return `Drink the ${n}? ${signed(u.energy)} energy.`;
  }
  if (u.flare) return `Light ${aOf(def)}? It burns ${howLong(u.flare)}.`;
  if (u.mark) {
    const ask = `Crush ${aOf(def)} to paint an arrow where you face? Everyone sees it for ${howLong(markS)}.`;
    return lift ? `${ask} Your ${nounOf(lift.charm)} gives you ${lift.energy} energy.` : ask;
  }
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

/** At the workbench: "Make a raincoat? It uses 8 cloth and 4 resin." */
export function makeQuestion(recipe: Recipe, items: Items): string {
  const made = items.get(recipe.make), n = recipe.count ?? 1;
  return `Make ${n === 1 ? aOf(made) : amount(made, n)}? It uses ${listOf(recipe.needs.map(x => counted(items.get(x.item), x.count)))}.`;
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
 * A padlocked door (the shed behind the ranger's hut), without the tool that opens it: "A padlock, rusted
 * shut. Bolt cutters would do it." Said as you walk into it, face it and press A, or tap it.
 */
export function padlocked(tool: ItemDef | undefined): string {
  return tool ? `A padlock, rusted shut. ${tool.name} would do it.` : 'A padlock, rusted shut.';
}

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

// ---------- merits ----------

/** "12,345": a count with its thousands apart, the same in every language the browser speaks. */
export function thousands(n: number): string {
  return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Past level 20, what merits there are: "3 to spend, 1,240 XP to the next" (a guest spends them once
 * signed in). The status panel shows it under Merits, and the wardrobe over its patterns and badges.
 */
export function meritText(xp: number, spent: number, guest = false): string {
  const left = meritsLeft(xp, spent), next = `${thousands(toNextMerit(xp))} XP to the next`;
  if (!left) return `None to spend, ${next}`;
  return guest ? `${left} to spend once you sign in, ${next}` : `${left} to spend, ${next}`;
}

/** "a merit", "2 merits": in a sentence. */
export const merits = (n: number) => (n === 1 ? 'a merit' : `${n} merits`);
/** "1 merit", "2 merits": what a look costs, on its tile and its Buy button. */
export const price = (n: number) => `${n} merit${n === 1 ? '' : 's'}`;

/** Before spending merits on a look, at the wardrobe: "Spend a merit on the chevron pattern? You have 3." */
export function buyQuestion(look: MeritLook, left: number): string {
  return `Spend ${merits(look.cost)} on ${look.noun}? You have ${left}.`;
}

/**
 * Why merits cannot buy a look yet: below level 20, how they are earned; past it, how far the next one is
 * ("You have no merit to spend. 1,240 XP to the next.").
 */
export function noMerit(xp: number): string {
  if (levelOf(xp) < LEVEL_MAX) return `Past level ${LEVEL_MAX}, every ${thousands(MERIT_XP)} XP earns a merit.`;
  return `You have no merit to spend. ${thousands(toNextMerit(xp))} XP to the next.`;
}

/** After: "The chevron pattern is yours for good. 2 merits left to spend." */
function boughtText(did: Extract<Did, { kind: 'bought' }>): string {
  const look = meritLookOf(did.look), noun = look ? look.noun : 'it';
  const got = `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${look?.plural ? 'are' : 'is'} yours for good.`;
  return did.left > 0 ? `${got} ${did.left === 1 ? 'One merit' : `${did.left} merits`} left to spend.` : got;
}

// ---------- what it did ----------

/** The name over the box for what something did. */
export function didWho(did: Did, items: Items): string {
  switch (did.kind) {
    case 'fire': return 'Fire';
    case 'lamp': return 'Lookout';
    case 'gave': { const w = items.works.get(did.works); return w ? worksWho(w) : 'Mending'; }
    case 'stone': return 'The Old Stone';
    case 'made': case 'mended': case 'upgraded': return 'Workbench';
    case 'used': case 'opened': return items.get(did.item).name;
    case 'thrown': return pieceName(items.get(did.item), did.level);
    case 'thanked': return did.what === 'fire' ? 'Fire' : 'Arrow';
    case 'left': case 'took': return 'Crate';
    case 'bought': return 'Wardrobe';
  }
}

/** What something did, in words, from the server's answer. */
export function didText(did: Did, items: Items): string {
  // Thanks carry no item: the helper, by name (never a pronoun).
  if (did.kind === 'thanked') return did.what === 'fire' ? `You thank ${did.name} for feeding the fire.` : `You thank ${did.name} for the arrow.`;
  // Merits buy looks, not items.
  if (did.kind === 'bought') return boughtText(did);
  const def = items.get(did.item);
  switch (did.kind) {
    case 'fire': {
      const took = `The fire takes ${amount(def, did.count)}${did.lit ? ' and catches again' : ''}.`;
      return `${took} ${fireFull(did.left) ? 'It is full: it' : 'It'} will burn ${burnsOn(did.left)}.`;
    }
    case 'lamp': {
      const took = `The lamp takes ${amount(def, did.count)}${did.lit ? ' and lights up' : ''}.`;
      return `${took} ${lampFull(did.left) ? 'It is full: it' : 'It'} will burn ${burnsOn(did.left)}, its beam sweeping the woods.`;
    }
    case 'gave': {
      const w = items.works.get(did.works), v = did.view;
      if (!w) return `You give ${amount(def, did.count)}.`;
      const gave = `You give ${amount(def, did.count)} to ${w.name}`;
      if (did.built) return `${gave}, and ${w.build === 'light' ? 'it lights up again' : 'it stands again'}! ${upkeep(w, v.held, def)}`;
      if (v.standing) return `${gave}. ${upkeep(w, v.held, def)}`;
      return `${gave}: ${v.held} of ${w.need}, ${w.need - v.held} more and ${w.build === 'light' ? 'it lights up again' : 'it stands again'}.`;
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
        // A piece is one of its kind, a pair of boots too: "a crew hood", "crew boots".
        said.push(`It turns out to be ${into.kind === 'gear' && did.into.count === 1 ? aOf(into) : amount(into, did.into.count)}.`);
        if (into.about) said.push(into.about);
        // Its quirk is rolled as it lands in the bag: the card in the bag says what it does.
        if (quirk) said.push(`It has a quirk: ${items.quirk(quirk).name.toLowerCase()}.`);
      }
      if (did.energy !== undefined) {
        said.push(did.energy === 0 ? `You drink the ${n}, but your energy was full already.` : `You drink the ${n}: ${signed(did.energy)} energy.`);
      }
      if (did.flare !== undefined) said.push(`The ${n} hisses red. For ${howLong(did.flare)}, nothing comes near you.`);
      if (did.mark) said.push(`You crush the ${n}. An arrow glows where you stand, pointing ${COMPASS[did.mark.dir]}. Everyone sees it for ${howLong(did.mark.left)}.`);
      // A charm in your bag gave energy back as it happened (a pale moth).
      if (did.lift) said.push(`The ${nounOf(items.get(did.lift.item))} in your bag stirs: ${signed(did.lift.energy)} energy.`);
      return said.length ? said.join(' ') : `You use the ${n}.`;
    }
    case 'made': {
      // A tool never goes into the stash: it joins your tools (World.giveTool). What it does comes with it.
      if (def.kind === 'tool') return `You make ${aOf(def)}. ${YOURS}${def.about ? ` ${def.about}` : ''}`;
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

/** A plain no from the server, as a sentence for the box. */
export function sentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}
