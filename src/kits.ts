// Factory drum kits. Each one only decides the sounds of the 8 standard pads.
import type { PadSound } from './types';

export interface Preset {
  id: string;
  name: string;
  description: string;
  credit: string;
  sounds: Record<string, PadSound>;
}

function s(samples: string[], pitch = 0, volume = 85, rimSamples: string[] = []): PadSound {
  return { samples, rimSamples, mode: 'vel', volume, pitch };
}
/** add rim-zone sounds to a pad sound */
const rim = (snd: PadSound, rimSamples: string[]): PadSound => ({ ...snd, rimSamples });
const vdIds = (group: string, n: number) => Array.from({ length: n }, (_, i) => `vd:${group}-${i + 1}`);
const avlIds = (slug: string) => [1, 2, 3, 4, 5].map((i) => `avl:${slug}-${i}`);
/** Virtuosity Drums layers, soft → hard */
const vd = (group: string, n: number, pitch = 0) => s(vdIds(group, n), pitch);
/** AVL Drumkits: 5 velocity layers per piece */
const avl = (slug: string, pitch = 0, volume = 85) => s(avlIds(slug), pitch, volume);

const AVL_XSTICK = ['avl:Sidestick2-3', 'avl:Sidestick2-5'];
const VD_RIMSHOT = ['vd:rimshot-3', 'vd:rimshot-4', 'vd:rimshot-5', 'vd:rimshot-6'];

export const PRESETS: Preset[] = [
  {
    id: 'studio',
    name: 'Studio Maple',
    description: 'กลองอะคูสติกห้องอัด เสียงเปิดกว้าง แรงตีละเอียด',
    credit: 'Virtuosity Drums — Versilian Studios (CC0)',
    sounds: {
      crash: vd('crash', 3),
      tom1: vd('htom', 4),
      tom2: rim(vd('ltom', 4, 1), vdIds('ltomrim', 3)),
      ride: rim(vd('ride', 3), vdIds('bell', 3)),
      hihat: rim(vd('hhclosed', 4), vdIds('hhopen', 2)),
      // soft rim = cross-stick, harder = rimshot (like a V-Drums snare)
      snare: rim(vd('snare', 6), ['vd:xstick-2', 'vd:xstick-3', 'vd:rimshot-3', 'vd:rimshot-4', 'vd:rimshot-5', 'vd:rimshot-6']),
      kick: vd('kick', 4),
      floor: rim(vd('ltom', 4, -4), vdIds('ltomrim', 3))
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
      ride: rim(avl('SabianAAX20Ride'), avlIds('SabianAAX20RideBell')),
      hihat: rim(avl('SabianRockHatClosed'), avlIds('SabianRockHatSemiOpen')),
      // AVL has no rimshot: soft rim = its side stick, harder = Virtuosity rimshot
      snare: rim(avl('PearlSnare2'), [...AVL_XSTICK, ...VD_RIMSHOT]),
      kick: avl('Pearl22Kick'),
      floor: rim(avl('Pearl16FloorTom'), avlIds('Pearl16FloorTomEdge'))
    }
  },
  {
    id: 'redzep',
    name: 'Red Zeppelin',
    description: 'Ludwig วินเทจ + ฉาบ Zildjian — กลองใหญ่ เสียงก้องแบบยุค 70',
    credit: 'AVL Drumkits “Red Zeppelin” — Glen MacArthur (CC BY-SA 3.0)',
    sounds: {
      crash: avl('ZildjianA20Crash'),
      tom1: rim(avl('Ludwig14Tom'), avlIds('Ludwig14TomEdge')),
      tom2: avl('Ludwig16FloorTom'),
      ride: rim(avl('ZildjianA24Ride'), avlIds('ZildjianA24RideBell')),
      hihat: rim(avl('SabianRockHatClosed'), avlIds('SabianRockHatSemiOpen')),
      snare: rim(avl('PorkpieSnare'), [...AVL_XSTICK, ...VD_RIMSHOT]),
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
      ride: s(['bi:ride-bow'], 0, 85, ['bi:ride-bell']),
      hihat: s(['bi:hh-closed', 'bi:hh-half'], 0, 85, ['bi:hh-open']),
      snare: s(['bi:snare-ghost', 'bi:snare-mid', 'bi:snare-hard'], 0, 85, ['bi:snare-rim']),
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
