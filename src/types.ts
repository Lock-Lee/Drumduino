export type PlayMode = 'vel' | 'rr' | 'rand';

export interface Pad {
  id: string;
  name: string;
  th: string;
  /** Arduino input channel, 0-based (0 = A0). -1 = not connected */
  channel: number;
  /** Position on the kit stage, in % of stage width/height */
  x: number;
  y: number;
  /** Diameter in % of stage width */
  w: number;
  cymbal: boolean;
  /** Sample ids, in order (velocity layers go soft → hard) */
  samples: string[];
  /** Rim zone sounds (dual-zone pads), same ordering rules */
  rimSamples: string[];
  /** Arduino input of the rim piezo, -1 = single-zone pad */
  rimChannel: number;
  /** rim if rimPeak ≥ headPeak × rimRatio / 100 */
  rimRatio: number;
  /** MIDI note for rim hits (MIDI mode) */
  rimNote: number;
  /** Hi-hat: sounds by pedal position (closed = samples) */
  halfSamples: string[];
  openSamples: string[];
  /** Hi-hat: pedal closed without hitting ("chick") */
  chickSamples: string[];
  /** Hi-hat pedal input (continuous sensor), -1 = none */
  pedalChannel: number;
  /** raw sensor value with the pedal fully pressed (closed) / fully released (open) */
  pedalClosed: number;
  pedalOpen: number;
  mode: PlayMode;
  /** 0–100 */
  volume: number;
  /** semitones, -12..12 */
  pitch: number;
  /** tone shaping in dB (-12..12): low = body/boom, mid = boxiness, high = attack/click */
  tone?: Tone;
  /** 1–100, higher = softer hits still trigger */
  sensitivity: number;
  /** ms the firmware looks for the peak after a hit starts */
  scan: number;
  /** ms the firmware ignores re-triggers after a hit */
  mask: number;
  /** MIDI note used when input mode is MIDI */
  midiNote: number;
  /** keyboard key for testing without hardware */
  key: string;
}

/** What a drum kit (sound set) decides for a pad. Layout and Arduino settings are shared by all kits. */
export type SampleField = 'samples' | 'rimSamples' | 'halfSamples' | 'openSamples' | 'chickSamples';
export interface Tone { low: number; mid: number; high: number }
export type SoundField = SampleField | 'mode' | 'volume' | 'pitch' | 'tone';
export type PadSound = Pick<Pad, SoundField>;
export const SAMPLE_FIELDS: SampleField[] = ['samples', 'rimSamples', 'halfSamples', 'openSamples', 'chickSamples'];
export const SOUND_FIELDS: SoundField[] = [...SAMPLE_FIELDS, 'mode', 'volume', 'pitch', 'tone'];

export interface KitSounds {
  id: string;
  name: string;
  /** factory preset this kit came from (null = user copy) */
  presetId: string | null;
  sounds: Record<string, PadSound>;
}

/** The current kit as the UI sees it: shared pads merged with the kit's sounds. */
export interface Kit {
  id: string;
  name: string;
  presetId: string | null;
  master: number;
  pads: Pad[];
}

export type SampleSource = 'vd' | 'avl' | 'sal' | 'synth' | 'user';

export type SampleCategory = 'kick' | 'snare' | 'hihat' | 'tom' | 'cym' | 'mine';

export interface SampleMeta {
  id: string;
  name: string;
  category: SampleCategory;
  duration: number;
  builtin: boolean;
  source: SampleSource;
}

export type InputMode = 'serial' | 'midi';

export interface PortInfo {
  portId: string;
  name: string;
  portName: string;
  vendorId: string;
  likelyArduino: boolean;
}

declare global {
  interface Window {
    drumduino?: {
      isElectron: boolean;
      platform: string;
      onSerialPorts(cb: (ports: PortInfo[]) => void): () => void;
      chooseSerialPort(portId: string): Promise<boolean>;
      listMyScores?(): Promise<{ name: string; key: string; data: string }[]>;
      openScoresFolder?(): Promise<string>;
    };
  }
}

/** sensitivity (1–100) → raw analog threshold (0–1023) sent to the firmware */
export function sensitivityToThreshold(sens: number): number {
  return Math.round(8 + (100 - Math.min(100, Math.max(1, sens))) * 2.4);
}

export const CHANNEL_COUNT = 16; // Arduino Mega: A0–A15
export const PIN_LABELS = Array.from({ length: CHANNEL_COUNT }, (_, i) => 'A' + i);

/** head/rim = stick hits; pedal = hi-hat foot chick */
export type Zone = 'head' | 'rim' | 'pedal';

/** pedal openness thresholds (0 = closed … 1 = fully open) */
export const HH_HALF = 0.18;
export const HH_OPEN = 0.6;
