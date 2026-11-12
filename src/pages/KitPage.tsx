import { useEffect, useRef, useState } from 'react';
import type { DragEvent, PointerEvent as RPointerEvent } from 'react';
import { useStore } from '../store';
import { useHardware } from '../input/hardware';
import { engine } from '../audio/engine';
import type { Pad, PlayMode, SampleField, Zone } from '../types';
import { HH_HALF, HH_OPEN } from '../types';
import { CHANNEL_COUNT, PIN_LABELS } from '../types';
import { SOURCE_LABELS } from '../kits';
import { Close, Down, Move, Plus, PlayIcon, Trash, Up } from '../components/Icons';

import { t } from '../i18n';

const MODES: { id: PlayMode; label: string; help: string }[] = [
  { id: 'vel', label: t("ตามแรงตี"), help: t("ตีเบาจะเล่นไฟล์แรก ตีแรงจะเล่นไฟล์ท้าย") },
  { id: 'rr', label: t("ตามลำดับ"), help: t("ตีแต่ละครั้งจะเล่นไฟล์ถัดไป") },
  { id: 'rand', label: t("สุ่ม"), help: t("สุ่มเลือกไฟล์ทุกครั้งที่ตี") }
];

const STAGE_RATIO = 16 / 10;

function rangeFor(mode: PlayMode, i: number, n: number) {
  if (mode === 'vel') {
    const lo = Math.round((i * 127) / n) + 1;
    const hi = Math.round(((i + 1) * 127) / n);
    return { label: `${lo}–${hi}`, left: (lo / 127) * 100, width: ((hi - lo + 1) / 127) * 100 };
  }
  if (mode === 'rr') return { label: t("รอบ {0}", i + 1), left: (i / n) * 100, width: 100 / n };
  return { label: `${Math.round(100 / n)}%`, left: 0, width: 100 / n };
}

/** Largest 16:10 box that fits inside the element. */
function useFitBox(ref: React.RefObject<HTMLElement>) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      const w = Math.min(width, height * STAGE_RATIO);
      setBox({ w: Math.floor(w), h: Math.floor(w / STAGE_RATIO) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return box;
}

export function KitPage({ goLibrary }: { goLibrary: () => void }) {
  const store = useStore();
  const hw = useHardware();
  const { kit, selectedId, select, updatePad } = store;
  const [arrange, setArrange] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const box = useFitBox(wrapRef);

  const sel = kit.pads.find((p) => p.id === selectedId) ?? kit.pads[0];

  const onPadDown = (e: RPointerEvent<HTMLButtonElement>, p: Pad) => {
    if (!arrange) {
      select(p.id);
      engine.play(p, 100, 'ui', e.altKey ? 'rim' : 'head');
      return;
    }
    const r = stageRef.current!.getBoundingClientRect();
    drag.current = { id: p.id, dx: ((e.clientX - r.left) / r.width) * 100 - p.x, dy: ((e.clientY - r.top) / r.height) * 100 - p.y };
    select(p.id);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPadMove = (e: RPointerEvent<HTMLButtonElement>, p: Pad) => {
    const d = drag.current;
    if (!d || d.id !== p.id) return;
    const r = stageRef.current!.getBoundingClientRect();
    const hPct = (p.w * r.width) / r.height;
    const x = Math.max(0, Math.min(100 - p.w, ((e.clientX - r.left) / r.width) * 100 - d.dx));
    const y = Math.max(0, Math.min(100 - hPct, ((e.clientY - r.top) / r.height) * 100 - d.dy));
    updatePad(p.id, { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  };

  return (
    <main className="kit-page">
      <section className="kit-main" aria-label={t("ชุดกลอง")}>
        <div className="kit-bar">
          <label htmlFor="kitsel" className="sr-only">{t("ชุดกลอง")}</label>
          <select id="kitsel" className="input kit-select" value={kit.id} onChange={(e) => store.selectKit(e.target.value)}>
            <optgroup label={t("ชุดกลองในแอป")}>
              {store.kits.filter((k) => k.presetId).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </optgroup>
            {store.kits.some((k) => !k.presetId) && (
              <optgroup label={t("ชุดของฉัน")}>
                {store.kits.filter((k) => !k.presetId).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </optgroup>
            )}
          </select>
          {!store.preset && (
            <>
              <label htmlFor="kitname" className="sr-only">{t("ชื่อชุด")}</label>
              <input id="kitname" className="input" style={{ width: 180, minHeight: 40 }} value={kit.name} onChange={(e) => store.setKitName(e.target.value)} />
            </>
          )}
          <div className="kit-desc" title={store.preset ? `${store.preset.description} · ${store.preset.credit}` : ''}>
            {store.kitLoading ? t("กำลังโหลดเสียง…") : store.preset ? store.preset.description : t("ชุดที่คุณสร้างเอง แอปจะบันทึกให้อัตโนมัติ")}
            {store.preset && <span className="faint"> · {store.preset.credit}</span>}
          </div>
          <div className="kit-actions">
            <button type="button" className="btn sm" onClick={store.duplicateKit} title={t("ทำสำเนาเป็นชุดของฉัน")}>{t("ทำสำเนา")}</button>
            {store.preset ? (
              <button type="button" className="btn sm ghost" onClick={() => { if (confirm(t("คืนค่าเสียงของ \"{0}\" เป็นค่าเริ่มต้นหรือไม่?", kit.name))) store.resetKitSounds(); }}>{t("คืนค่าเดิม")}</button>
            ) : (
              <button type="button" className="btn sm ghost danger" onClick={() => { if (confirm(t("ลบชุด \"{0}\"?", kit.name))) store.deleteKit(kit.id); }}><Trash />  {t("ลบชุด")}</button>
            )}
            <span className="vsep" aria-hidden="true" />
            <button type="button" className={'btn sm' + (arrange ? ' outline' : '')} aria-pressed={arrange} onClick={() => setArrange((a) => !a)}>
              <Move /> {arrange ? t("เสร็จแล้ว") : t("จัดตำแหน่ง")}
            </button>
            <button type="button" className="btn sm" onClick={store.addPad}><Plus />  {t("เพิ่มชิ้นกลอง")}</button>
            <button type="button" className="btn sm ghost" onClick={store.exportKit}>{t("ส่งออกไฟล์")}</button>
          </div>
        </div>

        <div className="stage-wrap" ref={wrapRef}>
          <div
            ref={stageRef}
            className={'stage' + (arrange ? ' arrange' : '')}
            style={{ width: box.w, height: box.h, ['--sw' as string]: box.w + 'px' }}
          >
            <span className="stage-hint">
              {arrange
                ? t("ลากชิ้นกลองเพื่อย้ายตำแหน่ง")
                : t("คลิกที่กลองหรือกดแป้นตามตัวอักษรเพื่อตี  กด Shift ค้างเพื่อตีเบา, Option เพื่อตีขอบ, X ค้างเพื่อเปิดไฮแฮท และ Z เพื่อเหยียบแป้น")}
            </span>
            {kit.pads.map((p) => {
              const on = p.id === sel?.id;
              const dual = p.rimChannel >= 0;
              const pins = (p.channel >= 0 ? PIN_LABELS[p.channel] : '—') + (dual ? '+' + PIN_LABELS[p.rimChannel] : '');
              return (
                <button
                  key={p.id}
                  type="button"
                  className={'pad' + (p.cymbal ? ' cym' : '') + (on ? ' sel' : '') + (hw.flash[p.id] ? ' hit' : '') + (hw.rimFlash[p.id] ? ' rimhit' : '') + (dual ? ' dual' : '')}
                  style={{ left: p.x + '%', top: p.y + '%', width: p.w + '%' }}
                  aria-pressed={on}
                  aria-label={`${p.name} ${t(p.th)}, ${p.channel >= 0 ? t("ขา ") + pins : t("ยังไม่ต่อขา")}${dual ? t(", ตีขอบได้") : ''}`}
                  onPointerDown={(e) => onPadDown(e, p)}
                  onPointerMove={(e) => onPadMove(e, p)}
                  onPointerUp={() => (drag.current = null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      select(p.id);
                      engine.play(p, 100, 'ui', e.altKey ? 'rim' : 'head');
                    }
                  }}
                >
                  {p.key && <span className="k">{p.key}</span>}
                  <span className="n">{p.name}</span>
                  <span className="t">{t(p.th)}</span>
                  <span className="m">{pins}</span>
                  {isHatPad(p) && <span className="hat-dot" style={{ ['--o' as string]: hw.pedal[p.id] ?? 0 }} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="meter-strip" aria-label={t("สัญญาณเข้า A0–A15")}>
          {Array.from({ length: CHANNEL_COUNT }, (_, ch) => {
            const head = kit.pads.find((x) => x.channel === ch);
            const rimOf = head ? undefined : kit.pads.find((x) => x.rimChannel === ch);
            const v = head ? hw.padLevels[head.id] ?? 0 : hw.channelLevels[ch];
            const live = head ? !!hw.flash[head.id] : rimOf ? !!hw.rimFlash[rimOf.id] : false;
            const name = head ? head.name : rimOf ? rimOf.name + t(" ขอบ") : '';
            return (
              <div className={'ms' + (head || rimOf ? '' : ' off')} key={ch} title={`${PIN_LABELS[ch]} ${name} · ${v}`}>
                <div className="ms-bar"><div className={'ms-fill' + (live ? ' live' : '')} style={{ height: (v / 127) * 100 + '%' }} /></div>
                <span className="ms-pin mono">{PIN_LABELS[ch]}</span>
                <span className="ms-name">{name || '—'}</span>
              </div>
            );
          })}
        </div>
      </section>

      {sel && <PadPanel key={sel.id} pad={sel} goLibrary={goLibrary} />}
    </main>
  );
}

type Tab = 'head' | 'rim' | 'hat' | 'setup';

const isHatPad = (p: Pad) => p.pedalChannel >= 0 || p.id === 'hihat' || p.halfSamples.length > 0 || p.openSamples.length > 0 || p.chickSamples.length > 0;

function PadPanel({ pad, goLibrary }: { pad: Pad; goLibrary: () => void }) {
  const store = useStore();
  const { kit, updatePad } = store;
  const [tab, setTab] = useState<Tab>(isHatPad(pad) ? 'hat' : 'head');
  const usedBy = new Map<number, string>();
  for (const p of kit.pads) {
    if (p.id === pad.id) continue;
    if (p.channel >= 0) usedBy.set(p.channel, p.name);
    if (p.rimChannel >= 0) usedBy.set(p.rimChannel, p.name + t(" ขอบ"));
  }
  const pinOptions = (exclude: number) =>
    PIN_LABELS.map((l, i) => (i === exclude ? null : <option key={l} value={i}>{l}{usedBy.has(i) ? ` · ${usedBy.get(i)}` : ''}</option>));

  const isHat = isHatPad(pad);
  const tabs: { id: Tab; label: string }[] = [
    { id: 'head', label: `${isHat ? t("ไฮแฮทปิด") : t("เสียงหนัง")} ${pad.samples.length}` },
    ...(isHat ? [{ id: 'hat' as Tab, label: t("แป้นไฮแฮท") }] : []),
    { id: 'rim', label: t("เสียงขอบ {0}", pad.rimSamples.length) },
    { id: 'setup', label: t("ตั้งค่า") }
  ];

  return (
    <aside className="panel" aria-label={t("ตั้งค่าชิ้นกลองที่เลือก")}>
      <div className="panel-head">
        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
          <label className="sr-only" htmlFor="padname">{t("ชื่อชิ้นกลอง")}</label>
          <input id="padname" className="pad-title" value={pad.name} onChange={(e) => updatePad(pad.id, { name: e.target.value })} />
          <button type="button" className="btn sm outline" onClick={() => engine.play(pad, 100, 'ui', 'head')} title={t("ทดสอบตีหนัง")}><PlayIcon />  {t("หนัง")}</button>
          <button type="button" className="btn sm outline" onClick={() => engine.play(pad, 115, 'ui', 'rim')} title={t("ทดสอบตีขอบ")}><PlayIcon />  {t("ขอบ")}</button>
        </div>
        <div className="pin-row">
          <div className="field">
            <label htmlFor="pin" className="label">{t("ขาหนัง")}</label>
            <select id="pin" className="input sm" value={pad.channel} onChange={(e) => updatePad(pad.id, { channel: Number(e.target.value) })}>
              <option value={-1}>{t("ไม่ได้ต่อ")}</option>
              {pinOptions(pad.rimChannel)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rimpin" className="label">{t("ขาขอบ")}</label>
            <select id="rimpin" className="input sm" value={pad.rimChannel} onChange={(e) => updatePad(pad.id, { rimChannel: Number(e.target.value) })}>
              <option value={-1}>{t("ไม่มี")}</option>
              {pinOptions(pad.channel)}
            </select>
          </div>
          <div className="field">
            <span id="modeL" className="label">{t("การเล่นหลายไฟล์")}</span>
            <select aria-labelledby="modeL" className="input sm" value={pad.mode} onChange={(e) => updatePad(pad.id, { mode: e.target.value as PlayMode })} title={MODES.find((m) => m.id === pad.mode)?.help}>
              {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        </div>
        <div className="tabs" role="tablist" aria-label={t("ส่วนของชิ้นกลอง")}>
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" id={'tab-' + t.id} aria-selected={tab === t.id} aria-controls="panel-body" onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-body" id="panel-body" role="tabpanel" aria-labelledby={'tab-' + tab}>
        {tab === 'head' && <SoundList pad={pad} field="samples" zone="head" goLibrary={goLibrary} title={isHat ? t("เสียงตีตอนปิด") : undefined} />}
        {tab === 'rim' && (
          <>
            {pad.rimChannel < 0 && (
              <p className="note" style={{ margin: 0 }}>{t("ชิ้นกลองนี้ยังรับสัญญาณได้โซนเดียว เมื่อติด piezo ที่ขอบแล้ว ให้ตั้งค่า “ขาขอบ” ด้านบน (ระหว่างนี้ลองฟังเสียงขอบได้โดยกด Option พร้อมตัวอักษรของกลอง)")}</p>
            )}
            <SoundList pad={pad} field="rimSamples" zone="rim" goLibrary={goLibrary} />
          </>
        )}
        {tab === 'hat' && <HatPedal pad={pad} />}
        {tab === 'setup' && <Setup pad={pad} />}
      </div>
    </aside>
  );
}

function HatPedal({ pad }: { pad: Pad }) {
  const { kit, updatePad } = useStore();
  const hw = useHardware();
  const o = hw.pedal[pad.id] ?? 0;
  const state = o >= HH_OPEN ? t("เปิด") : o >= HH_HALF ? t("ครึ่งเปิด") : t("ปิด");
  const raw = pad.pedalChannel >= 0 ? hw.pedalRaw[pad.pedalChannel] : undefined;
  const usedBy = new Map<number, string>();
  for (const p of kit.pads) {
    if (p.channel >= 0) usedBy.set(p.channel, p.name);
    if (p.rimChannel >= 0) usedBy.set(p.rimChannel, p.name + t(" ขอบ"));
    if (p.pedalChannel >= 0 && p.id !== pad.id) usedBy.set(p.pedalChannel, p.name + t(" แป้น"));
  }
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="hat-meter" aria-label={t("แป้นไฮแฮท: {0}", state)}>
        <div className="hat-track">
          <div className="hat-zone" style={{ left: 0, width: HH_HALF * 100 + '%' }}>{t("ปิด")}</div>
          <div className="hat-zone" style={{ left: HH_HALF * 100 + '%', width: (HH_OPEN - HH_HALF) * 100 + '%' }}>{t("ครึ่งเปิด")}</div>
          <div className="hat-zone" style={{ left: HH_OPEN * 100 + '%', width: (1 - HH_OPEN) * 100 + '%' }}>{t("เปิด")}</div>
          <div className="hat-needle" style={{ left: o * 100 + '%' }} />
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="faint" style={{ fontSize: 12 }}>{t("เหยียบสุด")}</span>
          <b style={{ color: 'var(--accent)', fontSize: 13 }}>{state}</b>
          <span className="faint" style={{ fontSize: 12 }}>{t("ปล่อยสุด")}</span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="pedsim" className="label">{t("ลองขยับแป้นได้โดยไม่ต้องมีฮาร์ดแวร์ หรือกด X ค้างเพื่อเปิด ปล่อยเพื่อปิด และกด Z เพื่อเหยียบ")}</label>
        <input id="pedsim" type="range" min={0} max={100} value={Math.round(o * 100)} onChange={(e) => hw.setPedalUI(pad.id, Number(e.target.value) / 100)} />
      </div>

      <div className="grid3" style={{ alignItems: 'end' }}>
        <div className="field">
          <label htmlFor="pedpin" className="label">{t("ขาแป้น")}</label>
          <select id="pedpin" className="input sm" value={pad.pedalChannel} onChange={(e) => updatePad(pad.id, { pedalChannel: Number(e.target.value) })}>
            <option value={-1}>{t("ไม่มี")}</option>
            {PIN_LABELS.map((l, i) => <option key={l} value={i}>{l}{usedBy.has(i) ? ` · ${usedBy.get(i)}` : ''}</option>)}
          </select>
        </div>
        <button type="button" className="btn sm" disabled={raw === undefined} onClick={() => raw !== undefined && updatePad(pad.id, { pedalClosed: raw })} title={t("เหยียบแป้นสุดแล้วกด")}>{t("ตั้งจุดปิด")}</button>
        <button type="button" className="btn sm" disabled={raw === undefined} onClick={() => raw !== undefined && updatePad(pad.id, { pedalOpen: raw })} title={t("ปล่อยแป้นสุดแล้วกด")}>{t("ตั้งจุดเปิด")}</button>
      </div>
      {pad.pedalChannel >= 0 && (
        <span className="faint mono" style={{ fontSize: 12 }}>
          
          {t("ค่าจากเซนเซอร์ขณะนี้")} {raw ?? t("(ยังไม่ได้รับสัญญาณ)")}{t(", จุดปิด")} {pad.pedalClosed}{t(", จุดเปิด")} {pad.pedalOpen}
        </span>
      )}

      <SoundList pad={pad} field="halfSamples" zone="head" title={t("เสียงตีตอนครึ่งเปิด")} emptyText={t("ยังไม่มีเสียง แอปจะใช้เสียงตอนปิดแทน")} />
      <SoundList pad={pad} field="openSamples" zone="head" title={t("เสียงตีตอนเปิด")} emptyText={t("ยังไม่มีเสียง แอปจะใช้เสียงตอนครึ่งเปิดหรือตอนปิดแทน")} />
      <SoundList pad={pad} field="chickSamples" zone="pedal" title={t("เสียงเหยียบแป้น (chick)")} emptyText={t("ยังไม่มีเสียง เมื่อเหยียบแป้นจะไม่มีเสียง")} />
    </div>
  );
}

function Setup({ pad }: { pad: Pad }) {
  const store = useStore();
  const { updatePad } = store;
  const slider = (id: string, label: string, value: number, min: number, max: number, unit: string, on: (v: number) => void, step = 1) => (
    <div className="field">
      <div className="slider-row"><label htmlFor={id}>{label}</label><span className="mono" style={{ fontSize: 13 }}>{value}{unit}</span></div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => on(Number(e.target.value))} />
    </div>
  );
  return (
    <div className="stack" style={{ gap: 14 }}>
      {slider('vol', t("ความดัง"), pad.volume, 0, 100, '%', (v) => updatePad(pad.id, { volume: v }))}
      {slider('pitch', t("ระดับเสียงสูงต่ำ (Pitch)"), pad.pitch, -12, 12, ' st', (v) => updatePad(pad.id, { pitch: v }))}
      <div className="field">
        <span className="label">{t("แต่งเสียง (EQ): ทุ้มคือตัวเสียง กลางคือเสียงอู้ แหลมคือหัวเสียง")}</span>
        <div className="grid3">
          {([['low', t("ทุ้ม")], ['mid', t("กลาง")], ['high', t("แหลม")]] as const).map(([k, l]) => {
            const t = pad.tone ?? { low: 0, mid: 0, high: 0 };
            return <div key={k}>{slider('tone-' + k, l, t[k], -12, 12, ' dB', (v) => updatePad(pad.id, { tone: { ...t, [k]: v } }))}</div>;
          })}
        </div>
      </div>
      {slider('sens', t("ความไวเซนเซอร์"), pad.sensitivity, 1, 100, '', (v) => updatePad(pad.id, { sensitivity: v }))}
      {pad.rimChannel >= 0 && slider('rimratio', t("นับเป็นตีขอบเมื่อแรงที่ขอบ ≥ แรงที่หนัง ×"), pad.rimRatio, 20, 300, '%', (v) => updatePad(pad.id, { rimRatio: v }), 5)}
      <div className="grid3">
        <div className="field">
          <label htmlFor="th" className="label">{t("ชื่อภาษาไทย")}</label>
          <input id="th" className="input sm" value={pad.th} onChange={(e) => updatePad(pad.id, { th: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="key" className="label">{t("คีย์ทดสอบ")}</label>
          <input id="key" className="input sm mono" value={pad.key} onChange={(e) => updatePad(pad.id, { key: e.target.value.toLowerCase().slice(-1) })} />
        </div>
        <div className="field">
          <label htmlFor="size" className="label">{t("ขนาดบนหน้าจอ")}</label>
          <input id="size" type="range" min={8} max={30} value={pad.w} onChange={(e) => updatePad(pad.id, { w: Number(e.target.value) })} />
        </div>
        <div className="field">
          <label htmlFor="note" className="label">{t("โน้ต MIDI")}</label>
          <input id="note" className="input sm mono" type="number" min={0} max={127} value={pad.midiNote} onChange={(e) => updatePad(pad.id, { midiNote: Math.max(0, Math.min(127, Number(e.target.value))) })} />
        </div>
        <div className="field">
          <label htmlFor="rnote" className="label">{t("โน้ตขอบ")}</label>
          <input id="rnote" className="input sm mono" type="number" min={0} max={127} value={pad.rimNote} onChange={(e) => updatePad(pad.id, { rimNote: Math.max(0, Math.min(127, Number(e.target.value))) })} />
        </div>
        <label className="field" style={{ justifyContent: 'flex-end' }}>
          <span className="row" style={{ gap: 8, minHeight: 36 }}>
            <input type="checkbox" checked={pad.cymbal} onChange={(e) => updatePad(pad.id, { cymbal: e.target.checked })} />  {t("แสดงเป็นฉาบ")}
          </span>
        </label>
      </div>
      <button type="button" className="btn sm ghost danger" style={{ alignSelf: 'flex-start' }} onClick={() => { if (confirm(t("ลบ \"{0}\" ออกจากชุดกลองหรือไม่?", pad.name))) store.removePad(pad.id); }}>
        <Trash />  {t("ลบชิ้นกลองนี้")}
      </button>
    </div>
  );
}

function SoundList({ pad, field, zone, goLibrary, title, emptyText }: { pad: Pad; field: SampleField; zone: Zone; goLibrary?: () => void; title?: string; emptyText?: string }) {
  const store = useStore();
  const { samples, updatePad } = store;
  const [over, setOver] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const key = field;
  const list = pad[key];
  const n = list.length;
  const nameOf = (id: string) => samples.find((s) => s.id === id)?.name ?? t("(ไฟล์หาย)");
  const set = (next: string[]) => updatePad(pad.id, { [key]: next });

  const doImport = async (files: FileList | File[]) => {
    const res = await store.importFiles(files, pad.id, field);
    setMsg((res.ok ? t("เพิ่ม {0} ไฟล์แล้ว", res.ok) : '') + (res.failed.length ? t("{0}เปิดไม่ได้: {1}", res.ok ? ' · ' : '', res.failed.join(', ')) : ''));
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= n) return;
    const next = list.slice();
    [next[i], next[j]] = [next[j], next[i]];
    set(next);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) void doImport(e.dataTransfer.files);
  };
  const idp = field + '-' + pad.id;

  return (
    <div
      className={'stack sound-zone' + (over ? ' over' : '')}
      style={{ gap: 8 }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      {title && (
        <div className="row" style={{ gap: 8 }}>
          <h3 style={{ fontSize: 14 }}>{title}</h3>
          <span className="mono faint" style={{ fontSize: 12 }}>{n}</span>
          <div className="spacer" />
          <button type="button" className="btn sm ghost" onClick={() => list[0] && engine.preview(list[list.length - 1], () => undefined)} disabled={!n}><PlayIcon />  {t("ฟัง")}</button>
        </div>
      )}
      {n === 0 ? (
        <p className="empty">{emptyText ?? (zone === 'rim' ? t("ยังไม่มีเสียงขอบ เมื่อตีขอบแอปจะใช้เสียงหนังแทน") : t("ยังไม่มีเสียง กรุณาเพิ่มอย่างน้อย 1 ไฟล์"))}</p>
      ) : (
        <ul className="sound-list">
          {list.map((id, i) => {
            const r = rangeFor(pad.mode, i, n);
            return (
              <li className="sound" key={id + i}>
                <button type="button" className="icon-btn sm" aria-label={t("ฟัง ") + nameOf(id)} onClick={() => engine.preview(id, () => undefined)}><PlayIcon /></button>
                <div className="info">
                  <span className="fname" title={nameOf(id)}>{nameOf(id)}</span>
                  <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <div className="range-bar"><span style={{ left: r.left + '%', width: Math.max(3, r.width) + '%' }} /></div>
                    <span className="mono faint" style={{ fontSize: 11, whiteSpace: 'nowrap', minWidth: 46, textAlign: 'right' }}>{r.label}</span>
                  </div>
                </div>
                <button type="button" className="icon-btn sm" aria-label={t("เลื่อนขึ้น ") + nameOf(id)} disabled={i === 0} onClick={() => move(i, -1)}><Up /></button>
                <button type="button" className="icon-btn sm" aria-label={t("เลื่อนลง ") + nameOf(id)} disabled={i === n - 1} onClick={() => move(i, 1)}><Down /></button>
                <button type="button" className="icon-btn sm" aria-label={t("เอาออก ") + nameOf(id)} onClick={() => set(list.filter((_, k) => k !== i))}><Close /></button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="row add-row">
        <label htmlFor={'lib-' + idp} className="sr-only">{t("เพิ่มจากคลังเสียง")}</label>
        <select id={'lib-' + idp} className="input sm" value="" onChange={(e) => e.target.value && set([...list, e.target.value])}>
          <option value="">{t("+ เลือกเสียงจากคลัง…")}</option>
          {Object.entries(SOURCE_LABELS).map(([src, label]) => (
            <optgroup key={src} label={label}>
              {samples.filter((s) => s.source === src).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
          ))}
        </select>
        <button type="button" className="btn sm primary" onClick={() => fileRef.current?.click()}><Plus />  {t("เพิ่มไฟล์")}</button>
        <input ref={fileRef} type="file" accept="audio/*,.wav,.mp3,.ogg,.flac,.aif,.aiff" multiple hidden onChange={(e) => { if (e.target.files) void doImport(e.target.files); e.target.value = ''; }} />
      </div>
      {goLibrary && (
        <span className="faint" style={{ fontSize: 12 }}>
          
          {t("ลากไฟล์ .wav หรือ .mp3 มาวางในกรอบนี้ได้ หรือ")} <button type="button" className="linkish" onClick={goLibrary}>{t("เปิดคลังเสียง")}</button>
        </span>
      )}
      {msg && <span className="muted" style={{ fontSize: 13 }} role="status">{msg}</span>}
    </div>
  );
}
