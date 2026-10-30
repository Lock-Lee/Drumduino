import { useEffect, useRef } from 'react';
import { engine } from '../audio/engine';
import type { Kit } from '../types';
import type { PadId } from './types';
import { PAD_LABEL } from './types';

/**
 * A drawn drum kit for the practice page. Every hit the engine reports (the app playing the score,
 * the Arduino, MIDI, the keyboard or a click) flashes that drum and swings a stick onto it;
 * the kick and the hi-hat pedal move a foot pedal instead.
 * Animations run imperatively (Web Animations API) so fast 16ths never re-render React.
 */

type Hand = 'L' | 'R';
interface Spot { x: number; y: number; hand: Hand; cym?: boolean }

// stick-tip contact points in the SVG (viewBox 0 0 640 250)
const SPOT: Record<Exclude<PadId, 'kick'>, Spot> = {
  hihat: { x: 118, y: 112, hand: 'R', cym: true },
  crash: { x: 186, y: 48, hand: 'R', cym: true },
  snare: { x: 236, y: 150, hand: 'L' },
  tom1: { x: 282, y: 92, hand: 'L' },
  tom2: { x: 364, y: 92, hand: 'R' },
  floor: { x: 452, y: 160, hand: 'R' },
  ride: { x: 512, y: 68, hand: 'R', cym: true }
};
// where each hand's stick butt points (the drummer sits below the kit)
const HAND_BASE: Record<Hand, { x: number; y: number }> = { L: { x: 250, y: 330 }, R: { x: 400, y: 330 } };
const IDLE: Record<Hand, Exclude<PadId, 'kick'>> = { L: 'snare', R: 'hihat' };
const STICK = 170;

function pose(tip: { x: number; y: number }, hand: Hand, lift: number) {
  const b = HAND_BASE[hand];
  const ang = (Math.atan2(b.y - tip.y, b.x - tip.x) * 180) / Math.PI;
  // lifting = tip rises and the stick tilts back toward the hand
  const tilt = hand === 'L' ? -lift * 0.35 : lift * 0.35;
  return `translate(${tip.x}px, ${tip.y - lift}px) rotate(${ang + tilt}deg)`;
}

export function DrumKitView({ kit }: { kit: Kit }) {
  const root = useRef<SVGSVGElement>(null);
  const kitRef = useRef(kit);
  kitRef.current = kit;

  useEffect(() => {
    const svg = root.current;
    if (!svg) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const q = <T extends Element>(sel: string) => svg.querySelector(sel) as T | null;
    const stick: Record<Hand, SVGGElement | null> = { L: q('[data-stick=L]'), R: q('[data-stick=R]') };
    const last: Record<Hand, { t: number; pad: string }> = { L: { t: 0, pad: IDLE.L }, R: { t: 0, pad: IDLE.R } };
    for (const h of ['L', 'R'] as Hand[]) {
      const s = stick[h];
      if (s) s.style.transform = pose(SPOT[IDLE[h]], h, 34);
    }

    const flash = (id: string, v: number) => {
      const k = Math.max(0.35, v / 127);
      const glow = q<SVGElement>(`[data-glow=${id}]`);
      glow?.animate([{ opacity: k }, { opacity: 0 }], { duration: 320, easing: 'ease-out' });
      const body = q<SVGGElement>(`[data-pad=${id}]`);
      if (!body || reduce) return;
      const cym = id === 'hihat' || id === 'crash' || id === 'ride';
      body.animate(
        cym
          ? [{ transform: `rotate(${4 * k}deg)` }, { transform: `rotate(${-2 * k}deg)`, offset: 0.35 }, { transform: 'rotate(0deg)' }]
          : [{ transform: `scale(${1 + 0.05 * k})` }, { transform: 'scale(1)' }],
        { duration: cym ? 420 : 180, easing: 'ease-out' }
      );
    };

    const strike = (id: Exclude<PadId, 'kick'>, v: number) => {
      const spot = SPOT[id];
      const now = performance.now();
      const other: Hand = spot.hand === 'L' ? 'R' : 'L';
      // the preferred hand is still busy (fast roll / two pads at once) → use the other one
      let hand: Hand = spot.hand;
      if (now - last[hand].t < 95 && now - last[other].t >= 95) hand = other;
      last[hand] = { t: now, pad: id };
      const s = stick[hand];
      if (!s) return;
      const up = 20 + 26 * (v / 127);
      if (reduce) {
        s.style.transform = pose(spot, hand, 6);
        return;
      }
      s.style.transform = pose(spot, hand, up);
      s.animate([{ transform: pose(spot, hand, 0) }, { transform: pose(spot, hand, up) }], { duration: 190, easing: 'cubic-bezier(.2,.7,.3,1)' });
    };

    const foot = (which: 'kick' | 'hhpedal', v: number) => {
      const el = q<SVGGElement>(`[data-foot=${which}]`);
      if (!el || reduce) return;
      const a = which === 'kick' ? -26 * Math.max(0.5, v / 127) : 14;
      el.animate([{ transform: `rotate(${a}deg)` }, { transform: 'rotate(0deg)' }], { duration: 200, easing: 'ease-out' });
    };

    return engine.onHit((padId, v, zone) => {
      const id = padId as PadId;
      if (id === 'kick') {
        flash('kick', v);
        foot('kick', v);
        return;
      }
      if (!(id in SPOT)) return;
      if (id === 'hihat' && zone === 'pedal') {
        foot('hhpedal', v);
        flash('hihat', v * 0.5);
        return;
      }
      flash(id, v);
      strike(id as Exclude<PadId, 'kick'>, v);
    });
  }, []);

  const hit = (id: PadId) => {
    const p = kitRef.current.pads.find((x) => x.id === id);
    if (p) engine.play(p, 100, 'ui');
  };
  const padProps = (id: PadId) => ({
    'data-pad': id,
    role: 'button',
    tabIndex: 0,
    'aria-label': `ตี ${PAD_LABEL[id]}`,
    className: 'kv-pad',
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); hit(id); },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hit(id); } }
  });

  // shell (side) + head, drawn front-on with a slight top view
  const drum = (id: PadId, x: number, y: number, rx: number, ry: number, h: number, shell: string, labelAbove = false) => (
    <g {...padProps(id)} style={{ transformOrigin: `${x}px ${y + h / 2}px`, transformBox: 'view-box' }}>
      <path d={`M${x - rx},${y} v${h} a${rx},${ry} 0 0 0 ${rx * 2},0 v${-h}`} fill={shell} stroke="#0b0b0d" strokeWidth="1.5" />
      <path d={`M${x - rx},${y + 4} a${rx},${ry} 0 0 0 ${rx * 2},0`} fill="none" stroke="#c9ccd3" strokeOpacity=".55" strokeWidth="2.5" />
      <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="#E9E6DE" stroke="#b8bcc4" strokeWidth="3" />
      <ellipse data-glow={id} cx={x} cy={y} rx={rx} ry={ry} fill="var(--accent)" opacity="0" />
      <text x={x} y={labelAbove ? y - ry - 6 : y + h + ry + 14} className="kv-label">{PAD_LABEL[id]}</text>
    </g>
  );
  const cymbal = (id: PadId, x: number, y: number, rx: number, ry: number, standTo: number, label = PAD_LABEL[id]) => (
    <g>
      <line x1={x} y1={y + 2} x2={x} y2={standTo} stroke="#5d6068" strokeWidth="3" />
      <g {...padProps(id)} style={{ transformOrigin: `${x}px ${y}px`, transformBox: 'view-box' }}>
        <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="url(#kv-bronze)" stroke="#8a6a26" strokeWidth="1.5" />
        <ellipse cx={x} cy={y - 1} rx={rx * 0.18} ry={ry * 0.45} fill="#caa24d" />
        <ellipse data-glow={id} cx={x} cy={y} rx={rx} ry={ry} fill="#fff3cf" opacity="0" />
      </g>
      <text x={x} y={y - ry - 6} className="kv-label">{label}</text>
    </g>
  );

  return (
    <svg ref={root} className="kv" viewBox="0 0 640 250" role="group" aria-label="ชุดกลอง แตะเพื่อตี">
      <defs>
        <linearGradient id="kv-bronze" x1="0" x2="1">
          <stop offset="0" stopColor="#a87b25" />
          <stop offset=".5" stopColor="#e6c169" />
          <stop offset="1" stopColor="#a87b25" />
        </linearGradient>
        <linearGradient id="kv-shell" x1="0" x2="1">
          <stop offset="0" stopColor="#5a1d1d" />
          <stop offset=".45" stopColor="#a8342e" />
          <stop offset="1" stopColor="#4a1717" />
        </linearGradient>
        <linearGradient id="kv-snare" x1="0" x2="1">
          <stop offset="0" stopColor="#8d9097" />
          <stop offset=".45" stopColor="#e1e3e7" />
          <stop offset="1" stopColor="#7d8087" />
        </linearGradient>
        <linearGradient id="kv-stick" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={STICK} y2="0">
          <stop offset="0" stopColor="#f3dcae" />
          <stop offset="1" stopColor="#c99a55" />
        </linearGradient>
      </defs>

      {/* kick: front head */}
      <g {...padProps('kick')} style={{ transformOrigin: '323px 168px', transformBox: 'view-box' }}>
        <circle cx="323" cy="168" r="66" fill="url(#kv-shell)" stroke="#0b0b0d" strokeWidth="2" />
        <circle cx="323" cy="168" r="57" fill="#1b1c20" stroke="#c9ccd3" strokeOpacity=".5" strokeWidth="3" />
        <circle data-glow="kick" cx="323" cy="168" r="57" fill="var(--accent)" opacity="0" />
        <text x="323" y="173" className="kv-label kv-kick">DrumDuino</text>
      </g>
      <text x="323" y="248" className="kv-label">{PAD_LABEL.kick}</text>

      {/* kick pedal + beater */}
      <g data-foot="kick" style={{ transformOrigin: '323px 236px', transformBox: 'view-box' }}>
        <line x1="323" y1="236" x2="323" y2="200" stroke="#9aa0aa" strokeWidth="3" />
        <circle cx="323" cy="198" r="7" fill="#e9e6de" stroke="#6b6f78" />
      </g>

      {/* hi-hat (pair) with pedal */}
      {cymbal('hihat', 118, 108, 50, 9, 236)}
      <ellipse cx="118" cy="116" rx="50" ry="8" fill="url(#kv-bronze)" stroke="#8a6a26" strokeWidth="1.2" opacity=".85" pointerEvents="none" />
      <g data-foot="hhpedal" style={{ transformOrigin: '96px 238px', transformBox: 'view-box' }}>
        <rect x="96" y="232" width="44" height="8" rx="3" fill="#6b6f78" />
      </g>

      {cymbal('crash', 186, 44, 60, 12, 236)}
      {cymbal('ride', 512, 64, 68, 13, 236)}

      {drum('tom1', 282, 88, 36, 12, 30, 'url(#kv-shell)', true)}
      {drum('tom2', 364, 88, 38, 13, 32, 'url(#kv-shell)', true)}
      {drum('snare', 236, 146, 46, 15, 24, 'url(#kv-snare)')}
      {drum('floor', 452, 154, 54, 17, 52, 'url(#kv-shell)')}

      {/* sticks: drawn tip at (0,0), butt toward +x; positioned by transform */}
      {(['L', 'R'] as Hand[]).map((h) => (
        <g key={h} data-stick={h} className="kv-stick" style={{ transformBox: 'view-box', transformOrigin: '0 0' }} pointerEvents="none">
          <line x1="0" y1="0" x2={STICK} y2="0" stroke="#3b2a12" strokeWidth="7" strokeLinecap="round" opacity=".45" transform="translate(2 3)" />
          <line x1="2" y1="0" x2={STICK} y2="0" stroke="url(#kv-stick)" strokeWidth="5.5" strokeLinecap="round" />
          <ellipse cx="2" cy="0" rx="4.5" ry="3.6" fill="#f6e6c4" />
        </g>
      ))}
    </svg>
  );
}
