import { useStore } from '../store';
import { useHardware } from '../input/hardware';
import { CHANNEL_COUNT, PIN_LABELS, sensitivityToThreshold } from '../types';

import { t } from '../i18n';

export function HardwarePage() {
  const { kit, updatePad, resetLayout } = useStore();
  const hw = useHardware();
  const boardChannels = hw.boardInfo ? parseInt(hw.boardInfo.split(' ')[2] ?? '', 10) : NaN;

  return (
    <main className="hw-page">
      <div className="hw-side">
        <section className="card stack" aria-labelledby="connH">
          <h2 id="connH" style={{ fontSize: 19 }}>{t("การเชื่อมต่อ")}</h2>

          <div className="stack" style={{ gap: 8 }}>
            <span id="modeL" className="label">{t("ช่องทางรับสัญญาณ")}</span>
            <div className="seg" role="group" aria-labelledby="modeL" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              <button type="button" aria-pressed={hw.mode === 'serial'} onClick={() => hw.setMode('serial')}>USB Serial</button>
              <button type="button" aria-pressed={hw.mode === 'midi'} onClick={() => hw.setMode('midi')}>USB MIDI</button>
            </div>
            <span className="faint" style={{ fontSize: 13 }}>
              {hw.mode === 'serial'
                ? t("ใช้ได้กับทุกบอร์ด (Mega, Nano, Uno, Leonardo) และปรับความไว เวลา และการตีขอบจากแอปได้")
                : t("สำหรับบอร์ด Leonardo หรือ Pro Micro ที่ลงเฟิร์มแวร์แบบ MIDI ซึ่งใช้กับโปรแกรมดนตรีอื่นได้ด้วย")}
            </span>
          </div>

          {hw.mode === 'serial' ? (
            <>
              {!hw.serialSupported && <div className="alert">{t("ระบบนี้ไม่รองรับการเชื่อมต่อแบบ Serial กรุณาใช้แอป DrumDuino หรือเบราว์เซอร์ Chrome หรือ Edge")}</div>}
              <div className="row">
                {hw.serialStatus === 'connected' ? (
                  <button type="button" className="btn" onClick={() => void hw.disconnectSerial()}>{t("ตัดการเชื่อมต่อ")}</button>
                ) : (
                  <button type="button" className="btn primary" disabled={!hw.serialSupported || hw.serialStatus === 'connecting'} onClick={() => void hw.connectSerial()}>
                    {hw.serialStatus === 'connecting' ? t("กำลังเชื่อมต่อ…") : t("เชื่อมต่อ Arduino")}
                  </button>
                )}
              </div>
              <div className="note">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{t("สถานะ")}</span>
                  <span className="mono" style={{ color: hw.serialStatus === 'connected' ? 'var(--ok)' : 'var(--muted)' }}>
                    {hw.serialStatus === 'connected' ? t("เชื่อมต่อแล้ว") : hw.serialStatus === 'connecting' ? t("กำลังเชื่อมต่อ") : t("ไม่ได้เชื่อมต่อ")}
                  </span>
                </div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{t("เฟิร์มแวร์")}</span>
                  <span className="mono">{hw.boardInfo || (hw.serialStatus === 'connected' ? t("กำลังรอข้อมูลจากบอร์ด…") : '—')}</span>
                </div>
                {Number.isFinite(boardChannels) && (
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span>{t("จำนวนช่องของบอร์ด")}</span>
                    <span className="mono">{boardChannels}  {t("ช่อง")}</span>
                  </div>
                )}
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{t("ความเร็ว")}</span>
                  <span className="mono">115200 baud</span>
                </div>
              </div>
            </>
          ) : (
            <>
              {!hw.midiSupported && <div className="alert">{t("ระบบนี้ไม่รองรับ MIDI")}</div>}
              <div className="field">
                <label htmlFor="midiIn" className="label">{t("อุปกรณ์ MIDI")}</label>
                <select id="midiIn" className="input" value={hw.midiInputId} onChange={(e) => hw.setMidiInput(e.target.value)}>
                  {hw.midiInputs.length === 0 && <option value="">{t("ไม่พบอุปกรณ์ MIDI")}</option>}
                  {hw.midiInputs.map((i) => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </select>
              </div>
              <div className="note">{t("ในโหมด MIDI แอปจะจับคู่ชิ้นกลองจาก “โน้ต MIDI” ที่ตั้งไว้ในหน้าชุดกลอง ส่วนความไวของเซนเซอร์ต้องตั้งในเฟิร์มแวร์")}</div>
            </>
          )}
          {hw.error && <div className="alert" role="alert">{hw.error}</div>}
        </section>

        <section className="card stack" aria-labelledby="fwH">
          <h2 id="fwH" style={{ fontSize: 19 }}>{t("วิธีลงเฟิร์มแวร์")}</h2>
          <ol className="steps">
            <li>{t("ติดตั้ง")} <a href="https://www.arduino.cc/en/software" target="_blank" rel="noreferrer">Arduino IDE</a></li>
            <li>{t("เปิดไฟล์")} <code>firmware/DrumDuino/DrumDuino.ino</code>  {t("ในโฟลเดอร์โปรเจกต์")}</li>
            <li>{t("หากใช้บอร์ด Leonardo หรือ Pro Micro ให้ติดตั้งไลบรารี")} <code>MIDIUSB</code>  {t("จาก Library Manager")}</li>
            <li>{t("เลือกบอร์ดและพอร์ต แล้วกด Upload")}</li>
            <li>{t("ปิดหน้าต่าง Serial Monitor ใน Arduino IDE ก่อนเชื่อมต่อกับแอปนี้")}</li>
          </ol>
        </section>

        <section className="card stack" aria-labelledby="wireH">
          <h2 id="wireH" style={{ fontSize: 19 }}>{t("วิธีต่อสาย")}</h2>
          <ol className="steps">
            <li>{t("ต่อขาบวก (สายแดง) ของ piezo เข้ากับขาอนาล็อกของชิ้นกลองนั้น (บอร์ด Mega มีขา A0–A15)")}</li>
            <li>{t("ต่อขาลบ (สายดำ) ของ piezo เข้ากับ GND")}</li>
            <li>{t("ใส่ตัวต้านทาน 1 MΩ คร่อมระหว่างขาอนาล็อกกับ GND ทุกช่อง")}</li>
            <li>{t("แนะนำให้ใส่ไดโอดซีเนอร์ 5.1V คร่อมเพิ่มอีกตัว เพื่อป้องกันแรงดันเกินเมื่อตีแรง")}</li>
          </ol>
          <h3 style={{ fontSize: 15 }}>{t("กลองที่ตีขอบได้ (dual-zone)")}</h3>
          <ol className="steps">
            <li>{t("ติด piezo ตัวที่ 1 ไว้ใต้หนังกลองบริเวณกลาง แล้วต่อเข้าขาหนัง")}</li>
            <li>{t("ติด piezo ตัวที่ 2 ไว้ที่ขอบหรือตัวถัง โดยรองด้วยโฟมบาง ๆ แล้วต่อเข้าขาขอบ (เช่น A8)")}</li>
            <li>{t("ในหน้าชุดกลอง ให้เลือกชิ้นกลองนั้น แล้วตั้งค่า “ขาขอบ”")}</li>
            <li>{t("ลองตีหนังและตีขอบสลับกัน แล้วปรับค่าเปอร์เซ็นต์การตีขอบจนแอปแยกได้ถูกต้อง")}</li>
          </ol>
          <h3 style={{ fontSize: 15 }}>{t("แป้นไฮแฮท")}</h3>
          <ol className="steps">
            <li>{t("ใช้ตัวต้านทานปรับค่า (pot) 10 kΩ โดยต่อขาด้านข้างเข้ากับ 5V และ GND แล้วต่อขากลางเข้ากับขาอนาล็อก (เช่น A9)")}</li>
            <li>{t("หรือใช้เซนเซอร์แรงกด (FSR) โดยต่อ FSR ระหว่าง 5V กับขาอนาล็อก และใส่ตัวต้านทาน 10 kΩ จากขานั้นลง GND")}</li>
            <li>{t("ขาของแป้น")}<b>{t("ไม่ต้อง")}</b>  {t("ใส่ตัวต้านทาน 1 MΩ")}</li>
            <li>{t("เลือกไฮแฮท แล้วเปิดแท็บ “แป้นไฮแฮท” ตั้งค่าขาแป้น จากนั้นเหยียบแป้นจนสุดแล้วกด “ตั้งจุดปิด” และปล่อยแป้นจนสุดแล้วกด “ตั้งจุดเปิด”")}</li>
          </ol>
          <div className="note">{t("บอร์ด Mega มี 16 ขา (A0–A15) Nano มี 8 ขา และ Uno มี 6 ขา ขาที่ไม่ได้ตั้งค่าในแอปจะถูกปิดไว้เพื่อป้องกันสัญญาณรบกวน")}</div>
        </section>
      </div>

      <section className="card hw-main" aria-labelledby="inH">
        <div className="row" style={{ alignItems: 'baseline', gap: '8px 16px' }}>
          <h2 id="inH" style={{ fontSize: 19 }}>{t("ช่องสัญญาณเข้า")}</h2>
          <span className="faint" style={{ fontSize: 13 }}>{t("ลองตีกลองทีละชิ้นเพื่อดูสัญญาณ แล้วปรับค่าให้เหมาะสม แอปจะส่งค่าไปยังบอร์ดให้อัตโนมัติ")}</span>
        </div>
        <div className="tbl">
          <table style={{ minWidth: 700 }}>
            <thead>
              <tr>
                <th>{t("ขา")}</th>
                <th>{t("ชิ้นกลอง")}</th>
                <th style={{ width: '30%' }}>{t("สัญญาณล่าสุดและเกณฑ์")}</th>
                <th>{t("ความไว")}</th>
                <th>Scan (ms)</th>
                <th>Mask (ms)</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: CHANNEL_COUNT }, (_, ch) => {
                const head = kit.pads.find((x) => x.channel === ch);
                const rimOf = head ? undefined : kit.pads.find((x) => x.rimChannel === ch);
                const pedalOf = head || rimOf ? undefined : kit.pads.find((x) => x.pedalChannel === ch);
                const p = head ?? rimOf;
                const raw = hw.pedalRaw[ch];
                const lvl = pedalOf ? ((raw ?? 0) / 1023) * 127 : hw.channelLevels[ch];
                const thrPct = p ? (sensitivityToThreshold(p.sensitivity) / 1023) * 100 : 0;
                const off = Number.isFinite(boardChannels) && ch >= boardChannels;
                return (
                  <tr key={ch} style={off ? { opacity: 0.45 } : !p ? { opacity: 0.7 } : undefined}>
                    <td className="mono" style={{ fontWeight: 500 }}>{PIN_LABELS[ch]}</td>
                    <td>
                      {head ? head.name + (head.rimChannel >= 0 ? t(" · หนัง") : '') : rimOf ? <span>{rimOf.name} · <b style={{ color: 'var(--accent)', fontWeight: 600 }}>{t("ขอบ")}</b></span> : pedalOf ? <span>{pedalOf.name} · <b style={{ color: 'var(--accent)', fontWeight: 600 }}>{t("แป้น")}</b></span> : <span className="faint">{t("ไม่ได้ใช้ (ปิดอยู่)")}</span>}
                      {off && <span className="faint">  {t("(บอร์ดไม่มีขานี้)")}</span>}
                    </td>
                    <td>
                      <div className="lvl">
                        <div className="v" style={{ width: (lvl / 127) * 100 + '%' }} />
                        {p && <div className="t" style={{ left: thrPct + '%' }} />}
                      </div>
                    </td>
                    {head && (
                      <>
                        <td>
                          <label htmlFor={'s' + ch} className="sr-only">{t("ความไว")} {PIN_LABELS[ch]}</label>
                          <input id={'s' + ch} className="num" type="number" min={1} max={100} value={head.sensitivity} onChange={(e) => updatePad(head.id, { sensitivity: clamp(e.target.value, 1, 100) })} />
                        </td>
                        <td>
                          <label htmlFor={'sc' + ch} className="sr-only">Scan {PIN_LABELS[ch]}</label>
                          <input id={'sc' + ch} className="num" type="number" min={1} max={20} value={head.scan} onChange={(e) => updatePad(head.id, { scan: clamp(e.target.value, 1, 20) })} />
                        </td>
                        <td>
                          <label htmlFor={'m' + ch} className="sr-only">Mask {PIN_LABELS[ch]}</label>
                          <input id={'m' + ch} className="num" type="number" min={5} max={250} value={head.mask} onChange={(e) => updatePad(head.id, { mask: clamp(e.target.value, 5, 250) })} />
                        </td>
                      </>
                    )}
                    {rimOf && (
                      <td colSpan={3}>
                        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                          <label htmlFor={'r' + ch} className="faint" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{t("นับเป็นตีขอบเมื่อแรงที่ขอบ ≥")}</label>
                          <input id={'r' + ch} className="num" type="number" min={20} max={300} step={5} value={rimOf.rimRatio} onChange={(e) => updatePad(rimOf.id, { rimRatio: clamp(e.target.value, 20, 300) })} />
                          <span className="faint" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{t("% ของแรงที่หนัง")}</span>
                        </div>
                      </td>
                    )}
                    {pedalOf && (
                      <td colSpan={3} className="faint" style={{ fontSize: 13 }}>
                        
                        {t("ค่าเซนเซอร์")} <span className="mono">{raw ?? '—'}</span>  {t("(ปรับจุดปิดและจุดเปิดได้ในแท็บ “แป้นไฮแฮท”)")}
                      </td>
                    )}
                    {!p && !pedalOf && <td colSpan={3} />}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="row faint" style={{ fontSize: 13, gap: '8px 20px' }}>
          <span className="row" style={{ gap: 6 }}><span style={{ width: 14, height: 8, background: 'var(--accent)', borderRadius: 2 }} aria-hidden="true" />{t("แรงตีล่าสุด")}</span>
          <span className="row" style={{ gap: 6 }}><span style={{ width: 2, height: 12, background: 'var(--text)' }} aria-hidden="true" />{t("เกณฑ์ขั้นต่ำ")}</span>
          <span>{t("Scan คือเวลาที่ใช้หาแรงตีสูงสุด ส่วน Mask คือเวลาที่ป้องกันการนับซ้ำ (เพิ่มค่านี้หากตีครั้งเดียวแต่มีเสียงสองครั้ง)")}</span>
        </div>
        <div>
          <button type="button" className="btn ghost danger" onClick={() => { if (confirm(t("ต้องการคืนค่าตำแหน่งชิ้นกลอง ขา Arduino และความไวเป็นค่าเริ่มต้นหรือไม่ (เสียงของแต่ละชุดจะไม่เปลี่ยน)"))) resetLayout(); }}>
            
            {t("คืนค่าตำแหน่งและการตั้งค่าขา")}
          </button>
        </div>
      </section>
    </main>
  );
}

function clamp(v: string, lo: number, hi: number) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
}
