/**
 * Narration-Resume — merkt POI + Story-Text + ungefähren Offset während Modul-1.
 */

export type NarrationKind = 'teaser' | 'main' | 'deep';

export type NarrationResumeState = {
  poiId: number;
  poiName: string;
  kind: NarrationKind;
  fullText: string;
  /** Zeichen, die schon gesprochen / gezeigt wurden */
  spokenCharOffset: number;
  updatedAtMs: number;
};

let state: NarrationResumeState | null = null;

export function clearNarrationResume(): void {
  state = null;
}

export function getNarrationResumeState(): NarrationResumeState | null {
  if (!state) return null;
  if (Date.now() - state.updatedAtMs > 30 * 60_000) {
    state = null;
    return null;
  }
  return state;
}

export function beginNarrationResume(opts: {
  poiId: number;
  poiName: string;
  kind: NarrationKind;
  fullText?: string;
}): void {
  const full = (opts.fullText || '').replace(/\s+/g, ' ').trim();
  state = {
    poiId: opts.poiId,
    poiName: (opts.poiName || `Ort #${opts.poiId}`).trim(),
    kind: opts.kind,
    fullText: full,
    spokenCharOffset: 0,
    updatedAtMs: Date.now(),
  };
}

export function appendNarrationResumeText(chunk: string): void {
  if (!state) return;
  const t = (chunk || '').replace(/\s+/g, ' ').trim();
  if (!t) return;
  if (!state.fullText) {
    state.fullText = t;
  } else if (!state.fullText.includes(t.slice(0, Math.min(40, t.length)))) {
    state.fullText = `${state.fullText} ${t}`.trim();
  }
  state.updatedAtMs = Date.now();
}

/** Untertitel / hörbarer Fortschritt → Offset anheben (nie zurück). */
export function noteNarrationSpokenProgress(spokenSoFar: string): void {
  if (!state) return;
  const n = (spokenSoFar || '').length;
  if (n > state.spokenCharOffset) {
    state.spokenCharOffset = n;
    state.updatedAtMs = Date.now();
  }
}

export function completeNarrationResume(): void {
  state = null;
}

/** Resttext ab Offset (Wortgrenze). */
export function remainingNarrationText(
  snap?: NarrationResumeState | null,
): string {
  const s = snap ?? state;
  if (!s?.fullText) return '';
  let off = Math.max(0, Math.min(s.spokenCharOffset, s.fullText.length));
  if (off > 0 && off < s.fullText.length) {
    const slice = s.fullText.slice(off);
    const sp = slice.search(/\s/);
    if (sp >= 0 && sp < 24) off += sp + 1;
  }
  return s.fullText.slice(off).trim();
}
