import { useEffect, useRef, useState } from 'react';
import { autoAlign, backing, deleteFile, putFile, saveMeta } from '../audio/backing';
import type { BackingMeta } from '../audio/backing';
import { engine } from '../audio/engine';
import type { Score } from '../score/types';

/**
 * The "เพลงประกอบ" strip on the practice page. Pick an audio file and the app finds by itself where
 * measure 1 is and how fast the recording runs. Manual fine-tuning hides behind "ปรับเอง".
 */
export function BackingPanel({ score, meta, setMeta, playing, stopPlayer, onTempo }: {
  score: Score;
  meta: BackingMeta | null;
  setMeta: (m: BackingMeta | null) => void;
  playing: boolean;
  stopPlayer: () => void;
  /** the recording's tempo was found: play the score at it */
  onTempo: (bpm: number) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [manual, setManual] = useState(false);
  const [tapping, setTapping] = useState(false);
  const [pos, setPos] = useState(0);

  useEffect(() => {
    setMsg('');
    setManual(false);
    setTapping(false);
  }, [score.id]);

  const update = (m: BackingMeta | null) => {
    saveMeta(score.id, m);
    setMeta(m);
  };

  const runAlign = async (base: BackingMeta) => {
    stopPlayer();
    setBusy(0);
    setMsg('');
    try {
      const r = await autoAlign(score, (p) => setBusy(p));
      if (!r) return;
      const m = { ...base, offset: r.offset, songBpm: r.bpm };
      update(m);
      onTempo(r.bpm);
      setMsg(r.confidence >= 2.5
        ? 'จับจังหวะให้แล้ว กดเล่นได้เลย'
        : 'จับจังหวะให้แล้ว แต่ไม่ค่อยมั่นใจ ลองกดเล่นฟัง ถ้ายังไม่ตรงให้กด “ปรับเอง”');
    } catch (e) {
      setMsg('วิเคราะห์เพลงไม่ได้: ' + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    stopPlayer();
    setMsg('กำลังบันทึกไฟล์…');
    try {
      await putFile(score.id, f);
      backing.unload();
      if (!(await backing.load(score.id))) {
        await deleteFile(score.id);
        setMsg('เปิดไฟล์นี้ไม่ได้ ลองใช้ไฟล์ mp3, m4a หรือ wav');
        return;
      }
      const m: BackingMeta = { name: f.name, offset: 0, volume: meta?.volume ?? 70 };
      update(m);
      await runAlign(m);
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
    onTempo(score.bpm);
    setMsg('');
  };

  // files added before auto-align existed: line them up once, by themselves
  const tried = useRef('');
  useEffect(() => {
    if (meta && meta.songBpm === undefined && busy === null && tried.current !== score.id) {
      tried.current = score.id;
      void runAlign(meta);
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // manual: play the file from a few seconds before the current start; the press marks measure 1
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
    setMsg('ตั้งจุดเริ่มแล้ว กดเล่นเพื่อลองฟัง');
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
  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

  return (
    <div className="pr-backing">
      <span className="label">เพลงประกอบ</span>
      {!meta ? (
        <>
          <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>♪ เลือกไฟล์เพลง…</button>
          <span className="faint" style={{ fontSize: 12 }}>เลือกไฟล์เพลงนี้ (mp3 / m4a / wav) แล้วแอปจะจับจังหวะให้ตรงกับโน้ตเอง</span>
        </>
      ) : (
        <>
          <span className="pr-bk-name" title={meta.name}>♪ {meta.name}</span>
          {busy !== null ? (
            <span className="pr-bk-busy" role="status">
              กำลังจับจังหวะ… <progress max={1} value={busy} />
            </span>
          ) : (
            <span className="pr-bk-ok">
              {meta.songBpm ? `✓ ตรงกับโน้ตแล้ว · ห้อง 1 อยู่ที่ ${fmt(meta.offset)} · ${meta.songBpm.toFixed(1)} BPM` : `ห้อง 1 อยู่ที่ ${fmt(meta.offset)}`}
            </span>
          )}
          <label className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <span className="faint" style={{ fontSize: 12 }}>เสียงเพลง</span>
            <input type="range" min={0} max={100} value={meta.volume} style={{ width: 90 }} aria-label="เสียงเพลงประกอบ" onChange={(e) => update({ ...meta, volume: Number(e.target.value) })} />
          </label>
          <span className="pr-bk-more">
            <button type="button" className="btn sm ghost" disabled={busy !== null} onClick={() => void runAlign(meta)}>จับจังหวะใหม่</button>
            <button type="button" className="btn sm ghost" aria-expanded={manual} onClick={() => setManual((v) => !v)}>ปรับเอง {manual ? '▴' : '▾'}</button>
            <button type="button" className="btn sm ghost" onClick={() => fileRef.current?.click()}>เปลี่ยนไฟล์</button>
            <button type="button" className="btn sm ghost" onClick={() => void remove()}>เอาออก</button>
          </span>
          {manual && (
            <div className="pr-bk-manual">
              <span className="faint" style={{ fontSize: 12 }}>เพลงมาก่อนกลอง → กด “−” · เพลงมาช้ากว่ากลอง → กด “+”</span>
              <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                <button type="button" className="btn sm ghost" onClick={() => nudge(-0.1)} aria-label="ให้เพลงมาช้าลง 0.1 วินาที">−0.1</button>
                <button type="button" className="btn sm ghost" onClick={() => nudge(-0.01)} aria-label="ให้เพลงมาช้าลง 0.01 วินาที">−.01</button>
                <input className="num" style={{ width: 74 }} type="number" step={0.01} min={0} value={meta.offset} aria-label="วินาทีที่ห้อง 1 เริ่ม" onChange={(e) => update({ ...meta, offset: Math.max(0, Number(e.target.value) || 0) })} />
                <span className="faint" style={{ fontSize: 12 }}>วิ</span>
                <button type="button" className="btn sm ghost" onClick={() => nudge(0.01)} aria-label="ให้เพลงมาเร็วขึ้น 0.01 วินาที">+.01</button>
                <button type="button" className="btn sm ghost" onClick={() => nudge(0.1)} aria-label="ให้เพลงมาเร็วขึ้น 0.1 วินาที">+0.1</button>
              </span>
              {tapping ? (
                <>
                  <button type="button" className="btn sm primary" onClick={tapNow}>กดตอนนี้! (ห้อง 1) · {fmt(pos)}</button>
                  <button type="button" className="btn sm ghost" onClick={() => setTapping(false)}>ยกเลิก</button>
                </>
              ) : (
                <button type="button" className="btn sm ghost" disabled={playing} onClick={() => { stopPlayer(); setMsg('ฟังเพลง แล้วกดปุ่ม (หรือ Space) ตรงจังหวะแรกของห้อง 1'); setTapping(true); }}>ฟังแล้วกดตอนห้องแรก</button>
              )}
            </div>
          )}
        </>
      )}
      <input ref={fileRef} type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
      {msg && <span className="faint" style={{ fontSize: 12, flexBasis: '100%' }} role="status">{msg}</span>}
    </div>
  );
}
