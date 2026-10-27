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
  return { samples, rimSamples, halfSamples: [], openSamples: [], chickSamples: [], mode: 'vel', volume, pitch };
}
/** hi-hat: closed (stick) + half-open + open + pedal chick */
const hat = (closed: string[], half: string[], open: string[], chick: string[]): PadSound => ({
  ...s(closed),
  halfSamples: half,
  openSamples: open,
  chickSamples: chick
});
/** add rim-zone sounds to a pad sound */
const rim = (snd: PadSound, rimSamples: string[]): PadSound => ({ ...snd, rimSamples });
const vdIds = (group: string, n: number) => Array.from({ length: n }, (_, i) => `vd:${group}-${i + 1}`);
const avlIds = (slug: string) => [1, 2, 3, 4, 5].map((i) => `avl:${slug}-${i}`);
/** Virtuosity Drums layers, soft → hard */
const vd = (group: string, n: number, pitch = 0) => s(vdIds(group, n), pitch);
/** AVL Drumkits: 5 velocity layers per piece */
const avl = (slug: string, pitch = 0, volume = 85) => s(avlIds(slug), pitch, volume);

/** tone shaping (dB) */
const eq = (snd: PadSound, low: number, mid: number, high: number): PadSound => ({ ...snd, tone: { low, mid, high } });

const AVL_XSTICK = ['avl:Sidestick2-3', 'avl:Sidestick2-5'];
const VD_RIMSHOT = ['vd:rimshot-3', 'vd:rimshot-4', 'vd:rimshot-5', 'vd:rimshot-6'];

export const PRESETS: Preset[] = [
  {
    id: 'studio',
    name: 'Studio Maple',
    description: 'กลองอะคูสติกที่บันทึกในห้องอัด เสียงกว้าง ตอบสนองแรงตีได้ละเอียด',
    credit: 'Virtuosity Drums — Versilian Studios (CC0)',
    sounds: {
      crash: vd('crash', 3),
      tom1: vd('htom', 4),
      tom2: rim(vd('ltom', 4, 1), vdIds('ltomrim', 3)),
      ride: rim(vd('ride', 3), vdIds('bell', 3)),
      hihat: hat(vdIds('hhclosed', 4), vdIds('hhhalf', 4), vdIds('hhopen', 4), vdIds('hhpedal', 3)),
      // soft rim = cross-stick, harder = rimshot (like a V-Drums snare)
      snare: rim(vd('snare', 6), ['vd:xstick-2', 'vd:xstick-3', 'vd:rimshot-3', 'vd:rimshot-4', 'vd:rimshot-5', 'vd:rimshot-6']),
      kick: vd('kick', 4),
      floor: rim(vd('ltom', 4, -4), vdIds('ltomrim', 3))
    }
  },
  {
    id: 'blackpearl',
    name: 'Black Pearl',
    description: 'กลอง Pearl กับฉาบ Sabian เสียงแน่นและสะอาด เหมาะกับเพลงร็อกและป๊อป',
    credit: 'AVL Drumkits “Black Pearl” — Glen MacArthur (CC BY-SA 3.0)',
    sounds: {
      crash: avl('SabianAA16Crash'),
      tom1: avl('Pearl12Tom'),
      tom2: avl('Pearl13Tom2'),
      ride: rim(avl('SabianAAX20Ride'), avlIds('SabianAAX20RideBell')),
      hihat: hat(avlIds('SabianRockHatClosed'), avlIds('SabianRockHatSemiOpen'), avlIds('SabianRockHatSwish'), avlIds('SabianRockHatPedal')),
      // AVL has no rimshot: soft rim = its side stick, harder = Virtuosity rimshot
      snare: rim(avl('PearlSnare2'), [...AVL_XSTICK, ...VD_RIMSHOT]),
      kick: avl('Pearl22Kick'),
      floor: rim(avl('Pearl16FloorTom'), avlIds('Pearl16FloorTomEdge'))
    }
  },
  {
    id: 'redzep',
    name: 'Red Zeppelin',
    description: 'กลอง Ludwig รุ่นเก่ากับฉาบ Zildjian กลองใบใหญ่ เสียงก้องแบบยุค 70',
    credit: 'AVL Drumkits “Red Zeppelin” — Glen MacArthur (CC BY-SA 3.0)',
    sounds: {
      crash: avl('ZildjianA20Crash'),
      tom1: rim(avl('Ludwig14Tom'), avlIds('Ludwig14TomEdge')),
      tom2: avl('Ludwig16FloorTom'),
      ride: rim(avl('ZildjianA24Ride'), avlIds('ZildjianA24RideBell')),
      hihat: hat(avlIds('SabianRockHatClosed'), avlIds('SabianRockHatSemiOpen'), avlIds('SabianRockHatSwish'), avlIds('SabianRockHatPedal')),
      snare: rim(avl('PorkpieSnare'), [...AVL_XSTICK, ...VD_RIMSHOT]),
      kick: avl('Ludwig26Kick'),
      floor: avl('Ludwig18FloorTom')
    }
  },
  {
    id: 'arena',
    name: 'Arena Metal',
    description: 'กลองเมทัลคอร์สมัยใหม่ กระเดื่องมีหัวเสียงคลิกชัด สแนร์แน่นและแตก ทอมเสียงต่ำ ใช้ฉาบ Zildjian',
    credit: 'AVL Drumkits — Glen MacArthur (CC BY-SA 3.0) + Virtuosity Drums (CC0), แต่งเสียงในแอป',
    sounds: {
      crash: eq(avl('ZildjianA20Crash', 0, 80), -2, -2, 2),
      tom1: eq(avl('Pearl12Tom', -1, 90), 4, -5, 4),
      tom2: eq(avl('Pearl16FloorTom', 2, 90), 4, -5, 4),
      ride: eq(rim(avl('ZildjianA24Ride', 1, 78), avlIds('ZildjianA24RideBell')), -2, 0, 1),
      hihat: eq(hat(avlIds('SabianRockHatClosed'), avlIds('SabianRockHatSemiOpen'), avlIds('SabianRockHatSwish'), avlIds('SabianRockHatPedal')), -3, 0, 1),
      snare: eq(rim(vd('snare', 6), ['vd:xstick-2', 'vd:xstick-3', ...VD_RIMSHOT]), 3, -3, 5),
      kick: eq(avl('Pearl22Kick', 0, 95), 5, -7, 8),
      floor: eq(avl('Ludwig18FloorTom', 0, 90), 4, -5, 3)
    }
  },
  {
    id: 'synth',
    name: 'Synth Kit',
    description: 'เสียงกลองสังเคราะห์ คล้ายเครื่องตีจังหวะ',
    credit: 'สร้างโดยแอป',
    sounds: {
      crash: s(['bi:crash-soft', 'bi:crash-hard']),
      tom1: s(['bi:tom-high']),
      tom2: s(['bi:tom-mid']),
      ride: s(['bi:ride-bow'], 0, 85, ['bi:ride-bell']),
      hihat: hat(['bi:hh-closed'], ['bi:hh-half'], ['bi:hh-open'], ['bi:hh-closed']),
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
