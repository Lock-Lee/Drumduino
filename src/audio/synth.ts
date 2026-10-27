// Built-in drum sounds, synthesized at startup with OfflineAudioContext.
// No sample files ship with the app, so the kit makes sound out of the box.
import type { SampleCategory } from '../types';

const SR = 44100;

type Build = (ctx: OfflineAudioContext, out: AudioNode) => void;

async function render(seconds: number, build: Build): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
  const out = ctx.createGain();
  out.connect(ctx.destination);
  build(ctx, out);
  return ctx.startRendering();
}

function noise(ctx: BaseAudioContext, seconds: number): AudioBufferSourceNode {
  const buf = ctx.createBuffer(1, Math.ceil(SR * seconds), SR);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

function env(ctx: BaseAudioContext, peak: number, decay: number, attack = 0.001): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, 0);
  g.gain.linearRampToValueAtTime(peak, attack);
  g.gain.exponentialRampToValueAtTime(0.0001, attack + decay);
  return g;
}

function kick(amp: number, click: number): Build {
  return (ctx, out) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, 0);
    o.frequency.exponentialRampToValueAtTime(48, 0.13);
    const g = env(ctx, amp, 0.55);
    o.connect(g).connect(out);
    o.start(0);
    const n = noise(ctx, 0.03);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1500;
    const ng = env(ctx, click, 0.02);
    n.connect(hp).connect(ng).connect(out);
    n.start(0);
  };
}

function snare(amp: number, decay: number, tone: number): Build {
  return (ctx, out) => {
    const n = noise(ctx, decay + 0.1);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    const ng = env(ctx, amp, decay);
    n.connect(hp).connect(ng).connect(out);
    n.start(0);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, 0);
    o.frequency.exponentialRampToValueAtTime(170, 0.08);
    const og = env(ctx, tone, 0.12);
    o.connect(og).connect(out);
    o.start(0);
  };
}

function rim(): Build {
  return (ctx, out) => {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 1750;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1750;
    bp.Q.value = 4;
    const g = env(ctx, 0.9, 0.05);
    o.connect(bp).connect(g).connect(out);
    o.start(0);
    snare(0.35, 0.08, 0.2)(ctx, out);
  };
}

function hat(decay: number, amp: number): Build {
  return (ctx, out) => {
    // metallic: several square oscillators at inharmonic ratios
    const base = 40;
    const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
    const mix = ctx.createGain();
    mix.gain.value = 0.25;
    for (const r of ratios) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = base * r * 10;
      o.connect(mix);
      o.start(0);
    }
    const n = noise(ctx, decay + 0.1);
    const ngain = ctx.createGain();
    ngain.gain.value = 0.6;
    n.connect(ngain).connect(mix);
    n.start(0);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = env(ctx, amp, decay);
    mix.connect(hp).connect(g).connect(out);
  };
}

function tom(f0: number, f1: number, decay: number): Build {
  return (ctx, out) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, 0);
    o.frequency.exponentialRampToValueAtTime(f1, decay * 0.6);
    const g = env(ctx, 0.9, decay);
    o.connect(g).connect(out);
    o.start(0);
    const n = noise(ctx, 0.05);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3000;
    const ng = env(ctx, 0.25, 0.04);
    n.connect(lp).connect(ng).connect(out);
    n.start(0);
  };
}

function cymbal(decay: number, amp: number, cutoff: number): Build {
  return (ctx, out) => {
    const ratios = [1, 1.342, 1.783, 2.371, 2.917, 3.613, 4.21];
    const mix = ctx.createGain();
    mix.gain.value = 0.18;
    for (const r of ratios) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 410 * r;
      o.connect(mix);
      o.start(0);
    }
    const n = noise(ctx, decay + 0.2);
    const ng = ctx.createGain();
    ng.gain.value = 0.9;
    n.connect(ng).connect(mix);
    n.start(0);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = cutoff;
    const g = env(ctx, amp, decay, 0.004);
    mix.connect(hp).connect(g).connect(out);
  };
}

function bell(): Build {
  return (ctx, out) => {
    for (const [f, a] of [[742, 0.5], [1113, 0.35], [1810, 0.25], [2650, 0.15]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = env(ctx, a, 1.4);
      o.connect(g).connect(out);
      o.start(0);
    }
    cymbal(0.6, 0.25, 6000)(ctx, out);
  };
}

export interface BuiltinDef {
  id: string;
  name: string;
  category: SampleCategory;
  seconds: number;
  build: Build;
}

export const BUILTINS: BuiltinDef[] = [
  { id: 'bi:kick-soft', name: 'Kick Soft', category: 'kick', seconds: 0.6, build: kick(0.7, 0.15) },
  { id: 'bi:kick-hard', name: 'Kick Hard', category: 'kick', seconds: 0.65, build: kick(1.0, 0.5) },
  { id: 'bi:snare-ghost', name: 'Snare Ghost', category: 'snare', seconds: 0.25, build: snare(0.4, 0.12, 0.3) },
  { id: 'bi:snare-mid', name: 'Snare Mid', category: 'snare', seconds: 0.35, build: snare(0.8, 0.22, 0.6) },
  { id: 'bi:snare-hard', name: 'Snare Hard', category: 'snare', seconds: 0.45, build: snare(1.0, 0.3, 0.8) },
  { id: 'bi:snare-rim', name: 'Snare Rim', category: 'snare', seconds: 0.2, build: rim() },
  { id: 'bi:hh-closed', name: 'Hi-hat Closed', category: 'hihat', seconds: 0.12, build: hat(0.06, 0.8) },
  { id: 'bi:hh-half', name: 'Hi-hat Half', category: 'hihat', seconds: 0.35, build: hat(0.25, 0.8) },
  { id: 'bi:hh-open', name: 'Hi-hat Open', category: 'hihat', seconds: 0.9, build: hat(0.75, 0.75) },
  { id: 'bi:tom-high', name: 'Tom High', category: 'tom', seconds: 0.7, build: tom(260, 180, 0.6) },
  { id: 'bi:tom-mid', name: 'Tom Mid', category: 'tom', seconds: 0.8, build: tom(200, 135, 0.7) },
  { id: 'bi:tom-floor', name: 'Tom Floor', category: 'tom', seconds: 1.0, build: tom(140, 85, 0.9) },
  { id: 'bi:crash-soft', name: 'Crash Soft', category: 'cym', seconds: 2.0, build: cymbal(1.8, 0.5, 5000) },
  { id: 'bi:crash-hard', name: 'Crash Hard', category: 'cym', seconds: 2.6, build: cymbal(2.4, 0.9, 4000) },
  { id: 'bi:ride-bow', name: 'Ride Bow', category: 'cym', seconds: 1.6, build: cymbal(1.4, 0.45, 7500) },
  { id: 'bi:ride-bell', name: 'Ride Bell', category: 'cym', seconds: 1.6, build: bell() }
];

export async function renderBuiltin(def: BuiltinDef): Promise<AudioBuffer> {
  return render(def.seconds, def.build);
}
