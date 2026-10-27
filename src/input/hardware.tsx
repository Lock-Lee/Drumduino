// Routes hits from Arduino (Serial or USB MIDI) and the keyboard to the audio engine,
// and keeps the board's per-channel settings in sync with the kit.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { engine } from '../audio/engine';
import { useStore } from '../store';
import type { InputMode, PortInfo } from '../types';
import { CHANNEL_COUNT, sensitivityToThreshold } from '../types';
import { SerialLink } from './serial';

type SerialStatus = 'idle' | 'connecting' | 'connected';

interface Hardware {
  mode: InputMode;
  setMode(m: InputMode): void;
  serialSupported: boolean;
  serialStatus: SerialStatus;
  boardInfo: string;
  error: string;
  connectSerial(): Promise<void>;
  disconnectSerial(): Promise<void>;
  midiSupported: boolean;
  midiInputs: { id: string; name: string }[];
  midiInputId: string;
  setMidiInput(id: string): void;
  /** last velocity per channel (from hardware) */
  channelLevels: number[];
  /** last velocity per pad id (any source) */
  padLevels: Record<string, number>;
  /** pad id that was hit most recently, cleared shortly after */
  flash: Record<string, number>;
  /** serial port picker (Electron) */
  portChoices: PortInfo[] | null;
  choosePort(id: string): void;
}

const Ctx = createContext<Hardware | null>(null);

const MODE_KEY = 'drumduino.inputMode';

export function HardwareProvider({ children }: { children: ReactNode }) {
  const { kit } = useStore();
  const kitRef = useRef(kit);
  kitRef.current = kit;

  const [mode, setModeState] = useState<InputMode>(() => {
    try {
      return (localStorage.getItem(MODE_KEY) as InputMode) || 'serial';
    } catch {
      return 'serial';
    }
  });
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const [serialStatus, setSerialStatus] = useState<SerialStatus>('idle');
  const [boardInfo, setBoardInfo] = useState('');
  const [error, setError] = useState('');
  const [channelLevels, setChannelLevels] = useState<number[]>(() => Array(CHANNEL_COUNT).fill(0));
  const [padLevels, setPadLevels] = useState<Record<string, number>>({});
  const [flash, setFlash] = useState<Record<string, number>>({});
  const [portChoices, setPortChoices] = useState<PortInfo[] | null>(null);

  const [midiAccess, setMidiAccess] = useState<MIDIAccess | null>(null);
  const [midiInputs, setMidiInputs] = useState<{ id: string; name: string }[]>([]);
  const [midiInputId, setMidiInputId] = useState('');

  const setChannelLevel = useCallback((ch: number, v: number) => {
    setChannelLevels((l) => {
      if (ch < 0 || ch >= l.length) return l;
      const n = l.slice();
      n[ch] = v;
      return n;
    });
  }, []);

  // Every pad hit (any source) → meters + flash.
  useEffect(
    () =>
      engine.onHit((id, v) => {
        setPadLevels((p) => ({ ...p, [id]: v }));
        const stamp = performance.now();
        setFlash((f) => ({ ...f, [id]: stamp }));
        setTimeout(() => setFlash((f) => (f[id] === stamp ? { ...f, [id]: 0 } : f)), 160);
      }),
    []
  );

  const link = useMemo(
    () =>
      new SerialLink({
        onHit(ch, v) {
          setChannelLevel(ch, v);
          if (modeRef.current !== 'serial') return;
          const pad = kitRef.current.pads.find((p) => p.channel === ch);
          if (pad) engine.play(pad, v, 'serial');
        },
        onInfo(info) {
          setBoardInfo(info);
        },
        onClose(err) {
          setSerialStatus('idle');
          setBoardInfo('');
          if (err) setError('การเชื่อมต่อหลุด: ' + err);
        }
      }),
    [setChannelLevel]
  );

  // Electron: in-app port picker.
  useEffect(() => window.drumduino?.onSerialPorts((ports) => setPortChoices(ports)), []);
  const choosePort = useCallback((id: string) => {
    setPortChoices(null);
    void window.drumduino?.chooseSerialPort(id);
  }, []);

  const connectSerial = useCallback(async () => {
    setError('');
    setSerialStatus('connecting');
    engine.resume();
    try {
      await link.connect();
      setSerialStatus('connected');
    } catch (e) {
      setSerialStatus('idle');
      const msg = String((e as Error)?.message || e);
      if (!/No port selected|cancel/i.test(msg)) setError('เชื่อมต่อไม่สำเร็จ: ' + msg);
    }
  }, [link]);

  const disconnectSerial = useCallback(async () => {
    await link.disconnect();
  }, [link]);

  // Push threshold / scan / mask to the board whenever they change.
  const settingsSig = kit.pads
    .filter((p) => p.channel >= 0)
    .map((p) => `${p.channel}:${p.sensitivity}:${p.scan}:${p.mask}`)
    .join('|');
  useEffect(() => {
    if (serialStatus !== 'connected') return;
    const t = setTimeout(() => {
      const lines: string[] = [];
      for (const p of kitRef.current.pads) {
        if (p.channel < 0) continue;
        lines.push(`T ${p.channel} ${sensitivityToThreshold(p.sensitivity)}`);
        lines.push(`S ${p.channel} ${p.scan}`);
        lines.push(`M ${p.channel} ${p.mask}`);
      }
      void link.sendMany(lines);
    }, boardInfo ? 250 : 1800);
    return () => clearTimeout(t);
  }, [settingsSig, serialStatus, boardInfo, link]);

  // Web MIDI
  const midiSupported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  useEffect(() => {
    if (mode !== 'midi' || !midiSupported || midiAccess) return;
    navigator
      .requestMIDIAccess()
      .then((acc) => {
        setMidiAccess(acc);
        const refresh = () => {
          const list = Array.from(acc.inputs.values()).map((i) => ({ id: i.id, name: i.name || 'MIDI input' }));
          setMidiInputs(list);
          setMidiInputId((cur) => cur || list.find((i) => /arduino|leonardo|micro|drum/i.test(i.name))?.id || list[0]?.id || '');
        };
        refresh();
        acc.onstatechange = refresh;
      })
      .catch((e) => setError('เปิด MIDI ไม่ได้: ' + String(e?.message || e)));
  }, [mode, midiSupported, midiAccess]);

  useEffect(() => {
    if (!midiAccess || mode !== 'midi' || !midiInputId) return;
    const input = midiAccess.inputs.get(midiInputId);
    if (!input) return;
    input.onmidimessage = (msg) => {
      const d = msg.data;
      if (!d || d.length < 3) return;
      const cmd = d[0] & 0xf0;
      if (cmd !== 0x90 || d[2] === 0) return;
      const pad = kitRef.current.pads.find((p) => p.midiNote === d[1]);
      if (pad) {
        if (pad.channel >= 0) setChannelLevel(pad.channel, d[2]);
        engine.play(pad, d[2], 'midi');
      }
    };
    return () => {
      input.onmidimessage = null;
    };
  }, [midiAccess, midiInputId, mode, setChannelLevel]);

  // Keyboard test keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      const pad = kitRef.current.pads.find((p) => p.key && p.key === k);
      if (!pad) return;
      e.preventDefault();
      engine.play(pad, e.shiftKey ? 50 : 110, 'key');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const setMode = useCallback((m: InputMode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
  }, []);

  const value: Hardware = {
    mode,
    setMode,
    serialSupported: SerialLink.supported(),
    serialStatus,
    boardInfo,
    error,
    connectSerial,
    disconnectSerial,
    midiSupported,
    midiInputs,
    midiInputId,
    setMidiInput: setMidiInputId,
    channelLevels,
    padLevels,
    flash,
    portChoices,
    choosePort
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHardware(): Hardware {
  const h = useContext(Ctx);
  if (!h) throw new Error('HardwareProvider missing');
  return h;
}
