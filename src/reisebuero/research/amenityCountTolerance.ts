/**
 * Zahlen-Musts mit Toleranz (Saunen usw.) — Reisebüro Verify.
 */

export function scoreCountAmenity(opts: {
  wanted: number;
  found: number | null | undefined;
}): 'perfect' | 'near' | 'weak' | 'fail' | 'unknown' {
  const w = opts.wanted;
  const f = opts.found;
  if (f == null || !Number.isFinite(f)) return 'unknown';
  if (f >= w) return 'perfect';
  if (f >= w - 1 && f >= 7) return 'near'; // 8→7 ok
  if (f >= 6) return 'near';
  if (f >= 4) return 'weak';
  return 'fail';
}

export function parseSaunaCountFromText(text: string): number | null {
  const m = text.match(/(\d+)\s*saunen?\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
