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
  /** same, for rim-zone hits */
  rimFlash: Record<string, number>;
  /** hi-hat pedal: latest raw sensor value per input, and openness (0 closed – 1 open) per pad */
  pedalRaw: Record<number, number>;
  pedal: Record<string, number>;
  /** move the hi-hat pedal from the UI (no hardware) */
  setPedalUI(padId: string, openness: number): void;
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
  const [pedalRaw, setPedalRaw] = useState<Record<number, number>>({});
  const [pedal, setPedal] = useState<Record<string, number>>({});
  useEffect(() => engine.onPedal((id, o) => setPedal((p) => ({ ...p, [id]: o }))), []);

  // Pedal motion → openness, choke on close, and a "chick" when closed quickly.
  const track = useRef<Record<string, { o: number; peak: number; peakT: number }>>({});
  const pedalMove = useCallback((padId: string, o: number, source: 'serial' | 'midi' | 'key' | 'ui') => {
    const pad = kitRef.current.pads.find((p) => p.id === padId);
    if (!pad) return;
    const now = performance.now();
    const st = track.current[padId] ?? { o: 0, peak: 0, peakT: now };
    if (o >= st.peak || now - st.peakT > 250) {
      st.peak = o;
      st.peakT = now;
    }
    engine.setPedal(padId, o);
    if (st.o >= 0.1 && o < 0.06) {
      engine.choke(padId);
      const drop = st.peak - o;
      const dt = Math.max(8, now - st.peakT);
      if (drop > 0.3) engine.play(pad, Math.max(25, Math.min(127, (drop / dt) * 5000)), source, 'pedal');
      st.peak = o;
      st.peakT = now;
    }
    st.o = o;
    track.current[padId] = st;
  }, []);
  const pedalPad = () =>
    kitRef.current.pads.find((p) => p.pedalChannel >= 0) ?? kitRef.current.pads.find((p) => p.id === 'hihat') ?? kitRef.current.pads.find((p) => p.openSamples.length);

  const [channelLevels, setChannelLevels] = useState<number[]>(() => Array(CHANNEL_COUNT).fill(0));
  const [padLevels, setPadLevels] = useState<Record<string, number>>({});
  const [flash, setFlash] = useState<Record<string, number>>({});
  const [rimFlash, setRimFlash] = useState<Record<string, number>>({});
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
      engine.onHit((id, v, zone) => {
        setPadLevels((p) => ({ ...p, [id]: v }));
        const stamp = performance.now();
        const set = zone === 'rim' ? setRimFlash : setFlash;
        set((f) => ({ ...f, [id]: stamp }));
        setTimeout(() => set((f) => (f[id] === stamp ? { ...f, [id]: 0 } : f)), 160);
      }),
    []
  );

  const link = useMemo(
    () =>
      new SerialLink({
        onHit(ch, v, rim) {
          const pad = kitRef.current.pads.find((p) => p.channel === ch);
          setChannelLevel(rim && pad && pad.rimChannel >= 0 ? pad.rimChannel : ch, v);
          if (modeRef.current !== 'serial') return;
          if (pad) engine.play(pad, v, 'serial', rim ? 'rim' : 'head');
        },
        onPedal(ch, raw) {
          setPedalRaw((r) => ({ ...r, [ch]: raw }));
          if (modeRef.current !== 'serial') return;
          const pad = kitRef.current.pads.find((p) => p.pedalChannel === ch);
          if (!pad) return;
          const span = pad.pedalOpen - pad.pedalClosed || 1;
          pedalMove(pad.id, Math.max(0, Math.min(1, (raw - pad.pedalClosed) / span)), 'serial');
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
    [setChannelLevel, pedalMove]
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
    .map((p) => `${p.channel}:${p.rimChannel}:${p.rimRatio}:${p.sensitivity}:${p.scan}:${p.mask}`)
    .join('|') + '#' + kit.pads.map((p) => p.pedalChannel).join(',');
  useEffect(() => {
    if (serialStatus !== 'connected') return;
    const t = setTimeout(() => {
      const lines: string[] = [];
      const pads = kitRef.current.pads.filter((p) => p.channel >= 0);
      const used = new Set<number>();
      for (const p of pads) {
        used.add(p.channel);
        const thr = sensitivityToThreshold(p.sensitivity);
        const rimCh = p.rimChannel >= 0 && p.rimChannel !== p.channel ? p.rimChannel : -1;
        for (const ch of rimCh >= 0 ? [p.channel, rimCh] : [p.channel]) {
          used.add(ch);
          lines.push(`T ${ch} ${thr}`, `S ${ch} ${p.scan}`, `M ${ch} ${p.mask}`);
        }
        lines.push(`P ${p.channel} ${rimCh}`, `X ${p.channel} ${p.rimRatio}`);
      }
      const pedals = new Set(kitRef.current.pads.map((p) => p.pedalChannel).filter((c) => c >= 0));
      pedals.forEach((c) => used.add(c));
      // only listen on inputs that have a sensor assigned (unconnected inputs float and false-trigger)
      for (let ch = CHANNEL_COUNT - 1; ch >= 0; ch--) lines.unshift(`E ${ch} ${used.has(ch) ? 1 : 0}`, `K ${ch} ${pedals.has(ch) ? 1 : 0}`);
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
      if (cmd === 0xb0 && d[1] === 4) {
        // CC4 hi-hat pedal: 0 = open … 127 = closed
        const hp = pedalPad();
        if (hp) pedalMove(hp.id, 1 - d[2] / 127, 'midi');
        return;
      }
      if (cmd !== 0x90 || d[2] === 0) return;
      const head = kitRef.current.pads.find((p) => p.midiNote === d[1]);
      const rimPad = head ? undefined : kitRef.current.pads.find((p) => p.rimNote > 0 && p.rimNote === d[1]);
      const pad = head ?? rimPad;
      if (pad) {
        const ch = rimPad ? pad.rimChannel : pad.channel;
        if (ch >= 0) setChannelLevel(ch, d[2]);
        engine.play(pad, d[2], 'midi', rimPad ? 'rim' : 'head');
      }
    };
    return () => {
      input.onmidimessage = null;
    };
  }, [midiAccess, midiInputId, mode, setChannelLevel, pedalMove]);

  // Keyboard test keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      // e.code so Option/Alt (+key = rim) still matches the letter on macOS
      const k = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : /^Digit\d$/.test(e.code) ? e.code.slice(5) : e.key.toLowerCase();
      // X = hold the hi-hat pedal open, release to close · Z = foot chick
      if (k === 'x' || k === 'z') {
        const hp = pedalPad();
        if (!hp) return;
        e.preventDefault();
        if (k === 'x') pedalMove(hp.id, 1, 'key');
        else {
          engine.choke(hp.id);
          engine.play(hp, e.shiftKey ? 50 : 100, 'key', 'pedal');
        }
        return;
      }
      const pad = kitRef.current.pads.find((p) => p.key && p.key === k);
      if (!pad) return;
      e.preventDefault();
      engine.play(pad, e.shiftKey ? 35 : 115, 'key', e.altKey ? 'rim' : 'head');
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'KeyX') return;
      const hp = pedalPad();
      if (hp) pedalMove(hp.id, 0, 'key');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [pedalMove]);

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
    pedalRaw,
    pedal,
    setPedalUI: (id, o) => pedalMove(id, o, 'ui'),
    padLevels,
    flash,
    rimFlash,
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
