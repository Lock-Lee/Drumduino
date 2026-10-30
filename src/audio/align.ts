// Finds where a score starts in a recording of the song, and the recording's exact tempo.
// Works on onsets: a simple two-band (low = kick, high = snare/cymbal attack) spectral-flux curve
// is matched against the score's notes, first coarsely at the score tempo, then refined with tempo.
import type { Score } from '../score/types';
import { PPQ } from '../score/types';

export interface AlignResult {
  /** seconds into the file where measure 1 starts */
  offset: number;
  /** tempo of the recording that fits the score best */
  bpm: number;
  /** how clearly the best match stands out (≳3 is a confident match) */
  confidence: number;
}

const HOP = 0.01; // seconds per onset frame

const WEIGHT: Record<string, number> = { kick: 1, snare: 1, crash: 0.8, tom1: 0.7, tom2: 0.7, floor: 0.7, hihat: 0.35, ride: 0.35 };

export function onsetCurve(x: Float32Array, sr: number): Float32Array {
  // exact 10 ms frames (sr * HOP is not a whole number at 22.05/44.1 kHz)
  const hop = sr * HOP;
  const n = Math.floor(x.length / hop) - 1;
  const lo = new Float32Array(n), hi = new Float32Array(n);
  const a = Math.exp((-2 * Math.PI * 150) / sr);
  let l = 0, prev = 0;
  for (let f = 0; f < n; f++) {
    let el = 0, eh = 0;
    for (let i = Math.round(f * hop), e = Math.round((f + 1) * hop); i < e; i++) {
      const v = x[i];
      l = (1 - a) * v + a * l;
      const d = v - prev;
      prev = v;
      el += l * l;
      eh += d * d;
    }
    lo[f] = Math.log(1 + 1e4 * el);
    hi[f] = Math.log(1 + 1e4 * eh);
  }
  const flux = (e: Float32Array) => {
    const o = new Float32Array(n);
    let sum = 0;
    for (let f = 1; f < n; f++) {
      o[f] = Math.max(0, e[f] - e[f - 1]);
      sum += o[f];
    }
    const mean = sum / n || 1;
    for (let f = 0; f < n; f++) o[f] /= mean;
    return o;
  };
  const fl = flux(lo), fh = flux(hi);
  const o = new Float32Array(n);
  for (let f = 0; f < n; f++) o[f] = fl[f] + fh[f];
  // remove the slow loudness trend (0.5 s moving average)
  const w = 25;
  const c = new Float32Array(n + 1);
  for (let f = 0; f < n; f++) c[f + 1] = c[f] + o[f];
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const s = Math.max(0, f - w), e = Math.min(n, f + w + 1);
    out[f] = Math.max(0, o[f] - (c[e] - c[s]) / (e - s));
  }
  // allow ±1 frame of timing slop
  const d = new Float32Array(n);
  for (let f = 0; f < n; f++) d[f] = Math.max(out[f], f > 0 ? out[f - 1] : 0, f < n - 1 ? out[f + 1] : 0);
  return d;
}

/** the score as weighted events: [beats from measure 1, weight] */
export function events(score: Score, maxTick = Infinity): { beat: Float64Array; w: Float32Array } {
  const by = new Map<number, number>();
  for (const n of score.notes) {
    if (n.tick >= maxTick) continue;
    by.set(n.tick, Math.min(1.6, (by.get(n.tick) ?? 0) + (WEIGHT[n.pad] ?? 0.3)));
  }
  const ticks = [...by.keys()].sort((p, q) => p - q);
  return { beat: Float64Array.from(ticks, (t) => t / PPQ), w: Float32Array.from(ticks, (t) => by.get(t)!) };
}

export function fit(d: Float32Array, ev: { beat: Float64Array; w: Float32Array }, offset: number, bpm: number) {
  const spb = 60 / bpm;
  let s = 0;
  for (let i = 0; i < ev.beat.length; i++) {
    const f = Math.round((offset + ev.beat[i] * spb) / HOP);
    if (f >= 0 && f < d.length) s += ev.w[i] * d[f];
  }
  return s;
}

function estimateTempo(d: Float32Array, scoreBpm: number): number {
  let best = scoreBpm, bestV = -Infinity;
  const n = d.length;
  let mean = 0;
  for (const v of d) mean += v;
  mean /= n || 1;
  for (let bpm = scoreBpm * 0.92; bpm <= scoreBpm * 1.08; bpm += 0.02) {
    // average correlation at 1, 2 and 4 beats (fractional lags by interpolation)
    let v = 0;
    for (const beats of [1, 2, 4]) {
      const lag = (beats * 60) / bpm / HOP;
      const li = Math.floor(lag), fr = lag - li;
      let s = 0;
      for (let f = 0; f + li + 1 < n; f += 2) s += (d[f] - mean) * ((1 - fr) * d[f + li] + fr * d[f + li + 1] - mean);
      v += s;
    }
    if (v > bestV) {
      bestV = v;
      best = bpm;
    }
  }
  return best;
}

export async function alignScore(mono: Float32Array, sr: number, score: Score, progress?: (p: number) => void): Promise<AlignResult> {
  const pause = () => new Promise((r) => setTimeout(r, 0));
  const d = onsetCurve(mono, sr);
  const dur = d.length * HOP;
  const all = events(score);
  // the recording's tempo: strongest bar-length repetition of the onset curve within ±8 % of the score
  const B0 = estimateTempo(d, score.bpm);
  // coarse grid: tempo B0 ± 0.4 % (0.03 BPM steps) × every offset (20 ms steps), loud pieces only.
  // Over a whole song a 0.1 BPM error already smears the hits, so the tempo has to be searched too.
  const loud = events({ ...score, notes: score.notes.filter((q) => q.pad === 'kick' || q.pad === 'snare' || q.pad === 'crash') });
  const head = loud.beat.length > 40 ? loud : all;
  const steps = Math.max(1, Math.floor((dur - 2) / (2 * HOP)));
  const tempos: number[] = [];
  for (let bpm = B0 * 0.996; bpm <= B0 * 1.004; bpm += 0.03) tempos.push(bpm);
  const cand: { o: number; bpm: number; s: number }[] = [];
  let sum = 0, cnt = 0;
  for (let ti = 0; ti < tempos.length; ti++) {
    for (let k = 0; k < steps; k++) {
      const o = k * 2 * HOP;
      const sc = fit(d, head, o, tempos[ti]);
      sum += sc;
      cnt++;
      cand.push({ o, bpm: tempos[ti], s: sc });
    }
    // keep the list short: best 40 so far
    cand.sort((p, q) => q.s - p.s);
    cand.length = Math.min(cand.length, 40);
    progress?.(0.7 * ((ti + 1) / tempos.length));
    await pause();
  }
  const mean = cnt ? sum / cnt : 0;
  const picks: typeof cand = [];
  for (const c of cand) {
    if (picks.every((p) => Math.abs(p.o - c.o) > 0.3)) picks.push(c);
    if (picks.length >= 5) break;
  }

  // refine each candidate on the full score over the whole tempo window (the coarse grid can land
  // a little off the sharp tempo peak, which also shifts its best offset by a few tenths)
  let best = { offset: 0, bpm: B0, s: -1 };
  for (let pi = 0; pi < picks.length; pi++) {
    const c = picks[pi];
    for (let bpm = B0 * 0.996; bpm <= B0 * 1.004; bpm += 0.01) {
      for (let o = c.o - 0.3; o <= c.o + 0.3; o += HOP) {
        if (o < 0) continue;
        const s = fit(d, all, o, bpm);
        if (s > best.s) best = { offset: o, bpm, s };
      }
    }
    progress?.(0.7 + 0.25 * ((pi + 1) / picks.length));
    await pause();
  }
  // final polish
  const b = { ...best };
  for (let bpm = b.bpm - 0.012; bpm <= b.bpm + 0.012; bpm += 0.002) {
    for (let o = b.offset - 0.04; o <= b.offset + 0.04; o += HOP / 2) {
      if (o < 0) continue;
      const s = fit(d, all, o, bpm);
      if (s > best.s) best = { offset: o, bpm, s };
    }
  }
  progress?.(1);
  const coarseBest = fit(d, head, best.offset, best.bpm);
  return { offset: Math.round(best.offset * 1000) / 1000, bpm: Math.round(best.bpm * 1000) / 1000, confidence: mean > 0 ? coarseBest / mean : 0 };
}
