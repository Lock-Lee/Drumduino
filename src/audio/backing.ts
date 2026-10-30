// Backing track ("เพลงประกอบ"): the user's own recording of the song, played in sync with the score.
// Audio files live in IndexedDB (one per score id); offset/volume live in localStorage.
// Playback goes through an <audio> element so slowing the tempo keeps the pitch (preservesPitch).
import { engine } from './engine';
import { alignScore } from './align';
import type { AlignResult } from './align';
import type { Score } from '../score/types';

export interface BackingMeta {
  name: string;
  /** seconds into the file where measure 1, beat 1 of the score falls */
  offset: number;
  /** 0–100 */
  volume: number;
  /** the recording's own tempo, found by auto-align (the score's tempo when unset) */
  songBpm?: number;
}

const META_KEY = 'drumduino.backing.v1';
const DB = 'drumduino-backing';
const STORE = 'files';

export function loadMetaAll(): Record<string, BackingMeta> {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || '{}') as Record<string, BackingMeta>;
  } catch {
    return {};
  }
}
export function saveMeta(scoreId: string, meta: BackingMeta | null) {
  const all = loadMetaAll();
  if (meta) all[scoreId] = meta;
  else delete all[scoreId];
  try {
    localStorage.setItem(META_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export const putFile = (scoreId: string, blob: Blob) => tx('readwrite', (s) => s.put(blob, scoreId));
export const getFile = (scoreId: string) => tx<Blob | undefined>('readonly', (s) => s.get(scoreId) as IDBRequest<Blob | undefined>);
export const deleteFile = (scoreId: string) => tx('readwrite', (s) => s.delete(scoreId));

/** One shared player; the practice page drives it every animation frame. */
class BackingPlayer {
  readonly el = new Audio();
  private gain: GainNode | null = null;
  private url = '';
  loadedId = '';
  duration = 0;

  constructor() {
    this.el.preload = 'auto';
    this.el.preservesPitch = true;
    this.el.addEventListener('loadedmetadata', () => (this.duration = this.el.duration || 0));
  }

  private route() {
    if (this.gain) return;
    // through Web Audio so it shares the output with the drums (and starts with the same unlock)
    const src = engine.ctx.createMediaElementSource(this.el);
    this.gain = engine.ctx.createGain();
    src.connect(this.gain).connect(engine.ctx.destination);
  }

  async load(scoreId: string): Promise<boolean> {
    if (this.loadedId === scoreId && this.url) return true;
    this.unload();
    const blob = await getFile(scoreId).catch(() => undefined);
    if (!blob) return false;
    this.route();
    this.url = URL.createObjectURL(blob);
    this.el.src = this.url;
    this.loadedId = scoreId;
    await new Promise<void>((res) => {
      const done = () => res();
      this.el.addEventListener('loadedmetadata', done, { once: true });
      this.el.addEventListener('error', done, { once: true });
    });
    return !this.el.error;
  }

  unload() {
    this.el.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = '';
    this.loadedId = '';
    this.el.removeAttribute('src');
    this.el.load();
    this.duration = 0;
  }

  setVolume(v: number) {
    if (this.gain) this.gain.gain.value = (v / 100) ** 1.5;
  }

  /**
   * Keep the file at `target` seconds playing at `rate`. Small drift is pulled in by nudging the
   * speed, large jumps (loop back, seeking to a measure) by seeking.
   */
  follow(target: number, rate: number) {
    const el = this.el;
    if (!this.url) return;
    if (target < 0 || (this.duration && target >= this.duration - 0.05)) {
      if (!el.paused) el.pause();
      if (target < 0 && Math.abs(el.currentTime) > 0.01) el.currentTime = 0;
      return;
    }
    const drift = el.currentTime - target;
    if (el.paused || Math.abs(drift) > 0.12) {
      el.currentTime = target;
      el.playbackRate = rate;
      if (el.paused) void el.play().catch(() => undefined);
      return;
    }
    // ±4 % speed nudge at most, proportional to the drift
    const nudge = Math.max(-0.04, Math.min(0.04, -drift * 0.8));
    const r = rate * (1 + (Math.abs(drift) > 0.012 ? nudge : 0));
    if (Math.abs(el.playbackRate - r) > 0.002) el.playbackRate = r;
  }

  pause() {
    this.el.pause();
  }
}

export const backing = new BackingPlayer();

/** Decode the stored file and find where the score starts in it. */
export async function autoAlign(score: Score, progress?: (p: number) => void): Promise<AlignResult | null> {
  const blob = await getFile(score.id);
  if (!blob) return null;
  const buf = await engine.ctx.decodeAudioData(await blob.arrayBuffer());
  const mono = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / buf.numberOfChannels;
  }
  return alignScore(mono, buf.sampleRate, score, progress);
}
