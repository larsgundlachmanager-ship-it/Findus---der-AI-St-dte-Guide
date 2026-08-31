/**
 * Heuristik: aus langem Gelaber mehrere actionable Intents ziehen.
 * Kein Ersatz für Manager-LLM — Fallback wenn intents[] leer/dünn.
 */

import type { RouterIntentItem, ChatLane } from './routeAllowlist';

const SPLIT_RE =
  /\b(?:und\s+dann|danach|außerdem|ausserdem|zusätzlich|zusaetzlich|sowie|und\s+auch|,?\s+und\s+)\b/giu;

function laneForClause(clause: string): ChatLane {
  const t = clause.toLowerCase();
  if (/\b(bring|führ|fuehr|navigier|fahr\s+mich|lauf\s+mich)\b/.test(t)) {
    return 'nav';
  }
  if (/\b(hotel|übernacht|uebernacht|unterkunft)\b/.test(t)) return 'pitch';
  if (/\b(parkplatz|parken|parkhaus)\b/.test(t)) return 'pitch';
  if (
    /\b(restaurant|essen|hunger|café|cafe|frühstück|fruehstueck|pizza)\b/.test(t)
  ) {
    return 'pitch';
  }
  if (/\b(erkunden|rundgang|tour|sehenswürdigkeit|highlights)\b/.test(t)) {
    return 'm1';
  }
  if (
    /\b(tagesplan|planen|timeline|vormittag|nachmittag|meeting|termin)\b/.test(t)
  ) {
    return 'plan';
  }
  if (/\b(wetter|anziehen|regen|sonne)\b/.test(t)) return 'chat';
  return 'chat';
}

/**
 * Spaltet lange Äußerungen in bis zu 6 Intents.
 * Kurztexte (< 80 Zeichen, kein Splitter) → leer (Manager bleibt SSOT).
 */
export function splitRambleIntents(userText: string): RouterIntentItem[] {
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  if (t.length < 80 && !SPLIT_RE.test(t)) return [];
  SPLIT_RE.lastIndex = 0;

  const parts = t
    .split(SPLIT_RE)
    .map((p) => p.replace(/^[\s,.;:!?]+|[\s,.;:!?]+$/g, '').trim())
    .filter((p) => p.length >= 8);

  if (parts.length < 2) {
    // Ein Block, aber lang: letzte Frage/Imperativ bevorzugen
    const lastQ = t.match(/([^.!?]{12,}[?!]|(?:bring|führ|suche|find|plan|zeig)\b[^.!?]{8,})/iu);
    if (lastQ?.[1] && t.length >= 120) {
      return [
        {
          id: 'r1',
          lane: laneForClause(lastQ[1]),
          blueprintId: null,
          brief: lastQ[1].slice(0, 120),
          dependsOn: null,
        },
      ];
    }
    return [];
  }

  const seen = new Set<string>();
  const out: RouterIntentItem[] = [];
  for (let i = 0; i < parts.length && out.length < 8; i++) {
    const brief = parts[i]!.slice(0, 120);
    const key = brief.toLowerCase().slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `r${i + 1}`,
      lane: laneForClause(brief),
      blueprintId: null,
      brief,
      dependsOn: i > 0 ? `r${i}` : null,
    });
  }
  return out;
}
