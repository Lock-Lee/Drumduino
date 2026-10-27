// General MIDI percussion map (channel 10) ↔ the app's pads and articulations.
import type { Art, PadId } from './types';

const GM: Record<number, [PadId, Art]> = {
  35: ['kick', 'normal'],
  36: ['kick', 'normal'],
  37: ['snare', 'xstick'],
  38: ['snare', 'normal'],
  39: ['snare', 'rim'], // hand clap → closest
  40: ['snare', 'rim'], // electric snare / rimshot in many maps
  41: ['floor', 'normal'],
  43: ['floor', 'normal'],
  45: ['tom2', 'normal'],
  47: ['tom2', 'normal'],
  48: ['tom1', 'normal'],
  50: ['tom1', 'normal'],
  42: ['hihat', 'normal'],
  44: ['hihat', 'pedal'],
  46: ['hihat', 'open'],
  49: ['crash', 'normal'],
  52: ['crash', 'normal'], // china
  55: ['crash', 'normal'], // splash
  57: ['crash', 'normal'],
  51: ['ride', 'normal'],
  59: ['ride', 'normal'],
  53: ['ride', 'rim'] // bell
};

export function fromGM(note: number): [PadId, Art] | null {
  return GM[note] ?? null;
}

export function toGM(pad: PadId, art: Art): number {
  switch (pad) {
    case 'kick': return 36;
    case 'snare': return art === 'xstick' ? 37 : art === 'rim' ? 40 : 38;
    case 'hihat': return art === 'open' || art === 'half' ? 46 : art === 'pedal' ? 44 : 42;
    case 'tom1': return 48;
    case 'tom2': return 45;
    case 'floor': return 43;
    case 'crash': return 49;
    case 'ride': return art === 'rim' ? 53 : 51;
  }
}
