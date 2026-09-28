/**
 * The privacy policy (public/privacy.html) is a promise: where it names a rule the server keeps, it says
 * the rule as the server keeps it. Read as a player reads it, words only.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GLIMPSE_KEPT_MS, GLIMPSE_STEPS, GUEST_DAYS } from '@napoland/shared';

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
});
