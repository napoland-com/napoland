/**
 * The privacy policy (public/privacy.html) is a promise: where it names a rule the server keeps, it says
 * the rule as the server keeps it. Read as a player reads it, words only.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GLIMPSE_KEPT_MS, GLIMPSE_STEPS, GUEST_DAYS, WORKS_GIVERS } from '@napoland/shared';
import { DOOR_SETTING, VISITS_SETTING } from '../src/said';

const page = readFileSync(resolve(import.meta.dirname, '../public/privacy.html'), 'utf8');
const words = page.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
/** The items of the list under a heading. */
const listUnder = (heading: string) => {
  const at = page.indexOf(`<h2>${heading}</h2>`);
  const list = page.slice(at, page.indexOf('</ul>', at));
  return [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, li = '']) => li.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
};

describe('the privacy policy', () => {
  it(`says who is deleted after ${GUEST_DAYS} days away: guests, and characters made before sign-in nobody signed in with, never before the rule is ${GUEST_DAYS} days old`, () => {
    const kept = listUnder('How long we keep it');
    const guests = kept.find(li => li.startsWith('A guest'));
    expect(guests).toContain(`${GUEST_DAYS} days`);
    expect(guests).toMatch(/character made before sign-in existed that nobody has signed in with/);
    expect(guests).toMatch(/never before the rule has been in the game for 30 days/);
    // "Your character" is kept until you ask only once you signed in with it.
    expect(kept.find(li => li.startsWith('Your character'))).toMatch(/^Your character once you signed in with it/);
    expect(words).toContain('counts as a guest');
  });

  it('says what the steps others glimpse are, and that they are kept a day at most, in memory, shown without a name', () => {
    expect(GLIMPSE_KEPT_MS).toBe(24 * 60 * 60 * 1000);
    expect(words).toContain(`walks at least ${GLIMPSE_STEPS[0]} steps out in the wilds`);
    expect(words).toContain(`up to ${GLIMPSE_STEPS[1]}`);
    expect(words).toMatch(/only in its memory, never in the database or in a log: a day at most/);
    expect(words).toContain('no name and no id');
    expect(listUnder('How long we keep it').find(li => li.startsWith('The last steps of a walk'))).toMatch(/a day at most, in our server's memory only/);
  });

  it('names the settings for your door and your cabin as the menu does, and says what a neighbor who walks in sees, and what is not kept', () => {
    expect(words).toContain(`turn off "${DOOR_SETTING}"`);
    expect(words).toContain(`turn off "${VISITS_SETTING}"`);
    expect(words).toContain('whether you let your neighbors into its cabin');
    expect(words).toMatch(/what stands on your trophy shelf once you made one \(each charm and each piece of anomalous gear in your stash, once/);
    expect(words).toContain('Nothing else of your stash, your bag or your chest is shown');
    expect(words).toContain('you read the character name of whoever comes in; that is not kept');
    expect(words).not.toContain('nobody else ever is');
  });

  it('says what buying a look keeps (never a card), that Stripe answers for the payment itself, and how long the records stay', () => {
    expect(page).toContain('<h3>Buying looks</h3>');
    expect(words).toContain('Stripe processes the payment and your card, under its own privacy policy');
    expect(page).toContain('href="https://stripe.com/privacy"');
    expect(words).toContain('Your card never reaches the game');
    // What the server sends Stripe (stripe.ts): the look, its price and the character's id in the metadata.
    expect(words).toContain('only which look you are buying, its price, and your character\'s id');
    // What storage keeps (purchases): the look, when, the amount and currency, Stripe's reference; and when refunded.
    expect(words).toContain('which look, when, the price and currency, and Stripe\'s reference for the payment');
    expect(words).toContain('a look being bought or refunded, with the character\'s id, the look and Stripe\'s reference');
    const kept = listUnder('How long we keep it').find(li => li.startsWith('What you bought in the shop'));
    expect(kept).toMatch(/as long as your character exists, and after that, without your character, as long as the law requires/);
    // A deleted character's purchases stay without it (ON DELETE SET NULL): the deletion paragraph says so.
    expect(words).toContain('The records of the looks you bought stay, without your character');
    expect(listUnder('Why we are allowed to').some(li => li.includes('Art. 6(1)(c) GDPR'))).toBe(true);
  });

  it('says that a new character\'s first steps are kept until it took the last', () => {
    expect(words).toContain('while it is new which of its first steps it is on');
    expect(words).toContain('forgotten once it took the last');
  });

  it(`says what the places mended together keep: the ${WORKS_GIVERS} who gave the most, by id, their names read from the characters, and a guest's gifts under nobody`, () => {
    const kept = listUnder('How long we keep it').find(li => li.startsWith('How much your character gave'));
    expect(kept).toContain(`for the ${WORKS_GIVERS} characters who gave it the most`);
    expect(kept).toMatch(/only the character's id and how much are written down/);
    expect(words).toMatch(/a guest's gifts count, but are not kept under it/);
    expect(words).toMatch(/what it gave to the places mended together \(and its name on their plaques\)/);
  });
});
