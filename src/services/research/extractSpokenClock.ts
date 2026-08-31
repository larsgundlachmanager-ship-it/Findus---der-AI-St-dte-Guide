/**
 * Uhr aus Fließtext ziehen — nur belegte Ziffern-Uhren, nichts erfinden.
 * SSOT für Events, Showtimes, Öffnungszeiten-Nachzug.
 */

const CLOCK_HM =
  /\b(?:ab|um|gegen)?\s*(\d{1,2})[:.](\d{2})(?:\s*uhr)?\b/iu;

const CLOCK_UHR =
  /\b(?:ab|um|gegen)?\s*(\d{1,2})\s*uhr(?:\s*(\d{1,2}))?\b/iu;

const CLOCK_H =
  /\b(?:ab|um)\s+(\d{1,2})\s*h(?:ours?)?\b/iu;

function padClock(h: number, m: number): string | null {
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Normalisiert "20 Uhr" / "ab 21:00" → "21:00". Unlesbar → null. */
export function extractSpokenClock(blob: string | null | undefined): string | null {
  const t = String(blob ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;

  const hm = t.match(CLOCK_HM);
  if (hm) {
    const clock = padClock(Number(hm[1]), Number(hm[2]));
    if (clock) return clock;
  }

  const uhr = t.match(CLOCK_UHR);
  if (uhr) {
    const clock = padClock(Number(uhr[1]), uhr[2] != null ? Number(uhr[2]) : 0);
    if (clock) return clock;
  }

  const hOnly = t.match(CLOCK_H);
  if (hOnly) {
    const clock = padClock(Number(hOnly[1]), 0);
    if (clock) return clock;
  }

  return null;
}

const END_CLOCK_HM =
  /\b(?:bis|endet|ende|schließt|zu)\s*(?:um\s*)?(\d{1,2})[:.](\d{2})(?:\s*uhr)?\b/iu;
const END_CLOCK_UHR =
  /\b(?:bis|endet|ende|schließt|zu)\s*(?:um\s*)?(\d{1,2})\s*uhr(?:\s*(\d{1,2}))?\b/iu;

/** „bis 23:30“ / „endet um 22 Uhr“ → "23:30". Start-Uhren nicht hier. */
export function extractSpokenEndClock(
  blob: string | null | undefined,
): string | null {
  const t = String(blob ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;

  const hm = t.match(END_CLOCK_HM);
  if (hm) {
    const clock = padClock(Number(hm[1]), Number(hm[2]));
    if (clock) return clock;
  }

  const uhr = t.match(END_CLOCK_UHR);
  if (uhr) {
    const clock = padClock(
      Number(uhr[1]),
      uhr[2] != null ? Number(uhr[2]) : 0,
    );
    if (clock) return clock;
  }

  return null;
}
