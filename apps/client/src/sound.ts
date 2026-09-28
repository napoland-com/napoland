/**
 * The game's sound, all made in the browser with the Web Audio API: nothing is downloaded. Every loop
 * is built once and plays from the start, silent; each frame only moves its gain toward the level
 * soundscape.ts asks for (as the view keeps a fixed set of lights). One-shots are built as they play.
 *
 * Browsers only let sound start after a gesture, so the AudioContext is made on the first tap or key.
 * Without Web Audio, Sound does nothing.
 */
import { CALL_SONGS, type CallNote, type CallSound } from './calls';
import type { Loop, Mix, Shot, Surface } from './soundscape';

export interface SoundSetting {
  /** 0 to 1. */
  volume: number;
  muted: boolean;
}

/** How loud each loop is at level 1, against the others. */
const LOOP_GAIN: Record<Loop, number> = { rain: 0.35, wind: 0.5, fire: 0.6, wires: 0.12, surge: 0.4, watcher: 0.45, skulker: 0.55, shimmer: 0.08, radio: 0.45, hum: 0.16 };
/** Loops ease to a new level with this time constant: most of the way in 0.3 s. */
const EASE_S = 0.1;
/** How loud a call beside you is, against the rest. */
const CALL_PEAK = 0.5;

interface Voice {
  gain: GainNode;
  level: number;
  /** For a loop whose sound changes with its level, not only its loudness. */
  set?: (level: number, at: number) => void;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  /** The timbre every call is sung in: a soft note with a little of its octave and twelfth, like a hum through cupped hands. */
  private voice: PeriodicWave | null = null;
  private loops = new Map<Loop, Voice>();

  constructor(private setting: SoundSetting) {
    if (typeof AudioContext === 'undefined') return;
    const start = () => {
      try {
        if (!this.ctx) this.build(new AudioContext());
        if (!document.hidden) void this.ctx?.resume();
      } catch { /* no sound, then */ }
    };
    // Kept on, not once: iOS suspends a context after a call or an alarm, and the next tap wakes it.
    for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, start, { capture: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) void this.ctx?.suspend(); else void this.ctx?.resume(); });
  }

  set(s: SoundSetting) {
    this.setting = s;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(s.muted ? 0 : s.volume, this.ctx.currentTime, 0.05);
  }

  /** Move the loops toward `mix`, and play its one-shots. */
  update(mix: Mix) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    for (const [name, loop] of this.loops) {
      const level = mix.loops[name];
      if (Math.abs(level - loop.level) < 0.005) continue;
      loop.level = level;
      loop.gain.gain.setTargetAtTime(level * LOOP_GAIN[name], now, EASE_S);
      loop.set?.(level, now);
    }
    if (!this.setting.muted) for (const s of mix.shots) this.shot(s, now);
  }

  private build(ctx: AudioContext) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.setting.muted ? 0 : this.setting.volume;
    this.master.connect(ctx.destination);
    // Two seconds of white noise, the stuff of rain, wind, steps and thunder.
    const noise = (this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate));
    const n = noise.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
    try {
      this.voice = ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0]), new Float32Array([0, 1, 0.3, 0.1]));
    } catch { /* a triangle, then */ }

    this.loop('rain', this.filtered(this.hiss(), 'highpass', 1200, 0.5), this.filtered(null, 'lowpass', 7000));
    // Wind: noise through a band that wanders slowly, gusting.
    const wind = this.filtered(this.hiss(), 'bandpass', 420, 0.9);
    this.wobble(wind.frequency, 0.07, 260);
    this.loop('wind', wind);
    this.loop('fire', ...this.crackles());
    // The wires: mains hum, two harmonics, beating slowly.
    const hum = this.filtered(null, 'lowpass', 500);
    for (const [f, type] of [[60, 'sawtooth'], [120.4, 'sine']] as const) this.osc(type, f).connect(hum);
    this.loop('wires', hum);
    // The surge: a low tone and a rumble under it, both climbing as it gets louder.
    const tone = this.osc('sawtooth', 45), rumble = this.filtered(this.hiss(), 'lowpass', 140);
    const surge = this.filtered(null, 'lowpass', 300);
    tone.connect(surge);
    rumble.connect(surge);
    this.loop('surge', surge).set = (level, at) => {
      tone.frequency.setTargetAtTime(40 + 40 * level, at, 0.4);
      surge.frequency.setTargetAtTime(200 + 700 * level, at, 0.4);
    };
    // A watcher moving: something heavy scraped over the ground, a couple of drags a second.
    const drag = this.filtered(this.hiss(), 'bandpass', 260, 3);
    const scrape = ctx.createGain();
    drag.connect(scrape);
    this.wobble(scrape.gain, 2.2, 0.5, 0.5);
    this.loop('watcher', scrape);
    // A skulker on a chase: ferns thrashing, fast and light, many times a second.
    const leaves = this.filtered(this.hiss(1.3), 'bandpass', 2600, 1.2);
    const thrash = ctx.createGain();
    leaves.connect(thrash);
    this.wobble(thrash.gain, 7, 0.5, 0.5);
    this.loop('skulker', thrash);
    // A live find: two high glassy tones, slowly swelling.
    const shimmer = ctx.createGain();
    for (const f of [1318, 1976.5]) this.osc('sine', f).connect(shimmer);
    this.wobble(shimmer.gain, 0.6, 0.4, 0.6);
    this.loop('shimmer', shimmer);
    // The radio's crackle: static through a band, and clicks on top of it that come thicker and brighter
    // the nearer it is to something strange (its level), like a counter.
    const band = this.filtered(this.hiss(1.1), 'bandpass', 1500, 0.8), under = ctx.createGain(), clicks = this.clicks(), crackle = ctx.createGain();
    under.gain.value = 0.35;
    band.connect(under).connect(crackle);
    clicks.connect(crackle);
    this.loop('radio', crackle).set = (level, at) => {
      clicks.playbackRate.setTargetAtTime(0.6 + 1.6 * level, at, 0.15);
      band.frequency.setTargetAtTime(1200 + 1600 * level, at, 0.15);
    };
    // The hum the radio picks up everywhere: low and slow, in the Old Stone's voice (D, its octave a
    // little apart so the two beat, and a faint fifth), swelling and ebbing.
    const stone = this.filtered(null, 'lowpass', 600), swell = ctx.createGain();
    for (const [f, g] of [[73.42, 0.6], [146.83, 0.4], [147.3, 0.3], [220, 0.1]] as const) {
      const part = ctx.createGain();
      part.gain.value = g;
      this.osc('sine', f).connect(part).connect(stone);
    }
    stone.connect(swell);
    this.wobble(swell.gain, 0.13, 0.3, 0.7);
    this.loop('hum', swell);
  }

  /** A loop: `chain` wired in order, into its gain (silent to start), into the master. */
  private loop(name: Loop, ...chain: AudioNode[]): Voice {
    const gain = this.ctx!.createGain();
    gain.gain.value = 0;
    chain.reduce((a, b) => (a.connect(b), b)).connect(gain).connect(this.master!);
    const loop: Voice = { gain, level: 0 };
    this.loops.set(name, loop);
    return loop;
  }

  /** The noise, looping forever, played at `rate`. */
  private hiss(rate = 1, loop = true): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = loop;
    src.playbackRate.value = rate;
    // Loops start at a random point so two of them never line up.
    if (loop) src.start(0, Math.random() * 2);
    return src;
  }

  private filtered(from: AudioNode | null, type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode {
    const filter = this.ctx!.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = f;
    filter.Q.value = q;
    from?.connect(filter);
    return filter;
  }

  private osc(type: OscillatorType, f: number): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.start();
    return o;
  }

  /** Swing `param` by `depth` around `base` (or its value), `rate` times a second. */
  private wobble(param: AudioParam, rate: number, depth: number, base?: number) {
    if (base !== undefined) param.value = base;
    const lfo = this.ctx!.createGain();
    lfo.gain.value = depth;
    this.osc('sine', rate).connect(lfo).connect(param);
  }

  /** The radio's clicks: two seconds of sparse ticks and a few longer pops, made once and looped. */
  private clicks(): AudioBufferSourceNode {
    const ctx = this.ctx!, buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
    for (let k = 0; k < 90; k++) {
      const at = Math.floor(Math.random() * (d.length - 1200)), amp = 0.25 + Math.random() * 0.75, len = Math.random() < 0.2 ? 200 + Math.random() * 900 : 6 + Math.random() * 50;
      for (let i = 0; i < len; i++) d[at + i]! += (Math.random() * 2 - 1) * amp * Math.exp(-i / (len / 4));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start(0, Math.random() * 2);
    return src;
  }

  /** A fire: a low roar with sparks snapping in it, three seconds made once and looped. */
  private crackles(): AudioNode[] {
    const ctx = this.ctx!, buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate), d = buf.getChannelData(0);
    let roar = 0;
    for (let i = 0; i < d.length; i++) {
      roar = roar * 0.98 + (Math.random() * 2 - 1) * 0.02;
      d[i] = roar * 3;
    }
    for (let k = 0; k < 40; k++) {
      const at = Math.floor(Math.random() * (d.length - 2000)), amp = 0.3 + Math.random() * 0.7, len = 200 + Math.random() * 1200;
      for (let i = 0; i < len; i++) d[at + i]! += (Math.random() * 2 - 1) * amp * Math.exp(-i / (len / 5));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start();
    return [src, this.filtered(null, 'lowpass', 4000)];
  }

  private shot(s: Shot, now: number) {
    switch (s.kind) {
      case 'step': return this.step(s.surface, now);
      // The blink is seen at once; the thunder comes as far off as the strike was.
      case 'thunder': return this.burst(now + 0.6 + Math.random() * 1.4, 'lowpass', 180, 2.8, 1.1, 0.5);
      case 'crackle': for (let i = 0; i < 6; i++) this.burst(now + Math.random() * 0.5, 'highpass', 2500, 0.05, 0.4); return;
      case 'pop': this.burst(now, 'lowpass', 900, 0.3, 0.9); return this.tone(now, 'sine', 160, 50, 0.3, 0.6);
      case 'bell': for (const [k, g] of [[1, 0.5], [2.76, 0.2], [5.4, 0.1]] as const) this.tone(now, 'sine', 147 * k, 147 * k, 3, g); return;
      case 'rise': return this.tone(now, 'triangle', 180, 520, 0.9, 0.25);
      // A new day: two soft notes, a fifth apart.
      case 'dawn': this.tone(now, 'sine', 392, 392, 1.6, 0.12); return this.tone(now + 0.3, 'sine', 587, 587, 2, 0.1);
      // Something bursting out of the ferns: a sharp rustle and a short cry falling away.
      case 'cry': this.burst(now, 'highpass', 1800, 0.35, 0.6); return this.tone(now + 0.05, 'sawtooth', 1300, 420, 0.4, 0.18);
      case 'call': return this.call(s, now);
      case 'pulse': return this.pulse(now);
      // The radio switched on: its click, and the static sweeping as it finds the hum.
      case 'tune': this.click(now); return this.sweep(now + 0.03, 3200, 900, 0.4, 0.22);
      case 'click': return this.click(now);
    }
  }

  /** The radio's switch. */
  private click(now: number) {
    this.burst(now, 'highpass', 2500, 0.018, 0.35);
    this.tone(now, 'square', 1700, 1100, 0.02, 0.06);
  }

  /** Static through a band that sweeps from `f0` to `f1` Hz over `len` seconds, broken up as a weak signal is. */
  private sweep(at: number, f0: number, f1: number, len: number, peak: number) {
    const ctx = this.ctx!, src = this.hiss(1, false), band = this.filtered(src, 'bandpass', f0, 1.4), g = ctx.createGain(), chop = ctx.createGain();
    // Longer than what is left of the noise after a random start: it goes round.
    src.loop = true;
    band.frequency.setValueAtTime(f0, at);
    band.frequency.exponentialRampToValueAtTime(f1, at + len);
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = 17;
    depth.gain.value = 0.45;
    chop.gain.value = 0.55;
    lfo.connect(depth).connect(chop.gain);
    band.connect(chop).connect(g).connect(this.master!);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.08, len / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.start(at, Math.random());
    lfo.start(at);
    for (const n of [src, lfo]) n.stop(at + len + 0.05);
  }

  /** The Tower's pulse on the radio: one long burst of static that swells, breaks up and falls away, with a thump under it. */
  private pulse(now: number) {
    this.sweep(now, 2800, 600, 1.5, 0.4);
    this.burst(now + 0.02, 'lowpass', 160, 0.5, 0.5);
    for (let i = 0; i < 5; i++) this.burst(now + 0.1 + Math.random() * 1.1, 'highpass', 3000, 0.03, 0.3);
  }

  /**
   * A call (calls.ts): the caller's note, in the shape of its kind, from where it came: panned to its
   * side, and dulled and quietened by the distance. Its nodes are made for it and let go once it ends.
   */
  private call(s: CallSound, now: number) {
    const ctx = this.ctx!, air = this.filtered(null, 'lowpass', s.tone, 0.5), level = ctx.createGain();
    level.gain.value = s.gain * CALL_PEAK;
    air.connect(level);
    // Without a stereo panner (an old Safari) it plays from the middle.
    if (typeof ctx.createStereoPanner === 'function') {
      const side = ctx.createStereoPanner();
      side.pan.value = s.pan;
      level.connect(side).connect(this.master!);
    } else level.connect(this.master!);
    for (const n of CALL_SONGS[s.call]) this.sing(air, now + n.at, n, s.pitch);
  }

  /** One note of a call at `f` Hz into `into`: it scoops up into its pitch as a voice does, holds with a slow vibrato, and may rise. */
  private sing(into: AudioNode, at: number, n: CallNote, f: number) {
    const ctx = this.ctx!, end = at + n.len, o = ctx.createOscillator(), g = ctx.createGain();
    if (this.voice) o.setPeriodicWave(this.voice);
    else o.type = 'triangle';
    o.frequency.setValueAtTime(f * 0.96, at);
    o.frequency.exponentialRampToValueAtTime(f, at + 0.05);
    if (n.rise && n.hold !== undefined) {
      o.frequency.setValueAtTime(f, at + n.hold);
      o.frequency.exponentialRampToValueAtTime(f * n.rise, end - 0.05);
    }
    // The vibrato comes in once the note is held, in cents, so it sways as much on a high voice as a low one.
    const lfo = ctx.createOscillator(), sway = ctx.createGain();
    lfo.frequency.value = 5.2;
    sway.gain.setValueAtTime(0, at);
    sway.gain.setValueAtTime(0, at + 0.12);
    sway.gain.linearRampToValueAtTime(14, at + 0.35);
    lfo.connect(sway).connect(o.detune);
    const fade = Math.min(0.2, n.len * 0.5);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(n.peak, at + 0.03);
    g.gain.setValueAtTime(n.peak, end - fade);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    o.connect(g).connect(into);
    for (const src of [o, lfo]) {
      src.start(at);
      src.stop(end + 0.05);
    }
    // A breath under it: a little noise around its upper harmonics.
    const breath = this.hiss(1, false), bg = ctx.createGain();
    this.filtered(breath, 'bandpass', f * 3, 2).connect(bg).connect(into);
    bg.gain.setValueAtTime(0.0001, at);
    bg.gain.exponentialRampToValueAtTime(n.peak * 0.08, at + 0.02);
    bg.gain.exponentialRampToValueAtTime(0.0001, end);
    breath.start(at, Math.random());
    breath.stop(end + 0.05);
  }

  private step(surface: Surface, now: number) {
    const [type, f, q, len, g] = STEPS[surface];
    // Tall grass swells in rather than thuds: the blades brush your legs, and a lighter rustle follows.
    const swish = surface === 'swish';
    this.burst(now, type, f * (0.85 + Math.random() * 0.3), len, g, swish ? 0.06 : 0, q);
    if (surface === 'floor') this.tone(now, 'sine', 110, 70, 0.08, 0.25);
    if (swish) this.burst(now + 0.08 + Math.random() * 0.04, 'highpass', 4200, 0.14, g * 0.45, 0.02);
  }

  /** A burst of filtered noise from `at`, dying away over `len` seconds (after `attack` rising). */
  private burst(at: number, type: BiquadFilterType, f: number, len: number, peak: number, attack = 0.005, q = 0.7) {
    const ctx = this.ctx!, src = this.hiss(0.8 + Math.random() * 0.4, false), g = ctx.createGain();
    this.filtered(src, type, f, q).connect(g).connect(this.master!);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + len);
    src.start(at, Math.random());
    src.stop(at + attack + len + 0.05);
  }

  /** A tone gliding from `f0` to `f1` Hz, dying away over `len` seconds. */
  private tone(at: number, type: OscillatorType, f0: number, f1: number, len: number, peak: number) {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f1, at + len);
    o.connect(g).connect(this.master!);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.start(at);
    o.stop(at + len + 0.05);
  }
}

/** A footstep on each surface: the filter, its frequency and Q, how long, how loud. */
const STEPS: Record<Surface, [BiquadFilterType, number, number, number, number]> = {
  road: ['bandpass', 1900, 1.2, 0.06, 0.5],
  soft: ['lowpass', 900, 0.7, 0.09, 0.25],
  mud: ['lowpass', 380, 2, 0.14, 0.45],
  floor: ['bandpass', 600, 3, 0.07, 0.35],
  water: ['bandpass', 1300, 2.5, 0.16, 0.4],
  swish: ['bandpass', 2600, 0.8, 0.2, 0.32],
};
