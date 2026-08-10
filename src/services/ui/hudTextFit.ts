/**
 * HUD-Text: max. Zeilen, kein harter Schnitt an Doppelpunkt/Wortmitte.
 */

export function fitHudLine(text: string, maxChars: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length <= maxChars) return t;
  let cut = t.slice(0, maxChars);
  const breakAt = Math.max(
    cut.lastIndexOf(' '),
    cut.lastIndexOf('·'),
    cut.lastIndexOf('—'),
    cut.lastIndexOf('-'),
  );
  if (breakAt > maxChars * 0.45) cut = cut.slice(0, breakAt);
  return cut.replace(/[:·,;/\-–—]\s*$/u, '').trim();
}

/** Bis zu `maxLines` Zeilen à ~`charsPerLine` Zeichen. */
export function fitHudMeta(
  text: string,
  opts?: { maxLines?: number; charsPerLine?: number },
): string {
  const maxLines = opts?.maxLines ?? 2;
  const charsPerLine = opts?.charsPerLine ?? 38;
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length <= charsPerLine) return t;

  const words = t.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= charsPerLine) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    cur = w;
    if (lines.length >= maxLines) break;
  }
  if (lines.length < maxLines && cur) {
    lines.push(fitHudLine(cur, charsPerLine));
  }
  while (lines.length > maxLines) lines.pop();
  // Letzte Zeile ggf. kürzen ohne Doppelpunkt-Abfall
  if (lines.length) {
    const last = lines.length - 1;
    lines[last] = fitHudLine(lines[last]!, charsPerLine);
  }
  return lines.filter(Boolean).join('\n');
}
