/**
 * The Google and Apple buttons of the email card (providers.ts): their words as each company gives
 * them, their logos drawn in the page, and nothing loaded from anywhere else.
 */
import { describe, expect, it } from 'vitest';
import { OAUTH_PROVIDERS } from '@napoland/shared';
import { PROVIDER_BUTTONS, providerButton } from '../src/providers';

/** The words of a piece of HTML, as a player reads them. */
const words = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('the Google and Apple buttons', () => {
  it('say what their makers ask, word for word', () => {
    expect(words(providerButton('google'))).toBe('Continue with Google');
    expect(words(providerButton('apple'))).toBe('Sign in with Apple');
  });

  it('are plain buttons that say which provider they are, hidden until the server lists it', () => {
    for (const p of OAUTH_PROVIDERS) {
      expect(providerButton(p)).toMatch(new RegExp(`^<button type="button" class="provider ${p}" data-provider="${p}" hidden>`));
    }
  });

  it('draw Google\'s G in its four colors and Apple\'s logo in the text color, in the page', () => {
    const g = PROVIDER_BUTTONS.google.logo;
    for (const color of ['#EA4335', '#4285F4', '#FBBC05', '#34A853']) expect(g).toContain(`fill="${color}"`);
    expect(PROVIDER_BUTTONS.apple.logo).toContain('fill="currentColor"');
    for (const p of OAUTH_PROVIDERS) {
      const html = providerButton(p);
      // Nothing from another site: no address, no image, only a drawing that screen readers skip.
      expect(html).not.toMatch(/https?:|<img|url\(/);
      expect(html).toContain('<svg viewBox=');
      expect(html).toContain('aria-hidden="true"');
    }
  });
});
