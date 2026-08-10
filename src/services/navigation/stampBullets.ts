/**
 * Kurze Stempel-Zusammenfassung — nüchtern, ortsbezogen.
 * Keine Dramatik („Rettungsanker“), keine Spekulation als Fakt.
 */

const BULLET_EMOJIS = ['📌', '✨', '🗝️'] as const;

const MAX_SUMMARY = 96;

/** Absolute/dramatische Claims — klingen wie passiert, waren oft nur Hook. */
const HYPE_RE =
  /\b(rettungsanker|rettet dich|unbedingt|absolut|muss man|legendär|legendaren|der beste|die beste|geheimtipp|game.?changer|lebensretter|pflicht|nicht verpassen|perfekt für dich)\b/iu;

const HOOKY_RE =
  /^(hey|schau mal|na[,!]|hand aufs herz|riechst du|spürst du|magst du|lust auf|bist du|warst du|tüt-tüt)/iu;

function cleanClause(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^[\s•\-–—✨📌🗝️]+/u, '')
    .replace(/[.!?…]+$/u, '')
    .trim();
}

function isUsableFact(clause: string): boolean {
  if (clause.length < 16 || clause.length > 160) return false;
  if (HYPE_RE.test(clause)) return false;
  if (HOOKY_RE.test(clause)) return false;
  if (/^\d{4,}|straße|str\.|tel\.|öffnungs|user-frage/i.test(clause)) return false;
  if (/\?$/.test(clause) && clause.length < 50) return false;
  return true;
}

function shorten(text: string, max = MAX_SUMMARY): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const at = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf(','));
  return `${(at > 40 ? cut.slice(0, at) : cut).trim()}…`;
}

/**
 * Eine kurze, nüchterne Zusammenfassung für die Stempelkarte.
 * Preferenz: teaser → erste brauchbare Faktzeile → Fallback.
 */
export function toStampSummary(
  spoken: string[],
  opts?: { teaser?: string | null; name?: string | null },
): string {
  const teaser = opts?.teaser?.replace(/\s+/g, ' ').trim();
  if (teaser && isUsableFact(teaser) && !HYPE_RE.test(teaser)) {
    return shorten(cleanClause(teaser));
  }

  for (const raw of spoken) {
    const cleaned = cleanClause(raw);
    if (!cleaned) continue;
    for (const part of cleaned.split(/(?<=[.!?…])\s+/u)) {
      const clause = cleanClause(part);
      if (!isUsableFact(clause)) continue;
      return shorten(clause);
    }
  }

  const name = opts?.name?.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim();
  return name ? `Kurz besucht: ${name}.` : 'Hier warst du vorbei.';
}

/** @deprecated — Stempelkarte nutzt toStampSummary; bleibt für Speicher-Kompatibilität. */
export function toStampBullets(spoken: string[], max = 1): string[] {
  const one = toStampSummary(spoken);
  return one ? [one].slice(0, max) : [];
}

export function stampBulletWithEmoji(text: string, index: number): string {
  const emoji = BULLET_EMOJIS[index % BULLET_EMOJIS.length];
  const bare = text.replace(/^[\s✨📌🗝️•\-–—]+/u, '').trim();
  return `${emoji} ${bare}`;
}

export function emojiForPlace(input: {
  kind?: string | null;
  category?: string | null;
  name?: string | null;
}): string {
  const blob = `${input.kind ?? ''} ${input.category ?? ''} ${input.name ?? ''}`.toLowerCase();
  if (/geldautomat|bankomat|sparkasse|atm|service/.test(blob)) return '💶';
  if (/café|cafe|kaffee|pudding/.test(blob)) return '☕';
  if (/restaurant|fisch|gastronomie|essen/.test(blob)) return '🍽️';
  if (/strand|düne|meer|watt|nordsee|aussicht/.test(blob)) return '🌊';
  if (/kirche|kapelle|kloster/.test(blob)) return '⛪';
  if (/museum|galerie|kunst/.test(blob)) return '🖼️';
  if (/denkmal|uhr|statue|mahnmal/.test(blob)) return '🏛️';
  if (/hafen|fähre|schiff|leuchtturm/.test(blob)) return '⚓';
  if (/park|natur|wald|spielplatz|grün/.test(blob)) return '🌿';
  if (/sport|tennis|golf|freizeit/.test(blob)) return '🎾';
  if (/bahnhof|zug|schiene|transport/.test(blob)) return '🚂';
  if (/hotel|pension|unterkunft/.test(blob)) return '🛏️';
  if (/shop|laden|markt|einkauf/.test(blob)) return '🛍️';
  return '📍';
}
