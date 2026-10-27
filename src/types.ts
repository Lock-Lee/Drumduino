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
  mode: PlayMode;
  /** 0–100 */
  volume: number;
  /** semitones, -12..12 */
  pitch: number;
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

export interface Kit {
  name: string;
  master: number;
  pads: Pad[];
}

export type SampleCategory = 'kick' | 'snare' | 'hihat' | 'tom' | 'cym' | 'mine';

export interface SampleMeta {
  id: string;
  name: string;
  category: SampleCategory;
  duration: number;
  builtin: boolean;
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
    };
  }
}

/** sensitivity (1–100) → raw analog threshold (0–1023) sent to the firmware */
export function sensitivityToThreshold(sens: number): number {
  return Math.round(8 + (100 - Math.min(100, Math.max(1, sens))) * 2.4);
}

export const PIN_LABELS = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'];
export const CHANNEL_COUNT = 8;
