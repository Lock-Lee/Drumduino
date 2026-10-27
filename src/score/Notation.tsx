// Renders a drum score as standard drum-set notation (VexFlow), with a playhead and hit markers.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Articulation, Beam, Formatter, Fraction, Modifier, Parenthesis, Renderer, Stave, StaveNote, Tuplet, Voice } from 'vexflow';
import type { Art, PadId, Score, ScoreNote } from './types';
import { PPQ, ticksPerMeasure } from './types';

/** Staff position and notehead per pad/articulation (common drum-set key). */
function keyFor(pad: PadId, art: Art): string {
  switch (pad) {
    case 'kick': return 'f/4';
    case 'floor': return 'a/4';
    case 'snare': return art === 'xstick' ? 'c/5/x2' : 'c/5';
    case 'tom2': return 'd/5';
    case 'tom1': return 'e/5';
    case 'ride': return art === 'rim' ? 'f/5/d2' : 'f/5/x2';
    case 'hihat': return art === 'pedal' ? 'd/4/x2' : 'g/5/x2';
    case 'crash': return 'a/5/x2';
  }
}
const STEPS = 'cdefgab';
/** staff line (VexFlow numbering: bottom line = 1, middle = 3) */
function lineOf(key: string): number {
  const [step, oct] = key.split('/');
  const d = parseInt(oct, 10) * 7 + STEPS.indexOf(step);
  return 3 + (d - (4 * 7 + 6)) / 2;
}
const isDown = (n: ScoreNote) => n.pad === 'kick' || (n.pad === 'hihat' && n.art === 'pedal');

export interface NoteMark {
  status: 'ok' | 'early' | 'late' | 'miss';
}

interface Layout {
  width: number;
  height: number;
  measures: { x0: number; x1: number; y: number; anchors: { tick: number; x: number }[] }[];
  notePos: Map<number, { x: number; y: number }>;
}

const DUR16: [number, string][] = [[6, 'qd'], [4, 'q'], [3, '8d'], [2, '8'], [1, '16']];

function split16(len: number): string[] {
  const out: string[] = [];
  let rest = len;
  while (rest > 0) {
    const d = DUR16.find(([l]) => l <= rest)!;
    out.push(d[1]);
    rest -= d[0];
  }
  return out;
}

export function Notation({
  score,
  width,
  tickRef,
  marks,
  onSeek,
  activeRange
}: {
  score: Score;
  width: number;
  tickRef: React.MutableRefObject<number | null>;
  marks: Map<number, NoteMark>;
  onSeek?: (measure: number) => void;
  activeRange?: [number, number];
}) {
  const host = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [approx, setApprox] = useState(false);

  // index notes by measure once
  const byMeasure = useMemo(() => {
    const tpm = ticksPerMeasure(score);
    const m: { n: ScoreNote; i: number }[][] = Array.from({ length: score.measures }, () => []);
    score.notes.forEach((n, i) => {
      const k = Math.floor(n.tick / tpm);
      if (k >= 0 && k < score.measures) m[k].push({ n, i });
    });
    return m;
  }, [score]);

  useEffect(() => {
    const el = host.current;
    if (!el || width < 200) return;
    el.innerHTML = '';
    const tpm = ticksPerMeasure(score);
    const compound = score.sig[1] === 8 && score.sig[0] % 3 === 0;
    const groupTicks = compound ? (PPQ * 3) / 2 : (PPQ * 4) / score.sig[1];
    const groups = tpm / groupTicks;
    // fewer bars per row when bars are busy (16ths need room)
    const onsets = byMeasure.map((ms) => new Set(ms.map((it) => it.n.tick)).size);
    const busiest = Math.max(4, ...onsets);
    const minBarW = 90 + busiest * 20;
    const usableW = width - 20 - 46;
    const perRow = Math.max(1, Math.min(width >= 1100 ? 4 : width >= 720 ? 3 : 2, Math.floor(usableW / minBarW)));
    const rowH = 150;
    const left = 10;
    const firstExtra = 46;
    const rows = Math.ceil(score.measures / perRow);
    const H = rows * rowH + 30;

    const renderer = new Renderer(el, Renderer.Backends.SVG);
    renderer.resize(width, H);
    const ctx = renderer.getContext();
    ctx.setFont('Arial', 10);

    const lay: Layout = { width, height: H, measures: [], notePos: new Map() };
    let anyApprox = false;
    const sectionAt = new Map((score.sections ?? []).map((s) => [s.measure, s.name]));

    for (let m = 0; m < score.measures; m++) {
      const row = Math.floor(m / perRow);
      const col = m % perRow;
      const usable = width - left * 2 - firstExtra;
      const mw = usable / perRow;
      const x = left + col * mw + (col === 0 ? 0 : firstExtra);
      const w = mw + (col === 0 ? firstExtra : 0);
      const y = 34 + row * rowH;
      const stave = new Stave(x, y, w);
      if (col === 0) stave.addClef('percussion');
      if (m === 0) stave.addTimeSignature(`${score.sig[0]}/${score.sig[1]}`);
      if (col === 0 || sectionAt.has(m)) stave.setMeasure(m + 1);
      if (sectionAt.has(m)) stave.setSection(sectionAt.get(m)!, 0);
      stave.setContext(ctx).draw();

      const base = m * tpm;
      const items = byMeasure[m];
      const anchors: { tick: number; x: number }[] = [];
      const allNotes: StaveNote[] = [];
      const voices: Voice[] = [];
      const tuplets: { notes: StaveNote[]; down: boolean }[] = [];
      const beamGroups: StaveNote[][] = [];
      const placed: { sn: StaveNote; tick: number; members: { i: number; key: string }[] }[] = [];

      for (const down of [false, true]) {
        const vn = items.filter((it) => isDown(it.n) === down);
        if (down && vn.length === 0) continue; // feet voice only when needed
        const tickables: StaveNote[] = [];
        const voiceBeams: StaveNote[] = [];
        for (let g = 0; g < groups; g++) {
          const gs = base + g * groupTicks;
          const inG = vn.filter((it) => it.n.tick >= gs - 1 && it.n.tick < gs + groupTicks - 1);
          // grid: 16ths, or 8th-note triplets in simple meters
          const g16 = groupTicks / (PPQ / 4);
          const err = (slots: number) => inG.reduce((a, it) => { const q = ((it.n.tick - gs) / groupTicks) * slots; return a + Math.abs(q - Math.round(q)); }, 0);
          const trip = !compound && inG.length > 0 && err(3) + 1e-6 < err(4);
          const slots = trip ? 3 : g16;
          if (inG.length && err(slots) > 0.05) anyApprox = true;
          const bySlot = new Map<number, typeof inG>();
          for (const it of inG) {
            const sl = Math.min(slots - 1, Math.max(0, Math.round(((it.n.tick - gs) / groupTicks) * slots)));
            bySlot.set(sl, [...(bySlot.get(sl) ?? []), it]);
          }
          const filled = [...bySlot.keys()].sort((a, b) => a - b);
          const restKey = down ? 'f/4' : 'b/4';
          const mk = (keys: string[], dur: string, rest: boolean) =>
            new StaveNote({ clef: 'percussion', keys, duration: dur + (rest ? 'r' : ''), stem_direction: down ? -1 : 1, align_center: false });
          const groupNotes: StaveNote[] = [];
          if (!filled.length) {
            const r = mk([restKey], compound ? 'qd' : groupTicks === PPQ ? 'q' : '8', true);
            tickables.push(r);
            anchors.push({ tick: gs, x: -1 });
            placed.push({ sn: r, tick: gs, members: [] });
            continue;
          }
          const lens: [number, number][] = []; // [slot, len]
          if (filled[0] > 0) lens.push([-1, filled[0]]);
          filled.forEach((sl, k) => lens.push([sl, (filled[k + 1] ?? slots) - sl]));
          for (const [sl, len] of lens) {
            const durs = trip ? (len === 1 ? ['8'] : len === 2 ? ['q'] : ['q', '8']) : split16(len);
            const isRest = sl < 0;
            const tick = gs + ((isRest ? 0 : sl) / slots) * groupTicks;
            durs.forEach((dur, k) => {
              if (isRest || k > 0) {
                const r = mk([restKey], dur, true);
                tickables.push(r);
                groupNotes.push(r);
                placed.push({ sn: r, tick, members: [] });
                return;
              }
              const members = bySlot.get(sl)!.map((it) => ({ i: it.i, key: keyFor(it.n.pad, it.n.art), n: it.n }));
              // unique keys, sorted bottom → top so they match VexFlow's notehead order
              const uniq = [...new Map(members.map((mm) => [mm.key, mm])).values()].sort((a, b) => lineOf(a.key) - lineOf(b.key));
              const sn = mk(uniq.map((u) => u.key), dur, false);
              if (members.some((mm) => mm.n.vel >= 115)) sn.addModifier(new Articulation('a>').setPosition(down ? 4 : 3), 0);
              // open / half-open hi-hat: small circle above (standard drum notation)
              if (members.some((mm) => mm.n.pad === 'hihat' && (mm.n.art === 'open' || mm.n.art === 'half'))) sn.addModifier(new Articulation('ah').setPosition(3), 0);
              // ghost notes: notehead in parentheses
              uniq.forEach((u, k) => {
                if (members.some((mm) => mm.key === u.key && mm.n.vel <= 45)) {
                  sn.addModifier(new Parenthesis(Modifier.Position.LEFT), k);
                  sn.addModifier(new Parenthesis(Modifier.Position.RIGHT), k);
                }
              });
              tickables.push(sn);
              groupNotes.push(sn);
              allNotes.push(sn);
              placed.push({ sn, tick, members: members.map((mm) => ({ i: mm.i, key: mm.key })) });
            });
          }
          if (trip && groupNotes.length > 1) {
            // Tuplet scales the ticks (2/3); its own bracket drawing is unreliable with chords, so we draw ours
            new Tuplet(groupNotes, { num_notes: 3, notes_occupied: 2 });
            tuplets.push({ notes: groupNotes, down });
          }
          voiceBeams.push(...groupNotes);
        }
        const voice = new Voice({ num_beats: score.sig[0], beat_value: score.sig[1] }).setMode(Voice.Mode.SOFT);
        voice.addTickables(tickables);
        voices.push(voice);
        beamGroups.push(voiceBeams);
      }

      new Formatter().joinVoices(voices).format(voices, stave.getNoteEndX() - stave.getNoteStartX() - 12);
      voices.forEach((v) => v.draw(ctx, stave));
      const beamGroup = compound ? [new Fraction(3, 8)] : [new Fraction(1, score.sig[1] === 8 ? 8 : 4)];
      beamGroups.forEach((ns) => {
        const real = ns.filter((n) => !n.isRest());
        if (real.length < 2) return;
        Beam.generateBeams(ns, { groups: beamGroup, maintain_stem_directions: true, beam_rests: false }).forEach((b) => b.setContext(ctx).draw());
      });
      for (const t of tuplets) {
        const xa = t.notes[0].getAbsoluteX();
        const xb = t.notes[t.notes.length - 1].getAbsoluteX() + 12;
        const yy = t.down ? stave.getYForLine(7.4) : stave.getYForLine(-4.4);
        const tick = t.down ? -5 : 5;
        const mid = (xa + xb) / 2;
        ctx.save();
        ctx.setLineWidth(1);
        ctx.beginPath();
        ctx.moveTo(xa, yy + tick);
        ctx.lineTo(xa, yy);
        ctx.lineTo(mid - 6, yy);
        ctx.moveTo(mid + 6, yy);
        ctx.lineTo(xb, yy);
        ctx.lineTo(xb, yy + tick);
        ctx.stroke();
        ctx.setFont('Arial', 11, 'bold');
        ctx.fillText('3', mid - 3.5, yy + 4);
        ctx.restore();
      }

      // playhead anchors + note positions
      const x0 = stave.getNoteStartX();
      const x1 = stave.getX() + stave.getWidth();
      const pts = placed.map((p) => ({ tick: p.tick, x: p.sn.getAbsoluteX() + 6 }));
      pts.push({ tick: base, x: x0 }, { tick: base + tpm, x: x1 - 4 });
      const sorted = pts.filter((p) => p.x > 0).sort((a, b) => a.tick - b.tick || a.x - b.x);
      const dedup: { tick: number; x: number }[] = [];
      for (const p of sorted) if (!dedup.length || p.tick > dedup[dedup.length - 1].tick) dedup.push(p);
      lay.measures.push({ x0, x1, y, anchors: dedup });
      for (const p of placed) {
        for (const mm of p.members) lay.notePos.set(mm.i, { x: p.sn.getAbsoluteX() + 6, y: stave.getYForNote(lineOf(mm.key)) });
      }
    }
    setApprox(anyApprox);
    setLayout(lay);
  }, [score, width, byMeasure]);

  // playhead animation
  useEffect(() => {
    if (!layout) return;
    let raf = 0;
    const tpm = ticksPerMeasure(score);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = cursor.current;
      const tick = tickRef.current;
      if (!c) return;
      if (tick === null || tick < 0) {
        c.style.opacity = '0';
        return;
      }
      const m = Math.min(score.measures - 1, Math.floor(tick / tpm));
      const L = layout.measures[m];
      if (!L) return;
      const a = L.anchors;
      let x = a[a.length - 1].x;
      for (let i = 0; i < a.length - 1; i++) {
        if (tick >= a[i].tick && tick <= a[i + 1].tick) {
          x = a[i].x + ((tick - a[i].tick) / (a[i + 1].tick - a[i].tick || 1)) * (a[i + 1].x - a[i].x);
          break;
        }
      }
      c.style.opacity = '1';
      c.style.transform = `translate(${x}px, ${L.y + 18}px)`;
      // keep the playing row in view
      const sc = host.current?.parentElement?.parentElement;
      if (sc) {
        const top = L.y - 10;
        if (top < sc.scrollTop + 10 || top + 130 > sc.scrollTop + sc.clientHeight) sc.scrollTo({ top: Math.max(0, top - 40), behavior: 'smooth' });
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [layout, score, tickRef]);

  const onClick = (e: React.MouseEvent) => {
    if (!layout || !onSeek) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const m = layout.measures.findIndex((L) => y >= L.y && y <= L.y + 100 && x >= L.x0 - 50 && x <= L.x1);
    if (m >= 0) onSeek(m);
  };

  return (
    <div className="sheet" style={{ position: 'relative', width, height: layout?.height }} onClick={onClick}>
      <div ref={host} />
      {layout && activeRange && layout.measures.map((L, i) =>
        i >= activeRange[0] && i < activeRange[1] ? null : (
          <div key={i} className="sheet-dim" style={{ left: L.x0 - 40, top: L.y + 8, width: L.x1 - L.x0 + 40, height: 84 }} />
        )
      )}
      {layout &&
        [...marks.entries()].map(([i, mk]) => {
          const p = layout.notePos.get(i);
          if (!p) return null;
          return <span key={i} className={'mark ' + mk.status} style={{ left: p.x - 7, top: p.y - 7 }} />;
        })}
      <div ref={cursor} className="playhead" aria-hidden="true" />
      {approx && <div className="sheet-note">บางโน้ตแสดงแบบปัดเศษ (ไฟล์มีจังหวะละเอียดกว่าเขบ็ต 2 ชั้น/triplet) — ตอนเล่นยังตรงตามไฟล์</div>}
    </div>
  );
}
