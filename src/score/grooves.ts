// Built-in practice grooves (original patterns written for this app).
//
// Grid notation: one string per pad, one character per slot, bars separated by "|".
//   -  rest            x  hit        X  accent      g  ghost note
//   o  open hi-hat     h  half-open  p  hi-hat foot chick
//   r  rimshot / ride bell           c  cross-stick
// res = slots per beat (4 = 16ths in 4/4, 3 = 8th-note triplets, 2 = 16ths in 6/8)
import type { Art, PadId, Score, ScoreNote, Section } from './types';
import { PPQ, sortNotes } from './types';

type Rows = Partial<Record<PadId, string>>;

interface Part {
  name?: string;
  rows: Rows;
  /** play this part n times */
  times?: number;
}

const CHAR: Record<string, { art: Art; vel: number }> = {
  x: { art: 'normal', vel: 96 },
  X: { art: 'normal', vel: 122 },
  g: { art: 'normal', vel: 38 },
  o: { art: 'open', vel: 100 },
  h: { art: 'half', vel: 96 },
  p: { art: 'pedal', vel: 90 },
  r: { art: 'rim', vel: 112 },
  c: { art: 'xstick', vel: 70 }
};

function build(id: string, title: string, subtitle: string, bpm: number, sig: [number, number], res: number, parts: Part[]): Score {
  const slot = (PPQ * 4) / sig[1] / res;
  const slotsPerBar = sig[0] * res;
  const notes: ScoreNote[] = [];
  const sections: Section[] = [];
  let bar = 0;
  for (const part of parts) {
    const barsInPart = Math.max(...Object.values(part.rows).map((r) => (r ?? '').split('|').length));
    for (let t = 0; t < (part.times ?? 1); t++) {
      if (part.name && t === 0) sections.push({ name: part.name, measure: bar });
      for (const [pad, row] of Object.entries(part.rows) as [PadId, string][]) {
        row.split('|').forEach((barStr, b) => {
          const s = barStr.replace(/\s/g, '');
          for (let i = 0; i < Math.min(s.length, slotsPerBar); i++) {
            const c = CHAR[s[i]];
            if (c) notes.push({ tick: (bar + b) * slotsPerBar * slot + i * slot, pad, art: c.art, vel: c.vel });
          }
        });
      }
      bar += barsInPart;
    }
  }
  return { id, title, subtitle, bpm, sig, measures: bar, notes: sortNotes(notes), sections: sections.length ? sections : undefined };
}

const ROCK: Rows = {
  hihat: 'x-x-x-x-x-x-x-x-',
  snare: '----X-------X---',
  kick: 'x-------x-x-----'
};

const ROCK_FILL: Rows = {
  hihat: 'x-x-x-x-x-x-x-x-|x-x-x-x---------',
  snare: '----X-------X---|----X---xxxx----',
  tom1: '                |            xx--',
  floor: '                |              xx',
  kick: 'x-------x-x-----|x-------x-------'
};

export const GROOVES: Score[] = [
  build('rock8', 'ร็อก 8 บีต', 'จังหวะพื้นฐาน · ไฮแฮทเขบ็ต 1 ชั้น', 96, [4, 4], 4, [{ rows: ROCK, times: 4 }]),

  build('rock-crash', 'ร็อก + แครช + ไฮแฮทเปิด', 'เปิดไฮแฮทก่อนลงห้องใหม่', 104, [4, 4], 4, [
    {
      rows: {
        crash: 'X---------------|----------------',
        hihat: '--x-x-x-x-x-x-o-|x-x-x-x-x-x-x-o-',
        snare: '----X-------X---|----X-------X---',
        kick: 'x-----x-x-x-----|x-----x-x-x-----'
      },
      times: 2
    }
  ]),

  build('pop16', 'ป๊อป 16', 'ไฮแฮทเขบ็ต 2 ชั้น เน้นตัวแรกของจังหวะ', 92, [4, 4], 4, [
    { rows: { hihat: 'XxxxXxxxXxxxXxxx', snare: '----X-------X---', kick: 'x-----x-x-----x-' }, times: 4 }
  ]),

  build('funk', 'ฟังก์ + ghost note', 'สแนร์ตีเบาแทรก (ghost)', 94, [4, 4], 4, [
    { rows: { hihat: 'x-x-x-x-x-x-x-x-', snare: '----X--g-g--X--g', kick: 'x-x-------x--x--' }, times: 4 }
  ]),

  build('disco', 'ดิสโก้ / Four on the floor', 'กระเดื่องทุกจังหวะ ไฮแฮทเปิดตัวหลัง', 120, [4, 4], 4, [
    { rows: { hihat: 'x-o-x-o-x-o-x-o-', snare: '----X-------X---', kick: 'x---x---x---x---' }, times: 4 }
  ]),

  build('halftime', 'ฮาล์ฟไทม์', 'สแนร์ลงจังหวะ 3', 140, [4, 4], 4, [
    { rows: { hihat: 'x-x-x-x-x-x-x-x-', snare: '--------X-------', kick: 'x-----x---x-----' }, times: 4 }
  ]),

  build('shuffle', 'ชัฟเฟิล', 'จังหวะ triplet แบบบลูส์', 88, [4, 4], 3, [
    { rows: { hihat: 'x-xx-xx-xx-x', snare: '---X-----X--', kick: 'x-----x--x--' }, times: 4 }
  ]),

  build('swing', 'สวิงบนไรด์', 'ไรด์แบบแจ๊ส + เหยียบไฮแฮทจังหวะ 2 กับ 4', 120, [4, 4], 3, [
    { rows: { ride: 'x--x-xx--x-x', hihat: '---p-----p--', kick: 'g-----g-----' }, times: 4 }
  ]),

  build('bossa', 'บอสซาโนวา', 'cross-stick บนสแนร์ 2 ห้องวน', 130, [4, 4], 4, [
    {
      rows: {
        hihat: 'x-x-x-x-x-x-x-x-|x-x-x-x-x-x-x-x-',
        snare: 'c--c--c---c--c--|--c--c---c--c---',
        kick: 'x--xx--xx--xx--x|x--xx--xx--xx--x'
      },
      times: 2
    }
  ]),

  build('ballad68', 'บัลลาด 6/8', 'นับ 1-2-3-4-5-6 สแนร์ลงตัวที่ 4', 66, [6, 8], 2, [
    { rows: { hihat: 'x-x-x-x-x-x-', snare: '------X-----', kick: 'x---------x-' }, times: 4 }
  ]),

  build('fill-toms', 'ลูกส่งทอม', 'ห้องที่ 2 ไล่สแนร์ → ทอม → ฟลอร์', 90, [4, 4], 4, [
    { rows: { hihat: 'x-x-x-x-x-x-x-x-|----------------', snare: '----X-------X---|xxxx------------', tom1: '                |----xxxx--------', tom2: '                |--------xx------', floor: '                |----------xxxxxx', kick: 'x-------x-x-----|x---x---x---x---' } },
    { rows: { crash: 'X', kick: 'x' } }
  ]),

  build('song', 'เพลงฝึก: Rock Anthem', 'มีท่อน Intro / Verse / Chorus / Outro', 100, [4, 4], 4, [
    { name: 'Intro', rows: { crash: 'X---X---X---X---', kick: 'x---x---x---x---' }, times: 2 },
    { name: 'Verse', rows: ROCK, times: 3 },
    { rows: ROCK_FILL },
    {
      name: 'Chorus',
      rows: {
        crash: 'X---------------|----------------|----------------|----------------',
        ride: '--x-x-x-x-x-x-x-|x-x-x-x-x-x-x-x-|x-x-x-x-x-x-x-x-|x-x-x-x-x-x-x-x-',
        snare: '----X-------X---|----X-------X---|----X-------X---|----X---XXXX----',
        tom1: '                |                |                |            XX--',
        floor: '                |                |                |              XX',
        kick: 'x-----x-x-x-----|x-----x-x-x-----|x-----x-x-x-----|x-------x-------'
      },
      times: 2
    },
    { name: 'Outro', rows: { crash: 'X---------------|X---------------', snare: '----X-------X---|----------------', kick: 'x-------x-x-----|x---------------' } }
  ]),

  // ---- modern rock / metalcore style (original patterns) ----
  build('fourfloor-rock', 'ร็อกกระเดื่องสี่', 'กระเดื่องทุกจังหวะ แบบอัลเทอร์เนทีฟร็อก', 144, [4, 4], 4, [
    { rows: { crash: 'X---------------|----------------', hihat: '--x-x-x-x-x-x-x-|x-x-x-x-x-x-x-o-', snare: '----X-------X---|----X-------X---', kick: 'x---x---x---x---|x---x---x---x---' }, times: 2 }
  ]),
  build('halftime-breakdown', 'เบรกดาวน์ฮาล์ฟไทม์', 'แครชทุก 2 จังหวะ กระเดื่องกระชาก', 144, [4, 4], 4, [
    { rows: { crash: 'X-------X-------', snare: '--------X-------', kick: 'x-x-xx----x-xx--' }, times: 4 }
  ]),
  build('double-kick', 'ดับเบิลกระเดื่อง 16', 'กระเดื่องเขบ็ต 2 ชั้นต่อเนื่อง (เริ่มช้าๆ)', 110, [4, 4], 4, [
    { rows: { ride: 'x-x-x-x-x-x-x-x-', snare: '----X-------X---', kick: 'xxxxxxxxxxxxxxxx' }, times: 4 }
  ]),
  build('skank', 'พังก์ / สแกงก์บีต', 'สแนร์ตัวหลังทุกจังหวะ เร็วและแน่น', 170, [4, 4], 4, [
    { rows: { hihat: 'x-x-x-x-x-x-x-x-', snare: '--X---X---X---X-', kick: 'x---x---x---x---' }, times: 4 }
  ]),

  build('song-metalcore', 'เพลงฝึก: Arena Metalcore', 'ท่อน Intro / Verse / Pre / Chorus / Breakdown · 144 BPM', 144, [4, 4], 4, [
    { name: 'Intro', rows: { floor: 'x-x-x-x-x-x-x-x-|x-x-x-x---------', tom2: '                |--------xx--xx--', tom1: '                |----------xx--xx', kick: 'x---x---x---x---|x---x---x---x---' } },
    {
      name: 'Verse',
      rows: {
        crash: 'X---------------|----------------',
        hihat: '--x-x-x-x-x-x-x-|x-x-x-x-x-x-x-o-',
        snare: '----X--g----X---|----X--g----X--g',
        kick: 'x-----x-x-----x-|x-----x-x--x----'
      },
      times: 2
    },
    {
      name: 'Pre-chorus',
      rows: {
        hihat: '--o---o---o---o-|--o---o---o-----',
        snare: '----X-------X---|----X---XXXXXXXX',
        kick: 'x---x---x---x---|x---x---x-------'
      }
    },
    {
      name: 'Chorus',
      rows: {
        crash: 'X---------------|X---------------|X---------------|X---------------',
        ride: '--x-x-x-x-x-x-x-|--x-x-x-x-x-x-x-|--x-x-x-x-x-x-x-|--x-x-x-x-------',
        snare: '----X-------X---|----X-------X---|----X-------X---|----X---XX--XX--',
        floor: '                |                |                |----------xx--xx',
        kick: 'x--x--x-x--x----|x--x--x-x--x----|x--x--x-x--x----|x--x--x---------'
      },
      times: 2
    },
    {
      name: 'Breakdown',
      rows: { crash: 'X-------X-------|X-------X---X---', snare: '--------X-------|--------X-------', kick: 'x-x-xx----x-xx--|x-x-xx----xxxxxx' },
      times: 2
    },
    { name: 'Outro', rows: { crash: 'X---------------|X---X---X---X---|X---------------', snare: '----X-------X---|X---X---X---X---|----------------', kick: 'x-----x-x-------|x---x---x---x---|x---------------' } }
  ]),
];
