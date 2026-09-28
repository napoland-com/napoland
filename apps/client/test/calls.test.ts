import { beforeEach, describe, expect, it } from 'vitest';
import { CALL_EVERY_MS, CALL_KINDS, CALL_REACH, type ClientMsg, type PlayerView } from '@napoland/shared';
import {
  CALL_FAINTEST, CALL_NOTE_S, CALL_SLACK_MS, CALL_SONGS, CALL_WORDS, CALL_WORDS_UNTIL, CallButton, FAN, FAN_NOTE, FAN_RADIUS, HOLD_MS, PAN_MAX, VOICES,
  callGain, callPan, callSound, callTone, fanChoice, voiceOf,
} from '../src/calls';
import { Game } from '../src/game';
import { CALL_GLYPHS } from '../src/icons';
import { Maps } from '../src/maps';
import { soundscape, type Scene } from '../src/soundscape';
import { newsBanner } from '../src/status';
import { ITEMS, tinyTown, tinyWoods, welcome } from './fixtures';

describe('B held: the hold and the tap', () => {
  let b: CallButton;
  beforeEach(() => {
    b = new CallButton();
  });

  it('is B as ever when tapped: on letting go, before the hold is long enough, and no fan ever opens', () => {
    expect(b.press(1000, true)).toBeNull();
    expect(b.tick(1000 + HOLD_MS - 1, true)).toBe(false);
    expect(b.open).toBe(false);
    expect(b.release(1000 + HOLD_MS - 1, true)).toEqual({ kind: 'b' });
  });

  it('opens the fan once held long enough with nothing open, and sings here I am when the finger never left B', () => {
    b.press(1000, true);
    expect(b.tick(1000 + HOLD_MS, true)).toBe(true);
    expect(b.open).toBe(true);
    expect(b.choice).toBe('here');
    // Only the moment it opens counts as opening.
    expect(b.tick(1000 + HOLD_MS + 16, true)).toBe(false);
    expect(b.release(2000, true)).toEqual({ kind: 'call', call: 'here' });
    expect(b.open).toBe(false);
  });

  it('sings the call the finger slid onto, and nothing when it slid off the fan', () => {
    b.press(0, true);
    b.tick(HOLD_MS, true);
    b.point('come');
    expect(b.choice).toBe('come');
    expect(b.release(900, true)).toEqual({ kind: 'call', call: 'come' });
    b.press(2000, true);
    b.point('thanks');
    b.tick(2000 + HOLD_MS, true);
    b.point(null);
    expect(b.release(2900, true)).toBeNull();
  });

  it('is only B, at once, when something is open: a panel, the text box, a question', () => {
    expect(b.press(0, false)).toEqual({ kind: 'b' });
    expect(b.tick(HOLD_MS * 3, false)).toBe(false);
    expect(b.tick(HOLD_MS * 3, true)).toBe(false);
    expect(b.open).toBe(false);
    // Letting go does nothing more.
    expect(b.release(HOLD_MS * 4, true)).toBeNull();
  });

  it('is B, once let go, when something opened in front of it before the fan came', () => {
    b.press(0, true);
    expect(b.tick(HOLD_MS, false)).toBe(false);
    expect(b.open).toBe(false);
    expect(b.release(HOLD_MS * 2, true)).toEqual({ kind: 'b' });
  });

  it('counts a hold long enough even when no frame drew the fan before it was let go', () => {
    b.press(0, true);
    expect(b.release(HOLD_MS + 50, true)).toEqual({ kind: 'call', call: 'here' });
  });

  it('sings the call 1, 2 or 3 picks while Q is held, even before the fan opened, and letting go then does nothing', () => {
    b.press(0, true);
    expect(b.choose('thanks', true)).toEqual({ kind: 'call', call: 'thanks' });
    expect(b.release(100, true)).toBeNull();
    b.press(1000, true);
    b.tick(1000 + HOLD_MS, true);
    expect(b.choose('come', true)).toEqual({ kind: 'call', call: 'come' });
    expect(b.release(1500, true)).toBeNull();
    // Not while B is only B, and not with nothing held.
    b.press(3000, false);
    expect(b.choose('here', true)).toBeNull();
    expect(new CallButton().choose('here', true)).toBeNull();
  });

  it('calls nothing and does not open the bag when the hold is taken away', () => {
    b.press(0, true);
    b.tick(HOLD_MS, true);
    b.cancel();
    expect(b.open).toBe(false);
    expect(b.release(HOLD_MS * 2, true)).toBeNull();
    b.press(5000, true);
    b.cancel();
    expect(b.release(5100, true)).toBeNull();
  });
});

describe('the fan', () => {
  /** A's center from B's, in B's diameters, up positive (style.css: B bottom left and A top right of a box 2.25 wide and 1.75 high). */
  const A = { x: 1.25, y: 0.75 };
  const at = FAN.map(f => ({ kind: f.kind, x: FAN_RADIUS * Math.cos((f.deg * Math.PI) / 180), y: FAN_RADIUS * Math.sin((f.deg * Math.PI) / 180) }));

  it('shows the three calls in their order, as 1, 2 and 3 pick them, each with its words and its note', () => {
    expect(FAN.map(f => f.kind)).toEqual([...CALL_KINDS]);
    expect(CALL_WORDS).toEqual({ here: 'Here I am', come: 'Come here', thanks: 'Thank you' });
    for (const k of CALL_KINDS) expect(CALL_GLYPHS[k]).toMatch(/^<svg viewBox="0 0 24 24" fill="currentColor"[^>]*>[\s\S]+<\/svg>$/);
    expect(new Set(Object.values(CALL_GLYPHS)).size).toBe(3);
    expect(CALL_WORDS_UNTIL).toBeGreaterThan(0);
  });

  it('opens up and to the left of B: every note clear of A, of B and of the next one, never right of B', () => {
    for (const p of at) {
      expect(Math.hypot(p.x - A.x, p.y - A.y), p.kind).toBeGreaterThan(0.5 + FAN_NOTE / 2 + 0.25);
      expect(Math.hypot(p.x, p.y), p.kind).toBeGreaterThan(0.5 + FAN_NOTE / 2 + 0.5);
      expect(p.x, p.kind).toBeLessThanOrEqual(1e-9);
    }
    for (let i = 1; i < at.length; i++) expect(Math.hypot(at[i]!.x - at[i - 1]!.x, at[i]!.y - at[i - 1]!.y)).toBeGreaterThan(FAN_NOTE + 0.4);
  });

  it('picks the note under the finger, and one near it: a thumb need not land on it exactly', () => {
    // fanChoice takes screen axes: y grows down.
    for (const p of at) {
      expect(fanChoice(p.x, -p.y)).toBe(p.kind);
      expect(fanChoice(p.x * 0.6, -p.y * 0.6)).toBe(p.kind);
      expect(fanChoice(p.x * 1.8 + 0.1, -p.y * 1.8)).toBe(p.kind);
    }
  });

  it('is here I am while the finger is still on B', () => {
    expect(fanChoice(0, 0)).toBe('here');
    expect(fanChoice(0.4, 0.3)).toBe('here');
    expect(fanChoice(-0.3, -0.4)).toBe('here');
  });

  it('is none off the fan: toward A, to the right, down, or down and a long way left', () => {
    expect(fanChoice(A.x, -A.y)).toBeNull();
    expect(fanChoice(1.5, 0)).toBeNull();
    expect(fanChoice(0, 1.5)).toBeNull();
    expect(fanChoice(1, 1)).toBeNull();
    expect(fanChoice(-1, 1.5)).toBeNull();
    // Left and a little down is still thank you: a thumb sweeping left drops a little.
    expect(fanChoice(-1.7, 0.4)).toBe('thanks');
  });
});

describe('voices', () => {
  const ids = Array.from({ length: 400 }, (_, i) => `4b1c${i.toString(16).padStart(4, '0')}-9e2d-4c3a-8f00-${(i * 7919).toString(16).padStart(12, '0')}`);

  it('gives each player one note of a pentatonic scale, the same for their id every time', () => {
    for (const id of ids) {
      expect(VOICES).toContain(voiceOf(id));
      expect(voiceOf(id)).toBe(voiceOf(`${id}`));
    }
    // Two octaves of a pentatonic scale: five notes an octave, each octave twice the one below.
    expect(VOICES).toHaveLength(10);
    for (let i = 5; i < VOICES.length; i++) expect(VOICES[i]! / VOICES[i - 5]!).toBeCloseTo(2, 2);
  });

  it('spreads players over every note, so friends can tell each other apart', () => {
    const count = new Map<number, number>();
    for (const id of ids) count.set(voiceOf(id), (count.get(voiceOf(id)) ?? 0) + 1);
    expect(count.size).toBe(VOICES.length);
    for (const n of count.values()) expect(n).toBeGreaterThan(ids.length / VOICES.length / 3);
  });
});

describe('where a call comes from', () => {
  it('pans by the side it comes from: west on the left, east on the right, north and south in the middle', () => {
    expect(callPan(-10, 0)).toBeCloseTo(-PAN_MAX);
    expect(callPan(10, 0)).toBeCloseTo(PAN_MAX);
    expect(callPan(0, -20)).toBe(0);
    expect(callPan(0, 20)).toBe(0);
    expect(callPan(0, 0)).toBe(0);
    // Far off and nearly due north: nearly in the middle.
    expect(Math.abs(callPan(1, -20))).toBeLessThan(0.1);
    // Right beside you it leans only a little: never all in one ear.
    expect(callPan(1, 0)).toBeGreaterThan(0);
    expect(callPan(1, 0)).toBeLessThan(callPan(6, 0));
    for (const [dx, dy] of [[25, 0], [-3, 4], [17, -2]] as const) expect(Math.abs(callPan(dx, dy))).toBeLessThanOrEqual(PAN_MAX);
  });

  it('is fainter the farther away, and still heard at the edge of its reach', () => {
    expect(callGain(0)).toBe(1);
    let last = 1;
    for (let d = 1; d <= CALL_REACH; d++) {
      expect(callGain(d)).toBeLessThan(last);
      last = callGain(d);
    }
    expect(callGain(CALL_REACH)).toBeCloseTo(CALL_FAINTEST);
    expect(callGain(CALL_REACH)).toBeGreaterThan(0);
    // Someone who stepped past the reach since it was sung still hears it, as faint as at the edge.
    expect(callGain(CALL_REACH + 2)).toBeCloseTo(CALL_FAINTEST);
  });

  it('sounds duller the farther away', () => {
    expect(callTone(0)).toBe(9000);
    expect(callTone(12)).toBeLessThan(callTone(3));
    expect(callTone(CALL_REACH)).toBe(1800);
  });

  it('is sung in the caller\'s voice, from where they stood', () => {
    expect(callSound('come', 'ann', 6, -8)).toEqual({ call: 'come', pitch: voiceOf('ann'), pan: callPan(6, -8), gain: callGain(10), tone: callTone(10) });
  });
});

describe('how each call is sung', () => {
  it('here I am is one note, come here a note held and rising, thank you two quick notes', () => {
    expect(CALL_SONGS.here).toHaveLength(1);
    expect(CALL_SONGS.here[0]!.rise).toBeUndefined();
    expect(CALL_SONGS.come).toHaveLength(1);
    const come = CALL_SONGS.come[0]!;
    expect(come.rise).toBeGreaterThan(1);
    expect(come.hold).toBeGreaterThan(0.2);
    expect(come.len).toBeGreaterThan(come.hold! + 0.3);
    expect(CALL_SONGS.thanks).toHaveLength(2);
    const [one, two] = CALL_SONGS.thanks;
    // Quick, one after the other, on the same pitch.
    expect(one!.at + one!.len).toBeLessThan(two!.at);
    expect(two!.at + two!.len).toBeLessThan(0.6);
    expect(one!.rise ?? 1).toBe(two!.rise ?? 1);
  });

  it('are all short: nothing a call sings lasts much over a second', () => {
    for (const k of CALL_KINDS) for (const n of CALL_SONGS[k]) expect(n.at + n.len).toBeLessThanOrEqual(1.2);
  });
});

describe('the sound of a call', () => {
  const scene = (s: Partial<Scene> = {}): Scene => ({
    map: 'woods', kind: 'wilds', weather: 'overcast', storm: false, lightning: false,
    me: { id: 'me', x: 5, y: 5, tx: 5, ty: 5, ground: 'grass' },
    fires: [], poles: [], surge: null, caught: false, creatures: [], flashes: [], live: false, news: [], radio: null, ...s,
  });

  it('plays each call heard, from its side and as loud as it is near; your own from the middle, full', () => {
    const shots = soundscape(scene({
      news: [
        { kind: 'call', id: 'ann', call: 'come', x: 15, y: 5, at: 0 },
        { kind: 'call', id: 'bo', call: 'thanks', x: 1, y: 7, at: 0 },
        { kind: 'call', id: 'me', call: 'here', x: 5, y: 5, at: 0 },
      ],
    })).shots;
    expect(shots).toEqual([
      { kind: 'call', ...callSound('come', 'ann', 10, 0) },
      { kind: 'call', ...callSound('thanks', 'bo', -4, 2) },
      { kind: 'call', call: 'here', pitch: voiceOf('me'), pan: 0, gain: 1, tone: 9000 },
    ]);
    expect(shots[0]).toMatchObject({ pan: expect.any(Number) });
    expect((shots[0] as { pan: number }).pan).toBeGreaterThan(0);
    expect((shots[1] as { pan: number }).pan).toBeLessThan(0);
  });

  it('plays nothing before you are on the map', () => {
    expect(soundscape(scene({ me: null, news: [{ kind: 'call', id: 'ann', call: 'here', x: 1, y: 1, at: 0 }] })).shots).toEqual([]);
  });

  it('never makes a banner: a call is for the ears alone', () => {
    expect(newsBanner({ kind: 'call', id: 'ann', call: 'here', x: 1, y: 1, at: 0 }, 'The Test Woods')).toBeNull();
  });
});

describe('calls in the game', () => {
  const me: PlayerView = { id: 'me', name: 'Aldo', x: 2, y: 2, dir: 'up', color: '#f29e4c', gear: {}, quirks: [] };
  const ann: PlayerView = { id: 'ann', name: 'Ann', x: 2, y: 1, dir: 'down', color: '#3a86ff', gear: {}, quirks: [] };
  let g: Game;
  let sent: ClientMsg[];
  beforeEach(() => {
    sent = [];
    g = new Game(new Maps([tinyTown(), tinyWoods()]), m => sent.push(m), ITEMS);
    g.handle(welcome(tinyWoods(), [me, ann]), 0);
    g.news.length = 0;
  });

  it('sends a call and waits for the server to say who heard it, you too', () => {
    expect(g.call('come', 10_000)).toBe(true);
    expect(sent).toEqual([{ t: 'call', kind: 'come' }]);
    expect(g.calls).toEqual([]);
    expect(g.news).toEqual([]);
  });

  it('sends no second call too soon, and says so over your head', () => {
    g.call('here', 10_000);
    expect(g.call('thanks', 10_000 + CALL_EVERY_MS)).toBe(false);
    expect(sent).toHaveLength(1);
    expect(g.floats.map(f => f.text)).toEqual(['Catch your breath first']);
    expect(g.call('thanks', 10_000 + CALL_EVERY_MS + CALL_SLACK_MS)).toBe(true);
    expect(sent.at(-1)).toEqual({ t: 'call', kind: 'thanks' });
  });

  it('says so too when the server turns one away', () => {
    g.handle({ t: 'refused', action: 'call', reason: 'slow_down' }, 0);
    expect(g.floats.map(f => f.text)).toEqual(['Catch your breath first']);
    expect(g.note).toBeNull();
  });

  it('sends nothing while offline', () => {
    g.disconnected(0);
    expect(g.call('here', 10_000)).toBe(false);
    expect(sent).toEqual([]);
  });

  it('hears a call: for the ears (the news) and a note over the caller\'s head for a second', () => {
    g.handle({ t: 'called', id: 'ann', kind: 'thanks', x: 2, y: 1 }, 100);
    g.handle({ t: 'called', id: 'me', kind: 'here', x: 2, y: 2 }, 100);
    expect(g.calls.map(c => [c.who, c.kind, c.at])).toEqual([['ann', 'thanks', 100], ['me', 'here', 100]]);
    expect(g.calls[0]!.n).not.toBe(g.calls[1]!.n);
    expect(g.takeNews(116)).toEqual([{ kind: 'call', id: 'ann', call: 'thanks', x: 2, y: 1, at: 100 }, { kind: 'call', id: 'me', call: 'here', x: 2, y: 2, at: 100 }]);
    expect(g.takeNews(132)).toEqual([]);
    g.update(0.5, 100 + (CALL_NOTE_S * 1000) / 2);
    expect(g.calls).toHaveLength(2);
    g.update(0.5, 100 + CALL_NOTE_S * 1000);
    expect(g.calls).toEqual([]);
  });

  it('never sings a crowd of old calls at once, heard while the tab was hidden and no frame took them', () => {
    // Calls every 2 s for a minute, with no frame in between.
    for (let at = 0; at <= 60_000; at += 2000) g.handle({ t: 'called', id: 'ann', kind: 'here', x: 2, y: 1 }, at);
    g.handle({ t: 'surge', surge: { phase: 'unstable', left: 360, into: 0 } }, 60_000);
    expect(g.calls).toHaveLength(1);
    const news = g.takeNews(60_016);
    expect(news.filter(n => n.kind === 'call')).toEqual([{ kind: 'call', id: 'ann', call: 'here', x: 2, y: 1, at: 60_000 }]);
    // Other news waits as it always did.
    expect(news.map(n => n.kind)).toEqual(['call', 'surge']);
    // And one heard too long ago, with nothing after it, is not sung either.
    g.handle({ t: 'called', id: 'ann', kind: 'come', x: 2, y: 1 }, 70_000);
    expect(g.takeNews(90_000)).toEqual([]);
  });

  it('forgets the notes over heads on another map', () => {
    g.handle({ t: 'called', id: 'ann', kind: 'here', x: 2, y: 1 }, 0);
    g.handle(welcome(tinyTown(), [{ ...me, x: 3, y: 3 }]), 0);
    expect(g.calls).toEqual([]);
  });
});
