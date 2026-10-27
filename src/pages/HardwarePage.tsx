import { useStore } from '../store';
import { useHardware } from '../input/hardware';
import { CHANNEL_COUNT, PIN_LABELS, sensitivityToThreshold } from '../types';

export function HardwarePage() {
  const { kit, updatePad, resetLayout } = useStore();
  const hw = useHardware();
  const boardChannels = hw.boardInfo ? parseInt(hw.boardInfo.split(' ')[2] ?? '', 10) : NaN;

  return (
    <main className="page">
      <div className="stack" style={{ flex: '1 1 340px', maxWidth: 440, minWidth: 0, gap: 24 }}>
        <section className="card stack" aria-labelledby="connH">
          <h2 id="connH" style={{ fontSize: 19 }}>การเชื่อมต่อ</h2>

          <div className="stack" style={{ gap: 8 }}>
            <span id="modeL" className="label">รับสัญญาณผ่าน</span>
            <div className="seg" role="group" aria-labelledby="modeL" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              <button type="button" aria-pressed={hw.mode === 'serial'} onClick={() => hw.setMode('serial')}>USB Serial</button>
              <button type="button" aria-pressed={hw.mode === 'midi'} onClick={() => hw.setMode('midi')}>USB MIDI</button>
            </div>
            <span className="faint" style={{ fontSize: 13 }}>
              {hw.mode === 'serial'
                ? 'ใช้กับทุกบอร์ด (Mega, Nano, Uno, Leonardo) ปรับความไว/เวลา และตีขอบจากแอปได้'
                : 'สำหรับ Leonardo / Pro Micro ที่ลงเฟิร์มแวร์แบบ MIDI — บอร์ดจะใช้กับโปรแกรมดนตรีอื่นได้ด้วย'}
            </span>
          </div>

          {hw.mode === 'serial' ? (
            <>
              {!hw.serialSupported && <div className="alert">ระบบนี้ไม่รองรับ Web Serial — ใช้แอป DrumDuino หรือ Chrome/Edge</div>}
              <div className="row">
                {hw.serialStatus === 'connected' ? (
                  <button type="button" className="btn" onClick={() => void hw.disconnectSerial()}>ตัดการเชื่อมต่อ</button>
                ) : (
                  <button type="button" className="btn primary" disabled={!hw.serialSupported || hw.serialStatus === 'connecting'} onClick={() => void hw.connectSerial()}>
                    {hw.serialStatus === 'connecting' ? 'กำลังเชื่อมต่อ…' : 'เชื่อมต่อ Arduino'}
                  </button>
                )}
              </div>
              <div className="note">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>สถานะ</span>
                  <span className="mono" style={{ color: hw.serialStatus === 'connected' ? 'var(--ok)' : 'var(--muted)' }}>
                    {hw.serialStatus === 'connected' ? 'เชื่อมต่อแล้ว' : hw.serialStatus === 'connecting' ? 'กำลังเชื่อมต่อ' : 'ไม่ได้เชื่อมต่อ'}
                  </span>
                </div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>เฟิร์มแวร์</span>
                  <span className="mono">{hw.boardInfo || (hw.serialStatus === 'connected' ? 'รอคำตอบจากบอร์ด…' : '—')}</span>
                </div>
                {Number.isFinite(boardChannels) && (
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span>ช่องที่บอร์ดรองรับ</span>
                    <span className="mono">{boardChannels} ช่อง</span>
                  </div>
                )}
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>ความเร็ว</span>
                  <span className="mono">115200 baud</span>
                </div>
              </div>
            </>
          ) : (
            <>
              {!hw.midiSupported && <div className="alert">ระบบนี้ไม่รองรับ Web MIDI</div>}
              <div className="field">
                <label htmlFor="midiIn" className="label">อุปกรณ์ MIDI</label>
                <select id="midiIn" className="input" value={hw.midiInputId} onChange={(e) => hw.setMidiInput(e.target.value)}>
                  {hw.midiInputs.length === 0 && <option value="">ไม่พบอุปกรณ์ MIDI</option>}
                  {hw.midiInputs.map((i) => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </select>
              </div>
              <div className="note">โหมด MIDI จะจับคู่ชิ้นกลองด้วย “โน้ต MIDI” ที่ตั้งไว้ในหน้าชุดกลอง ค่าความไวต้องตั้งในเฟิร์มแวร์</div>
            </>
          )}
          {hw.error && <div className="alert" role="alert">{hw.error}</div>}
        </section>

        <section className="card stack" aria-labelledby="fwH">
          <h2 id="fwH" style={{ fontSize: 19 }}>ลงเฟิร์มแวร์ในบอร์ด</h2>
          <ol className="steps">
            <li>ติดตั้ง <a href="https://www.arduino.cc/en/software" target="_blank" rel="noreferrer">Arduino IDE</a></li>
            <li>เปิดไฟล์ <code>firmware/DrumDuino/DrumDuino.ino</code> จากโปรเจกต์</li>
            <li>ถ้าใช้ Leonardo / Pro Micro: ติดตั้งไลบรารี <code>MIDIUSB</code> ใน Library Manager</li>
            <li>เลือกบอร์ดและพอร์ต แล้วกด Upload</li>
            <li>ปิด Serial Monitor ใน Arduino IDE ก่อนเชื่อมต่อจากแอปนี้</li>
          </ol>
        </section>

        <section className="card stack" aria-labelledby="wireH">
          <h2 id="wireH" style={{ fontSize: 19 }}>วิธีต่อสาย</h2>
          <ol className="steps">
            <li>ขา + (สายแดง) ของ piezo → ขาอนาล็อกตามชิ้นกลอง (A0–A15 บน Mega)</li>
            <li>ขา − (สายดำ) ของ piezo → GND</li>
            <li>ตัวต้านทาน 1 MΩ คร่อมระหว่างขาอนาล็อกกับ GND ทุกช่อง</li>
            <li>แนะนำ: ไดโอดซีเนอร์ 5.1V คร่อมอีกตัว กันแรงดันเกินเวลาตีแรง</li>
          </ol>
          <h3 style={{ fontSize: 15 }}>กลองตีขอบได้ (dual-zone)</h3>
          <ol className="steps">
            <li>piezo ตัวที่ 1 ติดใต้หนังกลอง (ตรงกลาง) → ขาหนัง</li>
            <li>piezo ตัวที่ 2 ติดที่ขอบหรือตัวถัง รองด้วยโฟมบางๆ → ขาขอบ (เช่น A8)</li>
            <li>ในหน้าชุดกลอง เลือกชิ้นนั้น แล้วตั้ง “ขาขอบ (Rim)”</li>
            <li>ตีหนังและตีขอบสลับกัน แล้วปรับเปอร์เซ็นต์ตีขอบจนแยกได้ถูก</li>
          </ol>
          <div className="note">Mega: 16 ขา (A0–A15) · Nano: 8 ขา · Uno: 6 ขา — ขาที่ไม่ได้ตั้งในแอปจะถูกปิดไว้ กันสัญญาณมั่ว</div>
        </section>
      </div>

      <section className="card stack grow" aria-labelledby="inH">
        <div className="row" style={{ alignItems: 'baseline', gap: '8px 16px' }}>
          <h2 id="inH" style={{ fontSize: 19 }}>ช่องสัญญาณเข้า</h2>
          <span className="faint" style={{ fontSize: 13 }}>ตีแต่ละชิ้นเพื่อดูสัญญาณ แล้วปรับให้พอดี — ส่งค่าไปบอร์ดอัตโนมัติ</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>ขา</th>
                <th>ชิ้นกลอง</th>
                <th style={{ width: '30%' }}>สัญญาณล่าสุด / เกณฑ์</th>
                <th>ความไว</th>
                <th>Scan (ms)</th>
                <th>Mask (ms)</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: CHANNEL_COUNT }, (_, ch) => {
                const head = kit.pads.find((x) => x.channel === ch);
                const rimOf = head ? undefined : kit.pads.find((x) => x.rimChannel === ch);
                const p = head ?? rimOf;
                const lvl = hw.channelLevels[ch];
                const thrPct = p ? (sensitivityToThreshold(p.sensitivity) / 1023) * 100 : 0;
                const off = Number.isFinite(boardChannels) && ch >= boardChannels;
                return (
                  <tr key={ch} style={off ? { opacity: 0.45 } : !p ? { opacity: 0.7 } : undefined}>
                    <td className="mono" style={{ fontWeight: 500 }}>{PIN_LABELS[ch]}</td>
                    <td>
                      {head ? head.name + (head.rimChannel >= 0 ? ' · หนัง' : '') : rimOf ? <span>{rimOf.name} · <b style={{ color: 'var(--accent)', fontWeight: 600 }}>ขอบ</b></span> : <span className="faint">ว่าง (ปิดอยู่)</span>}
                      {off && <span className="faint"> · บอร์ดไม่มีขานี้</span>}
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
                          <label htmlFor={'s' + ch} className="sr-only">ความไว {PIN_LABELS[ch]}</label>
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
                          <label htmlFor={'r' + ch} className="faint" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>ตีขอบเมื่อขอบ ≥</label>
                          <input id={'r' + ch} className="num" type="number" min={20} max={300} step={5} value={rimOf.rimRatio} onChange={(e) => updatePad(rimOf.id, { rimRatio: clamp(e.target.value, 20, 300) })} />
                          <span className="faint" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>% ของหนัง</span>
                        </div>
                      </td>
                    )}
                    {!p && <td colSpan={3} />}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="row faint" style={{ fontSize: 13, gap: '8px 20px' }}>
          <span className="row" style={{ gap: 6 }}><span style={{ width: 14, height: 8, background: 'var(--accent)', borderRadius: 2 }} aria-hidden="true" />แรงตีล่าสุด</span>
          <span className="row" style={{ gap: 6 }}><span style={{ width: 2, height: 12, background: 'var(--text)' }} aria-hidden="true" />เกณฑ์ขั้นต่ำ</span>
          <span>Scan = เวลาหาค่าสูงสุดหลังตี · Mask = เวลากันตีซ้ำ (เพิ่มถ้าตีครั้งเดียวแต่ดังสองที)</span>
        </div>
        <div>
          <button type="button" className="btn ghost danger" onClick={() => { if (confirm('รีเซ็ตตำแหน่งชิ้นกลอง ขา Arduino และความไว กลับเป็นค่าเริ่มต้น? (เสียงของแต่ละชุดไม่เปลี่ยน)')) resetLayout(); }}>
            รีเซ็ตตำแหน่งและการตั้งค่าขา
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
