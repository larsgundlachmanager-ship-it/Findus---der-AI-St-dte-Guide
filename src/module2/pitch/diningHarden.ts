/**
 * Dining harden helpers — IN Pitch (kein neues Gastro-Modul).
 * SSOT: docs/rfc/agent-harden-contract.md
 */

/** Tourist-Trap soft demote: viele Reviews + mittelmäßige Bewertung. */
export function touristTrapRankPenalty(opts: {
  rating?: number | null;
  ratingCount?: number | null;
  softTags?: string[] | null;
}): number {
  const rating = Number(opts.rating ?? 0);
  const n = Number(opts.ratingCount ?? 0);
  const tags = (opts.softTags || []).join(' ').toLowerCase();
  if (/tourist|falle|trap|überlaufen|ueberlaufen/.test(tags)) return -12;
  if (n >= 800 && rating > 0 && rating < 4.2) return -10;
  if (n >= 400 && rating > 0 && rating < 4.0) return -8;
  if (n >= 200 && rating > 0 && rating < 3.8) return -6;
  return 0;
}

/** Budget/Person aus Satz — soft. */
export function parseBudgetPerPersonEur(userText: string): number | null {
  const t = String(userText || '').replace(/\s+/g, ' ');
  const m =
    t.match(
      /\b(?:max(?:imal)?|bis|unter|budget)\s*(?:von\s*)?(\d{1,3})\s*(?:€|eur|euro)?\s*(?:pro\s*(?:person|kopf)|p\.?\s*p\.?|\/\s*p(?:erson)?)/iu,
    ) ||
    t.match(
      /\b(\d{1,3})\s*(?:€|eur|euro)\s*(?:pro\s*(?:person|kopf)|p\.?\s*p\.?)/iu,
    );
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n < 500 ? n : null;
}

/** Open-now: hier_jetzt → geschlossene hart raus außer alle zu. */
export function filterOpenNowHard<T extends { openNow?: boolean | null; closedOnVisitDay?: boolean | null }>(
  list: T[],
  mode: 'here_now' | 'later' | string,
): { kept: T[]; allClosed: boolean } {
  if (mode !== 'here_now' && mode !== 'open_now') {
    return { kept: list, allClosed: false };
  }
  const open = list.filter(
    (c) => c.openNow !== false && c.closedOnVisitDay !== true,
  );
  if (open.length) return { kept: open, allClosed: false };
  return { kept: list, allClosed: true };
}

/** Dish-Need Token für Specialty/SearchBrief. */
export function diningDishNeedFromText(userText: string): string | null {
  try {
    const {
      extractCravingDishToken,
      looksLikeSpecialtyFoodAsk,
      specializedFoodNeedles,
    } = require('./specializedFoodMatch') as {
      extractCravingDishToken: (s: string) => string | null;
      looksLikeSpecialtyFoodAsk: (s: string) => boolean;
      specializedFoodNeedles: (s: string) => string[];
    };
    const craving = extractCravingDishToken(userText);
    if (craving) return craving;
    if (looksLikeSpecialtyFoodAsk(userText)) {
      const needles = specializedFoodNeedles(userText);
      return needles[0] || null;
    }
  } catch {
    /* soft */
  }
  const m = String(userText || '').match(
    /\b(?:mit|ohne)\s+([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß-]{2,24})\b/iu,
  );
  if (m?.[1] && /rucola|pesto|trüffel|trueffel|kimchi|halloumi/iu.test(m[1])) {
    return m[1];
  }
  return null;
}

/** Speisekarte-Button nur mit belegter URL. */
export function syncMenuOpenUrlAction(opts: {
  menuUrl?: string | null;
  label?: string;
}): { type: 'OPEN_URL'; label: string; payload: { url: string } } | null {
  const url = String(opts.menuUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  return {
    type: 'OPEN_URL',
    label: opts.label || 'Speisekarte',
    payload: { url },
  };
}
