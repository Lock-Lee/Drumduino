// Grid editor: enter a drum part bar by bar from a sheet / tab you have.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { Notation } from '../score/Notation';
import { Player, artToPlay } from '../score/player';
import { engine } from '../audio/engine';
import type { Art, PadId, Score, ScoreNote } from '../score/types';
import { PPQ, sortNotes, ticksPerMeasure } from '../score/types';
import { PlayIcon, Plus, Stop, Trash } from '../components/Icons';

type Cell = { art: Art; vel: number } | null;

interface Row {
  id: string;
  label: string;
  pad: PadId;
  pedal?: boolean;
  /** click cycle after "off" */
  cycle: { art: Art; vel: number; sym: string; name: string }[];
}

const X = { art: 'normal' as Art, vel: 96, sym: '●', name: 'ตี' };
const ACC = { art: 'normal' as Art, vel: 122, sym: '>', name: 'เน้น' };
const GH = { art: 'normal' as Art, vel: 38, sym: '( )', name: 'ghost' };

const ROWS: Row[] = [
  { id: 'crash', label: 'แครช', pad: 'crash', cycle: [X, ACC] },
  { id: 'ride', label: 'ไรด์', pad: 'ride', cycle: [X, ACC, { art: 'rim', vel: 110, sym: '◆', name: 'bell' }] },
  { id: 'hihat', label: 'ไฮแฮท', pad: 'hihat', cycle: [X, ACC, { art: 'open', vel: 100, sym: 'o', name: 'เปิด' }, { art: 'half', vel: 96, sym: 'ø', name: 'ครึ่ง' }, GH] },
  { id: 'tom1', label: 'ทอม 1', pad: 'tom1', cycle: [X, ACC, GH] },
  { id: 'tom2', label: 'ทอม 2', pad: 'tom2', cycle: [X, ACC, GH] },
  { id: 'snare', label: 'สแนร์', pad: 'snare', cycle: [X, ACC, GH, { art: 'rim', vel: 115, sym: 'R', name: 'rimshot' }, { art: 'xstick', vel: 70, sym: 'C', name: 'cross-stick' }] },
  { id: 'floor', label: 'ฟลอร์ทอม', pad: 'floor', cycle: [X, ACC, GH] },
  { id: 'kick', label: 'กระเดื่อง', pad: 'kick', cycle: [X, ACC] },
  { id: 'hhpedal', label: 'ไฮแฮท (เท้า)', pad: 'hihat', pedal: true, cycle: [{ art: 'pedal', vel: 90, sym: '✕', name: 'เหยียบ' }] }
];

const rowOf = (n: ScoreNote) => ROWS.find((r) => r.pad === n.pad && !!r.pedal === (n.art === 'pedal'))!;
const symOf = (row: Row, c: Cell) => {
  if (!c) return '';
  const hit = row.cycle.find((s) => s.art === c.art && Math.abs(s.vel - c.vel) < 12) ?? row.cycle.find((s) => s.art === c.art);
  return hit?.sym ?? '●';
};

type Grid = 'straight' | 'triplet';

export function newScore(): Score {
  return { id: 'my-' + Date.now().toString(36), title: 'เพลงใหม่', subtitle: 'สร้างเอง', bpm: 120, sig: [4, 4], measures: 4, notes: [], imported: true };
}

export function ScoreEditor({ initial, onSave, onCancel }: { initial: Score; onSave: (s: Score) => void; onCancel: () => void }) {
  const { kit } = useStore();
  const kitRef = useRef(kit);
  kitRef.current = kit;
  const [s, setS] = useState<Score>(() => ({ ...initial, notes: sortNotes(initial.notes), sections: initial.sections ? [...initial.sections] : [] }));
  const [bar, setBar] = useState(0);
  const [grid, setGrid] = useState<Grid>('straight');
  const [clip, setClip] = useState<ScoreNote[] | null>(null);
  const [playing, setPlaying] = useState<'bar' | 'all' | null>(null);
  const [dirty, setDirty] = useState(false);
  const [repeatN, setRepeatN] = useState(3);
  const tickRef = useRef<number | null>(null);

  const tpm = ticksPerMeasure(s);
  const compound = s.sig[1] === 8;
  const slotTicks = grid === 'triplet' && !compound ? PPQ / 3 : PPQ / 4;
  const slots = Math.round(tpm / slotTicks);
  const beatSlots = compound ? 6 : grid === 'triplet' ? 3 : 4; // where to draw beat separators
  const base = bar * tpm;

  const update = (fn: (x: Score) => Score) => {
    setS((x) => fn(x));
    setDirty(true);
  };

  const cellAt = (row: Row, slot: number): { cell: Cell; idx: number } => {
    const t0 = base + slot * slotTicks;
    const idx = s.notes.findIndex((n) => Math.abs(n.tick - t0) < slotTicks / 2 && rowOf(n) === row);
    return { cell: idx >= 0 ? { art: s.notes[idx].art, vel: s.notes[idx].vel } : null, idx };
  };

  const cycle = (row: Row, slot: number, back = false) => {
    const { cell, idx } = cellAt(row, slot);
    const pos = cell ? row.cycle.findIndex((c) => c.art === cell.art && Math.abs(c.vel - cell.vel) < 12) : -1;
    const nextPos = back ? -1 : pos + 1;
    const target = s.notes[idx];
    const c = nextPos >= 0 && nextPos < row.cycle.length ? row.cycle[nextPos] : null;
    update((x) => {
      const notes = x.notes.filter((n) => n !== target);
      if (c) notes.push({ tick: base + slot * slotTicks, pad: row.pad, art: c.art, vel: c.vel });
      return { ...x, notes: sortNotes(notes) };
    });
    // hear what was entered
    const pad = kitRef.current.pads.find((p) => p.id === row.pad);
    if (pad && c) {
      const pl = artToPlay(c.art, c.vel);
      engine.play(pad, pl.vel, 'score', pl.zone, { hat: pl.hat, silentUI: true });
    }
  };

  const barNotes = (m: number) => s.notes.filter((n) => n.tick >= m * tpm && n.tick < (m + 1) * tpm);

  const insertBars = (at: number, notesPerBar: ScoreNote[][]) =>
    update((x) => {
      const k = notesPerBar.length;
      const shifted = x.notes.map((n) => (n.tick >= at * tpm ? { ...n, tick: n.tick + k * tpm } : n));
      const added = notesPerBar.flatMap((ns, i) => ns.map((n) => ({ ...n, tick: (at + i) * tpm + (n.tick % tpm) })));
      const sections = (x.sections ?? []).map((sec) => (sec.measure >= at ? { ...sec, measure: sec.measure + k } : sec));
      return { ...x, measures: x.measures + k, notes: sortNotes([...shifted, ...added]), sections };
    });

  const deleteBar = (m: number) => {
    if (s.measures <= 1) return;
    update((x) => ({
      ...x,
      measures: x.measures - 1,
      notes: x.notes.filter((n) => Math.floor(n.tick / tpm) !== m).map((n) => (n.tick >= (m + 1) * tpm ? { ...n, tick: n.tick - tpm } : n)),
      sections: (x.sections ?? []).filter((sec) => sec.measure !== m).map((sec) => (sec.measure > m ? { ...sec, measure: sec.measure - 1 } : sec))
    }));
    setBar((b) => Math.max(0, Math.min(b, s.measures - 2)));
  };

  const pasteInto = (m: number, ns: ScoreNote[]) =>
    update((x) => ({ ...x, notes: sortNotes([...x.notes.filter((n) => Math.floor(n.tick / tpm) !== m), ...ns.map((n) => ({ ...n, tick: m * tpm + (n.tick % tpm) }))]) }));

  const section = (s.sections ?? []).find((x) => x.measure === bar)?.name ?? '';
  const setSection = (name: string) =>
    update((x) => {
      const rest = (x.sections ?? []).filter((sec) => sec.measure !== bar);
      return { ...x, sections: name.trim() ? [...rest, { name, measure: bar }].sort((a, b) => a.measure - b.measure) : rest };
    });

  // ---- preview playback ----
  const player = useMemo(
    () =>
      new Player(
        (id) => kitRef.current.pads.find((p) => p.id === id),
        () => undefined,
        () => {
          setPlaying(null);
          tickRef.current = null;
        },
        () => undefined
      ),
    []
  );
  useEffect(() => () => player.stop(), [player]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const f = () => {
      raf = requestAnimationFrame(f);
      tickRef.current = player.currentTick();
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [playing, player]);
  const play = (what: 'bar' | 'all') => {
    if (playing) {
      player.stop();
      setPlaying(null);
      tickRef.current = null;
      if (playing === what) return;
    }
    const score = { ...s, notes: sortNotes(s.notes) };
    player.start(score, { bpm: s.bpm, from: what === 'bar' ? bar : bar, to: what === 'bar' ? bar + 1 : s.measures, loop: what === 'bar', countIn: false, metronome: true, drums: 'full' });
    setPlaying(what);
  };
  // restart a looping bar preview when the bar or notes change
  useEffect(() => {
    if (playing === 'bar') {
      player.stop();
      player.start({ ...s, notes: sortNotes(s.notes) }, { bpm: s.bpm, from: bar, to: bar + 1, loop: true, countIn: false, metronome: true, drums: 'full' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bar, s]);

  // keyboard: ← → move between bars
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /INPUT|SELECT|TEXTAREA/.test(t.tagName)) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); setBar((b) => Math.min(s.measures - 1, b + 1)); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); setBar((b) => Math.max(0, b - 1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.measures]);

  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const save = () => {
    onSave({ ...s, title: s.title.trim() || 'เพลงใหม่', notes: sortNotes(s.notes), sections: (s.sections ?? []).length ? s.sections : undefined, imported: true });
    setDirty(false);
  };

  const cur = barNotes(bar).length;

  return (
    <section className="ed" aria-label="แก้ไขโน้ต">
      <div className="ed-head">
        <label className="sr-only" htmlFor="ed-title">ชื่อเพลง</label>
        <input id="ed-title" className="input ed-title" value={s.title} onChange={(e) => update((x) => ({ ...x, title: e.target.value }))} placeholder="ชื่อเพลง" />
        <label className="ed-f"><span className="label">BPM</span><input className="num" type="number" min={30} max={260} value={s.bpm} onChange={(e) => update((x) => ({ ...x, bpm: Math.max(30, Math.min(260, Number(e.target.value) || 120)) }))} /></label>
        <label className="ed-f">
          <span className="label">จังหวะ</span>
          <select className="input sm" value={`${s.sig[0]}/${s.sig[1]}`} disabled={s.notes.length > 0} title={s.notes.length ? 'เปลี่ยนได้ตอนยังไม่มีโน้ต' : ''} onChange={(e) => { const [a, b] = e.target.value.split('/').map(Number); update((x) => ({ ...x, sig: [a, b] })); }}>
            {['4/4', '3/4', '2/4', '6/8', '12/8'].map((v) => <option key={v}>{v}</option>)}
          </select>
        </label>
        <label className="ed-f">
          <span className="label">ตาราง</span>
          <select className="input sm" value={grid} disabled={compound} onChange={(e) => setGrid(e.target.value as Grid)}>
            <option value="straight">เขบ็ต 2 ชั้น (16th)</option>
            <option value="triplet">สามพยางค์ (triplet)</option>
          </select>
        </label>
        <div className="spacer" />
        {dirty && <span className="faint" style={{ fontSize: 12 }}>ยังไม่ได้บันทึก</span>}
        <button type="button" className="btn sm ghost" onClick={() => { if (!dirty || confirm('ออกโดยไม่บันทึก?')) { player.stop(); onCancel(); } }}>ปิด</button>
        <button type="button" className="btn sm primary" onClick={save}>บันทึก</button>
      </div>

      <div className="ed-bars">
        <button type="button" className="btn sm" disabled={bar === 0} onClick={() => setBar(bar - 1)} aria-label="ห้องก่อนหน้า">←</button>
        <span className="ed-barno">ห้อง <b>{bar + 1}</b> / {s.measures}</span>
        <button type="button" className="btn sm" disabled={bar >= s.measures - 1} onClick={() => setBar(bar + 1)} aria-label="ห้องถัดไป">→</button>
        <input className="input sm" style={{ width: 130 }} placeholder="ชื่อท่อน (Verse…)" value={section} onChange={(e) => setSection(e.target.value)} aria-label="ชื่อท่อนที่เริ่มห้องนี้" />
        <span className="vsep" aria-hidden="true" />
        <button type="button" className="btn sm" onClick={() => { insertBars(bar + 1, [[]]); setBar(bar + 1); }}><Plus /> ห้องว่าง</button>
        <button type="button" className="btn sm" onClick={() => { insertBars(bar + 1, [barNotes(bar)]); setBar(bar + 1); }}>ทำสำเนาห้องนี้</button>
        <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
          <button type="button" className="btn sm" onClick={() => insertBars(bar + 1, Array.from({ length: repeatN }, () => barNotes(bar)))}>ซ้ำห้องนี้ ×</button>
          <input className="num" style={{ width: 52 }} type="number" min={1} max={64} value={repeatN} aria-label="จำนวนครั้งที่ซ้ำ" onChange={(e) => setRepeatN(Math.max(1, Math.min(64, Number(e.target.value) || 1)))} />
        </span>
        <button type="button" className="btn sm ghost" onClick={() => setClip(barNotes(bar))}>คัดลอก</button>
        <button type="button" className="btn sm ghost" disabled={!clip} onClick={() => clip && pasteInto(bar, clip)}>วาง</button>
        <button type="button" className="btn sm ghost" disabled={!cur} onClick={() => update((x) => ({ ...x, notes: x.notes.filter((n) => Math.floor(n.tick / tpm) !== bar) }))}>ล้างห้อง</button>
        <button type="button" className="icon-btn sm" aria-label="ลบห้องนี้" disabled={s.measures <= 1} onClick={() => deleteBar(bar)}><Trash /></button>
        <div className="spacer" />
        <button type="button" className={'btn sm' + (playing === 'bar' ? ' outline' : '')} onClick={() => play('bar')}>{playing === 'bar' ? <Stop /> : <PlayIcon />} วนห้องนี้</button>
        <button type="button" className={'btn sm' + (playing === 'all' ? ' outline' : '')} onClick={() => play('all')}>{playing === 'all' ? <Stop /> : <PlayIcon />} เล่นจากห้องนี้</button>
      </div>

      <div className="ed-grid" style={{ ['--slots' as string]: slots }} role="grid" aria-label={`ตารางโน้ตห้อง ${bar + 1}`}>
        <div className="ed-row ed-ruler" role="row">
          <span className="ed-lab" />
          {Array.from({ length: slots }, (_, i) => (
            <span key={i} className={'ed-rule' + (i % beatSlots === 0 ? ' beat' : '')}>
              {i % beatSlots === 0 ? i / beatSlots + 1 : grid === 'triplet' ? (i % 3 === 1 ? 't' : 'l') : ['', 'e', '&', 'a'][i % 4] ?? ''}
            </span>
          ))}
        </div>
        {ROWS.map((row) => (
          <div className="ed-row" role="row" key={row.id}>
            <span className="ed-lab">{row.label}</span>
            {Array.from({ length: slots }, (_, i) => {
              const { cell } = cellAt(row, i);
              return (
                <button
                  key={i}
                  type="button"
                  role="gridcell"
                  className={'ed-cell' + (cell ? ' on' : '') + (i % beatSlots === 0 ? ' beat' : '') + (cell && cell.vel <= 45 ? ' ghost' : '') + (cell && cell.vel >= 115 ? ' acc' : '')}
                  aria-label={`${row.label} ช่อง ${i + 1}${cell ? ' ' + (row.cycle.find((c) => c.art === cell.art)?.name ?? '') : ''}`}
                  onClick={() => cycle(row, i)}
                  onContextMenu={(e) => { e.preventDefault(); cycle(row, i, true); }}
                >
                  {symOf(row, cell)}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="faint ed-help">
        คลิกช่องเพื่อใส่โน้ต · คลิกซ้ำเพื่อเปลี่ยนแบบ (ตี → เน้น &gt; → … ) · คลิกขวาเพื่อลบ · ← → เปลี่ยนห้อง ·
        สแนร์: R = rimshot, C = cross-stick · ไฮแฮท: o = เปิด, ø = ครึ่งเปิด · ไรด์: ◆ = bell
      </p>

      <div className="ed-preview" ref={wrap}>
        <Notation score={s} width={w} tickRef={tickRef} marks={new Map()} activeRange={[bar, bar + 1]} onSeek={(m) => setBar(m)} />
      </div>
    </section>
  );
}
