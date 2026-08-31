/**
 * Keep-Alive-Segmente stapeln. pickBest ist nur für dasselbe wachsende
 * Interim — sonst frisst das längere Android-Stück den Anfang.
 */
export function joinSttSegments(committed: string, current: string): string {
  const a = committed.replace(/\s+/g, ' ').trim();
  const b = current.replace(/\s+/g, ' ').trim();
  if (!b) return a;
  if (!a) return b;
  if (a === b) return a;
  if (b.startsWith(a) || a.startsWith(b)) {
    return a.length >= b.length ? a : b;
  }
  if (a.includes(b)) return a;
  return `${a} ${b}`.replace(/\s+/g, ' ').trim();
}
