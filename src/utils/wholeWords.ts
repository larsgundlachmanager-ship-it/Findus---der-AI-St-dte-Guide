/**
 * Text an Wortgrenzen kürzen (Bullets, Labels — kein Untertitel-System).
 */

const DEFAULT_MAX_CHARS = 78;
const MIN_FILL_RATIO = 0.38;

export function truncateToWholeWords(
  text: string,
  maxChars: number = DEFAULT_MAX_CHARS,
  opts?: { ellipsis?: boolean },
): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length <= maxChars) return t;
  const cut = findBestCutExclusive(t, 0, maxChars);
  const out = t.slice(0, cut).trimEnd();
  if (!out) {
    const first = t.split(/\s+/)[0] ?? '';
    return first.length <= maxChars ? first : '';
  }
  if (opts?.ellipsis === false) return out;
  return `${out}…`;
}

function findBestCutExclusive(
  text: string,
  start: number,
  maxChars: number,
): number {
  const hard = Math.min(start + maxChars, text.length);
  if (hard >= text.length) return text.length;
  let overflow = hard;
  if (hard < text.length && !/\s/.test(text[hard]!)) {
    const prevSpace = text.lastIndexOf(' ', hard);
    if (prevSpace >= start) overflow = prevSpace;
    else {
      const nextSpace = text.indexOf(' ', hard);
      return nextSpace < 0 ? text.length : nextSpace;
    }
  }
  const minCut = start + Math.floor(maxChars * MIN_FILL_RATIO);
  for (let i = overflow; i > minCut; i -= 1) {
    if (i === text.length) return text.length;
    const at = text[i]!;
    if (/\s/.test(at)) {
      let c = i;
      while (c > start && /\s/.test(text[c - 1]!)) c -= 1;
      return c;
    }
  }
  const fallbackSpace = text.lastIndexOf(' ', hard);
  if (fallbackSpace > start) return fallbackSpace;
  return hard;
}
