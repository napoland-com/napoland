/**
 * What supabase.ts does besides calling supabase-js: taking a provider's answer out of the game's
 * address once it has been read, so that a reload does not read it again, and never taking a session
 * from the address that this browser did not ask for (the PKCE flow, always). (Signing in itself is
 * tested in signin.test.ts, with a stand-in for Supabase.)
 */
import { afterAll, describe, expect, it } from 'vitest';
import { withoutAnswer } from '../src/supabase';

describe('the address after coming back from Google or Apple', () => {
  it('loses the code, the flow and the error Supabase put in it, in the query and in the fragment', () => {
    expect(withoutAnswer('https://www.napoland.com/?code=4f2a')).toBe('https://www.napoland.com/');
    expect(withoutAnswer('https://www.napoland.com/?code=4f2a&sb_flow_id=9c1d')).toBe('https://www.napoland.com/');
    expect(withoutAnswer('https://www.napoland.com/?error=access_denied&error_code=user_cancelled&error_description=Cancelled#error=access_denied&error_code=user_cancelled&error_description=Cancelled'))
      .toBe('https://www.napoland.com/');
  });

  it('keeps anything else it had, and leaves an address without an answer alone', () => {
    expect(withoutAnswer('http://localhost:5173/?room=7&code=4f2a')).toBe('http://localhost:5173/?room=7');
    expect(withoutAnswer('https://www.napoland.com/')).toBeNull();
    expect(withoutAnswer('https://www.napoland.com/?room=7#map')).toBeNull();
  });

  it('loses a whole session someone put in its fragment, too', () => {
    expect(withoutAnswer('https://www.napoland.com/#access_token=eyJ.x.y&refresh_token=r1&expires_in=3600&token_type=bearer')).toBe('https://www.napoland.com/');
  });
});

/** Just enough of a browser for supabase-js, opened at `href`: its address, history and localStorage. */
function browser(href: string): { href: () => string; stored: () => string[] } {
  let url = new URL(href);
  const items = new Map<string, string>();
  const g = globalThis as Record<string, unknown>;
  g.location = {
    get href() { return url.href; }, get origin() { return url.origin; }, get hash() { return url.hash; }, set hash(v: string) { url.hash = v; },
    get search() { return url.search; }, get pathname() { return url.pathname; }, assign(v: string) { url = new URL(v, url); }, replace(v: string) { url = new URL(v, url); },
  };
  g.history = { state: null, replaceState: (_s: unknown, _t: string, u: string) => { url = new URL(u, url); } };
  g.localStorage = {
    getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, String(v)), removeItem: (k: string) => void items.delete(k),
    clear: () => items.clear(), key: (i: number) => [...items.keys()][i] ?? null, get length() { return items.size; },
  };
  g.document = { visibilityState: 'hidden' };
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  g.window = globalThis;
  return { href: () => url.href, stored: () => [...items.values()] };
}

describe('a link that carries someone else\'s session in its fragment', () => {
  const realFetch = globalThis.fetch;
  afterAll(() => {
    globalThis.fetch = realFetch;
    for (const k of ['location', 'history', 'localStorage', 'document', 'addEventListener', 'removeEventListener', 'window']) delete (globalThis as Record<string, unknown>)[k];
  });

  it('signs nobody in: supabase-js never asks whose it is, keeps nothing, and the address loses it', async () => {
    // A session of the link's maker, as the implicit flow would hand one over to any page opened at it.
    const page = browser('https://www.napoland.com/#access_token=eyJ.their.session&refresh_token=theirs&expires_in=3600&token_type=bearer&type=magiclink');
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input instanceof Request ? input.url : input);
      asked.push(u);
      // Were it asked, Supabase would vouch for the session: whose it is, and that it is valid.
      if (u.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'b0b', aud: 'authenticated', role: 'authenticated', email: 'maker@example.test' }), { status: 200 });
      return new Response('{}', { status: 500 });
    }) as typeof fetch;
    const { supabaseBackend } = await import('../src/supabase');
    const backend = supabaseBackend('https://abcd.supabase.test', 'sb_publishable_x');
    expect(await backend.session()).toBeNull();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(asked.filter(u => u.includes('/auth/v1/user'))).toEqual([]);
    expect(page.stored().some(v => v.includes('their.session'))).toBe(false);
    expect(page.href()).toBe('https://www.napoland.com/');
  });
});
