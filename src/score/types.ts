// A drum score in the app's own format. Times are in ticks, PPQ ticks per quarter note.

export const PPQ = 480;

/** Pads a score can address (ids of the default kit). */
export type PadId = 'kick' | 'snare' | 'hihat' | 'tom1' | 'tom2' | 'floor' | 'crash' | 'ride';

/**
 * How the note is played.
 *  normal   – plain hit
 *  rim      – rimshot (snare/toms) · bell (ride)
 *  xstick   – cross-stick (snare)
 *  open     – open hi-hat · half = half-open hi-hat
 *  pedal    – hi-hat foot chick
 */
export type Art = 'normal' | 'rim' | 'xstick' | 'open' | 'half' | 'pedal';

export interface ScoreNote {
  tick: number;
  pad: PadId;
  art: Art;
  /** 1–127 */
  vel: number;
}

export interface Section {
  name: string;
  /** first measure (0-based) */
  measure: number;
}

export interface Score {
  id: string;
  title: string;
  /** shown under the title (style, source) */
  subtitle?: string;
  bpm: number;
  /** beats per bar and beat unit, e.g. [4, 4] */
  sig: [number, number];
  measures: number;
  notes: ScoreNote[];
  sections?: Section[];
  /** user-imported (stored locally) vs built-in */
  imported?: boolean;
}

export function ticksPerMeasure(s: Pick<Score, 'sig'>): number {
  return (PPQ * 4 * s.sig[0]) / s.sig[1];
}

export function sortNotes(notes: ScoreNote[]): ScoreNote[] {
  return notes.slice().sort((a, b) => a.tick - b.tick);
}

export const PAD_LABEL: Record<PadId, string> = {
  kick: 'กระเดื่อง',
  snare: 'สแนร์',
  hihat: 'ไฮแฮท',
  tom1: 'ทอม 1',
  tom2: 'ทอม 2',
  floor: 'ฟลอร์ทอม',
  crash: 'แครช',
  ride: 'ไรด์'
};
