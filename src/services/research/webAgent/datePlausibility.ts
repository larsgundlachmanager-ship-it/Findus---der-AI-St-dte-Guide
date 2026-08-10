/**
 * Date & Plausibility Validation — Anti-Outdated-News Filter.
 * Notices without dates ≠ hard facts; expired year notices ignored/flagged.
 */

import type { ResearchFact } from '../webResearchService';

export type PlausibilityStatus =
  | 'verified_current'
  | 'dated_current'
  | 'dated_outdated'
  | 'undated_uncertain'
  | 'unknown';

export type ValidatedFact = ResearchFact & {
  plausibility: PlausibilityStatus;
  /** ISO date or range start if extracted */
  noticeDateIso?: string | null;
  /** Explicit user-facing caveat */
  caveat?: string | null;
  /** Prefer conjunctive framing in speech */
  useConjunctive?: boolean;
};

const NOTICE_HINT =
  /\b(gesperrt|sperrung|ausfall|wartung|renovierung|baustelle|geschlossen|außer\s+betrieb|ausser\s+betrieb|geändert|geaendert|vorübergehend|voruebergehend|hinweis|achtung)\b/iu;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseLooseDate(
  raw: string,
  now = new Date(),
): Date | null {
  const t = raw.trim();
  // ISO
  const iso = t.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  // DE dd.mm.yyyy or dd.mm.yy
  const de = t.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/);
  if (de) {
    let y = Number(de[3]);
    if (y < 100) y += 2000;
    const d = new Date(y, Number(de[2]) - 1, Number(de[1]));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  // Month name DE + year
  const months: Record<string, number> = {
    januar: 0,
    februar: 1,
    märz: 2,
    maerz: 2,
    april: 3,
    mai: 4,
    juni: 5,
    juli: 6,
    august: 7,
    september: 8,
    oktober: 9,
    november: 10,
    dezember: 11,
  };
  const mn = t.match(
    /\b(\d{1,2})\.?\s*(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s*(20\d{2})?\b/iu,
  );
  if (mn) {
    const month = months[mn[2].toLowerCase()];
    const year = mn[3] ? Number(mn[3]) : now.getFullYear();
    if (month != null) {
      const d = new Date(year, month, Number(mn[1]));
      return Number.isFinite(d.getTime()) ? d : null;
    }
  }
  // Year only near notice
  const yearOnly = t.match(/\b(20\d{2})\b/);
  if (yearOnly && NOTICE_HINT.test(t)) {
    return new Date(Number(yearOnly[1]), 0, 1);
  }
  return null;
}

/**
 * Extract the most relevant date from a notice-like text blob.
 */
export function extractNoticeTimestamp(
  text: string,
  now = new Date(),
): { date: Date | null; iso: string | null; raw: string | null } {
  if (!text?.trim()) return { date: null, iso: null, raw: null };
  // Prefer ranges "vom 12.03.2024 bis …"
  const range = text.match(
    /\b(?:vom|ab|seit|am|gültig|gueltig)\s+([^.!?\n]{0,40}?\d{1,2}\.\d{1,2}\.\d{2,4})/iu,
  );
  const candidate = range?.[1] ?? text;
  const d = parseLooseDate(candidate, now) ?? parseLooseDate(text, now);
  if (!d) return { date: null, iso: null, raw: null };
  return { date: d, iso: ymd(d), raw: candidate.slice(0, 60) };
}

export function isNoticeLike(fact: ResearchFact): boolean {
  const blob = `${fact.label} ${fact.value}`;
  return NOTICE_HINT.test(blob);
}

/**
 * Validate a single fact against "now".
 * - Previous calendar year (or older) on notices → outdated
 * - Notice without date → undated_uncertain (not hard fact)
 * - Explicit current date / high confidence non-notice → verified/dated_current
 */
export function validateFactPlausibility(
  fact: ResearchFact,
  now = new Date(),
): ValidatedFact {
  const blob = `${fact.label} ${fact.value} ${fact.date ?? ''} ${fact.noticeDate ?? ''}`;
  const notice = fact.isNotice === true || isNoticeLike(fact);
  const fromField = fact.noticeDate
    ? parseLooseDate(fact.noticeDate, now)
    : fact.date
      ? parseLooseDate(fact.date, now)
      : null;
  const extracted = extractNoticeTimestamp(blob, now);
  const date = fromField ?? extracted.date;
  const iso = fromField ? ymd(fromField) : extracted.iso;

  if (fact.undated && notice) {
    return {
      ...fact,
      confidence: 'low',
      plausibility: 'undated_uncertain',
      noticeDateIso: null,
      caveat:
        'Kein Datum am Hinweis — nicht als harte Tatsache darstellen; Rezeption/Aushang empfehlen',
      useConjunctive: true,
    };
  }

  if (notice && date) {
    const currentYear = now.getFullYear();
    if (date.getFullYear() < currentYear) {
      return {
        ...fact,
        confidence: 'low',
        plausibility: 'dated_outdated',
        noticeDateIso: iso,
        caveat: `Hinweis scheint von ${date.getFullYear()} — wahrscheinlich veraltet`,
        useConjunctive: true,
      };
    }
    // Same year but end date clearly in the past (>14 days ago) → outdated
    const ageDays = (now.getTime() - date.getTime()) / 86_400_000;
    if (ageDays > 45 && !/\b(dauerhaft|bis\s+auf\s+weiteres)\b/iu.test(blob)) {
      return {
        ...fact,
        confidence: 'low',
        plausibility: 'dated_outdated',
        noticeDateIso: iso,
        caveat: 'Datierter Hinweis wirkt abgelaufen',
        useConjunctive: true,
      };
    }
    return {
      ...fact,
      confidence: fact.confidence === 'low' ? 'medium' : fact.confidence,
      plausibility: 'dated_current',
      noticeDateIso: iso,
      useConjunctive: false,
    };
  }

  if (notice && !date) {
    return {
      ...fact,
      confidence: 'low',
      plausibility: 'undated_uncertain',
      noticeDateIso: null,
      caveat:
        'Kein Datum am Hinweis — nicht als harte Tatsache darstellen; Rezeption/Aushang empfehlen',
      useConjunctive: true,
    };
  }

  if (fact.confidence === 'high' && !notice) {
    return {
      ...fact,
      plausibility: 'verified_current',
      noticeDateIso: iso,
      useConjunctive: false,
    };
  }

  return {
    ...fact,
    plausibility: iso ? 'dated_current' : 'unknown',
    noticeDateIso: iso,
    useConjunctive: fact.confidence === 'low',
  };
}

export function filterAndValidateFacts(
  facts: ResearchFact[],
  now = new Date(),
): {
  keep: ValidatedFact[];
  droppedOutdated: ValidatedFact[];
} {
  const keep: ValidatedFact[] = [];
  const droppedOutdated: ValidatedFact[] = [];
  for (const f of facts) {
    const v = validateFactPlausibility(f, now);
    if (v.plausibility === 'dated_outdated') {
      droppedOutdated.push(v);
      continue; // IGNORE outdated as hard facts
    }
    keep.push(v);
  }
  return { keep, droppedOutdated };
}

/** Conjunctive speech framing for uncertain / undated notices. */
export function frameFactForSpeech(v: ValidatedFact): string {
  const core = `${v.label}: ${v.value}`;
  if (v.plausibility === 'verified_current' || (v.plausibility === 'dated_current' && !v.useConjunctive)) {
    return core;
  }
  if (v.plausibility === 'undated_uncertain' || v.useConjunctive) {
    return (
      `Auf der Webseite gibt es einen Hinweis, dass ${v.value}` +
      (/\.$/.test(v.value) ? '' : '.') +
      ` Da kein genaues aktuelles Datum klar ist, frage am besten kurz vor Ort / an der Rezeption nach.`
    );
  }
  if (v.plausibility === 'dated_outdated') {
    return `Es gibt einen älteren Hinweis (${v.noticeDateIso ?? 'ohne Jahr'}) zu „${v.value}“ — den würde ich nicht mehr als aktuell werten.`;
  }
  return core;
}

export function buildConjunctiveSpeechHint(
  facts: ValidatedFact[],
  droppedOutdated: ValidatedFact[],
): string | null {
  if (!facts.length && !droppedOutdated.length) return null;
  const hard = facts.filter(
    (f) =>
      f.plausibility === 'verified_current' ||
      (f.plausibility === 'dated_current' && !f.useConjunctive),
  );
  const soft = facts.filter((f) => f.useConjunctive || f.plausibility === 'undated_uncertain');

  const parts: string[] = [];
  if (hard.length) {
    parts.push(
      hard
        .slice(0, 2)
        .map((f) => `${f.label} ${f.value}`)
        .join('; '),
    );
  }
  if (soft.length) {
    parts.push(frameFactForSpeech(soft[0]!));
  }
  if (droppedOutdated.length) {
    parts.push(
      `Einen alten Hinweis (${droppedOutdated[0]!.noticeDateIso ?? 'vergangenes Jahr'}) habe ich bewusst nicht als Fakt übernommen.`,
    );
  }
  return parts.filter(Boolean).join(' ') || null;
}

/** Prompt block for Gemini extraction — date discipline. */
export function dateValidationPromptBlock(now = new Date()): string {
  return [
    '=== DATE & PLAUSIBILITY (STRENG) ===',
    `Heute: ${ymd(now)}.`,
    '- Bei Bannern/Hinweisen (gesperrt, Wartung, Baustelle, geänderte Zeiten): IMMER Datum/Zeitraum extrahieren wenn vorhanden.',
    '- Hinweise aus vergangenen Jahren ODER klar abgelaufen → NICHT als Fakt; in failures/outdated melden.',
    '- Hinweis OHNE Datum → confidence:"low", field undated:true — niemals als 100%-Fakt.',
    '- Preise/Öffnungszeiten/Flyer-Rabatte NUR wenn im Quelltext belegt — nie erfinden.',
    '- JSON facts zusätzlich: "noticeDate":"YYYY-MM-DD"|null, "isNotice":true|false, "undated":true|false',
  ].join('\n');
}
