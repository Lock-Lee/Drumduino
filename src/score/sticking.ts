import type { PadId } from './types';

export type Hand = 'L' | 'R';
export type HandPad = Exclude<PadId, 'kick'>;
export const CYM = new Set<HandPad>(['hihat', 'ride', 'crash']);
// who gets the right hand when two pads are hit together
const RANK: Record<HandPad, number> = { ride: 7, hihat: 6, crash: 5, floor: 4, tom2: 3, tom1: 2, snare: 1 };

/**
 * Decides which hand plays each stick note, like a real drummer.
 * - Notes that arrive together go to both hands (the pad further to the drummer's right
 *   — ride, hi-hat, crash … — gets the right hand).
 * - A note that follows the previous one quickly alternates hands (R L R L): rolls, fills,
 *   ghost notes, fast 16th hi-hats.
 * - After a pause the natural hand leads: cymbals right, a fill right,
 *   a snare under a right-hand groove left.
 */
export function createSticking(play: (hand: Hand, id: HandPad, velocity: number) => void) {
  let prev = { hand: 'R' as Hand, t: -1e9 };
  let lastCymR = -1e9;
  let batch: { id: HandPad; v: number }[] = [];
  let timer = 0;
  const assign = (hand: Hand, n: { id: HandPad; v: number }, t: number) => {
    play(hand, n.id, n.v);
    if (hand === 'R' && CYM.has(n.id)) lastCymR = t;
  };
  const flush = () => {
    timer = 0;
    const t = performance.now() / 1000;
    const notes = batch.sort((a, b) => RANK[b.id] - RANK[a.id]);
    batch = [];
    if (notes.length >= 2) {
      assign('R', notes[0], t);
      assign('L', notes[1], t);
      prev = { hand: 'R', t };
      return;
    }
    const n = notes[0];
    if (!n) return;
    const gap = t - prev.t;
    let hand: Hand;
    if (gap < (CYM.has(n.id) ? 0.13 : 0.26)) hand = prev.hand === 'R' ? 'L' : 'R';
    else if (CYM.has(n.id)) hand = 'R';
    else if (n.id === 'snare' || n.id === 'tom1') hand = t - lastCymR < 0.5 ? 'L' : 'R';
    else hand = 'R';
    assign(hand, n, t);
    prev = { hand, t };
  };
  return {
    /** report a stick note; notes within 8 ms are treated as played together */
    push(id: HandPad, v: number) {
      batch.push({ id, v });
      if (!timer) timer = window.setTimeout(flush, 8);
    },
    dispose() {
      window.clearTimeout(timer);
    }
  };
}

/**
 * The same sticking worked out ahead of time for a whole score (for showing L / R on the notes).
 * `times` are seconds, sorted; returns one entry per note: 'L' | 'R' for stick notes, null for feet.
 */
export function stickingFor(notes: { t: number; pad: string; foot?: boolean }[]): (Hand | null)[] {
  const out: (Hand | null)[] = notes.map(() => null);
  let prev = { hand: 'R' as Hand, t: -1e9 };
  let lastCymR = -1e9;
  for (let i = 0; i < notes.length; ) {
    // group of notes played together (within 8 ms)
    let j = i;
    const group: number[] = [];
    while (j < notes.length && notes[j].t - notes[i].t < 0.008) {
      if (!notes[j].foot && notes[j].pad !== 'kick') group.push(j);
      j++;
    }
    const t = notes[i].t;
    if (group.length) {
      const sorted = group.sort((a, b) => RANK[notes[b].pad as HandPad] - RANK[notes[a].pad as HandPad]);
      if (sorted.length >= 2) {
        out[sorted[0]] = 'R';
        out[sorted[1]] = 'L';
        for (const k of sorted.slice(2)) out[k] = 'L';
        if (CYM.has(notes[sorted[0]].pad as HandPad)) lastCymR = t;
        prev = { hand: 'R', t };
      } else {
        const id = notes[sorted[0]].pad as HandPad;
        const gap = t - prev.t;
        let hand: Hand;
        if (gap < (CYM.has(id) ? 0.13 : 0.26)) hand = prev.hand === 'R' ? 'L' : 'R';
        else if (CYM.has(id)) hand = 'R';
        else if (id === 'snare' || id === 'tom1') hand = t - lastCymR < 0.5 ? 'L' : 'R';
        else hand = 'R';
        out[sorted[0]] = hand;
        if (hand === 'R' && CYM.has(id)) lastCymR = t;
        prev = { hand, t };
      }
    }
    i = j;
  }
  return out;
}
