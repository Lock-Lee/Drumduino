// Audio engine: holds decoded buffers and plays pads with low latency.
import type { Pad } from '../types';
import { BUILTINS, renderBuiltin } from './synth';
import { getSample } from './sampleDb';

export type HitListener = (padId: string, velocity: number) => void;

class Engine {
  readonly ctx: AudioContext;
  private master: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private rr = new Map<string, number>();
  private listeners = new Set<HitListener>();
  /** Last playing source per pad, so open hi-hat can be choked by closed etc. */
  private voices = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(limiter).connect(this.ctx.destination);
  }

  async loadBuiltins(): Promise<void> {
    await Promise.all(
      BUILTINS.map(async (def) => {
        if (!this.buffers.has(def.id)) this.buffers.set(def.id, await renderBuiltin(def));
      })
    );
  }

  /** Decode a user file. Returns the decoded buffer (throws if not audio). */
  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.ctx.decodeAudioData(data.slice(0));
  }

  setBuffer(id: string, buf: AudioBuffer) {
    this.buffers.set(id, buf);
  }

  forget(id: string) {
    this.buffers.delete(id);
  }

  has(id: string) {
    return this.buffers.has(id);
  }

  /** Ensure a user sample is loaded from storage. */
  ensure(id: string): Promise<AudioBuffer | null> {
    const b = this.buffers.get(id);
    if (b) return Promise.resolve(b);
    let p = this.loading.get(id);
    if (!p) {
      p = getSample(id)
        .then((data) => (data ? this.decode(data) : null))
        .then((buf) => {
          if (buf) this.buffers.set(id, buf);
          return buf;
        })
        .catch(() => null)
        .finally(() => this.loading.delete(id));
      this.loading.set(id, p);
    }
    return p;
  }

  setMaster(v: number) {
    this.master.gain.setTargetAtTime(Math.max(0, Math.min(1, v / 100)), this.ctx.currentTime, 0.01);
  }

  resume() {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  onHit(fn: HitListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Pick which sample to play for this hit. */
  private pick(pad: Pad, velocity: number): string | null {
    const n = pad.samples.length;
    if (n === 0) return null;
    if (n === 1) return pad.samples[0];
    if (pad.mode === 'vel') {
      const i = Math.min(n - 1, Math.floor(((Math.max(1, velocity) - 1) * n) / 127));
      return pad.samples[i];
    }
    if (pad.mode === 'rr') {
      const i = (this.rr.get(pad.id) ?? -1) + 1;
      this.rr.set(pad.id, i % n);
      return pad.samples[i % n];
    }
    return pad.samples[Math.floor(Math.random() * n)];
  }

  /** Play a pad. velocity 1–127. */
  play(pad: Pad, velocity: number, source: 'serial' | 'midi' | 'key' | 'ui' = 'ui') {
    this.resume();
    const v = Math.max(1, Math.min(127, Math.round(velocity)));
    this.listeners.forEach((fn) => fn(pad.id, v));
    const id = this.pick(pad, v);
    if (!id) return;
    const buf = this.buffers.get(id);
    if (!buf) {
      void this.ensure(id);
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = Math.pow(2, pad.pitch / 12);
    const g = this.ctx.createGain();
    // perceptual velocity curve
    const velGain = Math.pow(v / 127, 1.6);
    g.gain.value = (pad.volume / 100) * velGain;
    src.connect(g).connect(this.master);
    const t = this.ctx.currentTime;

    // Same pad re-hit: fade the previous voice quickly to avoid build-up on cymbals/hats.
    const prev = this.voices.get(pad.id);
    if (prev && source !== 'ui') {
      prev.gain.gain.setTargetAtTime(prev.gain.gain.value * 0.5, t, 0.03);
    }
    this.voices.set(pad.id, { src, gain: g });
    src.onended = () => {
      if (this.voices.get(pad.id)?.src === src) this.voices.delete(pad.id);
    };
    src.start(t);
  }

  /** Preview a single sample (library page). Returns a stop function. */
  preview(id: string, onEnd: () => void): () => void {
    this.resume();
    let src: AudioBufferSourceNode | null = null;
    let stopped = false;
    void this.ensure(id).then((buf) => {
      if (!buf || stopped) return onEnd();
      src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = 0.8;
      src.connect(g).connect(this.master);
      src.onended = () => onEnd();
      src.start();
    });
    return () => {
      stopped = true;
      try {
        src?.stop();
      } catch {
        /* already stopped */
      }
    };
  }

  /** Little peak waveform for drawing, normalized 0–1. */
  peaks(id: string, bins = 40): number[] | null {
    const buf = this.buffers.get(id);
    if (!buf) return null;
    const d = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(d.length / bins));
    const out: number[] = [];
    let max = 0;
    for (let b = 0; b < bins; b++) {
      let m = 0;
      for (let i = b * step; i < Math.min(d.length, (b + 1) * step); i++) m = Math.max(m, Math.abs(d[i]));
      out.push(m);
      max = Math.max(max, m);
    }
    return out.map((m) => (max > 0 ? m / max : 0));
  }
}

export const engine = new Engine();
