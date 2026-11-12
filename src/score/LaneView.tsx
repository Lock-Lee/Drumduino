import { useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { PadId, Score } from './types';
import { PPQ, ticksPerMeasure } from './types';
import { LANE_ORDER, PAD_COLOR } from './padColors';
import { stickingFor } from './sticking';

import { t } from '../i18n';

/**
 * "Note highway": one lane per instrument, notes drawn as little drums / cymbals sliding right → left
 * through a fixed playhead. Each stick note carries L / R (same sticking as the 3-D kit), the kick RF
 * and the hi-hat pedal LF. Click anywhere to start from that measure.
 */
export function LaneView({ score, tickRef, bpm, startTick, onSeek }: {
  score: Score;
  tickRef: MutableRefObject<number | null>;
  bpm: number;
  /** where the view rests when nothing is playing */
  startTick: number;
  onSeek: (measure: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  const lanes = useMemo(() => {
    const used = new Set<PadId>(score.notes.map((n) => n.pad));
    return LANE_ORDER.filter((p) => used.has(p));
  }, [score]);
  const notes = useMemo(() => score.notes.slice().sort((a, b) => a.tick - b.tick), [score]);
  const hands = useMemo(() => {
    const spt = 60 / (bpm * PPQ);
    return stickingFor(notes.map((n) => ({ t: n.tick * spt, pad: n.pad, foot: n.pad === 'hihat' && n.art === 'pedal' })));
  }, [notes, bpm]);

  const state = useRef({ score, lanes, notes, hands, startTick, onSeek, ppb: 150, playX: 0, beat: 0 });
  state.current = { ...state.current, score, lanes, notes, hands, startTick, onSeek };

  useEffect(() => {
    const cv = canvas.current!;
    const el = host.current!;
    const g = cv.getContext('2d')!;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let W = 0, H = 0, dpr = 1;
    const size = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = el.clientWidth;
      H = el.clientHeight;
      cv.width = Math.max(1, Math.round(W * dpr));
      cv.height = Math.max(1, Math.round(H * dpr));
      cv.style.width = W + 'px';
      cv.style.height = H + 'px';
      last = NaN;
    };
    const ro = new ResizeObserver(size);
    ro.observe(el);

    let raf = 0;
    let last = NaN;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const s = state.current;
      const tick = tickRef.current ?? s.startTick;
      if (tick === last && !Number.isNaN(last)) return;
      last = tick;
      if (W < 10 || H < 10) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);

      const unit = (PPQ * 4) / s.score.sig[1]; // ticks per counted beat
      const tpm = ticksPerMeasure(s.score);
      const ppb = Math.max(90, Math.min(220, W / 7)) * (unit / PPQ); // px per counted beat
      const playX = Math.round(W * 0.24);
      s.ppb = ppb;
      s.playX = playX;
      const cur = tick / unit;
      s.beat = cur;
      const xOf = (t: number) => playX + (t / unit - cur) * ppb;

      // background
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0f1626');
      bg.addColorStop(1, '#0a0e18');
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);

      const top = 34;
      const n = Math.max(1, s.lanes.length);
      const rowH = (H - top - 10) / n;
      const rowY = (p: PadId) => top + rowH * (s.lanes.indexOf(p) + 0.5);

      // beat grid + labels
      const firstBeat = Math.floor(cur - playX / ppb) - 1;
      const lastBeat = Math.ceil(cur + (W - playX) / ppb) + 1;
      const beatsPerBar = Math.round(tpm / unit);
      g.font = '600 12px "Bai Jamjuree", system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (let b = Math.max(0, firstBeat); b <= lastBeat; b++) {
        const x = playX + (b - cur) * ppb;
        const inBar = b % beatsPerBar;
        const bar = Math.floor(b / beatsPerBar);
        if (bar >= s.score.measures) break;
        g.strokeStyle = inBar === 0 ? 'rgba(220,228,255,0.38)' : 'rgba(220,228,255,0.12)';
        g.lineWidth = inBar === 0 ? 1.5 : 1;
        g.beginPath();
        g.moveTo(x, top - 6);
        g.lineTo(x, H - 8);
        g.stroke();
        g.fillStyle = inBar === 0 ? 'rgba(235,240,255,0.85)' : 'rgba(220,228,255,0.45)';
        g.fillText(inBar === 0 ? `BAR ${bar + 1}` : String(inBar + 1), x, 16);
      }
      // section names
      for (const sec of s.score.sections ?? []) {
        const x = xOf(sec.measure * tpm);
        if (x < -200 || x > W) continue;
        g.textAlign = 'left';
        g.fillStyle = 'rgba(255,214,120,0.9)';
        g.font = '700 12px "Bai Jamjuree", system-ui, sans-serif';
        g.fillText(sec.name, x + 6, top - 2);
        g.textAlign = 'center';
        g.font = '600 12px "Bai Jamjuree", system-ui, sans-serif';
      }

      // lanes
      for (const p of s.lanes) {
        const y = rowY(p);
        g.strokeStyle = hexA(PAD_COLOR[p], 0.35);
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(W, y);
        g.stroke();
      }

      // notes in view (binary search for the first one)
      const tFrom = (firstBeat - 1) * unit, tTo = (lastBeat + 1) * unit;
      let lo = 0, hi = s.notes.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (s.notes[mid].tick < tFrom) lo = mid + 1;
        else hi = mid;
      }
      const size0 = Math.min(rowH * 0.42, 22);
      for (let i = lo; i < s.notes.length && s.notes[i].tick <= tTo; i++) {
        const nt = s.notes[i];
        if (!s.lanes.includes(nt.pad)) continue;
        const x = xOf(nt.tick);
        const y = rowY(nt.pad);
        const dist = x - playX;
        const passed = dist < -3;
        const near = Math.abs(dist) < ppb * 0.12;
        const sz = size0 * (0.8 + 0.3 * (nt.vel / 127));
        g.globalAlpha = passed ? 0.32 : 1;
        if (near && !reduce) {
          g.shadowColor = PAD_COLOR[nt.pad];
          g.shadowBlur = 18;
        }
        glyph(g, nt.pad, nt.art, x, y, sz, PAD_COLOR[nt.pad]);
        g.shadowBlur = 0;
        // sticking / foot label
        const h = s.hands[i];
        const lab = h ?? (nt.pad === 'kick' ? 'RF' : nt.pad === 'hihat' && nt.art === 'pedal' ? 'LF' : '');
        if (lab) {
          // under the note when the lane is tall enough, otherwise just after it
          const roomy = rowH > 40;
          g.font = `800 ${roomy ? 11 : 10}px "Bai Jamjuree", system-ui, sans-serif`;
          g.fillStyle = h === 'L' ? '#ffffff' : h === 'R' ? '#9fd0ff' : '#ffb3c6';
          if (roomy) g.fillText(lab, x, y + sz * 0.95 + 7);
          else {
            g.textAlign = 'left';
            g.fillText(lab, x + sz * 1.15 + 2, y + 1);
            g.textAlign = 'center';
          }
        }
        if (nt.art === 'open') {
          g.strokeStyle = '#ffffff';
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(x, y - sz * 0.95, 3.5, 0, Math.PI * 2);
          g.stroke();
        }
        g.globalAlpha = 1;
      }

      // playhead
      g.shadowColor = 'rgba(255,255,255,0.8)';
      g.shadowBlur = 10;
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(playX, top - 8);
      g.lineTo(playX, H - 6);
      g.stroke();
      g.shadowBlur = 0;

      // lane icons on the left edge
      g.fillStyle = 'rgba(10,14,24,0.85)';
      g.fillRect(0, top - 8, 40, H - top + 8);
      for (const p of s.lanes) glyph(g, p, 'normal', 20, rowY(p), Math.min(rowH * 0.32, 13), PAD_COLOR[p]);
    };
    raf = requestAnimationFrame(draw);

    const onClick = (e: MouseEvent) => {
      const s = state.current;
      const r = cv.getBoundingClientRect();
      const unit = (PPQ * 4) / s.score.sig[1];
      const beat = s.beat + (e.clientX - r.left - s.playX) / s.ppb;
      const m = Math.floor((beat * unit) / ticksPerMeasure(s.score));
      if (m >= 0 && m < s.score.measures) s.onSeek(m);
    };
    cv.addEventListener('click', onClick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      cv.removeEventListener('click', onClick);
    };
  }, [tickRef]);

  return (
    <div ref={host} className="lane-view">
      <canvas ref={canvas} role="img" aria-label={t("เลนโน้ต: โน้ตเลื่อนจากขวาไปซ้ายผ่านเส้นเล่น แต่ละแถวคือกลองหนึ่งชิ้น L/R คือมือที่ใช้ตี คลิกเพื่อเริ่มจากห้องนั้น")} />
    </div>
  );
}

function hexA(hex: string, a: number) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

/** tiny instrument pictures */
function glyph(g: CanvasRenderingContext2D, pad: PadId, art: string, x: number, y: number, s: number, color: string) {
  g.lineWidth = 2;
  g.strokeStyle = color;
  g.fillStyle = hexA(color, 0.28);
  if (pad === 'kick') {
    g.beginPath();
    g.arc(x, y, s * 0.8, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.beginPath();
    g.arc(x, y, s * 0.45, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(x - s * 0.55, y + s * 0.6);
    g.lineTo(x - s * 0.8, y + s * 0.95);
    g.moveTo(x + s * 0.55, y + s * 0.6);
    g.lineTo(x + s * 0.8, y + s * 0.95);
    g.stroke();
    return;
  }
  if (pad === 'crash' || pad === 'ride' || pad === 'hihat') {
    if (art === 'pedal') {
      // hi-hat foot: a pedal
      g.beginPath();
      g.roundRect(x - s * 0.35, y - s * 0.7, s * 0.7, s * 1.4, 3);
      g.fill();
      g.stroke();
      return;
    }
    const rx = s * 1.05, ry = s * 0.28;
    g.beginPath();
    g.moveTo(x, y + ry);
    g.lineTo(x, y + s * 0.9);
    g.moveTo(x - s * 0.35, y + s * 0.9);
    g.lineTo(x + s * 0.35, y + s * 0.9);
    g.stroke();
    if (pad === 'hihat') {
      g.beginPath();
      g.ellipse(x, y + ry * 0.9, rx, ry * 0.8, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(x, y - ry * 0.35, rx * 0.28, ry * 0.6, 0, 0, Math.PI * 2);
    g.fill();
    return;
  }
  // snare / toms: a small drum
  const rx = s * (pad === 'floor' ? 0.95 : 0.85), ry = s * 0.3, top = y - s * 0.35, bot = y + s * (pad === 'floor' ? 0.55 : 0.35);
  g.beginPath();
  g.moveTo(x - rx, top);
  g.lineTo(x - rx, bot);
  g.ellipse(x, bot, rx, ry, 0, Math.PI, 0, true);
  g.lineTo(x + rx, top);
  g.closePath();
  g.fill();
  g.stroke();
  g.beginPath();
  g.ellipse(x, top, rx, ry, 0, 0, Math.PI * 2);
  g.fillStyle = hexA(color, 0.5);
  g.fill();
  g.stroke();
  if (art === 'rim' || art === 'xstick') {
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.5;
    g.beginPath();
    g.ellipse(x, top, rx * 1.12, ry * 1.25, 0, 0, Math.PI * 2);
    g.stroke();
  }
}
