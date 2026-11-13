import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useHardware } from '../input/hardware';

import { t } from '../i18n';

/** Hardware page card: use an iPhone / iPad on the same Wi-Fi as wireless drum pads. */
export function RemoteCard() {
  const hw = useHardware();
  const [qr, setQr] = useState('');
  const url = hw.remoteInfo?.url ?? '';
  useEffect(() => {
    if (!url) {
      setQr('');
      return;
    }
    void QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#0b0f1a', light: '#ffffff' } }).then(setQr);
  }, [url]);
  if (!hw.remoteSupported) return null;
  const err = hw.remoteInfo?.error;

  return (
    <section className="card stack remote-card" aria-labelledby="remoteH">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id="remoteH" style={{ fontSize: 19 }}>{t("ตีจาก iPhone / iPad")}</h2>
        <label className="switch">
          <input type="checkbox" role="switch" checked={hw.remoteOn} onChange={(e) => hw.setRemoteOn(e.target.checked)} />
          <span>{hw.remoteOn ? t("เปิด") : t("ปิด")}</span>
        </label>
      </div>
      <span className="faint" style={{ fontSize: 13 }}>
        {t("ใช้จอ iPhone หรือ iPad เป็นแป้นกลองไร้สาย เสียงออกจากเครื่องนี้ ต้องอยู่ใน Wi-Fi เดียวกัน")}
      </span>
      {hw.remoteOn && (
        <>
          {err ? (
            <div className="alert">{err === 'port' ? t("พอร์ต 8765 ถูกใช้อยู่ ลองปิดแอป DrumDuino ตัวอื่นแล้วเปิดใหม่") : err}</div>
          ) : !hw.remoteInfo ? (
            <span className="faint">{t("กำลังเปิด…")}</span>
          ) : !url ? (
            <div className="alert">{t("เครื่องนี้ยังไม่ได้ต่อ Wi-Fi หรือเครือข่าย")}</div>
          ) : (
            <div className="remote-qr">
              {qr && <img src={qr} width={180} height={180} alt={t("QR code สำหรับเปิดหน้าแป้นกลองบน iPhone")} />}
              <ol className="stack" style={{ gap: 6, fontSize: 13, paddingLeft: 18, margin: 0 }}>
                <li>{t("เปิดกล้อง iPhone แล้วสแกน QR นี้")}</li>
                <li>{t("หมุนโทรศัพท์เป็นแนวนอน แล้วแตะแป้นได้เลย")}</li>
                <li>{t("กดแชร์ → “เพิ่มไปยังหน้าจอโฮม” เพื่อเปิดเต็มจอครั้งต่อไป")}</li>
              </ol>
            </div>
          )}
          {url && (
            <div className="note">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>{t("สถานะ")}</span>
                <span className="mono" style={{ color: hw.remoteClients ? 'var(--ok)' : 'var(--muted)' }}>
                  {hw.remoteClients ? t("เชื่อมต่อแล้ว {0} เครื่อง", hw.remoteClients) : t("รอโทรศัพท์เชื่อมต่อ…")}
                </span>
              </div>
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <span>{t("ที่อยู่")}</span>
                <span className="mono" style={{ fontSize: 11.5, wordBreak: 'break-all', textAlign: 'right' }}>{url}</span>
              </div>
            </div>
          )}
          <span className="faint" style={{ fontSize: 12 }}>
            {t("ครั้งแรก macOS อาจถามว่าจะให้ DrumDuino รับการเชื่อมต่อเข้ามาไหม ให้กด “อนุญาต”")}
          </span>
        </>
      )}
    </section>
  );
}
