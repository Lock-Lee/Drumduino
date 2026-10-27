import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { engine } from '../audio/engine';
import { GROOVES } from '../score/grooves';
import { importScoreFile } from '../score/importers';
import { Notation } from '../score/Notation';
import type { NoteMark } from '../score/Notation';
import { Player } from '../score/player';
import type { DrumsMode, Expected } from '../score/player';
import type { PadId, Score } from '../score/types';
import { PAD_LABEL } from '../score/types';
import { PlayIcon, Search, Stop, Trash, Upload } from '../components/Icons';

const IMPORTED_KEY = 'drumduino.scores.v1';
const PREFS_KEY = 'drumduino.practice.v1';

function loadJSON<T>(k: string, fb: T): T {
  try {
    const r = localStorage.getItem(k);
    return r ? (JSON.parse(r) as T) : fb;
  } catch {
    return fb;
  }
}
function saveJSON(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

type Mode = 'listen' | 'practice';
interface Prefs { mode: Mode; guide: boolean; metronome: boolean; countIn: boolean; latency: number }

const WIN = { ok: 0.04, judge: 0.15 };

interface Stats { ok: number; early: number; late: number; miss: number; extra: number; offsets: number[] }
const EMPTY_STATS: Stats = { ok: 0, early: 0, late: 0, miss: 0, extra: 0, offsets: [] };

export function PracticePage() {
  const { kit } = useStore();
  const kitRef = useRef(kit);
  kitRef.current = kit;

  const [imported, setImported] = useState<Score[]>(() => loadJSON(IMPORTED_KEY, [] as Score[]));
  useEffect(() => saveJSON(IMPORTED_KEY, imported), [imported]);
  const all = useMemo(() => [...GROOVES, ...imported], [imported]);
  const [scoreId, setScoreId] = useState(GROOVES[GROOVES.length - 1].id);
  const score = all.find((s) => s.id === scoreId) ?? GROOVES[0];

  const [prefs, setPrefs] = useState<Prefs>(() => ({ mode: 'listen', guide: false, metronome: true, countIn: true, latency: 0, ...loadJSON(PREFS_KEY, {}) }));
  useEffect(() => saveJSON(PREFS_KEY, prefs), [prefs]);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const [bpm, setBpm] = useState(score.bpm);
  const [loop, setLoop] = useState(true);
  const [range, setRange] = useState<[number, number]>([0, score.measures]);
  const [playing, setPlaying] = useState(false);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const match = (sc: Score) => {
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return [sc.title, sc.subtitle ?? '', `${sc.bpm}`, `${sc.sig[0]}/${sc.sig[1]}`, ...(sc.sections ?? []).map((x) => x.name)].some((v) => v.toLowerCase().includes(t));
  };
  const builtIn = GROOVES.filter(match);
  const mine = imported.filter(match);
  const [marks, setMarks] = useState<Map<number, NoteMark>>(new Map());
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [last, setLast] = useState<{ text: string; cls: string } | null>(null);
  const [pass, setPass] = useState(0);

  // reset when the score changes
  useEffect(() => {
    setBpm(score.bpm);
    setRange([0, score.measures]);
    setMarks(new Map());
    setStats(EMPTY_STATS);
    setLast(null);
  }, [score]);

  // ---- judging ----
  const expected = useRef<(Expected & { done: boolean })[]>([]);
  const tickRef = useRef<number | null>(null);

  const mark = useCallback((idx: number, status: NoteMark['status']) => {
    setMarks((m) => new Map(m).set(idx, { status }));
  }, []);

  const player = useMemo(
    () =>
      new Player(
        (id: PadId) => kitRef.current.pads.find((p) => p.id === id),
        (e) => expected.current.push({ ...e, done: false }),
        () => {
          setPlaying(false);
          tickRef.current = null;
        },
        (p) => {
          setPass(p);
          setMarks(new Map());
        }
      ),
    []
  );
  useEffect(() => () => player.stop(), [player]);

  // user hits → early / late / ok
  useEffect(
    () =>
      engine.onHit((padId, _v, zone, source) => {
        if (source === 'score' || !player.playing || prefsRef.current.mode !== 'practice') return;
        const t = engine.ctx.currentTime - prefsRef.current.latency / 1000;
        let best: (typeof expected.current)[number] | null = null;
        for (const e of expected.current) {
          if (e.done || e.pad !== padId) continue;
          if ((e.art === 'pedal') !== (zone === 'pedal')) continue;
          const d = Math.abs(t - e.time);
          if (d <= WIN.judge && (!best || d < Math.abs(t - best.time))) best = e;
        }
        if (!best) {
          setStats((s) => ({ ...s, extra: s.extra + 1 }));
          setLast({ text: `เกิน (${PAD_LABEL[padId as PadId] ?? padId})`, cls: 'miss' });
          return;
        }
        best.done = true;
        const diff = t - best.time;
        const ms = Math.round(diff * 1000);
        const st: NoteMark['status'] = Math.abs(diff) <= WIN.ok ? 'ok' : diff < 0 ? 'early' : 'late';
        mark(best.idx, st);
        setStats((s) => ({ ...s, [st]: s[st] + 1, offsets: [...s.offsets.slice(-199), ms] }));
        setLast(st === 'ok' ? { text: `ตรง (${ms > 0 ? '+' : ''}${ms} ms)`, cls: 'ok' } : st === 'early' ? { text: `เร็วไป ${-ms} ms`, cls: 'early' } : { text: `ช้าไป ${ms} ms`, cls: 'late' });
      }),
    [player, mark]
  );

  // misses + playhead
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loopFn = () => {
      raf = requestAnimationFrame(loopFn);
      tickRef.current = player.currentTick();
      const now = engine.ctx.currentTime - prefsRef.current.latency / 1000;
      const keep: typeof expected.current = [];
      for (const e of expected.current) {
        if (!e.done && now - e.time > WIN.judge) {
          if (prefsRef.current.mode === 'practice') {
            mark(e.idx, 'miss');
            setStats((s) => ({ ...s, miss: s.miss + 1 }));
          }
          continue;
        }
        if (!e.done || now - e.time < 1) keep.push(e);
      }
      expected.current = keep;
    };
    raf = requestAnimationFrame(loopFn);
    return () => cancelAnimationFrame(raf);
  }, [playing, player, mark]);

  const drums = (p: Prefs): DrumsMode => (p.mode === 'listen' ? 'full' : p.guide ? 'guide' : 'off');

  const start = (from = range[0]) => {
    expected.current = [];
    setMarks(new Map());
    setStats(EMPTY_STATS);
    setLast(null);
    setPass(0);
    const to = Math.max(from + 1, range[1]);
    player.start(score, { bpm, from, to, loop, countIn: prefs.countIn, metronome: prefs.metronome, drums: drums(prefs) });
    setPlaying(true);
  };
  const stop = () => {
    player.stop();
    setPlaying(false);
    tickRef.current = null;
  };

  useEffect(() => player.setBpm(bpm), [bpm, player]);
  useEffect(() => player.setOptions({ metronome: prefs.metronome, drums: drums(prefs), loop }), [prefs, loop, player]);

  // space = play/stop
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.code !== 'Space' || (t && /INPUT|SELECT|TEXTAREA|BUTTON/.test(t.tagName))) return;
      e.preventDefault();
      if (player.playing) stop();
      else start();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // notation width
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fileRef = useRef<HTMLInputElement>(null);
  const onImport = async (files: FileList | null) => {
    if (!files?.length) return;
    const ok: Score[] = [];
    const bad: string[] = [];
    for (const f of Array.from(files)) {
      try {
        ok.push(await importScoreFile(f));
      } catch (e) {
        bad.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    if (ok.length) {
      setImported((s) => [...s, ...ok]);
      setScoreId(ok[0].id);
    }
    setMsg(bad.length ? bad.join(' · ') : `นำเข้า ${ok.length} เพลงแล้ว`);
  };

  const judged = stats.ok + stats.early + stats.late + stats.miss;
  const acc = judged ? Math.round((stats.ok * 100 + (stats.early + stats.late) * 60) / judged) : null;
  const avg = stats.offsets.length ? Math.round(stats.offsets.reduce((a, b) => a + b, 0) / stats.offsets.length) : null;

  return (
    <main className="pr-page">
      <aside className="pr-list" aria-label="เลือกจังหวะหรือเพลง">
        <div className="search pr-search">
          <Search />
          <label htmlFor="prq" className="sr-only">ค้นหาจังหวะหรือเพลง</label>
          <input id="prq" type="search" placeholder="ค้นหาเพลง / จังหวะ / BPM…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {q.trim() && !builtIn.length && !mine.length && (
          <div className="pr-online">
            <span>ไม่พบ “{q.trim()}” ในแอป</span>
            <span className="faint">หาโน้ตกลองออนไลน์ แล้ว export เป็น MIDI / MusicXML มานำเข้า:</span>
            <a href={`https://www.songsterr.com/?pattern=${encodeURIComponent(q.trim())}`} target="_blank" rel="noreferrer">ค้นบน Songsterr ↗</a>
            <a href={`https://musescore.com/sheetmusic?text=${encodeURIComponent(q.trim() + ' drums')}`} target="_blank" rel="noreferrer">ค้นบน MuseScore ↗</a>
          </div>
        )}
        {builtIn.length > 0 && <span className="label" style={{ padding: '0 10px 6px' }}>จังหวะในแอป</span>}
        {builtIn.map((s) => (
          <button key={s.id} type="button" className="pr-item" aria-pressed={s.id === score.id} onClick={() => { stop(); setScoreId(s.id); }}>
            <span className="pr-t">{s.title}</span>
            <span className="pr-s">{s.bpm} BPM · {s.sig[0]}/{s.sig[1]} · {s.measures} ห้อง</span>
          </button>
        ))}
        <span className="label" style={{ padding: '12px 10px 6px' }}>นำเข้าเอง</span>
        {q.trim() && imported.length > 0 && !mine.length && <span className="faint" style={{ fontSize: 12, padding: '0 10px' }}>ไม่มีเพลงที่นำเข้าตรงกับคำค้น</span>}
        {mine.map((s) => (
          <div key={s.id} className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
            <button type="button" className="pr-item" style={{ flex: '1 1 0' }} aria-pressed={s.id === score.id} onClick={() => { stop(); setScoreId(s.id); }}>
              <span className="pr-t">{s.title}</span>
              <span className="pr-s">{s.bpm} BPM · {s.measures} ห้อง</span>
            </button>
            <button type="button" className="icon-btn sm" aria-label={'ลบ ' + s.title} onClick={() => { if (confirm(`ลบ "${s.title}"?`)) { stop(); setImported((x) => x.filter((y) => y.id !== s.id)); } }}><Trash /></button>
          </div>
        ))}
        <button type="button" className="btn sm" style={{ margin: '6px 4px' }} onClick={() => fileRef.current?.click()}><Upload /> นำเข้า MIDI / MusicXML</button>
        <input ref={fileRef} type="file" accept=".mid,.midi,.musicxml,.xml" multiple hidden onChange={(e) => { void onImport(e.target.files); e.target.value = ''; }} />
        {msg && <span className="faint" style={{ fontSize: 12, padding: '0 8px' }} role="status">{msg}</span>}
        <p className="faint" style={{ fontSize: 11.5, padding: '6px 8px', lineHeight: 1.5 }}>
          มีชีตกลองใน MuseScore / Guitar Pro? Export เป็น MIDI หรือ MusicXML แล้วนำเข้าได้เลย
        </p>
      </aside>

      <section className="pr-main">
        <div className="pr-transport">
          <button type="button" className={'btn play-btn' + (playing ? '' : ' primary')} onClick={() => (playing ? stop() : start())} aria-label={playing ? 'หยุด' : 'เล่น'}>
            {playing ? <Stop /> : <PlayIcon />} {playing ? 'หยุด' : 'เล่น'}
          </button>
          <div className="seg pr-seg" role="group" aria-label="โหมด">
            <button type="button" aria-pressed={prefs.mode === 'listen'} onClick={() => setPrefs((p) => ({ ...p, mode: 'listen' }))}>แอปตีให้ฟัง</button>
            <button type="button" aria-pressed={prefs.mode === 'practice'} onClick={() => setPrefs((p) => ({ ...p, mode: 'practice' }))}>ฉันตีเอง (ให้คะแนน)</button>
          </div>
          <div className="pr-bpm">
            <label htmlFor="bpm" className="label">ความเร็ว</label>
            <input id="bpm" type="range" min={30} max={240} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} />
            <input className="num" type="number" min={30} max={240} value={bpm} aria-label="BPM" onChange={(e) => setBpm(Math.max(30, Math.min(240, Number(e.target.value) || score.bpm)))} />
            <button type="button" className="btn sm ghost" onClick={() => setBpm(score.bpm)} title="ความเร็วเดิมของเพลง">{score.bpm}</button>
          </div>
          <div className="pr-toggles">
            <label><input type="checkbox" checked={prefs.metronome} onChange={(e) => setPrefs((p) => ({ ...p, metronome: e.target.checked }))} /> เมโทรนอม</label>
            <label><input type="checkbox" checked={prefs.countIn} onChange={(e) => setPrefs((p) => ({ ...p, countIn: e.target.checked }))} /> นับก่อนเริ่ม</label>
            {prefs.mode === 'practice' && <label><input type="checkbox" checked={prefs.guide} onChange={(e) => setPrefs((p) => ({ ...p, guide: e.target.checked }))} /> เสียงนำเบาๆ</label>}
            <label><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> วนซ้ำ</label>
            <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
              <span className="faint">ห้อง</span>
              <input className="num" style={{ width: 54 }} type="number" min={1} max={score.measures} value={range[0] + 1} aria-label="เริ่มห้อง" onChange={(e) => { const v = Math.max(1, Math.min(score.measures, Number(e.target.value) || 1)) - 1; setRange(([, b]) => [v, Math.max(v + 1, b)]); }} />
              <span className="faint">–</span>
              <input className="num" style={{ width: 54 }} type="number" min={1} max={score.measures} value={range[1]} aria-label="ถึงห้อง" onChange={(e) => { const v = Math.max(1, Math.min(score.measures, Number(e.target.value) || score.measures)); setRange(([a]) => [Math.min(a, v - 1), v]); }} />
              {(range[0] > 0 || range[1] < score.measures) && <button type="button" className="btn sm ghost" onClick={() => setRange([0, score.measures])}>ทั้งเพลง</button>}
            </span>
          </div>
        </div>

        <div className="pr-sheet-scroll">
          <div className="pr-sheet-head">
            <h2>{score.title}</h2>
            <span className="faint">{score.subtitle}{score.sections ? ' · ' + score.sections.map((s) => s.name).join(' → ') : ''}</span>
            <span className="faint" style={{ marginLeft: 'auto' }}>คลิกที่ห้องเพื่อเริ่มเล่นจากตรงนั้น</span>
          </div>
          <div ref={wrap} className="pr-sheet-wrap">
            <Notation
              score={score}
              width={w}
              tickRef={tickRef}
              marks={marks}
              activeRange={range[0] > 0 || range[1] < score.measures ? range : undefined}
              onSeek={(m) => {
                setRange(([, b]) => [m, Math.max(m + 1, b)]);
                start(m);
              }}
            />
          </div>
        </div>

        <div className="pr-stats">
          {prefs.mode === 'practice' ? (
            <>
              <div className={'pr-last ' + (last?.cls ?? '')} role="status">{last?.text ?? (playing ? 'ตีตามโน้ตได้เลย' : 'กดเล่น แล้วตีตามโน้ต (หรือกดคีย์บอร์ด)')}</div>
              <div className="pr-score"><b>{acc ?? '—'}</b><span>%</span></div>
              <div className="pr-counts">
                <span className="c ok">ตรง {stats.ok}</span>
                <span className="c early">เร็ว {stats.early}</span>
                <span className="c late">ช้า {stats.late}</span>
                <span className="c miss">พลาด {stats.miss}</span>
                <span className="c">เกิน {stats.extra}</span>
                {avg !== null && <span className="c">เฉลี่ย {avg > 0 ? '+' : ''}{avg} ms</span>}
                {loop && pass > 0 && <span className="c">รอบที่ {pass + 1}</span>}
              </div>
              <div className="pr-lat">
                <label htmlFor="lat" className="label">ชดเชยดีเลย์</label>
                <input id="lat" type="range" min={0} max={150} value={prefs.latency} onChange={(e) => setPrefs((p) => ({ ...p, latency: Number(e.target.value) }))} />
                <span className="mono" style={{ fontSize: 12 }}>{prefs.latency} ms</span>
              </div>
            </>
          ) : (
            <div className="faint" style={{ fontSize: 13 }}>
              โหมดฟัง: แอปตีตามโน้ตด้วยชุดกลอง “{kit.name}” · Space = เล่น/หยุด · สลับเป็น “ฉันตีเอง” เพื่อฝึกและดูคะแนน
              <span className="legend"><span className="mark ok" /> ตรง <span className="mark early" /> เร็ว <span className="mark late" /> ช้า <span className="mark miss" /> พลาด</span>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

