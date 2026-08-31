/**
 * Echo-Schutz: eigene TTS nicht als User-Äußerung werten.
 */

let lastSpokenNorm = '';
let lastSpokenAtMs = 0;

function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^\wäöüß\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Yorro hat gerade gesprochen — für Echo-Filter merken. */
export function noteFindusSpokenForEcho(text: string): void {
  const n = norm(text).slice(0, 220);
  if (n.length < 8) return;
  lastSpokenNorm = n;
  lastSpokenAtMs = Date.now();
}

/**
 * true = Transcript sieht aus wie Nachhall der eigenen Stimme.
 * Fenster ~4s nach TTS; Ähnlichkeit über Prefix/Includes.
 */
export function looksLikeFindusEcho(
  transcript: string,
  withinMs = 4_000,
): boolean {
  if (!lastSpokenNorm || Date.now() - lastSpokenAtMs > withinMs) return false;
  const t = norm(transcript);
  if (t.length < 6) return false;

  if (lastSpokenNorm.includes(t) && t.length >= 10) return true;
  if (t.includes(lastSpokenNorm.slice(0, Math.min(40, lastSpokenNorm.length)))) {
    return true;
  }

  // Wort-Overlap
  const a = new Set(lastSpokenNorm.split(' ').filter((w) => w.length > 2));
  const b = t.split(' ').filter((w) => w.length > 2);
  if (b.length === 0 || a.size === 0) return false;
  let hit = 0;
  for (const w of b) if (a.has(w)) hit += 1;
  return hit / b.length >= 0.72 && b.length >= 3;
}
