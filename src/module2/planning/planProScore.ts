/**
 * Modul 5 — Flash vs Pro (Geld-Deckel).
 * Pro max. 2× / Session; Start nur bei Score ≥ 4.
 */

export type PlanProScoreHints = {
  wishCount: number;
  hardAnchors: number;
  hasLogistics: boolean;
  multiCity: boolean;
  hardFilters: number;
  bigGapHours: number;
  multiDay?: boolean;
};

const MAX_PRO_PER_SESSION = 2;

let sessionProUsed = 0;
let sessionActive = false;

export function beginPlanProSession(): void {
  sessionActive = true;
  sessionProUsed = 0;
}

export function endPlanProSession(): void {
  sessionActive = false;
  sessionProUsed = 0;
}

export function getPlanProUsed(): number {
  return sessionProUsed;
}

/** Score wie im Masterplan: ≥4 → Start-Call darf Pro. */
export function scorePlanningComplexity(h: PlanProScoreHints): number {
  let score = 0;
  const over = Math.max(0, (h.wishCount || 0) - 3);
  score += over;
  if ((h.hardAnchors || 0) >= 2) score += 2;
  if (h.hasLogistics) score += 2;
  if (h.multiCity) score += 2;
  if ((h.hardFilters || 0) >= 3) score += 1;
  if ((h.bigGapHours || 0) >= 3) score += 1;
  if (h.multiDay) score += 2;
  return score;
}

/** Heuristik aus Rohtext, bevor Ingest fertig ist. */
export function scoreFromUtterance(text: string): PlanProScoreHints {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  const wishParts = t.split(
    /\b(?:und\s+dann|danach|zuerst|außerdem|ausserdem|sowie|plus|,)\b/i,
  );
  const wishCount = Math.max(
    1,
    wishParts.filter((p) => p.trim().length > 8).length,
  );
  const hardAnchors =
    (t.match(
      /\b(um\s+\d{1,2}(?::\d{2})?\s*uhr|\d{1,2}:\d{2}|meeting|termin|flug|abflug|check-?out|check-?in)\b/gi,
    )?.length ?? 0) >= 2
      ? 2
      : /\b(um\s+\d{1,2}|meeting|termin|flug)\b/i.test(t)
        ? 1
        : 0;
  const hasLogistics =
    /\b(flug|flieger|check-?out|check-?in|wecker|leave|los\s*muss|öpnv|bahn\s+um)\b/i.test(
      t,
    );
  const multiCity =
    /\b(nach\s+\w+|von\s+\w+\s+nach|rein\s*(?:fahr|fahrn)|anreise)\b/i.test(t) &&
    /\b(erkunden|stadt|hamburg|berlin|kiel|münchen|muenchen)\b/i.test(t);
  const hardFilters =
    (/\b(pannfisch|elbblick|laptop|homeoffice|vegetar|vegan|gluten)\b/i.test(t)
      ? 2
      : 0) + (/\b(terrase|terrasse|draußen|draussen|blick)\b/i.test(t) ? 1 : 0);
  const bigGapHours = /\b(erkunden|bummel|tour|mehrere\s+stunden|ganze[nr]?\s+nachmittag)\b/i.test(
    t,
  )
    ? 3
    : 0;
  const multiDay =
    /\b(heute\b.*\bmorgen\b|\bmorgen\b.*\bsonntag\b|übermorgen|uebermorgen|nächste[rn]?\s+tage)\b/i.test(
      t,
    ) ||
    (/\b(heute|morgen|sonntag|montag|dienstag)\b/i.test(t) &&
      /\b(und\s+(morgen|sonntag|montag)|sowie\s+(morgen|sonntag))\b/i.test(t));
  return {
    wishCount,
    hardAnchors,
    hasLogistics,
    multiCity,
    hardFilters,
    bigGapHours,
    multiDay,
  };
}

/**
 * Ob dieser Call Pro nutzen darf.
 * reason: 'ingest_start' | 'final_conflict' | 'flash_failed'
 */
export function tryConsumePlanProSlot(
  reason: 'ingest_start' | 'final_conflict' | 'flash_failed',
  score?: number,
): boolean {
  if (!sessionActive) {
    beginPlanProSession();
  }
  if (sessionProUsed >= MAX_PRO_PER_SESSION) return false;
  if (reason === 'ingest_start') {
    if ((score ?? 0) < 4) return false;
  }
  if (reason === 'final_conflict' || reason === 'flash_failed') {
    // allowed if budget left
  }
  sessionProUsed += 1;
  return true;
}

export function geminiOptsForPlanIngest(text: string): {
  tier?: 'lite' | 'pro';
  forcePro?: boolean;
  flashFailed?: boolean;
  task: 'itinerary';
} {
  const hints = scoreFromUtterance(text);
  const score = scorePlanningComplexity(hints);
  const usePro = tryConsumePlanProSlot('ingest_start', score);
  return {
    task: 'itinerary',
    ...(usePro ? { tier: 'pro' as const, forcePro: true } : { tier: 'lite' as const }),
  };
}
