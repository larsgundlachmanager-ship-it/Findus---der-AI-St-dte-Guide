/**
 * Kurze Stempel-Stichpunkte aus gesprochenem Tour-Text.
 */

const BULLET_EMOJIS = ['✨', '📌', '🗝️'] as const;

/** Max length for a stamp bullet (readable on a card). */
const MAX_BULLET = 68;

export function toStampBullets(
  spoken: string[],
  max = 3,
): string[] {
  const chunks: string[] = [];

  for (const raw of spoken) {
    const cleaned = raw
      .replace(/\s+/g, ' ')
      .replace(/^[\s•\-–—]+/u, '')
      .trim();
    if (cleaned.length < 18) continue;

    // Prefer first clause of each sentence
    for (const part of cleaned.split(/(?<=[.!?…])\s+/u)) {
      let clause = part.replace(/[.!?…]+$/u, '').trim();
      if (clause.length < 18) continue;
      // Drop long list-y / address-y lines
      if (/^\d{4,}|straße|str\.|tel\.|öffnungs/i.test(clause)) continue;
      if (clause.length > MAX_BULLET) {
        const cut = clause.slice(0, MAX_BULLET - 1);
        const at = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf(','));
        clause = `${(at > 40 ? cut.slice(0, at) : cut).trim()}…`;
      }
      if (!chunks.some((c) => c.toLowerCase() === clause.toLowerCase())) {
        chunks.push(clause);
      }
      if (chunks.length >= max) break;
    }
    if (chunks.length >= max) break;
  }

  return chunks.slice(0, max);
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
  if (/café|cafe|kaffee|pudding/.test(blob)) return '☕';
  if (/restaurant|fisch|gastronomie|essen/.test(blob)) return '🍽️';
  if (/strand|düne|meer|watt|nordsee/.test(blob)) return '🌊';
  if (/kirche|kapelle|kloster/.test(blob)) return '⛪';
  if (/museum|galerie|kunst/.test(blob)) return '🖼️';
  if (/denkmal|uhr|denkmal|statue|mahnmal/.test(blob)) return '🏛️';
  if (/hafen|fähre|schiff|leuchtturm/.test(blob)) return '⚓';
  if (/park|natur|wald|spielplatz|grün/.test(blob)) return '🌿';
  if (/sport|tennis|golf/.test(blob)) return '🎾';
  if (/bahnhof|zug|schiene/.test(blob)) return '🚂';
  if (/hotel|pension|unterkunft/.test(blob)) return '🛏️';
  if (/shop|laden|markt/.test(blob)) return '🛍️';
  return '📍';
}
