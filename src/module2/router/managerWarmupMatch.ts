/**
 * Pure Match-Helfer für speculative Manager Warmup (kein RN).
 */

/** Nur fast-identisch — Prefix eines 10-Min-Satzes darf Call-1 nicht ersetzen. */
export const WARMUP_MAX_DELTA = 24;

/** Match-Normalisierung: Satzzeichen + STT-Füller weg, Semantik behalten. */
export function normalizeWarmupText(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[?!.,;:…"'„“”]+/g, ' ')
    // Kein \\b — Umlaute sind in JS keine Word-Chars.
    .replace(/(?:^|\s)(?:äh+|ähm+|hm+|öhm+)(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isTrivialWarmupRevision(base: string, next: string): boolean {
  return normalizeWarmupText(base) === normalizeWarmupText(next);
}

/**
 * Near-final: gleicher Kern, kleiner Längen-Delta, gemeinsamer Prefix.
 * Langer Mid-Satz (Hamburg-Compound) → false.
 */
export function warmupMatchesFinalUtterance(
  partial: string,
  finalText: string,
): boolean {
  const na = normalizeWarmupText(partial);
  const nb = normalizeWarmupText(finalText);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length < 8 || nb.length < 8) return false;
  if (Math.abs(na.length - nb.length) > WARMUP_MAX_DELTA) return false;
  const prefixLen = Math.min(40, na.length, nb.length);
  if (
    na.startsWith(nb.slice(0, prefixLen)) ||
    nb.startsWith(na.slice(0, prefixLen))
  ) {
    const shorter = na.length < nb.length ? na : nb;
    const longer = na.length >= nb.length ? na : nb;
    return longer.includes(shorter.slice(0, Math.max(12, shorter.length - 8)));
  }
  // STT-Korrektur mitten im Satz: gleicher Start + kleiner Edit am Ende
  const head = Math.min(16, Math.min(na.length, nb.length));
  if (na.slice(0, head) === nb.slice(0, head)) {
    const tailA = na.slice(-12);
    const tailB = nb.slice(-12);
    if (tailA === tailB || na.includes(tailB) || nb.includes(tailA)) return true;
  }
  return false;
}
