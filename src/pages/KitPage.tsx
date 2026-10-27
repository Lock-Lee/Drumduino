import { useRef, useState } from 'react';
import type { DragEvent, PointerEvent as RPointerEvent } from 'react';
import { useStore } from '../store';
import { useHardware } from '../input/hardware';
import { engine } from '../audio/engine';
import type { Pad, PlayMode } from '../types';
import { CHANNEL_COUNT, PIN_LABELS } from '../types';
import { SOURCE_LABELS } from '../kits';
import { Close, Down, Move, Plus, PlayIcon, Trash, Up, Wave } from '../components/Icons';

const MODES: { id: PlayMode; label: string; help: string }[] = [
  { id: 'vel', label: 'ตามแรงตี', help: 'ตีเบาได้ไฟล์แรก ตีแรงได้ไฟล์ท้าย — เรียงจากเบาไปแรง' },
  { id: 'rr', label: 'วนตามลำดับ', help: 'ตีแต่ละครั้งเล่นไฟล์ถัดไป รัวแล้วเสียงไม่ซ้ำ' },
  { id: 'rand', label: 'สุ่ม', help: 'สุ่มไฟล์ทุกครั้งที่ตี' }
];

function rangeFor(mode: PlayMode, i: number, n: number) {
  if (mode === 'vel') {
    const lo = Math.round((i * 127) / n) + 1;
    const hi = Math.round(((i + 1) * 127) / n);
    return { label: `แรง ${lo}–${hi}`, left: (lo / 127) * 100, width: ((hi - lo + 1) / 127) * 100 };
  }
  if (mode === 'rr') return { label: `รอบที่ ${i + 1}`, left: (i / n) * 100, width: 100 / n };
  return { label: `สุ่ม ${Math.round(100 / n)}%`, left: 0, width: 100 / n };
}

export function KitPage({ goLibrary }: { goLibrary: () => void }) {
  const store = useStore();
  const hw = useHardware();
  const { kit, selectedId, select, updatePad } = store;
  const [arrange, setArrange] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const sel = kit.pads.find((p) => p.id === selectedId) ?? kit.pads[0];

  const onPadDown = (e: RPointerEvent<HTMLButtonElement>, p: Pad) => {
    if (!arrange) {
      select(p.id);
      engine.play(p, 100, 'ui');
      return;
    }
    const r = stageRef.current!.getBoundingClientRect();
    drag.current = {
      id: p.id,
      dx: ((e.clientX - r.left) / r.width) * 100 - p.x,
      dy: ((e.clientY - r.top) / r.height) * 100 - p.y
    };
    select(p.id);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPadMove = (e: RPointerEvent<HTMLButtonElement>, p: Pad) => {
    const d = drag.current;
    if (!d || d.id !== p.id) return;
    const r = stageRef.current!.getBoundingClientRect();
    const hPct = (p.w * r.width) / r.height; // pad height in % of stage height
    const x = Math.max(0, Math.min(100 - p.w, ((e.clientX - r.left) / r.width) * 100 - d.dx));
    const y = Math.max(0, Math.min(100 - hPct, ((e.clientY - r.top) / r.height) * 100 - d.dy));
    updatePad(p.id, { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  };
  const onPadUp = () => {
    drag.current = null;
  };

  return (
    <main className="page">
      <section className="grow" aria-label="ชุดกลอง">
        <div className="kit-head">
          <div className="stack" style={{ gap: 4, marginRight: 'auto', minWidth: 240, flex: '1 1 300px' }}>
            <label htmlFor="kitsel" className="label">ชุดกลอง</label>
            <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <select id="kitsel" className="input kit-select" value={kit.id} onChange={(e) => store.selectKit(e.target.value)}>
                <optgroup label="ชุดกลองในแอป">
                  {store.kits.filter((k) => k.presetId).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                </optgroup>
                {store.kits.some((k) => !k.presetId) && (
                  <optgroup label="ชุดของฉัน">
                    {store.kits.filter((k) => !k.presetId).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                  </optgroup>
                )}
              </select>
              {store.kitLoading && <span className="faint" style={{ fontSize: 13, whiteSpace: 'nowrap' }} role="status">กำลังโหลดเสียง…</span>}
            </div>
            <span className="faint" style={{ fontSize: 13 }}>
              {store.preset ? `${store.preset.description} · ${store.preset.credit}` : 'ชุดที่คุณสร้างเอง — แก้ไขได้ทุกอย่าง บันทึกอัตโนมัติ'}
            </span>
          </div>
          <button type="button" className="btn" onClick={store.duplicateKit}>ทำสำเนาเป็นชุดของฉัน</button>
          {store.preset ? (
            <button type="button" className="btn ghost" onClick={() => { if (confirm(`คืนค่าเสียงของ "${kit.name}" เป็นแบบเดิม?`)) store.resetKitSounds(); }}>คืนค่าเสียงเดิม</button>
          ) : (
            <button type="button" className="btn ghost danger" onClick={() => { if (confirm(`ลบชุด "${kit.name}"?`)) store.deleteKit(kit.id); }}><Trash /> ลบชุดนี้</button>
          )}
        </div>
        {!store.preset && (
          <div className="row" style={{ gap: 8 }}>
            <label htmlFor="kitname" className="label">ชื่อชุด</label>
            <input id="kitname" className="input" style={{ maxWidth: 320, minHeight: 36 }} value={kit.name} onChange={(e) => store.setKitName(e.target.value)} />
          </div>
        )}
        <div className="row" style={{ gap: 10 }}>
          <button type="button" className={'btn' + (arrange ? ' outline' : '')} aria-pressed={arrange} onClick={() => setArrange((a) => !a)}>
            <Move /> {arrange ? 'จัดวางเสร็จแล้ว' : 'จัดตำแหน่ง'}
          </button>
          <button type="button" className="btn" onClick={store.addPad}>
            <Plus /> เพิ่มชิ้นกลอง
          </button>
          <button type="button" className="btn ghost" onClick={store.exportKit}>ส่งออกชุดกลอง</button>
        </div>

        <div ref={stageRef} className={'stage' + (arrange ? ' arrange' : '')}>
          <span className="stage-hint">
            {arrange ? 'ลากชิ้นกลองเพื่อย้ายตำแหน่ง' : 'คลิกเพื่อเลือกและฟังเสียง · หรือกดคีย์บอร์ดตามตัวอักษรบนกลอง (Shift = ตีเบา)'}
          </span>
          {kit.pads.map((p) => {
            const on = p.id === sel?.id;
            const hit = !!hw.flash[p.id];
            return (
              <button
                key={p.id}
                type="button"
                className={'pad' + (p.cymbal ? ' cym' : '') + (on ? ' sel' : '') + (hit ? ' hit' : '')}
                style={{ left: p.x + '%', top: p.y + '%', width: p.w + '%' }}
                aria-pressed={on}
                aria-label={`${p.name} ${p.th}, ${p.channel >= 0 ? 'ขา ' + PIN_LABELS[p.channel] : 'ยังไม่ต่อขา'}, ${p.samples.length} เสียง`}
                onPointerDown={(e) => onPadDown(e, p)}
                onPointerMove={(e) => onPadMove(e, p)}
                onPointerUp={onPadUp}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    select(p.id);
                    engine.play(p, 100, 'ui');
                  }
                }}
              >
                {p.key && <span className="k">{p.key}</span>}
                <span className="n">{p.name}</span>
                <span className="t">{p.th}</span>
                <span className="m">{(p.channel >= 0 ? PIN_LABELS[p.channel] : '—') + ' · ' + p.samples.length + ' เสียง'}</span>
              </button>
            );
          })}
        </div>

        <div className="card stack">
          <div className="row" style={{ alignItems: 'baseline', gap: '6px 16px' }}>
            <h2>สัญญาณเข้า (สด)</h2>
            <span className="faint" style={{ fontSize: 13 }}>ความแรงที่ตีล่าสุดของแต่ละชิ้น (0–127)</span>
          </div>
          <div className="meters">
            {Array.from({ length: CHANNEL_COUNT }, (_, ch) => {
              const p = kit.pads.find((x) => x.channel === ch);
              const v = p ? hw.padLevels[p.id] ?? 0 : hw.channelLevels[ch];
              const live = p ? !!hw.flash[p.id] : false;
              return (
                <div className="meter" key={ch}>
                  <div className="bar"><div className={'fill' + (live ? ' live' : '')} style={{ height: (v / 127) * 100 + '%' }} /></div>
                  <span className="mono" style={{ fontSize: 12 }}>{v}</span>
                  <span className="cap">{PIN_LABELS[ch]} · {p ? p.name : '—'}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {sel && <PadPanel pad={sel} goLibrary={goLibrary} />}
    </main>
  );
}

function PadPanel({ pad, goLibrary }: { pad: Pad; goLibrary: () => void }) {
  const store = useStore();
  const { kit, samples, updatePad } = store;
  const [over, setOver] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const n = pad.samples.length;
  const mode = MODES.find((m) => m.id === pad.mode)!;
  const nameOf = (id: string) => samples.find((s) => s.id === id)?.name ?? '(ไฟล์หาย)';
  const usedChannels = new Map(kit.pads.filter((p) => p.id !== pad.id).map((p) => [p.channel, p.name]));

  const doImport = async (files: FileList | File[]) => {
    const res = await store.importFiles(files, pad.id);
    setMsg(
      (res.ok ? `เพิ่ม ${res.ok} ไฟล์แล้ว` : '') +
        (res.failed.length ? `${res.ok ? ' · ' : ''}เปิดไม่ได้: ${res.failed.join(', ')}` : '')
    );
  };

  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= n) return;
    const next = pad.samples.slice();
    [next[i], next[j]] = [next[j], next[i]];
    updatePad(pad.id, { samples: next });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) void doImport(e.dataTransfer.files);
  };

  return (
    <aside className="panel card" aria-label="ตั้งค่าชิ้นกลองที่เลือก">
      <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <div className="stack" style={{ gap: 6, flex: '1 1 0', minWidth: 0 }}>
          <span className="label">ชิ้นกลองที่เลือก</span>
          <label className="sr-only" htmlFor="padname">ชื่อชิ้นกลอง</label>
          <input id="padname" className="kit-name" style={{ fontSize: 26, fontWeight: 700 }} value={pad.name} onChange={(e) => updatePad(pad.id, { name: e.target.value })} />
          <label className="sr-only" htmlFor="padth">ชื่อภาษาไทย</label>
          <input id="padth" className="input" style={{ minHeight: 36 }} value={pad.th} onChange={(e) => updatePad(pad.id, { th: e.target.value })} />
        </div>
        <button type="button" className="btn outline" onClick={() => engine.play(pad, 100, 'ui')}>
          <PlayIcon /> ทดสอบ
        </button>
      </div>

      <div className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>
        <div className="field" style={{ flex: '2 1 0' }}>
          <label htmlFor="pin" className="label">ขา Arduino</label>
          <select id="pin" className="input" value={pad.channel} onChange={(e) => updatePad(pad.id, { channel: Number(e.target.value) })}>
            <option value={-1}>ไม่ได้ต่อ</option>
            {PIN_LABELS.map((l, i) => (
              <option key={l} value={i}>{l}{usedChannels.has(i) ? ` (ใช้กับ ${usedChannels.get(i)})` : ''}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: '1 1 0' }}>
          <label htmlFor="key" className="label">คีย์ทดสอบ</label>
          <input id="key" className="input mono" value={pad.key} onChange={(e) => updatePad(pad.id, { key: e.target.value.toLowerCase().slice(-1) })} />
        </div>
        <div className="field" style={{ flex: '1 1 0' }}>
          <label htmlFor="note" className="label">โน้ต MIDI</label>
          <input id="note" className="input mono" type="number" min={0} max={127} value={pad.midiNote} onChange={(e) => updatePad(pad.id, { midiNote: Math.max(0, Math.min(127, Number(e.target.value))) })} />
        </div>
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <span id="modeLabel" className="label">วิธีเล่นเมื่อมีหลายเสียง</span>
        <div className="seg" role="group" aria-labelledby="modeLabel">
          {MODES.map((m) => (
            <button key={m.id} type="button" aria-pressed={pad.mode === m.id} onClick={() => updatePad(pad.id, { mode: m.id })}>
              {m.label}
            </button>
          ))}
        </div>
        <span className="faint" style={{ fontSize: 13 }}>{mode.help}</span>
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
          <h2>เสียงของชิ้นนี้</h2>
          <span className="mono muted" style={{ fontSize: 13 }}>{n} ไฟล์</span>
        </div>
        {n === 0 ? (
          <p className="empty">ยังไม่มีเสียง — เพิ่มอย่างน้อย 1 ไฟล์เพื่อให้มีเสียงเวลาตี</p>
        ) : (
          <ul className="sound-list">
            {pad.samples.map((id, i) => {
              const r = rangeFor(pad.mode, i, n);
              return (
                <li className="sound" key={id + i}>
                  <Wave />
                  <div className="info">
                    <span className="fname" title={nameOf(id)}>{nameOf(id)}</span>
                    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                      <div className="range-bar"><span style={{ left: r.left + '%', width: Math.max(3, r.width) + '%' }} /></div>
                      <span className="mono muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{r.label}</span>
                    </div>
                  </div>
                  <button type="button" className="icon-btn" aria-label={'เลื่อนขึ้น ' + nameOf(id)} disabled={i === 0} onClick={() => move(i, -1)}><Up /></button>
                  <button type="button" className="icon-btn" aria-label={'เลื่อนลง ' + nameOf(id)} disabled={i === n - 1} onClick={() => move(i, 1)}><Down /></button>
                  <button type="button" className="icon-btn" aria-label={'เอาออก ' + nameOf(id)} onClick={() => updatePad(pad.id, { samples: pad.samples.filter((_, k) => k !== i) })}><Close /></button>
                </li>
              );
            })}
          </ul>
        )}

        <div
          className={'drop' + (over ? ' over' : '')}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <button type="button" className="btn primary" onClick={() => fileRef.current?.click()}>
            <Plus /> เพิ่มเสียงจากไฟล์
          </button>
          <input ref={fileRef} type="file" accept="audio/*,.wav,.mp3,.ogg,.flac,.aif,.aiff" multiple hidden onChange={(e) => { if (e.target.files) void doImport(e.target.files); e.target.value = ''; }} />
          <span className="faint" style={{ fontSize: 13 }}>หรือลากไฟล์ .wav / .mp3 มาวางที่นี่</span>
          <div className="row" style={{ width: '100%', flexWrap: 'nowrap' }}>
            <label htmlFor="fromlib" className="sr-only">เพิ่มจากคลังเสียง</label>
            <select
              id="fromlib"
              className="input"
              value=""
              onChange={(e) => e.target.value && updatePad(pad.id, { samples: [...pad.samples, e.target.value] })}
            >
              <option value="">เพิ่มจากคลังเสียง…</option>
              {Object.entries(SOURCE_LABELS).map(([src, label]) => (
                <optgroup key={src} label={label}>
                  {samples.filter((s) => s.source === src).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button type="button" className="btn ghost" onClick={goLibrary}>เปิดคลัง</button>
          </div>
          {msg && <span className="muted" style={{ fontSize: 13 }} role="status">{msg}</span>}
        </div>
      </div>

      <div className="stack divider" style={{ gap: 16 }}>
        <h2>ปรับแต่ง</h2>
        <div className="field">
          <div className="slider-row"><label htmlFor="vol">ความดัง</label><span className="mono" style={{ fontSize: 13 }}>{pad.volume}%</span></div>
          <input id="vol" type="range" min={0} max={100} value={pad.volume} onChange={(e) => updatePad(pad.id, { volume: Number(e.target.value) })} />
        </div>
        <div className="field">
          <div className="slider-row"><label htmlFor="pitch">ระดับเสียง (Pitch)</label><span className="mono" style={{ fontSize: 13 }}>{(pad.pitch > 0 ? '+' : '') + pad.pitch} st</span></div>
          <input id="pitch" type="range" min={-12} max={12} value={pad.pitch} onChange={(e) => updatePad(pad.id, { pitch: Number(e.target.value) })} />
        </div>
        <div className="field">
          <div className="slider-row"><label htmlFor="sens">ความไวเซนเซอร์</label><span className="mono" style={{ fontSize: 13 }}>{pad.sensitivity}</span></div>
          <input id="sens" type="range" min={1} max={100} value={pad.sensitivity} onChange={(e) => updatePad(pad.id, { sensitivity: Number(e.target.value) })} />
          <span className="faint" style={{ fontSize: 12 }}>สูง = ตีเบาก็มีเสียง · ต่ำ = กันเสียงสะเทือนจากชิ้นข้างๆ</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <label className="row" style={{ gap: 8, fontSize: 14, minHeight: 44 }}>
            <input type="checkbox" checked={pad.cymbal} onChange={(e) => updatePad(pad.id, { cymbal: e.target.checked })} />
            แสดงเป็นฉาบ
          </label>
          <div className="spacer" />
          <label htmlFor="size" className="label">ขนาด</label>
          <input id="size" type="range" min={8} max={30} value={pad.w} onChange={(e) => updatePad(pad.id, { w: Number(e.target.value) })} style={{ width: 120 }} />
        </div>
        <button
          type="button"
          className="btn ghost danger"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => { if (confirm(`ลบ "${pad.name}" ออกจากชุดกลอง?`)) store.removePad(pad.id); }}
        >
          <Trash /> ลบชิ้นกลองนี้
        </button>
      </div>
    </aside>
  );
}
