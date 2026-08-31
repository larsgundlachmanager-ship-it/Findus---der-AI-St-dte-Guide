/**
 * Modul-5 Walk: Pitch-Reihenfolge nach User-Steps, nicht alles in einem Satz.
 * 0 Frühstück → 1 Abend/Sunset → 2 Landmarke (Q&A oder Ticket) → 3 Rest. Tour danach.
 */

export function looksLikeBreakfastWishText(t: string): boolean {
  return /\b(frühstück(?:en)?|fruehstueck(?:en)?|breakfast)\b/i.test(t);
}

export function looksLikeEveningMealWishText(t: string): boolean {
  return /\b(sonnenuntergang|sunset|abendessen|dinner|pann(?:en)?fisch|elbblick)\b/i.test(
    t,
  );
}

/** Michel / Turm / Eintritt — Landmarke (nicht Explore-Klumpen). */
export function looksLikeLandmarkPitchText(t: string): boolean {
  if (/\b(bahn|zug|flug|öpnv|oepnv)\s*(ticket|fahrkarte)\b/i.test(t)) return false;
  if (/\b(michel|museum|kirche|dom|turm|aussichtsturm)\b/i.test(t)) return true;
  return (
    /\b(eintritt|ticketpreis|raufgeh|hochgeh|rauf\s*geh|wie\s+teuer)\b/i.test(t) &&
    !/\b(bahn|zug|flug)\b/i.test(t)
  );
}

/**
 * Landmarke schon gewählt + Fragen (Preis/Höhe/Aussicht) → Q&A, kein Top-2-Pitch.
 */
export function looksLikeLandmarkQaText(t: string): boolean {
  if (!looksLikeLandmarkPitchText(t)) return false;
  if (/\b(andere|alternative|vorschlagen|suche\s+mir|empfehl)\b/i.test(t)) {
    return false;
  }
  return (
    /\b(wie\s+(teuer|hoch|lang|sieht|ist)|was\s+ist|erzähl|aussicht|lohnt|eintritt|ticket|raufgeh|hochgeh)\b/i.test(
      t,
    ) || /\bmichel\b/i.test(t)
  );
}

export function pitchWalkRank(w: {
  title: string;
  context: string;
  estimatedTime?: string | null;
}): number {
  const t = `${w.title} ${w.context}`;
  if (looksLikeBreakfastWishText(t)) return 0;
  if (
    looksLikeEveningMealWishText(t) ||
    (Boolean(w.estimatedTime) && (w.estimatedTime as string) >= '17:30')
  ) {
    return 1;
  }
  if (looksLikeLandmarkPitchText(t) || looksLikeLandmarkQaText(t)) return 2;
  return 3;
}

/** Abendessen vor Sonnenuntergang (Fallback 19:30). */
export function dinnerHmBeforeSunset(fallback = '19:30'): string {
  try {
    const { getLastWeatherSnapshot } = require('../../services/weatherService') as {
      getLastWeatherSnapshot: () => { sunsetMs?: number | null } | null;
    };
    const sunset = getLastWeatherSnapshot?.()?.sunsetMs;
    if (typeof sunset === 'number' && Number.isFinite(sunset)) {
      const d = new Date(sunset - 60 * 60_000);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    }
  } catch {
    /* soft */
  }
  return fallback;
}
