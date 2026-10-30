import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Kit, KitSounds, Pad, PadSound, SampleMeta } from './types';
import { SOUND_FIELDS } from './types';
import type { SampleField } from './types';
import { SAMPLE_FIELDS } from './types';
import { BUILTINS } from './audio/synth';
import vdKit from './audio/vdKit.json';
import avlKit from './audio/avlKit.json';
import salKit from './audio/salKit.json';
import { engine } from './audio/engine';
import { deleteSample, putSample } from './audio/sampleDb';
import { PRESETS } from './kits';
import type { Preset } from './kits';

const STATE_KEY = 'drumduino.state.v3';
const SAMPLES_KEY = 'drumduino.samples.v1';

const EMPTY_SOUND: PadSound = { samples: [], rimSamples: [], halfSamples: [], openSamples: [], chickSamples: [], mode: 'vel', volume: 85, pitch: 0 };
const allSamples = (p: PadSound) => SAMPLE_FIELDS.flatMap((f) => p[f] ?? []);

type PadInit = Partial<Pad> & Pick<Pad, 'id' | 'name' | 'th' | 'channel' | 'x' | 'y' | 'w' | 'midiNote' | 'key'>;
function pad(p: PadInit): Pad {
  return { cymbal: false, sensitivity: 60, scan: 3, mask: 35, rimChannel: -1, rimRatio: 70, rimNote: 0, pedalChannel: -1, pedalClosed: 1000, pedalOpen: 100, ...EMPTY_SOUND, ...p };
}

/** Shared layout + Arduino settings (sound fields are filled from the current kit). */
export function defaultPads(): Pad[] {
  return [
    pad({ id: 'crash', name: 'Crash', th: 'ฉาบแครช', channel: 0, x: 14, y: 6, w: 20, cymbal: true, midiNote: 49, key: 'q', mask: 45 }),
    pad({ id: 'tom1', name: 'Tom 1', th: 'ทอมสูง', channel: 4, x: 35, y: 16, w: 14, midiNote: 48, rimNote: 50, key: 'w' }),
    pad({ id: 'tom2', name: 'Tom 2', th: 'ทอมกลาง', channel: 5, x: 51, y: 16, w: 14, midiNote: 45, rimNote: 47, key: 'e' }),
    pad({ id: 'ride', name: 'Ride', th: 'ฉาบไรด์', channel: 7, x: 72, y: 8, w: 22, cymbal: true, midiNote: 51, rimNote: 53, key: 'r', mask: 45 }),
    pad({ id: 'hihat', name: 'Hi-hat', th: 'ไฮแฮท', channel: 1, x: 3, y: 40, w: 16, cymbal: true, midiNote: 42, rimNote: 46, key: 'a', mask: 30 }),
    pad({ id: 'snare', name: 'Snare', th: 'กลองสแนร์', channel: 2, x: 21, y: 50, w: 18, midiNote: 38, rimNote: 40, key: 's', mask: 25 }),
    pad({ id: 'kick', name: 'Kick', th: 'กลองเบส', channel: 3, x: 40, y: 56, w: 22, midiNote: 36, key: 'd', mask: 45 }),
    pad({ id: 'floor', name: 'Floor Tom', th: 'ทอมตั้งพื้น', channel: 6, x: 66, y: 50, w: 20, midiNote: 43, rimNote: 58, key: 'f' })
  ];
}

function kitFromPreset(p: Preset): KitSounds {
  return { id: p.id, name: p.name, presetId: p.id, sounds: JSON.parse(JSON.stringify(p.sounds)) };
}

interface Persisted {
  pads: Pad[];
  kits: KitSounds[];
  currentKitId: string;
  master: number;
}

function defaultState(): Persisted {
  return { pads: defaultPads(), kits: PRESETS.map(kitFromPreset), currentKitId: PRESETS[0].id, master: 80 };
}

type Bundled = { id: string; file: string; name: string; category: SampleMeta['category']; duration: number };
const bundledList: Bundled[] = [...(vdKit as Bundled[]), ...(avlKit as Bundled[]), ...(salKit as Bundled[])];
engine.registerBundled(bundledList);

const builtinMeta: SampleMeta[] = [
  ...(vdKit as Bundled[]).map((r) => ({ id: r.id, name: r.name, category: r.category, duration: r.duration, builtin: true, source: 'vd' as const })),
  ...(avlKit as Bundled[]).map((r) => ({ id: r.id, name: r.name, category: r.category, duration: r.duration, builtin: true, source: 'avl' as const })),
  ...(salKit as Bundled[]).map((r) => ({ id: r.id, name: r.name, category: r.category, duration: r.duration, builtin: true, source: 'sal' as const })),
  ...BUILTINS.map((b) => ({ id: b.id, name: 'Synth ' + b.name, category: b.category, duration: b.seconds, builtin: true, source: 'synth' as const }))
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

/** Keep factory kits that were added in newer app versions. */
const OLD_FACTORY_RIMS = new Set([
  'vd:hhopen-1,vd:hhopen-2',
  [1, 2, 3, 4, 5].map((i) => `avl:SabianRockHatSemiOpen-${i}`).join(','),
  'vd:rimshot-1,vd:rimshot-2,vd:rimshot-3',
  [1, 2, 3, 4, 5].map((i) => `avl:PearlSnare2Edge-${i}`).join(','),
  [1, 2, 3, 4, 5].map((i) => `avl:PorkpieSnareEdge-${i}`).join(',')
]);

function withAllPresets(st: Persisted): Persisted {
  // fill fields added in newer versions
  st = {
    ...st,
    pads: st.pads.map((p) => {
      const d = defaultPads().find((x) => x.id === p.id);
      return pad({ ...(d ? { rimNote: d.rimNote } : {}), ...p });
    }),
    kits: st.kits.map((k) => {
      const preset = PRESETS.find((x) => x.id === k.presetId);
      const sounds: Record<string, PadSound> = {};
      for (const [pid, snd] of Object.entries(k.sounds)) {
        const fromPreset = preset?.sounds[pid];
        const merged: PadSound = { ...EMPTY_SOUND, ...(snd as Partial<PadSound>) };
        // sample lists added in newer versions come from the factory kit
        for (const f of SAMPLE_FIELDS) if (!(snd as Partial<PadSound>)[f]) merged[f] = fromPreset?.[f] ?? [];
        // rim lists shipped by older versions get the improved factory list
        if (fromPreset && OLD_FACTORY_RIMS.has(merged.rimSamples.join(','))) merged.rimSamples = fromPreset.rimSamples;
        sounds[pid] = merged;
      }
      return { ...k, sounds };
    })
  };
  const have = new Set(st.kits.map((k) => k.presetId));
  const missing = PRESETS.filter((p) => !have.has(p.id)).map(kitFromPreset);
  const kits = [...st.kits, ...missing];
  const currentKitId = kits.some((k) => k.id === st.currentKitId) ? st.currentKitId : kits[0].id;
  return { ...st, kits, currentKitId };
}

interface Store {
  kit: Kit;
  kits: { id: string; name: string; presetId: string | null }[];
  preset: Preset | null;
  samples: SampleMeta[];
  selectedId: string;
  select(id: string): void;
  updatePad(id: string, patch: Partial<Pad>): void;
  addPad(): void;
  removePad(id: string): void;
  setKitName(name: string): void;
  setMaster(v: number): void;
  selectKit(id: string): void;
  duplicateKit(): void;
  deleteKit(id: string): void;
  resetKitSounds(): void;
  resetLayout(): void;
  importFiles(files: FileList | File[], assignTo?: string, field?: SampleField): Promise<{ ok: number; failed: string[] }>;
  removeSample(id: string): Promise<void>;
  exportKit(): void;
  ready: boolean;
  kitLoading: boolean;
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
  const [st, setSt] = useState<Persisted>(() => withAllPresets(load(STATE_KEY, defaultState())));
  const [userSamples, setUserSamples] = useState<SampleMeta[]>(() =>
    load(SAMPLES_KEY, [] as SampleMeta[]).map((s) => ({ ...s, source: 'user' as const }))
  );
  const [selectedId, setSelectedId] = useState<string>(() => st.pads.find((p) => p.id === 'snare')?.id ?? st.pads[0]?.id ?? '');
  const [ready, setReady] = useState(false);
  const [kitLoading, setKitLoading] = useState(false);

  const current = st.kits.find((k) => k.id === st.currentKitId) ?? st.kits[0];

  const kit = useMemo<Kit>(
    () => ({
      id: current.id,
      name: current.name,
      presetId: current.presetId,
      master: st.master,
      pads: st.pads.map((p) => ({ ...p, ...EMPTY_SOUND, ...current.sounds[p.id] }))
    }),
    [st.pads, st.master, current]
  );
  const kitRef = useRef(kit);
  kitRef.current = kit;

  // Built-in synth sounds + the first kit before showing the UI.
  useEffect(() => {
    let alive = true;
    engine
      .loadBuiltins()
      .then(() => engine.preload(kitRef.current.pads.flatMap(allSamples)))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  // Load the samples of a kit when switching to it.
  const sampleSig = kit.pads.map((p) => allSamples(p).join(',')).join('|');
  useEffect(() => {
    if (!ready) return;
    const ids = kitRef.current.pads.flatMap(allSamples).filter((id) => !engine.has(id));
    if (!ids.length) return;
    let alive = true;
    setKitLoading(true);
    void engine.preload(ids).finally(() => alive && setKitLoading(false));
    return () => {
      alive = false;
    };
  }, [sampleSig, ready]);

  useEffect(() => {
    const t = setTimeout(() => save(STATE_KEY, st), 250);
    engine.setMaster(st.master);
    return () => clearTimeout(t);
  }, [st]);

  useEffect(() => save(SAMPLES_KEY, userSamples), [userSamples]);

  const updateSounds = useCallback((fn: (sounds: Record<string, PadSound>) => Record<string, PadSound>) => {
    setSt((s) => ({ ...s, kits: s.kits.map((k) => (k.id === s.currentKitId ? { ...k, sounds: fn(k.sounds) } : k)) }));
  }, []);

  const updatePad = useCallback(
    (id: string, patch: Partial<Pad>) => {
      const soundPatch: Partial<PadSound> = {};
      const padPatch: Partial<Pad> = {};
      for (const [k, v] of Object.entries(patch)) {
        if ((SOUND_FIELDS as string[]).includes(k)) (soundPatch as Record<string, unknown>)[k] = v;
        else (padPatch as Record<string, unknown>)[k] = v;
      }
      if (Object.keys(padPatch).length) setSt((s) => ({ ...s, pads: s.pads.map((p) => (p.id === id ? { ...p, ...padPatch } : p)) }));
      if (Object.keys(soundPatch).length) updateSounds((snd) => ({ ...snd, [id]: { ...(snd[id] ?? EMPTY_SOUND), ...soundPatch } }));
    },
    [updateSounds]
  );

  const addPad = useCallback(() => {
    setSt((s) => {
      const used = new Set(s.pads.map((p) => p.channel));
      let channel = -1;
      for (let c = 0; c < 8; c++) if (!used.has(c)) { channel = c; break; }
      const n = s.pads.length + 1;
      const slot = EXTRA_SLOTS[Math.max(0, s.pads.length - 8) % EXTRA_SLOTS.length];
      const id = 'pad-' + Date.now().toString(36);
      setSelectedId(id);
      return { ...s, pads: [...s.pads, pad({ id, name: 'ชิ้นที่ ' + n, th: 'ชิ้นใหม่', channel, x: slot.x, y: slot.y, w: 12, midiNote: 60 + n, key: '' })] };
    });
  }, []);

  const removePad = useCallback((id: string) => {
    setSt((s) => {
      const pads = s.pads.filter((p) => p.id !== id);
      setSelectedId((cur) => (cur === id ? pads[0]?.id ?? '' : cur));
      return { ...s, pads };
    });
  }, []);

  const importFiles = useCallback(
    async (files: FileList | File[], assignTo?: string, key: SampleField = 'samples') => {
      const added: SampleMeta[] = [];
      const failed: string[] = [];
      for (const f of Array.from(files)) {
        try {
          const data = await f.arrayBuffer();
          const buf = await engine.decode(data);
          const id = 'u:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
          await putSample(id, data);
          engine.setBuffer(id, buf);
          added.push({ id, name: f.name, category: guessCategory(f.name), duration: buf.duration, builtin: false, source: 'user' });
        } catch {
          failed.push(f.name);
        }
      }
      if (added.length) {
        setUserSamples((s) => [...s, ...added]);
        if (assignTo) {
          updateSounds((snd) => {
            const cur = { ...EMPTY_SOUND, ...snd[assignTo] };
            return { ...snd, [assignTo]: { ...cur, [key]: [...cur[key], ...added.map((a) => a.id)] } };
          });
        }
      }
      return { ok: added.length, failed };
    },
    [updateSounds]
  );

  const removeSample = useCallback(async (id: string) => {
    await deleteSample(id).catch(() => undefined);
    engine.forget(id);
    setUserSamples((s) => s.filter((x) => x.id !== id));
    setSt((s) => ({
      ...s,
      kits: s.kits.map((k) => ({
        ...k,
        sounds: Object.fromEntries(Object.entries(k.sounds).map(([pid, snd]) => [pid, { ...snd, ...Object.fromEntries(SAMPLE_FIELDS.map((f) => [f, (snd[f] ?? []).filter((x) => x !== id)])) }]))
      }))
    }));
  }, []);

  const exportKit = useCallback(() => {
    const k = kitRef.current;
    const blob = new Blob([JSON.stringify(k, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = k.name.replace(/[^\w฀-๿ -]/g, '') + '.drumkit.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, []);

  const value = useMemo<Store>(
    () => ({
      kit,
      kits: st.kits.map((k) => ({ id: k.id, name: k.name, presetId: k.presetId })),
      preset: PRESETS.find((p) => p.id === current.presetId) ?? null,
      samples: [...builtinMeta, ...userSamples],
      selectedId,
      select: setSelectedId,
      updatePad,
      addPad,
      removePad,
      setKitName: (name) => setSt((s) => ({ ...s, kits: s.kits.map((k) => (k.id === s.currentKitId ? { ...k, name } : k)) })),
      setMaster: (master) => setSt((s) => ({ ...s, master })),
      selectKit: (id) => setSt((s) => ({ ...s, currentKitId: id })),
      duplicateKit: () =>
        setSt((s) => {
          const src = s.kits.find((k) => k.id === s.currentKitId) ?? s.kits[0];
          const copy: KitSounds = { id: 'kit-' + Date.now().toString(36), name: src.name + ' (ของฉัน)', presetId: null, sounds: JSON.parse(JSON.stringify(src.sounds)) };
          return { ...s, kits: [...s.kits, copy], currentKitId: copy.id };
        }),
      deleteKit: (id) =>
        setSt((s) => {
          const kits = s.kits.filter((k) => k.id !== id || k.presetId);
          return { ...s, kits, currentKitId: s.currentKitId === id ? kits[0].id : s.currentKitId };
        }),
      resetKitSounds: () =>
        setSt((s) => {
          const k = s.kits.find((x) => x.id === s.currentKitId);
          const p = PRESETS.find((x) => x.id === k?.presetId);
          if (!k || !p) return s;
          return { ...s, kits: s.kits.map((x) => (x.id === k.id ? kitFromPreset(p) : x)) };
        }),
      resetLayout: () => {
        setSt((s) => ({ ...s, pads: defaultPads() }));
        setSelectedId('snare');
      },
      importFiles,
      removeSample,
      exportKit,
      ready,
      kitLoading
    }),
    [kit, st.kits, current, userSamples, selectedId, updatePad, addPad, removePad, importFiles, removeSample, exportKit, ready, kitLoading]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}
