/**
 * Modul 5 — Speech-Sanitizer + Stichpunkt-Normalisierung.
 */

const EMAIL_RE = /\b[\w.+-]+@[\w.-]+\.\w{2,}\b/g;
const PHONE_RE = /(?:\+|00)?\d[\d\s/().-]{6,}\d/g;
const STREET_RE =
  /\b[\wÄÖÜäöüß.-]+(?:straße|strasse|str\.|platz|weg|allee|gasse|ring|damm)\s*\d{0,4}[a-zA-Z]?\b/gi;
const PLZ_CITY_RE = /\b\d{5}\s+[A-ZÄÖÜ][\wÄÖÜäöüß.-]+/g;

export function sanitizePlanSpeech(text: string): string {
  return (text ?? '')
    .replace(EMAIL_RE, '')
    .replace(PHONE_RE, '')
    .replace(STREET_RE, '')
    .replace(PLZ_CITY_RE, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
}

/**
 * Max. 3 Stichpunkte — Fakten/Zahlen zuerst.
 * „4,3★ Gut“ ersetzt „gut bewertet“; keine Doppel-Sterne-Zeilen.
 */
export function normalizePlanBullets(
  raw: Array<string | null | undefined>,
  max = 3,
): string[] {
  const cleaned = raw
    .map((x) => (x == null ? '' : String(x).trim()))
    .filter(Boolean)
    .map((s) =>
      s
        .replace(EMAIL_RE, '')
        .replace(PHONE_RE, '')
        .replace(/^📍\s*/, '')
        // „4.3★ Gut bewertet“ → „4.3★ Gut“
        .replace(/\b(\d+[.,]\d+)\s*★?\s*(Top|Gut|Okay)?\s*bewertet\b/i, '$1★ $2')
        .replace(/\b(Top|Gut|Okay)\s*bewertet\b/i, '')
        .replace(/\s{2,}/g, ' ')
        .trim(),
    )
    .filter((s) => s.length > 1)
    // Fake-Distanz / GPS-Meta nie behalten
    .filter((s) => !/0\s*m|aktuelle\s+gps|gps-position/i.test(s));

  // Dedup ähnliche Sterne-Zeilen
  const seenStar = { has: false };
  const deduped: string[] = [];
  for (const s of cleaned) {
    const isStar = /\d+[.,]?\d*\s*★/.test(s) || /stern/i.test(s);
    if (isStar) {
      if (seenStar.has) continue;
      seenStar.has = true;
    }
    if (
      deduped.some(
        (d) => d.toLowerCase() === s.toLowerCase() || d.includes(s) || s.includes(d),
      )
    ) {
      continue;
    }
    deduped.push(s);
  }

  const score = (s: string): number => {
    let n = 0;
    if (/\d/.test(s)) n += 4;
    if (/€|eur|pizza|burger|pasta|min|km|\bm\b|vom |lage|fischmarkt|elb/i.test(s)) {
      n += 3;
    }
    if (/★/.test(s)) n += 2;
    if (/bewert|favorit|alternative|toll|super/i.test(s)) n -= 2;
    if (/straße|strasse|str\.|@/i.test(s)) n -= 5;
    // GPS-Meta / Fake-Distanz nie oben
    if (/0\s*m|aktuelle\s+gps|gps-position/i.test(s)) n -= 20;
    return n;
  };

  return [...deduped].sort((a, b) => score(b) - score(a)).slice(0, max);
}

/** Sterne-Label: Zahl + Wort — ersetzt „gut bewertet“. */
export function starBullet(rating: number | null | undefined): string | null {
  if (rating == null || !Number.isFinite(rating)) return null;
  const n = Math.round(rating * 10) / 10;
  const word = rating >= 4.5 ? 'Top' : rating >= 4.0 ? 'Gut' : rating >= 3.5 ? 'Okay' : 'Schwach';
  return `${n}★ ${word}`;
}
