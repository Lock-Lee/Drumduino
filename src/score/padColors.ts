import type { PadId } from './types';

/** One colour per instrument, shared by the lane view and the neon 3-D kit. */
export const PAD_COLOR: Record<PadId, string> = {
  crash: '#E8833A',
  hihat: '#E9B949',
  ride: '#B46BDB',
  tom1: '#3CC8A4',
  tom2: '#2FB0D0',
  floor: '#7076E8',
  snare: '#4C8DF6',
  kick: '#F0597A'
};

/** top → bottom order of the lanes (cymbals up, kick at the bottom, like on a staff) */
export const LANE_ORDER: PadId[] = ['crash', 'ride', 'hihat', 'tom1', 'tom2', 'floor', 'snare', 'kick'];
