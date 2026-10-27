// Import drum scores from Standard MIDI Files and (uncompressed) MusicXML.
import { fromGM } from './gm';
import type { Art, PadId, Score, ScoreNote } from './types';
import { PPQ, sortNotes, ticksPerMeasure } from './types';

function finish(title: string, bpm: number, sig: [number, number], notes: ScoreNote[]): Score {
  if (!notes.length) throw new Error('ไม่พบโน้ตกลองในไฟล์นี้');
  const sorted = sortNotes(notes);
  const tpm = ticksPerMeasure({ sig });
  // drop leading empty bars beyond one (pickup-friendly)
  const measures = Math.max(1, Math.ceil((sorted[sorted.length - 1].tick + 1) / tpm));
  return {
    id: 'imp-' + Date.now().toString(36),
    title,
    subtitle: 'นำเข้าเอง',
    bpm: Math.round(bpm),
    sig,
    measures,
    notes: sorted,
    imported: true
  };
}

/* ---------------- MIDI ---------------- */

export function parseMidi(buf: ArrayBuffer, fileName = 'MIDI'): Score {
  const d = new DataView(buf);
  let p = 0;
  const str = (n: number) => {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(p + i));
    p += n;
    return s;
  };
  const u32 = () => { const v = d.getUint32(p); p += 4; return v; };
  const u16 = () => { const v = d.getUint16(p); p += 2; return v; };
  const vlq = () => {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = d.getUint8(p++);
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return v;
  };

  if (str(4) !== 'MThd') throw new Error('ไม่ใช่ไฟล์ MIDI');
  const hlen = u32();
  u16(); // format
  const ntrks = u16();
  const division = u16();
  p = 8 + hlen;
  if (division & 0x8000) throw new Error('ไฟล์ MIDI แบบ SMPTE ยังไม่รองรับ');
  const scale = PPQ / division;

  let bpm = 0;
  let sig: [number, number] | null = null;
  let title = '';
  const raw: { tick: number; ch: number; note: number; vel: number }[] = [];

  for (let t = 0; t < ntrks && p < d.byteLength; t++) {
    if (str(4) !== 'MTrk') break;
    const len = u32();
    const end = p + len;
    let tick = 0;
    let status = 0;
    while (p < end) {
      tick += vlq();
      let b = d.getUint8(p);
      if (b & 0x80) { status = b; p++; } else b = status; // running status
      const type = status & 0xf0;
      if (status === 0xff) {
        const mt = d.getUint8(p++);
        const ml = vlq();
        if (mt === 0x51 && !bpm) bpm = 60000000 / ((d.getUint8(p) << 16) | (d.getUint8(p + 1) << 8) | d.getUint8(p + 2));
        else if (mt === 0x58 && !sig) sig = [d.getUint8(p), Math.pow(2, d.getUint8(p + 1))];
        else if (mt === 0x03 && !title) { const s0 = p; title = str(ml).trim(); p = s0; }
        p += ml;
      } else if (status === 0xf0 || status === 0xf7) {
        p += vlq();
      } else if (type === 0x90 || type === 0x80 || type === 0xa0 || type === 0xb0 || type === 0xe0) {
        const a = d.getUint8(p++);
        const v = d.getUint8(p++);
        if (type === 0x90 && v > 0) raw.push({ tick: Math.round(tick * scale), ch: status & 0x0f, note: a, vel: v });
      } else if (type === 0xc0 || type === 0xd0) {
        p += 1;
      } else {
        p++; // unknown, skip a byte
      }
    }
    p = end;
  }

  const drums = raw.some((r) => r.ch === 9) ? raw.filter((r) => r.ch === 9) : raw;
  const notes: ScoreNote[] = [];
  for (const r of drums) {
    const m = fromGM(r.note);
    if (m) notes.push({ tick: r.tick, pad: m[0], art: m[1], vel: r.vel });
  }
  return finish(title || fileName.replace(/\.(mid|midi)$/i, ''), bpm || 120, sig ?? [4, 4], notes);
}

/* ---------------- MusicXML ---------------- */

// Fallback when a note has no <instrument>: common drum-set staff positions.
function byPosition(step: string, octave: number, head: string): [PadId, Art] | null {
  const k = step + octave;
  const x = head === 'x' || head === 'cross' || head === 'circle-x';
  const map: Record<string, [PadId, Art]> = x
    ? { G5: ['hihat', 'normal'], A5: ['crash', 'normal'], F5: ['ride', 'normal'], D4: ['hihat', 'pedal'], C5: ['snare', 'xstick'], E5: ['ride', 'normal'] }
    : { F4: ['kick', 'normal'], E4: ['kick', 'normal'], C5: ['snare', 'normal'], E5: ['tom1', 'normal'], D5: ['tom2', 'normal'], A4: ['floor', 'normal'], G4: ['floor', 'normal'] };
  return map[k] ?? null;
}

function guessFromName(name: string): [PadId, Art] | null {
  const n = name.toLowerCase();
  if (/kick|bass drum/.test(n)) return ['kick', 'normal'];
  if (/side ?stick|cross/.test(n)) return ['snare', 'xstick'];
  if (/rim/.test(n)) return ['snare', 'rim'];
  if (/snare/.test(n)) return ['snare', 'normal'];
  if (/pedal hi|hi-?hat pedal|foot/.test(n)) return ['hihat', 'pedal'];
  if (/open hi|hi-?hat open/.test(n)) return ['hihat', 'open'];
  if (/hi-?hat/.test(n)) return ['hihat', 'normal'];
  if (/bell/.test(n)) return ['ride', 'rim'];
  if (/ride/.test(n)) return ['ride', 'normal'];
  if (/crash|china|splash|cymbal/.test(n)) return ['crash', 'normal'];
  if (/floor/.test(n)) return ['floor', 'normal'];
  if (/high tom|hi tom|tom 1|tom1/.test(n)) return ['tom1', 'normal'];
  if (/tom/.test(n)) return ['tom2', 'normal'];
  return null;
}

export function parseMusicXml(text: string, fileName = 'MusicXML'): Score {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('อ่านไฟล์ MusicXML ไม่ได้');
  if (doc.documentElement.nodeName === 'score-timewise') throw new Error('MusicXML แบบ timewise ยังไม่รองรับ — export แบบ partwise');

  const txt = (el: Element | null | undefined, sel: string) => el?.querySelector(sel)?.textContent?.trim() ?? '';
  const title = txt(doc.documentElement, 'work > work-title') || txt(doc.documentElement, 'movement-title') || fileName.replace(/\.(musicxml|xml)$/i, '');

  // instrument id → pad/art (from <midi-unpitched>, else its name)
  const inst = new Map<string, [PadId, Art]>();
  doc.querySelectorAll('part-list score-part').forEach((sp) => {
    sp.querySelectorAll('score-instrument').forEach((si) => {
      const id = si.getAttribute('id') ?? '';
      const mi = sp.querySelector(`midi-instrument[id="${id}"]`);
      const unp = parseInt(mi?.querySelector('midi-unpitched')?.textContent ?? '', 10);
      const m = (Number.isFinite(unp) ? fromGM(unp - 1) : null) ?? guessFromName(txt(si, 'instrument-name'));
      if (m) inst.set(id, m);
    });
  });

  // pick the first part that has unpitched notes
  const parts = Array.from(doc.querySelectorAll('part'));
  const part = parts.find((pt) => pt.querySelector('unpitched')) ?? parts[0];
  if (!part) throw new Error('ไม่พบโน้ตในไฟล์');

  let divisions = 1;
  let sig: [number, number] | null = null;
  let bpm = 0;
  let measureStart = 0; // ticks
  const notes: ScoreNote[] = [];

  for (const meas of Array.from(part.querySelectorAll(':scope > measure'))) {
    let pos = 0; // divisions within measure
    let lastStart = 0;
    let maxPos = 0;
    let curSig = sig ?? [4, 4];
    for (const el of Array.from(meas.children)) {
      switch (el.nodeName) {
        case 'attributes': {
          const dv = parseInt(txt(el, 'divisions'), 10);
          if (dv) divisions = dv;
          const beats = parseInt(txt(el, 'time > beats'), 10);
          const bt = parseInt(txt(el, 'time > beat-type'), 10);
          if (beats && bt) {
            curSig = [beats, bt];
            if (!sig) sig = [beats, bt];
          }
          break;
        }
        case 'direction': {
          const t = parseFloat(el.querySelector('sound')?.getAttribute('tempo') ?? '') || parseFloat(txt(el, 'metronome > per-minute'));
          if (t && !bpm) bpm = t;
          break;
        }
        case 'sound': {
          const t = parseFloat(el.getAttribute('tempo') ?? '');
          if (t && !bpm) bpm = t;
          break;
        }
        case 'backup':
          pos -= parseInt(txt(el, 'duration'), 10) || 0;
          break;
        case 'forward':
          pos += parseInt(txt(el, 'duration'), 10) || 0;
          maxPos = Math.max(maxPos, pos);
          break;
        case 'note': {
          if (el.querySelector('grace')) break;
          const dur = parseInt(txt(el, 'duration'), 10) || 0;
          const chord = !!el.querySelector('chord');
          const start = chord ? lastStart : pos;
          if (!chord) {
            lastStart = pos;
            pos += dur;
            maxPos = Math.max(maxPos, pos);
          }
          if (el.querySelector('rest')) break;
          const iid = el.querySelector('instrument')?.getAttribute('id') ?? '';
          const head = txt(el, 'notehead');
          let m = inst.get(iid) ?? null;
          if (!m) {
            const step = txt(el, 'unpitched > display-step');
            const oct = parseInt(txt(el, 'unpitched > display-octave'), 10);
            if (step) m = byPosition(step, oct, head);
          }
          if (!m) break;
          let [pad, art] = m;
          if (pad === 'hihat' && art === 'normal' && (el.querySelector('technical > open') || el.querySelector('articulations > open'))) art = 'open';
          const ghost = el.querySelector('notehead')?.getAttribute('parentheses') === 'yes';
          const accent = !!el.querySelector('articulations > accent, articulations > strong-accent');
          const vel = ghost ? 40 : accent ? 122 : 96;
          notes.push({ tick: measureStart + Math.round((start / divisions) * PPQ), pad, art, vel });
          break;
        }
      }
    }
    const expected = ((curSig[0] * 4) / curSig[1]) * divisions;
    measureStart += Math.round((Math.max(maxPos, expected) / divisions) * PPQ);
  }
  return finish(title, bpm || 120, sig ?? [4, 4], notes);
}

export async function importScoreFile(f: File): Promise<Score> {
  const name = f.name.toLowerCase();
  if (name.endsWith('.mxl')) throw new Error('ไฟล์ .mxl เป็นแบบบีบอัด — export เป็น .musicxml (Uncompressed) แทน');
  if (name.endsWith('.mid') || name.endsWith('.midi')) return parseMidi(await f.arrayBuffer(), f.name);
  if (name.endsWith('.musicxml') || name.endsWith('.xml')) return parseMusicXml(await f.text(), f.name);
  throw new Error('รองรับไฟล์ .mid และ .musicxml');
}
