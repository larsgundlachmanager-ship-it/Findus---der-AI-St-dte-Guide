/**
 * Pending: Tour-Dauer-Nachfrage — Follow-up merged in M2.
 */

import { create } from 'zustand';
import type { TourRequest } from './types';

type PendingDuration = {
  requestId: string;
  partialRequest: TourRequest;
  askedAtMs: number;
};

type State = {
  pending: PendingDuration | null;
  setPending: (p: PendingDuration | null) => void;
  takeIfMatch: (text: string) => TourRequest | null;
};

const DURATION_ANSWER_RE =
  /\b(\d+)\s*(min|minute|minuten|stunden?|h)\b|\beine\s+stunde\b|\bhalbe\s+stunde\b|\bzwei\s+stunden\b/iu;

export const useTourDurationPendingStore = create<State>((set, get) => ({
  pending: null,
  setPending: (p) => set({ pending: p }),
  takeIfMatch: (text) => {
    const p = get().pending;
    if (!p) return null;
    if (Date.now() - p.askedAtMs > 15 * 60_000) {
      set({ pending: null });
      return null;
    }
    if (!DURATION_ANSWER_RE.test(text) && !/^\s*\d+\s*$/u.test(text)) {
      return null;
    }
    set({ pending: null });
    return p.partialRequest;
  },
}));

export function parseDurationAnswerMin(text: string): number | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (/\bhalbe\s+stunde\b/iu.test(t)) return 30;
  if (/\beine\s+stunde\b/iu.test(t) || /\b1\s*h\b/iu.test(t)) return 60;
  if (/\bzwei\s+stunden\b/iu.test(t)) return 120;
  const hours = t.match(/(\d+)\s*(stunden?|h)\b/iu);
  if (hours) return Math.min(480, Number(hours[1]) * 60);
  const mins = t.match(/(\d+)\s*(min|minute|minuten)?\b/iu);
  if (mins) {
    const n = Number(mins[1]);
    if (n > 0 && n <= 480) return n <= 12 && !/min/i.test(t) ? n * 60 : n;
  }
  return null;
}
