import { useState } from 'react';
import { useStore } from './store';
import { useHardware } from './input/hardware';
import { Logo } from './components/Icons';
import { PortPicker } from './components/PortPicker';
import { KitPage } from './pages/KitPage';
import { LibraryPage } from './pages/LibraryPage';
import { HardwarePage } from './pages/HardwarePage';
import { engine } from './audio/engine';

type Tab = 'kit' | 'library' | 'hardware';

function StatusPill() {
  const hw = useHardware();
  if (hw.mode === 'midi') {
    const name = hw.midiInputs.find((i) => i.id === hw.midiInputId)?.name;
    return (
      <div className={'status-pill' + (name ? ' ok' : '')}>
        <span className={'dot' + (name ? ' ok' : '')} aria-hidden="true" />
        <span>{name ? 'MIDI · ' + name : 'MIDI · ยังไม่ได้เลือกอุปกรณ์'}</span>
      </div>
    );
  }
  const st = hw.serialStatus;
  return (
    <div className={'status-pill' + (st === 'connected' ? ' ok' : '')}>
      <span className={'dot' + (st === 'connected' ? ' ok' : st === 'connecting' ? ' wait' : '')} aria-hidden="true" />
      <span>
        {st === 'connected' ? 'Arduino · เชื่อมต่อแล้ว' : st === 'connecting' ? 'กำลังเชื่อมต่อ…' : 'ยังไม่ได้เชื่อมต่อ Arduino'}
      </span>
    </div>
  );
}

export function App() {
  const [tab, setTab] = useState<Tab>('kit');
  const { kit, setMaster, ready } = useStore();

  const tabs: { id: Tab; label: string }[] = [
    { id: 'kit', label: 'ชุดกลอง' },
    { id: 'library', label: 'คลังเสียง' },
    { id: 'hardware', label: 'ฮาร์ดแวร์' }
  ];

  return (
    <div className="app" onPointerDown={() => engine.resume()}>
      <header className="topbar">
        <div className="brand"><Logo />DrumDuino</div>
        <nav className="nav" aria-label="เมนูหลัก">
          {tabs.map((t) => (
            <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <StatusPill />
        <div className="master">
          <label htmlFor="master" className="label">มาสเตอร์</label>
          <input id="master" type="range" min={0} max={100} value={kit.master} onChange={(e) => setMaster(Number(e.target.value))} />
          <span className="mono" style={{ fontSize: 13, width: 28 }}>{kit.master}</span>
        </div>
      </header>
      {!ready ? (
        <div className="loading">กำลังเตรียมเสียง…</div>
      ) : tab === 'kit' ? (
        <KitPage goLibrary={() => setTab('library')} />
      ) : tab === 'library' ? (
        <LibraryPage goKit={() => setTab('kit')} />
      ) : (
        <HardwarePage />
      )}
      <PortPicker />
    </div>
  );
}
