import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useStore } from '../store';
import { engine } from '../audio/engine';
import type { SampleCategory, SampleSource } from '../types';
import { SOURCE_LABELS } from '../kits';
import { Plus, PlayIcon, Search, Stop, Trash, Upload } from '../components/Icons';

const CATS: { id: 'all' | SampleCategory; label: string }[] = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'kick', label: 'Kick' },
  { id: 'snare', label: 'Snare' },
  { id: 'hihat', label: 'Hi-hat' },
  { id: 'tom', label: 'Tom' },
  { id: 'cym', label: 'ฉาบ (Cymbal)' },
  { id: 'mine', label: 'เครื่องเคาะอื่น ๆ' }
];

function WaveThumb({ id }: { id: string }) {
  const peaks = engine.peaks(id, 30);
  if (!peaks) return <span className="faint">—</span>;
  const d = peaks
    .map((p) => Math.max(0.5, Math.sqrt(p) * 12))
    .map((h, i) => `M${2 + i * 4} ${(14 - h).toFixed(1)}V${(14 + h).toFixed(1)}`)
    .join('');
  return (
    <svg width="122" height="28" viewBox="0 0 122 28" fill="none" stroke="#6B6E76" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function LibraryPage({ goKit }: { goKit: () => void }) {
  const store = useStore();
  const { samples, kit, selectedId } = store;
  const [cat, setCat] = useState<'all' | SampleCategory>('all');
  const [q, setQ] = useState('');
  const [src, setSrc] = useState<'all' | SampleSource>('all');
  const [playing, setPlaying] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [msg, setMsg] = useState('');
  const [, force] = useState(0);
  const stopRef = useRef<(() => void) | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const target = kit.pads.find((p) => p.id === selectedId);

  const usedBy = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of kit.pads) for (const s of p.samples) m.set(s, [...(m.get(s) ?? []), p.name]);
    return m;
  }, [kit]);

  const inSrc = samples.filter((s) => src === 'all' || s.source === src);
  const rows = inSrc.filter(
    (s) => (cat === 'all' || s.category === cat) && (!q || s.name.toLowerCase().includes(q.toLowerCase()))
  );

  // decode what's on screen so the waveforms can be drawn
  const rowSig = rows.slice(0, 80).map((r) => r.id).join(',');
  useEffect(() => {
    let alive = true;
    const ids = rowSig ? rowSig.split(',').filter((id) => !engine.has(id)) : [];
    if (ids.length) void engine.preload(ids).then(() => alive && force((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [rowSig]);
  useEffect(() => () => stopRef.current?.(), []);

  const toggle = (id: string) => {
    stopRef.current?.();
    if (playing === id) {
      setPlaying(null);
      return;
    }
    setPlaying(id);
    stopRef.current = engine.preview(id, () => setPlaying((p) => (p === id ? null : p)));
  };

  const doImport = async (files: FileList | File[]) => {
    const res = await store.importFiles(files);
    setMsg((res.ok ? `นำเข้า ${res.ok} ไฟล์แล้ว` : '') + (res.failed.length ? `${res.ok ? ' · ' : ''}เปิดไม่ได้: ${res.failed.join(', ')}` : ''));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) void doImport(e.dataTransfer.files);
  };

  return (
    <main className="lib-page">
      <nav className="side" aria-label="หมวดเสียง">
        <span className="label" style={{ padding: '0 12px 8px' }}>หมวดหมู่</span>
        {CATS.map((c) => (
          <button key={c.id} type="button" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
            <span>{c.label}</span>
            <span className="mono" style={{ fontSize: 12, opacity: 0.75 }}>
              {c.id === 'all' ? inSrc.length : inSrc.filter((s) => s.category === c.id).length}
            </span>
          </button>
        ))}
      </nav>

      <section className="lib-main" aria-label="รายการเสียง">
        <div className="row" style={{ alignItems: 'flex-end', gap: 12 }}>
          <div className="stack" style={{ gap: 2, marginRight: 'auto' }}>
            <h1 style={{ fontSize: 22 }}>คลังเสียง</h1>
            <span className="muted" style={{ fontSize: 14 }}>
              นำเข้าไฟล์เสียงของคุณ แล้วเพิ่มให้กับชิ้นกลองที่เลือกไว้{target ? ` (ตอนนี้: ${target.name})` : ''}
            </span>
          </div>
          <div className="field" style={{ minWidth: 200 }}>
            <label htmlFor="src" className="sr-only">ที่มาของเสียง</label>
            <select id="src" className="input" value={src} onChange={(e) => setSrc(e.target.value as 'all' | SampleSource)}>
              <option value="all">ทุกชุดเสียง</option>
              {Object.entries(SOURCE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </div>
          <div className="search">
            <Search />
            <label htmlFor="q" className="sr-only">ค้นหาเสียง</label>
            <input id="q" type="search" placeholder="ค้นหาเสียง…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        <div
          className={'drop compact' + (over ? ' over' : '')}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <Upload />
          <div className="stack" style={{ gap: 2, textAlign: 'left' }}>
            <span style={{ fontWeight: 600 }}>ลากไฟล์เสียงมาวางที่นี่</span>
            <span className="faint" style={{ fontSize: 13 }}>รองรับไฟล์ .wav .mp3 .ogg .flac และ .aiff โดยไฟล์จะเก็บไว้ในเครื่องนี้</span>
          </div>
          <button type="button" className="btn primary" onClick={() => fileRef.current?.click()}>นำเข้าไฟล์</button>
          <input ref={fileRef} type="file" accept="audio/*,.wav,.mp3,.ogg,.flac,.aif,.aiff" multiple hidden onChange={(e) => { if (e.target.files) void doImport(e.target.files); e.target.value = ''; }} />
          {msg && <span className="muted" style={{ fontSize: 13, width: '100%' }} role="status">{msg}</span>}
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 60 }}><span className="sr-only">ฟัง</span></th>
                <th>ชื่อไฟล์</th>
                <th className="col-wave">รูปคลื่น</th>
                <th style={{ whiteSpace: 'nowrap' }}>ความยาว</th>
                <th>ใช้กับ</th>
                <th style={{ textAlign: 'right' }}><span className="sr-only">การทำงาน</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={6} className="muted" style={{ padding: 24, textAlign: 'center' }}>ไม่พบเสียงในหมวดนี้</td></tr>
              )}
              {rows.map((s) => {
                const on = playing === s.id;
                const used = usedBy.get(s.id);
                const inTarget = target?.samples.includes(s.id);
                return (
                  <tr key={s.id}>
                    <td>
                      <button type="button" className={'play' + (on ? ' on' : '')} aria-label={(on ? 'หยุด ' : 'ฟัง ') + s.name} onClick={() => toggle(s.id)}>
                        {on ? <Stop /> : <PlayIcon />}
                      </button>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{s.name}</div>
                      <div className="faint" style={{ fontSize: 12 }}>{SOURCE_LABELS[s.source]}</div>
                    </td>
                    <td className="col-wave"><WaveThumb id={s.id} /></td>
                    <td className="mono" style={{ fontSize: 13 }}>{s.duration.toFixed(2)}s</td>
                    <td>{used ? used.map((n) => <span key={n} className="chip">{n}</span>) : <span className="faint">—</span>}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {target && (
                        <button
                          type="button"
                          className="btn sm"
                          title={inTarget ? `อยู่ใน ${target.name} แล้ว` : `เพิ่มให้ ${target.name}`}
                          disabled={inTarget}
                          onClick={() => store.updatePad(target.id, { samples: [...target.samples, s.id] })}
                        >
                          {inTarget ? `✓ ${target.name}` : <><Plus /> {target.name}</>}
                        </button>
                      )}
                      {!s.builtin && (
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={'ลบ ' + s.name}
                          onClick={() => { if (confirm(`ลบ "${s.name}" ออกจากคลังหรือไม่? ชิ้นกลองที่ใช้เสียงนี้จะไม่มีเสียงนี้อีกต่อไป`)) void store.removeSample(s.id); }}
                        >
                          <Trash />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
      </section>
    </main>
  );
}
