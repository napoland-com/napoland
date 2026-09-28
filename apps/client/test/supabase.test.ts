/**
 * What supabase.ts does besides calling supabase-js: taking a provider's answer out of the game's
 * address once it has been read, so that a reload does not read it again. (Signing in itself is
 * tested in signin.test.ts, with a stand-in for Supabase.)
 */
import { describe, expect, it } from 'vitest';
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
});
