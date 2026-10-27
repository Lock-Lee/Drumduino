import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Kit, Pad, SampleMeta } from './types';
import { BUILTINS } from './audio/synth';
import realKit from './audio/realKit.json';
import { engine } from './audio/engine';
import { deleteSample, putSample } from './audio/sampleDb';

const KIT_KEY = 'drumduino.kit.v2';
const SAMPLES_KEY = 'drumduino.samples.v1';

function pad(p: Partial<Pad> & Pick<Pad, 'id' | 'name' | 'th' | 'channel' | 'x' | 'y' | 'w' | 'samples' | 'midiNote' | 'key'>): Pad {
  return {
    cymbal: false,
    mode: 'vel',
    volume: 85,
    pitch: 0,
    sensitivity: 60,
    scan: 3,
    mask: 35,
    ...p
  };
}

/** ids of the bundled acoustic layers for one articulation, soft → hard */
function vd(group: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `vd:${group}-${i + 1}`);
}

export function defaultKit(): Kit {
  return {
    name: 'Rock Kit 01',
    master: 80,
    pads: [
      pad({ id: 'crash', name: 'Crash', th: 'ฉาบแครช', channel: 0, x: 14, y: 6, w: 20, cymbal: true, samples: vd('crash', 3), midiNote: 49, key: 'q', mask: 45 }),
      pad({ id: 'tom1', name: 'Tom 1', th: 'ทอมสูง', channel: 4, x: 35, y: 16, w: 14, samples: vd('htom', 4), midiNote: 48, key: 'w' }),
      pad({ id: 'tom2', name: 'Tom 2', th: 'ทอมกลาง', channel: 5, x: 51, y: 16, w: 14, samples: vd('ltom', 4), midiNote: 45, key: 'e', pitch: 1 }),
      pad({ id: 'ride', name: 'Ride', th: 'ฉาบไรด์', channel: 7, x: 72, y: 8, w: 22, cymbal: true, samples: vd('ride', 3), midiNote: 51, key: 'r', mask: 45 }),
      pad({ id: 'hihat', name: 'Hi-hat', th: 'ไฮแฮท', channel: 1, x: 3, y: 40, w: 16, cymbal: true, samples: vd('hhclosed', 4), midiNote: 42, key: 'a', mask: 30 }),
      pad({ id: 'snare', name: 'Snare', th: 'กลองสแนร์', channel: 2, x: 21, y: 50, w: 18, samples: vd('snare', 6), midiNote: 38, key: 's', mask: 25 }),
      pad({ id: 'kick', name: 'Kick', th: 'กลองเบส', channel: 3, x: 40, y: 56, w: 22, samples: vd('kick', 4), midiNote: 36, key: 'd', mask: 45 }),
      pad({ id: 'floor', name: 'Floor Tom', th: 'ทอมตั้งพื้น', channel: 6, x: 66, y: 50, w: 20, samples: vd('ltom', 4), midiNote: 43, key: 'f', pitch: -4 })
    ]
  };
}

const builtinMeta: SampleMeta[] = [
  ...(realKit as { id: string; name: string; category: SampleMeta['category']; duration: number }[]).map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    duration: r.duration,
    builtin: true
  })),
  ...BUILTINS.map((b) => ({
    id: b.id,
    name: 'Synth ' + b.name,
    category: b.category,
    duration: b.seconds,
    builtin: true
  }))
];

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable */
  }
}

interface Store {
  kit: Kit;
  samples: SampleMeta[];
  selectedId: string;
  select(id: string): void;
  updatePad(id: string, patch: Partial<Pad>): void;
  addPad(): void;
  removePad(id: string): void;
  setKitName(name: string): void;
  setMaster(v: number): void;
  importFiles(files: FileList | File[], assignTo?: string): Promise<{ ok: number; failed: string[] }>;
  removeSample(id: string): Promise<void>;
  resetKit(): void;
  exportKit(): void;
  ready: boolean;
}

const Ctx = createContext<Store | null>(null);

function guessCategory(name: string): SampleMeta['category'] {
  const n = name.toLowerCase();
  if (/kick|bass|bd/.test(n)) return 'kick';
  if (/snare|sd|rim/.test(n)) return 'snare';
  if (/hat|hh/.test(n)) return 'hihat';
  if (/tom/.test(n)) return 'tom';
  if (/crash|ride|cym|china|splash/.test(n)) return 'cym';
  return 'mine';
}

const EXTRA_SLOTS = [
  { x: 86, y: 52 },
  { x: 2, y: 4 },
  { x: 88, y: 76 },
  { x: 2, y: 76 },
  { x: 62, y: 2 }
];

export function StoreProvider({ children }: { children: ReactNode }) {
  const [kit, setKit] = useState<Kit>(() => load(KIT_KEY, defaultKit()));
  const [userSamples, setUserSamples] = useState<SampleMeta[]>(() => load(SAMPLES_KEY, [] as SampleMeta[]));
  const [selectedId, setSelectedId] = useState<string>(() => kit.pads.find((p) => p.id === 'snare')?.id ?? kit.pads[0]?.id ?? '');
  const [ready, setReady] = useState(false);
  const kitRef = useRef(kit);
  kitRef.current = kit;

  useEffect(() => {
    let alive = true;
    engine
      .loadBuiltins()
      .then(() => engine.loadBundled(realKit as { id: string; file: string }[]))
      .then(() => Promise.all(userSamples.map((s) => engine.ensure(s.id))))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => save(KIT_KEY, kit), 250);
    engine.setMaster(kit.master);
    return () => clearTimeout(t);
  }, [kit]);

  useEffect(() => save(SAMPLES_KEY, userSamples), [userSamples]);

  const updatePad = useCallback((id: string, patch: Partial<Pad>) => {
    setKit((k) => ({ ...k, pads: k.pads.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  }, []);

  const addPad = useCallback(() => {
    setKit((k) => {
      const used = new Set(k.pads.map((p) => p.channel));
      let channel = -1;
      for (let c = 0; c < 8; c++) if (!used.has(c)) { channel = c; break; }
      const n = k.pads.length + 1;
      const slot = EXTRA_SLOTS[Math.max(0, k.pads.length - 8) % EXTRA_SLOTS.length];
      const id = 'pad-' + Date.now().toString(36);
      const p = pad({ id, name: 'ชิ้นที่ ' + n, th: 'ชิ้นใหม่', channel, x: slot.x, y: slot.y, w: 12, samples: [], midiNote: 60 + n, key: '' });
      setSelectedId(id);
      return { ...k, pads: [...k.pads, p] };
    });
  }, []);

  const removePad = useCallback((id: string) => {
    setKit((k) => {
      const pads = k.pads.filter((p) => p.id !== id);
      setSelectedId((s) => (s === id ? pads[0]?.id ?? '' : s));
      return { ...k, pads };
    });
  }, []);

  const importFiles = useCallback(async (files: FileList | File[], assignTo?: string) => {
    const list = Array.from(files);
    const added: SampleMeta[] = [];
    const failed: string[] = [];
    for (const f of list) {
      try {
        const data = await f.arrayBuffer();
        const buf = await engine.decode(data);
        const id = 'u:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        await putSample(id, data);
        engine.setBuffer(id, buf);
        added.push({ id, name: f.name, category: guessCategory(f.name), duration: buf.duration, builtin: false });
      } catch {
        failed.push(f.name);
      }
    }
    if (added.length) {
      setUserSamples((s) => [...s, ...added]);
      if (assignTo) {
        setKit((k) => ({
          ...k,
          pads: k.pads.map((p) => (p.id === assignTo ? { ...p, samples: [...p.samples, ...added.map((a) => a.id)] } : p))
        }));
      }
    }
    return { ok: added.length, failed };
  }, []);

  const removeSample = useCallback(async (id: string) => {
    await deleteSample(id).catch(() => undefined);
    engine.forget(id);
    setUserSamples((s) => s.filter((x) => x.id !== id));
    setKit((k) => ({ ...k, pads: k.pads.map((p) => ({ ...p, samples: p.samples.filter((x) => x !== id) })) }));
  }, []);

  const exportKit = useCallback(() => {
    const blob = new Blob([JSON.stringify(kitRef.current, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = kitRef.current.name.replace(/[^\w฀-๿ -]/g, '') + '.drumkit.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, []);

  const value = useMemo<Store>(
    () => ({
      kit,
      samples: [...builtinMeta, ...userSamples],
      selectedId,
      select: setSelectedId,
      updatePad,
      addPad,
      removePad,
      setKitName: (name) => setKit((k) => ({ ...k, name })),
      setMaster: (master) => setKit((k) => ({ ...k, master })),
      importFiles,
      removeSample,
      resetKit: () => {
        const k = defaultKit();
        setKit(k);
        setSelectedId('snare');
      },
      exportKit,
      ready
    }),
    [kit, userSamples, selectedId, updatePad, addPad, removePad, importFiles, removeSample, exportKit, ready]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}
