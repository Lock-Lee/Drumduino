const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const Logo = () => (
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="#F2A93B" strokeWidth="2" aria-hidden="true">
    <ellipse cx="14" cy="9" rx="10" ry="4" />
    <path d="M4 9v10c0 2.2 4.5 4 10 4s10-1.8 10-4V9" />
    <path d="M9 3l5 6M19 3l-5 6" />
  </svg>
);
export const Plus = () => (<svg width="16" height="16" viewBox="0 0 16 16" {...s} aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>);
export const Close = () => (<svg width="16" height="16" viewBox="0 0 16 16" {...s} aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>);
export const PlayIcon = () => (<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><path d="M3 2l9 5-9 5z" /></svg>);
export const Stop = () => (<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1" /></svg>);
export const Up = () => (<svg width="16" height="16" viewBox="0 0 16 16" {...s} aria-hidden="true"><path d="M8 12V4M4.5 7.5L8 4l3.5 3.5" /></svg>);
export const Down = () => (<svg width="16" height="16" viewBox="0 0 16 16" {...s} aria-hidden="true"><path d="M8 4v8M4.5 8.5L8 12l3.5-3.5" /></svg>);
export const Upload = () => (<svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="#F2A93B" strokeWidth="2" aria-hidden="true"><path d="M16 21V7M10 13l6-6 6 6" /><path d="M6 21v4h20v-4" /></svg>);
export const Search = () => (<svg width="16" height="16" viewBox="0 0 16 16" {...s} aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>);
export const Move = () => (<svg width="16" height="16" viewBox="0 0 16 16" {...s} aria-hidden="true"><path d="M8 2v12M2 8h12M8 2L6 4M8 2l2 2M8 14l-2-2M8 14l2-2M2 8l2-2M2 8l2 2M14 8l-2-2M14 8l-2 2" /></svg>);
export const Trash = () => (<svg width="16" height="16" viewBox="0 0 16 16" {...s} aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></svg>);
export const Wave = () => (<svg width="34" height="22" viewBox="0 0 36 24" fill="none" stroke="#F2A93B" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M7 8v8M12 3v18M17 6v12M22 9v6M27 10v4M32 11v2" /></svg>);
