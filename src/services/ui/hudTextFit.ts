/**
 * HUD-Text: max. Zeilen-Budget, kein harter Schnitt an Doppelpunkt/Wortmitte.
 * Umbruch macht React Native an der echten Breite — hier kein künstliches `\n`.
 */

/** ~0.52em Durchschnitt; eher knapp, damit Truncation nicht zu früh greift. */
const HUD_GLYPH_EM = 0.52;

/** Fallback, wenn die Lane noch nicht gemessen ist (volle HUD-Breite, ~360er Phone). */
export const HUD_META_CHARS_PER_LINE = 52;
export const HUD_TITLE_CHARS_PER_LINE = 56;

export function hudCharsForWidth(widthPx: number, fontSize: number): number {
  if (!(widthPx > 0) || !(fontSize > 0)) return HUD_META_CHARS_PER_LINE;
  return Math.max(28, Math.floor(widthPx / (fontSize * HUD_GLYPH_EM)));
}

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

/**
 * Kürzt auf max. Zeilen-Budget. Kein erzwungenes `\n` —
 * sonst bricht der Text um, obwohl in der Live-Anzeige noch Platz ist.
 */
export function fitHudMeta(
  text: string,
  opts?: { maxLines?: number; charsPerLine?: number },
): string {
  const maxLines = opts?.maxLines ?? 2;
  const charsPerLine = opts?.charsPerLine ?? HUD_META_CHARS_PER_LINE;
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const budget = Math.max(1, maxLines) * Math.max(1, charsPerLine);
  if (t.length <= budget) return t;
  return fitHudLine(t, budget);
}
