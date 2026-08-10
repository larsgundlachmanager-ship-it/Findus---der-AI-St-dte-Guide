/**
 * Schließzeiten-Hilfen für Dining (früher module5/scheduleFitCombine).
 */

export function closingTimeAllowsStay(
  arrivalMin: number,
  closeMin: number | null,
  stayMin: number,
): boolean {
  if (closeMin == null || !Number.isFinite(closeMin)) return true;
  let close = closeMin;
  if (close <= arrivalMin) close += 24 * 60;
  return arrivalMin + stayMin <= close;
}

/** Extrahiert früheste Schließzeit (Minuten) aus Facts-Text. */
export function extractCloseMinutesFromFacts(facts: string[]): number | null {
  const joined = facts.join(' ').toLowerCase();
  const re = /(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/g;
  let m: RegExpExecArray | null;
  let bestClose: number | null = null;
  while ((m = re.exec(joined)) !== null) {
    const close = Number(m[3]) * 60 + Number(m[4]);
    if (bestClose == null || close > bestClose) bestClose = close;
  }
  return bestClose;
}
