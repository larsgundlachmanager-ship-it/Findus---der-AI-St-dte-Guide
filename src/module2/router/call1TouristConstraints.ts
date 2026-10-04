/**
 * Touristen-Constraints aus der Frage — Accessibility, Family/Kids.
 * Struktur-Musts, keine Themenliste.
 */

import type { Call1Criterion } from '../pitch/call1Criteria';

const ACCESS_RE =
  /\b(barrierefrei|barrierefreiheit|rollstuhl|wheelchair|ohne\s+stufen|stufenlos|aufzug|lift\b|rampe)\b/iu;

const FAMILY_RE =
  /\b(wickelraum|wickeltisch|kinderwagen|stroller|buggy|spielplatz|mit\s+kind(?:ern)?|familie|kids?|kinderfreundlich|sitzerhöhung|sitzerhoehung)\b/iu;

/** Hard-Musts aus Accessibility-/Family-Äußerung. */
export function extractTouristConstraintMusts(text: string): string[] {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const out: string[] = [];
  if (ACCESS_RE.test(t)) {
    out.push('barrierefrei');
    if (/\b(rollstuhl|wheelchair)\b/iu.test(t)) out.push('rollstuhl');
    if (/\b(aufzug|lift)\b/iu.test(t)) out.push('aufzug');
  }
  if (/\b(wickelraum|wickeltisch)\b/iu.test(t)) out.push('wickelraum');
  if (/\b(kinderwagen|stroller|buggy)\b/iu.test(t)) out.push('kinderwagen');
  if (/\b(spielplatz)\b/iu.test(t)) out.push('spielplatz');
  if (
    /\b(mit\s+kind(?:ern)?|familie|kids?|kinderfreundlich)\b/iu.test(t) &&
    !out.includes('spielplatz')
  ) {
    out.push('kinderfreundlich');
  }
  if (/\b(sitzerhöhung|sitzerhoehung)\b/iu.test(t)) out.push('sitzerhoehung');
  return Array.from(new Set(out)).slice(0, 6);
}

export function looksLikeAccessibilityAsk(text: string): boolean {
  return ACCESS_RE.test(String(text || ''));
}

export function looksLikeFamilyKidsAsk(text: string): boolean {
  return FAMILY_RE.test(String(text || ''));
}

export function touristConstraintCriteria(text: string): Call1Criterion[] {
  return extractTouristConstraintMusts(text).map((key) => ({
    key,
    role: 'must' as const,
    weight: key === 'barrierefrei' || key === 'rollstuhl' ? 28 : 22,
  }));
}

export function touristConstraintAuthorIntent(text: string): string {
  const musts = extractTouristConstraintMusts(text);
  if (!musts.length) return '';
  const access = musts.some((m) =>
    /barrierefrei|rollstuhl|aufzug/.test(m),
  );
  const family = musts.some((m) =>
    /wickel|kinder|spielplatz|familie|sitz/.test(m),
  );
  return [
    access
      ? 'Hard-Must Barrierefreiheit: nur belegte Treffer, kein Soft-Fill unzugänglicher Orte; leer → ehrlich + Expand'
      : null,
    family
      ? `Family/Kids-Musts hart: ${musts.filter((m) => /wickel|kinder|spiel|familie|sitz/.test(m)).join(', ')} — Just-Do-It Orte + Route`
      : null,
  ]
    .filter(Boolean)
    .join('. ');
}

/** Abendprogramm ohne Outdoor-Whitelist. */
export function looksLikeEveningPlanAsk(text: string): boolean {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 8) return false;
  try {
    const { isClosedFactAsk } = require('./call1IntentForesight') as {
      isClosedFactAsk: (s: string) => boolean;
    };
    if (isClosedFactAsk(t)) return false;
  } catch {
    /* soft */
  }
  if (
    /\b(was\s+geht|heute\s+abend|heut\s+abend|heute\s+nacht|ausgehen|feiern|nachtleben|nightlife)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  return (
    /\b(party|club|disco|rooftop|bar\s+heute|konzert\s+heute)\b/iu.test(t) &&
    /\b(heute|abend|nacht|wo|hin|empfehl)\b/iu.test(t)
  );
}

export function eveningPlanAuthorIntent(text: string): string {
  if (!looksLikeEveningPlanAsk(text)) return '';
  return [
    'Abendprogramm: 1–2 echte laufende Optionen (Event/Club/Kino/Konzert) mit Uhr wenn belegt',
    'Wetter heute Abend parallel — Outdoor nur wenn trocken/passend',
    'Tickets/Links wenn buchbar — Just-Do-It, keine Permission-Frage',
    'Nichts vorschlagen was schon vorbei ist',
  ].join('. ');
}
