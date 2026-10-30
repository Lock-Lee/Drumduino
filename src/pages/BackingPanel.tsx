import { useEffect, useRef, useState } from 'react';
import { backing, deleteFile, putFile, saveMeta } from '../audio/backing';
import type { BackingMeta } from '../audio/backing';
import { engine } from '../audio/engine';
import type { Score } from '../score/types';

/** The "เพลงประกอบ" strip on the practice page: pick an audio file for this score, line it up, set its volume. */
export function BackingPanel({ score, meta, setMeta, playing, stopPlayer }: {
  score: Score;
  meta: BackingMeta | null;
  setMeta: (m: BackingMeta | null) => void;
  playing: boolean;
  stopPlayer: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const [tapping, setTapping] = useState(false);
  const [pos, setPos] = useState(0);

  const update = (m: BackingMeta | null) => {
    saveMeta(score.id, m);
    setMeta(m);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    stopPlayer();
    setMsg('กำลังบันทึกไฟล์…');
    try {
      await putFile(score.id, f);
      backing.unload();
      const ok = await backing.load(score.id);
      if (!ok) {
        await deleteFile(score.id);
        setMsg('เปิดไฟล์นี้ไม่ได้ ลองใช้ไฟล์ mp3, m4a หรือ wav');
        return;
      }
      update({ name: f.name, offset: meta?.offset ?? 0, volume: meta?.volume ?? 70 });
      setMsg('ตั้งจุดเริ่ม: กด “ฟังแล้วกดตอนห้องแรก” หรือพิมพ์วินาทีที่ห้อง 1 เริ่ม');
    } catch (e) {
      setMsg('บันทึกไฟล์ไม่ได้: ' + (e as Error).message);
    }
  };

  const remove = async () => {
    if (!confirm(`เอาเพลงประกอบ “${meta?.name}” ออกจาก ${score.title}?`)) return;
    stopPlayer();
    backing.unload();
    await deleteFile(score.id).catch(() => undefined);
    update(null);
    setMsg('');
  };

  // tap mode: play the file from the top; the press marks measure 1
  useEffect(() => {
    if (!tapping) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      setPos(backing.el.currentTime);
    };
    void (async () => {
      engine.resume();
      if (!(await backing.load(score.id))) return;
      backing.el.playbackRate = 1;
      backing.el.currentTime = Math.max(0, (meta?.offset ?? 0) - 4);
      void backing.el.play();
      raf = requestAnimationFrame(tick);
    })();
    return () => {
      cancelAnimationFrame(raf);
      backing.pause();
    };
  }, [tapping, score.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const tapNow = () => {
    if (!meta) return;
    update({ ...meta, offset: Math.round(backing.el.currentTime * 100) / 100 });
    setTapping(false);
    setMsg('ตั้งจุดเริ่มแล้ว กดเล่นเพื่อลองฟัง แล้วขยับ ±0.01 วินาทีจนตรง');
  };
  useEffect(() => {
    if (!tapping) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        tapNow();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const nudge = (d: number) => meta && update({ ...meta, offset: Math.max(0, Math.round((meta.offset + d) * 1000) / 1000) });
  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;

  return (
    <div className="pr-backing">
      <span className="label">เพลงประกอบ</span>
      {!meta ? (
        <>
          <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>เลือกไฟล์เพลง…</button>
          <span className="faint" style={{ fontSize: 12 }}>ใช้ไฟล์ mp3 / m4a / wav ของเพลงนี้ เพื่อให้เพลงเล่นพร้อมโน้ต</span>
        </>
      ) : (
        <>
          <span className="pr-bk-name" title={meta.name}>♪ {meta.name}</span>
          <label className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <span className="faint" style={{ fontSize: 12 }}>เสียง</span>
            <input type="range" min={0} max={100} value={meta.volume} style={{ width: 90 }} aria-label="เสียงเพลงประกอบ" onChange={(e) => update({ ...meta, volume: Number(e.target.value) })} />
          </label>
          <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
            <span className="faint" style={{ fontSize: 12 }}>ห้อง 1 เริ่มที่</span>
            <button type="button" className="btn sm ghost" onClick={() => nudge(-0.1)} aria-label="เร็วขึ้น 0.1 วินาที">−0.1</button>
            <button type="button" className="btn sm ghost" onClick={() => nudge(-0.01)} aria-label="เร็วขึ้น 0.01 วินาที">−.01</button>
            <input className="num" style={{ width: 74 }} type="number" step={0.01} min={0} value={meta.offset} aria-label="วินาทีที่ห้อง 1 เริ่ม" onChange={(e) => update({ ...meta, offset: Math.max(0, Number(e.target.value) || 0) })} />
            <span className="faint" style={{ fontSize: 12 }}>วิ</span>
            <button type="button" className="btn sm ghost" onClick={() => nudge(0.01)} aria-label="ช้าลง 0.01 วินาที">+.01</button>
            <button type="button" className="btn sm ghost" onClick={() => nudge(0.1)} aria-label="ช้าลง 0.1 วินาที">+0.1</button>
          </span>
          {tapping ? (
            <>
              <button type="button" className="btn sm primary" onClick={tapNow}>กดตอนนี้! (ห้อง 1) · {fmt(pos)}</button>
              <button type="button" className="btn sm ghost" onClick={() => setTapping(false)}>ยกเลิก</button>
            </>
          ) : (
            <button type="button" className="btn sm ghost" disabled={playing} onClick={() => { stopPlayer(); setMsg('ฟังเพลง แล้วกดปุ่ม (หรือ Space) ตรงจังหวะแรกของห้อง 1'); setTapping(true); }}>ฟังแล้วกดตอนห้องแรก</button>
          )}
          <button type="button" className="btn sm ghost" onClick={() => fileRef.current?.click()}>เปลี่ยนไฟล์</button>
          <button type="button" className="btn sm ghost" onClick={() => void remove()}>เอาออก</button>
        </>
      )}
      <input ref={fileRef} type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
      {msg && <span className="faint" style={{ fontSize: 12, flexBasis: '100%' }} role="status">{msg}</span>}
    </div>
  );
}
