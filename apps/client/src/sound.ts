/**
 * The game's sound, all made in the browser with the Web Audio API: nothing is downloaded. Every loop
 * is built once and plays from the start, silent; each frame only moves its gain toward the level
 * soundscape.ts asks for (as the view keeps a fixed set of lights). One-shots are built as they play.
 *
 * Browsers only let sound start after a gesture, so the AudioContext is made on the first tap or key.
 * Without Web Audio, Sound does nothing.
 */
import type { Loop, Mix, Shot, Surface } from './soundscape';

export interface SoundSetting {
  /** 0 to 1. */
  volume: number;
  muted: boolean;
}

/** How loud each loop is at level 1, against the others. */
const LOOP_GAIN: Record<Loop, number> = { rain: 0.35, wind: 0.5, fire: 0.6, wires: 0.12, surge: 0.4, watcher: 0.45, shimmer: 0.08 };
/** Loops ease to a new level with this time constant: most of the way in 0.3 s. */
const EASE_S = 0.1;

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
    // A live find: two high glassy tones, slowly swelling.
    const shimmer = ctx.createGain();
    for (const f of [1318, 1976.5]) this.osc('sine', f).connect(shimmer);
    this.wobble(shimmer.gain, 0.6, 0.4, 0.6);
    this.loop('shimmer', shimmer);
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
    }
  }

  private step(surface: Surface, now: number) {
    const [type, f, q, len, g] = STEPS[surface];
    this.burst(now, type, f * (0.85 + Math.random() * 0.3), len, g, 0, q);
    if (surface === 'floor') this.tone(now, 'sine', 110, 70, 0.08, 0.25);
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
};
