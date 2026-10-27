// Factory drum kits. Each one only decides the sounds of the 8 standard pads.
import type { PadSound } from './types';

export interface Preset {
  id: string;
  name: string;
  description: string;
  credit: string;
  sounds: Record<string, PadSound>;
}

function s(samples: string[], pitch = 0, volume = 85): PadSound {
  return { samples, mode: 'vel', volume, pitch };
}
/** Virtuosity Drums layers, soft → hard */
const vd = (group: string, n: number, pitch = 0) => s(Array.from({ length: n }, (_, i) => `vd:${group}-${i + 1}`), pitch);
/** AVL Drumkits: 5 velocity layers per piece */
const avl = (slug: string, pitch = 0, volume = 85) => s([1, 2, 3, 4, 5].map((i) => `avl:${slug}-${i}`), pitch, volume);

export const PRESETS: Preset[] = [
  {
    id: 'studio',
    name: 'Studio Maple',
    description: 'กลองอะคูสติกห้องอัด เสียงเปิดกว้าง แรงตีละเอียด',
    credit: 'Virtuosity Drums — Versilian Studios (CC0)',
    sounds: {
      crash: vd('crash', 3),
      tom1: vd('htom', 4),
      tom2: vd('ltom', 4, 1),
      ride: vd('ride', 3),
      hihat: vd('hhclosed', 4),
      snare: vd('snare', 6),
      kick: vd('kick', 4),
      floor: vd('ltom', 4, -4)
    }
  },
  {
    id: 'blackpearl',
    name: 'Black Pearl',
    description: 'Pearl + ฉาบ Sabian — ร็อก/ป๊อป เสียงแน่น สะอาด',
    credit: 'AVL Drumkits “Black Pearl” — Glen MacArthur (CC BY-SA 3.0)',
    sounds: {
      crash: avl('SabianAA16Crash'),
      tom1: avl('Pearl12Tom'),
      tom2: avl('Pearl13Tom2'),
      ride: avl('SabianAAX20Ride'),
      hihat: avl('SabianRockHatClosed'),
      snare: avl('PearlSnare2'),
      kick: avl('Pearl22Kick'),
      floor: avl('Pearl16FloorTom')
    }
  },
  {
    id: 'redzep',
    name: 'Red Zeppelin',
    description: 'Ludwig วินเทจ + ฉาบ Zildjian — กลองใหญ่ เสียงก้องแบบยุค 70',
    credit: 'AVL Drumkits “Red Zeppelin” — Glen MacArthur (CC BY-SA 3.0)',
    sounds: {
      crash: avl('ZildjianA20Crash'),
      tom1: avl('Ludwig14Tom'),
      tom2: avl('Ludwig16FloorTom'),
      ride: avl('ZildjianA24Ride'),
      hihat: avl('SabianRockHatClosed'),
      snare: avl('PorkpieSnare'),
      kick: avl('Ludwig26Kick'),
      floor: avl('Ludwig18FloorTom')
    }
  },
  {
    id: 'synth',
    name: 'Synth Kit',
    description: 'เสียงกลองสังเคราะห์แบบเครื่องตีจังหวะ',
    credit: 'สร้างขึ้นในแอป',
    sounds: {
      crash: s(['bi:crash-soft', 'bi:crash-hard']),
      tom1: s(['bi:tom-high']),
      tom2: s(['bi:tom-mid']),
      ride: s(['bi:ride-bow', 'bi:ride-bell']),
      hihat: s(['bi:hh-closed', 'bi:hh-half', 'bi:hh-open']),
      snare: s(['bi:snare-ghost', 'bi:snare-mid', 'bi:snare-hard']),
      kick: s(['bi:kick-soft', 'bi:kick-hard']),
      floor: s(['bi:tom-floor'])
    }
  }
];

export const SOURCE_LABELS: Record<string, string> = {
  vd: 'Studio Maple',
  avl: 'Black Pearl / Red Zeppelin',
  synth: 'Synth',
  user: 'นำเข้าเอง'
};
