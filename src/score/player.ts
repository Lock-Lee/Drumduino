// Plays a Score through the audio engine with a look-ahead scheduler (sample-accurate timing).
import { engine } from '../audio/engine';
import type { Pad, Zone } from '../types';
import type { Art, PadId, Score } from './types';
import { PPQ, ticksPerMeasure } from './types';

export type DrumsMode = 'full' | 'guide' | 'off';

export interface PlayerOptions {
  bpm: number;
  /** measures [from, to) */
  from: number;
  to: number;
  loop: boolean;
  countIn: boolean;
  metronome: boolean;
  drums: DrumsMode;
}

/** A note as scheduled: when it should be hit (AudioContext time). Used for judging. */
export interface Expected {
  idx: number;
  pad: PadId;
  art: Art;
  time: number;
  pass: number;
}

export function artToPlay(art: Art, vel: number): { zone: Zone; vel: number; hat?: number } {
  switch (art) {
    case 'open': return { zone: 'head', vel, hat: 1 };
    case 'half': return { zone: 'head', vel, hat: 0.4 };
    case 'pedal': return { zone: 'pedal', vel };
    case 'rim': return { zone: 'rim', vel: Math.max(vel, 90) };
    case 'xstick': return { zone: 'rim', vel: Math.min(vel, 36) };
    default: return { zone: 'head', vel, hat: 0 };
  }
}

const LOOKAHEAD = 0.12;
const INTERVAL = 25;

export class Player {
  private timer: number | null = null;
  private score: Score | null = null;
  private opt: PlayerOptions | null = null;
  private passStart = 0;
  private pass = 0;
  private noteIdx = 0;
  private nextBeat = 0;
  private endTimer: number | null = null;
  playing = false;

  constructor(
    private getPad: (id: PadId) => Pad | undefined,
    private onScheduled: (e: Expected) => void,
    private onEnd: () => void,
    private onPass: (pass: number) => void
  ) {}

  private get spt() {
    return 60 / (this.opt!.bpm * PPQ);
  }

  private range() {
    const tpm = ticksPerMeasure(this.score!);
    return { start: this.opt!.from * tpm, end: this.opt!.to * tpm, tpm };
  }

  start(score: Score, opt: PlayerOptions) {
    this.stop();
    engine.resume();
    this.score = score;
    this.opt = opt;
    const { start, tpm } = this.range();
    const beatTicks = (PPQ * 4) / score.sig[1];
    let t0 = engine.ctx.currentTime + 0.12;
    if (opt.countIn) {
      const beats = tpm / beatTicks;
      for (let b = 0; b < beats; b++) engine.click(t0 + b * beatTicks * this.spt, b === 0, 0.8);
      t0 += tpm * this.spt;
    }
    this.passStart = t0;
    this.pass = 0;
    this.resetPass(start);
    this.playing = true;
    this.timer = window.setInterval(() => this.schedule(), INTERVAL);
    this.schedule();
  }

  private resetPass(start: number) {
    const notes = this.score!.notes;
    this.noteIdx = notes.findIndex((n) => n.tick >= start);
    if (this.noteIdx < 0) this.noteIdx = notes.length;
    this.nextBeat = start;
  }

  /** Change tempo while playing without jumping. */
  setBpm(bpm: number) {
    if (!this.opt) return;
    if (this.playing) {
      const cur = this.currentTick();
      const { start } = this.range();
      this.opt.bpm = bpm;
      this.passStart = engine.ctx.currentTime - (cur - start) * this.spt;
    } else this.opt.bpm = bpm;
  }

  setOptions(p: Partial<Pick<PlayerOptions, 'metronome' | 'drums' | 'loop'>>) {
    if (this.opt) Object.assign(this.opt, p);
  }

  private schedule() {
    if (!this.score || !this.opt) return;
    const { start, end } = this.range();
    const notes = this.score.notes;
    const horizon = engine.ctx.currentTime + LOOKAHEAD;
    const timeOf = (tick: number) => this.passStart + (tick - start) * this.spt;
    const beatTicks = (PPQ * 4) / this.score.sig[1];
    const tpm = ticksPerMeasure(this.score);

    for (let guard = 0; guard < 2000; guard++) {
      const nTick = this.noteIdx < notes.length && notes[this.noteIdx].tick < end ? notes[this.noteIdx].tick : Infinity;
      const bTick = this.nextBeat < end ? this.nextBeat : Infinity;
      const evTick = Math.min(nTick, bTick);
      if (evTick === Infinity) {
        const tEnd = timeOf(end);
        if (tEnd > horizon) return;
        if (this.opt.loop) {
          this.passStart = tEnd;
          this.pass++;
          this.onPass(this.pass);
          this.resetPass(start);
          continue;
        }
        this.finish(tEnd);
        return;
      }
      const t = timeOf(evTick);
      if (t > horizon) return;
      if (bTick <= nTick) {
        if (this.opt.metronome) engine.click(t, (bTick - 0) % tpm === 0);
        this.nextBeat += beatTicks;
      } else {
        const n = notes[this.noteIdx];
        this.onScheduled({ idx: this.noteIdx, pad: n.pad, art: n.art, time: t, pass: this.pass });
        const pad = this.getPad(n.pad);
        if (pad && this.opt.drums !== 'off') {
          const pl = artToPlay(n.art, n.vel);
          const guide = this.opt.drums === 'guide';
          engine.play(pad, guide ? Math.max(1, pl.vel * 0.45) : pl.vel, 'score', pl.zone, { when: t, hat: pl.hat, silentUI: guide });
        }
        this.noteIdx++;
      }
    }
  }

  private finish(at: number) {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const ms = Math.max(0, (at - engine.ctx.currentTime) * 1000) + 250;
    this.endTimer = window.setTimeout(() => {
      this.playing = false;
      this.onEnd();
    }, ms);
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    if (this.endTimer !== null) clearTimeout(this.endTimer);
    this.timer = null;
    this.endTimer = null;
    this.playing = false;
  }

  /** Current position in ticks (for the cursor). Negative during the count-in. */
  currentTick(): number {
    if (!this.score || !this.opt) return 0;
    const { start, end } = this.range();
    const t = start + (engine.ctx.currentTime - this.passStart) / this.spt;
    return Math.min(t, end);
  }
}
