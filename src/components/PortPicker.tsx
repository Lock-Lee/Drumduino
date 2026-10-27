import { useHardware } from '../input/hardware';

/** Shown inside the Electron app when navigator.serial.requestPort() is called. */
export function PortPicker() {
  const { portChoices, choosePort } = useHardware();
  if (!portChoices) return null;
  const sorted = [...portChoices].sort((a, b) => Number(b.likelyArduino) - Number(a.likelyArduino));
  return (
    <div className="scrim" role="presentation" onClick={() => choosePort('')}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pp-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="pp-title">เลือกพอร์ตของ Arduino</h2>
        {sorted.length === 0 ? (
          <p className="empty">ไม่พบบอร์ด Arduino กรุณาถอดสาย USB แล้วเสียบใหม่ จากนั้นกดเชื่อมต่ออีกครั้ง</p>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {sorted.map((p) => (
              <button key={p.portId} type="button" className="port" onClick={() => choosePort(p.portId)}>
                <div style={{ flex: '1 1 0', minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{p.name}</div>
                  <div className="mono faint" style={{ fontSize: 12 }}>{p.portName}</div>
                </div>
                {p.likelyArduino && <span className="tag">Arduino</span>}
              </button>
            ))}
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={() => choosePort('')}>ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}
