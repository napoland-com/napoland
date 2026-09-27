/**
 * The About panel and the small print under the sign-in cards (about.ts): where their links go,
 * that they never take the game's own tab, and the version the server says it runs.
 */
import { describe, expect, it } from 'vitest';
import { LEGAL_URL, PRIVACY_URL, SOURCE_URL, aboutBody, loadVersion, signInFooter, versionView } from '../src/about';

interface Link { href: string; text: string; attrs: string }

/** The links in a piece of HTML, with their words (icons left out). */
function links(html: string): Link[] {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs = '', inner = '']) => ({
    href: /\bhref="([^"]*)"/.exec(attrs)?.[1] ?? '',
    text: inner.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim(),
    attrs,
  }));
}

/** The words of a piece of HTML, as a player reads them. */
const words = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('the small print under the sign-in cards', () => {
  it('links the privacy policy, the legal notice and the source code', () => {
    expect(links(signInFooter()).map(l => [l.text, l.href])).toEqual([
      ['Privacy', '/privacy.html'],
      ['Legal notice', 'https://www.neuramare.com/policies/legal-notice'],
      ['Source code', 'https://github.com/napoland-com/napoland'],
    ]);
  });

  it('says the game is built by its community and open source, and leaves the publisher to the About panel', () => {
    expect(words(signInFooter())).toContain('Built by the community. Open source project.');
    expect(words(signInFooter())).not.toContain('Published by');
  });
});

describe('the About panel', () => {
  it('offers the source code first, to everyone who plays (AGPL section 13)', () => {
    const [first, ...rest] = links(aboutBody());
    expect(first).toMatchObject({ text: 'Source code', href: SOURCE_URL });
    expect(first!.attrs).toContain('class="source"');
    expect(rest.map(l => [l.text, l.href])).toEqual([['Privacy', PRIVACY_URL], ['Legal notice', LEGAL_URL]]);
  });

  it('says who makes it, who publishes it and under which licenses', () => {
    const text = words(aboutBody());
    expect(text).toContain('napoland is open source and made by its community.');
    expect(text).toContain('Published by Angelo Lamonaca (Neuramare).');
    expect(text).toContain('Code: AGPL-3.0-or-later · World and items: CC BY-SA 4.0');
    expect(text).toContain('© 2026 Angelo Lamonaca (Neuramare) and the napoland contributors');
  });

  it('keeps a hidden place for the version until the server says it', () => {
    expect(aboutBody()).toMatch(/<p class="fine" data-el="version" hidden><\/p>/);
  });
});

it('opens every link in a new tab, so the game keeps running, and the page cannot reach back into it', () => {
  const all = [...links(signInFooter()), ...links(aboutBody())];
  expect(all).toHaveLength(6);
  for (const l of all) {
    expect(l.attrs).toContain('target="_blank"');
    expect(l.attrs).toContain('rel="noopener"');
  }
});

describe('the version', () => {
  it('links a release to exactly the code it was built from', () => {
    expect(versionView('3f9c2a61b0de')).toEqual({ text: 'Version 3f9c2a61b0de', href: `${SOURCE_URL}/tree/3f9c2a61b0de` });
  });

  it('only shows anything else: a development server, or a release built from a changed checkout', () => {
    expect(versionView('dev')).toEqual({ text: 'Version dev', href: null });
    expect(versionView('3f9c2a61b0de-dirty-m1x2k3')).toEqual({ text: 'Version 3f9c2a61b0de-dirty-m1x2k3', href: null });
  });

  const answer = (status: number, body: unknown) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

  it('is what /health says', async () => {
    const asked: string[] = [];
    const version = await loadVersion(async path => { asked.push(path); return new Response(JSON.stringify({ ok: true, players: 3, uptimeSeconds: 60, version: '3f9c2a61b0de' })); });
    expect(version).toBe('3f9c2a61b0de');
    expect(asked).toEqual(['/health']);
    expect(await loadVersion(answer(200, { version: ' dev ' }))).toBe('dev');
  });

  it('is none when the server cannot tell, and asking never fails', async () => {
    expect(await loadVersion(answer(502, 'Bad gateway'))).toBeNull();
    expect(await loadVersion(answer(200, 'not json'))).toBeNull();
    expect(await loadVersion(answer(200, null))).toBeNull();
    expect(await loadVersion(answer(200, { ok: true }))).toBeNull();
    expect(await loadVersion(answer(200, { version: 42 }))).toBeNull();
    expect(await loadVersion(answer(200, { version: '  ' }))).toBeNull();
    expect(await loadVersion(answer(200, { version: 'x'.repeat(65) }))).toBeNull();
    expect(await loadVersion(async () => { throw new TypeError('Failed to fetch'); })).toBeNull();
  });
});
