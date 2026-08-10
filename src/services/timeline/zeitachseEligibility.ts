/**
 * Zeitachse-Gate: Orte nur wenn
 * — Modul-1-Hauptpunkt angelaufen/erzählt, oder
 * — User ≥ 2 Minuten am Ort war.
 */

export const ZEITACHSE_MIN_DWELL_MIN = 2;
export const ZEITACHSE_MIN_DWELL_MS = ZEITACHSE_MIN_DWELL_MIN * 60_000;

function dwellFromFacts(keyFacts?: string[] | null): number | null {
  if (!keyFacts?.length) return null;
  for (const f of keyFacts) {
    const m = f.match(/verweilt\s+(\d+)/i);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

export function qualifiesForZeitachse(opts: {
  /** Explizit freigegeben (Modul 1 / Dwell-Gate) */
  onTimeline?: boolean | null;
  /** Modul-1-Hauptpunkt hat angefangen / Story gelaufen */
  module1Hauptpunkt?: boolean | null;
  dwellMin?: number | null;
  dwellMs?: number | null;
  source?: string | null;
  keyFacts?: string[] | null;
}): boolean {
  if (opts.onTimeline === false) return false;
  if (opts.onTimeline === true) return true;
  if (opts.module1Hauptpunkt === true) return true;

  const facts = opts.keyFacts ?? [];
  if (facts.some((f) => /per\s+gps\s+entdeckt/i.test(f))) return false;
  if (facts.some((f) => /modul\s*-?\s*1|hauptpunkt/i.test(f))) return true;

  const dwellMin =
    opts.dwellMin ??
    (opts.dwellMs != null
      ? Math.round(opts.dwellMs / 60_000)
      : dwellFromFacts(facts));

  if (dwellMin != null && dwellMin >= ZEITACHSE_MIN_DWELL_MIN) return true;

  // Visit-Log: Nav-Ankunft ohne Dwell noch nicht
  if (opts.source === 'nav' || opts.source === 'plan') return false;
  if (opts.source === 'dwell') return false;

  // Legacy Stempel ohne Flag: Narration hat Story-Fakten, Walk nur GPS-Zeile
  if (opts.source === 'stamp' || opts.source == null) {
    if (facts.length > 0 && !facts.every((f) => /per\s+gps|^\d+\.\d+,\s*\d+/i.test(f))) {
      return true;
    }
  }

  return false;
}
